import React, { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, AlertTriangle, TrendingUp, X, Loader2, RefreshCw } from 'lucide-react';

interface Opportunity {
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
}

interface AIPick {
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

export function AIAdvisorPanel({
  opportunities,
  availableBuyingPower,
  strategy,
  onSelectOpportunity,
  onClose,
}: AIAdvisorPanelProps) {
  const [picks, setPicks] = useState<AIPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const analyze = trpc.aiAdvisor.analyzeOpportunities.useMutation({
    onSuccess: (data) => {
      setPicks(data.picks as AIPick[]);
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
    // Send top 50 by score
    const top50 = [...opportunities]
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    analyze.mutate({ opportunities: top50, availableBuyingPower, strategy });
  };

  const formatStrike = (opp: Opportunity) => {
    if (opp.shortStrike && opp.longStrike) return `$${opp.shortStrike}/$${opp.longStrike}`;
    if (opp.strike) return `$${opp.strike}`;
    return '—';
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
            <p className="text-xs text-slate-500 mb-1">
              Top 3 from {Math.min(opportunities.length, 50)} scanned
              {availableBuyingPower > 0
                ? ` · $${availableBuyingPower.toLocaleString()} buying power`
                : ' · Quantities estimated from $100k BP'}
            </p>
            {picks.map((pick, idx) => {
              const style = RANK_STYLES[idx] || RANK_STYLES[2];
              const opp = pick.opportunity;
              if (!opp) return null;
              return (
                <div
                  key={pick.rank}
                  className={`rounded-lg border ${style.border} ${style.bg} p-3 space-y-2`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-xs font-semibold ${style.badge}`}>
                        {style.label}
                      </Badge>
                      <span className="font-bold text-white text-sm">{opp.symbol}</span>
                      <span className="text-slate-400 text-xs">{formatStrike(opp)}</span>
                      <span className="text-slate-500 text-xs">{opp.expiration} · {opp.dte}d</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-green-400 font-bold text-sm">
                          {pick.quantity}x @ ${opp.netCredit.toFixed(2)}
                        </div>
                        <div className="text-slate-500 text-xs">
                          ${(pick.quantity * opp.netCredit * 100).toFixed(0)} total credit
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
                    <span>ROC: <span className="text-green-400 font-medium">{opp.roc.toFixed(2)}%</span></span>
                    {opp.delta !== undefined && (
                      <span>Δ: <span className="text-blue-300 font-medium">{opp.delta.toFixed(3)}</span></span>
                    )}
                    {opp.openInterest !== undefined && (
                      <span>OI: <span className="text-slate-300 font-medium">{opp.openInterest.toLocaleString()}</span></span>
                    )}
                    {opp.ivRank !== undefined && (
                      <span>IVR: <span className="text-orange-300 font-medium">{opp.ivRank.toFixed(0)}%</span></span>
                    )}
                    <span>Collateral: <span className="text-slate-300 font-medium">${opp.capitalRisk.toLocaleString()}</span></span>
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
