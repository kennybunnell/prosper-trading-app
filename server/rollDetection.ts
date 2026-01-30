/**
 * Roll Detection Logic for Options Positions
 * 
 * Implements multi-factor urgency scoring for CSP and CC positions
 * based on 7/14 DTE thresholds, profit capture %, ITM depth, and delta.
 */

import type { Position } from '../shared/types';

// Extended position type with computed fields for roll analysis
export interface PositionWithMetrics extends Position {
  open_premium: number;
  current_value: number;
  expiration_date: string;
  strike_price: number;
  delta: number;
}

export type RollUrgency = 'red' | 'yellow' | 'green';

export interface RollAnalysis {
  positionId: string;
  symbol: string;
  strategy: 'CSP' | 'CC' | 'PMCC' | 'BPS' | 'BCS';
  urgency: RollUrgency;
  shouldRoll: boolean;
  reasons: string[];
  metrics: {
    dte: number;
    profitCaptured: number; // 0-100%
    itmDepth: number; // negative = OTM, positive = ITM (in %)
    delta: number;
    currentPrice: number;
    strikePrice: number;
  };
  score: number; // 0-100, higher = more urgent
}

export interface RollCandidate {
  action: 'close' | 'roll';
  strike?: number;
  expiration?: string;
  dte?: number;
  netCredit?: number; // positive = credit, negative = debit
  newPremium?: number;
  annualizedReturn?: number;
  meets3XRule?: boolean;
  delta?: number;
  score: number; // 0-100, higher = better candidate
  description: string;
}

/**
 * Calculate days to expiration from expiration date string
 */
