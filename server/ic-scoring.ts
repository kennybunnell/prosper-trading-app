/**
 * Iron Condor Scoring — SPXW-Aware
 *
 * Two scoring paths:
 *   - Equity path  (isIndex = false): original formula, unchanged
 *   - Index path   (isIndex = true):  recalibrated for SPX/SPXW structural characteristics
 *
 * EQUITY formula (max 100):
 *   ROC×15 + R/R×15 + POP×15 + IVRank×10 + DTE×15 + RSI×10 + BB×10 + DeltaBalance×10
 *
 * INDEX (SPXW/NDX/etc.) formula (max 100):
 *   ROC×20 + CreditWidth×15 + ProfitZone×15 + IVRank×15 + DTE×15 + DeltaBalance×20
 *
 * Delta Balance (NEW — replaces old DeltaNeutrality):
 *   Measures SYMMETRY between the short put delta and short call delta.
 *   A perfectly balanced IC has |shortPutDelta| ≈ |shortCallDelta|.
 *   The old metric only checked if net delta was near 0, which could be fooled by
 *   two large but opposite deltas. The new metric directly rewards symmetric wings.
 *
 *   Balance ratio = min(|putΔ|, |callΔ|) / max(|putΔ|, |callΔ|)
 *   → 1.0 = perfectly symmetric, 0.0 = completely one-sided
 *
 *   Index weight: 20 pts (critical for neutral index ICs)
 *   Equity weight: 10 pts
 *
 * Key differences for Index path:
 *   1. IV Rank: scored against index-specific thresholds (15–45 typical range)
 *   2. RSI/BB replaced by DeltaBalance (20 pts) + wider ProfitZone check
 *   3. DTE weight 15 (SPXW weekly timing is critical)
 *   4. Credit/Width ratio normalised for index spreads (typical 0.5–2.5%)
 */

export interface ICScoreBreakdown {
  // Shared fields
  roc: number;          // 0–20
  dte: number;          // 0–15 (equity) or 0–15 (index)
  ivRank: number;       // 0–10 (equity) or 0–15 (index)
  deltaBalance: number; // 0–10 (equity) or 0–20 (index) — NEW: symmetry of put/call deltas

  // Equity-only
  riskReward?: number;  // 0–15
  pop?: number;         // 0–15
  rsi?: number;         // 0–10
  bb?: number;          // 0–10

  // Index-only
  creditWidth?: number;    // 0–15
  profitZone?: number;     // 0–15

  total: number;        // 0–100
  isIndex: boolean;
}

export interface ICInput {
  symbol: string;
  roc: number;           // % return on collateral
  totalNetCredit: number; // $ per share
  totalCollateral: number; // $ total
  profitZone: number;    // $ width of profit zone (upperBE - lowerBE)
  currentPrice: number;
  ivRank: number | null;
  dte: number;
  rsi: number | null;
  bbPctB: number | null;
  netDelta: number;      // sum of all 4 leg deltas (ideally ~0)
  spreadWidth: number;   // max(put spread width, call spread width)
  // Individual short leg deltas — used for balance scoring
  putShortDelta?: number | null;   // short put delta (negative, e.g. -0.20)
  callShortDelta?: number | null;  // short call delta (positive, e.g. +0.20)
}

const INDEX_SYMBOLS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'MRUT', 'XSP', 'VIX']);

export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Compute the delta balance score for an IC.
 *
 * Balance ratio = min(|putΔ|, |callΔ|) / max(|putΔ|, |callΔ|)
 *   1.0 = perfectly symmetric wings (ideal)
 *   0.5 = one wing is 2× the other (moderate skew)
 *   0.0 = completely one-sided (worst)
 *
 * @param maxPoints  Maximum score points (10 for equity, 20 for index)
 */
function computeDeltaBalance(ic: ICInput, maxPoints: number): number {
  const putAbs = Math.abs(ic.putShortDelta ?? 0);
  const callAbs = Math.abs(ic.callShortDelta ?? 0);

  // If we don't have individual deltas, fall back to net delta proximity to 0
  if (putAbs === 0 && callAbs === 0) {
    const absDelta = Math.abs(ic.netDelta);
    if (absDelta <= 0.02) return maxPoints;
    if (absDelta <= 0.05) return maxPoints * 0.8;
    if (absDelta <= 0.08) return maxPoints * 0.5;
    if (absDelta <= 0.12) return maxPoints * 0.3;
    return maxPoints * 0.1;
  }

  const lo = Math.min(putAbs, callAbs);
  const hi = Math.max(putAbs, callAbs);
  if (hi === 0) return maxPoints;

  const ratio = lo / hi; // 0–1, higher = more symmetric

  // Score tiers
  if (ratio >= 0.90) return maxPoints;           // ≤10% skew — excellent
  if (ratio >= 0.75) return maxPoints * 0.80;    // ≤25% skew — good
  if (ratio >= 0.60) return maxPoints * 0.55;    // ≤40% skew — fair
  if (ratio >= 0.40) return maxPoints * 0.30;    // ≤60% skew — poor
  return maxPoints * 0.10;                        // >60% skew — very skewed
}

