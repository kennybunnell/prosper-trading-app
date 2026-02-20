import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { UnifiedOrderPreviewModal, UnifiedOrder } from '@/components/UnifiedOrderPreviewModal';
import { useAccount } from '@/contexts/AccountContext';
import { useTradingMode } from '@/contexts/TradingModeContext';

type DateRange = '30' | '60' | '90' | '180' | 'ytd' | 'all';

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

export function SpreadAnalyticsTab() {
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [activeSubTab, setActiveSubTab] = useState('strategy');

  // Calculate date range
  const { startDate, endDate } = useMemo(() => {
    const end = new Date().toISOString().split('T')[0];
    let start: string;

    if (dateRange === 'all') {
      // 5 years back
      start = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (dateRange === 'ytd') {
      start = `${new Date().getFullYear()}-01-01`;
    } else {
      const days = parseInt(dateRange);
      start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    return { startDate: start, endDate: end };
  }, [dateRange]);

  // Check API connection status
  const { data: connectionStatus } = trpc.settings.getConnectionStatus.useQuery();
  const isApiConnected = connectionStatus?.tastytrade.connected ?? false;

  // Fetch data - Historical queries only run when API is connected
  const strategyMetrics = trpc.spreadAnalytics.getStrategyMetrics.useQuery(
    { startDate, endDate },
    { enabled: isApiConnected, refetchOnWindowFocus: false }
  );

  const symbolMetrics = trpc.spreadAnalytics.getSymbolMetrics.useQuery(
    { startDate, endDate },
    { enabled: isApiConnected, refetchOnWindowFocus: false }
  );

  const closedSpreads = trpc.spreadAnalytics.getClosedSpreads.useQuery(
    { startDate, endDate },
    { enabled: isApiConnected, refetchOnWindowFocus: false }
  );

  // Active spreads query - always enabled
  const activeSpreads = trpc.spreadAnalytics.getActiveSpreads.useQuery(
    {},
    { refetchOnWindowFocus: false }
  );

  const handleExport = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => {
        const value = row[header];
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`;
        }
        return value;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Data exported successfully');
  };

  if (!isApiConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spread Analytics</CardTitle>
          <CardDescription>Performance metrics for spread strategies</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              Tastytrade API is not connected. Please configure your credentials in Settings to view spread analytics.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall metrics from strategy data
  const overallMetrics = useMemo(() => {
    if (!strategyMetrics.data || strategyMetrics.data.length === 0) return null;
    
    const totalPL = strategyMetrics.data.reduce((sum, s) => sum + s.totalProfitLoss, 0);
    const totalCapital = strategyMetrics.data.reduce((sum, s) => sum + s.totalCapitalUsed, 0);
    const totalPositions = strategyMetrics.data.reduce((sum, s) => sum + s.totalPositions, 0);
    const totalDays = strategyMetrics.data.reduce((sum, s) => sum + (s.avgDaysHeld * s.totalPositions), 0);
    const avgDaysHeld = totalPositions > 0 ? totalDays / totalPositions : 0;
    
    // Calculate overall win rate
    let totalWinners = 0;
    for (const strategy of strategyMetrics.data) {
      totalWinners += Math.round((strategy.winRate / 100) * strategy.totalPositions);
    }
    const winRate = totalPositions > 0 ? (totalWinners / totalPositions) * 100 : 0;
    
    return {
      totalPL,
      roc: totalCapital > 0 ? (totalPL / totalCapital) * 100 : 0,
      totalPositions,
      winRate,
      avgDaysHeld,
    };
  }, [strategyMetrics.data]);
  
  // Get individual strategy data
  const bullPutData = strategyMetrics.data?.find(s => s.strategy === 'Bull Put Spread');
  const bearCallData = strategyMetrics.data?.find(s => s.strategy === 'Bear Call Spread');
  const ironCondorData = strategyMetrics.data?.find(s => s.strategy === 'Iron Condor');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/20">
          <div className="text-sm text-muted-foreground mb-1">All Spreads</div>
          <div className="text-3xl font-bold text-blue-400">
            {overallMetrics ? 
              `$${overallMetrics.totalPL.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 
              '$0.00'}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            <div>ROC: {overallMetrics?.roc?.toFixed(2) || '0.00'}%</div>
            <div>Win Rate: {overallMetrics?.winRate?.toFixed(1) || '0.0'}%</div>
            <div>Avg Days: {overallMetrics?.avgDaysHeld?.toFixed(0) || '0'}</div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-green-500/10 to-green-600/10 border-green-500/20">
          <div className="text-sm text-muted-foreground mb-1">Bull Put Spreads</div>
          <div className="text-3xl font-bold text-green-400">
            {bullPutData ? 
              `$${bullPutData.totalProfitLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 
              '$0.00'}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            <div>ROC: {bullPutData?.roc?.toFixed(2) || '0.00'}%</div>
            <div>Positions: {bullPutData?.totalPositions || 0}</div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-orange-500/10 to-orange-600/10 border-orange-500/20">
          <div className="text-sm text-muted-foreground mb-1">Bear Call Spreads</div>
          <div className="text-3xl font-bold text-orange-400">
            {bearCallData ? 
              `$${bearCallData.totalProfitLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 
              '$0.00'}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            <div>ROC: {bearCallData?.roc?.toFixed(2) || '0.00'}%</div>
            <div>Positions: {bearCallData?.totalPositions || 0}</div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
          <div className="text-sm text-muted-foreground mb-1">Iron Condors</div>
          <div className="text-3xl font-bold text-purple-400">
            {ironCondorData ? 
              `$${ironCondorData.totalProfitLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 
              '$0.00'}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            <div>ROC: {ironCondorData?.roc?.toFixed(2) || '0.00'}%</div>
            <div>Positions: {ironCondorData?.totalPositions || 0}</div>
          </div>
        </Card>
      </div>

      {/* Date Range Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium">Date Range:</label>
        <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="60">Last 60 Days</SelectItem>
            <SelectItem value="90">Last 90 Days</SelectItem>
            <SelectItem value="180">Last 180 Days</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sub Tabs */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="strategy">By Strategy</TabsTrigger>
          <TabsTrigger value="symbol">By Symbol</TabsTrigger>
          <TabsTrigger value="historical">Historical Trades</TabsTrigger>
          <TabsTrigger value="active">Active Spreads</TabsTrigger>
        </TabsList>

        <TabsContent value="strategy" className="space-y-4">
          <ByStrategyTab data={strategyMetrics.data} isLoading={strategyMetrics.isLoading} />
        </TabsContent>

        <TabsContent value="symbol" className="space-y-4">
          <BySymbolTab 
            data={symbolMetrics.data} 
            isLoading={symbolMetrics.isLoading}
            onExport={() => handleExport(symbolMetrics.data || [], 'spread-analytics-by-symbol')}
          />
        </TabsContent>

        <TabsContent value="historical" className="space-y-4">
          <HistoricalTradesTab 
            data={closedSpreads.data} 
            isLoading={closedSpreads.isLoading}
            onExport={() => handleExport(closedSpreads.data || [], 'spread-analytics-historical')}
          />
        </TabsContent>

        <TabsContent value="active" className="space-y-4">
          <ActiveSpreadsTab 
            data={activeSpreads.data} 
            isLoading={activeSpreads.isLoading}
            onExport={() => handleExport(activeSpreads.data || [], 'spread-analytics-active')}
            onRefresh={() => activeSpreads.refetch()}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// By Strategy Tab Component
function ByStrategyTab({ data, isLoading }: { data: any[] | undefined; isLoading: boolean }) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'totalProfitLoss', direction: 'desc' });

  const sortedData = useMemo(() => {
    if (!data) return [];
    
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      return 0;
    });
    
    return sorted;
  }, [data, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy Performance Comparison</CardTitle>
          <CardDescription>Compare returns across different spread strategies</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy Performance Comparison</CardTitle>
          <CardDescription>Compare returns across different spread strategies</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No closed positions found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Strategy Performance Comparison</CardTitle>
        <CardDescription>Compare returns across different spread strategies</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Strategy</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('totalPositions')}>
                <div className="flex items-center gap-1">
                  Positions <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('totalProfitLoss')}>
                <div className="flex items-center gap-1">
                  Total P/L <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('roc')}>
                <div className="flex items-center gap-1">
                  ROC % <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('winRate')}>
                <div className="flex items-center gap-1">
                  Win Rate <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Avg Win</TableHead>
              <TableHead>Avg Loss</TableHead>
              <TableHead>Avg Days</TableHead>
              <TableHead>Best Symbol</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((strategy) => (
              <TableRow key={strategy.strategy}>
                <TableCell className="font-medium">{strategy.strategy}</TableCell>
                <TableCell>{strategy.totalPositions}</TableCell>
                <TableCell className={strategy.totalProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(strategy.totalProfitLoss)}
                </TableCell>
                <TableCell className={strategy.roc >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatPercent(strategy.roc)}
                </TableCell>
                <TableCell>{strategy.winRate.toFixed(1)}%</TableCell>
                <TableCell className="text-green-600">{formatCurrency(strategy.avgWin)}</TableCell>
                <TableCell className="text-red-600">{formatCurrency(strategy.avgLoss)}</TableCell>
                <TableCell>{strategy.avgDaysHeld.toFixed(0)}</TableCell>
                <TableCell>{strategy.bestSymbol || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// By Symbol Tab Component
function BySymbolTab({ data, isLoading, onExport }: { data: any[] | undefined; isLoading: boolean; onExport: () => void }) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'totalPL', direction: 'desc' });

  const sortedData = useMemo(() => {
    if (!data) return [];
    
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      return 0;
    });
    
    return sorted;
  }, [data, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance by Symbol</CardTitle>
          <CardDescription>Breakdown of closed positions by underlying symbol</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance by Symbol</CardTitle>
          <CardDescription>Breakdown of closed positions by underlying symbol</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No closed positions found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Performance by Symbol</CardTitle>
            <CardDescription>Breakdown of closed positions by underlying symbol ({data.length} symbols)</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort('symbol')}>
                <div className="flex items-center gap-1">
                  Symbol <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('totalPositions')}>
                <div className="flex items-center justify-end gap-1">
                  Positions <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('totalProfitLoss')}>
                <div className="flex items-center justify-end gap-1">
                  Total P/L <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('roc')}>
                <div className="flex items-center justify-end gap-1">
                  ROC % <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="text-right">IC P/L</TableHead>
              <TableHead className="text-right">BCS P/L</TableHead>
              <TableHead className="text-right">BPS P/L</TableHead>
              <TableHead>Best Strategy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((row, idx) => (
              <TableRow key={`${row.symbol}-${idx}`}>
                <TableCell className="font-medium">{row.symbol || 'N/A'}</TableCell>
                <TableCell className="text-right">{row.totalPositions ?? 0}</TableCell>
                <TableCell className={`text-right ${(row.totalProfitLoss ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(row.totalProfitLoss ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className={`text-right ${(row.roc ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(row.roc ?? 0).toFixed(2)}%
                </TableCell>
                <TableCell className={`text-right ${(row.ironCondorPL ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(row.ironCondorPL ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className={`text-right ${(row.bearCallSpreadPL ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(row.bearCallSpreadPL ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className={`text-right ${(row.bullPutSpreadPL ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(row.bullPutSpreadPL ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell>{row.bestStrategy || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Historical Trades Tab Component
function HistoricalTradesTab({ data, isLoading, onExport }: { data: any[] | undefined; isLoading: boolean; onExport: () => void }) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'closeDate', direction: 'desc' });

  const sortedData = useMemo(() => {
    if (!data) return [];
    
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      return 0;
    });
    
    return sorted;
  }, [data, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historical Trades</CardTitle>
          <CardDescription>Closed spread positions</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historical Trades</CardTitle>
          <CardDescription>Closed spread positions</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No closed positions found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Historical Trades</CardTitle>
            <CardDescription>Closed spread positions ({data.length} total)</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort('symbol')}>
                <div className="flex items-center gap-1">
                  Symbol <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('strategy')}>
                <div className="flex items-center gap-1">
                  Strategy <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('shortStrike')}>
                <div className="flex items-center gap-1">
                  Strikes <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('openDate')}>
                <div className="flex items-center gap-1">
                  Opened <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('closedDate')}>
                <div className="flex items-center gap-1">
                  Closed <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('daysHeld')}>
                <div className="flex items-center gap-1">
                  Days <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('premiumReceived')}>
                <div className="flex items-center justify-end gap-1">
                  Premium <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('closeCost')}>
                <div className="flex items-center justify-end gap-1">
                  Close Cost <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('profitLoss')}>
                <div className="flex items-center justify-end gap-1">
                  P/L <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('roc')}>
                <div className="flex items-center justify-end gap-1">
                  ROC % <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell>{formatDate(trade.closeDate)}</TableCell>
                <TableCell className="font-medium">{trade.symbol}</TableCell>
                <TableCell>
                  <span className="text-xs px-2 py-1 rounded bg-secondary">
                    {trade.spreadType === 'Iron Condor' ? 'IC' : trade.spreadType === 'Bear Call Spread' ? 'BCS' : 'BPS'}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{trade.strikes}</TableCell>
                <TableCell>{trade.daysHeld}</TableCell>
                <TableCell className={trade.profitLoss >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                  {trade.profitLoss >= 0 ? <TrendingUp className="inline h-4 w-4 mr-1" /> : <TrendingDown className="inline h-4 w-4 mr-1" />}
                  {formatCurrency(trade.profitLoss)}
                </TableCell>
                <TableCell className={trade.roc >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatPercent(trade.roc)}
                </TableCell>
                <TableCell>{formatCurrency(trade.premiumCollected)}</TableCell>
                <TableCell>{formatCurrency(trade.closeCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Active Spreads Tab Component
function ActiveSpreadsTab({ 
  data, 
  isLoading, 
  onExport,
  onRefresh 
}: { 
  data: any[] | undefined; 
  isLoading: boolean; 
  onExport: () => void;
  onRefresh: () => void;
}) {
  const { mode: tradingMode } = useTradingMode();
  const { selectedAccountId } = useAccount();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'profitLossPercent', direction: 'desc' });
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  const [selectedSpread, setSelectedSpread] = useState<any | null>(null);
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [finalOrderStatus, setFinalOrderStatus] = useState<string | null>(null);
  
  const closePositionsMutation = trpc.performance.closePositions.useMutation({
    onSuccess: () => {
      // Don't show confetti here - let UnifiedOrderPreviewModal handle it after polling
      toast.success('Orders submitted successfully');
    },
    onError: (error) => {
      toast.error(`Failed to submit orders: ${error.message}`);
    },
  });
  
  // Get tRPC utils for imperative queries
  const utils = trpc.useUtils();
  
  const handleCloseSpread = (spread: any) => {
    if (tradingMode === 'paper') {
      toast.error('Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.');
      return;
    }
    
    setSelectedSpread(spread);
    
    // Determine option type based on strategy
    const optionType = spread.strategy === 'Bull Put Spread' || 
                       (spread.strategy === 'Iron Condor' && spread.putShortStrike) 
                       ? 'PUT' as const 
                       : 'CALL' as const;
    
    // For Iron Condor, we need to create two separate orders (put spread + call spread)
    if (spread.strategy === 'Iron Condor') {
      const putSpreadOrder: UnifiedOrder = {
        symbol: spread.symbol,
        strike: parseFloat(spread.putShortStrike),
        expiration: spread.expiration,
        premium: spread.currentValue / 2, // Estimate half for put spread
        action: "BTC" as const,
        optionType: 'PUT' as const,
        bid: (spread.currentValue / 2) * 0.95,
        ask: (spread.currentValue / 2) * 1.05,
        currentPrice: spread.currentValue / 2,
        longStrike: parseFloat(spread.putLongStrike),
        longPremium: (spread.currentValue / 2) * 0.6,
        longBid: (spread.currentValue / 2) * 0.6 * 0.95,
        longAsk: (spread.currentValue / 2) * 0.6 * 1.05,
      };
      
      const callSpreadOrder: UnifiedOrder = {
        symbol: spread.symbol,
        strike: parseFloat(spread.callShortStrike),
        expiration: spread.expiration,
        premium: spread.currentValue / 2, // Estimate half for call spread
        action: "BTC" as const,
        optionType: 'CALL' as const,
        bid: (spread.currentValue / 2) * 0.95,
        ask: (spread.currentValue / 2) * 1.05,
        currentPrice: spread.currentValue / 2,
        longStrike: parseFloat(spread.callLongStrike),
        longPremium: (spread.currentValue / 2) * 0.6,
        longBid: (spread.currentValue / 2) * 0.6 * 0.95,
        longAsk: (spread.currentValue / 2) * 0.6 * 1.05,
      };
      
      setUnifiedOrders([putSpreadOrder, callSpreadOrder]);
    } else {
      // Single spread (Bull Put or Bear Call)
      const order: UnifiedOrder = {
        symbol: spread.symbol,
        strike: parseFloat(spread.shortStrike),
        expiration: spread.expiration,
        premium: spread.currentValue,
        action: "BTC" as const,
        optionType,
        bid: spread.currentValue * 0.95,
        ask: spread.currentValue * 1.05,
        currentPrice: spread.currentValue,
        longStrike: spread.longStrike ? parseFloat(spread.longStrike) : undefined,
        longPremium: spread.currentValue * 0.6,
        longBid: spread.currentValue * 0.6 * 0.95,
        longAsk: spread.currentValue * 0.6 * 1.05,
      };
      
      setUnifiedOrders([order]);
    }
    
    setShowPreviewModal(true);
  };
  
  // Callback for UnifiedOrderPreviewModal
  const handleConfirmClose = async (
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    isDryRun: boolean
  ): Promise<{ results: any[] }> => {
    if (!selectedSpread) return { results: [] };
    
    try {
      // Transform spread data to closePositions format
      const position = {
        accountId: selectedSpread.accountId || selectedAccountId || '',
        optionSymbol: selectedSpread.symbol,
        underlying: selectedSpread.symbol,
        quantity: selectedSpread.quantity,
        strike: parseFloat(selectedSpread.shortStrike),
        currentPrice: selectedSpread.currentValue,
        spreadType: selectedSpread.strategy === 'Bull Put Spread' ? 'bull_put' as const : 
                    selectedSpread.strategy === 'Bear Call Spread' ? 'bear_call' as const :
                    'iron_condor' as const,
        longStrike: selectedSpread.longStrike ? parseFloat(selectedSpread.longStrike) : undefined,
        spreadWidth: selectedSpread.spreadWidth,
      };
      
      const response = await closePositionsMutation.mutateAsync({
        positions: [position],
        dryRun: isDryRun,
      });
      
      return { results: response.results || [] };
    } catch (error: any) {
      console.error('[handleConfirmClose] Error:', error);
      return { results: [] };
    }
  };
  
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
      console.log('[ActiveSpreadsTab] Polling order statuses for:', orderIds, 'accountId:', accountId);
      
      const statusMap = await utils.orders.checkStatusBatch.fetch({
        accountId,
        orderIds,
      });
      
      console.log('[ActiveSpreadsTab] Received status map:', statusMap);
      
      return orderIds.map((orderId) => {
        const status = statusMap[orderId];
        const mappedStatus = status?.status === 'Unknown' ? 'Rejected' as const : status?.status || 'Rejected' as const;
        
        return {
          orderId,
          symbol: selectedSpread?.symbol || 'Unknown',
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
      console.error('[ActiveSpreadsTab] Error polling order statuses:', error);
      return orderIds.map((orderId) => ({
        orderId,
        symbol: selectedSpread?.symbol || 'Unknown',
        status: 'Rejected' as const,
        message: `Failed to check status: ${error.message}`,
      }));
    }
  };

  const sortedData = useMemo(() => {
    if (!data) return [];
    
    // Add calculated fields for sorting
    const dataWithCalculated = data.map(spread => {
      // Calculate expectedMove
      let expectedMove = 0;
      if (spread.underlyingPrice && spread.shortStrike) {
        const shortStrike = parseFloat(spread.shortStrike);
        const currentPrice = spread.underlyingPrice;
        
        if (spread.strategy === 'Bull Put Spread') {
          expectedMove = ((currentPrice - shortStrike) / shortStrike) * 100;
        } else if (spread.strategy === 'Bear Call Spread') {
          expectedMove = ((shortStrike - currentPrice) / currentPrice) * 100;
        } else if (spread.strategy === 'Iron Condor') {
          const putShortStrike = spread.putShortStrike ? parseFloat(spread.putShortStrike) : 0;
          const callShortStrike = spread.callShortStrike ? parseFloat(spread.callShortStrike) : 0;
          const putDistance = putShortStrike > 0 ? ((currentPrice - putShortStrike) / putShortStrike) * 100 : 100;
          const callDistance = callShortStrike > 0 ? ((callShortStrike - currentPrice) / currentPrice) * 100 : 100;
          expectedMove = Math.min(putDistance, callDistance);
        }
      }
      
      // Calculate profitPercent
      const maxProfit = spread.premiumReceived || 0;
      const currentProfit = spread.profitLoss || 0;
      const profitPercent = maxProfit > 0 ? (currentProfit / maxProfit) * 100 : 0;
      
      return {
        ...spread,
        expectedMove,
        profitPercent,
      };
    });
    
    const sorted = [...dataWithCalculated].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      return 0;
    });
    
    return sorted;
  }, [data, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Spread Positions</CardTitle>
          <CardDescription>Currently open spread positions</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Spread Positions</CardTitle>
          <CardDescription>Currently open spread positions</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No active spread positions found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Active Spread Positions</CardTitle>
            <CardDescription>Currently open spread positions ({data.length} total)</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort('symbol')}>
                <div className="flex items-center gap-1">
                  Symbol <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('strategy')}>
                <div className="flex items-center gap-1">
                  Strategy <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('shortStrike')}>
                <div className="flex items-center gap-1">
                  Strikes <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('underlyingPrice')}>
                <div className="flex items-center gap-1">
                  Stock Price <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('expectedMove')}>
                <div className="flex items-center gap-1">
                  Expected Move <ArrowUpDown className="h-4 w-4" />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Distance from current price to short strike. Green = safe (&gt;10%), Yellow = caution (5-10%), Red = at risk (&lt;5%)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('currentValue')}>
                <div className="flex items-center gap-1">
                  Close Cost <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('expiration')}>
                <div className="flex items-center gap-1">
                  Exp <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('dte')}>
                <div className="flex items-center gap-1">
                  DTE <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('quantity')}>
                <div className="flex items-center gap-1">
                  Qty <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('premiumReceived')}>
                <div className="flex items-center gap-1">
                  Premium <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('profitLoss')}>
                <div className="flex items-center gap-1">
                  P/L <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('profitLossPercent')}>
                <div className="flex items-center gap-1">
                  P/L % <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('profitPercent')}>
                <div className="flex items-center gap-1">
                  Profit % <ArrowUpDown className="h-4 w-4" />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Percentage of maximum profit achieved. 100% = let expire worthless, 70%+ = consider closing</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </TableHead>
              <TableHead>
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((spread, idx) => (
              <TableRow key={`${spread.symbol}-${spread.expiration}-${spread.shortStrike}-${spread.longStrike}-${idx}`}>
                <TableCell className="font-medium">{spread.symbol}</TableCell>
                <TableCell>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    spread.strategy === 'Bull Put Spread' ? 'bg-green-500/20 text-green-400' :
                    spread.strategy === 'Bear Call Spread' ? 'bg-orange-500/20 text-orange-400' :
                    spread.strategy === 'Iron Condor' ? 'bg-purple-500/20 text-purple-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {spread.strategy}
                  </span>
                </TableCell>
                <TableCell>
                  {spread.strategy === 'Iron Condor' && spread.putShortStrike && spread.callShortStrike ? (
                    <div className="text-xs">
                      <div>Put: {spread.putShortStrike}/{spread.putLongStrike}</div>
                      <div>Call: {spread.callShortStrike}/{spread.callLongStrike}</div>
                    </div>
                  ) : (
                    <>{spread.shortStrike}{spread.longStrike && `/${spread.longStrike}`}</>
                  )}
                </TableCell>
                <TableCell className="font-medium">{spread.underlyingPrice ? formatCurrency(spread.underlyingPrice) : 'N/A'}</TableCell>
                <TableCell>
                  {(() => {
                    if (!spread.underlyingPrice || !spread.shortStrike) return 'N/A';
                    
                    const shortStrike = parseFloat(spread.shortStrike);
                    const currentPrice = spread.underlyingPrice;
                    
                    let distancePercent: number;
                    let isAtRisk = false;
                    
                    if (spread.strategy === 'Bull Put Spread') {
                      distancePercent = ((currentPrice - shortStrike) / shortStrike) * 100;
                      isAtRisk = distancePercent < 5;
                    } else if (spread.strategy === 'Bear Call Spread') {
                      distancePercent = ((shortStrike - currentPrice) / currentPrice) * 100;
                      isAtRisk = distancePercent < 5;
                    } else if (spread.strategy === 'Iron Condor') {
                      const putShortStrike = spread.putShortStrike ? parseFloat(spread.putShortStrike) : 0;
                      const callShortStrike = spread.callShortStrike ? parseFloat(spread.callShortStrike) : 0;
                      
                      const putDistance = putShortStrike > 0 ? ((currentPrice - putShortStrike) / putShortStrike) * 100 : 100;
                      const callDistance = callShortStrike > 0 ? ((callShortStrike - currentPrice) / currentPrice) * 100 : 100;
                      
                      distancePercent = Math.min(putDistance, callDistance);
                      isAtRisk = distancePercent < 5;
                    } else {
                      return 'N/A';
                    }
                    
                    const colorClass = isAtRisk ? 'text-red-600' : distancePercent < 10 ? 'text-yellow-600' : 'text-green-600';
                    const bgClass = isAtRisk ? 'bg-red-500/10' : distancePercent < 10 ? 'bg-yellow-500/10' : 'bg-green-500/10';
                    
                    return (
                      <span className={`text-xs font-medium px-2 py-1 rounded ${bgClass} ${colorClass}`}>
                        {distancePercent >= 0 ? '+' : ''}{distancePercent.toFixed(1)}%
                      </span>
                    );
                  })()}
                </TableCell>
                <TableCell>{formatCurrency(spread.currentValue)}</TableCell>
                <TableCell>{new Date(spread.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</TableCell>
                <TableCell>{spread.dte}</TableCell>
                <TableCell>{spread.quantity}</TableCell>
                <TableCell>{formatCurrency(spread.premiumReceived)}</TableCell>
                <TableCell className={spread.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(spread.profitLoss)}
                </TableCell>
                <TableCell className={spread.profitLossPercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatPercent(spread.profitLossPercent)}
                </TableCell>
                <TableCell>
                  {(() => {
                    const maxProfit = spread.premiumReceived;
                    const currentProfit = spread.profitLoss;
                    const profitPercent = maxProfit > 0 ? (currentProfit / maxProfit) * 100 : 0;
                    
                    const colorClass = profitPercent >= 70 ? 'text-green-600' : profitPercent >= 50 ? 'text-yellow-600' : 'text-muted-foreground';
                    const bgClass = profitPercent >= 70 ? 'bg-green-500/10' : profitPercent >= 50 ? 'bg-yellow-500/10' : 'bg-secondary';
                    
                    return (
                      <span className={`text-xs font-medium px-2 py-1 rounded ${bgClass} ${colorClass}`}>
                        {profitPercent.toFixed(0)}%
                      </span>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  {(() => {
                    const maxProfit = spread.premiumReceived;
                    const currentProfit = spread.profitLoss;
                    const profitPercent = maxProfit > 0 ? (currentProfit / maxProfit) * 100 : 0;
                    
                    // Show close button if profit >= 70%
                    if (profitPercent >= 70) {
                      return (
                        <Button 
                          size="sm" 
                          variant="destructive"
                          className="h-8 text-xs font-semibold"
                          onClick={() => handleCloseSpread(spread)}
                        >
                          Close
                        </Button>
                      );
                    }
                    return <span className="text-xs text-muted-foreground">-</span>;
                  })()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    
    {/* Unified Order Preview Modal for BTC */}
    {unifiedOrders.length > 0 && (
      <UnifiedOrderPreviewModal
        open={showPreviewModal}
        onOpenChange={(open) => {
          setShowPreviewModal(open);
          // If closing the modal after submission is complete, refresh the data
          if (!open && submissionComplete) {
            console.log('[ActiveSpreadsTab] Modal closed after submission - refreshing data');
            onRefresh();
            setSubmissionComplete(false);
            setFinalOrderStatus(null);
            setSelectedSpread(null);
            setUnifiedOrders([]);
          }
        }}
        orders={unifiedOrders}
        strategy="btc"
        accountId={selectedAccountId || ''}
        availableBuyingPower={0}
        onSubmit={handleConfirmClose}
        onPollStatuses={handlePollOrderStatuses}
        allowQuantityEdit={false}
        tradingMode={tradingMode === 'live' ? 'live' : 'paper'}
        initialSkipDryRun={false}
        submissionComplete={submissionComplete}
        finalOrderStatus={finalOrderStatus}
        onSubmissionStateChange={(complete, status) => {
          setSubmissionComplete(complete);
          setFinalOrderStatus(status);
        }}
      />
    )}
    </>
  );
}
