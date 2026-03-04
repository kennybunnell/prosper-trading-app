/**
 * Portfolio Advisor Page
 * Comprehensive portfolio risk analysis and recommendations
 * Now includes: buying power, sector concentration, position classification
 * (Covered Call, Cash-Secured Put, Spread, Naked), accurate underwater detection
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Target, PieChart,
  Loader2, DollarSign, Gauge, Shield, BarChart3, Layers,
} from 'lucide-react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const formatCurrency = (val: number) => {
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
};

/** Color-coded badge for position classification */
function ClassificationBadge({ classification, spreadWidth, optionType }: {
  classification: string;
  spreadWidth?: number;
  optionType?: string;
}) {
  switch (classification) {
    case 'Spread':
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-500 border border-blue-500/20">
          Spread {spreadWidth ? `($${spreadWidth} wide)` : ''}
        </span>
      );
    case 'Covered Call':
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-500 border border-green-500/20">
          Covered Call
        </span>
      );
    case 'Cash-Secured Put':
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
          Cash-Secured Put
        </span>
      );
    case 'Naked':
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-500 border border-red-500/20">
          Naked {optionType || ''}
        </span>
      );
    default:
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-gray-500/10 text-gray-500 border border-gray-500/20">
          {classification}
        </span>
      );
  }
}

