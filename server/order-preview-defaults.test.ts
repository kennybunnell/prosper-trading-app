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
