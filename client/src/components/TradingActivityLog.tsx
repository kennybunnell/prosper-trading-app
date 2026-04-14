/**
 * TradingActivityLog — Floating panel that shows real-time order activity.
 *
 * UX improvements (v2):
 *  - Smart severity coloring:
 *      • success  → green
 *      • rejected → orange/amber
 *      • api_error (background noise) → yellow/muted warning
 *      • error    → red (actual order failures)
 *      • dry_run  → blue/muted
 *  - Click any entry to expand full details inline
 *  - "Copy to Clipboard" button on expanded entries (ready to paste into chat)
 *  - Filter tabs: All | Errors | Orders | Background
 *  - Background api_errors (interceptor noise) are visually de-emphasized and
 *    hidden by default unless the user switches to the "Background" tab
 *  - Auto-open only on real order errors (not background api_errors)
 *  - Badge on the trigger button shows only actionable error count
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
  Copy,
  Check,
  AlertTriangle,
  Info,
  FlaskConical,
  Wifi,
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
  isDryRun?: boolean | null;
  createdAt: number;
}

interface DiagnosisState {
  [id: number]: { loading: boolean; text: string | null };
}

type FilterTab = 'all' | 'errors' | 'orders' | 'background';

// ─── Severity helpers ─────────────────────────────────────────────────────────

/** Is this entry background noise from the API interceptor (not a real order)? */
function isBackgroundNoise(entry: LogEntry): boolean {
  if (entry.outcome !== 'api_error') return false;
  // Background noise = interceptor-caught errors with no real order context
  // Real orders always have a strategy set
  return !entry.strategy || entry.strategy === 'api_interceptor' || entry.strategy === '';
}

function getSeverity(entry: LogEntry): 'success' | 'rejected' | 'error' | 'api_noise' | 'dry_run' | 'working' {
  if (entry.isDryRun || entry.outcome === 'dry_run') return 'dry_run';
  if (entry.outcome === 'success') return 'success';
  if (entry.outcome === 'working') return 'working';
  if (entry.outcome === 'rejected') return 'rejected';
  if (entry.outcome === 'api_error' && isBackgroundNoise(entry)) return 'api_noise';
  if (entry.outcome === 'error' || entry.outcome === 'api_error') return 'error';
  return 'success';
}

function getSeverityIcon(severity: ReturnType<typeof getSeverity>) {
  switch (severity) {
    case 'success':   return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />;
    case 'rejected':  return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />;
    case 'error':     return <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
    case 'api_noise': return <Wifi className="h-4 w-4 text-yellow-500/60 shrink-0 mt-0.5" />;
    case 'dry_run':   return <FlaskConical className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />;
    case 'working':   return <Clock className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />;
  }
}

function getSeverityRowClass(severity: ReturnType<typeof getSeverity>) {
  switch (severity) {
    case 'success':   return 'hover:bg-green-500/5';
    case 'rejected':  return 'bg-amber-500/5 hover:bg-amber-500/8';
    case 'error':     return 'bg-red-500/8 hover:bg-red-500/12';
    case 'api_noise': return 'opacity-50 hover:opacity-80 hover:bg-muted/20';
    case 'dry_run':   return 'bg-blue-500/5 hover:bg-blue-500/8';
    case 'working':   return 'hover:bg-sky-500/5';
  }
}

function getSeverityLabel(entry: LogEntry, severity: ReturnType<typeof getSeverity>) {
  switch (severity) {
    case 'success':   return 'Filled';
    case 'rejected':  return 'Rejected';
    case 'error':     return 'Failed';
    case 'api_noise': return 'API Background';
    case 'dry_run':   return 'Dry Run';
    case 'working':   return 'Working';
  }
}

function getSeverityBadgeClass(severity: ReturnType<typeof getSeverity>) {
  switch (severity) {
    case 'success':   return 'bg-green-600/20 text-green-400 border-green-600/30';
    case 'rejected':  return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'error':     return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'api_noise': return 'bg-yellow-500/10 text-yellow-500/60 border-yellow-500/20';
    case 'dry_run':   return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'working':   return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
  }
}

// ─── Build a copyable text block for an entry ─────────────────────────────────

