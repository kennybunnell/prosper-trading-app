/**
 * ScoreBreakdownTooltip
 *
 * A hover tooltip that wraps any score badge and shows the D1–D6 (or
 * strategy-specific) sub-score breakdown when the user hovers over it.
 *
 * Supports three breakdown schemas:
 *  - D1–D6 (CSP, BPS, CC)
 *  - BCS (technical / greeks / premium / quality)
 *  - IC  (roc / riskReward / pop / ivRank / dte / rsi / bb / deltaBalance)
 *  - PMCC (stockQuality / leapStructure / costLiquidity / riskManagement)
 */

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Breakdown type definitions ──────────────────────────────────────────────

export interface D1D6Breakdown {
  d1Liquidity: number;
  d2ProbabilityFit: number;
  d3PremiumEfficiency: number;
  d4IVRichness: number;
  d5StrikeSafety: number;
  d6Technical: number;
  basisBonus?: number | null;  // CC only: basis recovery bonus
  safetyRatio?: number | null;
  [key: string]: unknown;
}

export interface BCSBreakdown {
  direction?: number;  // 14-day trend alignment (35 points) — PRIMARY
  technical: number;
  greeks: number;
  premium: number;
  quality: number;
  trendBias?: string;
  [key: string]: unknown;
}

export interface ICBreakdown {
  roc?: number;
  riskReward?: number;
  pop?: number;
  ivRank?: number;
  dte?: number;
  rsi?: number;
  bb?: number;
  deltaBalance?: number;
  total?: number;
  [key: string]: unknown;
}

export interface PMCCBreakdown {
  stockQuality: number;
  leapStructure: number;
  costLiquidity: number;
  riskManagement: number;
  total?: number;
  [key: string]: unknown;
}

export type AnyBreakdown = D1D6Breakdown | BCSBreakdown | ICBreakdown | PMCCBreakdown;

// ─── Type guards ─────────────────────────────────────────────────────────────

function isD1D6(b: AnyBreakdown): b is D1D6Breakdown {
  return "d1Liquidity" in b;
}
function isBCS(b: AnyBreakdown): b is BCSBreakdown {
  return "technical" in b && "greeks" in b && !("d1Liquidity" in b);
}
function isPMCC(b: AnyBreakdown): b is PMCCBreakdown {
  return "stockQuality" in b;
}

// ─── Sub-score row ────────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  score: number;
  maxScore: number;
  description: string;
}

function BreakdownRow({ label, score, maxScore, description }: RowProps) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const barColor =
    pct >= 75 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-400" : "bg-red-500";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground whitespace-nowrap">{label}</span>
        <span className="text-xs font-semibold text-foreground tabular-nums">
          {score}/{maxScore}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground leading-tight">{description}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  score: number;
  breakdown: AnyBreakdown | null | undefined;
  children: React.ReactNode;
}

