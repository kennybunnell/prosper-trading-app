/**
 * Auto-Close Router
 * Manages per-position profit-target monitoring and automated BTC order submission.
 *
 * Flow:
 *  1. User opts in a position via setTarget (sets profitTargetPct + enabled=true)
 *  2. Every 5 min during market hours (Mon-Fri 9:30-16:00 ET) the cron job calls scanAndClose
 *  3. scanAndClose fetches live positions from Tastytrade, computes profit %, and submits BTC
 *     orders (dry-run first, then live) for any position that has reached its target
 *  4. Notification sent to owner on every auto-close action
 */

import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { getDb } from './db';
import { positionTargets } from '../drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getApiCredentials } from './db';
import { authenticateTastytrade } from './tastytrade';
import { notifyOwner } from './_core/notification';
import { writeTradingLog } from './routers-trading-log';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Compute profit % for a short option position.
 *  profit % = (premiumCollected - currentMark) / premiumCollected * 100
 *  A short option at 50% profit means the mark is now 50% of what we collected.
 */
function computeProfitPct(premiumCollected: number, currentMark: number): number {
  if (premiumCollected <= 0) return 0;
  return ((premiumCollected - currentMark) / premiumCollected) * 100;
}

// ─── router ───────────────────────────────────────────────────────────────────

export const autoCloseRouter = router({
  /**
   * List all position targets for the current user.
   * Returns all rows (watching, triggered, closed, expired, error).
   */
  listTargets: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });

    const rows = await db
      .select()
      .from(positionTargets)
      .where(eq(positionTargets.userId, ctx.user.id))
      .orderBy(positionTargets.createdAt);

    return rows;
  }),

  /**
   * Set (upsert) a profit target for a position.
   * If a row already exists for this optionSymbol+accountId, it is updated.
   */
  setTarget: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      accountNumber: z.string(),
      symbol: z.string(),
      optionSymbol: z.string(),
      optionType: z.enum(['C', 'P']),
      strike: z.string(),
      expiration: z.string(),
      quantity: z.number().int(),
      premiumCollected: z.string(),
      profitTargetPct: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(90)]),
      strategy: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });

      // Check for existing row
      const existing = await db
        .select({ id: positionTargets.id })
        .from(positionTargets)
        .where(
          and(
            eq(positionTargets.userId, ctx.user.id),
            eq(positionTargets.optionSymbol, input.optionSymbol),
            eq(positionTargets.accountId, input.accountId),
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(positionTargets)
          .set({
            profitTargetPct: input.profitTargetPct,
            enabled: true,
            status: 'watching',
            errorMessage: null,
          })
          .where(eq(positionTargets.id, existing[0].id));
        return { action: 'updated', id: existing[0].id };
      }

      const [result] = await db.insert(positionTargets).values({
        userId: ctx.user.id,
        accountId: input.accountId,
        accountNumber: input.accountNumber,
        symbol: input.symbol,
        optionSymbol: input.optionSymbol,
        optionType: input.optionType,
        strike: input.strike,
        expiration: input.expiration,
        quantity: input.quantity,
        premiumCollected: input.premiumCollected,
        profitTargetPct: input.profitTargetPct,
        enabled: true,
        status: 'watching',
        strategy: input.strategy ?? 'csp',
      });

      return { action: 'created', id: (result as any).insertId };
    }),

  /**
   * Toggle enabled/disabled for a target without removing it.
   */
  toggleTarget: protectedProcedure
    .input(z.object({ id: z.number().int(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });

      await db
        .update(positionTargets)
        .set({ enabled: input.enabled })
        .where(and(eq(positionTargets.id, input.id), eq(positionTargets.userId, ctx.user.id)));

      return { success: true };
    }),

  /**
   * Remove a target row entirely.
   */
  removeTarget: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });

      await db
        .delete(positionTargets)
        .where(and(eq(positionTargets.id, input.id), eq(positionTargets.userId, ctx.user.id)));

      return { success: true };
    }),

  /**
   * Update the profit target % for an existing target.
   */
  updateTargetPct: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      profitTargetPct: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(90)]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });

      await db
        .update(positionTargets)
        .set({ profitTargetPct: input.profitTargetPct })
        .where(and(eq(positionTargets.id, input.id), eq(positionTargets.userId, ctx.user.id)));

      return { success: true };
    }),

  /**
   * Manual "Run Now" — immediately scan all watching targets for the current user
   * and close any that have hit their profit target.
   */
  runNow: protectedProcedure.mutation(async ({ ctx }) => {
    return runAutoCloseScanForUser(ctx.user.id);
  }),

  /**
   * Fetch all open short option positions from Tastytrade for the current user
   * (across all accounts) so the UI can display them with opt-in toggles.
   */
  listOpenShortPositions: protectedProcedure.query(async ({ ctx }) => {
    // Use getLivePositions — same source as Step 1 (Close for Profit) — with DB cache fallback.
    // The raw Tastytrade API does NOT return option-type or strike-price fields on positions;
    // they must be parsed from the OCC symbol. This was the root cause of the empty list.
    const { getLivePositions } = await import('./portfolio-sync');
    const allPositions = await getLivePositions(ctx.user.id);

    const db = await getDb();
    const existingTargets = db
      ? await db.select().from(positionTargets).where(eq(positionTargets.userId, ctx.user.id))
      : [];
    const targetMap = new Map(existingTargets.map(t => [`${t.accountId}::${t.optionSymbol.replace(/\s+/g, '')}`, t]));

    // OCC symbol parser: "AAPL  260529P00280000" → { optionType: 'P', strike: '280.00', expiration: '2026-05-29' }
    function parseOcc(sym: string): { optionType: 'C' | 'P'; strike: string; expiration: string } | null {
      const clean = sym.replace(/\s+/g, '');
      const m = clean.match(/^([A-Z0-9]+)(\d{6})([CP])(\d+)$/);
      if (!m) return null;
      const dateStr = m[2];
      const year = 2000 + parseInt(dateStr.substring(0, 2));
      const month = parseInt(dateStr.substring(2, 4));
      const day = parseInt(dateStr.substring(4, 6));
      const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const strike = (parseInt(m[4]) / 1000).toFixed(2);
      return { optionType: m[3] as 'C' | 'P', strike, expiration };
    }

    const result: Array<{
      accountId: string;
      accountNumber: string;
      symbol: string;
      optionSymbol: string;
      optionType: 'C' | 'P';
      strike: string;
      expiration: string;
      quantity: number;
      averageOpenPrice: string;
      currentMark: string;
      profitPct: number;
      dte: number;
      targetId?: number;
      targetEnabled?: boolean;
      profitTargetPct?: number;
      targetStatus?: string;
      lastProfitPct?: string;
    }> = [];

    for (const p of allPositions) {
      const instrType = p['instrument-type'];
      if (instrType !== 'Equity Option' && instrType !== 'Index Option') continue;

      // Accept both 'Short' direction and negative quantity as short positions
      const direction = (p['quantity-direction'] ?? '').toLowerCase();
      const qty = parseFloat(String(p.quantity ?? '0'));
      const isShort = direction === 'short' || qty < 0;
      if (!isShort) continue;

      const rawSym: string = p.symbol ?? '';
      const parsed = parseOcc(rawSym);
      if (!parsed) continue;

      const accountNumber: string = p['account-number'] ?? '';
      const mark = parseFloat(String(p['close-price'] ?? p['average-daily-market-close-price'] ?? '0'));
      const avgOpen = parseFloat(String(p['average-open-price'] ?? '0'));
      const profitPct = computeProfitPct(avgOpen, mark);

      // DTE from expires-at
      let dte = 0;
      const expiresAt = p['expires-at'];
      if (expiresAt) {
        const expMs = new Date(String(expiresAt).substring(0, 10)).getTime();
        dte = Math.max(0, Math.round((expMs - Date.now()) / 86_400_000));
      }

      const normalizedSym = rawSym.replace(/\s+/g, '');
      const key = `${accountNumber}::${normalizedSym}`;
      const existing = targetMap.get(key);

      result.push({
        accountId: accountNumber,
        accountNumber,
        symbol: p['underlying-symbol'] ?? rawSym,
        optionSymbol: rawSym,
        optionType: parsed.optionType,
        strike: parsed.strike,
        expiration: parsed.expiration,
        quantity: Math.abs(qty),
        averageOpenPrice: String(p['average-open-price'] ?? '0'),
        currentMark: String(p['close-price'] ?? p['average-daily-market-close-price'] ?? '0'),
        profitPct: Math.round(profitPct * 10) / 10,
        dte,
        targetId: existing?.id,
        targetEnabled: existing?.enabled,
        profitTargetPct: existing?.profitTargetPct,
        targetStatus: existing?.status,
        lastProfitPct: existing?.lastProfitPct ?? undefined,
      });
    }

    return result;
  }),
});

