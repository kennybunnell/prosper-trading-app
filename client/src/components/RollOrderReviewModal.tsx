/**
 * RollOrderReviewModal — Full-screen overlay order management workspace.
 * Apr 2 2026:
 *   - BUG FIX: Net credit total was incorrectly multiplied by 100. netCredit is already
 *     the per-contract dollar value (premium × 100 shares). Total = netCredit × quantity.
 *   - DTE selector in detail panel: click any available expiration to re-fetch the best
 *     strike at that DTE, or type a custom DTE and hit Enter.
 *   - Strike nudge buttons: CC → move strike UP (less assignment risk), CSP → move DOWN
 *     (more cushion). Each nudge fetches live bid/ask and recalculates net credit.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Loader2, Send, Eye, Trash2, ChevronUp, ChevronDown, RefreshCw,
  TrendingUp, TrendingDown, X, ChevronRight, ShieldCheck,
  ArrowUpDown, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RollCandidateItem = {
  action: 'roll' | 'close';
  strike?: number;
  expiration?: string;
  dte?: number;
  netCredit?: number;
  closeCost?: number;
  netPnl?: number;
  openPremium?: number;
  newPremium?: number;
  annualizedReturn?: number;
  delta?: number;
  score: number;
  description: string;
  limitPrice?: number;
};

export type RollOrderItem = {
  positionId: string;
  symbol: string;
  strategy: 'CC' | 'CSP' | 'BPS' | 'BCS' | 'IC';
  accountNumber: string;
  accountLabel?: string;
  currentStrike: number;
  currentExpiration: string;
  currentDte: number;
  currentValue: number;
  openPremium: number;
  quantity: number;
  optionSymbol: string;
  candidate: RollCandidateItem;
  allCandidates: RollCandidateItem[];
  isSpread: boolean;
  spreadDetails?: {
    legs: Array<{ symbol: string; action: string; quantity: number }>;
    spreadWidth: number;
  };
};

type SortKey = 'none' | 'symbol' | 'total' | 'score';
type SortDir = 'asc' | 'desc';

type Props = {
  open: boolean;
  onClose: () => void;
  items: RollOrderItem[];
  onSubmit: (items: RollOrderItem[], isDryRun: boolean) => Promise<void>;
  isSubmitting: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return `$${Math.abs(n).toFixed(decimals)}`;
}

function fmtSigned(n: number | undefined | null, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toFixed(decimals)}`;
}

function fmtTotal(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Net credit total: netCredit is already per-contract dollars (premium × 100 shares). Total = netCredit × quantity. */
function calcNetTotal(item: RollOrderItem): number | undefined {
  const c = item.candidate;
  if (c.action === 'roll' && c.netCredit !== undefined) return c.netCredit * item.quantity;
  if (c.action === 'close' && c.netPnl !== undefined) return c.netPnl;
  return undefined;
}

