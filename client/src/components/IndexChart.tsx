/**
 * IndexChart — self-hosted candlestick chart for index symbols (SPX, NDX, RUT, VIX, DJX, etc.)
 *
 * Uses TradingView's open-source Lightweight Charts v5 library (MIT) with OHLC data
 * fetched from Tradier via the `charts.getIndexOHLC` tRPC procedure.
 *
 * Three stacked panels:
 *   1. Candlestick + Bollinger Bands (main, ~60% height)
 *   2. RSI (14-period) with overbought/oversold lines (~20% height)
 *   3. Volume histogram (~20% height)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { trpc } from '@/lib/trpc';
import { Loader2, AlertCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ── Index symbol → display name ──────────────────────────────────────────────
const INDEX_DISPLAY_NAMES: Record<string, string> = {
  SPXW: 'S&P 500 Weekly (SPXW)',
  SPX:  'S&P 500 (SPX)',
  NDXP: 'Nasdaq-100 Weekly (NDXP)',
  NDX:  'Nasdaq-100 (NDX)',
  MRUT: 'Russell 2000 Mini — via IWM',
  RUT:  'Russell 2000 — via IWM',
  VIX:  'CBOE VIX',
  DJX:  'Dow Jones (DJX)',
  XSP:  'Mini-SPX (XSP)',
  XND:  'Mini-NDX (XND)',
};

// ── Chart theme ───────────────────────────────────────────────────────────────
const THEME = {
  bg:     '#0f1117',
  grid:   'rgba(255,255,255,0.05)',
  text:   '#94a3b8',
  border: 'rgba(255,255,255,0.08)',
  up:     '#22c55e',
  down:   '#ef4444',
  bbUpper:  '#60a5fa',
  bbMiddle: '#94a3b8',
  bbLower:  '#60a5fa',
  rsiLine:  '#a78bfa',
  volUp:    'rgba(34,197,94,0.5)',
  volDown:  'rgba(239,68,68,0.5)',
};

interface IndexChartProps {
  symbol: string;
  /** Optional strike price — draws a dashed horizontal line on the main chart */
  strikePrice?: number;
}

type Interval = 'daily' | 'weekly' | 'monthly';
type Days = 90 | 180 | 365 | 730;

const RANGE_OPTIONS: { label: string; days: Days; interval: Interval }[] = [
  { label: '3M',  days: 90,  interval: 'daily'  },
  { label: '6M',  days: 180, interval: 'daily'  },
  { label: '1Y',  days: 365, interval: 'daily'  },
  { label: '2Y',  days: 730, interval: 'weekly' },
];