export default function PortfolioAdvisor() {
  const { data, isLoading, error } = trpc.portfolioAdvisor.getDetailedAnalysis.useQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="outline" size="icon" asChild>
              <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <h1 className="text-3xl font-bold">Portfolio Advisor</h1>
          </div>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="outline" size="icon" asChild>
              <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <h1 className="text-3xl font-bold">Portfolio Advisor</h1>
          </div>
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span>Failed to load portfolio analysis. Please check your Tastytrade credentials in Settings.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const pcs = data.currentPositions.positionClassificationSummary;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="icon" asChild>
            <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h1 className="text-3xl font-bold">Portfolio Advisor</h1>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            Section 1: Risk Overview + Buying Power
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            Risk Overview
          </h2>

          {/* Top row: Risk Score + Buying Power */}
          <div className="grid gap-4 md:grid-cols-3 mb-4">
            {/* Risk Score */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Risk Score</p>
                <p className={cn(
                  "text-4xl font-bold",
                  data.riskScore >= 70 && 'text-red-500',
                  data.riskScore >= 40 && data.riskScore < 70 && 'text-orange-500',
                  data.riskScore < 40 && 'text-green-500'
                )}>
                  {data.riskScore}
                  <span className="text-lg text-muted-foreground">/100</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.riskScore >= 70 ? 'High risk — take action' :
                   data.riskScore >= 40 ? 'Moderate risk — monitor closely' :
                   'Low risk — well managed'}
                </p>
              </CardContent>
            </Card>

            {/* Total Buying Power */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">
                  <DollarSign className="h-3.5 w-3.5 inline mr-1" />
                  Total Buying Power
                </p>
                <p className="text-3xl font-bold text-green-500">
                  {formatCurrency(data.buyingPower.totalBuyingPower)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Net Liq: {formatCurrency(data.buyingPower.totalNetLiq)}
                </p>
              </CardContent>
            </Card>

            {/* Capital Utilization */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">
                  <Gauge className="h-3.5 w-3.5 inline mr-1" />
                  Capital Utilization
                </p>
                <p className={cn(
                  "text-3xl font-bold",
                  data.buyingPower.capitalUtilizationPct >= 75 && 'text-red-500',
                  data.buyingPower.capitalUtilizationPct >= 50 && data.buyingPower.capitalUtilizationPct < 75 && 'text-orange-500',
                  data.buyingPower.capitalUtilizationPct < 50 && 'text-green-500'
                )}>
                  {data.buyingPower.capitalUtilizationPct}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">Target: &lt;75%</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-account buying power */}
          {data.buyingPower.accountBalances.length > 1 && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mb-4">
              {data.buyingPower.accountBalances.map((acct: any) => (
                <Card key={acct.accountNumber} className="backdrop-blur-sm bg-card/60">
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-muted-foreground truncate">{acct.nickname}</p>
                    <p className="text-lg font-bold">{formatCurrency(acct.derivativeBuyingPower)}</p>
                    <p className="text-xs text-muted-foreground">
                      Net Liq: {formatCurrency(acct.netLiquidatingValue)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            Section 2: Position Classification Summary
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-500" />
            Position Analysis
          </h2>

          {/* Position classification summary cards */}
          <div className="grid gap-4 md:grid-cols-5 mb-4">
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Total Capital at Risk</p>
                <p className="text-2xl font-bold">{formatCurrency(data.currentPositions.totalCapitalAtRisk)}</p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80 border-blue-500/20">
              <CardContent className="pt-6">
                <p className="text-sm text-blue-400 mb-1">Spreads</p>
                <p className="text-2xl font-bold">{pcs.totalSpreads}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(pcs.spreadCapitalAtRisk)} at risk
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80 border-green-500/20">
              <CardContent className="pt-6">
                <p className="text-sm text-green-400 mb-1">Covered Calls</p>
                <p className="text-2xl font-bold">{pcs.totalCoveredCalls}</p>
                <p className="text-xs text-muted-foreground">
                  {pcs.coveredCallCount} contracts
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80 border-cyan-500/20">
              <CardContent className="pt-6">
                <p className="text-sm text-cyan-400 mb-1">Cash-Secured Puts</p>
                <p className="text-2xl font-bold">{pcs.totalCashSecuredPuts}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(pcs.cashSecuredPutCapitalAtRisk)} collateral
                </p>
              </CardContent>
            </Card>
            <Card className={cn(
              "backdrop-blur-sm bg-card/80",
              pcs.totalNaked > 0 ? "border-red-500/30" : "border-green-500/20"
            )}>
              <CardContent className="pt-6">
                <p className={cn("text-sm mb-1", pcs.totalNaked > 0 ? "text-red-400" : "text-green-400")}>
                  Naked
                </p>
                <p className={cn("text-2xl font-bold", pcs.totalNaked > 0 && "text-red-500")}>
                  {pcs.totalNaked}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pcs.totalNaked > 0 ? formatCurrency(pcs.nakedCapitalAtRisk) + ' at risk' : 'None — well managed'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tickers + Sectors row */}
          <div className="grid gap-4 md:grid-cols-2 mb-4">
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Unique Tickers</p>
                <p className="text-2xl font-bold">{data.currentPositions.tickerCount}</p>
                <p className="text-xs text-muted-foreground">
                  Diversification: {data.currentPositions.diversificationScore}/100
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Sectors</p>
                <p className="text-2xl font-bold">{data.currentPositions.sectorCount}</p>
                <p className="text-xs text-muted-foreground">
                  Target: 5+ sectors for diversification
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Concentration Risk Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-500" />
                  <CardTitle>Ticker Concentration</CardTitle>
                </div>
                <CardDescription>Capital allocation by ticker (spread-aware)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.currentPositions.concentrations.slice(0, 10).map((item: any) => (
                    <div key={item.ticker} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.ticker}</span>
                          <span className="text-xs text-muted-foreground">{item.sector}</span>
                        </div>
                        <span className={cn(
                          "font-bold",
                          item.percentage >= 10 && 'text-red-500',
                          item.percentage >= 5 && item.percentage < 10 && 'text-orange-500',
                          item.percentage < 5 && 'text-green-500'
                        )}>
                          {item.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(item.capitalAtRisk)} at risk
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div
                          className={cn(
                            "h-1.5 rounded-full transition-all",
                            item.percentage >= 10 && 'bg-red-500',
                            item.percentage >= 5 && item.percentage < 10 && 'bg-orange-500',
                            item.percentage < 5 && 'bg-green-500'
                          )}
                          style={{ width: `${Math.min(100, item.percentage * 5)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {data.currentPositions.concentrations.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      + {data.currentPositions.concentrations.length - 10} more tickers
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sector Concentration Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-purple-500" />
                  <CardTitle>Sector Concentration</CardTitle>
                </div>
                <CardDescription>Capital allocation by sector (target: &lt;25% per sector)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.currentPositions.sectorConcentrations.map((sector: any) => (
                    <div key={sector.sector} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{sector.sector}</span>
                          <span className="text-xs text-muted-foreground">({sector.tickerCount} tickers)</span>
                        </div>
                        <span className={cn(
                          "font-bold",
                          sector.percentage >= 40 && 'text-red-500',
                          sector.percentage >= 25 && sector.percentage < 40 && 'text-orange-500',
                          sector.percentage < 25 && 'text-green-500'
                        )}>
                          {sector.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(sector.capitalAtRisk)} at risk
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div
                          className={cn(
                            "h-1.5 rounded-full transition-all",
                            sector.percentage >= 40 && 'bg-red-500',
                            sector.percentage >= 25 && sector.percentage < 40 && 'bg-orange-500',
                            sector.percentage < 25 && 'bg-green-500'
                          )}
                          style={{ width: `${Math.min(100, sector.percentage * 2)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Underwater Positions Card */}
          <Card className="mt-6 backdrop-blur-sm bg-card/80">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-orange-500" />
                <CardTitle>Underwater Positions</CardTitle>
              </div>
              <CardDescription>Short options where underlying has moved past the strike (ITM)</CardDescription>
            </CardHeader>
            <CardContent>
              {data.currentPositions.underwaterPositions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Ticker</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Type</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Side</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Strike</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Current</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">% ITM</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Max Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.currentPositions.underwaterPositions.map((pos: any, idx: number) => (
                        <tr key={`${pos.ticker}-${pos.strike}-${idx}`} className="border-b border-border/10">
                          <td className="py-2 pr-4 font-medium">{pos.ticker}</td>
                          <td className="py-2 pr-4">
                            <ClassificationBadge
                              classification={pos.classification}
                              spreadWidth={pos.spreadWidth}
                              optionType={pos.optionType}
                            />
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {pos.optionType === 'PUT' ? 'Short Put' : 'Short Call'}
                          </td>
                          <td className="py-2 pr-4 text-right">${pos.strike.toFixed(2)}</td>
                          <td className="py-2 pr-4 text-right">${pos.currentPrice.toFixed(2)}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className={cn(
                              "font-bold",
                              pos.percentITM >= 10 && 'text-red-500',
                              pos.percentITM >= 5 && pos.percentITM < 10 && 'text-orange-500',
                              pos.percentITM < 5 && 'text-yellow-500',
                            )}>
                              -{pos.percentITM.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            {pos.maxLoss ? formatCurrency(pos.maxLoss) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-500 py-4">
                  <span className="text-lg">✅</span>
                  <span className="font-medium">All short options are OTM — no underwater positions</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Portfolio Delta Card */}
          <Card className="mt-6 backdrop-blur-sm bg-card/80">
            <CardHeader>
              <CardTitle>Portfolio Delta Exposure</CardTitle>
              <CardDescription>Directional risk across all positions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Total Delta</p>
                  <p className="text-2xl font-bold">{data.currentPositions.totalDelta.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Delta per $1000</p>
                  <p className="text-2xl font-bold">{data.currentPositions.deltaPer1000.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Risk Level</p>
                  <p className={cn(
                    "text-2xl font-bold",
                    Math.abs(data.currentPositions.deltaPer1000) > 5 && 'text-red-500',
                    Math.abs(data.currentPositions.deltaPer1000) > 3 && Math.abs(data.currentPositions.deltaPer1000) <= 5 && 'text-orange-500',
                    Math.abs(data.currentPositions.deltaPer1000) <= 3 && 'text-green-500'
                  )}>
                    {Math.abs(data.currentPositions.deltaPer1000) > 5 && 'High'}
                    {Math.abs(data.currentPositions.deltaPer1000) > 3 && Math.abs(data.currentPositions.deltaPer1000) <= 5 && 'Medium'}
                    {Math.abs(data.currentPositions.deltaPer1000) <= 3 && 'Low'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            Section 3: Past Trades Analysis (placeholder notice)
            ═══════════════════════════════════════════════════════════════════ */}
        {data.pastTrades.isPlaceholder && (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-gray-500" />
              Past Trades Analysis
            </h2>
            <Card className="backdrop-blur-sm bg-card/80 border-dashed">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Layers className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Coming Soon</p>
                    <p className="text-sm">Historical trade analysis will pull real win/loss data from your Tastytrade transaction history. This section previously showed hardcoded placeholder data which has been removed for accuracy.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            Section 4: Recommendations
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            Recommendations
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Position Sizing Rules Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <CardTitle>Position Sizing Rules</CardTitle>
                <CardDescription>2-10-25 rule compliance</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Max 2% per position</p>
                    <p className="text-xs text-muted-foreground">
                      {data.recommendations.positionSizing.violations2pct === 0
                        ? '✅ All positions comply'
                        : `⚠️ ${data.recommendations.positionSizing.violations2pct} positions exceed 2%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Max 10% per ticker</p>
                    <p className="text-xs text-muted-foreground">
                      {data.recommendations.positionSizing.violations10pct === 0
                        ? '✅ All tickers comply'
                        : `⚠️ ${data.recommendations.positionSizing.violations10pct} tickers exceed 10%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Max 25% per sector</p>
                    <p className="text-xs text-muted-foreground">
                      {data.recommendations.positionSizing.violations25pct === 0
                        ? '✅ All sectors comply'
                        : `⚠️ ${data.recommendations.positionSizing.violations25pct} sectors exceed 25%`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Items Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <CardTitle>Recommended Actions</CardTitle>
                <CardDescription>Priority improvements</CardDescription>
              </CardHeader>
              <CardContent>
                {data.recommendations.actionItems.length > 0 ? (
                  <div className="space-y-3">
                    {data.recommendations.actionItems.map((action: { priority: string; description: string }, idx: number) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className={cn(
                          "w-2 h-2 rounded-full mt-2 shrink-0",
                          action.priority === 'high' && 'bg-red-500',
                          action.priority === 'medium' && 'bg-orange-500',
                          action.priority === 'low' && 'bg-yellow-500'
                        )} />
                        <p className="text-sm">{action.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-green-500 py-4">
                    <span className="text-lg">✅</span>
                    <span className="font-medium">No action items — portfolio looks healthy</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
