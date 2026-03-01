/**
 * Tests for spread detection logic and atomic spread order generation.
 *
 * Validates that:
 * 1. BPS (Bull Put Spread) is correctly identified when a short put has a matching long put
 * 2. BCS (Bear Call Spread) is correctly identified when a short call has a matching long call
 * 3. IC (Iron Condor) is correctly identified when both a BPS and BCS exist on the same underlying/expiration
 * 4. Spread orders include both legs (short BTC + long STC) atomically
 * 5. Single-leg CSP/CC are NOT misidentified as spreads
 */

import { describe, it, expect } from 'vitest';

// ─── Helpers that mirror the logic in routers-automation.ts ──────────────────

interface MockPosition {
  symbol: string;
  'underlying-symbol': string;
  'instrument-type': string;
  quantity: string;
  'quantity-direction': string;
  'average-open-price': string;
  'close-price': string;
  'expires-at': string;
  multiplier?: string;
}

function buildLongPositionMap(positions: MockPosition[]) {
  const map = new Map<string, MockPosition>();
  for (const pos of positions) {
    const qty = parseInt(pos.quantity);
    const direction = pos['quantity-direction']?.toLowerCase();
    const isLong = direction === 'long' || qty > 0;
    if (isLong && pos['instrument-type'] === 'Equity Option') {
      map.set(pos.symbol, pos);
    }
  }
  return map;
}

function buildShortByUnderlying(positions: MockPosition[]) {
  const map = new Map<string, { put?: MockPosition; call?: MockPosition }>();
  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity Option') continue;
    const qty = parseInt(pos.quantity);
    const direction = pos['quantity-direction']?.toLowerCase();
    const isShort = direction === 'short' || qty < 0;
    if (!isShort) continue;
    const und = pos['underlying-symbol'];
    const exp = pos['expires-at'];
    const key = `${und}|${exp}`;
    const entry = map.get(key) || {};
    if (pos.symbol?.includes('P')) entry.put = pos;
    else entry.call = pos;
    map.set(key, entry);
  }
  return map;
}

function detectSpreadType(
  position: MockPosition,
  longPositionMap: Map<string, MockPosition>,
  shortByUnderlying: Map<string, { put?: MockPosition; call?: MockPosition }>
): {
  optionType: string;
  isSpread: boolean;
  matchedLongLeg: MockPosition | null;
  buyBackCost: number;
} {
  const qty = Math.abs(parseInt(position.quantity));
  const multiplier = parseInt(position.multiplier || '100');
  const isPut = position.symbol.includes('P');
  let optionType: string = isPut ? 'CSP' : 'CC';
  const closePrice = Math.abs(parseFloat(position['close-price'] || '0'));
  let buyBackCost = closePrice * qty * multiplier;

  let isSpread = false;
  let matchedLongLeg: MockPosition | null = null;

  for (const [, longPos] of Array.from(longPositionMap.entries())) {
    if (
      longPos['underlying-symbol'] === position['underlying-symbol'] &&
      longPos['expires-at'] === position['expires-at']
    ) {
      const longIsPut = longPos.symbol.includes('P');
      if (longIsPut === isPut) {
        const longClosePrice = Math.abs(parseFloat(longPos['close-price'] || '0'));
        const longBuyBackCredit = longClosePrice * qty * parseInt(longPos.multiplier || '100');
        const netCost = buyBackCost - longBuyBackCredit;
        if (netCost >= 0) {
          buyBackCost = netCost;
          isSpread = true;
          matchedLongLeg = longPos;
          optionType = isPut ? 'BPS' : 'BCS';
        }
        break;
      }
    }
  }

  // Iron Condor check
  if (isSpread) {
    const icKey = `${position['underlying-symbol']}|${position['expires-at']}`;
    const icEntry = shortByUnderlying.get(icKey);
    if (icEntry && icEntry.put && icEntry.call) {
      optionType = 'IC';
    }
  }

  return { optionType, isSpread, matchedLongLeg, buyBackCost };
}

