/**
 * Position Analyzer Tab
 *
 * Scans all held stock positions and rates each one using Weeks-to-Recover (WTR):
 *   KEEP       — no cost-basis deficit (position is profitable), continue wheeling
 *   HARVEST    — WTR ≤ 16 weeks: recoverable in ≤4 months, sell calls aggressively
 *   MONITOR    — WTR 17–52 weeks: 4–12 months to recover, watch closely
 *   LIQUIDATE  — WTR > 52 weeks: takes over a year, exit and redeploy capital
 *
 * Includes CSV export for offline review and sanity-checking.
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
  Eye,
  Download,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { WtrSparkline } from '@/components/WtrSparkline';

type Recommendation = 'KEEP' | 'HARVEST' | 'MONITOR' | 'LIQUIDATE';

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
  weeksToRecover: number | null;
  monthsToRecover: number | null;
  ccExpiration: string | null;
  ccAtmStrike: number | null;
  ccAtmPremium: number | null;
  ccWeeklyYield: number | null;
  ccEffectiveExit: number | null;
  recommendation: Recommendation;
  recommendationReason: string;
  ccDeltaTier?: string;
  ccIsItm: boolean;
  openShortCalls?: OpenShortCall[];
  availableContracts?: number;
}

interface SellCCDialogState {
  open: boolean;
  position: AnalyzedPosition | null;
  dryRun: boolean;
  /** When set, overrides availableContracts — used for forced Dog exit when all contracts are locked */
  forceQuantity?: number;
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
  MONITOR: {
    label: 'Monitor',
    color: 'text-sky-400',
    bgColor: 'bg-sky-950/20',
    borderColor: 'border-sky-800/40',
    icon: <Eye className="h-4 w-4 text-sky-400" />,
    badgeClass: 'bg-sky-900/60 text-sky-300 border-sky-700/50',
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

/** Format WTR for display — null means no deficit (profitable) */
function fmtWTR(wtr: number | null, mtr: number | null): string {
  if (wtr === null) return '—';
  if (wtr > 999) return '>999 wks';
  if (mtr !== null && mtr >= 1) return `${mtr.toFixed(1)} mo (${wtr.toFixed(0)} wks)`;
  return `${wtr.toFixed(1)} wks`;
}

/** WTR badge color based on tier */
function wtrColor(wtr: number | null): string {
  if (wtr === null) return 'text-emerald-400';
  if (wtr <= 16) return 'text-amber-400';
  if (wtr <= 52) return 'text-sky-400';
  return 'text-red-400';
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportToCSV(positions: AnalyzedPosition[], scannedAt: string) {
  const headers = [
    'Symbol', 'Account', 'Account Type', 'Recommendation',
    'Shares', 'Avg Cost', 'Current Price', 'Market Value ($)',
    'Unrealized P&L ($)', 'Unrealized P&L (%)',
    'Deficit/Share ($)', 'Wk ATM Premium ($)', 'Weeks to Recover', 'Months to Recover',
    '52-Wk High ($)', 'Drawdown from High (%)',
    'CC Delta Tier', 'CC Strike ($)', 'CC Premium ($)', 'CC Weekly Yield (%)', 'CC Effective Exit ($)',
    'CC Expiration', 'Available Contracts', 'Flagged for Exit',
    'Recommendation Reason',
  ];

  const rows = positions.map(p => {
    const deficit = p.avgOpenPrice - p.currentPrice;
    return [
      p.symbol,
      p.accountNumber,
      p.accountType,
      p.recommendation,
      p.quantity,
      p.avgOpenPrice.toFixed(2),
      p.currentPrice.toFixed(2),
      p.marketValue.toFixed(2),
      p.unrealizedPnl.toFixed(2),
      p.unrealizedPnlPct.toFixed(2),
      deficit > 0 ? deficit.toFixed(2) : '0.00',
      p.ccAtmPremium !== null ? p.ccAtmPremium.toFixed(2) : '',
      p.weeksToRecover !== null ? p.weeksToRecover.toFixed(1) : '',
      p.monthsToRecover !== null ? p.monthsToRecover.toFixed(1) : '',
      p.week52High.toFixed(2),
      p.drawdownFromHigh.toFixed(1),
      p.ccDeltaTier ?? '',
      p.ccAtmStrike !== null ? p.ccAtmStrike.toFixed(2) : '',
      p.ccAtmPremium !== null ? p.ccAtmPremium.toFixed(2) : '',
      p.ccWeeklyYield !== null ? p.ccWeeklyYield.toFixed(2) : '',
      p.ccEffectiveExit !== null ? p.ccEffectiveExit.toFixed(2) : '',
      p.ccExpiration ?? '',
      p.availableContracts ?? Math.floor(p.quantity / 100),
      '', // flagged — filled client-side if needed
      `"${p.recommendationReason.replace(/"/g, '""')}"`,
    ];
  });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date(scannedAt).toISOString().slice(0, 10);
  link.href = url;
  link.download = `position-analyzer-${dateStr}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Sell CC Confirmation Dialog (with live option chain picker) ──────────────
type ChainStrike = {
  strike: number; bid: number; ask: number; mid: number;
  isItm: boolean; estimatedCredit100: number; effectiveExit: number;
};

function SellCCDialog({
  state,
  onClose,
}: {
  state: SellCCDialogState;
  onClose: () => void;
}) {
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<ChainStrike | null>(null);
  // Two-step confirm: 'pick' → user selects strike, 'confirm' → shows OCC + final price before submit
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');

  const pos = state.position;

  // Fetch live option chain when dialog opens
  const chainQuery = trpc.positionAnalyzer.getOptionChainForSymbol.useQuery(
    { symbol: pos?.symbol ?? '', currentPrice: pos?.currentPrice ?? 1 },
    {
      enabled: state.open && !!pos,
      staleTime: 30_000, // re-fetch if older than 30s
      retry: 1,
    }
  );

  // Auto-select the recommended strike once chain loads
  const chainStrikes = chainQuery.data?.strikes ?? [];
  const expiration = chainQuery.data?.expiration ?? pos?.ccExpiration ?? '';

  // Pick the recommended strike: match pos.ccAtmStrike, or default to first ITM
  const recommendedStrike = chainStrikes.find(s => s.strike === pos?.ccAtmStrike)
    ?? chainStrikes.find(s => s.isItm)
    ?? chainStrikes[0]
    ?? null;

  // Use selectedStrike if user picked one, otherwise fall back to recommended
  const activeStrike = selectedStrike ?? recommendedStrike;

  const sellMutation = trpc.positionAnalyzer.sellCoveredCall.useMutation({
    onSuccess: (data) => {
      setLastResult(data.message);
      setStep('pick'); // reset to pick step after result
      if (!dryRun) {
        toast.success(`Order submitted: ${data.symbol} $${data.strike}C — ${data.quantity} contract(s)`);
      } else {
        toast.info('Dry run complete — no real order placed');
      }
    },
    onError: (err) => {
      toast.error(`Order failed: ${err.message}`);
      setStep('pick');
    },
  });

  if (!pos) return null;

  const isForcedExit = state.forceQuantity !== undefined;
  const totalContracts = Math.floor(pos.quantity / 100);
  const availableContracts = pos.availableContracts ?? totalContracts;
  const contracts = state.forceQuantity ?? availableContracts;
  const lockedContracts = totalContracts - availableContracts;

  const estimatedCredit = activeStrike ? activeStrike.mid * contracts * 100 : 0;

  // Build OCC symbol for display: SYMBOL  YYMMDDCSTRIKE
  const buildOCC = (sym: string, exp: string, strike: number) => {
    const expDate = new Date(exp);
    const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, '');
    const strikeStr = (strike * 1000).toFixed(0).padStart(8, '0');
    return `${sym.padEnd(6, ' ')}${expStr}C${strikeStr}`;
  };

  const handleConfirmStep = () => {
    if (!activeStrike) return;
    setStep('confirm');
  };

  const handleSubmit = () => {
    if (!activeStrike) return;
    setLastResult(null);
    sellMutation.mutate({
      accountNumber: pos.accountNumber,
      symbol: pos.symbol,
      strike: activeStrike.strike,
      expiration,
      quantity: contracts,
      limitPrice: activeStrike.mid,
      dryRun,
    });
  };

  const handleClose = () => {
    onClose();
    setLastResult(null);
    setSelectedStrike(null);
    setStep('pick');
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-lg bg-card" style={{ border: '2px solid #374151', boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 25px 50px rgba(0,0,0,0.8)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className={`h-5 w-5 ${isForcedExit ? 'text-red-400' : 'text-emerald-400'}`} />
            {isForcedExit ? '⛔ Force Exit' : 'Sell'} Covered Call — {pos.symbol}
          </DialogTitle>
          <DialogDescription>
            {step === 'pick'
              ? 'Select a strike from the live option chain below, then confirm.'
              : 'Review the final order details and OCC contract before submitting.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* ── Step 1: Strike Picker ── */}
          {step === 'pick' && (
            <>
              {/* Position context */}
              <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/10 rounded-lg px-3 py-2 border border-border">
                <span>{pos.symbol} · {pos.quantity} shares · avg cost ${fmt(pos.avgOpenPrice)} · current ${fmt(pos.currentPrice)}</span>
                <span className="text-amber-400 font-medium">{contracts} contract{contracts !== 1 ? 's' : ''}</span>
              </div>

              {/* Live chain table */}
              {chainQuery.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching live option chain from Tradier…
                </div>
              )}
              {chainQuery.isError && (
                <Alert className="border-red-800/40 bg-red-950/20">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <AlertDescription className="text-red-300 text-xs">
                    Could not load live chain: {chainQuery.error?.message}. Using cached strike from Position Analyzer.
                  </AlertDescription>
                </Alert>
              )}
              {chainStrikes.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="grid grid-cols-5 gap-0 text-xs text-muted-foreground bg-muted/20 px-3 py-1.5 font-medium">
                    <span>Strike</span>
                    <span className="text-right">Bid</span>
                    <span className="text-right">Ask</span>
                    <span className="text-right">Mid</span>
                    <span className="text-right">Credit</span>
                  </div>
                  {chainStrikes.map((s) => {
                    const isSelected = activeStrike?.strike === s.strike;
                    const isRecommended = recommendedStrike?.strike === s.strike;
                    return (
                      <button
                        key={s.strike}
                        onClick={() => setSelectedStrike(s)}
                        className={`w-full grid grid-cols-5 gap-0 px-3 py-2 text-sm text-left transition-colors border-t border-border/50 ${
                          isSelected
                            ? 'bg-emerald-950/50 border-l-2 border-l-emerald-500'
                            : 'hover:bg-muted/20'
                        }`}
                      >
                        <span className="font-semibold text-white flex items-center gap-1">
                          ${s.strike}
                          {s.isItm && <span className="text-amber-400 text-xs">(ITM)</span>}
                          {!s.isItm && <span className="text-blue-400 text-xs">(OTM)</span>}
                          {isRecommended && <span className="text-emerald-400 text-xs">★</span>}
                        </span>
                        <span className="text-right text-muted-foreground">${s.bid.toFixed(2)}</span>
                        <span className="text-right text-muted-foreground">${s.ask.toFixed(2)}</span>
                        <span className="text-right text-white font-medium">${s.mid.toFixed(2)}</span>
                        <span className="text-right text-emerald-400 font-semibold">${fmt(s.estimatedCredit100 * contracts, 0)}</span>
                      </button>
                    );
                  })}
                  <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/10 border-t border-border">
                    Expiration: <span className="text-white font-medium">{expiration}</span>
                    {chainQuery.data && <span className="ml-2 text-emerald-400">● Live</span>}
                    <span className="ml-1 text-muted-foreground">· ★ = WTR-recommended</span>
                  </div>
                </div>
              )}

              {/* Summary of selected strike */}
              {activeStrike && (() => {
                const effectiveExit = activeStrike.effectiveExit;
                const basis = pos.avgOpenPrice;
                const pnlPerShare = effectiveExit - basis;
                const pnlPct = basis > 0 ? (pnlPerShare / basis) * 100 : 0;
                const isLoss = pnlPerShare < 0;
                const isSignificantLoss = pnlPct < -10;
                return (
                  <>
                    <div className="rounded-lg bg-muted/20 border border-border p-3 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Selected Strike</span>
                        <span className="font-bold text-white">${activeStrike.strike} {activeStrike.isItm ? '(ITM)' : '(OTM)'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Limit Price (mid, nickel-rounded)</span>
                        <span className="font-semibold text-white">${activeStrike.mid.toFixed(2)}/share</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Estimated Credit ({contracts} contracts)</span>
                        <span className="text-emerald-400 font-bold text-base">${fmt(estimatedCredit, 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Effective Exit Price</span>
                        <span className="text-blue-400 font-semibold">${fmt(effectiveExit)} vs. ${fmt(pos.currentPrice)} today</span>
                      </div>
                      {/* Basis P&L row — color-coded */}
                      <div className="flex items-center justify-between border-t border-border pt-1.5">
                        <span className="text-muted-foreground text-xs">Exit vs. Your Basis (${fmt(basis)})</span>
                        <span className={`font-bold text-sm ${isLoss ? 'text-red-400' : 'text-emerald-400'}`}>
                          {isLoss ? '▼' : '▲'} ${Math.abs(pnlPerShare).toFixed(2)}/share ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                        </span>
                      </div>
                      {pos.weeksToRecover !== null && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-xs">Weeks to Recover Basis</span>
                          <span className={`font-semibold ${wtrColor(pos.weeksToRecover)}`}>{fmtWTR(pos.weeksToRecover, pos.monthsToRecover)}</span>
                        </div>
                      )}
                    </div>
                    {/* Basis-loss warning */}
                    {isSignificantLoss && (
                      <Alert className="border-red-800/60 bg-red-950/30">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                        <AlertDescription className="text-red-300 text-xs">
                          <strong>⚠️ This exit locks in a realized loss of ${Math.abs(pnlPerShare).toFixed(2)}/share ({Math.abs(pnlPct).toFixed(1)}% below your ${fmt(basis)} basis).</strong> The premium collected does not recover the gap between your cost basis and the strike. Confirm you intend to exit this position at a loss to free up capital.
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                );
              })()}

              {/* Dry Run toggle */}
              <div className="flex items-center justify-between rounded-lg bg-muted/10 border border-border px-3 py-2">
                <div>
                  <Label htmlFor="sell-dry-run" className="text-sm font-medium">Dry Run Mode</Label>
                  <p className="text-xs text-muted-foreground">Preview only — no real order placed</p>
                </div>
                <Switch id="sell-dry-run" checked={dryRun} onCheckedChange={setDryRun} />
              </div>

              {isForcedExit && lockedContracts > 0 && (
                <Alert className="border-red-800/40 bg-red-950/20">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <AlertDescription className="text-red-300 text-xs">
                    <strong>⚠️ Forced Exit — Locked Contracts:</strong> {lockedContracts} contract{lockedContracts > 1 ? 's' : ''} are already covered. This will create a double-covered position.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {/* ── Step 2: Confirm + OCC Display ── */}
          {step === 'confirm' && activeStrike && (
            <>
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
                    <div className="font-semibold text-white">${activeStrike.strike} {activeStrike.isItm ? '(ITM)' : '(OTM)'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Expiration</div>
                    <div className="font-semibold text-white">{expiration}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Contracts</div>
                    <div className="font-semibold text-white">{contracts}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Limit Price (mid)</div>
                    <div className="font-semibold text-white">${activeStrike.mid.toFixed(2)}/share</div>
                  </div>
                </div>
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">Estimated Credit</span>
                  <span className="text-emerald-400 font-bold text-base">${fmt(estimatedCredit, 0)}</span>
                </div>
                {/* Basis P&L row on confirm step */}
                {(() => {
                  const effectiveExit = activeStrike.effectiveExit;
                  const basis = pos.avgOpenPrice;
                  const pnlPerShare = effectiveExit - basis;
                  const pnlPct = basis > 0 ? (pnlPerShare / basis) * 100 : 0;
                  const isLoss = pnlPerShare < 0;
                  return (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Exit vs. Your Basis (${fmt(basis)})</span>
                      <span className={`font-bold text-sm ${isLoss ? 'text-red-400' : 'text-emerald-400'}`}>
                        {isLoss ? '▼' : '▲'} ${Math.abs(pnlPerShare).toFixed(2)}/share ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                      </span>
                    </div>
                  );
                })()}
                <div className="border-t border-border pt-2">
                  <div className="text-muted-foreground text-xs mb-1">OCC Contract Symbol</div>
                  <div className="font-mono text-xs bg-muted/30 rounded px-2 py-1.5 text-white tracking-wider">
                    {buildOCC(pos.symbol, expiration, activeStrike.strike)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">This is the exact contract that will be sent to Tastytrade.</div>
                </div>
              </div>

              {!dryRun && (
                <Alert className="border-amber-800/40 bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-amber-300 text-xs">
                    <strong>Live mode:</strong> This will submit a real Sell to Open order on Tastytrade. Make sure you have {pos.quantity} shares of {pos.symbol} in account ...{pos.accountNumber.slice(-4)}.
                  </AlertDescription>
                </Alert>
              )}

              {lastResult && (
                <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 p-3 text-xs text-emerald-300">
                  {lastResult}
                </div>
              )}
            </>
          )}

          {contracts === 0 && !isForcedExit && (
            <Alert className="border-amber-800/40 bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-amber-300 text-xs">
                <strong>All {totalContracts} contracts are already covered</strong> by an active short call.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'pick' ? (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleConfirmStep}
                disabled={!activeStrike || contracts === 0 || chainQuery.isLoading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Review Order →
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('pick')}>← Back</Button>
              <Button
                onClick={handleSubmit}
                disabled={sellMutation.isPending || contracts === 0}
                className={dryRun ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}
              >
                {sellMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
                ) : dryRun ? (
                  'Preview Order (Dry Run)'
                ) : (
                  '★ Confirm & Submit Live Order'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── WTR Trend Badge ─────────────────────────────────────────────────────────
function WtrTrendBadge({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.1) return null; // no meaningful change
  const worse = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0 rounded border ${
        worse
          ? 'bg-red-950/50 border-red-700/50 text-red-300'
          : 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
      }`}
      title={`WTR ${worse ? 'increased' : 'decreased'} by ${Math.abs(delta).toFixed(1)} wks since last scan`}
    >
      {worse ? <TrendingDown className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />}
      {worse ? '+' : ''}{delta.toFixed(1)} wks
    </span>
  );
}

