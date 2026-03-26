import { useAuth } from "@/_core/hooks/useAuth";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { Label } from "@/components/ui/label";
import { getIndexExchange, getMinSpreadWidth, validateMultiIndexSelection } from "@shared/orderUtils";
import { AIAdvisorPanel } from "@/components/AIAdvisorPanel";
import { BollingerChartPanel } from "@/components/BollingerChartPanel";
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
  Download,
  BarChart2,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { cn, exportToCSV } from "@/lib/utils";
import { UnifiedOrderPreviewModal } from "@/components/UnifiedOrderPreviewModal";
import { OrderStatusModal, OrderSubmissionStatus } from "@/components/OrderStatusModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Color-coding helper functions
function getROCColor(roc: number): string {
  if (roc > 1.5) return "bg-green-500/20 text-green-500 border-green-500/50";
  if (roc >= 1.0) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
  return "bg-red-500/20 text-red-500 border-red-500/50";
}

// Live countdown component for progress dialog
function LiveCountdown({ startTime, totalSymbols }: { startTime: number; totalSymbols: number }) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [estimatedTotal, setEstimatedTotal] = useState(0);
  
  useEffect(() => {
    // Iron Condors require fetching both put and call spreads
    // Estimate: 6 seconds per symbol (more complex than single spreads)
    const secondsPerSymbol = 6;
    const estimatedTotalSeconds = totalSymbols * secondsPerSymbol;
    setEstimatedTotal(estimatedTotalSeconds);
    
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, estimatedTotalSeconds - elapsed);
      setRemainingSeconds(remaining);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [startTime, totalSymbols]);
  
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const progressPercent = estimatedTotal > 0 ? Math.min(100, (elapsedSeconds / estimatedTotal) * 100) : 0;
  
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
      <div className="w-full space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Analyzing {totalSymbols} stocks for iron condor opportunities...</span>
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
        Scanning options chains...
      </p>
    </div>
  );
}

