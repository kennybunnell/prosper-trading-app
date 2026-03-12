import { describe, it, expect } from "vitest";
import { getRecommendedFilterValues } from "./db-filter-presets";

describe("Filter Presets - Recommended Values", () => {
  describe("CSP Strategy Recommended Values", () => {
    it("should return conservative CSP values", () => {
      const values = getRecommendedFilterValues("csp", "conservative");

      expect(values.minRsi).toBe(20);
      expect(values.maxRsi).toBe(70);
      expect(values.minBbPercent).toBe("0");
      expect(values.maxBbPercent).toBe("0.7");
      expect(values.minDelta).toBe("0.10");
      expect(values.maxDelta).toBe("0.25");
    });

    it("should return medium CSP values", () => {
      const values = getRecommendedFilterValues("csp", "medium");

      expect(values.minRsi).toBe(15);
      expect(values.maxRsi).toBe(80);
      expect(values.minBbPercent).toBe("0");
      expect(values.maxBbPercent).toBe("0.8");
      expect(values.minDelta).toBe("0.15");
      expect(values.maxDelta).toBe("0.35");
    });

    it("should return aggressive CSP values", () => {
      const values = getRecommendedFilterValues("csp", "aggressive");

      expect(values.minRsi).toBe(10);
      expect(values.maxRsi).toBe(90);
      expect(values.minBbPercent).toBe("0");
      expect(values.maxBbPercent).toBe("1.0");
      expect(values.minDelta).toBe("0.20");
      expect(values.maxDelta).toBe("0.45");
    });

    it("should have increasing BB %B cap from conservative to aggressive for CSP", () => {
      const conservative = getRecommendedFilterValues("csp", "conservative");
      const medium = getRecommendedFilterValues("csp", "medium");
      const aggressive = getRecommendedFilterValues("csp", "aggressive");

      // BB %B cap increases as risk tolerance increases
      expect(parseFloat(conservative.maxBbPercent)).toBeLessThan(parseFloat(medium.maxBbPercent));
      expect(parseFloat(medium.maxBbPercent)).toBeLessThan(parseFloat(aggressive.maxBbPercent));
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
      expect(values.maxDelta).toBe("0.28");
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
    it("should have CC targeting overbought RSI", () => {
      const ccConservative = getRecommendedFilterValues("cc", "conservative");

      // CC targets overbought (high RSI floor)
      expect(ccConservative.minRsi).toBeGreaterThan(50);
    });

    it("should have CC targeting upper BB band", () => {
      const ccConservative = getRecommendedFilterValues("cc", "conservative");

      // CC targets upper band (overbought) — floor is high
      expect(parseFloat(ccConservative.minBbPercent)).toBeGreaterThanOrEqual(0.5);
    });

    it("should have increasing delta cap from conservative to aggressive for CSP", () => {
      const cspConservative = getRecommendedFilterValues("csp", "conservative");
      const cspMedium = getRecommendedFilterValues("csp", "medium");
      const cspAggressive = getRecommendedFilterValues("csp", "aggressive");

      // Delta cap should increase (more risk tolerance)
      expect(parseFloat(cspConservative.maxDelta)).toBeLessThan(parseFloat(cspMedium.maxDelta));
      expect(parseFloat(cspMedium.maxDelta)).toBeLessThan(parseFloat(cspAggressive.maxDelta));
    });

    it("should have decreasing max DTE from conservative to aggressive for CSP", () => {
      const cspConservative = getRecommendedFilterValues("csp", "conservative");
      const cspMedium = getRecommendedFilterValues("csp", "medium");
      const cspAggressive = getRecommendedFilterValues("csp", "aggressive");

      // DTE should decrease for aggressive (shorter time = more risk)
      expect(cspConservative.maxDte).toBeGreaterThanOrEqual(cspMedium.maxDte);
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
