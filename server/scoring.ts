/**
 * Scoring System v2 — D1–D6 Framework
 *
 * Unified scoring dimensions applied across all strategies:
 *   D1 Liquidity        — Bid/ask spread %, OI, volume
 *   D2 Probability Fit  — Delta, DTE, POP proxy
 *   D3 Premium Efficiency — Credit vs capital at risk (ROC / weekly %)
 *   D4 IV Richness      — IV Rank / IV Percentile
 *   D5 Strike Safety    — OTM distance vs 1-sigma expected move
 *   D6 Technical Context — RSI, BB %B, 14-day trend
 *
 * Per-strategy weights (see scoring-blueprint.md):
 *   Strategy | D1  | D2  | D3  | D4  | D5  | D6
 *   CSP      | 15% | 20% | 20% | 15% | 15% | 15%
 *   BPS      | 15% | 20% | 25% | 10% | 10% | 20%
 */

import { CSPOpportunity } from './tradier';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** 1-sigma expected move: IV × √(DTE/365) × price */
export function expectedMove(price: number, iv: number, dte: number): number {
  if (!price || !iv || !dte) return 0;
  return price * (iv / 100) * Math.sqrt(dte / 365);
}

/** Bid-ask spread as % of mid */
export function spreadPct(bid: number, ask: number): number {
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : 100;
}

// Index symbols — RSI/BB not meaningful; delta thresholds differ
const INDEX_SYMBOLS = new Set([
  'SPXW', 'NDXP', 'MRUT', 'SPX', 'NDX', 'RUT', 'XSP', 'DJX', 'VIX', 'VIXW', 'OEX', 'XEO',
]);

// ─── D1: Liquidity (0–15 pts) ────────────────────────────────────────────────

function scoreD1Liquidity(
  bid: number,
  ask: number,
  oi: number,
  volume: number,
  maxPts = 15
): number {
  let s = 0;
  const sp = spreadPct(bid, ask);

  // Bid-ask spread % (40% of D1)
  const spreadMax = maxPts * 0.4;
  if (sp <= 1)        s += spreadMax;
  else if (sp <= 2)   s += spreadMax * 0.85;
  else if (sp <= 5)   s += spreadMax * 0.60;
  else if (sp <= 10)  s += spreadMax * 0.30;
  else if (sp <= 20)  s += spreadMax * 0.10;
  // > 20% = 0

  // OI (40% of D1)
  const oiMax = maxPts * 0.4;
  if (oi >= 1000)      s += oiMax;
  else if (oi >= 500)  s += oiMax * 0.85;
  else if (oi >= 200)  s += oiMax * 0.65;
  else if (oi >= 100)  s += oiMax * 0.45;
  else if (oi >= 50)   s += oiMax * 0.25;
  else if (oi >= 10)   s += oiMax * 0.10;
  else if (oi === 0)   s -= maxPts * 0.3; // Hard penalty: OI=0 rarely fills

  // Volume (20% of D1)
  const volMax = maxPts * 0.2;
  if (volume >= 500)      s += volMax;
  else if (volume >= 200) s += volMax * 0.75;
  else if (volume >= 50)  s += volMax * 0.40;
  else if (volume >= 10)  s += volMax * 0.15;

  return Math.max(0, Math.min(maxPts, s));
}

// ─── D2: Probability Fit (0–20 pts) ─────────────────────────────────────────

