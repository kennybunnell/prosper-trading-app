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
        symbols: z.array(z.string()).max(50),
      })
    )
    .query(async ({ input, ctx }) => {
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
   * Poll order status until it's no longer "Working"
   */
  pollStatus: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        orderId: z.string(),
        maxAttempts: z.number().optional(),
        intervalMs: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await pollOrderStatus(input.accountId, input.orderId, {
        maxAttempts: input.maxAttempts,
        intervalMs: input.intervalMs,
      });
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
