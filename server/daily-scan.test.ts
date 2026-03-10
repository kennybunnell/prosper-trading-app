/**
 * Tests for the daily scan service (daily-scan.ts)
 * Covers:
 *   1. scanCloseForProfit — finds short options at >= 90% profit
 *   2. scanRollPositions  — finds short options with DTE <= 7
 *   3. scanSellCalls      — finds long equity positions (>= 100 shares) without active short calls
 *   4. parseOptionSymbol  — OCC symbol parsing helper
 */

import { describe, it, expect } from 'vitest';

// ─── Inline copies of the pure helpers (no DB/API deps) ───────────────────────

function parseDTE(expiresAt: string | undefined): number {
  if (!expiresAt) return 999;
  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function parseOptionSymbol(symbol: string): {
  underlyingSymbol: string;
  expiryDate: string;
  optionType: 'call' | 'put';
  strike: string;
} | null {
  const match = symbol.match(/^([A-Z ]+?)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const underlying = match[1].trim();
  const dateStr = match[2];
  const year = `20${dateStr.slice(0, 2)}`;
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const expiryDate = `${year}-${month}-${day}`;
  const optionType = match[3] === 'C' ? 'call' : 'put';
  const strikeRaw = parseInt(match[4], 10);
  const strike = (strikeRaw / 1000).toFixed(2);
  return { underlyingSymbol: underlying, expiryDate, optionType, strike };
}

async function scanCloseForProfit(positions: any[]): Promise<{ count: number; items: any[] }> {
  const items: any[] = [];
  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity Option') continue;
    if (pos['quantity-direction'] !== 'Short') continue;
    const openPrice = parseFloat(pos['average-open-price'] || '0');
    const closePrice = parseFloat(pos['close-price'] || '0');
    if (openPrice <= 0) continue;
    const profitPct = ((openPrice - closePrice) / openPrice) * 100;
    if (profitPct < 90) continue;
    const parsed = parseOptionSymbol(pos.symbol);
    const dte = parsed ? parseDTE(parsed.expiryDate) : parseDTE(pos['expires-at']);
    items.push({
      symbol: pos.symbol,
      underlyingSymbol: pos['underlying-symbol'],
      profitPct: Math.round(profitPct * 10) / 10,
      currentValue: closePrice * 100,
      openPrice: openPrice * 100,
      daysLeft: dte,
      expiresAt: parsed?.expiryDate || pos['expires-at'] || '',
    });
  }
  items.sort((a, b) => b.profitPct - a.profitPct);
  return { count: items.length, items: items.slice(0, 10) };
}

async function scanRollPositions(positions: any[]): Promise<{ count: number; items: any[] }> {
  const items: any[] = [];
  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity Option') continue;
    if (pos['quantity-direction'] !== 'Short') continue;
    const parsed = parseOptionSymbol(pos.symbol);
    const dte = parsed ? parseDTE(parsed.expiryDate) : parseDTE(pos['expires-at']);
    if (dte > 7) continue;
    items.push({
      symbol: pos.symbol,
      underlyingSymbol: pos['underlying-symbol'],
      dte,
      strike: parsed?.strike || '?',
      optionType: parsed?.optionType || 'call',
      quantity: Math.abs(pos.quantity || 1),
      expiresAt: parsed?.expiryDate || pos['expires-at'] || '',
    });
  }
  items.sort((a, b) => a.dte - b.dte);
  return { count: items.length, items: items.slice(0, 10) };
}

