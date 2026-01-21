/**
 * Scoring System for CSP Opportunities
 * Implements the exact composite scoring algorithm from the Streamlit app
 */

import { CSPOpportunity } from './tradier';

export interface ScoredOpportunity extends CSPOpportunity {
  score: number;
}

/**
 * Calculate CSP Composite Score (0-100)
 * Based on Streamlit app scoring:
 * - Weekly Return % (25%): Higher = Better
 * - Delta (20%): Closer to 0.25-0.35 = Best (sweet spot)
 * - RSI (20%): Lower = Better (oversold stocks bounce)
 * - BB %B (15%): Lower = Better (near lower band)
 * - IV Rank (10%): Higher = Better (elevated premium) - NOT IMPLEMENTED YET
 * - Spread % (10%): Lower = Better (tighter spreads)
 */
export function calculateCSPScore(opp: CSPOpportunity): number {
  let score = 0;

  // 1. Weekly Return % (25 points) - Scale 0.5% to 2.5%
  const weekly = opp.weeklyPct || 0;
  if (weekly >= 2.5) {
    score += 25;
  } else if (weekly >= 0.5) {
    score += 25 * ((weekly - 0.5) / 2.0);
  }

  // 2. Delta (20 points) - Sweet spot around 0.25-0.35
  const delta = Math.abs(opp.delta || 0);
  if (delta >= 0.25 && delta <= 0.35) {
    score += 20; // Perfect range
  } else if (delta >= 0.15 && delta <= 0.45) {
    score += 15; // Good range
  } else if (delta >= 0.10 && delta <= 0.50) {
    score += 10; // Acceptable
  } else {
    score += 5; // Outside ideal range
  }

  // 3. RSI (20 points) - Lower is better for CSP (oversold)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi < 30) {
      score += 20; // Oversold - excellent
    } else if (rsi < 40) {
      score += 16;
    } else if (rsi < 50) {
      score += 12;
    } else if (rsi < 60) {
      score += 8;
    } else if (rsi < 70) {
      score += 4;
    }
    // > 70 = 0 points (overbought)
  } else {
    score += 10; // Neutral if no data
  }

  // 4. BB %B (15 points) - Lower is better for CSP
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb < 0.2) {
      score += 15; // Near lower band - excellent
    } else if (bb < 0.3) {
      score += 12;
    } else if (bb < 0.5) {
      score += 9;
    } else if (bb < 0.7) {
      score += 6;
    } else if (bb < 0.8) {
      score += 3;
    }
    // > 0.8 = 0 points (near upper band)
  } else {
    score += 7; // Neutral if no data
  }

  // 5. IV Rank (10 points) - Higher is better
  // TODO: Implement IV Rank calculation in Tradier API
  const iv = opp.ivRank;
  if (iv !== null && iv !== undefined) {
    if (iv > 75) {
      score += 10;
    } else if (iv > 50) {
      score += 8;
    } else if (iv > 30) {
      score += 5;
    } else {
      score += 2;
    }
  } else {
    score += 5; // Neutral if no data
  }

  // 6. Spread % (10 points) - Lower is better
  const spread = opp.spreadPct;
  if (spread !== null && spread !== undefined) {
    if (spread <= 1) {
      score += 10;
    } else if (spread <= 3) {
      score += 8;
    } else if (spread <= 5) {
      score += 5;
    } else if (spread <= 10) {
      score += 2;
    }
    // > 10% = 0 points
  } else {
    score += 5; // Neutral if no data
  }

  return Math.round(score);
}

/**
 * Score all opportunities and sort by score descending
 */
export function scoreOpportunities(opportunities: CSPOpportunity[]): ScoredOpportunity[] {
  const scored = opportunities.map((opp) => ({
    ...opp,
    score: calculateCSPScore(opp),
  }));

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
  rsiMax?: number;
  ivRankMin?: number;
  bbMax?: number;
  minScore?: number;
}

export const PRESET_FILTERS = {
  conservative: {
    deltaMin: 0.10,
    deltaMax: 0.20,
    dteMin: 7,
    dteMax: 30,
    oiMin: 50,
    rsiMax: 70,
    ivRankMin: 0,
    bbMax: 1.0,
    minScore: 50,
  },
  medium: {
    deltaMin: 0.15,
    deltaMax: 0.30,
    dteMin: 7,
    dteMax: 30,
    oiMin: 50,
    rsiMax: 80,
    ivRankMin: 0,
    bbMax: 1.0,
    minScore: 40,
  },
  aggressive: {
    deltaMin: 0.20,
    deltaMax: 0.40,
    dteMin: 7,
    dteMax: 21,
    oiMin: 25,
    rsiMax: 100,
    ivRankMin: 0,
    bbMax: 1.0,
    minScore: 30,
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

    // RSI filter (if specified)
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
