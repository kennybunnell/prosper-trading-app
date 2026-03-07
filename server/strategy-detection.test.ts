/**
 * Unit tests for the spread detection classifier.
 * Tests both the server-side groupStrategy logic (getPortfolioPositions)
 * and the client-side collapseStrategies helper (heatmap tile).
 */

import { describe, it, expect } from 'vitest';

type LegInput = { isShort: boolean; isPut: boolean };

function detectGroupStrategy(legs: LegInput[]): string {
  const grpShortPuts  = legs.filter(l => l.isShort && l.isPut);
  const grpLongPuts   = legs.filter(l => !l.isShort && l.isPut);
  const grpShortCalls = legs.filter(l => l.isShort && !l.isPut);
  const grpLongCalls  = legs.filter(l => !l.isShort && !l.isPut);

  if (grpShortPuts.length > 0 && grpLongPuts.length > 0 && grpShortCalls.length > 0 && grpLongCalls.length > 0) {
    return 'IC';
  } else if (grpShortPuts.length > 0 && grpLongPuts.length > 0 && grpShortCalls.length === 0) {
    return 'BPS';
  } else if (grpShortCalls.length > 0 && grpLongCalls.length > 0 && grpShortPuts.length === 0) {
    return 'BCS';
  } else if (grpShortCalls.length > 0 && grpLongCalls.length > 0 && grpShortPuts.length > 0 && grpLongPuts.length === 0) {
    return 'PMCC';
  } else if (grpShortCalls.length > 0 && grpShortPuts.length === 0 && grpLongCalls.length === 0) {
    return 'CC';
  } else if (grpShortPuts.length > 0 && grpShortCalls.length === 0 && grpLongPuts.length === 0) {
    return 'CSP';
  } else {
    return '';
  }
}

function collapseStrategies(strategies: string[]): string {
  const s = strategies.map(x => x.toUpperCase());
  const hasShortPut  = s.some(x => x === 'CSP' || x === 'SHORT PUT' || x === 'BPS');
  const hasLongPut   = s.some(x => x === 'LONG PUT' || x === 'BPS');
  const hasShortCall = s.some(x => x === 'CC' || x === 'SHORT CALL' || x === 'BCS');
  const hasLongCall  = s.some(x => x === 'LONG CALL' || x === 'BCS' || x === 'PMCC');
  if (s.includes('IC'))   return 'IC';
  if (s.includes('BPS'))  return 'BPS';
  if (s.includes('BCS'))  return 'BCS';
  if (s.includes('PMCC')) return 'PMCC';
  if (hasShortPut && hasLongPut && hasShortCall && hasLongCall) return 'IC';
  if (hasShortPut && hasLongPut && !hasShortCall)  return 'BPS';
  if (hasShortCall && hasLongCall && !hasShortPut) return 'BCS';
  if (hasShortCall && hasLongCall && hasShortPut)  return 'PMCC';
  if (s.includes('CC') && !hasShortPut)  return 'CC';
  if (s.includes('CSP') && !hasShortCall) return 'CSP';
  return strategies.join('/');
}

describe('detectGroupStrategy (server-side spread detection)', () => {
  it('detects BPS: short put + long put, no calls', () => {
    expect(detectGroupStrategy([
      { isShort: true,  isPut: true  },
      { isShort: false, isPut: true  },
    ])).toBe('BPS');
  });

  it('detects BCS: short call + long call, no puts', () => {
    expect(detectGroupStrategy([
      { isShort: true,  isPut: false },
      { isShort: false, isPut: false },
    ])).toBe('BCS');
  });

  it('detects IC: all four legs', () => {
    expect(detectGroupStrategy([
      { isShort: true,  isPut: true  },
      { isShort: false, isPut: true  },
      { isShort: true,  isPut: false },
      { isShort: false, isPut: false },
    ])).toBe('IC');
  });

  it('detects PMCC: short call + long call + short put (no long put)', () => {
    expect(detectGroupStrategy([
      { isShort: true,  isPut: false },
      { isShort: false, isPut: false },
      { isShort: true,  isPut: true  },
    ])).toBe('PMCC');
  });

  it('detects CC: single short call', () => {
    expect(detectGroupStrategy([{ isShort: true, isPut: false }])).toBe('CC');
  });

  it('detects CSP: single short put', () => {
    expect(detectGroupStrategy([{ isShort: true, isPut: true }])).toBe('CSP');
  });

  it('returns empty string for unrecognized combinations', () => {
    expect(detectGroupStrategy([
      { isShort: false, isPut: true  },
      { isShort: false, isPut: false },
    ])).toBe('');
  });

  it('returns empty string for empty legs array', () => {
    expect(detectGroupStrategy([])).toBe('');
  });
});

describe('collapseStrategies (client-side tile label)', () => {
  it('returns IC when IC is in the list', () => {
    expect(collapseStrategies(['IC'])).toBe('IC');
  });

  it('returns BPS when BPS is in the list', () => {
    expect(collapseStrategies(['BPS'])).toBe('BPS');
  });

  it('returns BCS when BCS is in the list', () => {
    expect(collapseStrategies(['BCS'])).toBe('BCS');
  });

  it('returns PMCC when PMCC is in the list', () => {
    expect(collapseStrategies(['PMCC'])).toBe('PMCC');
  });

  it('derives BPS from CSP + Long Put labels', () => {
    expect(collapseStrategies(['CSP', 'Long Put'])).toBe('BPS');
  });

  it('derives BCS from CC + Long Call labels', () => {
    expect(collapseStrategies(['CC', 'Long Call'])).toBe('BCS');
  });

  it('returns CC for single CC label', () => {
    expect(collapseStrategies(['CC'])).toBe('CC');
  });

  it('returns CSP for single CSP label', () => {
    expect(collapseStrategies(['CSP'])).toBe('CSP');
  });

  it('handles case-insensitive input', () => {
    expect(collapseStrategies(['bps'])).toBe('BPS');
    expect(collapseStrategies(['ic'])).toBe('IC');
  });

  it('falls back to joined string for unknown combinations', () => {
    expect(collapseStrategies(['Long Put', 'Long Call'])).toBe('Long Put/Long Call');
  });
});
