/**
 * Tests for three sequential SPXW Phase 3 features:
 * 1. GTC auto-submit leg mirroring (STO → BTC)
 * 2. Cash settlement panel logic (SPXW/SPX detection + max loss calc)
 * 3. SPXW score column (spxwInWatchlist detection + sort key)
 */
import { describe, it, expect } from 'vitest';

// ─── Feature 1: GTC leg mirroring ────────────────────────────────────────────
function mirrorLegs(legs: Array<{ symbol: string; action: string; quantity: number; instrumentType: string }>) {
  return legs.map(leg => ({
    symbol: leg.symbol,
    action: (leg.action === 'Sell to Open' ? 'Buy to Close' : 'Sell to Close') as 'Buy to Close' | 'Sell to Close',
    quantity: leg.quantity,
    instrumentType: leg.instrumentType as 'Equity Option' | 'Index Option',
  }));
}

describe('GTC leg mirroring', () => {
  it('mirrors a single CSP STO leg to BTC', () => {
    const legs = [{ symbol: 'NVDA 240119P00500000', action: 'Sell to Open', quantity: 1, instrumentType: 'Equity Option' }];
    const mirrored = mirrorLegs(legs);
    expect(mirrored[0].action).toBe('Buy to Close');
    expect(mirrored[0].symbol).toBe('NVDA 240119P00500000');
    expect(mirrored[0].instrumentType).toBe('Equity Option');
  });

  it('mirrors a BTO leg to Sell to Close', () => {
    const legs = [{ symbol: 'SPXW 240119P05650000', action: 'Buy to Open', quantity: 1, instrumentType: 'Index Option' }];
    const mirrored = mirrorLegs(legs);
    expect(mirrored[0].action).toBe('Sell to Close');
  });

  it('mirrors a 4-leg IC correctly', () => {
    const legs = [
      { symbol: 'SPXW 240119P05700000', action: 'Sell to Open', quantity: 1, instrumentType: 'Index Option' },
      { symbol: 'SPXW 240119P05650000', action: 'Buy to Open',  quantity: 1, instrumentType: 'Index Option' },
      { symbol: 'SPXW 240119C05900000', action: 'Sell to Open', quantity: 1, instrumentType: 'Index Option' },
      { symbol: 'SPXW 240119C05950000', action: 'Buy to Open',  quantity: 1, instrumentType: 'Index Option' },
    ];
    const mirrored = mirrorLegs(legs);
    expect(mirrored[0].action).toBe('Buy to Close');
    expect(mirrored[1].action).toBe('Sell to Close');
    expect(mirrored[2].action).toBe('Buy to Close');
    expect(mirrored[3].action).toBe('Sell to Close');
  });

  it('preserves instrumentType and quantity through mirroring', () => {
    const legs = [{ symbol: 'SPXW 240119P05700000', action: 'Sell to Open', quantity: 3, instrumentType: 'Index Option' }];
    const mirrored = mirrorLegs(legs);
    expect(mirrored[0].instrumentType).toBe('Index Option');
    expect(mirrored[0].quantity).toBe(3);
  });

  it('handles multi-contract equity spread', () => {
    const legs = [
      { symbol: 'AAPL 240119C00200000', action: 'Sell to Open', quantity: 5, instrumentType: 'Equity Option' },
      { symbol: 'AAPL 240119C00205000', action: 'Buy to Open',  quantity: 5, instrumentType: 'Equity Option' },
    ];
    const mirrored = mirrorLegs(legs);
    expect(mirrored[0].action).toBe('Buy to Close');
    expect(mirrored[1].action).toBe('Sell to Close');
    expect(mirrored[0].quantity).toBe(5);
  });
});

// ─── Feature 2: Cash settlement panel logic ──────────────────────────────────
function isIndexSymbol(symbol: string): boolean {
  return symbol === 'SPXW' || symbol === 'SPX';
}

function calcMaxLoss(spreadWidth: number, contracts: number): number {
  return spreadWidth * 100 * contracts;
}

function calcProfitTargetClose(creditCollected: number, targetPct: number): number {
  return parseFloat((creditCollected * (1 - targetPct / 100)).toFixed(2));
}

