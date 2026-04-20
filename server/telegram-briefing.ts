/**
 * Telegram Daily Morning Briefing
 *
 * Sends a formatted portfolio summary to the Telegram bot every weekday at
 * 8:30 AM Mountain Time (America/Denver timezone, handles MDT/MST automatically).
 *
 * Content:
 *  - Total open short positions and open premium
 *  - Short positions expiring within 7 days with DTE badge + P&L (% premium captured)
 *  - "Close for Profit" alert for positions ≥ 90% captured
 *  - Link to open the dashboard
 *
 * Data accuracy:
 *  - Uses DB cache for positions (synced every 15 min) — guaranteed fast, no auth needed
 *  - Attempts live marks from Tastytrade getOptionQuotesBatch for accurate P&L
 *  - Falls back to cached close-price if live marks fail (cold start / auth issue)
 *  - Sends ONE briefing per owner user (not one per credential row)
 */
import * as cron from 'node-cron';
import { sendTelegramMessage } from './telegram';

let briefingTask: cron.ScheduledTask | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDTE = (expDateStr: string): number => {
  if (!expDateStr) return 999;
  const today = new Date();
  const exp = new Date(expDateStr + 'T16:00:00'); // 4pm ET = options expiry
  const diffMs = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
};

/**
 * Calculate % of premium captured for a short option position.
 *
 * Formula: (openPrice - currentMark) / openPrice * 100
 *   - openPrice  = average-open-price (original STO credit received)
 *   - currentMark = live mark price (bid/ask midpoint from Tastytrade)
 *
 * 0%  = position just opened (full premium still at risk)
 * 50% = half the premium has decayed away
 * 100% = option worth $0 (full premium captured, expires worthless)
 * <0% = position has moved against us (ITM or expanded)
 */
const calcPremiumCaptured = (
  openPrice: number,
  currentMark: number,
): number | null => {
  if (openPrice <= 0) return null;
  // Do NOT clamp — negative values are real and important (losers)
  return ((openPrice - currentMark) / openPrice) * 100;
};

/** Emoji badge for % captured (allows negative for losers) */
const pctBadge = (pct: number): string => {
  if (pct >= 90) return '🟢';  // Close for profit territory
  if (pct >= 50) return '🟡';  // Halfway there
  if (pct >= 25) return '🟠';  // Early stage
  if (pct >= 0)  return '🔴';  // Still at risk
  return '⛔';                  // Loser — position moved against us
};

// ─── Briefing Content Builder ─────────────────────────────────────────────────

