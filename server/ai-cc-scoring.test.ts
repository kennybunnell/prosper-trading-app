/**
 * Unit tests for AI Tier 1 CC scoring logic
 *
 * Tests cover:
 *  1. Score colour classification (green / blue / amber / red)
 *  2. OTM% calculation used in the LLM prompt
 *  3. Bid-ask spread % calculation used in the LLM prompt
 *  4. Two-tranche classification: clean vs amber
 *  5. "Select All Clean" helper logic
 *  6. Auto-select behaviour after scoring (clean selected, amber deselected)
 */

import { describe, it, expect } from 'vitest';

// ── Score colour helper (mirrors AutomationDashboard.tsx) ─────────────────────

function scoreColor(score: number): 'green' | 'blue' | 'amber' | 'red' {
  if (score >= 85) return 'green';
  if (score >= 65) return 'blue';
  if (score >= 45) return 'amber';
  return 'red';
}

// ── OTM% calculation (mirrors routers-automation.ts scoreCCOpportunities) ────

function calcOtmPct(strike: number, currentPrice: number): number {
  return (strike - currentPrice) / currentPrice * 100;
}

// ── Bid-ask spread % (mirrors routers-automation.ts scoreCCOpportunities) ─────

function calcBidAskSpreadPct(bid: number, ask: number, mid: number): number {
  if (mid <= 0) return 0;
  return (ask - bid) / mid * 100;
}

// ── Tranche classification ─────────────────────────────────────────────────────

type ScoredRow = {
  optionSymbol: string;
  account: string;
  aiRecommendedDte?: number | null;
};

function classifyTranches(rows: ScoredRow[]): { clean: ScoredRow[]; amber: ScoredRow[] } {
  return {
    clean: rows.filter(r => !r.aiRecommendedDte),
    amber: rows.filter(r => !!r.aiRecommendedDte),
  };
}

function selectAllCleanKeys(rows: ScoredRow[]): Set<string> {
  return new Set(rows.filter(r => !r.aiRecommendedDte).map(r => `${r.optionSymbol}|${r.account}`));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AI CC Scoring — score colour classification', () => {
  it('score 85-100 → green (strong)', () => {
    expect(scoreColor(85)).toBe('green');
    expect(scoreColor(92)).toBe('green');
    expect(scoreColor(100)).toBe('green');
  });

  it('score 65-84 → blue (good)', () => {
    expect(scoreColor(65)).toBe('blue');
    expect(scoreColor(75)).toBe('blue');
    expect(scoreColor(84)).toBe('blue');
  });

  it('score 45-64 → amber (marginal)', () => {
    expect(scoreColor(45)).toBe('amber');
    expect(scoreColor(55)).toBe('amber');
    expect(scoreColor(64)).toBe('amber');
  });

  it('score 0-44 → red (weak)', () => {
    expect(scoreColor(0)).toBe('red');
    expect(scoreColor(30)).toBe('red');
    expect(scoreColor(44)).toBe('red');
  });
});

describe('AI CC Scoring — OTM% calculation for LLM prompt', () => {
  it('calculates OTM% correctly for a typical CC setup', () => {
    // AAPL at $185, $190 strike → (190-185)/185 = 2.7%
    const pct = calcOtmPct(190, 185);
    expect(pct).toBeCloseTo(2.7, 1);
  });

  it('returns 0% when strike equals current price (ATM)', () => {
    expect(calcOtmPct(200, 200)).toBe(0);
  });

  it('returns negative OTM% when strike is below current price (ITM)', () => {
    const pct = calcOtmPct(180, 185);
    expect(pct).toBeLessThan(0);
  });
});

describe('AI CC Scoring — bid-ask spread % for LLM prompt', () => {
  it('calculates tight spread correctly (<10% = good liquidity)', () => {
    // bid=1.90, ask=2.10, mid=2.00 → spread% = 0.20/2.00 = 10%
    const pct = calcBidAskSpreadPct(1.90, 2.10, 2.00);
    expect(pct).toBeCloseTo(10, 1);
  });

  it('calculates wide spread correctly (>20% = poor liquidity)', () => {
    // bid=0.80, ask=1.20, mid=1.00 → spread% = 0.40/1.00 = 40%
    const pct = calcBidAskSpreadPct(0.80, 1.20, 1.00);
    expect(pct).toBeCloseTo(40, 1);
  });

  it('returns 0 when mid is 0 (avoids division by zero)', () => {
    expect(calcBidAskSpreadPct(0, 0, 0)).toBe(0);
  });
});

