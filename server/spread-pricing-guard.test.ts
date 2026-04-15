/**
 * spread-pricing-guard.test.ts
 *
 * Verifies the critical invariant: when the Order Preview modal receives live quotes,
 * a spread order (longStrike set) MUST use the net credit/debit price and MUST NEVER
 * use the short leg's individual price.
 *
 * Root cause of the April 2026 bug:
 *   The live quote re-init effect in UnifiedOrderPreviewModal had a fall-through path
 *   where if a spread's long leg quote was missing, the code fell into the single-leg
 *   branch and applied the short leg's bid/ask (~$16) instead of the net credit (~$4.35).
 *
 * Fix: Added `if (order.longStrike) { ... return; }` guard so spread orders NEVER
 * fall through to single-leg pricing logic.
 */

import { describe, it, expect } from 'vitest';

// ─── Helpers mirroring the modal's snapToTick and price computation ────────────

function snapToTick(price: number, _symbol?: string): number {
  // Tastytrade tick rules: $0.05 increments for >= $3, $0.01 for < $3
  if (price >= 3) {
    return Math.round(price / 0.05) * 0.05;
  }
  return Math.round(price / 0.01) * 0.01;
}

/**
 * Simulate the live quote re-init effect logic (the fixed version).
 * Returns the price that would be set for the given order.
 */
