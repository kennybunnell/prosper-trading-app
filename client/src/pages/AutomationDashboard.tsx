/**
 * Daily Trading Automation Dashboard
 * Control panel for managing automated trading workflows
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Power, Settings2, RefreshCw, BarChart3, GitMerge, Zap, Lock, Unlock, Download
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterPill } from '@/components/FilterPill';
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
  // Spread fields — only populated when type is BPS/BCS/IC
  spreadLongSymbol?: string;   // Long leg OCC symbol
  spreadLongStrike?: string;   // Long leg strike
  spreadLongPrice?: string;    // Long leg close price
  // Mismatch flag — set when short qty > long qty (partial spread + standalone remainder)
  hasMismatch?: boolean;
  standaloneRemainder?: number; // Number of unmatched short contracts routed as single-leg BTC
  // Underlying stock price — enriched via Tradier batch quote
  underlyingPrice?: number;
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
  pnlStatus?: 'winner' | 'breakeven' | 'loser';
  unrealizedPnl?: number;
  hasStaleMarks?: boolean;
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
  isLetExpire?: boolean;
  dogReason?: string | null;
  actionLabel?: 'LET_EXPIRE' | 'CLOSE' | 'ROLL' | 'MONITOR' | 'LET_CALLED' | 'STOP';
  stopLossFlag?: boolean;
  stopLossRatio?: number;
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
  const [isSweeping, setIsSweeping] = useState(false);
  const [isDailyScanning, setIsDailyScanning] = useState(false);

  // Daily scan schedule toggle
  const { data: dailyScanScheduleData, refetch: refetchDailyScanSchedule } = trpc.safeguards.getDailyScanEnabled.useQuery();
  const dailyScanEnabled = dailyScanScheduleData?.enabled ?? true;
  const setDailyScanEnabledMutation = trpc.safeguards.setDailyScanEnabled.useMutation({
    onSuccess: (data) => {
      refetchDailyScanSchedule();
      toast.success(data.enabled
        ? 'Daily scan scheduled — runs every weekday at 9:00 AM ET'
        : 'Daily scan disabled — you can still run it manually');
    },
    onError: (err) => toast.error(`Failed to update daily scan schedule: ${err.message}`),
  });
  const triggerDailyScanMutation = trpc.safeguards.triggerDailyScan.useMutation({
    onSuccess: (data) => {
      setIsDailyScanning(false);
      if (data.alertCount === 0) {
        toast.success(data.message);
      } else {
        toast.warning(data.message, { duration: 8000 });
      }
    },
    onError: (err) => {
      setIsDailyScanning(false);
      toast.error(`Daily scan failed: ${err.message}`);
    },
  });

  // Friday Sweep schedule toggle
  const { data: sweepScheduleData, refetch: refetchSweepSchedule } = trpc.safeguards.getFridaySweepEnabled.useQuery();
  const fridaySweepEnabled = sweepScheduleData?.enabled ?? true;
  const setSweepEnabledMutation = trpc.safeguards.setFridaySweepEnabled.useMutation({
    onSuccess: (data) => {
      refetchSweepSchedule();
      toast.success(data.enabled
        ? 'Friday sweep scheduled — runs every Friday at 9:30 AM ET'
        : 'Friday sweep disabled — you can still run it manually');
    },
    onError: (err) => toast.error(`Failed to update sweep schedule: ${err.message}`),
  });

  // Last sweep audit trail
  const { data: lastSweepInfo, refetch: refetchLastSweepInfo } = trpc.safeguards.getLastSweepInfo.useQuery();
  const updateLastSweepInfoMutation = trpc.safeguards.updateLastSweepInfo.useMutation();

  const triggerFridaySweepMutation = trpc.safeguards.triggerFridaySweep.useMutation({
    onSuccess: (data) => {
      setIsSweeping(false);
      // Persist last sweep result for audit trail
      updateLastSweepInfoMutation.mutate(
        { lastSweepAt: Date.now(), lastSweepAlertCount: data.alertCount ?? 0 },
        { onSuccess: () => refetchLastSweepInfo() }
      );
      if (data.alertCount === 0) {
        toast.success(data.message);
      } else {
        toast.warning(data.message, { duration: 8000 });
      }
    },
    onError: (err) => {
      setIsSweeping(false);
      toast.error(`Friday sweep failed: ${err.message}`);
    },
  });
  // Roll Positions CSV export
  const handleExportRollCSV = () => {
    if (!rollScanResults || rollScanResults.all.length === 0) return;
    const headers = [
      'Symbol', 'Account', 'Strategy', 'P&L Status', 'Unrealized P&L ($)',
      'Profit Captured (%)', 'Stock Price ($)', 'Strike Price ($)', 'Expiration',
      'DTE', 'ITM/OTM Depth (%)', 'Open Premium ($)', 'Current Value ($)',
      'Delta', 'Urgency', 'Action', 'Roll Credit Available', 'Reasons'
    ];
    const rows = rollScanResults.all.map(pos => [
      pos.symbol,
      pos.accountNumber || pos.accountId || '',
      pos.strategy,
      pos.pnlStatus || '',
      pos.unrealizedPnl !== undefined ? pos.unrealizedPnl.toFixed(2) : '',
      pos.metrics.profitCaptured.toFixed(1),
      pos.metrics.currentPrice.toFixed(2),
      pos.metrics.strikePrice.toFixed(2),
      pos.metrics.expiration,
      pos.metrics.dte.toString(),
      pos.metrics.itmDepth.toFixed(2),
      pos.metrics.openPremium.toFixed(2),
      pos.metrics.currentValue.toFixed(2),
      pos.metrics.delta.toFixed(3),
      pos.urgency,
      (pos as any).actionLabel || (pos.shouldRoll ? 'ROLL' : 'HOLD'),
      (() => {
        // Estimate roll credit: for ITM positions, new ATM premium minus cost-to-close
        // currentValue = cost to close; openPremium = original premium received
        // A credit roll is possible when the new premium > cost to close
        // We approximate: if the position is OTM (itmDepth < 0) a credit roll is likely possible
        // If ITM, the deeper the ITM the less likely a credit roll is available
        if (pos.metrics.itmDepth > 5) return 'Unlikely (deep ITM)';
        if (pos.metrics.itmDepth > 0) return 'Marginal (slightly ITM)';
        return 'Likely (OTM)';
      })(),
      `"${pos.reasons.join('; ')}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roll-positions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Roll Positions state
  const [rollScanResults, setRollScanResults] = useState<{ red: RollAnalysis[]; yellow: RollAnalysis[]; green: RollAnalysis[]; all: RollAnalysis[]; letExpire?: RollAnalysis[]; letExpireCount?: number; total: number; accountsScanned: number; winnersExcluded?: number } | null>(null);
  const [isRollScanning, setIsRollScanning] = useState(false);
  const [expandedRollRow, setExpandedRollRow] = useState<string | null>(null);
  const [rollCandidatesCache, setRollCandidatesCache] = useState<Record<string, RollCandidate[]>>({});
  const [selectedRollPositions, setSelectedRollPositions] = useState<Set<string>>(new Set());
  const [rollCandidateSelections, setRollCandidateSelections] = useState<Record<string, RollCandidate | null>>({});
  const [isSubmittingRolls, setIsSubmittingRolls] = useState(false);
  const [rollFilter, setRollFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all');
  // Multi-select Sets — empty Set means "show all" (same as Close for Profit pill behaviour)
  const [rollStrategyFilters, setRollStrategyFilters] = useState<Set<string>>(new Set());
  const [rollPnlFilters, setRollPnlFilters] = useState<Set<string>>(new Set());
  const [rollCreditOnlyFilter, setRollCreditOnlyFilter] = useState(false);
  // Track positions where ALL roll candidates are debits (populated by RollCandidateExpander)
  const [debitOnlyPositions, setDebitOnlyPositions] = useState<Set<string>>(new Set());
  const [rollSortCol, setRollSortCol] = useState<string>('unrealizedPnl');
  const [rollSortDir, setRollSortDir] = useState<'asc' | 'desc'>('asc');
  // Scan results sort + type filter
  const [scanSortCol, setScanSortCol] = useState<string>('realizedPercent');
  const [scanSortDir, setScanSortDir] = useState<'asc' | 'desc'>('desc');
  const [scanTypeFilter, setScanTypeFilter] = useState<string>('all');
  // Ref to always-current visibleScanResults — used by handleOpenOrderPreview
  // (which is declared before the useMemo that computes visibleScanResults)
  const visibleScanResultsRef = useRef<ScanResult[]>([]);
  const handleScanSort = (col: string) => {
    if (scanSortCol === col) {
      setScanSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setScanSortCol(col);
      setScanSortDir('desc');
    }
  };
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
    // Derive call/put from OCC symbol (reliable) — type field may be BCS/BPS/IC for spread positions
    const occTypeMatch = result.optionSymbol.match(/([CP])(\d{8})$/);
    const isCall = occTypeMatch ? occTypeMatch[1] === 'C' : result.type === 'CC';
    // OCC format: ROOT YYMMDD C/P STRIKE8 — strike is the last 8 digits
    const strike = occTypeMatch ? parseInt(occTypeMatch[2], 10) / 1000 : 0;
    const perShareCost = result.buyBackCost / (result.quantity * 100);
    const estimatedBid = Math.max(0.01, perShareCost * 0.8);
    const estimatedAsk = Math.max(0.02, perShareCost * 1.2);
    const order: UnifiedOrder = {
      symbol: result.symbol,
      strike,
      expiration: result.expiration ?? '',
      premium: perShareCost,
      action: 'BTC',
      optionType: isCall ? 'CALL' : 'PUT',
      bid: estimatedBid,
      ask: estimatedAsk,
      currentPrice: perShareCost,
      // Identity fields for submission
      optionSymbol: result.optionSymbol,
      accountNumber: result.account,
      spreadLongSymbol: result.spreadLongSymbol,
      spreadLongPrice: result.spreadLongPrice ? parseFloat(result.spreadLongPrice) : undefined,
      quantity: result.quantity,
      isEstimated: result.isEstimated,
    };
    setPreviewAccountId(result.account);
    setUnifiedOrders([order]);
    setPreviewPremiumCollected(result.premiumCollected);
    setOrderSubmissionComplete(false);
    setOrderFinalStatus(null);
    setShowOrderPreview(true);
  }, []);

  // Build UnifiedOrders from selected scan results and open the preview modal
  const handleOpenOrderPreview = useCallback(() => {
    if (!lastRunResult) return;
    // IMPORTANT: filter from visibleScanResultsRef.current (respects active type-tab filter)
    // so that positions from other tabs (e.g. BPS META/V when BCS tab is active)
    // are never included even if their posKeys are still in selectedPositions.
    const selected = visibleScanResultsRef.current.filter(
      r => selectedPositions.has(posKey(r)) && r.action === 'WOULD_CLOSE'
    );
    if (selected.length === 0) return;

    // ── SAFETY GUARD: block spread entries from single-leg BTC submission ──
    // A spread entry has spreadLongSymbol set AND type is BCS/BPS/IC.
    // If somehow a spread entry ends up in a CC/CSP batch (should not happen after posKey fix),
    // block the entire submission and alert the user.
    const dangerousEntries = selected.filter(
      r => r.spreadLongSymbol && (r.type === 'CC' || r.type === 'CSP')
    );
    if (dangerousEntries.length > 0) {
      toast.error(
        `Safety block: ${dangerousEntries.map(r => r.symbol).join(', ')} ` +
        `appear to be spread positions but are classified as ${dangerousEntries[0].type}. ` +
        `Please re-run the scan to refresh position data before submitting.`,
        { duration: 8000 }
      );
      return;
    }

    // Group by account — use the first account as the modal accountId
    const firstAccount = selected[0].account;
    setPreviewAccountId(firstAccount);

    // Map each selected scan result to a UnifiedOrder (BTC)
    // Embed the scan result identity fields so handleUnifiedSubmit can use orders directly
    const orders: UnifiedOrder[] = selected.map(r => {
      // Derive call/put from OCC symbol — type may be BCS/BPS/IC for spread positions
      const occTypeMatch = r.optionSymbol.match(/([CP])(\d{8})$/);
      const isCall = occTypeMatch ? occTypeMatch[1] === 'C' : r.type === 'CC';
      // OCC format: ROOT YYMMDD C/P STRIKE8 — strike is the last 8 digits
      const strike = occTypeMatch ? parseInt(occTypeMatch[2], 10) / 1000 : 0;
      const perShareCost = r.buyBackCost / (r.quantity * 100);
      // Estimate bid/ask spread: bid = 80% of cost, ask = 120% of cost (typical for near-worthless options)
      const estimatedBid = Math.max(0.01, perShareCost * 0.8);
      const estimatedAsk = Math.max(0.02, perShareCost * 1.2);
      return {
        symbol: r.symbol,
        strike,
        expiration: r.expiration ?? '',
        premium: perShareCost,
        action: 'BTC',
        optionType: isCall ? 'CALL' : 'PUT',
        bid: estimatedBid,
        ask: estimatedAsk,
        currentPrice: perShareCost,
        // Identity fields for submission
        optionSymbol: r.optionSymbol,
        accountNumber: r.account,
        spreadLongSymbol: r.spreadLongSymbol,
        spreadLongPrice: r.spreadLongPrice ? parseFloat(r.spreadLongPrice) : undefined,
        quantity: r.quantity,
        isEstimated: r.isEstimated,
        // Per-order premium collected so Net Profit column can show realized profit
        perOrderPremiumCollected: r.premiumCollected,
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
  // posKey must include type so that a BCS spread entry and a CC remainder entry
  // that share the same optionSymbol (same underlying short call) get distinct keys.
  // Without type in the key, selecting one would also select the other.
  const posKey = (r: ScanResult) => `${r.optionSymbol}|${r.account}|${r.type}`;

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
        // Pass spread leg data for atomic spread closure
        spreadLongSymbol: r.spreadLongSymbol,
        spreadLongPrice: r.spreadLongPrice,
      }));
    setIsSubmitting(true);
    submitCloseOrders.mutate({ orders: selected, dryRun: settings?.dryRunMode ?? true });
  };

  // onSubmit callback for UnifiedOrderPreviewModal
  const handleUnifiedSubmit = async (
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    isDryRun: boolean
  ): Promise<{ results: any[] }> => {
    // Use the orders array directly — it carries optionSymbol, accountNumber, spreadLongSymbol
    // from the scan result (embedded in handleOpenOrderPreview). This avoids the selectedPositions
    // re-filter that was returning an empty array.
    const selected = orders
      .filter(o => o.optionSymbol && o.accountNumber)
      .map(o => {
        const qty = quantities.get(`${o.symbol}-${o.strike}-${o.expiration}`) ?? o.quantity ?? 1;
        return {
          accountNumber: o.accountNumber!,
          optionSymbol: o.optionSymbol!,
          symbol: o.symbol,
          quantity: qty,
          buyBackCost: (o.premium ?? 0) * qty * 100,
          isEstimated: o.isEstimated ?? false,
          spreadLongSymbol: o.spreadLongSymbol,
          spreadLongPrice: o.spreadLongPrice !== undefined ? String(o.spreadLongPrice) : undefined,
        };
      });

    if (selected.length === 0) {
      console.warn('[handleUnifiedSubmit] No orders with optionSymbol/accountNumber — cannot submit');
      return { results: [] };
    }

    try {
      const response = await submitCloseOrders.mutateAsync({ orders: selected, dryRun: isDryRun });
      // Record which positions were submitted in a live run so we can clear them on modal close
      if (!isDryRun) {
        // Use 3-part key to match posKey format (optionSymbol|account|type)
        // We need to look up the type from scanResults since 'selected' only has optionSymbol+accountNumber
        const scanMap = new Map((lastRunResult?.scanResults ?? []).map(r => [`${r.optionSymbol}|${r.account}`, r]));
        const keys = new Set(selected.map(s => {
          const r = scanMap.get(`${s.optionSymbol}|${s.accountNumber}`);
          return r ? posKey(r) : `${s.optionSymbol}|${s.accountNumber}|unknown`;
        }));
        setSubmittedPositionKeys(keys);
      }
      return { results: response.results ?? [] };
    } catch (err: any) {
      console.error('[handleUnifiedSubmit] submitCloseOrders error:', err);
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

  // Apply hide-expiring-today + type filter, then sort
  const visibleScanResults = useMemo(() => {
    let rows = (lastRunResult?.scanResults ?? []).filter(
      r => !(hideExpiringToday && r.dte === 0)
    );
    if (scanTypeFilter !== 'all') {
      rows = rows.filter(r => r.type === scanTypeFilter);
    }
    rows = [...rows].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (scanSortCol) {
        case 'symbol':        av = a.symbol;            bv = b.symbol;            break;
        case 'type':          av = a.type;              bv = b.type;              break;
        case 'underlyingPrice': av = a.underlyingPrice ?? 0; bv = b.underlyingPrice ?? 0; break;
        case 'account':       av = a.account;           bv = b.account;           break;
        case 'quantity':      av = a.quantity;          bv = b.quantity;          break;
        case 'expiration':    av = a.expiration ?? '';  bv = b.expiration ?? '';  break;
        case 'dte':           av = a.dte ?? 9999;       bv = b.dte ?? 9999;       break;
        case 'premium':       av = a.premiumCollected;  bv = b.premiumCollected;  break;
        case 'buyBack':       av = a.buyBackCost;       bv = b.buyBackCost;       break;
        case 'netProfit':     av = a.premiumCollected - a.buyBackCost; bv = b.premiumCollected - b.buyBackCost; break;
        case 'realizedPercent': av = a.realizedPercent; bv = b.realizedPercent;   break;
        default:              av = a.realizedPercent;   bv = b.realizedPercent;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return scanSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return scanSortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return rows;
  }, [lastRunResult?.scanResults, hideExpiringToday, scanTypeFilter, scanSortCol, scanSortDir]);
  // Keep ref in sync so handleOpenOrderPreview (declared before this useMemo) can access current value
  visibleScanResultsRef.current = visibleScanResults;
  const wouldCloseResults = visibleScanResults.filter(r => r.action === 'WOULD_CLOSE');
  // DTE=0 positions are NEVER auto-selected or included in select-all (let them expire naturally)
  const selectableResults = wouldCloseResults.filter(r => r.dte !== 0);
  // Use stable posKey for selection — survives sorting
  const allSelected = selectableResults.length > 0 && selectableResults.every(r =>
    selectedPositions.has(posKey(r))
  );
  // Count only positions that are BOTH selected AND visible in the current tab
  // This is what the "Review & Submit N Orders" button should show
  const visibleSelectedCount = selectableResults.filter(r => selectedPositions.has(posKey(r))).length;

  const toggleSelectAll = useCallback(() => {
    if (!lastRunResult) return;
    if (allSelected) {
      setSelectedPositions(new Set());
    } else {
      // Never select DTE=0 positions — let them expire worthless naturally
      const keys = new Set(selectableResults
        .map(r => posKey(r)));
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
  const utils = trpc.useUtils();
  const updateSettings = trpc.automation.updateSettings.useMutation({
    onSuccess: () => {
      utils.automation.getSettings.invalidate();
      toast.success('Settings updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update settings: ${error.message}`);
    },
  });

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

    // DO NOT auto-select positions — user must explicitly click a strategy pill to select
    // (two-state workflow: flagged = scan found it; selected = user chose it for submission)
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
            Five-step automated workflow: close, roll, sell calls, open spreads, manage PMCCs
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <ConnectionStatusIndicator />
          {/* Test Friday Sweep */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsSweeping(true);
              triggerFridaySweepMutation.mutate();
            }}
            disabled={isSweeping}
            className="flex items-center gap-2 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-600/10"
            title="Manually run the Friday expiration sweep and send a notification if short calls are found within 7 DTE"
          >
            {isSweeping ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Sweeping...</>
            ) : (
              <><RefreshCw className="h-3.5 w-3.5" />Test Friday Sweep</>
            )}
          </Button>
          {/* Friday Sweep Schedule Toggle */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer select-none ${
              fridaySweepEnabled
                ? 'bg-blue-600/10 border-blue-500/30 text-blue-400 hover:bg-blue-600/20'
                : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50'
            }`}
            title={fridaySweepEnabled
              ? 'Friday sweep is scheduled — runs every Friday at 9:30 AM ET. Click to disable.'
              : 'Friday sweep is disabled — click to enable automatic Friday 9:30 AM scan'}
            onClick={() => setSweepEnabledMutation.mutate({ enabled: !fridaySweepEnabled })}
          >
            <span className={`h-2 w-2 rounded-full ${fridaySweepEnabled ? 'bg-blue-400 animate-pulse' : 'bg-muted-foreground'}`} />
            {fridaySweepEnabled ? 'Auto-Sweep ON' : 'Auto-Sweep OFF'}
          </div>
          {/* Last Swept Audit Trail */}
          {lastSweepInfo?.lastSweepAt ? (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                lastSweepInfo.lastSweepAlertCount > 0
                  ? 'bg-amber-600/10 border-amber-500/30 text-amber-400'
                  : 'bg-emerald-600/10 border-emerald-500/30 text-emerald-400'
              }`}
              title={`Last sweep: ${new Date(lastSweepInfo.lastSweepAt).toLocaleString()} — ${lastSweepInfo.lastSweepAlertCount} alert${lastSweepInfo.lastSweepAlertCount !== 1 ? 's' : ''} found`}
            >
              <CheckCircle2 className="h-3 w-3" />
              <span>Last swept {new Date(lastSweepInfo.lastSweepAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
              {lastSweepInfo.lastSweepAlertCount > 0 && (
                <span className="bg-amber-500/20 text-amber-300 rounded px-1">{lastSweepInfo.lastSweepAlertCount} alert{lastSweepInfo.lastSweepAlertCount !== 1 ? 's' : ''}</span>
              )}
            </div>
          ) : null}
          {/* Test Daily Scan */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsDailyScanning(true);
              triggerDailyScanMutation.mutate();
            }}
            disabled={isDailyScanning}
            className="flex items-center gap-2 text-xs border-violet-500/40 text-violet-400 hover:bg-violet-600/10"
            title="Manually run the daily ITM assignment risk scan (5 DTE cutoff) and send a notification if uncovered short calls are found"
          >
            {isDailyScanning ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Scanning...</>
            ) : (
              <><BarChart3 className="h-3.5 w-3.5" />Test Daily Scan</>
            )}
          </Button>
          {/* Daily Scan Schedule Toggle */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer select-none ${
              dailyScanEnabled
                ? 'bg-violet-600/10 border-violet-500/30 text-violet-400 hover:bg-violet-600/20'
                : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50'
            }`}
            title={dailyScanEnabled
              ? 'Daily scan is scheduled — runs every weekday at 9:00 AM ET. Click to disable.'
              : 'Daily scan is disabled — click to enable automatic 9:00 AM weekday scan'}
            onClick={() => setDailyScanEnabledMutation.mutate({ enabled: !dailyScanEnabled })}
          >
            <span className={`h-2 w-2 rounded-full ${dailyScanEnabled ? 'bg-violet-400 animate-pulse' : 'bg-muted-foreground'}`} />
            {dailyScanEnabled ? 'Daily Scan ON' : 'Daily Scan OFF'}
          </div>
          {/* Kill Switch — pill button matching Auto-Sweep/Daily Scan style */}
          <div
            onClick={() => {
              setKillSwitchActive(v => !v);
              if (!killSwitchActive) toast.error('Kill switch activated — all automation paused');
              else toast.success('Kill switch deactivated — automation resumed');
            }}
            title={killSwitchActive ? 'Automation PAUSED — click to resume' : 'Kill Switch — click to pause all automation'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer select-none ${
              killSwitchActive
                ? 'bg-red-600/10 border-red-500/30 text-red-400 hover:bg-red-600/20'
                : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {killSwitchActive ? 'Kill Switch ON' : 'Kill Switch'}
          </div>
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

      {/* Five-Step Automation Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 h-auto">
          <TabsTrigger value="step1-close" className="relative flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">1</span>
            <span className="flex items-center gap-1">
              Close for Profit
              {(() => {
                const profitCount = lastRunResult?.scanResults?.filter(r => r.action === 'WOULD_CLOSE').length ?? 0;
                return profitCount > 0 ? (
                  <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold leading-none">
                    {profitCount}
                  </span>
                ) : null;
              })()
              }
            </span>
          </TabsTrigger>
          <TabsTrigger value="step2-roll" className="relative flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">2</span>
            <span className="flex items-center gap-1">
              Roll Positions
              {(() => {
                const rollCount = rollScanResults?.red?.length ?? 0;
                return rollCount > 0 ? (
                  <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                    {rollCount}
                  </span>
                ) : rollScanResults && rollScanResults.total > 0 ? (
                  <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none">
                    {rollScanResults.total}
                  </span>
                ) : null;
              })()}
            </span>
          </TabsTrigger>
          <TabsTrigger value="step3-cc" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">3</span>
            <span>Sell Calls</span>
          </TabsTrigger>
          <TabsTrigger value="step4-spreads" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">4</span>
            <span>Open Spreads</span>
          </TabsTrigger>
          <TabsTrigger value="step5-pmcc" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">5</span>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-border bg-background hover:bg-accent text-foreground font-bold text-lg flex items-center justify-center transition-colors"
                    onClick={() => handleNumberChange('profitThresholdPercent', Math.max(5, (settings?.profitThresholdPercent ?? 75) - 5))}
                  >
                    −
                  </button>
                  <Input
                    id="profit-threshold"
                    type="number"
                    min="5"
                    max="100"
                    step="5"
                    className="text-center w-20"
                    value={settings?.profitThresholdPercent}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 1 && val <= 100) {
                        handleNumberChange('profitThresholdPercent', val);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-border bg-background hover:bg-accent text-foreground font-bold text-lg flex items-center justify-center transition-colors"
                    onClick={() => handleNumberChange('profitThresholdPercent', Math.min(100, (settings?.profitThresholdPercent ?? 75) + 5))}
                  >
                    +
                  </button>
                </div>
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
                {visibleSelectedCount > 0 && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleOpenOrderPreview}
                  >
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Review &amp; Submit {visibleSelectedCount} Order{visibleSelectedCount !== 1 ? 's' : ''}
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

            {/* Summary Stats — left 2 cards show scan totals; right 2 cards reflect selected positions only */}
            {(() => {
              // Use only visible (tab-filtered) selected results for the summary cards
              const selectedResults = selectableResults.filter(r => selectedPositions.has(posKey(r)));
              const selectedBuyBack = selectedResults.reduce((sum, r) => sum + r.buyBackCost, 0);
              const selectedProfit = selectedResults.reduce((sum, r) => sum + (r.premiumCollected - r.buyBackCost), 0);
              const hasSelection = visibleSelectedCount > 0;
              return (
                <div className="grid grid-cols-4 gap-3 pt-2">
                  {/* Card 1: Flagged count (scan result — always shows scan total) */}
                  <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="text-2xl font-bold text-green-400">
                      {lastRunResult.summary.positionsClosedCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Ready to Close</div>
                    <div className="text-xs text-green-400 font-medium">≥{threshold}% profit</div>
                  </div>
                  {/* Card 2: Below threshold (scan result — always shows scan total) */}
                  <div className="text-center p-3 rounded-lg bg-muted/50 border">
                    <div className="text-2xl font-bold text-muted-foreground">
                      {lastRunResult.summary.belowThreshold}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Below Threshold</div>
                    <div className="text-xs text-muted-foreground font-medium">&lt;{threshold}% profit</div>
                  </div>
                  {/* Card 3: Buy-back cost — reflects SELECTED positions only */}
                  <div className={`text-center p-3 rounded-lg border transition-colors ${
                    hasSelection ? 'bg-amber-500/10 border-amber-500/20' : 'bg-muted/30 border-border/40'
                  }`}>
                    <div className={`text-2xl font-bold transition-colors ${
                      hasSelection ? 'text-amber-400' : 'text-muted-foreground/50'
                    }`}>
                      ${selectedBuyBack.toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Buy-Back Cost</div>
                    <div className={`text-xs font-medium ${
                      hasSelection ? 'text-amber-400' : 'text-muted-foreground/40'
                    }`}>
                      {hasSelection ? `${visibleSelectedCount} selected` : 'select positions above'}
                    </div>
                  </div>
                  {/* Card 4: Est. profit — reflects SELECTED positions only */}
                  <div className={`text-center p-3 rounded-lg border transition-colors ${
                    hasSelection ? 'bg-blue-500/10 border-blue-500/20' : 'bg-muted/30 border-border/40'
                  }`}>
                    <div className={`text-2xl font-bold transition-colors ${
                      hasSelection ? 'text-blue-400' : 'text-muted-foreground/50'
                    }`}>
                      ${selectedProfit.toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {settings?.dryRunMode ? 'Est. Profit' : 'Profit Realized'}
                    </div>
                    <div className={`text-xs font-medium ${
                      hasSelection ? 'text-blue-400' : 'text-muted-foreground/40'
                    }`}>
                      {hasSelection ? 'from selected' : 'select positions above'}
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardHeader>

          {showScanResults && (lastRunResult.scanResults.length > 0 || visibleScanResults.length === 0) && (
            <CardContent>
              {/* Filter toolbar */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {/* Hide expiring today toggle */}
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
                    {lastRunResult.scanResults.filter(r => r.dte === 0).length} DTE=0 hidden
                  </span>
                )}
                {/* Separator */}
                <div className="w-px h-5 bg-border/60 mx-1" />
                {/* Type filter pills — clicking a strategy pill ALSO toggles selection of all flagged positions of that type */}
                {(['all', 'BPS', 'BCS', 'IC', 'CSP', 'CC'] as const).map(t => {
                  const allResults = lastRunResult?.scanResults ?? [];
                  const visibleOfType = t === 'all'
                    ? allResults.filter(r => !(hideExpiringToday && r.dte === 0))
                    : allResults.filter(r => r.type === t && !(hideExpiringToday && r.dte === 0));
                  const count = visibleOfType.length;

                  // Flagged = WOULD_CLOSE and not DTE=0 (selectable)
                  const flaggedOfType = visibleOfType.filter(r => r.action === 'WOULD_CLOSE' && r.dte !== 0);
                  const flaggedCount = flaggedOfType.length;

                  // How many of the flagged are currently selected
                  const selectedOfType = flaggedOfType.filter(r => selectedPositions.has(posKey(r))).length;
                  const allFlaggedSelected = flaggedCount > 0 && selectedOfType === flaggedCount;

                  const variantMap2: Record<string, any> = {
                    BPS: 'sky', BCS: 'purple', IC: 'amber', CSP: 'sky', CC: 'purple',
                  };

                  const handlePillClick = () => {
                    // Only switch the tab filter — do NOT auto-select positions.
                    // Clearing selections on tab switch prevents cross-tab bleed
                    // (e.g. BPS META/V appearing in BCS order preview).
                    if (t !== scanTypeFilter) {
                      setScanTypeFilter(t);
                      setSelectedPositions(new Set()); // clear stale cross-tab selections
                    }
                  };

                  // Build a composite label: strategy name + ready-to-close count if any
                  const pillLabel = t === 'all' ? 'All' : t;
                  const pillTitle = t !== 'all' && flaggedCount > 0
                    ? `Filter to ${t} positions (${flaggedCount} ready to close). Use checkboxes to select.`
                    : undefined;

                  return (
                    <FilterPill
                      key={t}
                      label={pillLabel}
                      count={count}
                      selected={scanTypeFilter === t}
                      variant={variantMap2[t] ?? 'default'}
                      title={pillTitle}
                      onClick={handlePillClick}
                    />
                  );
                })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    {/* Helper: sortable column header */}
                    {(() => {
                      const SortTh = ({ col, label, align = 'left', className = '' }: { col: string; label: string; align?: 'left' | 'right' | 'center'; className?: string }) => (
                        <th
                          className={`py-2 pr-4 font-medium cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors text-${align} ${className}`}
                          onClick={() => handleScanSort(col)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {scanSortCol === col ? (
                              scanSortDir === 'asc'
                                ? <ChevronUp className="h-3 w-3 text-cyan-400" />
                                : <ChevronDown className="h-3 w-3 text-cyan-400" />
                            ) : (
                              <span className="h-3 w-3 opacity-20">↕</span>
                            )}
                          </span>
                        </th>
                      );
                      return (
                        <tr className="border-b text-muted-foreground">
                          <th className="py-2 pr-2 w-8" title="Select / deselect all flagged (Ready to Close) positions">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={toggleSelectAll}
                              aria-label="Select all flagged (Ready to Close) positions"
                            />
                          </th>
                          <SortTh col="symbol" label="Symbol" />
                          <SortTh col="underlyingPrice" label="Price" align="right" />
                          <SortTh col="type" label="Type" />
                          <SortTh col="account" label="Account" />
                          <SortTh col="quantity" label="Qty" align="right" />
                          <SortTh col="expiration" label="Expiration" />
                          <SortTh col="dte" label="DTE" align="right" />
                          <SortTh col="premium" label="Premium Collected" align="right" />
                          <SortTh col="buyBack" label="Buy-Back Cost" align="right" />
                          <SortTh col="netProfit" label="Net Profit" align="right" />
                          <SortTh col="realizedPercent" label="Realized %" align="right" />
                          <th className="text-center py-2 font-medium">Action</th>
                        </tr>
                      );
                    })()}
                  </thead>
                  <tbody>
                    {visibleScanResults
                      .map((result, idx) => (
                        <tr
                          key={idx}
                          className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                            result.action === 'WOULD_CLOSE'
                              ? selectedPositions.has(posKey(result)) ? 'bg-green-500/10' : 'bg-green-500/5'
                              : ''
                          }`}
                        >
                          <td className="py-2.5 pr-2">
                            {result.action === 'WOULD_CLOSE' && result.dte !== 0 ? (
                              <Checkbox
                                checked={selectedPositions.has(posKey(result))}
                                onCheckedChange={() => togglePosition(posKey(result))}
                                aria-label={`Select ${result.symbol}`}
                              />
                            ) : <span />}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="font-semibold">{result.symbol}</span>
                            {(() => {
                              // Parse OCC symbol: AAPL260307P00277500 → P $277.50
                              const parseStrike = (sym: string) => {
                                const m = sym?.match(/([CP])(\d{8})$/);
                                if (!m) return sym?.slice(-10) ?? '?';
                                const type = m[1]; // C or P
                                const raw = parseInt(m[2], 10) / 1000;
                                return `${type === 'C' ? 'Call' : 'Put'} $${raw % 1 === 0 ? raw.toFixed(0) : raw.toFixed(1)}`;
                              };
                              if (result.spreadLongSymbol) {
                                const shortLabel = parseStrike(result.optionSymbol);
                                const longLabel = parseStrike(result.spreadLongSymbol);
                                return (
                                  <span className="block">
                                    <span
                                      className="text-xs text-muted-foreground block cursor-help"
                                      title={`Short: ${result.optionSymbol}\nLong:  ${result.spreadLongSymbol}`}
                                    >
                                      <span className="text-red-400/70">S</span> {shortLabel}
                                      <span className="mx-1 opacity-40">/</span>
                                      <span className="text-green-400/70">L</span> {longLabel}
                                    </span>
                                    {result.hasMismatch && result.standaloneRemainder && (
                                      <span
                                        className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 cursor-help"
                                        title={`Qty mismatch: ${result.standaloneRemainder} short contract${result.standaloneRemainder > 1 ? 's' : ''} have no matching long leg and will be closed as standalone CC/CSP orders.`}
                                      >
                                        ⚠️ +{result.standaloneRemainder} standalone
                                      </span>
                                    )}
                                  </span>
                                );
                              }
                              return (
                                <span
                                  className="text-xs text-muted-foreground block cursor-help"
                                  title={result.optionSymbol}
                                >
                                  {parseStrike(result.optionSymbol)}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono">
                            {result.underlyingPrice ? (
                              <span className="text-blue-400 font-semibold">${result.underlyingPrice.toFixed(2)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4">
                            <Badge
                              variant="outline"
                              className={
                                result.type === 'BPS' ? 'text-cyan-400 border-cyan-400/50 bg-cyan-400/10' :
                                result.type === 'BCS' ? 'text-pink-400 border-pink-400/50 bg-pink-400/10' :
                                result.type === 'IC'  ? 'text-amber-400 border-amber-400/50 bg-amber-400/10' :
                                result.type === 'CSP' ? 'text-blue-400 border-blue-400/50' :
                                                        'text-purple-400 border-purple-400/50'
                              }
                            >
                              {result.type === 'BPS' ? '⬡ BPS' :
                               result.type === 'BCS' ? '⬡ BCS' :
                               result.type === 'IC'  ? '⬡ IC'  :
                               result.type}
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
                          <td className="py-2.5 pr-4 text-right font-mono">
                            {(() => {
                              const netProfit = result.premiumCollected - result.buyBackCost;
                              const isProfit = netProfit >= 0;
                              return (
                                <span
                                  className={`font-bold ${
                                    isProfit
                                      ? result.realizedPercent >= threshold
                                        ? 'text-green-400'
                                        : 'text-amber-400'
                                      : 'text-red-400'
                                  }`}
                                  title={`Net profit if closed now: $${netProfit.toFixed(2)}`}
                                >
                                  {isProfit ? '+' : ''}{netProfit < 0 ? '-' : ''}${Math.abs(netProfit).toFixed(2)}
                                </span>
                              );
                            })()}
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
              {visibleSelectedCount > 0 && (() => {
                // Only count/sum positions visible in the current tab
                const selResults = selectableResults.filter(r => selectedPositions.has(posKey(r)));
                const selBuyBack = selResults.reduce((sum, r) => sum + r.buyBackCost, 0);
                const selProfit = selResults.reduce((sum, r) => sum + (r.premiumCollected - r.buyBackCost), 0);
                return (
                <div className="mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-green-400">{visibleSelectedCount} order{visibleSelectedCount !== 1 ? 's' : ''} selected</span>
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
                      Review &amp; Submit {visibleSelectedCount} Order{visibleSelectedCount !== 1 ? 's' : ''}
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
              {rollScanResults && rollScanResults.all.length > 0 && (
                <Button
                  onClick={handleExportRollCSV}
                  variant="outline"
                  size="sm"
                  className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              )}
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

          {/* Filter bar — FilterPill components with badge counts */}
          {rollScanResults && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              {/* Strategy pills — multi-select toggle (click to add/remove, click again to deselect) */}
              {(['BPS', 'BCS', 'IC', 'CSP', 'CC'] as const).map(s => {
                const count = rollScanResults.all.filter(p => p.strategy === s).length;
                if (count === 0) return null;
                const variantMap: Record<string, 'default' | 'sky' | 'purple' | 'amber'> = {
                  BPS: 'sky', BCS: 'purple', IC: 'amber', CSP: 'sky', CC: 'purple',
                };
                const isActive = rollStrategyFilters.has(s);
                return (
                  <FilterPill
                    key={s}
                    label={s}
                    count={count}
                    selected={isActive}
                    variant={variantMap[s] ?? 'default'}
                    title={isActive ? `Click to remove ${s} filter` : `Click to filter by ${s}`}
                    onClick={() => {
                      setRollStrategyFilters(prev => {
                        const next = new Set(prev);
                        if (next.has(s)) next.delete(s); else next.add(s);
                        return next;
                      });
                    }}
                  />
                );
              })}
              {rollStrategyFilters.size > 0 && (
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/40 hover:border-border transition-colors"
                  onClick={() => setRollStrategyFilters(new Set())}
                  title="Clear strategy filter"
                >✕ clear</button>
              )}
              <div className="w-px h-4 bg-border/60 mx-0.5" />
              {/* P&L pills — multi-select toggle */}
              {(['winner', 'breakeven', 'loser'] as const).map(p => {
                const count = rollScanResults.all.filter(pos => pos.pnlStatus === p).length;
                if (count === 0) return null;
                const label = p === 'winner' ? '🟢 Win' : p === 'loser' ? '🔴 Loss' : '🟡 Even';
                const variant = p === 'winner' ? 'green' : p === 'loser' ? 'red' : 'yellow';
                const isActive = rollPnlFilters.has(p);
                return (
                  <FilterPill
                    key={p}
                    label={label}
                    count={count}
                    selected={isActive}
                    variant={variant as any}
                    title={isActive ? `Click to remove ${p} filter` : `Click to filter by ${p}`}
                    onClick={() => {
                      setRollPnlFilters(prev => {
                        const next = new Set(prev);
                        if (next.has(p)) next.delete(p); else next.add(p);
                        return next;
                      });
                    }}
                  />
                );
              })}
              {rollPnlFilters.size > 0 && (
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/40 hover:border-border transition-colors"
                  onClick={() => setRollPnlFilters(new Set())}
                  title="Clear P&L filter"
                >✕ clear</button>
              )}
              <div className="w-px h-4 bg-border/60 mx-0.5" />
              {/* Credit-only toggle */}
              <FilterPill
                label="💰 Credit Rolls Only"
                selected={rollCreditOnlyFilter}
                variant="green"
                title="Hide positions where a credit roll is unlikely (deep ITM > 5%)"
                onClick={() => setRollCreditOnlyFilter(v => !v)}
              />
              {(rollStrategyFilters.size > 0 || rollPnlFilters.size > 0 || rollCreditOnlyFilter) && (
                <button
                  className="text-[10px] text-orange-400/70 hover:text-orange-400 px-2 py-0.5 rounded border border-orange-500/20 hover:border-orange-500/40 transition-colors ml-1"
                  onClick={() => { setRollStrategyFilters(new Set()); setRollPnlFilters(new Set()); setRollCreditOnlyFilter(false); }}
                  title="Reset all filters"
                >Reset all filters</button>
              )}
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
              <div className="grid grid-cols-5 gap-3">
                <Card className="border-border/50">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold">{rollScanResults.total}</div>
                    <div className="text-xs text-muted-foreground">Actionable Positions</div>
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
                <Card className="border-sky-500/30 bg-sky-500/5">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold text-sky-400">{rollScanResults.letExpireCount ?? 0}</div>
                    <div className="text-xs text-muted-foreground">💚 Let Be Called Away</div>
                  </CardContent>
                </Card>
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold text-green-400">
                      {rollScanResults.winnersExcluded ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">🟢 Winners — left alone</div>
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
                            <th className="text-left p-3 w-8" title="Select / deselect all visible roll positions">
                              {(() => {
                                const visibleIds = rollScanResults.all.filter(pos => {
                                  if (rollFilter !== 'all') {
                                    if (rollFilter === 'red' && pos.urgency !== 'red') return false;
                                    if (rollFilter === 'yellow' && pos.urgency !== 'yellow') return false;
                                    if (rollFilter === 'green' && pos.urgency !== 'green') return false;
                                  }
                                  if (rollStrategyFilters.size > 0 && !rollStrategyFilters.has(pos.strategy)) return false;
                                  if (rollPnlFilters.size > 0 && !rollPnlFilters.has((pos as any).pnlStatus ?? '')) return false;
                                  if (rollCreditOnlyFilter && pos.metrics.itmDepth > 5) return false;
                                  return true;
                                }).map(p => p.positionId);
                                const allRollSelected = visibleIds.length > 0 && visibleIds.every(id => selectedRollPositions.has(id));
                                return (
                                  <Checkbox
                                    checked={allRollSelected}
                                    onCheckedChange={(checked) => {
                                      setSelectedRollPositions(prev => {
                                        const next = new Set(prev);
                                        if (checked) visibleIds.forEach(id => next.add(id));
                                        else visibleIds.forEach(id => next.delete(id));
                                        return next;
                                      });
                                    }}
                                    aria-label="Select all visible roll positions"
                                  />
                                );
                              })()}
                            </th>
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
                            if (rollStrategyFilters.size > 0 && !rollStrategyFilters.has(pos.strategy)) return false;
                            if (rollPnlFilters.size > 0 && !rollPnlFilters.has((pos as any).pnlStatus ?? '')) return false;
                            // Credit-only filter: hide positions where a credit roll is unlikely (deep ITM)
                            if (rollCreditOnlyFilter && pos.metrics.itmDepth > 5) return false;
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
                                  {/* P&L Status + Action Label badges */}
                                  <td className="p-3 text-center">
                                    <div className="flex flex-col items-center gap-1">
                                      {/* P&L status */}
                                      {(pos as any).pnlStatus === 'winner' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-xs font-semibold">🟢 Win</span>
                                      ) : (pos as any).pnlStatus === 'loser' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold">🔴 Loss</span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-semibold">🟡 Even</span>
                                      )}
                                      {/* Action label — the key "what to do" badge */}
                                      {(pos as any).actionLabel === 'ROLL' && !debitOnlyPositions.has(pos.positionId) && (
                                        <span
                                          title="Credit roll viable — click to expand and select a roll candidate"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-[10px] font-bold tracking-wide cursor-pointer hover:bg-orange-500/30"
                                          onClick={e => { e.stopPropagation(); setExpandedRollRow(isExpanded ? null : pos.positionId); }}
                                        >↩ ROLL</span>
                                      )}
                                      {(pos as any).actionLabel === 'ROLL' && debitOnlyPositions.has(pos.positionId) && (
                                        <span
                                          title="No credit roll found — all candidates are debits. Click to review options."
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[10px] font-bold tracking-wide cursor-pointer hover:bg-red-500/30"
                                          onClick={e => { e.stopPropagation(); setExpandedRollRow(isExpanded ? null : pos.positionId); }}
                                        >⚠ DEBIT ONLY</span>
                                      )}
                                      {(pos as any).actionLabel === 'CLOSE' && (
                                        <span
                                          title={
                                            ['BPS','BCS','IC'].includes(pos.strategy)
                                              ? `${pos.strategy} spread is ITM — loss is capped. Rolling at a debit adds cost with no upside. Close and redeploy capital.`
                                              : 'ITM with ≤5 DTE — close now, no time to roll'
                                          }
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600/25 text-red-300 text-[10px] font-bold tracking-wide"
                                        >✕ CLOSE</span>
                                      )}
                                      {(pos as any).actionLabel === 'LET_EXPIRE' && (
                                        <span title="OTM with ≤5 DTE — let time decay finish it" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-bold tracking-wide">✓ LET EXPIRE</span>
                                      )}
                                      {(pos as any).actionLabel === 'MONITOR' && (
                                        <span title="Deep ITM with time remaining — too expensive to roll for credit" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold tracking-wide">👁 MONITOR</span>
                                      )}
                                      {(pos as any).actionLabel === 'LET_CALLED' && (
                                        <span title={(pos as any).dogReason || 'Dog position — let stock be called away'} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 text-[10px] font-bold tracking-wide">📞 LET CALLED</span>
                                      )}
                                      {(pos as any).actionLabel === 'STOP' && (
                                        <span title={`2x STOP-LOSS: Cost to close is ${(pos as any).stopLossRatio || '2'}x the original credit. Close immediately to limit losses.`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600/25 text-red-400 text-[10px] font-bold tracking-wide animate-pulse">⛔ 2X STOP</span>
                                      )}
                                      {pos.hasStaleMarks && (
                                        <span title="P&L uses yesterday's close price — live marks unavailable" className="text-[9px] text-amber-400/70 font-medium">⚠ stale</span>
                                      )}
                                    </div>
                                  </td>
                                  {/* Unrealized P&L $ */}
                                  <td className={`p-3 text-right font-mono font-bold text-xs ${
                                    pos.hasStaleMarks ? 'text-muted-foreground/60' :
                                    (pos as any).unrealizedPnl > 0 ? 'text-green-400' :
                                    (pos as any).unrealizedPnl < 0 ? 'text-red-400' : 'text-muted-foreground'
                                  }`}>
                                    {(pos as any).unrealizedPnl !== undefined
                                      ? `${pos.hasStaleMarks ? '~' : ''}${(pos as any).unrealizedPnl >= 0 ? '+' : ''}$${Math.abs((pos as any).unrealizedPnl).toFixed(0)}`
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
                                          // Determine if ALL roll candidates are debits and update badge
                                          const rollCandidates = candidates.filter(c => c.action === 'roll');
                                          const hasAnyCredit = rollCandidates.some(c => (c.netCredit ?? 0) >= 0);
                                          if (rollCandidates.length > 0 && !hasAnyCredit) {
                                            setDebitOnlyPositions(prev => { const next = new Set(prev); next.add(pos.positionId); return next; });
                                          } else {
                                            setDebitOnlyPositions(prev => { const next = new Set(prev); next.delete(pos.positionId); return next; });
                                          }
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

              {/* Let Be Called Away section */}
              {rollScanResults.letExpire && rollScanResults.letExpire.length > 0 && (
                <Card className="border-sky-500/30 bg-sky-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-2 w-2 rounded-full bg-sky-400" />
                      <h4 className="font-semibold text-sky-300 text-sm">Let Be Called Away ({rollScanResults.letExpire.length})</h4>
                      <span className="text-xs text-muted-foreground ml-1">— These are ITM covered calls on LIQUIDATE or deep-MONITOR underlyings. The strategy is to let them expire and have the stock called away. No action needed.</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/30 text-left">
                            <th className="p-2 text-xs text-muted-foreground font-medium">Symbol</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium">Strategy</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium text-right">Stock $</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium text-right">Strike</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium">Expiry</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium text-right">DTE</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium text-right">ITM Depth</th>
                            <th className="p-2 text-xs text-muted-foreground font-medium">Dog Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rollScanResults.letExpire.map(pos => (
                            <tr key={pos.positionId} className="border-b border-border/20 hover:bg-sky-500/5">
                              <td className="p-2 font-semibold text-xs">{pos.symbol}</td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs text-purple-400 border-purple-400/40">{pos.strategy}</Badge>
                              </td>
                              <td className="p-2 text-right font-mono text-xs text-sky-400">
                                {pos.metrics.currentPrice > 0 ? `$${pos.metrics.currentPrice.toFixed(2)}` : '—'}
                              </td>
                              <td className="p-2 text-right font-mono text-xs">
                                ${pos.metrics.strikePrice.toFixed(0)}
                              </td>
                              <td className="p-2 text-xs">{pos.metrics.expiration}</td>
                              <td className={`p-2 text-right font-mono text-xs ${
                                pos.metrics.dte <= 7 ? 'text-red-400' : pos.metrics.dte <= 14 ? 'text-yellow-400' : 'text-muted-foreground'
                              }`}>{pos.metrics.dte}</td>
                              <td className="p-2 text-right font-mono text-xs text-red-400">
                                {pos.metrics.itmDepth > 0 ? `▲${pos.metrics.itmDepth.toFixed(1)}%` : '—'}
                              </td>
                              <td className="p-2 text-xs text-sky-300/80">{pos.dogReason || '—'}</td>
                            </tr>
                          ))}
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
              size="sm"
              className="gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow-[0_0_12px_rgba(217,119,6,0.5)] hover:shadow-[0_0_18px_rgba(217,119,6,0.7)] transition-shadow"
            >
              {isRunning && activeScanStep === 'cc' ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Scanning Accounts...</>
              ) : isRunning ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Scan Running...</>
              ) : (
                <><Zap className="h-4 w-4" /> Scan Covered Calls</>
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
            STEP 4: Open Spreads (Coming Soon)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step4-spreads">
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
            STEP 5: PMCC Management (Coming Soon)
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step5-pmcc">
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

      </Tabs>{/* end five-step tabs */}

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
                    r => !submittedPositionKeys.has(posKey(r))
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
          initialSkipDryRun={!settings?.dryRunMode}
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

  // Determine if ALL roll candidates are debits
  const rollCandidatesOnly = candidates.filter(c => c.action === 'roll');
  const allDebits = rollCandidatesOnly.length > 0 && rollCandidatesOnly.every(c => (c.netCredit ?? 0) < 0);

  return (
    <div className="space-y-2">
      {/* ITM Playbook guidance — shown when no credit roll is available */}
      {allDebits && (
        <div className="mb-3 p-3 rounded-lg border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-400 font-bold text-xs">⚠ No Credit Roll Available</span>
            <span className="text-xs text-muted-foreground">— all roll candidates require paying a debit.</span>
            {isSpread && (
              <span className="text-xs text-red-300/80 font-medium">
                This is a {pos.strategy} spread — your loss is already capped. Rolling at a debit only adds more cost.
              </span>
            )}
          </div>
          <div className={`grid gap-2 text-xs ${isSpread ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {/* PRIMARY recommendation for spreads: Close */}
            <div className={`p-2 rounded border ${
              isSpread
                ? 'border-red-500/50 bg-red-500/10 ring-1 ring-red-500/30'
                : 'border-amber-500/30 bg-amber-500/5'
            }`}>
              {isSpread && <div className="text-[9px] text-red-400 font-bold uppercase tracking-wider mb-1">Recommended</div>}
              <div className={`font-semibold mb-1 ${isSpread ? 'text-red-300' : 'text-amber-300'}`}>
                {isSpread ? '1. Close (BTC) — Take the Capped Loss' : '1. Let It Expire / Be Assigned'}
              </div>
              <div className="text-muted-foreground">
                {isSpread
                  ? `Your ${pos.strategy} spread has a defined max loss. Rolling at a debit adds cost with no upside — you are paying to stay in a losing trade. Close it, accept the capped loss, and redeploy the capital in a better setup.`
                  : 'If DTE is low and assignment is acceptable, let the position expire. For CSPs: take assignment and sell CCs. For CCs: let stock be called away at the strike.'}
              </div>
            </div>
            {/* Secondary option: only show debit roll for single-leg, not spreads */}
            {!isSpread && (
              <div className="p-2 rounded border border-orange-500/30 bg-orange-500/5">
                <div className="font-semibold text-orange-300 mb-1">2. Roll at Small Debit (Buy Time)</div>
                <div className="text-muted-foreground">Pay a small debit to roll further out in time and/or further OTM. Buys more time for the stock to recover. Only worthwhile on a single-leg (CSP/CC) if the debit is small and you have strong conviction on recovery.</div>
              </div>
            )}
            {/* Always show: Close / cut losses */}
            <div className={`p-2 rounded border ${
              isSpread
                ? 'border-muted/30 bg-muted/10'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              <div className={`font-semibold mb-1 ${isSpread ? 'text-muted-foreground' : 'text-red-300'}`}>
                {isSpread ? '2. Let Expire / Be Assigned (if near DTE)' : '3. Close (BTC) — Cut Losses'}
              </div>
              <div className="text-muted-foreground">
                {isSpread
                  ? 'If DTE is very low, you can also let the spread expire at max loss rather than paying commissions to close it. Check your broker\'s assignment/exercise policy.'
                  : 'Buy back the position and accept the loss. Best when the underlying has broken down technically and recovery is unlikely. Frees up capital for better trades.'}
              </div>
            </div>
          </div>
        </div>
      )}
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
