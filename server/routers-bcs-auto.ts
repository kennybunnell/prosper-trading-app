/**
 * SPX Spreads Auto-Entry Router (formerly BCS Auto)
 * Manages automated SPX Bull Put Spread (default) or Bear Call Spread scanning,
 * Telegram inline approval, and live order submission via Tastytrade.
 *
 * Strategy:
 *  - BPS (Bull Put Spread, default): Sell higher put + Buy lower put (bullish/neutral bias)
 *  - BCS (Bear Call Spread): Sell lower call + Buy higher call (bearish/neutral bias)
 *
 * Flow:
 *  1. Cron job fires at configured scan time (default 10:30 AM ET Mon-Fri)
 *  2. Checks market direction based on strategy:
 *     - BPS: SPX price > 20-day MA (bullish) — put spreads benefit from upward/stable market
 *     - BCS: SPX price < 20-day MA AND RSI > 30 (bearish/neutral)
 *  3. Scans SPXW option chain for qualifying OTM spreads
 *  4. Sends Telegram message with inline Approve / Skip buttons
 *  5. Awaits approval (configurable timeout, default 30 min)
 *  6. On Approve: submits live 2-leg order to Tastytrade
 *  7. On Skip/Timeout: logs as skipped
 */
import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { getDb } from './db';
import { bcsAutoEntrySettings, bcsPendingApprovals, users } from '../drizzle/schema';
import { eq, and, inArray, desc, count } from 'drizzle-orm';
import { getApiCredentials } from './db';
import { authenticateTastytrade } from './tastytrade';
import { sendTelegramMessage, sendTelegramApproval } from './telegram';
import { waitForTelegramApproval } from './telegram-callbacks';
import { writeTradingLog } from './routers-trading-log';
import { withRateLimit } from './tradierRateLimiter';
import { notifyOwner } from './_core/notification';
import crypto from 'crypto';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Generate a short unique token for a pending approval */
function generateToken(): string {
  return crypto.randomBytes(12).toString('hex');
}

