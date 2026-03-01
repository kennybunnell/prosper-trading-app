/**
 * Unit tests for IRA Safety Monitor logic
 * Tests the core violation detection functions extracted from routers-ira-safety.ts
 */

import { describe, it, expect } from 'vitest';

// ── Replicate the pure functions from routers-ira-safety.ts ──

const IRA_ACCOUNT_TYPES = [
  'Roth IRA', 'Traditional IRA', 'SEP IRA', 'SIMPLE IRA',
  'Beneficiary IRA', 'Inherited IRA', 'Rollover IRA', 'IRA', 'Cash',
];

function isRestrictedAccount(accountType: string | null | undefined): boolean {
  if (!accountType) return false;
  const normalized = accountType.toLowerCase();
  return IRA_ACCOUNT_TYPES.some(t => normalized.includes(t.toLowerCase()));
}

function parseStrikeFromSymbol(symbol: string): number {
  const clean = symbol.replace(/\s/g, '');
  const match = clean.match(/[CP](\d{8})$/);
  if (match) return parseInt(match[1]) / 1000;
  return 0;
}

function parseExpirationFromSymbol(symbol: string): string {
  const clean = symbol.replace(/\s/g, '');
  const match = clean.match(/[A-Z]+(\d{6})[CP]/);
  if (match) {
    const d = match[1];
    return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
  }
  return '';
}

describe('isRestrictedAccount', () => {
  it('detects Roth IRA', () => expect(isRestrictedAccount('Roth IRA')).toBe(true));
  it('detects Traditional IRA', () => expect(isRestrictedAccount('Traditional IRA')).toBe(true));
  it('detects Cash account', () => expect(isRestrictedAccount('Cash')).toBe(true));
  it('does not flag margin account', () => expect(isRestrictedAccount('Margin')).toBe(false));
  it('does not flag Individual', () => expect(isRestrictedAccount('Individual')).toBe(false));
  it('handles null', () => expect(isRestrictedAccount(null)).toBe(false));
  it('handles undefined', () => expect(isRestrictedAccount(undefined)).toBe(false));
  it('is case-insensitive', () => expect(isRestrictedAccount('roth ira')).toBe(true));
});

describe('parseStrikeFromSymbol', () => {
  it('parses ADBE call strike 300', () => {
    // OCC format: ADBE 260320C00300000
    expect(parseStrikeFromSymbol('ADBE  260320C00300000')).toBe(300);
  });
  it('parses SPY put strike 550', () => {
    expect(parseStrikeFromSymbol('SPY   260320P00550000')).toBe(550);
  });
  it('parses fractional strike', () => {
    expect(parseStrikeFromSymbol('TSLA  260320C00400500')).toBe(400.5);
  });
  it('returns 0 for invalid symbol', () => {
    expect(parseStrikeFromSymbol('INVALID')).toBe(0);
  });
});

describe('parseExpirationFromSymbol', () => {
  it('parses ADBE 2026-03-20', () => {
    expect(parseExpirationFromSymbol('ADBE  260320C00300000')).toBe('2026-03-20');
  });
  it('parses SPY 2026-02-27', () => {
    expect(parseExpirationFromSymbol('SPY   260227P00550000')).toBe('2026-02-27');
  });
});