// ─── Position Card ────────────────────────────────────────────────────────────
function PositionCard({
  pos,
  onSellCC,
  onSellDogCC,
  isFlagged,
  onToggleFlag,
  isFlagging,
  wtrHistory,
}: {
  pos: AnalyzedPosition;
  onSellCC: (pos: AnalyzedPosition) => void;
  onSellDogCC: (pos: AnalyzedPosition, forceQuantity: number) => void;
  isFlagged: boolean;
  onToggleFlag: (pos: AnalyzedPosition, flag: boolean) => void;
  isFlagging: boolean;
  wtrHistory?: Array<{ scanDate: string; weeksToRecover: number | null; recommendation: string }>;
}) {
  // Compute week-over-week WTR delta from the last two distinct scan dates
  const prevWTR: number | null = (() => {
    if (!wtrHistory || wtrHistory.length < 2) return null;
    // history is ordered newest-first; index 0 = current scan, index 1 = previous
    return wtrHistory[1].weeksToRecover;
  })();
  const cfg = REC_CONFIG[pos.recommendation];
  const totalContracts = Math.floor(pos.quantity / 100);
  const availableContracts = pos.availableContracts ?? totalContracts;
  const lockedContracts = totalContracts - availableContracts;
  const contracts = availableContracts;
  const canSellCC = pos.recommendation !== 'KEEP' && pos.ccAtmStrike !== null && pos.ccAtmPremium !== null && availableContracts > 0;
  const showFlagButton = pos.recommendation === 'HARVEST' || pos.recommendation === 'MONITOR' || pos.recommendation === 'LIQUIDATE';

  return (
    <div className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-4 space-y-3`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {cfg.icon}
          <span className="font-bold text-base text-white">{pos.symbol}</span>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${cfg.badgeClass}`}>
            {cfg.label}
          </Badge>
          {/* WTR badge — shown for non-KEEP positions */}
          {pos.weeksToRecover !== null && (
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 border-white/10 bg-black/20 ${wtrColor(pos.weeksToRecover)}`}>
              WTR: {fmtWTR(pos.weeksToRecover, pos.monthsToRecover)}
            </Badge>
          )}
          {/* WTR trend delta — week-over-week change */}
          <WtrTrendBadge current={pos.weeksToRecover} previous={prevWTR} />
          {/* CC-locked indicator */}
          {pos.recommendation !== 'KEEP' && availableContracts === 0 && lockedContracts > 0 && (() => {
            const calls = pos.openShortCalls ?? [];
            const soonest = calls.length > 0
              ? calls.reduce((min, c) => c.daysToExpiry < min.daysToExpiry ? c : min, calls[0])
              : null;
            const daysLeft = soonest ? soonest.daysToExpiry : null;
            const countdownLabel = daysLeft !== null
              ? (daysLeft <= 0 ? 'Expiring Today' : `${daysLeft}d left`)
              : null;
            return (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-amber-600/60 bg-amber-950/40 text-amber-300 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                CC Active{countdownLabel ? ` — ${countdownLabel}` : ' — Wait to Exit'}
              </Badge>
            );
          })()}
          {/* Liquidation flag toggle */}
          {showFlagButton && (
            <button
              onClick={() => !isFlagging && onToggleFlag(pos, !isFlagged)}
              disabled={isFlagging}
              style={isFlagged
                ? { border: '2px solid #ef4444', background: 'rgba(127,29,29,0.7)', color: '#fca5a5', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }
                : { border: '2px solid #f97316', background: 'rgba(154,52,18,0.25)', color: '#fdba74', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }
              }
            >
              {isFlagging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isFlagged ? (
                <ShieldAlert className="h-3.5 w-3.5" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" />
              )}
              {isFlagged ? '⛔ Flagged for Exit' : '🚩 Flag for Exit'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canSellCC && (
            <Button
              size="sm"
              onClick={() => onSellCC(pos)}
              className="h-7 px-2.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white border-0"
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              ★ Sell {pos.ccDeltaTier === 'ITM' ? 'ITM' : pos.ccDeltaTier === 'D30' ? 'Δ30' : pos.ccDeltaTier === 'D25' ? 'Δ25' : pos.ccDeltaTier === 'D20' ? 'Δ20' : 'ATM'} CC
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
          <div className="text-muted-foreground">Avg Cost</div>
          <div className="font-medium text-white">${fmt(pos.avgOpenPrice)}</div>
        </div>
        {pos.weeksToRecover !== null ? (
          <div className="space-y-0.5">
            <div className="text-muted-foreground">Weeks to Recover</div>
            <div className={`font-medium ${wtrColor(pos.weeksToRecover)}`}>
              {fmtWTR(pos.weeksToRecover, pos.monthsToRecover)}
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <div className="text-muted-foreground">52-Wk High</div>
            <div className={`font-medium ${pos.drawdownFromHigh <= -50 ? 'text-red-400' : pos.drawdownFromHigh <= -25 ? 'text-amber-400' : 'text-white'}`}>
              ${fmt(pos.week52High)} ({fmt(pos.drawdownFromHigh, 0)}%)
            </div>
          </div>
        )}
      </div>

      {/* CC premium row */}
      {pos.ccAtmPremium && pos.ccAtmStrike && (
        <div className="rounded-md bg-black/30 border border-white/5 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart3 className="h-3 w-3" />
            <span>
              {pos.ccDeltaTier === 'ITM' ? 'ITM Call (Exit)'
                : pos.ccDeltaTier === 'D30' ? 'Δ0.30 OTM Call (~1.5% OTM)'
                : pos.ccDeltaTier === 'D25' ? 'Δ0.25 OTM Call (~2.5% OTM)'
                : pos.ccDeltaTier === 'D20' ? 'Δ0.20 OTM Call (~3.5% OTM)'
                : 'ATM Call'}
              {' '}— {pos.ccExpiration}
            </span>
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

      {/* Liquidate / Sell ITM CC — for HARVEST and LIQUIDATE */}
      {(pos.recommendation === 'HARVEST' || pos.recommendation === 'LIQUIDATE') && (
        <div className="space-y-2">
          {pos.ccAtmStrike && pos.ccAtmPremium ? (
            <>
              {/* Normal path: contracts available */}
              {contracts > 0 && (
                <>
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
                  <Button
                    size="sm"
                    onClick={() => onSellCC(pos)}
                    className="w-full h-9 text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white border-0"
                  >
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Liquidate / Sell {pos.ccIsItm ? 'ITM' : 'ATM'} CC — Collect ${fmt(pos.ccAtmPremium * contracts * 100, 0)} Premium
                  </Button>
                </>
              )}
              {/* Forced exit path: all contracts locked but this is a Dog — allow override */}
              {contracts === 0 && pos.recommendation === 'LIQUIDATE' && (
                <div className="rounded-md bg-red-950/20 border border-red-800/40 p-2.5 text-xs space-y-2">
                  <div className="text-red-300 font-medium uppercase tracking-wide text-[10px] flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Dog — All {lockedContracts} Contract{lockedContracts !== 1 ? 's' : ''} Locked Under Active CC
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <div className="text-muted-foreground">ITM Strike</div>
                      <div className="font-bold text-white">${fmt(pos.ccAtmStrike)} <span className="text-red-400">(ITM)</span></div>
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
                      <div className="font-bold text-emerald-400">${fmt(pos.ccAtmPremium * totalContracts * 100, 0)}</div>
                    </div>
                  </div>
                  <div className="text-xs text-red-300/70">
                    Existing CC expires in {pos.openShortCalls?.[0]?.daysToExpiry ?? '?'}d. You can sell the exit ITM CC now and accept double-coverage, or wait for the existing CC to expire first.
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onSellDogCC(pos, totalContracts)}
                    className="w-full h-9 text-sm font-semibold bg-red-800 hover:bg-red-700 text-white border-0"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    ⛔ Force Exit — Sell ITM CC ({totalContracts} contracts) — ${fmt(pos.ccAtmPremium * totalContracts * 100, 0)} Premium
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-md border border-white/10 bg-black/20 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 shrink-0" />
              <span>Loading covered call data for {pos.symbol}… Refresh to retry.</span>
            </div>
          )}
        </div>
      )}

      {/* MONITOR — sparkline + informational note */}
      {pos.recommendation === 'MONITOR' && (
        <div className="space-y-2">
          {wtrHistory && wtrHistory.length > 0 && (
            <WtrSparkline
              history={wtrHistory}
              currentWtr={pos.weeksToRecover}
            />
          )}
          <div className="rounded-md border border-sky-800/30 bg-sky-950/20 p-2.5 text-xs text-sky-300 flex items-start gap-2">
            <Eye className="h-3.5 w-3.5 mt-0.5 shrink-0 text-sky-400" />
            <span>
              Watching — reassess monthly. If WTR exceeds 52 weeks on next scan, this position will automatically surface as a dog for liquidation.
            </span>
          </div>
        </div>
      )}

      {/* Account badge row */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Acct: ...{pos.accountNumber.slice(-4)}</span>
        <span className="text-[10px] text-muted-foreground">({pos.accountType})</span>
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

  const eligiblePositions = positions.filter(p => {
    const key = `${p.symbol}-${p.accountNumber}`;
    return flaggedSet.has(key) &&
      p.recommendation !== 'KEEP' &&
      p.recommendation !== 'MONITOR' &&
      p.ccAtmStrike !== null &&
      p.ccAtmPremium !== null &&
      p.ccExpiration !== null &&
      (p.availableContracts ?? Math.floor(p.quantity / 100)) > 0;
  });

  const totalEstimatedCredit = eligiblePositions.reduce((sum, p) => {
    const contracts = p.availableContracts ?? Math.floor(p.quantity / 100);
    return sum + (p.ccAtmPremium! * contracts * 100);
  }, 0);

  const roundToNickel = (price: number) => Math.round(price * 20) / 20;

  const handleSubmit = () => {
    setResult(null);
    batchMutation.mutate({
      orders: eligiblePositions.map(p => ({
        accountNumber: p.accountNumber,
        symbol: p.symbol,
        strike: p.ccAtmStrike!,
        expiration: p.ccExpiration!,
        quantity: p.availableContracts ?? Math.floor(p.quantity / 100),
        limitPrice: roundToNickel(p.ccAtmPremium!),
      })),
      dryRun,
    });
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) { onClose(); setResult(null); } }}>
      <DialogContent className="max-w-lg bg-card" style={{ border: '2px solid #374151', boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 25px 50px rgba(0,0,0,0.8)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-emerald-400" />
            Sell All Flagged &amp; Eligible
          </DialogTitle>
          <DialogDescription>
            Queue ITM covered call orders for {eligiblePositions.length} flagged-for-exit position{eligiblePositions.length !== 1 ? 's' : ''} with available contracts. Only HARVEST/LIQUIDATE positions you've marked ⛔ Flagged for Exit are included.
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
          <Button variant="outline" onClick={() => { onClose(); setResult(null); }}>
            {result && !dryRun ? 'Close' : 'Cancel'}
          </Button>
          {!(result && !dryRun) && (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FilterType = 'ALL' | Recommendation | 'ELIGIBLE';

// ─── Main Tab Component ───────────────────────────────────────────────────────
export function PositionAnalyzerTab() {
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [sellDialog, setSellDialog] = useState<SellCCDialogState>({ open: false, position: null, dryRun: true });
  const [batchDialog, setBatchDialog] = useState<BatchSellDialogState>({ open: false, dryRun: true });
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);

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

  const { data: trendData } = trpc.positionAnalyzer.getWtrTrend.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const wtrTrend = trendData?.trend ?? {};

  const { data: digestSettings } = trpc.positionAnalyzer.getDigestSettings.useQuery();
  const updateDigest = trpc.positionAnalyzer.updateDigestSettings.useMutation({
    onSuccess: (d) => {
      toast.success(d.weeklyPositionDigestEnabled
        ? 'Weekly digest enabled — you\'ll receive a Monday morning summary'
        : 'Weekly digest disabled');
    },
  });

  const positions = data?.positions ?? [];
  const summary = data?.summary;
  const eligibleNow = positions.filter(
    p => (p.recommendation === 'HARVEST' || p.recommendation === 'LIQUIDATE') &&
      ((p as AnalyzedPosition).availableContracts ?? Math.floor(p.quantity / 100)) > 0
  );
  const filtered = filter === 'ALL'
    ? positions
    : filter === 'ELIGIBLE'
      ? eligibleNow
      : positions.filter(p => p.recommendation === filter);

  const handleRefresh = () => {
    refetch();
    toast.info('Refreshing position analysis…');
  };

  const handleExport = () => {
    if (positions.length === 0) {
      toast.error('No positions to export — run a scan first');
      return;
    }
    exportToCSV(positions, data?.scannedAt ?? new Date().toISOString());
    toast.success(`Exported ${positions.length} positions to CSV`);
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
            Scores every stock position by <strong className="text-white">Weeks-to-Recover (WTR)</strong> — how many weeks of CC premium it takes to recover the cost-basis deficit. WTR ≤16 wks = Harvest, 17–52 wks = Monitor, &gt;52 wks = Liquidate.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
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
          {/* Export CSV */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={positions.length === 0}
            title="Export all positions to CSV for offline review"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards — 5 cards now (added MONITOR) */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
          <Card className="bg-sky-950/20 border-sky-800/30">
            <CardContent className="p-3">
              <div className="text-xs text-sky-400">Monitor</div>
              <div className="text-2xl font-bold text-sky-300 mt-1">{(summary as any).monitorCount ?? 0}</div>
              <div className="text-xs text-sky-400/70 mt-1">
                4–12 mo to recover
              </div>
            </CardContent>
          </Card>
          <Card className="bg-amber-950/20 border-amber-800/30">
            <CardContent className="p-3">
              <div className="text-xs text-amber-400">Harvest</div>
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

      {/* Clearing the Dogs — progress bar */}
      {flaggedSet.size > 0 && (() => {
        const totalFlagged = flaggedSet.size;
        const clearedCount = positions.filter(p => {
          const key = `${p.symbol}-${p.accountNumber}`;
          if (!flaggedSet.has(key)) return false;
          const available = (p as AnalyzedPosition).availableContracts ?? Math.floor(p.quantity / 100);
          return available === 0;
        }).length;
        const pct = totalFlagged > 0 ? Math.round((clearedCount / totalFlagged) * 100) : 0;
        const flaggedEligible = positions.filter(p => {
          const key = `${p.symbol}-${p.accountNumber}`;
          return flaggedSet.has(key)
            && (p.recommendation === 'HARVEST' || p.recommendation === 'LIQUIDATE')
            && p.ccAtmStrike !== null
            && p.ccAtmPremium !== null
            && p.ccExpiration !== null
            && ((p as AnalyzedPosition).availableContracts ?? Math.floor(p.quantity / 100)) > 0;
        });
        const sellableCount = flaggedEligible.length;
        return (
          <div className="rounded-lg border border-orange-800/40 bg-orange-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-orange-400" />
                <span className="text-sm font-semibold text-orange-300">Clearing the Dogs</span>
                <span className="text-xs text-muted-foreground">— {clearedCount} of {totalFlagged} flagged positions covered or exited</span>
              </div>
              <span className="text-sm font-bold text-orange-300">{pct}%</span>
            </div>
            <div className="space-y-1.5">
              <Progress value={pct} className="h-3 bg-orange-950/50" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{totalFlagged} flagged for exit &middot; {clearedCount} cleared</span>
                <span>
                  {pct === 100
                    ? '✅ All flagged dogs cleared!'
                    : `${totalFlagged - clearedCount} still need exit CCs or liquidation`
                  }
                </span>
              </div>
            </div>
            {sellableCount > 0 && (
              <Button
                size="sm"
                onClick={() => setBatchDialog({ open: true, dryRun: true })}
                className="bg-emerald-700 hover:bg-emerald-600 text-white border-0 text-xs h-8"
              >
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Sell All Flagged &amp; Eligible ({sellableCount})
              </Button>
            )}
          </div>
        );
      })()}

      {/* Filter tabs — includes MONITOR */}
      {positions.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={() => setFilter('ELIGIBLE')}
            style={filter === 'ELIGIBLE'
              ? { background: 'rgba(22,101,52,0.7)', border: '2px solid #16a34a', color: '#86efac', fontWeight: 700 }
              : { background: 'transparent', border: '2px solid #16a34a', color: '#16a34a', fontWeight: 700 }
            }
            className="px-3 py-1.5 rounded-md text-xs transition-colors hover:opacity-90"
          >
            ⚡ Eligible Now ({eligibleNow.length})
          </button>
          <span className="text-white/20 text-xs">|</span>
          {(['ALL', 'LIQUIDATE', 'MONITOR', 'HARVEST', 'KEEP'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? f === 'ALL' ? 'bg-white/10 text-white'
                    : f === 'LIQUIDATE' ? 'bg-red-900/60 text-red-300'
                    : f === 'MONITOR' ? 'bg-sky-900/60 text-sky-300'
                    : f === 'HARVEST' ? 'bg-amber-900/60 text-amber-300'
                    : 'bg-emerald-900/60 text-emerald-300'
                  : 'text-muted-foreground hover:text-white hover:bg-white/5'
              }`}
            >
              {f === 'ALL' ? `All (${positions.length})`
                : f === 'LIQUIDATE' ? `Liquidate (${summary?.liquidateCount ?? 0})`
                : f === 'MONITOR' ? `Monitor (${(summary as any)?.monitorCount ?? 0})`
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
                pos={pos as AnalyzedPosition}
                onSellCC={(p) => setSellDialog({ open: true, position: p, dryRun: true })}
                onSellDogCC={(p, forceQty) => setSellDialog({ open: true, position: p, dryRun: true, forceQuantity: forceQty })}
                isFlagged={flaggedSet.has(flagKey)}
                onToggleFlag={handleToggleFlag}
                isFlagging={flaggingKey === flagKey}
                wtrHistory={wtrTrend[`${pos.symbol}-${pos.accountNumber}`]}
              />
            );
          })}
        </div>
      )}

      {data?.scannedAt && (
        <p className="text-xs text-muted-foreground text-center">
          Last scanned: {new Date(data.scannedAt).toLocaleString()}
          {positions.length > 0 && (
            <button
              onClick={handleExport}
              className="ml-3 text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              Export CSV
            </button>
          )}
        </p>
      )}

      <SellCCDialog
        state={sellDialog}
        onClose={() => setSellDialog({ open: false, position: null, dryRun: true })}
      />

      <BatchSellDialog
        state={batchDialog}
        positions={positions as AnalyzedPosition[]}
        flaggedSet={flaggedSet}
        onClose={() => setBatchDialog({ open: false, dryRun: true })}
      />
    </div>
  );
}
