import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
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
    if (!credentials || !credentials.tastytradeUsername || !credentials.tastytradePassword) {
      throw new Error('Tastytrade credentials not found');
    }
    
    const api = getTastytradeAPI();
    await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
    
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
    if (!credentials || !credentials.tastytradeUsername || !credentials.tastytradePassword) {
      throw new Error('Tastytrade credentials not found');
    }
    
    const api = getTastytradeAPI();
    await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
    
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
    if (!credentials || !credentials.tastytradeUsername || !credentials.tastytradePassword) {
      throw new Error('Tastytrade credentials not found');
    }
    
    const api = getTastytradeAPI();
    await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
    
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
  demo: demoRouter,
  paperTrading: paperTradingRouter,
  pmcc: pmccRouter,
  performance: performanceRouter,
  workingOrders: workingOrdersRouter,
  projections: projectionsRouter,
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
    getMonthlyPremiumData: protectedProcedure.query(async ({ ctx }) => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const { getApiCredentials } = await import('./db');
      
      try {
        // Get Tastytrade credentials
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials || !credentials.tastytradeUsername || !credentials.tastytradePassword) {
          return { monthlyData: [], error: 'Tastytrade credentials not configured' };
        }
        
        // Initialize API and login
        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
        
        // Get all accounts
        const accounts = await api.getAccounts();
        if (!accounts || accounts.length === 0) {
          return { monthlyData: [], error: 'No accounts found' };
        }
        
        // Calculate date range (last 6 months)
        const now = new Date();
        const startMonth = now.getMonth() - 5; // 6 months including current
        const startYear = now.getFullYear() + Math.floor(startMonth / 12);
        const adjustedStartMonth = ((startMonth % 12) + 12) % 12;
        const startDate = new Date(startYear, adjustedStartMonth, 1);
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = now.toISOString().split('T')[0];
        
        // Aggregate transactions from all accounts
        const monthlyData: Record<string, { credits: number; debits: number }> = {};
        
        for (const account of accounts) {
          const accountNumber = account.account['account-number'];
          const transactions = await api.getTransactionHistory(
            accountNumber,
            startDateStr,
            endDateStr
          );
          
          // Process each transaction
          for (const txn of transactions) {
            const txnType = txn['transaction-type'];
            if (!['Trade', 'Receive Deliver'].includes(txnType)) continue;
            
            const action = txn.action;
            const value = Math.abs(parseFloat(txn.value || '0'));
            const executedAt = txn['executed-at'];
            
            if (!executedAt || value === 0) continue;
            
            // Parse date and create month key
            const txnDate = new Date(executedAt);
            const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
            
            if (!monthlyData[monthKey]) {
              monthlyData[monthKey] = { credits: 0, debits: 0 };
            }
            
            // Categorize by action (value is already in dollars, no need to multiply)
            // STO = credit received, BTC = debit paid to close
            if (action === 'Sell to Open') {
              monthlyData[monthKey].credits += value;
            } else if (action === 'Buy to Close') {
              monthlyData[monthKey].debits += value;
            }
          }
        }
        
        // Generate last 6 months list
        const months: string[] = [];
        for (let i = 5; i >= 0; i--) {
          const m = now.getMonth() - i;
          const y = now.getFullYear() + Math.floor(m / 12);
          const adjustedM = ((m % 12) + 12) % 12;
          const monthKey = `${y}-${String(adjustedM + 1).padStart(2, '0')}`;
          months.push(monthKey);
        }
        
        // Build result with cumulative calculation
        let cumulative = 0;
        const result = months.map(month => {
          const data = monthlyData[month] || { credits: 0, debits: 0 };
          const netPremium = data.credits - data.debits;
          cumulative += netPremium;
          
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
  }),
  auth: router({
    me: publicProcedure.query(opts => {
      console.log('[auth.me] Returning user:', {
        email: opts.ctx.user?.email,
        subscriptionTier: opts.ctx.user?.subscriptionTier,
        role: opts.ctx.user?.role
      });
      return opts.ctx.user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  settings: router({
    getCredentials: protectedProcedure.query(async ({ ctx }) => {
      const { getApiCredentials } = await import('./db');
      return getApiCredentials(ctx.user.id);
    }),
    saveCredentials: protectedProcedure
      .input(
        z.object({
          tastytradeUsername: z.string().optional(),
          tastytradePassword: z.string().optional(),
          tradierApiKey: z.string().optional(),
          tradierAccountId: z.string().optional(),
          defaultTastytradeAccountId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { upsertApiCredentials } = await import('./db');
        await upsertApiCredentials(ctx.user.id, input);
        return { success: true };
      }),
    testTastytradeConnection: protectedProcedure.mutation(async ({ ctx }) => {
      const { getApiCredentials } = await import('./db');
      const { getTastytradeAPI } = await import('./tastytrade');
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
      return { success: true, message: 'Connection successful' };
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
      const { getApiCredentials } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      
      const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
      const tradierConfigured = !!credentials?.tradierApiKey;
      
      return {
        tastytrade: {
          configured: tastytradeConfigured,
          status: tastytradeConfigured ? 'connected' : 'disconnected',
        },
        tradier: {
          configured: tradierConfigured,
          status: tradierConfigured ? 'connected' : 'disconnected',
        },
      };
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
  }),

  accounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getTastytradeAccounts } = await import('./db');
      return getTastytradeAccounts(ctx.user.id);
    }),
    sync: protectedProcedure.mutation(async ({ ctx }) => {
      const { getApiCredentials, upsertTastytradeAccount } = await import('./db');
      const { getTastytradeAPI } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
      const accounts = await api.getAccounts();

      console.log('[Account Sync] Retrieved accounts from Tastytrade:', JSON.stringify(accounts, null, 2));

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
      }

      return { success: true, count: accounts.length };
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
      }))
      .mutation(async ({ ctx, input }) => {
        const { addToWatchlistWithMetadata } = await import('./db');
        await addToWatchlistWithMetadata(ctx.user.id, input);
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

        return scored;
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
            // Spread-specific fields
            isSpread: z.boolean().optional(),
            spreadType: z.enum(['bull_put', 'bear_call']).optional(),
            longStrike: z.number().optional(),
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
        if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
          throw new Error('Tastytrade credentials not configured');
        }

        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

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
        const availableBuyingPower = Number(balances['derivative-buying-power'] || 0);

        // Check market hours (simplified - just check if it's a weekday during market hours)
        const now = new Date();
        const day = now.getUTCDay();
        const hour = now.getUTCHours();
        const isMarketOpen = day >= 1 && day <= 5 && hour >= 14 && hour < 21; // Approximate EST market hours in UTC

        // Validate each order
        const validatedOrders = input.orders.map(order => {
          // For spreads, use capital at risk; for CSP, use full collateral
          const collateral = order.isSpread && order.capitalAtRisk 
            ? order.capitalAtRisk 
            : order.strike * 100;
          
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
            // Pass through spread details
            isSpread: order.isSpread,
            spreadType: order.spreadType,
            longStrike: order.longStrike,
            spreadWidth: order.spreadWidth,
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
          const results = input.orders.map(order => ({
            symbol: order.symbol,
            success: true,
            orderId: 'DRY_RUN_' + Math.random().toString(36).substr(2, 9),
            message: `Dry run validation passed for ${order.symbol} ${order.strike}P @ $${order.premium}`,
          }));
          
          return {
            success: true,
            results,
          };
        }

        // Live mode - proceed with actual API calls
        const { getApiCredentials } = await import('./db');
        const { getTastytradeAPI } = await import('./tastytrade');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
          throw new Error('Tastytrade credentials not configured');
        }

        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

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
              // Build legs based on order type
              const legs = order.isSpread && order.shortLeg && order.longLeg
              ? [
                    // Bull Put Spread: Leg 1 - Sell to Open (short put)
                    {
                      instrumentType: 'Equity Option' as const,
                      symbol: order.shortLeg.optionSymbol,
                      quantity: '1',
                      action: order.shortLeg.action,
                    },
                    // Bull Put Spread: Leg 2 - Buy to Open (long put)
                    {
                      instrumentType: 'Equity Option' as const,
                      symbol: order.longLeg.optionSymbol,
                      quantity: '1',
                      action: order.longLeg.action,
                    },
                  ]
                : [
                    // Regular CSP: Single leg
                    {
                      instrumentType: 'Equity Option' as const,
                      symbol: order.optionSymbol!,
                      quantity: '1',
                      action: 'Sell to Open' as const,
                    },
                  ];
              
              const orderRequest = {
                accountNumber: input.accountId,
                timeInForce: 'Day' as const,
                orderType: 'Limit' as const,
                price: order.premium.toFixed(2),
                priceEffect: 'Credit' as const,
                legs,
              };

              // LIVE MODE ONLY - no dry run parameter
              const result = await api.submitOrder(orderRequest);

              return {
                symbol: order.symbol,
                success: true,
                orderId: result.id,
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
              return {
                symbol: order.symbol,
                success: false,
                error: error.message || 'Unknown error',
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
          spreadWidth: z.number(), // 2, 5, or 10
        })
      )
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { scoreOpportunities } = await import('./scoring');
        const { calculateBullPutSpread } = await import('./spread-pricing');

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
        
        // Now calculate spreads using cached chains
        const spreadOpportunities = [];
        
        for (const cspOpp of cspOpportunities) {
          try {
            // Calculate long strike (protective put)
            const longStrike = cspOpp.strike - input.spreadWidth;
            
            // Get cached option chain
            const key = `${cspOpp.symbol}|${cspOpp.expiration}`;
            const options = chainCache.get(key) || [];
            
            if (options.length === 0) {
              // Skip if chain fetch failed
              continue;
            }
            
            // Find the long put at our target strike
            const longPut = options.find(
              opt => opt.option_type === 'put' && opt.strike === longStrike
            );
            
            if (!longPut || !longPut.bid || !longPut.ask) {
              // Skip if we can't find the long put or it has no quotes
              continue;
            }
            
            // Calculate spread pricing
            const spreadOpp = calculateBullPutSpread(
              cspOpp,
              input.spreadWidth,
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

        // Score spread opportunities (reuse CSP scoring logic)
        const scored = scoreOpportunities(spreadOpportunities);

        return scored;
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
  }),

  account: router({
    getBalances: protectedProcedure
      .input(z.object({ accountNumber: z.string() }))
      .query(async ({ ctx, input }) => {
        const { getApiCredentials } = await import('./db');
        const { getTastytradeAPI } = await import('./tastytrade');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
          throw new Error('Tastytrade credentials not configured');
        }

        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
        
        const balances = await api.getBalances(input.accountNumber);
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
        if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade credentials not configured' });
        }

        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

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
        if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade credentials not configured' });
        }

        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

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
        if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade credentials not configured' });
        }

        const api = getTastytradeAPI();
        await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

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
});

