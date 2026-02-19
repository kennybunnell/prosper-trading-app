import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type DateRange = '30' | '60' | '90' | '180' | 'ytd' | 'all';

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

export default function SpreadAnalytics() {
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [activeTab, setActiveTab] = useState('strategy');

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

  // Fetch data
  const strategyMetrics = trpc.spreadAnalytics.getStrategyMetrics.useQuery({ startDate, endDate });
  const symbolMetrics = trpc.spreadAnalytics.getSymbolMetrics.useQuery({ startDate, endDate });
  const closedSpreads = trpc.spreadAnalytics.getClosedSpreads.useQuery({ startDate, endDate });

  // Calculate overall metrics
  const overallMetrics = useMemo(() => {
    if (!strategyMetrics.data) return null;

    const totalPL = strategyMetrics.data.reduce((sum, s) => sum + s.totalProfitLoss, 0);
    const totalCapital = strategyMetrics.data.reduce((sum, s) => sum + s.totalCapitalUsed, 0);
    const totalPositions = strategyMetrics.data.reduce((sum, s) => sum + s.totalPositions, 0);
    const roc = totalCapital > 0 ? (totalPL / totalCapital) * 100 : 0;

    return { totalPL, totalCapital, totalPositions, roc };
  }, [strategyMetrics.data]);

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

  const exportToCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Spread Analytics</h1>
          <p className="text-muted-foreground">
            Performance analysis for Iron Condors, Bear Call Spreads, and Bull Put Spreads
          </p>
        </div>
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select date range" />
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {strategyMetrics.isLoading ? (
          <>
            {[1, 2, 3, 4].map(i => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-24 mb-2" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            {/* Overall Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">All Spreads</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {overallMetrics && formatCurrency(overallMetrics.totalPL)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  ROC: {overallMetrics && formatPercent(overallMetrics.roc)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {overallMetrics?.totalPositions} closed positions
                </p>
              </CardContent>
            </Card>

            {/* Strategy Cards */}
            {strategyMetrics.data?.map((strategy) => (
              <Card key={strategy.strategy}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{strategy.strategy}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${strategy.totalProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(strategy.totalProfitLoss)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    ROC: {formatPercent(strategy.roc)} • Win Rate: {strategy.winRate.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {strategy.totalPositions} positions • Avg {strategy.avgDaysHeld.toFixed(0)} days
                  </p>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="strategy">By Strategy</TabsTrigger>
          <TabsTrigger value="symbol">By Symbol</TabsTrigger>
          <TabsTrigger value="historical">Historical Trades</TabsTrigger>
          <TabsTrigger value="active">Active Spreads</TabsTrigger>
        </TabsList>

        {/* By Strategy Tab */}
        <TabsContent value="strategy" className="space-y-4">
          <StrategyTab data={strategyMetrics.data} isLoading={strategyMetrics.isLoading} />
        </TabsContent>

        {/* By Symbol Tab */}
        <TabsContent value="symbol" className="space-y-4">
          <SymbolTab data={symbolMetrics.data} isLoading={symbolMetrics.isLoading} onExport={() => exportToCSV(symbolMetrics.data || [], 'spread-analytics-by-symbol')} />
        </TabsContent>

        {/* Historical Trades Tab */}
        <TabsContent value="historical" className="space-y-4">
          <HistoricalTab data={closedSpreads.data} isLoading={closedSpreads.isLoading} onExport={() => exportToCSV(closedSpreads.data || [], 'spread-analytics-historical')} />
        </TabsContent>

        {/* Active Spreads Tab */}
        <TabsContent value="active" className="space-y-4">
          <ActiveTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Strategy Tab Component
function StrategyTab({ data, isLoading }: { data: any[] | undefined; isLoading: boolean }) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'roc', direction: 'desc' });

  const sortedData = useMemo(() => {
    if (!data) return [];
    
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
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

// Symbol Tab Component
function SymbolTab({ data, isLoading, onExport }: { data: any[] | undefined; isLoading: boolean; onExport: () => void }) {
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
          <CardTitle>Performance by Symbol</CardTitle>
          <CardDescription>See which tickers generate the best returns</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Performance by Symbol</CardTitle>
          <CardDescription>See which tickers generate the best returns</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
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
              <TableHead>IC P/L</TableHead>
              <TableHead>BCS P/L</TableHead>
              <TableHead>BPS P/L</TableHead>
              <TableHead>Best Strategy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((symbol) => (
              <TableRow key={symbol.symbol}>
                <TableCell className="font-medium">{symbol.symbol}</TableCell>
                <TableCell>{symbol.totalPositions}</TableCell>
                <TableCell className={symbol.totalProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(symbol.totalProfitLoss)}
                </TableCell>
                <TableCell className={symbol.roc >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatPercent(symbol.roc)}
                </TableCell>
                <TableCell className={symbol.ironCondorPL >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(symbol.ironCondorPL)}
                </TableCell>
                <TableCell className={symbol.bearCallSpreadPL >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(symbol.bearCallSpreadPL)}
                </TableCell>
                <TableCell className={symbol.bullPutSpreadPL >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(symbol.bullPutSpreadPL)}
                </TableCell>
                <TableCell>{symbol.bestStrategy}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Historical Tab Component
function HistoricalTab({ data, isLoading, onExport }: { data: any[] | undefined; isLoading: boolean; onExport: () => void }) {
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
          <CardDescription>Detailed log of all closed spread positions</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Historical Trades</CardTitle>
          <CardDescription>Detailed log of all closed spread positions ({data?.length || 0} trades)</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => handleSort('closeDate')}>
                  <div className="flex items-center gap-1">
                    Close Date <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('symbol')}>
                  <div className="flex items-center gap-1">
                    Symbol <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Strikes</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('daysHeld')}>
                  <div className="flex items-center gap-1">
                    Days <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('profitLoss')}>
                  <div className="flex items-center gap-1">
                    P/L <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('roc')}>
                  <div className="flex items-center gap-1">
                    ROC % <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Close Cost</TableHead>
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
        </div>
      </CardContent>
    </Card>
  );
}

// Active Tab Component
function ActiveTab() {
  // TODO: Need to create a separate query for active spreads
  // For now, show placeholder
  const activeSpreads: any[] = [];

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

  // Loading state removed since we're using placeholder data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Spread Positions</CardTitle>
        <CardDescription>Monitor your current spread positions ({activeSpreads.length} active)</CardDescription>
      </CardHeader>
      <CardContent>
        {activeSpreads.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No active spread positions found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Strikes</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead>DTE</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>P/L</TableHead>
                <TableHead>Realized %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeSpreads.map((pos: any) => (
                <TableRow key={pos.id}>
                  <TableCell className="font-medium">{pos.symbol}</TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-1 rounded bg-secondary">
                      {pos.spreadType === 'Iron Condor' ? 'IC' : pos.spreadType === 'Bear Call Spread' ? 'BCS' : 'BPS'}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {pos.longStrike ? `${pos.strike}/${pos.longStrike}` : pos.strike}
                  </TableCell>
                  <TableCell>{formatDate(pos.expiration)}</TableCell>
                  <TableCell>{pos.dte}</TableCell>
                  <TableCell>{formatCurrency(pos.premium)}</TableCell>
                  <TableCell>{formatCurrency(pos.currentPrice * pos.quantity * 100)}</TableCell>
                  <TableCell className={pos.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatCurrency(pos.profitLoss)}
                  </TableCell>
                  <TableCell className={pos.realizedPercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatPercent(pos.realizedPercent)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
