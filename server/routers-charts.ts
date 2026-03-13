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

// ─── In-memory cache ────────────────────────────────────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  bars: OHLCVBar[];
  bbSeries: BBBar[];
  fetchedAt: number;
}

// Cache key: `${userId}:${symbol}:${timeframe}`
const historyCache = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | null {
  const entry = historyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    historyCache.delete(key);
    return null;
  }
  return entry;
}

function setCached(key: string, bars: OHLCVBar[], bbSeries: BBBar[]) {
  historyCache.set(key, { bars, bbSeries, fetchedAt: Date.now() });
}

// Map index option roots to their underlying ticker for price history
const SYMBOL_MAP: Record<string, string> = {
  SPXW: 'SPX',
  NDXP: 'NDX',
  MRUT: 'RUT',
  NDXPRIVA: 'NDX',
};

const LOOKBACK_DAYS: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

async function fetchAndCacheBars(
  userId: number,
  symbol: string,
  timeframe: string
): Promise<{ bars: OHLCVBar[]; bbSeries: BBBar[] }> {
  const cacheKey = `${userId}:${symbol}:${timeframe}`;
  const cached = getCached(cacheKey);
  if (cached) return { bars: cached.bars, bbSeries: cached.bbSeries };

  const { getApiCredentials } = await import('./db');
  const { createTradierAPI } = await import('./tradier');

  const credentials = await getApiCredentials(userId);
  if (!credentials?.tradierApiKey) {
    throw new Error('Tradier API key not configured. Please add it in Settings.');
  }

  const tradier = createTradierAPI(credentials.tradierApiKey, false);

  const end = new Date();
  const start = new Date();
  const bufferDays = 30; // extra bars for BB warm-up window
  start.setDate(start.getDate() - LOOKBACK_DAYS[timeframe] - bufferDays);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const historySymbol = SYMBOL_MAP[symbol.toUpperCase()] ?? symbol;

  const rawHistory = await tradier.getHistoricalData(
    historySymbol,
    'daily',
    fmt(start),
    fmt(end)
  );

  if (!rawHistory || rawHistory.length === 0) {
    return { bars: [], bbSeries: [] };
  }

  const allBars: OHLCVBar[] = rawHistory
    .map(d => ({
      time: Math.floor(new Date(d.date).getTime() / 1000),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }))
    .sort((a, b) => a.time - b.time);

  const bbSeries = calcBollingerSeries(allBars, 20, 2);

  const cutoff = Math.floor(
    new Date(new Date().setDate(new Date().getDate() - LOOKBACK_DAYS[timeframe])).getTime() / 1000
  );
  const trimmedBars = allBars.filter(b => b.time >= cutoff);
  const trimmedBB = bbSeries.filter(b => b.time >= cutoff);

  setCached(cacheKey, trimmedBars, trimmedBB);
  return { bars: trimmedBars, bbSeries: trimmedBB };
}

// ─── Router ──────────────────────────────────────────────────────────────────
export const chartsRouter = router({
  /**
   * FAST: Returns only OHLCV candlestick bars (no BB calculation overhead on client).
   * Used for the first render pass — shows price direction immediately.
   */
  getCandles: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      timeframe: z.enum(['1M', '3M', '6M', '1Y']).default('3M'),
    }))
    .query(async ({ input, ctx }) => {
      const { bars } = await fetchAndCacheBars(ctx.user.id, input.symbol, input.timeframe);
      return {
        symbol: input.symbol,
        timeframe: input.timeframe,
        bars,
      };
    }),

  /**
   * FULL: Returns OHLCV bars + Bollinger Band overlay series.
   * Called after candles are already rendered — overlays BB without blocking first paint.
   */
  getHistory: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      timeframe: z.enum(['1M', '3M', '6M', '1Y']).default('3M'),
    }))
    .query(async ({ input, ctx }) => {
      const { bars, bbSeries } = await fetchAndCacheBars(ctx.user.id, input.symbol, input.timeframe);
      return {
        symbol: input.symbol,
        timeframe: input.timeframe,
        bars,
        bbSeries,
      };
    }),
});
