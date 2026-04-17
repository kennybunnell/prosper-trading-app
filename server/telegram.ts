/**
 * Telegram Bot Integration
 * Bot: @Prospertrading_bot
 *
 * Provides:
 *  - sendTelegramMessage()        — plain text notification
 *  - sendTelegramApproval()       — message with inline approval buttons
 *  - handleTelegramCallback()     — process button taps from Telegram
 *  - registerTelegramWebhook()    — one-time webhook registration
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? '';
const BASE_URL  = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TelegramButton {
  text: string;
  callbackData: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

// ─── Core send helpers ────────────────────────────────────────────────────────

/**
 * Send a plain text message to the owner's Telegram chat.
 * Uses MarkdownV2 formatting — escape special chars with escapeMarkdown().
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Missing BOT_TOKEN or CHAT_ID — skipping message');
    return false;
  }
  try {
    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const json = await res.json() as { ok: boolean; description?: string };
    if (!json.ok) console.error('[Telegram] sendMessage failed:', json.description);
    return json.ok;
  } catch (err) {
    console.error('[Telegram] sendMessage error:', err);
    return false;
  }
}

/**
 * Send a message with inline keyboard buttons (approval flow).
 * Each button carries a callbackData string that is returned when tapped.
 */
export async function sendTelegramApproval(
  text: string,
  buttons: TelegramButton[][],  // 2D array: rows of buttons
): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Missing BOT_TOKEN or CHAT_ID — skipping approval');
    return false;
  }
  try {
    const inline_keyboard = buttons.map(row =>
      row.map(btn => ({ text: btn.text, callback_data: btn.callbackData }))
    );
    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard },
      }),
    });
    const json = await res.json() as { ok: boolean; description?: string };
    if (!json.ok) console.error('[Telegram] sendApproval failed:', json.description);
    return json.ok;
  } catch (err) {
    console.error('[Telegram] sendApproval error:', err);
    return false;
  }
}

/**
 * Answer a callback query (removes the loading spinner on the button).
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BASE_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) {
    console.error('[Telegram] answerCallbackQuery error:', err);
  }
}

/**
 * Edit an existing message (e.g., update "Pending approval" to "✅ Submitted").
 */
export async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BASE_URL}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error('[Telegram] editMessage error:', err);
  }
}

// ─── Webhook registration ─────────────────────────────────────────────────────

/**
 * Register the webhook URL with Telegram.
 * Call once on server startup (idempotent — safe to call every time).
 */
export async function registerTelegramWebhook(appBaseUrl: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const webhookUrl = `${appBaseUrl}/api/telegram/webhook`;
  try {
    const res = await fetch(`${BASE_URL}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const json = await res.json() as { ok: boolean; description?: string };
    if (json.ok) {
      console.log(`[Telegram] Webhook registered: ${webhookUrl}`);
    } else {
      console.error('[Telegram] Webhook registration failed:', json.description);
    }
  } catch (err) {
    console.error('[Telegram] registerWebhook error:', err);
  }
}

// ─── Notification helpers (pre-formatted messages) ───────────────────────────

export function fmtOrderFilled(params: {
  symbol: string;
  strategy: string;
  strike: number;
  expiration: string;
  premium: number;
  accountLabel: string;
}): string {
  const { symbol, strategy, strike, expiration, premium, accountLabel } = params;
  return (
    `✅ <b>Order Filled</b>\n` +
    `<b>${symbol}</b> ${strategy} $${strike} · ${expiration}\n` +
    `Premium: <b>+$${premium.toFixed(2)}</b>\n` +
    `Account: ${accountLabel}`
  );
}

export function fmtOrderRejected(params: {
  symbol: string;
  strategy: string;
  strike?: number;
  reason: string;
  accountLabel: string;
}): string {
  const { symbol, strategy, strike, reason, accountLabel } = params;
  const strikeStr = strike ? ` $${strike}` : '';
  return (
    `❌ <b>Order Rejected</b>\n` +
    `<b>${symbol}</b> ${strategy}${strikeStr}\n` +
    `Reason: ${reason}\n` +
    `Account: ${accountLabel}`
  );
}

export function fmtRollSubmitted(params: {
  symbol: string;
  fromStrike: number;
  toStrike: number;
  toExpiration: string;
  netCredit: number;
  accountLabel: string;
}): string {
  const { symbol, fromStrike, toStrike, toExpiration, netCredit, accountLabel } = params;
  const sign = netCredit >= 0 ? '+' : '';
  return (
    `🔄 <b>Roll Submitted</b>\n` +
    `<b>${symbol}</b> $${fromStrike} → $${toStrike} · ${toExpiration}\n` +
    `Net Credit: <b>${sign}$${netCredit.toFixed(2)}</b>\n` +
    `Account: ${accountLabel}`
  );
}
