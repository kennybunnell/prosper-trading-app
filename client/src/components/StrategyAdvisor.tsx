import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { AlertCircle, TrendingUp, TrendingDown, Minus, RefreshCw, Lightbulb, Target, ArrowRight, Settings, Trophy, Medal, Award, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";

export function StrategyAdvisor() {
  const [, setLocation] = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();
  
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
    refetchInterval: autoRefresh ? refreshInterval * 60 * 1000 : false,
  });

  const handleTradeClick = () => {
    // Navigate to Iron Condor dashboard where user can trade the recommended strategy
    setLocation('/iron-condor');
  };
  
  const handleToggleSelection = (symbol: string) => {
    setSelectedTickers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(symbol)) {
        newSet.delete(symbol);
      } else {
        newSet.add(symbol);
      }
      return newSet;
    });
  };

  const getPrimaryStrategy = () => {
    // Determine primary strategy based on selected tickers
    // For now, return the most common strategy among selected tickers
    if (!data?.rankedTickers) return 'Bull Put Spreads';
    
    const selectedTickerData = data.rankedTickers.filter(t => selectedTickers.has(t.symbol));
    const strategyCounts = selectedTickerData.reduce((acc, ticker) => {
      ticker.strategyBadges.forEach(badge => {
        acc[badge.strategy] = (acc[badge.strategy] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);
    
    const primaryStrategy = Object.entries(strategyCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    return primaryStrategy || 'Bull Put Spreads';
  };
  
  const handleTickerToggle = (symbol: string) => {
    setSelectedTickers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(symbol)) {
        newSet.delete(symbol);
      } else {
        newSet.add(symbol);
      }
      return newSet;
    });
  };
  
  const handleClearSelection = () => {
    setSelectedTickers(new Set());
    toast.info('Selection cleared');
  };
  
  const handleAnalyzeSelected = () => {
    if (selectedTickers.size === 0) {
      toast.error('Please select at least one ticker');
      return;
    }
    
    // Determine primary strategy based on selected tickers
    const selectedTickerData = data?.rankedTickers?.filter((t: any) => selectedTickers.has(t.symbol)) || [];
    const strategyCount = {
      BPS: 0,
      BCS: 0,
      IC: 0,
    };
    
    selectedTickerData.forEach((ticker: any) => {
      ticker.strategyBadges?.forEach((badge: any) => {
        if (badge.strategy === 'Bull Put Spread') strategyCount.BPS++;
        if (badge.strategy === 'Bear Call Spread') strategyCount.BCS++;
        if (badge.strategy === 'Iron Condor') strategyCount.IC++;
      });
    });
    
    // Navigate to the dashboard with the most selected tickers
    let targetDashboard = '/csp-bps';
    let strategyName = 'Bull Put Spreads';
    
    if (strategyCount.BCS > strategyCount.BPS && strategyCount.BCS > strategyCount.IC) {
      targetDashboard = '/cc-bcs';
      strategyName = 'Bear Call Spreads';
    } else if (strategyCount.IC > strategyCount.BPS && strategyCount.IC > strategyCount.BCS) {
      targetDashboard = '/iron-condor';
      strategyName = 'Iron Condors';
    }
    
    // Store selected tickers in localStorage for the target dashboard to pick up
    localStorage.setItem('strategyAdvisorSelectedTickers', JSON.stringify(Array.from(selectedTickers)));
    localStorage.setItem('strategyAdvisorAutoFetch', 'true');
    
    toast.success(`Navigating to ${strategyName} with ${selectedTickers.size} selected tickers`);
    setLocation(targetDashboard);
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
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy Advisor</CardTitle>
          <CardDescription>Analyzing your watchlist tickers...</CardDescription>
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
  const rankedTickers = data?.rankedTickers || [];
  
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

  // Score badge colors
  const getScoreBadgeColor = (score: number) => {
    if (score >= 80) return 'bg-green-500/20 text-green-700 border-green-500/50';
    if (score >= 60) return 'bg-yellow-500/20 text-yellow-700 border-yellow-500/50';
    return 'bg-red-500/20 text-red-700 border-red-500/50';
  };

  // Rank icons
  const getRankIcon = (index: number) => {
    if (index === 0) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (index === 1) return <Medal className="h-5 w-5 text-gray-400" />;
    if (index === 2) return <Award className="h-5 w-5 text-amber-600" />;
    return null;
  };

  const handleAnalyzeClick = async () => {
    toast.info('Analyzing all watchlist tickers...');
    await refetch();
    toast.success('Analysis complete!');
  };

  // Get last updated timestamp
  const lastUpdated = data?.timestamp ? new Date(data.timestamp).toLocaleString() : null;

  return (
    <div className="space-y-6">
      {/* Watchlist Management - Collapsible */}
      <EnhancedWatchlist 
        isCollapsed={watchlistCollapsed}
        onToggleCollapse={() => setWatchlistCollapsed(!watchlistCollapsed)}
        onWatchlistChange={() => {
          utils.strategyAdvisor.getRecommendation.invalidate();
        }}
      />

      {/* Selection Panel - Shows selected tickers as chips */}
      {selectedTickers.size > 0 && (
        <Card className="border-blue-500/50 bg-blue-500/10">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-500" />
                  Selected Tickers ({selectedTickers.size})
                </h3>
                <Button
                  onClick={handleClearSelection}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear All
                </Button>
              </div>
              
              {/* Ticker Chips */}
              <div className="flex flex-wrap gap-2">
                {Array.from(selectedTickers).map((symbol) => (
                  <Badge
                    key={symbol}
                    variant="secondary"
                    className="px-3 py-1.5 text-sm font-mono bg-blue-500/20 text-blue-700 border-blue-500/50 cursor-pointer hover:bg-blue-500/30 transition-colors"
                    onClick={() => handleToggleSelection(symbol)}
                  >
                    {symbol}
                    <X className="h-3 w-3 ml-1.5" />
                  </Badge>
                ))}
              </div>

              {/* Fetch Opportunities Button */}
              <Button
                onClick={handleAnalyzeSelected}
                size="lg"
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg"
              >
                <Target className="h-5 w-5 mr-2" />
                Fetch Opportunities for {getPrimaryStrategy()} ({selectedTickers.size} tickers)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analyze Button - Prominent */}
      <Card className="border-primary/50 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-lg">Ready to Analyze</h3>
                {selectedTickers.size > 0 && (
                  <Badge variant="secondary" className="bg-blue-500/20 text-blue-700 border-blue-500/50">
                    {selectedTickers.size} selected
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {rankedTickers.length > 0 && lastUpdated
                  ? `Last analyzed: ${lastUpdated}`
                  : 'Click to analyze all tickers in your watchlist'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleAnalyzeClick}
                size="lg"
                disabled={isLoading}
                className="min-w-[180px]"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2" />
                    Analyze Watchlist
                  </>
                )}
              </Button>
              
              {selectedTickers.size > 0 && (
                <>
                  <Button
                    onClick={handleClearSelection}
                    variant="outline"
                    size="lg"
                  >
                    Clear Selection
                  </Button>
                  <Button
                    onClick={handleAnalyzeSelected}
                    size="lg"
                    className="bg-blue-600 hover:bg-blue-700 min-w-[200px]"
                  >
                    <Target className="h-5 w-5 mr-2" />
                    Analyze Selected ({selectedTickers.size})
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Market Overview - Compact */}
      <Card className={config.bgColor}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon className={`h-5 w-5 ${config.color}`} />
              <div>
                <CardTitle className="text-lg">Market: {recommendation.marketCondition}</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  SPY {data.marketData?.SPY?.change >= 0 ? '+' : ''}{data.marketData?.SPY?.change.toFixed(2)}% | VIX {data.marketData?.VIX?.last.toFixed(1)}
                </CardDescription>
              </div>
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
      </Card>

      {/* Recommended Strategy */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-5 w-5 text-primary" />
                <CardTitle>Recommended Strategy</CardTitle>
                <Badge className={confidenceColor}>
                  {recommendation.confidence}
                </Badge>
              </div>
              <p className="text-2xl font-bold text-primary mb-2">
                {strategyNames[recommendation.recommendedStrategy] || recommendation.recommendedStrategy}
              </p>
              <CardDescription className="text-sm">
                {recommendation.reasoning}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
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

      {/* Ranked Watchlist Picks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                Top Watchlist Picks
              </CardTitle>
              <CardDescription>
                Ranked best → worst for {strategyNames[recommendation.recommendedStrategy]}
              </CardDescription>
            </div>
            {rankedTickers.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {rankedTickers.length} analyzed
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {rankedTickers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No tickers in watchlist. Add tickers in Settings to get personalized recommendations.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Group tickers by strategy */}
              {(() => {
                // Separate tickers into strategy groups
                const bpsTickers = rankedTickers.filter((t: any) => 
                  t.strategyBadges?.some((b: any) => b.strategy === 'BPS' && b.score >= 60)
                ).sort((a: any, b: any) => b.score - a.score);
                
                const bcsTickers = rankedTickers.filter((t: any) => 
                  t.strategyBadges?.some((b: any) => b.strategy === 'BCS' && b.score >= 60) &&
                  !t.strategyBadges?.some((b: any) => b.strategy === 'BPS' && b.score >= 60)
                ).sort((a: any, b: any) => b.score - a.score);
                
                const icTickers = rankedTickers.filter((t: any) => 
                  t.strategyBadges?.some((b: any) => b.strategy === 'IC' && b.score >= 60) &&
                  !t.strategyBadges?.some((b: any) => b.strategy === 'BPS' && b.score >= 60) &&
                  !t.strategyBadges?.some((b: any) => b.strategy === 'BCS' && b.score >= 60)
                ).sort((a: any, b: any) => b.score - a.score);
                
                const notRecommended = rankedTickers.filter((t: any) => 
                  !t.strategyBadges || t.strategyBadges.length === 0 || 
                  !t.strategyBadges.some((b: any) => b.score >= 60)
                ).sort((a: any, b: any) => b.score - a.score);

                const renderTickerCard = (ticker: any, index: number) => (
                <div
                  key={ticker.symbol}
                  className={`border rounded-lg p-4 ${
                    ticker.score >= 80 ? 'bg-green-500/5 border-green-500/30' :
                    ticker.score >= 60 ? 'bg-yellow-500/5 border-yellow-500/30' :
                    'bg-red-500/5 border-red-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedTickers.has(ticker.symbol)}
                          onChange={() => handleTickerToggle(ticker.symbol)}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        {getRankIcon(index)}
                        <span className="text-sm font-medium text-muted-foreground">
                          #{index + 1}
                        </span>
                        <h3 className="text-xl font-bold">{ticker.symbol}</h3>
                        <Badge className={getScoreBadgeColor(ticker.score)}>
                          {ticker.score}/100
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {ticker.momentum}
                        </Badge>
                      </div>

                      {/* Strategy Badges - Show which strategies this ticker is good for */}
                      {ticker.strategyBadges && ticker.strategyBadges.length > 0 && (
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs text-muted-foreground font-medium">Best for:</span>
                          {ticker.strategyBadges.map((badge: any) => (
                            <Badge
                              key={badge.strategy}
                              className={
                                badge.strategy === 'BPS' ? 'bg-green-500/20 text-green-700 border-green-500/50 hover:bg-green-500/30' :
                                badge.strategy === 'BCS' ? 'bg-red-500/20 text-red-700 border-red-500/50 hover:bg-red-500/30' :
                                'bg-blue-500/20 text-blue-700 border-blue-500/50 hover:bg-blue-500/30'
                              }
                              variant="outline"
                            >
                              {badge.strategy === 'BPS' ? '🟢' : badge.strategy === 'BCS' ? '🔴' : '🔵'} {badge.label} ({badge.score})
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Price Info */}
                      <div className="flex items-center gap-4 mb-3 text-sm">
                        <span className="font-medium">
                          ${ticker.currentPrice.toFixed(2)}
                        </span>
                        <span className={ticker.change24h >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {ticker.change24h >= 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
                        </span>
                        <span className="text-muted-foreground">
                          52W: {ticker.yearPosition.toFixed(0)}%
                        </span>
                        {ticker.ivRank !== null && (
                          <span className="text-muted-foreground">
                            IV Rank: {ticker.ivRank}%
                          </span>
                        )}
                      </div>

                      {/* Historical Performance */}
                      {ticker.historicalWinRate !== null && (
                        <div className="flex items-center gap-4 mb-3 text-sm">
                          <span className="text-muted-foreground">
                            Your Win Rate: <span className="font-medium text-foreground">{ticker.historicalWinRate.toFixed(0)}%</span>
                          </span>
                          <span className="text-muted-foreground">
                            Avg P/L: <span className={`font-medium ${ticker.historicalAvgPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              ${ticker.historicalAvgPL.toFixed(0)}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            Trades: {ticker.historicalTradeCount}
                          </span>
                        </div>
                      )}

                      {/* Recommended Strikes */}
                      {ticker.recommendedStrikes && (
                        <div className="bg-background/50 rounded-lg p-3 mb-3 border">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Recommended Strikes</p>
                              <p className="font-mono font-semibold">
                                ${ticker.recommendedStrikes.shortStrike} / ${ticker.recommendedStrikes.longStrike}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground mb-1">Expected Premium</p>
                              <p className="font-semibold text-green-600">
                                ${ticker.recommendedStrikes.expectedPremium.toFixed(0)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground mb-1">PoP</p>
                              <p className="font-semibold">
                                {ticker.recommendedStrikes.probabilityOfProfit.toFixed(0)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Reasoning */}
                      <p className="text-sm text-muted-foreground mb-3">
                        {ticker.reasoning}
                      </p>

                      {/* Score Breakdown */}
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div className="text-center">
                          <p className="text-muted-foreground">Momentum</p>
                          <p className="font-semibold">{ticker.fitScore.momentum}/30</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">IV</p>
                          <p className="font-semibold">{ticker.fitScore.iv}/25</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Historical</p>
                          <p className="font-semibold">{ticker.fitScore.historical}/30</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Technical</p>
                          <p className="font-semibold">{ticker.fitScore.technical}/15</p>
                        </div>
                      </div>
                    </div>

                    {/* Trade Button - Only show when no tickers are selected */}
                    {selectedTickers.size === 0 && (
                      <Button
                        onClick={handleTradeClick}
                        className="flex-shrink-0"
                        variant={ticker.score >= 70 ? 'default' : 'outline'}
                        disabled={ticker.score < 40}
                      >
                        Trade This
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                  </div>
                </div>
                );

                return (
                  <>
                    {/* Bull Put Spreads */}
                    {bpsTickers.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-green-500" />
                          <h3 className="text-lg font-semibold">Bull Put Spreads</h3>
                          <Badge variant="outline" className="text-xs">
                            {bpsTickers.length} {bpsTickers.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {bpsTickers.map((ticker: any, index: number) => renderTickerCard(ticker, index))}
                        </div>
                      </div>
                    )}

                    {/* Bear Call Spreads */}
                    {bcsTickers.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-red-500" />
                          <h3 className="text-lg font-semibold">Bear Call Spreads</h3>
                          <Badge variant="outline" className="text-xs">
                            {bcsTickers.length} {bcsTickers.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {bcsTickers.map((ticker: any, index: number) => renderTickerCard(ticker, index))}
                        </div>
                      </div>
                    )}

                    {/* Iron Condors */}
                    {icTickers.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-blue-500" />
                          <h3 className="text-lg font-semibold">Iron Condors</h3>
                          <Badge variant="outline" className="text-xs">
                            {icTickers.length} {icTickers.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {icTickers.map((ticker: any, index: number) => renderTickerCard(ticker, index))}
                        </div>
                      </div>
                    )}

                    {/* Not Recommended */}
                    {notRecommended.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-gray-500" />
                          <h3 className="text-lg font-semibold text-muted-foreground">Not Recommended</h3>
                          <Badge variant="outline" className="text-xs">
                            {notRecommended.length} {notRecommended.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {notRecommended.map((ticker: any, index: number) => renderTickerCard(ticker, index))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
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
                      <SelectItem value="60">Every hour</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex gap-2 pt-4">
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
    </div>
  );
}
