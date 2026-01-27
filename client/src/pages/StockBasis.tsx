import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Package } from 'lucide-react';
import { RecoveryProgressChart } from '@/components/StockBasisRecoveryChart';
import { StockPositionsTable } from '@/components/StockPositionsTable';
import { UnderwaterPositionMetrics } from '@/components/UnderwaterPositionMetrics';

export function StockBasis() {
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
    <div className="container py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stock Basis & Returns</h1>
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
                <TrendingUp className="h-6 w-6 text-green-500" />
              ) : (
                <TrendingDown className="h-6 w-6 text-red-500" />
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
