/**
 * Telegram Inbound Command Handler
 *
 * Processes text messages and slash commands sent to @Prospertrading_bot.
 * Only responds to messages from the authorized TELEGRAM_CHAT_ID owner.
 *
 * Supported commands:
 *   /help        — List all available commands
 *   /briefing    — Send today's full morning briefing immediately
 *   /positions   — List all open short option positions
 *   /pnl         — Portfolio P&L summary (% captured, dollar amounts)
 *   /expiring    — Positions expiring within 7 days
 *   /close       — Positions ≥90% captured (ready to close for profit)
 *   /orders      — Recent working orders (last 10)
 *   /status      — Server status (uptime, market hours, next briefing)
 */

import { sendTelegramMessage } from './telegram';

const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

// ─── Security guard ───────────────────────────────────────────────────────────

function isAuthorized(chatId: number | string): boolean {
  return String(chatId) === String(OWNER_CHAT_ID);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDTE = (expDateStr: string): number => {
  if (!expDateStr) return 999;
  const today = new Date();
  const exp = new Date(expDateStr + 'T16:00:00');
  const diffMs = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
};

const calcPremiumCaptured = (openPrice: number, currentMark: number): number | null => {
  if (openPrice <= 0) return null;
  const pct = ((openPrice - currentMark) / openPrice) * 100;
  return Math.min(100, Math.max(0, pct));
};

const pctBadge = (pct: number): string => {
  if (pct >= 90) return '🟢';
  if (pct >= 50) return '🟡';
  if (pct >= 25) return '🟠';
  return '🔴';
};

const fmtCurrency = (n: number): string =>
  n >= 0 ? `+$${n.toFixed(0)}` : `-$${Math.abs(n).toFixed(0)}`;

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleHelp(): Promise<string> {
  return (
    `🤖 <b>Prosper Trading Bot — Commands</b>\n\n` +
    `<b>Portfolio</b>\n` +
    `  /briefing — Full morning briefing\n` +
    `  /positions — All open short positions\n` +
    `  /pnl — P&amp;L summary (% captured)\n` +
    `  /expiring — Positions expiring ≤7 DTE\n` +
    `  /close — Ready to close (≥90% captured)\n\n` +
    `<b>Orders</b>\n` +
    `  /orders — Recent working orders\n\n` +
    `<b>System</b>\n` +
    `  /status — Server status &amp; next briefing time\n` +
    `  /help — Show this message\n\n` +
    `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`
  );
}

async function handleBriefing(userId: number): Promise<string> {
  const { triggerDailyBriefingNow } = await import('./telegram-briefing');
  await triggerDailyBriefingNow();
  // triggerDailyBriefingNow sends the message itself — return a confirmation
  return `📬 Briefing sent! Check above for the full report.`;
}

async function handlePositions(userId: number): Promise<string> {
  const { getLivePositions } = await import('./portfolio-sync');
  const positions = await getLivePositions(userId);

  const shortOptions = positions.filter(
    (p: Record<string, any>) =>
      (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
      (p['quantity-direction'] || '').toLowerCase() === 'short',
  );

  if (shortOptions.length === 0) {
    return `📭 <b>No open short option positions found.</b>\n\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  }

  // Group by underlying
  const byUnderlying = new Map<string, typeof shortOptions>();
  for (const p of shortOptions) {
    const sym = (p['underlying-symbol'] || p.symbol || 'UNKNOWN').trim();
    if (!byUnderlying.has(sym)) byUnderlying.set(sym, []);
    byUnderlying.get(sym)!.push(p);
  }

  let msg = `📋 <b>Open Short Positions (${shortOptions.length})</b>\n\n`;
  for (const [sym, posGroup] of Array.from(byUnderlying.entries()).slice(0, 15)) {
    for (const p of posGroup) {
      const qty = Math.abs(parseFloat(p.quantity || '1'));
      const openPrice = parseFloat(p['average-open-price'] || '0');
      const mark = parseFloat(p['close-price'] || p.mark || '0');
      const exp = p['expiration-date'] || p['expires-at'] || '';
      const dte = getDTE(exp);
      const capturedPct = calcPremiumCaptured(openPrice, mark);
      const badge = capturedPct !== null ? pctBadge(capturedPct) : '⚪';
      const pctStr = capturedPct !== null ? ` ${badge}${capturedPct.toFixed(0)}%` : '';
      const acct = (p['account-number'] || '').slice(-4);
      msg += `  <b>${sym}</b> ×${qty} · ${dte}d · $${openPrice.toFixed(2)}→$${mark.toFixed(2)}${pctStr} [···${acct}]\n`;
    }
  }
  if (shortOptions.length > 15) {
    msg += `  <i>…and ${shortOptions.length - 15} more</i>\n`;
  }
  msg += `\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  return msg;
}

async function handlePnl(userId: number): Promise<string> {
  const { getLivePositions } = await import('./portfolio-sync');
  const positions = await getLivePositions(userId);

  const shortOptions = positions.filter(
    (p: Record<string, any>) =>
      (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
      (p['quantity-direction'] || '').toLowerCase() === 'short',
  );

  if (shortOptions.length === 0) {
    return `📭 <b>No open short positions.</b>`;
  }

  let totalOpen = 0;
  let totalCurrent = 0;
  const bySymbol: Array<{ sym: string; openPremium: number; captured: number; pct: number }> = [];

  for (const p of shortOptions) {
    const qty = Math.abs(parseFloat(p.quantity || '1'));
    const mult = parseFloat(p.multiplier || '100');
    const openPrice = parseFloat(p['average-open-price'] || '0');
    const mark = parseFloat(p['close-price'] || p.mark || '0');
    const openPremium = openPrice * qty * mult;
    const currentValue = mark * qty * mult;
    totalOpen += openPremium;
    totalCurrent += currentValue;
    const sym = (p['underlying-symbol'] || p.symbol || '?').trim();
    const pct = calcPremiumCaptured(openPrice, mark) ?? 0;
    bySymbol.push({ sym, openPremium, captured: openPremium - currentValue, pct });
  }

  const totalCaptured = totalOpen - totalCurrent;
  const totalPct = totalOpen > 0 ? (totalCaptured / totalOpen) * 100 : 0;

  // Sort by % captured descending
  bySymbol.sort((a, b) => b.pct - a.pct);

  let msg = `💰 <b>Portfolio P&amp;L Summary</b>\n\n`;
  msg += `📊 Positions: ${shortOptions.length}\n`;
  msg += `💵 Original Premium: $${totalOpen.toFixed(0)}\n`;
  msg += `${pctBadge(totalPct)} Captured: $${totalCaptured.toFixed(0)} (${totalPct.toFixed(0)}%)\n`;
  msg += `💸 Remaining at Risk: $${totalCurrent.toFixed(0)}\n\n`;
  msg += `<b>By Symbol:</b>\n`;

  for (const item of bySymbol.slice(0, 12)) {
    const badge = pctBadge(item.pct);
    msg += `  ${badge} <b>${item.sym}</b> — ${item.pct.toFixed(0)}% (${fmtCurrency(item.captured)}/$${item.openPremium.toFixed(0)})\n`;
  }
  if (bySymbol.length > 12) {
    msg += `  <i>…and ${bySymbol.length - 12} more</i>\n`;
  }
  msg += `\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  return msg;
}

async function handleExpiring(userId: number): Promise<string> {
  const { getLivePositions } = await import('./portfolio-sync');
  const positions = await getLivePositions(userId);

  const shortOptions = positions.filter(
    (p: Record<string, any>) =>
      (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
      (p['quantity-direction'] || '').toLowerCase() === 'short',
  );

  const expiring = shortOptions
    .map((p: Record<string, any>) => {
      const exp = p['expiration-date'] || p['expires-at'] || '';
      const dte = getDTE(exp);
      const openPrice = parseFloat(p['average-open-price'] || '0');
      const mark = parseFloat(p['close-price'] || p.mark || '0');
      const qty = Math.abs(parseFloat(p.quantity || '1'));
      const mult = parseFloat(p.multiplier || '100');
      const capturedPct = calcPremiumCaptured(openPrice, mark);
      const openPremium = openPrice * qty * mult;
      const captured = (openPrice - mark) * qty * mult;
      return {
        sym: (p['underlying-symbol'] || p.symbol || '?').trim(),
        dte,
        qty,
        capturedPct,
        openPremium,
        captured,
        acct: (p['account-number'] || '').slice(-4),
      };
    })
    .filter((p: any) => p.dte <= 7)
    .sort((a: any, b: any) => a.dte - b.dte);

  if (expiring.length === 0) {
    return `✅ <b>No positions expiring within 7 days.</b>\n\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  }

  let msg = `⚠️ <b>Expiring ≤7 DTE (${expiring.length})</b>\n\n`;
  for (const p of expiring) {
    const dteBadge = p.dte === 0 ? '🔴 TODAY' : p.dte <= 2 ? `🔴 ${p.dte}d` : `🟡 ${p.dte}d`;
    const pctStr = p.capturedPct !== null
      ? ` ${pctBadge(p.capturedPct)}${p.capturedPct.toFixed(0)}% ($${p.captured.toFixed(0)}/$${p.openPremium.toFixed(0)})`
      : '';
    msg += `  ${dteBadge} <b>${p.sym}</b> ×${p.qty}${pctStr} [···${p.acct}]\n`;
  }
  msg += `\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  return msg;
}

async function handleClose(userId: number): Promise<string> {
  const { getLivePositions } = await import('./portfolio-sync');
  const positions = await getLivePositions(userId);

  const shortOptions = positions.filter(
    (p: Record<string, any>) =>
      (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
      (p['quantity-direction'] || '').toLowerCase() === 'short',
  );

  const readyToClose = shortOptions
    .map((p: Record<string, any>) => {
      const openPrice = parseFloat(p['average-open-price'] || '0');
      const mark = parseFloat(p['close-price'] || p.mark || '0');
      const qty = Math.abs(parseFloat(p.quantity || '1'));
      const mult = parseFloat(p.multiplier || '100');
      const capturedPct = calcPremiumCaptured(openPrice, mark);
      const openPremium = openPrice * qty * mult;
      const captured = (openPrice - mark) * qty * mult;
      const exp = p['expiration-date'] || p['expires-at'] || '';
      const dte = getDTE(exp);
      return {
        sym: (p['underlying-symbol'] || p.symbol || '?').trim(),
        dte,
        qty,
        capturedPct,
        openPremium,
        captured,
        acct: (p['account-number'] || '').slice(-4),
      };
    })
    .filter((p: any) => p.capturedPct !== null && p.capturedPct >= 90)
    .sort((a: any, b: any) => (b.capturedPct ?? 0) - (a.capturedPct ?? 0));

  if (readyToClose.length === 0) {
    return `📭 <b>No positions at ≥90% captured yet.</b>\n\nCheck back later or run /pnl to see current P&amp;L.\n\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  }

  let msg = `💸 <b>Ready to Close for Profit (${readyToClose.length})</b>\n`;
  msg += `<i>Positions ≥90% premium captured</i>\n\n`;
  for (const p of readyToClose) {
    msg += `  🟢 <b>${p.sym}</b> ×${p.qty} — ${p.capturedPct?.toFixed(0)}% captured · $${p.captured.toFixed(0)} locked in · ${p.dte}d left [···${p.acct}]\n`;
  }
  msg += `\n<a href="https://prospertrading.biz/performance">🔗 Close Positions</a>`;
  return msg;
}

async function handleOrders(userId: number): Promise<string> {
  try {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) return `⚠️ Database not available.`;

      const { tradingLog } = await import('../drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');

      const logs = await db
        .select()
        .from(tradingLog)
        .where(eq(tradingLog.userId, userId))
        .orderBy(desc(tradingLog.createdAt))
      .limit(10);

    if (logs.length === 0) {
      return `📭 <b>No recent orders found.</b>`;
    }

    let msg = `📝 <b>Recent Orders (last ${logs.length})</b>\n\n`;
    for (const log of logs) {
      const date = log.createdAt ? new Date(log.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
      const statusIcon = log.outcome === 'filled' || log.outcome === 'success' ? '✅' : log.outcome === 'rejected' || log.outcome === 'error' ? '❌' : log.outcome === 'dry_run' ? '🧪' : '⏳';
      const price = log.price ? ` · $${parseFloat(String(log.price)).toFixed(2)}` : '';
      msg += `  ${statusIcon} <b>${log.symbol || '?'}</b> ${log.strategy || ''} ${log.action || ''}${price} · ${date}\n`;
    }
    msg += `\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
    return msg;
  } catch (err: any) {
    return `⚠️ Could not fetch orders: ${err.message}`;
  }
}

async function handleStatus(): Promise<string> {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const now = new Date();
  const mtNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const hour = mtNow.getHours();
  const isWeekday = mtNow.getDay() >= 1 && mtNow.getDay() <= 5;
  const isMarketHours = isWeekday && hour >= 9 && hour < 16;
  const marketStatus = isMarketHours ? '🟢 Market Open' : '🔴 Market Closed';

  // Next briefing: next weekday at 8:30 AM MT
  const nextBriefingDay = isWeekday && hour < 8 ? 'Today' : isWeekday && hour === 8 && mtNow.getMinutes() < 30 ? 'Today' : 'Next weekday';

  return (
    `⚙️ <b>Prosper Trading — Server Status</b>\n\n` +
    `🟢 <b>Server:</b> Online\n` +
    `⏱️ <b>Uptime:</b> ${hours}h ${minutes}m\n` +
    `📈 <b>Market:</b> ${marketStatus}\n` +
    `🕗 <b>Next Briefing:</b> ${nextBriefingDay} at 8:30 AM MT\n\n` +
    `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Process an inbound Telegram message.
 * Called from the Express webhook route when update.message is present.
 */
export async function handleTelegramCommand(update: {
  message?: {
    chat: { id: number };
    from?: { id: number; first_name?: string };
    text?: string;
    message_id: number;
  };
}): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Security: only respond to the authorized owner
  if (!isAuthorized(chatId)) {
    console.warn(`[Telegram] Unauthorized message from chat ${chatId}: ${text}`);
    return;
  }

  // Extract command (strip @BotName suffix if present)
  const rawCommand = text.split(' ')[0].toLowerCase().replace(/@\w+$/, '');
  console.log(`[Telegram] Command received from ${chatId}: ${rawCommand}`);

  // Find the owner's userId from DB (needed for position lookups)
  let ownerUserId = 1; // fallback
  try {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (db) {
      const { users } = await import('../drizzle/schema');
      const allUsers = await db.select({ id: users.id }).from(users).limit(1);
      if (allUsers.length > 0) ownerUserId = allUsers[0].id;
    }
  } catch { /* use fallback */ }

  let response = '';
  try {
    switch (rawCommand) {
      case '/test':
      case 'test':
        response =
          `✅ <b>Prosper Trading Bot is working!</b>\n\n` +
          `Your bot token and chat ID are correctly configured.\n` +
          `Send /help to see all available commands.\n\n` +
          `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
        break;
      case '/help':
      case 'help':
        response = await handleHelp();
        break;
      case '/briefing':
      case 'briefing':
        await sendTelegramMessage(`⏳ Fetching your briefing...`);
        await handleBriefing(ownerUserId);
        return; // briefing sends its own message
      case '/positions':
      case 'positions':
        await sendTelegramMessage(`⏳ Loading positions...`);
        response = await handlePositions(ownerUserId);
        break;
      case '/pnl':
      case 'pnl':
        await sendTelegramMessage(`⏳ Calculating P&L...`);
        response = await handlePnl(ownerUserId);
        break;
      case '/expiring':
      case 'expiring':
        response = await handleExpiring(ownerUserId);
        break;
      case '/close':
      case 'close':
        response = await handleClose(ownerUserId);
        break;
      case '/orders':
      case 'orders':
        response = await handleOrders(ownerUserId);
        break;
      case '/status':
      case 'status':
        response = await handleStatus();
        break;
      default:
        response =
          `❓ Unknown command: <code>${rawCommand}</code>\n\n` +
          `Send /help to see all available commands.`;
    }
  } catch (err: any) {
    console.error(`[Telegram] Command handler error for ${rawCommand}:`, err.message);
    response = `⚠️ Error processing command: ${err.message}\n\nTry again or check the dashboard.`;
  }

  if (response) {
    await sendTelegramMessage(response);
  }
}