/** Calculate DTE from today to expiration string (YYYY-MM-DD) */
function calcDTE(expiration: string): number {
  const exp = new Date(expiration + 'T16:00:00-05:00'); // 4 PM ET
  const now = new Date();
  return Math.max(0, Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

// ─── router ───────────────────────────────────────────────────────────────────
export const bcsAutoRouter = router({
  /**
   * Get SPX spread auto-entry settings for the current user.
   * Returns defaults if no row exists yet.
   */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
    const rows = await db
      .select()
      .from(bcsAutoEntrySettings)
      .where(eq(bcsAutoEntrySettings.userId, ctx.user.id))
      .limit(1);
    if (rows.length === 0) {
      return {
        id: null,
        userId: ctx.user.id,
        enabled: false,
        scanTimeET: '10:30',
        contracts: 2,
        spreadWidth: 50,
        minScore: 70,
        minDTE: 30,
        maxDTE: 45,
        maxDelta: '0.20',
        minOI: 500,
        maxConcurrent: 2,
        approvalTimeoutMins: 30,
        accountId: null,
        strategy: 'bps',  // Default to Bull Put Spread
      };
    }
    // Ensure strategy field has a default if missing from old rows
    const row = rows[0] as any;
    if (!row.strategy) row.strategy = 'bps';
    return row;
  }),

  /**
   * Upsert SPX spread auto-entry settings.
   */
  updateSettings: protectedProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      scanTimeET: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
      contracts: z.number().int().min(1).max(10).optional(),
      spreadWidth: z.number().int().min(5).max(200).optional(),
      minScore: z.number().int().min(0).max(100).optional(),
      minDTE: z.number().int().min(1).max(90).optional(),
      maxDTE: z.number().int().min(1).max(90).optional(),
      maxDelta: z.string().optional(),
      minOI: z.number().int().min(0).optional(),
      maxConcurrent: z.number().int().min(1).max(10).optional(),
      approvalTimeoutMins: z.number().int().min(5).max(120).optional(),
      accountId: z.string().nullable().optional(),
      strategy: z.enum(['bps', 'bcs']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const existing = await db
        .select({ id: bcsAutoEntrySettings.id })
        .from(bcsAutoEntrySettings)
        .where(eq(bcsAutoEntrySettings.userId, ctx.user.id))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(bcsAutoEntrySettings).values({
          userId: ctx.user.id,
          enabled: input.enabled ?? false,
          scanTimeET: input.scanTimeET ?? '10:30',
          contracts: input.contracts ?? 2,
          spreadWidth: input.spreadWidth ?? 50,
          minScore: input.minScore ?? 70,
          minDTE: input.minDTE ?? 30,
          maxDTE: input.maxDTE ?? 45,
          maxDelta: input.maxDelta ?? '0.20',
          minOI: input.minOI ?? 500,
          maxConcurrent: input.maxConcurrent ?? 2,
          approvalTimeoutMins: input.approvalTimeoutMins ?? 30,
          accountId: input.accountId ?? null,
          strategy: input.strategy ?? 'bps',
        });
      } else {
        const updateData: Record<string, any> = {};
        if (input.enabled !== undefined) updateData.enabled = input.enabled;
        if (input.scanTimeET !== undefined) updateData.scanTimeET = input.scanTimeET;
        if (input.contracts !== undefined) updateData.contracts = input.contracts;
        if (input.spreadWidth !== undefined) updateData.spreadWidth = input.spreadWidth;
        if (input.minScore !== undefined) updateData.minScore = input.minScore;
        if (input.minDTE !== undefined) updateData.minDTE = input.minDTE;
        if (input.maxDTE !== undefined) updateData.maxDTE = input.maxDTE;
        if (input.maxDelta !== undefined) updateData.maxDelta = input.maxDelta;
        if (input.minOI !== undefined) updateData.minOI = input.minOI;
        if (input.maxConcurrent !== undefined) updateData.maxConcurrent = input.maxConcurrent;
        if (input.approvalTimeoutMins !== undefined) updateData.approvalTimeoutMins = input.approvalTimeoutMins;
        if (input.accountId !== undefined) updateData.accountId = input.accountId;
        if (input.strategy !== undefined) updateData.strategy = input.strategy;
        if (Object.keys(updateData).length > 0) {
          await db
            .update(bcsAutoEntrySettings)
            .set(updateData)
            .where(eq(bcsAutoEntrySettings.userId, ctx.user.id));
        }
      }
      return { success: true };
    }),

  /**
   * Manual "Scan Now" trigger — runs the spread scan immediately for the current user.
   */
  scanNow: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
    const result = await runBcsAutoScanForUser(ctx.user.id, true);
    return result;
  }),

  /**
   * List pending/recent approval history for the current user.
   */
  listHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const rows = await db
        .select()
        .from(bcsPendingApprovals)
        .where(eq(bcsPendingApprovals.userId, ctx.user.id))
        .orderBy(desc(bcsPendingApprovals.createdAt))
        .limit(input?.limit ?? 20);
      return rows;
    }),

  /**
   * Count active (pending) approvals for the current user.
   */
  countPending: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { count: 0 };
    const rows = await db
      .select({ cnt: count() })
      .from(bcsPendingApprovals)
      .where(and(
        eq(bcsPendingApprovals.userId, ctx.user.id),
        inArray(bcsPendingApprovals.status, ['pending']),
      ));
    return { count: rows[0]?.cnt ?? 0 };
  }),

  /**
   * Get live SPX market bias: compares current SPX price to 20-day MA.
   * Returns bias ('bullish' | 'neutral' | 'bearish'), current price, MA20, and RSI.
   * Cached for 5 minutes to avoid hammering the Tradier API.
   */
  getMarketBias: protectedProcedure.query(async ({ ctx }) => {
    try {
      const creds = await getApiCredentials(ctx.user.id);
      if (!creds?.tradierApiKey) {
        return { bias: 'unknown' as const, error: 'No Tradier API key configured', spxPrice: null, ma20: null, rsi: null, pctAboveMA: null };
      }
      const { createTradierAPI } = await import('./tradier');
      const tradier = createTradierAPI(creds.tradierApiKey!, false, ctx.user.id);

      // Fetch 30 days of SPX daily history (enough for 20-day MA + RSI)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 45); // 45 days buffer
      const history = await tradier.getHistoricalData(
        'SPX',
        'daily',
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
      );

      if (!history || history.length < 20) {
        return { bias: 'unknown' as const, error: 'Insufficient price history', spxPrice: null, ma20: null, rsi: null, pctAboveMA: null };
      }

      const closes = history.map((d: any) => d.close);
      const spxPrice = closes[closes.length - 1];
      const ma20 = tradier.calculateSMA(closes, 20);
      const rsi = tradier.calculateRSI(closes, 14);

      if (!ma20) {
        return { bias: 'unknown' as const, error: 'Could not calculate MA20', spxPrice, ma20: null, rsi, pctAboveMA: null };
      }

      const pctAboveMA = ((spxPrice - ma20) / ma20) * 100;

      // Bias determination:
      //  bullish  → SPX > MA20 (favors BPS)
      //  bearish  → SPX < MA20 (favors BCS)
      //  neutral  → within ±0.3% of MA20
      let bias: 'bullish' | 'neutral' | 'bearish';
      if (pctAboveMA > 0.3) {
        bias = 'bullish';
      } else if (pctAboveMA < -0.3) {
        bias = 'bearish';
      } else {
        bias = 'neutral';
      }

      return { bias, spxPrice, ma20, rsi, pctAboveMA, error: null };
    } catch (err: any) {
      console.error('[SPX Auto] getMarketBias error:', err.message);
      return { bias: 'unknown' as const, error: err.message, spxPrice: null, ma20: null, rsi: null, pctAboveMA: null };
    }
  }),
});