function scoreD2ProbabilityCSP(delta: number, dte: number, isIndex: boolean, maxPts = 20): number {
  let s = 0;
  const d = Math.abs(delta);

  // Delta (50% of D2) — lower delta = higher probability OTM
  const deltaMax = maxPts * 0.5;
  if (isIndex) {
    if (d >= 0.15 && d <= 0.20)      s += deltaMax;
    else if (d > 0.20 && d <= 0.25)  s += deltaMax * 0.87;
    else if (d > 0.25 && d <= 0.30)  s += deltaMax * 0.70;
    else if (d > 0.30 && d <= 0.35)  s += deltaMax * 0.50;
    else if (d > 0.10 && d < 0.15)   s += deltaMax * 0.55;
    else if (d > 0.35 && d <= 0.40)  s += deltaMax * 0.25;
    else if (d > 0.40)               s += deltaMax * 0.10;
    else if (d > 0.06 && d < 0.10)   s += deltaMax * 0.35;
    else if (d >= 0.02 && d <= 0.06) s += deltaMax * 0.20;
    else if (d > 0 && d < 0.02)      s += deltaMax * 0.05;
  } else {
    if (d >= 0.20 && d <= 0.29)                              s += deltaMax;
    else if ((d >= 0.15 && d < 0.20) || (d > 0.29 && d <= 0.35)) s += deltaMax * 0.80;
    else if ((d >= 0.10 && d < 0.15) || (d > 0.35 && d <= 0.40)) s += deltaMax * 0.50;
    else if (d > 0 && d < 0.10)  s += deltaMax * 0.15;
    else if (d > 0.40)           s += deltaMax * 0.15;
  }

  // DTE (50% of D2) — 7–14 days = weekly sweet spot
  const dteMax = maxPts * 0.5;
  if (dte >= 7 && dte <= 10)       s += dteMax;
  else if (dte >= 11 && dte <= 14) s += dteMax * 0.90;
  else if (dte >= 15 && dte <= 21) s += dteMax * 0.70;
  else if (dte >= 22 && dte <= 30) s += dteMax * 0.50;
  else if (dte >= 31 && dte <= 45) s += dteMax * 0.30;
  else                             s += dteMax * 0.05;

  return Math.max(0, Math.min(maxPts, s));
}

// ─── D3: Premium Efficiency (0–20 pts) ───────────────────────────────────────

function scoreD3PremiumCSP(weeklyPct: number, isIndex: boolean, maxPts = 20): number {
  // Calibrated to real-world CSP weekly returns:
  // Index: 0.30%/wk is realistic top-end; Equity: 0.80%/wk is realistic top-end
  let s = 0;
  if (isIndex) {
    if (weeklyPct >= 0.50)      s = maxPts;           // exceptional for index
    else if (weeklyPct >= 0.35) s = maxPts * 0.85;
    else if (weeklyPct >= 0.25) s = maxPts * 0.70;
    else if (weeklyPct >= 0.18) s = maxPts * 0.55;
    else if (weeklyPct >= 0.12) s = maxPts * 0.35;
    else if (weeklyPct >= 0.07) s = maxPts * 0.15;
  } else {
    if (weeklyPct >= 1.0)       s = maxPts;           // top-tier equity premium
    else if (weeklyPct >= 0.70) s = maxPts * 0.85;
    else if (weeklyPct >= 0.50) s = maxPts * 0.70;
    else if (weeklyPct >= 0.35) s = maxPts * 0.55;
    else if (weeklyPct >= 0.20) s = maxPts * 0.35;
    else if (weeklyPct >= 0.10) s = maxPts * 0.15;
  }
  return Math.max(0, Math.min(maxPts, s));
}

// ─── D4: IV Richness (0–15 pts) ──────────────────────────────────────────────

function scoreD4IVRichness(ivRank: number | null | undefined, maxPts = 15): number {
  // Recalibrated: IV Rank 30+ is already a good selling environment;
  // most stocks spend time in the 20-50 range, so reward that meaningfully.
  if (ivRank === null || ivRank === undefined) return maxPts * 0.50; // neutral
  if (ivRank >= 70)      return maxPts;           // very elevated IV
  if (ivRank >= 50)      return maxPts * 0.85;    // elevated — good for selling
  if (ivRank >= 35)      return maxPts * 0.70;    // moderate-high
  if (ivRank >= 25)      return maxPts * 0.55;    // moderate
  if (ivRank >= 15)      return maxPts * 0.35;    // below average
  if (ivRank >= 8)       return maxPts * 0.18;    // low
  return maxPts * 0.05;                           // very low IV — avoid
}

