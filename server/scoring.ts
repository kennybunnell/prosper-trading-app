/**
 * Optimized Scoring System for CSP Opportunities
 * Strategy-specific scoring with detailed breakdowns
 */

import { CSPOpportunity } from './tradier';

export interface ScoreBreakdown {
  technical: number; // RSI + BB (40 points)
  greeks: number; // Delta + DTE + IV Rank (30 points)
  premium: number; // Weekly Return + Spread (20 points)
  quality: number; // Mag 7 + Market Cap (10 points)
  total: number; // Sum of all (0-100)
}

export interface ScoredOpportunity extends CSPOpportunity {
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

/**
 * Calculate CSP Composite Score (0-100) with detailed breakdown
 * 
 * Weights:
 * - Technical Setup (40%): RSI (20) + BB %B (20)
 * - Greeks & Timing (30%): Delta (15) + DTE (10) + IV Rank (5)
 * - Premium Quality (20%): Weekly Return (15) + Spread (5)
 * - Stock Quality (10%): Mag 7 (5) + Market Cap (5)
 */
export function calculateCSPScore(opp: CSPOpportunity): { score: number; breakdown: ScoreBreakdown } {
  let technicalScore = 0;
  let greeksScore = 0;
  let premiumScore = 0;
  let qualityScore = 0;

  // ===== TECHNICAL SETUP (40 points) =====
  
  // RSI - Oversold Indicator (20 points)
  // Lower is better for CSP (oversold stocks bounce)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi < 25) {
      technicalScore += 20; // Deeply oversold - bounce likely
    } else if (rsi < 30) {
      technicalScore += 18; // Oversold - excellent
    } else if (rsi < 35) {
      technicalScore += 15; // Approaching oversold - very good
    } else if (rsi < 40) {
      technicalScore += 12; // Neutral-bearish - good
    } else if (rsi < 50) {
      technicalScore += 8; // Neutral - acceptable
    } else if (rsi < 60) {
      technicalScore += 4; // Neutral-bullish - caution
    }
    // > 60 = 0 points (overbought - avoid)
  } else {
    technicalScore += 10; // Neutral if no data
  }

  // Bollinger Band %B (20 points)
  // Lower is better for CSP (near lower band = oversold)
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb < 0) {
      technicalScore += 20; // Below lower band - extreme oversold
    } else if (bb < 0.15) {
      technicalScore += 18; // Near lower band - excellent
    } else if (bb < 0.30) {
      technicalScore += 15; // Lower third - very good
    } else if (bb < 0.50) {
      technicalScore += 10; // Middle - acceptable
    } else if (bb < 0.70) {
      technicalScore += 5; // Upper third - caution
    }
    // > 0.70 = 0 points (near/above upper band - avoid)
  } else {
    technicalScore += 10; // Neutral if no data
  }

  // ===== GREEKS & TIMING (30 points) =====
  
  // Delta - Probability Sweet Spot (15 points)
  // 0.20-0.29 = ideal (~70-80% OTM probability)
  const delta = Math.abs(opp.delta || 0);
  if (delta >= 0.20 && delta <= 0.29) {
    greeksScore += 15; // Ideal range
  } else if ((delta >= 0.15 && delta < 0.20) || (delta > 0.29 && delta <= 0.35)) {
    greeksScore += 12; // Good range (safer or higher premium)
  } else if ((delta >= 0.10 && delta < 0.15) || (delta > 0.35 && delta <= 0.40)) {
    greeksScore += 8; // Acceptable (very safe or aggressive)
  } else if (delta > 0 && delta < 0.10) {
    greeksScore += 3; // Too safe - thin premium
  } else if (delta > 0.40) {
    greeksScore += 3; // Too aggressive - high risk
  }

  // DTE - Time Decay Optimization (10 points)
  // 7-10 days = weekly sweet spot (max theta)
  const dte = opp.dte;
  if (dte >= 7 && dte <= 10) {
    greeksScore += 10; // Weekly sweet spot - max theta
  } else if (dte >= 11 && dte <= 14) {
    greeksScore += 9; // Still weekly - good
  } else if (dte >= 15 && dte <= 21) {
    greeksScore += 7; // Bi-weekly - acceptable
  } else if (dte >= 22 && dte <= 30) {
    greeksScore += 5; // Monthly - slower decay
  } else if (dte >= 31 && dte <= 45) {
    greeksScore += 3; // Longer term - much slower
  } else {
    greeksScore += 1; // Too long or too short
  }

  // IV Rank - Premium Environment (5 points)
  // Higher is better (elevated premium)
  const iv = opp.ivRank;
  if (iv !== null && iv !== undefined) {
    if (iv > 70) {
      greeksScore += 5; // Exceptional premium
    } else if (iv > 50) {
      greeksScore += 4; // Elevated premium
    } else if (iv > 30) {
      greeksScore += 3; // Normal premium
    } else if (iv > 15) {
      greeksScore += 2; // Low premium
    } else {
      greeksScore += 1; // Very low premium
    }
  } else {
    greeksScore += 2; // Neutral if no data
  }

  // ===== PREMIUM QUALITY (20 points) =====
  
  // Weekly Return % (15 points)
  // Target: 0.75-1.25% for conservative (3-5% monthly)
  const weekly = opp.weeklyPct || 0;
  if (weekly >= 1.5) {
    premiumScore += 15; // Excellent - exceeds 6%/month
  } else if (weekly >= 1.0) {
    premiumScore += 12; // Very good - 4-6%/month range
  } else if (weekly >= 0.75) {
    premiumScore += 10; // Good - meets 3%/month minimum
  } else if (weekly >= 0.50) {
    premiumScore += 6; // Acceptable - below target
  } else if (weekly >= 0.30) {
    premiumScore += 3; // Thin - only if other factors strong
  }
  // < 0.30% = 0 points (not worth the risk)

  // Bid-Ask Spread % (5 points)
  // Lower is better (easier to fill at mid)
  const spread = opp.spreadPct;
  if (spread !== null && spread !== undefined) {
    if (spread <= 2) {
      premiumScore += 5; // Tight - easy to fill at mid
    } else if (spread <= 5) {
      premiumScore += 4; // Normal - fillable
    } else if (spread <= 10) {
      premiumScore += 2; // Wide - harder to fill
    }
    // > 10% = 0 points (too wide - illiquid)
  } else {
    premiumScore += 2; // Neutral if no data
  }

  // ===== STOCK QUALITY (10 points) =====
  
  // Mag 7 Bonus (5 points)
  // Assignment-worthy companies for Wheel strategy
  const mag7 = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA'];
  if (mag7.includes(opp.symbol)) {
    qualityScore += 5;
  }

  // Market Cap Bonus (5 points)
  // Larger companies = more liquid, safer for assignment
  // Note: This would require market cap data from API
  // For now, using a proxy: if it's in the watchlist and has high volume, it's likely large cap
  if (opp.volume && opp.volume > 1000000) {
    qualityScore += 5; // High volume = likely large cap
  } else if (opp.volume && opp.volume > 500000) {
    qualityScore += 4;
  } else if (opp.volume && opp.volume > 100000) {
    qualityScore += 2;
  }

  // Calculate total score
  const totalScore = Math.round(technicalScore + greeksScore + premiumScore + qualityScore);

  return {
    score: totalScore,
    breakdown: {
      technical: Math.round(technicalScore),
      greeks: Math.round(greeksScore),
      premium: Math.round(premiumScore),
      quality: Math.round(qualityScore),
      total: totalScore,
    },
  };
}

