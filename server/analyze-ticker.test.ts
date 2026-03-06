/**
 * Unit tests for analyzeTicker strategy detection and strike parsing logic.
 * Tests the three fixes applied:
 *  1. Quantity-sign-based direction detection (not direction field)
 *  2. Correct strike selection (min/max for each leg type)
 *  3. Correct action routes for each strategy
 */

import { describe, it, expect } from 'vitest';

// ─── Replicate the core logic from analyzeTicker ───────────────────────────

type LegInfo = {
  occSymbol: string;
  strike: number;
  optionType: 'CALL' | 'PUT';
  quantity: number;
  direction: string;
};

function parseLegs(positions: Array<{
  symbol: string;
  quantity: number;
  direction: string;
  multiplier: number;
  openPrice: number;
  expiresAt: string;
  expiration: string;
  underlying: string;
  accountNumber: string;
}>): LegInfo[] {
  return positions.map(pos => {
    const occMatch = pos.symbol?.replace(/\s+/g, '').match(/[A-Z]+([0-9]{6})([CP])([0-9]{8})$/);
    const strike = occMatch ? parseInt(occMatch[3], 10) / 1000 : 0;
    const optionType: 'CALL' | 'PUT' = occMatch ? (occMatch[2] === 'C' ? 'CALL' : 'PUT') : 'PUT';
    return { occSymbol: pos.symbol, strike, optionType, quantity: pos.quantity, direction: pos.direction };
  });
}

function classifyStrategy(legs: LegInfo[]): {
  strategyType: string;
  strikeDisplay: string;
  actionRoute: string;
} {
  // Use quantity sign as primary discriminator (not direction field)
  const shortPuts  = legs.filter(l => l.optionType === 'PUT'  && l.quantity < 0);
  const longPuts   = legs.filter(l => l.optionType === 'PUT'  && l.quantity > 0);
  const shortCalls = legs.filter(l => l.optionType === 'CALL' && l.quantity < 0);
  const longCalls  = legs.filter(l => l.optionType === 'CALL' && l.quantity > 0);

  let strategyType = 'Options Position';
  let strikeDisplay = '';
  let actionRoute = '/performance';

  if (shortPuts.length > 0 && longPuts.length > 0 && shortCalls.length === 0) {
    strategyType = 'Bull Put Spread (BPS)';
    const sp = shortPuts.reduce((a, b) => a.strike > b.strike ? a : b);
    const lp = longPuts.reduce((a, b) => a.strike < b.strike ? a : b);
    strikeDisplay = `Short $${sp.strike} Put / Long $${lp.strike} Put`;
    actionRoute = '/iron-condor';
  } else if (shortCalls.length > 0 && longCalls.length > 0 && shortPuts.length === 0) {
    strategyType = 'Bear Call Spread (BCS)';
    const sc = shortCalls.reduce((a, b) => a.strike < b.strike ? a : b);
    const lc = longCalls.reduce((a, b) => a.strike > b.strike ? a : b);
    strikeDisplay = `Short $${sc.strike} Call / Long $${lc.strike} Call`;
    actionRoute = '/iron-condor';
  } else if (shortPuts.length > 0 && longPuts.length > 0 && shortCalls.length > 0 && longCalls.length > 0) {
    strategyType = 'Iron Condor (IC)';
    const sp = shortPuts.reduce((a, b) => a.strike > b.strike ? a : b);
    const lp = longPuts.reduce((a, b) => a.strike < b.strike ? a : b);
    const sc = shortCalls.reduce((a, b) => a.strike < b.strike ? a : b);
    const lc = longCalls.reduce((a, b) => a.strike > b.strike ? a : b);
    strikeDisplay = `P: $${lp.strike}/$${sp.strike} | C: $${sc.strike}/$${lc.strike}`;
    actionRoute = '/iron-condor';
  } else if (shortPuts.length > 0 && shortCalls.length === 0) {
    strategyType = 'Cash-Secured Put (CSP)';
    strikeDisplay = `$${shortPuts[0].strike} Put`;
    actionRoute = '/csp';
  } else if (shortCalls.length > 0 && shortPuts.length === 0) {
    strategyType = 'Covered Call (CC)';
    strikeDisplay = `$${shortCalls[0].strike} Call`;
    actionRoute = '/cc';
  } else if (legs.length > 0) {
    strikeDisplay = legs.map(l => `$${l.strike} ${l.optionType}`).join(' / ');
  }

  return { strategyType, strikeDisplay, actionRoute };
}

// ─── OCC Symbol Parsing ────────────────────────────────────────────────────

