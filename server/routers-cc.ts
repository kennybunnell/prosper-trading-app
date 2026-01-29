/**
 * Covered Calls Router
 * Backend procedures for CC workflow: position fetching, option scanning, scoring, order submission
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const ccRouter = router({
  /**
   * Fetch stock positions eligible for covered calls (≥100 shares)
   * Also identifies existing short calls and calculates available contracts
   */
  getEligiblePositions: protectedProcedure
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

      // Fetch all positions
      const positions = await api.getPositions(input.accountNumber);

      // Separate stock positions and option positions
      // Tastytrade API returns hyphenated field names like 'instrument-type', not camelCase
      const stockPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity');
      const optionPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity Option');

      // Identify short calls (covered calls already sold)
      const shortCalls: Record<string, { contracts: number; details: any[] }> = {};
      
      for (const opt of optionPositions) {
        // Short calls have negative quantity and are calls
        const quantityDirection = (opt as any)['quantity-direction'];
        if (quantityDirection === 'Short' && (opt as any).symbol.includes('C')) {
          const underlying = (opt as any)['underlying-symbol'];
          if (!shortCalls[underlying]) {
            shortCalls[underlying] = { contracts: 0, details: [] };
          }
          const qty = Math.abs(parseFloat((opt as any).quantity));
          shortCalls[underlying].contracts += qty;
          shortCalls[underlying].details.push({
            symbol: (opt as any).symbol,
            quantity: qty,
            strike: parseFloat((opt as any).symbol.match(/(\d+)C/)?.[1] || '0'),
            expiration: (opt as any)['expires-at'],
          });
        }
      }

      // Build holdings list - include ALL stock positions (not just ≥100 shares)
      // This matches Streamlit logic: all stocks are added, then filter by maxContracts > 0
      const holdings = stockPositions
        .filter((p: any) => parseFloat(p.quantity) > 0) // Long positions only
        .map((p: any) => {
          const symbol = p.symbol;
          const quantity = parseFloat(p.quantity);
          const currentPrice = parseFloat(p['close-price']);
          const marketValue = quantity * currentPrice;

          // Calculate contracts covered by existing short calls
          const existingContracts = shortCalls[symbol]?.contracts || 0;
          const sharesCovered = existingContracts * 100;
          
          // Calculate available shares and max new contracts
          const availableShares = Math.max(0, quantity - sharesCovered);
          const maxContracts = Math.floor(availableShares / 100);

          return {
            symbol,
            quantity,
            currentPrice,
            marketValue,
            existingContracts,
            sharesCovered,
            availableShares,
            maxContracts,
            hasExistingCalls: existingContracts > 0,
          };
        });

      // Calculate breakdown summary
      const breakdown = {
        totalPositions: positions.length,
        stockPositions: stockPositions.length,
        existingShortCalls: Object.keys(shortCalls).length,
        eligiblePositions: holdings.filter(h => h.maxContracts > 0).length,
        eligibleContracts: holdings.reduce((sum, h) => sum + h.maxContracts, 0),
        coveredSymbols: Object.keys(shortCalls),
        shortCallDetails: shortCalls,
      };

      return { holdings, breakdown };
    }),

  /**
   * Scan call option chains for selected stocks
   * Calculates composite scores (0-100) for all opportunities
   */
  scanOpportunities: protectedProcedure
    .input(
      z.object({
        symbols: z.array(z.string()),
        holdings: z.array(
          z.object({
            symbol: z.string(),
            quantity: z.number(),
            currentPrice: z.number(),
            maxContracts: z.number(),
          })
        ),
        minDte: z.number().default(7),
        maxDte: z.number().default(45),
        minDelta: z.number().default(0.05),
        maxDelta: z.number().default(0.99),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tradierApiKey) {
        throw new Error('Tradier API key not configured');
      }

      const api = createTradierAPI(credentials.tradierApiKey);
      const opportunities: any[] = [];

      // Build holdings map for quick lookup
      const holdingsMap = new Map(
        input.holdings.map(h => [h.symbol, h])
      );

      // Process symbols in parallel with concurrency limit of 5 (matches CSP Dashboard)
      const CONCURRENCY = 5;
      console.log(`[CC Scanner] Processing ${input.symbols.length} symbols with ${CONCURRENCY} concurrent workers...`);
      
      for (let i = 0; i < input.symbols.length; i += CONCURRENCY) {
        const batch = input.symbols.slice(i, i + CONCURRENCY);
        console.log(`[CC Scanner] Batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(input.symbols.length / CONCURRENCY)}: ${batch.join(', ')}`);
        
        const batchPromises = batch.map(async (symbol) => {
          const holding = holdingsMap.get(symbol);
          if (!holding) return [];

          const symbolOpportunities: any[] = [];

          try {
            // Fetch indicators (RSI, IV Rank, BB %B)
            const indicators = await api.getTechnicalIndicators(symbol);
            const rsi = indicators?.rsi || null;
            const ivRank = indicators?.ivRank || null;
            const bbPctB = indicators?.bollingerBands?.percentB || null;

            // Fetch expirations and filter by DTE
            const expirations = await api.getExpirations(symbol);
            const today = new Date();
            const filteredExpirations = expirations.filter(exp => {
              const expDate = new Date(exp);
              const dte = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              return dte >= input.minDte && dte <= input.maxDte;
            });

            if (filteredExpirations.length === 0) return [];

            // Process each expiration
            for (const expiration of filteredExpirations) {
              const options = await api.getOptionChain(symbol, expiration, true);
              const calls = options.filter(opt => opt.option_type === 'call');

              for (const option of calls) {

                const strike = option.strike || 0;
                const delta = Math.abs(option.greeks?.delta || 0);
                const bid = option.bid || 0;
                const ask = option.ask || 0;
                const mid = (bid + ask) / 2;
                const volume = option.volume || 0;
                const openInterest = option.open_interest || 0;

                // Only OTM calls (strike > current price)
                if (strike <= holding.currentPrice) continue;

                // Filter by delta range
                if (delta < input.minDelta || delta > input.maxDelta) continue;

                // Skip if no bid
                if (bid <= 0) continue;

                // Calculate DTE
                const expDate = new Date(expiration);
                const dte = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                // Calculate metrics
                const premiumPerShare = mid;
                const returnPct = (premiumPerShare / holding.currentPrice) * 100;
                const weeklyReturn = dte > 0 ? (returnPct / dte) * 7 : 0;
                const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
                const distanceOtmPct = ((strike - holding.currentPrice) / holding.currentPrice) * 100;

                symbolOpportunities.push({
                  symbol,
                  currentPrice: holding.currentPrice,
                  strike,
                  expiration,
                  dte,
                  delta,
                  bid,
                  ask,
                  mid,
                  premium: mid * 100, // Per contract
                  returnPct,
                  weeklyReturn,
                  volume,
                  openInterest,
                  spreadPct,
                  rsi,
                  ivRank,
                  bbPctB,
                  sharesOwned: holding.quantity,
                  maxContracts: holding.maxContracts,
                  distanceOtm: distanceOtmPct,
                });
              }
            }
            console.log(`[CC Scanner] ✓ ${symbol}: found ${symbolOpportunities.length} opportunities`);
          } catch (error: any) {
            console.error(`[CC Scanner] ✗ ${symbol}: ${error.message}`);
          }
          
          return symbolOpportunities;
        });
        
        // Wait for batch to complete
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Collect opportunities from batch
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            opportunities.push(...result.value);
          }
        });
      }

      // Calculate composite scores for all opportunities
      const scoredOpportunities = opportunities.map(opp => ({
        ...opp,
        score: calculateCCScore(opp),
      }));

      // Sort by score descending
      scoredOpportunities.sort((a, b) => b.score - a.score);

      return scoredOpportunities;
    }),

  /**
   * Calculate bear call spread opportunities from CC opportunities
   * Takes CC opportunities and adds protective long calls at higher strikes
   */
  bearCallSpreadOpportunities: protectedProcedure
    .input(
      z.object({
        ccOpportunities: z.array(z.any()), // CC opportunities from scanOpportunities
        spreadWidth: z.number(), // 2, 5, or 10
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');
      const { calculateBearCallSpread } = await import('./bear-call-pricing');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tradierApiKey) {
        throw new Error('Tradier API key not configured');
      }

      const api = createTradierAPI(credentials.tradierApiKey);
      const spreadOpportunities = [];

      // For each CC opportunity, calculate the spread pricing
      for (const ccOpp of input.ccOpportunities) {
        try {
          // Calculate long strike (protective call)
          const longStrike = ccOpp.strike + input.spreadWidth;

          // Fetch option chain for this expiration to get long call quote
          const options = await api.getOptionChain(
            ccOpp.symbol,
            ccOpp.expiration,
            true // with Greeks
          );

          // Find the long call at our target strike
          const longCall = options.find(
            opt => opt.option_type === 'call' && opt.strike === longStrike
          );

          if (!longCall || !longCall.bid || !longCall.ask) {
            // Skip if we can't find the long call or it has no quotes
            continue;
          }

          // Calculate spread pricing
          const spreadOpp = calculateBearCallSpread(
            ccOpp,
            input.spreadWidth,
            {
              bid: longCall.bid,
              ask: longCall.ask,
              delta: Math.abs(longCall.greeks?.delta || 0),
            }
          );

          // Only include if net credit is positive
          if (spreadOpp.netCredit > 0) {
            // Recalculate score for spread
            spreadOpp.score = calculateCCScore(spreadOpp);
            spreadOpportunities.push(spreadOpp);
          }
        } catch (error) {
          console.error(`[BearCallSpread] Error calculating spread for ${ccOpp.symbol}:`, error);
          // Skip this opportunity and continue
          continue;
        }
      }

      // Sort by score descending
      spreadOpportunities.sort((a, b) => b.score - a.score);

      return spreadOpportunities;
    }),

  /**
   * Submit covered call orders (with dry run support)
   */
  submitOrders: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        orders: z.array(
          z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            quantity: z.number(),
            price: z.number(),
          })
        ),
        dryRun: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate contract limits before submission (both dry run and live)
      const { getApiCredentials } = await import('./db');
      const { getTastytradeAPI } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new Error('Tastytrade credentials not configured');
      }

      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

      // Fetch current positions to get maxContracts for each symbol
      const positions = await api.getPositions(input.accountNumber);
      const stockPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity');
      const optionPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity Option');

      // Identify short calls (covered calls already sold)
      const shortCalls: Record<string, number> = {};
      for (const opt of optionPositions) {
        const quantityDirection = (opt as any)['quantity-direction'];
        if (quantityDirection === 'Short' && (opt as any).symbol.includes('C')) {
          const underlying = (opt as any)['underlying-symbol'];
          const qty = Math.abs(parseFloat((opt as any).quantity));
          shortCalls[underlying] = (shortCalls[underlying] || 0) + qty;
        }
      }

      // Calculate maxContracts for each stock position
      const maxContractsMap: Record<string, number> = {};
      for (const pos of stockPositions) {
        const symbol = (pos as any).symbol;
        const quantity = parseFloat((pos as any).quantity);
        if (quantity > 0) {
          const existingContracts = shortCalls[symbol] || 0;
          const sharesCovered = existingContracts * 100;
          const availableShares = Math.max(0, quantity - sharesCovered);
          maxContractsMap[symbol] = Math.floor(availableShares / 100);
        }
      }

      // Group orders by symbol and count contracts
      const contractsPerSymbol: Record<string, number> = {};
      for (const order of input.orders) {
        contractsPerSymbol[order.symbol] = (contractsPerSymbol[order.symbol] || 0) + order.quantity;
      }

      // Validate each symbol doesn't exceed maxContracts
      const validationErrors: string[] = [];
      for (const [symbol, requestedContracts] of Object.entries(contractsPerSymbol)) {
        const maxContracts = maxContractsMap[symbol] || 0;
        if (requestedContracts > maxContracts) {
          validationErrors.push(
            `${symbol}: Requested ${requestedContracts} contracts but only ${maxContracts} available`
          );
        }
      }

      // If validation fails, return errors
      if (validationErrors.length > 0) {
        throw new Error(`Contract limit validation failed:\n${validationErrors.join('\n')}`);
      }

      if (input.dryRun) {
        // Dry run - validation passed, return success
        return input.orders.map(order => ({
          success: true,
          symbol: order.symbol,
          strike: order.strike,
          quantity: order.quantity,
          message: 'Dry run - validation passed, order not submitted',
          orderId: 'DRY_RUN',
        }));
      }

      // Live mode - submit real orders (api and credentials already initialized above)
      const results = [];

      for (const order of input.orders) {
        try {
          // Format option symbol (e.g., "AAPL  250131C00175000")
          const expDate = new Date(order.expiration);
          const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
          const strikeStr = (order.strike * 1000).toFixed(0).padStart(8, '0');
          const optionSymbol = `${order.symbol.padEnd(6)}${expStr}C${strikeStr}`;

          // Submit sell-to-open order
          const result = await api.submitOrder({
            accountNumber: input.accountNumber,
            timeInForce: 'Day',
            orderType: 'Limit',
            price: order.price.toFixed(2),
            priceEffect: 'Credit',
            legs: [
              {
                instrumentType: 'Equity Option',
                symbol: optionSymbol,
                quantity: order.quantity.toString(),
                action: 'Sell to Open',
              },
            ],
          });

          results.push({
            success: true,
            symbol: order.symbol,
            strike: order.strike,
            quantity: order.quantity,
            orderId: result.id,
            message: 'Order submitted successfully',
          });
        } catch (error: any) {
          results.push({
            success: false,
            symbol: order.symbol,
            strike: order.strike,
            quantity: order.quantity,
            message: error.message,
          });
        }
      }

      return results;
    }),

  /**
   * Submit bear call spread orders (two-leg: STO short call + BTO long call)
   */
  submitBearCallSpreadOrders: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        orders: z.array(
          z.object({
            symbol: z.string(),
            shortStrike: z.number(),
            longStrike: z.number(),
            expiration: z.string(),
            quantity: z.number(),
            netCredit: z.number(), // Net credit for the spread
          })
        ),
        dryRun: z.boolean().default(false),
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

      if (input.dryRun) {
        // Dry run - return success without submitting
        return input.orders.map(order => ({
          success: true,
          symbol: order.symbol,
          shortStrike: order.shortStrike,
          longStrike: order.longStrike,
          quantity: order.quantity,
          message: 'Dry run - validation passed, order not submitted',
          orderId: 'DRY_RUN',
        }));
      }

      // Live mode - submit real two-leg orders
      const results = [];

      for (const order of input.orders) {
        try {
          // Format option symbols
          const expDate = new Date(order.expiration);
          const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
          
          const shortStrikeStr = (order.shortStrike * 1000).toFixed(0).padStart(8, '0');
          const longStrikeStr = (order.longStrike * 1000).toFixed(0).padStart(8, '0');
          
          const shortCallSymbol = `${order.symbol.padEnd(6)}${expStr}C${shortStrikeStr}`;
          const longCallSymbol = `${order.symbol.padEnd(6)}${expStr}C${longStrikeStr}`;

          // Calculate limit price (10% above net credit or +$0.05, whichever is greater)
          const buffer = Math.max(order.netCredit * 0.10, 0.05);
          const limitPrice = order.netCredit + buffer;

          // Submit two-leg spread order
          const result = await api.submitOrder({
            accountNumber: input.accountNumber,
            timeInForce: 'Day',
            orderType: 'Limit',
            price: limitPrice.toFixed(2),
            priceEffect: 'Credit',
            legs: [
              {
                instrumentType: 'Equity Option',
                symbol: shortCallSymbol,
                quantity: order.quantity.toString(),
                action: 'Sell to Open',
              },
              {
                instrumentType: 'Equity Option',
                symbol: longCallSymbol,
                quantity: order.quantity.toString(),
                action: 'Buy to Open',
              },
            ],
          });

          results.push({
            success: true,
            symbol: order.symbol,
            shortStrike: order.shortStrike,
            longStrike: order.longStrike,
            quantity: order.quantity,
            orderId: result.id,
            message: 'Bear call spread order submitted successfully',
          });
        } catch (error: any) {
          results.push({
            success: false,
            symbol: order.symbol,
            shortStrike: order.shortStrike,
            longStrike: order.longStrike,
            quantity: order.quantity,
            message: error.message,
          });
        }
      }

      return results;
    }),
});

