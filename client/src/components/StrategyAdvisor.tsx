import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { AlertCircle, TrendingUp, TrendingDown, Minus, RefreshCw, Lightbulb, Target, ArrowRight, Settings, Trophy, Medal, Award, X, ArrowDown, ChevronUp } from "lucide-react";
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
  const [lockedStrategy, setLockedStrategy] = useState<string | null>(null);
  // Track which section each ticker was selected from for context-aware routing
  const [tickerSections, setTickerSections] = useState<Map<string, 'BPS' | 'BCS' | 'IC'>>(new Map());
  const [showBackToTop, setShowBackToTop] = useState(false);
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
  
  // Show/hide Back to Top button based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  // scanType: null = idle (no scan yet), 'equity' | 'index' = active scan
  const [scanType, setScanType] = useState<'equity' | 'index' | null>(null);
  const [scanEnabled, setScanEnabled] = useState(false);
  // pendingScanType: the selection in the segmented control before the user clicks Scan
  const [pendingScanType, setPendingScanType] = useState<'equity' | 'index'>('equity');

  const { data, isLoading, error, refetch } = trpc.strategyAdvisor.getRecommendation.useQuery(
    scanType ? { scanType } : undefined,
    {
      enabled: scanEnabled && scanType !== null,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: autoRefresh && scanEnabled ? refreshInterval * 60 * 1000 : false,
    }
  );

  const handleScanEquities = async () => {
    setScanType('equity');
    setScanEnabled(true);
    // If scanType was already equity, force a refetch
    if (scanType === 'equity') {
      await refetch();
    }
  };

  const handleScanIndexes = async () => {
    setScanType('index');
    setScanEnabled(true);
    if (scanType === 'index') {
      await refetch();
    }
  };
  
  // Mutation to clear all watchlist selections
  const clearAllMutation = trpc.watchlist.clearAll.useMutation({
    onSuccess: () => {
      utils.watchlist.getSelections.invalidate();
    },
  });
  
  // Clear selection state on mount (fresh load)
  // This ensures users start with a clean slate when navigating directly to Strategy Advisor
  useEffect(() => {
    // Clear component state
    setSelectedTickers(new Set());
    setLockedStrategy(null);
    
    // Also clear database selections to ensure watchlist shows 0 selected
    // This prevents confusion from leftover selections from previous sessions
    if (data?.rankedTickers) {
      const allSymbols = data.rankedTickers.map((t: any) => t.symbol);
      clearAllMutation.mutate({ symbols: allSymbols });
    }
  }, [data?.rankedTickers]); // Run when ticker data loads

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
  
  const handleTickerToggle = (symbol: string, section?: 'BPS' | 'BCS' | 'IC') => {
    // Get the ticker data to check its primary strategy
    const ticker = data?.rankedTickers?.find((t: any) => t.symbol === symbol);
    if (!ticker) return;
    
    setSelectedTickers(prev => {
      const newSet = new Set(prev);

      if (newSet.has(symbol) && tickerSections.get(symbol) === section) {
        // Deselecting this specific section's checkbox
        newSet.delete(symbol);
        setTickerSections(prev => {
          const newMap = new Map(prev);
          newMap.delete(symbol);
          return newMap;
        });
        if (newSet.size === 0) setLockedStrategy(null);
      } else if (!newSet.has(symbol)) {
        // Selecting — lock is based on the SECTION the checkbox is in, not the ticker's primary badge
        if (lockedStrategy && section !== lockedStrategy) {
          toast.error(
            `⚠️ Locked to ${lockedStrategy} strategy. Clear your selection to switch to ${section}.`,
            { duration: 4000 }
          );
          return prev;
        }
        newSet.add(symbol);
        if (section) {
          setTickerSections(prev => {
            const newMap = new Map(prev);
            newMap.set(symbol, section);
            return newMap;
          });
        }
        if (newSet.size === 1) setLockedStrategy(section || null);
      }

      return newSet;
    });
  };
  
  const handleClearSelection = () => {
    setSelectedTickers(new Set());
    setLockedStrategy(null);
    toast.info('Selection cleared');
  };
  
  const handleAnalyzeSelected = () => {
    if (selectedTickers.size === 0) {
      toast.error('Please select at least one ticker');
      return;
    }
    
    console.log('[Strategy Advisor] handleAnalyzeSelected called');
    console.log('[Strategy Advisor] selectedTickers:', Array.from(selectedTickers));
    console.log('[Strategy Advisor] tickerSections:', Array.from(tickerSections.entries()));
    
    // Count sections (where tickers were selected from) instead of badge counts
    // This ensures context-aware routing based on which section the ticker was selected from
    const sectionCounts = { BPS: 0, BCS: 0, IC: 0 };
    tickerSections.forEach((section) => {
      sectionCounts[section]++;
    });
    
    console.log('[Strategy Advisor] sectionCounts:', sectionCounts);
    
    // Determine which dashboard to navigate to based on section counts.
    // IMPORTANT: CSP (/csp) is NEVER a valid destination from Spread Advisor —
    // the advisor only surfaces BPS, BCS, and IC strategies.
    // For index mode (SPXW, NDX, RUT), default to Iron Condor if no section is detected.
    const maxCount = Math.max(sectionCounts.BPS, sectionCounts.BCS, sectionCounts.IC);
    const isIndexMode = pendingScanType === 'index';

    // Default: IC for indexes, Iron Condor dashboard also handles BPS/BCS for equities
    // CSP (/csp) is intentionally excluded — Spread Advisor only surfaces spread strategies
    let targetDashboard = '/iron-condor';
    let strategyName = isIndexMode ? 'Iron Condors' : 'Bull Put Spreads';

    // Route to the section with the highest count (only among BPS/BCS/IC)
    if (maxCount > 0) {
      if (sectionCounts.IC === maxCount) {
        targetDashboard = '/iron-condor';
        strategyName = 'Iron Condors';
      } else if (sectionCounts.BCS === maxCount) {
        targetDashboard = '/cc';
        strategyName = 'Bear Call Spreads';
      } else {
        // BPS is the highest — route to spreads/condors page, not CSP
        targetDashboard = '/iron-condor'; // BPS is handled in the Iron Condor / Spreads dashboard
        strategyName = 'Bull Put Spreads';
      }
    }
    
    console.log('[Strategy Advisor] targetDashboard:', targetDashboard, 'strategyName:', strategyName);
    
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

  // Idle state: no scan has been triggered yet
  if (!scanEnabled || scanType === null) {
    return (
      <div className="space-y-6">
        <EnhancedWatchlist
          isCollapsed={watchlistCollapsed}
          onToggleCollapse={() => setWatchlistCollapsed(!watchlistCollapsed)}
          onWatchlistChange={() => utils.strategyAdvisor.getRecommendation.invalidate()}
          contextMode={pendingScanType}
          onContextModeChange={setPendingScanType}
        />
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-8 pb-8">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-3 mb-2">
                <Target className="h-8 w-8 text-primary" />
                <h2 className="text-2xl font-bold">Spread Advisor</h2>
              </div>
              <p className="text-muted-foreground max-w-md mx-auto">
                Use the <strong>{pendingScanType === 'index' ? 'Indexes' : 'Equities'}</strong> toggle in the Watchlist above to switch context, then scan.
                Indexes (SPXW, NDX, RUT) and equities use separate scoring models.
              </p>
              <div className="flex flex-col items-center gap-4 pt-2">
                <p className="text-xs text-muted-foreground">
                  {pendingScanType === 'equity'
                    ? 'Equity mode — individual stocks · equity scoring model'
                    : 'Index mode — SPXW, NDX, RUT and other broad-market instruments · index scoring model'}
                </p>
                <Button
                  onClick={pendingScanType === 'index' ? handleScanIndexes : handleScanEquities}
                  size="lg"
                  className={`min-w-[200px] ${
                    pendingScanType === 'index'
                      ? 'bg-amber-500 hover:bg-amber-600 text-black'
                      : ''
                  }`}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Scan {pendingScanType === 'index' ? 'Indexes' : 'Equities'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spread Advisor</CardTitle>
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
          <CardTitle>Spread Advisor</CardTitle>
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
  // Deduplicate by symbol as a safety net (server should already deduplicate)
  const rankedTickers = (data?.rankedTickers || []).filter(
    (t: any, idx: number, arr: any[]) => arr.findIndex((x: any) => x.symbol === t.symbol) === idx
  );
  
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
        contextMode={pendingScanType}
        onContextModeChange={setPendingScanType}
      />

      {/* Selection Panel - Shows selected tickers as chips */}
      {selectedTickers.size > 0 && (
        <Card className="border-blue-500/50 bg-blue-500/10">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Target className="h-5 w-5 text-blue-500" />
                    Selected Tickers ({selectedTickers.size})
                  </h3>
                  {lockedStrategy && (
                    <Badge variant="outline" className="bg-blue-500/20 text-blue-700 border-blue-500/50">
                      🔒 Locked to {lockedStrategy}
                    </Badge>
                  )}
                </div>
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

      {/* Scan Controls - Two separate scan buttons */}
      <Card className="border-primary/50 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-lg">Scan Watchlist</h3>
                {scanType && (
                  <Badge variant="secondary" className={scanType === 'index' ? 'bg-amber-500/20 text-amber-700 border-amber-500/50' : 'bg-blue-500/20 text-blue-700 border-blue-500/50'}>
                    {scanType === 'index' ? 'Index Scan' : 'Equity Scan'}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {rankedTickers.length > 0 && lastUpdated
                  ? `Last scanned: ${lastUpdated}`
                  : `${pendingScanType === 'index' ? 'Index' : 'Equity'} mode active — switch the toggle in the Watchlist above to change context`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Single Scan button — context is set by the Watchlist header toggle */}
              <Button
                onClick={pendingScanType === 'index' ? handleScanIndexes : handleScanEquities}
                size="lg"
                disabled={isLoading}
                className={`min-w-[140px] ${
                  pendingScanType === 'index' ? 'bg-amber-500 hover:bg-amber-600 text-black' : ''
                }`}
              >
                {isLoading ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Scanning...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" />Scan {pendingScanType === 'index' ? 'Indexes' : 'Equities'}</>
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
            <div className="flex items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-primary" />
                  Top Watchlist Picks
                </CardTitle>
                <CardDescription>
                  Ranked best → worst for {strategyNames[recommendation.recommendedStrategy]}
                </CardDescription>
              </div>
              {/* Quick Navigation Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    document.getElementById('bull-put-spreads-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <div className="h-2 w-2 rounded-full bg-green-500 mr-1.5" />
                  BPS
                  <ArrowDown className="h-3 w-3 ml-1" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    document.getElementById('bear-call-spreads-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <div className="h-2 w-2 rounded-full bg-red-500 mr-1.5" />
                  BCS
                  <ArrowDown className="h-3 w-3 ml-1" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    document.getElementById('iron-condors-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <div className="h-2 w-2 rounded-full bg-blue-500 mr-1.5" />
                  IC
                  <ArrowDown className="h-3 w-3 ml-1" />
                </Button>
              </div>
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
                // Index tickers have a lower badge cutoff (40) vs equities (60).
                // Use the isIndex flag from the watchlist data if available, otherwise
                // fall back to checking if the ticker has any badge at all.
                const badgeCutoff = (t: any) => {
                  // If the server returned isIndex on the ticker, use it; otherwise 60
                  return t.isIndex ? 40 : 60;
                };

                // Each ticker appears in EVERY section whose badge score meets the cutoff.
                // Within each section, sort by that strategy's specific score (not overall score).
                // This mirrors how a trader thinks: "show me all tickers good for IC, sorted by IC score."
                const getBadgeScore = (t: any, strategy: 'BPS' | 'BCS' | 'IC') =>
                  t.strategyBadges?.find((b: any) => b.strategy === strategy)?.score ?? 0;

                const bpsTickers = rankedTickers
                  .filter((t: any) => t.strategyBadges?.some((b: any) => b.strategy === 'BPS' && b.score >= badgeCutoff(t)))
                  .sort((a: any, b: any) => getBadgeScore(b, 'BPS') - getBadgeScore(a, 'BPS'));

                const bcsTickers = rankedTickers
                  .filter((t: any) => t.strategyBadges?.some((b: any) => b.strategy === 'BCS' && b.score >= badgeCutoff(t)))
                  .sort((a: any, b: any) => getBadgeScore(b, 'BCS') - getBadgeScore(a, 'BCS'));

                const icTickers = rankedTickers
                  .filter((t: any) => t.strategyBadges?.some((b: any) => b.strategy === 'IC' && b.score >= badgeCutoff(t)))
                  .sort((a: any, b: any) => getBadgeScore(b, 'IC') - getBadgeScore(a, 'IC'));

                const notRecommended = rankedTickers.filter((t: any) =>
                  !t.strategyBadges || t.strategyBadges.length === 0 ||
                  !t.strategyBadges.some((b: any) => b.score >= badgeCutoff(t))
                ).sort((a: any, b: any) => b.score - a.score);

                const renderTickerCard = (ticker: any, index: number, section: 'BPS' | 'BCS' | 'IC') => {
                  // A ticker can appear in multiple sections. Disable the checkbox only if the
                  // user has already locked to a DIFFERENT section (strategy).
                  const isDisabled = !!lockedStrategy && lockedStrategy !== section;
                  // Show the score for THIS section's strategy (not the overall score)
                  const sectionScore = getBadgeScore(ticker, section);
                  // Route for the Trade This button in this section
                  const sectionRoute = section === 'BCS' ? '/cc' : '/iron-condor';
                  
                  return (
                <div
                  key={`${section}-${ticker.symbol}`}
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
                          onChange={() => handleTickerToggle(ticker.symbol, section)}
                          disabled={isDisabled}
                          className={`h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ${
                            isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                          title={isDisabled ? `Locked to ${lockedStrategy} strategy` : ''}
                        />
                        {getRankIcon(index)}
                        <span className="text-sm font-medium text-muted-foreground">
                          #{index + 1}
                        </span>
                        <h3 className="text-xl font-bold">{ticker.symbol}</h3>
                        <Badge className={getScoreBadgeColor(sectionScore || ticker.score)} title={`${section} score: ${sectionScore}/100`}>
                          {sectionScore || ticker.score}/100
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
                        onClick={() => setLocation(sectionRoute)}
                        className="flex-shrink-0"
                        variant={sectionScore >= 70 ? 'default' : 'outline'}
                        disabled={sectionScore < 40}
                      >
                        Trade This
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                  </div>
                </div>
                  );
                };

                return (
                  <>
                    {/* Bull Put Spreads */}
                    {bpsTickers.length > 0 && (
                      <div id="bull-put-spreads-section">
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-green-500" />
                          <h3 className="text-lg font-semibold">Bull Put Spreads</h3>
                          <Badge variant="outline" className="text-xs">
                            {bpsTickers.length} {bpsTickers.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {bpsTickers.map((ticker: any, index: number) => renderTickerCard(ticker, index, 'BPS'))}
                        </div>
                      </div>
                    )}

                    {/* Bear Call Spreads */}
                    {bcsTickers.length > 0 && (
                      <div id="bear-call-spreads-section">
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-red-500" />
                          <h3 className="text-lg font-semibold">Bear Call Spreads</h3>
                          <Badge variant="outline" className="text-xs">
                            {bcsTickers.length} {bcsTickers.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {bcsTickers.map((ticker: any, index: number) => renderTickerCard(ticker, index, 'BCS'))}
                        </div>
                      </div>
                    )}

                    {/* Iron Condors */}
                    {icTickers.length > 0 && (
                      <div id="iron-condors-section">
                        <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                          <div className="h-3 w-3 rounded-full bg-blue-500" />
                          <h3 className="text-lg font-semibold">Iron Condors</h3>
                          <Badge variant="outline" className="text-xs">
                            {icTickers.length} {icTickers.length === 1 ? 'ticker' : 'tickers'}
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {icTickers.map((ticker: any, index: number) => renderTickerCard(ticker, index, 'IC'))}
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
                          {notRecommended.map((ticker: any, index: number) => renderTickerCard(ticker, index, 'BPS'))}
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
              Configure automatic updates for Spread Advisor recommendations
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
      
      {/* Floating Back to Top Button */}
      {showBackToTop && (
        <Button
          className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
          size="icon"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <ChevronUp className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
