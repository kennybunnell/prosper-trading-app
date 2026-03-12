import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './routers';
import type { inferProcedureInput } from '@trpc/server';

// Mock the database and API modules
vi.mock('./db', () => ({
  getApiCredentials: vi.fn(),
}));

vi.mock('./tastytrade', () => ({
  getTastytradeAPI: vi.fn(),
  authenticateTastytrade: vi.fn(),
}));

describe('csp.validateOrders', () => {
  let caller: any;
  const mockUser = { id: '1', name: 'Test User', email: 'test@example.com', role: 'user' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a caller with mock context
    caller = appRouter.createCaller({
      user: mockUser,
      req: {} as any,
      res: {} as any,
    });
  });

  it('should validate orders with sufficient buying power', async () => {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');

    // Mock credentials
    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: '1',
      tastytradeClientSecret: 'test-client-secret',
      tastytradeRefreshToken: 'test-refresh-token',
      tradierApiKey: 'test-key',
      tradierAccountId: 'test-account',
      defaultTastytradeAccountId: 'test-account-id',
    });

    // Mock Tastytrade API
    const mockAPI = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([
        {
          accountId: 'test-account-id',
          account: {
            'account-number': 'test-account-id',
            'external-id': 'ext-123',
            'opened-at': '2024-01-01',
            'nickname': 'Test Account',
            'account-type-name': 'Individual',
            'is-firm-error': false,
            'is-firm-proprietary': false,
            'is-futures-approved': false,
            'is-closed': false,
            'day-trader-status': false,
            'margin-or-cash': 'Margin',
            'suitable-options-level': 'Approved',
          },
        },
      ]),
      getBalances: vi.fn().mockResolvedValue({
        'derivative-buying-power': 50000,
      }),
    };
    vi.mocked(authenticateTastytrade).mockResolvedValue(mockAPI as any);

    type ValidateOrdersInput = inferProcedureInput<typeof appRouter.csp.validateOrders>;
    const input: ValidateOrdersInput = {
      orders: [
        {
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-02-20',
          premium: 2.5,
          bid: 2.4,
          ask: 2.6,
          currentPrice: 155,
        },
        {
          symbol: 'MSFT',
          strike: 300,
          expiration: '2026-02-20',
          premium: 5.0,
          bid: 4.8,
          ask: 5.2,
          currentPrice: 310,
        },
      ],
      accountId: 'test-account-id',
    };

    const result = await caller.csp.validateOrders(input);

    expect(result).toBeDefined();
    expect(result.orders).toHaveLength(2);
    expect(result.totalPremium).toBeGreaterThan(0);
    expect(result.totalCollateral).toBe(45000); // (150 * 100) + (300 * 100)
    expect(result.availableBuyingPower).toBe(50000);
    expect(result.remainingBuyingPower).toBe(5000); // 50000 - 45000
    expect(result.hasInsufficientBP).toBe(false);
    
    // Check midpoint pricing
    expect(result.orders[0].premium).toBe(250); // (2.4 + 2.6) / 2 * 100
    expect(result.orders[1].premium).toBe(500); // (4.8 + 5.2) / 2 * 100
  });

  it('should detect insufficient buying power', async () => {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: '1',
      tastytradeClientSecret: 'test-client-secret',
      tastytradeRefreshToken: 'test-refresh-token',
      tradierApiKey: 'test-key',
      tradierAccountId: 'test-account',
      defaultTastytradeAccountId: 'test-account-id',
    });

    const mockAPI = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([
        {
          accountId: 'test-account-id',
          account: {
            'account-number': 'test-account-id',
            'external-id': 'ext-123',
            'opened-at': '2024-01-01',
            'nickname': 'Test Account',
            'account-type-name': 'Individual',
            'is-firm-error': false,
            'is-firm-proprietary': false,
            'is-futures-approved': false,
            'is-closed': false,
            'day-trader-status': false,
            'margin-or-cash': 'Margin',
            'suitable-options-level': 'Approved',
          },
        },
      ]),
      getBalances: vi.fn().mockResolvedValue({
        'derivative-buying-power': 10000, // Less than required collateral
      }),
    };
    vi.mocked(authenticateTastytrade).mockResolvedValue(mockAPI as any);

    type ValidateOrdersInput = inferProcedureInput<typeof appRouter.csp.validateOrders>;
    const input: ValidateOrdersInput = {
      orders: [
        {
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-02-20',
          premium: 2.5,
          bid: 2.4,
          ask: 2.6,
          currentPrice: 155,
        },
      ],
      accountId: 'test-account-id',
    };

    const result = await caller.csp.validateOrders(input);

    expect(result.hasInsufficientBP).toBe(true); // 15000 collateral > 10000 buying power
    expect(result.remainingBuyingPower).toBeLessThan(0);
  });

  it('should calculate midpoint pricing correctly', async () => {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: '1',
      tastytradeClientSecret: 'test-client-secret',
      tastytradeRefreshToken: 'test-refresh-token',
      tradierApiKey: 'test-key',
      tradierAccountId: 'test-account',
      defaultTastytradeAccountId: 'test-account-id',
    });

    const mockAPI = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([
        {
          accountId: 'test-account-id',
          account: {
            'account-number': 'test-account-id',
            'external-id': 'ext-123',
            'opened-at': '2024-01-01',
            'nickname': 'Test Account',
            'account-type-name': 'Individual',
            'is-firm-error': false,
            'is-firm-proprietary': false,
            'is-futures-approved': false,
            'is-closed': false,
            'day-trader-status': false,
            'margin-or-cash': 'Margin',
            'suitable-options-level': 'Approved',
          },
        },
      ]),
      getBalances: vi.fn().mockResolvedValue({
        'derivative-buying-power': 50000,
      }),
    };
    vi.mocked(authenticateTastytrade).mockResolvedValue(mockAPI as any);

    type ValidateOrdersInput = inferProcedureInput<typeof appRouter.csp.validateOrders>;
    const input: ValidateOrdersInput = {
      orders: [
        {
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-02-20',
          premium: 2.5,
          bid: 2.0,
          ask: 3.0,
          currentPrice: 155,
        },
      ],
      accountId: 'test-account-id',
    };

    const result = await caller.csp.validateOrders(input);

    // Midpoint should be (2.0 + 3.0) / 2 = 2.5, then * 100 = 250
    expect(result.orders[0].premium).toBe(250);
  });

  it('should throw error when credentials are not configured', async () => {
    const { getApiCredentials } = await import('./db');

    vi.mocked(getApiCredentials).mockResolvedValue(null);

    type ValidateOrdersInput = inferProcedureInput<typeof appRouter.csp.validateOrders>;
    const input: ValidateOrdersInput = {
      orders: [
        {
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-02-20',
          premium: 2.5,
          bid: 2.4,
          ask: 2.6,
          currentPrice: 155,
        },
      ],
      accountId: 'test-account-id',
    };

    await expect(caller.csp.validateOrders(input)).rejects.toThrow(
      'Tastytrade OAuth2 credentials not configured'
    );
  });

  it('should throw error when account is not found', async () => {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: '1',
      tastytradeClientSecret: 'test-client-secret',
      tastytradeRefreshToken: 'test-refresh-token',
      tradierApiKey: 'test-key',
      tradierAccountId: 'test-account',
      defaultTastytradeAccountId: 'test-account-id',
    });

    const mockAPI = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([]), // No accounts
    };
    vi.mocked(authenticateTastytrade).mockResolvedValue(mockAPI as any);

    type ValidateOrdersInput = inferProcedureInput<typeof appRouter.csp.validateOrders>;
    const input: ValidateOrdersInput = {
      orders: [
        {
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-02-20',
          premium: 2.5,
          bid: 2.4,
          ask: 2.6,
          currentPrice: 155,
        },
      ],
      accountId: 'test-account-id',
    };

    await expect(caller.csp.validateOrders(input)).rejects.toThrow('Account not found');
  });
});
