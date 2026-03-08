/**
 * Enhanced Strategy Advisor Router
 * Analyzes individual watchlist tickers with IV, 52-week range, momentum, and historical performance
 * Provides ranked recommendations with specific strike suggestions
 */

import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { z } from "zod";

interface StrategyFit {
  strategy: 'BPS' | 'BCS' | 'IC';
  score: number;
  label: string;
}

interface TickerAnalysis {
  symbol: string;
  isIndex: boolean; // true for SPXW, NDX, RUT, MRUT, NDXP etc.
  score: number; // Score for the recommended strategy
  currentPrice: number;
  change24h: number;
  yearHigh: number;
  yearLow: number;
  yearPosition: number; // % position in 52-week range
  ivRank: number | null;
  momentum: 'Strong Uptrend' | 'Moderate Uptrend' | 'Sideways' | 'Moderate Downtrend' | 'Strong Downtrend';
  historicalWinRate: number | null;
  historicalAvgPL: number | null;
  historicalTradeCount: number;
  recommendedStrikes: {
    shortStrike: number;
    longStrike: number;
    expectedPremium: number;
    probabilityOfProfit: number;
  } | null;
  reasoning: string;
  fitScore: {
    momentum: number;
    iv: number;
    historical: number;
    technical: number;
  };
  strategyBadges: StrategyFit[]; // All strategies this ticker is good for
}

