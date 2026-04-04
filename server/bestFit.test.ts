/**
 * Best Fit Optimizer — unit tests
 * Tests the rankBestFitCandidates scoring engine in rollDetection.ts
 */
import { describe, it, expect } from 'vitest';
import { rankBestFitCandidates } from './rollDetection';
import type { RollCandidate } from './rollDetection';

// Helper: build a minimal roll candidate
function makeRoll(overrides: Partial<RollCandidate> = {}): RollCandidate {
  return {
    action: 'roll',
    strike: 500,
    expiration: '2026-05-15',
    dte: 35,
    netCredit: 1.50,
    newPremium: 2.00,
    annualizedReturn: 25,
    meets3XRule: false,
    delta: -0.20,
    score: 60,
    description: 'Roll out to $500',
    ...overrides,
  };
}

const CLOSE: RollCandidate = {
  action: 'close',
  closeCost: 50,
  netPnl: 100,
  openPremium: 150,
  score: 50,
  description: 'Close',
};

describe('rankBestFitCandidates', () => {
  it('returns empty array when no roll candidates exist', () => {
    const result = rankBestFitCandidates([CLOSE], 500, true);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when candidates list is empty', () => {
    const result = rankBestFitCandidates([], 500, true);
    expect(result).toHaveLength(0);
  });

  it('excludes the close candidate from rankings', () => {
    const roll = makeRoll();
    const result = rankBestFitCandidates([CLOSE, roll], 500, true);
    expect(result).toHaveLength(1);
    expect(result[0].candidate.action).toBe('roll');
  });

  it('assigns rank 1 to the best candidate', () => {
    const r1 = makeRoll({ dte: 35, netCredit: 2.00, strike: 470 }); // 6% OTM on $500 stock — sweet spot
    const r2 = makeRoll({ dte: 7,  netCredit: 0.50, strike: 490 }); // 2% OTM, very low DTE
    const result = rankBestFitCandidates([r1, r2], 500, true);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
    // r1 should win: better DTE (35 vs 7) and better strike safety
    expect(result[0].candidate).toBe(r1);
  });

  it('prefers candidates in the 30–45 DTE sweet spot', () => {
    const shortDte = makeRoll({ dte: 10, netCredit: 1.50, strike: 470 });
    const sweetDte = makeRoll({ dte: 38, netCredit: 1.50, strike: 470 });
    const longDte  = makeRoll({ dte: 80, netCredit: 1.50, strike: 470 });
    const result = rankBestFitCandidates([shortDte, sweetDte, longDte], 500, true);
    expect(result[0].candidate).toBe(sweetDte);
    expect(result[0].dteScore).toBe(100);
  });

  it('penalises ITM strikes (strikeScore near 0)', () => {
    const itm  = makeRoll({ strike: 520, dte: 35, netCredit: 1.50 }); // ITM for a put on $500 stock
    const otm  = makeRoll({ strike: 465, dte: 35, netCredit: 1.50 }); // 7% OTM — sweet spot
    const result = rankBestFitCandidates([itm, otm], 500, true);
    // OTM candidate should have higher strikeScore
    const itmResult = result.find(r => r.candidate === itm)!;
    const otmResult = result.find(r => r.candidate === otm)!;
    expect(otmResult.strikeScore).toBeGreaterThan(itmResult.strikeScore);
  });

  it('awards 3X rule bonus to premium score', () => {
    const noBonus = makeRoll({ meets3XRule: false, netCredit: 1.50 });
    const bonus   = makeRoll({ meets3XRule: true,  netCredit: 1.50 });
    // Both have same credit so range = 0; bonus should push premiumScore higher
    const result = rankBestFitCandidates([noBonus, bonus], 500, true);
    const noBonusResult = result.find(r => r.candidate === noBonus)!;
    const bonusResult   = result.find(r => r.candidate === bonus)!;
    expect(bonusResult.premiumScore).toBeGreaterThan(noBonusResult.premiumScore);
  });

  it('respects custom weight overrides', () => {
    // With 100% DTE weight, the sweet-spot DTE candidate must win regardless of credit
    const highCredit = makeRoll({ dte: 7,  netCredit: 5.00, strike: 470 });
    const sweetDte   = makeRoll({ dte: 38, netCredit: 0.10, strike: 470 });
    const result = rankBestFitCandidates(
      [highCredit, sweetDte],
      500,
      true,
      { premiumWeight: 0, strikeWeight: 0, dteWeight: 1 }
    );
    expect(result[0].candidate).toBe(sweetDte);
  });

  it('composite score is between 0 and 100', () => {
    const candidates = [
      makeRoll({ dte: 35, netCredit: 2.00, strike: 470 }),
      makeRoll({ dte: 7,  netCredit: -1.00, strike: 510 }),
      makeRoll({ dte: 90, netCredit: 0.50, strike: 450 }),
    ];
    const result = rankBestFitCandidates(candidates, 500, true);
    for (const r of result) {
      expect(r.bestFitScore).toBeGreaterThanOrEqual(0);
      expect(r.bestFitScore).toBeLessThanOrEqual(100);
    }
  });

  it('works correctly for CC (call) positions', () => {
    // For a CC on $500 stock, OTM call strike = above $500
    const otmCall = makeRoll({ strike: 535, dte: 35, netCredit: 1.50 }); // 7% OTM call
    const itmCall = makeRoll({ strike: 480, dte: 35, netCredit: 1.50 }); // ITM call
    const result = rankBestFitCandidates([otmCall, itmCall], 500, false); // isPut = false
    const otmResult = result.find(r => r.candidate === otmCall)!;
    const itmResult = result.find(r => r.candidate === itmCall)!;
    expect(otmResult.strikeScore).toBeGreaterThan(itmResult.strikeScore);
  });
});
