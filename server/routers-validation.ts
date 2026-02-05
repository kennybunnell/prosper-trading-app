/**
 * Validation Router
 * 
 * tRPC procedures for order validation
 */

import { z } from 'zod';
import { publicProcedure, router } from './_core/trpc';
import { validateOrders, generateValidationSummary } from './validation-engine';
import type { OrderToValidate } from '../shared/validation-types';

export const validationRouter = router({
  /**
   * Validate orders before submission
   */
  validateOrders: publicProcedure
    .input(
      z.object({
        orders: z.array(
          z.object({
            id: z.string(),
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            quantity: z.number(),
            limitPrice: z.number(),
            optionType: z.enum(['call', 'put']),
            strategy: z.enum(['cc', 'csp', 'bcs', 'bps', 'pmcc']),
            longStrike: z.number().optional(),
            originalBid: z.number(),
            originalAsk: z.number(),
            originalMid: z.number(),
          })
        ),
        availableBuyingPower: z.number().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const { orders, availableBuyingPower } = input;
      
      // Convert to OrderToValidate format
      const ordersToValidate: OrderToValidate[] = orders.map(order => ({
        id: order.id,
        symbol: order.symbol,
        strike: order.strike,
        expiration: order.expiration,
        quantity: order.quantity,
        limitPrice: order.limitPrice,
        optionType: order.optionType,
        strategy: order.strategy,
        longStrike: order.longStrike,
        originalBid: order.originalBid,
        originalAsk: order.originalAsk,
        originalMid: order.originalMid,
      }));
      
      // Run validation
      const results = await validateOrders(ordersToValidate, availableBuyingPower);
      const summary = generateValidationSummary(results);
      
      return {
        results,
        summary,
      };
    }),
});
