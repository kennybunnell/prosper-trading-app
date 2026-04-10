/**
 * Tests for the hidden losers filter mismatch logic
 * Validates that the callout correctly identifies positions filtered out by active filters
 */
import { describe, it, expect } from 'vitest';

// Replicate the filter logic from AutomationDashboard
interface MockPos {
  positionId: string;
  symbol: string;
  strategy: string;
  pnlStatus: string;
  actionLabel: string;
  metrics: {
    itmDepth: number;
    strikePrice: number;
    dte: number;
  };
}

function applyFilters(
  positions: MockPos[],
  opts: {
    rollCreditOnlyFilter: boolean;
    creditDirectionFilter: boolean;
    rollCloseFilter: boolean;
    rollStrategyFilters: Set<string>;
    bestFitCache: Record<string, { candidate: { netCredit: number; strike: number } }>;
    rolledTodaySet: Set<string>;
    hideRolledToday: boolean;
  }
): MockPos[] {
  return positions.filter(pos => {
    if (opts.rollStrategyFilters.size > 0 && !opts.rollStrategyFilters.has(pos.strategy)) return false;
    if (opts.rollCreditOnlyFilter && pos.metrics.itmDepth > 5) return false;
    if (opts.hideRolledToday && opts.rolledTodaySet.has(pos.positionId)) return false;
    if (opts.creditDirectionFilter) {
      const bf = opts.bestFitCache[pos.positionId];
      if (!bf) return false;
      const isCredit = (bf.candidate.netCredit ?? 0) >= 0;
      const isPut = pos.strategy === 'CSP' || pos.strategy === 'BPS';
      const movesOtm = isPut
        ? bf.candidate.strike < pos.metrics.strikePrice
        : bf.candidate.strike > pos.metrics.strikePrice;
      if (!isCredit || !movesOtm) return false;
    }
    if (opts.rollCloseFilter) {
      if (pos.actionLabel !== 'CLOSE' && pos.actionLabel !== 'STOP') return false;
    }
    return true;
  });
}

const mockPositions: MockPos[] = [
  { positionId: 'p1', symbol: 'APLD', strategy: 'CSP', pnlStatus: 'loss', actionLabel: 'CLOSE', metrics: { itmDepth: 3.9, strikePrice: 27.5, dte: 0 } },
  { positionId: 'p2', symbol: 'CVX',  strategy: 'CSP', pnlStatus: 'loss', actionLabel: 'ROLL',  metrics: { itmDepth: 0.1, strikePrice: 187.5, dte: 7 } },
  { positionId: 'p3', symbol: 'MS',   strategy: 'CC',  pnlStatus: 'loss', actionLabel: 'ROLL',  metrics: { itmDepth: 3.8, strikePrice: 170, dte: 42 } },
  { positionId: 'p4', symbol: 'WMT',  strategy: 'CC',  pnlStatus: 'loss', actionLabel: 'ROLL',  metrics: { itmDepth: 1.2, strikePrice: 129, dte: 42 } },
  { positionId: 'p5', symbol: 'NVDA', strategy: 'CC',  pnlStatus: 'loss', actionLabel: 'ROLL',  metrics: { itmDepth: 8.5, strikePrice: 500, dte: 14 } }, // deep ITM
  { positionId: 'p6', symbol: 'TSLA', strategy: 'CSP', pnlStatus: 'loss', actionLabel: 'ROLL',  metrics: { itmDepth: 0.5, strikePrice: 200, dte: 5 } },
];

describe('Hidden Losers Filter Logic', () => {
  it('shows all positions when no filters are active', () => {
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: false,
      creditDirectionFilter: false,
      rollCloseFilter: false,
      rollStrategyFilters: new Set(),
      bestFitCache: {},
      rolledTodaySet: new Set(),
      hideRolledToday: false,
    });
    expect(visible.length).toBe(6);
  });

  it('hides deep ITM positions when Credit Rolls Only filter is active', () => {
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: true,
      creditDirectionFilter: false,
      rollCloseFilter: false,
      rollStrategyFilters: new Set(),
      bestFitCache: {},
      rolledTodaySet: new Set(),
      hideRolledToday: false,
    });
    // NVDA has itmDepth=8.5 > 5, should be hidden
    expect(visible.find(p => p.symbol === 'NVDA')).toBeUndefined();
    expect(visible.length).toBe(5);
  });

  it('hides positions without credit roll candidates when Credit+Direction filter is active', () => {
    const bestFitCache = {
      'p2': { candidate: { netCredit: 0.5, strike: 180 } }, // credit, moves OTM (lower strike for CSP)
      'p3': { candidate: { netCredit: -0.2, strike: 175 } }, // debit — should be hidden
      'p4': { candidate: { netCredit: 0.3, strike: 135 } }, // credit, moves OTM for CC (higher strike)
      'p6': { candidate: { netCredit: 0.4, strike: 195 } }, // credit, moves OTM (lower strike for CSP)
      // p1 (APLD CSP), p5 (NVDA CC) have no candidate
    };
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: false,
      creditDirectionFilter: true,
      rollCloseFilter: false,
      rollStrategyFilters: new Set(),
      bestFitCache,
      rolledTodaySet: new Set(),
      hideRolledToday: false,
    });
    // p1 (no candidate), p3 (debit), p5 (no candidate) should be hidden
    expect(visible.find(p => p.positionId === 'p1')).toBeUndefined();
    expect(visible.find(p => p.positionId === 'p3')).toBeUndefined();
    expect(visible.find(p => p.positionId === 'p5')).toBeUndefined();
    expect(visible.length).toBe(3);
  });

  it('hides non-CLOSE positions when Close-only filter is active', () => {
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: false,
      creditDirectionFilter: false,
      rollCloseFilter: true,
      rollStrategyFilters: new Set(),
      bestFitCache: {},
      rolledTodaySet: new Set(),
      hideRolledToday: false,
    });
    // Only APLD (actionLabel=CLOSE) should be visible
    expect(visible.length).toBe(1);
    expect(visible[0].symbol).toBe('APLD');
  });

  it('hides positions rolled today when hideRolledToday is active', () => {
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: false,
      creditDirectionFilter: false,
      rollCloseFilter: false,
      rollStrategyFilters: new Set(),
      bestFitCache: {},
      rolledTodaySet: new Set(['p2', 'p3']),
      hideRolledToday: true,
    });
    expect(visible.find(p => p.positionId === 'p2')).toBeUndefined();
    expect(visible.find(p => p.positionId === 'p3')).toBeUndefined();
    expect(visible.length).toBe(4);
  });

  it('correctly identifies hidden losers as the difference between all and visible', () => {
    const allLosers = mockPositions;
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: true, // hides NVDA (deep ITM)
      creditDirectionFilter: false,
      rollCloseFilter: false,
      rollStrategyFilters: new Set(),
      bestFitCache: {},
      rolledTodaySet: new Set(),
      hideRolledToday: false,
    });
    const hidden = allLosers.filter(p => !visible.find(v => v.positionId === p.positionId));
    expect(hidden.length).toBe(1);
    expect(hidden[0].symbol).toBe('NVDA');
  });

  it('shows no callout when all losers pass the active filters', () => {
    const visible = applyFilters(mockPositions, {
      rollCreditOnlyFilter: false,
      creditDirectionFilter: false,
      rollCloseFilter: false,
      rollStrategyFilters: new Set(),
      bestFitCache: {},
      rolledTodaySet: new Set(),
      hideRolledToday: false,
    });
    const hidden = mockPositions.filter(p => !visible.find(v => v.positionId === p.positionId));
    expect(hidden.length).toBe(0); // no callout needed
  });
});
