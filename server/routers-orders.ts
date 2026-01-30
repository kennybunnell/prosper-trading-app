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
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
});
