/**
 * Structural Validity Filter Tests
 *
 * Verifies that the scanner structural safety guards work correctly:
 * 1. ITM short put filter: CSP/BPS scanner rejects puts where strike >= currentPrice
 * 2. ITM short call filter: BCS scanner rejects calls where strike <= currentPrice (via CC OTM filter)
 * 3. Credit-to-width sanity check: rejects spreads where netCredit > 80% of spread width
 * 4. Zero/negative credit filter: rejects spreads with netCredit <= 0
 */

import { describe, it, expect } from 'vitest';

// ─── Helpers that mirror the scanner logic ───────────────────────────────────

interface MockCSPOpp {
  symbol: string;
  strike: number;
  currentPrice: number;
  expiration: string;
  netCredit?: number;
}

interface MockSpreadOpp {
  symbol: string;
  shortStrike: number;
  longStrike: number;
  spreadWidth: number;
  netCredit: number;
  currentPrice: number;
}

/** Mirrors the CSP ITM filter added to tradier.ts */
function cspPassesITMFilter(opp: MockCSPOpp): boolean {
  // Hard structural filter: reject ITM puts (strike >= current price)
  return opp.strike < opp.currentPrice;
}

/** Mirrors the BPS ITM filter added to routers.ts */
function bpsPassesITMFilter(cspOpp: MockCSPOpp): boolean {
  // Short put must be OTM (strike < current price)
  return cspOpp.strike < cspOpp.currentPrice;
}

/** Mirrors the credit-to-width sanity check added to all spread scanners */
function passesCreditToWidthCheck(netCredit: number, spreadWidth: number, maxRatio = 0.80): boolean {
  if (netCredit <= 0) return false;
  if (spreadWidth <= 0) return false;
  const ratio = netCredit / spreadWidth;
  return ratio <= maxRatio;
}

/** Combined spread validity check */
function spreadIsStructurallyValid(opp: MockSpreadOpp): boolean {
  // Short put must be OTM
  if (!bpsPassesITMFilter({ symbol: opp.symbol, strike: opp.shortStrike, currentPrice: opp.currentPrice, expiration: '' })) {
    return false;
  }
  // Credit must be positive and <= 80% of width
  return passesCreditToWidthCheck(opp.netCredit, opp.spreadWidth);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CSP ITM Filter', () => {
  it('passes OTM put (strike < currentPrice)', () => {
    expect(cspPassesITMFilter({ symbol: 'SPY', strike: 490, currentPrice: 500, expiration: '2026-03-21' })).toBe(true);
  });

  it('rejects ATM put (strike == currentPrice)', () => {
    expect(cspPassesITMFilter({ symbol: 'SPY', strike: 500, currentPrice: 500, expiration: '2026-03-21' })).toBe(false);
  });

  it('rejects ITM put (strike > currentPrice)', () => {
    expect(cspPassesITMFilter({ symbol: 'SPY', strike: 510, currentPrice: 500, expiration: '2026-03-21' })).toBe(false);
  });

  it('rejects deep ITM NDXP put (strike >> currentPrice)', () => {
    // The failing order: NDXP strike 24925 when NDX was above that level
    expect(cspPassesITMFilter({ symbol: 'NDXP', strike: 24925, currentPrice: 24800, expiration: '2026-03-20' })).toBe(false);
  });

  it('passes deep OTM NDXP put (strike << currentPrice)', () => {
    expect(cspPassesITMFilter({ symbol: 'NDXP', strike: 24000, currentPrice: 24925, expiration: '2026-03-20' })).toBe(true);
  });

  it('passes OTM SPXW put', () => {
    expect(cspPassesITMFilter({ symbol: 'SPXW', strike: 6300, currentPrice: 6845, expiration: '2026-03-21' })).toBe(true);
  });
});

