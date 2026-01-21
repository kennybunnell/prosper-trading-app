import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";

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
      .input((raw: unknown) => {
        const { z } = require('zod');
        return z.object({
          tastytradeUsername: z.string().optional(),
          tastytradePassword: z.string().optional(),
          tradierApiKey: z.string().optional(),
        }).parse(raw);
      })
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
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tradierApiKey) {
        throw new Error('Tradier API key not configured');
      }

      const api = createTradierAPI(credentials.tradierApiKey);
      await api.getMarketStatus();
      return { success: true, message: 'Connection successful' };
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

      for (const account of accounts) {
        await upsertTastytradeAccount(ctx.user.id, {
          accountId: account.externalId,
          accountNumber: account.accountNumber,
          accountType: account.accountTypeName,
          nickname: account.nickname,
        });
      }

      return { success: true, count: accounts.length };
    }),
  }),

  csp: router({
    watchlist: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        const { getWatchlist } = await import('./db');
        return getWatchlist(ctx.user.id, 'csp');
      }),
      add: protectedProcedure
        .input((raw: unknown) => {
          const { z } = require('zod');
          return z.object({ symbol: z.string().min(1).max(10) }).parse(raw);
        })
        .mutation(async ({ ctx, input }) => {
          const { addToWatchlist } = await import('./db');
          await addToWatchlist(ctx.user.id, input.symbol.toUpperCase(), 'csp');
          return { success: true };
        }),
      remove: protectedProcedure
        .input((raw: unknown) => {
          const { z } = require('zod');
          return z.object({ symbol: z.string() }).parse(raw);
        })
        .mutation(async ({ ctx, input }) => {
          const { removeFromWatchlist } = await import('./db');
          await removeFromWatchlist(ctx.user.id, input.symbol, 'csp');
          return { success: true };
        }),
    }),
    opportunities: protectedProcedure
      .input((raw: unknown) => {
        const { z } = require('zod');
        return z.object({
          symbols: z.array(z.string()).optional(),
          minScore: z.number().min(0).max(100).optional(),
        }).parse(raw);
      })
      .query(async ({ ctx, input }) => {
        const { getApiCredentials, getWatchlist } = await import('./db');
        const { createTradierAPI } = await import('./tradier');
        const { calculateScore } = await import('./scoring');

        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tradierApiKey) {
          throw new Error('Tradier API key not configured');
        }

        const api = createTradierAPI(credentials.tradierApiKey);
        
        // Get symbols from input or watchlist
        let symbols = input.symbols;
        if (!symbols || symbols.length === 0) {
          const watchlist = await getWatchlist(ctx.user.id, 'csp');
          symbols = watchlist.map((w: any) => w.symbol);
        }

        if (symbols.length === 0) {
          return [];
        }

        const opportunities = [];

        for (const symbol of symbols) {
          try {
            // Get expirations
            const expirations = await api.getExpirations(symbol);
            if (expirations.length === 0) continue;

            // Filter for 30-45 DTE range
            const today = new Date();
            const targetExpirations = expirations.filter(exp => {
              const expDate = new Date(exp);
              const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              return dte >= 25 && dte <= 50;
            }).slice(0, 3); // Take first 3 expirations in range

            // Get technical indicators
            const technicals = await api.getTechnicalIndicators(symbol);

            // Get option chains for each expiration
            for (const expiration of targetExpirations) {
              const chain = await api.getOptionChain(symbol, expiration, true);
              const puts = chain.filter(opt => opt.type === 'put');

              // Calculate DTE
              const expDate = new Date(expiration);
              const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

              // Score each put
              for (const put of puts) {
                if (!put.greeks || put.bid <= 0) continue;

                const score = calculateScore(put, technicals, 'csp', dte);

                // Filter by min score if specified
                if (input.minScore && score.totalScore < input.minScore) continue;

                opportunities.push({
                  symbol,
                  strike: put.strike,
                  expiration,
                  dte,
                  premium: put.bid,
                  delta: put.greeks.delta,
                  gamma: put.greeks.gamma,
                  theta: put.greeks.theta,
                  vega: put.greeks.vega,
                  iv: put.greeks.mid_iv,
                  openInterest: put.open_interest,
                  volume: put.volume,
                  bid: put.bid,
                  ask: put.ask,
                  optionSymbol: put.symbol,
                  primaryScore: score.primaryScore,
                  secondaryScore: score.secondaryScore,
                  totalScore: score.totalScore,
                  breakdown: score.breakdown,
                });
              }
            }
          } catch (error: any) {
            console.error(`Failed to fetch opportunities for ${symbol}:`, error.message);
          }
        }

        // Sort by total score descending
        return opportunities.sort((a, b) => b.totalScore - a.totalScore);
      }),
    submitOrders: protectedProcedure
      .input((raw: unknown) => {
        const { z } = require('zod');
        return z.object({
          orders: z.array(z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
            optionSymbol: z.string(),
          })),
          accountId: z.string(),
          dryRun: z.boolean().optional(),
        }).parse(raw);
      })
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
});

export type AppRouter = typeof appRouter;