/**
 * Score all opportunities and sort by score descending
 */
export function scoreOpportunities(opportunities: CSPOpportunity[]): ScoredOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateCSPScore(opp);
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

/**
 * Filter opportunities by preset criteria
 */
export interface PresetFilter {
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  dteMax: number;
  oiMin: number;
  volumeMin: number;
  rsiMin?: number;
  rsiMax?: number;
  ivRankMin?: number;
  bbMin?: number;
  bbMax?: number;
  minScore?: number;
  maxStrikePct?: number;
}

export const PRESET_FILTERS = {
  conservative: {
    deltaMin: 0.05,
    deltaMax: 0.40,
    dteMin: 7,
    dteMax: 60,
    oiMin: 10,
    volumeMin: 10,
    rsiMin: 0,
    rsiMax: 100,
    ivRankMin: 0,
    bbMin: 0,
    bbMax: 1.0,
    minScore: 50,
    maxStrikePct: 110,
  },
  medium: {
    deltaMin: 0.05,
    deltaMax: 0.40,
    dteMin: 7,
    dteMax: 60,
    oiMin: 10,
    volumeMin: 10,
    rsiMin: 0,
    rsiMax: 100,
    ivRankMin: 0,
    bbMin: 0,
    bbMax: 1.0,
    minScore: 40,
    maxStrikePct: 110,
  },
  aggressive: {
    deltaMin: 0.05,
    deltaMax: 0.40,
    dteMin: 7,
    dteMax: 60,
    oiMin: 10,
    volumeMin: 10,
    rsiMin: 0,
    rsiMax: 100,
    ivRankMin: 0,
    bbMin: 0,
    bbMax: 1.0,
    minScore: 30,
    maxStrikePct: 110,
  },
};

