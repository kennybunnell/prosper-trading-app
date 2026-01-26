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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import("./db");
      const { getFilterPresetsByStrategy, seedPmccFilterPresets } = await import("./db-filter-presets");
      const { createTradierAPI } = await import("./tradier");
      const { getWatchlist } = await import("./db");

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
      if (!credentials?.tradierApiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tradier API key not configured",
        });
      }

      // Get PMCC watchlist
      const watchlist = await getWatchlist(ctx.user.id);
      if (watchlist.length === 0) {
        return { opportunities: [], message: "Watchlist is empty" };
      }

      const api = createTradierAPI(credentials.tradierApiKey);
      const symbols = watchlist.map((w) => w.symbol);

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

                    // Calculate opportunity score (similar to CSP/CC scoring)
                    const score = calculateLeapScore(call, currentPrice, preset);

                    symbolOpportunities.push({
                      symbol,
                      strike: call.strike,
                      currentPrice,
                      expiration,
                      dte,
                      premium: (call.bid + call.ask) / 2, // Mid price for buying
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
                      rsi: null, // TODO: Fetch RSI from technical indicators
                      ivRank: null, // TODO: Fetch IV Rank
                      bbPercent: null, // TODO: Fetch Bollinger Band %
                      score,
                    });
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

      return {
        opportunities: allOpportunities,
        message: `Found ${allOpportunities.length} LEAP opportunities`,
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