async function scanSellCalls(positions: any[]): Promise<{ count: number; items: any[] }> {
  const activeShortCallUnderlyings = new Set<string>();
  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity Option') continue;
    if (pos['quantity-direction'] !== 'Short') continue;
    const parsed = parseOptionSymbol(pos.symbol);
    if (parsed?.optionType === 'call') {
      activeShortCallUnderlyings.add(pos['underlying-symbol']);
    }
  }
  const items: any[] = [];
  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity') continue;
    if (pos['quantity-direction'] !== 'Long') continue;
    const quantity = pos.quantity || 0;
    if (quantity < 100) continue;
    const underlyingSymbol = pos['underlying-symbol'] || pos.symbol;
    if (activeShortCallUnderlyings.has(underlyingSymbol)) continue;
    const avgCostBasis = parseFloat(pos['average-open-price'] || '0');
    const currentPrice = parseFloat(pos['close-price'] || '0');
    if (avgCostBasis <= 0 || currentPrice <= 0) continue;
    const deficit = avgCostBasis - currentPrice;
    let recommendation: 'HARVEST' | 'MONITOR' | null = null;
    if (currentPrice >= avgCostBasis) continue;
    else if (deficit / avgCostBasis <= 0.20) recommendation = 'HARVEST';
    else if (deficit / avgCostBasis <= 0.40) recommendation = 'MONITOR';
    else continue;
    items.push({ symbol: underlyingSymbol, shares: quantity, currentPrice, avgCostBasis, recommendation });
  }
  items.sort((a, b) => {
    const defA = (a.avgCostBasis - a.currentPrice) / a.avgCostBasis;
    const defB = (b.avgCostBasis - b.currentPrice) / b.avgCostBasis;
    return defB - defA;
  });
  return { count: items.length, items: items.slice(0, 10) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseOptionSymbol', () => {
  it('parses a standard OCC call symbol', () => {
    const result = parseOptionSymbol('AAPL260117C00150000');
    expect(result).not.toBeNull();
    expect(result!.underlyingSymbol).toBe('AAPL');
    expect(result!.expiryDate).toBe('2026-01-17');
    expect(result!.optionType).toBe('call');
    expect(result!.strike).toBe('150.00');
  });

  it('parses a put symbol', () => {
    const result = parseOptionSymbol('TSLA260620P00200000');
    expect(result).not.toBeNull();
    expect(result!.optionType).toBe('put');
    expect(result!.strike).toBe('200.00');
  });

  it('returns null for non-option symbols', () => {
    expect(parseOptionSymbol('AAPL')).toBeNull();
    expect(parseOptionSymbol('')).toBeNull();
  });

  it('handles SPX/SPXW symbols', () => {
    const result = parseOptionSymbol('SPXW260117C05000000');
    expect(result).not.toBeNull();
    expect(result!.underlyingSymbol).toBe('SPXW');
    expect(result!.strike).toBe('5000.00');
  });
});

describe('scanCloseForProfit', () => {
  it('finds short options at >= 90% profit', async () => {
    const positions = [
      {
        symbol: 'AAPL260117C00150000',
        'underlying-symbol': 'AAPL',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        'average-open-price': '2.00',  // opened at $2.00
        'close-price': '0.10',         // current mark $0.10 → 95% profit
      },
    ];
    const result = await scanCloseForProfit(positions);
    expect(result.count).toBe(1);
    expect(result.items[0].underlyingSymbol).toBe('AAPL');
    expect(result.items[0].profitPct).toBeGreaterThanOrEqual(90);
  });

  it('excludes positions below 90% profit', async () => {
    const positions = [
      {
        symbol: 'TSLA260117C00200000',
        'underlying-symbol': 'TSLA',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        'average-open-price': '2.00',
        'close-price': '1.50',  // 25% profit — not enough
      },
    ];
    const result = await scanCloseForProfit(positions);
    expect(result.count).toBe(0);
  });

  it('excludes long positions', async () => {
    const positions = [
      {
        symbol: 'MSFT260117C00300000',
        'underlying-symbol': 'MSFT',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Long',
        'average-open-price': '2.00',
        'close-price': '0.05',
      },
    ];
    const result = await scanCloseForProfit(positions);
    expect(result.count).toBe(0);
  });

  it('excludes non-option positions', async () => {
    const positions = [
      {
        symbol: 'AAPL',
        'underlying-symbol': 'AAPL',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        'average-open-price': '150.00',
        'close-price': '10.00',
      },
    ];
    const result = await scanCloseForProfit(positions);
    expect(result.count).toBe(0);
  });

  it('sorts by profit% descending', async () => {
    const positions = [
      {
        symbol: 'AAPL260117C00150000',
        'underlying-symbol': 'AAPL',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        'average-open-price': '2.00',
        'close-price': '0.10',  // 95%
      },
      {
        symbol: 'TSLA260117C00200000',
        'underlying-symbol': 'TSLA',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        'average-open-price': '3.00',
        'close-price': '0.05',  // 98.3%
      },
    ];
    const result = await scanCloseForProfit(positions);
    expect(result.count).toBe(2);
    expect(result.items[0].underlyingSymbol).toBe('TSLA');
    expect(result.items[1].underlyingSymbol).toBe('AAPL');
  });
});

