/**
 * Telegram Callback Handler
 * Processes inline keyboard button taps from Telegram.
 *
 * Callback data format:  ACTION:PAYLOAD
 * Examples:
 *   roll:submit:ROLL_ID
 *   roll:skip:ROLL_ID
 *   cc:submit:ORDER_ID
 *   cc:skip:ORDER_ID
 */

import { answerCallbackQuery, editTelegramMessage, sendTelegramMessage, TelegramCallbackQuery } from './telegram';

// Pending approval store: maps a unique key → resolver function
// In production this could be Redis; for now in-memory is fine since
// the server is single-process.
type ApprovalResolver = (approved: boolean) => void;
const pendingApprovals = new Map<string, ApprovalResolver>();

/**
 * Register a pending approval that can be resolved by a Telegram button tap.
 * Returns a Promise that resolves to true (approved) or false (skipped/timeout).
 */
export function waitForTelegramApproval(
  key: string,
  timeoutMs = 5 * 60 * 1000, // 5 minutes default
): Promise<boolean> {
  return new Promise((resolve) => {
    // Auto-resolve false on timeout
    const timer = setTimeout(() => {
      pendingApprovals.delete(key);
      resolve(false);
    }, timeoutMs);

    pendingApprovals.set(key, (approved: boolean) => {
      clearTimeout(timer);
      pendingApprovals.delete(key);
      resolve(approved);
    });
  });
}

/**
 * Main callback handler — called from the Express webhook route.
 */
export async function handleTelegramCallback(
  callbackQuery: TelegramCallbackQuery,
): Promise<void> {
  const { id: queryId, data, message } = callbackQuery;

  if (!data) {
    await answerCallbackQuery(queryId, '⚠️ No action data');
    return;
  }

  console.log(`[Telegram] Callback received: ${data}`);

  // ── Approval callbacks (roll:submit:KEY, roll:skip:KEY, etc.) ──────────────
  const approvalMatch = data.match(/^([\w-]+):(submit|skip):(.+)$/);
  if (approvalMatch) {
    const [, _type, action, key] = approvalMatch;
    const approved = action === 'submit';
    const resolver = pendingApprovals.get(key);

    if (resolver) {
      resolver(approved);
      await answerCallbackQuery(queryId, approved ? '✅ Submitting...' : '⏭️ Skipped');
      if (message) {
        const statusText = approved
          ? `${message.chat.id ? '' : ''}⏳ Submitting order...`
          : `⏭️ <b>Skipped</b> — order was not submitted.`;
        await editTelegramMessage(message.chat.id, message.message_id, statusText);
      }
    } else {
      await answerCallbackQuery(queryId, '⏰ This approval has expired');
      if (message) {
        await editTelegramMessage(
          message.chat.id,
          message.message_id,
          '⏰ <b>Expired</b> — approval window has passed.',
        );
      }
    }
    return;
  }

  // ── Dashboard link callback ────────────────────────────────────────────────
  if (data === 'open:dashboard') {
    await answerCallbackQuery(queryId, 'Opening dashboard...');
    return;
  }

  // ── Unknown callback ───────────────────────────────────────────────────────
  await answerCallbackQuery(queryId, '❓ Unknown action');
  console.warn(`[Telegram] Unknown callback data: ${data}`);
}
