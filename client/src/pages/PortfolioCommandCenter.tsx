import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ActivePositionsTab, WorkingOrdersTab } from './Performance';
import { IraSafetyTab } from '@/components/IraSafetyTab';
import {
  Grid3X3,
  Activity,
  ShieldCheck,
  ListOrdered,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  BarChart2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
type ViewMode = 'delta' | 'theta';

type TickerData = {
  symbol: string;
  netDelta: number;
  dailyTheta: number;
  netVega: number;
  netGamma: number;
  premiumAtRisk: number;
  contracts: number;
  strategies: string[];
  avgDte: number;
  avgIv: number;
};

// ─── Heat Map Cell ────────────────────────────────────────────────────────────
function HeatMapCell({
  ticker,
  viewMode,
  maxValue,
}: {
  ticker: TickerData;
  viewMode: ViewMode;
  maxValue: number;
}) {
  const value = viewMode === 'delta' ? ticker.netDelta : ticker.dailyTheta;
  const intensity = maxValue > 0 ? Math.min(Math.abs(value) / maxValue, 1) : 0;

  // Color logic:
  // Delta view: green = long bias (positive), red = short bias (negative), slate = neutral
  // Theta view: green = positive theta income (short options), blue = negative theta (long options)
  let bgColor: string;
  let textColor: string;
  if (viewMode === 'delta') {
    if (value > 0.5) {
      bgColor = `rgba(34, 197, 94, ${0.15 + intensity * 0.55})`;
      textColor = 'text-green-300';
    } else if (value < -0.5) {
      bgColor = `rgba(239, 68, 68, ${0.15 + intensity * 0.55})`;
      textColor = 'text-red-300';
    } else {
      bgColor = 'rgba(100, 116, 139, 0.18)';
      textColor = 'text-slate-300';
    }
  } else {
    // Theta view
    if (value > 0) {
      bgColor = `rgba(34, 197, 94, ${0.15 + intensity * 0.55})`;
      textColor = 'text-green-300';
    } else {
      bgColor = `rgba(59, 130, 246, ${0.15 + intensity * 0.45})`;
      textColor = 'text-blue-300';
    }
  }

  // Cell size based on premium at risk (relative)
  const premiumLabel = ticker.premiumAtRisk >= 1000
    ? `$${(ticker.premiumAtRisk / 1000).toFixed(1)}k`
    : `$${ticker.premiumAtRisk.toFixed(0)}`;

  const displayValue = viewMode === 'delta'
    ? (value >= 0 ? '+' : '') + value.toFixed(1)
    : (value >= 0 ? '+$' : '-$') + Math.abs(value).toFixed(2);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="rounded-lg p-3 cursor-default transition-all duration-200 hover:scale-105 hover:z-10 relative border border-white/5"
            style={{ backgroundColor: bgColor, minHeight: '80px' }}
          >
            <div className="flex flex-col h-full justify-between">
              <div className="flex items-start justify-between">
                <span className="text-xs font-bold text-foreground/90 leading-tight">{ticker.symbol}</span>
                <span className="text-[9px] text-muted-foreground/70 leading-tight">{ticker.contracts}c</span>
              </div>
              <div>
                <div className={cn('text-sm font-bold', textColor)}>{displayValue}</div>
                <div className="text-[9px] text-muted-foreground/60 mt-0.5">{premiumLabel} at risk</div>
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-xs space-y-1.5 p-3">
          <div className="font-bold text-sm">{ticker.symbol}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">Net Delta</span>
            <span className={ticker.netDelta >= 0 ? 'text-green-400' : 'text-red-400'}>
              {ticker.netDelta >= 0 ? '+' : ''}{ticker.netDelta.toFixed(2)}
            </span>
            <span className="text-muted-foreground">Daily Theta</span>
            <span className="text-green-400">+${ticker.dailyTheta.toFixed(2)}</span>
            <span className="text-muted-foreground">Net Vega</span>
            <span className={ticker.netVega >= 0 ? 'text-blue-400' : 'text-amber-400'}>
              {ticker.netVega >= 0 ? '+' : ''}{ticker.netVega.toFixed(2)}
            </span>
            <span className="text-muted-foreground">Premium at Risk</span>
            <span>${ticker.premiumAtRisk.toFixed(0)}</span>
            <span className="text-muted-foreground">Avg DTE</span>
            <span>{ticker.avgDte.toFixed(0)}d</span>
            <span className="text-muted-foreground">Avg IV</span>
            <span>{(ticker.avgIv * 100).toFixed(1)}%</span>
          </div>
          <div className="pt-1 border-t border-border/40">
            <span className="text-muted-foreground">Strategies: </span>
            <span>{ticker.strategies.join(', ')}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Heat Map Grid ────────────────────────────────────────────────────────────
function HeatMapGrid({
  tickers,
  isLoading,
  viewMode,
  onRefresh,
}: {
  tickers: TickerData[];
  isLoading: boolean;
  viewMode: ViewMode;
  onRefresh: () => void;
}) {
  const maxValue = useMemo(() => {
    if (!tickers.length) return 1;
    return Math.max(...tickers.map(t => Math.abs(viewMode === 'delta' ? t.netDelta : t.dailyTheta)));
  }, [tickers, viewMode]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 p-4">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-accent/20 animate-pulse" style={{ minHeight: '80px' }} />
        ))}
      </div>
    );
  }

  if (!tickers.length) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-background/30 p-10 text-center space-y-3">
        <Grid3X3 className="w-12 h-12 text-muted-foreground/30 mx-auto" />
        <div>
          <p className="text-sm font-medium text-foreground">No open option positions found</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Connect your Tastytrade account and open some positions to see the portfolio heat map.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onRefresh}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2">
      {tickers.map(ticker => (
        <HeatMapCell key={ticker.symbol} ticker={ticker} viewMode={viewMode} maxValue={maxValue} />
      ))}
    </div>
  );
}

