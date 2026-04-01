/**
 * RollOrderReviewModal
 * Full pre-order review panel for roll/close submissions.
 * Shows every queued position with all details, allows:
 *  - Remove individual positions from the queue
 *  - Swap to a different candidate (from the cached candidates list)
 *  - Adjust the limit price per order
 *  - Dry Run or Live Submit
 */

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Loader2, Send, Eye, Trash2, ChevronDown, ChevronUp, RefreshCw,
  TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, Info,
} from 'lucide-react';
import { toast } from 'sonner';

export type RollOrderItem = {
  positionId: string;
  symbol: string;
  strategy: 'CC' | 'CSP' | 'BPS' | 'BCS' | 'IC';
  accountNumber: string;
  accountLabel?: string;
  // Current position info
  currentStrike: number;
  currentExpiration: string;
  currentDte: number;
  currentValue: number;   // total BTC cost in dollars
  openPremium: number;    // original credit received
  quantity: number;       // number of contracts
  optionSymbol: string;
  // Selected candidate
  candidate: RollCandidateItem;
  // All available candidates for this position (for swap)
  allCandidates: RollCandidateItem[];
  // Spread details (for multi-leg)
  isSpread: boolean;
  spreadDetails?: {
    legs: Array<{ symbol: string; action: string; quantity: number }>;
    spreadWidth: number;
  };
};

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
  // Adjusted limit price (user-editable)
  limitPrice?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: RollOrderItem[];
  onSubmit: (items: RollOrderItem[], isDryRun: boolean) => Promise<void>;
  isSubmitting: boolean;
};

function fmt(n: number | undefined, prefix = '$', decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}${prefix}${abs.toFixed(decimals)}`;
}

function fmtCredit(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '+';
  return `${sign}$${abs.toFixed(2)}`;
}

function PnlChip({ value, label }: { value: number | undefined; label: string }) {
  if (value === undefined || value === null || isNaN(value)) return null;
  const isPos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${
      isPos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
    }`}>
      {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {label}: {fmtCredit(value)}
    </span>
  );
}

function StrategyBadge({ strategy }: { strategy: string }) {
  const colors: Record<string, string> = {
    CC: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    CSP: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    BCS: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    BPS: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    IC: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  };
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${colors[strategy] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {strategy}
    </span>
  );
}

function ActionBadge({ action }: { action: 'roll' | 'close' }) {
  return action === 'roll' ? (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">
      ROLL
    </span>
  ) : (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
      CLOSE
    </span>
  );
}

type ItemRowProps = {
  item: RollOrderItem;
  index: number;
  onRemove: (id: string) => void;
  onSwapCandidate: (id: string, candidateIdx: number) => void;
  onAdjustPrice: (id: string, price: number | undefined) => void;
};

