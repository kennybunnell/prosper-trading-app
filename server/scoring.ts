/**
 * Scoring System for Options Opportunities
 * Implements dual scoring (primary + secondary) for ranking opportunities
 */

import { OptionContract, TechnicalIndicators } from './tradier';

export interface ScoringWeights {
  premium: number;
  delta: number;
  dte: number;
  iv: number;
  openInterest: number;
  volume: number;
  rsi: number;
  bollingerBands: number;
  movingAverage: number;
  week52Range: number;
}

export const DEFAULT_PRIMARY_WEIGHTS: ScoringWeights = {
  premium: 0.35,
  delta: 0.25,
  dte: 0.20,
  iv: 0.20,
  openInterest: 0,
  volume: 0,
  rsi: 0,
  bollingerBands: 0,
  movingAverage: 0,
  week52Range: 0,
};

export const DEFAULT_SECONDARY_WEIGHTS: ScoringWeights = {
  premium: 0,
  delta: 0,
  dte: 0,
  iv: 0,
  openInterest: 0.25,
  volume: 0.25,
  rsi: 0.20,
  bollingerBands: 0.15,
  movingAverage: 0.10,
  week52Range: 0.05,
};

export interface OpportunityScore {
  primaryScore: number;
  secondaryScore: number;
  totalScore: number;
  breakdown: {
    premium: number;
    delta: number;
    dte: number;
    iv: number;
    openInterest: number;
    volume: number;
    rsi: number;
    bollingerBands: number;
    movingAverage: number;
    week52Range: number;
  };
}

/**
 * Normalize a value to 0-100 scale
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  const normalized = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, normalized));
}

/**
 * Score premium amount (higher is better)
 */
function scorePremium(premium: number, minPremium: number = 0.10, maxPremium: number = 5.0): number {
  return normalize(premium, minPremium, maxPremium);
}

/**
 * Score delta (optimal range: 0.20-0.40 for CSP, higher for CC)
 */
function scoreDelta(delta: number, strategy: 'csp' | 'cc' | 'pmcc'): number {
  const absDelta = Math.abs(delta);
  
  if (strategy === 'csp') {
    // For CSP, prefer delta between 0.20-0.40
    if (absDelta >= 0.20 && absDelta <= 0.40) return 100;
    if (absDelta < 0.20) return normalize(absDelta, 0.10, 0.20);
    return 100 - normalize(absDelta, 0.40, 0.70);
  } else if (strategy === 'cc') {
    // For CC, prefer delta between 0.20-0.50
    if (absDelta >= 0.20 && absDelta <= 0.50) return 100;
    if (absDelta < 0.20) return normalize(absDelta, 0.10, 0.20);
    return 100 - normalize(absDelta, 0.50, 0.80);
  } else {
    // PMCC similar to CC
    if (absDelta >= 0.20 && absDelta <= 0.50) return 100;
    if (absDelta < 0.20) return normalize(absDelta, 0.10, 0.20);
    return 100 - normalize(absDelta, 0.50, 0.80);
  }
}

/**
 * Score days to expiration (optimal: 30-45 days)
 */
function scoreDTE(dte: number, optimalMin: number = 30, optimalMax: number = 45): number {
  if (dte >= optimalMin && dte <= optimalMax) return 100;
  if (dte < optimalMin) return normalize(dte, 7, optimalMin);
  return 100 - normalize(dte, optimalMax, 90);
}

/**
 * Score implied volatility (higher is better for premium sellers)
 */
function scoreIV(iv: number, minIV: number = 0.20, maxIV: number = 1.0): number {
  return normalize(iv, minIV, maxIV);
}

/**
 * Score open interest (higher is better for liquidity)
 */
function scoreOpenInterest(oi: number, minOI: number = 100, maxOI: number = 10000): number {
  if (oi < minOI) return 0;
  return normalize(oi, minOI, maxOI);
}

/**
 * Score volume (higher is better for liquidity)
 */
function scoreVolume(volume: number, minVolume: number = 50, maxVolume: number = 5000): number {
  if (volume < minVolume) return 0;
  return normalize(volume, minVolume, maxVolume);
}

/**
 * Score RSI (optimal: 30-40 for CSP - oversold)
 */
function scoreRSI(rsi: number | null, strategy: 'csp' | 'cc' | 'pmcc'): number {
  if (rsi === null) return 50;
  
  if (strategy === 'csp') {
    // For CSP, prefer oversold conditions (RSI < 40)
    if (rsi <= 30) return 100;
    if (rsi <= 40) return 90;
    if (rsi <= 50) return 70;
    if (rsi <= 60) return 50;
    return 30;
  } else {
    // For CC/PMCC, prefer neutral to slightly overbought
    if (rsi >= 50 && rsi <= 60) return 100;
    if (rsi >= 40 && rsi < 50) return 80;
    if (rsi >= 60 && rsi <= 70) return 80;
    return 50;
  }
}

/**
 * Score Bollinger Bands %B (optimal: <0.3 for CSP - near lower band)
 */