async function buildBriefing(userId: number): Promise<string> {
  try {
    const { getCachedPositions, cachedPosToWireFormat } = await import('./portfolio-sync');
    const cachedRows = await getCachedPositions(userId);
    const positions = cachedRows.map(p => cachedPosToWireFormat({ ...p, quantityDirection: p.quantityDirection ?? '' }));

    const today = new Date();

    const optionPositions = positions.filter(
      (p: Record<string, any>) =>
        p['instrument-type'] === 'Equity Option' ||
        p['instrument-type'] === 'Index Option',
    );

    // Short positions only
    const shortPositions = optionPositions.filter(
      (p: Record<string, any>) =>
        (p['quantity-direction'] || '').toLowerCase() === 'short',
    );

    // ── Fetch live marks via Tastytrade getOptionQuotesBatch ──────────────────
    // close-price from the positions endpoint is yesterday's close — NOT live.
    // We need live marks for accurate P&L calculation.
    const liveMarkMap = new Map<string, number>();
    let usingLiveMarks = false;

    try {
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const credentials = await getApiCredentials(userId);
      if (credentials?.tastytradeRefreshToken) {
        const api = await authenticateTastytrade(credentials, userId);
        const optionSymbols = shortPositions
          .map((p: Record<string, any>) => (p.symbol || '').trim())
          .filter(Boolean);
        if (optionSymbols.length > 0) {
          const quoteMap = await api.getOptionQuotesBatch(optionSymbols);
          for (const [sym, q] of Object.entries(quoteMap) as [string, any][]) {
            const mid = (q.bid + q.ask) / 2;
            const mark = (q.mark && q.mark > 0) ? q.mark : (mid > 0 ? mid : (q.last > 0 ? q.last : 0));
            if (mark > 0) {
              liveMarkMap.set(sym, mark);
              liveMarkMap.set(sym.replace(/\s/g, ''), mark); // also store without spaces
            }
          }
          usingLiveMarks = liveMarkMap.size > 0;
          console.log(`[Telegram Briefing] Live marks fetched: ${liveMarkMap.size}/${optionSymbols.length}`);
        }
      }
    } catch (markErr: any) {
      console.warn('[Telegram Briefing] Could not fetch live marks, falling back to close-price:', markErr.message);
    }

    /** Get the best available mark for a position */
    const getMark = (p: Record<string, any>): number => {
      const sym = (p.symbol || '').trim();
      const live = liveMarkMap.get(sym) ?? liveMarkMap.get(sym.replace(/\s/g, ''));
      if (live !== undefined) return live;
      // Fallback: use close-price (stale — yesterday's close)
      return parseFloat(p['close-price'] || '0');
    };

    // ── Total open premium ────────────────────────────────────────────────────
    // Sum of original credit received: openPrice × qty × multiplier
    const totalOpenPremium = shortPositions.reduce(
      (sum: number, p: Record<string, any>) => {
        const qty = Math.abs(parseFloat(p.quantity || '1'));
        const openPrice = parseFloat(p['average-open-price'] || '0');
        const multiplier = parseFloat(p.multiplier || '100');
        return sum + openPrice * qty * multiplier;
      },
      0,
    );

    // ── Remaining value (what it would cost to close all right now) ───────────
    const totalCurrentValue = shortPositions.reduce(
      (sum: number, p: Record<string, any>) => {
        const qty = Math.abs(parseFloat(p.quantity || '1'));
        const mark = getMark(p);
        const multiplier = parseFloat(p.multiplier || '100');
        return sum + mark * qty * multiplier;
      },
      0,
    );

    const totalCaptured = totalOpenPremium - totalCurrentValue;
    const totalCapturedPct =
      totalOpenPremium > 0 ? (totalCaptured / totalOpenPremium) * 100 : 0;

    // ── Expiring soon (≤7 DTE) with P&L ──────────────────────────────────────
    interface ExpiringPos {
      symbol: string;
      underlying: string;
      expiration: string;
      dte: number;
      qty: number;
      account: string;
      openPrice: number;
      currentMark: number;
      capturedPct: number | null;
      openPremiumTotal: number;
      capturedTotal: number;
    }

    const expiringSoon: ExpiringPos[] = shortPositions
      .map((p: Record<string, any>) => {
        const openPrice = parseFloat(p['average-open-price'] || '0');
        const currentMark = getMark(p);
        const qty = Math.abs(parseFloat(p.quantity || '1'));
        const multiplier = parseFloat(p.multiplier || '100');
        return {
          symbol: (p.symbol || '').trim() as string,
          underlying: (p['underlying-symbol'] || '').trim() as string,
          expiration: (p['expiration-date'] || p['expires-at'] || '') as string,
          dte: getDTE(p['expiration-date'] || p['expires-at'] || ''),
          qty,
          account: (p['account-number'] || '').slice(-4) as string,
          openPrice,
          currentMark,
          capturedPct: calcPremiumCaptured(openPrice, currentMark),
          openPremiumTotal: openPrice * qty * multiplier,
          capturedTotal: (openPrice - currentMark) * qty * multiplier,
        };
      })
      .filter((p: ExpiringPos) => p.dte <= 7)
      .sort((a: ExpiringPos, b: ExpiringPos) => a.dte - b.dte);

    // ── Close-for-profit candidates (≥90% captured, any DTE) ─────────────────
    const closeForProfit = shortPositions
      .map((p: Record<string, any>) => {
        const openPrice = parseFloat(p['average-open-price'] || '0');
        const currentMark = getMark(p);
        const capturedPct = calcPremiumCaptured(openPrice, currentMark);
        return {
          underlying: (p['underlying-symbol'] || '').trim() as string,
          dte: getDTE(p['expiration-date'] || p['expires-at'] || ''),
          capturedPct,
        };
      })
      .filter(
        (p: { capturedPct: number | null; dte: number }) =>
          p.capturedPct !== null && p.capturedPct >= 90 && p.dte > 7,
      )
      .sort(
        (a: { capturedPct: number | null }, b: { capturedPct: number | null }) =>
          (b.capturedPct ?? 0) - (a.capturedPct ?? 0),
      );

    // ── Format message ────────────────────────────────────────────────────────
    const dateStr = today.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    const marksNote = usingLiveMarks ? '' : ' <i>(stale marks)</i>';

    let msg = `🌅 <b>Good morning, Kenny!</b>\n`;
    msg += `📅 <b>${dateStr}</b> — Daily Briefing\n\n`;

    // Portfolio summary
    msg += `📊 <b>Open Short Positions:</b> ${shortPositions.length}\n`;
    msg += `💰 <b>Original Premium:</b> $${totalOpenPremium.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n`;
    if (totalOpenPremium > 0) {
      const badge = pctBadge(totalCapturedPct);
      const capturedSign = totalCaptured >= 0 ? '' : '';
      msg += `${badge} <b>Captured:</b> $${totalCaptured.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${totalCapturedPct.toFixed(0)}%)${marksNote}\n`;
    }
    msg += '\n';

    // Close-for-profit alert
    if (closeForProfit.length > 0) {
      msg += `💸 <b>Ready to Close (≥90% captured, ${closeForProfit.length}):</b>\n`;
      for (const p of closeForProfit.slice(0, 5)) {
        msg += `  🟢 <b>${p.underlying}</b> — ${p.capturedPct?.toFixed(0)}% captured, ${p.dte}d left\n`;
      }
      msg += '\n';
    }

    // Expiring soon
    if (expiringSoon.length > 0) {
      msg += `⚠️ <b>Expiring ≤7 DTE (${expiringSoon.length}):</b>\n`;
      for (const p of expiringSoon.slice(0, 8)) {
        const dteBadge =
          p.dte === 0 ? '🔴 TODAY' : p.dte <= 2 ? `🔴 ${p.dte}d` : `🟡 ${p.dte}d`;

        // P&L line
        let pnlStr = '';
        if (p.capturedPct !== null && p.openPremiumTotal > 0) {
          const badge = pctBadge(p.capturedPct);
          const capturedDollar = p.capturedTotal.toLocaleString('en-US', { maximumFractionDigits: 0 });
          const openDollar = p.openPremiumTotal.toLocaleString('en-US', { maximumFractionDigits: 0 });
          pnlStr = ` ${badge} ${p.capturedPct.toFixed(0)}% ($${capturedDollar}/$${openDollar})`;
        }

        msg += `  ${dteBadge} <b>${p.underlying}</b> ×${p.qty}${pnlStr} [···${p.account}]\n`;
      }
      if (expiringSoon.length > 8) {
        msg += `  <i>…and ${expiringSoon.length - 8} more</i>\n`;
      }
      msg += '\n';
    } else {
      msg += `✅ <b>No positions expiring within 7 days</b>\n\n`;
    }

    msg += `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
    return msg;
  } catch (err: any) {
    console.error('[Telegram Briefing] Error building briefing:', err.message);
    return (
      `🌅 <b>Good morning, Kenny!</b>\n\n` +
      `⚠️ Could not fetch live positions for today's briefing.\n` +
      `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`
    );
  }
}

