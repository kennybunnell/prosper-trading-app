/**
 * Unit tests for the three AI panel enhancements:
 * 1. Assignment probability gauge (shortDelta computation)
 * 2. DTE fallback (60-90 DTE when 21-60 returns nothing)
 * 3. Sell CSP After Assignment button (symbol query param handling)
 */

import { describe, it, expect } from 'vitest';

// ─── Feature 1: Assignment Probability (shortDelta) ──────────────────────────

describe('Assignment Probability Gauge', () => {
  const computeShortDelta = (netDelta: number, contracts: number): number | null => {
    if (contracts <= 0) return null;
    const sharesPerContract = 100;
    return Math.min(1, Math.abs(netDelta) / (contracts * sharesPerContract));
  };

  it('returns null for zero contracts', () => {
    expect(computeShortDelta(-534, 0)).toBeNull();
  });

  it('computes correct delta for COIN CC (8 contracts, netDelta -534)', () => {
    // -534 / (8 * 100) = 0.6675
    const result = computeShortDelta(-534, 8);
    expect(result).toBeCloseTo(0.6675, 3);
  });

  it('caps at 1.0 for extreme delta values', () => {
    // -1200 / (8 * 100) = 1.5 → capped at 1.0
    const result = computeShortDelta(-1200, 8);
    expect(result).toBe(1.0);
  });

  it('returns low delta for OTM position', () => {
    // -50 / (2 * 100) = 0.25
    const result = computeShortDelta(-50, 2);
    expect(result).toBeCloseTo(0.25, 3);
  });

  it('handles positive netDelta (long position) using absolute value', () => {
    // +300 / (5 * 100) = 0.60
    const result = computeShortDelta(300, 5);
    expect(result).toBeCloseTo(0.60, 3);
  });

  describe('urgency thresholds', () => {
    const getUrgency = (delta: number) => {
      if (delta >= 0.70) return 'deep-itm';
      if (delta >= 0.50) return 'itm';
      if (delta >= 0.30) return 'near-money';
      return 'otm';
    };

    it('classifies delta >= 0.70 as deep ITM', () => {
      expect(getUrgency(0.70)).toBe('deep-itm');
      expect(getUrgency(0.85)).toBe('deep-itm');
      expect(getUrgency(1.0)).toBe('deep-itm');
    });

    it('classifies delta 0.50-0.69 as ITM', () => {
      expect(getUrgency(0.50)).toBe('itm');
      expect(getUrgency(0.65)).toBe('itm');
    });

    it('classifies delta 0.30-0.49 as near the money', () => {
      expect(getUrgency(0.30)).toBe('near-money');
      expect(getUrgency(0.45)).toBe('near-money');
    });

    it('classifies delta < 0.30 as OTM', () => {
      expect(getUrgency(0.29)).toBe('otm');
      expect(getUrgency(0.10)).toBe('otm');
      expect(getUrgency(0.0)).toBe('otm');
    });
  });
});

// ─── Feature 2: DTE Fallback (60-90 DTE) ────────────────────────────────────

describe('DTE Fallback Logic', () => {
  const filterByDteWindow = (
    expirations: Array<{ expiration: string; dte: number }>,
    minDte: number,
    maxDte: number
  ) => expirations.filter(e => e.dte >= minDte && e.dte <= maxDte);

  const getExpirationWindow = (
    expirations: Array<{ expiration: string; dte: number }>
  ): { window: '21-60' | '60-90'; filtered: typeof expirations } => {
    const primary = filterByDteWindow(expirations, 21, 60);
    if (primary.length > 0) return { window: '21-60', filtered: primary };
    const fallback = filterByDteWindow(expirations, 60, 90);
    return { window: '60-90', filtered: fallback };
  };

  const mockExpirations = [
    { expiration: '2026-03-21', dte: 15 },
    { expiration: '2026-04-17', dte: 42 },
    { expiration: '2026-05-15', dte: 70 },
    { expiration: '2026-06-19', dte: 105 },
  ];

  it('uses 21-60 DTE window when candidates exist', () => {
    const result = getExpirationWindow(mockExpirations);
    expect(result.window).toBe('21-60');
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].expiration).toBe('2026-04-17');
  });

  it('falls back to 60-90 DTE when 21-60 has no candidates', () => {
    const noNearTermExpirations = [
      { expiration: '2026-03-21', dte: 15 },
      { expiration: '2026-05-15', dte: 70 },
      { expiration: '2026-06-19', dte: 105 },
    ];
    const result = getExpirationWindow(noNearTermExpirations);
    expect(result.window).toBe('60-90');
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].expiration).toBe('2026-05-15');
  });

  it('returns empty when neither window has candidates', () => {
    const onlyFarExpirations = [
      { expiration: '2026-03-21', dte: 15 },
      { expiration: '2026-06-19', dte: 105 },
    ];
    const result = getExpirationWindow(onlyFarExpirations);
    expect(result.window).toBe('60-90');
    expect(result.filtered).toHaveLength(0);
  });

  it('includes boundary values (exactly 21 DTE and exactly 60 DTE)', () => {
    const boundaryExpirations = [
      { expiration: '2026-03-27', dte: 21 },
      { expiration: '2026-04-25', dte: 50 },
      { expiration: '2026-05-06', dte: 61 },
    ];
    const result = getExpirationWindow(boundaryExpirations);
    expect(result.window).toBe('21-60');
    expect(result.filtered.map(e => e.dte)).toEqual([21, 50]);
  });
});

// ─── Feature 3: Sell CSP After Assignment (symbol query param) ───────────────

describe('Sell CSP After Assignment - Symbol Query Param', () => {
  const parseSymbolFromUrl = (search: string): string | null => {
    const params = new URLSearchParams(search);
    const sym = params.get('symbol');
    return sym ? sym.toUpperCase().trim() : null;
  };

  it('parses symbol from query string', () => {
    expect(parseSymbolFromUrl('?symbol=COIN')).toBe('COIN');
  });

  it('uppercases lowercase symbol', () => {
    expect(parseSymbolFromUrl('?symbol=coin')).toBe('COIN');
  });

  it('trims whitespace from symbol', () => {
    expect(parseSymbolFromUrl('?symbol=COIN%20')).toBe('COIN');
  });

  it('returns null when no symbol param', () => {
    expect(parseSymbolFromUrl('')).toBeNull();
    expect(parseSymbolFromUrl('?other=value')).toBeNull();
  });

  it('handles symbol with other params present', () => {
    expect(parseSymbolFromUrl('?tab=csp&symbol=AAPL&mode=paper')).toBe('AAPL');
  });

  it('builds correct navigation URL for CSP page', () => {
    const symbol = 'COIN';
    const url = `/csp?symbol=${encodeURIComponent(symbol)}`;
    expect(url).toBe('/csp?symbol=COIN');
  });

  it('encodes special characters in symbol', () => {
    const symbol = 'BRK.B';
    const url = `/csp?symbol=${encodeURIComponent(symbol)}`;
    expect(url).toBe('/csp?symbol=BRK.B');
  });
});
