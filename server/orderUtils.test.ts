/**
 * Tests for shared/orderUtils.ts
 *
 * Critical focus: snapToTick() must eliminate floating-point precision errors
 * that cause Tastytrade to reject orders with "Price must be in increments of $0.05"
 *
 * Root cause: JavaScript stores 3.15 as 3.14999999999999982...
 * Old code: Math.round(3.15 * 20) / 20 = Math.round(62.999...) / 20 = 62/20 = 3.10 ← WRONG
 * New code: Math.round(3.15 * 100) = 315 (exact integer), 315/5*5 = 315, 315/100 = 3.15 ← CORRECT
 */
import { describe, it, expect } from 'vitest';
import {
  snapToTick,
  getTickSize,
  formatPriceForSubmission,
  validateOrderPrice,
  roundToNickel,
  roundToPenny,
} from '../shared/orderUtils';

describe('getTickSize', () => {
  it('returns $0.05 for prices >= $3.00', () => {
    expect(getTickSize(3.00)).toBe(0.05);
    expect(getTickSize(3.15)).toBe(0.05);
    expect(getTickSize(5.00)).toBe(0.05);
    expect(getTickSize(10.00)).toBe(0.05);
  });

  it('returns $0.01 for prices < $3.00', () => {
    expect(getTickSize(2.99)).toBe(0.01);
    expect(getTickSize(1.00)).toBe(0.01);
    expect(getTickSize(0.05)).toBe(0.01);
    expect(getTickSize(0.01)).toBe(0.01);
  });

  it('returns $0.01 for SPY regardless of price (penny pilot)', () => {
    expect(getTickSize(5.00, 'SPY')).toBe(0.01);
    expect(getTickSize(10.00, 'SPY')).toBe(0.01);
    expect(getTickSize(3.15, 'SPY')).toBe(0.01);
  });

  it('returns $0.01 for QQQ regardless of price', () => {
    expect(getTickSize(5.00, 'QQQ')).toBe(0.01);
    expect(getTickSize(3.50, 'QQQ')).toBe(0.01);
  });

  it('returns $0.01 for IWM regardless of price', () => {
    expect(getTickSize(4.00, 'IWM')).toBe(0.01);
  });
});

describe('snapToTick — floating-point safety (the core fix)', () => {
  // These are the exact values that caused the MSFT "invalid_price_increment" rejection
  it('correctly snaps $3.15 (the MSFT rejection case)', () => {
    const result = snapToTick(3.15);
    expect(result).toBe(3.15);
    expect(result.toFixed(2)).toBe('3.15');
  });

  it('correctly snaps $3.85', () => {
    const result = snapToTick(3.85);
    expect(result).toBe(3.85);
    expect(result.toFixed(2)).toBe('3.85');
  });

  it('correctly snaps $3.65', () => {
    const result = snapToTick(3.65);
    expect(result).toBe(3.65);
    expect(result.toFixed(2)).toBe('3.65');
  });

  it('correctly snaps $4.15', () => {
    const result = snapToTick(4.15);
    expect(result).toBe(4.15);
    expect(result.toFixed(2)).toBe('4.15');
  });

  it('correctly snaps $5.35', () => {
    const result = snapToTick(5.35);
    expect(result).toBe(5.35);
    expect(result.toFixed(2)).toBe('5.35');
  });

  it('rounds to nearest nickel for prices >= $3', () => {
    expect(snapToTick(3.12)).toBe(3.10);
    expect(snapToTick(3.13)).toBe(3.15);
    expect(snapToTick(3.17)).toBe(3.15);
    expect(snapToTick(3.18)).toBe(3.20);
    expect(snapToTick(3.83)).toBe(3.85);
    expect(snapToTick(3.82)).toBe(3.80);
  });

  it('rounds to nearest penny for prices < $3', () => {
    expect(snapToTick(0.476)).toBe(0.48);
    expect(snapToTick(0.474)).toBe(0.47);
    expect(snapToTick(1.234)).toBe(1.23);
    expect(snapToTick(2.47)).toBe(2.47);
  });

  it('enforces minimum $0.01', () => {
    expect(snapToTick(0)).toBe(0.01);
    expect(snapToTick(-1)).toBe(0.01);
  });

  it('handles penny-pilot symbols above $3 with penny increments', () => {
    expect(snapToTick(5.12, 'SPY')).toBe(5.12);
    expect(snapToTick(5.127, 'SPY')).toBe(5.13);
    expect(snapToTick(3.15, 'QQQ')).toBe(3.15);
    expect(snapToTick(4.99, 'IWM')).toBe(4.99);
  });

  it('handles floating-point noise (3.8499999)', () => {
    expect(snapToTick(3.8499999)).toBe(3.85);
    expect(snapToTick(3.1499999)).toBe(3.15);
  });
});

