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

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
  Calendar, Star, Sparkles, MessageSquare,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Streamdown } from 'streamdown';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RollCandidateItem = {
  action: 'roll' | 'close';
  strike?: number;
  expiration?: string;
  dte?: number;
  netCredit?: number;   // mid-price net (positive = credit)
  netBid?: number;      // net at bid: STO bid - BTC ask (aggressive fill, lower credit)
  netAsk?: number;      // net at ask: STO ask - BTC bid (max credit, harder to fill)
  stoBid?: number;
  stoAsk?: number;
  btcBid?: number;
  btcAsk?: number;
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
  /** Best Fit winner for this position (may differ from currently selected candidate) */
  bestFitCandidate?: RollCandidateItem | null;
  /** Score breakdown for the Best Fit winner */
  bestFitScores?: { premiumScore: number; strikeScore: number; dteScore: number; bestFitScore: number };
};

type SortKey = 'none' | 'symbol' | 'total' | 'score' | 'dte';
type SortDir = 'asc' | 'desc';

type Props = {
  open: boolean;
  onClose: () => void;
  items: RollOrderItem[];
  onSubmit: (items: RollOrderItem[], isDryRun: boolean) => Promise<void>;
  isSubmitting: boolean;
  /** Map of positionId → Best Fit candidate (strike+expiration) for badge display */
  bestFitCache?: Record<string, { candidate?: { strike?: number; expiration?: string; action?: string }; premiumScore?: number; strikeScore?: number; dteScore?: number; bestFitScore?: number } | null>;
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
  onSubmitOne: (item: RollOrderItem, isDryRun: boolean) => Promise<void>;
  isSubmitting: boolean;
  initialSliderPos?: number;
  onSliderChange?: (positionId: string, pos: number) => void;
};

