import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from './_core/trpc.js';
import { TRPCError } from '@trpc/server';
import { submitRollOrder, submitCloseOrder, authenticateTastytrade } from './tastytrade.js';
import { checkOrderStatus, pollOrderStatus, checkOrderStatusBatch } from './tastytrade-order-status.js';

export const ordersRouter = router({
  /**
   * Fetch live bid/ask quotes for a batch of option symbols
   * Used by the Order Preview modal to populate accurate Good Fill Zone sliders
   */
  fetchOptionQuotes: protectedProcedure
    .input(
      z.object({
        symbols: z.array(z.string()).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const { apiCredentials } = await import('../drizzle/schema.js');
        const { eq } = await import('drizzle-orm');
        const [creds] = await db.select().from(apiCredentials).where(eq(apiCredentials.userId, ctx.user.id));
        if (!creds) return {} as Record<string, { bid: number; ask: number }>;
        const api = await authenticateTastytrade(creds, ctx.user.id);
        const quotes = await api.getOptionQuotesBatch(input.symbols);
        // quotes is Record<symbol, {bid, ask, mark?, mid?, last?}>
        // Normalise to a simple map of symbol -> {bid, ask}
        const result: Record<string, { bid: number; ask: number }> = {};
        for (const [sym, q] of Object.entries(quotes)) {
          const qAny = q as any;
          result[sym] = {
            bid: typeof qAny.bid === 'number' ? qAny.bid : 0,
            ask: typeof qAny.ask === 'number' ? qAny.ask : 0,
          };
        }
        return result;
      } catch (err: any) {
        console.error('[fetchOptionQuotes] Failed:', err.message);
        // Return empty map — caller falls back to estimated bid/ask
        return {} as Record<string, { bid: number; ask: number }>;
      }
    }),

  /**
   * Check order status by order ID
   */
  checkStatus: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        orderId: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await checkOrderStatus(input.accountId, input.orderId);
    }),

  /**
   * Check order status once (single request, no server-side polling loop).
   * The client is responsible for calling this repeatedly at its own interval.
   * This avoids long-running HTTP requests that time out and return HTML.
   */
  pollStatus: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        orderId: z.string(),
        // maxAttempts / intervalMs kept for backwards-compat but ignored
        maxAttempts: z.number().optional(),
        intervalMs: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { getTastytradeAPI } = await import('./tastytrade.js');
      const api = getTastytradeAPI();
      // Resolve account list — support ALL_ACCOUNTS
      let accountsToTry: string[] = [];
      if (input.accountId === 'ALL_ACCOUNTS') {
        const accounts = await api.getAccounts();
        accountsToTry = accounts.map((acc: any) => acc.account?.['account-number'] || acc['account-number']);
      } else {
        accountsToTry = [input.accountId];
      }

      for (const accNum of accountsToTry) {
        try {
          const status = await checkOrderStatus(accNum, input.orderId, 1);
          return { ...status, orderId: input.orderId };
        } catch (error: any) {
          const msg: string = error.message || 'Unknown error';
          // "Couldn't find Order" means the order is not in this account — try next
          if (msg.includes("Couldn't find Order") || msg.includes('not found') || msg.includes('404')) {
            continue;
          }
          if (msg.includes('Rate exceeded') || msg.includes('not valid JSON') || msg.includes('Unexpected token')) {
            return { status: 'Working' as const, orderId: input.orderId, message: 'Rate limited — will retry' };
          }
          console.error(`[pollStatus] Error for order ${input.orderId} in account ${accNum}:`, msg);
          // Don't propagate — return Working so client keeps polling
          return { status: 'Working' as const, orderId: input.orderId, message: 'Checking order status...' };
        }
      }
      // Order not found in any account yet — it may still be propagating
      return { status: 'Working' as const, orderId: input.orderId, message: 'Order submitted — awaiting confirmation' };
    }),

  /**
   * Check status for multiple orders in batch
   */
  checkStatusBatch: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        orderIds: z.array(z.string()),
      })
    )
    .query(async ({ input }) => {
      return await checkOrderStatusBatch(input.accountId, input.orderIds);
    }),

  /**
   * Pre-submission validator: check actual open position quantity from Tastytrade.
   * Returns the actual held quantity for each option symbol so the UI can warn
   * the user if the requested close quantity exceeds what is actually held.
   *
   * Also validates index expiration rules:
   *   - SPX: only 3rd Friday (monthly AM-settled)
   *   - SPXW: any expiration that is NOT the 3rd Friday
   *   - NDX: only 3rd Friday
   *   - NDXP: any non-3rd-Friday expiration
   *   - RUT: only 3rd Friday
   *   - RUTW: any non-3rd-Friday expiration
   */
  validateCloseOrders: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        orders: z.array(
          z.object({
            optionSymbol: z.string(),   // Full OCC symbol (e.g. "SPXW  260402C06725000")
            underlying: z.string(),     // Underlying (e.g. "SPXW")
            requestedQuantity: z.number(),
            expiration: z.string(),     // YYYY-MM-DD
            optionType: z.enum(['PUT', 'CALL']).optional(),
          })
        ),
      })
    )
    .query(async ({ input, ctx }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });

      const { apiCredentials } = await import('../drizzle/schema.js');
      const { eq } = await import('drizzle-orm');
      const [creds] = await db.select().from(apiCredentials).where(eq(apiCredentials.userId, ctx.user.id));
      if (!creds?.tastytradeClientSecret) {
        // No credentials — skip quantity check, just run expiration validation
        return buildExpirationOnlyResult(input.orders);
      }

      let positions: any[] = [];
      try {
        const api = await authenticateTastytrade(creds, ctx.user.id);
        // Resolve account list
        let accountsToCheck: string[] = [];
        if (input.accountId === 'ALL_ACCOUNTS') {
          const accounts = await api.getAccounts();
          accountsToCheck = accounts.map((acc: any) => acc.account?.['account-number'] || acc['account-number']).filter(Boolean);
        } else {
          accountsToCheck = [input.accountId];
        }
        // Fetch positions from all accounts
        for (const accNum of accountsToCheck) {
          try {
            const acctPositions = await api.getPositions(accNum);
            positions.push(...acctPositions);
          } catch (e: any) {
            console.warn(`[validateCloseOrders] Could not fetch positions for ${accNum}:`, e.message);
          }
        }
      } catch (e: any) {
        console.warn('[validateCloseOrders] Auth failed, skipping quantity check:', e.message);
        return buildExpirationOnlyResult(input.orders);
      }

      // Build a map: normalised OCC symbol (no spaces) → actual held quantity
      const heldQuantityMap = new Map<string, number>();
      for (const pos of positions) {
        const normSym = (pos.symbol || '').replace(/\s+/g, '');
        const qty = Math.abs(Number(pos.quantity) || 0);
        const dir = (pos['quantity-direction'] || '').toLowerCase();
        // We're closing SHORT positions (BTC) or LONG positions (STC)
        // Add to map regardless of direction — the caller decides which action to use
        heldQuantityMap.set(normSym, (heldQuantityMap.get(normSym) || 0) + qty);
      }

      const { getOccRoot } = await import('../shared/orderUtils.js');

      const results = input.orders.map(order => {
        const normSym = order.optionSymbol.replace(/\s+/g, '');
        const heldQty = heldQuantityMap.get(normSym) ?? null; // null = symbol not found in positions

        // Quantity check
        let quantityWarning: string | null = null;
        let quantityError: string | null = null;
        if (heldQty !== null) {
          if (order.requestedQuantity > heldQty) {
            quantityError = `You hold ${heldQty} contract${heldQty !== 1 ? 's' : ''} of ${order.underlying} but are trying to close ${order.requestedQuantity}. Tastytrade will reject this order.`;
          } else if (order.requestedQuantity === heldQty) {
            // Exact match — fine, no warning
          }
        }

        // Index expiration rule check
        const expirationWarning = validateIndexExpiration(order.underlying, order.expiration);

        return {
          optionSymbol: order.optionSymbol,
          underlying: order.underlying,
          requestedQuantity: order.requestedQuantity,
          heldQuantity: heldQty,
          quantityError,
          quantityWarning,
          expirationWarning,
          isValid: !quantityError && !expirationWarning?.isError,
        };
      });

      return { results };
    }),

  /**
   * Submit a roll order (2-leg: close existing + open new)
   */
  submitRoll: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        closeLeg: z.object({
          action: z.enum(['BTC', 'STC']),
          quantity: z.number(),
          strike: z.number(),
          expiration: z.string(),
          optionType: z.enum(['PUT', 'CALL']),
        }),
        openLeg: z.object({
          action: z.enum(['STO', 'BTO']),
          quantity: z.number(),
          strike: z.number(),
          expiration: z.string(),
          optionType: z.enum(['PUT', 'CALL']),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user is in paper trading mode
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const [user] = await db.select().from((await import('../drizzle/schema.js')).users).where((await import('drizzle-orm')).eq((await import('../drizzle/schema.js')).users.id, ctx.user.id));
      if (user?.tradingMode === 'paper') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Order submission is disabled in Paper Trading mode',
        });
      }
      
      try {
        const result = await submitRollOrder({
          accountNumber: input.accountNumber,
          symbol: input.symbol,
          closeLeg: input.closeLeg,
          openLeg: input.openLeg,
        });

        return {
          success: true,
          orderId: result.orderId,
          message: 'Roll order submitted successfully',
        };
      } catch (error: any) {
        console.error('Failed to submit roll order:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to submit roll order',
        });
      }
    }),

  /**
   * Submit a close order (1-leg: close existing position)
   */
  submitClose: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        closeLeg: z.object({
          action: z.enum(['BTC', 'STC']),
          quantity: z.number(),
          strike: z.number(),
          expiration: z.string(),
          optionType: z.enum(['PUT', 'CALL']),
          price: z.number(),
          optionSymbol: z.string().optional(), // Full OCC option symbol from Tastytrade
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user is in paper trading mode
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const [user] = await db.select().from((await import('../drizzle/schema.js')).users).where((await import('drizzle-orm')).eq((await import('../drizzle/schema.js')).users.id, ctx.user.id));
      if (user?.tradingMode === 'paper') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Order submission is disabled in Paper Trading mode',
        });
      }
      
      try {
        const result = await submitCloseOrder({
          accountNumber: input.accountNumber,
          symbol: input.symbol,
          closeLeg: input.closeLeg,
        });

        return {
          success: true,
          orderId: result.orderId,
          message: 'Close order submitted successfully',
        };
      } catch (error: any) {
        console.error('Failed to submit close order:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to submit close order',
        });
      }
    }),
});

