/**
 * PASS 2 — Integration Test Suite 2: Daily Actions
 *
 * Tests the core Daily Actions procedures:
 *   - Dashboard scan counts (getDailyActionCounts)
 *   - Portfolio positions (getPortfolioPositions)
 *   - Portfolio Greeks (getPortfolioGreeks)
 *   - Roll scan (rolls.scanRollPositions)
 *   - Automation scan (runAutomation BTC dry-run)
 *   - Working orders fetch
 *
 * All tests use the real database and real Tastytrade/Tradier APIs.
 * No orders are submitted — all mutation tests use dry-run mode.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';
import { getDb } from './db';
import { users } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getOwnerUser() {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const { eq } = await import('drizzle-orm');
  const result = await db.select().from(users).where(eq(users.id, 1)).limit(1);
  if (!result[0]) throw new Error('Owner user (id=1) not found');
  return result[0];
}

function makeCtx(user: Awaited<ReturnType<typeof getOwnerUser>>): TrpcContext {
  return {
    user: user as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {
      clearCookie: () => {},
      getHeader: () => undefined,
      setHeader: () => {},
    } as unknown as TrpcContext['res'],
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Integration: Daily Actions', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const ownerUser = await getOwnerUser();
    caller = appRouter.createCaller(makeCtx(ownerUser));
  }, 15000);

  // ── Dashboard Scan Counts ──────────────────────────────────────────────────

  describe('dashboard.getDailyActionCounts', () => {
    it('should return scan counts object with required fields', async () => {
      const result = await caller.dashboard.getDailyActionCounts();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('closeProfitCount');
      expect(result).toHaveProperty('rollPositionsCount');
      expect(result).toHaveProperty('sellCallsCount');
      expect(result).toHaveProperty('closeProfitItems');
      expect(result).toHaveProperty('rollPositionsItems');
      expect(result).toHaveProperty('sellCallsItems');
      console.log('[Integration] Daily scan counts:', {
        closeForProfit: result.closeProfitCount,
        rollPositions: result.rollPositionsCount,
        sellCalls: result.sellCallsCount,
        scannedAt: result.scannedAt,
      });
    });

    it('closeProfitItems, rollPositionsItems, sellCallsItems should be arrays', async () => {
      const result = await caller.dashboard.getDailyActionCounts();
      expect(Array.isArray(result.closeProfitItems)).toBe(true);
      expect(Array.isArray(result.rollPositionsItems)).toBe(true);
      expect(Array.isArray(result.sellCallsItems)).toBe(true);
    });

    it('each closeProfitItem should have required fields if items exist', async () => {
      const result = await caller.dashboard.getDailyActionCounts();
      if (result.closeProfitItems.length > 0) {
        const item = result.closeProfitItems[0];
        // CloseProfitItem fields: symbol, underlyingSymbol, profitPct, currentValue, openPrice, daysLeft, expiresAt
        expect(item).toHaveProperty('symbol');
        expect(item).toHaveProperty('underlyingSymbol');
        expect(item).toHaveProperty('profitPct');
        console.log('[Integration] Sample BTC item:', {
          symbol: item.symbol,
          underlyingSymbol: item.underlyingSymbol,
          profitPct: item.profitPct,
          daysLeft: item.daysLeft,
        });
      } else {
        console.log('[Integration] No BTC items in cache — run a fresh scan to populate');
      }
    });
  });

  // ── Portfolio Positions ────────────────────────────────────────────────────

  describe('automation.getPortfolioPositions', () => {
    it('should return { chainKeys, positions } object', async () => {
      const result = await caller.automation.getPortfolioPositions();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('chainKeys');
      expect(result).toHaveProperty('positions');
      expect(Array.isArray(result.chainKeys)).toBe(true);
      expect(Array.isArray(result.positions)).toBe(true);
      console.log(`[Integration] Portfolio positions: ${result.positions.length} position(s), ${result.chainKeys.length} chain key(s)`);
    }, 30000);

    it('each position should have required fields', async () => {
      const result = await caller.automation.getPortfolioPositions();
      if (result.positions.length > 0) {
        const pos = result.positions[0];
        expect(pos).toHaveProperty('symbol');
        expect(pos).toHaveProperty('underlying');
        expect(pos).toHaveProperty('expiration');
        expect(pos).toHaveProperty('quantity');
        expect(pos).toHaveProperty('direction');
        expect(pos).toHaveProperty('accountNumber');
        console.log('[Integration] Sample position:', {
          symbol: pos.symbol,
          underlying: pos.underlying,
          quantity: pos.quantity,
          direction: pos.direction,
        });
      } else {
        console.log('[Integration] No open option positions found');
      }
    }, 30000);
  });

  // ── Portfolio Greeks ───────────────────────────────────────────────────────

  describe('automation.getPortfolioGreeks', () => {
    it('should return { tickers, portfolio } object', async () => {
      const result = await caller.automation.getPortfolioGreeks();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('tickers');
      expect(result).toHaveProperty('portfolio');
      expect(Array.isArray(result.tickers)).toBe(true);
      console.log('[Integration] Portfolio Greeks:', {
        tickerCount: result.tickers.length,
        portfolioDelta: result.portfolio?.netDelta,
        portfolioTheta: result.portfolio?.dailyTheta,
        totalPremiumAtRisk: result.portfolio?.totalPremiumAtRisk,
      });
    }, 60000);

    it('portfolio should have netDelta, dailyTheta, netVega, netGamma fields', async () => {
      const result = await caller.automation.getPortfolioGreeks();
      expect(result.portfolio).toHaveProperty('netDelta');
      expect(result.portfolio).toHaveProperty('dailyTheta');
      expect(result.portfolio).toHaveProperty('netVega');
      expect(result.portfolio).toHaveProperty('netGamma');
      expect(result.portfolio).toHaveProperty('totalPremiumAtRisk');
      expect(result.portfolio).toHaveProperty('positionCount');
    }, 60000);
  });

  // ── Working Orders ─────────────────────────────────────────────────────────

  describe('workingOrders.getWorkingOrders', () => {
    it('should return working orders with orders array', async () => {
      const result = await caller.workingOrders.getWorkingOrders({ accountId: 'ALL_ACCOUNTS' });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('orders');
      expect(Array.isArray(result.orders)).toBe(true);
      console.log(`[Integration] Working orders: ${result.orders.length} order(s)`);
    }, 30000);

    it('each working order should have required fields', async () => {
      const result = await caller.workingOrders.getWorkingOrders({ accountId: 'ALL_ACCOUNTS' });
      if (result.orders.length > 0) {
        const order = result.orders[0];
        expect(order).toHaveProperty('orderId');
        expect(order).toHaveProperty('symbol');
        expect(order).toHaveProperty('accountNumber');
        expect(order).toHaveProperty('optionType');
        console.log('[Integration] Sample working order:', {
          orderId: order.orderId,
          symbol: order.symbol,
          optionType: order.optionType,
          needsReplacement: order.needsReplacement,
        });
      } else {
        console.log('[Integration] No working orders found');
      }
    }, 30000);
  });

  // ── Roll Scan ─────────────────────────────────────────────────────────────

  describe('rolls.scanRollPositions', () => {
    it('should return { red, yellow, green, all, letExpire, total } object', async () => {
      const result = await caller.rolls.scanRollPositions();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('red');
      expect(result).toHaveProperty('yellow');
      expect(result).toHaveProperty('green');
      expect(result).toHaveProperty('all');
      expect(result).toHaveProperty('letExpire');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.red)).toBe(true);
      expect(Array.isArray(result.yellow)).toBe(true);
      expect(Array.isArray(result.green)).toBe(true);
      expect(Array.isArray(result.all)).toBe(true);
      console.log(`[Integration] Roll scan: total=${result.total} | red=${result.red.length} yellow=${result.yellow.length} green=${result.green.length} letExpire=${result.letExpire?.length ?? 0}`);
    }, 120000);

    it('each roll candidate should have symbol, urgency, and metrics fields', async () => {
      const result = await caller.rolls.scanRollPositions();
      for (const item of result.all.slice(0, 3)) {
        expect(item).toHaveProperty('symbol');
        expect(item).toHaveProperty('urgency');
        expect(item).toHaveProperty('metrics');
        console.log('[Integration] Roll candidate:', item.symbol, '| urgency:', item.urgency, '| dte:', item.metrics?.dte);
      }
    }, 120000);
  });

  // ── BTC Scan (Dry Run) ─────────────────────────────────────────────────────

  describe('automation.runAutomation (BTC scan)', () => {
    it('should run BTC scan and return { success, runId, summary } object', async () => {
      const result = await caller.automation.runAutomation({
        triggerType: 'manual',
        scanSteps: ['btc'],
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('runId');
      expect(result).toHaveProperty('summary');
      expect(result.success).toBe(true);
      console.log(`[Integration] BTC scan: runId=${result.runId}, totalScanned=${result.summary?.totalScanned}, wouldClose=${result.summary?.wouldClose}, dryRun=${result.dryRun}`);
    }, 120000);

    it('BTC scan summary should have required fields', async () => {
      const result = await caller.automation.runAutomation({
        triggerType: 'manual',
        scanSteps: ['btc'],
      });
      expect(result.summary).toHaveProperty('totalScanned');
      expect(result.summary).toHaveProperty('wouldClose');
      expect(result.summary).toHaveProperty('belowThreshold');
      expect(result.summary).toHaveProperty('accountsProcessed');
    }, 120000);
  });

  // ── Automation Logs ────────────────────────────────────────────────────────

  describe('automation.getLogs', () => {
    it('should return automation logs array', async () => {
      const result = await caller.automation.getLogs({ limit: 10 });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      console.log(`[Integration] Automation logs: ${result.length} entries`);
    });
  });
});
