/**
 * PASS 2 — Integration Test Suite 3: Trading Strategies
 *
 * Tests the scan procedures for each strategy:
 *   - CSP (Cash-Secured Puts) — csp.opportunities
 *   - CC (Covered Calls) — cc.getEligiblePositions
 *   - BPS (Bull Put Spread) — spread.opportunities
 *   - Iron Condor — ironCondor.opportunities
 *   - Strategy Advisor — strategyAdvisor.getRecommendation
 *   - Filter Presets — filterPresets.getRecommendedValues
 *   - Watchlist — watchlist.get
 *   - Automation Settings — automation.getSettings
 *
 * Uses a small symbol set (AAPL, MSFT) to keep scan time reasonable.
 * No orders are submitted.
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

// Test symbols — highly liquid, always have options
const TEST_SYMBOLS = ['AAPL', 'MSFT'];

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Integration: Trading Strategies', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const ownerUser = await getOwnerUser();
    caller = appRouter.createCaller(makeCtx(ownerUser));
  }, 15000);

  // ── Watchlist ──────────────────────────────────────────────────────────────

  describe('watchlist.get', () => {
    it('should return watchlist symbols array', async () => {
      const result = await caller.watchlist.get();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      console.log(`[Integration] Watchlist: ${result.length} symbol(s)`, result.slice(0, 5).map((s: any) => s.symbol || s));
    });
  });

  // ── Filter Presets ─────────────────────────────────────────────────────────

  describe('filterPresets.getRecommendedValues', () => {
    it('should return filter presets for CSP conservative', async () => {
      const result = await caller.filterPresets.getRecommendedValues({ strategy: 'csp', presetName: 'conservative' });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('minDelta');
      expect(result).toHaveProperty('maxDelta');
      expect(result).toHaveProperty('minDte');
      expect(result).toHaveProperty('maxDte');
      console.log('[Integration] CSP conservative preset:', result);
    });

    it('should return filter presets for BPS conservative', async () => {
      const result = await caller.filterPresets.getRecommendedValues({ strategy: 'bps', presetName: 'conservative' });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('minDte');
      expect(result).toHaveProperty('maxDte');
      console.log('[Integration] BPS conservative preset:', result);
    });

    it('should return filter presets for CC medium', async () => {
      const result = await caller.filterPresets.getRecommendedValues({ strategy: 'cc', presetName: 'medium' });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('minDte');
      console.log('[Integration] CC medium preset:', result);
    });
  });

  // ── CSP Opportunities ──────────────────────────────────────────────────────

  describe('csp.opportunities', () => {
    it('should return CSP opportunities for AAPL and MSFT', async () => {
      const result = await caller.csp.opportunities({
        symbols: TEST_SYMBOLS,
        minDelta: 0.15,
        maxDelta: 0.35,
        minDte: 7,
        maxDte: 45,
        minVolume: 5,
        minOI: 50,
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      console.log(`[Integration] CSP opportunities: ${result.length} found`);
    }, 60000);

    it('CSP opportunities should have required fields', async () => {
      const result = await caller.csp.opportunities({
        symbols: TEST_SYMBOLS,
        minDelta: 0.15,
        maxDelta: 0.35,
        minDte: 7,
        maxDte: 45,
      });
      if (result.length > 0) {
        const opp = result[0];
        expect(opp).toHaveProperty('symbol');
        expect(opp).toHaveProperty('strike');
        expect(opp).toHaveProperty('expiration');
        expect(opp).toHaveProperty('delta');
        expect(opp).toHaveProperty('bid');
        expect(opp).toHaveProperty('ask');
        expect(opp).toHaveProperty('dte');
        expect(opp).toHaveProperty('score');
        expect(typeof opp.strike).toBe('number');
        expect(typeof opp.delta).toBe('number');
        expect(Math.abs(opp.delta)).toBeLessThanOrEqual(0.5);
        console.log('[Integration] Sample CSP opportunity:', {
          symbol: opp.symbol,
          strike: opp.strike,
          expiration: opp.expiration,
          delta: opp.delta,
          bid: opp.bid,
          dte: opp.dte,
          score: opp.score,
        });
      } else {
        console.log('[Integration] No CSP opportunities found — market may be closed or filters too strict');
      }
    }, 60000);

    it('should return empty array for empty symbols list', async () => {
      const result = await caller.csp.opportunities({ symbols: [] });
      expect(result).toEqual([]);
    });
  });

  // ── BPS Spread Opportunities ──────────────────────────────────────────────

  describe('spread.opportunities (Bull Put Spread)', () => {
    it('should return BPS opportunities for AAPL', async () => {
      const result = await caller.spread.opportunities({
        symbols: ['AAPL'],
        spreadWidth: 5,
        minDelta: 0.15,
        maxDelta: 0.35,
        minDte: 7,
        maxDte: 45,
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      console.log(`[Integration] BPS opportunities for AAPL: ${result.length} found`);
    }, 90000);

    it('BPS opportunities should have spread-specific fields', async () => {
      const result = await caller.spread.opportunities({
        symbols: ['AAPL'],
        spreadWidth: 5,
        minDelta: 0.15,
        maxDelta: 0.35,
        minDte: 7,
        maxDte: 45,
      });
      if (result.length > 0) {
        const opp = result[0];
        // BPS returns CSP fields + spread-specific fields
        // The short strike is in 'strike' (inherited from CSP), long strike in 'longStrike'
        expect(opp).toHaveProperty('symbol');
        expect(opp).toHaveProperty('strike');       // short strike
        expect(opp).toHaveProperty('longStrike');   // long strike
        expect(opp).toHaveProperty('spreadWidth');
        expect(opp).toHaveProperty('netCredit');
        expect(opp).toHaveProperty('spreadROC');    // return on capital
        expect(opp).toHaveProperty('capitalAtRisk');
        expect(opp).toHaveProperty('score');
        expect(typeof opp.strike).toBe('number');
        expect(typeof opp.longStrike).toBe('number');
        expect(opp.strike).toBeGreaterThan(opp.longStrike); // short > long for put spread
        console.log('[Integration] Sample BPS opportunity:', {
          symbol: opp.symbol,
          strike: opp.strike,
          longStrike: opp.longStrike,
          netCredit: opp.netCredit,
          spreadROC: opp.spreadROC,
          capitalAtRisk: opp.capitalAtRisk,
          score: opp.score,
        });
      } else {
        console.log('[Integration] No BPS opportunities found — market may be closed or filters too strict');
      }
    }, 90000);

    it('should return empty array for empty symbols list', async () => {
      const result = await caller.spread.opportunities({ symbols: [], spreadWidth: 5 });
      expect(result).toEqual([]);
    });
  });

  // ── Iron Condor Opportunities ──────────────────────────────────────────────

  describe('ironCondor.opportunities', () => {
    it('should return Iron Condor opportunities for AAPL', async () => {
      const result = await caller.ironCondor.opportunities({
        symbols: ['AAPL'],
        spreadWidth: 5,
        minDelta: 0.15,
        maxDelta: 0.35,
        minDte: 7,
        maxDte: 45,
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      console.log(`[Integration] Iron Condor opportunities for AAPL: ${result.length} found`);
    }, 120000);

    it('IC opportunities should have both put and call side fields', async () => {
      const result = await caller.ironCondor.opportunities({
        symbols: ['AAPL'],
        spreadWidth: 5,
        minDelta: 0.15,
        maxDelta: 0.35,
        minDte: 7,
        maxDte: 45,
      });
      if (result.length > 0) {
        const ic = result[0];
        expect(ic).toHaveProperty('symbol');
        expect(ic).toHaveProperty('putShortStrike');
        expect(ic).toHaveProperty('callShortStrike');
        expect(ic).toHaveProperty('totalNetCredit');  // IC uses totalNetCredit not totalCredit
        expect(ic).toHaveProperty('dte');
        expect(ic).toHaveProperty('score');
        expect(ic).toHaveProperty('riskBadges');
        // Put side should be below call side
        expect(ic.putShortStrike).toBeLessThan(ic.callShortStrike);
        console.log('[Integration] Sample IC opportunity:', {
          symbol: ic.symbol,
          putShortStrike: ic.putShortStrike,
          callShortStrike: ic.callShortStrike,
          totalNetCredit: ic.totalNetCredit,
          dte: ic.dte,
          score: ic.score,
        });
      } else {
        console.log('[Integration] No IC opportunities found — market may be closed or filters too strict');
      }
    }, 120000);

    it('should return empty array for empty symbols list', async () => {
      const result = await caller.ironCondor.opportunities({ symbols: [], spreadWidth: 5 });
      expect(result).toEqual([]);
    });
  });

  // ── CC (Covered Calls) ─────────────────────────────────────────────────────

  describe('cc.getEligiblePositions', () => {
    it('should return { holdings, breakdown } for covered calls', async () => {
      // getEligiblePositions requires { accountNumber: string } — use ALL_ACCOUNTS sentinel
      const accounts = await caller.accounts.list();
      const accountNumber = accounts.length > 0 ? accounts[0].accountNumber : 'ALL_ACCOUNTS';
      const result = await caller.cc.getEligiblePositions({ accountNumber });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('holdings');
      expect(result).toHaveProperty('breakdown');
      expect(Array.isArray(result.holdings)).toBe(true);
      expect(result.breakdown).toHaveProperty('totalPositions');
      expect(result.breakdown).toHaveProperty('eligiblePositions');
      console.log(`[Integration] CC eligible positions: ${result.holdings.length} holding(s), ${result.breakdown.eligiblePositions} eligible`);
      if (result.holdings.length > 0) {
        const h = result.holdings[0];
        expect(h).toHaveProperty('symbol');
        expect(h).toHaveProperty('quantity');
        expect(h).toHaveProperty('maxContracts');
        console.log('[Integration] Sample CC holding:', { symbol: h.symbol, quantity: h.quantity, maxContracts: h.maxContracts });
      }
    }, 30000);
  });

  // ── Strategy Advisor ───────────────────────────────────────────────────────

  describe('strategyAdvisor.getRecommendation', () => {
    it('should return recommendation object (or credentials error)', async () => {
      const result = await caller.strategyAdvisor.getRecommendation({ scanType: 'equity' });
      expect(result).toBeDefined();
      // Either returns a recommendation or a credentials/config error
      const hasExpectedShape = 'recommendation' in result || 'error' in result || 'rankedTickers' in result;
      expect(hasExpectedShape).toBe(true);
      if ('error' in result && result.error) {
        console.log('[Integration] Strategy Advisor error (expected if no credentials):', result.error);
      } else {
        console.log('[Integration] Strategy Advisor result:', {
          strategy: (result as any).recommendation?.strategy,
          confidence: (result as any).recommendation?.confidence,
          tickerCount: (result as any).rankedTickers?.length,
        });
      }
    }, 120000);
  });

  // ── Automation Settings ────────────────────────────────────────────────────

  describe('automation.getSettings', () => {
    it('should return automation settings with dryRunMode and autoScheduleEnabled fields', async () => {
      const result = await caller.automation.getSettings();
      expect(result).toBeDefined();
      // The settings row has dryRunMode, requireApproval, autoScheduleEnabled, profitThresholdPercent, etc.
      expect(result).toHaveProperty('dryRunMode');
      expect(result).toHaveProperty('autoScheduleEnabled');
      expect(result).toHaveProperty('requireApproval');
      expect(result).toHaveProperty('profitThresholdPercent');
      console.log('[Integration] Automation settings:', {
        dryRunMode: result.dryRunMode,
        autoScheduleEnabled: result.autoScheduleEnabled,
        requireApproval: result.requireApproval,
        profitThresholdPercent: result.profitThresholdPercent,
      });
    });
  });
});
