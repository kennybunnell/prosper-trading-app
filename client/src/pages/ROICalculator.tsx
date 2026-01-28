import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, DollarSign, PieChart, AlertCircle } from 'lucide-react';

interface StrategyAllocation {
  csp: number;
  bullPutSpread: number;
  bearCallSpread: number;
  cc: number;
  pmcc: number;
}

interface StrategyParams {
  avgPremium: number;
  positionsAtOnce: number;
  avgHoldDays: number;
  winRate: number;
}

interface MonthlyProjection {
  month: number;
  starting: number;
  cspIncome: number;
  bullPutIncome: number;
  bearCallIncome: number;
  ccIncome: number;
  pmccIncome: number;
  totalIncome: number;
  losses: number;
  netProfit: number;
  ending: number;
  roc: number;
  cumulativeRoc: number;
}

export default function ROICalculator() {
  // Portfolio settings
  const [startingCapital, setStartingCapital] = useState(1500000);
  const [capitalAddition, setCapitalAddition] = useState(2000000);
  const [capitalAdditionMonth, setCapitalAdditionMonth] = useState(6);
  const [reinvestProfits, setReinvestProfits] = useState(true);
  const [closeProfitTarget, setCloseProfitTarget] = useState(70);

  // Strategy allocation (percentages)
  const [allocation, setAllocation] = useState<StrategyAllocation>({
    csp: 25,
    bullPutSpread: 35,
    bearCallSpread: 25,
    cc: 10,
    pmcc: 5,
  });

  // Strategy parameters
  const [cspParams, setCspParams] = useState<StrategyParams>({
    avgPremium: 200,
    positionsAtOnce: 20,
    avgHoldDays: 10,
    winRate: 80,
  });

  const [bullPutParams, setBullPutParams] = useState<StrategyParams>({
    avgPremium: 40,
    positionsAtOnce: 200,
    avgHoldDays: 5,
    winRate: 80,
  });

  const [bearCallParams, setBearCallParams] = useState<StrategyParams>({
    avgPremium: 40,
    positionsAtOnce: 150,
    avgHoldDays: 5,
    winRate: 80,
  });

  const [ccParams, setCcParams] = useState<StrategyParams>({
    avgPremium: 200,
    positionsAtOnce: 10,
    avgHoldDays: 10,
    winRate: 85,
  });

  const [pmccParams, setPmccParams] = useState<StrategyParams>({
    avgPremium: 150,
    positionsAtOnce: 5,
    avgHoldDays: 10,
    winRate: 75,
  });

  // Calculate monthly projections
  const projections = useMemo(() => {
    const results: MonthlyProjection[] = [];
    let currentCapital = startingCapital;

    for (let month = 1; month <= 12; month++) {
      // Add capital injection if applicable
      if (month === capitalAdditionMonth && capitalAddition > 0) {
        currentCapital += capitalAddition;
      }

      // Calculate allocated capital for each strategy
      const cspCapital = currentCapital * (allocation.csp / 100);
      const bullPutCapital = currentCapital * (allocation.bullPutSpread / 100);
      const bearCallCapital = currentCapital * (allocation.bearCallSpread / 100);
      const ccCapital = currentCapital * (allocation.cc / 100);
      const pmccCapital = currentCapital * (allocation.pmcc / 100);

      // Calculate cycles per month for each strategy
      const daysInMonth = 30;
      const cspCycles = daysInMonth / cspParams.avgHoldDays;
      const bullPutCycles = daysInMonth / bullPutParams.avgHoldDays;
      const bearCallCycles = daysInMonth / bearCallParams.avgHoldDays;
      const ccCycles = daysInMonth / ccParams.avgHoldDays;
      const pmccCycles = daysInMonth / pmccParams.avgHoldDays;

      // Calculate monthly income for each strategy
      const cspIncome = cspParams.avgPremium * cspParams.positionsAtOnce * cspCycles;
      const bullPutIncome = bullPutParams.avgPremium * bullPutParams.positionsAtOnce * bullPutCycles;
      const bearCallIncome = bearCallParams.avgPremium * bearCallParams.positionsAtOnce * bearCallCycles;
      const ccIncome = ccParams.avgPremium * ccParams.positionsAtOnce * ccCycles;
      const pmccIncome = pmccParams.avgPremium * pmccParams.positionsAtOnce * pmccCycles;

      const totalIncome = cspIncome + bullPutIncome + bearCallIncome + ccIncome + pmccIncome;

      // Calculate losses based on win rates (weighted average)
      const totalPositions =
        cspParams.positionsAtOnce +
        bullPutParams.positionsAtOnce +
        bearCallParams.positionsAtOnce +
        ccParams.positionsAtOnce +
        pmccParams.positionsAtOnce;

      const weightedWinRate =
        (cspParams.winRate * cspParams.positionsAtOnce +
          bullPutParams.winRate * bullPutParams.positionsAtOnce +
          bearCallParams.winRate * bearCallParams.positionsAtOnce +
          ccParams.winRate * ccParams.positionsAtOnce +
          pmccParams.winRate * pmccParams.positionsAtOnce) /
        totalPositions;

      const lossRate = (100 - weightedWinRate) / 100;
      const losses = totalIncome * lossRate;

      // Adjust for close profit target (closing at 70% means realizing 70% of premium)
      const closeProfitMultiplier = closeProfitTarget / 100;
      const netProfit = (totalIncome * closeProfitMultiplier) - losses;

      const ending = reinvestProfits ? currentCapital + netProfit : currentCapital;
      const roc = (netProfit / currentCapital) * 100;
      const cumulativeRoc = ((ending - startingCapital) / startingCapital) * 100;

      results.push({
        month,
        starting: currentCapital,
        cspIncome,
        bullPutIncome,
        bearCallIncome,
        ccIncome,
        pmccIncome,
        totalIncome,
        losses,
        netProfit,
        ending,
        roc,
        cumulativeRoc,
      });

      if (reinvestProfits) {
        currentCapital = ending;
      }
    }

    return results;
  }, [
    startingCapital,
    capitalAddition,
    capitalAdditionMonth,
    reinvestProfits,
    closeProfitTarget,
    allocation,
    cspParams,
    bullPutParams,
    bearCallParams,
    ccParams,
    pmccParams,
  ]);

  const finalMonth = projections[11];
  const totalGain = finalMonth.ending - startingCapital - capitalAddition;
  const totalInvested = startingCapital + capitalAddition;
  const totalROI = (totalGain / totalInvested) * 100;

  // Calculate total positions
  const totalPositions =
    cspParams.positionsAtOnce +
    bullPutParams.positionsAtOnce +
    bearCallParams.positionsAtOnce +
    ccParams.positionsAtOnce +
    pmccParams.positionsAtOnce;

  const updateAllocation = (strategy: keyof StrategyAllocation, value: number) => {
    setAllocation((prev) => ({ ...prev, [strategy]: value }));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  const allocationTotal = Object.values(allocation).reduce((sum, val) => sum + val, 0);

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2">ROI Calculator</h1>
        <p className="text-muted-foreground">
          Model your portfolio performance with bull put spreads, bear call spreads, and other strategies
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Month 12 Balance</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(finalMonth.ending)}</div>
            <p className="text-xs text-muted-foreground">
              +{formatCurrency(totalGain)} gain
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total ROI</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(totalROI)}</div>
            <p className="text-xs text-muted-foreground">
              On {formatCurrency(totalInvested)} invested
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Final Monthly Income</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(finalMonth.netProfit)}</div>
            <p className="text-xs text-muted-foreground">
              {formatPercent(finalMonth.roc)} monthly ROC
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Positions</CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPositions}</div>
            <p className="text-xs text-muted-foreground">
              Active at any time
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Allocation Warning */}
      {allocationTotal !== 100 && (
        <Card className="border-yellow-500">
          <CardContent className="flex items-center gap-2 pt-6">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            <p className="text-sm">
              Strategy allocation total is {allocationTotal}%. Adjust sliders to equal 100%.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Portfolio Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Settings</CardTitle>
          <CardDescription>Configure your starting capital and investment strategy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Starting Capital</Label>
              <Input
                type="number"
                value={startingCapital}
                onChange={(e) => setStartingCapital(Number(e.target.value))}
                step={10000}
              />
            </div>

            <div className="space-y-2">
              <Label>Close Profit Target (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[closeProfitTarget]}
                  onValueChange={([value]) => setCloseProfitTarget(value)}
                  min={50}
                  max={90}
                  step={5}
                  className="flex-1"
                />
                <span className="w-12 text-right font-medium">{closeProfitTarget}%</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Capital Addition (Month {capitalAdditionMonth})</Label>
              <Input
                type="number"
                value={capitalAddition}
                onChange={(e) => setCapitalAddition(Number(e.target.value))}
                step={100000}
              />
            </div>

            <div className="space-y-2">
              <Label>Capital Addition Month</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[capitalAdditionMonth]}
                  onValueChange={([value]) => setCapitalAdditionMonth(value)}
                  min={1}
                  max={12}
                  step={1}
                  className="flex-1"
                />
                <span className="w-12 text-right font-medium">Month {capitalAdditionMonth}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="reinvest"
              checked={reinvestProfits}
              onCheckedChange={setReinvestProfits}
            />
            <Label htmlFor="reinvest">Reinvest profits (compound monthly)</Label>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Allocation */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Allocation</CardTitle>
          <CardDescription>
            Adjust the percentage of capital allocated to each strategy (must total 100%)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* CSP */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Cash-Secured Puts (CSP)</Label>
              <span className="font-medium">{allocation.csp}%</span>
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
            <div className="flex justify-between">
              <Label>Bull Put Spreads (Vertical Credit Spreads)</Label>
              <span className="font-medium">{allocation.bullPutSpread}%</span>
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
            <div className="flex justify-between">
              <Label>Bear Call Spreads (Vertical Credit Spreads)</Label>
              <span className="font-medium">{allocation.bearCallSpread}%</span>
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
            <div className="flex justify-between">
              <Label>Covered Calls (CC)</Label>
              <span className="font-medium">{allocation.cc}%</span>
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
            <div className="flex justify-between">
              <Label>Poor Man's Covered Calls (PMCC)</Label>
              <span className="font-medium">{allocation.pmcc}%</span>
            </div>
            <Slider
              value={[allocation.pmcc]}
              onValueChange={([value]) => updateAllocation('pmcc', value)}
              min={0}
              max={100}
              step={5}
            />
          </div>

          <div className="pt-4 border-t">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Total Allocation:</span>
              <span className={`font-bold ${allocationTotal === 100 ? 'text-green-600' : 'text-yellow-600'}`}>
                {allocationTotal}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Parameters - CSP */}
      <Card>
        <CardHeader>
          <CardTitle>Cash-Secured Puts Parameters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Avg Premium per Position</Label>
            <Input
              type="number"
              value={cspParams.avgPremium}
              onChange={(e) => setCspParams({ ...cspParams, avgPremium: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Positions at Once</Label>
            <Input
              type="number"
              value={cspParams.positionsAtOnce}
              onChange={(e) => setCspParams({ ...cspParams, positionsAtOnce: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Avg Hold Days</Label>
            <Input
              type="number"
              value={cspParams.avgHoldDays}
              onChange={(e) => setCspParams({ ...cspParams, avgHoldDays: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Win Rate (%)</Label>
            <Input
              type="number"
              value={cspParams.winRate}
              onChange={(e) => setCspParams({ ...cspParams, winRate: Number(e.target.value) })}
              min={0}
              max={100}
            />
          </div>
        </CardContent>
      </Card>

      {/* Strategy Parameters - Bull Put Spread */}
      <Card>
        <CardHeader>
          <CardTitle>Bull Put Spread Parameters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Avg Premium per Spread</Label>
            <Input
              type="number"
              value={bullPutParams.avgPremium}
              onChange={(e) => setBullPutParams({ ...bullPutParams, avgPremium: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Spreads at Once</Label>
            <Input
              type="number"
              value={bullPutParams.positionsAtOnce}
              onChange={(e) => setBullPutParams({ ...bullPutParams, positionsAtOnce: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Avg Hold Days</Label>
            <Input
              type="number"
              value={bullPutParams.avgHoldDays}
              onChange={(e) => setBullPutParams({ ...bullPutParams, avgHoldDays: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Win Rate (%)</Label>
            <Input
              type="number"
              value={bullPutParams.winRate}
              onChange={(e) => setBullPutParams({ ...bullPutParams, winRate: Number(e.target.value) })}
              min={0}
              max={100}
            />
          </div>
        </CardContent>
      </Card>

      {/* Strategy Parameters - Bear Call Spread */}
      <Card>
        <CardHeader>
          <CardTitle>Bear Call Spread Parameters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Avg Premium per Spread</Label>
            <Input
              type="number"
              value={bearCallParams.avgPremium}
              onChange={(e) => setBearCallParams({ ...bearCallParams, avgPremium: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Spreads at Once</Label>
            <Input
              type="number"
              value={bearCallParams.positionsAtOnce}
              onChange={(e) => setBearCallParams({ ...bearCallParams, positionsAtOnce: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Avg Hold Days</Label>
            <Input
              type="number"
              value={bearCallParams.avgHoldDays}
              onChange={(e) => setBearCallParams({ ...bearCallParams, avgHoldDays: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Win Rate (%)</Label>
            <Input
              type="number"
              value={bearCallParams.winRate}
              onChange={(e) => setBearCallParams({ ...bearCallParams, winRate: Number(e.target.value) })}
              min={0}
              max={100}
            />
          </div>
        </CardContent>
      </Card>

      {/* Strategy Parameters - CC */}
      <Card>
        <CardHeader>
          <CardTitle>Covered Calls Parameters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Avg Premium per Position</Label>
            <Input
              type="number"
              value={ccParams.avgPremium}
              onChange={(e) => setCcParams({ ...ccParams, avgPremium: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Positions at Once</Label>
            <Input
              type="number"
              value={ccParams.positionsAtOnce}
              onChange={(e) => setCcParams({ ...ccParams, positionsAtOnce: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Avg Hold Days</Label>
            <Input
              type="number"
              value={ccParams.avgHoldDays}
              onChange={(e) => setCcParams({ ...ccParams, avgHoldDays: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Win Rate (%)</Label>
            <Input
              type="number"
              value={ccParams.winRate}
              onChange={(e) => setCcParams({ ...ccParams, winRate: Number(e.target.value) })}
              min={0}
              max={100}
            />
          </div>
        </CardContent>
      </Card>

      {/* Strategy Parameters - PMCC */}
      <Card>
        <CardHeader>
          <CardTitle>Poor Man's Covered Calls Parameters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Avg Premium per Position</Label>
            <Input
              type="number"
              value={pmccParams.avgPremium}
              onChange={(e) => setPmccParams({ ...pmccParams, avgPremium: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Positions at Once</Label>
            <Input
              type="number"
              value={pmccParams.positionsAtOnce}
              onChange={(e) => setPmccParams({ ...pmccParams, positionsAtOnce: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Avg Hold Days</Label>
            <Input
              type="number"
              value={pmccParams.avgHoldDays}
              onChange={(e) => setPmccParams({ ...pmccParams, avgHoldDays: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Win Rate (%)</Label>
            <Input
              type="number"
              value={pmccParams.winRate}
              onChange={(e) => setPmccParams({ ...pmccParams, winRate: Number(e.target.value) })}
              min={0}
              max={100}
            />
          </div>
        </CardContent>
      </Card>

      {/* 12-Month Projection Table */}
      <Card>
        <CardHeader>
          <CardTitle>12-Month Projection</CardTitle>
          <CardDescription>Month-by-month breakdown with strategy income</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Starting</TableHead>
                  <TableHead className="text-right">CSP</TableHead>
                  <TableHead className="text-right">Bull Put</TableHead>
                  <TableHead className="text-right">Bear Call</TableHead>
                  <TableHead className="text-right">CC</TableHead>
                  <TableHead className="text-right">PMCC</TableHead>
                  <TableHead className="text-right">Total Income</TableHead>
                  <TableHead className="text-right">Losses</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                  <TableHead className="text-right">Ending</TableHead>
                  <TableHead className="text-right">Monthly ROC</TableHead>
                  <TableHead className="text-right">Cumulative ROC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projections.map((proj) => (
                  <TableRow key={proj.month} className={proj.month === capitalAdditionMonth ? 'bg-blue-50 dark:bg-blue-950' : ''}>
                    <TableCell className="font-medium">
                      {proj.month}
                      {proj.month === capitalAdditionMonth && (
                        <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                          +{formatCurrency(capitalAddition)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(proj.starting)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(proj.cspIncome)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(proj.bullPutIncome)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(proj.bearCallIncome)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(proj.ccIncome)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(proj.pmccIncome)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(proj.totalIncome)}</TableCell>
                    <TableCell className="text-right text-red-600">{formatCurrency(proj.losses)}</TableCell>
                    <TableCell className="text-right font-bold text-green-600">{formatCurrency(proj.netProfit)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(proj.ending)}</TableCell>
                    <TableCell className="text-right">{formatPercent(proj.roc)}</TableCell>
                    <TableCell className="text-right font-medium">{formatPercent(proj.cumulativeRoc)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Breakdown (Month 12)</CardTitle>
          <CardDescription>Income contribution by strategy</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Cash-Secured Puts</span>
              <span className="text-sm font-bold">{formatCurrency(finalMonth.cspIncome)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Bull Put Spreads</span>
              <span className="text-sm font-bold">{formatCurrency(finalMonth.bullPutIncome)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Bear Call Spreads</span>
              <span className="text-sm font-bold">{formatCurrency(finalMonth.bearCallIncome)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Covered Calls</span>
              <span className="text-sm font-bold">{formatCurrency(finalMonth.ccIncome)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Poor Man's Covered Calls</span>
              <span className="text-sm font-bold">{formatCurrency(finalMonth.pmccIncome)}</span>
            </div>
            <div className="pt-4 border-t flex justify-between items-center">
              <span className="font-medium">Total Monthly Income</span>
              <span className="font-bold text-lg">{formatCurrency(finalMonth.totalIncome)}</span>
            </div>
            <div className="flex justify-between items-center text-red-600">
              <span className="font-medium">Expected Losses</span>
              <span className="font-bold">-{formatCurrency(finalMonth.losses)}</span>
            </div>
            <div className="flex justify-between items-center text-green-600">
              <span className="font-medium">Net Profit</span>
              <span className="font-bold text-lg">{formatCurrency(finalMonth.netProfit)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
