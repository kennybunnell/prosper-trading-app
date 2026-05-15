/**
 * PMCC (Poor Man's Covered Call) Scoring System - Phase 1: LEAP Purchase
 * Evaluates LEAP options as synthetic stock positions
 * 
 * Scoring Criteria v2 (100 points total, with penalties):
 * - Stock Quality & Growth (30 pts): RSI, BB %B, Price Trend (D6 Technical)
 * - LEAP Structure (30 pts): Delta, DTE, Strike positioning (D2 Probability Fit)
 * - Cost & Liquidity (25 pts): Premium efficiency, OI, Volume, Spread (D1 Liquidity + D3 Premium)
 * - IV Richness (10 pts): IV Rank (D4) — increased from 5 pts
 * - Risk Management (5 pts): Theta decay (D5 Strike Safety proxy)
 * 
 * Penalties (applied after scoring):
 * - Earnings within 30 days: -15 pts (earnings warning)
 * - Extrinsic value > 20% of premium: -10 pts (paying too much time value)
 * - Short call strike rule violated (no room above LEAP strike): -20 pts
 */

import { LeapOpportunity } from './routers-pmcc';

export interface PMCCScoreBreakdown {
  stockQuality: number;    // RSI + BB + Trend (35 points)
  leapStructure: number;   // Delta + DTE + Strike (30 points)
  costLiquidity: number;   // Premium + OI + Volume + Spread (25 points)
  riskManagement: number;  // IV Rank + Theta (10 points)
  earningsPenalty: number; // Penalty for earnings within 30 days (-15)
  extrinsicPenalty: number; // Penalty for high extrinsic value (-10)
  strikeRulePenalty: number; // Penalty for short call strike rule violation (-20)
  total: number;           // Sum of all after penalties (0-100)
}

export interface PMCCScoredOpportunity extends LeapOpportunity {
  score: number;
  scoreBreakdown: PMCCScoreBreakdown;
}

/**
 * Calculate PMCC LEAP Score (0-100) with detailed breakdown
 */