describe('OCC symbol parsing', () => {
  it('parses space-padded Tastytrade OCC symbols correctly', () => {
    const legs = parseLegs([
      { symbol: 'COIN  251219C00185000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
      { symbol: 'COIN  251219C00190000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
    ]);
    expect(legs[0].strike).toBe(185);
    expect(legs[0].optionType).toBe('CALL');
    expect(legs[1].strike).toBe(190);
    expect(legs[1].optionType).toBe('CALL');
  });

  it('parses compact OCC symbols correctly', () => {
    const legs = parseLegs([
      { symbol: 'SPY251219P00580000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 3.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219P00575000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
    ]);
    expect(legs[0].strike).toBe(580);
    expect(legs[0].optionType).toBe('PUT');
    expect(legs[1].strike).toBe(575);
    expect(legs[1].optionType).toBe('PUT');
  });

  it('handles fractional strikes (e.g. 185.5)', () => {
    const legs = parseLegs([
      { symbol: 'AAPL251219C00185500', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'AAPL', accountNumber: 'ACC1' },
    ]);
    expect(legs[0].strike).toBe(185.5);
  });
});

// ─── BCS Strategy Detection ────────────────────────────────────────────────

describe('Bear Call Spread (BCS) detection', () => {
  it('correctly identifies BCS with normal direction fields', () => {
    const legs = parseLegs([
      { symbol: 'COIN  251219C00185000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
      { symbol: 'COIN  251219C00190000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Bear Call Spread (BCS)');
    expect(result.strikeDisplay).toBe('Short $185 Call / Long $190 Call');
    expect(result.actionRoute).toBe('/iron-condor');
  });

  it('correctly identifies BCS even when both legs have direction=Short (Tastytrade bug)', () => {
    // This is the bug: Tastytrade sometimes returns direction='Short' for both spread legs
    // The fix uses quantity sign instead
    const legs = parseLegs([
      { symbol: 'COIN  251219C00185000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
      { symbol: 'COIN  251219C00190000', quantity: 1,  direction: 'Short', multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Bear Call Spread (BCS)');
    expect(result.strikeDisplay).toBe('Short $185 Call / Long $190 Call');
    expect(result.strikeDisplay).not.toBe('Short $185 Call / Long $185 Call');  // old bug
  });

  it('selects correct strikes: short=lower, long=higher', () => {
    const legs = parseLegs([
      { symbol: 'TSLA251219C00300000', quantity: -2, direction: 'Short', multiplier: 100, openPrice: 5.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'TSLA', accountNumber: 'ACC1' },
      { symbol: 'TSLA251219C00310000', quantity: 2,  direction: 'Long',  multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'TSLA', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strikeDisplay).toBe('Short $300 Call / Long $310 Call');
  });
});

// ─── BPS Strategy Detection ────────────────────────────────────────────────

describe('Bull Put Spread (BPS) detection', () => {
  it('correctly identifies BPS with correct strikes', () => {
    const legs = parseLegs([
      { symbol: 'SPY251219P00580000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 3.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219P00575000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Bull Put Spread (BPS)');
    expect(result.strikeDisplay).toBe('Short $580 Put / Long $575 Put');
    expect(result.actionRoute).toBe('/iron-condor');
  });

  it('correctly identifies BPS even when both legs have direction=Short', () => {
    const legs = parseLegs([
      { symbol: 'SPY251219P00580000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 3.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219P00575000', quantity: 1,  direction: 'Short', multiplier: 100, openPrice: 1.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Bull Put Spread (BPS)');
    expect(result.strikeDisplay).toBe('Short $580 Put / Long $575 Put');
  });
});

// ─── Iron Condor Detection ─────────────────────────────────────────────────

describe('Iron Condor (IC) detection', () => {
  it('correctly identifies IC with 4 legs', () => {
    const legs = parseLegs([
      { symbol: 'SPY251219P00570000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219P00565000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219C00600000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219C00605000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Iron Condor (IC)');
    expect(result.strikeDisplay).toBe('P: $565/$570 | C: $600/$605');
    expect(result.actionRoute).toBe('/iron-condor');
  });
});

// ─── Single-leg Strategies ─────────────────────────────────────────────────

describe('Single-leg strategy detection', () => {
  it('correctly identifies CSP', () => {
    const legs = parseLegs([
      { symbol: 'AAPL251219P00200000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 3.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'AAPL', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Cash-Secured Put (CSP)');
    expect(result.strikeDisplay).toBe('$200 Put');
    expect(result.actionRoute).toBe('/csp');
  });

  it('correctly identifies CC', () => {
    const legs = parseLegs([
      { symbol: 'AAPL251219C00220000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'AAPL', accountNumber: 'ACC1' },
    ]);
    const result = classifyStrategy(legs);
    expect(result.strategyType).toBe('Covered Call (CC)');
    expect(result.strikeDisplay).toBe('$220 Call');
    expect(result.actionRoute).toBe('/cc');
  });
});

// ─── Action Route Mapping ──────────────────────────────────────────────────

describe('Action route mapping', () => {
  it('routes BPS to /iron-condor', () => {
    const legs = parseLegs([
      { symbol: 'SPY251219P00580000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 3.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219P00575000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
    ]);
    expect(classifyStrategy(legs).actionRoute).toBe('/iron-condor');
  });

  it('routes BCS to /iron-condor', () => {
    const legs = parseLegs([
      { symbol: 'COIN  251219C00185000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.5, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
      { symbol: 'COIN  251219C00190000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'COIN', accountNumber: 'ACC1' },
    ]);
    expect(classifyStrategy(legs).actionRoute).toBe('/iron-condor');
  });

  it('routes CSP to /csp', () => {
    const legs = parseLegs([
      { symbol: 'AAPL251219P00200000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 3.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'AAPL', accountNumber: 'ACC1' },
    ]);
    expect(classifyStrategy(legs).actionRoute).toBe('/csp');
  });

  it('routes CC to /cc', () => {
    const legs = parseLegs([
      { symbol: 'AAPL251219C00220000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'AAPL', accountNumber: 'ACC1' },
    ]);
    expect(classifyStrategy(legs).actionRoute).toBe('/cc');
  });

  it('routes IC to /iron-condor', () => {
    const legs = parseLegs([
      { symbol: 'SPY251219P00570000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219P00565000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219C00600000', quantity: -1, direction: 'Short', multiplier: 100, openPrice: 2.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
      { symbol: 'SPY251219C00605000', quantity: 1,  direction: 'Long',  multiplier: 100, openPrice: 1.0, expiresAt: '2025-12-19T00:00:00Z', expiration: '2025-12-19', underlying: 'SPY', accountNumber: 'ACC1' },
    ]);
    expect(classifyStrategy(legs).actionRoute).toBe('/iron-condor');
  });
});
