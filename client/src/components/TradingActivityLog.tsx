/**
 * TradingActivityLog — Floating panel that shows real-time order activity.
 * Captures every order attempt (success/failure) and lets the user request
 * an AI diagnosis for any failed order.
 *
 * Behaviour:
 *  - Collapsed by default (just a small badge in the bottom-right corner)
 *  - Expands to a panel on click
 *  - "Hide" button collapses it back
 *  - Auto-polls every 30 seconds when expanded
 *  - AI Diagnose button on failed entries calls the LLM and shows explanation
 */

import { useState, useEffect, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Activity,
  Sparkles,
  Loader2,
  Clock,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogEntry {
  id: number;
  symbol: string;
  optionSymbol?: string | null;
  accountNumber?: string | null;
  strategy?: string | null;
  action?: string | null;
  strike?: string | null;
  expiration?: string | null;
  quantity?: number | null;
  price?: string | null;
  priceEffect?: string | null;
  instrumentType?: string | null;
  outcome: string;
  orderId?: string | null;
  errorMessage?: string | null;
  errorPayload?: string | null;
  aiDiagnosis?: string | null;
  source?: string | null;
  createdAt: number;
}

interface DiagnosisState {
  [id: number]: { loading: boolean; text: string | null };
}

export function TradingActivityLog() {
  const [isOpen, setIsOpen] = useState(false);
  const [diagnosisState, setDiagnosisState] = useState<DiagnosisState>({});
  const [clearConfirm, setClearConfirm] = useState(false);

  const { data, isLoading, refetch } = trpc.tradingLog.getEntries.useQuery(
    { limit: 50 },
    {
      enabled: isOpen,
      refetchInterval: isOpen ? 30_000 : false,
      staleTime: 10_000,
    }
  );

  const diagnoseMutation = trpc.tradingLog.diagnose.useMutation();
  const clearMutation = trpc.tradingLog.clearEntries.useMutation({
    onSuccess: () => {
      refetch();
      setClearConfirm(false);
    },
  });

  const logs: LogEntry[] = (data as any) ?? [];

  const errorCount = logs.filter(l => l.outcome === 'error').length;
  const successCount = logs.filter(l => l.outcome === 'success').length;

  const handleDiagnose = useCallback(
    async (entry: LogEntry) => {
      setDiagnosisState(prev => ({
        ...prev,
        [entry.id]: { loading: true, text: null },
      }));
      try {
        const result = await diagnoseMutation.mutateAsync({ entryId: entry.id });
        setDiagnosisState(prev => ({
          ...prev,
          [entry.id]: { loading: false, text: result.diagnosis },
        }));
      } catch {
        setDiagnosisState(prev => ({
          ...prev,
          [entry.id]: { loading: false, text: 'Diagnosis failed. Please try again.' },
        }));
      }
    },
    [diagnoseMutation]
  );

  // Auto-open if there are recent errors (within last 5 minutes)
  useEffect(() => {
    if (!isOpen && logs.length > 0) {
      const recentError = logs.find(
        l => l.outcome === 'error' && Date.now() - l.createdAt < 5 * 60 * 1000
      );
      if (recentError) setIsOpen(true);
    }
  }, [logs, isOpen]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatStrategy = (entry: LogEntry) => {
    const parts: string[] = [];
    if (entry.strategy) parts.push(entry.strategy.toUpperCase());
    if (entry.action) parts.push(entry.action);
    return parts.join(' · ') || 'Order';
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {isOpen && (
        <div className="w-[420px] max-h-[520px] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/95 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-card-foreground">Trading Activity Log</span>
              {errorCount > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0">
                  {errorCount} error{errorCount !== 1 ? 's' : ''}
                </Badge>
              )}
              {successCount > 0 && errorCount === 0 && (
                <Badge className="text-xs px-1.5 py-0 bg-green-600 text-white">
                  {successCount} filled
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => refetch()}
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              {!clearConfirm ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => setClearConfirm(true)}
                  title="Clear all logs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-destructive">Clear all?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => clearMutation.mutate()}
                    disabled={clearMutation.isPending}
                  >
                    Yes
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setClearConfirm(false)}
                  >
                    No
                  </Button>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsOpen(false)}
                title="Hide panel"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Log entries */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm">Loading activity...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Activity className="h-8 w-8 opacity-30" />
                <p className="text-sm">No order activity yet.</p>
                <p className="text-xs opacity-70">Orders will appear here as they are submitted.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {logs.map(entry => (
                  <div
                    key={entry.id}
                    className={cn(
                      'px-4 py-3 text-sm',
                      entry.outcome === 'error'
                        ? 'bg-destructive/5 hover:bg-destructive/8'
                        : 'hover:bg-muted/30'
                    )}
                  >
                    {/* Row 1: icon + symbol + strategy + time */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {entry.outcome === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-card-foreground">{entry.symbol}</span>
                            {entry.strike && (
                              <span className="text-muted-foreground">${entry.strike}</span>
                            )}
                            <Badge
                              variant={entry.outcome === 'success' ? 'outline' : 'destructive'}
                              className="text-xs px-1.5 py-0 h-4"
                            >
                              {formatStrategy(entry)}
                            </Badge>
                            {entry.quantity && (
                              <span className="text-xs text-muted-foreground">
                                {entry.quantity}x
                              </span>
                            )}
                            {entry.price && (
                              <span className="text-xs text-muted-foreground">
                                @ ${entry.price}
                              </span>
                            )}
                          </div>
                          {entry.optionSymbol && (
                            <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                              {entry.optionSymbol.trim()}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Clock className="h-3 w-3" />
                        {formatTime(entry.createdAt)}
                      </div>
                    </div>

                    {/* Row 2: order ID or error message */}
                    {entry.outcome === 'success' && entry.orderId && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1 ml-6">
                        Order ID: {entry.orderId}
                      </p>
                    )}
                    {entry.outcome === 'error' && entry.errorMessage && (
                      <p className="text-xs text-destructive mt-1 ml-6 break-words">
                        {entry.errorMessage}
                      </p>
                    )}

                    {/* Row 3: AI diagnosis */}
                    {entry.outcome === 'error' && (
                      <div className="mt-2 ml-6">
                        {diagnosisState[entry.id]?.loading ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Analyzing error...
                          </div>
                        ) : diagnosisState[entry.id]?.text || entry.aiDiagnosis ? (
                          <div className="rounded-md bg-muted/50 border border-border p-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1 mb-1 text-primary">
                              <Sparkles className="h-3 w-3" />
                              <span className="font-medium">AI Diagnosis</span>
                            </div>
                            {diagnosisState[entry.id]?.text || entry.aiDiagnosis}
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2 gap-1"
                            onClick={() => handleDiagnose(entry)}
                          >
                            <Sparkles className="h-3 w-3" />
                            AI Diagnose
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Row 4: account + source */}
                    <div className="flex items-center gap-2 mt-1.5 ml-6 text-xs text-muted-foreground/60">
                      {entry.accountNumber && <span>Acct: {entry.accountNumber}</span>}
                      {entry.source && <span>· {entry.source.split('/').pop()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          'flex items-center gap-2 rounded-full px-4 py-2.5 shadow-lg transition-all duration-200',
          'border text-sm font-medium',
          isOpen
            ? 'bg-card border-border text-card-foreground'
            : errorCount > 0
            ? 'bg-destructive border-destructive text-destructive-foreground animate-pulse'
            : 'bg-primary border-primary text-primary-foreground hover:bg-primary/90'
        )}
      >
        <Activity className="h-4 w-4" />
        <span>Activity</span>
        {!isOpen && errorCount > 0 && (
          <span className="rounded-full bg-white/20 text-xs px-1.5 py-0.5 font-bold">
            {errorCount}
          </span>
        )}
        {!isOpen && errorCount === 0 && successCount > 0 && (
          <span className="rounded-full bg-white/20 text-xs px-1.5 py-0.5 font-bold">
            {successCount}
          </span>
        )}
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 ml-0.5" />
        )}
      </button>
    </div>
  );
}
