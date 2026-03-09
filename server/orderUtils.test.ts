/**
 * Tests for formatPriceForSubmission — Tastytrade tick-size rules:
 *   - Price < $3.00  → $0.01 increments (penny pilot)
 *   - Price >= $3.00 → $0.05 increments (nickel)
 */
import { describe, it, expect } from 'vitest';
import { formatPriceForSubmission, validateOrderPrice } from '../shared/orderUtils';

describe('formatPriceForSubmission', () => {
  // Nickel increment zone (>= $3.00)
  it('rounds $3.83 to $3.85 (nearest nickel)', () => {
    expect(formatPriceForSubmission(3.83)).toBe('3.85');
  });

  it('rounds $3.84 to $3.85 (nearest nickel)', () => {
    expect(formatPriceForSubmission(3.84)).toBe('3.85');
  });

  it('rounds $3.82 to $3.80 (nearest nickel)', () => {
    expect(formatPriceForSubmission(3.82)).toBe('3.80');
  });

  it('leaves $3.85 unchanged (already valid nickel)', () => {
    expect(formatPriceForSubmission(3.85)).toBe('3.85');
  });

  it('rounds $10.13 to $10.15 (nearest nickel)', () => {
    expect(formatPriceForSubmission(10.13)).toBe('10.15');
  });

  it('rounds $10.12 to $10.10 (nearest nickel)', () => {
    expect(formatPriceForSubmission(10.12)).toBe('10.10');
  });

  // Penny increment zone (< $3.00)
  it('leaves $0.06 unchanged (already valid penny)', () => {
    expect(formatPriceForSubmission(0.06)).toBe('0.06');
  });

  it('leaves $2.47 unchanged (already valid penny)', () => {
    expect(formatPriceForSubmission(2.47)).toBe('2.47');
  });

  it('rounds $2.999 to $3.00 (boundary — nickel zone)', () => {
    // $2.999 rounds to $3.00 which is in the nickel zone
    expect(formatPriceForSubmission(2.999)).toBe('3.00');
  });

  it('enforces minimum price of $0.01', () => {
    expect(formatPriceForSubmission(0)).toBe('0.01');
    expect(formatPriceForSubmission(-1)).toBe('0.01');
  });

  // Floating-point safety
  it('handles floating-point imprecision (3.8499999)', () => {
    expect(formatPriceForSubmission(3.8499999)).toBe('3.85');
  });
});

describe('validateOrderPrice — tick-size validation', () => {
  it('accepts $3.85 as valid (nickel zone)', () => {
    const result = validateOrderPrice(3.85, 3.75, 3.90, 'BTC');
    expect(result.isValid).toBe(true);
  });

  it('rejects $3.83 as invalid (not a nickel)', () => {
    const result = validateOrderPrice(3.83, 3.75, 3.90, 'BTC');
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('$0.05');
  });

  it('accepts $0.06 as valid (penny zone)', () => {
    const result = validateOrderPrice(0.06, 0.05, 0.07, 'BTC');
    expect(result.isValid).toBe(true);
  });

  it('rejects $0.063 as invalid (not a penny)', () => {
    const result = validateOrderPrice(0.063, 0.05, 0.07, 'BTC');
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('$0.01');
  });
});
