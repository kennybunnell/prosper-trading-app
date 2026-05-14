/**
 * AutoCloseStep — Step 5 of Daily Actions
 *
 * Shows ALL open short option positions across all accounts.
 * Each row has an explicit "Monitor" button to opt in with three bracket conditions:
 *   1. Profit Target % — close when P/L reaches this level
 *   2. Stop Loss %     — close when loss reaches X% of premium collected (e.g. 200 = 2× premium)
 *   3. DTE Floor       — close when days-to-expiration ≤ this value
 * Filter tabs: All | Monitored (GTC set) | Not Monitored
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { AutoCloseLogTab } from './AutoCloseLogTab';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Loader2, Play, RefreshCw, CheckCircle, XCircle, Clock,
  AlertTriangle, Eye, EyeOff, BellRing, BellOff, ShieldAlert
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type ProfitTargetPct = 25 | 50 | 75 | 90;
type FilterTab = 'all' | 'monitored' | 'unmonitored';

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

export default function AutoCloseStep() {
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState<'monitor' | 'log'>('monitor');
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  // Per-row bracket settings — keyed by "accountId::optionSymbol"
  const [rowBrackets, setRowBrackets] = useState<Record<string, RowBracket>>({});

  // Per-row pending mutation state
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());

  const { data: positions, isLoading: posLoading, refetch } = trpc.autoClose.listOpenShortPositions.useQuery(undefined, {
    refetchInterval: 30_000,
  });

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

  /** Get the effective bracket settings for a row — local state wins over server values */
  function getEffectiveBracket(rowKey: string, pos: NonNullable<typeof positions>[number]): RowBracket {
    if (rowBrackets[rowKey]) return rowBrackets[rowKey];
    return {
      profitTargetPct: (pos.profitTargetPct as ProfitTargetPct | undefined) ?? 50,
      stopLossPct: pos.stopLossPct ?? null,
      dteFloor: pos.dteFloor ?? null,
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
    const parts = [`${bracket.profitTargetPct}% profit target`];
    if (bracket.stopLossPct) parts.push(`${bracket.stopLossPct}% stop loss`);
    if (bracket.dteFloor)    parts.push(`${bracket.dteFloor} DTE floor`);
    toast({
      title: `Monitoring ${pos.symbol}`,
      description: `Bracket: ${parts.join(' | ')}`,
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

  const filteredPositions = allPositions.filter(p => {
    if (filterTab === 'monitored')   return p.targetEnabled;
    if (filterTab === 'unmonitored') return !p.targetEnabled;
    return true;
  });

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
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Auto-Close Monitor</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            Set a <strong className="text-orange-400">profit target</strong>,{' '}
            <strong className="text-red-400">stop loss</strong>, and/or{' '}
            <strong className="text-yellow-400">DTE floor</strong> per position,
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
      <div className="flex items-center gap-1 border-b border-gray-800 pb-0">
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
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-3 py-3 text-gray-400 font-medium">Symbol</th>
                <th className="text-left px-3 py-3 text-gray-400 font-medium">Strike / Exp</th>
                <th className="text-left px-3 py-3 text-gray-400 font-medium">Acct</th>
                <th className="text-right px-3 py-3 text-gray-400 font-medium">Qty</th>
                <th className="text-right px-3 py-3 text-gray-400 font-medium">Open $</th>
                <th className="text-right px-3 py-3 text-gray-400 font-medium">P/L %</th>
                <th className="text-right px-3 py-3 text-gray-400 font-medium">DTE</th>
                {/* Bracket columns */}
                <th className="text-center px-3 py-3 text-orange-400/80 font-medium text-xs">
                  <div>Profit</div><div>Target</div>
                </th>
                <th className="text-center px-3 py-3 text-red-400/80 font-medium text-xs">
                  <div>Stop</div><div>Loss</div>
                </th>
                <th className="text-center px-3 py-3 text-yellow-400/80 font-medium text-xs">
                  <div>DTE</div><div>Floor</div>
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
                        <SelectTrigger className="w-[68px] h-7 text-xs bg-gray-800 border-orange-500/30 text-orange-300 mx-auto">
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
                        <SelectTrigger className="w-[68px] h-7 text-xs bg-gray-800 border-red-500/30 text-red-300 mx-auto">
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
                        <SelectTrigger className="w-[68px] h-7 text-xs bg-gray-800 border-yellow-500/30 text-yellow-300 mx-auto">
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
                    </td>

                    {/* ── Opt-in / Opt-out action ──────────────────────── */}
                    <td className="px-3 py-3 text-center">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
              <li>• The system checks every 5 minutes Mon–Fri 9:30 AM–4:00 PM ET.</li>
              <li>• The <strong>first bracket condition hit</strong> triggers a BTC limit order (dry-run verified first).</li>
              <li>• You will receive a Telegram notification showing which condition triggered the close.</li>
              <li>• Use <strong>Run Now</strong> to trigger an immediate check outside the schedule.</li>
              <li>• Click <strong>Stop</strong> on any active row to remove it from auto-close.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
      }
    </div>
  );
}
