/**
 * AutoCloseStep — Step 5 of Daily Actions
 *
 * Shows ALL open short option positions across all accounts.
 * Each row has an opt-in Monitor toggle and a profit target % picker.
 * Filter tabs: All | Monitored (GTC set) | Not Monitored
 * A "Run Now" button triggers an immediate scan.
 * A results panel shows the last scan's findings.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Play, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type ProfitTargetPct = 25 | 50 | 75 | 90;
type FilterTab = 'all' | 'monitored' | 'unmonitored';

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

export default function AutoCloseStep() {
  const { toast } = useToast();
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  const { data: positions, isLoading: posLoading, refetch } = trpc.autoClose.listOpenShortPositions.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const setTargetMut = trpc.autoClose.setTarget.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const removeMut = trpc.autoClose.removeTarget.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const runNowMut = trpc.autoClose.runNow.useMutation({
    onSuccess: (result) => {
      setLastScanResult({ ...result, ranAt: new Date() });
      refetch();
      if (result.closed > 0) {
        toast({
          title: `✅ Auto-Close: ${result.closed} position(s) closed`,
          description: result.details.filter((d: ScanDetail) => d.status === 'closed').map((d: ScanDetail) => d.symbol).join(', '),
        });
      } else {
        toast({ title: 'Scan complete', description: `${result.scanned} position(s) checked — none at target yet.` });
      }
    },
    onError: (err) => toast({ title: 'Scan failed', description: err.message, variant: 'destructive' }),
  });

  function handleToggle(pos: NonNullable<typeof positions>[number], enabled: boolean) {
    if (!enabled && pos.targetId) {
      removeMut.mutate({ id: pos.targetId });
    } else if (enabled) {
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
        profitTargetPct: (pos.profitTargetPct as ProfitTargetPct | undefined) ?? 50,
        strategy: pos.optionType === 'P' ? 'csp' : 'cc',
      });
    }
  }

  function handleChangePct(pos: NonNullable<typeof positions>[number], pct: ProfitTargetPct) {
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
      profitTargetPct: pct,
      strategy: pos.optionType === 'P' ? 'csp' : 'cc',
    });
  }

  function statusBadge(status?: string) {
    switch (status) {
      case 'watching': return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">Watching</Badge>;
      case 'triggered': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Triggered</Badge>;
      case 'closed': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Closed</Badge>;
      case 'expired': return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs">Expired</Badge>;
      case 'error': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Error</Badge>;
      default: return null;
    }
  }

  const allPositions = positions ?? [];
  const monitoredCount = allPositions.filter(p => p.targetEnabled).length;
  const unmonitoredCount = allPositions.filter(p => !p.targetEnabled).length;

  const filteredPositions = allPositions.filter(p => {
    if (filterTab === 'monitored') return p.targetEnabled;
    if (filterTab === 'unmonitored') return !p.targetEnabled;
    return true;
  });

  const filterTabs: { id: FilterTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Positions', count: allPositions.length, icon: null },
    { id: 'monitored', label: 'Monitored', count: monitoredCount, icon: <Eye className="h-3.5 w-3.5" /> },
    { id: 'unmonitored', label: 'Not Monitored', count: unmonitoredCount, icon: <EyeOff className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Auto-Close Monitor</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            Toggle <strong>Monitor</strong> on any position and set a profit target. The system checks every 5 min during market hours and submits a BTC order automatically when the target is hit.
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

      {/* Status bar */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="text-gray-400">
          <span className="text-white font-medium">{monitoredCount}</span> position{monitoredCount !== 1 ? 's' : ''} being monitored
        </span>
        <span className="text-gray-600">•</span>
        <span className="text-gray-400">Scans every <span className="text-white font-medium">5 min</span> Mon–Fri 9:30–4:00 PM ET</span>
        {lastScanResult && (
          <>
            <span className="text-gray-600">•</span>
            <span className="text-gray-400">Last run: <span className="text-white font-medium">{lastScanResult.ranAt.toLocaleTimeString()}</span></span>
          </>
        )}
      </div>

      {/* Filter tabs */}
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

      {/* Positions table */}
      {posLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading positions from Tastytrade...
        </div>
      ) : allPositions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-base">No open short option positions found.</p>
          <p className="text-sm mt-1">Open a CSP, CC, or spread position first, then return here to set a profit target.</p>
        </div>
      ) : filteredPositions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">
            {filterTab === 'monitored'
              ? 'No positions are currently being monitored. Toggle Monitor on any position below.'
              : 'All positions are being monitored.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Monitor</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Symbol</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Strike / Exp</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Account</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Qty</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Open Price</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">P/L %</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">DTE</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Target %</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredPositions.map((pos) => {
                const isEnabled = pos.targetEnabled ?? false;
                const targetPct = (pos.profitTargetPct as ProfitTargetPct | undefined) ?? 50;
                const atTarget = pos.profitPct >= targetPct;

                return (
                  <tr
                    key={`${pos.accountId}::${pos.optionSymbol}`}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${
                      isEnabled ? 'bg-blue-950/10' : ''
                    }`}
                  >
                    {/* Monitor toggle */}
                    <td className="px-4 py-3">
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(v) => handleToggle(pos, v)}
                        disabled={setTargetMut.isPending || removeMut.isPending}
                      />
                    </td>

                    {/* Symbol */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{pos.symbol}</span>
                        <Badge variant="outline" className={`text-xs ${pos.optionType === 'P' ? 'border-red-500/40 text-red-400' : 'border-blue-500/40 text-blue-400'}`}>
                          {pos.optionType === 'P' ? 'Put' : 'Call'}
                        </Badge>
                      </div>
                    </td>

                    {/* Strike / Exp */}
                    <td className="px-4 py-3 text-gray-300">
                      <div>${pos.strike}</div>
                      <div className="text-xs text-gray-500">{pos.expiration}</div>
                    </td>

                    {/* Account */}
                    <td className="px-4 py-3 text-gray-400 text-xs">{pos.accountNumber}</td>

                    {/* Qty */}
                    <td className="px-4 py-3 text-right text-gray-300">{pos.quantity}</td>

                    {/* Open price */}
                    <td className="px-4 py-3 text-right text-gray-300">
                      ${parseFloat(pos.averageOpenPrice).toFixed(2)}
                    </td>

                    {/* P/L % */}
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${pos.profitPct >= 50 ? 'text-green-400' : pos.profitPct >= 25 ? 'text-yellow-400' : 'text-gray-400'}`}>
                        {pos.profitPct.toFixed(1)}%
                      </span>
                      {atTarget && isEnabled && (
                        <div className="text-xs text-green-400 mt-0.5 font-medium">At target!</div>
                      )}
                    </td>

                    {/* DTE */}
                    <td className="px-4 py-3 text-right">
                      <span className={`${pos.dte <= 7 ? 'text-red-400' : pos.dte <= 21 ? 'text-yellow-400' : 'text-gray-300'}`}>
                        {pos.dte}
                      </span>
                    </td>

                    {/* Target % picker */}
                    <td className="px-4 py-3 text-center">
                      <Select
                        value={String(targetPct)}
                        onValueChange={(v) => handleChangePct(pos, parseInt(v) as ProfitTargetPct)}
                        disabled={!isEnabled || setTargetMut.isPending}
                      >
                        <SelectTrigger className="w-20 h-7 text-xs bg-gray-800 border-gray-700 text-white mx-auto">
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

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      {isEnabled ? statusBadge(pos.targetStatus ?? 'watching') : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Last scan results */}
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
              <span className="text-gray-400">Checked: <span className="text-white font-medium">{lastScanResult.scanned}</span></span>
              <span className="text-green-400">Closed: <span className="font-medium">{lastScanResult.closed}</span></span>
              <span className="text-gray-400">Skipped: <span className="text-white font-medium">{lastScanResult.skipped}</span></span>
              {lastScanResult.errors > 0 && (
                <span className="text-red-400">Errors: <span className="font-medium">{lastScanResult.errors}</span></span>
              )}
            </div>
            <div className="space-y-1.5">
              {lastScanResult.details.map((d: ScanDetail, i: number) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {d.status === 'closed' && <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />}
                  {d.status === 'skipped' && <Clock className="h-4 w-4 text-gray-500 shrink-0" />}
                  {d.status === 'error' && <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                  <span className={`font-medium ${d.status === 'closed' ? 'text-green-400' : d.status === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
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

      {/* Info box */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-300 mb-1">How it works</p>
            <ul className="space-y-1 text-xs text-amber-200/70">
              <li>• Toggle <strong>Monitor</strong> to opt a position in. Set your target % (50% is the Tastytrade standard).</li>
              <li>• The system checks every 5 minutes Mon–Fri 9:30 AM–4:00 PM ET.</li>
              <li>• When a position reaches its target, a BTC limit order is submitted automatically (dry-run verified first).</li>
              <li>• You will receive a Telegram notification when a position is closed.</li>
              <li>• Use <strong>Run Now</strong> to trigger an immediate check outside the schedule.</li>
              <li>• Use the <strong>Monitored</strong> tab to see only positions with auto-close enabled, or <strong>Not Monitored</strong> to find positions that still need a target set.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