describe('Cash settlement panel logic', () => {
  it('identifies SPXW and SPX as index symbols', () => {
    expect(isIndexSymbol('SPXW')).toBe(true);
    expect(isIndexSymbol('SPX')).toBe(true);
  });

  it('does not identify equity symbols as index', () => {
    expect(isIndexSymbol('NVDA')).toBe(false);
    expect(isIndexSymbol('AAPL')).toBe(false);
    expect(isIndexSymbol('SPY')).toBe(false);
  });

  it('calculates max loss for 5-point spread, 1 contract', () => {
    expect(calcMaxLoss(5, 1)).toBe(500);
  });

  it('calculates max loss for 10-point spread, 2 contracts', () => {
    expect(calcMaxLoss(10, 2)).toBe(2000);
  });

  it('calculates max loss for 25-point spread, 1 contract', () => {
    expect(calcMaxLoss(25, 1)).toBe(2500);
  });

  it('calculates 75% profit target close price', () => {
    // Sold IC for $2.50 credit; 75% target means close at $0.625
    expect(calcProfitTargetClose(2.50, 75)).toBeCloseTo(0.63, 2);
  });

  it('calculates 50% profit target close price', () => {
    // Sold IC for $2.50 credit; 50% target means close at $1.25
    expect(calcProfitTargetClose(2.50, 50)).toBeCloseTo(1.25, 2);
  });

  it('calculates ROC correctly', () => {
    const credit = 150;   // $1.50 × 100
    const maxLoss = 500;  // 5-wide spread
    const roc = (credit / maxLoss) * 100;
    expect(roc).toBeCloseTo(30, 1);
  });
});

// ─── Feature 3: SPXW score column ────────────────────────────────────────────
function detectSpxwInWatchlist(watchlist: Array<{ symbol: string }>): boolean {
  return watchlist.some(w => w.symbol === 'SPXW' || w.symbol === 'SPX');
}

function getSpxwScore(opp: { symbol: string; score?: number; scoreBreakdown?: { indexEquivalent?: number } }): number | null {
  if (opp.symbol === 'SPXW' || opp.symbol === 'SPX') return opp.score ?? 0;
  return opp.scoreBreakdown?.indexEquivalent ?? null;
}

describe('SPXW score column', () => {
  it('detects SPXW in watchlist', () => {
    expect(detectSpxwInWatchlist([{ symbol: 'NVDA' }, { symbol: 'SPXW' }])).toBe(true);
  });

  it('detects SPX in watchlist', () => {
    expect(detectSpxwInWatchlist([{ symbol: 'SPX' }])).toBe(true);
  });

  it('returns false when neither SPXW nor SPX is in watchlist', () => {
    expect(detectSpxwInWatchlist([{ symbol: 'NVDA' }, { symbol: 'AAPL' }])).toBe(false);
    expect(detectSpxwInWatchlist([])).toBe(false);
  });

  it('returns index score for SPXW rows', () => {
    expect(getSpxwScore({ symbol: 'SPXW', score: 78.5 })).toBe(78.5);
  });

  it('returns index score for SPX rows', () => {
    expect(getSpxwScore({ symbol: 'SPX', score: 72.0 })).toBe(72.0);
  });

  it('returns indexEquivalent for equity rows when available', () => {
    const opp = { symbol: 'NVDA', score: 82, scoreBreakdown: { indexEquivalent: 65.3 } };
    expect(getSpxwScore(opp)).toBeCloseTo(65.3, 1);
  });

  it('returns null for equity rows without indexEquivalent', () => {
    expect(getSpxwScore({ symbol: 'AAPL', score: 70 })).toBeNull();
  });

  it('returns 0 for SPXW row with no score', () => {
    expect(getSpxwScore({ symbol: 'SPXW' })).toBe(0);
  });

  it('sorts SPXW rows above equity rows when sorting by spxwScore desc', () => {
    const opps = [
      { symbol: 'NVDA', score: 82, scoreBreakdown: { indexEquivalent: 60 } },
      { symbol: 'SPXW', score: 75 },
      { symbol: 'AAPL', score: 70 },  // no indexEquivalent
    ];
    const sorted = [...opps].sort((a, b) => {
      const aVal = getSpxwScore(a) ?? -Infinity;
      const bVal = getSpxwScore(b) ?? -Infinity;
      return bVal - aVal;  // desc
    });
    expect(sorted[0].symbol).toBe('SPXW');   // 75
    expect(sorted[1].symbol).toBe('NVDA');   // 60
    expect(sorted[2].symbol).toBe('AAPL');   // -Infinity
  });

  it('sorts equity rows above SPXW when SPXW score is lower', () => {
    const opps = [
      { symbol: 'NVDA', score: 82, scoreBreakdown: { indexEquivalent: 80 } },
      { symbol: 'SPXW', score: 65 },
    ];
    const sorted = [...opps].sort((a, b) => {
      const aVal = getSpxwScore(a) ?? -Infinity;
      const bVal = getSpxwScore(b) ?? -Infinity;
      return bVal - aVal;
    });
    expect(sorted[0].symbol).toBe('NVDA');   // 80
    expect(sorted[1].symbol).toBe('SPXW');   // 65
  });
});
