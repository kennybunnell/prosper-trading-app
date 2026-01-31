import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, TrendingUp, ArrowUp, ArrowDown, DollarSign, Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { HelpBadge } from "@/components/HelpBadge";
import { HELP_CONTENT } from "@/lib/helpContent";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { trpc } from "@/lib/trpc";
import { useTradingMode } from "@/contexts/TradingModeContext";
import { toast } from "sonner";
import { cn, exportToCSV } from "@/lib/utils";

type SortColumn = 'symbol' | 'strike' | 'expiration' | 'dte' | 'delta' | 'premium' | 'bidAskSpread' | 'openInterest' | 'volume' | 'score';
type SortDirection = 'asc' | 'desc';

// Active Positions Section Component
function ActivePositionsSection() {
  const { data: positionsData, isLoading, refetch } = trpc.pmcc.getLeapPositions.useQuery();
  const positions = positionsData?.positions || [];

  if (isLoading) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Active PMCC Positions
          </CardTitle>
          <CardDescription>Your current LEAP call positions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Active PMCC Positions
          </CardTitle>
          <CardDescription>Your current LEAP call positions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>No active LEAP positions found.</p>
            <p className="text-sm mt-2">Purchase LEAPs below to start your PMCC strategy.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Active PMCC Positions ({positions.length})
            </CardTitle>
            <CardDescription>Your current LEAP call positions</CardDescription>
          </div>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {positions.map((pos: any, idx: number) => (
            <Card key={idx} className="border-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{pos.symbol}</CardTitle>
                  <span className={`text-sm font-semibold ${pos.profitLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {pos.profitLoss >= 0 ? '+' : ''}{pos.profitLossPercent.toFixed(1)}%
                  </span>
                </div>
                <CardDescription>
                  ${pos.strike.toFixed(2)} Call • {new Date(pos.expiration).toLocaleDateString()} ({pos.dte} DTE)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Cost Basis</p>
                    <p className="font-semibold">${pos.costBasis.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Current Value</p>
                    <p className="font-semibold">${pos.currentValue.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">P/L</p>
                    <p className={`font-semibold ${pos.profitLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {pos.profitLoss >= 0 ? '+' : ''}${pos.profitLoss.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Stock Price</p>
                    <p className="font-semibold">${pos.stockPrice.toFixed(2)}</p>
                  </div>
                </div>
                <Button className="w-full mt-4" size="sm">
                  Sell Calls
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PMCCDashboard() {
  const { mode: tradingMode } = useTradingMode();
  const [selectedPreset, setSelectedPreset] = useState<'conservative' | 'medium' | 'aggressive' | null>(null);
  const [showBestPerTicker, setShowBestPerTicker] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isWatchlistCollapsed, setIsWatchlistCollapsed] = useState(false);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [selectedLeaps, setSelectedLeaps] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true);
  const [isSubmittingOrders, setIsSubmittingOrders] = useState(false);

  // Fetch PMCC filter presets from database
  const { data: presets } = trpc.filterPresets.getByStrategy.useQuery({ strategy: 'pmcc' });
  
  // Fetch watchlist to count symbols for progress calculation
  const { data: watchlist = [] } = trpc.watchlist.get.useQuery();
  
  // Countdown timer effect
  useEffect(() => {
    if (!isScanning || !scanStartTime) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - scanStartTime) / 1000;
      const estimatedTotal = watchlist.length * 2.0; // 2.0s per symbol (adjusted for buffer)
      const progress = Math.min(95, (elapsed / estimatedTotal) * 100);
      setScanProgress(progress);
    }, 100);

    return () => clearInterval(interval);
  }, [isScanning, scanStartTime, watchlist.length]);

  const submitLeapOrdersMutation = trpc.pmcc.submitLeapOrders.useMutation({
    onSuccess: (data) => {
      setIsSubmittingOrders(false);
      if (data.summary.failed === 0) {
        toast.success(
          `${isDryRun ? "Dry run" : "Order submission"} successful! ${data.summary.success} of ${data.summary.total} orders ${isDryRun ? "validated" : "submitted"}.`
        );
      } else {
        toast.warning(
          `Partial success: ${data.summary.success} succeeded, ${data.summary.failed} failed. Check results for details.`
        );
      }
      setShowOrderPreview(false);
      setSelectedLeaps(new Set()); // Clear selections after submission
    },
    onError: (error) => {
      setIsSubmittingOrders(false);
      toast.error(`Order submission failed: ${error.message}`);
    },
  });

  const scanLeapsMutation = trpc.pmcc.scanLeaps.useMutation({
    onSuccess: (data) => {
      setScanProgress(100);
      toast.success(data.message || `Found ${data.opportunities.length} LEAP opportunities`);
      setIsScanning(false);
      setScanStartTime(null);
      setScanProgress(0);
      
      // Auto-collapse watchlist after successful scan
      setIsWatchlistCollapsed(true);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to scan for LEAPs");
      setIsScanning(false);
      setScanStartTime(null);
      setScanProgress(0);
    },
  });

  const handleScanLeaps = () => {
    setIsScanning(true);
    setScanStartTime(Date.now());
    setScanProgress(0);
    // Use medium as default if no preset selected
    scanLeapsMutation.mutate({ presetName: selectedPreset || 'medium' });
  };

  // Helper to create unique key for each LEAP
  const getLeapKey = (leap: any) => `${leap.symbol}-${leap.strike}-${leap.expiration}`;

  // Toggle LEAP selection
  const toggleLeapSelection = (leap: any) => {
    const key = getLeapKey(leap);
    const newSelected = new Set(selectedLeaps);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedLeaps(newSelected);
  };

  // Select all LEAPs
  const selectAllLeaps = () => {
    if (!scanLeapsMutation.data?.opportunities) return;
    const allKeys = scanLeapsMutation.data.opportunities.map(getLeapKey);
    setSelectedLeaps(new Set(allKeys));
  };

  // Clear all selections
  const clearAllLeaps = () => {
    setSelectedLeaps(new Set());
  };

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Filtered and sorted opportunities
  const sortedLeaps = useMemo(() => {
    if (!scanLeapsMutation.data?.opportunities) return [];
    
    let filtered = [...scanLeapsMutation.data.opportunities];
    
    // Apply preset filter from database first
    if (selectedPreset && presets) {
      const preset = presets.find(p => p.presetName === selectedPreset);
      if (preset) {
        filtered = filtered.filter(leap => {
          const delta = Math.abs(leap.delta);
          const minDelta = parseFloat(preset.minDelta);
          const maxDelta = parseFloat(preset.maxDelta);
          
          // Delta filter (0.65-0.90 for LEAPs)
          if (delta < minDelta || delta > maxDelta) return false;
          
          // DTE filter (270-450 days for LEAPs)
          if (leap.dte < preset.minDte || leap.dte > preset.maxDte) return false;
          
          // Open Interest filter
          if (leap.openInterest < preset.minOpenInterest) return false;
          
          // Volume filter
          if (leap.volume < preset.minVolume) return false;
          
          // Spread % filter (use maxBbPercent as max spread %)
          const spreadPercent = ((leap.ask - leap.bid) / leap.ask) * 100;
          const maxSpreadPercent = preset.maxBbPercent ? parseFloat(preset.maxBbPercent) * 100 : 10; // Convert from decimal to %, default 10%
          if (spreadPercent > maxSpreadPercent) return false;
          
          // Score filter
          if (leap.score < preset.minScore) return false;
          
          return true;
        });
      }
     }
    
    // Apply Best Per Ticker filterr - show only top-scoring LEAP per symbol
    if (showBestPerTicker) {
      const bestPerTicker = new Map<string, typeof filtered[0]>();
      
      filtered.forEach(leap => {
        const existing = bestPerTicker.get(leap.symbol);
        if (!existing || leap.score > existing.score) {
          bestPerTicker.set(leap.symbol, leap);
        }
      });
      
      filtered = Array.from(bestPerTicker.values());
    }
    
    // Apply "Show Selected Only" filter
    if (showSelectedOnly) {
      filtered = filtered.filter(leap => selectedLeaps.has(getLeapKey(leap)));
    }
    
    // Sort
    filtered.sort((a, b) => {
      let aVal: any = a[sortColumn];
      let bVal: any = b[sortColumn];
      
      if (sortColumn === 'expiration') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [scanLeapsMutation.data?.opportunities, selectedLeaps, showSelectedOnly, sortColumn, sortDirection, selectedPreset, presets, showBestPerTicker]);

  // Calculate order summary
  const orderSummary = useMemo(() => {
    if (!scanLeapsMutation.data?.opportunities) return null;
    
    const selected = scanLeapsMutation.data.opportunities.filter(leap =>
      selectedLeaps.has(getLeapKey(leap))
    );
    
    if (selected.length === 0) return null;
    
    const totalCost = selected.reduce((sum, leap) => sum + (leap.ask * 100), 0);
    const avgDelta = selected.reduce((sum, leap) => sum + leap.delta, 0) / selected.length;
    const avgScore = selected.reduce((sum, leap) => sum + leap.score, 0) / selected.length;
    
    return {
      totalCost,
      totalContracts: selected.length,
      avgDelta,
      avgScore,
    };
  }, [scanLeapsMutation.data?.opportunities, selectedLeaps]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="h-8 w-8 text-purple-500" />
            <h1 className="text-3xl font-bold">PMCC Dashboard</h1>
          </div>
          <p className="text-muted-foreground">
            Poor Man's Covered Call - Buy LEAPs and sell short calls for income
          </p>
        </div>

        {/* Active PMCC Positions */}
        <ActivePositionsSection />

        {/* Watchlist Management */}
        <div className="mb-8">
          <EnhancedWatchlist 
            isCollapsed={isWatchlistCollapsed}
            onToggleCollapse={() => setIsWatchlistCollapsed(!isWatchlistCollapsed)}
          />
        </div>

        {/* LEAP Scanner Section */}
        <Card>
          <CardHeader>
            <CardTitle>LEAP Scanner</CardTitle>
            <CardDescription>
              Scan for LEAP call options (9-15 months out, deep ITM for PMCC strategy)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Scan Button */}
              <Button
                onClick={handleScanLeaps}
                disabled={isScanning}
                className="w-full"
                size="lg"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning for LEAPs...
                  </>
                ) : (
                  "Scan for LEAPs"
                )}
              </Button>

              {/* Preset Selection - shown after scan */}
              {scanLeapsMutation.data && scanLeapsMutation.data.opportunities.length > 0 && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Filter Presets</label>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="ghost"
                      className={cn(
                        "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                        selectedPreset === 'conservative'
                          ? "bg-gradient-to-r from-slate-600 via-gray-700 to-slate-800 text-white shadow-lg shadow-slate-500/50 hover:shadow-xl hover:shadow-slate-500/60 hover:scale-110"
                          : "bg-slate-500/10 text-slate-400 border border-slate-500/30 hover:bg-slate-500/20 hover:border-slate-500/50 hover:scale-105"
                      )}
                      onClick={() => setSelectedPreset("conservative")}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-300 animate-pulse" />
                        Conservative
                      </span>
                      {selectedPreset === 'conservative' && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      className={cn(
                        "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                        selectedPreset === 'medium'
                          ? "bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-700 text-white shadow-lg shadow-amber-500/50 hover:shadow-xl hover:shadow-amber-500/60 hover:scale-110"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 hover:scale-105"
                      )}
                      onClick={() => setSelectedPreset("medium")}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                        Medium
                      </span>
                      {selectedPreset === 'medium' && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      className={cn(
                        "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                        selectedPreset === 'aggressive'
                          ? "bg-gradient-to-r from-orange-600 via-amber-700 to-orange-800 text-white shadow-lg shadow-orange-500/50 hover:shadow-xl hover:shadow-orange-500/60 hover:scale-110"
                          : "bg-orange-500/10 text-orange-400 border border-orange-500/30 hover:bg-orange-500/20 hover:border-orange-500/50 hover:scale-105"
                      )}
                      onClick={() => setSelectedPreset("aggressive")}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-300 animate-pulse" />
                        Aggressive
                      </span>
                      {selectedPreset === 'aggressive' && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      className="rounded-full px-5 py-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 transition-all duration-200 hover:scale-105 font-semibold"
                      onClick={() => {
                        setSelectedPreset(null);
                        setShowBestPerTicker(false);
                        setSelectedLeaps(new Set());
                      }}
                    >
                      Clear All Filters
                    </Button>
                    <div className="h-6 w-px bg-border mx-2" />
                    <Button
                      variant="ghost"
                      className={cn(
                        "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                        showBestPerTicker
                          ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-purple-500/60"
                          : "bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 hover:border-purple-500/50"
                      )}
                      onClick={() => setShowBestPerTicker(!showBestPerTicker)}
                    >
                      {showBestPerTicker ? '✓ ' : ''}Best Per Ticker
                    </Button>
                  </div>
                </div>
              )}

              {/* LEAP Opportunities Table */}
              {scanLeapsMutation.data && scanLeapsMutation.data.opportunities.length > 0 && (
                <div className="mt-6 space-y-4">
                  {/* Order Summary */}
                  {orderSummary && (
                    <Card className="bg-gradient-to-br from-amber-900/20 to-orange-900/20 border-amber-700/50">
                      <CardHeader>
                        <CardTitle>Order Summary</CardTitle>
                        <CardDescription>Review your selected LEAPs</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-4 gap-4">
                          <div className="bg-green-900/30 rounded-lg p-4 border border-green-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <DollarSign className="h-5 w-5 text-green-400" />
                              <span className="text-sm text-muted-foreground">Total Cost</span>
                            </div>
                            <div className="text-2xl font-bold text-green-400">
                              {orderSummary.totalCost.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-muted-foreground">Total Contracts</span>
                            </div>
                            <div className="text-2xl font-bold text-amber-400">
                              {orderSummary.totalContracts}
                            </div>
                          </div>
                          <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-muted-foreground">Avg Delta</span>
                            </div>
                            <div className="text-2xl font-bold text-blue-400">
                              {orderSummary.avgDelta.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-purple-900/30 rounded-lg p-4 border border-purple-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-muted-foreground">Avg Score</span>
                            </div>
                            <div className="text-2xl font-bold text-purple-400">
                              {Math.round(orderSummary.avgScore)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Table Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => {
                          const timestamp = new Date().toISOString().split('T')[0];
                          exportToCSV(sortedLeaps, `PMCC_Opportunities_${timestamp}`);
                          toast.success(`Exported ${sortedLeaps.length} LEAP opportunities to CSV`);
                        }}
                        variant="outline"
                        size="sm"
                        disabled={sortedLeaps.length === 0}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                      </Button>
                      <Button onClick={selectAllLeaps} variant="outline" size="sm">
                        Select All
                      </Button>
                      <Button onClick={clearAllLeaps} variant="outline" size="sm">
                        Clear All
                      </Button>
                      <Button
                        onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                        variant={showSelectedOnly ? "default" : "outline"}
                        size="sm">
                        {showSelectedOnly ? "Show All" : "Show Selected Only"}
                      </Button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-muted-foreground">
                        {selectedLeaps.size} of {sortedLeaps.length} selected
                      </div>
                      {selectedLeaps.size > 0 && (
                        <Button
                          onClick={() => setShowOrderPreview(true)}
                          className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold"
                          size="sm"
                        >
                          Purchase LEAPs ({selectedLeaps.size})
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* LEAP Opportunities Table */}
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-2 text-left">Select</th>
                          <th className="p-2 text-left cursor-pointer hover:bg-muted" onClick={() => handleSort('symbol')}>
                            <div className="flex items-center gap-1">
                              Symbol
                              {sortColumn === 'symbol' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('strike')}>
                            <div className="flex items-center justify-end gap-1">
                              Strike
                              {sortColumn === 'strike' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-left cursor-pointer hover:bg-muted" onClick={() => handleSort('expiration')}>
                            <div className="flex items-center gap-1">
                              Expiration
                              {sortColumn === 'expiration' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('dte')}>
                            <div className="flex items-center justify-end gap-1">
                              DTE
                              <HelpBadge content={HELP_CONTENT.DTE} />
                              {sortColumn === 'dte' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('delta')}>
                            <div className="flex items-center justify-end gap-1">
                              Delta
                              <HelpBadge content={HELP_CONTENT.DELTA_CC} />
                              {sortColumn === 'delta' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('premium')}>
                            <div className="flex items-center justify-end gap-1">
                              Premium
                              {sortColumn === 'premium' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right">Bid</th>
                          <th className="p-2 text-right">Ask</th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('bidAskSpread')}>
                            <div className="flex items-center justify-end gap-1">
                              Spread %
                              {sortColumn === 'bidAskSpread' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('openInterest')}>
                            <div className="flex items-center justify-end gap-1">
                              OI
                              {sortColumn === 'openInterest' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('volume')}>
                            <div className="flex items-center justify-end gap-1">
                              Volume
                              {sortColumn === 'volume' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('score')}>
                            <div className="flex items-center justify-end gap-1">
                              Score
                              {sortColumn === 'score' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLeaps.map((leap) => {
                          const key = getLeapKey(leap);
                          const isSelected = selectedLeaps.has(key);
                          return (
                            <tr key={key} className={isSelected ? "bg-amber-900/20" : "hover:bg-muted/50"}>
                              <td className="p-2">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleLeapSelection(leap)}
                                  className="border-2 border-muted-foreground data-[state=checked]:border-green-500 data-[state=checked]:bg-green-500"
                                />
                              </td>
                              <td className="p-2 font-medium">{leap.symbol}</td>
                              <td className="p-2 text-right">${leap.strike.toFixed(2)}</td>
                              <td className="p-2">{leap.expiration}</td>
                              <td className="p-2 text-right">{leap.dte}</td>
                              <td className="p-2 text-right">{leap.delta.toFixed(2)}</td>
                              <td className="p-2 text-right">${leap.premium.toFixed(2)}</td>
                              <td className="p-2 text-right">${leap.bid.toFixed(2)}</td>
                              <td className="p-2 text-right">${leap.ask.toFixed(2)}</td>
                              <td className="p-2 text-right">{leap.bidAskSpread.toFixed(2)}%</td>
                              <td className="p-2 text-right">{leap.openInterest.toLocaleString()}</td>
                              <td className="p-2 text-right">{leap.volume.toLocaleString()}</td>
                              <td className="p-2 text-right">
                                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold ${
                                  leap.score >= 80 ? 'bg-green-900/50 text-green-400' :
                                  leap.score >= 60 ? 'bg-amber-900/50 text-amber-400' :
                                  'bg-red-900/50 text-red-400'
                                }`}>
                                  {Math.round(leap.score)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Active PMCC Positions (Placeholder) */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Active PMCC Positions</CardTitle>
            <CardDescription>
              Your owned LEAPs available for selling covered calls
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground text-center py-8">
              <p>No LEAP positions found. Start by scanning for LEAP opportunities above!</p>
            </div>
          </CardContent>
        </Card>
        
        {/* Scanning Progress Dialog */}
        <Dialog open={isScanning} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Scanning for LEAPs</DialogTitle>
              <DialogDescription>
                Analyzing {watchlist.length} symbols for LEAP call options (9-15 months out, deep ITM)...
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center space-y-4 py-6">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <Progress value={scanProgress} className="w-full" />
              <p className="text-sm text-muted-foreground">
                {scanProgress < 100 ? (
                  <>
                    {Math.floor((100 - scanProgress) * watchlist.length * 2.0 / 100)}s remaining
                  </>
                ) : (
                  <>Finishing up...</>
                )}
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Order Preview Dialog */}
        <Dialog open={showOrderPreview} onOpenChange={setShowOrderPreview}>
          <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Review LEAP Purchase Order</DialogTitle>
              <DialogDescription>
                Review your selected LEAPs before submitting orders
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Dry Run Toggle */}
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-semibold">Dry Run Mode</p>
                  <p className="text-sm text-muted-foreground">Test orders without executing them</p>
                </div>
                <Button
                  variant={isDryRun ? "default" : "outline"}
                  onClick={() => setIsDryRun(!isDryRun)}
                >
                  {isDryRun ? "Dry Run" : "Live Mode"}
                </Button>
              </div>

              {/* Selected LEAPs Table */}
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left">Symbol</th>
                      <th className="p-2 text-right">Strike</th>
                      <th className="p-2 text-left">Expiration</th>
                      <th className="p-2 text-right">DTE</th>
                      <th className="p-2 text-right">Delta</th>
                      <th className="p-2 text-right">Premium</th>
                      <th className="p-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeaps
                      .filter(leap => selectedLeaps.has(getLeapKey(leap)))
                      .map(leap => (
                        <tr key={getLeapKey(leap)} className="border-t">
                          <td className="p-2 font-medium">{leap.symbol}</td>
                          <td className="p-2 text-right">${leap.strike.toFixed(2)}</td>
                          <td className="p-2">{leap.expiration}</td>
                          <td className="p-2 text-right">{leap.dte}</td>
                          <td className="p-2 text-right">{leap.delta.toFixed(2)}</td>
                          <td className="p-2 text-right">${leap.premium.toFixed(2)}</td>
                          <td className="p-2 text-right">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs ${
                              leap.score >= 80 ? 'bg-green-900/50 text-green-400' :
                              leap.score >= 60 ? 'bg-amber-900/50 text-amber-400' :
                              'bg-red-900/50 text-red-400'
                            }`}>
                              {Math.round(leap.score)}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Order Summary */}
              {orderSummary && (
                <div className="grid grid-cols-4 gap-4">
                  <div className="p-4 bg-green-900/20 border border-green-700/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Total Cost</p>
                    <p className="text-2xl font-bold text-green-400">${orderSummary.totalCost.toFixed(2)}</p>
                  </div>
                  <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Contracts</p>
                    <p className="text-2xl font-bold text-amber-400">{orderSummary.totalContracts}</p>
                  </div>
                  <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Avg Delta</p>
                    <p className="text-2xl font-bold text-blue-400">{orderSummary.avgDelta.toFixed(2)}</p>
                  </div>
                  <div className="p-4 bg-purple-900/20 border border-purple-700/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Avg Score</p>
                    <p className="text-2xl font-bold text-purple-400">{Math.round(orderSummary.avgScore)}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col items-end gap-2">
                {tradingMode === 'paper' && (
                  <p className="text-sm text-blue-500 font-semibold">
                    ⓘ Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowOrderPreview(false)} disabled={isSubmittingOrders}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      const selectedLeapsArray = sortedLeaps.filter(leap => selectedLeaps.has(getLeapKey(leap)));
                      setIsSubmittingOrders(true);
                      submitLeapOrdersMutation.mutate({
                        leaps: selectedLeapsArray.map(leap => ({
                          symbol: leap.symbol,
                          strike: leap.strike,
                          expiration: leap.expiration,
                          premium: leap.premium,
                        })),
                        isDryRun,
                      });
                    }}
                    disabled={isSubmittingOrders || tradingMode === 'paper'}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    title={tradingMode === 'paper' ? 'Order submission is disabled in Paper Trading mode' : undefined}
                  >
                  {isSubmittingOrders ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isDryRun ? "Testing..." : "Submitting..."}
                    </>
                  ) : (
                    <>{isDryRun ? "Test Order" : "Submit Order"}</>
                  )}
                </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
