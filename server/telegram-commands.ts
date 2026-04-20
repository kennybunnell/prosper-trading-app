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
import { invokeLLM } from './_core/llm';

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
    `🤖 <b>Prosper Trading Bot</b>\n\n` +
    `You can ask me anything in plain English — no commands needed!\n` +
    `<i>Example: "What's my total premium this month?" or "Which positions are expiring soon?"</i>\n\n` +
    `<b>Quick Commands</b>\n` +
    `  /briefing — Full morning briefing
` +
    `  /premium — Net premium summary (month &amp; YTD)
` +
    `  /positions — All open short positions
` +
    `  /pnl — P&amp;L summary (% captured)
` +
    `  /expiring — Positions expiring ≤7 DTE
` +
    `  /close — Ready to close (≥90% captured)
` +
    `  /orders — Recent working orders
` +
    `  /status — Server status &amp; next briefing time\n` +
  `  /sync — Force immediate cache refresh from Tastytrade\n\n` +
    `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`
  );
}

async function handleBriefing(userId: number): Promise<string> {
  const { triggerDailyBriefingNow } = await import('./telegram-briefing');
  await triggerDailyBriefingNow();
  // triggerDailyBriefingNow sends the message itself — return a confirmation
  return `📬 Briefing sent! Check above for the full report.`;
}

async function getPositionsFromCache(userId: number): Promise<Record<string, any>[]> {
  const { getCachedPositions, cachedPosToWireFormat } = await import('./portfolio-sync');
  const cached = await getCachedPositions(userId);
  return cached.map(p => cachedPosToWireFormat({ ...p, quantityDirection: p.quantityDirection ?? '' }));
}

