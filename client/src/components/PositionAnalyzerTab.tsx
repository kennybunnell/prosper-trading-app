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
import { Checkbox } from '@/components/ui/checkbox';
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
  ShieldAlert,
  ShieldOff,
  Clock,
  Layers,
  Target,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

type Recommendation = 'KEEP' | 'HARVEST' | 'LIQUIDATE';

interface OpenShortCall {
  strike: number;
  expiration: string;
  quantity: number;
  daysToExpiry: number;
}

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
  openShortCalls?: OpenShortCall[];
  availableContracts?: number;
}

interface SellCCDialogState {
  open: boolean;
  position: AnalyzedPosition | null;
  dryRun: boolean;
}

interface BatchSellDialogState {
  open: boolean;
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
  isFlagged,
  onToggleFlag,
  isFlagging,
}: {
  pos: AnalyzedPosition;
  onSellCC: (pos: AnalyzedPosition) => void;
  isFlagged: boolean;
  onToggleFlag: (pos: AnalyzedPosition, flag: boolean) => void;
  isFlagging: boolean;
}) {
  const cfg = REC_CONFIG[pos.recommendation];
  const totalContracts = Math.floor(pos.quantity / 100);
  const availableContracts = pos.availableContracts ?? totalContracts;
  const lockedContracts = totalContracts - availableContracts;
  const contracts = availableContracts;
  const canSellCC = pos.recommendation !== 'KEEP' && pos.ccAtmStrike !== null && pos.ccAtmPremium !== null && availableContracts > 0;

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

      {/* Open short calls panel */}
      {pos.openShortCalls && pos.openShortCalls.length > 0 && (
        <div className="rounded-md bg-black/30 border border-amber-800/30 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
            <Layers className="h-3.5 w-3.5" />
            <span>Open Short Calls ({pos.openShortCalls.length} position{pos.openShortCalls.length > 1 ? 's' : ''})</span>
            {lockedContracts > 0 && (
              <span className="ml-auto text-amber-300/70">{lockedContracts} contract{lockedContracts > 1 ? 's' : ''} locked</span>
            )}
          </div>
          <div className="space-y-1">
            {pos.openShortCalls.map((cc, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <span className="text-white font-medium">${fmt(cc.strike)} Call</span>
                <span className="text-muted-foreground">{cc.expiration}</span>
                <span className="flex items-center gap-1 text-amber-300">
                  <Clock className="h-3 w-3" />
                  {cc.daysToExpiry}d to expiry
                </span>
                <span className="text-muted-foreground">{cc.quantity} contract{cc.quantity > 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
          {availableContracts > 0 && (
            <div className="text-xs text-emerald-400/80">
              {availableContracts} contract{availableContracts > 1 ? 's' : ''} available to sell
            </div>
          )}
          {availableContracts === 0 && (
            <div className="text-xs text-red-400/80">
              All contracts covered — wait for existing CCs to expire before selling the exit CC
            </div>
          )}
        </div>
      )}

      {/* Liquidate / Sell ITM CC — always visible for LIQUIDATE/HARVEST */}
      {pos.recommendation !== 'KEEP' && (
        <div className="space-y-2">
          {pos.ccAtmStrike && pos.ccAtmPremium ? (
            <>
              {/* CC details summary */}
              <div className="rounded-md bg-black/30 border border-emerald-800/30 p-2.5 text-xs space-y-1.5">
                <div className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Harvest &amp; Exit — Sell {pos.ccIsItm ? 'ITM' : 'ATM'} Covered Call</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <div className="text-muted-foreground">Strike</div>
                    <div className="font-bold text-white">${fmt(pos.ccAtmStrike)} {pos.ccIsItm ? <span className="text-amber-400">(ITM)</span> : <span className="text-blue-400">(ATM)</span>}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Expiry</div>
                    <div className="font-bold text-white">{pos.ccExpiration}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Premium/share</div>
                    <div className="font-bold text-emerald-400">${fmt(pos.ccAtmPremium)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total Credit</div>
                    <div className="font-bold text-emerald-400">${fmt(pos.ccAtmPremium * contracts * 100, 0)}</div>
                  </div>
                </div>
                {pos.ccEffectiveExit && (
                  <div className="text-xs text-muted-foreground">
                    Effective exit price: <span className="text-blue-400 font-medium">${fmt(pos.ccEffectiveExit)}</span>
                    {' '}· {contracts} contract{contracts !== 1 ? 's' : ''} ({pos.quantity.toLocaleString()} shares)
                  </div>
                )}
              </div>
              {/* Action button */}
              <Button
                size="sm"
                onClick={() => onSellCC(pos)}
                className="w-full h-9 text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white border-0"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Liquidate / Sell {pos.ccIsItm ? 'ITM' : 'ATM'} CC — Collect ${fmt(pos.ccAtmPremium * contracts * 100, 0)} Premium
              </Button>
            </>
          ) : (
            /* No CC data yet — loading or unavailable */
            <div className="rounded-md border border-white/10 bg-black/20 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 shrink-0" />
              <span>Loading covered call data for {pos.symbol}… Refresh to retry.</span>
            </div>
          )}
        </div>
      )}

      {/* Account badge + Liquidation flag checkbox */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Acct: ...{pos.accountNumber.slice(-4)}</span>
          <span className="text-[10px] text-muted-foreground">({pos.accountType})</span>
        </div>
        {/* Only show flag checkbox for LIQUIDATE/HARVEST cards */}
        {pos.recommendation !== 'KEEP' && (
          <div
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${
              isFlagged
                ? 'border-red-600/60 bg-red-950/40 text-red-300'
                : 'border-white/10 bg-black/20 text-muted-foreground hover:border-red-700/40 hover:text-red-400'
            }`}
            onClick={() => !isFlagging && onToggleFlag(pos, !isFlagged)}
          >
            {isFlagging ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isFlagged ? (
              <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" />
            )}
            <Checkbox
              checked={isFlagged}
              onCheckedChange={(checked) => !isFlagging && onToggleFlag(pos, !!checked)}
              className="h-3.5 w-3.5 border-current data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
            />
            <span className="text-[11px] font-medium">
              {isFlagged ? '🚫 Flagged for Liquidation' : 'Mark for Liquidation'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Batch Sell Dialog ───────────────────────────────────────────────────────
function BatchSellDialog({
  state,
  positions,
  flaggedSet,
  onClose,
}: {
  state: BatchSellDialogState;
  positions: AnalyzedPosition[];
  flaggedSet: Set<string>;
  onClose: () => void;
}) {
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<{ totalCredit: number; successCount: number; results: Array<{ symbol: string; estimatedCredit: number; success: boolean; error?: string }> } | null>(null);

  const batchMutation = trpc.positionAnalyzer.batchSellCCs.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (!dryRun) {
        toast.success(`${data.successCount} orders submitted — total credit: $${fmt(data.totalCredit, 0)}`);
      } else {
        toast.info(`Dry run: ${data.successCount} orders previewed — estimated credit: $${fmt(data.totalCredit, 0)}`);
      }
    },
    onError: (err) => toast.error(`Batch failed: ${err.message}`),
  });

  // Build eligible orders: flagged positions with CC data and available contracts
  const eligiblePositions = positions.filter(p =>
    p.recommendation !== 'KEEP' &&
    p.ccAtmStrike !== null &&
    p.ccAtmPremium !== null &&
    p.ccExpiration !== null &&
    (p.availableContracts ?? Math.floor(p.quantity / 100)) > 0
  );

  const totalEstimatedCredit = eligiblePositions.reduce((sum, p) => {
    const contracts = p.availableContracts ?? Math.floor(p.quantity / 100);
    return sum + (p.ccAtmPremium! * contracts * 100);
  }, 0);

  const handleSubmit = () => {
    setResult(null);
    batchMutation.mutate({
      orders: eligiblePositions.map(p => ({
        accountNumber: p.accountNumber,
        symbol: p.symbol,
        strike: p.ccAtmStrike!,
        expiration: p.ccExpiration!,
        quantity: p.availableContracts ?? Math.floor(p.quantity / 100),
        limitPrice: p.ccAtmPremium!,
      })),
      dryRun,
    });
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) { onClose(); setResult(null); } }}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-emerald-400" />
            Sell All Harvest CCs
          </DialogTitle>
          <DialogDescription>
            Queue ITM covered call orders for all {eligiblePositions.length} LIQUIDATE/HARVEST positions with available contracts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {eligiblePositions.map((p, i) => {
            const contracts = p.availableContracts ?? Math.floor(p.quantity / 100);
            const credit = p.ccAtmPremium! * contracts * 100;
            return (
              <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/10 border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{p.symbol}</span>
                  <span className="text-muted-foreground text-xs">{p.ccIsItm ? 'ITM' : 'ATM'} ${fmt(p.ccAtmStrike!)} · {p.ccExpiration}</span>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 font-semibold">${fmt(credit, 0)}</div>
                  <div className="text-xs text-muted-foreground">{contracts} contract{contracts > 1 ? 's' : ''}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 p-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total Estimated Credit</span>
          <span className="text-emerald-400 font-bold text-lg">${fmt(totalEstimatedCredit, 0)}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/10 border border-border px-3 py-2">
          <div>
            <Label htmlFor="batch-dry-run" className="text-sm font-medium">Dry Run Mode</Label>
            <p className="text-xs text-muted-foreground">Preview only — no real orders placed</p>
          </div>
          <Switch id="batch-dry-run" checked={dryRun} onCheckedChange={setDryRun} />
        </div>

        {!dryRun && (
          <Alert className="border-amber-800/40 bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-xs">
              <strong>Live mode:</strong> This will submit {eligiblePositions.length} real Sell to Open orders on Tastytrade.
            </AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 p-3 text-xs text-emerald-300 space-y-1">
            <div className="font-semibold">{dryRun ? 'Dry Run Preview' : 'Orders Submitted'}: {result.successCount}/{eligiblePositions.length} succeeded</div>
            <div>Total credit: <span className="font-bold">${fmt(result.totalCredit, 0)}</span></div>
            {result.results.filter(r => !r.success).map((r, i) => (
              <div key={i} className="text-red-400">{r.symbol}: {r.error}</div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onClose(); setResult(null); }}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={batchMutation.isPending || eligiblePositions.length === 0}
            className={dryRun ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}
          >
            {batchMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : dryRun ? (
              `Preview ${eligiblePositions.length} Orders`
            ) : (
              `★ Submit ${eligiblePositions.length} Live Orders`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FilterType = 'ALL' | Recommendation;

// ─── Main Tab Component ───────────────────────────────────────────────────────
export function PositionAnalyzerTab() {
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [sellDialog, setSellDialog] = useState<SellCCDialogState>({ open: false, position: null, dryRun: true });
  const [batchDialog, setBatchDialog] = useState<BatchSellDialogState>({ open: false, dryRun: true });
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null); // key = `${symbol}-${accountNumber}`

  // Liquidation flags
  const { data: flagsData, refetch: refetchFlags } = trpc.positionAnalyzer.getLiquidationFlags.useQuery(
    undefined,
    { staleTime: 30 * 1000 }
  );
  const flaggedSet = new Set(
    (flagsData?.flags ?? []).map(f => `${f.symbol}-${f.accountNumber}`)
  );

  const flagMutation = trpc.positionAnalyzer.flagForLiquidation.useMutation({
    onSuccess: (data) => {
      refetchFlags();
      toast.success(`${data.symbol} flagged for liquidation — automation blocked for new covered calls`);
      setFlaggingKey(null);
    },
    onError: (err) => {
      toast.error(`Failed to flag: ${err.message}`);
      setFlaggingKey(null);
    },
  });

  const unflagMutation = trpc.positionAnalyzer.unflagForLiquidation.useMutation({
    onSuccess: (data) => {
      refetchFlags();
      toast.success(`${data.symbol} unflagged — covered call automation re-enabled`);
      setFlaggingKey(null);
    },
    onError: (err) => {
      toast.error(`Failed to unflag: ${err.message}`);
      setFlaggingKey(null);
    },
  });

  const handleToggleFlag = (pos: AnalyzedPosition, flag: boolean) => {
    const key = `${pos.symbol}-${pos.accountNumber}`;
    setFlaggingKey(key);
    if (flag) {
      flagMutation.mutate({ symbol: pos.symbol, accountNumber: pos.accountNumber });
    } else {
      unflagMutation.mutate({ symbol: pos.symbol, accountNumber: pos.accountNumber });
    }
  };


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

      {/* Liquidity progress bar toward TSLA coverage */}
      {summary && summary.estimatedLiquidationProceeds > 0 && (
        <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-semibold text-blue-300">Liquidity Progress — TSLA Coverage Target</span>
            </div>
            <span className="text-xs text-muted-foreground">Goal: $100,750 (250 shares @ ~$403)</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Available from flagged liquidations</span>
              <span className="text-blue-300 font-semibold">~${(summary.estimatedLiquidationProceeds / 1000).toFixed(0)}k of $100.8k</span>
            </div>
            <Progress
              value={Math.min(100, (summary.estimatedLiquidationProceeds / 100750) * 100)}
              className="h-2 bg-blue-950/50"
            />
            <div className="text-xs text-muted-foreground">
              {summary.estimatedLiquidationProceeds >= 100750
                ? '✅ Sufficient liquidity to fully cover TSLA position'
                : `$${((100750 - summary.estimatedLiquidationProceeds) / 1000).toFixed(0)}k more needed — liquidate additional positions or use premium income`
              }
            </div>
          </div>
          {/* Sell All button */}
          {positions.filter(p => p.recommendation !== 'KEEP' && p.ccAtmStrike && p.ccAtmPremium && ((p as AnalyzedPosition).availableContracts ?? Math.floor(p.quantity / 100)) > 0).length > 0 && (
            <Button
              size="sm"
              onClick={() => setBatchDialog({ open: true, dryRun: true })}
              className="bg-emerald-700 hover:bg-emerald-600 text-white border-0 text-xs h-8"
            >
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Sell All Harvest CCs ({positions.filter(p => p.recommendation !== 'KEEP' && p.ccAtmStrike && p.ccAtmPremium && ((p as AnalyzedPosition).availableContracts ?? Math.floor(p.quantity / 100)) > 0).length} positions)
            </Button>
          )}
        </div>
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
          {filtered.map((pos, i) => {
            const flagKey = `${pos.symbol}-${pos.accountNumber}`;
            return (
              <PositionCard
                key={`${pos.symbol}-${pos.accountNumber}-${i}`}
                pos={pos}
                onSellCC={(p) => setSellDialog({ open: true, position: p, dryRun: true })}
                isFlagged={flaggedSet.has(flagKey)}
                onToggleFlag={handleToggleFlag}
                isFlagging={flaggingKey === flagKey}
              />
            );
          })}
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

      {/* Batch sell dialog */}
      <BatchSellDialog
        state={batchDialog}
        positions={positions}
        flaggedSet={flaggedSet}
        onClose={() => setBatchDialog({ open: false, dryRun: true })}
      />

    </div>
  );
}
