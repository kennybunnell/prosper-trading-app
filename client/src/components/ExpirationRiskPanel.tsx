/**
 * ExpirationRiskPanel
 *
 * Safeguards 4 & 5: ITM Short Call Daily Scan + Friday Sweep
 *
 * Shows short calls expiring within DTE cutoff, sorted by urgency.
 * Provides one-click BTC (close) action for each alert.
 *
 * Used in:
 * - AutomationDashboard (above the six-step tabs) — runs daily scan
 * - Can also be triggered as Friday sweep from the Automation tab
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertTriangle,
  XCircle,
  CheckCircle,
  RefreshCw,
  Calendar,
  Shield,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ExpirationRiskPanelProps {
  mode?: 'daily' | 'friday';
  isDryRun?: boolean;
}

export function ExpirationRiskPanel({ mode = 'daily', isDryRun = true }: ExpirationRiskPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = trpc.safeguards.scanExpirationRisk.useQuery(
    { mode },
    { refetchOnWindowFocus: false }
  );

  const submitClose = trpc.orders.submitClose.useMutation({
    onSuccess: (result, variables) => {
      if (isDryRun) {
        toast.success(`[Dry Run] Would close ${variables.symbol} ${variables.closeLeg.optionType} $${variables.closeLeg.strike} — no real order placed`);
      } else {
        toast.success(`Close order submitted for ${variables.symbol} $${variables.closeLeg.strike} — Order ID: ${result.orderId}`);
      }
      setClosingSymbol(null);
      refetch();
    },
    onError: (err, variables) => {
      toast.error(`Failed to close ${variables.symbol}: ${err.message}`);
      setClosingSymbol(null);
    },
  });

  const handleClose = (alert: NonNullable<typeof data>['alerts'][0]) => {
    setClosingSymbol(alert.optionSymbol);
    submitClose.mutate({
      accountNumber: alert.accountNumber,
      symbol: alert.symbol,
      closeLeg: {
        action: 'BTC',
        quantity: 1,
        strike: alert.strike,
        expiration: alert.expiration,
        optionType: 'CALL',
        price: 0, // Market order — price will be set by Tastytrade
        optionSymbol: alert.optionSymbol,
      },
    });
  };

  const hasAlerts = data && data.hasAlerts;
  const uncoveredAlerts = data?.alerts.filter(a => !a.isCovered) ?? [];
  const coveredAlerts = data?.alerts.filter(a => a.isCovered) ?? [];

  const isFriday = new Date().getDay() === 5;
  const panelTitle = mode === 'friday'
    ? `Friday Expiration Sweep (Safeguard 5)`
    : `ITM Expiration Risk Scan (Safeguard 4)`;

  const panelDescription = mode === 'friday'
    ? `Scans all short calls expiring within 7 days — run every Friday to catch weekend assignment risk`
    : `Scans for short calls expiring within 5 days that may trigger overnight assignment`;

  return (
    <Card className={`border ${hasAlerts ? (uncoveredAlerts.length > 0 ? 'border-red-500/40 bg-red-950/10' : 'border-amber-500/40 bg-amber-950/10') : 'border-green-500/30 bg-green-950/10'}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className={`h-4 w-4 ${uncoveredAlerts.length > 0 ? 'text-red-500' : hasAlerts ? 'text-amber-500' : 'text-green-500'}`} />
            <CardTitle className="text-sm font-semibold">{panelTitle}</CardTitle>
            {mode === 'friday' && isFriday && (
              <Badge className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">Today is Friday</Badge>
            )}
            {isLoading || isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : hasAlerts ? (
              <div className="flex gap-1">
                {uncoveredAlerts.length > 0 && (
                  <Badge variant="destructive" className="text-xs">{uncoveredAlerts.length} Uncovered</Badge>
                )}
                {coveredAlerts.length > 0 && (
                  <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">{coveredAlerts.length} Covered</Badge>
                )}
              </div>
            ) : (
              <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">All Clear</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-7 px-2"
            >
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        {isExpanded && (
          <p className="text-xs text-muted-foreground mt-1">{panelDescription}</p>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning accounts for expiration risk...
            </div>
          ) : !hasAlerts ? (
            <div className="flex items-center gap-2 py-2 text-sm text-green-400">
              <CheckCircle className="h-4 w-4" />
              No short calls expiring within {data?.dteCutoff ?? 5} days. Safe to proceed.
              {data && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {data.accountsScanned} account{data.accountsScanned !== 1 ? 's' : ''} scanned
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              {/* Uncovered (critical) alerts first */}
              {uncoveredAlerts.map((alert, i) => (
                <div key={`uncovered-${i}`} className="rounded-lg border border-red-500/30 bg-red-950/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        <span className="text-sm font-semibold text-red-400">{alert.title}</span>
                        <Badge variant="outline" className="text-xs text-muted-foreground">{alert.accountType || 'Account'} ···{alert.accountNumber.slice(-4)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-2">{alert.description}</p>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-xs mb-2">
                        <div className="rounded bg-background/50 p-1.5">
                          <div className="text-muted-foreground">Strike</div>
                          <div className="font-medium">${alert.strike}</div>
                        </div>
                        <div className="rounded bg-background/50 p-1.5">
                          <div className="text-muted-foreground">Expires</div>
                          <div className="font-medium">{alert.expiration}</div>
                        </div>
                        <div className="rounded bg-background/50 p-1.5">
                          <div className="text-muted-foreground">DTE</div>
                          <div className={`font-medium ${alert.dte <= 1 ? 'text-red-400' : alert.dte <= 3 ? 'text-amber-400' : ''}`}>
                            {alert.dte} day{alert.dte !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="rounded bg-background/50 p-1.5">
                          <div className="text-muted-foreground">Owned</div>
                          <div className="font-medium">{alert.sharesOwned} sh</div>
                        </div>
                        <div className="rounded bg-background/50 p-1.5">
                          <div className="text-muted-foreground">Needed</div>
                          <div className="font-medium text-red-400">{alert.sharesNeeded} sh</div>
                        </div>
                      </div>
                      <p className="text-xs text-red-300 bg-red-900/20 rounded p-1.5 border border-red-500/20">
                        <span className="font-semibold">Action: </span>{alert.requiredAction}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="text-xs h-8"
                            disabled={closingSymbol === alert.optionSymbol}
                          >
                            {closingSymbol === alert.optionSymbol ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                            )}
                            Close (BTC)
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {isDryRun ? '[Dry Run] ' : ''}Close {alert.symbol} ${alert.strike} Call?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {isDryRun
                                ? `This is a dry run — no real order will be placed. This will simulate a Buy to Close (BTC) market order for the ${alert.symbol} $${alert.strike} call expiring ${alert.expiration}.`
                                : `This will submit a Buy to Close (BTC) MARKET order for the ${alert.symbol} $${alert.strike} call expiring ${alert.expiration}. The order will execute at the current market price.`
                              }
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleClose(alert)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {isDryRun ? 'Simulate Close' : 'Submit BTC Order'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}

              {/* Covered (warning) alerts */}
              {coveredAlerts.map((alert, i) => (
                <div key={`covered-${i}`} className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="text-sm font-semibold text-amber-400">{alert.title}</span>
                        <Badge variant="outline" className="text-xs text-muted-foreground">{alert.accountType || 'Account'} ···{alert.accountNumber.slice(-4)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-1">{alert.description}</p>
                      <div className="flex gap-3 text-xs">
                        <span>Strike: <strong>${alert.strike}</strong></span>
                        <span>Exp: <strong>{alert.expiration}</strong></span>
                        <span>DTE: <strong className={alert.dte <= 2 ? 'text-amber-400' : ''}>{alert.dte}</strong></span>
                        <span>Covered: <strong className="text-green-400">✓ {alert.sharesOwned} shares</strong></span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            disabled={closingSymbol === alert.optionSymbol}
                          >
                            {closingSymbol === alert.optionSymbol ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                              <Calendar className="h-3.5 w-3.5 mr-1" />
                            )}
                            Close Early
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {isDryRun ? '[Dry Run] ' : ''}Close {alert.symbol} ${alert.strike} Covered Call Early?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {isDryRun
                                ? `Dry run only. This covered call is fully covered (${alert.sharesOwned} shares). Closing early lets you keep the shares and avoid assignment.`
                                : `This will submit a Buy to Close (BTC) market order for the ${alert.symbol} $${alert.strike} covered call. You own ${alert.sharesOwned} shares — closing early lets you keep them and avoid assignment.`
                              }
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Leave Open</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleClose(alert)}>
                              {isDryRun ? 'Simulate Close' : 'Submit BTC Order'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted-foreground text-right">
                {data?.accountsScanned} account{data?.accountsScanned !== 1 ? 's' : ''} scanned · DTE cutoff: {data?.dteCutoff} days
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
