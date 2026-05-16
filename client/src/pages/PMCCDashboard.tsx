import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { PMCCMobileCard } from "@/components/MobileOpportunityCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from "@/components/ui/slider";
import { Loader2, TrendingUp, ArrowUp, ArrowDown, DollarSign, Download, RefreshCw, Plus, Minus, Sparkles, BarChart2, X } from "lucide-react";
import { AIRowIcon } from "@/components/AIRowIcon";
import { BollingerChartPanel } from "@/components/BollingerChartPanel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { HelpBadge } from "@/components/HelpBadge";
import { HELP_CONTENT } from "@/lib/helpContent";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";
import { ShortCallScanner } from "@/components/pmcc/ShortCallScanner";
import { trpc } from "@/lib/trpc";
import { useTradingMode } from "@/contexts/TradingModeContext";
import { toast } from "sonner";
import { cn, exportToCSV } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { PositionCardsSkeleton } from "@/components/PositionTableSkeleton";
import { ColumnVisibilityToggle, useColumnVisibility, type ColumnDef } from "@/components/ColumnVisibilityToggle";

// PMCC column definitions
const PMCC_COLUMNS: ColumnDef[] = [
  { key: 'select',        label: 'Select',       group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'symbol',        label: 'Symbol',       group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'strike',        label: 'Strike',       group: 'Position', pinned: true,  defaultVisible: true  },
  { key: 'expiration',    label: 'Expiration',   group: 'Position',                defaultVisible: true  },
  { key: 'dte',           label: 'DTE',          group: 'Position', pinned: true,  defaultVisible: true  },
  { key: 'delta',         label: 'Delta',        group: 'Greeks',   pinned: true,  defaultVisible: true  },
  { key: 'expMove',        label: 'Exp Move',     group: 'Greeks',                  defaultVisible: false },
  { key: 'safetyRatio',   label: 'Safety Ratio', group: 'Greeks',                  defaultVisible: false },
  { key: 'premium',       label: 'Premium',      group: 'Returns',  pinned: true,  defaultVisible: true  },
  { key: 'bid',           label: 'Bid',          group: 'Returns',                 defaultVisible: false },
  { key: 'ask',           label: 'Ask',          group: 'Returns',                 defaultVisible: false },
  { key: 'spreadPct',     label: 'Spread %',     group: 'Liquidity',               defaultVisible: true  },
  { key: 'oi',            label: 'Open Interest',group: 'Liquidity',               defaultVisible: true  },
  { key: 'volume',        label: 'Volume',       group: 'Liquidity',               defaultVisible: true  },
  { key: 'earnings',      label: 'Earnings',     group: 'Technical',               defaultVisible: true  },
  { key: 'extrinsic',     label: 'Extrinsic %',  group: 'Technical',               defaultVisible: true  },
  { key: 'monthsRecover', label: 'Mos. Recover', group: 'Technical',               defaultVisible: true  },
  { key: 'score',         label: 'Score',        group: 'Core',     pinned: true,  defaultVisible: true  },
  { key: 'ai',            label: 'AI',           group: 'Core',                    defaultVisible: true  },
];

type SortColumn = 'symbol' | 'strike' | 'expiration' | 'dte' | 'delta' | 'premium' | 'bidAskSpread' | 'openInterest' | 'volume' | 'score';
type SortDirection = 'asc' | 'desc';

// Active Positions Section Component
interface ActivePositionsSectionProps {
  positionsData: any;
  isLoading: boolean;
  refetch: () => void;
  onSellCalls: (leapKey: string) => void;
  onCloseShort: (sc: any) => void;
  onCloseLEAP: (pos: any) => void;
  onRollShort: (sc: any) => void;
}

