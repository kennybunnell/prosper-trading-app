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

/**
 * Bull Put Spread Scoring System
 * Adapted from CSP scoring with spread-specific adjustments
 */

import type { BullPutSpreadOpportunity } from './spread-pricing';

export interface BPSScoredOpportunity extends BullPutSpreadOpportunity {
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

/**
 * Calculate Bull Put Spread Composite Score (0-100) with detailed breakdown
 * 
 * Weights:
 * - Technical Setup (40%): RSI (20) + BB %B (20) - Same as CSP
 * - Greeks & Spread Efficiency (30%): Short Delta (10) + Spread Efficiency (10) + DTE (5) + IV Rank (5)
 * - Premium Quality (20%): Credit/Width Ratio (15) + Bid-Ask Spread (5)
 * - Overall Quality (10%): Liquidity Both Legs (5) + Stock Quality (5)
 */
export function calculateBPSScore(opp: BullPutSpreadOpportunity): { score: number; breakdown: ScoreBreakdown } {
  let technicalScore = 0;
  let greeksScore = 0;
  let premiumScore = 0;
  let qualityScore = 0;

  // ===== TECHNICAL SETUP (40 points) - SAME AS CSP =====
  
  // RSI - Oversold Indicator (20 points)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi < 25) {
      technicalScore += 20;
    } else if (rsi < 30) {
      technicalScore += 18;
    } else if (rsi < 35) {
      technicalScore += 15;
    } else if (rsi < 40) {
      technicalScore += 12;
    } else if (rsi < 50) {
      technicalScore += 8;
    } else if (rsi < 60) {
      technicalScore += 4;
    }
  } else {
    technicalScore += 10;
  }

  // Bollinger Band %B (20 points)
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb < 0) {
      technicalScore += 20;
    } else if (bb < 0.15) {
      technicalScore += 18;
    } else if (bb < 0.30) {
      technicalScore += 15;
    } else if (bb < 0.50) {
      technicalScore += 10;
    } else if (bb < 0.70) {
      technicalScore += 5;
    }
  } else {
    technicalScore += 10;
  }

  // ===== GREEKS & SPREAD EFFICIENCY (30 points) =====
  
  // Short Leg Delta - Primary Risk Indicator (10 points)
  // For spreads, we still want the short leg in the 0.20-0.30 range
  // The long leg provides protection, but short leg delta drives assignment risk
  const shortDelta = Math.abs(opp.delta || 0); // opp.delta is the net spread delta, but we need original short delta
  // Note: In BullPutSpreadOpportunity, the delta field represents net delta
  // We need to access the original CSP delta before spread calculation
  // For now, using net delta as proxy - ideally we'd store shortDelta separately
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

  // Spread Efficiency - Delta Separation & Width (10 points)
  // Ideal: Long leg provides meaningful protection (delta separation)
  // Good spread: long delta is 0.10-0.15 less than short delta
  // Width efficiency: narrower spreads (2-5 pts) score higher than wide (10 pts)
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
    greeksScore += 5;
  } else if (dte >= 11 && dte <= 14) {
    greeksScore += 4;
  } else if (dte >= 15 && dte <= 21) {
    greeksScore += 3;
  } else if (dte >= 22 && dte <= 30) {
    greeksScore += 2;
  } else {
    greeksScore += 1;
  }

  // IV Rank - Premium Environment (5 points)
  const iv = opp.ivRank;
  if (iv !== null && iv !== undefined) {
    if (iv > 70) {
      greeksScore += 5;
    } else if (iv > 50) {
      greeksScore += 4;
    } else if (iv > 30) {
      greeksScore += 3;
    } else if (iv > 15) {
      greeksScore += 2;
    } else {
      greeksScore += 1;
    }
  } else {
    greeksScore += 2;
  }

  // ===== PREMIUM QUALITY (20 points) =====
  
  // Credit/Width Ratio - Risk/Reward Efficiency (15 points)
  // Target: 25-40% of spread width as credit (industry standard for quality spreads)
  // Example: $5 wide spread, target $1.25-$2.00 credit
  const creditWidthRatio = opp.spreadWidth > 0 ? (opp.netCredit / opp.spreadWidth) * 100 : 0;
  
  if (creditWidthRatio >= 35) {
    premiumScore += 15; // Excellent - high premium capture
  } else if (creditWidthRatio >= 30) {
    premiumScore += 13; // Very good - 30%+ is strong
  } else if (creditWidthRatio >= 25) {
    premiumScore += 11; // Good - meets minimum target
  } else if (creditWidthRatio >= 20) {
    premiumScore += 8; // Acceptable - below target
  } else if (creditWidthRatio >= 15) {
    premiumScore += 4; // Thin - marginal
  }
  // < 15% = 0 points (not worth the risk)

  // Combined Bid-Ask Spread % (5 points)
  // For spreads, we need tight markets on BOTH legs
  // spreadPct is already calculated in spread-pricing.ts
  const spread = opp.spreadPct;
  if (spread !== null && spread !== undefined) {
    if (spread <= 5) {
      premiumScore += 5; // Tight on both legs
    } else if (spread <= 10) {
      premiumScore += 4; // Normal
    } else if (spread <= 15) {
      premiumScore += 2; // Wide - harder to fill
    }
    // > 15% = 0 points (illiquid)
  } else {
    premiumScore += 2;
  }

  // ===== OVERALL QUALITY (10 points) =====
  
  // Liquidity on Both Legs (5 points)
  // Both short and long need sufficient OI + volume
  // Using short leg OI/volume as proxy (long leg typically has similar liquidity)
  const oi = opp.openInterest;
  const vol = opp.volume || 0;
  
  if (oi >= 100 && vol >= 50) {
    qualityScore += 5; // Excellent liquidity
  } else if (oi >= 50 && vol >= 25) {
    qualityScore += 4; // Good liquidity
  } else if (oi >= 20 && vol >= 10) {
    qualityScore += 3; // Acceptable liquidity
  } else if (oi >= 10) {
    qualityScore += 1; // Minimal liquidity
  }

  // Stock Quality (5 points)
  // Mag 7 + volume (assignment risk matters for spreads too)
  const mag7 = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA'];
  if (mag7.includes(opp.symbol)) {
    qualityScore += 3; // Mag 7 bonus
  }
  
  if (vol > 1000000) {
    qualityScore += 2; // High volume
  } else if (vol > 500000) {
    qualityScore += 1;
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
 * Score all BPS opportunities and sort by score descending
 */
export function scoreBPSOpportunities(opportunities: BullPutSpreadOpportunity[]): BPSScoredOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateBPSScore(opp);
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
 * Calculate Covered Call Composite Score (0-100) with detailed breakdown
 * 
 * Weights:
 * - Technical Setup (40%): RSI (20) + BB %B (20) - OPPOSITE of CSP (overbought is good)
 * - Greeks & Timing (30%): Delta (15) + DTE (10) + IV Rank (5)
 * - Premium Quality (20%): Weekly Return (15) + Spread (5)
 * - Stock Quality (10%): Mag 7 (5) + Market Cap (5)
 */
export function calculateCCScore(opp: CSPOpportunity): { score: number; breakdown: ScoreBreakdown } {
  let technicalScore = 0;
  let greeksScore = 0;
  let premiumScore = 0;
  let qualityScore = 0;

  // ===== TECHNICAL SETUP (40 points) - OPPOSITE OF CSP =====
  
  // RSI - Overbought Indicator (20 points)
  // Higher is better for CC (overbought stocks = max premium, assignment less likely if OTM)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 75) {
      technicalScore += 20; // Extremely overbought - max premium
    } else if (rsi > 70) {
      technicalScore += 18; // Overbought - excellent
    } else if (rsi > 65) {
      technicalScore += 15; // Approaching overbought - very good
    } else if (rsi > 60) {
      technicalScore += 12; // Neutral-bullish - good
    } else if (rsi > 50) {
      technicalScore += 8; // Neutral - acceptable
    } else if (rsi > 40) {
      technicalScore += 4; // Neutral-bearish - caution
    }
    // < 40 = 0 points (oversold - avoid CC)
  } else {
    technicalScore += 10; // Neutral if no data
  }

  // Bollinger Band %B (20 points)
  // Higher is better for CC (near upper band = overbought = max premium)
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb > 1.0) {
      technicalScore += 20; // Above upper band - extreme overbought
    } else if (bb > 0.85) {
      technicalScore += 18; // Near upper band - excellent
    } else if (bb > 0.70) {
      technicalScore += 15; // Upper third - very good
    } else if (bb > 0.50) {
      technicalScore += 10; // Middle - acceptable
    } else if (bb > 0.30) {
      technicalScore += 5; // Lower third - caution
    }
    // < 0.30 = 0 points (near/below lower band - avoid CC)
  } else {
    technicalScore += 10; // Neutral if no data
  }

  // ===== GREEKS & TIMING (30 points) =====
  
  // Delta - Probability Sweet Spot (15 points)
  // 0.30-0.50 = ideal (OTM calls, lower assignment risk, decent premium)
  const delta = Math.abs(opp.delta || 0);
  if (delta >= 0.30 && delta <= 0.50) {
    greeksScore += 15; // Ideal range
  } else if ((delta >= 0.25 && delta < 0.30) || (delta > 0.50 && delta <= 0.60)) {
    greeksScore += 12; // Good range (safer or higher premium)
  } else if ((delta >= 0.20 && delta < 0.25) || (delta > 0.60 && delta <= 0.70)) {
    greeksScore += 8; // Acceptable (very safe or aggressive)
  } else if (delta > 0 && delta < 0.20) {
    greeksScore += 3; // Too safe - thin premium
  } else if (delta > 0.70) {
    greeksScore += 3; // Too aggressive - high assignment risk
  }

  // DTE - Time Decay Optimization (10 points)
  // 7-45 days = sweet spot (theta decay + flexibility)
  const dte = opp.dte;
  if (dte >= 7 && dte <= 14) {
    greeksScore += 10; // Weekly sweet spot
  } else if (dte >= 15 && dte <= 30) {
    greeksScore += 9; // Monthly - very good
  } else if (dte >= 31 && dte <= 45) {
    greeksScore += 7; // Longer term - good
  } else if (dte >= 4 && dte < 7) {
    greeksScore += 5; // Very short - risky
  } else if (dte > 45 && dte <= 60) {
    greeksScore += 4; // Too long - slow theta
  }
  // < 4 or > 60 = 0 points

  // IV Rank - Premium Environment (5 points)
  // Higher IV = better premium for selling
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
  
  // Weekly Return - Income Efficiency (15 points)
  // Premium / stock price / weeks to expiration
  const weeksToExpiration = dte / 7;
  const weeklyReturn = weeksToExpiration > 0 
    ? (opp.premium / opp.currentPrice / weeksToExpiration) * 100 
    : 0;
  
  if (weeklyReturn > 1.5) {
    premiumScore += 15; // Excellent weekly return
  } else if (weeklyReturn > 1.0) {
    premiumScore += 13; // Very good
  } else if (weeklyReturn > 0.75) {
    premiumScore += 11; // Good
  } else if (weeklyReturn > 0.50) {
    premiumScore += 8; // Acceptable
  } else if (weeklyReturn > 0.25) {
    premiumScore += 5; // Marginal
  }
  // < 0.25% = 0 points (too thin)

  // Bid-Ask Spread - Execution Quality (5 points)
  // Tighter spread = better execution
  const bidAskSpread = Math.abs(opp.ask - opp.bid);
  const spreadPct = (bidAskSpread / opp.bid) * 100;
  
  if (spreadPct < 5) {
    premiumScore += 5; // Tight spread - excellent
  } else if (spreadPct < 10) {
    premiumScore += 4; // Acceptable spread
  } else if (spreadPct < 15) {
    premiumScore += 3; // Wide spread - caution
  } else if (spreadPct < 25) {
    premiumScore += 1; // Very wide - poor execution
  }
  // > 25% = 0 points (illiquid)

  // ===== OVERALL QUALITY (10 points) =====
  
  // Liquidity - Open Interest + Volume (5 points)
  const liquidity = (opp.openInterest || 0) + (opp.volume || 0);
  if (liquidity > 500) {
    qualityScore += 5; // Highly liquid
  } else if (liquidity > 200) {
    qualityScore += 4; // Good liquidity
  } else if (liquidity > 100) {
    qualityScore += 3; // Acceptable
  } else if (liquidity > 50) {
    qualityScore += 2; // Marginal
  } else if (liquidity > 0) {
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

export interface CCScoredOpportunity extends CSPOpportunity {
  score: number;
  scoreBreakdown: ScoreBreakdown;
}