/**
 * Calculate CC Composite Score (0-100)
 * 
 * Weighting:
 * - Weekly Return % (25%): Higher = Better
 * - Delta (20%): 0.20-0.35 = Best (balance premium vs getting called)
 * - RSI (15%): Higher = Better for CC (overbought = good time to sell calls)
 * - BB %B (15%): Higher = Better for CC (stock near upper band)
 * - Distance to Strike % (15%): Higher = Better (more room before assignment)
 * - Spread % (10%): Lower = Better (tighter spreads)
 */
function calculateCCScore(opp: any): number {
  let score = 0;

  // 1. Weekly Return % (25 points) - Scale 0.3% to 2.0%
  const weekly = opp.weeklyReturn || 0;
  if (weekly >= 2.0) {
    score += 25;
  } else if (weekly >= 0.3) {
    score += 25 * ((weekly - 0.3) / 1.7);
  }

  // 2. Delta (20 points) - Sweet spot around 0.20-0.35
  const delta = Math.abs(opp.delta || 0);
  if (delta >= 0.20 && delta <= 0.35) {
    score += 20; // Perfect range
  } else if (delta >= 0.15 && delta <= 0.40) {
    score += 15; // Good range
  } else if (delta >= 0.10 && delta <= 0.50) {
    score += 10; // Acceptable
  } else {
    score += 5; // Outside ideal range
  }

  // 3. RSI (15 points) - Higher is better for CC (overbought)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 70) {
      score += 15; // Overbought - excellent for selling calls
    } else if (rsi > 60) {
      score += 12;
    } else if (rsi > 50) {
      score += 9;
    } else if (rsi > 40) {
      score += 6;
    } else if (rsi > 30) {
      score += 3;
    }
    // < 30 = 0 points (oversold - bad for selling calls)
  } else {
    score += 7; // Neutral if no data
  }

  // 4. BB %B (15 points) - Higher is better for CC
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb > 0.8) {
      score += 15; // Near upper band - excellent
    } else if (bb > 0.7) {
      score += 12;
    } else if (bb > 0.5) {
      score += 9;
    } else if (bb > 0.3) {
      score += 6;
    } else if (bb > 0.2) {
      score += 3;
    }
    // < 0.2 = 0 points (near lower band)
  } else {
    score += 7; // Neutral if no data
  }

  // 5. Distance to Strike % (15 points) - Higher is better
  const distancePct = opp.distanceOtm || 0;
  if (distancePct > 10) {
    score += 15;
  } else if (distancePct > 7) {
    score += 12;
  } else if (distancePct > 5) {
    score += 9;
  } else if (distancePct > 3) {
    score += 6;
  } else if (distancePct > 1) {
    score += 3;
  }
  // < 1% = 0 points (too close)

  // 6. Spread % (10 points) - Lower is better
  const spread = opp.spreadPct;
  if (spread !== null && spread !== undefined) {
    if (spread <= 1) {
      score += 10;
    } else if (spread <= 2) {
      score += 8;
    } else if (spread <= 5) {
      score += 5;
    } else if (spread <= 10) {
      score += 2;
    }
    // > 10% = 0 points
  } else {
    score += 5; // Neutral if no data
  }

  return Math.round(score);
}
