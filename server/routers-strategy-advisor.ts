/**
 * Enhanced Strategy Advisor Router
 * Analyzes individual watchlist tickers with IV, 52-week range, momentum, and historical performance
 * Provides ranked recommendations with specific strike suggestions
 */

import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";

interface TickerAnalysis {
  symbol: string;
  score: number;
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
}

export const strategyAdvisorRouter = router({
  /**
   * Get enhanced market analysis with ranked watchlist recommendations
   * Analyzes each ticker individually and scores them for the recommended strategy
   */
  getRecommendation: protectedProcedure.query(async ({ ctx }) => {
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
      const { getWatchlistSelections } = await import('./db');
      const watchlistSelections = await getWatchlistSelections(ctx.user.id);
      const watchlistSymbols = watchlistSelections.map(sel => sel.symbol);

      if (watchlistSymbols.length === 0) {
        return {
          error: 'No tickers in watchlist. Please add tickers in Settings.',
          marketData: null,
          recommendation: null,
          rankedTickers: [],
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
      const tickerAnalysisPromises = watchlistSymbols.slice(0, 20).map(async (symbol): Promise<TickerAnalysis | null> => {
        try {
          // Fetch ticker market data
          const response = await (api as any).client.get('/market-data/by-type', {
            params: { equity: symbol },
          });

          const item = response.data.data?.items?.[0];
          if (!item) return null;

          const currentPrice = parseFloat(item.last || '0');
          const prevClose = parseFloat(item['prev-close'] || '0');
          const yearHigh = parseFloat(item['year-high-price'] || '0');
          const yearLow = parseFloat(item['year-low-price'] || '0');
          const change24h = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
          const yearPosition = yearHigh > yearLow ? ((currentPrice - yearLow) / (yearHigh - yearLow)) * 100 : 50;

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

            // Get nearest expiration (7-14 DTE ideal)
            const expirations = await tradierApi.getExpirations(symbol);
            const today = new Date();
            const targetDate = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days out
            
            const nearestExp = expirations
              .map((exp: string) => ({ date: exp, dte: Math.abs(new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24) }))
              .filter((exp: any) => exp.dte >= 7 && exp.dte <= 21)
              .sort((a: any, b: any) => Math.abs(a.dte - 10) - Math.abs(b.dte - 10))[0];

            if (nearestExp) {
              const chain = await tradierApi.getOptionChain(symbol, nearestExp.date, true);
              
              // Calculate IV Rank from all options
              const allIVs = chain
                .filter((opt: any) => opt.greeks?.mid_iv && opt.greeks.mid_iv > 0)
                .map((opt: any) => opt.greeks!.mid_iv!);

              if (allIVs.length >= 10) {
                const minIV = Math.min(...allIVs);
                const maxIV = Math.max(...allIVs);
                const avgIV = allIVs.reduce((sum: number, iv: number) => sum + iv, 0) / allIVs.length;
                
                if (maxIV > minIV) {
                  ivRank = Math.round(((avgIV - minIV) / (maxIV - minIV)) * 100);
                }
              }

              // Generate strike recommendations based on strategy
              const puts = chain.filter((opt: any) => opt.optionType === 'put');
              const calls = chain.filter((opt: any) => opt.optionType === 'call');

              if (recommendedStrategy === 'BPS' && puts.length >= 2) {
                // Bull Put Spread: Sell put at ~30 delta, buy put at ~15 delta
                const shortPut = puts.find((p: any) => Math.abs(p.greeks?.delta || 0) >= 0.25 && Math.abs(p.greeks?.delta || 0) <= 0.35);
                const longPut = puts.find((p: any) => 
                  Math.abs(p.greeks?.delta || 0) >= 0.10 && 
                  Math.abs(p.greeks?.delta || 0) <= 0.20 &&
                  p.strike < (shortPut?.strike || 0)
                );

                if (shortPut && longPut) {
                  const premium = (shortPut.bid - longPut.ask) * 100;
                  const maxLoss = (shortPut.strike - longPut.strike) * 100;
                  const pop = 100 - Math.abs(shortPut.greeks?.delta || 0.30) * 100;

                  recommendedStrikes = {
                    shortStrike: shortPut.strike,
                    longStrike: longPut.strike,
                    expectedPremium: premium,
                    probabilityOfProfit: pop,
                  };
                }
              } else if (recommendedStrategy === 'BCS' && calls.length >= 2) {
                // Bear Call Spread: Sell call at ~30 delta, buy call at ~15 delta
                const shortCall = calls.find((c: any) => Math.abs(c.greeks?.delta || 0) >= 0.25 && Math.abs(c.greeks?.delta || 0) <= 0.35);
                const longCall = calls.find((c: any) => 
                  Math.abs(c.greeks?.delta || 0) >= 0.10 && 
                  Math.abs(c.greeks?.delta || 0) <= 0.20 &&
                  c.strike > (shortCall?.strike || 0)
                );

                if (shortCall && longCall) {
                  const premium = (shortCall.bid - longCall.ask) * 100;
                  const maxLoss = (longCall.strike - shortCall.strike) * 100;
                  const pop = 100 - Math.abs(shortCall.greeks?.delta || 0.30) * 100;

                  recommendedStrikes = {
                    shortStrike: shortCall.strike,
                    longStrike: longCall.strike,
                    expectedPremium: premium,
                    probabilityOfProfit: pop,
                  };
                }
              } else if (recommendedStrategy === 'IC' && puts.length >= 2 && calls.length >= 2) {
                // Iron Condor: Combine BPS + BCS
                const shortPut = puts.find((p: any) => Math.abs(p.greeks?.delta || 0) >= 0.20 && Math.abs(p.greeks?.delta || 0) <= 0.30);
                const longPut = puts.find((p: any) => p.strike < (shortPut?.strike || 0) && Math.abs(p.greeks?.delta || 0) <= 0.15);
                const shortCall = calls.find((c: any) => Math.abs(c.greeks?.delta || 0) >= 0.20 && Math.abs(c.greeks?.delta || 0) <= 0.30);
                const longCall = calls.find((c: any) => c.strike > (shortCall?.strike || 0) && Math.abs(c.greeks?.delta || 0) <= 0.15);

                if (shortPut && longPut && shortCall && longCall) {
                  const putCredit = (shortPut.bid - longPut.ask) * 100;
                  const callCredit = (shortCall.bid - longCall.ask) * 100;
                  const totalPremium = putCredit + callCredit;
                  const pop = 65; // Approximate PoP for IC

                  recommendedStrikes = {
                    shortStrike: shortPut.strike,
                    longStrike: longPut.strike,
                    expectedPremium: totalPremium,
                    probabilityOfProfit: pop,
                  };
                }
              }
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

          // Calculate fit score (0-100)
          const fitScore = {
            momentum: 0,
            iv: 0,
            historical: 0,
            technical: 0,
          };

          // Momentum score (30 points)
          if (recommendedStrategy === 'BPS') {
            if (momentum === 'Strong Uptrend' || momentum === 'Moderate Uptrend') fitScore.momentum = 30;
            else if (momentum === 'Sideways') fitScore.momentum = 20;
            else fitScore.momentum = 5;
          } else if (recommendedStrategy === 'BCS') {
            if (momentum === 'Strong Downtrend' || momentum === 'Moderate Downtrend') fitScore.momentum = 30;
            else if (momentum === 'Sideways') fitScore.momentum = 20;
            else fitScore.momentum = 5;
          } else { // IC
            if (momentum === 'Sideways') fitScore.momentum = 30;
            else if (momentum === 'Moderate Uptrend' || momentum === 'Moderate Downtrend') fitScore.momentum = 20;
            else fitScore.momentum = 10;
          }

          // IV score (25 points)
          if (ivRank !== null) {
            if (ivRank >= 60) fitScore.iv = 25;
            else if (ivRank >= 40) fitScore.iv = 20;
            else if (ivRank >= 25) fitScore.iv = 15;
            else fitScore.iv = 5;
          } else {
            fitScore.iv = 10; // Neutral if no IV data
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
          if (recommendedStrategy === 'BPS') {
            if (yearPosition >= 60) fitScore.technical = 15;
            else if (yearPosition >= 40) fitScore.technical = 10;
            else fitScore.technical = 5;
          } else if (recommendedStrategy === 'BCS') {
            if (yearPosition <= 40) fitScore.technical = 15;
            else if (yearPosition <= 60) fitScore.technical = 10;
            else fitScore.technical = 5;
          } else { // IC
            if (yearPosition >= 40 && yearPosition <= 60) fitScore.technical = 15;
            else if (yearPosition >= 30 && yearPosition <= 70) fitScore.technical = 10;
            else fitScore.technical = 5;
          }

          const totalScore = fitScore.momentum + fitScore.iv + fitScore.historical + fitScore.technical;

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
