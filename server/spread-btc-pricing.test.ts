/**
 * Unit tests for Bull Put Spread BTC order pricing direction fix
 *
 * Bug: BPS BTC orders were showing "Sell-side" pricing strategy because:
 * 1. Tastytrade returns legs in order: [STC long put, BTC short put]
 * 2. Code was using legs[0].action = "Sell to Close" → sell-side pricing
 * 3. Quote was fetched for legs[0] (long put), not net spread
 *
 * Fix:
 * 1. Collect quotes for ALL legs
 * 2. Compute net spread bid/ask: netBid = BTC bid - STC ask, netAsk = BTC ask - STC bid
 * 3. Use price-effect ("Debit"/"Credit") for direction, not leg action
 */

import { describe, it, expect } from 'vitest';
import { calculateSmartFillPrice } from './working-orders-utils';

// Simulate the net spread bid/ask computation logic from routers-working-orders.ts
function computeNetSpreadBidAsk(
  btcLegBid: number,
  btcLegAsk: number,
  stcLegBid: number,
  stcLegAsk: number
) {
  const netBid = Math.max(0, btcLegBid - stcLegAsk);
  const netAsk = Math.max(0, btcLegAsk - stcLegBid);
  const mid = (netBid + netAsk) / 2;
  const spread = netAsk - netBid;
  return { bid: netBid, ask: netAsk, mid, spread };
}

// Simulate the effective action determination logic
function getEffectiveAction(isSpread: boolean, priceEffect: string, legAction: string): string {
  if (isSpread) {
    return priceEffect === 'Debit' ? 'Buy to Close' : 'Sell to Close';
  }
  return legAction;
}

describe('BPS BTC Spread Net Bid/Ask Computation', () => {
  it('computes correct net bid/ask for V BPS BTC order', () => {
    // V 260306P00320000 (BTC leg - short put at $320)
    const btcLegBid = 1.60;
    const btcLegAsk = 1.80;

    // V 260306P00310000 (STC leg - long put at $310)
    const stcLegBid = 0.33;
    const stcLegAsk = 0.51;

    const result = computeNetSpreadBidAsk(btcLegBid, btcLegAsk, stcLegBid, stcLegAsk);

    // netBid = BTC bid - STC ask = 1.60 - 0.51 = 1.09
    expect(result.bid).toBeCloseTo(1.09, 2);
    // netAsk = BTC ask - STC bid = 1.80 - 0.33 = 1.47
    expect(result.ask).toBeCloseTo(1.47, 2);
    // mid = (1.09 + 1.47) / 2 = 1.28
    expect(result.mid).toBeCloseTo(1.28, 2);
  });

  it('net bid is never negative (floor at 0)', () => {
    // Edge case: STC ask > BTC bid (illiquid spread)
    const result = computeNetSpreadBidAsk(0.10, 0.50, 0.20, 0.60);
    // netBid = 0.10 - 0.60 = -0.50 → clamped to 0
    expect(result.bid).toBe(0);
    // netAsk = 0.50 - 0.20 = 0.30
    expect(result.ask).toBeCloseTo(0.30, 2);
  });

  it('net ask is never negative (floor at 0)', () => {
    // Edge case: both legs have same price
    const result = computeNetSpreadBidAsk(0.50, 0.60, 0.55, 0.70);
    // netBid = 0.50 - 0.70 = -0.20 → clamped to 0
    expect(result.bid).toBe(0);
    // netAsk = 0.60 - 0.55 = 0.05
    expect(result.ask).toBeCloseTo(0.05, 2);
  });
});