// ─── D5: Strike Safety (0–15 pts) ────────────────────────────────────────────

function scoreD5StrikeSafety(
  otmPct: number,           // how far OTM the strike is (%)
  price: number,
  ivAnnual: number | null | undefined,
  dte: number,
  maxPts = 15
): { score: number; safetyRatio: number | null } {
  // If we have IV, compare OTM distance to 1-sigma expected move
  if (ivAnnual && ivAnnual > 0 && price > 0) {
    const em = price * (ivAnnual / 100) * Math.sqrt(dte / 365);
    const emPct = (em / price) * 100;
    const safetyRatio = emPct > 0 ? otmPct / emPct : null; // >1 = beyond expected move
    const ratio = safetyRatio ?? 0;
    let score: number;
    if (ratio >= 2.0)      score = maxPts;           // 2× beyond EM — very safe
    else if (ratio >= 1.5) score = maxPts * 0.85;
    else if (ratio >= 1.2) score = maxPts * 0.70;
    else if (ratio >= 1.0) score = maxPts * 0.55;    // at the EM boundary
    else if (ratio >= 0.75) score = maxPts * 0.35;
    else if (ratio >= 0.50) score = maxPts * 0.15;
    else                   score = maxPts * 0.05;    // inside EM — risky
    return { score, safetyRatio };
  }
  // Fallback: raw OTM %
  let score: number;
  if (otmPct >= 15)      score = maxPts;
  else if (otmPct >= 10) score = maxPts * 0.80;
  else if (otmPct >= 7)  score = maxPts * 0.60;
  else if (otmPct >= 5)  score = maxPts * 0.45;
  else if (otmPct >= 3)  score = maxPts * 0.25;
  else if (otmPct >= 1)  score = maxPts * 0.10;
  else                   score = 0;
  return { score, safetyRatio: null };
}

// ─── D6: Technical Context (0–15 pts) ────────────────────────────────────────

function scoreD6TechnicalCSP(
  rsi: number | null | undefined,
  bb: number | null | undefined,
  isIndex: boolean,
  maxPts = 15
): number {
  if (isIndex) return maxPts * 0.67; // neutral for index (10/15)
  let s = 0;
  const rsiMax = maxPts * 0.5;
  const bbMax  = maxPts * 0.5;

  // RSI — oversold preferred for CSP (bounce play)
  if (rsi !== null && rsi !== undefined) {
    if (rsi < 25)       s += rsiMax;
    else if (rsi < 30)  s += rsiMax * 0.90;
    else if (rsi < 35)  s += rsiMax * 0.75;
    else if (rsi < 40)  s += rsiMax * 0.60;
    else if (rsi < 50)  s += rsiMax * 0.40;
    else if (rsi < 60)  s += rsiMax * 0.20;
    // ≥60 = 0 (overbought — avoid CSP)
  } else {
    s += rsiMax * 0.50;
  }

  // BB %B — near lower band preferred
  if (bb !== null && bb !== undefined) {
    if (bb < 0)         s += bbMax;
    else if (bb < 0.15) s += bbMax * 0.90;
    else if (bb < 0.30) s += bbMax * 0.75;
    else if (bb < 0.50) s += bbMax * 0.50;
    else if (bb < 0.70) s += bbMax * 0.25;
    // ≥0.70 = 0
  } else {
    s += bbMax * 0.50;
  }

  return Math.max(0, Math.min(maxPts, s));
}

// ─── D6 variant for BPS (bullish context preferred) ──────────────────────────