// ─── Run Briefing — Owner Only ────────────────────────────────────────────────
/**
 * Sends ONE briefing to the Telegram bot for the owner user.
 *
 * Previous version looped through ALL users with credentials, which caused
 * duplicate briefings when the owner has multiple credential rows (e.g., two
 * accounts with separate refresh tokens stored). Fixed: resolve the owner's
 * single user ID via OWNER_OPEN_ID env var, fall back to the first user in DB.
 */
async function runDailyBriefing(): Promise<void> {
  console.log('[Telegram Briefing] Running daily morning briefing...');
  try {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) {
      console.error('[Telegram Briefing] Database not available');
      return;
    }

    // Resolve owner user ID — use OWNER_OPEN_ID to find the single owner row
    const { users } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const ownerOpenId = process.env.OWNER_OPEN_ID;
    let ownerUserId: number | null = null;

    if (ownerOpenId) {
      const ownerRows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.openId, ownerOpenId))
        .limit(1);
      if (ownerRows.length > 0) ownerUserId = ownerRows[0].id;
    }

    // Fallback: first user in DB
    if (!ownerUserId) {
      const firstUser = await db.select({ id: users.id }).from(users).limit(1);
      if (firstUser.length > 0) ownerUserId = firstUser[0].id;
    }

    if (!ownerUserId) {
      console.error('[Telegram Briefing] No owner user found — skipping briefing');
      return;
    }

    try {
      const message = await buildBriefing(ownerUserId);
      await sendTelegramMessage(message);
      console.log(`[Telegram Briefing] Sent briefing for owner userId=${ownerUserId}`);
    } catch (err: any) {
      console.error('[Telegram Briefing] Failed to send briefing:', err.message);
    }
  } catch (err: any) {
    console.error('[Telegram Briefing] Unexpected error:', err.message);
  }
}

// ─── Scheduler Init ───────────────────────────────────────────────────────────

/**
 * Initialize the daily Telegram briefing scheduler.
 * Fires at 8:30 AM Mountain Time every weekday (Mon–Fri).
 * node-cron with timezone: 'America/Denver' handles MDT/MST DST automatically.
 */
export function initializeTelegramBriefingScheduler(): void {
  if (briefingTask) {
    briefingTask.stop();
    briefingTask = null;
  }

  briefingTask = cron.schedule(
    '30 8 * * 1-5', // 8:30 AM Monday–Friday
    async () => {
      await runDailyBriefing();
    },
    {
      timezone: 'America/Denver', // Mountain Time (handles MDT/MST DST automatically)
    },
  );

  console.log(
    '[Telegram Briefing] Scheduler initialized. Will send at 8:30 AM MT every weekday.',
  );
}

/**
 * Export for manual triggering (dev endpoint / testing).
 */
export async function triggerDailyBriefingNow(): Promise<void> {
  await runDailyBriefing();
}
