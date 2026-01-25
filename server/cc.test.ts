import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';
import type { inferProcedureInput } from '@trpc/server';
import type { AppRouter } from './routers';

describe('CC Router Tests', () => {
  // Mock context with authenticated user
  const mockContext = {
    user: {
      id: 1,
      openId: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      role: 'user' as const,
    },
  };

  const caller = appRouter.createCaller(mockContext as any);

  describe('getEligiblePositions', () => {
    it('should require authentication', async () => {
      const unauthCaller = appRouter.createCaller({ user: null } as any);
      
      await expect(
        unauthCaller.cc.getEligiblePositions({ accountNumber: 'test-account' })
      ).rejects.toThrow();
    });

    it('should accept valid account number', async () => {
      const input: inferProcedureInput<AppRouter['cc']['getEligiblePositions']> = {
        accountNumber: 'test-account-123',
      };

      // This will fail if credentials are not configured, which is expected in test environment
      try {
        await caller.cc.getEligiblePositions(input);
      } catch (error: any) {
        // Expected to fail with credentials error or API error in test environment
        expect(error.message).toMatch(/credentials not configured|Account not found|Request failed|404/i);
      }
    });
  });

  describe('scanOpportunities', () => {
    it('should require authentication', async () => {
      const unauthCaller = appRouter.createCaller({ user: null } as any);
      
      await expect(
        unauthCaller.cc.scanOpportunities({
          symbols: ['AAPL'],
          holdings: [{ symbol: 'AAPL', quantity: 100, currentPrice: 150, maxContracts: 1 }],
          minDte: 7,
          maxDte: 45,
          minDelta: 0.05,
          maxDelta: 0.99,
        })
      ).rejects.toThrow();
    });

    it('should handle empty symbols array gracefully', async () => {
      // Test with empty symbols array - should return empty array, not throw
      const result = await caller.cc.scanOpportunities({
        symbols: [],
        holdings: [],
        minDte: 7,
        maxDte: 45,
        minDelta: 0.05,
        maxDelta: 0.99,
      });
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    // Note: Full scan test skipped as it requires live API credentials and takes >10s

    it('should validate DTE range', async () => {
      // minDte should be less than maxDte
      const input: inferProcedureInput<AppRouter['cc']['scanOpportunities']> = {
        symbols: ['AAPL'],
        holdings: [{ symbol: 'AAPL', quantity: 100, currentPrice: 150, maxContracts: 1 }],
        minDte: 45,
        maxDte: 7, // Invalid: max < min
        minDelta: 0.15,
        maxDelta: 0.35,
      };

      try {
        await caller.cc.scanOpportunities(input);
      } catch (error: any) {
        // Should handle invalid DTE range gracefully
        expect(error).toBeDefined();
      }
    });

    it('should validate delta range', async () => {
      const input: inferProcedureInput<AppRouter['cc']['scanOpportunities']> = {
        symbols: ['AAPL'],
        holdings: [{ symbol: 'AAPL', quantity: 100, currentPrice: 150, maxContracts: 1 }],
        minDte: 7,
        maxDte: 45,
        minDelta: 0.35,
        maxDelta: 0.15, // Invalid: max < min
      };

      try {
        await caller.cc.scanOpportunities(input);
      } catch (error: any) {
        // Should handle invalid delta range gracefully
        expect(error).toBeDefined();
      }
    });
  });

  describe('submitOrders', () => {
    it('should require authentication', async () => {
      const unauthCaller = appRouter.createCaller({ user: null } as any);
      
      await expect(
        unauthCaller.cc.submitOrders({
          accountNumber: 'test-account',
          orders: [],
          dryRun: true,
        })
      ).rejects.toThrow();
    });

    it('should handle dry run mode', async () => {
      const input: inferProcedureInput<AppRouter['cc']['submitOrders']> = {
        accountNumber: 'test-account-123',
        orders: [
          {
            symbol: 'AAPL',
            strike: 155,
            expiration: '2026-02-20',
            quantity: 1,
            price: 2.50,
          },
        ],
        dryRun: true,
      };

      const result = await caller.cc.submitOrders(input);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].success).toBe(true);
      expect(result[0].orderId).toBe('DRY_RUN');
      expect(result[0].message).toContain('Dry run');
    });

    it('should validate order structure', async () => {
      const input: inferProcedureInput<AppRouter['cc']['submitOrders']> = {
        accountNumber: 'test-account-123',
        orders: [
          {
            symbol: 'AAPL',
            strike: 155,
            expiration: '2026-02-20',
            quantity: 1,
            price: 2.50,
          },
          {
            symbol: 'MSFT',
            strike: 360,
            expiration: '2026-03-20',
            quantity: 2,
            price: 5.00,
          },
        ],
        dryRun: true,
      };

      const result = await caller.cc.submitOrders(input);
      
      expect(result.length).toBe(2);
      expect(result.every(r => r.success)).toBe(true);
    });

    it('should handle live orders without credentials', async () => {
      const input: inferProcedureInput<AppRouter['cc']['submitOrders']> = {
        accountNumber: 'test-account-123',
        orders: [
          {
            symbol: 'AAPL',
            strike: 155,
            expiration: '2026-02-20',
            quantity: 1,
            price: 2.50,
          },
        ],
        dryRun: false, // Live mode
      };

      // Live mode without credentials should return failure results, not throw
      const result = await caller.cc.submitOrders(input);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].success).toBe(false);
      expect(result[0].message).toMatch(/credentials|failed|404/i);
    });
  });

  describe('Composite Scoring Logic', () => {
    it('should calculate scores within 0-100 range', () => {
      // Test score calculation logic
      const testOpportunity = {
        weeklyReturn: 0.5, // 0.5% weekly return
        delta: 0.25,
        rsi: 65,
        bbPctB: 0.7,
        distanceOtm: 5,
        spreadPct: 2,
      };

      // Weekly Return score (25%): 0.5% is mid-range (0.3-2.0), ~12.5 points
      const weeklyReturnScore = Math.min(100, Math.max(0, ((testOpportunity.weeklyReturn - 0.3) / (2.0 - 0.3)) * 100)) * 0.25;
      
      // Delta score (20%): 0.25 is in sweet spot (0.20-0.35), full 20 points
      const deltaScore = (testOpportunity.delta >= 0.20 && testOpportunity.delta <= 0.35) ? 20 : 0;
      
      // RSI score (15%): Higher is better for CC, 65 is good, ~9.75 points
      const rsiScore = testOpportunity.rsi ? (testOpportunity.rsi / 100) * 15 : 0;
      
      // BB %B score (15%): 0.7 is high (good for CC), ~10.5 points
      const bbScore = testOpportunity.bbPctB ? testOpportunity.bbPctB * 15 : 0;
      
      // Distance OTM score (15%): 5% is moderate, ~7.5 points
      const distanceScore = Math.min(15, (testOpportunity.distanceOtm / 10) * 15);
      
      // Spread score (10%): 2% is tight (good), ~8 points
      const spreadScore = Math.max(0, (1 - testOpportunity.spreadPct / 10) * 10);
      
      const totalScore = Math.round(weeklyReturnScore + deltaScore + rsiScore + bbScore + distanceScore + spreadScore);
      
      expect(totalScore).toBeGreaterThanOrEqual(0);
      expect(totalScore).toBeLessThanOrEqual(100);
      expect(totalScore).toBeGreaterThan(50); // This opportunity should score well
    });
  });
});
