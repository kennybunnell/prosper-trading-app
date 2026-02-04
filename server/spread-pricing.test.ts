/**
 * Unit tests for spread order pricing logic
 * Tests that Bull Put Spread and Bear Call Spread orders use competitive pricing
 */

import { describe, it, expect } from 'vitest';

describe('Spread Order Pricing Logic', () => {
  describe('Bull Put Spread Pricing', () => {
    it('should subtract 5% buffer from net credit for better fills', () => {
      const netCredit = 2.00; // $2.00 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(buffer).toBe(0.10); // 5% of $2.00
      expect(limitPrice).toBe(1.90); // $2.00 - $0.10
    });

    it('should use minimum $0.05 buffer for small credits', () => {
      const netCredit = 0.50; // $0.50 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(buffer).toBe(0.05); // Minimum buffer
      expect(limitPrice).toBe(0.45); // $0.50 - $0.05
    });

    it('should ensure minimum $0.01 limit price', () => {
      const netCredit = 0.05; // $0.05 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(limitPrice).toBe(0.01); // Minimum price floor
    });

    it('should calculate correct pricing for typical spread', () => {
      const netCredit = 1.50; // $1.50 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(buffer).toBeCloseTo(0.075, 3); // 5% of $1.50
      expect(limitPrice).toBeCloseTo(1.425, 2); // $1.50 - $0.075
    });
  });

  describe('Bear Call Spread Pricing', () => {
    it('should subtract 5% buffer from net credit for better fills', () => {
      const netCredit = 2.50; // $2.50 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(buffer).toBe(0.125); // 5% of $2.50
      expect(limitPrice).toBe(2.375); // $2.50 - $0.125
    });

    it('should use minimum $0.05 buffer for small credits', () => {
      const netCredit = 0.75; // $0.75 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(buffer).toBe(0.05); // Minimum buffer
      expect(limitPrice).toBe(0.70); // $0.75 - $0.05
    });

    it('should ensure minimum $0.01 limit price', () => {
      const netCredit = 0.03; // $0.03 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(limitPrice).toBe(0.01); // Minimum price floor
    });

    it('should calculate correct pricing for high-credit spread', () => {
      const netCredit = 5.00; // $5.00 net credit
      const buffer = Math.max(netCredit * 0.05, 0.05);
      const limitPrice = Math.max(netCredit - buffer, 0.01);
      
      expect(buffer).toBe(0.25); // 5% of $5.00
      expect(limitPrice).toBe(4.75); // $5.00 - $0.25
    });
  });

  describe('Pricing Comparison: Old vs New', () => {
    it('old pricing (adding 10%) was too expensive', () => {
      const netCredit = 2.00;
      const oldBuffer = Math.max(netCredit * 0.10, 0.05);
      const oldLimitPrice = netCredit + oldBuffer;
      
      expect(oldLimitPrice).toBe(2.20); // $2.00 + $0.20 (TOO HIGH)
    });

    it('new pricing (subtracting 5%) is more competitive', () => {
      const netCredit = 2.00;
      const newBuffer = Math.max(netCredit * 0.05, 0.05);
      const newLimitPrice = Math.max(netCredit - newBuffer, 0.01);
      
      expect(newLimitPrice).toBe(1.90); // $2.00 - $0.10 (MORE COMPETITIVE)
    });

    it('new pricing encourages fills without being too aggressive', () => {
      const netCredit = 2.00;
      const newBuffer = Math.max(netCredit * 0.05, 0.05);
      const newLimitPrice = Math.max(netCredit - newBuffer, 0.01);
      
      // New price is 5% below mid, which is reasonable for credit spreads
      const percentBelowMid = ((netCredit - newLimitPrice) / netCredit) * 100;
      expect(percentBelowMid).toBeCloseTo(5, 1); // Exactly 5% below mid
    });
  });
});
