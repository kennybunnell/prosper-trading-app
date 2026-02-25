/**
 * Risk Assessment Service
 * Calculates risk badges for trading opportunities
 */

import { TradierAPI, TechnicalIndicators, Quote } from './tradier';
import {
  RiskBadge,
  RiskAssessment,
  createRiskBadge,
  calculateOverallRisk,
  MAG_7,
  SP_100,
  EarningsDate,
} from '../shared/riskBadges';

interface RiskFactors {
  ivRank: number | null;
  week52PercentInRange: number | null;
  momentum20Day: number | null;
  currentPrice: number;
  earningsDate: string | null;
}

/**
 * Calculate risk badges for a symbol
 */
export async function calculateRiskBadges(
  symbol: string,
  tradierAPI: TradierAPI,
  earningsMap: Map<string, string>,
  indicators?: TechnicalIndicators,
  quote?: Quote
): Promise<RiskBadge[]> {
  const badges: RiskBadge[] = [];

  try {
    // Fetch data if not provided
    if (!indicators) {
      indicators = await tradierAPI.getTechnicalIndicators(symbol);
    }
    if (!quote) {
      quote = await tradierAPI.getQuote(symbol);
    }

    const currentPrice = quote.last;
    const week52High = quote.week_52_high;
    const week52Low = quote.week_52_low;

    // Calculate 52-week position
    const week52PercentInRange = indicators.week52Range?.percentInRange ?? null;

    // Calculate IV Rank (if available from indicators)
    const ivRank = indicators.ivRank;

    // Calculate 20-day momentum from moving average
    const momentum20Day = indicators.movingAverage?.percentFromSMA ?? null;

    // Get earnings date
    const earningsDate = earningsMap.get(symbol) || null;

    // 1. Extreme Volatility Badge (IV Rank > 70%)
    if (ivRank !== null && ivRank > 70) {
      badges.push(createRiskBadge('extreme-volatility', `IV Rank: ${ivRank.toFixed(0)}%. Extreme volatility detected.`));
    }

    // 2. Below Support Badge (< 40% of 52-week range)
    if (week52PercentInRange !== null && week52PercentInRange < 40) {
      badges.push(createRiskBadge('below-support', `Stock is at ${week52PercentInRange.toFixed(0)}% of 52-week range. Significant downside risk.`));
    }

    // 3. Earnings Badges
    if (earningsDate) {
      const today = new Date();
      const earningsDateObj = new Date(earningsDate);
      const daysUntil = Math.floor((earningsDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntil >= 0 && daysUntil <= 7) {
        badges.push(createRiskBadge('earnings-this-week', `Earnings in ${daysUntil} days (${earningsDate}). Extreme gap risk.`));
      } else if (daysUntil > 7 && daysUntil <= 14) {
        badges.push(createRiskBadge('earnings-soon', `Earnings in ${daysUntil} days (${earningsDate}). Elevated volatility expected.`));
      }
    }

    // 4. Momentum Reversal Badge (price < 20-day SMA by > 5%)
    if (momentum20Day !== null && momentum20Day < -5) {
      badges.push(createRiskBadge('momentum-reversal', `Price is ${Math.abs(momentum20Day).toFixed(1)}% below 20-day SMA. Downtrend detected.`));
    }

    // 5. Blue Chip Badge (Mag 7 or S&P 100 + Market Cap > $100B)
    const isBlueChip = MAG_7.includes(symbol) || SP_100.includes(symbol);
    if (isBlueChip) {
      const isMag7 = MAG_7.includes(symbol);
      badges.push(createRiskBadge('blue-chip', isMag7 ? `Magnificent 7 stock. High liquidity and assignment-worthy.` : `S&P 100 stock. Large-cap, liquid, lower risk.`));
    }

    return badges;
  } catch (error: any) {
    console.error(`[Risk Assessment] Failed to calculate badges for ${symbol}:`, error.message);
    return badges; // Return whatever badges we calculated before the error
  }
}

/**
 * Calculate risk assessment for multiple symbols
 * Returns a map of symbol -> RiskAssessment
 */
export async function calculateBulkRiskAssessments(
  symbols: string[],
  tradierAPI: TradierAPI
): Promise<Map<string, RiskAssessment>> {
  const assessmentMap = new Map<string, RiskAssessment>();

  try {
    // Fetch earnings calendar for all symbols
    console.log(`[Risk Assessment] Fetching earnings calendar for ${symbols.length} symbols...`);
    const earningsMap = await tradierAPI.getEarningsCalendar(symbols);
    console.log(`[Risk Assessment] Found earnings dates for ${earningsMap.size} symbols`);

    // Process symbols in parallel with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);

      const batchPromises = batch.map(async (symbol) => {
        try {
          const badges = await calculateRiskBadges(symbol, tradierAPI, earningsMap);
          const overallRisk = calculateOverallRisk(badges);

          assessmentMap.set(symbol, {
            symbol,
            badges,
            overallRisk,
          });
        } catch (error: any) {
          console.error(`[Risk Assessment] Failed for ${symbol}:`, error.message);
          // Set empty assessment on error
          assessmentMap.set(symbol, {
            symbol,
            badges: [],
            overallRisk: 'low',
          });
        }
      });

      await Promise.allSettled(batchPromises);
    }

    return assessmentMap;
  } catch (error: any) {
    console.error('[Risk Assessment] Bulk assessment failed:', error.message);
    return assessmentMap;
  }
}

/**
 * Get earnings dates for symbols
 * Returns array of EarningsDate objects
 */
export async function getEarningsDates(
  symbols: string[],
  tradierAPI: TradierAPI
): Promise<EarningsDate[]> {
  try {
    const earningsMap = await tradierAPI.getEarningsCalendar(symbols);
    const today = new Date();
    const earningsDates: EarningsDate[] = [];

    earningsMap.forEach((dateStr, symbol) => {
      const earningsDate = new Date(dateStr);
      const daysUntil = Math.floor((earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      earningsDates.push({
        symbol,
        date: dateStr,
        daysUntil,
      });
    });

    return earningsDates.sort((a, b) => a.daysUntil - b.daysUntil);
  } catch (error: any) {
    console.error('[Risk Assessment] Failed to get earnings dates:', error.message);
    return [];
  }
}
