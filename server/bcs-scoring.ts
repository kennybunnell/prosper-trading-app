/**
 * Bear Call Spread Scoring System
 * Strategy-specific scoring with detailed breakdowns
 *
 * Weights (DIRECTION-FIRST):
 * - Direction (35%): 14-day trend alignment — MOST IMPORTANT
 *   BCS profits when market goes DOWN or sideways → bearish trend = max score
 * - Greeks & Spread Efficiency (25%): Short Delta (10) + Spread Efficiency (8) + DTE (4) + Strike Safety (3)
 *   Strike Safety uses 1-sigma Expected Move when iv is available; falls back to IV Rank
 * - Technical Setup (20%): RSI (12) + BB %B (8) — confirms directional bias
 * - Premium Quality (15%): Credit/Width Ratio (10) + Bid-Ask Spread (5)
 * - Overall Quality (5%): Liquidity (3) + Stock Quality (2)
 *
 * Index Mode (auto-detected from symbol):
 * - RSI/BB are not meaningful for index products → full 20-pt neutral credit awarded
 * - Delta brackets recalibrated: index options trade at 0.02–0.06 OTM (vs equity 0.20–0.30)
 * - Width scoring recalibrated: 10-wide is standard for index (vs 2-5 for equity)
 *
 * Direction Scoring:
 * - trend14d is the 14-day price change percentage for the underlying
 * - Strong bearish (< -3%): 35 pts — perfect alignment for BCS
 * - Mild bearish (-1.5% to -3%): 28 pts — good alignment
 * - Neutral (±1.5%): 15 pts — acceptable, sideways market
 * - Mild bullish (+1.5% to +3%): 5 pts — caution, fighting the trend
 * - Strong bullish (> +3%): 0 pts — wrong direction, do not trade
 */

import { BearCallSpreadOpportunity } from './bear-call-pricing';
import { isTrueIndexOption } from '../shared/orderUtils';

export interface BCSScoreBreakdown {
  direction: number;  // 14-day trend alignment (35 points) — PRIMARY
  technical: number;  // RSI + BB (20 points)
  greeks: number;     // Short Delta + Spread Efficiency + DTE + IV Rank (25 points)
  premium: number;    // Credit/Width Ratio + Spread (15 points)
  quality: number;    // Liquidity + Stock Quality (5 points)
  total: number;      // Sum of all (0-100)
  isIndex: boolean;   // Whether index scoring was applied
  trend14d?: number;  // 14-day price change % used for direction scoring
  trendBias?: 'Bearish' | 'Neutral' | 'Bullish'; // Human-readable bias
}

export interface BCScoredOpportunity extends BearCallSpreadOpportunity {
  score: number;
  scoreBreakdown: BCSScoreBreakdown;
  trend14d?: number;
  trendBias?: 'Bearish' | 'Neutral' | 'Bullish';
}

/**
 * Calculate Bear Call Spread Composite Score (0-100) with detailed breakdown.
 *
 * Index mode is auto-detected from opp.symbol using isTrueIndexOption().
 * trend14d: 14-day price change percentage (positive = bullish, negative = bearish)
 */
