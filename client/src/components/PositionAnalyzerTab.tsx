/**
 * Position Analyzer Tab
 *
 * Scans all held stock positions and rates each one as:
 *   LIQUIDATE  — poor premium yield, deep drawdown, capital better redeployed
 *   HARVEST    — sell ITM/ATM covered call to collect premium on the way out
 *   KEEP       — core holding with strong CC yield, continue wheeling
 *
 * Each HARVEST/LIQUIDATE card has a one-click "★ Sell ATM CC" button that opens
 * a confirmation dialog (dry-run preview) before submitting the order.
 */
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  RefreshCw,
  TrendingDown,
  CheckCircle2,
  Loader2,
  ArrowRight,
  DollarSign,
  BarChart3,
  Zap,
  Info,
  TrendingUp,
  AlertTriangle,
  Mail,
} from 'lucide-react';
import { toast } from 'sonner';

type Recommendation = 'KEEP' | 'HARVEST' | 'LIQUIDATE';

interface AnalyzedPosition {
  symbol: string;
  accountNumber: string;
  accountType: string;
  quantity: number;
  avgOpenPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  week52High: number;
  week52Low: number;
  drawdownFromHigh: number;
  isCore: boolean;
  ccExpiration: string | null;
  ccAtmStrike: number | null;
  ccAtmPremium: number | null;
  ccWeeklyYield: number | null;
  ccEffectiveExit: number | null;
  recommendation: Recommendation;
  recommendationReason: string;
  ccIsItm: boolean;
}

interface SellCCDialogState {
  open: boolean;
  position: AnalyzedPosition | null;
  dryRun: boolean;
}

