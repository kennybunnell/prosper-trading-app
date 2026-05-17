/**
 * Daily Trading Automation Dashboard
 * Control panel for managing automated trading workflows
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearch } from 'wouter';
import { ActivePositionsTab, WorkingOrdersTab } from './Performance';
import { UnifiedOrderPreviewModal, UnifiedOrder } from '@/components/UnifiedOrderPreviewModal';
import { RollOrderReviewModal, RollOrderItem } from '@/components/RollOrderReviewModal';
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
  Power, Settings2, RefreshCw, BarChart3, GitMerge, Zap, Lock, Unlock, Download, Timer, ExternalLink, Activity, Mail,
  Sparkles, ListOrdered, ChevronsDownUp, ChevronsUpDown, Info, ShieldCheck, Star, X,
  ArrowLeftRight, Search, PlusCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useSupportWidget } from '@/contexts/SupportContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MessageCircle } from 'lucide-react';
import { ConnectionStatusIndicator } from '@/components/ConnectionStatusIndicator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from 'wouter';
import { Separator } from '@/components/ui/separator';
import InboxPage from './Inbox';
import { skipToken } from '@tanstack/react-query';
import { AIStrategyReviewPanel, ReviewPosition, StrategyType } from '@/components/AIStrategyReviewPanel';
import { AIRollAdvisorPanel, RollAdvisorPosition } from '@/components/AIRollAdvisorPanel';
import { AISellCallAdvisorPanel, SellCallCandidate } from '@/components/AISellCallAdvisorPanel';
import { AIRowIcon } from '@/components/AIRowIcon';
import PMCCDashboard from './PMCCDashboard';
import GtcOrdersInline from '@/components/GtcOrdersInline';
import AutoCloseStep from '@/components/AutoCloseStep';
import BcsAutoEntryStep from '@/components/BcsAutoEntryStep';
import { ColumnVisibilityToggle, useColumnVisibility, type ColumnDef } from '@/components/ColumnVisibilityToggle';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PositionTableSkeleton } from '@/components/PositionTableSkeleton';

// Automation Step 3 CC table column definitions
const AUTO_CC_COLUMNS: ColumnDef[] = [
  { key: 'select',     label: 'Select',      group: 'Core',      pinned: true,  defaultVisible: true  },
  { key: 'symbol',     label: 'Symbol',      group: 'Core',      pinned: true,  defaultVisible: true  },
  { key: 'account',    label: 'Account',     group: 'Core',                     defaultVisible: true  },
  { key: 'qty',        label: 'Qty',         group: 'Position',                 defaultVisible: true  },
  { key: 'strike',     label: 'Strike',      group: 'Position',  pinned: true,  defaultVisible: true  },
  { key: 'expiration', label: 'Expiration',  group: 'Position',                 defaultVisible: true  },
  { key: 'dte',        label: 'DTE',         group: 'Position',  pinned: true,  defaultVisible: true  },
  { key: 'delta',      label: 'Delta',       group: 'Greeks',    pinned: true,  defaultVisible: true  },
  { key: 'mid',        label: 'Mid',         group: 'Returns',   pinned: true,  defaultVisible: true  },
  { key: 'total',      label: 'Total',       group: 'Returns',                  defaultVisible: true  },
  { key: 'wklyPct',    label: 'Wkly%',       group: 'Returns',                  defaultVisible: true  },
  { key: 'aiScore',    label: 'AI Score',    group: 'Technical',                defaultVisible: true  },
  { key: 'ai',         label: 'AI',          group: 'Core',                     defaultVisible: true  },
];

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
  // Max loss for spread positions: (spread width × qty × 100) − net credit. Null for single-leg.
  maxLoss?: number;
  // % of max loss consumed: (buyBackCost / maxLoss) × 100. >100% means position has breached spread width.
  pctOfMaxLoss?: number;
  // ITM demoted — set by safety guard when buyBackCost >= premiumCollected
  itmDemoted?: boolean;
  // Roll suggestion — populated for ITM CCs by the roll advisor step
  rollSuggestion?: {
    newStrike: number;
    newExpiration: string;
    estimatedCredit: number;
    newDte: number;
  };
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
  // D1-D6 enrichment fields (populated by server-side multi-factor scorer)
  openInterest?: number | null;
  volume?: number | null;
  iv?: number | null;
  distanceOtm?: number | null;
  rsi?: number | null;
  bbPctB?: number | null;
  ivRank?: number | null;
  scoreBreakdown?: Record<string, number | null>;
  // AI Tier 1 scoring fields (optional — only populated when AI scoring is enabled)
  aiScore?: number;           // 0-100 confidence score
  aiRationale?: string;       // One-sentence explanation
  aiRecommendedDte?: number | null; // null = current DTE is fine; integer = try this DTE instead
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
  quantity?: number;       // Number of contracts (absolute value of short leg) — passed to getRollCandidates for per-contract math
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
  closeCost?: number;    // absolute BTC debit (close action only, always positive)
  netPnl?: number;      // openPremium - closeCost (positive = profit, negative = loss)
  openPremium?: number; // original credit received when position was opened
  newPremium?: number;
  annualizedReturn?: number;
  meets3XRule?: boolean;
  delta?: number;
  score: number;
  description: string;
};

type CCExcludedStock = {
  account: string;
  symbol: string;
  quantity: number;
  existingContracts: number;
  workingContracts: number;
  reason: string;
  currentPrice?: number;
  maxContracts?: number;
};
type ExcludedScanResult = {
  symbol: string;
  account: string;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  mid: number;
  weeklyReturn: number;
  totalPremium: number;
  optionSymbol: string;
  aiScore: number;
  scoreBreakdown: Record<string, number | null>;
  openInterest: number | null;
  volume: number | null;
  iv: number | null;
  currentPrice: number;
  quantity: number;
};

type RunResult = {
  success: boolean;
  runId: string;
  summary: RunSummary;
  scanResults: ScanResult[]; // populated after fetching the log
  ccScanResults: CCScanResult[]; // populated after fetching the log
  ccExcludedStocks: CCExcludedStock[]; // populated after fetching the log
};

export default function AutomationDashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [activeScanStep, setActiveScanStep] = useState<'all' | 'btc' | 'cc' | null>(null); // Track which scan is running
  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);
  const [selectedCCPositions, setSelectedCCPositions] = useState<Set<string>>(new Set());
  const [autoCcVisibleCols, setAutoCcColVisible, , resetAutoCcCols] = useColumnVisibility(AUTO_CC_COLUMNS, 'prosper_col_vis_auto_cc');
  const [isAiScoring, setIsAiScoring] = useState(false);
  const [excludedScanResults, setExcludedScanResults] = useState<ExcludedScanResult[]>([]);
  const [isExcludedScanning, setIsExcludedScanning] = useState(false);
  const [swapConfirmItem, setSwapConfirmItem] = useState<ExcludedScanResult | null>(null);
  const [showScanResults, setShowScanResults] = useState(true);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [hideExpiringToday, setHideExpiringToday] = useState(true); // Hide DTE=0 by default
  const search = useSearch();
  const urlTab = new URLSearchParams(search).get('tab');
  const [activeTopTab, setActiveTopTab] = useState<'automation' | 'working-orders' | 'open-positions' | 'inbox'>(
    urlTab === 'working-orders' ? 'working-orders' :
    urlTab === 'open-positions' ? 'open-positions' :
    urlTab === 'inbox' ? 'inbox' : 'automation'
  );
  const [activeTab, setActiveTab] = useState('step5-gtc');
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [isDailyScanning, setIsDailyScanning] = useState(false);
  const { openSupport } = useSupportWidget();

  // Persistent daily scan badge counts from cache
  const { data: dailyCounts, refetch: refetchDailyCounts } = trpc.dashboard.getDailyActionCounts.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // 5 min
    refetchInterval: 5 * 60 * 1000,
  });
  const cachedCloseProfitCount = dailyCounts?.closeProfitCount ?? null;
  const cachedRollPositionsCount = dailyCounts?.rollPositionsCount ?? null;
  const cachedSellCallsCount = dailyCounts?.sellCallsCount ?? null;

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
  // Stores the Best Fit winner per positionId — computed when candidates are loaded
  const [bestFitCache, setBestFitCache] = useState<Record<string, BestFitResult | null>>({});
  const [selectedRollPositions, setSelectedRollPositions] = useState<Set<string>>(new Set());
  const [rollCandidateSelections, setRollCandidateSelections] = useState<Record<string, RollCandidate | null>>({});
  const [isSubmittingRolls, setIsSubmittingRolls] = useState(false);
  const [rollFilter, setRollFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all');
  // Multi-select Sets — empty Set means "show all" (same as Close for Profit pill behaviour)
  const [rollStrategyFilters, setRollStrategyFilters] = useState<Set<string>>(new Set());
  const [rollPnlFilters, setRollPnlFilters] = useState<Set<string>>(new Set());
  const [rollCreditOnlyFilter, setRollCreditOnlyFilter] = useState(true); // default ON — show only credit rolls
  const [creditDirectionFilter, setCreditDirectionFilter] = useState(false); // Credit+Direction: credit AND moves strike further OTM
  // Track positions where ALL roll candidates are debits (populated by RollCandidateExpander)
  const [debitOnlyPositions, setDebitOnlyPositions] = useState<Set<string>>(new Set());
  const [rollSortCol, setRollSortCol] = useState<string>('urgency');
  const [rollSortDir, setRollSortDir] = useState<'asc' | 'desc'>('desc');
  // Roll Order Review Modal state
  const [showRollReview, setShowRollReview] = useState(false);
  const [rollReviewItems, setRollReviewItems] = useState<RollOrderItem[]>([]);
  // Scan results sort + type filter
  const [scanSortCol, setScanSortCol] = useState<string>('realizedPercent');
  const [scanSortDir, setScanSortDir] = useState<'asc' | 'desc'>('desc');
  const [scanTypeFilter, setScanTypeFilter] = useState<string>('all');
  const [scanSettleFilter, setScanSettleFilter] = useState<'all' | 'index' | 'equity'>('all');
  // AI Strategy Review Panel state
  const [aiReviewStrategy, setAiReviewStrategy] = useState<StrategyType | null>(null);
  const [aiReviewPositions, setAiReviewPositions] = useState<ReviewPosition[]>([]);
  // AI Roll Advisor panel state
  const [aiRollAdvisorPosition, setAiRollAdvisorPosition] = useState<RollAdvisorPosition | null>(null);
  // AI Sell Call Advisor panel state
  const [aiSellCallCandidate, setAiSellCallCandidate] = useState<SellCallCandidate | null>(null);
  // Ref to always-current visibleScanResults — used by handleOpenOrderPreview
  // (which is declared before the useMemo that computes visibleScanResults)
  const visibleScanResultsRef = useRef<ScanResult[]>([]);
  // Ref to track which positionIds were submitted in the last roll submission
  // Used by submitRollOrders.onSuccess to selectively clear only submitted positions
  const lastSubmittedRollPositionIds = useRef<string[]>([]);
  // Ref to track whether the last roll submission was a dry run
  // Used by submitRollOrders.onSuccess to avoid closing the modal on dry runs
  const lastSubmitWasDryRun = useRef<boolean>(false);
  // Rolled-today tracking: hide positions already rolled today to prevent double-rolling
  const [hideRolledToday, setHideRolledToday] = useState(true);
  const { data: rolledTodayData, refetch: refetchRolledToday } = trpc.rolls.getRolledToday.useQuery(
    undefined,
    { refetchOnWindowFocus: false }
  );
  const rolledTodaySet = useMemo(
    () => new Set(rolledTodayData?.positionIds ?? []),
    [rolledTodayData]
  );
  // Positions that the user has explicitly overridden to allow re-rolling today
  const [overrideRolledPositions, setOverrideRolledPositions] = useState<Set<string>>(new Set());
  // Filter to show only positions flagged for close (CLOSE or STOP action label)
   const [rollCloseFilter, setRollCloseFilter] = useState(false);
  // Hide OTM positions (itmDepth < 0) — default OFF so user sees all, toggle to reduce noise
  const [hideOTMPositions, setHideOTMPositions] = useState(false);
  const [showHiddenLosers, setShowHiddenLosers] = useState(false);
  // Open the BTC close modal for a single Roll position (from the Roll/Close dashboard)
  const handleOpenRollPositionClose = useCallback((pos: RollAnalysis) => {
    const isSpread = ['BPS', 'BCS', 'IC'].includes(pos.strategy);
    const sd = pos.spreadDetails;
    const qty = pos.quantity ?? 1;

    // For spreads: find the short leg (BTC) and long leg (STC) from spreadDetails.legs
    const shortLeg = sd?.legs.find(l => l.role === 'short');
    const longLeg  = sd?.legs.find(l => l.role === 'long');

    // Short leg identity
    const shortSymbol = shortLeg?.symbol ?? pos.optionSymbol;
    const occTypeMatch = shortSymbol.match(/([CP])\d{6}([CP]\d{8})?$/) ||
                         shortSymbol.match(/([CP])(\d{8})$/);
    const isCall = shortLeg ? shortLeg.optionType === 'CALL' : (pos.strategy === 'CC' || pos.strategy === 'BCS');
    const strike = shortLeg?.strike ?? pos.metrics.strikePrice;

    // Short leg cost per share (what we pay to BTC the short)
    const shortMarkPerShare = shortLeg ? shortLeg.markPrice : (pos.metrics.currentValue / (qty * 100));
    const estimatedShortBid = Math.max(0.01, shortMarkPerShare * 0.95);
    const estimatedShortAsk = Math.max(0.02, shortMarkPerShare * 1.05);

    // Long leg credit per share (what we receive to STC the long) — only for spreads
    const longMarkPerShare = longLeg ? longLeg.markPrice : undefined;

    // Net cost per share for the spread close = BTC short - STC long
    const netCostPerShare = isSpread && longMarkPerShare !== undefined
      ? Math.max(0.01, shortMarkPerShare - longMarkPerShare)
      : shortMarkPerShare;

    const order: UnifiedOrder = {
      symbol: pos.symbol,
      strike,
      expiration: pos.metrics.expiration,
      premium: netCostPerShare,          // net cost per share (spread) or gross (single-leg)
      action: 'BTC',
      optionType: isCall ? 'CALL' : 'PUT',
      bid: estimatedShortBid,
      ask: estimatedShortAsk,
      currentPrice: netCostPerShare,
      optionSymbol: shortSymbol,
      accountNumber: pos.accountNumber || pos.accountId || '',
      quantity: qty,
      isEstimated: !shortLeg,            // false when we have live mark prices from spread legs
      // Spread fields — populated for BCS/BPS/IC so the submission layer builds a 2-leg combo order
      ...(isSpread && longLeg ? {
        spreadLongSymbol: longLeg.symbol,
        spreadLongPrice: longMarkPerShare,
        longStrike: longLeg.strike,
        longPremium: longMarkPerShare,
        longBid: longMarkPerShare ? Math.max(0.01, longMarkPerShare * 0.95) : undefined,
        longAsk: longMarkPerShare ? Math.max(0.02, longMarkPerShare * 1.05) : undefined,
      } : {}),
    };
    setPreviewAccountId(pos.accountNumber || pos.accountId || '');
    setUnifiedOrders([order]);
    setPreviewPremiumCollected(pos.metrics.openPremium);
    setPreviewStrategy('btc');
    setOrderSubmissionComplete(false);
    setOrderFinalStatus(null);
    setShowOrderPreview(true);
  }, []);

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
  const [previewStrategy, setPreviewStrategy] = useState<'btc' | 'cc'>('btc');
  const [orderSubmissionComplete, setOrderSubmissionComplete] = useState(false);
  const [orderFinalStatus, setOrderFinalStatus] = useState<string | null>(null);
  // Track which positions were submitted in the last live run so we can remove them on modal close
  const [submittedPositionKeys, setSubmittedPositionKeys] = useState<Set<string>>(new Set());
  // Track which CC STO positions were submitted (key: `${optionSymbol}|${account}`)
  const [submittedCCKeys, setSubmittedCCKeys] = useState<Set<string>>(new Set());
  // Amber rows that remain after Tranche 1 submission (waiting for Tranche 2 rescan)
  const [tranche2Pending, setTranche2Pending] = useState<CCScanResult[]>([]);

  // Open the order preview modal for a single position (individual close)
  const handleOpenSingleOrderPreview = useCallback((result: ScanResult) => {
    // Derive call/put from OCC symbol (reliable) — type field may be BCS/BPS/IC for spread positions
    const occTypeMatch = result.optionSymbol.match(/([CP])(\d{8})$/);
    const isCall = occTypeMatch ? occTypeMatch[1] === 'C' : result.type === 'CC';
    // OCC format: ROOT YYMMDD C/P STRIKE8 — strike is the last 8 digits
    const strike = occTypeMatch ? parseInt(occTypeMatch[2], 10) / 1000 : 0;
    // Parse long leg strike from spreadLongSymbol OCC if present
    const longOccMatch = result.spreadLongSymbol?.match(/([CP])(\d{8})$/);
    const longStrike = longOccMatch ? parseInt(longOccMatch[2], 10) / 1000 : undefined;
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
      longStrike,  // Parsed from spreadLongSymbol OCC for spread detection in UnifiedOrderPreviewModal
      quantity: result.quantity,
      isEstimated: result.isEstimated,
    };
    setPreviewAccountId(result.account);
    setUnifiedOrders([order]);
    setPreviewPremiumCollected(result.premiumCollected);
    setPreviewStrategy('btc');
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
    setPreviewStrategy('btc');
    setOrderSubmissionComplete(false);
    setOrderFinalStatus(null);
    setShowOrderPreview(true);
  }, [lastRunResult, selectedPositions]);

  const submitSellCCOrders = trpc.automation.submitSellCCOrders.useMutation({
    onError: (err) => {
      toast.error(`CC order submission failed: ${err.message}`);
    },
  });

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
      const wasDryRun = lastSubmitWasDryRun.current;
      lastSubmitWasDryRun.current = false;

      if (wasDryRun) {
        // Dry run: keep the modal open, just show a toast with the result per position
        if (data.summary.failed === 0) {
          const symbols = (data.results ?? []).map((r: any) => r.symbol).join(', ');
          toast.info(
            `Dry run passed for ${data.summary.success} order${data.summary.success !== 1 ? 's' : ''}${symbols ? ` (${symbols})` : ''} — no real order was sent.`,
            { duration: 6000 }
          );
        } else {
          toast.warning(
            `Dry run: ${data.summary.success} would succeed, ${data.summary.failed} would fail.`,
            { duration: 6000 }
          );
          (data.results ?? []).filter((r: any) => !r.success).forEach((r: any) => {
            toast.error(`Dry run — ${r.symbol}: ${r.error || 'Would be rejected'}`, { duration: 8000 });
          });
        }
        lastSubmittedRollPositionIds.current = [];
        return; // Keep the modal open so the user can adjust and submit live
      }

      // Live submission: close the modal and clean up
      setShowRollReview(false);
      if (data.summary.failed === 0) {
        toast.success(`${data.summary.success} roll order${data.summary.success !== 1 ? 's' : ''} submitted successfully!`);
      } else {
        toast.warning(`${data.summary.success} submitted, ${data.summary.failed} failed. Check the toast for details.`);
      }
      // Show per-order results if available
      if (data.results && data.results.length > 0) {
        const failed = data.results.filter((r: any) => r.status === 'failed' || r.status === 'rejected');
        if (failed.length > 0) {
          failed.forEach((r: any) => {
            toast.error(`${r.symbol}: ${r.message || r.error || 'Rejected'}`, { duration: 8000 });
          });
        }
      }
      // Selectively remove only the submitted positions from selections
      // so that remaining positions retain their candidate selections for consecutive submissions
      const submittedIds = lastSubmittedRollPositionIds.current;
      if (submittedIds.length > 0) {
        setSelectedRollPositions(prev => {
          const next = new Set(prev);
          submittedIds.forEach(id => next.delete(id));
          return next;
        });
        setRollCandidateSelections(prev => {
          const next = { ...prev };
          submittedIds.forEach(id => delete next[id]);
          return next;
        });
        lastSubmittedRollPositionIds.current = [];
      } else {
        // Fallback: clear all if we somehow lost track of submitted IDs
        setSelectedRollPositions(new Set());
        setRollCandidateSelections({});
      }
      setRollReviewItems([]);
      // Refresh the rolled-today list so the Roll Dashboard immediately flags submitted positions
      refetchRolledToday();
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
    setRollCandidatesCache({});
    scanRollPositions.mutate({});
  };

  // ── Scan All Roll Candidates ─────────────────────────────────────────────
  const [isScanningAll, setIsScanningAll] = useState(false);
  const [scanAllProgress, setScanAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanSecondsLeft, setScanSecondsLeft] = useState<number>(0);
  const [scanElapsed, setScanElapsed] = useState<number>(0);

  // ── Adaptive scan timing ─────────────────────────────────────────────────
  // Stores the last 3 actual scan durations (seconds per position) in localStorage.
  // The average is used as the estimate for the next scan's progress bar.
  // Default seed: 25s/position (conservative before any real data is collected).
  const SCAN_TIMING_KEY = 'prosper_scan_secs_per_pos';
  const DEFAULT_SECS_PER_POS = 25; // ~5 min for 12 positions before optimisation
  const getSavedTimings = (): number[] => {
    try {
      const raw = localStorage.getItem(SCAN_TIMING_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };
  const saveNewTiming = (secsPerPos: number) => {
    try {
      const prev = getSavedTimings();
      const updated = [...prev, secsPerPos].slice(-3); // keep last 3
      localStorage.setItem(SCAN_TIMING_KEY, JSON.stringify(updated));
    } catch { /* ignore */ }
  };
  const getEstimatedSecsPerPos = (): number => {
    const saved = getSavedTimings();
    if (saved.length === 0) return DEFAULT_SECS_PER_POS;
    return saved.reduce((a, b) => a + b, 0) / saved.length;
  };

  // Countdown ticker — updates every 500ms while a scan is running
  useEffect(() => {
    if (!isScanningAll || !scanAllProgress || !scanStartTime) return;
    const estimatedTotal = scanAllProgress.total * getEstimatedSecsPerPos();
    const tick = () => {
      const elapsed = (Date.now() - scanStartTime) / 1000;
      const remaining = Math.max(0, estimatedTotal - elapsed);
      setScanElapsed(elapsed);
      setScanSecondsLeft(Math.ceil(remaining));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanningAll, scanAllProgress, scanStartTime]);
  // DTE range presets for Scan All (null = use server default logic)
  const DTE_PRESETS = [
    { label: '7–14d', min: 7, max: 14 },
    { label: '14–30d', min: 14, max: 30 },
    { label: '30–45d', min: 30, max: 45 },
    { label: '45–60d', min: 45, max: 60 },
  ] as const;
  const [scanDteRange, setScanDteRange] = useState<{ min: number; max: number } | null>(null);
  const scanAllRollCandidates = trpc.rolls.scanAllRollCandidates.useMutation({
    onSuccess: (data) => {
      // Record actual scan duration for adaptive timing
      if (scanStartTime && scanAllProgress && scanAllProgress.total > 0) {
        const actualSecs = (Date.now() - scanStartTime) / 1000;
        const secsPerPos = actualSecs / scanAllProgress.total;
        saveNewTiming(secsPerPos);
      }
      setIsScanningAll(false);
      setScanAllProgress(null);
      setScanStartTime(null);
      const newSelections: Record<string, RollCandidate | null> = {};
      const newCandidatesCache: Record<string, RollCandidate[]> = {};
      const newBestFitCache: Record<string, BestFitResult | null> = {};
      for (const r of data.results) {
        if (r.bestCandidate) {
          newSelections[r.positionId] = r.bestCandidate as RollCandidate;
        }
        // Cache all candidates so the ⭐ Best Fit button is available in collapsed rows
        const rAny = r as any;
        if (rAny.candidates && (rAny.candidates as RollCandidate[]).length > 0) {
          newCandidatesCache[r.positionId] = rAny.candidates as RollCandidate[];
          // Find the position to determine isPut
          const scanPos = rollScanResults?.all.find(p => p.positionId === r.positionId);
          if (scanPos) {
            const isPut = scanPos.strategy === 'CSP' || scanPos.strategy === 'BPS';
            const ranked = rankBestFit(rAny.candidates as RollCandidate[], scanPos.metrics.currentPrice ?? 0, isPut, {
              currentItmDepthPct: scanPos.metrics.itmDepth > 0 ? scanPos.metrics.itmDepth : 0,
              currentStrike: scanPos.metrics.strikePrice,
            });
            newBestFitCache[r.positionId] = ranked[0] ?? null;
          }
        }
      }
      // Load candidates but do NOT auto-select — user picks which ones to submit
      setRollCandidateSelections(newSelections);
      setRollCandidatesCache(prev => ({ ...prev, ...newCandidatesCache }));
      setBestFitCache(prev => ({ ...prev, ...newBestFitCache } as Record<string, BestFitResult | null>));
      setSelectedRollPositions(new Set()); // always start with empty queue
      const { creditRolls, closeOnly, errors } = data.summary;
      if (errors > 0) {
        toast.warning(`Scan All: ${creditRolls} credit roll${creditRolls !== 1 ? 's' : ''}, ${closeOnly} close-only, ${errors} errors — check boxes to queue`);
      } else {
        toast.success(`Scan All complete: ${creditRolls} credit roll${creditRolls !== 1 ? 's' : ''} + ${closeOnly} close-only — check boxes to queue`);
      }
    },
    onError: (err) => {
      setIsScanningAll(false);
      setScanAllProgress(null);
      setScanStartTime(null);
       toast.error(`Scan All failed: ${err.message}`);
    },
  });

  const handleScanAll = (strategyFilter?: string) => {
    if (!rollScanResults) { toast.warning('Run a Roll Scan first to load positions'); return; }
    const positions = rollScanResults.all
      .filter(p => !strategyFilter || p.strategy === strategyFilter)
      .map(p => ({
        positionId: p.positionId,
        symbol: p.symbol,
        strategy: p.strategy.toLowerCase() as 'csp' | 'cc' | 'bps' | 'bcs' | 'ic',
        strikePrice: p.metrics.strikePrice,
        expirationDate: p.metrics.expiration,
        currentValue: p.metrics.currentValue,
        openPremium: p.metrics.openPremium,
        quantity: p.quantity,
        spreadWidth: p.spreadDetails?.spreadWidth,
      }));
    if (positions.length === 0) { toast.info('No positions match that filter'); return; }
    // Clear stale selections AND candidate cache so the queue doesn't accumulate across scan sessions
    setSelectedRollPositions(new Set());
    setRollCandidateSelections({});
    setRollCandidatesCache({});
    setIsScanningAll(true);
    setScanAllProgress({ done: 0, total: positions.length });
    setScanStartTime(Date.now());
    setScanSecondsLeft(Math.ceil(positions.length * 2.2));
    setScanElapsed(0);
    scanAllRollCandidates.mutate({ positions, ...(scanDteRange ? { dteRange: scanDteRange } : {}) });
  };

  // Build RollOrderItem[] from the current selection for the review modal
  const buildRollReviewItems = (): RollOrderItem[] => {
    if (!rollScanResults) return [];
    const allPositions = rollScanResults.all;
    const items: RollOrderItem[] = [];
    for (const key of Array.from(selectedRollPositions)) {
      const pos = allPositions.find(p => p.positionId === key);
      if (!pos) continue;
      const candidate = rollCandidateSelections[key] as RollCandidate | null | undefined;
      if (!candidate) continue;
      const allCandidates = (rollCandidatesCache[key] as RollCandidate[] | undefined) || [candidate];
      const isSpread = ['BPS', 'BCS', 'IC'].includes(pos.strategy);
      // Compute Best Fit inline so the review modal always has it
      const isPut = pos.strategy === 'CSP' || pos.strategy === 'BPS';
      const currentPrice = pos.metrics.currentPrice ?? 0;
      const ranked = rankBestFit(allCandidates, currentPrice, isPut, {
        currentItmDepthPct: pos.metrics.itmDepth > 0 ? pos.metrics.itmDepth : 0,
        currentStrike: pos.metrics.strikePrice,
      });
      const bfWinner = ranked[0] ?? null;
      items.push({
        positionId: pos.positionId,
        symbol: pos.symbol,
        strategy: pos.strategy as 'CC' | 'CSP' | 'BPS' | 'BCS' | 'IC',
        accountNumber: pos.accountNumber || pos.accountId || '',
        currentStrike: pos.metrics.strikePrice,
        currentExpiration: pos.metrics.expiration,
        currentDte: pos.metrics.dte,
        currentValue: pos.metrics.currentValue,
        openPremium: pos.metrics.openPremium,
        quantity: pos.quantity || 1,
        optionSymbol: pos.optionSymbol,
        candidate: {
          action: candidate.action,
          strike: candidate.strike,
          expiration: candidate.expiration,
          dte: candidate.dte,
          netCredit: candidate.netCredit,
          netBid: (candidate as any).netBid,
          netAsk: (candidate as any).netAsk,
          stoBid: (candidate as any).stoBid,
          stoAsk: (candidate as any).stoAsk,
          btcBid: (candidate as any).btcBid,
          btcAsk: (candidate as any).btcAsk,
          closeCost: candidate.closeCost,
          netPnl: candidate.netPnl,
          openPremium: candidate.openPremium,
          newPremium: candidate.newPremium,
          annualizedReturn: candidate.annualizedReturn,
          delta: candidate.delta,
          score: candidate.score,
          description: candidate.description,
        },
        allCandidates: allCandidates.map(c => ({
          action: c.action,
          strike: c.strike,
          expiration: c.expiration,
          dte: c.dte,
          netCredit: c.netCredit,
          netBid: (c as any).netBid,
          netAsk: (c as any).netAsk,
          stoBid: (c as any).stoBid,
          stoAsk: (c as any).stoAsk,
          btcBid: (c as any).btcBid,
          btcAsk: (c as any).btcAsk,
          closeCost: c.closeCost,
          netPnl: c.netPnl,
          openPremium: c.openPremium,
          newPremium: c.newPremium,
          annualizedReturn: c.annualizedReturn,
          delta: c.delta,
          score: c.score,
          description: c.description,
        })),
        bestFitCandidate: bfWinner ? {
          action: bfWinner.candidate.action,
          strike: bfWinner.candidate.strike,
          expiration: bfWinner.candidate.expiration,
          dte: bfWinner.candidate.dte,
          netCredit: bfWinner.candidate.netCredit,
          netBid: (bfWinner.candidate as any).netBid,
          netAsk: (bfWinner.candidate as any).netAsk,
          stoBid: (bfWinner.candidate as any).stoBid,
          stoAsk: (bfWinner.candidate as any).stoAsk,
          btcBid: (bfWinner.candidate as any).btcBid,
          btcAsk: (bfWinner.candidate as any).btcAsk,
          closeCost: bfWinner.candidate.closeCost,
          netPnl: bfWinner.candidate.netPnl,
          openPremium: bfWinner.candidate.openPremium,
          newPremium: bfWinner.candidate.newPremium,
          annualizedReturn: bfWinner.candidate.annualizedReturn,
          delta: bfWinner.candidate.delta,
          score: bfWinner.candidate.score,
          description: bfWinner.candidate.description,
        } : null,
        bestFitScores: bfWinner ? {
          premiumScore: Math.round(bfWinner.premiumScore),
          strikeScore: Math.round(bfWinner.strikeScore),
          dteScore: Math.round(bfWinner.dteScore),
          bestFitScore: Math.round(bfWinner.bestFitScore),
        } : undefined,
        isSpread,
        spreadDetails: isSpread && pos.spreadDetails ? {
          legs: pos.spreadDetails.legs.map(l => ({
            symbol: l.symbol || pos.optionSymbol,
            action: l.role === 'short' ? 'BTC' : 'STC',
            quantity: l.quantity,
          })),
          spreadWidth: pos.spreadDetails.spreadWidth || 0,
        } : undefined,
      });
    }
    return items;
  };

  const handleOpenRollReview = () => {
    const items = buildRollReviewItems();
    if (items.length === 0) {
      toast.warning('No positions selected with a roll candidate chosen.');
      return;
    }
    setRollReviewItems(items);
    setShowRollReview(true);
  };

  const handleRollReviewSubmit = async (reviewedItems: RollOrderItem[], isDryRun: boolean) => {
    if (!rollScanResults) return;
    const allPositions = rollScanResults.all;
    const orders: any[] = [];
    for (const item of reviewedItems) {
      const pos = allPositions.find(p => p.positionId === item.positionId);
      if (!pos) continue;
      const candidate = item.candidate;
      const isSpread = ['BPS', 'BCS', 'IC'].includes(item.strategy);
      const accountNumber = item.accountNumber;
      if (isSpread && pos.spreadDetails) {
        orders.push({
          accountNumber,
          symbol: item.symbol,
          strategyType: item.strategy as 'BPS' | 'BCS' | 'IC',
          action: candidate.action,
          spreadLegs: pos.spreadDetails.legs,
          spreadWidth: pos.spreadDetails.spreadWidth,
          newExpiration: candidate.action === 'roll' ? candidate.expiration : undefined,
          newShortStrike: candidate.action === 'roll' ? candidate.strike : undefined,
          netCredit: candidate.action === 'roll' ? candidate.netCredit : undefined,
          limitPrice: candidate.limitPrice,
          positionId: item.positionId,
        });
      } else {
        orders.push({
          accountNumber,
          symbol: item.symbol,
          strategyType: item.strategy as 'CSP' | 'CC',
          currentOptionSymbol: item.optionSymbol,
          currentQuantity: item.quantity,
          currentValue: item.currentValue,
          newStrike: candidate.action === 'roll' ? candidate.strike : undefined,
          newExpiration: candidate.action === 'roll' ? candidate.expiration : undefined,
          newPremium: candidate.action === 'roll' ? candidate.newPremium : undefined,
          netCredit: candidate.action === 'roll' ? candidate.netCredit : undefined,
          action: candidate.action,
          limitPrice: candidate.limitPrice,
          positionId: item.positionId,
        });
      }
    }
    if (orders.length === 0) {
      toast.warning('No valid orders to submit.');
      return;
    }
    // Track which positionIds are being submitted so onSuccess can selectively clear them
    lastSubmittedRollPositionIds.current = reviewedItems.map(item => item.positionId);
    setIsSubmittingRolls(true);
    lastSubmitWasDryRun.current = isDryRun;
    submitRollOrders.mutate({ orders, dryRun: isDryRun });
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
          positionId: key,
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
          positionId: key,
        });
      }
    }
    if (orders.length === 0) {
      toast.warning('No positions selected with a roll candidate chosen.');
      return;
    }
    // Track which positionIds are being submitted so onSuccess can selectively clear them
    lastSubmittedRollPositionIds.current = Array.from(selectedRollPositions).filter(k => !!rollCandidateSelections[k]);
    setIsSubmittingRolls(true);
    lastSubmitWasDryRun.current = dryRun;
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
    console.log('[handleUnifiedSubmit] strategy:', previewStrategy, 'isDryRun:', isDryRun, 'orders:', orders.length);

    try {
      // ── CC STO path ── must be checked FIRST before the optionSymbol guard below,
      // because CC STO orders are new orders (no optionSymbol yet — they haven't been placed).
      if (previewStrategy === 'cc') {
        const ccOrders = orders
          .filter(o => o.accountNumber)
          .map(o => ({
            accountNumber: o.accountNumber!,
            symbol: o.symbol,
            strike: o.strike,
            expiration: o.expiration,
            quantity: quantities.get(`${o.symbol}-${o.strike}-${o.expiration}`) ?? o.quantity ?? 1,
            price: o.premium ?? 0,
          }));
        if (ccOrders.length === 0) {
          console.warn('[handleUnifiedSubmit] CC path: no orders with accountNumber — cannot submit');
          return { results: [] };
        }
        console.log('[handleUnifiedSubmit] CC STO submitting', ccOrders.length, 'orders, dryRun:', isDryRun);
        const response = await submitSellCCOrders.mutateAsync({ orders: ccOrders, dryRun: isDryRun });
        if (!isDryRun) {
          const ccKeys = new Set(ccOrders.map(s => `${s.symbol}-${s.strike}-${s.expiration}|${s.accountNumber}`));
          setSubmittedCCKeys(ccKeys);
        }
        return { results: response.results ?? [] };
      }

      // ── BTC / close path ── requires optionSymbol (existing position identity)
      // Use the orders array directly — it carries optionSymbol, accountNumber, spreadLongSymbol
      // from the scan result (embedded in handleOpenOrderPreview).
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
            // Pass the user-adjusted slider price so the server honours it instead of recalculating
            userLimitPrice: o.premium !== undefined && o.premium > 0 ? o.premium : undefined,
          };
        });

      if (selected.length === 0) {
        console.warn('[handleUnifiedSubmit] BTC path: no orders with optionSymbol/accountNumber — cannot submit');
        return { results: [] };
      }

      // BTC close orders
      const response = await submitCloseOrders.mutateAsync({ orders: selected, dryRun: isDryRun });
      if (!isDryRun) {
        const scanMap = new Map((lastRunResult?.scanResults ?? []).map(r => [`${r.optionSymbol}|${r.account}`, r]));
        const keys = new Set(selected.map(s => {
          const r = scanMap.get(`${s.optionSymbol}|${s.accountNumber}`);
          return r ? posKey(r) : `${s.optionSymbol}|${s.accountNumber}|unknown`;
        }));
        setSubmittedPositionKeys(keys);
      }
      return { results: response.results ?? [] };
    } catch (err: any) {
      console.error('[handleUnifiedSubmit] error:', err);
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
        // 'Unknown' means API couldn't confirm yet — keep as Working so client keeps polling
        const rawStatus = s?.status;
        const mappedStatus =
          rawStatus === 'Filled' ? 'Filled' as const
          : rawStatus === 'Rejected' ? 'Rejected' as const
          : rawStatus === 'Cancelled' ? 'Cancelled' as const
          : rawStatus === 'MarketClosed' ? 'MarketClosed' as const
          : 'Working' as const;
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
            : 'Checking order status...',
        };
      });
    } catch (error: any) {
      return orderIds.map((orderId, idx) => ({
        orderId,
        symbol: unifiedOrders[idx]?.symbol ?? 'Unknown',
        status: 'Working' as const,
        message: 'Retrying status check...',
      }));
    }
  };

  // Apply hide-expiring-today + type filter, then sort
  // Index symbols: European-style, cash-settled, no early assignment risk
  const CASH_SETTLED_INDEXES_FE = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'MRUT', 'VIX', 'DJX', 'XSP', 'XND']);
  const isIndexSymbol = (sym: string) => CASH_SETTLED_INDEXES_FE.has(sym.toUpperCase());
  const visibleScanResults = useMemo(() => {
    let rows = (lastRunResult?.scanResults ?? []).filter(
      r => !(hideExpiringToday && r.dte === 0)
    );
    if (scanTypeFilter !== 'all') {
      rows = rows.filter(r => r.type === scanTypeFilter);
    }
    // Settlement-type filter: index (European/cash-settled) vs equity (American/assignable)
    if (scanSettleFilter === 'index') {
      rows = rows.filter(r => CASH_SETTLED_INDEXES_FE.has(r.symbol.toUpperCase()));
    } else if (scanSettleFilter === 'equity') {
      rows = rows.filter(r => !CASH_SETTLED_INDEXES_FE.has(r.symbol.toUpperCase()));
    }
    // ABSOLUTE SAFETY: When CC filter is active, never show BCS/BPS/IC spread legs.
    // Spread legs require a 4-leg combo order and must NEVER appear in the CC BTC sweep.
    // ALSO: Cash-settled European-style indexes (SPX/SPXW/NDX/NDXP/RUT/RUTW etc.) can NEVER
    // be covered calls — there are no underlying shares to cover them. Hard-block them from
    // the CC view regardless of what the server classified them as (guards against Tastytrade
    // API instrument-type misreporting and heuristic edge-cases).
    if (scanTypeFilter === 'CC') {
      rows = rows.filter(r =>
        r.type !== 'BCS' && r.type !== 'BPS' && r.type !== 'IC' &&
        !CASH_SETTLED_INDEXES_FE.has(r.symbol.toUpperCase())
      );
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
  }, [lastRunResult?.scanResults, hideExpiringToday, scanTypeFilter, scanSettleFilter, scanSortCol, scanSortDir]);
  // Keep ref in sync so handleOpenOrderPreview (declared before this useMemo) can access current value
  visibleScanResultsRef.current = visibleScanResults;
  // Include ALL WOULD_CLOSE results — BCS/BPS/IC spreads now produce proper 2-leg combo close orders
  // and are safe to select and submit via the Review & Submit basket.
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
  // retry:false prevents error banner when the log was deleted/cleared and the cached runId is stale
  const { data: latestLog } = trpc.automation.getLog.useQuery(
    { runId: lastRunId! },
    {
      enabled: !!lastRunId,
      refetchInterval: false,
      retry: false,
    }
  );

  // Fetch automation settings
  const { data: settings, isLoading: settingsLoading } = trpc.automation.getSettings.useQuery();
  
  // Fetch automation logs
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = trpc.automation.getLogs.useQuery({ limit: 20 });

  // Delete a single log
  const deleteLog = trpc.automation.deleteLog.useMutation({
    onSuccess: (_data, variables) => {
      refetchLogs();
      // If the deleted log was the currently displayed run, clear the cached runId
      if (variables.runId === lastRunId) {
        setLastRunId(null);
      }
      toast.success('Run deleted');
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  });

  // Clear all logs
  const clearAllLogs = trpc.automation.clearAllLogs.useMutation({
    onSuccess: () => {
      refetchLogs();
      // Clear the cached runId so getLog doesn’t fire a stale 404 query
      setLastRunId(null);
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

  // Excluded CC scan mutation
  const scanExcludedCCMutation = trpc.automation.scanExcludedCC.useMutation({
    onError: (err) => {
      setIsExcludedScanning(false);
      toast.error(`Excluded scan failed: ${err.message}`);
    },
  });
  const runExcludedScan = useCallback(async (excludedStocks: CCExcludedStock[]) => {
    const scannable = excludedStocks.filter(s =>
      s.currentPrice && s.currentPrice > 0 &&
      s.maxContracts !== undefined &&
      !s.reason.includes('No price data') &&
      !s.reason.includes('Flagged for exit')
    );
    if (scannable.length === 0) {
      toast.info('No scannable excluded stocks (hard exclusions only)');
      return;
    }
    setIsExcludedScanning(true);
    try {
      const result = await scanExcludedCCMutation.mutateAsync({
        stocks: scannable.map(s => ({
          symbol: s.symbol,
          currentPrice: s.currentPrice!,
          maxContracts: s.maxContracts ?? 1,
          account: s.account,
        })),
      });
      setExcludedScanResults(result.results as ExcludedScanResult[]);
      toast.success(`Found best contracts for ${result.results.length} of ${scannable.length} excluded stocks`);
    } finally {
      setIsExcludedScanning(false);
    }
  }, [scanExcludedCCMutation]);
  // AI scoring mutation
  const scoreCCOpportunities = trpc.automation.scoreCCOpportunities.useMutation({
    onError: (err) => {
      setIsAiScoring(false);
      toast.error(`AI scoring failed: ${err.message}`);
    },
  });

  // Helper: run AI scoring on a list of CC results and merge scores back
  const runAiScoring = useCallback(async (ccResults: CCScanResult[]) => {
    if (!settings?.aiScoringEnabled || ccResults.length === 0) return;
    setIsAiScoring(true);
    try {
      const opportunities = ccResults.map(r => ({
        symbol: r.symbol,
        currentPrice: r.currentPrice,
        strike: r.strike,
        dte: r.dte,
        delta: r.delta,
        mid: r.mid,
        bid: r.bid,
        ask: r.ask,
        weeklyReturn: r.weeklyReturn,
        quantity: r.quantity,
        account: r.account,
        optionSymbol: r.optionSymbol,
        // Pass pre-computed D1-D6 score so the LLM explains it rather than recomputing
        ...(r.aiScore !== undefined ? { aiScore: r.aiScore } : {}),
        ...(r.scoreBreakdown ? { scoreBreakdown: r.scoreBreakdown } : {}),
        ...(r.rsi != null ? { rsi: r.rsi } : {}),
        ...(r.bbPctB != null ? { bbPctB: r.bbPctB } : {}),
        ...(r.ivRank != null ? { ivRank: r.ivRank } : {}),
        ...(r.distanceOtm != null ? { distanceOtm: r.distanceOtm } : {}),
      }));
      const result = await scoreCCOpportunities.mutateAsync({ opportunities });
      // Merge scores back by index
      setLastRunResult(prev => {
        if (!prev) return prev;
        const scored = prev.ccScanResults.map((r, i) => {
          const s = result.scores.find(x => x.id === i);
          if (!s) return r;
          return { ...r, aiScore: s.score, aiRationale: s.rationale, aiRecommendedDte: s.recommendedDte };
        });
        // Auto-select clean rows (no DTE recommendation) and deselect amber rows
        const cleanKeys = new Set(scored.filter(r => !r.aiRecommendedDte).map(r => `${r.optionSymbol}|${r.account}`));
        setSelectedCCPositions(cleanKeys);
        return { ...prev, ccScanResults: scored };
      });
    } finally {
      setIsAiScoring(false);
    }
  }, [settings?.aiScoringEnabled, scoreCCOpportunities]);

  // When the log is fetched after a run, populate scanResults from scanResultsJson
  useEffect(() => {
    if (!latestLog || !lastRunResult) return;
    const parsed: ScanResult[] = latestLog.scanResultsJson ? JSON.parse(latestLog.scanResultsJson as string) : [];
    const ccParsed: CCScanResult[] = (latestLog as any).ccScanResultsJson ? JSON.parse((latestLog as any).ccScanResultsJson as string) : [];
    const ccExcludedParsed: CCExcludedStock[] = (latestLog as any).ccExcludedStocksJson ? JSON.parse((latestLog as any).ccExcludedStocksJson as string) : [];
    if (parsed.length === 0 && ccParsed.length === 0 && ccExcludedParsed.length === 0) return;

    setLastRunResult(prev => {
      if (!prev) return prev;
      // Only update the arrays that are still empty (avoid overwriting already-populated results)
      return {
        ...prev,
        scanResults: prev.scanResults.length === 0 ? parsed : prev.scanResults,
        ccScanResults: prev.ccScanResults.length === 0 ? ccParsed : prev.ccScanResults,
        ccExcludedStocks: prev.ccExcludedStocks.length === 0 ? ccExcludedParsed : prev.ccExcludedStocks,
      };
    });

    // After CC results are populated: if AI scoring is enabled, score them;
    // otherwise fall back to selecting all rows.
    if (lastRunResult.ccScanResults.length === 0 && ccParsed.length > 0) {
      if (settings?.aiScoringEnabled) {
        // runAiScoring will set selectedCCPositions after scoring
        runAiScoring(ccParsed);
      } else {
        // No AI: select all rows by default
        const ccKeys = new Set(ccParsed.map(r => `${r.optionSymbol}|${r.account}`));
        setSelectedCCPositions(ccKeys);
      }
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
          ccExcludedStocks: [],
        }));
      } else {
        // Full scan or BTC-only: reset everything
        setLastRunResult({
          success: true,
          runId: data.runId,
          summary: data.summary as RunSummary,
          scanResults: [],
          ccScanResults: [],
          ccExcludedStocks: [],
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
    setLastRunResult(prev => prev ? { ...prev, ccScanResults: [], ccExcludedStocks: [] } : null);
    runAutomation.mutate({ triggerType: 'manual', scanSteps: ['cc'] });
  };

  const handleRescanTranche2 = () => {
    if (tranche2Pending.length === 0) return;
    // Collect unique symbols from amber rows
    const symbols = Array.from(new Set(tranche2Pending.map(r => r.symbol)));
    // Derive DTE override: use the most common recommendedDte (or 14 as fallback)
    const dteCounts = tranche2Pending.reduce<Record<number, number>>((acc, r) => {
      const d = r.aiRecommendedDte ?? 14;
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {});
    const targetDte = parseInt(Object.entries(dteCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '14', 10);
    const dteMin = Math.max(targetDte - 3, 1);
    const dteMax = targetDte + 7;
    setIsRunning(true);
    setActiveScanStep('cc');
    // Preserve existing BTC scan results, only clear CC results
    setLastRunResult(prev => prev ? { ...prev, ccScanResults: [], ccExcludedStocks: [] } : null);
    setTranche2Pending([]); // Clear pending state — new results will replace
    toast.info(`Rescanning ${symbols.length} Tranche 2 symbol${symbols.length !== 1 ? 's' : ''} with DTE ${dteMin}–${dteMax}…`);
    runAutomation.mutate({
      triggerType: 'manual',
      scanSteps: ['cc'],
      ccSymbolFilter: symbols,
      ccDteOverride: { min: dteMin, max: dteMax },
    });
  };

  const handleRescanBTC = () => {
    setIsRunning(true);
    setActiveScanStep('all');
    setLastRunResult(null);
    toast.info('Re-scanning all positions for close-for-profit opportunities…');
    runAutomation.mutate({ triggerType: 'manual', scanSteps: ['btc'] });
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
    <div className="container py-4 sm:py-8 space-y-4 sm:space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">Daily Actions</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            One place to automate and evaluate your daily trading activity
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1 shrink-0">
          <ConnectionStatusIndicator />
          {/* Kill Switch — always visible as a prominent pill */}
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
          {/* Automation Controls dropdown — sweep/scan toggles + support */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Settings2 className="h-3.5 w-3.5" />
                Controls
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Friday Sweep</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => { setIsSweeping(true); triggerFridaySweepMutation.mutate(); }}
                  disabled={isSweeping}
                  className="gap-2 text-blue-400 focus:text-blue-300"
                >
                  {isSweeping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {isSweeping ? 'Sweeping…' : 'Test Friday Sweep'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSweepEnabledMutation.mutate({ enabled: !fridaySweepEnabled })}
                  className="gap-2"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${fridaySweepEnabled ? 'bg-blue-400 animate-pulse' : 'bg-muted-foreground'}`} />
                  {fridaySweepEnabled ? 'Auto-Sweep: ON — click to disable' : 'Auto-Sweep: OFF — click to enable'}
                </DropdownMenuItem>
                {lastSweepInfo?.lastSweepAt && (
                  <DropdownMenuItem disabled className="gap-2 text-xs opacity-60 cursor-default">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    Last swept {new Date(lastSweepInfo.lastSweepAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {lastSweepInfo.lastSweepAlertCount > 0 && ` — ${lastSweepInfo.lastSweepAlertCount} alert${lastSweepInfo.lastSweepAlertCount !== 1 ? 's' : ''}`}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Daily Scan</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => { setIsDailyScanning(true); triggerDailyScanMutation.mutate(); }}
                  disabled={isDailyScanning}
                  className="gap-2 text-violet-400 focus:text-violet-300"
                >
                  {isDailyScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                  {isDailyScanning ? 'Scanning…' : 'Test Daily Scan'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDailyScanEnabledMutation.mutate({ enabled: !dailyScanEnabled })}
                  className="gap-2"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${dailyScanEnabled ? 'bg-violet-400 animate-pulse' : 'bg-muted-foreground'}`} />
                  {dailyScanEnabled ? 'Daily Scan: ON — click to disable' : 'Daily Scan: OFF — click to enable'}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openSupport} className="gap-2">
                <MessageCircle className="h-3.5 w-3.5" />
                Support
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      {/* Top-level section switcher: Automation | Working Orders | Open Positions | Evaluation | Inbox */}
      <div className="flex gap-2 border-b border-border/50 pb-0">
        <button
          onClick={() => setActiveTopTab('automation')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTopTab === 'automation'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />Automation</span>
        </button>
        <button
          onClick={() => setActiveTopTab('working-orders')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTopTab === 'working-orders'
              ? 'border-blue-400 text-blue-300'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />Working Orders</span>
        </button>
        <button
          onClick={() => setActiveTopTab('open-positions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTopTab === 'open-positions'
              ? 'border-green-400 text-green-300'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-1.5"><ListOrdered className="w-3.5 h-3.5" />Open Positions</span>
        </button>
        <button
          onClick={() => setActiveTopTab('inbox')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTopTab === 'inbox'
              ? 'border-orange-400 text-orange-300'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />Inbox</span>
        </button>
      </div>

      {/* Working Orders Section */}
      {activeTopTab === 'working-orders' && (
        <div className="mt-2">
          <WorkingOrdersTab />
        </div>
      )}

      {/* Open Positions Section */}
      {activeTopTab === 'open-positions' && (
        <div className="mt-2">
          <ActivePositionsTab />
        </div>
      )}

      {/* Inbox Section */}
      {activeTopTab === 'inbox' && (
        <div className="mt-4">
          <InboxPage />
        </div>
      )}

      {/* Five-Step Automation Tabs */}
      {activeTopTab === 'automation' && <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 h-auto">
          <TabsTrigger value="step5-gtc" className="relative flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">1</span>
            <span className="flex items-center gap-1">
              Auto-Close / Roll
              {(() => {
                // Show count of positions at or above profit target
                const liveCount = lastRunResult?.scanResults?.filter(r => r.action === 'WOULD_CLOSE').length ?? null;
                const displayCount = liveCount !== null ? liveCount : cachedCloseProfitCount;
                return displayCount !== null && displayCount > 0 ? (
                  <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold leading-none" title={liveCount !== null ? 'Live scan count' : 'Cached from last daily scan'}>
                    {displayCount}
                  </span>
                ) : null;
              })()}
            </span>
          </TabsTrigger>
          <TabsTrigger value="step3-cc" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">2</span>
            <span className="flex items-center gap-1">
              Sell Calls
              {cachedSellCallsCount !== null && cachedSellCallsCount > 0 ? (
                <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-none" title="Cached from last daily scan">
                  {cachedSellCallsCount}
                </span>
              ) : null}
            </span>
          </TabsTrigger>
          <TabsTrigger value="step4-pmcc" className="flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">3</span>
            <span>PMCC Mgmt</span>
          </TabsTrigger>
          <TabsTrigger value="step6-bcs" className="relative flex flex-col gap-0.5 py-2 text-xs">
            <span className="font-bold text-sm">4</span>
            <span>SPX Spreads</span>
          </TabsTrigger>
        </TabsList>


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
                  <Input id="delta-min-tab" type="text" placeholder="e.g. 0.20" value={settings?.ccDeltaMin}
                    onBlur={(e) => { const raw = parseFloat(e.target.value); if (!isNaN(raw) && raw > 1) updateSettings.mutate({ ccDeltaMin: (raw / 100).toFixed(2) }); }}
                    onChange={(e) => updateSettings.mutate({ ccDeltaMin: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delta-max-tab">Max Delta</Label>
                  <Input id="delta-max-tab" type="text" placeholder="e.g. 0.30" value={settings?.ccDeltaMax}
                    onBlur={(e) => { const raw = parseFloat(e.target.value); if (!isNaN(raw) && raw > 1) updateSettings.mutate({ ccDeltaMax: (raw / 100).toFixed(2) }); }}
                    onChange={(e) => updateSettings.mutate({ ccDeltaMax: e.target.value })} />
                </div>
              </div>
              {/* AI Scoring toggle */}
              <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">AI Confidence Scoring</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    After each scan, scores each opportunity 0-100 on premium quality, strike placement, liquidity, and DTE fit.
                    Rows with a better DTE recommendation are flagged amber and deselected for Tranche 2.
                    {!settings?.aiScoringEnabled && <span className="text-green-500 ml-1">Zero cost when off.</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <Label htmlFor="ai-scoring-tab" className="text-sm">
                    {settings?.aiScoringEnabled ? 'On' : 'Off'}
                  </Label>
                  <Switch
                    id="ai-scoring-tab"
                    checked={settings?.aiScoringEnabled ?? false}
                    onCheckedChange={(checked) => handleToggle('aiScoringEnabled', checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          {/* CC Scan Results */}
          {lastRunResult && lastRunResult.ccScanResults && lastRunResult.ccScanResults.length > 0 && (() => {
            const hasAiScores = lastRunResult.ccScanResults.some(r => r.aiScore !== undefined);
            const amberCount = lastRunResult.ccScanResults.filter(r => r.aiRecommendedDte).length;
            const cleanCount = lastRunResult.ccScanResults.filter(r => !r.aiRecommendedDte).length;
            const handleSelectAllClean = () => {
              const cleanKeys = new Set(lastRunResult.ccScanResults.filter(r => !r.aiRecommendedDte).map(r => `${r.optionSymbol}|${r.account}`));
              setSelectedCCPositions(cleanKeys);
            };
            const handleOpenCCPreview = () => {
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
              setPreviewStrategy('cc');
              setOrderSubmissionComplete(false);
              setOrderFinalStatus(null);
              setShowOrderPreview(true);
            };
            return (
              <Card className="border-blue-500/30 bg-blue-500/5">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="h-5 w-5 text-blue-400" />
                      <div>
                        <CardTitle className="text-lg">Covered Calls to Open</CardTitle>
                        <CardDescription>
                          {lastRunResult.ccScanResults.length} opportunit{lastRunResult.ccScanResults.length !== 1 ? 'ies' : 'y'} found across your equity holdings
                          {hasAiScores && amberCount > 0 && (
                            <span className="ml-2 text-amber-400">· {amberCount} flagged for Tranche 2</span>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* AI scoring spinner */}
                      {isAiScoring && (
                        <span className="flex items-center gap-1.5 text-xs text-blue-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          AI scoring…
                        </span>
                      )}
                      {/* Tranche 2 rescan button — shown when amber rows are pending after Tranche 1 submission */}
                      {tranche2Pending.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs border-amber-500/60 text-amber-400 hover:bg-amber-500/10 font-medium"
                          onClick={handleRescanTranche2}
                          disabled={isRunning}
                          title={`Rescan ${Array.from(new Set(tranche2Pending.map(r => r.symbol))).join(', ')} with AI-recommended DTE`}
                        >
                          {isRunning && activeScanStep === 'cc' ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Rescanning…</>
                          ) : (
                            <><RefreshCw className="h-3.5 w-3.5 mr-1" />Rescan Tranche 2 ({tranche2Pending.length})</>
                          )}
                        </Button>
                      )}
                      {/* Select All Clean button — only shown when AI scores exist and there are amber rows */}
                      {hasAiScores && amberCount > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                          onClick={handleSelectAllClean}
                          title={`Select only the ${cleanCount} clean row${cleanCount !== 1 ? 's' : ''} (no DTE recommendation)`}
                        >
                          ✓ Select Clean ({cleanCount})
                        </Button>
                      )}
                      {selectedCCPositions.size > 0 && (
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={handleOpenCCPreview}
                        >
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          Review &amp; Submit {selectedCCPositions.size} CC Order{selectedCCPositions.size !== 1 ? 's' : ''}
                        </Button>
                      )}
                      <ColumnVisibilityToggle
                        columns={AUTO_CC_COLUMNS}
                        visibleColumns={autoCcVisibleCols}
                        onVisibilityChange={setAutoCcColVisible}
                        onReset={resetAutoCcCols}
                      />
                    </div>
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
                          {autoCcVisibleCols.has('select') && <th className="py-2 pr-2 w-8"><Checkbox checked={selectedCCPositions.size === lastRunResult.ccScanResults.length} onCheckedChange={(checked) => { if (checked) setSelectedCCPositions(new Set(lastRunResult.ccScanResults.map(r => `${r.optionSymbol}|${r.account}`))); else setSelectedCCPositions(new Set()); }} aria-label="Select all CC opportunities" /></th>}
                          {autoCcVisibleCols.has('symbol') && <th className="text-left py-2 pr-2">Symbol</th>}
                          {autoCcVisibleCols.has('account') && <th className="text-left py-2 pr-2">Account</th>}
                          {autoCcVisibleCols.has('qty') && <th className="text-right py-2 pr-2">Qty</th>}
                          {autoCcVisibleCols.has('strike') && <th className="text-left py-2 pr-2">Strike</th>}
                          {autoCcVisibleCols.has('expiration') && <th className="text-left py-2 pr-2">Expiration</th>}
                          {autoCcVisibleCols.has('dte') && <th className="text-right py-2 pr-2">DTE</th>}
                          {autoCcVisibleCols.has('delta') && <th className="text-right py-2 pr-2">Delta</th>}
                          {autoCcVisibleCols.has('mid') && <th className="text-right py-2 pr-2">Mid</th>}
                          {autoCcVisibleCols.has('total') && <th className="text-right py-2 pr-2">Total</th>}
                          {autoCcVisibleCols.has('wklyPct') && <th className="text-right py-2 pr-2">Wkly%</th>}
                          {autoCcVisibleCols.has('aiScore') && hasAiScores && <th className="text-left py-2 pl-3" style={{minWidth:'220px'}}>AI Score &amp; Rationale</th>}
                          {autoCcVisibleCols.has('ai') && <th className="text-center py-2 pl-2 w-8">AI</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {[...lastRunResult.ccScanResults].sort((a, b) => {
                          // Default sort: AI Score descending (scored rows first, then unscored)
                          const sa = a.aiScore ?? -1;
                          const sb = b.aiScore ?? -1;
                          return sb - sa;
                        }).map((r, idx) => {
                          const key = `${r.optionSymbol}|${r.account}`;
                          const isSelected = selectedCCPositions.has(key);
                          const isAmber = !!r.aiRecommendedDte;
                          const scoreColor = r.aiScore !== undefined
                            ? r.aiScore >= 85 ? 'text-green-400'
                            : r.aiScore >= 65 ? 'text-blue-400'
                            : r.aiScore >= 45 ? 'text-amber-400'
                            : 'text-red-400'
                            : '';
                          return (
                            <tr
                              key={idx}
                              className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                                isAmber ? 'bg-amber-500/5 border-amber-500/20' : isSelected ? 'bg-blue-500/5' : ''
                              }`}
                            >
                              {autoCcVisibleCols.has('select') && <td className="py-2 pr-2"><Checkbox checked={isSelected} onCheckedChange={() => setSelectedCCPositions(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })} /></td>}
                              {autoCcVisibleCols.has('symbol') && <td className="py-2 pr-2 font-semibold">{r.symbol}{isAmber && !isSelected && <div className="text-[9px] font-medium text-amber-400 mt-0.5">Pending Rescan</div>}</td>}
                              {autoCcVisibleCols.has('account') && <td className="py-2 pr-2 text-xs text-muted-foreground">{r.account}</td>}
                              {autoCcVisibleCols.has('qty') && <td className="py-2 pr-2 text-right">{r.quantity}</td>}
                              {autoCcVisibleCols.has('strike') && <td className="py-2 pr-2 font-mono">${r.strike}</td>}
                              {autoCcVisibleCols.has('expiration') && <td className="py-2 pr-2 font-mono text-xs">{new Date(r.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>}
                              {autoCcVisibleCols.has('dte') && <td className="py-2 pr-2 text-right font-mono text-xs">{r.dte}{isAmber && <div className="inline-flex items-center ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 cursor-help" title={`AI recommends ${r.aiRecommendedDte}-DTE for better premium`}>→ {r.aiRecommendedDte}d</div>}</td>}
                              {autoCcVisibleCols.has('delta') && <td className="py-2 pr-2 text-right font-mono text-xs">{r.delta.toFixed(2)}</td>}
                              {autoCcVisibleCols.has('mid') && <td className="py-2 pr-2 text-right font-mono text-green-400">${r.mid.toFixed(2)}</td>}
                              {autoCcVisibleCols.has('total') && <td className="py-2 pr-2 text-right font-mono text-green-400">${r.totalPremium.toFixed(0)}</td>}
                              {autoCcVisibleCols.has('wklyPct') && <td className="py-2 pr-2 text-right font-mono text-purple-400">{r.weeklyReturn.toFixed(2)}%</td>}
                              {autoCcVisibleCols.has('aiScore') && hasAiScores && (
                                <td className="py-2 pl-3" style={{minWidth:'220px'}}>
                                  {r.aiScore !== undefined ? (
                                    <div className="flex items-start gap-2">
                                      {/* Score number with D1-D6 breakdown tooltip */}
                                      <TooltipProvider delayDuration={150}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className={`font-mono font-bold text-base shrink-0 w-7 text-right cursor-help underline decoration-dotted decoration-1 underline-offset-2 ${scoreColor}`}>{r.aiScore}</span>
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className="p-0 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl" style={{minWidth: '200px'}}>
                                            {r.scoreBreakdown ? (
                                              <div className="p-3">
                                                <div className="text-xs font-semibold text-zinc-300 mb-2 pb-1.5 border-b border-zinc-700">Score Breakdown</div>
                                                <div className="space-y-1.5">
                                                  {([
                                                    { key: 'd1Liquidity',         label: 'D1 Liquidity',         max: 15 },
                                                    { key: 'd2ProbabilityFit',    label: 'D2 Probability Fit',   max: 25 },
                                                    { key: 'd3PremiumEfficiency', label: 'D3 Premium Efficiency',max: 20 },
                                                    { key: 'd4IVRichness',        label: 'D4 IV Richness',       max: 10 },
                                                    { key: 'd5StrikeSafety',      label: 'D5 Strike Safety',     max: 20 },
                                                    { key: 'd6Technical',         label: 'D6 Technical',         max: 10 },
                                                  ] as const).map(({ key, label, max }) => {
                                                    const val = r.scoreBreakdown![key] ?? 0;
                                                    const pct = Math.round((val / max) * 100);
                                                    const barColor = pct >= 80 ? 'bg-green-500' : pct >= 55 ? 'bg-blue-500' : pct >= 35 ? 'bg-amber-500' : 'bg-red-500';
                                                    return (
                                                      <div key={key} className="flex items-center gap-2">
                                                        <span className="text-[10px] text-zinc-400 w-36 shrink-0">{label}</span>
                                                        <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                                                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                                                        </div>
                                                        <span className="text-[10px] font-mono text-zinc-300 w-8 text-right shrink-0">{val}/{max}</span>
                                                      </div>
                                                    );
                                                  })}
                                                  {(r.scoreBreakdown.basisBonus ?? 0) > 0 && (
                                                    <div className="flex items-center gap-2 pt-1 border-t border-zinc-700/60">
                                                      <span className="text-[10px] text-zinc-400 w-36 shrink-0">Basis Bonus</span>
                                                      <div className="flex-1" />
                                                      <span className="text-[10px] font-mono text-green-400 w-8 text-right shrink-0">+{r.scoreBreakdown.basisBonus}</span>
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="mt-2 pt-1.5 border-t border-zinc-700 flex justify-between items-center">
                                                  <span className="text-[10px] text-zinc-400">Total</span>
                                                  <span className={`text-xs font-bold font-mono ${scoreColor}`}>{r.aiScore}/100</span>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="p-3 text-xs text-zinc-400">Score breakdown not available</div>
                                            )}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                      {r.aiRationale && <span className="text-[10px] text-muted-foreground leading-snug cursor-help line-clamp-2" title={r.aiRationale} style={{maxWidth:'170px'}}>{r.aiRationale}</span>}
                                    </div>
                                  ) : <span className="text-muted-foreground text-xs">—</span>}
                                </td>
                              )}
                              {autoCcVisibleCols.has('ai') && <td className="py-2 pl-2 text-center"><AIRowIcon onClick={() => setAiSellCallCandidate({ symbol: r.symbol, account: r.account, strike: r.strike, expiration: new Date(r.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }), dte: r.dte, delta: r.delta, mid: r.mid, totalPremium: r.totalPremium, weeklyReturn: r.weeklyReturn, currentPrice: r.currentPrice, quantity: r.quantity, aiScore: r.aiScore, aiRationale: r.aiRationale })} title={`AI analysis for ${r.symbol} covered call`} /></td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Two-tranche legend when AI scores are present */}
                  {hasAiScores && amberCount > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-500/20 border border-blue-500/40 inline-block" />
                        <strong className="text-foreground">Tranche 1</strong> — {cleanCount} clean row{cleanCount !== 1 ? 's' : ''} selected, ready to submit
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/20 border border-amber-500/40 inline-block" />
                        <strong className="text-amber-400">Tranche 2</strong> — {amberCount} row{amberCount !== 1 ? 's' : ''} pending DTE adjustment &amp; rescan
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
          {/* Re-score button: shown when AI scoring is enabled but results have no scores yet */}
          {lastRunResult && lastRunResult.ccScanResults && lastRunResult.ccScanResults.length > 0
            && settings?.aiScoringEnabled
            && !lastRunResult.ccScanResults.some(r => r.aiScore !== undefined)
            && !isAiScoring && (
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                onClick={() => runAiScoring(lastRunResult.ccScanResults)}
              >
                <Zap className="h-3.5 w-3.5 mr-1" />
                Score with AI
              </Button>
            </div>
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

          {/* Excluded Symbols — collapsible section shown when there are excluded stocks */}
          {lastRunResult && lastRunResult.ccExcludedStocks && lastRunResult.ccExcludedStocks.length > 0 && (() => {
            // Deduplicate by symbol (merge accounts for same symbol)
            const bySymbol = lastRunResult.ccExcludedStocks.reduce<Record<string, CCExcludedStock & { accounts: string[] }>>((acc, s) => {
              if (!acc[s.symbol]) {
                acc[s.symbol] = { ...s, accounts: [s.account] };
              } else {
                if (!acc[s.symbol].accounts.includes(s.account)) acc[s.symbol].accounts.push(s.account);
              }
              return acc;
            }, {});
            const deduped = Object.values(bySymbol);
            const scannableCount = deduped.filter(s =>
              s.currentPrice && s.currentPrice > 0 &&
              !s.reason.includes('No price data') &&
              !s.reason.includes('Flagged for exit')
            ).length;
            return (
              <Collapsible className="mt-4">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/30 rounded-md hover:bg-muted/20"
                  >
                    <span className="flex items-center gap-2">
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span>{deduped.length} symbol{deduped.length !== 1 ? 's' : ''} excluded from scan</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-muted-foreground/30 text-muted-foreground">
                        {deduped.length}
                      </Badge>
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded-md border border-muted-foreground/20 bg-muted/10 overflow-hidden">
                    {/* Header with scan button */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-muted-foreground/20 bg-muted/20">
                      <span className="text-xs text-muted-foreground">
                        {scannableCount > 0
                          ? `${scannableCount} stock${scannableCount !== 1 ? 's' : ''} can be scanned for best available contract`
                          : 'All exclusions are hard blocks (no scan available)'}
                      </span>
                      {scannableCount > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 gap-1 border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                          onClick={(e) => { e.stopPropagation(); runExcludedScan(lastRunResult.ccExcludedStocks); }}
                          disabled={isExcludedScanning}
                        >
                          {isExcludedScanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                          {isExcludedScanning ? 'Scanning...' : 'Scan for Best Contracts'}
                        </Button>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-muted-foreground/20">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Symbol</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Shares</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Coverage</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reason Excluded</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Best Strike</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">DTE</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Mid</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Wkly%</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Score</th>
                          <th className="text-center px-3 py-2 font-medium text-muted-foreground">Override</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deduped.map((s) => {
                          const totalContracts = Math.floor(s.quantity / 100);
                          const usedContracts = s.existingContracts + s.workingContracts;
                          const isPending = s.workingContracts > 0;
                          const isFullyCovered = s.existingContracts > 0 && s.existingContracts >= totalContracts;
                          const isHardBlock = s.reason.includes('No price data') || s.reason.includes('Flagged for exit');
                          const scanResult = excludedScanResults.find(r => r.symbol === s.symbol);
                          return (
                            <tr key={s.symbol} className="border-b border-muted-foreground/10 last:border-0 hover:bg-muted/10">
                              <td className="px-3 py-2 font-semibold text-foreground/80">{s.symbol}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{s.quantity.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">
                                <span className={`font-mono ${
                                  isFullyCovered ? 'text-orange-400' : isPending ? 'text-yellow-400' : 'text-muted-foreground'
                                }`}>
                                  {usedContracts}/{totalContracts}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`cursor-help inline-flex items-center gap-1 ${
                                        isHardBlock ? 'text-red-400/80' : isPending ? 'text-yellow-400/80' : isFullyCovered ? 'text-orange-400/80' : 'text-muted-foreground'
                                      }`}>
                                        {isHardBlock ? <XCircle className="h-3 w-3" /> : isPending ? <Clock className="h-3 w-3" /> : isFullyCovered ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                                        {s.reason}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-xs text-xs">
                                      <p>{s.reason}</p>
                                      {s.accounts.length > 1 && (
                                        <p className="mt-1 text-muted-foreground">Accounts: {s.accounts.join(', ')}</p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </td>
                              {/* Best available contract columns */}
                              {scanResult ? (
                                <>
                                  <td className="px-3 py-2 text-right font-mono text-emerald-400">${scanResult.strike}</td>
                                  <td className="px-3 py-2 text-right text-muted-foreground">{scanResult.dte}d</td>
                                  <td className="px-3 py-2 text-right text-emerald-400">${scanResult.mid.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right text-emerald-400">{scanResult.weeklyReturn.toFixed(2)}%</td>
                                  <td className="px-3 py-2 text-right">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className={`font-bold cursor-help border-b border-dotted border-current ${
                                            scanResult.aiScore >= 75 ? 'text-emerald-400' :
                                            scanResult.aiScore >= 55 ? 'text-yellow-400' : 'text-red-400'
                                          }`}>{scanResult.aiScore}</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="w-52 text-xs p-3">
                                          <p className="font-semibold mb-2">D1-D6 Score Breakdown</p>
                                          {([
                                            { key: 'd1Liquidity', label: 'D1 Liquidity', max: 15 },
                                            { key: 'd2ProbabilityFit', label: 'D2 Probability Fit', max: 25 },
                                            { key: 'd3PremiumEfficiency', label: 'D3 Premium', max: 20 },
                                            { key: 'd4IvRichness', label: 'D4 IV Richness', max: 10 },
                                            { key: 'd5StrikeSafety', label: 'D5 Strike Safety', max: 20 },
                                            { key: 'd6TechnicalContext', label: 'D6 Technical', max: 10 },
                                          ] as const).map(({ key, label, max }) => {
                                            const val = scanResult.scoreBreakdown?.[key] ?? null;
                                            const pct = val != null ? (val / max) * 100 : 0;
                                            return (
                                              <div key={key} className="mb-1.5">
                                                <div className="flex justify-between mb-0.5">
                                                  <span className="text-muted-foreground">{label}</span>
                                                  <span className="font-mono">{val ?? '—'}/{max}</span>
                                                </div>
                                                <div className="h-1 bg-muted rounded-full overflow-hidden">
                                                  <div className={`h-full rounded-full ${
                                                    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                                                  }`} style={{ width: `${pct}%` }} />
                                                </div>
                                              </div>
                                            );
                                          })}
                                          <div className="mt-2 pt-2 border-t border-muted-foreground/20 flex justify-between font-semibold">
                                            <span>Total</span>
                                            <span>{scanResult.aiScore}/100</span>
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-[10px] px-2 gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                                      onClick={() => setSwapConfirmItem(scanResult)}
                                    >
                                      <PlusCircle className="h-3 w-3" />
                                      Override & Add
                                    </Button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td colSpan={5} className="px-3 py-2 text-center text-muted-foreground/50 italic">
                                    {isHardBlock ? 'Hard block — no scan' : isExcludedScanning ? 'Scanning...' : 'Click "Scan for Best Contracts" above'}
                                  </td>
                                  <td />
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })()}
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 4: PMCC Management
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step4-pmcc">
          <PMCCDashboard />
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            STEP 2: Auto-Close / Roll Monitor
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step5-gtc">
          <div className="p-6">
            <AutoCloseStep />
          </div>
        </TabsContent>
        {/* ─────────────────────────────────────────────────────────────────
            STEP 5: SPX Spreads Auto-Entry
        ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="step6-bcs">
          <div className="p-6">
            <BcsAutoEntryStep />
          </div>
        </TabsContent>

      </Tabs>}{/* end conditional automation tabs */}

      {/* Unified Order Preview Modal */}
      {showOrderPreview && unifiedOrders.length > 0 && (
        <UnifiedOrderPreviewModal
          open={showOrderPreview}
          onOpenChange={(open) => {
            setShowOrderPreview(open);
            if (!open) {
              if (orderSubmissionComplete && submittedCCKeys.size > 0) {
                // CC STO submitted — remove submitted rows, isolate amber (Tranche 2) rows
                setLastRunResult(prev => {
                  if (!prev) return prev;
                  const remaining = prev.ccScanResults.filter(
                    r => !submittedCCKeys.has(`${r.optionSymbol}|${r.account}`)
                  );
                  const submittedCount = prev.ccScanResults.length - remaining.length;
                  const amberRemaining = remaining.filter(r => r.aiRecommendedDte);
                  if (amberRemaining.length > 0) {
                    setTranche2Pending(amberRemaining);
                    toast.success(
                      `Tranche 1 submitted (${submittedCount} order${submittedCount !== 1 ? 's' : ''}). ${amberRemaining.length} Tranche 2 row${amberRemaining.length !== 1 ? 's' : ''} remaining — rescan when ready.`,
                      { duration: 6000 }
                    );
                  } else if (submittedCount > 0) {
                    toast.success(`${submittedCount} CC order${submittedCount !== 1 ? 's' : ''} submitted successfully.`);
                  }
                  return { ...prev, ccScanResults: remaining };
                });
                // Deselect submitted CC positions
                setSelectedCCPositions(prev => {
                  const next = new Set(prev);
                  submittedCCKeys.forEach(k => next.delete(k));
                  return next;
                });
                setSubmittedCCKeys(new Set());
              } else if (orderSubmissionComplete && submittedPositionKeys.size > 0) {
                // BTC close submitted — remove submitted positions from scan results
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
          strategy={previewStrategy}
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

      {/* Roll Order Review Modal */}
      {showRollReview && (
        <RollOrderReviewModal
          open={showRollReview}
          onClose={() => {
            setShowRollReview(false);
            setIsSubmittingRolls(false);
          }}
          items={rollReviewItems}
          onSubmit={handleRollReviewSubmit}
          isSubmitting={isSubmittingRolls}
          bestFitCache={bestFitCache}
        />
      )}

      {/* AI Strategy Review Panel — slide-out overlay */}
      {aiReviewStrategy && (
        <AIStrategyReviewPanel
          strategy={aiReviewStrategy}
          positions={aiReviewPositions}
          onClose={() => setAiReviewStrategy(null)}
        />
      )}

      {/* AI Roll Advisor Panel — per-position slide-out overlay */}
      {aiRollAdvisorPosition && (
        <AIRollAdvisorPanel
          position={aiRollAdvisorPosition}
          onClose={() => setAiRollAdvisorPosition(null)}
        />
      )}

      {/* AI Sell Call Advisor Panel — per-CC-candidate slide-out overlay */}
      {aiSellCallCandidate && (
        <AISellCallAdvisorPanel
          candidate={aiSellCallCandidate}
          onClose={() => setAiSellCallCandidate(null)}
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

      {/* Override & Add Confirmation Dialog */}
      <Dialog open={!!swapConfirmItem} onOpenChange={(open) => { if (!open) setSwapConfirmItem(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-amber-400" />
              Override & Add — {swapConfirmItem?.symbol}
            </DialogTitle>
            <DialogDescription>
              This stock was excluded from the scan. You are manually overriding the exclusion and adding this contract to the selected list. The exclusion reason was:
            </DialogDescription>
          </DialogHeader>
          {swapConfirmItem && (() => {
            const excluded = lastRunResult?.ccExcludedStocks.find(s => s.symbol === swapConfirmItem.symbol);
            return (
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-amber-300 text-xs flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{excluded?.reason ?? 'Unknown exclusion reason'}</span>
                </div>
                <div className="rounded-md border border-muted-foreground/20 bg-muted/10 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span className="font-mono">{swapConfirmItem.optionSymbol}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Strike</span><span className="font-mono">${swapConfirmItem.strike}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Expiration</span><span>{swapConfirmItem.expiration}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">DTE</span><span>{swapConfirmItem.dte}d</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Mid</span><span className="text-emerald-400">${swapConfirmItem.mid.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Wkly%</span><span className="text-emerald-400">{swapConfirmItem.weeklyReturn.toFixed(2)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">AI Score</span><span className={swapConfirmItem.aiScore >= 75 ? 'text-emerald-400' : swapConfirmItem.aiScore >= 55 ? 'text-yellow-400' : 'text-red-400'}>{swapConfirmItem.aiScore}/100</span></div>
                </div>
              </div>
            );
          })()}
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSwapConfirmItem(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-black"
              onClick={() => {
                if (!swapConfirmItem) return;
                const newEntry: CCScanResult = {
                  account: swapConfirmItem.account,
                  symbol: swapConfirmItem.symbol,
                  optionSymbol: swapConfirmItem.optionSymbol,
                  strike: swapConfirmItem.strike,
                  expiration: swapConfirmItem.expiration,
                  dte: swapConfirmItem.dte,
                  delta: swapConfirmItem.delta,
                  bid: swapConfirmItem.mid * 0.95,
                  ask: swapConfirmItem.mid * 1.05,
                  mid: swapConfirmItem.mid,
                  quantity: swapConfirmItem.quantity,
                  premiumPerContract: swapConfirmItem.mid,
                  totalPremium: swapConfirmItem.totalPremium,
                  returnPct: swapConfirmItem.weeklyReturn * 4,
                  weeklyReturn: swapConfirmItem.weeklyReturn,
                  currentPrice: swapConfirmItem.currentPrice,
                  action: 'WOULD_SELL_CC',
                  aiScore: swapConfirmItem.aiScore,
                  scoreBreakdown: swapConfirmItem.scoreBreakdown,
                  openInterest: swapConfirmItem.openInterest,
                  volume: swapConfirmItem.volume,
                  iv: swapConfirmItem.iv,
                };
                setLastRunResult(prev => prev ? { ...prev, ccScanResults: [...prev.ccScanResults, newEntry] } : prev);
                setSelectedCCPositions(prev => new Set(Array.from(prev).concat(`${newEntry.optionSymbol}|${newEntry.account}`)));
                setSwapConfirmItem(null);
                toast.success(`${swapConfirmItem.symbol} override added to selected contracts`);
              }}
            >
              <PlusCircle className="h-3.5 w-3.5 mr-1" />
              Confirm Override & Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
// ─── Best Fit Optimizer (client-side, no extra API calls) ────────────────────
type BestFitResult = {
  candidate: RollCandidate;
  bestFitScore: number;
  premiumScore: number;
  strikeScore: number;
  dteScore: number;
  strikeImprovementBonus: number;
  rank: number;
};

function rankBestFit(
  candidates: RollCandidate[],
  underlyingPrice: number,
  isPut: boolean,
  cfg?: {
    premiumWeight?: number; strikeWeight?: number; dteWeight?: number;
    targetOtmPct?: number; otmBandPct?: number; dteSweetMin?: number; dteSweetMax?: number;
    /** Current position ITM depth % (positive = ITM). Activates Strike Improvement Bonus + Adaptive OTM Band. */
    currentItmDepthPct?: number;
    /** Current position strike price. Required for Strike Improvement Bonus. */
    currentStrike?: number;
  }
): BestFitResult[] {
  const pw = cfg?.premiumWeight ?? 0.40;
  const sw = cfg?.strikeWeight  ?? 0.35;
  const dw = cfg?.dteWeight     ?? 0.25;
  const targetOtm = cfg?.targetOtmPct ?? 6.5;
  const band      = cfg?.otmBandPct   ?? 3;
  const dteMin    = cfg?.dteSweetMin  ?? 30;
  const dteMax    = cfg?.dteSweetMax  ?? 45;
  const itmDepth  = cfg?.currentItmDepthPct ?? 0;
  const currentStrike = cfg?.currentStrike;
  const positionIsItm = itmDepth > 0;

  // Adaptive OTM target: when deeply ITM, lower the bar so any OTM improvement scores well.
  // At itmDepth=0 → standard target; at itmDepth≥10% → target=0.5%
  const rescueFactor = positionIsItm ? Math.min(1, itmDepth / 10) : 0;
  const effectiveTargetOtm = targetOtm * (1 - rescueFactor) + 0.5 * rescueFactor;
  const effectiveBand = band + rescueFactor * 4;

  // Score all candidates regardless of action type
  const rollOnly = candidates;
  if (rollOnly.length === 0) return [];

  const credits = rollOnly.map(c => c.netCredit ?? 0);
  const maxC = Math.max(...credits);
  const minC = Math.min(...credits);
  const range = maxC - minC;

  // Pre-compute max strike improvement for normalisation (used in bonus)
  const allImprovements = rollOnly
    .filter(c => c.strike !== undefined)
    .map(c => isPut
      ? ((currentStrike ?? 0) - c.strike!) / underlyingPrice * 100
      : (c.strike! - (currentStrike ?? 0)) / underlyingPrice * 100
    );
  const maxImprovement = Math.max(...allImprovements, 0.001);

  const scored = rollOnly.map(c => {
    // 1. Premium score
    let premiumScore = range < 0.01
      ? ((c.netCredit ?? 0) > 0 ? 80 : 40)
      : Math.round(((c.netCredit ?? 0) - minC) / range * 100);
    if (c.meets3XRule) premiumScore = Math.min(100, premiumScore + 10);

    // 2. Strike safety score (with adaptive OTM band for ITM positions)
    let strikeScore = 0;
    if (c.strike !== undefined && underlyingPrice > 0) {
      const otmPct = isPut
        ? ((underlyingPrice - c.strike) / underlyingPrice) * 100
        : ((c.strike - underlyingPrice) / underlyingPrice) * 100;
      if (otmPct < 0) {
        strikeScore = Math.max(0, 10 + otmPct * 2);
      } else {
        const dist = Math.abs(otmPct - effectiveTargetOtm);
        strikeScore = dist <= effectiveBand ? 100 : Math.round(Math.max(0, 1 - (dist - effectiveBand) / (effectiveBand * 3)) * 100);
      }
    }

    // A. Strike Improvement Bonus (ITM rescue only — up to +20 pts)
    // Rewards candidates that move the strike furthest away from the current price.
    let strikeImprovementBonus = 0;
    if (positionIsItm && c.strike !== undefined && currentStrike !== undefined && underlyingPrice > 0) {
      const improvement = isPut
        ? (currentStrike - c.strike) / underlyingPrice * 100
        : (c.strike - currentStrike) / underlyingPrice * 100;
      if (improvement > 0) {
        strikeImprovementBonus = Math.round(Math.min(20, (improvement / maxImprovement) * 20));
      }
    }

    // 3. DTE score
    const dte = c.dte ?? 0;
    let dteScore = 0;
    if (dte >= dteMin && dte <= dteMax) {
      dteScore = 100;
    } else if (dte < dteMin) {
      dteScore = dte <= 7 ? 0 : Math.round(((dte - 7) / (dteMin - 7)) * 100);
    } else {
      dteScore = dte >= 90 ? 0 : Math.round(((90 - dte) / (90 - dteMax)) * 100);
    }

    const weightedBase = Math.round(premiumScore * pw + strikeScore * sw + dteScore * dw);
    const composite = Math.min(100, weightedBase + strikeImprovementBonus);
    return { candidate: c, bestFitScore: composite, premiumScore, strikeScore, dteScore, strikeImprovementBonus };
  });

  scored.sort((a, b) => b.bestFitScore - a.bestFitScore);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
// ─────────────────────────────────────────────────────────────────────────────

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
    quantity: pos.quantity,         // Contract count for per-contract netCredit math
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
  const underlyingPrice: number = (data as any)?.underlyingPrice ?? pos.metrics.currentPrice ?? 0;
  const isPut = pos.strategy === 'CSP' || pos.strategy === 'BPS';

  // Compute Best Fit rankings whenever candidates change (pure client-side, no API calls)
  const bestFitRankings = useMemo(() => {
    if (!candidates || candidates.length === 0) return [];
    return rankBestFit(candidates, underlyingPrice, isPut, {
      currentItmDepthPct: pos.metrics.itmDepth > 0 ? pos.metrics.itmDepth : 0,
      currentStrike: pos.metrics.strikePrice,
    });
  }, [candidates, underlyingPrice, isPut, pos.metrics.itmDepth, pos.metrics.strikePrice]);

  const bestFitWinner = bestFitRankings[0] ?? null;

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
      {/* ⭐ Best Fit header button — shown when there are roll candidates to score */}
      {bestFitWinner && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground">Best Fit picks the optimal balance of premium, strike safety, and DTE (30–45d sweet spot)</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectCandidate(bestFitWinner.candidate)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-yellow-500/60 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 text-xs font-semibold transition-all"
                >
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  Best Fit
                  <span className="text-yellow-400/70 font-normal">{bestFitWinner.bestFitScore}/100</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs p-3 space-y-2">
                <p className="font-semibold flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> Best Fit Optimizer
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="opacity-70">Premium / credit (40%)</span>
                    <span className="font-semibold">{bestFitWinner.premiumScore}/100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Strike safety 5–8% OTM (35%)</span>
                    <span className="font-semibold">{bestFitWinner.strikeScore}/100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">DTE sweet spot 30–45d (25%)</span>
                    <span className="font-semibold">{bestFitWinner.dteScore}/100</span>
                  </div>
                </div>
                <p className="opacity-70 border-t border-border/40 pt-2 text-[11px]">
                  Clicking selects {bestFitWinner.candidate.description}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
      {/* ITM Playbook guidance — shown when no credit roll is available */}
      {allDebits && (() => {
        const closeCandidate = candidates.find(c => c.action === 'close');
        const closeCostAmt  = closeCandidate?.closeCost;
        const openPremAmt   = closeCandidate?.openPremium;
        const netPnlAmt     = closeCandidate?.netPnl;
        return (
        <div className="mb-3 p-3 rounded-lg border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-red-400 font-bold text-xs">⚠ No Credit Roll Available</span>
            <span className="text-xs text-muted-foreground">— all roll candidates require paying a debit.</span>
            {isSpread && (
              <span className="text-xs text-red-300/80 font-medium">
                This is a {pos.strategy} spread — your loss is already capped. Rolling at a debit only adds more cost.
              </span>
            )}
            {/* Inline P&L summary */}
            {closeCostAmt !== undefined && (
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">BTC cost:</span>
                <span className="font-bold text-red-400">${closeCostAmt.toFixed(2)}</span>
                {openPremAmt !== undefined && (
                  <><span className="text-muted-foreground">orig. premium:</span>
                  <span className="font-bold text-green-400">+${openPremAmt.toFixed(2)}</span></>
                )}
                {netPnlAmt !== undefined && (
                  <span className={`font-bold px-1.5 py-0.5 rounded ${netPnlAmt >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    Net {netPnlAmt >= 0 ? '+' : ''}${netPnlAmt.toFixed(2)}
                  </span>
                )}
              </div>
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
        );
      })()}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
        <span className="font-medium text-foreground">{pos.symbol} Roll Options</span>
        {underlyingPrice && <span>Underlying: <span className="font-mono text-blue-400">${underlyingPrice.toFixed(2)}</span></span>}
        <span>Current strike: <span className="font-mono">${pos.metrics.strikePrice.toFixed(2)}</span></span>
        <span>Current DTE: <span className={`font-mono ${pos.metrics.dte <= 7 ? 'text-red-400' : 'text-yellow-400'}`}>{pos.metrics.dte}</span></span>
        {isSpread && pos.spreadDetails?.spreadWidth && (
          <span>Width: <span className="font-mono text-amber-400">${pos.spreadDetails.spreadWidth.toFixed(0)}</span></span>
        )}
      </div>
      {/* Spread legs breakdown + payoff diagram */}
      {isSpread && pos.spreadDetails && (() => {
        const sd = pos.spreadDetails!;
        const shortLeg = sd.legs.find(l => l.role === 'short');
        const longLeg  = sd.legs.find(l => l.role === 'long');
        const shortStrike = shortLeg?.strike || sd.shortStrike || sd.putShortStrike || sd.callShortStrike || 0;
        const longStrike  = longLeg?.strike  || sd.longStrike  || sd.putLongStrike  || sd.callLongStrike  || 0;
        const stockPrice  = underlyingPrice || pos.metrics.currentPrice || 0;
        const isPutSpread = pos.strategy === 'BPS';
        // Payoff diagram: show price axis from (lower strike - 10%) to (higher strike + 10%)
        const lo = Math.min(shortStrike, longStrike) * 0.90;
        const hi = Math.max(shortStrike, longStrike) * 1.10;
        const range = hi - lo;
        const toX = (price: number) => ((price - lo) / range) * 100; // 0-100%
        const stockX = toX(stockPrice);
        const shortX = toX(shortStrike);
        const longX  = toX(longStrike);
        // For BPS: profit zone is above short put; loss zone is between long put and short put
        // For BCS: profit zone is below short call; loss zone is between short call and long call
        const profitLeft  = isPutSpread ? shortX : 0;
        const profitRight = isPutSpread ? 100    : shortX;
        const lossLeft    = isPutSpread ? longX  : shortX;
        const lossRight   = isPutSpread ? shortX : longX;
        return (
          <div className="mb-3 p-3 rounded-lg bg-muted/20 border border-border/30">
            {/* Header row: leg pills */}
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-muted-foreground">{pos.strategy} Position — {sd.legs.length * 2}-leg atomic roll</div>
              <div className="flex gap-2">
                {sd.legs.map((leg, i) => (
                  <div key={i} className={`text-xs px-2 py-0.5 rounded border font-medium ${
                    leg.role === 'short' ? 'border-red-400/40 bg-red-500/10 text-red-300' : 'border-green-400/40 bg-green-500/10 text-green-300'
                  }`}>
                    {leg.role === 'short' ? '▼ Short' : '▲ Long'} {leg.optionType === 'PUT' ? 'Put' : 'Call'} <span className="font-mono">${leg.strike.toFixed(0)}</span>
                    {leg.markPrice > 0 && <span className="opacity-60 ml-1">(${leg.markPrice.toFixed(2)})</span>}
                  </div>
                ))}
              </div>
            </div>
            {/* Payoff diagram */}
            <div className="relative h-14 rounded overflow-hidden bg-background/40 border border-border/20">
              {/* Profit zone */}
              <div
                className="absolute top-0 bottom-0 bg-green-500/15"
                style={{ left: `${profitLeft}%`, width: `${profitRight - profitLeft}%` }}
              />
              {/* Loss zone */}
              <div
                className="absolute top-0 bottom-0 bg-red-500/15"
                style={{ left: `${lossLeft}%`, width: `${lossRight - lossLeft}%` }}
              />
              {/* Profit label */}
              <div
                className="absolute top-1 text-[9px] font-bold text-green-400/80 pointer-events-none"
                style={{ left: `${profitLeft + (profitRight - profitLeft) / 2}%`, transform: 'translateX(-50%)' }}
              >PROFIT</div>
              {/* Loss label */}
              <div
                className="absolute top-1 text-[9px] font-bold text-red-400/80 pointer-events-none"
                style={{ left: `${lossLeft + (lossRight - lossLeft) / 2}%`, transform: 'translateX(-50%)' }}
              >LOSS</div>
              {/* Short strike line */}
              {shortStrike > 0 && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-400/70"
                    style={{ left: `${shortX}%` }}
                  />
                  <div
                    className="absolute bottom-1 text-[9px] font-mono text-red-300 pointer-events-none"
                    style={{ left: `${shortX}%`, transform: 'translateX(-50%)' }}
                  >Short ${shortStrike.toFixed(0)}</div>
                </>
              )}
              {/* Long strike line */}
              {longStrike > 0 && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-px bg-green-400/70"
                    style={{ left: `${longX}%` }}
                  />
                  <div
                    className="absolute bottom-1 text-[9px] font-mono text-green-300 pointer-events-none"
                    style={{ left: `${longX}%`, transform: 'translateX(-50%)' }}
                  >Long ${longStrike.toFixed(0)}</div>
                </>
              )}
              {/* Current stock price marker */}
              {stockPrice > 0 && stockX >= 0 && stockX <= 100 && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-sky-400/90"
                    style={{ left: `${stockX}%` }}
                  />
                  <div
                    className="absolute top-1 text-[9px] font-mono font-bold text-sky-300 pointer-events-none"
                    style={{ left: `${stockX}%`, transform: 'translateX(-50%)' }}
                  >${stockPrice.toFixed(0)}</div>
                </>
              )}
            </div>
            {/* Legend */}
            <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-sky-400/80"/> Stock price</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-400/70"/> Short strike (obligation)</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-400/70"/> Long strike (protection)</span>
              {sd.spreadWidth && <span className="ml-auto font-medium text-amber-400">Max loss: ${sd.spreadWidth.toFixed(0)} × 100 = ${(sd.spreadWidth * 100).toFixed(0)}/contract</span>}
            </div>
          </div>
        );
      })()}
      <div className="grid gap-2">
        {candidates.map((c, i) => {
          const isSelected = selectedCandidate === c ||
            (selectedCandidate?.action === c.action && selectedCandidate?.strike === c.strike && selectedCandidate?.expiration === c.expiration);
          // Check if this candidate is the Best Fit winner
          const bfResult = c.action === 'roll'
            ? bestFitRankings.find(r =>
                r.candidate.strike === c.strike &&
                r.candidate.expiration === c.expiration &&
                r.candidate.dte === c.dte
              )
            : undefined;
          const isBestFit = bfResult?.rank === 1;
          return (
            <button
              key={i}
              onClick={() => onSelectCandidate(c)}
              className={`w-full text-left p-3 rounded-lg border text-sm transition-all ${
                isBestFit && !isSelected
                  ? 'border-yellow-500/40 bg-yellow-500/5 hover:bg-yellow-500/10 text-muted-foreground hover:text-foreground'
                  : isSelected
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
                  {isBestFit && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-500/15 border border-yellow-500/40 text-yellow-300 text-[10px] font-semibold">
                      <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                      Best Fit {bfResult!.bestFitScore}
                    </span>
                  )}
                  <span className="font-medium">{c.description}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {c.action === 'roll' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-semibold cursor-help">
                            <ShieldCheck className="h-3 w-3" /> Atomic {isSpread ? '4-leg' : '2-leg'}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs p-3">
                          <p className="font-semibold text-foreground mb-1">Atomic {isSpread ? '4-Leg' : '2-Leg'} Combo Order</p>
                          {isSpread ? (
                            <>
                              <p className="text-muted-foreground mb-1">This {pos.strategy} spread roll submits as a single 4-leg combo order:</p>
                              <ol className="text-muted-foreground space-y-0.5 list-decimal list-inside">
                                <li>BTC existing short leg (close obligation)</li>
                                <li>BTC existing long leg (close protection)</li>
                                <li>STO new short leg (new obligation)</li>
                                <li>STO new long leg (new protection)</li>
                              </ol>
                              <p className="text-muted-foreground mt-1">All 4 legs execute simultaneously — you are never exposed to a naked leg at any point.</p>
                            </>
                          ) : (
                            <p className="text-muted-foreground">This roll submits as a single 2-leg combo order — the Buy-to-Close of the existing leg and the Sell-to-Open of the new leg execute simultaneously. You will never be left with a naked position between legs.</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {/* Roll candidate: credit/debit, delta, annualized return */}
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
                  {/* Close candidate: debit cost + net P&L breakdown */}
                  {c.action === 'close' && c.closeCost !== undefined && (
                    <span className="text-red-400 font-semibold">BTC ${c.closeCost.toFixed(2)}</span>
                  )}
                  {c.action === 'close' && c.openPremium !== undefined && (
                    <span className="text-muted-foreground text-[11px]">orig. +${c.openPremium.toFixed(2)}</span>
                  )}
                  {c.action === 'close' && c.netPnl !== undefined && (
                    <span className={`font-bold text-xs px-1.5 py-0.5 rounded ${c.netPnl >= 0 ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                      Net {c.netPnl >= 0 ? '+' : ''}${c.netPnl.toFixed(2)}
                    </span>
                  )}
                  {c.meets3XRule && (
                    <Badge variant="outline" className="text-green-400 border-green-400/40 text-xs py-0">3X ✓</Badge>
                  )}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`font-semibold cursor-help inline-flex items-center gap-1 ${isSelected ? 'text-orange-400' : 'text-muted-foreground'}`}>
                          Score: {c.score} <Info className="h-3 w-3 opacity-50" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs text-xs space-y-2 p-3">
                        <p className="font-semibold text-foreground">Roll Score (0–100)</p>
                        <div className="space-y-1">
                          <div><span className="text-orange-400 font-medium">Net Credit (30 pts)</span> — credits score highest; large debits penalized</div>
                          <div><span className="text-orange-400 font-medium">Annualized Return (25 pts)</span> — higher annualized yield = better</div>
                          <div><span className="text-orange-400 font-medium">3X Rule (15 pts)</span> — bonus if new premium ≥ 3× the buyback cost</div>
                          <div><span className="text-orange-400 font-medium">DTE (15 pts)</span> — 7–14 days is ideal sweet spot</div>
                          <div><span className="text-orange-400 font-medium">Delta (15 pts)</span> — lower delta (further OTM) = safer = higher score</div>
                        </div>
                        <p className="text-muted-foreground border-t border-border/40 pt-2">"Close" always scores 50 (neutral). Higher = better candidate.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
