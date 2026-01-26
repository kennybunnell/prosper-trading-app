import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAccount } from '@/contexts/AccountContext';
import { toast } from 'sonner';

export default function Performance() {
  const [activeTab, setActiveTab] = useState('active-positions');

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Performance Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Track your trading performance, active positions, and premium realization
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="active-positions">Active Positions</TabsTrigger>
          <TabsTrigger value="working-orders" disabled>Working Orders</TabsTrigger>
          <TabsTrigger value="overview" disabled>Overview</TabsTrigger>
          <TabsTrigger value="stock-basis" disabled>Stock Basis</TabsTrigger>
          <TabsTrigger value="projections" disabled>Projections</TabsTrigger>
        </TabsList>

        {/* Active Positions Tab */}
        <TabsContent value="active-positions" className="space-y-6">
          <ActivePositionsTab />
        </TabsContent>

        {/* Placeholder tabs */}
        <TabsContent value="working-orders">
          <Card className="p-8 text-center text-muted-foreground">
            Working Orders tab coming soon...
          </Card>
        </TabsContent>
        <TabsContent value="overview">
          <Card className="p-8 text-center text-muted-foreground">
            Performance Overview tab coming soon...
          </Card>
        </TabsContent>
        <TabsContent value="stock-basis">
          <Card className="p-8 text-center text-muted-foreground">
            Stock Basis & Returns tab coming soon...
          </Card>
        </TabsContent>
        <TabsContent value="projections">
          <Card className="p-8 text-center text-muted-foreground">
            Projections tab coming soon...
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ActivePositionsTab() {
  const { selectedAccountId } = useAccount();
  const [positionType, setPositionType] = useState<'csp' | 'cc'>('csp');
  const [profitFilter, setProfitFilter] = useState<number | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<Set<number>>(new Set());
  const [dryRun, setDryRun] = useState(true);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeResults, setCloseResults] = useState<any>(null);

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
      toast.success(`${result.summary.success} order(s) ${dryRun ? 'validated' : 'submitted'} successfully`);
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

  // Filter positions by profit threshold
  const filteredPositions = useMemo(() => {
    if (!data?.positions) return [];
    if (!profitFilter) return data.positions;
    return data.positions.filter(pos => pos.realizedPercent >= profitFilter);
  }, [data?.positions, profitFilter]);

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
    if (selectedPositionsData.length === 0) {
      toast.error('Please select at least one position to close');
      return;
    }
    setShowCloseDialog(true);
  };

  const handleConfirmClose = async () => {
    setShowCloseDialog(false);
    setCloseResults(null);

    const positionsToClose = selectedPositionsData.map(pos => ({
      accountId: pos.accountId,
      optionSymbol: pos.optionSymbol,
      underlying: pos.symbol,
      quantity: pos.quantity,
      strike: pos.strike,
      currentPrice: pos.currentPrice,
    }));

    await closePositionsMutation.mutateAsync({
      positions: positionsToClose,
      dryRun,
    });
  };

  const summary = data?.summary || {
    openPositions: 0,
    totalPremiumAtRisk: 0,
    avgRealizedPercent: 0,
    readyToClose: 0,
  };

  // Count positions by profit threshold
  const profitCounts = useMemo(() => {
    if (!data?.positions) return { p80: 0, p85: 0, p90: 0, p95: 0 };
    return {
      p80: data.positions.filter(p => p.realizedPercent >= 80).length,
      p85: data.positions.filter(p => p.realizedPercent >= 85).length,
      p90: data.positions.filter(p => p.realizedPercent >= 90).length,
      p95: data.positions.filter(p => p.realizedPercent >= 95).length,
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/20">
          <div className="text-sm text-muted-foreground mb-1">Open Positions</div>
          <div className="text-3xl font-bold text-blue-400">{summary.openPositions}</div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
          <div className="text-sm text-muted-foreground mb-1">Total Premium at Risk</div>
          <div className="text-3xl font-bold text-purple-400">
            ${summary.totalPremiumAtRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-green-500/10 to-green-600/10 border-green-500/20">
          <div className="text-sm text-muted-foreground mb-1">Avg Premium Realized</div>
          <div className="text-3xl font-bold text-green-400">{summary.avgRealizedPercent.toFixed(1)}%</div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-amber-500/10 to-amber-600/10 border-amber-500/20">
          <div className="text-sm text-muted-foreground mb-1">Ready to Close</div>
          <div className="text-3xl font-bold text-amber-400">{summary.readyToClose}</div>
        </Card>
      </div>

      {/* Quick Profit Filters */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">Quick Filters:</span>
            <Button
              variant={profitFilter === 80 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 80 ? null : 80)}
              className="bg-red-500/20 hover:bg-red-500/30 border-red-500/50"
            >
              80%+ ({profitCounts.p80})
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
              variant={profitFilter === 90 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 90 ? null : 90)}
              className="bg-yellow-500/20 hover:bg-yellow-500/30 border-yellow-500/50"
            >
              90%+ ({profitCounts.p90})
            </Button>
            <Button
              variant={profitFilter === 95 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 95 ? null : 95)}
              className="bg-green-500/20 hover:bg-green-500/30 border-green-500/50"
            >
              95%+ ({profitCounts.p95})
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
          </div>
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
                className="bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/50"
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
          />
        </TabsContent>

        <TabsContent value="cc" className="mt-6">
          <PositionsTable 
            positions={filteredPositions} 
            isLoading={isLoading}
            selectedPositions={selectedPositions}
            onTogglePosition={handleTogglePosition}
            onSelectAll={handleSelectAll}
          />
        </TabsContent>
      </Tabs>

      {/* Close Confirmation Dialog */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dryRun ? 'Validate Close Orders' : 'Confirm Close Orders'}</DialogTitle>
            <DialogDescription>
              {dryRun 
                ? `This will validate ${selectedSummary.count} close order(s) without submitting them to Tastytrade.`
                : `This will submit ${selectedSummary.count} buy-to-close order(s) to Tastytrade. Are you sure?`
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Positions to close:</span>
                <span className="font-medium">{selectedSummary.count}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total cost:</span>
                <span className="font-medium">${selectedSummary.totalCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Premium collected:</span>
                <span className="font-medium text-green-400">${selectedSummary.totalPremium.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Net profit:</span>
                <span className="font-medium text-green-400">
                  ${(selectedSummary.totalPremium - selectedSummary.totalCost).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmClose} className="bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/50">
              {dryRun ? 'Validate Orders' : 'Submit Orders'}
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
}

interface PositionsTableProps {
  positions: Position[];
  isLoading: boolean;
  selectedPositions: Set<number>;
  onTogglePosition: (idx: number) => void;
  onSelectAll: () => void;
}

function PositionsTable({ positions, isLoading, selectedPositions, onTogglePosition, onSelectAll }: PositionsTableProps) {
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
                />
              </th>
              <th className="text-left p-3 text-sm font-medium">Account</th>
              <th className="text-left p-3 text-sm font-medium">Symbol</th>
              <th className="text-left p-3 text-sm font-medium">Type</th>
              <th className="text-right p-3 text-sm font-medium">Qty</th>
              <th className="text-right p-3 text-sm font-medium">Strike</th>
              <th className="text-left p-3 text-sm font-medium">Exp</th>
              <th className="text-right p-3 text-sm font-medium">DTE</th>
              <th className="text-right p-3 text-sm font-medium">Premium</th>
              <th className="text-right p-3 text-sm font-medium">Current</th>
              <th className="text-right p-3 text-sm font-medium">Realized %</th>
              <th className="text-center p-3 text-sm font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, idx) => (
              <tr key={idx} className="border-t border-border hover:bg-muted/30">
                <td className="p-3">
                  <Checkbox
                    checked={selectedPositions.has(idx)}
                    onCheckedChange={() => onTogglePosition(idx)}
                    aria-label={`Select ${pos.symbol}`}
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
                <td className="p-3 text-sm text-right">{pos.quantity}</td>
                <td className="p-3 text-sm text-right">${pos.strike.toFixed(2)}</td>
                <td className="p-3 text-sm">{pos.expiration}</td>
                <td className="p-3 text-sm text-right">{pos.dte}</td>
                <td className="p-3 text-sm text-right">${pos.premium.toFixed(2)}</td>
                <td className="p-3 text-sm text-right">${pos.current.toFixed(2)}</td>
                <td className="p-3 text-sm text-right">
                  <span className={`font-medium ${
                    pos.realizedPercent >= 80 ? 'text-green-400' :
                    pos.realizedPercent >= 60 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {pos.realizedPercent.toFixed(1)}%
                  </span>
                </td>
                <td className="p-3 text-center">
                  <ActionButton action={pos.action} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ActionButton({ action }: { action: 'CLOSE' | 'WATCH' | 'HOLD' }) {
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
    <div className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${className}`}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </div>
  );
}
