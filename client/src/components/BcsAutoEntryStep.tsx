/**
 * BcsAutoEntryStep — Step 6 of Daily Actions (SPX Spreads)
 *
 * Configures and controls the SPX Bull Put Spread / Bear Call Spread auto-entry system.
 * Default strategy: Bull Put Spread (BPS) — benefits from bullish/neutral SPX market.
 * Optional strategy: Bear Call Spread (BCS) — for bearish/neutral market conditions.
 *
 * Features:
 *  - Strategy toggle: Bull Put Spread (default) / Bear Call Spread
 *  - Enable/disable kill switch
 *  - Configurable scan time, contracts, spread width, score/DTE/Delta/OI thresholds
 *  - Max concurrent positions and approval timeout
 *  - Manual "Scan Now" button
 *  - Approval history log (last 20 entries)
 */
import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Play, Settings2, Clock, CheckCircle, XCircle, AlertTriangle,
  TrendingUp, TrendingDown, Zap, Bell, Info, RefreshCw, Activity, AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type ApprovalStatus = 'pending' | 'approved' | 'skipped' | 'expired' | 'error';
type Strategy = 'bps' | 'bcs';

interface HistoryRow {
  id: number;
  shortStrike: string;
  longStrike: string;
  expiration: string;
  dte: number;
  netCredit: string;
  delta: string;
  score: number;
  contracts: number;
  status: ApprovalStatus;
  orderId?: string | null;
  errorMessage?: string | null;
  createdAt: Date | string;
  approvedAt?: Date | string | null;
}