const REC_CONFIG: Record<Recommendation, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  badgeClass: string;
}> = {
  LIQUIDATE: {
    label: 'Liquidate',
    color: 'text-red-400',
    bgColor: 'bg-red-950/30',
    borderColor: 'border-red-800/40',
    icon: <TrendingDown className="h-4 w-4 text-red-400" />,
    badgeClass: 'bg-red-900/60 text-red-300 border-red-700/50',
  },
  HARVEST: {
    label: 'Harvest & Exit',
    color: 'text-amber-400',
    bgColor: 'bg-amber-950/20',
    borderColor: 'border-amber-800/40',
    icon: <Zap className="h-4 w-4 text-amber-400" />,
    badgeClass: 'bg-amber-900/60 text-amber-300 border-amber-700/50',
  },
  KEEP: {
    label: 'Keep & Wheel',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-950/20',
    borderColor: 'border-emerald-800/40',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    badgeClass: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50',
  },
};

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Sell CC Confirmation Dialog ─────────────────────────────────────────────
function SellCCDialog({
  state,
  onClose,
}: {
  state: SellCCDialogState;
  onClose: () => void;
}) {
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const sellMutation = trpc.positionAnalyzer.sellCoveredCall.useMutation({
    onSuccess: (data) => {
      setLastResult(data.message);
      if (!dryRun) {
        toast.success(`Order submitted: ${data.symbol} ${data.strike}C — ${data.quantity} contract(s)`);
      } else {
        toast.info('Dry run complete — no real order placed');
      }
    },
    onError: (err) => {
      toast.error(`Order failed: ${err.message}`);
    },
  });

  const pos = state.position;
  if (!pos || !pos.ccAtmStrike || !pos.ccAtmPremium || !pos.ccExpiration) return null;

  const contracts = Math.floor(pos.quantity / 100);
  const estimatedCredit = pos.ccAtmPremium * contracts * 100;

  const handleSubmit = () => {
    setLastResult(null);
    sellMutation.mutate({
      accountNumber: pos.accountNumber,
      symbol: pos.symbol,
      strike: pos.ccAtmStrike!,
      expiration: pos.ccExpiration!,
      quantity: contracts,
      limitPrice: pos.ccAtmPremium!,
      dryRun,
    });
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) { onClose(); setLastResult(null); } }}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            Sell ATM Covered Call — {pos.symbol}
          </DialogTitle>
          <DialogDescription>
            Review the order details below before submitting.
          </DialogDescription>
        </DialogHeader>

        {/* Order details */}
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/20 border border-border p-3 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-muted-foreground text-xs">Symbol</div>
                <div className="font-semibold text-white">{pos.symbol}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Action</div>
                <div className="font-semibold text-emerald-400">Sell to Open (STO)</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Strike</div>
                <div className="font-semibold text-white">${fmt(pos.ccAtmStrike)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Expiration</div>
                <div className="font-semibold text-white">{pos.ccExpiration}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Contracts</div>
                <div className="font-semibold text-white">{contracts}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Limit Price (mid)</div>
                <div className="font-semibold text-white">${fmt(pos.ccAtmPremium)}/share</div>
              </div>
            </div>
            <div className="border-t border-border pt-2 flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Estimated Credit</span>
              <span className="text-emerald-400 font-bold text-base">${fmt(estimatedCredit, 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Effective Exit Price</span>
              <span className="text-blue-400 font-semibold">${fmt(pos.ccEffectiveExit ?? 0)} vs. ${fmt(pos.currentPrice)} today</span>
            </div>
          </div>

          {/* Dry run toggle */}
          <div className="flex items-center justify-between rounded-lg bg-muted/10 border border-border px-3 py-2">
            <div>
              <Label htmlFor="sell-dry-run" className="text-sm font-medium">Dry Run Mode</Label>
              <p className="text-xs text-muted-foreground">Preview only — no real order placed</p>
            </div>
            <Switch id="sell-dry-run" checked={dryRun} onCheckedChange={setDryRun} />
          </div>

          {!dryRun && (
            <Alert className="border-amber-800/40 bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-amber-300 text-xs">
                <strong>Live mode:</strong> This will submit a real Sell to Open order on Tastytrade. Make sure you have {pos.quantity} shares of {pos.symbol} in account ...{pos.accountNumber.slice(-4)}.
              </AlertDescription>
            </Alert>
          )}

          {/* Result */}
          {lastResult && (
            <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 p-3 text-xs text-emerald-300">
              {lastResult}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onClose(); setLastResult(null); }}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={sellMutation.isPending}
            className={dryRun ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}
          >
            {sellMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
            ) : dryRun ? (
              'Preview Order'
            ) : (
              '★ Submit Live Order'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Position Card ────────────────────────────────────────────────────────────
function PositionCard({
  pos,
  onSellCC,
}: {
  pos: AnalyzedPosition;
  onSellCC: (pos: AnalyzedPosition) => void;
}) {
  const cfg = REC_CONFIG[pos.recommendation];
  const contracts = Math.floor(pos.quantity / 100);
  const canSellCC = pos.recommendation !== 'KEEP' && pos.ccAtmStrike !== null && pos.ccAtmPremium !== null && contracts > 0;

  return (
    <div className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-4 space-y-3`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {cfg.icon}
          <span className="font-bold text-base text-white">{pos.symbol}</span>
          {pos.isCore && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-600/50 text-blue-400">CORE</Badge>
          )}
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${cfg.badgeClass}`}>
            {cfg.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* One-click Sell ATM CC button */}
          {canSellCC && (
            <Button
              size="sm"
              onClick={() => onSellCC(pos)}
              className="h-7 px-2.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white border-0"
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              ★ Sell ATM CC
            </Button>
          )}
          <div className="text-right">
            <div className="text-sm font-semibold text-white">${fmt(pos.currentPrice)}</div>
            <div className={`text-xs ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtDollar(pos.unrealizedPnl)} ({pos.unrealizedPnlPct >= 0 ? '+' : ''}{fmt(pos.unrealizedPnlPct, 1)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="space-y-0.5">
          <div className="text-muted-foreground">Shares</div>
          <div className="font-medium text-white">{pos.quantity.toLocaleString()} ({contracts} contracts)</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-muted-foreground">Mkt Value</div>
          <div className="font-medium text-white">${(pos.marketValue / 1000).toFixed(1)}k</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-muted-foreground">52-Wk High</div>
          <div className={`font-medium ${pos.drawdownFromHigh <= -50 ? 'text-red-400' : pos.drawdownFromHigh <= -25 ? 'text-amber-400' : 'text-white'}`}>
            ${fmt(pos.week52High)} ({fmt(pos.drawdownFromHigh, 0)}%)
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="text-muted-foreground">Avg Cost</div>
          <div className="font-medium text-white">${fmt(pos.avgOpenPrice)}</div>
        </div>
      </div>

      {/* CC premium row */}
      {pos.ccAtmPremium && pos.ccAtmStrike && (
        <div className="rounded-md bg-black/30 border border-white/5 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart3 className="h-3 w-3" />
            <span>ATM Covered Call — {pos.ccExpiration}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Strike</div>
              <div className="font-semibold text-white">${fmt(pos.ccAtmStrike)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Premium</div>
              <div className="font-semibold text-emerald-400">
                ${fmt(pos.ccAtmPremium)} ({fmt(pos.ccWeeklyYield ?? 0, 1)}%/wk)
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Effective Exit</div>
              <div className="font-semibold text-blue-400">${fmt(pos.ccEffectiveExit ?? 0)}</div>
            </div>
          </div>
          {contracts > 0 && (
            <div className="text-xs text-muted-foreground">
              {contracts} contract{contracts > 1 ? 's' : ''} → <span className="text-emerald-400 font-medium">${fmt(pos.ccAtmPremium * contracts * 100, 0)} premium this week</span>
            </div>
          )}
        </div>
      )}

      {/* Reason */}
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>{pos.recommendationReason}</span>
      </div>

      {/* Harvest & Exit CC details row — shown for LIQUIDATE/HARVEST when option data is available */}
      {pos.recommendation !== 'KEEP' && pos.ccAtmStrike && pos.ccAtmPremium && (
        <button
          onClick={() => onSellCC(pos)}
          className="w-full flex items-start gap-1.5 rounded-md bg-emerald-950/30 border border-emerald-800/30 p-2 text-xs text-emerald-300 hover:bg-emerald-900/40 hover:border-emerald-700/50 transition-colors cursor-pointer text-left group"
        >
          <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
          <span className="flex-1">
            <span className="font-medium">{pos.ccIsItm ? 'ITM' : 'ATM'} CC:</span>{' '}
            ${fmt(pos.ccAtmStrike)} strike · {pos.ccExpiration} · ~${fmt(pos.ccAtmPremium)}/share premium
            {pos.ccEffectiveExit && (
              <span className="text-emerald-400/70"> · Effective exit ${fmt(pos.ccEffectiveExit)}</span>
            )}
          </span>
          <span className="shrink-0 text-emerald-500 group-hover:text-emerald-300 font-medium">★ Sell CC</span>
        </button>
      )}

      {/* Account badge */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Acct: ...{pos.accountNumber.slice(-4)}</span>
        <span className="text-[10px] text-muted-foreground">({pos.accountType})</span>
      </div>
    </div>
  );
}

type FilterType = 'ALL' | Recommendation;

// ─── Main Tab Component ───────────────────────────────────────────────────────
export function PositionAnalyzerTab() {
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [sellDialog, setSellDialog] = useState<SellCCDialogState>({ open: false, position: null, dryRun: true });


  const { data, isLoading, error, refetch, isFetching } = trpc.positionAnalyzer.analyzePositions.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );

  const { data: digestSettings } = trpc.positionAnalyzer.getDigestSettings.useQuery();
  const updateDigest = trpc.positionAnalyzer.updateDigestSettings.useMutation({
    onSuccess: (data) => {
      toast.success(data.weeklyPositionDigestEnabled
        ? 'Weekly digest enabled — you\'ll receive a Monday morning summary'
        : 'Weekly digest disabled');
    },
  });

  const positions = data?.positions ?? [];
  const summary = data?.summary;
  const filtered = filter === 'ALL' ? positions : positions.filter(p => p.recommendation === filter);

  const handleRefresh = () => {
    refetch();
    toast.info('Refreshing position analysis…');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <p className="text-sm">Scanning positions across all accounts…</p>
        <p className="text-xs">Fetching live quotes and option chains — this takes 15–30 seconds</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {error.message || 'Failed to analyze positions. Check your Tastytrade credentials in Settings.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Position Analyzer</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Evaluates every stock position as a premium harvesting machine. Identifies dogs to exit and provides one-click covered call orders to maximize exit value.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Weekly digest toggle */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/10">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <Label htmlFor="weekly-digest" className="text-xs text-muted-foreground cursor-pointer">Weekly Digest</Label>
            <Switch
              id="weekly-digest"
              checked={digestSettings?.weeklyPositionDigestEnabled ?? false}
              onCheckedChange={(val) => updateDigest.mutate({ weeklyPositionDigestEnabled: val })}
              disabled={updateDigest.isPending}
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Total Positions</div>
              <div className="text-2xl font-bold text-white mt-1">{summary.totalPositions}</div>
              <div className="text-xs text-muted-foreground mt-1">
                ${(summary.totalMarketValue / 1000).toFixed(0)}k market value
              </div>
            </CardContent>
          </Card>
          <Card className="bg-red-950/20 border-red-800/30">
            <CardContent className="p-3">
              <div className="text-xs text-red-400">Liquidate</div>
              <div className="text-2xl font-bold text-red-300 mt-1">{summary.liquidateCount}</div>
              <div className="text-xs text-red-400/70 mt-1">
                ~${(summary.estimatedLiquidationProceeds / 1000).toFixed(0)}k to redeploy
              </div>
            </CardContent>
          </Card>
          <Card className="bg-amber-950/20 border-amber-800/30">
            <CardContent className="p-3">
              <div className="text-xs text-amber-400">Harvest & Exit</div>
              <div className="text-2xl font-bold text-amber-300 mt-1">{summary.harvestCount}</div>
              <div className="text-xs text-amber-400/70 mt-1">
                ~${(summary.estimatedWeeklyPremium).toFixed(0)} premium/wk
              </div>
            </CardContent>
          </Card>
          <Card className="bg-emerald-950/20 border-emerald-800/30">
            <CardContent className="p-3">
              <div className="text-xs text-emerald-400">Keep & Wheel</div>
              <div className="text-2xl font-bold text-emerald-300 mt-1">{summary.keepCount}</div>
              <div className="text-xs text-emerald-400/70 mt-1">
                {summary.totalUnrealizedPnl >= 0 ? '+' : ''}${(summary.totalUnrealizedPnl / 1000).toFixed(0)}k unrealized P&L
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Liquidity context banner */}
      {summary && summary.estimatedLiquidationProceeds > 0 && (
        <Alert className="border-blue-800/40 bg-blue-950/20">
          <DollarSign className="h-4 w-4 text-blue-400" />
          <AlertDescription className="text-blue-300 text-sm">
            <strong>Liquidity opportunity:</strong> Liquidating the flagged positions could free up ~${(summary.estimatedLiquidationProceeds / 1000).toFixed(0)}k in capital — enough to cover additional TSLA shares or fund new iron condors and PMCC positions.
          </AlertDescription>
        </Alert>
      )}

      {/* Filter tabs */}
      {positions.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(['ALL', 'LIQUIDATE', 'HARVEST', 'KEEP'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? f === 'ALL' ? 'bg-white/10 text-white'
                    : f === 'LIQUIDATE' ? 'bg-red-900/60 text-red-300'
                    : f === 'HARVEST' ? 'bg-amber-900/60 text-amber-300'
                    : 'bg-emerald-900/60 text-emerald-300'
                  : 'text-muted-foreground hover:text-white hover:bg-white/5'
              }`}
            >
              {f === 'ALL' ? `All (${positions.length})`
                : f === 'LIQUIDATE' ? `Liquidate (${summary?.liquidateCount ?? 0})`
                : f === 'HARVEST' ? `Harvest (${summary?.harvestCount ?? 0})`
                : `Keep (${summary?.keepCount ?? 0})`}
            </button>
          ))}
        </div>
      )}

      {/* Position cards */}
      {filtered.length === 0 && !isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {positions.length === 0
              ? 'No stock positions found. Connect your Tastytrade account in Settings to get started.'
              : `No positions in the "${filter}" category.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((pos, i) => (
            <PositionCard
              key={`${pos.symbol}-${pos.accountNumber}-${i}`}
              pos={pos}
              onSellCC={(p) => setSellDialog({ open: true, position: p, dryRun: true })}

            />
          ))}
        </div>
      )}

      {data?.scannedAt && (
        <p className="text-xs text-muted-foreground text-center">
          Last scanned: {new Date(data.scannedAt).toLocaleString()}
        </p>
      )}

      {/* Sell CC confirmation dialog */}
      <SellCCDialog
        state={sellDialog}
        onClose={() => setSellDialog({ open: false, position: null, dryRun: true })}
      />

    </div>
  );
}