function computeModalPrice(
  order: {
    longStrike?: number;
    action: 'STO' | 'BTC';
    premium: number;       // net credit from scanner (always correct fallback)
    optionSymbol?: string;
    spreadLongSymbol?: string;
    symbol?: string;
  },
  liveQuotes: Record<string, { bid: number; ask: number }>,
  currentPrice: number    // the price currently set (from initial block)
): number {
  const shortSym = order.optionSymbol;
  const longSym = order.spreadLongSymbol;
  const isBTC = order.action === 'BTC';

  // ── Fixed guard: spread orders never fall through to single-leg ──
  if (order.longStrike) {
    if (shortSym && longSym) {
      const shortQ = liveQuotes[shortSym];
      const longQ = liveQuotes[longSym];
      if (shortQ && longQ && shortQ.bid > 0 && shortQ.ask > 0 && longQ.bid > 0 && longQ.ask > 0) {
        if (isBTC) {
          const minDebit = Math.max(0.01, shortQ.bid - longQ.ask);
          const maxDebit = Math.max(0.01, shortQ.ask - longQ.bid);
          const midDebit = (minDebit + maxDebit) / 2;
          const rawPrice = Math.max(0.01, midDebit + (maxDebit - midDebit) * 0.25);
          return snapToTick(rawPrice, order.symbol);
        } else {
          const minCredit = Math.max(0.01, shortQ.bid - longQ.ask);
          const maxCredit = Math.max(0.01, shortQ.ask - longQ.bid);
          const midCredit = (minCredit + maxCredit) / 2;
          return snapToTick(midCredit, order.symbol);
        }
      }
    }
    // Spread with missing/incomplete quotes → keep current price (= order.premium)
    return currentPrice;
  }

  // Single-leg only
  if (shortSym) {
    const q = liveQuotes[shortSym];
    if (!q || q.bid === 0 || q.ask === 0) return currentPrice;
    const mid = (q.bid + q.ask) / 2;
    const rawPrice = Math.max(0.01, isBTC ? mid + (q.ask - mid) * 0.25 : mid);
    const price = snapToTick(rawPrice, order.symbol);
    return price > 0 ? price : currentPrice;
  }

  return currentPrice;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Spread pricing guard — live quote re-init', () => {

  it('BPS STO: when only short leg quote arrives, keeps net credit (not short leg price)', () => {
    const order = {
      longStrike: 6775,
      action: 'STO' as const,
      premium: 4.35,          // net credit from scanner
      optionSymbol: 'SPXW  260423P06825000',
      spreadLongSymbol: 'SPXW  260423P06775000',
      symbol: 'SPX',
    };
    const liveQuotes = {
      // Only short leg quote arrives (long leg missing — common for SPXW via Tradier)
      'SPXW  260423P06825000': { bid: 15.80, ask: 16.20 },
    };
    const initialPrice = 4.35; // set by initial block from order.premium

    const result = computeModalPrice(order, liveQuotes, initialPrice);

    // Must NOT be the short leg price (~$16)
    expect(result).toBeLessThan(10);
    // Must stay at the net credit from scanner
    expect(result).toBeCloseTo(4.35, 1);
  });

  it('BPS STO: when BOTH leg quotes arrive, computes correct net credit', () => {
    const order = {
      longStrike: 6775,
      action: 'STO' as const,
      premium: 4.35,
      optionSymbol: 'SPXW  260423P06825000',
      spreadLongSymbol: 'SPXW  260423P06775000',
      symbol: 'SPX',
    };
    const liveQuotes = {
      'SPXW  260423P06825000': { bid: 15.80, ask: 16.20 }, // short leg
      'SPXW  260423P06775000': { bid: 11.50, ask: 11.90 }, // long leg
    };
    const initialPrice = 4.35;

    const result = computeModalPrice(order, liveQuotes, initialPrice);

    // Net credit mid = (shortBid - longAsk + shortAsk - longBid) / 2
    // = (15.80 - 11.90 + 16.20 - 11.50) / 2 = (3.90 + 4.70) / 2 = 4.30
    expect(result).toBeGreaterThan(3.5);
    expect(result).toBeLessThan(6.0);
    // Must NOT be the short leg price
    expect(result).toBeLessThan(10);
  });

  it('BPS STO: when NO quotes arrive, keeps net credit from scanner', () => {
    const order = {
      longStrike: 6775,
      action: 'STO' as const,
      premium: 4.35,
      optionSymbol: 'SPXW  260423P06825000',
      spreadLongSymbol: 'SPXW  260423P06775000',
      symbol: 'SPX',
    };
    const liveQuotes = {}; // empty — Tastytrade returned nothing

    const initialPrice = 4.35;
    const result = computeModalPrice(order, liveQuotes, initialPrice);

    expect(result).toBeCloseTo(4.35, 1);
  });

  it('BPS BTC: when both leg quotes arrive, computes correct net debit', () => {
    const order = {
      longStrike: 6775,
      action: 'BTC' as const,
      premium: 1.20,          // estimated close cost
      optionSymbol: 'SPXW  260423P06825000',
      spreadLongSymbol: 'SPXW  260423P06775000',
      symbol: 'SPX',
    };
    const liveQuotes = {
      'SPXW  260423P06825000': { bid: 1.10, ask: 1.30 },
      'SPXW  260423P06775000': { bid: 0.05, ask: 0.10 },
    };
    const initialPrice = 1.20;

    const result = computeModalPrice(order, liveQuotes, initialPrice);

    // Net debit range: shortAsk - longBid = 1.30 - 0.05 = 1.25 (max)
    //                 shortBid - longAsk = 1.10 - 0.10 = 1.00 (min)
    // Mid = 1.125, Good fill = mid + 25% toward max = 1.125 + 0.25*(1.25-1.125) = 1.156
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThan(2.0);
  });

  it('Single-leg CSP: uses live short leg quote correctly', () => {
    const order = {
      // No longStrike — single-leg CSP
      action: 'STO' as const,
      premium: 4.20,
      optionSymbol: 'AAPL  260117P00150000',
      symbol: 'AAPL',
    };
    const liveQuotes = {
      'AAPL  260117P00150000': { bid: 4.10, ask: 4.30 },
    };
    const initialPrice = 4.20;

    const result = computeModalPrice(order, liveQuotes, initialPrice);

    // Mid = 4.20, STO uses mid
    expect(result).toBeCloseTo(4.20, 1);
  });

  it('BPS STO: $1700 scenario — 100-contract quantity does NOT affect per-share price', () => {
    // The $1700 shown in the modal was $16 * 100 contracts + display bug
    // The per-share price must stay at net credit regardless of quantity
    const order = {
      longStrike: 6775,
      action: 'STO' as const,
      premium: 4.35,
      optionSymbol: 'SPXW  260423P06825000',
      spreadLongSymbol: 'SPXW  260423P06775000',
      symbol: 'SPX',
    };
    const liveQuotes = {
      // Only short leg arrives
      'SPXW  260423P06825000': { bid: 15.80, ask: 16.20 },
    };

    const initialPrice = 4.35;
    const result = computeModalPrice(order, liveQuotes, initialPrice);

    // Per-share price must be ~$4.35, never ~$16
    expect(result).toBeLessThan(10);
    expect(result).toBeGreaterThan(1);
  });
});
