/**
 * Unit tests for the symmetric slider range logic used in UnifiedOrderPreviewModal.
 * These tests verify that mid price always maps to ~50% slider position.
 */
import { describe, it, expect } from "vitest";

// Mirror the getOrderPriceRange logic from UnifiedOrderPreviewModal
function getOrderPriceRange(order: {
  bid?: number;
  ask?: number;
  premium: number;
  longStrike?: number;
}) {
  const symmetricRange = (mid: number, halfRange: number) => ({
    minPrice: Math.max(0.01, mid - halfRange),
    maxPrice: mid + halfRange,
    midPrice: mid,
  });

  if (!order.bid || !order.ask) {
    const mid = Math.max(0.01, order.premium);
    return symmetricRange(mid, Math.max(mid * 0.5, 0.25));
  }

  if (order.longStrike) {
    const mid = order.premium > 0 ? order.premium : Math.max(0.01, (order.bid + order.ask) / 2);
    return symmetricRange(mid, Math.max(mid * 0.6, 0.25));
  }

  const mid = (order.bid + order.ask) / 2;
  const halfSpread = Math.max((order.ask - order.bid) / 2, 0.05);
  return symmetricRange(mid, halfSpread * 2);
}

function getSliderPosition(order: { bid?: number; ask?: number; premium: number; longStrike?: number }, currentPrice: number): number {
  const { minPrice, maxPrice } = getOrderPriceRange(order);
  const priceRange = maxPrice - minPrice;
  if (priceRange === 0) return 50;
  const position = ((currentPrice - minPrice) / priceRange) * 100;
  return Math.max(0, Math.min(100, position));
}

describe("Symmetric slider range — mid always at 50%", () => {
  it("Single-leg CSP: mid maps to exactly 50%", () => {
    const order = { bid: 3.00, ask: 3.40, premium: 3.20 };
    const { midPrice } = getOrderPriceRange(order);
    const pos = getSliderPosition(order, midPrice);
    expect(pos).toBeCloseTo(50, 0);
  });

  it("BPS spread order: mid maps to exactly 50%", () => {
    // SPX BPS: short put bid=3.14, ask=3.21; long put bid=20.60, ask=20.90
    // Net credit (premium) = 5.37
    const order = { bid: 3.14, ask: 3.21, premium: 5.37, longStrike: 6525 };
    const { midPrice } = getOrderPriceRange(order);
    const pos = getSliderPosition(order, midPrice);
    expect(pos).toBeCloseTo(50, 0);
  });

  it("XSP spread order: mid maps to exactly 50%", () => {
    const order = { bid: 2.27, ask: 2.39, premium: 3.20, longStrike: 665 };
    const { midPrice } = getOrderPriceRange(order);
    const pos = getSliderPosition(order, midPrice);
    expect(pos).toBeCloseTo(50, 0);
  });

  it("No live quote fallback: premium maps to exactly 50%", () => {
    const order = { premium: 5.70 };
    const { midPrice } = getOrderPriceRange(order);
    const pos = getSliderPosition(order, midPrice);
    expect(pos).toBeCloseTo(50, 0);
  });

  it("Reset to mid: slider shows Good Fill Zone (42-65%)", () => {
    const order = { bid: 3.00, ask: 3.40, premium: 3.20 };
    const { midPrice } = getOrderPriceRange(order);
    const pos = getSliderPosition(order, midPrice);
    // Good Fill Zone is 42-65%
    expect(pos).toBeGreaterThanOrEqual(42);
    expect(pos).toBeLessThanOrEqual(65);
  });

  it("BPS spread reset to mid: slider shows Good Fill Zone (42-65%)", () => {
    const order = { bid: 3.14, ask: 3.21, premium: 5.37, longStrike: 6525 };
    const { midPrice } = getOrderPriceRange(order);
    const pos = getSliderPosition(order, midPrice);
    expect(pos).toBeGreaterThanOrEqual(42);
    expect(pos).toBeLessThanOrEqual(65);
  });

  it("Range is always positive (minPrice < maxPrice)", () => {
    const orders = [
      { bid: 3.14, ask: 3.21, premium: 5.37, longStrike: 6525 },
      { bid: 0.75, ask: 0.80, premium: 0.75 },
      { premium: 13.90, longStrike: 6750 },
      { bid: 26.10, ask: 26.30, premium: 26.20 },
    ];
    orders.forEach(order => {
      const { minPrice, maxPrice } = getOrderPriceRange(order);
      expect(minPrice).toBeGreaterThan(0);
      expect(maxPrice).toBeGreaterThan(minPrice);
    });
  });
});
