/**
 * Daily Trading Automation Dashboard
 * Control panel for managing automated trading workflows
 */

import { useState, useEffect, useCallback } from 'react';
import { UnifiedOrderPreviewModal, UnifiedOrder } from '@/components/UnifiedOrderPreviewModal';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Play, Clock, CheckCircle2, XCircle, AlertCircle,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Eye, Trash2, Square, CheckSquare, Send, ShoppingCart
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
import { toast } from 'sonner';
import { ConnectionStatusIndicator } from '@/components/ConnectionStatusIndicator';

type ScanResult = {
  account: string;
  symbol: string;
  optionSymbol: string;
  type: string;
  quantity: number;
  premiumCollected: number;  // Total $ received when position was opened
  buyBackCost: number;       // Current $ cost to close the position
  realizedPercent: number;   // (premiumCollected - buyBackCost) / premiumCollected × 100
  expiration: string | null; // ISO expiration date from Tastytrade
  dte: number | null;          // Days to expiration (0 = expires today)
  isEstimated: boolean;       // true when buy-back cost is from time-decay heuristic
  action: 'WOULD_CLOSE' | 'BELOW_THRESHOLD' | 'SKIPPED';
  reason?: string;
};

type RunSummary = {
  positionsClosedCount: number;
  coveredCallsOpenedCount: number;
  totalProfitRealized: string;
  totalPremiumCollected: string;
  accountsProcessed: number;
  pendingOrdersCount: number;
  totalScanned: number;
  wouldClose: number;
  belowThreshold: number;
};

type RunResult = {
  success: boolean;
  runId: string;
  summary: RunSummary;
  scanResults: ScanResult[]; // populated after fetching the log
};

