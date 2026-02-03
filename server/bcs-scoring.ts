/**
 * Bear Call Spread Scoring System
 * Strategy-specific scoring with detailed breakdowns
 * 
 * Weights:
 * - Technical Setup (40%): RSI (20) + BB %B (20) - OVERBOUGHT indicators
 * - Greeks & Spread Efficiency (30%): Short Delta (10) + Spread Efficiency (10) + DTE (5) + IV Rank (5)
 * - Premium Quality (20%): Credit/Width Ratio (15) + Bid-Ask Spread (5)
 * - Overall Quality (10%): Liquidity (5) + Stock Quality (5)
 */

import { BearCallSpreadOpportunity } from './bear-call-pricing';

export interface BCSScoreBreakdown {
  technical: number; // RSI + BB (40 points)
  greeks: number; // Short Delta + Spread Efficiency + DTE + IV Rank (30 points)
  premium: number; // Credit/Width Ratio + Spread (20 points)
  quality: number; // Liquidity + Mag 7 (10 points)
  total: number; // Sum of all (0-100)
}

export interface BCScoredOpportunity extends BearCallSpreadOpportunity {
  score: number;
  scoreBreakdown: BCSScoreBreakdown;
}

/**
 * Calculate Bear Call Spread Composite Score (0-100) with detailed breakdown
 */