export function ScoreBreakdownTooltip({ score, breakdown, children }: Props) {
  if (!breakdown) {
    // No breakdown data — render children as-is with no tooltip
    return <>{children}</>;
  }

  let rows: RowProps[] = [];

  if (isD1D6(breakdown)) {
    // Detect CC breakdown by presence of basisBonus field (CC v3 uses different max scores)
    const isCCBreakdown = 'basisBonus' in breakdown;
    // Detect BPS breakdown by isBPS marker (BPS: D3=25, D5=10, D6=20 vs CSP: D3=20, D5=20, D6=15)
    const isBPSBreakdown = (breakdown as any).isBPS === true;
    rows = [
      {
        label: "D1 Liquidity",
        score: breakdown.d1Liquidity,
        maxScore: 15,
        description: "Open interest + volume — tighter spreads, better fills",
      },
      {
        label: "D2 Probability",
        score: breakdown.d2ProbabilityFit,
        maxScore: isCCBreakdown ? 25 : 20,
        description: "Delta + DTE — probability of expiring OTM",
      },
      {
        label: "D3 Premium",
        score: breakdown.d3PremiumEfficiency,
        maxScore: isBPSBreakdown ? 25 : 20,
        description: isBPSBreakdown
          ? "Spread ROC — return on capital at risk"
          : "Weekly return % — income relative to collateral",
      },
      {
        label: "D4 IV Richness",
        score: breakdown.d4IVRichness,
        maxScore: 10,  // D4 = 10 pts for all strategies (CSP, BPS, CC)
        description: "IV Rank — selling when implied vol is elevated",
      },
      {
        label: "D5 Strike Safety",
        score: breakdown.d5StrikeSafety,
        maxScore: isBPSBreakdown ? 10 : 20,  // BPS D5=10, CSP/CC D5=20
        description: "OTM distance vs expected move — cushion to expiry",
      },
      {
        label: "D6 Technical",
        score: breakdown.d6Technical,
        maxScore: isBPSBreakdown ? 20 : (isCCBreakdown ? 10 : 15),  // BPS D6=20, CC D6=10, CSP D6=15
        description: "RSI + BB %B — momentum and mean-reversion setup",
      },
    ];
    // Add basis recovery bonus row for CC if present and non-zero
    if (isCCBreakdown && breakdown.basisBonus != null && (breakdown.basisBonus as number) > 0) {
      rows.push({
        label: "Basis Bonus",
        score: breakdown.basisBonus as number,
        maxScore: 5,
        description: "Premium collected vs cost basis — being called away is acceptable",
      });
    }
  } else if (isBCS(breakdown)) {
    rows = [
      {
        label: "Direction",
        score: breakdown.direction ?? 0,
        maxScore: 35,
        description: "14-day trend alignment — bearish = max score for BCS",
      },
      {
        label: "Technical",
        score: breakdown.technical,
        maxScore: 20,
        description: "RSI + BB — bearish momentum setup",
      },
      {
        label: "Greeks",
        score: breakdown.greeks,
        maxScore: 25,
        description: "Delta + DTE + IV Rank + spread efficiency",
      },
      {
        label: "Premium",
        score: breakdown.premium,
        maxScore: 15,
        description: "Credit/width ratio — income relative to max risk",
      },
      {
        label: "Quality",
        score: breakdown.quality,
        maxScore: 5,
        description: "Liquidity + stock quality",
      },
    ];
  } else if (isPMCC(breakdown)) {
    rows = [
      {
        label: "Stock Quality",
        score: breakdown.stockQuality,
        maxScore: 35,
        description: "RSI + BB + trend — underlying stock setup",
      },
      {
        label: "LEAP Structure",
        score: breakdown.leapStructure,
        maxScore: 30,
        description: "Delta + DTE + strike — LEAP option quality",
      },
      {
        label: "Cost & Liquidity",
        score: breakdown.costLiquidity,
        maxScore: 25,
        description: "Premium + OI + volume + spread",
      },
      {
        label: "Risk Mgmt",
        score: breakdown.riskManagement,
        maxScore: 10,
        description: "IV Rank + theta — risk-adjusted entry",
      },
    ];
  } else {
    // IC breakdown
    const ic = breakdown as ICBreakdown;
    rows = [
      {
        label: "ROC",
        score: Math.round(ic.roc ?? 0),
        maxScore: 20,
        description: "Return on collateral — weekly income efficiency",
      },
      {
        label: "Risk/Reward",
        score: Math.round(ic.riskReward ?? 0),
        maxScore: 15,
        description: "Credit vs max loss ratio",
      },
      {
        label: "POP",
        score: Math.round(ic.pop ?? 0),
        maxScore: 15,
        description: "Probability of profit — both wings OTM",
      },
      {
        label: "IV Rank",
        score: Math.round(ic.ivRank ?? 0),
        maxScore: 15,
        description: "Selling when implied vol is elevated",
      },
      {
        label: "DTE",
        score: Math.round(ic.dte ?? 0),
        maxScore: 10,
        description: "Days to expiration — theta decay sweet spot",
      },
      {
        label: "RSI",
        score: Math.round(ic.rsi ?? 0),
        maxScore: 7.5,
        description: "Neutral RSI 40–60 ideal for iron condors",
      },
      {
        label: "BB %B",
        score: Math.round(ic.bb ?? 0),
        maxScore: 7.5,
        description: "Price near middle band — range-bound setup",
      },
      {
        label: "Delta Balance",
        score: Math.round(ic.deltaBalance ?? 0),
        maxScore: 10,
        description: "Put/call delta symmetry — balanced wings",
      },
    ];
  }

  const total = rows.reduce((sum, r) => sum + r.score, 0);
  const maxTotal = rows.reduce((sum, r) => sum + r.maxScore, 0);
  const scoreColor =
    score >= 70
      ? "text-emerald-400"
      : score >= 55
      ? "text-amber-400"
      : "text-red-400";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="right"
          align="center"
          className="w-64 p-3 bg-popover text-popover-foreground border border-border shadow-xl rounded-lg z-50"
          sideOffset={8}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Score Breakdown
            </span>
            <span className={`text-sm font-bold tabular-nums ${scoreColor}`}>
              {score}/{maxTotal}
            </span>
          </div>

          {/* Rows */}
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <BreakdownRow key={row.label} {...row} />
            ))}
          </div>

          {/* Footer hint */}
          <p className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground text-center">
            Hover columns for individual factor explanations
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
