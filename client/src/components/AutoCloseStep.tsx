/**
 * AutoCloseStep — Step 5 of Daily Actions
 *
 * Shows ALL open short option positions across all accounts.
 * Each row has an explicit "Monitor" button to opt in with three bracket conditions:
 *   1. Profit Target % — close when P/L reaches this level
 *   2. Stop Loss %     — close when loss reaches X% of premium collected (e.g. 200 = 2× premium)
 *   3. DTE Floor       — close when days-to-expiration ≤ this value
 * Filter tabs: All | Monitored (GTC set) | Not Monitored
 * Global Defaults panel: set default bracket values that pre-fill every new row.
 */

import { useState, useEffect, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { skipToken } from '@tanstack/react-query';
import { AutoCloseLogTab } from './AutoCloseLogTab';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  Loader2, Play, RefreshCw, CheckCircle, XCircle, Clock,
  AlertTriangle, Eye, EyeOff, BellRing, BellOff, ShieldAlert, Settings2, Save,
  CheckSquare, X, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Star, Info,
  ChevronUp, ChevronDown, ChevronsUpDown
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

type ProfitTargetPct = 25 | 50 | 75 | 90;
type FilterTab = 'all' | 'monitored' | 'unmonitored';
type SortKey = 'symbol' | 'strike' | 'expiration' | 'accountNumber' | 'quantity' | 'averageOpenPrice' | 'profitPct' | 'dte' | 'rollScore';
type SortDir = 'asc' | 'desc';

// Stop-loss options: 100% = 1× premium, 200% = 2× premium, etc.
const STOP_LOSS_OPTIONS = [
  { label: 'Off',  value: null },
  { label: '100%', value: 100 },
  { label: '150%', value: 150 },
  { label: '200%', value: 200 },
  { label: '300%', value: 300 },
];

// DTE floor options
const DTE_FLOOR_OPTIONS = [
  { label: 'Off', value: null },
  { label: '3',   value: 3 },
  { label: '5',   value: 5 },
  { label: '7',   value: 7 },
  { label: '14',  value: 14 },
  { label: '21',  value: 21 },
];

interface ScanDetail {
  symbol: string;
  status: 'closed' | 'skipped' | 'error';
  profitPct?: number;
  message?: string;
}

interface ScanResult {
  scanned: number;
  closed: number;
  skipped: number;
  errors: number;
  details: ScanDetail[];
  ranAt: Date;
}

/** Per-row bracket settings tracked in local state */
interface RowBracket {
  profitTargetPct: ProfitTargetPct;
  stopLossPct: number | null;
  dteFloor: number | null;
}

/** Position passed to the Roll dialog */
interface RollTarget {
  symbol: string;
  optionSymbol: string;
  optionType: 'C' | 'P';
  strike: string;
  expiration: string;
  quantity: number;
  averageOpenPrice: string; // open premium per share
  currentMark: string;      // current BTC cost per share
  accountNumber: string;
  dte: number;
}

export default function AutoCloseStep() {
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState<'monitor' | 'log'>('monitor');
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  // Per-row bracket settings — keyed by "accountId::optionSymbol"
  const [rowBrackets, setRowBrackets] = useState<Record<string, RowBracket>>({});

  // Per-row pending mutation state
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());

  // Row selection state for bulk Apply to Selected
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [applySelectedProfitPct, setApplySelectedProfitPct] = useState<ProfitTargetPct>(50);
  const [applySelectedStopLoss, setApplySelectedStopLoss] = useState<number | null>(null);
  const [applySelectedDteFloor, setApplySelectedDteFloor] = useState<number | null>(null);
  // Sort state — default to Roll Score descending (highest urgency first)
  const [sortKey, setSortKey] = useState<SortKey>('rollScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'rollScore' || key === 'profitPct' ? 'desc' : 'asc');
    }
  }

  // Global defaults panel state
  const [showDefaults, setShowDefaults] = useState(false);
  const [defaultProfitPct, setDefaultProfitPct] = useState<ProfitTargetPct>(50);
  const [defaultStopLoss, setDefaultStopLoss] = useState<number | null>(null);
  const [defaultDteFloor, setDefaultDteFloor] = useState<number | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: positions, isLoading: posLoading, refetch } = trpc.autoClose.listOpenShortPositions.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: bracketDefaults } = trpc.autoClose.getBracketDefaults.useQuery();

  // Sync global defaults from server into local state
  useEffect(() => {
    if (bracketDefaults) {
      setDefaultProfitPct((bracketDefaults.profitTargetPct as ProfitTargetPct) ?? 50);
      setDefaultStopLoss(bracketDefaults.stopLossPct ?? null);
      setDefaultDteFloor(bracketDefaults.dteFloor ?? null);
    }
  }, [bracketDefaults]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const setTargetMut = trpc.autoClose.setTarget.useMutation({
    onSuccess: (_, vars) => {
      const key = `${vars.accountId}::${vars.optionSymbol.replace(/\s+/g, '')}`;
      setPendingRows(prev => { const s = new Set(prev); s.delete(key); return s; });
      refetch();
    },
    onError: (err, vars) => {
      const key = `${vars.accountId}::${vars.optionSymbol.replace(/\s+/g, '')}`;
      setPendingRows(prev => { const s = new Set(prev); s.delete(key); return s; });
      toast({ title: 'Error saving target', description: err.message, variant: 'destructive' });
    },
  });

  const removeMut = trpc.autoClose.removeTarget.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast({ title: 'Error removing target', description: err.message, variant: 'destructive' }),
  });

  const runNowMut = trpc.autoClose.runNow.useMutation({
    onSuccess: (result) => {
      setLastScanResult({ ...result, ranAt: new Date() });
      refetch();
      if (result.closed > 0) {
        toast({
          title: `✅ Auto-Close: ${result.closed} position(s) closed`,
          description: result.details
            .filter((d: ScanDetail) => d.status === 'closed')
            .map((d: ScanDetail) => d.symbol)
            .join(', '),
        });
      } else {
        toast({
          title: 'Scan complete',
          description: `${result.scanned} position(s) checked — none at target yet.`,
        });
      }
    },
    onError: (err) => toast({ title: 'Scan failed', description: err.message, variant: 'destructive' }),
  });

  const setDefaultsMut = trpc.autoClose.setBracketDefaults.useMutation({
    onSuccess: () => {
      toast({ title: 'Defaults saved', description: 'New positions will pre-fill with these values.' });
      setShowDefaults(false);
    },
    onError: (err) => toast({ title: 'Error saving defaults', description: err.message, variant: 'destructive' }),
  });

  const bulkApplyDefaultsMut = trpc.autoClose.bulkApplyDefaults.useMutation({
    onSuccess: (result) => {
      refetch();
      toast({
        title: `Applied to all ${result.count} monitored position${result.count !== 1 ? 's' : ''}`,
        description: `Profit: ${defaultProfitPct}%${defaultStopLoss ? ` | Stop: ${defaultStopLoss}%` : ''}${defaultDteFloor ? ` | DTE ≤ ${defaultDteFloor}` : ''}`,
      });
    },
    onError: (err) => toast({ title: 'Error applying defaults', description: err.message, variant: 'destructive' }),
  });

  const bulkApplySelectedMut = trpc.autoClose.bulkApplyDefaults.useMutation({
    onSuccess: (result) => {
      refetch();
      setSelectedRows(new Set());
      toast({
        title: `Profit target updated on ${result.count} position${result.count !== 1 ? 's' : ''}`,
        description: `Set to ${applySelectedProfitPct}%`,
      });
    },
    onError: (err) => toast({ title: 'Error applying to selected', description: err.message, variant: 'destructive' }),
  });
  const notifyOptInMut = trpc.autoClose.notifyOptIn.useMutation();
  // ── Roll dialog state ─────────────────────────────────────────────────────
  const [rollTarget, setRollTarget] = useState<RollTarget | null>(null);
  const [selectedRollIdx, setSelectedRollIdx] = useState<number | null>(null);

  const rollCandidatesQuery = trpc.rolls.getRollCandidates.useQuery(
    rollTarget ? {
      symbol: rollTarget.symbol,
      strategy: rollTarget.optionType === 'P' ? 'csp' : 'cc',
      strikePrice: parseFloat(rollTarget.strike),
      expirationDate: rollTarget.expiration,
      currentValue: parseFloat(rollTarget.currentMark),
      openPremium: parseFloat(rollTarget.averageOpenPrice),
      quantity: rollTarget.quantity,
      positionId: rollTarget.optionSymbol,
    } : skipToken,
    { staleTime: 60_000 }
  );

  const submitRollMut = trpc.rolls.submitRollOrders.useMutation({
    onSuccess: (result) => {
      const isDry = rollDryRun;
      toast({
        title: isDry ? 'Roll dry-run passed ✓' : `Roll submitted for ${rollTarget?.symbol}`,
        description: isDry
          ? 'Order validated — toggle off Dry Run to submit live.'
          : 'BTC + STO spread order sent to Tastytrade.',
      });
      if (!isDry) {
        setRollTarget(null);
        setSelectedRollIdx(null);
        refetch();
      }
    },
    onError: (err) => toast({ title: 'Roll failed', description: err.message, variant: 'destructive' }),
  });

  const [rollDryRun, setRollDryRun] = useState(true);

  // Best net credit index among roll candidates
  const bestCreditIdx = useMemo(() => {
    const candidates = rollCandidatesQuery.data?.candidates;
    if (!candidates || candidates.length === 0) return null;
    let best = -1;
    let bestCredit = -Infinity;
    candidates.forEach((c: { action: string; netCredit?: number | null }, i: number) => {
      if (c.action === 'roll' && (c.netCredit ?? -Infinity) > bestCredit) {
        bestCredit = c.netCredit ?? -Infinity;
        best = i;
      }
    });
    return best >= 0 ? best : null;
  }, [rollCandidatesQuery.data]);

  const [bulkPending, setBulkPending] = useState(false);
  const bulkSetTargetsMut = trpc.autoClose.bulkSetTargets.useMutation({
    onSuccess: (result) => {
      setBulkPending(false);
      refetch();
      toast({
        title: `Monitor All: ${result.count} position${result.count !== 1 ? 's' : ''} opted in`,
        description: result.count > 0
          ? `Using defaults: ${defaultProfitPct}% profit${defaultStopLoss ? ` | ${defaultStopLoss}% stop` : ''}${defaultDteFloor ? ` | DTE ≤ ${defaultDteFloor}` : ''}. Telegram notification sent.`
          : 'All unmonitored positions were already opted in.',
      });
    },
    onError: (err) => {
      setBulkPending(false);
      toast({ title: 'Bulk monitor failed', description: err.message, variant: 'destructive' });
    },
  });
  function handleMonitorAll() {
    const unmonitored = allPositions.filter(p => !p.targetEnabled);
    if (unmonitored.length === 0) {
      toast({ title: 'All positions already monitored', description: 'No unmonitored positions to opt in.' });
      return;
    }
    setBulkPending(true);
    bulkSetTargetsMut.mutate({
      positions: unmonitored.map(p => ({
        accountId: p.accountId,
        accountNumber: p.accountNumber,
        optionSymbol: p.optionSymbol,
        symbol: p.symbol,
        optionType: p.optionType,
        strike: p.strike,
        expiration: p.expiration,
        averageOpenPrice: p.averageOpenPrice,
        quantity: p.quantity,
      })),
      profitTargetPct: defaultProfitPct,
      stopLossPct: defaultStopLoss,
      dteFloor: defaultDteFloor,
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Get the effective bracket settings for a row — local state wins over server values, then global defaults */
  function getEffectiveBracket(rowKey: string, pos: NonNullable<typeof positions>[number]): RowBracket {
    if (rowBrackets[rowKey]) return rowBrackets[rowKey];
    // If position already has a target, use its saved values
    if (pos.profitTargetPct != null) {
      return {
        profitTargetPct: (pos.profitTargetPct as ProfitTargetPct),
        stopLossPct: pos.stopLossPct ?? null,
        dteFloor: pos.dteFloor ?? null,
      };
    }
    // Otherwise pre-fill from global defaults
    return {
      profitTargetPct: defaultProfitPct,
      stopLossPct: defaultStopLoss,
      dteFloor: defaultDteFloor,
    };
  }

  function updateBracket(rowKey: string, partial: Partial<RowBracket>, pos: NonNullable<typeof positions>[number]) {
    const current = getEffectiveBracket(rowKey, pos);
    const updated = { ...current, ...partial };
    setRowBrackets(prev => ({ ...prev, [rowKey]: updated }));

    // If already opted in, persist the change to the server right away
    if (pos.targetEnabled) {
      setPendingRows(prev => new Set(prev).add(rowKey));
      setTargetMut.mutate({
        accountId: pos.accountId,
        accountNumber: pos.accountNumber,
        symbol: pos.symbol,
        optionSymbol: pos.optionSymbol,
        optionType: pos.optionType,
        strike: pos.strike,
        expiration: pos.expiration,
        quantity: pos.quantity,
        premiumCollected: pos.averageOpenPrice,
        profitTargetPct: updated.profitTargetPct,
        stopLossPct: updated.stopLossPct,
        dteFloor: updated.dteFloor,
        strategy: pos.optionType === 'P' ? 'csp' : 'cc',
      });
    }
  }

  function handleOptIn(pos: NonNullable<typeof positions>[number], bracket: RowBracket) {
    const key = `${pos.accountId}::${pos.optionSymbol.replace(/\s+/g, '')}`;
    setPendingRows(prev => new Set(prev).add(key));
    setTargetMut.mutate({
      accountId: pos.accountId,
      accountNumber: pos.accountNumber,
      symbol: pos.symbol,
      optionSymbol: pos.optionSymbol,
      optionType: pos.optionType,
      strike: pos.strike,
      expiration: pos.expiration,
      quantity: pos.quantity,
      premiumCollected: pos.averageOpenPrice,
      profitTargetPct: bracket.profitTargetPct,
      stopLossPct: bracket.stopLossPct,
      dteFloor: bracket.dteFloor,
      strategy: pos.optionType === 'P' ? 'csp' : 'cc',
    });
    // Send Telegram bracket summary
    notifyOptInMut.mutate({
      symbol: pos.symbol,
      optionType: pos.optionType,
      strike: pos.strike,
      expiration: pos.expiration,
      profitTargetPct: bracket.profitTargetPct,
      stopLossPct: bracket.stopLossPct,
      dteFloor: bracket.dteFloor,
    });
    const parts = [`${bracket.profitTargetPct}% profit target`];
    if (bracket.stopLossPct) parts.push(`${bracket.stopLossPct}% stop loss`);
    if (bracket.dteFloor)    parts.push(`${bracket.dteFloor} DTE floor`);
    toast({
      title: `Monitoring ${pos.symbol}`,
      description: `Bracket: ${parts.join(' | ')} — Telegram notification sent.`,
    });
  }

  function handleOptOut(pos: NonNullable<typeof positions>[number]) {
    if (pos.targetId) {
      removeMut.mutate({ id: pos.targetId });
      toast({
        title: `Stopped monitoring ${pos.symbol}`,
        description: 'Auto-close disabled for this position.',
      });
    }
  }

  function statusBadge(status?: string) {
    switch (status) {
      case 'watching':  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">Watching</Badge>;
      case 'triggered': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Triggered</Badge>;
      case 'closed':    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Closed</Badge>;
      case 'expired':   return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs">Expired</Badge>;
      case 'error':     return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Error</Badge>;
      default:          return null;
    }
  }

  const allPositions = positions ?? [];
  const monitoredCount   = allPositions.filter(p => p.targetEnabled).length;
  const unmonitoredCount = allPositions.filter(p => !p.targetEnabled).length;

  const filteredPositions = useMemo(() => {
    const base = allPositions.filter(p => {
      if (filterTab === 'monitored')   return p.targetEnabled;
      if (filterTab === 'unmonitored') return !p.targetEnabled;
      return true;
    });
    return [...base].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case 'symbol':           av = a.symbol;                          bv = b.symbol;           break;
        case 'strike':           av = parseFloat(a.strike);              bv = parseFloat(b.strike); break;
        case 'expiration':       av = a.expiration;                      bv = b.expiration;       break;
        case 'accountNumber':    av = a.accountNumber;                   bv = b.accountNumber;    break;
        case 'quantity':         av = a.quantity;                        bv = b.quantity;         break;
        case 'averageOpenPrice': av = parseFloat(a.averageOpenPrice);    bv = parseFloat(b.averageOpenPrice); break;
        case 'profitPct':        av = a.profitPct;                       bv = b.profitPct;        break;
        case 'dte':              av = a.dte;                             bv = b.dte;              break;
        case 'rollScore':        av = a.rollScore ?? -1;                 bv = b.rollScore ?? -1;  break;
        default:                 av = 0; bv = 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [allPositions, filterTab, sortKey, sortDir]);

  const filterTabs: { id: FilterTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'all',          label: 'All Positions', count: allPositions.length,  icon: null },
    { id: 'monitored',    label: 'Monitored',     count: monitoredCount,        icon: <Eye className="h-3.5 w-3.5" /> },
    { id: 'unmonitored',  label: 'Not Monitored', count: unmonitoredCount,      icon: <EyeOff className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      {/* ── Top-level tab switcher ─────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-gray-800">
        <button
          onClick={() => setMainTab('monitor')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            mainTab === 'monitor'
              ? 'border-orange-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Monitor
        </button>
        <button
          onClick={() => setMainTab('log')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            mainTab === 'log'
              ? 'border-orange-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Execution Log
        </button>
      </div>

      {/* ── Execution Log tab ─────────────────────────────────────── */}
      {mainTab === 'log' && <AutoCloseLogTab />}

      {/* ── Monitor tab ────────────────────────────────────────────── */}
      {mainTab === 'monitor' && <>

      {/* ── Global Bracket Defaults panel ─────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/60">
        <button
          onClick={() => setShowDefaults(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-gray-400" />
            <span className="font-medium">Global Bracket Defaults</span>
            <span className="text-xs text-gray-500">— pre-fill values for new positions</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Show current defaults as pills */}
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300">
              Profit: {defaultProfitPct}%
            </span>
            {defaultStopLoss != null && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">
                Stop: {defaultStopLoss}%
              </span>
            )}
            {defaultDteFloor != null && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300">
                DTE ≤ {defaultDteFloor}
              </span>
            )}
            <span className="text-xs text-gray-500">{showDefaults ? '▲' : '▼'}</span>
          </div>
        </button>

        {showDefaults && (
          <div className="border-t border-gray-700 px-4 py-4">
            <p className="text-xs text-gray-400 mb-4">
              These values pre-fill the bracket dropdowns for every unmonitored position. They do not automatically opt in any position — you still click <strong className="text-orange-400">Monitor</strong> to activate.
            </p>
            <div className="flex items-end gap-4 flex-wrap">
              {/* Default Profit Target — pre-fill only, no bulk apply */}
              <div className="space-y-1.5">
                <label className="text-xs text-orange-300 font-medium">Default Profit Target</label>
                <p className="text-[10px] text-gray-500">pre-fill only</p>
                <Select
                  value={String(defaultProfitPct)}
                  onValueChange={(v) => setDefaultProfitPct(parseInt(v) as ProfitTargetPct)}
                >
                  <SelectTrigger className="w-[90px] h-8 text-xs bg-gray-800 border-orange-500/30 text-orange-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="25">25%</SelectItem>
                    <SelectItem value="50">50% ★</SelectItem>
                    <SelectItem value="75">75%</SelectItem>
                    <SelectItem value="90">90%</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Default Stop Loss — with per-field Apply to All */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-red-300 font-medium">Default Stop Loss</label>
                  <button
                    onClick={() => {
                      if (!window.confirm(
                        `Apply Stop Loss: ${defaultStopLoss == null ? 'Off' : defaultStopLoss + '%'} to ALL monitored positions?\nThis will overwrite individual stop loss settings.`
                      )) return;
                      bulkApplyDefaultsMut.mutate({ stopLossPct: defaultStopLoss });
                    }}
                    disabled={bulkApplyDefaultsMut.isPending}
                    title="Apply this stop loss to all monitored positions"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 disabled:opacity-50 transition-colors"
                  >
                    {bulkApplyDefaultsMut.isPending
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <span>⚡</span>
                    }
                    Apply to All
                  </button>
                </div>
                <Select
                  value={defaultStopLoss == null ? 'off' : String(defaultStopLoss)}
                  onValueChange={(v) => setDefaultStopLoss(v === 'off' ? null : parseInt(v))}
                >
                  <SelectTrigger className="w-[110px] h-8 text-xs bg-gray-800 border-red-500/30 text-red-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    {STOP_LOSS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value ?? 'off'} value={opt.value == null ? 'off' : String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Default DTE Floor — with per-field Apply to All */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-yellow-300 font-medium">Default DTE Floor</label>
                  <button
                    onClick={() => {
                      if (!window.confirm(
                        `Apply DTE Floor: ${defaultDteFloor == null ? 'Off' : '≤ ' + defaultDteFloor + 'd'} to ALL monitored positions?\nThis will overwrite individual DTE floor settings.`
                      )) return;
                      bulkApplyDefaultsMut.mutate({ dteFloor: defaultDteFloor });
                    }}
                    disabled={bulkApplyDefaultsMut.isPending}
                    title="Apply this DTE floor to all monitored positions"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 disabled:opacity-50 transition-colors"
                  >
                    {bulkApplyDefaultsMut.isPending
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <span>⚡</span>
                    }
                    Apply to All
                  </button>
                </div>
                <Select
                  value={defaultDteFloor == null ? 'off' : String(defaultDteFloor)}
                  onValueChange={(v) => setDefaultDteFloor(v === 'off' ? null : parseInt(v))}
                >
                  <SelectTrigger className="w-[110px] h-8 text-xs bg-gray-800 border-yellow-500/30 text-yellow-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    {DTE_FLOOR_OPTIONS.map(opt => (
                      <SelectItem key={opt.value ?? 'off'} value={opt.value == null ? 'off' : String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                onClick={() => setDefaultsMut.mutate({
                  profitTargetPct: defaultProfitPct,
                  stopLossPct: defaultStopLoss,
                  dteFloor: defaultDteFloor,
                })}
                disabled={setDefaultsMut.isPending}
                className="bg-orange-600 hover:bg-orange-500 text-white h-8 text-xs self-end"
              >
                {setDefaultsMut.isPending
                  ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : <Save className="h-3.5 w-3.5 mr-1.5" />
                }
                Save Defaults
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Auto-Close Monitor</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            Set a <strong className="text-orange-400">profit target</strong>,{' '}
            <strong className="text-red-400">stop loss</strong>, and/or{' '}
            <strong className="text-yellow-400">DTE floor</strong>,{' '}
            then click <strong className="text-orange-400">Monitor</strong> to activate.
            The first condition hit triggers the BTC order.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-gray-700 text-gray-300 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button
            onClick={() => runNowMut.mutate()}
            disabled={runNowMut.isPending || monitoredCount === 0}
            className="bg-orange-600 hover:bg-orange-500 text-white"
          >
            {runNowMut.isPending
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Play className="h-4 w-4 mr-2" />
            }
            Run Now
          </Button>
        </div>
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="text-gray-400">
          <span className="text-white font-medium">{monitoredCount}</span>{' '}
          position{monitoredCount !== 1 ? 's' : ''} being monitored
        </span>
        <span className="text-gray-600">•</span>
        <span className="text-gray-400">
          Scans every <span className="text-white font-medium">5 min</span> Mon–Fri 9:30–4:00 PM ET
        </span>
        {lastScanResult && (
          <>
            <span className="text-gray-600">•</span>
            <span className="text-gray-400">
              Last run:{' '}
              <span className="text-white font-medium">{lastScanResult.ranAt.toLocaleTimeString()}</span>
            </span>
          </>
        )}
      </div>

      {/* ── Bracket legend ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-3">
        <ShieldAlert className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-200/80 space-y-1">
          <p><strong className="text-blue-300">Bracket order — three independent conditions (first hit wins):</strong></p>
          <p>
            <span className="text-orange-300 font-medium">Profit Target %</span> — close when the position has gained this % of the original premium (e.g. 50% = half the premium decayed away).
          </p>
          <p>
            <span className="text-red-300 font-medium">Stop Loss %</span> — close when the current mark is X% above the premium collected (e.g. 200% = the option is now worth 2× what you collected — you are losing 2× your credit).
          </p>
          <p>
            <span className="text-yellow-300 font-medium">DTE Floor</span> — close when days-to-expiration drops to or below this value, regardless of P/L (avoids gamma risk near expiry).
          </p>
        </div>
      </div>

      {/* ── Filter tabs ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-0">
        <div className="flex items-center gap-1">
          {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilterTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px ${
              filterTab === tab.id
                ? 'border-orange-500 text-orange-400 bg-orange-500/5'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
            }`}
          >
            {tab.icon}
            {tab.label}
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${
              filterTab === tab.id ? 'bg-orange-500/20 text-orange-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
        </div>
        {/* Select All / Clear All buttons */}
        <div className="flex items-center gap-1.5 mb-1">
          <button
            onClick={() => setSelectedRows(new Set(filteredPositions.map(p => `${p.accountId}::${p.optionSymbol.replace(/\s+/g, '')}`)))}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 border border-blue-500/30 transition-colors"
          >
            <CheckSquare className="h-3 w-3" />
            Select All
          </button>
          {selectedRows.size > 0 && (
            <button
              onClick={() => setSelectedRows(new Set())}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-700/50 text-gray-300 hover:bg-gray-700 border border-gray-600/50 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear All
            </button>
          )}
        </div>
        {/* Monitor All button */}
        {unmonitoredCount > 0 && (
          <button
            onClick={handleMonitorAll}
            disabled={bulkPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-1"
          >
            {bulkPending
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Opting in…</>
              : <><Eye className="h-3 w-3" /> Monitor All ({unmonitoredCount})</>
            }
          </button>
        )}
      </div>

      {/* ── Positions table ────────────────────────────────────────────── */}
      {posLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading positions from Tastytrade…
        </div>
      ) : allPositions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-base">No open short option positions found.</p>
          <p className="text-sm mt-1">
            Open a CSP, CC, or spread position first, then return here to set a bracket.
          </p>
        </div>
      ) : filteredPositions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">
            {filterTab === 'monitored'
              ? 'No positions are currently being monitored. Click "Monitor" on any position.'
              : 'All positions are being monitored.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
        {/* -- Apply to Selected action bar -- */}
        {selectedRows.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 mb-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <span className="text-xs text-orange-300 font-medium">{selectedRows.size} selected</span>
            <span className="text-gray-600">·</span>
            {/* Profit Target */}
            <span className="text-xs text-gray-400">Profit Target:</span>
            <Select
              value={String(applySelectedProfitPct)}
              onValueChange={(v) => setApplySelectedProfitPct(parseInt(v) as ProfitTargetPct)}
            >
              <SelectTrigger className="w-[80px] h-7 text-xs bg-gray-800 border-orange-500/40 text-orange-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="25">25%</SelectItem>
                <SelectItem value="50">50%</SelectItem>
                <SelectItem value="75">75%</SelectItem>
                <SelectItem value="90">90%</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-gray-700">|</span>
            {/* Stop Loss */}
            <span className="text-xs text-gray-400">Stop Loss:</span>
            <Select
              value={applySelectedStopLoss === null ? 'off' : String(applySelectedStopLoss)}
              onValueChange={(v) => setApplySelectedStopLoss(v === 'off' ? null : parseInt(v))}
            >
              <SelectTrigger className="w-[90px] h-7 text-xs bg-gray-800 border-gray-600 text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="100">100%</SelectItem>
                <SelectItem value="150">150%</SelectItem>
                <SelectItem value="200">200%</SelectItem>
                <SelectItem value="300">300%</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-gray-700">|</span>
            {/* DTE Floor */}
            <span className="text-xs text-gray-400">DTE Floor:</span>
            <Select
              value={applySelectedDteFloor === null ? 'off' : String(applySelectedDteFloor)}
              onValueChange={(v) => setApplySelectedDteFloor(v === 'off' ? null : parseInt(v))}
            >
              <SelectTrigger className="w-[80px] h-7 text-xs bg-gray-800 border-gray-600 text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="7">7</SelectItem>
                <SelectItem value="14">14</SelectItem>
                <SelectItem value="21">21</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={() => {
                bulkApplySelectedMut.mutate({
                  profitTargetPct: applySelectedProfitPct,
                  stopLossPct: applySelectedStopLoss,
                  dteFloor: applySelectedDteFloor,
                  rowKeys: Array.from(selectedRows),
                });
              }}
              disabled={bulkApplySelectedMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/40 transition-colors disabled:opacity-50"
            >
              Apply to Selected
            </button>
            <button
              onClick={() => setSelectedRows(new Set())}
              className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Clear Selection
            </button>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                {/* Select All checkbox */}
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    className="rounded border-gray-600 bg-gray-800 accent-orange-500 cursor-pointer"
                    checked={filteredPositions.length > 0 && filteredPositions.every(p => {
                      const k = `${p.accountId}::${p.optionSymbol.replace(/\s+/g, '')}`;
                      return selectedRows.has(k);
                    })}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRows(new Set(filteredPositions.map(p => `${p.accountId}::${p.optionSymbol.replace(/\s+/g, '')}`)));
                      } else {
                        setSelectedRows(new Set());
                      }
                    }}
                  />
                </th>
                {/* Sortable column headers */}
                {([
                  { key: 'symbol',           label: 'Symbol',      align: 'left'   },
                  { key: 'strike',           label: 'Strike / Exp',align: 'left'   },
                  { key: 'accountNumber',    label: 'Acct',        align: 'left'   },
                  { key: 'quantity',         label: 'Qty',         align: 'right'  },
                  { key: 'averageOpenPrice', label: 'Open $',      align: 'right'  },
                  { key: 'profitPct',        label: 'P/L %',       align: 'right'  },
                  { key: 'dte',              label: 'DTE',         align: 'right'  },
                ] as { key: SortKey; label: string; align: string }[]).map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-3 py-3 font-medium text-xs cursor-pointer select-none group ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${sortKey === col.key ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      {col.label}
                      {sortKey === col.key
                        ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-orange-400" /> : <ChevronDown className="h-3 w-3 text-orange-400" />)
                        : <ChevronsUpDown className="h-3 w-3 opacity-30 group-hover:opacity-60" />}
                    </span>
                  </th>
                ))}
                {/* Bracket columns — not sortable */}
                <th className="text-center px-3 py-3 text-orange-400/80 font-medium text-xs">
                  <div>Profit</div><div>Target</div>
                </th>
                <th className="text-center px-3 py-3 text-red-400/80 font-medium text-xs">
                  <div>Stop</div><div>Loss</div>
                </th>
                <th className="text-center px-3 py-3 text-yellow-400/80 font-medium text-xs">
                  <div>DTE</div><div>Floor</div>
                </th>
                {/* Roll Urgency Score — sortable */}
                <th
                  onClick={() => handleSort('rollScore')}
                  className={`text-center px-2 py-3 font-medium text-xs min-w-[80px] cursor-pointer select-none group ${
                    sortKey === 'rollScore' ? 'text-white' : 'text-purple-400/80 hover:text-purple-300'
                  }`}
                >
                  <span className="inline-flex flex-col items-center gap-0">
                    <span className="flex items-center gap-1">
                      Roll
                      {sortKey === 'rollScore'
                        ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-orange-400" /> : <ChevronDown className="h-3 w-3 text-orange-400" />)
                        : <ChevronsUpDown className="h-3 w-3 opacity-30 group-hover:opacity-60" />}
                    </span>
                    <span>Score</span>
                  </span>
                </th>
                <th className="text-center px-3 py-3 text-gray-400 font-medium min-w-[160px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPositions.map((pos) => {
                const rowKey    = `${pos.accountId}::${pos.optionSymbol.replace(/\s+/g, '')}`;
                const isEnabled = pos.targetEnabled ?? false;
                const bracket   = getEffectiveBracket(rowKey, pos);
                const atTarget  = pos.profitPct >= bracket.profitTargetPct;
                const isPending = pendingRows.has(rowKey);

                return (
                  <tr
                    key={rowKey}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors ${
                      isEnabled ? 'bg-green-950/10 border-l-2 border-l-green-500/40' : ''
                    }`}
                  >
                    {/* Row checkbox */}
                    <td className="px-3 py-3 w-8">
                      <input
                        type="checkbox"
                        className="rounded border-gray-600 bg-gray-800 accent-orange-500 cursor-pointer"
                        checked={selectedRows.has(rowKey)}
                        onChange={(e) => {
                          setSelectedRows(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(rowKey); else next.delete(rowKey);
                            return next;
                          });
                        }}
                      />
                    </td>
                    {/* Symbol */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{pos.symbol}</span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            pos.optionType === 'P'
                              ? 'border-red-500/40 text-red-400'
                              : 'border-blue-500/40 text-blue-400'
                          }`}
                        >
                          {pos.optionType === 'P' ? 'Put' : 'Call'}
                        </Badge>
                      </div>
                    </td>

                    {/* Strike / Exp */}
                    <td className="px-3 py-3 text-gray-300">
                      <div>${pos.strike}</div>
                      <div className="text-xs text-gray-500">{pos.expiration}</div>
                    </td>

                    {/* Account */}
                    <td className="px-3 py-3 text-gray-400 text-xs">{pos.accountNumber}</td>

                    {/* Qty */}
                    <td className="px-3 py-3 text-right text-gray-300">{pos.quantity}</td>

                    {/* Open price */}
                    <td className="px-3 py-3 text-right text-gray-300">
                      ${parseFloat(pos.averageOpenPrice).toFixed(2)}
                    </td>

                    {/* P/L % */}
                    <td className="px-3 py-3 text-right">
                      <span className={`font-medium ${
                        pos.profitPct >= 50
                          ? 'text-green-400'
                          : pos.profitPct >= 25
                            ? 'text-yellow-400'
                            : pos.profitPct < 0
                              ? 'text-red-400'
                              : 'text-gray-400'
                      }`}>
                        {pos.profitPct.toFixed(1)}%
                      </span>
                      {atTarget && isEnabled && (
                        <div className="text-xs text-green-400 mt-0.5 font-medium animate-pulse">
                          At target!
                        </div>
                      )}
                    </td>

                    {/* DTE */}
                    <td className="px-3 py-3 text-right">
                      <span className={`${
                        pos.dte <= 7 ? 'text-red-400' : pos.dte <= 21 ? 'text-yellow-400' : 'text-gray-300'
                      }`}>
                        {pos.dte}
                      </span>
                    </td>

                    {/* ── Profit Target % picker ───────────────────────── */}
                    <td className="px-3 py-3 text-center">
                      <Select
                        value={String(bracket.profitTargetPct)}
                        onValueChange={(v) =>
                          updateBracket(rowKey, { profitTargetPct: parseInt(v) as ProfitTargetPct }, pos)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-[82px] h-7 text-xs bg-gray-800 border-orange-500/30 text-orange-300 mx-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-900 border-gray-700">
                          <SelectItem value="25">25%</SelectItem>
                          <SelectItem value="50">50% ★</SelectItem>
                          <SelectItem value="75">75%</SelectItem>
                          <SelectItem value="90">90%</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>

                    {/* ── Stop Loss % picker ───────────────────────────── */}
                    <td className="px-3 py-3 text-center">
                      <Select
                        value={bracket.stopLossPct == null ? 'off' : String(bracket.stopLossPct)}
                        onValueChange={(v) =>
                          updateBracket(rowKey, { stopLossPct: v === 'off' ? null : parseInt(v) }, pos)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-[82px] h-7 text-xs bg-gray-800 border-red-500/30 text-red-300 mx-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-900 border-gray-700">
                          {STOP_LOSS_OPTIONS.map(opt => (
                            <SelectItem key={opt.value ?? 'off'} value={opt.value == null ? 'off' : String(opt.value)}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>

                    {/* ── DTE Floor picker ─────────────────────────────── */}
                    <td className="px-3 py-3 text-center">
                      <Select
                        value={bracket.dteFloor == null ? 'off' : String(bracket.dteFloor)}
                        onValueChange={(v) =>
                          updateBracket(rowKey, { dteFloor: v === 'off' ? null : parseInt(v) }, pos)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-[82px] h-7 text-xs bg-gray-800 border-yellow-500/30 text-yellow-300 mx-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-900 border-gray-700">
                          {DTE_FLOOR_OPTIONS.map(opt => (
                            <SelectItem key={opt.value ?? 'off'} value={opt.value == null ? 'off' : String(opt.value)}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>                    {/* ── Roll Urgency Score ───────────────────────────── */}
                    <td className="px-2 py-3 text-center">
                      {pos.rollScore != null ? (
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`inline-flex flex-col items-center gap-0.5 cursor-help px-2 py-1 rounded-md border ${
                                pos.rollBand === 'red'    ? 'bg-red-900/40 border-red-500/50' :
                                pos.rollBand === 'orange' ? 'bg-orange-900/40 border-orange-500/50' :
                                pos.rollBand === 'yellow' ? 'bg-yellow-900/40 border-yellow-500/50' :
                                                            'bg-green-900/40 border-green-500/50'
                              }`}>
                                <span className={`text-sm font-bold ${
                                  pos.rollBand === 'red'    ? 'text-red-400' :
                                  pos.rollBand === 'orange' ? 'text-orange-400' :
                                  pos.rollBand === 'yellow' ? 'text-yellow-400' :
                                                              'text-green-400'
                                }`}>{pos.rollScore}</span>
                                <span className={`text-[9px] font-medium leading-none ${
                                  pos.rollBand === 'red'    ? 'text-red-400/80' :
                                  pos.rollBand === 'orange' ? 'text-orange-400/80' :
                                  pos.rollBand === 'yellow' ? 'text-yellow-400/80' :
                                                              'text-green-400/80'
                                }`}>{pos.rollLabel}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="bg-gray-900 border-gray-700 text-xs p-3 max-w-[260px]">
                              <div className="space-y-2">
                                <div className="font-semibold text-white border-b border-gray-700 pb-1.5 mb-1.5">
                                  Roll Urgency Score: {pos.rollScore}/100
                                </div>
                                {pos.rollFactors && [
                                  { key: 'itmDepth',       label: 'ITM Depth',       max: 10 },
                                  { key: 'itmBonus',       label: 'Deep ITM Bonus',  max: 20 },
                                  { key: 'deltaBreach',    label: 'Delta Breach',    max: 20 },
                                  { key: 'dteDecayZone',   label: 'DTE Decay Zone',  max: 20 },
                                  { key: 'profitCaptured', label: 'Profit Captured', max: 15 },
                                  { key: 'thetaDecay',     label: 'Theta Decay',     max: 10 },
                                  { key: 'gammaSpike',     label: 'Gamma Spike',     max: 5  },
                                ].map(({ key, label, max }) => {
                                  const f = (pos.rollFactors as any)[key];
                                  if (!f) return null;
                                  const pct = Math.round((f.pts / max) * 100);
                                  return (
                                    <div key={key} className="space-y-0.5">
                                      <div className="flex justify-between items-center">
                                        <span className="text-gray-400">{label}</span>
                                        <span className={`font-medium ${
                                          f.pts === 0 ? 'text-gray-500' :
                                          pct >= 75   ? 'text-red-400' :
                                          pct >= 50   ? 'text-orange-400' :
                                          pct >= 25   ? 'text-yellow-400' : 'text-green-400'
                                        }`}>{f.pts}/{max}</span>
                                      </div>
                                      <div className="w-full bg-gray-800 rounded-full h-1">
                                        <div
                                          className={`h-1 rounded-full ${
                                            f.pts === 0 ? 'bg-gray-700' :
                                            pct >= 75   ? 'bg-red-500' :
                                            pct >= 50   ? 'bg-orange-500' :
                                            pct >= 25   ? 'bg-yellow-500' : 'bg-green-500'
                                          }`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <div className="text-[10px] text-gray-500">{f.detail}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>

                    {/* ── Opt-in / Opt-out action ────────────────────────── */}
                    <td className="px-3 py-3 text-center">
                      {/* Roll button — always available */}
                      <div className="flex flex-col items-center gap-1.5">
                      <button
                        onClick={() => {
                          setRollTarget({
                            symbol: pos.symbol,
                            optionSymbol: pos.optionSymbol,
                            optionType: pos.optionType,
                            strike: pos.strike,
                            expiration: pos.expiration,
                            quantity: pos.quantity,
                            averageOpenPrice: pos.averageOpenPrice,
                            currentMark: pos.currentMark,
                            accountNumber: pos.accountNumber,
                            dte: pos.dte,
                          });
                          setSelectedRollIdx(null);
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/30 transition-colors"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        Roll
                      </button>
                      {isPending ? (
                        <Button size="sm" disabled className="w-36 text-xs">
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          Saving…
                        </Button>
                      ) : isEnabled ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Monitoring
                          </div>
                          {/* Show each active bracket condition as a small pill */}
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-medium">
                              ✓ Profit: {bracket.profitTargetPct}%
                            </span>
                            {bracket.stopLossPct != null && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-medium">
                                ✓ Stop: {bracket.stopLossPct}%
                              </span>
                            )}
                            {bracket.dteFloor != null && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 font-medium">
                                ✓ DTE ≤ {bracket.dteFloor}
                              </span>
                            )}
                          </div>
                          {statusBadge(pos.targetStatus ?? 'watching')}
                          <button
                            onClick={() => handleOptOut(pos)}
                            className="flex items-center gap-1 text-xs text-red-400/70 hover:text-red-400 transition-colors mt-0.5"
                          >
                            <BellOff className="h-3 w-3" />
                            Stop
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleOptIn(pos, bracket)}
                          className="w-36 text-xs bg-orange-600/80 hover:bg-orange-500 text-white border-0"
                        >
                          <BellRing className="h-3.5 w-3.5 mr-1.5" />
                          Monitor
                        </Button>
                      )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* ── Last scan results ──────────────────────────────────────────── */}
      {lastScanResult && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              Last Scan — {lastScanResult.ranAt.toLocaleTimeString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6 mb-4 text-sm">
              <span className="text-gray-400">
                Checked: <span className="text-white font-medium">{lastScanResult.scanned}</span>
              </span>
              <span className="text-green-400">
                Closed: <span className="font-medium">{lastScanResult.closed}</span>
              </span>
              <span className="text-gray-400">
                Skipped: <span className="text-white font-medium">{lastScanResult.skipped}</span>
              </span>
              {lastScanResult.errors > 0 && (
                <span className="text-red-400">
                  Errors: <span className="font-medium">{lastScanResult.errors}</span>
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {lastScanResult.details.map((d: ScanDetail, i: number) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {d.status === 'closed'  && <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />}
                  {d.status === 'skipped' && <Clock       className="h-4 w-4 text-gray-500 shrink-0" />}
                  {d.status === 'error'   && <XCircle     className="h-4 w-4 text-red-400 shrink-0" />}
                  <span className={`font-medium ${
                    d.status === 'closed' ? 'text-green-400' : d.status === 'error' ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {d.symbol}
                  </span>
                  {d.profitPct !== undefined && (
                    <span className="text-gray-500">{d.profitPct.toFixed(1)}%</span>
                  )}
                  <span className="text-gray-500 text-xs">{d.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Info box ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-300 mb-1">How it works</p>
            <ul className="space-y-1 text-xs text-amber-200/70">
              <li>• Set your <strong>Profit Target</strong>, optional <strong>Stop Loss</strong>, and optional <strong>DTE Floor</strong> — then click <strong>Monitor</strong>.</li>
              <li>• Use <strong>Global Bracket Defaults</strong> (above) to pre-fill these values for every new position automatically.</li>
              <li>• The system checks every 5 minutes Mon–Fri 9:30 AM–4:00 PM ET.</li>
              <li>• The <strong>first bracket condition hit</strong> triggers a BTC limit order (dry-run verified first).</li>
              <li>• A <strong>Telegram notification</strong> is sent when you opt in (bracket summary) and again when a position is closed (showing which condition triggered).</li>
              <li>• Use <strong>Run Now</strong> to trigger an immediate check outside the schedule.</li>
              <li>• Click <strong>Stop</strong> on any active row to remove it from auto-close.</li>
            </ul>
          </div>
        </div>
      </div>
      {/* ── Roll Dialog (Sheet) ────────────────────────────────────────── */}
      <Sheet open={!!rollTarget} onOpenChange={(open) => { if (!open) { setRollTarget(null); setSelectedRollIdx(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl bg-gray-950 border-gray-800 overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-white flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-purple-400" />
              Roll Position — {rollTarget?.symbol} {rollTarget?.optionType === 'P' ? 'Put' : 'Call'}
            </SheetTitle>
            <SheetDescription className="text-gray-400 text-sm">
              Current: ${rollTarget?.strike} exp {rollTarget?.expiration} · {rollTarget?.dte} DTE ·
              Open: ${parseFloat(rollTarget?.averageOpenPrice ?? '0').toFixed(2)} ·
              BTC: ${parseFloat(rollTarget?.currentMark ?? '0').toFixed(2)}
            </SheetDescription>
          </SheetHeader>

          {rollCandidatesQuery.isLoading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Fetching expiration chains…
            </div>
          )}

          {rollCandidatesQuery.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              {rollCandidatesQuery.error.message}
            </div>
          )}

          {rollCandidatesQuery.data?.candidates && (
            <div className="space-y-4">
              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Star className="h-3 w-3 text-amber-400" /> Best net credit</span>
                <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-blue-400" /> Strike up (OTM)</span>
                <span className="flex items-center gap-1"><Minus className="h-3 w-3 text-gray-400" /> Same strike</span>
                <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3 text-orange-400" /> Strike down (ITM)</span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400">
                      <th className="px-3 py-2.5 text-left w-8"></th>
                      <th className="px-3 py-2.5 text-left">Expiration</th>
                      <th className="px-3 py-2.5 text-right">DTE</th>
                      <th className="px-3 py-2.5 text-right">Strike</th>
                      <th className="px-3 py-2.5 text-right">Direction</th>
                      <th className="px-3 py-2.5 text-right">New Mid</th>
                      <th className="px-3 py-2.5 text-right">BTC Cost</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-white">Net Credit</th>
                      <th className="px-3 py-2.5 text-right">New Delta</th>
                      <th className="px-3 py-2.5 text-right">Wkly%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollCandidatesQuery.data!.candidates.map((c: { action: string; expiration?: string; dte?: number; strike?: number; netCredit?: number | null; delta?: number | null; annualizedReturn?: number | null; newPremium?: number | null; score: number; description: string }, i: number) => {
                      const isBest = i === bestCreditIdx;
                      const isSelected = i === selectedRollIdx;
                      const netCredit = c.netCredit ?? 0;
                      const isDebit = netCredit < 0;
                      const btcCost = parseFloat(rollTarget?.currentMark ?? '0');
                      const stoMid = c.newPremium ?? (netCredit + btcCost);
                      const qty = rollTarget?.quantity ?? 1;
                      const totalCredit = netCredit * qty;
                      // annualizedReturn is annual %; convert to weekly approx
                      const wklyPct = c.annualizedReturn != null ? (c.annualizedReturn / 52) : null;

                      // Direction indicator
                      const newStrike = c.strike ?? parseFloat(rollTarget?.strike ?? '0');
                      const origStrike = parseFloat(rollTarget?.strike ?? '0');
                      let dirIcon = <Minus className="h-3 w-3 text-gray-400" />;
                      let dirLabel = 'Same';
                      if (newStrike > origStrike) {
                        dirIcon = <TrendingUp className="h-3 w-3 text-blue-400" />;
                        dirLabel = '+' + (newStrike - origStrike).toFixed(0);
                      } else if (newStrike < origStrike) {
                        dirIcon = <TrendingDown className="h-3 w-3 text-orange-400" />;
                        dirLabel = (newStrike - origStrike).toFixed(0);
                      }

                      return (
                        <tr
                          key={i}
                          onClick={() => setSelectedRollIdx(i === selectedRollIdx ? null : i)}
                          className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-purple-500/20 border-l-2 border-l-purple-400'
                              : isBest
                                ? 'bg-amber-500/10 hover:bg-amber-500/15'
                                : 'hover:bg-gray-800/30'
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            {isBest && <Star className="h-3.5 w-3.5 text-amber-400" />}
                            {isSelected && !isBest && <CheckCircle className="h-3.5 w-3.5 text-purple-400" />}
                          </td>
                          <td className="px-3 py-2.5 text-gray-200 font-medium">
                            {c.expiration ? new Date(c.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : rollTarget?.expiration}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-300">{c.dte ?? rollTarget?.dte}</td>
                          <td className="px-3 py-2.5 text-right text-gray-200">${newStrike.toFixed(0)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="flex items-center justify-end gap-1 text-gray-400">
                              {dirIcon} {dirLabel}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-300">${stoMid.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-red-300">${btcCost.toFixed(2)}</td>
                          <td className={`px-3 py-2.5 text-right font-bold ${
                            isDebit ? 'text-red-400' : 'text-green-400'
                          }`}>
                            {isDebit ? '-' : '+'}${Math.abs(netCredit).toFixed(2)}
                            <div className="text-[10px] font-normal text-gray-500">
                              {isDebit ? '-' : '+'}${Math.abs(totalCredit).toFixed(0)} total
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-400">
                            {c.delta != null ? c.delta.toFixed(2) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-400">
                            {wklyPct != null ? `${wklyPct.toFixed(2)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Submit section */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rollDryRun}
                      onChange={(e) => setRollDryRun(e.target.checked)}
                      className="rounded border-gray-600 bg-gray-800 accent-purple-500"
                    />
                    Dry Run (validate only)
                  </label>
                  {selectedRollIdx != null && rollCandidatesQuery.data?.candidates[selectedRollIdx] && (
                    <span className="text-xs text-gray-500">
                      Selected: {rollCandidatesQuery.data.candidates[selectedRollIdx].expiration
                        ? new Date(rollCandidatesQuery.data.candidates[selectedRollIdx].expiration!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : rollTarget?.expiration} @
                      ${(rollCandidatesQuery.data.candidates[selectedRollIdx].strike ?? 0).toFixed(0)}
                    </span>
                  )}
                </div>
                <Button
                  disabled={
                    selectedRollIdx == null ||
                    submitRollMut.isPending ||
                    !rollTarget
                  }
                  onClick={() => {
                    if (selectedRollIdx == null || !rollTarget || !rollCandidatesQuery.data) return;
                    const c = rollCandidatesQuery.data.candidates[selectedRollIdx] as { strike?: number; expiration?: string; netCredit?: number | null };
                    submitRollMut.mutate({
                      dryRun: rollDryRun,
                      orders: [{
                        accountNumber: rollTarget.accountNumber,
                        symbol: rollTarget.symbol,
                        strategyType: rollTarget.optionType === 'P' ? 'CSP' : 'CC',
                        action: 'roll',
                        currentOptionSymbol: rollTarget.optionSymbol,
                        currentQuantity: rollTarget.quantity,
                        currentValue: parseFloat(rollTarget.currentMark),
                        newStrike: c.strike ?? parseFloat(rollTarget.strike),
                        newExpiration: c.expiration ?? rollTarget.expiration,
                        netCredit: c.netCredit ?? 0,
                        positionId: rollTarget.optionSymbol,
                      }],
                    });
                  }}
                  className="bg-purple-600 hover:bg-purple-500 text-white"
                >
                  {submitRollMut.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
                    : <><ArrowLeftRight className="h-4 w-4 mr-2" /> {rollDryRun ? 'Validate Roll' : 'Submit Roll'}</>
                  }
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>}
    </div>
  );
}
