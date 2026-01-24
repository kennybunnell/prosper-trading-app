import { useAuth } from "@/_core/hooks/useAuth";
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
  const [newSymbol, setNewSymbol] = useState("");
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [presetFilter, setPresetFilter] = useState<PresetFilter>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [minDte, setMinDte] = useState<number>(7);
  const [maxDte, setMaxDte] = useState<number>(45);
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
  }>({ isOpen: false, current: 0, total: 0, completed: 0 });

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
  const { data: opportunities = [], isLoading: loadingOpportunities, refetch: refetchOpportunities } = trpc.csp.opportunities.useQuery(
    { 
      symbols: watchlist.map((w: any) => w.symbol),
      minDte,
      maxDte,
    },
    { enabled: false } // Disabled by default, only fetch when user clicks button
  );

  // Add to watchlist
  const addToWatchlist = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      setNewSymbol("");
      utils.watchlist.list.invalidate();
      toast.success("Symbol(s) added to watchlist");
    },
    onError: (error: any) => {
      toast.error(`Failed to add symbol: ${error.message}`);
    },
  });

  // Remove from watchlist
  const removeFromWatchlist = trpc.watchlist.remove.useMutation({
    onSuccess: (_: any, variables: any) => {
      toast.success(`Removed ${variables.symbol} from watchlist`);
      utils.watchlist.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Failed to remove symbol: ${error.message}`);
    },
  });

  // Handle adding comma-delimited symbols
  const handleAddSymbols = () => {
    const symbols = newSymbol
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);

    if (symbols.length === 0) {
      toast.error("Please enter at least one symbol");
      return;
    }

    // Add each symbol
    Promise.all(
      symbols.map(symbol => 
        addToWatchlist.mutateAsync({ symbol, strategy: 'csp' })
      )
    ).then(() => {
      toast.success(`Added ${symbols.length} symbol(s) to watchlist`);
    }).catch((error) => {
      toast.error(`Failed to add symbols: ${error.message}`);
    });
  };

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

  // Submit orders mutation
  const submitOrders = trpc.csp.submitOrders.useMutation({
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
    },
    onError: (error) => {
      setShowProgressDialog(false);
      toast.error(`Failed to submit orders: ${error.message}`);
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

  // Handle submit orders
  const handleSubmitOrders = () => {
    if (selectedOppsList.length === 0) {
      toast.error("Please select at least one opportunity");
      return;
    }

    if (!selectedAccountId) {
      toast.error("Please select an account in the sidebar");
      return;
    }

    // Show confirmation dialog for live mode
    if (!dryRun) {
      setShowConfirmDialog(true);
      return;
    }

    // Proceed with dry run
    executeOrderSubmission();
  };

  // Execute order submission
  const executeOrderSubmission = () => {
    setShowConfirmDialog(false);
    setShowProgressDialog(true);
    
    const orders = selectedOppsList.map(opp => ({
      symbol: opp.symbol,
      strike: opp.strike,
      expiration: opp.expiration,
      premium: opp.premium,
      optionSymbol: `${opp.symbol}${opp.expiration.replace(/-/g, '')}P${(opp.strike * 1000).toString().padStart(8, '0')}`,
    }));

    setOrderProgress({
      current: 0,
      total: orders.length,
      results: orders.map(o => ({ symbol: o.symbol, status: 'pending' })),
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
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cash-Secured Puts Dashboard</h1>
          <p className="text-muted-foreground">Analyze and execute CSP strategies with intelligent scoring</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              Total Premium
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalPremium.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-500" />
              Total Collateral
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCollateral.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              ROC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{roc.toFixed(2)}%</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-500" />
              Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredOpportunities.length}</div>
          </CardContent>
        </Card>

        <Card className={cn("bg-card/50 backdrop-blur border-border/50", buyingPowerBgColor)}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className={cn("w-4 h-4", buyingPowerColor)} />
              Buying Power
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", buyingPowerColor)}>
              {buyingPowerUsedPct.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ${availableBuyingPower.toFixed(0)} available
            </div>
            {overLimit > 0 && (
              <div className="text-xs text-red-500 font-semibold mt-1">
                Over Limit: ${overLimit.toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Watchlist Management */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle>Watchlist</CardTitle>
          <CardDescription>Add symbols to analyze CSP opportunities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Enter symbols (comma-separated, e.g., AAPL, MSFT, TSLA)"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbols()}
              />
            </div>
            <Button onClick={handleAddSymbols} disabled={addToWatchlist.isPending}>
              {addToWatchlist.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </Button>
          </div>

          {/* Watchlist Display */}
          <div className="flex flex-wrap gap-2">
            {watchlist.map((item: any) => (
              <Badge key={item.id} variant="secondary" className="px-3 py-1 flex items-center gap-2">
                {item.symbol}
                <button
                  onClick={() => removeFromWatchlist.mutate({ symbol: item.symbol, strategy: 'csp' })}
                  className="hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </Badge>
            ))}
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
              const symbolCount = watchlist.length;
              setFetchProgress({
                isOpen: true,
                current: 0,
                total: symbolCount,
                completed: 0,
              });
              refetchOpportunities();
            }} 
            disabled={loadingOpportunities || watchlist.length === 0}
            className="w-full"
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
            <Label className="mb-2 block">Preset Filters</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={presetFilter === 'conservative' ? 'default' : 'outline'}
                onClick={() => handlePresetFilter('conservative')}
                size="sm"
              >
                Conservative
              </Button>
              <Button
                variant={presetFilter === 'medium' ? 'default' : 'outline'}
                onClick={() => handlePresetFilter('medium')}
                size="sm"
              >
                Medium
              </Button>
              <Button
                variant={presetFilter === 'aggressive' ? 'default' : 'outline'}
                onClick={() => handlePresetFilter('aggressive')}
                size="sm"
              >
                Aggressive
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPresetFilter(null);
                  setMinScore(undefined);
                }}
                size="sm"
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
            <Label className="mb-2 block">Selection Controls</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
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
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedOpportunities(new Set());
                  toast.success("Cleared all selections");
                }}
                disabled={selectedOpportunities.size === 0}
              >
                ✗ Clear Selection
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="selected-only"
                checked={showSelectedOnly}
                onCheckedChange={(checked) => setShowSelectedOnly(checked as boolean)}
              />
              <Label htmlFor="selected-only" className="cursor-pointer">
                Show Selected Only
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    <TableCell colSpan={17} className="text-center text-muted-foreground py-8">
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
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>
                  {loadingOpportunities 
                    ? `Processing ${fetchProgress.total} symbols...` 
                    : `Found ${opportunities.length} opportunities`}
                </span>
              </div>
              <Progress 
                value={loadingOpportunities ? 50 : 100} 
                className="h-2"
              />
            </div>
            {!loadingOpportunities && (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  ✓ Completed scanning {fetchProgress.total} symbols
                </p>
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

      {/* Confirmation Dialog for Live Mode */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Live Order Submission</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to submit <strong>{selectedOppsList.length} live order(s)</strong> to Tastytrade.
              <br /><br />
              <strong>Total Premium:</strong> ${totalPremium.toFixed(2)}
              <br />
              <strong>Total Collateral:</strong> ${totalCollateral.toFixed(2)}
              <br />
              <strong>Available Buying Power:</strong> ${availableBuyingPower.toFixed(2)}
              <br /><br />
              This action cannot be undone. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeOrderSubmission}>Submit Orders</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  );
}
