/**
 * Roll Urgency Score
 *
 * Composite 0–100 score that indicates how urgently a short option position
 * should be rolled. Higher = more urgent.
 *
 * Factor breakdown (max 100 pts):
 *  F1 — ITM Depth       (30 pts)  — how far in-the-money the option is
 *  F2 — Delta Breach    (20 pts)  — delta magnitude approaching assignment risk
 *  F3 — DTE Decay Zone  (20 pts)  — gamma acceleration near expiration
 *  F4 — Profit Captured (15 pts)  — high profit % = redeploy opportunity
 *  F5 — Theta Decay     (10 pts)  — theta shrinking as % of remaining premium
 *  F6 — Gamma Spike     ( 5 pts)  — bonus: DTE ≤ 7 AND delta > 0.40
 */

export interface RollUrgencyInput {
  optionType: 'C' | 'P';
  strike: number;          // option strike price
  underlyingPrice: number; // current price of the underlying
  dte: number;             // days to expiration
  profitPct: number;       // profit captured so far (0–100+)
  delta?: number | null;   // raw delta from Tradier (negative for puts)
  gamma?: number | null;   // raw gamma from Tradier
  theta?: number | null;   // raw theta from Tradier
  averageOpenPrice: number; // premium collected per share
  currentMark: number;     // current BTC cost per share
}

export interface RollUrgencyBreakdown {
  score: number;           // 0–100 composite
  band: 'green' | 'yellow' | 'orange' | 'red';
  label: string;
  factors: {
    itmDepth:       { pts: number; max: 10; detail: string };
    deltaBreach:    { pts: number; max: 20; detail: string };
    dteDecayZone:   { pts: number; max: 20; detail: string };
    profitCaptured: { pts: number; max: 15; detail: string };
    thetaDecay:     { pts: number; max: 10; detail: string };
    gammaSpike:     { pts: number; max: 5;  detail: string };
    itmBonus:       { pts: number; max: 20; detail: string };
  };
}

/**
 * Calculate the Roll Urgency Score for a single short option position.
 */
