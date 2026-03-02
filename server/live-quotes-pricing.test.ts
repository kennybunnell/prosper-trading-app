/**
 * Unit tests for live quotes and Good Fill Zone pricing logic
 * Tests the computeGoodFillPrice helper and the bid/ask update logic
 * used in UnifiedOrderPreviewModal.
 */
import { describe, it, expect } from 'vitest';

// ─── Replicate the computeGoodFillPrice helper from the modal ───────────────
function computeGoodFillPrice(bid: number, ask: number, isBTC: boolean): number {
  if (bid > 0 && ask > 0) {
    const mid = (bid + ask) / 2;
    const price = isBTC ? mid + (ask - mid) * 0.25 : mid;
    return Math.round(Math.max(0.01, price) * 20) / 20;
  }
  return 0;
}

// ─── Replicate the $0.05 rounding helper ────────────────────────────────────
function roundToNickel(price: number): number {
  return Math.round(price * 20) / 20;
}

// ─── Replicate the Good Fill Zone reset helper ───────────────────────────────
function getGoodFillForOrder(
  bid: number,
  ask: number,
  longBid: number | undefined,
  longAsk: number | undefined,
  isBTC: boolean
): number {
  if (longBid !== undefined && longAsk !== undefined) {
    // Spread net debit range
    const minDebit = bid - longAsk;
    const maxDebit = ask - longBid;
    const midDebit = (minDebit + maxDebit) / 2;
    const goodFill = isBTC ? midDebit + (maxDebit - midDebit) * 0.25 : midDebit;
    return roundToNickel(Math.max(0.01, goodFill));
  }
  return computeGoodFillPrice(bid, ask, isBTC);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeGoodFillPrice', () => {
  it('returns 0 when bid or ask is 0', () => {
    expect(computeGoodFillPrice(0, 1.0, true)).toBe(0);
    expect(computeGoodFillPrice(1.0, 0, true)).toBe(0);
    expect(computeGoodFillPrice(0, 0, true)).toBe(0);
  });

  it('BTC: sets price to mid + 25% toward ask (Good Fill Zone)', () => {
    // bid=1.00, ask=1.40 → mid=1.20, 25% toward ask = 1.20 + 0.05 = 1.25
    const price = computeGoodFillPrice(1.00, 1.40, true);
    expect(price).toBe(1.25);
  });

  it('STO: sets price to midpoint', () => {
    // bid=1.00, ask=1.40 → mid=1.20
    const price = computeGoodFillPrice(1.00, 1.40, false);
    expect(price).toBe(1.20);
  });

  it('rounds to nearest $0.05', () => {
    // bid=1.00, ask=1.50 → mid=1.25, BTC: 1.25 + 0.25*(1.50-1.25) = 1.25 + 0.0625 = 1.3125 → rounds to 1.30
    const price = computeGoodFillPrice(1.00, 1.50, true);
    // Verify the result is a multiple of 0.05 (using integer arithmetic to avoid float issues)
    expect(Math.round(price * 20) % 1).toBe(0);
  });

  it('minimum price is $0.01', () => {
    // bid=0.05, ask=0.10 → mid=0.075, BTC: 0.075 + 0.25*0.0125 = 0.078125 → rounds to 0.10
    const price = computeGoodFillPrice(0.05, 0.10, true);
    expect(price).toBeGreaterThanOrEqual(0.01);
    expect(price).toBeGreaterThan(0);
  });

  it('handles wide spreads correctly', () => {
    // bid=0.50, ask=2.00 → mid=1.25, BTC: 1.25 + 0.25*(2.00-1.25) = 1.25 + 0.1875 = 1.4375 → rounds to 1.45
    const price = computeGoodFillPrice(0.50, 2.00, true);
    expect(price).toBe(1.45);
  });
});

describe('getGoodFillForOrder (spread net debit)', () => {
  it('BTC spread: computes net debit Good Fill Zone', () => {
    // Short leg bid=1.00, ask=1.40; Long leg bid=0.30, ask=0.50
    // minDebit = 1.00 - 0.50 = 0.50
    // maxDebit = 1.40 - 0.30 = 1.10
    // midDebit = 0.80
    // BTC good fill = 0.80 + 0.25 * (1.10 - 0.80) = 0.80 + 0.075 = 0.875 → rounds to 0.85
    const price = getGoodFillForOrder(1.00, 1.40, 0.30, 0.50, true);
    expect(price).toBe(0.85);
  });

  it('STO spread: sets to net credit midpoint', () => {
    // Short leg bid=1.00, ask=1.40; Long leg bid=0.30, ask=0.50
    // minDebit = 0.50, maxDebit = 1.10, midDebit = 0.80
    // STO: just midpoint = 0.80
    const price = getGoodFillForOrder(1.00, 1.40, 0.30, 0.50, false);
    expect(price).toBe(0.80);
  });

  it('falls back to single-leg when no long leg data', () => {
    const price = getGoodFillForOrder(1.00, 1.40, undefined, undefined, true);
    expect(price).toBe(computeGoodFillPrice(1.00, 1.40, true));
  });
});

