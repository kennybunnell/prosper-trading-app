import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, Loader2, Download } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { exportToCSV } from '@/lib/utils';
import { useAccount } from '@/contexts/AccountContext';
import { useTradingMode } from '@/contexts/TradingModeContext';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Cell, LabelList } from 'recharts';
import { RecoveryProgressChart } from '@/components/StockBasisRecoveryChart';
import { StockPositionsTable } from '@/components/StockPositionsTable';
import { UnderwaterPositionMetrics } from '@/components/UnderwaterPositionMetrics';
import { UnifiedOrderPreviewModal, UnifiedOrder } from '@/components/UnifiedOrderPreviewModal';
import { LockedInIncomeCards } from '@/components/projections/LockedInIncomeCards';
import { ThetaDecayCards } from '@/components/projections/ThetaDecayCards';
import { InteractiveROICalculator } from '@/components/projections/InteractiveROICalculator';
import { DollarSign, Package, TrendingUp as TrendingUpIcon, TrendingDown as TrendingDownIcon } from 'lucide-react';
import { ConnectionStatusIndicator } from '@/components/ConnectionStatusIndicator';
import { SpreadAnalyticsTab } from '@/components/SpreadAnalyticsTab';
import { TaxTab } from '@/components/TaxTab';

export default function Performance() {
  const [activeTab, setActiveTab] = useState('overview');


  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Performance Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Track performance analytics, spread analysis, stock basis, income projections, and tax insights
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="spread-analytics">Spread Analytics</TabsTrigger>
          <TabsTrigger value="stock-basis">Stock Basis</TabsTrigger>
          <TabsTrigger value="projections">Projections</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <PerformanceOverviewTab />
        </TabsContent>

        {/* Spread Analytics Tab */}
        <TabsContent value="spread-analytics" className="space-y-6">
          <SpreadAnalyticsTab />
        </TabsContent>

        {/* Stock Basis Tab */}
        <TabsContent value="stock-basis" className="space-y-6">
          <StockBasisTab />
        </TabsContent>

        {/* Projections Tab */}
        <TabsContent value="projections" className="space-y-6">
          <ProjectionsTab />
        </TabsContent>

        {/* Tax Loss Harvesting Tab */}
        <TabsContent value="tax" className="space-y-6">
          <TaxTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ActivePositionsTab() {
  const { mode: tradingMode } = useTradingMode();
  const { selectedAccountId } = useAccount();
  const [positionType, setPositionType] = useState<'csp' | 'cc'>('csp');
  const [profitFilter, setProfitFilter] = useState<number | null>(null);
  const [spreadFilter, setSpreadFilter] = useState<'all' | 'spreads' | 'single-leg'>('all');
  const [selectedPositions, setSelectedPositions] = useState<Set<number>>(new Set());
  const [dryRun, setDryRun] = useState(true);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  const [closeResults, setCloseResults] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [finalOrderStatus, setFinalOrderStatus] = useState<string | null>(null);
  const [safeguardWarning, setSafeguardWarning] = useState<{ symbol: string; message: string } | null>(null);
  const [pendingCloseOrders, setPendingCloseOrders] = useState<UnifiedOrder[] | null>(null);

  // Play success sound
  const playSuccessSound = () => {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnMpBSuBzvLZiTYIGWi77eefTRAMUKfj8LZjHAY4ktfyzHksBSR3x/DdkEAKFF606+uoVRQKRp/g8r5sIQUxh9Hz04IzBh5uwO/jmUgND1as5++wXRgIPpba8sZzKQUrgc7y2Yk2CBlou+3nn00QDFCn4/C2YxwGOJLX8sx5LAUkd8fw3ZBAC');
    audio.play().catch(() => {});
  };

  // Fetch active positions
  const { data, isLoading, refetch, error } = trpc.performance.getActivePositions.useQuery(
    {
      accountId: selectedAccountId || '',
      positionType,
      minRealizedPercent: profitFilter || undefined,
    },
    {
      enabled: !!selectedAccountId,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );

  // Close positions mutation
  const closePositionsMutation = trpc.performance.closePositions.useMutation({
    onSuccess: (result) => {
      setCloseResults(result);
      setSelectedPositions(new Set());
      refetch();
      
      // Show warning if positions were excluded due to existing working orders
      if (result.summary.excluded > 0) {
        const excludedSymbols = result.excluded.map((p: any) => p.underlying).join(', ');
        toast.warning(
          `${result.summary.excluded} position(s) skipped: ${excludedSymbols}. Already have working orders.`,
          { duration: 6000 }
        );
      }
      
      // Don't show confetti here - let UnifiedOrderPreviewModal handle it after polling confirms fills
      // This prevents confetti from showing for dry runs
      if (result.summary.failed > 0 && result.summary.success === 0) {
        // All orders failed
        toast.error(`Failed to submit ${result.summary.failed} order(s). Check the results dialog for details.`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to ${dryRun ? 'validate' : 'submit'} orders: ${error.message}`);
    },
  });

  // Show error if API call fails
  if (error) {
    console.error('[Performance] Error fetching positions:', error);
  }

  const handleRefresh = async () => {
    if (!selectedAccountId) {
      toast.error('Please select an account first');
      return;
    }
    try {
      await refetch();
      toast.success('Positions refreshed');
    } catch (error: any) {
      console.error('[Performance] Refresh error:', error);
      toast.error(`Failed to refresh positions: ${error.message || 'Unknown error'}`);
    }
  };

  // Sort handler
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Filter positions by profit threshold
  const filteredPositions = useMemo(() => {
    if (!data?.positions) return [];
    let positions = data.positions;
    if (profitFilter) {
      positions = positions.filter(pos => pos.realizedPercent >= profitFilter && !pos.hasWorkingOrder);
    }
    
    // Filter by spread type
    if (spreadFilter === 'spreads') {
      positions = positions.filter(pos => pos.spreadType);
    } else if (spreadFilter === 'single-leg') {
      positions = positions.filter(pos => !pos.spreadType);
    }
    
    // Sort positions
    if (sortColumn) {
      positions = [...positions].sort((a, b) => {
        let aVal: any;
        let bVal: any;
        
        switch (sortColumn) {
          case 'account':
            aVal = a.account;
            bVal = b.account;
            break;
          case 'symbol':
            aVal = a.symbol;
            bVal = b.symbol;
            break;
          case 'type':
            aVal = a.type;
            bVal = b.type;
            break;
          case 'qty':
            aVal = a.quantity;
            bVal = b.quantity;
            break;
          case 'strike':
            aVal = a.strike;
            bVal = b.strike;
            break;
          case 'exp':
            aVal = new Date(a.expiration).getTime();
            bVal = new Date(b.expiration).getTime();
            break;
          case 'dte':
            aVal = a.dte;
            bVal = b.dte;
            break;
          case 'premium':
            aVal = a.premium;
            bVal = b.premium;
            break;
          case 'current':
            aVal = a.current;
            bVal = b.current;
            break;
          case 'realized':
            aVal = a.realizedPercent;
            bVal = b.realizedPercent;
            break;
          case 'action':
            aVal = a.action;
            bVal = b.action;
            break;
          default:
            return 0;
        }
        
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortDirection === 'asc' 
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    
    return positions;
  }, [data?.positions, profitFilter, spreadFilter, sortColumn, sortDirection]);

  // Get selected positions data
  const selectedPositionsData = useMemo(() => {
    return filteredPositions.filter((_, idx) => selectedPositions.has(idx));
  }, [filteredPositions, selectedPositions]);

  // Calculate selected positions summary
  const selectedSummary = useMemo(() => {
    const count = selectedPositionsData.length;
    const totalCost = selectedPositionsData.reduce((sum, pos) => sum + pos.current, 0);
    const totalPremium = selectedPositionsData.reduce((sum, pos) => sum + pos.premium, 0);
    return { count, totalCost, totalPremium };
  }, [selectedPositionsData]);

  const handleSelectAll = () => {
    if (selectedPositions.size === filteredPositions.length) {
      setSelectedPositions(new Set());
    } else {
      setSelectedPositions(new Set(filteredPositions.map((_, idx) => idx)));
    }
  };

  const handleTogglePosition = (idx: number) => {
    const newSelected = new Set(selectedPositions);
    if (newSelected.has(idx)) {
      newSelected.delete(idx);
    } else {
      newSelected.add(idx);
    }
    setSelectedPositions(newSelected);
  };

  const handleClosePositions = () => {
    if (tradingMode === 'paper') {
      toast.error('Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.');
      return;
    }
    if (selectedPositionsData.length === 0) {
      toast.error('Please select at least one position to close');
      return;
    }
    
    // Build UnifiedOrder array from selected positions
    const orders: UnifiedOrder[] = selectedPositionsData.map(pos => {
      // For spreads, estimate individual leg prices
      // The currentPrice is the net spread price (what we pay to close)
      // We need to estimate bid/ask for both legs
      const isSpread = !!pos.longStrike;
      
      if (isSpread) {
        // For spreads: estimate short leg and long leg prices
        // Spread width determines the relationship between legs
        const spreadWidth = pos.spreadWidth || Math.abs(pos.strike - pos.longStrike!);
        
        // Estimate short leg (the one we sold) - typically worth less when profitable
        const shortLegMid = pos.currentPrice * 0.4; // Short leg is ~40% of spread cost
        const shortBid = shortLegMid * 0.95;
        const shortAsk = shortLegMid * 1.05;
        
        // Estimate long leg (the one we bought) - typically worth more
        const longLegMid = pos.currentPrice * 0.6; // Long leg is ~60% of spread cost
        const longBid = longLegMid * 0.95;
        const longAsk = longLegMid * 1.05;
        
        return {
          symbol: pos.symbol,
          strike: pos.strike,
          expiration: pos.expiration,
          premium: pos.currentPrice, // Net spread price
          action: "BTC" as const,
          optionType: (positionType === 'csp' ? 'PUT' : 'CALL') as "CALL" | "PUT",
          bid: shortBid,
          ask: shortAsk,
          currentPrice: pos.currentPrice,
          // Long leg data for spreads
          longStrike: pos.longStrike,
          longPremium: longLegMid,
          longBid: longBid,
          longAsk: longAsk,
        };
      } else {
        // Single-leg position
        return {
          symbol: pos.symbol,
          strike: pos.strike,
          expiration: pos.expiration,
          premium: pos.currentPrice,
          action: "BTC" as const,
          optionType: (positionType === 'csp' ? 'PUT' : 'CALL') as "CALL" | "PUT",
          bid: pos.currentPrice * 0.95,
          ask: pos.currentPrice * 1.05,
          currentPrice: pos.currentPrice,
        };
      }
    })
    
    // Safeguard 1: for CC positions, warn if closing this call leaves stock exposed
    // (i.e., the user might then sell the stock thinking the call is gone)
    if (positionType === 'cc') {
      const symbols = selectedPositionsData.map(p => p.symbol);
      const uniqueSymbols = Array.from(new Set(symbols));
      // Check each symbol for coverage issues
      for (const sym of uniqueSymbols) {
        const ccCount = selectedPositionsData.filter(p => p.symbol === sym).length;
        const totalCCs = (data?.positions || []).filter(p => p.symbol === sym).length;
        if (ccCount === totalCCs) {
          // Closing ALL calls for this symbol — warn user not to then sell the stock
          setSafeguardWarning({
            symbol: sym,
            message: `You are closing ALL covered calls on ${sym}. If you then sell the underlying ${sym} shares separately, any remaining short calls will become naked — triggering the same SL call pattern seen with ADBE. Only proceed if you intend to keep the shares.`,
          });
          setPendingCloseOrders(orders);
          return; // Hold — show warning first
        }
      }
    }

    setUnifiedOrders(orders);
    setShowPreviewModal(true);
  };

  const handleSafeguardProceed = () => {
    setSafeguardWarning(null);
    if (pendingCloseOrders) {
      setUnifiedOrders(pendingCloseOrders);
      setPendingCloseOrders(null);
      setShowPreviewModal(true);
    }
  };

  const handleSafeguardCancel = () => {
    setSafeguardWarning(null);
    setPendingCloseOrders(null);
  };

  // Callback for UnifiedOrderPreviewModal
  const handleConfirmClose = async (
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    isDryRun: boolean
  ): Promise<{ results: any[] }> => {
    // Modal stays open for both dry run and live submission
    setCloseResults(null);

    // Map UnifiedOrders back to position data for closePositions mutation
    const positionsToClose = selectedPositionsData.map(pos => ({
      accountId: pos.accountId,
      optionSymbol: pos.optionSymbol,
      underlying: pos.symbol,
      quantity: pos.quantity,
      strike: pos.strike,
      currentPrice: pos.currentPrice,
      // Include spread fields if present
      spreadType: pos.spreadType,
      longStrike: pos.longStrike,
      spreadWidth: pos.spreadWidth,
    }));

    try {
      const response = await closePositionsMutation.mutateAsync({
        positions: positionsToClose,
        dryRun: isDryRun,
      });
      return { results: response.results || [] };
    } catch (error: any) {
      console.error('[handleConfirmClose] Error:', error);
      return { results: [] };
    }
  };

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
      console.log('[Performance] Polling order statuses for:', orderIds, 'accountId:', accountId);
      
      // Call the tRPC endpoint to check order statuses using utils.fetch
      const statusMap = await utils.orders.checkStatusBatch.fetch({
        accountId,
        orderIds,
      });
      
      console.log('[Performance] Received status map:', statusMap);
      
      // Map the status results to the format expected by UnifiedOrderPreviewModal
      return orderIds.map((orderId, index) => {
        const status = statusMap[orderId];
        const position = selectedPositionsData[index];
        
        // Map Unknown status to Rejected for UI display
        const mappedStatus = status?.status === 'Unknown' ? 'Rejected' as const : status?.status || 'Rejected' as const;
        
        return {
          orderId,
          symbol: position?.symbol || 'Unknown',
          status: mappedStatus,
          message: status?.status === 'Filled' 
            ? `Order filled successfully`
            : status?.status === 'Rejected'
            ? `Order rejected: ${status.rejectedReason || 'Unknown reason'}`
            : status?.status === 'MarketClosed'
            ? status.marketClosedMessage || 'Market is closed'
            : status?.status === 'Working'
            ? 'Order is working'
            : 'Status unknown',
        };
      });
    } catch (error: any) {
      console.error('[Performance] Error polling order statuses:', error);
      // Return unknown status for all orders on error
      return orderIds.map((orderId, index) => ({
        orderId,
        symbol: selectedPositionsData[index]?.symbol || 'Unknown',
        status: 'Rejected' as const,
        message: `Failed to check status: ${error.message}`,
      }));
    }
  };

  const summary = data?.summary || {
    openPositions: 0,
    totalPremiumAtRisk: 0,
    avgRealizedPercent: 0,
    readyToClose: 0,
    spreadCount: 0,
    singleLegCount: 0,
    totalSpreadPremium: 0,
    totalSingleLegPremium: 0,
    totalCapitalAtRisk: 0,
    overallCapitalEfficiency: 0,
    spreadCapitalEfficiency: 0,
    singleLegCapitalEfficiency: 0,
  };

  // Count positions by profit threshold
  const profitCounts = useMemo(() => {
    if (!data?.positions) return { p70: 0, p75: 0, p80: 0, p85: 0, p90: 0, p95: 0 };
    return {
      p70: data.positions.filter(p => p.realizedPercent >= 70 && !p.hasWorkingOrder).length,
      p75: data.positions.filter(p => p.realizedPercent >= 75 && !p.hasWorkingOrder).length,
      p80: data.positions.filter(p => p.realizedPercent >= 80 && !p.hasWorkingOrder).length,
      p85: data.positions.filter(p => p.realizedPercent >= 85 && !p.hasWorkingOrder).length,
      p90: data.positions.filter(p => p.realizedPercent >= 90 && !p.hasWorkingOrder).length,
      p95: data.positions.filter(p => p.realizedPercent >= 95 && !p.hasWorkingOrder).length,
    };
  }, [data?.positions]);

  // Show account selection prompt if no account selected
  if (!selectedAccountId) {
    return (
      <Card className="p-8 text-center">
        <div className="space-y-4">
          <div className="text-lg font-medium text-muted-foreground">
            Please select a Tastytrade account from the sidebar to view active positions
          </div>
          <p className="text-sm text-muted-foreground">
            If you don't see any accounts, make sure you've configured your Tastytrade credentials in Settings.
          </p>
        </div>
      </Card>
    );
  }

  // Show error message if API call failed
  if (error) {
    return (
      <Card className="p-8 text-center">
        <div className="space-y-4">
          <div className="text-lg font-medium text-red-400">
            Error loading positions
          </div>
          <p className="text-sm text-muted-foreground">
            {error.message || 'Failed to fetch positions from Tastytrade API'}
          </p>
          <Button onClick={handleRefresh} variant="outline">
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/20">
          <div className="text-sm text-muted-foreground mb-1">Open Positions</div>
          <div className="text-3xl font-bold text-blue-400">{summary.openPositions}</div>
          {((summary.spreadCount ?? 0) > 0 || (summary.singleLegCount ?? 0) > 0) && (
            <div className="text-xs text-muted-foreground mt-2">
              {(summary.spreadCount ?? 0) > 0 && <span className="text-emerald-400">{summary.spreadCount} spread{(summary.spreadCount ?? 0) !== 1 ? 's' : ''}</span>}
              {(summary.spreadCount ?? 0) > 0 && (summary.singleLegCount ?? 0) > 0 && <span className="mx-1">•</span>}
              {(summary.singleLegCount ?? 0) > 0 && <span>{summary.singleLegCount} single-leg</span>}
            </div>
          )}
        </Card>
        <Card className="p-6 bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
          <div className="text-sm text-muted-foreground mb-1">Total Premium at Risk</div>
          <div className="text-3xl font-bold text-purple-400">
            ${summary.totalPremiumAtRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {((summary.totalSpreadPremium ?? 0) > 0 || (summary.totalSingleLegPremium ?? 0) > 0) && (
            <div className="text-xs text-muted-foreground mt-2">
              {(summary.totalSpreadPremium ?? 0) > 0 && (
                <div className="text-emerald-400">
                  ${(summary.totalSpreadPremium ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} spreads
                </div>
              )}
              {(summary.totalSingleLegPremium ?? 0) > 0 && (
                <div>
                  ${(summary.totalSingleLegPremium ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} single-leg
                </div>
              )}
            </div>
          )}
        </Card>
        <Card className="p-6 bg-gradient-to-br from-green-500/10 to-green-600/10 border-green-500/20">
          <div className="text-sm text-muted-foreground mb-1">Avg Premium Realized</div>
          <div className="text-3xl font-bold text-green-400">{summary.avgRealizedPercent.toFixed(1)}%</div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-amber-500/10 to-amber-600/10 border-amber-500/20">
          <div className="text-sm text-muted-foreground mb-1">Ready to Close</div>
          <div className="text-3xl font-bold text-amber-400">{summary.readyToClose}</div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-cyan-500/10 to-cyan-600/10 border-cyan-500/20">
          <div className="text-sm text-muted-foreground mb-1">Capital Efficiency</div>
          <div className="text-3xl font-bold text-cyan-400">{(summary.overallCapitalEfficiency ?? 0).toFixed(1)}%</div>
          {((summary.spreadCapitalEfficiency ?? 0) > 0 || (summary.singleLegCapitalEfficiency ?? 0) > 0) && (
            <div className="text-xs text-muted-foreground mt-2">
              {(summary.spreadCapitalEfficiency ?? 0) > 0 && (
                <div className="text-emerald-400">
                  {(summary.spreadCapitalEfficiency ?? 0).toFixed(1)}% spreads
                </div>
              )}
              {(summary.singleLegCapitalEfficiency ?? 0) > 0 && (
                <div>
                  {(summary.singleLegCapitalEfficiency ?? 0).toFixed(1)}% single-leg
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Quick Profit Filters */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">Quick Filters:</span>
            <Button
              variant={profitFilter === 95 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 95 ? null : 95)}
              className="bg-green-500/20 hover:bg-green-500/30 border-green-500/50"
            >
              95%+ ({profitCounts.p95})
            </Button>
            <Button
              variant={profitFilter === 90 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 90 ? null : 90)}
              className="bg-yellow-500/20 hover:bg-yellow-500/30 border-yellow-500/50"
            >
              90%+ ({profitCounts.p90})
            </Button>
            <Button
              variant={profitFilter === 85 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 85 ? null : 85)}
              className="bg-orange-500/20 hover:bg-orange-500/30 border-orange-500/50"
            >
              85%+ ({profitCounts.p85})
            </Button>
            <Button
              variant={profitFilter === 80 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 80 ? null : 80)}
              className="bg-red-500/20 hover:bg-red-500/30 border-red-500/50"
            >
              80%+ ({profitCounts.p80})
            </Button>
            <Button
              variant={profitFilter === 75 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 75 ? null : 75)}
              className="bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/50"
            >
              75%+ ({profitCounts.p75})
            </Button>
            <Button
              variant={profitFilter === 70 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 70 ? null : 70)}
              className="bg-pink-500/20 hover:bg-pink-500/30 border-pink-500/50"
            >
              70%+ ({profitCounts.p70})
            </Button>
            {profitFilter && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProfitFilter(null)}
              >
                Clear Filter
              </Button>
            )}
            <div className="h-4 w-px bg-border" />
            <span className="text-sm font-medium">Position Type:</span>
            <Button
              variant={spreadFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSpreadFilter('all')}
            >
              All
            </Button>
            <Button
              variant={spreadFilter === 'spreads' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSpreadFilter('spreads')}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/50"
            >
              Spreads Only
            </Button>
            <Button
              variant={spreadFilter === 'single-leg' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSpreadFilter('single-leg')}
            >
              Single-Leg Only
            </Button>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              className="bg-blue-500/20 hover:bg-blue-500/30 border-blue-500/50 text-blue-400"
            >
              {selectedPositions.size === filteredPositions.length && filteredPositions.length > 0 ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const timestamp = new Date().toISOString().split('T')[0];
                exportToCSV(filteredPositions, `ActivePositions_${positionType.toUpperCase()}_${timestamp}`);
                toast.success(`Exported ${filteredPositions.length} positions to CSV`);
              }}
              disabled={filteredPositions.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Selected Positions Summary & Close Button */}
      {selectedSummary.count > 0 && (
        <Card className="p-4 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-sm text-muted-foreground">Selected Positions</div>
                <div className="text-2xl font-bold text-amber-400">{selectedSummary.count}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Cost to Close</div>
                <div className="text-2xl font-bold text-amber-400">
                  ${selectedSummary.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Premium Collected</div>
                <div className="text-2xl font-bold text-green-400">
                  ${selectedSummary.totalPremium.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-background/50 rounded-lg border">
                <Checkbox
                  checked={dryRun}
                  onCheckedChange={(checked) => setDryRun(checked as boolean)}
                  id="dry-run"
                />
                <label htmlFor="dry-run" className="text-sm font-medium cursor-pointer">
                  Dry Run Mode
                </label>
              </div>
              <Button
                onClick={handleClosePositions}
                className={dryRun 
                  ? "bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/50"
                  : "bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/50"
                }
                disabled={closePositionsMutation.isPending}
              >
                {closePositionsMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {dryRun ? 'Validating...' : 'Submitting...'}
                  </>
                ) : (
                  <>
                    <TrendingUp className="h-4 w-4 mr-2" />
                    {dryRun ? 'Validate Close Orders' : 'Submit Close Orders'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Position Type Tabs */}
      <Tabs value={positionType} onValueChange={(v) => setPositionType(v as 'csp' | 'cc')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="csp">Active CSPs</TabsTrigger>
          <TabsTrigger value="cc">Active CCs</TabsTrigger>
        </TabsList>

        <TabsContent value="csp" className="mt-6">
          <PositionsTable 
            positions={filteredPositions} 
            isLoading={isLoading}
            selectedPositions={selectedPositions}
            onTogglePosition={handleTogglePosition}
            onSelectAll={handleSelectAll}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        </TabsContent>

        <TabsContent value="cc" className="mt-6">
          <PositionsTable 
            positions={filteredPositions} 
            isLoading={isLoading}
            selectedPositions={selectedPositions}
            onTogglePosition={handleTogglePosition}
            onSelectAll={handleSelectAll}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        </TabsContent>
      </Tabs>

      {/* Unified Order Preview Modal for BTC */}
      {unifiedOrders.length > 0 && (
        <UnifiedOrderPreviewModal
          open={showPreviewModal}
          onOpenChange={(open) => {
            setShowPreviewModal(open);
            // If closing the modal after submission is complete, refresh the data
            if (!open && submissionComplete) {
              console.log('[Performance] Modal closed after submission - refreshing positions');
              refetch(); // Refresh active positions
              setSubmissionComplete(false); // Reset submission state
              setFinalOrderStatus(null); // Reset status
              setSelectedPositions(new Set()); // Clear selection
              setUnifiedOrders([]); // Clear orders
            }
          }}
          orders={unifiedOrders}
          strategy="btc"
          accountId={selectedAccountId || ''}
          availableBuyingPower={data?.summary?.totalPremiumAtRisk || 0}
          onSubmit={handleConfirmClose}
          onPollStatuses={handlePollOrderStatuses}
          allowQuantityEdit={false}
          tradingMode={tradingMode === 'live' ? 'live' : 'paper'}
          initialSkipDryRun={!dryRun}
          submissionComplete={submissionComplete}
          finalOrderStatus={finalOrderStatus}
          onSubmissionStateChange={(complete, status) => {
            setSubmissionComplete(complete);
            setFinalOrderStatus(status);
          }}
        />
      )}

      {/* Safeguard 1 Warning Dialog */}
      <Dialog open={!!safeguardWarning} onOpenChange={(open) => { if (!open) handleSafeguardCancel(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <span>⚠️</span> Coverage Warning — {safeguardWarning?.symbol}
            </DialogTitle>
            <DialogDescription className="text-base pt-2">
              {safeguardWarning?.message}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm text-amber-200">
            <strong>Safe to proceed</strong> if you are closing this covered call to take profit on the option and plan to <strong>keep the underlying shares</strong>. The shares will remain in your account and can back future calls.
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleSafeguardCancel}>
              Cancel — Review First
            </Button>
            <Button
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border-amber-500/50"
              onClick={handleSafeguardProceed}
            >
              I Understand — Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Results Dialog */}
      {closeResults && (
        <Dialog open={!!closeResults} onOpenChange={() => setCloseResults(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {dryRun ? 'Validation Results' : 'Order Submission Results'}
              </DialogTitle>
              <DialogDescription>
                {closeResults.summary.success} of {closeResults.summary.total} order(s) {dryRun ? 'validated' : 'submitted'} successfully
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {closeResults.results.map((result: any, idx: number) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    result.success
                      ? 'bg-green-500/10 border-green-500/20'
                      : 'bg-red-500/10 border-red-500/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {result.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">
                        {result.underlying} ${result.strike} ({result.quantity} contracts)
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {result.message}
                      </div>
                      {result.orderId && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Order ID: {result.orderId}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => setCloseResults(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface Position {
  account: string;
  accountId: string;
  symbol: string;
  optionSymbol: string;
  type: 'CSP' | 'CC';
  quantity: number;
  strike: number;
  expiration: string;
  dte: number;
  premium: number;
  current: number;
  currentPrice: number;
  realizedPercent: number;
  action: 'CLOSE' | 'WATCH' | 'HOLD';
  hasWorkingOrder: boolean;
  // Spread-specific fields
  spreadType?: 'bull_put' | 'bear_call' | 'iron_condor';
  longStrike?: number;
  spreadWidth?: number;
  capitalAtRisk?: number;
}

interface PositionsTableProps {
  positions: Position[];
  isLoading: boolean;
  selectedPositions: Set<number>;
  onTogglePosition: (idx: number) => void;
  onSelectAll: () => void;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
}

interface SortableHeaderProps {
  column: string;
  label: string;
  align: 'left' | 'right' | 'center';
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
}

function SortableHeader({ column, label, align, sortColumn, sortDirection, onSort }: SortableHeaderProps) {
  const isActive = sortColumn === column;
  const alignClass = align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center';
  
  return (
    <th className={`${alignClass} p-3 text-sm font-medium cursor-pointer hover:bg-muted/30 select-none`} onClick={() => onSort(column)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        <span>{label}</span>
        {isActive && (
          <span className="text-blue-400">
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );
}

function PositionsTable({ positions, isLoading, selectedPositions, onTogglePosition, onSelectAll, sortColumn, sortDirection, onSort }: PositionsTableProps) {
  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground py-12">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          Loading positions...
        </div>
      </Card>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground py-12">
          No active positions found
        </div>
      </Card>
    );
  }

  const allSelected = selectedPositions.size === positions.length;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 text-sm font-medium w-12">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onSelectAll}
                  aria-label="Select all"
                  className="border-2 border-white/50 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                />
              </th>
              <SortableHeader column="account" label="Account" align="left" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="symbol" label="Symbol" align="left" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="type" label="Type" align="left" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="strategy" label="Strategy" align="left" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="qty" label="Qty" align="right" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="strike" label="Strike" align="right" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="exp" label="Exp" align="left" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="dte" label="DTE" align="right" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="premium" label="Premium" align="right" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="current" label="Current" align="right" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="realized" label="Realized %" align="right" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
              <SortableHeader column="action" label="Action" align="center" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, idx) => (
              <tr key={idx} className={`border-t border-border hover:bg-muted/30 ${pos.hasWorkingOrder ? 'opacity-60' : ''}`}>
                <td className="p-3">
                  <Checkbox
                    checked={selectedPositions.has(idx)}
                    onCheckedChange={() => onTogglePosition(idx)}
                    disabled={pos.hasWorkingOrder}
                    aria-label={`Select ${pos.symbol}`}
                    className="border-2 border-white/50 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                  />
                </td>
                <td className="p-3 text-sm">{pos.account}</td>
                <td className="p-3 text-sm font-medium">{pos.symbol}</td>
                <td className="p-3 text-sm">
                  <span className={`px-2 py-1 rounded text-xs ${
                    pos.type === 'CSP' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                  }`}>
                    {pos.type}
                  </span>
                </td>
                <td className="p-3 text-sm">
                  {pos.spreadType ? (
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      pos.spreadType === 'bull_put' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    }`}>
                      {pos.spreadType === 'bull_put' ? 'Bull Put Spread' : 'Bear Call Spread'}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Single Leg</span>
                  )}
                </td>
                <td className="p-3 text-sm text-right">{pos.quantity}</td>
                <td className="p-3 text-sm text-right">
                  {pos.spreadType && pos.longStrike ? (
                    <span className="font-medium">
                      ${pos.strike.toFixed(2)}<span className="text-muted-foreground">/</span>${pos.longStrike.toFixed(2)}
                    </span>
                  ) : (
                    <span>${pos.strike.toFixed(2)}</span>
                  )}
                </td>
                <td className="p-3 text-sm">{pos.expiration}</td>
                <td className="p-3 text-sm text-right">{pos.dte}</td>
                <td className="p-3 text-sm text-right">${pos.premium.toFixed(2)}</td>
                <td className="p-3 text-sm text-right">${pos.current.toFixed(2)}</td>
                <td className="p-3 text-sm text-right">
                  {pos.hasWorkingOrder ? (
                    <span className="px-2 py-1 rounded text-xs bg-amber-500/20 text-amber-400 font-medium">
                      Working
                    </span>
                  ) : (
                    <span className={`font-medium ${
                      pos.realizedPercent >= 80 ? 'text-green-400' :
                      pos.realizedPercent >= 60 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {pos.realizedPercent.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <ActionButton action={pos.action} onClick={() => onTogglePosition(idx)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ActionButton({ action, onClick }: { action: 'CLOSE' | 'WATCH' | 'HOLD'; onClick?: () => void }) {
  const config = {
    CLOSE: {
      label: 'CLOSE',
      icon: TrendingUp,
      className: 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/50',
    },
    WATCH: {
      label: 'WATCH',
      icon: Minus,
      className: 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border-yellow-500/50',
    },
    HOLD: {
      label: 'HOLD',
      icon: TrendingDown,
      className: 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/50',
    },
  };

  const { label, icon: Icon, className } = config[action];

  return (
    <Button
      variant="outline"
      size="sm"
      className={`inline-flex items-center px-2 py-1 h-auto text-xs font-medium ${className}`}
      onClick={onClick}
    >
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Button>
  );
}

export function WorkingOrdersTab() {
  const { mode: tradingMode } = useTradingMode();
  const { selectedAccountId } = useAccount();
  const [aggressiveFillMode, setAggressiveFillMode] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [showFillNowDialog, setShowFillNowDialog] = useState(false);
  const [actionResults, setActionResults] = useState<any>(null);
  const [showFillRateAnalytics, setShowFillRateAnalytics] = useState(false);
  const [groupBySymbol, setGroupBySymbol] = useState(true);
  
  // UnifiedOrderPreviewModal state
  const [unifiedModalOpen, setUnifiedModalOpen] = useState(false);
  const [unifiedModalOrders, setUnifiedModalOrders] = useState<UnifiedOrder[]>([]);
  const [oldOrderIds, setOldOrderIds] = useState<string[]>([]);

  // Poll for order fill status updates
  const orderIds = useMemo(() => {
    if (!actionResults?.results) return [];
    return actionResults.results
      .filter((r: any) => r.success && r.newOrderId)
      .map((r: any) => String(r.newOrderId)); // Convert to string for tRPC validation
  }, [actionResults]);

  const { data: orderStatusData } = trpc.workingOrders.checkOrderStatus.useQuery(
    {
      accountId: selectedAccountId || '',
      orderIds,
    },
    {
      enabled: !!selectedAccountId && orderIds.length > 0,
      refetchInterval: 10000, // Poll every 10 seconds
      refetchOnWindowFocus: false,
    }
  );

  // Play fill notification sound
  const playFillSound = () => {
    // Create a pleasant notification sound (three ascending tones)
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };
    
    const now = audioContext.currentTime;
    playTone(523.25, now, 0.15); // C5
    playTone(659.25, now + 0.15, 0.15); // E5
    playTone(783.99, now + 0.3, 0.25); // G5
  };

  // Update actionResults when order status changes
  useEffect(() => {
    if (!orderStatusData || !actionResults) return;

    const updatedResults = actionResults.results.map((result: any) => {
      if (!result.newOrderId) return result;
      
      const status = orderStatusData[result.newOrderId];
      if (status) {
        return {
          ...result,
          orderStatus: status.status,
          filledAt: status.filledAt,
        };
      }
      return result;
    });

    // Check if any orders just changed to filled status
    const newlyFilledOrders = updatedResults.filter((r: any, idx: number) => {
      const oldStatus = actionResults.results[idx]?.orderStatus;
      const newStatus = r.orderStatus;
      return oldStatus !== 'Filled' && newStatus === 'Filled';
    });

    // Play sound if any orders were just filled
    if (newlyFilledOrders.length > 0) {
      playFillSound();
    }

    // Only update if something changed
    const hasChanges = updatedResults.some((r: any, idx: number) => 
      r.orderStatus !== actionResults.results[idx]?.orderStatus
    );

    if (hasChanges) {
      setActionResults({
        ...actionResults,
        results: updatedResults,
      });
    }
  }, [orderStatusData]);

  // Fetch working orders
  const { data, isLoading, refetch, error } = trpc.workingOrders.getWorkingOrders.useQuery(
    {
      accountId: selectedAccountId || '',
      aggressiveFillMode,
    },
    {
      enabled: !!selectedAccountId,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );

  // Cancel orders mutation
  const cancelOrdersMutation = trpc.workingOrders.cancelOrders.useMutation({
    onSuccess: (result) => {
      // Add action type to distinguish from replace
      setActionResults({ ...result, action: 'cancel' });
      setSelectedOrders(new Set());
      refetch();
      toast.success(`Canceled ${result.successCount} of ${result.successCount + result.failedCount} orders`);
    },
    onError: (error) => {
      toast.error(`Failed to cancel orders: ${error.message}`);
    },
  });

  // Replace orders mutation
  const replaceOrdersMutation = trpc.workingOrders.replaceOrders.useMutation({
    onSuccess: (result) => {
      // Add action type to distinguish from cancel
      setActionResults({ ...result, action: 'replace' });
      setSelectedOrders(new Set());
      refetch();
      
      // Show detailed toast with order IDs for successful replacements
      if (result.successCount > 0) {
        const successfulReplacements = result.results.filter((r: any) => r.success);
        if (successfulReplacements.length === 1) {
          const r = successfulReplacements[0];
          // Handle newOrderId being either string or array
          const newId = Array.isArray(r.newOrderId) 
            ? (r.newOrderId[0] || 'N/A')
            : (r.newOrderId || 'N/A');
          const newIdDisplay = typeof newId === 'string' && newId !== 'N/A' 
            ? newId.slice(-6) 
            : newId;
          
          toast.success(
            `Order replaced: Canceled #${r.orderId.slice(-6)}, Created #${newIdDisplay}`,
            { duration: 5000 }
          );
        } else {
          // Multiple orders - show summary
          toast.success(
            `Replaced ${result.successCount} orders successfully`,
            { duration: 4000 }
          );
          // Show individual order IDs in console for reference
          console.log('[Order Replacement] Details:', successfulReplacements.map((r: any) => ({
            canceled: r.orderId,
            created: r.newOrderId,
            symbol: r.symbol
          })));
        }
      }
      
      if (result.failedCount > 0) {
        toast.error(`Failed to replace ${result.failedCount} order(s)`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to replace orders: ${error.message}`);
    },
  });

  // Auto-cancel stuck orders mutation
  const autoCancelMutation = trpc.workingOrders.autoCancelStuckOrders.useMutation({
    onSuccess: (result) => {
      refetch();
      toast.success(`Auto-canceled ${result.canceledCount} stuck orders, resubmitted ${result.resubmittedCount}`);
      setActionResults({ ...result, action: 'auto-cancel' });
    },
    onError: (error) => {
      toast.error(`Failed to auto-cancel stuck orders: ${error.message}`);
    },
  });

  // Fetch fill rate analytics
  const { data: fillRateData } = trpc.workingOrders.getFillRateAnalytics.useQuery(
    { daysBack: 30 },
    { enabled: showFillRateAnalytics }
  );

  const orders = data?.orders || [];
  const summary = data?.summary || { totalOrders: 0, totalContracts: 0, needsReplacement: 0, needsReview: 0, avgMinutesWorking: 0 };
  const marketStatus = data?.marketStatus || 'Unknown';
  const safeToReplace = data?.safeToReplace !== false;

  // Selection handlers
  const toggleSelection = (idx: number) => {
    const newSelection = new Set(selectedOrders);
    if (newSelection.has(idx)) {
      newSelection.delete(idx);
    } else {
      newSelection.add(idx);
    }
    setSelectedOrders(newSelection);
  };

  const selectAll = () => {
    if (selectedOrders.size === orders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(orders.map((_, idx) => idx)));
    }
  };

  // Action handlers
  const handleCancelSelected = () => {
    if (selectedOrders.size === 0) {
      toast.error('Please select orders to cancel');
      return;
    }
    setShowCancelDialog(true);
  };
  
  const handleReplaceSelected = () => {
    if (tradingMode === 'paper') {
      toast.error('Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.');
      return;
    }
    if (selectedOrders.size === 0 && summary.needsReplacement === 0) {
      toast.error('No orders to replace');
      return;
    }
    if (!safeToReplace) {
      toast.error('Not safe to replace orders after 3:55 PM ET');
      return;
    }
    
    // Build UnifiedOrder array from working orders
    const ordersToReplace = selectedOrders.size > 0
      ? Array.from(selectedOrders).map(idx => orders[idx])
      : orders.filter(order => order.needsReplacement);
    
    const unifiedOrders: UnifiedOrder[] = ordersToReplace.map(order => ({
      symbol: order.underlyingSymbol,
      strike: order.strike,
      expiration: order.expiration,
      premium: order.suggestedPrice,
      action: order.action.replace('Buy to Close', 'BTC').replace('Sell to Open', 'STO').replace('Sell to Close', 'STC').replace('Buy to Open', 'BTO'),
      optionType: order.optionType as 'CALL' | 'PUT',
      bid: order.bid,
      ask: order.ask,
      currentPrice: order.currentPrice,
      oldPrice: order.currentPrice,
      oldOrderId: String(order.orderId),
    }));
    
    const orderIds = ordersToReplace.map(order => String(order.orderId));
    
    setUnifiedModalOrders(unifiedOrders);
    setOldOrderIds(orderIds);
    setUnifiedModalOpen(true);
  };

  const handleFillNow = () => {
    if (tradingMode === 'paper') {
      toast.error('Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.');
      return;
    }
    if (selectedOrders.size === 0) {
      toast.error('Please select orders to fill');
      return;
    }
    if (!safeToReplace) {
      toast.error('Not safe to replace orders after 3:55 PM ET');
      return;
    }
    setShowFillNowDialog(true);
  };

  const confirmFillNow = () => {
    // Use Ask + $0.10 for guaranteed immediate fills on selected orders only
    const ordersToFill = Array.from(selectedOrders).map(idx => {
      const order = orders[idx];
      return {
        orderId: String(order.orderId),
        accountNumber: String(order.accountNumber),
        symbol: order.symbol,
        suggestedPrice: order.ask + 0.10, // Force Ask + $0.10 for instant fill
        rawOrder: order.rawOrder,
      };
    });

    replaceOrdersMutation.mutate({ orders: ordersToFill });
    setShowFillNowDialog(false);
    toast.info(`Submitting ${ordersToFill.length} order(s) at ASK + $0.10 for immediate fills...`);
  };

  const confirmCancel = () => {
    const ordersToCancel = Array.from(selectedOrders).map(idx => ({
      orderId: String(orders[idx].orderId), // Convert to string to match schema
      accountNumber: String(orders[idx].accountNumber),
      symbol: orders[idx].symbol,
    }));

    cancelOrdersMutation.mutate({ orders: ordersToCancel });
    setShowCancelDialog(false);
  };

  // UnifiedOrderPreviewModal replace callback
  const handleReplaceSubmit = async (
    unifiedOrders: UnifiedOrder[],
    quantities: Map<string, number>,
    oldOrderIds: string[],
    isDryRun: boolean
  ) => {
    // Build orders for replaceOrders mutation
    const ordersToReplace = unifiedOrders.map((order, idx) => {
      const matchingOrder = orders.find(o => String(o.orderId) === oldOrderIds[idx]);
      return {
        orderId: oldOrderIds[idx],
        accountNumber: String(matchingOrder?.accountNumber || ''),
        symbol: order.symbol,
        suggestedPrice: order.premium,
        rawOrder: matchingOrder?.rawOrder,
      };
    });

    // If dry run, just validate and return success without calling mutation
    if (isDryRun) {
      console.log('[Replace Orders] Dry run - validating orders:', ordersToReplace);
      return Promise.resolve({
        successCount: ordersToReplace.length,
        failedCount: 0,
        results: ordersToReplace.map(order => ({
          success: true,
          orderId: order.orderId,
          symbol: order.symbol,
          message: 'Dry run validation successful'
        }))
      });
    }

    // Live submission - call the mutation
    console.log('[Replace Orders] Live submission - calling mutation:', ordersToReplace);
    return new Promise<{ successCount: number; failedCount: number; results: any[] }>((resolve, reject) => {
      replaceOrdersMutation.mutate(
        { orders: ordersToReplace },
        {
          onSuccess: (result) => {
            resolve({
              successCount: result.successCount,
              failedCount: result.failedCount,
              results: result.results,
            });
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  };
  
  const confirmReplace = () => {
    // If there are selected orders, replace only those; otherwise replace all that need replacement
    const ordersToReplace = selectedOrders.size > 0
      ? Array.from(selectedOrders).map(idx => orders[idx]).map(order => ({
          orderId: String(order.orderId),
          accountNumber: String(order.accountNumber),
          symbol: order.symbol,
          suggestedPrice: order.suggestedPrice,
          rawOrder: order.rawOrder,
        }))
      : orders
          .filter(order => order.needsReplacement)
          .map(order => ({
            orderId: String(order.orderId),
            accountNumber: String(order.accountNumber),
            symbol: order.symbol,
            suggestedPrice: order.suggestedPrice,
            rawOrder: order.rawOrder,
          }));

    if (ordersToReplace.length === 0) {
      toast.error('No orders to replace');
      setShowReplaceDialog(false);
      return;
    }

    replaceOrdersMutation.mutate({ orders: ordersToReplace });
    setShowReplaceDialog(false);
  };

  // Loading state
  if (!selectedAccountId) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          Please select a Tastytrade account from the sidebar to view working orders
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
        <p className="text-muted-foreground">Loading working orders...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-8 text-center">
        <XCircle className="h-8 w-8 mx-auto mb-4 text-red-500" />
        <p className="text-red-500">Error loading working orders</p>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </Card>
    );
  }

  const selectedOrdersList = Array.from(selectedOrders).map(idx => orders[idx]);
  const totalCostToClose = selectedOrdersList.reduce((sum, order) => sum + (order.suggestedPrice * order.quantity * 100), 0);

  return (
    <div className="space-y-6">
      {/* Market Status Banner */}
      <Card className={`p-4 border-2 ${
        marketStatus === 'Open' ? 'border-green-500/50 bg-green-500/10' :
        marketStatus === 'Pre-Market' || marketStatus === 'After Hours' ? 'border-yellow-500/50 bg-yellow-500/10' :
        'border-red-500/50 bg-red-500/10'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${
              marketStatus === 'Open' ? 'bg-green-500' :
              marketStatus === 'Pre-Market' || marketStatus === 'After Hours' ? 'bg-yellow-500' :
              'bg-red-500'
            } animate-pulse`} />
            <div>
              <p className="font-medium">Market Status: {marketStatus}</p>
              {!safeToReplace && (
                <p className="text-sm text-muted-foreground">Order replacement disabled after 3:55 PM ET</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const timestamp = new Date().toISOString().split('T')[0];
                const orders = data?.orders || [];
                exportToCSV(orders, `WorkingOrders_${timestamp}`);
                toast.success(`Exported ${orders.length} working orders to CSV`);
              }}
              disabled={!data?.orders || data.orders.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
          <p className="text-3xl font-bold text-blue-400">{summary.totalOrders}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <p className="text-sm text-muted-foreground mb-1">Total Contracts</p>
          <p className="text-3xl font-bold text-purple-400">{summary.totalContracts}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border-yellow-500/20">
          <p className="text-sm text-muted-foreground mb-1">Needs Replacement</p>
          <p className="text-3xl font-bold text-yellow-400">{summary.needsReplacement}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
          <p className="text-sm text-muted-foreground mb-1">Needs Review</p>
          <p className="text-3xl font-bold text-red-400">{summary.needsReview}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <p className="text-sm text-muted-foreground mb-1">Avg Time Working</p>
          <p className="text-3xl font-bold text-green-400">{summary.avgMinutesWorking}m</p>
        </Card>
      </div>

      {/* Fill Rate Analytics */}
      {showFillRateAnalytics && fillRateData && fillRateData.totalOrders > 0 && (
        <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-purple-600/5 border-blue-500/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Fill Rate Analytics (Last 30 Days)</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowFillRateAnalytics(false)}>
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-muted/30 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Total Filled Orders</p>
              <p className="text-2xl font-bold">{fillRateData.totalOrders}</p>
            </div>
            <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/20">
              <p className="text-sm text-muted-foreground mb-1">Filled Within 5 Min</p>
              <p className="text-2xl font-bold text-green-400">{fillRateData.fillRate5Min.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{fillRateData.filledWithin5Min} orders</p>
            </div>
            <div className="bg-yellow-500/10 rounded-lg p-4 border border-yellow-500/20">
              <p className="text-sm text-muted-foreground mb-1">Filled Within 15 Min</p>
              <p className="text-2xl font-bold text-yellow-400">{fillRateData.fillRate15Min.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{fillRateData.filledWithin15Min} orders</p>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/20">
              <p className="text-sm text-muted-foreground mb-1">Filled Within 30 Min</p>
              <p className="text-2xl font-bold text-blue-400">{fillRateData.fillRate30Min.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{fillRateData.filledWithin30Min} orders</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium mb-2">By Strategy</h4>
              <div className="space-y-2">
                {Object.entries(fillRateData.byStrategy).map(([strategy, stats]: [string, any]) => (
                  <div key={strategy} className="bg-muted/30 rounded p-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{strategy}</span>
                      <span className="text-muted-foreground">{stats.total} orders</span>
                    </div>
                    <div className="flex gap-2 mt-1 text-xs">
                      <span className="text-green-400">≤5min: {((stats.within5 / stats.total) * 100).toFixed(0)}%</span>
                      <span className="text-yellow-400">≤15min: {((stats.within15 / stats.total) * 100).toFixed(0)}%</span>
                      <span className="text-blue-400">≤30min: {((stats.within30 / stats.total) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">By Symbol (Top 10)</h4>
              <div className="space-y-2">
                {Object.entries(fillRateData.bySymbol)
                  .sort(([, a]: [string, any], [, b]: [string, any]) => b.total - a.total)
                  .slice(0, 10)
                  .map(([symbol, stats]: [string, any]) => (
                    <div key={symbol} className="bg-muted/30 rounded p-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{symbol}</span>
                        <span className="text-muted-foreground">{stats.total} orders</span>
                      </div>
                      <div className="flex gap-2 mt-1 text-xs">
                        <span className="text-green-400">≤5min: {((stats.within5 / stats.total) * 100).toFixed(0)}%</span>
                        <span className="text-yellow-400">≤15min: {((stats.within15 / stats.total) * 100).toFixed(0)}%</span>
                        <span className="text-blue-400">≤30min: {((stats.within30 / stats.total) * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Aggressive Fill Mode & Actions */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={aggressiveFillMode}
                onCheckedChange={(checked) => setAggressiveFillMode(checked as boolean)}
                className="border-2 border-white/50 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
              />
              <span className="text-sm font-medium">🚀 Aggressive Fill Mode</span>
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGroupBySymbol(!groupBySymbol)}
              className="text-sm"
            >
              {groupBySymbol ? '📋 Table View' : '📊 Group by Symbol'}
            </Button>
            {selectedOrders.size > 0 && (
              <div className="text-sm text-muted-foreground">
                {selectedOrders.size} order{selectedOrders.size > 1 ? 's' : ''} selected
                {selectedOrders.size > 0 && ` • Cost to close: $${totalCostToClose.toFixed(2)}`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelSelected}
              disabled={selectedOrders.size === 0 || cancelOrdersMutation.isPending}
              className="border-red-500/50 hover:bg-red-500/20 text-red-400"
            >
              {cancelOrdersMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Cancel Selected ({selectedOrders.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (selectedOrders.size === 0) {
                  toast.error('Please select orders to replace');
                  return;
                }
                if (!safeToReplace) {
                  toast.error('Not safe to replace orders after 3:55 PM ET');
                  return;
                }
                setShowReplaceDialog(true);
              }}
              disabled={selectedOrders.size === 0 || !safeToReplace || replaceOrdersMutation.isPending}
              className="border-green-500/50 hover:bg-green-500/20 text-green-400"
            >
              {replaceOrdersMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Replace Selected ({selectedOrders.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFillNow}
              disabled={selectedOrders.size === 0 || !safeToReplace || replaceOrdersMutation.isPending}
              className="border-orange-500/50 hover:bg-orange-500/20 text-orange-400"
              title="Force immediate fills at ASK + $0.10 for selected orders (costs extra but guarantees fills)"
            >
              {replaceOrdersMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">🚀</span>
              )}
              Fill Now ({selectedOrders.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (summary.avgMinutesWorking < 120) {
                  toast.error('No orders have been working for >2 hours');
                  return;
                }
                autoCancelMutation.mutate({ accountId: selectedAccountId || '', minutesThreshold: 120 });
              }}
              disabled={autoCancelMutation.isPending}
              className="border-orange-500/50 hover:bg-orange-500/20 text-orange-400"
              title="Auto-cancel orders working >2 hours and resubmit at ask price"
            >
              {autoCancelMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">⏱️</span>
              )}
              Auto-Cancel Stuck Orders
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFillRateAnalytics(!showFillRateAnalytics)}
              className="border-blue-500/50 hover:bg-blue-500/20 text-blue-400"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              {showFillRateAnalytics ? 'Hide' : 'Show'} Fill Rate Analytics
            </Button>
          </div>
        </div>
      </Card>

      {/* Batch Actions by Symbol */}
      {groupBySymbol && orders.length > 0 && (() => {
        // Group orders by underlying symbol
        const ordersBySymbol = orders.reduce((acc: Record<string, typeof orders>, order) => {
          if (!acc[order.underlyingSymbol]) acc[order.underlyingSymbol] = [];
          acc[order.underlyingSymbol].push(order);
          return acc;
        }, {});

        return (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Batch Actions by Symbol</h3>
              <Button variant="ghost" size="sm" onClick={() => setGroupBySymbol(false)}>
                Show Table View
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(ordersBySymbol)
                .sort(([, a], [, b]) => b.length - a.length)
                .map(([symbol, symbolOrders]) => {
                  const totalValue = symbolOrders.reduce((sum, o) => sum + (o.suggestedPrice * o.quantity * 100), 0);
                  const needsReplacement = symbolOrders.filter(o => o.needsReplacement).length;
                  const avgMinutes = Math.round(symbolOrders.reduce((sum, o) => sum + o.minutesWorking, 0) / symbolOrders.length);

                  return (
                    <Card key={symbol} className="p-4 bg-gradient-to-br from-muted/50 to-muted/20 border-muted">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-lg font-bold">{symbol}</h4>
                          <p className="text-sm text-muted-foreground">{symbolOrders.length} order{symbolOrders.length > 1 ? 's' : ''}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Total Value</p>
                          <p className="text-lg font-bold">${totalValue.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                        <div className="bg-muted/30 rounded p-2">
                          <p className="text-muted-foreground">Needs Replace</p>
                          <p className="font-medium">{needsReplacement}</p>
                        </div>
                        <div className="bg-muted/30 rounded p-2">
                          <p className="text-muted-foreground">Avg Time</p>
                          <p className="font-medium">{avgMinutes}m</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-green-500/50 hover:bg-green-500/20 text-green-400"
                          onClick={() => {
                            if (!safeToReplace) {
                              toast.error('Not safe to replace orders after 3:55 PM ET');
                              return;
                            }
                            const ordersToReplace = symbolOrders.map(order => ({
                              orderId: String(order.orderId),
                              accountNumber: String(order.accountNumber),
                              symbol: order.symbol,
                              suggestedPrice: order.suggestedPrice,
                              rawOrder: order.rawOrder,
                            }));
                            replaceOrdersMutation.mutate({ orders: ordersToReplace });
                          }}
                          disabled={!safeToReplace || replaceOrdersMutation.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Replace All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-red-500/50 hover:bg-red-500/20 text-red-400"
                          onClick={() => {
                            const ordersToCancel = symbolOrders.map(order => ({
                              orderId: String(order.orderId),
                              accountNumber: String(order.accountNumber),
                              symbol: order.symbol,
                            }));
                            cancelOrdersMutation.mutate({ orders: ordersToCancel });
                          }}
                          disabled={cancelOrdersMutation.isPending}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Cancel All
                        </Button>
                      </div>
                    </Card>
                  );
                })}
            </div>
          </Card>
        );
      })()}

      {/* Working Orders Table */}
      {!groupBySymbol && (
        orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No working orders found</p>
        </Card>
      ) : (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-3 text-left">
                    <Checkbox
                      checked={selectedOrders.size === orders.length && orders.length > 0}
                      onCheckedChange={selectAll}
                      aria-label="Select all"
                      className="border-2 border-white/50 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                    />
                  </th>
                  <th className="p-3 text-left text-sm font-medium">Account</th>
                  <th className="p-3 text-left text-sm font-medium">Symbol</th>
                  <th className="p-3 text-left text-sm font-medium">Action</th>
                  <th className="p-3 text-right text-sm font-medium">Strike</th>
                  <th className="p-3 text-left text-sm font-medium">Exp</th>
                  <th className="p-3 text-right text-sm font-medium">Qty</th>
                  <th className="p-3 text-left text-sm font-medium">TIF</th>
                  <th className="p-3 text-right text-sm font-medium">Current</th>
                  <th className="p-3 text-right text-sm font-medium">Bid</th>
                  <th className="p-3 text-right text-sm font-medium">Ask</th>
                  <th className="p-3 text-right text-sm font-medium">Mid</th>
                  <th className="p-3 text-right text-sm font-medium">Spread</th>
                  <th className="p-3 text-right text-sm font-medium">Suggested</th>
                  <th className="p-3 text-left text-sm font-medium">Strategy</th>
                  <th className="p-3 text-right text-sm font-medium">Time Working</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        checked={selectedOrders.has(idx)}
                        onCheckedChange={() => toggleSelection(idx)}
                        aria-label={`Select ${order.symbol}`}
                        className="border-2 border-white/50 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                      />
                    </td>
                    <td className="p-3 text-sm">{order.accountNumber}</td>
                    <td className="p-3 text-sm font-medium">
                      <div>{order.underlyingSymbol}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.optionType} ${order.strike}
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      {(order as any).isSpread && (order as any).spreadType ? (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          (order as any).spreadType === 'bull_put' 
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                            : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        }`} title={(order as any).spreadType === 'bull_put' ? 'Bull Put Spread' : 'Bear Call Spread'}>
                          {(order as any).spreadType === 'bull_put' ? 'BPS' : 'BCS'}
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          order.action.toLowerCase().includes('buy') 
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        }`} title={order.action}>
                          {order.action.replace('Buy to Close', 'BTC').replace('Sell to Open', 'STO').replace('Sell to Close', 'STC').replace('Buy to Open', 'BTO')}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-sm text-right">
                      {(order as any).isSpread && (order as any).longStrike ? (
                        <span className={`${
                          (order as any).spreadType === 'bull_put' ? 'text-emerald-400' : 'text-orange-400'
                        }`}>
                          ${order.strike.toFixed(2)} / ${(order as any).longStrike.toFixed(2)}
                        </span>
                      ) : (
                        `$${order.strike.toFixed(2)}`
                      )}
                    </td>
                    <td className="p-3 text-sm">{order.expiration}</td>
                    <td className="p-3 text-sm text-right">{order.quantity}</td>
                    <td className="p-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${
                        order.timeInForce === 'GTC' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {order.timeInForce}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-right">${order.currentPrice.toFixed(2)}</td>
                    <td className="p-3 text-sm text-right">${order.bid.toFixed(2)}</td>
                    <td className="p-3 text-sm text-right">${order.ask.toFixed(2)}</td>
                    <td className="p-3 text-sm text-right">${order.mid.toFixed(2)}</td>
                    <td className="p-3 text-sm text-right">
                      <span className={`${
                        order.spread > 0.30 ? 'text-red-400' :
                        order.spread > 0.15 ? 'text-yellow-400' :
                        'text-green-400'
                      }`}>
                        ${order.spread.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-right">
                      <span className={`font-medium ${
                        order.needsReplacement ? 'text-yellow-400' : 'text-green-400'
                      }`}>
                        ${order.suggestedPrice.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground" title={order.strategy}>
                      <div className="max-w-[200px] truncate">
                        {order.strategy.length > 25 ? order.strategy.substring(0, 25) + '...' : order.strategy}
                      </div>
                    </td>
                    <td className="p-3 text-sm text-right">
                      <span className={`${
                        order.minutesWorking > 120 ? 'text-red-400' :
                        order.minutesWorking > 60 ? 'text-yellow-400' :
                        'text-green-400'
                      }`}>
                        {order.timeWorkingDisplay}
                      </span>
                      {order.needsReview && (
                        <span className="ml-2 text-xs text-red-400" title="5+ replacements">⚠️</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Selected Orders</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel {selectedOrders.size} order{selectedOrders.size > 1 ? 's' : ''}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {selectedOrdersList.map((order, idx) => (
              <div key={idx} className="p-2 bg-muted rounded text-sm">
                <span className="font-medium">{order.underlyingSymbol}</span> {order.optionType} ${order.strike} - {order.expiration}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={cancelOrdersMutation.isPending}>
              {cancelOrdersMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Canceling...
                </>
              ) : (
                'Confirm Cancel'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fill Now Confirmation Dialog */}
      <Dialog open={showFillNowDialog} onOpenChange={setShowFillNowDialog}>
        <DialogContent className="max-w-fit w-auto max-h-[80vh] overflow-y-auto border-2 border-[#FF8C00]" style={{ maxWidth: 'calc(100vw - 4rem)' }}>
          <DialogHeader>
            <DialogTitle>🚀 Confirm Fill Now Order</DialogTitle>
            <DialogDescription>
              Force immediate fills at ASK + $0.10 for {selectedOrders.size} selected order{selectedOrders.size > 1 ? 's' : ''}.
              This guarantees fills but costs extra.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Pricing Details Table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-medium">Symbol</th>
                    <th className="p-2 text-left font-medium">Action</th>
                    <th className="p-2 text-right font-medium">Current</th>
                    <th className="p-2 text-right font-medium">Ask</th>
                    <th className="p-2 text-right font-medium">Fill Now Price</th>
                    <th className="p-2 text-right font-medium">Extra Cost</th>
                    <th className="p-2 text-right font-medium">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(selectedOrders).map(idx => {
                    const order = orders[idx];
                    const fillNowPrice = order.ask + 0.10;
                    const extraCost = 0.10 * order.quantity * 100;
                    const totalCost = fillNowPrice * order.quantity * 100;
                    const isBuyOrder = order.action.toLowerCase().includes('buy');
                    
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-2">
                          <div className="font-medium">{order.underlyingSymbol}</div>
                          <div className="text-xs text-muted-foreground">{order.optionType} ${order.strike}</div>
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            isBuyOrder
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}>
                            {order.action.replace('Buy to Close', 'BTC').replace('Sell to Open', 'STO').replace('Sell to Close', 'STC').replace('Buy to Open', 'BTO')}
                          </span>
                        </td>
                        <td className="p-2 text-right text-muted-foreground">${order.currentPrice.toFixed(2)}</td>
                        <td className="p-2 text-right">${order.ask.toFixed(2)}</td>
                        <td className="p-2 text-right">
                          <div className="font-bold text-orange-400">${fillNowPrice.toFixed(2)}</div>
                          <div className="text-xs text-red-400">+$0.10</div>
                        </td>
                        <td className="p-2 text-right text-red-400 font-medium">
                          ${extraCost.toFixed(2)}
                        </td>
                        <td className="p-2 text-right font-bold">
                          ${totalCost.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cost Warning Summary */}
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Orders:</span>
                <span className="font-medium">{selectedOrders.size}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Extra Cost (vs ASK):</span>
                <span className="font-bold text-red-400">
                  ${(Array.from(selectedOrders).map(idx => orders[idx]).reduce((sum, o) => sum + (0.10 * o.quantity * 100), 0)).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t border-orange-500/30 pt-2 mt-2">
                <span className="text-muted-foreground">Total Cost to Close:</span>
                <span className="font-bold text-lg text-orange-400">
                  ${(Array.from(selectedOrders).map(idx => orders[idx]).reduce((sum, o) => sum + ((o.ask + 0.10) * o.quantity * 100), 0)).toFixed(2)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-orange-500/30">
                ⚠️ <strong>Fill Now Strategy:</strong> Uses ASK + $0.10 to guarantee immediate fills. You pay extra for certainty.
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFillNowDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={confirmFillNow} 
              disabled={replaceOrdersMutation.isPending}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {replaceOrdersMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <span className="mr-2">🚀</span>
                  Confirm Fill Now
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Confirmation Dialog with Detailed Pricing */}
      <Dialog open={showReplaceDialog} onOpenChange={setShowReplaceDialog}>
        <DialogContent className="max-w-fit w-auto max-h-[80vh] overflow-y-auto border-2 border-[#FF8C00]" style={{ maxWidth: 'calc(100vw - 4rem)' }}>
          <DialogHeader>
            <DialogTitle>Confirm Order Replacement</DialogTitle>
            <DialogDescription>
              Review pricing details before replacing {selectedOrders.size > 0 ? selectedOrders.size : summary.needsReplacement} order{(selectedOrders.size > 0 ? selectedOrders.size : summary.needsReplacement) > 1 ? 's' : ''}.
              {aggressiveFillMode && ' (Aggressive Fill Mode enabled)'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Pricing Details Table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-medium">Symbol</th>
                    <th className="p-2 text-left font-medium">Action</th>
                    <th className="p-2 text-right font-medium">Current</th>
                    <th className="p-2 text-right font-medium">Bid</th>
                    <th className="p-2 text-right font-medium">Ask</th>
                    <th className="p-2 text-right font-medium">Mid</th>
                    <th className="p-2 text-right font-medium">Suggested</th>
                    <th className="p-2 text-left font-medium">Price Effect</th>
                    <th className="p-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedOrders.size > 0 
                    ? Array.from(selectedOrders).map(idx => orders[idx])
                    : orders.filter(o => o.needsReplacement)
                  ).map((order, idx) => {
                    const isBuyOrder = order.action.toLowerCase().includes('buy');
                    const priceEffect = isBuyOrder ? 'Debit' : 'Credit';
                    const cost = order.suggestedPrice * order.quantity * 100;
                    
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-2">
                          <div className="font-medium">{order.underlyingSymbol}</div>
                          <div className="text-xs text-muted-foreground">{order.optionType} ${order.strike}</div>
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            isBuyOrder
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}>
                            {order.action.replace('Buy to Close', 'BTC').replace('Sell to Open', 'STO').replace('Sell to Close', 'STC').replace('Buy to Open', 'BTO')}
                          </span>
                        </td>
                        <td className="p-2 text-right text-muted-foreground">${order.currentPrice.toFixed(2)}</td>
                        <td className="p-2 text-right">${order.bid.toFixed(2)}</td>
                        <td className="p-2 text-right font-medium text-yellow-400">${order.ask.toFixed(2)}</td>
                        <td className="p-2 text-right">${order.mid.toFixed(2)}</td>
                        <td className="p-2 text-right">
                          <div className="font-bold text-green-400">${order.suggestedPrice.toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">
                            {order.currentPrice !== order.suggestedPrice && (
                              <span className={order.suggestedPrice > order.currentPrice ? 'text-red-400' : 'text-green-400'}>
                                {order.suggestedPrice > order.currentPrice ? '+' : ''}
                                ${(order.suggestedPrice - order.currentPrice).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            priceEffect === 'Debit'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : 'bg-green-500/20 text-green-400 border border-green-500/30'
                          }`}>
                            {priceEffect}
                          </span>
                        </td>
                        <td className="p-2 text-right font-medium">
                          ${cost.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Orders:</span>
                <span className="font-medium">{selectedOrders.size > 0 ? selectedOrders.size : summary.needsReplacement}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Cost to Close:</span>
                <span className="font-bold text-lg">
                  ${(selectedOrders.size > 0 
                    ? Array.from(selectedOrders).map(idx => orders[idx]).reduce((sum, o) => sum + (o.suggestedPrice * o.quantity * 100), 0)
                    : orders.filter(o => o.needsReplacement).reduce((sum, o) => sum + (o.suggestedPrice * o.quantity * 100), 0)
                  ).toFixed(2)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
                💡 <strong>Price Strategy:</strong> BTC orders use ASK price for immediate fills. Debit = you pay money.
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReplaceDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmReplace} disabled={replaceOrdersMutation.isPending}>
              {replaceOrdersMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Replacing...
                </>
              ) : (
                'Confirm Replace'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* UnifiedOrderPreviewModal for Replace Mode */}
      <UnifiedOrderPreviewModal
        open={unifiedModalOpen}
        onOpenChange={setUnifiedModalOpen}
        orders={unifiedModalOrders}
        strategy="csp" // Strategy doesn't matter for replace mode
        operationMode="replace"
        oldOrderIds={oldOrderIds}
        accountId={selectedAccountId || ''}
        availableBuyingPower={0} // Not needed for replace mode
        onSubmit={async () => ({ results: [] })} // Not used in replace mode
        onReplaceSubmit={handleReplaceSubmit}
        tradingMode={tradingMode}
      />

      {/* Replacement Log Panel */}
      {actionResults && actionResults.results && actionResults.results.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Replacement Log</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActionResults(null)}
            >
              Clear
            </Button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {actionResults.results.map((result: any, idx: number) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border ${
                  result.success
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="font-medium">{result.symbol}</span>
                      
                      {/* Status Badge - updates in real-time */}
                      {result.success && result.newOrderId && (
                        result.orderStatus === 'Filled' ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                            Filled ✓
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
                            Working
                          </Badge>
                        )
                      )}
                      {!result.success && (
                        <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                          Canceled
                        </Badge>
                      )}
                      
                      <span className="text-xs text-muted-foreground">
                        {new Date().toLocaleTimeString()}
                      </span>
                    </div>
                    {result.success ? (
                      <div className="text-sm text-muted-foreground">
                        {actionResults.action === 'cancel' ? 'Order cancelled successfully' : 'Order submitted successfully (now working)'}
                        {result.oldPrice && result.newPrice && (
                          <span className="ml-2">
                            ${result.oldPrice.toFixed(2)} → ${result.newPrice.toFixed(2)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-red-400">
                        {result.error || 'Failed to replace order'}
                      </div>
                    )}
                  </div>
                  {result.orderId && (
                    <div className="text-xs text-muted-foreground">
                      Order #{result.orderId.slice(0, 8)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Summary</span>
              <div className="flex items-center gap-4">
                <span className="text-green-400">
                  ✓ {actionResults.successCount} succeeded
                </span>
                {actionResults.failedCount > 0 && (
                  <span className="text-red-400">
                    ✗ {actionResults.failedCount} failed
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Transform paper trading performance data to match the overview format
 */
function transformPaperDataToOverview(paperData: any[]) {
  if (!paperData || paperData.length === 0) return null;

  const monthlyData = paperData.map((m: any) => {
    const [year, monthNum] = m.month.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[parseInt(monthNum) - 1];
    
    return {
      month: m.month,
      monthKey: m.month,
      monthName: `${monthName} ${year}`,
      netPremium: m.netPremium / 100, // Convert cents to dollars
      cumulativeTotal: m.cumulativeTotal / 100,
      totalCredits: m.netPremium / 100, // Simplified for paper trading
      totalDebits: 0,
      totalNet: m.netPremium / 100, // Net premium for the month
      cspNet: m.netPremium / 100 * 0.6, // Assume 60% CSP
      cspCredits: m.netPremium / 100 * 0.6,
      cspDebits: 0,
      ccNet: m.netPremium / 100 * 0.4, // Assume 40% CC
      ccCredits: m.netPremium / 100 * 0.4,
      ccDebits: 0,
      cspTrades: 8,
      ccTrades: 5,
      assignments: 0,
      calledAway: 0,
    };
  });

  const lastMonth = monthlyData[monthlyData.length - 1];
  const totals = {
    totalCredits: lastMonth.cumulativeTotal,
    totalDebits: 0,
    totalNet: lastMonth.cumulativeTotal,
    cspNet: lastMonth.cumulativeTotal * 0.6,
    cspCredits: lastMonth.cumulativeTotal * 0.6,
    cspDebits: 0,
    ccNet: lastMonth.cumulativeTotal * 0.4,
    ccCredits: lastMonth.cumulativeTotal * 0.4,
    ccDebits: 0,
    cspTrades: monthlyData.length * 8,
    ccTrades: monthlyData.length * 5,
    assignments: 0,
    calledAway: 0,
  };

  return {
    monthlyData,
    symbolPerformance: [], // No symbol breakdown for paper trading
    performanceMetrics: {
      avgMonthlyPremium: totals.totalNet / monthlyData.length,
      bestMonth: monthlyData.reduce((best: any, m: any) => 
        !best || m.netPremium > best.value ? { month: m.monthName, value: m.netPremium } : best, 
        null
      ),
      worstMonth: monthlyData.reduce((worst: any, m: any) => 
        !worst || m.netPremium < worst.value ? { month: m.monthName, value: m.netPremium } : worst, 
        null
      ),
      winRate: 85, // Mock win rate
      avgLoss: 0, // No losses in paper trading mock data
      avgWin: totals.totalNet / monthlyData.length, // Average monthly premium
      profitFactor: 0, // No losses to calculate profit factor
      closedTrades: monthlyData.length * 13, // Mock closed trades (8 CSP + 5 CC per month)
      wins: Math.round(monthlyData.length * 13 * 0.85), // 85% win rate
      losses: Math.round(monthlyData.length * 13 * 0.15), // 15% loss rate
    },
    assignmentImpact: {
      totalAssignments: 0,
      totalCalledAway: 0,
      assignmentCost: 0,
      calledAwayRevenue: 0,
      netImpact: 0,
      successfulRecoveries: 0,
      capitalTiedUp: 0,
      avgDaysHolding: 0,
      recoveryRate: 0,
    },
    totals,
    dateRange: {
      firstMonth: monthlyData[0].month,
      lastMonth: monthlyData[monthlyData.length - 1].month,
      monthsWithActivity: monthlyData.length,
    },
  };
}

function PerformanceOverviewTab() {
  const { mode: tradingMode } = useTradingMode();
  const { selectedAccountId } = useAccount();
  const [timePeriod, setTimePeriod] = useState<'3m' | '6m' | 'ytd' | 'all'>('all');
  const [monthsBack, setMonthsBack] = useState(12);
  const [monthlySortKey, setMonthlySortKey] = useState<string | null>(null);
  const [monthlySortDir, setMonthlySortDir] = useState<'asc' | 'desc'>('desc');
  const [symbolSortKey, setSymbolSortKey] = useState<string>('netPremium');
  const [symbolSortDir, setSymbolSortDir] = useState<'asc' | 'desc'>('desc');

  // Calculate monthsBack based on time period
  const calculateMonthsBack = (period: '3m' | '6m' | 'ytd' | 'all') => {
    if (period === '3m') return 3;
    if (period === '6m') return 6;
    if (period === 'ytd') {
      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const monthsDiff = (now.getFullYear() - yearStart.getFullYear()) * 12 + (now.getMonth() - yearStart.getMonth());
      return Math.max(1, monthsDiff + 1);
    }
    return 24; // All time (capped at 24 months per backend validation)
  };

  // Update monthsBack when time period changes
  useEffect(() => {
    setMonthsBack(calculateMonthsBack(timePeriod));
  }, [timePeriod]);

  // Fetch paper trading performance data
  const { data: paperData, isLoading: paperLoading } = trpc.paperTrading.getPerformanceData.useQuery(
    undefined,
    {
      enabled: tradingMode === 'paper',
      refetchOnWindowFocus: false,
    }
  );

  // Fetch live performance overview data
  const { data: liveData, isLoading: liveLoading, refetch, error } = trpc.performance.getPerformanceOverview.useQuery(
    {
      accountId: selectedAccountId || '',
      monthsBack,
    },
    {
      enabled: tradingMode === 'live' && !!selectedAccountId,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );

  // Use paper data if in paper mode, otherwise use live data
  const isLoading = tradingMode === 'paper' ? paperLoading : liveLoading;
  const data = tradingMode === 'paper' ? (paperData ? transformPaperDataToOverview(paperData) : null) : liveData;

  if (tradingMode === 'live' && !selectedAccountId) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">Please select an account to view performance overview</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-red-400">Error loading performance data: {error.message}</p>
        <Button onClick={() => refetch()} className="mt-4">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-400" />
        <p className="text-muted-foreground">Loading performance data...</p>
      </Card>
    );
  }

  if (!data || data.monthlyData.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No transaction history found for the selected period</p>
        <p className="text-sm text-muted-foreground mt-2">
          Try selecting a different time range or account
        </p>
      </Card>
    );
  }

  const { monthlyData, symbolPerformance, performanceMetrics, totals, dateRange } = data;

  // Sorting helper
  const handleMonthlySort = (key: string) => {
    if (monthlySortKey === key) {
      setMonthlySortDir(monthlySortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setMonthlySortKey(key);
      setMonthlySortDir('desc');
    }
  };

  const handleSymbolSort = (key: string) => {
    if (symbolSortKey === key) {
      setSymbolSortDir(symbolSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSymbolSortKey(key);
      setSymbolSortDir('desc');
    }
  };

  // Sort monthly data
  const sortedMonthlyData = monthlySortKey
    ? [...monthlyData].sort((a: any, b: any) => {
        const aVal = a[monthlySortKey];
        const bVal = b[monthlySortKey];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return monthlySortDir === 'asc' ? comparison : -comparison;
      })
    : monthlyData;

  // Sort symbol performance
  const sortedSymbolPerformance = [...symbolPerformance].sort((a: any, b: any) => {
    const aVal = a[symbolSortKey];
    const bVal = b[symbolSortKey];
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return symbolSortDir === 'asc' ? comparison : -comparison;
  });

  // Calculate retention percentage
  const retentionPercent = totals.totalCredits > 0 
    ? ((totals.totalNet / totals.totalCredits) * 100).toFixed(1)
    : '0.0';

  // Calculate CSP and CC percentages of total
  const cspPercent = totals.totalNet > 0 
    ? ((totals.cspNet / totals.totalNet) * 100).toFixed(1)
    : '0.0';
  const ccPercent = totals.totalNet > 0 
    ? ((totals.ccNet / totals.totalNet) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-6">
      {/* Paper Trading Disclaimer */}
      {tradingMode === 'paper' && (
        <Card className="p-4 bg-blue-500/10 border-blue-500/30">
          <div className="flex items-start gap-3">
            <div className="text-blue-400 mt-0.5">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-blue-400 mb-1">Sample Performance Data</h3>
              <p className="text-sm text-muted-foreground">
                You're viewing simulated performance data for demonstration purposes. This data shows 9 months of realistic premium earnings to help you understand how the performance tracking works. Switch to Live mode and connect your brokerage account to see your actual trading performance.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Header with Time Period Selector and Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Performance Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {dateRange.firstMonth} - {dateRange.lastMonth} ({dateRange.monthsWithActivity} months with activity)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={timePeriod}
            onChange={(e) => setTimePeriod(e.target.value as '3m' | '6m' | 'ytd' | 'all')}
            className="px-3 py-2 bg-card border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="3m">Last 3 Months</option>
            <option value="6m">Last 6 Months</option>
            <option value="ytd">Year to Date</option>
            <option value="all">All Time</option>
          </select>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Total Credits */}
        <Card className="p-4 bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Total Credits</p>
            <p className="text-2xl font-bold text-green-400">
              ${totals.totalCredits.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              {totals.cspTrades + totals.ccTrades} trades opened
            </p>
          </div>
        </Card>

        {/* Total Debits */}
        <Card className="p-4 bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Total Debits</p>
            <p className="text-2xl font-bold text-red-400">
              ${totals.totalDebits.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              Closing costs
            </p>
          </div>
        </Card>

        {/* NET Premium */}
        <Card className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">NET Premium</p>
            <p className="text-2xl font-bold text-blue-400">
              ${totals.totalNet.toFixed(2)}
            </p>
            <p className="text-xs text-green-400">
              {retentionPercent}% retention
            </p>
          </div>
        </Card>

        {/* CSP Premium */}
        <Card className="p-4 bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">CSP Premium</p>
            <p className="text-2xl font-bold text-purple-400">
              ${totals.cspNet.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              {cspPercent}% of total
            </p>
          </div>
        </Card>

        {/* CC Premium */}
        <Card className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">CC Premium</p>
            <p className="text-2xl font-bold text-amber-400">
              ${totals.ccNet.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              {ccPercent}% of total
            </p>
          </div>
        </Card>
      </div>

      {/* Assignment Impact Analysis Card */}
      <Card className="p-6 bg-gradient-to-br from-rose-500/10 to-rose-600/5 border-rose-500/20">
        <h3 className="text-lg font-semibold mb-4">🎯 Assignment Impact Analysis</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total Assignments</p>
            <p className="text-xl font-bold text-rose-400">
              {data.assignmentImpact.totalAssignments}
            </p>
            <p className="text-xs text-muted-foreground">
              CSP assignments
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Avg Days Holding</p>
            <p className="text-xl font-bold text-amber-400">
              {data.assignmentImpact.avgDaysHolding}
            </p>
            <p className="text-xs text-muted-foreground">
              days until called away
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Recovery Rate</p>
            <p className="text-xl font-bold text-green-400">
              {data.assignmentImpact.recoveryRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              {data.assignmentImpact.successfulRecoveries}/{data.assignmentImpact.totalAssignments} successful
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Capital Tied Up</p>
            <p className="text-xl font-bold text-red-400">
              ${data.assignmentImpact.capitalTiedUp.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              in assigned positions
            </p>
          </div>
        </div>
      </Card>

      {/* Performance Metrics Card (Phase 2) */}
      <Card className="p-6 bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border-indigo-500/20">
        <h3 className="text-lg font-semibold mb-4">📊 Performance Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Win Rate</p>
            <p className="text-xl font-bold text-indigo-400">
              {performanceMetrics.winRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              {performanceMetrics.wins}/{performanceMetrics.closedTrades} closed
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Avg Win</p>
            <p className="text-xl font-bold text-green-400">
              ${performanceMetrics.avgWin.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Avg Loss</p>
            <p className="text-xl font-bold text-red-400">
              ${performanceMetrics.avgLoss.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Profit Factor</p>
            <p className="text-xl font-bold text-blue-400">
              {performanceMetrics.profitFactor.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Best Month</p>
            <p className="text-xl font-bold text-green-400">
              ${performanceMetrics.bestMonth?.value.toFixed(2) || '0.00'}
            </p>
            <p className="text-xs text-muted-foreground">
              {performanceMetrics.bestMonth?.month || 'N/A'}
            </p>
          </div>
        </div>
      </Card>

      {/* Premium Earnings Chart */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Premium Earnings Over Time</h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={(() => {
              const reversed = [...monthlyData].reverse();
              let cumulative = 0;
              return reversed.map(m => {
                cumulative += m.totalNet;
                return { ...m, cumulativeNet: cumulative };
              });
            })()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis 
                dataKey="monthName" 
                stroke="#888"
                tick={{ fill: '#888', fontSize: 12 }}
              />
              <YAxis 
                yAxisId="left"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 12 }}
                label={{ value: 'Monthly Net ($)', angle: -90, position: 'insideLeft', fill: '#888' }}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                stroke="#888"
                tick={{ fill: '#888', fontSize: 12 }}
                label={{ value: 'Cumulative ($)', angle: 90, position: 'insideRight', fill: '#888' }}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
              <Legend />
              <Bar 
                yAxisId="left"
                dataKey="totalNet" 
                name="Monthly Net Premium"
                radius={[4, 4, 0, 0]}
              >
                {(() => {
                  const reversed = [...monthlyData].reverse();
                  let cumulative = 0;
                  return reversed.map(m => {
                    cumulative += m.totalNet;
                    return { ...m, cumulativeNet: cumulative };
                  });
                })().map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.totalNet >= 0 ? '#10b981' : '#ef4444'} />
                ))}
                <LabelList 
                  dataKey="totalNet" 
                  position="insideTop" 
                  formatter={(value: number) => `$${value.toFixed(0)}`}
                  style={{ fill: '#fff', fontSize: 13, fontWeight: 'bold' }}
                  offset={10}
                />
              </Bar>
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="cumulativeNet"
                stroke="#3b82f6" 
                strokeWidth={3}
                name="Cumulative Premium"
                dot={{ fill: '#3b82f6', r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Strategy Performance Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 text-purple-400">CSP Performance</h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...monthlyData].reverse().slice(-6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis 
                  dataKey="monthName" 
                  stroke="#888"
                  tick={{ fill: '#888', fontSize: 11 }}
                />
                <YAxis 
                  stroke="#888"
                  tick={{ fill: '#888', fontSize: 11 }}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Bar 
                  dataKey="cspNet" 
                  name="CSP Net Premium"
                  radius={[4, 4, 0, 0]}
                >
                  {[...monthlyData].reverse().slice(-6).map((entry, index) => (
                    <Cell key={`cell-csp-${index}`} fill={entry.cspNet >= 0 ? '#a855f7' : '#ef4444'} />
                  ))}
                  <LabelList 
                    dataKey="cspNet" 
                    position="insideTop" 
                    formatter={(value: number) => `$${value.toFixed(0)}`}
                    style={{ fill: '#fff', fontSize: 12, fontWeight: 'bold' }}
                    offset={8}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Trades</span>
              <span className="font-semibold">{totals.cspTrades}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Premium</span>
              <span className="font-semibold text-green-400">${totals.cspNet.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg/Trade</span>
              <span className="font-semibold">
                ${totals.cspTrades > 0 ? (totals.cspNet / totals.cspTrades).toFixed(2) : '0.00'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Assignments</span>
              <span className="font-semibold">{totals.assignments}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 text-amber-400">CC Performance</h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...monthlyData].reverse().slice(-6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis 
                  dataKey="monthName" 
                  stroke="#888"
                  tick={{ fill: '#888', fontSize: 11 }}
                />
                <YAxis 
                  stroke="#888"
                  tick={{ fill: '#888', fontSize: 11 }}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Bar 
                  dataKey="ccNet" 
                  name="CC Net Premium"
                  radius={[4, 4, 0, 0]}
                >
                  {[...monthlyData].reverse().slice(-6).map((entry, index) => (
                    <Cell key={`cell-cc-${index}`} fill={entry.ccNet >= 0 ? '#f59e0b' : '#ef4444'} />
                  ))}
                  <LabelList 
                    dataKey="ccNet" 
                    position="insideTop" 
                    formatter={(value: number) => `$${value.toFixed(0)}`}
                    style={{ fill: '#fff', fontSize: 12, fontWeight: 'bold' }}
                    offset={8}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Trades</span>
              <span className="font-semibold">{totals.ccTrades}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Premium</span>
              <span className="font-semibold text-green-400">${totals.ccNet.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg/Trade</span>
              <span className="font-semibold">
                ${totals.ccTrades > 0 ? (totals.ccNet / totals.ccTrades).toFixed(2) : '0.00'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Called Away</span>
              <span className="font-semibold">{totals.calledAway}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Monthly Breakdown Table */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Monthly Breakdown</h3>
          <button
            onClick={() => {
              const csv = [
                ['Month', 'CSP Credits', 'CSP Debits', 'CSP Net', 'CC Credits', 'CC Debits', 'CC Net', 'Total Net', 'Assignments'].join(','),
                ...sortedMonthlyData.map(m => [
                  m.monthName,
                  m.cspCredits.toFixed(2),
                  m.cspDebits.toFixed(2),
                  m.cspNet.toFixed(2),
                  m.ccCredits.toFixed(2),
                  m.ccDebits.toFixed(2),
                  m.ccNet.toFixed(2),
                  m.totalNet.toFixed(2),
                  m.assignments
                ].join(','))
              ].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `monthly-breakdown-${new Date().toISOString().split('T')[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success('Monthly breakdown exported to CSV');
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th 
                  className="text-left py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('monthName')}
                >
                  Month {monthlySortKey === 'monthName' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('cspCredits')}
                >
                  CSP Credits {monthlySortKey === 'cspCredits' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('cspDebits')}
                >
                  CSP Debits {monthlySortKey === 'cspDebits' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('cspNet')}
                >
                  CSP Net {monthlySortKey === 'cspNet' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('ccCredits')}
                >
                  CC Credits {monthlySortKey === 'ccCredits' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('ccDebits')}
                >
                  CC Debits {monthlySortKey === 'ccDebits' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('ccNet')}
                >
                  CC Net {monthlySortKey === 'ccNet' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('totalNet')}
                >
                  Total Net {monthlySortKey === 'totalNet' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleMonthlySort('cspTrades')}
                >
                  Trades {monthlySortKey === 'cspTrades' && (monthlySortDir === 'asc' ? '↑' : '↓')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedMonthlyData.map((month) => (
                <tr key={month.monthKey} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="py-2 px-2 text-sm">{month.monthName}</td>
                  <td className="py-2 px-2 text-sm text-right text-green-400">
                    ${month.cspCredits.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right text-red-400">
                    ${month.cspDebits.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right font-semibold">
                    ${month.cspNet.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right text-green-400">
                    ${month.ccCredits.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right text-red-400">
                    ${month.ccDebits.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right font-semibold">
                    ${month.ccNet.toFixed(2)}
                  </td>
                  <td className={`py-2 px-2 text-sm text-right font-bold ${
                    month.totalNet > 0 ? 'text-green-400' : month.totalNet < 0 ? 'text-red-400' : ''
                  }`}>
                    ${month.totalNet.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right text-muted-foreground">
                    {month.cspTrades + month.ccTrades}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Symbol Performance Table (Phase 3) */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Top Performers by Symbol</h3>
          <button
            onClick={() => {
              const csv = [
                ['Symbol', 'Trades', 'Net Premium', 'Win Rate', 'Avg/Trade', 'CSP Trades', 'CC Trades', 'Recommendation'].join(','),
                ...sortedSymbolPerformance.map((s: any) => [
                  s.symbol,
                  s.trades,
                  s.netPremium.toFixed(2),
                  `${s.winRate.toFixed(1)}%`,
                  s.avgPremiumPerTrade.toFixed(2),
                  s.cspTrades,
                  s.ccTrades,
                  s.winRate < 50 ? 'AVOID' : 'OK'
                ].join(','))
              ].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `symbol-performance-${new Date().toISOString().split('T')[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success('Symbol performance exported to CSV');
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th 
                  className="text-left py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('symbol')}
                >
                  Symbol {symbolSortKey === 'symbol' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('trades')}
                >
                  Trades {symbolSortKey === 'trades' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('netPremium')}
                >
                  Net Premium {symbolSortKey === 'netPremium' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('winRate')}
                >
                  Win Rate {symbolSortKey === 'winRate' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('avgPremiumPerTrade')}
                >
                  Avg/Trade {symbolSortKey === 'avgPremiumPerTrade' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('cspTrades')}
                >
                  CSP {symbolSortKey === 'cspTrades' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="text-right py-2 px-2 text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onClick={() => handleSymbolSort('ccTrades')}
                >
                  CC {symbolSortKey === 'ccTrades' && (symbolSortDir === 'asc' ? '↑' : '↓')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSymbolPerformance.slice(0, 20).map((symbol) => (
                <tr key={symbol.symbol} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="py-2 px-2 text-sm font-semibold">
                    {symbol.symbol}
                    {symbol.winRate < 50 && symbol.losses > 0 && (
                      <span className="ml-2 text-xs text-red-400">⚠️ AVOID</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-sm text-right">{symbol.trades}</td>
                  <td className={`py-2 px-2 text-sm text-right font-semibold ${
                    symbol.netPremium > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    ${symbol.netPremium.toFixed(2)}
                  </td>
                  <td className={`py-2 px-2 text-sm text-right ${
                    symbol.winRate >= 70 ? 'text-green-400' : 
                    symbol.winRate >= 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {symbol.winRate.toFixed(1)}%
                  </td>
                  <td className="py-2 px-2 text-sm text-right">
                    ${symbol.avgPremiumPerTrade.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-sm text-right text-muted-foreground">
                    {symbol.cspTrades}
                  </td>
                  <td className="py-2 px-2 text-sm text-right text-muted-foreground">
                    {symbol.ccTrades}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Expiration Calendar */}
      <ExpirationCalendarSection selectedAccountId={selectedAccountId} />
    </div>
  );
}

// Expiration Calendar Component
function ExpirationCalendarSection({ selectedAccountId }: { selectedAccountId: string | null }) {
  const { data, isLoading } = trpc.performance.getExpirationCalendar.useQuery(
    { accountId: selectedAccountId || '' },
    { enabled: !!selectedAccountId, refetchOnWindowFocus: false }
  );

  if (!selectedAccountId || isLoading) {
    return null;
  }

  if (!data || data.expirations.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Upcoming Expirations</h3>
        <p className="text-sm text-muted-foreground">No upcoming option expirations</p>
      </Card>
    );
  }

  const { expirations, weeklyClusterWarnings, totalUpcomingContracts } = data;

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Upcoming Expirations</h3>
        <div className="text-sm text-muted-foreground">
          {totalUpcomingContracts} contracts across {expirations.length} dates
        </div>
      </div>

      {/* Clustering Warnings */}
      {weeklyClusterWarnings.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
          <p className="text-sm font-semibold text-yellow-400 mb-2">⚠️ Clustering Warnings</p>
          {weeklyClusterWarnings.map((warning, idx) => (
            <p key={idx} className="text-xs text-muted-foreground">
              Week of {new Date(warning.week).toLocaleDateString()}: {warning.count} contracts expiring
            </p>
          ))}
        </div>
      )}

      {/* Expiration Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-sm font-semibold">Date</th>
              <th className="text-right py-2 px-2 text-sm font-semibold">Contracts</th>
              <th className="text-right py-2 px-2 text-sm font-semibold">Symbols</th>
              <th className="text-left py-2 px-2 text-sm font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {expirations.slice(0, 20).map((exp, idx) => (
              <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2 px-2 text-sm font-semibold">
                  {new Date(exp.date).toLocaleDateString()}
                  {exp.clustered && <span className="ml-2 text-xs text-yellow-400">⚠️</span>}
                </td>
                <td className="py-2 px-2 text-sm text-right">{exp.totalContracts}</td>
                <td className="py-2 px-2 text-sm text-right">{exp.uniqueSymbols}</td>
                <td className="py-2 px-2 text-xs text-muted-foreground">
                  {exp.positions.slice(0, 3).map((p: any) => `${p.symbol} ${p.type}`).join(', ')}
                  {exp.positions.length > 3 && ` +${exp.positions.length - 3} more`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}


// Stock Basis Tab Component
function StockBasisTab() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { data: positionsData, isLoading: positionsLoading, refetch: refetchPositions } = trpc.stockBasis.getStockPositions.useQuery();
  const { data: premiumsData, isLoading: premiumsLoading, refetch: refetchPremiums } = trpc.stockBasis.getCCPremiums.useQuery({ lookbackDays: 365 });
  const { data: recoveryData, isLoading: recoveryLoading, refetch: refetchRecovery } = trpc.stockBasis.getRecoveryMetrics.useQuery();

  const positions = positionsData?.positions || [];
  const premiums = premiumsData?.premiums || {};

  // Calculate summary metrics
  const totalCostBasis = positions.reduce((sum, pos) => sum + pos.costBasis, 0);
  const totalCurrentValue = positions.reduce((sum, pos) => sum + pos.marketValue, 0);
  const totalUnrealized = totalCurrentValue - totalCostBasis;
  const totalUnrealizedPct = totalCostBasis > 0 ? (totalUnrealized / totalCostBasis) * 100 : 0;
  const totalCCPremium = Object.values(premiums).reduce((sum, val) => sum + val, 0);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchPositions(), refetchPremiums(), refetchRecovery()]);
    setIsRefreshing(false);
  };

  const isLoading = positionsLoading || premiumsLoading || recoveryLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Stock Basis & Returns</h2>
          <p className="text-muted-foreground mt-1">
            Track your assigned stock positions and covered call recovery progress
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={isRefreshing}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh Data
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <DollarSign className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Cost Basis</p>
              <p className="text-2xl font-bold">${totalCostBasis.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 rounded-lg">
              <Package className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Value</p>
              <p className="text-2xl font-bold">${totalCurrentValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${totalUnrealized >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              {totalUnrealized >= 0 ? (
                <TrendingUpIcon className="h-6 w-6 text-green-500" />
              ) : (
                <TrendingDownIcon className="h-6 w-6 text-red-500" />
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unrealized Gain</p>
              <p className="text-2xl font-bold">
                ${Math.abs(totalUnrealized).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className={`text-sm ${totalUnrealized >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {totalUnrealizedPct >= 0 ? '+' : ''}{totalUnrealizedPct.toFixed(1)}%
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <DollarSign className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Premium Earned</p>
              <p className="text-2xl font-bold">${totalCCPremium.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recovery Progress Chart */}
      {!isLoading && recoveryData && recoveryData.numUnderwater > 0 && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">📊 Recovery Progress by Position</h2>
          <p className="text-sm text-muted-foreground mb-6">
            <span className="font-semibold text-green-500">Green</span> = CC Premium recovered toward breakeven | <span className="font-semibold text-red-500">Red</span> = Remaining underwater amount
          </p>
          <RecoveryProgressChart data={recoveryData.underwaterPositions} />
        </Card>
      )}

      {!isLoading && recoveryData && recoveryData.numUnderwater === 0 && (
        <Card className="p-6 bg-green-500/5 border-green-500/20">
          <p className="text-lg text-center text-green-500 font-semibold">
            🎉 No underwater positions! All your stock positions are at or above cost basis.
          </p>
        </Card>
      )}

      {/* Position Details Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Position Details</h2>
        <StockPositionsTable positions={positions} premiums={premiums} />
      </Card>

      {/* Underwater Position Recovery Metrics */}
      {!isLoading && recoveryData && recoveryData.numUnderwater > 0 && (
        <UnderwaterPositionMetrics data={recoveryData} />
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}


function ProjectionsTab() {
  const [subTab, setSubTab] = useState('current-performance');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Income Projections</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Forecast your premium income based on open positions and historical performance
        </p>
      </div>

      {/* Sub-tabs */}
      <Tabs value={subTab} onValueChange={setSubTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="current-performance">Current Performance</TabsTrigger>
          <TabsTrigger value="interactive-projections">Interactive Projections</TabsTrigger>
        </TabsList>

        {/* Tab 1: Current Performance & Locked-In Income */}
        <TabsContent value="current-performance" className="space-y-6">
          {/* Locked-In Income Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              🔒 Locked-In Income
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Premium from open positions that will be realized if they expire worthless
            </p>
            <LockedInIncomeCards />
          </div>

          {/* Theta Decay Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              ⏱️ Theta Decay Projection
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Estimated daily time decay working in your favor from short option positions
            </p>
            <ThetaDecayCards />
          </div>
        </TabsContent>

        {/* Tab 2: Interactive ROI Projections */}
        <TabsContent value="interactive-projections" className="space-y-6">
          <InteractiveROICalculator />
        </TabsContent>
      </Tabs>
    </div>
  );
}