export function calculateRollUrgencyScore(input: RollUrgencyInput): RollUrgencyBreakdown {
  const { optionType, strike, underlyingPrice, dte, profitPct, delta, gamma, theta, averageOpenPrice, currentMark } = input;

  // ── F1: ITM Depth (0–10 pts base, up to 20 bonus for deep ITM) ────────────
  // For a short call: ITM when underlying > strike
  // For a short put:  ITM when underlying < strike
  let itmDepthPct = 0;
  if (optionType === 'C') {
    itmDepthPct = underlyingPrice > 0 ? ((underlyingPrice - strike) / underlyingPrice) * 100 : 0;
  } else {
    itmDepthPct = underlyingPrice > 0 ? ((strike - underlyingPrice) / underlyingPrice) * 100 : 0;
  }

  let itmDepthPts = 0;
  let itmBonusPts = 0;
  if (itmDepthPct > 0) {
    // Base ITM score: 0–10 pts scaled 0% → 5% ITM
    itmDepthPts = Math.min(10, (itmDepthPct / 5) * 10);
    // Bonus for deep ITM: additional 0–20 pts for 5%–15%+ ITM
    if (itmDepthPct > 5) {
      itmBonusPts = Math.min(20, ((itmDepthPct - 5) / 10) * 20);
    }
  }
  const itmDepthDetail = itmDepthPct > 0
    ? `${itmDepthPct.toFixed(1)}% ITM`
    : `${Math.abs(itmDepthPct).toFixed(1)}% OTM`;

  // ── F2: Delta Breach (0–20 pts) ───────────────────────────────────────────
  // Use absolute delta value; short calls have positive delta, short puts have negative
  const absDelta = delta != null ? Math.abs(delta) : null;
  let deltaPts = 0;
  let deltaDetail = 'No delta data';
  if (absDelta != null) {
    if (absDelta >= 0.70)      { deltaPts = 20; deltaDetail = `Δ ${absDelta.toFixed(2)} — Deep ITM risk`; }
    else if (absDelta >= 0.60) { deltaPts = 16; deltaDetail = `Δ ${absDelta.toFixed(2)} — High assignment risk`; }
    else if (absDelta >= 0.50) { deltaPts = 12; deltaDetail = `Δ ${absDelta.toFixed(2)} — ATM / assignment zone`; }
    else if (absDelta >= 0.40) { deltaPts = 8;  deltaDetail = `Δ ${absDelta.toFixed(2)} — Approaching danger zone`; }
    else if (absDelta >= 0.30) { deltaPts = 4;  deltaDetail = `Δ ${absDelta.toFixed(2)} — Watch closely`; }
    else                       { deltaPts = 0;  deltaDetail = `Δ ${absDelta.toFixed(2)} — Safe zone`; }
  }

  // ── F3: DTE Decay Zone (0–20 pts) ─────────────────────────────────────────
  let dtePts = 0;
  let dteDetail = '';
  if (dte <= 3)       { dtePts = 20; dteDetail = `${dte} DTE — Gamma danger zone`; }
  else if (dte <= 7)  { dtePts = 18; dteDetail = `${dte} DTE — High gamma risk`; }
  else if (dte <= 14) { dtePts = 12; dteDetail = `${dte} DTE — Gamma acceleration`; }
  else if (dte <= 21) { dtePts = 6;  dteDetail = `${dte} DTE — Watch zone`; }
  else                { dtePts = 0;  dteDetail = `${dte} DTE — Safe`; }

  // ── F4: Profit Captured (0–15 pts) ────────────────────────────────────────
  // High profit % = time to redeploy capital
  let profitPts = 0;
  let profitDetail = '';
  if (profitPct >= 85)      { profitPts = 15; profitDetail = `${profitPct.toFixed(0)}% captured — Roll now, redeploy`; }
  else if (profitPct >= 75) { profitPts = 12; profitDetail = `${profitPct.toFixed(0)}% captured — Strong roll candidate`; }
  else if (profitPct >= 60) { profitPts = 8;  profitDetail = `${profitPct.toFixed(0)}% captured — Consider rolling`; }
  else if (profitPct >= 50) { profitPts = 5;  profitDetail = `${profitPct.toFixed(0)}% captured — Monitor`; }
  else                      { profitPts = 0;  profitDetail = `${profitPct.toFixed(0)}% captured — Let it run`; }

  // ── F5: Theta Decay (0–10 pts) ────────────────────────────────────────────
  // If theta is small relative to remaining premium, decay is slowing → roll for more premium
  let thetaPts = 0;
  let thetaDetail = 'No theta data';
  if (theta != null && averageOpenPrice > 0 && currentMark > 0) {
    const absTheta = Math.abs(theta);
    // Daily theta as % of remaining premium (current mark)
    const thetaEfficiency = currentMark > 0.01 ? absTheta / currentMark : 0;
    if (thetaEfficiency < 0.01 && dte <= 21) {
      thetaPts = 10;
      thetaDetail = `θ ${absTheta.toFixed(3)} — Theta decelerating, roll for more`;
    } else if (thetaEfficiency < 0.02 && dte <= 14) {
      thetaPts = 7;
      thetaDetail = `θ ${absTheta.toFixed(3)} — Theta slowing`;
    } else if (thetaEfficiency < 0.03 && dte <= 7) {
      thetaPts = 4;
      thetaDetail = `θ ${absTheta.toFixed(3)} — Moderate theta`;
    } else {
      thetaPts = 0;
      thetaDetail = `θ ${absTheta.toFixed(3)} — Theta healthy`;
    }
  }

  // ── F6: Gamma Spike Bonus (0–5 pts) ───────────────────────────────────────
  let gammaPts = 0;
  let gammaDetail = 'No gamma data';
  if (gamma != null) {
    const absGamma = Math.abs(gamma);
    gammaDetail = `γ ${absGamma.toFixed(4)}`;
    if (dte <= 7 && absDelta != null && absDelta >= 0.40) {
      gammaPts = 5;
      gammaDetail = `γ ${absGamma.toFixed(4)} — Gamma spike risk (DTE ≤ 7, Δ ≥ 0.40)`;
    } else if (dte <= 14 && absGamma > 0.05) {
      gammaPts = 3;
      gammaDetail = `γ ${absGamma.toFixed(4)} — Elevated gamma`;
    } else if (absGamma > 0.02) {
      gammaPts = 1;
      gammaDetail = `γ ${absGamma.toFixed(4)} — Normal gamma`;
    } else {
      gammaPts = 0;
      gammaDetail = `γ ${absGamma.toFixed(4)} — Low gamma`;
    }
  }

  // ── Composite Score ────────────────────────────────────────────────────────
  const rawScore = itmDepthPts + itmBonusPts + deltaPts + dtePts + profitPts + thetaPts + gammaPts;
  // Cap at 100
  const score = Math.min(100, Math.round(rawScore));

  // ── Band ──────────────────────────────────────────────────────────────────
  let band: 'green' | 'yellow' | 'orange' | 'red';
  let label: string;
  if (score >= 76)      { band = 'red';    label = 'Roll Now'; }
  else if (score >= 51) { band = 'orange'; label = 'Consider Roll'; }
  else if (score >= 26) { band = 'yellow'; label = 'Watch'; }
  else                  { band = 'green';  label = 'Monitor'; }

  return {
    score,
    band,
    label,
    factors: {
      itmDepth:       { pts: Math.round(itmDepthPts),  max: 10, detail: itmDepthDetail },
      itmBonus:       { pts: Math.round(itmBonusPts),  max: 20, detail: itmDepthPct > 5 ? `Deep ITM bonus: +${Math.round(itmBonusPts)} pts` : 'No deep ITM bonus' },
      deltaBreach:    { pts: Math.round(deltaPts),     max: 20, detail: deltaDetail },
      dteDecayZone:   { pts: Math.round(dtePts),       max: 20, detail: dteDetail },
      profitCaptured: { pts: Math.round(profitPts),    max: 15, detail: profitDetail },
      thetaDecay:     { pts: Math.round(thetaPts),     max: 10, detail: thetaDetail },
      gammaSpike:     { pts: Math.round(gammaPts),     max: 5,  detail: gammaDetail },
    },
  };
}

/**
 * Band color utilities for frontend use.
 */
export const ROLL_URGENCY_COLORS = {
  green:  { bg: 'bg-green-900/40',  border: 'border-green-500/50',  text: 'text-green-400',  dot: '#22c55e' },
  yellow: { bg: 'bg-yellow-900/40', border: 'border-yellow-500/50', text: 'text-yellow-400', dot: '#eab308' },
  orange: { bg: 'bg-orange-900/40', border: 'border-orange-500/50', text: 'text-orange-400', dot: '#f97316' },
  red:    { bg: 'bg-red-900/40',    border: 'border-red-500/50',    text: 'text-red-400',    dot: '#ef4444' },
} as const;
