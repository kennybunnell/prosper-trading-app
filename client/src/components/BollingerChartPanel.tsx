import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import { trpc } from '@/lib/trpc';
import { X, BarChart2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Timeframe = '1M' | '3M' | '6M' | '1Y' | '5Y';

interface BollingerChartPanelProps {
  symbol: string;
  /** Optional current strike price to show as a horizontal reference line */
  strikePrice?: number;
  onClose: () => void;
}

const TIMEFRAMES: Timeframe[] = ['1M', '3M', '6M', '1Y', '5Y'];

const COLORS = {
  bg: '#0f1117',
  grid: '#1e2433',
  text: '#94a3b8',
  border: '#1e2433',
  candle: {
    upBody: '#22c55e',
    downBody: '#ef4444',
    upWick: '#22c55e',
    downWick: '#ef4444',
  },
  bb: {
    upper: '#f59e0b',
    middle: '#6366f1',
    lower: '#f59e0b',
  },
  volume: {
    up: 'rgba(34,197,94,0.35)',
    down: 'rgba(239,68,68,0.35)',
  },
  rsi: {
    line: '#a78bfa',
    overbought: 'rgba(239,68,68,0.25)',
    oversold: 'rgba(34,197,94,0.25)',
    refLine: '#475569',
  },
  strike: '#f43f5e',
};

export function BollingerChartPanel({ symbol, strikePrice, onClose }: BollingerChartPanelProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);

  // Main chart refs
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const upperBBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const middleBBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerBBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const strikePriceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);

  // RSI chart refs
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // ── Stage 1: Fast candles-only query ──────────────────────────────────────
  const {
    data: candleData,
    isLoading: candlesLoading,
    error: candlesError,
    refetch: refetchCandles,
  } = trpc.charts.getCandles.useQuery(
    { symbol, timeframe },
    { staleTime: 15 * 60 * 1000 }
  );

  // ── Stage 2: Full BB + RSI data — only fires after candles are loaded ─────
  const {
    data: fullData,
    isLoading: bbLoading,
    refetch: refetchFull,
  } = trpc.charts.getHistory.useQuery(
    { symbol, timeframe },
    {
      staleTime: 15 * 60 * 1000,
      enabled: !!candleData && candleData.bars.length > 0,
    }
  );

  const isLoading = candlesLoading;
  const error = candlesError;

  function refetch() {
    refetchCandles();
    refetchFull();
  }

  // ── Create main chart once on mount ──────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: "'Inter', 'SF Pro Display', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', width: 1, style: 3 },
        horzLine: { color: '#475569', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.candle.upBody,
      downColor: COLORS.candle.downBody,
      borderUpColor: COLORS.candle.upBody,
      borderDownColor: COLORS.candle.downBody,
      wickUpColor: COLORS.candle.upWick,
      wickDownColor: COLORS.candle.downWick,
    });

    const upperBB = chart.addSeries(LineSeries, {
      color: COLORS.bb.upper,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: 'BB Upper',
    });

    const middleBB = chart.addSeries(LineSeries, {
      color: COLORS.bb.middle,
      lineWidth: 1,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: 'SMA 20',
    });

    const lowerBB = chart.addSeries(LineSeries, {
      color: COLORS.bb.lower,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: 'BB Lower',
    });

    // Volume in a separate pane
    const volumePane = chart.addPane();
    volumePane.setHeight(60);
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
    }, 1);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    upperBBRef.current = upperBB;
    middleBBRef.current = middleBB;
    lowerBBRef.current = lowerBB;
    volumeSeriesRef.current = volumeSeries;

    const ro = new ResizeObserver(() => {
      if (container) {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // ── Create RSI chart once on mount ────────────────────────────────────────
  useEffect(() => {
    if (!rsiContainerRef.current) return;
    const container = rsiContainerRef.current;

    const rsiChart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: "'Inter', 'SF Pro Display', sans-serif",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', width: 1, style: 3 },
        horzLine: { color: '#475569', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    // RSI line
    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: COLORS.rsi.line,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'RSI 14',
    });

    // Overbought reference line at 70
    const ob = rsiChart.addSeries(LineSeries, {
      color: 'rgba(239,68,68,0.5)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Oversold reference line at 30
    const os = rsiChart.addSeries(LineSeries, {
      color: 'rgba(34,197,94,0.5)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Midline at 50
    const mid = rsiChart.addSeries(LineSeries, {
      color: 'rgba(71,85,105,0.6)',
      lineWidth: 1,
      lineStyle: 3,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    rsiChartRef.current = rsiChart;
    rsiSeriesRef.current = rsiSeries;

    // Store reference lines in chart for later data population
    (rsiChart as IChartApi & { _obSeries?: ISeriesApi<'Line'>; _osSeries?: ISeriesApi<'Line'>; _midSeries?: ISeriesApi<'Line'> })._obSeries = ob;
    (rsiChart as IChartApi & { _osSeries?: ISeriesApi<'Line'> })._osSeries = os;
    (rsiChart as IChartApi & { _midSeries?: ISeriesApi<'Line'> })._midSeries = mid;

    const ro = new ResizeObserver(() => {
      if (container) {
        rsiChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      rsiChart.remove();
      rsiChartRef.current = null;
    };
  }, []);

  // ── Stage 1 effect: render candles + volume as soon as they arrive ────────
  useEffect(() => {
    if (!candleData || !chartRef.current) return;
    const { bars } = candleData;
    if (!bars.length) return;

    const candles: CandlestickData[] = bars.map(b => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const volumes: HistogramData[] = bars.map((b: { time: number; open: number; close: number; volume: number }) => ({
      time: b.time as Time,
      value: b.volume,
      color: b.close >= b.open ? COLORS.volume.up : COLORS.volume.down,
    }));

    candleSeriesRef.current?.setData(candles);
    volumeSeriesRef.current?.setData(volumes);

    // Add strike price line
    if (strikePrice && candleSeriesRef.current) {
      if (strikePriceLineRef.current) {
        candleSeriesRef.current.removePriceLine(strikePriceLineRef.current);
      }
      strikePriceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: strikePrice,
        color: COLORS.strike,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: `Strike $${strikePrice}`,
      });
    }

    chartRef.current.timeScale().fitContent();

    // Populate RSI reference lines with the same time range (flat lines)
    if (rsiChartRef.current && bars.length > 0) {
      const firstTime = bars[0].time as Time;
      const lastTime = bars[bars.length - 1].time as Time;
      const flatData = (val: number): LineData[] => [
        { time: firstTime, value: val },
        { time: lastTime, value: val },
      ];
      const rc = rsiChartRef.current as IChartApi & { _obSeries?: ISeriesApi<'Line'>; _osSeries?: ISeriesApi<'Line'>; _midSeries?: ISeriesApi<'Line'> };
      rc._obSeries?.setData(flatData(70));
      rc._osSeries?.setData(flatData(30));
      rc._midSeries?.setData(flatData(50));
      rsiChartRef.current.timeScale().fitContent();
    }
  }, [candleData, strikePrice]);

  // ── Stage 2 effect: overlay BB bands + RSI once full data arrives ─────────
  useEffect(() => {
    if (!fullData || !chartRef.current) return;

    // BB overlay
    const { bbSeries } = fullData;
    if (bbSeries.length) {
      const upperData: LineData[] = bbSeries.map((b: { time: number; upper: number }) => ({ time: b.time as Time, value: b.upper }));
      const middleData: LineData[] = bbSeries.map((b: { time: number; middle: number }) => ({ time: b.time as Time, value: b.middle }));
      const lowerData: LineData[] = bbSeries.map((b: { time: number; lower: number }) => ({ time: b.time as Time, value: b.lower }));
      upperBBRef.current?.setData(upperData);
      middleBBRef.current?.setData(middleData);
      lowerBBRef.current?.setData(lowerData);
    }

    // RSI overlay
    const rsiSeries = (fullData as typeof fullData & { rsiSeries?: { time: number; rsi: number }[] }).rsiSeries;
    if (rsiSeries && rsiSeries.length && rsiSeriesRef.current) {
      const rsiData: LineData[] = rsiSeries.map((b: { time: number; rsi: number }) => ({ time: b.time as Time, value: b.rsi }));
      rsiSeriesRef.current.setData(rsiData);
      rsiChartRef.current?.timeScale().fitContent();
    }
  }, [fullData]);

  // ── Derived display values ─────────────────────────────────────────────────
  const latestBB = fullData?.bbSeries?.[fullData.bbSeries.length - 1];
  const latestBar = (candleData?.bars ?? fullData?.bars)?.[((candleData?.bars ?? fullData?.bars)?.length ?? 0) - 1];
  const rsiSeries = (fullData as typeof fullData & { rsiSeries?: { time: number; rsi: number }[] })?.rsiSeries;
  const latestRSI = rsiSeries?.[rsiSeries.length - 1];

  const bbSignal = latestBB
    ? latestBB.percentB > 0.8
      ? { label: 'Near Upper Band', color: 'text-red-400' }
      : latestBB.percentB < 0.2
      ? { label: 'Near Lower Band', color: 'text-green-400' }
      : { label: 'Mid-Band Range', color: 'text-slate-400' }
    : null;

  const rsiSignal = latestRSI
    ? latestRSI.rsi >= 70
      ? { label: 'Overbought', color: 'text-red-400' }
      : latestRSI.rsi <= 30
      ? { label: 'Oversold', color: 'text-green-400' }
      : { label: 'Neutral', color: 'text-slate-400' }
    : null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-[75vw] max-w-[95vw] min-w-[600px] bg-[#0d1117] border-l border-slate-700/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-[#0f1117]">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-amber-400" />
          <span className="font-bold text-white text-sm">{symbol}</span>
          <span className="text-slate-500 text-xs">· Bollinger Bands (20, 2) · RSI (14)</span>
          {bbLoading && !fullData && (
            <span className="flex items-center gap-1 text-xs text-indigo-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading BB + RSI…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  timeframe === tf
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <Button size="icon" variant="ghost" onClick={() => refetch()} className="h-7 w-7 text-slate-400 hover:text-white" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Signal strip */}
      {(latestBB || latestBar || latestRSI) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-900/60 border-b border-slate-700/40 text-xs flex-wrap">
          {latestBar && (
            <>
              <span className="text-slate-500">Last Close:</span>
              <span className="text-white font-semibold">${latestBar.close.toFixed(2)}</span>
            </>
          )}
          {latestBB && (
            <>
              <span className="text-slate-500">Upper:</span>
              <span className="text-amber-400">${latestBB.upper.toFixed(2)}</span>
              <span className="text-slate-500">Mid:</span>
              <span className="text-indigo-400">${latestBB.middle.toFixed(2)}</span>
              <span className="text-slate-500">Lower:</span>
              <span className="text-amber-400">${latestBB.lower.toFixed(2)}</span>
              {bbSignal && (
                <span className={`font-semibold ${bbSignal.color}`}>
                  %B {(latestBB.percentB * 100).toFixed(0)}% · {bbSignal.label}
                </span>
              )}
            </>
          )}
          {latestRSI && (
            <>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">RSI:</span>
              <span className={`font-semibold ${rsiSignal?.color ?? 'text-violet-400'}`}>
                {latestRSI.rsi.toFixed(1)} · {rsiSignal?.label ?? ''}
              </span>
            </>
          )}
        </div>
      )}

      {/* Main chart area */}
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
              <span className="text-slate-400 text-sm">Loading chart…</span>
            </div>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 z-10">
            <div className="flex flex-col items-center gap-3 max-w-xs text-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-slate-300 text-sm">{error.message}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* RSI panel */}
      <div className="border-t border-slate-700/60 bg-[#0d1117]" style={{ height: '120px' }}>
        <div className="flex items-center gap-2 px-4 pt-1 pb-0.5">
          <span className="text-xs text-slate-500 font-medium">RSI (14)</span>
          <span className="text-xs text-red-400/70">— 70 Overbought</span>
          <span className="text-xs text-green-400/70">— 30 Oversold</span>
          {bbLoading && !fullData && <Loader2 className="h-3 w-3 text-violet-400 animate-spin ml-1" />}
        </div>
        <div ref={rsiContainerRef} className="w-full" style={{ height: '90px' }} />
      </div>

      {/* Legend footer */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-700/40 bg-[#0f1117] text-xs text-slate-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-6 border-t border-dashed border-amber-400/70 inline-block" />
          Upper / Lower Band
        </span>
        <span className="flex items-center gap-1">
          <span className="w-6 border-t border-indigo-400 inline-block" />
          SMA 20
        </span>
        <span className="flex items-center gap-1">
          <span className="w-6 border-t border-violet-400 inline-block" />
          RSI 14
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500/60" />
          Up candle
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500/60" />
          Down candle
        </span>
        {strikePrice && (
          <span className="flex items-center gap-1">
            <span className="w-6 border-t border-dotted border-rose-500 inline-block" />
            Strike ${strikePrice}
          </span>
        )}
        <span className="ml-auto text-slate-600">Data: Tradier · Daily bars</span>
      </div>
    </div>
  );
}