function DetailPanel({ item, liveCredit, onClose, onUpdateCandidate, onSubmitOne, isSubmitting, initialSliderPos, onSliderChange }: DetailPanelProps) {
  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const optionType: 'call' | 'put' = (item.strategy === 'CC' || item.strategy === 'BCS') ? 'call' : 'put';

  // DTE input state
  const [dteInput, setDteInput] = useState('');
  const [nearbyExps, setNearbyExps] = useState<Array<{ expiration: string; dte: number }>>([]); 

  // Submit This One state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitOneLoading, setSubmitOneLoading] = useState(false);

  // AI Advisor state
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [aiConversation, setAiConversation] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [aiFollowUp, setAiFollowUp] = useState('');
  const aiFollowUpRef = useRef<HTMLTextAreaElement>(null);

  // Reset AI state when item changes
  useEffect(() => {
    setAiAnalysis(null);
    setAiConversation([]);
    setAiExpanded(false);
    setAiFollowUp('');
  }, [item.positionId]);

  // Strike nudge state
  const [nudgeLoading, setNudgeLoading] = useState<'up' | 'down' | null>(null);
  // Nudge step size — user-selectable: $1, $2.50, or $5
  const [nudgeStep, setNudgeStep] = useState<number>(1);
  // Track whether premium was recently updated (for LIVE badge)
  const [premiumUpdated, setPremiumUpdated] = useState(false);
  const [prevStrike, setPrevStrike] = useState<number | undefined>(c.strike);

  // Bid/Ask continuum slider state (0 = bid/aggressive, 50 = mid, 100 = ask/max credit)
  // Initialize from the row-level slider position if provided, otherwise default to 50 (mid)
  const [sliderPos, setSliderPos] = useState(initialSliderPos ?? 50);
  // Sync from row when item changes or initialSliderPos changes
  useEffect(() => { setSliderPos(initialSliderPos ?? 50); }, [item.positionId, c.strike, c.expiration, initialSliderPos]);
  // Propagate detail panel slider changes back to the row-level slider
  const handleDetailSliderChange = (pos: number) => {
    setSliderPos(pos);
    onSliderChange?.(item.positionId, pos);
  };

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
      // CRITICAL: netCredit in RollCandidateItem is in TOTAL DOLLARS per contract (per-share × 100).
      // data.netCreditPerContract is per-share (Tradier bid/ask). Must multiply by 100 to match
      // the convention set by rollDetection.ts (netCredit = netCreditPerContract × qty × 100).
      // calcNetTotal then multiplies by quantity to get the grand total.
      // Update description to reflect new expiry date and DTE
      const updatedDesc = (() => {
        const base = c.description ?? '';
        if (!data.expiration || data.dte == null) return base;
        // Replace date portion: matches patterns like "4/12/2026" or "2026-04-12"
        let updated = base.replace(/\d{1,2}\/\d{1,2}\/\d{4}/, data.expiration);
        updated = updated.replace(/2\d{3}-\d{2}-\d{2}/, data.expiration);
        // Replace DTE portion: matches "(9 DTE)" or "(47 DTE)" or "9 DTE" etc.
        updated = updated.replace(/\(\d+ DTE\)/, `(${data.dte} DTE)`);
        updated = updated.replace(/\b\d+ DTE\b/, `${data.dte} DTE`);
        return updated;
      })();
      onUpdateCandidate(item.positionId, {
        expiration: data.expiration,
        dte: data.dte,
        strike: data.strike,
        newPremium: data.stoPremium != null ? data.stoPremium : undefined,
        netCredit: data.netCreditPerContract != null ? data.netCreditPerContract * 100 : undefined,
        delta: data.delta ?? undefined,
        description: updatedDesc,
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
      // CRITICAL: netCredit in RollCandidateItem is in TOTAL DOLLARS per contract (per-share × 100).
      // data.netCreditPerContract is per-share (Tradier bid/ask). Must multiply by 100 to match
      // the convention set by rollDetection.ts (netCredit = netCreditPerContract × qty × 100).
      // calcNetTotal then multiplies by quantity to get the grand total.
      // Build updated description reflecting the new strike
      const newDesc = (() => {
        const base = c.description ?? '';
        // Replace old strike value in description with new strike
        const strikeStr = data.strike != null
          ? (Number.isInteger(data.strike) ? `$${data.strike.toFixed(0)}` : `$${data.strike.toFixed(2)}`)
          : null;
        if (!strikeStr) return base;
        // Pattern: "Roll out to $XXX" or "Roll out to $XXX.XX"
        return base.replace(/Roll out to \$[\d.]+/, `Roll out to ${strikeStr}`);
      })();
      onUpdateCandidate(item.positionId, {
        strike: data.strike,
        newPremium: data.stoPremium != null ? data.stoPremium : undefined,
        netCredit: data.netCreditPerContract != null ? data.netCreditPerContract * 100 : undefined,
        description: newDesc,
        delta: data.delta != null ? data.delta : undefined,
      });
      if (data.stoPremium == null) {
        toast.warning(`Strike updated to $${data.strike != null ? (Number.isInteger(data.strike) ? data.strike.toFixed(0) : data.strike.toFixed(2)) : '?'} — premium unavailable (illiquid strike)`);
      } else {
        toast.success(`Strike updated to $${data.strike != null ? (Number.isInteger(data.strike) ? data.strike.toFixed(0) : data.strike.toFixed(2)) : '?'} · Premium: $${data.stoPremium?.toFixed(2)}`);
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
    // Use user-selected nudge step size
    const increment = nudgeStep;
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

  const handleSubmitOne = async (isDryRun: boolean) => {
    setConfirmOpen(false);
    setSubmitOneLoading(true);
    try {
      await onSubmitOne(item, isDryRun);
    } finally {
      setSubmitOneLoading(false);
    }
  };

  // AI Advisor mutations
  const aiRollAdvisorMutation = trpc.automation.aiRollAdvisor.useMutation({
    onSuccess: (data) => {
      setAiAnalysis(data.analysis as string);
      setAiConversation([{ role: 'assistant', content: data.analysis as string }]);
      setAiLoading(false);
      setAiExpanded(true);
    },
    onError: (err) => {
      setAiLoading(false);
      toast.error(`AI Advisor failed: ${err.message}`);
    },
  });

  const aiRollAdvisorFollowUpMutation = trpc.automation.aiRollAdvisorFollowUp.useMutation({
    onSuccess: (data) => {
      setAiConversation(prev => [...prev, { role: 'assistant', content: data.reply as string }]);
      setAiFollowUp('');
    },
    onError: (err) => {
      toast.error(`AI follow-up failed: ${err.message}`);
    },
  });

  const handleAiGenerate = useCallback(() => {
    setAiLoading(true);
    setAiAnalysis(null);
    setAiConversation([]);
    aiRollAdvisorMutation.mutate({
      position: {
        positionId: item.positionId,
        symbol: item.symbol,
        strategy: item.strategy,
        dte: item.currentDte,
        profitCaptured: item.openPremium > 0
          ? Math.round(((item.openPremium - Math.abs(item.currentValue)) / item.openPremium) * 100)
          : 0,
        itmDepth: 0,
        strikePrice: item.currentStrike,
        currentPrice: stockPrice ?? item.currentStrike,
        expiration: item.currentExpiration,
        openPremium: item.openPremium,
        currentValue: item.currentValue,
        unrealizedPnl: item.currentValue,
        reasons: [item.candidate.description],
        actionLabel: 'ROLL',
        rollCandidates: item.allCandidates.slice(0, 5).map(ca => ({
          action: ca.action,
          strike: ca.strike,
          expiration: ca.expiration,
          dte: ca.dte,
          netCredit: ca.netCredit,
          newPremium: ca.newPremium,
          delta: ca.delta,
          score: ca.score,
          description: ca.description,
        })),
      },
    });
  }, [item, stockPrice, aiRollAdvisorMutation]);

  const handleAiFollowUp = useCallback(() => {
    const q = aiFollowUp.trim();
    if (!q || aiRollAdvisorFollowUpMutation.isPending) return;
    const updatedConv = [...aiConversation, { role: 'user' as const, content: q }];
    setAiConversation(updatedConv);
    aiRollAdvisorFollowUpMutation.mutate({
      positionContext: `${item.symbol} ${item.strategy} | Strike: $${item.currentStrike} | Exp: ${item.currentExpiration} (${item.currentDte}d) | Open Premium: $${item.openPremium} | Current Value: $${item.currentValue}`,
      initialAnalysis: aiAnalysis ?? '',
      conversationHistory: aiConversation,
      userMessage: q,
    });
  }, [aiFollowUp, aiConversation, aiAnalysis, item, aiRollAdvisorFollowUpMutation]);

  const netTotal = calcNetTotal(item);
  const effectiveTotal = liveCredit !== undefined && liveCredit !== null ? liveCredit : netTotal;

  // ── Bid/Ask Slider derived values ──────────────────────────────────────────
  // netBid = lowest credit (aggressive fill), netAsk = highest credit (harder fill)
  // sliderPos: 0 = bid, 50 = mid, 100 = ask
  // Show slider for ALL roll types (CC, CSP, BPS, BCS, IC) whenever bid/ask data is available
  const hasSpread = isRoll && c.netBid !== undefined && c.netAsk !== undefined && c.netBid !== c.netAsk;
  const sliderLimitPrice = hasSpread
    ? (() => {
        const low  = c.netBid!;   // most aggressive (bid side)
        const high = c.netAsk!;   // max credit (ask side)
        const raw = low + (sliderPos / 100) * (high - low);
        // Round to nearest $0.05 (tastytrade minimum tick for spread orders)
        return Math.round(raw / 5) * 5 / 100;
      })()
    : undefined;

  // Fill probability label based on slider position
  const fillLabel = sliderPos <= 20
    ? { text: 'Very Likely to Fill', color: 'text-emerald-400' }
    : sliderPos <= 40
    ? { text: 'Likely to Fill', color: 'text-emerald-300' }
    : sliderPos <= 60
    ? { text: 'Mid — Good Balance', color: 'text-sky-400' }
    : sliderPos <= 80
    ? { text: 'Less Likely to Fill', color: 'text-amber-400' }
    : { text: 'Unlikely to Fill', color: 'text-red-400' };

  // Sync slider-derived limit price into the candidate whenever slider moves
  // (so the table row and submission both see the updated limitPrice)
  useEffect(() => {
    if (hasSpread && sliderLimitPrice !== undefined) {
      onUpdateCandidate(item.positionId, { limitPrice: sliderLimitPrice });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderPos, item.positionId]);

  return (
    <div className="flex flex-col h-full bg-card border-l border-border/50 w-[550px] shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <StratBadge s={item.strategy} />
          <span className="font-semibold text-base">{item.symbol}</span>
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
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-0.5">Current Price</p>
            {priceLoading ? (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </span>
            ) : stockPrice !== null ? (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-bold text-xl text-foreground">${stockPrice.toFixed(2)}</span>
                  {stockPriceQuery.data?.changePct !== null && stockPriceQuery.data?.changePct !== undefined && (
                    <span className={`text-xs font-semibold ${
                      (stockPriceQuery.data.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {(stockPriceQuery.data.changePct ?? 0) >= 0 ? '\u25b2' : '\u25bc'} {Math.abs(stockPriceQuery.data.changePct ?? 0).toFixed(2)}%
                    </span>
                  )}
                </div>
                {/* ITM/OTM distance vs current strike */}
                {(() => {
                  const strike = item.currentStrike;
                  const dist = strike - stockPrice;
                  const distPct = Math.abs(dist / stockPrice * 100);
                  // For CC: ITM when stock > strike; for CSP/puts: ITM when stock < strike
                  const isCall = item.strategy === 'CC' || item.strategy === 'BCS';
                  const isItm = isCall ? stockPrice > strike : stockPrice < strike;
                  const label = isItm ? 'ITM' : 'OTM';
                  const color = isItm ? 'text-red-400' : 'text-emerald-400';
                  const absDistLabel = isCall
                    ? (isItm ? `stock $${(stockPrice - strike).toFixed(2)} above strike` : `stock $${(strike - stockPrice).toFixed(2)} below strike`)
                    : (isItm ? `stock $${(strike - stockPrice).toFixed(2)} below strike` : `stock $${(stockPrice - strike).toFixed(2)} above strike`);
                  return (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isItm ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                        {label}
                      </span>
                      <span className={`text-xs font-mono ${color}`}>
                        {distPct.toFixed(1)}% · {absDistLabel}
                      </span>
                    </div>
                  );
                })()}
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
        <div className="px-4 py-3 space-y-4 text-sm">

          {/* Current Position */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Current Position</p>
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
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Roll Target</p>
                  {/* Best Fit badge — shown when current candidate IS the Best Fit winner */}
                  {item.bestFitCandidate &&
                    item.candidate.strike === item.bestFitCandidate.strike &&
                    item.candidate.expiration === item.bestFitCandidate.expiration && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-yellow-600/70 bg-yellow-400/20 text-yellow-900 dark:text-yellow-100 text-[9px] font-bold cursor-help">
                            <Star className="h-2 w-2 fill-yellow-600 text-yellow-600 dark:fill-yellow-300 dark:text-yellow-300" />
                            Best Fit
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs max-w-[180px]">
                          {item.bestFitScores ? (
                            <div className="space-y-0.5">
                              <div className="font-semibold mb-1">Best Fit Score Breakdown</div>
                              <div>Premium: <span className="font-mono font-semibold">{item.bestFitScores.premiumScore}</span>/100</div>
                              <div>Strike Safety: <span className="font-mono font-semibold">{item.bestFitScores.strikeScore}</span>/100</div>
                              <div>DTE: <span className="font-mono font-semibold">{item.bestFitScores.dteScore}</span>/100</div>
                              <div className="border-t border-border/40 mt-1 pt-1 font-semibold">Composite: <span className="font-mono">{item.bestFitScores.bestFitScore}</span>/100</div>
                            </div>
                          ) : 'This is the Best Fit candidate for this position'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {/* Indicator when current candidate differs from Best Fit */}
                  {item.bestFitCandidate &&
                    !(item.candidate.strike === item.bestFitCandidate.strike &&
                      item.candidate.expiration === item.bestFitCandidate.expiration) && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/5 text-orange-400/70 text-[9px] font-medium cursor-help">
                            <Star className="h-2 w-2 text-orange-400/70" />
                            Best Fit: ${(item.bestFitCandidate?.strike ?? 0).toFixed(0)} {(item.bestFitCandidate?.expiration ?? '').slice(5)} ({item.bestFitCandidate?.dte ?? 0}d)
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs max-w-[200px]">
                          {item.bestFitScores ? (
                            <div className="space-y-0.5">
                              <div className="font-semibold mb-1">Best Fit Recommendation</div>
                              <div className="opacity-70 mb-1">Current selection differs from Best Fit</div>
                              <div>Best Fit: ${(item.bestFitCandidate?.strike ?? 0).toFixed(0)} · {(item.bestFitCandidate?.expiration ?? '').slice(5)}</div>
                              <div className="border-t border-border/40 mt-1 pt-1">
                                <div>Premium: <span className="font-mono font-semibold">{item.bestFitScores.premiumScore}</span>/100</div>
                                <div>Strike Safety: <span className="font-mono font-semibold">{item.bestFitScores.strikeScore}</span>/100</div>
                                <div>DTE: <span className="font-mono font-semibold">{item.bestFitScores.dteScore}</span>/100</div>
                                <div className="font-semibold">Score: <span className="font-mono">{item.bestFitScores.bestFitScore}</span>/100</div>
                              </div>
                            </div>
                          ) : 'Best Fit recommendation available — current selection differs'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[9px] text-muted-foreground/60 hover:text-orange-300 hover:bg-orange-500/10 border border-transparent hover:border-orange-500/30"
                        onClick={() => {
                          const original = item.allCandidates[0];
                          if (!original) return;
                          onUpdateCandidate(item.positionId, {
                            strike: original.strike,
                            expiration: original.expiration,
                            dte: original.dte,
                            newPremium: original.newPremium,
                            netCredit: original.netCredit,
                            delta: original.delta,
                          });
                          setPremiumUpdated(false);
                          setPrevStrike(original.strike);
                          toast.info('Reset to original scanner recommendation');
                        }}
                      >
                        <RefreshCw className="h-2.5 w-2.5 mr-0.5" /> Reset
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      Reset to scanner&apos;s original recommendation
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {/* Strike with nudge buttons */}
                <div>
                  <span className="text-muted-foreground">New Strike</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="font-mono font-semibold text-orange-300">${c.strike != null ? (Number.isInteger(c.strike) ? c.strike.toFixed(0) : c.strike.toFixed(2)) : '—'}</p>
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
                  {/* Nudge step size selector */}
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[10px] text-muted-foreground/50 mr-0.5">Step:</span>
                    {[1, 2.5, 5].map((step) => (
                      <button
                        key={step}
                        onClick={() => setNudgeStep(step)}
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                          nudgeStep === step
                            ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                            : 'text-muted-foreground/50 border-border/30 hover:text-muted-foreground hover:border-border/60'
                        }`}
                      >
                        ${step}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    {item.strategy === 'CC' ? '↑ up = less risk' : item.strategy === 'CSP' ? '↓ down = more cushion' : ''}
                  </p>
                </div>

                {/* DTE with selector — full-width interactive section */}
                <div className="col-span-2 p-2 rounded-md bg-muted/20 border border-border/30">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-muted-foreground flex items-center gap-1 text-xs font-semibold uppercase tracking-wider">
                      <Calendar className="h-3 w-3" /> Change DTE
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-bold text-orange-300 text-base">{c.dte ?? '\u2014'}d</span>
                      {fetchDteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                  {/* Quick-select preset DTE buttons — each finds the nearest available expiration to the target */}
                  <p className="text-[10px] text-muted-foreground/50 mb-1">Finds nearest available expiration to target DTE</p>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {[7, 14, 21, 30, 45, 60].map(dte => (
                      <TooltipProvider key={dte}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleDteFetch(dte)}
                              disabled={fetchDteMutation.isPending}
                              className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
                                c.dte === dte
                                  ? 'bg-orange-500/30 text-orange-300 border-orange-500/50'
                                  : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted/70 hover:text-foreground'
                              }`}
                            >
                              ~{dte}d
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Find nearest expiration to {dte} DTE
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                    {nearbyExps.filter(e => ![7,14,21,30,45,60].includes(e.dte)).slice(0, 3).map(e => (
                      <button
                        key={e.expiration}
                        onClick={() => handleDteFetch(e.dte)}
                        disabled={fetchDteMutation.isPending}
                        className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
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
                      className="h-8 flex-1 text-sm font-mono px-2 bg-background/50"
                      placeholder="Custom DTE (1-180)"
                      value={dteInput}
                      onChange={e => setDteInput(e.target.value)}
                      onKeyDown={handleDteKeyDown}
                    />
                    <Button
                      variant="outline" size="sm"
                      className="h-8 px-3 text-sm text-sky-400 border-sky-500/40 hover:bg-sky-500/10"
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
                    <span className="text-xs text-muted-foreground/60 font-normal ml-1">/share</span>
                  </p>
                  {/* Full contract value = per-share × 100 (1 contract = 100 shares) */}
                  {c.newPremium != null && (
                    <p className="text-xs text-emerald-400/70 font-mono mt-0.5">
                      {fmt(c.newPremium * 100)}/contract
                    </p>
                  )}
                  {premiumUpdated && prevStrike !== undefined && prevStrike !== c.strike && (
                    <p className="text-xs text-muted-foreground/60 font-mono">
                      strike: ${prevStrike != null ? (Number.isInteger(prevStrike) ? prevStrike.toFixed(0) : prevStrike.toFixed(2)) : '?'} → ${c.strike != null ? (Number.isInteger(c.strike) ? c.strike.toFixed(0) : c.strike.toFixed(2)) : '?'}
                    </p>
                  )}
                </div>
                {c.annualizedReturn !== undefined && (
                  <div><span className="text-muted-foreground">Ann. Return</span><p className={`font-mono font-semibold ${(c.annualizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{c.annualizedReturn?.toFixed(1)}%</p></div>
                )}
                {c.delta !== undefined && (
                  <div><span className="text-muted-foreground">New Delta</span><p className="font-mono font-semibold">{c.delta?.toFixed(2)}</p></div>
                )}
                {/* ── Bid/Ask Continuum Slider ── */}
                {hasSpread ? (
                  <div className="col-span-2 p-3 rounded-md bg-muted/10 border border-sky-500/30 space-y-3">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-sky-400/80">Limit Price Tuner</span>
                      <span className={`text-xs font-semibold ${fillLabel.color}`}>{fillLabel.text}</span>
                    </div>

                    {/* Bid / Mid / Ask reference row */}
                    <div className="grid grid-cols-3 text-center text-[10px] font-mono">
                      <div>
                        <p className="text-muted-foreground/60 mb-0.5">Bid (fill fast)</p>
                        <p className="text-emerald-300 font-semibold">{c.netBid !== undefined ? fmtSigned(c.netBid) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground/60 mb-0.5">Mid</p>
                        <p className="text-sky-300 font-semibold">{fmtSigned(effectiveNetTotal)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground/60 mb-0.5">Ask (max credit)</p>
                        <p className="text-amber-300 font-semibold">{c.netAsk !== undefined ? fmtSigned(c.netAsk) : '—'}</p>
                      </div>
                    </div>

                    {/* Slider */}
                    <div className="space-y-1">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={sliderPos}
                        onChange={e => handleDetailSliderChange(Number(e.target.value))}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, #34d399 0%, #38bdf8 50%, #fbbf24 100%)`,
                        }}
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground/50">
                        <span>← Aggressive Fill</span>
                        <span>Max Credit →</span>
                      </div>
                    </div>

                    {/* Selected limit price */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/30">
                      <span className="text-xs text-muted-foreground">Limit Price (net credit)</span>
                      <span className={`font-mono font-bold text-base ${
                        (sliderLimitPrice ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {sliderLimitPrice !== undefined ? fmtSigned(sliderLimitPrice) : fmtSigned(effectiveNetTotal)}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Fallback: plain Net Credit box when no bid/ask data */
                  <div className="col-span-2 p-2 rounded-md bg-muted/20 border border-border/30">
                    <span className="text-muted-foreground text-xs flex items-center gap-1">
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
                )}
              </div>
            </section>
          )}

          {/* Close Details */}
          {!isRoll && (
            <section>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Close Details</p>
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
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Candidate Info</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div><span className="text-muted-foreground">Score</span><p className="font-mono font-semibold">{c.score}</p></div>
              <div className="col-span-2"><span className="text-muted-foreground">Description</span><p className="font-medium text-foreground/80">{c.description}</p></div>
              {isRoll && (
                <div className="col-span-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold">
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
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Spread Legs</p>
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
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Account</p>
            <p className="font-mono text-xs text-muted-foreground break-all">{item.accountNumber}</p>
          </section>

          {/* ── AI Advisor ── */}
          <div className="border-t border-border/30" />
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                <p className="text-xs font-bold uppercase tracking-wider text-violet-400/80">AI Advisor</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                onClick={handleAiGenerate}
                disabled={aiLoading}
              >
                {aiLoading ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Analyzing...</>
                ) : aiAnalysis ? (
                  <><RefreshCw className="h-3 w-3 mr-1" />Re-analyze</>
                ) : (
                  <><Sparkles className="h-3 w-3 mr-1" />Analyze This Roll</>
                )}
              </Button>
            </div>

            {/* Analysis output */}
            {aiAnalysis && (
              <div className="space-y-2">
                <div
                  className="text-xs leading-relaxed bg-violet-500/5 border border-violet-500/20 rounded-md p-2.5 cursor-pointer"
                  onClick={() => setAiExpanded(e => !e)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-violet-400/70 uppercase tracking-wide">Analysis</span>
                    <ChevronDown className={`h-3 w-3 text-violet-400/60 transition-transform ${aiExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {aiExpanded ? (
                    <div className="prose prose-invert prose-xs max-w-none text-foreground/80">
                      <Streamdown>{aiAnalysis}</Streamdown>
                    </div>
                  ) : (
                    <p className="text-muted-foreground/70 line-clamp-2">{aiAnalysis.replace(/#+\s*/g, '').slice(0, 120)}…</p>
                  )}
                </div>

                {/* Conversation thread */}
                {aiConversation.length > 1 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {aiConversation.slice(1).map((msg, i) => (
                      <div
                        key={i}
                        className={`text-xs rounded-md px-2.5 py-1.5 ${
                          msg.role === 'user'
                            ? 'bg-violet-500/10 border border-violet-500/20 text-violet-200 ml-4'
                            : 'bg-muted/30 border border-border/30 text-foreground/80'
                        }`}
                      >
                        {msg.role === 'user' ? (
                          <p>{msg.content}</p>
                        ) : (
                          <div className="prose prose-invert prose-xs max-w-none">
                            <Streamdown>{msg.content}</Streamdown>
                          </div>
                        )}
                      </div>
                    ))}
                    {aiRollAdvisorFollowUpMutation.isPending && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 px-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                      </div>
                    )}
                  </div>
                )}

                {/* Follow-up prompt */}
                <div className="flex gap-1.5">
                  <Textarea
                    ref={aiFollowUpRef}
                    value={aiFollowUp}
                    onChange={e => setAiFollowUp(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAiFollowUp();
                      }
                    }}
                    placeholder="Ask a follow-up question…"
                    className="flex-1 min-h-[52px] max-h-[100px] text-xs resize-none bg-muted/20 border-border/40 placeholder:text-muted-foreground/40"
                    disabled={aiRollAdvisorFollowUpMutation.isPending}
                  />
                  <Button
                    size="sm"
                    className="h-auto px-2 bg-violet-600 hover:bg-violet-700 text-white self-end"
                    onClick={handleAiFollowUp}
                    disabled={!aiFollowUp.trim() || aiRollAdvisorFollowUpMutation.isPending}
                  >
                    {aiRollAdvisorFollowUpMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Prompt shown before first analysis */}
            {!aiAnalysis && !aiLoading && (
              <p className="text-[11px] text-muted-foreground/50 italic">
                Click &ldquo;Analyze This Roll&rdquo; to get an AI recommendation on whether to roll, close, or hold this position.
              </p>
            )}
          </section>
        </div>
      </div>

      {/* ── Submit This One ── */}
      <div className="px-4 py-3 border-t border-border/50 bg-card/80 shrink-0 space-y-2">
        {!confirmOpen ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Submit This Position Only</p>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                className="flex-1 h-9 text-sm border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
                onClick={() => handleSubmitOne(true)}
                disabled={isSubmitting || submitOneLoading || nudgeLoading !== null || fetchDteMutation.isPending}
              >
                {submitOneLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                Dry Run
              </Button>
              <Button
                size="sm"
                className="flex-1 h-9 text-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold"
                onClick={() => setConfirmOpen(true)}
                disabled={isSubmitting || submitOneLoading || nudgeLoading !== null || fetchDteMutation.isPending}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Submit This One
              </Button>
            </div>
          </>
        ) : (
          // Inline confirmation dialog
          <div className="rounded-md border border-orange-500/40 bg-orange-500/8 p-3 space-y-2">
            <p className="text-sm font-semibold text-orange-300">Confirm Live Order</p>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p><span className="text-foreground font-semibold">{item.symbol}</span> · {item.strategy} · {item.quantity}× contracts</p>
              <p>Account: <span className="font-mono text-foreground">{item.accountNumber}</span></p>
              {c.action === 'roll' && c.strike && c.expiration && (
                <p>Roll to: <span className="text-orange-300 font-mono">${c.strike != null ? (Number.isInteger(c.strike) ? c.strike.toFixed(0) : c.strike.toFixed(2)) : '?'}</span> · {c.expiration} · {c.dte}d</p>
              )}
              <p>Est. Net: <span className={`font-semibold font-mono ${(effectiveTotal ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtSigned(effectiveTotal)}</span></p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost" size="sm"
                className="flex-1 h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 h-7 text-xs bg-orange-600 hover:bg-orange-700 text-white font-bold"
                onClick={() => handleSubmitOne(false)}
                disabled={submitOneLoading}
              >
                {submitOneLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                Confirm &amp; Submit
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Swap Panel ───────────────────────────────────────────────────────────────

function SwapPanel({ item, onSwap, onClose: onCloseSwap, bestFitCandidate }: {
  item: RollOrderItem;
  onSwap: (idx: number) => void;
  onClose: () => void;
  bestFitCandidate?: { strike?: number; expiration?: string; action?: string } | null;
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
        const isBF = bestFitCandidate != null &&
          ca.action === bestFitCandidate.action &&
          ca.strike === bestFitCandidate.strike &&
          ca.expiration === bestFitCandidate.expiration;
        return (
          <button
            key={idx}
            onClick={() => { onSwap(idx); onCloseSwap(); }}
            className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center justify-between gap-2 transition-colors ${
              isBF ? 'bg-yellow-500/10 border border-yellow-500/40 text-yellow-200' :
              isCurrent ? 'bg-orange-500/20 text-orange-200 border border-orange-500/30' : 'hover:bg-muted/50 text-muted-foreground'
            }`}
          >
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <ActionBadge a={ca.action} />
              {isBF && <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400 shrink-0" />}
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
  isChecked: boolean;
  isSorted: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSwap: (idx: number) => void;
  onPriceChange: (price: number | undefined) => void;
  refreshedCredit?: number | null;
  /** Whether the currently selected candidate is the Best Fit winner */
  isBestFit?: boolean;
  /** Score breakdown for the Best Fit winner */
  bestFitScores?: { premiumScore?: number; strikeScore?: number; dteScore?: number; bestFitScore?: number };
  /** Per-row slider position 0=bid 50=mid 100=ask */
  sliderPos: number;
  onSliderChange: (pos: number) => void;
};

function TableRow({ item, index, total, isSelected, isChecked, isSorted, onSelect, onToggleCheck, onRemove, onMoveUp, onMoveDown, onSwap, onPriceChange, refreshedCredit, isBestFit, bestFitScores, sliderPos, onSliderChange }: RowProps) {
  const [swapOpen, setSwapOpen] = useState(false);

  const c = item.candidate;
  const isRoll = c.action === 'roll';
  const netTotal = calcNetTotal(item);

  const hasRefresh = refreshedCredit !== undefined && refreshedCredit !== null;
  const refreshDiff = hasRefresh && netTotal !== undefined ? refreshedCredit! - netTotal : null;

  // ── Inline slider derived values ──────────────────────────────────────────
  const hasSlider = isRoll && c.netBid !== undefined && c.netAsk !== undefined && c.netBid !== c.netAsk;
  const rowLimitPrice = hasSlider
    ? (() => {
        const low = c.netBid!;
        const high = c.netAsk!;
        const raw = low + (sliderPos / 100) * (high - low);
        return Math.round(raw / 5) * 5 / 100;
      })()
    : undefined;

  // Sync slider-derived limitPrice into candidate whenever slider moves
  const prevSliderRef = React.useRef(sliderPos);
  React.useEffect(() => {
    if (hasSlider && rowLimitPrice !== undefined && prevSliderRef.current !== sliderPos) {
      prevSliderRef.current = sliderPos;
      onPriceChange(rowLimitPrice);
    }
  }, [sliderPos, rowLimitPrice, hasSlider, onPriceChange]);

  const fillColor = sliderPos <= 20 ? '#34d399'
    : sliderPos <= 40 ? '#6ee7b7'
    : sliderPos <= 60 ? '#38bdf8'
    : sliderPos <= 80 ? '#fbbf24'
    : '#f87171';

  const fillLabelShort = sliderPos <= 20 ? 'Fast Fill'
    : sliderPos <= 40 ? 'Likely'
    : sliderPos <= 60 ? 'Mid'
    : sliderPos <= 80 ? 'Slow'
    : 'Max Credit';

  return (
    <tr
      className={`border-b border-border/30 transition-colors cursor-pointer ${
        isSelected ? 'bg-orange-500/8 ring-1 ring-inset ring-orange-500/20' : 'hover:bg-muted/20'
      }`}
      onClick={onSelect}
    >
      <td className="px-2 py-2.5 text-center w-10" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onToggleCheck}
          className="h-3.5 w-3.5 rounded accent-orange-500 cursor-pointer"
        />
      </td>
      <td className="px-2 py-2.5 w-14"><StratBadge s={item.strategy} /></td>
      <td className="px-2 py-2.5 w-24">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-base">{item.symbol}</span>
          <span className="text-[10px] font-mono text-muted-foreground/60">{item.quantity}x</span>
        </div>
      </td>
      <td className="px-2 py-2.5 w-36">
        <div className="text-xs font-mono leading-tight">
          <span className="text-muted-foreground">${item.currentStrike.toFixed(0)}</span>
          <span className="text-muted-foreground/50 mx-1">·</span>
          <span className="text-muted-foreground/70">{item.currentExpiration.slice(5)}</span>
          <span className="text-muted-foreground/40 ml-1">({item.currentDte}d)</span>
        </div>
      </td>
      <td className="px-2 py-2.5 w-40">
        <div className="flex flex-col gap-0.5">
          {isBestFit && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-yellow-600/70 bg-yellow-400/20 text-yellow-900 dark:text-yellow-100 text-[9px] font-bold w-fit cursor-help">
                    <Star className="h-2 w-2 fill-yellow-600 text-yellow-600 dark:fill-yellow-300 dark:text-yellow-300" />
                    Best Fit
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs p-3 max-w-[220px] space-y-1.5">
                  <p className="font-semibold text-[11px] mb-1">⭐ Best Fit Score Breakdown</p>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between gap-3"><span className="opacity-70">Premium (40%)</span><span className="font-semibold">{bestFitScores?.premiumScore ?? '—'}/100</span></div>
                    <div className="flex justify-between gap-3"><span className="opacity-70">Strike safety (35%)</span><span className="font-semibold">{bestFitScores?.strikeScore ?? '—'}/100</span></div>
                    <div className="flex justify-between gap-3"><span className="opacity-70">DTE 30–45d (25%)</span><span className="font-semibold">{bestFitScores?.dteScore ?? '—'}/100</span></div>
                    <div className="flex justify-between gap-3 border-t border-border/40 pt-1 font-semibold"><span>Composite</span><span>{bestFitScores?.bestFitScore ?? '—'}/100</span></div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Orange indicator when selection differs from Best Fit */}
          {!isBestFit && item.bestFitCandidate && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/5 text-orange-400/70 text-[9px] font-medium w-fit cursor-help">
                    <Star className="h-2 w-2 text-orange-400/70" />
                    BF: ${(item.bestFitCandidate.strike ?? 0).toFixed(0)} {(item.bestFitCandidate.expiration ?? '').slice(5)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs p-3 max-w-[220px] space-y-1.5">
                  <p className="font-semibold text-[11px] mb-1">Best Fit Recommendation</p>
                  <p className="opacity-70 text-[10px]">Current selection differs from Best Fit</p>
                  {bestFitScores && (
                    <div className="space-y-1 text-[10px]">
                      <div className="flex justify-between gap-3"><span className="opacity-70">Premium (40%)</span><span className="font-semibold">{bestFitScores.premiumScore}/100</span></div>
                      <div className="flex justify-between gap-3"><span className="opacity-70">Strike safety (35%)</span><span className="font-semibold">{bestFitScores.strikeScore}/100</span></div>
                      <div className="flex justify-between gap-3"><span className="opacity-70">DTE 30–45d (25%)</span><span className="font-semibold">{bestFitScores.dteScore}/100</span></div>
                      <div className="flex justify-between gap-3 border-t border-border/40 pt-1 font-semibold"><span>Composite</span><span>{bestFitScores.bestFitScore}/100</span></div>
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isRoll && c.strike && c.expiration ? (
            <div className={`text-xs font-mono leading-tight ${isBestFit ? 'text-amber-600 dark:text-yellow-200' : 'text-orange-300'}`}>
              <span>${c.strike.toFixed(0)}</span>
              <span className="opacity-60 mx-1">·</span>
              <span>{c.expiration.slice(5)}</span>
              <span className="opacity-40 ml-1">({c.dte}d)</span>
              <span className="ml-1.5 text-muted-foreground/40 text-[9px]">#{c.score}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50 italic">close only</span>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5 w-36 text-right">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-end gap-0.5 cursor-help">
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
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              Per contract: <span className="font-mono font-semibold">{fmtSigned(isRoll ? c.netCredit : c.netPnl)}</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
      {/* ── Inline Bid/Ask Slider ── */}
      <td className="px-2 py-2.5 w-52" onClick={e => e.stopPropagation()}>
        {hasSlider ? (
          <div className="space-y-1">
            {/* Snap point labels */}
            <div className="flex justify-between text-[8px] text-muted-foreground/50 px-0.5">
              <span>Bid</span>
              <span>25%</span>
              <span>Mid</span>
              <span>75%</span>
              <span>Ask</span>
            </div>
            {/* Slider track */}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={sliderPos}
              onChange={e => onSliderChange(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ background: `linear-gradient(to right, #34d399 0%, #38bdf8 50%, #fbbf24 100%)` }}
            />
            {/* Live price + fill label */}
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-medium" style={{ color: fillColor }}>{fillLabelShort}</span>
              <span className={`text-[10px] font-mono font-bold ${(rowLimitPrice ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {rowLimitPrice !== undefined ? fmtSigned(rowLimitPrice) : fmtSigned(netTotal)}
              </span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/40 italic">no spread data</span>
        )}
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
            <SwapPanel item={item} onSwap={onSwap} onClose={() => setSwapOpen(false)} bestFitCandidate={item.bestFitCandidate} />
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RollOrderReviewModal({ open, onClose, items: initialItems, onSubmit, isSubmitting, bestFitCache }: Props) {
  const [items, setItems] = useState<RollOrderItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Checkbox selection: only checked rows are included in submission
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set(initialItems.map(i => i.positionId)));
  // Default: sort by DTE ascending (most time-critical positions first)
  const [sortKey, setSortKey] = useState<SortKey>('dte');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [liveCredits, setLiveCredits] = useState<Map<string, number | null>>(new Map());
  // Per-row slider positions: 0=bid, 50=mid, 100=ask
  const [rowSliderPositions, setRowSliderPositions] = useState<Map<string, number>>(() => new Map());

  const getSliderPos = (positionId: string) => rowSliderPositions.get(positionId) ?? 50;
  const setSliderPos = (positionId: string, pos: number) => {
    setRowSliderPositions(prev => {
      const next = new Map(prev);
      next.set(positionId, pos);
      return next;
    });
  };
  const batchSetSlider = (pos: number) => {
    setRowSliderPositions(() => {
      const next = new Map<string, number>();
      items.forEach(item => next.set(item.positionId, pos));
      return next;
    });
  };

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
    // Default: sort by current DTE ascending so most time-critical positions appear first
    setSortKey('dte');
    setSortDir('asc');
    setLiveCredits(new Map());
    setRefreshedAt(null);
    // Initialize all rows as checked
    setCheckedIds(new Set(initialItems.map(i => i.positionId)));
    // Reset all sliders to mid (50)
    setRowSliderPositions(new Map());
  }, [initialItems]);

  const selectedItem = useMemo(() => items.find(i => i.positionId === selectedId) ?? null, [items, selectedId]);

  const displayItems = useMemo(() => {
    if (sortKey === 'none') return items;
    return [...items].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortKey === 'dte') {
        // Sort by CURRENT position DTE (lowest first = most urgent — needs attention soonest)
        const dtea = a.currentDte ?? 999;
        const dteb = b.currentDte ?? 999;
        return sortDir === 'asc' ? dtea - dteb : dteb - dtea;
      } else if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
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

  // Only checked items are submitted
  const checkedItems = useMemo(() => items.filter(i => checkedIds.has(i.positionId)), [items, checkedIds]);
  const allChecked = items.length > 0 && items.every(i => checkedIds.has(i.positionId));
  const someChecked = items.some(i => checkedIds.has(i.positionId));

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setCheckedIds(prev => {
      if (prev.size === items.length) return new Set(); // deselect all
      return new Set(items.map(i => i.positionId)); // select all
    });
  }, [items]);

  const rollCount = checkedItems.filter(i => i.candidate.action === 'roll').length;
  const closeCount = checkedItems.filter(i => i.candidate.action === 'close').length;

  const totalNetCredit = useMemo(() => {
    return checkedItems.reduce((sum, item) => {
      const live = liveCredits.get(item.positionId);
      if (live !== undefined && live !== null) return sum + live;
      return sum + (calcNetTotal(item) ?? 0);
    }, 0);
  }, [checkedItems, liveCredits]);

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
    if (checkedItems.length === 0) { toast.warning('No positions selected — check at least one row to submit'); return; }
    await onSubmit(checkedItems, isDryRun);
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
          {/* Batch pricing toolbar */}
          <div className="flex items-center gap-2 px-4 py-1.5 bg-card/60 border-b border-border/30 shrink-0">
            <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mr-1">Set All:</span>
            <button
              onClick={() => batchSetSlider(5)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              ⚡ Fill Fast (Bid)
            </button>
            <button
              onClick={() => batchSetSlider(25)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border border-emerald-400/30 bg-emerald-400/5 text-emerald-300 hover:bg-emerald-400/15 transition-colors"
            >
              Near Bid (25%)
            </button>
            <button
              onClick={() => batchSetSlider(50)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
            >
              Mid (50%)
            </button>
            <button
              onClick={() => batchSetSlider(75)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15 transition-colors"
            >
              Near Ask (75%)
            </button>
            <button
              onClick={() => batchSetSlider(100)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              Max Credit (Ask)
            </button>
            <button
              onClick={() => batchSetSlider(50)}
              className="px-2 py-0.5 rounded text-[10px] font-medium border border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 transition-colors ml-auto"
            >
              Reset All
            </button>
          </div>
          {sortKey !== 'none' && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-orange-500/5 border-b border-orange-500/20 text-xs text-orange-300 shrink-0">
              <ArrowUpDown className="h-3 w-3" />
              <span>Sorted by <strong>{sortKey === 'dte' ? 'DTE (closest first)' : sortKey}</strong> ({sortDir}). Reorder arrows are disabled while sorted.</span>
              <button onClick={applySort} className="underline hover:no-underline ml-1">Apply as permanent order</button>
              <button onClick={() => { setSortKey('none'); setSortDir('asc'); }} className="underline hover:no-underline ml-2">Clear sort</button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className="min-w-[1020px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                  <tr className="border-b border-border/50">
                    <th className="px-2 py-2 text-center w-10" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 rounded accent-orange-500 cursor-pointer"
                        title={allChecked ? 'Deselect all' : 'Select all'}
                      />
                    </th>
                    <th className="px-2 py-2 text-left w-14"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Strat</span></th>
                    <th className="px-2 py-2 text-left w-24">
                      <SortHeader label="Symbol" sortKey="symbol" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 text-left w-36">
                      <SortHeader label="Current (DTE)" sortKey="dte" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 text-left w-40"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Roll Target</span></th>
                    <th className="px-2 py-2 text-right w-36">
                      <SortHeader label="Total" sortKey="total" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 text-left w-52"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Limit Price · Bid ←→ Ask</span></th>
                    <th className="px-2 py-2 text-left w-36"><span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Controls</span></th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="text-center py-16 text-muted-foreground text-sm">
                        No positions in queue. Close this panel and select positions to roll.
                      </td>
                    </tr>
                  ) : (
                    displayItems.map((item, idx) => {
                      const bfCandidate = item.bestFitCandidate;
                      const isBestFit = bfCandidate != null &&
                        item.candidate.strike === bfCandidate.strike &&
                        item.candidate.expiration === bfCandidate.expiration;
                      return (
                        <TableRow
                          key={item.positionId}
                          item={item}
                          index={idx}
                          total={displayItems.length}
                          isSelected={selectedId === item.positionId}
                          isChecked={checkedIds.has(item.positionId)}
                          isSorted={sortKey !== 'none'}
                          onSelect={() => setSelectedId(prev => prev === item.positionId ? null : item.positionId)}
                          onToggleCheck={() => toggleCheck(item.positionId)}
                          onRemove={() => handleRemove(item.positionId)}
                          onMoveUp={() => handleMoveUp(items.indexOf(item))}
                          onMoveDown={() => handleMoveDown(items.indexOf(item))}
                          onSwap={(ci) => handleSwap(item.positionId, ci)}
                          onPriceChange={(p) => handlePriceChange(item.positionId, p)}
                          refreshedCredit={liveCredits.get(item.positionId)}
                          isBestFit={isBestFit}
                          bestFitScores={item.bestFitScores}
                          sliderPos={getSliderPos(item.positionId)}
                          onSliderChange={(pos) => setSliderPos(item.positionId, pos)}
                        />
                      );
                    })
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
            onSubmitOne={async (singleItem, isDryRun) => {
              await onSubmit([singleItem], isDryRun);
            }}
            isSubmitting={isSubmitting}
            initialSliderPos={getSliderPos(selectedItem.positionId)}
            onSliderChange={(positionId, pos) => setSliderPos(positionId, pos)}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border/50 bg-card/80 shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{checkedItems.length}</span>
            <span className="text-muted-foreground/50">/{items.length}</span> order{items.length !== 1 ? 's' : ''} selected
          </span>
          {checkedItems.length > 0 && (
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
            disabled={isSubmitting || checkedItems.length === 0}
            className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
            Dry Run
          </Button>
          <Button
            size="sm"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting || checkedItems.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white font-semibold min-w-[160px]"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Submit {checkedItems.length} Order{checkedItems.length !== 1 ? 's' : ''}
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
