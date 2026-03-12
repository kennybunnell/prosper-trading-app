/**
 * Bear Call Spread Scoring System
 * Strategy-specific scoring with detailed breakdowns
 *
 * Weights:
 * - Technical Setup (40%): RSI (20) + BB %B (20) - OVERBOUGHT indicators
 * - Greeks & Spread Efficiency (30%): Short Delta (10) + Spread Efficiency (10) + DTE (5) + IV Rank (5)
 * - Premium Quality (20%): Credit/Width Ratio (15) + Bid-Ask Spread (5)
 * - Overall Quality (10%): Liquidity (5) + Stock Quality (5)
 *
 * Index Mode (auto-detected from symbol):
 * - RSI/BB are not meaningful for index products → full 40-pt neutral credit awarded
 * - Delta brackets recalibrated: index options trade at 0.02–0.06 OTM (vs equity 0.20–0.30)
 * - Width scoring recalibrated: 10-wide is standard for index (vs 2-5 for equity)
 */

import { BearCallSpreadOpportunity } from './bear-call-pricing';
import { isTrueIndexOption } from '../shared/orderUtils';

export interface BCSScoreBreakdown {
  technical: number; // RSI + BB (40 points)
  greeks: number; // Short Delta + Spread Efficiency + DTE + IV Rank (30 points)
  premium: number; // Credit/Width Ratio + Spread (20 points)
  quality: number; // Liquidity + Stock Quality (10 points)
  total: number; // Sum of all (0-100)
  isIndex: boolean; // Whether index scoring was applied
}

export interface BCScoredOpportunity extends BearCallSpreadOpportunity {
  score: number;
  scoreBreakdown: BCSScoreBreakdown;
}

/**
 * Calculate Bear Call Spread Composite Score (0-100) with detailed breakdown.
 *
 * Index mode is auto-detected from opp.symbol using isTrueIndexOption().
 * The optional `options.isIndexMode` override is still accepted for backward compatibility
 * but the symbol-based detection takes precedence when the symbol is a known index.
 */
export function calculateBCSScore(
  opp: BearCallSpreadOpportunity,
  options: { isIndexMode?: boolean } = {}
): { score: number; breakdown: BCSScoreBreakdown } {
  // Auto-detect index mode from symbol; fall back to caller-supplied flag
  const isIndexMode = isTrueIndexOption(opp.symbol) || (options.isIndexMode ?? false);

  let technicalScore = 0;
  let greeksScore = 0;
  let premiumScore = 0;
  let qualityScore = 0;

  // ===== TECHNICAL SETUP (40 points) - OVERBOUGHT INDICATORS =====
  // For INDEX products: RSI/BB not meaningful — award full neutral credit (20+20=40)
  const rsi = opp.rsi;
  const bb = opp.bbPctB;

  if (isIndexMode) {
    technicalScore += 20; // RSI neutral for index
    technicalScore += 20; // BB neutral for index
  } else {
    // RSI - Overbought Indicator (20 points)
    if (rsi !== null && rsi !== undefined) {
      if (rsi > 75) {
        technicalScore += 20;
      } else if (rsi > 70) {
        technicalScore += 18;
      } else if (rsi > 65) {
        technicalScore += 15;
      } else if (rsi > 60) {
        technicalScore += 12;
      } else if (rsi > 50) {
        technicalScore += 8;
      } else if (rsi > 40) {
        technicalScore += 4;
      }
    } else {
      technicalScore += 10; // Neutral if no RSI data
    }

    // Bollinger Band %B (20 points)
    if (bb !== null && bb !== undefined) {
      if (bb > 1.0) {
        technicalScore += 20;
      } else if (bb > 0.85) {
        technicalScore += 18;
      } else if (bb > 0.70) {
        technicalScore += 15;
      } else if (bb > 0.50) {
        technicalScore += 10;
      } else if (bb > 0.30) {
        technicalScore += 5;
      }
    } else {
      technicalScore += 10; // Neutral if no BB data
    }
  }

  // ===== GREEKS & SPREAD EFFICIENCY (30 points) =====

  // Short Leg Delta - Primary Risk Indicator (10 points)
  const shortDelta = Math.abs(opp.delta || 0);

  if (isIndexMode) {
    // Index options trade at much lower absolute deltas (0.02–0.08 OTM is normal)
    // Recalibrate brackets for index: 0.02–0.06 is the ideal range
    if (shortDelta >= 0.02 && shortDelta <= 0.06) {
      greeksScore += 10; // Perfect range for index
    } else if ((shortDelta > 0.06 && shortDelta <= 0.10) || (shortDelta >= 0.01 && shortDelta < 0.02)) {
      greeksScore += 8; // Good range
    } else if (shortDelta > 0.10 && shortDelta <= 0.15) {
      greeksScore += 5; // Acceptable — slightly elevated risk
    } else if (shortDelta > 0.15 && shortDelta <= 0.20) {
      greeksScore += 3; // Higher risk
    } else if (shortDelta > 0.20) {
      greeksScore += 1; // Too close ITM for index
    } else if (shortDelta > 0 && shortDelta < 0.01) {
      greeksScore += 2; // Too far OTM — negligible premium
    }
  } else {
    // Equity options: ideal short call delta is 0.20–0.30
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
  }

  // Spread Efficiency - Delta Separation & Width (10 points)
  const longDelta = Math.abs(opp.longDelta || 0);
  const deltaSeparation = Math.abs(shortDelta - longDelta);
  const spreadWidth = opp.spreadWidth;

  // Delta separation scoring (5 points) — same for equity and index
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
  if (isIndexMode) {
    // For index options, 10-wide is the standard; 25-wide is common for SPXW/NDX
    if (spreadWidth >= 5 && spreadWidth <= 15) {
      greeksScore += 5; // Standard index spread
    } else if (spreadWidth > 15 && spreadWidth <= 25) {
      greeksScore += 4; // Wider index spread — more premium, more risk
    } else if (spreadWidth > 25 && spreadWidth <= 50) {
      greeksScore += 3; // Wide index spread
    } else if (spreadWidth < 5) {
      greeksScore += 3; // Tight index spread — less premium
    } else {
      greeksScore += 1; // Very wide — inefficient
    }
  } else {
    // Equity: tighter spreads are more capital-efficient
    if (spreadWidth <= 2) {
      greeksScore += 5; // Tight spread - capital efficient
    } else if (spreadWidth <= 5) {
      greeksScore += 4; // Standard spread
    } else if (spreadWidth <= 10) {
      greeksScore += 2; // Wide spread - more capital at risk
    } else {
      greeksScore += 1; // Very wide - inefficient
    }
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
  // netCredit is stored in per-point/per-share units; spreadWidth is in points
  // Target: 25-40% of spread width as credit
  const creditWidthRatio = opp.spreadWidth > 0 ? (opp.netCredit / opp.spreadWidth) * 100 : 0;

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

  // Stock Quality (5 points)
  if (isIndexMode) {
    // Index products (SPXW, MRUT, NDXP, etc.) are premium-quality instruments
    // Award full 5 points — they are the gold standard for spread trading
    qualityScore += 5;
  } else {
    // Equity: Mag 7 preference
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
      isIndex: isIndexMode,
    },
  };
}

/**
 * Score all BCS opportunities and sort by score descending.
 * Index mode is auto-detected per opportunity from the symbol.
 */
export function scoreBCSOpportunities(
  opportunities: BearCallSpreadOpportunity[],
  options: { isIndexMode?: boolean } = {}
): BCScoredOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateBCSScore(opp, options);
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
