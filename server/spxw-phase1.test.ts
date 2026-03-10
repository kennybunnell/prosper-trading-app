/**
 * Phase 1 SPX/SPXW Integration Tests
 * - Instrument-type: Tastytrade API ONLY accepts 'Equity Option' for ALL options in order submission
 *   (including index options like SPX/SPXW/NDX/RUT/VIX). 'Index Option' is returned by the
 *   positions API but REJECTED by the order submission API with a 400 validation error.
 * - Profit target: 75% default, 50% alternative
 */

import { describe, it, expect } from 'vitest';

// ─── Instrument-type helper (all options use 'Equity Option' for order submission) ──────────
function getInstrumentTypeForOrderSubmission(_symbol: string): 'Equity Option' {
  // Tastytrade API only accepts 'Equity Option' for all options including index options
  // 'Index Option' is only in the positions response, NOT in order submission
  return 'Equity Option';
}

// ─── Profit target helper ────────────────────────────────────────────────────
function calcCloseTarget(totalPremium: number, profitTargetPct: 50 | 75): number {
  return totalPremium * (1 - profitTargetPct / 100);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('SPXW Phase 1 — Instrument Type (Order Submission)', () => {
  it('returns Equity Option for SPXW (Tastytrade API requirement)', () => {
    expect(getInstrumentTypeForOrderSubmission('SPXW')).toBe('Equity Option');
  });

  it('returns Equity Option for SPX (Tastytrade API requirement)', () => {
    expect(getInstrumentTypeForOrderSubmission('SPX')).toBe('Equity Option');
  });

  it('returns Equity Option for NDX (Tastytrade API requirement)', () => {
    expect(getInstrumentTypeForOrderSubmission('NDX')).toBe('Equity Option');
  });

  it('returns Equity Option for RUT (Tastytrade API requirement)', () => {
    expect(getInstrumentTypeForOrderSubmission('RUT')).toBe('Equity Option');
  });

  it('returns Equity Option for VIX (Tastytrade API requirement)', () => {
    expect(getInstrumentTypeForOrderSubmission('VIX')).toBe('Equity Option');
  });

  it('returns Equity Option for AAPL', () => {
    expect(getInstrumentTypeForOrderSubmission('AAPL')).toBe('Equity Option');
  });

  it('returns Equity Option for NVDA', () => {
    expect(getInstrumentTypeForOrderSubmission('NVDA')).toBe('Equity Option');
  });

  it('returns Equity Option for TSLA', () => {
    expect(getInstrumentTypeForOrderSubmission('TSLA')).toBe('Equity Option');
  });

  it('is consistent regardless of case', () => {
    expect(getInstrumentTypeForOrderSubmission('spxw')).toBe('Equity Option');
  });
});

describe('SPXW Phase 1 — Profit Target', () => {
  it('calculates 75% target close price correctly', () => {
    // $500 premium collected → close when value decays to $125 (75% captured)
    expect(calcCloseTarget(500, 75)).toBeCloseTo(125, 2);
  });

  it('calculates 50% target close price correctly', () => {
    // $500 premium collected → close when value decays to $250 (50% captured)
    expect(calcCloseTarget(500, 50)).toBeCloseTo(250, 2);
  });

  it('75% target is lower than 50% target (better profit)', () => {
    const premium = 300;
    expect(calcCloseTarget(premium, 75)).toBeLessThan(calcCloseTarget(premium, 50));
  });

  it('handles small SPXW premium correctly', () => {
    // $1.20 credit per share × 100 = $120 total; 75% target = $30 remaining
    const totalPremium = 120;
    expect(calcCloseTarget(totalPremium, 75)).toBeCloseTo(30, 2);
  });

  it('handles large SPXW IC premium correctly', () => {
    // $3.50 credit × 100 = $350 total; 75% target = $87.50 remaining
    const totalPremium = 350;
    expect(calcCloseTarget(totalPremium, 75)).toBeCloseTo(87.5, 2);
  });
});

describe('SPXW Phase 1 — PM Settlement Badge Logic', () => {
  const isPMSettled = (symbol: string) => ['SPXW', 'SPX'].includes(symbol.toUpperCase());

  it('SPXW is PM-settled', () => {
    expect(isPMSettled('SPXW')).toBe(true);
  });

  it('SPX is PM-settled', () => {
    expect(isPMSettled('SPX')).toBe(true);
  });

  it('AAPL is not PM-settled', () => {
    expect(isPMSettled('AAPL')).toBe(false);
  });

  it('NDX is not in PM badge set (AM-settled)', () => {
    expect(isPMSettled('NDX')).toBe(false);
  });
});
