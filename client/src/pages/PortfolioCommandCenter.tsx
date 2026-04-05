import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
// ActivePositionsTab and WorkingOrdersTab moved to Daily Actions → /working-orders and /open-positions
import { IraSafetyTab } from '@/components/IraSafetyTab';
import { PositionAnalyzerTab } from '@/components/PositionAnalyzerTab';
import PortfolioAdvisor from '@/pages/PortfolioAdvisor';
import StockScreener from '@/pages/StockScreener';
import {
  Grid3X3,
  Activity,
  ShieldCheck,
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
  Brain,
  X,
  Sparkles,
  Dog,
  BookOpen,
  ChevronRight,
  GraduationCap,
  Target,
  Gauge,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ScanLine,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { useTradingMode } from '@/contexts/TradingModeContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

// --- Types ---
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
  expirationStrategies?: Record<string, string>; // expiration -> strategy label
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

// --- Progressive Heat Map Hook ---
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
  // Detect composite strategy for a group of positions sharing the same underlying+expiration
  const detectGroupStrategy = useCallback((groupPositions: PositionSummary[]): string => {
    const legs = groupPositions.map(pos => {
      const isShort = pos.direction?.toLowerCase() === 'short' || pos.quantity < 0;
      const occMatch = pos.symbol?.match(/([CP])(\d{8})$/);
      const isPut = occMatch ? occMatch[1] === 'P' : false;
      return { isShort, isPut };
    });
    const shortPuts  = legs.filter(l => l.isShort && l.isPut).length;
    const longPuts   = legs.filter(l => !l.isShort && l.isPut).length;
    const shortCalls = legs.filter(l => l.isShort && !l.isPut).length;
    const longCalls  = legs.filter(l => !l.isShort && !l.isPut).length;

    if (shortPuts > 0 && longPuts > 0 && shortCalls > 0 && longCalls > 0) return 'IC';
    if (shortPuts > 0 && longPuts > 0 && shortCalls === 0) return 'BPS';
    if (shortCalls > 0 && longCalls > 0 && shortPuts === 0) return 'BCS';
    if (shortCalls > 0 && longCalls > 0 && shortPuts > 0 && longPuts === 0) return 'PMCC';
    if (shortCalls > 0 && shortPuts === 0 && longCalls === 0) return 'CC';
    if (shortPuts > 0 && shortCalls === 0 && longPuts === 0) return 'CSP';
    if (longCalls > 0 && shortCalls === 0 && shortPuts === 0) return 'Long Call';
    if (longPuts > 0 && shortPuts === 0 && shortCalls === 0) return 'Long Put';
    return 'Mixed';
  }, []);

  const buildTickers = useCallback((
    positions: PositionSummary[],
    greeksMap: Record<string, { delta: number; theta: number; vega: number; gamma: number; mid_iv: number }>,
    loadedSymbols: Set<string>
  ) => {
    // Step 1: Group positions by underlying+expiration to detect composite strategies
    const groupMap = new Map<string, PositionSummary[]>();
    for (const pos of positions) {
      const key = `${pos.underlying}|${pos.expiration}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(pos);
    }

    // Step 2: Detect strategy per group
    const groupStrategyMap = new Map<string, string>();
    Array.from(groupMap.entries()).forEach(([key, groupPositions]) => {
      groupStrategyMap.set(key, detectGroupStrategy(groupPositions));
    });

    // Step 3: Build ticker map using composite strategies
    const tickerMap = new Map<string, TickerData>();

    for (const pos of positions) {
      const { underlying, symbol, quantity, direction, multiplier, openPrice, expiresAt, expiration } = pos;
      const absQty = Math.abs(quantity);
      const isShort = direction?.toLowerCase() === 'short' || quantity < 0;
      const sign = isShort ? -1 : 1;

      const groupKey = `${underlying}|${expiration}`;
      const strategy = groupStrategyMap.get(groupKey) ?? (isShort ? 'CC' : 'Long Call');

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
          expirationStrategies: { [expiration]: strategy },
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
        if (!existing.expirationStrategies) existing.expirationStrategies = {};
        existing.expirationStrategies[expiration] = strategy;
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
  }, [detectGroupStrategy]);

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
    positions: positionsRef.current,
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

/// --- Heat Map Cell ---
function HeatMapCell({
  ticker,
  viewMode,
  maxValue,
  maxPremium,
  onAnalyze,
}: {
  ticker: TickerData;
  viewMode: ViewMode;
  maxValue: number;
  maxPremium: number;
  onAnalyze: (ticker: TickerData) => void;
}) {
  // Proportional sizing: tiles span 1-3 grid cells based on premium at risk
  const premiumRatio = maxPremium > 0 ? ticker.premiumAtRisk / maxPremium : 0;
  const span = premiumRatio >= 0.7 ? 3 : premiumRatio >= 0.4 ? 2 : premiumRatio >= 0.15 ? 2 : 1;
  const minH = span >= 3 ? '120px' : span >= 2 ? '100px' : '80px';
  const value = viewMode === 'delta' ? ticker.netDelta : ticker.dailyTheta;
  const intensity = maxValue > 0 ? Math.min(Math.abs(value) / maxValue, 1) : 0;
  const greeksReady = ticker.greeksLoaded !== false;

  // --- Background color: delta/theta bias + intensity ---
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

  // --- DTE urgency border: red flash ≤7d, amber ≤14d, none otherwise ---
  let borderStyle: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.05)' };
  if (greeksReady && ticker.avgDte > 0) {
    if (ticker.avgDte <= 7) {
      borderStyle = { border: '2px solid rgba(239, 68, 68, 0.80)', boxShadow: '0 0 6px rgba(239,68,68,0.35)' };
    } else if (ticker.avgDte <= 14) {
      borderStyle = { border: '2px solid rgba(251, 191, 36, 0.70)', boxShadow: '0 0 4px rgba(251,191,36,0.25)' };
    }
  }

  // --- IV rank badge: high IV = sell opportunity, low IV = caution ---
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

  // Collapse raw leg labels into composite strategy abbreviation for display
  const collapseStrategies = (strategies: string[]): string => {
    const s = strategies.map(x => x.toUpperCase());
    const hasShortPut  = s.some(x => x === 'CSP' || x === 'SHORT PUT' || x === 'BPS');
    const hasLongPut   = s.some(x => x === 'LONG PUT' || x === 'BPS');
    const hasShortCall = s.some(x => x === 'CC' || x === 'SHORT CALL' || x === 'BCS');
    const hasLongCall  = s.some(x => x === 'LONG CALL' || x === 'BCS' || x === 'PMCC');
    if (s.includes('IC'))   return 'IC';
    if (s.includes('BPS'))  return 'BPS';
    if (s.includes('BCS'))  return 'BCS';
    if (s.includes('PMCC')) return 'PMCC';
    if (hasShortPut && hasLongPut && hasShortCall && hasLongCall) return 'IC';
    if (hasShortPut && hasLongPut && !hasShortCall)  return 'BPS';
    if (hasShortCall && hasLongCall && !hasShortPut) return 'BCS';
    if (hasShortCall && hasLongCall && hasShortPut)  return 'PMCC';
    if (s.includes('CC') && !hasShortPut)  return 'CC';
    if (s.includes('CSP') && !hasShortCall) return 'CSP';
    return strategies.join('/');
  };
  const strategyBadge = collapseStrategies(ticker.strategies);

  // Build multi-expiration label: "Apr: BPS / May: BCS" when multiple expirations exist
  const expirationStrategyLine = (() => {
    const expMap = ticker.expirationStrategies;
    if (!expMap) return null;
    const entries = Object.entries(expMap);
    if (entries.length <= 1) return null; // single expiration — strategyBadge is sufficient
    return entries
      .sort(([a], [b]) => a.localeCompare(b)) // sort by date string
      .map(([exp, strat]) => {
        // Format expiration as "Apr 25" from "2025-04-17"
        const d = new Date(exp);
        const mon = d.toLocaleString('en-US', { month: 'short' });
        const yr = String(d.getFullYear()).slice(2);
        return `${mon}'${yr}: ${strat}`;
      })
      .join(' / ');
  })();

  const displayValue = viewMode === 'delta'
    ? (value >= 0 ? '+' : '') + value.toFixed(1)
    : (value >= 0 ? '+$' : '-$') + Math.abs(value).toFixed(2);

  // --- Tooltip: full Greek breakdown + risk narrative ---
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
              'rounded-lg p-3 cursor-pointer transition-all duration-300 hover:scale-105 hover:z-10 relative group',
              !greeksReady && 'animate-pulse'
            )}
            style={{ backgroundColor: bgColor, minHeight: '80px', ...borderStyle }}
            onClick={() => onAnalyze(ticker)}
          >
            <div className="flex flex-col h-full justify-between">
              {/* Header row: symbol + contract count */}
              <div className="flex items-start justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-foreground/90 leading-tight">{ticker.symbol}</span>
                  {expirationStrategyLine ? (
                    <span className="text-[7px] text-amber-400/80 leading-tight mt-0.5 max-w-[80px] truncate" title={expirationStrategyLine}>
                      {expirationStrategyLine}
                    </span>
                  ) : (
                    <span className="text-[8px] font-semibold text-muted-foreground/70 leading-tight tracking-wide uppercase mt-0.5">{strategyBadge}</span>
                  )}
                </div>
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
            <span className="text-muted-foreground">Strategy: </span>
            <span className="font-semibold text-amber-300">{strategyBadge}</span>
            {ticker.strategies.length > 1 && (
              <span className="text-muted-foreground/60 ml-1">({ticker.strategies.join(', ')})</span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// --- Heat Map Grid ---
const STRATEGY_FILTERS = ['All', 'IC', 'BPS', 'BCS', 'CC', 'CSP', 'PMCC'] as const;
type StrategyFilter = typeof STRATEGY_FILTERS[number];

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
  onAnalyze,
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
  onAnalyze: (ticker: TickerData) => void;
  onRefresh: () => void;
}) {
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>('All');

  const maxValue = useMemo(() => {
    if (!tickers.length) return 1;
    return Math.max(...tickers.map(t => Math.abs(viewMode === 'delta' ? t.netDelta : t.dailyTheta)));
  }, [tickers, viewMode]);

  const maxPremium = useMemo(() => {
    if (!tickers.length) return 1;
    return Math.max(...tickers.map(t => t.premiumAtRisk));
  }, [tickers]);

  // Exact-match helper: split strategy string by '/' and check if any segment equals the filter
  const strategyMatches = useCallback((strategyStr: string, filter: string): boolean => {
    const segments = strategyStr.toUpperCase().split('/').map(s => s.trim());
    return segments.some(seg => seg === filter.toUpperCase());
  }, []);

  // Filter tickers by selected strategy type (exact segment match)
  const filteredTickers = useMemo(() => {
    if (strategyFilter === 'All') return tickers;
    return tickers.filter(t => {
      const allStrats = [
        ...(t.strategies ?? []),
        ...Object.values(t.expirationStrategies ?? {}),
      ];
      return allStrats.some(s => strategyMatches(s, strategyFilter));
    });
  }, [tickers, strategyFilter, strategyMatches]);

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
              <span className="text-amber-400/80 ml-1">· {failedBatches} batch{failedBatches > 1 ? 'es' : ''} timed out —
                <button
                  onClick={onRefresh}
                  className="ml-1 text-amber-400 hover:text-amber-300 underline underline-offset-2 font-medium"
                >
                  retry
                </button>
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {lastRefreshed.toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Strategy filter bar */}
      {tickers.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {STRATEGY_FILTERS.map(f => {
            const count = f === 'All' ? tickers.length : tickers.filter(t => {
              const allStrats = [
                ...(t.strategies ?? []),
                ...Object.values(t.expirationStrategies ?? {}),
              ];
              return allStrats.some(s => strategyMatches(s, f));
            }).length;
            if (f !== 'All' && count === 0) return null;
            return (
              <button
                key={f}
                onClick={() => setStrategyFilter(f)}
                className={cn(
                  'text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all',
                  strategyFilter === f
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-transparent border-border/40 text-muted-foreground hover:border-amber-500/30 hover:text-amber-400/80'
                )}
              >
                {f}{f !== 'All' && ` (${count})`}
              </button>
            );
          })}
          {strategyFilter !== 'All' && (
            <span className="text-[10px] text-muted-foreground/60 ml-1">
              Showing {filteredTickers.length} of {tickers.length} tickers
            </span>
          )}
        </div>
      )}

      {/* Tile grid — auto-fill columns, tiles span proportionally by premium at risk */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}
      >
        {filteredTickers.map(ticker => (
          <HeatMapCell
            key={ticker.symbol}
            ticker={ticker}
            viewMode={viewMode}
            maxValue={maxValue}
            maxPremium={maxPremium}
            onAnalyze={onAnalyze}
          />
        ))}
      </div>
    </div>
  );
}