function ItemRow({ item, index, onRemove, onSwapCandidate, onAdjustPrice }: ItemRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [priceInput, setPriceInput] = useState<string>(
    item.candidate.limitPrice !== undefined ? item.candidate.limitPrice.toFixed(2) : ''
  );
  const [swapOpen, setSwapOpen] = useState(false);

  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const netDisplay = isRoll ? c.netCredit : c.netPnl;
  const netLabel = isRoll ? 'Net Credit' : 'Net P&L';

  const handlePriceChange = (val: string) => {
    setPriceInput(val);
    const n = parseFloat(val);
    onAdjustPrice(item.positionId, isNaN(n) ? undefined : n);
  };

  const selectedCandidateIdx = item.allCandidates.findIndex(
    ca => ca.description === c.description && ca.action === c.action
  );

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* Row header */}
      <div className="flex items-center gap-3 p-3 bg-card/60 hover:bg-card/80 transition-colors">
        {/* Index */}
        <span className="text-xs text-muted-foreground w-5 text-center font-mono">{index + 1}</span>

        {/* Strategy + Symbol */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StrategyBadge strategy={item.strategy} />
          <span className="font-semibold text-sm">{item.symbol}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {item.quantity}× @${item.currentStrike} exp {item.currentExpiration}
          </span>
          {item.accountLabel && (
            <span className="text-xs text-muted-foreground/60 hidden md:inline">· {item.accountLabel}</span>
          )}
        </div>

        {/* Action */}
        <ActionBadge action={c.action} />

        {/* Roll target */}
        {isRoll && c.strike && c.expiration && (
          <span className="text-xs text-orange-300 hidden sm:inline">
            → ${c.strike} {c.expiration} ({c.dte}d)
          </span>
        )}

        {/* Net credit / P&L chip */}
        <PnlChip value={netDisplay} label={netLabel} />

        {/* Limit price input */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Limit:</span>
          <Input
            className="h-6 w-20 text-xs font-mono px-1.5 py-0"
            placeholder="auto"
            value={priceInput}
            onChange={e => handlePriceChange(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
        </div>

        {/* Swap candidate */}
        {item.allCandidates.length > 1 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs border-orange-500/30 text-orange-300 hover:bg-orange-500/10"
                  onClick={e => { e.stopPropagation(); setSwapOpen(s => !s); }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Swap
                </Button>
              </TooltipTrigger>
              <TooltipContent>Choose a different roll candidate</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Remove */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                onClick={e => { e.stopPropagation(); onRemove(item.positionId); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove from queue</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Expand toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground"
          onClick={() => setExpanded(s => !s)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Swap candidate selector */}
      {swapOpen && item.allCandidates.length > 1 && (
        <div className="px-3 pb-2 pt-1 bg-orange-950/20 border-t border-orange-500/20">
          <p className="text-xs text-orange-300/70 mb-1.5">Select a different candidate:</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {item.allCandidates.map((ca, idx) => (
              <button
                key={idx}
                onClick={() => { onSwapCandidate(item.positionId, idx); setSwapOpen(false); }}
                className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center justify-between gap-2 transition-colors ${
                  idx === selectedCandidateIdx
                    ? 'bg-orange-500/20 text-orange-200 border border-orange-500/30'
                    : 'hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <ActionBadge action={ca.action} />
                  <span>{ca.description}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {ca.netCredit !== undefined && (
                    <PnlChip value={ca.netCredit} label="cr" />
                  )}
                  <span className="text-muted-foreground/60">Score {ca.score}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 bg-muted/20 border-t border-border/30">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
            <div>
              <span className="text-muted-foreground">Contracts</span>
              <p className="font-mono font-semibold">{item.quantity}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Open Premium</span>
              <p className="font-mono font-semibold text-emerald-400">{fmt(item.openPremium)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">BTC Cost</span>
              <p className="font-mono font-semibold text-red-400">{fmt(item.currentValue)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Current DTE</span>
              <p className="font-mono font-semibold">{item.currentDte}d</p>
            </div>
            {isRoll && (
              <>
                <div>
                  <span className="text-muted-foreground">New Strike</span>
                  <p className="font-mono font-semibold">${c.strike}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">New Expiry</span>
                  <p className="font-mono font-semibold">{c.expiration}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">New DTE</span>
                  <p className="font-mono font-semibold">{c.dte}d</p>
                </div>
                <div>
                  <span className="text-muted-foreground">New STO Premium</span>
                  <p className="font-mono font-semibold text-emerald-400">{fmt(c.newPremium)}</p>
                </div>
                {c.annualizedReturn !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Ann. Return</span>
                    <p className={`font-mono font-semibold ${(c.annualizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {c.annualizedReturn?.toFixed(1)}%
                    </p>
                  </div>
                )}
                {c.delta !== undefined && (
                  <div>
                    <span className="text-muted-foreground">New Delta</span>
                    <p className="font-mono font-semibold">{c.delta?.toFixed(2)}</p>
                  </div>
                )}
              </>
            )}
            {!isRoll && c.closeCost !== undefined && (
              <>
                <div>
                  <span className="text-muted-foreground">Close Cost</span>
                  <p className="font-mono font-semibold text-red-400">{fmt(c.closeCost)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Net P&L</span>
                  <p className={`font-mono font-semibold ${(c.netPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtCredit(c.netPnl)}
                  </p>
                </div>
              </>
            )}
            <div>
              <span className="text-muted-foreground">Candidate Score</span>
              <p className="font-mono font-semibold">{c.score}</p>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Account</span>
              <p className="font-mono font-semibold text-xs truncate">{item.accountNumber}</p>
            </div>
          </div>
          {item.isSpread && item.spreadDetails && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <p className="text-xs text-muted-foreground mb-1">Spread legs (atomic order):</p>
              <div className="space-y-0.5">
                {item.spreadDetails.legs.map((leg, i) => (
                  <p key={i} className="text-xs font-mono text-muted-foreground/80">
                    {leg.action} {leg.quantity}× {leg.symbol}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RollOrderReviewModal({ open, onClose, items: initialItems, onSubmit, isSubmitting }: Props) {
  const [items, setItems] = useState<RollOrderItem[]>(initialItems);

  // Sync when parent updates items (e.g. after Scan All re-runs)
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const rollCount = items.filter(i => i.candidate.action === 'roll').length;
  const closeCount = items.filter(i => i.candidate.action === 'close').length;

  const totalNetCredit = useMemo(() => {
    return items.reduce((sum, item) => {
      const c = item.candidate;
      const qty = item.quantity || 1;
      if (c.action === 'roll' && c.netCredit !== undefined) {
        return sum + c.netCredit * qty * 100;
      }
      if (c.action === 'close' && c.netPnl !== undefined) {
        return sum + c.netPnl;
      }
      return sum;
    }, 0);
  }, [items]);

  const handleRemove = (positionId: string) => {
    setItems(prev => prev.filter(i => i.positionId !== positionId));
    toast.info('Position removed from queue');
  };

  const handleSwapCandidate = (positionId: string, candidateIdx: number) => {
    setItems(prev => prev.map(item => {
      if (item.positionId !== positionId) return item;
      const newCandidate = item.allCandidates[candidateIdx];
      if (!newCandidate) return item;
      return { ...item, candidate: newCandidate };
    }));
  };

  const handleAdjustPrice = (positionId: string, price: number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.positionId !== positionId) return item;
      return { ...item, candidate: { ...item.candidate, limitPrice: price } };
    }));
  };

  const handleSubmit = async (isDryRun: boolean) => {
    if (items.length === 0) {
      toast.warning('No positions in queue');
      return;
    }
    await onSubmit(items, isDryRun);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isSubmitting) onClose(); }}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                <Send className="h-5 w-5 text-orange-400" />
                Roll Order Review
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                Review, adjust, and confirm each order before submission. Remove or swap any position below.
              </DialogDescription>
            </div>
            {/* Summary chips */}
            <div className="flex items-center gap-2 shrink-0">
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
                Net: {fmtCredit(totalNetCredit)} total
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4 space-y-2">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No positions in queue. Close this panel and select positions to roll.</p>
              </div>
            ) : (
              items.map((item, idx) => (
                <ItemRow
                  key={item.positionId}
                  item={item}
                  index={idx}
                  onRemove={handleRemove}
                  onSwapCandidate={handleSwapCandidate}
                  onAdjustPrice={handleAdjustPrice}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border/50 shrink-0 bg-card/40">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{items.length}</span> order{items.length !== 1 ? 's' : ''} queued
              {items.length > 0 && (
                <span className="ml-2">
                  · Est. net: <span className={totalNetCredit >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {fmtCredit(totalNetCredit)}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting || items.length === 0}
                className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-1.5" />
                )}
                Dry Run
              </Button>
              <Button
                size="sm"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting || items.length === 0}
                className="bg-orange-600 hover:bg-orange-700 text-white font-semibold"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                Submit {items.length} Order{items.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
