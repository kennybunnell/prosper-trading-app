import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { TrendingUp, DollarSign, Percent, Clock, AlertCircle, PieChart, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

interface StrategyAllocation {
  csp: number;
  bullPutSpread: number;
  bearCallSpread: number;
  cc: number;
  pmcc: number;
}

// Expected monthly ROC for each strategy
const STRATEGY_ROC = {
  csp: 3, // 2-4% monthly
  bullPutSpread: 15, // 12-18% monthly (on capital at risk)
  bearCallSpread: 15, // 12-18% monthly
  cc: 3, // 2-4% monthly
  pmcc: 10, // 8-12% monthly
};

export function InteractiveROICalculator() {
  const { data: historicalData } = trpc.projections.getHistoricalPerformance.useQuery();

  const [investmentAmount, setInvestmentAmount] = useState(100000);
  const [annualDeposit, setAnnualDeposit] = useState(12000);
  const [timeHorizon, setTimeHorizon] = useState(24); // months
  const [compoundEnabled, setCompoundEnabled] = useState(true);
  const [interestRate, setInterestRate] = useState(7); // cost of capital (HELOC/margin)
  const [showStrategyMix, setShowStrategyMix] = useState(false);

  // Strategy allocation (percentages)
  const [allocation, setAllocation] = useState<StrategyAllocation>({
    csp: 40,
    bullPutSpread: 35,
    bearCallSpread: 15,
    cc: 10,
    pmcc: 0,
  });

  // Calculate recommended allocation based on portfolio size
  const getRecommendedAllocation = (portfolioSize: number): StrategyAllocation => {
    if (portfolioSize < 100000) {
      // Small portfolio: maximize capital efficiency with spreads
      return {
        csp: 30,
        bullPutSpread: 40,
        bearCallSpread: 20,
        cc: 10,
        pmcc: 0,
      };
    } else if (portfolioSize < 500000) {
      // Medium portfolio: balanced approach
      return {
        csp: 25,
        bullPutSpread: 35,
        bearCallSpread: 25,
        cc: 10,
        pmcc: 5,
      };
    } else {
      // Large portfolio: can afford more capital-intensive positions
      return {
        csp: 40,
        bullPutSpread: 30,
        bearCallSpread: 20,
        cc: 5,
        pmcc: 5,
      };
    }
  };

  const handleLoadRecommended = () => {
    const recommended = getRecommendedAllocation(investmentAmount);
    setAllocation(recommended);
  };

  const updateAllocation = (strategy: keyof StrategyAllocation, value: number) => {
    setAllocation((prev) => ({ ...prev, [strategy]: value }));
  };

  const allocationTotal = Object.values(allocation).reduce((sum, val) => sum + val, 0);

  // Calculate blended monthly return based on strategy allocation
  const blendedMonthlyReturn = useMemo(() => {
    if (allocationTotal === 0) return 2; // Default fallback
    
    return (
      (allocation.csp * STRATEGY_ROC.csp +
        allocation.bullPutSpread * STRATEGY_ROC.bullPutSpread +
        allocation.bearCallSpread * STRATEGY_ROC.bearCallSpread +
        allocation.cc * STRATEGY_ROC.cc +
        allocation.pmcc * STRATEGY_ROC.pmcc) /
      allocationTotal
    );
  }, [allocation, allocationTotal]);

  // Calculate annualized return from monthly return (12 months per year)
  const annualizedReturn = ((1 + blendedMonthlyReturn / 100) ** 12 - 1) * 100;

  const calculations = useMemo(() => {
    const monthlyReturnDecimal = blendedMonthlyReturn / 100;
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
  }, [investmentAmount, annualDeposit, blendedMonthlyReturn, timeHorizon, compoundEnabled, interestRate]);

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

          {/* Target Monthly Return (now shows blended rate) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Target Monthly Return</Label>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">
                  {blendedMonthlyReturn.toFixed(1)}%/month
                </span>
                <div className="px-3 py-1 rounded-md bg-primary/10 border border-primary/20">
                  <span className="text-xs text-muted-foreground">Annual: </span>
                  <span className="text-sm font-semibold text-primary">
                    {annualizedReturn.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <PieChart className="w-3 h-3" />
              <span>Blended rate based on strategy mix</span>
            </div>
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

      {/* Strategy Mix Section (Collapsible) */}
      <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
        <button
          onClick={() => setShowStrategyMix(!showStrategyMix)}
          className="w-full flex items-center justify-between mb-4 hover:opacity-80 transition-opacity"
        >
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <PieChart className="w-5 h-5 text-primary" />
            Strategy Mix
            {allocationTotal !== 100 && (
              <span className="text-xs text-yellow-500 font-normal">(Total: {allocationTotal}%)</span>
            )}
          </h3>
          {showStrategyMix ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </button>

        {showStrategyMix && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Adjust your capital allocation across strategies to calculate blended returns
            </p>

            {/* Load Recommended Button */}
            <Button
              onClick={handleLoadRecommended}
              variant="outline"
              className="w-full gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Load Recommended Allocation
              <span className="text-xs text-muted-foreground ml-1">
                (based on ${investmentAmount.toLocaleString()} portfolio)
              </span>
            </Button>

            {/* Allocation Warning */}
            {allocationTotal !== 100 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <p className="text-sm text-yellow-500">
                  Strategy allocation total is {allocationTotal}%. Adjust sliders to equal 100%.
                </p>
              </div>
            )}

            {/* Strategy Sliders */}
            <div className="space-y-5">
              {/* CSP */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Cash-Secured Puts</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{STRATEGY_ROC.csp}% ROC</span>
                    <span className="text-sm font-medium w-12 text-right">{allocation.csp}%</span>
                  </div>
                </div>
                <Slider
                  value={[allocation.csp]}
                  onValueChange={([value]) => updateAllocation('csp', value)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>

              {/* Bull Put Spread */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Bull Put Spreads</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{STRATEGY_ROC.bullPutSpread}% ROC</span>
                    <span className="text-sm font-medium w-12 text-right">{allocation.bullPutSpread}%</span>
                  </div>
                </div>
                <Slider
                  value={[allocation.bullPutSpread]}
                  onValueChange={([value]) => updateAllocation('bullPutSpread', value)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>

              {/* Bear Call Spread */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Bear Call Spreads</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{STRATEGY_ROC.bearCallSpread}% ROC</span>
                    <span className="text-sm font-medium w-12 text-right">{allocation.bearCallSpread}%</span>
                  </div>
                </div>
                <Slider
                  value={[allocation.bearCallSpread]}
                  onValueChange={([value]) => updateAllocation('bearCallSpread', value)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>

              {/* CC */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Covered Calls</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{STRATEGY_ROC.cc}% ROC</span>
                    <span className="text-sm font-medium w-12 text-right">{allocation.cc}%</span>
                  </div>
                </div>
                <Slider
                  value={[allocation.cc]}
                  onValueChange={([value]) => updateAllocation('cc', value)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>

              {/* PMCC */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Poor Man's Covered Calls</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{STRATEGY_ROC.pmcc}% ROC</span>
                    <span className="text-sm font-medium w-12 text-right">{allocation.pmcc}%</span>
                  </div>
                </div>
                <Slider
                  value={[allocation.pmcc]}
                  onValueChange={([value]) => updateAllocation('pmcc', value)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>
            </div>

            {/* Total Allocation Display */}
            <div className="pt-4 border-t border-border/50">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total Allocation:</span>
                <span className={`text-sm font-bold ${allocationTotal === 100 ? 'text-green-500' : 'text-yellow-500'}`}>
                  {allocationTotal}%
                </span>
              </div>
            </div>
          </div>
        )}
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