describe('formatPriceForSubmission', () => {
  it('returns a string with 2 decimal places', () => {
    expect(formatPriceForSubmission(3.15)).toBe('3.15');
    expect(formatPriceForSubmission(0.05)).toBe('0.05');
    expect(formatPriceForSubmission(1.00)).toBe('1.00');
  });

  it('snaps to correct tick before formatting', () => {
    expect(formatPriceForSubmission(3.12)).toBe('3.10');
    expect(formatPriceForSubmission(0.476)).toBe('0.48');
    expect(formatPriceForSubmission(3.83)).toBe('3.85');
    expect(formatPriceForSubmission(3.84)).toBe('3.85');
    expect(formatPriceForSubmission(3.82)).toBe('3.80');
  });

  it('enforces minimum price of $0.01', () => {
    expect(formatPriceForSubmission(0)).toBe('0.01');
    expect(formatPriceForSubmission(-1)).toBe('0.01');
  });

  it('passes symbol for penny-pilot exceptions', () => {
    expect(formatPriceForSubmission(5.12, 'SPY')).toBe('5.12');
    expect(formatPriceForSubmission(5.127, 'SPY')).toBe('5.13');
  });
});

describe('validateOrderPrice — tick-size validation', () => {
  it('accepts $3.85 as valid (nickel zone)', () => {
    const result = validateOrderPrice(3.85, 3.75, 3.90, 'MSFT');
    expect(result.isValid).toBe(true);
  });

  it('accepts $3.15 as valid (nickel zone)', () => {
    const result = validateOrderPrice(3.15, 3.05, 3.25, 'MSFT');
    expect(result.isValid).toBe(true);
  });

  it('rejects $3.83 as invalid (not a nickel)', () => {
    const result = validateOrderPrice(3.83, 3.75, 3.90, 'MSFT');
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('$0.05');
  });

  it('accepts $0.06 as valid (penny zone)', () => {
    const result = validateOrderPrice(0.06, 0.05, 0.07);
    expect(result.isValid).toBe(true);
  });

  it('rejects $0.063 as invalid (not a penny)', () => {
    const result = validateOrderPrice(0.063, 0.05, 0.07);
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('$0.01');
  });
});

describe('roundToNickel — legacy helper (now uses integer arithmetic)', () => {
  it('correctly rounds $3.15 (old FP bug was here)', () => {
    expect(roundToNickel(3.15)).toBe(3.15);
    expect(roundToNickel(3.85)).toBe(3.85);
    expect(roundToNickel(3.65)).toBe(3.65);
  });

  it('rounds to nearest nickel', () => {
    expect(roundToNickel(3.12)).toBe(3.10);
    expect(roundToNickel(3.13)).toBe(3.15);
  });
});

describe('roundToPenny', () => {
  it('rounds to nearest cent', () => {
    expect(roundToPenny(1.234)).toBe(1.23);
    expect(roundToPenny(1.235)).toBe(1.24);
    expect(roundToPenny(0.476)).toBe(0.48);
  });
});
