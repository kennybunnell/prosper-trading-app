import { useAuth } from "@/_core/hooks/useAuth";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { exportToCSV } from "@/lib/utils";
import { useAccount } from "@/contexts/AccountContext";
import { useTradingMode } from "@/contexts/TradingModeContext";
import {
  Loader2,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Calendar,
  Target,
  Filter,
  ChevronDown,
  HelpCircle,
  X,
  Download,
  Sparkles,
  CheckSquare,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";

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

function getIVRankColor(ivRank: number | null): string {
  if (ivRank === null) return "bg-gray-500/20 text-gray-500 border-gray-500/50";
  
  // High IV Rank (60-100) = Green = Good for selling options
  if (ivRank >= 60) return "bg-green-500/20 text-green-500 border-green-500/50";
  // Medium IV Rank (30-59) = Yellow = Moderate
  if (ivRank >= 30) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
  // Low IV Rank (0-29) = Red = Avoid selling options
  return "bg-red-500/20 text-red-500 border-red-500/50";
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

// Live countdown component for progress dialog
function LiveCountdown({ startTime, totalSymbols, strategyType }: { startTime: number; totalSymbols: number; strategyType?: 'csp' | 'spread' }) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [estimatedTotal, setEstimatedTotal] = useState(0);
  
  useEffect(() => {
    // Time estimates based on real performance data:
    // CSP: 1.32 seconds per symbol (single-leg options)
    // Spread: 4.8 seconds per symbol (two-leg options with optimization)
    const secondsPerSymbol = strategyType === 'spread' ? 4.8 : 1.32;
    const estimatedTotalSeconds = totalSymbols * secondsPerSymbol;
    setEstimatedTotal(estimatedTotalSeconds);
    
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, estimatedTotalSeconds - elapsed);
      setRemainingSeconds(remaining);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [startTime, totalSymbols, strategyType]);
  
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const progressPercent = estimatedTotal > 0 ? Math.min(100, (elapsedSeconds / estimatedTotal) * 100) : 0;
  
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
      <div className="w-full space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Processing {totalSymbols} symbols...</span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-1000 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      <p className="text-lg font-semibold text-primary">
        {remainingSeconds > 0 ? (
          <>{minutes}:{seconds.toString().padStart(2, '0')} remaining</>
        ) : (
          <>Finishing up...</>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {strategyType === 'spread' ? 'Fetching spread chains...' : 'Fetching option chains...'}
      </p>
    </div>
  );
}
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { OrderPreviewDialog } from "@/components/OrderPreviewDialog";
import { HelpBadge } from "@/components/HelpBadge";
import { HelpDialog } from "@/components/HelpDialog";
import { HELP_CONTENT } from "@/lib/helpContent";

type ScoredOpportunity = {
  symbol: string;
  strike: number;
  currentPrice: number;
  expiration: string;
  dte: number;
  premium: number;
  bid: number;
  ask: number;
  premiumPct: number;
  weeklyPct: number;
  monthlyPct: number;
  annualPct: number;
  delta: number;
  theta: number;
  volume: number;
  openInterest: number;
  rsi: number | null;
  ivRank: number | null;
  bbPctB: number | null;
  spreadPct: number;
  collateral: number;
  roc: number;
  score: number;
};

type PresetFilter = 'conservative' | 'medium' | 'aggressive' | null;
type StrategyType = 'csp' | 'spread';
type SpreadWidth = 2 | 5 | 10;

// Feature flag for Bull Put Spreads (set to false to disable)
const ENABLE_SPREADS = true;

export default function CSPDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { mode: tradingMode } = useTradingMode();
  
  // Fetch user's background texture preferences
  const { data: backgroundPrefs } = trpc.settings.getBackgroundPreferences.useQuery();
  const backgroundOpacity = backgroundPrefs?.opacity ?? 8;
  const backgroundPattern = backgroundPrefs?.pattern ?? 'diagonal';
  
  // Generate CSS pattern based on user's selection
  const getPatternCSS = (pattern: string) => {
    switch (pattern) {
      case 'diagonal':
        return `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.03) 10px,
          rgba(255, 255, 255, 0.03) 20px
        )`;
      case 'crosshatch':
        return `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.03) 10px,
          rgba(255, 255, 255, 0.03) 20px
        ),
        repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.03) 10px,
          rgba(255, 255, 255, 0.03) 20px
        )`;
      case 'dots':
        return `radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1px)`;
      case 'woven':
        return `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, 0.02) 2px,
          rgba(255, 255, 255, 0.02) 4px
        ),
        repeating-linear-gradient(
          90deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, 0.02) 2px,
          rgba(255, 255, 255, 0.02) 4px
        )`;
      case 'none':
      default:
        return 'none';
    }
  };
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  // newSymbol state moved to EnhancedWatchlist component
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [presetFilter, setPresetFilter] = useState<PresetFilter>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [minDte, setMinDte] = useState<number>(7);
  // Strategy type and spread width (Phase 1: UI only)
  // Load strategy type from localStorage on page load
  const [strategyType, setStrategyType] = useState<StrategyType>(() => {
    const saved = localStorage.getItem('csp-strategy-type');
    return (saved === 'spread' ? 'spread' : 'csp') as StrategyType;
  });
  const [spreadWidth, setSpreadWidth] = useState<SpreadWidth>(5);
  const [strategyPanelCollapsed, setStrategyPanelCollapsed] = useState(false);
  const [showSpreadHelp, setShowSpreadHelp] = useState(false);
  // Live range filters
  const [deltaRange, setDeltaRange] = useState<[number, number]>([0, 1]);
  const [dteRange, setDteRange] = useState<[number, number]>([0, 90]);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [maxDte, setMaxDte] = useState<number>(30);
  const [portfolioSizeFilter, setPortfolioSizeFilter] = useState<Array<'small' | 'medium' | 'large'>>(['small', 'medium', 'large']);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [isFullyCollapsed, setIsFullyCollapsed] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [dryRun, setDryRun] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [orderProgress, setOrderProgress] = useState<{
    current: number;
    total: number;
    results: Array<{ symbol: string; status: 'pending' | 'success' | 'failed'; error?: string }>;
  }>({ current: 0, total: 0, results: [] });
  const [fetchProgress, setFetchProgress] = useState<{
    isOpen: boolean;
    current: number;
    total: number;
    completed: number;
    startTime: number | null;
    endTime: number | null;
  }>({ isOpen: false, current: 0, total: 0, completed: 0, startTime: null, endTime: null });
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [validationData, setValidationData] = useState<any>(null);
  const [showAiAnalysisModal, setShowAiAnalysisModal] = useState(false);
  const [selectedAiAnalysis, setSelectedAiAnalysis] = useState<{ symbol: string; strike: number; score: number; explanation: string | any[] } | null>(null);
  const [aiMode, setAiMode] = useState<'conservative' | 'aggressive'>('conservative');
  const [showTechnicalColumns, setShowTechnicalColumns] = useState(false);
  const [analyzingRowKey, setAnalyzingRowKey] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Fetch filter presets from database (use BPS presets for spread mode, CSP presets for single-leg mode)
  const { data: presets } = trpc[strategyType === 'spread' ? 'bpsFilters' : 'cspFilters'].getPresets.useQuery(undefined, { enabled: !!user });

  // Fetch accounts
  const { data: accounts = [] } = trpc.accounts.list.useQuery(undefined, { enabled: !!user });

  // Fetch user preferences for default account
  const { data: userPreferences } = trpc.userPreferences.get.useQuery(undefined, { enabled: !!user });

  // Auto-select default account if no account is selected
  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      // First try to use the default account from preferences
      if (userPreferences?.defaultTastytradeAccountId) {
        setSelectedAccountId(userPreferences.defaultTastytradeAccountId);
      } else {
        // If no default is set, auto-select the first account
        setSelectedAccountId(accounts[0].accountId);
      }
    }
  }, [userPreferences, selectedAccountId, accounts, setSelectedAccountId]);

  // Reset filters and clear preset when strategy type changes
  useEffect(() => {
    // Clear preset filter so new strategy's presets can be loaded
    setPresetFilter(null);
    // Reset filter ranges to defaults
    setDeltaRange([0, 1]);
    setDteRange([0, 90]);
    setScoreRange([0, 100]);
    setMinScore(undefined);
  }, [strategyType]);

  // Show toast notification on page load if strategy was just changed
  useEffect(() => {
    const justSwitched = sessionStorage.getItem('strategy-just-switched');
    if (justSwitched === 'true') {
      sessionStorage.removeItem('strategy-just-switched');
      toast.info('Strategy changed', {
        description: `Switched to ${strategyType === 'csp' ? 'Cash-Secured Put' : 'Bull Put Spread'}. Click Fetch to load new opportunities.`
      });
    }
  }, []); // Run once on mount

  // Get selected account details
  const selectedAccount = accounts.find((acc: any) => acc.accountId === selectedAccountId);

  // Fetch account balances for buying power
  const { data: balances } = trpc.account.getBalances.useQuery(
    { accountNumber: selectedAccount?.accountNumber || '' },
    { enabled: !!selectedAccount?.accountNumber && tradingMode === 'live' }
  );

  // Fetch paper trading balance
  const { data: paperBalance } = trpc.paperTrading.getBalance.useQuery(
    undefined,
    { enabled: tradingMode === 'paper' }
  );

  // Fetch watchlist with 5-minute cache
  const { data: watchlist = [], isLoading: loadingWatchlist } = trpc.watchlist.get.useQuery(
    undefined,
    { 
      enabled: !!user,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      retry: 3, // Retry 3 times on failure
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    }
  );

  // Fetch ticker selections with 5-minute cache
  const { data: selections = [] } = trpc.watchlist.getSelections.useQuery(
    undefined, 
    { 
      enabled: !!user,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      retry: 3, // Retry 3 times on failure
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    }
  );
  
  // Fetch opportunities (only when user clicks "Fetch Opportunities")
  // Filter watchlist by selected portfolio sizes AND ticker selections
  const filteredWatchlist = useMemo(() => {
    let filtered = watchlist;
    
    // Filter by portfolio size
    if (portfolioSizeFilter.length < 3) {
      filtered = filtered.filter((w: any) => 
        !w.portfolioSize || portfolioSizeFilter.includes(w.portfolioSize)
      );
    }
    
    // Filter by selected tickers (if any are selected)
    const selectedSymbols = selections
      .filter((s: any) => s.isSelected === 1)
      .map((s: any) => s.symbol);
    
    if (selectedSymbols.length > 0) {
      filtered = filtered.filter((w: any) => selectedSymbols.includes(w.symbol));
    }
    
    return filtered;
  }, [watchlist, portfolioSizeFilter, selections]);

  // Fetch CSP opportunities
  const { data: cspOpportunities = [], isLoading: loadingCSP, refetch: refetchCSP, error: cspError } = trpc.csp.opportunities.useQuery(
    { 
      symbols: filteredWatchlist.map((w: any) => w.symbol),
      minDte,
      maxDte,
    },
    { enabled: false } // Disabled by default, only fetch when user clicks button
  );

  // Fetch spread opportunities (Phase 2)
  const { data: spreadOpportunities = [], isLoading: loadingSpread, refetch: refetchSpread, error: spreadError } = trpc.spread.opportunities.useQuery(
    { 
      symbols: filteredWatchlist.map((w: any) => w.symbol),
      minDte,
      maxDte,
      spreadWidth,
    },
    { enabled: false } // Disabled by default, only fetch when user clicks button
  );

  // Use appropriate data based on strategy type
  const opportunities = strategyType === 'spread' ? spreadOpportunities : cspOpportunities;
  const loadingOpportunities = strategyType === 'spread' ? loadingSpread : loadingCSP;
  const refetchOpportunities = strategyType === 'spread' ? refetchSpread : refetchCSP;
  const opportunitiesError = strategyType === 'spread' ? spreadError : cspError;

  // Handle opportunities fetch errors
  useEffect(() => {
    if (opportunitiesError) {
      if (opportunitiesError.message.includes('Account not found')) {
        toast.error('Tastytrade account not configured', {
          description: 'Please configure your Tastytrade credentials in Settings to fetch opportunities.',
          action: {
            label: 'Go to Settings',
            onClick: () => window.location.href = '/settings'
          }
        });
      } else {
        toast.error('Failed to fetch opportunities', {
          description: opportunitiesError.message
        });
      }
      setFetchProgress(prev => ({ ...prev, isOpen: false }));
    }
  }, [opportunitiesError]);

  // Track when loading completes to set endTime
  useEffect(() => {
    if (!loadingOpportunities && fetchProgress.startTime && !fetchProgress.endTime) {
      setFetchProgress(prev => ({ ...prev, endTime: Date.now() }));
    }
  }, [loadingOpportunities, fetchProgress.startTime, fetchProgress.endTime]);

  // Watchlist mutations are now handled by EnhancedWatchlist component

  // Apply preset filters
  const filteredOpportunities = useMemo(() => {
    console.log('[CSP Dashboard] Filtering opportunities:', {
      totalOpportunities: opportunities.length,
      presetFilter,
      presetsAvailable: !!presets,
      presetsCount: presets?.length
    });
    
    let filtered = [...opportunities];

    //     // Apply preset filter if active
    if (presetFilter && presets) {
      const preset = presets.find(p => p.presetName === presetFilter);
      if (preset) {

        filtered = filtered.filter(opp => {
          const delta = Math.abs(opp.delta);
          const minDelta = parseFloat(preset.minDelta);
          const maxDelta = parseFloat(preset.maxDelta);
          
          // Delta filter
          if (delta < minDelta || delta > maxDelta) return false;
          
          // DTE filter
          if (opp.dte < preset.minDte || opp.dte > preset.maxDte) return false;
          
          // Open Interest filter
          if (opp.openInterest < preset.minOpenInterest) return false;
          
          // Volume filter
          if (opp.volume < preset.minVolume) return false;
          
          // Score filter
          if (opp.score < preset.minScore) return false;
          
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
          
          // Strike price filter (max % of stock price)
          const strikePct = (opp.strike / opp.currentPrice) * 100;
          if (strikePct > preset.maxStrikePercent) return false;
          
          return true;
        });

      }
    }

    // Apply live range filters (always applied, independent of presets)
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

    // Apply "Selected Only" filter
    if (showSelectedOnly) {
      filtered = filtered.filter(opp => 
        selectedOpportunities.has(`${opp.symbol}-${opp.strike}-${opp.expiration}`)
      );
    }

    // Sort opportunities
    filtered.sort((a, b) => {
      const aVal = (a as any)[sortColumn];
      const bVal = (b as any)[sortColumn];
      
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [opportunities, presetFilter, presets, minScore, showSelectedOnly, sortColumn, sortDirection, deltaRange, dteRange, scoreRange, selectedOpportunities]);

  // Calculate summary metrics
  const selectedOppsList = opportunities.filter(opp => 
    selectedOpportunities.has(`${opp.symbol}-${opp.strike}-${opp.expiration}`)
  );
  const totalPremium = selectedOppsList.reduce((sum, opp) => sum + (opp.premium * 100), 0);
  
  // For spreads, use capitalAtRisk instead of full collateral
  const totalCollateral = strategyType === 'spread'
    ? selectedOppsList.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
    : selectedOppsList.reduce((sum, opp) => sum + opp.collateral, 0);
  
  const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;

  // Calculate buying power metrics
  const availableBuyingPower = tradingMode === 'paper' 
    ? (paperBalance?.buyingPower || 0)
    : Number(balances?.['cash-buying-power'] || balances?.['derivative-buying-power'] || 0);
  const buyingPowerUsedPct = availableBuyingPower > 0 ? (totalCollateral / availableBuyingPower) * 100 : 0;
  const overLimit = totalCollateral > availableBuyingPower ? totalCollateral - availableBuyingPower : 0;
  const buyingPowerColor = buyingPowerUsedPct < 80 ? 'text-green-500' : buyingPowerUsedPct < 90 ? 'text-yellow-500' : 'text-red-500';
  const buyingPowerBgColor = buyingPowerUsedPct < 80 ? 'bg-green-500/10' : buyingPowerUsedPct < 90 ? 'bg-yellow-500/10' : 'bg-red-500/10';

  // Play success sound
  const playSuccessSound = () => {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnMpBSuBzvLZiTYIGWi77eefTRAMUKfj8LZjHAY4ktfyzHksBSR3x/DdkEAKFF606+uoVRQKRp/g8r5sIQUxh9Hz04IzBh5uwO/jmUgND1as5++wXRgIPpba8sZzKQUrgc7y2Yk2CBlou+3nn00QDFCn4/C2YxwGOJLX8sx5LAUkd8fw3ZBAC'); audio.play().catch(() => {});
  };

  // Validate orders mutation
  const validateOrders = trpc.csp.validateOrders.useMutation({
    onSuccess: (data) => {
      setValidationData(data);
      setShowPreviewDialog(true);
    },
    onError: (error) => {
      // Dismiss progress toast
      toast.dismiss('order-submission-progress');
      
      if (error.message.includes('Account not found')) {
        toast.error('No Tastytrade account found. Please configure your account in Settings.', {
          action: {
            label: 'Go to Settings',
            onClick: () => window.location.href = '/settings',
          },
        });
      } else if (error.message.includes('credentials not configured')) {
        toast.error('Tastytrade credentials not configured. Please add your API credentials in Settings.', {
          action: {
            label: 'Go to Settings',
            onClick: () => window.location.href = '/settings',
          },
        });
      } else {
        toast.error(`Validation failed: ${error.message}`);
      }
    },
  });

  // Explain score mutation
  const explainScore = trpc.csp.explainScore.useMutation({
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

  // Submit orders mutation
  const submitOrders = trpc.csp.submitOrders.useMutation({
    onMutate: (variables) => {
      // Show initial progress toast
      const orderCount = variables.orders.length;
      const isDryRun = variables.dryRun;
      toast.loading(
        isDryRun 
          ? `Validating ${orderCount} order${orderCount > 1 ? 's' : ''}...`
          : `Submitting ${orderCount} order${orderCount > 1 ? 's' : ''}...`,
        { id: 'order-submission-progress' }
      );
    },
    onError: (error) => {
      // Dismiss progress toast
      toast.dismiss('order-submission-progress');
      
      if (error.message.includes('Account not found')) {
        toast.error('No Tastytrade account found. Please configure your account in Settings.', {
          action: {
            label: 'Go to Settings',
            onClick: () => window.location.href = '/settings',
          },
        });
      } else if (error.message.includes('credentials not configured')) {
        toast.error('Tastytrade credentials not configured. Please add your API credentials in Settings.', {
          action: {
            label: 'Go to Settings',
            onClick: () => window.location.href = '/settings',
          },
        });
      } else {
        toast.error(`Order submission failed: ${error.message}`);
      }
    },
    onSuccess: (data, variables) => {
      // Dismiss progress toast
      toast.dismiss('order-submission-progress');
      
      setShowProgressDialog(false);
      const isDryRun = variables.dryRun;
      
      if (data.success) {
        if (isDryRun) {
          // Dry run validation success
          toast.success(`✓ ${data.results.length} order(s) validated successfully (Dry Run)`, {
            duration: 4000,
          });
        } else {
          // Live order submission success
          toast.success(`✅ Successfully submitted ${data.results.length} order${data.results.length > 1 ? 's' : ''}!`, {
            duration: 5000,
          });
          playSuccessSound();
          confetti({
            particleCount: 200,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#10b981', '#3b82f6', '#8b5cf6'],
          });
          setTimeout(() => {
            confetti({
              particleCount: 100,
              angle: 60,
              spread: 55,
              origin: { x: 0 },
            });
            confetti({
              particleCount: 100,
              angle: 120,
              spread: 55,
              origin: { x: 1 },
            });
          }, 250);
          setSelectedOpportunities(new Set());
          utils.csp.opportunities.invalidate();
        }
      } else {
        const failedCount = data.results.filter(r => !r.success).length;
        const successCount = data.results.filter(r => r.success).length;
        
        if (isDryRun) {
          // Dry run validation failures
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
          // Live order submission failures
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
        
        // Log failed orders for debugging
        const failedOrders = data.results.filter(r => !r.success);
        console.error('[Order Submission] Failed orders:', JSON.stringify(failedOrders, null, 2));
      }
      setShowProgressDialog(false);
    },
  });

  // Handle Smart Select - score-based auto-selection
  const handleSmartSelect = () => {
    if (filteredOpportunities.length === 0) {
      toast.error('No opportunities to analyze');
      return;
    }
    
    // Determine score threshold based on mode
    const scoreThreshold = aiMode === 'conservative' ? 70 : 55;
    
    // Select all opportunities that meet the score threshold
    const selectedKeys = new Set<string>();
    filteredOpportunities.forEach(opp => {
      if (opp.score >= scoreThreshold) {
        const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
        selectedKeys.add(key);
      }
    });
    
    setSelectedOpportunities(selectedKeys);
    
    toast.success(
      `Smart Select complete: ${selectedKeys.size} opportunities selected (Score ≥${scoreThreshold})`,
      { duration: 5000 }
    );
  };

  // Toggle opportunity selection
  const toggleOpportunity = (opp: ScoredOpportunity) => {
    const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
    const newSelected = new Set(selectedOpportunities);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedOpportunities(newSelected);
  };

  // Handle score button click
  const handleScoreFilter = (score: number) => {
    setMinScore(score);
    setPresetFilter(null); // Clear preset when using score filter
  };

  // Handle preset button click
  const handlePresetFilter = (preset: PresetFilter) => {
    console.log('[CSP Dashboard] Preset filter clicked:', preset);
    console.log('[CSP Dashboard] Available presets:', presets);
    setPresetFilter(preset);
    setMinScore(undefined); // Clear score filter when using preset
  };

  // Handle submit orders - now triggers validation first
  const handleSubmitOrders = () => {
    if (selectedOppsList.length === 0) {
      toast.error("Please select at least one opportunity");
      return;
    }

    if (!selectedAccountId) {
      toast.error("Please select an account in the sidebar");
      return;
    }

    // Validate orders and show preview dialog
    const orders = selectedOppsList.map(opp => ({
      symbol: opp.symbol,
      strike: opp.strike,
      expiration: opp.expiration,
      quantity: 1, // Default quantity, can be adjusted in preview dialog
      premium: opp.premium,
      bid: opp.bid,
      ask: opp.ask,
      mid: (opp.bid + opp.ask) / 2,
      collateral: strategyType === 'spread' ? (opp as any).capitalAtRisk : (opp.strike * 100),
      status: 'valid' as const,
      currentPrice: opp.currentPrice,
      ivRank: opp.ivRank,
      // Spread-specific fields
      isSpread: strategyType === 'spread',
      spreadType: strategyType === 'spread' ? 'bull_put' as const : undefined,
      longStrike: strategyType === 'spread' ? (opp as any).longStrike : undefined,
      spreadWidth: strategyType === 'spread' ? spreadWidth : undefined,
      capitalAtRisk: strategyType === 'spread' ? (opp as any).capitalAtRisk : undefined,
    }));

    validateOrders.mutate({
      orders,
      accountId: selectedAccountId,
    });
  };

  // Execute order submission with midpoint pricing from validation
  const executeOrderSubmission = (adjustedPrices?: Map<number, number>) => {
    setShowPreviewDialog(false);
    setShowProgressDialog(true);
    
    if (!validationData) {
      toast.error("Validation data not available");
      return;
    }

    // Use validated orders with midpoint pricing
      // Round premium to nearest $0.05 (Tastytrade requirement)
      const roundToNickel = (price: number) => Math.round(price * 20) / 20;
      
      // Helper function to build option symbol
      const buildOptionSymbol = (symbol: string, expiration: string, strike: number) => {
        const expFormatted = expiration.replace(/-/g, ''); // YYYYMMDD
        const expShort = expFormatted.substring(2); // YYMMDD
        const strikeFormatted = (strike * 1000).toString().padStart(8, '0');
        const ticker = symbol.padEnd(6, ' ');
        return `${ticker}${expShort}P${strikeFormatted}`;
      };
      
      const orderLegs = validationData.orders.map((validatedOrder: any, idx: number) => {
      const opp = selectedOppsList.find(
        o => o.symbol === validatedOrder.symbol && 
             o.strike === validatedOrder.strike && 
             o.expiration === validatedOrder.expiration
      );
      
      // Check if this is a spread order
      const isSpread = validatedOrder.isSpread || strategyType === 'spread';
      
      if (isSpread) {
        // Bull Put Spread: Two legs
        return {
          symbol: validatedOrder.symbol,
          strike: validatedOrder.strike,
          expiration: validatedOrder.expiration,
          premium: roundToNickel((adjustedPrices?.get(idx) ?? validatedOrder.premium) / 100),
          isSpread: true,
          // Leg 1: Sell to Open (short put at higher strike)
          shortLeg: {
            optionSymbol: buildOptionSymbol(validatedOrder.symbol, validatedOrder.expiration, validatedOrder.strike),
            action: 'Sell to Open' as const,
          },
          // Leg 2: Buy to Open (long put at lower strike)
          longLeg: {
            optionSymbol: buildOptionSymbol(validatedOrder.symbol, validatedOrder.expiration, validatedOrder.longStrike || (validatedOrder.strike - (validatedOrder.spreadWidth || spreadWidth))),
            action: 'Buy to Open' as const,
          },
        };
      } else {
        // Regular CSP: Single leg
        return {
          symbol: validatedOrder.symbol,
          strike: validatedOrder.strike,
          expiration: validatedOrder.expiration,
          premium: roundToNickel((adjustedPrices?.get(idx) ?? validatedOrder.premium) / 100),
          isSpread: false,
          optionSymbol: buildOptionSymbol(validatedOrder.symbol, validatedOrder.expiration, validatedOrder.strike),
        };
      }
    });

    setOrderProgress({
      current: 0,
      total: orderLegs.length,
      results: orderLegs.map((o: any) => ({ symbol: o.symbol, status: 'pending' })),
    });

    if (!selectedAccountId) {
      toast.error("Please select an account");
      return;
    }

    submitOrders.mutate({
      orders: orderLegs,
      accountId: selectedAccountId,
      dryRun: dryRun,
    });
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Please log in to access the CSP Dashboard</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* Background texture pattern */}
      {backgroundPattern !== 'none' && (
        <div 
          className="absolute inset-0 pointer-events-none" 
          style={{
            backgroundImage: getPatternCSS(backgroundPattern),
            backgroundSize: backgroundPattern === 'dots' ? '20px 20px' : 'auto',
            opacity: backgroundOpacity / 100
          }}
        />
      )}
      {/* Simple Header */}
      <div className="container py-8 relative z-10">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 bg-clip-text text-transparent">
              Cash-Secured Puts
            </h1>
            <p className="text-lg text-muted-foreground">
              Analyze and execute CSP strategies with dual scoring system
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Page
            </Button>
            <ConnectionStatusIndicator />
          </div>
        </div>
      </div>
      
      <div className="container mx-auto py-8 space-y-8 relative z-10">

      {/* Strategy Type Selection (Phase 1: UI Only) */}
      {ENABLE_SPREADS && (
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
                      {strategyType === 'csp' ? 'CSP Mode' : `Bull Put Spread - ${spreadWidth}pt`}
                    </Badge>
                  )}
                </CardTitle>
                {!strategyPanelCollapsed && (
                  <CardDescription>
                    Choose between Cash-Secured Puts or Bull Put Spreads
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
            {/* Strategy Toggle with Clear Button */}
            <div className="space-y-3">
              <div className="flex gap-3">
                <Button
                  variant={strategyType === 'csp' ? 'default' : 'outline'}
                  onClick={() => {
                    if (strategyType !== 'csp') {
                      // Save strategy selection to localStorage
                      localStorage.setItem('csp-strategy-type', 'csp');
                      // Set flag to show toast after reload
                      sessionStorage.setItem('strategy-just-switched', 'true');
                      // Reload page to reset everything
                      window.location.reload();
                    }
                  }}
                  className={cn(
                    "flex-1 relative overflow-hidden transition-all duration-300",
                    strategyType === 'csp'
                      ? "bg-gradient-to-r from-amber-600 to-yellow-700 hover:from-amber-700 hover:to-yellow-800 text-white shadow-lg"
                      : "hover:bg-amber-500/10 hover:border-amber-500/50"
                  )}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-current" />
                    Cash-Secured Put
                  </span>
                </Button>
                <Button
                  variant={strategyType === 'spread' ? 'default' : 'outline'}
                  onClick={() => {
                    if (strategyType !== 'spread') {
                      // Save strategy selection to localStorage
                      localStorage.setItem('csp-strategy-type', 'spread');
                      // Set flag to show toast after reload
                      sessionStorage.setItem('strategy-just-switched', 'true');
                      // Reload page to reset everything
                      window.location.reload();
                    }
                  }}
                  className={cn(
                    "flex-1 relative overflow-hidden transition-all duration-300",
                    strategyType === 'spread'
                      ? "bg-gradient-to-r from-blue-600 to-cyan-700 hover:from-blue-700 hover:to-cyan-800 text-white shadow-lg"
                      : "hover:bg-blue-500/10 hover:border-blue-500/50"
                  )}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-current" />
                    Bull Put Spread
                  </span>
                </Button>
              </div>
              
              {/* Export Button Only */}
              {opportunities.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const timestamp = new Date().toISOString().split('T')[0];
                      const strategyName = strategyType === 'csp' ? 'CSP' : 'BullPutSpread';
                      exportToCSV(opportunities, `${strategyName}_Opportunities_${timestamp}`);
                      toast.success(`Exported ${opportunities.length} opportunities to CSV`);
                    }}
                    className="w-full"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
              )}
            </div>

            {/* Spread Width Selector (only show when spread selected) */}
            {strategyType === 'spread' && (
              <div className="space-y-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <Label className="text-sm font-semibold">Spread Width</Label>
                <div className="flex gap-3">
                  <Button
                    variant={spreadWidth === 2 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSpreadWidth(2)}
                    className={cn(
                      "flex-1",
                      spreadWidth === 2
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "hover:bg-blue-500/10 hover:border-blue-500/50"
                    )}
                  >
                    2 points
                  </Button>
                  <Button
                    variant={spreadWidth === 5 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSpreadWidth(5)}
                    className={cn(
                      "flex-1",
                      spreadWidth === 5
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "hover:bg-blue-500/10 hover:border-blue-500/50"
                    )}
                  >
                    5 points
                  </Button>
                  <Button
                    variant={spreadWidth === 10 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSpreadWidth(10)}
                    className={cn(
                      "flex-1",
                      spreadWidth === 10
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "hover:bg-blue-500/10 hover:border-blue-500/50"
                    )}
                  >
                    10 points
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {spreadWidth === 2 && "Narrow spread - Lower capital efficiency, higher win rate"}
                  {spreadWidth === 5 && "Balanced spread - Good capital efficiency and win rate"}
                  {spreadWidth === 10 && "Wide spread - Maximum capital efficiency, lower win rate"}
                </p>
              </div>
            )}

            {/* Info banner */}
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <p className="text-sm text-muted-foreground">
                {strategyType === 'csp' ? (
                  <>💰 <strong>CSP Mode:</strong> Requires full collateral ($15,000 for $150 strike). Can be assigned stock if ITM at expiration.</>
                ) : (
                  <>🎯 <strong>Spread Mode:</strong> Defined risk ($425 for 5pt spread). Capital efficient - 97% less collateral than CSP. Both legs execute simultaneously.</>
                )}
              </p>
            </div>
          </CardContent>
          )}
        </Card>
      )}

      {/* Watchlist Management - Full Collapse Mode */}
      {isFullyCollapsed ? (
        <div className="flex items-center justify-between p-6 bg-card/50 backdrop-blur border border-border/50 rounded-lg shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-base font-semibold">📊 Watchlist ({watchlist.length} symbols)</span>
              <span className="text-sm text-muted-foreground">Opportunities fetched • Ready to filter</span>
            </div>
            <div className="flex gap-1 ml-4">
              {watchlist.slice(0, 8).map((item: any) => (
                <Badge key={item.id} variant="secondary" className="text-xs">
                  {item.symbol}
                </Badge>
              ))}
              {watchlist.length > 8 && (
                <Badge variant="secondary" className="text-xs">+{watchlist.length - 8} more</Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!selectedAccountId) {
                  toast.error('Please select an account first');
                  return;
                }
                setFetchProgress({ isOpen: true, current: 0, total: filteredWatchlist.length, completed: 0, startTime: Date.now(), endTime: null });
                setTimeout(() => {
                  setFetchProgress(prev => ({ ...prev, isOpen: false, completed: filteredWatchlist.length }));
                }, 100);
                refetchOpportunities();
              }}
              disabled={loadingOpportunities || filteredWatchlist.length === 0}
              className="hover:bg-primary/10 hover:border-primary/50 transition-colors"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullyCollapsed(false)}
              className="hover:bg-primary/10 hover:border-primary/50 transition-colors"
            >
              <ChevronDown className="w-4 h-4 mr-2" />
              Expand Watchlist
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Watchlist Management */}
          <EnhancedWatchlist 
            onWatchlistChange={() => utils.watchlist.get.invalidate()}
            isCollapsed={watchlistCollapsed}
            onToggleCollapse={() => setWatchlistCollapsed(!watchlistCollapsed)}
            onFullCollapse={() => {
              setIsFullyCollapsed(true);
              setTimeout(() => {
                document.querySelector('[data-section="filters"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 100);
            }}
          />

          {/* DTE Range & Fetch Options */}
          <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle>Fetch Options</CardTitle>
          <CardDescription>Configure and fetch CSP opportunities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Portfolio Size Filter */}
          <div>
            <Label className="mb-2 block flex items-center gap-1">
              Portfolio Size
              <HelpDialog title="Portfolio Size Filter" content={HELP_CONTENT.PORTFOLIO_SIZE_DIALOG} />
            </Label>
            {/* Option 1: Gradient Pills with Icon Badges */}
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
                  if (!selectedAccountId) {
                    toast.error('Please select an account first');
                    return;
                  }
                  setPortfolioSizeFilter(['small']);
                  const symbolCount = watchlist.filter((w: any) => w.portfolioSize === 'small').length;
                  setFetchProgress({
                    isOpen: true,
                    current: 0,
                    total: symbolCount,
                    completed: 0,
                    startTime: Date.now(),
                    endTime: null,
                  });
                  setTimeout(() => refetchOpportunities().then(() => setWatchlistCollapsed(true)), 100);
                }}
                disabled={loadingOpportunities}
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
                  if (!selectedAccountId) {
                    toast.error('Please select an account first');
                    return;
                  }
                  setPortfolioSizeFilter(['medium']);
                  const symbolCount = watchlist.filter((w: any) => w.portfolioSize === 'medium').length;
                  setFetchProgress({
                    isOpen: true,
                    current: 0,
                    total: symbolCount,
                    completed: 0,
                    startTime: Date.now(),
                    endTime: null,
                  });
                  setTimeout(() => refetchOpportunities().then(() => setWatchlistCollapsed(true)), 100);
                }}
                disabled={loadingOpportunities}
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
                  if (!selectedAccountId) {
                    toast.error('Please select an account first');
                    return;
                  }
                  setPortfolioSizeFilter(['large']);
                  const symbolCount = watchlist.filter((w: any) => w.portfolioSize === 'large').length;
                  setFetchProgress({
                    isOpen: true,
                    current: 0,
                    total: symbolCount,
                    completed: 0,
                    startTime: Date.now(),
                    endTime: null,
                  });
                  setTimeout(() => refetchOpportunities().then(() => setWatchlistCollapsed(true)), 100);
                }}
                disabled={loadingOpportunities}
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

          {/* Fetch Button */}
          <Button 
            onClick={() => {
              if (!selectedAccountId) {
                toast.error('No account selected', {
                  description: 'Please select an account from the dropdown in the sidebar to continue.'
                });
                setFetchProgress(prev => ({ ...prev, isOpen: false }));
                return;
              }
              const symbolCount = filteredWatchlist.length;
              setFetchProgress({
                isOpen: true,
                current: 0,
                total: symbolCount,
                completed: 0,
                startTime: Date.now(),
                endTime: null,
              });
              refetchOpportunities();
            }} 
            disabled={loadingOpportunities || filteredWatchlist.length === 0 || !selectedAccountId}
            className="w-full bg-gradient-to-r from-amber-600 to-yellow-700 hover:from-amber-700 hover:to-yellow-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02]"
          >
            {loadingOpportunities ? (
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
        </CardContent>
      </Card>
        </>
      )}


      {/* Summary Cards - Show totals for ALL opportunities (before filtering) */}
      {opportunities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
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
                ${opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0).toFixed(2)}
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
                    ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                    : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
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
                  const totalPrem = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);
                  const totalColl = strategyType === 'spread'
                    ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                    : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
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
                {opportunities.length}
              </div>
            </CardContent>
          </Card>

          <Card className={cn(
            "relative overflow-hidden backdrop-blur shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]",
            (() => {
              const totalColl = strategyType === 'spread'
                ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
              const availableBP = availableBuyingPower;
              const usedPct = availableBP > 0 ? (totalColl / availableBP) * 100 : 0;
              return usedPct > 80 
                ? "bg-gradient-to-br from-red-500/10 to-rose-500/5 border-red-500/20" 
                : "bg-gradient-to-br from-emerald-500/10 to-green-500/5 border-emerald-500/20";
            })()
          )}>
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
            <CardHeader className="pb-2 relative">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <div className={cn(
                  "p-2 rounded-lg",
                  (() => {
                    const totalColl = strategyType === 'spread'
                      ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                      : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
                    const availableBP = availableBuyingPower;
                    const usedPct = availableBP > 0 ? (totalColl / availableBP) * 100 : 0;
                    return usedPct > 80 ? "bg-red-500/20" : "bg-emerald-500/20";
                  })()
                )}>
                  <TrendingUp className={cn(
                    "w-4 h-4",
                    (() => {
                      const totalColl = strategyType === 'spread'
                        ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                        : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
                      const availableBP = availableBuyingPower;
                      const usedPct = availableBP > 0 ? (totalColl / availableBP) * 100 : 0;
                      return usedPct > 80 ? "text-red-400" : "text-emerald-400";
                    })()
                  )} />
                </div>
                <span className="text-muted-foreground flex items-center gap-1">
                  Buying Power
                  <HelpBadge content={HELP_CONTENT.BUYING_POWER_USAGE} />
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              <div className={cn(
                "text-3xl font-bold bg-gradient-to-r bg-clip-text text-transparent",
                (() => {
                  const totalColl = strategyType === 'spread'
                    ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                    : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
                  const availableBP = availableBuyingPower;
                  const usedPct = availableBP > 0 ? (totalColl / availableBP) * 100 : 0;
                  return usedPct > 80 
                    ? "from-red-400 to-rose-400" 
                    : "from-emerald-400 to-green-400";
                })()
              )}>
                {(() => {
                  const totalColl = strategyType === 'spread'
                    ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                    : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
                  const availableBP = availableBuyingPower;
                  const usedPct = availableBP > 0 ? (totalColl / availableBP) * 100 : 0;
                  return usedPct.toFixed(1);
                })()}%
              </div>
              <div className={cn(
                "text-3xl font-bold mt-2",
                (() => {
                  const totalColl = strategyType === 'spread'
                    ? opportunities.reduce((sum, opp) => sum + ((opp as any).capitalAtRisk || 0), 0)
                    : opportunities.reduce((sum, opp) => sum + (opp.strike * 100), 0);
                  const availableBP = availableBuyingPower;
                  const usedPct = availableBP > 0 ? (totalColl / availableBP) * 100 : 0;
                  return usedPct > 80 ? "text-red-400" : "text-emerald-400";
                })()
              )}>
                ${(() => {
                  const availableBP = availableBuyingPower;
                  return availableBP.toLocaleString(undefined, { maximumFractionDigits: 0 });
                })()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                available
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="bg-card/50 backdrop-blur border-border/50" data-section="filters">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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


        </CardContent>
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

        <Card className={cn(
          "relative overflow-hidden backdrop-blur shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]",
          buyingPowerUsedPct > 80 
            ? "bg-gradient-to-br from-red-500/10 to-rose-500/5 border-red-500/20" 
            : "bg-gradient-to-br from-emerald-500/10 to-green-500/5 border-emerald-500/20"
        )}>
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className={cn(
                "p-2 rounded-lg",
                buyingPowerUsedPct > 80 ? "bg-red-500/20" : "bg-emerald-500/20"
              )}>
                <TrendingUp className={cn(
                  "w-4 h-4",
                  buyingPowerUsedPct > 80 ? "text-red-400" : "text-emerald-400"
                )} />
              </div>
              <span className="text-muted-foreground flex items-center gap-1">
                Buying Power
                <HelpBadge content={HELP_CONTENT.BUYING_POWER_USAGE} />
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className={cn(
              "text-3xl font-bold bg-gradient-to-r bg-clip-text text-transparent",
              buyingPowerUsedPct > 80 
                ? "from-red-400 to-rose-400" 
                : "from-emerald-400 to-green-400"
            )}>
              {buyingPowerUsedPct.toFixed(1)}%
            </div>
            <div className={cn(
              "text-3xl font-bold mt-2",
              buyingPowerUsedPct > 80 ? "text-red-400" : "text-emerald-400"
            )}>
              ${availableBuyingPower.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              available
            </div>
            {overLimit > 0 && (
              <div className="text-xs text-red-400 font-semibold mt-1 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                Over Limit: ${overLimit.toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Selection Controls - Moved above table for better visibility */}
      {opportunities.length > 0 && (
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5" />
              Selection Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Button
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
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
                className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
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
          </CardContent>
        </Card>
      )}

      {/* Opportunities Table */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Opportunities ({filteredOpportunities.length})</CardTitle>
              <CardDescription>
                {selectedOppsList.length > 0 && `${selectedOppsList.length} selected`}
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowTechnicalColumns(!showTechnicalColumns)}
              variant="outline"
              size="sm"
              className="border-border/50 hover:border-border"
            >
              {showTechnicalColumns ? (
                <>
                  <ChevronDown className="w-4 h-4 mr-1" />
                  Hide Technical Columns
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-1 rotate-180" />
                  Show Technical Columns
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Dry Run Checkbox and Test Button - moved to top */}
          {selectedOppsList.length > 0 && (
            <div className="mb-4 flex items-center justify-between gap-4 p-3 bg-muted/30 rounded-lg border border-border/50">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dry-run-top"
                  checked={tradingMode === 'paper' ? true : dryRun}
                  onCheckedChange={(checked) => setDryRun(checked as boolean)}
                  disabled={tradingMode === 'paper'}
                />
                <Label htmlFor="dry-run-top" className="cursor-pointer text-sm flex items-center gap-1">
                  Dry Run (test without submitting real orders)
                  <HelpDialog title="Dry Run Mode" content={HELP_CONTENT.DRY_RUN_MODE_DIALOG} />
                </Label>
              </div>
              <div className="flex flex-col items-end gap-2">
                {tradingMode === 'paper' && (
                  <p className="text-sm text-blue-500 font-semibold">
                    ⓘ Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.
                  </p>
                )}
                {overLimit > 0 && tradingMode !== 'paper' && (
                  <p className="text-sm text-red-500 font-semibold">
                    Cannot submit orders: Total collateral exceeds buying power by ${overLimit.toFixed(2)}
                  </p>
                )}
                <Button
                  onClick={handleSubmitOrders}
                  disabled={submitOrders.isPending || overLimit > 0 || (tradingMode === 'paper' && !dryRun)}
                  size="lg"
                  className={cn(
                    dryRun 
                      ? "bg-blue-600 hover:bg-blue-700" 
                      : "bg-red-600 hover:bg-red-700 font-bold"
                  )}
                  title={(tradingMode === 'paper' && !dryRun) ? 'Order submission is disabled in Paper Trading mode. Enable Dry Run to test orders.' : undefined}
                >
                  {submitOrders.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {dryRun ? 'Testing...' : 'Submitting LIVE Orders...'}
                    </>
                  ) : (
                    <>
                      {!dryRun && '⚠️ '}
                      {dryRun ? 'Test' : 'Submit LIVE'} {selectedOppsList.length} Order(s)
                      {!dryRun && ' ⚠️'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Select</TableHead>
                  {(strategyType === 'spread' ? [
                    { key: 'symbol', label: 'Symbol', help: null, technical: false },
                    { key: 'strike', label: 'Strikes', help: null, technical: false },
                    { key: 'currentPrice', label: 'Current', help: null, technical: false },
                    { key: 'netCredit', label: 'Net Credit', help: HELP_CONTENT.NET_CREDIT, technical: false },
                    { key: 'capitalAtRisk', label: 'Capital Risk', help: HELP_CONTENT.CAPITAL_AT_RISK, technical: false },
                    { key: 'spreadROC', label: 'ROC %', help: HELP_CONTENT.SPREAD_ROC, technical: false },
                    { key: 'delta', label: 'Delta', help: HELP_CONTENT.DELTA_CSP, technical: true },
                    { key: 'dte', label: 'DTE', help: HELP_CONTENT.DTE, technical: false },
                    { key: 'weeklyPct', label: 'Weekly %', help: HELP_CONTENT.WEEKLY_RETURN, technical: false },
                    { key: 'breakeven', label: 'Breakeven', help: HELP_CONTENT.BREAKEVEN_BULL_PUT, technical: false },
                    { key: 'openInterest', label: 'OI', help: 'dialog-oi-vol', technical: true },
                    { key: 'volume', label: 'Vol', help: 'dialog-oi-vol', technical: true },
                    { key: 'rsi', label: 'RSI', help: HELP_CONTENT.RSI_CSP, technical: true },
                    { key: 'bbPctB', label: 'BB %B', help: HELP_CONTENT.BB_PCTB_CSP, technical: true },
                    { key: 'ivRank', label: 'IV Rank', help: HELP_CONTENT.IV_RANK, technical: true },
                    { key: 'score', label: 'Score', help: 'dialog-score', technical: false },
                    { key: 'aiRecommendation', label: 'AI', help: null, technical: false },
                  ] : [
                    { key: 'symbol', label: 'Symbol', help: null, technical: false },
                    { key: 'strike', label: 'Strike', help: null, technical: false },
                    { key: 'currentPrice', label: 'Current', help: null, technical: false },
                    { key: 'bid', label: 'Bid', help: null, technical: false },
                    { key: 'ask', label: 'Ask', help: null, technical: false },
                    { key: 'spreadPct', label: 'Spread %', help: null, technical: false },
                    { key: 'delta', label: 'Delta', help: HELP_CONTENT.DELTA_CSP, technical: true },
                    { key: 'dte', label: 'DTE', help: HELP_CONTENT.DTE, technical: false },
                    { key: 'premium', label: 'Premium', help: null, technical: false },
                    { key: 'weeklyPct', label: 'Weekly %', help: HELP_CONTENT.WEEKLY_RETURN, technical: false },
                    { key: 'collateral', label: 'Collateral', help: null, technical: false },
                    { key: 'roc', label: 'ROC %', help: null, technical: false },
                    { key: 'openInterest', label: 'OI', help: 'dialog-oi-vol', technical: true },
                    { key: 'volume', label: 'Vol', help: 'dialog-oi-vol', technical: true },
                    { key: 'rsi', label: 'RSI', help: HELP_CONTENT.RSI_CSP, technical: true },
                    { key: 'bbPctB', label: 'BB %B', help: HELP_CONTENT.BB_PCTB_CSP, technical: true },
                    { key: 'ivRank', label: 'IV Rank', help: HELP_CONTENT.IV_RANK, technical: true },
                    { key: 'score', label: 'Score', help: 'dialog-score', technical: false },
                    { key: 'aiRecommendation', label: 'AI', help: null, technical: false },
                  ]).filter(({ technical }) => !technical || showTechnicalColumns).map(({ key, label, help }) => (
                    <TableHead 
                      key={key}
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => {
                        if (sortColumn === key) {
                          setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortColumn(key);
                          setSortDirection('desc');
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        {label}
                        {help && (
                          help === 'dialog-score' ? (
                            <HelpDialog title="Score Calculation" content={HELP_CONTENT.SCORE_CALCULATION_DIALOG} />
                          ) : help === 'dialog-oi-vol' ? (
                            <HelpDialog title="Open Interest & Volume" content={HELP_CONTENT.OPEN_INTEREST_VOLUME_DIALOG} />
                          ) : (
                            <HelpBadge content={help} />
                          )
                        )}
                        {sortColumn === key && (
                          <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOpportunities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={18} className="text-center text-muted-foreground py-8">
                      {loadingOpportunities ? "Loading opportunities..." : "No opportunities found. Add symbols and click Fetch Opportunities."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOpportunities.map((opp) => {
                    const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
                    const isSelected = selectedOpportunities.has(key);
                    return (
                      <TableRow key={key} className={isSelected ? "bg-primary/10" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleOpportunity(opp)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{opp.symbol}</TableCell>
                        {strategyType === 'spread' ? (
                          <>
                            <TableCell>
                              <div className="flex flex-col text-xs">
                                <span className="text-blue-400 font-semibold">${opp.strike.toFixed(2)}</span>
                                <span className="text-muted-foreground">${(opp as any).longStrike?.toFixed(2)}</span>
                              </div>
                            </TableCell>
                            <TableCell>${opp.currentPrice.toFixed(2)}</TableCell>
                            <TableCell className="font-medium text-green-500">${(opp as any).netCredit?.toFixed(2)}</TableCell>
                            <TableCell className="text-amber-400">${(opp as any).capitalAtRisk?.toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge className={cn("font-bold", getROCColor((opp as any).spreadROC || 0))}>
                                {((opp as any).spreadROC || 0).toFixed(2)}%
                              </Badge>
                            </TableCell>
                            {showTechnicalColumns && <TableCell>{Math.abs(opp.delta).toFixed(3)}</TableCell>}
                            <TableCell>{opp.dte}</TableCell>
                            <TableCell>{opp.weeklyPct.toFixed(2)}%</TableCell>
                            <TableCell className="text-blue-300">${(opp as any).breakeven?.toFixed(2)}</TableCell>
                            {showTechnicalColumns && (
                              <>
                                <TableCell>
                                  <Badge className={cn("font-bold", getLiquidityColor(opp.openInterest, 'oi'))}>
                                    {opp.openInterest}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge className={cn("font-bold", getLiquidityColor(opp.volume, 'vol'))}>
                                    {opp.volume}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge className={cn("font-bold", getRSIColor(opp.rsi, 'csp'))}>
                                    {opp.rsi !== null ? opp.rsi.toFixed(1) : 'N/A'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge className={cn("font-bold", getBBColor(opp.bbPctB, 'csp'))}>
                                    {opp.bbPctB !== null ? opp.bbPctB.toFixed(2) : 'N/A'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge className={cn("font-bold", getIVRankColor(opp.ivRank))}>
                                    {opp.ivRank !== null ? opp.ivRank.toFixed(1) : 'N/A'}
                                  </Badge>
                                </TableCell>
                              </>
                            )}
                            <TableCell>
                              <Badge className={cn("font-bold", getROCColor((opp as any).spreadROC || 0))}>
                                {opp.score}
                              </Badge>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell>${opp.strike.toFixed(2)}</TableCell>
                            <TableCell>${opp.currentPrice.toFixed(2)}</TableCell>
                            <TableCell>${opp.bid.toFixed(2)}</TableCell>
                            <TableCell>${opp.ask.toFixed(2)}</TableCell>
                            <TableCell>{opp.spreadPct.toFixed(1)}%</TableCell>
                            {showTechnicalColumns && <TableCell>{Math.abs(opp.delta).toFixed(3)}</TableCell>}
                            <TableCell>{opp.dte}</TableCell>
                            <TableCell className="font-medium text-green-500">${opp.premium.toFixed(2)}</TableCell>
                            <TableCell>{opp.weeklyPct.toFixed(2)}%</TableCell>
                            <TableCell>${opp.collateral.toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge className={cn("font-bold", getROCColor(opp.roc))}>
                                {opp.roc.toFixed(2)}%
                              </Badge>
                            </TableCell>
                          </>
                        )}
                        {showTechnicalColumns && (
                          <>
                            <TableCell>
                              <Badge className={cn("font-bold", getLiquidityColor(opp.openInterest, 'oi'))}>
                                {opp.openInterest}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("font-bold", getLiquidityColor(opp.volume, 'vol'))}>
                                {opp.volume}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("font-bold", getRSIColor(opp.rsi, 'csp'))}>
                                {opp.rsi !== null ? opp.rsi.toFixed(1) : 'N/A'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("font-bold", getBBColor(opp.bbPctB, 'csp'))}>
                                {opp.bbPctB !== null ? opp.bbPctB.toFixed(2) : 'N/A'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("font-bold", getIVRankColor(opp.ivRank))}>
                                {opp.ivRank !== null ? opp.ivRank.toFixed(1) : 'N/A'}
                              </Badge>
                            </TableCell>
                          </>
                        )}
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge 
                                  className={cn(
                                    "font-bold cursor-help",
                                    opp.score >= 70 && "bg-green-500/20 text-green-500 border-green-500/50",
                                    opp.score >= 50 && opp.score < 70 && "bg-yellow-500/20 text-yellow-500 border-yellow-500/50",
                                    opp.score < 50 && "bg-red-500/20 text-red-500 border-red-500/50"
                                  )}
                                >
                                  {opp.score}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="bg-gray-900 border-orange-500/50 p-3 max-w-xs">
                                <div className="space-y-1.5 text-sm">
                                  <div className="font-semibold text-orange-400 border-b border-orange-500/30 pb-1 mb-2">
                                    Score Breakdown ({opp.score}/100)
                                  </div>
                                  {(opp as any).scoreBreakdown && (
                                    <>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">Technical (RSI+BB):</span>
                                        <span className="font-medium text-white">{(opp as any).scoreBreakdown.technical}/40</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">Greeks (Δ+DTE+IV):</span>
                                        <span className="font-medium text-white">{(opp as any).scoreBreakdown.greeks}/30</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">Premium (Return+Spread):</span>
                                        <span className="font-medium text-white">{(opp as any).scoreBreakdown.premium}/20</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">Quality (Mag7+Cap):</span>
                                        <span className="font-medium text-white">{(opp as any).scoreBreakdown.quality}/10</span>
                                      </div>
                                    </>
                                  )}
                                  {!(opp as any).scoreBreakdown && (
                                    <div className="text-gray-400 text-xs">Breakdown not available</div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-purple-500/20"
                            onClick={() => {
                              const rowKey = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
                              setAnalyzingRowKey(rowKey);
                              explainScore.mutate({
                                symbol: opp.symbol,
                                strike: opp.strike,
                                currentPrice: opp.currentPrice,
                                premium: opp.premium,
                                delta: Math.abs(opp.delta),
                                dte: opp.dte,
                                rsi: opp.rsi,
                                bbPctB: opp.bbPctB,
                                ivRank: opp.ivRank,
                                score: opp.score,
                                scoreBreakdown: opp.scoreBreakdown,
                              });
                            }}
                            disabled={analyzingRowKey === `${opp.symbol}-${opp.strike}-${opp.expiration}`}
                            title="Click to see AI explanation of this score"
                          >
                            {analyzingRowKey === `${opp.symbol}-${opp.strike}-${opp.expiration}` ? (
                              <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                            ) : (
                              <Sparkles className="w-4 h-4 text-purple-500" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>


        </CardContent>
      </Card>

      {/* Fetch Progress Dialog */}
      <Dialog open={fetchProgress.isOpen} onOpenChange={(open) => {
        if (!open) {
          // Cancel button clicked
          if (loadingOpportunities) {
            // Abort ongoing fetch
            toast.info('Scan cancelled');
          }
          setFetchProgress({ ...fetchProgress, isOpen: false });
        }
      }}>
        <DialogContent className="max-w-md border-2 border-orange-500/50">
          <DialogHeader>
            <DialogTitle>Fetching Opportunities</DialogTitle>
            <DialogDescription>
              Scanning option chains and scoring opportunities...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {loadingOpportunities ? (
              <LiveCountdown 
                startTime={fetchProgress.startTime || Date.now()} 
                totalSymbols={fetchProgress.total}
                strategyType={strategyType}
              />
            ) : (
              <div className="text-center space-y-4">
                <div className="text-4xl">✓</div>
                <p className="text-sm text-muted-foreground">
                  Completed scanning {fetchProgress.total} symbols
                </p>
                <p className="text-lg font-semibold">
                  Found {opportunities.length} opportunities
                </p>
                {fetchProgress.startTime && fetchProgress.endTime && (
                  <p className="text-xs text-muted-foreground">
                    Completed in {((fetchProgress.endTime - fetchProgress.startTime) / 1000).toFixed(1)}s
                  </p>
                )}
                <Button 
                  onClick={() => {
                    setFetchProgress({ ...fetchProgress, isOpen: false });
                    // Full collapse watchlist + fetch options after dialog closes
                    setIsFullyCollapsed(true);
                    // Scroll to Filters section
                    setTimeout(() => {
                      const filtersSection = document.querySelector('[data-section="filters"]');
                      if (filtersSection) {
                        filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 300);
                  }}
                  className="mt-4"
                  size="sm"
                >
                  Close
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Preview Dialog with Validation */}
      {validationData && (
        <OrderPreviewDialog
          open={showPreviewDialog}
          onOpenChange={setShowPreviewDialog}
          orders={validationData.orders}
          totalPremium={validationData.totalPremium}
          totalCollateral={validationData.totalCollateral}
          availableBuyingPower={validationData.availableBuyingPower}
          remainingBuyingPower={validationData.remainingBuyingPower}
          isMarketOpen={validationData.isMarketOpen}
          onSubmit={executeOrderSubmission}
          isDryRun={dryRun}
          strategy="csp"
        />
      )}

      {/* Progress Dialog */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent className="max-w-md border-2 border-orange-500/50">
          <DialogHeader>
            <DialogTitle>Submitting Orders</DialogTitle>
            <DialogDescription>
              Please wait while we submit your orders to Tastytrade...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{submitOrders.isPending ? 'Processing...' : 'Complete'}</span>
              </div>
              <Progress value={submitOrders.isPending ? 50 : 100} />
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {orderProgress.results.map((result, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded border">
                  <span className="text-sm font-medium">{result.symbol}</span>
                  <Badge
                    variant={result.status === 'success' ? 'default' : result.status === 'failed' ? 'destructive' : 'secondary'}
                  >
                    {result.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* AI Analysis Detail Modal */}
      <Dialog open={showAiAnalysisModal} onOpenChange={setShowAiAnalysisModal}>
        <DialogContent className="max-w-2xl border-2 border-orange-500/50">
          <DialogHeader>
            <DialogTitle>
              Score Explanation: {selectedAiAnalysis?.symbol} ${selectedAiAnalysis?.strike}
            </DialogTitle>
            <DialogDescription>
              AI-powered explanation of why this opportunity scored {selectedAiAnalysis?.score}/100
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Score Badge */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">Composite Score:</span>
              <Badge
                className={cn(
                  "font-bold text-base px-3 py-1",
                  (selectedAiAnalysis?.score ?? 0) >= 70 && "bg-green-500/20 text-green-500 border-green-500/50",
                  (selectedAiAnalysis?.score ?? 0) >= 55 && (selectedAiAnalysis?.score ?? 0) < 70 && "bg-yellow-500/20 text-yellow-500 border-yellow-500/50",
                  (selectedAiAnalysis?.score ?? 0) < 55 && "bg-red-500/20 text-red-500 border-red-500/50"
                )}
              >
                {selectedAiAnalysis?.score}/100
              </Badge>
            </div>

            {/* Explanation Text */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2 border-2 border-orange-500/30">
              <h4 className="font-semibold text-sm text-orange-400 uppercase tracking-wide">Why This Score?</h4>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {selectedAiAnalysis?.explanation}
              </div>
            </div>

            {/* Scoring System Reference */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-sm text-blue-400 uppercase tracking-wide">Scoring System</h4>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>• <strong>Technical Setup (40%):</strong> RSI + Bollinger Band %B (oversold = higher score)</p>
                <p>• <strong>Greeks & Timing (30%):</strong> Delta (0.20-0.29 ideal) + DTE (7-10 days max) + IV Rank</p>
                <p>• <strong>Premium Quality (20%):</strong> Weekly return (0.75-1.5% target) + Bid-ask spread</p>
                <p>• <strong>Stock Quality (10%):</strong> Mag 7 bonus + Market cap tier</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
