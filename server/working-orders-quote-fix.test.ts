/**
 * Tests for Working Orders fixes:
 * 1. Quote URL encoding: spaces must be %20, not + (URLSearchParams bug)
 * 2. Override price logic: confirmReplace uses overridePrices when set
 */

import { describe, it, expect } from 'vitest';

// ─── Test 1: URL encoding for OCC symbols ───────────────────────────────────
describe('OCC symbol URL encoding', () => {
  /**
   * Reproduces the encoding logic from getOptionQuotesBatch in tastytrade.ts
   * Verifies that spaces are encoded as %20, not +
   */
  function buildQueryString(symbols: string[], indexUnderlyings: Set<string>): string {
    const getUnderlying = (sym: string): string => {
      const clean = sym.replace(/\s/g, '');
      const m = clean.match(/^([A-Z]+)/);
      return m ? m[1] : '';
    };
    const queryParts: string[] = [];
    symbols.forEach(symbol => {
      const underlying = getUnderlying(symbol);
      const paramType = indexUnderlyings.has(underlying) ? 'index-option' : 'equity-option';
      queryParts.push(`${paramType}=${encodeURIComponent(symbol)}`);
    });
    return queryParts.join('&');
  }

  const INDEX_UNDERLYINGS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'MRUT', 'XSP', 'VIX', 'DJX', 'XND']);

  it('encodes XSP symbol spaces as %20, not +', () => {
    const qs = buildQueryString(['XSP   260417P00660000'], INDEX_UNDERLYINGS);
    expect(qs).toContain('%20');
    expect(qs).not.toContain('+');
    expect(qs).toContain('index-option=');
  });

  it('encodes SPX symbol spaces as %20', () => {
    const qs = buildQueryString(['SPX   260417P06600000'], INDEX_UNDERLYINGS);
    expect(qs).toContain('%20');
    expect(qs).not.toContain('+');
  });

  it('encodes SPXW (2-space pad) symbol correctly', () => {
    const qs = buildQueryString(['SPXW  260417P06700000'], INDEX_UNDERLYINGS);
    expect(qs).toContain('%20');
    expect(qs).not.toContain('+');
    expect(qs).toContain('index-option=');
  });

  it('encodes equity option symbols as equity-option type', () => {
    const qs = buildQueryString(['AAPL  260220C00150000'], INDEX_UNDERLYINGS);
    expect(qs).toContain('equity-option=');
    expect(qs).not.toContain('index-option=');
    expect(qs).toContain('%20');
  });

  it('handles multiple symbols in one query string', () => {
    const symbols = ['XSP   260417P00660000', 'SPX   260417P06600000', 'SPXW  260417P06700000'];
    const qs = buildQueryString(symbols, INDEX_UNDERLYINGS);
    expect(qs.split('&')).toHaveLength(3);
    expect(qs).not.toContain('+');
  });

  it('URLSearchParams.toString() would produce + (confirming the old bug)', () => {
    // This test documents WHY the fix was needed
    const params = new URLSearchParams();
    params.append('index-option', 'XSP   260417P00660000');
    const bugged = params.toString();
    // Old behavior: spaces become +
    expect(bugged).toContain('+');
    expect(bugged).not.toContain('%20');
  });
});

// ─── Test 2: Override price logic ────────────────────────────────────────────
describe('confirmReplace override price logic', () => {
  /**
   * Simulates the price resolution logic from confirmReplace in Performance.tsx
   */
  function resolvePrice(order: { suggestedPrice: number }, idx: number, overridePrices: Record<number, number>): number {
    return overridePrices[idx] !== undefined ? overridePrices[idx] : order.suggestedPrice;
  }

  it('uses suggestedPrice when no override is set', () => {
    const order = { suggestedPrice: 3.05 };
    expect(resolvePrice(order, 0, {})).toBe(3.05);
  });

  it('uses override price when set', () => {
    const order = { suggestedPrice: 3.05 };
    const overrides = { 0: 2.80 };
    expect(resolvePrice(order, 0, overrides)).toBe(2.80);
  });

  it('uses override price of 0 when explicitly set to 0', () => {
    const order = { suggestedPrice: 3.05 };
    const overrides = { 0: 0 };
    // 0 is a valid override (e.g., closing for free)
    expect(resolvePrice(order, 0, overrides)).toBe(0);
  });

  it('uses correct override for each row independently', () => {
    const orders = [
      { suggestedPrice: 3.05 },
      { suggestedPrice: 5.20 },
      { suggestedPrice: 1.10 },
    ];
    const overrides = { 1: 4.75 }; // Only row 1 overridden
    expect(resolvePrice(orders[0], 0, overrides)).toBe(3.05); // unchanged
    expect(resolvePrice(orders[1], 1, overrides)).toBe(4.75); // overridden
    expect(resolvePrice(orders[2], 2, overrides)).toBe(1.10); // unchanged
  });

  it('total cost reflects override prices', () => {
    const orders = [
      { suggestedPrice: 3.05, quantity: 1 },
      { suggestedPrice: 5.20, quantity: 2 },
    ];
    const overrides = { 0: 2.80 };
    const total = orders.reduce((sum, o, i) => {
      const price = overrides[i] !== undefined ? overrides[i] : o.suggestedPrice;
      return sum + price * o.quantity * 100;
    }, 0);
    // Row 0: 2.80 × 1 × 100 = 280
    // Row 1: 5.20 × 2 × 100 = 1040
    expect(total).toBeCloseTo(1320, 2);
  });
});