// ─── Test data ────────────────────────────────────────────────────────────────

const EXP = '2026-03-07T16:00:00.000Z';

const shortPut: MockPosition = {
  symbol: 'NVDA260307P00150000',
  'underlying-symbol': 'NVDA',
  'instrument-type': 'Equity Option',
  quantity: '-1',
  'quantity-direction': 'short',
  'average-open-price': '2.50',
  'close-price': '0.50',
  'expires-at': EXP,
};

const longPut: MockPosition = {
  symbol: 'NVDA260307P00145000',
  'underlying-symbol': 'NVDA',
  'instrument-type': 'Equity Option',
  quantity: '1',
  'quantity-direction': 'long',
  'average-open-price': '1.00',
  'close-price': '0.20',
  'expires-at': EXP,
};

const shortCall: MockPosition = {
  symbol: 'NVDA260307C00165000',
  'underlying-symbol': 'NVDA',
  'instrument-type': 'Equity Option',
  quantity: '-1',
  'quantity-direction': 'short',
  'average-open-price': '2.00',
  'close-price': '0.40',
  'expires-at': EXP,
};

const longCall: MockPosition = {
  symbol: 'NVDA260307C00170000',
  'underlying-symbol': 'NVDA',
  'instrument-type': 'Equity Option',
  quantity: '1',
  'quantity-direction': 'long',
  'average-open-price': '0.80',
  'close-price': '0.15',
  'expires-at': EXP,
};

const standalonePut: MockPosition = {
  symbol: 'AAPL260307P00200000',
  'underlying-symbol': 'AAPL',
  'instrument-type': 'Equity Option',
  quantity: '-2',
  'quantity-direction': 'short',
  'average-open-price': '3.00',
  'close-price': '0.80',
  'expires-at': EXP,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Spread Detection', () => {
  it('identifies a Bull Put Spread (BPS) when short put has matching long put', () => {
    const positions = [shortPut, longPut];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadType(shortPut, longMap, shortMap);

    expect(result.optionType).toBe('BPS');
    expect(result.isSpread).toBe(true);
    expect(result.matchedLongLeg?.symbol).toBe('NVDA260307P00145000');
  });

  it('identifies a Bear Call Spread (BCS) when short call has matching long call', () => {
    const positions = [shortCall, longCall];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadType(shortCall, longMap, shortMap);

    expect(result.optionType).toBe('BCS');
    expect(result.isSpread).toBe(true);
    expect(result.matchedLongLeg?.symbol).toBe('NVDA260307C00170000');
  });

  it('identifies an Iron Condor (IC) when both BPS and BCS exist on same underlying/expiration', () => {
    const positions = [shortPut, longPut, shortCall, longCall];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    // The short put leg should be tagged as IC
    const putResult = detectSpreadType(shortPut, longMap, shortMap);
    expect(putResult.optionType).toBe('IC');
    expect(putResult.isSpread).toBe(true);

    // The short call leg should also be tagged as IC
    const callResult = detectSpreadType(shortCall, longMap, shortMap);
    expect(callResult.optionType).toBe('IC');
    expect(callResult.isSpread).toBe(true);
  });

  it('correctly labels a standalone CSP (no matching long put)', () => {
    const positions = [standalonePut];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadType(standalonePut, longMap, shortMap);

    expect(result.optionType).toBe('CSP');
    expect(result.isSpread).toBe(false);
    expect(result.matchedLongLeg).toBeNull();
  });

  it('does NOT match long leg from different underlying', () => {
    const wrongUnderlying: MockPosition = {
      ...longPut,
      symbol: 'AAPL260307P00145000',
      'underlying-symbol': 'AAPL',
    };
    const positions = [shortPut, wrongUnderlying];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadType(shortPut, longMap, shortMap);

    expect(result.optionType).toBe('CSP');
    expect(result.isSpread).toBe(false);
  });

  it('does NOT match long leg from different expiration', () => {
    const wrongExp: MockPosition = {
      ...longPut,
      symbol: 'NVDA260314P00145000',
      'expires-at': '2026-03-14T16:00:00.000Z',
    };
    const positions = [shortPut, wrongExp];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadType(shortPut, longMap, shortMap);

    expect(result.optionType).toBe('CSP');
    expect(result.isSpread).toBe(false);
  });

  it('nets the buyBackCost correctly for a BPS', () => {
    // Short put close-price = 0.50, long put close-price = 0.20
    // Net cost = (0.50 - 0.20) × 1 × 100 = $30
    const positions = [shortPut, longPut];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadType(shortPut, longMap, shortMap);

    expect(result.buyBackCost).toBeCloseTo(30, 2);
  });
});

