import { describe, it, expect } from 'vitest';

// Replicate the INDEX_SYMBOLS_SET logic from EnhancedWatchlist
const INDEX_SYMBOLS_SET = new Set([
  'SPX','SPXW','SPXPM','XSP','NANOS','NDX','XND','RUT','MRUT','DJX',
  'VIX','VIXW','SPY','QQQ','IWM','DIA','OEX','XEO','QQQM','TQQQ',
  'SQQQ','UPRO','SPXU','SSO','SDS','TNA','TZA','EFA','EEM','VEA',
  'VWO','XLK','XLF','XLE','XLV','XLI','XLP','XLU','XLB','XLRE',
  'XLC','XLY','TLT','TBT','IEF','HYG','LQD','VXX','VIXY','UVXY','SVXY',
]);

type WatchlistItem = { id: number; symbol: string; isIndex?: boolean | number };

function splitWatchlist(items: WatchlistItem[]) {
  const indexItems = items.filter(
    (item) => item.isIndex === true || item.isIndex === 1 || INDEX_SYMBOLS_SET.has(item.symbol)
  );
  const equityItems = items.filter((item) => !indexItems.includes(item));
  return { indexItems, equityItems };
}

describe('watchlist index/equity split', () => {
  it('puts SPXW in the index section by symbol', () => {
    const items: WatchlistItem[] = [
      { id: 1, symbol: 'SPXW' },
      { id: 2, symbol: 'AAPL' },
    ];
    const { indexItems, equityItems } = splitWatchlist(items);
    expect(indexItems.map((i) => i.symbol)).toContain('SPXW');
    expect(equityItems.map((i) => i.symbol)).not.toContain('SPXW');
  });

  it('puts AAPL in the equity section', () => {
    const items: WatchlistItem[] = [
      { id: 1, symbol: 'SPXW' },
      { id: 2, symbol: 'AAPL' },
    ];
    const { equityItems } = splitWatchlist(items);
    expect(equityItems.map((i) => i.symbol)).toContain('AAPL');
  });

  it('respects isIndex=true flag even for non-standard symbols', () => {
    const items: WatchlistItem[] = [
      { id: 1, symbol: 'CUSTOM_IDX', isIndex: true },
      { id: 2, symbol: 'TSLA' },
    ];
    const { indexItems } = splitWatchlist(items);
    expect(indexItems.map((i) => i.symbol)).toContain('CUSTOM_IDX');
  });

  it('respects isIndex=1 (DB tinyint) flag', () => {
    const items: WatchlistItem[] = [
      { id: 1, symbol: 'CUSTOM_IDX', isIndex: 1 },
    ];
    const { indexItems } = splitWatchlist(items);
    expect(indexItems.map((i) => i.symbol)).toContain('CUSTOM_IDX');
  });

  it('handles all primary index symbols correctly', () => {
    const primaryIndexes = ['SPX', 'SPXW', 'NDX', 'RUT', 'VIX', 'SPY', 'QQQ', 'IWM', 'DIA', 'TLT'];
    const items: WatchlistItem[] = primaryIndexes.map((sym, i) => ({ id: i, symbol: sym }));
    const { indexItems, equityItems } = splitWatchlist(items);
    expect(indexItems).toHaveLength(primaryIndexes.length);
    expect(equityItems).toHaveLength(0);
  });

  it('does not put equity tickers in the index section', () => {
    const equities = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'COIN'];
    const items: WatchlistItem[] = equities.map((sym, i) => ({ id: i, symbol: sym }));
    const { indexItems, equityItems } = splitWatchlist(items);
    expect(indexItems).toHaveLength(0);
    expect(equityItems).toHaveLength(equities.length);
  });

  it('handles empty watchlist gracefully', () => {
    const { indexItems, equityItems } = splitWatchlist([]);
    expect(indexItems).toHaveLength(0);
    expect(equityItems).toHaveLength(0);
  });

  it('handles mixed watchlist with 62 items correctly', () => {
    const items: WatchlistItem[] = [
      { id: 1, symbol: 'SPXW' },
      { id: 2, symbol: 'NDX' },
      { id: 3, symbol: 'RUT' },
      ...Array.from({ length: 59 }, (_, i) => ({ id: i + 4, symbol: `STOCK${i}` })),
    ];
    const { indexItems, equityItems } = splitWatchlist(items);
    expect(indexItems).toHaveLength(3);
    expect(equityItems).toHaveLength(59);
  });
});

// Test the scanType filtering logic on the server side
describe('scanType filter logic', () => {
  const INDEX_SET_SERVER = new Set(['SPX','SPXW','NDX','RUT','VIX','SPY','QQQ','IWM','DIA','TLT']);

  function filterByScanType(symbols: string[], scanType: 'equity' | 'index') {
    if (scanType === 'index') {
      return symbols.filter((s) => INDEX_SET_SERVER.has(s));
    }
    return symbols.filter((s) => !INDEX_SET_SERVER.has(s));
  }

  it('returns only index symbols for index scan', () => {
    const symbols = ['SPXW', 'NDX', 'AAPL', 'NVDA'];
    const result = filterByScanType(symbols, 'index');
    expect(result).toEqual(['SPXW', 'NDX']);
  });

  it('returns only equity symbols for equity scan', () => {
    const symbols = ['SPXW', 'NDX', 'AAPL', 'NVDA'];
    const result = filterByScanType(symbols, 'equity');
    expect(result).toEqual(['AAPL', 'NVDA']);
  });

  it('returns empty array when no matching symbols', () => {
    const symbols = ['AAPL', 'NVDA'];
    const result = filterByScanType(symbols, 'index');
    expect(result).toHaveLength(0);
  });
});
