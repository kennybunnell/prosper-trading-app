/**
 * Portfolio Advisor Page
 * Comprehensive portfolio risk analysis and recommendations
 * Now includes: buying power, sector concentration, spread summary, accurate underwater detection
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
          <Card className="p-6 bg-card/70 backdrop-blur-sm border-border/30">
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="text-center space-y-2">
                <p className="text-lg">Portfolio analysis unavailable</p>
                <p className="text-sm">Configure your Tastytrade credentials in Settings</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const getRiskColor = (score: number) => {
    if (score >= 80) return 'text-red-500';
    if (score >= 60) return 'text-orange-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-green-500';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="icon" asChild>
            <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Portfolio Advisor</h1>
            <p className="text-muted-foreground">Comprehensive risk analysis across all accounts</p>
          </div>
          <div className="ml-auto">
            <div className={cn(
              "px-4 py-2 rounded-lg font-bold text-lg border",
              data.riskScore >= 80 && 'bg-red-500/10 border-red-500/50 text-red-500',
              data.riskScore >= 60 && data.riskScore < 80 && 'bg-orange-500/10 border-orange-500/50 text-orange-500',
              data.riskScore >= 40 && data.riskScore < 60 && 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500',
              data.riskScore < 40 && 'bg-green-500/10 border-green-500/50 text-green-500',
            )}>
              Risk: {data.riskScore}/100
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            Section 1: Buying Power & Account Balances
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-emerald-500" />
            Buying Power & Account Balances
          </h2>

          {/* Summary row */}
          <div className="grid gap-4 md:grid-cols-3 mb-4">
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Total Buying Power</p>
                <p className="text-3xl font-bold text-emerald-500">
                  {formatCurrency(data.buyingPower.totalBuyingPower)}
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Total Net Liquidating Value</p>
                <p className="text-3xl font-bold">
                  {formatCurrency(data.buyingPower.totalNetLiq)}
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Capital Utilization</p>
                <p className={cn("text-3xl font-bold", getRiskColor(data.buyingPower.capitalUtilizationPct))}>
                  {data.buyingPower.capitalUtilizationPct}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">Target: below 75%</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-account breakdown */}
          {data.buyingPower.accountBalances.length > 0 && (
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Per-Account Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Account</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Type</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Buying Power</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Net Liq</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Cash Available</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Maint. Req.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.buyingPower.accountBalances.map((acct: any) => (
                        <tr key={acct.accountNumber} className="border-b border-border/10">
                          <td className="py-2 pr-4 font-medium">{acct.nickname}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{acct.accountType}</td>
                          <td className="py-2 pr-4 text-right text-emerald-500 font-medium">
                            {formatCurrency(acct.derivativeBuyingPower)}
                          </td>
                          <td className="py-2 pr-4 text-right">{formatCurrency(acct.netLiquidatingValue)}</td>
                          <td className="py-2 pr-4 text-right">{formatCurrency(acct.cashAvailable)}</td>
                          <td className="py-2 text-right">{formatCurrency(acct.maintenanceRequirement)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            Section 2: Current Positions Risk Analysis
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            Current Positions Risk Analysis
          </h2>

          {/* Summary stats row */}
          <div className="grid gap-4 md:grid-cols-4 mb-4">
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Total Capital at Risk</p>
                <p className="text-2xl font-bold">{formatCurrency(data.currentPositions.totalCapitalAtRisk)}</p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Spread Positions</p>
                <p className="text-2xl font-bold">{data.currentPositions.spreadSummary.totalSpreads}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(data.currentPositions.spreadSummary.spreadCapitalAtRisk)} at risk
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Standalone Shorts</p>
                <p className="text-2xl font-bold">{data.currentPositions.spreadSummary.totalStandaloneShorts}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(data.currentPositions.spreadSummary.standaloneCapitalAtRisk)} at risk
                </p>
              </CardContent>
            </Card>
            <Card className="backdrop-blur-sm bg-card/80">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Unique Tickers</p>
                <p className="text-2xl font-bold">{data.currentPositions.tickerCount}</p>
                <p className="text-xs text-muted-foreground">
                  {data.currentPositions.sectorCount} sectors
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
                          item.percentage >= 30 && 'text-red-500',
                          item.percentage >= 20 && item.percentage < 30 && 'text-orange-500',
                          item.percentage >= 10 && item.percentage < 20 && 'text-yellow-500',
                          item.percentage < 10 && 'text-green-500'
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
                            item.percentage >= 30 && 'bg-red-500',
                            item.percentage >= 20 && item.percentage < 30 && 'bg-orange-500',
                            item.percentage >= 10 && item.percentage < 20 && 'bg-yellow-500',
                            item.percentage < 10 && 'bg-green-500'
                          )}
                          style={{ width: `${Math.min(100, item.percentage * 2)}%` }}
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
                            {pos.isSpread ? (
                              <span className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                Spread (${pos.spreadWidth} wide)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-xs bg-orange-500/10 text-orange-500 border border-orange-500/20">
                                Naked
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right">${pos.strike.toFixed(2)}</td>
                          <td className="py-2 pr-4 text-right">${pos.currentPrice.toFixed(2)}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className={cn(
                              "font-bold",
                              pos.percentBelow >= 10 && 'text-red-500',
                              pos.percentBelow >= 5 && pos.percentBelow < 10 && 'text-orange-500',
                              pos.percentBelow < 5 && 'text-yellow-500',
                            )}>
                              -{pos.percentBelow.toFixed(1)}%
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
