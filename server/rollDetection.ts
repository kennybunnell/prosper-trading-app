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
 * Approximate delta based on moneyness (ITM depth)
 * This is a simplified approximation for when real greeks are unavailable
 * 
 * For puts:
 * - Deep OTM (< -10%): delta ≈ -0.10 to -0.20
 * - OTM (-10% to 0%): delta ≈ -0.20 to -0.45
 * - ATM (0%): delta ≈ -0.50
 * - ITM (0% to +10%): delta ≈ -0.55 to -0.80
 * - Deep ITM (> +10%): delta ≈ -0.80 to -0.95
 * 
 * For calls: same magnitudes but positive
 */
function approximateDelta(
  strikePrice: number,
  currentPrice: number,
  optionType: 'put' | 'call'
): number {
  const moneyness = (currentPrice - strikePrice) / strikePrice * 100;
  let delta: number;

  if (optionType === 'put') {
    // For puts, moneyness is inverted
    if (moneyness < -10) {
      // Deep OTM
      delta = -0.15;
    } else if (moneyness < -5) {
      // OTM
      delta = -0.25;
    } else if (moneyness < 0) {
      // Slightly OTM to ATM
      delta = -0.35 + (moneyness / 5) * 0.15; // Linear interpolation
    } else if (moneyness < 5) {
      // Slightly ITM
      delta = -0.55 - (moneyness / 5) * 0.15;
    } else if (moneyness < 10) {
      // ITM
      delta = -0.75;
    } else {
      // Deep ITM
      delta = -0.90;
    }
  } else {
    // For calls
    if (moneyness > 10) {
      // Deep ITM
      delta = 0.90;
    } else if (moneyness > 5) {
      // ITM
      delta = 0.75;
    } else if (moneyness > 0) {
      // Slightly ITM
      delta = 0.55 + (moneyness / 5) * 0.15;
    } else if (moneyness > -5) {
      // Slightly OTM to ATM
      delta = 0.35 - (moneyness / 5) * 0.15; // Linear interpolation
    } else if (moneyness > -10) {
      // OTM
      delta = 0.25;
    } else {
      // Deep OTM
      delta = 0.15;
    }
  }

  return delta;
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
  // Use provided delta or approximate based on moneyness
  const delta = position.delta || approximateDelta(position.strike_price, currentPrice, 'put');

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
  // Use provided delta or approximate based on moneyness
  const delta = position.delta || approximateDelta(position.strike_price, currentPrice, 'call');

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
 * Fetches opt/**
 * Generate roll candidates for a position
 * 
 * @param position - Position to generate roll candidates for
 * @param analysis - Roll analysis with current metrics
 * @param expirations - Array of available expiration dates from Tradier API
 * @param underlyingPrice - Current price of underlying stock
 * @param tradierClient - Tradier API client instance for fetching option chains
 * @returns Array of roll candidates sorted by score (best first)
 */
export async function generateRollCandidates(
  position: PositionWithMetrics,
  analysis: RollAnalysis,
  expirations: string[],
  underlyingPrice: number,
  tradierClient: any
): Promise<RollCandidate[]> {
  console.log('[generateRollCandidates] Starting with:', {
    symbol: position.symbol,
    strategy: analysis.strategy,
    currentStrike: analysis.metrics.strikePrice,
    currentDTE: analysis.metrics.dte,
    underlyingPrice,
    optionChainHasItems: !!optionChain?.items,
  });
  
  const candidates: RollCandidate[] = [];
  const isPut = analysis.strategy === 'CSP';
  const isCall = analysis.strategy === 'CC';

  // Option 1: Close without rolling
  const closeCost = Math.abs(position.current_value);
  const realizedProfit = Math.abs(position.open_premium) - closeCost;
  candidates.push({
    action: 'close',
    score: 50, // Neutral score
    description: `Close for $${closeCost.toFixed(2)} debit (realize $${realizedProfit.toFixed(2)} profit)`,
  });

  // Parse option chain to find suitable roll candidates
  if (!optionChain?.expirations) {
    console.warn('[generateRollCandidates] No option chain data available');
    return candidates;
  }
  
  console.log('[generateRollCandidates] Option chain has', optionChain.expirations.length, 'expirations');

  const currentStrike = analysis.metrics.strikePrice;
  const currentDTE = analysis.metrics.dte;

  // Filter expirations to 7-14 DTE range (user preference)
  const suitableExpirations = optionChain.expirations.filter((exp: any) => {
    const expDate = new Date(exp['expiration-date']);
    const dte = calculateDTE(exp['expiration-date']);
    const suitable = dte >= 7 && dte <= 14 && dte > currentDTE; // Must be further out than current
    console.log('[generateRollCandidates] Expiration', exp['expiration-date'], 'DTE:', dte, 'Suitable:', suitable);
    return suitable;
  });
  
  console.log('[generateRollCandidates] Found', suitableExpirations.length, 'suitable expirations in 7-14 DTE range');

  // Generate roll scenarios for each suitable expiration
  for (const expiration of suitableExpirations) {
    const expirationDate = expiration['expiration-date'];
    const dte = calculateDTE(expirationDate);
    const strikes = expiration.strikes || [];

    // Scenario 1: Roll Out (Same Strike)
    const sameStrikeOption = strikes.find((s: any) => 
      Math.abs(parseFloat(s['strike-price']) - currentStrike) < 0.01
    );
    if (sameStrikeOption) {
      const optionSymbol = isPut ? sameStrikeOption['put'] : sameStrikeOption['call'];
      if (optionSymbol) {
        const candidate = createRollCandidate(
          'roll-out',
          currentStrike,
          expirationDate,
          dte,
          optionSymbol,
          position,
          underlyingPrice,
          isPut
        );
        if (candidate) candidates.push(candidate);
      }
    }

    // Scenario 2: Roll Up and Out (for CSP) or Roll Down and Out (for CC)
    if (isPut) {
      // For CSP: Roll down to collect more premium (lower strike = more OTM)
      const lowerStrikes = strikes
        .filter((s: any) => parseFloat(s['strike-price']) < currentStrike)
        .sort((a: any, b: any) => parseFloat(b['strike-price']) - parseFloat(a['strike-price'])) // Descending
        .slice(0, 3); // Top 3 lower strikes

      for (const strike of lowerStrikes) {
        const optionSymbol = strike['put'];
        if (optionSymbol) {
          const candidate = createRollCandidate(
            'roll-down-out',
            parseFloat(strike['strike-price']),
            expirationDate,
            dte,
            optionSymbol,
            position,
            underlyingPrice,
            isPut
          );
          if (candidate) candidates.push(candidate);
        }
      }
    } else if (isCall) {
      // For CC: Roll up to avoid assignment (higher strike = more OTM)
      const higherStrikes = strikes
        .filter((s: any) => parseFloat(s['strike-price']) > currentStrike)
        .sort((a: any, b: any) => parseFloat(a['strike-price']) - parseFloat(b['strike-price'])) // Ascending
        .slice(0, 3); // Top 3 higher strikes

      for (const strike of higherStrikes) {
        const optionSymbol = strike['call'];
        if (optionSymbol) {
          const candidate = createRollCandidate(
            'roll-up-out',
            parseFloat(strike['strike-price']),
            expirationDate,
            dte,
            optionSymbol,
            position,
            underlyingPrice,
            isPut
          );
          if (candidate) candidates.push(candidate);
        }
      }
    }
  }

  // Score and sort candidates (best first)
  const scoredCandidates = candidates.map(c => ({
    ...c,
    score: scoreRollCandidate(c, position, analysis),
  }));

  // Return top 5 roll candidates + close option
  const closeOption = scoredCandidates.find(c => c.action === 'close')!;
  const rollCandidates = scoredCandidates
    .filter(c => c.action === 'roll')
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return [closeOption, ...rollCandidates];
}

/**
 * Create a roll candidate from option chain data
 * Note: This is a placeholder - actual implementation needs option quotes
 */
function createRollCandidate(
  rollType: string,
  newStrike: number,
  newExpiration: string,
  dte: number,
  optionSymbol: string,
  position: PositionWithMetrics,
  underlyingPrice: number,
  isPut: boolean
): RollCandidate | null {
  // TODO: Fetch actual option quote for newPremium
  // For now, use placeholder values
  const newPremium = 1.50; // Placeholder - needs real quote
  const closeCost = Math.abs(position.current_value);
  const netCredit = newPremium - closeCost;
  const meets3XRule = newPremium >= (closeCost * 3);
  
  // Calculate annualized return
  // Return = (net credit / capital at risk) * (365 / DTE) * 100
  const capitalAtRisk = isPut ? newStrike * 100 : underlyingPrice * 100; // Per contract
  const annualizedReturn = (netCredit / capitalAtRisk) * (365 / dte) * 100;

  // Approximate delta
  const delta = approximateDelta(newStrike, underlyingPrice, isPut ? 'put' : 'call');

  let description = '';
  if (rollType === 'roll-out') {
    description = `Roll out to $${newStrike.toFixed(2)} ${new Date(newExpiration).toLocaleDateString()} (${dte} DTE)`;
  } else if (rollType === 'roll-down-out') {
    description = `Roll down & out to $${newStrike.toFixed(2)} ${new Date(newExpiration).toLocaleDateString()} (${dte} DTE)`;
  } else if (rollType === 'roll-up-out') {
    description = `Roll up & out to $${newStrike.toFixed(2)} ${new Date(newExpiration).toLocaleDateString()} (${dte} DTE)`;
  }

  return {
    action: 'roll',
    strike: newStrike,
    expiration: newExpiration,
    dte,
    netCredit,
    newPremium,
    annualizedReturn,
    meets3XRule,
    delta,
    score: 0, // Will be calculated later
    description,
  };
}

/**
 * Score a roll candidate (0-100, higher = better)
 */
function scoreRollCandidate(
  candidate: RollCandidate,
  position: PositionWithMetrics,
  analysis: RollAnalysis
): number {
  if (candidate.action === 'close') {
    // Close option gets neutral score
    return 50;
  }

  let score = 0;

  // Net Credit Factor (0-30 points)
  if (candidate.netCredit! > 0) {
    score += 30; // Prefer credits
  } else if (candidate.netCredit! > -0.25) {
    score += 20; // Small debit acceptable
  } else {
    score += 5; // Large debit penalized
  }

  // Annualized Return Factor (0-25 points)
  const annReturn = candidate.annualizedReturn || 0;
  if (annReturn >= 40) {
    score += 25;
  } else if (annReturn >= 30) {
    score += 20;
  } else if (annReturn >= 20) {
    score += 15;
  } else if (annReturn >= 10) {
    score += 10;
  } else {
    score += 5;
  }

  // 3X Rule Factor (0-15 points)
  if (candidate.meets3XRule) {
    score += 15;
  }

  // DTE Factor (0-15 points) - prefer 7-14 range
  const dte = candidate.dte || 0;
  if (dte >= 7 && dte <= 14) {
    score += 15;
  } else if (dte > 14 && dte <= 21) {
    score += 10;
  } else {
    score += 5;
  }

  // Delta Factor (0-15 points) - prefer lower delta (less ITM risk)
  const absDelta = Math.abs(candidate.delta || 0);
  if (absDelta < 0.25) {
    score += 15; // Very safe
  } else if (absDelta < 0.35) {
    score += 12; // Safe
  } else if (absDelta < 0.45) {
    score += 8; // Moderate
  } else {
    score += 3; // Risky
  }

  return Math.min(100, score);
}
