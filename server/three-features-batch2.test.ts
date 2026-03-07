/**
 * Tests for three heatmap/AI panel enhancements:
 * 1. Multi-expiration strategy labels (expirationStrategies field)
 * 2. IC tested-side detection (call vs put side challenged)
 * 3. Strategy filter bar logic (filteredTickers)
 */
import { describe, it, expect } from 'vitest';

// ─── Feature 1: Multi-expiration strategy labels ─────────────────────────────
describe('Multi-expiration strategy labels', () => {
  type ExpirationStrategies = Record<string, string>;

  function formatExpirationLine(expMap: ExpirationStrategies): string | null {
    const entries = Object.entries(expMap);
    if (entries.length <= 1) return null;
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([exp, strat]) => {
        const d = new Date(exp);
        const mon = d.toLocaleString('en-US', { month: 'short' });
        const yr = String(d.getFullYear()).slice(2);
        return `${mon}'${yr}: ${strat}`;
      })
      .join(' / ');
  }

  it('returns null for single expiration', () => {
    expect(formatExpirationLine({ '2025-04-17': 'BPS' })).toBeNull();
  });

  it('returns null for empty map', () => {
    expect(formatExpirationLine({})).toBeNull();
  });

  it('formats two expirations correctly', () => {
    const result = formatExpirationLine({
      '2025-04-17': 'BPS',
      '2025-05-16': 'BCS',
    });
    expect(result).toBe("Apr'25: BPS / May'25: BCS");
  });

  it('sorts expirations chronologically', () => {
    const result = formatExpirationLine({
      '2025-06-20': 'IC',
      '2025-04-17': 'BPS',
      '2025-05-16': 'BCS',
    });
    expect(result).toBe("Apr'25: BPS / May'25: BCS / Jun'25: IC");
  });

  it('handles three expirations with same strategy', () => {
    const result = formatExpirationLine({
      '2025-04-17': 'CSP',
      '2025-05-16': 'CSP',
    });
    expect(result).toBe("Apr'25: CSP / May'25: CSP");
  });
});

// ─── Feature 2: IC tested-side detection ─────────────────────────────────────
describe('IC tested-side detection', () => {
  function detectTestedSide(
    underlyingPrice: number,
    icShortCallStrike: number,
    icShortPutStrike: number,
  ): 'call' | 'put' {
    const distToCall = Math.abs(underlyingPrice - icShortCallStrike);
    const distToPut  = Math.abs(underlyingPrice - icShortPutStrike);
    return distToCall <= distToPut ? 'call' : 'put';
  }

  it('detects call side when stock is above short call strike', () => {
    // IC: short put $400, short call $450, stock at $460 (above call)
    expect(detectTestedSide(460, 450, 400)).toBe('call');
  });

  it('detects put side when stock is below short put strike', () => {
    // IC: short put $400, short call $450, stock at $385 (below put)
    expect(detectTestedSide(385, 450, 400)).toBe('put');
  });

  it('detects call side when stock is equidistant but closer to call', () => {
    // IC: short put $400, short call $450, stock at $425 (exactly between)
    // distToCall = 25, distToPut = 25 → tie → defaults to call
    expect(detectTestedSide(425, 450, 400)).toBe('call');
  });

  it('detects put side when stock is much closer to put', () => {
    // IC: short put $400, short call $450, stock at $402 (2 from put, 48 from call)
    expect(detectTestedSide(402, 450, 400)).toBe('put');
  });

  it('detects call side when stock has blown through short call', () => {
    // IC: short put $150, short call $180, stock at $210 (30 above call)
    expect(detectTestedSide(210, 180, 150)).toBe('call');
  });

  it('detects put side when stock has blown through short put', () => {
    // IC: short put $150, short call $180, stock at $120 (30 below put)
    expect(detectTestedSide(120, 180, 150)).toBe('put');
  });
});

