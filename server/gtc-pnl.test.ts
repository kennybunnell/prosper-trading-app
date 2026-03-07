/**
 * Unit tests for GTC P&L tracker
 * Tests: P&L calculation math, monthly aggregation, and fill detection logic
 */
import { describe, it, expect } from 'vitest';

// ─── P&L calculation helpers (mirrors the poll procedure logic) ───────────────

function computePnl(
  premiumPerShare: number,
  totalPremiumCollected: number,
  closePerShare: number
): { closeCost: string; totalCloseCost: string; realizedPnl: string; realizedPnlPct: string } {
  const contracts = premiumPerShare > 0
    ? Math.round(totalPremiumCollected / (premiumPerShare * 100))
    : 1;
  const totalClose = closePerShare * 100 * contracts;
  const pnl = totalPremiumCollected - totalClose;
  const pnlPct = totalPremiumCollected > 0 ? (pnl / totalPremiumCollected) * 100 : 0;
  return {
    closeCost: closePerShare.toFixed(4),
    totalCloseCost: totalClose.toFixed(2),
    realizedPnl: pnl.toFixed(2),
    realizedPnlPct: pnlPct.toFixed(2),
  };
}

// ─── Monthly aggregation helper (mirrors GtcOrders.tsx useMemo) ───────────────

function getMonthKey(d: Date | string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

interface MockOrder {
  filledAt: Date | null;
  totalPremiumCollected: string;
  realizedPnl: string | null;
  status: string;
}

function aggregateMonthly(orders: MockOrder[]) {
  const map = new Map<string, { premium: number; pnl: number; count: number; winCount: number }>();
  orders.filter(o => o.status === 'filled').forEach(o => {
    const k = getMonthKey(o.filledAt);
    if (!k) return;
    const existing = map.get(k) || { premium: 0, pnl: 0, count: 0, winCount: 0 };
    const pnl = parseFloat(o.realizedPnl || '0');
    existing.premium += parseFloat(o.totalPremiumCollected || '0');
    existing.pnl += pnl;
    existing.count += 1;
    if (pnl > 0) existing.winCount += 1;
    map.set(k, existing);
  });
  return map;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GTC P&L calculation', () => {
  it('computes 75% profit target P&L correctly (1 contract)', () => {
    // STO at $3.50 credit, 1 contract = $350 total
    // Close at $0.875 (75% profit = 25% of original credit)
    const result = computePnl(3.50, 350.00, 0.875);
    expect(result.closeCost).toBe('0.8750');
    expect(result.totalCloseCost).toBe('87.50');
    expect(result.realizedPnl).toBe('262.50');
    expect(result.realizedPnlPct).toBe('75.00');
  });

  it('computes 50% profit target P&L correctly (1 contract)', () => {
    // STO at $2.00 credit, 1 contract = $200 total
    // Close at $1.00 (50% profit)
    const result = computePnl(2.00, 200.00, 1.00);
    expect(result.totalCloseCost).toBe('100.00');
    expect(result.realizedPnl).toBe('100.00');
    expect(result.realizedPnlPct).toBe('50.00');
  });

  it('computes P&L for 2 contracts correctly', () => {
    // STO at $1.50 credit, 2 contracts = $300 total
    // Close at $0.375 (75% profit)
    const result = computePnl(1.50, 300.00, 0.375);
    expect(result.totalCloseCost).toBe('75.00');
    expect(result.realizedPnl).toBe('225.00');
    expect(result.realizedPnlPct).toBe('75.00');
  });

  it('computes negative P&L when closed at a loss', () => {
    // STO at $2.00 credit, 1 contract = $200 total
    // Close at $4.00 (2x loss)
    const result = computePnl(2.00, 200.00, 4.00);
    expect(result.totalCloseCost).toBe('400.00');
    expect(result.realizedPnl).toBe('-200.00');
    expect(parseFloat(result.realizedPnlPct)).toBeLessThan(0);
  });

  it('handles SPXW-sized premium correctly (10-wide spread, 1 contract)', () => {
    // SPXW IC: STO at $1.80 credit, 1 contract = $180 total
    // Close at $0.45 (75% profit)
    const result = computePnl(1.80, 180.00, 0.45);
    expect(result.totalCloseCost).toBe('45.00');
    expect(result.realizedPnl).toBe('135.00');
    expect(result.realizedPnlPct).toBe('75.00');
  });

  it('falls back to 1 contract when premiumPerShare is 0', () => {
    const result = computePnl(0, 350.00, 0.875);
    // contracts = 1 (fallback)
    expect(result.totalCloseCost).toBe('87.50');
    expect(result.realizedPnl).toBe('262.50');
  });

  it('computes P&L for 5 contracts correctly', () => {
    // STO at $2.50 credit, 5 contracts = $1250 total
    // Close at $0.625 (75% profit)
    const result = computePnl(2.50, 1250.00, 0.625);
    expect(result.totalCloseCost).toBe('312.50');
    expect(result.realizedPnl).toBe('937.50');
    expect(result.realizedPnlPct).toBe('75.00');
  });
});