function scoreD6TechnicalBPS(
  rsi: number | null | undefined,
  bb: number | null | undefined,
  trend14d: number,
  isIndex: boolean,
  maxPts = 20
): number {
  if (isIndex) return maxPts * 0.65; // neutral for index
  let s = 0;
  const rsiMax   = maxPts * 0.35;
  const bbMax    = maxPts * 0.25;
  const trendMax = maxPts * 0.40;

  // RSI — neutral/bullish preferred for BPS
  if (rsi !== null && rsi !== undefined) {
    if (rsi >= 40 && rsi <= 60)      s += rsiMax;
    else if (rsi >= 35 && rsi < 40)  s += rsiMax * 0.75;
    else if (rsi > 60 && rsi <= 70)  s += rsiMax * 0.75;
    else if (rsi >= 30 && rsi < 35)  s += rsiMax * 0.50;
    else if (rsi > 70 && rsi <= 80)  s += rsiMax * 0.50;
    else if (rsi < 30)               s += rsiMax * 0.15;
    else                             s += rsiMax * 0.15;
  } else {
    s += rsiMax * 0.50;
  }

  // BB %B — middle of range preferred for BPS
  if (bb !== null && bb !== undefined) {
    if (bb >= 0.30 && bb <= 0.70)                              s += bbMax;
    else if ((bb >= 0.20 && bb < 0.30) || (bb > 0.70 && bb <= 0.80)) s += bbMax * 0.65;
    else if ((bb >= 0.10 && bb < 0.20) || (bb > 0.80 && bb <= 0.90)) s += bbMax * 0.35;
    else                                                       s += bbMax * 0.10;
  } else {
    s += bbMax * 0.50;
  }

  // 14-day trend — bullish trend = max score for BPS
  if (trend14d >= 5)       s += trendMax;
  else if (trend14d >= 3)  s += trendMax * 0.85;
  else if (trend14d >= 1)  s += trendMax * 0.65;
  else if (trend14d >= 0)  s += trendMax * 0.45;
  else if (trend14d >= -2) s += trendMax * 0.20;
  // < -2% = 0 (bearish — avoid BPS)

  return Math.max(0, Math.min(maxPts, s));
}

// ─── Unified D1–D6 breakdown interface ───────────────────────────────────────

export interface D6Breakdown {
  d1Liquidity: number;
  d2ProbabilityFit: number;
  d3PremiumEfficiency: number;
  d4IVRichness: number;
  d5StrikeSafety: number;
  d6Technical: number;
  total: number;
  safetyRatio?: number | null; // D5: strike distance / expected move (>1 = beyond EM)
  // Legacy fields for backward compat
  technical?: number;
  greeks?: number;
  premium?: number;
  quality?: number;
  liquidity?: number;
  perfectSetupBonus?: number;
}

export interface ScoreBreakdown extends D6Breakdown {
  technical: number;
  greeks: number;
  premium: number;
  quality: number;
  liquidity?: number;
  perfectSetupBonus?: number;
  total: number;
}

