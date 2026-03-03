/**
 * Unit tests for Iron Condor long-leg type matching logic.
 * Verifies that the OCC-based put/call detection correctly prevents
 * cross-type leg matching (e.g., short PUT matched to long CALL).
 */
import { describe, it, expect } from 'vitest';

// ── Helpers mirrored from routers-automation.ts ──────────────────────────────

function occIsPut(symbol: string): boolean {
  const m = symbol.match(/([CP])(\d{8})$/);
  return m ? m[1] === 'P' : symbol.includes('P');
}

interface MockPosition {
  symbol: string;
  'underlying-symbol': string;
  'expires-at': string;
  'quantity-direction': string;
  quantity: number;
  'close-price': string;
  multiplier: number;
  'average-open-price'?: string;
}

function findMatchingLongLeg(
  shortPos: MockPosition,
  longPositionMap: Map<string, MockPosition>
): { matched: MockPosition | null; netCost: number } {
  const isPut = occIsPut(shortPos.symbol);
  const closePrice = Math.abs(parseFloat(shortPos['close-price'] || '0'));
  const quantity = Math.abs(shortPos.quantity);
  const multiplier = shortPos.multiplier;

  for (const [, longPos] of Array.from(longPositionMap.entries())) {
    const sameUnderlying = longPos['underlying-symbol'] === shortPos['underlying-symbol'];
    const sameExp = longPos['expires-at'] === shortPos['expires-at'];
    if (!sameUnderlying || !sameExp) continue;

    const longIsPut = occIsPut(longPos.symbol);
    if (longIsPut !== isPut) continue; // must be same type

    const longQty = Math.abs(longPos.quantity);
    const matchedQty = Math.min(quantity, longQty);
    const longClosePrice = Math.abs(parseFloat(longPos['close-price'] || '0'));
    const longCredit = longClosePrice * matchedQty * longPos.multiplier;
    const shortCost = closePrice * matchedQty * multiplier;
    const netCost = shortCost - longCredit;

    if (netCost >= 0) {
      return { matched: longPos, netCost };
    }
    break;
  }
  return { matched: null, netCost: 0 };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const EXP = '2026-03-04T21:00:00.000+00:00';

const aaplShortPut: MockPosition = {
  symbol: 'AAPL260304P00277500',
  'underlying-symbol': 'AAPL',
  'expires-at': EXP,
  'quantity-direction': 'short',
  quantity: -1,
  'close-price': '0.01',
  multiplier: 100,
  'average-open-price': '0.81',
};

const aaplShortCall: MockPosition = {
  symbol: 'AAPL260304C00277500',
  'underlying-symbol': 'AAPL',
  'expires-at': EXP,
  'quantity-direction': 'short',
  quantity: -1,
  'close-price': '0.02',
  multiplier: 100,
  'average-open-price': '0.81',
};

const aaplLongCall: MockPosition = {
  symbol: 'AAPL260304C00282500',
  'underlying-symbol': 'AAPL',
  'expires-at': EXP,
  'quantity-direction': 'long',
  quantity: 1,
  'close-price': '0.02',
  multiplier: 100,
};

const aaplLongPut: MockPosition = {
  symbol: 'AAPL260304P00262500',
  'underlying-symbol': 'AAPL',
  'expires-at': EXP,
  'quantity-direction': 'long',
  quantity: 1,
  'close-price': '0.01',
  multiplier: 100,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IC long-leg type matching', () => {
  it('short PUT matches long PUT, not long CALL (call-first map order)', () => {
    // Map has long CALL first, then long PUT — simulates IC where call side is inserted first
    const longMap = new Map<string, MockPosition>([
      [aaplLongCall.symbol, aaplLongCall],
      [aaplLongPut.symbol, aaplLongPut],
    ]);
    const { matched } = findMatchingLongLeg(aaplShortPut, longMap);
    expect(matched).not.toBeNull();
    expect(matched!.symbol).toBe(aaplLongPut.symbol);
    expect(occIsPut(matched!.symbol)).toBe(true);
  });

  it('short CALL matches long CALL, not long PUT (put-first map order)', () => {
    // Map has long PUT first, then long CALL — simulates IC where put side is inserted first
    const longMap = new Map<string, MockPosition>([
      [aaplLongPut.symbol, aaplLongPut],
      [aaplLongCall.symbol, aaplLongCall],
    ]);
    const { matched } = findMatchingLongLeg(aaplShortCall, longMap);
    expect(matched).not.toBeNull();
    expect(matched!.symbol).toBe(aaplLongCall.symbol);
    expect(occIsPut(matched!.symbol)).toBe(false);
  });

  it('returns null when no same-type long leg exists', () => {
    // Only long CALL in map — short PUT should find no match
    const longMap = new Map<string, MockPosition>([
      [aaplLongCall.symbol, aaplLongCall],
    ]);
    const { matched } = findMatchingLongLeg(aaplShortPut, longMap);
    expect(matched).toBeNull();
  });

  it('rejects match when netCost is negative (long leg more expensive than short)', () => {
    // Long PUT has higher close-price than short PUT → netCost < 0 → no match
    const expensiveLongPut: MockPosition = {
      ...aaplLongPut,
      'close-price': '5.00', // much more expensive than short put at $0.01
    };
    const longMap = new Map<string, MockPosition>([
      [expensiveLongPut.symbol, expensiveLongPut],
    ]);
    const { matched } = findMatchingLongLeg(aaplShortPut, longMap);
    expect(matched).toBeNull();
  });

  it('OCC regex correctly identifies put/call for APLD (ticker contains P)', () => {
    expect(occIsPut('APLD260306P00033000')).toBe(true);
    expect(occIsPut('APLD260306C00036000')).toBe(false);
  });

  it('OCC regex correctly identifies put/call for SPY (ticker contains P)', () => {
    expect(occIsPut('SPY260313P00560000')).toBe(true);
    expect(occIsPut('SPY260313C00580000')).toBe(false);
  });

  it('matched long leg is always the same type as the short leg', () => {
    const longMap = new Map<string, MockPosition>([
      [aaplLongCall.symbol, aaplLongCall],
      [aaplLongPut.symbol, aaplLongPut],
    ]);
    // Test both put and call short legs
    const { matched: putMatch } = findMatchingLongLeg(aaplShortPut, longMap);
    const { matched: callMatch } = findMatchingLongLeg(aaplShortCall, longMap);

    expect(putMatch).not.toBeNull();
    expect(callMatch).not.toBeNull();
    // Put short → long must be put
    expect(occIsPut(putMatch!.symbol)).toBe(occIsPut(aaplShortPut.symbol));
    // Call short → long must be call
    expect(occIsPut(callMatch!.symbol)).toBe(occIsPut(aaplShortCall.symbol));
  });
});
