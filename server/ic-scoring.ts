/**
 * Iron Condor Scoring — SPXW-Aware
 *
 * Two scoring paths:
 *   - Equity path  (isIndex = false): original formula, unchanged
 *   - Index path   (isIndex = true):  recalibrated for SPX/SPXW structural characteristics
 *
 * EQUITY formula (max 100):
 *   ROC×20 + R/R×15 + POP×20 + IVRank×10 + DTE×15 + RSI×10 + BB×10
 *
 * INDEX (SPXW) formula (max 100):
 *   ROC×20 + CreditWidth×15 + ProfitZone×20 + IVRank×15 + DTE×20 + DeltaNeutrality×10
 *
 * Key differences for SPXW:
 *   1. IV Rank: scored against index-specific thresholds (15–45 typical range)
 *      - ≥40 = excellent (15 pts), 30–40 = good (12), 20–30 = fair (8), <20 = low (4)
 *   2. RSI/BB replaced by:
 *      - ProfitZone width as % of underlying price (wider = safer, max 20 pts)
 *      - Delta Neutrality: how close net delta is to 0 (max 10 pts)
 *   3. DTE weight increased to 20 (SPXW weekly timing is critical)
 *   4. Credit/Width ratio normalised for index spreads (typical 0.5–2.5%)
 */

export interface ICScoreBreakdown {
  // Shared fields
  roc: number;          // 0–20
  dte: number;          // 0–15 (equity) or 0–20 (index)
  ivRank: number;       // 0–10 (equity) or 0–15 (index)

  // Equity-only
  riskReward?: number;  // 0–15
  pop?: number;         // 0–20
  rsi?: number;         // 0–10
  bb?: number;          // 0–10

  // Index-only
  creditWidth?: number;    // 0–15
  profitZone?: number;     // 0–20
  deltaNeutrality?: number; // 0–10

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
}

const INDEX_SYMBOLS = new Set(['SPX', 'SPXW', 'NDX', 'RUT', 'VIX', 'XSP']);

export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

// ─── Equity scoring (unchanged from original) ────────────────────────────────
function scoreEquityIC(ic: ICInput): ICScoreBreakdown {
  // ROC: normalised against 10% as max
  const roc = Math.min((ic.roc / 10) * 20, 20);

  // Risk/Reward: credit/collateral ratio, normalised against 5%
  const rrRatio = (ic.totalNetCredit * 100) / ic.totalCollateral;
  const riskReward = Math.min((rrRatio / 5) * 15, 15);

  // POP: profit zone width as % of price, normalised to 20
  const profitZonePct = (ic.profitZone / ic.currentPrice) * 100;
  const pop = Math.min((profitZonePct / 20) * 20, 20);

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

  const total = roc + riskReward + pop + ivRank + dte + rsi + bb;

  return {
    roc: Math.round(roc * 10) / 10,
    riskReward: Math.round(riskReward * 10) / 10,
    pop: Math.round(pop * 10) / 10,
    ivRank: Math.round(ivRank * 10) / 10,
    dte: Math.round(dte * 10) / 10,
    rsi: Math.round(rsi * 10) / 10,
    bb: Math.round(bb * 10) / 10,
    total: Math.round(total * 10) / 10,
    isIndex: false,
  };
}

// ─── Index (SPXW) scoring ─────────────────────────────────────────────────────
function scoreIndexIC(ic: ICInput): ICScoreBreakdown {
  // ROC: same normalisation as equity (SPXW ROC is comparable)
  const roc = Math.min((ic.roc / 10) * 20, 20);

  // Credit/Width ratio: credit per $1 of spread width, normalised to 15
  // Typical SPXW IC: $0.50–$2.50 credit on a $5-wide spread = 10–50%
  // Excellent: ≥30% (credit ≥ 30% of spread width)
  const creditWidthPct = ic.spreadWidth > 0
    ? (ic.totalNetCredit / ic.spreadWidth) * 100
    : 0;
  const creditWidth = Math.min((creditWidthPct / 30) * 15, 15);

  // Profit Zone: width as % of underlying price (SPXW ~5700)
  // 5-wide spread → profit zone ~10–20% of price = excellent
  // Normalised: 15% = max score
  const profitZonePct = ic.currentPrice > 0
    ? (ic.profitZone / ic.currentPrice) * 100
    : 0;
  const profitZone = Math.min((profitZonePct / 15) * 20, 20);

  // IV Rank: recalibrated for index (typical range 15–45)
  // Score against index-specific thresholds (not 0–100 equity scale)
  let ivRank = 7; // default: moderate
  if (ic.ivRank !== null) {
    if (ic.ivRank >= 40) ivRank = 15;       // Elevated index IV — excellent premium
    else if (ic.ivRank >= 30) ivRank = 12;  // Good
    else if (ic.ivRank >= 20) ivRank = 8;   // Fair
    else if (ic.ivRank >= 10) ivRank = 5;   // Low
    else ivRank = 2;                         // Very low — poor premium environment
  }

  // DTE: prefer 21–45 for SPXW (weekly cadence, weight 20)
  // Sweet spot: 28–42 DTE for 45→21 DTE management
  let dte = 0;
  if (ic.dte >= 28 && ic.dte <= 42) {
    dte = 20; // Perfect window
  } else if (ic.dte >= 21 && ic.dte <= 49) {
    dte = Math.max(0, 20 - Math.abs(ic.dte - 35) / 2);
  } else if (ic.dte >= 14 && ic.dte < 21) {
    dte = 8; // Short — manageable but not ideal
  } else if (ic.dte < 14) {
    dte = 3; // Too short for new entry
  } else {
    dte = Math.max(0, 20 - (ic.dte - 49) / 3); // Too far out
  }

  // Delta Neutrality: net delta of all 4 legs should be close to 0
  // Perfect IC: net delta = 0; max acceptable: ±0.10
  const absDelta = Math.abs(ic.netDelta);
  let deltaNeutrality: number;
  if (absDelta <= 0.02) deltaNeutrality = 10;
  else if (absDelta <= 0.05) deltaNeutrality = 8;
  else if (absDelta <= 0.08) deltaNeutrality = 5;
  else if (absDelta <= 0.12) deltaNeutrality = 3;
  else deltaNeutrality = 1;

  const total = roc + creditWidth + profitZone + ivRank + dte + deltaNeutrality;

  return {
    roc: Math.round(roc * 10) / 10,
    creditWidth: Math.round(creditWidth * 10) / 10,
    profitZone: Math.round(profitZone * 10) / 10,
    ivRank: Math.round(ivRank * 10) / 10,
    dte: Math.round(dte * 10) / 10,
    deltaNeutrality: Math.round(deltaNeutrality * 10) / 10,
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
