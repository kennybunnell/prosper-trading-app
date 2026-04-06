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
  isSafeToReplaceOrders,
  roundToTickSize
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
  // Roll-specific fields (atomic BTC + STO combo orders)
  isRoll?: boolean;
  rollType?: 'csp_roll' | 'cc_roll' | 'bps_roll' | 'bcs_roll' | 'ic_roll';
  rollNewExpiration?: string;   // new expiry leg expiration date
  rollNewStrike?: number;       // new expiry leg strike
  // Per-leg detail for multi-leg expansion in the UI
  spreadLegs?: Array<{
    symbol: string;
    action: string;       // 'Buy to Close' | 'Sell to Close' | 'Buy to Open' | 'Sell to Open'
    strike: number;
    optionType: 'PUT' | 'CALL';
    expiration: string;   // formatted expiration date for roll display
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

        // Fetch replacement counts from DB for all working orders
        const { getReplacementCounts } = await import('./db');
        const allOrderIds = allOrders.map((o: any) => String(o.id)).filter(Boolean);
        const replacementCountMap = await getReplacementCounts(allOrderIds);

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

          // Track roll-specific state
          let isRoll = false;
          let rollType: ProcessedWorkingOrder['rollType'] = undefined;
          let rollNewExpiration: string | undefined;
          let rollNewStrike: number | undefined;

          if (order.legs.length === 2) {
            const leg1 = order.legs[0];
            const leg2 = order.legs[1];
            const leg2Match = leg2.symbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
            if (leg2Match) {
              const leg2OptionType = leg2Match[3];
              const leg2Strike = parseInt(leg2Match[4]) / 1000;
              const leg2Expiry = leg2Match[2];
              const leg1Expiry = symbolMatch[2];

              // ── Roll detection: BTC (old expiry) + STO (new expiry) ──
              // A roll has one BTC leg and one STO leg on the same option type
              const leg1Action: string = leg1.action || '';
              const leg2Action: string = leg2.action || '';
              const hasBTC = leg1Action.includes('Buy to Close') || leg2Action.includes('Buy to Close');
              const hasSTO = leg1Action.includes('Sell to Open') || leg2Action.includes('Sell to Open');
              const sameOptionType = leg2OptionType === symbolMatch[3];

              if (hasBTC && hasSTO && sameOptionType) {
                // This is an atomic roll order
                isRoll = true;
                const stoLeg = leg1Action.includes('Sell to Open') ? leg1 : leg2;
                const stoMatch = stoLeg.symbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
                if (stoMatch) {
                  rollNewStrike = parseInt(stoMatch[4]) / 1000;
                  const stoExpRaw = stoMatch[2];
                  const stoYear = 2000 + parseInt(stoExpRaw.substring(0, 2));
                  const stoMonth = stoExpRaw.substring(2, 4);
                  const stoDay = stoExpRaw.substring(4, 6);
                  rollNewExpiration = `${stoMonth}/${stoDay}/${stoYear}`;
                }
                rollType = optionType === 'PUT' ? 'csp_roll' : 'cc_roll';
              } else if (leg2OptionType === symbolMatch[3]) {
                // Both legs same option type, same expiry → vertical spread close
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
            // Parse all 4 legs
            const parsed4 = order.legs.map((l: any) => ({
              ...parseLeg(l.symbol),
              action: l.action as string,
              rawSymbol: l.symbol,
            })).filter((l: any) => l.optionType);

            const btcLegs4 = parsed4.filter((l: any) => l.action?.includes('Buy to Close'));
            const stoLegs4 = parsed4.filter((l: any) => l.action?.includes('Sell to Open'));

            // ── BPS/BCS Roll: 2 BTC legs + 2 STO legs (same option type) ──
            if (btcLegs4.length === 2 && stoLegs4.length === 2) {
              const allPuts = parsed4.every((l: any) => l.optionType === 'PUT');
              const allCalls = parsed4.every((l: any) => l.optionType === 'CALL');

              if (allPuts || allCalls) {
                isRoll = true;
                rollType = allPuts ? 'bps_roll' : 'bcs_roll';

                // Primary display: use the BTC short strike (higher put / lower call)
                const btcStrikes = btcLegs4.map((l: any) => l.strike as number);
                const stoStrikes = stoLegs4.map((l: any) => l.strike as number);

                if (allPuts) {
                  // BPS: short put is the higher strike BTC leg
                  strike = Math.max(...btcStrikes);
                  rollNewStrike = Math.max(...stoStrikes);
                } else {
                  // BCS: short call is the lower strike BTC leg
                  strike = Math.min(...btcStrikes);
                  rollNewStrike = Math.min(...stoStrikes);
                }

                // New expiration: from the STO legs
                const stoLeg4 = stoLegs4[0];
                const stoSymMatch = stoLeg4.rawSymbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
                if (stoSymMatch) {
                  const expRaw = stoSymMatch[2];
                  const yr = 2000 + parseInt(expRaw.substring(0, 2));
                  const mo = expRaw.substring(2, 4);
                  const dy = expRaw.substring(4, 6);
                  rollNewExpiration = `${mo}/${dy}/${yr}`;
                }

                console.log(`[WorkingOrders] 4-leg roll detected: ${rollType} for ${underlyingSymbol}, BTC strikes: ${btcStrikes}, STO strikes: ${stoStrikes}`);
              }
            }

            // ── Iron Condor: 2 puts + 2 calls (close order) ──
            if (!isRoll) {
              const puts = parsed4.filter((l: any) => l.optionType === 'PUT');
              const calls = parsed4.filter((l: any) => l.optionType === 'CALL');

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
          }

          // Build per-leg detail array for spread and roll orders
          if (isSpread || isRoll) {
            spreadLegs = order.legs.map((l: any) => {
              const parsed = parseLeg(l.symbol);
              if (!parsed) return null;
              const legQuote = quotes[l.symbol] || {};
              const legBid = legQuote.bid || 0;
              const legAsk = legQuote.ask || 0;
              // Parse expiration from leg symbol for roll display
              const legSymMatch = l.symbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+)$/);
              let legExpiration = '';
              if (legSymMatch) {
                const expRaw = legSymMatch[2];
                const yr = 2000 + parseInt(expRaw.substring(0, 2));
                const mo = expRaw.substring(2, 4);
                const dy = expRaw.substring(4, 6);
                legExpiration = `${mo}/${dy}/${yr}`;
              }
              return {
                symbol: l.symbol,
                action: l.action as string,
                strike: parsed.strike,
                optionType: parsed.optionType,
                expiration: legExpiration,
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
          } else if (isRoll) {
            // Roll order net pricing: sum(STO bids) - sum(BTC asks) = net credit
            // Works for both 2-leg (CSP/CC) and 4-leg (BPS/BCS) rolls
            const rollBtcLegs = order.legs.filter((l: any) => l.action === 'Buy to Close');
            const rollStoLegs = order.legs.filter((l: any) => l.action === 'Sell to Open');
            const sumBtcBid = rollBtcLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.bid || 0), 0);
            const sumBtcAsk = rollBtcLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.ask || 0), 0);
            const sumStoBid = rollStoLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.bid || 0), 0);
            const sumStoAsk = rollStoLegs.reduce((s: number, l: any) => s + (quotes[l.symbol]?.ask || 0), 0);
            // Net credit (positive = receive money): sum(STO bids) - sum(BTC asks)
            const netCredit = sumStoBid - sumBtcAsk;
            bid = Math.abs(netCredit);
            ask = Math.abs(sumStoBid - sumBtcAsk);
            mid = Math.abs((sumStoBid + sumStoAsk) / 2 - (sumBtcBid + sumBtcAsk) / 2);
            spread = Math.abs(sumStoAsk - sumStoBid) + Math.abs(sumBtcAsk - sumBtcBid);
            console.log(`[WorkingOrders] Roll ${underlyingSymbol} (${rollType}, ${order.legs.length}-leg): sumBtcAsk=${sumBtcAsk.toFixed(2)} sumStoBid=${sumStoBid.toFixed(2)} → netCredit=${netCredit.toFixed(2)}`);
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
            effectiveAction, // Use effective action (not raw leg action for spreads)
            underlyingSymbol  // Pass symbol for correct tick size rounding
          );

          // Look up replacement count from DB (persisted via recordOrderReplacement)
          const replacementCount = replacementCountMap.get(String(order.id)) ?? 0;
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
            // Roll fields
            isRoll,
            rollType,
            rollNewExpiration,
            rollNewStrike,
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
          // Extract underlying symbol from the option symbol for tick size determination
          // Option symbol format: "AVGO  250117C00185000" → underlying = "AVGO"
          const underlyingMatch = order.symbol.match(/^([A-Z]+)/);
          const underlyingSymbol = underlyingMatch ? underlyingMatch[1] : '';
          
          // Snap price to correct Tastytrade tick increment:
          // - Penny Pilot symbols (AAPL, TSLA, SPY, etc.): $0.01 increments
          // - All other equity options: $0.05 increments
          const snappedPrice = roundToTickSize(order.suggestedPrice, underlyingSymbol);
          console.log(`[WorkingOrders] Replace ${order.symbol}: suggestedPrice=$${order.suggestedPrice} → snappedPrice=$${snappedPrice} (underlying=${underlyingSymbol})`);
          
          const result = await api.cancelReplaceOrder(
            order.accountNumber,
            order.orderId,
            snappedPrice,
            order.rawOrder
          );

          results.push({
            orderId: order.orderId,
            symbol: order.symbol,
            oldPrice: parseFloat(order.rawOrder.price || '0'),
            newPrice: snappedPrice,
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
      const api = getTastytradeAPI();

      try {
        // Resolve account list
        let accountsToCheck: string[] = [];
        if (accountId === 'ALL_ACCOUNTS') {
          const accounts = await api.getAccounts();
          accountsToCheck = accounts.map((acc: any) => acc.account?.['account-number'] || acc['account-number']);
        } else {
          accountsToCheck = [accountId];
        }

        // For each orderId, try each account until we find the order
        const result: Record<string, { status: string; filledAt?: string; cancelledAt?: string; rejectedReason?: string }> = {};

        for (const orderId of orderIds) {
          let found = false;
          for (const accNum of accountsToCheck) {
            try {
              const statusMap = await checkOrderStatusBatch(accNum, [orderId]);
              const orderStatus = statusMap[orderId];
              if (orderStatus && orderStatus.status !== 'Working') {
                // Found a definitive status
                result[orderId] = {
                  status: orderStatus.status,
                  filledAt: orderStatus.filledAt,
                  cancelledAt: orderStatus.cancelledAt,
                  rejectedReason: orderStatus.rejectedReason,
                };
                found = true;
                break;
              } else if (orderStatus) {
                // Working status — record it but keep trying other accounts
                result[orderId] = {
                  status: orderStatus.status,
                  filledAt: orderStatus.filledAt,
                  cancelledAt: orderStatus.cancelledAt,
                  rejectedReason: orderStatus.rejectedReason,
                };
                found = true;
                // Don't break — a definitive status from another account would override
              }
            } catch {
              // Order not found in this account, try next
            }
          }
          if (!found) {
            result[orderId] = { status: 'Working' };
          }
        }

        return result;
      } catch (error: any) {
        console.error('[WorkingOrders] Error checking order status:', error);
        throw new Error(`Failed to check order status: ${error.message}`);
      }
    }),
});
