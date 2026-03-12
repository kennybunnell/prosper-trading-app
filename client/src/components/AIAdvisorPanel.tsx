import React, { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkles, AlertTriangle, TrendingUp, X, Loader2, RefreshCw, ShoppingCart, Minus, Plus } from 'lucide-react';

export interface Opportunity {
  score: number;
  symbol: string;
  strategy: string;
  shortStrike?: number;
  longStrike?: number;
  strike?: number;
  expiration: string;
  dte: number;
  netCredit: number;
  capitalRisk: number;
  roc: number;
  weeklyPct?: number;
  breakeven?: number;
  delta?: number;
  openInterest?: number;
  volume?: number;
  ivRank?: number;
  bid?: number;
  ask?: number;
  currentPrice?: number;
  longBid?: number;
  longAsk?: number;
  capitalAtRisk?: number;
}

export interface AIPick {
  rank: number;
  opportunityIndex: number;
  quantity: number;
  rationale: string;
  riskNote: string;
  opportunity: Opportunity;
}

interface AIAdvisorPanelProps {
  opportunities: Opportunity[];
  availableBuyingPower: number;
  strategy: string;
  onSelectOpportunity?: (opp: Opportunity) => void;
  /** Called when user clicks "Submit Selected to Pre-Order" */
  onSubmitSelected?: (picks: AIPick[]) => void;
  onClose: () => void;
}

const RANK_STYLES = [
  {
    label: '🥇 Best Pick',
    border: 'border-yellow-500/60',
    bg: 'bg-yellow-500/10',
    badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  },
  {
    label: '🥈 2nd Pick',
    border: 'border-slate-400/60',
    bg: 'bg-slate-400/10',
    badge: 'bg-slate-400/20 text-slate-300 border-slate-400/40',
  },
  {
    label: '🥉 3rd Pick',
    border: 'border-amber-700/60',
    bg: 'bg-amber-700/10',
    badge: 'bg-amber-700/20 text-amber-400 border-amber-700/40',
  },
];

function formatStrike(opp: Opportunity) {
  if (opp.shortStrike && opp.longStrike) return `$${opp.shortStrike}/$${opp.longStrike}`;
  if (opp.strike) return `$${opp.strike}`;
  return '—';
}