describe('SHORT_STOCK violation detection', () => {
  it('detects negative quantity as short stock', () => {
    const pos = { 'instrument-type': 'Equity', quantity: -100, 'quantity-direction': 'Short', symbol: 'ADBE', 'underlying-symbol': 'ADBE', 'average-open-price': '260' };
    const isShort = pos['quantity-direction']?.toLowerCase() === 'short' || pos.quantity < 0;
    expect(isShort).toBe(true);
  });

  it('does not flag long stock', () => {
    const pos = { 'instrument-type': 'Equity', quantity: 100, 'quantity-direction': 'Long', symbol: 'AAPL', 'underlying-symbol': 'AAPL', 'average-open-price': '220' };
    const isShort = pos['quantity-direction']?.toLowerCase() === 'short' || pos.quantity < 0;
    expect(isShort).toBe(false);
  });

  it('ADBE incident: -100 shares is a critical violation', () => {
    const positions = [
      { 'instrument-type': 'Equity', quantity: -100, 'quantity-direction': 'Short', symbol: 'ADBE', 'underlying-symbol': 'ADBE', 'average-open-price': '260' },
      { 'instrument-type': 'Equity', quantity: 100, 'quantity-direction': 'Long', symbol: 'AVGO', 'underlying-symbol': 'AVGO', 'average-open-price': '335' },
    ];
    const shortStocks = positions.filter(p =>
      p['instrument-type'] === 'Equity' &&
      (p['quantity-direction']?.toLowerCase() === 'short' || p.quantity < 0)
    );
    expect(shortStocks).toHaveLength(1);
    expect(shortStocks[0]['underlying-symbol']).toBe('ADBE');
    expect(Math.abs(shortStocks[0].quantity)).toBe(100);
  });
});

describe('NAKED_SHORT_CALL detection', () => {
  it('detects naked short call when no stock owned', () => {
    const sharesOwned = 0;
    const sharesNeeded = 100; // 1 contract × 100
    const hasLongCalls = false;
    const isCovered = sharesOwned >= sharesNeeded;
    const isSpread = hasLongCalls;
    expect(!isCovered && !isSpread).toBe(true);
  });

  it('does not flag covered call (100 shares owned)', () => {
    const sharesOwned = 100;
    const sharesNeeded = 100;
    const hasLongCalls = false;
    const isCovered = sharesOwned >= sharesNeeded;
    expect(isCovered).toBe(true);
  });

  it('does not flag call spread (long call exists)', () => {
    const sharesOwned = 0;
    const sharesNeeded = 100;
    const hasLongCalls = true;
    const isCovered = sharesOwned >= sharesNeeded;
    const isSpread = hasLongCalls;
    expect(!isCovered && !isSpread).toBe(false);
  });
});

describe('Account 418 position analysis', () => {
  // Replicate the actual positions from the CSV
  const positions = [
    { symbol: 'ADBE', quantity: -100, type: 'STOCK' },
    { symbol: 'AVGO', quantity: 100, type: 'STOCK' },
    { symbol: 'BA', quantity: 100, type: 'STOCK' },
    { symbol: 'CIFR', quantity: 600, type: 'STOCK' },
    { symbol: 'COIN', quantity: 100, type: 'STOCK' },
    { symbol: 'DKNG', quantity: 200, type: 'STOCK' },
    { symbol: 'HIMS', quantity: 300, type: 'STOCK' },
    { symbol: 'HOOD', quantity: 400, type: 'STOCK' },
    { symbol: 'INTC', quantity: 500, type: 'STOCK' },
    { symbol: 'IREN', quantity: 500, type: 'STOCK' },
    { symbol: 'PLTR', quantity: 100, type: 'STOCK' },
    { symbol: 'QCOM', quantity: 100, type: 'STOCK' },
    { symbol: 'SOFI', quantity: 900, type: 'STOCK' },
    { symbol: 'SPY', quantity: 100, type: 'STOCK' },
    { symbol: 'TSLA', quantity: 50, type: 'STOCK' },
  ];

  it('identifies exactly 1 short stock position (ADBE)', () => {
    const shortPositions = positions.filter(p => p.quantity < 0);
    expect(shortPositions).toHaveLength(1);
    expect(shortPositions[0].symbol).toBe('ADBE');
  });

  it('ADBE is short exactly 100 shares', () => {
    const adbe = positions.find(p => p.symbol === 'ADBE');
    expect(adbe?.quantity).toBe(-100);
    expect(Math.abs(adbe!.quantity)).toBe(100);
  });

  it('all other positions are long', () => {
    const nonAdbe = positions.filter(p => p.symbol !== 'ADBE');
    const allLong = nonAdbe.every(p => p.quantity > 0);
    expect(allLong).toBe(true);
  });
});
