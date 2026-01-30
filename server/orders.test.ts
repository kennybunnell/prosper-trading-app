import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ordersRouter } from './routers-orders.js';
import * as tastytrade from './tastytrade.js';

// Mock the tastytrade module
vi.mock('./tastytrade.js', () => ({
  submitRollOrder: vi.fn(),
  submitCloseOrder: vi.fn(),
}));

describe('Orders Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitClose', () => {
    it('should submit a close order with only closeLeg (no openLeg)', async () => {
      // Mock successful close order submission
      const mockOrderId = 'close-order-123';
      vi.mocked(tastytrade.submitCloseOrder).mockResolvedValue({
        orderId: mockOrderId,
      });

      // Create a mock context with user
      const mockCtx = {
        user: {
          id: 'test-user-id',
          openId: 'test-open-id',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user' as const,
        },
      };

      // Create caller with mock context
      const caller = ordersRouter.createCaller(mockCtx);

      // Test input for close order (1-leg only)
      const input = {
        accountNumber: '5YZ55555',
        symbol: 'UBER',
        closeLeg: {
          action: 'BTC' as const,
          quantity: 1,
          strike: 84,
          expiration: '2026-02-07',
          optionType: 'CALL' as const,
          price: 1.57,
        },
      };

      // Call submitClose
      const result = await caller.submitClose(input);

      // Verify submitCloseOrder was called with correct parameters
      expect(tastytrade.submitCloseOrder).toHaveBeenCalledWith({
        accountNumber: input.accountNumber,
        symbol: input.symbol,
        closeLeg: input.closeLeg,
      });

      // Verify no openLeg was passed
      expect(tastytrade.submitCloseOrder).toHaveBeenCalledWith(
        expect.not.objectContaining({ openLeg: expect.anything() })
      );

      // Verify result
      expect(result).toEqual({
        success: true,
        orderId: mockOrderId,
        message: 'Close order submitted successfully',
      });
    });

    it('should handle close order submission errors', async () => {
      // Mock error
      const errorMessage = 'Validation failed: Invalid strike price';
      vi.mocked(tastytrade.submitCloseOrder).mockRejectedValue(
        new Error(errorMessage)
      );

      const mockCtx = {
        user: {
          id: 'test-user-id',
          openId: 'test-open-id',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user' as const,
        },
      };

      const caller = ordersRouter.createCaller(mockCtx);

      const input = {
        accountNumber: '5YZ55555',
        symbol: 'UBER',
        closeLeg: {
          action: 'BTC' as const,
          quantity: 1,
          strike: 84,
          expiration: '2026-02-07',
          optionType: 'CALL' as const,
          price: 1.57,
        },
      };

      // Expect error to be thrown
      await expect(caller.submitClose(input)).rejects.toThrow();
    });
  });

  describe('submitRoll', () => {
    it('should submit a roll order with both closeLeg and openLeg', async () => {
      // Mock successful roll order submission
      const mockOrderId = 'roll-order-456';
      vi.mocked(tastytrade.submitRollOrder).mockResolvedValue({
        orderId: mockOrderId,
      });

      const mockCtx = {
        user: {
          id: 'test-user-id',
          openId: 'test-open-id',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user' as const,
        },
      };

      const caller = ordersRouter.createCaller(mockCtx);

      // Test input for roll order (2-leg)
      const input = {
        accountNumber: '5YZ55555',
        symbol: 'UBER',
        closeLeg: {
          action: 'BTC' as const,
          quantity: 1,
          strike: 84,
          expiration: '2026-02-07',
          optionType: 'CALL' as const,
        },
        openLeg: {
          action: 'STO' as const,
          quantity: 1,
          strike: 85,
          expiration: '2026-02-14',
          optionType: 'CALL' as const,
        },
      };

      // Call submitRoll
      const result = await caller.submitRoll(input);

      // Verify submitRollOrder was called with correct parameters
      expect(tastytrade.submitRollOrder).toHaveBeenCalledWith({
        accountNumber: input.accountNumber,
        symbol: input.symbol,
        closeLeg: input.closeLeg,
        openLeg: input.openLeg,
      });

      // Verify both legs were passed
      expect(tastytrade.submitRollOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          closeLeg: expect.any(Object),
          openLeg: expect.any(Object),
        })
      );

      // Verify result
      expect(result).toEqual({
        success: true,
        orderId: mockOrderId,
        message: 'Roll order submitted successfully',
      });
    });

    it('should handle roll order submission errors', async () => {
      // Mock error
      const errorMessage = 'Validation failed: Invalid expiration date';
      vi.mocked(tastytrade.submitRollOrder).mockRejectedValue(
        new Error(errorMessage)
      );

      const mockCtx = {
        user: {
          id: 'test-user-id',
          openId: 'test-open-id',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user' as const,
        },
      };

      const caller = ordersRouter.createCaller(mockCtx);

      const input = {
        accountNumber: '5YZ55555',
        symbol: 'UBER',
        closeLeg: {
          action: 'BTC' as const,
          quantity: 1,
          strike: 84,
          expiration: '2026-02-07',
          optionType: 'CALL' as const,
        },
        openLeg: {
          action: 'STO' as const,
          quantity: 1,
          strike: 85,
          expiration: '2026-02-14',
          optionType: 'CALL' as const,
        },
      };

      // Expect error to be thrown
      await expect(caller.submitRoll(input)).rejects.toThrow();
    });
  });

  describe('Order type differentiation', () => {
    it('should never call submitRollOrder when submitting a close order', async () => {
      vi.mocked(tastytrade.submitCloseOrder).mockResolvedValue({
        orderId: 'close-123',
      });

      const mockCtx = {
        user: {
          id: 'test-user-id',
          openId: 'test-open-id',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user' as const,
        },
      };

      const caller = ordersRouter.createCaller(mockCtx);

      await caller.submitClose({
        accountNumber: '5YZ55555',
        symbol: 'UBER',
        closeLeg: {
          action: 'BTC' as const,
          quantity: 1,
          strike: 84,
          expiration: '2026-02-07',
          optionType: 'CALL' as const,
          price: 1.57,
        },
      });

      // Verify submitRollOrder was never called
      expect(tastytrade.submitRollOrder).not.toHaveBeenCalled();
      // Verify submitCloseOrder was called
      expect(tastytrade.submitCloseOrder).toHaveBeenCalledTimes(1);
    });

    it('should never call submitCloseOrder when submitting a roll order', async () => {
      vi.mocked(tastytrade.submitRollOrder).mockResolvedValue({
        orderId: 'roll-456',
      });

      const mockCtx = {
        user: {
          id: 'test-user-id',
          openId: 'test-open-id',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user' as const,
        },
      };

      const caller = ordersRouter.createCaller(mockCtx);

      await caller.submitRoll({
        accountNumber: '5YZ55555',
        symbol: 'UBER',
        closeLeg: {
          action: 'BTC' as const,
          quantity: 1,
          strike: 84,
          expiration: '2026-02-07',
          optionType: 'CALL' as const,
        },
        openLeg: {
          action: 'STO' as const,
          quantity: 1,
          strike: 85,
          expiration: '2026-02-14',
          optionType: 'CALL' as const,
        },
      });

      // Verify submitCloseOrder was never called
      expect(tastytrade.submitCloseOrder).not.toHaveBeenCalled();
      // Verify submitRollOrder was called
      expect(tastytrade.submitRollOrder).toHaveBeenCalledTimes(1);
    });
  });
});
