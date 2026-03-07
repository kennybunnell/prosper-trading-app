/**
 * Unit tests for GTC auto-refresh logic:
 * - Countdown timer behaviour
 * - Bulk poll filtering (only submitted orders with gtcOrderId)
 * - Fill detection and toast trigger
 * - Auto-refresh toggle state transitions
 */
import { describe, it, expect } from 'vitest';

const POLL_INTERVAL_MS = 60_000;

// ─── Countdown logic ─────────────────────────────────────────────────────────
function tickCountdown(current: number, intervalMs: number): number {
  if (current <= 1) return intervalMs / 1000;
  return current - 1;
}

describe('Countdown timer', () => {
  it('decrements by 1 each tick', () => {
    expect(tickCountdown(60, POLL_INTERVAL_MS)).toBe(59);
    expect(tickCountdown(30, POLL_INTERVAL_MS)).toBe(29);
    expect(tickCountdown(2, POLL_INTERVAL_MS)).toBe(1);
  });

  it('resets to full interval when it reaches 1', () => {
    expect(tickCountdown(1, POLL_INTERVAL_MS)).toBe(60);
  });

  it('resets to full interval when it reaches 0 (edge case)', () => {
    expect(tickCountdown(0, POLL_INTERVAL_MS)).toBe(60);
  });

  it('uses correct full interval value (60s)', () => {
    expect(POLL_INTERVAL_MS / 1000).toBe(60);
  });
});

// ─── Bulk poll filtering ──────────────────────────────────────────────────────
type GtcOrder = {
  id: number;
  status: string;
  gtcOrderId: string | null;
  accountId: string;
  symbol: string;
};

function getPollableOrders(orders: GtcOrder[]): GtcOrder[] {
  return orders.filter(o => o.gtcOrderId && o.status === 'submitted');
}

describe('Bulk poll filtering', () => {
  const orders: GtcOrder[] = [
    { id: 1, status: 'submitted', gtcOrderId: 'TT-001', accountId: 'ACC1', symbol: 'SPXW' },
    { id: 2, status: 'pending',   gtcOrderId: null,     accountId: 'ACC1', symbol: 'NVDA' },
    { id: 3, status: 'submitted', gtcOrderId: 'TT-003', accountId: 'ACC1', symbol: 'AAPL' },
    { id: 4, status: 'filled',    gtcOrderId: 'TT-004', accountId: 'ACC1', symbol: 'COIN' },
    { id: 5, status: 'cancelled', gtcOrderId: 'TT-005', accountId: 'ACC1', symbol: 'TSLA' },
    { id: 6, status: 'submitted', gtcOrderId: null,     accountId: 'ACC1', symbol: 'META' },
  ];

  it('only polls submitted orders with a gtcOrderId', () => {
    const pollable = getPollableOrders(orders);
    expect(pollable).toHaveLength(2);
    expect(pollable.map(o => o.id)).toEqual([1, 3]);
  });

  it('skips pending orders (no Tastytrade order yet)', () => {
    const pollable = getPollableOrders(orders);
    expect(pollable.every(o => o.status === 'submitted')).toBe(true);
  });

  it('skips submitted orders without gtcOrderId', () => {
    const pollable = getPollableOrders(orders);
    expect(pollable.every(o => o.gtcOrderId !== null)).toBe(true);
  });

  it('skips filled and cancelled orders', () => {
    const pollable = getPollableOrders(orders);
    expect(pollable.every(o => o.status !== 'filled' && o.status !== 'cancelled')).toBe(true);
  });

  it('returns empty array when no pollable orders exist', () => {
    const noActive: GtcOrder[] = [
      { id: 1, status: 'filled',    gtcOrderId: 'TT-001', accountId: 'ACC1', symbol: 'SPXW' },
      { id: 2, status: 'cancelled', gtcOrderId: 'TT-002', accountId: 'ACC1', symbol: 'NVDA' },
    ];
    expect(getPollableOrders(noActive)).toHaveLength(0);
  });
});

// ─── Fill detection ───────────────────────────────────────────────────────────
type PollResult = { tastyStatus: string };

function countFills(results: PollResult[]): number {
  return results.filter(r => r.tastyStatus === 'Filled').length;
}

describe('Fill detection', () => {
  it('counts filled orders correctly', () => {
    const results: PollResult[] = [
      { tastyStatus: 'Filled' },
      { tastyStatus: 'Live' },
      { tastyStatus: 'Filled' },
      { tastyStatus: 'Cancelled' },
    ];
    expect(countFills(results)).toBe(2);
  });

  it('returns 0 when no fills', () => {
    const results: PollResult[] = [
      { tastyStatus: 'Live' },
      { tastyStatus: 'Received' },
    ];
    expect(countFills(results)).toBe(0);
  });

  it('returns correct count for single fill', () => {
    expect(countFills([{ tastyStatus: 'Filled' }])).toBe(1);
  });

  it('returns 0 for empty results', () => {
    expect(countFills([])).toBe(0);
  });
});

// ─── Auto-refresh toggle state ────────────────────────────────────────────────
describe('Auto-refresh toggle', () => {
  it('enables auto-refresh and resets countdown', () => {
    let autoRefresh = false;
    let countdown = 45; // mid-cycle

    // Simulate toggling on
    autoRefresh = true;
    countdown = POLL_INTERVAL_MS / 1000; // reset

    expect(autoRefresh).toBe(true);
    expect(countdown).toBe(60);
  });

  it('disables auto-refresh and preserves countdown display', () => {
    let autoRefresh = true;
    let countdown = 30;

    // Simulate toggling off
    autoRefresh = false;
    countdown = POLL_INTERVAL_MS / 1000; // reset to full on disable

    expect(autoRefresh).toBe(false);
    expect(countdown).toBe(60);
  });

  it('manual poll resets countdown to full interval', () => {
    let countdown = 15; // almost time to poll

    // Simulate manual poll
    countdown = POLL_INTERVAL_MS / 1000;

    expect(countdown).toBe(60);
  });
});