export interface ScoredOpportunity extends CSPOpportunity {
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

// ─── CSP Scoring v2 ──────────────────────────────────────────────────────────

/**
 * Calculate CSP Composite Score v2 (0–100)
 *
 * Weights: D1 15% | D2 20% | D3 20% | D4 15% | D5 15% | D6 15%
 */
export function calculateCSPScore(opp: CSPOpportunity): { score: number; breakdown: ScoreBreakdown } {
  const isIndex = INDEX_SYMBOLS.has((opp.symbol || '').toUpperCase());
  const delta   = Math.abs(opp.delta || 0);
  const dte     = opp.dte || 0;
  const weekly  = opp.weeklyPct || 0;
  const bid     = opp.bid || 0;
  const ask     = opp.ask || 0;
  const oi      = opp.openInterest ?? 0;
  const volume  = opp.volume ?? 0;
  // OTM % derived from strike vs current price (for CSP, strike < currentPrice)
  const otmPct  = opp.currentPrice > 0 ? Math.abs((opp.currentPrice - opp.strike) / opp.currentPrice) * 100 : 0;
  // Use opp.iv (annualised IV %) for D5 Strike Safety; falls back to raw OTM% if null
  const ivAnnual = opp.iv ?? null; // mid_iv from greeks, stored as % (e.g. 35.2 for 35.2% IV)

  const d1 = scoreD1Liquidity(bid, ask, oi, volume, 15);
  const d2 = scoreD2ProbabilityCSP(delta, dte, isIndex, 20);
  const d3 = scoreD3PremiumCSP(weekly, isIndex, 20);
  const d4 = scoreD4IVRichness(opp.ivRank, 15);
  const { score: d5, safetyRatio } = scoreD5StrikeSafety(otmPct, opp.currentPrice || 0, ivAnnual, dte, 15);
  const d6 = scoreD6TechnicalCSP(opp.rsi, opp.bbPctB, isIndex, 15);

  const total = Math.round(Math.min(100, d1 + d2 + d3 + d4 + d5 + d6));

  return {
    score: total,
    breakdown: {
      // D1–D6 (v2)
      d1Liquidity:          Math.round(d1),
      d2ProbabilityFit:     Math.round(d2),
      d3PremiumEfficiency:  Math.round(d3),
      d4IVRichness:         Math.round(d4),
      d5StrikeSafety:       Math.round(d5),
      d6Technical:          Math.round(d6),
      safetyRatio,
      // Legacy fields (kept for backward compat with existing UI)
      technical:  Math.round(d6),
      greeks:     Math.round(d2),
      premium:    Math.round(d3),
      quality:    Math.round(d4),
      liquidity:  Math.round(d1),
      perfectSetupBonus: 0,
      total,
    },
  };
}

/**
 * Score all CSP opportunities and sort by score descending
 */
export function scoreOpportunities(opportunities: CSPOpportunity[]): ScoredOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateCSPScore(opp);
    return { ...opp, score, scoreBreakdown: breakdown, safetyRatio: breakdown.safetyRatio ?? null };
  });
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
    deltaMin: 0.05, deltaMax: 0.40, dteMin: 7, dteMax: 60,
    oiMin: 10, volumeMin: 10, rsiMin: 0, rsiMax: 100,
    ivRankMin: 0, bbMin: 0, bbMax: 1.0, minScore: 50, maxStrikePct: 110,
  },
  medium: {
    deltaMin: 0.05, deltaMax: 0.40, dteMin: 7, dteMax: 60,
    oiMin: 10, volumeMin: 10, rsiMin: 0, rsiMax: 100,
    ivRankMin: 0, bbMin: 0, bbMax: 1.0, minScore: 40, maxStrikePct: 110,
  },
  aggressive: {
    deltaMin: 0.05, deltaMax: 0.40, dteMin: 7, dteMax: 60,
    oiMin: 10, volumeMin: 10, rsiMin: 0, rsiMax: 100,
    ivRankMin: 0, bbMin: 0, bbMax: 1.0, minScore: 30, maxStrikePct: 110,
  },
};

export function applyPresetFilter(
  opportunities: ScoredOpportunity[],
  preset: PresetFilter
): ScoredOpportunity[] {
  return opportunities.filter((opp) => {
    const delta = Math.abs(opp.delta);
    if (delta < preset.deltaMin || delta > preset.deltaMax) return false;
    if (opp.dte < preset.dteMin || opp.dte > preset.dteMax) return false;
    if (opp.openInterest < preset.oiMin) return false;
    if (preset.volumeMin && opp.volume && opp.volume < preset.volumeMin) return false;
    if (preset.rsiMin !== undefined && opp.rsi !== null && opp.rsi !== undefined && opp.rsi < preset.rsiMin) return false;
    if (preset.rsiMax !== undefined && preset.rsiMax < 100 && opp.rsi !== null && opp.rsi !== undefined && opp.rsi > preset.rsiMax) return false;
    if (preset.ivRankMin !== undefined && preset.ivRankMin > 0 && opp.ivRank !== null && opp.ivRank !== undefined && opp.ivRank < preset.ivRankMin) return false;
    if (preset.bbMin !== undefined && opp.bbPctB !== null && opp.bbPctB !== undefined && opp.bbPctB < preset.bbMin) return false;
    if (preset.bbMax !== undefined && preset.bbMax < 1.0 && opp.bbPctB !== null && opp.bbPctB !== undefined && opp.bbPctB > preset.bbMax) return false;
    if (preset.minScore !== undefined && opp.score < preset.minScore) return false;
    return true;
  });
}

