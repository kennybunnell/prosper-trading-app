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
  priceEffect: string; // 'Debit' or 'Credit' from Tastytrade API
  // Spread-specific fields
  isSpread?: boolean;
  longStrike?: number;
  spreadType?: 'bull_put' | 'bear_call' | 'iron_condor';
  // Per-leg detail for multi-leg expansion in the UI
  spreadLegs?: Array<{
    symbol: string;
    action: string;       // 'Buy to Close' | 'Sell to Close' | 'Buy to Open' | 'Sell to Open'
    strike: number;
    optionType: 'PUT' | 'CALL';
    bid: number;
    ask: number;
    mid: number;
  }>;
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

        // Extract option symbols for quote fetching — collect ALL legs for spread orders
        const optionSymbols: string[] = [];
        for (const order of allOrders) {
          if (!order.legs || order.legs.length === 0) continue;
          for (const leg of order.legs) {
            if (leg.symbol && !optionSymbols.includes(leg.symbol)) {
              optionSymbols.push(leg.symbol);
            }
          }
        }

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
          let strike = strikeRaw / 1000; // Convert to actual strike price (let allows reassignment for spreads)

          // Format expiration date
          const year = 2000 + parseInt(expDate.substring(0, 2));
          const month = expDate.substring(2, 4);
          const day = expDate.substring(4, 6);
          const expiration = `${month}/${day}/${year}`;

          const currentPrice = parseFloat(order.price || '0');
          const priceEffect = order['price-effect'] || order.priceEffect || '';

          // Calculate time working
          const minutesWorking = calculateMinutesWorking(order['received-at'] || order.receivedAt);
          totalMinutesWorking += minutesWorking;

          // ── Step 1: Detect if this is a spread order (2 or 4 legs) ─────────────
          let isSpread = false;
          let longStrike: number | undefined;
          let spreadType: 'bull_put' | 'bear_call' | 'iron_condor' | undefined;
          let spreadLegs: ProcessedWorkingOrder['spreadLegs'] = undefined;

          // Helper: parse a leg symbol into components
          const parseLeg = (legSymbol: string) => {
            const m = legSymbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
            if (!m) return null;
            return {
              symbol: legSymbol,
              optionType: (m[3] === 'C' ? 'CALL' : 'PUT') as 'CALL' | 'PUT',
              strike: parseInt(m[4]) / 1000,
            };
          };

          if (order.legs.length === 2) {
            const leg2 = order.legs[1];
            const leg2Match = leg2.symbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
            if (leg2Match) {
              const leg2OptionType = leg2Match[3];
              const leg2Strike = parseInt(leg2Match[4]) / 1000;
              // Both legs same option type → vertical spread
              if (leg2OptionType === symbolMatch[3]) {
                isSpread = true;
                if (optionType === 'PUT') {
                  const higherStrike = Math.max(strike, leg2Strike);
                  const lowerStrike = Math.min(strike, leg2Strike);
                  strike = higherStrike;
                  longStrike = lowerStrike;
                  spreadType = 'bull_put';
                } else if (optionType === 'CALL') {
                  const higherStrike = Math.max(strike, leg2Strike);
                  const lowerStrike = Math.min(strike, leg2Strike);
                  strike = lowerStrike;
                  longStrike = higherStrike;
                  spreadType = 'bear_call';
                }
              }
            }
          } else if (order.legs.length === 4) {
            // Iron Condor: 2 puts + 2 calls
            const parsed = order.legs.map((l: any) => ({
              ...parseLeg(l.symbol),
              action: l.action,
              rawSymbol: l.symbol,
            })).filter((l: any) => l.optionType);

            const puts = parsed.filter((l: any) => l.optionType === 'PUT');
            const calls = parsed.filter((l: any) => l.optionType === 'CALL');

            if (puts.length === 2 && calls.length === 2) {
              isSpread = true;
              spreadType = 'iron_condor';
              // For IC display: show short put strike as primary
              const shortPut = puts.find((l: any) => l.action?.includes('Sell')) || puts[0];
              const shortCall = calls.find((l: any) => l.action?.includes('Sell')) || calls[0];
              strike = shortPut?.strike ?? strike;
              longStrike = shortCall?.strike;
            }
          }

          // Build per-leg detail array for all spread types
          if (isSpread) {
            spreadLegs = order.legs.map((l: any) => {
              const parsed = parseLeg(l.symbol);
              if (!parsed) return null;
              const legQuote = quotes[l.symbol] || {};
              const legBid = legQuote.bid || 0;
              const legAsk = legQuote.ask || 0;
              return {
                symbol: l.symbol,
                action: l.action as string,
                strike: parsed.strike,
                optionType: parsed.optionType,
                bid: legBid,
                ask: legAsk,
                mid: (legBid + legAsk) / 2,
              };
            }).filter(Boolean) as ProcessedWorkingOrder['spreadLegs'];
          }

          // ── Step 2: Compute bid/ask ────────────────────────────────────────────
          // For spread orders: compute NET bid/ask from both legs
          //   netBid = BTC leg bid - STC leg ask  (worst-case receive if selling spread)
          //   netAsk = BTC leg ask - STC leg bid  (worst-case pay if buying spread)
          // For single-leg orders: use the single leg quote directly
          let bid: number;
          let ask: number;
          let mid: number;
          let spread: number;

          if (isSpread && (order.legs.length === 2 || order.legs.length === 4)) {
            // For each leg: BTC legs cost money (debit), STC legs receive money (credit)
            // Net debit to close = sum of BTC ask prices - sum of STC bid prices
            const btcLegs = order.legs.filter((l: any) => l.action === 'Buy to Close');
            const stcLegs = order.legs.filter((l: any) => l.action === 'Sell to Close');

            if (btcLegs.length > 0 || stcLegs.length > 0) {
              const sumBtcBid = btcLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.bid || 0), 0);
              const sumBtcAsk = btcLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.ask || 0), 0);
              const sumStcBid = stcLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.bid || 0), 0);
              const sumStcAsk = stcLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.ask || 0), 0);

              // Net cost to close (debit): worst-case pay BTC at ask, receive STC at bid
              const netBid = Math.max(0, sumBtcBid - sumStcAsk);
              const netAsk = Math.max(0, sumBtcAsk - sumStcBid);

              bid = netBid;
              ask = netAsk;
              mid = (bid + ask) / 2;
              spread = ask - bid;

              console.log(`[WorkingOrders] Spread ${underlyingSymbol} (${spreadType}): sumBtcAsk=${sumBtcAsk.toFixed(2)} sumStcBid=${sumStcBid.toFixed(2)} → netBid=${bid.toFixed(2)} netAsk=${ask.toFixed(2)}`);
            } else {
              // Fallback: use first-leg quote
              bid = quote.bid || 0;
              ask = quote.ask || 0;
              mid = (bid + ask) / 2;
              spread = ask - bid;
            }
          } else {
            bid = quote.bid || 0;
            ask = quote.ask || 0;
            mid = (bid + ask) / 2;
            spread = ask - bid;
          }
          
          if (bid === 0 && ask === 0) {
            console.log(`[WorkingOrders] WARNING: No market data for ${symbol}. Quote:`, JSON.stringify(quote));
          }

          // Determine effective order action for pricing direction
          // For spread orders: use price-effect (Debit = buying = BTC direction)
          // For single-leg orders: use leg.action directly
          let effectiveAction: string;
          if (isSpread) {
            // Debit spread = paying to close = Buy-side pricing
            // Credit spread = receiving to close = Sell-side pricing
            effectiveAction = priceEffect === 'Debit' ? 'Buy to Close' : 'Sell to Close';
          } else {
            effectiveAction = leg.action;
          }

          // Calculate smart fill price with order action awareness
          const priceSuggestion = calculateSmartFillPrice(
            { bid, ask, mid },
            currentPrice,
            minutesWorking,
            aggressiveFillMode,
            effectiveAction // Use effective action (not raw leg action for spreads)
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
            priceEffect, // 'Debit' or 'Credit' from Tastytrade API
            // Spread fields
            isSpread,
            longStrike,
            spreadType,
            spreadLegs,
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
        // Surface rate-limit errors with a clean, user-friendly message
        const msg: string = error.message || '';
        if (msg.includes('Rate exceeded') || msg.includes('not valid JSON') || msg.includes('Unexpected token')) {
          throw new Error('Rate exceeded. Please wait a moment before retrying.');
        }
        throw new Error(`Failed to fetch working orders: ${msg}`);
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

  /**
   * Check order fill status for multiple orders
   * Used by replacement log to update badges from Working to Filled
   * Enhanced version that fetches individual order details for accurate status
   */
  checkOrderStatus: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      orderIds: z.array(z.string()),
    }))
    .query(async ({ input }) => {
      const { accountId, orderIds } = input;
      const { checkOrderStatusBatch } = await import('./tastytrade-order-status');

      try {
        // Use enhanced order status checking with individual order lookups
        const statusMap = await checkOrderStatusBatch(accountId, orderIds);
        
        // Convert to expected format (status string + optional filledAt)
        const result: Record<string, { status: string; filledAt?: string; cancelledAt?: string; rejectedReason?: string }> = {};
        
        for (const [orderId, orderStatus] of Object.entries(statusMap)) {
          result[orderId] = {
            status: orderStatus.status,
            filledAt: orderStatus.filledAt,
            cancelledAt: orderStatus.cancelledAt,
            rejectedReason: orderStatus.rejectedReason,
          };
        }

        return result;
      } catch (error: any) {
        console.error('[WorkingOrders] Error checking order status:', error);
        throw new Error(`Failed to check order status: ${error.message}`);
      }
    }),
});