// ─── Helper: expiration-only validation (no Tastytrade auth required) ─────────

function buildExpirationOnlyResult(orders: Array<{ optionSymbol: string; underlying: string; requestedQuantity: number; expiration: string }>) {
  return {
    results: orders.map(order => ({
      optionSymbol: order.optionSymbol,
      underlying: order.underlying,
      requestedQuantity: order.requestedQuantity,
      heldQuantity: null as number | null,
      quantityError: null as string | null,
      quantityWarning: null as string | null,
      expirationWarning: validateIndexExpiration(order.underlying, order.expiration),
      isValid: !validateIndexExpiration(order.underlying, order.expiration)?.isError,
    })),
  };
}

/**
 * Validate that the expiration date is consistent with the index symbol's rules.
 *
 * Rules:
 *   SPX   → MUST be 3rd Friday (AM-settled monthly). Any other date should use SPXW.
 *   SPXW  → Must NOT be 3rd Friday (those belong to SPX root).
 *   NDX   → MUST be 3rd Friday. Any other date should use NDXP.
 *   NDXP  → Must NOT be 3rd Friday.
 *   RUT   → MUST be 3rd Friday. Any other date should use RUTW.
 *   RUTW  → Must NOT be 3rd Friday.
 *
 * Returns null if no issue, or an object with { message, isError } if there's a problem.
 */