function scoreBollingerBands(percentB: number | null, strategy: 'csp' | 'cc' | 'pmcc'): number {
  if (percentB === null) return 50;
  
  if (strategy === 'csp') {
    // For CSP, prefer near lower band (oversold)
    if (percentB <= 0.2) return 100;
    if (percentB <= 0.3) return 90;
    if (percentB <= 0.5) return 70;
    if (percentB <= 0.7) return 50;
    return 30;
  } else {
    // For CC/PMCC, prefer middle to upper range
    if (percentB >= 0.5 && percentB <= 0.7) return 100;
    if (percentB >= 0.3 && percentB < 0.5) return 80;
    if (percentB >= 0.7 && percentB <= 0.9) return 80;
    return 50;
  }
}

/**
 * Score Moving Average position (optimal: below SMA for CSP)
 */
function scoreMovingAverage(percentFromSMA: number | null, strategy: 'csp' | 'cc' | 'pmcc'): number {
  if (percentFromSMA === null) return 50;
  
  if (strategy === 'csp') {
    // For CSP, prefer price below moving average
    if (percentFromSMA <= -5) return 100;
    if (percentFromSMA <= -2) return 90;
    if (percentFromSMA <= 0) return 80;
    if (percentFromSMA <= 2) return 60;
    return 40;
  } else {
    // For CC/PMCC, prefer price above moving average
    if (percentFromSMA >= 2) return 100;
    if (percentFromSMA >= 0) return 90;
    if (percentFromSMA >= -2) return 70;
    return 50;
  }
}

/**
 * Score 52-week range position (optimal: lower range for CSP)
 */
function scoreWeek52Range(percentInRange: number | null, strategy: 'csp' | 'cc' | 'pmcc'): number {
  if (percentInRange === null) return 50;
  
  if (strategy === 'csp') {
    // For CSP, prefer lower in 52-week range
    if (percentInRange <= 30) return 100;
    if (percentInRange <= 40) return 90;
    if (percentInRange <= 50) return 70;
    return 50;
  } else {
    // For CC/PMCC, prefer middle to upper range
    if (percentInRange >= 50 && percentInRange <= 70) return 100;
    if (percentInRange >= 40 && percentInRange < 50) return 80;
    if (percentInRange >= 70 && percentInRange <= 80) return 80;
    return 60;
  }
}

/**
 * Calculate comprehensive score for an option opportunity
 */
export function calculateScore(
  option: OptionContract,
  technicals: TechnicalIndicators | null,
  strategy: 'csp' | 'cc' | 'pmcc',
  dte: number,
  primaryWeights: ScoringWeights = DEFAULT_PRIMARY_WEIGHTS,
  secondaryWeights: ScoringWeights = DEFAULT_SECONDARY_WEIGHTS
): OpportunityScore {
  // Calculate individual component scores
  const premiumScore = scorePremium(option.bid);
  const deltaScore = option.greeks ? scoreDelta(option.greeks.delta, strategy) : 50;
  const dteScore = scoreDTE(dte);
  const ivScore = option.greeks ? scoreIV(option.greeks.mid_iv) : 50;
  const oiScore = scoreOpenInterest(option.open_interest);
  const volumeScore = scoreVolume(option.volume);
  
  const rsiScore = technicals ? scoreRSI(technicals.rsi, strategy) : 50;
  const bbScore = technicals?.bollingerBands ? scoreBollingerBands(technicals.bollingerBands.percentB, strategy) : 50;
  const maScore = technicals?.movingAverage ? scoreMovingAverage(technicals.movingAverage.percentFromSMA, strategy) : 50;
  const w52Score = technicals?.week52Range ? scoreWeek52Range(technicals.week52Range.percentInRange, strategy) : 50;

  // Calculate primary score (option-specific metrics)
  const primaryScore = 
    premiumScore * primaryWeights.premium +
    deltaScore * primaryWeights.delta +
    dteScore * primaryWeights.dte +
    ivScore * primaryWeights.iv;

  // Calculate secondary score (technical indicators and liquidity)
  const secondaryScore =
    oiScore * secondaryWeights.openInterest +
    volumeScore * secondaryWeights.volume +
    rsiScore * secondaryWeights.rsi +
    bbScore * secondaryWeights.bollingerBands +
    maScore * secondaryWeights.movingAverage +
    w52Score * secondaryWeights.week52Range;

  // Total score (average of primary and secondary)
  const totalScore = (primaryScore + secondaryScore) / 2;

  return {
    primaryScore: Math.round(primaryScore),
    secondaryScore: Math.round(secondaryScore),
    totalScore: Math.round(totalScore),
    breakdown: {
      premium: Math.round(premiumScore),
      delta: Math.round(deltaScore),
      dte: Math.round(dteScore),
      iv: Math.round(ivScore),
      openInterest: Math.round(oiScore),
      volume: Math.round(volumeScore),
      rsi: Math.round(rsiScore),
      bollingerBands: Math.round(bbScore),
      movingAverage: Math.round(maScore),
      week52Range: Math.round(w52Score),
    },
  };
}

/**
 * Filter opportunities by minimum score threshold
 */
export function filterByScore(
  opportunities: Array<{ score: OpportunityScore }>,
  minScore: number
): Array<{ score: OpportunityScore }> {
  return opportunities.filter(opp => opp.score.totalScore >= minScore);
}

/**
 * Sort opportunities by score (descending)
 */
export function sortByScore<T extends { score: OpportunityScore }>(
  opportunities: T[]
): T[] {
  return [...opportunities].sort((a, b) => b.score.totalScore - a.score.totalScore);
}