export function IndexChart({ symbol, strikePrice }: IndexChartProps) {
  const [range, setRange] = useState<{ days: Days; interval: Interval }>({ days: 365, interval: 'daily' });

  const { data, isLoading, isError, error, refetch } = trpc.charts.getIndexOHLC.useQuery(
    { symbol: symbol.toUpperCase(), interval: range.interval, days: range.days },
    { staleTime: 2 * 60 * 1000, retry: 2, retryDelay: 1000 },
  );

  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef  = useRef<HTMLDivElement>(null);
  const volRef  = useRef<HTMLDivElement>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef  = useRef<IChartApi | null>(null);
  const volChartRef  = useRef<IChartApi | null>(null);

  const destroyCharts = useCallback(() => {
    try { mainChartRef.current?.remove(); } catch { /* ignore */ }
    try { rsiChartRef.current?.remove();  } catch { /* ignore */ }
    try { volChartRef.current?.remove();  } catch { /* ignore */ }
    mainChartRef.current = null;
    rsiChartRef.current  = null;
    volChartRef.current  = null;
  }, []);

  useEffect(() => {
    if (!data?.candles?.length || !mainRef.current || !rsiRef.current || !volRef.current) return;

    destroyCharts();

    const candles = data.candles;

    const commonOpts = {
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.text,
      },
      grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: THEME.border },
      handleScroll: true,
      handleScale: true,
    };

    // ── Main chart (candlestick + BB) ─────────────────────────────────────────
    const mainChart = createChart(mainRef.current, {
      ...commonOpts,
      height: mainRef.current.clientHeight || 340,
    });
    mainChartRef.current = mainChart;

    // Candlestick series (v5 API)
    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
    });
    candleSeries.setData(
      candles.map(c => ({
        time:  c.time as any,
        open:  Number(c.open),
        high:  Number(c.high),
        low:   Number(c.low),
        close: Number(c.close),
      }))
    );

    // BB upper
    const bbUpper = mainChart.addSeries(LineSeries, {
      color: THEME.bbUpper, lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });
    bbUpper.setData(candles.filter(c => c.bb).map(c => ({ time: c.time as any, value: c.bb!.upper })));

    // BB middle (SMA20)
    const bbMiddle = mainChart.addSeries(LineSeries, {
      color: THEME.bbMiddle, lineWidth: 1, lineStyle: LineStyle.Dotted,
      priceLineVisible: false, lastValueVisible: false,
    });
    bbMiddle.setData(candles.filter(c => c.bb).map(c => ({ time: c.time as any, value: c.bb!.middle })));

    // BB lower
    const bbLower = mainChart.addSeries(LineSeries, {
      color: THEME.bbLower, lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });
    bbLower.setData(candles.filter(c => c.bb).map(c => ({ time: c.time as any, value: c.bb!.lower })));

    // ── Strike price line ────────────────────────────────────────────────────
    if (strikePrice && strikePrice > 0) {
      const strikeLine = mainChart.addSeries(LineSeries, {
        color: 'rgba(251, 191, 36, 0.9)',  // amber-400
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: true,
        lastValueVisible: true,
        title: `Strike $${strikePrice.toFixed(2)}`,
      });
      strikeLine.setData([
        { time: candles[0].time as any,                  value: strikePrice },
        { time: candles[candles.length - 1].time as any, value: strikePrice },
      ]);
      // Also add a permanent price line so the label stays pinned to the right axis
      strikeLine.createPriceLine({
        price: strikePrice,
        color: 'rgba(251, 191, 36, 0.9)',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Strike`,
      });
    }

    mainChart.timeScale().fitContent();

    // ── RSI chart ─────────────────────────────────────────────────────────────
    const rsiChart = createChart(rsiRef.current, {
      ...commonOpts,
      height: rsiRef.current.clientHeight || 120,
      rightPriceScale: {
        ...commonOpts.rightPriceScale,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });
    rsiChartRef.current = rsiChart;

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: THEME.rsiLine, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
    });
    rsiSeries.setData(
      candles.filter(c => c.rsi !== null).map(c => ({ time: c.time as any, value: c.rsi! }))
    );

    // OB/OS reference lines
    const rsiOB = rsiChart.addSeries(LineSeries, {
      color: 'rgba(239,68,68,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });
    rsiOB.setData([
      { time: candles[0].time as any, value: 70 },
      { time: candles[candles.length - 1].time as any, value: 70 },
    ]);

    const rsiOS = rsiChart.addSeries(LineSeries, {
      color: 'rgba(34,197,94,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });
    rsiOS.setData([
      { time: candles[0].time as any, value: 30 },
      { time: candles[candles.length - 1].time as any, value: 30 },
    ]);

    rsiChart.timeScale().fitContent();

    // ── Volume chart ──────────────────────────────────────────────────────────
    const volChart = createChart(volRef.current, {
      ...commonOpts,
      height: volRef.current.clientHeight || 100,
      rightPriceScale: {
        ...commonOpts.rightPriceScale,
        scaleMargins: { top: 0.2, bottom: 0 },
      },
    });
    volChartRef.current = volChart;

    const volSeries = volChart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volSeries.setData(
      candles.map((c, i) => ({
        time: c.time as any,
        value: c.volume,
        color: i === 0 ? THEME.volUp : (c.close >= candles[i - 1]?.close ? THEME.volUp : THEME.volDown),
      }))
    );

    volChart.timeScale().fitContent();

    // ── Sync time scales ──────────────────────────────────────────────────────
    const syncRange = (chart: IChartApi, others: IChartApi[]) => {
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) others.forEach(o => o.timeScale().setVisibleLogicalRange(range));
      });
    };
    syncRange(mainChart, [rsiChart, volChart]);
    syncRange(rsiChart,  [mainChart, volChart]);
    syncRange(volChart,  [mainChart, rsiChart]);

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (mainRef.current) mainChart.applyOptions({ width: mainRef.current.clientWidth });
      if (rsiRef.current)  rsiChart.applyOptions({ width: rsiRef.current.clientWidth });
      if (volRef.current)  volChart.applyOptions({ width: volRef.current.clientWidth });
    });
    if (mainRef.current) ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      destroyCharts();
    };
  }, [data, destroyCharts, strikePrice]);

  // ── Render ────────────────────────────────────────────────────────────────
  const displayName = INDEX_DISPLAY_NAMES[symbol.toUpperCase()] ?? symbol.toUpperCase();
  const isRutProxy = ['RUT', 'MRUT'].includes(symbol.toUpperCase());

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Loading {displayName} chart...</p>
        <p className="text-xs text-muted-foreground/60">Fetching OHLC data from Tradier</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10 text-destructive/60" />
        <p className="text-sm font-medium">Failed to load chart</p>
        <p className="text-xs text-muted-foreground/60">{(error as any)?.message ?? 'Unknown error'}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2 gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!data?.candles?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <TrendingUp className="h-10 w-10 opacity-30" />
        <p className="text-sm">No data available for {displayName}</p>
      </div>
    );
  }

  const lastCandle = data.candles[data.candles.length - 1];
  const prevCandle = data.candles[data.candles.length - 2];
  const change = prevCandle ? lastCandle.close - prevCandle.close : 0;
  const changePct = prevCandle ? (change / prevCandle.close) * 100 : 0;
  const isUp = change >= 0;

  return (
    <div className="flex flex-col h-full bg-[#0f1117] select-none">
      {/* Info bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{displayName}</span>
          <span className="text-base font-mono font-bold text-foreground">
            {lastCandle.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className={`text-xs font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
          {lastCandle.rsi !== null && (
            <Badge variant="outline" className={`text-xs px-1.5 py-0 ${
              lastCandle.rsi > 70 ? 'text-red-400 border-red-400/30' :
              lastCandle.rsi < 30 ? 'text-green-400 border-green-400/30' :
              'text-purple-400 border-purple-400/30'
            }`}>
              RSI {lastCandle.rsi.toFixed(1)}
            </Badge>
          )}
        </div>
        {/* Range selector */}
        <div className="flex items-center gap-1 shrink-0">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => setRange({ days: opt.days, interval: opt.interval })}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                range.days === opt.days
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1 text-xs text-muted-foreground/70 border-b border-white/5 shrink-0">
        <span className="flex items-center gap-1">
          <span className="w-3 h-px bg-blue-400 inline-block" /> BB(20,2)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-px bg-slate-400 inline-block border-dotted" /> SMA20
        </span>
        <span className="text-muted-foreground/40 text-xs ml-auto">
          {isRutProxy ? 'Data: IWM proxy (Tradier) · Chart: Lightweight Charts (MIT)' : 'Data: Tradier · Chart: Lightweight Charts (MIT)'}
        </span>
      </div>

      {/* Main candlestick + BB panel */}
      <div ref={mainRef} className="flex-[3] min-h-0 w-full" />

      {/* RSI panel */}
      <div className="shrink-0 border-t border-white/5">
        <div className="px-4 py-0.5 text-xs text-purple-400/70 font-medium">RSI (14)</div>
        <div ref={rsiRef} className="h-[100px] w-full" />
      </div>

      {/* Volume panel */}
      <div className="shrink-0 border-t border-white/5">
        <div className="px-4 py-0.5 text-xs text-slate-500/70 font-medium">Volume</div>
        <div ref={volRef} className="h-[80px] w-full" />
      </div>
    </div>
  );
}