function validateIndexExpiration(
  symbol: string,
  expiration: string
): { message: string; isError: boolean } | null {
  const sym = symbol.toUpperCase();
  const expDate = new Date(expiration + 'T12:00:00Z');
  const thirdFriday = isThirdFriday(expDate);
  const dayOfWeek = expDate.getUTCDay(); // 0=Sun, 5=Fri
  const isFriday = dayOfWeek === 5;

  switch (sym) {
    case 'SPX':
      if (!thirdFriday) {
        return {
          message: `SPX options only trade on the 3rd Friday of each month (AM-settled). ` +
            `This expiration (${expiration}) is not the 3rd Friday — use SPXW instead for weekly/other expirations.`,
          isError: true,
        };
      }
      break;

    case 'SPXW':
      if (thirdFriday) {
        return {
          message: `SPXW is the weekly root. The 3rd Friday expiration belongs to the SPX root (AM-settled). ` +
            `Consider using SPX for this expiration (${expiration}) if you intend the monthly AM-settled contract.`,
          isError: false, // Warning only — SPXW on 3rd Friday may still be valid for PM-settled
        };
      }
      break;

    case 'NDX':
      if (!thirdFriday) {
        return {
          message: `NDX options only trade on the 3rd Friday of each month (AM-settled). ` +
            `This expiration (${expiration}) is not the 3rd Friday — use NDXP instead for weekly/other expirations.`,
          isError: true,
        };
      }
      break;

    case 'NDXP':
      if (thirdFriday) {
        return {
          message: `NDXP is the weekly root. The 3rd Friday expiration belongs to the NDX root (AM-settled). ` +
            `Consider using NDX for this expiration (${expiration}) if you intend the monthly AM-settled contract.`,
          isError: false,
        };
      }
      break;

    case 'RUT':
      if (!thirdFriday) {
        return {
          message: `RUT options only trade on the 3rd Friday of each month (AM-settled). ` +
            `This expiration (${expiration}) is not the 3rd Friday — use RUTW instead for weekly expirations.`,
          isError: true,
        };
      }
      break;

    case 'RUTW':
      if (thirdFriday) {
        return {
          message: `RUTW is the weekly root. The 3rd Friday expiration belongs to the RUT root (AM-settled). ` +
            `Consider using RUT for this expiration (${expiration}) if you intend the monthly AM-settled contract.`,
          isError: false,
        };
      }
      break;

    default:
      // Equity options and other indexes: no expiration rule restriction
      break;
  }

  return null;
}

/** The 3rd Friday of a month always falls between the 15th and 21st. */
function isThirdFriday(expDate: Date): boolean {
  return expDate.getUTCDay() === 5 && expDate.getUTCDate() >= 15 && expDate.getUTCDate() <= 21;
}
