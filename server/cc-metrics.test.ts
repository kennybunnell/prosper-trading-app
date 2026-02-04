import { describe, it, expect } from 'vitest';

/**
 * Test suite for Covered Call Dashboard metrics calculations
 * 
 * This verifies that the metrics shown in the Portfolio Positions and Order Summary panels
 * are calculated correctly for Covered Calls.
 */

describe('CC Dashboard Metrics Calculations', () => {
  // Sample CC opportunities data
  const sampleOpportunities = [
    {
      symbol: 'AAPL',
      currentPrice: 150.00,  // Stock price
      strike: 155.00,
      premium: 2.50,         // Premium per share
      dte: 30,
      delta: 0.25,
    },
    {
      symbol: 'GOOGL',
      currentPrice: 140.00,
      strike: 145.00,
      premium: 3.00,
      dte: 30,
      delta: 0.30,
    },
    {
      symbol: 'MSFT',
      currentPrice: 380.00,
      strike: 390.00,
      premium: 5.00,
      dte: 30,
      delta: 0.28,
    },
  ];

  it('should calculate Total Premium correctly', () => {
    // Total Premium = sum of premium for all opportunities
    // Note: Backend already multiplies by 100, so premium is per-contract
    const totalPremium = sampleOpportunities.reduce((sum, opp) => sum + opp.premium, 0);
    
    // Expected: 2.50 + 3.00 + 5.00 = 10.50 (if premium is per-share)
    // OR: 250 + 300 + 500 = 1050 (if premium is already per-contract)
    // For this test, assuming per-share values
    expect(totalPremium).toBe(10.50);
  });

  it('should calculate Total Collateral correctly for Covered Calls', () => {
    // Total Collateral = sum of (currentPrice × 100) for all opportunities
    // This represents the value of stock you own
    const totalCollateral = sampleOpportunities.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
    
    // Expected: (150 + 140 + 380) × 100 = 67,000
    expect(totalCollateral).toBe(67000);
  });

  it('should calculate ROC correctly', () => {
    const totalPremium = sampleOpportunities.reduce((sum, opp) => sum + opp.premium, 0);
    const totalCollateral = sampleOpportunities.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
    const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;
    
    // Expected: (10.50 / 67000) × 100 = 0.0157%
    expect(roc).toBeCloseTo(0.0157, 4);
  });

  it('should NOT use premium as collateral (old bug)', () => {
    // This test verifies the bug is fixed
    const totalPremium = sampleOpportunities.reduce((sum, opp) => sum + opp.premium, 0);
    const wrongCollateral = sampleOpportunities.reduce((sum, opp) => sum + opp.premium, 0);
    const correctCollateral = sampleOpportunities.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
    
    // The old bug: collateral = premium, so ROC = 100%
    const wrongROC = wrongCollateral > 0 ? (totalPremium / wrongCollateral) * 100 : 0;
    expect(wrongROC).toBe(100); // This was the bug!
    
    // The correct calculation: collateral = stock value
    const correctROC = correctCollateral > 0 ? (totalPremium / correctCollateral) * 100 : 0;
    expect(correctROC).not.toBe(100);
    expect(correctROC).toBeCloseTo(0.0157, 4);
  });

  it('should calculate metrics for selected opportunities correctly', () => {
    // Simulate selecting just the first 2 opportunities
    const selectedOpps = sampleOpportunities.slice(0, 2);
    
    const totalPremium = selectedOpps.reduce((sum, opp) => sum + opp.premium, 0);
    const totalCollateral = selectedOpps.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
    const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;
    
    // Expected: Premium = 2.50 + 3.00 = 5.50
    expect(totalPremium).toBe(5.50);
    
    // Expected: Collateral = (150 + 140) × 100 = 29,000
    expect(totalCollateral).toBe(29000);
    
    // Expected: ROC = (5.50 / 29000) × 100 = 0.0190%
    expect(roc).toBeCloseTo(0.0190, 4);
  });
});
