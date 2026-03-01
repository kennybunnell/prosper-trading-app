/**
 * Portfolio Safety Monitor Component
 *
 * Displays a real-time alert panel for IRA/cash account violations:
 *   - SHORT_STOCK: Negative equity position (SL call trigger — must close TODAY)
 *   - NAKED_SHORT_CALL: Uncovered short call in IRA
 *   - ORPHANED_SHORT_LEG: Short option whose paired long was closed/assigned
 *   - ITM_ASSIGNMENT_RISK: Short call ITM with ≤5 DTE (assignment likely tonight)
 *
 * Designed to sit at the top of the Automation Dashboard as a persistent
 * safety net — especially important for the ADBE incident pattern.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  TrendingDown,
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
}

const VIOLATION_LABELS: Record<ViolationType, string> = {
  SHORT_STOCK: 'Short Stock (SL Call)',
  NAKED_SHORT_CALL: 'Naked Short Call',
  ORPHANED_SHORT_LEG: 'Orphaned Short Leg',
  ITM_ASSIGNMENT_RISK: 'Assignment Risk',
};

const VIOLATION_ICONS: Record<ViolationType, React.ReactNode> = {
  SHORT_STOCK: <TrendingDown className="h-4 w-4" />,
  NAKED_SHORT_CALL: <ShieldAlert className="h-4 w-4" />,
  ORPHANED_SHORT_LEG: <AlertTriangle className="h-4 w-4" />,
  ITM_ASSIGNMENT_RISK: <AlertTriangle className="h-4 w-4" />,
};

function ViolationCard({ violation }: { violation: IraViolation }) {
  const [expanded, setExpanded] = useState(violation.severity === 'critical');
  const isCritical = violation.severity === 'critical';

  return (
    <div className={`rounded-lg border p-4 ${
      isCritical
        ? 'border-red-500/50 bg-red-950/30'
        : 'border-amber-500/30 bg-amber-950/20'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={isCritical ? 'text-red-400' : 'text-amber-400'}>
            {VIOLATION_ICONS[violation.violationType]}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={`text-xs font-semibold ${
                isCritical
                  ? 'border-red-500 text-red-400'
                  : 'border-amber-500 text-amber-400'
              }`}
            >
              {isCritical ? '🚨 CRITICAL' : '⚠️ WARNING'}
            </Badge>
            <span className="font-bold text-sm">{violation.symbol}</span>
            <Badge variant="secondary" className="text-xs">
              {VIOLATION_LABELS[violation.violationType]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Acct: ...{violation.accountNumber.slice(-4)}
            </span>
            {violation.accountType && (
              <span className="text-xs text-muted-foreground">({violation.accountType})</span>
            )}
          </div>
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
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {violation.description}
          </p>
          <div className={`rounded p-3 text-sm ${
            isCritical ? 'bg-red-900/30 border border-red-500/20' : 'bg-amber-900/20 border border-amber-500/20'
          }`}>
            <span className="font-semibold">Required Action: </span>
            <span className="text-muted-foreground">{violation.action}</span>
          </div>
          {violation.violationType === 'SHORT_STOCK' && violation.sharesShort && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Shares short: <strong className="text-red-400">-{violation.sharesShort}</strong></span>
            </div>
          )}
          {violation.strike && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {violation.strike && <span>Strike: <strong>${violation.strike}</strong></span>}
              {violation.expiration && <span>Exp: <strong>{violation.expiration}</strong></span>}
              {violation.dte !== undefined && (
                <span>DTE: <strong className={violation.dte <= 2 ? 'text-red-400' : 'text-amber-400'}>{violation.dte}</strong></span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IraSafetyMonitor() {
  const [isOpen, setIsOpen] = useState(true);

  const { data, isLoading, refetch, isFetching } = trpc.iraSafety.scanViolations.useQuery(
    undefined,
    {
      refetchOnWindowFocus: false,
      staleTime: 2 * 60 * 1000, // 2 minutes
    }
  );

  const hasViolations = data?.hasViolations ?? false;
  const criticalCount = data?.criticalCount ?? 0;
  const warningCount = data?.warningCount ?? 0;
  const violations = data?.violations ?? [];

  const handleRefresh = () => {
    refetch();
    toast.info('Scanning accounts for IRA violations...');
  };

  // If no violations and not loading, show a compact green status bar
  if (!isLoading && !hasViolations) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-green-500/20 bg-green-950/20 text-sm">
        <ShieldCheck className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-green-400 font-medium">Portfolio Safety Check: No violations detected</span>
        <span className="text-muted-foreground text-xs ml-1">
          ({data?.accountsScanned ?? 0} account{(data?.accountsScanned ?? 0) !== 1 ? 's' : ''} scanned)
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 ml-auto text-xs text-muted-foreground hover:text-foreground"
          onClick={handleRefresh}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
        <span>Scanning accounts for IRA violations...</span>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={`border-2 ${criticalCount > 0 ? 'border-red-500/60' : 'border-amber-500/40'}`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/10 transition-colors pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert className={`h-5 w-5 ${criticalCount > 0 ? 'text-red-400' : 'text-amber-400'}`} />
                <CardTitle className={`text-base ${criticalCount > 0 ? 'text-red-400' : 'text-amber-400'}`}>
                  Portfolio Safety Monitor
                </CardTitle>
                <div className="flex items-center gap-2">
                  {criticalCount > 0 && (
                    <Badge className="bg-red-600 hover:bg-red-600 text-white text-xs">
                      {criticalCount} Critical
                    </Badge>
                  )}
                  {warningCount > 0 && (
                    <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-xs">
                      {warningCount} Warning{warningCount !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
                  disabled={isFetching}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
            {criticalCount > 0 && (
              <p className="text-xs text-red-400/80 mt-1 font-medium">
                🚨 Action required — {criticalCount} critical violation{criticalCount !== 1 ? 's' : ''} must be resolved before market close
              </p>
            )}
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {violations.map((v, i) => (
              <ViolationCard key={`${v.accountNumber}-${v.symbol}-${v.violationType}-${i}`} violation={v} />
            ))}

            {/* ADBE-style incident explanation */}
            {violations.some(v => v.violationType === 'SHORT_STOCK') && (
              <Alert className="border-blue-500/30 bg-blue-950/20">
                <AlertTitle className="text-blue-400 text-sm">How did this happen?</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground mt-1 space-y-1">
                  <p>Short stock in an IRA is almost always caused by <strong>early assignment on a short call</strong>.</p>
                  <p>When someone exercises the call you sold, you are required to deliver 100 shares. If you don't own them, the system creates short stock — which is not allowed in IRA/cash accounts.</p>
                  <p>Tastytrade issues an <strong>SL (Short Restricted Strategy) call</strong> requiring you to close the short before market close, or they will liquidate it for you.</p>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
