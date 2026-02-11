import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from './_core/trpc.js';
import { TRPCError } from '@trpc/server';
import { submitRollOrder, submitCloseOrder } from './tastytrade.js';

export const ordersRouter = router({
  /**
   * Submit a roll order (2-leg: close existing + open new)
   */
  submitRoll: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        closeLeg: z.object({
          action: z.enum(['BTC', 'STC']),
          quantity: z.number(),
          strike: z.number(),
          expiration: z.string(),
          optionType: z.enum(['PUT', 'CALL']),
        }),
        openLeg: z.object({
          action: z.enum(['STO', 'BTO']),
          quantity: z.number(),
          strike: z.number(),
          expiration: z.string(),
          optionType: z.enum(['PUT', 'CALL']),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user is in paper trading mode
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const [user] = await db.select().from((await import('../drizzle/schema.js')).users).where((await import('drizzle-orm')).eq((await import('../drizzle/schema.js')).users.id, ctx.user.id));
      if (user?.tradingMode === 'paper') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Order submission is disabled in Paper Trading mode',
        });
      }
      
      try {
        const result = await submitRollOrder({
          accountNumber: input.accountNumber,
          symbol: input.symbol,
          closeLeg: input.closeLeg,
          openLeg: input.openLeg,
        });

        return {
          success: true,
          orderId: result.orderId,
          message: 'Roll order submitted successfully',
        };
      } catch (error: any) {
        console.error('Failed to submit roll order:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to submit roll order',
        });
      }
    }),

  /**
   * Submit a close order (1-leg: close existing position)
   */
  submitClose: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        closeLeg: z.object({
          action: z.enum(['BTC', 'STC']),
          quantity: z.number(),
          strike: z.number(),
          expiration: z.string(),
          optionType: z.enum(['PUT', 'CALL']),
          price: z.number(),
          optionSymbol: z.string().optional(), // Full OCC option symbol from Tastytrade
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user is in paper trading mode
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const [user] = await db.select().from((await import('../drizzle/schema.js')).users).where((await import('drizzle-orm')).eq((await import('../drizzle/schema.js')).users.id, ctx.user.id));
      if (user?.tradingMode === 'paper') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Order submission is disabled in Paper Trading mode',
        });
      }
      
      try {
        const result = await submitCloseOrder({
          accountNumber: input.accountNumber,
          symbol: input.symbol,
          closeLeg: input.closeLeg,
        });

        return {
          success: true,
          orderId: result.orderId,
          message: 'Close order submitted successfully',
        };
      } catch (error: any) {
        console.error('Failed to submit close order:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to submit close order',
        });
      }
    }),

  /**
   * Poll order status until filled, rejected, or timeout
   */
  pollStatus: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        orderIds: z.array(z.string()),
        maxAttempts: z.number().optional().default(10),
        intervalMs: z.number().optional().default(1000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { pollOrderStatus } = await import('./tastytrade');
      const { getApiCredentials } = await import('./db');

      // Get credentials and login
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tastytrade credentials not configured' });
      }

      const { getTastytradeAPI } = await import('./tastytrade');
      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

      // Poll each order's status
      const results = [];
      for (const orderId of input.orderIds) {
        try {
          const result = await pollOrderStatus(
            api,
            input.accountNumber,
            orderId,
            {
              maxAttempts: input.maxAttempts,
              intervalMs: input.intervalMs,
            }
          );
          results.push({
            orderId,
            status: result.status,
            success: true,
          });
        } catch (error: any) {
          results.push({
            orderId,
            status: 'Unknown',
            success: false,
            error: error.message,
          });
        }
      }

      return results;
    }),
});
