/**
 * MobileOpportunityCard
 * A compact, touch-friendly card for displaying a scan opportunity on small screens.
 * Used by CSP, BPS, CC, IC, and PMCC scan result tables.
 */
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { RiskBadgeList } from "@/components/RiskBadge";

// ─── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 70
      ? "bg-green-500/20 text-green-500 border-green-500/50"
      : score >= 50
      ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/50"
      : "bg-red-500/20 text-red-500 border-red-500/50";
  return <Badge className={cn("font-bold text-sm", cls)}>{score.toFixed ? score.toFixed(1) : score}</Badge>;
}

// ─── Row helper ────────────────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-right">{children}</span>
    </div>
  );
}

// ─── CSP / BPS card ────────────────────────────────────────────────────────────
export interface CSPMobileCardProps {
  opp: {
    symbol: string;
    score: number;
    strike: number;
    dte: number;
    premium: number;
    expiration: string;
    roc?: number;
    rsi?: number | null;
    ivRank?: number | null;
    riskBadges?: any[];
    // BPS-specific
    longStrike?: number;
    netCredit?: number;
    spreadROC?: number;
  };
  isSelected: boolean;
  onToggle: () => void;
  strategyType: "csp" | "spread";
}

export function CSPMobileCard({ opp, isSelected, onToggle, strategyType }: CSPMobileCardProps) {
  const isBPS = strategyType === "spread";
  const premium = isBPS ? (opp.netCredit ?? opp.premium) : opp.premium;
  const roc = isBPS ? (opp.spreadROC ?? opp.roc) : opp.roc;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        isSelected ? "border-primary/60 bg-primary/10" : "border-border bg-card"
      )}
    >
      {/* Header row: checkbox + symbol + score */}
      <div className="flex items-center gap-2">
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
        <span className="font-bold text-base flex-1">{opp.symbol}</span>
        <ScoreBadge score={opp.score} />
      </div>

      {/* Key metrics */}
      <div className="divide-y divide-border/50">
        {isBPS ? (
          <Row label="Strikes">
            <span className="text-blue-400">${opp.strike.toFixed(2)}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-muted-foreground">${opp.longStrike?.toFixed(2) ?? "—"}</span>
          </Row>
        ) : (
          <Row label="Strike">${opp.strike.toFixed(2)}</Row>
        )}
        <Row label="DTE">{opp.dte}</Row>
        <Row label={isBPS ? "Net Credit" : "Premium"}>
          <span className="text-green-400 font-semibold">${premium.toFixed(2)}</span>
        </Row>
        {roc != null && (
          <Row label="ROC">
            <Badge className={cn("font-bold text-xs", roc >= 2 ? "bg-green-500/20 text-green-500 border-green-500/50" : roc >= 1 ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/50" : "bg-red-500/20 text-red-500 border-red-500/50")}>
              {roc.toFixed(2)}%
            </Badge>
          </Row>
        )}
        {opp.rsi != null && <Row label="RSI">{opp.rsi.toFixed(1)}</Row>}
        {opp.ivRank != null && <Row label="IV Rank">{opp.ivRank.toFixed(1)}</Row>}
        <Row label="Exp.">{opp.expiration}</Row>
      </div>

      {/* Risk badges */}
      {opp.riskBadges && opp.riskBadges.length > 0 && (
        <RiskBadgeList badges={opp.riskBadges} size="sm" maxDisplay={3} />
      )}
    </div>
  );
}

// ─── CC / BCS card ─────────────────────────────────────────────────────────────
export interface CCMobileCardProps {
  opp: {
    symbol: string;
    score: number;
    strike: number;
    dte: number;
    premium: number;
    expiration: string;
    returnPct?: number;
    weeklyReturn?: number;
    rsi?: number | null;
    ivRank?: number | null;
    riskBadges?: any[];
    // BCS-specific
    longStrike?: number;
    netCredit?: number;
    spreadROC?: number;
  };
  isSelected: boolean;
  onToggle: () => void;
  strategyType: "cc" | "spread";
}

