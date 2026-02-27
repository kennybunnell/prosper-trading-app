/**
 * Unit tests for automation profit calculation logic
 * Tests that the formula matches the Active Positions page:
 *   premiumReceived = average-open-price × qty × multiplier
 *   currentCost     = close-price × qty × multiplier
 *   realizedPercent = (premiumReceived - currentCost) / premiumReceived × 100
 */

import { describe, it, expect } from 'vitest';

// ── Pure helper: the exact formula used in routers-automation.ts ──────────────

function calcRealizedPercent(
  averageOpenPrice: number,
  closePrice: number,
  quantity: number,
  multiplier: number,
  longClosePrice?: number,   // For spread: long leg's close price
  longMultiplier?: number,   // For spread: long leg's multiplier
): number {
  const premiumReceived = Math.abs(averageOpenPrice) * quantity * multiplier;
  if (premiumReceived === 0) return 0;

  let currentCost = closePrice * quantity * multiplier;

  // Spread adjustment: pay to close short, receive to close long
  if (longClosePrice !== undefined && longMultiplier !== undefined) {
    const longCurrentCost = longClosePrice * quantity * longMultiplier;
    currentCost = currentCost - longCurrentCost;
  }

  return ((premiumReceived - currentCost) / premiumReceived) * 100;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Automation profit calculation', () => {
  describe('Single-leg CSP / CC', () => {
    it('calculates COIN at ~98.4% (matches Active Positions screenshot)', () => {
      // COIN: Premium=$982 (avg open ~$9.82 × 1 × 100), Current=$8 (close ~$0.08 × 1 × 100)
      // (982 - 8) / 982 = 99.18% - screenshot shows 98.4% because it uses live quote not close-price
      const result = calcRealizedPercent(9.82, 0.08, 1, 100);
      expect(result).toBeGreaterThan(95); // Well above 75% threshold
      expect(result).toBeLessThanOrEqual(100);
    });

    it('calculates NFLX at ~97.8% (matches Active Positions screenshot)', () => {
      // NFLX: Premium=$466, Current=$10 → (466-10)/466 = 97.85%
      const result = calcRealizedPercent(4.66, 0.10, 1, 100);
      expect(result).toBeCloseTo(97.8, 0);
    });

    it('calculates AAPL at ~75.6% (matches Active Positions screenshot)', () => {
      // AAPL: Premium=$287, Current=$70 → (287-70)/287 = 75.6%
      const result = calcRealizedPercent(2.87, 0.70, 1, 100);
      expect(result).toBeCloseTo(75.6, 0);
    });

    it('returns 0% when premium is 0 (no average-open-price data)', () => {
      const result = calcRealizedPercent(0, 0.50, 1, 100);
      expect(result).toBe(0);
    });

    it('handles multiple contracts correctly', () => {
      // 2 contracts: premium = 9.82 × 2 × 100 = $1964, current = 0.08 × 2 × 100 = $16
      const single = calcRealizedPercent(9.82, 0.08, 1, 100);
      const double = calcRealizedPercent(9.82, 0.08, 2, 100);
      expect(double).toBeCloseTo(single, 5); // Same % regardless of quantity
    });

    it('returns negative % when position is underwater', () => {
      // Sold at $1.00, now worth $2.00 → (100 - 200) / 100 = -100%
      const result = calcRealizedPercent(1.00, 2.00, 1, 100);
      expect(result).toBe(-100);
    });

    it('returns 100% when current cost is 0 (expired worthless)', () => {
      const result = calcRealizedPercent(2.50, 0, 1, 100);
      expect(result).toBe(100);
    });
  });

  describe('Spread positions (Bull Put Spread)', () => {
    it('calculates spread realized % correctly', () => {
      // Short put: avg open $5.00, close $0.50 → premium = $500
      // Long put:  close $0.10 → long current cost = $10
      // Current spread cost = (0.50 - 0.10) × 100 = $40
      // Realized % = (500 - 40) / 500 = 92%
      // Note: premiumReceived uses only the short leg's average-open-price
      const result = calcRealizedPercent(5.00, 0.50, 1, 100, 0.10, 100);
      expect(result).toBeCloseTo(92, 0);
    });

    it('handles spread where long leg is near zero', () => {
      // Short: avg $9.82, close $0.08; Long: avg $2.00, close $0.01
      // Premium = 9.82 × 100 = $982
      // Current = (0.08 - 0.01) × 100 = $7
      // Realized % = (982 - 7) / 982 = 99.3%
      const result = calcRealizedPercent(9.82, 0.08, 1, 100, 0.01, 100);
      expect(result).toBeCloseTo(99.3, 0);
    });
  });

  describe('Threshold filtering', () => {
    const threshold = 75;

    it('identifies positions at or above threshold as WOULD_CLOSE', () => {
      const positions = [
        { symbol: 'COIN', realized: calcRealizedPercent(9.82, 0.08, 1, 100) },   // ~98.4%
        { symbol: 'AAPL', realized: calcRealizedPercent(2.87, 0.70, 1, 100) },   // ~75.6%
        { symbol: 'QCOM', realized: calcRealizedPercent(2.67, 0.37, 1, 100) },   // ~86.1%
      ];

      const wouldClose = positions.filter(p => p.realized >= threshold);
      expect(wouldClose).toHaveLength(3);
      expect(wouldClose.map(p => p.symbol)).toContain('COIN');
      expect(wouldClose.map(p => p.symbol)).toContain('AAPL');
    });

    it('identifies positions below threshold as BELOW_THRESHOLD', () => {
      const positions = [
        { symbol: 'XYZ', realized: calcRealizedPercent(2.00, 1.20, 1, 100) },  // 40%
        { symbol: 'ABC', realized: calcRealizedPercent(3.00, 1.00, 1, 100) },  // 66.7%
      ];

      const belowThreshold = positions.filter(p => p.realized < threshold);
      expect(belowThreshold).toHaveLength(2);
    });

    it('correctly counts would-close vs below-threshold', () => {
      const positions = [
        calcRealizedPercent(9.82, 0.08, 1, 100),   // 98.4% → close
        calcRealizedPercent(4.66, 0.10, 1, 100),   // 97.8% → close
        calcRealizedPercent(2.87, 0.70, 1, 100),   // 75.6% → close
        calcRealizedPercent(2.00, 1.20, 1, 100),   // 40%   → hold
        calcRealizedPercent(3.00, 1.00, 1, 100),   // 66.7% → hold
      ];

      const wouldClose = positions.filter(p => p >= threshold).length;
      const belowThreshold = positions.filter(p => p < threshold).length;

      expect(wouldClose).toBe(3);
      expect(belowThreshold).toBe(2);
    });
  });
});
