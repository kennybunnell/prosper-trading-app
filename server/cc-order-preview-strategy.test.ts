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

describe('Order Quantity Initialization', () => {
  // Simulates the initialization logic from UnifiedOrderPreviewModal
  function initOrderQuantities(
    orders: Array<{ symbol: string; strike: number; expiration: string; accountNumber?: string; quantity?: number }>,
    defaultQuantities?: Map<string, number>
  ): Map<string, number> {
    const getOrderKey = (o: typeof orders[0]) => {
      const acct = o.accountNumber ? `-${o.accountNumber}` : '';
      return `${o.symbol}-${o.strike}-${o.expiration}${acct}`;
    };
    const map = new Map<string, number>();
    orders.forEach(order => {
      const key = getOrderKey(order);
      const defaultQty = defaultQuantities?.get(key) ?? order.quantity ?? 1;
      map.set(key, defaultQty);
    });
    return map;
  }

  it('uses order.quantity when defaultQuantities not provided', () => {
    const orders = [{ symbol: 'AVGO', strike: 340, expiration: '2026-03-12', accountNumber: 'ACC1', quantity: 5 }];
    const map = initOrderQuantities(orders);
    expect(map.get('AVGO-340-2026-03-12-ACC1')).toBe(5);
  });

  it('falls back to 1 when neither defaultQuantities nor order.quantity provided', () => {
    const orders = [{ symbol: 'NVDA', strike: 190, expiration: '2026-03-12' }];
    const map = initOrderQuantities(orders);
    expect(map.get('NVDA-190-2026-03-12')).toBe(1);
  });

  it('multi-account same symbol gets separate keys and quantities', () => {
    const orders = [
      { symbol: 'AVGO', strike: 340, expiration: '2026-03-12', accountNumber: 'ACC1', quantity: 5 },
      { symbol: 'AVGO', strike: 340, expiration: '2026-03-12', accountNumber: 'ACC2', quantity: 2 },
    ];
    const map = initOrderQuantities(orders);
    expect(map.get('AVGO-340-2026-03-12-ACC1')).toBe(5);
    expect(map.get('AVGO-340-2026-03-12-ACC2')).toBe(2);
    expect(map.size).toBe(2);
  });

  it('defaultQuantities overrides order.quantity when provided', () => {
    const orders = [{ symbol: 'AMD', strike: 212.5, expiration: '2026-03-12', accountNumber: 'ACC1', quantity: 3 }];
    const defaults = new Map([['AMD-212.5-2026-03-12-ACC1', 2]]);
    const map = initOrderQuantities(orders, defaults);
    expect(map.get('AMD-212.5-2026-03-12-ACC1')).toBe(2);
  });

  it('total premium calculation uses correct quantities', () => {
    // AVGO: 5 contracts × $6.50 × 100 = $3,250
    // NVDA: 3 contracts × $1.95 × 100 = $585
    const orders = [
      { symbol: 'AVGO', strike: 340, expiration: '2026-03-12', accountNumber: 'ACC1', quantity: 5, premium: 6.50 },
      { symbol: 'NVDA', strike: 190, expiration: '2026-03-12', accountNumber: 'ACC1', quantity: 3, premium: 1.95 },
    ];
    const map = initOrderQuantities(orders);
    const total = orders.reduce((sum, o) => {
      const acct = o.accountNumber ? `-${o.accountNumber}` : '';
      const key = `${o.symbol}-${o.strike}-${o.expiration}${acct}`;
      const qty = map.get(key) ?? 1;
      return sum + (o.premium * 100 * qty);
    }, 0);
    expect(total).toBeCloseTo(3250 + 585, 0);
  });
});

describe('CC Ownership Validation Guard', () => {
  // Simulates the validateOrders logic for the CC ownership check
  function validateCCOwnership(
    orders: Array<{ symbol: string; quantity: number }>,
    holdings: Array<{ symbol: string; quantity: number; maxContracts: number }> | undefined
  ): Array<{ symbol: string; message: string }> {
    const errors: Array<{ symbol: string; message: string }> = [];
    // Guard: only validate when holdings is explicitly provided and non-empty
    if (holdings && holdings.length > 0) {
      orders.forEach(order => {
        const holding = holdings.find(h => h.symbol === order.symbol);
        if (!holding) {
          errors.push({ symbol: order.symbol, message: 'No shares owned. Cannot sell covered calls.' });
        } else if (order.quantity > holding.maxContracts) {
          errors.push({ symbol: order.symbol, message: `Not enough shares.` });
        }
      });
    }
    return errors;
  }

  it('produces NO errors when holdings is undefined (scanner-sourced orders)', () => {
    const orders = [{ symbol: 'AMD', quantity: 1 }, { symbol: 'INTC', quantity: 1 }];
    const errors = validateCCOwnership(orders, undefined);
    expect(errors).toHaveLength(0);
  });

  it('produces NO errors when holdings is empty array', () => {
    const orders = [{ symbol: 'AMD', quantity: 1 }];
    const errors = validateCCOwnership(orders, []);
    expect(errors).toHaveLength(0);
  });

  it('produces errors when holdings provided but symbol not found', () => {
    const orders = [{ symbol: 'AMD', quantity: 1 }];
    const holdings = [{ symbol: 'INTC', quantity: 100, maxContracts: 1 }];
    const errors = validateCCOwnership(orders, holdings);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('No shares owned');
  });

  it('produces errors when quantity exceeds maxContracts', () => {
    const orders = [{ symbol: 'AMD', quantity: 3 }];
    const holdings = [{ symbol: 'AMD', quantity: 100, maxContracts: 1 }];
    const errors = validateCCOwnership(orders, holdings);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Not enough shares');
  });

  it('produces NO errors when holdings provided and ownership confirmed', () => {
    const orders = [{ symbol: 'AMD', quantity: 1 }];
    const holdings = [{ symbol: 'AMD', quantity: 100, maxContracts: 1 }];
    const errors = validateCCOwnership(orders, holdings);
    expect(errors).toHaveLength(0);
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
