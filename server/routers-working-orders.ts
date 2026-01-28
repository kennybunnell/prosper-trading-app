/**
 * Working Orders tRPC Router
 * Handles live order monitoring, cancellation, and replacement
 */

import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import { getTastytradeAPI } from './tastytrade';
import { 
  calculateSmartFillPrice, 
  calculateMinutesWorking, 
  formatTimeWorking,
  getMarketStatus,
  isSafeToReplaceOrders 
} from './working-orders-utils';

export interface ProcessedWorkingOrder {
  orderId: string;
  accountNumber: string;
  symbol: string;
  underlyingSymbol: string;
  strike: number;
  expiration: string;
  optionType: 'PUT' | 'CALL';
  quantity: number;
  action: string;
  timeInForce: string;
  currentPrice: number;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  suggestedPrice: number;
  strategy: string;
  needsReplacement: boolean;
  minutesWorking: number;
  timeWorkingDisplay: string;
  receivedAt: string;
  replacementCount: number;
  needsReview: boolean; // 5+ replacements
  rawOrder: any; // Full original order from Tastytrade API (includes legs)
}

export const workingOrdersRouter = router({
  /**
   * Auto-cancel and resubmit stuck orders (>2 hours working)
   */
  autoCancelStuckOrders: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      minutesThreshold: z.number().default(120), // 2 hours
    }))
    .mutation(async ({ input, ctx }) => {
      const { accountId, minutesThreshold } = input;
      const userId = ctx.user.id;

      console.log(`[WorkingOrders] Auto-canceling stuck orders (>${minutesThreshold} minutes)`);

      const api = getTastytradeAPI();
      const { getStuckOrders, recordOrderCanceled } = await import('./db');

      // Get stuck orders from database
      const stuckOrders = await getStuckOrders(userId, minutesThreshold);
      
      if (stuckOrders.length === 0) {
        console.log(`[WorkingOrders] No stuck orders found`);
        return {
          canceledCount: 0,
          resubmittedCount: 0,
          results: [],
        };
      }

      console.log(`[WorkingOrders] Found ${stuckOrders.length} stuck orders`);

      const results: Array<{
        orderId: string;
        symbol: string;
        action: string;
        canceled: boolean;
        resubmitted: boolean;
        newOrderId?: string;
        message: string;
      }> = [];

      for (const order of stuckOrders) {
        try {
          // Cancel the stuck order
          try {
            await api.cancelOrder(order.accountId, order.orderId);
            
            // Record cancellation in database
            await recordOrderCanceled(order.orderId, true); // wasAutoCanceled = true

            // Fetch current quote to get ask price
            const quotes = await api.getOptionQuotesBatch([order.symbol]);
            const quote = quotes[order.symbol];

            if (quote && quote.ask) {
              // Resubmit at ask price for immediate fill
              const isBuyOrder = order.action.toLowerCase().includes('buy');
              const priceEffect = isBuyOrder ? 'Debit' : 'Credit';

              try {
                const resubmittedOrder = await api.submitOrder({
                  accountNumber: order.accountId,
                  timeInForce: 'Day',
                  orderType: 'Limit',
                  price: quote.ask.toFixed(2),
                  priceEffect,
                  legs: [{
                    instrumentType: 'Equity Option',
                    symbol: order.symbol,
                    quantity: String(order.quantity),
                    action: order.action as any,
                  }],
                });

                // Record new order submission
                const { recordOrderSubmission } = await import('./db');
                await recordOrderSubmission({
                  userId,
                  accountId: order.accountId,
                  orderId: resubmittedOrder.id,
                  symbol: order.symbol,
                  underlyingSymbol: order.underlyingSymbol,
                  action: order.action,
                  strategy: `Auto-resubmit: Ask price (was stuck ${minutesThreshold}+ min)`,
                  strike: order.strike,
                  expiration: order.expiration,
                  quantity: order.quantity,
                  submittedPrice: quote.ask.toFixed(2),
                  submittedAt: new Date(),
                });

                results.push({
                  orderId: order.orderId,
                  symbol: order.underlyingSymbol,
                  action: order.action,
                  canceled: true,
                  resubmitted: true,
                  newOrderId: resubmittedOrder.id,
                  message: `Canceled and resubmitted at ask price $${quote.ask.toFixed(2)}`,
                });
              } catch (resubmitError: any) {
                results.push({
                  orderId: order.orderId,
                  symbol: order.underlyingSymbol,
                  action: order.action,
                  canceled: true,
                  resubmitted: false,
                  message: `Canceled but resubmit failed: ${resubmitError.message}`,
                });
              }
            } else {
              results.push({
                orderId: order.orderId,
                symbol: order.underlyingSymbol,
                action: order.action,
                canceled: true,
                resubmitted: false,
                message: 'Canceled but no quote available for resubmit',
              });
            }
          } catch (cancelError: any) {
            results.push({
              orderId: order.orderId,
              symbol: order.underlyingSymbol,
              action: order.action,
              canceled: false,
              resubmitted: false,
              message: `Cancel failed: ${cancelError.message}`,
            });
          }
        } catch (error: any) {
          results.push({
            orderId: order.orderId,
            symbol: order.underlyingSymbol,
            action: order.action,
            canceled: false,
            resubmitted: false,
            message: `Error: ${error.message}`,
          });
        }

        // Rate limit buffer
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const canceledCount = results.filter(r => r.canceled).length;
      const resubmittedCount = results.filter(r => r.resubmitted).length;

      console.log(`[WorkingOrders] Auto-cancel complete: ${canceledCount} canceled, ${resubmittedCount} resubmitted`);

      return {
        canceledCount,
        resubmittedCount,
        results,
      };
    }),

  /**
   * Get all working orders with smart price suggestions
   */
  getWorkingOrders: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      aggressiveFillMode: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const { accountId, aggressiveFillMode } = input;

      console.log(`[WorkingOrders] Fetching orders for account: ${accountId}, aggressive: ${aggressiveFillMode}`);

      const api = getTastytradeAPI();

      try {
        // Handle ALL_ACCOUNTS case
        let accountsToFetch: string[] = [];
        if (accountId === 'ALL_ACCOUNTS') {
          const accounts = await api.getAccounts();
          accountsToFetch = accounts.map((acc: any) => acc.account['account-number']);
          console.log(`[WorkingOrders] Fetching from ${accountsToFetch.length} accounts`);
        } else {
          accountsToFetch = [accountId];
        }

        // Fetch orders from all accounts
        const allOrders: any[] = [];
        for (const accNum of accountsToFetch) {
          const orders = await api.getLiveOrders(accNum);
          console.log(`[WorkingOrders] Account ${accNum}: ${orders.length} total orders from API`);
          if (orders.length > 0) {
            console.log(`[WorkingOrders] Sample raw order structure:`, JSON.stringify(orders[0], null, 2));
          }
          
          // Filter to ONLY active/working orders (exclude Filled, Cancelled, Rejected, Expired)
          const activeOrders = orders.filter((order: any) => {
            const status = order.status?.toLowerCase() || '';
            const isActive = !['filled', 'cancelled', 'rejected', 'expired', 'replaced'].includes(status);
            if (!isActive) {
              console.log(`[WorkingOrders] Filtering out order ${order.id}: status=${order.status}`);
            }
            return isActive;
          });
          
          console.log(`[WorkingOrders] Account ${accNum}: ${activeOrders.length} active working orders (filtered from ${orders.length})`);
          allOrders.push(...activeOrders);
        }

        if (allOrders.length === 0) {
          return {
            orders: [],
            summary: {
              totalOrders: 0,
              totalContracts: 0,
              needsReplacement: 0,
              needsReview: 0,
              avgMinutesWorking: 0,
            },
            marketStatus: getMarketStatus(),
            safeToReplace: isSafeToReplaceOrders(),
          };
        }

        // Extract option symbols for quote fetching
        const optionSymbols = allOrders
          .filter(order => order.legs && order.legs.length > 0)
          .map(order => order.legs[0].symbol)
          .filter(Boolean);

        console.log(`[WorkingOrders] Fetching quotes for ${optionSymbols.length} symbols`);

        // Fetch quotes for all symbols
        const quotes = await api.getOptionQuotesBatch(optionSymbols);
        console.log(`[WorkingOrders] Quote data sample:`, JSON.stringify(Object.entries(quotes).slice(0, 2), null, 2));

        // Process orders with smart pricing
        const processedOrders: ProcessedWorkingOrder[] = [];
        let totalMinutesWorking = 0;

        for (const order of allOrders) {
          if (!order.legs || order.legs.length === 0) continue;

          const leg = order.legs[0];
          const symbol = leg.symbol;
          const quote = quotes[symbol] || {};

          // Parse option symbol (e.g., "AAPL  260131C00150000")
          const symbolMatch = symbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
          if (!symbolMatch) continue;

          const underlyingSymbol = symbolMatch[1].trim();
          const expDate = symbolMatch[2]; // YYMMDD
          const optionType = symbolMatch[3] === 'C' ? 'CALL' : 'PUT';
          const strikeRaw = parseInt(symbolMatch[4]);
          const strike = strikeRaw / 1000; // Convert to actual strike price

          // Format expiration date
          const year = 2000 + parseInt(expDate.substring(0, 2));
          const month = expDate.substring(2, 4);
          const day = expDate.substring(4, 6);
          const expiration = `${month}/${day}/${year}`;

          const currentPrice = parseFloat(order.price || '0');
          const bid = quote.bid || 0;
          const ask = quote.ask || 0;
          const mid = (bid + ask) / 2;
          const spread = ask - bid;
          
          if (bid === 0 && ask === 0) {
            console.log(`[WorkingOrders] WARNING: No market data for ${symbol}. Quote:`, JSON.stringify(quote));
          }

          // Calculate time working
          const minutesWorking = calculateMinutesWorking(order['received-at'] || order.receivedAt);
          totalMinutesWorking += minutesWorking;

          // Calculate smart fill price with order action awareness
          const priceSuggestion = calculateSmartFillPrice(
            { bid, ask, mid },
            currentPrice,
            minutesWorking,
            aggressiveFillMode,
            leg.action // Pass order action (e.g., 'Buy to Close', 'Sell to Open')
          );

          // Track replacement count (would need to be stored in DB for persistence)
          const replacementCount = 0; // TODO: Implement replacement tracking in DB
          const needsReview = replacementCount >= 5;

          processedOrders.push({
            orderId: order.id,
            accountNumber: order['account-number'] || order.accountNumber,
            symbol,
            underlyingSymbol,
            strike,
            expiration,
            optionType,
            quantity: parseInt(leg.quantity),
            action: leg.action,
            timeInForce: order['time-in-force'] || order.timeInForce,
            currentPrice,
            bid,
            ask,
            mid,
            spread,
            suggestedPrice: priceSuggestion.suggestedPrice,
            strategy: priceSuggestion.strategy,
            needsReplacement: priceSuggestion.needsReplacement,
            minutesWorking,
            timeWorkingDisplay: formatTimeWorking(minutesWorking),
            receivedAt: order['received-at'] || order.receivedAt,
            replacementCount,
            needsReview,
            rawOrder: order, // Store full original order from Tastytrade API
          });
        }

        // Calculate summary metrics
        const summary = {
          totalOrders: processedOrders.length,
          totalContracts: processedOrders.reduce((sum, o) => sum + o.quantity, 0),
          needsReplacement: processedOrders.filter(o => o.needsReplacement).length,
          needsReview: processedOrders.filter(o => o.needsReview).length,
          avgMinutesWorking: processedOrders.length > 0 
            ? Math.round(totalMinutesWorking / processedOrders.length) 
            : 0,
        };

        console.log(`[WorkingOrders] Processed ${processedOrders.length} orders, ${summary.needsReplacement} need replacement`);

        return {
          orders: processedOrders,
          summary,
          marketStatus: getMarketStatus(),
          safeToReplace: isSafeToReplaceOrders(),
        };
      } catch (error: any) {
        console.error('[WorkingOrders] Error fetching orders:', error);
        throw new Error(`Failed to fetch working orders: ${error.message}`);
      }
    }),

  /**
   * Cancel selected orders
   */
  cancelOrders: protectedProcedure
    .input(z.object({
      orders: z.array(z.object({
        orderId: z.string(),
        accountNumber: z.string(),
        symbol: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const { orders } = input;

      console.log(`[WorkingOrders] Canceling ${orders.length} orders`);

      const api = getTastytradeAPI();
      const results: Array<{ orderId: string; symbol: string; success: boolean; message: string }> = [];

      for (const order of orders) {
        try {
          await api.cancelOrder(order.accountNumber, order.orderId);
          results.push({
            orderId: order.orderId,
            symbol: order.symbol,
            success: true,
            message: 'Canceled successfully',
          });
        } catch (error: any) {
          results.push({
            orderId: order.orderId,
            symbol: order.symbol,
            success: false,
            message: error.message,
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[WorkingOrders] Canceled ${successCount}/${orders.length} orders successfully`);

      return {
        results,
        successCount,
        failedCount: orders.length - successCount,
      };
    }),

  /**
   * Replace orders with suggested prices
   */
  replaceOrders: protectedProcedure
    .input(z.object({
      orders: z.array(z.object({
        orderId: z.string(),
        accountNumber: z.string(),
        symbol: z.string(),
        suggestedPrice: z.number(),
        rawOrder: z.any(), // Full original order object from Tastytrade API
      })),
    }))
    .mutation(async ({ input }) => {
      const { orders } = input;

      console.log(`[WorkingOrders] Replacing ${orders.length} orders`);

      const api = getTastytradeAPI();
      const results: Array<{ 
        orderId: string; 
        symbol: string; 
        oldPrice: number; 
        newPrice: number; 
        success: boolean; 
        message: string;
        newOrderId?: string;
      }> = [];

      for (const order of orders) {
        try {
          const result = await api.cancelReplaceOrder(
            order.accountNumber,
            order.orderId,
            order.suggestedPrice,
            order.rawOrder
          );

          results.push({
            orderId: order.orderId,
            symbol: order.symbol,
            oldPrice: parseFloat(order.rawOrder.price || '0'),
            newPrice: order.suggestedPrice,
            success: result.success,
            message: result.message,
            newOrderId: result.orderId,
          });
        } catch (error: any) {
          results.push({
            orderId: order.orderId,
            symbol: order.symbol,
            oldPrice: parseFloat(order.rawOrder.price || '0'),
            newPrice: order.suggestedPrice,
            success: false,
            message: error.message,
          });
        }

        // Rate limit buffer
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[WorkingOrders] Replaced ${successCount}/${orders.length} orders successfully`);

      return {
        results,
        successCount,
        failedCount: orders.length - successCount,
      };
    }),

  /**
   * Get fill rate analytics
   */
  getFillRateAnalytics: protectedProcedure
    .input(z.object({
      daysBack: z.number().default(30),
    }))
    .query(async ({ input, ctx }) => {
      const { daysBack } = input;
      const userId = ctx.user.id;

      console.log(`[WorkingOrders] Fetching fill rate analytics for last ${daysBack} days`);

      const { getFillRateAnalytics } = await import('./db');
      const analytics = await getFillRateAnalytics(userId, daysBack);

      if (!analytics) {
        return {
          totalOrders: 0,
          filledWithin5Min: 0,
          filledWithin15Min: 0,
          filledWithin30Min: 0,
          fillRate5Min: 0,
          fillRate15Min: 0,
          fillRate30Min: 0,
          avgFillTime: 0,
          byStrategy: {},
          bySymbol: {},
        };
      }

      return analytics;
    }),
});
