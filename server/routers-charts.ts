/**
 * Charts router — provides server-side OHLC + indicator data for index symbols
 * that cannot be displayed via TradingView's free widget tier (CBOE/NASDAQ indexes).
 *
 * Uses Tradier /markets/history for OHLC bars, then calculates:
 *   - Bollinger Bands (20-period, 2σ)
 *   - RSI (14-period)
 *   - Volume
 *
 * For equities, the TradingView Advanced Chart widget is still used.
 */
import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import { TradierAPI } from './tradier';
import { getApiCredentials } from './db';

// Map from option root / display symbol → Tradier-quotable underlying
const INDEX_UNDERLYING_MAP: Record<string, string> = {
  SPXW:  'SPX',
  SPX:   'SPX',
  SPXPM: 'SPX',
  XSP:   'XSP',
  NDX:   'NDX',
  NDXP:  'NDX',
  XND:   'XND',
  RUT:   'RUT',
  MRUT:  'RUT',
  DJX:   'DJX',
  VIX:   'VIX',
  VIXW:  'VIX',
};

// ── Indicator helpers ────────────────────────────────────────────────────────

function calcSMA(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcBollingerBands(closes: number[], period = 20, mult = 2) {
  const sma = calcSMA(closes, period);
  return closes.map((_, i) => {
    if (sma[i] === null) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i]!;
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
  });
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ── Router ───────────────────────────────────────────────────────────────────

export const chartsRouter = router({
  /**
   * Fetch OHLC + indicator data for an index symbol via Tradier.
   * Returns candles with embedded Bollinger Bands and RSI values
   * ready for Lightweight Charts.
   */
  getIndexOHLC: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10).toUpperCase(),
      interval: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
      days: z.number().int().min(30).max(730).default(365),
    }))
    .query(async ({ input, ctx }) => {
      const upper = input.symbol.toUpperCase();
      const tradierSymbol = INDEX_UNDERLYING_MAP[upper];
      if (!tradierSymbol) {
        throw new Error(`${input.symbol} is not a supported index symbol`);
      }

      // Use the user's DB-stored Tradier key (same pattern as all other routers)
      const credentials = await getApiCredentials(ctx.user.id);
      const apiKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
      if (!apiKey) throw new Error('Tradier API key not configured — please add your key in Settings');

      const tradier = new TradierAPI(apiKey, false);

      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - input.days);

      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const history = await tradier.getHistoricalData(
        tradierSymbol,
        input.interval,
        fmt(start),
        fmt(end),
      );

      if (!history || history.length === 0) {
        return { symbol: upper, tradierSymbol, candles: [] };
      }

      // Sort ascending by date
      history.sort((a, b) => a.date.localeCompare(b.date));

      // Tradier returns OHLC values as strings in the raw JSON even though the
      // TypeScript interface declares them as numbers. Coerce explicitly so that
      // Lightweight Charts never receives a string and throws an assertion error.
      // Also coerce closes before passing to indicator helpers to avoid NaN math.
      const closes = history.map(d => Number(d.close));
      const bb = calcBollingerBands(closes);
      const rsi = calcRSI(closes);

      const candles = history
        .map((d, i) => ({
          time:   d.date,  // 'YYYY-MM-DD' — Lightweight Charts accepts this directly
          open:   Number(d.open),
          high:   Number(d.high),
          low:    Number(d.low),
          close:  Number(d.close),
          volume: Number(d.volume),
          bb: bb[i],
          rsi: rsi[i] !== null ? Math.round(rsi[i]! * 100) / 100 : null,
        }))
        // Drop any candle where a required OHLC field came back as NaN (bad API data)
        .filter(c => !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close));

      return { symbol: upper, tradierSymbol, candles };
    }),
});