function statusBadge(status: ApprovalStatus) {
  switch (status) {
    case 'approved':
      return <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 text-xs">✅ Approved</Badge>;
    case 'pending':
      return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-xs">⏳ Pending</Badge>;
    case 'skipped':
      return <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 text-xs">⏭ Skipped</Badge>;
    case 'expired':
      return <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 text-xs">⏰ Expired</Badge>;
    case 'error':
      return <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-xs">❌ Error</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export default function BcsAutoEntryStep() {
  const { toast } = useToast();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: settings, isLoading: settingsLoading, refetch: refetchSettings } = trpc.bcsAuto.getSettings.useQuery();
  const { data: history, isLoading: histLoading, refetch: refetchHistory } = trpc.bcsAuto.listHistory.useQuery({ limit: 20 });
  const { data: pendingCount } = trpc.bcsAuto.countPending.useQuery(undefined, { refetchInterval: 15_000 });
  const { data: marketBias, isLoading: biasLoading, refetch: refetchBias } = trpc.bcsAuto.getMarketBias.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, refetchInterval: 5 * 60 * 1000 },
  );

  // ── Local form state (mirrors settings) ───────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>('bps');
  const [scanTimeET, setScanTimeET] = useState('10:30');
  const [contracts, setContracts] = useState(2);
  const [spreadWidth, setSpreadWidth] = useState(50);
  const [minScore, setMinScore] = useState(70);
  const [minDTE, setMinDTE] = useState(30);
  const [maxDTE, setMaxDTE] = useState(45);
  const [maxDelta, setMaxDelta] = useState('0.20');
  const [minOI, setMinOI] = useState(500);
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [approvalTimeoutMins, setApprovalTimeoutMins] = useState(30);
  const [isDirty, setIsDirty] = useState(false);

  // Sync form state from server
  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled ?? false);
    setStrategy(((settings as any).strategy === 'bcs' ? 'bcs' : 'bps') as Strategy);
    setScanTimeET(settings.scanTimeET ?? '10:30');
    setContracts(settings.contracts ?? 2);
    setSpreadWidth(settings.spreadWidth ?? 50);
    setMinScore(settings.minScore ?? 70);
    setMinDTE(settings.minDTE ?? 30);
    setMaxDTE(settings.maxDTE ?? 45);
    setMaxDelta(settings.maxDelta ?? '0.20');
    setMinOI(settings.minOI ?? 500);
    setMaxConcurrent(settings.maxConcurrent ?? 2);
    setApprovalTimeoutMins(settings.approvalTimeoutMins ?? 30);
    setIsDirty(false);
  }, [settings]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateMut = trpc.bcsAuto.updateSettings.useMutation({
    onSuccess: () => {
      refetchSettings();
      setIsDirty(false);
      toast({ title: 'Settings saved', description: 'SPX spread auto-entry settings updated.' });
    },
    onError: (err) => toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  });

  const scanNowMut = trpc.bcsAuto.scanNow.useMutation({
    onSuccess: (result) => {
      refetchHistory();
      refetchSettings();
      if (result.status === 'approved') {
        toast({ title: '✅ Order submitted!', description: result.message });
      } else if (result.status === 'sent') {
        toast({ title: '📨 Approval sent to Telegram', description: result.message });
      } else if (result.status === 'no_opportunity') {
        toast({ title: 'No opportunity found', description: result.message });
      } else if (result.status === 'skipped') {
        toast({ title: 'Skipped', description: result.message });
      } else if (result.status === 'error') {
        toast({ title: 'Scan error', description: result.message, variant: 'destructive' });
      } else {
        toast({ title: `Scan: ${result.status}`, description: result.message });
      }
    },
    onError: (err) => toast({ title: 'Scan failed', description: err.message, variant: 'destructive' }),
  });

  function handleSave() {
    updateMut.mutate({
      enabled,
      strategy,
      scanTimeET,
      contracts,
      spreadWidth,
      minScore,
      minDTE,
      maxDTE,
      maxDelta,
      minOI,
      maxConcurrent,
      approvalTimeoutMins,
    });
  }

  function markDirty() {
    setIsDirty(true);
  }

  const isBPS = strategy === 'bps';

  // Determine if the current strategy mismatches the market bias
  const biasMismatch = (() => {
    if (!marketBias || marketBias.bias === 'unknown' || marketBias.bias === 'neutral') return false;
    if (isBPS && marketBias.bias === 'bearish') return true;
    if (!isBPS && marketBias.bias === 'bullish') return true;
    return false;
  })();

  const suggestedStrategy: Strategy | null = (() => {
    if (!biasMismatch) return null;
    return isBPS ? 'bcs' : 'bps';
  })();

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading SPX spread settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            {isBPS
              ? <TrendingUp className="h-5 w-5 text-emerald-400" />
              : <TrendingDown className="h-5 w-5 text-red-400" />
            }
            SPX {isBPS ? 'Bull Put Spread' : 'Bear Call Spread'} Auto-Entry
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isBPS
              ? 'Automatically scans for qualifying SPX Bull Put Spreads (sell OTM put, buy lower put), sends a Telegram approval request, and submits the live order on your tap.'
              : 'Automatically scans for qualifying SPX Bear Call Spreads (sell OTM call, buy higher call), sends a Telegram approval request, and submits the live order on your tap.'
            }
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label htmlFor="bcs-enabled" className="text-sm font-medium">
            {enabled ? 'Enabled' : 'Disabled'}
          </Label>
          <Switch
            id="bcs-enabled"
            checked={enabled}
            onCheckedChange={(v) => { setEnabled(v); markDirty(); }}
          />
        </div>
      </div>

      {/* ── Market Bias Badge ── */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/40 bg-card/30">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">SPX Market Bias (vs 20-day MA)</p>
            {biasLoading ? (
              <div className="flex items-center gap-1 mt-0.5">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Fetching SPX data...</span>
              </div>
            ) : marketBias?.bias === 'bullish' ? (
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-600/20 text-emerald-400 border border-emerald-600/30">
                  <TrendingUp className="h-3 w-3" /> Bullish — favors BPS
                </span>
                {marketBias.spxPrice && marketBias.ma20 && (
                  <span className="text-xs text-muted-foreground">
                    SPX {marketBias.spxPrice.toFixed(0)} / MA20 {marketBias.ma20.toFixed(0)}
                    {marketBias.pctAboveMA !== null && (
                      <span className="text-emerald-400 ml-1">(+{marketBias.pctAboveMA.toFixed(2)}%)</span>
                    )}
                  </span>
                )}
              </div>
            ) : marketBias?.bias === 'bearish' ? (
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-600/20 text-red-400 border border-red-600/30">
                  <TrendingDown className="h-3 w-3" /> Bearish — favors BCS
                </span>
                {marketBias.spxPrice && marketBias.ma20 && (
                  <span className="text-xs text-muted-foreground">
                    SPX {marketBias.spxPrice.toFixed(0)} / MA20 {marketBias.ma20.toFixed(0)}
                    {marketBias.pctAboveMA !== null && (
                      <span className="text-red-400 ml-1">({marketBias.pctAboveMA.toFixed(2)}%)</span>
                    )}
                  </span>
                )}
              </div>
            ) : marketBias?.bias === 'neutral' ? (
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-600/20 text-slate-400 border border-slate-600/30">
                  Neutral — near MA20
                </span>
                {marketBias.spxPrice && marketBias.ma20 && (
                  <span className="text-xs text-muted-foreground">
                    SPX {marketBias.spxPrice.toFixed(0)} / MA20 {marketBias.ma20.toFixed(0)}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground mt-0.5 block">
                {marketBias?.error ?? 'Configure Tradier API key to see market bias'}
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetchBias()}
          disabled={biasLoading}
          className="h-7 w-7 p-0 shrink-0"
          title="Refresh market bias"
        >
          <RefreshCw className={`h-3 w-3 ${biasLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* ── Strategy Mismatch Warning ── */}
      {biasMismatch && suggestedStrategy && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-600/40 bg-amber-950/20">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-amber-400">
              Strategy mismatch detected
            </p>
            <p className="text-xs text-amber-300/80 mt-0.5">
              Current market bias is <strong>{marketBias?.bias}</strong> — conditions favor a{' '}
              <strong>{suggestedStrategy === 'bps' ? 'Bull Put Spread (BPS)' : 'Bear Call Spread (BCS)'}</strong>{' '}
              rather than the currently selected{' '}
              <strong>{isBPS ? 'Bull Put Spread (BPS)' : 'Bear Call Spread (BCS)'}</strong>.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setStrategy(suggestedStrategy); markDirty(); }}
            className="shrink-0 h-7 text-xs border-amber-600/50 text-amber-400 hover:bg-amber-950/40"
          >
            Switch to {suggestedStrategy.toUpperCase()}
          </Button>
        </div>
      )}

      {/* ── Strategy Toggle ── */}
      <Card className="border-slate-700/50">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Strategy</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isBPS
                  ? 'Bull Put Spread — Sell higher put, buy lower put. Profits when SPX stays flat or rises.'
                  : 'Bear Call Spread — Sell lower call, buy higher call. Profits when SPX stays flat or falls.'
                }
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border p-1 shrink-0">
              <button
                onClick={() => { setStrategy('bps'); markDirty(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isBPS
                    ? 'bg-emerald-600 text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <TrendingUp className="h-3 w-3" />
                Bull Put (BPS)
              </button>
              <button
                onClick={() => { setStrategy('bcs'); markDirty(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  !isBPS
                    ? 'bg-red-600 text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <TrendingDown className="h-3 w-3" />
                Bear Call (BCS)
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Info box ── */}
      <Card className="border-blue-800/40 bg-blue-950/20">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-3">
            <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-xs text-blue-300 space-y-1">
              {isBPS ? (
                <>
                  <p><strong>How it works (BPS):</strong> At your configured scan time (Mon–Fri), the system checks that SPX is above its 20-day MA (bullish bias), then scans the SPX chain for OTM put spreads matching your criteria.</p>
                  <p>The best opportunity is sent to your Telegram with <strong>Approve</strong> / <strong>Skip</strong> inline buttons. Tap <strong>Approve</strong> to submit the live order immediately. The approval window is configurable (default 30 min).</p>
                </>
              ) : (
                <>
                  <p><strong>How it works (BCS):</strong> At your configured scan time (Mon–Fri), the system checks that SPX is below its 20-day MA and RSI &lt; 70 (bearish/neutral bias), then scans the SPXW chain for OTM call spreads matching your criteria.</p>
                  <p>The best opportunity is sent to your Telegram with <strong>Approve</strong> / <strong>Skip</strong> inline buttons. Tap <strong>Approve</strong> to submit the live order immediately.</p>
                </>
              )}
              <p>Use <strong>Scan Now</strong> to trigger a manual scan at any time regardless of the schedule.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Settings grid ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Entry Criteria
          </CardTitle>
          <CardDescription className="text-xs">Configure the scan parameters and entry thresholds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Row 1: Scan time + Contracts + Spread width */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Scan Time (ET)</Label>
              <Input
                type="time"
                value={scanTimeET}
                onChange={(e) => { setScanTimeET(e.target.value); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">Mon–Fri only</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contracts</Label>
              <Input
                type="number"
                min={1} max={10}
                value={contracts}
                onChange={(e) => { setContracts(parseInt(e.target.value) || 1); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">1–10 contracts</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Spread Width (pts)</Label>
              <Input
                type="number"
                min={5} max={200} step={5}
                value={spreadWidth}
                onChange={(e) => { setSpreadWidth(parseInt(e.target.value) || 50); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">e.g. 50 pts for SPX</p>
            </div>
          </div>

          <Separator />

          {/* Row 2: DTE range + Max delta + Min OI */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min DTE</Label>
              <Input
                type="number"
                min={1} max={90}
                value={minDTE}
                onChange={(e) => { setMinDTE(parseInt(e.target.value) || 30); markDirty(); }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max DTE</Label>
              <Input
                type="number"
                min={1} max={90}
                value={maxDTE}
                onChange={(e) => { setMaxDTE(parseInt(e.target.value) || 45); markDirty(); }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Short Δ</Label>
              <Input
                type="number"
                min={0.05} max={0.50} step={0.01}
                value={maxDelta}
                onChange={(e) => { setMaxDelta(e.target.value); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">e.g. 0.20</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min Open Interest</Label>
              <Input
                type="number"
                min={0} step={100}
                value={minOI}
                onChange={(e) => { setMinOI(parseInt(e.target.value) || 0); markDirty(); }}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <Separator />

          {/* Row 3: Min score + Max concurrent + Approval timeout */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min Composite Score</Label>
              <Input
                type="number"
                min={0} max={100}
                value={minScore}
                onChange={(e) => { setMinScore(parseInt(e.target.value) || 70); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">0–100 (default 70)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Concurrent</Label>
              <Input
                type="number"
                min={1} max={10}
                value={maxConcurrent}
                onChange={(e) => { setMaxConcurrent(parseInt(e.target.value) || 2); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">Active positions cap</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Approval Timeout (min)</Label>
              <Input
                type="number"
                min={5} max={120}
                value={approvalTimeoutMins}
                onChange={(e) => { setApprovalTimeoutMins(parseInt(e.target.value) || 30); markDirty(); }}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">Telegram window</p>
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {pendingCount && pendingCount.count > 0 ? (
                <span className="flex items-center gap-1 text-amber-400">
                  <Bell className="h-3 w-3" />
                  {pendingCount.count} pending approval(s)
                </span>
              ) : null}
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || updateMut.isPending}
              className="gap-2"
            >
              {updateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Manual Scan Now ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            Manual Scan
          </CardTitle>
          <CardDescription className="text-xs">
            Run an immediate {isBPS ? 'Bull Put Spread' : 'Bear Call Spread'} scan now, bypassing the schedule. The approval window will open in Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => scanNowMut.mutate()}
            disabled={scanNowMut.isPending}
            className={`gap-2 text-white ${isBPS ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-red-700 hover:bg-red-600'}`}
          >
            {scanNowMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {scanNowMut.isPending ? 'Scanning...' : 'Scan Now'}
          </Button>
          {scanNowMut.isPending && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Scanning SPX chain and checking market direction... this may take 15–30 seconds.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Approval History ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Approval History
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchHistory()}
              disabled={histLoading}
              className="h-7 px-2 text-xs gap-1"
            >
              <RefreshCw className={`h-3 w-3 ${histLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <CardDescription className="text-xs">Last 20 scan opportunities sent for approval.</CardDescription>
        </CardHeader>
        <CardContent>
          {histLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading history...
            </div>
          ) : !history || history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isBPS
                ? <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-30" />
                : <TrendingDown className="h-8 w-8 mx-auto mb-2 opacity-30" />
              }
              <p className="text-sm">No scan history yet.</p>
              <p className="text-xs mt-1">Run a scan or wait for the scheduled scan to fire.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(history as HistoryRow[]).map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/50 bg-card/50 text-sm"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-xs">
                        SPXW ${row.shortStrike} / ${row.longStrike}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {row.expiration} · {row.dte}d
                      </span>
                      {statusBadge(row.status)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>Credit: <strong className="text-foreground">${row.netCredit}</strong>/sh</span>
                      <span>Total: <strong className="text-emerald-400">${(parseFloat(row.netCredit) * row.contracts * 100).toFixed(0)}</strong></span>
                      <span>Δ {row.delta}</span>
                      <span>Score: {row.score}</span>
                      <span>{row.contracts} contract(s)</span>
                    </div>
                    {row.orderId && (
                      <p className="text-xs text-emerald-400">Order ID: {row.orderId}</p>
                    )}
                    {row.errorMessage && (
                      <p className="text-xs text-red-400 truncate max-w-xs">{row.errorMessage}</p>
                    )}
                    <p className="text-xs text-muted-foreground/60">
                      {new Date(row.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {row.status === 'approved' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : row.status === 'error' ? (
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                    ) : row.status === 'pending' ? (
                      <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground/40" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