export function selectBestPerTicker(
  opportunities: ScoredOpportunity[],
  preset?: PresetFilter
): ScoredOpportunity[] {
  const filtered = preset ? applyPresetFilter(opportunities, preset) : opportunities;
  const bySymbol = new Map<string, ScoredOpportunity[]>();
  filtered.forEach((opp) => {
    if (!bySymbol.has(opp.symbol)) bySymbol.set(opp.symbol, []);
    bySymbol.get(opp.symbol)!.push(opp);
  });
  const best: ScoredOpportunity[] = [];
  bySymbol.forEach((opps) => best.push(opps.sort((a, b) => b.score - a.score)[0]));
  return best;
}

// ─── BPS Scoring v2 ──────────────────────────────────────────────────────────

export interface BPSScoreBreakdown extends D6Breakdown {
  // BPS-specific legacy fields
  direction: number;
  spreadEfficiency: number;
  greeks: number;
  technical: number;
  premium: number;
  liquidity?: number;
  perfectSetupBonus?: number;
  total: number;
  trend14d?: number;
  trendBias?: 'Bearish' | 'Neutral' | 'Bullish';
}

export interface ScoredBPSOpportunity extends CSPOpportunity {
  score: number;
  scoreBreakdown: BPSScoreBreakdown;
  longStrike?: number;
  longBid?: number;
  longAsk?: number;
  longDelta?: number;
  spreadWidth?: number;
  netCredit?: number;
  capitalAtRisk?: number;
  trend14d?: number;
  trendBias?: 'Bearish' | 'Neutral' | 'Bullish';
}

/**
 * Calculate BPS Composite Score v2 (0–100)
 *
 * Weights: D1 15% | D2 20% | D3 25% | D4 10% | D5 10% | D6 20%
 */
