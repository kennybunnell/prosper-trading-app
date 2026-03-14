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

export interface RSIBar {
  time: number;
  rsi: number;
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

/**
 * Calculate 14-period RSI for every bar in the series.
 * Uses Wilder's smoothing (EMA-based).
 */
function calcRSISeries(bars: OHLCVBar[], period = 14): RSIBar[] {
  if (bars.length < period + 1) return [];
  const result: RSIBar[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  // Seed the first average
  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: bars[period].time, rsi: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) });
  // Wilder smoothing for remaining bars
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ time: bars[i].time, rsi: parseFloat(rsi.toFixed(2)) });
  }
  return result;
}

interface CacheEntry {
  bars: OHLCVBar[];
  bbSeries: BBBar[];
  rsiSeries: RSIBar[];
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

function setCached(key: string, bars: OHLCVBar[], bbSeries: BBBar[], rsiSeries: RSIBar[]) {
  historyCache.set(key, { bars, bbSeries, rsiSeries, fetchedAt: Date.now() });
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
  '5Y': 1825,
};

async function fetchAndCacheBars(
  userId: number,
  symbol: string,
  timeframe: string
): Promise<{ bars: OHLCVBar[]; bbSeries: BBBar[]; rsiSeries: RSIBar[] }> {
  const cacheKey = `${userId}:${symbol}:${timeframe}`;
  const cached = getCached(cacheKey);
  if (cached) return { bars: cached.bars, bbSeries: cached.bbSeries, rsiSeries: cached.rsiSeries ?? [] };

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
    return { bars: [], bbSeries: [], rsiSeries: [] };
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
  const rsiSeries = calcRSISeries(allBars, 14);

  const cutoff = Math.floor(
    new Date(new Date().setDate(new Date().getDate() - LOOKBACK_DAYS[timeframe])).getTime() / 1000
  );
  const trimmedBars = allBars.filter(b => b.time >= cutoff);
  const trimmedBB = bbSeries.filter(b => b.time >= cutoff);
  const trimmedRSI = rsiSeries.filter(b => b.time >= cutoff);

  setCached(cacheKey, trimmedBars, trimmedBB, trimmedRSI);
  return { bars: trimmedBars, bbSeries: trimmedBB, rsiSeries: trimmedRSI };
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
      timeframe: z.enum(['1M', '3M', '6M', '1Y', '5Y']).default('3M'),
    }))
    .query(async ({ input, ctx }) => {
      const { bars, rsiSeries } = await fetchAndCacheBars(ctx.user.id, input.symbol, input.timeframe);
      return {
        symbol: input.symbol,
        timeframe: input.timeframe,
        bars,
        rsiSeries,
      };
    }),

  /**
   * FULL: Returns OHLCV bars + Bollinger Band overlay series.
   * Called after candles are already rendered — overlays BB without blocking first paint.
   */
  getHistory: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      timeframe: z.enum(['1M', '3M', '6M', '1Y', '5Y']).default('3M'),
    }))
    .query(async ({ input, ctx }) => {
      const { bars, bbSeries, rsiSeries } = await fetchAndCacheBars(ctx.user.id, input.symbol, input.timeframe);
      return {
        symbol: input.symbol,
        timeframe: input.timeframe,
        bars,
        bbSeries,
        rsiSeries,
      };
    }),
});
