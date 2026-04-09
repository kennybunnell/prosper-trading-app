/**
 * Tests for Open Interest (OI) scoring across all strategy scoring functions.
 * Verifies that:
 * 1. High OI (≥500) earns maximum liquidity points (+15)
 * 2. OI=0 receives a hard penalty (-10)
 * 3. The liquidity score is included in the total score
 * 4. BPS scoring also applies OI penalties correctly
 */

import { describe, it, expect } from 'vitest';
import { calculateCSPScore, calculateBPSScore } from './scoring';
import type { CSPOpportunity } from './tradier';
import type { ScoredBPSOpportunity } from './scoring';

// Minimal CSP opportunity fixture for testing
function makeCSPOpp(overrides: Partial<CSPOpportunity> = {}): CSPOpportunity {
  return {
    symbol: 'AAPL',
    optionSymbol: 'AAPL240101P00150000',
    strike: 150,
    currentPrice: 170,
    expiration: '2024-01-01',
    dte: 10,
    premium: 1.5,
    bid: 1.4,
    ask: 1.6,
    premiumPct: 1.0,
    weeklyPct: 1.0,
    monthlyPct: 4.0,
    annualPct: 48.0,
    delta: -0.25,
    theta: -0.05,
    volume: 100,
    openInterest: 500, // default: high OI
    rsi: 30,
    ivRank: 60,
    bbPctB: 0.1,
    spreadPct: 3,
    collateral: 15000,
    roc: 1.0,
    multiplier: 100,
    ...overrides,
  };
}

// Minimal BPS opportunity fixture
function makeBPSOpp(overrides: Partial<ScoredBPSOpportunity> = {}): ScoredBPSOpportunity {
  return {
    symbol: 'SPY',
    optionSymbol: 'SPY240101P00440000',
    strike: 440,
    currentPrice: 460,
    expiration: '2024-01-01',
    dte: 10,
    premium: 1.0,
    bid: 0.9,
    ask: 1.1,
    premiumPct: 0.23,
    weeklyPct: 0.5,
    monthlyPct: 2.0,
    annualPct: 24.0,
    delta: -0.28,
    theta: -0.04,
    volume: 200,
    openInterest: 500,
    rsi: 45,
    ivRank: 55,
    bbPctB: 0.5,
    spreadPct: 5,
    collateral: 44000,
    roc: 10,
    multiplier: 100,
    // BPS-specific
    longStrike: 435,
    longBid: 0.3,
    longAsk: 0.4,
    longDelta: -0.15,
    spreadWidth: 5,
    netCredit: 0.6,
    capitalRisk: 440,
    score: 0,
    scoreBreakdown: {} as any,
    trendBias: 'Bullish',
    trend14d: 3,
    ...overrides,
  };
}

describe('CSP OI Scoring', () => {
  it('awards maximum liquidity points (15) for OI ≥ 500', () => {
    const opp = makeCSPOpp({ openInterest: 500 });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(15);
  });

  it('awards 12 liquidity points for OI ≥ 200', () => {
    const opp = makeCSPOpp({ openInterest: 250 });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(12);
  });

  it('awards 9 liquidity points for OI ≥ 100', () => {
    const opp = makeCSPOpp({ openInterest: 120 });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(9);
  });

  it('awards 6 liquidity points for OI ≥ 50', () => {
    const opp = makeCSPOpp({ openInterest: 75 });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(6);
  });

  it('awards 3 liquidity points for OI ≥ 10', () => {
    const opp = makeCSPOpp({ openInterest: 15 });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(3);
  });

  it('applies -10 penalty for OI = 0', () => {
    const opp = makeCSPOpp({ openInterest: 0 });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(-10);
  });

  it('total score for OI=0 is significantly lower than OI=500', () => {
    const highOI = makeCSPOpp({ openInterest: 500 });
    const zeroOI = makeCSPOpp({ openInterest: 0 });
    const { score: scoreHigh } = calculateCSPScore(highOI);
    const { score: scoreZero } = calculateCSPScore(zeroOI);
    // Difference should be 15 - (-10) = 25 points
    expect(scoreHigh - scoreZero).toBe(25);
  });

  it('liquidity is included in the total score', () => {
    const opp = makeCSPOpp({ openInterest: 500 });
    const { score, breakdown } = calculateCSPScore(opp);
    const expectedTotal = breakdown.technical + breakdown.greeks + breakdown.premium + breakdown.quality + (breakdown.liquidity ?? 0) + (breakdown.perfectSetupBonus ?? 0);
    expect(score).toBe(expectedTotal);
  });

  it('XSP (index) with OI=0 gets penalised', () => {
    const opp = makeCSPOpp({ symbol: 'XSP', openInterest: 0, rsi: null, bbPctB: null });
    const { breakdown } = calculateCSPScore(opp);
    expect(breakdown.liquidity).toBe(-10);
  });
});

describe('BPS OI Scoring', () => {
  it('awards maximum liquidity points (15) for OI ≥ 500', () => {
    const opp = makeBPSOpp({ openInterest: 600 });
    const { breakdown } = calculateBPSScore(opp);
    expect(breakdown.liquidity).toBe(15);
  });

  it('applies -10 penalty for OI = 0', () => {
    const opp = makeBPSOpp({ openInterest: 0 });
    const { breakdown } = calculateBPSScore(opp);
    expect(breakdown.liquidity).toBe(-10);
  });

  it('total score for OI=0 is 25 points lower than OI=500', () => {
    const highOI = makeBPSOpp({ openInterest: 500 });
    const zeroOI = makeBPSOpp({ openInterest: 0 });
    const { score: scoreHigh } = calculateBPSScore(highOI);
    const { score: scoreZero } = calculateBPSScore(zeroOI);
    expect(scoreHigh - scoreZero).toBe(25);
  });
});