export default function AutomationDashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);
  const [showScanResults, setShowScanResults] = useState(true);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [hideExpiringToday, setHideExpiringToday] = useState(true); // Hide DTE=0 by default
  // UnifiedOrderPreviewModal state
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  const [previewAccountId, setPreviewAccountId] = useState<string>('');
  const [orderSubmissionComplete, setOrderSubmissionComplete] = useState(false);
  const [orderFinalStatus, setOrderFinalStatus] = useState<string | null>(null);

  // Build UnifiedOrders from selected scan results and open the preview modal
  const handleOpenOrderPreview = useCallback(() => {
    if (!lastRunResult) return;
    const selected = lastRunResult.scanResults.filter(
      r => selectedPositions.has(`${r.optionSymbol}|${r.account}`) && r.action === 'WOULD_CLOSE'
    );
    if (selected.length === 0) return;

    // Group by account — use the first account as the modal accountId
    const firstAccount = selected[0].account;
    setPreviewAccountId(firstAccount);

    // Map each selected scan result to a UnifiedOrder (BTC)
    const orders: UnifiedOrder[] = selected.map(r => {
      const isCall = r.type === 'CC';
      // Parse strike from option symbol e.g. AAPL250117C00150000 → 150
      const strikeMatch = r.optionSymbol.match(/(\d{8})[CP](\d{8})$/);
      const strike = strikeMatch ? parseInt(strikeMatch[2], 10) / 1000 : 0;
      return {
        symbol: r.symbol,
        strike,
        expiration: r.expiration ?? '',
        premium: r.buyBackCost / (r.quantity * 100), // per-share price
        action: 'BTC',
        optionType: isCall ? 'CALL' : 'PUT',
        bid: r.buyBackCost / (r.quantity * 100),
        ask: r.buyBackCost / (r.quantity * 100),
        currentPrice: r.buyBackCost / (r.quantity * 100),
      };
    });
    setUnifiedOrders(orders);
    setOrderSubmissionComplete(false);
    setOrderFinalStatus(null);
    setShowOrderPreview(true);
  }, [lastRunResult, selectedPositions]);

  const submitCloseOrders = trpc.automation.submitCloseOrders.useMutation({
    onSuccess: (data) => {
      setIsSubmitting(false);
      setShowSubmitConfirm(false);
      if (data.failCount === 0) {
        toast.success(`${data.successCount} close order${data.successCount !== 1 ? 's' : ''} submitted successfully!`);
      } else {
        toast.warning(`${data.successCount} submitted, ${data.failCount} failed. Check Working Orders for details.`);
      }
      setSelectedPositions(new Set());
    },
    onError: (err) => {
      setIsSubmitting(false);
      toast.error(`Order submission failed: ${err.message}`);
    },
  });

  // Stable key for a position (used instead of array index to survive sorting)
  const posKey = (r: ScanResult) => `${r.optionSymbol}|${r.account}`;

  const handleSubmitOrders = () => {
    if (!lastRunResult) return;
    const selected = lastRunResult.scanResults
      .filter(r => selectedPositions.has(posKey(r)) && r.action === 'WOULD_CLOSE')
      .map(r => ({
        accountNumber: r.account,
        optionSymbol: r.optionSymbol,
        symbol: r.symbol,
        quantity: r.quantity,
        buyBackCost: r.buyBackCost,
        isEstimated: r.isEstimated,
      }));
    setIsSubmitting(true);
    submitCloseOrders.mutate({ orders: selected });
  };

  // onSubmit callback for UnifiedOrderPreviewModal
  const handleUnifiedSubmit = async (
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    isDryRun: boolean
  ): Promise<{ results: any[] }> => {
    if (!lastRunResult) return { results: [] };
    const selected = lastRunResult.scanResults.filter(
      r => selectedPositions.has(`${r.optionSymbol}|${r.account}`) && r.action === 'WOULD_CLOSE'
    ).map(r => ({
      accountNumber: r.account,
      optionSymbol: r.optionSymbol,
      symbol: r.symbol,
      quantity: r.quantity,
      buyBackCost: r.buyBackCost,
      isEstimated: r.isEstimated,
    }));
    try {
      const response = await submitCloseOrders.mutateAsync({ orders: selected, dryRun: isDryRun });
      return { results: response.results ?? [] };
    } catch (err: any) {
      return { results: [] };
    }
  };

  // Poll order statuses for UnifiedOrderPreviewModal (matches Performance.tsx pattern)
  const handlePollStatuses = async (
    orderIds: string[],
    accountId: string
  ): Promise<Array<{
    orderId: string;
    symbol: string;
    status: 'Filled' | 'Working' | 'Cancelled' | 'Rejected' | 'MarketClosed' | 'Pending';
    message?: string;
  }>> => {
    try {
      const statusMap = await utils.orders.checkStatusBatch.fetch({ accountId, orderIds });
      return orderIds.map((orderId, idx) => {
        const s = statusMap[orderId];
        const mappedStatus = s?.status === 'Unknown' ? 'Rejected' as const : (s?.status ?? 'Rejected' as const);
        return {
          orderId,
          symbol: unifiedOrders[idx]?.symbol ?? 'Unknown',
          status: mappedStatus,
          message: s?.status === 'Filled'
            ? 'Order filled successfully'
            : s?.status === 'Rejected'
            ? `Order rejected: ${(s as any).rejectedReason ?? 'Unknown reason'}`
            : s?.status === 'MarketClosed'
            ? (s as any).marketClosedMessage ?? 'Market is closed'
            : s?.status === 'Working'
            ? 'Order is working'
            : 'Status unknown',
        };
      });
    } catch (error: any) {
      return orderIds.map((orderId, idx) => ({
        orderId,
        symbol: unifiedOrders[idx]?.symbol ?? 'Unknown',
        status: 'Rejected' as const,
        message: `Failed to check status: ${error.message}`,
      }));
    }
  };

  // Apply the hide-expiring-today filter to the full scan results list
  const visibleScanResults = (lastRunResult?.scanResults ?? []).filter(
    r => !(hideExpiringToday && r.dte === 0)
  );
  const wouldCloseResults = visibleScanResults.filter(r => r.action === 'WOULD_CLOSE');
  // Use stable posKey for selection — survives sorting
  const allSelected = wouldCloseResults.length > 0 && wouldCloseResults.every(r =>
    selectedPositions.has(`${r.optionSymbol}|${r.account}`)
  );

  const toggleSelectAll = useCallback(() => {
    if (!lastRunResult) return;
    if (allSelected) {
      setSelectedPositions(new Set());
    } else {
      // Only select visible (non-filtered-out) WOULD_CLOSE positions
      const keys = new Set(visibleScanResults
        .filter(r => r.action === 'WOULD_CLOSE')
        .map(r => `${r.optionSymbol}|${r.account}`));
      setSelectedPositions(keys);
    }
  }, [lastRunResult, allSelected, visibleScanResults]);

  const togglePosition = useCallback((key: string) => {
    setSelectedPositions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // After a run completes, fetch the log to get scanResultsJson
  const { data: latestLog } = trpc.automation.getLog.useQuery(
    { runId: lastRunId! },
    { enabled: !!lastRunId, refetchInterval: false }
  );

  // Fetch automation settings
  const { data: settings, isLoading: settingsLoading } = trpc.automation.getSettings.useQuery();
  
  // Fetch automation logs
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = trpc.automation.getLogs.useQuery({ limit: 20 });

  // Delete a single log
  const deleteLog = trpc.automation.deleteLog.useMutation({
    onSuccess: () => {
      refetchLogs();
      toast.success('Run deleted');
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  });

  // Clear all logs
  const clearAllLogs = trpc.automation.clearAllLogs.useMutation({
    onSuccess: () => {
      refetchLogs();
      toast.success('All history cleared');
    },
    onError: (err) => toast.error(`Failed to clear: ${err.message}`),
  });

  // Update settings mutation
  const updateSettings = trpc.automation.updateSettings.useMutation({
    onSuccess: () => {
      toast.success('Settings updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update settings: ${error.message}`);
    },
  });

  const utils = trpc.useUtils();

  // When the log is fetched after a run, populate scanResults from scanResultsJson
  useEffect(() => {
    if (latestLog && lastRunResult && lastRunResult.scanResults.length === 0) {
      const parsed: ScanResult[] = latestLog.scanResultsJson ? JSON.parse(latestLog.scanResultsJson as string) : [];
      if (parsed.length > 0) {
        setLastRunResult(prev => prev ? { ...prev, scanResults: parsed } : prev);
        // Auto-select all WOULD_CLOSE positions using stable keys
        const keys = new Set(parsed
          .filter(r => r.action === 'WOULD_CLOSE')
          .map(r => `${r.optionSymbol}|${r.account}`));
        setSelectedPositions(keys);
      }
    }
  }, [latestLog]);

  // Run automation mutation
  const runAutomation = trpc.automation.runAutomation.useMutation({
    onSuccess: (data) => {
      setIsRunning(false);
      setShowScanResults(true);
      refetchLogs();
      const wouldClose = data.summary.wouldClose ?? data.summary.positionsClosedCount;
      const totalScanned = data.summary.totalScanned ?? 0;
      // Set a placeholder result immediately, then fetch full scan results from the log
      setLastRunResult({
        success: true,
        runId: data.runId,
        summary: data.summary as RunSummary,
        scanResults: [],
      });
      setLastRunId(data.runId);
      // Invalidate so the getLog query fires
      utils.automation.getLog.invalidate({ runId: data.runId });
      if (wouldClose > 0) {
        toast.success(`Scan complete! Found ${wouldClose} position${wouldClose !== 1 ? 's' : ''} to close out of ${totalScanned} scanned.`);
      } else {
        toast.info(`Scan complete. ${totalScanned} position${totalScanned !== 1 ? 's' : ''} scanned — none meet the ${settings?.profitThresholdPercent ?? 75}% threshold.`);
      }
    },
    onError: (error) => {
      setIsRunning(false);
      toast.error(`Automation failed: ${error.message}`);
    },
  });

  const handleRunAutomation = () => {
    setIsRunning(true);
    setLastRunResult(null);
    runAutomation.mutate({ triggerType: 'manual' });
  };

  const handleToggle = (key: string, value: boolean) => {
    updateSettings.mutate({ [key]: value });
  };

  const handleNumberChange = (key: string, value: number) => {
    updateSettings.mutate({ [key]: value });
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const threshold = settings?.profitThresholdPercent ?? 75;

  return (
    <div className="container py-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Daily Trading Automation</h1>
          <p className="text-muted-foreground mt-2">
            Automate your daily trading workflow: close profitable positions and submit covered calls
          </p>
        </div>
        <div className="mt-1">
          <ConnectionStatusIndicator />
        </div>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
          <CardDescription>Configure automation settings and run workflows</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Run Button */}
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
            <div>
              <h3 className="font-semibold">Run Automation Now</h3>
              <p className="text-sm text-muted-foreground">
                {settings?.dryRunMode
                  ? 'Dry run: scan positions and show what would be closed (no orders submitted)'
                  : 'Scan positions and submit close orders for profitable positions'}
              </p>
            </div>
            <Button
              onClick={handleRunAutomation}
              disabled={isRunning}
              size="lg"
              className={settings?.dryRunMode ? 'bg-amber-600 hover:bg-amber-700' : ''}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Now
                </>
              )}
            </Button>
          </div>

          {/* Mode Toggles */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dry-run">Dry Run Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Generate reports without submitting orders
                </p>
              </div>
              <Switch
                id="dry-run"
                checked={settings?.dryRunMode}
                onCheckedChange={(checked) => handleToggle('dryRunMode', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="require-approval">Require Approval</Label>
                <p className="text-sm text-muted-foreground">
                  Review and approve orders before submission
                </p>
              </div>
              <Switch
                id="require-approval"
                checked={settings?.requireApproval}
                onCheckedChange={(checked) => handleToggle('requireApproval', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-schedule">Auto-Schedule (9:35 AM ET)</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically run daily at 9:35 AM Eastern Time
                </p>
              </div>
              <Switch
                id="auto-schedule"
                checked={settings?.autoScheduleEnabled}
                onCheckedChange={(checked) => handleToggle('autoScheduleEnabled', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-notifications">Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Receive email summaries after each run
                </p>
              </div>
              <Switch
                id="email-notifications"
                checked={settings?.emailNotificationsEnabled}
                onCheckedChange={(checked) => handleToggle('emailNotificationsEnabled', checked)}
              />
            </div>
          </div>

          {/* Settings */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold">Position Management Settings</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profit-threshold">Profit Threshold (%)</Label>
                <Input
                  id="profit-threshold"
                  type="number"
                  min="1"
                  max="100"
                  value={settings?.profitThresholdPercent}
                  onChange={(e) => handleNumberChange('profitThresholdPercent', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Close positions when profit reaches this percentage
                </p>
              </div>
            </div>

            <h3 className="font-semibold pt-4">Covered Call Settings</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dte-min">Min DTE</Label>
                <Input
                  id="dte-min"
                  type="number"
                  min="1"
                  max="365"
                  value={settings?.ccDteMin}
                  onChange={(e) => handleNumberChange('ccDteMin', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dte-max">Max DTE</Label>
                <Input
                  id="dte-max"
                  type="number"
                  min="1"
                  max="365"
                  value={settings?.ccDteMax}
                  onChange={(e) => handleNumberChange('ccDteMax', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delta-min">Min Delta</Label>
                <Input
                  id="delta-min"
                  type="text"
                  value={settings?.ccDeltaMin}
                  onChange={(e) => updateSettings.mutate({ ccDeltaMin: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delta-max">Max Delta</Label>
                <Input
                  id="delta-max"
                  type="text"
                  value={settings?.ccDeltaMax}
                  onChange={(e) => updateSettings.mutate({ ccDeltaMax: e.target.value })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dry Run Results Panel */}
      {lastRunResult && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Eye className="h-5 w-5 text-amber-400" />
                <div>
                  <CardTitle className="text-lg">
                    Scan Results
                    {settings?.dryRunMode && (
                      <Badge variant="outline" className="ml-2 text-amber-400 border-amber-400">
                        Dry Run
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {lastRunResult.summary.accountsProcessed} account{lastRunResult.summary.accountsProcessed !== 1 ? 's' : ''} scanned &bull;{' '}
                    {lastRunResult.summary.totalScanned} position{lastRunResult.summary.totalScanned !== 1 ? 's' : ''} evaluated
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedPositions.size > 0 && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleOpenOrderPreview}
                  >
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Review &amp; Submit {selectedPositions.size} Order{selectedPositions.size !== 1 ? 's' : ''}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowScanResults(!showScanResults)}
                >
                  {showScanResults ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Summary Stats */}
            {(() => {
              const totalBuyBack = lastRunResult.scanResults
                .filter(r => r.action === 'WOULD_CLOSE')
                .reduce((sum, r) => sum + r.buyBackCost, 0);
              return (
                <div className="grid grid-cols-4 gap-3 pt-2">
                  <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="text-2xl font-bold text-green-400">
                      {lastRunResult.summary.positionsClosedCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {settings?.dryRunMode ? 'Ready to Close' : 'Orders Submitted'}
                    </div>
                    <div className="text-xs text-green-400 font-medium">
                      ≥{threshold}% profit
                    </div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50 border">
                    <div className="text-2xl font-bold text-muted-foreground">
                      {lastRunResult.summary.belowThreshold}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Below Threshold</div>
                    <div className="text-xs text-muted-foreground font-medium">
                      &lt;{threshold}% profit
                    </div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="text-2xl font-bold text-amber-400">
                      ${totalBuyBack.toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Total Buy-Back Cost</div>
                    <div className="text-xs text-amber-400 font-medium">to close all</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="text-2xl font-bold text-blue-400">
                      ${parseFloat(lastRunResult.summary.totalProfitRealized).toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {settings?.dryRunMode ? 'Est. Profit' : 'Profit Realized'}
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardHeader>

          {showScanResults && (lastRunResult.scanResults.length > 0 || visibleScanResults.length === 0) && (
            <CardContent>
              {/* Filter toolbar */}
              <div className="flex items-center gap-3 mb-3">
                <Button
                  variant={hideExpiringToday ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setHideExpiringToday(v => !v)}
                  className={hideExpiringToday ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'text-muted-foreground'}
                >
                  {hideExpiringToday ? '🙈 Hiding Expiring Today' : '👁 Show Expiring Today'}
                </Button>
                {hideExpiringToday && lastRunResult && lastRunResult.scanResults.some(r => r.dte === 0) && (
                  <span className="text-xs text-muted-foreground">
                    {lastRunResult.scanResults.filter(r => r.dte === 0).length} DTE=0 position{lastRunResult.scanResults.filter(r => r.dte === 0).length !== 1 ? 's' : ''} hidden
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 pr-2 w-8">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all closeable positions"
                        />
                      </th>
                      <th className="text-left py-2 pr-4 font-medium">Symbol</th>
                      <th className="text-left py-2 pr-4 font-medium">Type</th>
                      <th className="text-left py-2 pr-4 font-medium">Account</th>
                      <th className="text-right py-2 pr-4 font-medium">Qty</th>
                      <th className="text-left py-2 pr-4 font-medium">Expiration</th>
                      <th className="text-right py-2 pr-2 font-medium">DTE</th>
                      <th className="text-right py-2 pr-4 font-medium">Premium Collected</th>
                      <th className="text-right py-2 pr-4 font-medium">Buy-Back Cost</th>
                      <th className="text-right py-2 pr-4 font-medium">Realized %</th>
                      <th className="text-center py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleScanResults
                      .sort((a, b) => b.realizedPercent - a.realizedPercent)
                      .map((result, idx) => (
                        <tr
                          key={idx}
                          className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                            result.action === 'WOULD_CLOSE'
                              ? selectedPositions.has(`${result.optionSymbol}|${result.account}`) ? 'bg-green-500/10' : 'bg-green-500/5'
                              : ''
                          }`}
                        >
                          <td className="py-2.5 pr-2">
                            {result.action === 'WOULD_CLOSE' ? (
                              <Checkbox
                                checked={selectedPositions.has(`${result.optionSymbol}|${result.account}`)}
                                onCheckedChange={() => togglePosition(`${result.optionSymbol}|${result.account}`)}
                                aria-label={`Select ${result.symbol}`}
                              />
                            ) : <span />}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="font-semibold">{result.symbol}</span>
                            <span className="text-xs text-muted-foreground block truncate max-w-[120px]" title={result.optionSymbol}>
                              {result.optionSymbol}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <Badge
                              variant="outline"
                              className={result.type === 'CSP' ? 'text-blue-400 border-blue-400/50' : 'text-purple-400 border-purple-400/50'}
                            >
                              {result.type}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground text-xs">
                            {result.account}
                          </td>
                          <td className="py-2.5 pr-4 text-right">{result.quantity}</td>
                          <td className="py-2.5 pr-4 text-left">
                            {(() => {
                              if (!result.expiration) return <span className="text-muted-foreground text-xs">—</span>;
                              const expDate = new Date(result.expiration);
                              const today = new Date();
                              const isToday = expDate.toDateString() === today.toDateString();
                              const formatted = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
                              return isToday ? (
                                <Badge className="bg-red-600/20 text-red-400 border-red-500/30 text-xs">Expires Today</Badge>
                              ) : (
                                <span className="text-sm font-mono">{formatted}</span>
                              );
                            })()}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono text-xs">
                            {result.dte === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : result.dte === 0 ? (
                              <span className="text-red-400 font-semibold">0</span>
                            ) : result.dte <= 7 ? (
                              <span className="text-amber-400 font-semibold">{result.dte}</span>
                            ) : (
                              <span className="text-muted-foreground">{result.dte}</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono text-green-400">
                            ${result.premiumCollected.toFixed(2)}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono">
                            {result.isEstimated ? (
                              <span className="text-orange-400" title="Estimated via time-decay heuristic (no live quote available)">
                                ~${result.buyBackCost.toFixed(2)}
                                <span className="text-xs ml-1 opacity-70">est.</span>
                              </span>
                            ) : (
                              <span className="text-amber-400">
                                ${result.buyBackCost.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            <span
                              className={`font-bold ${
                                result.realizedPercent >= threshold
                                  ? 'text-green-400'
                                  : result.realizedPercent >= threshold * 0.8
                                  ? 'text-amber-400'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {result.realizedPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-2.5 text-center">
                            {result.action === 'WOULD_CLOSE' ? (
                              <Badge className="bg-cyan-600/20 text-cyan-400 border-cyan-500/30 hover:bg-cyan-600/30">
                                <TrendingUp className="h-3 w-3 mr-1" />
                                {settings?.dryRunMode ? 'Ready to Close' : 'Submitted'}
                              </Badge>
                            ) : result.action === 'BELOW_THRESHOLD' ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                <Minus className="h-3 w-3 mr-1" />
                                Hold
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-400 border-amber-400/50">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Skipped
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {visibleScanResults.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingDown className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  {lastRunResult.scanResults.length === 0 ? (
                    <>
                      <p>No short option positions found in any account</p>
                      <p className="text-sm mt-1">Make sure your Tastytrade account has open CSP or CC positions</p>
                    </>
                  ) : (
                    <>
                      <p>All positions are expiring today (DTE=0)</p>
                      <p className="text-sm mt-1">Toggle "Show Expiring Today" above to view them</p>
                    </>
                  )}
                </div>
              )}

              {/* Approval Queue Submit Bar */}
              {selectedPositions.size > 0 && (() => {
                const selResults = (lastRunResult?.scanResults ?? []).filter(r => selectedPositions.has(`${r.optionSymbol}|${r.account}`));
                const selBuyBack = selResults.reduce((sum, r) => sum + r.buyBackCost, 0);
                const selProfit = selResults.reduce((sum, r) => sum + (r.premiumCollected - r.buyBackCost), 0);
                return (
                <div className="mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-green-400">{selectedPositions.size} position{selectedPositions.size !== 1 ? 's' : ''} selected</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      Buy-back cost: <span className="text-amber-400 font-mono">${selBuyBack.toFixed(2)}</span>
                      {' · '}Est. profit: <span className="text-green-400 font-mono">${selProfit.toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedPositions(new Set())}
                    >
                      Clear Selection
                    </Button>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={handleOpenOrderPreview}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      Review &amp; Submit {selectedPositions.size} Order{selectedPositions.size !== 1 ? 's' : ''}
                    </Button>
                  </div>
                </div>
                );
              })()}
            </CardContent>
          )}
        </Card>
      )}

      {/* Unified Order Preview Modal */}
      {showOrderPreview && unifiedOrders.length > 0 && (
        <UnifiedOrderPreviewModal
          open={showOrderPreview}
          onOpenChange={(open) => {
            setShowOrderPreview(open);
            if (!open && orderSubmissionComplete) {
              setSelectedPositions(new Set());
              setUnifiedOrders([]);
              setOrderSubmissionComplete(false);
              setOrderFinalStatus(null);
            }
          }}
          orders={unifiedOrders}
          strategy="btc"
          accountId={previewAccountId}
          availableBuyingPower={0}
          onSubmit={handleUnifiedSubmit}
          onPollStatuses={handlePollStatuses}
          allowQuantityEdit={false}
          tradingMode="live"
          initialSkipDryRun={false}
          submissionComplete={orderSubmissionComplete}
          finalOrderStatus={orderFinalStatus}
          onSubmissionStateChange={(complete, status) => {
            setOrderSubmissionComplete(complete);
            setOrderFinalStatus(status);
          }}
        />
      )}

      {/* Execution History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>Recent automation runs and their results</CardDescription>
            </div>
            {logs && logs.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-400 border-red-400/30 hover:bg-red-400/10">
                    <Trash2 className="h-4 w-4 mr-1" />
                    Clear All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all execution history?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all {logs.length} automation run records. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={() => clearAllLogs.mutate()}
                    >
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="space-y-4">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {log.status === 'completed' && (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    )}
                    {log.status === 'failed' && (
                      <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    )}
                    {log.status === 'running' && (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500 shrink-0" />
                    )}
                    
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {new Date(log.startedAt).toLocaleString()}
                        </span>
                        <Badge variant={log.triggerType === 'manual' ? 'default' : 'secondary'}>
                          {log.triggerType}
                        </Badge>
                        {log.dryRun && (
                          <Badge variant="outline" className="text-amber-400 border-amber-400/50">Dry Run</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {log.positionsClosedCount} positions {log.dryRun ? 'would close' : 'closed'} &bull;{' '}
                        {log.coveredCallsOpenedCount} covered calls opened &bull;{' '}
                        {log.accountsProcessed} account{log.accountsProcessed !== 1 ? 's' : ''} processed
                      </p>
                      {log.errorMessage && (
                        <p className="text-sm text-red-500 mt-1 max-w-lg truncate" title={log.errorMessage}>
                          Error: {log.errorMessage.length > 120 ? log.errorMessage.slice(0, 120) + '…' : log.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="font-semibold text-green-400">
                        +${log.totalProfitRealized}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        ${log.totalPremiumCollected} premium
                      </p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this run?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete the run from {new Date(log.startedAt).toLocaleString()}. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => deleteLog.mutate({ runId: log.runId })}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No automation runs yet</p>
              <p className="text-sm mt-1">Click "Run Now" to start your first automation</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
