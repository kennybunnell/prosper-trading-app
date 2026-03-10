import { COOKIE_NAME } from "@shared/const";
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
import { positionAnalyzerRouter } from './routers-position-analyzer';
import { safeguardsRouter } from './routers-safeguards';

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
    const { getTastytradeAPI } = await import('./tastytrade');
    const { getApiCredentials, getTastytradeAccounts } = await import('./db');
    
    const credentials = await getApiCredentials(ctx.user.id);
    if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
      throw new Error('Tastytrade OAuth2 credentials not found. Please configure them in Settings.');
    }
    
    const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
    
    const accounts = await getTastytradeAccounts(ctx.user.id);
    if (!accounts || accounts.length === 0) {
      return {
        thisWeek: { premium: 0, positions: 0 },
        thisMonth: { premium: 0, positions: 0 },
        nextMonth: { premium: 0, positions: 0 },
        totalOpen: { premium: 0, positions: 0 },
      };
    }
    
    const accountNumbers = accounts.map((acc) => acc.accountNumber);

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

    for (const accountNumber of accountNumbers) {
      const positions = await api.getPositions(accountNumber);
      if (!positions) continue;

      for (const pos of positions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType !== 'Equity Option') continue;

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
    const { getTastytradeAPI } = await import('./tastytrade');
    const { getApiCredentials, getTastytradeAccounts } = await import('./db');
    
    const credentials = await getApiCredentials(ctx.user.id);
    if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
      throw new Error('Tastytrade OAuth2 credentials not found. Please configure them in Settings.');
    }
    
    const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
    
    const accounts = await getTastytradeAccounts(ctx.user.id);
    if (!accounts || accounts.length === 0) {
      return {
        daily: 0,
        weekly: 0,
        monthly: 0,
        positionCount: 0,
      };
    }
    
    const accountNumbers = accounts.map((acc) => acc.accountNumber);

    let totalTheta = 0;
    let positionCount = 0;

    for (const accountNumber of accountNumbers) {
      const positions = await api.getPositions(accountNumber);
      if (!positions) continue;

      for (const pos of positions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType !== 'Equity Option') continue;

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
    const { getTastytradeAPI } = await import('./tastytrade');
    const { getApiCredentials, getTastytradeAccounts } = await import('./db');
    
    const credentials = await getApiCredentials(ctx.user.id);
    if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
      throw new Error('Tastytrade OAuth2 credentials not found. Please configure them in Settings.');
    }
    
    const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
    
    const accounts = await getTastytradeAccounts(ctx.user.id);
    if (!accounts || accounts.length === 0) {
      return {
        totalCredits: 0,
        totalDebits: 0,
        netPremium: 0,
        avgMonthlyPremium: 0,
        monthsAnalyzed: 0,
        winRate: 0,
        monthlyBreakdown: [],
      };
    }
    
    const accountNumbers = accounts.map((acc) => acc.accountNumber);

    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);

    const monthlyPremiums: Record<string, number> = {};
    let totalCredits = 0;
    let totalDebits = 0;

    for (const accountNumber of accountNumbers) {
      const transactions = await api.getTransactionHistory(
        accountNumber,
        sixMonthsAgo.toISOString().split('T')[0],
        now.toISOString().split('T')[0]
      );

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
  positionAnalyzer: positionAnalyzerRouter,
  safeguards: safeguardsRouter,
  rolls: rollsRouter,
  rollRecommendations: rollRecommendationsRouter,
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
        year: z.number().optional(), // Optional year filter (e.g., 2025, 2026). If not provided, shows last 6 months
      }).optional())
      .query(async ({ ctx, input }) => {
        const { getTastytradeAPI } = await import('./tastytrade');
        const { getApiCredentials } = await import('./db');
        
        try {
        // Get Tastytrade credentials
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
          return { monthlyData: [], error: 'Tastytrade OAuth2 credentials not configured. Please add them in Settings.' };
        }
        
        // Initialize API and login
        const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
        
        // Get all accounts
        const accounts = await api.getAccounts();
        if (!accounts || accounts.length === 0) {
          return { monthlyData: [], error: 'No accounts found' };
        }
        
        console.log(`[Dashboard] Aggregating premium data across ${accounts.length} account(s):`);
        accounts.forEach((acc, idx) => {
          console.log(`  ${idx + 1}. ${acc.account['account-number']} (${acc.account.nickname || 'No nickname'})`);
        });
        
        // Calculate date range based on year filter
        const now = new Date();
        const selectedYear = input?.year;
        
        let startDate: Date;
        let endDate: Date;
        
        if (selectedYear) {
          // Filter by specific year (Jan 1 - Dec 31)
          startDate = new Date(selectedYear, 0, 1); // Jan 1
          endDate = new Date(selectedYear, 11, 31); // Dec 31
        } else {
          // Default: last 6 months
          const startMonth = now.getMonth() - 5;
          const startYear = now.getFullYear() + Math.floor(startMonth / 12);
          const adjustedStartMonth = ((startMonth % 12) + 12) % 12;
          startDate = new Date(startYear, adjustedStartMonth, 1);
          endDate = now;
        }
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        // Aggregate transactions from all accounts
        const monthlyData: Record<string, { credits: number; debits: number }> = {};
        const failedAccounts: string[] = [];
        
        for (const account of accounts) {
          const accountNumber = account.account['account-number'];
          const accountName = account.account.nickname || accountNumber;
          
          try {
            const transactions = await api.getTransactionHistory(
              accountNumber,
              startDateStr,
              endDateStr
            );
            
            // Track this account's contribution separately for debugging
            const accountMonthlyData: Record<string, { credits: number; debits: number }> = {};
          
          // Log first few transactions to understand data structure
          if (transactions.length > 0) {
            console.log('[Dashboard] Sample transactions:', JSON.stringify(transactions.slice(0, 3), null, 2));
          }
          
          // Process each transaction individually
          // Each leg of a multi-leg order has its own cash impact and should be counted separately
          // The CSV export shows each leg as a separate transaction with its own net value
          for (const txn of transactions) {
            const txnType = txn['transaction-type'];
            // Only count Trade transactions (actual trades, not money movements or transfers)
            if (txnType !== 'Trade') continue;
            
            // Skip stock (equity) transactions — these are capital events (assignments,
            // reconciliations, liquidations, harvest exits), NOT premium income/expense.
            // An option symbol always has a date+C/P+strike suffix after the ticker.
            // A plain stock ticker (e.g. "ADBE", "CVX", "TSM") has no such suffix.
            const txnSymbol: string = txn['symbol'] || '';
            const isOptionSymbol = /[A-Z0-9]+\s*\d{6}[CP]\d+/.test(txnSymbol);
            if (!isOptionSymbol) {
              console.log(`[Dashboard] Skipping stock transaction: ${txnSymbol} (${txn['description']?.substring(0, 50)})`);
              continue;
            }
            
            const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
            const netValueEffect = txn['net-value-effect'];
            const executedAt = txn['executed-at'];
            
            if (!executedAt || netValue === 0 || !netValueEffect) continue;
            
            // Parse date and create month key
            const txnDate = new Date(executedAt);
            const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
            
            if (!monthlyData[monthKey]) {
              monthlyData[monthKey] = { credits: 0, debits: 0 };
            }
            if (!accountMonthlyData[monthKey]) {
              accountMonthlyData[monthKey] = { credits: 0, debits: 0 };
            }
            
            // Use net-value-effect to determine if this is income or expense
            // Credit = money received (selling options, assignments, etc.)
            // Debit = money paid (buying to close, buying options, etc.)
            if (netValueEffect === 'Credit') {
              monthlyData[monthKey].credits += netValue;
              accountMonthlyData[monthKey].credits += netValue;
            } else if (netValueEffect === 'Debit') {
              monthlyData[monthKey].debits += netValue;
              accountMonthlyData[monthKey].debits += netValue;
            }
          }
          
          // Log this account's contribution after processing all transactions
          console.log(`[Dashboard] Account ${accountName} (${accountNumber}) contribution:`);
          for (const [month, data] of Object.entries(accountMonthlyData)) {
            if (data.credits > 0 || data.debits > 0) {
              const net = data.credits - data.debits;
              console.log(`  ${month}: Credits=$${data.credits.toFixed(2)}, Debits=$${data.debits.toFixed(2)}, Net=$${net.toFixed(2)}`);
            }
          }
            
          } catch (error: any) {
            console.error(`[Dashboard] Failed to fetch transactions for account ${accountNumber}:`, error.message);
            failedAccounts.push(accountNumber);
          }
        }
        
        // Generate month list based on filter
        const months: string[] = [];
        
        if (selectedYear) {
          // Generate all 12 months for the selected year
          for (let month = 0; month < 12; month++) {
            const monthKey = `${selectedYear}-${String(month + 1).padStart(2, '0')}`;
            months.push(monthKey);
          }
        } else {
          // Generate last 6 months
          for (let i = 5; i >= 0; i--) {
            const m = now.getMonth() - i;
            const y = now.getFullYear() + Math.floor(m / 12);
            const adjustedM = ((m % 12) + 12) % 12;
            const monthKey = `${y}-${String(adjustedM + 1).padStart(2, '0')}`;
            months.push(monthKey);
          }
        }
        
        // Build result with cumulative calculation
        let cumulative = 0;
        const result = months.map(month => {
          const data = monthlyData[month] || { credits: 0, debits: 0 };
          const netPremium = data.credits - data.debits;
          cumulative += netPremium;
          
          // Log detailed breakdown for debugging
          if (data.credits > 0 || data.debits > 0) {
            console.log(`[Dashboard] ${month}: Credits=$${data.credits.toFixed(2)}, Debits=$${data.debits.toFixed(2)}, Net=$${netPremium.toFixed(2)}`);
          }
          
          return {
            month,
            netPremium: Math.round(netPremium * 100) / 100,
            cumulative: Math.round(cumulative * 100) / 100,
          };
        });
        
        console.log('[Dashboard] Monthly premium data:', result);
        return { monthlyData: result };
      } catch (error: any) {
        console.error('[Dashboard] Error fetching monthly premium data:', error);
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
        const { getTastytradeAPI } = await import('./tastytrade');
        const { getApiCredentials } = await import('./db');

        try {
          const credentials = await getApiCredentials(ctx.user.id);
          if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
            return { events: [], error: 'Tastytrade credentials not configured.' };
          }

          const { authenticateTastytrade } = await import('./tastytrade');
          const api = await authenticateTastytrade(credentials, ctx.user.id);
          const accounts = await api.getAccounts();
          if (!accounts || accounts.length === 0) return { events: [], error: 'No accounts found' };

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

          const startDateStr = startDate.toISOString().split('T')[0];
          const endDateStr = endDate.toISOString().split('T')[0];

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

          for (const account of accounts) {
            const accountNumber = account.account['account-number'];
            const accountName = account.account.nickname || accountNumber;

            try {
              const transactions = await api.getTransactionHistory(accountNumber, startDateStr, endDateStr);

              for (const txn of transactions) {
                if (txn['transaction-type'] !== 'Trade') continue;

                const txnSymbol: string = txn['symbol'] || '';
                const isOptionSymbol = /[A-Z0-9]+\s*\d{6}[CP]\d+/.test(txnSymbol);
                if (isOptionSymbol) continue; // Skip options — those go in premium scorecard
                if (!txnSymbol) continue;

                const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
                if (netValue === 0) continue;

                const executedAt = txn['executed-at'];
                if (!executedAt) continue;

                const description: string = txn['description'] || '';
                const action: string = txn['action'] || '';
                const quantity = Math.abs(parseFloat(txn['quantity'] || '0'));
                const price = quantity > 0 ? netValue / quantity : 0;

                // Classify event type
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
                  accountNumber,
                  accountName,
                  eventType,
                });
              }
            } catch (err: any) {
              console.error(`[CapitalEvents] Failed for account ${accountNumber}:`, err.message);
            }
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
     * Lightweight action badge counts for the Home page tile grid.
     * Only uses fast DB queries — no Tastytrade API calls.
     */
    getActionBadges: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (!db) return { liquidationFlags: 0, gtcPending: 0 };

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

        return {
          liquidationFlags: Number(flagRow?.value ?? 0),
          gtcPending: Number(gtcRow?.value ?? 0),
        };
      } catch (e) {
        console.error('[ActionBadges] Error:', e);
        return { liquidationFlags: 0, gtcPending: 0 };
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
          tastytradeClientSecret: z.string().optional(),
          tastytradeRefreshToken: z.string().optional(),
          tradierApiKey: z.string().optional(),
          tradierAccountId: z.string().optional(),
          defaultTastytradeAccountId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        console.log('[Settings] saveCredentials called with input:', {
          hasClientSecret: !!input.tastytradeClientSecret,
          clientSecretLength: input.tastytradeClientSecret?.length || 0,
          hasRefreshToken: !!input.tastytradeRefreshToken,
          refreshTokenLength: input.tastytradeRefreshToken?.length || 0,
          refreshTokenStart: input.tastytradeRefreshToken?.substring(0, 50) || 'none',
        });
        const { upsertApiCredentials } = await import('./db');
        await upsertApiCredentials(ctx.user.id, input);
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
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      return { success: true, message: 'Connection successful' };
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
      
      // Get a fresh API instance and request new token
      const api = getTastytradeAPI();
      api.setUserId(ctx.user.id);
      
      // Call getAccessToken directly - this will refresh and save to database
      const token = await api.getAccessToken(
        credentials.tastytradeRefreshToken,
        credentials.tastytradeClientSecret
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
      const api = createTradierAPI(credentials.tradierApiKey);
      
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
      
      const api = createTradierAPI(credentials.tradierApiKey);
      
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
      const { getTastytradeAPI } = await import('./tastytrade');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const accounts = await api.getAccounts();
      console.log('[Account Sync] Retrieved accounts from Tastytrade:', JSON.stringify(accounts, null, 2));

      const liveAccountNumbers: string[] = [];

      for (const item of accounts) {
        console.log('[Account Sync] Processing account:', JSON.stringify(item, null, 2));
        
        // Tastytrade API returns nested structure with kebab-case field names
        const account = item.account;
        const accountNumber = account['account-number'];
        const accountType = account['account-type-name'];
        const nickname = account['nickname'];
        
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
      const removed = await deleteRemovedTastytradeAccounts(ctx.user.id, liveAccountNumbers);
      if (removed > 0) {
        console.log(`[Account Sync] Removed ${removed} account(s) no longer in Tastytrade`);
      }

      return { success: true, count: accounts.length, removed };
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

        // Check rate limit for Tier 1 users (owner/admin bypass automatically)
        const rateLimit = await checkRateLimit(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.message || 'Rate limit exceeded');
        }

        const credentials = await getApiCredentials(ctx.user.id);
        
        // Determine if user can use system API key (only free trial users)
        const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
        const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
        
        if (!tradierApiKey) {
          if (isFreeTrialUser) {
            throw new Error('System Tradier API key not configured. Please contact support.');
          } else {
            throw new Error('Please configure your Tradier API key in Settings to access live market data.');
          }
        }

        const api = createTradierAPI(tradierApiKey);
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

        // Increment scan count for Tier 1 users (after successful scan)
        await incrementScanCount(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);

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
          const midpoint = (order.bid + order.ask) / 2;
          
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
            premium: midpoint * 100, // Premium per contract
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
            const dryRunInstrumentType = 'Equity Option'; // Tastytrade only accepts 'Equity Option' for all options including index options (SPX/SPXW)
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
              
              // For spreads and Iron Condors, fetch fresh quotes to get current market prices
              let freshNetCredit = order.premium; // Default to cached value
              
              if (order.isIronCondor && order.putShortLeg && order.putLongLeg && order.callShortLeg && order.callLongLeg) {
                try {
                  // Fetch fresh quotes for all 4 legs
                  const quotes = await api.getOptionQuotesBatch([
                    order.putShortLeg.optionSymbol,
                    order.putLongLeg.optionSymbol,
                    order.callShortLeg.optionSymbol,
                    order.callLongLeg.optionSymbol,
                  ]);
                  
                  const putShortQuote = quotes[order.putShortLeg.optionSymbol];
                  const putLongQuote = quotes[order.putLongLeg.optionSymbol];
                  const callShortQuote = quotes[order.callShortLeg.optionSymbol];
                  const callLongQuote = quotes[order.callLongLeg.optionSymbol];
                  
                  if (putShortQuote && putLongQuote && callShortQuote && callLongQuote &&
                      putShortQuote.bid > 0 && putLongQuote.ask > 0 &&
                      callShortQuote.bid > 0 && callLongQuote.ask > 0) {
                    // Calculate fresh net credit for Iron Condor:
                    // (Put Short Bid - Put Long Ask) + (Call Short Bid - Call Long Ask)
                    const putSpreadCredit = putShortQuote.bid - putLongQuote.ask;
                    const callSpreadCredit = callShortQuote.bid - callLongQuote.ask;
                    freshNetCredit = putSpreadCredit + callSpreadCredit;
                    console.log('[Iron Condor Debug] Fresh quotes:', {
                      putShortBid: putShortQuote.bid,
                      putLongAsk: putLongQuote.ask,
                      putSpreadCredit,
                      callShortBid: callShortQuote.bid,
                      callLongAsk: callLongQuote.ask,
                      callSpreadCredit,
                      freshNetCredit,
                      cachedPremium: order.premium,
                      difference: freshNetCredit - order.premium,
                    });
                  } else {
                    console.warn('[Iron Condor Debug] Invalid quotes, using cached premium:', {
                      putShortQuote,
                      putLongQuote,
                      callShortQuote,
                      callLongQuote,
                    });
                  }
                } catch (error) {
                  console.error('[Iron Condor Debug] Failed to fetch fresh quotes, using cached premium:', error);
                }
              } else if (order.isSpread && order.shortLeg && order.longLeg) {
                try {
                  // Fetch fresh quotes for both legs
                  const quotes = await api.getOptionQuotesBatch([
                    order.shortLeg.optionSymbol,
                    order.longLeg.optionSymbol,
                  ]);
                  
                  const shortQuote = quotes[order.shortLeg.optionSymbol];
                  const longQuote = quotes[order.longLeg.optionSymbol];
                  
                  if (shortQuote && longQuote && shortQuote.bid > 0 && longQuote.ask > 0) {
                    // Calculate fresh net credit: bid (what we receive) - ask (what we pay)
                    freshNetCredit = shortQuote.bid - longQuote.ask;
                    console.log('[BPS Debug] Fresh quotes:', {
                      shortBid: shortQuote.bid,
                      longAsk: longQuote.ask,
                      freshNetCredit,
                      cachedPremium: order.premium,
                      difference: freshNetCredit - order.premium,
                    });
                  } else {
                    console.warn('[BPS Debug] Invalid quotes, using cached premium:', {
                      shortQuote,
                      longQuote,
                    });
                  }
                } catch (error) {
                  console.error('[BPS Debug] Failed to fetch fresh quotes, using cached premium:', error);
                }
              }
              
              // Build legs based on order type
              // Tastytrade API only accepts 'Equity Option' for all options including index options (SPX/SPXW/NDX/NDXP)
              // 'Index Option' is only returned by the positions API, NOT accepted in order submission
              const legInstrumentType = 'Equity Option' as const;
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
              // - Single-leg (CSP/CC): use order.premium exactly as adjusted by the user in the modal
              // - Spreads/IC: use freshNetCredit (market price at submission time) with a 5% buffer
              const { snapToTick } = await import('../shared/orderUtils');
              let rawLimitPrice: number;
              if (order.isSpread || order.isIronCondor) {
                const buffer = Math.max(freshNetCredit * 0.05, 0.05);
                rawLimitPrice = Math.max(freshNetCredit - buffer, 0.01);
              } else {
                // Use the user's adjusted price from the modal — already snapped to tick on the frontend
                rawLimitPrice = Math.max(order.premium, 0.01);
              }
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

              // Build GTC legs (mirror of STO legs: Sell→Buy to Close, Buy→Sell to Close)
              const gtcLegs = legs.map(leg => ({
                symbol: leg.symbol,
                action: (leg.action === 'Sell to Open' ? 'Buy to Close' : 'Sell to Close') as 'Buy to Close' | 'Sell to Close',
                quantity: Number(leg.quantity),
                instrumentType: 'Equity Option' as const, // Tastytrade only accepts 'Equity Option' in order submission
              }));

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
              
              return {
                symbol: order.symbol,
                success: false,
                error: detailedError,
              };
            }
          });

          // Wait for batch to complete
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
        })
      )
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { scoreOpportunities } = await import('./scoring');
        const { calculateBullPutSpread, calculateBearCallSpread } = await import('./spread-pricing');
        const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');

        // Check rate limit for Tier 1 users (owner/admin bypass automatically)
        const rateLimit = await checkRateLimit(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.message || 'Rate limit exceeded');
        }

        const credentials = await getApiCredentials(ctx.user.id);
        
        // Determine if user can use system API key (only free trial users)
        const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
        const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
        
        if (!tradierApiKey) {
          if (isFreeTrialUser) {
            throw new Error('System Tradier API key not configured. Please contact support.');
          } else {
            throw new Error('Please configure your Tradier API key in Settings to access live market data.');
          }
        }

        const api = createTradierAPI(tradierApiKey);
        const symbols = input.symbols || [];
        
        if (symbols.length === 0) {
          return [];
        }

        console.log(`[Iron Condor] Scanning ${symbols.length} symbols for Iron Condor opportunities...`);

        // Fetch CSP opportunities (these will be the put side short strikes)
        const cspOpportunities = await api.fetchCSPOpportunities(
          symbols,
          input.minDelta || 0.15,
          input.maxDelta || 0.35,
          input.minDte || 7,
          input.maxDte || 45,
          input.minVolume || 5,
          input.minOI || 50
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
        
        // Fetch all chains in parallel (with concurrency limit)
        const CONCURRENT_CHAINS = 5;
        const chainEntries = Array.from(uniqueChains.entries());
        
        for (let i = 0; i < chainEntries.length; i += CONCURRENT_CHAINS) {
          const batch = chainEntries.slice(i, i + CONCURRENT_CHAINS);
          const batchPromises = batch.map(async ([key, { symbol, expiration }]) => {
            try {
              const options = await api.getOptionChain(symbol, expiration, true);
              chainCache.set(key, options);
              console.log(`[Iron Condor] Cached chain for ${symbol} ${expiration} (${options.length} contracts)`);
            } catch (error) {
              console.error(`[Iron Condor] Failed to fetch chain for ${symbol} ${expiration}:`, error);
              chainCache.set(key, []); // Cache empty array to avoid retry
            }
          });
          await Promise.all(batchPromises);
        }
        
        console.log(`[Iron Condor] Cached ${chainCache.size} option chains, now calculating spreads...`);
        
        // Build a per-symbol effective spread width.
        // A 5-point spread on SPX ($6,740) yields near-zero premium — auto-scale for indexes.
        // Rule: effective width = max(user input, round(underlyingPrice * 0.004 / 5) * 5)
        // This gives ~25 pts for SPX, ~100 pts for NDX, ~10 pts for MRUT.
        const symbolPriceMap = new Map<string, number>();
        for (const opp of cspOpportunities) {
          if (!symbolPriceMap.has(opp.symbol)) symbolPriceMap.set(opp.symbol, opp.currentPrice);
        }
        const getEffectiveWidth = (sym: string): number => {
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
            
            if (spreadOpp.netCredit > 0) {
              bullPutSpreads.set(key, spreadOpp);
            } else {
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
            
            if (spreadOpp.netCredit > 0) {
              bearCallSpreads.set(key, spreadOpp);
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
          
          // For Iron Condors, collateral = max(put spread width, call spread width) × 100
          // This is because you only need to cover the wider spread
          const totalCollateral = Math.max(bps.spreadWidth, bcs.spreadWidth) * 100;
          
          // ROC = (total net credit × 100) / total collateral × 100
          const combinedROC = totalCollateral > 0 ? ((totalNetCredit * 100) / totalCollateral) * 100 : 0;

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

        // Increment scan count for Tier 1 users (after successful scan)
        await incrementScanCount(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);

        return scoredWithBadges;
      }),
  }),

  // Bull Put Spreads (Phase 2: Backend Pricing)
  spread: router({
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
          isIndexMode: z.boolean().optional(), // true when scanning index products (SPXW, NDXP, MRUT)
        })
      )
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { scoreBPSOpportunities } = await import('./scoring');
        const { calculateBullPutSpread } = await import('./spread-pricing');
        const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');

        // Check rate limit for Tier 1 users (owner/admin bypass automatically)
        const rateLimit = await checkRateLimit(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.message || 'Rate limit exceeded');
        }

        const credentials = await getApiCredentials(ctx.user.id);
        
        // Determine if user can use system API key (only free trial users)
        const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
        const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
        
        if (!tradierApiKey) {
          if (isFreeTrialUser) {
            throw new Error('System Tradier API key not configured. Please contact support.');
          } else {
            throw new Error('Please configure your Tradier API key in Settings to access live market data.');
          }
        }

        const api = createTradierAPI(tradierApiKey);
        const symbols = input.symbols || [];
        
        if (symbols.length === 0) {
          return [];
        }

        // Fetch CSP opportunities first (these are the short puts)
        const cspOpportunities = await api.fetchCSPOpportunities(
          symbols,
          input.minDelta || 0.15,
          input.maxDelta || 0.35,
          input.minDte || 7,
          input.maxDte || 45,
          input.minVolume || 5,
          input.minOI || 50
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
        
        // Fetch all chains in parallel (with concurrency limit)
        const CONCURRENT_CHAINS = 5;
        const chainEntries = Array.from(uniqueChains.entries());
        
        for (let i = 0; i < chainEntries.length; i += CONCURRENT_CHAINS) {
          const batch = chainEntries.slice(i, i + CONCURRENT_CHAINS);
          const batchPromises = batch.map(async ([key, { symbol, expiration }]) => {
            try {
              const options = await api.getOptionChain(symbol, expiration, true);
              chainCache.set(key, options);
              console.log(`[Spread] Cached chain for ${symbol} ${expiration} (${options.length} contracts)`);
            } catch (error) {
              console.error(`[Spread] Failed to fetch chain for ${symbol} ${expiration}:`, error);
              chainCache.set(key, []); // Cache empty array to avoid retry
            }
          });
          await Promise.all(batchPromises);
        }
        
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
        const getEffectiveSpreadWidth = (sym: string): number => {
          const price = symbolPriceMapSpread.get(sym) || 0;
          if (price < 500) return input.spreadWidth; // small-price equities: use user input as-is
          const autoWidth = Math.max(input.spreadWidth, Math.round((price * 0.004) / 5) * 5);
          return autoWidth;
        };
        
        // Now calculate spreads using cached chains
        const spreadOpportunities = [];
        
        for (const cspOpp of cspOpportunities) {
          try {
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
            
            // Only include if net credit is positive
            if (spreadOpp.netCredit > 0) {
              spreadOpportunities.push(spreadOpp);
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
        for (const spread of spreadOpportunities) {
          const key = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
          if (!uniqueSpreads.has(key)) {
            uniqueSpreads.set(key, spread);
          } else {
            console.log(`[Spread Dedup] Duplicate found: ${key}`);
          }
        }
        const dedupedSpreads = Array.from(uniqueSpreads.values());
        const dedupedCount = spreadOpportunities.length - dedupedSpreads.length;
        console.log(`[Spread Dedup] ${dedupedSpreads.length} spreads after deduplication (removed ${dedupedCount})`);
        
        // Score spread opportunities using BPS-specific scoring logic
        const scored = scoreBPSOpportunities(dedupedSpreads, { isIndexMode: input.isIndexMode ?? false }) as any;
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

        // Increment scan count for Tier 1 users (after successful scan)
        await incrementScanCount(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);

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

        const allPositions: any[] = [];

        for (const account of accounts) {
          const positions = await api.getPositions(account.accountNumber);
          
          for (const pos of positions) {
            if (pos['instrument-type'] === 'Equity') {
              const symbol = pos.symbol;
              const quantity = typeof pos.quantity === 'number' ? pos.quantity : parseInt(String(pos.quantity || '0'));
              const avgCost = parseFloat(pos['average-open-price'] || '0');
              const currentPrice = parseFloat(pos['close-price'] || '0');
              
              allPositions.push({
                symbol,
                quantity,
                avgCost,
                currentPrice,
                costBasis: quantity * avgCost,
                marketValue: quantity * currentPrice,
                unrealizedPL: (quantity * currentPrice) - (quantity * avgCost),
                accountNumber: account.accountNumber,
                accountNickname: account.nickname || account.accountNumber,
              });
            }
          }
        }

        return { positions: allPositions };
      }),

    // Get CC premiums collected per symbol
    getCCPremiums: protectedProcedure
      .input(z.object({ lookbackDays: z.number().default(365) }))
      .query(async ({ ctx, input }) => {
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
          return { premiums: {} };
        }

        const ccPremiums: Record<string, number> = {};
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - input.lookbackDays);

        for (const account of accounts) {
          const transactions = await api.getTransactionHistory(
            account.accountNumber,
            startDate.toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
          );

          for (const txn of transactions) {
            const txnType = txn['transaction-type'];
            const txnSubType = txn['transaction-sub-type'];
            const symbol = txn.symbol || '';
            const instrumentType = txn['instrument-type'];
            const value = parseFloat(txn.value || '0');

            // Only process Trade transactions with Sell to Open sub-type
            if (txnType !== 'Trade' || txnSubType !== 'Sell to Open') continue;

            // Only process Equity Options
            if (instrumentType !== 'Equity Option') continue;

            // Parse option symbol to get underlying and option type
            // Format: SYMBOL YYMMDD C/P STRIKE (e.g., AAPL 260117C00150000)
            const cleanSymbol = symbol.replace(/\s+/g, '');
            const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
            if (!match) continue;

            const underlying = match[1];
            const optionType = match[3]; // 'C' for CALL, 'P' for PUT

            // Only track CALL options (covered calls)
            if (optionType === 'C') {
              // Premium is the credit received (positive value)
              const premium = Math.abs(value);
              if (premium > 0) {
                ccPremiums[underlying] = (ccPremiums[underlying] || 0) + premium;
              }
            }
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

        // Get stock positions
        const allPositions: any[] = [];
        for (const account of accounts) {
          const positions = await api.getPositions(account.accountNumber);
          
          for (const pos of positions) {
            if (pos['instrument-type'] === 'Equity') {
              const symbol = pos.symbol;
              const quantity = typeof pos.quantity === 'number' ? pos.quantity : parseInt(String(pos.quantity || '0'));
              const avgCost = parseFloat(pos['average-open-price'] || '0');
              const currentPrice = parseFloat(pos['close-price'] || '0');
              
              allPositions.push({
                symbol,
                quantity,
                avgCost,
                currentPrice,
                costBasis: quantity * avgCost,
                marketValue: quantity * currentPrice,
                unrealizedPL: (quantity * currentPrice) - (quantity * avgCost),
              });
            }
          }
        }

        // Get CC premiums using the same logic as getCCPremiums
        const ccPremiums: Record<string, number> = {};
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 365);

        for (const account of accounts) {
          const transactions = await api.getTransactionHistory(
            account.accountNumber,
            startDate.toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
          );

          for (const txn of transactions) {
            const txnType = txn['transaction-type'];
            const txnSubType = txn['transaction-sub-type'];
            const symbol = txn.symbol || '';
            const instrumentType = txn['instrument-type'];
            const value = parseFloat(txn.value || '0');

            // Only process Trade transactions with Sell to Open sub-type
            if (txnType !== 'Trade' || txnSubType !== 'Sell to Open') continue;

            // Only process Equity Options
            if (instrumentType !== 'Equity Option') continue;

            // Parse option symbol to get underlying and option type
            const cleanSymbol = symbol.replace(/\s+/g, '');
            const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
            if (!match) continue;

            const underlying = match[1];
            const optionType = match[3]; // 'C' for CALL, 'P' for PUT

            // Only track CALL options (covered calls)
            if (optionType === 'C') {
              const premium = Math.abs(value);
              if (premium > 0) {
                ccPremiums[underlying] = (ccPremiums[underlying] || 0) + premium;
              }
            }
          }
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
          instrumentType: z.enum(['Equity Option']), // Tastytrade only accepts 'Equity Option' in order submission
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
        const systemPrompt = `You are an expert options income trader specializing in ${strategy} strategies. You MUST return exactly ${numPicks} picks — at least one pick per unique symbol (${uniqueSymbols.join(', ')}). For each symbol choose the best opportunity balancing: ROC, liquidity (OI>100, Vol>10), delta cushion, DTE sweet spot (7-21 days), and score. Recommend quantity per symbol based on 20% max buying power. Available BP: ${bpDisplay}. Per-symbol best candidates: ${symbolBestHints}. Return ONLY valid JSON: {"picks":[{"rank":1,"opportunityIndex":0,"quantity":1,"rationale":"...","riskNote":"..."}]}`;

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
                        quantity: { type: 'integer' },
                        rationale: { type: 'string' },
                        riskNote: { type: 'string' },
                      },
                      required: ['rank', 'opportunityIndex', 'quantity', 'rationale', 'riskNote'],
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
            opportunity: opportunities[pick.opportunityIndex],
          })),
        };
      }),
  }),
});

