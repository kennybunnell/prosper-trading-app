import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, AlertTriangle, TrendingUp, X, Loader2 } from 'lucide-react';

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
  onClose?: () => void;
}

const RANK_STYLES = [
  {
    label: '🥇 #1 Pick',
    border: 'border-yellow-500/60',
    bg: 'bg-yellow-500/10',
    badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  },
  {
    label: '🥈 #2 Pick',
    border: 'border-slate-400/60',
    bg: 'bg-slate-400/10',
    badge: 'bg-slate-400/20 text-slate-300 border-slate-400/40',
  },
  {
    label: '🥉 #3 Pick',
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

  const analyze = trpc.aiAdvisor.analyzeOpportunities.useMutation({
    onSuccess: (data) => {
      setPicks(data.picks as AIPick[]);
      setError(null);
    },
    onError: (err) => {
      setError(err.message || 'AI analysis failed. Please try again.');
    },
  });

  const handleAnalyze = () => {
    if (opportunities.length === 0) return;
    const top30 = [...opportunities]
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    analyze.mutate({ opportunities: top30, availableBuyingPower, strategy });
  };

  const formatStrike = (opp: Opportunity) => {
    if (opp.shortStrike && opp.longStrike) {
      return `$${opp.shortStrike} / $${opp.longStrike}`;
    }
    if (opp.strike) return `$${opp.strike}`;
    return '—';
  };

  return (
    <Card className="border-purple-500/30 bg-purple-950/20 shadow-lg shadow-purple-900/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-purple-300">
            <Sparkles className="h-5 w-5 text-purple-400" />
            AI Advisor
            <Badge
              variant="outline"
              className="text-xs border-purple-500/40 text-purple-400 ml-1"
            >
              {strategy}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {!picks && !analyze.isPending && (
              <Button
                size="sm"
                onClick={handleAnalyze}
                disabled={opportunities.length === 0}
                className="bg-purple-600 hover:bg-purple-500 text-white text-xs h-7 px-3"
              >
                <Sparkles className="h-3 w-3 mr-1" />
                Analyze Top {Math.min(opportunities.length, 30)} Opportunities
              </Button>
            )}
            {picks && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleAnalyze}
                disabled={analyze.isPending}
                className="text-purple-400 hover:text-purple-300 text-xs h-7 px-2"
              >
                {analyze.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  '↻ Re-analyze'
                )}
              </Button>
            )}
            {onClose && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClose}
                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {!picks && !analyze.isPending && (
          <p className="text-xs text-slate-400 mt-1">
            AI will analyze the top 30 opportunities by score and recommend the
            best 3 trades with suggested quantities.
            {availableBuyingPower > 0 ? ` Based on your $${availableBuyingPower.toLocaleString()} buying power.` : ' Connect your Tastytrade account for quantity recommendations.'}
          </p>
        )}
      </CardHeader>

      <CardContent>
        {analyze.isPending && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
            <p className="text-sm text-slate-400">
              Analyzing {Math.min(opportunities.length, 30)} opportunities...
            </p>
            <p className="text-xs text-slate-500">This takes about 5-10 seconds</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-red-950/30 border border-red-500/30 text-red-400 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {picks && picks.length > 0 && (
          <div className="space-y-3">
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
                      <Badge
                        variant="outline"
                        className={`text-xs ${style.badge}`}
                      >
                        {style.label}
                      </Badge>
                      <span className="font-bold text-white text-sm">
                        {opp.symbol}
                      </span>
                      <span className="text-slate-300 text-xs">
                        {opp.expiration} ({opp.dte}d)
                      </span>
                      <span className="text-slate-400 text-xs">
                        {formatStrike(opp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-green-400 font-semibold text-sm">
                          ${opp.netCredit.toFixed(2)}
                        </div>
                        <div className="text-slate-400 text-xs">
                          {opp.roc.toFixed(2)}% ROC
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-blue-300 font-bold text-sm">
                          {pick.quantity}x
                        </div>
                        <div className="text-slate-500 text-xs">qty</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>
                      Score: <span className="text-white">{opp.score}</span>
                    </span>
                    <span>
                      Collateral:{' '}
                      <span className="text-white">
                        ${opp.capitalRisk.toLocaleString()}
                      </span>
                    </span>
                    {opp.delta !== undefined && (
                      <span>
                        Δ{' '}
                        <span className="text-white">
                          {opp.delta.toFixed(3)}
                        </span>
                      </span>
                    )}
                    {opp.openInterest !== undefined && (
                      <span>
                        OI:{' '}
                        <span className="text-white">
                          {opp.openInterest.toLocaleString()}
                        </span>
                      </span>
                    )}
                    {opp.ivRank !== undefined && (
                      <span>
                        IVR:{' '}
                        <span className="text-white">
                          {opp.ivRank.toFixed(0)}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-start gap-1 text-xs">
                    <TrendingUp className="h-3 w-3 text-green-400 mt-0.5 flex-shrink-0" />
                    <span className="text-slate-300">{pick.rationale}</span>
                  </div>

                  <div className="flex items-start gap-1 text-xs">
                    <AlertTriangle className="h-3 w-3 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <span className="text-yellow-300/80">{pick.riskNote}</span>
                  </div>

                  {onSelectOpportunity && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSelectOpportunity(opp)}
                      className="h-6 text-xs px-2 border-purple-500/40 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200"
                    >
                      Select This Trade
                    </Button>
                  )}
                </div>
              );
            })}

            <p className="text-xs text-slate-500 text-center pt-1">
              AI analysis based on score, ROC, liquidity, delta, and DTE.
              Always verify before trading.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
