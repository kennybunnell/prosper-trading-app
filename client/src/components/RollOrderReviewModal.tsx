/**
 * RollOrderReviewModal — Full-screen overlay order management workspace.
 * Redesigned Apr 1 2026: replaces narrow dialog with full-viewport panel.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Loader2, Send, Eye, Trash2, ChevronUp, ChevronDown, RefreshCw,
  TrendingUp, TrendingDown, X, ChevronRight, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

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

type Props = {
  open: boolean;
  onClose: () => void;
  items: RollOrderItem[];
  onSubmit: (items: RollOrderItem[], isDryRun: boolean) => Promise<void>;
  isSubmitting: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return `$${Math.abs(n).toFixed(decimals)}`;
}

function fmtSigned(n: number | undefined, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toFixed(decimals)}`;
}

function fmtTotal(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function CreditChip({ value }: { value: number | undefined }) {
  if (value === undefined || value === null || isNaN(value)) return <span className="text-muted-foreground text-xs">—</span>;
  const isPos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
      {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {fmtSigned(value)}
    </span>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ item, onClose: onClosePanel }: { item: RollOrderItem; onClose: () => void }) {
  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const totalNetCredit = isRoll && c.netCredit !== undefined
    ? c.netCredit * item.quantity * 100
    : c.netPnl;

  return (
    <div className="flex flex-col h-full bg-card border-l border-border/50 w-80 shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <StratBadge s={item.strategy} />
          <span className="font-semibold text-sm">{item.symbol}</span>
          <ActionBadge a={c.action} />
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClosePanel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-4 text-xs">
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Current Position</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div><span className="text-muted-foreground">Contracts</span><p className="font-mono font-semibold">{item.quantity}</p></div>
              <div><span className="text-muted-foreground">Strike</span><p className="font-mono font-semibold">${item.currentStrike.toFixed(0)}</p></div>
              <div><span className="text-muted-foreground">Expiry</span><p className="font-mono font-semibold">{item.currentExpiration}</p></div>
              <div><span className="text-muted-foreground">DTE</span><p className={`font-mono font-semibold ${item.currentDte <= 7 ? 'text-red-400' : item.currentDte <= 14 ? 'text-yellow-400' : ''}`}>{item.currentDte}d</p></div>
              <div><span className="text-muted-foreground">Open Premium</span><p className="font-mono font-semibold text-emerald-400">{fmt(item.openPremium)}</p></div>
              <div><span className="text-muted-foreground">BTC Cost</span><p className="font-mono font-semibold text-red-400">{fmt(item.currentValue)}</p></div>
            </div>
          </section>

          <div className="border-t border-border/30" />

          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">
              {isRoll ? 'Roll Target' : 'Close Details'}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {isRoll && (
                <>
                  <div><span className="text-muted-foreground">New Strike</span><p className="font-mono font-semibold text-orange-300">${c.strike?.toFixed(0) ?? '—'}</p></div>
                  <div><span className="text-muted-foreground">New Expiry</span><p className="font-mono font-semibold text-orange-300">{c.expiration ?? '—'}</p></div>
                  <div><span className="text-muted-foreground">New DTE</span><p className="font-mono font-semibold">{c.dte ?? '—'}d</p></div>
                  <div><span className="text-muted-foreground">New STO Prem.</span><p className="font-mono font-semibold text-emerald-400">{fmt(c.newPremium)}</p></div>
                  {c.annualizedReturn !== undefined && (
                    <div><span className="text-muted-foreground">Ann. Return</span><p className={`font-mono font-semibold ${(c.annualizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{c.annualizedReturn?.toFixed(1)}%</p></div>
                  )}
                  {c.delta !== undefined && (
                    <div><span className="text-muted-foreground">New Delta</span><p className="font-mono font-semibold">{c.delta?.toFixed(2)}</p></div>
                  )}
                </>
              )}
              {!isRoll && (
                <>
                  <div><span className="text-muted-foreground">Close Cost</span><p className="font-mono font-semibold text-red-400">{fmt(c.closeCost)}</p></div>
                  <div><span className="text-muted-foreground">Net P&L</span><p className={`font-mono font-semibold ${(c.netPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtSigned(c.netPnl)}</p></div>
                </>
              )}
              <div className="col-span-2">
                <span className="text-muted-foreground">Net {isRoll ? 'Credit' : 'P&L'} (total)</span>
                <p className={`font-mono font-bold text-sm ${(totalNetCredit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtSigned(totalNetCredit)}
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-border/30" />

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
      </ScrollArea>
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
        const netVal = ca.action === 'roll' ? (ca.netCredit ?? 0) * item.quantity * 100 : ca.netPnl;
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
  onSelect: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSwap: (idx: number) => void;
  onPriceChange: (price: number | undefined) => void;
};

function TableRow({ item, index, total, isSelected, onSelect, onRemove, onMoveUp, onMoveDown, onSwap, onPriceChange }: RowProps) {
  const [priceInput, setPriceInput] = useState(
    item.candidate.limitPrice !== undefined ? item.candidate.limitPrice.toFixed(2) : ''
  );
  const [swapOpen, setSwapOpen] = useState(false);

  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const netPerContract = isRoll ? c.netCredit : c.netPnl;
  const netTotal = isRoll && c.netCredit !== undefined
    ? c.netCredit * item.quantity * 100
    : c.netPnl;

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
      <td className="px-2 py-2.5 w-32 text-right">
        <span className={`text-xs font-bold font-mono ${(netTotal ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmtSigned(netTotal)}
        </span>
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
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={onMoveUp} disabled={index === 0}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move up</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={onMoveDown} disabled={index === total - 1}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move down</TooltipContent>
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

  React.useEffect(() => {
    setItems(initialItems);
    setSelectedId(null);
  }, [initialItems]);

  const selectedItem = useMemo(() => items.find(i => i.positionId === selectedId) ?? null, [items, selectedId]);

  const rollCount = items.filter(i => i.candidate.action === 'roll').length;
  const closeCount = items.filter(i => i.candidate.action === 'close').length;

  const totalNetCredit = useMemo(() => {
    return items.reduce((sum, item) => {
      const c = item.candidate;
      const qty = item.quantity || 1;
      if (c.action === 'roll' && c.netCredit !== undefined) return sum + c.netCredit * qty * 100;
      if (c.action === 'close' && c.netPnl !== undefined) return sum + c.netPnl;
      return sum;
    }, 0);
  }, [items]);

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
            Est. Net: {fmtTotal(totalNetCredit)}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={onClose} disabled={isSubmitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: table + optional detail panel */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="min-w-[960px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                  <tr className="border-b border-border/50">
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-8">#</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-14">Strat</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-20">Symbol</th>
                    <th className="px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-10">Qty</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-36">Current</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-16">Action</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-40">Roll Target</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-28">Per Contract</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-32">Total</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-28">Limit $</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider w-36">Controls</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-16 text-muted-foreground text-sm">
                        No positions in queue. Close this panel and select positions to roll.
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => (
                      <TableRow
                        key={item.positionId}
                        item={item}
                        index={idx}
                        total={items.length}
                        isSelected={selectedId === item.positionId}
                        onSelect={() => setSelectedId(prev => prev === item.positionId ? null : item.positionId)}
                        onRemove={() => handleRemove(item.positionId)}
                        onMoveUp={() => handleMoveUp(idx)}
                        onMoveDown={() => handleMoveDown(idx)}
                        onSwap={(ci) => handleSwap(item.positionId, ci)}
                        onPriceChange={(p) => handlePriceChange(item.positionId, p)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <DetailPanel item={selectedItem} onClose={() => setSelectedId(null)} />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border/50 bg-card/80 shrink-0 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{items.length}</span> order{items.length !== 1 ? 's' : ''} queued
          {items.length > 0 && (
            <span className="ml-2">
              · Est. net:{' '}
              <span className={`font-semibold ${totalNetCredit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtTotal(totalNetCredit)}
              </span>
            </span>
          )}
          <span className="ml-3 text-xs text-muted-foreground/50">up/down arrows to reorder · swap icon to change candidate · trash to remove</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
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
