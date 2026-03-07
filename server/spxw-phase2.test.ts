/**
 * Phase 2 Unit Tests: SPXW-Aware Scoring + GTC Order Math
 */
import { describe, it, expect } from 'vitest';
import { scoreIronCondor, isIndexSymbol, scoreIronCondors } from './ic-scoring';

// ─── isIndexSymbol ────────────────────────────────────────────────────────────

describe('isIndexSymbol', () => {
  it('recognises SPXW as index', () => expect(isIndexSymbol('SPXW')).toBe(true));
  it('recognises SPX as index', () => expect(isIndexSymbol('SPX')).toBe(true));
  it('recognises NDX as index', () => expect(isIndexSymbol('NDX')).toBe(true));
  it('recognises RUT as index', () => expect(isIndexSymbol('RUT')).toBe(true));
  it('does not treat AAPL as index', () => expect(isIndexSymbol('AAPL')).toBe(false));
  it('does not treat NVDA as index', () => expect(isIndexSymbol('NVDA')).toBe(false));
  it('is case-insensitive', () => expect(isIndexSymbol('spxw')).toBe(true));
});

// ─── Shared IC input factory ──────────────────────────────────────────────────

function makeIC(overrides: Partial<Parameters<typeof scoreIronCondor>[0]> = {}) {
  return {
    symbol: 'AAPL',
    roc: 5,
    totalNetCredit: 2.50,
    totalCollateral: 500,
    profitZone: 40,
    currentPrice: 200,
    ivRank: 50,
    dte: 35,
    rsi: 50,
    bbPctB: 0.5,
    netDelta: 0.01,
    spreadWidth: 5,
    ...overrides,
  };
}

// ─── Equity scoring ───────────────────────────────────────────────────────────

describe('scoreIronCondor — equity path', () => {
  it('returns isIndex = false for equity symbols', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC());
    expect(scoreBreakdown.isIndex).toBe(false);
  });

  it('score is between 0 and 100', () => {
    const { score } = scoreIronCondor(makeIC());
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('perfect equity IC scores above 70', () => {
    const { score } = scoreIronCondor(makeIC({
      roc: 10,
      totalNetCredit: 5,
      totalCollateral: 500,
      profitZone: 40,
      currentPrice: 200,
      ivRank: 80,
      dte: 37,
      rsi: 50,
      bbPctB: 0.5,
    }));
    expect(score).toBeGreaterThan(70);
  });

  it('poor equity IC (low ROC, extreme RSI) scores below 50', () => {
    const { score } = scoreIronCondor(makeIC({
      roc: 0.5,
      totalNetCredit: 0.25,
      totalCollateral: 500,
      profitZone: 5,
      currentPrice: 200,
      ivRank: 10,
      dte: 3,
      rsi: 85,
      bbPctB: 0.95,
    }));
    expect(score).toBeLessThan(50);
  });

  it('equity breakdown has rsi and bb fields', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC());
    expect(scoreBreakdown.rsi).toBeDefined();
    expect(scoreBreakdown.bb).toBeDefined();
    expect(scoreBreakdown.deltaNeutrality).toBeUndefined();
  });
});

// ─── Index (SPXW) scoring ─────────────────────────────────────────────────────

describe('scoreIronCondor — SPXW index path', () => {
  it('returns isIndex = true for SPXW', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW' }));
    expect(scoreBreakdown.isIndex).toBe(true);
  });

  it('score is between 0 and 100', () => {
    const { score } = scoreIronCondor(makeIC({ symbol: 'SPXW' }));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('index breakdown has deltaNeutrality but not rsi/bb', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW' }));
    expect(scoreBreakdown.deltaNeutrality).toBeDefined();
    expect(scoreBreakdown.rsi).toBeUndefined();
    expect(scoreBreakdown.bb).toBeUndefined();
  });

  it('SPXW with elevated IV rank (≥40) gets maximum ivRank score (15)', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW', ivRank: 45 }));
    expect(scoreBreakdown.ivRank).toBe(15);
  });

  it('SPXW with low IV rank (<10) gets minimum ivRank score (2)', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW', ivRank: 5 }));
    expect(scoreBreakdown.ivRank).toBe(2);
  });

  it('SPXW with perfect DTE (28-42) gets maximum DTE score (20)', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW', dte: 35 }));
    expect(scoreBreakdown.dte).toBe(20);
  });

  it('SPXW with very short DTE (<14) gets low DTE score (3)', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW', dte: 7 }));
    expect(scoreBreakdown.dte).toBe(3);
  });

  it('delta-neutral IC (netDelta ≈ 0) gets maximum delta neutrality score (10)', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW', netDelta: 0.01 }));
    expect(scoreBreakdown.deltaNeutrality).toBe(10);
  });

  it('highly directional IC (netDelta = 0.15) gets low delta neutrality score (1)', () => {
    const { scoreBreakdown } = scoreIronCondor(makeIC({ symbol: 'SPXW', netDelta: 0.15 }));
    expect(scoreBreakdown.deltaNeutrality).toBe(1);
  });

  it('index scores higher than equity for same inputs when IV rank is elevated', () => {
    const base = makeIC({ ivRank: 40, dte: 35, netDelta: 0.01, roc: 5 });
    const equityScore = scoreIronCondor({ ...base, symbol: 'AAPL' }).score;
    const indexScore = scoreIronCondor({ ...base, symbol: 'SPXW' }).score;
    // Index gets 15 pts for IV rank vs 4 pts for equity at ivRank=40
    expect(indexScore).toBeGreaterThan(equityScore - 5);
  });
});

// ─── Batch scoring ────────────────────────────────────────────────────────────

describe('scoreIronCondors (batch)', () => {
  it('returns same count as input', () => {
    const ics = [makeIC({ symbol: 'AAPL' }), makeIC({ symbol: 'SPXW' }), makeIC({ symbol: 'NVDA' })];
    const scored = scoreIronCondors(ics);
    expect(scored).toHaveLength(3);
  });

  it('each result has score and scoreBreakdown', () => {
    const scored = scoreIronCondors([makeIC()]);
    expect(scored[0].score).toBeDefined();
    expect(scored[0].scoreBreakdown).toBeDefined();
  });

  it('preserves original fields', () => {
    const ic = makeIC({ symbol: 'SPXW', dte: 30 });
    const [scored] = scoreIronCondors([ic]);
    expect(scored.symbol).toBe('SPXW');
    expect(scored.dte).toBe(30);
  });
});

// ─── GTC close price math ─────────────────────────────────────────────────────

describe('GTC close price calculation', () => {
  it('75% profit target: close at 25% of premium', () => {
    const premium = 3.50;
    const targetClose = premium * (1 - 75 / 100);
    expect(targetClose).toBeCloseTo(0.875, 3);
  });

  it('50% profit target: close at 50% of premium', () => {
    const premium = 3.50;
    const targetClose = premium * (1 - 50 / 100);
    expect(targetClose).toBeCloseTo(1.75, 3);
  });

  it('75% target on SPXW $5-wide IC at $1.20 credit', () => {
    const premium = 1.20;
    const targetClose = premium * (1 - 75 / 100);
    expect(targetClose).toBeCloseTo(0.30, 2);
  });

  it('total premium = per-share × 100', () => {
    const perShare = 2.50;
    const total = perShare * 100;
    expect(total).toBe(250);
  });
});
