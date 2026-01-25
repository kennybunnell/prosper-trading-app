/**
 * Unit tests for CC contract limit validation
 * Tests that submitOrders procedure correctly validates contract limits
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('CC Contract Limit Validation', () => {
  // Mock Tastytrade API
  const mockGetPositions = vi.fn();
  const mockLogin = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject orders exceeding available contracts in dry run mode', async () => {
    // Mock positions: APLD with 2000 shares (20 contracts available)
    mockGetPositions.mockResolvedValue([
      {
        'instrument-type': 'Equity',
        symbol: 'APLD',
        quantity: '2000',
        'close-price': '10.50',
        'quantity-direction': 'Long',
      },
    ]);

    // Mock API credentials
    const mockGetApiCredentials = vi.fn().mockResolvedValue({
      tastytradeUsername: 'test@example.com',
      tastytradePassword: 'password123',
    });

    // Mock Tastytrade API
    const mockTastytradeAPI = {
      login: mockLogin,
      getPositions: mockGetPositions,
    };

    const mockGetTastytradeAPI = vi.fn().mockReturnValue(mockTastytradeAPI);

    // Mock imports
    vi.doMock('./db', () => ({
      getApiCredentials: mockGetApiCredentials,
    }));

    vi.doMock('./tastytrade', () => ({
      getTastytradeAPI: mockGetTastytradeAPI,
    }));

    // Import the router after mocking
    const { ccRouter } = await import('./routers-cc');

    // Create mock context
    const mockCtx = {
      user: { id: 1, openId: 'test-user', name: 'Test User', role: 'user' as const },
    };

    // Test input: 25 APLD contracts (exceeds 20 available)
    const input = {
      accountNumber: '5WV12345',
      orders: Array.from({ length: 25 }, (_, i) => ({
        symbol: 'APLD',
        strike: 11.0 + i * 0.5,
        expiration: '2026-02-21',
        quantity: 1,
        price: 0.25,
      })),
      dryRun: true,
    };

    // Execute submitOrders and expect it to throw
    try {
      await ccRouter.createCaller(mockCtx).submitOrders(input);
      expect.fail('Expected submitOrders to throw an error');
    } catch (error: any) {
      expect(error.message).toContain('Contract limit validation failed');
      expect(error.message).toContain('APLD');
      expect(error.message).toContain('25');
      expect(error.message).toContain('20');
    }

    // Verify API was called
    expect(mockLogin).toHaveBeenCalled();
    expect(mockGetPositions).toHaveBeenCalledWith('5WV12345');
  });

  it('should accept orders within available contracts', async () => {
    // Mock positions: APLD with 2000 shares (20 contracts available)
    mockGetPositions.mockResolvedValue([
      {
        'instrument-type': 'Equity',
        symbol: 'APLD',
        quantity: '2000',
        'close-price': '10.50',
        'quantity-direction': 'Long',
      },
    ]);

    const mockGetApiCredentials = vi.fn().mockResolvedValue({
      tastytradeUsername: 'test@example.com',
      tastytradePassword: 'password123',
    });

    const mockTastytradeAPI = {
      login: mockLogin,
      getPositions: mockGetPositions,
    };

    const mockGetTastytradeAPI = vi.fn().mockReturnValue(mockTastytradeAPI);

    vi.doMock('./db', () => ({
      getApiCredentials: mockGetApiCredentials,
    }));

    vi.doMock('./tastytrade', () => ({
      getTastytradeAPI: mockGetTastytradeAPI,
    }));

    const { ccRouter } = await import('./routers-cc');

    const mockCtx = {
      user: { id: 1, openId: 'test-user', name: 'Test User', role: 'user' as const },
    };

    // Test input: 15 APLD contracts (within 20 available)
    const input = {
      accountNumber: '5WV12345',
      orders: Array.from({ length: 15 }, (_, i) => ({
        symbol: 'APLD',
        strike: 11.0 + i * 0.5,
        expiration: '2026-02-21',
        quantity: 1,
        price: 0.25,
      })),
      dryRun: true,
    };

    // Execute submitOrders - should succeed
    const result = await ccRouter.createCaller(mockCtx).submitOrders(input);

    expect(result).toHaveLength(15);
    expect(result[0].success).toBe(true);
    expect(result[0].message).toContain('validation passed');
  });

  it('should account for existing short calls when calculating available contracts', async () => {
    // Mock positions: APLD with 2000 shares, 10 existing short calls
    mockGetPositions.mockResolvedValue([
      {
        'instrument-type': 'Equity',
        symbol: 'APLD',
        quantity: '2000',
        'close-price': '10.50',
        'quantity-direction': 'Long',
      },
      {
        'instrument-type': 'Equity Option',
        symbol: 'APLD  260221C00011000',
        'underlying-symbol': 'APLD',
        quantity: '-10',
        'quantity-direction': 'Short',
        'expires-at': '2026-02-21',
      },
    ]);

    const mockGetApiCredentials = vi.fn().mockResolvedValue({
      tastytradeUsername: 'test@example.com',
      tastytradePassword: 'password123',
    });

    const mockTastytradeAPI = {
      login: mockLogin,
      getPositions: mockGetPositions,
    };

    const mockGetTastytradeAPI = vi.fn().mockReturnValue(mockTastytradeAPI);

    vi.doMock('./db', () => ({
      getApiCredentials: mockGetApiCredentials,
    }));

    vi.doMock('./tastytrade', () => ({
      getTastytradeAPI: mockGetTastytradeAPI,
    }));

    const { ccRouter } = await import('./routers-cc');

    const mockCtx = {
      user: { id: 1, openId: 'test-user', name: 'Test User', role: 'user' as const },
    };

    // Test input: 15 APLD contracts (exceeds 10 available after existing 10 short calls)
    const input = {
      accountNumber: '5WV12345',
      orders: Array.from({ length: 15 }, (_, i) => ({
        symbol: 'APLD',
        strike: 11.0 + i * 0.5,
        expiration: '2026-02-21',
        quantity: 1,
        price: 0.25,
      })),
      dryRun: true,
    };

    // Execute submitOrders and expect it to throw
    try {
      await ccRouter.createCaller(mockCtx).submitOrders(input);
      expect.fail('Expected submitOrders to throw an error');
    } catch (error: any) {
      expect(error.message).toContain('Contract limit validation failed');
      expect(error.message).toContain('APLD');
      expect(error.message).toContain('15');
      expect(error.message).toContain('10'); // Only 10 available after existing 10 short calls
    }
  });

  it('should validate multiple symbols independently', async () => {
    // Mock positions: APLD (20 available), NVDA (5 available)
    mockGetPositions.mockResolvedValue([
      {
        'instrument-type': 'Equity',
        symbol: 'APLD',
        quantity: '2000',
        'close-price': '10.50',
        'quantity-direction': 'Long',
      },
      {
        'instrument-type': 'Equity',
        symbol: 'NVDA',
        quantity: '500',
        'close-price': '850.00',
        'quantity-direction': 'Long',
      },
    ]);

    const mockGetApiCredentials = vi.fn().mockResolvedValue({
      tastytradeUsername: 'test@example.com',
      tastytradePassword: 'password123',
    });

    const mockTastytradeAPI = {
      login: mockLogin,
      getPositions: mockGetPositions,
    };

    const mockGetTastytradeAPI = vi.fn().mockReturnValue(mockTastytradeAPI);

    vi.doMock('./db', () => ({
      getApiCredentials: mockGetApiCredentials,
    }));

    vi.doMock('./tastytrade', () => ({
      getTastytradeAPI: mockGetTastytradeAPI,
    }));

    const { ccRouter } = await import('./routers-cc');

    const mockCtx = {
      user: { id: 1, openId: 'test-user', name: 'Test User', role: 'user' as const },
    };

    // Test input: 15 APLD (OK), 10 NVDA (exceeds 5 available)
    const input = {
      accountNumber: '5WV12345',
      orders: [
        ...Array.from({ length: 15 }, (_, i) => ({
          symbol: 'APLD',
          strike: 11.0 + i * 0.5,
          expiration: '2026-02-21',
          quantity: 1,
          price: 0.25,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          symbol: 'NVDA',
          strike: 900.0 + i * 5,
          expiration: '2026-02-21',
          quantity: 1,
          price: 5.50,
        })),
      ],
      dryRun: true,
    };

    // Execute submitOrders and expect it to throw (NVDA exceeds limit)
    try {
      await ccRouter.createCaller(mockCtx).submitOrders(input);
      expect.fail('Expected submitOrders to throw an error');
    } catch (error: any) {
      expect(error.message).toContain('Contract limit validation failed');
      expect(error.message).toContain('NVDA');
      expect(error.message).toContain('10');
      expect(error.message).toContain('5');
      // APLD should not be mentioned since it's within limits
      expect(error.message).not.toContain('APLD: Requested 15');
    }
  });
});