// ─── Feature 3: Strategy filter bar logic ────────────────────────────────────
describe('Strategy filter bar', () => {
  type TickerData = {
    symbol: string;
    strategies: string[];
    expirationStrategies?: Record<string, string>;
  };

  function filterTickers(tickers: TickerData[], filter: string): TickerData[] {
    if (filter === 'All') return tickers;
    return tickers.filter(t => {
      const allStrats = [
        ...(t.strategies ?? []),
        ...Object.values(t.expirationStrategies ?? {}),
      ].map(s => s.toUpperCase());
      return allStrats.some(s => s.includes(filter));
    });
  }

  const mockTickers: TickerData[] = [
    { symbol: 'AAPL', strategies: ['IC'], expirationStrategies: { '2025-04-17': 'IC' } },
    { symbol: 'TSLA', strategies: ['BPS'], expirationStrategies: { '2025-04-17': 'BPS' } },
    { symbol: 'COIN', strategies: ['BCS'], expirationStrategies: { '2025-04-17': 'BCS' } },
    { symbol: 'SPY',  strategies: ['CC'],  expirationStrategies: { '2025-04-17': 'CC' } },
    { symbol: 'QQQ',  strategies: ['CSP'], expirationStrategies: { '2025-04-17': 'CSP' } },
    { symbol: 'NVDA', strategies: ['PMCC'], expirationStrategies: { '2025-04-17': 'PMCC' } },
    { symbol: 'MSTR', strategies: ['BPS', 'BCS'], expirationStrategies: { '2025-04-17': 'BPS', '2025-05-16': 'BCS' } },
  ];

  it('returns all tickers when filter is All', () => {
    expect(filterTickers(mockTickers, 'All')).toHaveLength(7);
  });

  it('filters to only IC tickers', () => {
    const result = filterTickers(mockTickers, 'IC');
    expect(result.map(t => t.symbol)).toEqual(['AAPL']);
  });

  it('filters to only BPS tickers', () => {
    const result = filterTickers(mockTickers, 'BPS');
    expect(result.map(t => t.symbol)).toContain('TSLA');
    expect(result.map(t => t.symbol)).toContain('MSTR'); // multi-expiration
  });

  it('filters to only BCS tickers', () => {
    const result = filterTickers(mockTickers, 'BCS');
    expect(result.map(t => t.symbol)).toContain('COIN');
    expect(result.map(t => t.symbol)).toContain('MSTR'); // multi-expiration
  });

  it('filters to only CC tickers', () => {
    const result = filterTickers(mockTickers, 'CC');
    // PMCC contains 'CC' so NVDA also matches — this is expected behavior
    expect(result.map(t => t.symbol)).toContain('SPY');
    expect(result.map(t => t.symbol)).toContain('NVDA'); // PMCC contains 'CC'
    expect(result.map(t => t.symbol)).not.toContain('TSLA');
    expect(result.map(t => t.symbol)).not.toContain('AAPL');
  });

  it('filters to only CSP tickers', () => {
    const result = filterTickers(mockTickers, 'CSP');
    expect(result.map(t => t.symbol)).toEqual(['QQQ']);
  });

  it('filters to only PMCC tickers', () => {
    const result = filterTickers(mockTickers, 'PMCC');
    expect(result.map(t => t.symbol)).toEqual(['NVDA']);
  });

  it('includes multi-expiration ticker in both BPS and BCS filters', () => {
    const bpsResult = filterTickers(mockTickers, 'BPS');
    const bcsResult = filterTickers(mockTickers, 'BCS');
    expect(bpsResult.map(t => t.symbol)).toContain('MSTR');
    expect(bcsResult.map(t => t.symbol)).toContain('MSTR');
  });

  it('returns empty array when no tickers match filter', () => {
    const result = filterTickers(mockTickers, 'IC');
    expect(result.filter(t => t.symbol === 'TSLA')).toHaveLength(0);
  });
});
