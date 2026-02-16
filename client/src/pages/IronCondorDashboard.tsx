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
  const [minDte, setMinDte] = useState(30);
  const [maxDte, setMaxDte] = useState(60);
  const [spreadWidth, setSpreadWidth] = useState(5);
  
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
    const filtered = showSelectedOnly 
      ? opportunities.filter((opp: any) => selectedOpportunities.has(`${opp.symbol}-${opp.expiration}`))
      : opportunities;
    
    setSelectedOpportunities(new Set(
      filtered.map((opp: any) => `${opp.symbol}-${opp.expiration}`)
    ));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedOpportunities(new Set());
  };

  // Filter opportunities
  const displayedOpportunities = useMemo(() => {
    if (showSelectedOnly) {
      return opportunities.filter((opp: any) => 
        selectedOpportunities.has(`${opp.symbol}-${opp.expiration}`)
      );
    }
    return opportunities;
  }, [opportunities, showSelectedOnly, selectedOpportunities]);

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

    setWatchlistExpanded(false);
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

      {/* Summary Cards */}
      {opportunities.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Premium</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
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

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Collateral</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${(summaryMetrics.totalCollateral || 0).toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Weighted ROC</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(summaryMetrics.weightedROC || 0).toFixed(2)}%
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
                <Sparkles className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {opportunities.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summaryMetrics.count} selected
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedOpportunities.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-muted-foreground">
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
                              <Badge className={getROCColor(opp.totalROC)}>
                                {(opp.totalROC || 0).toFixed(2)}%
                              </Badge>
                            </TableCell>
                            <TableCell>
                              ${opp.putShortStrike} - ${opp.callShortStrike}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div>${(opp.putBreakeven || 0).toFixed(2)}</div>
                                <div>${(opp.callBreakeven || 0).toFixed(2)}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={getIVRankColor(opp.ivRank)}>
                                {opp.ivRank?.toFixed(0) ?? "N/A"}
                              </Badge>
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
        availableBuyingPower={0}
        onSubmit={async () => {
          toast.info("Order submission coming soon");
          return { results: [] };
        }}
      />
    </div>
  );
}
