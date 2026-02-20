/**
 * Strategy Advisor Router
 * Analyzes market conditions and recommends optimal spread strategies (BPS, BCS, IC)
 */

import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";

export const strategyAdvisorRouter = router({
  /**
   * Get market analysis and strategy recommendation
   * Fetches real-time market data (SPY, QQQ, IWM, VIX) and uses LLM to analyze conditions
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
        };
      }

      // Initialize API and login
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // Fetch user's watchlist
      const { getWatchlistSelections } = await import('./db');
      const watchlistSymbols = await getWatchlistSelections(ctx.user.id);

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
        // Continue without historical data if it fails
      }

      // Fetch market data for major indices and VIX
      const symbols = ['SPY', 'QQQ', 'IWM', 'VIX'];
      const quotes = await api.getUnderlyingQuotesBatch(symbols);

      // Get detailed market data for each symbol
      const marketDataPromises = symbols.map(async (symbol) => {
        try {
          const response = await (api as any).client.get('/market-data/by-type', {
            params: { equity: symbol },
          });

          const item = response.data.data?.items?.[0];
          if (!item) {
            return null;
          }

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
          console.error(`Failed to fetch detailed data for ${symbol}:`, error);
          return null;
        }
      });

      const marketDataArray = await Promise.all(marketDataPromises);
      const marketData = marketDataArray.filter(Boolean).reduce((acc, data) => {
        if (data) {
          acc[data.symbol] = data;
        }
        return acc;
      }, {} as Record<string, any>);

      // Fetch market data for watchlist tickers (limit to top 10 selected)
      const topWatchlistSymbols = watchlistSymbols.slice(0, 10);
      const watchlistDataPromises = topWatchlistSymbols.map(async (symbol) => {
        try {
          const response = await (api as any).client.get('/market-data/by-type', {
            params: { equity: symbol },
          });

          const item = response.data.data?.items?.[0];
          if (!item) {
            return null;
          }

          return {
            symbol,
            last: parseFloat(item.last || '0'),
            open: parseFloat(item.open || '0'),
            prevClose: parseFloat(item['prev-close'] || '0'),
            yearHigh: parseFloat(item['year-high-price'] || '0'),
            yearLow: parseFloat(item['year-low-price'] || '0'),
            change: item.last && item['prev-close'] 
              ? ((parseFloat(item.last) - parseFloat(item['prev-close'])) / parseFloat(item['prev-close'])) * 100 
              : 0,
          };
        } catch (error) {
          console.error(`Failed to fetch data for watchlist ticker ${symbol}:`, error);
          return null;
        }
      });

      const watchlistData = (await Promise.all(watchlistDataPromises)).filter(Boolean);

      // Build LLM analysis prompt
      const spy = marketData['SPY'];
      const qqq = marketData['QQQ'];
      const iwm = marketData['IWM'];
      const vix = marketData['VIX'];

      const prompt = `You are a professional options trading advisor specializing in spread strategies. Analyze the current market conditions and recommend the optimal spread strategy.

**Current Market Data:**

SPY (S&P 500 ETF):
- Current Price: $${spy.last.toFixed(2)}
- Daily Change: ${spy.change >= 0 ? '+' : ''}${spy.change.toFixed(2)}%
- Open: $${spy.open.toFixed(2)}
- High: $${spy.high.toFixed(2)}
- Low: $${spy.low.toFixed(2)}
- Previous Close: $${spy.prevClose.toFixed(2)}
- 52-Week Range: $${spy.yearLow.toFixed(2)} - $${spy.yearHigh.toFixed(2)}
- Position in 52-Week Range: ${(((spy.last - spy.yearLow) / (spy.yearHigh - spy.yearLow)) * 100).toFixed(1)}%

QQQ (Nasdaq-100 ETF):
- Current Price: $${qqq.last.toFixed(2)}
- Daily Change: ${qqq.change >= 0 ? '+' : ''}${qqq.change.toFixed(2)}%
- 52-Week Range: $${qqq.yearLow.toFixed(2)} - $${qqq.yearHigh.toFixed(2)}
- Position in 52-Week Range: ${(((qqq.last - qqq.yearLow) / (qqq.yearHigh - qqq.yearLow)) * 100).toFixed(1)}%

IWM (Russell 2000 ETF):
- Current Price: $${iwm.last.toFixed(2)}
- Daily Change: ${iwm.change >= 0 ? '+' : ''}${iwm.change.toFixed(2)}%
- 52-Week Range: $${iwm.yearLow.toFixed(2)} - $${iwm.yearHigh.toFixed(2)}
- Position in 52-Week Range: ${(((iwm.last - iwm.yearLow) / (iwm.yearHigh - iwm.yearLow)) * 100).toFixed(1)}%

VIX (Volatility Index):
- Current Level: ${vix.last.toFixed(2)}
- Daily Change: ${vix.change >= 0 ? '+' : ''}${vix.change.toFixed(2)}%

**Strategy Options:**
1. **Bull Put Spread (BPS)**: Sell OTM put, buy further OTM put. Best for bullish/neutral markets with upward momentum.
2. **Bear Call Spread (BCS)**: Sell OTM call, buy further OTM call. Best for bearish/neutral markets with downward pressure.
3. **Iron Condor (IC)**: Combine BPS + BCS. Best for neutral, low-volatility markets with sideways movement.

**Analysis Framework:**
- **Trend**: Analyze daily change, position in 52-week range, and price action across all indices
- **Volatility**: VIX interpretation (Low: <15, Moderate: 15-25, High: >25)
- **Momentum**: Daily price changes and market breadth
- **Market Condition**: Classify as Bullish, Bearish, or Neutral

**User's Watchlist Tickers:**
${watchlistData.map(ticker => `
${ticker!.symbol}:
- Current Price: $${ticker!.last.toFixed(2)}
- Daily Change: ${ticker!.change >= 0 ? '+' : ''}${ticker!.change.toFixed(2)}%
- 52-Week Position: ${(((ticker!.last - ticker!.yearLow) / (ticker!.yearHigh - ticker!.yearLow)) * 100).toFixed(1)}%
`).join('')}

**User's Historical Performance (Last 12 Months):**
${strategyMetrics.length > 0 ? strategyMetrics.map(s => `
${s.strategy}:
- Total Positions: ${s.totalPositions}
- Win Rate: ${s.winRate.toFixed(1)}%
- Average ROC: ${s.roc.toFixed(2)}%
- Total P/L: $${s.totalProfitLoss.toFixed(2)}
- Best Symbol: ${s.bestSymbol || 'N/A'}
`).join('') : 'No historical spread trading data available.'}

**Top Performing Symbols (by P/L):**
${symbolMetrics.length > 0 ? symbolMetrics.slice(0, 5).map(sym => `
${sym.symbol}: $${sym.totalProfitLoss.toFixed(2)} P/L (${sym.roc.toFixed(1)}% ROC, ${sym.totalPositions} trades)
- Best Strategy: ${sym.bestStrategy}
`).join('') : 'No symbol-level data available.'}

**Instructions:**
1. Analyze current market conditions to determine the base recommended strategy
2. Review the user's historical performance data to identify which strategies and symbols have worked best
3. If the user has strong historical performance with a particular strategy (>70% win rate, >15% ROC), consider favoring that strategy
4. When recommending watchlist tickers, prioritize symbols that have performed well historically for the user
5. Provide educational context about why historical performance supports (or contradicts) the current market recommendation

**Your Task:**
Provide a JSON response with the following structure:
{
  "marketCondition": "Bullish" | "Bearish" | "Neutral",
  "recommendedStrategy": "BPS" | "BCS" | "IC",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "2-3 sentence explanation of why this strategy is optimal",
  "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
  "riskWarning": "Brief risk consideration for this strategy in current conditions",
  "topWatchlistPicks": [
    {
      "symbol": "TICKER",
      "reason": "Brief explanation why this ticker fits the recommended strategy"
    }
  ]
}

Be specific, data-driven, and actionable. Focus on capital-efficient spread strategies only.`;

      // Call LLM for analysis
      const llmResponse = await invokeLLM({
        messages: [
          { role: 'system', content: 'You are a professional options trading advisor. Always respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'strategy_recommendation',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                marketCondition: {
                  type: 'string',
                  enum: ['Bullish', 'Bearish', 'Neutral'],
                  description: 'Overall market condition',
                },
                recommendedStrategy: {
                  type: 'string',
                  enum: ['BPS', 'BCS', 'IC'],
                  description: 'Recommended spread strategy',
                },
                confidence: {
                  type: 'string',
                  enum: ['HIGH', 'MEDIUM', 'LOW'],
                  description: 'Confidence level in recommendation',
                },
                reasoning: {
                  type: 'string',
                  description: '2-3 sentence explanation',
                },
                keyFactors: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Key factors influencing the recommendation',
                },
                riskWarning: {
                  type: 'string',
                  description: 'Brief risk consideration',
                },
                historicalInsight: {
                  type: 'string',
                  description: '1-2 sentences explaining how the user\'s historical performance influenced this recommendation',
                },
                topWatchlistPicks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      symbol: { type: 'string' },
                      reason: { type: 'string' },
                    },
                    required: ['symbol', 'reason'],
                    additionalProperties: false,
                  },
                  description: 'Top 3-5 tickers from watchlist that fit the recommended strategy',
                },
              },
              required: ['marketCondition', 'recommendedStrategy', 'confidence', 'reasoning', 'keyFactors', 'riskWarning', 'historicalInsight', 'topWatchlistPicks'],
              additionalProperties: false,
            },
          },
        },
      });

      const content = llmResponse.choices[0].message.content;
      const recommendation = JSON.parse(typeof content === 'string' ? content : '{}');

      return {
        error: null,
        marketData,
        recommendation,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[Strategy Advisor] Error:', error);
      return {
        error: error.message || 'Failed to generate recommendation',
        marketData: null,
        recommendation: null,
      };
    }
  }),
});
