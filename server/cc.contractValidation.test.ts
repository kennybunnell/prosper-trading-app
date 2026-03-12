/**
 * Unit tests for CC contract limit validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getApiCredentials: vi.fn(),
  getTastytradeAccounts: vi.fn(),
}));

vi.mock('./tastytrade', () => ({
  getTastytradeAPI: vi.fn(),
  authenticateTastytrade: vi.fn(),
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, eq: vi.fn((a, b) => ({ type: 'eq', a, b })) };
});

vi.mock('../drizzle/schema', () => ({
  users: { id: 'id', tradingMode: 'tradingMode' },
  paperTradingPositions: { userId: 'userId' },
  liquidationFlags: { userId: 'userId', symbol: 'symbol' },
}));

describe('CC Contract Limit Validation', () => {
  const mockGetPositions = vi.fn();
  const mockGetAccounts = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupMocks(positions) {
    return async () => {
      const { getApiCredentials, getDb } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const mockDb = {
        select: vi.fn().mockImplementation((fields?: any) => {
          const isLiquidationQuery = fields && typeof fields === 'object' && 'symbol' in fields;
          const mockResult = isLiquidationQuery ? [] : [{ tradingMode: 'live', id: 1 }];
          const whereResolvable = vi.fn().mockImplementation(() => {
            const p = Promise.resolve(mockResult);
            (p as any).limit = vi.fn().mockResolvedValue(mockResult);
            return p;
          });
          return {
            from: vi.fn().mockReturnValue({
              where: whereResolvable,
              limit: vi.fn().mockResolvedValue(mockResult),
            }),
          };
        }),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb);
      vi.mocked(getApiCredentials).mockResolvedValue({
        tastytradeClientSecret: 'test-secret',
        tastytradeRefreshToken: 'test-refresh',
      });
      mockGetPositions.mockResolvedValue(positions);
      mockGetAccounts.mockResolvedValue([]);
      vi.mocked(authenticateTastytrade).mockResolvedValue({
        getPositions: mockGetPositions,
        getAccounts: mockGetAccounts,
        getWorkingOrders: vi.fn().mockResolvedValue([]),
        submitOrder: vi.fn().mockResolvedValue({ orderId: 'ORDER123', status: 'Received' }),
      });
    };
  }

  it('should reject orders exceeding available contracts', async () => {
    await setupMocks([{
      'instrument-type': 'Equity', symbol: 'APLD', 'underlying-symbol': 'APLD',
      quantity: '2000', 'close-price': '10.50', 'quantity-direction': 'Long',
    }])();
    const { ccRouter } = await import('./routers-cc');
    const mockCtx = { user: { id: 1, openId: 'u', name: 'T', role: 'user' } };
    const input = {
      accountNumber: '5WV12345',
      orders: Array.from({ length: 25 }, (_, i) => ({ symbol: 'APLD', strike: 11.0 + i * 0.5, expiration: '2026-02-21', quantity: 1, price: 0.25 })),
      dryRun: true,
    };
    try {
      await ccRouter.createCaller(mockCtx).submitOrders(input);
      expect.fail('Expected error');
    } catch (error) {
      expect(error.message).toContain('Contract limit validation failed');
      expect(error.message).toContain('APLD');
    }
  });

  it('should accept orders within available contracts', async () => {
    await setupMocks([{
      'instrument-type': 'Equity', symbol: 'APLD', 'underlying-symbol': 'APLD',
      quantity: '2000', 'close-price': '10.50', 'quantity-direction': 'Long',
    }])();
    const { ccRouter } = await import('./routers-cc');
    const mockCtx = { user: { id: 1, openId: 'u', name: 'T', role: 'user' } };
    const input = {
      accountNumber: '5WV12345',
      orders: Array.from({ length: 15 }, (_, i) => ({ symbol: 'APLD', strike: 11.0 + i * 0.5, expiration: '2026-02-21', quantity: 1, price: 0.25 })),
      dryRun: true,
    };
    const result = await ccRouter.createCaller(mockCtx).submitOrders(input);
    expect(result).toHaveLength(15);
  });

  it('should account for existing short calls', async () => {
    await setupMocks([
      { 'instrument-type': 'Equity', symbol: 'APLD', 'underlying-symbol': 'APLD', quantity: '2000', 'close-price': '10.50', 'quantity-direction': 'Long' },
      { 'instrument-type': 'Equity Option', symbol: 'APLD  260221C00011000', 'underlying-symbol': 'APLD', quantity: '-10', 'quantity-direction': 'Short', 'expires-at': '2026-02-21' },
    ])();
    const { ccRouter } = await import('./routers-cc');
    const mockCtx = { user: { id: 1, openId: 'u', name: 'T', role: 'user' } };
    const input = {
      accountNumber: '5WV12345',
      orders: Array.from({ length: 15 }, (_, i) => ({ symbol: 'APLD', strike: 11.0 + i * 0.5, expiration: '2026-02-21', quantity: 1, price: 0.25 })),
      dryRun: true,
    };
    try {
      await ccRouter.createCaller(mockCtx).submitOrders(input);
      expect.fail('Expected error');
    } catch (error) {
      expect(error.message).toContain('Contract limit validation failed');
      expect(error.message).toContain('APLD');
    }
  });

  it('should validate multiple symbols independently', async () => {
    await setupMocks([
      { 'instrument-type': 'Equity', symbol: 'APLD', 'underlying-symbol': 'APLD', quantity: '2000', 'close-price': '10.50', 'quantity-direction': 'Long' },
      { 'instrument-type': 'Equity', symbol: 'NVDA', 'underlying-symbol': 'NVDA', quantity: '500', 'close-price': '850.00', 'quantity-direction': 'Long' },
    ])();
    const { ccRouter } = await import('./routers-cc');
    const mockCtx = { user: { id: 1, openId: 'u', name: 'T', role: 'user' } };
    const input = {
      accountNumber: '5WV12345',
      orders: [
        ...Array.from({ length: 15 }, (_, i) => ({ symbol: 'APLD', strike: 11.0 + i * 0.5, expiration: '2026-02-21', quantity: 1, price: 0.25 })),
        ...Array.from({ length: 10 }, (_, i) => ({ symbol: 'NVDA', strike: 900.0 + i * 5, expiration: '2026-02-21', quantity: 1, price: 5.50 })),
      ],
      dryRun: true,
    };
    try {
      await ccRouter.createCaller(mockCtx).submitOrders(input);
      expect.fail('Expected error');
    } catch (error) {
      expect(error.message).toContain('Contract limit validation failed');
      expect(error.message).toContain('NVDA');
    }
  });
});
