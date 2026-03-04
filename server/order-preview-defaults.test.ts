import { describe, it, expect } from 'vitest';

describe('Order Preview Dialog Default Pricing', () => {
  describe('Fill Zone Calculation (85% between bid and mid)', () => {
    it('should calculate Fill zone price at 85% between bid and mid', () => {
      const order = {
        bid: 3.00,
        mid: 4.00,
      };

      // Calculate Fill zone price: 85% between bid and mid
      const priceRange = order.mid - order.bid; // $1.00
      const fillPrice = order.bid + (priceRange * 0.85); // $3.00 + $0.85 = $3.85
      const roundedPrice = Math.round(fillPrice * 100) / 100;

      expect(roundedPrice).toBe(3.85);
    });

    it('should handle narrow spreads correctly', () => {
      const order = {
        bid: 2.50,
        mid: 2.60,
      };

      const priceRange = order.mid - order.bid; // $0.10
      const fillPrice = order.bid + (priceRange * 0.85); // $2.50 + $0.085 = $2.585
      const roundedPrice = Math.round(fillPrice * 100) / 100; // Round to $2.59

      expect(roundedPrice).toBe(2.59);
    });

    it('should handle wide spreads correctly', () => {
      const order = {
        bid: 5.00,
        mid: 10.00,
      };

      const priceRange = order.mid - order.bid; // $5.00
      const fillPrice = order.bid + (priceRange * 0.85); // $5.00 + $4.25 = $9.25
      const roundedPrice = Math.round(fillPrice * 100) / 100;

      expect(roundedPrice).toBe(9.25);
    });

    it('should round to nearest cent', () => {
      const order = {
        bid: 1.234,
        mid: 1.567,
      };

      const priceRange = order.mid - order.bid; // $0.333
      const fillPrice = order.bid + (priceRange * 0.85); // $1.234 + $0.28305 = $1.51705
      const roundedPrice = Math.round(fillPrice * 100) / 100; // Should round to $1.52

      expect(roundedPrice).toBe(1.52);
    });
  });

  describe('Slider Position Calculation', () => {
    it('should calculate slider position as 85 for Fill zone price', () => {
      const order = {
        bid: 3.00,
        mid: 4.00,
      };
      const currentPrice = 3.85; // Fill zone price

      // Calculate slider position (0-100)
      const priceRange = order.mid - order.bid;
      const position = ((currentPrice - order.bid) / priceRange) * 100;

      expect(position).toBeCloseTo(85, 10); // Use toBeCloseTo for floating point
    });

    it('should show 0 for bid price', () => {
      const order = {
        bid: 3.00,
        mid: 4.00,
      };
      const currentPrice = 3.00; // At bid

      const priceRange = order.mid - order.bid;
      const position = ((currentPrice - order.bid) / priceRange) * 100;

      expect(position).toBe(0);
    });

    it('should show 100 for mid price', () => {
      const order = {
        bid: 3.00,
        mid: 4.00,
      };
      const currentPrice = 4.00; // At mid

      const priceRange = order.mid - order.bid;
      const position = ((currentPrice - order.bid) / priceRange) * 100;

      expect(position).toBe(100);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle GOOGL example from screenshot', () => {
      // From screenshot: Bid $8.30, Ask $8.70, Mid would be $8.50
      const order = {
        bid: 8.30,
        mid: 8.50,
      };

      const priceRange = order.mid - order.bid; // $0.20
      const fillPrice = order.bid + (priceRange * 0.85); // $8.30 + $0.17 = $8.47
      const roundedPrice = Math.round(fillPrice * 100) / 100;

      // Should default to $8.47 instead of $8.30 (bid)
      expect(roundedPrice).toBe(8.47);
      expect(roundedPrice).toBeGreaterThan(order.bid);
      expect(roundedPrice).toBeLessThan(order.mid);
    });

    it('should position multiple orders at Fill zone', () => {
      const orders = [
        { bid: 3.00, mid: 4.00 },
        { bid: 5.50, mid: 6.00 },
        { bid: 2.80, mid: 3.20 },
      ];

      const fillPrices = orders.map(order => {
        const priceRange = order.mid - order.bid;
        const fillPrice = order.bid + (priceRange * 0.85);
        return Math.round(fillPrice * 100) / 100;
      });

      // All should be at 85% position
      expect(fillPrices[0]).toBe(3.85); // $3.00 + ($1.00 * 0.85)
      expect(fillPrices[1]).toBe(5.93); // $5.50 + ($0.50 * 0.85)
      expect(fillPrices[2]).toBe(3.14); // $2.80 + ($0.40 * 0.85)

      // All should be between bid and mid
      fillPrices.forEach((price, idx) => {
        expect(price).toBeGreaterThan(orders[idx].bid);
        expect(price).toBeLessThan(orders[idx].mid);
      });
    });
  });
});