function buildCopyText(entry: LogEntry, diagnosis?: string | null): string {
  const lines: string[] = [
    `=== Trading Activity Log Entry ===`,
    `Time:      ${new Date(entry.createdAt).toLocaleString()}`,
    `Symbol:    ${entry.symbol}`,
  ];
  if (entry.optionSymbol) lines.push(`Option:    ${entry.optionSymbol.trim()}`);
  if (entry.strategy)     lines.push(`Strategy:  ${entry.strategy}`);
  if (entry.action)       lines.push(`Action:    ${entry.action}`);
  if (entry.strike)       lines.push(`Strike:    $${entry.strike}`);
  if (entry.expiration)   lines.push(`Expiry:    ${entry.expiration}`);
  if (entry.quantity)     lines.push(`Qty:       ${entry.quantity}`);
  if (entry.price)        lines.push(`Price:     $${entry.price}`);
  if (entry.priceEffect)  lines.push(`Effect:    ${entry.priceEffect}`);
  if (entry.instrumentType) lines.push(`Instr:     ${entry.instrumentType}`);
  if (entry.accountNumber)  lines.push(`Account:   ${entry.accountNumber}`);
  lines.push(`Outcome:   ${entry.outcome}`);
  if (entry.orderId)      lines.push(`Order ID:  ${entry.orderId}`);
  if (entry.errorMessage) lines.push(`Error:     ${entry.errorMessage}`);
  if (entry.errorPayload) lines.push(`Payload:   ${entry.errorPayload}`);
  if (entry.source)       lines.push(`Source:    ${entry.source}`);
  if (diagnosis)          lines.push(``, `AI Diagnosis:`, diagnosis);
  return lines.join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TradingActivityLog() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [diagnosisState, setDiagnosisState] = useState<DiagnosisState>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
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

  const allLogs: LogEntry[] = (data as any) ?? [];

  // Counts for badge and tabs
  const actionableErrors = allLogs.filter(l => {
    const s = getSeverity(l);
    return s === 'error' || s === 'rejected';
  });
  const backgroundEntries = allLogs.filter(l => getSeverity(l) === 'api_noise');
  const orderEntries = allLogs.filter(l => {
    const s = getSeverity(l);
    return s === 'success' || s === 'working' || s === 'dry_run';
  });

  // Filtered list based on active tab
  const logs = (() => {
    switch (activeTab) {
      case 'errors':     return allLogs.filter(l => { const s = getSeverity(l); return s === 'error' || s === 'rejected'; });
      case 'orders':     return allLogs.filter(l => { const s = getSeverity(l); return s === 'success' || s === 'working' || s === 'dry_run'; });
      case 'background': return backgroundEntries;
      default:           return allLogs.filter(l => getSeverity(l) !== 'api_noise'); // hide noise in "All"
    }
  })();

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

  const handleCopy = useCallback((entry: LogEntry) => {
    const diagText = diagnosisState[entry.id]?.text ?? entry.aiDiagnosis;
    const text = buildCopyText(entry, diagText);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, [diagnosisState]);

  // Auto-open only for real order errors (not background noise)
  useEffect(() => {
    if (!isOpen && allLogs.length > 0) {
      const recentRealError = allLogs.find(
        l => (getSeverity(l) === 'error' || getSeverity(l) === 'rejected') &&
             Date.now() - l.createdAt < 5 * 60 * 1000
      );
      if (recentRealError) setIsOpen(true);
    }
  }, [allLogs, isOpen]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatStrategy = (entry: LogEntry) => {
    const parts: string[] = [];
    if (entry.strategy && entry.strategy !== 'api_interceptor') parts.push(entry.strategy.toUpperCase());
    if (entry.action) parts.push(entry.action);
    return parts.join(' · ') || 'Order';
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {isOpen && (
        <div className="w-[440px] max-h-[560px] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/95 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-card-foreground">Trading Activity Log</span>
              {actionableErrors.length > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0">
                  {actionableErrors.length} error{actionableErrors.length !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              {!clearConfirm ? (
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => setClearConfirm(true)} title="Clear all logs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-destructive">Clear all?</span>
                  <Button variant="destructive" size="sm" className="h-6 text-xs px-2"
                    onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}>
                    Yes
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2"
                    onClick={() => setClearConfirm(false)}>
                    No
                  </Button>
                </div>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)} title="Hide panel">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-0 border-b border-border px-2 bg-card/80">
            {([ 
              { id: 'all' as FilterTab,        label: 'All',        count: allLogs.filter(l => getSeverity(l) !== 'api_noise').length },
              { id: 'errors' as FilterTab,     label: 'Errors',     count: actionableErrors.length },
              { id: 'orders' as FilterTab,     label: 'Orders',     count: orderEntries.length },
              { id: 'background' as FilterTab, label: 'Background', count: backgroundEntries.length },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-card-foreground'
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0 text-[10px] font-bold',
                    tab.id === 'errors' && tab.count > 0
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Background tab explanation */}
          {activeTab === 'background' && (
            <div className="px-4 py-2 bg-yellow-500/5 border-b border-border flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-yellow-500/70 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                These are background API health-check errors (not order failures). They are hidden from the main view and do not require action unless they persist.
              </p>
            </div>
          )}

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
                <p className="text-sm">
                  {activeTab === 'errors' ? 'No errors — all clear.' :
                   activeTab === 'orders' ? 'No submitted orders yet.' :
                   activeTab === 'background' ? 'No background API events.' :
                   'No order activity yet.'}
                </p>
                <p className="text-xs opacity-70">Orders will appear here as they are submitted.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {logs.map(entry => {
                  const severity = getSeverity(entry);
                  const isExpanded = expandedId === entry.id;
                  const diagText = diagnosisState[entry.id]?.text ?? entry.aiDiagnosis;

                  return (
                    <div
                      key={entry.id}
                      className={cn('text-sm transition-colors', getSeverityRowClass(severity))}
                    >
                      {/* Clickable summary row */}
                      <div
                        className="px-4 py-3 cursor-pointer select-none"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {getSeverityIcon(severity)}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-card-foreground">{entry.symbol}</span>
                                {entry.strike && (
                                  <span className="text-muted-foreground text-xs">${entry.strike}</span>
                                )}
                                <span className={cn(
                                  'text-[10px] font-semibold px-1.5 py-0 rounded border',
                                  getSeverityBadgeClass(severity)
                                )}>
                                  {getSeverityLabel(entry, severity)}
                                </span>
                                {severity !== 'api_noise' && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatStrategy(entry)}
                                  </span>
                                )}
                                {entry.quantity && (
                                  <span className="text-xs text-muted-foreground">{entry.quantity}x</span>
                                )}
                                {entry.price && (
                                  <span className="text-xs text-muted-foreground">@ ${entry.price}</span>
                                )}
                              </div>
                              {/* Short error preview when collapsed */}
                              {!isExpanded && (severity === 'error' || severity === 'rejected') && entry.errorMessage && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">
                                  {entry.errorMessage}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs text-muted-foreground">{formatTime(entry.createdAt)}</span>
                            <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
                          </div>
                        </div>
                      </div>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div className="px-4 pb-3 space-y-2 border-t border-border/50 bg-muted/10">
                          {/* Full details table */}
                          <div className="mt-2 rounded-md bg-muted/30 border border-border/50 p-2.5 text-xs space-y-1 font-mono">
                            {entry.optionSymbol && (
                              <div><span className="text-muted-foreground">Option: </span><span className="text-card-foreground">{entry.optionSymbol.trim()}</span></div>
                            )}
                            {entry.expiration && (
                              <div><span className="text-muted-foreground">Expiry: </span><span className="text-card-foreground">{entry.expiration}</span></div>
                            )}
                            {entry.instrumentType && (
                              <div><span className="text-muted-foreground">Type: </span><span className="text-card-foreground">{entry.instrumentType}</span></div>
                            )}
                            {entry.priceEffect && (
                              <div><span className="text-muted-foreground">Effect: </span><span className="text-card-foreground">{entry.priceEffect}</span></div>
                            )}
                            {entry.accountNumber && (
                              <div><span className="text-muted-foreground">Account: </span><span className="text-card-foreground">{entry.accountNumber}</span></div>
                            )}
                            {entry.orderId && (
                              <div><span className="text-muted-foreground">Order ID: </span><span className="text-green-400">{entry.orderId}</span></div>
                            )}
                            {entry.errorMessage && (
                              <div><span className="text-muted-foreground">Error: </span><span className="text-red-400 break-words">{entry.errorMessage}</span></div>
                            )}
                            {entry.errorPayload && (
                              <div className="mt-1">
                                <span className="text-muted-foreground">Payload: </span>
                                <span className="text-amber-400/80 break-all">{entry.errorPayload}</span>
                              </div>
                            )}
                            {entry.source && (
                              <div><span className="text-muted-foreground">Source: </span><span className="text-muted-foreground/70">{entry.source}</span></div>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2">
                            {/* Copy to clipboard */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2 gap-1"
                              onClick={() => handleCopy(entry)}
                            >
                              {copiedId === entry.id ? (
                                <><Check className="h-3 w-3 text-green-400" /> Copied!</>
                              ) : (
                                <><Copy className="h-3 w-3" /> Copy to Clipboard</>
                              )}
                            </Button>

                            {/* AI Diagnose — only for errors */}
                            {(severity === 'error' || severity === 'rejected') && (
                              diagnosisState[entry.id]?.loading ? (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Analyzing...
                                </div>
                              ) : !diagText ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs px-2 gap-1"
                                  onClick={() => handleDiagnose(entry)}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  AI Diagnose
                                </Button>
                              ) : null
                            )}
                          </div>

                          {/* AI Diagnosis result */}
                          {diagText && (
                            <div className="rounded-md bg-primary/5 border border-primary/20 p-2.5 text-xs text-card-foreground">
                              <div className="flex items-center gap-1 mb-1.5 text-primary">
                                <Sparkles className="h-3 w-3" />
                                <span className="font-semibold">AI Diagnosis</span>
                              </div>
                              <p className="leading-relaxed whitespace-pre-wrap">{diagText}</p>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-xs px-1.5 mt-1.5 gap-1 text-muted-foreground"
                                onClick={() => handleCopy(entry)}
                              >
                                <Copy className="h-2.5 w-2.5" />
                                Copy with diagnosis
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
            : actionableErrors.length > 0
            ? 'bg-red-600 border-red-600 text-white animate-pulse'
            : 'bg-primary border-primary text-primary-foreground hover:bg-primary/90'
        )}
      >
        <Activity className="h-4 w-4" />
        <span>Activity</span>
        {!isOpen && actionableErrors.length > 0 && (
          <span className="rounded-full bg-white/20 text-xs px-1.5 py-0.5 font-bold">
            {actionableErrors.length}
          </span>
        )}
        {!isOpen && actionableErrors.length === 0 && orderEntries.length > 0 && (
          <span className="rounded-full bg-white/20 text-xs px-1.5 py-0.5 font-bold">
            {orderEntries.length}
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
