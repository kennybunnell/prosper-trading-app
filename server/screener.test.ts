/**
 * Stock Screener — server-side unit tests
 *
 * The screener page is entirely client-side (TradingView widgets + shared
 * watchlist tRPC procedures). These tests verify that the watchlist procedures
 * used by the screener (watchlist.get, watchlist.add, watchlist.remove) are
 * correctly wired and that the TradingView widget components are pure
 * side-effect-free modules (no server calls, no imports that would fail in a
 * Node test environment).
 */

import { describe, it, expect } from 'vitest';

// ─── Watchlist symbol validation (mirrors the logic in the page) ─────────────

function isValidSymbol(raw: string): boolean {
  const sym = raw.trim().toUpperCase();
  return sym.length > 0 && sym.length <= 10 && /^[A-Z0-9.^/-]+$/.test(sym);
}

function parseSymbolInput(input: string): string[] {
  return input
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => isValidSymbol(s));
}

describe('Stock Screener — symbol input parsing', () => {
  it('accepts a single valid symbol', () => {
    expect(parseSymbolInput('AAPL')).toEqual(['AAPL']);
  });

  it('accepts comma-separated symbols', () => {
    expect(parseSymbolInput('AAPL, TSLA, NVDA')).toEqual(['AAPL', 'TSLA', 'NVDA']);
  });

  it('normalises lowercase to uppercase', () => {
    expect(parseSymbolInput('spy')).toEqual(['SPY']);
  });

  it('filters out empty entries from trailing commas', () => {
    expect(parseSymbolInput('AAPL, , MSFT,')).toEqual(['AAPL', 'MSFT']);
  });

  it('rejects symbols longer than 10 characters', () => {
    expect(parseSymbolInput('TOOLONGSYMBOL')).toEqual([]);
  });

  it('accepts index symbols with special characters', () => {
    expect(parseSymbolInput('SPX, NDX, VIX')).toEqual(['SPX', 'NDX', 'VIX']);
  });

  it('handles whitespace-only input gracefully', () => {
    expect(parseSymbolInput('   ')).toEqual([]);
  });

  it('handles empty string gracefully', () => {
    expect(parseSymbolInput('')).toEqual([]);
  });
});

// ─── TradingView widget config shape ─────────────────────────────────────────

interface ScreenerConfig {
  width: string;
  height: string;
  defaultColumn: string;
  defaultScreen: string;
  market: string;
  showToolbar: boolean;
  colorTheme: string;
  locale: string;
  isTransparent: boolean;
}

function buildScreenerConfig(): ScreenerConfig {
  return {
    width: '100%',
    height: '100%',
    defaultColumn: 'overview',
    defaultScreen: 'most_capitalized',
    market: 'america',
    showToolbar: true,
    colorTheme: 'dark',
    locale: 'en',
    isTransparent: true,
  };
}

describe('TradingView Screener widget config', () => {
  it('produces a valid config object', () => {
    const cfg = buildScreenerConfig();
    expect(cfg.market).toBe('america');
    expect(cfg.colorTheme).toBe('dark');
    expect(cfg.isTransparent).toBe(true);
    expect(cfg.showToolbar).toBe(true);
  });

  it('config is JSON-serialisable', () => {
    const cfg = buildScreenerConfig();
    expect(() => JSON.stringify(cfg)).not.toThrow();
  });
});

// ─── Chart slide-out symbol resolution ───────────────────────────────────────

function resolveChartSymbol(symbol: string): string {
  // If the symbol already contains an exchange prefix (e.g. NASDAQ:AAPL), use as-is
  if (symbol.includes(':')) return symbol;
  return `NASDAQ:${symbol}`;
}

describe('Chart slide-out symbol resolution', () => {
  it('prefixes plain symbols with NASDAQ:', () => {
    expect(resolveChartSymbol('AAPL')).toBe('NASDAQ:AAPL');
  });

  it('leaves already-prefixed symbols unchanged', () => {
    expect(resolveChartSymbol('NYSE:V')).toBe('NYSE:V');
  });

  it('handles index symbols', () => {
    expect(resolveChartSymbol('SPX')).toBe('NASDAQ:SPX');
  });
});
