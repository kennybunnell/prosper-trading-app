import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TrendingDown, DollarSign, Package, Target } from 'lucide-react';

interface RecoveryMetrics {
  totalUnrealizedLoss: number;
  totalCCPremium: number;
  overallRecoveryPct: number;
  netPosition: number;
  numUnderwater: number;
}

interface UnderwaterPositionMetricsProps {
  data: RecoveryMetrics;
}

export function UnderwaterPositionMetrics({ data }: UnderwaterPositionMetricsProps) {
  // Calculate historical monthly CC rate (assuming 3.5 months of trading)
  const historicalMonths = 3.5;
  const historicalMonthlyRate = data.totalCCPremium / historicalMonths;
  const currentMonthsToBreakeven = historicalMonthlyRate > 0 
    ? Math.abs(data.netPosition) / historicalMonthlyRate 
    : Infinity;

  // Target monthly rate (3x current)
  const targetMonthlyRate = historicalMonthlyRate * 3;
  const targetMonthsToBreakeven = targetMonthlyRate > 0 
    ? Math.abs(data.netPosition) / targetMonthlyRate 
    : Infinity;

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">📊 Underwater Position Recovery</h2>
        <p className="text-sm text-muted-foreground">
          This section tracks your underwater stock positions (from assigned CSPs) and shows how covered call premiums are reducing your cost basis over time.
        </p>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-red-500/5 border-red-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Unrealized Loss</p>
              <p className="text-lg font-bold text-red-500">
                ${Math.abs(data.totalUnrealizedLoss).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-green-500/5 border-green-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CC Premiums Collected</p>
              <p className="text-lg font-bold text-green-500">
                ${data.totalCCPremium.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-blue-500/5 border-blue-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Target className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net Position</p>
              <p className="text-lg font-bold">
                ${Math.abs(data.netPosition).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-green-500">{data.overallRecoveryPct.toFixed(1)}% recovered</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-purple-500/5 border-purple-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Package className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Positions Underwater</p>
              <p className="text-lg font-bold">{data.numUnderwater}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Recovery Progress</span>
          <span className="font-semibold">{data.overallRecoveryPct.toFixed(1)}% to breakeven</span>
        </div>
        <Progress value={Math.min(data.overallRecoveryPct, 100)} className="h-3" />
      </div>

      {/* Recovery Timeline Estimates */}
      <div>
        <h3 className="text-lg font-semibold mb-4">⏱️ Recovery Timeline Estimates</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4 bg-blue-500/5 border-blue-500/20">
            <p className="text-sm font-semibold mb-2">At Current CC Rate:</p>
            {currentMonthsToBreakeven === Infinity ? (
              <p className="text-yellow-500">⚠️ No CC premiums collected yet</p>
            ) : (
              <div>
                <p className="text-2xl font-bold text-blue-500">
                  {currentMonthsToBreakeven.toFixed(1)} months
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  to breakeven at ${historicalMonthlyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
                </p>
              </div>
            )}
          </Card>

          <Card className="p-4 bg-green-500/5 border-green-500/20">
            <p className="text-sm font-semibold mb-2">At Target CC Rate (3x):</p>
            {targetMonthsToBreakeven === Infinity ? (
              <p className="text-yellow-500">⚠️ No CC premiums collected yet</p>
            ) : (
              <div>
                <p className="text-2xl font-bold text-green-500">
                  {targetMonthsToBreakeven.toFixed(1)} months
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  to breakeven at ${targetMonthlyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Recovery Strategy Recommendations */}
      <div>
        <h3 className="text-lg font-semibold mb-4">💡 Recovery Strategy Recommendations</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4 bg-orange-500/5 border-orange-500/20">
            <p className="text-sm font-semibold mb-2">Aggressive Recovery:</p>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• Sell weekly CCs instead of monthly</li>
              <li>• Use 30-day delta for higher premium/lower assignment risk</li>
              <li>• Focus on high IV stocks (NVDA, TSLA, SMCI)</li>
              <li>• Target: 5-10% of stock value per month</li>
            </ul>
          </Card>

          <Card className="p-4 bg-blue-500/5 border-blue-500/20">
            <p className="text-sm font-semibold mb-2">Conservative Recovery:</p>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• Sell monthly CCs at 10-20 delta</li>
              <li>• Switch to under-water stocks when assignment risk is low</li>
              <li>• Wait for stock price recovery + collect premiums</li>
              <li>• Target: 1-3% of stock value per month</li>
            </ul>
          </Card>
        </div>
      </div>
    </Card>
  );
}