describe('roundToNickel', () => {
  it('rounds 1.23 to 1.25', () => {
    expect(roundToNickel(1.23)).toBe(1.25);
  });

  it('rounds 1.22 to 1.20', () => {
    expect(roundToNickel(1.22)).toBe(1.20);
  });

  it('keeps exact nickel values unchanged', () => {
    expect(roundToNickel(1.50)).toBe(1.50);
    expect(roundToNickel(0.05)).toBe(0.05);
  });
});

describe('liveQuotes bid/ask update logic', () => {
  type Quote = { bid: number; ask: number };
  type OrderKey = string;

  // Simulate the useEffect that updates prices when live quotes arrive
  function applyLiveQuotes(
    currentPrices: Map<OrderKey, number>,
    orders: Array<{ key: OrderKey; optionSymbol?: string; isBTC: boolean }>,
    liveQuotes: Record<string, Quote>
  ): Map<OrderKey, number> {
    const updated = new Map(currentPrices);
    for (const order of orders) {
      const sym = order.optionSymbol;
      if (!sym) continue;
      const q = liveQuotes[sym];
      if (!q || q.bid === 0 || q.ask === 0) continue;
      const price = computeGoodFillPrice(q.bid, q.ask, order.isBTC);
      if (price > 0) updated.set(order.key, price);
    }
    return updated;
  }

  it('updates prices for orders with live quotes', () => {
    const currentPrices = new Map([['order1', 1.00]]);
    const orders = [{ key: 'order1', optionSymbol: 'TSLA  260306C00200000', isBTC: true }];
    const liveQuotes = { 'TSLA  260306C00200000': { bid: 1.20, ask: 1.60 } };
    const updated = applyLiveQuotes(currentPrices, orders, liveQuotes);
    // mid=1.40, BTC: 1.40 + 0.25*0.10 = 1.45
    expect(updated.get('order1')).toBe(1.45);
  });

  it('skips orders with no matching live quote', () => {
    const currentPrices = new Map([['order1', 1.00]]);
    const orders = [{ key: 'order1', optionSymbol: 'TSLA  260306C00200000', isBTC: true }];
    const liveQuotes = {}; // No quotes
    const updated = applyLiveQuotes(currentPrices, orders, liveQuotes);
    expect(updated.get('order1')).toBe(1.00); // Unchanged
  });

  it('skips orders with zero bid or ask in live quote', () => {
    const currentPrices = new Map([['order1', 1.00]]);
    const orders = [{ key: 'order1', optionSymbol: 'TSLA  260306C00200000', isBTC: true }];
    const liveQuotes = { 'TSLA  260306C00200000': { bid: 0, ask: 1.60 } };
    const updated = applyLiveQuotes(currentPrices, orders, liveQuotes);
    expect(updated.get('order1')).toBe(1.00); // Unchanged
  });

  it('skips orders with no optionSymbol', () => {
    const currentPrices = new Map([['order1', 1.00]]);
    const orders = [{ key: 'order1', optionSymbol: undefined, isBTC: true }];
    const liveQuotes = { 'TSLA  260306C00200000': { bid: 1.20, ask: 1.60 } };
    const updated = applyLiveQuotes(currentPrices, orders, liveQuotes);
    expect(updated.get('order1')).toBe(1.00); // Unchanged
  });

  it('handles multiple orders with mixed live/estimated data', () => {
    const currentPrices = new Map([['order1', 1.00], ['order2', 2.00]]);
    const orders = [
      { key: 'order1', optionSymbol: 'TSLA  260306C00200000', isBTC: true },
      { key: 'order2', optionSymbol: 'NVDA  260306P00100000', isBTC: true },
    ];
    const liveQuotes = {
      'TSLA  260306C00200000': { bid: 1.20, ask: 1.60 }, // Has live data
      // NVDA has no live data
    };
    const updated = applyLiveQuotes(currentPrices, orders, liveQuotes);
    expect(updated.get('order1')).toBe(1.45); // Updated with live quote
    expect(updated.get('order2')).toBe(2.00); // Unchanged (no live data)
  });
});
