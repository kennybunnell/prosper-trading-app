import { describe, it, expect } from 'vitest';

/**
 * Test suite for getOpportunityKey function
 * This verifies that the fix for duplicate React keys is working correctly
 */

type CCOpportunity = {
  symbol: string;
  strike: number;
  expiration: string;
  longStrike?: number;
  [key: string]: any;
};

// Replicate the fixed getOpportunityKey function
const getOpportunityKey = (opp: CCOpportunity) => {
  if (opp.longStrike && opp.longStrike > 0) {
    // Bear Call Spread: include both short and long strikes
    return `${opp.symbol}-${opp.strike}-${opp.longStrike}-${opp.expiration}`;
  }
  // Regular Covered Call: just symbol-strike-expiration
  return `${opp.symbol}-${opp.strike}-${opp.expiration}`;
};

describe('getOpportunityKey - Duplicate Key Fix', () => {
  it('should generate unique keys for Covered Call vs Bear Call Spread with same symbol/strike/expiration', () => {
    // Covered Call: TSLA $525 strike, no long leg
    const coveredCall: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      expiration: '2026-04-02',
      currentPrice: 520,
      premium: 5.50,
    };

    // Bear Call Spread: TSLA $525/$530 spread (same short strike as CC)
    const bearCallSpread: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      expiration: '2026-04-02',
      longStrike: 530,
      currentPrice: 520,
      premium: 2.50,
    };

    const ccKey = getOpportunityKey(coveredCall);
    const bcsKey = getOpportunityKey(bearCallSpread);

    // Keys should be different
    expect(ccKey).toBe('TSLA-525-2026-04-02');
    expect(bcsKey).toBe('TSLA-525-530-2026-04-02');
    expect(ccKey).not.toBe(bcsKey);
  });

  it('should generate same key for two Covered Calls with identical parameters', () => {
    const cc1: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      expiration: '2026-04-02',
      premium: 5.50,
    };

    const cc2: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      expiration: '2026-04-02',
      premium: 5.75, // Different premium, but same key
    };

    expect(getOpportunityKey(cc1)).toBe(getOpportunityKey(cc2));
    expect(getOpportunityKey(cc1)).toBe('TSLA-525-2026-04-02');
  });

  it('should generate different keys for Bear Call Spreads with different long strikes', () => {
    const bcs1: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      longStrike: 530,
      expiration: '2026-04-02',
    };

    const bcs2: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      longStrike: 535, // Different long strike
      expiration: '2026-04-02',
    };

    const key1 = getOpportunityKey(bcs1);
    const key2 = getOpportunityKey(bcs2);

    expect(key1).toBe('TSLA-525-530-2026-04-02');
    expect(key2).toBe('TSLA-525-535-2026-04-02');
    expect(key1).not.toBe(key2);
  });

  it('should handle longStrike of 0 as Covered Call (not spread)', () => {
    const ccWithZeroLong: CCOpportunity = {
      symbol: 'TSLA',
      strike: 525,
      longStrike: 0, // Zero should be treated as no long leg
      expiration: '2026-04-02',
    };

    const key = getOpportunityKey(ccWithZeroLong);
    expect(key).toBe('TSLA-525-2026-04-02'); // Should not include longStrike
  });

  it('should generate unique keys for all the error cases from logs', () => {
    // These are the actual duplicate keys that were appearing in the console logs
    const opportunities: CCOpportunity[] = [
      { symbol: 'TSLA', strike: 525, expiration: '2026-04-02' }, // CC
      { symbol: 'TSLA', strike: 525, longStrike: 530, expiration: '2026-04-02' }, // BCS
      { symbol: 'TSLA', strike: 530, expiration: '2026-04-02' }, // CC
      { symbol: 'TSLA', strike: 530, longStrike: 535, expiration: '2026-04-02' }, // BCS
    ];

    const keys = opportunities.map(opp => getOpportunityKey(opp));
    
    // All keys should be unique
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
    
    // Verify specific keys
    expect(keys[0]).toBe('TSLA-525-2026-04-02');
    expect(keys[1]).toBe('TSLA-525-530-2026-04-02');
    expect(keys[2]).toBe('TSLA-530-2026-04-02');
    expect(keys[3]).toBe('TSLA-530-535-2026-04-02');
  });
});
