import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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

  // Fetch active positions
  const { data, isLoading, refetch } = trpc.performance.getActivePositions.useQuery(
    {
      accountId: selectedAccountId || '',
      positionType,
      minRealizedPercent: profitFilter || undefined,
    },
    {
      enabled: !!selectedAccountId,
      refetchOnWindowFocus: false,
    }
  );

  const handleRefresh = async () => {
    try {
      await refetch();
      toast.success('Positions refreshed');
    } catch (error) {
      toast.error('Failed to refresh positions');
    }
  };

  // Filter positions by profit threshold
  const filteredPositions = useMemo(() => {
    if (!data?.positions) return [];
    if (!profitFilter) return data.positions;
    return data.positions.filter(pos => pos.realizedPercent >= profitFilter);
  }, [data?.positions, profitFilter]);

  const summary = data?.summary || {
    openPositions: 0,
    totalPremiumAtRisk: 0,
    avgRealizedPercent: 0,
    readyToClose: 0,
  };

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Quick Filters:</span>
            <Button
              variant={profitFilter === 80 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 80 ? null : 80)}
              className="bg-red-500/20 hover:bg-red-500/30 border-red-500/50"
            >
              80%+
            </Button>
            <Button
              variant={profitFilter === 85 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 85 ? null : 85)}
              className="bg-red-500/20 hover:bg-red-500/30 border-red-500/50"
            >
              85%+
            </Button>
            <Button
              variant={profitFilter === 90 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 90 ? null : 90)}
              className="bg-yellow-500/20 hover:bg-yellow-500/30 border-yellow-500/50"
            >
              90%+
            </Button>
            <Button
              variant={profitFilter === 95 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setProfitFilter(profitFilter === 95 ? null : 95)}
              className="bg-green-500/20 hover:bg-green-500/30 border-green-500/50"
            >
              95%+
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

      {/* Position Type Tabs */}
      <Tabs value={positionType} onValueChange={(v) => setPositionType(v as 'csp' | 'cc')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="csp">Active CSPs</TabsTrigger>
          <TabsTrigger value="cc">Active CCs</TabsTrigger>
        </TabsList>

        <TabsContent value="csp" className="mt-6">
          <PositionsTable positions={filteredPositions} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="cc" className="mt-6">
          <PositionsTable positions={filteredPositions} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface Position {
  account: string;
  symbol: string;
  type: 'CSP' | 'CC';
  quantity: number;
  strike: number;
  expiration: string;
  dte: number;
  premium: number;
  current: number;
  realizedPercent: number;
  action: 'CLOSE' | 'WATCH' | 'HOLD';
}

function PositionsTable({ positions, isLoading }: { positions: Position[]; isLoading: boolean }) {
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

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
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
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={() => toast.info(`${label} action coming soon`)}
    >
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Button>
  );
}
