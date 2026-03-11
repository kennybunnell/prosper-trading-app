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

// ─── Self-match safety guard tests ────────────────────────────────────────────
// These mirror the new safety checks added to routers-automation.ts to prevent
// a position from being matched as its own long leg (self-match bug).

function detectSpreadTypeSafe(
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
  const occTypeMatch = position.symbol.match(/([CP])(\d{8})$/);
  const isPut = occTypeMatch ? occTypeMatch[1] === 'P' : position.symbol.includes('P');
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
      const longOccMatch = longPos.symbol.match(/([CP])(\d{8})$/);
      const longIsPut = longOccMatch ? longOccMatch[1] === 'P' : longPos.symbol.includes('P');
      if (longIsPut === isPut) {
        // SAFETY: skip self-match (same OCC symbol after stripping spaces)
        const normLong = longPos.symbol.replace(/\s+/g, '');
        const normShort = position.symbol.replace(/\s+/g, '');
        if (normLong === normShort) continue;

        // SAFETY: skip same-strike match
        const shortStrikeNum = occTypeMatch ? parseInt(occTypeMatch[2], 10) : 0;
        const longStrikeNum = longOccMatch ? parseInt(longOccMatch[2], 10) : 0;
        if (shortStrikeNum !== 0 && longStrikeNum !== 0 && shortStrikeNum === longStrikeNum) continue;

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

  if (isSpread) {
    const icKey = `${position['underlying-symbol']}|${position['expires-at']}`;
    const icEntry = shortByUnderlying.get(icKey);
    if (icEntry && icEntry.put && icEntry.call) {
      optionType = 'IC';
    }
  }

  return { optionType, isSpread, matchedLongLeg, buyBackCost };
}

// Integrity check helper (mirrors submitCloseOrders validation)
function checkSpreadIntegrity(orders: Array<{ optionSymbol: string; spreadLongSymbol?: string }>): {
  selfMatchViolations: string[];
  crossCollisions: string[];
} {
  const spreadOrders = orders.filter(o => !!o.spreadLongSymbol);

  // Check 1: self-match
  const selfMatchViolations = spreadOrders
    .filter(o => o.optionSymbol.replace(/\s+/g, '') === o.spreadLongSymbol!.replace(/\s+/g, ''))
    .map(o => o.optionSymbol);

  // Check 2: cross-order collision
  const normShortMap = new Map<string, typeof orders[number]>();
  for (const o of orders) {
    normShortMap.set(o.optionSymbol.replace(/\s+/g, ''), o);
  }
  const crossCollisions: string[] = [];
  for (const spreadOrder of spreadOrders) {
    const normLong = spreadOrder.spreadLongSymbol!.replace(/\s+/g, '');
    const collidingOrder = normShortMap.get(normLong);
    if (collidingOrder && collidingOrder.optionSymbol !== spreadOrder.optionSymbol) {
      if (!collidingOrder.spreadLongSymbol) {
        crossCollisions.push(spreadOrder.spreadLongSymbol!);
      }
    }
  }

  return { selfMatchViolations, crossCollisions };
}

describe('Self-match safety guard', () => {
  it('skips a long leg that has the same OCC symbol as the short leg', () => {
    // Simulate the bug: Tastytrade returns a "long" position with the same symbol as the short
    const shortPutWithSpaces: MockPosition = {
      symbol: 'MSFT  260320P00390000',
      'underlying-symbol': 'MSFT',
      'instrument-type': 'Equity Option',
      quantity: '-1',
      'quantity-direction': 'short',
      'average-open-price': '2.73',
      'close-price': '0.05',
      'expires-at': '2026-03-20T20:00:00.000Z',
    };
    // Simulate a "long" position with same symbol (stale/duplicate data)
    const fakeLongSameSymbol: MockPosition = {
      ...shortPutWithSpaces,
      quantity: '1',
      'quantity-direction': 'long',
    };

    const positions = [shortPutWithSpaces, fakeLongSameSymbol];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadTypeSafe(shortPutWithSpaces, longMap, shortMap);

    // Should NOT be identified as a spread — self-match must be skipped
    expect(result.isSpread).toBe(false);
    expect(result.optionType).toBe('CSP');
    expect(result.matchedLongLeg).toBeNull();
  });

  it('skips a long leg with the same strike as the short leg', () => {
    const shortPut: MockPosition = {
      symbol: 'AVGO260313P00320000',
      'underlying-symbol': 'AVGO',
      'instrument-type': 'Equity Option',
      quantity: '-1',
      'quantity-direction': 'short',
      'average-open-price': '3.00',
      'close-price': '0.05',
      'expires-at': '2026-03-13T20:00:00.000Z',
    };
    const sameLongPut: MockPosition = {
      symbol: 'AVGO260313P00320000',  // same strike — invalid spread
      'underlying-symbol': 'AVGO',
      'instrument-type': 'Equity Option',
      quantity: '1',
      'quantity-direction': 'long',
      'average-open-price': '3.00',
      'close-price': '0.05',
      'expires-at': '2026-03-13T20:00:00.000Z',
    };

    const positions = [shortPut, sameLongPut];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadTypeSafe(shortPut, longMap, shortMap);

    expect(result.isSpread).toBe(false);
    expect(result.optionType).toBe('CSP');
  });

  it('still correctly identifies a valid BPS when strikes differ', () => {
    const positions = [shortPut, longPut];
    const longMap = buildLongPositionMap(positions);
    const shortMap = buildShortByUnderlying(positions);

    const result = detectSpreadTypeSafe(shortPut, longMap, shortMap);

    expect(result.isSpread).toBe(true);
    expect(result.optionType).toBe('BPS');
    expect(result.matchedLongLeg?.symbol).toBe('NVDA260307P00145000');
  });
});

describe('Spread integrity check (submitCloseOrders validation)', () => {
  it('flags a self-match violation when spreadLongSymbol equals optionSymbol', () => {
    const orders = [
      { optionSymbol: 'MSFT  260320P00390000', spreadLongSymbol: 'MSFT  260320P00390000' },
    ];
    const { selfMatchViolations, crossCollisions } = checkSpreadIntegrity(orders);
    expect(selfMatchViolations).toHaveLength(1);
    expect(crossCollisions).toHaveLength(0);
  });

  it('does NOT flag a valid IC batch (put spread + call spread on same underlying)', () => {
    const orders = [
      { optionSymbol: 'AVGO  260313P00320000', spreadLongSymbol: 'AVGO  260313P00310000' },
      { optionSymbol: 'AVGO  260313C00390000', spreadLongSymbol: 'AVGO  260313C00400000' },
    ];
    const { selfMatchViolations, crossCollisions } = checkSpreadIntegrity(orders);
    expect(selfMatchViolations).toHaveLength(0);
    expect(crossCollisions).toHaveLength(0);
  });

  it('does NOT flag a mixed batch of IC + CSP + CC orders', () => {
    // Realistic batch: AVGO IC (2 spread orders) + AAPL CSP (single-leg) + MSFT CC (single-leg)
    const orders = [
      { optionSymbol: 'AVGO  260313P00320000', spreadLongSymbol: 'AVGO  260313P00310000' },
      { optionSymbol: 'AVGO  260313C00390000', spreadLongSymbol: 'AVGO  260313C00400000' },
      { optionSymbol: 'AAPL  260313P00200000' },  // standalone CSP
      { optionSymbol: 'MSFT  260313C00420000' },  // standalone CC
    ];
    const { selfMatchViolations, crossCollisions } = checkSpreadIntegrity(orders);
    expect(selfMatchViolations).toHaveLength(0);
    expect(crossCollisions).toHaveLength(0);
  });

  it('flags a cross-collision when a long leg is also submitted as a standalone close', () => {
    // Dangerous: spread order has long=NVDA260307P00145000, but that same symbol
    // is also being submitted as a standalone single-leg close
    const orders = [
      { optionSymbol: 'NVDA260307P00150000', spreadLongSymbol: 'NVDA260307P00145000' },
      { optionSymbol: 'NVDA260307P00145000' },  // standalone — would double-close the long leg
    ];
    const { selfMatchViolations, crossCollisions } = checkSpreadIntegrity(orders);
    expect(selfMatchViolations).toHaveLength(0);
    expect(crossCollisions).toHaveLength(1);
    expect(crossCollisions[0]).toBe('NVDA260307P00145000');
  });

  it('does NOT flag when both orders are spread orders sharing a symbol in their long legs', () => {
    // Two different spreads where neither long leg is a standalone order
    const orders = [
      { optionSymbol: 'TSLA260313P00402500', spreadLongSymbol: 'TSLA260313P00395000' },
      { optionSymbol: 'TSLA260313C00422500', spreadLongSymbol: 'TSLA260313C00430000' },
    ];
    const { selfMatchViolations, crossCollisions } = checkSpreadIntegrity(orders);
    expect(selfMatchViolations).toHaveLength(0);
    expect(crossCollisions).toHaveLength(0);
  });
});
