import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { AlertCircle, TrendingUp, TrendingDown, Minus, RefreshCw, Lightbulb, Target } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StrategyAdvisor() {
  const { data, isLoading, error, refetch } = trpc.strategyAdvisor.getRecommendation.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy Advisor</CardTitle>
          <CardDescription>Analyzing market conditions...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || data?.error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Strategy Advisor</CardTitle>
          <CardDescription className="text-destructive">
            {data?.error || 'Failed to load market analysis'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <AlertCircle className="h-8 w-8 text-destructive flex-shrink-0" />
            <div>
              <p className="text-sm text-muted-foreground">
                {data?.error || 'Unable to fetch market data. Please check your Tastytrade connection in Settings.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const recommendation = data?.recommendation;
  if (!recommendation) {
    return null;
  }

  // Map strategy codes to full names
  const strategyNames: Record<string, string> = {
    'BPS': 'Bull Put Spreads',
    'BCS': 'Bear Call Spreads',
    'IC': 'Iron Condors',
  };

  // Map market conditions to icons and colors
  const conditionConfig: Record<string, { icon: any; color: string; bgColor: string }> = {
    'Bullish': { icon: TrendingUp, color: 'text-green-600', bgColor: 'bg-green-500/10 border-green-500/50' },
    'Bearish': { icon: TrendingDown, color: 'text-red-600', bgColor: 'bg-red-500/10 border-red-500/50' },
    'Neutral': { icon: Minus, color: 'text-blue-600', bgColor: 'bg-blue-500/10 border-blue-500/50' },
  };

  const config = conditionConfig[recommendation.marketCondition] || conditionConfig['Neutral'];
  const Icon = config.icon;

  // Confidence badge color
  const confidenceColors: Record<string, string> = {
    'HIGH': 'bg-green-500/20 text-green-700 border-green-500/50',
    'MEDIUM': 'bg-yellow-500/20 text-yellow-700 border-yellow-500/50',
    'LOW': 'bg-red-500/20 text-red-700 border-red-500/50',
  };
  const confidenceColor = confidenceColors[recommendation.confidence] || 'bg-gray-500/20 text-gray-700 border-gray-500/50';

  return (
    <div className="space-y-6">
      {/* Market Condition Summary */}
      <Card className={config.bgColor}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${config.color}`} />
                Market Condition: {recommendation.marketCondition}
              </CardTitle>
              <CardDescription className="mt-2">
                Based on real-time analysis of SPY, QQQ, IWM, and VIX
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="flex-shrink-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Recommended Strategy */}
            <div className="bg-background/50 rounded-lg p-4 border">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-lg">Recommended Strategy</h3>
                    <Badge className={confidenceColor}>
                      {recommendation.confidence} Confidence
                    </Badge>
                  </div>
                  <p className="text-2xl font-bold text-primary mb-2">
                    {strategyNames[recommendation.recommendedStrategy] || recommendation.recommendedStrategy}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {recommendation.reasoning}
                  </p>
                </div>
              </div>
            </div>

            {/* Key Factors */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4" />
                Key Factors
              </h4>
              <ul className="space-y-1">
                {recommendation.keyFactors.map((factor: string, index: number) => (
                  <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Risk Warning */}
            {recommendation.riskWarning && (
              <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-sm text-amber-700 mb-1">Risk Consideration</h4>
                    <p className="text-sm text-amber-700/90">{recommendation.riskWarning}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Watchlist Recommendations */}
      {recommendation.topWatchlistPicks && recommendation.topWatchlistPicks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Watchlist Picks</CardTitle>
            <CardDescription>
              Tickers from your watchlist that align with the recommended strategy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendation.topWatchlistPicks.map((pick: any, index: number) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-shrink-0 w-16">
                    <Badge variant="outline" className="font-mono text-sm">
                      {pick.symbol}
                    </Badge>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">{pick.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Market Data Summary */}
      {data?.marketData && (
        <Card>
          <CardHeader>
            <CardTitle>Market Data Snapshot</CardTitle>
            <CardDescription>Real-time quotes from Tastytrade</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(data.marketData).map(([symbol, quoteData]: [string, any]) => (
                <div key={symbol} className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">{symbol}</p>
                  <p className="text-2xl font-bold">${quoteData.last?.toFixed(2) || 'N/A'}</p>
                  <p className={`text-sm ${quoteData.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {quoteData.change >= 0 ? '+' : ''}{quoteData.change?.toFixed(2)}%
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
