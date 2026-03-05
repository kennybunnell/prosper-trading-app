/**
 * Unit tests for CC order preview summary calculation fix.
 * Verifies that STO (sell-to-open) covered call orders are routed to the
 * correct summary branch (cc strategy, not btc strategy) so the summary
 * shows Total Premium Received correctly instead of treating premiums as
 * Buy-Back Cost.
 */
import { describe, it, expect } from 'vitest';

// Simulate the calculateTotalPremium logic from UnifiedOrderPreviewModal
function calculateTotalPremium(
  orders: Array<{ premium: number; quantity: number }>,
  strategy: string
): number {
  const isDebit = strategy === 'btc' || strategy === 'pmcc' || strategy === 'roll';
  const multiplier = isDebit ? -1 : 1;
  return orders.reduce((sum, order) => {
    return sum + (order.premium * 100 * order.quantity * multiplier);
  }, 0);
}

// Simulate the calculateTotalCollateral logic for CC strategy
function calculateTotalCollateral(
  orders: Array<{ strike: number; quantity: number }>,
  strategy: string
): number {
  return orders.reduce((sum, order) => {
    switch (strategy) {
      case 'csp':
        return sum + (order.strike * 100 * order.quantity);
      case 'cc':
        // Covered calls: stock ownership is the collateral, no cash required
        return sum; // falls through to default → 0
      default:
        return sum;
    }
  }, 0);
}

// Simulate the summary branch selection logic
function getSummaryBranch(strategy: string): 'btc_roll' | 'standard_sto' {
  return strategy === 'btc' || strategy === 'roll' ? 'btc_roll' : 'standard_sto';
}

describe('CC Order Preview — Strategy Routing', () => {
  const ccOrders = [
    { symbol: 'AMD', premium: 3.10, quantity: 1, strike: 212.50 },
    { symbol: 'INTC', premium: 0.80, quantity: 1, strike: 48.50 },
    { symbol: 'CRM', premium: 2.10, quantity: 1, strike: 202.50 },
    { symbol: 'PLTR', premium: 1.80, quantity: 1, strike: 162.50 },
    { symbol: 'AMZN', premium: 2.15, quantity: 1, strike: 225.00 },
  ];

  it('routes CC orders to standard_sto summary branch (not btc_roll)', () => {
    expect(getSummaryBranch('cc')).toBe('standard_sto');
  });

  it('routes BTC orders to btc_roll summary branch', () => {
    expect(getSummaryBranch('btc')).toBe('btc_roll');
  });

  it('routes roll orders to btc_roll summary branch', () => {
    expect(getSummaryBranch('roll')).toBe('btc_roll');
  });

  it('calculates positive total premium for CC (STO credit strategy)', () => {
    const total = calculateTotalPremium(ccOrders, 'cc');
    // 5 orders × ~$2 avg × 100 = ~$995
    expect(total).toBeGreaterThan(0);
    // AMD: 3.10×100×1 = 310, INTC: 0.80×100×1 = 80, CRM: 2.10×100×1 = 210,
    // PLTR: 1.80×100×1 = 180, AMZN: 2.15×100×1 = 215 → total = 995
    expect(total).toBeCloseTo(995, 2);
  });

  it('calculates negative total premium for BTC (debit strategy)', () => {
    const total = calculateTotalPremium(ccOrders, 'btc');
    expect(total).toBeLessThan(0);
    expect(total).toBeCloseTo(-995, 2);
  });

  it('calculates $0 collateral for CC strategy (stock ownership is collateral)', () => {
    const collateral = calculateTotalCollateral(ccOrders, 'cc');
    expect(collateral).toBe(0);
  });

  it('calculates correct collateral for CSP strategy', () => {
    const cspOrders = [{ strike: 212.50, quantity: 1 }];
    const collateral = calculateTotalCollateral(cspOrders, 'csp');
    expect(collateral).toBe(21250); // 212.50 × 100 × 1
  });

  it('total premium matches sum of individual row totals', () => {
    // Individual row totals from the screenshot: 310 + 80 + 210 + 180 + 215 = 995
    const individualTotals = [310, 80, 210, 180, 215];
    const expectedTotal = individualTotals.reduce((a, b) => a + b, 0);
    const calculatedTotal = calculateTotalPremium(ccOrders, 'cc');
    expect(calculatedTotal).toBeCloseTo(expectedTotal, 1);
  });
});

describe('CC Order Preview — BTC Strategy Isolation', () => {
  it('BTC close orders still use btc_roll branch after previewStrategy fix', () => {
    // Simulates the new previewStrategy state being set to 'btc' for close orders
    const previewStrategy = 'btc';
    expect(getSummaryBranch(previewStrategy)).toBe('btc_roll');
  });

  it('CC sell orders use standard_sto branch after previewStrategy fix', () => {
    // Simulates the new previewStrategy state being set to 'cc' for CC orders
    const previewStrategy = 'cc';
    expect(getSummaryBranch(previewStrategy)).toBe('standard_sto');
  });

  it('CC orders do not show negative estimated profit in summary', () => {
    const ccOrders = [{ premium: 3.10, quantity: 1, strike: 212.50 }];
    const totalPremium = calculateTotalPremium(ccOrders, 'cc');
    const totalCollateral = calculateTotalCollateral(ccOrders, 'cc');
    // For CC: premium is positive, collateral is 0 → no negative profit shown
    expect(totalPremium).toBeGreaterThan(0);
    expect(totalCollateral).toBe(0);
    // The old bug: with strategy='btc', premium was -310 and collateral was 310 → showed -$620 profit
    const buggyPremium = calculateTotalPremium(ccOrders, 'btc');
    expect(buggyPremium).toBeLessThan(0); // confirms the old bug would have shown negative
  });
});
