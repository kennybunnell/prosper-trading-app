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

type Timeframe = '1M' | '3M' | '6M' | '1Y';

interface BollingerChartPanelProps {
  symbol: string;
  /** Optional current strike price to show as a horizontal reference line */
  strikePrice?: number;
  onClose: () => void;
}

const TIMEFRAMES: Timeframe[] = ['1M', '3M', '6M', '1Y'];

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
  strike: '#f43f5e',
};

export function BollingerChartPanel({ symbol, strikePrice, onClose }: BollingerChartPanelProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const upperBBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const middleBBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerBBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const { data, isLoading, error, refetch } = trpc.charts.getHistory.useQuery(
    { symbol, timeframe },
    { staleTime: 5 * 60 * 1000 }
  );

  // Create chart once on mount
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

    // Volume in a separate pane (paneIndex 1)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    }, 1);

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.7, bottom: 0 },
    });

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

  // Populate data when query result changes
  useEffect(() => {
    if (!data || !chartRef.current) return;
    const { bars, bbSeries } = data;

    const candleData: CandlestickData[] = bars.map(b => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const volumeData: HistogramData[] = bars.map((b: { time: number; open: number; high: number; low: number; close: number; volume: number }) => ({
      time: b.time as Time,
      value: b.volume,
      color: b.close >= b.open ? COLORS.volume.up : COLORS.volume.down,
    }));

    const upperData: LineData[] = bbSeries.map((b: { time: number; upper: number; middle: number; lower: number; percentB: number }) => ({ time: b.time as Time, value: b.upper }));
    const middleData: LineData[] = bbSeries.map((b: { time: number; upper: number; middle: number; lower: number; percentB: number }) => ({ time: b.time as Time, value: b.middle }));
    const lowerData: LineData[] = bbSeries.map((b: { time: number; upper: number; middle: number; lower: number; percentB: number }) => ({ time: b.time as Time, value: b.lower }));

    candleSeriesRef.current?.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);
    upperBBRef.current?.setData(upperData);
    middleBBRef.current?.setData(middleData);
    lowerBBRef.current?.setData(lowerData);

    if (strikePrice && candleSeriesRef.current) {
      candleSeriesRef.current.createPriceLine({
        price: strikePrice,
        color: COLORS.strike,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: `Strike $${strikePrice}`,
      });
    }

    chartRef.current.timeScale().fitContent();
  }, [data, strikePrice]);

  const latestBB = data?.bbSeries?.[data.bbSeries.length - 1];
  const latestBar = data?.bars?.[data.bars.length - 1];
  const bbSignal = latestBB
    ? latestBB.percentB > 0.8
      ? { label: 'Near Upper Band', color: 'text-red-400' }
      : latestBB.percentB < 0.2
      ? { label: 'Near Lower Band', color: 'text-green-400' }
      : { label: 'Mid-Band Range', color: 'text-slate-400' }
    : null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-[700px] max-w-[95vw] bg-[#0d1117] border-l border-slate-700/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-[#0f1117]">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-amber-400" />
          <span className="font-bold text-white text-sm">{symbol}</span>
          <span className="text-slate-500 text-xs">· Bollinger Bands (20, 2)</span>
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

      {/* BB Signal strip */}
      {(latestBB || latestBar) && (
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
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
              <span className="text-slate-400 text-sm">Loading chart data…</span>
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