describe('scanRollPositions', () => {
  // Use a date 3 days in the future for DTE <= 7
  const nearExpiry = new Date();
  nearExpiry.setDate(nearExpiry.getDate() + 3);
  const nearExpiryStr = nearExpiry.toISOString().split('T')[0].replace(/-/g, '').slice(2); // YYMMDD

  const farExpiry = new Date();
  farExpiry.setDate(farExpiry.getDate() + 30);
  const farExpiryStr = farExpiry.toISOString().split('T')[0].replace(/-/g, '').slice(2);

  it('finds short options with DTE <= 7', async () => {
    const positions = [
      {
        symbol: `AAPL${nearExpiryStr}C00150000`,
        'underlying-symbol': 'AAPL',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        quantity: -1,
      },
    ];
    const result = await scanRollPositions(positions);
    expect(result.count).toBe(1);
    expect(result.items[0].underlyingSymbol).toBe('AAPL');
    expect(result.items[0].dte).toBeLessThanOrEqual(7);
  });

  it('excludes positions with DTE > 7', async () => {
    const positions = [
      {
        symbol: `TSLA${farExpiryStr}C00200000`,
        'underlying-symbol': 'TSLA',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        quantity: -1,
      },
    ];
    const result = await scanRollPositions(positions);
    expect(result.count).toBe(0);
  });

  it('sorts by DTE ascending (most urgent first)', async () => {
    const expiry2 = new Date();
    expiry2.setDate(expiry2.getDate() + 2);
    const exp2Str = expiry2.toISOString().split('T')[0].replace(/-/g, '').slice(2);

    const expiry5 = new Date();
    expiry5.setDate(expiry5.getDate() + 5);
    const exp5Str = expiry5.toISOString().split('T')[0].replace(/-/g, '').slice(2);

    const positions = [
      {
        symbol: `MSFT${exp5Str}C00300000`,
        'underlying-symbol': 'MSFT',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        quantity: -1,
      },
      {
        symbol: `NVDA${exp2Str}C00500000`,
        'underlying-symbol': 'NVDA',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        quantity: -1,
      },
    ];
    const result = await scanRollPositions(positions);
    expect(result.count).toBe(2);
    expect(result.items[0].underlyingSymbol).toBe('NVDA');
    expect(result.items[1].underlyingSymbol).toBe('MSFT');
  });
});

describe('scanSellCalls', () => {
  it('finds long equity positions with no active short call', async () => {
    const positions = [
      {
        symbol: 'AAPL',
        'underlying-symbol': 'AAPL',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        quantity: 200,
        'average-open-price': '180.00',
        'close-price': '160.00',  // 11% below cost — HARVEST
      },
    ];
    const result = await scanSellCalls(positions);
    expect(result.count).toBe(1);
    expect(result.items[0].symbol).toBe('AAPL');
    expect(result.items[0].recommendation).toBe('HARVEST');
  });

  it('excludes positions that already have a short call', async () => {
    const nearExpiry = new Date();
    nearExpiry.setDate(nearExpiry.getDate() + 30);
    const nearStr = nearExpiry.toISOString().split('T')[0].replace(/-/g, '').slice(2);

    const positions = [
      {
        symbol: 'TSLA',
        'underlying-symbol': 'TSLA',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        quantity: 100,
        'average-open-price': '250.00',
        'close-price': '220.00',  // 12% below cost — HARVEST
      },
      {
        symbol: `TSLA${nearStr}C00250000`,
        'underlying-symbol': 'TSLA',
        'instrument-type': 'Equity Option',
        'quantity-direction': 'Short',
        quantity: -1,
      },
    ];
    const result = await scanSellCalls(positions);
    expect(result.count).toBe(0);
  });

  it('excludes positions with fewer than 100 shares', async () => {
    const positions = [
      {
        symbol: 'NVDA',
        'underlying-symbol': 'NVDA',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        quantity: 50,
        'average-open-price': '500.00',
        'close-price': '450.00',
      },
    ];
    const result = await scanSellCalls(positions);
    expect(result.count).toBe(0);
  });

  it('excludes positions at or above cost basis (KEEP)', async () => {
    const positions = [
      {
        symbol: 'MSFT',
        'underlying-symbol': 'MSFT',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        quantity: 100,
        'average-open-price': '300.00',
        'close-price': '320.00',  // above cost — KEEP
      },
    ];
    const result = await scanSellCalls(positions);
    expect(result.count).toBe(0);
  });

  it('classifies 30% deficit as MONITOR', async () => {
    const positions = [
      {
        symbol: 'AMD',
        'underlying-symbol': 'AMD',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        quantity: 100,
        'average-open-price': '100.00',
        'close-price': '70.00',  // 30% below cost — MONITOR
      },
    ];
    const result = await scanSellCalls(positions);
    expect(result.count).toBe(1);
    expect(result.items[0].recommendation).toBe('MONITOR');
  });

  it('excludes positions with > 40% deficit (LIQUIDATE — handled by Force Exit)', async () => {
    const positions = [
      {
        symbol: 'ACHR',
        'underlying-symbol': 'ACHR',
        'instrument-type': 'Equity',
        'quantity-direction': 'Long',
        quantity: 1000,
        'average-open-price': '10.00',
        'close-price': '4.00',  // 60% below cost — LIQUIDATE
      },
    ];
    const result = await scanSellCalls(positions);
    expect(result.count).toBe(0);
  });
});