const STRATEGY_COLORS: Record<string, string> = {
  CC:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  CSP: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  BCS: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  BPS: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  IC:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

function StratBadge({ s }: { s: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${STRATEGY_COLORS[s] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {s}
    </span>
  );
}

function ActionBadge({ a }: { a: 'roll' | 'close' }) {
  return a === 'roll' ? (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 whitespace-nowrap">ROLL</span>
  ) : (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 whitespace-nowrap">CLOSE</span>
  );
}

function CreditChip({ value }: { value: number | undefined | null }) {
  if (value === undefined || value === null || isNaN(value)) return <span className="text-muted-foreground text-xs">—</span>;
  const isPos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
      {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {fmtSigned(value)}
    </span>
  );
}

// ─── Sort Header Button ───────────────────────────────────────────────────────

function SortHeader({
  label, sortKey, currentKey, currentDir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        active ? 'text-orange-300' : 'text-muted-foreground/70 hover:text-muted-foreground'
      }`}
    >
      {label}
      {active ? (
        currentDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

type DetailPanelProps = {
  item: RollOrderItem;
  liveCredit?: number | null;
  onClose: () => void;
  onUpdateCandidate: (positionId: string, patch: Partial<RollCandidateItem>) => void;
};

function DetailPanel({ item, liveCredit, onClose, onUpdateCandidate }: DetailPanelProps) {
  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const optionType: 'call' | 'put' = (item.strategy === 'CC' || item.strategy === 'BCS') ? 'call' : 'put';

  // DTE input state
  const [dteInput, setDteInput] = useState('');
  const [nearbyExps, setNearbyExps] = useState<Array<{ expiration: string; dte: number }>>([]); 

  // Strike nudge state
  const [nudgeLoading, setNudgeLoading] = useState<'up' | 'down' | null>(null);
  // Track whether premium was recently updated (for LIVE badge)
  const [premiumUpdated, setPremiumUpdated] = useState(false);
  const [prevStrike, setPrevStrike] = useState<number | undefined>(c.strike);

  // Live stock price via tRPC
  const stockPriceQuery = trpc.automation.getUnderlyingPrice.useQuery(
    { symbol: item.symbol },
    { staleTime: 30_000, retry: 1 }
  );
  const stockPrice = stockPriceQuery.data?.price ?? null;
  const priceLoading = stockPriceQuery.isLoading;

  const fetchDteMutation = trpc.automation.fetchRollTargetForDTE.useMutation({
    onSuccess: (data) => {
      setNearbyExps(data.nearbyExps);
      setPremiumUpdated(true);
      onUpdateCandidate(item.positionId, {
        expiration: data.expiration,
        dte: data.dte,
        strike: data.strike,
        newPremium: data.stoPremium != null ? data.stoPremium : undefined,
        netCredit: data.netCreditPerContract != null ? data.netCreditPerContract : undefined,
        delta: data.delta ?? undefined,
      });
      if (data.stoPremium != null) {
        toast.success(`DTE → ${data.dte}d @ $${data.strike} · Premium: $${data.stoPremium?.toFixed(2)}`);
      } else {
        toast.warning(`DTE → ${data.dte}d @ $${data.strike} — premium unavailable`);
      }
    },
    onError: (err) => toast.error(`DTE fetch failed: ${err.message}`),
  });

  const fetchStrikeMutation = trpc.automation.fetchStrikeQuote.useMutation({
    onSuccess: (data) => {
      setNudgeLoading(null);
      setPrevStrike(c.strike);
      setPremiumUpdated(true);
      // Write all updated values directly into the candidate via parent state
      onUpdateCandidate(item.positionId, {
        strike: data.strike,
        newPremium: data.stoPremium != null ? data.stoPremium : undefined,
        netCredit: data.netCreditPerContract != null ? data.netCreditPerContract : undefined,
      });
      if (data.stoPremium == null) {
        toast.warning(`Strike updated to $${data.strike} — premium unavailable (illiquid strike)`);
      } else {
        toast.success(`Strike updated to $${data.strike} · Premium: $${data.stoPremium?.toFixed(2)}`);
      }
    },
    onError: (err) => {
      setNudgeLoading(null);
      toast.error(`Strike fetch failed: ${err.message}`);
    },
  });

  const handleDteFetch = (targetDte: number) => {
    if (!isRoll) return;
    fetchDteMutation.mutate({
      positionId: item.positionId,
      symbol: item.symbol,
      currentExpiration: item.currentExpiration,
      currentShortStrike: item.currentStrike,
      optionType,
      currentOptionSymbol: item.optionSymbol,
      targetDte,
      quantity: item.quantity,
    });
  };

  const handleDteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const n = parseInt(dteInput);
      if (!isNaN(n) && n >= 1 && n <= 180) handleDteFetch(n);
    }
  };

  const handleStrikeNudge = (direction: 'up' | 'down') => {
    if (!isRoll || !c.strike || !c.expiration) return;
    // Determine increment: use $1 for stocks under $50, $5 for $50-$500, $10 for $500+
    const increment = item.currentStrike < 50 ? 1 : item.currentStrike < 500 ? 5 : 10;
    const newStrike = direction === 'up' ? c.strike + increment : c.strike - increment;
    if (newStrike <= 0) return;
    setNudgeLoading(direction);
    fetchStrikeMutation.mutate({
      positionId: item.positionId,
      symbol: item.symbol,
      expiration: c.expiration,
      strike: newStrike,
      optionType,
      currentOptionSymbol: item.optionSymbol,
      quantity: item.quantity,
    });
  };

  // Effective net total: use live credit if available, else calculated
  const effectiveNetTotal = liveCredit !== undefined && liveCredit !== null
    ? liveCredit
    : calcNetTotal(item);

  // Direction hint for strike nudge
  const nudgeUpLabel = item.strategy === 'CC' ? 'Move strike UP (less assignment risk)' : 'Move strike UP';
  const nudgeDownLabel = item.strategy === 'CSP' ? 'Move strike DOWN (more cushion)' : 'Move strike DOWN';
  const primaryNudge: 'up' | 'down' = item.strategy === 'CC' ? 'up' : 'down';

  return (
    <div className="flex flex-col h-full bg-card border-l border-border/50 w-80 shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <StratBadge s={item.strategy} />
          <span className="font-semibold text-sm">{item.symbol}</span>
          <ActionBadge a={c.action} />
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Current Price — prominent box */}
      <div className="px-4 py-2.5 bg-muted/30 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-0.5">Current Price</p>
            {priceLoading ? (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </span>
            ) : stockPrice !== null ? (
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-lg text-foreground">${stockPrice.toFixed(2)}</span>
                {stockPriceQuery.data?.changePct !== null && stockPriceQuery.data?.changePct !== undefined && (
                  <span className={`text-xs font-semibold ${
                    (stockPriceQuery.data.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {(stockPriceQuery.data.changePct ?? 0) >= 0 ? '\u25b2' : '\u25bc'} {Math.abs(stockPriceQuery.data.changePct ?? 0).toFixed(2)}%
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/50">Unavailable</span>
            )}
          </div>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${item.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 transition-colors text-xs font-medium"
          >
            <TrendingUp className="h-3.5 w-3.5" /> View Chart
          </a>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-4 text-xs">

          {/* Current Position */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Current Position</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div><span className="text-muted-foreground">Contracts</span><p className="font-mono font-semibold">{item.quantity}</p></div>
              <div><span className="text-muted-foreground">Strike</span><p className="font-mono font-semibold">${item.currentStrike.toFixed(0)}</p></div>
              <div><span className="text-muted-foreground">Expiry</span><p className="font-mono font-semibold">{item.currentExpiration}</p></div>
              <div>
                <span className="text-muted-foreground">DTE</span>
                <p className={`font-mono font-semibold ${item.currentDte <= 7 ? 'text-red-400' : item.currentDte <= 14 ? 'text-yellow-400' : ''}`}>
                  {item.currentDte}d
                </p>
              </div>
              <div><span className="text-muted-foreground">Open Premium</span><p className="font-mono font-semibold text-emerald-400">{fmt(item.openPremium)}</p></div>
              <div><span className="text-muted-foreground">BTC Cost</span><p className="font-mono font-semibold text-red-400">{fmt(item.currentValue)}</p></div>
            </div>
          </section>

          <div className="border-t border-border/30" />

          {/* Roll Target */}
          {isRoll && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Roll Target</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {/* Strike with nudge buttons */}
                <div>
                  <span className="text-muted-foreground">New Strike</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="font-mono font-semibold text-orange-300">${c.strike?.toFixed(0) ?? '—'}</p>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="sm"
                            className={`h-5 w-5 p-0 ${primaryNudge === 'up' ? 'text-emerald-400 hover:text-emerald-300' : 'text-muted-foreground hover:text-foreground'}`}
                            onClick={() => handleStrikeNudge('up')}
                            disabled={nudgeLoading !== null || fetchDteMutation.isPending}
                          >
                            {nudgeLoading === 'up' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronsUp className="h-3 w-3" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{nudgeUpLabel}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="sm"
                            className={`h-5 w-5 p-0 ${primaryNudge === 'down' ? 'text-emerald-400 hover:text-emerald-300' : 'text-muted-foreground hover:text-foreground'}`}
                            onClick={() => handleStrikeNudge('down')}
                            disabled={nudgeLoading !== null || fetchDteMutation.isPending}
                          >
                            {nudgeLoading === 'down' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronsDown className="h-3 w-3" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{nudgeDownLabel}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {item.strategy === 'CC' ? '↑ up = less risk' : item.strategy === 'CSP' ? '↓ down = more cushion' : ''}
                  </p>
                </div>

                {/* DTE with selector — full-width interactive section */}
                <div className="col-span-2 p-2 rounded-md bg-muted/20 border border-border/30">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                      <Calendar className="h-3 w-3" /> Change DTE
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-bold text-orange-300 text-sm">{c.dte ?? '\u2014'}d</span>
                      {fetchDteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                  {/* Quick-select preset DTE buttons */}
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {[7, 14, 21, 30, 45, 60].map(dte => (
                      <button
                        key={dte}
                        onClick={() => handleDteFetch(dte)}
                        disabled={fetchDteMutation.isPending}
                        className={`text-[11px] px-2 py-1 rounded border font-medium transition-colors ${
                          c.dte === dte
                            ? 'bg-orange-500/30 text-orange-300 border-orange-500/50'
                            : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted/70 hover:text-foreground'
                        }`}
                      >
                        {dte}d
                      </button>
                    ))}
                    {nearbyExps.filter(e => ![7,14,21,30,45,60].includes(e.dte)).slice(0, 3).map(e => (
                      <button
                        key={e.expiration}
                        onClick={() => handleDteFetch(e.dte)}
                        disabled={fetchDteMutation.isPending}
                        className={`text-[11px] px-2 py-1 rounded border font-medium transition-colors ${
                          c.dte === e.dte
                            ? 'bg-orange-500/30 text-orange-300 border-orange-500/50'
                            : 'bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500/20'
                        }`}
                      >
                        {e.dte}d
                      </button>
                    ))}
                  </div>
                  {/* Custom DTE input */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="h-7 flex-1 text-xs font-mono px-2 bg-background/50"
                      placeholder="Custom DTE (1-180)"
                      value={dteInput}
                      onChange={e => setDteInput(e.target.value)}
                      onKeyDown={handleDteKeyDown}
                    />
                    <Button
                      variant="outline" size="sm"
                      className="h-7 px-3 text-xs text-sky-400 border-sky-500/40 hover:bg-sky-500/10"
                      onClick={() => {
                        const n = parseInt(dteInput);
                        if (!isNaN(n) && n >= 1 && n <= 180) handleDteFetch(n);
                      }}
                      disabled={fetchDteMutation.isPending || !dteInput}
                    >
                      {fetchDteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Fetch'}
                    </Button>
                  </div>
                </div>
                <div><span className="text-muted-foreground">New Expiry</span><p className="font-mono font-semibold text-orange-300">{c.expiration ?? '\u2014'}</p></div>
                {/* New STO Premium — always reads from c.newPremium (updated via onUpdateCandidate) */}
                <div>
                  <span className="text-muted-foreground flex items-center gap-1">
                    New STO Prem.
                    {premiumUpdated && <span className="text-[9px] text-sky-400 font-semibold animate-pulse">LIVE</span>}
                  </span>
                  <p className={`font-mono font-semibold ${
                    c.newPremium == null ? 'text-muted-foreground' :
                    c.newPremium >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {c.newPremium != null ? fmt(c.newPremium) : (nudgeLoading ? '...' : '—')}
                  </p>
                  {premiumUpdated && prevStrike !== undefined && prevStrike !== c.strike && (
                    <p className="text-[10px] text-muted-foreground/60 font-mono">
                      strike: ${prevStrike?.toFixed(0)} → ${c.strike?.toFixed(0)}
                    </p>
                  )}
                </div>
                {c.annualizedReturn !== undefined && (
                  <div><span className="text-muted-foreground">Ann. Return</span><p className={`font-mono font-semibold ${(c.annualizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{c.annualizedReturn?.toFixed(1)}%</p></div>
                )}
                {c.delta !== undefined && (
                  <div><span className="text-muted-foreground">New Delta</span><p className="font-mono font-semibold">{c.delta?.toFixed(2)}</p></div>
                )}
                {/* Net Credit total — always reads from calcNetTotal(item) which uses updated c.netCredit */}
                <div className="col-span-2 p-2 rounded-md bg-muted/20 border border-border/30">
                  <span className="text-muted-foreground text-[10px] flex items-center gap-1">
                    Net Credit (total)
                    {premiumUpdated && <span className="text-[9px] text-sky-400 font-semibold animate-pulse">LIVE</span>}
                    {(liveCredit !== undefined && liveCredit !== null && !premiumUpdated) && <span className="text-[9px] text-sky-400">refreshed</span>}
                  </span>
                  <p className={`font-mono font-bold text-base mt-0.5 ${
                    (effectiveNetTotal ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {fmtSigned(effectiveNetTotal)}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Close Details */}
          {!isRoll && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Close Details</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div><span className="text-muted-foreground">Close Cost</span><p className="font-mono font-semibold text-red-400">{fmt(c.closeCost)}</p></div>
                <div><span className="text-muted-foreground">Net P&L</span><p className={`font-mono font-semibold ${(c.netPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtSigned(c.netPnl)}</p></div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Net P&L (total)</span>
                  <p className={`font-mono font-bold text-sm ${(effectiveNetTotal ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtSigned(effectiveNetTotal)}</p>
                </div>
              </div>
            </section>
          )}

          <div className="border-t border-border/30" />

          {/* Candidate Info */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Candidate Info</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div><span className="text-muted-foreground">Score</span><p className="font-mono font-semibold">{c.score}</p></div>
              <div className="col-span-2"><span className="text-muted-foreground">Description</span><p className="font-medium text-foreground/80">{c.description}</p></div>
              {isRoll && (
                <div className="col-span-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-semibold">
                    <ShieldCheck className="h-3 w-3" /> Atomic {item.isSpread ? '4-leg' : '2-leg'} combo order
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Spread Legs */}
          {item.isSpread && item.spreadDetails && (
            <>
              <div className="border-t border-border/30" />
              <section>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Spread Legs</p>
                <div className="space-y-1">
                  {item.spreadDetails.legs.map((leg, i) => (
                    <p key={i} className="font-mono text-muted-foreground/80">{leg.action} {leg.quantity}× {leg.symbol}</p>
                  ))}
                </div>
              </section>
            </>
          )}

          <div className="border-t border-border/30" />
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Account</p>
            <p className="font-mono text-xs text-muted-foreground break-all">{item.accountNumber}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Swap Panel ───────────────────────────────────────────────────────────────

function SwapPanel({ item, onSwap, onClose: onCloseSwap }: {
  item: RollOrderItem;
  onSwap: (idx: number) => void;
  onClose: () => void;
}) {
  const current = item.candidate;
  return (
    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-xl p-3 space-y-1 max-h-60 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-foreground">Choose a different candidate</p>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onCloseSwap}><X className="h-3 w-3" /></Button>
      </div>
      {item.allCandidates.map((ca, idx) => {
        const isCurrent = ca.description === current.description && ca.action === current.action;
        const netVal = ca.action === 'roll' ? (ca.netCredit !== undefined ? ca.netCredit * item.quantity : undefined) : ca.netPnl;
        return (
          <button
            key={idx}
            onClick={() => { onSwap(idx); onCloseSwap(); }}
            className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center justify-between gap-2 transition-colors ${
              isCurrent ? 'bg-orange-500/20 text-orange-200 border border-orange-500/30' : 'hover:bg-muted/50 text-muted-foreground'
            }`}
          >
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <ActionBadge a={ca.action} />
              <span className="truncate">{ca.description}</span>
            </span>
            <span className="shrink-0 flex items-center gap-2">
              {netVal !== undefined && (
                <span className={netVal >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                  {fmtSigned(netVal)}
                </span>
              )}
              <span className="text-muted-foreground/50">#{ca.score}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

type RowProps = {
  item: RollOrderItem;
  index: number;
  total: number;
  isSelected: boolean;
  isSorted: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSwap: (idx: number) => void;
  onPriceChange: (price: number | undefined) => void;
  refreshedCredit?: number | null;
};

function TableRow({ item, index, total, isSelected, isSorted, onSelect, onRemove, onMoveUp, onMoveDown, onSwap, onPriceChange, refreshedCredit }: RowProps) {
  const [priceInput, setPriceInput] = useState(
    item.candidate.limitPrice !== undefined ? item.candidate.limitPrice.toFixed(2) : ''
  );
  const [swapOpen, setSwapOpen] = useState(false);

  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const netPerContract = isRoll ? c.netCredit : c.netPnl;
  // BUG FIX: netCredit is per-contract dollars (already includes 100-share multiplier)
  const netTotal = calcNetTotal(item);

  const hasRefresh = refreshedCredit !== undefined && refreshedCredit !== null;
  const refreshDiff = hasRefresh && netTotal !== undefined ? refreshedCredit! - netTotal : null;

  const handlePrice = (val: string) => {
    setPriceInput(val);
    const n = parseFloat(val);
    onPriceChange(isNaN(n) ? undefined : n);
  };

  return (
    <tr
      className={`border-b border-border/30 transition-colors cursor-pointer ${
        isSelected ? 'bg-orange-500/8 ring-1 ring-inset ring-orange-500/20' : 'hover:bg-muted/20'
      }`}
      onClick={onSelect}
    >
      <td className="px-2 py-2.5 text-center text-xs text-muted-foreground font-mono w-8">{index + 1}</td>
      <td className="px-2 py-2.5 w-14"><StratBadge s={item.strategy} /></td>
      <td className="px-2 py-2.5 w-20"><span className="font-semibold text-sm">{item.symbol}</span></td>
      <td className="px-2 py-2.5 text-center w-10"><span className="text-xs font-mono text-muted-foreground">{item.quantity}x</span></td>
      <td className="px-2 py-2.5 w-36">
        <div className="text-xs font-mono leading-tight">
          <span className="text-muted-foreground">${item.currentStrike.toFixed(0)}</span>
          <span className="text-muted-foreground/50 mx-1">·</span>
          <span className="text-muted-foreground/70">{item.currentExpiration.slice(5)}</span>
          <span className="text-muted-foreground/40 ml-1">({item.currentDte}d)</span>
        </div>
      </td>
      <td className="px-2 py-2.5 w-16"><ActionBadge a={c.action} /></td>
      <td className="px-2 py-2.5 w-40">
        {isRoll && c.strike && c.expiration ? (
          <div className="text-xs font-mono leading-tight text-orange-300">
            <span>${c.strike.toFixed(0)}</span>
            <span className="text-orange-300/60 mx-1">·</span>
            <span>{c.expiration.slice(5)}</span>
            <span className="text-orange-300/40 ml-1">({c.dte}d)</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/50 italic">close only</span>
        )}
      </td>
      <td className="px-2 py-2.5 w-28 text-right">
        <CreditChip value={netPerContract} />
      </td>
      <td className="px-2 py-2.5 w-40 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className={`text-xs font-bold font-mono ${(netTotal ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtSigned(netTotal)}
          </span>
          {hasRefresh && (
            <span className={`text-[10px] font-mono ${(refreshedCredit ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              Live: {fmtSigned(refreshedCredit)}
              {refreshDiff !== null && Math.abs(refreshDiff) > 0.01 && (
                <span className={`ml-1 ${refreshDiff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ({refreshDiff > 0 ? '+' : ''}{refreshDiff.toFixed(2)})
                </span>
              )}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5 w-20 text-center">
        <span className="text-xs font-mono text-muted-foreground">{c.score}</span>
      </td>
      <td className="px-2 py-2.5 w-28" onClick={e => e.stopPropagation()}>
        <Input
          className="h-6 w-24 text-xs font-mono px-1.5 py-0 bg-background/50"
          placeholder="auto"
          value={priceInput}
          onChange={e => handlePrice(e.target.value)}
        />
      </td>
      <td className="px-2 py-2.5 w-36" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-0.5 relative">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={onMoveUp} disabled={index === 0 || isSorted}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isSorted ? 'Clear sort to reorder' : 'Move up'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={onMoveDown} disabled={index === total - 1 || isSorted}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isSorted ? 'Clear sort to reorder' : 'Move down'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {item.allCandidates.length > 1 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-orange-400/70 hover:text-orange-300" onClick={() => setSwapOpen(s => !s)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Swap candidate</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400" onClick={onRemove}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from queue</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant="ghost" size="sm"
            className={`h-6 w-6 p-0 transition-colors ${isSelected ? 'text-orange-400' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
            onClick={onSelect}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          {swapOpen && (
            <SwapPanel item={item} onSwap={onSwap} onClose={() => setSwapOpen(false)} />
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RollOrderReviewModal({ open, onClose, items: initialItems, onSubmit, isSubmitting }: Props) {
  const [items, setItems] = useState<RollOrderItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('none');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [liveCredits, setLiveCredits] = useState<Map<string, number | null>>(new Map());

  const refreshMutation = trpc.automation.refreshRollPrices.useMutation({
    onSuccess: (data) => {
      const map = new Map<string, number | null>();
      for (const u of data.updates) {
        map.set(u.positionId, u.netCreditTotal);
      }
      setLiveCredits(map);
      setRefreshedAt(data.refreshedAt);
      toast.success(`Prices refreshed at ${fmtTime(data.refreshedAt)}`);
    },
    onError: (err) => {
      toast.error(`Refresh failed: ${err.message}`);
    },
  });

  React.useEffect(() => {
    setItems(initialItems);
    setSelectedId(null);
    setSortKey('none');
    setLiveCredits(new Map());
    setRefreshedAt(null);
  }, [initialItems]);

  const selectedItem = useMemo(() => items.find(i => i.positionId === selectedId) ?? null, [items, selectedId]);

  const displayItems = useMemo(() => {
    if (sortKey === 'none') return items;
    return [...items].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
      else if (sortKey === 'total') {
        const getNet = (item: RollOrderItem) => {
          const live = liveCredits.get(item.positionId);
          if (live !== undefined && live !== null) return live;
          return calcNetTotal(item) ?? 0;
        };
        va = getNet(a); vb = getNet(b);
      } else if (sortKey === 'score') {
        va = a.candidate.score; vb = b.candidate.score;
      }
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [items, sortKey, sortDir, liveCredits]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey('none'); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir(key === 'total' || key === 'score' ? 'desc' : 'asc');
    }
  };

  const applySort = () => {
    if (sortKey === 'none') return;
    setItems(displayItems);
    setSortKey('none');
    setSortDir('asc');
    toast.info('Sort order applied to queue');
  };

  const rollCount = items.filter(i => i.candidate.action === 'roll').length;
  const closeCount = items.filter(i => i.candidate.action === 'close').length;

  const totalNetCredit = useMemo(() => {
    return items.reduce((sum, item) => {
      const live = liveCredits.get(item.positionId);
      if (live !== undefined && live !== null) return sum + live;
      return sum + (calcNetTotal(item) ?? 0);
    }, 0);
  }, [items, liveCredits]);

  const handleRemove = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.positionId !== id));
    if (selectedId === id) setSelectedId(null);
    toast.info('Position removed from queue');
  }, [selectedId]);

  const handleMoveUp = useCallback((idx: number) => {
    if (idx === 0) return;
    setItems(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((idx: number) => {
    setItems(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const handleSwap = useCallback((id: string, candidateIdx: number) => {
    setItems(prev => prev.map(item => {
      if (item.positionId !== id) return item;
      const newCandidate = item.allCandidates[candidateIdx];
      if (!newCandidate) return item;
      return { ...item, candidate: { ...newCandidate } };
    }));
  }, []);

  const handlePriceChange = useCallback((id: string, price: number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.positionId !== id) return item;
      return { ...item, candidate: { ...item.candidate, limitPrice: price } };
    }));
  }, []);

  /** Called by DetailPanel when DTE re-fetch or strike nudge updates the candidate */
  const handleUpdateCandidate = useCallback((positionId: string, patch: Partial<RollCandidateItem>) => {
    setItems(prev => prev.map(item => {
      if (item.positionId !== positionId) return item;
      return { ...item, candidate: { ...item.candidate, ...patch } };
    }));
  }, []);

  const handleRefresh = () => {
    const payload = items.map(item => ({
      positionId: item.positionId,
      currentOptionSymbol: item.optionSymbol,
      newOptionSymbol: item.candidate.action === 'roll' && item.candidate.strike && item.candidate.expiration
        ? buildOptionSymbol(item.symbol, item.candidate.expiration, item.candidate.strike, item.strategy)
        : undefined,
      quantity: item.quantity,
    }));
    refreshMutation.mutate({ items: payload });
  };

  const handleSubmit = async (isDryRun: boolean) => {
    if (items.length === 0) { toast.warning('No positions in queue'); return; }
    await onSubmit(items, isDryRun);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/97 backdrop-blur-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 bg-card/80 shrink-0">
        <div className="flex items-center gap-3">
          <Send className="h-5 w-5 text-orange-400" />
          <div>
            <h2 className="text-base font-semibold leading-tight">Roll Order Review</h2>
            <p className="text-xs text-muted-foreground">Review, reorder, adjust, and confirm every order before submission · Click any row to view full details</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rollCount > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-orange-500/15 text-orange-300 border border-orange-500/25 font-medium">
              {rollCount} Roll{rollCount !== 1 ? 's' : ''}
            </span>
          )}
          {closeCount > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/25 font-medium">
              {closeCount} Close{closeCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded font-semibold border ${
            totalNetCredit >= 0
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
              : 'bg-red-500/15 text-red-300 border-red-500/25'
          }`}>
            {liveCredits.size > 0 ? 'Live' : 'Est.'} Net: {fmtTotal(totalNetCredit)}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={onClose} disabled={isSubmitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: table + optional detail panel */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {sortKey !== 'none' && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-orange-500/5 border-b border-orange-500/20 text-xs text-orange-300 shrink-0">
              <ArrowUpDown className="h-3 w-3" />
              <span>Sorted by <strong>{sortKey}</strong> ({sortDir}). Reorder arrows are disabled while sorted.</span>
              <button onClick={applySort} className="underline hover:no-underline ml-1">Apply as permanent order</button>
              <button onClick={() => { setSortKey('none'); setSortDir('asc'); }} className="underline hover:no-underline ml-2">Clear sort</button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className="min-w-[1020px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                  <tr className="border-b border-border/50">
                    <th className="px-2 py-2 text-left w-8"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">#</span></th>
                    <th className="px-2 py-2 text-left w-14"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Strat</span></th>
                    <th className="px-2 py-2 text-left w-20">
                      <SortHeader label="Symbol" sortKey="symbol" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 text-center w-10"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Qty</span></th>
                    <th className="px-2 py-2 text-left w-36"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Current</span></th>
                    <th className="px-2 py-2 text-left w-16"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Action</span></th>
                    <th className="px-2 py-2 text-left w-40"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Roll Target</span></th>
                    <th className="px-2 py-2 text-right w-28"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Per Contract</span></th>
                    <th className="px-2 py-2 text-right w-40">
                      <SortHeader label="Total" sortKey="total" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 text-center w-20">
                      <SortHeader label="Score" sortKey="score" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 text-left w-28"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Limit $</span></th>
                    <th className="px-2 py-2 text-left w-36"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Controls</span></th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center py-16 text-muted-foreground text-sm">
                        No positions in queue. Close this panel and select positions to roll.
                      </td>
                    </tr>
                  ) : (
                    displayItems.map((item, idx) => (
                      <TableRow
                        key={item.positionId}
                        item={item}
                        index={idx}
                        total={displayItems.length}
                        isSelected={selectedId === item.positionId}
                        isSorted={sortKey !== 'none'}
                        onSelect={() => setSelectedId(prev => prev === item.positionId ? null : item.positionId)}
                        onRemove={() => handleRemove(item.positionId)}
                        onMoveUp={() => handleMoveUp(items.indexOf(item))}
                        onMoveDown={() => handleMoveDown(items.indexOf(item))}
                        onSwap={(ci) => handleSwap(item.positionId, ci)}
                        onPriceChange={(p) => handlePriceChange(item.positionId, p)}
                        refreshedCredit={liveCredits.get(item.positionId)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <DetailPanel
            item={selectedItem}
            liveCredit={liveCredits.get(selectedItem.positionId)}
            onClose={() => setSelectedId(null)}
            onUpdateCandidate={handleUpdateCandidate}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border/50 bg-card/80 shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{items.length}</span> order{items.length !== 1 ? 's' : ''} queued
          </span>
          {items.length > 0 && (
            <span>
              · {liveCredits.size > 0 ? 'Live' : 'Est.'} net:{' '}
              <span className={`font-semibold ${totalNetCredit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtTotal(totalNetCredit)}
              </span>
            </span>
          )}
          {refreshedAt && (
            <span className="text-xs text-muted-foreground/50">· Prices as of {fmtTime(refreshedAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm"
                  onClick={handleRefresh}
                  disabled={refreshMutation.isPending || items.length === 0}
                  className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
                >
                  {refreshMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                  Refresh Prices
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fetch live bid/ask from Tradier and recalculate net credits</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline" size="sm"
            onClick={() => handleSubmit(true)}
            disabled={isSubmitting || items.length === 0}
            className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
            Dry Run
          </Button>
          <Button
            size="sm"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting || items.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white font-semibold min-w-[160px]"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Submit {items.length} Order{items.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Option symbol builder (Tradier OCC format) ───────────────────────────────

function buildOptionSymbol(underlying: string, expiration: string, strike: number, strategy: string): string {
  try {
    const d = new Date(expiration);
    const yy = d.getFullYear().toString().slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const type = (strategy === 'CC' || strategy === 'BCS') ? 'C' : 'P';
    const strikeStr = (strike * 1000).toFixed(0).padStart(8, '0');
    return `${underlying.padEnd(6)}${yy}${mm}${dd}${type}${strikeStr}`;
  } catch {
    return '';
  }
}
