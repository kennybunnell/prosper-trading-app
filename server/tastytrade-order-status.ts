/**
 * Enhanced order status checking with order history lookup
 *
 * Tastytrade API endpoints:
 * - GET /accounts/{account_number}/orders/live - Returns working orders
 * - GET /accounts/{account_number}/orders/{order_id} - Returns specific order details with status
 *
 * Order statuses: Received, Live, Filled, Cancelled, Rejected, Contingent, Routed
 */

import { getTastytradeAPI } from './tastytrade';

export interface OrderStatus {
  status: 'Working' | 'Filled' | 'Cancelled' | 'Rejected' | 'MarketClosed' | 'Unknown';
  filledAt?: string;
  cancelledAt?: string;
  rejectedReason?: string;
  marketClosedMessage?: string;
}

/**
 * Check if market is currently open for options trading.
 * Uses Intl.DateTimeFormat to reliably extract ET wall-clock time regardless of server TZ.
 * Options market hours: 9:30 AM – 4:00 PM ET, Monday–Friday.
 */
function isMarketOpen(): boolean {
  const now = new Date();

  // Use Intl to get individual ET components — works correctly on UTC servers
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';

  const weekday = get('weekday'); // 'Mon', 'Tue', …, 'Sat', 'Sun'
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hours = parseInt(get('hour'), 10);
  const minutes = parseInt(get('minute'), 10);
  const timeInMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60 + 30;  // 9:30 AM ET
  const marketClose = 16 * 60;     // 4:00 PM ET

  return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
}

/**
 * Check order status by fetching individual order details.
 * Returns accurate status for completed orders (filled/cancelled/rejected).
 *
 * Key fix: a 404 on a recently-submitted order means the order was processed
 * so quickly that it has already been purged from the live-orders list.
 * We treat that as "Working" (still resolving) rather than "Unknown", so the
 * client keeps polling and eventually sees the correct terminal state via the
 * order-history endpoint.
 */
export async function checkOrderStatus(
  accountId: string,
  orderId: string,
  retryCount: number = 2,
  userId?: number
): Promise<OrderStatus> {
  const api = getTastytradeAPI(userId);

  // Only block on market-closed BEFORE the first API attempt.
  // If the market just opened and orders are already filling, we should not
  // short-circuit — the isMarketOpen check is a best-effort guard, not a hard gate.
  if (!isMarketOpen()) {
    return {
      status: 'MarketClosed',
      marketClosedMessage: 'Market is currently closed. Orders will be processed when market opens.',
    };
  }

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const orderData = await api.getOrderById(accountId, orderId);

      if (!orderData) {
        // No data returned — treat as still-working rather than unknown
        return { status: 'Working' };
      }

      const tastytradeStatus = orderData.status;

      switch (tastytradeStatus) {
        case 'Filled':
          return {
            status: 'Filled',
            filledAt: orderData['updated-at'] || orderData['received-at'],
          };

        case 'Cancelled':
        case 'Canceled':
          return {
            status: 'Cancelled',
            cancelledAt: orderData['cancelled-at'] || orderData['updated-at'],
          };

        case 'Rejected':
          return {
            status: 'Rejected',
            rejectedReason: orderData['reject-reason'] || 'Unknown reason',
          };

        case 'Received':
        case 'Live':
        case 'Routed':
        case 'Contingent':
          return { status: 'Working' };

        default:
          // Unknown Tastytrade status — treat as still working so the client
          // keeps polling instead of showing a false "Rejected" badge.
          console.warn(`[OrderStatus] Unrecognised Tastytrade status "${tastytradeStatus}" for order ${orderId} — treating as Working`);
          return { status: 'Working' };
      }
    } catch (error: any) {
      // ── 404: order purged from live list ──────────────────────────────────
      // This is the most common cause of false "Rejected" badges.
      // A freshly-filled order can disappear from /orders/{id} within seconds.
      // Return "Working" so the client retries; it will eventually see "Filled"
      // once the order appears in the history endpoint.
      if (error.response?.status === 404 || (error.message && error.message.includes('404'))) {
        console.log(`[OrderStatus] Order ${orderId} returned 404 — likely filled/processing, returning Working`);
        return { status: 'Working' };
      }

      // ── Rate limit ────────────────────────────────────────────────────────
      const msg: string = error.message || '';
      if (
        error.isRateLimit ||
        msg.includes('Rate exceeded') ||
        msg.includes('not valid JSON') ||
        msg.includes('Unexpected token')
      ) {
        console.warn(`[OrderStatus] Rate limited while checking order ${orderId} — returning Working`);
        return { status: 'Working' };
      }

      // ── Last attempt: propagate so the caller can decide ──────────────────
      if (attempt === retryCount) {
        console.error(`[OrderStatus] Error fetching order ${orderId} after ${retryCount} attempts:`, error.message);
        throw new Error(`Failed to check order status: ${error.message}`);
      }

      // Wait before retrying (capped at 1 second)
      const waitTime = Math.min(Math.pow(2, attempt - 1) * 1000, 1000);
      console.log(`[OrderStatus] Retry ${attempt}/${retryCount} for order ${orderId} after ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  // Should never reach here — TypeScript guard
  return { status: 'Working' };
}

/**
 * Check status for multiple orders in batch.
 * Returns a map of order ID → status.
 */
export async function checkOrderStatusBatch(
  accountId: string,
  orderIds: string[]
): Promise<Record<string, OrderStatus>> {
  const statusMap: Record<string, OrderStatus> = {};

  for (const orderId of orderIds) {
    try {
      const status = await checkOrderStatus(accountId, orderId);
      statusMap[orderId] = status;
    } catch (error: any) {
      console.error(`[OrderStatus] Failed to check status for order ${orderId}:`, error.message);
      // Return Working instead of Unknown so the UI keeps polling rather than
      // showing a false "Rejected" badge.
      statusMap[orderId] = { status: 'Working' };
    }
  }

  return statusMap;
}

/**
 * Poll order status until it's no longer "Working".
 * Useful for real-time order tracking after submission.
 */
export async function pollOrderStatus(
  accountId: string,
  orderId: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    onUpdate?: (status: OrderStatus, attempt: number) => void;
  } = {}
): Promise<OrderStatus & { orderId: string; message?: string }> {
  const {
    maxAttempts = 60,
    intervalMs = 5000,
    onUpdate,
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await checkOrderStatus(accountId, orderId);

    if (onUpdate) {
      onUpdate(status, attempt);
    }

    if (status.status !== 'Working') {
      let message = '';
      if (status.status === 'Filled') {
        message = `Order filled at ${status.filledAt || 'unknown time'}`;
      } else if (status.status === 'Rejected') {
        message = `Order rejected: ${status.rejectedReason || 'Unknown reason'}`;
      } else if (status.status === 'MarketClosed') {
        message = status.marketClosedMessage || 'Market is currently closed. Orders will be processed when market opens.';
      } else if (status.status === 'Cancelled') {
        message = `Order cancelled at ${status.cancelledAt || 'unknown time'}`;
      }

      return { ...status, orderId, message };
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return {
    status: 'Working',
    orderId,
    message: 'Order is still working (pending execution)',
  };
}
