import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { AlertCircle, TrendingUp, TrendingDown, Minus, RefreshCw, Lightbulb, Target, ArrowRight, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function StrategyAdvisor() {
  const [, setLocation] = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  
  // Fetch user preferences
  const { data: userPrefs } = trpc.userPreferences.get.useQuery();
  const setPreferencesMutation = trpc.userPreferences.setStrategyAdvisorPreferences.useMutation();
  
  // Local state for preferences
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  
  // Sync with user preferences
  useEffect(() => {
    if (userPrefs) {
      setAutoRefresh(userPrefs.strategyAdvisorAutoRefresh ?? false);
      setRefreshInterval(userPrefs.strategyAdvisorRefreshInterval ?? 30);
    }
  }, [userPrefs]);
  
  const { data, isLoading, error, refetch } = trpc.strategyAdvisor.getRecommendation.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh ? refreshInterval * 60 * 1000 : false, // Convert minutes to milliseconds
  });

  // Map strategy codes to dashboard routes
  const strategyRoutes: Record<string, string> = {
    'BPS': '/iron-condor', // Bull Put Spreads are traded via Iron Condor dashboard
    'BCS': '/iron-condor', // Bear Call Spreads are traded via Iron Condor dashboard
    'IC': '/iron-condor',  // Iron Condors have dedicated dashboard
  };

  const handleTradeClick = (symbol: string, strategy: string) => {
    const route = strategyRoutes[strategy] || '/iron-condor';
    // Navigate to the appropriate dashboard
    // The dashboard will have the watchlist already loaded, user can filter by symbol
    setLocation(route);
  };
  
  const handleSavePreferences = async () => {
    try {
      await setPreferencesMutation.mutateAsync({
        autoRefresh,
        refreshInterval,
      });
      toast.success('Preferences saved');
      setShowSettings(false);
    } catch (error) {
      toast.error('Failed to save preferences');
    }
  };
  
  // Check if market is open (simplified: Mon-Fri 9:30am-4pm ET)
  const isMarketOpen = () => {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    // Rough check: weekday and between 9am-5pm (not accounting for timezone)
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
  };

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
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                className="flex-shrink-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
                className="flex-shrink-0"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
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

            {/* Historical Insight */}
            {recommendation.historicalInsight && (
              <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-sm text-blue-700 mb-1">Your Historical Performance</h4>
                    <p className="text-sm text-blue-700/90">{recommendation.historicalInsight}</p>
                  </div>
                </div>
              </div>
            )}

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

      {/* Settings Panel */}
      {showSettings && (
        <Card>
          <CardHeader>
            <CardTitle>Auto-Refresh Settings</CardTitle>
            <CardDescription>
              Configure automatic updates for Strategy Advisor recommendations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-refresh">Enable Auto-Refresh</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically update recommendations at regular intervals
                    {autoRefresh && !isMarketOpen() && (
                      <span className="text-amber-600"> (Market is closed)</span>
                    )}
                  </p>
                </div>
                <Switch
                  id="auto-refresh"
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                />
              </div>
              
              {autoRefresh && (
                <div className="space-y-2">
                  <Label htmlFor="refresh-interval">Refresh Interval</Label>
                  <Select
                    value={refreshInterval.toString()}
                    onValueChange={(value) => setRefreshInterval(parseInt(value))}
                  >
                    <SelectTrigger id="refresh-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">Every 15 minutes</SelectItem>
                      <SelectItem value="30">Every 30 minutes</SelectItem>
                      <SelectItem value="60">Every 60 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Next refresh in {refreshInterval} minutes
                  </p>
                </div>
              )}
              
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSavePreferences} disabled={setPreferencesMutation.isPending}>
                  {setPreferencesMutation.isPending ? 'Saving...' : 'Save Preferences'}
                </Button>
                <Button variant="outline" onClick={() => setShowSettings(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-shrink-0"
                    onClick={() => handleTradeClick(pick.symbol, recommendation.recommendedStrategy)}
                  >
                    Trade This
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
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
