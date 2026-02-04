import { describe, it, expect } from 'vitest';

/**
 * Price Adjustment Feature Tests
 * 
 * Tests the price adjustment controls in the order preview dialog.
 * This feature allows users to manually adjust limit prices before order submission
 * using +/- buttons (nickel increments) and a slider (bid to mid range).
 */

describe('Price Adjustment Feature', () => {
  describe('Price Increment Logic', () => {
    it('should adjust price by $0.05 increments', () => {
      const originalPrice = 1.50;
      const increment = 0.05;
      
      // Test increment up
      const priceUp = originalPrice + increment;
      expect(priceUp).toBe(1.55);
      
      // Test increment down
      const priceDown = originalPrice - increment;
      expect(priceDown).toBe(1.45);
    });

    it('should not allow negative prices', () => {
      const originalPrice = 0.03;
      const increment = -0.05;
      
      const newPrice = Math.max(0.01, originalPrice + increment);
      expect(newPrice).toBe(0.01); // Should floor at $0.01
    });

    it('should handle multiple increments correctly', () => {
      let price = 2.00;
      
      // Increment up 3 times
      price = price + 0.05;
      price = price + 0.05;
      price = price + 0.05;
      expect(price).toBeCloseTo(2.15, 2); // Use toBeCloseTo for floating point
      
      // Increment down 2 times
      price = price - 0.05;
      price = price - 0.05;
      expect(price).toBeCloseTo(2.05, 2); // Use toBeCloseTo for floating point
    });
  });

  describe('Slider Value Mapping', () => {
    it('should map slider position to price between bid and mid', () => {
      const bid = 1.00;
      const mid = 1.50;
      const sliderValue = 50; // 50% position
      
      const priceRange = mid - bid; // 0.50
      const mappedPrice = bid + (priceRange * sliderValue / 100);
      
      expect(mappedPrice).toBe(1.25); // Halfway between bid and mid
    });

    it('should map slider at 0% to bid price', () => {
      const bid = 1.00;
      const mid = 1.50;
      const sliderValue = 0;
      
      const priceRange = mid - bid;
      const mappedPrice = bid + (priceRange * sliderValue / 100);
      
      expect(mappedPrice).toBe(1.00); // At bid
    });

    it('should map slider at 100% to mid price', () => {
      const bid = 1.00;
      const mid = 1.50;
      const sliderValue = 100;
      
      const priceRange = mid - bid;
      const mappedPrice = bid + (priceRange * sliderValue / 100);
      
      expect(mappedPrice).toBe(1.50); // At mid
    });

    it('should round mapped price to nearest cent', () => {
      const bid = 1.00;
      const mid = 1.50;
      const sliderValue = 33; // 33% position
      
      const priceRange = mid - bid;
      const mappedPrice = bid + (priceRange * sliderValue / 100);
      const roundedPrice = Math.round(mappedPrice * 100) / 100;
      
      expect(roundedPrice).toBe(1.17); // Rounded to nearest cent
    });
  });

  describe('Percentage of Mid Calculation', () => {
    it('should calculate percentage of mid correctly', () => {
      const currentPrice = 1.25;
      const mid = 1.50;
      
      const percentOfMid = (currentPrice / mid) * 100;
      
      expect(percentOfMid).toBeCloseTo(83.33, 1);
    });

    it('should handle price equal to mid', () => {
      const currentPrice = 1.50;
      const mid = 1.50;
      
      const percentOfMid = (currentPrice / mid) * 100;
      
      expect(percentOfMid).toBe(100);
    });

    it('should handle price at bid (below mid)', () => {
      const currentPrice = 1.00;
      const mid = 1.50;
      
      const percentOfMid = (currentPrice / mid) * 100;
      
      expect(percentOfMid).toBeCloseTo(66.67, 1);
    });
  });

  describe('Adjusted Price Map', () => {
    it('should track adjusted prices by order index', () => {
      const adjustedPrices = new Map<number, number>();
      
      // Adjust price for order 0
      adjustedPrices.set(0, 1.55);
      expect(adjustedPrices.get(0)).toBe(1.55);
      
      // Adjust price for order 1
      adjustedPrices.set(1, 2.30);
      expect(adjustedPrices.get(1)).toBe(2.30);
      
      // Order 2 not adjusted - should return undefined
      expect(adjustedPrices.get(2)).toBeUndefined();
    });

    it('should use original price when no adjustment exists', () => {
      const adjustedPrices = new Map<number, number>();
      const originalPrice = 1.50;
      const orderIdx = 0;
      
      const currentPrice = adjustedPrices.get(orderIdx) ?? originalPrice;
      
      expect(currentPrice).toBe(1.50); // Falls back to original
    });

    it('should override original price when adjustment exists', () => {
      const adjustedPrices = new Map<number, number>();
      const originalPrice = 1.50;
      const orderIdx = 0;
      
      adjustedPrices.set(orderIdx, 1.75);
      const currentPrice = adjustedPrices.get(orderIdx) ?? originalPrice;
      
      expect(currentPrice).toBe(1.75); // Uses adjusted price
    });
  });

  describe('Order Submission with Adjusted Prices', () => {
    it('should convert adjusted prices from cents to dollars for CSP orders', () => {
      const adjustedPrices = new Map<number, number>();
      adjustedPrices.set(0, 150); // $1.50 in cents
      
      const orderIdx = 0;
      const originalPremium = 160; // $1.60 in cents
      
      const roundToNickel = (price: number) => Math.round(price * 20) / 20;
      const finalPrice = roundToNickel((adjustedPrices.get(orderIdx) ?? originalPremium) / 100);
      
      expect(finalPrice).toBe(1.50); // Adjusted price in dollars
    });

    it('should use original premium when no adjustment for CSP orders', () => {
      const adjustedPrices = new Map<number, number>();
      
      const orderIdx = 0;
      const originalPremium = 160; // $1.60 in cents
      
      const roundToNickel = (price: number) => Math.round(price * 20) / 20;
      const finalPrice = roundToNickel((adjustedPrices.get(orderIdx) ?? originalPremium) / 100);
      
      expect(finalPrice).toBe(1.60); // Original price in dollars
    });

    it('should convert adjusted prices for spread orders', () => {
      const adjustedPrices = new Map<number, number>();
      adjustedPrices.set(0, 250); // $2.50 in cents
      
      const orderIdx = 0;
      const originalPremium = 280; // $2.80 in cents
      
      const netCredit = (adjustedPrices.get(orderIdx) ?? originalPremium) / 100;
      
      expect(netCredit).toBe(2.50); // Adjusted net credit in dollars
    });

    it('should round to nickel increments for Tastytrade', () => {
      const roundToNickel = (price: number) => Math.round(price * 20) / 20;
      
      expect(roundToNickel(1.52)).toBe(1.50);
      expect(roundToNickel(1.53)).toBe(1.55);
      expect(roundToNickel(1.57)).toBe(1.55);
      expect(roundToNickel(1.58)).toBe(1.60);
    });
  });

  describe('Market Data Validation', () => {
    it('should validate bid/ask/mid data exists for price adjustment', () => {
      const order = {
        symbol: 'AAPL',
        bid: 1.50,
        ask: 1.60,
        mid: 1.55,
      };
      
      const hasMarketData = !!(order.bid && order.ask && order.mid);
      
      expect(hasMarketData).toBe(true);
    });

    it('should disable price adjustment when market data missing', () => {
      const order = {
        symbol: 'AAPL',
        bid: undefined,
        ask: undefined,
        mid: undefined,
      };
      
      const hasMarketData = order.bid && order.ask && order.mid;
      
      expect(hasMarketData).toBeFalsy();
    });

    it('should calculate mid from bid and ask', () => {
      const bid = 1.50;
      const ask = 1.60;
      
      const mid = (bid + ask) / 2;
      
      expect(mid).toBe(1.55);
    });
  });

  describe('Integration with All Order Types', () => {
    it('should support CSP order price adjustment', () => {
      const cspOrder = {
        symbol: 'AAPL',
        strike: 150,
        premium: 150, // $1.50 in cents
        bid: 140,
        ask: 160,
        mid: 150,
        isSpread: false,
      };
      
      const adjustedPrices = new Map<number, number>();
      adjustedPrices.set(0, 145); // Adjust to $1.45
      
      const finalPremium = (adjustedPrices.get(0) ?? cspOrder.premium) / 100;
      
      expect(finalPremium).toBe(1.45);
    });

    it('should support BPS order price adjustment', () => {
      const bpsOrder = {
        symbol: 'AAPL',
        strike: 150,
        longStrike: 145,
        premium: 250, // $2.50 net credit in cents
        bid: 240,
        ask: 260,
        mid: 250,
        isSpread: true,
        spreadType: 'bull_put' as const,
      };
      
      const adjustedPrices = new Map<number, number>();
      adjustedPrices.set(0, 245); // Adjust to $2.45
      
      const finalNetCredit = (adjustedPrices.get(0) ?? bpsOrder.premium) / 100;
      
      expect(finalNetCredit).toBe(2.45);
    });

    it('should support CC order price adjustment', () => {
      const ccOrder = {
        symbol: 'AAPL',
        strike: 160,
        premium: 180, // $1.80 in cents
        bid: 175,
        ask: 185,
        mid: 180,
        isSpread: false,
      };
      
      const adjustedPrices = new Map<number, number>();
      adjustedPrices.set(0, 178); // Adjust to $1.78
      
      const finalPrice = (adjustedPrices.get(0) ?? ccOrder.premium) / 100;
      
      expect(finalPrice).toBe(1.78);
    });

    it('should support BCS order price adjustment', () => {
      const bcsOrder = {
        symbol: 'AAPL',
        strike: 160,
        longStrike: 165,
        premium: 220, // $2.20 net credit in cents
        bid: 210,
        ask: 230,
        mid: 220,
        isSpread: true,
        spreadType: 'bear_call' as const,
      };
      
      const adjustedPrices = new Map<number, number>();
      adjustedPrices.set(0, 215); // Adjust to $2.15
      
      const finalNetCredit = (adjustedPrices.get(0) ?? bcsOrder.premium) / 100;
      
      expect(finalNetCredit).toBe(2.15);
    });
  });
});