export const strategyAdvisorRouter = router({
  /**
   * Get enhanced market analysis with ranked watchlist recommendations
   * Analyzes each ticker individually and scores them for the recommended strategy
   */
  getRecommendation: protectedProcedure
    .input(z.object({
      /** 'equity' = equities only, 'index' = indexes only, 'all' = everything (legacy) */
      scanType: z.enum(['equity', 'index', 'all']).default('all'),
    }).optional())
    .query(async ({ ctx, input }) => {
    const scanType = input?.scanType ?? 'all';
    const { getTastytradeAPI } = await import('./tastytrade');
    const { getApiCredentials } = await import('./db');

    try {
      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
        return {
          error: 'Tastytrade credentials not configured. Please add them in Settings.',
          marketData: null,
          recommendation: null,
          rankedTickers: [],
        };
      }

      // Initialize API and login
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // Fetch user's watchlist
      const { getWatchlist } = await import('./db');
      const { isIndexSymbol } = await import('../shared/index-symbols');
      const fullWatchlist = await getWatchlist(ctx.user.id);

      // Filter by scanType: use the DB isIndex flag, falling back to symbol detection
      const filteredWatchlist = fullWatchlist.filter((w: any) => {
        const isIdx = w.isIndex === true || w.isIndex === 1 || isIndexSymbol(w.symbol);
        if (scanType === 'index') return isIdx;
        if (scanType === 'equity') return !isIdx;
        return true; // 'all'
      });

      // Deduplicate by symbol (keep first occurrence) to prevent duplicate ticker analysis
      const seenSymbols = new Set<string>();
      const dedupedWatchlist = filteredWatchlist.filter((w: any) => {
        if (seenSymbols.has(w.symbol)) return false;
        seenSymbols.add(w.symbol);
        return true;
      });
      const watchlistSymbols = dedupedWatchlist.map((w: any) => w.symbol);

      if (watchlistSymbols.length === 0) {
        const emptyMsg = scanType === 'index'
          ? 'No index symbols in watchlist. Add SPXW, NDX, RUT, or other indexes first.'
          : scanType === 'equity'
          ? 'No equity symbols in watchlist. Add individual stocks first.'
          : 'No tickers in watchlist. Please add tickers in Settings.';
        return {
          error: emptyMsg,
          marketData: null,
          recommendation: null,
          rankedTickers: [],
          scanType,
        };
      }

      // Fetch historical performance data from Spread Analytics
      const { spreadAnalyticsRouter } = await import('./routers-spread-analytics');
      const caller = spreadAnalyticsRouter.createCaller(ctx);
      
      // Get last 12 months of historical data
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      let strategyMetrics: any[] = [];
      let symbolMetrics: any[] = [];
      try {
        [strategyMetrics, symbolMetrics] = await Promise.all([
          caller.getStrategyMetrics({ startDate, endDate }),
          caller.getSymbolMetrics({ startDate, endDate }),
        ]);
        console.log(`[Strategy Advisor] Loaded historical data: ${strategyMetrics.length} strategies, ${symbolMetrics.length} symbols`);
      } catch (error: any) {
        console.warn(`[Strategy Advisor] Failed to load historical data: ${error.message}`);
      }

      // Create historical performance lookup
      const historicalBySymbol = symbolMetrics.reduce((acc, sym) => {
        acc[sym.symbol] = {
          winRate: sym.winRate,
          avgPL: sym.totalProfitLoss / sym.totalPositions,
          tradeCount: sym.totalPositions,
          roc: sym.roc,
          bestStrategy: sym.bestStrategy,
        };
        return acc;
      }, {} as Record<string, any>);

      // Fetch market data for major indices (for overall market condition)
      const indexSymbols = ['SPY', 'QQQ', 'IWM', 'VIX'];
      const indexQuotes = await api.getUnderlyingQuotesBatch(indexSymbols);

      const marketDataPromises = indexSymbols.map(async (symbol) => {
        try {
          const response = await (api as any).client.get('/market-data/by-type', {
            params: { equity: symbol },
          });

          const item = response.data.data?.items?.[0];
          if (!item) return null;

          return {
            symbol,
            last: parseFloat(item.last || '0'),
            open: parseFloat(item.open || '0'),
            high: parseFloat(item['day-high-price'] || '0'),
            low: parseFloat(item['day-low-price'] || '0'),
            prevClose: parseFloat(item['prev-close'] || '0'),
            volume: parseFloat(item.volume || '0'),
            yearHigh: parseFloat(item['year-high-price'] || '0'),
            yearLow: parseFloat(item['year-low-price'] || '0'),
            change: item.last && item['prev-close'] 
              ? ((parseFloat(item.last) - parseFloat(item['prev-close'])) / parseFloat(item['prev-close'])) * 100 
              : 0,
          };
        } catch (error) {
          console.error(`Failed to fetch data for ${symbol}:`, error);
          return null;
        }
      });

      const marketDataArray = await Promise.all(marketDataPromises);
      const marketData = marketDataArray.filter(Boolean).reduce((acc, data) => {
        if (data) acc[data.symbol] = data;
        return acc;
      }, {} as Record<string, any>);

      // Determine overall market condition first
      const spy = marketData['SPY'];
      const vix = marketData['VIX'];
      
      let marketCondition: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
      let recommendedStrategy: 'BPS' | 'BCS' | 'IC' = 'IC';
      
      if (spy && vix) {
        const spyPosition = ((spy.last - spy.yearLow) / (spy.yearHigh - spy.yearLow)) * 100;
        
        if (spy.change > 0.5 && spyPosition > 60 && vix.last < 20) {
          marketCondition = 'Bullish';
          recommendedStrategy = 'BPS';
        } else if (spy.change < -0.5 && spyPosition < 40 && vix.last > 20) {
          marketCondition = 'Bearish';
          recommendedStrategy = 'BCS';
        } else {
          marketCondition = 'Neutral';
          recommendedStrategy = 'IC';
        }
      }

      // Check user's historical performance to adjust recommendation
      const bpsMetric = strategyMetrics.find(s => s.strategy === 'Bull Put Spread');
      const bcsMetric = strategyMetrics.find(s => s.strategy === 'Bear Call Spread');
      const icMetric = strategyMetrics.find(s => s.strategy === 'Iron Condor');

      // If user has strong historical performance with a strategy, favor it
      if (bpsMetric && bpsMetric.winRate > 70 && bpsMetric.roc > 15) {
        recommendedStrategy = 'BPS';
      } else if (icMetric && icMetric.winRate > 65 && icMetric.roc > 12) {
        recommendedStrategy = 'IC';
      }

      console.log(`[Strategy Advisor] Market: ${marketCondition}, Recommended: ${recommendedStrategy}`);

      // Analyze each watchlist ticker individually
      // Pre-load index symbol checker once outside the loop
      const { isIndexSymbol: checkIsIndex } = await import('../shared/index-symbols');

      const tickerAnalysisPromises = watchlistSymbols.map(async (symbol): Promise<TickerAnalysis | null> => {
        const isIdxSymbol = checkIsIndex(symbol);
        try {
          // ─── Market data fetch ────────────────────────────────────────────────────
          // Index symbols (SPXW, NDXP, RUT, etc.) are NOT equities on Tastytrade's API.
          // They must be fetched via the index-specific endpoint, not the equity endpoint.
          // Using the equity endpoint for index symbols returns no data → null → ticker dropped.
          let item: any = null;
          try {
            if (isIdxSymbol) {
              // Try index endpoint first
              const idxResponse = await (api as any).client.get('/market-data/by-type', {
                params: { index: symbol },
              });
              item = idxResponse.data.data?.items?.[0];
              console.log(`[Strategy Advisor] ${symbol} index endpoint → item:`, item ? 'found' : 'null');

              // Fallback: some index options (SPXW, NDXP) are listed as equity options
              if (!item) {
                const eqResponse = await (api as any).client.get('/market-data/by-type', {
                  params: { equity: symbol },
                });
                item = eqResponse.data.data?.items?.[0];
                console.log(`[Strategy Advisor] ${symbol} equity fallback → item:`, item ? 'found' : 'null');
              }
            } else {
              const eqResponse = await (api as any).client.get('/market-data/by-type', {
                params: { equity: symbol },
              });
              item = eqResponse.data.data?.items?.[0];
            }
          } catch (fetchErr: any) {
            console.warn(`[Strategy Advisor] Market data fetch failed for ${symbol}:`, fetchErr.message);
          }

          // If we still have no price data, synthesize a minimal record so the ticker
          // still appears in the results (indexes always have liquid options regardless).
          // We'll use 0 for price-based fields and rely on IV/option data for scoring.
          let currentPrice = 0;
          let prevClose = 0;
          let yearHigh = 0;
          let yearLow = 0;
          let change24h = 0;
          let yearPosition = 50; // default to midpoint

          if (item) {
            currentPrice = parseFloat(item.last || item.close || '0');
            prevClose = parseFloat(item['prev-close'] || item.close || '0');
            yearHigh = parseFloat(item['year-high-price'] || '0');
            yearLow = parseFloat(item['year-low-price'] || '0');
            change24h = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
            yearPosition = yearHigh > yearLow ? ((currentPrice - yearLow) / (yearHigh - yearLow)) * 100 : 50;
          } else if (!isIdxSymbol) {
            // For equities with no data, skip entirely
            console.warn(`[Strategy Advisor] No market data for equity ${symbol}, skipping`);
            return null;
          } else {
            console.warn(`[Strategy Advisor] No market data for index ${symbol}, proceeding with option-chain-only scoring`);
          }

          // Fetch option chain to get IV data using Tradier API
          let ivRank: number | null = null;
          let recommendedStrikes: TickerAnalysis['recommendedStrikes'] = null;

          try {
            // Get Tradier API credentials
            const { getApiCredentials } = await import('./db');
            const { createTradierAPI } = await import('./tradier');
            const credentials = await getApiCredentials(ctx.user.id);
            if (!credentials?.tradierApiKey) {
              throw new Error('Tradier API key not configured');
            }
            const tradierApi = createTradierAPI(credentials.tradierApiKey, false); // Use production API

            // Get nearest expiration
            // Equities: 7–21 DTE (weekly/bi-weekly)
            // Indexes (SPXW, NDXP): 7–45 DTE — wider window because weekly expirations
            //   may not always fall in the 7–21 range depending on the day of the week.
            const expirations = await tradierApi.getExpirations(symbol);
            const today = new Date();
            const minDte = 7;
            const maxDte = isIdxSymbol ? 45 : 21;
            const idealDte = isIdxSymbol ? 14 : 10;

            console.log(`[Strategy Advisor] ${symbol} expirations available:`, expirations?.slice(0, 5));

            const nearestExp = expirations
              .map((exp: string) => ({ date: exp, dte: (new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24) }))
              .filter((exp: any) => exp.dte >= minDte && exp.dte <= maxDte)
              .sort((a: any, b: any) => Math.abs(a.dte - idealDte) - Math.abs(b.dte - idealDte))[0];

            console.log(`[Strategy Advisor] ${symbol} selected expiration:`, nearestExp);

            if (nearestExp) {
              const chain = await tradierApi.getOptionChain(symbol, nearestExp.date, true);
              console.log(`[Strategy Advisor] ${symbol} chain length:`, chain?.length ?? 0);

              // ─── IV Rank calculation ───────────────────────────────────────────────
              // The old formula computed (avgIV - minIV) / (maxIV - minIV) across all
              // strikes in ONE expiry. For indexes this produces near-zero because all
              // strikes in one expiry have very similar IV. Instead we use the ATM IV
              // as a proxy for the current IV level and compare it to well-known
              // typical ranges per instrument type.
              const allIVs = chain
                .filter((opt: any) => opt.greeks?.mid_iv && opt.greeks.mid_iv > 0)
                .map((opt: any) => opt.greeks!.mid_iv! as number);

              if (allIVs.length > 0) {
                // Use the median IV across the chain as the representative current IV.
                const sorted = [...allIVs].sort((a, b) => a - b);
                const medianIV = sorted[Math.floor(sorted.length / 2)];
                const annualizedIV = medianIV * 100; // mid_iv is in decimal (0.15 = 15%)

                if (isIdxSymbol) {
                  // SPXW / NDXP / MRUT typical IV range: 10%–40% annualized
                  // Map: <10% → 0, 10% → 10, 20% → 40, 30% → 70, 40%+ → 100
                  ivRank = Math.min(100, Math.round(Math.max(0, (annualizedIV - 10) / 30) * 100));
                } else {
                  // Equities typical IV range: 15%–80% annualized
                  ivRank = Math.min(100, Math.round(Math.max(0, (annualizedIV - 15) / 65) * 100));
                }
                console.log(`[Strategy Advisor] ${symbol} medianIV=${annualizedIV.toFixed(1)}% → ivRank=${ivRank}`);
              }

              // ─── Strike recommendations ────────────────────────────────────────────
              // For index tickers, always try all three strategies regardless of the
              // page-level recommendedStrategy. For equities, use the page-level strategy.
              const puts = chain.filter((opt: any) => opt.optionType === 'put');
              const calls = chain.filter((opt: any) => opt.optionType === 'call');
              const strikesToBuild = isIdxSymbol
                ? (['IC', 'BPS', 'BCS'] as const)
                : ([recommendedStrategy] as const);

              for (const strat of strikesToBuild) {
                if (recommendedStrikes) break; // use first successful build

                if (strat === 'BPS' && puts.length >= 2) {
                  const shortPut = puts.find((p: any) => Math.abs(p.greeks?.delta || 0) >= 0.20 && Math.abs(p.greeks?.delta || 0) <= 0.35);
                  const longPut = puts.find((p: any) =>
                    Math.abs(p.greeks?.delta || 0) >= 0.08 &&
                    Math.abs(p.greeks?.delta || 0) <= 0.22 &&
                    p.strike < (shortPut?.strike || 0)
                  );
                  if (shortPut && longPut) {
                    const premium = (shortPut.bid - longPut.ask) * 100;
                    const pop = 100 - Math.abs(shortPut.greeks?.delta || 0.30) * 100;
                    recommendedStrikes = { shortStrike: shortPut.strike, longStrike: longPut.strike, expectedPremium: premium, probabilityOfProfit: pop };
                  }
                } else if (strat === 'BCS' && calls.length >= 2) {
                  const shortCall = calls.find((c: any) => Math.abs(c.greeks?.delta || 0) >= 0.20 && Math.abs(c.greeks?.delta || 0) <= 0.35);
                  const longCall = calls.find((c: any) =>
                    Math.abs(c.greeks?.delta || 0) >= 0.08 &&
                    Math.abs(c.greeks?.delta || 0) <= 0.22 &&
                    c.strike > (shortCall?.strike || 0)
                  );
                  if (shortCall && longCall) {
                    const premium = (shortCall.bid - longCall.ask) * 100;
                    const pop = 100 - Math.abs(shortCall.greeks?.delta || 0.30) * 100;
                    recommendedStrikes = { shortStrike: shortCall.strike, longStrike: longCall.strike, expectedPremium: premium, probabilityOfProfit: pop };
                  }
                } else if (strat === 'IC' && puts.length >= 2 && calls.length >= 2) {
                  const shortPut = puts.find((p: any) => Math.abs(p.greeks?.delta || 0) >= 0.15 && Math.abs(p.greeks?.delta || 0) <= 0.30);
                  const longPut = puts.find((p: any) => p.strike < (shortPut?.strike || 0) && Math.abs(p.greeks?.delta || 0) <= 0.15);
                  const shortCall = calls.find((c: any) => Math.abs(c.greeks?.delta || 0) >= 0.15 && Math.abs(c.greeks?.delta || 0) <= 0.30);
                  const longCall = calls.find((c: any) => c.strike > (shortCall?.strike || 0) && Math.abs(c.greeks?.delta || 0) <= 0.15);
                  if (shortPut && longPut && shortCall && longCall) {
                    const putCredit = (shortPut.bid - longPut.ask) * 100;
                    const callCredit = (shortCall.bid - longCall.ask) * 100;
                    recommendedStrikes = { shortStrike: shortPut.strike, longStrike: longPut.strike, expectedPremium: putCredit + callCredit, probabilityOfProfit: 65 };
                  }
                }
              }
              console.log(`[Strategy Advisor] ${symbol} recommendedStrikes:`, recommendedStrikes ? 'built' : 'none');
            }
          } catch (error) {
            console.warn(`Failed to fetch option data for ${symbol}:`, error);
          }

          // Determine momentum
          let momentum: TickerAnalysis['momentum'] = 'Sideways';
          if (change24h > 2) momentum = 'Strong Uptrend';
          else if (change24h > 0.5) momentum = 'Moderate Uptrend';
          else if (change24h < -2) momentum = 'Strong Downtrend';
          else if (change24h < -0.5) momentum = 'Moderate Downtrend';

          // Get historical performance for this ticker
          const historical = historicalBySymbol[symbol];

          // isIdxSymbol was set at the top of this lambda from the pre-loaded checker
          const isIndexTicker = isIdxSymbol;

          // Helper function to calculate fit score for ANY strategy
          const calculateStrategyFit = (strategy: 'BPS' | 'BCS' | 'IC') => {
            const fitScore = {
              momentum: 0,
              iv: 0,
              historical: 0,
              technical: 0,
            };

            // Momentum score (30 points)
            // For indexes (SPXW, NDX, RUT) neutral/sideways is the ideal IC entry condition;
            // even trending markets are acceptable because the index mean-reverts faster.
            if (strategy === 'BPS') {
              if (momentum === 'Strong Uptrend' || momentum === 'Moderate Uptrend') fitScore.momentum = 30;
              else if (momentum === 'Sideways') fitScore.momentum = isIndexTicker ? 28 : 20;
              else fitScore.momentum = isIndexTicker ? 18 : 5; // indexes: downtrend still ok for BPS
            } else if (strategy === 'BCS') {
              if (momentum === 'Strong Downtrend' || momentum === 'Moderate Downtrend') fitScore.momentum = 30;
              else if (momentum === 'Sideways') fitScore.momentum = isIndexTicker ? 28 : 20;
              else fitScore.momentum = isIndexTicker ? 18 : 5;
            } else { // IC
              if (momentum === 'Sideways') fitScore.momentum = 30;
              else if (momentum === 'Moderate Uptrend' || momentum === 'Moderate Downtrend') fitScore.momentum = isIndexTicker ? 28 : 20;
              else fitScore.momentum = isIndexTicker ? 20 : 10; // indexes: strong trends still tradeable with IC
            }

            // IV score (25 points)
            // Index IV rank is structurally lower (15–35 typical) vs equities (30–80).
            // Recalibrate thresholds so SPXW at 15–25 IV rank still earns a fair score.
            if (ivRank !== null) {
              if (isIndexTicker) {
                // Index-calibrated IV thresholds
                if (ivRank >= 35) fitScore.iv = 25;       // Elevated index IV — excellent
                else if (ivRank >= 25) fitScore.iv = 22;  // Good
                else if (ivRank >= 15) fitScore.iv = 18;  // Fair — still tradeable for SPXW
                else if (ivRank >= 8) fitScore.iv = 12;   // Low but acceptable
                else fitScore.iv = 6;                     // Very low
              } else {
                // Original equity thresholds
                if (ivRank >= 60) fitScore.iv = 25;
                else if (ivRank >= 40) fitScore.iv = 20;
                else if (ivRank >= 25) fitScore.iv = 15;
                else fitScore.iv = 5;
              }
            } else {
              fitScore.iv = isIndexTicker ? 15 : 10; // Indexes get a higher neutral default
            }

            // Historical performance score (30 points)
            if (historical) {
              if (historical.winRate >= 75) fitScore.historical = 30;
              else if (historical.winRate >= 65) fitScore.historical = 25;
              else if (historical.winRate >= 55) fitScore.historical = 20;
              else if (historical.winRate >= 45) fitScore.historical = 15;
              else fitScore.historical = 5;
            } else {
              fitScore.historical = 15; // Neutral if no historical data
            }

            // Technical score (15 points) - 52-week position
            if (strategy === 'BPS') {
              if (yearPosition >= 60) fitScore.technical = 15;
              else if (yearPosition >= 40) fitScore.technical = 10;
              else fitScore.technical = 5;
            } else if (strategy === 'BCS') {
              if (yearPosition <= 40) fitScore.technical = 15;
              else if (yearPosition <= 60) fitScore.technical = 10;
              else fitScore.technical = 5;
            } else { // IC
              if (yearPosition >= 40 && yearPosition <= 60) fitScore.technical = 15;
              else if (yearPosition >= 30 && yearPosition <= 70) fitScore.technical = 10;
              else fitScore.technical = 5;
            }

            return {
              fitScore,
              totalScore: fitScore.momentum + fitScore.iv + fitScore.historical + fitScore.technical,
            };
          };

          // Calculate fit for ALL strategies
          const bpsFit = calculateStrategyFit('BPS');
          const bcsFit = calculateStrategyFit('BCS');
          const icFit = calculateStrategyFit('IC');

          // Use the recommended strategy's score as the main score
          const fitScore = recommendedStrategy === 'BPS' ? bpsFit.fitScore : 
                           recommendedStrategy === 'BCS' ? bcsFit.fitScore : 
                           icFit.fitScore;
          const totalScore = recommendedStrategy === 'BPS' ? bpsFit.totalScore : 
                             recommendedStrategy === 'BCS' ? bcsFit.totalScore : 
                             icFit.totalScore;

          // Generate strategy badges
          // Index symbols (SPXW, NDX, RUT): lower cutoff (40) because they always have
          // liquid options and are the primary instruments for spread strategies.
          // Equity symbols: keep the original 60 cutoff.
          const badgeCutoff = isIndexTicker ? 40 : 60;
          const strategyBadges: StrategyFit[] = [];
          if (bpsFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'BPS', score: bpsFit.totalScore, label: 'Bull Put Spread' });
          }
          if (bcsFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'BCS', score: bcsFit.totalScore, label: 'Bear Call Spread' });
          }
          if (icFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'IC', score: icFit.totalScore, label: 'Iron Condor' });
          }
          // For index tickers: always ensure at least IC is shown (indexes are always IC-eligible)
          if (isIndexTicker && strategyBadges.length === 0) {
            strategyBadges.push({ strategy: 'IC', score: icFit.totalScore, label: 'Iron Condor' });
          }



          // Generate reasoning
          let reasoning = '';
          if (totalScore >= 80) {
            reasoning = `Excellent fit: ${momentum}, ${ivRank ? `${ivRank}% IV Rank` : 'moderate IV'}, ${historical ? `${historical.winRate.toFixed(0)}% win rate` : 'no history'}`;
          } else if (totalScore >= 60) {
            reasoning = `Good fit: ${momentum}, ${ivRank ? `${ivRank}% IV` : 'moderate IV'}, ${yearPosition.toFixed(0)}% of 52-week range`;
          } else if (totalScore >= 40) {
            reasoning = `Acceptable: ${momentum}, but ${ivRank && ivRank < 30 ? 'low IV' : yearPosition < 30 || yearPosition > 70 ? 'extreme price level' : 'mixed signals'}`;
          } else {
            reasoning = `Avoid: ${momentum} conflicts with ${recommendedStrategy} strategy`;
          }

          return {
            symbol,
            isIndex: isIndexTicker,
            score: totalScore,
            currentPrice,
            change24h,
            yearHigh,
            yearLow,
            yearPosition,
            ivRank,
            momentum,
            historicalWinRate: historical?.winRate || null,
            historicalAvgPL: historical?.avgPL || null,
            historicalTradeCount: historical?.tradeCount || 0,
            recommendedStrikes,
            reasoning,
            fitScore,
            strategyBadges,
          };
        } catch (error) {
          console.error(`Failed to analyze ${symbol}:`, error);
          return null;
        }
      });

      const tickerAnalyses = (await Promise.all(tickerAnalysisPromises)).filter(Boolean) as TickerAnalysis[];

      // Sort by score (best to worst)
      const rankedTickers = tickerAnalyses.sort((a, b) => b.score - a.score);

      console.log(`[Strategy Advisor] Analyzed ${rankedTickers.length} tickers, top score: ${rankedTickers[0]?.score || 0}`);

      // Generate overall recommendation
      const recommendation = {
        marketCondition,
        recommendedStrategy,
        confidence: rankedTickers.length >= 5 && rankedTickers[0]?.score >= 70 ? 'HIGH' : rankedTickers.length >= 3 ? 'MEDIUM' : 'LOW',
        reasoning: `Market is ${marketCondition.toLowerCase()}. ${recommendedStrategy} is optimal. ${
          bpsMetric && bpsMetric.winRate > 70 
            ? `Your historical ${bpsMetric.winRate.toFixed(0)}% win rate with BPS supports this strategy.` 
            : ''
        }`,
        keyFactors: [
          `SPY ${spy?.change >= 0 ? 'up' : 'down'} ${Math.abs(spy?.change || 0).toFixed(1)}%`,
          `VIX at ${vix?.last.toFixed(1)}`,
          `${rankedTickers.length} watchlist tickers analyzed`,
        ],
        riskWarning: recommendedStrategy === 'BPS' 
          ? 'Bull Put Spreads carry defined risk. Max loss = spread width - premium received.'
          : recommendedStrategy === 'BCS'
          ? 'Bear Call Spreads carry defined risk. Max loss = spread width - premium received.'
          : 'Iron Condors require price to stay within range. Manage winners at 50% profit.',
        historicalInsight: bpsMetric 
          ? `Your ${bpsMetric.winRate.toFixed(0)}% win rate with ${recommendedStrategy} over ${bpsMetric.totalPositions} trades shows strong performance.`
          : 'No historical data available for this strategy yet.',
      };

      return {
        error: null,
        marketData,
        recommendation,
        rankedTickers,
        scanType,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[Strategy Advisor] Error:', error);
      return {
        error: error.message || 'Failed to generate recommendation',
        marketData: null,
        recommendation: null,
        rankedTickers: [],
      };
    }
  }),
});