export function calculateBPSScore(
  opp: ScoredBPSOpportunity,
  options: { isIndexMode?: boolean } = {}
): { score: number; breakdown: BPSScoreBreakdown } {
  const isIndexMode = options.isIndexMode ?? false;
  const shortDelta  = Math.abs(opp.delta || 0);
  const dte         = opp.dte || 0;
  const bid         = opp.bid || 0;
  const ask         = opp.ask || 0;
  const oi          = opp.openInterest ?? 0;
  const volume      = opp.volume ?? 0;
  const netCredit   = opp.netCredit ?? 0;
  const capitalRisk = opp.capitalAtRisk ?? (opp.spreadWidth ? opp.spreadWidth * 100 : 0);
  const rocPct      = capitalRisk > 0 ? (netCredit / capitalRisk) * 100 : 0;
  const trend14d    = opp.trend14d ?? 0;
  const ivAnnual    = opp.iv ?? null; // mid_iv from greeks, stored as % (e.g. 35.2 for 35.2% IV)
  const otmPct      = opp.currentPrice > 0 ? Math.abs((opp.currentPrice - opp.strike) / opp.currentPrice) * 100 : 0;

  // D1 Liquidity (15 pts)
  const d1 = scoreD1Liquidity(bid, ask, oi, volume, 15);

  // D2 Probability Fit (20 pts) — short delta + DTE
  let d2 = 0;
  const d2DeltaMax = 20 * 0.5;
  const d2DteMax   = 20 * 0.5;
  // Short delta sweet spot: 0.25–0.35 for BPS
  if (shortDelta >= 0.25 && shortDelta <= 0.35)       d2 += d2DeltaMax;
  else if (shortDelta >= 0.20 && shortDelta < 0.25)   d2 += d2DeltaMax * 0.80;
  else if (shortDelta > 0.35 && shortDelta <= 0.40)   d2 += d2DeltaMax * 0.70;
  else if (shortDelta >= 0.15 && shortDelta < 0.20)   d2 += d2DeltaMax * 0.55;
  else if (shortDelta > 0.40 && shortDelta <= 0.45)   d2 += d2DeltaMax * 0.40;
  else if (shortDelta > 0.45)                         d2 += d2DeltaMax * 0.15;
  else                                                d2 += d2DeltaMax * 0.25;
  // DTE
  if (dte >= 7 && dte <= 14)       d2 += d2DteMax;
  else if (dte >= 15 && dte <= 21) d2 += d2DteMax * 0.75;
  else if (dte >= 22 && dte <= 30) d2 += d2DteMax * 0.50;
  else if (dte >= 31 && dte <= 45) d2 += d2DteMax * 0.30;
  else                             d2 += d2DteMax * 0.05;

  // D3 Premium Efficiency (25 pts) — ROC on capital at risk
  let d3 = 0;
  if (rocPct >= 20)      d3 = 25;
  else if (rocPct >= 15) d3 = 25 * 0.85;
  else if (rocPct >= 10) d3 = 25 * 0.65;
  else if (rocPct >= 7)  d3 = 25 * 0.45;
  else if (rocPct >= 4)  d3 = 25 * 0.25;
  else if (rocPct >= 2)  d3 = 25 * 0.10;

  // D4 IV Richness (10 pts)
  const d4 = scoreD4IVRichness(opp.ivRank, 10);

  // D5 Strike Safety (10 pts)
  const { score: d5, safetyRatio } = scoreD5StrikeSafety(otmPct, opp.currentPrice || 0, ivAnnual, dte, 10);

  // D6 Technical Context (20 pts) — bullish context preferred for BPS
  const d6 = scoreD6TechnicalBPS(opp.rsi, opp.bbPctB, trend14d, isIndexMode, 20);

  const total = Math.round(Math.min(100, d1 + d2 + d3 + d4 + d5 + d6));

  const trendBias: 'Bearish' | 'Neutral' | 'Bullish' =
    trend14d >= 2 ? 'Bullish' : trend14d <= -2 ? 'Bearish' : 'Neutral';

  return {
    score: total,
    breakdown: {
      // D1–D6 (v2)
      d1Liquidity:         Math.round(d1),
      d2ProbabilityFit:    Math.round(d2),
      d3PremiumEfficiency: Math.round(d3),
      d4IVRichness:        Math.round(d4),
      d5StrikeSafety:      Math.round(d5),
      d6Technical:         Math.round(d6),
      safetyRatio,
      // Legacy fields
      direction:         Math.round(d6 + d2 * 0.3),
      spreadEfficiency:  Math.round(d3),
      greeks:            Math.round(d2),
      technical:         Math.round(d6),
      premium:           Math.round(d3),
      liquidity:         Math.round(d1),
      perfectSetupBonus: 0,
      total,
      trend14d,
      trendBias,
    },
  };
}

export function scoreBPSOpportunities(
  opportunities: ScoredBPSOpportunity[],
  options: { isIndexMode?: boolean } = {}
): ScoredBPSOpportunity[] {
  const scored = opportunities.map((opp) => {
    const { score, breakdown } = calculateBPSScore(opp, options);
    return { ...opp, score, scoreBreakdown: breakdown, trendBias: breakdown.trendBias, safetyRatio: breakdown.safetyRatio ?? null };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