export function calculateBCSScore(
  opp: BearCallSpreadOpportunity & { trend14d?: number },
  options: { isIndexMode?: boolean } = {}
): { score: number; breakdown: BCSScoreBreakdown } {
  const isIndexMode = isTrueIndexOption(opp.symbol) || (options.isIndexMode ?? false);

  let directionScore = 0;
  let technicalScore = 0;
  let greeksScore = 0;
  let premiumScore = 0;
  let qualityScore = 0;

  // ===== DIRECTION (35 points) — PRIMARY FACTOR =====
  // BCS profits when market goes DOWN or stays flat → bearish trend = best score
  const trend14d = opp.trend14d;
  let trendBias: 'Bearish' | 'Neutral' | 'Bullish' = 'Neutral';

  if (trend14d !== undefined && trend14d !== null) {
    if (trend14d <= -3.0) {
      directionScore = 35;  // Strong bearish — perfect for BCS
      trendBias = 'Bearish';
    } else if (trend14d <= -1.5) {
      directionScore = 28;  // Mild bearish — good alignment
      trendBias = 'Bearish';
    } else if (trend14d < 1.5) {
      directionScore = 15;  // Neutral — sideways market, acceptable
      trendBias = 'Neutral';
    } else if (trend14d < 3.0) {
      directionScore = 5;   // Mild bullish — caution, fighting trend
      trendBias = 'Bullish';
    } else {
      directionScore = 0;   // Strong bullish — wrong direction, avoid
      trendBias = 'Bullish';
    }
  } else {
    // No trend data available — award neutral credit
    directionScore = 12;
    trendBias = 'Neutral';
  }

  // ===== TECHNICAL SETUP (20 points) - OVERBOUGHT INDICATORS =====
  // For INDEX products: RSI/BB not meaningful — award full neutral credit (12+8=20)
  const rsi = opp.rsi;
  const bb = opp.bbPctB;

  if (isIndexMode) {
    technicalScore += 12; // RSI neutral for index
    technicalScore += 8;  // BB neutral for index
  } else {
    // RSI - Overbought Indicator (12 points) — confirms bearish direction
    if (rsi !== null && rsi !== undefined) {
      if (rsi > 75) {
        technicalScore += 12;
      } else if (rsi > 70) {
        technicalScore += 10;
      } else if (rsi > 65) {
        technicalScore += 8;
      } else if (rsi > 60) {
        technicalScore += 6;
      } else if (rsi > 50) {
        technicalScore += 4;
      } else if (rsi > 40) {
        technicalScore += 2;
      }
    } else {
      technicalScore += 6; // Neutral if no RSI data
    }

    // Bollinger Band %B (8 points) — confirms overbought/bearish
    if (bb !== null && bb !== undefined) {
      if (bb > 1.0) {
        technicalScore += 8;
      } else if (bb > 0.85) {
        technicalScore += 7;
      } else if (bb > 0.70) {
        technicalScore += 5;
      } else if (bb > 0.50) {
        technicalScore += 3;
      } else if (bb > 0.30) {
        technicalScore += 1;
      }
    } else {
      technicalScore += 4; // Neutral if no BB data
    }
  }

  // ===== GREEKS & SPREAD EFFICIENCY (25 points) =====

  // Short Leg Delta - Primary Risk Indicator (10 points)
  const shortDelta = Math.abs(opp.delta || 0);

  if (isIndexMode) {
    if (shortDelta >= 0.02 && shortDelta <= 0.06) {
      greeksScore += 10;
    } else if ((shortDelta > 0.06 && shortDelta <= 0.10) || (shortDelta >= 0.01 && shortDelta < 0.02)) {
      greeksScore += 8;
    } else if (shortDelta > 0.10 && shortDelta <= 0.15) {
      greeksScore += 5;
    } else if (shortDelta > 0.15 && shortDelta <= 0.20) {
      greeksScore += 3;
    } else if (shortDelta > 0.20) {
      greeksScore += 1;
    } else if (shortDelta > 0 && shortDelta < 0.01) {
      greeksScore += 2;
    }
  } else {
    if (shortDelta >= 0.20 && shortDelta <= 0.29) {
      greeksScore += 10;
    } else if ((shortDelta >= 0.15 && shortDelta < 0.20) || (shortDelta > 0.29 && shortDelta <= 0.35)) {
      greeksScore += 8;
    } else if ((shortDelta >= 0.10 && shortDelta < 0.15) || (shortDelta > 0.35 && shortDelta <= 0.40)) {
      greeksScore += 5;
    } else if (shortDelta > 0 && shortDelta < 0.10) {
      greeksScore += 2;
    } else if (shortDelta > 0.40) {
      greeksScore += 2;
    }
  }

  // Spread Efficiency - Delta Separation & Width (8 points)
  const longDelta = Math.abs(opp.longDelta || 0);
  const deltaSeparation = Math.abs(shortDelta - longDelta);
  const spreadWidth = opp.spreadWidth;

  // Delta separation scoring (4 points)
  if (deltaSeparation >= 0.10 && deltaSeparation <= 0.20) {
    greeksScore += 4;
  } else if (deltaSeparation >= 0.05 && deltaSeparation < 0.10) {
    greeksScore += 2;
  } else if (deltaSeparation >= 0.20 && deltaSeparation <= 0.30) {
    greeksScore += 2;
  } else {
    greeksScore += 1;
  }

  // Width efficiency scoring (4 points)
  if (isIndexMode) {
    if (spreadWidth >= 5 && spreadWidth <= 15) {
      greeksScore += 4;
    } else if (spreadWidth > 15 && spreadWidth <= 25) {
      greeksScore += 3;
    } else if (spreadWidth > 25 && spreadWidth <= 50) {
      greeksScore += 2;
    } else if (spreadWidth < 5) {
      greeksScore += 2;
    } else {
      greeksScore += 1;
    }
  } else {
    if (spreadWidth <= 2) {
      greeksScore += 4;
    } else if (spreadWidth <= 5) {
      greeksScore += 3;
    } else if (spreadWidth <= 10) {
      greeksScore += 2;
    } else {
      greeksScore += 1;
    }
  }

  // DTE - Time Decay Optimization (4 points)
  const dte = opp.dte;
  if (dte >= 7 && dte <= 10) {
    greeksScore += 4;
  } else if (dte >= 11 && dte <= 14) {
    greeksScore += 3;
  } else if (dte >= 15 && dte <= 21) {
    greeksScore += 2;
  } else if (dte >= 22 && dte <= 30) {
    greeksScore += 1;
  } else if (dte >= 4 && dte < 7) {
    greeksScore += 1;
  }

  // Strike Safety vs Expected Move (3 points) — is the short strike beyond the 1-sigma EM?
  // Uses raw IV when available; falls back to IV Rank as a proxy
  const ivRank = opp.ivRank;
  const ivForSafety = (opp as any).iv as number | null | undefined;
  const distanceOtm = (opp as any).distanceOtm as number | undefined; // % distance from current price
  if (ivForSafety && ivForSafety > 0 && opp.currentPrice > 0 && dte > 0 && distanceOtm !== undefined) {
    const emPct = (ivForSafety / 100) * Math.sqrt(dte / 365) * 100; // EM as % of price
    const safetyRatio = distanceOtm / emPct;
    if (safetyRatio >= 1.5)       greeksScore += 3; // well beyond EM — very safe
    else if (safetyRatio >= 1.0)  greeksScore += 2; // at or beyond EM boundary
    else if (safetyRatio >= 0.75) greeksScore += 1; // close to EM
    // < 0.75 = 0 (inside EM — risky)
  } else if (ivRank !== null && ivRank !== undefined) {
    // Fallback: IV Rank as premium environment proxy
    if (ivRank > 70)      greeksScore += 3;
    else if (ivRank > 50) greeksScore += 2;
    else if (ivRank > 30) greeksScore += 1;
  } else {
    greeksScore += 1; // Neutral if no data
  }

  // ===== PREMIUM QUALITY (15 points) =====

  // Credit/Width Ratio - Capital Efficiency (10 points)
  const creditWidthRatio = opp.spreadWidth > 0 ? (opp.netCredit / opp.spreadWidth) * 100 : 0;

  if (creditWidthRatio >= 25 && creditWidthRatio <= 40) {
    premiumScore += 10;
  } else if (creditWidthRatio >= 20 && creditWidthRatio < 25) {
    premiumScore += 8;
  } else if (creditWidthRatio >= 40 && creditWidthRatio <= 50) {
    premiumScore += 8;
  } else if (creditWidthRatio >= 15 && creditWidthRatio < 20) {
    premiumScore += 5;
  } else if (creditWidthRatio > 50) {
    premiumScore += 3;
  }

  // Combined Bid-Ask Spread - Execution Quality (5 points)
  const spreadPct = opp.spreadPct || 0;
  if (spreadPct < 10) {
    premiumScore += 5;
  } else if (spreadPct < 20) {
    premiumScore += 3;
  } else if (spreadPct < 30) {
    premiumScore += 2;
  } else if (spreadPct < 50) {
    premiumScore += 1;
  }

  // ===== OVERALL QUALITY (5 points) =====

  // Liquidity (3 points)
  const shortLiquidity = (opp.openInterest || 0) + (opp.volume || 0);
  if (shortLiquidity > 500) {
    qualityScore += 3;
  } else if (shortLiquidity > 200) {
    qualityScore += 2;
  } else if (shortLiquidity > 50) {
    qualityScore += 1;
  }

  // Stock/Index Quality (2 points)
  if (isIndexMode) {
    qualityScore += 2;
  } else {
    const mag7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];
    if (mag7.includes(opp.symbol)) {
      qualityScore += 2;
    } else if ((opp.volume || 0) > 500) {
      qualityScore += 1;
    }
  }

  const totalScore = directionScore + technicalScore + greeksScore + premiumScore + qualityScore;

  return {
    score: Math.round(totalScore),
    breakdown: {
      direction: Math.round(directionScore),
      technical: Math.round(technicalScore),
      greeks: Math.round(greeksScore),
      premium: Math.round(premiumScore),
      quality: Math.round(qualityScore),
      total: Math.round(totalScore),
      isIndex: isIndexMode,
      trend14d: trend14d,
      trendBias,
    },
  };
}

/**
 * Score all BCS opportunities and sort by score descending.
 * trend14dMap: optional map of symbol → 14-day price change %
 */
export function scoreBCSOpportunities(
  opportunities: (BearCallSpreadOpportunity & { trend14d?: number })[],
  options: { isIndexMode?: boolean } = {}
): BCScoredOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateBCSScore(opp, options);
    return {
      ...opp,
      score,
      scoreBreakdown: breakdown,
      trend14d: opp.trend14d,
      trendBias: breakdown.trendBias,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
