import { useState, useEffect, useRef, useMemo } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { CCMobileCard } from "@/components/MobileOpportunityCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { useTradingMode } from "@/contexts/TradingModeContext";
import { useAccountNicknames } from "@/hooks/useAccountNicknames";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Target,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  Download,
  Filter,
  Calendar,
  Sparkles,
  Minus,
  Plus,
  Wallet,
  BarChart2,
} from "lucide-react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { AIAdvisorPanel } from "@/components/AIAdvisorPanel";
import { AIAdvisorButton } from "@/components/AIAdvisorButton";
import { AIRowIcon } from "@/components/AIRowIcon";
import { BollingerChartPanel } from "@/components/BollingerChartPanel";
import { cn, exportToCSV } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { UnifiedOrderPreviewModal, UnifiedOrder } from "@/components/UnifiedOrderPreviewModal";
import { OrderStatusModal, OrderSubmissionStatus } from "@/components/OrderStatusModal";
import { HelpBadge } from "@/components/HelpBadge";
import { HelpDialog } from "@/components/HelpDialog";
import { HELP_CONTENT } from "@/lib/helpContent";
import { RiskBadgeList } from "@/components/RiskBadge";
import { SafeguardWarningModal, SafeguardWarning } from "@/components/SafeguardWarningModal";
import { getIndexExchange, getMinSpreadWidth, validateMultiIndexSelection } from "@shared/orderUtils";
import { ColumnVisibilityToggle, useColumnVisibility, type ColumnDef } from "@/components/ColumnVisibilityToggle";
import { PositionTableSkeleton } from '@/components/PositionTableSkeleton';

// BCS column definitions (unified schema)
const BCS_COLUMNS: ColumnDef[] = [
  { key: 'score',       label: 'Score',        group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'trend14d',   label: 'Trend 14d',    group: 'Core',                    defaultVisible: true  },
  { key: 'symbol',     label: 'Symbol',       group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'exchange',   label: 'Exchange',     group: 'Core',                    defaultVisible: true  },
  { key: 'currentPrice', label: 'Current',    group: 'Position',                defaultVisible: true  },
  { key: 'strikes',    label: 'Strikes',      group: 'Position', pinned: true,  defaultVisible: true  },
  { key: 'width',      label: 'Width',        group: 'Position',                defaultVisible: true  },
  { key: 'dte',        label: 'DTE',          group: 'Position', pinned: true,  defaultVisible: true  },
  { key: 'netCredit',  label: 'Net Credit',   group: 'Returns',  pinned: true,  defaultVisible: true  },
  { key: 'capitalAtRisk', label: 'Capital Risk', group: 'Returns',              defaultVisible: false },
  { key: 'weeklyPct',  label: 'Weekly %',     group: 'Returns',                 defaultVisible: true  },
  { key: 'roc',        label: 'ROC %',        group: 'Returns',                 defaultVisible: true  },
  { key: 'delta',      label: 'Delta (Δ)',    group: 'Greeks',                  defaultVisible: false },
  { key: 'ivRank',     label: 'IV Rank',      group: 'Greeks',                  defaultVisible: false },
  { key: 'expMove',    label: 'Exp Move',     group: 'Greeks',                  defaultVisible: false },
  { key: 'safetyRatio', label: 'Safety Ratio', group: 'Greeks',                 defaultVisible: false },
  { key: 'rsi',        label: 'RSI',          group: 'Technical',               defaultVisible: false },
  { key: 'bbPctB',     label: 'BB %B',        group: 'Technical',               defaultVisible: false },
  { key: 'openInterest', label: 'OI',         group: 'Liquidity',               defaultVisible: false },
  { key: 'volume',     label: 'Vol',          group: 'Liquidity',               defaultVisible: false },
  { key: 'bid',        label: 'Bid',          group: 'Quote',                   defaultVisible: false },
  { key: 'ask',        label: 'Ask',          group: 'Quote',                   defaultVisible: false },
  { key: 'mid',        label: 'Mid',          group: 'Quote',                   defaultVisible: false },
  { key: 'distanceOtm', label: 'Dist OTM',   group: 'Position',                defaultVisible: false },
  { key: 'spreadPct',  label: 'Spread %',     group: 'Quote',                   defaultVisible: false },
  { key: 'expiration', label: 'Expiration',   group: 'Position',                defaultVisible: false },
  { key: 'riskBadges', label: 'Risk',         group: 'Core',                    defaultVisible: true  },
];

// CC (covered call) column definitions
const CC_COLUMNS: ColumnDef[] = [
  { key: 'score',       label: 'Score',        group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'symbol',     label: 'Symbol',       group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'currentPrice', label: 'Current',    group: 'Position',                defaultVisible: true  },
  { key: 'strikes',    label: 'Strike',       group: 'Position', pinned: true,  defaultVisible: true  },
  { key: 'dte',        label: 'DTE',          group: 'Position', pinned: true,  defaultVisible: true  },
  { key: 'netCredit',  label: 'Premium',      group: 'Returns',  pinned: true,  defaultVisible: true  },
  { key: 'weeklyPct',  label: 'Weekly %',     group: 'Returns',                 defaultVisible: true  },
  { key: 'roc',        label: 'ROC %',        group: 'Returns',                 defaultVisible: true  },
  { key: 'delta',      label: 'Delta (Δ)',    group: 'Greeks',                  defaultVisible: false },
  { key: 'ivRank',     label: 'IV Rank',      group: 'Greeks',                  defaultVisible: false },
  { key: 'expMove',    label: 'Exp Move',     group: 'Greeks',                  defaultVisible: false },
  { key: 'safetyRatio', label: 'Safety Ratio', group: 'Greeks',                 defaultVisible: false },
  { key: 'rsi',        label: 'RSI',          group: 'Technical',               defaultVisible: false },
  { key: 'bbPctB',     label: 'BB %B',        group: 'Technical',               defaultVisible: false },
  { key: 'openInterest', label: 'OI',         group: 'Liquidity',               defaultVisible: false },
  { key: 'volume',     label: 'Vol',          group: 'Liquidity',               defaultVisible: false },
  { key: 'bid',        label: 'Bid',          group: 'Quote',                   defaultVisible: false },
  { key: 'ask',        label: 'Ask',          group: 'Quote',                   defaultVisible: false },
  { key: 'mid',        label: 'Mid',          group: 'Quote',                   defaultVisible: false },
  { key: 'distanceOtm', label: 'Dist OTM',   group: 'Position',                defaultVisible: false },
  { key: 'spreadPct',  label: 'Spread %',     group: 'Quote',                   defaultVisible: false },
  { key: 'expiration', label: 'Expiration',   group: 'Position',                defaultVisible: false },
  { key: 'riskBadges', label: 'Risk',         group: 'Core',                    defaultVisible: true  },
];

// Strategy types
type StrategyType = 'cc' | 'spread';
type SpreadWidth = 2 | 5 | 10 | 25 | 50 | 100;

// Feature flag for Bear Call Spreads (set to false to disable)
const ENABLE_BEAR_CALL_SPREADS = true;

// Live countdown component for progress dialog
function LiveCountdown({ startTime, totalSymbols }: { startTime: number; totalSymbols: number }) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  
  useEffect(() => {
    // Use actual performance: 1.32 seconds per symbol (based on 66s for 50 symbols)
    const estimatedTotalSeconds = totalSymbols * 1.32;
    
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, estimatedTotalSeconds - elapsed);
      setRemainingSeconds(remaining);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [startTime, totalSymbols]);
  
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">
        Processing {totalSymbols} symbols...
      </p>
      <p className="text-lg font-semibold text-primary">
        {remainingSeconds > 0 ? (
          <>{minutes}:{seconds.toString().padStart(2, '0')} remaining</>
        ) : (
          <>Finishing up...</>
        )}
      </p>
    </div>
  );
}

// Color-coding helper functions for technical indicators
function getRSIColor(rsi: number | null, strategy: 'csp' | 'cc'): string {
  if (rsi === null) return "bg-gray-500/20 text-gray-500 border-gray-500/50";
  
  if (strategy === 'csp') {
    // CSP: Green for oversold (20-35), Yellow for caution, Red for avoid
    if (rsi >= 20 && rsi <= 35) return "bg-green-500/20 text-green-500 border-green-500/50";
    if ((rsi >= 15 && rsi < 20) || (rsi > 35 && rsi <= 45)) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
    return "bg-red-500/20 text-red-500 border-red-500/50";
  } else {
    // CC: Green for overbought (65-80), Yellow for caution, Red for avoid
    if (rsi >= 65 && rsi <= 80) return "bg-green-500/20 text-green-500 border-green-500/50";
    if ((rsi >= 55 && rsi < 65) || (rsi > 80 && rsi <= 85)) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
    return "bg-red-500/20 text-red-500 border-red-500/50";
  }
}

function getBBColor(bbPctB: number | null, strategy: 'csp' | 'cc'): string {
  if (bbPctB === null) return "bg-gray-500/20 text-gray-500 border-gray-500/50";
  
  if (strategy === 'csp') {
    // CSP: Green for near lower band (0-0.20), Yellow moderate, Red near upper
    if (bbPctB >= 0 && bbPctB <= 0.20) return "bg-green-500/20 text-green-500 border-green-500/50";
    if (bbPctB > 0.20 && bbPctB <= 0.40) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
    return "bg-red-500/20 text-red-500 border-red-500/50";
  } else {
    // CC: Green for near upper band (0.80-1.0), Yellow moderate, Red near lower
    if (bbPctB >= 0.80 && bbPctB <= 1.0) return "bg-green-500/20 text-green-500 border-green-500/50";
    if (bbPctB >= 0.60 && bbPctB < 0.80) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
    return "bg-red-500/20 text-red-500 border-red-500/50";
  }
}

function getROCColor(roc: number): string {
  // Green for excellent (>1.5%), Yellow for good (1.0-1.5%), Red for marginal (<1.0%)
  if (roc > 1.5) return "bg-green-500/20 text-green-500 border-green-500/50";
  if (roc >= 1.0) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
  return "bg-red-500/20 text-red-500 border-red-500/50";
}

function getLiquidityColor(value: number, type: 'oi' | 'vol'): string {
  // OI: Green >500, Yellow 200-500, Red <200
  // Vol: Green >100, Yellow 50-100, Red <50
  const thresholds = type === 'oi' ? { high: 500, medium: 200 } : { high: 100, medium: 50 };
  
  if (value >= thresholds.high) return "bg-green-500/20 text-green-500 border-green-500/50";
  if (value >= thresholds.medium) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
  return "bg-red-500/20 text-red-500 border-red-500/50";
}

type Holding = {
  symbol: string;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  existingContracts: number;
  workingContracts: number;
  sharesCovered: number;
  availableShares: number;
  maxContracts: number;
  hasExistingCalls: boolean;
  hasWorkingOrders: boolean;
  accounts?: string[];
  accountBreakdown?: Record<string, number>; // per-account available contracts
};

type PositionBreakdown = {
  totalPositions: number;
  stockPositions: number;
  existingShortCalls: number;
  eligiblePositions: number;
  eligibleContracts: number;
  coveredSymbols: string[];
  shortCallDetails: Record<string, any>;
};

type CCOpportunity = {
  symbol: string;
  currentPrice: number;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  premium: number;
  returnPct: number;
  weeklyReturn: number;
  volume: number;
  openInterest: number;
  spreadPct: number;
  rsi: number | null;
  ivRank: number | null;
  iv: number | null;
  expectedMove: number | null;
  safetyRatio: number | null;
  bbPctB: number | null;
  sharesOwned: number;
  maxContracts: number;
  distanceOtm: number;
  score: number;
  // Spread-specific fields (optional, only present for bear call spreads)
  spreadType?: 'bear-call';
  spreadWidth?: number;
  longStrike?: number;
  longPremium?: number;
  longBid?: number;
  longAsk?: number;
  longDelta?: number;
  netCredit?: number;
  capitalAtRisk?: number;
  maxProfit?: number;
  maxLoss?: number;
  spreadROC?: number;
  breakeven?: number;
  profitZoneWidth?: number;
  comparisonCC?: {
    collateral: number;
    premium: number;
    roc: number;
    capitalSavings: number;
    capitalSavingsPct: number;
  };
  // Source account for this opportunity (used for multi-account order routing)
  accountNumber?: string;
};

