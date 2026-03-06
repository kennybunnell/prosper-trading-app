import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
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
  greeksLoaded?: boolean;  // true once Greeks have been fetched for this ticker
};

type PositionSummary = {
  symbol: string;
  underlying: string;
  expiration: string;
  quantity: number;
  direction: string;
  multiplier: number;
  openPrice: number;
  expiresAt: string;
  accountNumber: string;
};

type LoadPhase = 'idle' | 'positions' | 'greeks' | 'done' | 'error';

// ─── Progressive Heat Map Hook ────────────────────────────────────────────────
// Two-stage loading: (1) fetch positions fast, (2) fetch Greeks in batches of N
function useProgressiveHeatMap(batchSize = 5) {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [phase, setPhase] = useState<LoadPhase>('idle');
  const [batchesDone, setBatchesDone] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [greeksLoaded, setGreeksLoaded] = useState(0);
  const [totalChainKeys, setTotalChainKeys] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [failedBatches, setFailedBatches] = useState(0);
  const runningRef = useRef(false);
  const positionsRef = useRef<PositionSummary[]>([]);
  const chainKeysRef = useRef<{ symbol: string; expiration: string }[]>([]);

  const utils = trpc.useUtils();

  // Build ticker map from positions + greeks
  const buildTickers = useCallback((
    positions: PositionSummary[],
    greeksMap: Record<string, { delta: number; theta: number; vega: number; gamma: number; mid_iv: number }>,
    loadedSymbols: Set<string>
  ) => {
    const tickerMap = new Map<string, TickerData>();

    for (const pos of positions) {
      const { underlying, symbol, quantity, direction, multiplier, openPrice, expiresAt } = pos;
      const absQty = Math.abs(quantity);
      const isShort = direction?.toLowerCase() === 'short' || quantity < 0;
      const sign = isShort ? -1 : 1;

      const occMatch = symbol?.match(/([CP])(\d{8})$/);
      const isPut = occMatch ? occMatch[1] === 'P' : false;
      const strategy = isShort ? (isPut ? 'CSP' : 'CC') : (isPut ? 'Long Put' : 'Long Call');

      const premiumAtRisk = openPrice * absQty * multiplier;
      const dte = expiresAt
        ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;

      // Tastytrade uses space-padded OCC ("AAPL  210416C00125000"), Tradier uses compact ("AAPL210416C00125000")
      const normalizedSymbol = (symbol || '').replace(/\s+/g, '');
      const g = greeksMap[normalizedSymbol] ?? { delta: 0, theta: 0, vega: 0, gamma: 0, mid_iv: 0 };
      const scaledDelta = g.delta * sign * absQty * multiplier;
      const scaledTheta = g.theta * sign * absQty * multiplier;
      const scaledVega = g.vega * sign * absQty * multiplier;
      const scaledGamma = g.gamma * sign * absQty * multiplier;

      const existing = tickerMap.get(underlying);
      if (!existing) {
        tickerMap.set(underlying, {
          symbol: underlying,
          netDelta: scaledDelta,
          dailyTheta: scaledTheta,
          netVega: scaledVega,
          netGamma: scaledGamma,
          premiumAtRisk,
          contracts: absQty,
          strategies: [strategy],
          avgDte: dte,
          avgIv: g.mid_iv > 0 ? g.mid_iv : 0,
          greeksLoaded: loadedSymbols.has(underlying),
        });
      } else {
        const prevContracts = existing.contracts;
        existing.netDelta += scaledDelta;
        existing.dailyTheta += scaledTheta;
        existing.netVega += scaledVega;
        existing.netGamma += scaledGamma;
        existing.premiumAtRisk += premiumAtRisk;
        existing.contracts += absQty;
        if (!existing.strategies.includes(strategy)) existing.strategies.push(strategy);
        existing.avgDte = prevContracts > 0
          ? (existing.avgDte * prevContracts + dte * absQty) / existing.contracts
          : dte;
        if (g.mid_iv > 0) {
          existing.avgIv = prevContracts > 0 && existing.avgIv > 0
            ? (existing.avgIv * prevContracts + g.mid_iv * absQty) / existing.contracts
            : g.mid_iv;
        }
        existing.greeksLoaded = existing.greeksLoaded || loadedSymbols.has(underlying);
      }
    }

    return Array.from(tickerMap.values()).sort((a, b) => b.premiumAtRisk - a.premiumAtRisk);
  }, []);

  const startLoad = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('positions');
    setTickers([]);
    setBatchesDone(0);
    setTotalBatches(0);
    setGreeksLoaded(0);
    setTotalChainKeys(0);
    setFailedBatches(0);

    try {
      // Stage 1: fetch positions (fast)
      const posData = await utils.automation.getPortfolioPositions.fetch();
      positionsRef.current = posData.positions as PositionSummary[];
      chainKeysRef.current = posData.chainKeys;

      if (!posData.positions.length) {
        setPhase('done');
        runningRef.current = false;
        return;
      }

      // Show tiles immediately with zero Greeks (premium at risk is already available)
      const greeksMap: Record<string, { delta: number; theta: number; vega: number; gamma: number; mid_iv: number }> = {};
      const loadedSymbols = new Set<string>();
      setTickers(buildTickers(posData.positions as PositionSummary[], greeksMap, loadedSymbols));
      setTotalChainKeys(posData.chainKeys.length);
      setPhase('greeks');

      // Stage 2: fetch Greeks in batches
      const batches: { symbol: string; expiration: string }[][] = [];
      for (let i = 0; i < posData.chainKeys.length; i += batchSize) {
        batches.push(posData.chainKeys.slice(i, i + batchSize));
      }
      setTotalBatches(batches.length);

      let failed = 0;
      for (let bi = 0; bi < batches.length; bi++) {
        try {
          const result = await utils.automation.getGreeksBatch.fetch({ batch: batches[bi] });
          Object.assign(greeksMap, result.greeks);
          // Mark which underlying symbols now have Greeks
          for (const ck of batches[bi]) loadedSymbols.add(ck.symbol);
          setGreeksLoaded(prev => prev + batches[bi].length);
        } catch {
          failed++;
          setFailedBatches(f => f + 1);
        }
        setBatchesDone(bi + 1);
        // Update tiles after each batch so they populate progressively
        setTickers(buildTickers(posData.positions as PositionSummary[], { ...greeksMap }, new Set(loadedSymbols)));
      }

      setLastRefreshed(new Date());
      setPhase('done');
    } catch {
      setPhase('error');
    } finally {
      runningRef.current = false;
    }
  }, [batchSize, buildTickers, utils]);

  // Auto-start on mount
  useEffect(() => {
    startLoad();
  }, [startLoad]);

  const portfolio = useMemo(() => {
    if (!tickers.length) return null;
    const totalPremium = tickers.reduce((s, t) => s + t.premiumAtRisk, 0);
    const maxConcentration = totalPremium > 0
      ? Math.max(...tickers.map(t => t.premiumAtRisk / totalPremium * 100))
      : 0;
    return {
      netDelta: tickers.reduce((s, t) => s + t.netDelta, 0),
      dailyTheta: tickers.reduce((s, t) => s + t.dailyTheta, 0),
      netVega: tickers.reduce((s, t) => s + t.netVega, 0),
      netGamma: tickers.reduce((s, t) => s + t.netGamma, 0),
      totalPremiumAtRisk: totalPremium,
      maxConcentration: Math.round(maxConcentration * 10) / 10,
      positionCount: tickers.reduce((s, t) => s + t.contracts, 0),
    };
  }, [tickers]);

  return {
    tickers,
    portfolio,
    phase,
    batchesDone,
    totalBatches,
    greeksLoaded,
    totalChainKeys,
    lastRefreshed,
    failedBatches,
    isLoading: phase === 'positions' || phase === 'greeks',
    refresh: startLoad,
  };
}

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
  const greeksReady = ticker.greeksLoaded !== false;

  // ── Background color: delta/theta bias + intensity ──────────────────────────
  let bgColor: string;
  let textColor: string;
  if (!greeksReady) {
    bgColor = 'rgba(100, 116, 139, 0.12)';
    textColor = 'text-muted-foreground';
  } else if (viewMode === 'delta') {
    if (value > 0.5) {
      // Long delta bias → green (positive directional risk)
      bgColor = `rgba(34, 197, 94, ${0.12 + intensity * 0.60})`;
      textColor = 'text-green-300';
    } else if (value < -0.5) {
      // Short delta bias → red (negative directional risk)
      bgColor = `rgba(239, 68, 68, ${0.12 + intensity * 0.60})`;
      textColor = 'text-red-300';
    } else {
      // Neutral → slate (well-balanced position)
      bgColor = 'rgba(100, 116, 139, 0.20)';
      textColor = 'text-slate-300';
    }
  } else {
    // Theta view: green = collecting premium, blue = paying premium
    if (value > 0) {
      bgColor = `rgba(34, 197, 94, ${0.12 + intensity * 0.60})`;
      textColor = 'text-green-300';
    } else {
      bgColor = `rgba(59, 130, 246, ${0.12 + intensity * 0.50})`;
      textColor = 'text-blue-300';
    }
  }

  // ── DTE urgency border: red flash ≤7d, amber ≤14d, none otherwise ───────────
  let borderStyle: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.05)' };
  if (greeksReady && ticker.avgDte > 0) {
    if (ticker.avgDte <= 7) {
      borderStyle = { border: '2px solid rgba(239, 68, 68, 0.80)', boxShadow: '0 0 6px rgba(239,68,68,0.35)' };
    } else if (ticker.avgDte <= 14) {
      borderStyle = { border: '2px solid rgba(251, 191, 36, 0.70)', boxShadow: '0 0 4px rgba(251,191,36,0.25)' };
    }
  }

  // ── IV rank badge: high IV = sell opportunity, low IV = caution ──────────────
  // avgIv is decimal (e.g. 0.35 = 35% IV). Rough IV rank buckets:
  // >0.50 = very high (sell premium aggressively) → amber badge
  // 0.30-0.50 = elevated (good selling environment) → green badge
  // <0.30 = low (caution, premium is thin) → no badge
  const ivPct = ticker.avgIv * 100;
  let ivBadge: { label: string; color: string } | null = null;
  if (greeksReady && ticker.avgIv > 0) {
    if (ivPct >= 50) ivBadge = { label: `IV ${ivPct.toFixed(0)}%`, color: 'bg-amber-500/80 text-amber-100' };
    else if (ivPct >= 30) ivBadge = { label: `IV ${ivPct.toFixed(0)}%`, color: 'bg-emerald-600/70 text-emerald-100' };
    else ivBadge = { label: `IV ${ivPct.toFixed(0)}%`, color: 'bg-slate-600/60 text-slate-300' };
  }

  const premiumLabel = ticker.premiumAtRisk >= 1000
    ? `$${(ticker.premiumAtRisk / 1000).toFixed(1)}k`
    : `$${ticker.premiumAtRisk.toFixed(0)}`;

  const displayValue = viewMode === 'delta'
    ? (value >= 0 ? '+' : '') + value.toFixed(1)
    : (value >= 0 ? '+$' : '-$') + Math.abs(value).toFixed(2);

  // ── Tooltip: full Greek breakdown + risk narrative ───────────────────────────
  const deltaStory = !greeksReady ? '—' :
    Math.abs(ticker.netDelta) < 0.5 ? 'Neutral ✓' :
    ticker.netDelta > 0 ? `Long bias (+${ticker.netDelta.toFixed(1)}Δ)` :
    `Short bias (${ticker.netDelta.toFixed(1)}Δ)`;

  const dteStory = ticker.avgDte <= 7 ? `⚠ ${ticker.avgDte}d — expiry imminent` :
    ticker.avgDte <= 14 ? `${ticker.avgDte}d — theta sweet spot` :
    `${ticker.avgDte}d — time to manage`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'rounded-lg p-3 cursor-default transition-all duration-300 hover:scale-105 hover:z-10 relative',
              !greeksReady && 'animate-pulse'
            )}
            style={{ backgroundColor: bgColor, minHeight: '80px', ...borderStyle }}
          >
            <div className="flex flex-col h-full justify-between">
              {/* Header row: symbol + contract count */}
              <div className="flex items-start justify-between">
                <span className="text-xs font-bold text-foreground/90 leading-tight">{ticker.symbol}</span>
                <span className="text-[9px] text-muted-foreground/70 leading-tight">{ticker.contracts}c</span>
              </div>

              {/* Main value */}
              <div>
                {!greeksReady ? (
                  <div className="flex items-center gap-1 mt-2">
                    <Loader2 className="w-3 h-3 text-muted-foreground/50 animate-spin" />
                    <span className="text-[9px] text-muted-foreground/50">loading…</span>
                  </div>
                ) : (
                  <div className={cn('text-sm font-bold transition-colors duration-500', textColor)}>{displayValue}</div>
                )}
                <div className="text-[9px] text-muted-foreground/60 mt-0.5">{premiumLabel} at risk</div>
              </div>

              {/* IV badge (bottom-right corner) */}
              {ivBadge && (
                <div className="absolute bottom-1.5 right-1.5">
                  <span className={cn('text-[8px] font-semibold px-1 py-0.5 rounded', ivBadge.color)}>
                    {ivBadge.label}
                  </span>
                </div>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs space-y-2 p-3">
          <div className="font-bold text-sm">{ticker.symbol}</div>

          {/* Risk narrative */}
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <div>📐 {deltaStory}</div>
            <div>⏱ {dteStory}</div>
            {greeksReady && ticker.dailyTheta > 0 && (
              <div>💰 Earning +${ticker.dailyTheta.toFixed(2)}/day in theta</div>
            )}
          </div>

          {/* Full Greeks grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] pt-1 border-t border-border/40">
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
            <span className={ticker.avgDte <= 7 ? 'text-red-400 font-semibold' : ticker.avgDte <= 14 ? 'text-amber-400' : ''}>
              {ticker.avgDte.toFixed(0)}d
            </span>
            <span className="text-muted-foreground">Avg IV</span>
            <span className={ivPct >= 50 ? 'text-amber-400' : ivPct >= 30 ? 'text-emerald-400' : 'text-slate-400'}>
              {ivPct.toFixed(1)}%
            </span>
          </div>
          <div className="pt-1 border-t border-border/40 text-[10px]">
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
  phase,
  batchesDone,
  totalBatches,
  greeksLoaded,
  totalChainKeys,
  lastRefreshed,
  failedBatches,
  viewMode,
  onRefresh,
}: {
  tickers: TickerData[];
  phase: LoadPhase;
  batchesDone: number;
  totalBatches: number;
  greeksLoaded: number;
  totalChainKeys: number;
  lastRefreshed: Date | null;
  failedBatches: number;
  viewMode: ViewMode;
  onRefresh: () => void;
}) {
  const maxValue = useMemo(() => {
    if (!tickers.length) return 1;
    return Math.max(...tickers.map(t => Math.abs(viewMode === 'delta' ? t.netDelta : t.dailyTheta)));
  }, [tickers, viewMode]);

  const progressPct = totalBatches > 0 ? Math.round((batchesDone / totalBatches) * 100) : 0;

  // Progress bar (shown during greeks phase and briefly after done)
  const showProgress = phase === 'positions' || phase === 'greeks';

  if (phase === 'positions') {
    return (
      <div className="space-y-4 p-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
          <span>Fetching positions from Tastytrade…</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-accent/20 animate-pulse" style={{ minHeight: '80px' }} />
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="rounded-xl border border-dashed border-red-500/30 bg-red-500/5 p-10 text-center space-y-3">
        <XCircle className="w-12 h-12 text-red-400/50 mx-auto" />
        <div>
          <p className="text-sm font-medium text-foreground">Failed to load portfolio data</p>
          <p className="text-xs text-muted-foreground mt-1">Check your Tastytrade credentials in Settings.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onRefresh}>
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (!tickers.length && phase === 'done') {
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
    <div className="space-y-3">
      {/* Progress bar — visible while loading Greeks */}
      {showProgress && totalBatches > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              Loading Greeks… {greeksLoaded}/{totalChainKeys} expirations
              {failedBatches > 0 && (
                <span className="text-amber-400/80 ml-1">({failedBatches} batch{failedBatches > 1 ? 'es' : ''} timed out)</span>
              )}
            </span>
            <span className="text-amber-400 font-medium">{progressPct}%</span>
          </div>
          <div className="w-full h-1.5 bg-accent/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Tiles populate as each batch of {Math.ceil(totalChainKeys / totalBatches)} expirations completes — colors will appear progressively
          </p>
        </div>
      )}

      {/* Done status */}
      {phase === 'done' && lastRefreshed && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground/60">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-green-500/70" />
            Greeks loaded for {tickers.filter(t => t.greeksLoaded).length}/{tickers.length} tickers
            {failedBatches > 0 && (
              <span className="text-amber-400/80 ml-1">· {failedBatches} batch{failedBatches > 1 ? 'es' : ''} timed out</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {lastRefreshed.toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Tile grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2">
        {tickers.map(ticker => (
          <HeatMapCell key={ticker.symbol} ticker={ticker} viewMode={viewMode} maxValue={maxValue} />
        ))}
      </div>
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
  const {
    tickers,
    portfolio,
    phase,
    batchesDone,
    totalBatches,
    greeksLoaded,
    totalChainKeys,
    lastRefreshed,
    failedBatches,
    isLoading,
    refresh,
  } = useProgressiveHeatMap(5);

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
          onClick={() => refresh()}
          disabled={isLoading}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Portfolio Stat Bar */}
      <PortfolioStatBar portfolio={portfolio ?? undefined} isLoading={isLoading} />

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
                <div className="ml-auto flex items-center gap-3">
                  {/* DTE urgency border legend */}
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <div className="w-2.5 h-2.5 rounded-sm border-2 border-red-500/80" style={{ boxShadow: '0 0 4px rgba(239,68,68,0.4)' }} />
                    ≤7d expiry
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <div className="w-2.5 h-2.5 rounded-sm border-2 border-amber-400/70" />
                    ≤14d sweet spot
                  </div>
                  {/* IV badge legend */}
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-amber-500/80 text-amber-100">IV 55%</span>
                    High IV (sell)
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">· Hover tiles for full Greeks</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <HeatMapGrid
                tickers={tickers}
                phase={phase}
                batchesDone={batchesDone}
                totalBatches={totalBatches}
                greeksLoaded={greeksLoaded}
                totalChainKeys={totalChainKeys}
                lastRefreshed={lastRefreshed}
                failedBatches={failedBatches}
                viewMode={viewMode}
                onRefresh={refresh}
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