export function CCMobileCard({ opp, isSelected, onToggle, strategyType }: CCMobileCardProps) {
  const isBCS = strategyType === "spread";
  const premium = isBCS ? (opp.netCredit ?? opp.premium) : opp.premium;
  const roc = isBCS ? (opp.spreadROC ?? opp.returnPct) : opp.returnPct;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        isSelected ? "border-primary/60 bg-primary/10" : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
        <span className="font-bold text-base flex-1">{opp.symbol}</span>
        <ScoreBadge score={opp.score} />
      </div>

      <div className="divide-y divide-border/50">
        {isBCS ? (
          <Row label="Strikes">
            <span className="text-orange-400">${opp.strike.toFixed(2)}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-muted-foreground">${opp.longStrike?.toFixed(2) ?? "—"}</span>
          </Row>
        ) : (
          <Row label="Strike">${opp.strike.toFixed(2)}</Row>
        )}
        <Row label="DTE">{opp.dte}</Row>
        <Row label={isBCS ? "Net Credit" : "Premium"}>
          <span className="text-green-400 font-semibold">${premium.toFixed(2)}</span>
        </Row>
        {roc != null && (
          <Row label={isBCS ? "ROC" : "Return %"}>
            <Badge className={cn("font-bold text-xs", roc >= 2 ? "bg-green-500/20 text-green-500 border-green-500/50" : roc >= 1 ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/50" : "bg-red-500/20 text-red-500 border-red-500/50")}>
              {roc.toFixed(2)}%
            </Badge>
          </Row>
        )}
        {opp.rsi != null && <Row label="RSI">{opp.rsi.toFixed(1)}</Row>}
        {opp.ivRank != null && <Row label="IV Rank">{opp.ivRank.toFixed(1)}</Row>}
        <Row label="Exp.">{opp.expiration}</Row>
      </div>

      {opp.riskBadges && opp.riskBadges.length > 0 && (
        <RiskBadgeList badges={opp.riskBadges} size="sm" maxDisplay={3} />
      )}
    </div>
  );
}

// ─── Iron Condor card ──────────────────────────────────────────────────────────
export interface ICMobileCardProps {
  opp: {
    symbol: string;
    score?: number;
    putShortStrike: number;
    putLongStrike: number;
    callShortStrike: number;
    callLongStrike: number;
    dte: number;
    totalNetCredit?: number;
    roc?: number;
    expiration: string;
    rsi?: number | null;
    ivRank?: number | null;
    riskBadges?: any[];
  };
  isSelected: boolean;
  onToggle: () => void;
}

export function ICMobileCard({ opp, isSelected, onToggle }: ICMobileCardProps) {
  const score = opp.score ?? 0;
  const netCredit = (opp.totalNetCredit ?? 0) * 100;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        isSelected ? "border-primary/60 bg-primary/10" : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
        <span className="font-bold text-base flex-1">{opp.symbol}</span>
        <ScoreBadge score={score} />
      </div>

      <div className="divide-y divide-border/50">
        <Row label="Put Spread">
          <span className="text-green-400">${opp.putShortStrike}</span>
          <span className="text-muted-foreground mx-1">/</span>
          <span className="text-muted-foreground">${opp.putLongStrike}</span>
        </Row>
        <Row label="Call Spread">
          <span className="text-red-400">${opp.callShortStrike}</span>
          <span className="text-muted-foreground mx-1">/</span>
          <span className="text-muted-foreground">${opp.callLongStrike}</span>
        </Row>
        <Row label="DTE">{opp.dte}</Row>
        <Row label="Net Credit">
          <span className="text-green-400 font-semibold">${netCredit.toFixed(2)}</span>
        </Row>
        {opp.roc != null && (
          <Row label="ROC">
            <Badge className={cn("font-bold text-xs", opp.roc >= 2 ? "bg-green-500/20 text-green-500 border-green-500/50" : opp.roc >= 1 ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/50" : "bg-red-500/20 text-red-500 border-red-500/50")}>
              {opp.roc.toFixed(2)}%
            </Badge>
          </Row>
        )}
        {opp.rsi != null && <Row label="RSI">{opp.rsi.toFixed(1)}</Row>}
        {opp.ivRank != null && <Row label="IV Rank">{opp.ivRank.toFixed(0)}</Row>}
        <Row label="Exp.">{opp.expiration}</Row>
      </div>

      {opp.riskBadges && opp.riskBadges.length > 0 && (
        <RiskBadgeList badges={opp.riskBadges} size="sm" maxDisplay={3} />
      )}
    </div>
  );
}

// ─── PMCC LEAP card ────────────────────────────────────────────────────────────
export interface PMCCMobileCardProps {
  leap: {
    symbol: string;
    score: number;
    strike: number;
    dte: number;
    premium: number;
    expiration: string;
    delta: number;
    bid: number;
    ask: number;
    bidAskSpread: number;
    openInterest: number;
    volume: number;
    earningsWarning?: boolean;
    daysToEarnings?: number | null;
    extrinsicPercent?: number;
    monthsToRecover?: number | null;
  };
  isSelected: boolean;
  onToggle: () => void;
}

export function PMCCMobileCard({ leap, isSelected, onToggle }: PMCCMobileCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        isSelected ? "border-amber-500/60 bg-amber-900/10" : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          className="border-2 border-muted-foreground data-[state=checked]:border-green-500 data-[state=checked]:bg-green-500"
        />
        <span className="font-bold text-base flex-1">{leap.symbol}</span>
        <span
          className={cn(
            "inline-flex items-center justify-center w-9 h-9 rounded-full font-bold text-sm",
            leap.score >= 80
              ? "bg-green-900/50 text-green-400"
              : leap.score >= 60
              ? "bg-amber-900/50 text-amber-400"
              : "bg-red-900/50 text-red-400"
          )}
        >
          {Math.round(leap.score)}
        </span>
      </div>

      <div className="divide-y divide-border/50">
        <Row label="Strike">${leap.strike.toFixed(2)}</Row>
        <Row label="DTE">{leap.dte}</Row>
        <Row label="Delta">{leap.delta.toFixed(2)}</Row>
        <Row label="Premium">
          <span className="text-green-400 font-semibold">${leap.premium.toFixed(2)}</span>
        </Row>
        <Row label="Bid / Ask">
          ${leap.bid.toFixed(2)} / ${leap.ask.toFixed(2)}
        </Row>
        <Row label="Spread %">{leap.bidAskSpread.toFixed(2)}%</Row>
        {leap.extrinsicPercent != null && (
          <Row label="Extrinsic %">
            <span className={leap.extrinsicPercent > 15 ? "text-amber-400" : "text-green-400"}>
              {leap.extrinsicPercent.toFixed(1)}%
            </span>
          </Row>
        )}
        {leap.monthsToRecover != null && (
          <Row label="Mos. Recover">
            <span className={leap.monthsToRecover <= 12 ? "text-green-400" : leap.monthsToRecover <= 18 ? "text-amber-400" : "text-red-400"}>
              {leap.monthsToRecover.toFixed(1)}
            </span>
          </Row>
        )}
        <Row label="Exp.">{leap.expiration}</Row>
      </div>

      {/* Earnings warning */}
      {leap.earningsWarning && leap.daysToEarnings != null && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded">
          ⚠ Earnings in {leap.daysToEarnings}d
        </div>
      )}
    </div>
  );
}
