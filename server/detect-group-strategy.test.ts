/**
 * Unit tests for the detectGroupStrategy logic used in buildTickers.
 * This mirrors the exact logic in PortfolioCommandCenter.tsx detectGroupStrategy.
 */
import { describe, it, expect } from 'vitest';

// Mirror of the frontend detectGroupStrategy function
function detectGroupStrategy(groupPositions: Array<{ symbol: string; quantity: number; direction: string }>): string {
  const legs = groupPositions.map(pos => {
    const isShort = pos.direction?.toLowerCase() === 'short' || pos.quantity < 0;
    const occMatch = pos.symbol?.match(/([CP])(\d{8})$/);
    const isPut = occMatch ? occMatch[1] === 'P' : false;
    return { isShort, isPut };
  });
  const shortPuts  = legs.filter(l => l.isShort && l.isPut).length;
  const longPuts   = legs.filter(l => !l.isShort && l.isPut).length;
  const shortCalls = legs.filter(l => l.isShort && !l.isPut).length;
  const longCalls  = legs.filter(l => !l.isShort && !l.isPut).length;

  if (shortPuts > 0 && longPuts > 0 && shortCalls > 0 && longCalls > 0) return 'IC';
  if (shortPuts > 0 && longPuts > 0 && shortCalls === 0) return 'BPS';
  if (shortCalls > 0 && longCalls > 0 && shortPuts === 0) return 'BCS';
  if (shortCalls > 0 && longCalls > 0 && shortPuts > 0 && longPuts === 0) return 'PMCC';
  if (shortCalls > 0 && shortPuts === 0 && longCalls === 0) return 'CC';
  if (shortPuts > 0 && shortCalls === 0 && longPuts === 0) return 'CSP';
  if (longCalls > 0 && shortCalls === 0 && shortPuts === 0) return 'Long Call';
  if (longPuts > 0 && shortPuts === 0 && shortCalls === 0) return 'Long Put';
  return 'Mixed';
}

describe('detectGroupStrategy', () => {
  it('detects IC from 4 legs (short put + long put + short call + long call)', () => {
    const legs = [
      { symbol: 'COIN251219P00170000', quantity: -1, direction: 'Short' },
      { symbol: 'COIN251219P00160000', quantity: 1,  direction: 'Long' },
      { symbol: 'COIN251219C00200000', quantity: -1, direction: 'Short' },
      { symbol: 'COIN251219C00210000', quantity: 1,  direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('IC');
  });

  it('detects BPS from short put + long put (no calls)', () => {
    const legs = [
      { symbol: 'AVGO251219P00185000', quantity: -1, direction: 'Short' },
      { symbol: 'AVGO251219P00180000', quantity: 1,  direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('BPS');
  });

  it('detects BCS from short call + long call (no puts)', () => {
    const legs = [
      { symbol: 'MSTR251219C00500000', quantity: -1, direction: 'Short' },
      { symbol: 'MSTR251219C00510000', quantity: 1,  direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('BCS');
  });

  it('detects CC from single short call', () => {
    const legs = [
      { symbol: 'COIN251219C00185000', quantity: -8, direction: 'Short' },
    ];
    expect(detectGroupStrategy(legs)).toBe('CC');
  });

  it('detects CSP from single short put', () => {
    const legs = [
      { symbol: 'NVDA251219P00120000', quantity: -2, direction: 'Short' },
    ];
    expect(detectGroupStrategy(legs)).toBe('CSP');
  });

  it('detects PMCC from short call + long call + short put (no long put)', () => {
    const legs = [
      { symbol: 'AAPL251219C00200000', quantity: -1, direction: 'Short' },
      { symbol: 'AAPL251219C00150000', quantity: 1,  direction: 'Long' },
      { symbol: 'AAPL251219P00170000', quantity: -1, direction: 'Short' },
    ];
    expect(detectGroupStrategy(legs)).toBe('PMCC');
  });

  it('detects Long Call from single long call', () => {
    const legs = [
      { symbol: 'SPY251219C00600000', quantity: 1, direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('Long Call');
  });

  it('detects Long Put from single long put', () => {
    const legs = [
      { symbol: 'QQQ251219P00450000', quantity: 1, direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('Long Put');
  });

  it('handles multiple contracts (qty > 1) correctly for BPS', () => {
    const legs = [
      { symbol: 'TSLA251219P00250000', quantity: -5, direction: 'Short' },
      { symbol: 'TSLA251219P00240000', quantity: 5,  direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('BPS');
  });

  it('handles multiple contracts for IC', () => {
    const legs = [
      { symbol: 'SPY251219P00550000', quantity: -3, direction: 'Short' },
      { symbol: 'SPY251219P00540000', quantity: 3,  direction: 'Long' },
      { symbol: 'SPY251219C00600000', quantity: -3, direction: 'Short' },
      { symbol: 'SPY251219C00610000', quantity: 3,  direction: 'Long' },
    ];
    expect(detectGroupStrategy(legs)).toBe('IC');
  });
});

describe('strategy filter exact-match logic', () => {
  function strategyMatches(strategyStr: string, filter: string): boolean {
    const segments = strategyStr.toUpperCase().split('/').map(s => s.trim());
    return segments.some(seg => seg === filter.toUpperCase());
  }

  it('IC filter matches IC exactly', () => {
    expect(strategyMatches('IC', 'IC')).toBe(true);
  });

  it('IC filter does not match CC', () => {
    expect(strategyMatches('CC', 'IC')).toBe(false);
  });

  it('CC filter does not match PMCC', () => {
    expect(strategyMatches('PMCC', 'CC')).toBe(false);
  });

  it('CC filter matches CC in multi-strategy string', () => {
    expect(strategyMatches('IC/CC', 'CC')).toBe(true);
  });

  it('BPS filter matches BPS exactly', () => {
    expect(strategyMatches('BPS', 'BPS')).toBe(true);
  });

  it('BCS filter matches BCS exactly', () => {
    expect(strategyMatches('BCS', 'BCS')).toBe(true);
  });

  it('CSP filter does not match BPS', () => {
    expect(strategyMatches('BPS', 'CSP')).toBe(false);
  });

  it('PMCC filter matches PMCC exactly', () => {
    expect(strategyMatches('PMCC', 'PMCC')).toBe(true);
  });

  it('IC filter matches IC in multi-strategy string IC/CC', () => {
    expect(strategyMatches('IC/CC', 'IC')).toBe(true);
  });
});