describe('Monthly P&L aggregation', () => {
  const orders: MockOrder[] = [
    { filledAt: new Date('2026-03-05'), totalPremiumCollected: '350.00', realizedPnl: '262.50', status: 'filled' },
    { filledAt: new Date('2026-03-12'), totalPremiumCollected: '200.00', realizedPnl: '150.00', status: 'filled' },
    { filledAt: new Date('2026-03-19'), totalPremiumCollected: '180.00', realizedPnl: '-90.00', status: 'filled' },
    { filledAt: new Date('2026-02-20'), totalPremiumCollected: '300.00', realizedPnl: '225.00', status: 'filled' },
    { filledAt: null, totalPremiumCollected: '150.00', realizedPnl: null, status: 'cancelled' },
  ];

  it('aggregates March correctly', () => {
    const map = aggregateMonthly(orders);
    const march = map.get('2026-03')!;
    expect(march.count).toBe(3);
    expect(march.premium).toBeCloseTo(730.00);
    expect(march.pnl).toBeCloseTo(322.50);
    expect(march.winCount).toBe(2); // 262.50 and 150.00 are positive; -90.00 is a loss
  });

  it('aggregates February correctly', () => {
    const map = aggregateMonthly(orders);
    const feb = map.get('2026-02')!;
    expect(feb.count).toBe(1);
    expect(feb.pnl).toBeCloseTo(225.00);
    expect(feb.winCount).toBe(1);
  });

  it('excludes cancelled orders from aggregation', () => {
    const map = aggregateMonthly(orders);
    // No entry should exist for the null filledAt cancelled order
    const allCounts = Array.from(map.values()).reduce((sum, v) => sum + v.count, 0);
    expect(allCounts).toBe(4); // only the 4 filled orders
  });

  it('returns empty map for no filled orders', () => {
    const map = aggregateMonthly([
      { filledAt: new Date('2026-03-05'), totalPremiumCollected: '350.00', realizedPnl: '262.50', status: 'cancelled' },
    ]);
    expect(map.size).toBe(0);
  });

  it('computes all-time totals correctly', () => {
    const map = aggregateMonthly(orders);
    let totalPnl = 0, totalCount = 0;
    map.forEach(v => { totalPnl += v.pnl; totalCount += v.count; });
    expect(totalCount).toBe(4);
    expect(totalPnl).toBeCloseTo(547.50); // 262.50 + 150.00 - 90.00 + 225.00
  });
});

describe('getMonthKey helper', () => {
  it('returns correct key for a date', () => {
    expect(getMonthKey(new Date('2026-03-07'))).toBe('2026-03');
    expect(getMonthKey(new Date('2026-01-15'))).toBe('2026-01');
    expect(getMonthKey(new Date('2025-12-31'))).toBe('2025-12');
  });

  it('returns empty string for null', () => {
    expect(getMonthKey(null)).toBe('');
  });

  it('handles string dates', () => {
    expect(getMonthKey('2026-03-15T10:30:00Z')).toBe('2026-03');
  });
});

describe('Win rate calculation', () => {
  it('computes win rate correctly', () => {
    const count = 10, winCount = 7;
    const winRate = count > 0 ? (winCount / count) * 100 : 0;
    expect(winRate).toBe(70);
  });

  it('returns 0 for no trades', () => {
    const count = 0, winCount = 0;
    const winRate = count > 0 ? (winCount / count) * 100 : 0;
    expect(winRate).toBe(0);
  });

  it('correctly flags >= 70% win rate as green threshold', () => {
    expect(70 >= 70).toBe(true);
    expect(69.9 >= 70).toBe(false);
  });
});
