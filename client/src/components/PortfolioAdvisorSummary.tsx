/**
 * Portfolio Advisor Summary Cards
 * Displays high-level portfolio risk metrics on the Dashboard homepage
 * Now includes: buying power, accurate underwater count, real sector count
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { AlertTriangle, Target, TrendingDown, PieChart, Loader2, DollarSign, Gauge } from 'lucide-react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export function PortfolioAdvisorSummary() {
  const { data, isLoading, error } = trpc.portfolioAdvisor.getSummary.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-6 bg-card/70 backdrop-blur-sm border-border/30">
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-lg">Portfolio analysis unavailable</p>
            <p className="text-sm">Configure your Tastytrade credentials in Settings</p>
          </div>
        </div>
      </Card>
    );
  }

  const getRiskColor = (score: number) => {
    if (score >= 80) return 'text-red-500 border-red-500/50 bg-red-500/10';
    if (score >= 60) return 'text-orange-500 border-orange-500/50 bg-orange-500/10';
    if (score >= 40) return 'text-yellow-500 border-yellow-500/50 bg-yellow-500/10';
    return 'text-green-500 border-green-500/50 bg-green-500/10';
  };

  const getConcentrationColor = (pct: number) => {
    if (pct >= 30) return 'text-red-500';
    if (pct >= 20) return 'text-orange-500';
    if (pct >= 10) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getUtilizationColor = (pct: number) => {
    if (pct >= 80) return 'text-red-500';
    if (pct >= 60) return 'text-orange-500';
    if (pct >= 40) return 'text-yellow-500';
    return 'text-green-500';
  };

  const formatCurrency = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Buying Power + Risk Score */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Buying Power Card */}
        <Link href="/portfolio-advisor">
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-emerald-500/20">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-500" />
                <CardTitle className="text-base">Buying Power</CardTitle>
              </div>
              <CardDescription>Total across all accounts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-500">
                {formatCurrency(data.totalBuyingPower)}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span>Net Liq: {formatCurrency(data.totalNetLiq)}</span>
                <span>{data.accountBalances?.length || 0} accounts</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Capital Utilization Card */}
        <Link href="/portfolio-advisor">
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-blue-500" />
                <CardTitle className="text-base">Capital Utilization</CardTitle>
              </div>
              <CardDescription>How much capital is deployed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={cn("text-3xl font-bold", getUtilizationColor(data.capitalUtilizationPct))}>
                {data.capitalUtilizationPct}%
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {data.capitalUtilizationPct >= 80 && 'Very high — limited room for adjustments'}
                {data.capitalUtilizationPct >= 60 && data.capitalUtilizationPct < 80 && 'Moderate — some room for adjustments'}
                {data.capitalUtilizationPct >= 40 && data.capitalUtilizationPct < 60 && 'Healthy — good adjustment room'}
                {data.capitalUtilizationPct < 40 && 'Conservative — plenty of dry powder'}
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Risk Score Card */}
        <Link href="/portfolio-advisor">
          <Card className={cn(
            "hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg",
            getRiskColor(data.riskScore)
          )}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                <CardTitle className="text-base">Risk Score</CardTitle>
              </div>
              <CardDescription>Overall portfolio risk level</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.riskScore}/100</div>
              <p className="text-xs text-muted-foreground mt-2">
                {data.riskScore >= 80 && 'Extreme Risk — immediate action needed'}
                {data.riskScore >= 60 && data.riskScore < 80 && 'High Risk — review positions'}
                {data.riskScore >= 40 && data.riskScore < 60 && 'Medium Risk — monitor closely'}
                {data.riskScore < 40 && 'Low Risk — portfolio looks healthy'}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Row 2: Concentration, Assignment Risk, Diversification */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Concentration Risk Card */}
        <Link href="/portfolio-advisor">
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-blue-500/20">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-500" />
                <CardTitle className="text-base">Concentration</CardTitle>
              </div>
              <CardDescription>Top ticker exposure</CardDescription>
            </CardHeader>
            <CardContent>
              {data.topConcentrations.length > 0 ? (
                <div className="space-y-1.5">
                  {data.topConcentrations.slice(0, 3).map((item: { ticker: string; percentage: number }) => (
                    <div key={item.ticker} className="flex justify-between items-center">
                      <span className="font-medium text-sm">{item.ticker}</span>
                      <span className={cn("font-bold text-sm", getConcentrationColor(item.percentage))}>
                        {item.percentage.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No positions found</p>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Assignment Risk Card */}
        <Link href="/portfolio-advisor">
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-orange-500/20">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-orange-500" />
                <CardTitle className="text-base">Assignment Risk</CardTitle>
              </div>
              <CardDescription>Underwater positions (ITM)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={cn(
                "text-3xl font-bold",
                data.underwaterPositions > 0 ? 'text-red-500' : 'text-green-500'
              )}>
                {data.underwaterPositions}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {data.underwaterPositions === 0 && 'All short options OTM'}
                {data.underwaterPositions === 1 && '1 position ITM — review needed'}
                {data.underwaterPositions > 1 && `${data.underwaterPositions} positions ITM — review needed`}
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Diversification Score Card */}
        <Link href="/portfolio-advisor">
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-purple-500/20">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <PieChart className="h-5 w-5 text-purple-500" />
                <CardTitle className="text-base">Diversification</CardTitle>
              </div>
              <CardDescription>Ticker & sector spread</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.diversificationScore}/100</div>
              <p className="text-xs text-muted-foreground mt-2">
                {data.tickerCount} tickers across {data.sectorCount} sectors
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Row 3: Per-Account Buying Power Breakdown (if multiple accounts) */}
      {data.accountBalances && data.accountBalances.length > 1 && (
        <Card className="backdrop-blur-sm bg-card/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Per-Account Buying Power</CardTitle>
            <CardDescription>Breakdown across all linked accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {data.accountBalances.map((acct: {
                accountNumber: string;
                nickname: string;
                accountType: string;
                derivativeBuyingPower: number;
                netLiquidatingValue: number;
              }) => (
                <div key={acct.accountNumber} className="p-3 rounded-lg bg-muted/30 border border-border/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm truncate">{acct.nickname}</span>
                    <span className="text-xs text-muted-foreground">{acct.accountType}</span>
                  </div>
                  <div className="text-lg font-bold text-emerald-500">
                    {formatCurrency(acct.derivativeBuyingPower)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Net Liq: {formatCurrency(acct.netLiquidatingValue)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
