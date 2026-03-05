/**
 * Tests for multi-leg spread detection in Working Orders:
 * - BPS (Bull Put Spread): 2-leg, both PUTs
 * - BCS (Bear Call Spread): 2-leg, both CALLs
 * - IC  (Iron Condor):     4-leg, 2 PUTs + 2 CALLs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './routers';
import type { Context } from './_core/context';

// ── Singleton mock API (shared between test and router) ────────────────────────
const mockAPI = {
  login: vi.fn(),
  getAccounts: vi.fn().mockResolvedValue([]),
  getLiveOrders: vi.fn(),
  getOptionQuotesBatch: vi.fn(),
  cancelOrder: vi.fn(),
  cancelReplaceOrder: vi.fn(),
  submitOrder: vi.fn(),
};

vi.mock('./tastytrade', () => ({
  getTastytradeAPI: vi.fn(() => mockAPI),
}));

vi.mock('./db', () => ({
  getApiCredentials: vi.fn(() => ({
    tastytradeUsername: 'test_user',
    tastytradePassword: 'test_pass',
  })),
  getTastytradeAccounts: vi.fn(() => [
    { accountId: 'TEST01', accountNumber: 'TEST01', nickname: 'Test Account' },
  ]),
  recordOrderSubmission: vi.fn(),
  getOrderReplacementCount: vi.fn(() => 0),
}));

vi.mock('./lib/working-orders-utils', () => ({
  calculateSmartFillPrice: vi.fn((_order: any, quote: any, _aggressive: boolean) => ({
    suggestedPrice: (quote.bid + quote.ask) / 2,
    strategy: 'Mid',
    needsReplacement: false,
  })),
  calculateMinutesWorking: vi.fn(() => 30),
  formatTimeWorking: vi.fn(() => '30m'),
  getMarketStatus: vi.fn(() => 'Open'),
  isSafeToReplaceOrders: vi.fn(() => true),
  isMarketOpen: vi.fn(() => true),
  isSafeToReplace: vi.fn(() => true),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeOrder(id: string, price: string, priceEffect: string, legs: any[]) {
  return {
    id,
    'account-number': 'TEST01',
    price,
    'price-effect': priceEffect,
    'time-in-force': 'GTC',
    status: 'Live',
    'received-at': new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    legs,
  };
}

function makeLeg(symbol: string, action: string, quantity = 1) {
  return { symbol, action, quantity: String(quantity) };
}

function makeQuotesMap(entries: Array<{ symbol: string; bid: number; ask: number }>): Record<string, any> {
  const map: Record<string, any> = {};
  for (const e of entries) {
    map[e.symbol] = { bid: e.bid, ask: e.ask, mid: (e.bid + e.ask) / 2, last: e.bid };
  }
  return map;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Working Orders — Multi-Leg Spread Detection', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI.getAccounts.mockResolvedValue([]);
    const ctx: Context = {
      user: { id: 'u1', name: 'Test', email: 't@t.com', role: 'user' },
      req: {} as any,
      res: {} as any,
    };
    caller = appRouter.createCaller(ctx);
  });

  // ── BPS ──────────────────────────────────────────────────────────────────────

  describe('Bull Put Spread (BPS) — 2 legs, both PUTs', () => {
    it('detects spreadType = bull_put', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bps-1', '0.35', 'Debit', [
          makeLeg('SPY   260321P00560000', 'Buy to Close'),
          makeLeg('SPY   260321P00555000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPY   260321P00560000', bid: 0.40, ask: 0.50 },
        { symbol: 'SPY   260321P00555000', bid: 0.10, ask: 0.15 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      expect(result.orders).toHaveLength(1);
      const order = result.orders[0];
      expect(order.isSpread).toBe(true);
      expect(order.spreadType).toBe('bull_put');
    });

    it('populates spreadLegs with 2 entries', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bps-2', '0.35', 'Debit', [
          makeLeg('SPY   260321P00560000', 'Buy to Close'),
          makeLeg('SPY   260321P00555000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPY   260321P00560000', bid: 0.40, ask: 0.50 },
        { symbol: 'SPY   260321P00555000', bid: 0.10, ask: 0.15 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.spreadLegs).toHaveLength(2);

      const btcLeg = order.spreadLegs!.find((l: any) => l.action === 'Buy to Close');
      const stcLeg = order.spreadLegs!.find((l: any) => l.action === 'Sell to Close');

      expect(btcLeg).toBeDefined();
      expect(btcLeg!.optionType).toBe('PUT');
      expect(btcLeg!.strike).toBe(560);
      expect(btcLeg!.bid).toBe(0.40);
      expect(btcLeg!.ask).toBe(0.50);
      expect(btcLeg!.mid).toBeCloseTo(0.45);

      expect(stcLeg).toBeDefined();
      expect(stcLeg!.optionType).toBe('PUT');
      expect(stcLeg!.strike).toBe(555);
    });

    it('computes net bid/ask correctly (BTC ask − STC bid)', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bps-3', '0.35', 'Debit', [
          makeLeg('SPY   260321P00560000', 'Buy to Close'),
          makeLeg('SPY   260321P00555000', 'Sell to Close'),
        ]),
      ]);
      // netBid = max(0, btcBid - stcAsk) = max(0, 0.40 - 0.15) = 0.25
      // netAsk = max(0, btcAsk - stcBid) = max(0, 0.50 - 0.10) = 0.40
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPY   260321P00560000', bid: 0.40, ask: 0.50 },
        { symbol: 'SPY   260321P00555000', bid: 0.10, ask: 0.15 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.bid).toBeCloseTo(0.25, 2);
      expect(order.ask).toBeCloseTo(0.40, 2);
      expect(order.mid).toBeCloseTo(0.325, 2);
    });

    it('sets short put as primary strike (higher) and longStrike as lower', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bps-4', '0.35', 'Debit', [
          makeLeg('SPY   260321P00560000', 'Buy to Close'),
          makeLeg('SPY   260321P00555000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPY   260321P00560000', bid: 0.40, ask: 0.50 },
        { symbol: 'SPY   260321P00555000', bid: 0.10, ask: 0.15 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.strike).toBe(560);
      expect(order.longStrike).toBe(555);
    });
  });

  // ── BCS ──────────────────────────────────────────────────────────────────────

  describe('Bear Call Spread (BCS) — 2 legs, both CALLs', () => {
    it('detects spreadType = bear_call', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bcs-1', '0.30', 'Debit', [
          makeLeg('AAPL  260321C00220000', 'Buy to Close'),
          makeLeg('AAPL  260321C00225000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'AAPL  260321C00220000', bid: 0.35, ask: 0.45 },
        { symbol: 'AAPL  260321C00225000', bid: 0.08, ask: 0.12 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      expect(result.orders).toHaveLength(1);
      const order = result.orders[0];
      expect(order.isSpread).toBe(true);
      expect(order.spreadType).toBe('bear_call');
    });

    it('populates spreadLegs with 2 CALL entries', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bcs-2', '0.30', 'Debit', [
          makeLeg('AAPL  260321C00220000', 'Buy to Close'),
          makeLeg('AAPL  260321C00225000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'AAPL  260321C00220000', bid: 0.35, ask: 0.45 },
        { symbol: 'AAPL  260321C00225000', bid: 0.08, ask: 0.12 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.spreadLegs).toHaveLength(2);
      order.spreadLegs!.forEach((l: any) => expect(l.optionType).toBe('CALL'));
    });

    it('sets short call as primary strike (lower) and longStrike as higher', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('bcs-3', '0.30', 'Debit', [
          makeLeg('AAPL  260321C00220000', 'Buy to Close'),
          makeLeg('AAPL  260321C00225000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'AAPL  260321C00220000', bid: 0.35, ask: 0.45 },
        { symbol: 'AAPL  260321C00225000', bid: 0.08, ask: 0.12 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.strike).toBe(220);
      expect(order.longStrike).toBe(225);
    });
  });

  // ── IC ───────────────────────────────────────────────────────────────────────

  describe('Iron Condor (IC) — 4 legs, 2 PUTs + 2 CALLs', () => {
    it('detects spreadType = iron_condor', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('ic-1', '0.60', 'Debit', [
          makeLeg('SPX   260321P05500000', 'Buy to Close'),
          makeLeg('SPX   260321P05450000', 'Sell to Close'),
          makeLeg('SPX   260321C05700000', 'Buy to Close'),
          makeLeg('SPX   260321C05750000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPX   260321P05500000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321P05450000', bid: 0.05, ask: 0.10 },
        { symbol: 'SPX   260321C05700000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321C05750000', bid: 0.05, ask: 0.10 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      expect(result.orders).toHaveLength(1);
      const order = result.orders[0];
      expect(order.isSpread).toBe(true);
      expect(order.spreadType).toBe('iron_condor');
    });

    it('populates spreadLegs with 4 entries (2 PUTs + 2 CALLs)', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('ic-2', '0.60', 'Debit', [
          makeLeg('SPX   260321P05500000', 'Buy to Close'),
          makeLeg('SPX   260321P05450000', 'Sell to Close'),
          makeLeg('SPX   260321C05700000', 'Buy to Close'),
          makeLeg('SPX   260321C05750000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPX   260321P05500000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321P05450000', bid: 0.05, ask: 0.10 },
        { symbol: 'SPX   260321C05700000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321C05750000', bid: 0.05, ask: 0.10 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.spreadLegs).toHaveLength(4);

      const puts = order.spreadLegs!.filter((l: any) => l.optionType === 'PUT');
      const calls = order.spreadLegs!.filter((l: any) => l.optionType === 'CALL');
      expect(puts).toHaveLength(2);
      expect(calls).toHaveLength(2);
    });

    it('computes net bid/ask across all 4 legs', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('ic-3', '0.60', 'Debit', [
          makeLeg('SPX   260321P05500000', 'Buy to Close'),
          makeLeg('SPX   260321P05450000', 'Sell to Close'),
          makeLeg('SPX   260321C05700000', 'Buy to Close'),
          makeLeg('SPX   260321C05750000', 'Sell to Close'),
        ]),
      ]);
      // BTC legs: P5500 ask=0.40, C5700 ask=0.40 → sumBtcAsk = 0.80
      // STC legs: P5450 bid=0.05, C5750 bid=0.05 → sumStcBid = 0.10
      // netAsk = 0.80 - 0.10 = 0.70
      // BTC bids: P5500 bid=0.30, C5700 bid=0.30 → sumBtcBid = 0.60
      // STC asks: P5450 ask=0.10, C5750 ask=0.10 → sumStcAsk = 0.20
      // netBid = 0.60 - 0.20 = 0.40
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPX   260321P05500000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321P05450000', bid: 0.05, ask: 0.10 },
        { symbol: 'SPX   260321C05700000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321C05750000', bid: 0.05, ask: 0.10 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.bid).toBeCloseTo(0.40, 2);
      expect(order.ask).toBeCloseTo(0.70, 2);
      expect(order.mid).toBeCloseTo(0.55, 2);
    });

    it('each leg has correct bid/ask populated from quotes', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('ic-4', '0.60', 'Debit', [
          makeLeg('SPX   260321P05500000', 'Buy to Close'),
          makeLeg('SPX   260321P05450000', 'Sell to Close'),
          makeLeg('SPX   260321C05700000', 'Buy to Close'),
          makeLeg('SPX   260321C05750000', 'Sell to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPX   260321P05500000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321P05450000', bid: 0.05, ask: 0.10 },
        { symbol: 'SPX   260321C05700000', bid: 0.30, ask: 0.40 },
        { symbol: 'SPX   260321C05750000', bid: 0.05, ask: 0.10 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      const shortPut = order.spreadLegs!.find((l: any) => l.optionType === 'PUT' && l.action === 'Buy to Close');
      expect(shortPut!.bid).toBe(0.30);
      expect(shortPut!.ask).toBe(0.40);
      expect(shortPut!.mid).toBeCloseTo(0.35);

      const longCall = order.spreadLegs!.find((l: any) => l.optionType === 'CALL' && l.action === 'Sell to Close');
      expect(longCall!.bid).toBe(0.05);
      expect(longCall!.ask).toBe(0.10);
    });
  });

  // ── Single-leg ────────────────────────────────────────────────────────────────

  describe('Single-leg order — no spread detection', () => {
    it('does not set isSpread for a single-leg BTC order', async () => {
      mockAPI.getLiveOrders.mockResolvedValue([
        makeOrder('single-1', '1.50', 'Debit', [
          makeLeg('SPY   260321P00560000', 'Buy to Close'),
        ]),
      ]);
      mockAPI.getOptionQuotesBatch.mockResolvedValue(makeQuotesMap([
        { symbol: 'SPY   260321P00560000', bid: 1.45, ask: 1.55 },
      ]));

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'TEST01',
        aggressiveFillMode: false,
      });

      const order = result.orders[0];
      expect(order.isSpread).toBe(false);
      expect(order.spreadLegs).toBeUndefined();
      expect(order.spreadType).toBeUndefined();
    });
  });
});