function calculateDTE(expirationDate: string): number {
  const expDate = new Date(expirationDate);
  const today = new Date();
  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Calculate profit captured as percentage of max profit
 * For short options: (openPremium - currentValue) / openPremium * 100
 */
function calculateProfitCaptured(openPremium: number, currentValue: number): number {
  if (openPremium <= 0) return 0;
  const profitCaptured = ((openPremium - currentValue) / openPremium) * 100;
  return Math.max(0, Math.min(100, profitCaptured));
}

/**
 * Calculate ITM depth as percentage
 * For puts: (strike - currentPrice) / strike * 100
 * For calls: (currentPrice - strike) / strike * 100
 * Negative = OTM, Positive = ITM
 */
function calculateITMDepth(
  strikePrice: number,
  currentPrice: number,
  optionType: 'put' | 'call'
): number {
  if (optionType === 'put') {
    return ((strikePrice - currentPrice) / strikePrice) * 100;
  } else {
    return ((currentPrice - strikePrice) / strikePrice) * 100;
  }
}

/**
 * Calculate urgency score (0-100) based on multiple factors
 * Higher score = more urgent
 */
function calculateUrgencyScore(
  dte: number,
  profitCaptured: number,
  itmDepth: number,
  delta: number
): number {
  let score = 0;

  // DTE Factor (0-40 points)
  if (dte < 7) {
    score += 40; // Critical - gamma risk
  } else if (dte <= 10) {
    score += 30; // High urgency
  } else if (dte <= 14) {
    score += 20; // Medium urgency
  } else if (dte <= 21) {
    score += 10; // Low urgency
  }

  // Profit Captured Factor (0-25 points)
  if (profitCaptured >= 80) {
    score += 25; // Target reached
  } else if (profitCaptured >= 70) {
    score += 20;
  } else if (profitCaptured >= 50) {
    score += 10;
  }

  // ITM Depth Factor (0-25 points)
  if (itmDepth > 0) {
    // ITM
    score += Math.min(25, itmDepth * 5); // More ITM = more urgent
  } else if (itmDepth > -2) {
    // Near ATM (within 2%)
    score += 15;
  }

  // Delta Factor (0-10 points)
  const absDelta = Math.abs(delta);
  if (absDelta > 0.7) {
    score += 10; // Deep ITM
  } else if (absDelta > 0.5) {
    score += 7;
  } else if (absDelta > 0.4) {
    score += 4;
  }

  return Math.min(100, score);
}

/**
 * Determine urgency level based on score
 */
function getUrgencyLevel(score: number): RollUrgency {
  if (score >= 60) return 'red';
  if (score >= 30) return 'yellow';
  return 'green';
}

/**
 * Generate reasons for roll recommendation
 */
function generateRollReasons(
  dte: number,
  profitCaptured: number,
  itmDepth: number,
  delta: number
): string[] {
  const reasons: string[] = [];

  if (dte < 7) {
    reasons.push(`⚠️ ${dte} DTE - High gamma risk`);
  } else if (dte <= 14) {
    reasons.push(`📅 ${dte} DTE - Within management window`);
  }

  if (profitCaptured >= 80) {
    reasons.push(`✅ ${profitCaptured.toFixed(0)}% profit captured - Target reached`);
  } else if (profitCaptured >= 70) {
    reasons.push(`📈 ${profitCaptured.toFixed(0)}% profit captured - Near target`);
  }

  if (itmDepth > 0) {
    reasons.push(`🔴 ${itmDepth.toFixed(1)}% ITM - Assignment risk`);
  } else if (itmDepth > -2) {
    reasons.push(`🟡 Near ATM - Monitor closely`);
  }

  const absDelta = Math.abs(delta);
  if (absDelta > 0.7) {
    reasons.push(`⚡ Delta ${delta.toFixed(2)} - Deep ITM`);
  } else if (absDelta > 0.5) {
    reasons.push(`⚡ Delta ${delta.toFixed(2)} - Approaching ITM`);
  }

  return reasons;
}

/**
 * Analyze a CSP position for roll urgency
 */
export function analyzeCSPPosition(
  position: PositionWithMetrics,
  currentPrice: number
): RollAnalysis {
  const dte = calculateDTE(position.expiration_date);
  const profitCaptured = calculateProfitCaptured(
    Math.abs(position.open_premium),
    Math.abs(position.current_value)
  );
  const itmDepth = calculateITMDepth(position.strike_price, currentPrice, 'put');
  const delta = position.delta || 0;

  const score = calculateUrgencyScore(dte, profitCaptured, itmDepth, delta);
  const urgency = getUrgencyLevel(score);
  const reasons = generateRollReasons(dte, profitCaptured, itmDepth, delta);

  // Should roll if:
  // 1. 80%+ profit captured AND >= 7 DTE, OR
  // 2. < 7 DTE regardless of profit, OR
  // 3. ITM at any DTE
  const shouldRoll =
    (profitCaptured >= 80 && dte >= 7) ||
    dte < 7 ||
    itmDepth > 0;

  return {
    positionId: position.id.toString(),
    symbol: position.symbol,
    strategy: 'CSP',
    urgency,
    shouldRoll,
    reasons,
    metrics: {
      dte,
      profitCaptured,
      itmDepth,
      delta,
      currentPrice,
      strikePrice: position.strike_price,
    },
    score,
  };
}

/**
 * Analyze a CC position for roll urgency
 */
export function analyzeCCPosition(
  position: PositionWithMetrics,
  currentPrice: number
): RollAnalysis {
  const dte = calculateDTE(position.expiration_date);
  const profitCaptured = calculateProfitCaptured(
    Math.abs(position.open_premium),
    Math.abs(position.current_value)
  );
  const itmDepth = calculateITMDepth(position.strike_price, currentPrice, 'call');
  const delta = position.delta || 0;

  const score = calculateUrgencyScore(dte, profitCaptured, itmDepth, delta);
  const urgency = getUrgencyLevel(score);
  const reasons = generateRollReasons(dte, profitCaptured, itmDepth, delta);

  // Should roll if:
  // 1. 80%+ profit captured AND >= 7 DTE, OR
  // 2. < 7 DTE regardless of profit, OR
  // 3. ITM at any DTE (to avoid assignment and keep shares)
  const shouldRoll =
    (profitCaptured >= 80 && dte >= 7) ||
    dte < 7 ||
    itmDepth > 0;

  return {
    positionId: position.id.toString(),
    symbol: position.symbol,
    strategy: 'CC',
    urgency,
    shouldRoll,
    reasons,
    metrics: {
      dte,
      profitCaptured,
      itmDepth,
      delta,
      currentPrice,
      strikePrice: position.strike_price,
    },
    score,
  };
}

/**
 * Analyze all positions and return those needing rolls
 */
export function analyzePositionsForRolls(
  positions: PositionWithMetrics[],
  currentPrices: Record<string, number>
): RollAnalysis[] {
  const analyses: RollAnalysis[] = [];

  for (const position of positions) {
    // Skip if not CSP or CC for Phase 1A
    if (position.strategy !== 'csp' && position.strategy !== 'cc') {
      continue;
    }

    // Skip if position is closed
    if (position.quantity === 0) {
      continue;
    }

    const currentPrice = currentPrices[position.symbol];
    if (!currentPrice) {
      console.warn(`No current price for ${position.symbol}, skipping roll analysis`);
      continue;
    }

    let analysis: RollAnalysis;
    if (position.strategy === 'csp') {
      analysis = analyzeCSPPosition(position, currentPrice);
    } else {
      analysis = analyzeCCPosition(position, currentPrice);
    }

    analyses.push(analysis);
  }

  // Sort by score (most urgent first)
  return analyses.sort((a, b) => b.score - a.score);
}

/**
 * Generate roll candidates for a position
 * TODO: Implement in Phase 1B - fetch option chains and score candidates
 */
export async function generateRollCandidates(
  position: PositionWithMetrics,
  analysis: RollAnalysis
): Promise<RollCandidate[]> {
  const candidates: RollCandidate[] = [];

  // Option 1: Close without rolling
  const closeCost = Math.abs(analysis.metrics.currentPrice);
  candidates.push({
    action: 'close',
    score: 50, // Neutral score
    description: `Close position for $${closeCost.toFixed(2)} ${closeCost > 0 ? 'debit' : 'credit'}`,
  });

  // TODO: Fetch option chains and generate roll candidates
  // For now, return placeholder
  candidates.push({
    action: 'roll',
    strike: analysis.metrics.strikePrice,
    expiration: 'TBD',
    dte: 14,
    netCredit: 0.5,
    newPremium: 1.5,
    annualizedReturn: 35,
    meets3XRule: true,
    delta: 0.25,
    score: 85,
    description: 'Roll out 14 DTE (placeholder - implement in Phase 1B)',
  });

  return candidates;
}