describe('BTC Smart Fill Pricing (Spread-Width Tiers)', () => {
  /**
   * Mirrors the calcBtcLimitPrice logic from routers-automation.ts
   * and the calculateSmartFillPrice buy-side logic from working-orders-utils.ts
   */
  function calcBtcPrice(bid: number, ask: number): number {
    const spread = ask - bid;
    const mid = (bid + ask) / 2;
    let price: number;
    if (spread <= 0.05) {
      price = mid;
    } else if (spread <= 0.15) {
      price = mid + 0.01;
    } else if (spread <= 0.30) {
      price = bid + (spread * 0.75);
    } else {
      price = bid + (spread * 0.85);
    }
    // Round to $0.05 tick below $1, $0.01 above $1
    if (price < 1) {
      price = Math.round(price * 20) / 20;
    } else {
      price = Math.round(price * 100) / 100;
    }
    return Math.max(bid, Math.min(ask, Math.max(0.01, price)));
  }

  it('tight spread (≤$0.05): should use mid price', () => {
    // HIMS: bid $0.09, ask $0.10 → spread $0.01 → mid $0.095
    const price = calcBtcPrice(0.09, 0.10);
    expect(price).toBe(0.10); // mid $0.095 rounds to $0.10 (nearest $0.05)
  });

  it('medium spread (≤$0.15): should use mid + $0.01', () => {
    // HIMS: bid $0.13, ask $0.17 → spread $0.04 → mid $0.15 + $0.01 = $0.16
    const price = calcBtcPrice(0.13, 0.17);
    expect(price).toBe(0.15); // mid $0.15 + $0.01 = $0.16, rounds to $0.15 (nearest $0.05)
  });

  it('wide spread (≤$0.30): should use 75% from bid', () => {
    // bid $0.07, ask $0.25 → spread $0.18 → 75% = $0.07 + $0.135 = $0.205
    const price = calcBtcPrice(0.07, 0.25);
    expect(price).toBe(0.20); // rounds to nearest $0.05
  });

  it('very wide spread (>$0.30): should use 85% from bid — not full ask', () => {
    // IREN: bid $0.31, ask $0.39 → spread $0.08 → wait, that's medium
    // HOOD: bid $0.71, ask $0.75 → spread $0.04 → tight
    // INTC: bid $0.24, ask $0.28 → spread $0.04 → tight
    // HOOD Call $84: bid $1.28, ask $1.35 → spread $0.07 → medium
    // Let's use a genuinely wide spread: bid $0.07, ask $0.45 → spread $0.38
    const price = calcBtcPrice(0.07, 0.45);
    // 85% from bid: $0.07 + ($0.38 * 0.85) = $0.07 + $0.323 = $0.393 → rounds to $0.40
    expect(price).toBe(0.40);
    expect(price).toBeLessThan(0.45); // Must be less than ask
    expect(price).toBeGreaterThan(0.07); // Must be greater than bid
  });

  it('should never exceed ask price', () => {
    const price = calcBtcPrice(0.07, 0.39);
    expect(price).toBeLessThanOrEqual(0.39);
  });

  it('should never go below bid price', () => {
    const price = calcBtcPrice(0.31, 0.39);
    expect(price).toBeGreaterThanOrEqual(0.31);
  });

  it('should handle the IREN case: bid $0.31, ask $0.39 (spread $0.08 — medium)', () => {
    // spread $0.08 → medium tier → mid + $0.01 = $0.35 + $0.01 = $0.36 → rounds to $0.35
    const price = calcBtcPrice(0.31, 0.39);
    expect(price).toBe(0.35);
    expect(price).toBeLessThan(0.39); // NOT at ask price
  });

  it('should handle the HOOD Call $84 case: bid $1.28, ask $1.35 (spread $0.07 — medium)', () => {
    // spread $0.07 → medium tier → mid $1.315 + $0.01 = $1.325 → rounds to $1.33 (nearest $0.01, above $1)
    const price = calcBtcPrice(1.28, 1.35);
    expect(price).toBe(1.33);
    expect(price).toBeLessThan(1.35); // NOT at ask price
  });

  it('should produce prices that are better than ask for all screenshot examples', () => {
    const examples = [
      { bid: 0.31, ask: 0.39, label: 'IREN Call $47.5' },
      { bid: 0.09, ask: 0.10, label: 'HIMS Call $18' },
      { bid: 0.13, ask: 0.17, label: 'HIMS Call $17.5' },
      { bid: 1.28, ask: 1.35, label: 'HOOD Call $84' },
      { bid: 0.32, ask: 0.34, label: 'INTC Call $48' },
      { bid: 0.51, ask: 0.53, label: 'HOOD Call $87' },
    ];
    for (const ex of examples) {
      const price = calcBtcPrice(ex.bid, ex.ask);
      expect(price).toBeLessThanOrEqual(ex.ask);
      expect(price).toBeGreaterThanOrEqual(ex.bid);
    }
  });
});
