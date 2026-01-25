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
   * Uses parallel processing (5 concurrent workers) to scan multiple symbols simultaneously
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
      const watchlist = await getWatchlist(ctx.user.id, "pmcc");
      if (watchlist.length === 0) {
        return { opportunities: [], message: "Watchlist is empty" };
      }

      const api = createTradierAPI(credentials.tradierApiKey);
      const symbols = watchlist.map((w) => w.symbol);

      console.log(`[PMCC] Scanning ${symbols.length} symbols for LEAP opportunities with ${input.presetName} preset`);

      // Parallel processing with 5 concurrent workers
      const CONCURRENT_WORKERS = 5;
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
 * Calculate LEAP opportunity score
 * Similar to CSP/CC scoring but optimized for LEAP buying criteria
 */
function calculateLeapScore(
  option: any,
  currentPrice: number,
  preset: any
): number {
  let score = 50; // Base score

  // Delta score (prefer deep ITM: 0.75-0.85)
  const delta = option.greeks?.delta || 0;
  if (delta >= 0.75 && delta <= 0.85) {
    score += 20; // Ideal delta range
  } else if (delta >= 0.70 && delta < 0.75) {
    score += 10; // Acceptable
  } else if (delta > 0.85 && delta <= 0.90) {
    score += 10; // Acceptable
  }

  // Open Interest score
  if (option.open_interest >= 100) {
    score += 15;
  } else if (option.open_interest >= 50) {
    score += 10;
  } else if (option.open_interest >= 20) {
    score += 5;
  }

  // Volume score
  if (option.volume >= 50) {
    score += 10;
  } else if (option.volume >= 20) {
    score += 5;
  }

  // Bid-Ask spread score (tighter is better)
  const bidAskSpreadPercent = ((option.ask - option.bid) / option.ask) * 100;
  if (bidAskSpreadPercent <= 2) {
    score += 10;
  } else if (bidAskSpreadPercent <= 5) {
    score += 5;
  } else if (bidAskSpreadPercent > 10) {
    score -= 10; // Penalize wide spreads
  }

  // Strike price relative to current price (prefer ITM but not too deep)
  const strikePercent = (option.strike / currentPrice) * 100;
  if (strikePercent >= 85 && strikePercent <= 95) {
    score += 10; // Ideal ITM range
  } else if (strikePercent >= 80 && strikePercent < 85) {
    score += 5; // Acceptable
  } else if (strikePercent < 75) {
    score -= 5; // Too deep ITM, expensive
  }

  return Math.max(0, Math.min(100, score)); // Clamp to 0-100
}