export function applyPresetFilter(
  opportunities: ScoredOpportunity[],
  preset: PresetFilter
): ScoredOpportunity[] {
  return opportunities.filter((opp) => {
    // Delta filter
    const delta = Math.abs(opp.delta);
    if (delta < preset.deltaMin || delta > preset.deltaMax) return false;

    // DTE filter
    if (opp.dte < preset.dteMin || opp.dte > preset.dteMax) return false;

    // OI filter
    if (opp.openInterest < preset.oiMin) return false;

    // Volume filter
    if (preset.volumeMin && opp.volume && opp.volume < preset.volumeMin) return false;

    // RSI filter (if specified)
    if (preset.rsiMin !== undefined && opp.rsi !== null && opp.rsi !== undefined && opp.rsi < preset.rsiMin) {
      return false;
    }
    if (preset.rsiMax !== undefined && preset.rsiMax < 100) {
      if (opp.rsi !== null && opp.rsi !== undefined && opp.rsi > preset.rsiMax) {
        return false;
      }
    }

    // IV Rank filter (if specified)
    if (preset.ivRankMin !== undefined && preset.ivRankMin > 0) {
      if (opp.ivRank !== null && opp.ivRank !== undefined && opp.ivRank < preset.ivRankMin) {
        return false;
      }
    }

    // BB %B filter (if specified)
    if (preset.bbMin !== undefined && opp.bbPctB !== null && opp.bbPctB !== undefined && opp.bbPctB < preset.bbMin) {
      return false;
    }
    if (preset.bbMax !== undefined && preset.bbMax < 1.0) {
      if (opp.bbPctB !== null && opp.bbPctB !== undefined && opp.bbPctB > preset.bbMax) {
        return false;
      }
    }

    // Score filter (if specified)
    if (preset.minScore !== undefined && opp.score < preset.minScore) {
      return false;
    }

    return true;
  });
}

/**
 * Select best opportunity per ticker based on score
 */
export function selectBestPerTicker(
  opportunities: ScoredOpportunity[],
  preset?: PresetFilter
): ScoredOpportunity[] {
  // Apply preset filter if provided
  let filtered = preset ? applyPresetFilter(opportunities, preset) : opportunities;

  // Group by symbol
  const bySymbol = new Map<string, ScoredOpportunity[]>();
  filtered.forEach((opp) => {
    if (!bySymbol.has(opp.symbol)) {
      bySymbol.set(opp.symbol, []);
    }
    bySymbol.get(opp.symbol)!.push(opp);
  });

  // Select best (highest score) per symbol
  const best: ScoredOpportunity[] = [];
  bySymbol.forEach((opps) => {
    const sorted = opps.sort((a, b) => b.score - a.score);
    best.push(sorted[0]);
  });

  return best;
}
