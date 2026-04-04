/**
 * Roll Detection Logic for Options Positions
 * 
 * Implements multi-factor urgency scoring for CSP and CC positions
 * based on 7/14 DTE thresholds, profit capture %, ITM depth, and delta.
 */

import type { Position } from '../shared/types';

// Extended position type with computed fields for roll analysis
export interface PositionWithMetrics extends Position {
  option_symbol: string; // Full OCC option symbol from Tastytrade
  open_premium: number;
  current_value: number;
  expiration_date: string;
  strike_price: number;
  delta: number;
}

export type RollUrgency = 'red' | 'yellow' | 'green';

export interface RollAnalysis {
  positionId: string;
  symbol: string; // Underlying ticker (e.g., "V")
  optionSymbol: string; // Full OCC option symbol from Tastytrade (e.g., "V     20260130P00310000")
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
    currentValue: number; // Position's current value (for closing cost)
    openPremium: number; // Premium received when opening position
    expiration: string; // Expiration date string
  };
  score: number; // 0-100, higher = more urgent
}

export interface RollCandidate {
  action: 'close' | 'roll';
  strike?: number;
  expiration?: string;
  dte?: number;
  netCredit?: number; // positive = credit, negative = debit
  closeCost?: number;  // absolute debit required to BTC (always positive, only on close action)
  netPnl?: number;     // openPremium - closeCost (positive = profit, negative = loss)
  openPremium?: number; // original credit received when position was opened
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
 * Determine urgency level based on moneyness (ITM depth)
 * 
 * Red = In-the-money (ITM) - option breached, urgent action needed
 * Yellow = Near at-the-money (ATM) - getting close, watch closely
 * Green = Far out-of-the-money (OTM) - safe zone
 */
function getUrgencyLevel(
  profitCaptured: number,
  itmDepth: number,
  dte: number
): RollUrgency {
  // Red: ITM (itmDepth > 0) - option strike breached, urgent
  if (itmDepth > 0) return 'red';
  
  // Yellow: Near ATM (within 5% of strike) - getting close, watch
  if (itmDepth > -5) return 'yellow';
  
  // Green: Far OTM (more than 5% away from strike) - safe zone
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
  const urgency = getUrgencyLevel(profitCaptured, itmDepth, dte);
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
    optionSymbol: position.option_symbol, // Store the full option symbol from Tastytrade
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
      currentValue: position.current_value,
      openPremium: position.open_premium,
      expiration: position.expiration_date,
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
  const urgency = getUrgencyLevel(profitCaptured, itmDepth, dte);
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
    optionSymbol: position.option_symbol, // Store the full option symbol from Tastytrade
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
      currentValue: position.current_value,
      openPremium: position.open_premium,
      expiration: position.expiration_date,
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
  tradierClient: any,
  dteOverride?: { min?: number; max?: number }
): Promise<RollCandidate[]> {
  // Generate roll candidates for position
  
  const candidates: RollCandidate[] = [];
  const isPut = analysis.strategy === 'CSP';
  const isCall = analysis.strategy === 'CC';

  // Option 1: Close without rolling
  const closeCost = Math.abs(position.current_value);
  const openPremiumAbs = Math.abs(position.open_premium);
  const netPnl = openPremiumAbs - closeCost; // positive = profit, negative = loss
  candidates.push({
    action: 'close',
    score: 50, // Neutral score
    closeCost,
    netPnl,
    openPremium: openPremiumAbs,
    description: `Close — BTC $${closeCost.toFixed(2)} · net ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`,
  });

  if (!expirations || expirations.length === 0) {
    console.warn('[generateRollCandidates] No expirations available');
    return candidates;
  }


  const currentStrike = analysis.metrics.strikePrice;
  const currentDTE = analysis.metrics.dte;

  // Filter expirations: look 14-45 DTE out from today (or 0-21 for 0 DTE positions).
  // This matches Tastytrade's Roll Expirations menu which shows credits at 6-37 DTE.
  // We always look at least 1 DTE beyond the current expiry to avoid rolling into the same expiry.
  // dteOverride allows the user to specify a custom DTE range from the UI.
  const minDTE = dteOverride?.min !== undefined ? dteOverride.min : (currentDTE === 0 ? 0 : Math.max(1, currentDTE + 1));
  const maxDTE = dteOverride?.max !== undefined ? dteOverride.max : (currentDTE === 0 ? 21 : Math.max(45, currentDTE + 45));
  
  const suitableExpirations = expirations.filter((expDate: string) => {
    const dte = calculateDTE(expDate);
    const suitable = dte >= minDTE && dte <= maxDTE && dte > currentDTE;
    return suitable;
  });


  // Fetch all suitable option chains IN PARALLEL (rate-limited) instead of sequentially.
  // This is the primary speed improvement: N expirations used to be N sequential awaits;
  // now they all fire concurrently through the shared rate limiter.
  const { withRateLimit } = await import('./tradierRateLimiter');
  const chainResults = await Promise.allSettled(
    suitableExpirations.map(expirationDate =>
      withRateLimit(() => tradierClient.getOptionChain(position.symbol, expirationDate, true) as Promise<any[]>)
        .then((options: any[]) => ({ expirationDate, options }))
    )
  );

  for (const result of chainResults) {
    if (result.status === 'rejected') {
      console.error('[generateRollCandidates] Chain fetch failed:', result.reason);
      continue;
    }
    const { expirationDate, options } = result.value as { expirationDate: string; options: any[] };
    const dte = calculateDTE(expirationDate);

    try {
      // Filter to correct option type
      const relevantOptions = options.filter((opt: any) =>
        opt.option_type === (isPut ? 'put' : 'call')
      );

      // Scenario 1: Roll Out (Same Strike)
      const sameStrikeOption = relevantOptions.find((opt: any) =>
        Math.abs(opt.strike - currentStrike) < 0.01
      );
      if (sameStrikeOption) {
        const candidate = await createRollCandidateFromTradier(
          'roll-out',
          sameStrikeOption,
          expirationDate,
          dte,
          position,
          underlyingPrice,
          isPut
        );
        if (candidate) candidates.push(candidate);
      }

      // Scenario 2: Roll Up/Down and Out
      if (isPut) {
        // For CSP: Roll down (lower strike = more OTM)
        const lowerStrikes = relevantOptions
          .filter((opt: any) => opt.strike < currentStrike)
          .sort((a: any, b: any) => b.strike - a.strike) // Descending
          .slice(0, 3);

        for (const opt of lowerStrikes) {
          const candidate = await createRollCandidateFromTradier(
            'roll-down-out',
            opt,
            expirationDate,
            dte,
            position,
            underlyingPrice,
            isPut
          );
          if (candidate) candidates.push(candidate);
        }
      } else if (isCall) {
        // For CC: Roll up (higher strike = more OTM)
        const higherStrikes = relevantOptions
          .filter((opt: any) => opt.strike > currentStrike)
          .sort((a: any, b: any) => a.strike - b.strike) // Ascending
          .slice(0, 3);

        for (const opt of higherStrikes) {
          const candidate = await createRollCandidateFromTradier(
            'roll-up-out',
            opt,
            expirationDate,
            dte,
            position,
            underlyingPrice,
            isPut
          );
          if (candidate) candidates.push(candidate);
        }
      }
    } catch (error) {
      console.error('[generateRollCandidates] Error processing chain for', expirationDate, error);
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
 * Create a roll candidate from Tradier option data with real pricing
 */
async function createRollCandidateFromTradier(
  rollType: string,
  option: any, // Tradier option object with bid, ask, strike, greeks, etc.
  newExpiration: string,
  dte: number,
  position: PositionWithMetrics,
  underlyingPrice: number,
  isPut: boolean
): Promise<RollCandidate | null> {
  // Use mid-price for new STO leg (per contract, not multiplied by qty/100)
  const bid = option.bid || 0;
  const ask = option.ask || 0;
  const newPremiumPerContract = (bid + ask) / 2;
  
  if (newPremiumPerContract <= 0) {
    console.warn('[createRollCandidateFromTradier] Invalid premium:', newPremiumPerContract);
    return null;
  }
  
  const newStrike = option.strike;
  const qty = Math.abs(position.quantity) || 1;

  // CRITICAL FIX: position.current_value is in TOTAL DOLLARS (qty × 100 already applied).
  // newPremiumPerContract is PER CONTRACT. We must normalise to the same unit.
  // Per-contract current BTC cost = totalBtcCost / (qty × 100)
  const totalBtcCost = Math.abs(position.current_value);
  const currentMarkPerContract = totalBtcCost / (qty * 100);

  // Net credit of the atomic roll (per contract) = new STO mid − current BTC mid
  // Positive = credit roll (we receive more than we pay), Negative = debit roll
  const netCreditPerContract = newPremiumPerContract - currentMarkPerContract;
  const netCredit = netCreditPerContract * qty * 100; // Scale back to total dollars
  const newPremium = newPremiumPerContract * qty * 100; // Total STO premium in dollars
  const closeCost = totalBtcCost;
  const meets3XRule = newPremiumPerContract >= (currentMarkPerContract * 3);
  
  // Calculate annualized return
  // Return = (net credit per contract / capital at risk per contract) * (365 / DTE) * 100
  const capitalAtRisk = isPut ? newStrike * 100 : underlyingPrice * 100; // Per contract
  const annualizedReturn = (netCreditPerContract * 100 / capitalAtRisk) * (365 / dte) * 100;

  // Use real delta from Tradier greeks if available, otherwise approximate
  const delta = option.greeks?.delta || approximateDelta(newStrike, underlyingPrice, isPut ? 'put' : 'call');

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