export function calculatePMCCScore(leap: LeapOpportunity): { score: number; breakdown: PMCCScoreBreakdown } {
  let stockQualityScore = 0;
  let leapStructureScore = 0;
  let costLiquidityScore = 0;
  let riskManagementScore = 0;

  // ===== STOCK QUALITY & GROWTH (35 points) =====
  
  // RSI - Want strong but not overbought (15 points)
  // Sweet spot: 55-70 (strong uptrend without being overextended)
  const rsi = leap.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi >= 55 && rsi <= 70) {
      stockQualityScore += 15; // Ideal range - strong uptrend
    } else if (rsi >= 50 && rsi < 55) {
      stockQualityScore += 12; // Neutral-bullish - good
    } else if (rsi > 70 && rsi <= 75) {
      stockQualityScore += 10; // Slightly overbought - acceptable
    } else if (rsi >= 45 && rsi < 50) {
      stockQualityScore += 8; // Neutral - marginal
    } else if (rsi > 75) {
      stockQualityScore += 5; // Overbought - risky for long hold
    } else if (rsi >= 40 && rsi < 45) {
      stockQualityScore += 4; // Weak - poor
    }
    // < 40 or > 80 = 0 points (too weak or too extended)
  } else {
    stockQualityScore += 7; // Neutral if no data
  }

  // Bollinger Band %B - Want upper half but not extreme (10 points)
  // Sweet spot: 0.50-0.85 (healthy uptrend)
  const bb = leap.bbPercent;
  if (bb !== null && bb !== undefined) {
    if (bb >= 0.50 && bb <= 0.85) {
      stockQualityScore += 10; // Ideal range - strong but not overextended
    } else if (bb >= 0.40 && bb < 0.50) {
      stockQualityScore += 7; // Middle band - acceptable
    } else if (bb > 0.85 && bb <= 1.0) {
      stockQualityScore += 5; // Near upper band - risky
    } else if (bb >= 0.30 && bb < 0.40) {
      stockQualityScore += 3; // Lower half - weak
    }
    // < 0.30 or > 1.0 = 0 points (too weak or too extended)
  } else {
    stockQualityScore += 5; // Neutral if no data
  }

  // Price vs Strike - Want stock well above strike for safety (10 points)
  const priceToStrike = leap.currentPrice / leap.strike;
  if (priceToStrike >= 1.20) {
    stockQualityScore += 10; // 20%+ above strike - excellent cushion
  } else if (priceToStrike >= 1.15) {
    stockQualityScore += 8; // 15-20% above - very good
  } else if (priceToStrike >= 1.10) {
    stockQualityScore += 6; // 10-15% above - good
  } else if (priceToStrike >= 1.05) {
    stockQualityScore += 4; // 5-10% above - acceptable
  } else if (priceToStrike >= 1.00) {
    stockQualityScore += 2; // Just above strike - risky
  }
  // Below strike = 0 points

  // ===== LEAP STRUCTURE (30 points) =====

  // Delta - Want deep ITM (0.70-0.85 optimal) (10 points)
  const delta = Math.abs(leap.delta);
  if (delta >= 0.70 && delta <= 0.85) {
    leapStructureScore += 10; // Ideal range - acts like stock but cheaper
  } else if (delta >= 0.65 && delta < 0.70) {
    leapStructureScore += 7; // Slightly less ITM - acceptable
  } else if (delta > 0.85 && delta <= 0.95) {
    leapStructureScore += 7; // Very deep ITM - acceptable but expensive
  } else if (delta >= 0.60 && delta < 0.65) {
    leapStructureScore += 4; // Too far OTM - risky
  } else if (delta > 0.95) {
    leapStructureScore += 4; // Too deep ITM - expensive, low leverage
  }
  // < 0.60 = 0 points (not deep enough ITM)

  // DTE - Want long time horizon (15 points)
  // Updated scoring: 365+ = 15, 270-365 = 12, 180-270 = 8, <180 = 3
  const dte = leap.dte;
  if (dte >= 365) {
    leapStructureScore += 15; // 1+ year - maximum time value
  } else if (dte >= 270) {
    leapStructureScore += 12; // 9-12 months - very good
  } else if (dte >= 180) {
    leapStructureScore += 8; // 6-9 months - acceptable
  } else if (dte >= 90) {
    leapStructureScore += 3; // 3-6 months - too short
  }
  // < 90 days = 0 points (too short for LEAP strategy)

  // Strike Selection - Prefer strikes that give good leverage (5 points)
  // Lower strike (deeper ITM) = more expensive but safer
  const strikeToPrice = leap.strike / leap.currentPrice;
  if (strikeToPrice >= 0.75 && strikeToPrice <= 0.85) {
    leapStructureScore += 5; // Sweet spot - good balance
  } else if (strikeToPrice >= 0.70 && strikeToPrice < 0.75) {
    leapStructureScore += 4; // Deeper ITM - safer but more expensive
  } else if (strikeToPrice >= 0.85 && strikeToPrice < 0.90) {
    leapStructureScore += 4; // Less ITM - cheaper but riskier
  } else if (strikeToPrice >= 0.65 && strikeToPrice < 0.70) {
    leapStructureScore += 2; // Very deep - expensive
  } else if (strikeToPrice >= 0.90 && strikeToPrice < 0.95) {
    leapStructureScore += 2; // Too shallow - risky
  }
  // < 0.65 or >= 0.95 = 0 points

  // ===== COST & LIQUIDITY (25 points) =====

  // Premium Efficiency - Cost per delta point (8 points)
  // Lower cost per delta = better value
  const costPerDelta = leap.premium / delta;
  const stockPrice = leap.currentPrice;
  const costRatio = costPerDelta / stockPrice; // Normalize by stock price
  
  if (costRatio <= 0.50) {
    costLiquidityScore += 8; // Excellent value
  } else if (costRatio <= 0.60) {
    costLiquidityScore += 6; // Good value
  } else if (costRatio <= 0.70) {
    costLiquidityScore += 4; // Acceptable value
  } else if (costRatio <= 0.80) {
    costLiquidityScore += 2; // Expensive
  }
  // > 0.80 = 0 points (too expensive)

  // Open Interest - Need liquidity to enter/exit (8 points)
  const oi = leap.openInterest;
  if (oi >= 1000) {
    costLiquidityScore += 8; // Excellent liquidity
  } else if (oi >= 500) {
    costLiquidityScore += 6; // Good liquidity
  } else if (oi >= 250) {
    costLiquidityScore += 4; // Acceptable liquidity
  } else if (oi >= 100) {
    costLiquidityScore += 2; // Low liquidity
  }
  // < 100 = 0 points (illiquid)

  // Volume - Recent trading activity (4 points)
  const volume = leap.volume;
  if (volume >= 50) {
    costLiquidityScore += 4; // Active trading
  } else if (volume >= 20) {
    costLiquidityScore += 3; // Moderate activity
  } else if (volume >= 10) {
    costLiquidityScore += 2; // Low activity
  } else if (volume >= 5) {
    costLiquidityScore += 1; // Minimal activity
  }
  // < 5 = 0 points (no activity)

  // Bid-Ask Spread - Execution cost (5 points)
  const spreadPercent = leap.bidAskSpreadPercent;
  if (spreadPercent <= 2) {
    costLiquidityScore += 5; // Tight spread - excellent
  } else if (spreadPercent <= 4) {
    costLiquidityScore += 4; // Reasonable spread
  } else if (spreadPercent <= 6) {
    costLiquidityScore += 3; // Acceptable spread
  } else if (spreadPercent <= 8) {
    costLiquidityScore += 2; // Wide spread
  } else if (spreadPercent <= 10) {
    costLiquidityScore += 1; // Very wide spread
  }
  // > 10% = 0 points (too wide)

  // ===== RISK MANAGEMENT (10 points) =====

  // IV Rank - D4 IV Richness (5 pts)
  // For LEAP purchase: lower IV is BETTER (buy cheap). Invert the scale.
  const ivRank = leap.ivRank;
  if (ivRank !== null && ivRank !== undefined) {
    if (ivRank <= 20)       riskManagementScore += 5; // Low IV — cheap LEAP, excellent
    else if (ivRank <= 30)  riskManagementScore += 4; // Moderate-low IV — good
    else if (ivRank <= 40)  riskManagementScore += 3; // Moderate IV — acceptable
    else if (ivRank <= 55)  riskManagementScore += 2; // Elevated IV — expensive
    else if (ivRank <= 70)  riskManagementScore += 1; // High IV — risky purchase
    else                    riskManagementScore += 0; // Very high IV — avoid
  } else {
    riskManagementScore += 2; // Neutral if no data
  }

  // Expected Move Safety (5 pts) — how far is the LEAP strike from the 1-sigma downside EM?
  // For PMCC, we want the LEAP strike well below the expected downside move.
  const iv = leap.iv;
  if (iv && iv > 0 && leap.currentPrice > 0 && dte > 0) {
    const emDollar = leap.currentPrice * (iv / 100) * Math.sqrt(dte / 365);
    const downsideLevel = leap.currentPrice - emDollar; // 1-sigma downside
    const cushion = downsideLevel - leap.strike; // positive = strike below downside EM
    const cushionPct = (cushion / leap.currentPrice) * 100;
    if (cushionPct >= 10)       riskManagementScore += 5; // Strike well below EM — very safe
    else if (cushionPct >= 5)   riskManagementScore += 4; // Good cushion below EM
    else if (cushionPct >= 0)   riskManagementScore += 3; // Strike near EM boundary
    else if (cushionPct >= -5)  riskManagementScore += 1; // Strike slightly above EM — risky
    // Strike above EM by >5% = 0 (high assignment risk)
  } else {
    // Fallback: theta-based proxy for time decay safety
    const theta = leap.theta;
    if (theta !== null && theta !== undefined) {
      const absTheta = Math.abs(theta);
      if (absTheta <= 0.05)      riskManagementScore += 5;
      else if (absTheta <= 0.10) riskManagementScore += 4;
      else if (absTheta <= 0.15) riskManagementScore += 3;
      else if (absTheta <= 0.20) riskManagementScore += 2;
      else if (absTheta <= 0.25) riskManagementScore += 1;
    } else {
      riskManagementScore += 2;
    }
  }

  // ===== PENALTIES =====

  // Earnings within 30 days: -15 points (IV crush risk)
  let earningsPenalty = 0;
  if (leap.earningsWarning) {
    earningsPenalty = -15;
  } else if (leap.daysToEarnings !== null && leap.daysToEarnings >= 0 && leap.daysToEarnings <= 45) {
    earningsPenalty = -7; // Caution zone: 31-45 days to earnings
  }

  // Extrinsic value > 20% of premium: -10 points (paying too much time value)
  let extrinsicPenalty = 0;
  if (leap.extrinsicWarning) {
    if (leap.extrinsicPercent > 35) {
      extrinsicPenalty = -10; // Severe: > 35% extrinsic
    } else if (leap.extrinsicPercent > 25) {
      extrinsicPenalty = -7;  // Moderate: 25-35% extrinsic
    } else {
      extrinsicPenalty = -4;  // Mild: 20-25% extrinsic
    }
  }

  // Short call strike rule: LEAP strike must leave room above for short calls
  // If LEAP strike is >= 95% of current price, there's almost no room for short calls
  let strikeRulePenalty = 0;
  const strikeToCurrentPrice = leap.strike / leap.currentPrice;
  if (strikeToCurrentPrice >= 0.98) {
    strikeRulePenalty = -20; // Critical: LEAP strike is at or above current price — no room for short calls
  } else if (strikeToCurrentPrice >= 0.95) {
    strikeRulePenalty = -10; // Warning: very little room for short calls above LEAP strike
  }

  // ===== CALCULATE TOTAL =====
  const rawScore = stockQualityScore + leapStructureScore + costLiquidityScore + riskManagementScore;
  const totalScore = Math.max(0, rawScore + earningsPenalty + extrinsicPenalty + strikeRulePenalty);

  return {
    score: Math.round(totalScore),
    breakdown: {
      stockQuality: Math.round(stockQualityScore),
      leapStructure: Math.round(leapStructureScore),
      costLiquidity: Math.round(costLiquidityScore),
      riskManagement: Math.round(riskManagementScore),
      earningsPenalty: Math.round(earningsPenalty),
      extrinsicPenalty: Math.round(extrinsicPenalty),
      strikeRulePenalty: Math.round(strikeRulePenalty),
      total: Math.round(totalScore),
    },
  };
}