describe('AI CC Scoring — two-tranche classification', () => {
  const rows: ScoredRow[] = [
    { optionSymbol: 'AAPL260117C00190000', account: 'ACC1', aiRecommendedDte: null },
    { optionSymbol: 'MSFT260117C00420000', account: 'ACC1', aiRecommendedDte: 14 },
    { optionSymbol: 'NVDA260117C00600000', account: 'ACC2', aiRecommendedDte: null },
    { optionSymbol: 'TSLA260117C00250000', account: 'ACC2', aiRecommendedDte: 21 },
  ];

  it('classifies clean rows correctly (no recommendedDte)', () => {
    const { clean } = classifyTranches(rows);
    expect(clean).toHaveLength(2);
    expect(clean.map(r => r.optionSymbol)).toContain('AAPL260117C00190000');
    expect(clean.map(r => r.optionSymbol)).toContain('NVDA260117C00600000');
  });

  it('classifies amber rows correctly (has recommendedDte)', () => {
    const { amber } = classifyTranches(rows);
    expect(amber).toHaveLength(2);
    expect(amber.map(r => r.optionSymbol)).toContain('MSFT260117C00420000');
    expect(amber.map(r => r.optionSymbol)).toContain('TSLA260117C00250000');
  });

  it('returns all rows as clean when no AI recommendations exist', () => {
    const allClean: ScoredRow[] = rows.map(r => ({ ...r, aiRecommendedDte: null }));
    const { clean, amber } = classifyTranches(allClean);
    expect(clean).toHaveLength(4);
    expect(amber).toHaveLength(0);
  });
});

describe('AI CC Scoring — Select All Clean helper', () => {
  const rows: ScoredRow[] = [
    { optionSymbol: 'AAPL260117C00190000', account: 'ACC1', aiRecommendedDte: null },
    { optionSymbol: 'MSFT260117C00420000', account: 'ACC1', aiRecommendedDte: 14 },
    { optionSymbol: 'NVDA260117C00600000', account: 'ACC2', aiRecommendedDte: null },
  ];

  it('selects only clean row keys', () => {
    const keys = selectAllCleanKeys(rows);
    expect(keys.size).toBe(2);
    expect(keys.has('AAPL260117C00190000|ACC1')).toBe(true);
    expect(keys.has('NVDA260117C00600000|ACC2')).toBe(true);
    expect(keys.has('MSFT260117C00420000|ACC1')).toBe(false);
  });

  it('selects all rows when none have DTE recommendations', () => {
    const allClean = rows.map(r => ({ ...r, aiRecommendedDte: null }));
    const keys = selectAllCleanKeys(allClean);
    expect(keys.size).toBe(3);
  });

  it('returns empty set when all rows are amber', () => {
    const allAmber = rows.map(r => ({ ...r, aiRecommendedDte: 14 }));
    const keys = selectAllCleanKeys(allAmber);
    expect(keys.size).toBe(0);
  });
});

describe('AI CC Scoring — auto-select after scoring', () => {
  it('auto-selects clean rows and excludes amber rows', () => {
    const rows: ScoredRow[] = [
      { optionSymbol: 'AAPL260117C00190000', account: 'ACC1', aiRecommendedDte: null },
      { optionSymbol: 'MSFT260117C00420000', account: 'ACC1', aiRecommendedDte: 14 },
    ];
    const keys = selectAllCleanKeys(rows);
    // AAPL (clean) should be selected
    expect(keys.has('AAPL260117C00190000|ACC1')).toBe(true);
    // MSFT (amber) should NOT be selected
    expect(keys.has('MSFT260117C00420000|ACC1')).toBe(false);
  });

  it('selects all rows when AI scoring is disabled (no recommendedDte on any row)', () => {
    const rows: ScoredRow[] = [
      { optionSymbol: 'AAPL260117C00190000', account: 'ACC1' },
      { optionSymbol: 'MSFT260117C00420000', account: 'ACC1' },
    ];
    // When AI is off, aiRecommendedDte is undefined — treated as clean
    const keys = selectAllCleanKeys(rows);
    expect(keys.size).toBe(2);
  });
});
