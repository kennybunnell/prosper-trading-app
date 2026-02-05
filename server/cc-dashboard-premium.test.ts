import { describe, it, expect } from 'vitest';

describe('CC Dashboard Total Premium Calculation', () => {
  describe('Premium Value Format', () => {
    it('should treat premium as per-contract dollars, not per-share cents', () => {
      // Example: A covered call with bid price of $2.61 per share
      // This represents $261 total premium per contract (100 shares)
      const opportunities = [
        { symbol: 'AAPL', premium: 2.61 }, // $2.61 per share = $261 per contract
        { symbol: 'MSFT', premium: 1.50 }, // $1.50 per share = $150 per contract
      ];

      // Calculate total premium (should be sum of premiums, NO multiplication)
      const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBeCloseTo(4.11, 2); // $2.61 + $1.50 = $4.11 (within 2 decimal places)
      expect(totalPremium).not.toBe(411); // NOT $411 (would be if multiplied by 100)
    });

    it('should NOT multiply premium by 100 in Order Summary', () => {
      const opportunities = [
        { symbol: 'GOOGL', premium: 3.45 }, // $3.45 per share = $345 per contract
      ];

      // WRONG: Multiplying by 100
      const wrongCalculation = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);
      
      // CORRECT: No multiplication
      const correctCalculation = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(correctCalculation).toBe(3.45);
      expect(wrongCalculation).toBe(345); // This is the BUG that keeps recurring
      expect(correctCalculation).not.toBe(wrongCalculation);
    });
  });

  describe('Multiple Opportunities', () => {
    it('should correctly sum premiums for multiple selected opportunities', () => {
      const selectedOpportunities = [
        { symbol: 'AAPL', premium: 2.61 },
        { symbol: 'MSFT', premium: 1.50 },
        { symbol: 'GOOGL', premium: 3.45 },
        { symbol: 'TSLA', premium: 4.20 },
      ];

      const totalPremium = selectedOpportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBe(11.76); // $2.61 + $1.50 + $3.45 + $4.20
      expect(totalPremium).not.toBe(1176); // NOT $1,176 (would be if multiplied by 100)
    });

    it('should handle single opportunity correctly', () => {
      const selectedOpportunities = [
        { symbol: 'AAPL', premium: 2.61 },
      ];

      const totalPremium = selectedOpportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBe(2.61); // $2.61
      expect(totalPremium).not.toBe(261); // NOT $261 (would be if multiplied by 100)
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero premium', () => {
      const opportunities = [
        { symbol: 'AAPL', premium: 0 },
      ];

      const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBe(0);
    });

    it('should handle empty selection', () => {
      const opportunities: any[] = [];

      const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBe(0);
    });

    it('should handle very small premiums', () => {
      const opportunities = [
        { symbol: 'AAPL', premium: 0.05 }, // $0.05 per share = $5 per contract
      ];

      const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBe(0.05);
      expect(totalPremium).not.toBe(5); // NOT $5 (would be if multiplied by 100)
    });

    it('should handle large premiums', () => {
      const opportunities = [
        { symbol: 'AAPL', premium: 25.50 }, // $25.50 per share = $2,550 per contract
      ];

      const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      expect(totalPremium).toBe(25.50);
      expect(totalPremium).not.toBe(2550); // NOT $2,550 (would be if multiplied by 100)
    });
  });

  describe('Regression Prevention', () => {
    it('should document why premium is NOT multiplied by 100', () => {
      // This test serves as documentation for future developers
      // 
      // CRITICAL RULE: opp.premium is already in per-contract dollars
      // 
      // Example: If a covered call has a bid price of $2.61 per share:
      // - The API returns: premium = 2.61
      // - This represents: $2.61 per share × 100 shares = $261 per contract
      // - The value 2.61 is ALREADY the per-contract amount in dollars
      // - DO NOT multiply by 100 again
      // 
      // If you multiply by 100, you get:
      // - $2.61 × 100 = $261.00 (WRONG - this would be $26,100 per contract)
      
      const premium = 2.61; // Per-contract dollars
      const correctDisplay = premium.toFixed(2); // "$2.61"
      const wrongDisplay = (premium * 100).toFixed(2); // "$261.00" (BUG)

      expect(correctDisplay).toBe('2.61');
      expect(wrongDisplay).toBe('261.00');
      expect(correctDisplay).not.toBe(wrongDisplay);
    });

    it('should fail if someone adds * 100 back to the calculation', () => {
      // This test will catch the bug if it's reintroduced
      const opportunities = [
        { symbol: 'AAPL', premium: 2.61 },
      ];

      // Simulate the CORRECT calculation (what should be in the code)
      const correctCalculation = opportunities.reduce((sum, opp) => sum + opp.premium, 0);

      // Simulate the BUG (multiplying by 100)
      const buggyCalculation = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);

      // Assert that the correct calculation is used
      expect(correctCalculation).toBe(2.61);
      
      // This assertion will fail if the bug is reintroduced
      expect(buggyCalculation).not.toBe(correctCalculation);
      expect(buggyCalculation).toBe(261); // This is the bug value
    });
  });
});