// ─── Portfolio Stat Bar ───────────────────────────────────────────────────────
function PortfolioStatBar({
  portfolio,
  isLoading,
}: {
  portfolio?: {
    netDelta: number;
    dailyTheta: number;
    netVega: number;
    netGamma: number;
    totalPremiumAtRisk: number;
    maxConcentration: number;
    positionCount: number;
  };
  isLoading: boolean;
}) {
  const fmt = (v: number, prefix = '', decimals = 2) =>
    isLoading ? '—' : `${prefix}${v >= 0 ? '' : ''}${v.toFixed(decimals)}`;

  const stats = [
    {
      label: 'Net Delta',
      value: isLoading ? '—' : ((portfolio?.netDelta ?? 0) >= 0 ? '+' : '') + (portfolio?.netDelta ?? 0).toFixed(1),
      sub: 'Portfolio directional bias',
      icon: Activity,
      color: !portfolio ? 'text-muted-foreground' : portfolio.netDelta > 5 ? 'text-green-400' : portfolio.netDelta < -5 ? 'text-red-400' : 'text-slate-300',
    },
    {
      label: 'Daily Theta',
      value: isLoading ? '—' : `+$${(portfolio?.dailyTheta ?? 0).toFixed(2)}`,
      sub: 'Expected daily decay income',
      icon: TrendingUp,
      color: 'text-green-400',
    },
    {
      label: 'Net Vega',
      value: isLoading ? '—' : ((portfolio?.netVega ?? 0) >= 0 ? '+' : '') + (portfolio?.netVega ?? 0).toFixed(2),
      sub: 'IV sensitivity (crash risk)',
      icon: TrendingDown,
      color: !portfolio ? 'text-muted-foreground' : portfolio.netVega < -50 ? 'text-amber-400' : 'text-blue-400',
    },
    {
      label: 'Max Concentration',
      value: isLoading ? '—' : `${(portfolio?.maxConcentration ?? 0).toFixed(1)}%`,
      sub: 'Largest single-ticker %',
      icon: AlertTriangle,
      color: !portfolio ? 'text-muted-foreground' : (portfolio?.maxConcentration ?? 0) > 25 ? 'text-red-400' : (portfolio?.maxConcentration ?? 0) > 15 ? 'text-amber-400' : 'text-green-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(stat => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="bg-card/50 backdrop-blur border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={cn('text-2xl font-bold mt-0.5', stat.color)}>
                    {isLoading ? (
                      <span className="inline-block w-12 h-6 bg-accent/30 rounded animate-pulse" />
                    ) : stat.value}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-accent/50 flex items-center justify-center">
                  <Icon className={cn('w-4 h-4', stat.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PortfolioCommandCenter() {
  const [activeTab, setActiveTab] = useState('heatmap');
  const [viewMode, setViewMode] = useState<ViewMode>('delta');

  const { data, isLoading, refetch } = trpc.automation.getPortfolioGreeks.useQuery(undefined, {
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: false,
  });

  const tickers = (data?.tickers ?? []) as TickerData[];
  const portfolio = data?.portfolio;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent">
            Portfolio Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time risk posture, Greeks aggregation, and position overview
            {portfolio && (
              <span className="ml-2 text-amber-400/80">
                · {portfolio.positionCount} contracts · ${(portfolio.totalPremiumAtRisk / 1000).toFixed(1)}k premium at risk
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Portfolio Stat Bar */}
      <PortfolioStatBar portfolio={portfolio} isLoading={isLoading} />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="heatmap" className="flex items-center gap-1.5 text-xs">
            <Grid3X3 className="w-3.5 h-3.5" />
            Heat Map
          </TabsTrigger>
          <TabsTrigger value="positions" className="flex items-center gap-1.5 text-xs">
            <ListOrdered className="w-3.5 h-3.5" />
            Open Positions
          </TabsTrigger>
          <TabsTrigger value="orders" className="flex items-center gap-1.5 text-xs">
            <Activity className="w-3.5 h-3.5" />
            Working Orders
          </TabsTrigger>
          <TabsTrigger value="safety" className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            Risk Monitor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="heatmap" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Grid3X3 className="w-5 h-5 text-amber-400" />
                  Portfolio Heat Map
                  {tickers.length > 0 && (
                    <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-400">
                      {tickers.length} tickers
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant={viewMode === 'delta' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setViewMode('delta')}
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                    Delta View
                  </Button>
                  <Button
                    variant={viewMode === 'theta' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setViewMode('theta')}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Theta View
                  </Button>
                </div>
              </div>
              {/* Legend */}
              <div className="flex items-center gap-4 pt-1">
                {viewMode === 'delta' ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <div className="w-2.5 h-2.5 rounded-sm bg-green-500/60" />
                      Long delta bias
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <div className="w-2.5 h-2.5 rounded-sm bg-slate-400/30" />
                      Neutral
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <div className="w-2.5 h-2.5 rounded-sm bg-red-500/60" />
                      Short delta bias
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <div className="w-2.5 h-2.5 rounded-sm bg-green-500/60" />
                      Positive theta (income)
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <div className="w-2.5 h-2.5 rounded-sm bg-blue-500/50" />
                      Negative theta (cost)
                    </div>
                  </>
                )}
                <span className="text-[10px] text-muted-foreground/60 ml-auto">
                  Color intensity = magnitude · Hover for full Greeks
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <HeatMapGrid
                tickers={tickers}
                isLoading={isLoading}
                viewMode={viewMode}
                onRefresh={() => refetch()}
              />
            </CardContent>
          </Card>

          {/* Greeks Summary Table */}
          {tickers.length > 0 && (
            <Card className="bg-card/50 backdrop-blur border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">Greeks by Ticker</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Symbol</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Contracts</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Net Δ</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Daily Θ</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Net V</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Premium</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Avg DTE</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Avg IV</th>
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">Strategies</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickers.map((t, i) => (
                        <tr key={t.symbol} className={cn('border-b border-border/20 hover:bg-accent/10', i % 2 === 0 ? '' : 'bg-accent/5')}>
                          <td className="px-4 py-2 font-bold text-foreground">{t.symbol}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{t.contracts}</td>
                          <td className={cn('px-3 py-2 text-right font-mono', t.netDelta >= 0 ? 'text-green-400' : 'text-red-400')}>
                            {t.netDelta >= 0 ? '+' : ''}{t.netDelta.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-green-400">
                            +${t.dailyTheta.toFixed(2)}
                          </td>
                          <td className={cn('px-3 py-2 text-right font-mono', t.netVega >= 0 ? 'text-blue-400' : 'text-amber-400')}>
                            {t.netVega >= 0 ? '+' : ''}{t.netVega.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            ${t.premiumAtRisk >= 1000 ? (t.premiumAtRisk / 1000).toFixed(1) + 'k' : t.premiumAtRisk.toFixed(0)}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{t.avgDte.toFixed(0)}d</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{(t.avgIv * 100).toFixed(1)}%</td>
                          <td className="px-3 py-2 text-muted-foreground">{t.strategies.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border/60 bg-accent/10">
                        <td className="px-4 py-2 font-bold text-foreground">TOTAL</td>
                        <td className="px-3 py-2 text-right font-bold text-foreground">{portfolio?.positionCount ?? 0}</td>
                        <td className={cn('px-3 py-2 text-right font-bold font-mono', (portfolio?.netDelta ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {(portfolio?.netDelta ?? 0) >= 0 ? '+' : ''}{(portfolio?.netDelta ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold font-mono text-green-400">
                          +${(portfolio?.dailyTheta ?? 0).toFixed(2)}
                        </td>
                        <td className={cn('px-3 py-2 text-right font-bold font-mono', (portfolio?.netVega ?? 0) >= 0 ? 'text-blue-400' : 'text-amber-400')}>
                          {(portfolio?.netVega ?? 0) >= 0 ? '+' : ''}{(portfolio?.netVega ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-foreground">
                          ${((portfolio?.totalPremiumAtRisk ?? 0) / 1000).toFixed(1)}k
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="positions">
          <ActivePositionsTab />
        </TabsContent>

        <TabsContent value="orders">
          <WorkingOrdersTab />
        </TabsContent>

        <TabsContent value="safety">
          <IraSafetyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
