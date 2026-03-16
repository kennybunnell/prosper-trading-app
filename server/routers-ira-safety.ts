/**
 * IRA Safety Monitor Router
 *
 * Scans all accounts for positions that violate IRA/cash account rules:
 *
 * 1. SHORT STOCK  — Negative quantity equity position (e.g. -100 ADBE)
 *    → Triggered by assignment on a short call when you don't own shares
 *    → Must be closed immediately (SL call from Tastytrade)
 *
 * 2. NAKED SHORT CALL — Short call with no matching long call AND no stock position
 *    → Not allowed in IRA; covered calls require owning 100 shares
 *
 * 3. ORPHANED SHORT LEG — Short option whose paired long leg was closed/assigned
 *    → Spread became naked; now an unprotected short in a restricted account
 *
 * 4. ITM SHORT CALL (assignment risk) — Short call that is in-the-money with ≤5 DTE
 *    → High probability of early assignment overnight; warn before it happens
 *
 * Root cause of ADBE incident (account 418, 2026-02-27):
 *   - User held a short ADBE call in an IRA/cash account
 *   - The call was assigned (option holder exercised)
 *   - Assignment required delivering 100 ADBE shares
 *   - User did not own ADBE shares → system created -100 short stock
 *   - Tastytrade issued SL call: "Short Restricted Strategy for 100.0"
 *   - Fix: Buy 100 ADBE shares before market close
 */

import { router, protectedProcedure } from './_core/trpc';
import { z } from 'zod';
import { getDb } from './db';
import { eq, and, gt } from 'drizzle-orm';

// IRA/cash account type names from Tastytrade API
const IRA_ACCOUNT_TYPES = [
  'Roth IRA',
  'Traditional IRA',
  'SEP IRA',
  'SIMPLE IRA',
  'Beneficiary IRA',
  'Inherited IRA',
  'Rollover IRA',
  'IRA',
  'Cash', // Cash accounts also cannot hold short stock
];

function isRestrictedAccount(accountType: string | null | undefined): boolean {
  if (!accountType) return false;
  const normalized = accountType.toLowerCase();
  return IRA_ACCOUNT_TYPES.some(t => normalized.includes(t.toLowerCase()));
}

export type ViolationType =
  | 'SHORT_STOCK'           // -100 shares of a stock (SL call trigger)
  | 'NAKED_SHORT_CALL'      // Short call with no stock coverage and no long call
  | 'ORPHANED_SHORT_LEG'    // Short option whose paired long was closed/assigned
  | 'ITM_ASSIGNMENT_RISK';  // Short call ITM ≤5 DTE — assignment likely tonight

export interface IraViolation {
  violationType: ViolationType;
  severity: 'critical' | 'warning';
  accountNumber: string;
  accountType: string;
  symbol: string;
  description: string;
  /** Suggested action to resolve the violation */
  action: string;
  /** For SHORT_STOCK: number of shares short */
  sharesShort?: number;
  /** For option violations: the option symbol */
  optionSymbol?: string;
  /** For option violations: strike price */
  strike?: number;
  /** For option violations: expiration date */
  expiration?: string;
  /** For option violations: DTE */
  dte?: number;
  /** For option violations: how far ITM (%) */
  itmPct?: number;
  /** Current stock price (from Tradier, best-effort) */
  stockPrice?: number;
  /** % distance between stock price and strike (positive = OTM, negative = ITM) */
  strikeDistancePct?: number;
}