export default function CCDashboard() {
   const { selectedAccountId } = useAccount();
  const getAccountLabel = useAccountNicknames();
  const isMobile = useIsMobile();
  const { mode: tradingMode } = useTradingMode();
  const utils = trpc.useUtils();
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [, setTimeTick] = useState(0);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [breakdown, setBreakdown] = useState<PositionBreakdown | null>(null);
  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);
  const [isPositionsSectionExpanded, setIsPositionsSectionExpanded] = useState(true);
  const [isPositionsSectionCollapsed, setIsPositionsSectionCollapsed] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<CCOpportunity[]>([]);
  // Store selected opportunities by unique key (symbol-strike-expiration) instead of index
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  
  // Helper function to create unique key for an opportunity
  // Include longStrike to differentiate between CC (no long leg) and Bear Call Spreads (has long leg)
  const getOpportunityKey = (opp: CCOpportunity) => {
    if (opp.longStrike && opp.longStrike > 0) {
      // Bear Call Spread: include both short and long strikes
      return `${opp.symbol}-${opp.strike}-${opp.longStrike}-${opp.expiration}`;
    }
    // Regular Covered Call: just symbol-strike-expiration
    return `${opp.symbol}-${opp.strike}-${opp.expiration}`;
  };
  const [presetFilter, setPresetFilter] = useState<'conservative' | 'medium' | 'aggressive' | null>(null);
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortColumn, setSortColumn] = useState<keyof CCOpportunity | null>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  // Exchange-group filter: null = show all, 'CBOE' = show only CBOE, 'Nasdaq' = show only Nasdaq
  const [activeExchangeFilter, setActiveExchangeFilter] = useState<string | null>(null);
  const [showAllHoldings, setShowAllHoldings] = useState(false);
  // Strategy type and spread width
  // Load strategy type from localStorage on page load
  const [strategyType, setStrategyType] = useState<StrategyType>(() => {
    const saved = localStorage.getItem('cc-strategy-type');
    return (saved === 'spread' ? 'spread' : 'cc') as StrategyType;
  });
  const [spreadWidth, setSpreadWidth] = useState<SpreadWidth>(5);
  // Per-symbol spread width overrides for index mode
  const [symbolWidths, setSymbolWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('cc-symbol-widths');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  // Persist symbolWidths to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('cc-symbol-widths', JSON.stringify(symbolWidths));
    } catch { /* ignore */ }
  }, [symbolWidths]);
  // Column visibility (BCS vs CC mode)
  const [bcsVisibleCols, setBcsColVisible, setBcsAllCols, resetBcsCols] = useColumnVisibility(BCS_COLUMNS, 'prosper_col_vis_bcs');
  const [ccVisibleCols, setCcColVisible, setCcAllCols, resetCcCols] = useColumnVisibility(CC_COLUMNS, 'prosper_col_vis_cc');
  const visibleCols = strategyType === 'spread' ? bcsVisibleCols : ccVisibleCols;
  const setColVisible = strategyType === 'spread' ? setBcsColVisible : setCcColVisible;
  const resetCols = strategyType === 'spread' ? resetBcsCols : resetCcCols;
  const currentColDefs = strategyType === 'spread' ? BCS_COLUMNS : CC_COLUMNS;

  const [strategyPanelCollapsed, setStrategyPanelCollapsed] = useState(false);
  const [showSpreadHelp, setShowSpreadHelp] = useState(false);
  const [watchlistSymbolCount, setWatchlistSymbolCount] = useState(0);
  // Live range filters
  const [deltaRange, setDeltaRange] = useState<[number, number]>([0, 1]);
  const [dteRange, setDteRange] = useState<[number, number]>([0, 90]);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [showTechnicalColumns, setShowTechnicalColumns] = useState(true);
  
  // Fetch Options state variables
  const [portfolioSizeFilter, setPortfolioSizeFilter] = useState<Array<'small' | 'medium' | 'large'>>(['small', 'medium', 'large']);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [fetchOptionsOpen, setFetchOptionsOpen] = useState(() => localStorage.getItem('prosper_fetchOptions_bcs') === 'true');
  const [filtersOpen, setFiltersOpen] = useState(() => localStorage.getItem('prosper_filters_bcs') !== 'false');
  const [minDte, setMinDte] = useState<number>(7);
  const [maxDte, setMaxDte] = useState<number>(30);
  // Watchlist context mode: read from Strategy Advisor passthrough if present
  const [watchlistContextMode, setWatchlistContextMode] = useState<'equity' | 'index'>(() => {
    const advisorScanType = localStorage.getItem('strategyAdvisorScanType');
    if (advisorScanType === 'index') return 'index';
    return 'equity';
  });
  // Derived: are we in index mode?
  const isIndexMode = watchlistContextMode === 'index';
  // Auto-switch spread width when entering/leaving index mode
  useEffect(() => {
    if (isIndexMode && strategyType === 'spread') {
      setSpreadWidth(prev => (prev <= 10 ? 25 : prev as SpreadWidth));
    } else if (!isIndexMode && strategyType === 'spread') {
      setSpreadWidth(prev => (prev >= 25 ? 5 : prev as SpreadWidth));
    }
  }, [isIndexMode, strategyType]);
  
  // Safeguard warning state
  const [showSafeguardModal, setShowSafeguardModal] = useState(false);
  const [safeguardWarnings, setSafeguardWarnings] = useState<SafeguardWarning[]>([]);
  const [pendingOrderDescription, setPendingOrderDescription] = useState('');
  const [pendingOrderAction, setPendingOrderAction] = useState<(() => void) | null>(null);

  // Order preview dialog state
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  
  // Lifted state for modal persistence (prevents reset on parent re-render)
  const [modalSubmissionComplete, setModalSubmissionComplete] = useState(false);
  const [modalFinalOrderStatus, setModalFinalOrderStatus] = useState<string | null>(null);
  
  // Order Status Modal state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [submissionStatuses, setSubmissionStatuses] = useState<OrderSubmissionStatus[]>([]);
  
  // Fetch progress dialog state
  const [fetchProgress, setFetchProgress] = useState<{
    isOpen: boolean;
    startTime: number | null;
    endTime: number | null;
    current: number;
    total: number;
  }>({ isOpen: false, startTime: null, endTime: null, current: 0, total: 0 });
  
  // AI Analysis Modal state
  const [showAiAnalysisModal, setShowAiAnalysisModal] = useState(false);
  const [showAIAdvisor, setShowAIAdvisor] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<{ symbol: string; strike?: number; currentPrice?: number } | null>(null);
  const [selectedAiAnalysis, setSelectedAiAnalysis] = useState<{
    symbol: string;
    shortStrike: number;
    longStrike: number;
    score: number;
    explanation: string | any;
  } | null>(null);
  const [analyzingRowKey, setAnalyzingRowKey] = useState<string | null>(null);
  
  const filtersRef = useRef<HTMLDivElement>(null);

  // Fetch filter presets from database
  // Use BCS presets for bear call spreads, CC presets for covered calls
  const { data: presets } = strategyType === 'spread' 
    ? trpc.bcsFilters.getPresets.useQuery()
    : trpc.ccFilters.getPresets.useQuery();

  // Fetch watchlist for the index breakdown panel (BCS index mode)
  const { data: watchlistData = [] } = trpc.watchlist.get.useQuery();
  // Pre-populate symbolWidths with minW defaults for any index symbol not yet explicitly set.
  // This ensures the visual default (symbolWidths[sym] ?? minW) matches what is actually sent
  // to the API — without this, a symbol that was never clicked stays undefined in state and
  // falls through to the auto-scale formula (which returns 25pt for SPX instead of 50pt).
  useEffect(() => {
    if (!isIndexMode || strategyType !== 'spread' || (watchlistData as any[]).length === 0) return;
    const indexSymbols = (watchlistData as any[])
      .filter((w: any) => !!w.isIndex)
      .map((w: any) => w.symbol as string)
      .filter((s: string) => getIndexExchange(s) !== 'Equity');
    setSymbolWidths(prev => {
      const next = { ...prev };
      let changed = false;
      for (const sym of indexSymbols) {
        if (next[sym] === undefined) {
          next[sym] = getMinSpreadWidth(sym);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [isIndexMode, strategyType, watchlistData]);
  // Fetch account balances for buying power
  const { data: balances } = trpc.account.getBalances.useQuery(
    { accountNumber: selectedAccountId || '' },
    { enabled: !!selectedAccountId && tradingMode === 'live' }
  );

  // Fetch paper trading balance
  const { data: paperBalance } = trpc.paperTrading.getBalance.useQuery(
    undefined,
    { enabled: tradingMode === 'paper' }
  );

  // AI Score Explanation mutations
  const explainCCScore = trpc.cc.explainCCScore.useMutation({
    onSuccess: (data) => {
      setSelectedAiAnalysis(data as any);
      setShowAiAnalysisModal(true);
      setAnalyzingRowKey(null);
    },
    onError: (error: any) => {
      toast.error(`Failed to generate explanation: ${error.message}`);
      setAnalyzingRowKey(null);
    },
  });

  const explainBCSScore = trpc.cc.explainBCSScore.useMutation({
    onSuccess: (data) => {
      setSelectedAiAnalysis(data);
      setShowAiAnalysisModal(true);
      setAnalyzingRowKey(null);
    },
    onError: (error: any) => {
      toast.error(`Failed to generate explanation: ${error.message}`);
      setAnalyzingRowKey(null);
    },
  });

  // Calculate available buying power based on trading mode
  const availableBuyingPower = tradingMode === 'paper'
    ? (paperBalance?.buyingPower || 0)
    : Math.max(parseFloat(String(balances?.['cash-buying-power'] || '0')), parseFloat(String(balances?.['derivative-buying-power'] || '0')));

  const filteredOpportunities = useMemo(() => {
    let filtered = [...opportunities];

    // Apply preset filter from database
    if (presetFilter && presets) {
      const preset = presets.find((p: any) => p.presetName === presetFilter);
      if (preset) {
        filtered = filtered.filter(opp => {
          const delta = Math.abs(opp.delta);
          const minDelta = parseFloat(preset.minDelta);
          const maxDelta = parseFloat(preset.maxDelta);
          
          // Delta filter
          if (delta < minDelta || delta > maxDelta) return false;
          
          // Open Interest filter
          if (opp.openInterest < preset.minOpenInterest) return false;
          
          // Volume filter
          if (opp.volume < preset.minVolume) return false;
          
          // Score filter
          if (preset.minScore && opp.score < preset.minScore) return false;
          
          // RSI filter (if available)
          if (opp.rsi !== null && preset.minRsi !== null && preset.maxRsi !== null) {
            if (opp.rsi < preset.minRsi || opp.rsi > preset.maxRsi) return false;
          }
          
          // IV Rank filter (if available)
          if (opp.ivRank !== null && preset.minIvRank !== null && preset.maxIvRank !== null) {
            if (opp.ivRank < preset.minIvRank || opp.ivRank > preset.maxIvRank) return false;
          }
          
          // BB %B filter (if available)
          if (opp.bbPctB !== null && preset.minBbPercent !== null && preset.maxBbPercent !== null) {
            const minBb = parseFloat(preset.minBbPercent);
            const maxBb = parseFloat(preset.maxBbPercent);
            if (opp.bbPctB < minBb || opp.bbPctB > maxBb) return false;
          }
          
          return true;
        });
      }
    }

    // Apply score filter
    if (minScore !== undefined) {
      filtered = filtered.filter(opp => opp.score >= minScore);
    }

    // Apply live range filters
    filtered = filtered.filter(opp => {
      const delta = Math.abs(opp.delta);
      
      // Delta range filter
      if (delta < deltaRange[0] || delta > deltaRange[1]) return false;
      
      // DTE range filter
      if (opp.dte < dteRange[0] || opp.dte > dteRange[1]) return false;
      
      // Score range filter
      if (opp.score < scoreRange[0] || opp.score > scoreRange[1]) return false;
      
      return true;
    });

    // Apply exchange-group filter (from clickable index cards)
    if (activeExchangeFilter) {
      filtered = filtered.filter(opp => {
        const exch = getIndexExchange((opp as any).symbol);
        return exch === activeExchangeFilter;
      });
    }

    return filtered;
  }, [opportunities, presetFilter, presets, minScore, deltaRange, dteRange, scoreRange, activeExchangeFilter]);
  // Calculate summary metrics for selected opportunities
  const selectedOppsList = Array.from(selectedOpportunities)
    .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
    .filter((opp): opp is CCOpportunity => opp !== undefined);
  
  // PREMIUM MULTIPLIER RULE: MULTIPLY
  // Context: Dashboard top card "Total Premium"
  // Reason: Show total money user will receive (not per-share)
  // Example: $1.4750/share × 100 shares = $147.50 total credit per contract
  // For spreads, use netCredit; for CC, use premium
  const totalPremium = strategyType === 'spread'
    ? selectedOppsList.reduce((sum, opp) => sum + ((opp.netCredit || 0) * 100), 0)
    : selectedOppsList.reduce((sum, opp) => sum + (opp.premium * 100), 0);
  
  // For spreads, use capitalAtRisk; for covered calls, use stock value
  const totalCollateral = strategyType === 'spread'
    ? selectedOppsList.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
    : selectedOppsList.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
  
  const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;
  const buyingPowerUsedPct = availableBuyingPower > 0 ? (totalCollateral / availableBuyingPower) * 100 : 0;
  const overLimit = totalCollateral > availableBuyingPower ? totalCollateral - availableBuyingPower : 0;

  // Fetch eligible positions across ALL accounts
  const formatRelativeTime = (date: Date | null): string => {
    if (!date) return '';
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin === 1) return '1 min ago';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    return diffHr === 1 ? '1 hr ago' : `${diffHr} hr ago`;
  };

  const fetchPositions = async () => {
    setIsLoadingPositions(true);
    try {
      const result = await utils.client.cc.getEligiblePositionsAllAccounts.query();
      setHoldings(result.holdings as Holding[]);
      setBreakdown(result.breakdown);
      setSelectedStocks([]);
      setLastFetchedAt(new Date());
      const acctCount = result.accountsScanned.filter((a: string) => a !== 'paper').length;
      const acctLabel = acctCount > 1 ? `${acctCount} accounts` : (result.accountsScanned[0] || 'account');
      toast.success(`Found ${result.breakdown.eligiblePositions} eligible positions across ${acctLabel}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to fetch positions");
    } finally {
      setIsLoadingPositions(false);
    }
  };

  // Mutation for selecting watchlist tickers
  const selectAll = trpc.watchlist.selectAll.useMutation({
    onSuccess: () => {
      utils.watchlist.getSelections.invalidate();
    },
  });

  // Check for Strategy Advisor pre-selected tickers and pre-select them (no auto-fetch)
  useEffect(() => {
    const selectedTickers = localStorage.getItem('strategyAdvisorSelectedTickers');
    const autoFetch = localStorage.getItem('strategyAdvisorAutoFetch');
    
    if (selectedTickers && autoFetch === 'true') {
      try {
        const tickers = JSON.parse(selectedTickers);
        if (tickers.length > 0) {
          // Clear the flags (including scan type passthrough)
          localStorage.removeItem('strategyAdvisorSelectedTickers');
          localStorage.removeItem('strategyAdvisorAutoFetch');
          localStorage.removeItem('strategyAdvisorScanType');
          
          // Show toast with ticker list
          toast.success(`Loaded ${tickers.length} ticker${tickers.length > 1 ? 's' : ''} from Strategy Advisor: ${tickers.join(', ')}. Click "Fetch Opportunities" when ready.`, {
            duration: 5000,
          });
          
          // Pre-select only the tickers from Strategy Advisor
          setTimeout(() => {
            selectAll.mutate({ symbols: tickers });
          }, 500);
        }
      } catch (e) {
        console.error('Failed to parse Strategy Advisor selected tickers:', e);
      }
    }
  }, []);
  
  // Show toast notification on page load if strategy was just changed
  useEffect(() => {
    const justSwitched = sessionStorage.getItem('strategy-just-switched');
    if (justSwitched === 'true') {
      sessionStorage.removeItem('strategy-just-switched');
      toast.info('Strategy changed', {
        description: `Switched to ${strategyType === 'cc' ? 'Covered Call' : 'Bear Call Spread'}. Ready for fresh analysis.`
      });
    }
  }, []); // Run once on mount

  // Auto-fetch positions on mount (both live and paper modes)
  useEffect(() => {
    if (holdings.length === 0 && !isLoadingPositions) {
      fetchPositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

   // Also re-fetch when trading mode changes
  useEffect(() => {
    if (holdings.length === 0 && !isLoadingPositions) {
      fetchPositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingMode]);

  // Auto-refresh positions every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isLoadingPositions) fetchPositions();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingPositions]);

  // Tick every 30 seconds to update the relative time display
  useEffect(() => {
    const interval = setInterval(() => setTimeTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Handle stock selection
  const toggleStockSelection = (symbol: string) => {
    setSelectedStocks(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const selectAllStocks = () => {
    // Use availableHoldings which respects the showAllHoldings toggle
    const eligibleSymbols = availableHoldings
      .filter(h => !flaggedSymbols.has(h.symbol.toUpperCase()))
      .map(h => h.symbol);
    setSelectedStocks(eligibleSymbols);
  };

  const selectAllOpportunities = () => {
    const selectedKeys = new Set<string>();

    if (strategyType === 'spread') {
      // Bear call spreads: no stock ownership required, select all filtered opportunities
      filteredOpportunities.forEach((opp) => {
        selectedKeys.add(getOpportunityKey(opp));
      });
      setSelectedOpportunities(selectedKeys);
      toast.success(`Selected ${selectedKeys.size} bear call spread opportunities`);
    } else {
      // Covered calls: check stock ownership and contract limits
      const contractsUsedPerSymbol: Record<string, number> = {};

      filteredOpportunities.forEach((opp) => {
        const holding = holdings.find(h => h.symbol === opp.symbol);
        if (!holding) return;

        const usedContracts = contractsUsedPerSymbol[opp.symbol] || 0;
        if (usedContracts < holding.maxContracts) {
          selectedKeys.add(getOpportunityKey(opp));
          contractsUsedPerSymbol[opp.symbol] = usedContracts + 1;
        }
      });

      setSelectedOpportunities(selectedKeys);

      // Show toast if some opportunities were skipped
      const skipped = filteredOpportunities.length - selectedKeys.size;
      if (skipped > 0) {
        toast.info(
          `Selected ${selectedKeys.size} opportunities. ` +
          `Skipped ${skipped} due to contract availability limits.`
        );
      }
    }
  };

  const clearOpportunitySelection = () => {
    setSelectedOpportunities(new Set());
  };

  const clearSelection = () => {
    setSelectedStocks([]);
  };

  // Countdown timer effect - removed, using LiveCountdown component instead

  // Scan for opportunities (CC mode uses stock positions, spread mode uses watchlist)
  const scanOpportunities = async () => {
    setIsScanning(true);
    setScanStartTime(Date.now());
    setScanProgress(0);
    
    try {
      let finalOpportunities = [];

      if (strategyType === 'spread') {
        // Bear Call Spread mode: scan watchlist symbols
        const watchlistResult = await utils.client.watchlist.get.query();
        const selectionsResult = await utils.client.watchlist.getSelections.query();
        
        // Filter to only selected tickers that match the current mode (equity vs index)
        const modeFilteredWatchlist = watchlistResult.filter((item: any) => !!item.isIndex === isIndexMode);
        const selectedSymbols = modeFilteredWatchlist
          .filter((item: any) => {
            const selection = selectionsResult.find((s: any) => s.symbol === item.symbol);
            return selection && selection.isSelected === 1;
          })
          .map((item: any) => item.symbol);
        
        const watchlistSymbols = selectedSymbols.length > 0 ? selectedSymbols : modeFilteredWatchlist.map((item: any) => item.symbol);
        setWatchlistSymbolCount(watchlistSymbols.length);

        if (watchlistSymbols.length === 0) {
          toast.error("No symbols in watchlist. Please add symbols to scan for bear call spreads.");
          setIsScanning(false);
          return;
        }
        
        if (selectedSymbols.length > 0 && selectedSymbols.length < watchlistResult.length) {
          toast.info(`Scanning ${selectedSymbols.length} selected tickers (${watchlistResult.length - selectedSymbols.length} not selected)`);
        }

        // Scan watchlist for call opportunities first
        const ccOpportunities = await utils.client.cc.scanOpportunities.mutate({
          symbols: watchlistSymbols,
          holdings: [], // No holdings needed for bear call spreads
          minDte: 7,
          maxDte: 45,
          minDelta: 0.05,
          maxDelta: 0.99,
        });

        // Calculate bear call spreads
        const spreadResult = await utils.client.cc.bearCallSpreadOpportunities.mutate({
          ccOpportunities,
          spreadWidth,
          symbolWidths: Object.keys(symbolWidths).length > 0 ? symbolWidths : undefined,
          isIndexMode, // Pass index mode flag for index-appropriate scoring
        });
        finalOpportunities = spreadResult;
      } else {
         // CC mode: scan stock positions
        // Allow scanning all selected stocks regardless of maxContracts
        // (Tastytrade API may lag after buying back CCs — user can force-scan via "All Holdings" toggle)
        const eligibleStocks = selectedStocks.filter(symbol =>
          holdings.some(h => h.symbol === symbol)
        );
        if (eligibleStocks.length === 0) {
          toast.error("No stocks selected. Please select stocks to scan.");
          setIsScanning(false);
          return;
        }
        // Build holdings data for selected stocks
        const selectedHoldings = holdings
          .filter(h => eligibleStocks.includes(h.symbol))
          .map(h => ({
            symbol: h.symbol,
            quantity: h.quantity,
            currentPrice: h.currentPrice,
            maxContracts: h.maxContracts,
          }));

        const rawOpportunities = await utils.client.cc.scanOpportunities.mutate({
          symbols: eligibleStocks,
          holdings: selectedHoldings,
          minDte: 7,
          maxDte: 45,
          minDelta: 0.05,
          maxDelta: 0.99,
        });

        // Attach the source account to each opportunity for multi-account order routing.
        // Use accountBreakdown to pick the account that actually has available contracts.
        // CRITICAL: If no account has available contracts, the opportunity is filtered OUT.
        // Falling back to a wrong account causes Tastytrade to reject the order as
        // "uncovered options" (e.g. NEM held in HELOC but order routed to Main Cash).
        finalOpportunities = rawOpportunities
          .map((opp: CCOpportunity) => {
            const holding = holdings.find(h => h.symbol === opp.symbol);
            let bestAccount: string | undefined = undefined;
            if (holding?.accountBreakdown) {
              // Pick the first account with available contracts (maxContracts > 0)
              const accountWithContracts = Object.entries(holding.accountBreakdown)
                .find(([, available]) => available > 0);
              if (accountWithContracts) {
                bestAccount = accountWithContracts[0];
              }
              // If no account has available contracts, bestAccount stays undefined
              // and this opportunity will be filtered out below.
            } else if (holding?.accounts?.[0]) {
              // No breakdown available — use the first account that holds the symbol
              bestAccount = holding.accounts[0];
            } else {
              // No holding info at all — use the selected account as last resort
              bestAccount = selectedAccountId ?? undefined;
            }
            return {
              ...opp,
              accountNumber: bestAccount,
            };
          })
          // Remove opportunities where no account has available contracts.
          // These are fully-covered positions — showing them only leads to TT rejections.
          .filter((opp: CCOpportunity) => opp.accountNumber !== undefined);
      }

      setOpportunities(finalOpportunities);
      setSelectedOpportunities(new Set());
      
      // Collapse positions section and scroll to opportunities
      setIsPositionsSectionCollapsed(true);
      setIsPositionsSectionExpanded(false);
      
      setTimeout(() => {
        filtersRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      setScanProgress(100);
      toast.success(`Found ${finalOpportunities.length} opportunities`);
    } catch (error: any) {
      toast.error(error.message || "Failed to scan opportunities");
    } finally {
      setIsScanning(false);
      setScanStartTime(null);
      setScanProgress(0);
    }
  };

  // Toggle opportunity selection
  const toggleOpportunitySelection = (opp: CCOpportunity) => {
    const oppKey = getOpportunityKey(opp);
    
    setSelectedOpportunities(prev => {
      const newSet = new Set(prev);
      if (newSet.has(oppKey)) {
        newSet.delete(oppKey);
      } else {
        // For bear call spreads, no stock ownership validation needed
        if (strategyType === 'spread') {
          newSet.add(oppKey);
        } else {
          // For covered calls, check if adding this opportunity would exceed available contracts
          const holding = holdings.find(h => h.symbol === opp.symbol);
          if (!holding) {
            toast.error(`Position not found for ${opp.symbol}`);
            return prev;
          }

          // Count how many opportunities are already selected for this symbol
          const selectedForSymbol = Array.from(newSet).filter(key => {
            return key.startsWith(`${opp.symbol}-`);
          }).length;

          if (selectedForSymbol >= holding.maxContracts) {
            toast.error(
              `Cannot select more ${opp.symbol} opportunities. ` +
              `You have ${holding.maxContracts} available contracts (${holding.quantity} shares).`
            );
            return prev;
          }

          newSet.add(oppKey);
        }
      }
      return newSet;
    });
  };

  // Get score color
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-amber-400';
    if (score >= 70) return 'text-green-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Get score badge variant
  const getScoreBadgeClass = (score: number) => {
    if (score >= 80) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (score >= 60) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  };

  // Handle preset filter button click
  const handlePresetFilter = (preset: 'conservative' | 'medium' | 'aggressive') => {
    setPresetFilter(preset);
    setMinScore(undefined); // Clear score filter when using preset
  };

  // Handle score button click
  const handleScoreFilter = (score: number) => {
    setMinScore(score);
    setPresetFilter(null); // Clear preset when using score filter
  };

  // Apply preset filters

  // Handle sorting
  const handleSort = (column: keyof CCOpportunity) => {
    if (sortColumn === column) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to descending
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Sort opportunities based on current sort state
  const sortedOpportunities = useMemo(() => {
    let opps = filteredOpportunities;
    
    // Apply "Show Selected Only" filter
    if (showSelectedOnly) {
      opps = opps.filter((opp) => {
        const oppKey = getOpportunityKey(opp);
        return selectedOpportunities.has(oppKey);
      });
    }
    
    // Sort if column is selected
    if (!sortColumn) return opps;

    return [...opps].sort((a, b) => {
      // Virtual sort keys that don't map 1:1 to object fields
      const col = sortColumn as string;
      const getVal = (opp: CCOpportunity) => {
        if (col === 'width') return symbolWidths[(opp as any).symbol] ?? getMinSpreadWidth((opp as any).symbol);
        if (col === 'spreadROC') return (opp as any).spreadROC ?? (opp as any).roc ?? 0;
        return (opp as any)[col];
      };
      const aVal = getVal(a);
      const bVal = getVal(b);

      // Handle null/undefined values
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredOpportunities, sortColumn, sortDirection, showSelectedOnly, selectedOpportunities]);

  // Handle order submission - shows preview dialog first
  const handleSubmitOrders = () => {
    if (selectedOpportunities.size === 0) {
      toast.error("Please select at least one opportunity");
      return;
    }

    if (!selectedAccountId) {
      toast.error("Please select an account");
      return;
    }

    // Map selected keys back to opportunity objects
    const selectedOpps = Array.from(selectedOpportunities)
      .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
      .filter((opp): opp is CCOpportunity => opp !== undefined);

    // Build UnifiedOrder array for UnifiedOrderPreviewModal
    const orders: UnifiedOrder[] = selectedOpps.map(opp => ({
      symbol: opp.symbol,
      strike: opp.strike,
      expiration: opp.expiration,
      // For spreads, use netCredit; for CC, use premium
      premium: strategyType === 'spread' ? (opp.netCredit || 0) : opp.premium,
      action: "STO" as const, // Sell to Open for CC and BCS
      optionType: "CALL" as const,
      // For spreads, include long leg with bid/ask for net credit range calculation
      longStrike: strategyType === 'spread' ? opp.longStrike : undefined,
      longPremium: strategyType === 'spread' ? (opp.longAsk || 0) : undefined,
      longBid: strategyType === 'spread' ? opp.longBid : undefined,
      longAsk: strategyType === 'spread' ? opp.longAsk : undefined,
      // For spreads, pass short leg bid/ask so modal can calculate net credit range
      bid: strategyType === 'spread' ? opp.bid : opp.bid,
      ask: strategyType === 'spread' ? opp.ask : opp.ask,
      currentPrice: opp.currentPrice,
      // OCC option symbol for live quote fetching in the preview modal
      optionSymbol: (opp as any).optionSymbol as string | undefined,
      // For BCS spreads: long leg OCC symbol so modal can fetch live net credit
      spreadLongSymbol: strategyType === 'spread' ? ((opp as any).longOptionSymbol as string | undefined) : undefined,
      // Pass per-order account for multi-account CC routing and safeguard checks
      accountNumber: opp.accountNumber,
    }));

     // Set orders for preview dialog
    setUnifiedOrders(orders);
    // Reset submission state so the modal always opens in dry-run mode for a new batch
    setModalSubmissionComplete(false);
    setModalFinalOrderStatus(null);

    // ── Safeguard 3: Coverage ratio check before showing preview ──
    // Run a quick client-side coverage check using the data we already have
    const coverageViolations: SafeguardWarning[] = [];
    if (strategyType === 'cc') {
      for (const opp of selectedOpps) {
        const holding = holdings.find(h => h.symbol === opp.symbol);
        if (holding) {
          const requestedContracts = 1; // Each opportunity is 1 contract
          if (requestedContracts > holding.maxContracts) {
            coverageViolations.push({
              safeguard: 3,
              severity: 'block',
              accountNumber: selectedAccountId,
              symbol: opp.symbol,
              title: `⛔ Coverage Violation — ${opp.symbol}: No available contracts`,
              description: `You own ${holding.quantity} shares of ${opp.symbol} but ${holding.existingContracts} contract${holding.existingContracts !== 1 ? 's are' : ' is'} already sold. No shares available to cover a new call.`,
              requiredAction: `Close an existing covered call on ${opp.symbol} first, or remove this order from your selection.`,
              sharesOwned: holding.quantity,
              sharesNeeded: 100,
              contractsRequested: requestedContracts,
            });
          }
        }
      }
    }

    if (coverageViolations.length > 0) {
      // Show safeguard modal instead of proceeding
      const orderDesc = selectedOpps.map(o => `${o.symbol} $${o.strike} Call`).join(', ');
      setSafeguardWarnings(coverageViolations);
      setPendingOrderDescription(orderDesc);
      setPendingOrderAction(null); // Blocked — no proceed action
      setShowSafeguardModal(true);
      return;
    }

    setShowPreviewDialog(true);
  };

  // Execute order submission after preview confirmation
  // Signature matches UnifiedOrderPreviewModal onSubmit callback
  const executeOrderSubmission = async (
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    isDryRun: boolean
  ): Promise<{ results: any[] }> => {
    // Modal stays open for both dry run and live submission
    setIsSubmitting(true);

    if (orders.length === 0) {
      toast.error("No orders to submit");
      setIsSubmitting(false);
      return { results: [] };
    }

    // Show initial progress toast
    const orderCount = orders.length;
    toast.loading(
      isDryRun 
        ? `Validating ${orderCount} order${orderCount > 1 ? 's' : ''}...`
        : `Submitting ${orderCount} order${orderCount > 1 ? 's' : ''}...`,
      { id: 'cc-order-submission-progress' }
    );

    try{
      let results;
      
      if (strategyType === 'spread') {
        // Bear call spread orders
        const spreadOrders = orders.map((order, idx) => {
          const orderKey = `${order.symbol}-${order.strike}-${order.expiration}`;
          const quantity = quantities.get(orderKey) || 1;
          
          return {
            symbol: order.symbol,
            shortStrike: order.strike,
            longStrike: order.longStrike!,
            expiration: order.expiration,
            quantity,
            netCredit: order.premium, // Already in dollars per share
          };
        });

        results = await utils.client.cc.submitBearCallSpreadOrders.mutate({
          accountNumber: selectedAccountId!,
          orders: spreadOrders,
          dryRun: isDryRun,
        });
      } else {
        // Regular CC orders
        const ccOrders = orders.map((order) => {
          const orderKey = `${order.symbol}-${order.strike}-${order.expiration}`;
          const quantity = quantities.get(orderKey) || 1;
          // Round to nearest $0.05 increment (nickels) as required by Tastytrade
          const roundedPrice = Math.round(order.premium / 0.05) * 0.05;
          
          return {
            symbol: order.symbol,
            strike: order.strike,
            expiration: order.expiration,
            quantity,
            price: roundedPrice,
            // Pass per-order account for multi-account routing
            accountNumber: order.accountNumber,
          };
        });

        results = await utils.client.cc.submitOrders.mutate({
          accountNumber: selectedAccountId!,
          orders: ccOrders,
          dryRun: isDryRun,
        });
      }

      // Dismiss progress toast
      toast.dismiss('cc-order-submission-progress');

      const successCount = results.filter((r: any) => r.success).length;
      const failedCount = results.filter((r: any) => !r.success).length;

      if (failedCount === 0) {
        if (isDryRun) {
          toast.success(`✓ ${results.length} order${results.length > 1 ? 's' : ''} validated successfully (Dry Run)`, {
            duration: 4000,
          });
        } else {
          // Success toast removed - modal will handle polling and confetti
          // Clear selections after successful submission
          setSelectedOpportunities(new Set());
        }
      } else {
        if (isDryRun) {
          if (successCount > 0) {
            toast.warning(`⚠️ ${successCount} order(s) validated, ${failedCount} failed validation (Dry Run)`, {
              duration: 6000,
            });
          } else {
            toast.error(`❌ ${failedCount} order(s) failed validation (Dry Run)`, {
              duration: 6000,
            });
          }
        } else {
          if (successCount > 0) {
            toast.warning(`⚠️ ${successCount} order(s) submitted, ${failedCount} failed to submit`, {
              duration: 6000,
            });
          } else {
            toast.error(`❌ ${failedCount} order(s) failed to submit`, {
              duration: 6000,
            });
          }
        }
      }
      
      // For LIVE submissions: close preview modal and open status modal
      if (!isDryRun && results) {
        // Map results to OrderSubmissionStatus format
        const statuses: OrderSubmissionStatus[] = results.map((result: any, index: number) => {
          const order = orders[index];
          // If the submission failed (success === false), show Rejected immediately
          // with the actual Tastytrade error message — do NOT poll for status.
          if (result.success === false) {
            return {
              orderId: 'FAILED',
              symbol: result.symbol || order?.symbol || 'Unknown',
              status: 'Rejected' as const,
              message: result.message || 'Order rejected by Tastytrade',
            };
          }
          return {
            orderId: result.orderId || result.id || '',
            symbol: result.symbol || order?.symbol || 'Unknown',
            status: result.status === 'Received' ? 'Working' as const : 
                   result.status === 'Filled' ? 'Filled' as const :
                   result.status === 'Rejected' ? 'Rejected' as const :
                   result.message?.includes('market') || result.message?.includes('closed') ? 'MarketClosed' as const :
                   'Pending' as const,
            message: result.message || `${order?.strike} strike ${order?.expiration} - ${result.status || 'Submitted'}`,
          };
        });
        
        // Close preview modal
        setShowPreviewDialog(false);
        
        // Open status modal with results
        setSubmissionStatuses(statuses);
        setShowStatusModal(true);
      }
      
      // Return results for modal polling
      return { results };
    } catch (error: any) {
      // Dismiss progress toast
      toast.dismiss('cc-order-submission-progress');
      toast.error(error.message || "Failed to submit orders", {
        duration: 6000,
      });
      return { results: [] };
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle order status polling after live submission
  const handlePollStatuses = async (orderIds: string[], accountId: string): Promise<OrderSubmissionStatus[]> => {
    try {
      // Poll each order status — always use ALL_ACCOUNTS so orders submitted
      // to any account are found regardless of the sidebar account selection
      const statusPromises = orderIds.map(orderId => 
        utils.client.orders.pollStatus.mutate({ 
          accountId: 'ALL_ACCOUNTS',
          orderId: orderId.toString() // Ensure orderId is string
        })
      );
      
      const statuses = await Promise.all(statusPromises);
      
      // Map OrderStatus to OrderSubmissionStatus.
      // 'Unknown' means the API couldn't confirm yet — return 'Working' so the
      // client keeps polling instead of showing a false 'Rejected' badge.
      return statuses.map((s: any, index) => {
        const rawStatus = s?.status;
        const mappedStatus =
          rawStatus === 'Filled' ? 'Filled' as const
          : rawStatus === 'Rejected' ? 'Rejected' as const
          : rawStatus === 'Cancelled' ? 'Cancelled' as const
          : rawStatus === 'MarketClosed' ? 'MarketClosed' as const
          : 'Working' as const;
        return {
          orderId: orderIds[index],
          symbol: '',
          status: mappedStatus,
          message: s?.marketClosedMessage || s?.rejectedReason || s?.message
            || (rawStatus === 'Unknown' ? 'Checking order status...' : 'Status unknown'),
        };
      });
    } catch (error: any) {
      console.error('[CC Dashboard] Polling error:', error);
      // Return Working on error so the interval keeps retrying
      return orderIds.map(id => ({
        orderId: id,
        symbol: '',
        status: 'Working' as const,
        message: 'Retrying status check...',
      }));
    }
  };

  // Filter holdings to only show those with available contracts
  // Show all holdings when toggled (e.g. after buying back CCs, Tastytrade API may lag)
  const availableHoldings = showAllHoldings
    ? holdings
    : holdings.filter(h => h.maxContracts > 0);

  // Load liquidation flags so flagged-for-exit positions are visually marked and non-selectable
  const { data: flagsData } = trpc.positionAnalyzer.getLiquidationFlags.useQuery(
    undefined,
    { staleTime: 30 * 1000, enabled: !!selectedAccountId }
  );
  const flaggedSymbols = new Set(
    (flagsData?.flags ?? []).map(f => f.symbol.toUpperCase())
  );

  return (
    <div className="container mx-auto py-4 sm:py-8 space-y-4 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-bold bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 bg-clip-text text-transparent">
            Covered Calls Dashboard
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1 sm:mt-2">
            Generate income with Covered Calls or Bear Call Spreads
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh Page</span>
          </Button>
          <ConnectionStatusIndicator />
        </div>
      </div>

      {/* Strategy Type Selection - Always visible at top */}
      <Card className="bg-card/50 backdrop-blur border-border/50 border-primary/30">
        <CardHeader className="cursor-pointer" onClick={() => setStrategyPanelCollapsed(!strategyPanelCollapsed)}>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Strategy Type
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSpreadHelp(true);
                  }}
                >
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                {strategyPanelCollapsed && (
                  <Badge variant="secondary" className="ml-2">
                    {strategyType === 'cc' ? 'CC Mode' : `Bear Call Spread - ${spreadWidth}pt`}
                  </Badge>
                )}
              </CardTitle>
              {!strategyPanelCollapsed && (
                <CardDescription>
                  Choose between Covered Calls or Bear Call Spreads
                </CardDescription>
              )}
            </div>
            <ChevronDown className={cn(
              "w-5 h-5 text-muted-foreground transition-transform duration-200",
              strategyPanelCollapsed && "rotate-180"
            )} />
          </div>
        </CardHeader>
        {!strategyPanelCollapsed && (
          <CardContent className="space-y-6">
          {/* Strategy Toggle */}
          <div className="flex gap-3">
            <Button
              variant={strategyType === 'cc' ? 'default' : 'outline'}
              onClick={() => {
                if (strategyType !== 'cc') {
                  // Save strategy selection to localStorage
                  localStorage.setItem('cc-strategy-type', 'cc');
                  // Set flag to show toast after reload
                  sessionStorage.setItem('strategy-just-switched', 'true');
                  // Reload page to reset everything
                  window.location.reload();
                }
              }}
              className={cn(
                "flex-1 relative overflow-hidden transition-all duration-300",
                strategyType === 'cc'
                  ? "bg-gradient-to-r from-amber-600 to-yellow-700 hover:from-amber-700 hover:to-yellow-800 text-white shadow-lg"
                  : "hover:bg-amber-500/10 hover:border-amber-500/50"
              )}
            >
              <span className="relative z-10 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-current" />
                Covered Call
              </span>
            </Button>
            <Button
              variant={strategyType === 'spread' ? 'default' : 'outline'}
              onClick={() => {
                if (strategyType !== 'spread') {
                  // Save strategy selection to localStorage
                  localStorage.setItem('cc-strategy-type', 'spread');
                  // Set flag to show toast after reload
                  sessionStorage.setItem('strategy-just-switched', 'true');
                  // Reload page to reset everything
                  window.location.reload();
                }
              }}
              className={cn(
                "flex-1 relative overflow-hidden transition-all duration-300",
                strategyType === 'spread'
                  ? "bg-gradient-to-r from-emerald-600 to-green-700 hover:from-emerald-700 hover:to-green-800 text-white shadow-lg shadow-emerald-500/30"
                  : "hover:bg-emerald-500/10 hover:border-emerald-500/50"
              )}
            >
              <span className="relative z-10 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-current" />
                Bear Call Spread
              </span>
            </Button>
          </div>

          {/* Spread Width Selector (only show when spread selected) */}
          {strategyType === 'spread' && (() => {
            // Compute selected index symbols from watchlist
            const selectedIndexSymbols = (watchlistData as any[])
              .filter((w: any) => !!w.isIndex === isIndexMode)
              .map((w: any) => w.symbol as string)
              .filter((s: string) => getIndexExchange(s) !== 'Equity');
            const multiIndexWarnings = isIndexMode && selectedIndexSymbols.length > 1
              ? validateMultiIndexSelection(selectedIndexSymbols)
              : [];
            const hasNasdaqAndCboe = multiIndexWarnings.some(w => w.severity === 'warning');
            return (
              <div className="space-y-2">
                {/* Compact mixed-exchange inline warning */}
                {hasNasdaqAndCboe && (
                  <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>Mixed exchanges — use the Exchange filter below to submit one group at a time.</span>
                  </p>
                )}
                {/* Compact pre-fetch spread width row */}
                {isIndexMode && selectedIndexSymbols.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-xs text-muted-foreground font-medium">Spread width per index:</span>
                    {selectedIndexSymbols.map((sym: string) => {
                      const minW = getMinSpreadWidth(sym);
                      const widths = [minW, minW * 2, minW * 4].filter(w => w <= 200);
                      const currentW = symbolWidths[sym] ?? minW;
                      return (
                        <div key={sym} className="flex items-center gap-1.5">
                          <span className="text-xs font-medium">{sym}:</span>
                          {widths.map(w => (
                            <button
                              key={w}
                              onClick={() => setSymbolWidths(prev => ({ ...prev, [sym]: w }))}
                              className={cn(
                                "text-xs px-2 py-0.5 rounded border transition-colors",
                                currentW === w
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                              )}
                            >
                              {w}pt
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">Spread width:</span>
                    {([2, 5, 10] as SpreadWidth[]).map(w => (
                      <button
                        key={w}
                        onClick={() => setSpreadWidth(w)}
                        className={cn(
                          "text-xs px-2 py-0.5 rounded border transition-colors",
                          spreadWidth === w
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        )}
                      >
                        {w}pt
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Info banner */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <p className="text-sm text-muted-foreground">
              {strategyType === 'cc' ? (
                <>Covered calls generate income from stocks you own by selling call options above current price</>
              ) : (
                isIndexMode && Object.keys(symbolWidths).length > 0
                  ? <>Bear call spreads — per-index widths: {Object.entries(symbolWidths).map(([s, w]) => `${s}: ${w}pt`).join(', ')}</>
                  : <>Bear call spreads limit risk by buying a protective call at a higher strike ({spreadWidth} points above)</>
              )}
            </p>
          </div>
        </CardContent>
        )}
      </Card>

      {/* Portfolio Positions Section - Only show in CC mode */}
      {strategyType === 'cc' && (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isPositionsSectionCollapsed) {
                  setIsPositionsSectionCollapsed(false);
                  setIsPositionsSectionExpanded(true);
                } else {
                  setIsPositionsSectionExpanded(!isPositionsSectionExpanded);
                }
              }}
            >
              {isPositionsSectionExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
            <h2 className="text-2xl font-semibold text-foreground">
              {isPositionsSectionCollapsed ? (
                <>Portfolio Positions ({breakdown?.eligiblePositions || 0} eligible)</>
              ) : (
                <>Portfolio Positions</>
              )}
            </h2>
          </div>
          {isPositionsSectionCollapsed && (
            <div className="flex items-center gap-2">
              {lastFetchedAt && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Fetched {formatRelativeTime(lastFetchedAt)}
                </span>
              )}
              <Button
                onClick={fetchPositions}
                disabled={isLoadingPositions}
                size="sm"
                variant="outline"
              >
                {isLoadingPositions ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh
              </Button>
            </div>
          )}
        </div>

        {!isPositionsSectionCollapsed && (
          <div className="space-y-6">
            {/* Fetch Positions Button */}
            {!breakdown && (
              <Card className="bg-card/50 backdrop-blur border-amber-500/20">
                <CardContent className="pt-6">
                  <Button
                    onClick={fetchPositions}
                    disabled={isLoadingPositions}
                    className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
                  >
                    {isLoadingPositions ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Fetching Positions...
                      </>
                    ) : (
                      <>
                        <Target className="w-4 h-4 mr-2" />
                        Fetch Portfolio Positions
                      </>
                    )}
                  </Button>
                  <p className="text-sm text-muted-foreground text-center mt-2">
                    Scans all connected Tastytrade accounts automatically
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Last fetched timestamp + refresh in expanded view */}
            {breakdown && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {lastFetchedAt ? `Fetched ${formatRelativeTime(lastFetchedAt)}` : 'Positions loaded'}
                </span>
                <Button
                  onClick={fetchPositions}
                  disabled={isLoadingPositions}
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1.5"
                >
                  {isLoadingPositions ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Refresh
                </Button>
              </div>
            )}
            {/* Position Summary Cards */}
            {breakdown && isPositionsSectionExpanded && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Positions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-blue-400">
                      {breakdown.totalPositions}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Stock Positions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-400">
                      {breakdown.stockPositions}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Existing Calls
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-orange-400">
                      {breakdown.existingShortCalls}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Eligible for CC
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-amber-400">
                      {breakdown.eligiblePositions}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      CC Eligible Contracts
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-purple-400">
                      {breakdown.eligibleContracts}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Skeleton loader while fetching live positions */}
            {isLoadingPositions && holdings.length === 0 && isPositionsSectionExpanded && (
              <Card className="bg-card/50 backdrop-blur border-amber-500/20">
                <CardHeader>
                  <CardTitle className="text-xl">Portfolio Positions</CardTitle>
                  <p className="text-sm text-muted-foreground">Fetching live positions from Tastytrade…</p>
                </CardHeader>
                <CardContent>
                  <PositionTableSkeleton rows={6} cols={6} showHeader={false} />
                </CardContent>
              </Card>
            )}
            {/* Stock Selection Table */}
            {holdings.length > 0 && isPositionsSectionExpanded && (
              <Card className="bg-card/50 backdrop-blur border-amber-500/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl">Select Stocks to Scan</CardTitle>
                      <CardDescription>
                        Choose which positions to scan for covered call opportunities
                      </CardDescription>
                    </div>
                    <div className="flex gap-2 items-center">
                      <Button
                        variant={showAllHoldings ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowAllHoldings(v => !v)}
                        title={showAllHoldings ? "Showing all stock positions (including fully covered)" : "Only showing positions with available contracts"}
                      >
                        {showAllHoldings ? "All Holdings" : "Eligible Only"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={selectAllStocks}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearSelection}
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={availableHoldings.length > 0 && availableHoldings
                              .filter(h => (showAllHoldings || h.maxContracts > 0) && !flaggedSymbols.has(h.symbol.toUpperCase()))
                              .every(h => selectedStocks.includes(h.symbol))}
                            onCheckedChange={(checked) => {
                              const eligible = availableHoldings
                                .filter(h => (showAllHoldings || h.maxContracts > 0) && !flaggedSymbols.has(h.symbol.toUpperCase()))
                                .map(h => h.symbol);
                              if (checked) {
                                const next = new Set(selectedStocks);
                                eligible.forEach(s => next.add(s));
                                setSelectedStocks(Array.from(next));
                              } else {
                                setSelectedStocks(selectedStocks.filter(s => !eligible.includes(s)));
                              }
                            }}
                            aria-label="Select all eligible stocks"
                            className="border-2 border-amber-500/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                          />
                        </TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Accounts</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Market Value</TableHead>
                        <TableHead className="text-right">Coverage</TableHead>
                        <TableHead className="text-right">Available Contracts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availableHoldings.map((holding) => {
                        const isFlaggedForExit = flaggedSymbols.has(holding.symbol.toUpperCase());
                        return (
                        <TableRow key={holding.symbol} className={isFlaggedForExit ? 'opacity-60' : ''}>
                          <TableCell>
                          <Checkbox
                    checked={selectedStocks.includes(holding.symbol)}
                      onCheckedChange={() => !isFlaggedForExit && toggleStockSelection(holding.symbol)}
                      disabled={(!showAllHoldings && holding.maxContracts === 0) || isFlaggedForExit}
                      className="border-2 border-amber-500/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                          </TableCell>
                          <TableCell className="font-semibold">
                            {holding.symbol}
                            {isFlaggedForExit && (
                              <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-red-600/60 bg-red-950/40 text-red-400">
                                ⛔ Flagged for Exit
                              </Badge>
                            )}
                            {!isFlaggedForExit && holding.hasExistingCalls && (
                              <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-blue-500/40 bg-blue-950/30 text-blue-300">
                                Has Calls
                              </Badge>
                            )}
                            {!isFlaggedForExit && holding.hasWorkingOrders && (
                              <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-yellow-500/60 bg-yellow-950/40 text-yellow-400">
                                ⏳ Pending STO
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(holding.accounts ?? [selectedAccountId ?? 'N/A']).map((acct: string) => (
                                <Badge key={acct} variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-300/80" title={acct}>
                                  {getAccountLabel(acct)}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {holding.quantity.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${holding.currentPrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            ${holding.marketValue.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const totalContracts = Math.floor(holding.quantity / 100);
                              const usedContracts = holding.existingContracts + holding.workingContracts;
                              if (totalContracts === 0) return <span className="text-xs text-muted-foreground">—</span>;
                              const isFullyCovered = usedContracts >= totalContracts;
                              const label = isFullyCovered
                                ? `${usedContracts}/${totalContracts} Fully Covered`
                                : usedContracts > 0
                                  ? `${usedContracts}/${totalContracts}`
                                  : `0/${totalContracts}`;
                              return (
                                <span className={`text-xs font-mono ${
                                  isFullyCovered
                                    ? 'text-orange-400 font-semibold'
                                    : usedContracts > 0
                                      ? 'text-yellow-400'
                                      : 'text-muted-foreground'
                                }`}>{label}</span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="secondary"
                              className="bg-amber-500/20 text-amber-400 border-amber-500/30"
                            >
                              {holding.maxContracts}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Scan Button */}
                  <div className="mt-6 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {selectedStocks.length > 0 ? (
                        <>
                          <span className="font-semibold text-amber-400">
                            {selectedStocks.length}
                          </span>{" "}
                          stock{selectedStocks.length !== 1 ? "s" : ""} selected:{" "}
                          {selectedStocks.join(", ")}
                        </>
                      ) : (
                        "No stocks selected"
                      )}
                    </p>
                    <Button
                      disabled={selectedStocks.length === 0 || isScanning}
                      onClick={scanOpportunities}
                      className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
                    >
                      {isScanning ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Scanning...
                        </>
                      ) : (
                        <>
                          <TrendingUp className="w-4 h-4 mr-2" />
                          Scan Selected Stocks
                        </>
                      )}
                    </Button>
                   </div>
                </CardContent>
              </Card>
            )}

            {/* Scanning Progress Dialog */}
            <Dialog open={isScanning} onOpenChange={(open) => {
              if (!open) {
                // Cancel button clicked - abort scan
                setIsScanning(false);
                setScanStartTime(null);
                setScanProgress(0);
                toast.info('Scan cancelled');
              }
            }}>
              <DialogContent className="sm:max-w-md border-2 border-orange-500/50">
                <DialogHeader>
                  <DialogTitle>Scanning Options Chains</DialogTitle>
                  <DialogDescription>
                    Analyzing {selectedStocks.filter(symbol => {
                      const holding = holdings.find(h => h.symbol === symbol);
                      return holding && holding.maxContracts > 0;
                    }).length} stocks for covered call opportunities...
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center justify-center space-y-4 py-6">
                  <Loader2 className="w-12 h-12 animate-spin text-primary" />
                  <Progress value={scanProgress} className="w-full" />
                  <p className="text-sm text-muted-foreground">
                    {scanProgress < 100 ? (
                      <>
                        {Math.floor((100 - scanProgress) * selectedStocks.length * 2.0 / 100)}s remaining
                      </>
                    ) : (
                      <>Finishing up...</>
                    )}
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            {/* No eligible positions message */}
            {breakdown && holdings.length === 0 && isPositionsSectionExpanded && (
              <Card className="bg-card/50 backdrop-blur border-amber-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-muted-foreground">
                    No eligible positions found. You need stock positions with at least 100
                    shares and available contracts (not already covered by calls).
                  </p>
                  <p className="text-sm text-amber-400 mt-2">
                    If you recently bought back covered calls, click <strong>"All Holdings"</strong> above to show all positions and force-scan them.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
      )}

      {/* Watchlist Section - Only show in Bear Call Spread mode */}
      {strategyType === 'spread' && (
        <div className="space-y-6">
          <EnhancedWatchlist 
            isCollapsed={watchlistCollapsed}
            onToggleCollapse={() => setWatchlistCollapsed(!watchlistCollapsed)}
            contextMode={watchlistContextMode}
            onContextModeChange={(mode) => setWatchlistContextMode(mode)}
          />
          
          {/* Fetch Options Section - Only show when watchlist is not collapsed */}
          {!watchlistCollapsed && (
            <Card className="bg-card/50 backdrop-blur border-border/50">
              <CardHeader
                className="cursor-pointer select-none flex flex-row items-center justify-between py-3"
          onClick={() => setFetchOptionsOpen(o => { const next = !o; localStorage.setItem('prosper_fetchOptions_bcs', String(next)); return next; })}
        >
          <div>
            <CardTitle className="text-sm">Fetch Options</CardTitle>
            {!fetchOptionsOpen && <CardDescription className="text-xs">Portfolio size &amp; DTE range</CardDescription>}
                </div>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", fetchOptionsOpen && "rotate-180")} />
              </CardHeader>
              {fetchOptionsOpen && <CardContent className="space-y-4">
                {/* Portfolio Size Filter */}
                <div>
                  <Label className="mb-2 block flex items-center gap-1">
                    Portfolio Size
                  </Label>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPortfolioSizeFilter(prev => 
                          prev.includes('small') 
                            ? prev.filter(s => s !== 'small')
                            : [...prev, 'small']
                        );
                      }}
                      className={cn(
                        "relative overflow-hidden rounded-full px-4 py-2 font-semibold transition-all duration-300",
                        portfolioSizeFilter.includes('small')
                          ? "bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 text-white shadow-lg shadow-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/60 hover:scale-110"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/50 hover:scale-105"
                      )}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                        Small
                      </span>
                      {portfolioSizeFilter.includes('small') && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPortfolioSizeFilter(prev => 
                          prev.includes('medium') 
                            ? prev.filter(s => s !== 'medium')
                            : [...prev, 'medium']
                        );
                      }}
                      className={cn(
                        "relative overflow-hidden rounded-full px-4 py-2 font-semibold transition-all duration-300",
                        portfolioSizeFilter.includes('medium')
                          ? "bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 text-white shadow-lg shadow-amber-500/50 hover:shadow-xl hover:shadow-amber-500/60 hover:scale-110"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 hover:scale-105"
                      )}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                        Medium
                      </span>
                      {portfolioSizeFilter.includes('medium') && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPortfolioSizeFilter(prev => 
                          prev.includes('large') 
                            ? prev.filter(s => s !== 'large')
                            : [...prev, 'large']
                        );
                      }}
                      className={cn(
                        "relative overflow-hidden rounded-full px-4 py-2 font-semibold transition-all duration-300",
                        portfolioSizeFilter.includes('large')
                          ? "bg-gradient-to-r from-rose-500 via-rose-600 to-red-600 text-white shadow-lg shadow-rose-500/50 hover:shadow-xl hover:shadow-rose-500/60 hover:scale-110"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50 hover:scale-105"
                      )}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-300 animate-pulse" />
                        Large
                      </span>
                      {portfolioSizeFilter.includes('large') && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPortfolioSizeFilter(['small', 'medium', 'large'])}
                      className="rounded-full px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all duration-200 hover:scale-105"
                    >
                      All
                    </Button>
                  </div>
                  
                  {/* Quick Switch & Refetch */}
                  <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-border/50">
                    <span className="text-xs text-muted-foreground self-center font-semibold">Quick Switch:</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPortfolioSizeFilter(['small']);
                        toast.success('Switched to Small portfolio size');
                        setTimeout(() => {
                          scanOpportunities();
                          setWatchlistCollapsed(true);
                        }, 100);
                      }}
                      disabled={isScanning}
                      className="relative overflow-hidden rounded-full px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/50 hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        Small Only
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPortfolioSizeFilter(['medium']);
                        toast.success('Switched to Medium portfolio size');
                        setTimeout(() => {
                          scanOpportunities();
                          setWatchlistCollapsed(true);
                        }, 100);
                      }}
                      disabled={isScanning}
                      className="relative overflow-hidden rounded-full px-4 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        Medium Only
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPortfolioSizeFilter(['large']);
                        toast.success('Switched to Large portfolio size');
                        setTimeout(() => {
                          scanOpportunities();
                          setWatchlistCollapsed(true);
                        }, 100);
                      }}
                      disabled={isScanning}
                      className="relative overflow-hidden rounded-full px-4 py-2 bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50 hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        Large Only
                      </span>
                    </Button>
                  </div>
                </div>

                {/* DTE Range Filter */}
                <div className="flex items-center gap-4">
                  <Label>DTE Range:</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      value={minDte}
                      onChange={(e) => setMinDte(Number(e.target.value))}
                      className="w-20"
                    />
                    <span>to</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      value={maxDte}
                      onChange={(e) => setMaxDte(Number(e.target.value))}
                      className="w-20"
                    />
                  </div>
                </div>

              </CardContent>}
            </Card>
          )}

          {/* Fetch Button - always visible outside collapsible section */}
          {(() => {
            const hasCustomWidths = isIndexMode && strategyType === 'spread' && Object.keys(symbolWidths).some(sym => {
              const minW = getMinSpreadWidth(sym);
              return symbolWidths[sym] !== minW;
            });
            return (
              <div className="relative">
                <Button 
                  onClick={() => {
                    scanOpportunities();
                    setWatchlistCollapsed(true);
                  }} 
                  disabled={isScanning}
                  className="w-full bg-gradient-to-r from-emerald-600 to-green-700 hover:from-emerald-700 hover:to-green-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02]"
                  data-fetch-button="true"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Fetching Opportunities...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Fetch Opportunities
                    </>
                  )}
                </Button>
                {hasCustomWidths && (
                  <span className="absolute -top-2 -right-2 bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none pointer-events-none z-10">
                    Custom widths
                  </span>
                )}
              </div>
            );
          })()}
          
          {/* Scanning Progress Dialog */}
          <Dialog open={isScanning} onOpenChange={(open) => {
            if (!open) {
              // Cancel button clicked - abort scan
              setIsScanning(false);
              setScanStartTime(null);
              setScanProgress(0);
              toast.info('Scan cancelled');
            }
          }}>
            <DialogContent className="sm:max-w-md border-2 border-orange-500/50">
              <DialogHeader>
                <DialogTitle>Scanning Options Chains</DialogTitle>
                <DialogDescription>
                  Analyzing watchlist symbols for bear call spread opportunities...
                </DialogDescription>
              </DialogHeader>
              <div className="py-6">
                {scanStartTime && (
                  <LiveCountdown 
                    startTime={scanStartTime} 
                    totalSymbols={watchlistSymbolCount || 50} 
                  />
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Opportunities Section */}
      <div ref={filtersRef}>
        {opportunities.length > 0 && (
          <div className="space-y-6">
            {/* Summary Cards - Show totals for ALL filtered opportunities */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Card className="relative overflow-hidden bg-gradient-to-br from-amber-500/10 to-yellow-500/5 backdrop-blur border-amber-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
                <CardHeader className="pb-2 relative">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-green-500/20">
                      <DollarSign className="w-4 h-4 text-amber-400" />
                    </div>
                    <span className="text-muted-foreground">Total Premium</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-yellow-400 bg-clip-text text-transparent">
                    ${strategyType === 'spread'
                      ? filteredOpportunities.reduce((sum, opp) => sum + ((opp.netCredit || 0) * 100), 0).toFixed(2)
                      : filteredOpportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0).toFixed(2)}
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden bg-gradient-to-br from-slate-500/10 to-gray-500/5 backdrop-blur border-slate-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-500/5 to-transparent" />
                <CardHeader className="pb-2 relative">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                      <Target className="w-4 h-4 text-slate-400" />
                    </div>
                    <span className="text-muted-foreground">Total Collateral</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-r from-slate-400 to-gray-400 bg-clip-text text-transparent">
                    ${(() => {
                      const collateral = strategyType === 'spread'
                        ? filteredOpportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                        : filteredOpportunities.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
                      return collateral.toFixed(2);
                    })()}
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden bg-gradient-to-br from-amber-600/10 to-orange-600/5 backdrop-blur border-amber-600/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-600/5 to-transparent" />
                <CardHeader className="pb-2 relative">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-purple-500/20">
                      <TrendingUp className="w-4 h-4 text-amber-400" />
                    </div>
                    <span className="text-muted-foreground">ROC</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                    {(() => {
                      const totalPrem = strategyType === 'spread'
                        ? filteredOpportunities.reduce((sum, opp) => sum + ((opp.netCredit || 0) * 100), 0)
                        : filteredOpportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);
                      const totalColl = strategyType === 'spread'
                        ? filteredOpportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                        : filteredOpportunities.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
                      const roc = totalColl > 0 ? (totalPrem / totalColl) * 100 : 0;
                      return roc.toFixed(2);
                    })()}%
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden bg-gradient-to-br from-yellow-600/10 to-amber-700/5 backdrop-blur border-yellow-600/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                <div className="absolute inset-0 bg-gradient-to-br from-yellow-600/5 to-transparent" />
                <CardHeader className="pb-2 relative">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-orange-500/20">
                      <Target className="w-4 h-4 text-yellow-400" />
                    </div>
                    <span className="text-muted-foreground">Opportunities</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-amber-500 bg-clip-text text-transparent">
                    {filteredOpportunities.length}
                  </div>
                </CardContent>
              </Card>


            </div>

      <Card className="bg-card/50 backdrop-blur border-amber-500/20" data-section="filters">
        <CardHeader
          className="cursor-pointer select-none flex flex-row items-center justify-between py-3"
          onClick={() => setFiltersOpen(o => { const next = !o; localStorage.setItem('prosper_filters_bcs', String(next)); return next; })}
        >
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="w-4 h-4" />
            Filters
            {!filtersOpen && <span className="text-xs font-normal text-muted-foreground ml-1">Score · Delta · DTE · IV · RSI</span>}
          </CardTitle>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", filtersOpen && "rotate-180")} />
        </CardHeader>
        {filtersOpen && <CardContent className="space-y-4">
          {/* Range Filters - Redesigned with larger sliders */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <Label className="text-base font-semibold">Range Filters</Label>
              <span className="text-xs text-muted-foreground">(Adjust sliders to filter opportunities)</span>
            </div>
            
            {/* Score Range - PRIMARY FILTER */}
            <div className="space-y-2 p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-orange-400">Score (Primary Filter)</Label>
                <span className="text-xs text-muted-foreground">{scoreRange[0]} - {scoreRange[1]}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setScoreRange([Math.max(0, scoreRange[0] - 1), scoreRange[1]])}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    value={scoreRange[0]}
                    onChange={(e) => setScoreRange([parseInt(e.target.value) || 0, scoreRange[1]])}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                    min="0"
                    max="100"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setScoreRange([Math.min(100, scoreRange[0] + 1), scoreRange[1]])}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={scoreRange[0]}
                    onChange={(e) => setScoreRange([parseInt(e.target.value), scoreRange[1]])}
                    className="flex-1 h-2 accent-orange-500"
                  />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={scoreRange[1]}
                    onChange={(e) => setScoreRange([scoreRange[0], parseInt(e.target.value)])}
                    className="flex-1 h-2 accent-orange-500"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setScoreRange([scoreRange[0], Math.max(0, scoreRange[1] - 1)])}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    value={scoreRange[1]}
                    onChange={(e) => setScoreRange([scoreRange[0], parseInt(e.target.value) || 100])}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                    min="0"
                    max="100"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setScoreRange([scoreRange[0], Math.min(100, scoreRange[1] + 1)])}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScoreRange([70, 100])}
                  className="text-xs"
                >
                  Conservative (≥70)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScoreRange([55, 100])}
                  className="text-xs"
                >
                  Aggressive (≥55)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScoreRange([0, 100])}
                  className="text-xs"
                >
                  All
                </Button>
              </div>
            </div>

            {/* Delta Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Delta (Δ)</Label>
                <span className="text-xs text-muted-foreground">{deltaRange[0].toFixed(2)} - {deltaRange[1].toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeltaRange([Math.max(0, deltaRange[0] - 0.01), deltaRange[1]])}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    value={deltaRange[0]}
                    onChange={(e) => setDeltaRange([parseFloat(e.target.value) || 0, deltaRange[1]])}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                    step="0.01"
                    min="0"
                    max="1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeltaRange([Math.min(1, deltaRange[0] + 0.01), deltaRange[1]])}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={deltaRange[0]}
                    onChange={(e) => setDeltaRange([parseFloat(e.target.value), deltaRange[1]])}
                    className="flex-1 h-2"
                  />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={deltaRange[1]}
                    onChange={(e) => setDeltaRange([deltaRange[0], parseFloat(e.target.value)])}
                    className="flex-1 h-2"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeltaRange([deltaRange[0], Math.max(0, deltaRange[1] - 0.01)])}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    value={deltaRange[1]}
                    onChange={(e) => setDeltaRange([deltaRange[0], parseFloat(e.target.value) || 1])}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                    step="0.01"
                    min="0"
                    max="1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeltaRange([deltaRange[0], Math.min(1, deltaRange[1] + 0.01)])}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>

            {/* DTE Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Days to Expiration (DTE)</Label>
                <span className="text-xs text-muted-foreground">{dteRange[0]} - {dteRange[1]} days</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDteRange([Math.max(0, dteRange[0] - 1), dteRange[1]])}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    value={dteRange[0]}
                    onChange={(e) => setDteRange([parseInt(e.target.value) || 0, dteRange[1]])}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                    min="0"
                    max="90"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDteRange([Math.min(90, dteRange[0] + 1), dteRange[1]])}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="90"
                    step="1"
                    value={dteRange[0]}
                    onChange={(e) => setDteRange([parseInt(e.target.value), dteRange[1]])}
                    className="flex-1 h-2"
                  />
                  <input
                    type="range"
                    min="0"
                    max="90"
                    step="1"
                    value={dteRange[1]}
                    onChange={(e) => setDteRange([dteRange[0], parseInt(e.target.value)])}
                    className="flex-1 h-2"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDteRange([dteRange[0], Math.max(0, dteRange[1] - 1)])}
                    className="h-7 w-7 p-0"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    value={dteRange[1]}
                    onChange={(e) => setDteRange([dteRange[0], parseInt(e.target.value) || 90])}
                    className="w-16 px-2 py-1 text-sm border rounded bg-background"
                    min="0"
                    max="90"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDteRange([dteRange[0], Math.min(90, dteRange[1] + 1)])}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Filter Chip — index mode only */}
          {isIndexMode && (
            <div className="flex items-center gap-3 pt-1">
              <span className="text-sm font-medium text-muted-foreground">Exchange:</span>
              {(['All', 'CBOE', 'Nasdaq'] as const).map(exch => (
                <button
                  key={exch}
                  onClick={() => {
                    const newFilter = exch === 'All' ? null : exch;
                    setActiveExchangeFilter(newFilter);
                    setModalSubmissionComplete(false);
                    if (newFilter) {
                      setSelectedOpportunities(prev => {
                        const next = new Set<string>();
                        opportunities.forEach((opp: any) => {
                          const key = getOpportunityKey(opp);
                          if (prev.has(key) && getIndexExchange(opp.symbol) === newFilter) next.add(key);
                        });
                        return next;
                      });
                    }
                  }}
                  className={cn(
                    "text-sm px-3 py-1 rounded-full border transition-colors",
                    (exch === 'All' && activeExchangeFilter === null) || activeExchangeFilter === exch
                      ? exch === 'CBOE' ? "bg-blue-600 text-white border-blue-600"
                        : exch === 'Nasdaq' ? "bg-purple-600 text-white border-purple-600"
                        : "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  {exch}
                </button>
              ))}
              {activeExchangeFilter && (
                <span className="text-xs text-muted-foreground">
                  Showing {filteredOpportunities.length} {activeExchangeFilter} opportunities
                </span>
              )}
            </div>
          )}

          {/* Selection Controls */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <Button
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 flex-1"
                size="default"
                onClick={() => {
                  // Select all filtered opportunities
                  const newSelection = new Set(selectedOpportunities);
                  filteredOpportunities.forEach(opp => {
                    const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
                    newSelection.add(key);
                  });
                  setSelectedOpportunities(newSelection);
                  toast.success(`Selected ${filteredOpportunities.length} opportunities`);
                }}
                disabled={filteredOpportunities.length === 0}
              >
                ✓ Select All Filtered ({filteredOpportunities.length})
              </Button>
              <Button
                className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 flex-1"
                size="default"
                onClick={() => {
                  setSelectedOpportunities(new Set());
                  toast.success('Selection cleared');
                }}
                disabled={selectedOpportunities.size === 0}
              >
                ✕ Clear Selection ({selectedOpportunities.size})
              </Button>
            </div>
            <div className="flex items-center gap-3 p-3 bg-accent/20 rounded-lg">
              <Checkbox
                id="selected-only"
                checked={showSelectedOnly}
                onCheckedChange={(checked) => setShowSelectedOnly(checked as boolean)}
                className="w-5 h-5"
              />
              <Label htmlFor="selected-only" className="cursor-pointer text-base font-medium">
                Show Selected Only
              </Label>
            </div>
          </div>

            {/* AI Advisor Button - standardized */}
            <AIAdvisorButton
              isOpen={showAIAdvisor}
              onToggle={() => setShowAIAdvisor(!showAIAdvisor)}
              count={activeExchangeFilter ? filteredOpportunities.length : opportunities.length}
              label="Opportunities"
              disabled={opportunities.length === 0}
            />

            {/* AI Advisor Panel - inline below button */}
            {showAIAdvisor && (
              <AIAdvisorPanel
                opportunities={(activeExchangeFilter
                  ? opportunities.filter((opp: any) => getIndexExchange((opp as any).symbol) === activeExchangeFilter)
                  : opportunities
                ).map((opp: any) => ({
                  score: opp.score ?? 0,
                  symbol: opp.symbol,
                  strategy: strategyType === 'spread' ? 'BCS' : 'CC',
                  shortStrike: strategyType === 'spread' ? opp.strike : undefined,
                  longStrike: strategyType === 'spread' ? opp.longStrike : undefined,
                  strike: strategyType === 'cc' ? opp.strike : undefined,
                  expiration: opp.expiration,
                  dte: opp.dte,
                  netCredit: strategyType === 'spread' ? (opp.netCredit ?? 0) : (opp.premium ?? 0),
                  capitalRisk: strategyType === 'spread' ? (opp.capitalAtRisk ?? 0) : (opp.currentPrice * 100),
                  roc: opp.spreadROC ?? opp.returnPct ?? 0,
                  weeklyPct: opp.weeklyReturn,
                  breakeven: opp.breakeven,
                  delta: opp.delta,
                  openInterest: opp.openInterest,
                  volume: opp.volume,
                  ivRank: opp.ivRank,
                  bid: opp.bid,
                  ask: opp.ask,
                  currentPrice: opp.currentPrice,
                  longBid: strategyType === 'spread' ? opp.longBid : undefined,
                  longAsk: strategyType === 'spread' ? opp.longAsk : undefined,
                }))}
                availableBuyingPower={availableBuyingPower}
                strategy={strategyType === 'spread' ? 'BCS' : 'CC'}
                onSubmitSelected={(picks) => {
                  if (!selectedAccountId) {
                    toast.error("Please select an account in the sidebar");
                    return;
                  }
                  const isSpread = strategyType === 'spread';
                  const orders: UnifiedOrder[] = picks.map((pick) => {
                    const opp = pick.opportunity as any;
                    // Robust strike fallback: for spreads use shortStrike, for CC use strike
                    const strikeValue = isSpread
                      ? (opp.shortStrike ?? opp.strike ?? 0)
                      : (opp.strike ?? opp.shortStrike ?? 0);
                    const bidValue = opp.bid ?? opp.netCredit ?? 0;
                    const askValue = opp.ask ?? opp.netCredit ?? 0;
                    return {
                      symbol: opp.symbol,
                      strike: strikeValue,
                      expiration: opp.expiration,
                      premium: opp.netCredit ?? 0,
                      action: "STO" as const,
                      optionType: "CALL" as const,
                      longStrike: isSpread ? opp.longStrike : undefined,
                      longPremium: isSpread ? (opp.longAsk ?? 0) : undefined,
                      longBid: isSpread ? (opp.longBid ?? 0) : undefined,
                      longAsk: isSpread ? (opp.longAsk ?? 0) : undefined,
                      bid: bidValue,
                      ask: askValue,
                      currentPrice: opp.currentPrice ?? 0,
                      quantity: pick.quantity,
                      isSpread: isSpread,
                      capitalAtRisk: isSpread ? (opp.capitalAtRisk ?? opp.capitalRisk) : undefined,
                      // OCC option symbol for live quote fetching in the preview modal
                      optionSymbol: opp.optionSymbol as string | undefined,
                      // For BCS spreads: long leg OCC symbol for live net credit
                      spreadLongSymbol: isSpread ? (opp.longOptionSymbol as string | undefined) : undefined,
                    };
                  });
                  setUnifiedOrders(orders);
                  setModalSubmissionComplete(false);
                  setModalFinalOrderStatus(null);
                  setShowPreviewDialog(true);
                }}
                onClose={() => setShowAIAdvisor(false)}
              />
            )}
        </CardContent>}
      </Card>
      {/* Summary Cards - Enhanced with gradients and glassmorphism */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-amber-500/10 to-yellow-500/5 backdrop-blur border-amber-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-green-500/20">
                <DollarSign className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-muted-foreground">Total Premium</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-yellow-400 bg-clip-text text-transparent">
              ${totalPremium.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-500/10 to-gray-500/5 backdrop-blur border-slate-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Target className="w-4 h-4 text-slate-400" />
              </div>
              <span className="text-muted-foreground">Total Collateral</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-slate-400 to-gray-400 bg-clip-text text-transparent">
              ${totalCollateral.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-amber-600/10 to-orange-600/5 backdrop-blur border-amber-600/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-600/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <TrendingUp className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-muted-foreground">ROC</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
              {roc.toFixed(2)}%
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-yellow-600/10 to-amber-700/5 backdrop-blur border-yellow-600/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-600/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Calendar className="w-4 h-4 text-yellow-400" />
              </div>
              <span className="text-muted-foreground">Opportunities</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-amber-500 bg-clip-text text-transparent">
              {filteredOpportunities.length}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-blue-500/10 to-cyan-500/5 backdrop-blur border-blue-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
                <CardHeader className="pb-2 relative">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                      <Wallet className="w-4 h-4 text-blue-400" />
                    </div>
                    <span className="text-muted-foreground">{strategyType === 'spread' ? 'Buying Power Available' : 'Total Stock Value'}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                    ${(() => {
                      const selectedOppsList = Array.from(selectedOpportunities).map(id => 
                        filteredOpportunities.find(opp => getOpportunityKey(opp) === id)
                      ).filter(Boolean) as typeof filteredOpportunities;
                      
                      if (strategyType === 'spread') {
                        // For spreads: show available BP = total BP - collateral required
                        const totalCollateral = selectedOppsList.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0);
                        const remainingBP = Math.max(0, availableBuyingPower - totalCollateral);
                        return remainingBP.toLocaleString(undefined, { maximumFractionDigits: 0 });
                      } else {
                        // For CC: show total stock value
                        const totalValue = selectedOppsList.reduce((sum, opp) => sum + (opp.currentPrice * 100), 0);
                        return totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 });
                      }
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {strategyType === 'spread' ? 'for selected spreads' : 'for selected stocks'}
                  </div>
                </CardContent>
              </Card>
      </div>

            {/* Order Summary */}
            {selectedOpportunities.size > 0 && (
              <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/30">
                <CardHeader>
                  <CardTitle className="text-xl">Order Summary</CardTitle>
                  <CardDescription>
                    {strategyType === 'cc' ? 'Review your selected covered calls' : 'Review your selected bear call spreads'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                      <DollarSign className="w-8 h-8 text-green-400" />
                      <div>
                        <p className="text-sm text-muted-foreground">Total Premium</p>
                        <p className="text-2xl font-bold text-green-400">
                          ${(Array.from(selectedOpportunities)
                            .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
                            .filter((opp): opp is CCOpportunity => opp !== undefined)
                            // CRITICAL: opp.premium is per-share dollars (e.g., $1.37)
                            // Order Summary shows TOTAL net credit = per-share × 100 shares
                            // Example: $1.37/share × 100 shares = $137 total credit per contract
                            .reduce((sum, opp) => sum + (strategyType === 'spread' ? (opp.netCredit || 0) * 100 : opp.premium * 100), 0))
                            .toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Target className="w-8 h-8 text-amber-400" />
                      <div>
                        <p className="text-sm text-muted-foreground">Total Contracts</p>
                        <p className="text-2xl font-bold text-amber-400">
                          {selectedOpportunities.size}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <TrendingUp className="w-8 h-8 text-purple-400" />
                      <div>
                        <p className="text-sm text-muted-foreground">Avg Weekly Return</p>
                        <p className="text-2xl font-bold text-purple-400">
                          {
                            selectedOpportunities.size > 0
                              ? (
                                  Array.from(selectedOpportunities)
                                    .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
                                    .filter((opp): opp is CCOpportunity => opp !== undefined)
                                    .reduce((sum, opp) => sum + opp.weeklyReturn, 0) / selectedOpportunities.size
                                ).toFixed(2)
                              : '0.00'
                          }
                          %
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <TrendingUp className="w-8 h-8 text-blue-400" />
                      <div>
                        <p className="text-sm text-muted-foreground">Avg Delta</p>
                        <p className="text-2xl font-bold text-blue-400">
                          {
                            selectedOpportunities.size > 0
                              ? (
                                  Array.from(selectedOpportunities)
                                    .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
                                    .filter((opp): opp is CCOpportunity => opp !== undefined)
                                    .reduce((sum, opp) => sum + opp.delta, 0) / selectedOpportunities.size
                                ).toFixed(2)
                              : '0.00'
                          }
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
                      <Target className="w-8 h-8 text-orange-400" />
                      <div>
                        <p className="text-sm text-muted-foreground">Avg Score</p>
                        <p className="text-2xl font-bold text-orange-400">
                          {
                            selectedOpportunities.size > 0
                              ? (
                                  Array.from(selectedOpportunities)
                                    .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
                                    .filter((opp): opp is CCOpportunity => opp !== undefined)
                                    .reduce((sum, opp) => sum + opp.score, 0) / selectedOpportunities.size
                                ).toFixed(0)
                              : '0'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          id="dryRun"
                          checked={tradingMode === 'paper' ? true : dryRun}
                          onCheckedChange={(checked) => setDryRun(checked as boolean)}
                          disabled={tradingMode === 'paper'}
                        />
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          Dry Run Mode (Test without submitting)
                          <HelpDialog title="Dry Run Mode" content={HELP_CONTENT.DRY_RUN_MODE_DIALOG} />
                        </span>
                      </label>
                    </div>
                    {tradingMode === 'paper' && (
                      <p className="text-sm text-blue-500 font-semibold mb-2">
                        ⓘ Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.
                      </p>
                    )}
                    <Button
                      onClick={handleSubmitOrders}
                      disabled={isSubmitting || selectedOpportunities.size === 0 || (tradingMode === 'paper' && !dryRun)}
                      className={cn(
                        dryRun 
                          ? "bg-blue-600 hover:bg-blue-700" 
                          : "bg-red-600 hover:bg-red-700 font-bold"
                      )}
                      size="lg"
                      title={tradingMode === 'paper' ? 'Order submission is disabled in Paper Trading mode' : undefined}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {dryRun ? 'Testing...' : 'Submitting LIVE Orders...'}
                        </>
                      ) : (
                        <>
                          {!dryRun && '⚠️ '}
                          {dryRun ? 'Test' : 'Submit LIVE'} {selectedOpportunities.size} Order(s)
                          {!dryRun && ' ⚠️'}
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Selection Summary Cards - REMOVED: Consolidated into Order Summary above */}

            {/* Opportunities Table */}
            <Card className="bg-card/50 backdrop-blur border-amber-500/20">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl">Covered Call Opportunities</CardTitle>
                  <CardDescription>
                    {filteredOpportunities.length} of {opportunities.length} opportunities • Sorted by composite score
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <ColumnVisibilityToggle
                    columns={currentColDefs}
                    visibleColumns={visibleCols}
                    onVisibilityChange={setColVisible}
                    onReset={resetCols}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAIAdvisor(!showAIAdvisor)}
                    className="border-purple-500/40 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200"
                  >
                    <Sparkles className="w-4 h-4 mr-2 text-purple-400" />
                    AI Advisor
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const timestamp = new Date().toISOString().split('T')[0];
                      const strategyName = strategyType === 'cc' ? 'CoveredCall' : 'BearCallSpread';
                      // Build clean human-readable rows
                      const rows = filteredOpportunities.map((opp: any) => ({
                        Score: opp.score ?? '',
                        Symbol: opp.symbol,
                        Strategy: strategyType === 'spread' ? 'Bear Call Spread' : 'Covered Call',
                        'Short Strike': opp.strike,
                        'Long Strike': opp.longStrike ?? '',
                        'Spread Width': opp.spreadWidth ?? '',
                        'Current Price': opp.currentPrice,
                        Expiration: opp.expiration,
                        DTE: opp.dte,
                        'Net Credit ($)': strategyType === 'spread' ? ((opp.netCredit ?? 0) * 100).toFixed(2) : (opp.premium * 100).toFixed(2),
                        'Bid ($)': opp.bid,
                        'Ask ($)': opp.ask,
                        'Capital Risk ($)': strategyType === 'spread' ? ((opp.capitalAtRisk ?? 0) * 100).toFixed(2) : (opp.currentPrice * 100).toFixed(2),
                        'ROC %': opp.spreadROC != null ? opp.spreadROC.toFixed(2) : (opp.returnPct != null ? opp.returnPct.toFixed(2) : ''),
                        'Weekly %': opp.weeklyReturn != null ? opp.weeklyReturn.toFixed(2) : '',
                        Breakeven: opp.breakeven ?? (opp.strike + (opp.premium ?? 0)).toFixed(2),
                        Delta: opp.delta != null ? opp.delta.toFixed(4) : '',
                        'Long Delta': opp.longDelta != null ? opp.longDelta.toFixed(4) : '',
                        OI: opp.openInterest,
                        Volume: opp.volume,
                        RSI: opp.rsi ?? '',
                        'BB %B': opp.bbPctB ?? '',
                        'IV Rank': opp.ivRank ?? '',
                        'Spread %': opp.spreadPct != null ? opp.spreadPct.toFixed(2) : '',
                        'Distance OTM %': opp.distanceOtm != null ? opp.distanceOtm.toFixed(2) : '',
                        Risk: opp.riskBadges?.map((b: any) => b.label ?? b).join('; ') ?? '',
                      }));
                      exportToCSV(rows, `${strategyName}_Opportunities_${timestamp}`);
                      toast.success(`Exported ${filteredOpportunities.length} opportunities to CSV`);
                    }}
                    disabled={filteredOpportunities.length === 0}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV ({filteredOpportunities.length})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllOpportunities}
                    disabled={filteredOpportunities.length === 0}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearOpportunitySelection}
                    disabled={selectedOpportunities.size === 0}
                  >
                    Clear All
                  </Button>
                  <Button
                    variant={showSelectedOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                    disabled={selectedOpportunities.size === 0}
                    className={showSelectedOnly ? "bg-amber-500 hover:bg-amber-600" : ""}
                  >
                    {showSelectedOnly ? "Show All" : "Show Selected Only"}
                  </Button>
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-lg px-4 py-2"
                  >
                    {selectedOpportunities.size} Selected
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isMobile ? (
                /* ── MOBILE: stacked cards ── */
                <div className="space-y-2 px-1">
                  {sortedOpportunities.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8 text-sm">No opportunities found</p>
                  ) : (
                    sortedOpportunities.map((opp, rowIdx) => {
                      const oppKey = getOpportunityKey(opp);
                      const isSelected = selectedOpportunities.has(oppKey);
                      return (
                        <CCMobileCard
                          key={`${oppKey}-${rowIdx}`}
                          opp={{
                            symbol: opp.symbol,
                            score: opp.score,
                            strike: opp.strike,
                            dte: opp.dte,
                            premium: opp.premium,
                            expiration: opp.expiration,
                            returnPct: opp.returnPct,
                            weeklyReturn: opp.weeklyReturn,
                            rsi: opp.rsi,
                            ivRank: opp.ivRank,
                            riskBadges: (opp as any).riskBadges,
                            longStrike: opp.longStrike,
                            netCredit: opp.netCredit,
                            spreadROC: opp.spreadROC,
                          }}
                          isSelected={isSelected}
                          onToggle={() => toggleOpportunitySelection(opp)}
                          strategyType={strategyType}
                        />
                      );
                    })
                  )}
                </div>
              ) : (
                /* ── DESKTOP: scrollable table ── */
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* 1. Select */}
                      <TableHead className="w-12">
                        <Checkbox
                          checked={sortedOpportunities.length > 0 && sortedOpportunities.every(opp => selectedOpportunities.has(getOpportunityKey(opp)))}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              const next = new Set(selectedOpportunities);
                              sortedOpportunities.forEach(opp => next.add(getOpportunityKey(opp)));
                              setSelectedOpportunities(next);
                            } else {
                              const next = new Set(selectedOpportunities);
                              sortedOpportunities.forEach(opp => next.delete(getOpportunityKey(opp)));
                              setSelectedOpportunities(next);
                            }
                          }}
                          aria-label="Select all visible opportunities"
                          className="border-2 border-amber-500/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                        />
                      </TableHead>
                      
                      {/* 2. Score */}
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('score')}>
                        <div className="flex items-center justify-end gap-1">
                          Score
                          <HelpDialog title="Score Calculation" content={HELP_CONTENT.SCORE_CALCULATION_DIALOG} />
                          {sortColumn === 'score' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      
                      {/* 2b. Trend 14d (spread only) */}
                      {strategyType === 'spread' && visibleCols.has('trend14d') && (
                        <TableHead className="text-center">
                          <div className="flex items-center justify-center gap-1">Trend 14d</div>
                        </TableHead>
                      )}
                      {/* 3. Symbol — pinned, always shown */}
                      <TableHead>Symbol</TableHead>
                      {/* Exchange (index mode, BCS only) */}
                      {strategyType === 'spread' && isIndexMode && visibleCols.has('exchange') && (
                        <TableHead>Exchange</TableHead>
                      )}
                      {/* 4. Current Price */}
                      {visibleCols.has('currentPrice') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('currentPrice')}>
                          <div className="flex items-center justify-end gap-1">
                            Current
                            {sortColumn === 'currentPrice' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 5. Strikes — pinned */}
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('strike')}>
                        <div className="flex items-center justify-end gap-1">
                          {strategyType === 'spread' ? 'Strikes' : 'Strike'}
                          {sortColumn === 'strike' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      {/* 5b. Width (spread only) */}
                      {strategyType === 'spread' && visibleCols.has('width') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('width' as keyof CCOpportunity)}>
                          <div className="flex items-center justify-end gap-1">
                            Width
                            {sortColumn === ('width' as any) && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 6. DTE — pinned */}
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('dte')}>
                        <div className="flex items-center justify-end gap-1">
                          DTE
                          <HelpBadge content={HELP_CONTENT.DTE} />
                          {sortColumn === 'dte' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      {/* 7. Premium/Net Credit — pinned */}
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('premium')}>
                        <div className="flex items-center justify-end gap-1">
                          {strategyType === 'spread' ? 'Net Credit' : 'Premium'}
                          {strategyType === 'spread' && <HelpBadge content={HELP_CONTENT.NET_CREDIT} />}
                          {sortColumn === 'premium' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      {/* 8. Capital at Risk */}
                      {strategyType === 'spread' && visibleCols.has('capitalAtRisk') && (
                        <TableHead className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            Capital Risk
                            <HelpBadge content={HELP_CONTENT.CAPITAL_AT_RISK} />
                          </div>
                        </TableHead>
                      )}
                      {/* 9. Weekly % */}
                      {visibleCols.has('weeklyPct') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('weeklyReturn')}>
                          <div className="flex items-center justify-end gap-1">
                            Weekly %
                            <HelpBadge content={HELP_CONTENT.WEEKLY_RETURN} />
                            {sortColumn === 'weeklyReturn' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 9b. ROC % */}
                      {visibleCols.has('roc') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('spreadROC')}>
                          <div className="flex items-center justify-end gap-1">
                            ROC %
                            {sortColumn === 'spreadROC' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 10. Delta */}
                      {visibleCols.has('delta') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('delta')}>
                          <div className="flex items-center justify-end gap-1">
                            Delta (Δ)
                            <HelpBadge content={HELP_CONTENT.DELTA_CC} />
                            {sortColumn === 'delta' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 11. IV Rank */}
                      {visibleCols.has('ivRank') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('ivRank')}>
                          <div className="flex items-center justify-end gap-1">
                            IV Rank
                            <HelpBadge content={HELP_CONTENT.IV_RANK} />
                            {sortColumn === 'ivRank' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 11b. Exp Move */}
                      {visibleCols.has('expMove') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('expectedMove')}>
                          <div className="flex items-center justify-end gap-1">
                            Exp Move
                            <HelpBadge content={HELP_CONTENT.EXP_MOVE} />
                            {sortColumn === 'expectedMove' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 11c. Safety Ratio */}
                      {visibleCols.has('safetyRatio') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('safetyRatio')}>
                          <div className="flex items-center justify-end gap-1">
                            Safety ×
                            <HelpBadge content={HELP_CONTENT.SAFETY_RATIO} />
                            {sortColumn === 'safetyRatio' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 12. RSI */}
                      {visibleCols.has('rsi') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('rsi')}>
                          <div className="flex items-center justify-end gap-1">
                            RSI
                            <HelpBadge content={HELP_CONTENT.RSI_CC} />
                            {sortColumn === 'rsi' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 13. BB %B */}
                      {visibleCols.has('bbPctB') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('bbPctB')}>
                          <div className="flex items-center justify-end gap-1">
                            BB %B
                            <HelpBadge content={HELP_CONTENT.BB_PCTB_CC} />
                            {sortColumn === 'bbPctB' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 14. OI */}
                      {visibleCols.has('openInterest') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('openInterest')}>
                          <div className="flex items-center justify-end gap-1">
                            OI
                            <HelpDialog title="Open Interest & Volume" content={HELP_CONTENT.OPEN_INTEREST_VOLUME_DIALOG} />
                            {sortColumn === 'openInterest' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 15. Volume */}
                      {visibleCols.has('volume') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('volume')}>
                          <div className="flex items-center justify-end gap-1">
                            Vol
                            <HelpDialog title="Open Interest & Volume" content={HELP_CONTENT.OPEN_INTEREST_VOLUME_DIALOG} />
                            {sortColumn === 'volume' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 16. Risk — always visible */}
                      <TableHead className="text-center">Risk</TableHead>
                      {/* 17. Bid */}
                      {visibleCols.has('bid') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('bid')}>
                          <div className="flex items-center justify-end gap-1">
                            Bid
                            {sortColumn === 'bid' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 18. Ask */}
                      {visibleCols.has('ask') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('ask')}>
                          <div className="flex items-center justify-end gap-1">
                            Ask
                            {sortColumn === 'ask' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 19. Mid */}
                      {visibleCols.has('mid') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('mid')}>
                          <div className="flex items-center justify-end gap-1">
                            Mid
                            {sortColumn === 'mid' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 20. Distance OTM */}
                      {visibleCols.has('distanceOtm') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('distanceOtm')}>
                          <div className="flex items-center justify-end gap-1">
                            Dist OTM
                            {sortColumn === 'distanceOtm' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 21. Spread % */}
                      {visibleCols.has('spreadPct') && (
                        <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('spreadPct')}>
                          <div className="flex items-center justify-end gap-1">
                            Spread %
                            {sortColumn === 'spreadPct' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </TableHead>
                      )}
                      {/* 22. Expiration */}
                      {visibleCols.has('expiration') && <TableHead>Expiration</TableHead>}
                    </TableRow>

                  </TableHeader>
                  <TableBody>
                    {sortedOpportunities.map((opp, index) => {
                      const oppKey = getOpportunityKey(opp);
                      return (
                      <TableRow key={oppKey}>
                        {/* 1. Select */}
                        <TableCell>
                          <Checkbox
                            checked={selectedOpportunities.has(oppKey)}
                            onCheckedChange={() => toggleOpportunitySelection(opp)}
                            className="border-2 border-amber-500/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                          />
                        </TableCell>
                        
                        {/* 2. Score */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="secondary" className={getScoreBadgeClass(opp.score)}>
                                    {opp.score}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="bg-gray-900 border-amber-500/50 p-3 max-w-xs">
                                  <div className="space-y-1.5 text-sm">
                                    <div className="font-semibold text-amber-400 border-b border-amber-500/30 pb-1 mb-2">
                                      Score Breakdown ({opp.score}/100)
                                    </div>
                                    {(opp as any).scoreBreakdown?.d1Liquidity !== undefined ? (
                                      <>
                                        {[
                                          { label: 'D1 Liquidity (Spread/OI/Vol)', key: 'd1Liquidity', max: 15 },
                                          { label: 'D2 Probability (Δ+DTE+POP)', key: 'd2ProbabilityFit', max: 20 },
                                          { label: 'D3 Premium Efficiency', key: 'd3PremiumEfficiency', max: 20 },
                                          { label: 'D4 IV Richness (IV Rank)', key: 'd4IVRichness', max: 15 },
                                          { label: 'D5 Strike Safety (OTM vs EM)', key: 'd5StrikeSafety', max: 15 },
                                          { label: 'D6 Technical (RSI+BB+Trend)', key: 'd6Technical', max: 15 },
                                        ].map(({ label, key, max }) => {
                                          const val = (opp as any).scoreBreakdown[key] ?? 0;
                                          const pct = val / max;
                                          return (
                                            <div key={key} className="flex justify-between">
                                              <span className="text-gray-400">{label}:</span>
                                              <span className={`font-medium ${ pct >= 0.8 ? 'text-green-400' : pct >= 0.5 ? 'text-yellow-400' : 'text-red-400' }`}>{val}/{max}</span>
                                            </div>
                                          );
                                        })}
                                        {(opp as any).scoreBreakdown.safetyRatio != null && (
                                          <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                                            <span className="text-gray-400">Safety Ratio (Strike/EM):</span>
                                            <span className={`font-medium ${
                                              (opp as any).scoreBreakdown.safetyRatio >= 1.5 ? 'text-green-400' :
                                              (opp as any).scoreBreakdown.safetyRatio >= 1.0 ? 'text-yellow-400' : 'text-red-400'
                                            }`}>{((opp as any).scoreBreakdown.safetyRatio as number).toFixed(2)}×</span>
                                          </div>
                                        )}
                                      </>
                                    ) : (opp as any).scoreBreakdown?.direction !== undefined ? (
                                      <>
                                        {[
                                          { label: 'Direction (Trend Align)', key: 'direction', max: 35 },
                                          { label: 'Greeks & Spread Eff.', key: 'greeks', max: 25 },
                                          { label: 'Technical (RSI+BB)', key: 'technical', max: 20 },
                                          { label: 'Premium Quality', key: 'premium', max: 15 },
                                          { label: 'Overall Quality', key: 'quality', max: 5 },
                                        ].map(({ label, key, max }) => {
                                          const val = (opp as any).scoreBreakdown[key] ?? 0;
                                          const pct = val / max;
                                          return (
                                            <div key={key} className="flex justify-between">
                                              <span className="text-gray-400">{label}:</span>
                                              <span className={`font-medium ${ pct >= 0.8 ? 'text-green-400' : pct >= 0.5 ? 'text-yellow-400' : 'text-red-400' }`}>{val}/{max}</span>
                                            </div>
                                          );
                                        })}
                                        {(opp as any).scoreBreakdown.safetyRatio != null && (
                                          <div className="flex flex-col gap-0.5 border-t border-gray-700 pt-1 mt-1">
                                            <div className="flex justify-between">
                                              <span className="text-gray-400">Short Call / Exp Move:</span>
                                              <span className={`font-medium ${
                                                (opp as any).scoreBreakdown.safetyRatio >= 1.5 ? 'text-green-400' :
                                                (opp as any).scoreBreakdown.safetyRatio >= 1.0 ? 'text-yellow-400' : 'text-red-400'
                                              }`}>{((opp as any).scoreBreakdown.safetyRatio as number).toFixed(2)}×</span>
                                            </div>
                                            <div className="text-gray-500 text-[10px] leading-tight">
                                              {(opp as any).scoreBreakdown.safetyRatio >= 1.5
                                                ? 'Strike well above expected upside — strong bearish buffer'
                                                : (opp as any).scoreBreakdown.safetyRatio >= 1.0
                                                ? 'Strike near expected upside — moderate conviction needed'
                                                : 'Strike inside expected upside — high bearish conviction required'}
                                            </div>
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <div className="text-gray-400 text-xs">Breakdown not available</div>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <AIRowIcon
                              isLoading={analyzingRowKey === `${opp.symbol}-${opp.strike}-${opp.expiration}`}
                              onClick={() => {
                                const rowKey = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
                                setAnalyzingRowKey(rowKey);
                                if (strategyType === 'spread') {
                                  explainBCSScore.mutate({
                                    symbol: opp.symbol,
                                    shortStrike: opp.strike,
                                    longStrike: (opp as any).longStrike ?? 0,
                                    currentPrice: opp.currentPrice,
                                    netCredit: opp.premium,
                                    shortDelta: opp.delta,
                                    dte: opp.dte,
                                    rsi: opp.rsi,
                                    bbPctB: opp.bbPctB,
                                    ivRank: (opp as any).ivRank ?? null,
                                    score: opp.score,
                                    scoreBreakdown: (opp as any).scoreBreakdown ?? { technical: 0, greeks: 0, premium: 0, quality: 0, total: opp.score },
                                  });
                                } else {
                                  explainCCScore.mutate({
                                    symbol: opp.symbol,
                                    strike: opp.strike,
                                    currentPrice: opp.currentPrice,
                                    premium: opp.premium,
                                    delta: opp.delta,
                                    dte: opp.dte,
                                    weeklyReturn: opp.weeklyReturn,
                                    distanceOtm: opp.distanceOtm,
                                    rsi: opp.rsi,
                                    bbPctB: opp.bbPctB,
                                    spreadPct: opp.spreadPct ?? null,
                                    score: opp.score,
                                  });
                                }
                              }}
                              title="AI explanation of this score"
                              size="xs"
                            />
                          </div>
                        </TableCell>
                        
                        {/* 2b. Trend 14d (spread only) */}
                        {strategyType === 'spread' && visibleCols.has('trend14d') && (() => {
                          const t = (opp as any).trend14d;
                          const bias = (opp as any).trendBias;
                          if (t === undefined || t === null) return <TableCell className="text-center"><span className="text-muted-foreground text-xs">—</span></TableCell>;
                          const isStrongBearish = t <= -3;
                          const isMildBearish = t < -1.5;
                          const isStrongBullish = t >= 3;
                          const isMildBullish = t > 1.5;
                          const color = isStrongBearish ? 'text-red-400 bg-red-500/10 border-red-500/30' :
                            isMildBearish ? 'text-orange-400 bg-orange-500/10 border-orange-500/30' :
                            isStrongBullish ? 'text-green-400 bg-green-500/10 border-green-500/30' :
                            isMildBullish ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                            'text-slate-400 bg-slate-500/10 border-slate-500/30';
                          const arrow = t <= -1.5 ? '▼' : t >= 1.5 ? '▲' : '→';
                          const label = bias || (isStrongBearish ? 'Bearish' : isMildBearish ? 'Mild Bear' : isStrongBullish ? 'Bullish' : isMildBullish ? 'Mild Bull' : 'Neutral');
                          return (
                            <TableCell className="text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
                                {arrow} {t.toFixed(1)}%
                              </span>
                              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                            </TableCell>
                          );
                        })()}

                        {/* 3. Symbol — always shown */}
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-1.5">
                            <span>{opp.symbol}</span>
                            <button
                              title={`View ${opp.symbol} chart`}
                              onClick={() => setChartSymbol({ symbol: opp.symbol, strike: opp.strike, currentPrice: opp.currentPrice })}
                              className="p-0.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-700/50 transition-colors"
                            >
                              <BarChart2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                        
                        {/* 4. Current Price */}
                        {/* Exchange (index mode, BCS only) */}
                        {strategyType === 'spread' && isIndexMode && visibleCols.has('exchange') && (
                          <TableCell className="text-xs text-muted-foreground">
                            {(opp as any).exchange ?? getIndexExchange(opp.symbol) ?? '—'}
                          </TableCell>
                        )}
                        {visibleCols.has('currentPrice') && (
                          <TableCell className="text-right">
                            <span className="text-muted-foreground">${opp.currentPrice.toFixed(2)}</span>
                          </TableCell>
                        )}
                        {/* 5. Strikes — always shown */}
                        <TableCell className="text-right">
                          {strategyType === 'spread' && opp.longStrike ? (
                            <span className="text-orange-400">
                              ${opp.strike.toFixed(2)} / ${opp.longStrike.toFixed(2)}
                            </span>
                          ) : (
                            `$${opp.strike.toFixed(2)}`
                          )}
                        </TableCell>
                        {/* 5b. Width (spread only) */}
                        {strategyType === 'spread' && visibleCols.has('width') && (
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {(opp as any).spreadWidth != null ? `${(opp as any).spreadWidth}pt` : '—'}
                          </TableCell>
                        )}
                        {/* 6. DTE — always shown */}
                        <TableCell className="text-right">{opp.dte}</TableCell>
                        {/* 7. Premium/Net Credit — always shown */}
                        <TableCell className="text-right">
                          <span className="text-green-400 font-semibold">
                            ${opp.premium.toFixed(2)}
                          </span>
                        </TableCell>
                        {/* 8. Capital at Risk */}
                        {strategyType === 'spread' && visibleCols.has('capitalAtRisk') && (
                          <TableCell className="text-right">
                            <span className="text-orange-400 font-semibold">
                              ${((opp as any).capitalAtRisk || 0).toFixed(0)}
                            </span>
                          </TableCell>
                        )}
                        {/* 9. Weekly % */}
                        {visibleCols.has('weeklyPct') && (
                          <TableCell className="text-right">
                            <Badge className={cn("font-bold", getROCColor(opp.weeklyReturn))}>
                              {opp.weeklyReturn.toFixed(2)}%
                            </Badge>
                          </TableCell>
                        )}
                        {/* 9b. ROC % */}
                        {visibleCols.has('roc') && (
                          <TableCell className="text-right">
                            <Badge className={cn("font-bold", getROCColor((opp as any).spreadROC ?? opp.returnPct))}>
                              {((opp as any).spreadROC ?? opp.returnPct ?? 0).toFixed(2)}%
                            </Badge>
                          </TableCell>
                        )}
                        {/* 10. Delta */}
                        {visibleCols.has('delta') && (
                          <TableCell className="text-right">{opp.delta.toFixed(2)}</TableCell>
                        )}
                        {/* 11. IV Rank */}
                        {visibleCols.has('ivRank') && (
                          <TableCell className="text-right">
                            {opp.ivRank !== null ? opp.ivRank.toFixed(1) : 'N/A'}
                          </TableCell>
                        )}
                        {/* 11b. Exp Move */}
                        {visibleCols.has('expMove') && (
                          <TableCell className="text-right">
                            <span className="text-xs font-mono text-cyan-300">
                              {(opp as any).expectedMove != null ? `$${(opp as any).expectedMove.toFixed(2)}` : '—'}
                            </span>
                          </TableCell>
                        )}
                        {/* 11c. Safety Ratio */}
                        {visibleCols.has('safetyRatio') && (
                          <TableCell className="text-right">
                            <span className={`text-xs font-mono font-bold ${
                              opp.safetyRatio == null ? 'text-gray-500' :
                              opp.safetyRatio >= 1.5 ? 'text-green-400' :
                              opp.safetyRatio >= 1.0 ? 'text-yellow-400' : 'text-red-400'
                            }`}>
                              {opp.safetyRatio != null ? `${opp.safetyRatio.toFixed(2)}×` : '—'}
                            </span>
                          </TableCell>
                        )}
                        {/* 12. RSI */}
                        {visibleCols.has('rsi') && (
                          <TableCell className="text-right">
                            <Badge className={cn("font-bold", getRSIColor(opp.rsi, 'cc'))}>
                              {opp.rsi !== null ? opp.rsi.toFixed(1) : 'N/A'}
                            </Badge>
                          </TableCell>
                        )}
                        {/* 13. BB %B */}
                        {visibleCols.has('bbPctB') && (
                          <TableCell className="text-right">
                            <Badge className={cn("font-bold", getBBColor(opp.bbPctB, 'cc'))}>
                              {opp.bbPctB !== null ? opp.bbPctB.toFixed(2) : 'N/A'}
                            </Badge>
                          </TableCell>
                        )}
                        {/* 14. OI */}
                        {visibleCols.has('openInterest') && (
                          <TableCell className="text-right">
                            <Badge className={cn("font-bold", getLiquidityColor(opp.openInterest, 'oi'))}>
                              {opp.openInterest.toLocaleString()}
                            </Badge>
                          </TableCell>
                        )}
                        {/* 15. Volume */}
                        {visibleCols.has('volume') && (
                          <TableCell className="text-right">
                            <Badge className={cn("font-bold", getLiquidityColor(opp.volume, 'vol'))}>
                              {opp.volume.toLocaleString()}
                            </Badge>
                          </TableCell>
                        )}
                        {/* 16. Risk — always shown */}
                        <TableCell className="text-center">
                          <RiskBadgeList badges={(opp as any).riskBadges || []} />
                        </TableCell>
                        {/* 17. Bid */}
                        {visibleCols.has('bid') && (
                          <TableCell className="text-right">${opp.bid.toFixed(2)}</TableCell>
                        )}
                        {/* 18. Ask */}
                        {visibleCols.has('ask') && (
                          <TableCell className="text-right">${opp.ask.toFixed(2)}</TableCell>
                        )}
                        {/* 19. Mid */}
                        {visibleCols.has('mid') && (
                          <TableCell className="text-right">${opp.mid.toFixed(2)}</TableCell>
                        )}
                        {/* 20. Distance OTM */}
                        {visibleCols.has('distanceOtm') && (
                          <TableCell className="text-right">{opp.distanceOtm.toFixed(1)}%</TableCell>
                        )}
                        {/* 21. Spread % */}
                        {visibleCols.has('spreadPct') && (
                          <TableCell className="text-right">{opp.spreadPct.toFixed(1)}%</TableCell>
                        )}
                        {/* 22. Expiration */}
                        {visibleCols.has('expiration') && (
                          <TableCell>{opp.expiration}</TableCell>
                        )}
                      </TableRow>

                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        )}
      </div>

      {/* Spread Width Help Dialog */}
      <Dialog open={showSpreadHelp} onOpenChange={setShowSpreadHelp}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto border-2 border-orange-500/50">
          <DialogHeader>
            <DialogTitle>Recommended Spread Widths</DialogTitle>
            <DialogDescription>
              Choose the right spread width based on your stock price, account size, and strategy
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 mt-4">
            {/* By Stock Price */}
            <div>
              <h3 className="font-semibold text-lg mb-3">By Stock Price</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Under $100</span>
                  <span className="font-medium">2-point spreads</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$100-$200</span>
                  <span className="font-medium">2-5 point spreads</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$200-$400</span>
                  <span className="font-medium">5-10 point spreads</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$400-$800</span>
                  <span className="font-medium">10-15 point spreads</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$800+</span>
                  <span className="font-medium">15-20 point spreads</span>
                </div>
              </div>
            </div>

            {/* By Account Size */}
            <div>
              <h3 className="font-semibold text-lg mb-3">By Account Size</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Under $25K</span>
                  <span className="font-medium">Focus on 2-point (capital efficiency)</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$25K-$100K</span>
                  <span className="font-medium">Mix of 2-point and 5-point</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$100K-$250K</span>
                  <span className="font-medium">Mix of 5-point and 10-point</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">$250K+</span>
                  <span className="font-medium">All widths available, optimize for ROC</span>
                </div>
              </div>
            </div>

            {/* By Strategy */}
            <div>
              <h3 className="font-semibold text-lg mb-3">By Strategy</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Aggressive income</span>
                  <span className="font-medium">2-point spreads (higher ROC, more contracts)</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Balanced income</span>
                  <span className="font-medium">5-point spreads (best risk/reward)</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Conservative income</span>
                  <span className="font-medium">10-point spreads (lower stress, more buffer)</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Preview Dialog */}
      <UnifiedOrderPreviewModal
        open={showPreviewDialog}
        onOpenChange={setShowPreviewDialog}
        orders={unifiedOrders}
        strategy={strategyType === 'spread' ? 'bcs' : 'cc'}
        accountId={selectedAccountId || ''}
        availableBuyingPower={availableBuyingPower}
        holdings={holdings.map(pos => ({
          symbol: pos.symbol,
          quantity: pos.quantity,
          maxContracts: pos.maxContracts, // Use backend-calculated value (accounts for existing calls)
        }))}
        onSubmit={executeOrderSubmission}
        onPollStatuses={handlePollStatuses}
        allowQuantityEdit={true}
        tradingMode={tradingMode}
        submissionComplete={modalSubmissionComplete}
        finalOrderStatus={modalFinalOrderStatus}
        onSubmissionStateChange={(complete, status) => {
          setModalSubmissionComplete(complete);
          setModalFinalOrderStatus(status);
        }}
      />

      {/* Order Status Modal - Shows results after live submission */}
      <OrderStatusModal
        open={showStatusModal}
        onOpenChange={setShowStatusModal}
        orderStatuses={submissionStatuses}
        onPollStatuses={handlePollStatuses}
        accountId={selectedAccountId || ''}
      />

      {/* Safeguard Warning Modal - intercepts orders with violations */}
      <SafeguardWarningModal
        open={showSafeguardModal}
        warnings={safeguardWarnings}
        orderDescription={pendingOrderDescription}
        onProceed={() => {
          setShowSafeguardModal(false);
          if (pendingOrderAction) pendingOrderAction();
        }}
        onCancel={() => {
          setShowSafeguardModal(false);
          setSafeguardWarnings([]);
          setPendingOrderAction(null);
        }}
      />

      {/* AI Analysis Modal */}
      <Dialog open={showAiAnalysisModal} onOpenChange={setShowAiAnalysisModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto border-2 border-orange-500/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-400" />
              Score Explanation: {selectedAiAnalysis?.symbol} ${selectedAiAnalysis?.shortStrike}
              {selectedAiAnalysis?.longStrike && selectedAiAnalysis.longStrike > 0 && (
                <span className="text-orange-400"> / ${selectedAiAnalysis.longStrike}</span>
              )}
            </DialogTitle>
            <DialogDescription>
              AI-powered explanation of why this opportunity scored {selectedAiAnalysis?.score}/100
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Composite Score Badge */}
            <div className="flex items-center justify-center gap-3 p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/20">
              <span className="text-sm text-muted-foreground">Composite Score:</span>
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-lg px-3 py-1",
                  selectedAiAnalysis && selectedAiAnalysis.score >= 70 ? "bg-green-500/20 text-green-400 border-green-500/50" :
                  selectedAiAnalysis && selectedAiAnalysis.score >= 50 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/50" :
                  "bg-red-500/20 text-red-400 border-red-500/50"
                )}
              >
                {selectedAiAnalysis?.score}/100
              </Badge>
            </div>

            {/* AI Explanation */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {typeof selectedAiAnalysis?.explanation === 'string' 
                  ? selectedAiAnalysis.explanation
                  : JSON.stringify(selectedAiAnalysis?.explanation, null, 2)
                }
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Bollinger Band Chart Slide-out */}
      {chartSymbol && (
        <BollingerChartPanel
          symbol={chartSymbol.symbol}
          strikePrice={chartSymbol.strike}
          currentPrice={chartSymbol.currentPrice}
          onClose={() => setChartSymbol(null)}
        />
      )}
    </div>
  );
}
