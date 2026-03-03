/**
 * Unit tests for Weeks-to-Recover (WTR) scoring logic
 *
 * Tests the getWTRRecommendation function logic by extracting the
 * decision rules and verifying all four tiers behave correctly.
 */
import { describe, it, expect } from 'vitest';

// ─── Replicated scoring function (mirrors routers-position-analyzer.ts) ──────
type PositionRecommendation = 'KEEP' | 'HARVEST' | 'MONITOR' | 'LIQUIDATE';

function getWTRRecommendation(
  avgCostBasis: number,
  currentPrice: number,
  weeklyATMPremium: number | null,
): { recommendation: PositionRecommendation; weeksToRecover: number | null; monthsToRecover: number | null } {
  const deficit = avgCostBasis - currentPrice;

  if (deficit <= 0) {
    return { recommendation: 'KEEP', weeksToRecover: null, monthsToRecover: null };
  }

  const premium = weeklyATMPremium ?? 0;

  if (premium <= 0) {
    return { recommendation: 'LIQUIDATE', weeksToRecover: null, monthsToRecover: null };
  }

  const wtr = deficit / premium;
  const mtr = wtr / 4.33;

  if (wtr <= 16) return { recommendation: 'HARVEST', weeksToRecover: wtr, monthsToRecover: mtr };
  if (wtr <= 52) return { recommendation: 'MONITOR', weeksToRecover: wtr, monthsToRecover: mtr };
  return { recommendation: 'LIQUIDATE', weeksToRecover: wtr, monthsToRecover: mtr };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WTR Scoring — KEEP tier', () => {
  it('returns KEEP when price equals cost basis (no deficit)', () => {
    const result = getWTRRecommendation(100, 100, 2.00);
    expect(result.recommendation).toBe('KEEP');
    expect(result.weeksToRecover).toBeNull();
    expect(result.monthsToRecover).toBeNull();
  });

  it('returns KEEP when price is above cost basis', () => {
    const result = getWTRRecommendation(120, 152, 2.56); // PLTR scenario
    expect(result.recommendation).toBe('KEEP');
    expect(result.weeksToRecover).toBeNull();
  });

  it('returns KEEP even when premium is zero (no deficit)', () => {
    const result = getWTRRecommendation(50, 75, 0);
    expect(result.recommendation).toBe('KEEP');
  });

  it('returns KEEP when premium is null (no deficit)', () => {
    const result = getWTRRecommendation(200, 250, null);
    expect(result.recommendation).toBe('KEEP');
  });
});

describe('WTR Scoring — HARVEST tier (WTR ≤ 16 weeks)', () => {
  it('returns HARVEST for AMD scenario (WTR ≈ 6.8 weeks)', () => {
    const result = getWTRRecommendation(220, 200, 2.92);
    expect(result.recommendation).toBe('HARVEST');
    expect(result.weeksToRecover).toBeCloseTo(6.85, 1);
  });

  it('returns HARVEST for NBIS scenario (WTR ≈ 7.4 weeks)', () => {
    const result = getWTRRecommendation(110, 95, 2.03);
    expect(result.recommendation).toBe('HARVEST');
    expect(result.weeksToRecover).toBeCloseTo(7.39, 1);
  });

  it('returns HARVEST for APLD scenario (WTR ≈ 12.8 weeks)', () => {
    const result = getWTRRecommendation(38, 28.5, 0.74);
    expect(result.recommendation).toBe('HARVEST');
    expect(result.weeksToRecover).toBeCloseTo(12.84, 1);
  });

  it('returns HARVEST at exactly WTR = 16 weeks (boundary)', () => {
    const result = getWTRRecommendation(116, 100, 1.00); // deficit=16, premium=1 → WTR=16
    expect(result.recommendation).toBe('HARVEST');
    expect(result.weeksToRecover).toBeCloseTo(16, 1);
  });

  it('computes monthsToRecover correctly for HARVEST', () => {
    const result = getWTRRecommendation(220, 200, 2.92);
    expect(result.monthsToRecover).toBeCloseTo(result.weeksToRecover! / 4.33, 2);
  });
});

describe('WTR Scoring — MONITOR tier (WTR 17–52 weeks)', () => {
  it('returns MONITOR for CRM scenario (WTR ≈ 35 weeks)', () => {
    const result = getWTRRecommendation(280, 205, 2.13);
    expect(result.recommendation).toBe('MONITOR');
    expect(result.weeksToRecover).toBeCloseTo(35.21, 0);
  });

  it('returns MONITOR just above the 16-week boundary', () => {
    const result = getWTRRecommendation(117, 100, 1.00); // deficit=17, premium=1 → WTR=17
    expect(result.recommendation).toBe('MONITOR');
    expect(result.weeksToRecover).toBeCloseTo(17, 1);
  });

  it('returns MONITOR at exactly WTR = 52 weeks (boundary)', () => {
    const result = getWTRRecommendation(152, 100, 1.00); // deficit=52, premium=1 → WTR=52
    expect(result.recommendation).toBe('MONITOR');
    expect(result.weeksToRecover).toBeCloseTo(52, 1);
  });

  it('returns MONITOR for a 30-week scenario', () => {
    const result = getWTRRecommendation(130, 100, 1.00); // WTR=30
    expect(result.recommendation).toBe('MONITOR');
  });
});

describe('WTR Scoring — LIQUIDATE tier (WTR > 52 weeks)', () => {
  it('returns LIQUIDATE for ACHR scenario (WTR ≈ 77 weeks)', () => {
    const result = getWTRRecommendation(18, 6.5, 0.15);
    expect(result.recommendation).toBe('LIQUIDATE');
    expect(result.weeksToRecover).toBeCloseTo(76.67, 0);
  });

  it('returns LIQUIDATE for BMNR scenario (WTR ≈ 262 weeks)', () => {
    const result = getWTRRecommendation(25, 4, 0.08);
    expect(result.recommendation).toBe('LIQUIDATE');
    expect(result.weeksToRecover).toBeCloseTo(262.5, 0);
  });

  it('returns LIQUIDATE just above the 52-week boundary', () => {
    const result = getWTRRecommendation(153, 100, 1.00); // WTR=53
    expect(result.recommendation).toBe('LIQUIDATE');
  });

  it('returns LIQUIDATE when no premium available (cannot harvest)', () => {
    const result = getWTRRecommendation(50, 30, 0);
    expect(result.recommendation).toBe('LIQUIDATE');
    expect(result.weeksToRecover).toBeNull(); // no premium, WTR undefined
  });

  it('returns LIQUIDATE when premium is null and there is a deficit', () => {
    const result = getWTRRecommendation(50, 30, null);
    expect(result.recommendation).toBe('LIQUIDATE');
  });
});

describe('WTR Scoring — edge cases', () => {
  it('handles very small premium correctly (high WTR)', () => {
    const result = getWTRRecommendation(100, 50, 0.01); // WTR = 5000
    expect(result.recommendation).toBe('LIQUIDATE');
    expect(result.weeksToRecover).toBeCloseTo(5000, 0);
  });

  it('handles zero cost basis gracefully', () => {
    const result = getWTRRecommendation(0, 50, 1.00);
    // price > basis → KEEP
    expect(result.recommendation).toBe('KEEP');
  });

  it('handles equal price and basis at zero', () => {
    const result = getWTRRecommendation(0, 0, 1.00);
    // deficit = 0 → KEEP
    expect(result.recommendation).toBe('KEEP');
  });
});