function calcDTE(expiresAt: string): number {
  const exp = new Date(expiresAt);
  const now = new Date();
  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function parseStrikeFromSymbol(symbol: string): number {
  const clean = symbol.replace(/\s/g, '');
  const match = clean.match(/[CP](\d{8})$/);
  if (match) return parseInt(match[1]) / 1000;
  return 0;
}

function parseExpirationFromSymbol(symbol: string): string {
  const clean = symbol.replace(/\s/g, '');
  // OCC format: SYMBOL + YYMMDD + C/P + strike
  const match = clean.match(/[A-Z]+(\d{6})[CP]/);
  if (match) {
    const d = match[1];
    return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
  }
  return '';
}

export const iraSafetyRouter = router({
  /**
   * Scan all accounts for IRA/cash account violations.
   * Returns a list of violations sorted by severity (critical first).
   */
  scanViolations: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { violations: [], accountsScanned: 0, hasViolations: false, criticalCount: 0, warningCount: 0 };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const dbAccounts = await getTastytradeAccounts(ctx.user.id);
      if (!dbAccounts || dbAccounts.length === 0) {
        return { violations: [], accountsScanned: 0, hasViolations: false, criticalCount: 0, warningCount: 0 };
      }

      let targetAccounts = dbAccounts;
      if (input?.accountId) {
        const found = dbAccounts.find(a => a.accountId === input.accountId);
        if (found) targetAccounts = [found];
      }

      const violations: IraViolation[] = [];

      for (const account of targetAccounts) {
        const accountType = account.accountType || '';
        const isRestricted = isRestrictedAccount(accountType);

        // Fetch all positions for this account
        let positions: any[] = [];
        try {
          positions = await api.getPositions(account.accountNumber) || [];
        } catch (e) {
          console.warn(`[IRA Safety] Could not fetch positions for ${account.accountNumber}:`, e);
          continue;
        }

        // Separate into stock and option positions
        const stockPositions = positions.filter(p => p['instrument-type'] === 'Equity');
        const optionPositions = positions.filter(p => p['instrument-type'] === 'Equity Option');

        // ── 1. SHORT STOCK (critical — SL call trigger) ──────────────────────
        for (const pos of stockPositions) {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const isShort = direction === 'short' || qty < 0;

          if (isShort) {
            const sharesShort = Math.abs(qty);
            const underlying = pos['underlying-symbol'] || pos.symbol || '';

            violations.push({
              violationType: 'SHORT_STOCK',
              severity: 'critical',
              accountNumber: account.accountNumber,
              accountType: accountType || 'Unknown',
              symbol: underlying,
              description: `Short ${sharesShort} shares of ${underlying} in ${accountType || 'restricted'} account. ` +
                `This triggered a Tastytrade SL (Short Restricted Strategy) call. ` +
                `Most likely caused by assignment on a short call when you did not own the shares.`,
              action: `Buy ${sharesShort} shares of ${underlying} before market close to satisfy the SL call.`,
              sharesShort,
            });
          }
        }

        // Only check option violations for IRA/cash accounts
        if (!isRestricted) continue;

        // Build a map of stock positions for covered-call check
        const stockMap = new Map<string, number>(); // symbol → signed shares
        for (const pos of stockPositions) {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const signedQty = direction === 'short' ? -Math.abs(qty) : Math.abs(qty);
          const sym = pos['underlying-symbol'] || pos.symbol || '';
          stockMap.set(sym, (stockMap.get(sym) || 0) + signedQty);
        }

        // Build maps of short and long options by underlying
        const shortCalls = new Map<string, any[]>();
        const longCalls  = new Map<string, any[]>();
        const shortPuts  = new Map<string, any[]>();
        const longPuts   = new Map<string, any[]>();

        for (const pos of optionPositions) {
          const sym = pos.symbol || '';
          const underlying = pos['underlying-symbol'] || '';
          const direction = pos['quantity-direction']?.toLowerCase();
          const isShort = direction === 'short';
          const isCall = sym.includes('C');
          const isPut  = sym.includes('P');

          if (isShort && isCall) {
            if (!shortCalls.has(underlying)) shortCalls.set(underlying, []);
            shortCalls.get(underlying)!.push(pos);
          } else if (!isShort && isCall) {
            if (!longCalls.has(underlying)) longCalls.set(underlying, []);
            longCalls.get(underlying)!.push(pos);
          } else if (isShort && isPut) {
            if (!shortPuts.has(underlying)) shortPuts.set(underlying, []);
            shortPuts.get(underlying)!.push(pos);
          } else if (!isShort && isPut) {
            if (!longPuts.has(underlying)) longPuts.set(underlying, []);
            longPuts.get(underlying)!.push(pos);
          }
        }

        // ── 2. NAKED SHORT CALL — no stock + no long call ────────────────────
        for (const [underlying, calls] of Array.from(shortCalls.entries())) {
          const sharesOwned = stockMap.get(underlying) || 0;
          const hasLongCalls = (longCalls.get(underlying) || []).length > 0;

          for (const sc of calls) {
            const qty = Math.abs(parseInt(String(sc.quantity || '1')));
            const sharesNeeded = qty * 100;
            const isCovered = sharesOwned >= sharesNeeded;
            const isSpread  = hasLongCalls;

            if (!isCovered && !isSpread) {
              const strike = parseStrikeFromSymbol(sc.symbol);
              const expiration = sc['expires-at'] ? sc['expires-at'].split('T')[0] : parseExpirationFromSymbol(sc.symbol);
              const dte = sc['expires-at'] ? calcDTE(sc['expires-at']) : 0;

              violations.push({
                violationType: 'NAKED_SHORT_CALL',
                severity: 'critical',
                accountNumber: account.accountNumber,
                accountType,
                symbol: underlying,
                description: `Naked short call on ${underlying} ($${strike} strike, ${expiration}) in ${accountType}. ` +
                  `You own ${sharesOwned} shares but need ${sharesNeeded} to be covered. ` +
                  `This is not permitted in IRA/cash accounts.`,
                action: `Either buy ${sharesNeeded - sharesOwned} shares of ${underlying} to cover, ` +
                  `or buy a long call at a higher strike to convert to a spread, ` +
                  `or close (BTC) the short call immediately.`,
                optionSymbol: sc.symbol,
                strike,
                expiration,
                dte,
              });
            }
          }
        }

        // ── 3. ORPHANED SHORT LEG — short put with no matching long put ──────
        for (const [underlying, puts] of Array.from(shortPuts.entries())) {
          const hasLongPuts = (longPuts.get(underlying) || []).length > 0;

          if (!hasLongPuts) {
            for (const sp of puts) {
              const strike = parseStrikeFromSymbol(sp.symbol);
              const expiration = sp['expires-at'] ? sp['expires-at'].split('T')[0] : parseExpirationFromSymbol(sp.symbol);
              const dte = sp['expires-at'] ? calcDTE(sp['expires-at']) : 0;

              violations.push({
                violationType: 'ORPHANED_SHORT_LEG',
                severity: 'warning',
                accountNumber: account.accountNumber,
                accountType,
                symbol: underlying,
                description: `Short put on ${underlying} ($${strike} strike, ${expiration}) has no matching long put. ` +
                  `If this was originally a Bull Put Spread, the long leg may have been closed or assigned, ` +
                  `leaving a naked short put. Verify this is a fully cash-secured put (CSP) with sufficient cash.`,
                action: `Verify you have enough cash to cover assignment ($${(strike * 100).toLocaleString()} per contract). ` +
                  `If this was a spread that lost its long leg, buy a lower-strike put to restore protection, ` +
                  `or close (BTC) the short put.`,
                optionSymbol: sp.symbol,
                strike,
                expiration,
                dte,
              });
            }
          }
        }

        // ── 4. ITM SHORT CALL — assignment risk warning ───────────────────────
        // Cash-settled index symbols: assignment creates a cash payment, NOT short stock.
        // These are defined-risk spreads (BCS) — no shares are deliverable.
        // We still warn if the short leg is unprotected (no matching long call),
        // but we NEVER flag a spread-protected index call as an assignment risk.
        const CASH_SETTLED_INDEX = new Set(['SPX', 'SPXW', 'SPXPM', 'XSP', 'NDX', 'NDXP', 'XND', 'RUT', 'MRUT', 'DJX', 'VIX', 'VIXW']);
        for (const [underlying, calls] of Array.from(shortCalls.entries())) {
          const sharesOwned = stockMap.get(underlying) || 0;
          const isCashSettledIndex = CASH_SETTLED_INDEX.has(underlying.toUpperCase());
          // Get all long calls for this underlying to check spread protection
          const longCallsForUnderlying = longCalls.get(underlying) || [];

          for (const sc of calls) {
            const strike = parseStrikeFromSymbol(sc.symbol);
            const expiration = sc['expires-at'] ? sc['expires-at'].split('T')[0] : parseExpirationFromSymbol(sc.symbol);
            const dte = sc['expires-at'] ? calcDTE(sc['expires-at']) : 0;

            if (dte <= 5 && strike > 0) {
              const qty = Math.abs(parseInt(String(sc.quantity || '1')));
              const sharesNeeded = qty * 100;
              const isCoveredByShares = sharesOwned >= sharesNeeded;

              // Check if this short call is protected by a long call at a higher strike
              // (same expiration = Bear Call Spread / BCS)
              const scExpiry = sc['expires-at'] || expiration;
              const isSpreadProtected = longCallsForUnderlying.some((lc: any) => {
                const lcExpiry = lc['expires-at'] || parseExpirationFromSymbol(lc.symbol);
                const lcStrike = parseStrikeFromSymbol(lc.symbol);
                // Long call must be at a HIGHER strike (bear call spread protection)
                // and same expiration (or within 1 day for AM/PM settlement quirks)
                const sameExpiry = lcExpiry && scExpiry &&
                  (lcExpiry.split('T')[0] === scExpiry.split('T')[0]);
                return sameExpiry && lcStrike > strike;
              });

              // For cash-settled indexes: assignment creates cash settlement, not short stock.
              // Only warn if the call is ALSO unprotected (no long call hedge).
              // For equity options: warn if not covered by shares AND not spread-protected.
              const shouldWarn = isCashSettledIndex
                ? !isSpreadProtected  // index: only warn if naked (no long call)
                : !isCoveredByShares && !isSpreadProtected; // equity: warn if uncovered AND unhedged

              if (shouldWarn) {
                const isIndex = isCashSettledIndex;
                violations.push({
                  violationType: 'ITM_ASSIGNMENT_RISK',
                  severity: 'warning',
                  accountNumber: account.accountNumber,
                  accountType,
                  symbol: underlying,
                  description: isIndex
                    ? `Short call on ${underlying} ($${strike} strike) expires in ${dte} day${dte !== 1 ? 's' : ''} ` +
                      `with no long call protection. ${underlying} is cash-settled — assignment pays cash, not stock — ` +
                      `but an unprotected short call in an IRA has unlimited risk. ` +
                      `Add a long call at a higher strike to convert to a Bear Call Spread.`
                    : `Short call on ${underlying} ($${strike} strike) expires in ${dte} day${dte !== 1 ? 's' : ''} ` +
                      `and you own ${sharesOwned} of ${sharesNeeded} shares needed for coverage. ` +
                      `If this call is in-the-money, assignment overnight will create short stock — ` +
                      `triggering an SL call like the ADBE incident.`,
                  action: `Close (BTC) this short call before market close, or roll it out to a later expiration. ` +
                    `Do NOT let an uncovered ITM short call expire in an IRA account.`,
                  optionSymbol: sc.symbol,
                  strike,
                  expiration,
                  dte,
                });
              }
            }
          }
        }
      }

      // Sort: critical first, then warning; within each severity, SHORT_STOCK first
      violations.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        const order = { SHORT_STOCK: 0, NAKED_SHORT_CALL: 1, ORPHANED_SHORT_LEG: 2, ITM_ASSIGNMENT_RISK: 3 };
        return (order[a.violationType] ?? 9) - (order[b.violationType] ?? 9);
      });

      // ── Filter out snoozed ITM_ASSIGNMENT_RISK violations ─────────────────
      let filteredViolations = violations;
      let snoozedCount = 0;
      try {
        const db = await getDb();
        if (db) {
          const { snoozedViolations } = await import('../drizzle/schema');
          const now = Date.now();
          const activeSnoozes = await db
            .select()
            .from(snoozedViolations)
            .where(eq(snoozedViolations.userId, ctx.user.id));
          const validSnoozes = activeSnoozes.filter(
            (s: typeof snoozedViolations.$inferSelect) => s.snoozedUntil > now
          );
          if (validSnoozes.length > 0) {
            const snoozeSet = new Set(
              validSnoozes.map((s: typeof snoozedViolations.$inferSelect) =>
                `${s.symbol}|${s.accountNumber}|${s.violationType}`
              )
            );
            const before = filteredViolations.length;
            filteredViolations = filteredViolations.filter(v => {
              if (v.violationType !== 'ITM_ASSIGNMENT_RISK') return true; // never filter critical
              return !snoozeSet.has(`${v.symbol}|${v.accountNumber}|${v.violationType}`);
            });
            snoozedCount = before - filteredViolations.length;
          }
        }
      } catch (e) {
        console.warn('[IRA Safety] Could not load snoozes:', e);
      }

      // ── Enrich violations with live stock prices from Tradier ─────────────
      try {
        const { getApiCredentials: getCreds } = await import('./db');
        const creds = await getCreds(ctx.user.id);
        const storedKey = creds?.tradierApiKey;
        const tradierApiKey = (storedKey && storedKey.length > 15 ? storedKey : null) || process.env.TRADIER_API_KEY;
        if (tradierApiKey) {
          const { createTradierAPI } = await import('./tradier');
          const tradierApi = createTradierAPI(tradierApiKey);
          const symbolsNeedingPrice = Array.from(new Set(
            filteredViolations
              .filter(v => v.strike && v.strike > 0)
              .map(v => v.symbol)
          ));
          if (symbolsNeedingPrice.length > 0) {
            const quotes = await tradierApi.getQuotes(symbolsNeedingPrice);
            const priceMap = new Map<string, number>();
            for (const q of quotes) {
              const price = q.last || q.close || ((q.bid + q.ask) / 2) || 0;
              if (price > 0) priceMap.set(q.symbol, price);
            }
            for (const v of filteredViolations) {
              const price = priceMap.get(v.symbol);
              if (price && v.strike && v.strike > 0) {
                v.stockPrice = price;
                // Calls: OTM when stock < strike (positive pct = OTM)
                // Puts:  OTM when stock > strike (positive pct = OTM)
                const isCall = v.optionSymbol?.replace(/\s/g, '').match(/[A-Z]+\d{6}C/) != null;
                if (isCall) {
                  v.strikeDistancePct = ((v.strike - price) / price) * 100;
                } else {
                  v.strikeDistancePct = ((price - v.strike) / price) * 100;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('[IRA Safety] Could not enrich with stock prices:', e);
      }

      return {
        violations: filteredViolations,
        accountsScanned: targetAccounts.length,
        hasViolations: filteredViolations.length > 0,
        criticalCount: filteredViolations.filter(v => v.severity === 'critical').length,
        warningCount: filteredViolations.filter(v => v.severity === 'warning').length,
        snoozedCount,
      };
    }),

  /**
   * Fix: Buy to Cover short stock (SHORT_STOCK violation)
   * Submits a market order to buy the exact number of short shares.
   */
  buyToCoverShortStock: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),
      sharesShort: z.number().int().positive(),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // CRITICAL: Block all order submission in paper trading mode
      const { getDb: _getDb2, getApiCredentials } = await import('./db');
      const _pdb2 = await _getDb2();
      if (_pdb2) {
        const { users: _u2 } = await import('../drizzle/schema.js');
        const { eq: _eq2 } = await import('drizzle-orm');
        const [_pu2] = await _pdb2.select().from(_u2).where(_eq2(_u2.id, ctx.user.id)).limit(1);
        if (_pu2?.tradingMode === 'paper') {
          const { TRPCError: _E2 } = await import('@trpc/server');
          throw new _E2({ code: 'FORBIDDEN', message: 'Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.' });
        }
      }
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);

      console.log(`[IRA Safety] BUY TO COVER: ${input.sharesShort} shares of ${input.symbol} in ${input.accountNumber} (dryRun=${input.dryRun})`);

      if (input.dryRun) {
        return {
          success: true,
          dryRun: true,
          message: `DRY RUN: Would submit market order to buy ${input.sharesShort} shares of ${input.symbol} in account ${input.accountNumber}`,
          orderId: null,
        };
      }

      // Submit a market equity order to buy the short shares
      try {
        const result = await api.submitOrder({
          accountNumber: input.accountNumber,
          timeInForce: 'Day',
          orderType: 'Market',
          legs: [
            {
              instrumentType: 'Equity',
              symbol: input.symbol,
              quantity: String(input.sharesShort),
              action: 'Buy to Open',
            },
          ],
        });
        console.log(`[IRA Safety] BUY TO COVER order submitted:`, result);

        return {
          success: true,
          dryRun: false,
          message: `Market order submitted: Buy ${input.sharesShort} shares of ${input.symbol}`,
          orderId: result?.id || null,
        };
      } catch (err: any) {
        console.error(`[IRA Safety] BUY TO COVER failed:`, err);
        throw new Error(`Failed to submit buy order: ${err.message}`);
      }
    }),

  /**
   * Fix: Close (Buy to Close) a short option position
   * Used for NAKED_SHORT_CALL, ORPHANED_SHORT_LEG, and ITM_ASSIGNMENT_RISK violations.
   */
  closeShortOption: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),           // underlying symbol (e.g. "ADBE")
      optionSymbol: z.string(),     // full OCC option symbol
      quantity: z.number().int().positive().default(1),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // CRITICAL: Block all order submission in paper trading mode
      const { getDb: _getDb2, getApiCredentials } = await import('./db');
      const _pdb2 = await _getDb2();
      if (_pdb2) {
        const { users: _u2 } = await import('../drizzle/schema.js');
        const { eq: _eq2 } = await import('drizzle-orm');
        const [_pu2] = await _pdb2.select().from(_u2).where(_eq2(_u2.id, ctx.user.id)).limit(1);
        if (_pu2?.tradingMode === 'paper') {
          const { TRPCError: _E2 } = await import('@trpc/server');
          throw new _E2({ code: 'FORBIDDEN', message: 'Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.' });
        }
      }
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);

      console.log(`[IRA Safety] CLOSE SHORT OPTION: ${input.optionSymbol} qty=${input.quantity} in ${input.accountNumber} (dryRun=${input.dryRun})`);

      if (input.dryRun) {
        return {
          success: true,
          dryRun: true,
          message: `DRY RUN: Would submit market BTC order for ${input.quantity} contract(s) of ${input.optionSymbol}`,
          orderId: null,
        };
      }

      // ── EARNINGS BLOCK PRE-FLIGHT ──────────────────────────────────────────
      try {
        const { TradierAPI } = await import('./tradier');
        const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const tradierAPI = new TradierAPI(tradierKey);
          const earningsResult = await checkEarningsBlock([input.symbol], tradierAPI);
          if (earningsResult.blocked.length > 0) {
            throw new Error(formatEarningsBlockMessage(earningsResult));
          }
        }
      } catch (earningsErr: any) {
        if (earningsErr.message?.includes('EARNINGS BLOCK')) throw earningsErr;
        console.warn('[EarningsBlock] IRA Safety earnings check failed (non-blocking):', earningsErr.message);
      }
      // ────────────────────────────────────────────────────────────────────────

      try {
        const result = await api.submitOrder({
          accountNumber: input.accountNumber,
          timeInForce: 'Day',
          orderType: 'Market',
          legs: [
            {
              instrumentType: 'Equity Option',
              symbol: input.optionSymbol,
              quantity: String(input.quantity),
              action: 'Buy to Close',
            },
          ],
        });
        console.log(`[IRA Safety] CLOSE SHORT OPTION order submitted:`, result);

        return {
          success: true,
          dryRun: false,
          message: `Market BTC order submitted for ${input.quantity} contract(s) of ${input.optionSymbol}`,
          orderId: result?.id || null,
        };
      } catch (err: any) {
        console.error(`[IRA Safety] CLOSE SHORT OPTION failed:`, err);
        throw new Error(`Failed to submit close order: ${err.message}`);
      }
    }),

  /**
   * Fix: Buy a protective put to restore spread protection for an orphaned short put.
   * Buys a lower-strike put at the same expiration to convert the naked short put
   * back into a Bull Put Spread.
   */
  buyProtectivePut: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),
      shortStrike: z.number(),
      expiration: z.string(),   // YYYY-MM-DD
      quantity: z.number().int().positive().default(1),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // CRITICAL: Block all order submission in paper trading mode
      const { getDb: _getDb2, getApiCredentials } = await import('./db');
      const _pdb2 = await _getDb2();
      if (_pdb2) {
        const { users: _u2 } = await import('../drizzle/schema.js');
        const { eq: _eq2 } = await import('drizzle-orm');
        const [_pu2] = await _pdb2.select().from(_u2).where(_eq2(_u2.id, ctx.user.id)).limit(1);
        if (_pu2?.tradingMode === 'paper') {
          const { TRPCError: _E2 } = await import('@trpc/server');
          throw new _E2({ code: 'FORBIDDEN', message: 'Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.' });
        }
      }
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // Protective put strike: 5% below short strike, rounded to nearest $2.50
      const rawProtectiveStrike = input.shortStrike * 0.95;
      const protectiveStrike = Math.round(rawProtectiveStrike / 2.5) * 2.5;

      // Build OCC symbol: SYMBOL(6) + YYMMDD + P + strike*1000 (8 digits)
      const expParts = input.expiration.replace(/-/g, '').slice(2); // YYMMDD
      const strikeFormatted = String(Math.round(protectiveStrike * 1000)).padStart(8, '0');
      const underlyingPadded = input.symbol.padEnd(6, ' ');
      const protectivePutSymbol = `${underlyingPadded}${expParts}P${strikeFormatted}`;

      console.log(`[IRA Safety] BUY PROTECTIVE PUT: ${protectivePutSymbol} qty=${input.quantity} in ${input.accountNumber} (dryRun=${input.dryRun})`);

      if (input.dryRun) {
        return {
          success: true, dryRun: true, protectiveStrike, protectivePutSymbol,
          message: `DRY RUN: Would buy ${input.quantity} contract(s) of $${protectiveStrike} put to restore spread protection on ${input.symbol}`,
          orderId: null,
        };
      }

      try {
        const result = await api.submitOrder({
          accountNumber: input.accountNumber,
          timeInForce: 'Day',
          orderType: 'Market',
          legs: [{ instrumentType: 'Equity Option', symbol: protectivePutSymbol, quantity: String(input.quantity), action: 'Buy to Open' }],
        });
        return {
          success: true, dryRun: false, protectiveStrike, protectivePutSymbol,
          message: `Market order submitted: Buy ${input.quantity}x $${protectiveStrike} put to restore protection on ${input.symbol}`,
          orderId: result?.id || null,
        };
      } catch (err: any) {
        throw new Error(`Failed to submit protective put order: ${err.message}`);
      }
    }),

  /**
   * Fix: Buy a long call to convert a naked short call into a Bear Call Spread.
   * Buys a higher-strike call at the same expiration.
   */
  buyLongCall: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),
      shortStrike: z.number(),
      expiration: z.string(),   // YYYY-MM-DD
      quantity: z.number().int().positive().default(1),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // CRITICAL: Block all order submission in paper trading mode
      const { getDb: _getDb2, getApiCredentials } = await import('./db');
      const _pdb2 = await _getDb2();
      if (_pdb2) {
        const { users: _u2 } = await import('../drizzle/schema.js');
        const { eq: _eq2 } = await import('drizzle-orm');
        const [_pu2] = await _pdb2.select().from(_u2).where(_eq2(_u2.id, ctx.user.id)).limit(1);
        if (_pu2?.tradingMode === 'paper') {
          const { TRPCError: _E2 } = await import('@trpc/server');
          throw new _E2({ code: 'FORBIDDEN', message: 'Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.' });
        }
      }
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // Long call strike: 5% above short strike, rounded to nearest $2.50
      const rawLongStrike = input.shortStrike * 1.05;
      const longStrike = Math.round(rawLongStrike / 2.5) * 2.5;

      // Build OCC symbol: SYMBOL(6) + YYMMDD + C + strike*1000 (8 digits)
      const expParts = input.expiration.replace(/-/g, '').slice(2);
      const strikeFormatted = String(Math.round(longStrike * 1000)).padStart(8, '0');
      const underlyingPadded = input.symbol.padEnd(6, ' ');
      const longCallSymbol = `${underlyingPadded}${expParts}C${strikeFormatted}`;

      console.log(`[IRA Safety] BUY LONG CALL: ${longCallSymbol} qty=${input.quantity} in ${input.accountNumber} (dryRun=${input.dryRun})`);

      if (input.dryRun) {
        return {
          success: true, dryRun: true, longStrike, longCallSymbol,
          message: `DRY RUN: Would buy ${input.quantity} contract(s) of $${longStrike} call to convert naked short call into a Bear Call Spread on ${input.symbol}`,
          orderId: null,
        };
      }

      try {
        const result = await api.submitOrder({
          accountNumber: input.accountNumber,
          timeInForce: 'Day',
          orderType: 'Market',
          legs: [{ instrumentType: 'Equity Option', symbol: longCallSymbol, quantity: String(input.quantity), action: 'Buy to Open' }],
        });
        return {
          success: true, dryRun: false, longStrike, longCallSymbol,
          message: `Market order submitted: Buy ${input.quantity}x $${longStrike} call to create Bear Call Spread on ${input.symbol}`,
          orderId: result?.id || null,
        };
      } catch (err: any) {
        throw new Error(`Failed to submit long call order: ${err.message}`);
      }
    }),
});
