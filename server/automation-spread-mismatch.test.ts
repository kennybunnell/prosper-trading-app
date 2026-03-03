/**
 * Unit tests for the spread quantity mismatch detection logic in routers-automation.ts
 *
 * These tests validate that:
 * 1. When short qty === long qty → full spread, no remainder
 * 2. When short qty > long qty → partial spread + standalone remainder
 * 3. When no long leg exists → pure single-leg CC/CSP
 * 4. The buyBackCost is correctly computed for the matched quantity only
 */

import { describe, it, expect } from 'vitest';

// ── Pure logic extracted from routers-automation.ts for unit testing ──────────
interface Position {
  symbol: string;
  'underlying-symbol': string;
  'expires-at': string;
  'quantity-direction': string;
  quantity: string;
  multiplier: string;
  'average-open-price': string;
  'close-price': string;
  'instrument-type': string;
  'created-at'?: string;
}

function computeSpreadClose(
  shortPos: Position,
  longPositions: Position[],
): {
  isSpread: boolean;
  spreadQuantity: number;
  singleLegRemainder: number;
  buyBackCost: number;
  effectiveQty: number;
} {
  const quantity = Math.abs(parseInt(shortPos.quantity));
  const multiplier = parseInt(shortPos.multiplier);
  const openPrice = Math.abs(parseFloat(shortPos['average-open-price']));
  const closePrice = Math.abs(parseFloat(shortPos['close-price']));
  // Use OCC regex to avoid false positives from underlyings containing 'P' (e.g., APLD, SPY)
  const occMatch = shortPos.symbol.match(/([CP])(\d{8})$/);
  const isPut = occMatch ? occMatch[1] === 'P' : shortPos.symbol.includes('P');

  let isSpread = false;
  let spreadQuantity = quantity;
  let singleLegRemainder = 0;
  let buyBackCost = closePrice * quantity * multiplier;

  for (const longPos of longPositions) {
    if (
      longPos['underlying-symbol'] === shortPos['underlying-symbol'] &&
      longPos['expires-at'] === shortPos['expires-at']
    ) {
      const longOccMatch = longPos.symbol.match(/([CP])(\d{8})$/);
      const longIsPut = longOccMatch ? longOccMatch[1] === 'P' : longPos.symbol.includes('P');
      if (longIsPut === isPut) {
        const longQty = Math.abs(parseInt(longPos.quantity));
        const matchedQty = Math.min(quantity, longQty);
        const longClosePrice = Math.abs(parseFloat(longPos['close-price']));
        const longBuyBackCredit = longClosePrice * matchedQty * parseInt(longPos.multiplier);
        const shortCostForMatched = closePrice * matchedQty * multiplier;
        const netCost = shortCostForMatched - longBuyBackCredit;
        if (netCost >= 0) {
          isSpread = true;
          spreadQuantity = matchedQty;
          singleLegRemainder = quantity - matchedQty;
          buyBackCost = netCost;
        }
        break;
      }
    }
  }

  const effectiveQty = isSpread ? spreadQuantity : quantity;
  return { isSpread, spreadQuantity, singleLegRemainder, buyBackCost, effectiveQty };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const baseShort: Position = {
  symbol: 'APLD260306C00007000',
  'underlying-symbol': 'APLD',
  'expires-at': '2026-03-06T00:00:00.000Z',
  'quantity-direction': 'short',
  quantity: '-3',
  multiplier: '100',
  'average-open-price': '0.25',
  'close-price': '0.05',
  'instrument-type': 'Equity Option',
};

const baseLong: Position = {
  symbol: 'APLD260306C00009000',
  'underlying-symbol': 'APLD',
  'expires-at': '2026-03-06T00:00:00.000Z',
  'quantity-direction': 'long',
  quantity: '1',
  multiplier: '100',
  'average-open-price': '0.10',
  'close-price': '0.01',
  'instrument-type': 'Equity Option',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Spread quantity mismatch detection', () => {
  it('full match: 3 short + 3 long → full spread, no remainder', () => {
    const long3 = { ...baseLong, quantity: '3' };
    const result = computeSpreadClose(baseShort, [long3]);
    expect(result.isSpread).toBe(true);
    expect(result.spreadQuantity).toBe(3);
    expect(result.singleLegRemainder).toBe(0);
    // buyBackCost = (0.05 * 3 * 100) - (0.01 * 3 * 100) = 15 - 3 = 12
    expect(result.buyBackCost).toBeCloseTo(12, 2);
    expect(result.effectiveQty).toBe(3);
  });

  it('partial match: 3 short + 1 long → 1 spread + 2 standalone', () => {
    const result = computeSpreadClose(baseShort, [baseLong]);
    expect(result.isSpread).toBe(true);
    expect(result.spreadQuantity).toBe(1);
    expect(result.singleLegRemainder).toBe(2);
    // buyBackCost for spread portion = (0.05 * 1 * 100) - (0.01 * 1 * 100) = 5 - 1 = 4
    expect(result.buyBackCost).toBeCloseTo(4, 2);
    expect(result.effectiveQty).toBe(1);
  });

  it('no long leg → pure single-leg CC, no spread', () => {
    const result = computeSpreadClose(baseShort, []);
    expect(result.isSpread).toBe(false);
    expect(result.spreadQuantity).toBe(3); // unchanged
    expect(result.singleLegRemainder).toBe(0);
    // buyBackCost = 0.05 * 3 * 100 = 15
    expect(result.buyBackCost).toBeCloseTo(15, 2);
    expect(result.effectiveQty).toBe(3);
  });

  it('long leg for different expiration is ignored', () => {
    const wrongExp = { ...baseLong, 'expires-at': '2026-04-17T00:00:00.000Z' };
    const result = computeSpreadClose(baseShort, [wrongExp]);
    expect(result.isSpread).toBe(false);
    expect(result.singleLegRemainder).toBe(0);
  });

  it('long leg for different underlying is ignored', () => {
    const wrongUnd = { ...baseLong, 'underlying-symbol': 'AMD' };
    const result = computeSpreadClose(baseShort, [wrongUnd]);
    expect(result.isSpread).toBe(false);
  });

  it('put long leg does not match call short leg', () => {
    // Use AMD (no 'P' in underlying) to avoid false-positive from APLD containing 'P'
    const amdShort: Position = { ...baseShort, symbol: 'AMD260306C00150000', 'underlying-symbol': 'AMD' };
    const amdPutLong: Position = { ...baseLong, symbol: 'AMD260306P00140000', 'underlying-symbol': 'AMD' };
    const result = computeSpreadClose(amdShort, [amdPutLong]);
    expect(result.isSpread).toBe(false);
  });

  it('net cost < 0 (long leg more expensive than short) → not treated as spread', () => {
    // If long close price > short close price, netCost would be negative → skip
    const expensiveLong = { ...baseLong, 'close-price': '0.10' }; // 0.10 > 0.05 short
    const result = computeSpreadClose(baseShort, [expensiveLong]);
    expect(result.isSpread).toBe(false);
  });

  it('effectivePremiumReceived uses spreadQuantity, not full quantity', () => {
    const result = computeSpreadClose(baseShort, [baseLong]);
    // effectiveQty should be 1 (matched), not 3 (total short)
    expect(result.effectiveQty).toBe(1);
    // premiumReceived for spread = openPrice * effectiveQty * multiplier = 0.25 * 1 * 100 = 25
    const effectivePremium = 0.25 * result.effectiveQty * 100;
    expect(effectivePremium).toBeCloseTo(25, 2);
  });
});
