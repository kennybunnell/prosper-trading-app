import { useState, useEffect, useRef, useMemo } from "react";
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
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
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
} from "lucide-react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

type StockPosition = {
  symbol: string;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  existingContracts: number;
  sharesCovered: number;
  availableShares: number;
  maxContracts: number;
  hasExistingCalls: boolean;
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
  bbPctB: number | null;
  sharesOwned: number;
  maxContracts: number;
  distanceOtm: number;
  score: number;
};

export default function CCDashboard() {
  const { selectedAccountId } = useAccount();
  const utils = trpc.useUtils();
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [holdings, setHoldings] = useState<StockPosition[]>([]);
  const [breakdown, setBreakdown] = useState<PositionBreakdown | null>(null);
  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);
  const [isPositionsSectionExpanded, setIsPositionsSectionExpanded] = useState(true);
  const [isPositionsSectionCollapsed, setIsPositionsSectionCollapsed] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<CCOpportunity[]>([]);
  // Store selected opportunities by unique key (symbol-strike-expiration) instead of index
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  
  // Helper function to create unique key for an opportunity
  const getOpportunityKey = (opp: CCOpportunity) => `${opp.symbol}-${opp.strike}-${opp.expiration}`;
  const [presetFilter, setPresetFilter] = useState<'conservative' | 'medium' | 'aggressive' | null>(null);
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortColumn, setSortColumn] = useState<keyof CCOpportunity | null>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  
  const filtersRef = useRef<HTMLDivElement>(null);

  // Fetch filter presets from database
  const { data: presets } = trpc.ccFilters.getPresets.useQuery();

  // Fetch eligible positions
  const fetchPositions = async () => {
    if (!selectedAccountId) {
      toast.error("Please select an account first");
      return;
    }

    setIsLoadingPositions(true);
    try {
      const result = await utils.client.cc.getEligiblePositions.query({
        accountNumber: selectedAccountId,
      });
      
      setHoldings(result.holdings);
      setBreakdown(result.breakdown);
      setSelectedStocks([]);
      
      toast.success(`Found ${result.breakdown.eligiblePositions} eligible positions`);
    } catch (error: any) {
      toast.error(error.message || "Failed to fetch positions");
    } finally {
      setIsLoadingPositions(false);
    }
  };

  // Handle stock selection
  const toggleStockSelection = (symbol: string) => {
    setSelectedStocks(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const selectAllStocks = () => {
    // Use availableHoldings which already filters for maxContracts > 0
    const eligibleSymbols = holdings
      .filter(h => h.maxContracts > 0)
      .map(h => h.symbol);
    setSelectedStocks(eligibleSymbols);
  };

  const selectAllOpportunities = () => {
    // Group opportunities by symbol and respect available contract limits
    const selectedKeys = new Set<string>();
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
  };

  const clearOpportunitySelection = () => {
    setSelectedOpportunities(new Set());
  };

  const clearSelection = () => {
    setSelectedStocks([]);
  };

  // Countdown timer effect
  useEffect(() => {
    if (!isScanning || !scanStartTime) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - scanStartTime) / 1000;
      const estimatedTotal = selectedStocks.length * 2.0; // 2.0s per symbol (adjusted for buffer)
      const progress = Math.min(95, (elapsed / estimatedTotal) * 100);
      setScanProgress(progress);
    }, 100);

    return () => clearInterval(interval);
  }, [isScanning, scanStartTime, selectedStocks.length]);

  // Scan selected stocks for opportunities
  const scanOpportunities = async () => {
    // Filter out stocks that are fully covered (maxContracts = 0)
    const eligibleStocks = selectedStocks.filter(symbol => {
      const holding = holdings.find(h => h.symbol === symbol);
      return holding && holding.maxContracts > 0;
    });

    if (eligibleStocks.length === 0) {
      toast.error("No eligible stocks selected. Selected stocks are fully covered by existing calls.");
      return;
    }

    const skippedCount = selectedStocks.length - eligibleStocks.length;
    if (skippedCount > 0) {
      toast.info(`Skipping ${skippedCount} stock(s) with existing covered calls`);
    }

    setIsScanning(true);
    setScanStartTime(Date.now());
    setScanProgress(0);
    
    try {
      // Build holdings data for eligible stocks only
      const selectedHoldings = holdings
        .filter(h => eligibleStocks.includes(h.symbol))
        .map(h => ({
          symbol: h.symbol,
          quantity: h.quantity,
          currentPrice: h.currentPrice,
          maxContracts: h.maxContracts,
        }));

      const result = await utils.client.cc.scanOpportunities.mutate({
        symbols: eligibleStocks,
        holdings: selectedHoldings,
        minDte: 7,
        maxDte: 45,
        minDelta: 0.05,
        maxDelta: 0.99,
      });

      setOpportunities(result);
      setSelectedOpportunities(new Set());
      
      // Collapse positions section and scroll to opportunities
      setIsPositionsSectionCollapsed(true);
      setIsPositionsSectionExpanded(false);
      
      setTimeout(() => {
        filtersRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      setScanProgress(100);
      toast.success(`Found ${result.length} opportunities`);
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
        // Check if adding this opportunity would exceed available contracts for this symbol
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
    if (score >= 90) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    if (score >= 70) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (score >= 50) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
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

    return filtered;
  }, [opportunities, presetFilter, presets, minScore]);

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
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      // Handle null values
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredOpportunities, sortColumn, sortDirection, showSelectedOnly, selectedOpportunities]);

  // Handle order submission
  const handleSubmitOrders = async () => {
    if (selectedOpportunities.size === 0) {
      toast.error("Please select at least one opportunity");
      return;
    }

    if (!selectedAccountId) {
      toast.error("Please select an account");
      return;
    }

    setIsSubmitting(true);
    try {
      // Map selected keys back to opportunity objects
      const selectedOpps = Array.from(selectedOpportunities)
        .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
        .filter((opp): opp is CCOpportunity => opp !== undefined);
      
      const orders = selectedOpps.map(opp => ({
        symbol: opp.symbol,
        strike: opp.strike,
        expiration: opp.expiration,
        quantity: 1, // Default to 1 contract per opportunity
        price: opp.bid, // Use bid price for limit orders
      }));

      const results = await utils.client.cc.submitOrders.mutate({
        accountNumber: selectedAccountId,
        orders,
        dryRun,
      });

      const successCount = results.filter((r: any) => r.success).length;
      const failedCount = results.filter((r: any) => !r.success).length;

      if (failedCount === 0) {
        if (dryRun) {
          toast.success(`Dry run successful! ${results.length} orders validated`);
        } else {
          toast.success(`Successfully submitted ${results.length} orders!`);
          
          // Confetti animation
          confetti({
            particleCount: 200,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#f59e0b', '#fbbf24', '#fcd34d'],
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
          
          // Clear selections after successful submission
          setSelectedOpportunities(new Set());
        }
      } else {
        toast.error(`${failedCount} order(s) failed, ${successCount} succeeded`);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to submit orders");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter holdings to only show those with available contracts
  const availableHoldings = holdings.filter(h => h.maxContracts > 0);

  return (
    <div className="container mx-auto py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 bg-clip-text text-transparent">
            Covered Calls Dashboard
          </h1>
          <p className="text-muted-foreground mt-2">
            Generate income from your stock positions
          </p>
        </div>
        <ConnectionStatusIndicator />
      </div>

      {/* Position Summary Section */}
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
                    disabled={isLoadingPositions || !selectedAccountId}
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
                  {!selectedAccountId && (
                    <p className="text-sm text-muted-foreground text-center mt-2">
                      Please select an account from the sidebar
                    </p>
                  )}
                </CardContent>
              </Card>
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

            {/* Stock Selection Table */}
            {availableHoldings.length > 0 && isPositionsSectionExpanded && (
              <Card className="bg-card/50 backdrop-blur border-amber-500/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl">Select Stocks to Scan</CardTitle>
                      <CardDescription>
                        Choose which positions to scan for covered call opportunities
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
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
                        <TableHead className="w-12">Select</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Market Value</TableHead>
                        <TableHead className="text-right">Available Contracts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availableHoldings.map((holding) => (
                        <TableRow key={holding.symbol}>
                          <TableCell>
                    <Checkbox
                      checked={selectedStocks.includes(holding.symbol)}
                      onCheckedChange={() => toggleStockSelection(holding.symbol)}
                      disabled={holding.maxContracts === 0}
                      className="border-2 border-amber-500/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                          </TableCell>
                          <TableCell className="font-semibold">
                            {holding.symbol}
                            {holding.hasExistingCalls && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                Has Calls
                              </Badge>
                            )}
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
                            <Badge
                              variant="secondary"
                              className="bg-amber-500/20 text-amber-400 border-amber-500/30"
                            >
                              {holding.maxContracts}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
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
            <Dialog open={isScanning} onOpenChange={() => {}}>
              <DialogContent className="sm:max-w-md">
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
            {breakdown && availableHoldings.length === 0 && isPositionsSectionExpanded && (
              <Card className="bg-card/50 backdrop-blur border-amber-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-muted-foreground">
                    No eligible positions found. You need stock positions with at least 100
                    shares and available contracts (not already covered by calls).
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Opportunities Section */}
      <div ref={filtersRef}>
        {opportunities.length > 0 && (
          <div className="space-y-6">
            {/* Filter Presets */}
            <Card className="bg-card/50 backdrop-blur border-amber-500/20">
              <CardHeader>
                <CardTitle className="text-xl">Filter Presets</CardTitle>
                <CardDescription>
                  Quick filters based on risk tolerance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="ghost"
                    className={cn(
                      "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                      presetFilter === 'conservative'
                        ? "bg-gradient-to-r from-slate-600 via-gray-700 to-slate-800 text-white shadow-lg shadow-slate-500/50 hover:shadow-xl hover:shadow-slate-500/60 hover:scale-110"
                        : "bg-slate-500/10 text-slate-400 border border-slate-500/30 hover:bg-slate-500/20 hover:border-slate-500/50 hover:scale-105"
                    )}
                    onClick={() => handlePresetFilter('conservative')}
                    size="default"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-300 animate-pulse" />
                      Conservative
                    </span>
                    {presetFilter === 'conservative' && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className={cn(
                      "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                      presetFilter === 'medium'
                        ? "bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-700 text-white shadow-lg shadow-amber-500/50 hover:shadow-xl hover:shadow-amber-500/60 hover:scale-110"
                        : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 hover:scale-105"
                    )}
                    onClick={() => handlePresetFilter('medium')}
                    size="default"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                      Medium
                    </span>
                    {presetFilter === 'medium' && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className={cn(
                      "relative overflow-hidden rounded-full px-5 py-2.5 font-semibold transition-all duration-300",
                      presetFilter === 'aggressive'
                        ? "bg-gradient-to-r from-orange-600 via-amber-700 to-orange-800 text-white shadow-lg shadow-orange-500/50 hover:shadow-xl hover:shadow-orange-500/60 hover:scale-110"
                        : "bg-orange-500/10 text-orange-400 border border-orange-500/30 hover:bg-orange-500/20 hover:border-orange-500/50 hover:scale-105"
                    )}
                    onClick={() => handlePresetFilter('aggressive')}
                    size="default"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-300 animate-pulse" />
                      Aggressive
                    </span>
                    {presetFilter === 'aggressive' && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className="rounded-full px-5 py-2.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all duration-200 hover:scale-105"
                    onClick={() => {
                      setPresetFilter(null);
                      setMinScore(undefined);
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Score Threshold Filters */}
            <Card className="bg-card/50 backdrop-blur border-amber-500/20">
              <CardHeader>
                <CardTitle className="text-xl">Score Threshold</CardTitle>
                <CardDescription>
                  Filter opportunities by minimum composite score
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {[100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40].map(score => (
                    <Button
                      key={score}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "rounded-full px-4 py-2 font-semibold transition-all duration-200",
                        minScore === score
                          ? "bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/50 hover:shadow-xl hover:shadow-amber-500/60 hover:scale-110"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 hover:scale-105"
                      )}
                      onClick={() => handleScoreFilter(score)}
                    >
                      {score}+
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Order Summary */}
            {selectedOpportunities.size > 0 && (
              <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/30">
                <CardHeader>
                  <CardTitle className="text-xl">Order Summary</CardTitle>
                  <CardDescription>
                    Review your selected covered calls
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                      <DollarSign className="w-8 h-8 text-green-400" />
                      <div>
                        <p className="text-sm text-muted-foreground">Total Premium</p>
                        <p className="text-2xl font-bold text-green-400">
                          ${Array.from(selectedOpportunities)
                            .map(key => filteredOpportunities.find(opp => getOpportunityKey(opp) === key))
                            .filter((opp): opp is CCOpportunity => opp !== undefined)
                            .reduce((sum, opp) => sum + opp.premium, 0)
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
                          checked={dryRun}
                          onCheckedChange={(checked) => setDryRun(checked as boolean)}
                        />
                        <span className="text-sm text-muted-foreground">
                          Dry Run Mode (Test without submitting)
                        </span>
                      </label>
                    </div>
                    <Button
                      onClick={handleSubmitOrders}
                      disabled={isSubmitting || selectedOpportunities.size === 0}
                      className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
                      size="lg"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <DollarSign className="w-4 h-4 mr-2" />
                          {dryRun ? 'Test Orders (Dry Run)' : 'Submit Orders'}
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('score')}>
                        <div className="flex items-center justify-end gap-1">
                          Score
                          {sortColumn === 'score' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('strike')}>
                        <div className="flex items-center justify-end gap-1">
                          Strike
                          {sortColumn === 'strike' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('currentPrice')}>
                        <div className="flex items-center justify-end gap-1">
                          Current Price
                          {sortColumn === 'currentPrice' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('dte')}>
                        <div className="flex items-center justify-end gap-1">
                          DTE
                          {sortColumn === 'dte' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('delta')}>
                        <div className="flex items-center justify-end gap-1">
                          Delta
                          {sortColumn === 'delta' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('bid')}>
                        <div className="flex items-center justify-end gap-1">
                          Bid
                          {sortColumn === 'bid' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('ask')}>
                        <div className="flex items-center justify-end gap-1">
                          Ask
                          {sortColumn === 'ask' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('mid')}>
                        <div className="flex items-center justify-end gap-1">
                          Mid
                          {sortColumn === 'mid' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('premium')}>
                        <div className="flex items-center justify-end gap-1">
                          Premium
                          {sortColumn === 'premium' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('weeklyReturn')}>
                        <div className="flex items-center justify-end gap-1">
                          Weekly %
                          {sortColumn === 'weeklyReturn' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('distanceOtm')}>
                        <div className="flex items-center justify-end gap-1">
                          Distance OTM
                          {sortColumn === 'distanceOtm' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('rsi')}>
                        <div className="flex items-center justify-end gap-1">
                          RSI
                          {sortColumn === 'rsi' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('ivRank')}>
                        <div className="flex items-center justify-end gap-1">
                          IV Rank
                          {sortColumn === 'ivRank' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('bbPctB')}>
                        <div className="flex items-center justify-end gap-1">
                          BB %B
                          {sortColumn === 'bbPctB' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('spreadPct')}>
                        <div className="flex items-center justify-end gap-1">
                          Spread %
                          {sortColumn === 'spreadPct' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('volume')}>
                        <div className="flex items-center justify-end gap-1">
                          Volume
                          {sortColumn === 'volume' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-amber-400 transition-colors" onClick={() => handleSort('openInterest')}>
                        <div className="flex items-center justify-end gap-1">
                          OI
                          {sortColumn === 'openInterest' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOpportunities.map((opp, index) => {
                      const oppKey = getOpportunityKey(opp);
                      return (
                      <TableRow key={oppKey}>
                        <TableCell>
                          <Checkbox
                            checked={selectedOpportunities.has(oppKey)}
                            onCheckedChange={() => toggleOpportunitySelection(opp)}
                            className="border-2 border-amber-500/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                          />
                        </TableCell>
                        <TableCell className="font-semibold">{opp.symbol}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={getScoreBadgeClass(opp.score)}>
                            {opp.score}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">${opp.strike.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">${opp.currentPrice.toFixed(2)}</span>
                        </TableCell>
                        <TableCell>{opp.expiration}</TableCell>
                        <TableCell className="text-right">{opp.dte}</TableCell>
                        <TableCell className="text-right">{opp.delta.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${opp.bid.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${opp.ask.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${opp.mid.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-green-400 font-semibold">
                            ${opp.premium.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={getScoreColor(opp.weeklyReturn * 10)}>
                            {opp.weeklyReturn.toFixed(2)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{opp.distanceOtm.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">
                          {opp.rsi !== null ? opp.rsi.toFixed(1) : 'N/A'}
                        </TableCell>
                        <TableCell className="text-right">
                          {opp.ivRank !== null ? opp.ivRank.toFixed(1) : 'N/A'}
                        </TableCell>
                        <TableCell className="text-right">
                          {opp.bbPctB !== null ? opp.bbPctB.toFixed(2) : 'N/A'}
                        </TableCell>
                        <TableCell className="text-right">{opp.spreadPct.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">{opp.volume.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{opp.openInterest.toLocaleString()}</TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          </div>
        )}
      </div>
    </div>
  );
}
