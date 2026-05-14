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
import { positionTargets, autoCloseLog, globalBracketDefaults } from '../drizzle/schema';
import { eq, and, inArray, desc, asc } from 'drizzle-orm';
import { getApiCredentials } from './db';
import { authenticateTastytrade } from './tastytrade';
import { notifyOwner } from './_core/notification';
import { writeTradingLog } from './routers-trading-log';
import { sendTelegramMessage } from './telegram';

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
      stopLossPct: z.number().int().min(100).max(1000).nullable().optional(),
      dteFloor: z.number().int().min(0).max(60).nullable().optional(),
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
            stopLossPct: input.stopLossPct ?? null,
            dteFloor: input.dteFloor ?? null,
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
        stopLossPct: input.stopLossPct ?? null,
        dteFloor: input.dteFloor ?? null,
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
      stopLossPct?: number | null;
      dteFloor?: number | null;
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
        stopLossPct: existing?.stopLossPct ?? null,
        dteFloor: existing?.dteFloor ?? null,
        targetStatus: existing?.status,
        lastProfitPct: existing?.lastProfitPct ?? undefined,
      });
    }

    return result;
  }),

  /**
   * Fetch auto-close execution log entries for the current user.
   * Returns active (unarchived) by default; pass archived=true for the archive view.
   */
  getAutoCloseLogs: protectedProcedure
    .input(z.object({
      archived: z.boolean().optional().default(false),
      sortBy: z.enum(['closedAt', 'profitPct', 'symbol']).optional().default('closedAt'),
      sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
      limit: z.number().int().min(1).max(500).optional().default(200),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const col = {
        closedAt: autoCloseLog.closedAt,
        profitPct: autoCloseLog.profitPct,
        symbol: autoCloseLog.symbol,
      }[input.sortBy];
      const rows = await db
        .select()
        .from(autoCloseLog)
        .where(and(
          eq(autoCloseLog.userId, ctx.user.id),
          eq(autoCloseLog.archived, input.archived),
        ))
        .orderBy(input.sortDir === 'asc' ? asc(col!) : desc(col!))
        .limit(input.limit);
      return rows;
    }),

  /**
   * Archive (or unarchive) a single log entry.
   */
  archiveAutoCloseLog: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      archived: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      await db
        .update(autoCloseLog)
        .set({ archived: input.archived, archivedAt: input.archived ? Date.now() : null })
        .where(and(
          eq(autoCloseLog.id, input.id),
          eq(autoCloseLog.userId, ctx.user.id),
        ));
      return { success: true };
    }),

  /**
   * Bulk archive all active log entries for the current user.
   */
  bulkArchiveAutoCloseLogs: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      await db
        .update(autoCloseLog)
        .set({ archived: true, archivedAt: Date.now() })
        .where(and(
          eq(autoCloseLog.userId, ctx.user.id),
          eq(autoCloseLog.archived, false),
        ));
      return { success: true };
    }),

  // ─── Global Bracket Defaults ────────────────────────────────────────────────

  getBracketDefaults: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { profitTargetPct: 50, stopLossPct: null as number | null, dteFloor: null as number | null };
      const [row] = await db
        .select()
        .from(globalBracketDefaults)
        .where(eq(globalBracketDefaults.userId, ctx.user.id))
        .limit(1);
      return row
        ? { profitTargetPct: row.profitTargetPct, stopLossPct: row.stopLossPct ?? null, dteFloor: row.dteFloor ?? null }
        : { profitTargetPct: 50, stopLossPct: null as number | null, dteFloor: null as number | null };
    }),

  setBracketDefaults: protectedProcedure
    .input(z.object({
      profitTargetPct: z.number().int().min(10).max(100),
      stopLossPct: z.number().int().min(100).max(1000).nullable().optional(),
      dteFloor: z.number().int().min(0).max(60).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [existing] = await db
        .select({ id: globalBracketDefaults.id })
        .from(globalBracketDefaults)
        .where(eq(globalBracketDefaults.userId, ctx.user.id))
        .limit(1);
      if (existing) {
        await db
          .update(globalBracketDefaults)
          .set({
            profitTargetPct: input.profitTargetPct,
            stopLossPct: input.stopLossPct ?? null,
            dteFloor: input.dteFloor ?? null,
            updatedAt: Date.now(),
          })
          .where(eq(globalBracketDefaults.id, existing.id));
      } else {
        await db.insert(globalBracketDefaults).values({
          userId: ctx.user.id,
          profitTargetPct: input.profitTargetPct,
          stopLossPct: input.stopLossPct ?? null,
          dteFloor: input.dteFloor ?? null,
          updatedAt: Date.now(),
        });
      }
      return { success: true };
    }),

  notifyOptIn: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      optionType: z.enum(['C', 'P']),
      strike: z.string(),
      expiration: z.string(),
      profitTargetPct: z.number(),
      stopLossPct: z.number().nullable().optional(),
      dteFloor: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const typeLabel = input.optionType === 'C' ? 'Call' : 'Put';
      const stopPart = input.stopLossPct != null ? ` | Stop Loss: ${input.stopLossPct}%` : '';
      const dtePart = input.dteFloor != null ? ` | DTE \u2264 ${input.dteFloor}` : '';
      const msg = `\ud83d\udd14 Auto-Close Bracket Set\n\n\ud83d\udccc ${input.symbol} ${typeLabel} $${input.strike} exp ${input.expiration}\n\n\u2705 Profit Target: ${input.profitTargetPct}%${stopPart}${dtePart}\n\nMonitoring is now active. The system will close this position automatically when any condition is met.`;
      try {
        await sendTelegramMessage(msg);
      } catch (err) {
        console.error('[AutoClose] Telegram opt-in notify failed:', err);
      }
      return { success: true };
    }),

  /**
   * Bulk opt-in: set targets on multiple positions at once using provided defaults.
   * Used by the "Monitor All" button in AutoCloseStep.
   */
  bulkSetTargets: protectedProcedure
    .input(z.object({
      positions: z.array(z.object({
        accountNumber: z.string(),
        optionSymbol: z.string(),
        symbol: z.string(),
        optionType: z.enum(['C', 'P']),
        strike: z.string(),
        expiration: z.string(),
        averageOpenPrice: z.string(),
        quantity: z.number(),
      })),
      profitTargetPct: z.number().min(1).max(99),
      stopLossPct: z.number().nullable().optional(),
      dteFloor: z.number().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      let count = 0;
      for (const pos of input.positions) {
        const existing = await db
          .select({ id: positionTargets.id })
          .from(positionTargets)
          .where(and(
            eq(positionTargets.userId, ctx.user.id),
            eq(positionTargets.optionSymbol, pos.optionSymbol),
            eq(positionTargets.accountNumber, pos.accountNumber),
          ))
          .limit(1);
        if (existing.length > 0) {
          // Already monitored — skip to avoid overwriting user's custom settings
          continue;
        }
        await db.insert(positionTargets).values({
          userId: ctx.user.id,
          accountNumber: pos.accountNumber,
          optionSymbol: pos.optionSymbol,
          symbol: pos.symbol,
          optionType: pos.optionType,
          strike: pos.strike,
          expiration: pos.expiration,
          averageOpenPrice: pos.averageOpenPrice,
          quantity: pos.quantity,
          profitTargetPct: input.profitTargetPct,
          stopLossPct: input.stopLossPct ?? null,
          dteFloor: input.dteFloor ?? null,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        count++;
      }
      // Send Telegram summary
      try {
        const stopPart = input.stopLossPct != null ? ` | Stop: ${input.stopLossPct}%` : '';
        const dtePart = input.dteFloor != null ? ` | DTE ≤ ${input.dteFloor}` : '';
        await sendTelegramMessage(`🟢 Auto-Close: Bulk Monitor Activated\n\nOpted in ${count} position${count !== 1 ? 's' : ''} using defaults:\n✅ Profit: ${input.profitTargetPct}%${stopPart}${dtePart}\n\n${count} position${count !== 1 ? 's' : ''} will now be monitored automatically.`);
      } catch (err) {
        console.error('[AutoClose] Bulk Telegram notify failed:', err);
      }
      return { count };
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

      // ── Bracket condition checks ─────────────────────────────────────────
      const today = new Date();
      const expDate = new Date(target.expiration);
      const dte = Math.max(0, Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      // Loss % relative to premium collected (positive = we are losing)
      const lossPct = mark > 0 && premium > 0 ? ((mark - premium) / premium) * 100 : 0;

      const profitTargetHit = profitPct >= target.profitTargetPct;
      const stopLossHit = target.stopLossPct != null && lossPct >= target.stopLossPct;
      const dteFloorHit = target.dteFloor != null && dte <= target.dteFloor;
      const shouldClose = profitTargetHit || stopLossHit || dteFloorHit;
      const closeReason = profitTargetHit ? 'profit_target' : stopLossHit ? 'stop_loss' : dteFloorHit ? 'dte_floor' : 'manual';

      if (!shouldClose) {
        skipped++;
        const reasons: string[] = [`P/L: ${profitPctRounded}% (target: ${target.profitTargetPct}%)` ];
        if (target.stopLossPct != null) reasons.push(`Loss: ${lossPct.toFixed(1)}% (stop: ${target.stopLossPct}%)`);
        if (target.dteFloor != null) reasons.push(`DTE: ${dte} (floor: ${target.dteFloor})`);
        details.push({ symbol: target.symbol, status: 'skipped', profitPct: profitPctRounded, message: reasons.join(' | ') });
        continue;
      }

      console.log(`[AutoClose] Bracket triggered for ${target.symbol} — reason: ${closeReason} (P/L: ${profitPctRounded}%, loss: ${lossPct.toFixed(1)}%, DTE: ${dte})`);

      // Bracket condition met — submit BTC
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
          closeReason,
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

        // Write to auto-close execution log
        try {
          await db.insert(autoCloseLog).values({
            userId,
            accountId,
            accountNumber: target.accountNumber,
            symbol: target.symbol,
            optionSymbol: target.optionSymbol,
            optionType: (target.optionType as 'C' | 'P'),
            strike: target.strike,
            expiration: target.expiration,
            quantity: target.quantity,
            openPrice: String(parseFloat(target.premiumCollected).toFixed(4)),
            closePrice: String(formattedPrice.toFixed(4)),
            profitPct: String(profitPctRounded.toFixed(2)),
            targetPct: target.profitTargetPct,
            closeReason,
            orderId: liveResult.orderId ?? null,
            closedAt: Date.now(),
            archived: false,
          });
        } catch (logErr) {
          console.error('[AutoClose] Failed to write execution log:', logErr);
        }

        // Notify owner
        const reasonLabel = closeReason === 'profit_target'
          ? `${profitPctRounded}% profit`
          : closeReason === 'stop_loss'
          ? `Stop Loss hit (${lossPct.toFixed(1)}% loss)`
          : `DTE Floor hit (${dte} DTE remaining)`;
        await notifyOwner({
          title: `${closeReason === 'profit_target' ? '✅' : '🛑'} Auto-Close: ${target.symbol} — ${reasonLabel}`,
          content: `Auto-close monitor closed **${target.symbol}** ${target.optionType === 'P' ? 'Put' : 'Call'} $${target.strike} exp ${target.expiration}.\n\nReason: **${closeReason.replace('_', ' ')}** (${reasonLabel})\nP/L: ${profitPctRounded}% | DTE: ${dte}\nBTC price: $${formattedPrice.toFixed(2)}\nOrder ID: ${liveResult.orderId}\nAccount: ${accountId}`,
        });

        closed++;
        details.push({ symbol: target.symbol, status: 'closed', profitPct: profitPctRounded, message: `Closed — ${closeReason.replace('_', ' ')} (${reasonLabel}) | order ${liveResult.orderId}` });
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
