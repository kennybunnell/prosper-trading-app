/**
 * Telegram Daily Morning Briefing
 *
 * Sends a formatted portfolio summary to the Telegram bot every weekday at
 * 8:30 AM Mountain Time (America/Denver timezone, handles MDT/MST automatically).
 *
 * Content:
 *  - Short positions expiring within 7 days (DTE alert)
 *  - Total open short premium across all accounts
 *  - Link to open the dashboard
 */
import * as cron from 'node-cron';
import { sendTelegramMessage } from './telegram';

let briefingTask: cron.ScheduledTask | null = null;

// ─── DTE Helper ───────────────────────────────────────────────────────────────

const getDTE = (expDateStr: string): number => {
  if (!expDateStr) return 999;
  const today = new Date();
  const exp = new Date(expDateStr + 'T16:00:00'); // 4pm ET = options expiry
  const diffMs = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
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

    // ── Expiring soon (≤7 DTE) ────────────────────────────────────────────────
    interface ExpiringPos {
      symbol: string;
      expiration: string;
      dte: number;
      qty: number;
      account: string;
    }
    const expiringSoon: ExpiringPos[] = shortPositions
      .map((p: Record<string, any>) => ({
        symbol: (p['underlying-symbol'] || p.symbol || '').trim() as string,
        expiration: (p['expiration-date'] || '') as string,
        dte: getDTE(p['expiration-date'] || ''),
        qty: Math.abs(parseFloat(p.quantity || '1')),
        account: (p['account-number'] || '').slice(-4) as string,
      }))
      .filter((p: ExpiringPos) => p.dte <= 7)
      .sort((a: ExpiringPos, b: ExpiringPos) => a.dte - b.dte);

    // ── Total open premium (sum of mark × qty × 100 for short positions) ─────
    const totalOpenPremium = shortPositions.reduce(
      (sum: number, p: Record<string, any>) => {
        const qty = Math.abs(parseFloat(p.quantity || '1'));
        const mark = parseFloat(p.mark || p['close-price'] || '0');
        return sum + mark * qty * 100;
      },
      0,
    );

    // ── Format message ────────────────────────────────────────────────────────
    const dateStr = today.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    let msg = `🌅 <b>Good morning, Kenny!</b>\n`;
    msg += `📅 <b>${dateStr}</b> — Daily Briefing\n\n`;

    // Open positions summary
    msg += `📊 <b>Open Short Positions:</b> ${shortPositions.length}\n`;
    msg += `💰 <b>Total Open Premium:</b> $${totalOpenPremium.toFixed(0)}\n\n`;

    // Expiring soon
    if (expiringSoon.length > 0) {
      msg += `⚠️ <b>Expiring ≤7 DTE (${expiringSoon.length}):</b>\n`;
      for (const p of expiringSoon.slice(0, 8)) {
        const dteBadge =
          p.dte === 0 ? '🔴 TODAY' : p.dte <= 2 ? `🔴 ${p.dte}d` : `🟡 ${p.dte}d`;
        msg += `  ${dteBadge} <b>${p.symbol}</b> ×${p.qty} exp ${p.expiration} [···${p.account}]\n`;
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

    // Get all users with Tastytrade credentials
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
