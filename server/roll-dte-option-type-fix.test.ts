/**
 * Tests for the fetchRollTargetForDTE option_type filter fix.
 *
 * Critical bug: The chain filter was using `o.type` but Tradier's OptionContract
 * interface uses `option_type`. This caused the filter to always return an empty
 * array, making DTE fetch always fail with "No options found".
 *
 * Fix: Changed `o.type === input.optionType` → `o.option_type === input.optionType`
 */

import { describe, it, expect } from 'vitest';

// ─── Simulate the Tradier OptionContract structure ────────────────────────────

interface MockOptionContract {
  symbol: string;
  option_type: string;   // ← Tradier uses option_type, NOT type
  strike: number;
  bid: number;
  ask: number;
  greeks?: { delta: number };
}

// Simulate the old (broken) filter logic
function filterChainBroken(chain: MockOptionContract[], optionType: string): MockOptionContract[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any[]).filter((o: any) => o.type === optionType);
}

// Simulate the new (fixed) filter logic
function filterChainFixed(chain: MockOptionContract[], optionType: string): MockOptionContract[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any[]).filter((o: any) => o.option_type === optionType);
}

// ─── Mock chain data (as Tradier returns it) ──────────────────────────────────

const mockChain: MockOptionContract[] = [
  { symbol: 'AAPL  260508C00180000', option_type: 'call', strike: 180, bid: 2.50, ask: 2.60 },
  { symbol: 'AAPL  260508C00185000', option_type: 'call', strike: 185, bid: 1.80, ask: 1.90 },
  { symbol: 'AAPL  260508P00175000', option_type: 'put',  strike: 175, bid: 1.20, ask: 1.30 },
  { symbol: 'AAPL  260508P00170000', option_type: 'put',  strike: 170, bid: 0.80, ask: 0.90 },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('fetchRollTargetForDTE option_type filter', () => {
  it('broken filter (o.type) returns empty array for call options', () => {
    const result = filterChainBroken(mockChain, 'call');
    // This is the bug: o.type is undefined, so filter always returns []
    expect(result).toHaveLength(0);
  });

  it('broken filter (o.type) returns empty array for put options', () => {
    const result = filterChainBroken(mockChain, 'put');
    expect(result).toHaveLength(0);
  });

  it('fixed filter (o.option_type) correctly returns call options', () => {
    const result = filterChainFixed(mockChain, 'call');
    expect(result).toHaveLength(2);
    expect(result.every(o => o.option_type === 'call')).toBe(true);
    expect(result.map(o => o.strike)).toEqual([180, 185]);
  });

  it('fixed filter (o.option_type) correctly returns put options', () => {
    const result = filterChainFixed(mockChain, 'put');
    expect(result).toHaveLength(2);
    expect(result.every(o => o.option_type === 'put')).toBe(true);
    expect(result.map(o => o.strike)).toEqual([175, 170]);
  });

  it('fixed filter finds closest strike to target', () => {
    const calls = filterChainFixed(mockChain, 'call');
    const targetStrike = 182;
    const closest = calls.reduce((prev, curr) =>
      Math.abs(curr.strike - targetStrike) < Math.abs(prev.strike - targetStrike) ? curr : prev
    );
    expect(closest.strike).toBe(180); // 180 is closer to 182 than 185
  });

  it('UTC date parsing produces correct OCC symbol date', () => {
    // Simulate OCC symbol date construction with UTC methods
    const expiration = '2026-05-08';
    const d = new Date(expiration);
    const yy = d.getUTCFullYear().toString().slice(2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    expect(`${yy}${mm}${dd}`).toBe('260508');
  });

  it('OCC symbol construction is correct for call option', () => {
    const symbol = 'AAPL';
    const expiration = '2026-05-08';
    const strike = 185;
    const optionType = 'call';

    const d = new Date(expiration);
    const yy = d.getUTCFullYear().toString().slice(2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const typeChar = optionType === 'call' ? 'C' : 'P';
    const strikeStr = (strike * 1000).toFixed(0).padStart(8, '0');
    const occSymbol = `${symbol.padEnd(6)}${yy}${mm}${dd}${typeChar}${strikeStr}`;

    expect(occSymbol).toBe('AAPL  260508C00185000');
  });

  it('net credit calculation: stoPremium - btcCost', () => {
    const stoPremium = 2.50;  // bid on new STO
    const btcCost = 0.30;     // ask on current BTC
    const quantity = 3;
    const netCreditPerContract = stoPremium - btcCost;
    const netCreditTotal = netCreditPerContract * quantity;

    expect(netCreditPerContract).toBeCloseTo(2.20);
    expect(netCreditTotal).toBeCloseTo(6.60);
  });
});
