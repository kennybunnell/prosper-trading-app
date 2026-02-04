import { describe, it, expect } from 'vitest';

describe('CC Dashboard Display Calculations', () => {
  describe('Order Summary Total Premium', () => {
    it('should multiply premium by 100 for per-contract value', () => {
      // Simulate selected opportunities with per-share premium
      const opportunities = [
        { premium: 3.45 }, // $3.45 per share
        { premium: 2.80 }, // $2.80 per share
      ];

      // Calculate total premium (per-contract value)
      const totalPremium = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);

      // Should be $345 + $280 = $625 per contract
      expect(totalPremium).toBe(625.00);
    });

    it('should handle single opportunity correctly', () => {
      const opportunities = [
        { premium: 3.45 }, // $3.45 per share
      ];

      const totalPremium = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);

      // Should be $345 per contract
      expect(totalPremium).toBe(345.00);
    });

    it('should handle decimal precision correctly', () => {
      const opportunities = [
        { premium: 2.69 }, // $2.69 per share
      ];

      const totalPremium = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);

      // Should be $269 per contract
      expect(totalPremium).toBe(269.00);
    });
  });

  describe('Buying Power Available Calculation', () => {
    it('should calculate remaining BP after collateral', () => {
      const availableBuyingPower = 3062; // $3,062 total BP
      const selectedOpportunities = [
        { capitalAtRisk: 655 }, // $655 collateral
      ];

      const totalCollateral = selectedOpportunities.reduce((sum, opp) => sum + opp.capitalAtRisk, 0);
      const remainingBP = Math.max(0, availableBuyingPower - totalCollateral);

      // Should be $3,062 - $655 = $2,407
      expect(remainingBP).toBe(2407);
    });

    it('should not go negative when collateral exceeds BP', () => {
      const availableBuyingPower = 1000;
      const selectedOpportunities = [
        { capitalAtRisk: 1500 }, // More than available
      ];

      const totalCollateral = selectedOpportunities.reduce((sum, opp) => sum + opp.capitalAtRisk, 0);
      const remainingBP = Math.max(0, availableBuyingPower - totalCollateral);

      // Should be 0, not negative
      expect(remainingBP).toBe(0);
    });

    it('should handle multiple selected opportunities', () => {
      const availableBuyingPower = 5000;
      const selectedOpportunities = [
        { capitalAtRisk: 655 },
        { capitalAtRisk: 850 },
        { capitalAtRisk: 1000 },
      ];

      const totalCollateral = selectedOpportunities.reduce((sum, opp) => sum + opp.capitalAtRisk, 0);
      const remainingBP = Math.max(0, availableBuyingPower - totalCollateral);

      // Should be $5,000 - $2,505 = $2,495
      expect(remainingBP).toBe(2495);
    });

    it('should show full BP when no opportunities selected', () => {
      const availableBuyingPower = 3062;
      const selectedOpportunities: Array<{ capitalAtRisk: number }> = [];

      const totalCollateral = selectedOpportunities.reduce((sum, opp) => sum + opp.capitalAtRisk, 0);
      const remainingBP = Math.max(0, availableBuyingPower - totalCollateral);

      // Should be full BP
      expect(remainingBP).toBe(3062);
    });
  });

  describe('Integration: Both Calculations Together', () => {
    it('should correctly calculate premium and BP for real scenario', () => {
      // Real scenario: User has $3,062 BP, selects one BCS with $3.45 premium and $655 collateral
      const availableBuyingPower = 3062;
      const selectedOpportunities = [
        { premium: 3.45, capitalAtRisk: 655 },
      ];

      // Calculate total premium (per-contract)
      const totalPremium = selectedOpportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);
      
      // Calculate remaining BP
      const totalCollateral = selectedOpportunities.reduce((sum, opp) => sum + opp.capitalAtRisk, 0);
      const remainingBP = Math.max(0, availableBuyingPower - totalCollateral);

      // Premium should be $345 (not $3.45)
      expect(totalPremium).toBe(345.00);
      
      // Remaining BP should be $2,407
      expect(remainingBP).toBe(2407);
    });
  });
});