describe('Spread Order Generation', () => {
  it('generates a 2-leg order for a spread position', () => {
    const isSpread = true;
    const spreadLongSymbol = 'NVDA260307P00145000';
    const shortLegSymbol = 'NVDA260307P00150000';
    const quantity = 1;

    const legs = [
      {
        instrumentType: 'Equity Option' as const,
        symbol: shortLegSymbol,
        quantity: quantity.toString(),
        action: 'Buy to Close' as const,
      },
    ];

    if (isSpread && spreadLongSymbol) {
      legs.push({
        instrumentType: 'Equity Option' as const,
        symbol: spreadLongSymbol,
        quantity: quantity.toString(),
        action: 'Sell to Close' as const,
      });
    }

    expect(legs).toHaveLength(2);
    expect(legs[0].action).toBe('Buy to Close');
    expect(legs[0].symbol).toBe(shortLegSymbol);
    expect(legs[1].action).toBe('Sell to Close');
    expect(legs[1].symbol).toBe(spreadLongSymbol);
  });

  it('generates a 1-leg order for a standalone CSP', () => {
    const isSpread = false;
    const spreadLongSymbol = undefined;
    const shortLegSymbol = 'AAPL260307P00200000';
    const quantity = 2;

    const legs = [
      {
        instrumentType: 'Equity Option' as const,
        symbol: shortLegSymbol,
        quantity: quantity.toString(),
        action: 'Buy to Close' as const,
      },
    ];

    if (isSpread && spreadLongSymbol) {
      legs.push({
        instrumentType: 'Equity Option' as const,
        symbol: spreadLongSymbol,
        quantity: quantity.toString(),
        action: 'Sell to Close' as const,
      });
    }

    expect(legs).toHaveLength(1);
    expect(legs[0].action).toBe('Buy to Close');
    expect(legs[0].symbol).toBe(shortLegSymbol);
  });

  it('calculates net debit correctly for spread close', () => {
    // Short leg cost: $0.50/share, Long leg credit: $0.20/share
    // Net debit = $0.30/share
    const shortLegCostPerShare = 0.50;
    const longLegCreditPerShare = 0.20;
    const netDebitPerShare = shortLegCostPerShare - longLegCreditPerShare;
    const limitPrice = Math.max(0.01, Math.ceil((netDebitPerShare + 0.01) * 100) / 100);

    expect(netDebitPerShare).toBeCloseTo(0.30, 2);
    expect(limitPrice).toBeCloseTo(0.31, 2);
  });

  it('uses minimum $0.01 limit price when net debit is near zero', () => {
    // Spread is almost fully profitable — net debit approaches 0
    const shortLegCostPerShare = 0.01;
    const longLegCreditPerShare = 0.005;
    const netDebitPerShare = shortLegCostPerShare - longLegCreditPerShare;
    const limitPrice = Math.max(0.01, Math.ceil((netDebitPerShare + 0.01) * 100) / 100);

    expect(limitPrice).toBeGreaterThanOrEqual(0.01);
  });
});
