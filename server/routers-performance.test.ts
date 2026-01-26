import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performanceRouter } from './routers-performance';
import type { TastytradePosition } from './tastytrade';

// Mock dependencies
vi.mock('./db', () => ({
  getApiCredentials: vi.fn(),
}));

vi.mock('./tastytrade', () => ({
  getTastytradeAPI: vi.fn(),
}));

describe('Performance Router - getActivePositions', () => {
  const mockUser = {
    id: 'test-user-id',
    openId: 'test-open-id',
    name: 'Test User',
    email: 'test@example.com',
  };

  const mockContext = {
    user: mockUser,
    req: {} as any,
    res: {} as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty positions when no Tastytrade credentials configured', async () => {
    const { getApiCredentials } = await import('./db');
    vi.mocked(getApiCredentials).mockResolvedValue(null);

    const caller = performanceRouter.createCaller(mockContext);

    await expect(
      caller.getActivePositions({
        accountId: 'test-account',
      })
    ).rejects.toThrow('Tastytrade credentials not configured');
  });

  it('should return empty positions when no accounts found', async () => {
    const { getApiCredentials } = await import('./db');
    const { getTastytradeAPI } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: 'test-user-id',
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-pass',
      tradierApiKey: null,
      tradierAccountId: null,
      defaultTastytradeAccountId: null,
    });

    const mockApi = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([]),
      getPositions: vi.fn(),
    };

    vi.mocked(getTastytradeAPI).mockReturnValue(mockApi as any);

    const caller = performanceRouter.createCaller(mockContext);

    const result = await caller.getActivePositions({
      accountId: 'test-account',
    });

    expect(result).toEqual({
      positions: [],
      summary: {
        openPositions: 0,
        totalPremiumAtRisk: 0,
        avgRealizedPercent: 0,
        readyToClose: 0,
      },
    });
  });

  it('should filter and process short option positions correctly', async () => {
    const { getApiCredentials } = await import('./db');
    const { getTastytradeAPI } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: 'test-user-id',
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-pass',
      tradierApiKey: null,
      tradierAccountId: null,
      defaultTastytradeAccountId: null,
    });

    // Mock positions: 2 short puts (CSPs), 1 short call (CC), 1 long call (should be filtered out)
    const mockPositions: TastytradePosition[] = [
      {
        symbol: 'AAPL250117P00150000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'AAPL',
        quantity: '-2',
        quantityDirection: 'Short',
        closePrice: '0.50',
        averageOpenPrice: '2.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Credit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
      {
        symbol: 'TSLA250117C00250000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'TSLA',
        quantity: '-1',
        quantityDirection: 'Short',
        closePrice: '0.10',
        averageOpenPrice: '1.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days from now
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Credit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
      {
        symbol: 'NVDA250117C00500000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'NVDA',
        quantity: '1',
        quantityDirection: 'Long',
        closePrice: '10.00',
        averageOpenPrice: '8.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString(), // 300 days (LEAP)
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Debit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
    ];

    const mockApi = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([
        {
          account: {
            'account-number': 'TEST123',
            'external-id': 'ext-123',
            'opened-at': '2020-01-01',
            'nickname': 'Test Account',
            'account-type-name': 'Individual',
            'is-firm-error': false,
            'is-firm-proprietary': false,
            'is-futures-approved': false,
            'is-closed': false,
            'day-trader-status': false,
            'margin-or-cash': 'Margin',
            'suitable-options-level': 'Level 3',
          },
        },
      ]),
      getPositions: vi.fn().mockResolvedValue(mockPositions),
    };

    vi.mocked(getTastytradeAPI).mockReturnValue(mockApi as any);

    const caller = performanceRouter.createCaller(mockContext);

    const result = await caller.getActivePositions({
      accountId: 'TEST123',
    });

    // Should only include 2 short positions (1 CSP, 1 CC)
    expect(result.positions).toHaveLength(2);
    
    // Check CSP position
    const cspPosition = result.positions.find(p => p.type === 'CSP');
    expect(cspPosition).toBeDefined();
    expect(cspPosition?.symbol).toBe('AAPL');
    expect(cspPosition?.quantity).toBe(2);
    expect(cspPosition?.strike).toBe(150);
    expect(cspPosition?.premium).toBe(400); // 2.00 * 2 * 100
    expect(cspPosition?.current).toBe(100); // 0.50 * 2 * 100
    expect(cspPosition?.realizedPercent).toBe(75); // (400 - 100) / 400 * 100
    expect(cspPosition?.action).toBe('WATCH'); // 75% >= 50% but < 80%

    // Check CC position
    const ccPosition = result.positions.find(p => p.type === 'CC');
    expect(ccPosition).toBeDefined();
    expect(ccPosition?.symbol).toBe('TSLA');
    expect(ccPosition?.quantity).toBe(1);
    expect(ccPosition?.strike).toBe(250);
    expect(ccPosition?.premium).toBe(100); // 1.00 * 1 * 100
    expect(ccPosition?.current).toBe(10); // 0.10 * 1 * 100
    expect(ccPosition?.realizedPercent).toBe(90); // (100 - 10) / 100 * 100
    expect(ccPosition?.action).toBe('CLOSE'); // 90% >= 80%

    // Check summary
    expect(result.summary.openPositions).toBe(2);
    expect(result.summary.totalPremiumAtRisk).toBe(500); // 400 + 100
    expect(result.summary.avgRealizedPercent).toBe(82.5); // (75 + 90) / 2
    expect(result.summary.readyToClose).toBe(1); // Only CC position
  });

  it('should filter positions by type (CSP only)', async () => {
    const { getApiCredentials } = await import('./db');
    const { getTastytradeAPI } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: 'test-user-id',
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-pass',
      tradierApiKey: null,
      tradierAccountId: null,
      defaultTastytradeAccountId: null,
    });

    const mockPositions: TastytradePosition[] = [
      {
        symbol: 'AAPL250117P00150000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'AAPL',
        quantity: '-1',
        quantityDirection: 'Short',
        closePrice: '0.50',
        averageOpenPrice: '2.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Credit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
      {
        symbol: 'TSLA250117C00250000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'TSLA',
        quantity: '-1',
        quantityDirection: 'Short',
        closePrice: '0.10',
        averageOpenPrice: '1.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Credit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
    ];

    const mockApi = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([
        {
          account: {
            'account-number': 'TEST123',
            'external-id': 'ext-123',
            'opened-at': '2020-01-01',
            'nickname': 'Test Account',
            'account-type-name': 'Individual',
            'is-firm-error': false,
            'is-firm-proprietary': false,
            'is-futures-approved': false,
            'is-closed': false,
            'day-trader-status': false,
            'margin-or-cash': 'Margin',
            'suitable-options-level': 'Level 3',
          },
        },
      ]),
      getPositions: vi.fn().mockResolvedValue(mockPositions),
    };

    vi.mocked(getTastytradeAPI).mockReturnValue(mockApi as any);

    const caller = performanceRouter.createCaller(mockContext);

    const result = await caller.getActivePositions({
      accountId: 'TEST123',
      positionType: 'csp',
    });

    // Should only include CSP position
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].type).toBe('CSP');
    expect(result.positions[0].symbol).toBe('AAPL');
  });

  it('should filter positions by minimum realized percent', async () => {
    const { getApiCredentials } = await import('./db');
    const { getTastytradeAPI } = await import('./tastytrade');

    vi.mocked(getApiCredentials).mockResolvedValue({
      userId: 'test-user-id',
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-pass',
      tradierApiKey: null,
      tradierAccountId: null,
      defaultTastytradeAccountId: null,
    });

    const mockPositions: TastytradePosition[] = [
      {
        symbol: 'AAPL250117P00150000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'AAPL',
        quantity: '-1',
        quantityDirection: 'Short',
        closePrice: '0.50',
        averageOpenPrice: '2.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Credit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
      {
        symbol: 'TSLA250117C00250000',
        instrumentType: 'Equity Option',
        underlyingSymbol: 'TSLA',
        quantity: '-1',
        quantityDirection: 'Short',
        closePrice: '0.10',
        averageOpenPrice: '1.00',
        multiplier: 100,
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        averageYearlyMarketClosePrice: '0',
        averageDailyMarketClosePrice: '0',
        costEffect: 'Credit',
        isSuppressed: false,
        isFrozen: false,
        restrictedQuantity: '0',
        realizedDayGain: '0',
        realizedDayGainEffect: 'None',
        realizedDayGainDate: '',
        realizedToday: '0',
        realizedTodayEffect: 'None',
        realizedTodayDate: '',
      },
    ];

    const mockApi = {
      login: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn().mockResolvedValue([
        {
          account: {
            'account-number': 'TEST123',
            'external-id': 'ext-123',
            'opened-at': '2020-01-01',
            'nickname': 'Test Account',
            'account-type-name': 'Individual',
            'is-firm-error': false,
            'is-firm-proprietary': false,
            'is-futures-approved': false,
            'is-closed': false,
            'day-trader-status': false,
            'margin-or-cash': 'Margin',
            'suitable-options-level': 'Level 3',
          },
        },
      ]),
      getPositions: vi.fn().mockResolvedValue(mockPositions),
    };

    vi.mocked(getTastytradeAPI).mockReturnValue(mockApi as any);

    const caller = performanceRouter.createCaller(mockContext);

    const result = await caller.getActivePositions({
      accountId: 'TEST123',
      minRealizedPercent: 85,
    });

    // Should only include TSLA position (90% realized)
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].symbol).toBe('TSLA');
    expect(result.positions[0].realizedPercent).toBe(90);
  });
});