/**
 * Generate human-readable explanation of PMCC score
 */
export function explainPMCCScore(leap: LeapOpportunity, breakdown: PMCCScoreBreakdown): string {
  const lines: string[] = [];
  
  lines.push(`**PMCC LEAP Score: ${breakdown.total}/100**\n`);
  
  // Stock Quality
  lines.push(`**Stock Quality & Growth (${breakdown.stockQuality}/35):**`);
  if (leap.rsi !== null) {
    lines.push(`- RSI: ${leap.rsi.toFixed(1)} ${leap.rsi >= 55 && leap.rsi <= 70 ? '✓ Strong uptrend' : leap.rsi < 55 ? '⚠ Weak momentum' : '⚠ Overbought'}`);
  }
  if (leap.bbPercent !== null) {
    lines.push(`- BB %B: ${(leap.bbPercent * 100).toFixed(1)}% ${leap.bbPercent >= 0.50 && leap.bbPercent <= 0.85 ? '✓ Healthy position' : '⚠ Outside ideal range'}`);
  }
  const priceToStrike = leap.currentPrice / leap.strike;
  lines.push(`- Price/Strike: ${(priceToStrike * 100).toFixed(1)}% ${priceToStrike >= 1.15 ? '✓ Good cushion' : priceToStrike >= 1.05 ? '⚠ Moderate cushion' : '⚠ Tight cushion'}\n`);
  
  // LEAP Structure
  lines.push(`**LEAP Structure (${breakdown.leapStructure}/30):**`);
  lines.push(`- Delta: ${Math.abs(leap.delta).toFixed(2)} ${Math.abs(leap.delta) >= 0.70 && Math.abs(leap.delta) <= 0.85 ? '✓ Ideal ITM depth' : '⚠ Outside ideal range'}`);
  lines.push(`- DTE: ${leap.dte} days ${leap.dte >= 365 ? '✓ Maximum time' : leap.dte >= 270 ? '✓ Good time' : leap.dte >= 180 ? '⚠ Acceptable' : '⚠ Too short'}`);
  const strikeToPrice = leap.strike / leap.currentPrice;
  lines.push(`- Strike/Price: ${(strikeToPrice * 100).toFixed(1)}% ${strikeToPrice >= 0.75 && strikeToPrice <= 0.85 ? '✓ Good balance' : '⚠ Outside sweet spot'}\n`);
  
  // Cost & Liquidity
  lines.push(`**Cost & Liquidity (${breakdown.costLiquidity}/25):**`);
  lines.push(`- Premium: $${leap.premium.toFixed(2)} (${((leap.premium / leap.currentPrice) * 100).toFixed(1)}% of stock price)`);
  lines.push(`- Open Interest: ${leap.openInterest.toLocaleString()} ${leap.openInterest >= 500 ? '✓ Good liquidity' : '⚠ Low liquidity'}`);
  lines.push(`- Volume: ${leap.volume} ${leap.volume >= 20 ? '✓ Active' : '⚠ Low activity'}`);
  lines.push(`- Spread: ${leap.bidAskSpreadPercent.toFixed(2)}% ${leap.bidAskSpreadPercent <= 4 ? '✓ Tight' : '⚠ Wide'}\n`);
  
  // Risk Management
  lines.push(`**Risk Management (${breakdown.riskManagement}/10):**`);
  if (leap.ivRank !== null) {
    lines.push(`- IV Rank: ${leap.ivRank.toFixed(0)}% ${leap.ivRank >= 30 && leap.ivRank <= 70 ? '✓ Good premium potential' : leap.ivRank < 30 ? '⚠ Low premium' : '⚠ High risk'}`);
  }
  if (leap.theta !== null) {
    lines.push(`- Theta: ${leap.theta.toFixed(3)} ${Math.abs(leap.theta) <= 0.10 ? '✓ Low decay' : '⚠ Higher decay'}`);
  }
  
  return lines.join('\n');
}
