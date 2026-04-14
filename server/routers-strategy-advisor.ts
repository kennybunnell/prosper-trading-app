/**
 * Enhanced Strategy Advisor Router
 * Analyzes individual watchlist tickers with IV, 52-week range, momentum, and historical performance
 * Provides ranked recommendations with specific strike suggestions
 *
 * v2: Added 14-day directional trend filter
 * - Fetches 14-day historical price data from Tradier for each ticker
 * - Classifies trend as Bullish (>+1.5%), Bearish (<-1.5%), or Neutral (±1.5%)
 * - Hard-suppresses strategies that fight the trend:
 *   Bearish trend → BCS recommended, BPS heavily penalized
 *   Bullish trend → BPS recommended, BCS heavily penalized
 *   Neutral trend → IC recommended
 */

import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { z } from "zod";

// Trend threshold: price change > +THRESHOLD = Bullish, < -THRESHOLD = Bearish
const TREND_THRESHOLD_PCT = 1.5;

type TrendBias = 'Bullish' | 'Bearish' | 'Neutral';

interface StrategyFit {
  strategy: 'BPS' | 'BCS' | 'IC';
  score: number;
  label: string;
}

interface TickerAnalysis {
  symbol: string;
  isIndex: boolean;
  score: number;
  currentPrice: number;
  change24h: number;
  trend14d: number | null;       // 14-day price change %
  trendBias: TrendBias;          // Bullish / Bearish / Neutral
  yearHigh: number;
  yearLow: number;
  yearPosition: number;
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
  strategyBadges: StrategyFit[];
  bestStrategy: 'BPS' | 'BCS' | 'IC';  // The strategy best aligned with trend
}

/**
 * Fetch 14-day price change for a symbol using Tradier historical data.
 * Returns null if data is unavailable.
 */
async function get14dTrend(tradierApi: any, symbol: string): Promise<number | null> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 calendar days to get ~14 trading days
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const history = await tradierApi.getHistoricalData(symbol, 'daily', startStr, endStr);
    if (!history || history.length < 2) return null;

    // Sort ascending by date
    const sorted = [...history].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Use the oldest close as the baseline (up to 14 trading days ago)
    const baseline = sorted[0];
    const latest = sorted[sorted.length - 1];

    if (!baseline?.close || !latest?.close || baseline.close === 0) return null;

    const changePct = ((latest.close - baseline.close) / baseline.close) * 100;
    return Math.round(changePct * 100) / 100; // round to 2 decimal places
  } catch (err: any) {
    console.warn(`[Strategy Advisor] 14d trend fetch failed for ${symbol}: ${err.message}`);
    return null;
  }
}

/**
 * Classify a 14-day price change into a directional bias.
 */
function classifyTrend(trend14d: number | null): TrendBias {
  if (trend14d === null) return 'Neutral';
  if (trend14d > TREND_THRESHOLD_PCT) return 'Bullish';
  if (trend14d < -TREND_THRESHOLD_PCT) return 'Bearish';
  return 'Neutral';
}

/**
 * Determine the best strategy for a given trend bias.
 */
