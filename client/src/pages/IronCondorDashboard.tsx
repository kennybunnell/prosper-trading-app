import { useAuth } from "@/_core/hooks/useAuth";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { useTradingMode } from "@/contexts/TradingModeContext";
import {
  Loader2,
  TrendingUp,
  DollarSign,
  Target,
  HelpCircle,
  Sparkles,
  Filter,
  Plus,
  Minus,
  X,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { UnifiedOrderPreviewModal } from "@/components/UnifiedOrderPreviewModal";

// Color-coding helper functions
function getROCColor(roc: number): string {
  if (roc > 1.5) return "bg-green-500/20 text-green-500 border-green-500/50";
  if (roc >= 1.0) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
  return "bg-red-500/20 text-red-500 border-red-500/50";
}

function getIVRankColor(ivRank: number | null): string {
  if (ivRank === null) return "bg-gray-500/20 text-gray-500 border-gray-500/50";
  if (ivRank >= 60) return "bg-green-500/20 text-green-500 border-green-500/50";
  if (ivRank >= 30) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
  return "bg-red-500/20 text-red-500 border-red-500/50";
}

export default function IronCondorDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { mode: tradingMode } = useTradingMode();
  
  const { selectedAccountId } = useAccount();
  const [watchlistExpanded, setWatchlistExpanded] = useState(true);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [selectedPortfolioSizes, setSelectedPortfolioSizes] = useState<string[]>(['small', 'medium', 'large']);
  
  // Filter parameters
  const [minDte, setMinDte] = useState(7);
  const [maxDte, setMaxDte] = useState(45);
  const [spreadWidth, setSpreadWidth] = useState(5);
  
  // Range filter state (for UI sliders)
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [deltaRange, setDeltaRange] = useState<[number, number]>([0, 1]);
  const [dteRange, setDteRange] = useState<[number, number]>([0, 90]);
  const [minDelta, setMinDelta] = useState(0.15);
  const [maxDelta, setMaxDelta] = useState(0.35);
  
  // Watchlist management
  const { data: watchlist = [], refetch: refetchWatchlist } = trpc.watchlist.get.useQuery(undefined, {
    enabled: !!user,
  });

  // Filter watchlist by portfolio size
  const filteredWatchlist = useMemo(() => {
    return watchlist.filter((w: any) => 
      selectedPortfolioSizes.includes(w.portfolioSize || 'medium')
    );
  }, [watchlist, selectedPortfolioSizes]);

  // Fetch Iron Condor opportunities
  const { data: opportunities = [], isLoading: loadingOpportunities, refetch: refetchOpportunities } = trpc.ironCondor.opportunities.useQuery(
    { 
      symbols: filteredWatchlist.map((w: any) => w.symbol),
      minDte,
      maxDte,
      spreadWidth,
    },
    { enabled: false }
  );

  // Fetch buying power
  const { data: buyingPowerData } = trpc.accounts.getBuyingPower.useQuery(
    { accountId: selectedAccountId || '' },
    { enabled: !!selectedAccountId, refetchInterval: 30000 }
  );
  
  const availableBuyingPower = buyingPowerData?.buyingPower || 0;

  // Selection state
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // Order preview modal
  const [orderPreviewOpen, setOrderPreviewOpen] = useState(false);

  // Handle opportunity selection
  const toggleOpportunity = (key: string) => {
    setSelectedOpportunities(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Select all filtered
  const selectAllFiltered = () => {
    // Use displayedOpportunities which already has filters applied
    setSelectedOpportunities(new Set(
      displayedOpportunities.map((opp: any) => `${opp.symbol}-${opp.expiration}`)
    ));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedOpportunities(new Set());
  };

  // Filter opportunities
  const displayedOpportunities = useMemo(() => {
    let filtered = [...opportunities];
    
    // Apply score filter
    filtered = filtered.filter((opp: any) => {
      const score = opp.score || 0;
      return score >= scoreRange[0] && score <= scoreRange[1];
    });
    
    // Apply delta filter (check both put and call deltas)
    filtered = filtered.filter((opp: any) => {
      const putDelta = Math.abs(opp.putShortDelta || 0);
      const callDelta = Math.abs(opp.callShortDelta || 0);
      return (putDelta >= deltaRange[0] && putDelta <= deltaRange[1]) ||
             (callDelta >= deltaRange[0] && callDelta <= deltaRange[1]);
    });
    
    // Apply DTE filter
    filtered = filtered.filter((opp: any) => {
      return opp.dte >= dteRange[0] && opp.dte <= dteRange[1];
    });
    
    // Apply "Show Selected Only" filter
    if (showSelectedOnly) {
      filtered = filtered.filter((opp: any) => 
        selectedOpportunities.has(`${opp.symbol}-${opp.expiration}`)
      );
    }
    
    return filtered;
  }, [opportunities, showSelectedOnly, selectedOpportunities, scoreRange, deltaRange, dteRange]);

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const selected = opportunities.filter((opp: any) => 
      selectedOpportunities.has(`${opp.symbol}-${opp.expiration}`)
    );

    const totalPremium = selected.reduce((sum: number, opp: any) => sum + (opp.totalNetCredit * 100), 0);
    const totalCollateral = selected.reduce((sum: number, opp: any) => sum + opp.totalCollateral, 0);
    const weightedROC = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;

    return {
      totalPremium,
      totalCollateral,
      weightedROC,
      count: selected.length,
    };
  }, [opportunities, selectedOpportunities]);

  // Fetch opportunities handler
  const handleFetchOpportunities = async () => {
    if (filteredWatchlist.length === 0) {
      toast.error("No symbols in watchlist");
      return;
    }

    // Don't auto-collapse watchlist - let user keep it open
    await refetchOpportunities();
    toast.success(`Found ${opportunities.length} Iron Condor opportunities`);
  };

  // Handle order preview
  const handleOrderPreview = () => {
    if (selectedOpportunities.size === 0) {
      toast.error("No opportunities selected");
      return;
    }
    setOrderPreviewOpen(true);
  };

  // Build orders for preview modal
  const ordersForPreview = useMemo(() => {
    const selected = opportunities.filter((opp: any) => 
      selectedOpportunities.has(`${opp.symbol}-${opp.expiration}`)
    );

    return selected.flatMap((opp: any) => {
      // Create 4 legs for Iron Condor
      return [
        // Put side - short
        {
          symbol: opp.symbol,
          strategy: "STO" as const,
          action: "sell_to_open" as const,
          strike: opp.putShortStrike,
          expiration: opp.expiration,
          premium: opp.putNetCredit,
          bid: opp.putShortBid,
          ask: opp.putShortAsk,
          quantity: 1,
          optionType: "PUT" as const,
          dte: opp.dte,
          delta: opp.putShortDelta,
          collateral: 0, // Collateral calculated for full spread
          longStrike: opp.putLongStrike,
          longPremium: 0,
          longBid: opp.putLongBid,
          longAsk: opp.putLongAsk,
        },
        // Put side - long
        {
          symbol: opp.symbol,
          strategy: "BTO" as const,
          action: "buy_to_open" as const,
          strike: opp.putLongStrike,
          expiration: opp.expiration,
          premium: -opp.putLongAsk,
          bid: opp.putLongBid,
          ask: opp.putLongAsk,
          quantity: 1,
          optionType: "PUT" as const,
          dte: opp.dte,
          delta: opp.putLongDelta,
          collateral: 0,
        },
        // Call side - short
        {
          symbol: opp.symbol,
          strategy: "STO" as const,
          action: "sell_to_open" as const,
          strike: opp.callShortStrike,
          expiration: opp.expiration,
          premium: opp.callNetCredit,
          bid: opp.callShortBid,
          ask: opp.callShortAsk,
          quantity: 1,
          optionType: "CALL" as const,
          dte: opp.dte,
          delta: opp.callShortDelta,
          collateral: opp.totalCollateral, // Full collateral on call side
          longStrike: opp.callLongStrike,
          longPremium: 0,
          longBid: opp.callLongBid,
          longAsk: opp.callLongAsk,
        },
        // Call side - long
        {
          symbol: opp.symbol,
          strategy: "BTO" as const,
          action: "buy_to_open" as const,
          strike: opp.callLongStrike,
          expiration: opp.expiration,
          premium: -opp.callLongAsk,
          bid: opp.callLongBid,
          ask: opp.callLongAsk,
          quantity: 1,
          optionType: "CALL" as const,
          dte: opp.dte,
          delta: opp.callLongDelta,
          collateral: 0,
        },
      ];
    });
  }, [opportunities, selectedOpportunities]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please sign in to access the Iron Condor dashboard</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Iron Condor Dashboard</h1>
          <p className="text-muted-foreground">
            Scan for 4-leg Iron Condor opportunities combining Bull Put and Bear Call spreads
          </p>
        </div>
        <ConnectionStatusIndicator />
      </div>

      {/* Watchlist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Watchlist</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWatchlistExpanded(!watchlistExpanded)}
            >
              {watchlistExpanded ? "Collapse" : "Expand"}
            </Button>
          </div>
        </CardHeader>
        {watchlistExpanded && (
          <CardContent>
            <EnhancedWatchlist />
            
            {/* Filters */}
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Min DTE</label>
                  <input
                    type="number"
                    value={minDte}
                    onChange={(e) => setMinDte(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border rounded-md"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Max DTE</label>
                  <input
                    type="number"
                    value={maxDte}
                    onChange={(e) => setMaxDte(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border rounded-md"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Spread Width</label>
                  <select
                    value={spreadWidth}
                    onChange={(e) => setSpreadWidth(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border rounded-md"
                  >
                    <option value={2}>2 points</option>
                    <option value={5}>5 points</option>
                    <option value={10}>10 points</option>
                  </select>
                </div>
              </div>

              <Button
                onClick={handleFetchOpportunities}
                disabled={loadingOpportunities || filteredWatchlist.length === 0}
                className="w-full"
              >
                {loadingOpportunities ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning for Iron Condors...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Scan for Iron Condors
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Filters Section */}
      {opportunities.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              <CardTitle>Filters</CardTitle>
            </div>
            <CardDescription>Adjust sliders to filter opportunities</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Score Filter (Primary) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-orange-500">Score (Primary Filter)</label>
                <span className="text-xs text-muted-foreground">0 - 100</span>
              </div>
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setScoreRange([Math.max(0, scoreRange[0] - 5), scoreRange[1]])}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-sm font-mono w-8 text-center">{scoreRange[0]}</span>
                <Slider
                  value={scoreRange}
                  onValueChange={(value) => setScoreRange(value as [number, number])}
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-sm font-mono w-8 text-center">{scoreRange[1]}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setScoreRange([scoreRange[0], Math.min(100, scoreRange[1] + 5)])}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-2">
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

            {/* Delta Filter */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Delta (Δ)</label>
                <span className="text-xs text-muted-foreground">0.00 - 1.00</span>
              </div>
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setDeltaRange([Math.max(0, deltaRange[0] - 0.05), deltaRange[1]])}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-sm font-mono w-12 text-center">{deltaRange[0].toFixed(2)}</span>
                <Slider
                  value={deltaRange}
                  onValueChange={(value) => setDeltaRange(value as [number, number])}
                  min={0}
                  max={1}
                  step={0.01}
                  className="flex-1"
                />
                <span className="text-sm font-mono w-12 text-center">{deltaRange[1].toFixed(2)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setDeltaRange([deltaRange[0], Math.min(1, deltaRange[1] + 0.05)])}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* DTE Filter */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Days to Expiration (DTE)</label>
                <span className="text-xs text-muted-foreground">0 - 90 days</span>
              </div>
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setDteRange([Math.max(0, dteRange[0] - 5), dteRange[1]])}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-sm font-mono w-8 text-center">{dteRange[0]}</span>
                <Slider
                  value={dteRange}
                  onValueChange={(value) => setDteRange(value as [number, number])}
                  min={0}
                  max={90}
                  step={1}
                  className="flex-1"
                />
                <span className="text-sm font-mono w-8 text-center">{dteRange[1]}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setDteRange([dteRange[0], Math.min(90, dteRange[1] + 5)])}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Selection Controls */}
            <div className="flex gap-4 pt-4 border-t">
              <Button
                onClick={selectAllFiltered}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
              >
                ✓ Select All Filtered ({displayedOpportunities.length})
              </Button>
              <Button
                onClick={clearSelection}
                variant="outline"
                className="flex-1 bg-gradient-to-r from-red-500/10 to-red-600/10 hover:from-red-500/20 hover:to-red-600/20"
              >
                ✕ Clear Selection ({selectedOpportunities.size})
              </Button>
            </div>

            {/* Show Selected Only Checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-selected"
                checked={showSelectedOnly}
                onCheckedChange={(checked) => setShowSelectedOnly(checked as boolean)}
              />
              <label htmlFor="show-selected" className="text-sm font-medium cursor-pointer">
                Show Selected Only
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {opportunities.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="bg-gradient-to-br from-green-500/10 to-green-600/10 border-green-500/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Premium</CardTitle>
                <DollarSign className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-500">
                  ${(summaryMetrics.totalPremium || 0).toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summaryMetrics.count} selected
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Collateral</CardTitle>
                <Target className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${(summaryMetrics.totalCollateral || 0).toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Weighted ROC</CardTitle>
                <TrendingUp className="h-4 w-4 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(summaryMetrics.weightedROC || 0).toFixed(2)}%
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 border-orange-500/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
                <Sparkles className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {displayedOpportunities.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summaryMetrics.count} selected
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Buying Power</CardTitle>
                <Target className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${availableBuyingPower.toFixed(2)}
                </div>
                <p className={`text-xs font-medium ${
                  summaryMetrics.totalCollateral === 0 ? 'text-muted-foreground' :
                  (summaryMetrics.totalCollateral / availableBuyingPower) > 0.9 ? 'text-red-500' :
                  (summaryMetrics.totalCollateral / availableBuyingPower) > 0.8 ? 'text-yellow-500' :
                  'text-green-500'
                }`}>
                  {summaryMetrics.totalCollateral > 0 && availableBuyingPower > 0
                    ? `${((summaryMetrics.totalCollateral / availableBuyingPower) * 100).toFixed(1)}% used`
                    : 'Available'
                  }
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Selection Controls */}
          <div className="flex items-center gap-4">
            <Button
              onClick={selectAllFiltered}
              variant="outline"
              size="sm"
              className="bg-gradient-to-r from-green-500/10 to-green-600/10 hover:from-green-500/20 hover:to-green-600/20"
            >
              Select All Filtered
            </Button>
            <Button
              onClick={clearSelection}
              variant="outline"
              size="sm"
              className="bg-gradient-to-r from-red-500/10 to-red-600/10 hover:from-red-500/20 hover:to-red-600/20"
            >
              Clear Selection
            </Button>
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-selected"
                checked={showSelectedOnly}
                onCheckedChange={(checked) => setShowSelectedOnly(checked as boolean)}
              />
              <label htmlFor="show-selected" className="text-sm font-medium cursor-pointer">
                Show Selected Only
              </label>
            </div>
            <div className="ml-auto">
              <Button
                onClick={handleOrderPreview}
                disabled={selectedOpportunities.size === 0}
                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
              >
                Preview Orders ({selectedOpportunities.size})
              </Button>
            </div>
          </div>

          {/* Opportunities Table */}
          <Card>
            <CardHeader>
              <CardTitle>Iron Condor Opportunities</CardTitle>
              <CardDescription>
                4-leg neutral income strategy - profit if stock stays between short strikes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Current</TableHead>
                      <TableHead>Put Strikes</TableHead>
                      <TableHead>Call Strikes</TableHead>
                      <TableHead>DTE</TableHead>
                      <TableHead>Net Credit</TableHead>
                      <TableHead>Collateral</TableHead>
                      <TableHead>ROC %</TableHead>
                      <TableHead>Profit Zone</TableHead>
                      <TableHead>Breakevens</TableHead>
                      <TableHead>IV Rank</TableHead>
                      <TableHead>RSI</TableHead>
                      <TableHead>BB %B</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedOpportunities.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={15} className="text-center text-muted-foreground">
                          No opportunities found
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedOpportunities.map((opp: any) => {
                        const key = `${opp.symbol}-${opp.expiration}`;
                        const isSelected = selectedOpportunities.has(key);

                        return (
                          <TableRow key={key} className={isSelected ? "bg-primary/5" : ""}>
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleOpportunity(key)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{opp.symbol}</TableCell>
                            <TableCell>
                              <Badge className={`${
                                (opp.score || 0) >= 70 ? 'bg-green-500/20 text-green-500 border-green-500/50' :
                                (opp.score || 0) >= 55 ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                                'bg-red-500/20 text-red-500 border-red-500/50'
                              }`}>
                                {(opp.score || 0).toFixed(1)}
                              </Badge>
                            </TableCell>
                            <TableCell>${(opp.currentPrice || 0).toFixed(2)}</TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div>Short: ${opp.putShortStrike}</div>
                                <div className="text-muted-foreground">Long: ${opp.putLongStrike}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div>Short: ${opp.callShortStrike}</div>
                                <div className="text-muted-foreground">Long: ${opp.callLongStrike}</div>
                              </div>
                            </TableCell>
                            <TableCell>{opp.dte}</TableCell>
                            <TableCell className="text-green-500 font-medium">
                              ${((opp.totalNetCredit || 0) * 100).toFixed(2)}
                            </TableCell>
                            <TableCell>${(opp.totalCollateral || 0).toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge className={getROCColor(opp.roc)}>
                                {(opp.roc || 0).toFixed(2)}%
                              </Badge>
                            </TableCell>
                            <TableCell>
                              ${opp.putShortStrike} - ${opp.callShortStrike}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div>${(opp.lowerBreakeven || 0).toFixed(2)}</div>
                                <div>${(opp.upperBreakeven || 0).toFixed(2)}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={getIVRankColor(opp.ivRank)}>
                                {opp.ivRank?.toFixed(0) ?? "N/A"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {opp.rsi !== null && opp.rsi !== undefined ? (
                                <Badge className={`${
                                  opp.rsi >= 40 && opp.rsi <= 60 ? 'bg-green-500/20 text-green-500 border-green-500/50' :
                                  opp.rsi >= 35 && opp.rsi <= 65 ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                                  'bg-red-500/20 text-red-500 border-red-500/50'
                                }`}>
                                  {opp.rsi.toFixed(1)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">N/A</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {opp.bbPctB !== null && opp.bbPctB !== undefined ? (
                                <Badge className={`${
                                  opp.bbPctB >= 0.3 && opp.bbPctB <= 0.7 ? 'bg-green-500/20 text-green-500 border-green-500/50' :
                                  opp.bbPctB >= 0.2 && opp.bbPctB <= 0.8 ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                                  'bg-red-500/20 text-red-500 border-red-500/50'
                                }`}>
                                  {opp.bbPctB.toFixed(2)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">N/A</span>
                              )}
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
        </>
      )}

      {/* Order Preview Modal */}
      <UnifiedOrderPreviewModal
        open={orderPreviewOpen}
        onOpenChange={setOrderPreviewOpen}
        orders={ordersForPreview}
        strategy="bps"
        accountId={selectedAccountId || ""}
        availableBuyingPower={availableBuyingPower}
        onSubmit={async () => {
          toast.info("Order submission coming soon");
          return { results: [] };
        }}
      />
    </div>
  );
}