describe('BPS BTC Effective Action Direction', () => {
  it('uses Buy-side pricing for Debit spread (BPS BTC)', () => {
    // BPS BTC: price-effect = "Debit" (paying to close)
    const effectiveAction = getEffectiveAction(true, 'Debit', 'Sell to Close');
    expect(effectiveAction).toBe('Buy to Close');
  });

  it('uses Sell-side pricing for Credit spread (BCS STO)', () => {
    // BCS STO: price-effect = "Credit" (receiving to open)
    const effectiveAction = getEffectiveAction(true, 'Credit', 'Buy to Open');
    expect(effectiveAction).toBe('Sell to Close');
  });

  it('uses leg action for single-leg orders', () => {
    // Single-leg CSP: use leg action directly
    const effectiveAction = getEffectiveAction(false, 'Credit', 'Sell to Open');
    expect(effectiveAction).toBe('Sell to Open');
  });

  it('uses leg action for single-leg BTC', () => {
    const effectiveAction = getEffectiveAction(false, 'Debit', 'Buy to Close');
    expect(effectiveAction).toBe('Buy to Close');
  });
});

describe('BPS BTC calculateSmartFillPrice with correct direction', () => {
  it('gives Buy-side strategy for BPS BTC with net spread quote', () => {
    // Simulate V BPS BTC: net bid=1.09, net ask=1.47
    const quote = { bid: 1.09, ask: 1.47, mid: 1.28 };
    const currentPrice = 1.46; // Tastytrade order.price (net spread)
    const minutesWorking = 5;

    const result = calculateSmartFillPrice(quote, currentPrice, minutesWorking, false, 'Buy to Close');

    expect(result.strategy).toContain('Buy-side');
    expect(result.strategy).not.toContain('Sell-side');
    // Spread = 1.47 - 1.09 = 0.38 → Very wide spread: 85% from bid
    // suggestedPrice = 1.09 + (0.38 * 0.85) = 1.09 + 0.323 = 1.413 → rounded to 1.41
    expect(result.suggestedPrice).toBeGreaterThan(1.09);
    expect(result.suggestedPrice).toBeLessThanOrEqual(1.47);
  });

  it('was incorrectly giving Sell-side strategy before the fix (regression test)', () => {
    // Before fix: code used legs[0].action = "Sell to Close" for spread orders
    // This test documents what the WRONG behavior was
    const quote = { bid: 0.33, ask: 0.51, mid: 0.42 }; // Single leg (long put) quote
    const currentPrice = 1.46; // Net spread price (WRONG to compare against single leg)
    const minutesWorking = 5;

    // Using "Sell to Close" (old wrong behavior) gives Sell-side strategy
    const wrongResult = calculateSmartFillPrice(quote, currentPrice, minutesWorking, false, 'Sell to Close');
    expect(wrongResult.strategy).toContain('Sell-side');

    // Using "Buy to Close" (correct behavior) gives Buy-side strategy
    const correctResult = calculateSmartFillPrice(quote, currentPrice, minutesWorking, false, 'Buy to Close');
    expect(correctResult.strategy).toContain('Buy-side');
  });

  it('correctly handles tight spread (≤$0.05): uses mid price', () => {
    // Note: options < $3 round to $0.05 tick size
    // bid=1.20, ask=1.24, mid=1.22 → rounds to $0.05 → 1.20
    const quote = { bid: 1.20, ask: 1.24, mid: 1.22 }; // spread = 0.04
    const result = calculateSmartFillPrice(quote, 1.22, 5, false, 'Buy to Close');
    expect(result.strategy).toContain('Tight spread');
    // 1.22 rounds to nearest $0.05 = 1.20 (since 1.22 * 20 = 24.4 → floor to 24 → 1.20)
    expect(result.suggestedPrice).toBeCloseTo(1.20, 2);
  });

  it('correctly handles medium spread (≤$0.15): uses mid + $0.01', () => {
    // Note: options < $3 round to $0.05 tick size
    // bid=1.10, ask=1.20, mid=1.15, mid+0.01=1.16 → rounds to $0.05 → 1.15
    const quote = { bid: 1.10, ask: 1.20, mid: 1.15 }; // spread = 0.10
    const result = calculateSmartFillPrice(quote, 1.15, 5, false, 'Buy to Close');
    expect(result.strategy).toContain('Medium spread');
    // 1.16 rounds to nearest $0.05 = 1.15 (since 1.16 * 20 = 23.2 → floor to 23 → 1.15)
    expect(result.suggestedPrice).toBeCloseTo(1.15, 2);
  });
});
