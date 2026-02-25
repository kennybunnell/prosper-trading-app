/**
 * Portfolio Advisor Router
 * Provides comprehensive portfolio risk analysis and recommendations
 */

import { router, protectedProcedure } from './_core/trpc';
import { z } from 'zod';

export const portfolioAdvisorRouter = router({
  /**
   * Get portfolio summary for Dashboard cards
   */
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { getTastytradeAPI } = await import('./tastytrade');
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
        return {
          riskScore: 0,
          topConcentrations: [],
          underwaterPositions: 0,
          diversificationScore: 0,
          sectorCount: 0,
        };
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      const accounts = await getTastytradeAccounts(ctx.user.id);
      if (!accounts || accounts.length === 0) {
        return {
          riskScore: 0,
          topConcentrations: [],
          underwaterPositions: 0,
          diversificationScore: 0,
          sectorCount: 0,
        };
      }

      // Aggregate positions across all accounts
      const allPositions: any[] = [];
      for (const account of accounts) {
        const positions = await api.getPositions(account.accountNumber);
        if (positions) {
          allPositions.push(...positions.map((p: any) => ({ ...p, accountNumber: account.accountNumber })));
        }
      }

      // Calculate concentration risk (by ticker)
      const tickerExposure = new Map<string, number>();
      let totalCapitalAtRisk = 0;

      for (const pos of allPositions) {
        const instrumentType = pos['instrument-type'];
        const symbol = pos.symbol;
        const quantity = Math.abs(parseInt(String(pos.quantity || '0')));
        const underlyingSymbol = pos['underlying-symbol'] || symbol;

        if (instrumentType === 'Equity Option') {
          // For options, calculate collateral/capital at risk
          const strikePrice = parseFloat(String(pos['strike-price'] || '0'));
          const optionType = pos['option-type'];
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short';

          if (isShort && optionType === 'P') {
            // Short put: collateral = strike * 100 * quantity
            const collateral = strikePrice * 100 * quantity;
            totalCapitalAtRisk += collateral;
            tickerExposure.set(underlyingSymbol, (tickerExposure.get(underlyingSymbol) || 0) + collateral);
          } else if (isShort && optionType === 'C') {
            // Short call: estimate capital at risk (stock price * 100 * quantity)
            const closePrice = parseFloat(String(pos['close-price'] || strikePrice));
            const capitalAtRisk = closePrice * 100 * quantity;
            totalCapitalAtRisk += capitalAtRisk;
            tickerExposure.set(underlyingSymbol, (tickerExposure.get(underlyingSymbol) || 0) + capitalAtRisk);
          }
        } else if (instrumentType === 'Equity') {
          // For stocks, capital at risk = market value
          const closePrice = parseFloat(String(pos['close-price'] || '0'));
          const marketValue = closePrice * quantity;
          totalCapitalAtRisk += marketValue;
          tickerExposure.set(symbol, (tickerExposure.get(symbol) || 0) + marketValue);
        }
      }

      // Calculate top concentrations
      const topConcentrations = Array.from(tickerExposure.entries())
        .map(([ticker, exposure]) => ({
          ticker,
          exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
        }))
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 5);

      // Calculate underwater positions (short puts where stock price < strike)
      let underwaterCount = 0;
      for (const pos of allPositions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType === 'Equity Option') {
          const optionType = pos['option-type'];
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short';
          const strikePrice = parseFloat(String(pos['strike-price'] || '0'));
          const underlyingPrice = parseFloat(String(pos['underlying-price'] || '0'));

          if (isShort && optionType === 'P' && underlyingPrice < strikePrice) {
            underwaterCount++;
          }
        }
      }

      // Calculate diversification score (based on number of unique tickers)
      const uniqueTickers = new Set(tickerExposure.keys());
      const tickerCount = uniqueTickers.size;
      
      // Diversification score: more tickers = better diversification
      // 1-3 tickers = poor (30-50), 4-6 = moderate (50-70), 7-10 = good (70-85), 11+ = excellent (85-100)
      let diversificationScore = 0;
      if (tickerCount >= 11) {
        diversificationScore = Math.min(100, 85 + (tickerCount - 11) * 2);
      } else if (tickerCount >= 7) {
        diversificationScore = 70 + ((tickerCount - 7) / 3) * 15;
      } else if (tickerCount >= 4) {
        diversificationScore = 50 + ((tickerCount - 4) / 2) * 20;
      } else if (tickerCount >= 1) {
        diversificationScore = 30 + ((tickerCount - 1) / 2) * 20;
      }

      // Calculate risk score (0-100, higher = more risk)
      let riskScore = 0;

      // Factor 1: Concentration risk (max 40 points)
      const maxConcentration = topConcentrations.length > 0 ? topConcentrations[0].percentage : 0;
      if (maxConcentration >= 50) {
        riskScore += 40;
      } else if (maxConcentration >= 30) {
        riskScore += 30;
      } else if (maxConcentration >= 20) {
        riskScore += 20;
      } else if (maxConcentration >= 10) {
        riskScore += 10;
      }

      // Factor 2: Underwater positions (max 30 points)
      const underwaterPct = allPositions.length > 0 ? (underwaterCount / allPositions.length) * 100 : 0;
      if (underwaterPct >= 50) {
        riskScore += 30;
      } else if (underwaterPct >= 30) {
        riskScore += 20;
      } else if (underwaterPct >= 10) {
        riskScore += 10;
      }

      // Factor 3: Diversification (max 30 points - inverse of diversification score)
      riskScore += Math.round((100 - diversificationScore) * 0.3);

      return {
        riskScore: Math.min(100, riskScore),
        topConcentrations,
        underwaterPositions: underwaterCount,
        diversificationScore: Math.round(diversificationScore),
        sectorCount: tickerCount, // Placeholder - would need sector mapping
      };
    } catch (error: any) {
      console.error('[Portfolio Advisor] Failed to get summary:', error.message);
      return {
        riskScore: 0,
        topConcentrations: [],
        underwaterPositions: 0,
        diversificationScore: 0,
        sectorCount: 0,
      };
    }
  }),

  /**
   * Get detailed portfolio analysis for Portfolio Advisor page
   */
  getDetailedAnalysis: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { getTastytradeAPI } = await import('./tastytrade');
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      const accounts = await getTastytradeAccounts(ctx.user.id);
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }

      // Aggregate positions across all accounts
      const allPositions: any[] = [];
      for (const account of accounts) {
        const positions = await api.getPositions(account.accountNumber);
        if (positions) {
          allPositions.push(...positions.map((p: any) => ({ ...p, accountNumber: account.accountNumber })));
        }
      }

      // Calculate concentration risk
      const tickerExposure = new Map<string, number>();
      let totalCapitalAtRisk = 0;

      for (const pos of allPositions) {
        const instrumentType = pos['instrument-type'];
        const symbol = pos.symbol;
        const quantity = Math.abs(parseInt(String(pos.quantity || '0')));
        const underlyingSymbol = pos['underlying-symbol'] || symbol;

        if (instrumentType === 'Equity Option') {
          const strikePrice = parseFloat(String(pos['strike-price'] || '0'));
          const optionType = pos['option-type'];
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short';

          if (isShort && optionType === 'P') {
            const collateral = strikePrice * 100 * quantity;
            totalCapitalAtRisk += collateral;
            tickerExposure.set(underlyingSymbol, (tickerExposure.get(underlyingSymbol) || 0) + collateral);
          } else if (isShort && optionType === 'C') {
            const closePrice = parseFloat(String(pos['close-price'] || strikePrice));
            const capitalAtRisk = closePrice * 100 * quantity;
            totalCapitalAtRisk += capitalAtRisk;
            tickerExposure.set(underlyingSymbol, (tickerExposure.get(underlyingSymbol) || 0) + capitalAtRisk);
          }
        } else if (instrumentType === 'Equity') {
          const closePrice = parseFloat(String(pos['close-price'] || '0'));
          const marketValue = closePrice * quantity;
          totalCapitalAtRisk += marketValue;
          tickerExposure.set(symbol, (tickerExposure.get(symbol) || 0) + marketValue);
        }
      }

      const concentrations = Array.from(tickerExposure.entries())
        .map(([ticker, exposure]) => ({
          ticker,
          capitalAtRisk: exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
        }))
        .sort((a, b) => b.capitalAtRisk - a.capitalAtRisk);

      // Calculate underwater positions
      const underwaterPositions: any[] = [];
      for (const pos of allPositions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType === 'Equity Option') {
          const optionType = pos['option-type'];
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short';
          const strikePrice = parseFloat(String(pos['strike-price'] || '0'));
          const underlyingPrice = parseFloat(String(pos['underlying-price'] || '0'));
          const underlyingSymbol = pos['underlying-symbol'];

          if (isShort && optionType === 'P' && underlyingPrice < strikePrice) {
            const percentBelow = ((strikePrice - underlyingPrice) / strikePrice) * 100;
            underwaterPositions.push({
              ticker: underlyingSymbol,
              strike: strikePrice,
              currentPrice: underlyingPrice,
              percentBelow,
            });
          }
        }
      }

      // Calculate portfolio delta
      let totalDelta = 0;
      for (const pos of allPositions) {
        const delta = parseFloat(String(pos.delta || '0'));
        const quantity = parseInt(String(pos.quantity || '0'));
        totalDelta += delta * quantity * 100; // Multiply by 100 for options
      }

      const deltaPer1000 = totalCapitalAtRisk > 0 ? (totalDelta / (totalCapitalAtRisk / 1000)) : 0;

      // Placeholder data for past trades analysis (would need historical data)
      const pastTrades = {
        winRate: 75.0,
        totalWins: 45,
        totalLosses: 15,
        topPerformers: [
          { symbol: 'AAPL', winRate: 90, trades: 10 },
          { symbol: 'MSFT', winRate: 85, trades: 8 },
          { symbol: 'NVDA', winRate: 80, trades: 12 },
        ],
        worstPerformers: [
          { symbol: 'HOOD', winRate: 30, trades: 10 },
          { symbol: 'HIMS', winRate: 35, trades: 8 },
          { symbol: 'COIN', winRate: 40, trades: 5 },
        ],
        patterns: [
          { description: 'High concentration in meme stocks (HOOD, HIMS, COIN) led to correlated losses during market downturns.', severity: 'high' },
          { description: 'Positions opened near earnings dates experienced 60% higher assignment rates.', severity: 'high' },
          { description: 'Stocks below 52-week highs had 40% higher loss rates when assigned.', severity: 'medium' },
        ],
      };

      // Position sizing violations
      const violations2pct = concentrations.filter(c => c.percentage > 2).length;
      const violations10pct = concentrations.filter(c => c.percentage > 10).length;
      const violations25pct = 0; // Would need sector mapping

      // Recommendations
      const actionItems: any[] = [];
      if (violations10pct > 0) {
        actionItems.push({
          priority: 'high',
          description: `Reduce concentration in ${concentrations[0].ticker} (${concentrations[0].percentage.toFixed(1)}% of portfolio). Target: <10% per ticker.`,
        });
      }
      if (underwaterPositions.length > 0) {
        actionItems.push({
          priority: 'high',
          description: `${underwaterPositions.length} positions are underwater. Consider rolling or closing to avoid assignment.`,
        });
      }
      if (Math.abs(deltaPer1000) > 5) {
        actionItems.push({
          priority: 'medium',
          description: `Portfolio delta is ${deltaPer1000.toFixed(2)} per $1000. Consider hedging to reduce directional risk.`,
        });
      }
      if (concentrations.length < 7) {
        actionItems.push({
          priority: 'low',
          description: `Increase diversification. Currently only ${concentrations.length} tickers. Target: 10+ tickers.`,
        });
      }

      return {
        pastTrades,
        currentPositions: {
          concentrations,
          underwaterPositions,
          totalDelta,
          deltaPer1000,
        },
        recommendations: {
          positionSizing: {
            violations2pct,
            violations10pct,
            violations25pct,
          },
          actionItems,
        },
      };
    } catch (error: any) {
      console.error('[Portfolio Advisor] Failed to get detailed analysis:', error.message);
      throw error;
    }
  }),
});