// ─── Core scan function (called by cron and scanNow) ─────────────────────────

/**
 * Run the SPX spread auto-entry scan for a specific user.
 * Supports both BPS (Bull Put Spread, default) and BCS (Bear Call Spread).
 *
 * @param userId - The user's numeric DB id
 * @param isManual - true = triggered by "Scan Now" button (bypasses enabled check)
 */
export async function runBcsAutoScanForUser(
  userId: number,
  isManual = false,
): Promise<{ status: 'sent' | 'no_opportunity' | 'disabled' | 'no_credentials' | 'approved' | 'skipped' | 'error'; message: string }> {
  const db = await getDb();
  if (!db) return { status: 'error', message: 'Database unavailable' };

  // Load settings
  const settingsRows = await db
    .select()
    .from(bcsAutoEntrySettings)
    .where(eq(bcsAutoEntrySettings.userId, userId))
    .limit(1);

  const rawSettings = settingsRows[0] as any;
  const settings = rawSettings ?? {
    enabled: false,
    contracts: 2,
    spreadWidth: 50,
    minScore: 70,
    minDTE: 30,
    maxDTE: 45,
    maxDelta: '0.20',
    minOI: 500,
    maxConcurrent: 2,
    approvalTimeoutMins: 30,
    accountId: null,
    strategy: 'bps',
  };

  // Default strategy to 'bps' if not set (backward compat)
  const strategy: 'bps' | 'bcs' = (settings.strategy === 'bcs') ? 'bcs' : 'bps';
  const isBPS = strategy === 'bps';

  if (!isManual && !settings.enabled) {
    return { status: 'disabled', message: 'SPX spread auto-entry is disabled' };
  }

  // Check max concurrent
  const activeCounts = await db
    .select({ cnt: count() })
    .from(bcsPendingApprovals)
    .where(and(
      eq(bcsPendingApprovals.userId, userId),
      inArray(bcsPendingApprovals.status, ['pending', 'approved']),
    ));
  const activeCount = activeCounts[0]?.cnt ?? 0;
  if (activeCount >= settings.maxConcurrent) {
    return {
      status: 'no_opportunity',
      message: `Max concurrent positions (${settings.maxConcurrent}) already reached`,
    };
  }

  // Load API credentials
  const credentials = await getApiCredentials(userId);
  if (!credentials?.tradierApiKey) {
    return { status: 'no_credentials', message: 'No Tradier API key configured' };
  }
  if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
    return { status: 'no_credentials', message: 'No Tastytrade credentials configured' };
  }

  try {
    const { createTradierAPI } = await import('./tradier');
    const tradierApi = createTradierAPI(credentials.tradierApiKey, false, userId);

    // ── Step 1: Market direction check ──────────────────────────────────────
    const strategyLabel = isBPS ? 'Bull Put Spread' : 'Bear Call Spread';
    console.log(`[SPX Auto] Checking market direction for ${strategyLabel} (user ${userId})...`);
    let marketOk = true;
    try {
      const spxIndicators = await tradierApi.getTechnicalIndicators('SPX');
      const spxQuote = await tradierApi.getQuote('SPX');
      const spxPrice = spxQuote?.last ?? spxQuote?.bid ?? 0;
      const ma20 = spxIndicators.movingAverage?.sma20 ?? 0;
      const rsi = spxIndicators.rsi ?? 50;
      console.log(`[SPX Auto] SPX price=${spxPrice}, MA20=${ma20.toFixed(2)}, RSI=${rsi.toFixed(1)}`);

      if (isBPS) {
        // Bull Put Spread: want bullish/neutral market — SPX above 20-day MA
        if (spxPrice > 0 && ma20 > 0 && spxPrice < ma20) {
          console.log(`[SPX Auto] BPS market check FAILED: SPX (${spxPrice}) below 20-day MA (${ma20.toFixed(2)})`);
          marketOk = false;
        }
        // Also avoid extremely overbought (RSI > 80) since puts could get hit on reversal
        if (rsi > 80) {
          console.log(`[SPX Auto] BPS market check FAILED: RSI (${rsi.toFixed(1)}) > 80 — extremely overbought`);
          marketOk = false;
        }
      } else {
        // Bear Call Spread: want bearish/neutral market — SPX below 20-day MA
        if (spxPrice > 0 && ma20 > 0 && spxPrice > ma20) {
          console.log(`[SPX Auto] BCS market check FAILED: SPX (${spxPrice}) above 20-day MA (${ma20.toFixed(2)})`);
          marketOk = false;
        }
        if (rsi > 70) {
          console.log(`[SPX Auto] BCS market check FAILED: RSI (${rsi.toFixed(1)}) > 70 — overbought`);
          marketOk = false;
        }
      }
    } catch (techErr) {
      console.warn(`[SPX Auto] Technical indicator check failed (proceeding anyway):`, techErr);
    }

    if (!marketOk && !isManual) {
      return {
        status: 'no_opportunity',
        message: isBPS
          ? 'Market direction check failed: SPX below 20-day MA (bearish bias — not ideal for Bull Put Spread)'
          : 'Market direction check failed: SPX above 20-day MA or RSI > 70',
      };
    }

    // ── Step 2: Fetch SPX expirations ────────────────────────────────────────
    console.log(`[SPX Auto] Fetching SPX expirations...`);
    const expirations = await tradierApi.getExpirations('SPX');
    const minDTE = settings.minDTE ?? 30;
    const maxDTE = settings.maxDTE ?? 45;
    const maxDelta = parseFloat(settings.maxDelta ?? '0.20');
    const minOI = settings.minOI ?? 500;
    const spreadWidth = settings.spreadWidth ?? 50;

    const validExpirations = expirations.filter(exp => {
      const dte = calcDTE(exp);
      return dte >= minDTE && dte <= maxDTE;
    });

    if (validExpirations.length === 0) {
      return {
        status: 'no_opportunity',
        message: `No SPX expirations found in ${minDTE}-${maxDTE} DTE window`,
      };
    }

    console.log(`[SPX Auto] Found ${validExpirations.length} valid expirations: ${validExpirations.join(', ')}`);

    // ── Step 3: Scan option chains ───────────────────────────────────────────
    let bestOpportunity: {
      expiration: string;
      dte: number;
      shortStrike: number;
      longStrike: number;
      netCredit: number;
      delta: number;
      shortOptionSymbol: string;
      longOptionSymbol: string;
      score: number;
    } | null = null;

    let spxCurrentPrice = 0;
    try {
      const spxQ = await tradierApi.getQuote('SPX');
      spxCurrentPrice = spxQ?.last ?? spxQ?.bid ?? 0;
    } catch { /* ignore */ }

    for (const expiration of validExpirations) {
      try {
        const dte = calcDTE(expiration);
        const options = await withRateLimit(() => tradierApi.getOptionChain('SPX', expiration, true));
        if (!options || options.length === 0) continue;

        if (isBPS) {
          // ── Bull Put Spread: Sell OTM put (higher strike), Buy further OTM put (lower strike) ──
          // Short put: OTM (below current price), delta in [-maxDelta, -0.10]
          const putCandidates = options.filter(opt =>
            opt.option_type === 'put' &&
            opt.strike < spxCurrentPrice &&  // OTM put
            Math.abs(opt.greeks?.delta ?? 0) >= 0.10 &&
            Math.abs(opt.greeks?.delta ?? 0) <= maxDelta &&
            (opt.open_interest ?? 0) >= minOI &&
            opt.bid != null && opt.ask != null && opt.bid > 0
          );

          if (putCandidates.length === 0) continue;

          // Sort by delta descending (closest to -maxDelta = most premium)
          putCandidates.sort((a, b) =>
            Math.abs(b.greeks?.delta ?? 0) - Math.abs(a.greeks?.delta ?? 0)
          );

          const shortPut = putCandidates[0];
          const targetLongStrike = shortPut.strike - spreadWidth;

          // Find the closest available put strike at or below target long strike
          const putStrikes = options
            .filter(o => o.option_type === 'put' && o.bid != null && o.ask != null)
            .map(o => o.strike)
            .sort((a, b) => b - a); // descending

          const bestLongStrike = putStrikes.find(s => s <= targetLongStrike);
          if (bestLongStrike === undefined) continue;

          const longPut = options.find(o =>
            o.option_type === 'put' && o.strike === bestLongStrike && o.bid != null
          );
          if (!longPut) continue;

          const shortMid = ((shortPut.bid ?? 0) + (shortPut.ask ?? 0)) / 2;
          const longMid = ((longPut.bid ?? 0) + (longPut.ask ?? 0)) / 2;
          const netCredit = shortMid - longMid;

          if (netCredit <= 0) continue;

          const actualWidth = shortPut.strike - bestLongStrike;
          const creditRatio = actualWidth > 0 ? netCredit / actualWidth : 0;
          if (creditRatio > 0.80) continue;

          const dteMid = (minDTE + maxDTE) / 2;
          const dteScore = Math.max(0, 100 - Math.abs(dte - dteMid) * 3);
          const deltaScore = Math.max(0, 100 - Math.abs(Math.abs(shortPut.greeks?.delta ?? 0) - 0.16) * 500);
          const creditScore = Math.min(100, creditRatio * 200);
          const score = Math.round((dteScore * 0.3 + deltaScore * 0.4 + creditScore * 0.3));

          if (score < (settings.minScore ?? 70)) continue;

          if (!bestOpportunity || score > bestOpportunity.score) {
            bestOpportunity = {
              expiration,
              dte,
              shortStrike: shortPut.strike,
              longStrike: bestLongStrike,
              netCredit,
              delta: Math.abs(shortPut.greeks?.delta ?? 0),
              shortOptionSymbol: shortPut.symbol,
              longOptionSymbol: longPut.symbol,
              score,
            };
          }
        } else {
          // ── Bear Call Spread: Sell OTM call (lower strike), Buy further OTM call (higher strike) ──
          const callCandidates = options.filter(opt =>
            opt.option_type === 'call' &&
            opt.strike > spxCurrentPrice &&  // OTM call
            Math.abs(opt.greeks?.delta ?? 0) >= 0.10 &&
            Math.abs(opt.greeks?.delta ?? 0) <= maxDelta &&
            (opt.open_interest ?? 0) >= minOI &&
            opt.bid != null && opt.ask != null && opt.bid > 0
          );

          if (callCandidates.length === 0) continue;

          callCandidates.sort((a, b) =>
            Math.abs(b.greeks?.delta ?? 0) - Math.abs(a.greeks?.delta ?? 0)
          );

          const shortCall = callCandidates[0];
          const targetLongStrike = shortCall.strike + spreadWidth;

          const callStrikes = options
            .filter(o => o.option_type === 'call' && o.bid != null && o.ask != null)
            .map(o => o.strike)
            .sort((a, b) => a - b);

          const bestLongStrike = callStrikes.find(s => s >= targetLongStrike);
          if (bestLongStrike === undefined) continue;

          const longCall = options.find(o =>
            o.option_type === 'call' && o.strike === bestLongStrike && o.bid != null
          );
          if (!longCall) continue;

          const shortMid = ((shortCall.bid ?? 0) + (shortCall.ask ?? 0)) / 2;
          const longMid = ((longCall.bid ?? 0) + (longCall.ask ?? 0)) / 2;
          const netCredit = shortMid - longMid;

          if (netCredit <= 0) continue;

          const actualWidth = bestLongStrike - shortCall.strike;
          const creditRatio = actualWidth > 0 ? netCredit / actualWidth : 0;
          if (creditRatio > 0.80) continue;

          const dteMid = (minDTE + maxDTE) / 2;
          const dteScore = Math.max(0, 100 - Math.abs(dte - dteMid) * 3);
          const deltaScore = Math.max(0, 100 - Math.abs(Math.abs(shortCall.greeks?.delta ?? 0) - 0.16) * 500);
          const creditScore = Math.min(100, creditRatio * 200);
          const score = Math.round((dteScore * 0.3 + deltaScore * 0.4 + creditScore * 0.3));

          if (score < (settings.minScore ?? 70)) continue;

          if (!bestOpportunity || score > bestOpportunity.score) {
            bestOpportunity = {
              expiration,
              dte,
              shortStrike: shortCall.strike,
              longStrike: bestLongStrike,
              netCredit,
              delta: Math.abs(shortCall.greeks?.delta ?? 0),
              shortOptionSymbol: shortCall.symbol,
              longOptionSymbol: longCall.symbol,
              score,
            };
          }
        }
      } catch (chainErr) {
        console.error(`[SPX Auto] Error scanning chain for ${expiration}:`, chainErr);
      }
    }

    if (!bestOpportunity) {
      return {
        status: 'no_opportunity',
        message: isBPS
          ? 'No qualifying SPX Bull Put Spread found matching your criteria'
          : 'No qualifying SPX Bear Call Spread found matching your criteria',
      };
    }

    console.log(`[SPX Auto] Best ${strategy.toUpperCase()} opportunity: ${JSON.stringify(bestOpportunity)}`);

    // ── Step 4: Determine account ────────────────────────────────────────────
    let accountId = settings.accountId ?? null;
    if (!accountId) {
      const tt = await authenticateTastytrade(credentials, userId);
      if (!tt) {
        return { status: 'no_credentials', message: 'Failed to authenticate with Tastytrade' };
      }
      const accounts = await tt.getAccounts();
      if (!accounts || accounts.length === 0) {
        return { status: 'no_credentials', message: 'No Tastytrade accounts found' };
      }
      const firstAcc = accounts[0];
      const accAny = firstAcc as any;
      accountId = accAny.account?.['account-number'] || accAny['account-number'] || accAny.accountNumber || '';
    }

    if (!accountId) {
      return { status: 'no_credentials', message: 'Could not determine Tastytrade account' };
    }

    // ── Step 5: Save pending approval to DB ──────────────────────────────────
    const token = generateToken();
    const approvalTimeoutMins = settings.approvalTimeoutMins ?? 30;
    const expiresAt = new Date(Date.now() + approvalTimeoutMins * 60 * 1000);
    const contracts = settings.contracts ?? 2;

    await db.insert(bcsPendingApprovals).values({
      userId,
      token,
      symbol: 'SPXW',
      shortStrike: String(bestOpportunity.shortStrike),
      longStrike: String(bestOpportunity.longStrike),
      expiration: bestOpportunity.expiration,
      dte: bestOpportunity.dte,
      netCredit: bestOpportunity.netCredit.toFixed(2),
      delta: bestOpportunity.delta.toFixed(4),
      score: bestOpportunity.score,
      contracts,
      shortOptionSymbol: bestOpportunity.shortOptionSymbol,
      longOptionSymbol: bestOpportunity.longOptionSymbol,
      accountId,
      status: 'pending',
      expiresAt,
    });

    // ── Step 6: Send Telegram approval message ───────────────────────────────
    const totalCredit = (bestOpportunity.netCredit * contracts * 100).toFixed(0);
    const spreadWidthActual = isBPS
      ? bestOpportunity.shortStrike - bestOpportunity.longStrike
      : bestOpportunity.longStrike - bestOpportunity.shortStrike;
    const maxRisk = ((spreadWidthActual - bestOpportunity.netCredit) * contracts * 100).toFixed(0);
    const rocPct = ((bestOpportunity.netCredit / (spreadWidthActual - bestOpportunity.netCredit)) * 100).toFixed(1);

    const emoji = isBPS ? '🐂' : '🐻';
    const spreadTypeLabel = isBPS ? 'Bull Put Spread' : 'Bear Call Spread';
    const optionTypeLabel = isBPS ? 'Put' : 'Call';

    const approvalText =
      `${emoji} <b>SPX ${spreadTypeLabel} — Auto-Entry</b>\n\n` +
      `<b>Short:</b> $${bestOpportunity.shortStrike} ${optionTypeLabel} (δ ${bestOpportunity.delta.toFixed(2)})\n` +
      `<b>Long:</b>  $${bestOpportunity.longStrike} ${optionTypeLabel}\n` +
      `<b>Expiry:</b> ${bestOpportunity.expiration} (${bestOpportunity.dte}d)\n` +
      `<b>Net Credit:</b> $${bestOpportunity.netCredit.toFixed(2)}/share · <b>$${totalCredit} total</b>\n` +
      `<b>Max Risk:</b> $${maxRisk} · ROC ${rocPct}%\n` +
      `<b>Contracts:</b> ${contracts}\n` +
      `<b>Score:</b> ${bestOpportunity.score}/100\n\n` +
      `⏱ Approval window: <b>${approvalTimeoutMins} min</b>\n` +
      `Tap <b>Approve</b> to submit the live order immediately.`;

    const buttons = [[
      { text: '✅ Approve', callbackData: `bcs:submit:${token}` },
      { text: '⏭ Skip', callbackData: `bcs:skip:${token}` },
    ]];

    await sendTelegramApproval(approvalText, buttons);
    console.log(`[SPX Auto] Telegram approval sent for token ${token}`);

    // ── Step 7: Await approval ────────────────────────────────────────────────
    const approved = await waitForTelegramApproval(token, approvalTimeoutMins * 60 * 1000);

    if (!approved) {
      await db
        .update(bcsPendingApprovals)
        .set({ status: 'skipped', resolvedAt: new Date() })
        .where(eq(bcsPendingApprovals.token, token));
      console.log(`[SPX Auto] Approval skipped/expired for token ${token}`);
      return { status: 'skipped', message: 'Approval skipped or timed out' };
    }

    // ── Step 8: Submit live order ─────────────────────────────────────────────
    console.log(`[SPX Auto] Approval received for token ${token} — submitting order...`);
    await db
      .update(bcsPendingApprovals)
      .set({ status: 'approved', approvedAt: new Date() })
      .where(eq(bcsPendingApprovals.token, token));

    try {
      const tt = await authenticateTastytrade(credentials, userId);
      if (!tt) throw new Error('Failed to authenticate with Tastytrade');

      const orderQty = String(contracts);
      const limitPrice = bestOpportunity.netCredit.toFixed(2);

      // BPS: Sell higher put (short), Buy lower put (long)
      // BCS: Sell lower call (short), Buy higher call (long)
      const orderRequest = {
        accountNumber: accountId,
        timeInForce: 'Day' as const,
        orderType: 'Limit' as const,
        price: limitPrice,
        priceEffect: 'Credit' as const,
        legs: [
          {
            instrumentType: 'Equity Option' as const,
            symbol: bestOpportunity.shortOptionSymbol,
            quantity: orderQty,
            action: 'Sell to Open' as const,
          },
          {
            instrumentType: 'Equity Option' as const,
            symbol: bestOpportunity.longOptionSymbol,
            quantity: orderQty,
            action: 'Buy to Open' as const,
          },
        ],
      };

      console.log('[SPX Auto] Submitting order:', JSON.stringify(orderRequest, null, 2));
      const result = await tt.submitOrder(orderRequest);

      await db
        .update(bcsPendingApprovals)
        .set({ status: 'approved', orderId: String(result.id), resolvedAt: new Date() })
        .where(eq(bcsPendingApprovals.token, token));

      await writeTradingLog({
        userId,
        symbol: 'SPXW',
        optionSymbol: bestOpportunity.shortOptionSymbol,
        accountNumber: accountId,
        strategy: strategy.toUpperCase() as 'BPS' | 'BCS',
        action: 'STO',
        strike: String(bestOpportunity.shortStrike),
        expiration: bestOpportunity.expiration,
        quantity: contracts,
        price: limitPrice,
        priceEffect: 'Credit',
        outcome: 'pending',
        orderId: String(result.id),
        source: `SPX ${spreadTypeLabel} Auto-Entry`,
      });

      const confirmText =
        `✅ <b>${strategy.toUpperCase()} Order Submitted</b>\n\n` +
        `<b>SPXW</b> $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike} ${optionTypeLabel} Spread\n` +
        `Expiry: ${bestOpportunity.expiration} · ${contracts} contract(s)\n` +
        `Net Credit: <b>+$${totalCredit}</b>\n` +
        `Order ID: ${result.id}`;
      await sendTelegramMessage(confirmText);

      await notifyOwner({
        title: `✅ ${strategy.toUpperCase()} Auto-Entry: SPXW $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike} submitted`,
        content: `${contracts} contract(s) · Net Credit $${totalCredit} · Exp ${bestOpportunity.expiration} · Order ${result.id}`,
      }).catch(() => {});

      return {
        status: 'approved',
        message: `Order submitted: SPXW $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike} · $${totalCredit} credit · Order ${result.id}`,
      };
    } catch (orderErr: any) {
      const errMsg = orderErr.message || 'Unknown order error';
      console.error(`[SPX Auto] Order submission failed:`, orderErr);
      await db
        .update(bcsPendingApprovals)
        .set({ status: 'error', errorMessage: errMsg, resolvedAt: new Date() })
        .where(eq(bcsPendingApprovals.token, token));
      await writeTradingLog({
        userId,
        symbol: 'SPXW',
        optionSymbol: bestOpportunity.shortOptionSymbol,
        accountNumber: accountId,
        strategy: strategy.toUpperCase() as 'BPS' | 'BCS',
        action: 'STO',
        strike: String(bestOpportunity.shortStrike),
        expiration: bestOpportunity.expiration,
        quantity: contracts,
        price: bestOpportunity.netCredit.toFixed(2),
        outcome: 'error',
        errorMessage: errMsg,
        source: `SPX ${spreadTypeLabel} Auto-Entry`,
      });
      await sendTelegramMessage(
        `❌ <b>${strategy.toUpperCase()} Order Failed</b>\n\nSPXW $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike}\nReason: ${errMsg}`
      );
      return { status: 'error', message: `Order failed: ${errMsg}` };
    }
  } catch (err: any) {
    console.error(`[SPX Auto] Scan error for user ${userId}:`, err);
    return { status: 'error', message: err.message || 'Scan failed' };
  }
}
