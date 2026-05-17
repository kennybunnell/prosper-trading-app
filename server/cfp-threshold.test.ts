/**
 * Unit tests for Close for Profit threshold logic
 * Tests the filtering logic that determines which positions qualify for CfP mode
 */
import { describe, it, expect } from 'vitest';

// Simulate the cfpQualifying filter logic from AutoCloseStep
function getQualifyingPositions(
  positions: Array<{ profitPct: number; optionSymbol: string }>,
  threshold: number
) {
  return positions.filter(p => p.profitPct >= threshold);
}

// Simulate the row key generation
function getRowKey(accountId: string, optionSymbol: string) {
  return `${accountId}::${optionSymbol.replace(/\s+/g, '')}`;
}

describe('Close for Profit threshold logic', () => {
  const mockPositions = [
    { profitPct: 25, optionSymbol: 'SPY   260124P00450000' },
    { profitPct: 50, optionSymbol: 'AAPL  260124C00200000' },
    { profitPct: 75, optionSymbol: 'QQQ   260124P00400000' },
    { profitPct: 10, optionSymbol: 'TSLA  260124C00300000' },
    { profitPct: 50, optionSymbol: 'NVDA  260124P00500000' },
  ];

  it('filters positions at or above 50% threshold', () => {
    const qualifying = getQualifyingPositions(mockPositions, 50);
    expect(qualifying).toHaveLength(3);
    expect(qualifying.map(p => p.profitPct)).toEqual([50, 75, 50]);
  });

  it('filters positions at or above 75% threshold', () => {
    const qualifying = getQualifyingPositions(mockPositions, 75);
    expect(qualifying).toHaveLength(1);
    expect(qualifying[0].profitPct).toBe(75);
  });

  it('returns all positions at 0% threshold', () => {
    const qualifying = getQualifyingPositions(mockPositions, 0);
    expect(qualifying).toHaveLength(5);
  });

  it('returns no positions at 100% threshold', () => {
    const qualifying = getQualifyingPositions(mockPositions, 100);
    expect(qualifying).toHaveLength(0);
  });

  it('exactly matches threshold boundary (inclusive)', () => {
    const qualifying = getQualifyingPositions(mockPositions, 25);
    expect(qualifying.map(p => p.profitPct)).toContain(25);
  });

  it('generates correct row key stripping whitespace from OCC symbol', () => {
    const key = getRowKey('ACC123', 'SPY   260124P00450000');
    expect(key).toBe('ACC123::SPY260124P00450000');
    expect(key).not.toContain(' ');
  });

  it('row key is consistent for same position', () => {
    const key1 = getRowKey('ACC123', 'SPY   260124P00450000');
    const key2 = getRowKey('ACC123', 'SPY   260124P00450000');
    expect(key1).toBe(key2);
  });

  it('row keys differ for different accounts', () => {
    const key1 = getRowKey('ACC123', 'SPY260124P00450000');
    const key2 = getRowKey('ACC456', 'SPY260124P00450000');
    expect(key1).not.toBe(key2);
  });
});