// ─── core scan engine (also called by cron) ───────────────────────────────────

export async function runAutoCloseScanForUser(userId: number): Promise<{
  scanned: number;
  closed: number;
  skipped: number;
  errors: number;
  details: Array<{ symbol: string; status: 'closed' | 'skipped' | 'error'; profitPct?: number; message?: string }>;
}> {
  const db = await getDb();
  if (!db) return { scanned: 0, closed: 0, skipped: 0, errors: 0, details: [] };

  // Get all enabled watching targets for this user
  const targets = await db
    .select()
    .from(positionTargets)
    .where(
      and(
        eq(positionTargets.userId, userId),
        eq(positionTargets.enabled, true),
        inArray(positionTargets.status, ['watching', 'triggered']),
      )
    );

  if (targets.length === 0) return { scanned: 0, closed: 0, skipped: 0, errors: 0, details: [] };

  const credentials = await getApiCredentials(userId);
  if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
    return { scanned: targets.length, closed: 0, skipped: targets.length, errors: 0, details: [] };
  }

  const tt = await authenticateTastytrade(credentials, userId);
  if (!tt) return { scanned: targets.length, closed: 0, skipped: targets.length, errors: 0, details: [] };

  // Group targets by accountId to minimize API calls
  const byAccount = new Map<string, typeof targets>();
  for (const t of targets) {
    const list = byAccount.get(t.accountId) ?? [];
    list.push(t);
    byAccount.set(t.accountId, list);
  }

  const details: Array<{ symbol: string; status: 'closed' | 'skipped' | 'error'; profitPct?: number; message?: string }> = [];
  let closed = 0;
  let skipped = 0;
  let errors = 0;

  for (const [accountId, accountTargets] of Array.from(byAccount.entries())) {
    let positions: any[] = [];
    try {
      positions = await tt.getPositions(accountId);
    } catch (err) {
      console.error(`[AutoClose] Failed to fetch positions for account ${accountId}:`, err);
      for (const t of accountTargets) {
        errors++;
        details.push({ symbol: t.symbol, status: 'error', message: 'Failed to fetch positions' });
        await db.update(positionTargets).set({ status: 'error', errorMessage: 'Failed to fetch positions', lastCheckedAt: new Date() }).where(eq(positionTargets.id, t.id));
      }
      continue;
    }

    const posMap = new Map(positions.map((p: any) => [p.symbol?.replace(/\s+/g, ''), p]));

    for (const target of accountTargets) {
      const normalizedSymbol = target.optionSymbol.replace(/\s+/g, '');
      const pos = posMap.get(normalizedSymbol);

      // Update lastCheckedAt
      await db.update(positionTargets).set({ lastCheckedAt: new Date() }).where(eq(positionTargets.id, target.id));

      if (!pos) {
        // Position no longer exists — mark as expired/closed
        await db.update(positionTargets).set({ status: 'expired', lastCheckedAt: new Date() }).where(eq(positionTargets.id, target.id));
        skipped++;
        details.push({ symbol: target.symbol, status: 'skipped', message: 'Position no longer found (expired or already closed)' });
        continue;
      }

      const mark = parseFloat((pos as any)['close-price'] || (pos as any)['average-daily-market-close-price'] || '0');
      const premium = parseFloat(target.premiumCollected);
      const profitPct = computeProfitPct(premium, mark);
      const profitPctRounded = Math.round(profitPct * 10) / 10;

      // Update lastProfitPct
      await db.update(positionTargets).set({ lastProfitPct: profitPctRounded.toFixed(1), lastCheckedAt: new Date() }).where(eq(positionTargets.id, target.id));

      if (profitPct < target.profitTargetPct) {
        skipped++;
        details.push({ symbol: target.symbol, status: 'skipped', profitPct: profitPctRounded, message: `${profitPctRounded}% profit — target is ${target.profitTargetPct}%` });
        continue;
      }

      // Profit target reached — submit BTC
      try {
        const btcPrice = mark * 1.05; // 5% above mark for fill probability
        const formattedPrice = Math.ceil(btcPrice * 20) / 20; // round up to nearest $0.05

        // Dry run first
        const dryRunResult = await tt.buyToCloseOption(accountId, target.optionSymbol, target.quantity, formattedPrice, true);
        if (!dryRunResult.success) {
          throw new Error(`Dry run failed: ${dryRunResult.message}`);
        }

        // Live submission
        const liveResult = await tt.buyToCloseOption(accountId, target.optionSymbol, target.quantity, formattedPrice, false);
        if (!liveResult.success) {
          throw new Error(`Live order failed: ${liveResult.message}`);
        }

        // Update target status
        await db.update(positionTargets).set({
          status: 'closed',
          closedAt: new Date(),
          closedOrderId: liveResult.orderId,
          lastProfitPct: profitPctRounded.toFixed(1),
        }).where(eq(positionTargets.id, target.id));

        // Log to trading log
        try {
          await writeTradingLog({
            userId,
            symbol: target.symbol,
            strategy: target.strategy ?? 'csp',
            action: 'BTC',
            outcome: 'success',
            orderId: liveResult.orderId,
            source: 'auto-close-cron',
            isDryRun: false,
          });
        } catch { /* non-fatal */ }

        // Notify owner
        await notifyOwner({
          title: `✅ Auto-Close: ${target.symbol} closed at ${profitPctRounded}% profit`,
          content: `Auto-close monitor closed **${target.symbol}** ${target.optionType === 'P' ? 'Put' : 'Call'} $${target.strike} exp ${target.expiration}.\n\nProfit: **${profitPctRounded}%** (target: ${target.profitTargetPct}%)\nBTC price: $${formattedPrice.toFixed(2)}\nOrder ID: ${liveResult.orderId}\nAccount: ${accountId}`,
        });

        closed++;
        details.push({ symbol: target.symbol, status: 'closed', profitPct: profitPctRounded, message: `Closed at ${profitPctRounded}% profit (order ${liveResult.orderId})` });
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        console.error(`[AutoClose] Error closing ${target.symbol}:`, errMsg);
        await db.update(positionTargets).set({ status: 'error', errorMessage: errMsg, lastCheckedAt: new Date() }).where(eq(positionTargets.id, target.id));
        errors++;
        details.push({ symbol: target.symbol, status: 'error', profitPct: profitPctRounded, message: errMsg });
      }
    }
  }

  return { scanned: targets.length, closed, skipped, errors, details };
}
