/**
 * AIAdvisorPanel — shared component for all strategy dashboards.
 * Accepts a list of opportunities, calls the spread.aiAdvisor tRPC mutation,
 * and renders 3 ranked recommendations with quantities and rationale.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, ChevronDown, ChevronUp, AlertCircle, Trophy, TrendingUp, DollarSign } from "lucide-react";
import { toast } from "sonner";

export interface AIAdvisorOpportunity {
  symbol: string;
  strike: number;
  longStrike?: number;
  spreadWidth?: number;
  expiration: string;
  dte: number;
  netCredit?: number;
  premium?: number;
  capitalRisk?: number;
  collateral?: number;
  roc?: number;
  weeklyPct?: number;
  breakeven?: number;
  delta?: number;
  openInterest?: number;
  volume?: number;
  score?: number;
  currentPrice?: number;
}

interface AIRecommendation {
  rank: number;
  opportunityIndex: number;
  symbol: string;
  strikes: string;
  expiration: string;
  dte: number;
  suggestedQuantity: number;
  netCreditPerContract: number;
  totalCredit: number;
  collateralPerContract: number;
  totalCollateral: number;
  roc: number;
  rationale: string;
}

interface Props {
  opportunities: AIAdvisorOpportunity[];
  availableBuyingPower?: number;
  strategy: "BPS" | "BCS" | "IC" | "CSP";
  /** Called when user clicks "Select" on a recommendation — passes the opportunityIndex */
  onSelectRecommendation?: (opportunityIndex: number) => void;
}

const rankColors = [
  "from-yellow-500/20 to-amber-500/10 border-yellow-500/40",
  "from-slate-400/20 to-slate-500/10 border-slate-400/40",
  "from-amber-700/20 to-amber-800/10 border-amber-700/40",
];
const rankLabels = ["🥇 Top Pick", "🥈 Runner Up", "🥉 Third Pick"];
const rankBadgeColors = ["bg-yellow-500/20 text-yellow-400 border-yellow-500/40", "bg-slate-400/20 text-slate-300 border-slate-400/40", "bg-amber-700/20 text-amber-600 border-amber-700/40"];

export function AIAdvisorPanel({ opportunities, availableBuyingPower, strategy, onSelectRecommendation }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<{ recommendations: AIRecommendation[]; summary: string } | null>(null);

  const aiAdvisor = trpc.spread.aiAdvisor.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setIsOpen(true);
      toast.success("AI Advisor analysis complete");
    },
    onError: (err) => {
      toast.error(`AI Advisor failed: ${err.message}`);
    },
  });

  const handleAnalyze = () => {
    if (opportunities.length === 0) {
      toast.warning("No opportunities to analyze. Run a scan first.");
      return;
    }
    // Send top 30 by score (or first 30 if no score)
    const sorted = [...opportunities]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 30);
    aiAdvisor.mutate({
      opportunities: sorted,
      availableBuyingPower,
      strategy,
    });
  };

  const strategyLabel: Record<string, string> = {
    BPS: "Bull Put Spread",
    BCS: "Bear Call Spread",
    IC: "Iron Condor",
    CSP: "Cash-Secured Put",
  };

  return (
    <div className="space-y-3">
      {/* Trigger button */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleAnalyze}
          disabled={aiAdvisor.isPending || opportunities.length === 0}
          variant="outline"
          size="sm"
          className="border-purple-500/40 text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/60 hover:text-purple-300 transition-all"
        >
          {aiAdvisor.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing {Math.min(opportunities.length, 30)} opportunities…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              AI Pick ({opportunities.length} opps)
            </>
          )}
        </Button>
        {result && (
          <Button
            onClick={() => setIsOpen(!isOpen)}
            variant="ghost"
            size="sm"
            className="text-purple-400 hover:text-purple-300"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {isOpen ? "Hide" : "Show"} Recommendations
          </Button>
        )}
      </div>

      {/* Results panel */}
      {result && isOpen && (
        <Card className="border-purple-500/30 bg-purple-500/5 backdrop-blur">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <CardTitle className="text-base text-purple-300">
                AI Advisor — {strategyLabel[strategy]} Recommendations
              </CardTitle>
            </div>
            {result.summary && (
              <CardDescription className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {result.summary}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {result.recommendations.map((rec, i) => (
              <div
                key={rec.rank}
                className={`rounded-lg border bg-gradient-to-r p-4 ${rankColors[i] ?? "from-muted/20 to-muted/10 border-border/40"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Badge variant="outline" className={`text-xs font-semibold ${rankBadgeColors[i] ?? ""}`}>
                        {rankLabels[i] ?? `#${rec.rank}`}
                      </Badge>
                      <span className="font-bold text-foreground">{rec.symbol}</span>
                      <span className="text-sm text-muted-foreground">{rec.strikes}</span>
                      <Badge variant="outline" className="text-xs border-border/40 text-muted-foreground">
                        {rec.dte}d exp
                      </Badge>
                    </div>

                    {/* Metrics row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">Credit/contract</div>
                          <div className="text-sm font-semibold text-green-400">${rec.netCreditPerContract.toFixed(2)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">ROC</div>
                          <div className="text-sm font-semibold text-blue-400">{rec.roc.toFixed(2)}%</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">Suggested qty</div>
                          <div className="text-sm font-bold text-amber-400">{rec.suggestedQuantity} contracts</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">Total collateral</div>
                          <div className="text-sm font-semibold text-orange-400">${rec.totalCollateral.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    {/* Total credit */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-muted-foreground">Total credit at {rec.suggestedQuantity}x:</span>
                      <span className="text-sm font-bold text-green-400">${rec.totalCredit.toLocaleString()}</span>
                    </div>

                    {/* Rationale */}
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-purple-400" />
                      <span>{rec.rationale}</span>
                    </div>
                  </div>

                  {/* Select button */}
                  {onSelectRecommendation && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 text-xs"
                      onClick={() => {
                        onSelectRecommendation(rec.opportunityIndex);
                        toast.success(`Selected ${rec.symbol} ${rec.strikes} — ${rec.suggestedQuantity} contracts`);
                      }}
                    >
                      Select
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Disclaimer */}
            <p className="text-xs text-muted-foreground/60 italic pt-1">
              AI recommendations are for informational purposes only and do not constitute financial advice. Always verify before trading.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
