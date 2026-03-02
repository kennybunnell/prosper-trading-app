/**
 * Portfolio Safety Tab Component
 *
 * Full-page tab for the Action Items page.
 * Shows all IRA/cash account violations and provides one-click fix actions:
 *
 *  SHORT_STOCK       → "Buy to Cover" button (market buy of short shares)
 *  NAKED_SHORT_CALL  → "Close Call (BTC)" button (market BTC of the option)
 *  ORPHANED_SHORT_LEG → "Close Leg (BTC)" button (market BTC of the option)
 *  ITM_ASSIGNMENT_RISK → "Close Now (BTC)" + "Roll Out" buttons
 *
 * Each fix action shows a confirmation dialog (dry-run preview) before live execution.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  TrendingDown,
  X,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  History,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';

type ViolationType = 'SHORT_STOCK' | 'NAKED_SHORT_CALL' | 'ORPHANED_SHORT_LEG' | 'ITM_ASSIGNMENT_RISK';

interface IraViolation {
  violationType: ViolationType;
  severity: 'critical' | 'warning';
  accountNumber: string;
  accountType: string;
  symbol: string;
  description: string;
  action: string;
  sharesShort?: number;
  optionSymbol?: string;
  strike?: number;
  expiration?: string;
  dte?: number;
  itmPct?: number;
  stockPrice?: number;
  strikeDistancePct?: number;
}

// ── Fix confirmation dialog ───────────────────────────────────────────────────

interface FixDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  dryRun: boolean;
  onConfirm: () => void;
  isSubmitting: boolean;
  lastResult: { message: string; orderId: string | null } | null;
}

function FixDialog({ open, onClose, title, description, dryRun, onConfirm, isSubmitting, lastResult }: FixDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dryRun ? (
              <><BookOpen className="h-4 w-4 text-amber-400" /> Dry Run Preview</>
            ) : (
              <><ShieldAlert className="h-4 w-4 text-red-400" /> Live Order Confirmation</>
            )}
          </DialogTitle>
          <DialogDescription className="text-left">{description}</DialogDescription>
        </DialogHeader>

        {!dryRun && (
          <Alert className="border-red-500/30 bg-red-950/20">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <AlertTitle className="text-red-400 text-sm">Live Mode</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              This will submit a real market order to Tastytrade. Market orders execute immediately at the current best price.
            </AlertDescription>
          </Alert>
        )}

        {lastResult && (
          <div className={`rounded p-3 text-sm ${lastResult.orderId ? 'bg-green-900/20 border border-green-500/30 text-green-400' : 'bg-amber-900/20 border border-amber-500/30 text-amber-400'}`}>
            <p className="font-medium">{lastResult.message}</p>
            {lastResult.orderId && (
              <p className="text-xs text-muted-foreground mt-1">Order ID: {lastResult.orderId}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {lastResult ? 'Close' : 'Cancel'}
          </Button>
          {!lastResult && (
            <Button
              onClick={onConfirm}
              disabled={isSubmitting}
              className={dryRun ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}
            >
              {isSubmitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting...</>
              ) : dryRun ? (
                'Preview Order'
              ) : (
                'Submit Live Order'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Individual violation card with fix actions ────────────────────────────────

type FixAction = 'buyToCover' | 'closeOption' | 'buyProtectivePut' | 'buyLongCall';

function ViolationCard({ violation, dryRun, onSnoozed }: { violation: IraViolation; dryRun: boolean; onSnoozed?: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<FixAction | null>(null);
  const [lastResult, setLastResult] = useState<{ message: string; orderId: string | null } | null>(null);
  const [snoozed, setSnoozed] = useState(false);

  const isCritical = violation.severity === 'critical';
  const dte = violation.dte ?? 999;

  const utils = trpc.useUtils();

  const snooze = trpc.safeguards.snoozeViolation.useMutation({
    onSuccess: () => {
      setSnoozed(true);
      toast.success(`${violation.symbol} ITM risk snoozed for 24 hours`);
      setTimeout(() => {
        utils.iraSafety.scanViolations.invalidate();
        onSnoozed?.();
      }, 1500);
    },
    onError: (err) => toast.error(`Snooze failed: ${err.message}`),
  });

  const buyToCover = trpc.iraSafety.buyToCoverShortStock.useMutation({
    onSuccess: (data) => {
      setLastResult({ message: data.message, orderId: data.orderId });
      data.dryRun ? toast.info(`Dry run: ${data.message}`) : toast.success(`Order submitted: ${data.message}`);
    },
    onError: (err) => { toast.error(`Failed: ${err.message}`); setDialogOpen(false); },
  });

  const closeOption = trpc.iraSafety.closeShortOption.useMutation({
    onSuccess: (data) => {
      setLastResult({ message: data.message, orderId: data.orderId });
      data.dryRun ? toast.info(`Dry run: ${data.message}`) : toast.success(`Order submitted: ${data.message}`);
    },
    onError: (err) => { toast.error(`Failed: ${err.message}`); setDialogOpen(false); },
  });

  const buyProtectivePut = trpc.iraSafety.buyProtectivePut.useMutation({
    onSuccess: (data) => {
      setLastResult({ message: data.message, orderId: data.orderId });
      data.dryRun ? toast.info(`Dry run: ${data.message}`) : toast.success(`Order submitted: ${data.message}`);
    },
    onError: (err) => { toast.error(`Failed: ${err.message}`); setDialogOpen(false); },
  });

  const buyLongCall = trpc.iraSafety.buyLongCall.useMutation({
    onSuccess: (data) => {
      setLastResult({ message: data.message, orderId: data.orderId });
      data.dryRun ? toast.info(`Dry run: ${data.message}`) : toast.success(`Order submitted: ${data.message}`);
    },
    onError: (err) => { toast.error(`Failed: ${err.message}`); setDialogOpen(false); },
  });

  const isSubmitting = buyToCover.isPending || closeOption.isPending || buyProtectivePut.isPending || buyLongCall.isPending;

  const handleConfirm = () => {
    if (pendingAction === 'buyToCover' && violation.sharesShort) {
      buyToCover.mutate({ accountNumber: violation.accountNumber, symbol: violation.symbol, sharesShort: violation.sharesShort, dryRun });
    } else if (pendingAction === 'closeOption' && violation.optionSymbol) {
      closeOption.mutate({ accountNumber: violation.accountNumber, symbol: violation.symbol, optionSymbol: violation.optionSymbol, quantity: 1, dryRun });
    } else if (pendingAction === 'buyProtectivePut' && violation.strike && violation.expiration) {
      buyProtectivePut.mutate({ accountNumber: violation.accountNumber, symbol: violation.symbol, shortStrike: violation.strike, expiration: violation.expiration, quantity: 1, dryRun });
    } else if (pendingAction === 'buyLongCall' && violation.strike && violation.expiration) {
      buyLongCall.mutate({ accountNumber: violation.accountNumber, symbol: violation.symbol, shortStrike: violation.strike, expiration: violation.expiration, quantity: 1, dryRun });
    }
  };

  const openFix = (action: FixAction) => {
    setPendingAction(action);
    setLastResult(null);
    setDialogOpen(true);
  };

  const getDialogDescription = () => {
    if (pendingAction === 'buyToCover')
      return `Submit a market order to buy ${violation.sharesShort} shares of ${violation.symbol} in account ...${violation.accountNumber.slice(-4)}. This will satisfy the SL call and close the short stock position.`;
    if (pendingAction === 'closeOption')
      return `Submit a market Buy to Close (BTC) order for 1 contract of ${violation.optionSymbol} in account ...${violation.accountNumber.slice(-4)}. This will close the short option position immediately.`;
    if (pendingAction === 'buyProtectivePut')
      return `Buy a lower-strike put option (~5% below $${violation.strike}) at the same expiration to restore spread protection on ${violation.symbol}. This converts the orphaned short put back into a Bull Put Spread.`;
    if (pendingAction === 'buyLongCall')
      return `Buy a higher-strike call option (~5% above $${violation.strike}) at the same expiration to cap risk on the naked short call on ${violation.symbol}. This converts it into a Bear Call Spread.`;
    return '';
  };

  const VIOLATION_ICONS: Record<ViolationType, React.ReactNode> = {
    SHORT_STOCK: <TrendingDown className="h-4 w-4" />,
    NAKED_SHORT_CALL: <ShieldAlert className="h-4 w-4" />,
    ORPHANED_SHORT_LEG: <AlertTriangle className="h-4 w-4" />,
    ITM_ASSIGNMENT_RISK: <AlertTriangle className="h-4 w-4" />,
  };

  const VIOLATION_LABELS: Record<ViolationType, string> = {
    SHORT_STOCK: 'Short Stock (SL Call)',
    NAKED_SHORT_CALL: 'Naked Short Call',
    ORPHANED_SHORT_LEG: 'Orphaned Short Leg',
    ITM_ASSIGNMENT_RISK: 'Assignment Risk',
  };

  return (
    <>
      <div className={`rounded-lg border p-4 ${
        isCritical
          ? 'border-red-500/50 bg-red-950/30'
          : 'border-amber-500/30 bg-amber-950/20'
      }`}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <span className={isCritical ? 'text-red-400' : 'text-amber-400'}>
              {VIOLATION_ICONS[violation.violationType]}
            </span>
            <Badge
              variant="outline"
              className={`text-xs font-bold ${isCritical ? 'border-red-500 text-red-400' : 'border-amber-500 text-amber-400'}`}
            >
              {isCritical ? '🚨 CRITICAL' : '⚠️ WARNING'}
            </Badge>
            <span className="font-bold text-sm">{violation.symbol}</span>
            <Badge variant="secondary" className="text-xs">{VIOLATION_LABELS[violation.violationType]}</Badge>
            <span className="text-xs text-muted-foreground">Acct: ...{violation.accountNumber.slice(-4)}</span>
            {violation.accountType && (
              <span className="text-xs text-muted-foreground">({violation.accountType})</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>

        {expanded && (
          <div className="mt-3 space-y-3">
            {/* Description */}
            <p className="text-sm text-muted-foreground leading-relaxed">{violation.description}</p>

            {/* Required action text */}
            <div className={`rounded p-3 text-sm ${
              isCritical ? 'bg-red-900/30 border border-red-500/20' : 'bg-amber-900/20 border border-amber-500/20'
            }`}>
              <span className="font-semibold">Required Action: </span>
              <span className="text-muted-foreground">{violation.action}</span>
            </div>

            {/* Position context row — strike, stock price, distance, expiry, DTE */}
            {(violation.strike || violation.expiration || violation.dte !== undefined || violation.sharesShort) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {violation.strike && (
                  <span>Strike: <strong className="text-foreground">${violation.strike}</strong></span>
                )}
                {violation.stockPrice && (
                  <span>Stock: <strong className="text-foreground">${violation.stockPrice.toFixed(2)}</strong></span>
                )}
                {violation.stockPrice && violation.strike && violation.strikeDistancePct !== undefined && (
                  <span className={`font-semibold ${
                    violation.strikeDistancePct >= 2 ? 'text-emerald-400' :
                    violation.strikeDistancePct >= 0 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {violation.strikeDistancePct >= 0
                      ? `${violation.strikeDistancePct.toFixed(1)}% OTM`
                      : `${Math.abs(violation.strikeDistancePct).toFixed(1)}% ITM`
                    }
                  </span>
                )}
                {violation.expiration && <span>Exp: <strong>{violation.expiration}</strong></span>}
                {violation.dte !== undefined && (
                  <span>DTE: <strong className={violation.dte <= 2 ? 'text-red-400' : 'text-amber-400'}>{violation.dte}</strong></span>
                )}
                {violation.sharesShort && (
                  <span>Shares short: <strong className="text-red-400">-{violation.sharesShort}</strong></span>
                )}
              </div>
            )}

            {/* Contextual narrative — plain-English situation summary */}
            {(() => {
              const { violationType: vt, stockPrice: sp, strike, strikeDistancePct: dist, dte: d, sharesShort } = violation;
              const distStr = dist !== undefined ? `${Math.abs(dist).toFixed(1)}%` : null;
              const dirStr  = dist !== undefined ? (dist >= 0 ? 'OTM' : 'ITM') : null;
              if (vt === 'ITM_ASSIGNMENT_RISK' && sp && strike) {
                const riskLevel = dist !== undefined && dist < 0 ? 'high' : dist !== undefined && dist < 2 ? 'moderate' : 'low';
                const riskColor = riskLevel === 'high' ? 'text-red-400' : riskLevel === 'moderate' ? 'text-amber-400' : 'text-emerald-400';
                return (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-amber-500/40 pl-2">
                    <span className={`font-semibold ${riskColor}`}>Assignment risk is {riskLevel}.</span>{' '}
                    {violation.symbol} is currently ${sp.toFixed(2)}, which is{' '}
                    {distStr && dirStr ? <><strong className={riskColor}>{distStr} {dirStr}</strong> of the ${strike} strike</> : <>near the ${strike} strike</>}.
                    {d !== undefined && d <= 1 ? ' Expiration is TODAY — act before market close.' :
                     d !== undefined && d <= 2 ? ` Only ${d} day${d !== 1 ? 's' : ''} to expiration — close or roll soon.` :
                     ` With ${d} DTE, you have a short window to act.`}
                  </p>
                );
              }
              if (vt === 'ORPHANED_SHORT_LEG' && sp && strike) {
                return (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-amber-500/40 pl-2">
                    {violation.symbol} is at ${sp.toFixed(2)}{distStr && dirStr ? <>, <strong>{distStr} {dirStr}</strong> of the ${strike} short put strike</> : ''}.
                    {' '}The long put that was protecting this position is gone.
                    {d !== undefined && d > 7
                      ? ' With enough time remaining, buying a new protective put to restore the spread is the most capital-efficient fix.'
                      : ' Close to expiration — buying back the short put outright is faster and cleaner.'}
                  </p>
                );
              }
              if (vt === 'NAKED_SHORT_CALL' && sp && strike) {
                return (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-red-500/40 pl-2">
                    {violation.symbol} is at ${sp.toFixed(2)}{distStr && dirStr ? <>, <strong>{distStr} {dirStr}</strong> of the ${strike} short call strike</> : ''}.
                    {' '}A naked short call in an IRA has unlimited upside risk.
                    {d !== undefined && d <= 5
                      ? ' With ≤5 DTE, closing outright is the safest move.'
                      : ' With time remaining, buying a higher-strike call to create a Bear Call Spread caps the risk without closing the position.'}
                  </p>
                );
              }
              if (vt === 'SHORT_STOCK' && sp && sharesShort) {
                const cost = sp * sharesShort;
                return (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-red-500/40 pl-2">
                    Buying {sharesShort} shares of {violation.symbol} at the current price of ${sp.toFixed(2)} would cost approximately <strong className="text-foreground">${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>.
                    {' '}This must be done before market close to satisfy the Tastytrade SL call.
                  </p>
                );
              }
              return null;
            })()}

            {/* ── Fix Action Buttons ── */}
            <div className="pt-1 border-t border-border/30 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">Fix options:</span>
                {dryRun && (
                  <span className="text-xs text-amber-400/70 italic">(Dry Run — no real order)</span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">

                {/* ── SHORT_STOCK: only one fix ── */}
                {violation.violationType === 'SHORT_STOCK' && violation.sharesShort && (
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 gap-1.5"
                    onClick={() => openFix('buyToCover')}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingDown className="h-3 w-3" />}
                    Buy to Cover ({violation.sharesShort} shares)
                    <span className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/40">★ REC</span>
                  </Button>
                )}

                {/* ── NAKED_SHORT_CALL: recommended first, then alternative ── */}
                {violation.violationType === 'NAKED_SHORT_CALL' && violation.optionSymbol && (
                  <>
                    {/* Recommended: BTC if DTE≤5, Buy Long Call if DTE>5 */}
                    {dte <= 5 ? (
                      <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-8 gap-1.5" onClick={() => openFix('closeOption')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Close (BTC) Short Call
                        <span className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/40">★ REC</span>
                      </Button>
                    ) : violation.strike && violation.expiration ? (
                      <Button size="sm" variant="outline" className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-950/30 text-xs h-8 gap-1.5" onClick={() => openFix('buyLongCall')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
                        Buy Long Call (→ BCS)
                        <span className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/40">★ REC</span>
                      </Button>
                    ) : null}
                    {/* Alternative */}
                    {dte <= 5 && violation.strike && violation.expiration && (
                      <Button size="sm" variant="outline" className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-950/30 text-xs h-8" onClick={() => openFix('buyLongCall')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
                        Buy Long Call (→ BCS)
                      </Button>
                    )}
                    {dte > 5 && (
                      <Button size="sm" variant="outline" className="border-orange-500/50 text-orange-400 hover:bg-orange-950/30 text-xs h-8" onClick={() => openFix('closeOption')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Close (BTC) Short Call
                      </Button>
                    )}
                  </>
                )}

                {/* ── ORPHANED_SHORT_LEG: recommended first, then alternative ── */}
                {violation.violationType === 'ORPHANED_SHORT_LEG' && violation.optionSymbol && (
                  <>
                    {/* Recommended: BTC if DTE≤7, Buy Protective Put if DTE>7 */}
                    {dte <= 7 ? (
                      <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-8 gap-1.5" onClick={() => openFix('closeOption')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Close (BTC) Short Put
                        <span className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/40">★ REC</span>
                      </Button>
                    ) : violation.strike && violation.expiration ? (
                      <Button size="sm" variant="outline" className="border-purple-500/50 text-purple-400 hover:bg-purple-950/30 text-xs h-8 gap-1.5" onClick={() => openFix('buyProtectivePut')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                        Buy Protective Put (→ BPS)
                        <span className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/40">★ REC</span>
                      </Button>
                    ) : null}
                    {/* Alternative */}
                    {dte <= 7 && violation.strike && violation.expiration && (
                      <Button size="sm" variant="outline" className="border-purple-500/50 text-purple-400 hover:bg-purple-950/30 text-xs h-8" onClick={() => openFix('buyProtectivePut')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                        Buy Protective Put (→ BPS)
                      </Button>
                    )}
                    {dte > 7 && (
                      <Button size="sm" variant="outline" className="border-orange-500/50 text-orange-400 hover:bg-orange-950/30 text-xs h-8" onClick={() => openFix('closeOption')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Close (BTC) Short Put
                      </Button>
                    )}
                  </>
                )}

                {/* ── ITM_ASSIGNMENT_RISK: BTC always recommended, Snooze as alt ── */}
                {violation.violationType === 'ITM_ASSIGNMENT_RISK' && violation.optionSymbol && (
                  <>
                    <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-8 gap-1.5" onClick={() => openFix('closeOption')} disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      Close (BTC) Short Call
                      <span className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/40">★ REC</span>
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="text-xs h-8 border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400"
                      onClick={() => snooze.mutate({ symbol: violation.symbol, accountNumber: violation.accountNumber, violationType: 'ITM_ASSIGNMENT_RISK' })}
                      disabled={snooze.isPending || snoozed}
                      title="Dismiss for 24h — only safe if you are certain the call will expire OTM"
                    >
                      {snooze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : snoozed ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <span className="text-xs">&#128164;</span>}
                      <span className="ml-1">{snoozed ? 'Snoozed' : 'Snooze 24h'}</span>
                    </Button>
                  </>
                )}

              </div>
            </div>

            {/* Last result feedback */}
            {lastResult && (
              <div className="rounded p-2 text-xs bg-green-900/20 border border-green-500/30 text-green-400">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                {lastResult.message}
                {lastResult.orderId && <span className="text-muted-foreground ml-2">Order: {lastResult.orderId}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      <FixDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); if (lastResult) setLastResult(null); }}
        title={pendingAction === 'buyToCover' ? 'Buy to Cover Short Stock' : 'Close Short Option (BTC)'}
        description={getDialogDescription()}
        dryRun={dryRun}
        onConfirm={handleConfirm}
        isSubmitting={isSubmitting}
        lastResult={lastResult}
      />
    </>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

export function IraSafetyTab() {
  const [dryRun, setDryRun] = useState(true);

  const { data, isLoading, refetch, isFetching } = trpc.iraSafety.scanViolations.useQuery(
    undefined,
    {
      refetchOnWindowFocus: false,
      staleTime: 2 * 60 * 1000,
    }
  );

  const hasViolations = data?.hasViolations ?? false;
  const criticalCount = data?.criticalCount ?? 0;
  const warningCount = data?.warningCount ?? 0;
  const snoozedCount = data?.snoozedCount ?? 0;
  const violations = data?.violations ?? [];

  const handleRefresh = () => {
    refetch();
    toast.info('Scanning all accounts for portfolio violations...');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-400" />
            Portfolio Safety Monitor
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Scans all accounts for violations that require immediate action — short stock, naked calls, orphaned legs, and assignment risks.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Dry Run toggle */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/20">
            <Switch
              id="ira-dry-run"
              checked={dryRun}
              onCheckedChange={setDryRun}
            />
            <Label htmlFor="ira-dry-run" className="text-xs cursor-pointer">
              {dryRun ? (
                <span className="text-amber-400 font-medium">Dry Run</span>
              ) : (
                <span className="text-red-400 font-medium">Live Mode</span>
              )}
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh Scan
          </Button>
        </div>
      </div>

      {/* Dry run notice */}
      {dryRun && (
        <Alert className="border-amber-500/30 bg-amber-950/20">
          <BookOpen className="h-4 w-4 text-amber-400" />
          <AlertTitle className="text-amber-400 text-sm">Dry Run Mode Active</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            Fix actions will preview orders without submitting them. Toggle off "Dry Run" above to enable live order submission.
          </AlertDescription>
        </Alert>
      )}

      {!dryRun && (
        <Alert className="border-red-500/40 bg-red-950/20">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <AlertTitle className="text-red-400 text-sm">Live Mode — Orders Will Execute</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            Fix actions will submit real market orders to Tastytrade. Each action requires a confirmation dialog before executing.
          </AlertDescription>
        </Alert>
      )}

      {/* Loading state */}
      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>Scanning all accounts for portfolio violations...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No violations */}
      {!isLoading && !hasViolations && (
        <Card className="border-green-500/30 bg-green-950/10">
          <CardContent className="flex items-center gap-4 py-8">
            <ShieldCheck className="h-10 w-10 text-green-400 shrink-0" />
            <div>
              <p className="font-semibold text-green-400">All Clear — No Violations Detected</p>
              <p className="text-sm text-muted-foreground mt-1">
                {data?.accountsScanned ?? 0} account{(data?.accountsScanned ?? 0) !== 1 ? 's' : ''} scanned.
                No short stock, naked calls, orphaned legs, or assignment risks found.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Violations list */}
      {!isLoading && hasViolations && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {data?.accountsScanned} account{(data?.accountsScanned ?? 0) !== 1 ? 's' : ''} scanned —
            </span>
            {criticalCount > 0 && (
              <Badge className="bg-red-600 hover:bg-red-600 text-white">
                {criticalCount} Critical Violation{criticalCount !== 1 ? 's' : ''}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="bg-amber-600 hover:bg-amber-600 text-white">
                {warningCount} Warning{warningCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {snoozedCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/40 rounded px-3 py-2 border border-slate-700/50">
              <span>&#128164;</span>
              <span>{snoozedCount} ITM risk warning{snoozedCount !== 1 ? 's' : ''} snoozed for 24h — they will reappear automatically.</span>
            </div>
          )}

          <div className="space-y-3">
            {violations.map((v, i) => (
              <ViolationCard
                key={`${v.accountNumber}-${v.symbol}-${v.violationType}-${i}`}
                violation={v}
                dryRun={dryRun}
                onSnoozed={refetch}
              />
            ))}
          </div>
        </>
      )}

      {/* Scan History Log */}
      <ScanHistoryPanel />

      {/* Education section — always visible */}
      <Card className="border-blue-500/20 bg-blue-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-blue-400 flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Understanding Portfolio Safety Violations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <p className="font-semibold text-foreground mb-1">🚨 Short Stock (SL Call) — The ADBE Incident Pattern</p>
            <p>When a short call is <strong>assigned</strong> and you don't own the underlying shares, the OCC creates short stock in your account. In IRA/cash accounts, this is prohibited. Tastytrade issues an <strong>SL (Short Restricted Strategy) call</strong> requiring you to buy the shares before market close — or they will liquidate at the worst possible price.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">🚨 Naked Short Call — Not Allowed in IRA</p>
            <p>A short call without owning 100 shares per contract is a naked call. IRAs only permit <strong>covered calls</strong> (you own the shares) or <strong>call spreads</strong> (you own a long call at a higher strike). A naked call has theoretically unlimited risk.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">⚠️ Orphaned Short Leg — Spread Lost Its Protection</p>
            <p>If the long leg of a Bull Put Spread or Bear Call Spread was closed, assigned, or expired, the short leg is now unprotected. What was a defined-risk spread is now a naked short — verify you have enough cash to cover assignment.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">⚠️ ITM Assignment Risk — Act Before Market Close</p>
            <p>Short calls that are in-the-money with 5 or fewer DTE have a high probability of being exercised overnight. If you don't own the shares, assignment will create short stock — triggering the SL call pattern. Close or roll before the market closes.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Scan History Panel ────────────────────────────────────────────────────────

type ScanSummaryEntry = {
  symbol?: string;
  violationType?: string;
  accountId?: string;
  accountName?: string;
  strike?: number;
  expiration?: string;
  dte?: number;
  sharesOwned?: number;
  sharesNeeded?: number;
  itmPct?: number;
  raw?: string;
};

function ScanHistoryPanel() {
  const { data: history, isLoading } = trpc.safeguards.getScanHistory.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Scan History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading scan history...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!history || history.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Scan History
          </CardTitle>
          <CardDescription className="text-xs">No scans recorded yet. Use the Test buttons in the Automation tab to run a scan.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Scan History
          <span className="text-xs font-normal text-muted-foreground ml-1">(last {history.length} runs)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/50">
          {history.map((entry) => {
            const date = new Date(entry.ranAt);
            const isFriday = entry.scanType === 'friday_sweep';
            const hasAlerts = entry.alertCount > 0;
            const isExpanded = expandedId === entry.id;

            let details: ScanSummaryEntry[] = [];
            if (entry.summaryJson) {
              try { details = JSON.parse(entry.summaryJson) as ScanSummaryEntry[]; } catch { /* ignore */ }
            }

            const VIOLATION_LABEL: Record<string, string> = {
              SHORT_STOCK: 'Short Stock',
              NAKED_SHORT_CALL: 'Naked Call',
              ORPHANED_SHORT_LEG: 'Orphaned Leg',
              ITM_ASSIGNMENT_RISK: 'ITM Risk',
            };

            return (
              <div key={entry.id}>
                {/* Row header */}
                <div
                  className={`flex items-center justify-between px-4 py-2.5 transition-colors ${
                    hasAlerts ? 'cursor-pointer hover:bg-amber-500/5' : 'hover:bg-muted/20'
                  }`}
                  onClick={() => hasAlerts && setExpandedId(isExpanded ? null : entry.id)}
                >
                  <div className="flex items-center gap-3">
                    <BarChart3 className={`h-3.5 w-3.5 ${isFriday ? 'text-blue-400' : 'text-violet-400'}`} />
                    <div>
                      <span className={`text-xs font-medium ${isFriday ? 'text-blue-400' : 'text-violet-400'}`}>
                        {isFriday ? 'Friday Sweep' : 'Daily Scan'}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {entry.triggeredBy === 'manual' ? '(manual)' : '(auto)'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasAlerts ? (
                      <span className="text-xs bg-amber-500/20 text-amber-300 rounded px-2 py-0.5">
                        {entry.alertCount} alert{entry.alertCount !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 rounded px-2 py-0.5 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Clean
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {date.toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                      {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {hasAlerts && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    )}
                  </div>
                </div>

                {/* Expandable details panel */}
                {isExpanded && hasAlerts && (
                  <div className="bg-muted/10 border-t border-border/30 px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Flagged positions
                    </p>
                    {details.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/30">
                              <th className="text-left pb-1.5 pr-3 font-medium">Symbol</th>
                              <th className="text-left pb-1.5 pr-3 font-medium">Violation</th>
                              <th className="text-left pb-1.5 pr-3 font-medium">Strike</th>
                              <th className="text-left pb-1.5 pr-3 font-medium">Expiration</th>
                              <th className="text-left pb-1.5 pr-3 font-medium">DTE</th>
                              <th className="text-left pb-1.5 font-medium">Account</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {details.map((d, i) => (
                              <tr key={i} className="hover:bg-muted/10">
                                <td className="py-1.5 pr-3 font-semibold text-amber-300">{d.symbol ?? '—'}</td>
                                <td className="py-1.5 pr-3 text-foreground/70">
                                  {d.violationType ? (VIOLATION_LABEL[d.violationType] ?? d.violationType) : '—'}
                                </td>
                                <td className="py-1.5 pr-3 text-foreground/70">{d.strike ? `$${d.strike}` : '—'}</td>
                                <td className="py-1.5 pr-3 text-foreground/70">{d.expiration ?? '—'}</td>
                                <td className="py-1.5 pr-3">
                                  {d.dte !== undefined ? (
                                    <span className={d.dte <= 2 ? 'text-red-400 font-semibold' : 'text-amber-400'}>
                                      {d.dte}d
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="py-1.5 text-foreground/70">
                                  {d.accountId ? `…${d.accountId.slice(-4)}` : '—'}
                                  {d.accountName ? ` (${d.accountName})` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No detailed breakdown available for this scan. Re-run a test scan to capture details.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
