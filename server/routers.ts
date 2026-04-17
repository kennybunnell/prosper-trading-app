import { COOKIE_NAME } from "@shared/const";
import { withRateLimit } from './tradierRateLimiter';
import { writeTradingLog } from './routers-trading-log';
import { addPartitionedAttribute, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { ccRouter } from "./routers-cc";
import { pmccRouter } from "./routers-pmcc";
import { performanceRouter } from "./routers-performance";
import { workingOrdersRouter } from "./routers-working-orders";
import { rollsRouter } from "./routers-rolls";
import { rollRecommendationsRouter } from "./routers-roll-recommendations";
import { ordersRouter } from "./routers-orders";
import { marketRouter } from "./routers-market";
import { userRouter } from "./routers-user";
import { paperTradingRouter } from "./routers-paper-trading";
import { demoRouter } from "./routers/demo";
import { adminRouter } from "./routers-admin";
import { feedbackRouter } from "./routers-feedback";
import { inboxRouter } from "./routers-inbox";
import { chatRouter } from "./routers-chat";
import { validationRouter } from './routers-validation';
import { stripeRouter } from './routers-stripe';
import { spreadAnalyticsRouter } from './routers-spread-analytics';
import { strategyAdvisorRouter } from './routers-strategy-advisor';
import { taxRouter } from './routers-tax';
import { portfolioAdvisorRouter } from './routers-portfolio-advisor';
import { automationRouter } from './routers-automation';
import { iraSafetyRouter } from './routers-ira-safety';
import { chartsRouter } from './routers-charts';
import { positionAnalyzerRouter } from './routers-position-analyzer';
import { safeguardsRouter } from './routers-safeguards';
import { portfolioSyncRouter } from './routers-portfolio-sync';
import { tradingLogRouter } from './routers-trading-log';
import { sendTelegramMessage, fmtOrderFilled, fmtOrderRejected } from './telegram';

// Helper function to parse OCC option symbols
function parseOptionSymbol(symbol: string): { underlying: string; expiration: string; optionType: string; strike: number } | null {
  try {
    const cleanSymbol = symbol.replace(/\s/g, '');
    const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (match) {
      const underlying = match[1];
      const dateStr = match[2];
      const optionType = match[3] === 'P' ? 'PUT' : 'CALL';
      const strike = parseInt(match[4]) / 1000;
      const year = 2000 + parseInt(dateStr.substring(0, 2));
      const month = parseInt(dateStr.substring(2, 4));
      const day = parseInt(dateStr.substring(4, 6));
      const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { underlying, expiration, optionType, strike };
    }
  } catch (error) {
    return null;
  }
  return null;
}

const projectionsRouter = router({
  getLockedInIncome: protectedProcedure.query(async ({ ctx }) => {
    // ── Read from DB cache ────────────────────────────────────────────────────────────────
    const { getLivePositions } = await import('./portfolio-sync');
    const allCachedPos = await getLivePositions(ctx.user.id);
    if (allCachedPos.length === 0) {
      return {
        thisWeek: { premium: 0, positions: 0 },
        thisMonth: { premium: 0, positions: 0 },
        nextMonth: { premium: 0, positions: 0 },
        totalOpen: { premium: 0, positions: 0 },
      };
    }

    const now = new Date();
    const thisWeekEnd = new Date(now);
    thisWeekEnd.setDate(now.getDate() + (5 - now.getDay())); // Friday
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    const income = {
      thisWeek: { premium: 0, positions: 0 },
      thisMonth: { premium: 0, positions: 0 },
      nextMonth: { premium: 0, positions: 0 },
      totalOpen: { premium: 0, positions: 0 },
    };

    // Group by account number (reuse same loop structure)
    const accountNumbers = Array.from(new Set(allCachedPos.map(p => p['account-number'])));
    for (const accountNumber of accountNumbers) {
      const positions = allCachedPos
        .filter(p => p['account-number'] === accountNumber)
        .map(p => ({ ...p }));
      if (!positions) continue;

      for (const pos of positions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;

        const quantity = parseInt(String(pos.quantity || '0'));
        const quantityDirection = pos['quantity-direction'];
        const isShort = quantityDirection?.toLowerCase() === 'short' || quantity < 0;

        if (!isShort) continue;

        const symbol = pos.symbol || '';
        const parsed = parseOptionSymbol(symbol);
        if (!parsed) continue;

        const openPrice = parseFloat(String(pos['average-open-price'] || '0'));
        const multiplier = parseInt(String(pos.multiplier || '100'));
        const qty = Math.abs(quantity);
        const premium = openPrice * qty * multiplier;

        const expDate = new Date(parsed.expiration);

        income.totalOpen.premium += premium;
        income.totalOpen.positions += 1;

        if (expDate <= thisWeekEnd) {
          income.thisWeek.premium += premium;
          income.thisWeek.positions += 1;
        } else if (expDate <= thisMonthEnd) {
          income.thisMonth.premium += premium;
          income.thisMonth.positions += 1;
        } else if (expDate <= nextMonthEnd) {
          income.nextMonth.premium += premium;
          income.nextMonth.positions += 1;
        }
      }
    }

    return income;
  }),

  getThetaDecay: protectedProcedure.query(async ({ ctx }) => {
    // ── Read from DB cache ────────────────────────────────────────────────────────────────
    const { getLivePositions } = await import('./portfolio-sync');
    const allCachedPos = await getLivePositions(ctx.user.id);
    if (allCachedPos.length === 0) {
      return { dailyTheta: 0, weeklyTheta: 0, monthlyTheta: 0, positionCount: 0 };
    }

    let totalTheta = 0;
    let positionCount = 0;
    const positions = allCachedPos.map(p => ({ ...p }));

    // Dummy loop to match original structure
    for (const accountNumber of [null]) {
      if (!positions) continue;

      for (const pos of positions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;

        const quantity = parseInt(String(pos.quantity || '0'));
        const quantityDirection = pos['quantity-direction'];
        const isShort = quantityDirection?.toLowerCase() === 'short' || quantity < 0;

        if (!isShort) continue;

        const symbol = pos.symbol || '';
        const parsed = parseOptionSymbol(symbol);
        if (!parsed) continue;

        const currentPrice = parseFloat(String((pos as any)['close-price'] || '0'));
        const multiplier = parseInt(String(pos.multiplier || '100'));
        const qty = Math.abs(quantity);
        const currentValue = currentPrice * qty * multiplier;

        const expDate = new Date(parsed.expiration);
        const now = new Date();
        const dte = Math.max(0, Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

        if (dte > 0) {
          let acceleration = 1.0;
          if (dte <= 7) acceleration = 2.0;
          else if (dte <= 21) acceleration = 1.5;

          const dailyTheta = (currentValue / dte) * acceleration;
          totalTheta += dailyTheta;
          positionCount += 1;
        }
      }
    }

    return {
      dailyTheta: totalTheta,
      weeklyTheta: totalTheta * 5,
      monthlyTheta: totalTheta * 21,
      positionCount,
    };
  }),

  getHistoricalPerformance: protectedProcedure.query(async ({ ctx }) => {
    // ── Read from DB cache ────────────────────────────────────────────────────────────────
    const { getCachedTransactions, cachedTxnToWireFormat } = await import('./portfolio-sync');
    const allCachedTxns = await getCachedTransactions(ctx.user.id);
    if (allCachedTxns.length === 0) {
      return {
        totalCredits: 0, totalDebits: 0, netPremium: 0,
        avgMonthlyPremium: 0, monthsAnalyzed: 0, winRate: 0, monthlyBreakdown: [],
      };
    }

    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    const sixMonthsAgoMs = sixMonthsAgo.getTime();

    const monthlyPremiums: Record<string, number> = {};
    let totalCredits = 0;
    let totalDebits = 0;

    // Filter to last 6 months and convert to wire format
    const transactions = allCachedTxns
      .filter(t => t.executedAt && new Date(t.executedAt).getTime() >= sixMonthsAgoMs)
      .map(t => cachedTxnToWireFormat(t));

    for (const accountNumber of [null]) {
      const _ = accountNumber; // unused, kept for structure

      for (const txn of transactions) {
        const tType = txn['transaction-type'];
        const action = txn.action || '';
        const value = parseFloat(txn.value || '0');
        const executedAt = txn['executed-at'];
        const symbol = txn.symbol || '';

        if (!['Trade', 'Receive Deliver'].includes(tType)) continue;

        const parsed = parseOptionSymbol(symbol);
        if (!parsed) continue;

        if (!executedAt) continue;

        const txnDate = new Date(executedAt);
        const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;

        if (action === 'Sell to Open') {
          totalCredits += Math.abs(value);
          monthlyPremiums[monthKey] = (monthlyPremiums[monthKey] || 0) + Math.abs(value);
        } else if (action === 'Buy to Close') {
          totalDebits += Math.abs(value);
          monthlyPremiums[monthKey] = (monthlyPremiums[monthKey] || 0) - Math.abs(value);
        }
      }
    }

    const netPremium = totalCredits - totalDebits;
    const monthsWithData = Object.keys(monthlyPremiums).length;
    const avgMonthlyPremium = monthsWithData > 0 ? netPremium / monthsWithData : 0;

    const monthlyValues = Object.values(monthlyPremiums);
    const positiveMonths = monthlyValues.filter(v => v > 0).length;
    const winRate = monthsWithData > 0 ? (positiveMonths / monthsWithData) * 100 : 0;

    return {
      totalCredits,
      totalDebits,
      netPremium,
      avgMonthlyPremium,
      monthsAnalyzed: monthsWithData,
      winRate,
      monthlyBreakdown: monthlyPremiums,
    };
  }),
});

export type AppRouter = typeof appRouter;

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  user: userRouter,
  admin: adminRouter,
  feedback: feedbackRouter,
  inbox: inboxRouter,
  chat: chatRouter,
  validation: validationRouter,
  stripe: stripeRouter,
  demo: demoRouter,
  paperTrading: paperTradingRouter,
  pmcc: pmccRouter,
  performance: performanceRouter,
  workingOrders: workingOrdersRouter,
  projections: projectionsRouter,
  spreadAnalytics: spreadAnalyticsRouter,
  strategyAdvisor: strategyAdvisorRouter,
  tax: taxRouter,
  portfolioAdvisor: portfolioAdvisorRouter,
  automation: automationRouter,
  iraSafety: iraSafetyRouter,
  charts: chartsRouter,
  positionAnalyzer: positionAnalyzerRouter,
  safeguards: safeguardsRouter,
  rolls: rollsRouter,
  rollRecommendations: rollRecommendationsRouter,
  portfolioSync: portfolioSyncRouter,
  tradingLog: tradingLogRouter,
  orders: ordersRouter,
  market: marketRouter,
  dashboard: router({
    /**
     * Get monthly premium data across ALL accounts (account-independent)
     * Returns last 6 months of premium data for the main dashboard chart
     * Uses Tastytrade API to fetch real transaction data
     */
    getMonthlyPremiumData: protectedProcedure
      .input(z.object({
        year: z.number().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        // ── LIVE API — bypasses DB cache entirely ─────────────────────────────────────────────
        // Fetches transactions directly from Tastytrade for every account on every request.
        // No caching layer — always reflects the current state of your accounts.
        try {
          const { getApiCredentials } = await import('./db');
          const { authenticateTastytrade } = await import('./tastytrade');
          const credentials = await getApiCredentials(ctx.user.id);
          if (!credentials?.tastytradeRefreshToken) {
            return { monthlyData: [], error: 'Tastytrade credentials not configured. Please add them in Settings.' };
          }
          const tt = await authenticateTastytrade(credentials, ctx.user.id);
          if (!tt) {
            return { monthlyData: [], error: 'Failed to authenticate with Tastytrade.' };
          }

          // Get all accounts
          const accounts = await tt.getAccounts();
          const accountNumbers: string[] = accounts
            .map((acc: any) => acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber)
            .filter(Boolean);

          if (accountNumbers.length === 0) {
            return { monthlyData: [], error: 'No Tastytrade accounts found.' };
          }

          const now = new Date();
          const selectedYear = input?.year;
          let startDateStr: string;
          let endDateStr: string;
          let startDate: Date;
          let endDate: Date;

          if (selectedYear) {
            startDate = new Date(selectedYear, 0, 1);
            endDate = new Date(selectedYear, 11, 31);
            startDateStr = `${selectedYear}-01-01`;
            endDateStr = `${selectedYear}-12-31`;
          } else {
            // Last 6 months
            const sm = now.getMonth() - 5;
            const sy = now.getFullYear() + Math.floor(sm / 12);
            const am = ((sm % 12) + 12) % 12;
            startDate = new Date(sy, am, 1);
            endDate = now;
            startDateStr = `${sy}-${String(am + 1).padStart(2, '0')}-01`;
            endDateStr = now.toISOString().split('T')[0];
          }

          const startMs = startDate.getTime();
          const endMs = endDate.getTime();

          console.log(`[Dashboard] Live fetch: ${accountNumbers.length} accounts, ${startDateStr} → ${endDateStr}`);

          const monthlyData: Record<string, { credits: number; debits: number }> = {};

          // Fetch all accounts in parallel for speed
          await Promise.all(accountNumbers.map(async (accountNumber: string) => {
            try {
              const rawTxns = await tt.getTransactionHistory(accountNumber, startDateStr, endDateStr);
              console.log(`[Dashboard] Account ${accountNumber}: ${rawTxns.length} raw transactions from TT API`);

              for (const txn of rawTxns) {
                const txnType = txn['transaction-type'];
                if (txnType !== 'Trade') continue;

                const txnSymbol: string = txn['symbol'] || '';
                const isOptionSymbol = /[A-Z0-9]+\s*\d{6}[CP]\d+/.test(txnSymbol);
                if (!isOptionSymbol) continue;

                const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
                const netValueEffect = txn['net-value-effect'];
                const executedAt = txn['executed-at'];

                if (!executedAt || netValue === 0 || !netValueEffect) continue;

                const txnDate = new Date(executedAt);
                if (txnDate.getTime() < startMs || txnDate.getTime() > endMs) continue;

                const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
                if (!monthlyData[monthKey]) monthlyData[monthKey] = { credits: 0, debits: 0 };

                if (netValueEffect === 'Credit') {
                  monthlyData[monthKey].credits += netValue;
                } else if (netValueEffect === 'Debit') {
                  monthlyData[monthKey].debits += netValue;
                }
              }
            } catch (err: any) {
              console.error(`[Dashboard] Live fetch failed for account ${accountNumber}:`, err.message);
            }
          }));

          // Generate month list
          const months: string[] = [];
          if (selectedYear) {
            for (let m = 0; m < 12; m++) {
              months.push(`${selectedYear}-${String(m + 1).padStart(2, '0')}`);
            }
          } else {
            for (let i = 5; i >= 0; i--) {
              const m = now.getMonth() - i;
              const y = now.getFullYear() + Math.floor(m / 12);
              const am = ((m % 12) + 12) % 12;
              months.push(`${y}-${String(am + 1).padStart(2, '0')}`);
            }
          }

          let cumulative = 0;
          const result = months.map(month => {
            const data = monthlyData[month] || { credits: 0, debits: 0 };
            const netPremium = data.credits - data.debits;
            cumulative += netPremium;
            if (data.credits > 0 || data.debits > 0) {
              console.log(`[Dashboard] ${month}: Credits=$${data.credits.toFixed(2)}, Debits=$${data.debits.toFixed(2)}, Net=$${netPremium.toFixed(2)}`);
            }
            return {
              month,
              netPremium: Math.round(netPremium * 100) / 100,
              cumulative: Math.round(cumulative * 100) / 100,
            };
          });

          console.log('[Dashboard] Live monthly premium result:', result.filter(r => r.netPremium !== 0));
          return { monthlyData: result };
        } catch (error: any) {
          console.error('[Dashboard] Error fetching live monthly premium data:', error);
          return { monthlyData: [], error: error.message };
        }
      }),

    /**
     * Get capital events (stock transactions) across all accounts
     * These are assignments, share purchases, liquidations, and harvest exits
     * Separated from premium income so they don't pollute the options scorecard
     */
    getCapitalEvents: protectedProcedure
      .input(z.object({
        year: z.number().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        // ── Read from DB cache ────────────────────────────────────────────────────────────────
        try {
          const { getCachedTransactions, cachedTxnToWireFormat } = await import('./portfolio-sync');
          const allCachedTxns = await getCachedTransactions(ctx.user.id);
          if (allCachedTxns.length === 0) return { events: [], error: 'No cached transaction data. Please run a portfolio sync from Settings.' };

          const now = new Date();
          const selectedYear = input?.year;
          let startDate: Date;
          let endDate: Date;

          if (selectedYear) {
            startDate = new Date(selectedYear, 0, 1);
            endDate = new Date(selectedYear, 11, 31);
          } else {
            const startMonth = now.getMonth() - 5;
            const startYear = now.getFullYear() + Math.floor(startMonth / 12);
            const adjustedStartMonth = ((startMonth % 12) + 12) % 12;
            startDate = new Date(startYear, adjustedStartMonth, 1);
            endDate = now;
          }

          const startMs = startDate.getTime();
          const endMs = endDate.getTime();
          const transactions = allCachedTxns
            .filter(t => {
              if (!t.executedAt) return false;
              const ms = new Date(t.executedAt).getTime();
              return ms >= startMs && ms <= endMs;
            })
            .map(t => cachedTxnToWireFormat(t));

          const events: Array<{
            date: string;
            symbol: string;
            description: string;
            action: string;
            quantity: number;
            pricePerShare: number;
            netValue: number;
            netValueEffect: string;
            accountNumber: string;
            accountName: string;
            eventType: 'assignment' | 'purchase' | 'sale' | 'other';
          }> = [];

          for (const txn of transactions) {
            if (txn['transaction-type'] !== 'Trade') continue;
            const txnSymbol: string = txn['symbol'] || '';
            const isOptionSymbol = /[A-Z0-9]+\s*\d{6}[CP]\d+/.test(txnSymbol);
            if (isOptionSymbol) continue;
            if (!txnSymbol) continue;
            const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
            if (netValue === 0) continue;
            const executedAt = txn['executed-at'];
            if (!executedAt) continue;
            const description: string = txn['description'] || '';
            const action: string = txn['action'] || '';
            const quantity = Math.abs(parseFloat(txn['quantity'] || '0'));
            const price = quantity > 0 ? netValue / quantity : 0;
            let eventType: 'assignment' | 'purchase' | 'sale' | 'other' = 'other';
            const descLower = description.toLowerCase();
            if (descLower.includes('assignment') || descLower.includes('assigned')) {
              eventType = 'assignment';
            } else if (action === 'Buy' || action === 'Buy to Open') {
              eventType = 'purchase';
            } else if (action === 'Sell' || action === 'Sell to Close') {
              eventType = 'sale';
            }
            events.push({
              date: executedAt,
              symbol: txnSymbol,
              description,
              action,
              quantity,
              pricePerShare: Math.round(price * 100) / 100,
              netValue: Math.round(netValue * 100) / 100,
              netValueEffect: txn['net-value-effect'] || '',
              accountNumber: (txn as any)['account-number'] || 'cache',
              accountName: (txn as any)['account-number'] || 'All Accounts',
              eventType,
            });
          }

          // Sort by date descending (most recent first)
          events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          return { events };
        } catch (error: any) {
          console.error('[CapitalEvents] Error:', error);
          return { events: [], error: error.message };
        }
      }),

    /**
     * Returns cached daily scan counts (Close for Profit, Roll Positions, Sell Calls).
     * Populated by the 8:30 AM ET scheduled cron job — no live API call on page load.
     */
    getDailyActionCounts: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (!db) return { closeProfitCount: null, rollPositionsCount: null, sellCallsCount: null, scannedAt: null, scanSuccess: null, closeProfitItems: [], rollPositionsItems: [], sellCallsItems: [] };

        const { dailyScanCache } = await import('../drizzle/schema');
        const { eq, desc } = await import('drizzle-orm');

        const [row] = await db
          .select()
          .from(dailyScanCache)
          .where(eq(dailyScanCache.userId, ctx.user.id))
          .orderBy(desc(dailyScanCache.scannedAt))
          .limit(1);

        if (!row) return { closeProfitCount: null, rollPositionsCount: null, sellCallsCount: null, scannedAt: null, scanSuccess: null, closeProfitItems: [], rollPositionsItems: [], sellCallsItems: [] };

        const safeParse = (s: string | null | undefined): any[] => {
          if (!s) return [];
          try { return JSON.parse(s); } catch { return []; }
        };

        return {
          closeProfitCount: row.closeProfitCount,
          rollPositionsCount: row.rollPositionsCount,
          sellCallsCount: row.sellCallsCount,
          scannedAt: row.scannedAt,
          scanSuccess: row.scanSuccess,
          closeProfitItems: safeParse(row.closeProfitItems),
          rollPositionsItems: safeParse(row.rollPositionsItems),
          sellCallsItems: safeParse(row.sellCallsItems),
        };
      } catch (e) {
        console.error('[getDailyActionCounts] Error:', e);
        return { closeProfitCount: null, rollPositionsCount: null, sellCallsCount: null, scannedAt: null, scanSuccess: null, closeProfitItems: [], rollPositionsItems: [], sellCallsItems: [] };
      }
    }),

    /**
     * Manually trigger a fresh daily scan (used by "Scan Now" buttons on Home dashboard).
     * Runs the same logic as the 8:30 AM ET cron job.
     */
    triggerDailyScan: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const { runDailyScan } = await import('./daily-scan');
        const result = await runDailyScan(ctx.user.id);
        return result;
      } catch (e: any) {
        console.error('[triggerDailyScan] Error:', e);
        return { success: false, closeProfitCount: 0, rollPositionsCount: 0, sellCallsCount: 0, error: e?.message || 'Unknown error' };
      }
    }),

    /**
     * Gather context for the Gap Advisor AI modal.
     * Collects: buying power, covered call candidates, SPX spread scan, velocity math.
     * This is intentionally on-demand (not cached) — user clicks the AI button.
     */
    getGapAdvisorContext: protectedProcedure.query(async ({ ctx }) => {
      const { getApiCredentials, getUserPreferences } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      const prefs = await getUserPreferences(ctx.user.id);
      const target = prefs?.monthlyIncomeTarget ?? 150000;

      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { error: 'Tastytrade credentials not configured', target, collected: 0, gap: target };
      }

      // ── Load from DB cache (positions + transactions) ───────────────────────────────────────
      const { getLivePositions, getCachedTransactions, cachedTxnToWireFormat } = await import('./portfolio-sync');
      const [cachedPositions, allCachedTxns] = await Promise.all([
        getLivePositions(ctx.user.id),
        getCachedTransactions(ctx.user.id),
      ]);
      const wirePositions = cachedPositions; // Live positions already in wire format

      // ── 1. Buying power — MUST stay live (real-time balance) ──────────────────────────────
      let totalBuyingPower = 0;
      let accountSummaries: { accountNumber: string; nickname: string; buyingPower: number }[] = [];
      try {
        const { authenticateTastytrade } = await import('./tastytrade');
        const api = await authenticateTastytrade(credentials, ctx.user.id);
        const accounts = await api.getAccounts();
        for (const acct of accounts) {
          const accNum = acct.account['account-number'];
          const nickname = acct.account.nickname || accNum;
          try {
            const balances = await api.getBalances(accNum);
            const bp = parseFloat(
              balances?.['derivative-buying-power'] ||
              balances?.['equity-buying-power'] ||
              balances?.['net-liquidating-value'] || '0'
            );
            totalBuyingPower += bp;
            accountSummaries.push({ accountNumber: accNum, nickname, buyingPower: bp });
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      // ── 2. Monthly collected so far — from DB cache ──────────────────────────────────────
      let collected = 0;
      try {
        const now = new Date();
        const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        let credits = 0, debits = 0;
        for (const t of allCachedTxns) {
          if (!t.executedAt || new Date(t.executedAt).getTime() < monthStartMs) continue;
          if (t.transactionType !== 'Trade') continue;
          const sym = t.symbol || '';
          if (!/[A-Z0-9]+\s*\d{6}[CP]\d+/.test(sym)) continue;
          const val = Math.abs(parseFloat(String(t.netValue || '0')));
          if (!val) continue;
          // Use action field for direction — value is always stored positive in DB
          const act = (t.action || '').toLowerCase();
          const isCredit = act.startsWith('sell');
          const isDebit = act.startsWith('buy');
          if (isCredit) credits += val;
          else if (isDebit) debits += val;
        }
        collected = Math.round((credits - debits) * 100) / 100;
      } catch { /* skip */ }

      const gap = Math.max(0, target - collected);

      // ── 3. Covered call candidates — from DB cache ──────────────────────────────────────
      let ccCandidates: { symbol: string; shares: number; avgCost: number; currentPrice: number; recommendation: string }[] = [];
      try {
        const longEquity = wirePositions.filter((p: any) =>
          p['instrument-type'] === 'Equity' &&
          p['quantity-direction'] === 'Long' &&
          parseFloat(p.quantity || '0') >= 100
        );
        const shortCalls = new Set(
          wirePositions
            .filter((p: any) => p['instrument-type'] === 'Equity Option' && p['quantity-direction'] === 'Short')
            .map((p: any) => (p['underlying-symbol'] || '').toUpperCase())
        );
        for (const pos of longEquity) {
          const sym = (pos['underlying-symbol'] || pos.symbol || '').toUpperCase();
          if (shortCalls.has(sym)) continue;
          const shares = parseFloat(String(pos.quantity || '0'));
          const avgCost = parseFloat(pos['average-open-price'] || '0');
          const currentPrice = parseFloat(pos['close-price'] || '0');
          const pctFromCost = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
          const recommendation = pctFromCost <= -40 ? 'LIQUIDATE' : pctFromCost <= -20 ? 'HARVEST' : 'MONITOR';
          if (recommendation !== 'LIQUIDATE') ccCandidates.push({ symbol: sym, shares, avgCost, currentPrice, recommendation });
        }
      } catch { /* skip */ }

      // ── 4. Account-type classification — from accountSummaries (live balances already fetched) ───
      const accountTypeBreakdown = accountSummaries.map(acct => {
        const nick = acct.nickname.toLowerCase();
        let type = 'Cash';
        if (nick.includes('ira') || nick.includes('roth') || nick.includes('traditional')) type = 'IRA';
        else if (nick.includes('heloc') || nick.includes('home equity') || nick.includes('line of credit')) type = 'HELOC';
        else if (nick.includes('llc') || nick.includes('entity') || nick.includes('business') || nick.includes('trust')) type = 'LLC/Entity';
        const spreadOnly = type === 'IRA';
        return { ...acct, type, spreadOnly };
      });

      // ── 5. 90-day strategy history — from DB cache ───────────────────────────────────────────
      let strategyHistory = { spxSpreads: 0, csps: 0, coveredCalls: 0, ironCondors: 0, totalTrades: 0 };
      let topCspTickers: { symbol: string; count: number; avgPremium: number }[] = [];
      const MAG7 = new Set(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA']);
      try {
        const now90 = new Date();
        const start90Ms = new Date(now90.getTime() - 90 * 86400000).getTime();
        const cspMap: Record<string, { count: number; totalPremium: number }> = {};
        for (const t of allCachedTxns) {
          if (!t.executedAt || new Date(t.executedAt).getTime() < start90Ms) continue;
          if (t.transactionType !== 'Trade') continue;
          const sym = t.symbol || '';
          const desc = (t.description || '').toLowerCase();
          const isOption = /[A-Z0-9]+\s*\d{6}[CP]\d+/.test(sym);
          if (!isOption) continue;
          strategyHistory.totalTrades++;
          const underlying = (sym.match(/^([A-Z0-9]+)\s*\d{6}/) || [])[1] || '';
          const isSpx = ['SPX', 'SPXW', 'NDX', 'XSP', 'RUT'].includes(underlying);
          const isPut = sym.includes('P') && !sym.includes('C');
          const isCall = sym.includes('C') && !sym.includes('P');
          // Use action field for direction — value is always stored positive in DB
          const isSTO = (t.action || '').toLowerCase().startsWith('sell');
          if (isSpx && isSTO) strategyHistory.spxSpreads++;
          else if (!isSpx && isPut && isSTO) {
            strategyHistory.csps++;
            if (underlying) {
              if (!cspMap[underlying]) cspMap[underlying] = { count: 0, totalPremium: 0 };
              cspMap[underlying].count++;
              cspMap[underlying].totalPremium += Math.abs(parseFloat(String(t.netValue || '0')));
            }
          } else if (!isSpx && isCall && isSTO) strategyHistory.coveredCalls++;
          if (isSpx && isSTO && (desc.includes('condor') || desc.includes('iron'))) strategyHistory.ironCondors++;
        }
        topCspTickers = Object.entries(cspMap)
          .map(([symbol, data]) => ({ symbol, count: data.count, avgPremium: data.count > 0 ? Math.round(data.totalPremium / data.count) : 0 }))
          .sort((a, b) => {
            const aMag = MAG7.has(a.symbol) ? 1 : 0;
            const bMag = MAG7.has(b.symbol) ? 1 : 0;
            if (bMag !== aMag) return bMag - aMag;
            return b.count - a.count;
          })
          .slice(0, 10);
      } catch { /* skip */ }

      // ── 6. Live VIX level ────────────────────────────────────────────────────
      let vix: number | null = null;
      let vixLabel = 'unknown';
      try {
        if (credentials?.tradierApiKey) {
          const { createTradierAPI } = await import('./tradier');
          const tradierApi = createTradierAPI(credentials.tradierApiKey, false, ctx.user.id);
          const vixQuote = await tradierApi.getQuote('VIX');
          const vixLast = vixQuote?.last ?? vixQuote?.close ?? null;
          if (vixLast && !isNaN(Number(vixLast))) {
            vix = Math.round(Number(vixLast) * 100) / 100;
            if (vix >= 30) vixLabel = 'HIGH (≥30) — elevated fear, premium-rich environment';
            else if (vix >= 20) vixLabel = 'ELEVATED (20–29) — above-average volatility';
            else if (vix >= 15) vixLabel = 'MODERATE (15–19) — normal range';
            else vixLabel = 'LOW (<15) — compressed volatility, lower premium';
          }
        }
      } catch { /* VIX fetch is best-effort, don't fail the whole context */ }

      // ── 7. Days remaining in month ───────────────────────────────────────────
      const now = new Date();
      const daysLeftInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

      return {
        target,
        collected,
        gap,
        pct: target > 0 ? Math.min(100, (collected / target) * 100) : 0,
        totalBuyingPower: Math.round(totalBuyingPower),
        daysLeftInMonth,
        accountTypeBreakdown,
        ccCandidates,
        strategyHistory,
        topCspTickers,
        vix,
        vixLabel,
      };
    }),

    /**
     * Generate AI advice for closing the monthly income gap.
     * Takes the pre-fetched context JSON and calls the LLM.
     */
    generateGapAdvice: protectedProcedure
      .input(z.object({ contextJson: z.string() }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        let ctx: any = {};
        try { ctx = JSON.parse(input.contextJson); } catch { /* use empty */ }

        const gap = ctx.gap ?? 0;
        const target = ctx.target ?? 150000;
        const collected = ctx.collected ?? 0;
        const pct = target > 0 ? ((collected / target) * 100).toFixed(1) : '0';
        const bp = ctx.totalBuyingPower ?? 0;
        const bp80 = Math.round(bp * 0.80);
        const daysLeft = ctx.daysLeftInMonth ?? 0;
        const ccCandidates: any[] = ctx.ccCandidates ?? [];
        const strategyHistory = ctx.strategyHistory ?? {};
        const topCspTickers: any[] = ctx.topCspTickers ?? [];
        const accountTypeBreakdown: any[] = ctx.accountTypeBreakdown ?? [];
        const vix: number | null = ctx.vix ?? null;
        const vixLabel: string = ctx.vixLabel ?? 'unknown';

        const ccList = ccCandidates.slice(0, 8).map((c: any) =>
          `  - ${c.symbol}: ${c.shares} shares, avg cost $${c.avgCost?.toFixed(2)}, current $${c.currentPrice?.toFixed(2)} (${c.recommendation})`
        ).join('\n');

        const cspTickerList = topCspTickers.slice(0, 8).map((t: any) =>
          `  - ${t.symbol}: ${t.count} CSPs in last 90 days, avg premium $${t.avgPremium?.toLocaleString()}`
        ).join('\n');

        const accountList = accountTypeBreakdown.map((a: any) =>
          `  - ${a.nickname} (${a.type}): $${a.buyingPower?.toLocaleString()} BP${a.spreadOnly ? ' [IRA — spreads/CCs only, no naked puts]' : ''}`
        ).join('\n');

        const vixContext = vix !== null
          ? `Current VIX: ${vix} — ${vixLabel}. Use this to calibrate DTE and strategy selection: HIGH VIX (≥30) favors short-cycle spreads (7-14 DTE) for elevated premium capture; ELEVATED VIX (20-29) supports both short and standard cycles; MODERATE/LOW VIX (<20) favors longer-cycle plays (21-45 DTE) and covered calls where premium is still meaningful.`
          : 'VIX data unavailable — use general market conditions for cycle guidance.';

        const systemPrompt = `You are a conservative options income advisor for an experienced retail trader running a premium income wheel strategy.
Your job is to give specific, actionable recommendations to close a monthly income gap safely.
Always prioritize capital preservation. Keep delta exposure low. Never recommend strategies that significantly increase directional risk.
Consider account-type restrictions: IRA accounts cannot sell naked puts — only spreads and covered calls are allowed in IRAs.
${vixContext}
IMPORTANT: Always begin your response with a ## Buying Power Summary section that clearly states the total buying power across all accounts and the per-account breakdown. This is the most important context for the user.
Format your response in clean markdown with ## section headers. Be concise but specific — include estimated dollar amounts and contract counts where possible.`;

        const vixLine = vix !== null ? `\nCurrent VIX: ${vix} (${vixLabel})` : '';

        const userPrompt = `Monthly income target: $${target.toLocaleString()}
Collected so far this month: $${collected.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${pct}%)
Gap remaining: $${gap.toLocaleString('en-US', { maximumFractionDigits: 0 })}
Days left in month: ${daysLeft}${vixLine}

Total buying power across all accounts: $${bp.toLocaleString()}
80% safe deployment ceiling: $${bp80.toLocaleString()}

Per-account buying power breakdown:
${accountList || '  No account data available'}

90-day trading history (use this to ground your recommendations in what the user actually trades):
  - SPX/index spreads sold: ${strategyHistory.spxSpreads ?? 0}
  - Cash-secured puts sold: ${strategyHistory.csps ?? 0}
  - Covered calls sold: ${strategyHistory.coveredCalls ?? 0}
  - Iron condors: ${strategyHistory.ironCondors ?? 0}
  - Total option trades: ${strategyHistory.totalTrades ?? 0}

Top CSP tickers from history (Mag7 prioritized):
${cspTickerList || '  No CSP history found'}

Covered call candidates (long equity positions with no active short call):
${ccList || '  None detected'}

Please provide the following sections:

## Buying Power Summary
State the total buying power across all accounts and show the per-account breakdown in a table. Show the 80% safe deployment ceiling ($${bp80.toLocaleString()}) and what that leaves as a buffer.

## Strategy Recommendations
Based on the gap of $${gap.toLocaleString('en-US', { maximumFractionDigits: 0 })} and ${daysLeft} days remaining, recommend the best mix of strategies from the user's actual trading history. For each strategy:
- Recommended allocation from the available buying power (use real per-account BP, not percentages)
- Specific tickers or instruments (SPX/SPXW for spreads, Mag7 names from history for CSPs)
- DTE range — compare short-cycle (7-10 DTE) vs standard (21-30 DTE) where relevant
- Estimated premium range based on typical market conditions
- Account to use (respect IRA restrictions)

## Covered Call Quick Wins
For each idle CC candidate above: suggested strike (ATM or slight OTM), DTE range, estimated premium.

## Conservative Caution
Key risks to watch: assignment risk on CSPs, spread widening, IRA restrictions, and any notes on current market conditions.`;

        const response = await invokeLLM({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        const rawContent = response?.choices?.[0]?.message?.content;
        const advice: string = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map((c: any) => c.text || '').join('')
            : 'Unable to generate advice at this time.';
        return { advice };
      }),

    followUpGapAdvice: protectedProcedure
      .input(z.object({
        contextJson: z.string(),
        history: z.array(z.object({ role: z.enum(['assistant', 'user']), content: z.string() })),
        question: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        const systemPrompt = `You are a conservative options trading advisor helping a premium income investor close their monthly income gap. 
You have already provided an initial analysis. The user is asking a follow-up question.
Context: ${input.contextJson}
Answer concisely and specifically. Stay conservative — capital preservation first. Use markdown formatting (## headers, - bullets, **bold**).`;
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPrompt },
          ...input.history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: input.question },
        ];
        const response = await invokeLLM({ messages });
        const rawContent = response?.choices?.[0]?.message?.content;
        const answer: string = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map((c: any) => c.text || '').join('')
            : 'Unable to answer at this time.';
        return { answer };
      }),

    /**
     * Gather lightweight context for the AI Morning Briefing card.
     * Pulls: open positions count, daily scan cache, VIX, upcoming expirations.
     * Fast — does NOT fetch full option chains.
     */
    getMorningBriefingContext: protectedProcedure.query(async ({ ctx }) => {
      const { getApiCredentials } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);

      // ── 1. Daily scan cache (close/roll/sell counts) ─────────────────────────
      let closeProfitCount = 0;
      let rollPositionsCount = 0;
      let sellCallsCount = 0;
      let scannedAt: Date | null = null;
      let closeProfitItems: any[] = [];
      let rollPositionsItems: any[] = [];
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (db) {
          const { dailyScanCache } = await import('../drizzle/schema');
          const { eq, desc } = await import('drizzle-orm');
          const [row] = await db.select().from(dailyScanCache)
            .where(eq(dailyScanCache.userId, ctx.user.id))
            .orderBy(desc(dailyScanCache.scannedAt)).limit(1);
          if (row) {
            closeProfitCount = row.closeProfitCount ?? 0;
            rollPositionsCount = row.rollPositionsCount ?? 0;
            sellCallsCount = row.sellCallsCount ?? 0;
            scannedAt = row.scannedAt;
            const safeParse = (s: string | null | undefined): any[] => { try { return JSON.parse(s ?? '[]'); } catch { return []; } };
            closeProfitItems = safeParse(row.closeProfitItems);
            rollPositionsItems = safeParse(row.rollPositionsItems);
          }
        }
      } catch { /* non-fatal */ }

      // ── 2. Open positions + upcoming expirations — from DB cache ────────────────────────────
      let openPositionsCount = 0;
      let upcomingExpirations: { symbol: string; expiration: string; dte: number; strategy: string; accountNumber: string }[] = [];
      try {
        const { getLivePositions } = await import('./portfolio-sync');
        const cachedPos = await getLivePositions(ctx.user.id);
        openPositionsCount = cachedPos.length;
        const nowMs = Date.now();
        for (const pos of cachedPos) {
          if (pos['instrument-type'] !== 'Equity Option') continue;
          const sym = pos['underlying-symbol'] || '';
          const expStr = pos['expires-at'] || '';
          if (!expStr) continue;
          const expMs = new Date(expStr).getTime();
          const dte = Math.max(0, Math.round((expMs - nowMs) / 86400000));
          if (dte <= 21) {
            const direction = pos['quantity-direction'] || '';
            const optSym = pos.symbol || '';
            const isCall = optSym.includes('C');
            const strategy = direction === 'Short' ? (isCall ? 'CC' : 'CSP') : (isCall ? 'Long Call' : 'Long Put');
            upcomingExpirations.push({ symbol: sym, expiration: expStr, dte, strategy, accountNumber: pos['account-number'] });
          }
        }
        upcomingExpirations.sort((a, b) => a.dte - b.dte);
      } catch { /* non-fatal */ }

      // ── 3. VIX ───────────────────────────────────────────────────────────────
      let vix: number | null = null;
      let vixLabel = 'unknown';
      try {
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const { createTradierAPI } = await import('./tradier');
          const tradierApi = createTradierAPI(tradierKey, false, ctx.user.id);
          const vixQuote = await tradierApi.getQuote('VIX');
          const vixLast = vixQuote?.last ?? vixQuote?.close ?? null;
          if (vixLast && !isNaN(Number(vixLast))) {
            vix = Math.round(Number(vixLast) * 100) / 100;
            if (vix >= 30) vixLabel = 'HIGH — elevated fear, premium-rich';
            else if (vix >= 20) vixLabel = 'ELEVATED — above-average volatility';
            else if (vix >= 15) vixLabel = 'MODERATE — normal range';
            else vixLabel = 'LOW — compressed volatility';
          }
        }
      } catch { /* non-fatal */ }

      // ── 4. Monthly progress ──────────────────────────────────────────────────
      let monthlyCollected = 0;
      let monthlyTarget = 150000;
      try {
        const { getUserPreferences } = await import('./db');
        const prefs = await getUserPreferences(ctx.user.id);
        monthlyTarget = prefs?.monthlyIncomeTarget ?? 150000;
        // ── Monthly progress — from DB cache ─────────────────────────────────────────────────────
        const { getCachedTransactions } = await import('./portfolio-sync');
        const allTxns = await getCachedTransactions(ctx.user.id);
        const now2 = new Date();
        const monthStartMs = new Date(now2.getFullYear(), now2.getMonth(), 1).getTime();
        let credits = 0, debits = 0;
        for (const t of allTxns) {
          if (!t.executedAt || new Date(t.executedAt).getTime() < monthStartMs) continue;
          if (t.transactionType !== 'Trade') continue;
          const sym = t.symbol || '';
          if (!/[A-Z0-9]+\s*\d{6}[CP]\d+/.test(sym)) continue;
          const val = Math.abs(parseFloat(String(t.netValue || '0')));
          if (!val) continue;
          // Use action field for direction — value is always stored positive in DB
          const act2 = (t.action || '').toLowerCase();
          const isCredit = act2.startsWith('sell');
          const isDebit2 = act2.startsWith('buy');
          if (isCredit) credits += val;
          else if (isDebit2) debits += val;
        }
        monthlyCollected = Math.round((credits - debits) * 100) / 100;
      } catch { /* non-fatal */ }

      return {
        closeProfitCount,
        rollPositionsCount,
        sellCallsCount,
        scannedAt,
        closeProfitItems,
        rollPositionsItems,
        openPositionsCount,
        upcomingExpirations,
        vix,
        vixLabel,
        monthlyCollected,
        monthlyTarget,
      };
    }),

    /**
     * Generate the AI Morning Briefing text from the pre-fetched context.
     */
    generateMorningBriefing: protectedProcedure
      .input(z.object({ contextJson: z.string() }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        let ctx: any = {};
        try { ctx = JSON.parse(input.contextJson); } catch { /* use empty */ }

        const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const closeProfitItems: any[] = ctx.closeProfitItems ?? [];
        const rollPositionsItems: any[] = ctx.rollPositionsItems ?? [];
        const upcomingExpirations: any[] = ctx.upcomingExpirations ?? [];
        const vix: number | null = ctx.vix ?? null;
        const vixLabel: string = ctx.vixLabel ?? 'unknown';
        const monthlyCollected: number = ctx.monthlyCollected ?? 0;
        const monthlyTarget: number = ctx.monthlyTarget ?? 150000;
        const monthlyPct = monthlyTarget > 0 ? ((monthlyCollected / monthlyTarget) * 100).toFixed(1) : '0';
        const closeProfitCount: number = ctx.closeProfitCount ?? 0;
        const rollPositionsCount: number = ctx.rollPositionsCount ?? 0;
        const sellCallsCount: number = ctx.sellCallsCount ?? 0;
        const openPositionsCount: number = ctx.openPositionsCount ?? 0;

        const expiringList = upcomingExpirations.slice(0, 8).map((e: any) =>
          `  - ${e.symbol} ${e.strategy}: ${e.dte}d DTE (${e.expiration})`
        ).join('\n');

        const closeProfitList = closeProfitItems.slice(0, 5).map((i: any) =>
          `  - ${i.underlyingSymbol || i.symbol}: ${i.profitPct?.toFixed(0)}% profit, ${i.daysLeft}d left`
        ).join('\n');

        const rollList = rollPositionsItems.slice(0, 5).map((i: any) =>
          `  - ${i.underlyingSymbol || i.symbol}: ${i.dte}d DTE, $${i.strike} ${i.optionType}`
        ).join('\n');

        const vixLine = vix !== null ? `Current VIX: ${vix} (${vixLabel})` : 'VIX: unavailable';

        const systemPrompt = `You are a concise morning briefing assistant for an experienced options income trader. 
Today is ${today}. Your job is to deliver a sharp, actionable morning briefing in 3-5 short sections.
Be specific, direct, and prioritize the most urgent items first. Use markdown with ## headers and bullet points.
Keep the total response under 300 words. No fluff — every sentence must add value.
Focus on: what needs attention TODAY, what's expiring soon, market conditions, and one key insight.`;

        const userPrompt = `Morning briefing data for today:

${vixLine}
Monthly income: $${monthlyCollected.toLocaleString('en-US', { maximumFractionDigits: 0 })} / $${monthlyTarget.toLocaleString()} (${monthlyPct}%)
Open positions: ${openPositionsCount}

Daily scan results:
- Close for profit: ${closeProfitCount} positions ready
${closeProfitList ? closeProfitList : '  (none)'}
- Roll positions: ${rollPositionsCount} expiring soon
${rollList ? rollList : '  (none)'}
- Sell calls: ${sellCallsCount} eligible

Upcoming expirations (≤21 DTE):
${expiringList || '  None within 21 days'}

Generate a morning briefing with these sections:
## Today's Priority Actions
## Expiration Watch
## Market Conditions
## Key Insight`;

        const response = await invokeLLM({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        const rawContent = response?.choices?.[0]?.message?.content;
        const briefing: string = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map((c: any) => c.text || '').join('')
            : 'Unable to generate briefing at this time.';
        return { briefing };
      }),

    morningBriefingFollowUp: protectedProcedure
      .input(
        z.object({
          briefingContext: z.string(),
          initialBriefing: z.string(),
          conversationHistory: z.array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string(),
            })
          ),
          userMessage: z.string().max(2000),
        })
      )
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        let ctx: any = {};
        try { ctx = JSON.parse(input.briefingContext); } catch { /* use empty */ }

        const systemPrompt = `You are a concise morning briefing assistant for an experienced options income trader.
You already generated a morning briefing. The trader has a follow-up question.

Context summary:
- VIX: ${ctx.vix ?? 'unknown'} (${ctx.vixLabel ?? ''})
- Open positions: ${ctx.openPositionsCount ?? 'unknown'}
- Close for profit: ${ctx.closeProfitCount ?? 0} positions
- Roll positions: ${ctx.rollPositionsCount ?? 0} positions
- Upcoming expirations: ${ctx.upcomingExpirations?.length ?? 0} within 21d

Your initial briefing was:
${input.initialBriefing}

Answer the trader's follow-up question concisely and specifically. Use actual numbers when relevant. Format in Markdown.`;

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPrompt },
          ...input.conversationHistory,
          { role: 'user', content: input.userMessage },
        ];

        const response = await invokeLLM({ messages });
        const rawContent = response?.choices?.[0]?.message?.content;
        const reply: string = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map((c: any) => c.text || '').join('')
            : 'Unable to generate response.';
        return { reply };
      }),

    getActionBadges: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (!db) return { liquidationFlags: 0, gtcPending: 0, workingOrdersCount: null, openPositionsCount: null };

        const { liquidationFlags: liquidationFlagsTable, gtcOrders: gtcOrdersTable } = await import('../drizzle/schema');
        const { eq, and, count } = await import('drizzle-orm');

        // Liquidation-flagged symbols (dogs) — fast DB-only query
        const [flagRow] = await db.select({ value: count() })
          .from(liquidationFlagsTable)
          .where(eq(liquidationFlagsTable.userId, ctx.user.id));

        // Pending GTC orders (submitted but not filled/cancelled)
        const [gtcRow] = await db.select({ value: count() })
          .from(gtcOrdersTable)
          .where(and(eq(gtcOrdersTable.userId, ctx.user.id), eq(gtcOrdersTable.status, 'submitted')));

        // Open positions count — read from DB cache (instant, no live API call)
        let workingOrdersCount: number | null = null;
        let openPositionsCount: number | null = null;
        try {
          const { getLivePositions } = await import('./portfolio-sync');
          const cachedPos = await getLivePositions(ctx.user.id);
          openPositionsCount = cachedPos.length;
          // Working orders: still live (order status changes in real time)
          // Only attempt if credentials are configured
          const { getApiCredentials } = await import('./db');
          const credentials = await getApiCredentials(ctx.user.id);
          if (credentials?.tastytradeClientSecret && credentials?.tastytradeRefreshToken) {
            const { authenticateTastytrade } = await import('./tastytrade');
            const api = await authenticateTastytrade(credentials, ctx.user.id);
            const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
              Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), 5000))]);
            const accounts = await withTimeout(api.getAccounts());
            if (accounts) {
              const accountNums: string[] = (accounts as any[]).map((a: any) =>
                a.account?.['account-number'] || a['account-number']
              ).filter(Boolean);
              let totalOrders = 0;
              await Promise.all(accountNums.map(async (accNum: string) => {
                try {
                  const orders = await withTimeout(api.getLiveOrders(accNum));
                  if (orders) {
                    const active = (orders as any[]).filter((o: any) =>
                      !['filled','cancelled','rejected','expired','replaced'].includes((o.status||'').toLowerCase())
                    );
                    totalOrders += active.length;
                  }
                } catch { /* skip account on error */ }
              }));
              workingOrdersCount = totalOrders;
            }
          }
        } catch { /* cache or Tastytrade not configured — return nulls */ }

        return {
          liquidationFlags: Number(flagRow?.value ?? 0),
          gtcPending: Number(gtcRow?.value ?? 0),
          workingOrdersCount,
          openPositionsCount,
        };
      } catch (e) {
        console.error('[ActionBadges] Error:', e);
        return { liquidationFlags: 0, gtcPending: 0, workingOrdersCount: null, openPositionsCount: null };
      }
    }),
  }),
  auth: router({
    me: publicProcedure.query(opts => {
      // If auth failed but a cookie exists, clear it so the browser drops the stale token
      if (!opts.ctx.user) {
        const hasCookie = opts.ctx.req.headers.cookie?.includes(COOKIE_NAME);
        if (hasCookie) {
          const cookieOptions = getSessionCookieOptions(opts.ctx.req);
          // Clear the non-Partitioned variant (old cookies set before CHIPS support)
          opts.ctx.res.clearCookie(COOKIE_NAME, cookieOptions);
          // Also send a second Set-Cookie that clears the Partitioned variant
          // (CHIPS treats Partitioned and non-Partitioned as separate cookies)
          const existingHeaders = opts.ctx.res.getHeader('Set-Cookie');
          const clearPartitioned = `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=None; Secure; Partitioned`;
          if (Array.isArray(existingHeaders)) {
            opts.ctx.res.setHeader('Set-Cookie', [...existingHeaders, clearPartitioned]);
          } else if (typeof existingHeaders === 'string') {
            opts.ctx.res.setHeader('Set-Cookie', [existingHeaders, clearPartitioned]);
          } else {
            opts.ctx.res.setHeader('Set-Cookie', [clearPartitioned]);
          }
          console.log('[auth.me] Cleared stale session cookie (both Partitioned and non-Partitioned variants)');
        }
      }
      console.log('[auth.me] Returning user:', {
        email: opts.ctx.user?.email,
        subscriptionTier: opts.ctx.user?.subscriptionTier,
        role: opts.ctx.user?.role
      });
      return opts.ctx.user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, cookieOptions);
      // Also clear the Partitioned variant used in the preview panel iframe context
      addPartitionedAttribute(ctx.res);
      return {
        success: true,
      } as const;
    }),
    acceptLegalAgreements: protectedProcedure.mutation(async ({ ctx }) => {
      const { updateUser } = await import('./db');
      const ipAddress = ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '';
      const ip = Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim();
      
      await updateUser(ctx.user.id, {
        acceptedTermsAt: new Date(),
        acceptedRiskDisclosureAt: new Date(),
        acceptedTermsIp: ip,
      });
      
      return { success: true };
    }),
  }),

  settings: router({
    getCredentials: protectedProcedure.query(async ({ ctx }) => {
      console.log('[getCredentials] === START ===');
      console.log('[getCredentials] User:', ctx.user.email, 'ID:', ctx.user.id);
      
      const { getApiCredentials } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      
      console.log('[getCredentials] Raw credentials from DB:', {
        hasClientSecret: !!credentials?.tastytradeClientSecret,
        clientSecretLength: credentials?.tastytradeClientSecret?.length || 0,
        hasRefreshToken: !!credentials?.tastytradeRefreshToken,
        refreshTokenLength: credentials?.tastytradeRefreshToken?.length || 0,
        hasTradierKey: !!credentials?.tradierApiKey,
        tradierKeyLength: credentials?.tradierApiKey?.length || 0,
      });
      
      // For free trial users, provide owner's Tradier token if they don't have their own
      const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
      
      if (!credentials) {
        console.log('[getCredentials] No credentials found');
        
        // If free trial user, provide owner's Tradier token (masked)
        if (isFreeTrialUser && process.env.TRADIER_API_KEY) {
          console.log('[getCredentials] Free trial user - providing owner Tradier token (masked)');
          return {
            tradierApiKey: '••••••••••••••••', // Masked owner token
            tradierAccountId: process.env.TRADIER_ACCOUNT_ID || '',
            tastytradeClientSecret: '',
            tastytradeRefreshToken: '',
            defaultTastytradeAccountId: '',
          };
        }
        
        return null;
      }
      
      // SECURITY: Mask sensitive credentials before sending to frontend
      // Never expose actual API keys, secrets, or tokens to the browser
      const masked = {
        ...credentials,
        tastytradeClientId: credentials.tastytradeClientId ? '••••••••••••••••' : '',
        tastytradeClientSecret: credentials.tastytradeClientSecret ? '••••••••••••••••' : '',
        tastytradeRefreshToken: credentials.tastytradeRefreshToken ? '••••••••••••••••' : '',
        // For free trial users without their own Tradier key, provide owner's token (masked)
        tradierApiKey: credentials.tradierApiKey 
          ? '••••••••••••••••' 
          : (isFreeTrialUser && process.env.TRADIER_API_KEY ? '••••••••••••••••' : ''),
        // Keep non-sensitive fields unmasked
        tradierAccountId: credentials.tradierAccountId || (isFreeTrialUser ? process.env.TRADIER_ACCOUNT_ID || '' : ''),
        defaultTastytradeAccountId: credentials.defaultTastytradeAccountId,
      };
      
      console.log('[getCredentials] Masked credentials being returned:', {
        tastytradeClientSecret: masked.tastytradeClientSecret,
        tastytradeRefreshToken: masked.tastytradeRefreshToken,
        tradierApiKey: masked.tradierApiKey,
      });
      console.log('[getCredentials] === END ===');
      
      return masked;
    }),
    saveCredentials: protectedProcedure
      .input(
        z.object({
          tastytradeClientId: z.string().optional(),
          tastytradeClientSecret: z.string().optional(),
          tastytradeRefreshToken: z.string().optional(),
          tradierApiKey: z.string().optional(),
          tradierAccountId: z.string().optional(),
          defaultTastytradeAccountId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Server-side guard: strip any masked placeholder values (starting with ••••)
        // before saving to the database. The frontend does this too, but defense-in-depth.
        const isMasked = (v?: string) => !!v && v.startsWith('\u2022\u2022\u2022\u2022');
        const sanitized = {
          tastytradeClientId: isMasked(input.tastytradeClientId) ? undefined : input.tastytradeClientId,
          tastytradeClientSecret: isMasked(input.tastytradeClientSecret) ? undefined : input.tastytradeClientSecret,
          tastytradeRefreshToken: isMasked(input.tastytradeRefreshToken) ? undefined : input.tastytradeRefreshToken,
          tradierApiKey: isMasked(input.tradierApiKey) ? undefined : input.tradierApiKey,
          tradierAccountId: input.tradierAccountId,
          defaultTastytradeAccountId: input.defaultTastytradeAccountId,
        };
        console.log('[Settings] saveCredentials called with input:', {
          hasClientId: !!sanitized.tastytradeClientId,
          hasClientSecret: !!sanitized.tastytradeClientSecret,
          clientSecretLength: sanitized.tastytradeClientSecret?.length || 0,
          hasRefreshToken: !!sanitized.tastytradeRefreshToken,
          refreshTokenLength: sanitized.tastytradeRefreshToken?.length || 0,
          refreshTokenStart: sanitized.tastytradeRefreshToken?.substring(0, 50) || 'none',
        });
        const { upsertApiCredentials, clearAccessToken } = await import('./db');
        await upsertApiCredentials(ctx.user.id, sanitized);
        
        // If Tastytrade credentials were updated, evict the stale per-user API instance
        // and clear the persisted access token so the next auth call gets a fresh token.
        const tastytradeCredentialsChanged = !!(sanitized.tastytradeClientSecret || sanitized.tastytradeRefreshToken || sanitized.tastytradeClientId);
        if (tastytradeCredentialsChanged) {
          const { clearUserInstance } = await import('./tastytrade');
          clearUserInstance(ctx.user.id);
          await clearAccessToken(ctx.user.id);
          console.log('[Settings] Tastytrade credentials updated — cleared stale token and API instance for userId:', ctx.user.id);
        }
        
        console.log('[Settings] Credentials saved successfully');
        return { success: true };
      }),
    testTastytradeConnection: protectedProcedure.mutation(async ({ ctx }) => {
      console.log('[Test Connection] === TEST CONNECTION START ===');
      console.log('[Test Connection] ctx.user:', {
        id: ctx.user.id,
        openId: ctx.user.openId,
        email: ctx.user.email,
        name: ctx.user.name,
      });
      
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const { TRPCError } = await import('@trpc/server');
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tastytrade credentials not configured. Please enter your Client ID, Client Secret, and Refresh Token in Settings.',
        });
      }

      try {
        await authenticateTastytrade(credentials, ctx.user.id);
        return { success: true, message: 'Connection successful' };
      } catch (authError: any) {
        // Convert authentication errors to user-friendly tRPC errors (not 500s)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: authError.message || 'Tastytrade authentication failed. Please check your credentials in Settings.',
        });
      }
    }),
    forceTokenRefresh: protectedProcedure.mutation(async ({ ctx }) => {
      console.log('[Force Refresh] === FORCE TOKEN REFRESH START ===');
      console.log('[Force Refresh] User ID:', ctx.user.id);
      
      const { getApiCredentials } = await import('./db');
      const { getTastytradeAPI } = await import('./tastytrade');
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      console.log('[Force Refresh] Requesting fresh access token...');
      
      // Get the per-user API instance and request new token
      const api = getTastytradeAPI(ctx.user.id);
      api.setUserId(ctx.user.id);
      
      // Call getAccessToken directly - this will refresh and save to database
      const token = await api.getAccessToken(
        credentials.tastytradeRefreshToken,
        credentials.tastytradeClientSecret,
        0,
        credentials.tastytradeClientId || undefined
      );
      
      console.log('[Force Refresh] Token refreshed successfully');
      return { 
        success: true, 
        message: 'Token refreshed and saved to database',
        expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : undefined
      };
    }),
    testTradierConnection: protectedProcedure.mutation(async ({ ctx }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');
      
      console.log('[Settings] Testing Tradier connection for user:', ctx.user.id);
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tradierApiKey) {
        console.error('[Settings] No Tradier API key found for user:', ctx.user.id);
        throw new Error('Tradier API key not configured');
      }

      console.log('[Settings] Tradier API key found, testing connection...');
      const api = createTradierAPI(credentials.tradierApiKey, false, ctx.user.id);
      
      try {
        // Test with a simple quote request
        await api.getQuote('SPY');
        console.log('[Settings] Tradier connection test successful');
        return { success: true, message: 'Connection successful' };
      } catch (error: any) {
        console.error('[Settings] Tradier connection test failed:', error.message);
        throw error;
      }
    }),
    getConnectionStatus: protectedProcedure.query(async ({ ctx }) => {
      const { getApiCredentials, loadAccessToken } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      
      // Check if Tastytrade credentials are configured
      const tastytradeConfigured = !!(credentials?.tastytradeClientSecret && credentials?.tastytradeRefreshToken);
      
      // Check if Tastytrade access token is valid (not expired)
      let tastytradeConnected = false;
      if (tastytradeConfigured) {
        try {
          const token = await loadAccessToken(ctx.user.id);
          if (token?.accessToken && token?.expiresAt) {
            const isExpired = new Date() >= token.expiresAt;
            tastytradeConnected = !isExpired;
          }
        } catch (error) {
          console.error('[ConnectionStatus] Failed to load Tastytrade token:', error);
        }
      }
      
      const tradierConfigured = !!credentials?.tradierApiKey;
      
      // Get token expiration time for countdown
      let tokenExpiresAt: Date | null = null;
      if (tastytradeConfigured) {
        try {
          const token = await loadAccessToken(ctx.user.id);
          if (token?.expiresAt) {
            tokenExpiresAt = token.expiresAt;
          }
        } catch (error) {
          // Already logged above
        }
      }
      
      // Get Tradier account health data
      let tradierHealth = null;
      if (credentials?.tradierAccountBalance) {
        const balance = parseFloat(credentials.tradierAccountBalance);
        const lastChecked = credentials.tradierLastHealthCheck;
        const needsCheck = !lastChecked || (new Date().getTime() - lastChecked.getTime()) > 24 * 60 * 60 * 1000;
        
        tradierHealth = {
          balance: credentials.tradierAccountBalance,
          status: credentials.tradierAccountStatus || 'unknown',
          buyingPower: credentials.tradierBuyingPower,
          lastChecked: lastChecked,
          needsCheck,
          warning: balance < 100,
        };
      }
      
      return {
        tastytrade: {
          configured: tastytradeConfigured,
          connected: tastytradeConnected,
          status: tastytradeConnected ? 'connected' : (tastytradeConfigured ? 'expired' : 'disconnected'),
          expiresAt: tokenExpiresAt,
        },
        tradier: {
          configured: tradierConfigured,
          connected: tradierConfigured, // Tradier uses API key, no expiration
          status: tradierConfigured ? 'connected' : 'disconnected',
          health: tradierHealth,
        },
      };
    }),
    refreshTradierHealth: protectedProcedure.mutation(async ({ ctx }) => {
      const { getApiCredentials, upsertApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tradierApiKey) {
        throw new Error('Tradier API key not configured');
      }
      
      if (!credentials?.tradierAccountId) {
        throw new Error('Tradier account ID not configured');
      }
      
      const api = createTradierAPI(credentials.tradierApiKey, false, ctx.user.id);
      
      try {
        // Fetch account balance
        const balanceData = await api.getAccountBalance(credentials.tradierAccountId);
        
        // Update credentials with health data
        await upsertApiCredentials(ctx.user.id, {
          tradierAccountBalance: balanceData.totalEquity.toString(),
          tradierAccountStatus: 'active', // If API call succeeds, account is active
          tradierBuyingPower: balanceData.optionBuyingPower.toString(),
          tradierLastHealthCheck: new Date(),
        });
        
        return {
          success: true,
          balance: balanceData.totalEquity.toString(),
          status: 'active',
          buyingPower: balanceData.optionBuyingPower.toString(),
          warning: balanceData.totalEquity < 100,
        };
      } catch (error: any) {
        console.error('[Tradier Health] Failed to fetch account balance:', error.message);
        
        // Update status to error
        await upsertApiCredentials(ctx.user.id, {
          tradierAccountStatus: 'error',
          tradierLastHealthCheck: new Date(),
        });
        
        throw new Error(`Failed to fetch Tradier account health: ${error.message}`);
      }
    }),
    getBackgroundPreferences: protectedProcedure.query(async ({ ctx }) => {
      const { getUserPreferences } = await import('./db');
      const prefs = await getUserPreferences(ctx.user.id);
      return { 
        opacity: prefs?.damascusOpacity ?? 8,
        pattern: prefs?.backgroundPattern ?? 'diagonal'
      };
    }),
    setBackgroundOpacity: protectedProcedure
      .input(z.object({ opacity: z.number().min(0).max(100) }))
      .mutation(async ({ ctx, input }) => {
        const { setDamascusOpacity } = await import('./db');
        await setDamascusOpacity(ctx.user.id, input.opacity);
        return { success: true };
      }),
    setBackgroundPattern: protectedProcedure
      .input(z.object({ pattern: z.enum(['diagonal', 'crosshatch', 'dots', 'woven', 'none']) }))
      .mutation(async ({ ctx, input }) => {
        const { setBackgroundPattern } = await import('./db');
        await setBackgroundPattern(ctx.user.id, input.pattern);
        return { success: true };
      }),
    getTokenStatus: protectedProcedure.query(async ({ ctx }) => {
      // Get token expiration from Tastytrade session
      // For now, return a mock value - will implement full OAuth2 token tracking later
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      return {
        expiresAt: expiresAt.toISOString(),
        isValid: true,
      };
    }),
    clearTastytradeCredentials: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await (await import('./db')).getDb();
      if (!db) throw new Error('Database unavailable');
      const { apiCredentials } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      // Wipe all Tastytrade credential fields for this user
      await db.update(apiCredentials).set({
        tastytradeClientId: null,
        tastytradeClientSecret: null,
        tastytradeRefreshToken: null,
        tastytradeAccessToken: null,
        tastytradeAccessTokenExpiresAt: null,
        updatedAt: new Date(),
      }).where(eq(apiCredentials.userId, ctx.user.id));
      // Also evict the in-memory instance
      const { clearUserInstance } = await import('./tastytrade');
      clearUserInstance(ctx.user.id);
      console.log('[Settings] Tastytrade credentials cleared for userId:', ctx.user.id);
      return { success: true };
    }),
  }),

  accounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getTastytradeAccounts } = await import('./db');
      return getTastytradeAccounts(ctx.user.id);
    }),
    remove: protectedProcedure
      .input(z.object({ accountId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const db = await (await import('./db')).getDb();
        if (!db) throw new Error('Database unavailable');
        const { tastytradeAccounts } = await import('../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        await db.delete(tastytradeAccounts).where(
          and(
            eq(tastytradeAccounts.userId, ctx.user.id),
            eq(tastytradeAccounts.accountId, input.accountId)
          )
        );
        console.log(`[Accounts] Removed account ${input.accountId} for user ${ctx.user.id}`);
        return { success: true };
      }),
     sync: protectedProcedure.mutation(async ({ ctx }) => {
      const { getApiCredentials, upsertTastytradeAccount, deleteRemovedTastytradeAccounts } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const accounts = await api.getAccounts();
      console.log('[Account Sync] Retrieved accounts from Tastytrade:', JSON.stringify(accounts, null, 2));

      const liveAccountNumbers: string[] = [];
      let skippedDemo = 0;

      // Account types to exclude — demo/paper accounts should never appear for VIP users
      const EXCLUDED_ACCOUNT_TYPES = ['Demo', 'Paper', 'Simulated', 'Virtual'];

      for (const item of accounts) {
        console.log('[Account Sync] Processing account:', JSON.stringify(item, null, 2));
        
        // Tastytrade API returns nested structure with kebab-case field names
        const account = item.account;
        const accountNumber = account['account-number'];
        const accountType = account['account-type-name'] as string;
        const nickname = account['nickname'];
        
        // Skip demo/paper accounts — VIP users only see real live accounts
        const isDemo = EXCLUDED_ACCOUNT_TYPES.some(t =>
          accountType?.toLowerCase().includes(t.toLowerCase()) ||
          accountNumber?.toUpperCase().startsWith('DEMO')
        );
        if (isDemo) {
          console.log(`[Account Sync] Skipping demo/paper account: ${accountNumber} (type: ${accountType})`);
          skippedDemo++;
          continue; // Do NOT add to liveAccountNumbers — this causes it to be purged from DB below
        }
        
        console.log('[Account Sync] Mapped data:', {
          accountId: accountNumber,
          accountNumber: accountNumber,
          accountType: accountType,
          nickname: nickname,
        });
        
        await upsertTastytradeAccount(ctx.user.id, {
          accountId: accountNumber,
          accountNumber: accountNumber,
          accountType: accountType,
          nickname: nickname || undefined,
        });

        liveAccountNumbers.push(accountNumber);
      }

      // Remove accounts that no longer exist in Tastytrade (closed/removed accounts)
      // This also purges any previously-stored demo accounts since they're not in liveAccountNumbers
      const removed = await deleteRemovedTastytradeAccounts(ctx.user.id, liveAccountNumbers);
      if (removed > 0) {
        console.log(`[Account Sync] Removed ${removed} account(s) no longer in Tastytrade (includes ${skippedDemo} demo account(s))`);
      }

      const realCount = accounts.length - skippedDemo;
      return { success: true, count: realCount, removed, skippedDemo };
    }),
    getBuyingPower: protectedProcedure
      .input(z.object({ accountId: z.string() }))
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { authenticateTastytrade } = await import('./tastytrade');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new Error('Tastytrade OAuth2 credentials not configured');
        }

        const api = await authenticateTastytrade(credentials, ctx.user.id);
        const balances = await api.getBalances(input.accountId);
        // Tastytrade returns numeric fields as strings (e.g. "617261.367").
        // Use parseFloat + Math.max to avoid the truthy-string bug where
        // Number("0.0" || "617261.367") incorrectly evaluates to 0.
        const buyingPower = Math.max(
          parseFloat(String(balances?.['derivative-buying-power'] || '0')),
          parseFloat(String(balances?.['cash-buying-power'] || '0'))
        );
        return { buyingPower };
      }),
  }),

  watchlist: router({
    get: protectedProcedure
      .query(async ({ ctx }) => {
        const { getWatchlist } = await import('./db');
        return getWatchlist(ctx.user.id);
      }),
    add: protectedProcedure
      .input(z.object({ 
        symbol: z.string().min(1).max(10), 
        strategy: z.enum(['csp', 'cc', 'pmcc', 'bps', 'bcs']).optional(),
        company: z.string().optional(),
        type: z.string().optional(),
        sector: z.string().optional(),
        reason: z.string().optional(),
        rank: z.number().optional(),
        portfolioSize: z.enum(['small', 'medium', 'large']).optional(),
        isIndex: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { addToWatchlistWithMetadata } = await import('./db');
        await addToWatchlistWithMetadata(ctx.user.id, input);
        return { success: true };
      }),
    setIndex: protectedProcedure
      .input(z.object({ symbol: z.string().min(1).max(10), isIndex: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const db = await (await import('./db')).getDb();
        if (!db) return { success: false };
        const { watchlists } = await import('../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        await db.update(watchlists)
          .set({ isIndex: input.isIndex })
          .where(and(eq(watchlists.userId, ctx.user.id), eq(watchlists.symbol, input.symbol)));
        return { success: true };
      }),
    importCSV: protectedProcedure
      .input(z.object({
        items: z.array(z.object({
          symbol: z.string().min(1).max(10),
          company: z.string().optional(),
          type: z.string().optional(),
          sector: z.string().optional(),
          reason: z.string().optional(),
          rank: z.number().optional(),
          portfolioSize: z.enum(['small', 'medium', 'large']).optional(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const { importWatchlistFromCSV } = await import('./db');
        const result = await importWatchlistFromCSV(ctx.user.id, input.items);
        return result;
      }),
    enrichSymbols: protectedProcedure
      .input(z.object({
        symbols: z.array(z.string()).optional(), // If empty, enrich all watchlist symbols
      }))
      .mutation(async ({ ctx, input }) => {
        const { getWatchlist, updateWatchlistMetadata } = await import('./db');
        const { enrichMultipleStocks } = await import('./stockEnrichment');
        
        // Get symbols to enrich
        let symbolsToEnrich: string[];
        if (input.symbols && input.symbols.length > 0) {
          symbolsToEnrich = input.symbols;
        } else {
          // Enrich all watchlist symbols
          const watchlist = await getWatchlist(ctx.user.id);
          symbolsToEnrich = watchlist.map((w: any) => w.symbol);
        }
        
        // Fetch metadata for all symbols
        const metadata = await enrichMultipleStocks(symbolsToEnrich);
        
        // Update database with enriched metadata
        const watchlist = await getWatchlist(ctx.user.id);
        for (const item of metadata) {
          const watchlistItem = watchlist.find((w: any) => w.symbol === item.symbol);
          if (watchlistItem) {
            await updateWatchlistMetadata(ctx.user.id, {
              id: watchlistItem.id,
              company: item.company || undefined,
              price: item.price || undefined,
              sector: item.sector || undefined,
              type: item.type || undefined,
              portfolioSize: item.portfolioSize,
            });
          }
        }
        
        return { success: true, enriched: metadata.length };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        company: z.string().optional(),
        type: z.string().optional(),
        sector: z.string().optional(),
        reason: z.string().optional(),
        rank: z.number().optional(),
        portfolioSize: z.enum(['small', 'medium', 'large']).optional(),
        price: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateWatchlistMetadata } = await import('./db');
        await updateWatchlistMetadata(ctx.user.id, input);
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ symbol: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { removeFromWatchlist } = await import('./db');
        await removeFromWatchlist(ctx.user.id, input.symbol);
        return { success: true };
      }),
    
    // Ticker selection procedures for persistent selection across dashboards
    getSelections: protectedProcedure
      .query(async ({ ctx }) => {
        const { getWatchlistSelections } = await import('./db');
        return getWatchlistSelections(ctx.user.id);
      }),
    toggleSelection: protectedProcedure
      .input(z.object({ symbol: z.string().min(1).max(10) }))
      .mutation(async ({ ctx, input }) => {
        const { toggleWatchlistSelection } = await import('./db');
        await toggleWatchlistSelection(ctx.user.id, input.symbol);
        return { success: true };
      }),
    selectAll: protectedProcedure
      .input(z.object({ symbols: z.array(z.string()) }))
      .mutation(async ({ ctx, input }) => {
        const { setAllWatchlistSelections } = await import('./db');
        await setAllWatchlistSelections(ctx.user.id, input.symbols, true);
        return { success: true };
      }),
     clearAll: protectedProcedure
      .input(z.object({ symbols: z.array(z.string()) }))
      .mutation(async ({ ctx, input }) => {
        const { setAllWatchlistSelections } = await import('./db');
        await setAllWatchlistSelections(ctx.user.id, input.symbols, false);
        return { success: true };
      }),

    // Resolve a ticker symbol via TradingView symbol search (server-side to avoid CORS).
    // Returns the best match with exchange prefix, or null if not found.
    resolveSymbol: protectedProcedure
      .input(z.object({ symbol: z.string().min(1).max(20) }))
      .query(async ({ input }) => {
        const clean = input.symbol.trim().toUpperCase().replace(/^[A-Z]+:/, '');
        // Static map for index option roots — TradingView search API filters out 'index' type,
        // so these must be resolved locally before hitting the search endpoint.
        const INDEX_TV_MAP: Record<string, { symbol: string; exchange: string; description: string }> = {
          SPXW: { symbol: 'SPX',  exchange: 'CBOE',   description: 'S&P 500 Index (Weekly options)' },
          SPX:  { symbol: 'SPX',  exchange: 'CBOE',   description: 'S&P 500 Index' },
          NDXP: { symbol: 'NDX',  exchange: 'NASDAQ', description: 'Nasdaq 100 Index (PM-settled)' },
          NDX:  { symbol: 'NDX',  exchange: 'NASDAQ', description: 'Nasdaq 100 Index' },
          MRUT: { symbol: 'RUT',  exchange: 'CBOE',   description: 'Russell 2000 Index (Mini)' },
          RUT:  { symbol: 'RUT',  exchange: 'CBOE',   description: 'Russell 2000 Index' },
          VIX:  { symbol: 'VIX',  exchange: 'CBOE',   description: 'CBOE Volatility Index' },
          DJX:  { symbol: 'DJX',  exchange: 'CBOE',   description: 'Dow Jones Index (1/100)' },
          XSP:  { symbol: 'XSP',  exchange: 'CBOE',   description: 'Mini-SPX Index' },
          XND:  { symbol: 'XND',  exchange: 'NASDAQ', description: 'Mini-NDX Index' },
        };
        if (INDEX_TV_MAP[clean]) {
          const entry = INDEX_TV_MAP[clean];
          return {
            symbol: entry.symbol,
            exchange: entry.exchange,
            fullSymbol: `${entry.exchange}:${entry.symbol}`,
            description: entry.description,
            type: 'index',
          };
        }
        // Only request options-relevant types: stocks, ETFs/funds, depositary receipts
        // Excludes futures, indices, crypto, forex, structured products
        const url = `https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(clean)}&type=stock,fund,dr&exchange=&lang=en&domain=production`;
        // Allowlist of instrument types valid for options trading
        const OPTIONS_TYPES = new Set(['stock', 'fund', 'dr', 'etf']);
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Origin': 'https://www.tradingview.com',
              'Referer': 'https://www.tradingview.com/',
            },
          });
          if (!res.ok) return null;
          const data: Array<{ symbol: string; exchange: string; type: string; description: string }> = await res.json();
          if (!data || data.length === 0) return null;
          // Filter to options-relevant types only — reject futures, indices, derivatives, crypto, forex
          const eligible = data.filter((d: any) => OPTIONS_TYPES.has((d.type || '').toLowerCase()));
          if (eligible.length === 0) return null;
          // Prefer exact symbol match first, then first eligible result
          const exact = eligible.find((d: any) => d.symbol.toUpperCase() === clean);
          const best = exact ?? eligible[0];
          if (!best) return null;
          return {
            symbol: best.symbol,
            exchange: best.exchange,
            fullSymbol: `${best.exchange}:${best.symbol}`,
            description: best.description,
            type: best.type,
          };
        } catch {
          return null;
        }
      }),
  }),
  csp: router({
    opportunities: protectedProcedure
      .input(
        z.object({
          symbols: z.array(z.string()).optional(),
          minDelta: z.number().optional(),
          maxDelta: z.number().optional(),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minVolume: z.number().optional(),
          minOI: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { scoreOpportunities } = await import('./scoring');
        const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');
        const { getEffectiveTier: _getETx } = await import('./middleware/subscriptionEnforcement');
        const _effTier = _getETx(ctx.user);

        // Check rate limit (VIP users treated as advanced, bypass free_trial limits)
        const rateLimit = await checkRateLimit(ctx.user.id, _effTier, ctx.user.role);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.message || 'Rate limit exceeded');
        }

        const credentials = await getApiCredentials(ctx.user.id);
        
        // Paper mode and free trial users can use the system Tradier key for market data scanning
        const isPaperOrFreeTrial = _effTier === 'free_trial' || ctx.user.tradingMode === 'paper';
        const tradierApiKey = credentials?.tradierApiKey || (isPaperOrFreeTrial ? process.env.TRADIER_API_KEY : null);
        
        if (!tradierApiKey) {
          if (isPaperOrFreeTrial) {
            throw new Error('System Tradier API key not configured. Please contact support.');
          } else {
            throw new Error('Please configure your Tradier API key in Settings to access live market data.');
          }
        }

        const api = createTradierAPI(tradierApiKey, false, ctx.user.id);
        const symbols = input.symbols || [];
        
        if (symbols.length === 0) {
          return [];
        }

        // Fetch CSP opportunities with filters
        const opportunities = await api.fetchCSPOpportunities(
          symbols,
          input.minDelta || 0.15,
          input.maxDelta || 0.35,
          input.minDte || 7,
          input.maxDte || 45,
          input.minVolume || 5,
          input.minOI || 50
        );

        // Score all opportunities
        const scored = scoreOpportunities(opportunities);
        console.log(`[CSP Router] Scored ${scored.length} opportunities, preparing to calculate risk badges...`);

        // Calculate risk badges for all opportunities
        const { calculateBulkRiskAssessments } = await import('./riskAssessment');
        console.log('[CSP Router] Imported calculateBulkRiskAssessments successfully');
        const symbolSet = new Set<string>();
        scored.forEach(opp => symbolSet.add(opp.symbol));
        const uniqueSymbols = Array.from(symbolSet);
        const riskAssessments = await calculateBulkRiskAssessments(uniqueSymbols, api);
        console.log('[CSP Router] Risk assessments Map size:', riskAssessments.size);
        console.log('[CSP Router] Risk assessments Map keys:', Array.from(riskAssessments.keys()));
        console.log('[CSP Router] Sample assessment for GS:', riskAssessments.get('GS'));
        
          // Attach risk badges to opportunities
        const scoredWithBadges = scored.map(opp => {
          const badges = riskAssessments.get(opp.symbol)?.badges || [];
          console.log(`[CSP Router] Attaching badges to ${opp.symbol}:`, badges);
          return {
            ...opp,
            riskBadges: badges,
          };
        });

        // ── ENRICH WITH LIVE TASTYTRADE PRICES ──────────────────────────────────
        // Tradier = scan/screen only. All order prices MUST come from Tastytrade.
        if (scoredWithBadges.length > 0 && credentials?.tastytradeClientSecret) {
          try {
            const { authenticateTastytrade: authTT_CSP } = await import('./tastytrade');
            const ttApiCSP = await authTT_CSP(credentials, ctx.user.id).catch(() => null);
            if (ttApiCSP) {
              const occSymbolsCSP = scoredWithBadges.map(o => o.optionSymbol).filter(Boolean) as string[];
              const ttQuotesCSP = await ttApiCSP.getOptionQuotesBatch(occSymbolsCSP).catch(() => ({}));
              for (const opp of scoredWithBadges) {
                const q = (ttQuotesCSP as any)[opp.optionSymbol];
                if (q) {
                  const ttBid = typeof q.bid === 'number' ? q.bid : parseFloat(q.bid || '0');
                  const ttAsk = typeof q.ask === 'number' ? q.ask : parseFloat(q.ask || '0');
                  const ttMid = (q.mark > 0 ? q.mark : null) ?? (q.mid > 0 ? q.mid : null) ?? ((ttBid + ttAsk) / 2);
                  console.log(`[CSP TT Price] ${opp.symbol} ${opp.strike} ${opp.expiration}: Tradier mid=$${opp.premium.toFixed(2)}, TT mid=$${ttMid.toFixed(2)}`);
                  if (ttBid > 0 || ttAsk > 0) {
                    (opp as any).bid = ttBid;
                    (opp as any).ask = ttAsk;
                    (opp as any).premium = ttMid; // STO: true mid-price from Tastytrade
                  }
                } else {
                  console.warn(`[CSP TT Price] No TT quote for ${opp.optionSymbol} — keeping Tradier price`);
                }
              }
            } else {
              console.warn('[CSP TT Price] Could not authenticate Tastytrade — keeping Tradier prices');
            }
          } catch (ttErrCSP: any) {
            console.warn('[CSP TT Price] Enrichment failed, keeping Tradier prices:', ttErrCSP.message);
          }
        }
        // ────────────────────────────────────────────────────────────────────────

        // Increment scan count for Tier 1 users (after successful scan)
        await incrementScanCount(ctx.user.id, _effTier, ctx.user.role);
        return scoredWithBadges;
      }),
    
    explainScore: protectedProcedure
      .input(
        z.object({
          symbol: z.string(),
          strike: z.number(),
          currentPrice: z.number(),
          premium: z.number(),
          delta: z.number(),
          dte: z.number(),
          rsi: z.number().nullable(),
          bbPctB: z.number().nullable(),
          ivRank: z.number().nullable(),
          score: z.number(),
          scoreBreakdown: z.union([
            // CSP Score Breakdown
            z.object({
              technical: z.number(),
              greeks: z.number(),
              premium: z.number(),
              quality: z.number(),
              total: z.number(),
            }),
            // BPS Score Breakdown
            z.object({
              spreadEfficiency: z.number(),
              greeks: z.number(),
              technical: z.number(),
              premium: z.number(),
              total: z.number(),
            }),
          ]),
        })
      )
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        
        // Detect if this is BPS or CSP based on scoreBreakdown structure
        const isBPS = 'spreadEfficiency' in input.scoreBreakdown;
        
        // Generate concise explanation of the score
        const strategyType = isBPS ? 'Bull Put Spread (BPS)' : 'Cash-Secured Put (CSP)';
        let breakdown: string;
        
        if (isBPS) {
          const bpsBreakdown = input.scoreBreakdown as { spreadEfficiency: number; greeks: number; technical: number; premium: number; total: number };
          breakdown = `- Spread Efficiency (ROC): ${bpsBreakdown.spreadEfficiency}/35
- Greeks & Timing (Delta + DTE): ${bpsBreakdown.greeks}/30
- Technical Setup (RSI + BB): ${bpsBreakdown.technical}/20
- Premium Quality (Spread + IV Rank): ${bpsBreakdown.premium}/15`;
        } else {
          const cspBreakdown = input.scoreBreakdown as { technical: number; greeks: number; premium: number; quality: number; total: number };
          breakdown = `- Technical Setup (RSI + BB): ${cspBreakdown.technical}/40
- Greeks & Timing (Delta + DTE + IV Rank): ${cspBreakdown.greeks}/30
- Premium Quality (Weekly Return + Spread): ${cspBreakdown.premium}/20
- Stock Quality (Mag 7 + Market Cap): ${cspBreakdown.quality}/10`;
        }
        
        const prompt = `You are explaining a ${strategyType} opportunity's composite score to a trader.

Opportunity Details:
- Symbol: ${input.symbol}
- Strike: $${input.strike}
- Current Price: $${input.currentPrice}
- Premium: $${input.premium}
- Delta: ${input.delta}
- DTE: ${input.dte} days
- RSI: ${input.rsi !== null ? input.rsi.toFixed(1) : 'N/A'}
- Bollinger Band %B: ${input.bbPctB !== null ? input.bbPctB.toFixed(2) : 'N/A'}
- IV Rank: ${input.ivRank !== null ? input.ivRank.toFixed(1) : 'N/A'}

Composite Score: ${input.score}/100
Breakdown:
${breakdown}

Provide a concise explanation (3-4 bullet points + 1 summary sentence) of WHY this opportunity scored ${input.score}/100.

Focus on:
1. Which components scored well and why
2. Which components scored poorly and why
3. What this means for the trade's attractiveness

Format:
• [Component]: [Brief explanation]
• [Component]: [Brief explanation]
• [Component]: [Brief explanation]

Summary: [One sentence overall assessment]`;

        const response = await invokeLLM({
          messages: [
            { role: 'system', content: 'You are a concise options trading educator. Explain scores clearly and briefly.' },
            { role: 'user', content: prompt },
          ],
        });

        const explanation = response.choices[0]?.message?.content || 'Unable to generate explanation';
        
        return {
          symbol: input.symbol,
          strike: input.strike,
          score: input.score,
          explanation,
        };
      }),
    
    validateOrders: protectedProcedure
      .input(
        z.object({
          orders: z.array(z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
            bid: z.number(),
            ask: z.number(),
            currentPrice: z.number(),
            ivRank: z.number().nullable().optional(),
            // Spread-specific fields
            isSpread: z.boolean().optional(),
            spreadType: z.enum(['bull_put', 'bear_call']).optional(),
            longStrike: z.number().optional(),
            longBid: z.number().optional(),
            longAsk: z.number().optional(),
            spreadWidth: z.number().optional(),
            capitalAtRisk: z.number().optional(),
          })),
          accountId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { getTastytradeAPI } = await import('./tastytrade');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
        }

        const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

        // Get account balances for buying power
        const accounts = await api.getAccounts();
        console.log('[validateOrders] Looking for accountId:', input.accountId);
        console.log('[validateOrders] Available accounts:', accounts.map((a: any) => ({ accountId: a.accountId, accountNumber: a.account?.['account-number'] })));
        
        // Match by accountNumber (which is the actual account ID from database)
        const account = accounts.find((acc: any) => acc.account?.['account-number'] === input.accountId);
        if (!account) {
          console.error('[validateOrders] Account not found! Input accountId:', input.accountId);
          console.error('[validateOrders] Available accountNumbers:', accounts.map((a: any) => a.account?.['account-number']));
          throw new Error('Account not found');
        }

                const balances = await api.getBalances(account.account['account-number']);
        // Use Tastytrade's buying power directly - it already accounts for existing positions
        const availableBuyingPower = Number(balances['derivative-buying-power'] || 0);
        
        console.log(`[validateOrders] Available BP from Tastytrade: $${availableBuyingPower.toFixed(2)}`);

        // Check market hours (simplified - just check if it's a weekday during market hours)
        const now = new Date();
        const day = now.getUTCDay();
        const hour = now.getUTCHours();
        const isMarketOpen = day >= 1 && day <= 5 && hour >= 14 && hour < 21; // Approximate EST market hours in UTC

        // Validate each order
        const validatedOrders = input.orders.map(order => {
          // For spreads, use capital at risk; for CSP, use full collateral
          // Guard against zero strike (data issue) by falling back to capitalAtRisk
          const collateral = order.isSpread
            ? (order.capitalAtRisk || (order.strike > 0 ? order.strike * 100 : 0))
            : (order.strike > 0 ? order.strike * 100 : 0);
          
          console.log(`[validateOrders] ${order.symbol} - isSpread: ${order.isSpread}, capitalAtRisk: ${order.capitalAtRisk}, strike: ${order.strike}, calculated collateral: ${collateral}`);
          // For spreads, use the net credit passed in (order.premium) as the midpoint.
          // Do NOT recalculate from (shortBid + shortAsk) / 2 — that gives the short leg's
          // individual price (~$17.60), not the net spread credit (~$4.35).
          const midpoint = order.isSpread ? order.premium : (order.bid + order.ask) / 2;
          
          // Validation checks
          let status: 'valid' | 'warning' = 'valid';
          let message = '';

          // Check strike price sanity (within 20% of current price for puts)
          const strikeVsPrice = (order.currentPrice - order.strike) / order.currentPrice;
          if (strikeVsPrice > 0.20 || strikeVsPrice < -0.05) {
            status = 'warning';
            message = 'Strike price far from current price';
          }

          // Check DTE (already filtered, but double-check)
          const dte = Math.floor((new Date(order.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (dte < 7 || dte > 60) {
            status = 'warning';
            message = 'Unusual DTE';
          }

          return {
            symbol: order.symbol,
            strike: order.strike,
            expiration: order.expiration,
            quantity: 1,
            // For spreads: premium is already the net credit (per share), multiply by 100 for per-contract.
            // For single-leg: midpoint is (bid+ask)/2 per share, multiply by 100 for per-contract.
            premium: midpoint * 100, // Premium per contract (net credit for spreads, mid for single-leg)
            collateral,
            status,
            message,
            currentPrice: order.currentPrice, // Pass through current price for AI analysis
            ivRank: order.ivRank, // Pass through IV Rank for AI analysis
            // Pass through spread details
            isSpread: order.isSpread,
            spreadType: order.spreadType,
            longStrike: order.longStrike,
            longBid: order.longBid ? order.longBid * 100 : undefined, // Long leg bid per contract
            longAsk: order.longAsk ? order.longAsk * 100 : undefined, // Long leg ask per contract
            spreadWidth: order.spreadWidth,
            // Market data for price adjustment
            bid: order.bid * 100, // Bid per contract
            ask: order.ask * 100, // Ask per contract
            mid: midpoint * 100, // Mid per contract
          };
        });

        // Calculate totals
        const totalPremium = validatedOrders.reduce((sum, o) => sum + o.premium, 0);
        const totalCollateral = validatedOrders.reduce((sum, o) => sum + o.collateral, 0);
        const remainingBuyingPower = availableBuyingPower - totalCollateral;
        
        console.log(`[validateOrders] Total collateral: $${totalCollateral.toFixed(2)}, Available buying power: $${availableBuyingPower.toFixed(2)}, Percentage: ${((totalCollateral / availableBuyingPower) * 100).toFixed(1)}%`);

        // Check if total collateral exceeds buying power
        const hasInsufficientBP = totalCollateral > availableBuyingPower;

        return {
          orders: validatedOrders,
          totalPremium,
          totalCollateral,
          availableBuyingPower,
          remainingBuyingPower,
          isMarketOpen,
          hasInsufficientBP,
        };
      }),
    submitOrders: protectedProcedure
      .input(
        z.object({
          orders: z.array(z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
            isSpread: z.boolean().optional(),
            optionSymbol: z.string().transform(val => val).optional(), // CSP: single leg
            shortLeg: z.object({
              optionSymbol: z.string(),
              action: z.enum(['Sell to Open', 'Buy to Close', 'Buy to Open', 'Sell to Close']),
            }).optional(), // Spread: short leg
            longLeg: z.object({
              optionSymbol: z.string(),
              action: z.enum(['Sell to Open', 'Buy to Close', 'Buy to Open', 'Sell to Close']),
            }).optional(), // Spread: long leg
            // Iron Condor: 4 legs
            isIronCondor: z.boolean().optional(),
            putShortLeg: z.object({
              optionSymbol: z.string(),
              action: z.enum(['Sell to Open', 'Buy to Close', 'Buy to Open', 'Sell to Close']),
            }).optional(),
            putLongLeg: z.object({
              optionSymbol: z.string(),
              action: z.enum(['Sell to Open', 'Buy to Close', 'Buy to Open', 'Sell to Close']),
            }).optional(),
            callShortLeg: z.object({
              optionSymbol: z.string(),
              action: z.enum(['Sell to Open', 'Buy to Close', 'Buy to Open', 'Sell to Close']),
            }).optional(),
            callLongLeg: z.object({
              optionSymbol: z.string(),
              action: z.enum(['Sell to Open', 'Buy to Close', 'Buy to Open', 'Sell to Close']),
            }).optional(),
          })),
          accountId: z.string(),
          dryRun: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Get user's trading mode from database
        const { getDb } = await import('./db');
        const { users } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database connection failed');
        const [userRecord] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
        const tradingMode = userRecord?.tradingMode || 'paper';

        // CRITICAL: Block order submission in paper trading mode
        if (tradingMode === 'paper' && !input.dryRun) {
          throw new Error('Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.');
        }

        // CRITICAL: If dry run, do NOT call Tastytrade API at all
        if (input.dryRun) {
          // Client-side dry run - just validate structure and return success
          console.log('[DRY RUN Debug] Received orders:', input.orders.length);
          const { isTrueIndexOption: isIndexOpt } = await import('../shared/orderUtils');
          
          const results = input.orders.map(order => {
            // Log each order's spread data
            console.log('[DRY RUN Debug] Order:', {
              symbol: order.symbol,
              strike: order.strike,
              premium: order.premium,
              isSpread: order.isSpread,
              hasShortLeg: !!order.shortLeg,
              hasLongLeg: !!order.longLeg,
              shortLeg: order.shortLeg,
              longLeg: order.longLeg,
            });
            
            // Build legs to see what would be submitted
            // NOTE: Tastytrade order submission API requires 'Equity Option' for ALL option legs.
            const dryRunInstrumentType: 'Equity Option' = 'Equity Option';
            const legs = order.isIronCondor && order.putShortLeg && order.putLongLeg && order.callShortLeg && order.callLongLeg
              ? [
                  { symbol: order.putShortLeg.optionSymbol, action: order.putShortLeg.action, instrumentType: dryRunInstrumentType },
                  { symbol: order.putLongLeg.optionSymbol, action: order.putLongLeg.action, instrumentType: dryRunInstrumentType },
                  { symbol: order.callShortLeg.optionSymbol, action: order.callShortLeg.action, instrumentType: dryRunInstrumentType },
                  { symbol: order.callLongLeg.optionSymbol, action: order.callLongLeg.action, instrumentType: dryRunInstrumentType },
                ]
              : order.isSpread && order.shortLeg && order.longLeg
              ? [
                  { symbol: order.shortLeg.optionSymbol, action: order.shortLeg.action, instrumentType: dryRunInstrumentType },
                  { symbol: order.longLeg.optionSymbol, action: order.longLeg.action, instrumentType: dryRunInstrumentType },
                ]
              : [{ symbol: order.optionSymbol, action: 'Sell to Open', instrumentType: dryRunInstrumentType }];
            
            console.log('[DRY RUN Debug] Would submit legs:', legs);
            
            return {
              symbol: order.symbol,
              success: true,
              orderId: 'DRY_RUN_' + Math.random().toString(36).substr(2, 9),
              message: `Dry run validation passed for ${order.symbol} ${order.strike}P @ $${order.premium} (${legs.length} legs)`,
            };
          });
          
          return {
            success: true,
            results,
          };
        }

        // Live mode - proceed with actual API calls
        const { getApiCredentials } = await import('./db');
        const { getTastytradeAPI } = await import('./tastytrade');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
        }

        const { authenticateTastytrade } = await import('./tastytrade');
        const api = await authenticateTastytrade(credentials, ctx.user.id);

        // ── EARNINGS BLOCK PRE-FLIGHT ────────────────────────────────────────
        {
          const { TradierAPI } = await import('./tradier');
          const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
          const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
          if (tradierKey) {
            const tradierAPI = new TradierAPI(tradierKey);
            const symbols = Array.from(new Set(input.orders.map((o: any) => o.symbol)));
            const earningsResult = await checkEarningsBlock(symbols, tradierAPI);
            if (earningsResult.blocked.length > 0) {
              throw new Error(formatEarningsBlockMessage(earningsResult));
            }
            if (earningsResult.warned.length > 0) {
              console.warn('[EarningsBlock] Earnings warning for submitted symbols:', earningsResult.warned);
            }
          }
        }
        // ────────────────────────────────────────────────────────────────────

        const results: Array<{ symbol: string; success: boolean; orderId?: string; error?: string }> = [];
        const BATCH_SIZE = 10; // Process 10 orders per batch
        const BATCH_DELAY_MS = 2000; // 2 second delay between batches
        const totalBatches = Math.ceil(input.orders.length / BATCH_SIZE);

        console.log(`[CSP/BullPut] Submitting ${input.orders.length} orders in ${totalBatches} batches`);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const batchStart = batchIndex * BATCH_SIZE;
          const batchEnd = Math.min(batchStart + BATCH_SIZE, input.orders.length);
          const batch = input.orders.slice(batchStart, batchEnd);

          console.log(`[CSP/BullPut] Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} orders)`);

          // Process batch concurrently
          const batchPromises = batch.map(async (order) => {
            try {
              // Log incoming order data for debugging
              console.log('[BPS Debug] Processing order:', {
                symbol: order.symbol,
                strike: order.strike,
                isSpread: order.isSpread,
                hasShortLeg: !!order.shortLeg,
                hasLongLeg: !!order.longLeg,
                shortLeg: order.shortLeg,
                longLeg: order.longLeg,
              });
              
              // For spreads and Iron Condors, the limit price comes directly from the user's
              // modal slider (order.premium). We do NOT override it with a server-side
              // freshNetCredit calculation — the user already set their desired fill price.
              // freshNetCredit is kept as a variable name for logging/GTC premium tracking only.
              const freshNetCredit = order.premium;
              
              // Build legs based on order type
              // NOTE: Tastytrade order submission API requires 'Equity Option' for ALL option legs.
              const legInstrumentType: 'Equity Option' = 'Equity Option';
              const legs = order.isIronCondor && order.putShortLeg && order.putLongLeg && order.callShortLeg && order.callLongLeg
              ? [
                    // Iron Condor: Leg 1 - Sell Put (short put)
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.putShortLeg.optionSymbol,
                      quantity: '1',
                      action: order.putShortLeg.action,
                    },
                    // Iron Condor: Leg 2 - Buy Put (long put)
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.putLongLeg.optionSymbol,
                      quantity: '1',
                      action: order.putLongLeg.action,
                    },
                    // Iron Condor: Leg 3 - Sell Call (short call)
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.callShortLeg.optionSymbol,
                      quantity: '1',
                      action: order.callShortLeg.action,
                    },
                    // Iron Condor: Leg 4 - Buy Call (long call)
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.callLongLeg.optionSymbol,
                      quantity: '1',
                      action: order.callLongLeg.action,
                    },
                  ]
              : order.isSpread && order.shortLeg && order.longLeg
              ? [
                    // Bull Put Spread / Bear Call Spread: Leg 1 - Sell to Open
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.shortLeg.optionSymbol,
                      quantity: '1',
                      action: order.shortLeg.action,
                    },
                    // Bull Put Spread / Bear Call Spread: Leg 2 - Buy to Open
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.longLeg.optionSymbol,
                      quantity: '1',
                      action: order.longLeg.action,
                    },
                  ]
                : [
                    // Regular CSP: Single leg
                    {
                      instrumentType: legInstrumentType,
                      symbol: order.optionSymbol!,
                      quantity: '1',
                      action: 'Sell to Open' as const,
                    },
                  ];
              
              // Determine limit price:
              // Always use order.premium — the user's chosen price from the modal slider.
              // No server-side buffer or override: the user controls the fill aggressiveness.
              const { snapToTick } = await import('../shared/orderUtils');
              const rawLimitPrice = Math.max(order.premium, 0.01);
              // Re-snap on server side using integer arithmetic to eliminate any FP drift from JSON serialization
              const limitPrice = snapToTick(rawLimitPrice, order.symbol);
              
              const orderRequest = {
                accountNumber: input.accountId,
                timeInForce: 'Day' as const,
                orderType: 'Limit' as const,
                price: limitPrice.toFixed(2),
                priceEffect: 'Credit' as const,
                legs,
              };
              
              // Log the order request being sent to Tastytrade
              console.log('[BPS Debug] Submitting order to Tastytrade:', {
                symbol: order.symbol,
                legCount: legs.length,
                legs: legs.map(leg => ({ symbol: leg.symbol, action: leg.action })),
                price: limitPrice.toFixed(2),
                orderRequest: JSON.stringify(orderRequest, null, 2),
              });

              // LIVE MODE ONLY - no dry run parameter
              const result = await api.submitOrder(orderRequest);
              await writeTradingLog({ userId: ctx.user.id, action: 'STO', strategy: (order as any).isIronCondor ? 'Iron Condor' : ((order as any).isSpread ? ((order as any).spreadType || 'Spread') : 'CSP'), symbol: order.symbol, optionSymbol: (order as any).optionSymbol || (order as any).shortLeg?.optionSymbol || '', accountNumber: input.accountId, price: limitPrice.toFixed(2), strike: String((order as any).strike || ''), expiration: order.expiration || '', quantity: 1, outcome: 'pending', orderId: String(result.id), source: 'Spread / CSP / Iron Condor STO' });
              // Build GTC legs (mirror of STO legs: Sell→Buy to Close, Buy→Sell to Close))
              const gtcLegs = legs.map(leg => ({
                symbol: leg.symbol,
                action: (leg.action === 'Sell to Open' ? 'Buy to Close' : 'Sell to Close') as 'Buy to Close' | 'Sell to Close',
                quantity: Number(leg.quantity),
                instrumentType: legInstrumentType, // Use same instrument type as the opening order
              }));

              // Telegram notification — fire-and-forget
              sendTelegramMessage(
                fmtOrderFilled({
                  symbol: order.symbol,
                  strategy: (order as any).isIronCondor ? 'IC' : ((order as any).isSpread ? ((order as any).spreadType === 'bear_call' ? 'BCS' : 'BPS') : 'CSP'),
                  strike: (order as any).strike ?? (order as any).shortLeg?.strike ?? 0,
                  expiration: order.expiration ?? '',
                  premium: freshNetCredit,
                  accountLabel: input.accountId,
                })
              ).catch(() => {});
              return {
                symbol: order.symbol,
                success: true,
                orderId: result.id,
                expiration: order.expiration,
                premium: freshNetCredit,
                legs: gtcLegs,
              };
            } catch (error: any) {
              // Log full error details for debugging
              console.error('[submitOrders] Order submission failed:', {
                symbol: order.symbol,
                strike: order.strike,
                expiration: order.expiration,
                premium: order.premium,
                optionSymbol: order.optionSymbol,
                accountId: input.accountId,
                dryRun: input.dryRun,
                errorMessage: error.message,
                errorStack: error.stack,
                errorResponse: error.response?.data || error.response || 'No response data',
              });
              
              // Extract detailed error message from Tastytrade response
              let detailedError = error.message || 'Unknown error';
              if (error.message?.includes('margin_check_failed') || error.message?.includes('insufficient buying power')) {
                detailedError = 'Insufficient buying power. Check for working orders or account restrictions.';
              }
              
              await writeTradingLog({ userId: ctx.user.id, action: 'STO', strategy: (order as any).isIronCondor ? 'Iron Condor' : ((order as any).isSpread ? ((order as any).spreadType || 'Spread') : 'CSP'), symbol: order.symbol, optionSymbol: (order as any).optionSymbol || (order as any).shortLeg?.optionSymbol || '', accountNumber: input.accountId, price: String(order.premium || '0'), strike: String((order as any).strike || ''), expiration: order.expiration || '', quantity: 1, outcome: 'error', errorMessage: detailedError, source: 'Spread / CSP / Iron Condor STO' });
              // Telegram notification — fire-and-forget
              sendTelegramMessage(
                fmtOrderRejected({
                  symbol: order.symbol,
                  strategy: (order as any).isIronCondor ? 'IC' : ((order as any).isSpread ? ((order as any).spreadType === 'bear_call' ? 'BCS' : 'BPS') : 'CSP'),
                  strike: (order as any).strike ?? (order as any).shortLeg?.strike,
                  reason: detailedError,
                  accountLabel: input.accountId,
                })
              ).catch(() => {});
              return {
                symbol: order.symbol,
                success: false,
                error: detailedError,
              };
            }
          });
          // Wait for batch to completee
          const batchResults = await Promise.allSettled(batchPromises);
          
          // Collect results
          batchResults.forEach((result) => {
            if (result.status === 'fulfilled') {
              results.push(result.value);
            } else {
              // Should not happen since we catch errors in the promise
              console.error(`[CSP/BullPut] Unexpected batch error:`, result.reason);
            }
          });

          const successCount = results.filter(r => r.success).length;
          console.log(`[CSP/BullPut] Batch ${batchIndex + 1}/${totalBatches} complete: ${successCount}/${results.length} successful`);

          // Delay between batches (except after last batch)
          if (batchIndex < totalBatches - 1) {
            console.log(`[CSP/BullPut] Waiting ${BATCH_DELAY_MS}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }

        const finalSuccessCount = results.filter(r => r.success).length;
        console.log(`[CSP/BullPut] All batches complete: ${finalSuccessCount}/${results.length} orders submitted successfully`);

        return {
          success: results.every(r => r.success),
          results,
        };
      }),
    evaluateOrder: protectedProcedure
      .input(
        z.object({
          orders: z.array(z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
            currentPrice: z.number(),
            ivRank: z.number().nullable().optional(),
            isSpread: z.boolean().optional(),
            spreadType: z.enum(['bull_put', 'bear_call']).optional(),
            longStrike: z.number().optional(),
            spreadWidth: z.number().optional(),
          })),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { invokeLLM } = await import('./_core/llm');
        
        // Build order summary for LLM
        const orderSummary = input.orders.map(order => {
          const dte = Math.floor((new Date(order.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const strikeVsPrice = ((order.currentPrice - order.strike) / order.currentPrice * 100).toFixed(1);
          const ivRankStr = order.ivRank !== null && order.ivRank !== undefined ? `IV Rank: ${order.ivRank}%` : 'IV Rank: N/A';
          
          if (order.isSpread) {
            return `${order.symbol} ${order.spreadType === 'bull_put' ? 'Bull Put Spread' : 'Bear Call Spread'}: ` +
                   `Sell $${order.strike} / Buy $${order.longStrike} (${order.spreadWidth}pt width), ` +
                   `${dte} DTE, Premium: $${order.premium.toFixed(2)}, ` +
                   `Current price: $${order.currentPrice.toFixed(2)} (short strike ${strikeVsPrice}% OTM), ` +
                   `${ivRankStr}`;
          } else {
            return `${order.symbol} Cash-Secured Put: Sell $${order.strike} strike, ` +
                   `${dte} DTE, Premium: $${order.premium.toFixed(2)}, ` +
                   `Current price: $${order.currentPrice.toFixed(2)} (strike ${strikeVsPrice}% OTM), ` +
                   `${ivRankStr}`;
          }
        }).join('\n');
        
        const prompt = `You are an expert options trader analyzing the following order(s) for entry quality:\n\n${orderSummary}\n\nProvide a comprehensive analysis covering:\n\n1. **Probability of Profit**: Estimate the likelihood these orders will expire worthless (profitable) based on:\n   - Strike selection relative to current price (% OTM)\n   - Days to expiration (DTE)\n   - IV Rank (higher IV = higher premium but more uncertainty)\n   - Current market environment\n\n2. **Risk Assessment**: \n   - Maximum loss potential\n   - Breakeven price(s)\n   - Risk/reward ratio (premium collected vs capital at risk)\n   - For spreads: explain the defined risk benefit and max loss calculation\n\n3. **Volatility Analysis**:\n   - Is the IV Rank favorable for selling premium? (>50% is generally good for sellers)\n   - Are premiums attractive relative to the risk?\n   - Consider if current volatility is elevated or suppressed\n\n4. **Market Context**:\n   - Technical levels (support/resistance near strikes)\n   - Macro factors that could impact the position\n   - Earnings or events before expiration\n\n5. **Recommendation**: Provide a clear verdict:\n   - **FAVORABLE**: Strong entry, good risk/reward\n   - **NEUTRAL**: Acceptable but not ideal\n   - **UNFAVORABLE**: Poor risk/reward or timing\n   \n   Include specific reasoning and any suggested adjustments (strike, DTE, size).\n\nBe specific, quantitative where possible, and actionable. Focus on practical trading insights.`;
        
        const response = await invokeLLM({
          messages: [
            { role: 'system', content: 'You are an expert options trading analyst providing actionable trade analysis.' },
            { role: 'user', content: prompt },
          ],
        });
        
        const analysis = response.choices[0].message.content;
        
        return {
          analysis,
          orderCount: input.orders.length,
        };
      }),

    // Batch evaluate multiple opportunities for Smart Select
    batchEvaluate: protectedProcedure
      .input(
        z.object({
          opportunities: z.array(z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
            currentPrice: z.number(),
            ivRank: z.number().nullable().optional(),
            delta: z.number().nullable().optional(),
            rsi: z.number().nullable().optional(),
            bbPosition: z.string().nullable().optional(), // 'below_lower', 'in_band', 'above_upper'
            week52High: z.number().nullable().optional(),
            week52Low: z.number().nullable().optional(),
            isMag7: z.boolean().optional(),
            isSpread: z.boolean().optional(),
            spreadType: z.enum(['bull_put', 'bear_call']).optional(),
            longStrike: z.number().optional(),
            spreadWidth: z.number().optional(),
          })),
          mode: z.enum(['conservative', 'aggressive']).optional().default('conservative'),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { invokeLLM } = await import('./_core/llm');
        
        // Evaluate each opportunity individually
        const evaluations = await Promise.all(
          input.opportunities.map(async (opp) => {
            const dte = Math.floor((new Date(opp.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const strikeVsPrice = ((opp.currentPrice - opp.strike) / opp.currentPrice * 100).toFixed(1);
            
            // Calculate weekly return for target assessment
            const weeklyReturn = (opp.premium / (opp.strike * 100)) * 100;
            
            // Build comprehensive trade description
            const stockQuality = opp.isMag7 ? 'Mag 7 (Premium Quality)' : 'Standard';
            const deltaStr = opp.delta !== null && opp.delta !== undefined ? `Delta: ${(opp.delta * 100).toFixed(1)}` : 'Delta: N/A';
            const rsiStr = opp.rsi !== null && opp.rsi !== undefined ? `RSI: ${opp.rsi.toFixed(1)}` : 'RSI: N/A';
            const bbStr = opp.bbPosition ? `BB Position: ${opp.bbPosition}` : 'BB: N/A';
            const ivRankStr = opp.ivRank !== null && opp.ivRank !== undefined ? `IV Rank: ${opp.ivRank}%` : 'IV Rank: N/A';
            
            let orderDesc = '';
            if (opp.isSpread) {
              orderDesc = `${opp.symbol} ${opp.spreadType === 'bull_put' ? 'Bull Put Spread' : 'Bear Call Spread'}\n` +
                         `Stock Quality: ${stockQuality}\n` +
                         `Sell $${opp.strike} / Buy $${opp.longStrike} (${opp.spreadWidth}pt width)\n` +
                         `${dte} DTE, Premium: $${opp.premium.toFixed(2)} (${weeklyReturn.toFixed(2)}% weekly return)\n` +
                         `Current price: $${opp.currentPrice.toFixed(2)} (short strike ${strikeVsPrice}% OTM)\n` +
                         `${deltaStr}, ${rsiStr}, ${bbStr}, ${ivRankStr}`;
            } else {
              orderDesc = `${opp.symbol} Cash-Secured Put (Wheel Strategy)\n` +
                         `Stock Quality: ${stockQuality}\n` +
                         `Sell $${opp.strike} strike\n` +
                         `${dte} DTE, Premium: $${opp.premium.toFixed(2)} (${weeklyReturn.toFixed(2)}% weekly return)\n` +
                         `Current price: $${opp.currentPrice.toFixed(2)} (strike ${strikeVsPrice}% OTM)\n` +
                         `${deltaStr}, ${rsiStr}, ${bbStr}, ${ivRankStr}`;
            }
            
            // Determine strategy type for weighting
            const strategyType = opp.isSpread ? 'spread' : 'csp';
            const isConservative = input.mode === 'conservative';
            
            const prompt = `You are a quality-focused options trader analyzing this ${strategyType === 'csp' ? 'Cash-Secured Put' : 'Spread'} trade:\n\n${orderDesc}\n\n=== EVALUATION FRAMEWORK ===\n\n**TIER 1: Stock Quality (${strategyType === 'csp' ? '40%' : strategyType === 'spread' ? '25%' : '45%'} weight)**\n- Mag 7 stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA) = HIGHEST priority\n- These are assignment-worthy companies for the Wheel strategy\n- For CSP: Would you want to own this stock at this strike price?\n\n**TIER 2: Technical Setup (${strategyType === 'csp' ? '30%' : '30%'} weight)**\n- RSI: For CSP, <30 = oversold (ideal), 30-40 = good, >50 = caution\n- Bollinger Bands: below_lower = oversold (ideal for CSP), in_band = neutral, above_upper = overbought\n- Technical alignment indicates mean reversion opportunity\n\n**TIER 3: Greeks & Timing (${strategyType === 'csp' ? '20%' : '35%'} weight)**\n- DTE: 7-10 days = IDEAL (weekly trading), 11-14 = acceptable, >14 = penalize\n- Delta: 20-29 = IDEAL range, 15-19 or 30-35 = acceptable, outside = penalize\n- IV Rank: >50% = excellent premium, 30-50% = good, <30% = only if other factors strong\n\n**TIER 4: Premium Quality (${strategyType === 'csp' ? '10%' : '10%'} weight)**\n${isConservative ? 
  '- Conservative Mode: Target 0.75-1.25% weekly for CSP, 1.5-2.5% for spreads' :
  '- Aggressive Mode: Target 1.5-2.5% weekly for CSP, 2.5-4% for spreads (reach for 8-10% monthly)'
}\n- Premium must balance with probability of success\n\n=== STRATEGY-SPECIFIC GUIDANCE ===\n${strategyType === 'csp' ? 
  '**Cash-Secured Put (Wheel Strategy):**\n- PRIORITY: Stock quality first - assignment is acceptable if stock is great\n- Look for oversold conditions (low RSI, below lower BB)\n- Conservative approach - you want to own these stocks' :
  '**Spread Strategy:**\n- PRIORITY: Premium/ROC optimization - no assignment risk\n- More aggressive returns acceptable (6-10% monthly target)\n- Technical setup still important for probability'
}\n\n=== YOUR ANALYSIS ===\nProvide:\n1. **Stock Quality Score** (Critical for CSP): Is this an assignment-worthy company?\n2. **Technical Setup**: RSI + BB alignment - is this oversold/mean reversion opportunity?\n3. **Greeks Assessment**: DTE (7-10 ideal?) + Delta (20-29 ideal?) + IV Rank\n4. **Premium Evaluation**: Does weekly return meet ${isConservative ? 'conservative' : 'aggressive'} target?\n5. **VERDICT**: FAVORABLE (strong trade), NEUTRAL (acceptable), or UNFAVORABLE (pass)\n6. **Key Reason**: One sentence explaining verdict\n\nBe practical - prioritize quality stocks with good technical setups. Not every metric needs to be perfect, but stock quality is paramount for CSP.`;
            
            try {
              const response = await invokeLLM({
                messages: [
                  { role: 'system', content: 'You are a quality-focused options trader who prioritizes stock quality and technical setups for premium-selling strategies. For CSP/Wheel, assignment is acceptable if the stock is high-quality (Mag 7 preferred). Provide practical, balanced assessments that consider the trader\'s monthly return targets (3-5% conservative, 8-10% aggressive). Not every metric needs to be perfect, but stock quality and technical alignment are paramount.' },
                  { role: 'user', content: prompt },
                ],
              });
              
              const analysis = typeof response.choices[0].message.content === 'string' 
                ? response.choices[0].message.content 
                : 'Analysis unavailable';
              
              // Extract recommendation from analysis
              let recommendation: 'favorable' | 'neutral' | 'unfavorable' = 'neutral';
              const analysisUpper = analysis.toUpperCase();
              if (analysisUpper.includes('FAVORABLE') && !analysisUpper.includes('UNFAVORABLE')) {
                recommendation = 'favorable';
              } else if (analysisUpper.includes('UNFAVORABLE')) {
                recommendation = 'unfavorable';
              }
              
              return {
                symbol: opp.symbol,
                strike: opp.strike,
                recommendation,
                analysis,
              };
            } catch (error) {
              console.error(`Error evaluating ${opp.symbol}:`, error);
              return {
                symbol: opp.symbol,
                strike: opp.strike,
                recommendation: 'neutral' as const,
                analysis: 'Analysis unavailable',
              };
            }
          })
        );
        
        return {
          evaluations,
          summary: {
            total: evaluations.length,
            favorable: evaluations.filter(e => e.recommendation === 'favorable').length,
            neutral: evaluations.filter(e => e.recommendation === 'neutral').length,
            unfavorable: evaluations.filter(e => e.recommendation === 'unfavorable').length,
          },
        };
      }),
  }),

  // Iron Condor (4-leg strategy: Bull Put Spread + Bear Call Spread)
  ironCondor: router({
    opportunities: protectedProcedure
      .input(
        z.object({
          symbols: z.array(z.string()).optional(),
          minDelta: z.number().optional(),
          maxDelta: z.number().optional(),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minVolume: z.number().optional(),
          minOI: z.number().optional(),
          spreadWidth: z.number(), // 2, 5, or 10 (same width for both sides)
          symbolWidths: z.record(z.string(), z.number()).optional(), // per-symbol overrides e.g. { SPX: 50, NDX: 25 }
          isIndexMode: z.boolean().optional(), // true when scanning index products
        })
      )
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { scoreOpportunities } = await import('./scoring');
        const { calculateBullPutSpread, calculateBearCallSpread } = await import('./spread-pricing');
        const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');
        const { getEffectiveTier: _getETx } = await import('./middleware/subscriptionEnforcement');
        const _effTier = _getETx(ctx.user);

        // Check rate limit (VIP users treated as advanced, bypass free_trial limits)
        const rateLimit = await checkRateLimit(ctx.user.id, _effTier, ctx.user.role);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.message || 'Rate limit exceeded');
        }

        const credentials = await getApiCredentials(ctx.user.id);
        
        // Paper mode and free trial users can use the system Tradier key for market data scanning
        const isPaperOrFreeTrial = _effTier === 'free_trial' || ctx.user.tradingMode === 'paper';
        const tradierApiKey = credentials?.tradierApiKey || (isPaperOrFreeTrial ? process.env.TRADIER_API_KEY : null);
        
        if (!tradierApiKey) {
          if (isPaperOrFreeTrial) {
            throw new Error('System Tradier API key not configured. Please contact support.');
          } else {
            throw new Error('Please configure your Tradier API key in Settings to access live market data.');
          }
        }

        const api = createTradierAPI(tradierApiKey, false, ctx.user.id);
        const symbols = input.symbols || [];
        
        if (symbols.length === 0) {
          return [];
        }

        console.log(`[Iron Condor] Scanning ${symbols.length} symbols for Iron Condor opportunities...`);

        // Fetch CSP opportunities (these will be the put side short strikes)
        // skipTechnicals=true: RSI/BB are not used in IC scoring — skip 200-day history calls
        // to avoid overwhelming Tradier with 62 parallel history requests (saves ~60s)
        const cspOpportunities = await api.fetchCSPOpportunities(
          symbols,
          input.minDelta || 0.15,
          input.maxDelta || 0.35,
          input.minDte || 7,
          input.maxDte || 45,
          input.minVolume || 5,
          input.minOI || 50,
          true // skipTechnicals
        );

        console.log(`[Iron Condor] Found ${cspOpportunities.length} CSP opportunities`);

        // Pre-fetch all unique option chains for both puts and calls
        const chainCache = new Map<string, any[]>();
        const uniqueChains = new Map<string, { symbol: string; expiration: string }>();
        
        for (const opp of cspOpportunities) {
          const key = `${opp.symbol}|${opp.expiration}`;
          if (!uniqueChains.has(key)) {
            uniqueChains.set(key, { symbol: opp.symbol, expiration: opp.expiration });
          }
        }
        
        console.log(`[Iron Condor] Fetching ${uniqueChains.size} unique option chains...`);
        
        // Tradier option root map: SPXW/NDXP/MRUT chains are listed under SPX/NDX/RUT.
        const IC_CHAIN_ROOT_MAP: Record<string, string> = {
          SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
        };
        // Fetch ALL chains fully in parallel — no sequential batching
        const chainEntries = Array.from(uniqueChains.entries());
        await Promise.allSettled(
          chainEntries.map(async ([key, { symbol, expiration }]) => {
            try {
              const chainRoot = IC_CHAIN_ROOT_MAP[symbol.toUpperCase()] || symbol;
              const options = await withRateLimit(() => api.getOptionChain(chainRoot, expiration, true));
              chainCache.set(key, options);
              console.log(`[Iron Condor] Cached chain for ${symbol} (root: ${chainRoot}) ${expiration} (${options.length} contracts)`);
            } catch (error) {
              console.error(`[Iron Condor] Failed to fetch chain for ${symbol} ${expiration}:`, error);
              chainCache.set(key, []); // Cache empty array to avoid retry
            }
          })
        );
        
        console.log(`[Iron Condor] Cached ${chainCache.size} option chains, now calculating spreads...`);
        
        // Build a per-symbol effective spread width.
        // A 5-point spread on SPX ($6,740) yields near-zero premium — auto-scale for indexes.
        // Rule: effective width = max(user input, round(underlyingPrice * 0.004 / 5) * 5)
        // This gives ~25 pts for SPX, ~100 pts for NDX, ~10 pts for MRUT.
        const symbolPriceMap = new Map<string, number>();
        for (const opp of cspOpportunities) {
          if (!symbolPriceMap.has(opp.symbol)) symbolPriceMap.set(opp.symbol, opp.currentPrice);
        }
        // Alias map: OCC weekly/PM roots → canonical watchlist symbol used as symbolWidths key.
        // e.g., user adds 'SPX' to watchlist → symbolWidths['SPX']=50; scan may encounter 'SPXW'.
        const SYMBOL_WIDTH_ALIAS_IC: Record<string, string> = {
          SPXW: 'SPX', SPXPM: 'SPX',
          NDXP: 'NDX',
          MRUT: 'RUT',
          VIXW: 'VIX',
        };
        const getEffectiveWidth = (sym: string): number => {
          const symUpper = sym.toUpperCase();
          if (input.symbolWidths) {
            if (input.symbolWidths[symUpper] !== undefined) return input.symbolWidths[symUpper];
            const alias = SYMBOL_WIDTH_ALIAS_IC[symUpper];
            if (alias && input.symbolWidths[alias] !== undefined) return input.symbolWidths[alias];
          }
          const price = symbolPriceMap.get(sym) || 0;
          if (price < 500) return input.spreadWidth; // small-price symbols: use user input
          const autoWidth = Math.max(input.spreadWidth, Math.round((price * 0.004) / 5) * 5);
          return autoWidth;
        };

        // Calculate Bull Put Spreads
        const bullPutSpreads = new Map<string, any>();
        let bpsAttempts = 0, bpsNoChain = 0, bpsNoLongPut = 0, bpsNoCredit = 0;
        for (const cspOpp of cspOpportunities) {
          try {
            bpsAttempts++;
            // Hard structural filter: short put must be OTM (strike < current price).
            // The CSP scanner now enforces this too, but guard here as well in case
            // cspOpportunities comes from a path that bypasses that filter.
            if (cspOpp.strike >= cspOpp.currentPrice) {
              console.log(`[BPS Scanner] Skipping ITM short put ${cspOpp.symbol} strike ${cspOpp.strike} (price=${cspOpp.currentPrice})`);
              bpsNoCredit++;
              continue;
            }
            const effectiveWidth = getEffectiveWidth(cspOpp.symbol);
            const longStrike = cspOpp.strike - effectiveWidth;
            const key = `${cspOpp.symbol}|${cspOpp.expiration}`;
            const options = chainCache.get(key) || [];
            
            if (options.length === 0) { bpsNoChain++; continue; }
            
            // Find the long put at or near the target strike (SPX uses non-uniform strike intervals)
            const putStrikes = options
              .filter(o => o.option_type === 'put' && o.bid && o.ask)
              .map(o => o.strike)
              .sort((a, b) => a - b);
            // Find the closest available put strike at or below the target long strike
            const bestLongPutStrike = putStrikes.filter(s => s <= longStrike).pop();
            const longPut = bestLongPutStrike !== undefined
              ? options.find(o => o.option_type === 'put' && o.strike === bestLongPutStrike && o.bid && o.ask)
              : undefined;
            
            if (!longPut) { bpsNoLongPut++; continue; }
            
            const spreadOpp = calculateBullPutSpread(
              cspOpp,
              effectiveWidth,
              {
                bid: longPut.bid,
                ask: longPut.ask,
                delta: Math.abs(longPut.greeks?.delta || 0),
              }
            );
            
            const bpsWidth = spreadOpp.spreadWidth || effectiveWidth;
            const bpsCreditRatio = bpsWidth > 0 ? spreadOpp.netCredit / bpsWidth : 0;
            if (spreadOpp.netCredit > 0 && bpsCreditRatio <= 0.80) {
              // Attach OCC symbols so TT price enrichment can batch-fetch live prices
              (spreadOpp as any).shortOptionSymbol = cspOpp.optionSymbol;
              (spreadOpp as any).longOptionSymbol = longPut.symbol;
              bullPutSpreads.set(key, spreadOpp);
            } else {
              if (bpsCreditRatio > 0.80) console.log(`[IC BPS] Rejecting ${cspOpp.symbol} strike ${cspOpp.strike}: credit/width ${(bpsCreditRatio*100).toFixed(0)}% > 80%`);
              bpsNoCredit++;
            }
          } catch (error) {
            console.error(`[Iron Condor] Error calculating BPS for ${cspOpp.symbol}:`, error);
          }
        }
        console.log(`[Iron Condor] BPS: ${bpsAttempts} attempts, ${bpsNoChain} no-chain, ${bpsNoLongPut} no-long-put, ${bpsNoCredit} no-credit, ${bullPutSpreads.size} formed`);
        // Log first few BPS keys to verify symbol format
        const bpsKeys = Array.from(bullPutSpreads.keys()).slice(0, 5);
        if (bpsKeys.length > 0) console.log(`[Iron Condor] BPS keys sample:`, bpsKeys);

        // Calculate Bear Call Spreads from the same option chains
        const bearCallSpreads = new Map<string, any>();
        for (const bps of Array.from(bullPutSpreads.values())) {
          try {
            const key = `${bps.symbol}|${bps.expiration}`;
            const options = chainCache.get(key) || [];
            
            if (options.length === 0) continue;
            
            // Find OTM calls with similar delta to our puts (symmetric Iron Condor)
            // For index symbols (price > 500), relax OI/volume filters — index options
            // have different liquidity profiles than equities.
            const bcsEffectiveWidth = getEffectiveWidth(bps.symbol);
            const isHighPriceIndex = (symbolPriceMap.get(bps.symbol) || 0) > 500;
            const callCandidates = options.filter(
              opt => opt.option_type === 'call' && 
                     opt.strike > bps.currentPrice && // OTM
                     Math.abs(opt.greeks?.delta || 0) >= (input.minDelta || 0.15) &&
                     Math.abs(opt.greeks?.delta || 0) <= (input.maxDelta || 0.35) &&
                     (isHighPriceIndex || (opt.volume || 0) >= (input.minVolume || 5)) &&
                     (isHighPriceIndex || (opt.open_interest || 0) >= (input.minOI || 50)) &&
                     opt.bid && opt.ask
            );
            
            if (callCandidates.length === 0) continue;
            
            // Pick the call closest to our target delta (mirror of put side)
            const targetDelta = Math.abs(bps.delta);
            const shortCall = callCandidates.reduce((best, curr) => {
              const currDiff = Math.abs(Math.abs(curr.greeks?.delta || 0) - targetDelta);
              const bestDiff = Math.abs(Math.abs(best.greeks?.delta || 0) - targetDelta);
              return currDiff < bestDiff ? curr : best;
            });
            
            // Find the long call at or near the target strike (index options use non-uniform intervals)
            const callStrikes = options
              .filter(o => o.option_type === 'call' && o.bid && o.ask)
              .map(o => o.strike)
              .sort((a, b) => a - b);
            const targetLongCallStrike = shortCall.strike + bcsEffectiveWidth;
            // Find the closest available call strike at or above the target long strike
            const bestLongCallStrike = callStrikes.find(s => s >= targetLongCallStrike);
            const longCall = bestLongCallStrike !== undefined
              ? options.find(o => o.option_type === 'call' && o.strike === bestLongCallStrike && o.bid && o.ask)
              : undefined;
            
            if (!longCall) continue;
            
            // Create a CC-like opportunity object for calculateBearCallSpread
            const ccOpp: any = {
              symbol: bps.symbol,
              currentPrice: bps.currentPrice,
              strike: shortCall.strike,
              expiration: bps.expiration,
              dte: bps.dte,
              premium: shortCall.bid,
              bid: shortCall.bid,
              ask: shortCall.ask,
              delta: Math.abs(shortCall.greeks?.delta || 0),
              volume: shortCall.volume || 0,
              openInterest: shortCall.open_interest || 0,
              ivRank: bps.ivRank,
            };
            
            const spreadOpp = calculateBearCallSpread(
              ccOpp,
              bcsEffectiveWidth,
              {
                bid: longCall.bid,
                ask: longCall.ask,
                delta: Math.abs(longCall.greeks?.delta || 0),
              }
            );
            
            const bcsWidth = spreadOpp.spreadWidth || bcsEffectiveWidth;
            const bcsCreditRatio = bcsWidth > 0 ? spreadOpp.netCredit / bcsWidth : 0;
            if (spreadOpp.netCredit > 0 && bcsCreditRatio <= 0.80) {
              // Attach OCC symbols for TT price enrichment
              (spreadOpp as any).shortOptionSymbol = shortCall.symbol;
              (spreadOpp as any).longOptionSymbol = longCall.symbol;
              bearCallSpreads.set(key, spreadOpp);
            } else if (bcsCreditRatio > 0.80) {
              console.log(`[IC BCS] Rejecting ${bps.symbol} strike ${ccOpp.strike}: credit/width ${(bcsCreditRatio*100).toFixed(0)}% > 80%`);
            }
          } catch (error) {
            console.error(`[Iron Condor] Error calculating BCS for ${bps.symbol}:`, error);
          }
        }

        // Log BCS details
        const bcsKeys = Array.from(bearCallSpreads.keys()).slice(0, 5);
        if (bcsKeys.length > 0) console.log(`[Iron Condor] BCS keys sample:`, bcsKeys);
        else console.log(`[Iron Condor] BCS: 0 formed — all BPS had no matching call candidates`);
        console.log(`[Iron Condor] Calculated ${bullPutSpreads.size} BPS, ${bearCallSpreads.size} BCS`);

        // Pair Bull Put Spreads with Bear Call Spreads to form Iron Condors
        const ironCondors = [];
        for (const [key, bps] of Array.from(bullPutSpreads.entries())) {
          const bcs = bearCallSpreads.get(key);
          if (!bcs) continue; // Need both sides for Iron Condor

          // Calculate combined metrics
          const totalNetCredit = bps.netCredit + bcs.netCredit;
          
          // For Iron Condors, collateral = max(put spread width, call spread width) × multiplier
          // This is because you only need to cover the wider spread
          const icMultiplier = bps.multiplier ?? 100;
          const totalCollateral = Math.max(bps.spreadWidth, bcs.spreadWidth) * icMultiplier;
          
          // ROC = (total net credit × multiplier) / total collateral × 100
          const combinedROC = totalCollateral > 0 ? ((totalNetCredit * icMultiplier) / totalCollateral) * 100 : 0;

          // Breakevens
          const lowerBreakeven = bps.strike - totalNetCredit;
          const upperBreakeven = bcs.strike + totalNetCredit;

          ironCondors.push({
            symbol: bps.symbol,
            expiration: bps.expiration,
            dte: bps.dte,
            currentPrice: bps.currentPrice,
            
            // Put side (Bull Put Spread)
            putShortStrike: bps.strike,
            putLongStrike: bps.longStrike,
            putNetCredit: bps.netCredit,
            putShortBid: bps.bid,
            putShortAsk: bps.ask,
            putLongBid: bps.longBid,
            putLongAsk: bps.longAsk,
            putShortDelta: bps.delta,
            putLongDelta: bps.longDelta,
            
            // Call side (Bear Call Spread)
            callShortStrike: bcs.strike,
            callLongStrike: bcs.longStrike,
            callNetCredit: bcs.netCredit,
            callShortBid: bcs.bid,
            callShortAsk: bcs.ask,
            callLongBid: bcs.longBid,
            callLongAsk: bcs.longAsk,
            callShortDelta: bcs.delta,
            callLongDelta: bcs.longDelta,
            
            // Combined metrics
            totalNetCredit,
            totalCollateral,
            roc: combinedROC,
            lowerBreakeven,
            upperBreakeven,
            profitZone: upperBreakeven - lowerBreakeven,
            
            // For scoring (use average of both sides)
            volume: (bps.volume + bcs.volume) / 2,
            openInterest: (bps.openInterest + bcs.openInterest) / 2,
            ivRank: bps.ivRank, // Assume same for both
            
            // Technical indicators (from underlying stock)
            rsi: bps.rsi,
            bbPctB: bps.bbPctB,
            
            // Net Delta (sum of all 4 legs) - measures directional exposure
            // Ideally close to 0 for delta-neutral Iron Condors
            netDelta: (bps.delta || 0) + (bps.longDelta || 0) + (bcs.delta || 0) + (bcs.longDelta || 0),

            // OCC symbols for each leg — used by TT price enrichment
            putShortOptionSymbol: (bps as any).shortOptionSymbol,
            putLongOptionSymbol: (bps as any).longOptionSymbol,
            callShortOptionSymbol: (bcs as any).shortOptionSymbol,
            callLongOptionSymbol: (bcs as any).longOptionSymbol,
          });
        }

        console.log(`[Iron Condor] Formed ${ironCondors.length} Iron Condor opportunities`);

        // Score Iron Condors using SPXW-aware scoring (index path vs equity path)
        const { scoreIronCondors } = await import('./ic-scoring');
        const scoredIronCondors = scoreIronCondors(ironCondors.map(ic => ({
          ...ic,
          spreadWidth: Math.max(
            Math.abs((ic.putShortStrike || 0) - (ic.putLongStrike || 0)),
            Math.abs((ic.callShortStrike || 0) - (ic.callLongStrike || 0))
          ),
        })));

        // Sort by score descending
        scoredIronCondors.sort((a, b) => b.score - a.score);
        console.log(`[Iron Condor Router] Scored ${scoredIronCondors.length} opportunities, preparing to calculate risk badges...`);

        // Calculate risk badges for all opportunities
        const { calculateBulkRiskAssessments } = await import('./riskAssessment');
        console.log('[Iron Condor Router] Imported calculateBulkRiskAssessments successfully');
        const symbolSet = new Set<string>();
        scoredIronCondors.forEach((opp: any) => symbolSet.add(opp.symbol));
        const uniqueSymbols = Array.from(symbolSet);
        const riskAssessments = await calculateBulkRiskAssessments(uniqueSymbols, api);
        
        // Attach risk badges to opportunities
        const scoredWithBadges = scoredIronCondors.map((opp: any) => ({
          ...opp,
          riskBadges: riskAssessments.get(opp.symbol)?.badges || [],
        }));

        // ── ENRICH WITH LIVE TASTYTRADE PRICES (IC) ──────────────────────────────
        // Tradier = scan/screen only. All order prices MUST come from Tastytrade.
        if (scoredWithBadges.length > 0 && credentials?.tastytradeClientSecret) {
          try {
            const { authenticateTastytrade: authTT_IC } = await import('./tastytrade');
            const ttApiIC = await authTT_IC(credentials, ctx.user.id).catch(() => null);
            if (ttApiIC) {
              const allLegSymbols = new Set<string>();
              for (const ic of scoredWithBadges) {
                if ((ic as any).putShortOptionSymbol) allLegSymbols.add((ic as any).putShortOptionSymbol);
                if ((ic as any).putLongOptionSymbol) allLegSymbols.add((ic as any).putLongOptionSymbol);
                if ((ic as any).callShortOptionSymbol) allLegSymbols.add((ic as any).callShortOptionSymbol);
                if ((ic as any).callLongOptionSymbol) allLegSymbols.add((ic as any).callLongOptionSymbol);
              }
              const ttQuotesIC = await ttApiIC.getOptionQuotesBatch(Array.from(allLegSymbols)).catch(() => ({}));
              for (const ic of scoredWithBadges) {
                const psSym = (ic as any).putShortOptionSymbol;
                const plSym = (ic as any).putLongOptionSymbol;
                const csSym = (ic as any).callShortOptionSymbol;
                const clSym = (ic as any).callLongOptionSymbol;
                const psQ = psSym ? (ttQuotesIC as any)[psSym] : null;
                const plQ = plSym ? (ttQuotesIC as any)[plSym] : null;
                const csQ = csSym ? (ttQuotesIC as any)[csSym] : null;
                const clQ = clSym ? (ttQuotesIC as any)[clSym] : null;
                const ttPSBid = psQ ? (parseFloat(psQ.bid) || 0) : 0;
                const ttPSAsk = psQ ? (parseFloat(psQ.ask) || 0) : 0;
                const ttPLBid = plQ ? (parseFloat(plQ.bid) || 0) : 0;
                const ttPLAsk = plQ ? (parseFloat(plQ.ask) || 0) : 0;
                const ttCSBid = csQ ? (parseFloat(csQ.bid) || 0) : 0;
                const ttCSAsk = csQ ? (parseFloat(csQ.ask) || 0) : 0;
                const ttCLBid = clQ ? (parseFloat(clQ.bid) || 0) : 0;
                const ttCLAsk = clQ ? (parseFloat(clQ.ask) || 0) : 0;
                if (ttPSBid > 0 || ttPSAsk > 0) {
                  (ic as any).putShortBid = ttPSBid;
                  (ic as any).putShortAsk = ttPSAsk;
                }
                if (ttPLBid > 0 || ttPLAsk > 0) {
                  (ic as any).putLongBid = ttPLBid;
                  (ic as any).putLongAsk = ttPLAsk;
                }
                if (ttCSBid > 0 || ttCSAsk > 0) {
                  (ic as any).callShortBid = ttCSBid;
                  (ic as any).callShortAsk = ttCSAsk;
                }
                if (ttCLBid > 0 || ttCLAsk > 0) {
                  (ic as any).callLongBid = ttCLBid;
                  (ic as any).callLongAsk = ttCLAsk;
                }
                // Recalculate net credits from TT prices
                const ttPutNetCredit = ((ttPSBid + ttPSAsk) / 2) - ((ttPLBid + ttPLAsk) / 2);
                const ttCallNetCredit = ((ttCSBid + ttCSAsk) / 2) - ((ttCLBid + ttCLAsk) / 2);
                if (ttPutNetCredit > 0) (ic as any).putNetCredit = ttPutNetCredit;
                if (ttCallNetCredit > 0) (ic as any).callNetCredit = ttCallNetCredit;
                if (ttPutNetCredit > 0 || ttCallNetCredit > 0) {
                  (ic as any).totalNetCredit = (ttPutNetCredit > 0 ? ttPutNetCredit : (ic as any).putNetCredit) +
                                               (ttCallNetCredit > 0 ? ttCallNetCredit : (ic as any).callNetCredit);
                }
              }
            }
          } catch (ttErrIC: any) {
            console.warn('[IC TT Price] Enrichment failed, keeping Tradier prices:', ttErrIC.message);
          }
        }
        // ────────────────────────────────────────────────────────────────────────

        // Increment scan count for Tier 1 users (after successful scan)
        await incrementScanCount(ctx.user.id, _effTier, ctx.user.role);
        return scoredWithBadges;
      }),
  }),
  // Bull Put Spreads (Phase 2: Backend Pricing)g)
  spread: router({
    // ── ASYNC SCAN: startScan fires background job, pollScan returns progress/results ──
    // This pattern bypasses the 300s gateway timeout by returning a jobId immediately.
    startScan: protectedProcedure
      .input(
        z.object({
          symbols: z.array(z.string()).optional(),
          minDelta: z.number().optional(),
          maxDelta: z.number().optional(),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minVolume: z.number().optional(),
          minOI: z.number().optional(),
          spreadWidth: z.number(),
          symbolWidths: z.record(z.string(), z.number()).optional(),
          isIndexMode: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');
        const { getEffectiveTier: _getETx } = await import('./middleware/subscriptionEnforcement');
        const { createScanJob, updateScanJobProgress, completeScanJob, failScanJob } = await import('./scanJobManager');
        const _effTier = _getETx(ctx.user);
        const rateLimit = await checkRateLimit(ctx.user.id, _effTier, ctx.user.role);
        if (!rateLimit.allowed) throw new Error(rateLimit.message || 'Rate limit exceeded');
        const credentials = await getApiCredentials(ctx.user.id);
        const isPaperOrFreeTrial = _effTier === 'free_trial' || ctx.user.tradingMode === 'paper';
        const tradierApiKey = credentials?.tradierApiKey || (isPaperOrFreeTrial ? process.env.TRADIER_API_KEY : null);
        if (!tradierApiKey) {
          throw new Error(isPaperOrFreeTrial
            ? 'System Tradier API key not configured. Please contact support.'
            : 'Please configure your Tradier API key in Settings to access live market data.');
        }
        const symbols = input.symbols || [];
        if (symbols.length === 0) return { jobId: 'empty', status: 'done' as const, results: [] };
        // Create job and return immediately
        const job = createScanJob(ctx.user.id, symbols.length);
        const jobId = job.id;
        // Capture all needed values before async background work
        const capturedCtxUser = { ...ctx.user };
        const capturedInput = { ...input };
        const capturedCredentials = credentials;
        // Fire background scan — does NOT block the HTTP response
        setImmediate(async () => {
          try {
            updateScanJobProgress(jobId, { status: 'running' });
            const { createTradierAPI } = await import('./tradier');
            const { scoreBPSOpportunities } = await import('./scoring');
            const { calculateBullPutSpread } = await import('./spread-pricing');
            const api = createTradierAPI(tradierApiKey, false, capturedCtxUser.id);
            // Fetch 14-day historical trend
            const trend14dMap = new Map<string, number>();
            const today2 = new Date();
            const trendStart2 = new Date(today2);
            trendStart2.setDate(trendStart2.getDate() - 16);
            const fmtDate2 = (d: Date) => d.toISOString().split('T')[0];
            const BPS_HIST_ROOT_MAP2: Record<string, string> = { SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX' };
            await Promise.all(symbols.map(async (sym) => {
              try {
                const histSym = BPS_HIST_ROOT_MAP2[sym.toUpperCase()] || sym;
                const history = await api.getHistoricalData(histSym, 'daily', fmtDate2(trendStart2), fmtDate2(today2));
                if (history && history.length >= 2) {
                  const oldest = history[0].close;
                  const newest = history[history.length - 1].close;
                  trend14dMap.set(sym, oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0);
                }
              } catch { /* neutral trend */ }
            }));
            updateScanJobProgress(jobId, { batchCurrent: 0, symbolsDone: 0 });
            // Fetch CSP opportunities (skipTechnicals=true for speed)
            const cspOpportunities = await api.fetchCSPOpportunities(
              symbols,
              capturedInput.minDelta || 0.15,
              capturedInput.maxDelta || 0.35,
              capturedInput.minDte || 7,
              capturedInput.maxDte || 45,
              capturedInput.minVolume || 5,
              capturedInput.minOI || 50,
              true
            );
            updateScanJobProgress(jobId, { symbolsDone: symbols.length, opportunitiesFound: cspOpportunities.length });
            // Pre-fetch unique option chains
            const chainCache2 = new Map<string, any[]>();
            const uniqueChains2 = new Map<string, { symbol: string; expiration: string }>();
            for (const cspOpp of cspOpportunities) {
              const key2 = `${cspOpp.symbol}|${cspOpp.expiration}`;
              if (!uniqueChains2.has(key2)) uniqueChains2.set(key2, { symbol: cspOpp.symbol, expiration: cspOpp.expiration });
            }
            const SPREAD_CHAIN_ROOT_MAP2: Record<string, string> = { SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX' };
            const chainEntries3 = Array.from(uniqueChains2.entries());
            await Promise.allSettled(chainEntries3.map(async ([key2, { symbol, expiration }]) => {
              try {
                const chainRoot2 = SPREAD_CHAIN_ROOT_MAP2[symbol.toUpperCase()] || symbol;
                const options2 = await withRateLimit(() => api.getOptionChain(chainRoot2, expiration, true));
                chainCache2.set(key2, options2);
              } catch { chainCache2.set(key2, []); }
            }));
            // Build spreads
            const symbolPriceMap2 = new Map<string, number>();
            for (const opp of cspOpportunities) {
              if (!symbolPriceMap2.has(opp.symbol)) symbolPriceMap2.set(opp.symbol, opp.currentPrice);
            }
            const SPREAD_WIDTH_ALIAS2: Record<string, string> = { SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX' };
            const getEffectiveSpreadWidth2 = (sym: string): number => {
              const symUpper = sym.toUpperCase();
              if (capturedInput.symbolWidths) {
                if (capturedInput.symbolWidths[symUpper] !== undefined) return capturedInput.symbolWidths[symUpper];
                const alias2 = SPREAD_WIDTH_ALIAS2[symUpper];
                if (alias2 && capturedInput.symbolWidths[alias2] !== undefined) return capturedInput.symbolWidths[alias2];
              }
              const price2 = symbolPriceMap2.get(sym) || 0;
              if (price2 < 500) return capturedInput.spreadWidth;
              return Math.max(capturedInput.spreadWidth, Math.round((price2 * 0.004) / 5) * 5);
            };
            const spreadOpportunities2: any[] = [];
            for (const cspOpp of cspOpportunities) {
              try {
                if (cspOpp.strike >= cspOpp.currentPrice) continue;
                const effectiveWidth2 = getEffectiveSpreadWidth2(cspOpp.symbol);
                const longStrike2 = cspOpp.strike - effectiveWidth2;
                const key2 = `${cspOpp.symbol}|${cspOpp.expiration}`;
                const options2 = chainCache2.get(key2) || [];
                if (options2.length === 0) continue;
                const exactLongPut2 = options2.find(opt => opt.option_type === 'put' && opt.strike === longStrike2);
                const longPut2 = exactLongPut2 || (() => {
                  const puts2 = options2.filter(opt => opt.option_type === 'put' && opt.strike < cspOpp.strike && opt.strike > 0);
                  if (puts2.length === 0) return null;
                  const sorted2 = puts2.sort((a, b) => Math.abs(a.strike - longStrike2) - Math.abs(b.strike - longStrike2));
                  const nearest2 = sorted2[0];
                  const maxDev2 = Math.max(capturedInput.spreadWidth * 10, 200);
                  return Math.abs(nearest2.strike - longStrike2) <= maxDev2 ? nearest2 : null;
                })();
                if (!longPut2 || !longPut2.bid || !longPut2.ask) continue;
                const actualLongStrike2 = longPut2.strike;
                const actualSpreadWidth2 = cspOpp.strike - actualLongStrike2;
                const spreadOpp2 = calculateBullPutSpread(cspOpp, actualSpreadWidth2, { bid: longPut2.bid, ask: longPut2.ask, delta: Math.abs(longPut2.greeks?.delta || 0) });
                const creditToWidthRatio2 = actualSpreadWidth2 > 0 ? spreadOpp2.netCredit / actualSpreadWidth2 : 0;
                if (spreadOpp2.netCredit > 0 && creditToWidthRatio2 <= 0.80) {
                  (spreadOpp2 as any).shortOptionSymbol = cspOpp.optionSymbol;
                  (spreadOpp2 as any).longOptionSymbol = longPut2.symbol;
                  spreadOpportunities2.push(spreadOpp2);
                }
              } catch { continue; }
            }
            // Dedup
            const uniqueSpreads2 = new Map<string, any>();
            for (const spread of spreadOpportunities2) {
              const key2 = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
              if (!uniqueSpreads2.has(key2)) uniqueSpreads2.set(key2, spread);
            }
            const dedupedSpreads2 = Array.from(uniqueSpreads2.values());
            const spreadsWithTrend2 = dedupedSpreads2.map((spread: any) => ({ ...spread, trend14d: trend14dMap.get(spread.symbol) }));
            const scored2 = scoreBPSOpportunities(spreadsWithTrend2, { isIndexMode: capturedInput.isIndexMode ?? false }) as any;
            // Risk badges
            const { calculateBulkRiskAssessments } = await import('./riskAssessment');
            const symbolSet2 = new Set<string>();
            scored2.forEach((opp: any) => symbolSet2.add(opp.symbol));
            const riskAssessments2 = await calculateBulkRiskAssessments(Array.from(symbolSet2), api);
            const scoredWithBadges2 = scored2.map((opp: any) => ({ ...opp, riskBadges: riskAssessments2.get(opp.symbol)?.badges || [] }));
            // TT price enrichment
            if (scoredWithBadges2.length > 0 && capturedCredentials?.tastytradeClientSecret) {
              try {
                const { authenticateTastytrade: authTT2 } = await import('./tastytrade');
                const ttApi2 = await authTT2(capturedCredentials, capturedCtxUser.id).catch(() => null);
                if (ttApi2) {
                  const legSymbols2: string[] = [];
                  for (const opp of scoredWithBadges2) {
                    if (opp.shortOptionSymbol) legSymbols2.push(opp.shortOptionSymbol);
                    if (opp.longOptionSymbol) legSymbols2.push(opp.longOptionSymbol);
                  }
                  const ttQuotes2 = await ttApi2.getOptionQuotesBatch(legSymbols2).catch(() => ({}));
                  for (const opp of scoredWithBadges2) {
                    const sQ2 = (ttQuotes2 as any)[opp.shortOptionSymbol];
                    const lQ2 = (ttQuotes2 as any)[opp.longOptionSymbol];
                    const sBid2 = sQ2 ? (parseFloat(sQ2.bid) || 0) : 0;
                    const sAsk2 = sQ2 ? (parseFloat(sQ2.ask) || 0) : 0;
                    const lBid2 = lQ2 ? (parseFloat(lQ2.bid) || 0) : 0;
                    const lAsk2 = lQ2 ? (parseFloat(lQ2.ask) || 0) : 0;
                    if (sBid2 > 0 || sAsk2 > 0) { opp.bid = sBid2; opp.ask = sAsk2; }
                    if (lBid2 > 0 || lAsk2 > 0) { opp.longBid = lBid2; opp.longAsk = lAsk2; }
                    const ttNetCredit2 = (sBid2 + sAsk2) / 2 - (lBid2 + lAsk2) / 2;
                    if (ttNetCredit2 > 0) { opp.netCredit = ttNetCredit2; opp.premium = ttNetCredit2; }
                  }
                }
              } catch { /* keep Tradier prices */ }
            }
            await incrementScanCount(capturedCtxUser.id, _effTier, capturedCtxUser.role);
            completeScanJob(jobId, scoredWithBadges2);
            console.log(`[Spread startScan] Job ${jobId} completed: ${scoredWithBadges2.length} opportunities`);
          } catch (err: any) {
            failScanJob(jobId, err?.message || 'Scan failed');
            console.error(`[Spread startScan] Job ${jobId} failed:`, err);
          }
        });
        return { jobId, status: 'running' as const };
      }),
    pollScan: protectedProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ ctx, input }) => {
        const { getScanJob } = await import('./scanJobManager');
        const job = getScanJob(input.jobId);
        if (!job) return { status: 'error' as const, error: 'Job not found or expired', progress: null, results: null };
        if (job.userId !== ctx.user.id) throw new Error('Unauthorized');
        return {
          status: job.status,
          progress: job.progress,
          results: job.status === 'done' ? job.results : null,
          error: job.error,
        };
      }),
    // Legacy blocking scan (kept for fallback — will 504 on large symbol lists)
    opportunities: protectedProcedure
      .input(
        z.object({
          symbols: z.array(z.string()).optional(),
          minDelta: z.number().optional(),
          maxDelta: z.number().optional(),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minVolume: z.number().optional(),
          minOI: z.number().optional(),
          spreadWidth: z.number(), // 2, 5, 10 (equity) or 25, 50, 100 (index)
          symbolWidths: z.record(z.string(), z.number()).optional(), // per-symbol overrides e.g. { NDXP: 25, MRUT: 5, SPXW: 5 }
          isIndexMode: z.boolean().optional(), // true when scanning index products (SPXW, NDXP, MRUT)
        })
      )
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { scoreBPSOpportunities } = await import('./scoring');
        const { calculateBullPutSpread } = await import('./spread-pricing');
        const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');
        const { getEffectiveTier: _getETx } = await import('./middleware/subscriptionEnforcement');
        const _effTier = _getETx(ctx.user);

        // Check rate limit (VIP users treated as advanced, bypass free_trial limits)
        const rateLimit = await checkRateLimit(ctx.user.id, _effTier, ctx.user.role);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.message || 'Rate limit exceeded');
        }

        const credentials = await getApiCredentials(ctx.user.id);
        
        // Paper mode and free trial users can use the system Tradier key for market data scanning
        const isPaperOrFreeTrial = _effTier === 'free_trial' || ctx.user.tradingMode === 'paper';
        const tradierApiKey = credentials?.tradierApiKey || (isPaperOrFreeTrial ? process.env.TRADIER_API_KEY : null);
        
        if (!tradierApiKey) {
          if (isPaperOrFreeTrial) {
            throw new Error('System Tradier API key not configured. Please contact support.');
          } else {
            throw new Error('Please configure your Tradier API key in Settings to access live market data.');
          }
        }

        const api = createTradierAPI(tradierApiKey, false, ctx.user.id);
        const symbols = input.symbols || [];
        
        if (symbols.length === 0) {
          return [];
        }

        // Fetch 14-day historical trend for each unique symbol (BPS direction scoring)
        const trend14dMap = new Map<string, number>();
        const today = new Date();
        const trendStart = new Date(today);
        trendStart.setDate(trendStart.getDate() - 16);
        const fmtDate = (d: Date) => d.toISOString().split('T')[0];
        const BPS_HIST_ROOT_MAP: Record<string, string> = {
          SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
        };
        await Promise.all(symbols.map(async (sym) => {
          try {
            const histSym = BPS_HIST_ROOT_MAP[sym.toUpperCase()] || sym;
            const history = await api.getHistoricalData(histSym, 'daily', fmtDate(trendStart), fmtDate(today));
            if (history && history.length >= 2) {
              const oldest = history[0].close;
              const newest = history[history.length - 1].close;
              const pctChange = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
              trend14dMap.set(sym, pctChange);
            }
          } catch {
            // trend14d will be undefined for this symbol — scoring uses neutral credit
          }
        }));

        // Fetch CSP opportunities first (these are the short puts)
        // skipTechnicals=true: RSI/BB are not used in BPS scoring — skip 200-day history calls
        // to avoid overwhelming Tradier with 62 parallel history requests (saves ~60s per scan)
        const cspOpportunities = await api.fetchCSPOpportunities(
          symbols,
          input.minDelta || 0.15,
          input.maxDelta || 0.35,
          input.minDte || 7,
          input.maxDte || 45,
          input.minVolume || 5,
          input.minOI || 50,
          true // skipTechnicals
        );

        // OPTIMIZATION: Group opportunities by symbol+expiration to batch API calls
        // Instead of fetching option chain for each opportunity, fetch once per unique symbol+expiration combo
        const chainCache = new Map<string, any[]>();
        
        // Pre-fetch all unique option chains in parallel
        const uniqueChains = new Map<string, { symbol: string; expiration: string }>();
        for (const cspOpp of cspOpportunities) {
          const key = `${cspOpp.symbol}|${cspOpp.expiration}`;
          if (!uniqueChains.has(key)) {
            uniqueChains.set(key, { symbol: cspOpp.symbol, expiration: cspOpp.expiration });
          }
        }
        
        console.log(`[Spread] Fetching ${uniqueChains.size} unique option chains for ${cspOpportunities.length} opportunities`);
        
        // Tradier option root map: some symbols (SPXW, NDXP, MRUT) are listed under
        // a different root on Tradier's chain endpoint (SPX, NDX, RUT).
        const SPREAD_CHAIN_ROOT_MAP: Record<string, string> = {
          SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
        };
        // Fetch ALL chains fully in parallel — no sequential batching
        const chainEntries2 = Array.from(uniqueChains.entries());
        await Promise.allSettled(
          chainEntries2.map(async ([key, { symbol, expiration }]) => {
            try {
              // Use Tradier-recognised chain root (e.g. SPX for SPXW) for the API call,
              // but cache under the original display symbol key so lookups stay consistent.
              const chainRoot = SPREAD_CHAIN_ROOT_MAP[symbol.toUpperCase()] || symbol;
              const options = await withRateLimit(() => api.getOptionChain(chainRoot, expiration, true));
              chainCache.set(key, options);
              console.log(`[Spread] Cached chain for ${symbol} (root: ${chainRoot}) ${expiration} (${options.length} contracts)`);

            } catch (error) {
              console.error(`[Spread] Failed to fetch chain for ${symbol} ${expiration}:`, error);
              chainCache.set(key, []); // Cache empty array to avoid retry
            }
          })
        );
        
        console.log(`[Spread] Cached ${chainCache.size} option chains, now calculating spreads...`);
        
        // Build a per-symbol effective spread width.
        // For large-priced indexes (NDX ~23000, MRUT ~2500), the user's spreadWidth (e.g. 25pt)
        // is too narrow — strikes are in 100pt increments so the nearest available long put
        // ends up 100-200pt away, inflating collateral. Auto-scale to the nearest 5pt multiple
        // that is at least 0.4% of the underlying price, then take the max with the user input.
        // Examples: NDX $23,000 → max(25, round(23000*0.004/5)*5) = max(25,90) = 90pt → nearest 100pt strike → 100pt spread ✓
        //           SPX $6,400 → max(25, round(6400*0.004/5)*5) = max(25,25) = 25pt ✓
        //           MRUT $2,500 → max(5, round(2500*0.004/5)*5) = max(5,10) = 10pt ✓
        const symbolPriceMapSpread = new Map<string, number>();
        for (const opp of cspOpportunities) {
          if (!symbolPriceMapSpread.has(opp.symbol)) symbolPriceMapSpread.set(opp.symbol, opp.currentPrice);
        }
        // Same alias map as IC scanner above — needed here because this is a separate scope
        const SPREAD_WIDTH_ALIAS: Record<string, string> = {
          SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
        };
        const getEffectiveSpreadWidth = (sym: string): number => {
          const symUpper = sym.toUpperCase();
          if (input.symbolWidths) {
            if (input.symbolWidths[symUpper] !== undefined) return input.symbolWidths[symUpper];
            const alias = SPREAD_WIDTH_ALIAS[symUpper];
            if (alias && input.symbolWidths[alias] !== undefined) return input.symbolWidths[alias];
          }
          const price = symbolPriceMapSpread.get(sym) || 0;
          if (price < 500) return input.spreadWidth; // small-price equities: use user input as-is
          const autoWidth = Math.max(input.spreadWidth, Math.round((price * 0.004) / 5) * 5);
          return autoWidth;
        };
        
        // Now calculate spreads using cached chains
        const spreadOpportunities = [];
        
        for (const cspOpp of cspOpportunities) {
          try {
            // Hard structural filter: short put must be OTM (strike < current price).
            // ITM puts have intrinsic value and would produce an unrealistically high
            // credit-to-width ratio, indicating a deep ITM or stale-priced spread.
            if (cspOpp.strike >= cspOpp.currentPrice) {
              console.log(`[BPS Standalone] Skipping ITM short put ${cspOpp.symbol} strike ${cspOpp.strike} (price=${cspOpp.currentPrice})`);
              continue;
            }
            // Calculate long strike (protective put)
            // Use auto-scaled effective width for large-priced indexes (NDX, MRUT) to avoid
            // landing on a strike 200pt away when only 100pt increments exist.
            const effectiveWidth = getEffectiveSpreadWidth(cspOpp.symbol);
            const longStrike = cspOpp.strike - effectiveWidth;
            
            // Get cached option chain
            const key = `${cspOpp.symbol}|${cspOpp.expiration}`;
            const options = chainCache.get(key) || [];
            
            if (options.length === 0) {
              // Skip if chain fetch failed
              continue;
            }
            
            // Find the long put at our target strike
            // For index options (NDXP, MRUT) strikes may be in 100-point increments,
            // so find the nearest available strike at or below the target longStrike.
            const exactLongPut = options.find(
              opt => opt.option_type === 'put' && opt.strike === longStrike
            );
            // If exact strike not found, find nearest available put strike below target
            const longPut = exactLongPut || (() => {
              const puts = options.filter(opt => opt.option_type === 'put' && opt.strike < cspOpp.strike && opt.strike > 0);
              if (puts.length === 0) return null;
              // Find the put with strike closest to (but not above) longStrike
              const sorted = puts.sort((a, b) => Math.abs(a.strike - longStrike) - Math.abs(b.strike - longStrike));
              const nearest = sorted[0];
              // Only use if within reasonable proximity:
              // For large indices (NDXP ~24000, MRUT ~2500), the nearest strike may be 100pts away.
              // Allow up to 10x spread width OR 200 points, whichever is larger.
              const maxDeviation = Math.max(input.spreadWidth * 10, 200);
              if (Math.abs(nearest.strike - longStrike) <= maxDeviation) return nearest;
              return null;
            })();
            
            if (!longPut || !longPut.bid || !longPut.ask) {
              // Skip if we can't find the long put or it has no quotes
              continue;
            }
            // Use the actual strike found (may differ from target for index options)
            const actualLongStrike = longPut.strike;
            const actualSpreadWidth = cspOpp.strike - actualLongStrike;
            
            // Calculate spread pricing using actual spread width (may differ for index options)
            const spreadOpp = calculateBullPutSpread(
              cspOpp,
              actualSpreadWidth,
              {
                bid: longPut.bid,
                ask: longPut.ask,
                delta: Math.abs(longPut.greeks?.delta || 0),
              }
            );
            
            // Only include if net credit is positive AND structurally sound.
            // Credit-to-width sanity check: reject spreads where net credit > 80% of spread width.
            // A credit exceeding 80% of max profit signals the spread is deep ITM or prices are stale.
            // (A fair OTM credit spread typically collects 15-40% of width.)
            const creditToWidthRatio = actualSpreadWidth > 0 ? spreadOpp.netCredit / actualSpreadWidth : 0;
            if (spreadOpp.netCredit > 0 && creditToWidthRatio <= 0.80) {
              // Attach OCC symbols for TT price enrichment
              (spreadOpp as any).shortOptionSymbol = cspOpp.optionSymbol;
              (spreadOpp as any).longOptionSymbol = longPut.symbol;
              spreadOpportunities.push(spreadOpp);
            } else if (creditToWidthRatio > 0.80) {
              console.log(`[BPS Standalone] Rejecting ${cspOpp.symbol} strike ${cspOpp.strike}: credit/width ${(creditToWidthRatio*100).toFixed(0)}% > 80% (ITM or stale prices)`);
            }
          } catch (error) {
            console.error(`[Spread] Error calculating spread for ${cspOpp.symbol}:`, error);
            // Skip this opportunity and continue
            continue;
          }
        }

        // Deduplicate spread opportunities by unique spread identifier (symbol-shortStrike-longStrike-expiration)
        console.log(`[Spread Dedup] ${spreadOpportunities.length} spreads before deduplication`);
        const uniqueSpreads = new Map<string, any>();
        const spreadDuplicateReport: string[] = [];
        for (const spread of spreadOpportunities) {
          const key = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
          if (!uniqueSpreads.has(key)) {
            uniqueSpreads.set(key, spread);
          } else {
            const existing = uniqueSpreads.get(key)!;
            const detail = `key=${key} shortStrike=${spread.strike} longStrike=${spread.longStrike} exp=${spread.expiration} netCredit=${spread.netCredit} (existing netCredit=${existing.netCredit})`;
            spreadDuplicateReport.push(detail);
            console.warn(`[Spread Dedup] ⚠️  DUPLICATE spread detected: ${detail}`);
          }
        }
        const dedupedSpreads = Array.from(uniqueSpreads.values());
        const dedupedCount = spreadOpportunities.length - dedupedSpreads.length;
        if (dedupedCount > 0) {
          console.warn(`[Spread Dedup] ⚠️  Removed ${dedupedCount} duplicate spread(s) from ${spreadOpportunities.length} raw results.`);
          console.warn(`[Spread Dedup] Root cause hint: same CSP opportunity may be processed multiple times, or two CSP opps have the same strike/expiration but different deltas.`);
        } else {
          console.log(`[Spread Dedup] No duplicates (${dedupedSpreads.length} unique spreads).`);
        }
        
        // Attach 14-day trend data to each spread before scoring
        const spreadsWithTrend = dedupedSpreads.map((spread: any) => ({
          ...spread,
          trend14d: trend14dMap.get(spread.symbol),
        }));

        // Score spread opportunities using BPS-specific scoring logic
        const scored = scoreBPSOpportunities(spreadsWithTrend, { isIndexMode: input.isIndexMode ?? false }) as any;
        console.log(`[Spread Router] Scored ${scored.length} opportunities, preparing to calculate risk badges...`);

        // Calculate risk badges for all opportunities
        const { calculateBulkRiskAssessments } = await import('./riskAssessment');
        console.log('[Spread Router] Imported calculateBulkRiskAssessments successfully');
        const symbolSet = new Set<string>();
        scored.forEach((opp: any) => symbolSet.add(opp.symbol));
        const uniqueSymbols = Array.from(symbolSet);
        const riskAssessments = await calculateBulkRiskAssessments(uniqueSymbols, api);
        
        // Attach risk badges to opportunities
        const scoredWithBadges = scored.map((opp: any) => ({
          ...opp,
          riskBadges: riskAssessments.get(opp.symbol)?.badges || [],
        }));

        // ── ENRICH WITH LIVE TASTYTRADE PRICES (BPS) ─────────────────────────────
        // Tradier = scan/screen only. All order prices MUST come from Tastytrade.
        if (scoredWithBadges.length > 0 && credentials?.tastytradeClientSecret) {
          try {
            const { authenticateTastytrade: authTT_BPS } = await import('./tastytrade');
            const ttApiBPS = await authTT_BPS(credentials, ctx.user.id).catch(() => null);
            if (ttApiBPS) {
              const legSymbols: string[] = [];
              for (const opp of scoredWithBadges) {
                if ((opp as any).shortOptionSymbol) legSymbols.push((opp as any).shortOptionSymbol);
                if ((opp as any).longOptionSymbol) legSymbols.push((opp as any).longOptionSymbol);
              }
              const ttQuotesBPS = await ttApiBPS.getOptionQuotesBatch(legSymbols).catch(() => ({}));
              for (const opp of scoredWithBadges) {
                const sQ = (ttQuotesBPS as any)[(opp as any).shortOptionSymbol];
                const lQ = (ttQuotesBPS as any)[(opp as any).longOptionSymbol];
                const sBid = sQ ? (parseFloat(sQ.bid) || 0) : 0;
                const sAsk = sQ ? (parseFloat(sQ.ask) || 0) : 0;
                const lBid = lQ ? (parseFloat(lQ.bid) || 0) : 0;
                const lAsk = lQ ? (parseFloat(lQ.ask) || 0) : 0;
                if (sBid > 0 || sAsk > 0) {
                  (opp as any).bid = sBid;
                  (opp as any).ask = sAsk;
                }
                if (lBid > 0 || lAsk > 0) {
                  (opp as any).longBid = lBid;
                  (opp as any).longAsk = lAsk;
                }
                // Recalculate net credit from TT prices (mid of short - mid of long)
                const ttShortMid = (sBid + sAsk) / 2;
                const ttLongMid = (lBid + lAsk) / 2;
                const ttNetCredit = ttShortMid - ttLongMid;
                if (ttNetCredit > 0) {
                  (opp as any).netCredit = ttNetCredit;
                  (opp as any).premium = ttNetCredit;
                  console.log(`[BPS TT Price] ${opp.symbol} ${opp.strike}/${(opp as any).longStrike}: Tradier net=$${(opp as any).netCredit?.toFixed(2)}, TT net=$${ttNetCredit.toFixed(2)}`);
                }
              }
            }
          } catch (ttErrBPS: any) {
            console.warn('[BPS TT Price] Enrichment failed, keeping Tradier prices:', ttErrBPS.message);
          }
        }
        // ────────────────────────────────────────────────────────────────────────

        // Increment scan count for Tier 1 users (after successful scan)
        await incrementScanCount(ctx.user.id, _effTier, ctx.user.role);
        return scoredWithBadges;
      }),
  }),
  userPreferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { getUserPreferences } = await import('./db');
      return getUserPreferences(ctx.user.id);
    }),
    setDefaultAccount: protectedProcedure
      .input(z.object({ accountId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { upsertUserPreferences } = await import('./db');
        await upsertUserPreferences(ctx.user.id, {
          defaultTastytradeAccountId: input.accountId,
        });
        return { success: true };
      }),
    setStrategyAdvisorPreferences: protectedProcedure
      .input(z.object({ 
        autoRefresh: z.boolean(),
        refreshInterval: z.number().min(15).max(60), // 15, 30, or 60 minutes
      }))
      .mutation(async ({ ctx, input }) => {
        const { upsertUserPreferences } = await import('./db');
        await upsertUserPreferences(ctx.user.id, {
          strategyAdvisorAutoRefresh: input.autoRefresh,
          strategyAdvisorRefreshInterval: input.refreshInterval,
        });
        return { success: true };
      }),
    setTaxRate: protectedProcedure
      .input(z.object({ taxRate: z.number().min(0).max(50) }))
      .mutation(async ({ ctx, input }) => {
        const { upsertUserPreferences } = await import('./db');
        await upsertUserPreferences(ctx.user.id, {
          taxRate: input.taxRate,
        });
        return { success: true };
      }),
    setMonthlyTarget: protectedProcedure
      .input(z.object({ target: z.number().min(1000).max(10000000) }))
      .mutation(async ({ ctx, input }) => {
        const { upsertUserPreferences } = await import('./db');
        await upsertUserPreferences(ctx.user.id, {
          monthlyIncomeTarget: input.target,
        });
        return { success: true };
      }),
    getMonthlyCollected: protectedProcedure.query(async ({ ctx }) => {
      const { getUserPreferences, getApiCredentials } = await import('./db');
      const prefs = await getUserPreferences(ctx.user.id);
      const target = prefs?.monthlyIncomeTarget ?? 150000;

      // LIVE API — bypasses DB cache, fetches directly from Tastytrade
      try {
        const { authenticateTastytrade } = await import('./tastytrade');
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeRefreshToken) {
          return { collected: 0, target, remaining: target, pct: 0, error: 'Tastytrade credentials not configured.' };
        }
        const tt = await authenticateTastytrade(credentials, ctx.user.id);
        if (!tt) {
          return { collected: 0, target, remaining: target, pct: 0, error: 'Failed to authenticate with Tastytrade.' };
        }

        const accounts = await tt.getAccounts();
        const accountNumbers: string[] = accounts
          .map((acc: any) => acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber)
          .filter(Boolean);

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const endDateStr = now.toISOString().split('T')[0];

        let credits = 0;
        let debits = 0;

        await Promise.all(accountNumbers.map(async (accountNumber: string) => {
          try {
            const rawTxns = await tt.getTransactionHistory(accountNumber, startDateStr, endDateStr);
            for (const txn of rawTxns) {
              if (txn['transaction-type'] !== 'Trade') continue;
              const txnSymbol: string = txn['symbol'] || '';
              const isOptionSymbol = /[A-Z0-9]+\s*\d{6}[CP]\d+/.test(txnSymbol);
              if (!isOptionSymbol) continue;
              const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
              if (netValue === 0) continue;
              const executedAt = txn['executed-at'];
              if (!executedAt || new Date(executedAt) < monthStart) continue;
              const effect = txn['net-value-effect'];
              if (effect === 'Credit') credits += netValue;
              else if (effect === 'Debit') debits += netValue;
            }
          } catch (err: any) {
            console.error(`[getMonthlyCollected] Live fetch failed for account ${accountNumber}:`, err.message);
          }
        }));

        const collected = Math.round((credits - debits) * 100) / 100;
        console.log(`[getMonthlyCollected] Live: credits=$${credits.toFixed(2)}, debits=$${debits.toFixed(2)}, net=$${collected}`);
        return {
          collected,
          target,
          remaining: Math.max(0, target - collected),
          pct: target > 0 ? Math.min(100, (collected / target) * 100) : 0,
        };
      } catch (e) {
        return { collected: 0, target, remaining: target, pct: 0, error: String(e) };
      }
    }),
  }),

  account: router({
    getBalances: protectedProcedure
      .input(z.object({ accountNumber: z.string() }))
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { getTastytradeAPI } = await import('./tastytrade');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
        }

        const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
        
        const balances = await api.getBalances(input.accountNumber);
        // Debug: log the keys returned by the Tastytrade balances API
        if (balances) {
          console.log('[getBalances] Keys returned:', Object.keys(balances).join(', '));
          console.log('[getBalances] derivative-buying-power:', balances['derivative-buying-power']);
          console.log('[getBalances] cash-buying-power:', balances['cash-buying-power']);
          console.log('[getBalances] equity-buying-power:', balances['equity-buying-power']);
          console.log('[getBalances] option-buying-power:', balances['option-buying-power']);
        } else {
          console.log('[getBalances] balances returned null/undefined');
        }
        return balances;
      }),
  }),

  cspFilters: router({
    getPresets: protectedProcedure.query(async ({ ctx }) => {
      const { getCspFilterPresets, seedCspFilterPresets } = await import('./db');
      
      // Ensure presets exist for this user
      await seedCspFilterPresets(ctx.user.id);
      
      return getCspFilterPresets(ctx.user.id);
    }),
    updatePreset: protectedProcedure
      .input(
        z.object({
          presetName: z.enum(['conservative', 'medium', 'aggressive']),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minDelta: z.string().optional(),
          maxDelta: z.string().optional(),
          minOpenInterest: z.number().optional(),
          minVolume: z.number().optional(),
          minRsi: z.number().nullable().optional(),
          maxRsi: z.number().nullable().optional(),
          minIvRank: z.number().nullable().optional(),
          maxIvRank: z.number().nullable().optional(),
          minBbPercent: z.string().nullable().optional(),
          maxBbPercent: z.string().nullable().optional(),
          minScore: z.number().optional(),
          maxStrikePercent: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateCspFilterPreset } = await import('./db');
        const { presetName, ...updates } = input;
        await updateCspFilterPreset(ctx.user.id, presetName, updates);
        return { success: true };
      }),
  }),

  filterPresets: router({
    getByStrategy: protectedProcedure
      .input(z.object({ strategy: z.enum(['csp', 'cc', 'pmcc', 'bps', 'bcs']) }))
      .query(async ({ ctx, input }) => {
        const { getFilterPresetsByStrategy } = await import('./db-filter-presets');
        const { seedCspFilterPresets } = await import('./db');
        const { seedCcFilterPresets, seedPmccFilterPresets, seedBpsFilterPresets, seedBcsFilterPresets } = await import('./db-filter-presets');
        
        // Ensure presets exist for this strategy
        if (input.strategy === 'csp') {
          await seedCspFilterPresets(ctx.user.id);
        } else if (input.strategy === 'cc') {
          await seedCcFilterPresets(ctx.user.id);
        } else if (input.strategy === 'pmcc') {
          await seedPmccFilterPresets(ctx.user.id);
        } else if (input.strategy === 'bps') {
          await seedBpsFilterPresets(ctx.user.id);
        } else if (input.strategy === 'bcs') {
          await seedBcsFilterPresets(ctx.user.id);
        }
        
        return getFilterPresetsByStrategy(ctx.user.id, input.strategy);
      }),
    getRecommendedValues: protectedProcedure
      .input(
        z.object({
          strategy: z.enum(['csp', 'cc', 'pmcc', 'bps', 'bcs']),
          presetName: z.enum(['conservative', 'medium', 'aggressive']),
        })
      )
      .query(async ({ input }) => {
        const { getRecommendedFilterValues } = await import('./db-filter-presets');
        return getRecommendedFilterValues(input.strategy, input.presetName);
      }),
    update: protectedProcedure
      .input(
        z.object({
          strategy: z.enum(['csp', 'cc', 'pmcc', 'bps', 'bcs']),
          presetName: z.enum(['conservative', 'medium', 'aggressive']),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minDelta: z.string().optional(),
          maxDelta: z.string().optional(),
          minOpenInterest: z.number().optional(),
          minVolume: z.number().optional(),
          minRsi: z.number().nullable().optional(),
          maxRsi: z.number().nullable().optional(),
          minIvRank: z.number().nullable().optional(),
          maxIvRank: z.number().nullable().optional(),
          minBbPercent: z.string().nullable().optional(),
          maxBbPercent: z.string().nullable().optional(),
          minScore: z.number().optional(),
          maxStrikePercent: z.union([z.number(), z.string()]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateFilterPreset } = await import('./db-filter-presets');
        const { strategy, presetName, ...updates } = input;
        await updateFilterPreset(ctx.user.id, strategy, presetName, updates);
        return { success: true };
      }),
  }),

  ccFilters: router({
    getPresets: protectedProcedure.query(async ({ ctx }) => {
      const { getFilterPresetsByStrategy, seedCcFilterPresets } = await import('./db-filter-presets');
      
      // Ensure CC presets exist for this user
      await seedCcFilterPresets(ctx.user.id);
      
      return getFilterPresetsByStrategy(ctx.user.id, 'cc');
    }),
    updatePreset: protectedProcedure
      .input(
        z.object({
          presetName: z.enum(['conservative', 'medium', 'aggressive']),
          minDelta: z.number().optional(),
          maxDelta: z.number().optional(),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minOpenInterest: z.number().optional(),
          minVolume: z.number().optional(),
          minWeeklyReturn: z.number().optional(),
          minRsi: z.number().nullable().optional(),
          maxRsi: z.number().nullable().optional(),
          minIvRank: z.number().nullable().optional(),
          maxIvRank: z.number().nullable().optional(),
          minBbPercent: z.string().nullable().optional(),
          maxBbPercent: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateFilterPreset } = await import('./db-filter-presets');
        const { presetName, minDelta, maxDelta, ...updates } = input;
        
        // Convert delta numbers to strings for database
        const deltaUpdates = {
          ...(minDelta !== undefined && { minDelta: minDelta.toString() }),
          ...(maxDelta !== undefined && { maxDelta: maxDelta.toString() }),
        };
        
        await updateFilterPreset(ctx.user.id, 'cc', presetName, { ...updates, ...deltaUpdates });
        return { success: true };
      }),
  }),

  bpsFilters: router({
    getPresets: protectedProcedure.query(async ({ ctx }) => {
      const { getFilterPresetsByStrategy, seedBpsFilterPresets } = await import('./db-filter-presets');
      
      // Ensure BPS presets exist for this user
      await seedBpsFilterPresets(ctx.user.id);
      
      return getFilterPresetsByStrategy(ctx.user.id, 'bps');
    }),
    updatePreset: protectedProcedure
      .input(
        z.object({
          presetName: z.enum(['conservative', 'medium', 'aggressive']),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minDelta: z.string().optional(),
          maxDelta: z.string().optional(),
          minOpenInterest: z.number().optional(),
          minVolume: z.number().optional(),
          minRsi: z.number().nullable().optional(),
          maxRsi: z.number().nullable().optional(),
          minIvRank: z.number().nullable().optional(),
          maxIvRank: z.number().nullable().optional(),
          minBbPercent: z.string().nullable().optional(),
          maxBbPercent: z.string().nullable().optional(),
          minScore: z.number().optional(),
          maxStrikePercent: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateFilterPreset } = await import('./db-filter-presets');
        const { presetName, ...updates } = input;
        await updateFilterPreset(ctx.user.id, 'bps', presetName, updates);
        return { success: true };
      }),
  }),

  bcsFilters: router({
    getPresets: protectedProcedure.query(async ({ ctx }) => {
      const { getFilterPresetsByStrategy, seedBcsFilterPresets } = await import('./db-filter-presets');
      
      // Ensure BCS presets exist for this user
      await seedBcsFilterPresets(ctx.user.id);
      
      return getFilterPresetsByStrategy(ctx.user.id, 'bcs');
    }),
    updatePreset: protectedProcedure
      .input(
        z.object({
          presetName: z.enum(['conservative', 'medium', 'aggressive']),
          minDte: z.number().optional(),
          maxDte: z.number().optional(),
          minDelta: z.string().optional(),
          maxDelta: z.string().optional(),
          minOpenInterest: z.number().optional(),
          minVolume: z.number().optional(),
          minRsi: z.number().nullable().optional(),
          maxRsi: z.number().nullable().optional(),
          minIvRank: z.number().nullable().optional(),
          maxIvRank: z.number().nullable().optional(),
          minBbPercent: z.string().nullable().optional(),
          maxBbPercent: z.string().nullable().optional(),
          minScore: z.number().optional(),
          maxStrikePercent: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateFilterPreset } = await import('./db-filter-presets');
        const { presetName, ...updates } = input;
        await updateFilterPreset(ctx.user.id, 'bcs', presetName, updates);
        return { success: true };
      }),
  }),

  // Covered Calls Dashboard
  cc: ccRouter,

  // Stock Basis & Returns
  stockBasis: router({
    // Get all stock positions with current prices
    getStockPositions: protectedProcedure
      .query(async ({ ctx }) => {
        const { getTastytradeAPI } = await import('./tastytrade');
        const { getApiCredentials, getTastytradeAccounts } = await import('./db');
        const { TRPCError } = await import('@trpc/server');
        
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade OAuth2 credentials not configured. Please add them in Settings.' });
        }

        const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

        const accounts = await getTastytradeAccounts(ctx.user.id);
        if (!accounts || accounts.length === 0) {
          return { positions: [], summary: { totalCostBasis: 0, totalCurrentValue: 0, totalUnrealized: 0, totalCCPremium: 0 } };
        }

        // Use DB cache for stock positions
        const { getLivePositions: getCachedPosStk } = await import('./portfolio-sync');
        const cachedPosStk = await getCachedPosStk(ctx.user.id);
        const allPositions = cachedPosStk
          .filter(p => p['instrument-type'] === 'Equity')
          .map(p => {
            const quantity = typeof p.quantity === 'number' ? p.quantity : parseInt(String(p.quantity || '0'));
            const avgCost = parseFloat(String(p.averageOpenPrice || '0'));
            const currentPrice = parseFloat(String(p.closePrice || '0'));
            const acct = accounts.find(a => a.accountNumber === p['account-number']);
            return {
              symbol: p.symbol,
              quantity,
              avgCost,
              currentPrice,
              costBasis: quantity * avgCost,
              marketValue: quantity * currentPrice,
              unrealizedPL: (quantity * currentPrice) - (quantity * avgCost),
              accountNumber: p['account-number'],
              accountNickname: acct?.nickname || p['account-number'],
            };
          });

        return { positions: allPositions };
      }),

    // Get CC premiums collected per symbol
    getCCPremiums: protectedProcedure
      .input(z.object({ lookbackDays: z.number().default(365) }))
      .query(async ({ ctx, input }) => {
        const { getApiCredentials, getTastytradeAccounts } = await import('./db');
        const { TRPCError } = await import('@trpc/server');
        
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade OAuth2 credentials not configured. Please add them in Settings.' });
        }

        const accounts = await getTastytradeAccounts(ctx.user.id);
        if (!accounts || accounts.length === 0) {
          return { premiums: {} };
        }

        const ccPremiums: Record<string, number> = {};
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - input.lookbackDays);

        // Use DB cache for transaction history
        const { getCachedTransactions: getCachedTxnsCC, cachedTxnToWireFormat: toWireCC } = await import('./portfolio-sync');
        const cachedTxnsCC = await getCachedTxnsCC(ctx.user.id);
        const startMs = startDate.getTime();
        const transactions = cachedTxnsCC
          .filter(t => t.executedAt && new Date(t.executedAt).getTime() >= startMs)
          .map(t => toWireCC(t));

        for (const txn of transactions) {
          const txnType = txn['transaction-type'];
          const txnSubType = txn['transaction-sub-type'];
          const symbol = txn.symbol || '';
          const instrumentType = txn['instrument-type'];
          const value = parseFloat(txn.value || '0');
          // Only process Trade transactions with Sell to Open sub-type
          if (txnType !== 'Trade' || txnSubType !== 'Sell to Open') continue;
          // Process both Equity Options and Index Options (SPX/NDX/RUT)
          if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
          const cleanSymbol = symbol.replace(/\s+/g, '');
          const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
          if (!match) continue;
          const underlying = match[1];
          const optionType = match[3];
          if (optionType === 'C') {
            const premium = Math.abs(value);
            if (premium > 0) ccPremiums[underlying] = (ccPremiums[underlying] || 0) + premium;
          }
        }

        return { premiums: ccPremiums };
      }),

    // Calculate recovery metrics for underwater positions
    getRecoveryMetrics: protectedProcedure
      .query(async ({ ctx }) => {
        const { getTastytradeAPI } = await import('./tastytrade');
        const { getApiCredentials, getTastytradeAccounts } = await import('./db');
        const { TRPCError } = await import('@trpc/server');
        
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade OAuth2 credentials not configured. Please add them in Settings.' });
        }

        const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

        const accounts = await getTastytradeAccounts(ctx.user.id);
        if (!accounts || accounts.length === 0) {
          return {
            totalUnrealizedLoss: 0,
            totalCCPremium: 0,
            overallRecoveryPct: 0,
            netPosition: 0,
            underwaterPositions: [],
            numUnderwater: 0,
          };
        }

        // Use DB cache for positions and transactions
        const { getLivePositions: getCachedPosRec, getCachedTransactions: getCachedTxnsRec, cachedTxnToWireFormat: toWireRec } = await import('./portfolio-sync');
        const cachedPosRec = await getCachedPosRec(ctx.user.id);
        const allPositions = cachedPosRec
          .filter(p => p['instrument-type'] === 'Equity')
          .map(p => {
            const quantity = typeof p.quantity === 'number' ? p.quantity : parseInt(String(p.quantity || '0'));
            const avgCost = parseFloat(String(p.averageOpenPrice || '0'));
            const currentPrice = parseFloat(String(p.closePrice || '0'));
            return { symbol: p.symbol, quantity, avgCost, currentPrice, costBasis: quantity * avgCost, marketValue: quantity * currentPrice, unrealizedPL: (quantity * currentPrice) - (quantity * avgCost) };
          });

        // Get CC premiums from cached transactions
        const ccPremiums: Record<string, number> = {};
        const startDateRec = new Date();
        startDateRec.setDate(startDateRec.getDate() - 365);
        const startMsRec = startDateRec.getTime();
        const cachedTxnsRec = await getCachedTxnsRec(ctx.user.id);
        const txnsRec = cachedTxnsRec
          .filter(t => t.executedAt && new Date(t.executedAt).getTime() >= startMsRec)
          .map(t => toWireRec(t));
        for (const txn of txnsRec) {
          if (txn['transaction-type'] !== 'Trade' || txn['transaction-sub-type'] !== 'Sell to Open') continue;
          if (txn['instrument-type'] !== 'Equity Option') continue;
          const cleanSym = (txn.symbol || '').replace(/\s+/g, '');
          const m = cleanSym.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
          if (!m || m[3] !== 'C') continue;
          const premium = Math.abs(parseFloat(txn.value || '0'));
          if (premium > 0) ccPremiums[m[1]] = (ccPremiums[m[1]] || 0) + premium;
        }

        // Calculate recovery metrics for underwater positions
        const underwaterPositions: any[] = [];
        let totalUnrealizedLoss = 0;
        let totalCCPremium = 0;

        for (const pos of allPositions) {
          if (pos.unrealizedPL < 0) {
            const ccPremium = ccPremiums[pos.symbol] || 0;
            totalCCPremium += ccPremium;
            totalUnrealizedLoss += pos.unrealizedPL;

            const recoveryPct = pos.unrealizedPL !== 0 ? (ccPremium / Math.abs(pos.unrealizedPL)) * 100 : 0;
            const adjustedBasis = pos.avgCost - (ccPremium / pos.quantity);
            const remainingLoss = pos.unrealizedPL + ccPremium;

            underwaterPositions.push({
              symbol: pos.symbol,
              quantity: pos.quantity,
              costBasis: pos.avgCost,
              currentPrice: pos.currentPrice,
              totalCost: pos.costBasis,
              marketValue: pos.marketValue,
              unrealizedLoss: pos.unrealizedPL,
              ccPremium,
              recoveryPct,
              adjustedBasis,
              remainingLoss,
            });
          }
        }

        const overallRecoveryPct = totalUnrealizedLoss !== 0 ? (totalCCPremium / Math.abs(totalUnrealizedLoss)) * 100 : 0;
        const netPosition = totalUnrealizedLoss + totalCCPremium;

        return {
          totalUnrealizedLoss,
          totalCCPremium,
          overallRecoveryPct,
          netPosition,
          underwaterPositions,
          numUnderwater: underwaterPositions.length,
        };
      }),
  }),

  // ─── GTC Close Order Automation ─────────────────────────────────────────────
  gtc: router({
    /**
     * List all GTC orders for the current user (last 50)
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getGtcOrdersForUser } = await import('./gtc-orders');
      return getGtcOrdersForUser(ctx.user.id);
    }),

    /**
     * Submit a GTC close order immediately after a confirmed STO fill.
     * Called from the order confirmation modal after a live fill is detected.
     */
    submit: protectedProcedure
      .input(z.object({
        accountId: z.string(),
        sourceOrderId: z.string(),
        sourceStrategy: z.string(),
        symbol: z.string(),
        expiration: z.string(),
        premiumCollected: z.number(),
        totalPremiumCollected: z.number(),
        profitTargetPct: z.union([z.literal(50), z.literal(75)]),
        legs: z.array(z.object({
          symbol: z.string(),
          action: z.enum(['Buy to Close', 'Sell to Close']),
          quantity: z.number(),
          instrumentType: z.enum(['Equity Option', 'Index Option']), // Note: TT order API only uses 'Equity Option'; 'Index Option' appears in position data only
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createGtcRecord, updateGtcRecord, submitGtcCloseOrder } = await import('./gtc-orders');
        const { getTastytradeAPI } = await import('./tastytrade');
        const { getApiCredentials, loadAccessToken } = await import('./db');

        // Load credentials
        const credentials = await getApiCredentials(ctx.user.id);
        const tokenData = await loadAccessToken(ctx.user.id);
        if (!tokenData?.accessToken) {
          throw new Error('No Tastytrade session. Please log in to Tastytrade first.');
        }

        // Calculate target close price
        const targetClosePrice = input.premiumCollected * (1 - input.profitTargetPct / 100);

        // Create DB record first (status = pending)
        const record = await createGtcRecord({
          userId: ctx.user.id,
          accountId: input.accountId,
          sourceOrderId: input.sourceOrderId,
          sourceStrategy: input.sourceStrategy,
          symbol: input.symbol,
          expiration: input.expiration,
          premiumCollected: input.premiumCollected,
          totalPremiumCollected: input.totalPremiumCollected,
          profitTargetPct: input.profitTargetPct,
        });

        // Submit to Tastytrade
        try {
          const { orderId, status } = await submitGtcCloseOrder(
            tokenData.accessToken,
            input.accountId,
            input.legs,
            targetClosePrice,
            true
          );

          // Update DB record with GTC order ID
          const database = await import('./db').then(m => m.getDb());
          if (database) {
            const { gtcOrders } = await import('../drizzle/schema');
            const { eq } = await import('drizzle-orm');
            await database.update(gtcOrders)
              .set({ gtcOrderId: orderId, status: 'submitted', submittedAt: new Date() })
              .where(eq(gtcOrders.id, record.insertId));
          }

          return {
            success: true,
            gtcOrderId: orderId,
            targetClosePrice: targetClosePrice.toFixed(2),
            profitTargetPct: input.profitTargetPct,
            message: `GTC close order submitted at $${targetClosePrice.toFixed(2)} (${input.profitTargetPct}% profit target)`,
          };
        } catch (error: any) {
          // Mark as failed in DB
          const database = await import('./db').then(m => m.getDb());
          if (database) {
            const { gtcOrders } = await import('../drizzle/schema');
            const { eq } = await import('drizzle-orm');
            await database.update(gtcOrders)
              .set({ status: 'failed', errorMessage: error.message })
              .where(eq(gtcOrders.id, record.insertId));
          }
          throw new Error(`GTC order failed: ${error.message}`);
        }
      }),

    /**
     * Cancel an active GTC order on Tastytrade and mark it cancelled in DB.
     */
    cancel: protectedProcedure
      .input(z.object({
        gtcDbId: z.number(),
        accountId: z.string(),
        gtcOrderId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { cancelGtcOrder } = await import('./gtc-orders');
        const { loadAccessToken } = await import('./db');

        const tokenData = await loadAccessToken(ctx.user.id);
        if (!tokenData?.accessToken) {
          throw new Error('No Tastytrade session.');
        }

        await cancelGtcOrder(tokenData.accessToken, input.accountId, input.gtcOrderId);

        // Update DB
        const database = await import('./db').then(m => m.getDb());
        if (database) {
          const { gtcOrders } = await import('../drizzle/schema');
          const { eq, and } = await import('drizzle-orm');
          await database.update(gtcOrders)
            .set({ status: 'cancelled', cancelledAt: new Date() })
            .where(and(eq(gtcOrders.id, input.gtcDbId), eq(gtcOrders.userId, ctx.user.id)));
        }

        return { success: true };
      }),

    /**
     * Poll the status of a GTC order and sync it to the DB.
     */
    poll: protectedProcedure
      .input(z.object({
        gtcDbId: z.number(),
        accountId: z.string(),
        gtcOrderId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { pollGtcOrderStatus } = await import('./gtc-orders');
        const { loadAccessToken } = await import('./db');

        const tokenData = await loadAccessToken(ctx.user.id);
        if (!tokenData?.accessToken) throw new Error('No Tastytrade session.');

        const { status, filledAt, fillPrice } = await pollGtcOrderStatus(
          tokenData.accessToken,
          input.accountId,
          input.gtcOrderId
        );

        // Map Tastytrade status to our enum
        const dbStatus =
          status === 'Filled' ? 'filled' :
          status === 'Cancelled' ? 'cancelled' :
          status === 'Rejected' ? 'failed' : 'submitted';

        const database = await import('./db').then(m => m.getDb());
        if (database) {
          const { gtcOrders } = await import('../drizzle/schema');
          const { eq, and } = await import('drizzle-orm');

          // Build P&L fields when the order fills
          let pnlFields: Record<string, string> = {};
          if (dbStatus === 'filled') {
            // Fetch the original record to get totalPremiumCollected
            const [record] = await database
              .select()
              .from(gtcOrders)
              .where(and(eq(gtcOrders.id, input.gtcDbId), eq(gtcOrders.userId, ctx.user.id)))
              .limit(1);

            if (record) {
              // Use the actual fill price if available, otherwise fall back to targetClosePrice
              const closePerShare = fillPrice ?? parseFloat(record.targetClosePrice);
              const totalPremium = parseFloat(record.totalPremiumCollected);
              // Determine contract count from totalPremiumCollected / (premiumCollected * 100)
              const premiumPerShare = parseFloat(record.premiumCollected);
              const contracts = premiumPerShare > 0
                ? Math.round(totalPremium / (premiumPerShare * 100))
                : 1;
              const totalClose = closePerShare * 100 * contracts;
              const pnl = totalPremium - totalClose;
              const pnlPct = totalPremium > 0 ? (pnl / totalPremium) * 100 : 0;

              pnlFields = {
                closeCost: closePerShare.toFixed(4),
                totalCloseCost: totalClose.toFixed(2),
                realizedPnl: pnl.toFixed(2),
                realizedPnlPct: pnlPct.toFixed(2),
              };
            }
          }

          await database.update(gtcOrders)
            .set({
              status: dbStatus,
              ...(dbStatus === 'filled' ? { filledAt: filledAt ? new Date(filledAt) : new Date() } : {}),
              ...pnlFields,
            })
            .where(and(eq(gtcOrders.id, input.gtcDbId), eq(gtcOrders.userId, ctx.user.id)));
        }

        return { status: dbStatus, tastyStatus: status };
      }),
  }),
// ─── AI Advisor ───────────────────────────────────────────────────────────
  aiAdvisor: router({
    analyzeOpportunities: protectedProcedure
      .input(z.object({
        opportunities: z.array(z.object({
          score: z.number(),
          symbol: z.string(),
          strategy: z.string(),
          shortStrike: z.number().optional(),
          longStrike: z.number().optional(),
          strike: z.number().optional(),
          expiration: z.string(),
          dte: z.number(),
          netCredit: z.number(),
          capitalRisk: z.number(),
          roc: z.number(),
          weeklyPct: z.number().nullable().optional(),
          breakeven: z.number().nullable().optional(),
          delta: z.number().nullable().optional(),
          openInterest: z.number().nullable().optional(),
          volume: z.number().nullable().optional(),
          ivRank: z.number().nullable().optional(),
          // Order submission fields - passed through to picks
          bid: z.number().nullable().optional(),
          ask: z.number().nullable().optional(),
          currentPrice: z.number().nullable().optional(),
          longBid: z.number().nullable().optional(),
          longAsk: z.number().nullable().optional(),
          capitalAtRisk: z.number().nullable().optional(),
        })).max(50),
        availableBuyingPower: z.number(),
        strategy: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        const { opportunities, availableBuyingPower, strategy } = input;

        const effectiveBP = availableBuyingPower > 0 ? availableBuyingPower : 100000;
        const collateralPerContract = opportunities.length > 0 ? (opportunities[0].capitalRisk || 0) : 0;
        const maxContracts = collateralPerContract > 0 ? Math.max(1, Math.floor((effectiveBP * 0.20) / collateralPerContract)) : 5;

        // Group opportunities by symbol for diversity enforcement
        const symbolGroups: Record<string, { idx: number; opp: typeof opportunities[0] }[]> = {};
        opportunities.forEach((o, i) => {
          if (!symbolGroups[o.symbol]) symbolGroups[o.symbol] = [];
          symbolGroups[o.symbol].push({ idx: i, opp: o });
        });
        const uniqueSymbols = Object.keys(symbolGroups);
        // Per-symbol max contracts based on that symbol's collateral
        const perSymbolMaxContracts = (sym: string) => {
          const symOpps = symbolGroups[sym];
          if (!symOpps || symOpps.length === 0) return maxContracts;
          const col = symOpps[0].opp.capitalRisk || 0;
          return col > 0 ? Math.max(1, Math.floor((effectiveBP * 0.20) / col)) : maxContracts;
        };
        const oppSummary = opportunities.map((o, i) =>
          `${i + 1}. ${o.symbol} | Score:${o.score} | ${o.shortStrike ? `Short:${o.shortStrike}/Long:${o.longStrike}` : `Strike:${o.strike}`} | Exp:${o.expiration} | DTE:${o.dte} | Credit:$${o.netCredit.toFixed(2)} | Collateral:$${o.capitalRisk} | ROC:${o.roc.toFixed(2)}% | Delta:${(o.delta ?? 0).toFixed(3)} | OI:${o.openInterest ?? 0} | Vol:${o.volume ?? 0} | IVRank:${(o.ivRank ?? 0).toFixed(1)}`
        ).join('\n');
        // Per-symbol best hints for the AI prompt
        const symbolBestHints = uniqueSymbols.map(sym => {
          const best = [...(symbolGroups[sym] || [])].sort((a, b) => b.opp.score - a.opp.score)[0];
          return `${sym}: best at index ${best.idx + 1} (Score:${best.opp.score}, ROC:${best.opp.roc.toFixed(2)}%, MaxQty:${perSymbolMaxContracts(sym)})`;
        }).join('; ');
        const bpDisplay = availableBuyingPower > 0 ? `$${availableBuyingPower.toLocaleString()}` : 'not specified (assume $100,000)';
        const numPicks = Math.max(3, uniqueSymbols.length);
        const systemPrompt = `You are an expert options income trader specializing in ${strategy} strategies. You MUST return exactly ${numPicks} picks — at least one pick per unique symbol (${uniqueSymbols.join(', ')}). For each symbol choose the best opportunity balancing: ROC, liquidity (OI>100, Vol>10), delta cushion, DTE sweet spot (7-21 days), and score. Calculate suggestedMaxQty per symbol based on 20% max buying power rule. Available BP: ${bpDisplay}. Per-symbol best candidates: ${symbolBestHints}. Return ONLY valid JSON: {"picks":[{"rank":1,"opportunityIndex":0,"suggestedMaxQty":5,"rationale":"...","riskNote":"..."}]}`;

        const response = await invokeLLM({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here are ${opportunities.length} ${strategy} opportunities across ${uniqueSymbols.length} symbols (${uniqueSymbols.join(', ')}):\n\n${oppSummary}\n\nIMPORTANT: Include at least one pick from EACH symbol: ${uniqueSymbols.join(', ')}. Return exactly ${numPicks} picks. JSON only.` },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'ai_picks',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  picks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        rank: { type: 'integer' },
                        opportunityIndex: { type: 'integer' },
                        suggestedMaxQty: { type: 'integer' },
                        rationale: { type: 'string' },
                        riskNote: { type: 'string' },
                      },
                      required: ['rank', 'opportunityIndex', 'suggestedMaxQty', 'rationale', 'riskNote'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['picks'],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response?.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error('No response from AI advisor');
        const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        const parsed = JSON.parse(content);
        return {
          picks: parsed.picks.map((pick: any) => ({
            ...pick,
            quantity: 1, // Always default to 1; suggestedMaxQty shown as reference
            opportunity: opportunities[pick.opportunityIndex],
          })),
        };
      }),
  }),
});

