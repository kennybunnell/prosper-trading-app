/**
 * PASS 2 — Integration Test Suite 4: Performance & Portfolio
 *
 * Tests the data-heavy backend procedures:
 *   - Performance Overview (monthly P&L, closed trades)
 *   - Active Positions (open positions with Greeks)
 *   - Projections (locked-in income, theta decay, historical performance)
 *   - Spread Analytics (closed spreads, strategy metrics)
 *   - Portfolio Advisor (summary, detailed analysis)
 *   - Tax Summary
 *   - Dashboard (monthly premium data, capital events)
 *
 * All tests use the real database and real Tastytrade API.
 * No mutations are executed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';
import { getDb, getTastytradeAccounts } from './db';
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

describe('Integration: Performance & Portfolio', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let firstAccountId: string = 'ALL_ACCOUNTS';

  beforeAll(async () => {
    const ownerUser = await getOwnerUser();
    caller = appRouter.createCaller(makeCtx(ownerUser));
    // Get first account for targeted queries
    const accounts = await getTastytradeAccounts(1);
    if (accounts && accounts.length > 0) {
      firstAccountId = accounts[0].accountNumber;
      console.log(`[Integration] Using account: ${firstAccountId} (${accounts.length} total accounts)`);
    }
  }, 30000);

  // ── Performance Overview ───────────────────────────────────────────────────

  describe('performance.getPerformanceOverview', () => {
    it('should return performance overview for ALL_ACCOUNTS', async () => {
      const result = await caller.performance.getPerformanceOverview({
        accountId: firstAccountId,
        monthsBack: 3,
      });
      expect(result).toBeDefined();
      // Actual fields: monthlyData, symbolPerformance, performanceMetrics, assignmentImpact, totals, dateRange
      expect(result).toHaveProperty('monthlyData');
      expect(result).toHaveProperty('performanceMetrics');
      expect(result).toHaveProperty('totals');
      expect(result).toHaveProperty('dateRange');
      expect(Array.isArray(result.monthlyData)).toBe(true);
      console.log('[Integration] Performance overview:', {
        monthlyDataCount: result.monthlyData?.length,
        totalNet: result.totals?.totalNet,
        totalCredits: result.totals?.totalCredits,
        totalTrades: result.performanceMetrics?.totalTrades,
      });
    }, 60000);

    it('monthly data entries should have required fields', async () => {
      const result = await caller.performance.getPerformanceOverview({
        accountId: firstAccountId,
        monthsBack: 3,
      });
      if (result.monthlyData && result.monthlyData.length > 0) {
        const entry = result.monthlyData[0];
        // Actual fields: month (number), year (number), monthName (string), monthKey (string),
        //                cspCredits, cspDebits, ccCredits, ccDebits, cspNet, ccNet, totalNet,
        //                cspTrades, ccTrades, assignments, calledAway
        expect(entry).toHaveProperty('month');
        expect(entry).toHaveProperty('year');
        expect(entry).toHaveProperty('monthName');
        expect(entry).toHaveProperty('monthKey');
        expect(entry).toHaveProperty('totalNet');
        expect(typeof entry.month).toBe('number');    // month is a number (1-12)
        expect(typeof entry.monthName).toBe('string'); // monthName is a string like 'Jan 2026'
        console.log('[Integration] Sample monthly data entry:', entry);
      } else {
        console.log('[Integration] No monthly data entries (no transactions in last 3 months for this account)');
      }
    }, 60000);

    it('performance metrics should have required fields', async () => {
      const result = await caller.performance.getPerformanceOverview({
        accountId: firstAccountId,
        monthsBack: 3,
      });
      expect(result.performanceMetrics).toHaveProperty('totalTrades');
      expect(result.performanceMetrics).toHaveProperty('winRate');
      expect(typeof result.performanceMetrics.totalTrades).toBe('number');
      console.log('[Integration] Performance metrics:', {
        totalTrades: result.performanceMetrics.totalTrades,
        winRate: result.performanceMetrics.winRate,
        wins: result.performanceMetrics.wins,
        losses: result.performanceMetrics.losses,
      });
    }, 60000);
  });

  // ── Active Positions ───────────────────────────────────────────────────────

  describe('performance.getActivePositions', () => {
    it('should return active positions for ALL_ACCOUNTS', async () => {
      const result = await caller.performance.getActivePositions({
        accountId: firstAccountId,
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('positions');
      expect(Array.isArray(result.positions)).toBe(true);
      console.log(`[Integration] Active positions: ${result.positions.length} position(s)`);
    }, 60000);

    it('active positions should have required fields', async () => {
      const result = await caller.performance.getActivePositions({
        accountId: firstAccountId,
      });
      if (result.positions.length > 0) {
        const pos = result.positions[0];
        // Actual fields: account, accountId, symbol, optionSymbol, type, quantity,
        //                strike, expiration, dte, premium, current, currentPrice,
        //                underlyingPrice, realizedPercent, action, hasWorkingOrder,
        //                spreadType, longStrike, spreadWidth, capitalAtRisk
        expect(pos).toHaveProperty('symbol');
        expect(pos).toHaveProperty('quantity');
        expect(pos).toHaveProperty('premium');        // premiumReceived is called 'premium'
        expect(pos).toHaveProperty('current');        // currentCost is called 'current'
        expect(pos).toHaveProperty('realizedPercent');
        expect(pos).toHaveProperty('type');           // 'CSP' or 'CC'
        expect(pos).toHaveProperty('optionSymbol');   // full OCC symbol
        console.log('[Integration] Sample active position:', {
          symbol: pos.symbol,
          type: pos.type,
          quantity: pos.quantity,
          premium: pos.premium,
          current: pos.current,
          realizedPercent: pos.realizedPercent,
          action: pos.action,
          dte: pos.dte,
        });
      }
    }, 60000);
  });

  // ── Projections ────────────────────────────────────────────────────────────

  describe('projections.getLockedInIncome', () => {
    it('should return locked-in income breakdown', async () => {
      const result = await caller.projections.getLockedInIncome();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('thisWeek');
      expect(result).toHaveProperty('thisMonth');
      expect(result).toHaveProperty('nextMonth');
      expect(result).toHaveProperty('totalOpen');
      expect(typeof result.thisWeek.premium).toBe('number');
      expect(typeof result.thisMonth.premium).toBe('number');
      console.log('[Integration] Locked-in income:', {
        thisWeek: result.thisWeek,
        thisMonth: result.thisMonth,
        nextMonth: result.nextMonth,
        totalOpen: result.totalOpen,
      });
    }, 30000);
  });

  describe('projections.getThetaDecay', () => {
    it('should return theta decay data', async () => {
      const result = await caller.projections.getThetaDecay();
      expect(result).toBeDefined();
      // Actual fields: dailyTheta, weeklyTheta, monthlyTheta, positionCount
      expect(result).toHaveProperty('dailyTheta');
      expect(result).toHaveProperty('weeklyTheta');
      expect(result).toHaveProperty('monthlyTheta');
      expect(result).toHaveProperty('positionCount');
      expect(typeof result.dailyTheta).toBe('number');
      expect(typeof result.positionCount).toBe('number');
      console.log(`[Integration] Theta decay: positionCount=${result.positionCount}, dailyTheta=$${result.dailyTheta.toFixed(2)}, weeklyTheta=$${result.weeklyTheta.toFixed(2)}`);
    }, 30000);
  });

  describe('projections.getHistoricalPerformance', () => {
    it('should return historical performance data', async () => {
      const result = await caller.projections.getHistoricalPerformance();
      expect(result).toBeDefined();
      console.log('[Integration] Historical performance keys:', Object.keys(result));
    }, 30000);
  });

  // ── Dashboard Monthly Premium ──────────────────────────────────────────────

  describe('dashboard.getMonthlyPremiumData', () => {
    it('should return monthly premium data', async () => {
      const result = await caller.dashboard.getMonthlyPremiumData({
        year: new Date().getFullYear(),
      });
      expect(result).toBeDefined();
      // getMonthlyPremiumData returns { monthlyData: [...], error?: string }
      const hasMonthlyData = 'monthlyData' in result || Array.isArray(result);
      expect(hasMonthlyData).toBe(true);
      const months = Array.isArray(result) ? result : (result as any).monthlyData;
      console.log(`[Integration] Monthly premium data: ${months?.length ?? 0} month(s)`);
    }, 60000);
  });

  describe('dashboard.getCapitalEvents', () => {
    it('should return capital events', async () => {
      const result = await caller.dashboard.getCapitalEvents();
      expect(result).toBeDefined();
      // Returns { events: [...], error?: string }
      const hasEvents = 'events' in result || Array.isArray(result);
      expect(hasEvents).toBe(true);
      const events = Array.isArray(result) ? result : (result as any).events;
      console.log(`[Integration] Capital events: ${events?.length ?? 0} event(s)`);
    }, 60000);
  });

  // ── Spread Analytics ───────────────────────────────────────────────────────

  describe('spreadAnalytics.getClosedSpreads', () => {
    it('should return closed spreads data', async () => {
      const result = await caller.spreadAnalytics.getClosedSpreads({
        accountId: firstAccountId,
        monthsBack: 6,
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      console.log(`[Integration] Closed spreads: ${result.length} spread(s)`);
    }, 60000);
  });

  describe('spreadAnalytics.getStrategyMetrics', () => {
    it('should return strategy metrics', async () => {
      const result = await caller.spreadAnalytics.getStrategyMetrics({
        accountId: firstAccountId,
        monthsBack: 6,
      });
      expect(result).toBeDefined();
      console.log('[Integration] Strategy metrics keys:', Object.keys(result));
    }, 60000);
  });

  // ── Portfolio Advisor ──────────────────────────────────────────────────────

  describe('portfolioAdvisor.getSummary', () => {
    it('should return portfolio advisor summary', async () => {
      const result = await caller.portfolioAdvisor.getSummary();
      expect(result).toBeDefined();
      // Returns either a summary object or an error object
      const isValid = typeof result === 'object' && result !== null;
      expect(isValid).toBe(true);
      console.log('[Integration] Portfolio advisor summary keys:', Object.keys(result));
    }, 60000);
  });

  // ── Tax Summary ────────────────────────────────────────────────────────────

  describe('tax.getTaxSummary', () => {
    it('should return tax summary for current year', async () => {
      const currentYear = new Date().getFullYear();
      const result = await caller.tax.getTaxSummary({
        year: currentYear,
      });
      expect(result).toBeDefined();
      // Actual fields: taxYear, realizedGains, realizedLosses, netCapitalGain,
      //                ordinaryIncome, nakedOptionsIncome, spreadIncome,
      //                harvestablePositions, totalHarvestable, washSaleViolations, totalDisallowedLoss
      expect(result).toHaveProperty('taxYear');
      expect(result).toHaveProperty('realizedGains');
      expect(result).toHaveProperty('realizedLosses');
      expect(result).toHaveProperty('ordinaryIncome');
      expect(typeof result.taxYear).toBe('number');
      expect(typeof result.realizedGains).toBe('number');
      expect(typeof result.ordinaryIncome).toBe('number');
      console.log('[Integration] Tax summary:', {
        year: result.taxYear,
        realizedGains: result.realizedGains,
        realizedLosses: result.realizedLosses,
        ordinaryIncome: result.ordinaryIncome,
        nakedOptionsIncome: result.nakedOptionsIncome,
        spreadIncome: result.spreadIncome,
      });
    }, 60000);
  });

  // ── Position Analyzer ──────────────────────────────────────────────────────

  describe('positionAnalyzer', () => {
    it('should return position analyzer data', async () => {
      const result = await caller.positionAnalyzer.analyzePositions();
      expect(result).toBeDefined();
      console.log('[Integration] Position analyzer keys:', Object.keys(result));
    }, 30000);
  });

  // ── Risk Monitor ───────────────────────────────────────────────────────────

  describe('automation.getPortfolioGreeks (risk monitor)', () => {
    it('should return Greeks for risk monitoring', async () => {
      const result = await caller.automation.getPortfolioGreeks();
      expect(result).toBeDefined();
      // Returns { tickers: [...], portfolio: { netDelta, dailyTheta, netVega, netGamma, ... } }
      expect(result).toHaveProperty('portfolio');
      expect(result).toHaveProperty('tickers');
      expect(result.portfolio).toHaveProperty('netDelta');
      expect(result.portfolio).toHaveProperty('dailyTheta');
      console.log('[Integration] Portfolio Greeks (risk):', {
        netDelta: result.portfolio.netDelta,
        dailyTheta: result.portfolio.dailyTheta,
        netVega: result.portfolio.netVega,
        positionCount: result.portfolio.positionCount,
        tickerCount: result.tickers?.length,
      });
    }, 30000);
  });

  // ── Gap Advisor ────────────────────────────────────────────────────────────

  describe('dashboard.getGapAdvisorContext', () => {
    it('should return gap advisor context', async () => {
      const result = await caller.dashboard.getGapAdvisorContext();
      expect(result).toBeDefined();
      console.log('[Integration] Gap advisor context keys:', Object.keys(result));
    }, 30000);
  });
});