function getRSIColor(rsi: number | null): string {
  if (rsi === null) return "bg-gray-500/20 text-gray-500 border-gray-500/50";
  if (rsi >= 40 && rsi <= 60) return "bg-green-500/20 text-green-500 border-green-500/50";
  if ((rsi >= 30 && rsi < 40) || (rsi > 60 && rsi <= 70)) return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
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
  // Watchlist context mode: read from Strategy Advisor passthrough if present
  const [watchlistContextMode, setWatchlistContextMode] = useState<'equity' | 'index'>(() => {
    const advisorScanType = localStorage.getItem('strategyAdvisorScanType');
    if (advisorScanType === 'index') return 'index';
    return 'equity';
  });
  
  // Filter parameters
  const [minDte, setMinDte] = useState(7);
  const [maxDte, setMaxDte] = useState(45);
  const [spreadWidth, setSpreadWidth] = useState(5);
  // Per-symbol spread width overrides for index mode
  const [symbolWidths, setSymbolWidths] = useState<Record<string, number>>({});
  
  // Range filter state (for UI sliders)
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [deltaRange, setDeltaRange] = useState<[number, number]>([0, 1]);
  const [dteRange, setDteRange] = useState<[number, number]>([0, 90]);
  const [minDelta, setMinDelta] = useState(0.15);
  const [maxDelta, setMaxDelta] = useState(0.35);
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  
  // Watchlist management
  const { data: watchlist = [], refetch: refetchWatchlist } = trpc.watchlist.get.useQuery(undefined, {
    enabled: !!user,
  });

  // Fetch ticker selections
  const { data: selections = [] } = trpc.watchlist.getSelections.useQuery(undefined, {
    enabled: !!user,
  });

  // Filter watchlist by portfolio size AND selected symbols
  const isIndexMode = watchlistContextMode === 'index';
  const filteredWatchlist = useMemo(() => {
    // CRITICAL: Only include symbols that match the current mode (equity vs index)
    let filtered = watchlist.filter((w: any) => !!w.isIndex === isIndexMode);

    filtered = filtered.filter((w: any) =>
      selectedPortfolioSizes.includes(w.portfolioSize || 'medium')
    );
    
    // Filter by selected tickers (if any are selected)
    const selectedSymbols = selections
      .filter((s: any) => s.isSelected === 1)
      .map((s: any) => s.symbol);
    
    if (selectedSymbols.length > 0) {
      filtered = filtered.filter((w: any) => selectedSymbols.includes(w.symbol));
    }
    
    return filtered;
  }, [watchlist, selectedPortfolioSizes, selections, isIndexMode]);

  // Detect if SPXW is in the watchlist (drives the conditional SPXW Score column)
  const spxwInWatchlist = useMemo(() =>
    watchlist.some((w: any) => w.symbol === 'SPXW' || w.symbol === 'SPX'),
  [watchlist]);

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

  // Progress tracking for scan dialog
  const [fetchProgress, setFetchProgress] = useState<{
    isOpen: boolean;
    current: number;
    total: number;
    completed: number;
    startTime: number | null;
    endTime: number | null;
  }>({ isOpen: false, current: 0, total: 0, completed: 0, startTime: null, endTime: null });

  // Selection state
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [showAIAdvisor, setShowAIAdvisor] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<{ symbol: string; strike?: number; currentPrice?: number } | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  // Exchange-group filter: null = show all, 'CBOE' = show only CBOE, 'Nasdaq' = show only Nasdaq
  const [activeExchangeFilter, setActiveExchangeFilter] = useState<string | null>(null);

  // Order preview modal
  const [orderPreviewOpen, setOrderPreviewOpen] = useState(false);
  const [modalSubmissionComplete, setModalSubmissionComplete] = useState(false);
  const [modalFinalOrderStatus, setModalFinalOrderStatus] = useState<string | null>(null);
  
  // Order Status Modal state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [submissionStatuses, setSubmissionStatuses] = useState<OrderSubmissionStatus[]>([]);

  // Order submission mutation
  const submitOrders = trpc.csp.submitOrders.useMutation();

  // Execute order submission for Iron Condors
  // Get tRPC utils for imperative queries
  const utils = trpc.useUtils();

  // Callback to poll order statuses after submission
  const handlePollOrderStatuses = async (
    orderIds: string[],
    accountId: string
  ): Promise<Array<{
    orderId: string;
    symbol: string;
    status: 'Filled' | 'Working' | 'Cancelled' | 'Rejected' | 'MarketClosed' | 'Pending';
    message?: string;
  }>> => {
    try {
      console.log('[IronCondorDashboard] Polling order statuses for:', orderIds, 'accountId:', accountId);
      
      // Call the tRPC endpoint to check order statuses using utils.fetch
      const statusMap = await utils.orders.checkStatusBatch.fetch({
        accountId,
        orderIds,
      });
      
      console.log('[IronCondorDashboard] Received status map:', statusMap);
      
      // Map the status results to the format expected by UnifiedOrderPreviewModal
      return orderIds.map((orderId, index) => {
        const status = statusMap[orderId];
        const order = ordersForPreview[index];
        
        // 'Unknown' means API couldn't confirm yet — keep as Working so client keeps polling
        const rawStatus = status?.status;
        const mappedStatus =
          rawStatus === 'Filled' ? 'Filled' as const
          : rawStatus === 'Rejected' ? 'Rejected' as const
          : rawStatus === 'Cancelled' ? 'Cancelled' as const
          : rawStatus === 'MarketClosed' ? 'MarketClosed' as const
          : 'Working' as const;
        
        return {
          orderId,
          symbol: order?.symbol || 'Unknown',
          status: mappedStatus,
          message: status?.status === 'Filled' 
            ? `Order filled successfully`
            : status?.status === 'Rejected'
            ? `Order rejected: ${status.rejectedReason || 'Unknown reason'}`
            : status?.status === 'MarketClosed'
            ? status.marketClosedMessage || 'Market is closed'
            : status?.status === 'Working'
            ? 'Order is working'
            : 'Checking order status...',
        };
      });
    } catch (error: any) {
      console.error('[IronCondorDashboard] Error polling order statuses:', error);
      return orderIds.map((orderId, index) => ({
        orderId,
        symbol: ordersForPreview[index]?.symbol || 'Unknown',
        status: 'Working' as const,
        message: 'Retrying status check...',
      }));
    }
  };

  const executeOrderSubmission = async (
    orders: any[],
    quantities: Map<string, number>,
    isDryRun: boolean
  ): Promise<{ results: any[] }> => {
    if (orders.length === 0) {
      toast.error("No orders to submit");
      return { results: [] };
    }

    if (!selectedAccountId) {
      toast.error("Please select an account");
      return { results: [] };
    }

    // Round premium to nearest $0.05 (Tastytrade requirement)
    const roundToNickel = (price: number) => Math.round(price * 20) / 20;
    
    // Helper function to build option symbol
    const buildOptionSymbol = (symbol: string, expiration: string, strike: number, optionType: 'P' | 'C') => {
      const expFormatted = expiration.replace(/-/g, ''); // YYYYMMDD
      const expShort = expFormatted.substring(2); // YYMMDD
      const strikeFormatted = (strike * 1000).toString().padStart(8, '0');
      const ticker = symbol.padEnd(6, ' ');
      return `${ticker}${expShort}${optionType}${strikeFormatted}`;
    };
    
    // Build Iron Condor orders (4 legs each)
    const orderLegs = orders.map((order) => {
      const orderKey = `${order.symbol}-${order.strike}-${order.expiration}`;
      const quantity = quantities.get(orderKey) || 1;
      
      // Iron Condor: 4 legs
      // Leg 1: Sell Put (short put at higher strike)
      // Leg 2: Buy Put (long put at lower strike)
      // Leg 3: Sell Call (short call at lower strike)
      // Leg 4: Buy Call (long call at higher strike)
      return {
        symbol: order.symbol,
        strike: order.strike,
        expiration: order.expiration,
        premium: roundToNickel(order.premium),
        isIronCondor: true,
        quantity,
        // Put spread legs
        putShortLeg: {
          optionSymbol: buildOptionSymbol(order.symbol, order.expiration, order.strike, 'P'),
          action: 'Sell to Open' as const,
        },
        putLongLeg: {
          optionSymbol: buildOptionSymbol(order.symbol, order.expiration, order.longStrike!, 'P'),
          action: 'Buy to Open' as const,
        },
        // Call spread legs
        callShortLeg: {
          optionSymbol: buildOptionSymbol(order.symbol, order.expiration, order.callShortStrike!, 'C'),
          action: 'Sell to Open' as const,
        },
        callLongLeg: {
          optionSymbol: buildOptionSymbol(order.symbol, order.expiration, order.callLongStrike!, 'C'),
          action: 'Buy to Open' as const,
        },
      };
    });

    try {
      const response = await submitOrders.mutateAsync({
        orders: orderLegs,
        accountId: selectedAccountId,
        dryRun: isDryRun,
      });
      
      // For LIVE submissions: close preview modal and open status modal
      if (!isDryRun && response.results) {
        // Map results to OrderSubmissionStatus format
        const statuses: OrderSubmissionStatus[] = response.results.map((result: any, index: number) => {
          const order = orders[index];
          return {
            orderId: result.orderId || result.id || '',
            symbol: order.symbol,
            status: result.status === 'Received' ? 'Working' : 
                   result.status === 'Filled' ? 'Filled' :
                   result.status === 'Rejected' ? 'Rejected' :
                   result.message?.includes('market') || result.message?.includes('closed') ? 'MarketClosed' :
                   'Pending',
            message: result.message || `Iron Condor ${order.expiration} - ${result.status || 'Submitted'}`,
          };
        });
        
        // Close preview modal
        setOrderPreviewOpen(false);
        
        // Open status modal with results
        setSubmissionStatuses(statuses);
        setShowStatusModal(true);
      }
      
      return { results: response.results || [] };
    } catch (error: any) {
      console.error('[executeOrderSubmission] Error:', error);
      toast.error(error.message || "Order submission failed");
      return { results: [] };
    }
  };

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
      displayedOpportunities.map((opp: any) => `${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`)
    ));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedOpportunities(new Set());
  };

  // Filter and sort opportunities
  const displayedOpportunities = useMemo(() => {
    let filtered = [...opportunities];
    
    // Apply score filter
    filtered = filtered.filter((opp: any) => {
      const score = opp.score || 0;
      return score >= scoreRange[0] && score <= scoreRange[1];
    });
    
    // Apply delta filter (use Net Delta for Iron Condors)
    filtered = filtered.filter((opp: any) => {
      const netDelta = Math.abs(opp.netDelta || 0);
      return netDelta >= deltaRange[0] && netDelta <= deltaRange[1];
    });
    
    // Apply DTE filter
    filtered = filtered.filter((opp: any) => {
      return opp.dte >= dteRange[0] && opp.dte <= dteRange[1];
    });
    
    // Apply exchange-group filter (from clickable index cards)
    if (activeExchangeFilter) {
      filtered = filtered.filter((opp: any) => {
        const exch = getIndexExchange((opp as any).symbol);
        return exch === activeExchangeFilter;
      });
    }

    // Apply "Show Selected Only" filter
    if (showSelectedOnly) {
      filtered = filtered.filter((opp: any) => 
        selectedOpportunities.has(`${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`)
      );
    }

    // Apply sorting
    if (sortConfig) {
      filtered.sort((a: any, b: any) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        
        // Handle null/undefined values
        if (aValue === null || aValue === undefined) aValue = -Infinity;
        if (bValue === null || bValue === undefined) bValue = -Infinity;
        
        // Handle nested properties (e.g., putShortStrike, callShortStrike)
        if (sortConfig.key === 'putShortStrike' || sortConfig.key === 'callShortStrike') {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        }

        // Handle spxwScore: for index rows use opp.score; for equity rows use scoreBreakdown.indexEquivalent
        if (sortConfig.key === 'spxwScore') {
          aValue = (a.symbol === 'SPXW' || a.symbol === 'SPX') ? (a.score || 0) : (a.scoreBreakdown?.indexEquivalent ?? -Infinity);
          bValue = (b.symbol === 'SPXW' || b.symbol === 'SPX') ? (b.score || 0) : (b.scoreBreakdown?.indexEquivalent ?? -Infinity);
        }
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return filtered;
  }, [opportunities, showSelectedOnly, selectedOpportunities, scoreRange, deltaRange, dteRange, sortConfig, activeExchangeFilter]);

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const selected = opportunities.filter((opp: any) =>
      selectedOpportunities.has(`${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`)
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

    // Open progress dialog
    const symbolCount = filteredWatchlist.length;
    setFetchProgress({
      isOpen: true,
      current: 0,
      total: symbolCount,
      completed: 0,
      startTime: Date.now(),
      endTime: null,
    });

    // Don't auto-collapse watchlist - let user keep it open
    await refetchOpportunities();
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
          toast.success(`Loaded ${tickers.length} ticker${tickers.length > 1 ? 's' : ''} from Strategy Advisor: ${tickers.join(', ')}. Click "Scan for Opportunities" when ready.`, {
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
  
  // Track when loading completes to set endTime
  useEffect(() => {
    if (!loadingOpportunities && fetchProgress.startTime && !fetchProgress.endTime) {
      setFetchProgress(prev => ({ ...prev, endTime: Date.now() }));
    }
  }, [loadingOpportunities, fetchProgress.startTime, fetchProgress.endTime]);

  // Handle order preview
  const handleOrderPreview = () => {
    if (selectedOpportunities.size === 0) {
      toast.error("No opportunities selected");
      return;
    }
    // Reset submission state so the modal always opens in dry-run mode for a new batch
    setModalSubmissionComplete(false);
    setModalFinalOrderStatus(null);
    setOrderPreviewOpen(true);
  };

  // Build orders for preview modal
  // Each Iron Condor creates ONE atomic 4-leg order
  const ordersForPreview = useMemo(() => {
    const selected = opportunities.filter((opp: any) =>
      selectedOpportunities.has(`${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`)
    );

    return selected.map((opp: any) => {
      // Create single 4-leg Iron Condor order
      return {
        symbol: opp.symbol,
        action: "sell_to_open" as const,
        strike: opp.putShortStrike,           // PUT short strike
        expiration: opp.expiration,
        premium: opp.totalNetCredit,         // Total net credit per share (modal multiplies by 100)
        bid: opp.putShortBid,
        ask: opp.putShortAsk,
        optionType: "PUT" as const,
        
        // PUT spread (legs 1 & 2)
        longStrike: opp.putLongStrike,        // PUT long strike
        longPremium: opp.putLongAsk,          // PUT long cost per share
        longBid: opp.putLongBid,
        longAsk: opp.putLongAsk,
        
        // CALL spread (legs 3 & 4)
        callShortStrike: opp.callShortStrike, // CALL short strike
        callShortPremium: opp.callNetCredit,  // CALL short credit per share
        callShortBid: opp.callShortBid,
        callShortAsk: opp.callShortAsk,
        callLongStrike: opp.callLongStrike,   // CALL long strike
        callLongPremium: opp.callLongAsk,     // CALL long cost per share
        callLongBid: opp.callLongBid,
        callLongAsk: opp.callLongAsk,
        // Underlying stock price shown in Order Preview dialog
        currentPrice: opp.currentPrice,
      };
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
            <EnhancedWatchlist
              contextMode={watchlistContextMode}
              onContextModeChange={(mode) => setWatchlistContextMode(mode)}
            />
            
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
                <div className="col-span-2">
                  {/* Compact spread width selector */}
                  {(() => {
                    const selectedIndexSymbols = filteredWatchlist
                      .map((w: any) => w.symbol as string)
                      .filter((s: string) => getIndexExchange(s) !== 'Equity');
                    const multiIndexWarnings = isIndexMode && selectedIndexSymbols.length > 1
                      ? validateMultiIndexSelection(selectedIndexSymbols)
                      : [];
                    const hasNasdaqAndCboe = multiIndexWarnings.some((w: any) => w.severity === 'warning');
                    return (
                      <div className="space-y-2">
                        {hasNasdaqAndCboe && (
                          <p className="text-xs text-amber-400 flex items-center gap-1.5">
                            <span>⚠️</span>
                            <span>Mixed exchanges — use the Exchange filter below to submit one group at a time.</span>
                          </p>
                        )}
                        {isIndexMode && selectedIndexSymbols.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="text-xs text-muted-foreground font-medium">Spread width per index:</span>
                            {selectedIndexSymbols.map((sym: string) => {
                              const minW = getMinSpreadWidth(sym);
                              const widths = [minW, minW * 2, minW * 4].filter((w: number) => w <= 200);
                              const currentW = symbolWidths[sym] ?? minW;
                              return (
                                <div key={sym} className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium">{sym}:</span>
                                  {widths.map((w: number) => (
                                    <button
                                      key={w}
                                      onClick={() => setSymbolWidths((prev: Record<string, number>) => ({ ...prev, [sym]: w }))}
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
                            {[2, 5, 10].map(w => (
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
                </div>
              </div>

              <Button
                onClick={handleFetchOpportunities}
                disabled={loadingOpportunities || filteredWatchlist.length === 0}
                className="w-full"
                data-fetch-button="true"
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
                <label className="text-sm font-medium">Net Delta (|Δ|)</label>
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

            {/* Exchange Filter Chip — index mode only */}
            {isIndexMode && (
              <div className="flex items-center gap-3 pt-2">
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
                            const key = `${opp.symbol}-${opp.shortPutStrike}-${opp.longPutStrike}-${opp.shortCallStrike}-${opp.longCallStrike}-${opp.expiration}`;
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
                    Showing {displayedOpportunities.length} {activeExchangeFilter} opportunities
                  </span>
                )}
              </div>
            )}

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

            {/* AI Advisor Button - prominent, full width */}
            <div className="pt-2">
              <Button
                className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-semibold shadow-lg hover:shadow-purple-900/40 transition-all duration-200"
                size="default"
                onClick={() => setShowAIAdvisor(!showAIAdvisor)}
                disabled={opportunities.length === 0}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {showAIAdvisor ? 'Hide AI Advisor' : `AI Advisor — Analyze ${opportunities.length} Opportunities`}
              </Button>
              {opportunities.length === 0 && (
                <p className="text-xs text-slate-500 text-center mt-1">Run a scan first to enable AI Advisor</p>
              )}
            </div>

            {/* AI Advisor Panel - inline below button */}
            {showAIAdvisor && (
              <AIAdvisorPanel
                opportunities={opportunities.map((opp: any) => ({
                  score: opp.score ?? 0,
                  symbol: opp.symbol,
                  strategy: 'IC',
                  shortStrike: opp.putShortStrike,
                  longStrike: opp.putLongStrike,
                  expiration: opp.expiration,
                  dte: opp.dte,
                  netCredit: opp.totalNetCredit ?? 0,
                  capitalRisk: opp.totalCollateral ?? 0,
                  roc: opp.roc ?? 0,
                  delta: opp.putShortDelta,
                  openInterest: opp.openInterest,
                  volume: opp.volume,
                  ivRank: opp.ivRank,
                  bid: opp.putShortBid,
                  ask: opp.putShortAsk,
                  currentPrice: opp.currentPrice,
                  // IC-specific fields for order building
                  callShortStrike: opp.callShortStrike,
                  callLongStrike: opp.callLongStrike,
                  putLongStrike: opp.putLongStrike,
                  putShortBid: opp.putShortBid,
                  putShortAsk: opp.putShortAsk,
                  putLongBid: opp.putLongBid,
                  putLongAsk: opp.putLongAsk,
                  callShortBid: opp.callShortBid,
                  callShortAsk: opp.callShortAsk,
                  callLongBid: opp.callLongBid,
                  callLongAsk: opp.callLongAsk,
                  totalNetCredit: opp.totalNetCredit,
                  callNetCredit: opp.callNetCredit,
                }))}
                availableBuyingPower={availableBuyingPower}
                strategy="IC"
                onSubmitSelected={(picks) => {
                  if (!selectedAccountId) {
                    toast.error("Please select an account in the sidebar");
                    return;
                  }
                  // Build IC orders from AI picks and open preview modal
                  // Key format must match: symbol-expiration-putShortStrike-callShortStrike
                  const icKeys = new Set(
                    picks.map((pick) => {
                      const opp = pick.opportunity as any;
                      return `${opp.symbol}-${opp.expiration}-${opp.shortStrike ?? opp.putShortStrike}-${opp.callShortStrike ?? ''}`;
                    })
                  );
                  // Add to selectedOpportunities so ordersForPreview picks them up
                  setSelectedOpportunities(icKeys);
                  setOrderPreviewOpen(true);
                }}
                onClose={() => setShowAIAdvisor(false)}
              />
            )}
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Iron Condor Opportunities</CardTitle>
                  <CardDescription>
                    4-leg neutral income strategy - profit if stock stays between short strikes
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const timestamp = new Date().toISOString().split('T')[0];
                    const rows = displayedOpportunities.map((opp: any) => ({
                      Score: opp.score ?? '',
                      Symbol: opp.symbol,
                      Strategy: 'Iron Condor',
                      'Current Price': opp.currentPrice,
                      Expiration: opp.expiration,
                      DTE: opp.dte,
                      'Put Short Strike': opp.putShortStrike,
                      'Put Long Strike': opp.putLongStrike,
                      'Call Short Strike': opp.callShortStrike,
                      'Call Long Strike': opp.callLongStrike,
                      'Put Credit ($)': opp.putNetCredit != null ? (opp.putNetCredit * 100).toFixed(2) : '',
                      'Call Credit ($)': opp.callNetCredit != null ? (opp.callNetCredit * 100).toFixed(2) : '',
                      'Total Net Credit ($)': opp.totalNetCredit != null ? (opp.totalNetCredit * 100).toFixed(2) : '',
                      'Total Collateral ($)': opp.totalCollateral ?? '',
                      'ROC %': opp.roc != null ? opp.roc.toFixed(2) : '',
                      'Lower Breakeven': opp.lowerBreakeven ?? '',
                      'Upper Breakeven': opp.upperBreakeven ?? '',
                      'Profit Zone Width': opp.profitZone ?? '',
                      'Put Short Delta': opp.putShortDelta != null ? opp.putShortDelta.toFixed(4) : '',
                      'Call Short Delta': opp.callShortDelta != null ? opp.callShortDelta.toFixed(4) : '',
                      'Net Delta': opp.netDelta != null ? opp.netDelta.toFixed(4) : '',
                      OI: opp.openInterest ?? '',
                      Volume: opp.volume ?? '',
                      RSI: opp.rsi ?? '',
                      'BB %B': opp.bbPctB ?? '',
                      'IV Rank': opp.ivRank ?? '',
                      Risk: opp.riskBadges?.map((b: any) => b.label ?? b).join('; ') ?? '',
                    }));
                    exportToCSV(rows, `IronCondor_Opportunities_${timestamp}`);
                    toast.success(`Exported ${displayedOpportunities.length} opportunities to CSV`);
                  }}
                  disabled={displayedOpportunities.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV ({displayedOpportunities.length})
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* 1. Select */}
                      <TableHead className="w-12">
                        <Checkbox
                          checked={displayedOpportunities.length > 0 && displayedOpportunities.every((opp: any) => selectedOpportunities.has(`${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`))}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedOpportunities);
                            displayedOpportunities.forEach((opp: any) => {
                              const key = `${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`;
                              if (checked) next.add(key); else next.delete(key);
                            });
                            setSelectedOpportunities(next);
                          }}
                          aria-label="Select all visible opportunities"
                        />
                      </TableHead>
                      
                      {/* 2. Score */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'score' && prev.direction === 'desc' 
                          ? { key: 'score', direction: 'asc' } 
                          : { key: 'score', direction: 'desc' });
                      }}>
                        Score {sortConfig?.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 2b. SPXW Score column — only visible when SPXW is in watchlist */}
                      {spxwInWatchlist && (
                        <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                          setSortConfig(prev => prev?.key === 'spxwScore' && prev.direction === 'desc'
                            ? { key: 'spxwScore', direction: 'asc' }
                            : { key: 'spxwScore', direction: 'desc' });
                        }}>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-1 text-amber-400 cursor-help">
                                  SPXW Score {sortConfig?.key === 'spxwScore' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                Index-calibrated score using profit zone width, delta neutrality, and index IV rank thresholds (15–45 range). Replaces RSI/BB components used for equity scoring.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableHead>
                      )}

                      {/* 3. Symbol */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'symbol' && prev.direction === 'asc' 
                          ? { key: 'symbol', direction: 'desc' } 
                          : { key: 'symbol', direction: 'asc' });
                      }}>
                        Symbol {sortConfig?.key === 'symbol' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 4. Current */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'currentPrice' && prev.direction === 'desc' 
                          ? { key: 'currentPrice', direction: 'asc' } 
                          : { key: 'currentPrice', direction: 'desc' });
                      }}>
                        Current {sortConfig?.key === 'currentPrice' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 5. Put Strikes */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'putShortStrike' && prev.direction === 'desc' 
                          ? { key: 'putShortStrike', direction: 'asc' } 
                          : { key: 'putShortStrike', direction: 'desc' });
                      }}>
                        Put Strikes {sortConfig?.key === 'putShortStrike' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 6. Call Strikes */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'callShortStrike' && prev.direction === 'desc' 
                          ? { key: 'callShortStrike', direction: 'asc' } 
                          : { key: 'callShortStrike', direction: 'desc' });
                      }}>
                        Call Strikes {sortConfig?.key === 'callShortStrike' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 7. DTE */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'dte' && prev.direction === 'asc' 
                          ? { key: 'dte', direction: 'desc' } 
                          : { key: 'dte', direction: 'asc' });
                      }}>
                        DTE {sortConfig?.key === 'dte' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 8. Net Credit */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'totalNetCredit' && prev.direction === 'desc' 
                          ? { key: 'totalNetCredit', direction: 'asc' } 
                          : { key: 'totalNetCredit', direction: 'desc' });
                      }}>
                        Net Credit {sortConfig?.key === 'totalNetCredit' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 9. Collateral */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'totalCollateral' && prev.direction === 'desc' 
                          ? { key: 'totalCollateral', direction: 'asc' } 
                          : { key: 'totalCollateral', direction: 'desc' });
                      }}>
                        Collateral {sortConfig?.key === 'totalCollateral' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 10. ROC % */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'roc' && prev.direction === 'desc' 
                          ? { key: 'roc', direction: 'asc' } 
                          : { key: 'roc', direction: 'desc' });
                      }}>
                        ROC % {sortConfig?.key === 'roc' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 11a. Put Δ */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'putShortDelta' && prev.direction === 'asc' 
                          ? { key: 'putShortDelta', direction: 'desc' } 
                          : { key: 'putShortDelta', direction: 'asc' });
                      }}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              Put Δ {sortConfig?.key === 'putShortDelta' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                              <HelpCircle className="h-3 w-3" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Short put delta (negative)</p>
                              <p>≈ probability put side expires ITM</p>
                              <p>Ideal: -0.15 to -0.25</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>

                      {/* 11b. Call Δ */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'callShortDelta' && prev.direction === 'asc' 
                          ? { key: 'callShortDelta', direction: 'desc' } 
                          : { key: 'callShortDelta', direction: 'asc' });
                      }}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              Call Δ {sortConfig?.key === 'callShortDelta' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                              <HelpCircle className="h-3 w-3" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Short call delta (positive)</p>
                              <p>≈ probability call side expires ITM</p>
                              <p>Ideal: +0.15 to +0.25</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>

                      {/* 11c. Net Δ */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'netDelta' && prev.direction === 'asc' 
                          ? { key: 'netDelta', direction: 'desc' } 
                          : { key: 'netDelta', direction: 'asc' });
                      }}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              Net Δ {sortConfig?.key === 'netDelta' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                              <HelpCircle className="h-3 w-3" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Sum of all 4 leg deltas</p>
                              <p>Ideal: near 0.00 (balanced)</p>
                              <p>High value = directional skew</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      
                      {/* 12. IV Rank (technical) */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'ivRank' && prev.direction === 'desc' 
                          ? { key: 'ivRank', direction: 'asc' } 
                          : { key: 'ivRank', direction: 'desc' });
                      }}>
                        IV Rank {sortConfig?.key === 'ivRank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 13. RSI (technical) */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'rsi' && prev.direction === 'desc' 
                          ? { key: 'rsi', direction: 'asc' } 
                          : { key: 'rsi', direction: 'desc' });
                      }}>
                        RSI {sortConfig?.key === 'rsi' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 14. BB %B (technical) */}
                      <TableHead className="cursor-pointer hover:bg-accent" onClick={() => {
                        setSortConfig(prev => prev?.key === 'bbPctB' && prev.direction === 'desc' 
                          ? { key: 'bbPctB', direction: 'asc' } 
                          : { key: 'bbPctB', direction: 'desc' });
                      }}>
                        BB %B {sortConfig?.key === 'bbPctB' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      
                      {/* 15. Profit Zone */}
                      <TableHead>Profit Zone</TableHead>
                      
                      {/* 16. Breakevens */}
                      <TableHead>Breakevens</TableHead>
                    </TableRow>

                  </TableHeader>
                  <TableBody>
                    {displayedOpportunities.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={spxwInWatchlist ? 19 : 18} className="text-center text-muted-foreground">
                          No opportunities found
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedOpportunities.map((opp: any) => {
                        const key = `${opp.symbol}-${opp.expiration}-${opp.putShortStrike}-${opp.callShortStrike}`;
                        const isSelected = selectedOpportunities.has(key);

                        return (
                          <TableRow key={key} className={isSelected ? "bg-primary/5" : ""}>
                            {/* 1. Checkbox */}
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleOpportunity(key)}
                              />
                            </TableCell>
                            
                            {/* 2. Score + breakdown tooltip */}
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge className={`cursor-help ${
                                    (opp.score || 0) >= 70 ? 'bg-green-500/20 text-green-500 border-green-500/50' :
                                    (opp.score || 0) >= 55 ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                                    'bg-red-500/20 text-red-500 border-red-500/50'
                                  }`}>
                                    {(opp.score || 0).toFixed(1)}
                                    {(opp as any).scoreBreakdown?.isIndex && (
                                      <span className="ml-1 text-[9px] text-amber-400">IDX</span>
                                    )}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="p-3 max-w-xs">
                                  {(opp as any).scoreBreakdown ? (
                                    <div className="space-y-1 text-xs">
                                      <p className="font-semibold text-sm mb-2">
                                        {(opp as any).scoreBreakdown.isIndex ? '📊 Index (SPXW) Score' : '📈 Equity Score'} — {(opp.score || 0).toFixed(1)}/100
                                      </p>
                                      {(opp as any).scoreBreakdown.isIndex ? (
                                        <>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">ROC</span><span className="font-mono">{(opp as any).scoreBreakdown.roc}/20</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Credit/Width</span><span className="font-mono">{(opp as any).scoreBreakdown.creditWidth}/15</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Profit Zone</span><span className="font-mono">{(opp as any).scoreBreakdown.profitZone}/15</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">IV Rank (idx)</span><span className="font-mono">{(opp as any).scoreBreakdown.ivRank}/15</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">DTE</span><span className="font-mono">{(opp as any).scoreBreakdown.dte}/20</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Delta Balance</span><span className="font-mono">{(opp as any).scoreBreakdown.deltaBalance}/20</span></div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">ROC</span><span className="font-mono">{(opp as any).scoreBreakdown.roc}/20</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Risk/Reward</span><span className="font-mono">{(opp as any).scoreBreakdown.riskReward}/15</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">POP</span><span className="font-mono">{(opp as any).scoreBreakdown.pop}/20</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">IV Rank</span><span className="font-mono">{(opp as any).scoreBreakdown.ivRank}/10</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">DTE</span><span className="font-mono">{(opp as any).scoreBreakdown.dte}/15</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">RSI</span><span className="font-mono">{(opp as any).scoreBreakdown.rsi}/10</span></div>
                                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">BB %B</span><span className="font-mono">{(opp as any).scoreBreakdown.bb}/10</span></div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Delta Balance</span><span className="font-mono">{(opp as any).scoreBreakdown.deltaBalance}/10</span></div>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">Score breakdown not available</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            
                            {/* 2b. SPXW Score cell — conditional */}
                            {spxwInWatchlist && (() => {
                              const isIndex = opp.symbol === 'SPXW' || opp.symbol === 'SPX';
                              const spxwScore = isIndex
                                ? (opp.score || 0)  // already index-scored
                                : (opp as any).scoreBreakdown?.indexEquivalent ?? null;  // equity row: show index-equivalent if available
                              return (
                                <TableCell>
                                  {isIndex ? (
                                    <Badge className={`${
                                      (opp.score || 0) >= 70 ? 'bg-amber-500/20 text-amber-400 border-amber-500/50' :
                                      (opp.score || 0) >= 55 ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                                      'bg-red-500/20 text-red-500 border-red-500/50'
                                    }`}>
                                      {(opp.score || 0).toFixed(1)}
                                    </Badge>
                                  ) : spxwScore != null ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="text-xs text-muted-foreground cursor-help">
                                            {spxwScore.toFixed(1)}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="text-xs">
                                          This equity IC would score {spxwScore.toFixed(1)} on the index scale. Compare to SPXW to see which offers better risk-adjusted value.
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              );
                            })()}

                            {/* 3. Symbol */}
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-1.5">
                                <span>{opp.symbol}</span>
                                <button
                                  title={`View ${opp.symbol} chart`}
                                  onClick={() => setChartSymbol({ symbol: opp.symbol, strike: opp.putShortStrike, currentPrice: opp.currentPrice })}
                                  className="p-0.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-700/50 transition-colors"
                                >
                                  <BarChart2 className="h-3.5 w-3.5" />
                                </button>
                                {(opp.symbol === 'SPXW' || opp.symbol === 'SPX') && (
                                  <Badge className="text-[10px] px-1 py-0 bg-amber-500/20 text-amber-400 border-amber-500/40">
                                    PM
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            
                            {/* 4. Current */}
                            <TableCell>${(opp.currentPrice || 0).toFixed(2)}</TableCell>
                            
                            {/* 5. Put Strikes */}
                            <TableCell>
                              <div className="text-sm">
                                <div>Short: ${opp.putShortStrike}</div>
                                <div className="text-muted-foreground">Long: ${opp.putLongStrike}</div>
                              </div>
                            </TableCell>
                            
                            {/* 6. Call Strikes */}
                            <TableCell>
                              <div className="text-sm">
                                <div>Short: ${opp.callShortStrike}</div>
                                <div className="text-muted-foreground">Long: ${opp.callLongStrike}</div>
                              </div>
                            </TableCell>
                            
                            {/* 7. DTE */}
                            <TableCell>{opp.dte}</TableCell>
                            
                            {/* 8. Net Credit */}
                            <TableCell className="text-green-500 font-medium">
                              ${((opp.totalNetCredit || 0) * 100).toFixed(2)}
                            </TableCell>
                            
                            {/* 9. Collateral */}
                            <TableCell>
                              <div className="flex flex-col">
                                <span>${(opp.totalCollateral || 0).toFixed(2)}</span>
                                {(opp.symbol === 'SPXW' || opp.symbol === 'SPX') && (
                                  <span className="text-[10px] text-amber-400/80">100× notional</span>
                                )}
                              </div>
                            </TableCell>
                            
                            {/* 10. ROC % */}
                            <TableCell>
                              <Badge className={getROCColor(opp.roc)}>
                                {(opp.roc || 0).toFixed(2)}%
                              </Badge>
                            </TableCell>
                            
                            {/* 11a. Put Δ */}
                            <TableCell>
                              {opp.putShortDelta != null ? (
                                <Badge className={`${
                                  Math.abs(opp.putShortDelta) >= 0.15 && Math.abs(opp.putShortDelta) <= 0.25
                                    ? 'bg-green-500/20 text-green-500 border-green-500/50'
                                    : Math.abs(opp.putShortDelta) <= 0.30
                                    ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50'
                                    : 'bg-red-500/20 text-red-500 border-red-500/50'
                                }`}>
                                  {opp.putShortDelta.toFixed(3)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">N/A</span>
                              )}
                            </TableCell>

                            {/* 11b. Call Δ */}
                            <TableCell>
                              {opp.callShortDelta != null ? (
                                <Badge className={`${
                                  opp.callShortDelta >= 0.15 && opp.callShortDelta <= 0.25
                                    ? 'bg-green-500/20 text-green-500 border-green-500/50'
                                    : opp.callShortDelta <= 0.30
                                    ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50'
                                    : 'bg-red-500/20 text-red-500 border-red-500/50'
                                }`}>
                                  {opp.callShortDelta.toFixed(3)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">N/A</span>
                              )}
                            </TableCell>

                            {/* 11c. Net Δ — balance indicator */}
                            <TableCell>
                              {(() => {
                                const putAbs = Math.abs(opp.putShortDelta || 0);
                                const callAbs = Math.abs(opp.callShortDelta || 0);
                                const lo = Math.min(putAbs, callAbs);
                                const hi = Math.max(putAbs, callAbs);
                                const balanceRatio = hi > 0 ? lo / hi : 1;
                                const isBalanced = balanceRatio >= 0.75;
                                const isModerate = balanceRatio >= 0.50;
                                return (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge className={`cursor-help ${
                                          isBalanced ? 'bg-green-500/20 text-green-500 border-green-500/50' :
                                          isModerate ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                                          'bg-red-500/20 text-red-500 border-red-500/50'
                                        }`}>
                                          {(opp.netDelta || 0).toFixed(3)}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="text-xs">
                                        <p>Balance ratio: {(balanceRatio * 100).toFixed(0)}%</p>
                                        <p>{isBalanced ? '✅ Well balanced' : isModerate ? '⚠️ Moderate skew' : '❌ Skewed — one wing much closer'}</p>
                                        <p className="text-muted-foreground mt-1">Put Δ: {(opp.putShortDelta || 0).toFixed(3)} | Call Δ: {(opp.callShortDelta || 0).toFixed(3)}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              })()}
                            </TableCell>
                            
                            {/* 12. IV Rank (technical) */}
                            <TableCell>
                              <Badge className={getIVRankColor(opp.ivRank)}>
                                {opp.ivRank?.toFixed(0) ?? "N/A"}
                              </Badge>
                            </TableCell>
                            
                            {/* 13. RSI (technical) */}
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
                            
                            {/* 14. BB %B (technical) */}
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
                            
                            {/* 15. Profit Zone */}
                            <TableCell>
                              ${opp.putShortStrike} - ${opp.callShortStrike}
                            </TableCell>
                            
                            {/* 16. Breakevens */}
                            <TableCell>
                              <div className="text-sm">
                                <div>${(opp.lowerBreakeven || 0).toFixed(2)}</div>
                                <div>${(opp.upperBreakeven || 0).toFixed(2)}</div>
                              </div>
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
        strategy="iron_condor"
        accountId={selectedAccountId || ""}
        availableBuyingPower={availableBuyingPower}
        onSubmit={executeOrderSubmission}
        onPollStatuses={handlePollOrderStatuses}
        tradingMode={tradingMode}
        submissionComplete={modalSubmissionComplete}
        finalOrderStatus={modalFinalOrderStatus}
        onSubmissionStateChange={(complete, status) => {
          setModalSubmissionComplete(complete);
          setModalFinalOrderStatus(status);
        }}
      />

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
            <DialogTitle>Scanning Options Chains</DialogTitle>
            <DialogDescription>
              Analyzing stocks for iron condor opportunities...
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
                  Found {opportunities.length} Iron Condor opportunities
                </p>
                {fetchProgress.startTime && fetchProgress.endTime && (
                  <p className="text-xs text-muted-foreground">
                    Completed in {((fetchProgress.endTime - fetchProgress.startTime) / 1000).toFixed(1)}s
                  </p>
                )}
                <Button 
                  onClick={() => {
                    setFetchProgress({ ...fetchProgress, isOpen: false });
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
      
      {/* Order Status Modal */}
      <OrderStatusModal
        open={showStatusModal}
        onOpenChange={setShowStatusModal}
        orderStatuses={submissionStatuses}
        accountId={selectedAccountId || ''}
      />
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