async function handlePositions(userId: number): Promise<string> {
  const positions = await getPositionsFromCache(userId);

  const shortOptions = positions.filter(
    (p: Record<string, any>) =>
      (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
      (p['quantity-direction'] || '').toLowerCase() === 'short',
  );

  if (shortOptions.length === 0) {
    return `📭 <b>No open short option positions found.</b>\n\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  }

  // Sort by DTE ascending (soonest expiry first)
  shortOptions.sort((a: Record<string, any>, b: Record<string, any>) => {
    const dteA = getDTE(a['expiration-date'] || a['expires-at'] || '');
    const dteB = getDTE(b['expiration-date'] || b['expires-at'] || '');
    return dteA - dteB;
  });

  // Group by underlying symbol
  const byUnderlying = new Map<string, typeof shortOptions>();
  for (const p of shortOptions) {
    const sym = (p['underlying-symbol'] || p.symbol || 'UNKNOWN').trim();
    if (!byUnderlying.has(sym)) byUnderlying.set(sym, []);
    byUnderlying.get(sym)!.push(p);
  }

  // Calculate totals
  let totalOpenPremium = 0;
  let totalCurrentValue = 0;
  for (const p of shortOptions) {
    const qty = Math.abs(parseFloat(p.quantity || '1'));
    const mult = parseFloat(p.multiplier || '100');
    const openPrice = parseFloat(p['average-open-price'] || '0');
    const mark = parseFloat(p['close-price'] || '0');
    totalOpenPremium += openPrice * qty * mult;
    totalCurrentValue += mark * qty * mult;
  }
  const totalCaptured = totalOpenPremium - totalCurrentValue;
  const totalPct = totalOpenPremium > 0 ? (totalCaptured / totalOpenPremium * 100) : 0;
  const totalBadge = totalPct >= 50 ? '🟢' : totalPct >= 25 ? '🟡' : totalPct >= 0 ? '🟠' : '🔴';

  let msg = `📋 <b>Open Short Positions (${shortOptions.length})</b>\n`;
  msg += `${totalBadge} Portfolio: $${totalOpenPremium.toFixed(0)} open · $${totalCaptured.toFixed(0)} captured (${totalPct.toFixed(0)}%)\n\n`;

  // Show up to 20 symbols, sorted by earliest expiry
  const symEntries = Array.from(byUnderlying.entries());
  let shown = 0;
  for (const [sym, posGroup] of symEntries) {
    if (shown >= 20) break;
    msg += `<b>${sym}</b>\n`;
    for (const p of posGroup) {
      const qty = Math.abs(parseFloat(p.quantity || '1'));
      const mult = parseFloat(p.multiplier || '100');
      const openPrice = parseFloat(p['average-open-price'] || '0');
      const mark = parseFloat(p['close-price'] || '0');
      const exp = p['expiration-date'] || p['expires-at'] || '';
      const dte = getDTE(exp);
      const strike = parseFloat(p['strike-price'] || '0');
      const optType = (p['option-type'] || '').toUpperCase();
      const capturedPct = calcPremiumCaptured(openPrice, mark);
      const badge = capturedPct !== null ? pctBadge(capturedPct) : '⚪';
      const pctStr = capturedPct !== null
        ? (capturedPct < 0 ? ` 🔴${capturedPct.toFixed(0)}%` : ` ${badge}${capturedPct.toFixed(0)}%`)
        : '';
      const strikeStr = strike > 0 ? `$${strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(1)}${optType}` : '';
      const expShort = exp ? exp.slice(5) : '?'; // MM-DD
      const premium = openPrice * qty * mult;
      msg += `  ${strikeStr} ×${qty} exp ${expShort} (${dte}d) · open $${openPrice.toFixed(2)} → $${mark.toFixed(2)}${pctStr} · $${premium.toFixed(0)}\n`;
    }
    shown++;
  }
  if (byUnderlying.size > 20) {
    msg += `<i>…and ${byUnderlying.size - 20} more symbols</i>\n`;
  }
  msg += `\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
  return msg;
}

async function handlePnl(userId: number): Promise<string> {
  const positions = await getPositionsFromCache(userId);

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
  const positions = await getPositionsFromCache(userId);

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
  const positions = await getPositionsFromCache(userId);

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

// ─── AI Free-Form Question Handler ──────────────────────────────────────────

// ─── /premium — Instant net premium summary ──────────────────────────────────

async function handlePremium(userId: number): Promise<string> {
  try {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) return '⚠️ Database unavailable. Please try again shortly.';

    const { cachedTransactions } = await import('../drizzle/schema');
    const { eq, and, gte } = await import('drizzle-orm');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear  = new Date(now.getFullYear(), 0, 1);
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    const year = now.getFullYear();

    // Fetch all YTD option trades (Trade type only)
    const ytdTxns = await db
      .select()
      .from(cachedTransactions)
      .where(
        and(
          eq(cachedTransactions.userId, userId),
          gte(cachedTransactions.executedAt, startOfYear),
          eq(cachedTransactions.transactionType, 'Trade'),
        ),
      );

    const sumAbs = (txns: typeof ytdTxns) =>
      txns.reduce((s, t) => s + Math.abs(parseFloat(t.netValue || t.value || '0')), 0);

    // YTD breakdown
    const ytdSto  = ytdTxns.filter(t => t.action === 'Sell to Open');
    const ytdBtc  = ytdTxns.filter(t => t.action === 'Buy to Close');
    const ytdStc  = ytdTxns.filter(t => t.action === 'Sell to Close');
    const ytdBto  = ytdTxns.filter(t => t.action === 'Buy to Open');
    const ytdGross      = sumAbs(ytdSto);
    const ytdBtcPaid    = sumAbs(ytdBtc);
    const ytdStcCredit  = sumAbs(ytdStc);
    const ytdBtoPaid    = sumAbs(ytdBto);
    const ytdNet = (ytdGross + ytdStcCredit) - (ytdBtcPaid + ytdBtoPaid);

    // Current month breakdown
    const monthTxns    = ytdTxns.filter(t => t.executedAt && new Date(t.executedAt) >= startOfMonth);
    const monthSto     = monthTxns.filter(t => t.action === 'Sell to Open');
    const monthBtc     = monthTxns.filter(t => t.action === 'Buy to Close');
    const monthStc     = monthTxns.filter(t => t.action === 'Sell to Close');
    const monthBto     = monthTxns.filter(t => t.action === 'Buy to Open');
    const monthGross      = sumAbs(monthSto);
    const monthBtcPaid    = sumAbs(monthBtc);
    const monthStcCredit  = sumAbs(monthStc);
    const monthBtoPaid    = sumAbs(monthBto);
    const monthNet = (monthGross + monthStcCredit) - (monthBtcPaid + monthBtoPaid);

    // Progress bar toward $100k monthly target (adjust if you change your target)
    const TARGET = 100_000;
    const pct = Math.min(100, (monthNet / TARGET) * 100);
    const filledBars = Math.round(pct / 10);
    const progressBar = '█'.repeat(filledBars) + '░'.repeat(10 - filledBars);

    // Cache age
    const lastTxn = ytdTxns.sort((a, b) =>
      new Date(b.executedAt ?? 0).getTime() - new Date(a.executedAt ?? 0).getTime()
    )[0];
    const cacheAge = lastTxn?.executedAt
      ? Math.round((Date.now() - new Date(lastTxn.executedAt).getTime()) / 60_000)
      : null;
    const cacheNote = cacheAge !== null
      ? `\n<i>Cache: last fill ~${cacheAge}m ago · syncs every 15m</i>`
      : '';

    return (
      `💰 <b>Premium Summary</b>\n\n` +
      `<b>${monthName} ${year}</b>\n` +
      `  📥 STO collected:  <b>$${monthGross.toLocaleString('en-US', {maximumFractionDigits:0})}</b> (${monthSto.length} trades)\n` +
      `  📥 STC credits:   +$${monthStcCredit.toLocaleString('en-US', {maximumFractionDigits:0})} (${monthStc.length} trades)\n` +
      `  📤 BTC buybacks:  -$${monthBtcPaid.toLocaleString('en-US', {maximumFractionDigits:0})} (${monthBtc.length} trades)\n` +
      `  📤 BTO debits:    -$${monthBtoPaid.toLocaleString('en-US', {maximumFractionDigits:0})} (${monthBto.length} trades)\n` +
      `  ─────────────────────────\n` +
      `  ✅ <b>NET: $${monthNet.toLocaleString('en-US', {maximumFractionDigits:0})}</b>  (${pct.toFixed(1)}% of $100k target)\n` +
      `  ${progressBar} ${pct.toFixed(0)}%\n\n` +
      `<b>YTD ${year}</b>\n` +
      `  STO: $${ytdGross.toLocaleString('en-US', {maximumFractionDigits:0})}  STC: +$${ytdStcCredit.toLocaleString('en-US', {maximumFractionDigits:0})}\n` +
      `  BTC: -$${ytdBtcPaid.toLocaleString('en-US', {maximumFractionDigits:0})}  BTO: -$${ytdBtoPaid.toLocaleString('en-US', {maximumFractionDigits:0})}\n` +
      `  ✅ <b>YTD NET: $${ytdNet.toLocaleString('en-US', {maximumFractionDigits:0})}</b>${cacheNote}\n\n` +
      `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`
    );
  } catch (err: any) {
    console.error('[Telegram /premium] Error:', err.message);
    return `⚠️ Could not fetch premium data: ${err.message}`;
  }
}

async function handleAiQuestion(userId: number, question: string): Promise<string> {
  try {
    // ── Build portfolio context snapshot ──────────────────────────────────────
    const { getDb } = await import('./db');

    let positionContext = 'No position data available.';
    let premiumContext = 'No order history available.';

    try {
      const positions = await getPositionsFromCache(userId);
      const shortOptions = positions.filter(
        (p: Record<string, any>) =>
          (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
          (p['quantity-direction'] || '').toLowerCase() === 'short',
      );

      if (shortOptions.length > 0) {
        let totalOpen = 0;
        let totalCurrent = 0;
        const bySymbol: string[] = [];

        for (const p of shortOptions) {
          const qty = Math.abs(parseFloat(p.quantity || '1'));
          const mult = parseFloat(p.multiplier || '100');
          const openPrice = parseFloat(p['average-open-price'] || '0');
          const mark = parseFloat(p['close-price'] || '0');
          const openPremium = openPrice * qty * mult;
          const currentValue = mark * qty * mult;
          totalOpen += openPremium;
          totalCurrent += currentValue;
          const sym = (p['underlying-symbol'] || p.symbol || '?').trim();
          const exp = p['expiration-date'] || p['expires-at'] || '';
          const dte = getDTE(exp);
          const pct = openPrice > 0 ? ((openPrice - mark) / openPrice * 100).toFixed(0) : '?';
          bySymbol.push(`${sym} x${qty} exp ${exp} (${dte}d) open=$${openPrice.toFixed(2)} mark=$${mark.toFixed(2)} ${pct}% captured`);
        }

        const totalCaptured = totalOpen - totalCurrent;
        const totalPct = totalOpen > 0 ? (totalCaptured / totalOpen * 100).toFixed(0) : '0';
        positionContext = `Open short option positions: ${shortOptions.length}\n` +
          `Total original premium: $${totalOpen.toFixed(0)}\n` +
          `Total captured so far: $${totalCaptured.toFixed(0)} (${totalPct}%)\n` +
          `Remaining at risk (cost to close all): $${totalCurrent.toFixed(0)}\n\n` +
          `Individual positions:\n` + bySymbol.slice(0, 30).join('\n');
      } else {
        positionContext = 'No open short option positions found.';
      }
    } catch (posErr: any) {
      positionContext = `Could not fetch live positions: ${posErr.message}`;
    }

    // ── Monthly and YTD premium from cached_transactions (real Tastytrade fills) ─
    try {
      const db = await getDb();
      if (db) {
        const { cachedTransactions } = await import('../drizzle/schema');
        const { eq, and, gte, sql } = await import('drizzle-orm');

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        // Fetch all YTD option trades for this user
        const ytdTxns = await db
          .select()
          .from(cachedTransactions)
          .where(
            and(
              eq(cachedTransactions.userId, userId),
              gte(cachedTransactions.executedAt, startOfYear),
              eq(cachedTransactions.transactionType, 'Trade'),
            ),
          );

        // Net premium = (STO + STC credits) - (BTC + BTO debits)
        // All values stored as positive numbers in DB regardless of direction
        const sumAbs = (txns: typeof ytdTxns) =>
          txns.reduce((sum, t) => sum + Math.abs(parseFloat(t.netValue || t.value || '0')), 0);

        const ytdSto = ytdTxns.filter(t => t.action === 'Sell to Open');
        const ytdBtc = ytdTxns.filter(t => t.action === 'Buy to Close');
        const ytdStc = ytdTxns.filter(t => t.action === 'Sell to Close');
        const ytdBto = ytdTxns.filter(t => t.action === 'Buy to Open');
        const ytdGross = sumAbs(ytdSto);  // gross STO only
        const ytdBtcPaid = sumAbs(ytdBtc);
        const ytdStcCredit = sumAbs(ytdStc);
        const ytdBtoPaid = sumAbs(ytdBto);
        // Net = all credits (STO + STC) minus all debits (BTC + BTO)
        const ytdNet = (ytdGross + ytdStcCredit) - (ytdBtcPaid + ytdBtoPaid);

        const monthTxns = ytdTxns.filter(t => t.executedAt && new Date(t.executedAt) >= startOfMonth);
        const monthSto = monthTxns.filter(t => t.action === 'Sell to Open');
        const monthBtc = monthTxns.filter(t => t.action === 'Buy to Close');
        const monthStc = monthTxns.filter(t => t.action === 'Sell to Close');
        const monthBto = monthTxns.filter(t => t.action === 'Buy to Open');
        const monthGross = sumAbs(monthSto);
        const monthBtcPaid = sumAbs(monthBtc);
        const monthStcCredit = sumAbs(monthStc);
        const monthBtoPaid = sumAbs(monthBto);
        const monthNet = (monthGross + monthStcCredit) - (monthBtcPaid + monthBtoPaid);

        const monthName = now.toLocaleString('en-US', { month: 'long' });
        premiumContext =
          `Premium for ${monthName} ${now.getFullYear()}:\n` +
          `  Gross STO collected: $${monthGross.toFixed(0)} (${monthSto.length} trades)\n` +
          `  STC credits: $${monthStcCredit.toFixed(0)} (${monthStc.length} trades)\n` +
          `  BTC paid: $${monthBtcPaid.toFixed(0)} (${monthBtc.length} trades)\n` +
          `  BTO paid: $${monthBtoPaid.toFixed(0)} (${monthBto.length} trades)\n` +
          `  NET premium (STO+STC-BTC-BTO): $${monthNet.toFixed(0)}\n\n` +
          `YTD ${now.getFullYear()} premium:\n` +
          `  Gross STO: $${ytdGross.toFixed(0)} | STC credits: $${ytdStcCredit.toFixed(0)}\n` +
          `  BTC paid: $${ytdBtcPaid.toFixed(0)} | BTO paid: $${ytdBtoPaid.toFixed(0)}\n` +
          `  NET YTD: $${ytdNet.toFixed(0)}\n` +
          `Data source: Tastytrade transaction history (${ytdTxns.length} option trades YTD)`;
      }
    } catch (dbErr: any) {
      premiumContext = `Could not fetch transaction history: ${dbErr.message}`;
    }

    // ── Current date/time context ─────────────────────────────────────────────
    const now = new Date();
    const mtNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const isWeekday = mtNow.getDay() >= 1 && mtNow.getDay() <= 5;
    const hour = mtNow.getHours();
    const isMarketOpen = isWeekday && hour >= 9 && hour < 16;
    const dateContext = `Current date/time: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${mtNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}\nMarket status: ${isMarketOpen ? 'Open' : 'Closed'}`;

    // ── Call LLM with full context ────────────────────────────────────────────
    const systemPrompt = `You are the Prosper Trading Bot, a personal options trading assistant for Kenny Bunnell. Kenny runs a premium-selling wheel strategy (CSPs, Covered Calls, Bull Put Spreads, Bear Call Spreads, Iron Condors) across multiple Tastytrade accounts (IRA, Cash, LLC).

You have access to Kenny's live portfolio data below. Answer his question concisely and specifically. Use dollar amounts, percentages, and contract counts where relevant. Keep responses under 300 words. Format using plain text — no markdown headers, use line breaks for readability. Use emojis sparingly for emphasis.

If the question is about something you don't have data for, say so clearly and suggest he check the dashboard.

--- PORTFOLIO CONTEXT ---
${positionContext}

--- PREMIUM HISTORY ---
${premiumContext}

--- DATE/TIME ---
${dateContext}`;

    const result = await invokeLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    });

    const answer = result.choices?.[0]?.message?.content || 'I could not generate a response. Please try again.';
    return `🤖 ${answer}\n\n<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;

  } catch (err: any) {
    console.error('[Telegram AI] Error handling question:', err.message);
    return `⚠️ I ran into an error while answering your question: ${err.message}\n\nTry a slash command like /briefing or /pnl instead.`;
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

// ─── Sync Handler ────────────────────────────────────────────────────────────

/**
 * /sync — Force an immediate DB cache refresh from Tastytrade.
 * Useful to get up-to-the-minute data before querying positions or premium.
 */
async function handleSync(userId: number): Promise<string> {
  try {
    await sendTelegramMessage(`🔄 <b>Syncing portfolio data...</b>\nFetching latest positions and transactions from Tastytrade. This may take 10–20 seconds.`);
    const { syncPortfolio } = await import('./portfolio-sync');
    const results = await syncPortfolio(userId, false);
    const totalPositions = results.reduce((s, r) => s + r.positionsSynced, 0);
    const totalTxns = results.reduce((s, r) => s + r.transactionsSynced, 0);
    const accountCount = results.length;
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    return (
      `✅ <b>Sync Complete!</b>\n\n` +
      `📊 <b>Accounts synced:</b> ${accountCount}\n` +
      `📋 <b>Positions updated:</b> ${totalPositions}\n` +
      `💰 <b>Transactions synced:</b> ${totalTxns}\n` +
      `🕐 <b>Synced at:</b> ${now}\n\n` +
      `Data is now current. Try /positions, /pnl, or /premium for fresh results.\n` +
      `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`
    );
  } catch (err: any) {
    console.error('[Telegram] /sync error:', err.message);
    return `⚠️ Sync failed: ${err.message}\n\nThe cache may be stale. Check Tastytrade credentials in Settings.`;
  }
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

  // Find the owner's userId from DB — use OWNER_OPEN_ID for reliable resolution
  let ownerUserId = 1; // fallback
  try {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (db) {
      const { users } = await import('../drizzle/schema');
      const { eq, asc } = await import('drizzle-orm');
      const ownerOpenId = process.env.OWNER_OPEN_ID;
      if (ownerOpenId) {
        const ownerRows = await db.select({ id: users.id }).from(users).where(eq(users.openId, ownerOpenId)).limit(1);
        if (ownerRows.length > 0) ownerUserId = ownerRows[0].id;
      } else {
        // Fallback: lowest ID user (most likely the owner)
        const firstUser = await db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1);
        if (firstUser.length > 0) ownerUserId = firstUser[0].id;
      }
    }
  } catch { /* use fallback */ }
  console.log(`[Telegram] Resolved ownerUserId=${ownerUserId} for command ${rawCommand}`);

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
      case '/premium':
      case 'premium':
        response = await handlePremium(ownerUserId);
        break;
      case '/orders':
      case 'orders':
        response = await handleOrders(ownerUserId);
        break;
      case '/status':
      case 'status':
        response = await handleStatus();
        break;
      case '/sync':
      case 'sync':
        response = await handleSync(ownerUserId);
        break;
      default:
        // Free-form natural language question — route to AI handler
        await sendTelegramMessage(`🤔 Let me check that for you...`);
        response = await handleAiQuestion(ownerUserId, text);
    }
  } catch (err: any) {
    console.error(`[Telegram] Command handler error for ${rawCommand}:`, err.message);
    response = `⚠️ Error processing command: ${err.message}\n\nTry again or check the dashboard.`;
  }

  if (response) {
    await sendTelegramMessage(response);
  }
}