export function AIAdvisorPanel({
  opportunities,
  availableBuyingPower,
  strategy,
  onSelectOpportunity,
  onSubmitSelected,
  onClose,
}: AIAdvisorPanelProps) {
  const [picks, setPicks] = useState<AIPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [selectedPicks, setSelectedPicks] = useState<Set<number>>(new Set());
  // Per-pick quantity overrides (key = pick index, value = quantity)
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  // Store the top50 array used for the last AI analysis so onSubmitSelected can look up original data
  const top50Ref = useRef<Opportunity[]>([]);

  const analyze = trpc.aiAdvisor.analyzeOpportunities.useMutation({
    onSuccess: (data) => {
      const newPicks = data.picks as AIPick[];
      setPicks(newPicks);
      // Auto-select all picks by default
      setSelectedPicks(new Set(newPicks.map((_, i) => i)));
      // Initialize quantities from AI recommendations
      const initQty: Record<number, number> = {};
      newPicks.forEach((p, i) => { initQty[i] = p.quantity || 1; });
      setQuantities(initQty);
      setError(null);
      setHasRun(true);
    },
    onError: (err) => {
      setError(err.message || 'AI analysis failed. Please try again.');
      setHasRun(true);
    },
  });

  // Auto-run analysis when panel mounts and opportunities are available
  useEffect(() => {
    if (opportunities.length > 0) {
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = () => {
    if (opportunities.length === 0) return;
    setPicks(null);
    setError(null);
    setSelectedPicks(new Set());
    setQuantities({});
    // Build a diverse set: guarantee at least 1 best pick per unique symbol,
    // then fill remaining slots with top-scored opportunities (up to 50 total)
    const sorted = [...opportunities].sort((a, b) => b.score - a.score);
    const symbolsSeen = new Set<string>();
    const guaranteed: typeof sorted = [];
    const remaining: typeof sorted = [];
    // First pass: pick the best opportunity for each unique symbol
    for (const opp of sorted) {
      if (!symbolsSeen.has(opp.symbol)) {
        symbolsSeen.add(opp.symbol);
        guaranteed.push(opp);
      }
    }
    // Second pass: fill with top-scored that aren't already guaranteed
    const guaranteedSet = new Set(guaranteed);
    for (const opp of sorted) {
      if (!guaranteedSet.has(opp)) remaining.push(opp);
    }
    const top50 = [...guaranteed, ...remaining].slice(0, 50);
    top50Ref.current = top50; // Store for use in onSubmitSelected
    analyze.mutate({ opportunities: top50, availableBuyingPower, strategy });
  };

  const togglePick = (idx: number) => {
    setSelectedPicks(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSubmitSelected = () => {
    if (!picks || !onSubmitSelected) return;
    const chosen = picks
      .filter((_, i) => selectedPicks.has(i))
      .map((pick) => {
        const pickIdx = picks.indexOf(pick);
        const adjustedQty = quantities[pickIdx] ?? pick.quantity;
        // Enrich the pick's opportunity with the original data from top50Ref.
        // The AI server may return null/undefined for optional numeric fields (shortStrike, strike)
        // because Zod strips null values. Using the original top50 data avoids this issue.
        const originalOpp = top50Ref.current[pick.opportunityIndex];
        const enrichedOpportunity = originalOpp
          ? { ...pick.opportunity, ...originalOpp }
          : pick.opportunity;
        return { ...pick, quantity: adjustedQty, opportunity: enrichedOpportunity };
      })
      // Guard: drop any pick whose enriched opportunity is missing critical fields
      .filter((pick) => {
        const opp = pick.opportunity as any;
        const hasStrike = (opp?.strike ?? opp?.shortStrike) != null;
        if (!hasStrike) {
          console.warn('[AIAdvisorPanel] Dropping pick missing strike:', opp);
        }
        return hasStrike;
      });
    if (chosen.length === 0) return;
    onSubmitSelected(chosen);
  };

  return (
    <div className="rounded-xl border border-purple-500/40 bg-gradient-to-br from-purple-950/50 to-slate-900/70 shadow-xl shadow-purple-900/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20 bg-purple-900/20">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-500/20">
            <Sparkles className="h-4 w-4 text-purple-300" />
          </div>
          <span className="font-semibold text-purple-200 text-sm">AI Advisor</span>
          <Badge variant="outline" className="text-xs border-purple-500/40 text-purple-400 px-1.5 py-0">
            {strategy}
          </Badge>
          {opportunities.length > 0 && (
            <span className="text-xs text-slate-500">
              · {Math.min(opportunities.length, 50)} of {opportunities.length} opportunities
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasRun && !analyze.isPending && (
            <Button
              size="sm"
              variant="ghost"
              onClick={runAnalysis}
              className="h-7 px-2 text-purple-400 hover:text-purple-200 hover:bg-purple-500/20 text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Re-run
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-500/20"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Loading state */}
        {analyze.isPending && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <div className="relative">
              <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
              <Sparkles className="h-3 w-3 text-purple-300 absolute -top-1 -right-1 animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-sm text-purple-200 font-medium">
                Analyzing {Math.min(opportunities.length, 50)} opportunities...
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Evaluating ROC, delta, liquidity, and score across all tickers
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !analyze.isPending && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-500/30 text-red-400 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Analysis failed</p>
              <p className="text-xs mt-0.5 text-red-300/70">{error}</p>
            </div>
          </div>
        )}

        {/* Picks */}
        {picks && picks.length > 0 && !analyze.isPending && (
          <div className="space-y-3">
            {availableBuyingPower === 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs mb-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" />
                <div>
                  <span className="font-medium">No account connected</span> — quantities shown are estimates only.{' '}
                  Connect your Tastytrade account in{' '}
                  <a href="/settings" className="underline text-amber-200 hover:text-white">Settings</a>{' '}
                  for accurate buying power and contract sizing.
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500 mb-1">
              Top {picks.length} from {Math.min(opportunities.length, 50)} scanned
              {availableBuyingPower > 0
                ? ` · $${availableBuyingPower.toLocaleString()} buying power`
                : ''}
              {onSubmitSelected && (
                <span className="text-purple-400"> · Check picks to include in pre-order</span>
              )}
            </p>

            {picks.map((pick, idx) => {
              const style = RANK_STYLES[idx] || RANK_STYLES[2];
              const opp = pick.opportunity;
              if (!opp) return null;
              const isChecked = selectedPicks.has(idx);
              return (
                <div
                  key={pick.rank}
                  className={`rounded-lg border ${style.border} ${style.bg} p-3 space-y-2 transition-all duration-150 ${isChecked ? 'ring-1 ring-purple-500/40' : 'opacity-75'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Checkbox for pre-order selection */}
                      {onSubmitSelected && (
                        <Checkbox
                          id={`ai-pick-${idx}`}
                          checked={isChecked}
                          onCheckedChange={() => togglePick(idx)}
                          className="border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600 shrink-0"
                        />
                      )}
                      <Badge variant="outline" className={`text-xs font-semibold ${style.badge}`}>
                        {style.label}
                      </Badge>
                      <span className="font-bold text-white text-sm">{opp.symbol}</span>
                      <span className="text-slate-400 text-xs">{formatStrike(opp)}</span>
                      <span className="text-slate-500 text-xs">{opp.expiration} · {opp.dte}d</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Quantity spinner */}
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg border border-slate-600/40 px-1 py-0.5">
                          <button
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors disabled:opacity-30"
                            onClick={() => setQuantities(prev => ({ ...prev, [idx]: Math.max(1, (prev[idx] ?? pick.quantity) - 1) }))}
                            disabled={(quantities[idx] ?? pick.quantity) <= 1}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="text-green-400 font-bold text-sm min-w-[1.5rem] text-center">
                            {quantities[idx] ?? pick.quantity}x
                          </span>
                          <button
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
                            onClick={() => setQuantities(prev => ({ ...prev, [idx]: (prev[idx] ?? pick.quantity) + 1 }))}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="text-right">
                          <div className="text-green-300 text-xs font-medium">
                            @ ${opp.netCredit.toFixed(2)}
                          </div>
                          <div className="text-slate-500 text-xs">
                            ${((quantities[idx] ?? pick.quantity) * opp.netCredit * 100).toFixed(0)} total
                          </div>
                        </div>
                      </div>
                      {onSelectOpportunity && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSelectOpportunity(opp)}
                          className="h-7 px-2 text-xs border-green-500/40 text-green-400 hover:bg-green-500/20 hover:text-green-300"
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Select
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Key metrics row */}
                  <div className="flex gap-3 text-xs text-slate-400 flex-wrap">
                    <span>Score: <span className="text-white font-medium">{opp.score}</span></span>
                    <span>ROC: <span className="text-green-400 font-medium">{(opp.roc ?? 0).toFixed(2)}%</span></span>
                    {opp.delta != null && (
                      <span>Δ: <span className="text-blue-300 font-medium">{opp.delta.toFixed(3)}</span></span>
                    )}
                    {opp.openInterest != null && (
                      <span>OI: <span className="text-slate-300 font-medium">{opp.openInterest.toLocaleString()}</span></span>
                    )}
                    {opp.ivRank != null && (
                      <span>IVR: <span className="text-orange-300 font-medium">{opp.ivRank.toFixed(0)}%</span></span>
                    )}
                    <span>Collateral: <span className="text-slate-300 font-medium">${(opp.capitalRisk ?? 0).toLocaleString()}</span></span>
                  </div>

                  {/* Rationale */}
                  <div className="flex items-start gap-1 text-xs">
                    <TrendingUp className="h-3 w-3 text-green-400 mt-0.5 shrink-0" />
                    <span className="text-slate-300 leading-relaxed">{pick.rationale}</span>
                  </div>

                  {pick.riskNote && (
                    <div className="flex items-start gap-1 text-xs">
                      <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                      <span className="text-amber-400/80">{pick.riskNote}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Submit Selected to Pre-Order button */}
            {onSubmitSelected && (
              <div className="pt-1 space-y-1">
                <Button
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-500 hover:to-emerald-600 text-white font-semibold shadow-lg hover:shadow-green-900/40 transition-all duration-200 disabled:opacity-40"
                  size="default"
                  disabled={selectedPicks.size === 0}
                  onClick={handleSubmitSelected}
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  {selectedPicks.size > 0
                    ? `Submit ${selectedPicks.size} Selected Pick${selectedPicks.size > 1 ? 's' : ''} to Pre-Order`
                    : 'Select Picks to Submit'}
                </Button>
                {selectedPicks.size === 0 && (
                  <p className="text-xs text-slate-500 text-center">Check at least one pick above to enable submission</p>
                )}
              </div>
            )}

            <p className="text-xs text-slate-500 text-center pt-1">
              AI analysis based on score, ROC, liquidity, delta, and DTE. Always verify before trading.
            </p>
          </div>
        )}

        {/* No picks returned */}
        {picks && picks.length === 0 && !analyze.isPending && (
          <div className="text-center py-4 text-slate-400 text-sm">
            <Sparkles className="h-6 w-6 mx-auto mb-2 text-purple-500/50" />
            <p>No recommendations returned. Try re-running the analysis.</p>
          </div>
        )}

        {/* No opportunities yet */}
        {opportunities.length === 0 && !analyze.isPending && (
          <div className="text-center py-4 text-slate-400 text-sm">
            <p>Run a scan first to generate opportunities, then the AI will analyze them.</p>
          </div>
        )}
      </div>
    </div>
  );
}
