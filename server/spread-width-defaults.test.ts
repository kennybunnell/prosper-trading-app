/**
 * Tests for spread width default pre-population logic.
 * Verifies that getMinSpreadWidth returns the correct defaults
 * for each index symbol so the UI pre-population is correct.
 */

import { describe, it, expect } from 'vitest';
import { getMinSpreadWidth } from '../shared/orderUtils';

describe('getMinSpreadWidth — index spread width defaults', () => {
  it('SPX → 50pt minimum', () => {
    expect(getMinSpreadWidth('SPX')).toBe(50);
  });

  it('SPXW → 50pt minimum (same as SPX)', () => {
    expect(getMinSpreadWidth('SPXW')).toBe(50);
  });

  it('SPXPM → 50pt minimum', () => {
    expect(getMinSpreadWidth('SPXPM')).toBe(50);
  });

  it('NDX → 25pt minimum', () => {
    expect(getMinSpreadWidth('NDX')).toBe(25);
  });

  it('NDXP → 25pt minimum', () => {
    expect(getMinSpreadWidth('NDXP')).toBe(25);
  });

  it('XND → 25pt minimum', () => {
    expect(getMinSpreadWidth('XND')).toBe(25);
  });

  it('XSP → 5pt minimum (mini-SPX)', () => {
    expect(getMinSpreadWidth('XSP')).toBe(5);
  });

  it('RUT → 5pt minimum', () => {
    expect(getMinSpreadWidth('RUT')).toBe(5);
  });

  it('MRUT → 5pt minimum', () => {
    expect(getMinSpreadWidth('MRUT')).toBe(5);
  });

  it('DJX → 1pt minimum', () => {
    expect(getMinSpreadWidth('DJX')).toBe(1);
  });

  it('equity symbols → 1pt (no meaningful minimum)', () => {
    expect(getMinSpreadWidth('AAPL')).toBe(1);
    expect(getMinSpreadWidth('TSLA')).toBe(1);
    expect(getMinSpreadWidth('SPY')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(getMinSpreadWidth('spx')).toBe(50);
    expect(getMinSpreadWidth('Ndx')).toBe(25);
    expect(getMinSpreadWidth('xsp')).toBe(5);
  });

  it('pre-population logic: SPX should get 50pt if not in symbolWidths', () => {
    // Simulate the useEffect logic
    const watchlist = [
      { symbol: 'SPX', isIndex: true },
      { symbol: 'XSP', isIndex: true },
      { symbol: 'NDX', isIndex: true },
    ];
    const symbolWidths: Record<string, number> = {};

    // Run the pre-population logic
    const updated = { ...symbolWidths };
    let changed = false;
    for (const w of watchlist) {
      if (w.isIndex && updated[w.symbol] === undefined) {
        updated[w.symbol] = getMinSpreadWidth(w.symbol);
        changed = true;
      }
    }

    expect(changed).toBe(true);
    expect(updated['SPX']).toBe(50);
    expect(updated['XSP']).toBe(5);
    expect(updated['NDX']).toBe(25);
  });

  it('pre-population logic: does not overwrite explicit user override', () => {
    const watchlist = [{ symbol: 'SPX', isIndex: true }];
    const symbolWidths: Record<string, number> = { SPX: 100 }; // user explicitly set 100pt

    const updated = { ...symbolWidths };
    let changed = false;
    for (const w of watchlist) {
      if (w.isIndex && updated[w.symbol] === undefined) {
        updated[w.symbol] = getMinSpreadWidth(w.symbol);
        changed = true;
      }
    }

    expect(changed).toBe(false); // no change since SPX already has override
    expect(updated['SPX']).toBe(100); // preserved
  });
});
