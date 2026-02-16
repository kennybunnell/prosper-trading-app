/**
 * PMCC (Poor Man's Covered Call) Router
 * Handles LEAP scanning, purchase, and short call selling against LEAPs
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export type LeapOpportunity = {
  symbol: string;
  strike: number;
  currentPrice: number;
  expiration: string;
  dte: number;
  premium: number; // Cost to buy the LEAP
  bid: number;
  ask: number;
  bidAskSpread: number;
  bidAskSpreadPercent: number;
  delta: number;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
  openInterest: number;
  volume: number;
  rsi: number | null;
  ivRank: number | null;
  bbPercent: number | null;
  score: number;
};

export const pmccRouter = router({
  /**
   * Scan watchlist for LEAP buy opportunities
   * Uses parallel processing (10 concurrent workers) to scan multiple symbols simultaneously
   */
  scanLeaps: protectedProcedure
    .input(
      z.object({
        presetName: z.enum(["conservative", "medium", "aggressive"]),
        symbols: z.array(z.string()).optional(), // Optional array of symbols to scan
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import("./db");
      const { getFilterPresetsByStrategy, seedPmccFilterPresets } = await import("./db-filter-presets");
      const { createTradierAPI } = await import("./tradier");
      const { getWatchlist } = await import("./db");
      const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');

      // Check rate limit for Tier 1 users (owner/admin bypass automatically)
      const rateLimit = await checkRateLimit(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);
      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: rateLimit.message || 'Rate limit exceeded',
        });
      }

      // Ensure PMCC filter presets exist
      await seedPmccFilterPresets(ctx.user.id);

      // Get filter preset
      const presets = await getFilterPresetsByStrategy(ctx.user.id, "pmcc");
      const preset = presets.find((p) => p.presetName === input.presetName);

      if (!preset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `PMCC filter preset "${input.presetName}" not found`,
        });
      }

      // Get API credentials
      const credentials = await getApiCredentials(ctx.user.id);
      
      // Determine if user can use system API key (only free trial users)
      const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
      const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
      
      if (!tradierApiKey) {
        const message = isFreeTrialUser 
          ? 'System Tradier API key not configured. Please contact support.'
          : 'Please configure your Tradier API key in Settings to access live market data.';
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message,
        });
      }

      // Get PMCC watchlist
      const watchlist = await getWatchlist(ctx.user.id);
      if (watchlist.length === 0) {
        return { opportunities: [], message: "Watchlist is empty" };
      }

      const api = createTradierAPI(tradierApiKey);
      
      // Use provided symbols if available, otherwise use full watchlist
      const symbols = input.symbols && input.symbols.length > 0 
        ? input.symbols 
        : watchlist.map((w) => w.symbol);

      console.log(`[PMCC] Scanning ${symbols.length} symbols for LEAP opportunities with ${input.presetName} preset`);

      // Parallel processing with 10 concurrent workers (Tradier rate limit: 120 req/min)
      const CONCURRENT_WORKERS = 10;
      const allOpportunities: LeapOpportunity[] = [];

      for (let i = 0; i < symbols.length; i += CONCURRENT_WORKERS) {
        const batch = symbols.slice(i, i + CONCURRENT_WORKERS);
        const batchPromises = batch.map(async (symbol) => {
          try {
            // Get current stock price
            const quote = await api.getQuote(symbol);
            const currentPrice = quote.last || quote.close || 0;

            if (currentPrice === 0) {
              console.warn(`[PMCC] No price data for ${symbol}, skipping`);
              return [];
            }

            // Fetch technical indicators (RSI, IV Rank, BB %B)
            const indicators = await api.getTechnicalIndicators(symbol).catch(() => ({
              rsi: null,
              ivRank: null,
              bollingerBands: { percentB: null },
            }));

            // Get option expirations (looking for LEAPs 9-15 months out)
            const expirations = await api.getExpirations(symbol);
            const now = new Date();
            const minDate = new Date(now.getTime() + preset.minDte * 24 * 60 * 60 * 1000);
            const maxDate = new Date(now.getTime() + preset.maxDte * 24 * 60 * 60 * 1000);

            const leapExpirations = expirations.filter((exp) => {
              const expDate = new Date(exp);
              return expDate >= minDate && expDate <= maxDate;
            });

            if (leapExpirations.length === 0) {
              console.log(`[PMCC] No LEAP expirations found for ${symbol} in DTE range ${preset.minDte}-${preset.maxDte}`);
              return [];
            }

            // Scan each LEAP expiration for deep ITM call opportunities
            const symbolOpportunities: LeapOpportunity[] = [];

            for (const expiration of leapExpirations) {
              const chain = await api.getOptionChain(symbol, expiration);
              const calls = chain.filter((opt) => opt.option_type === "call");

              // Calculate DTE
              const expDate = new Date(expiration);
              const dte = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

              for (const call of calls) {
                // Filter by delta (deep ITM for LEAPs: 0.70-0.90)
                if (call.greeks?.delta && call.greeks.delta >= parseFloat(preset.minDelta) && call.greeks.delta <= parseFloat(preset.maxDelta)) {
                  // Filter by open interest and volume
                  if (call.open_interest >= preset.minOpenInterest && call.volume >= preset.minVolume) {
                    const bidAskSpread = call.ask - call.bid;
                    const bidAskSpreadPercent = (bidAskSpread / call.ask) * 100;

                    // Import new scoring system
                    const { calculatePMCCScore } = await import('./pmcc-scoring');
                    
                    // Build LEAP opportunity object for scoring
                    const leapOpp: LeapOpportunity = {
                      symbol,
                      strike: call.strike,
                      currentPrice,
                      expiration,
                      dte,
                      premium: (call.bid + call.ask) / 2,
                      bid: call.bid,
                      ask: call.ask,
                      bidAskSpread,
                      bidAskSpreadPercent,
                      delta: call.greeks?.delta || 0,
                      gamma: call.greeks?.gamma || null,
                      theta: call.greeks?.theta || null,
                      vega: call.greeks?.vega || null,
                      iv: call.greeks?.mid_iv || null,
                      openInterest: call.open_interest,
                      volume: call.volume,
                      rsi: indicators.rsi,
                      ivRank: indicators.ivRank,
                      bbPercent: indicators.bollingerBands?.percentB || null,
                      score: 0, // Will be calculated next
                    };
                    
                    // Calculate score using new PMCC scoring system
                    const { score } = calculatePMCCScore(leapOpp);
                    leapOpp.score = score;

                    // Add to opportunities
                    symbolOpportunities.push(leapOpp);
                  }
                }
              }
            }

            // Sort by score descending
            symbolOpportunities.sort((a, b) => b.score - a.score);

            return symbolOpportunities;
          } catch (error: any) {
            console.error(`[PMCC] Error scanning ${symbol}:`, error.message);
            return [];
          }
        });

        const batchResults = await Promise.all(batchPromises);
        allOpportunities.push(...batchResults.flat());
      }

      // Sort all opportunities by score descending
      allOpportunities.sort((a, b) => b.score - a.score);

      console.log(`[PMCC] Found ${allOpportunities.length} LEAP opportunities across ${symbols.length} symbols`);

      // Increment scan count for Tier 1 users (after successful scan)
      await incrementScanCount(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);

      return {
        opportunities: allOpportunities,
        message: `Found ${allOpportunities.length} LEAP opportunities`,
      };
    }),

  /**
   * Get active LEAP positions from Tastytrade account
   * Filters for long call options with 270+ DTE
   */
  getLeapPositions: protectedProcedure
    .query(async ({ ctx }) => {
      const { getApiCredentials } = await import("./db");
      const { getTastytradeAPI } = await import("./tastytrade");
      const { createTradierAPI } = await import("./tradier");

      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tastytrade credentials not configured. Please add them in Settings.",
        });
      }

      // Initialize Tastytrade API
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials);

      // Get accounts
      const accounts = await api.getAccounts();
      if (!accounts || accounts.length === 0) {
        return { positions: [] };
      }

      const accountNumber = accounts[0].account["account-number"];

      // Get positions
      const positions = await api.getPositions(accountNumber);

      // Filter for LEAP calls (long call options with 270+ DTE)
      const leapPositions = positions.filter(pos => {
        if (pos['instrument-type'] !== "Equity Option") return false;
        if (pos['quantity-direction'] !== "Long") return false;
        if (!pos.symbol.includes("C")) return false; // Must be a call
        if (!pos['expires-at']) return false;

        // Calculate DTE
        const expiration = new Date(pos['expires-at']);
        const now = new Date();
        const dte = Math.floor((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        return dte >= 270; // Only LEAPs (9+ months)
      });

      // Get current market data for each LEAP
      const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
      const tradierApiKey = credentials.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null) || "";
      const tradierApi = createTradierAPI(tradierApiKey);
      const enrichedPositions = await Promise.all(
        leapPositions.map(async (pos) => {
          try {
            // Parse option symbol to get underlying and strike
            const underlying = pos['underlying-symbol'];
            const strike = parseFloat(pos.symbol.match(/C(\d+)/)?.[1] || "0") / 1000;
            const expiration = new Date(pos['expires-at']!);
            const dte = Math.floor((expiration.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

            // Get current option price from position data
            const currentPrice = parseFloat(pos['close-price']) || 0;

            // Get current stock price
            const stockQuote = await tradierApi.getQuote(underlying);
            const stockPrice = stockQuote?.last || 0;

            // Calculate P/L
            const costBasis = Math.abs(parseFloat(pos['average-open-price'])) * 100 * pos.quantity; // *100 for multiplier
            const currentValue = currentPrice * 100 * pos.quantity;
            const profitLoss = currentValue - costBasis;
            const profitLossPercent = (profitLoss / costBasis) * 100;

            return {
              symbol: underlying,
              optionSymbol: pos.symbol,
              strike,
              expiration: pos['expires-at']!,
              dte,
              quantity: pos.quantity,
              costBasis,
              currentValue,
              profitLoss,
              profitLossPercent,
              currentPrice,
              stockPrice,
              delta: 0.80, // TODO: Get from Greeks if available
            };
          } catch (error) {
            console.error(`[PMCC] Error enriching position ${pos.symbol}:`, error);
            return null;
          }
        })
      );

      return {
        positions: enrichedPositions.filter(p => p !== null),
      };
    }),

  /**
   * Submit LEAP purchase orders via Tastytrade API
   * Supports dry run mode for validation without execution
   */
  submitLeapOrders: protectedProcedure
    .input(
      z.object({
        leaps: z.array(
          z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            premium: z.number(),
          })
        ),
        isDryRun: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
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
      
      const { getApiCredentials } = await import("./db");
      const { getTastytradeAPI } = await import("./tastytrade");

      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tastytrade credentials not configured. Please add them in Settings.",
        });
      }

      // Validate market hours (9:30 AM - 4:00 PM ET)
      const now = new Date();
      const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
      const etMinute = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getMinutes();
      const etTime = etHour * 60 + etMinute;
      const marketOpen = 9 * 60 + 30; // 9:30 AM
      const marketClose = 16 * 60; // 4:00 PM

      if (etTime < marketOpen || etTime >= marketClose) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Market is closed. Orders can only be submitted between 9:30 AM - 4:00 PM ET.",
        });
      }

      // Initialize Tastytrade API
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials);

      // Get accounts
      const accounts = await api.getAccounts();
      if (!accounts || accounts.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Tastytrade accounts found.",
        });
      }

      const accountNumber = accounts[0].account["account-number"];

      // Get account balances for buying power check
      const balances = await api.getBalances(accountNumber);
      const buyingPower = parseFloat(balances["derivative-buying-power"] || balances["cash-available-to-withdraw"] || "0");

      // Calculate total cost
      const totalCost = input.leaps.reduce((sum, leap) => sum + (leap.premium * 100), 0); // *100 for contract multiplier

      if (totalCost > buyingPower) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Insufficient buying power. Required: $${totalCost.toFixed(2)}, Available: $${buyingPower.toFixed(2)}`,
        });
      }

      // Check for duplicate orders (existing working orders for same symbols)
      const workingOrders = await api.getWorkingOrders(accountNumber);
      const workingSymbols = new Set(
        workingOrders
          .flatMap(order => order.legs.map(leg => leg.symbol))
      );

      const duplicates = input.leaps.filter(leap => {
        // Construct option symbol (e.g., AAPL  260116C00150000)
        const expDate = leap.expiration.replace(/-/g, "").slice(2); // YYMMDD
        const strikeStr = (leap.strike * 1000).toFixed(0).padStart(8, "0");
        const optionSymbol = `${leap.symbol.padEnd(6)}${expDate}C${strikeStr}`;
        return workingSymbols.has(optionSymbol);
      });

      if (duplicates.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Duplicate orders detected for: ${duplicates.map(d => d.symbol).join(", ")}. Cancel existing orders first.`,
        });
      }

      // Helper function to round price to correct increment based on tastytrade rules
      const roundToCorrectIncrement = (price: number, symbol: string): string => {
        // ETFs (SPY, QQQ, IWM) always use $0.01 increments
        const etfs = ['SPY', 'QQQ', 'IWM'];
        if (etfs.includes(symbol.toUpperCase())) {
          return price.toFixed(2);
        }
        
        // Standard options: <$3 = $0.05, ≥$3 = $0.10
        // (Penny Pilot: <$3 = $0.01, ≥$3 = $0.05, but we don't have the list)
        if (price < 3.00) {
          // Use $0.05 for standard options <$3
          return (Math.round(price / 0.05) * 0.05).toFixed(2);
        } else {
          // Use $0.10 for standard options ≥$3
          return (Math.round(price / 0.10) * 0.10).toFixed(2);
        }
      };

      // Submit orders (or dry run)
      const results = [];
      for (const leap of input.leaps) {
        try {
          // Construct option symbol (OCC format)
          const expDate = leap.expiration.replace(/-/g, "").slice(2); // YYMMDD
          const strikeStr = (leap.strike * 1000).toFixed(0).padStart(8, "0");
          const optionSymbol = `${leap.symbol.padEnd(6)}${expDate}C${strikeStr}`;

          const roundedPrice = roundToCorrectIncrement(leap.premium, leap.symbol);
          console.log(`[PMCC Order] Symbol: ${leap.symbol}, Original Premium: $${leap.premium.toFixed(2)}, Rounded Price: $${roundedPrice}`);
          
          const order = {
            accountNumber,
            timeInForce: "Day" as const,
            orderType: "Limit" as const,
            price: roundedPrice,
            priceEffect: "Debit" as const,
            legs: [
              {
                instrumentType: "Equity Option" as const,
                symbol: optionSymbol,
                quantity: "1",
                action: "Buy to Open" as const,
              },
            ],
          };

          if (input.isDryRun) {
            const dryRunResult = await api.dryRunOrder(order);
            results.push({
              symbol: leap.symbol,
              status: "dry_run_success",
              message: "Order validated successfully",
              orderId: null,
            });
          } else {
            const submittedOrder = await api.submitOrder(order);
            results.push({
              symbol: leap.symbol,
              status: "success",
              message: "Order submitted successfully",
              orderId: submittedOrder.id,
            });
          }
        } catch (error: any) {
          console.error(`[PMCC Order Error] Symbol: ${leap.symbol}`, error.response?.data || error.message);
          results.push({
            symbol: leap.symbol,
            status: "failed",
            message: error.response?.data?.error?.message || error.message || "Order submission failed",
            orderId: null,
          });
        }
      }

      const successCount = results.filter(r => r.status === "success" || r.status === "dry_run_success").length;
      const failCount = results.filter(r => r.status === "failed").length;

      return {
        results,
        summary: {
          total: input.leaps.length,
          success: successCount,
          failed: failCount,
          isDryRun: input.isDryRun,
        },
      };
    }),

  /**
   * Explain PMCC LEAP score using AI
   */
  explainScore: protectedProcedure
    .input(
      z.object({
        leap: z.object({
          symbol: z.string(),
          strike: z.number(),
          currentPrice: z.number(),
          expiration: z.string(),
          dte: z.number(),
          premium: z.number(),
          bid: z.number(),
          ask: z.number(),
          bidAskSpread: z.number(),
          bidAskSpreadPercent: z.number(),
          delta: z.number(),
          gamma: z.number().nullable(),
          theta: z.number().nullable(),
          vega: z.number().nullable(),
          iv: z.number().nullable(),
          openInterest: z.number(),
          volume: z.number(),
          rsi: z.number().nullable(),
          ivRank: z.number().nullable(),
          bbPercent: z.number().nullable(),
          score: z.number(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { calculatePMCCScore, explainPMCCScore } = await import('./pmcc-scoring');
      const { invokeLLM } = await import('./_core/llm');

      // Recalculate score to get breakdown
      const { score, breakdown } = calculatePMCCScore(input.leap);

      // Generate detailed explanation using scoring breakdown
      const technicalExplanation = explainPMCCScore(input.leap, breakdown);

      // Use AI to provide conversational explanation with company context
      const response = await invokeLLM({
        messages: [
          {
            role: 'system',
            content: `You are an expert options trader explaining PMCC (Poor Man's Covered Call) LEAP scores. Provide clear, actionable insights about why a LEAP received its score and whether it's a good buy. Be concise but thorough. Always start with a brief company overview to help newer traders understand what the ticker represents.`,
          },
          {
            role: 'user',
            content: `Explain this PMCC LEAP score for ${input.leap.symbol} in a conversational way:\n\n${technicalExplanation}\n\nProvide:\n1. Company Overview: Brief description of what ${input.leap.symbol} is (company name, sector, what they do) - keep this to 1-2 sentences for newer traders\n2. Overall assessment (Is this a good LEAP to buy?)\n3. Key strengths\n4. Key concerns (if any)\n5. Recommendation (Buy, Pass, or Monitor)`,
          },
        ],
      });

      const aiExplanation = response.choices[0]?.message?.content || 'Unable to generate explanation';

      return {
        score,
        breakdown,
        technicalExplanation,
        aiExplanation,
      };
    }),
});

/**
 * Calculate score for a LEAP option based on quality criteria
 * Advanced multi-factor scoring system (100 points total):
 * - Liquidity & Execution (30 pts): OI, Volume, Spread
 * - Value & Efficiency (35 pts): Extrinsic %, Cost/Delta, IV Quality
 * - Risk Management (25 pts): Delta, Theta, DTE
 * - Stock Quality (10 pts): Price trend, MA position
 */
function calculateLeapScore(
  option: any,
  currentPrice: number,
  preset: any
): number {
  let score = 0;

  // === LIQUIDITY & EXECUTION (30 points) ===
  
  // Open Interest (15 points)
  const oi = option.open_interest || 0;
  if (oi >= 1000) {
    score += 15;
  } else if (oi >= 500) {
    score += 10;
  } else if (oi >= 100) {
    score += 5;
  } else if (oi >= 50) {
    score += 2;
  }
  // else 0 points

  // Volume (10 points)
  const volume = option.volume || 0;
  if (volume >= 50) {
    score += 10;
  } else if (volume >= 20) {
    score += 7;
  } else if (volume >= 10) {
    score += 4;
  } else if (volume >= 5) {
    score += 2;
  }
  // else 0 points

  // Bid-Ask Spread % (5 points)
  const bid = option.bid || 0;
  const ask = option.ask || 0;
  const spreadPercent = ask > 0 ? ((ask - bid) / ask) * 100 : 100;
  if (spreadPercent < 1.0) {
    score += 5;
  } else if (spreadPercent < 2.0) {
    score += 3;
  } else if (spreadPercent < 5.0) {
    score += 1;
  }
  // else 0 points

  // === VALUE & EFFICIENCY (35 points) ===

  // Extrinsic Value % (15 points) - Lower is better for LEAPs
  const premium = (bid + ask) / 2;
  const intrinsicValue = Math.max(0, currentPrice - option.strike);
  const extrinsicValue = premium - intrinsicValue;
  const extrinsicPercent = premium > 0 ? (extrinsicValue / premium) * 100 : 100;
  
  if (extrinsicPercent < 15) {
    score += 15; // Excellent - mostly intrinsic value
  } else if (extrinsicPercent < 25) {
    score += 10; // Good
  } else if (extrinsicPercent < 35) {
    score += 5; // Acceptable
  } else if (extrinsicPercent < 45) {
    score += 2; // Poor
  }
  // else 0 points - too much time value

  // Cost per Delta (10 points) - Lower is better (capital efficiency)
  const delta = option.greeks?.delta || 0;
  const costPerDelta = delta > 0 ? (premium * 100) / delta : 999999; // premium in dollars per contract
  
  // Scale: excellent < 10000, good < 15000, acceptable < 20000
  if (costPerDelta < 10000) {
    score += 10;
  } else if (costPerDelta < 15000) {
    score += 7;
  } else if (costPerDelta < 20000) {
    score += 4;
  } else if (costPerDelta < 30000) {
    score += 2;
  }
  // else 0 points

  // IV Quality (10 points) - Compare mid_iv to smv_vol
  const midIV = option.greeks?.mid_iv || 0;
  const smvVol = option.greeks?.smv_vol || midIV;
  
  if (smvVol > 0) {
    const ivRatio = midIV / smvVol;
    if (ivRatio < 0.9) {
      score += 10; // IV below smoothed vol - good value
    } else if (ivRatio < 1.0) {
      score += 7; // Slightly below - acceptable
    } else if (ivRatio < 1.1) {
      score += 4; // Slightly above - fair
    } else if (ivRatio < 1.2) {
      score += 2; // Above - expensive
    }
    // else 0 points - significantly overpriced
  } else {
    score += 5; // Neutral if no IV data
  }

  // === RISK MANAGEMENT (25 points) ===

  // Delta (10 points) - Prefer 0.75-0.85 for PMCC
  if (delta >= 0.75 && delta <= 0.85) {
    score += 10; // Ideal sweet spot
  } else if (delta >= 0.70 && delta < 0.75) {
    score += 7; // Acceptable
  } else if (delta > 0.85 && delta <= 0.90) {
    score += 7; // Acceptable
  } else if (delta >= 0.65 && delta < 0.70) {
    score += 3; // Marginal
  }
  // else 0 points

  // Theta (10 points) - Lower daily decay is better for LEAPs
  const theta = Math.abs(option.greeks?.theta || 0);
  if (theta < 0.05) {
    score += 10; // Excellent - very low decay
  } else if (theta < 0.10) {
    score += 7; // Good
  } else if (theta < 0.15) {
    score += 4; // Acceptable
  } else if (theta < 0.20) {
    score += 2; // High decay
  }
  // else 0 points - too much daily cost

  // DTE (5 points) - Prefer 330-390 days (11-13 months)
  const expiration = new Date(option.expiration);
  const today = new Date();
  const dte = Math.floor((expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (dte >= 330 && dte <= 390) {
    score += 5; // Ideal range
  } else if (dte >= 270 && dte <= 450) {
    score += 3; // Acceptable LEAP range
  } else if (dte >= 240 && dte < 270) {
    score += 1; // Short for LEAP
  }
  // else 0 points

  // === STOCK QUALITY (10 points) ===
  // TODO: Implement when we have stock technical data
  // For now, give 5 points as neutral baseline
  score += 5;

  return Math.max(0, Math.min(100, Math.round(score))); // Clamp to 0-100
}