// --- Portfolio Stat Bar ---
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

// --- Ticker Analysis Panel (AI slide-over) ---
function TickerAnalysisPanel({
  ticker,
  positions,
  onClose,
}: {
  ticker: TickerData | null;
  positions: PositionSummary[];
  onClose: () => void;
}) {
  const navigate = useLocation()[1];
  const analyzeMutation = trpc.automation.analyzeTicker.useMutation();
  type AnalysisResult = {
    strategyType: string;
    strikeDisplay: string;
    contracts: number;
    premiumCollected: number;
    avgDte: number;
    netDelta: number;
    dailyTheta: number;
    avgIv: number;
    premiumAtRisk: number;
    underlyingPrice: number | null;
    shortDelta: number | null;
    verdict: string;
    recommendation: string;
    urgency: string;
    profitPct: number;
    actionLabel: string;
    actionRoute: string;
    howToExecute: string[];
  };
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showRollCandidates, setShowRollCandidates] = useState(false);

  type RollCandidate = {
    expiration: string;
    dte: number;
    newShortStrike: number;
    newLongStrike: number;
    newShortDelta: number;
    newShortBid: number;
    newLongAsk: number;
    newSpreadCredit: number;
    netRollCredit: number;
    spreadWidth: number;
    isBest: boolean;
    reason: string;
  };
  const [rollCandidates, setRollCandidates] = useState<RollCandidate[]>([]);
  const [dteWindowUsed, setDteWindowUsed] = useState<'21-60' | '60-90'>('21-60');
  const [icTestedSide, setIcTestedSide] = useState<'call' | 'put' | null>(null);
  const rollMutation = trpc.automation.getRollCandidates.useMutation();

  // Parse OCC symbol to extract strike, expiration, option type
  const parseOCC = (sym: string) => {
    const clean = sym.replace(/\s+/g, '');
    const m = clean.match(/[A-Z]+([0-9]{6})([CP])([0-9]{8})$/);
    if (!m) return null;
    const strike = parseInt(m[3], 10) / 1000;
    const rawDate = m[1]; // YYMMDD
    const exp = `20${rawDate.slice(0,2)}-${rawDate.slice(2,4)}-${rawDate.slice(4,6)}`;
    return { strike, exp, type: m[2] as 'C' | 'P' };
  };

  // Derive roll candidate inputs from positions for a given result
  const buildRollInput = useCallback((res: AnalysisResult, pos: PositionSummary[], sym: string) => {
    const isBCS = res.strategyType.includes('BCS') || res.strategyType.includes('Bear Call');
    const isCC  = res.strategyType.includes('CC')  || res.strategyType.includes('Covered Call');
    const isIC  = res.strategyType.includes('IC')  || res.strategyType.includes('Iron Condor');
    const optType = (isBCS || isCC) ? 'C' : isIC ? undefined : 'P'; // IC: look at both sides

    const relevant = pos.filter(p => p.underlying === sym);
    const allParsed = relevant.map(p => ({ ...p, occ: parseOCC(p.symbol) })).filter(p => p.occ);
    const parsed = optType
      ? allParsed.filter(p => p.occ!.type === optType)
      : allParsed; // IC: include all legs

    if (parsed.length === 0) return null;

    const shortLegs = parsed.filter(p => p.quantity < 0);
    const longLegs  = parsed.filter(p => p.quantity > 0);
    if (shortLegs.length === 0) return null;

    // For IC: extract both short call and short put strikes for tested-side detection
    let icShortCallStrike: number | undefined;
    let icShortPutStrike: number | undefined;
    if (isIC) {
      const shortCallLeg = allParsed.find(p => p.quantity < 0 && p.occ?.type === 'C');
      const shortPutLeg  = allParsed.find(p => p.quantity < 0 && p.occ?.type === 'P');
      icShortCallStrike = shortCallLeg?.occ?.strike;
      icShortPutStrike  = shortPutLeg?.occ?.strike;
    }

    // For IC, use the tested-side short leg as the primary short leg
    // We'll let the backend determine the tested side from the underlying price
    const shortLeg = shortLegs[0];
    const longLeg  = longLegs[0];
    const currentShortStrike = shortLeg.occ!.strike;
    const currentLongStrike  = longLeg?.occ?.strike;
    const currentExpiration  = shortLeg.occ!.exp;
    const spreadWidth = currentLongStrike !== undefined
      ? Math.abs(currentLongStrike - currentShortStrike)
      : undefined;

    return {
      symbol: sym,
      strategyType: res.strategyType,
      currentShortStrike,
      currentLongStrike,
      currentExpiration,
      spreadWidth,
      icShortCallStrike,
      icShortPutStrike,
      underlyingPrice: res.underlyingPrice ?? undefined,
    };
  }, []);

  const fetchRollCandidates = useCallback((res: AnalysisResult, pos: PositionSummary[], sym: string) => {
    const rollInput = buildRollInput(res, pos, sym);
    if (!rollInput) return;
    setRollCandidates([]);
    setDteWindowUsed('21-60');
    rollMutation.mutate(rollInput, {
      onSuccess: (data) => {
        const d = data as { candidates: RollCandidate[]; dteWindowUsed?: '21-60' | '60-90'; icTestedSide?: 'call' | 'put' };
        setRollCandidates(d.candidates ?? []);
        setDteWindowUsed(d.dteWindowUsed ?? '21-60');
        setIcTestedSide(d.icTestedSide ?? null);
      },
    });
  }, [buildRollInput, rollMutation]);

  const runAnalysis = useCallback((t: TickerData, pos: PositionSummary[]) => {
    setResult(null);
    setRollCandidates([]);
    setShowRollCandidates(false);
    analyzeMutation.mutate(
      {
        symbol: t.symbol,
        netDelta: t.netDelta,
        dailyTheta: t.dailyTheta,
        netVega: t.netVega,
        netGamma: t.netGamma,
        premiumAtRisk: t.premiumAtRisk,
        contracts: t.contracts,
        strategies: t.strategies,
        avgDte: t.avgDte,
        avgIv: t.avgIv,
        positions: pos,
      },
      { onSuccess: (data) => {
        const res = data as AnalysisResult;
        setResult(res);
        // Auto-fetch roll candidates when verdict suggests rolling
        if (res.verdict === 'ROLL' || res.verdict === 'DEFEND') {
          fetchRollCandidates(res, pos, t.symbol);
        }
      }}
    );
  }, [analyzeMutation, fetchRollCandidates]);

  useEffect(() => {
    if (!ticker) return;
    runAnalysis(ticker, positions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker?.symbol]);

  // Verdict color + label
  const verdictStyle = !result ? {} : (
    result.verdict === 'HOLD' ? { bg: 'bg-emerald-500/15 border-emerald-500/30', text: 'text-emerald-400' } :
    result.verdict === 'CLOSE FOR PROFIT' ? { bg: 'bg-green-500/15 border-green-500/30', text: 'text-green-400' } :
    result.verdict === 'ROLL' ? { bg: 'bg-blue-500/15 border-blue-500/30', text: 'text-blue-400' } :
    result.verdict === 'DEFEND' ? { bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-400' } :
    { bg: 'bg-red-500/15 border-red-500/30', text: 'text-red-400' }
  );

  const urgencyDot = !result ? '' : result.urgency === 'high' ? 'bg-red-500' : result.urgency === 'medium' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <Sheet open={!!ticker} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] overflow-y-auto bg-[#0d0d0d] border-border/60 p-0">
        {ticker && (
          <div className="flex flex-col h-full">

            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-border/40">
              <SheetHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Brain className="w-4.5 h-4.5 text-amber-400" />
                    </div>
                    <div>
                      <SheetTitle className="text-base font-bold leading-tight">{ticker.symbol}</SheetTitle>
                      <p className="text-[11px] text-muted-foreground">
                        {result?.strategyType ?? ticker.strategies.join(' / ')}
                      </p>
                    </div>
                  </div>
                  {result && urgencyDot && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={cn('w-2 h-2 rounded-full', urgencyDot)} />
                      {result.urgency} urgency
                    </div>
                  )}
                </div>
              </SheetHeader>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* === POSITION IDENTITY CARD === */}
              <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
                <div className="px-4 py-2.5 bg-accent/20 border-b border-border/40">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Position Details</span>
                </div>
                <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Strategy</p>
                    <p className="font-semibold text-foreground text-xs">{result?.strategyType ?? ticker.strategies.join(', ')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Contracts</p>
                    <p className="font-semibold text-foreground">{ticker.contracts}</p>
                  </div>
                  {result?.strikeDisplay && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Strikes</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground text-xs font-mono">{result.strikeDisplay}</p>
                        {result.underlyingPrice != null && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            @ <span className="text-amber-400 font-semibold">${result.underlyingPrice.toFixed(2)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Stock price row — shown even when no strikeDisplay */}
                  {!result?.strikeDisplay && result?.underlyingPrice != null && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current Price</p>
                      <p className="font-bold text-amber-400">${result.underlyingPrice.toFixed(2)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Days to Expiry</p>
                    <p className={cn('font-bold', ticker.avgDte <= 7 ? 'text-red-400' : ticker.avgDte <= 14 ? 'text-amber-400' : 'text-foreground')}>
                      {ticker.avgDte.toFixed(0)}d
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Avg IV</p>
                    <p className={cn('font-bold', (ticker.avgIv * 100) >= 50 ? 'text-amber-400' : (ticker.avgIv * 100) >= 30 ? 'text-emerald-400' : 'text-foreground')}>
                      {(ticker.avgIv * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Premium Collected</p>
                    <p className="font-bold text-emerald-400">
                      ${result ? result.premiumCollected.toFixed(0) : ticker.premiumAtRisk.toFixed(0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Daily Theta</p>
                    <p className="font-bold text-emerald-400">+${ticker.dailyTheta.toFixed(2)}/day</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Net Delta</p>
                    <p className={cn('font-bold', ticker.netDelta > 5 ? 'text-green-400' : ticker.netDelta < -5 ? 'text-red-400' : 'text-muted-foreground')}>
                      {ticker.netDelta >= 0 ? '+' : ''}{ticker.netDelta.toFixed(1)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Premium at Risk</p>
                    <p className="font-semibold text-foreground">${ticker.premiumAtRisk.toFixed(0)}</p>
                  </div>
                </div>
              </div>

              {/* === CASH SETTLEMENT PANEL (SPXW/SPX only) === */}
              {(ticker.symbol === 'SPXW' || ticker.symbol === 'SPX') && result?.shortDelta != null && result.shortDelta > 0 && (() => {
                const strikeMatch = result?.strikeDisplay?.match(/\$(\d+(?:\.\d+)?)/g);
                const strikes = strikeMatch ? strikeMatch.map(s => parseFloat(s.replace('$', ''))) : [];
                const shortStrike = strikes[0] ?? null;
                const longStrike = strikes[1] ?? null;
                const spreadWidth = shortStrike != null && longStrike != null ? Math.abs(shortStrike - longStrike) : null;
                const contracts = result?.contracts ?? ticker.contracts ?? 0;
                const maxLoss = spreadWidth != null ? spreadWidth * 100 * contracts : null;
                const maxProfit = result?.premiumCollected ?? ticker.premiumAtRisk;
                const riskReward = maxLoss != null && maxProfit > 0 ? (maxProfit / maxLoss) : null;
                return (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Cash Settlement — No Assignment Risk</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      SPXW settles in cash at expiration (PM-settled). No shares are ever assigned. The only outcome is a cash debit or credit based on the index level vs. your strikes.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-border/40 bg-card/50 p-2.5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Max Profit</p>
                        <p className="text-sm font-bold text-emerald-400">${maxProfit.toFixed(0)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Premium collected</p>
                      </div>
                      <div className="rounded-lg border border-border/40 bg-card/50 p-2.5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Max Loss</p>
                        <p className="text-sm font-bold text-red-400">{maxLoss != null ? `$${maxLoss.toLocaleString()}` : '—'}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{spreadWidth != null ? `${spreadWidth}pt × 100 × ${contracts}` : 'Spread width × 100'}</p>
                      </div>
                      {riskReward != null && (
                        <div className="col-span-2 rounded-lg border border-border/40 bg-card/50 p-2.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Risk / Reward</p>
                          <p className="text-xs font-semibold text-foreground">
                            Collect ${maxProfit.toFixed(0)} to risk ${maxLoss?.toLocaleString()} — {(riskReward * 100).toFixed(1)}% ROC
                          </p>
                        </div>
                      )}
                      <div className="col-span-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
                        <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1">At Expiration</p>
                        <div className="space-y-1">
                          <p className="text-[11px] text-foreground/80">• If SPX closes between your strikes → keep full premium (max profit).</p>
                          <p className="text-[11px] text-foreground/80">• If SPX breaches a short strike → cash settlement debit, capped at spread width × 100.</p>
                          <p className="text-[11px] text-foreground/80">• No shares, no assignment, no early exercise risk.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* === ASSIGNMENT PROBABILITY GAUGE (equity positions only) === */}
              {ticker.symbol !== 'SPXW' && ticker.symbol !== 'SPX' && result?.shortDelta != null && result.shortDelta > 0 && (
                <div className="rounded-xl border border-border/50 bg-card/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assignment Probability</span>
                    </div>
                    <span className={cn(
                      'text-sm font-black',
                      result.shortDelta >= 0.70 ? 'text-red-400' :
                      result.shortDelta >= 0.50 ? 'text-orange-400' :
                      result.shortDelta >= 0.30 ? 'text-amber-400' : 'text-emerald-400'
                    )}>
                      ~{(result.shortDelta * 100).toFixed(0)}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-2 rounded-full bg-accent/30 overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        result.shortDelta >= 0.70 ? 'bg-red-500' :
                        result.shortDelta >= 0.50 ? 'bg-orange-500' :
                        result.shortDelta >= 0.30 ? 'bg-amber-500' : 'bg-emerald-500'
                      )}
                      style={{ width: `${Math.min(100, result.shortDelta * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {result.shortDelta >= 0.70
                      ? 'Deep ITM — assignment is very likely at expiration. Consider defending now.'
                      : result.shortDelta >= 0.50
                      ? 'ITM — more likely than not to be assigned. Monitor closely.'
                      : result.shortDelta >= 0.30
                      ? 'Near the money — elevated risk. Keep an eye on this position.'
                      : 'OTM — manageable risk. Position is working in your favor.'}
                  </p>
                </div>
              )}

              {/* === AI VERDICT + RECOMMENDATION === */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Recommendation</span>
                  {analyzeMutation.isPending && (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400 ml-auto" />
                  )}
                </div>

                {analyzeMutation.isPending && !result && (
                  <div className="space-y-2">
                    {[90, 70, 85].map((w, i) => (
                      <div key={i} className="h-3 bg-accent/30 rounded animate-pulse" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                )}

                {analyzeMutation.isError && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
                    Failed to generate analysis. Please try again.
                  </div>
                )}

                {result && (
                  <>
                    {/* Verdict badge */}
                    <div className={cn('rounded-lg border px-4 py-3 flex items-center gap-3', verdictStyle.bg)}>
                      <span className={cn('text-base font-black tracking-wide', verdictStyle.text)}>
                        {result.verdict}
                      </span>
                      {result.profitPct > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          ~{result.profitPct}% of max profit realized
                        </span>
                      )}
                    </div>

                    {/* Brief recommendation */}
                    <p className="text-sm text-foreground/85 leading-relaxed">
                      {result.recommendation}
                    </p>
                  </>
                )}
              </div>

              {/* === ROLL CANDIDATES === */}
              {result && (result.verdict === 'ROLL' || result.verdict === 'DEFEND') && (
                <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
                  <button
                    className="w-full px-4 py-2.5 bg-blue-500/10 border-b border-border/40 flex items-center justify-between hover:bg-blue-500/15 transition-colors"
                    onClick={() => {
                      setShowRollCandidates(v => !v);
                      if (!showRollCandidates && rollCandidates.length === 0 && !rollMutation.isPending && ticker) {
                        fetchRollCandidates(result, positions, ticker.symbol);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-400">Live Roll Candidates</span>
                      {rollCandidates.length > 0 && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full">{rollCandidates.length}</span>
                      )}
                      {!rollMutation.isPending && rollCandidates.length > 0 && dteWindowUsed === '60-90' && (
                        <span className="text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded-full">60–90 DTE</span>
                      )}
                      {icTestedSide && (
                        <span className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded-full border font-semibold',
                          icTestedSide === 'call'
                            ? 'bg-red-500/15 text-red-400 border-red-500/25'
                            : 'bg-orange-500/15 text-orange-400 border-orange-500/25'
                        )}>
                          {icTestedSide === 'call' ? '▲ Call side tested' : '▼ Put side tested'}
                        </span>
                      )}
                    </div>
                    <ChevronRight className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', showRollCandidates && 'rotate-90')} />
                  </button>

                  {showRollCandidates && (
                    <div className="px-3 py-3">
                      {rollMutation.isPending && (
                        <div className="flex items-center gap-2 py-4 justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                          <span className="text-xs text-muted-foreground">Scanning live option chains…</span>
                        </div>
                      )}
                      {!rollMutation.isPending && rollCandidates.length === 0 && ticker?.symbol !== 'SPXW' && ticker?.symbol !== 'SPX' && (() => {
                        // --- Assignment Scenario Calculator (equity only — SPXW/SPX use cash settlement panel above) ---
                        // Parse the short strike from strikeDisplay (e.g. "$185 CALL" or "$185 CALL / $190 CALL")
                        const strikeMatch = result?.strikeDisplay?.match(/\$(\d+(?:\.\d+)?)/);
                        const shortStrike = strikeMatch ? parseFloat(strikeMatch[1]) : null;
                        const contracts = result?.contracts ?? 0;
                        const sharesPerContract = 100;
                        const totalShares = contracts * sharesPerContract;
                        const cashOnAssignment = shortStrike != null ? shortStrike * totalShares : null;
                        const premiumCollected = result?.premiumCollected ?? 0;
                        const effectiveSalePrice = shortStrike != null && totalShares > 0
                          ? shortStrike + (premiumCollected / totalShares)
                          : null;
                        const currentPrice = result?.underlyingPrice ?? null;
                        const aboveMarket = effectiveSalePrice != null && currentPrice != null
                          ? effectiveSalePrice > currentPrice
                          : null;

                        return (
                          <div className="space-y-3 py-1">
                            {/* Header */}
                            <div className="flex items-center gap-2 px-1">
                              <div className="w-2 h-2 rounded-full bg-amber-400" />
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">No Roll Available — Assignment Scenario</span>
                            </div>

                            {/* Explanation */}
                            <p className="text-xs text-muted-foreground leading-relaxed px-1">
                              No net-credit roll was found in the 21–60 DTE window. The market is pricing this position too deep ITM to roll for a credit.
                              Here is what happens if you let the position get assigned:
                            </p>

                            {/* Calculation Cards */}
                            {shortStrike != null && (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-border/40 bg-card/50 p-2.5">
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cash Received</p>
                                  <p className="text-sm font-bold text-foreground">
                                    {cashOnAssignment != null ? `$${cashOnAssignment.toLocaleString()}` : '—'}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {contracts} contracts × {sharesPerContract} shares × ${shortStrike}
                                  </p>
                                </div>

                                <div className="rounded-lg border border-border/40 bg-card/50 p-2.5">
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Effective Sale Price</p>
                                  <p className={cn('text-sm font-bold', aboveMarket === true ? 'text-emerald-400' : aboveMarket === false ? 'text-red-400' : 'text-foreground')}>
                                    {effectiveSalePrice != null ? `$${effectiveSalePrice.toFixed(2)}` : '—'}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Strike + premium ÷ shares
                                  </p>
                                </div>

                                {currentPrice != null && effectiveSalePrice != null && (
                                  <div className="col-span-2 rounded-lg border border-border/40 bg-card/50 p-2.5">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">vs. Current Market Price</p>
                                    <div className="flex items-center gap-2">
                                      <span className={cn('text-xs font-semibold', aboveMarket ? 'text-emerald-400' : 'text-red-400')}>
                                        {aboveMarket ? '▲ Above market' : '▼ Below market'}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        Effective ${effectiveSalePrice.toFixed(2)} vs. current ${currentPrice.toFixed(2)}
                                        {' '}({aboveMarket ? '+' : ''}{((effectiveSalePrice - currentPrice) / currentPrice * 100).toFixed(1)}%)
                                      </span>
                                    </div>
                                    {aboveMarket && (
                                      <p className="text-[10px] text-emerald-400/80 mt-1">
                                        Your premium collected lifts your effective exit above today's price — you're selling at a premium to the market.
                                      </p>
                                    )}
                                    {!aboveMarket && (
                                      <p className="text-[10px] text-amber-400/80 mt-1">
                                        The stock has moved significantly above your strike. Assignment still returns cash, but at a below-market effective price.
                                      </p>
                                    )}
                                  </div>
                                )}

                                <div className="col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                                  <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1.5">What Happens Next</p>
                                  <div className="space-y-1">
                                    <p className="text-[11px] text-foreground/80">1. Your {totalShares.toLocaleString()} shares are called away at ${shortStrike}/share.</p>
                                    <p className="text-[11px] text-foreground/80">2. ${cashOnAssignment?.toLocaleString()} cash is deposited into your account.</p>
                                    <p className="text-[11px] text-foreground/80">3. You keep the ${ premiumCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })} premium already collected — that’s yours regardless.</p>
                                    <p className="text-[11px] text-foreground/80">4. After assignment, you can sell a new Cash-Secured Put (CSP) on {ticker?.symbol} to re-enter the wheel at a lower strike.</p>
                                  </div>
                                  {/* Sell CSP After Assignment quick-start button */}
                                  <button
                                    onClick={() => {
                                      onClose();
                                      navigate(`/csp?symbol=${encodeURIComponent(ticker?.symbol ?? '')}`);
                                    }}
                                    className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold py-2 hover:bg-emerald-500/25 transition-colors"
                                  >
                                    <Target className="w-3.5 h-3.5" />
                                    Sell CSP on {ticker?.symbol} to Re-Enter the Wheel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {rollCandidates.length > 0 && (
                        <div className="space-y-2">
                          {rollCandidates.map((c, i) => (
                            <div
                              key={i}
                              className={cn(
                                'rounded-lg border p-3 relative',
                                c.isBest
                                  ? 'border-emerald-500/40 bg-emerald-500/8'
                                  : c.netRollCredit > 0
                                  ? 'border-blue-500/25 bg-blue-500/5'
                                  : 'border-border/30 bg-card/30'
                              )}
                            >
                              {c.isBest && (
                                <span className="absolute top-2 right-2 text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full uppercase tracking-wider">BEST</span>
                              )}
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Expiry</span>
                                  <span className="ml-1.5 font-medium">{c.expiration} ({c.dte}d)</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">New Strikes</span>
                                  <span className="ml-1.5 font-medium">
                                    ${c.newShortStrike}{c.newLongStrike !== c.newShortStrike ? ` / $${c.newLongStrike}` : ''}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">New Δ</span>
                                  <span className="ml-1.5 font-medium">{c.newShortDelta.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Net Credit</span>
                                  <span className={cn('ml-1.5 font-bold', c.netRollCredit > 0 ? 'text-emerald-400' : 'text-red-400')}>
                                    {c.netRollCredit > 0 ? '+' : ''}{(c.netRollCredit * 100).toFixed(0)}¢
                                  </span>
                                </div>
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-1.5">{c.reason}</p>
                            </div>
                          ))}
                          <p className="text-[10px] text-muted-foreground text-center pt-1">Net credit = new spread premium − cost to close current position</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* === HOW TO EXECUTE === */}
              {result && result.howToExecute && result.howToExecute.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
                  <div className="px-4 py-2.5 bg-accent/20 border-b border-border/40 flex items-center gap-2">
                    <GraduationCap className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How to Execute</span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    {result.howToExecute.map((step, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mt-0.5">
                          <span className="text-[10px] font-bold text-blue-400">{i + 1}</span>
                        </div>
                        <p className="text-xs text-foreground/80 leading-relaxed">
                          {/* Strip leading "Step N:" prefix if the AI included it */}
                          {step.replace(/^Step\s*\d+:\s*/i, '')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* === ACTION FOOTER === */}
            <div className="px-5 py-4 border-t border-border/40 space-y-2">
              {result && (
                <Button
                  className="w-full gap-2 font-semibold"
                  onClick={() => { onClose(); navigate(result.actionRoute); }}
                >
                  {result.actionLabel}
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-1.5 text-xs text-muted-foreground"
                onClick={() => ticker && runAnalysis(ticker, positions)}
                disabled={analyzeMutation.isPending}
              >
                <Sparkles className="w-3 h-3" />
                {analyzeMutation.isPending ? 'Analyzing…' : 'Re-analyze'}
              </Button>
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// --- Paper Orders Tab ---
function PaperOrdersTab() {
  const { mode } = useTradingMode();
  const utils = trpc.useUtils();
  const { data: orders, isLoading } = trpc.paperTrading.getOrders.useQuery(
    { limit: 100, status: 'all' },
    { enabled: mode === 'paper' }
  );
  const resetMutation = trpc.paperTrading.resetAll.useMutation({
    onSuccess: () => {
      utils.paperTrading.getOrders.invalidate();
      utils.paperTrading.getBalance.invalidate();
    },
  });

  if (mode !== 'paper') {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <FileText className="w-12 h-12 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-lg font-medium text-foreground">Paper Orders</p>
            <p className="text-sm text-muted-foreground mt-1">Switch to Paper Trading mode to view simulated order history.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                Paper Trading Order History
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Simulated orders — no real money involved</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-red-400 border-red-400/30 hover:bg-red-500/10"
              onClick={() => {
                if (confirm('Reset your paper account? This will clear all simulated orders and restore your $100,000 balance.')) {
                  resetMutation.mutate();
                }
              }}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reset Paper Account
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <FileText className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No paper orders yet. Use the strategy pages to simulate trades.</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order: any) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono font-medium">{order.symbol}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{order.strategy || '—'}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('text-xs', order.action === 'BUY' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30')} variant="outline">
                          {order.action}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.quantity}</TableCell>
                      <TableCell>${Number(order.fillPrice || order.limitPrice || 0).toFixed(2)}</TableCell>
                      <TableCell>${(Number(order.fillPrice || order.limitPrice || 0) * Number(order.quantity) * 100).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge className={cn('text-xs',
                          order.status === 'filled' ? 'bg-green-500/20 text-green-400' :
                          order.status === 'cancelled' ? 'bg-gray-500/20 text-gray-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        )} variant="outline">
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Page ---
export default function PortfolioCommandCenter() {
  // Read ?tab= from URL on mount — supports 'analyzer', 'position-analyzer', 'positions', 'orders', 'safety', 'advisor', 'heatmap'
  const initialTab = (() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('tab');
      if (t === 'position-analyzer' || t === 'analyzer') return 'analyzer';
      if (t === 'safety') return 'safety';
      if (t === 'advisor') return 'advisor';
      if (t === 'heatmap') return 'heatmap';
      if (t === 'screener') return 'screener';
    }
    return 'screener';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Also respond to URL changes (e.g. navigating from Home dashboard badge)
  const [location] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (!t) return;
    if (t === 'position-analyzer' || t === 'analyzer') setActiveTab('analyzer');
    else if (t === 'safety') setActiveTab('safety');
    else if (t === 'advisor') setActiveTab('advisor');
    else if (t === 'heatmap') setActiveTab('heatmap');
    else if (t === 'screener') setActiveTab('screener');
  }, [location]);
  const [viewMode, setViewMode] = useState<ViewMode>('delta');
  const [selectedTicker, setSelectedTicker] = useState<TickerData | null>(null);

  // Greeks table sort state
  type GreeksSortCol = 'symbol' | 'contracts' | 'netDelta' | 'dailyTheta' | 'netVega' | 'premiumAtRisk' | 'avgDte' | 'avgIv' | 'strategies';
  const [greeksSortCol, setGreeksSortCol] = useState<GreeksSortCol>('premiumAtRisk');
  const [greeksSortDir, setGreeksSortDir] = useState<'asc' | 'desc'>('desc');

  const handleGreeksSort = useCallback((col: GreeksSortCol) => {
    setGreeksSortCol(prev => {
      if (prev === col) {
        setGreeksSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return col;
      }
      // Default direction per column
      setGreeksSortDir(['symbol', 'strategies'].includes(col) ? 'asc' : 'desc');
      return col;
    });
  }, []);
  const {
    tickers,
    portfolio,
    positions,
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

  // Sorted rows for the Greeks table (never mutates the original tickers array)
  const sortedTickers = useMemo(() => {
    const rows = [...tickers];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (greeksSortCol) {
        case 'symbol':         cmp = a.symbol.localeCompare(b.symbol); break;
        case 'contracts':      cmp = a.contracts - b.contracts; break;
        case 'netDelta':       cmp = a.netDelta - b.netDelta; break;
        case 'dailyTheta':     cmp = a.dailyTheta - b.dailyTheta; break;
        case 'netVega':        cmp = a.netVega - b.netVega; break;
        case 'premiumAtRisk':  cmp = a.premiumAtRisk - b.premiumAtRisk; break;
        case 'avgDte':         cmp = a.avgDte - b.avgDte; break;
        case 'avgIv':          cmp = a.avgIv - b.avgIv; break;
        case 'strategies':     cmp = a.strategies.join(',').localeCompare(b.strategies.join(',')); break;
      }
      return greeksSortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [tickers, greeksSortCol, greeksSortDir]);

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
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="screener" className="flex items-center gap-1.5 text-xs">
            <ScanLine className="w-3.5 h-3.5" />
            Screener
          </TabsTrigger>
          <TabsTrigger value="heatmap" className="flex items-center gap-1.5 text-xs">
            <Grid3X3 className="w-3.5 h-3.5" />
            Heat Map
          </TabsTrigger>
          <TabsTrigger value="safety" className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            Risk Monitor
          </TabsTrigger>
          <TabsTrigger value="analyzer" className="flex items-center gap-1.5 text-xs">
            <Dog className="w-3.5 h-3.5" />
            Position Analyzer
          </TabsTrigger>
          <TabsTrigger value="advisor" className="flex items-center gap-1.5 text-xs">
            <BookOpen className="w-3.5 h-3.5" />
            Portfolio Advisor
          </TabsTrigger>
          <TabsTrigger value="paper-orders" className="flex items-center gap-1.5 text-xs">
            <FileText className="w-3.5 h-3.5" />
            Paper Orders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="screener" className="space-y-0">
          <StockScreener />
        </TabsContent>

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
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 border-border/50 text-muted-foreground hover:text-foreground hover:border-amber-500/40"
                    onClick={() => refresh()}
                    disabled={isLoading}
                    title="Refresh Greeks for all tickers"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin text-amber-400')} />
                    {isLoading ? 'Loading…' : 'Refresh Greeks'}
                  </Button>
                  <div className="w-px h-4 bg-border/50" />
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
                onAnalyze={setSelectedTicker}
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
                        {([
                          { col: 'symbol',        label: 'Symbol',    align: 'left'  },
                          { col: 'contracts',     label: 'Contracts', align: 'right' },
                          { col: 'netDelta',      label: 'Net Δ',     align: 'right' },
                          { col: 'dailyTheta',    label: 'Daily Θ',   align: 'right' },
                          { col: 'netVega',       label: 'Net V',     align: 'right' },
                          { col: 'premiumAtRisk', label: 'Premium',   align: 'right' },
                          { col: 'avgDte',        label: 'Avg DTE',   align: 'right' },
                          { col: 'avgIv',         label: 'Avg IV',    align: 'right' },
                          { col: 'strategies',    label: 'Strategies',align: 'left'  },
                        ] as { col: GreeksSortCol; label: string; align: 'left' | 'right' }[]).map(({ col, label, align }) => (
                          <th
                            key={col}
                            onClick={() => handleGreeksSort(col)}
                            className={cn(
                              'px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap',
                              align === 'left' ? 'text-left px-4' : 'text-right',
                              greeksSortCol === col
                                ? 'text-amber-400'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <span className="inline-flex items-center gap-0.5">
                              {label}
                              {greeksSortCol === col
                                ? (greeksSortDir === 'asc'
                                    ? <ChevronUp className="w-3 h-3" />
                                    : <ChevronDown className="w-3 h-3" />)
                                : <ChevronsUpDown className="w-3 h-3 opacity-30" />}
                            </span>
                          </th>
                        ))}
                        {/* AI column header */}
                        <th className="px-2 py-2 text-center">
                          <span className="inline-flex items-center gap-0.5 text-amber-400/60">
                            <Sparkles className="w-3 h-3" />
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTickers.map((t, i) => (
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
                          {/* AI analyze button */}
                          <td className="px-2 py-2 text-center">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setSelectedTicker(t)}
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-amber-500/15 text-amber-400/50 hover:text-amber-400 transition-colors"
                                    aria-label={`AI analysis for ${t.symbol}`}
                                  >
                                    <Sparkles className="w-3 h-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-xs">
                                  AI risk/reward analysis for {t.symbol}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </td>
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
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="safety">
          <IraSafetyTab />
        </TabsContent>

        <TabsContent value="analyzer">
          <PositionAnalyzerTab />
        </TabsContent>

        <TabsContent value="advisor">
          <PortfolioAdvisor />
        </TabsContent>
        <TabsContent value="paper-orders">
          <PaperOrdersTab />
        </TabsContent>
      </Tabs>

      {/* AI Ticker Analysis Slide-over */}
      <TickerAnalysisPanel
        ticker={selectedTicker}
        positions={selectedTicker ? positions.filter(p => p.underlying === selectedTicker.symbol) : []}
        onClose={() => setSelectedTicker(null)}
      />
    </div>
  );
}
