import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/lib/trpc';
import { TrendingUp, DollarSign, Percent, Clock, AlertCircle } from 'lucide-react';

export function InteractiveROICalculator() {
  const { data: historicalData } = trpc.projections.getHistoricalPerformance.useQuery();

  // Default to historical average or 2% monthly if no data
  // Note: avgMonthlyPremium is absolute dollars, not a percentage
  // We'll use 2% monthly as default and show historical premium for reference
  const defaultMonthlyReturn = 2;

  const [investmentAmount, setInvestmentAmount] = useState(100000);
  const [annualDeposit, setAnnualDeposit] = useState(12000);
  const [monthlyReturn, setMonthlyReturn] = useState(defaultMonthlyReturn);
  const [timeHorizon, setTimeHorizon] = useState(24); // months
  const [compoundEnabled, setCompoundEnabled] = useState(true);
  const [interestRate, setInterestRate] = useState(7); // cost of capital (HELOC/margin)

  // Calculate annualized return from monthly return
  const annualizedReturn = ((1 + monthlyReturn / 100) ** 12 - 1) * 100;

  const calculations = useMemo(() => {
    const monthlyReturnDecimal = monthlyReturn / 100;
    const monthlyDeposit = annualDeposit / 12;
    const monthlyInterestRate = interestRate / 100 / 12;

    let balance = investmentAmount;
    let totalDeposits = investmentAmount;
    let totalPremium = 0;
    let totalInterest = 0;

    for (let month = 1; month <= timeHorizon; month++) {
      // Add monthly deposit
      balance += monthlyDeposit;
      totalDeposits += monthlyDeposit;

      // Calculate premium earned this month
      const monthlyPremiumEarned = balance * monthlyReturnDecimal;
      totalPremium += monthlyPremiumEarned;

      // Calculate interest cost on deployed capital
      const monthlyInterest = balance * monthlyInterestRate;
      totalInterest += monthlyInterest;

      // Update balance
      if (compoundEnabled) {
        balance += monthlyPremiumEarned - monthlyInterest;
      }
    }

    const netProfit = totalPremium - totalInterest;
    const netReturn = (netProfit / totalDeposits) * 100;

    return {
      finalBalance: compoundEnabled ? balance : totalDeposits,
      totalPremium,
      totalInterest,
      netProfit,
      netReturn,
      totalDeposits,
    };
  }, [investmentAmount, annualDeposit, monthlyReturn, timeHorizon, compoundEnabled, interestRate]);

  return (
    <div className="space-y-6">
      {/* Input Controls */}
      <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
        <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          ROI Calculator Settings
        </h3>

        <div className="space-y-6">
          {/* Investment Amount */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Starting Capital</Label>
              <span className="text-sm font-medium">
                ${investmentAmount.toLocaleString()}
              </span>
            </div>
            <Slider
              value={[investmentAmount]}
              onValueChange={([value]) => setInvestmentAmount(value)}
              min={0}
              max={5000000}
              step={10000}
              className="w-full"
            />
          </div>

          {/* Annual Deposit */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Annual Contribution</Label>
              <span className="text-sm font-medium">
                ${annualDeposit.toLocaleString()}/year
              </span>
            </div>
            <Slider
              value={[annualDeposit]}
              onValueChange={([value]) => setAnnualDeposit(value)}
              min={0}
              max={500000}
              step={5000}
              className="w-full"
            />
          </div>

          {/* Target Monthly Return */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Target Monthly Return</Label>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">
                  {monthlyReturn.toFixed(1)}%/month
                </span>
                <div className="px-3 py-1 rounded-md bg-primary/10 border border-primary/20">
                  <span className="text-xs text-muted-foreground">Annual: </span>
                  <span className="text-sm font-semibold text-primary">
                    {annualizedReturn.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
            <Slider
              value={[monthlyReturn]}
              onValueChange={([value]) => setMonthlyReturn(value)}
              min={0.5}
              max={15}
              step={0.5}
              className="w-full"
            />
            {historicalData && (
              <p className="text-xs text-muted-foreground">
                Your historical avg: ${historicalData.avgMonthlyPremium.toLocaleString()}/month
              </p>
            )}
          </div>

          {/* Time Horizon */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Time Horizon</Label>
              <span className="text-sm font-medium">
                {timeHorizon} months ({(timeHorizon / 12).toFixed(1)} years)
              </span>
            </div>
            <Slider
              value={[timeHorizon]}
              onValueChange={([value]) => setTimeHorizon(value)}
              min={6}
              max={60}
              step={6}
              className="w-full"
            />
          </div>

          {/* Loan Interest Rate */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Loan Interest Rate</Label>
              <span className="text-sm font-medium">
                {interestRate.toFixed(1)}%
              </span>
            </div>
            <Slider
              value={[interestRate]}
              onValueChange={([value]) => setInterestRate(value)}
              min={0}
              max={20}
              step={0.5}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Cost of capital (HELOC/margin interest)
            </p>
          </div>

          {/* Compound Toggle */}
          <div className="flex items-center justify-between pt-4 border-t border-border/50">
            <div className="space-y-0.5">
              <Label>Reinvest Profits</Label>
              <p className="text-xs text-muted-foreground">
                Compound returns by reinvesting net profits
              </p>
            </div>
            <Switch
              checked={compoundEnabled}
              onCheckedChange={setCompoundEnabled}
            />
          </div>
        </div>
      </Card>

      {/* Results Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6 bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-border/50 backdrop-blur">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Gross Premium</p>
              <p className="text-2xl font-bold text-foreground">
                ${calculations.totalPremium.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-background/50 text-emerald-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Total premium earned</p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-red-500/20 to-rose-500/20 border-border/50 backdrop-blur">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Interest Cost</p>
              <p className="text-2xl font-bold text-foreground">
                ${calculations.totalInterest.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-background/50 text-rose-400">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{interestRate}% cost of capital</p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border-border/50 backdrop-blur">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Net Profit</p>
              <p className="text-2xl font-bold text-foreground">
                ${calculations.netProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-background/50 text-cyan-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">After interest costs</p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-border/50 backdrop-blur">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Net Return</p>
              <p className="text-2xl font-bold text-foreground">
                {calculations.netReturn.toFixed(1)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-background/50 text-pink-400">
              <Percent className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Return on capital</p>
        </Card>
      </div>

      {/* Final Balance */}
      {compoundEnabled && (
        <Card className="p-6 bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-border/50 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Projected Portfolio Value</p>
              <p className="text-3xl font-bold text-foreground">
                ${calculations.finalBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                After {timeHorizon} months with compounding
              </p>
            </div>
            <div className="p-4 rounded-lg bg-background/50 text-orange-400">
              <Clock className="w-8 h-8" />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
