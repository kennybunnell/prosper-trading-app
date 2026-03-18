import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './routers';
import type { Context } from './_core/context';

// Mock Tastytrade API - shared mock object so tests can configure it
const sharedMockAPI = {
  login: vi.fn(),
  getAccounts: vi.fn().mockResolvedValue([]),
  getLiveOrders: vi.fn(),
  getOptionQuotesBatch: vi.fn(),
  cancelOrder: vi.fn(),
  cancelReplaceOrder: vi.fn(),
};
vi.mock('./tastytrade', () => ({
  getTastytradeAPI: vi.fn(() => sharedMockAPI),
}));

// Mock database functions
vi.mock('./db', () => ({
  getApiCredentials: vi.fn(() => ({
    tastytradeClientSecret: 'test-client-secret',
    tastytradeRefreshToken: 'test-refresh-token',
  })),
  getTastytradeAccounts: vi.fn(() => [
    { accountId: '5WZ77313', accountNumber: '5WZ77313', nickname: 'Main Cash Account' },
  ]),
  getReplacementCounts: vi.fn(() => new Map<string, number>()),
  getFillRateAnalytics: vi.fn(() => ({ totalOrders: 0, filledOrders: 0, fillRate: 0, avgFillTime: 0 })),
  recordOrderSubmission: vi.fn(),
  recordOrderCanceled: vi.fn(),
  getStuckOrders: vi.fn(() => []),
}));

// Mock pricing utils
vi.mock('./working-orders-utils', () => ({
  calculateSmartFillPrice: vi.fn((quote, currentPrice, minutesWorking, aggressiveFillMode, action) => {
    const mid = (quote.bid + quote.ask) / 2;
    return {
      suggestedPrice: aggressiveFillMode ? mid - 0.02 : mid - 0.01,
      strategy: 'Mid - $0.01',
      needsReplacement: Math.abs(currentPrice - mid) > 0.05,
    };
  }),
  // Pass-through in unit tests (tick snapping is tested separately in working-orders-utils tests)
  roundToTickSize: vi.fn((price: number) => price),
  calculateMinutesWorking: vi.fn(() => 60),
  formatTimeWorking: vi.fn((m) => m + " min"),
  isMarketOpen: vi.fn(() => true),
  isSafeToReplace: vi.fn(() => true),
  isSafeToReplaceOrders: vi.fn(() => true),
  getMarketStatus: vi.fn(() => 'Open'),
}));

