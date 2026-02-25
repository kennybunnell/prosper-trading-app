/**
 * Portfolio Advisor Page
 * Comprehensive portfolio risk analysis and recommendations
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Target, PieChart, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export default function PortfolioAdvisor() {
  const { data, isLoading, error } = trpc.portfolioAdvisor.getDetailedAnalysis.useQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="outline" size="icon" asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
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
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="icon" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Portfolio Advisor</h1>
            <p className="text-muted-foreground">Comprehensive risk analysis and recommendations</p>
          </div>
        </div>

        {/* Section 1: Past Trades Analysis */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">Past Trades Analysis</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Win/Loss Rate Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  <CardTitle>Win/Loss Rate</CardTitle>
                </div>
                <CardDescription>Overall success rate</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-green-500">
                  {data.pastTrades.winRate.toFixed(1)}%
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {data.pastTrades.totalWins} wins / {data.pastTrades.totalLosses} losses
                </p>
              </CardContent>
            </Card>

            {/* Top Performing Tickers Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <CardTitle>Top Performers</CardTitle>
                </div>
                <CardDescription>Best tickers by win rate</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.pastTrades.topPerformers.slice(0, 3).map((ticker: { symbol: string; winRate: number; trades: number }) => (
                    <div key={ticker.symbol} className="flex justify-between items-center">
                      <span className="font-medium">{ticker.symbol}</span>
                      <span className="text-green-500 font-bold">{ticker.winRate.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Worst Performing Tickers Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  <CardTitle>Worst Performers</CardTitle>
                </div>
                <CardDescription>Tickers with highest losses</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.pastTrades.worstPerformers.slice(0, 3).map((ticker: { symbol: string; winRate: number; trades: number }) => (
                    <div key={ticker.symbol} className="flex justify-between items-center">
                      <span className="font-medium">{ticker.symbol}</span>
                      <span className="text-red-500 font-bold">{ticker.winRate.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pattern Detection Card */}
          <Card className="mt-6 backdrop-blur-sm bg-card/80">
            <CardHeader>
              <CardTitle>Pattern Detection</CardTitle>
              <CardDescription>Common factors in losing trades</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.pastTrades.patterns.map((pattern: { description: string; severity: string }, idx: number) => (
                  <div key={idx} className="flex items-start gap-3">
                    <AlertTriangle className={cn(
                      "h-5 w-5 mt-0.5",
                      pattern.severity === 'high' && 'text-red-500',
                      pattern.severity === 'medium' && 'text-orange-500',
                      pattern.severity === 'low' && 'text-yellow-500'
                    )} />
                    <p className="text-sm">{pattern.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section 2: Current Positions Risk Analysis */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">Current Positions Risk Analysis</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Concentration Risk Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-500" />
                  <CardTitle>Concentration Risk</CardTitle>
                </div>
                <CardDescription>Capital allocation by ticker</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.currentPositions.concentrations.map((item: { ticker: string; percentage: number; capitalAtRisk: number }) => (
                    <div key={item.ticker} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{item.ticker}</span>
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
                        ${item.capitalAtRisk.toLocaleString()} at risk
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={cn(
                            "h-2 rounded-full",
                            item.percentage >= 30 && 'bg-red-500',
                            item.percentage >= 20 && item.percentage < 30 && 'bg-orange-500',
                            item.percentage >= 10 && item.percentage < 20 && 'bg-yellow-500',
                            item.percentage < 10 && 'bg-green-500'
                          )}
                          style={{ width: `${Math.min(100, item.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Underwater Positions Card */}
            <Card className="backdrop-blur-sm bg-card/80">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-orange-500" />
                  <CardTitle>Underwater Positions</CardTitle>
                </div>
                <CardDescription>Short puts below strike price</CardDescription>
              </CardHeader>
              <CardContent>
                {data.currentPositions.underwaterPositions.length > 0 ? (
                  <div className="space-y-3">
                    {data.currentPositions.underwaterPositions.map((pos: { ticker: string; strike: number; currentPrice: number; percentBelow: number }) => (
                      <div key={`${pos.ticker}-${pos.strike}`} className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{pos.ticker}</span>
                          <span className="text-red-500 font-bold">-{pos.percentBelow.toFixed(1)}%</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Strike: ${pos.strike.toFixed(2)} | Current: ${pos.currentPrice.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No underwater positions found</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Portfolio Delta Card */}
          <Card className="mt-6 backdrop-blur-sm bg-card/80">
            <CardHeader>
              <CardTitle>Portfolio Delta Exposure</CardTitle>
              <CardDescription>Directional risk across all positions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
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

        {/* Section 3: Future Recommendations */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">Future Recommendations</h2>
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
                    <p className="text-sm font-medium mb-2">Max 2% per position</p>
                    <p className="text-xs text-muted-foreground">
                      {data.recommendations.positionSizing.violations2pct === 0 
                        ? '✅ All positions comply' 
                        : `⚠️ ${data.recommendations.positionSizing.violations2pct} positions exceed 2%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Max 10% per ticker</p>
                    <p className="text-xs text-muted-foreground">
                      {data.recommendations.positionSizing.violations10pct === 0 
                        ? '✅ All tickers comply' 
                        : `⚠️ ${data.recommendations.positionSizing.violations10pct} tickers exceed 10%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Max 25% per sector</p>
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
                <div className="space-y-3">
                  {data.recommendations.actionItems.map((action: { priority: string; description: string }, idx: number) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full mt-2",
                        action.priority === 'high' && 'bg-red-500',
                        action.priority === 'medium' && 'bg-orange-500',
                        action.priority === 'low' && 'bg-yellow-500'
                      )} />
                      <p className="text-sm">{action.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