// ─── Equity scoring ────────────────────────────────────────────────────────────
// Formula: ROC×15 + R/R×15 + POP×15 + IVRank×10 + DTE×15 + RSI×10 + BB×10 + DeltaBalance×10
function scoreEquityIC(ic: ICInput): ICScoreBreakdown {
  // ROC: normalised against 10% as max
  const roc = Math.min((ic.roc / 10) * 15, 15);

  // Risk/Reward: credit/collateral ratio, normalised against 5%
  const rrRatio = (ic.totalNetCredit * 100) / ic.totalCollateral;
  const riskReward = Math.min((rrRatio / 5) * 15, 15);

  // POP: profit zone width as % of price, normalised to 15
  const profitZonePct = (ic.profitZone / ic.currentPrice) * 100;
  const pop = Math.min((profitZonePct / 20) * 15, 15);

  // IV Rank: 0–10
  const ivRank = ic.ivRank !== null ? (ic.ivRank / 100) * 10 : 5;

  // DTE: prefer 30–45, weight 15
  const dte = ic.dte >= 30 && ic.dte <= 45
    ? 15
    : Math.max(0, 15 - Math.abs(ic.dte - 37.5) / 3);

  // RSI: prefer neutral 40–60
  let rsi = 5;
  if (ic.rsi !== null) {
    if (ic.rsi >= 40 && ic.rsi <= 60) rsi = 10;
    else if (ic.rsi >= 35 && ic.rsi <= 65) rsi = 7;
    else if (ic.rsi >= 30 && ic.rsi <= 70) rsi = 4;
    else rsi = 2;
  }

  // BB %B: prefer middle 0.3–0.7
  let bb = 5;
  if (ic.bbPctB !== null) {
    if (ic.bbPctB >= 0.3 && ic.bbPctB <= 0.7) bb = 10;
    else if (ic.bbPctB >= 0.2 && ic.bbPctB <= 0.8) bb = 6;
    else bb = 2;
  }

  // Delta Balance: symmetry of put/call short deltas (10 pts for equity)
  const deltaBalance = computeDeltaBalance(ic, 10);

  const total = roc + riskReward + pop + ivRank + dte + rsi + bb + deltaBalance;

  return {
    roc: Math.round(roc * 10) / 10,
    riskReward: Math.round(riskReward * 10) / 10,
    pop: Math.round(pop * 10) / 10,
    ivRank: Math.round(ivRank * 10) / 10,
    dte: Math.round(dte * 10) / 10,
    rsi: Math.round(rsi * 10) / 10,
    bb: Math.round(bb * 10) / 10,
    deltaBalance: Math.round(deltaBalance * 10) / 10,
    total: Math.round(total * 10) / 10,
    isIndex: false,
  };
}

// ─── Index (SPXW/NDX/etc.) scoring ────────────────────────────────────────────
// Formula: ROC×20 + CreditWidth×15 + ProfitZone×15 + IVRank×15 + DTE×15 + DeltaBalance×20
function scoreIndexIC(ic: ICInput): ICScoreBreakdown {
  // ROC: same normalisation as equity
  const roc = Math.min((ic.roc / 10) * 20, 20);

  // Credit/Width ratio: credit per $1 of spread width, normalised to 15
  const creditWidthPct = ic.spreadWidth > 0
    ? (ic.totalNetCredit / ic.spreadWidth) * 100
    : 0;
  const creditWidth = Math.min((creditWidthPct / 30) * 15, 15);

  // Profit Zone: width as % of underlying price
  const profitZonePct = ic.currentPrice > 0
    ? (ic.profitZone / ic.currentPrice) * 100
    : 0;
  const profitZone = Math.min((profitZonePct / 15) * 15, 15);

  // IV Rank: recalibrated for index (typical range 15–45)
  let ivRank = 7;
  if (ic.ivRank !== null) {
    if (ic.ivRank >= 40) ivRank = 15;
    else if (ic.ivRank >= 30) ivRank = 12;
    else if (ic.ivRank >= 20) ivRank = 8;
    else if (ic.ivRank >= 10) ivRank = 5;
    else ivRank = 2;
  }

  // DTE: prefer 21–45 for index (weight 15)
  let dte = 0;
  if (ic.dte >= 28 && ic.dte <= 42) {
    dte = 15;
  } else if (ic.dte >= 21 && ic.dte <= 49) {
    dte = Math.max(0, 15 - Math.abs(ic.dte - 35) * 0.75);
  } else if (ic.dte >= 14 && ic.dte < 21) {
    dte = 6;
  } else if (ic.dte < 14) {
    dte = 2;
  } else {
    dte = Math.max(0, 15 - (ic.dte - 49) / 3);
  }

  // Delta Balance: symmetry of put/call short deltas (20 pts for index — critical)
  // For index ICs, a skewed condor is a major risk since the index can gap significantly.
  // A balanced IC (equal put/call deltas) is the gold standard for neutral income.
  const deltaBalance = computeDeltaBalance(ic, 20);

  const total = roc + creditWidth + profitZone + ivRank + dte + deltaBalance;

  return {
    roc: Math.round(roc * 10) / 10,
    creditWidth: Math.round(creditWidth * 10) / 10,
    profitZone: Math.round(profitZone * 10) / 10,
    ivRank: Math.round(ivRank * 10) / 10,
    dte: Math.round(dte * 10) / 10,
    deltaBalance: Math.round(deltaBalance * 10) / 10,
    total: Math.round(total * 10) / 10,
    isIndex: true,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function scoreIronCondor(ic: ICInput): { score: number; scoreBreakdown: ICScoreBreakdown } {
  const breakdown = isIndexSymbol(ic.symbol)
    ? scoreIndexIC(ic)
    : scoreEquityIC(ic);

  return {
    score: Math.min(100, Math.round(breakdown.total * 10) / 10),
    scoreBreakdown: breakdown,
  };
}

/**
 * Batch score an array of IC opportunities.
 * Returns the same array with `score` and `scoreBreakdown` added.
 */
export function scoreIronCondors<T extends ICInput>(ics: T[]): (T & { score: number; scoreBreakdown: ICScoreBreakdown })[] {
  return ics.map(ic => {
    const { score, scoreBreakdown } = scoreIronCondor(ic);
    return { ...ic, score, scoreBreakdown };
  });
}