describe('Working Orders Router', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let mockContext: Context;

  beforeEach(() => {
    mockContext = {
      user: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', role: 'user' },
      req: {} as any,
      res: {} as any,
    };
    caller = appRouter.createCaller(mockContext);
  });

  describe('getWorkingOrders', () => {
    it('should fetch and process working orders with smart pricing', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();
      
      // Mock live orders response
      vi.mocked(mockAPI.getLiveOrders).mockResolvedValue([
        {
          id: 'order-1',
          'account-number': '5WZ77313',
          'underlying-symbol': 'SPY',
          'order-type': 'Limit',
          price: 1.50,
          'time-in-force': 'GTC',
          'created-at': new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          legs: [
            {
              'instrument-type': 'Equity Option',
              symbol: 'SPY  260117P00580000',
              action: 'Buy to Close',
              quantity: 2,
              'strike-price': 580,
              'expiration-date': '2026-01-17',
              'option-type': 'P',
            },
          ],
        },
      ]);

      // Mock quotes response
      vi.mocked(mockAPI.getOptionQuotesBatch).mockResolvedValue({
        'SPY  260117P00580000': {
          bid: 1.45,
          ask: 1.55,
          mid: 1.50,
          last: 1.52,
        },
      });

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: '5WZ77313',
        aggressiveFillMode: false,
      });

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0]).toMatchObject({
        orderId: 'order-1',
        accountNumber: '5WZ77313',
        underlyingSymbol: 'SPY',
        optionType: 'PUT',
        strike: 580,
        quantity: 2,
        currentPrice: 1.50,
        bid: 1.45,
        ask: 1.55,
        mid: 1.50,
        timeInForce: 'GTC',
      });
      expect(result.summary.totalOrders).toBe(1);
      expect(result.summary.totalContracts).toBe(2);
      expect(result.marketStatus).toBe('Open');
      expect(result.safeToReplace).toBe(true);
    });

    it('should handle ALL_ACCOUNTS aggregation', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();
      // Mock multiple accounts via api.getAccounts (used by ALL_ACCOUNTS path)
      vi.mocked(mockAPI.getAccounts).mockResolvedValue([
        { account: { 'account-number': '5WZ77313' } },
        { account: { 'account-number': '5WI06812' } },
      ]);

      // Mock orders for each account
      vi.mocked(mockAPI.getLiveOrders).mockImplementation(async (accountId: string) => {
        if (accountId === '5WZ77313') {
          return [
            {
              id: 'order-1',
              'account-number': '5WZ77313',
              'underlying-symbol': 'SPY',
              'order-type': 'Limit',
              price: 1.50,
              'time-in-force': 'GTC',
              'created-at': new Date().toISOString(),
              legs: [
                {
                  'instrument-type': 'Equity Option',
                  symbol: 'SPY  260117P00580000',
                  action: 'Buy to Close',
                  quantity: 1,
                  'strike-price': 580,
                  'expiration-date': '2026-01-17',
                  'option-type': 'P',
                },
              ],
            },
          ];
        }
        return [
          {
            id: 'order-2',
            'account-number': '5WI06812',
            'underlying-symbol': 'AAPL',
            'order-type': 'Limit',
            price: 2.00,
            'time-in-force': 'Day',
            'created-at': new Date().toISOString(),
            legs: [
              {
                'instrument-type': 'Equity Option',
                symbol: 'AAPL 260117C00200000',
                action: 'Buy to Close',
                quantity: 1,
                'strike-price': 200,
                'expiration-date': '2026-01-17',
                'option-type': 'C',
              },
            ],
          },
        ];
      });

      vi.mocked(mockAPI.getOptionQuotesBatch).mockResolvedValue({
        'SPY  260117P00580000': { bid: 1.45, ask: 1.55, mid: 1.50, last: 1.52 },
        'AAPL 260117C00200000': { bid: 1.95, ask: 2.05, mid: 2.00, last: 2.02 },
      });

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: 'ALL_ACCOUNTS',
        aggressiveFillMode: false,
      });

      expect(result.orders).toHaveLength(2);
      expect(result.summary.totalOrders).toBe(2);
      expect(result.orders.some(o => o.accountNumber === '5WZ77313')).toBe(true);
      expect(result.orders.some(o => o.accountNumber === '5WI06812')).toBe(true);
    });

    it('should apply aggressive fill mode pricing', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();

      vi.mocked(mockAPI.getLiveOrders).mockResolvedValue([
        {
          id: 'order-1',
          'account-number': '5WZ77313',
          'underlying-symbol': 'SPY',
          'order-type': 'Limit',
          price: 1.50,
          'time-in-force': 'GTC',
          'created-at': new Date().toISOString(),
          legs: [
            {
              'instrument-type': 'Equity Option',
              symbol: 'SPY  260117P00580000',
              action: 'Buy to Close',
              quantity: 1,
              'strike-price': 580,
              'expiration-date': '2026-01-17',
              'option-type': 'P',
            },
          ],
        },
      ]);

      vi.mocked(mockAPI.getOptionQuotesBatch).mockResolvedValue({
        'SPY  260117P00580000': { bid: 1.45, ask: 1.55, mid: 1.50, last: 1.52 },
      });

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: '5WZ77313',
        aggressiveFillMode: true,
      });

      // With aggressive mode, suggested price should be lower (mid - 0.02 instead of mid - 0.01)
      expect(result.orders[0].suggestedPrice).toBeLessThan(1.50);
    });

    it('should calculate summary metrics correctly', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();

      vi.mocked(mockAPI.getLiveOrders).mockResolvedValue([
        {
          id: 'order-1',
          'account-number': '5WZ77313',
          'underlying-symbol': 'SPY',
          'order-type': 'Limit',
          price: 1.50,
          'time-in-force': 'GTC',
          'created-at': new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
          legs: [
            {
              'instrument-type': 'Equity Option',
              symbol: 'SPY  260117P00580000',
              action: 'Buy to Close',
              quantity: 3,
              'strike-price': 580,
              'expiration-date': '2026-01-17',
              'option-type': 'P',
            },
          ],
        },
        {
          id: 'order-2',
          'account-number': '5WZ77313',
          'underlying-symbol': 'AAPL',
          'order-type': 'Limit',
          price: 2.00,
          'time-in-force': 'Day',
          'created-at': new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
          legs: [
            {
              'instrument-type': 'Equity Option',
              symbol: 'AAPL 260117C00200000',
              action: 'Buy to Close',
              quantity: 2,
              'strike-price': 200,
              'expiration-date': '2026-01-17',
              'option-type': 'C',
            },
          ],
        },
      ]);

      vi.mocked(mockAPI.getOptionQuotesBatch).mockResolvedValue({
        'SPY  260117P00580000': { bid: 1.45, ask: 1.55, mid: 1.50, last: 1.52 },
        'AAPL 260117C00200000': { bid: 1.95, ask: 2.05, mid: 2.00, last: 2.02 },
      });

      const result = await caller.workingOrders.getWorkingOrders({
        accountId: '5WZ77313',
        aggressiveFillMode: false,
      });

      expect(result.summary.totalOrders).toBe(2);
      expect(result.summary.totalContracts).toBe(5); // 3 + 2
      expect(result.summary.avgMinutesWorking).toBeGreaterThan(0);
    });
  });

  describe('cancelOrders', () => {
    it('should cancel selected orders', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();

      vi.mocked(mockAPI.cancelOrder).mockResolvedValue(undefined);

      const result = await caller.workingOrders.cancelOrders({
        orders: [
          {
            orderId: 'order-1',
            accountNumber: '5WZ77313',
            symbol: 'SPY  260117P00580000',
          },
        ],
      });

      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
    });

    it('should handle cancellation errors', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();

      vi.mocked(mockAPI.cancelOrder).mockRejectedValue(new Error('Order not found'));

      const result = await caller.workingOrders.cancelOrders({
        orders: [
          {
            orderId: 'invalid-order',
            accountNumber: '5WZ77313',
            symbol: 'SPY  260117P00580000',
          },
        ],
      });

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].message).toContain('Order not found');
    });
  });

  describe('replaceOrders', () => {
    it('should replace orders with suggested prices', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();

      vi.mocked(mockAPI.cancelReplaceOrder).mockResolvedValue({
        success: true,
        orderId: 'new-order-id',
        message: 'Order replaced successfully',
      });

      const result = await caller.workingOrders.replaceOrders({
        orders: [
          {
            orderId: 'order-1',
            accountNumber: '5WZ77313',
            symbol: 'SPY  260117P00580000',
            suggestedPrice: 1.49,
            rawOrder: {
              price: '1.50',
              'underlying-symbol': 'SPY',
              'time-in-force': 'GTC',
              legs: [
                {
                  'instrument-type': 'Equity Option',
                  symbol: 'SPY  260117P00580000',
                  quantity: '2',
                  action: 'Buy to Close',
                },
              ],
            },
          },
        ],
      });

      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.results[0].success).toBe(true);
    });

    it('should handle replacement errors', async () => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const mockAPI = getTastytradeAPI();

      vi.mocked(mockAPI.cancelReplaceOrder).mockResolvedValue({
        success: false,
        message: 'Insufficient buying power',
      });

      const result = await caller.workingOrders.replaceOrders({
        orders: [
          {
            orderId: 'order-1',
            accountNumber: '5WZ77313',
            symbol: 'SPY  260117P00580000',
            suggestedPrice: 1.49,
            rawOrder: {
              price: '1.50',
              'underlying-symbol': 'SPY',
              'time-in-force': 'GTC',
              legs: [
                {
                  'instrument-type': 'Equity Option',
                  symbol: 'SPY  260117P00580000',
                  quantity: '2',
                  action: 'Buy to Close',
                },
              ],
            },
          },
        ],
      });

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.results[0].message).toContain('Insufficient buying power');
    });
  });
});
