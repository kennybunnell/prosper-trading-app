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
 *   - currentMark = close-price (current market price to buy back)
 *
 * 0%  = position just opened (full premium still at risk)
 * 50% = half the premium has decayed away
 * 100% = option worth $0 (full premium captured, expires worthless)
 */
const calcPremiumCaptured = (
  openPrice: number,
  currentMark: number,
): number | null => {
  if (openPrice <= 0) return null;
  const pct = ((openPrice - currentMark) / openPrice) * 100;
  return Math.min(100, Math.max(0, pct)); // clamp 0–100
};

/** Emoji badge for % captured */
const pctBadge = (pct: number): string => {
  if (pct >= 90) return '🟢';  // Close for profit territory
  if (pct >= 50) return '🟡';  // Halfway there
  if (pct >= 25) return '🟠';  // Early stage
  return '🔴';                  // Still at risk / ITM
};

// ─── Briefing Content Builder ─────────────────────────────────────────────────

async function buildBriefing(userId: number): Promise<string> {
  try {
    const { getLivePositions } = await import('./portfolio-sync');
    const positions = await getLivePositions(userId);

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

    // ── Remaining value (what it would cost to close all) ─────────────────────
    const totalCurrentValue = shortPositions.reduce(
      (sum: number, p: Record<string, any>) => {
        const qty = Math.abs(parseFloat(p.quantity || '1'));
        const mark = parseFloat(p['close-price'] || p.mark || '0');
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
        const currentMark = parseFloat(p['close-price'] || p.mark || '0');
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
        const currentMark = parseFloat(p['close-price'] || p.mark || '0');
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

    let msg = `🌅 <b>Good morning, Kenny!</b>\n`;
    msg += `📅 <b>${dateStr}</b> — Daily Briefing\n\n`;

    // Portfolio summary
    msg += `📊 <b>Open Short Positions:</b> ${shortPositions.length}\n`;
    msg += `💰 <b>Original Premium:</b> $${totalOpenPremium.toFixed(0)}\n`;
    if (totalOpenPremium > 0) {
      const badge = pctBadge(totalCapturedPct);
      msg += `${badge} <b>Captured:</b> $${totalCaptured.toFixed(0)} (${totalCapturedPct.toFixed(0)}%)\n`;
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
          const capturedDollar = p.capturedTotal.toFixed(0);
          const openDollar = p.openPremiumTotal.toFixed(0);
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

// ─── Run Briefing for All Users ───────────────────────────────────────────────

async function runDailyBriefing(): Promise<void> {
  console.log('[Telegram Briefing] Running daily morning briefing...');
  try {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) {
      console.error('[Telegram Briefing] Database not available');
      return;
    }

    const { apiCredentials } = await import('../drizzle/schema');
    const { isNotNull } = await import('drizzle-orm');
    const usersWithCreds: Array<{ userId: number }> = await db
      .select({ userId: apiCredentials.userId })
      .from(apiCredentials)
      .where(isNotNull(apiCredentials.tastytradeRefreshToken));

    for (const user of usersWithCreds) {
      try {
        const message = await buildBriefing(user.userId);
        await sendTelegramMessage(message);
        console.log(`[Telegram Briefing] Sent briefing for user ${user.userId}`);
      } catch (err: any) {
        console.error(
          `[Telegram Briefing] Failed for user ${user.userId}:`,
          err.message,
        );
      }
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