export function calculateBCSScore(opp: BearCallSpreadOpportunity): { score: number; breakdown: BCSScoreBreakdown } {
  let technicalScore = 0;
  let greeksScore = 0;
  let premiumScore = 0;
  let qualityScore = 0;

  // ===== TECHNICAL SETUP (40 points) - OVERBOUGHT INDICATORS =====
  
  // RSI - Overbought Indicator (20 points)
  // Higher RSI = better for bear call spreads (stock likely to pull back)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 75) {
      technicalScore += 20; // Extremely overbought - excellent
    } else if (rsi > 70) {
      technicalScore += 18; // Overbought - very good
    } else if (rsi > 65) {
      technicalScore += 15; // Approaching overbought - good
    } else if (rsi > 60) {
      technicalScore += 12; // Neutral-bullish - acceptable
    } else if (rsi > 50) {
      technicalScore += 8; // Neutral - marginal
    } else if (rsi > 40) {
      technicalScore += 4; // Neutral-bearish - poor
    }
    // < 40 = 0 points (oversold - bad for bear call spreads)
  } else {
    technicalScore += 10; // Neutral if no data
  }

  // Bollinger Band %B (20 points)
  // Higher %B = more overbought = better for bear call spreads
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb > 1.0) {
      technicalScore += 20; // Above upper band - excellent
    } else if (bb > 0.85) {
      technicalScore += 18; // Near upper band - very good
    } else if (bb > 0.70) {
      technicalScore += 15; // Upper third - good
    } else if (bb > 0.50) {
      technicalScore += 10; // Upper half - acceptable
    } else if (bb > 0.30) {
      technicalScore += 5; // Lower half - poor
    }
    // < 0.30 = 0 points (lower band - bad for bear call spreads)
  } else {
    technicalScore += 10; // Neutral if no data
  }

  // ===== GREEKS & SPREAD EFFICIENCY (30 points) =====
  
  // Short Leg Delta - Primary Risk Indicator (10 points)
  // For bear call spreads, we want the short call in the 0.20-0.30 range
  const shortDelta = Math.abs(opp.delta || 0);
  if (shortDelta >= 0.20 && shortDelta <= 0.29) {
    greeksScore += 10; // Perfect range
  } else if ((shortDelta >= 0.15 && shortDelta < 0.20) || (shortDelta > 0.29 && shortDelta <= 0.35)) {
    greeksScore += 8; // Good range
  } else if ((shortDelta >= 0.10 && shortDelta < 0.15) || (shortDelta > 0.35 && shortDelta <= 0.40)) {
    greeksScore += 5; // Acceptable
  } else if (shortDelta > 0 && shortDelta < 0.10) {
    greeksScore += 2; // Too far OTM - low premium
  } else if (shortDelta > 0.40) {
    greeksScore += 2; // Too close ITM - high risk
  }

  // Spread Efficiency - Delta Separation & Width (10 points)
  const longDelta = Math.abs(opp.longDelta || 0);
  const deltaSeparation = Math.abs(shortDelta - longDelta);
  const spreadWidth = opp.spreadWidth;
  
  // Delta separation scoring (5 points)
  if (deltaSeparation >= 0.10 && deltaSeparation <= 0.20) {
    greeksScore += 5; // Ideal protection
  } else if (deltaSeparation >= 0.05 && deltaSeparation < 0.10) {
    greeksScore += 3; // Some protection
  } else if (deltaSeparation >= 0.20 && deltaSeparation <= 0.30) {
    greeksScore += 3; // More protection, less premium
  } else {
    greeksScore += 1; // Too close or too far
  }
  
  // Width efficiency scoring (5 points)
  if (spreadWidth <= 2) {
    greeksScore += 5; // Tight spread - capital efficient
  } else if (spreadWidth <= 5) {
    greeksScore += 4; // Standard spread
  } else if (spreadWidth <= 10) {
    greeksScore += 2; // Wide spread - more capital at risk
  } else {
    greeksScore += 1; // Very wide - inefficient
  }

  // DTE - Time Decay Optimization (5 points)
  const dte = opp.dte;
  if (dte >= 7 && dte <= 10) {
    greeksScore += 5; // Weekly sweet spot
  } else if (dte >= 11 && dte <= 14) {
    greeksScore += 4; // Two weeks
  } else if (dte >= 15 && dte <= 21) {
    greeksScore += 3; // Three weeks
  } else if (dte >= 22 && dte <= 30) {
    greeksScore += 2; // Monthly
  } else if (dte >= 4 && dte < 7) {
    greeksScore += 2; // Very short
  }
  // < 4 or > 30 = 0 points

  // IV Rank - Premium Environment (5 points)
  const ivRank = opp.ivRank;
  if (ivRank !== null && ivRank !== undefined) {
    if (ivRank > 70) {
      greeksScore += 5; // High IV - excellent premium
    } else if (ivRank > 50) {
      greeksScore += 4; // Elevated IV - good
    } else if (ivRank > 30) {
      greeksScore += 3; // Moderate IV - acceptable
    } else if (ivRank > 10) {
      greeksScore += 1; // Low IV - thin premium
    }
    // < 10 = 0 points (very low IV)
  } else {
    greeksScore += 2; // Neutral if no data
  }

  // ===== PREMIUM QUALITY (20 points) =====
  
  // Credit/Width Ratio - Capital Efficiency (15 points)
  // Target: 25-40% of spread width as credit
  const creditWidthRatio = (opp.netCredit / opp.spreadWidth) * 100;
  
  if (creditWidthRatio >= 25 && creditWidthRatio <= 40) {
    premiumScore += 15; // Ideal range
  } else if (creditWidthRatio >= 20 && creditWidthRatio < 25) {
    premiumScore += 12; // Acceptable
  } else if (creditWidthRatio >= 40 && creditWidthRatio <= 50) {
    premiumScore += 12; // High credit but more risk
  } else if (creditWidthRatio >= 15 && creditWidthRatio < 20) {
    premiumScore += 8; // Marginal
  } else if (creditWidthRatio > 50) {
    premiumScore += 5; // Very high risk
  }
  // < 15% = 0 points (too thin)

  // Combined Bid-Ask Spread - Execution Quality (5 points)
  const spreadPct = opp.spreadPct || 0;
  
  if (spreadPct < 10) {
    premiumScore += 5; // Tight spread - excellent
  } else if (spreadPct < 20) {
    premiumScore += 4; // Acceptable
  } else if (spreadPct < 30) {
    premiumScore += 3; // Wide spread - caution
  } else if (spreadPct < 50) {
    premiumScore += 1; // Very wide - poor execution
  }
  // > 50% = 0 points (illiquid)

  // ===== OVERALL QUALITY (10 points) =====
  
  // Liquidity - Both Legs (5 points)
  // For spreads, we need liquidity on both short and long legs
  const shortLiquidity = (opp.openInterest || 0) + (opp.volume || 0);
  
  if (shortLiquidity > 500) {
    qualityScore += 5; // Highly liquid
  } else if (shortLiquidity > 200) {
    qualityScore += 4; // Good liquidity
  } else if (shortLiquidity > 100) {
    qualityScore += 3; // Acceptable
  } else if (shortLiquidity > 50) {
    qualityScore += 2; // Marginal
  } else if (shortLiquidity > 0) {
    qualityScore += 1; // Poor liquidity
  }

  // Stock Quality - Mag 7 preference (5 points)
  const mag7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];
  const isMag7 = mag7.includes(opp.symbol);
  
  if (isMag7) {
    qualityScore += 5; // Mag 7 - premium quality
  } else {
    // Non-Mag7 stocks get partial credit based on volume (proxy for quality)
    const volume = opp.volume || 0;
    if (volume > 1000) {
      qualityScore += 3; // High volume - good quality
    } else if (volume > 500) {
      qualityScore += 2; // Moderate volume
    } else if (volume > 100) {
      qualityScore += 1; // Low volume
    }
  }

  const totalScore = technicalScore + greeksScore + premiumScore + qualityScore;

  return {
    score: Math.round(totalScore),
    breakdown: {
      technical: Math.round(technicalScore),
      greeks: Math.round(greeksScore),
      premium: Math.round(premiumScore),
      quality: Math.round(qualityScore),
      total: Math.round(totalScore),
    },
  };
}

/**
 * Score all BCS opportunities and sort by score descending
 */
export function scoreBCSOpportunities(opportunities: BearCallSpreadOpportunity[]): BCScoredOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateBCSScore(opp);
    return {
      ...opp,
      score,
      scoreBreakdown: breakdown,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