function ActivePositionsSection({ positionsData, isLoading, refetch, onSellCalls, onCloseShort, onCloseLEAP, onRollShort }: ActivePositionsSectionProps) {
  const positions = positionsData?.positions || [];
  const shortCalls: any[] = positionsData?.shortCalls || [];

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
          <PositionCardsSkeleton cards={3} />
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
                {/* LEAP metrics */}
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
                {/* Close LEAP (STC) button */}
                <Button
                  className="w-full mt-1 text-xs border-red-800/50 text-red-400 hover:bg-red-900/30 hover:text-red-300"
                  size="sm"
                  variant="outline"
                  onClick={() => onCloseLEAP(pos)}
                  title="Sell to Close this LEAP position"
                >
                  <X className="h-3 w-3 mr-1" />
                  Close LEAP (STC)
                </Button>
                {/* Active short calls against this LEAP */}
                {(() => {
                  const activeShorts = shortCalls.filter((sc: any) => sc.symbol === pos.symbol);
                  if (activeShorts.length > 0) {
                    return (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Active Short Calls</p>
                        {activeShorts.map((sc: any, si: number) => (
                          <div key={si} className="rounded-md bg-purple-950/40 border border-purple-800/50 px-3 py-2 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">${sc.strike.toFixed(2)} Call</span>
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                sc.profitLossPercent >= 50 ? 'bg-green-900/40 text-green-400' :
                                sc.profitLossPercent >= 25 ? 'bg-yellow-900/40 text-yellow-400' :
                                'bg-red-900/40 text-red-400'
                              }`}>
                                {sc.profitLoss >= 0 ? '+' : ''}{sc.profitLossPercent.toFixed(1)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                              <span>{new Date(sc.expiration).toLocaleDateString()} ({sc.dte} DTE)</span>
                              <span>Premium: ${sc.premiumCollected.toFixed(2)}</span>
                            </div>
                            {/* Always show Close Short button — user decides when to close */}
                            <div className="flex gap-1.5 mt-2">
                              <Button
                                className={`flex-1 text-xs ${
                                  sc.profitLossPercent >= 50
                                    ? 'border-green-700/50 text-green-400 hover:bg-green-900/30 hover:text-green-300'
                                    : 'border-orange-700/50 text-orange-400 hover:bg-orange-900/30 hover:text-orange-300'
                                }`}
                                size="sm"
                                variant="outline"
                                onClick={() => onCloseShort(sc)}
                                title={`Buy to Close — ${sc.profitLossPercent.toFixed(1)}% profit realized`}
                              >
                                <X className="h-3 w-3 mr-1" />
                                {sc.profitLossPercent >= 50 ? `Close (${sc.profitLossPercent.toFixed(0)}%)` : 'Close Short'}
                              </Button>
                              <Button
                                className="flex-1 text-xs border-blue-700/50 text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
                                size="sm"
                                variant="outline"
                                onClick={() => onRollShort(sc)}
                                title="Close this short call and open scanner to sell a new one"
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Roll
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          className="w-full mt-1 text-xs"
                          size="sm"
                          variant="outline"
                          disabled
                          title="Short call already active — close existing position before selling a new one"
                        >
                          Short Active — Close to Sell New Call
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <Button
                      className="w-full mt-4"
                      size="sm"
                      onClick={() => onSellCalls(`${pos.symbol}-${pos.optionSymbol}`)}
                    >
                      Sell Calls
                    </Button>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PMCCDashboard() {
  const isMobile = useIsMobile();
  const { mode: tradingMode } = useTradingMode();
  
  // Fetch LEAP positions (shared between ActivePositionsSection and ShortCallScanner)
  const { data: positionsData, isLoading: isLoadingPositions, refetch: refetchPositions } = trpc.pmcc.getLeapPositions.useQuery();
  
  const [isScanning, setIsScanning] = useState(false);
  const [isWatchlistCollapsed, setIsWatchlistCollapsed] = useState(false);
  const [watchlistMode, setWatchlistMode] = useState<'equity' | 'index'>('equity');
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [selectedLeaps, setSelectedLeaps] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true);
  const [isSubmittingOrders, setIsSubmittingOrders] = useState(false);
  const [analyzingRowKey, setAnalyzingRowKey] = useState<string | null>(null);
  const [selectedAiAnalysis, setSelectedAiAnalysis] = useState<any>(null);
  const [showAiAnalysisModal, setShowAiAnalysisModal] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<{ symbol: string; strike?: number; currentPrice?: number } | null>(null);

  // Column visibility for PMCC table
  const [visibleCols, setColVisibility, setAllCols, resetPmccCols] = useColumnVisibility(PMCC_COLUMNS, 'pmcc-columns');
  const showAll = () => setAllCols(new Set(PMCC_COLUMNS.map(c => c.key)));
  const hideAll = () => setAllCols(new Set(PMCC_COLUMNS.filter(c => c.pinned).map(c => c.key)));

  // Sell Calls wiring: ref to scroll to ShortCallScanner, preSelectLeapKey to pre-select the LEAP
  const scannerRef = useRef<HTMLDivElement>(null);
  const [preSelectLeapKey, setPreSelectLeapKey] = useState<string | null>(null);

  const handleSellCalls = useCallback((leapKey: string) => {
    setPreSelectLeapKey(leapKey);
    setTimeout(() => {
      scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  // Close Short (BTC) modal state
  const [closeShortTarget, setCloseShortTarget] = useState<any>(null); // the sc object
  const [closeShortPrice, setCloseShortPrice] = useState<number>(0);
  const [closeShortIsDryRun, setCloseShortIsDryRun] = useState(true);
  const [closeShortDryRunPassed, setCloseShortDryRunPassed] = useState(false);

  const closeShortCallMutation = trpc.pmcc.closeShortCall.useMutation({
    onSuccess: (data) => {
      if (closeShortIsDryRun) {
        setCloseShortDryRunPassed(true);
        toast.success('✅ Dry run passed — BTC order validated. Ready to submit live.');
      } else {
        toast.success(`🚀 BTC order submitted! Order #${data.orderId}`);
        setCloseShortTarget(null);
        setCloseShortDryRunPassed(false);
        refetchPositions();
      }
    },
    onError: (err) => {
      toast.error(`BTC order failed: ${err.message}`);
    },
  });

  const handleOpenCloseShort = useCallback((sc: any) => {
    // Default limit price = mid of current close price (best estimate)
    const mid = sc.currentPrice > 0 ? sc.currentPrice : (sc.premiumCollected / (sc.quantity * 100));
    setCloseShortPrice(parseFloat(mid.toFixed(2)));
    setCloseShortIsDryRun(true);
    setCloseShortDryRunPassed(false);
    setCloseShortTarget(sc);
  }, []);

  const handleSubmitCloseShort = (dryRun: boolean) => {
    if (!closeShortTarget) return;
    setCloseShortIsDryRun(dryRun);
    closeShortCallMutation.mutate({
      optionSymbol: closeShortTarget.optionSymbol,
      symbol: closeShortTarget.symbol,
      quantity: closeShortTarget.quantity,
      limitPrice: closeShortPrice,
      isDryRun: dryRun,
    });
  };

  // Close LEAP (STC) modal state
  const [closeLEAPTarget, setCloseLEAPTarget] = useState<any>(null);
  const [closeLEAPPrice, setCloseLEAPPrice] = useState<number>(0);
  const [closeLEAPIsDryRun, setCloseLEAPIsDryRun] = useState(true);
  const [closeLEAPDryRunPassed, setCloseLEAPDryRunPassed] = useState(false);

  const closeLEAPMutation = trpc.pmcc.closeLEAP.useMutation({
    onSuccess: (data) => {
      if (closeLEAPIsDryRun) {
        setCloseLEAPDryRunPassed(true);
        toast.success('✅ Dry run passed — STC order validated. Ready to submit live.');
      } else {
        toast.success(`🚀 STC order submitted! Order #${data.orderId}`);
        setCloseLEAPTarget(null);
        setCloseLEAPDryRunPassed(false);
        refetchPositions();
      }
    },
    onError: (err) => {
      toast.error(`STC order failed: ${err.message}`);
    },
  });

  const handleOpenCloseLEAP = useCallback((pos: any) => {
    const mid = pos.currentPrice > 0 ? pos.currentPrice : (pos.currentValue / (pos.quantity * 100));
    setCloseLEAPPrice(parseFloat(mid.toFixed(2)));
    setCloseLEAPIsDryRun(true);
    setCloseLEAPDryRunPassed(false);
    setCloseLEAPTarget(pos);
  }, []);

  const handleSubmitCloseLEAP = (dryRun: boolean) => {
    if (!closeLEAPTarget) return;
    setCloseLEAPIsDryRun(dryRun);
    closeLEAPMutation.mutate({
      optionSymbol: closeLEAPTarget.optionSymbol,
      symbol: closeLEAPTarget.symbol,
      quantity: closeLEAPTarget.quantity,
      limitPrice: closeLEAPPrice,
      isDryRun: dryRun,
    });
  };

  // Roll Short Call = close current short, then open scanner for new short
  const handleRollShort = useCallback((sc: any) => {
    // Open the BTC modal first; after successful live submit the scanner will be available
    handleOpenCloseShort(sc);
  }, [handleOpenCloseShort]);

  // Compute activeShortsByLeap map for ShortCallScanner eligibility check
  const activeShortsByLeap = useMemo(() => {
    const map: Record<string, boolean> = {};
    const shortCalls: any[] = positionsData?.shortCalls || [];
    const positions: any[] = positionsData?.positions || [];
    shortCalls.forEach((sc: any) => {
      positions.forEach((pos: any) => {
        if (pos.symbol === sc.symbol) {
          map[`${pos.symbol}-${pos.optionSymbol}`] = true;
        }
      });
    });
    return map;
  }, [positionsData]);

  // Compute monthly income tracker: sum premiumCollected for short calls opened this calendar month
  const monthlyIncome = useMemo(() => {
    const shortCalls: any[] = positionsData?.shortCalls || [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return shortCalls.reduce((sum: number, sc: any) => {
      // If openedAt is available, filter by month; otherwise count all (positions are active)
      if (sc.openedAt) {
        const opened = new Date(sc.openedAt);
        if (opened < monthStart) return sum;
      }
      return sum + (sc.premiumCollected || 0);
    }, 0);
  }, [positionsData]);

  // Range filter states (using range arrays like CSP/CC dashboards)
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [deltaRange, setDeltaRange] = useState<[number, number]>([0.70, 0.85]);
  const [dteRange, setDteRange] = useState<[number, number]>([270, 450]);

  // No longer using database presets - using direct range filters instead
  
  // Fetch watchlist to count symbols for progress calculation
  const { data: watchlist = [] } = trpc.watchlist.get.useQuery();
  
  // Fetch selected watchlist symbols for filtering
  const { data: selectedSymbolsData = [] } = trpc.watchlist.getSelections.useQuery();
  // Filter symbols based on current watchlist mode — equities OR indexes
  const selectedSymbols = useMemo(() => {
    if (watchlistMode === 'index') {
      // Index mode: only include symbols marked as index
      const indexSymbols = new Set(
        watchlist.filter((w: any) => w.isIndex === true || w.isIndex === 1).map((w: any) => w.symbol)
      );
      return selectedSymbolsData
        .filter((s: any) => s.isSelected === 1 && indexSymbols.has(s.symbol))
        .map((s: any) => s.symbol);
    } else {
      // Equity mode: exclude index tickers
      const equitySymbols = new Set(
        watchlist.filter((w: any) => !w.isIndex).map((w: any) => w.symbol)
      );
      return selectedSymbolsData
        .filter((s: any) => s.isSelected === 1 && equitySymbols.has(s.symbol))
        .map((s: any) => s.symbol);
    }
  }, [selectedSymbolsData, watchlist, watchlistMode]);
  
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

  // Explain score mutation
  const explainScore = trpc.pmcc.explainScore.useMutation({
    onSuccess: (data) => {
      setSelectedAiAnalysis(data);
      setShowAiAnalysisModal(true);
      setAnalyzingRowKey(null);
    },
    onError: (error) => {
      toast.error(`Failed to explain score: ${error.message}`);
      setAnalyzingRowKey(null);
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
      if (leap.score < scoreRange[0] || leap.score > scoreRange[1]) return false;
      
      // DTE filter
      if (leap.dte < dteRange[0] || leap.dte > dteRange[1]) return false;
      
      // Delta filter (use absolute value)
      const delta = Math.abs(leap.delta);
      if (delta < deltaRange[0] || delta > deltaRange[1]) return false;
      
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
  }, [scanLeapsMutation.data?.opportunities, selectedLeaps, showSelectedOnly, sortColumn, sortDirection, scoreRange, dteRange, deltaRange]);

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
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-4 sm:mb-8">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <TrendingUp className="h-6 w-6 sm:h-8 sm:w-8 text-purple-500 shrink-0" />
              <h1 className="text-2xl sm:text-3xl font-bold">PMCC Dashboard</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
          <div className="flex items-center gap-4 mt-2">
            <p className="text-muted-foreground">
              Poor Man's Covered Call - Buy LEAPs and sell short calls for income
            </p>
            {(positionsData?.shortCalls?.length ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-950/50 border border-green-700/40 text-sm">
                <DollarSign className="h-3.5 w-3.5 text-green-400" />
                <span className="text-muted-foreground text-xs">{new Date().toLocaleString('default', { month: 'long' })} Short Call Income:</span>
                <span className="font-semibold text-green-400">${monthlyIncome.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Active PMCC Positions */}
        <ActivePositionsSection 
          positionsData={positionsData}
          isLoading={isLoadingPositions}
          refetch={refetchPositions}
          onSellCalls={handleSellCalls}
          onCloseShort={handleOpenCloseShort}
          onCloseLEAP={handleOpenCloseLEAP}
          onRollShort={handleRollShort}
        />

        {/* Short Call Scanner */}
        <div ref={scannerRef}>
          <ShortCallScanner 
            leapPositions={positionsData?.positions || []}
            activeShortsByLeap={activeShortsByLeap}
            onRefreshPositions={refetchPositions}
            preSelectLeapKey={preSelectLeapKey}
            onPreSelectConsumed={() => setPreSelectLeapKey(null)}
          />
        </div>

        {/* Watchlist Management */}
        <div className="mb-8">
          <EnhancedWatchlist 
            isCollapsed={isWatchlistCollapsed}
            onToggleCollapse={() => setIsWatchlistCollapsed(!isWatchlistCollapsed)}
            contextMode={watchlistMode}
            onContextModeChange={setWatchlistMode}
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

              {/* Range Filters - shown after scan */}
              {scanLeapsMutation.data && scanLeapsMutation.data.opportunities.length > 0 && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="text-base">Filters</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Range Filters */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Label className="text-base font-semibold">Range Filters</Label>
                        <span className="text-xs text-muted-foreground">(Adjust sliders to filter opportunities)</span>
                      </div>
                      {/* Score Range - PRIMARY FILTER */}
                      <div className="space-y-2 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold text-purple-400">Score (Primary Filter)</Label>
                          <span className="text-xs text-muted-foreground">{scoreRange[0]} - {scoreRange[1]}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <input
                            type="number"
                            value={scoreRange[0]}
                            onChange={(e) => setScoreRange([parseInt(e.target.value) || 0, scoreRange[1]])}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background"
                            min="0"
                            max="100"
                          />
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={scoreRange[0]}
                              onChange={(e) => setScoreRange([parseInt(e.target.value), scoreRange[1]])}
                              className="flex-1 h-2 accent-purple-500"
                            />
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={scoreRange[1]}
                              onChange={(e) => setScoreRange([scoreRange[0], parseInt(e.target.value)])}
                              className="flex-1 h-2 accent-purple-500"
                            />
                          </div>
                          <input
                            type="number"
                            value={scoreRange[1]}
                            onChange={(e) => setScoreRange([scoreRange[0], parseInt(e.target.value) || 100])}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background"
                            min="0"
                            max="100"
                          />
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
                            onClick={() => setScoreRange([65, 100])}
                            className="text-xs"
                          >
                            Aggressive (≥65)
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
                          <input
                            type="number"
                            value={deltaRange[0]}
                            onChange={(e) => setDeltaRange([parseFloat(e.target.value) || 0, deltaRange[1]])}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background"
                            step="0.01"
                            min="0"
                            max="1"
                          />
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
                          <input
                            type="number"
                            value={deltaRange[1]}
                            onChange={(e) => setDeltaRange([deltaRange[0], parseFloat(e.target.value) || 1])}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background"
                            step="0.01"
                            min="0"
                            max="1"
                          />
                        </div>
                      </div>

                      {/* DTE Range */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Days to Expiration (DTE)</Label>
                          <span className="text-xs text-muted-foreground">{dteRange[0]} - {dteRange[1]} days</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <input
                            type="number"
                            value={dteRange[0]}
                            onChange={(e) => setDteRange([parseInt(e.target.value) || 0, dteRange[1]])}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background"
                            min="0"
                            max="730"
                          />
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="730"
                              step="1"
                              value={dteRange[0]}
                              onChange={(e) => setDteRange([parseInt(e.target.value), dteRange[1]])}
                              className="flex-1 h-2"
                            />
                            <input
                              type="range"
                              min="0"
                              max="730"
                              step="1"
                              value={dteRange[1]}
                              onChange={(e) => setDteRange([dteRange[0], parseInt(e.target.value)])}
                              className="flex-1 h-2"
                            />
                          </div>
                          <input
                            type="number"
                            value={dteRange[1]}
                            onChange={(e) => setDteRange([dteRange[0], parseInt(e.target.value) || 730])}
                            className="w-16 px-2 py-1 text-sm border rounded bg-background"
                            min="0"
                            max="730"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Selection Controls */}
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
                          size="default"
                          onClick={() => {
                            const newSelection = new Set(selectedLeaps);
                            sortedLeaps.forEach((leap: any) => {
                              const key = `${leap.symbol}-${leap.strike}-${leap.expiration}`;
                              newSelection.add(key);
                            });
                            setSelectedLeaps(newSelection);
                            toast.success(`Selected ${sortedLeaps.length} LEAPs`);
                          }}
                          disabled={sortedLeaps.length === 0}
                        >
                          ✓ Select All Filtered ({sortedLeaps.length})
                        </Button>
                        <Button
                          className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
                          size="default"
                          onClick={() => {
                            setSelectedLeaps(new Set());
                            toast.success('Selection cleared');
                          }}
                          disabled={selectedLeaps.size === 0}
                        >
                          ✕ Clear Selection ({selectedLeaps.size})
                        </Button>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-accent/20 rounded-lg">
                        <Checkbox
                          id="selected-only"
                          checked={showSelectedOnly}
                          onCheckedChange={(checked) => setShowSelectedOnly(checked as boolean)}
                        />
                        <Label htmlFor="selected-only" className="text-sm cursor-pointer">
                          Show Selected Only
                        </Label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
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
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                      <ColumnVisibilityToggle
                        columns={PMCC_COLUMNS}
                        visibleColumns={visibleCols}
                        onVisibilityChange={setColVisibility}
                        onReset={resetPmccCols}
                      />
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
                  {isMobile ? (
                    /* ── MOBILE: stacked cards ── */
                    <div className="space-y-2 px-1">
                      {sortedLeaps.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8 text-sm">No LEAP opportunities found</p>
                      ) : (
                        sortedLeaps.map((leap) => {
                          const key = getLeapKey(leap);
                          const isSelected = selectedLeaps.has(key);
                          return (
                            <PMCCMobileCard
                              key={key}
                              leap={leap}
                              isSelected={isSelected}
                              onToggle={() => toggleLeapSelection(leap)}
                            />
                          );
                        })
                      )}
                    </div>
                  ) : (
                    /* ── DESKTOP: scrollable table ── */
                    <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          {visibleCols.has('select') && <th className="p-2 text-left">Select</th>}
                          {visibleCols.has('symbol') && <th className="p-2 text-left cursor-pointer hover:bg-muted" onClick={() => handleSort('symbol')}><div className="flex items-center gap-1">Symbol{sortColumn === 'symbol' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('strike') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('strike')}><div className="flex items-center justify-end gap-1">Strike{sortColumn === 'strike' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('expiration') && <th className="p-2 text-left cursor-pointer hover:bg-muted" onClick={() => handleSort('expiration')}><div className="flex items-center gap-1">Expiration{sortColumn === 'expiration' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('dte') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('dte')}><div className="flex items-center justify-end gap-1">DTE<HelpBadge content={HELP_CONTENT.DTE} />{sortColumn === 'dte' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('delta') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('delta')}><div className="flex items-center justify-end gap-1">Delta<HelpBadge content={HELP_CONTENT.DELTA_CC} />{sortColumn === 'delta' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('expMove') && <th className="p-2 text-right">Exp Move</th>}
                          {visibleCols.has('safetyRatio') && <th className="p-2 text-right">Safety ×</th>}
                          {visibleCols.has('premium') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('premium')}><div className="flex items-center justify-end gap-1">Premium{sortColumn === 'premium' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('bid') && <th className="p-2 text-right">Bid</th>}
                          {visibleCols.has('ask') && <th className="p-2 text-right">Ask</th>}
                          {visibleCols.has('spreadPct') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('bidAskSpread')}><div className="flex items-center justify-end gap-1">Spread %{sortColumn === 'bidAskSpread' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('oi') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('openInterest')}><div className="flex items-center justify-end gap-1">OI{sortColumn === 'openInterest' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('volume') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('volume')}><div className="flex items-center justify-end gap-1">Volume{sortColumn === 'volume' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('earnings') && <th className="p-2 text-center">Earnings</th>}
                          {visibleCols.has('extrinsic') && <th className="p-2 text-right">Extrinsic%</th>}
                          {visibleCols.has('monthsRecover') && <th className="p-2 text-right">Mos. Recover</th>}
                          {visibleCols.has('score') && <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('score')}><div className="flex items-center justify-end gap-1">Score{sortColumn === 'score' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</div></th>}
                          {visibleCols.has('ai') && <th className="p-2 text-center">AI</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLeaps.map((leap) => {
                          const key = getLeapKey(leap);
                          const isSelected = selectedLeaps.has(key);
                          return (
                            <tr key={key} className={isSelected ? "bg-amber-900/20" : "hover:bg-muted/50"}>
                              {visibleCols.has('select') && <td className="p-2"><Checkbox checked={isSelected} onCheckedChange={() => toggleLeapSelection(leap)} className="border-2 border-muted-foreground data-[state=checked]:border-green-500 data-[state=checked]:bg-green-500" /></td>}
                              {visibleCols.has('symbol') && <td className="p-2 font-medium"><div className="flex items-center gap-1.5"><span>{leap.symbol}</span><button title={`View ${leap.symbol} chart`} onClick={() => setChartSymbol({ symbol: leap.symbol, strike: leap.strike, currentPrice: leap.currentPrice })} className="p-0.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-700/50 transition-colors"><BarChart2 className="h-3.5 w-3.5" /></button></div></td>}
                              {visibleCols.has('strike') && <td className="p-2 text-right">${leap.strike.toFixed(2)}</td>}
                              {visibleCols.has('expiration') && <td className="p-2">{leap.expiration}</td>}
                              {visibleCols.has('dte') && <td className="p-2 text-right">{leap.dte}</td>}
                              {visibleCols.has('delta') && <td className="p-2 text-right">{leap.delta.toFixed(2)}</td>}
                              {visibleCols.has('expMove') && <td className="p-2 text-right"><span className="text-xs font-mono text-cyan-300">{(leap as any).expectedMove != null ? `$${(leap as any).expectedMove.toFixed(2)}` : '—'}</span></td>}
                              {visibleCols.has('safetyRatio') && <td className="p-2 text-right"><span className={`text-xs font-mono font-bold ${ (leap as any).safetyRatio == null ? 'text-gray-500' : (leap as any).safetyRatio >= 1.5 ? 'text-green-400' : (leap as any).safetyRatio >= 1.0 ? 'text-yellow-400' : 'text-red-400' }`}>{(leap as any).safetyRatio != null ? `${((leap as any).safetyRatio as number).toFixed(2)}×` : '—'}</span></td>}
                              {visibleCols.has('premium') && <td className="p-2 text-right">${leap.premium.toFixed(2)}</td>}
                              {visibleCols.has('bid') && <td className="p-2 text-right">${leap.bid.toFixed(2)}</td>}
                              {visibleCols.has('ask') && <td className="p-2 text-right">${leap.ask.toFixed(2)}</td>}
                              {visibleCols.has('spreadPct') && <td className="p-2 text-right">{leap.bidAskSpread.toFixed(2)}%</td>}
                              {visibleCols.has('oi') && <td className="p-2 text-right">{leap.openInterest.toLocaleString()}</td>}
                              {visibleCols.has('volume') && <td className="p-2 text-right">{leap.volume.toLocaleString()}</td>}
                              {/* Earnings warning */}
                              {visibleCols.has('earnings') && <td className="p-2 text-center">
                                {leap.earningsWarning ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded" title={`Earnings in ${leap.daysToEarnings} days (${leap.earningsDate})`}>⚠ {leap.daysToEarnings}d</span>
                                ) : leap.daysToEarnings !== null && leap.daysToEarnings !== undefined && leap.daysToEarnings <= 45 ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded" title={`Earnings in ${leap.daysToEarnings} days (${leap.earningsDate})`}>{leap.daysToEarnings}d</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{leap.daysToEarnings !== null && leap.daysToEarnings !== undefined ? `${leap.daysToEarnings}d` : '—'}</span>
                                )}
                              </td>}
                              {/* Extrinsic % */}
                              {visibleCols.has('extrinsic') && <td className="p-2 text-right">
                                {leap.extrinsicPercent !== undefined ? (
                                  <span className={`text-xs font-medium ${ leap.extrinsicWarning ? 'text-red-400' : leap.extrinsicPercent > 15 ? 'text-amber-400' : 'text-green-400' }`}>{leap.extrinsicPercent.toFixed(1)}%</span>
                                ) : '—'}
                              </td>}
                              {/* Months to Recover */}
                              {visibleCols.has('monthsRecover') && <td className="p-2 text-right">
                                {leap.monthsToRecover !== null && leap.monthsToRecover !== undefined ? (
                                  <span className={`text-xs font-medium ${ leap.monthsToRecover <= 12 ? 'text-green-400' : leap.monthsToRecover <= 18 ? 'text-amber-400' : 'text-red-400' }`}>{leap.monthsToRecover.toFixed(1)}</span>
                                ) : '—'}
                              </td>}
                              {visibleCols.has('score') && <td className="p-2 text-right">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold cursor-help ${
                                        leap.score >= 80 ? 'bg-green-900/50 text-green-400' :
                                        leap.score >= 60 ? 'bg-amber-900/50 text-amber-400' :
                                        'bg-red-900/50 text-red-400'
                                      }`}>
                                        {Math.round(leap.score)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="bg-gray-900 border-purple-500/50 p-3 max-w-xs">
                                      <div className="space-y-1.5 text-sm">
                                        <div className="font-semibold text-purple-400 border-b border-purple-500/30 pb-1 mb-2">
                                          Score Breakdown ({Math.round(leap.score)}/100)
                                        </div>
                                        {(leap as any).scoreBreakdown ? (
                                          <>
                                            {[
                                              { label: 'Stock Quality (RSI+BB+Trend)', key: 'stockQuality', max: 35 },
                                              { label: 'LEAP Structure (Δ+DTE+Strike)', key: 'leapStructure', max: 30 },
                                              { label: 'Cost & Liquidity (OI+Vol+Sprd)', key: 'costLiquidity', max: 25 },
                                              { label: 'Risk Management (IV+Theta)', key: 'riskManagement', max: 10 },
                                            ].map(({ label, key, max }) => {
                                              const val = (leap as any).scoreBreakdown[key] ?? 0;
                                              const pct = val / max;
                                              return (
                                                <div key={key} className="flex justify-between">
                                                  <span className="text-gray-400">{label}:</span>
                                                  <span className={`font-medium ${ pct >= 0.8 ? 'text-green-400' : pct >= 0.5 ? 'text-yellow-400' : 'text-red-400' }`}>{val}/{max}</span>
                                                </div>
                                              );
                                            })}
                                            {(leap as any).scoreBreakdown.earningsPenalty < 0 && (
                                              <div className="flex justify-between text-red-400">
                                                <span>Earnings Penalty:</span>
                                                <span>{(leap as any).scoreBreakdown.earningsPenalty}</span>
                                              </div>
                                            )}
                                            {(leap as any).scoreBreakdown.safetyRatio != null && (
                                              <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                                                <span className="text-gray-400">Safety Ratio (LEAP/EM):</span>
                                                <span className={`font-medium ${
                                                  (leap as any).scoreBreakdown.safetyRatio >= 1.5 ? 'text-green-400' :
                                                  (leap as any).scoreBreakdown.safetyRatio >= 1.0 ? 'text-yellow-400' : 'text-red-400'
                                                }`}>{((leap as any).scoreBreakdown.safetyRatio as number).toFixed(2)}×</span>
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
                              </td>}
                              {visibleCols.has('ai') && <td className="p-2 text-center">
                                <AIRowIcon
                                  isLoading={analyzingRowKey === `${leap.symbol}-${leap.strike}-${leap.expiration}`}
                                  onClick={() => {
                                    const rowKey = `${leap.symbol}-${leap.strike}-${leap.expiration}`;
                                    setAnalyzingRowKey(rowKey);
                                    explainScore.mutate({ leap });
                                  }}
                                  title="AI explanation of this score"
                                  size="xs"
                                />
                              </td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  )}
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
              {/* Order Mode Info Banner */}
              <div className="flex items-start gap-3 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
                <span className="text-amber-400 text-lg mt-0.5">&#9888;&#65039;</span>
                <div>
                  <p className="text-sm font-semibold text-amber-300">Review before submitting</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Use <strong className="text-amber-300">Dry Run</strong> to validate orders without executing them.
                    Use <strong className="text-green-400">Submit Live Order</strong> to send real orders to Tastytrade.
                  </p>
                </div>
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
                      <th className="p-2 text-center">AI</th>
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
                          <td className="p-2 text-center">
                            <AIRowIcon
                              isLoading={analyzingRowKey === `${leap.symbol}-${leap.strike}-${leap.expiration}`}
                              onClick={() => {
                                const rowKey = `${leap.symbol}-${leap.strike}-${leap.expiration}`;
                                setAnalyzingRowKey(rowKey);
                                explainScore.mutate({ leap });
                              }}
                              title="AI explanation of this score"
                              size="xs"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Order Summary */}
              {orderSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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

                  {/* Dry Run — validates without executing */}
                  <Button
                    variant="outline"
                    onClick={() => {
                      const selectedLeapsArray = sortedLeaps.filter(leap => selectedLeaps.has(getLeapKey(leap)));
                      setIsDryRun(true);
                      setIsSubmittingOrders(true);
                      submitLeapOrdersMutation.mutate({
                        leaps: selectedLeapsArray.map(leap => ({
                          symbol: leap.symbol,
                          strike: leap.strike,
                          expiration: leap.expiration,
                          premium: leap.premium,
                        })),
                        isDryRun: true,
                      });
                    }}
                    disabled={isSubmittingOrders}
                    className="border-amber-600 text-amber-400 hover:bg-amber-900/30"
                  >
                    {isSubmittingOrders && isDryRun ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Validating...</>
                    ) : (
                      <>&#129514; Dry Run</>
                    )}
                  </Button>

                  {/* Submit Live Order — sends real order to Tastytrade */}
                  <Button
                    onClick={() => {
                      const selectedLeapsArray = sortedLeaps.filter(leap => selectedLeaps.has(getLeapKey(leap)));
                      setIsDryRun(false);
                      setIsSubmittingOrders(true);
                      submitLeapOrdersMutation.mutate({
                        leaps: selectedLeapsArray.map(leap => ({
                          symbol: leap.symbol,
                          strike: leap.strike,
                          expiration: leap.expiration,
                          premium: leap.premium,
                        })),
                        isDryRun: false,
                      });
                    }}
                    disabled={isSubmittingOrders || tradingMode === 'paper'}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    title={tradingMode === 'paper' ? 'Order submission is disabled in Paper Trading mode' : undefined}
                  >
                    {isSubmittingOrders && !isDryRun ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</>
                    ) : (
                      <>&#128640; Submit Live Order</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* AI Analysis Detail Modal */}
        <Dialog open={showAiAnalysisModal} onOpenChange={setShowAiAnalysisModal}>
          <DialogContent className="max-w-fit w-auto max-h-[80vh] overflow-y-auto border-2 border-purple-500/50" style={{ maxWidth: 'calc(100vw - 4rem)' }}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                Score Explanation: {selectedAiAnalysis?.symbol} ${selectedAiAnalysis?.strike}
              </DialogTitle>
              <DialogDescription>
                AI-powered explanation of why this LEAP scored {selectedAiAnalysis?.score}/100
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Score Breakdown */}
              {selectedAiAnalysis?.breakdown && (
                <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700/50">
                  <CardHeader>
                    <CardTitle className="text-base">Score Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                        <div className="text-xs text-muted-foreground">Stock Quality</div>
                        <div className="text-xl font-bold text-blue-400">
                          {selectedAiAnalysis.breakdown.stockQuality}/35
                        </div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                        <div className="text-xs text-muted-foreground">LEAP Structure</div>
                        <div className="text-xl font-bold text-purple-400">
                          {selectedAiAnalysis.breakdown.leapStructure}/30
                        </div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                        <div className="text-xs text-muted-foreground">Cost & Liquidity</div>
                        <div className="text-xl font-bold text-amber-400">
                          {selectedAiAnalysis.breakdown.costLiquidity}/25
                        </div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                        <div className="text-xs text-muted-foreground">Risk Management</div>
                        <div className="text-xl font-bold text-green-400">
                          {selectedAiAnalysis.breakdown.riskManagement}/10
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-gradient-to-r from-slate-800/50 to-slate-700/50 rounded-lg border border-slate-600/50">
                      <div className="text-xs text-muted-foreground">Total Score</div>
                      <div className={`text-2xl font-bold ${
                        selectedAiAnalysis.score >= 80 ? 'text-green-400' :
                        selectedAiAnalysis.score >= 60 ? 'text-amber-400' :
                        'text-red-400'
                      }`}>
                        {selectedAiAnalysis.score}/100
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* AI Explanation */}
              {selectedAiAnalysis?.aiExplanation && (
                <Card className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border-purple-700/50">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                      AI Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Streamdown>{selectedAiAnalysis.aiExplanation}</Streamdown>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Technical Details */}
              {selectedAiAnalysis?.technicalExplanation && (
                <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700/50">
                  <CardHeader>
                    <CardTitle className="text-base">Technical Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-invert prose-sm max-w-none text-xs">
                      <Streamdown>{selectedAiAnalysis.technicalExplanation}</Streamdown>
                    </div>
                  </CardContent>
                </Card>
              )}
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

      {/* Close Short (BTC) Modal */}
      <Dialog open={!!closeShortTarget} onOpenChange={(open) => { if (!open) { setCloseShortTarget(null); setCloseShortDryRunPassed(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="h-5 w-5 text-red-400" />
              Close Short Call (Buy to Close)
            </DialogTitle>
            <DialogDescription>
              Submit a Day limit BTC order to close this short call position.
            </DialogDescription>
          </DialogHeader>

          {closeShortTarget && (
            <div className="space-y-4">
              {/* Position summary */}
              <div className="rounded-lg bg-muted/30 border border-border px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-semibold">{closeShortTarget.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Strike</span>
                  <span className="font-semibold">${closeShortTarget.strike.toFixed(2)} Call</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expiration</span>
                  <span className="font-semibold">{new Date(closeShortTarget.expiration).toLocaleDateString()} ({closeShortTarget.dte} DTE)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty</span>
                  <span className="font-semibold">{closeShortTarget.quantity} contract{closeShortTarget.quantity !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premium Collected</span>
                  <span className="font-semibold text-green-400">${closeShortTarget.premiumCollected.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P/L</span>
                  <span className={`font-semibold ${closeShortTarget.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {closeShortTarget.profitLoss >= 0 ? '+' : ''}${closeShortTarget.profitLoss.toFixed(2)} ({closeShortTarget.profitLossPercent.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {/* Limit price slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">BTC Limit Price (per share)</Label>
                  <span className="text-sm font-mono font-semibold text-red-400">${closeShortPrice.toFixed(2)}</span>
                </div>
                <Slider
                  min={0.01}
                  max={Math.max(closeShortTarget.premiumCollected / (closeShortTarget.quantity * 100) * 1.5, 0.50)}
                  step={0.01}
                  value={[closeShortPrice]}
                  onValueChange={([v]) => setCloseShortPrice(v)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$0.01</span>
                  <span>Total debit: ${(closeShortPrice * closeShortTarget.quantity * 100).toFixed(2)}</span>
                  <span>${(closeShortTarget.premiumCollected / (closeShortTarget.quantity * 100) * 1.5).toFixed(2)}</span>
                </div>
              </div>

              {/* Dry run passed banner */}
              {closeShortDryRunPassed && (
                <div className="rounded-md bg-green-950/40 border border-green-700/50 px-3 py-2 text-sm text-green-400 flex items-center gap-2">
                  <span>✅</span>
                  <span>Dry run validated — order is ready to submit live.</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              onClick={() => { setCloseShortTarget(null); setCloseShortDryRunPassed(false); }}
              disabled={closeShortCallMutation.isPending}
            >
              Cancel
            </Button>
            {!closeShortDryRunPassed ? (
              <Button
                variant="outline"
                className="border-amber-600/50 text-amber-400 hover:bg-amber-900/20"
                onClick={() => handleSubmitCloseShort(true)}
                disabled={closeShortCallMutation.isPending}
              >
                {closeShortCallMutation.isPending && closeShortIsDryRun ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Execute Dry Run
              </Button>
            ) : (
              <Button
                className="bg-red-700 hover:bg-red-800 text-white ring-2 ring-red-500 ring-offset-2 ring-offset-background"
                onClick={() => handleSubmitCloseShort(false)}
                disabled={closeShortCallMutation.isPending}
              >
                {closeShortCallMutation.isPending && !closeShortIsDryRun ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
                Submit Live BTC Order
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Close LEAP (STC) Modal ─────────────────────────────────────────── */}
      <Dialog open={!!closeLEAPTarget} onOpenChange={(open) => { if (!open) { setCloseLEAPTarget(null); setCloseLEAPDryRunPassed(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="h-5 w-5 text-red-400" />
              Close LEAP (Sell to Close)
            </DialogTitle>
            <DialogDescription>
              Submit a Day limit STC order to close this long LEAP position.
            </DialogDescription>
          </DialogHeader>

          {closeLEAPTarget && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/30 border border-border px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-semibold">{closeLEAPTarget.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Strike</span>
                  <span className="font-semibold">${closeLEAPTarget.strike?.toFixed(2)} Call (LEAP)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expiration</span>
                  <span className="font-semibold">{new Date(closeLEAPTarget.expiration).toLocaleDateString()} ({closeLEAPTarget.dte} DTE)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty</span>
                  <span className="font-semibold">{closeLEAPTarget.quantity} contract{closeLEAPTarget.quantity !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost Basis</span>
                  <span className="font-semibold">${closeLEAPTarget.costBasis?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Value</span>
                  <span className="font-semibold">${closeLEAPTarget.currentValue?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P/L</span>
                  <span className={`font-semibold ${closeLEAPTarget.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {closeLEAPTarget.profitLoss >= 0 ? '+' : ''}${closeLEAPTarget.profitLoss?.toFixed(2)} ({closeLEAPTarget.profitLossPercent?.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {/* Limit price slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">STC Limit Price (per share)</Label>
                  <span className="text-sm font-mono font-semibold text-green-400">${closeLEAPPrice.toFixed(2)}</span>
                </div>
                <Slider
                  min={0.01}
                  max={Math.max(closeLEAPTarget.currentValue / (closeLEAPTarget.quantity * 100) * 1.5, 1.00)}
                  step={0.05}
                  value={[closeLEAPPrice]}
                  onValueChange={([v]) => setCloseLEAPPrice(v)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$0.01</span>
                  <span>Total credit: ${(closeLEAPPrice * closeLEAPTarget.quantity * 100).toFixed(2)}</span>
                  <span>${(closeLEAPTarget.currentValue / (closeLEAPTarget.quantity * 100) * 1.5).toFixed(2)}</span>
                </div>
              </div>

              <div className="rounded-md bg-amber-950/40 border border-amber-700/50 px-3 py-2 text-xs text-amber-400">
                ⚠️ Closing the LEAP ends the PMCC strategy for {closeLEAPTarget.symbol}. Ensure any active short calls are closed first.
              </div>

              {closeLEAPDryRunPassed && (
                <div className="rounded-md bg-green-950/40 border border-green-700/50 px-3 py-2 text-sm text-green-400 flex items-center gap-2">
                  <span>✅</span>
                  <span>Dry run validated — order is ready to submit live.</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              onClick={() => { setCloseLEAPTarget(null); setCloseLEAPDryRunPassed(false); }}
              disabled={closeLEAPMutation.isPending}
            >
              Cancel
            </Button>
            {!closeLEAPDryRunPassed ? (
              <Button
                variant="outline"
                className="border-amber-600/50 text-amber-400 hover:bg-amber-900/20"
                onClick={() => handleSubmitCloseLEAP(true)}
                disabled={closeLEAPMutation.isPending}
              >
                {closeLEAPMutation.isPending && closeLEAPIsDryRun ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Execute Dry Run
              </Button>
            ) : (
              <Button
                className="bg-red-700 hover:bg-red-800 text-white ring-2 ring-red-500 ring-offset-2 ring-offset-background"
                onClick={() => handleSubmitCloseLEAP(false)}
                disabled={closeLEAPMutation.isPending}
              >
                {closeLEAPMutation.isPending && !closeLEAPIsDryRun ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
                Submit Live STC Order
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}