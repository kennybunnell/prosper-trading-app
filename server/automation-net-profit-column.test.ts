/**
 * Unit tests for the Net Profit column in the AutomationDashboard scan results table.
 *
 * The Net Profit column displays: premiumCollected - buyBackCost
 *   - Positive value (green): position can be closed for a profit
 *   - Negative value (red): closing would cost more than premium received
 *
 * Color logic:
 *   - Green (bright): netProfit >= 0 AND realizedPercent >= threshold
 *   - Amber: netProfit >= 0 AND realizedPercent < threshold
 *   - Red: netProfit < 0
 *
 * Sort key: premiumCollected - buyBackCost (numeric)
 */

import { describe, it, expect } from 'vitest';

// ─── Pure helpers mirroring the AutomationDashboard column logic ──────────────

function calcNetProfit(premiumCollected: number, buyBackCost: number): number {
  return premiumCollected - buyBackCost;
}

function formatNetProfit(netProfit: number): string {
  const sign = netProfit >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(netProfit).toFixed(2)}`;
}

function getNetProfitColor(
  netProfit: number,
  realizedPercent: number,
  threshold: number
): 'green' | 'amber' | 'red' {
  if (netProfit < 0) return 'red';
  if (realizedPercent >= threshold) return 'green';
  return 'amber';
}

function sortByNetProfit(
  a: { premiumCollected: number; buyBackCost: number },
  b: { premiumCollected: number; buyBackCost: number },
  dir: 'asc' | 'desc'
): number {
  const av = a.premiumCollected - a.buyBackCost;
  const bv = b.premiumCollected - b.buyBackCost;
  return dir === 'asc' ? av - bv : bv - av;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Net Profit column calculation', () => {
  it('returns positive net profit when premium > buy-back cost', () => {
    // META: collected $810, buy-back costs $29 → net profit $781
    const result = calcNetProfit(810, 29);
    expect(result).toBeCloseTo(781, 2);
  });

  it('returns positive net profit for V position', () => {
    // V: collected $1056, buy-back costs $205 → net profit $851
    const result = calcNetProfit(1056, 205);
    expect(result).toBeCloseTo(851, 2);
  });

  it('returns zero when premium equals buy-back cost (break-even)', () => {
    const result = calcNetProfit(500, 500);
    expect(result).toBe(0);
  });

  it('returns negative net profit when buy-back cost exceeds premium', () => {
    // Underwater: collected $200, buy-back costs $350 → net loss -$150
    const result = calcNetProfit(200, 350);
    expect(result).toBeCloseTo(-150, 2);
  });
});

describe('Net Profit column formatting', () => {
  it('formats positive profit with + prefix', () => {
    expect(formatNetProfit(781)).toBe('+$781.00');
  });

  it('formats negative profit with - prefix', () => {
    expect(formatNetProfit(-150)).toBe('-$150.00');
  });

  it('formats zero as +$0.00', () => {
    expect(formatNetProfit(0)).toBe('+$0.00');
  });

  it('formats fractional values to 2 decimal places', () => {
    expect(formatNetProfit(123.456)).toBe('+$123.46');
    expect(formatNetProfit(-99.1)).toBe('-$99.10');
  });
});

describe('Net Profit column color logic', () => {
  const threshold = 80; // 80% profit threshold

  it('shows green when profit is positive and realized% meets threshold', () => {
    expect(getNetProfitColor(781, 96.4, threshold)).toBe('green');
  });

  it('shows amber when profit is positive but realized% below threshold', () => {
    expect(getNetProfitColor(200, 60, threshold)).toBe('amber');
  });

  it('shows red when net profit is negative', () => {
    expect(getNetProfitColor(-150, 30, threshold)).toBe('red');
  });

  it('shows green at exactly the threshold', () => {
    expect(getNetProfitColor(100, 80, threshold)).toBe('green');
  });

  it('shows amber just below the threshold', () => {
    expect(getNetProfitColor(100, 79.9, threshold)).toBe('amber');
  });
});

describe('Net Profit column sorting', () => {
  const positions = [
    { symbol: 'META', premiumCollected: 810, buyBackCost: 29 },   // netProfit = 781
    { symbol: 'V',    premiumCollected: 1056, buyBackCost: 205 },  // netProfit = 851
    { symbol: 'AAPL', premiumCollected: 300, buyBackCost: 250 },   // netProfit = 50
    { symbol: 'TSLA', premiumCollected: 200, buyBackCost: 350 },   // netProfit = -150
  ];

  it('sorts ascending (lowest net profit first)', () => {
    const sorted = [...positions].sort((a, b) => sortByNetProfit(a, b, 'asc'));
    expect(sorted[0].symbol).toBe('TSLA');  // -150
    expect(sorted[1].symbol).toBe('AAPL');  // 50
    expect(sorted[2].symbol).toBe('META');  // 781
    expect(sorted[3].symbol).toBe('V');     // 851
  });

  it('sorts descending (highest net profit first)', () => {
    const sorted = [...positions].sort((a, b) => sortByNetProfit(a, b, 'desc'));
    expect(sorted[0].symbol).toBe('V');     // 851
    expect(sorted[1].symbol).toBe('META');  // 781
    expect(sorted[2].symbol).toBe('AAPL');  // 50
    expect(sorted[3].symbol).toBe('TSLA');  // -150
  });

  it('correctly computes sort key as premiumCollected - buyBackCost', () => {
    const a = { premiumCollected: 810, buyBackCost: 29 };
    const b = { premiumCollected: 1056, buyBackCost: 205 };
    // V (851) > META (781), so desc sort puts V first
    expect(sortByNetProfit(a, b, 'desc')).toBeGreaterThan(0);
    expect(sortByNetProfit(a, b, 'asc')).toBeLessThan(0);
  });
});