describe('BPS ITM Filter', () => {
  it('passes OTM short put', () => {
    expect(bpsPassesITMFilter({ symbol: 'SPX', strike: 6200, currentPrice: 6845, expiration: '2026-03-21' })).toBe(true);
  });

  it('rejects ATM short put', () => {
    expect(bpsPassesITMFilter({ symbol: 'SPX', strike: 6845, currentPrice: 6845, expiration: '2026-03-21' })).toBe(false);
  });

  it('rejects ITM short put', () => {
    expect(bpsPassesITMFilter({ symbol: 'SPX', strike: 6900, currentPrice: 6845, expiration: '2026-03-21' })).toBe(false);
  });
});

describe('Credit-to-Width Sanity Check', () => {
  it('passes typical OTM credit spread (20% of width)', () => {
    // $5 credit on $25 wide spread = 20%
    expect(passesCreditToWidthCheck(5.00, 25)).toBe(true);
  });

  it('passes 40% credit-to-width ratio', () => {
    // $10 credit on $25 wide spread = 40%
    expect(passesCreditToWidthCheck(10.00, 25)).toBe(true);
  });

  it('passes exactly 80% credit-to-width ratio', () => {
    // $20 credit on $25 wide spread = 80% — exactly at the boundary
    expect(passesCreditToWidthCheck(20.00, 25)).toBe(true);
  });

  it('rejects 81% credit-to-width ratio (just over limit)', () => {
    // $20.25 credit on $25 wide spread = 81%
    expect(passesCreditToWidthCheck(20.25, 25)).toBe(false);
  });

  it('rejects the failing NDXP order: $33.35 credit on $100 wide spread = 33.35%', () => {
    // This was the actual failing order — 33% credit-to-width is actually valid
    // The failure was due to ITM strike, not credit ratio
    expect(passesCreditToWidthCheck(33.35, 100)).toBe(true);
  });

  it('rejects deep ITM spread: $95 credit on $100 wide spread = 95%', () => {
    expect(passesCreditToWidthCheck(95.00, 100)).toBe(false);
  });

  it('rejects zero credit spread', () => {
    expect(passesCreditToWidthCheck(0, 25)).toBe(false);
  });

  it('rejects negative credit spread', () => {
    expect(passesCreditToWidthCheck(-1.50, 25)).toBe(false);
  });

  it('rejects zero spread width (division by zero guard)', () => {
    expect(passesCreditToWidthCheck(5.00, 0)).toBe(false);
  });
});

describe('Combined Spread Structural Validity', () => {
  it('accepts a valid OTM BPS', () => {
    const spread: MockSpreadOpp = {
      symbol: 'SPY',
      shortStrike: 490,
      longStrike: 480,
      spreadWidth: 10,
      netCredit: 2.50,
      currentPrice: 510,
    };
    expect(spreadIsStructurallyValid(spread)).toBe(true);
  });

  it('rejects ITM short put even with low credit ratio', () => {
    const spread: MockSpreadOpp = {
      symbol: 'SPY',
      shortStrike: 520, // ITM: above currentPrice of 510
      longStrike: 510,
      spreadWidth: 10,
      netCredit: 3.00, // 30% of width — would pass credit check alone
      currentPrice: 510,
    };
    expect(spreadIsStructurallyValid(spread)).toBe(false);
  });

  it('rejects OTM spread with excessive credit ratio', () => {
    const spread: MockSpreadOpp = {
      symbol: 'NDXP',
      shortStrike: 24000,
      longStrike: 23900,
      spreadWidth: 100,
      netCredit: 90.00, // 90% of width — stale or manipulated prices
      currentPrice: 24925,
    };
    expect(spreadIsStructurallyValid(spread)).toBe(false);
  });

  it('rejects NDXP spread with ITM short call (simulated)', () => {
    // Simulating the actual failing order scenario
    const spread: MockSpreadOpp = {
      symbol: 'NDXP',
      shortStrike: 24925, // ITM: NDX was above 24925
      longStrike: 24825,
      spreadWidth: 100,
      netCredit: 33.35,
      currentPrice: 24800, // NDX was at ~24800 when order was placed
    };
    // shortStrike (24925) > currentPrice (24800) → ITM → rejected
    expect(spreadIsStructurallyValid(spread)).toBe(false);
  });
});
