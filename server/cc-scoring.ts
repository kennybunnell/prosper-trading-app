/**
 * cc-scoring.ts
 * Shared Covered Call multi-factor scoring model (D1–D6 + basis bonus).
 * Used by both the CC Dashboard (routers-cc.ts) and the Daily Actions
 * Step 3 scan (routers-automation.ts) so both surfaces apply identical
 * evaluation criteria.
 *
 * Scoring weights:
 *   D1 Liquidity          15 pts  (bid/ask spread + OI + volume)
 *   D2 Probability Fit    25 pts  (delta sweet spot + DTE)
 *   D3 Premium Efficiency 20 pts  (weekly return %)
 *   D4 IV Richness        10 pts  (IV Rank)
 *   D5 Strike Safety      20 pts  (OTM distance vs 1-sigma expected move)
 *   D6 Technical Context  10 pts  (RSI + BB %B — overbought preferred)
 *   Basis Recovery Bonus   0–5 pts
 *   ─────────────────────────────
 *   Max                  100 pts
 */

export interface CCScoreInput {
  // Required
  bid: number;
  ask: number;
  delta: number;
  dte: number;
  weeklyReturn: number;
  currentPrice: number;
  strike: number;
  // Optional enrichment
  openInterest?: number | null;
  volume?: number | null;
  ivRank?: number | null;
  iv?: number | null;          // annualised mid_iv (0–100 scale)
  distanceOtm?: number | null; // (strike - currentPrice) / currentPrice * 100
  rsi?: number | null;
  bbPctB?: number | null;
  basisRecoveryPct?: number | null;
}

export interface CCScoreBreakdown {
  d1Liquidity: number;
  d2ProbabilityFit: number;
  d3PremiumEfficiency: number;
  d4IVRichness: number;
  d5StrikeSafety: number;
  d6Technical: number;
  basisBonus: number;
  safetyRatio: number | null;
  total: number;
  [key: string]: number | null;
}

