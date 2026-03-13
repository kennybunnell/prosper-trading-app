import { protectedProcedure, router } from './_core/trpc';
import { z } from 'zod';

export interface OHLCVBar {
  time: number;   // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BBBar {
  time: number;
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
}

/**
 * Calculate Bollinger Bands for every bar in the series (rolling window).
 * Returns one entry per bar once the window is full.
 */
function calcBollingerSeries(
  bars: OHLCVBar[],
  period = 20,
  stdDevMult = 2
): BBBar[] {
  const result: BBBar[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const window = bars.slice(i - period + 1, i + 1).map(b => b.close);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const upper = mean + stdDevMult * sd;
    const lower = mean - stdDevMult * sd;
    const percentB = sd === 0 ? 0.5 : (bars[i].close - lower) / (upper - lower);
    result.push({
      time: bars[i].time,
      upper: parseFloat(upper.toFixed(4)),
      middle: parseFloat(mean.toFixed(4)),
      lower: parseFloat(lower.toFixed(4)),
      percentB: parseFloat(percentB.toFixed(4)),
    });
  }
  return result;
}

export const chartsRouter = router({
  /**
   * Fetch OHLCV history + Bollinger Bands for a given symbol and lookback period.
   * timeframe: '1M' | '3M' | '6M' | '1Y'
   */
  getHistory: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      timeframe: z.enum(['1M', '3M', '6M', '1Y']).default('3M'),
    }))
    .query(async ({ input, ctx }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tradierApiKey) {
        throw new Error('Tradier API key not configured. Please add it in Settings.');
      }

      const tradier = createTradierAPI(
        credentials.tradierApiKey,
        false // always use live Tradier for price history
      );

      // Calculate date range
      const end = new Date();
      const start = new Date();
      const lookbackDays: Record<string, number> = {
        '1M': 30,
        '3M': 90,
        '6M': 180,
        '1Y': 365,
      };
      // Add extra buffer for BB calculation (need at least 20 bars before first visible bar)
      const bufferDays = 30;
      start.setDate(start.getDate() - lookbackDays[input.timeframe] - bufferDays);

      const fmt = (d: Date) => d.toISOString().split('T')[0];

      // Map index option roots to their underlying for price history
      const symbolMap: Record<string, string> = {
        SPXW: 'SPX',
        NDXP: 'NDX',
        MRUT: 'RUT',
      };
      const historySymbol = symbolMap[input.symbol.toUpperCase()] ?? input.symbol;

      const rawHistory = await tradier.getHistoricalData(
        historySymbol,
        'daily',
        fmt(start),
        fmt(end)
      );

      if (!rawHistory || rawHistory.length === 0) {
        return { bars: [], bbSeries: [], symbol: input.symbol, timeframe: input.timeframe };
      }

      // Convert to OHLCVBar format (time = Unix seconds for Lightweight Charts)
      const allBars: OHLCVBar[] = rawHistory.map(d => ({
        time: Math.floor(new Date(d.date).getTime() / 1000),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));

      // Sort ascending
      allBars.sort((a, b) => a.time - b.time);

      // Calculate full BB series (needs buffer bars for first window)
      const bbSeries = calcBollingerSeries(allBars, 20, 2);

      // Trim bars to the requested timeframe (drop the buffer prefix)
      const cutoff = Math.floor(
        new Date(new Date().setDate(new Date().getDate() - lookbackDays[input.timeframe])).getTime() / 1000
      );
      const bars = allBars.filter(b => b.time >= cutoff);
      const bbTrimmed = bbSeries.filter(b => b.time >= cutoff);

      return {
        symbol: input.symbol,
        timeframe: input.timeframe,
        bars,
        bbSeries: bbTrimmed,
      };
    }),
});
