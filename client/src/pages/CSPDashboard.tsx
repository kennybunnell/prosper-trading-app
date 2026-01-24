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
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import {
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Calendar,
  Target,
  Filter,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";

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

export default function CSPDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  // newSymbol state moved to EnhancedWatchlist component
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [presetFilter, setPresetFilter] = useState<PresetFilter>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [minDte, setMinDte] = useState<number>(7);
  const [maxDte, setMaxDte] = useState<number>(45);
  const [portfolioSizeFilter, setPortfolioSizeFilter] = useState<Array<'small' | 'medium' | 'large'>>(['small', 'medium', 'large']);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
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

  const utils = trpc.useUtils();

  // Fetch filter presets from database
  const { data: presets } = trpc.cspFilters.getPresets.useQuery(undefined, { enabled: !!user });

  // Fetch accounts
  const { data: accounts = [] } = trpc.accounts.list.useQuery(undefined, { enabled: !!user });

  // Fetch user preferences for default account
  const { data: userPreferences } = trpc.userPreferences.get.useQuery(undefined, { enabled: !!user });

  // Auto-select default account if no account is selected
  useEffect(() => {
    if (userPreferences?.defaultTastytradeAccountId && !selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(userPreferences.defaultTastytradeAccountId);
    }
  }, [userPreferences, selectedAccountId, accounts, setSelectedAccountId]);

  // Get selected account details
  const selectedAccount = accounts.find((acc: any) => acc.accountId === selectedAccountId);

  // Fetch account balances for buying power
  const { data: balances } = trpc.account.getBalances.useQuery(
    { accountNumber: selectedAccount?.accountNumber || '' },
    { enabled: !!selectedAccount?.accountNumber }
  );

  // Fetch watchlist
  const { data: watchlist = [], isLoading: loadingWatchlist } = trpc.watchlist.list.useQuery(
    { strategy: 'csp' },
    { enabled: !!user }
  );

  // Fetch opportunities (only when user clicks "Fetch Opportunities")
  // Filter watchlist by selected portfolio sizes
  const filteredWatchlist = useMemo(() => {
    if (portfolioSizeFilter.length === 3) return watchlist; // All selected
    return watchlist.filter((w: any) => 
      !w.portfolioSize || portfolioSizeFilter.includes(w.portfolioSize)
    );
  }, [watchlist, portfolioSizeFilter]);

  const { data: opportunities = [], isLoading: loadingOpportunities, refetch: refetchOpportunities, error: opportunitiesError } = trpc.csp.opportunities.useQuery(
    { 
      symbols: filteredWatchlist.map((w: any) => w.symbol),
      minDte,
      maxDte,
    },
    { enabled: false } // Disabled by default, only fetch when user clicks button
  );

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
    let filtered = [...opportunities];

    // Apply preset filter from database
    if (presetFilter && presets) {
      const preset = presets.find(p => p.presetName === presetFilter);
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

    // Apply score filter
    if (minScore !== undefined) {
      filtered = filtered.filter(opp => opp.score >= minScore);
    }

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
  }, [opportunities, presetFilter, presets, minScore, showSelectedOnly, sortColumn, sortDirection]);

  // Calculate summary metrics
  const selectedOppsList = opportunities.filter(opp => 
    selectedOpportunities.has(`${opp.symbol}-${opp.strike}-${opp.expiration}`)
  );
  const totalPremium = selectedOppsList.reduce((sum, opp) => sum + (opp.premium * 100), 0);
  const totalCollateral = selectedOppsList.reduce((sum, opp) => sum + opp.collateral, 0);
  const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;

  // Calculate buying power metrics
  const availableBuyingPower = Number(balances?.['cash-buying-power'] || balances?.['derivative-buying-power'] || 0);
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

  // Submit orders mutation
  const submitOrders = trpc.csp.submitOrders.useMutation({
    onError: (error) => {
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
    onSuccess: (data) => {
      setShowProgressDialog(false);
      if (data.success) {
        toast.success(`Successfully submitted ${data.results.length} orders!`);
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
      } else {
        const failedCount = data.results.filter(r => !r.success).length;
        toast.error(`${failedCount} order(s) failed to submit`);
      }
      setShowProgressDialog(false);
    },
  });

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
      premium: opp.premium,
      bid: opp.bid,
      ask: opp.ask,
      currentPrice: opp.currentPrice,
    }));

    validateOrders.mutate({
      orders,
      accountId: selectedAccountId,
    });
  };

  // Execute order submission with midpoint pricing from validation
  const executeOrderSubmission = () => {
    setShowPreviewDialog(false);
    setShowProgressDialog(true);
    
    if (!validationData) {
      toast.error("Validation data not available");
      return;
    }

    // Use validated orders with midpoint pricing
    const orders = validationData.orders.map((validatedOrder: any) => {
      const opp = selectedOppsList.find(
        o => o.symbol === validatedOrder.symbol && 
             o.strike === validatedOrder.strike && 
             o.expiration === validatedOrder.expiration
      );
      
      return {
        symbol: validatedOrder.symbol,
        strike: validatedOrder.strike,
        expiration: validatedOrder.expiration,
        premium: validatedOrder.premium / 100, // Convert back to per-share price
        optionSymbol: `${validatedOrder.symbol}${validatedOrder.expiration.replace(/-/g, '')}P${(validatedOrder.strike * 1000).toString().padStart(8, '0')}`,
      };
    });

    setOrderProgress({
      current: 0,
      total: orders.length,
      results: orders.map((o: any) => ({ symbol: o.symbol, status: 'pending' })),
    });

    if (!selectedAccountId) {
      toast.error("Please select an account");
      return;
    }

    submitOrders.mutate({
      orders,
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
    <div className="min-h-screen">
      {/* Hero Header with Background Image */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div 
          className="absolute inset-0 opacity-30" 
          style={{
            backgroundImage: 'url(/csp-hero.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
        <div className="container relative py-12 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg">
                Cash-Secured Puts
              </h1>
              <p className="text-lg text-blue-200">
                Analyze and execute CSP strategies with dual scoring system
              </p>
            </div>
            <ConnectionStatusIndicator />
          </div>
        </div>
      </div>
      
      <div className="container mx-auto py-8 space-y-8">

      {/* Watchlist Management */}
      <EnhancedWatchlist 
        strategy="csp" 
        onWatchlistChange={() => utils.watchlist.list.invalidate()}
        isCollapsed={watchlistCollapsed}
        onToggleCollapse={() => setWatchlistCollapsed(!watchlistCollapsed)}
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
            <Label className="mb-2 block">Portfolio Size</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={portfolioSizeFilter.includes('small') ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setPortfolioSizeFilter(prev => 
                    prev.includes('small') 
                      ? prev.filter(s => s !== 'small')
                      : [...prev, 'small']
                  );
                }}
                className={portfolioSizeFilter.includes('small') ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-md transition-all duration-200 hover:scale-105' : ''}
              >
                🟢 Small
              </Button>
              <Button
                variant={portfolioSizeFilter.includes('medium') ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setPortfolioSizeFilter(prev => 
                    prev.includes('medium') 
                      ? prev.filter(s => s !== 'medium')
                      : [...prev, 'medium']
                  );
                }}
                className={portfolioSizeFilter.includes('medium') ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-md transition-all duration-200 hover:scale-105' : ''}
              >
                🟡 Medium
              </Button>
              <Button
                variant={portfolioSizeFilter.includes('large') ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setPortfolioSizeFilter(prev => 
                    prev.includes('large') 
                      ? prev.filter(s => s !== 'large')
                      : [...prev, 'large']
                  );
                }}
                className={portfolioSizeFilter.includes('large') ? 'bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white shadow-md transition-all duration-200 hover:scale-105' : ''}
              >
                🔴 Large
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPortfolioSizeFilter(['small', 'medium', 'large'])}
              >
                All
              </Button>
            </div>
            {/* Quick Switch & Refetch */}
            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-border/50">
              <span className="text-xs text-muted-foreground self-center">Quick Switch:</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
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
                className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/50 transition-all duration-200 hover:scale-105"
              >
                🟢 Small Only
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
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
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 transition-all duration-200 hover:scale-105"
              >
                🟡 Medium Only
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
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
                className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/50 transition-all duration-200 hover:scale-105"
              >
                🔴 Large Only
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
              const symbolCount = filteredWatchlist.length;
              setFetchProgress({
                isOpen: true,
                current: 0,
                total: symbolCount,
                completed: 0,
                startTime: Date.now(),
                endTime: null,
              });
              refetchOpportunities().then(() => {
                // Auto-collapse watchlist after successful fetch
                setWatchlistCollapsed(true);
              });
            }} 
            disabled={loadingOpportunities || filteredWatchlist.length === 0}
            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02]"
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

      {/* Filters */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset Filters */}
          <div>
            <Label className="mb-2 block text-base font-semibold">Preset Filters</Label>
            <div className="flex flex-wrap gap-3">
              <Button
                className={presetFilter === 'conservative' 
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105'
                  : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 border-blue-500/30 transition-all duration-200 hover:scale-105'
                }
                onClick={() => handlePresetFilter('conservative')}
                size="default"
              >
                Conservative
              </Button>
              <Button
                className={presetFilter === 'medium'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105'
                  : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border-amber-500/30 transition-all duration-200 hover:scale-105'
                }
                onClick={() => handlePresetFilter('medium')}
                size="default"
              >
                Medium
              </Button>
              <Button
                className={presetFilter === 'aggressive'
                  ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105'
                  : 'bg-red-500/10 hover:bg-red-500/20 text-red-600 border-red-500/30 transition-all duration-200 hover:scale-105'
                }
                onClick={() => handlePresetFilter('aggressive')}
                size="default"
              >
                Aggressive
              </Button>
              <Button
                className="bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
                onClick={() => {
                  setPresetFilter(null);
                  setMinScore(undefined);
                }}
                size="default"
              >
                Clear Filters
              </Button>
            </div>
          </div>

          {/* Score Filters */}
          <div>
            <Label className="mb-2 block">Score Filters</Label>
            <div className="flex flex-wrap gap-2">
              {[100, 90, 80, 75, 70, 65, 60, 55, 50, 45, 40].map(score => (
                <Button
                  key={score}
                  variant={minScore === score ? 'default' : 'outline'}
                  onClick={() => handleScoreFilter(score)}
                  size="sm"
                >
                  {score}+
                </Button>
              ))}
            </div>
          </div>

          {/* Selection Controls */}
          <div className="space-y-3">
            <Label className="mb-2 block text-base font-semibold">Selection Controls</Label>
            <div className="flex flex-wrap gap-3">
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
                className="bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
                size="default"
                onClick={() => {
                  setSelectedOpportunities(new Set());
                  toast.success("Cleared all selections");
                }}
                disabled={selectedOpportunities.size === 0}
              >
                ✗ Clear Selection
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
        </CardContent>
      </Card>

      {/* Summary Cards - Enhanced with gradients and glassmorphism */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-green-500/10 to-emerald-500/5 backdrop-blur border-green-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-green-500/20">
                <DollarSign className="w-4 h-4 text-green-400" />
              </div>
              <span className="text-muted-foreground">Total Premium</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
              ${totalPremium.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-blue-500/10 to-cyan-500/5 backdrop-blur border-blue-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Target className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-muted-foreground">Total Collateral</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              ${totalCollateral.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-purple-500/10 to-pink-500/5 backdrop-blur border-purple-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <TrendingUp className="w-4 h-4 text-purple-400" />
              </div>
              <span className="text-muted-foreground">ROC</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              {roc.toFixed(2)}%
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-orange-500/10 to-amber-500/5 backdrop-blur border-orange-500/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Calendar className="w-4 h-4 text-orange-400" />
              </div>
              <span className="text-muted-foreground">Opportunities</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
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
              <span className="text-muted-foreground">Buying Power</span>
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
            <div className="text-xs text-muted-foreground mt-1">
              ${availableBuyingPower.toFixed(0)} available
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

      {/* Opportunities Table */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle>Opportunities ({filteredOpportunities.length})</CardTitle>
          <CardDescription>
            {selectedOppsList.length > 0 && `${selectedOppsList.length} selected`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Select</TableHead>
                  {[
                    { key: 'symbol', label: 'Symbol' },
                    { key: 'strike', label: 'Strike' },
                    { key: 'currentPrice', label: 'Current' },
                    { key: 'bid', label: 'Bid' },
                    { key: 'ask', label: 'Ask' },
                    { key: 'spreadPct', label: 'Spread %' },
                    { key: 'delta', label: 'Delta' },
                    { key: 'dte', label: 'DTE' },
                    { key: 'premium', label: 'Premium' },
                    { key: 'weeklyPct', label: 'Weekly %' },
                    { key: 'collateral', label: 'Collateral' },
                    { key: 'roc', label: 'ROC %' },
                    { key: 'openInterest', label: 'OI' },
                    { key: 'volume', label: 'Vol' },
                    { key: 'rsi', label: 'RSI' },
                    { key: 'bbPctB', label: 'BB %B' },
                    { key: 'score', label: 'Score' },
                  ].map(({ key, label }) => (
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
                        <TableCell>${opp.strike.toFixed(2)}</TableCell>
                        <TableCell>${opp.currentPrice.toFixed(2)}</TableCell>
                        <TableCell>${opp.bid.toFixed(2)}</TableCell>
                        <TableCell>${opp.ask.toFixed(2)}</TableCell>
                        <TableCell>{opp.spreadPct.toFixed(1)}%</TableCell>
                        <TableCell>{Math.abs(opp.delta).toFixed(3)}</TableCell>
                        <TableCell>{opp.dte}</TableCell>
                        <TableCell className="font-medium text-green-500">${opp.premium.toFixed(2)}</TableCell>
                        <TableCell>{opp.weeklyPct.toFixed(2)}%</TableCell>
                        <TableCell>${opp.collateral.toFixed(2)}</TableCell>
                        <TableCell>{opp.roc.toFixed(2)}%</TableCell>
                        <TableCell>{opp.openInterest}</TableCell>
                        <TableCell>{opp.volume}</TableCell>
                        <TableCell>{opp.rsi !== null ? opp.rsi.toFixed(1) : 'N/A'}</TableCell>
                        <TableCell>{opp.bbPctB !== null ? opp.bbPctB.toFixed(2) : 'N/A'}</TableCell>
                        <TableCell>
                          <Badge 
                            className={cn(
                              "font-bold",
                              opp.score >= 70 && "bg-green-500/20 text-green-500 border-green-500/50",
                              opp.score >= 50 && opp.score < 70 && "bg-yellow-500/20 text-yellow-500 border-yellow-500/50",
                              opp.score < 50 && "bg-red-500/20 text-red-500 border-red-500/50"
                            )}
                          >
                            {opp.score}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Submit Orders Button */}
          {selectedOppsList.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dry-run"
                  checked={dryRun}
                  onCheckedChange={(checked) => setDryRun(checked as boolean)}
                />
                <Label htmlFor="dry-run" className="cursor-pointer text-sm">
                  Dry Run (test without submitting real orders)
                </Label>
              </div>
              <div className="flex flex-col items-end gap-2">
                {overLimit > 0 && (
                  <p className="text-sm text-red-500 font-semibold">
                    Cannot submit orders: Total collateral exceeds buying power by ${overLimit.toFixed(2)}
                  </p>
                )}
                <Button
                  onClick={handleSubmitOrders}
                  disabled={submitOrders.isPending || overLimit > 0}
                  size="lg"
                >
                  {submitOrders.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {dryRun ? 'Testing...' : 'Submitting Orders...'}
                    </>
                  ) : (
                    `${dryRun ? 'Test' : 'Submit'} ${selectedOppsList.length} Order(s)`
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fetch Progress Dialog */}
      <Dialog open={fetchProgress.isOpen} onOpenChange={(open) => {
        if (!loadingOpportunities) {
          setFetchProgress({ ...fetchProgress, isOpen: open });
        }
      }}>
        <DialogContent className="max-w-md">
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
                  onClick={() => setFetchProgress({ ...fetchProgress, isOpen: false })}
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
        />
      )}

      {/* Progress Dialog */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent className="max-w-md">
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
      </div>
    </div>
  );
}