export function calculateCCScore(opp: CCScoreInput): { score: number; breakdown: CCScoreBreakdown } {
  // D1: Liquidity (15 pts)
  let d1 = 0;
  const bid = opp.bid || 0;
  const ask = opp.ask || 0;
  const mid = (bid + ask) / 2;
  const sp  = mid > 0 ? ((ask - bid) / mid) * 100 : 100;
  const oi  = opp.openInterest ?? 0;
  const vol = opp.volume ?? 0;
  if (sp <= 1)       d1 += 6;   else if (sp <= 2)  d1 += 5.1;
  else if (sp <= 5)  d1 += 3.6; else if (sp <= 10) d1 += 1.8;
  else if (sp <= 20) d1 += 0.6;
  if (oi >= 1000)     d1 += 6;   else if (oi >= 500) d1 += 5.1;
  else if (oi >= 200) d1 += 3.9; else if (oi >= 100) d1 += 2.7;
  else if (oi >= 50)  d1 += 1.5; else if (oi >= 10)  d1 += 0.6;
  else if (oi === 0)  d1 -= 4.5;
  if (vol >= 500)      d1 += 3;    else if (vol >= 200) d1 += 2.25;
  else if (vol >= 50)  d1 += 1.2;  else if (vol >= 10)  d1 += 0.45;
  d1 = Math.max(0, Math.min(15, d1));

  // D2: Probability Fit (25 pts) — delta + DTE
  // Peak reward at delta 0.15–0.25 (expire-worthless sweet spot for CC)
  let d2 = 0;
  const delta = Math.abs(opp.delta || 0);
  const dte   = opp.dte || 0;
  if (delta >= 0.15 && delta <= 0.25)       d2 += 13;
  else if (delta > 0.25 && delta <= 0.30)   d2 += 11;
  else if (delta >= 0.10 && delta < 0.15)   d2 += 9;
  else if (delta > 0.30 && delta <= 0.35)   d2 += 8;
  else if (delta > 0.35 && delta <= 0.40)   d2 += 5;
  else if (delta >= 0.05 && delta < 0.10)   d2 += 4;
  else if (delta > 0.40 && delta <= 0.50)   d2 += 3;
  else                                       d2 += 1;
  if (dte >= 7 && dte <= 14)       d2 += 12; else if (dte >= 15 && dte <= 21) d2 += 9;
  else if (dte >= 22 && dte <= 30) d2 += 6;  else if (dte >= 31 && dte <= 45) d2 += 3;
  else                             d2 += 0.5;
  d2 = Math.max(0, Math.min(25, d2));

  // D3: Premium Efficiency (20 pts) — weekly return % on stock value
  let d3 = 0;
  const weekly = opp.weeklyReturn || 0;
  if (weekly >= 1.5)       d3 = 20;  else if (weekly >= 1.0)  d3 = 16;
  else if (weekly >= 0.75) d3 = 13;  else if (weekly >= 0.50) d3 = 8;
  else if (weekly >= 0.30) d3 = 4;
  d3 = Math.max(0, Math.min(20, d3));

  // D4: IV Richness (10 pts) — IV Rank
  let d4 = 0;
  const ivRank = opp.ivRank;
  if (ivRank !== null && ivRank !== undefined) {
    if (ivRank >= 70)      d4 = 10;
    else if (ivRank >= 50) d4 = 10 * 0.85;
    else if (ivRank >= 35) d4 = 10 * 0.70;
    else if (ivRank >= 25) d4 = 10 * 0.55;
    else if (ivRank >= 15) d4 = 10 * 0.35;
    else if (ivRank >= 8)  d4 = 10 * 0.18;
    else                   d4 = 10 * 0.05;
  } else { d4 = 10 * 0.50; } // neutral when unknown

  // D5: Strike Safety (20 pts) — OTM distance vs 1-sigma expected move
  let d5 = 0;
  let ccSafetyRatio: number | null = null;
  const distPct = opp.distanceOtm ?? (opp.currentPrice > 0 ? ((opp.strike - opp.currentPrice) / opp.currentPrice) * 100 : 0);
  const ivForD5 = opp.iv ?? null;
  if (ivForD5 && ivForD5 > 0 && opp.currentPrice > 0) {
    const em = opp.currentPrice * (ivForD5 / 100) * Math.sqrt(dte / 365);
    const emPct = (em / opp.currentPrice) * 100;
    ccSafetyRatio = emPct > 0 ? distPct / emPct : null;
    const ratio = ccSafetyRatio ?? 0;
    if (ratio >= 1.5)       d5 = 20;
    else if (ratio >= 1.0)  d5 = 20 * 0.85;
    else if (ratio >= 0.75) d5 = 20 * 0.75;
    else if (ratio >= 0.55) d5 = 20 * 0.62;
    else if (ratio >= 0.40) d5 = 20 * 0.48;
    else if (ratio >= 0.25) d5 = 20 * 0.30;
    else                    d5 = 20 * 0.12;
  } else {
    if (distPct >= 12)       d5 = 20;  else if (distPct >= 8)  d5 = 20 * 0.80;
    else if (distPct >= 5)   d5 = 20 * 0.65; else if (distPct >= 3) d5 = 20 * 0.45;
    else if (distPct >= 1.5) d5 = 20 * 0.25; else d5 = 20 * 0.10;
  }
  d5 = Math.max(0, Math.min(20, d5));

  // D6: Technical Context (10 pts) — RSI + BB %B (overbought preferred for CC)
  let d6 = 0;
  const rsi = opp.rsi;
  const bb  = opp.bbPctB;
  const rsiMax = 5;
  const bbMax  = 5;
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 70)       d6 += rsiMax;
    else if (rsi > 60)  d6 += rsiMax * 0.85;
    else if (rsi > 50)  d6 += rsiMax * 0.65;
    else if (rsi > 40)  d6 += rsiMax * 0.50;
    else if (rsi > 30)  d6 += rsiMax * 0.25;
    // ≤30 = 0 (oversold — avoid CC)
  } else { d6 += rsiMax * 0.55; }
  if (bb !== null && bb !== undefined) {
    if (bb > 0.85)      d6 += bbMax;
    else if (bb > 0.70) d6 += bbMax * 0.85;
    else if (bb > 0.50) d6 += bbMax * 0.65;
    else if (bb > 0.30) d6 += bbMax * 0.50;
    else if (bb > 0.15) d6 += bbMax * 0.25;
    // ≤0.15 = 0 (near lower band — avoid CC)
  } else { d6 += bbMax * 0.55; }
  d6 = Math.max(0, Math.min(10, d6));

  // Basis Recovery Bonus (0, +2, +4, or +5 pts)
  let basisBonus = 0;
  const basisRecoveryPct = opp.basisRecoveryPct ?? null;
  if (basisRecoveryPct !== null) {
    if (basisRecoveryPct >= 95)      basisBonus = 5;
    else if (basisRecoveryPct >= 90) basisBonus = 4;
    else if (basisRecoveryPct >= 80) basisBonus = 2;
  }

  const rawTotal = d1 + d2 + d3 + d4 + d5 + d6 + basisBonus;
  const total = Math.round(Math.min(100, rawTotal));
  return {
    score: total,
    breakdown: {
      d1Liquidity: Math.round(d1),
      d2ProbabilityFit: Math.round(d2),
      d3PremiumEfficiency: Math.round(d3),
      d4IVRichness: Math.round(d4),
      d5StrikeSafety: Math.round(d5),
      d6Technical: Math.round(d6),
      basisBonus: Math.round(basisBonus),
      safetyRatio: ccSafetyRatio,
      total,
    },
  };
}
