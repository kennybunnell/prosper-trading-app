/**
 * BCS Auto-Entry Router
 * Manages automated SPX Bear Call Spread scanning, Telegram inline approval,
 * and live order submission via Tastytrade.
 *
 * Flow:
 *  1. Cron job fires at configured scan time (default 10:30 AM ET Mon-Fri)
 *  2. Checks market direction: SPX price > 20-day MA AND RSI < 70 (neutral/bullish bias)
 *  3. Scans SPXW option chain for qualifying OTM call spreads
 *  4. Sends Telegram message with inline Approve / Skip buttons
 *  5. Awaits approval (configurable timeout, default 30 min)
 *  6. On Approve: submits live 2-leg BCS order to Tastytrade
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

/** Format a date as YYYY-MM-DD */
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
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
   * Get BCS auto-entry settings for the current user.
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
      // Return defaults — no DB row yet
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
      };
    }
    return rows[0];
  }),

  /**
   * Upsert BCS auto-entry settings.
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
   * Manual "Scan Now" trigger — runs the BCS scan immediately for the current user.
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
});

// ─── Core scan function (called by cron and scanNow) ─────────────────────────

/**
 * Run the BCS auto-entry scan for a specific user.
 * Finds the best qualifying SPX Bear Call Spread, sends Telegram approval,
 * and submits the order on approval.
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

  const settings = settingsRows[0] ?? {
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
  };

  if (!isManual && !settings.enabled) {
    return { status: 'disabled', message: 'BCS auto-entry is disabled' };
  }

  // Check max concurrent — count pending+approved rows that haven't been resolved
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
    // Bullish/neutral bias: SPX price > 20-day MA AND RSI < 70
    console.log(`[BCS Auto] Checking market direction for user ${userId}...`);
    let marketOk = true;
    try {
      const spxIndicators = await tradierApi.getTechnicalIndicators('SPX');
      const spxQuote = await tradierApi.getQuote('SPX');
      const spxPrice = spxQuote?.last ?? spxQuote?.bid ?? 0;
      const ma20 = spxIndicators.movingAverage?.sma20 ?? 0;
      const rsi = spxIndicators.rsi ?? 50;
      console.log(`[BCS Auto] SPX price=${spxPrice}, MA20=${ma20.toFixed(2)}, RSI=${rsi.toFixed(1)}`);
      if (spxPrice > 0 && ma20 > 0 && spxPrice < ma20) {
        console.log(`[BCS Auto] Market direction check FAILED: SPX (${spxPrice}) below 20-day MA (${ma20.toFixed(2)})`);
        marketOk = false;
      }
      if (rsi > 70) {
        console.log(`[BCS Auto] Market direction check FAILED: RSI (${rsi.toFixed(1)}) > 70 — overbought`);
        marketOk = false;
      }
    } catch (techErr) {
      console.warn(`[BCS Auto] Technical indicator check failed (proceeding anyway):`, techErr);
    }

    if (!marketOk && !isManual) {
      return {
        status: 'no_opportunity',
        message: 'Market direction check failed: SPX below 20-day MA or RSI > 70',
      };
    }

    // ── Step 2: Fetch SPXW expirations ──────────────────────────────────────
    console.log(`[BCS Auto] Fetching SPXW expirations...`);
    const expirations = await tradierApi.getExpirations('SPX');
    const minDTE = settings.minDTE ?? 30;
    const maxDTE = settings.maxDTE ?? 45;
    const maxDelta = parseFloat(settings.maxDelta ?? '0.20');
    const minOI = settings.minOI ?? 500;
    const spreadWidth = settings.spreadWidth ?? 50;

    // Filter expirations to the DTE window
    const today = new Date();
    const validExpirations = expirations.filter(exp => {
      const dte = calcDTE(exp);
      return dte >= minDTE && dte <= maxDTE;
    });

    if (validExpirations.length === 0) {
      return {
        status: 'no_opportunity',
        message: `No SPXW expirations found in ${minDTE}-${maxDTE} DTE window`,
      };
    }

    console.log(`[BCS Auto] Found ${validExpirations.length} valid expirations: ${validExpirations.join(', ')}`);

    // ── Step 3: Scan option chains for qualifying BCS ────────────────────────
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

    // Get SPX current price for context
    let spxCurrentPrice = 0;
    try {
      const spxQ = await tradierApi.getQuote('SPX');
      spxCurrentPrice = spxQ?.last ?? spxQ?.bid ?? 0;
    } catch { /* ignore */ }

    for (const expiration of validExpirations) {
      try {
        const dte = calcDTE(expiration);
        // Tradier uses 'SPX' as the root for SPXW chains
        const options = await withRateLimit(() => tradierApi.getOptionChain('SPX', expiration, true));
        if (!options || options.length === 0) continue;

        // Find OTM call candidates: delta in [0.10, maxDelta], OI >= minOI
        const callCandidates = options.filter(opt =>
          opt.option_type === 'call' &&
          opt.strike > spxCurrentPrice &&  // OTM
          Math.abs(opt.greeks?.delta ?? 0) >= 0.10 &&
          Math.abs(opt.greeks?.delta ?? 0) <= maxDelta &&
          (opt.open_interest ?? 0) >= minOI &&
          opt.bid != null && opt.ask != null && opt.bid > 0
        );

        if (callCandidates.length === 0) continue;

        // Sort by delta descending (closest to maxDelta = most premium)
        callCandidates.sort((a, b) =>
          Math.abs(b.greeks?.delta ?? 0) - Math.abs(a.greeks?.delta ?? 0)
        );

        const shortCall = callCandidates[0];
        const targetLongStrike = shortCall.strike + spreadWidth;

        // Find the closest available call strike at or above target long strike
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

        // Calculate net credit (mid prices)
        const shortMid = ((shortCall.bid ?? 0) + (shortCall.ask ?? 0)) / 2;
        const longMid = ((longCall.bid ?? 0) + (longCall.ask ?? 0)) / 2;
        const netCredit = shortMid - longMid;

        if (netCredit <= 0) continue;

        // Credit/width ratio sanity check (< 80%)
        const actualWidth = bestLongStrike - shortCall.strike;
        const creditRatio = actualWidth > 0 ? netCredit / actualWidth : 0;
        if (creditRatio > 0.80) continue;

        // Simple score: weight credit ratio + DTE proximity to midpoint + delta quality
        const dteMid = (minDTE + maxDTE) / 2;
        const dteScore = Math.max(0, 100 - Math.abs(dte - dteMid) * 3);
        const deltaScore = Math.max(0, 100 - Math.abs(Math.abs(shortCall.greeks?.delta ?? 0) - 0.16) * 500);
        const creditScore = Math.min(100, creditRatio * 200);
        const score = Math.round((dteScore * 0.3 + deltaScore * 0.4 + creditScore * 0.3));

        if (score < (settings.minScore ?? 70)) continue;

        // Keep the best opportunity (highest score)
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
      } catch (chainErr) {
        console.error(`[BCS Auto] Error scanning chain for ${expiration}:`, chainErr);
      }
    }

    if (!bestOpportunity) {
      return {
        status: 'no_opportunity',
        message: 'No qualifying SPX Bear Call Spread found matching your criteria',
      };
    }

    console.log(`[BCS Auto] Best opportunity: ${JSON.stringify(bestOpportunity)}`);

    // ── Step 4: Determine account ────────────────────────────────────────────
    let accountId = settings.accountId ?? null;
    if (!accountId) {
      // Use first available Tastytrade account
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
    const maxRisk = ((bestOpportunity.longStrike - bestOpportunity.shortStrike - bestOpportunity.netCredit) * contracts * 100).toFixed(0);
    const rocPct = ((bestOpportunity.netCredit / (bestOpportunity.longStrike - bestOpportunity.shortStrike - bestOpportunity.netCredit)) * 100).toFixed(1);

    const approvalText =
      `🐻 <b>SPX Bear Call Spread — Auto-Entry</b>\n\n` +
      `<b>Short:</b> $${bestOpportunity.shortStrike} Call (δ ${bestOpportunity.delta.toFixed(2)})\n` +
      `<b>Long:</b>  $${bestOpportunity.longStrike} Call\n` +
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
    console.log(`[BCS Auto] Telegram approval sent for token ${token}`);

    // ── Step 7: Await approval (non-blocking for other users) ────────────────
    // This runs asynchronously — the cron job awaits it per-user sequentially
    const approved = await waitForTelegramApproval(token, approvalTimeoutMins * 60 * 1000);

    if (!approved) {
      // Timeout or skip
      const newStatus = 'skipped';
      await db
        .update(bcsPendingApprovals)
        .set({ status: newStatus, resolvedAt: new Date() })
        .where(eq(bcsPendingApprovals.token, token));
      console.log(`[BCS Auto] Approval skipped/expired for token ${token}`);
      return { status: 'skipped', message: 'Approval skipped or timed out' };
    }

    // ── Step 8: Submit live order ─────────────────────────────────────────────
    console.log(`[BCS Auto] Approval received for token ${token} — submitting order...`);
    await db
      .update(bcsPendingApprovals)
      .set({ status: 'approved', approvedAt: new Date() })
      .where(eq(bcsPendingApprovals.token, token));

    try {
      const tt = await authenticateTastytrade(credentials, userId);
      if (!tt) throw new Error('Failed to authenticate with Tastytrade');

      const orderQty = String(contracts);
      const limitPrice = bestOpportunity.netCredit.toFixed(2);

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

      console.log('[BCS Auto] Submitting order:', JSON.stringify(orderRequest, null, 2));
      const result = await tt.submitOrder(orderRequest);

      // Update DB with order ID
      await db
        .update(bcsPendingApprovals)
        .set({ status: 'approved', orderId: String(result.id), resolvedAt: new Date() })
        .where(eq(bcsPendingApprovals.token, token));

      // Write trading log
      await writeTradingLog({
        userId,
        symbol: 'SPXW',
        optionSymbol: bestOpportunity.shortOptionSymbol,
        accountNumber: accountId,
        strategy: 'BCS',
        action: 'STO',
        strike: String(bestOpportunity.shortStrike),
        expiration: bestOpportunity.expiration,
        quantity: contracts,
        price: limitPrice,
        priceEffect: 'Credit',
        outcome: 'pending',
        orderId: String(result.id),
        source: 'BCS Auto-Entry',
      });

      // Telegram confirmation
      const confirmText =
        `✅ <b>BCS Order Submitted</b>\n\n` +
        `<b>SPXW</b> $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike} Call Spread\n` +
        `Expiry: ${bestOpportunity.expiration} · ${contracts} contract(s)\n` +
        `Net Credit: <b>+$${totalCredit}</b>\n` +
        `Order ID: ${result.id}`;
      await sendTelegramMessage(confirmText);

      // Notify owner
      await notifyOwner({
        title: `✅ BCS Auto-Entry: SPXW $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike} submitted`,
        content: `${contracts} contract(s) · Net Credit $${totalCredit} · Exp ${bestOpportunity.expiration} · Order ${result.id}`,
      }).catch(() => {});

      return {
        status: 'approved',
        message: `Order submitted: SPXW $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike} · $${totalCredit} credit · Order ${result.id}`,
      };
    } catch (orderErr: any) {
      const errMsg = orderErr.message || 'Unknown order error';
      console.error(`[BCS Auto] Order submission failed:`, orderErr);
      await db
        .update(bcsPendingApprovals)
        .set({ status: 'error', errorMessage: errMsg, resolvedAt: new Date() })
        .where(eq(bcsPendingApprovals.token, token));
      await writeTradingLog({
        userId,
        symbol: 'SPXW',
        optionSymbol: bestOpportunity.shortOptionSymbol,
        accountNumber: accountId,
        strategy: 'BCS',
        action: 'STO',
        strike: String(bestOpportunity.shortStrike),
        expiration: bestOpportunity.expiration,
        quantity: contracts,
        price: bestOpportunity.netCredit.toFixed(2),
        outcome: 'error',
        errorMessage: errMsg,
        source: 'BCS Auto-Entry',
      });
      await sendTelegramMessage(
        `❌ <b>BCS Order Failed</b>\n\nSPXW $${bestOpportunity.shortStrike}/$${bestOpportunity.longStrike}\nReason: ${errMsg}`
      );
      return { status: 'error', message: `Order failed: ${errMsg}` };
    }
  } catch (err: any) {
    console.error(`[BCS Auto] Scan error for user ${userId}:`, err);
    return { status: 'error', message: err.message || 'Scan failed' };
  }
}
