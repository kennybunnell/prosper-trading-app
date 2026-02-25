/**
 * Portfolio Advisor Summary Cards
 * Displays high-level portfolio risk metrics on the Dashboard homepage
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { AlertTriangle, Target, TrendingDown, PieChart, Loader2 } from 'lucide-react';
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

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {/* Risk Score Card */}
      <Link href="/portfolio-advisor">
        <Card className={cn(
          "hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg",
          getRiskColor(data.riskScore)
        )}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <CardTitle>Risk Score</CardTitle>
            </div>
            <CardDescription>
              Overall portfolio risk level
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.riskScore}/100</div>
            <p className="text-sm text-muted-foreground mt-2">
              {data.riskScore >= 80 && 'Extreme Risk'}
              {data.riskScore >= 60 && data.riskScore < 80 && 'High Risk'}
              {data.riskScore >= 40 && data.riskScore < 60 && 'Medium Risk'}
              {data.riskScore < 40 && 'Low Risk'}
            </p>
          </CardContent>
        </Card>
      </Link>

      {/* Concentration Risk Card */}
      <Link href="/portfolio-advisor">
        <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-blue-500/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              <CardTitle>Concentration</CardTitle>
            </div>
            <CardDescription>
              Top ticker exposure
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.topConcentrations.length > 0 ? (
              <div className="space-y-2">
                {data.topConcentrations.slice(0, 3).map((item: { ticker: string; percentage: number }) => (
                  <div key={item.ticker} className="flex justify-between items-center">
                    <span className="font-medium">{item.ticker}</span>
                    <span className={cn("font-bold", getConcentrationColor(item.percentage))}>
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
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-orange-500" />
              <CardTitle>Assignment Risk</CardTitle>
            </div>
            <CardDescription>
              Underwater positions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.underwaterPositions}</div>
            <p className="text-sm text-muted-foreground mt-2">
              {data.underwaterPositions === 0 && 'All positions healthy'}
              {data.underwaterPositions === 1 && '1 position at risk'}
              {data.underwaterPositions > 1 && `${data.underwaterPositions} positions at risk`}
            </p>
          </CardContent>
        </Card>
      </Link>

      {/* Diversification Score Card */}
      <Link href="/portfolio-advisor">
        <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-purple-500/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-purple-500" />
              <CardTitle>Diversification</CardTitle>
            </div>
            <CardDescription>
              Sector distribution health
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.diversificationScore}/100</div>
            <p className="text-sm text-muted-foreground mt-2">
              {data.sectorCount} sectors
            </p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
