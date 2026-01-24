import { describe, it, expect } from "vitest";
import { getRecommendedFilterValues } from "./db-filter-presets";

describe("Filter Presets - Recommended Values", () => {
  describe("CSP Strategy Recommended Values", () => {
    it("should return conservative CSP values with low RSI range (oversold)", () => {
      const values = getRecommendedFilterValues("csp", "conservative");
      
      expect(values.minRsi).toBe(20);
      expect(values.maxRsi).toBe(35);
      expect(values.minBbPercent).toBe("0");
      expect(values.maxBbPercent).toBe("0.3");
      expect(values.minDelta).toBe("0.15");
      expect(values.maxDelta).toBe("0.25");
    });

    it("should return medium CSP values with moderate RSI range", () => {
      const values = getRecommendedFilterValues("csp", "medium");
      
      expect(values.minRsi).toBe(25);
      expect(values.maxRsi).toBe(45);
      expect(values.minBbPercent).toBe("0");
      expect(values.maxBbPercent).toBe("0.5");
      expect(values.minDelta).toBe("0.20");
      expect(values.maxDelta).toBe("0.30");
    });

    it("should return aggressive CSP values with higher RSI range", () => {
      const values = getRecommendedFilterValues("csp", "aggressive");
      
      expect(values.minRsi).toBe(30);
      expect(values.maxRsi).toBe(50);
      expect(values.minBbPercent).toBe("0");
      expect(values.maxBbPercent).toBe("0.7");
      expect(values.minDelta).toBe("0.25");
      expect(values.maxDelta).toBe("0.35");
    });

    it("should have lower BB %B for CSP (oversold conditions)", () => {
      const conservative = getRecommendedFilterValues("csp", "conservative");
      const medium = getRecommendedFilterValues("csp", "medium");
      const aggressive = getRecommendedFilterValues("csp", "aggressive");
      
      // All CSP strategies should target lower BB %B (oversold)
      expect(parseFloat(conservative.maxBbPercent)).toBeLessThan(0.5);
      expect(parseFloat(medium.maxBbPercent)).toBeLessThanOrEqual(0.5);
      expect(parseFloat(aggressive.maxBbPercent)).toBeLessThan(1.0);
    });
  });

  describe("CC Strategy Recommended Values", () => {
    it("should return conservative CC values with high RSI range (overbought)", () => {
      const values = getRecommendedFilterValues("cc", "conservative");
      
      expect(values.minRsi).toBe(65);
      expect(values.maxRsi).toBe(80);
      expect(values.minBbPercent).toBe("0.7");
      expect(values.maxBbPercent).toBe("1.0");
      expect(values.minDelta).toBe("0.15");
      expect(values.maxDelta).toBe("0.25");
    });

    it("should return medium CC values with moderate-high RSI range", () => {
      const values = getRecommendedFilterValues("cc", "medium");
      
      expect(values.minRsi).toBe(55);
      expect(values.maxRsi).toBe(75);
      expect(values.minBbPercent).toBe("0.5");
      expect(values.maxBbPercent).toBe("1.0");
      expect(values.minDelta).toBe("0.20");
      expect(values.maxDelta).toBe("0.30");
    });

    it("should return aggressive CC values with moderate RSI range", () => {
      const values = getRecommendedFilterValues("cc", "aggressive");
      
      expect(values.minRsi).toBe(50);
      expect(values.maxRsi).toBe(70);
      expect(values.minBbPercent).toBe("0.3");
      expect(values.maxBbPercent).toBe("1.0");
      expect(values.minDelta).toBe("0.25");
      expect(values.maxDelta).toBe("0.35");
    });

    it("should have higher BB %B for CC (overbought conditions)", () => {
      const conservative = getRecommendedFilterValues("cc", "conservative");
      const medium = getRecommendedFilterValues("cc", "medium");
      const aggressive = getRecommendedFilterValues("cc", "aggressive");
      
      // All CC strategies should target higher BB %B (overbought)
      expect(parseFloat(conservative.minBbPercent)).toBeGreaterThanOrEqual(0.7);
      expect(parseFloat(medium.minBbPercent)).toBeGreaterThanOrEqual(0.5);
      expect(parseFloat(aggressive.minBbPercent)).toBeGreaterThanOrEqual(0.3);
    });
  });

  describe("Strategy Comparison - CSP vs CC", () => {
    it("should have opposite RSI targets (CSP low, CC high)", () => {
      const cspConservative = getRecommendedFilterValues("csp", "conservative");
      const ccConservative = getRecommendedFilterValues("cc", "conservative");
      
      // CSP targets oversold (low RSI)
      expect(cspConservative.maxRsi).toBeLessThan(50);
      // CC targets overbought (high RSI)
      expect(ccConservative.minRsi).toBeGreaterThan(50);
    });

    it("should have opposite BB %B targets (CSP low, CC high)", () => {
      const cspMedium = getRecommendedFilterValues("csp", "medium");
      const ccMedium = getRecommendedFilterValues("cc", "medium");
      
      // CSP targets lower band (oversold)
      expect(parseFloat(cspMedium.maxBbPercent)).toBeLessThanOrEqual(0.5);
      // CC targets upper band (overbought)
      expect(parseFloat(ccMedium.minBbPercent)).toBeGreaterThanOrEqual(0.5);
    });

    it("should have similar delta ranges for both strategies", () => {
      const cspAggressive = getRecommendedFilterValues("csp", "aggressive");
      const ccAggressive = getRecommendedFilterValues("cc", "aggressive");
      
      // Both should use similar delta ranges (risk management)
      expect(cspAggressive.minDelta).toBe(ccAggressive.minDelta);
      expect(cspAggressive.maxDelta).toBe(ccAggressive.maxDelta);
    });

    it("should have increasing risk from conservative to aggressive", () => {
      const cspConservative = getRecommendedFilterValues("csp", "conservative");
      const cspMedium = getRecommendedFilterValues("csp", "medium");
      const cspAggressive = getRecommendedFilterValues("csp", "aggressive");
      
      // Delta should increase (more risk)
      expect(parseFloat(cspConservative.maxDelta)).toBeLessThan(parseFloat(cspMedium.maxDelta));
      expect(parseFloat(cspMedium.maxDelta)).toBeLessThan(parseFloat(cspAggressive.maxDelta));
      
      // DTE should decrease for aggressive (shorter time = more risk)
      expect(cspConservative.maxDte).toBeGreaterThan(cspMedium.maxDte);
      expect(cspMedium.maxDte).toBeGreaterThan(cspAggressive.maxDte);
    });
  });

  describe("Recommended Values Structure", () => {
    it("should return all required fields for CSP", () => {
      const values = getRecommendedFilterValues("csp", "conservative");
      
      expect(values).toHaveProperty("minDte");
      expect(values).toHaveProperty("maxDte");
      expect(values).toHaveProperty("minDelta");
      expect(values).toHaveProperty("maxDelta");
      expect(values).toHaveProperty("minOpenInterest");
      expect(values).toHaveProperty("minVolume");
      expect(values).toHaveProperty("minRsi");
      expect(values).toHaveProperty("maxRsi");
      expect(values).toHaveProperty("minIvRank");
      expect(values).toHaveProperty("maxIvRank");
      expect(values).toHaveProperty("minBbPercent");
      expect(values).toHaveProperty("maxBbPercent");
      expect(values).toHaveProperty("minScore");
      expect(values).toHaveProperty("maxStrikePercent");
    });

    it("should return all required fields for CC", () => {
      const values = getRecommendedFilterValues("cc", "medium");
      
      expect(values).toHaveProperty("minDte");
      expect(values).toHaveProperty("maxDte");
      expect(values).toHaveProperty("minDelta");
      expect(values).toHaveProperty("maxDelta");
      expect(values).toHaveProperty("minOpenInterest");
      expect(values).toHaveProperty("minVolume");
      expect(values).toHaveProperty("minRsi");
      expect(values).toHaveProperty("maxRsi");
      expect(values).toHaveProperty("minIvRank");
      expect(values).toHaveProperty("maxIvRank");
      expect(values).toHaveProperty("minBbPercent");
      expect(values).toHaveProperty("maxBbPercent");
      expect(values).toHaveProperty("minScore");
      expect(values).toHaveProperty("maxStrikePercent");
    });
  });
});
