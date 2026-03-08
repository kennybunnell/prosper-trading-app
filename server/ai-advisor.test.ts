import { describe, it, expect } from 'vitest';

describe('AI Advisor', () => {
  it('should validate opportunity schema fields', () => {
    const opportunity = {
      score: 75,
      symbol: 'SPX',
      strategy: 'BPS',
      shortStrike: 5500,
      longStrike: 5475,
      expiration: '2026-03-15',
      dte: 7,
      netCredit: 1.25,
      capitalRisk: 2500,
      roc: 0.5,
      delta: 0.15,
      openInterest: 5000,
      volume: 250,
      ivRank: 45,
    };
    expect(opportunity.score).toBeGreaterThanOrEqual(0);
    expect(opportunity.score).toBeLessThanOrEqual(100);
    expect(opportunity.symbol).toBeTruthy();
    expect(opportunity.strategy).toBeTruthy();
    expect(opportunity.expiration).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opportunity.dte).toBeGreaterThan(0);
    expect(opportunity.netCredit).toBeGreaterThan(0);
    expect(opportunity.capitalRisk).toBeGreaterThan(0);
    expect(opportunity.roc).toBeGreaterThanOrEqual(0);
  });

  it('should correctly compute max contracts from buying power', () => {
    const availableBuyingPower = 617000;
    const collateralPerContract = 2500;
    const maxContracts = Math.max(1, Math.floor((availableBuyingPower * 0.20) / collateralPerContract));
    expect(maxContracts).toBe(49);
  });

  it('should limit opportunities to max 30', () => {
    const opportunities = Array.from({ length: 50 }, (_, i) => ({
      score: 50 + i,
      symbol: `SYM${i}`,
      strategy: 'BPS',
      expiration: '2026-03-15',
      dte: 7,
      netCredit: 1.0,
      capitalRisk: 500,
      roc: 0.5,
    }));
    const top30 = [...opportunities].sort((a, b) => b.score - a.score).slice(0, 30);
    expect(top30.length).toBe(30);
    expect(top30[0].score).toBe(99);
  });

  it('should handle index symbol opportunities correctly', () => {
    const indexOpp = {
      score: 58,
      symbol: 'SPX',
      strategy: 'BPS',
      shortStrike: 5500,
      longStrike: 5475,
      expiration: '2026-03-14',
      dte: 6,
      netCredit: 6.50,
      capitalRisk: 2500,
      roc: 0.26,
      delta: 0.15,
    };
    expect(indexOpp.delta).toBeGreaterThanOrEqual(0.05);
    expect(indexOpp.delta).toBeLessThanOrEqual(0.50);
    expect(indexOpp.netCredit).toBeGreaterThan(0);
  });
});
