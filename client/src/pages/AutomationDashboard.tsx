/**
 * Daily Trading Automation Dashboard
 * Control panel for managing automated trading workflows
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Eye, Trash2, Square, CheckSquare, Send, ShoppingCart,
  Power, Settings2, RefreshCw, BarChart3, GitMerge, Zap, Lock, Unlock
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { skipToken } from '@tanstack/react-query';

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

type CCScanResult = {
  account: string;
  symbol: string;
  optionSymbol: string;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  quantity: number;
  premiumPerContract: number;
  totalPremium: number;
  returnPct: number;
  weeklyReturn: number;
  currentPrice: number;
  action: 'WOULD_SELL_CC';
};

// Roll Positions types
type SpreadLeg = {
  symbol: string;
  optionType: 'PUT' | 'CALL';
  strike: number;
  expiration: string;
  role: 'short' | 'long';
  quantity: number;
  markPrice: number;
  openPrice: number;
};

type SpreadDetails = {
  strategyType: 'CSP' | 'CC' | 'BPS' | 'BCS' | 'IC';
  shortStrike?: number;
  longStrike?: number;
  spreadWidth?: number;
  putShortStrike?: number;
  putLongStrike?: number;
  callShortStrike?: number;
  callLongStrike?: number;
  legs: SpreadLeg[];
};

type RollAnalysis = {
  positionId: string;
  symbol: string;
  optionSymbol: string;
  strategy: 'CSP' | 'CC' | 'BPS' | 'BCS' | 'IC';
  urgency: 'red' | 'yellow' | 'green';
  shouldRoll: boolean;
  reasons: string[];
  metrics: {
    dte: number;
    profitCaptured: number;
    itmDepth: number;
    delta: number;
    currentPrice: number;
    strikePrice: number;
    currentValue: number;
    openPremium: number;
    expiration: string;
  };
  score: number;
  accountId?: string;
  accountNumber?: string;
  spreadDetails?: SpreadDetails;
};

type RollCandidate = {
  action: 'roll' | 'close';
  strike?: number;
  expiration?: string;
  dte?: number;
  netCredit?: number;
  newPremium?: number;
  annualizedReturn?: number;
  meets3XRule?: boolean;
  delta?: number;
  score: number;
  description: string;
};

type RunResult = {
  success: boolean;
  runId: string;
  summary: RunSummary;
  scanResults: ScanResult[]; // populated after fetching the log
  ccScanResults: CCScanResult[]; // populated after fetching the log
};

export default function AutomationDashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [activeScanStep, setActiveScanStep] = useState<'all' | 'btc' | 'cc' | null>(null); // Track which scan is running
  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);
  const [selectedCCPositions, setSelectedCCPositions] = useState<Set<string>>(new Set());
  const [showScanResults, setShowScanResults] = useState(true);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [hideExpiringToday, setHideExpiringToday] = useState(true); // Hide DTE=0 by default
  const [activeTab, setActiveTab] = useState('step1-close');
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  // Roll Positions state
  const [rollScanResults, setRollScanResults] = useState<{ red: RollAnalysis[]; yellow: RollAnalysis[]; green: RollAnalysis[]; all: RollAnalysis[]; total: number; accountsScanned: number } | null>(null);
  const [isRollScanning, setIsRollScanning] = useState(false);
  const [expandedRollRow, setExpandedRollRow] = useState<string | null>(null);
  const [rollCandidatesCache, setRollCandidatesCache] = useState<Record<string, RollCandidate[]>>({});
  const [selectedRollPositions, setSelectedRollPositions] = useState<Set<string>>(new Set());
  const [rollCandidateSelections, setRollCandidateSelections] = useState<Record<string, RollCandidate | null>>({});
  const [isSubmittingRolls, setIsSubmittingRolls] = useState(false);
  const [rollFilter, setRollFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all');
  const [rollStrategyFilter, setRollStrategyFilter] = useState<'all' | 'CSP' | 'CC' | 'BPS' | 'BCS' | 'IC'>('all');
  const [rollPnlFilter, setRollPnlFilter] = useState<'all' | 'winner' | 'breakeven' | 'loser'>('all');
  const [rollSortCol, setRollSortCol] = useState<string>('unrealizedPnl');
  const [rollSortDir, setRollSortDir] = useState<'asc' | 'desc'>('asc');
  // UnifiedOrderPreviewModal state
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  const [previewAccountId, setPreviewAccountId] = useState<string>('');
  const [previewPremiumCollected, setPreviewPremiumCollected] = useState<number>(0);
  const [orderSubmissionComplete, setOrderSubmissionComplete] = useState(false);
  const [orderFinalStatus, setOrderFinalStatus] = useState<string | null>(null);
  // Track which positions were submitted in the last live run so we can remove them on modal close
  const [submittedPositionKeys, setSubmittedPositionKeys] = useState<Set<string>>(new Set());

  // Open the order preview modal for a single position (individual close)
  const handleOpenSingleOrderPreview = useCallback((result: ScanResult) => {
    const isCall = result.type === 'CC';
    const strikeMatch = result.optionSymbol.match(/(\d{8})[CP](\d{8})$/);
    const strike = strikeMatch ? parseInt(strikeMatch[2], 10) / 1000 : 0;
    const order: UnifiedOrder = {
      symbol: result.symbol,
      strike,
      expiration: result.expiration ?? '',
      premium: result.buyBackCost / (result.quantity * 100),
      action: 'BTC',
      optionType: isCall ? 'CALL' : 'PUT',
      bid: result.buyBackCost / (result.quantity * 100),
      ask: result.buyBackCost / (result.quantity * 100),
      currentPrice: result.buyBackCost / (result.quantity * 100),
    };
    setPreviewAccountId(result.account);
    setUnifiedOrders([order]);
    setPreviewPremiumCollected(result.premiumCollected);
    setOrderSubmissionComplete(false);
    setOrderFinalStatus(null);
    // Temporarily set selected positions to just this one so handleUnifiedSubmit works
    setSelectedPositions(new Set([`${result.optionSymbol}|${result.account}`]));
    setShowOrderPreview(true);
  }, []);

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
    // Sum up total premium collected across all selected positions
    const totalPremiumCollected = selected.reduce((sum, r) => sum + r.premiumCollected, 0);
    setPreviewPremiumCollected(totalPremiumCollected);
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

  // Roll Positions mutations
  const scanRollPositions = trpc.rolls.scanRollPositions.useMutation({
    onSuccess: (data) => {
      setRollScanResults(data as any);
      setIsRollScanning(false);
      const total = (data as any).total || 0;
      const red = (data as any).red?.length || 0;
      if (total === 0) {
        toast.info('No positions need rolling at this time.');
      } else {
        toast.success(`Found ${total} position${total !== 1 ? 's' : ''} to review · ${red} urgent`);
      }
    },
    onError: (err) => {
      setIsRollScanning(false);
      toast.error(`Roll scan failed: ${err.message}`);
    },
  });

  const submitRollOrders = trpc.rolls.submitRollOrders.useMutation({
    onSuccess: (data) => {
      setIsSubmittingRolls(false);
      if (data.summary.failed === 0) {
        toast.success(`${data.summary.success} roll order${data.summary.success !== 1 ? 's' : ''} submitted successfully!`);
      } else {
        toast.warning(`${data.summary.success} submitted, ${data.summary.failed} failed.`);
      }
      setSelectedRollPositions(new Set());
      setRollCandidateSelections({});
    },
    onError: (err) => {
      setIsSubmittingRolls(false);
      toast.error(`Roll submission failed: ${err.message}`);
    },
  });

  const handleRollScan = () => {
    setIsRollScanning(true);
    setRollScanResults(null);
    setExpandedRollRow(null);
    setSelectedRollPositions(new Set());
    setRollCandidateSelections({});
    scanRollPositions.mutate({});
  };

  const handleSubmitRolls = (dryRun = false) => {
    if (!rollScanResults) return;
    const allPositions = rollScanResults.all;
    const orders: any[] = [];
    for (const key of Array.from(selectedRollPositions)) {
      const pos = allPositions.find(p => p.positionId === key);
      if (!pos) continue;
      const candidate = rollCandidateSelections[key];
      if (!candidate) continue;

      const isSpread = ['BPS', 'BCS', 'IC'].includes(pos.strategy);
      const accountNumber = pos.accountNumber || pos.accountId || '';

      if (isSpread && pos.spreadDetails) {
        // Multi-leg atomic roll for spreads
        orders.push({
          accountNumber,
          symbol: pos.symbol,
          strategyType: pos.strategy as 'BPS' | 'BCS' | 'IC',
          action: candidate.action,
          spreadLegs: pos.spreadDetails.legs,
          spreadWidth: pos.spreadDetails.spreadWidth,
          newExpiration: candidate.action === 'roll' ? candidate.expiration : undefined,
          newShortStrike: candidate.action === 'roll' ? candidate.strike : undefined,
          netCredit: candidate.action === 'roll' ? candidate.netCredit : undefined,
        });
      } else {
        // Single-leg CSP / CC roll
        orders.push({
          accountNumber,
          symbol: pos.symbol,
          strategyType: pos.strategy as 'CSP' | 'CC',
          currentOptionSymbol: pos.optionSymbol,
          currentQuantity: 1,
          currentValue: pos.metrics.currentValue,
          newStrike: candidate.action === 'roll' ? candidate.strike : undefined,
          newExpiration: candidate.action === 'roll' ? candidate.expiration : undefined,
          newPremium: candidate.action === 'roll' ? candidate.newPremium : undefined,
          netCredit: candidate.action === 'roll' ? candidate.netCredit : undefined,
          action: candidate.action,
        });
      }
    }
    if (orders.length === 0) {
      toast.warning('No positions selected with a roll candidate chosen.');
      return;
    }
    setIsSubmittingRolls(true);
    submitRollOrders.mutate({ orders, dryRun });
  };

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
      // Record which positions were submitted in a live run so we can clear them on modal close
      if (!isDryRun) {
        const keys = new Set(selected.map(s => `${s.optionSymbol}|${s.accountNumber}`));
        setSubmittedPositionKeys(keys);
      }
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
  // DTE=0 positions are NEVER auto-selected or included in select-all (let them expire naturally)
  const selectableResults = wouldCloseResults.filter(r => r.dte !== 0);
  // Use stable posKey for selection — survives sorting
  const allSelected = selectableResults.length > 0 && selectableResults.every(r =>
    selectedPositions.has(`${r.optionSymbol}|${r.account}`)
  );

  const toggleSelectAll = useCallback(() => {
    if (!lastRunResult) return;
    if (allSelected) {
      setSelectedPositions(new Set());
    } else {
      // Never select DTE=0 positions — let them expire worthless naturally
      const keys = new Set(selectableResults
        .map(r => `${r.optionSymbol}|${r.account}`));
      setSelectedPositions(keys);
    }
  }, [lastRunResult, allSelected, selectableResults]);

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
    if (!latestLog || !lastRunResult) return;
    const parsed: ScanResult[] = latestLog.scanResultsJson ? JSON.parse(latestLog.scanResultsJson as string) : [];
    const ccParsed: CCScanResult[] = (latestLog as any).ccScanResultsJson ? JSON.parse((latestLog as any).ccScanResultsJson as string) : [];
    if (parsed.length === 0 && ccParsed.length === 0) return;

    setLastRunResult(prev => {
      if (!prev) return prev;
      // Only update the arrays that are still empty (avoid overwriting already-populated results)
      return {
        ...prev,
        scanResults: prev.scanResults.length === 0 ? parsed : prev.scanResults,
        ccScanResults: prev.ccScanResults.length === 0 ? ccParsed : prev.ccScanResults,
      };
    });

    // Auto-select WOULD_CLOSE positions, but NEVER DTE=0 (let them expire naturally)
    if (lastRunResult.scanResults.length === 0 && parsed.length > 0) {
      const keys = new Set(parsed
        .filter(r => r.action === 'WOULD_CLOSE' && r.dte !== 0)
        .map(r => `${r.optionSymbol}|${r.account}`));
      setSelectedPositions(keys);
    }
    // Auto-select all CC opportunities
    if (lastRunResult.ccScanResults.length === 0 && ccParsed.length > 0) {
      const ccKeys = new Set(ccParsed.map(r => `${r.optionSymbol}|${r.account}`));
      setSelectedCCPositions(ccKeys);
    }
  }, [latestLog]);

  // Run automation mutation
  const runAutomation = trpc.automation.runAutomation.useMutation({
    onSuccess: (data) => {
      const scanStep = activeScanStep; // capture before clearing
      setIsRunning(false);
      setActiveScanStep(null);
      setShowScanResults(true);
      refetchLogs();
      const wouldClose = data.summary.wouldClose ?? data.summary.positionsClosedCount;
      const totalScanned = data.summary.totalScanned ?? 0;
      // For CC-only scan: preserve existing BTC scan results, only reset CC results
      if (scanStep === 'cc') {
        setLastRunResult(prev => ({
          success: true,
          runId: data.runId,
          summary: data.summary as RunSummary,
          scanResults: prev?.scanResults ?? [],
          ccScanResults: [],
        }));
      } else {
        // Full scan or BTC-only: reset everything
        setLastRunResult({
          success: true,
          runId: data.runId,
          summary: data.summary as RunSummary,
          scanResults: [],
          ccScanResults: [],
        });
      }
      setLastRunId(data.runId);
      // Invalidate so the getLog query fires
      utils.automation.getLog.invalidate({ runId: data.runId });
      const wouldSellCC = data.summary.wouldSellCC ?? 0;
      if (wouldClose > 0 || wouldSellCC > 0) {
        const parts = [];
        if (wouldClose > 0) parts.push(`${wouldClose} position${wouldClose !== 1 ? 's' : ''} to close`);
        if (wouldSellCC > 0) parts.push(`${wouldSellCC} CC opportunit${wouldSellCC !== 1 ? 'ies' : 'y'}`);
        toast.success(`Scan complete! Found ${parts.join(' · ')}`);
      } else {
        toast.info(`Scan complete. ${totalScanned} position${totalScanned !== 1 ? 's' : ''} scanned — none meet the ${settings?.profitThresholdPercent ?? 75}% threshold.`);
      }
    },
    onError: (error) => {
      setIsRunning(false);
      setActiveScanStep(null);
      toast.error(`Automation failed: ${error.message}`);
    },
  });

  const handleRunAutomation = () => {
    setIsRunning(true);
    setActiveScanStep('all');
    setLastRunResult(null);
    runAutomation.mutate({ triggerType: 'manual' });
  };

  const handleRunCCScan = () => {
    setIsRunning(true);
    setActiveScanStep('cc');
    // Preserve existing BTC scan results, only clear CC results
    setLastRunResult(prev => prev ? { ...prev, ccScanResults: [] } : null);
    runAutomation.mutate({ triggerType: 'manual', scanSteps: ['cc'] });
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
    <div className="container py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Daily Trading Automation</h1>
          <p className="text-muted-foreground mt-1">
            Six-step automated workflow: close, roll, sell calls, sell puts, open spreads, manage PMCCs
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <ConnectionStatusIndicator />
          {/* Kill Switch */}
          <button
            onClick={() => {
              setKillSwitchActive(v => !v);
              if (!killSwitchActive) toast.error('Kill switch activated — all automation paused');
              else toast.success('Kill switch deactivated — automation resumed');
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
              killSwitchActive
                ? 'bg-red-600/20 border-red-500/50 text-red-400 hover:bg-red-600/30'
                : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
            }`}
            title={killSwitchActive ? 'Automation paused — click to resume' : 'Click to pause all automation'}
          >
            {killSwitchActive ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            {killSwitchActive ? 'Paused' : 'Kill Switch'}
          </button>
          {/* Master Run All button */}
          <Button
            onClick={handleRunAutomation}
            disabled={isRunning || killSwitchActive}
            size="sm"
            className={`${
              killSwitchActive ? 'opacity-50 cursor-not-allowed' :
              settings?.dryRunMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'
            } text-white`}
          >
            {isRunning ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scanning...</>
            ) : (
              <><Zap className="mr-2 h-4 w-4" />Run All Steps</>
            )}
          </Button>
        </div>
      </div>

      {/* Kill Switch Warning Banner */}
      {killSwitchActive && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-600/10 border border-red-500/30 text-red-400">
          <Lock className="h-5 w-5 shrink-0" />
          <div>
            <span className="font-semibold">All automation is paused.</span>
            <span className="ml-2 text-sm">Click the Kill Switch button above to resume.</span>
          </div>
        </div>
      )}

      {/* Six-Step Automation Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6 h-auto">
          <TabsTrigger value="step1-close" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">1</span>
            <span>Close for Profit</span>
          </TabsTrigger>
          <TabsTrigger value="step2-roll" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">2</span>
            <span>Roll Positions</span>
          </TabsTrigger>
          <TabsTrigger value="step3-cc" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">3</span>
            <span>Sell Calls</span>
          </TabsTrigger>
          <TabsTrigger value="step4-csp" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">4</span>
            <span>Sell Puts</span>
          </TabsTrigger>
          <TabsTrigger value="step5-spreads" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">5</span>
            <span>Open Spreads</span>
          </TabsTrigger>
          <TabsTrigger value="step6-pmcc" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">6</span>
            <span>PMCC Mgmt</span>
          </TabsTrigger>
        </TabsList>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 1: Close for Profit (BTC scan)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step1-close" className="space-y-4">

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

            <h3 className="font-semibold pt-4">Covered Call Automation</h3>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="cc-automation">Enable CC Scan</Label>
                <p className="text-sm text-muted-foreground">
                  Scan for covered call opportunities during automation runs
                </p>
              </div>
              <Switch
                id="cc-automation"
                checked={settings?.ccAutomationEnabled ?? false}
                onCheckedChange={(checked) => handleToggle('ccAutomationEnabled', checked)}
              />
            </div>
            
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
                            {result.action === 'WOULD_CLOSE' && result.dte !== 0 ? (
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
                              result.dte === 0 ? (
                                // DTE=0: show informational badge only — no close button
                                <Badge className="bg-amber-600/20 text-amber-400 border-amber-500/30">
                                  <TrendingUp className="h-3 w-3 mr-1" />
                                  Expires Today
                                </Badge>
                              ) : (
                                // Normal WOULD_CLOSE: clickable button to open single-position modal
                                <button
                                  onClick={() => handleOpenSingleOrderPreview(result)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/40 hover:border-cyan-400/60 transition-colors cursor-pointer"
                                >
                                  <TrendingUp className="h-3 w-3" />
                                  Ready to Close
                                </button>
                              )
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

        </TabsContent>{/* end step1-close */}

        {/* ─────────────────────────────────────────────────────────────────
            STEP 2: Roll Positions
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step2-roll" className="space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <GitMerge className="h-5 w-5 text-orange-400" />
                Roll Positions
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Scan all accounts for CSP/CC positions approaching expiry or under stress
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleRollScan}
                disabled={isRollScanning || killSwitchActive}
                className="bg-orange-600 hover:bg-orange-700 text-white"
                size="sm"
              >
                {isRollScanning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Scanning Accounts...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" />Scan Roll Positions</>
                )}
              </Button>
            </div>
          </div>

          {/* Filter bar — only shown when results are available */}
          {rollScanResults && (
            <div className="space-y-2 mb-4">
              {/* Row 1: Urgency filter */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">Urgency:</span>
                {(['all', 'red', 'yellow', 'green'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setRollFilter(f)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                      rollFilter === f
                        ? f === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/40'
                          : f === 'yellow' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                          : f === 'green' ? 'bg-green-500/20 text-green-400 border-green-500/40'
                          : 'bg-muted text-foreground border-border'
                        : 'text-muted-foreground border-transparent hover:border-border hover:text-foreground'
                    }`}
                  >
                    {f === 'all' ? `All (${rollScanResults.total})` : f === 'red' ? `🔴 Loser (${rollScanResults.red.length})` : f === 'yellow' ? `🟡 Even (${rollScanResults.yellow.length})` : `🟢 Winner (${rollScanResults.green.length})`}
                  </button>
                ))}
              </div>
              {/* Row 2: Strategy filter */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">Strategy:</span>
                {(['all', 'CSP', 'CC', 'BPS', 'BCS', 'IC'] as const).map(s => {
                  const allPositions = rollScanResults.all;
                  const count = s === 'all' ? allPositions.length : allPositions.filter(p => p.strategy === s).length;
                  if (s !== 'all' && count === 0) return null;
                  return (
                    <button
                      key={s}
                      onClick={() => setRollStrategyFilter(s)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                        rollStrategyFilter === s
                          ? s === 'CSP' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                            : s === 'CC' ? 'bg-purple-500/20 text-purple-400 border-purple-500/40'
                            : s === 'BPS' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                            : s === 'BCS' ? 'bg-pink-500/20 text-pink-400 border-pink-500/40'
                            : s === 'IC' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                            : 'bg-muted text-foreground border-border'
                          : 'text-muted-foreground border-transparent hover:border-border hover:text-foreground'
                      }`}
                    >
                      {s === 'all' ? `All Strategies` : `${s} (${count})`}
                    </button>
                  );
                })}
              </div>
              {/* Row 3: P&L Status filter */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">P&amp;L:</span>
                {(['all', 'winner', 'breakeven', 'loser'] as const).map(p => {
                  const allPositions = rollScanResults.all;
                  const count = p === 'all' ? allPositions.length : allPositions.filter(pos => (pos as any).pnlStatus === p).length;
                  if (p !== 'all' && count === 0) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => setRollPnlFilter(p)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                        rollPnlFilter === p
                          ? p === 'winner' ? 'bg-green-500/20 text-green-400 border-green-500/40'
                            : p === 'loser' ? 'bg-red-500/20 text-red-400 border-red-500/40'
                            : p === 'breakeven' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                            : 'bg-muted text-foreground border-border'
                          : 'text-muted-foreground border-transparent hover:border-border hover:text-foreground'
                      }`}
                    >
                      {p === 'all' ? 'All P&L' : p === 'winner' ? `🟢 Winners (${count})` : p === 'loser' ? `🔴 Losers (${count})` : `🟡 Breakeven (${count})`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!rollScanResults && !isRollScanning && (
            <Card className="border-orange-500/20">
              <CardContent className="py-12 text-center text-muted-foreground space-y-3">
                <GitMerge className="h-12 w-12 mx-auto opacity-30" />
                <p className="font-semibold text-base">Ready to scan</p>
                <p className="text-sm max-w-md mx-auto">
                  Click "Scan Roll Positions" to see every open options position ranked by P&L health.
                  The primary signal is whether you're winning or losing on each trade.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <Badge variant="outline" className="text-red-400 border-red-400/40">🔴 Loser — net loss or ITM with &lt;30% profit</Badge>
                  <Badge variant="outline" className="text-yellow-400 border-yellow-400/40">🟡 Breakeven — 20–50% profit or near ATM</Badge>
                  <Badge variant="outline" className="text-green-400 border-green-400/40">🟢 Winner — &gt;50% profit captured</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Loading state */}
          {isRollScanning && (
            <Card className="border-orange-500/20">
              <CardContent className="py-12 text-center space-y-3">
                <Loader2 className="h-10 w-10 mx-auto animate-spin text-orange-400" />
                <p className="text-sm text-muted-foreground">Fetching positions from all accounts and analyzing roll opportunities...</p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {rollScanResults && !isRollScanning && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-3">
                <Card className="border-border/50">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold">{rollScanResults.total}</div>
                    <div className="text-xs text-muted-foreground">Positions Found</div>
                  </CardContent>
                </Card>
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold text-red-400">{rollScanResults.red.length}</div>
                    <div className="text-xs text-muted-foreground">🔴 Losers — need attention</div>
                  </CardContent>
                </Card>
                <Card className="border-yellow-500/30 bg-yellow-500/5">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold text-yellow-400">{rollScanResults.yellow.length}</div>
                    <div className="text-xs text-muted-foreground">🟡 Breakeven — monitor</div>
                  </CardContent>
                </Card>
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold text-green-400">{rollScanResults.green.length}</div>
                    <div className="text-xs text-muted-foreground">🟢 Winners — on track</div>
                  </CardContent>
                </Card>
              </div>

              {rollScanResults.total === 0 ? (
                <Card className="border-green-500/20 bg-green-500/5">
                  <CardContent className="py-8 text-center">
                    <CheckCircle2 className="h-10 w-10 mx-auto text-green-400 mb-2" />
                    <p className="font-semibold text-green-400">All positions are healthy</p>
                    <p className="text-sm text-muted-foreground mt-1">No positions require rolling at this time.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border/50">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/30 text-xs">
                            <th className="text-left p-3 w-8"></th>
                            {/* Sortable column helper */}
                            {([
                              { key: 'pnlStatus', label: 'P&L', align: 'center' },
                              { key: 'unrealizedPnl', label: 'Unreal. P&L', align: 'right' },
                              { key: 'profitPct', label: '% Max Profit', align: 'right' },
                              { key: 'symbol', label: 'Symbol', align: 'left' },
                              { key: 'strategy', label: 'Strategy', align: 'left' },
                              { key: 'stockPrice', label: 'Stock $', align: 'right' },
                              { key: 'strikes', label: 'Strikes', align: 'right' },
                              { key: 'expiry', label: 'Expiry', align: 'left' },
                              { key: 'dte', label: 'DTE', align: 'right' },
                              { key: 'itmDepth', label: 'ITM/OTM', align: 'right' },
                              { key: 'reason', label: 'Reason', align: 'left' },
                              { key: 'rollCandidate', label: 'Roll Candidate', align: 'center' },
                            ] as const).map(col => (
                              <th
                                key={col.key}
                                className={`p-3 text-${col.align} cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap ${
                                  rollSortCol === col.key ? 'text-orange-400' : 'text-muted-foreground'
                                } ${
                                  col.key === 'reason' || col.key === 'rollCandidate' ? 'cursor-default' : ''
                                }`}
                                onClick={() => {
                                  if (col.key === 'reason' || col.key === 'rollCandidate' || col.key === 'strikes') return;
                                  if (rollSortCol === col.key) setRollSortDir(d => d === 'asc' ? 'desc' : 'asc');
                                  else { setRollSortCol(col.key); setRollSortDir('asc'); }
                                }}
                              >
                                {col.label}{rollSortCol === col.key ? (rollSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rollScanResults.all.filter(pos => {
                            if (rollFilter !== 'all') {
                              if (rollFilter === 'red' && pos.urgency !== 'red') return false;
                              if (rollFilter === 'yellow' && pos.urgency !== 'yellow') return false;
                              if (rollFilter === 'green' && pos.urgency !== 'green') return false;
                            }
                            if (rollStrategyFilter !== 'all' && pos.strategy !== rollStrategyFilter) return false;
                            if (rollPnlFilter !== 'all' && (pos as any).pnlStatus !== rollPnlFilter) return false;
                            return true;
                          }).sort((a, b) => {
                            const dir = rollSortDir === 'asc' ? 1 : -1;
                            switch (rollSortCol) {
                              case 'unrealizedPnl': return ((a as any).unrealizedPnl - (b as any).unrealizedPnl) * dir;
                              case 'profitPct': return (a.metrics.profitCaptured - b.metrics.profitCaptured) * dir;
                              case 'symbol': return a.symbol.localeCompare(b.symbol) * dir;
                              case 'strategy': return a.strategy.localeCompare(b.strategy) * dir;
                              case 'stockPrice': return (a.metrics.currentPrice - b.metrics.currentPrice) * dir;
                              case 'expiry': return a.metrics.expiration.localeCompare(b.metrics.expiration) * dir;
                              case 'dte': return (a.metrics.dte - b.metrics.dte) * dir;
                              case 'itmDepth': return (a.metrics.itmDepth - b.metrics.itmDepth) * dir;
                              case 'pnlStatus': {
                                const order = { loser: 0, breakeven: 1, winner: 2 };
                                return ((order[(a as any).pnlStatus as keyof typeof order] ?? 1) - (order[(b as any).pnlStatus as keyof typeof order] ?? 1)) * dir;
                              }
                              default: return 0;
                            }
                          }).map((pos) => {
                            const isExpanded = expandedRollRow === pos.positionId;
                            const isSelected = selectedRollPositions.has(pos.positionId);
                            const selectedCandidate = rollCandidateSelections[pos.positionId];
                            const cachedCandidates = rollCandidatesCache[pos.positionId];
                            const itmDepth = pos.metrics.itmDepth;
                            const profitPct = pos.metrics.profitCaptured;
                            const stockPrice = pos.metrics.currentPrice;
                            const sd = (pos as any).spreadDetails;

                            // Build strikes display: show all legs for spreads
                            const strikesDisplay = (() => {
                              if (!sd) return pos.metrics.strikePrice > 0 ? `$${pos.metrics.strikePrice.toFixed(0)}` : '—';
                              if (sd.strategyType === 'IC') {
                                return `$${sd.putLongStrike}/$${sd.putShortStrike} | $${sd.callShortStrike}/$${sd.callLongStrike}`;
                              }
                              if (sd.strategyType === 'BPS' || sd.strategyType === 'BCS') {
                                return `$${sd.shortStrike}/$${sd.longStrike} (${sd.spreadWidth}w)`;
                              }
                              return `$${sd.shortStrike || pos.metrics.strikePrice}`;
                            })();

                            return (
                              <React.Fragment key={pos.positionId}>
                                <tr
                                  className={`border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer ${
                                    isSelected ? 'bg-orange-500/5' : ''
                                  }`}
                                  onClick={() => setExpandedRollRow(isExpanded ? null : pos.positionId)}
                                >
                                  <td className="p-3" onClick={e => e.stopPropagation()}>
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={(checked) => {
                                        const next = new Set(selectedRollPositions);
                                        if (checked) next.add(pos.positionId);
                                        else next.delete(pos.positionId);
                                        setSelectedRollPositions(next);
                                      }}
                                      disabled={!selectedCandidate}
                                    />
                                  </td>
                                  {/* P&L Status badge */}
                                  <td className="p-3 text-center">
                                    {(pos as any).pnlStatus === 'winner' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-xs font-semibold">🟢 Win</span>
                                    ) : (pos as any).pnlStatus === 'loser' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold">🔴 Loss</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-semibold">🟡 Even</span>
                                    )}
                                  </td>
                                  {/* Unrealized P&L $ */}
                                  <td className={`p-3 text-right font-mono font-bold text-xs ${
                                    (pos as any).unrealizedPnl > 0 ? 'text-green-400' :
                                    (pos as any).unrealizedPnl < 0 ? 'text-red-400' : 'text-muted-foreground'
                                  }`}>
                                    {(pos as any).unrealizedPnl !== undefined
                                      ? `${(pos as any).unrealizedPnl >= 0 ? '+' : ''}$${Math.abs((pos as any).unrealizedPnl).toFixed(0)}`
                                      : '—'}
                                  </td>
                                  {/* % Max Profit — can be negative for losing positions */}
                                  <td className={`p-3 text-right font-mono font-semibold text-xs ${
                                    profitPct >= 80 ? 'text-green-400' : profitPct >= 50 ? 'text-emerald-400' :
                                    profitPct >= 20 ? 'text-yellow-400' : profitPct >= 0 ? 'text-orange-400' : 'text-red-500'
                                  }`}>
                                    {profitPct >= 0 ? `${profitPct.toFixed(0)}%` : `${profitPct.toFixed(0)}%`}
                                  </td>
                                  {/* Symbol */}
                                  <td className="p-3 font-semibold text-xs">{pos.symbol}</td>
                                  {/* Strategy badge */}
                                  <td className="p-3">
                                    <Badge variant="outline" className={`text-xs ${
                                      pos.strategy === 'CSP' ? 'text-blue-400 border-blue-400/40' :
                                      pos.strategy === 'CC'  ? 'text-purple-400 border-purple-400/40' :
                                      pos.strategy === 'BPS' ? 'text-cyan-400 border-cyan-400/40' :
                                      pos.strategy === 'BCS' ? 'text-pink-400 border-pink-400/40' :
                                      pos.strategy === 'IC'  ? 'text-amber-400 border-amber-400/40' :
                                      'text-muted-foreground border-border/40'
                                    }`}>
                                      {pos.strategy}
                                    </Badge>
                                  </td>
                                  {/* Stock Price */}
                                  <td className="p-3 text-right font-mono text-xs text-sky-400">
                                    {stockPrice > 0 ? `$${stockPrice.toFixed(2)}` : '—'}
                                  </td>
                                  {/* Strikes — all legs for spreads */}
                                  <td className="p-3 text-right font-mono text-xs whitespace-nowrap">
                                    {strikesDisplay}
                                  </td>
                                  {/* Expiry */}
                                  <td className="p-3 text-xs">{pos.metrics.expiration}</td>
                                  {/* DTE */}
                                  <td className={`p-3 text-right font-mono text-xs ${
                                    pos.metrics.dte <= 7 ? 'text-red-400' : pos.metrics.dte <= 14 ? 'text-yellow-400' : 'text-muted-foreground'
                                  }`}>{pos.metrics.dte}</td>
                                  {/* ITM/OTM */}
                                  <td className={`p-3 text-right font-mono text-xs ${
                                    itmDepth > 5 ? 'text-red-400' : itmDepth > 0 ? 'text-yellow-400' :
                                    itmDepth < -10 ? 'text-green-400' : 'text-muted-foreground'
                                  }`}>
                                    {itmDepth > 0 ? `▲${itmDepth.toFixed(1)}%` : itmDepth < 0 ? `▼${Math.abs(itmDepth).toFixed(1)}%` : '—'}
                                  </td>
                                  {/* Reason */}
                                  <td className="p-3 text-xs text-muted-foreground max-w-[160px] truncate">
                                    {pos.reasons?.[0] || '—'}
                                  </td>
                                  {/* Roll Candidate */}
                                  <td className="p-3 text-center text-xs">
                                    {selectedCandidate ? (
                                      <span className="text-green-400 font-medium">
                                        {selectedCandidate.action === 'close' ? 'Close only' : `→ $${selectedCandidate.strike?.toFixed(0)} ${selectedCandidate.expiration?.slice(5)}`}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground italic">expand ↓</span>
                                    )}
                                  </td>
                                </tr>
                                {/* Expanded roll candidates row */}
                                {isExpanded && (
                                  <tr key={`${pos.positionId}-expanded`} className="bg-muted/10">
                                    <td colSpan={12} className="p-4">
                                      <RollCandidateExpander
                                        pos={pos}
                                        cachedCandidates={cachedCandidates}
                                        selectedCandidate={selectedCandidate}
                                        onCandidatesLoaded={(candidates) => {
                                          setRollCandidatesCache(prev => ({ ...prev, [pos.positionId]: candidates }));
                                        }}
                                        onSelectCandidate={(candidate) => {
                                          setRollCandidateSelections(prev => ({ ...prev, [pos.positionId]: candidate }));
                                          // Auto-select the position checkbox
                                          setSelectedRollPositions(prev => {
                                            const next = new Set(prev);
                                            next.add(pos.positionId);
                                            return next;
                                          });
                                        }}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Submit bar */}
              {selectedRollPositions.size > 0 && (
                <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-orange-400">{selectedRollPositions.size} roll{selectedRollPositions.size !== 1 ? 's' : ''} selected</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {Array.from(selectedRollPositions).filter(k => rollCandidateSelections[k]?.action === 'roll').length} rolls,{' '}
                      {Array.from(selectedRollPositions).filter(k => rollCandidateSelections[k]?.action === 'close').length} closes
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSelectedRollPositions(new Set()); setRollCandidateSelections({}); }}
                    >
                      Clear
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSubmitRolls(true)}
                      disabled={isSubmittingRolls}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Dry Run
                    </Button>
                    <Button
                      size="sm"
                      className="bg-orange-600 hover:bg-orange-700 text-white"
                      onClick={() => handleSubmitRolls(false)}
                      disabled={isSubmittingRolls || killSwitchActive}
                    >
                      {isSubmittingRolls ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Submit {selectedRollPositions.size} Roll{selectedRollPositions.size !== 1 ? 's' : ''}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 3: Sell Covered Calls (CC scan)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step3-cc" className="space-y-4">
          {/* Tab 3 header with individual scan button */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Sell Covered Calls</h3>
              <p className="text-sm text-muted-foreground">Scan equity holdings for covered call opportunities</p>
            </div>
            <Button
              onClick={handleRunCCScan}
              disabled={isRunning || killSwitchActive}
              variant="outline"
              className="gap-2 border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
            >
              {isRunning && activeScanStep === 'cc' ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Scanning Accounts...</>
              ) : isRunning ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Scan Running...</>
              ) : (
                <><RefreshCw className="h-4 w-4" /> Scan Covered Calls</>
              )}
            </Button>
          </div>
          {/* CC Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Settings2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Covered Call Settings</CardTitle>
                    <CardDescription>Configure DTE range, delta targets, and enable/disable the CC scan</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Label htmlFor="cc-automation-tab">Enable CC Scan</Label>
                  <Switch
                    id="cc-automation-tab"
                    checked={settings?.ccAutomationEnabled ?? true}
                    onCheckedChange={(checked) => handleToggle('ccAutomationEnabled', checked)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="dte-min-tab">Min DTE</Label>
                  <Input id="dte-min-tab" type="number" min="1" max="365" value={settings?.ccDteMin} onChange={(e) => handleNumberChange('ccDteMin', parseInt(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dte-max-tab">Max DTE</Label>
                  <Input id="dte-max-tab" type="number" min="1" max="365" value={settings?.ccDteMax} onChange={(e) => handleNumberChange('ccDteMax', parseInt(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delta-min-tab">Min Delta</Label>
                  <Input id="delta-min-tab" type="text" value={settings?.ccDeltaMin} onChange={(e) => updateSettings.mutate({ ccDeltaMin: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delta-max-tab">Max Delta</Label>
                  <Input id="delta-max-tab" type="text" value={settings?.ccDeltaMax} onChange={(e) => updateSettings.mutate({ ccDeltaMax: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>
          {/* CC Scan Results */}
          {lastRunResult && lastRunResult.ccScanResults && lastRunResult.ccScanResults.length > 0 && (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-5 w-5 text-blue-400" />
                    <div>
                      <CardTitle className="text-lg">Covered Calls to Open</CardTitle>
                      <CardDescription>
                        {lastRunResult.ccScanResults.length} opportunit{lastRunResult.ccScanResults.length !== 1 ? 'ies' : 'y'} found across your equity holdings
                      </CardDescription>
                    </div>
                  </div>
                  {selectedCCPositions.size > 0 && (
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => {
                        const selected = lastRunResult.ccScanResults.filter(r => selectedCCPositions.has(`${r.optionSymbol}|${r.account}`));
                        const orders: UnifiedOrder[] = selected.map(r => ({
                          symbol: r.symbol,
                          strike: r.strike,
                          expiration: r.expiration,
                          premium: r.mid,
                          action: 'STO',
                          optionType: 'CALL',
                          bid: r.bid,
                          ask: r.ask,
                          quantity: r.quantity,
                          accountNumber: r.account,
                        }));
                        setUnifiedOrders(orders);
                        setPreviewAccountId(selected[0]?.account ?? '');
                        setPreviewPremiumCollected(0);
                        setOrderSubmissionComplete(false);
                        setOrderFinalStatus(null);
                        setShowOrderPreview(true);
                      }}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      Review &amp; Submit {selectedCCPositions.size} CC Order{selectedCCPositions.size !== 1 ? 's' : ''}
                    </Button>
                  )}
                </div>
                {/* CC Summary Stats */}
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="text-2xl font-bold text-blue-400">{lastRunResult.ccScanResults.length}</div>
                    <div className="text-xs text-muted-foreground mt-1">CC Opportunities</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="text-2xl font-bold text-green-400">${lastRunResult.ccScanResults.reduce((s, r) => s + r.totalPremium, 0).toFixed(0)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Total Premium</div>
                    <div className="text-xs text-green-400 font-medium">if all submitted</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <div className="text-2xl font-bold text-purple-400">
                      {lastRunResult.ccScanResults.length > 0 ? (lastRunResult.ccScanResults.reduce((s, r) => s + r.weeklyReturn, 0) / lastRunResult.ccScanResults.length).toFixed(2) : '0.00'}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Avg Weekly Return</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 pr-2 w-8">
                          <Checkbox
                            checked={selectedCCPositions.size === lastRunResult.ccScanResults.length}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedCCPositions(new Set(lastRunResult.ccScanResults.map(r => `${r.optionSymbol}|${r.account}`)));
                              else setSelectedCCPositions(new Set());
                            }}
                            aria-label="Select all CC opportunities"
                          />
                        </th>
                        <th className="text-left py-2 pr-3">Symbol</th>
                        <th className="text-left py-2 pr-3">Account</th>
                        <th className="text-right py-2 pr-3">Qty</th>
                        <th className="text-left py-2 pr-3">Strike</th>
                        <th className="text-left py-2 pr-3">Expiration</th>
                        <th className="text-right py-2 pr-3">DTE</th>
                        <th className="text-right py-2 pr-3">Delta</th>
                        <th className="text-right py-2 pr-3">Mid</th>
                        <th className="text-right py-2 pr-3">Total Premium</th>
                        <th className="text-right py-2">Weekly Ret%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastRunResult.ccScanResults.map((r, idx) => {
                        const key = `${r.optionSymbol}|${r.account}`;
                        const isSelected = selectedCCPositions.has(key);
                        return (
                          <tr key={idx} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${isSelected ? 'bg-blue-500/5' : ''}`}>
                            <td className="py-2 pr-2">
                              <Checkbox checked={isSelected} onCheckedChange={() => setSelectedCCPositions(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })} />
                            </td>
                            <td className="py-2 pr-3 font-semibold">{r.symbol}</td>
                            <td className="py-2 pr-3 text-xs text-muted-foreground">{r.account}</td>
                            <td className="py-2 pr-3 text-right">{r.quantity}</td>
                            <td className="py-2 pr-3 font-mono">${r.strike}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{new Date(r.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                            <td className="py-2 pr-3 text-right font-mono text-xs">{r.dte}</td>
                            <td className="py-2 pr-3 text-right font-mono text-xs">{r.delta.toFixed(2)}</td>
                            <td className="py-2 pr-3 text-right font-mono text-green-400">${r.mid.toFixed(2)}</td>
                            <td className="py-2 pr-3 text-right font-mono text-green-400">${r.totalPremium.toFixed(0)}</td>
                            <td className="py-2 text-right font-mono text-purple-400">{r.weeklyReturn.toFixed(2)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          {lastRunResult && (!lastRunResult.ccScanResults || lastRunResult.ccScanResults.length === 0) && (
            <div className="text-center py-10 text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No covered call opportunities found in the last scan.</p>
              <p className="text-sm mt-1">Make sure you have equity positions with ≥100 shares and CC scan is enabled.</p>
            </div>
          )}
          {!lastRunResult && (
            <div className="text-center py-10 text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Run the automation scan to find covered call opportunities.</p>
            </div>
          )}
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 4: Sell Cash-Secured Puts (Coming Soon)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step4-csp">
          <Card className="border-cyan-500/30 bg-cyan-500/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <BarChart3 className="h-5 w-5 text-cyan-400" />
                <div>
                  <CardTitle>Sell Cash-Secured Puts</CardTitle>
                  <CardDescription>Find new CSP opportunities from your watchlist based on delta, DTE, and premium targets</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-muted-foreground space-y-3">
                <BarChart3 className="h-12 w-12 mx-auto opacity-30" />
                <p className="font-semibold text-base">Coming Soon</p>
                <p className="text-sm max-w-md mx-auto">
                  CSP scanner will scan your watchlist for high-probability put-selling opportunities,
                  filtered by earnings dates, IV rank, and buying power availability.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <Badge variant="outline" className="text-cyan-400 border-cyan-400/40">Earnings filter</Badge>
                  <Badge variant="outline" className="text-cyan-400 border-cyan-400/40">IV rank filter</Badge>
                  <Badge variant="outline" className="text-cyan-400 border-cyan-400/40">Position sizing by BP%</Badge>
                  <Badge variant="outline" className="text-cyan-400 border-cyan-400/40">Configurable on/off</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 5: Open Spreads (Coming Soon)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step5-spreads">
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 text-violet-400" />
                <div>
                  <CardTitle>Open Spreads</CardTitle>
                  <CardDescription>Scan for bear call spreads, bull put spreads, and iron condors when BP is constrained</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-muted-foreground space-y-3">
                <RefreshCw className="h-12 w-12 mx-auto opacity-30" />
                <p className="font-semibold text-base">Coming Soon</p>
                <p className="text-sm max-w-md mx-auto">
                  Spread scanner identifies capital-efficient multi-leg strategies when outright CSPs/CCs
                  would exceed buying power limits. Supports 2-leg and 4-leg structures.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <Badge variant="outline" className="text-violet-400 border-violet-400/40">Bear Call Spread</Badge>
                  <Badge variant="outline" className="text-violet-400 border-violet-400/40">Bull Put Spread</Badge>
                  <Badge variant="outline" className="text-violet-400 border-violet-400/40">Iron Condor</Badge>
                  <Badge variant="outline" className="text-violet-400 border-violet-400/40">Configurable on/off</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 6: PMCC Management (Coming Soon)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step6-pmcc">
          <Card className="border-pink-500/30 bg-pink-500/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-pink-400" />
                <div>
                  <CardTitle>PMCC Management</CardTitle>
                  <CardDescription>Manage Poor Man's Covered Calls — scan LEAPS for short call opportunities and manage existing PMCCs</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-muted-foreground space-y-3">
                <Zap className="h-12 w-12 mx-auto opacity-30" />
                <p className="font-semibold text-base">Coming Soon</p>
                <p className="text-sm max-w-md mx-auto">
                  PMCC manager tracks your long LEAPS positions and suggests optimal short call strikes
                  to sell against them, maximizing premium collection while protecting the long leg.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <Badge variant="outline" className="text-pink-400 border-pink-400/40">LEAPS tracking</Badge>
                  <Badge variant="outline" className="text-pink-400 border-pink-400/40">Short call scanner</Badge>
                  <Badge variant="outline" className="text-pink-400 border-pink-400/40">Delta management</Badge>
                  <Badge variant="outline" className="text-pink-400 border-pink-400/40">Configurable on/off</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>{/* end six-step tabs */}

      {/* Unified Order Preview Modal */}
      {showOrderPreview && unifiedOrders.length > 0 && (
        <UnifiedOrderPreviewModal
          open={showOrderPreview}
          onOpenChange={(open) => {
            setShowOrderPreview(open);
            if (!open) {
              if (orderSubmissionComplete && submittedPositionKeys.size > 0) {
                // Remove submitted positions from the scan results so they don't reappear
                setLastRunResult(prev => {
                  if (!prev) return prev;
                  const remaining = prev.scanResults.filter(
                    r => !submittedPositionKeys.has(`${r.optionSymbol}|${r.account}`)
                  );
                  const removedCount = prev.scanResults.length - remaining.length;
                  if (removedCount > 0) {
                    toast.success(`${removedCount} submitted position${removedCount !== 1 ? 's' : ''} cleared from scan results`);
                  }
                  return {
                    ...prev,
                    scanResults: remaining,
                    summary: {
                      ...prev.summary,
                      positionsClosedCount: remaining.filter(r => r.action === 'WOULD_CLOSE').length,
                    },
                  };
                });
                // Deselect everything that was submitted
                setSelectedPositions(prev => {
                  const next = new Set(prev);
                  submittedPositionKeys.forEach(k => next.delete(k));
                  return next;
                });
                setSubmittedPositionKeys(new Set());
              }
              setUnifiedOrders([]);
              setOrderSubmissionComplete(false);
              setOrderFinalStatus(null);
            }
          }}
          orders={unifiedOrders}
          strategy="btc"
          accountId={previewAccountId}
          availableBuyingPower={0}
          premiumCollected={previewPremiumCollected}
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

/**
 * RollCandidateExpander — lazy-loads roll candidates for a position when the row is expanded.
 * Uses trpc.rolls.getRollCandidates.useQuery with skipToken until position data is available.
 */
function RollCandidateExpander({
  pos,
  cachedCandidates,
  selectedCandidate,
  onCandidatesLoaded,
  onSelectCandidate,
}: {
  pos: RollAnalysis;
  cachedCandidates: RollCandidate[] | undefined;
  selectedCandidate: RollCandidate | null | undefined;
  onCandidatesLoaded: (candidates: RollCandidate[]) => void;
  onSelectCandidate: (candidate: RollCandidate) => void;
}) {
  // Map spread strategy to the getRollCandidates input enum
  const strategyInput = (
    pos.strategy === 'BPS' ? 'bps' :
    pos.strategy === 'BCS' ? 'bcs' :
    pos.strategy === 'IC'  ? 'ic'  :
    pos.strategy === 'CC'  ? 'cc'  : 'csp'
  ) as 'csp' | 'cc' | 'bps' | 'bcs' | 'ic';

  const queryInput = !cachedCandidates ? {
    positionId: pos.positionId,
    symbol: pos.symbol,
    strategy: strategyInput,
    strikePrice: pos.metrics.strikePrice,
    expirationDate: pos.metrics.expiration,
    currentValue: pos.metrics.currentValue,
    openPremium: pos.metrics.openPremium,
    spreadWidth: pos.spreadDetails?.spreadWidth,
  } : skipToken;

  const { data, isLoading } = trpc.rolls.getRollCandidates.useQuery(queryInput, {
    staleTime: 5 * 60 * 1000,
  });

  // When data arrives, cache it in parent — must be in useEffect to avoid setState-during-render
  useEffect(() => {
    if (data && !cachedCandidates) {
      onCandidatesLoaded(data.candidates as RollCandidate[]);
    }
  }, [data, cachedCandidates, onCandidatesLoaded]);

  const candidates = cachedCandidates || (data?.candidates as RollCandidate[] | undefined);
  const underlyingPrice = (data as any)?.underlyingPrice;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Fetching option chain for {pos.symbol}...
      </div>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        No roll candidates found for {pos.symbol}.
      </div>
    );
  }

  const isSpread = ['BPS', 'BCS', 'IC'].includes(pos.strategy);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
        <span className="font-medium text-foreground">{pos.symbol} Roll Options</span>
        {underlyingPrice && <span>Underlying: <span className="font-mono text-blue-400">${underlyingPrice.toFixed(2)}</span></span>}
        <span>Current strike: <span className="font-mono">${pos.metrics.strikePrice.toFixed(2)}</span></span>
        <span>Current DTE: <span className={`font-mono ${pos.metrics.dte <= 7 ? 'text-red-400' : 'text-yellow-400'}`}>{pos.metrics.dte}</span></span>
        {isSpread && pos.spreadDetails?.spreadWidth && (
          <span>Width: <span className="font-mono text-amber-400">${pos.spreadDetails.spreadWidth.toFixed(0)}</span></span>
        )}
      </div>
      {/* Spread legs breakdown */}
      {isSpread && pos.spreadDetails && (
        <div className="mb-3 p-2 rounded-lg bg-muted/20 border border-border/30">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">{pos.strategy} Legs — atomic roll ({pos.spreadDetails.legs.length * 2} total legs)</div>
          <div className="flex flex-wrap gap-2">
            {pos.spreadDetails.legs.map((leg, i) => (
              <div key={i} className={`text-xs px-2 py-1 rounded border ${
                leg.role === 'short' ? 'border-red-400/30 bg-red-500/10 text-red-300' : 'border-green-400/30 bg-green-500/10 text-green-300'
              }`}>
                <span className="font-bold">{leg.role === 'short' ? 'Short' : 'Long'}</span>{' '}
                {leg.optionType === 'PUT' ? 'Put' : 'Call'}{' '}
                <span className="font-mono">${leg.strike.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-2">
        {candidates.map((c, i) => {
          const isSelected = selectedCandidate === c ||
            (selectedCandidate?.action === c.action && selectedCandidate?.strike === c.strike && selectedCandidate?.expiration === c.expiration);
          return (
            <button
              key={i}
              onClick={() => onSelectCandidate(c)}
              className={`w-full text-left p-3 rounded-lg border text-sm transition-all ${
                isSelected
                  ? 'border-orange-500/60 bg-orange-500/10 text-foreground'
                  : 'border-border/40 bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    c.action === 'close' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    {c.action === 'close' ? 'CLOSE' : 'ROLL'}
                  </span>
                  <span className="font-medium">{c.description}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {c.action === 'roll' && c.netCredit !== undefined && (
                    <span className={c.netCredit >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {c.netCredit >= 0 ? '+' : ''}{c.netCredit.toFixed(2)} {c.netCredit >= 0 ? 'credit' : 'debit'}
                    </span>
                  )}
                  {c.action === 'roll' && c.delta !== undefined && (
                    <span className="text-muted-foreground">δ {c.delta.toFixed(2)}</span>
                  )}
                  {c.action === 'roll' && c.annualizedReturn !== undefined && (
                    <span className="text-blue-400">{c.annualizedReturn.toFixed(0)}% ann.</span>
                  )}
                  {c.meets3XRule && (
                    <Badge variant="outline" className="text-green-400 border-green-400/40 text-xs py-0">3X ✓</Badge>
                  )}
                  <span className={`font-semibold ${isSelected ? 'text-orange-400' : 'text-muted-foreground'}`}>
                    Score: {c.score}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
