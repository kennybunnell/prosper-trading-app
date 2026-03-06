/**
 * Unit tests for the Assignment Scenario Calculator
 * Tests: cash received, effective sale price, above/below market comparison
 */
import { describe, it, expect } from 'vitest';

// ─── Mirror the frontend calculation logic ────────────────────────────────────

function computeAssignmentScenario(opts: {
  strikeDisplay: string;
  contracts: number;
  premiumCollected: number;
  underlyingPrice: number | null;
}) {
  const { strikeDisplay, contracts, premiumCollected, underlyingPrice } = opts;

  const strikeMatch = strikeDisplay.match(/\$(\d+(?:\.\d+)?)/);
  const shortStrike = strikeMatch ? parseFloat(strikeMatch[1]) : null;
  const sharesPerContract = 100;
  const totalShares = contracts * sharesPerContract;
  const cashOnAssignment = shortStrike != null ? shortStrike * totalShares : null;
  const effectiveSalePrice = shortStrike != null && totalShares > 0
    ? shortStrike + (premiumCollected / totalShares)
    : null;
  const aboveMarket = effectiveSalePrice != null && underlyingPrice != null
    ? effectiveSalePrice > underlyingPrice
    : null;

  return { shortStrike, totalShares, cashOnAssignment, effectiveSalePrice, aboveMarket };
}

// ─── Strike Parsing ───────────────────────────────────────────────────────────

describe('Assignment Scenario - strike parsing', () => {
  it('parses single-leg CC strike display correctly', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 8,
      premiumCollected: 16691,
      underlyingPrice: 197.22,
    });
    expect(result.shortStrike).toBe(185);
  });

  it('parses the SHORT (first) strike from a spread display', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL / $190 CALL',
      contracts: 5,
      premiumCollected: 2500,
      underlyingPrice: 192.00,
    });
    expect(result.shortStrike).toBe(185);
  });

  it('handles decimal strikes', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$182.50 CALL',
      contracts: 2,
      premiumCollected: 800,
      underlyingPrice: 190.00,
    });
    expect(result.shortStrike).toBe(182.50);
  });

  it('returns null shortStrike when strikeDisplay is empty', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '',
      contracts: 5,
      premiumCollected: 2000,
      underlyingPrice: 190.00,
    });
    expect(result.shortStrike).toBeNull();
    expect(result.cashOnAssignment).toBeNull();
  });
});

// ─── Cash on Assignment ───────────────────────────────────────────────────────

describe('Assignment Scenario - cash received calculation', () => {
  it('calculates total cash correctly: contracts × 100 × strike', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 8,
      premiumCollected: 16691,
      underlyingPrice: 197.22,
    });
    // 8 contracts × 100 shares × $185 = $148,000
    expect(result.cashOnAssignment).toBe(148000);
    expect(result.totalShares).toBe(800);
  });

  it('handles 1 contract correctly', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$200 CALL',
      contracts: 1,
      premiumCollected: 500,
      underlyingPrice: 210.00,
    });
    expect(result.cashOnAssignment).toBe(20000);
    expect(result.totalShares).toBe(100);
  });

  it('handles large contract counts', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$150 CALL',
      contracts: 50,
      premiumCollected: 25000,
      underlyingPrice: 160.00,
    });
    expect(result.cashOnAssignment).toBe(750000);
    expect(result.totalShares).toBe(5000);
  });
});

// ─── Effective Sale Price ─────────────────────────────────────────────────────

describe('Assignment Scenario - effective sale price', () => {
  it('adds premium per share to strike price', () => {
    // $185 strike + ($16,691 / 800 shares) = $185 + $20.86 = $205.86
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 8,
      premiumCollected: 16691,
      underlyingPrice: 197.22,
    });
    expect(result.effectiveSalePrice).toBeCloseTo(185 + 16691 / 800, 2);
    expect(result.effectiveSalePrice!).toBeCloseTo(205.86, 1);
  });

  it('returns null when contracts is 0', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 0,
      premiumCollected: 0,
      underlyingPrice: 197.22,
    });
    expect(result.effectiveSalePrice).toBeNull();
  });

  it('handles zero premium (no premium collected)', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$200 CALL',
      contracts: 5,
      premiumCollected: 0,
      underlyingPrice: 210.00,
    });
    // Effective price = strike when no premium
    expect(result.effectiveSalePrice).toBe(200);
  });
});

// ─── Above / Below Market ─────────────────────────────────────────────────────

describe('Assignment Scenario - market comparison', () => {
  it('flags above market when effective price > current price', () => {
    // Effective = $205.86, current = $197.22 → above market
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 8,
      premiumCollected: 16691,
      underlyingPrice: 197.22,
    });
    expect(result.aboveMarket).toBe(true);
  });

  it('flags below market when effective price < current price', () => {
    // Strike $185, premium $500 on 800 shares = $185.63 effective, current = $220
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 8,
      premiumCollected: 500,
      underlyingPrice: 220.00,
    });
    expect(result.aboveMarket).toBe(false);
  });

  it('returns null when underlyingPrice is null', () => {
    const result = computeAssignmentScenario({
      strikeDisplay: '$185 CALL',
      contracts: 8,
      premiumCollected: 16691,
      underlyingPrice: null,
    });
    expect(result.aboveMarket).toBeNull();
  });

  it('handles exact equality (effective price equals current price)', () => {
    // $200 strike + $0 premium = $200 effective, current = $200 → not above market
    const result = computeAssignmentScenario({
      strikeDisplay: '$200 CALL',
      contracts: 5,
      premiumCollected: 0,
      underlyingPrice: 200.00,
    });
    expect(result.aboveMarket).toBe(false);
  });
});
