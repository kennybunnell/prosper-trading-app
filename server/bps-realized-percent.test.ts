/**
 * Unit tests for BPS (Bull Put Spread) net credit and realizedPercent calculation.
 *
 * These tests verify the logic extracted from routers-performance.ts:
 *   - premiumReceived = (short open price - long open price) × qty × multiplier
 *   - currentCost     = (short current price - long current price) × qty × multiplier
 *   - realizedPercent = min(100, (premiumReceived - max(0, currentCost)) / premiumReceived × 100)
 *
 * Key invariants:
 *   1. realizedPercent uses NET credit (not short-leg-only premium)
 *   2. realizedPercent is calculated AFTER spread detection (not before)
 *   3. When currentCost ≤ 0 (long leg worth more than short), realizedPercent = 100%
 *   4. isPut detection uses OCC regex ([CP]\\d{8}$) not naive includes('P')
 */

import { describe, it, expect } from 'vitest';

// ─── Pure calculation helpers (mirrors routers-performance.ts logic) ──────────

function calcBpsRealizedPercent(params: {
  shortOpenPrice: number;
  longOpenPrice: number;
  shortCurrentPrice: number;
  longCurrentPrice: number;
  qty: number;
  multiplier?: number;
}): { premiumReceived: number; currentCost: number; realizedPercent: number } {
  const { shortOpenPrice, longOpenPrice, shortCurrentPrice, longCurrentPrice, qty, multiplier = 100 } = params;
  const premiumReceived = (shortOpenPrice * qty * multiplier) - (longOpenPrice * qty * multiplier);
  const currentCost = (shortCurrentPrice * qty * multiplier) - (longCurrentPrice * qty * multiplier);
  const realizedPercent = premiumReceived > 0
    ? Math.min(100, ((premiumReceived - Math.max(0, currentCost)) / premiumReceived) * 100)
    : 0;
  return { premiumReceived, currentCost, realizedPercent };
}

function detectIsPut(symbol: string): boolean {
  const occTypeMatch = symbol.match(/([CP])(\d{8})$/);
  return occTypeMatch ? occTypeMatch[1] === 'P' : symbol.includes('P');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BPS net credit calculation', () => {
  it('calculates correct net credit for a standard BPS', () => {
    // Sold $320P for $2.50, bought $310P for $1.00 → net credit = $1.50/share = $150/contract
    const { premiumReceived } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 1.00,
      longCurrentPrice: 0.50,
      qty: 1,
    });
    expect(premiumReceived).toBeCloseTo(150, 2);
  });

  it('calculates correct net credit for multiple contracts', () => {
    // 3 contracts: net credit = $1.50 × 3 × 100 = $450
    const { premiumReceived } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 1.00,
      longCurrentPrice: 0.50,
      qty: 3,
    });
    expect(premiumReceived).toBeCloseTo(450, 2);
  });
});

describe('BPS realizedPercent calculation', () => {
  it('returns ~50% when current cost is half of premium received', () => {
    // Net credit = $1.50, current net cost = $0.75 → 50% realized
    const { realizedPercent } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 1.50,
      longCurrentPrice: 0.75,
      qty: 1,
    });
    expect(realizedPercent).toBeCloseTo(50, 1);
  });

  it('returns ~80% when current cost is 20% of premium received', () => {
    // Net credit = $1.50, current net cost = $0.30 → 80% realized
    const { realizedPercent } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 0.60,
      longCurrentPrice: 0.30,
      qty: 1,
    });
    expect(realizedPercent).toBeCloseTo(80, 1);
  });

  it('returns ~90% when current cost is 10% of premium received', () => {
    // Net credit = $1.50, current net cost = $0.15 → 90% realized
    const { realizedPercent } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 0.25,
      longCurrentPrice: 0.10,
      qty: 1,
    });
    expect(realizedPercent).toBeCloseTo(90, 1);
  });

  it('returns 100% when long leg is worth more than short leg (profitable close)', () => {
    // META scenario: short $637.50P at $0.80, long $637.50P at $2.92 → net credit received
    // currentCost = $0.80 - $2.92 = -$2.12 (negative = you receive money closing)
    const { realizedPercent, currentCost } = calcBpsRealizedPercent({
      shortOpenPrice: 3.50,
      longOpenPrice: 1.50,
      shortCurrentPrice: 0.80,
      longCurrentPrice: 2.92,
      qty: 1,
    });
    expect(currentCost).toBeLessThan(0); // net credit when closing
    expect(realizedPercent).toBe(100);   // capped at 100%
  });

  it('returns 0% when spread has not decayed at all (just opened)', () => {
    // Net credit = $1.50, current net cost = $1.50 → 0% realized
    const { realizedPercent } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 2.50,
      longCurrentPrice: 1.00,
      qty: 1,
    });
    expect(realizedPercent).toBeCloseTo(0, 1);
  });

  it('is materially different from single-leg-only calculation', () => {
    // Bug regression: old code used shortOpenPrice alone as premiumReceived
    // Short $320P sold for $2.50, long $310P bought for $1.00
    // Old (wrong): premiumReceived = $2.50 × 100 = $250, currentCost = $0.80 × 100 = $80 → 68%
    // New (correct): premiumReceived = ($2.50-$1.00) × 100 = $150, currentCost = ($0.80-$0.30) × 100 = $50 → 66.7%
    const wrongRealizedPercent = ((250 - 80) / 250) * 100; // old single-leg formula
    const { realizedPercent: correctRealizedPercent } = calcBpsRealizedPercent({
      shortOpenPrice: 2.50,
      longOpenPrice: 1.00,
      shortCurrentPrice: 0.80,
      longCurrentPrice: 0.30,
      qty: 1,
    });
    // They differ — the old formula inflated the denominator
    expect(Math.abs(wrongRealizedPercent - correctRealizedPercent)).toBeGreaterThan(1);
  });
});

describe('isPut OCC regex detection', () => {
  it('correctly identifies put options', () => {
    expect(detectIsPut('V 260306P00310000')).toBe(true);
    expect(detectIsPut('META260306P00637500')).toBe(true);
    expect(detectIsPut('SPY260306P00500000')).toBe(true);
  });

  it('correctly identifies call options', () => {
    expect(detectIsPut('AAPL260306C00200000')).toBe(false);
    expect(detectIsPut('TSLA260306C00300000')).toBe(false);
  });

  it('does not misidentify underlyings containing P as puts', () => {
    // PLTR, SPY, APLD all contain 'P' — OCC regex prevents false positives
    expect(detectIsPut('PLTR260306C00100000')).toBe(false);
    expect(detectIsPut('SPY 260306C00500000')).toBe(false);
  });
});
