import { describe, it, expect } from 'vitest';

describe('IV Rank Calculation', () => {
  it('should calculate IV Rank correctly from a range of IV values', () => {
    const ivValues = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60];
    const currentIV = 0.45;
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    
    const ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
    
    // 0.45 is 66.67% between 0.15 and 0.60
    // (0.45 - 0.15) / (0.60 - 0.15) = 0.30 / 0.45 = 0.6667 = 67%
    expect(ivRank).toBe(67);
  });

  it('should return 0 for IV at minimum', () => {
    const ivValues = [0.15, 0.20, 0.25, 0.30];
    const currentIV = 0.15;
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    
    const ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
    
    expect(ivRank).toBe(0);
  });

  it('should return 100 for IV at maximum', () => {
    const ivValues = [0.15, 0.20, 0.25, 0.30];
    const currentIV = 0.30;
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    
    const ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
    
    expect(ivRank).toBe(100);
  });

  it('should return 50 for IV at midpoint', () => {
    const ivValues = [0.20, 0.30, 0.40, 0.50, 0.60];
    const currentIV = 0.40;
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    
    const ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
    
    expect(ivRank).toBe(50);
  });

  it('should handle edge case where all IVs are the same', () => {
    const ivValues = [0.30, 0.30, 0.30, 0.30];
    const currentIV = 0.30;
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    
    // When min == max, we can't calculate rank (division by zero)
    // Implementation should check maxIV > minIV before calculating
    const canCalculate = maxIV > minIV;
    
    expect(canCalculate).toBe(false);
  });

  it('should work with realistic option IV values', () => {
    // Typical IV values for options (as decimals, e.g., 0.35 = 35%)
    const ivValues = [
      0.28, 0.32, 0.35, 0.38, 0.42, 0.45, 0.48, 0.51, 0.55, 0.58,
      0.30, 0.33, 0.36, 0.40, 0.43, 0.46, 0.49, 0.52, 0.56, 0.59
    ];
    const currentIV = 0.52; // 52% IV
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    
    const ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
    
    // 0.52 should be in the upper range
    expect(ivRank).toBeGreaterThan(60);
    expect(ivRank).toBeLessThan(90);
  });
});
