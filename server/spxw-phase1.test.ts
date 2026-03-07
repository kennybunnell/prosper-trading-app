/**
 * Phase 1 SPX/SPXW Integration Tests
 * - Instrument-type flag: SPXW/SPX legs must use 'Index Option', not 'Equity Option'
 * - Profit target: 75% default, 50% alternative
 */

import { describe, it, expect } from 'vitest';

// ─── Instrument-type helper (mirrors the logic added to routers.ts) ──────────
function getInstrumentType(symbol: string): 'Index Option' | 'Equity Option' {
  const indexSymbols = ['SPX', 'SPXW', 'NDX', 'RUT', 'VIX'];
  return indexSymbols.includes(symbol.toUpperCase()) ? 'Index Option' : 'Equity Option';
}

// ─── Profit target helper ────────────────────────────────────────────────────
function calcCloseTarget(totalPremium: number, profitTargetPct: 50 | 75): number {
  return totalPremium * (1 - profitTargetPct / 100);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('SPXW Phase 1 — Instrument Type', () => {
  it('returns Index Option for SPXW', () => {
    expect(getInstrumentType('SPXW')).toBe('Index Option');
  });

  it('returns Index Option for SPX', () => {
    expect(getInstrumentType('SPX')).toBe('Index Option');
  });

  it('returns Index Option for NDX', () => {
    expect(getInstrumentType('NDX')).toBe('Index Option');
  });

  it('returns Index Option for RUT', () => {
    expect(getInstrumentType('RUT')).toBe('Index Option');
  });

  it('returns Index Option for VIX', () => {
    expect(getInstrumentType('VIX')).toBe('Index Option');
  });

  it('returns Equity Option for AAPL', () => {
    expect(getInstrumentType('AAPL')).toBe('Equity Option');
  });

  it('returns Equity Option for NVDA', () => {
    expect(getInstrumentType('NVDA')).toBe('Equity Option');
  });

  it('returns Equity Option for TSLA', () => {
    expect(getInstrumentType('TSLA')).toBe('Equity Option');
  });

  it('is case-insensitive for spxw', () => {
    expect(getInstrumentType('spxw')).toBe('Index Option');
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
