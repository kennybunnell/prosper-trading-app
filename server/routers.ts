import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
    list: protectedProcedure
      .input(z.object({ strategy: z.enum(['csp', 'cc', 'pmcc']) }))
      .query(async ({ ctx, input }) => {
        const { getWatchlist } = await import('./db');
        return getWatchlist(ctx.user.id, input.strategy);
      }),
    add: protectedProcedure
      .input(z.object({ 
        symbol: z.string().min(1).max(10), 
        strategy: z.enum(['csp', 'cc', 'pmcc']),
        company: z.string().optional(),
        type: z.string().optional(),
        sector: z.string().optional(),
        reason: z.string().optional(),
        rank: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { addToWatchlistWithMetadata } = await import('./db');
        await addToWatchlistWithMetadata(ctx.user.id, input);
        return { success: true };
      }),
    importCSV: protectedProcedure
      .input(z.object({
        strategy: z.enum(['csp', 'cc', 'pmcc']),
        items: z.array(z.object({
          symbol: z.string().min(1).max(10),
          company: z.string().optional(),
          type: z.string().optional(),
          sector: z.string().optional(),
          reason: z.string().optional(),
          rank: z.number().optional(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const { importWatchlistFromCSV } = await import('./db');
        const result = await importWatchlistFromCSV(ctx.user.id, input.strategy, input.items);
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        company: z.string().optional(),
        type: z.string().optional(),
        sector: z.string().optional(),
        reason: z.string().optional(),
        rank: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateWatchlistMetadata } = await import('./db');
        await updateWatchlistMetadata(ctx.user.id, input);
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ symbol: z.string(), strategy: z.enum(['csp', 'cc', 'pmcc']) }))
      .mutation(async ({ ctx, input }) => {
        const { removeFromWatchlist } = await import('./db');
        await removeFromWatchlist(ctx.user.id, input.symbol, input.strategy);
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
        if (!credentials?.tradierApiKey) {
          throw new Error('Tradier API key not configured');
        }

        const api = createTradierAPI(credentials.tradierApiKey);
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
    submitOrders: protectedProcedure
      .input(
        z.object({
          orders: z.array(z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
            optionSymbol: z.string(),
          })),
          accountId: z.string(),
          dryRun: z.boolean().optional(),
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

        const results = [];

        for (const order of input.orders) {
          try {
            const orderRequest = {
              accountNumber: input.accountId,
              timeInForce: 'Day' as const,
              orderType: 'Limit' as const,
              price: order.premium.toFixed(2),
              priceEffect: 'Credit' as const,
              legs: [
                {
                  instrumentType: 'Equity Option' as const,
                  symbol: order.optionSymbol,
                  quantity: '1',
                  action: 'Sell to Open' as const,
                },
              ],
            };

            const result = input.dryRun 
              ? await api.dryRunOrder(orderRequest)
              : await api.submitOrder(orderRequest);

            results.push({
              symbol: order.symbol,
              success: true,
              orderId: result.id,
            });
          } catch (error: any) {
            results.push({
              symbol: order.symbol,
              success: false,
              error: error.message,
            });
          }
        }

        return {
          success: results.every(r => r.success),
          results,
        };
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
});

export type AppRouter = typeof appRouter;
