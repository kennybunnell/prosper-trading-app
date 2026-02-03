import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, TrendingUp, ArrowUp, ArrowDown, DollarSign, Download, RefreshCw, Plus, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { HelpBadge } from "@/components/HelpBadge";
import { HELP_CONTENT } from "@/lib/helpContent";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { trpc } from "@/lib/trpc";
import { useTradingMode } from "@/contexts/TradingModeContext";
import { toast } from "sonner";
import { cn, exportToCSV } from "@/lib/utils";
import { Streamdown } from "streamdown";

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
  const [showScoreExplanation, setShowScoreExplanation] = useState(false);
  const [selectedLeapForExplanation, setSelectedLeapForExplanation] = useState<any>(null);
  
  // Range filter states (using range arrays like CSP/CC dashboards)
  const [scoreFilter, setScoreFilter] = useState({ min: 0, max: 100 });
  const [deltaFilter, setDeltaFilter] = useState({ min: 0.70, max: 0.85 });
  const [dteFilter, setDteFilter] = useState({ min: 270, max: 450 });

  // No longer using database presets - using direct range filters instead
  
  // Fetch watchlist to count symbols for progress calculation
  const { data: watchlist = [] } = trpc.watchlist.get.useQuery();
  
  // Fetch selected watchlist symbols for filtering
  const { data: selectedSymbolsData = [] } = trpc.watchlist.getSelections.useQuery();
  // Filter to only get symbols where isSelected === 1, then map to symbol strings
  const selectedSymbols = useMemo(() => {
    return selectedSymbolsData
      .filter((s: any) => s.isSelected === 1)
      .map((s: any) => s.symbol);
  }, [selectedSymbolsData]);
  
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
    // Check if any symbols are selected
    if (selectedSymbols.length === 0) {
      toast.error('Please select at least one symbol from the watchlist');
      return;
    }
    
    setIsScanning(true);
    setScanStartTime(Date.now());
    setScanProgress(0);
    // Pass selected symbols for scanning with default preset
    scanLeapsMutation.mutate({ 
      presetName: 'medium',
      symbols: selectedSymbols
    });
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
    
    // Apply range filters
    filtered = filtered.filter(leap => {
      // Score filter
      if (leap.score < scoreFilter.min || leap.score > scoreFilter.max) return false;
      
      // DTE filter
      if (leap.dte < dteFilter.min || leap.dte > dteFilter.max) return false;
      
      // Delta filter (use absolute value)
      const delta = Math.abs(leap.delta);
      if (delta < deltaFilter.min || delta > deltaFilter.max) return false;
      
      return true;
    });
    

    
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
  }, [scanLeapsMutation.data?.opportunities, selectedLeaps, showSelectedOnly, sortColumn, sortDirection, scoreFilter, dteFilter, deltaFilter]);

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
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-purple-500" />
              <h1 className="text-3xl font-bold">PMCC Dashboard</h1>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Page
            </Button>
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
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Range Filters</label>
                    <div className="space-y-3">
                      {/* Score Filter */}
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground w-16">Score:</label>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setScoreFilter(prev => ({ ...prev, min: Math.max(0, prev.min - 1) }))}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            type="number"
                            value={scoreFilter.min}
                            onChange={(e) => setScoreFilter(prev => ({ ...prev, min: Math.max(0, parseInt(e.target.value) || 0) }))}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background text-center"
                            min="0"
                            max="100"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setScoreFilter(prev => ({ ...prev, min: Math.min(100, prev.min + 1) }))}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-muted-foreground">to</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setScoreFilter(prev => ({ ...prev, max: Math.max(0, prev.max - 1) }))}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            type="number"
                            value={scoreFilter.max}
                            onChange={(e) => setScoreFilter(prev => ({ ...prev, max: Math.min(100, parseInt(e.target.value) || 100) }))}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background text-center"
                            min="0"
                            max="100"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setScoreFilter(prev => ({ ...prev, max: Math.min(100, prev.max + 1) }))}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Delta Filter */}
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground w-16">Delta:</label>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeltaFilter(prev => ({ ...prev, min: Math.max(0, prev.min - 0.01) }))}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            type="number"
                            value={deltaFilter.min}
                            onChange={(e) => setDeltaFilter(prev => ({ ...prev, min: Math.max(0, parseFloat(e.target.value) || 0) }))}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background text-center"
                            step="0.01"
                            min="0"
                            max="1"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeltaFilter(prev => ({ ...prev, min: Math.min(1, prev.min + 0.01) }))}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-muted-foreground">to</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeltaFilter(prev => ({ ...prev, max: Math.max(0, prev.max - 0.01) }))}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            type="number"
                            value={deltaFilter.max}
                            onChange={(e) => setDeltaFilter(prev => ({ ...prev, max: Math.min(1, parseFloat(e.target.value) || 1) }))}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background text-center"
                            step="0.01"
                            min="0"
                            max="1"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeltaFilter(prev => ({ ...prev, max: Math.min(1, prev.max + 0.01) }))}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* DTE Filter */}
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground w-16">DTE:</label>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDteFilter(prev => ({ ...prev, min: Math.max(0, prev.min - 1) }))}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            type="number"
                            value={dteFilter.min}
                            onChange={(e) => setDteFilter(prev => ({ ...prev, min: Math.max(0, parseInt(e.target.value) || 0) }))}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background text-center"
                            min="0"
                            max="730"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDteFilter(prev => ({ ...prev, min: Math.min(730, prev.min + 1) }))}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-muted-foreground">to</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDteFilter(prev => ({ ...prev, max: Math.max(0, prev.max - 1) }))}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            type="number"
                            value={dteFilter.max}
                            onChange={(e) => setDteFilter(prev => ({ ...prev, max: Math.min(730, parseInt(e.target.value) || 730) }))}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background text-center"
                            min="0"
                            max="730"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDteFilter(prev => ({ ...prev, max: Math.min(730, prev.max + 1) }))}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
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
                                <button
                                  onClick={() => {
                                    setSelectedLeapForExplanation(leap);
                                    setShowScoreExplanation(true);
                                  }}
                                  className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold cursor-pointer transition-all hover:scale-110 hover:shadow-lg ${
                                    leap.score >= 80 ? 'bg-green-900/50 text-green-400 hover:bg-green-900/70' :
                                    leap.score >= 60 ? 'bg-amber-900/50 text-amber-400 hover:bg-amber-900/70' :
                                    'bg-red-900/50 text-red-400 hover:bg-red-900/70'
                                  }`}
                                  title="Click to explain score"
                                >
                                  {Math.round(leap.score)}
                                </button>
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
        <Dialog open={isScanning} onOpenChange={(open) => {
          if (!open) {
            // Cancel button clicked - abort scan
            setIsScanning(false);
            setScanStartTime(null);
            setScanProgress(0);
            toast.info('Scan cancelled');
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Scanning for LEAPs</DialogTitle>
              <DialogDescription>
                Analyzing {selectedSymbols.length} symbols for LEAP call options (9-15 months out, deep ITM)...
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center space-y-4 py-6">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <Progress value={scanProgress} className="w-full" />
              <p className="text-sm text-muted-foreground">
                {scanProgress < 100 ? (
                  <>
                    {Math.floor((100 - scanProgress) * selectedSymbols.length * 2.0 / 100)}s remaining
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
                  disabled={tradingMode === 'paper'}
                >
                  {isDryRun ? "Dry Run" : "Live Mode"}
                  {tradingMode === 'paper' && <span className="ml-2 text-xs">(Forced)</span>}
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

        {/* Score Explanation Dialog */}
        <ScoreExplanationDialog
          leap={selectedLeapForExplanation}
          open={showScoreExplanation}
          onClose={() => {
            setShowScoreExplanation(false);
            setSelectedLeapForExplanation(null);
          }}
        />
      </div>
    </div>
  );
}

// Score Explanation Dialog Component
function ScoreExplanationDialog({ leap, open, onClose }: { leap: any; open: boolean; onClose: () => void }) {
  const explainScoreMutation = trpc.pmcc.explainScore.useMutation();

  useEffect(() => {
    if (open && leap && !explainScoreMutation.data) {
      explainScoreMutation.mutate({ leap });
    }
  }, [open, leap]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            LEAP Score Explanation: {leap?.symbol} ${leap?.strike}
          </DialogTitle>
          <DialogDescription>
            Expiration: {leap?.expiration} ({leap?.dte} DTE) • Delta: {leap?.delta?.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        {explainScoreMutation.isPending && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Analyzing LEAP score...</span>
          </div>
        )}

        {explainScoreMutation.error && (
          <div className="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
            <p className="text-red-400">Failed to generate explanation: {explainScoreMutation.error.message}</p>
          </div>
        )}

        {explainScoreMutation.data && (
          <div className="space-y-4">
            {/* Score Breakdown */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-lg">Score Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="text-sm text-muted-foreground">Stock Quality & Growth</div>
                    <div className="text-2xl font-bold text-blue-400">
                      {explainScoreMutation.data.breakdown.stockQuality}/35
                    </div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="text-sm text-muted-foreground">LEAP Structure</div>
                    <div className="text-2xl font-bold text-purple-400">
                      {explainScoreMutation.data.breakdown.leapStructure}/30
                    </div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="text-sm text-muted-foreground">Cost & Liquidity</div>
                    <div className="text-2xl font-bold text-amber-400">
                      {explainScoreMutation.data.breakdown.costLiquidity}/25
                    </div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="text-sm text-muted-foreground">Risk Management</div>
                    <div className="text-2xl font-bold text-green-400">
                      {explainScoreMutation.data.breakdown.riskManagement}/10
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-gradient-to-r from-slate-800/50 to-slate-700/50 rounded-lg border border-slate-600/50">
                  <div className="text-sm text-muted-foreground">Total Score</div>
                  <div className={`text-4xl font-bold ${
                    explainScoreMutation.data.score >= 80 ? 'text-green-400' :
                    explainScoreMutation.data.score >= 60 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {explainScoreMutation.data.score}/100
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* AI Explanation */}
            <Card className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 border-blue-700/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="text-2xl">🤖</span>
                  AI Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-invert max-w-none">
                  <Streamdown>{typeof explainScoreMutation.data.aiExplanation === 'string' ? explainScoreMutation.data.aiExplanation : JSON.stringify(explainScoreMutation.data.aiExplanation)}</Streamdown>
                </div>
              </CardContent>
            </Card>

            {/* Technical Details */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-lg">Technical Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-invert max-w-none text-sm">
                  <Streamdown>{explainScoreMutation.data.technicalExplanation}</Streamdown>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
