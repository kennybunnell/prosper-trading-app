/**
 * PMCC (Poor Man's Covered Call) Router
 * Handles LEAP scanning, purchase, and short call selling against LEAPs
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { withRateLimit } from './tradierRateLimiter';

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
  // New criteria fields
  earningsDate: string | null;       // Next earnings date (YYYY-MM-DD)
  daysToEarnings: number | null;     // Days until next earnings
  earningsWarning: boolean;          // true if earnings within 30 days
  extrinsicValue: number;            // Extrinsic (time) value of the LEAP
  extrinsicPercent: number;          // Extrinsic as % of total premium
  extrinsicWarning: boolean;         // true if extrinsic > 20% of premium
  shortCallStrikeMin: number;        // Minimum valid short call strike (must be > LEAP strike)
  monthsToRecover: number | null;    // Estimated months to recover LEAP cost via short calls
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
      const { getEffectiveTier: _getETpmcc } = await import('./middleware/subscriptionEnforcement');
      const _effTierPMCC = _getETpmcc(ctx.user);

      // Check rate limit (VIP users treated as advanced, bypass free_trial limits)
      const rateLimit = await checkRateLimit(ctx.user.id, _effTierPMCC, ctx.user.role);
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
      const isFreeTrialUser = _effTierPMCC === 'free_trial';
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

      // Fetch earnings calendar for all symbols upfront (batch call)
      let earningsMap = new Map<string, string>();
      try {
        earningsMap = await api.getEarningsCalendar(symbols);
        console.log(`[PMCC] Fetched earnings dates for ${earningsMap.size} symbols`);
      } catch (e) {
        console.warn('[PMCC] Could not fetch earnings calendar, skipping earnings check');
      }

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

            // Scan each LEAP expiration for deep ITM call opportunities — all in parallel
            const symbolOpportunities: LeapOpportunity[] = [];

            await Promise.allSettled(leapExpirations.map(async (expiration) => {
              const chain = await withRateLimit(() => api.getOptionChain(symbol, expiration));
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
                    
                    // --- Earnings avoidance ---
                    const earningsDateStr = earningsMap.get(symbol) || null;
                    const daysToEarnings = earningsDateStr
                      ? Math.ceil((new Date(earningsDateStr).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                      : null;
                    const earningsWarning = daysToEarnings !== null && daysToEarnings >= 0 && daysToEarnings <= 30;

                    // --- Extrinsic value check ---
                    const mid = (call.bid + call.ask) / 2;
                    const intrinsic = Math.max(0, currentPrice - call.strike);
                    const extrinsicValue = Math.max(0, mid - intrinsic);
                    const extrinsicPercent = mid > 0 ? (extrinsicValue / mid) * 100 : 0;
                    const extrinsicWarning = extrinsicPercent > 20;

                    // --- Short call strike rule ---
                    // Short call strike must ALWAYS be above LEAP strike
                    const shortCallStrikeMin = call.strike + 0.50; // At least $0.50 above LEAP strike

                    // --- Months to recover estimate ---
                    // Estimate based on typical short call premium at 30 DTE, 0.30 delta
                    // Rough estimate: ~1.5% of stock price per month in short call premium
                    const estimatedMonthlyPremium = currentPrice * 0.015;
                    const monthsToRecover = estimatedMonthlyPremium > 0
                      ? Math.ceil(mid / estimatedMonthlyPremium)
                      : null;

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
                      // New criteria fields
                      earningsDate: earningsDateStr,
                      daysToEarnings,
                      earningsWarning,
                      extrinsicValue,
                      extrinsicPercent,
                      extrinsicWarning,
                      shortCallStrikeMin,
                      monthsToRecover,
                    };
                    
                    // Calculate score using new PMCC scoring system
                    const { score } = calculatePMCCScore(leapOpp);
                    leapOpp.score = score;

                    // Add to opportunities
                    symbolOpportunities.push(leapOpp);
                  }
                }
              }
            })); // end Promise.allSettled over leapExpirations

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
      await incrementScanCount(ctx.user.id, _effTierPMCC, ctx.user.role);

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
      const { createTradierAPI } = await import("./tradier");

      // Read LEAP positions from DB cache — no live Tastytrade API call needed
      const { getCachedPositions } = await import('./portfolio-sync');
      const cachedPos = await getCachedPositions(ctx.user.id);

      const now = new Date();
      // Filter for LEAP calls (long call options with 270+ DTE)
      const leapPositions = cachedPos.filter(pos => {
        if (pos.instrumentType !== 'Equity Option') return false;
        if (pos.quantityDirection !== 'Long') return false;
        if (pos.optionType !== 'C') return false;
        if (!pos.expiresAt) return false;
        const expiration = new Date(pos.expiresAt);
        const dte = Math.floor((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return dte >= 270;
      });

      if (leapPositions.length === 0) return { positions: [] };

      // Enrich with live market data from Tastytrade (current prices — this IS needed live)
      const credentials = await getApiCredentials(ctx.user.id);
      const { authenticateTastytrade } = await import('./tastytrade');
      const ttApi = credentials ? await authenticateTastytrade(credentials, ctx.user.id) : null;

      // Fetch all LEAP option quotes in one batch call via Tastytrade /market-data/by-type
      const leapSymbols = leapPositions.map(p => p.symbol).filter(Boolean) as string[];
      const leapQuoteMap = ttApi ? await ttApi.getOptionQuotesBatch(leapSymbols).catch(() => ({})) : {};

      // Fetch underlying stock prices in batch via Tastytrade
      const underlyingSet = new Set(leapPositions.map(p => p.underlyingSymbol).filter(Boolean) as string[]);
      const underlyingSymbols = Array.from(underlyingSet);
      const underlyingPriceMap: Record<string, number> = {};
      if (ttApi && underlyingSymbols.length > 0) {
        try {
          const stockQuotes = await ttApi.getUnderlyingQuotesBatch(underlyingSymbols);
          for (const [sym, q] of Object.entries(stockQuotes) as [string, any][]) {
            underlyingPriceMap[sym] = q.mark || q.last || 0;
          }
        } catch { /* non-fatal */ }
      }

      const enrichedPositions = await Promise.all(
        leapPositions.map(async (pos) => {
          try {
            const underlying = pos.underlyingSymbol;
            const strike = parseFloat(pos.strikePrice || '0');
            const expiration = new Date(pos.expiresAt!);
            const dte = Math.floor((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const qty = parseFloat(pos.quantity);

            // Get live LEAP option price from Tastytrade batch quote map
            const liveQ = (leapQuoteMap as any)[pos.symbol];
            const liveOptionMark = liveQ ? (liveQ.mark || liveQ.mid || ((liveQ.bid + liveQ.ask) / 2) || liveQ.last || 0) : 0;
            // Fall back to close-price only if Tastytrade returns no live quote
            const currentPrice = liveOptionMark > 0 ? liveOptionMark : parseFloat(pos.closePrice || '0');
            const stockPrice = underlyingPriceMap[underlying] || 0;

            const costBasis = Math.abs(parseFloat(pos.averageOpenPrice)) * 100 * qty;
            const currentValue = currentPrice * 100 * qty;
            const profitLoss = currentValue - costBasis;
            const profitLossPercent = costBasis !== 0 ? (profitLoss / costBasis) * 100 : 0;

            return {
              symbol: underlying,
              optionSymbol: pos.symbol,
              strike,
              expiration: pos.expiresAt!,
              dte,
              quantity: qty,
              costBasis,
              currentValue,
              profitLoss,
              profitLossPercent,
              currentPrice,
              stockPrice,
              delta: 0.80,
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
      const api = await authenticateTastytrade(credentials, ctx.user.id);

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

      // ── EARNINGS BLOCK PRE-FLIGHT ──────────────────────────────────────────
      {
        const { TradierAPI } = await import('./tradier');
        const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const tradierAPI = new TradierAPI(tradierKey);
          const symbols = Array.from(new Set(input.leaps.map(l => l.symbol)));
          const earningsResult = await checkEarningsBlock(symbols, tradierAPI);
          if (earningsResult.blocked.length > 0) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: formatEarningsBlockMessage(earningsResult),
            });
          }
          if (earningsResult.warned.length > 0) {
            console.warn('[EarningsBlock] PMCC earnings warning:', earningsResult.warned);
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

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
          // New criteria fields (optional for backward compat)
          earningsDate: z.string().nullable().optional(),
          daysToEarnings: z.number().nullable().optional(),
          earningsWarning: z.boolean().optional(),
          extrinsicValue: z.number().optional(),
          extrinsicPercent: z.number().optional(),
          extrinsicWarning: z.boolean().optional(),
          shortCallStrikeMin: z.number().optional(),
          monthsToRecover: z.number().nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { calculatePMCCScore, explainPMCCScore } = await import('./pmcc-scoring');
      const { invokeLLM } = await import('./_core/llm');
      const { getSymbolContext } = await import('./ai-context');

      // Fetch full portfolio context for this symbol
      const symbolCtx = await getSymbolContext(ctx.user.id, input.leap.symbol, input.leap.currentPrice);

      // Recalculate score to get breakdown
      // Provide defaults for new criteria fields (optional in Zod schema for backward compat)
      const leapWithDefaults = {
        ...input.leap,
        earningsDate: input.leap.earningsDate ?? null,
        daysToEarnings: input.leap.daysToEarnings ?? null,
        earningsWarning: input.leap.earningsWarning ?? false,
        extrinsicValue: input.leap.extrinsicValue ?? 0,
        extrinsicPercent: input.leap.extrinsicPercent ?? 0,
        extrinsicWarning: input.leap.extrinsicWarning ?? false,
        shortCallStrikeMin: input.leap.shortCallStrikeMin ?? (input.leap.strike + 0.50),
        monthsToRecover: input.leap.monthsToRecover ?? null,
      };
      const { score, breakdown } = calculatePMCCScore(leapWithDefaults);

      // Generate detailed explanation using scoring breakdown
      const technicalExplanation = explainPMCCScore(leapWithDefaults, breakdown);

      // Use AI to provide conversational explanation with company context and portfolio history
      const response = await invokeLLM({
        messages: [
          {
            role: 'system',
            content: `You are an expert options trader explaining PMCC (Poor Man's Covered Call) LEAP scores. Provide clear, actionable insights about why a LEAP received its score and whether it's a good buy. Be concise but thorough. Always start with a brief company overview to help newer traders understand what the ticker represents.

IMPORTANT: You have access to the trader's FULL PORTFOLIO HISTORY for this symbol. Use it — reference the actual cost basis, effective cost basis after premiums collected, total income history, and whether the trader has traded this symbol before. Provide insights the trader cannot easily compute themselves.

${symbolCtx.contextBlock}`,
          },
          {
            role: 'user',
            content: `Explain this PMCC LEAP score for ${input.leap.symbol} in a conversational way:\n\n${technicalExplanation}\n\nProvide:\n1. Company Overview: Brief description of what ${input.leap.symbol} is (company name, sector, what they do) - keep this to 1-2 sentences for newer traders\n2. Portfolio History: Reference the actual cost basis and premium income history from the context above\n3. Overall assessment (Is this a good LEAP to buy given the full history?)\n4. Key strengths\n5. Key concerns (if any)\n6. Recommendation (Buy, Pass, or Monitor)`,
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

  /**
   * Scan short call opportunities for selected LEAP positions
   * Validates that short call strikes are above LEAP strikes
   */
  scanShortCallOpportunities: protectedProcedure
    .input(
      z.object({
        leapPositions: z.array(
          z.object({
            symbol: z.string(), // Underlying symbol (e.g., "AVGO")
            optionSymbol: z.string(), // LEAP option symbol
            strike: z.number(), // LEAP strike price
            expiration: z.string(), // LEAP expiration
            quantity: z.number(), // Number of LEAPs owned
          })
        ),
        minDte: z.number().default(7),
        maxDte: z.number().default(45),
        minDelta: z.number().default(0.15),
        maxDelta: z.number().default(0.35),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import("./db");
      const { createTradierAPI } = await import("./tradier");
      const { checkRateLimit } = await import('./middleware/rateLimiting');
      const { getEffectiveTier: _getETsc } = await import('./middleware/subscriptionEnforcement');
      const _effTierSC = _getETsc(ctx.user);

      // Check rate limit
      const rateLimit = await checkRateLimit(ctx.user.id, _effTierSC, ctx.user.role);
      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: rateLimit.message || 'Rate limit exceeded',
        });
      }

      // Get API credentials
      const credentials = await getApiCredentials(ctx.user.id);
      const isFreeTrialUser = _effTierSC === 'free_trial';
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

      const api = createTradierAPI(tradierApiKey);
      const allOpportunities: any[] = [];

      console.log(`[PMCC Short Call Scanner] Scanning ${input.leapPositions.length} LEAP positions...`);

      // Process each LEAP position
      for (const leap of input.leapPositions) {
        console.log(`[PMCC Short Call Scanner] Processing ${leap.symbol} LEAP (strike: $${leap.strike}, exp: ${leap.expiration})`);

        try {
          // Get current stock price
          const quote = await api.getQuote(leap.symbol);
          const currentPrice = quote.last || quote.close || 0;

          // Get expirations
          const expirations = await api.getExpirations(leap.symbol);
          
          // Filter expirations based on DTE
          const now = new Date();
          const validExpirations = expirations.filter((exp: string) => {
            const expDate = new Date(exp);
            const dte = Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            return dte >= input.minDte && dte <= input.maxDte;
          });

          console.log(`[PMCC Short Call Scanner] ${leap.symbol}: Found ${validExpirations.length} valid expirations (${input.minDte}-${input.maxDte} DTE)`);

          // Get option chains for each expiration — rate-limited to avoid Tradier throttling
          const shortCallChains = await Promise.allSettled(
            validExpirations.map(exp => withRateLimit(() => api.getOptionChain(leap.symbol, exp, true)))
          );
          for (let _ei = 0; _ei < validExpirations.length; _ei++) {
            const expiration = validExpirations[_ei];
            const chainResult = shortCallChains[_ei];
            if (chainResult.status === 'rejected') continue;
            const chain = chainResult.value;
            
            if (!chain || !Array.isArray(chain)) {
              continue;
            }

            const options = chain;

            // Filter for calls only
            const calls = options.filter((opt: any) => opt.option_type === 'call');

            // Filter for strikes ABOVE the LEAP strike (critical validation)
            const validCalls = calls.filter((opt: any) => {
              const strike = parseFloat(opt.strike);
              return strike > leap.strike;
            });

            console.log(`[PMCC Short Call Scanner] ${leap.symbol} ${expiration}: ${validCalls.length}/${calls.length} calls above LEAP strike $${leap.strike}`);

            // Process each valid call option
            for (const opt of validCalls) {
              const strike = parseFloat(String(opt.strike));
              const bid = parseFloat(String(opt.bid || '0'));
              const ask = parseFloat(String(opt.ask || '0'));
              const delta = Math.abs(parseFloat(String(opt.greeks?.delta || '0')));

              // Filter by delta
              if (delta < input.minDelta || delta > input.maxDelta) {
                continue;
              }

              const premium = bid; // Premium we'll receive for selling
              const bidAskSpread = ask - bid;
              const bidAskSpreadPercent = ask > 0 ? (bidAskSpread / ask) * 100 : 0;

              // Calculate DTE
              const expDate = new Date(expiration);
              const dte = Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

              // Calculate ROC (return on collateral)
              // For PMCC, collateral is the LEAP value, but we'll use a simplified metric
              // ROC = (premium / (strike - leap.strike)) * 100
              const spreadWidth = strike - leap.strike;
              const roc = spreadWidth > 0 ? (premium * 100 / spreadWidth) : 0;

              // Basic scoring (0-100)
              let score = 50; // Base score

              // Premium component (0-25 points)
              if (premium >= 5) score += 25;
              else if (premium >= 3) score += 20;
              else if (premium >= 2) score += 15;
              else if (premium >= 1) score += 10;
              else if (premium >= 0.5) score += 5;

              // Delta component (0-20 points) - prefer 0.20-0.30
              if (delta >= 0.20 && delta <= 0.30) score += 20;
              else if (delta >= 0.15 && delta <= 0.35) score += 15;
              else if (delta >= 0.10 && delta <= 0.40) score += 10;
              else score += 5;

              // DTE component (0-15 points) - prefer 30-45 days
              if (dte >= 30 && dte <= 45) score += 15;
              else if (dte >= 21 && dte <= 60) score += 10;
              else score += 5;

              // Bid-ask spread component (0-15 points)
              if (bidAskSpreadPercent <= 5) score += 15;
              else if (bidAskSpreadPercent <= 10) score += 10;
              else if (bidAskSpreadPercent <= 20) score += 5;

              // ROC component (0-15 points)
              if (roc >= 10) score += 15;
              else if (roc >= 5) score += 10;
              else if (roc >= 2) score += 5;

              // Open Interest component (0-15 points, -10 penalty for OI=0)
              const oi = parseInt(String(opt.open_interest || '0'));
              if (oi >= 500) score += 15;
              else if (oi >= 200) score += 12;
              else if (oi >= 100) score += 9;
              else if (oi >= 50) score += 6;
              else if (oi >= 10) score += 3;
              else if (oi === 0) score -= 10; // Hard penalty: OI=0 contracts rarely fill

              allOpportunities.push({
                leapSymbol: leap.optionSymbol,
                leapStrike: leap.strike,
                leapExpiration: leap.expiration,
                underlyingSymbol: leap.symbol,
                currentPrice,
                strike,
                expiration,
                dte,
                premium,
                bid,
                ask,
                bidAskSpread,
                bidAskSpreadPercent,
                delta,
                gamma: parseFloat(String(opt.greeks?.gamma || '0')),
                theta: parseFloat(String(opt.greeks?.theta || '0')),
                vega: parseFloat(String(opt.greeks?.vega || '0')),
                iv: parseFloat(String(opt.greeks?.mid_iv || '0')),
                openInterest: oi,
                volume: parseInt(String(opt.volume || '0')),
                roc,
                score,
                optionSymbol: opt.symbol,
                maxContracts: leap.quantity, // Can sell 1 call per LEAP owned
              });
            }
          }
        } catch (error: any) {
          console.error(`[PMCC Short Call Scanner] Error processing ${leap.symbol}:`, error.message);
        }
      }

      // Sort by score descending
      allOpportunities.sort((a, b) => b.score - a.score);

      console.log(`[PMCC Short Call Scanner] Found ${allOpportunities.length} total short call opportunities`);

      return {
        opportunities: allOpportunities,
        scannedLeaps: input.leapPositions.length,
      };
    }),

  /**
   * Get PMCC profitability metrics for a specific LEAP
   * MVP: Returns placeholder data. Full implementation pending transaction history API.
   */
  getPMCCProfitability: protectedProcedure
    .input(
      z.object({
        leapSymbol: z.string(),
        underlyingSymbol: z.string(),
        leapCost: z.number(),
        currentLeapValue: z.number(),
      })
    )
    .query(async ({ input }) => {
      // MVP: Calculate basic metrics from provided data
      // TODO: Fetch transaction history to track actual premiums collected
      const totalPremiumsCollected = 0;
      const shortCallHistory: any[] = [];

      const leapGain = input.currentLeapValue - input.leapCost;
      const paybackPercent = input.leapCost > 0 ? (totalPremiumsCollected / input.leapCost) * 100 : 0;
      const totalProfitLoss = leapGain + totalPremiumsCollected;
      const roi = input.leapCost > 0 ? (totalProfitLoss / input.leapCost) * 100 : 0;

      return {
        leapSymbol: input.leapSymbol,
        underlyingSymbol: input.underlyingSymbol,
        leapCost: input.leapCost,
        currentLeapValue: input.currentLeapValue,
        leapGain,
        leapGainPercent: input.leapCost > 0 ? (leapGain / input.leapCost) * 100 : 0,
        premiumsCollected: totalPremiumsCollected,
        paybackPercent,
        remainingToBreakEven: Math.max(0, input.leapCost - totalPremiumsCollected),
        totalProfitLoss,
        roi,
        shortCallHistory,
        note: 'Premium tracking will be implemented when transaction history API is available',
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

