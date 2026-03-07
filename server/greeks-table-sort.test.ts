/**
 * Unit tests for the Greeks table sort logic used in PortfolioCommandCenter.
 * Tests the sortedTickers useMemo logic in isolation.
 */
import { describe, it, expect } from 'vitest';

type TickerData = {
  symbol: string;
  netDelta: number;
  dailyTheta: number;
  netVega: number;
  netGamma: number;
  premiumAtRisk: number;
  contracts: number;
  strategies: string[];
  avgDte: number;
  avgIv: number;
};

type SortCol = 'symbol' | 'contracts' | 'netDelta' | 'dailyTheta' | 'netVega' | 'premiumAtRisk' | 'avgDte' | 'avgIv' | 'strategies';
type SortDir = 'asc' | 'desc';

function sortTickers(rows: TickerData[], col: SortCol, dir: SortDir): TickerData[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case 'symbol':        cmp = a.symbol.localeCompare(b.symbol); break;
      case 'contracts':     cmp = a.contracts - b.contracts; break;
      case 'netDelta':      cmp = a.netDelta - b.netDelta; break;
      case 'dailyTheta':    cmp = a.dailyTheta - b.dailyTheta; break;
      case 'netVega':       cmp = a.netVega - b.netVega; break;
      case 'premiumAtRisk': cmp = a.premiumAtRisk - b.premiumAtRisk; break;
      case 'avgDte':        cmp = a.avgDte - b.avgDte; break;
      case 'avgIv':         cmp = a.avgIv - b.avgIv; break;
      case 'strategies':    cmp = a.strategies.join(',').localeCompare(b.strategies.join(',')); break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

const sample: TickerData[] = [
  { symbol: 'TSLA', netDelta: -12.5, dailyTheta: 45.0, netVega: -300, netGamma: 0.1, premiumAtRisk: 5000, contracts: 10, strategies: ['BPS'], avgDte: 30, avgIv: 0.55 },
  { symbol: 'AAPL', netDelta:   5.0, dailyTheta: 20.0, netVega:  100, netGamma: 0.2, premiumAtRisk: 2000, contracts:  4, strategies: ['CSP'], avgDte: 45, avgIv: 0.30 },
  { symbol: 'NVDA', netDelta:  -3.0, dailyTheta: 80.0, netVega: -500, netGamma: 0.3, premiumAtRisk: 8000, contracts: 16, strategies: ['IC'],  avgDte: 21, avgIv: 0.70 },
  { symbol: 'COIN', netDelta:   0.0, dailyTheta: 10.0, netVega:   50, netGamma: 0.0, premiumAtRisk: 1000, contracts:  2, strategies: ['CC'],  avgDte: 60, avgIv: 0.45 },
];

describe('Greeks table sort', () => {
  it('sorts by symbol ascending', () => {
    const result = sortTickers(sample, 'symbol', 'asc');
    expect(result.map(r => r.symbol)).toEqual(['AAPL', 'COIN', 'NVDA', 'TSLA']);
  });

  it('sorts by symbol descending', () => {
    const result = sortTickers(sample, 'symbol', 'desc');
    expect(result.map(r => r.symbol)).toEqual(['TSLA', 'NVDA', 'COIN', 'AAPL']);
  });

  it('sorts by premiumAtRisk descending (default)', () => {
    const result = sortTickers(sample, 'premiumAtRisk', 'desc');
    expect(result.map(r => r.premiumAtRisk)).toEqual([8000, 5000, 2000, 1000]);
  });

  it('sorts by premiumAtRisk ascending', () => {
    const result = sortTickers(sample, 'premiumAtRisk', 'asc');
    expect(result.map(r => r.premiumAtRisk)).toEqual([1000, 2000, 5000, 8000]);
  });

  it('sorts by contracts descending', () => {
    const result = sortTickers(sample, 'contracts', 'desc');
    expect(result.map(r => r.contracts)).toEqual([16, 10, 4, 2]);
  });

  it('sorts by netDelta ascending (most negative first)', () => {
    const result = sortTickers(sample, 'netDelta', 'asc');
    expect(result.map(r => r.netDelta)).toEqual([-12.5, -3.0, 0.0, 5.0]);
  });

  it('sorts by dailyTheta descending (highest theta first)', () => {
    const result = sortTickers(sample, 'dailyTheta', 'desc');
    expect(result.map(r => r.dailyTheta)).toEqual([80, 45, 20, 10]);
  });

  it('sorts by avgDte ascending (soonest expiry first)', () => {
    const result = sortTickers(sample, 'avgDte', 'asc');
    expect(result.map(r => r.avgDte)).toEqual([21, 30, 45, 60]);
  });

  it('sorts by avgIv descending (highest IV first)', () => {
    const result = sortTickers(sample, 'avgIv', 'desc');
    expect(result.map(r => r.avgIv)).toEqual([0.70, 0.55, 0.45, 0.30]);
  });

  it('sorts by strategies ascending (alphabetical)', () => {
    const result = sortTickers(sample, 'strategies', 'asc');
    expect(result.map(r => r.strategies[0])).toEqual(['BPS', 'CC', 'CSP', 'IC']);
  });

  it('does not mutate the original array', () => {
    const original = [...sample];
    sortTickers(sample, 'symbol', 'asc');
    expect(sample.map(r => r.symbol)).toEqual(original.map(r => r.symbol));
  });

  it('handles empty array gracefully', () => {
    expect(sortTickers([], 'symbol', 'asc')).toEqual([]);
  });

  it('handles single-row array', () => {
    const single = [sample[0]];
    expect(sortTickers(single, 'netDelta', 'desc')).toEqual(single);
  });
});