function bestStrategyForTrend(bias: TrendBias): 'BPS' | 'BCS' | 'IC' {
  if (bias === 'Bullish') return 'BPS';
  if (bias === 'Bearish') return 'BCS';
  return 'IC';
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

      // Filter by scanType
      const filteredWatchlist = fullWatchlist.filter((w: any) => {
        const isIdx = w.isIndex === true || w.isIndex === 1 || isIndexSymbol(w.symbol);
        if (scanType === 'index') return isIdx;
        if (scanType === 'equity') return !isIdx;
        return true;
      });

      // Deduplicate by symbol
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

      // Fetch market data for major indices (overall market condition)
      const indexSymbols = ['SPY', 'QQQ', 'IWM', 'VIX'];
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
          return null;
        }
      });

      const marketDataArray = await Promise.all(marketDataPromises);
      const marketData = marketDataArray.filter(Boolean).reduce((acc, data) => {
        if (data) acc[data.symbol] = data;
        return acc;
      }, {} as Record<string, any>);

      // ─── Overall market condition using SPY 14-day trend ─────────────────────
      // Initialize Tradier API for trend fetching
      const { createTradierAPI } = await import('./tradier');
      const tradierCreds = await getApiCredentials(ctx.user.id);
      const tradierApi = tradierCreds?.tradierApiKey
        ? createTradierAPI(tradierCreds.tradierApiKey, false, ctx.user.id)
        : null;

      const spy = marketData['SPY'];
      const vix = marketData['VIX'];

      // Fetch SPY 14-day trend for overall market direction
      let spyTrend14d: number | null = null;
      if (tradierApi) {
        spyTrend14d = await get14dTrend(tradierApi, 'SPY');
      }
      const spyTrendBias = classifyTrend(spyTrend14d);

      let marketCondition: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
      let recommendedStrategy: 'BPS' | 'BCS' | 'IC' = 'IC';

      // Primary signal: 14-day SPY trend
      if (spyTrendBias === 'Bullish') {
        marketCondition = 'Bullish';
        recommendedStrategy = 'BPS';
      } else if (spyTrendBias === 'Bearish') {
        marketCondition = 'Bearish';
        recommendedStrategy = 'BCS';
      } else {
        // Neutral trend — use VIX to refine
        if (vix && vix.last > 25) {
          marketCondition = 'Bearish'; // High VIX in neutral trend → cautious
          recommendedStrategy = 'IC';
        } else {
          marketCondition = 'Neutral';
          recommendedStrategy = 'IC';
        }
      }

      // Check user's historical performance to adjust recommendation
      const bpsMetric = strategyMetrics.find(s => s.strategy === 'Bull Put Spread');
      const bcsMetric = strategyMetrics.find(s => s.strategy === 'Bear Call Spread');
      const icMetric = strategyMetrics.find(s => s.strategy === 'Iron Condor');

      // Only override with historical performance if trend is neutral
      if (spyTrendBias === 'Neutral') {
        if (bpsMetric && bpsMetric.winRate > 70 && bpsMetric.roc > 15) {
          recommendedStrategy = 'BPS';
        } else if (icMetric && icMetric.winRate > 65 && icMetric.roc > 12) {
          recommendedStrategy = 'IC';
        }
      }

      console.log(`[Strategy Advisor] SPY 14d trend: ${spyTrend14d?.toFixed(2)}% → ${spyTrendBias} | Market: ${marketCondition} | Recommended: ${recommendedStrategy}`);

      // Pre-load index symbol checker
      const { isIndexSymbol: checkIsIndex } = await import('../shared/index-symbols');

      const tickerAnalysisPromises = watchlistSymbols.map(async (symbol): Promise<TickerAnalysis | null> => {
        const isIdxSymbol = checkIsIndex(symbol);
        try {
          // ─── Market data fetch ────────────────────────────────────────────────
          let item: any = null;
          try {
            if (isIdxSymbol) {
              const idxResponse = await (api as any).client.get('/market-data/by-type', {
                params: { index: symbol },
              });
              item = idxResponse.data.data?.items?.[0];
              if (!item) {
                const eqResponse = await (api as any).client.get('/market-data/by-type', {
                  params: { equity: symbol },
                });
                item = eqResponse.data.data?.items?.[0];
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

          let currentPrice = 0;
          let prevClose = 0;
          let yearHigh = 0;
          let yearLow = 0;
          let change24h = 0;
          let yearPosition = 50;

          if (item) {
            currentPrice = parseFloat(item.last || item.close || '0');
            prevClose = parseFloat(item['prev-close'] || item.close || '0');
            yearHigh = parseFloat(item['year-high-price'] || '0');
            yearLow = parseFloat(item['year-low-price'] || '0');
            change24h = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
            yearPosition = yearHigh > yearLow ? ((currentPrice - yearLow) / (yearHigh - yearLow)) * 100 : 50;
          } else if (!isIdxSymbol) {
            console.warn(`[Strategy Advisor] No market data for equity ${symbol}, skipping`);
            return null;
          } else {
            console.warn(`[Strategy Advisor] No market data for index ${symbol}, proceeding with option-chain-only scoring`);
          }

          // ─── 14-day trend for this specific ticker ────────────────────────────
          // Use the ticker's own 14d trend for per-ticker strategy recommendation.
          // For index symbols that Tradier doesn't quote (e.g. SPXW, NDXP), fall back
          // to the SPY trend as a proxy.
          let trend14d: number | null = null;
          if (tradierApi) {
            // Map index option roots to their underlying quote symbol for Tradier
            const tradierQuoteSymbol: Record<string, string> = {
              'SPXW': 'SPX', 'SPX': 'SPX',
              'NDXP': 'NDX', 'NDX': 'NDX',
              'RUTW': 'RUT', 'RUT': 'RUT',
              'XSP': 'XSP', 'XND': 'XND',
              'DJX': 'DJX',
            };
            const quoteSymbol = tradierQuoteSymbol[symbol] || symbol;
            trend14d = await get14dTrend(tradierApi, quoteSymbol);
            // Fallback to SPY trend if Tradier can't quote this symbol
            if (trend14d === null && isIdxSymbol) {
              trend14d = spyTrend14d;
            }
          }

          const trendBias = classifyTrend(trend14d);
          const bestStrategy = bestStrategyForTrend(trendBias);

          console.log(`[Strategy Advisor] ${symbol} 14d trend: ${trend14d?.toFixed(2) ?? 'N/A'}% → ${trendBias} → best: ${bestStrategy}`);

          // ─── Option chain / IV fetch ──────────────────────────────────────────
          let ivRank: number | null = null;
          let recommendedStrikes: TickerAnalysis['recommendedStrikes'] = null;

          try {
            if (!tradierApi) throw new Error('Tradier API key not configured');

            const expirations = await tradierApi.getExpirations(symbol);
            const today = new Date();
            const minDte = 7;
            const maxDte = isIdxSymbol ? 45 : 21;
            const idealDte = isIdxSymbol ? 14 : 10;

            const nearestExp = expirations
              .map((exp: string) => ({ date: exp, dte: (new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24) }))
              .filter((exp: any) => exp.dte >= minDte && exp.dte <= maxDte)
              .sort((a: any, b: any) => Math.abs(a.dte - idealDte) - Math.abs(b.dte - idealDte))[0];

            if (nearestExp) {
              const chain = await tradierApi.getOptionChain(symbol, nearestExp.date, true);

              // IV Rank calculation
              const allIVs = chain
                .filter((opt: any) => opt.greeks?.mid_iv && opt.greeks.mid_iv > 0)
                .map((opt: any) => opt.greeks!.mid_iv! as number);

              if (allIVs.length > 0) {
                const sorted = [...allIVs].sort((a, b) => a - b);
                const medianIV = sorted[Math.floor(sorted.length / 2)];
                const annualizedIV = medianIV * 100;

                if (isIdxSymbol) {
                  ivRank = Math.min(100, Math.round(Math.max(0, (annualizedIV - 10) / 30) * 100));
                } else {
                  ivRank = Math.min(100, Math.round(Math.max(0, (annualizedIV - 15) / 65) * 100));
                }
              }

              // Strike recommendations — build for the trend-aligned strategy first
              const puts = chain.filter((opt: any) => opt.optionType === 'put');
              const calls = chain.filter((opt: any) => opt.optionType === 'call');
              // For indexes: try trend-aligned strategy first, then all three
              const strikesToBuild = isIdxSymbol
                ? ([bestStrategy, 'IC', 'BPS', 'BCS'] as const)
                : ([bestStrategy] as const);

              for (const strat of strikesToBuild) {
                if (recommendedStrikes) break;

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
            }
          } catch (error) {
            console.warn(`Failed to fetch option data for ${symbol}:`, error);
          }

          // ─── Momentum (1-day, for display) ───────────────────────────────────
          let momentum: TickerAnalysis['momentum'] = 'Sideways';
          if (change24h > 2) momentum = 'Strong Uptrend';
          else if (change24h > 0.5) momentum = 'Moderate Uptrend';
          else if (change24h < -2) momentum = 'Strong Downtrend';
          else if (change24h < -0.5) momentum = 'Moderate Downtrend';

          const historical = historicalBySymbol[symbol];
          const isIndexTicker = isIdxSymbol;

          // ─── Strategy fit scoring ─────────────────────────────────────────────
          // The 14-day trend is the PRIMARY signal. Strategies that fight the trend
          // receive a hard penalty of -20 points on the momentum component.
          const calculateStrategyFit = (strategy: 'BPS' | 'BCS' | 'IC') => {
            const fitScore = {
              momentum: 0,
              iv: 0,
              historical: 0,
              technical: 0,
            };

            // ── Momentum score (30 points) ────────────────────────────────────
            // Uses 14-day trend bias as the primary signal.
            // Strategies aligned with the trend get full points.
            // Strategies that FIGHT the trend get a hard cap of 8 points.
            const alignedWithTrend =
              (strategy === 'BPS' && trendBias === 'Bullish') ||
              (strategy === 'BCS' && trendBias === 'Bearish') ||
              (strategy === 'IC' && trendBias === 'Neutral') ||
              trendBias === 'Neutral'; // neutral trend: all strategies acceptable

            const fightsTheTrend =
              (strategy === 'BPS' && trendBias === 'Bearish') ||
              (strategy === 'BCS' && trendBias === 'Bullish');

            if (fightsTheTrend) {
              // Hard suppress: strategy directly opposes the 14-day trend
              fitScore.momentum = isIndexTicker ? 6 : 3;
            } else if (alignedWithTrend) {
              // Full points for trend-aligned strategy
              if (strategy === 'BPS') {
                if (momentum === 'Strong Uptrend' || momentum === 'Moderate Uptrend') fitScore.momentum = 30;
                else if (momentum === 'Sideways') fitScore.momentum = isIndexTicker ? 28 : 22;
                else fitScore.momentum = isIndexTicker ? 20 : 12;
              } else if (strategy === 'BCS') {
                if (momentum === 'Strong Downtrend' || momentum === 'Moderate Downtrend') fitScore.momentum = 30;
                else if (momentum === 'Sideways') fitScore.momentum = isIndexTicker ? 28 : 22;
                else fitScore.momentum = isIndexTicker ? 20 : 12;
              } else { // IC
                if (momentum === 'Sideways') fitScore.momentum = 30;
                else if (momentum === 'Moderate Uptrend' || momentum === 'Moderate Downtrend') fitScore.momentum = isIndexTicker ? 28 : 22;
                else fitScore.momentum = isIndexTicker ? 20 : 12;
              }
            } else {
              // Partially aligned (e.g. IC in a trending market)
              fitScore.momentum = isIndexTicker ? 22 : 15;
            }

            // ── IV score (25 points) ──────────────────────────────────────────
            if (ivRank !== null) {
              if (isIndexTicker) {
                if (ivRank >= 35) fitScore.iv = 25;
                else if (ivRank >= 25) fitScore.iv = 22;
                else if (ivRank >= 15) fitScore.iv = 18;
                else if (ivRank >= 8) fitScore.iv = 12;
                else fitScore.iv = 6;
              } else {
                if (ivRank >= 60) fitScore.iv = 25;
                else if (ivRank >= 40) fitScore.iv = 20;
                else if (ivRank >= 25) fitScore.iv = 15;
                else fitScore.iv = 5;
              }
            } else {
              fitScore.iv = isIndexTicker ? 15 : 10;
            }

            // ── Historical performance score (30 points) ──────────────────────
            if (historical) {
              if (historical.winRate >= 75) fitScore.historical = 30;
              else if (historical.winRate >= 65) fitScore.historical = 25;
              else if (historical.winRate >= 55) fitScore.historical = 20;
              else if (historical.winRate >= 45) fitScore.historical = 15;
              else fitScore.historical = 5;
            } else {
              fitScore.historical = 15;
            }

            // ── Technical score (15 points) — 52-week position ───────────────
            if (strategy === 'BPS') {
              if (yearPosition >= 60) fitScore.technical = 15;
              else if (yearPosition >= 40) fitScore.technical = 10;
              else fitScore.technical = 5;
            } else if (strategy === 'BCS') {
              if (yearPosition <= 40) fitScore.technical = 15;
              else if (yearPosition <= 60) fitScore.technical = 10;
              else fitScore.technical = 5;
            } else {
              if (yearPosition >= 40 && yearPosition <= 60) fitScore.technical = 15;
              else if (yearPosition >= 30 && yearPosition <= 70) fitScore.technical = 10;
              else fitScore.technical = 5;
            }

            return {
              fitScore,
              totalScore: fitScore.momentum + fitScore.iv + fitScore.historical + fitScore.technical,
            };
          };

          const bpsFit = calculateStrategyFit('BPS');
          const bcsFit = calculateStrategyFit('BCS');
          const icFit = calculateStrategyFit('IC');

          // Use the trend-aligned strategy's score as the main score
          const primaryFit = bestStrategy === 'BPS' ? bpsFit : bestStrategy === 'BCS' ? bcsFit : icFit;
          const fitScore = primaryFit.fitScore;
          const totalScore = primaryFit.totalScore;

          // Strategy badges — only show strategies that make sense given the trend
          const badgeCutoff = isIndexTicker ? 40 : 60;
          const strategyBadges: StrategyFit[] = [];

          // Always show the trend-aligned strategy if it meets the cutoff
          if (bestStrategy === 'BPS' && bpsFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'BPS', score: bpsFit.totalScore, label: 'Bull Put Spread' });
          }
          if (bestStrategy === 'BCS' && bcsFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'BCS', score: bcsFit.totalScore, label: 'Bear Call Spread' });
          }
          if (bestStrategy === 'IC' && icFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'IC', score: icFit.totalScore, label: 'Iron Condor' });
          }

          // Also show IC as a secondary option if it scores well (IC is always valid)
          if (bestStrategy !== 'IC' && icFit.totalScore >= badgeCutoff) {
            strategyBadges.push({ strategy: 'IC', score: icFit.totalScore, label: 'Iron Condor' });
          }

          // For index tickers: always ensure at least one badge
          if (isIndexTicker && strategyBadges.length === 0) {
            strategyBadges.push({ strategy: bestStrategy, score: primaryFit.totalScore, label: bestStrategy === 'BPS' ? 'Bull Put Spread' : bestStrategy === 'BCS' ? 'Bear Call Spread' : 'Iron Condor' });
          }

          // Sort badges by score descending
          strategyBadges.sort((a, b) => b.score - a.score);

          // Generate reasoning — include trend context
          const trendLabel = trend14d !== null
            ? `${trend14d > 0 ? '+' : ''}${trend14d.toFixed(1)}% (14d)`
            : 'trend unknown';
          const trendDesc = trendBias === 'Bullish' ? `Bullish trend ${trendLabel}` : trendBias === 'Bearish' ? `Bearish trend ${trendLabel}` : `Neutral trend ${trendLabel}`;

          let reasoning = '';
          if (totalScore >= 80) {
            reasoning = `Excellent fit: ${trendDesc}, ${ivRank ? `${ivRank}% IV Rank` : 'moderate IV'}, ${historical ? `${historical.winRate.toFixed(0)}% win rate` : 'no history'}`;
          } else if (totalScore >= 60) {
            reasoning = `Good fit: ${trendDesc}, ${ivRank ? `${ivRank}% IV` : 'moderate IV'}, ${yearPosition.toFixed(0)}% of 52-week range`;
          } else if (totalScore >= 40) {
            reasoning = `Acceptable: ${trendDesc}, ${ivRank && ivRank < 30 ? 'low IV' : yearPosition < 30 || yearPosition > 70 ? 'extreme price level' : 'mixed signals'}`;
          } else {
            reasoning = `Caution: ${trendDesc} — consider ${bestStrategy} instead`;
          }

          return {
            symbol,
            isIndex: isIndexTicker,
            score: totalScore,
            currentPrice,
            change24h,
            trend14d,
            trendBias,
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
            bestStrategy,
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

      const recommendation = {
        marketCondition,
        recommendedStrategy,
        spyTrend14d,
        spyTrendBias,
        confidence: rankedTickers.length >= 5 && rankedTickers[0]?.score >= 70 ? 'HIGH' : rankedTickers.length >= 3 ? 'MEDIUM' : 'LOW',
        reasoning: `SPY 14-day trend: ${spyTrend14d !== null ? `${spyTrend14d > 0 ? '+' : ''}${spyTrend14d.toFixed(1)}%` : 'N/A'} → ${spyTrendBias}. Market is ${marketCondition.toLowerCase()}. ${recommendedStrategy} is optimal. ${
          bpsMetric && bpsMetric.winRate > 70 
            ? `Your historical ${bpsMetric.winRate.toFixed(0)}% win rate with BPS supports this strategy.` 
            : ''
        }`,
        keyFactors: [
          `SPY 14d: ${spyTrend14d !== null ? `${spyTrend14d > 0 ? '+' : ''}${spyTrend14d.toFixed(1)}%` : 'N/A'} (${spyTrendBias})`,
          `VIX at ${vix?.last.toFixed(1) ?? 'N/A'}`,
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
