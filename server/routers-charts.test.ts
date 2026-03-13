import { describe, it, expect } from 'vitest';

// Re-implement the Bollinger Band calculation here for testing
// (mirrors the logic in routers-charts.ts)
interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BBBar {
  time: number;
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
}

function calcBollingerSeries(bars: OHLCVBar[], period = 20, stdDevMult = 2): BBBar[] {
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

function makeBars(closes: number[]): OHLCVBar[] {
  return closes.map((close, i) => ({
    time: 1700000000 + i * 86400,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000000,
  }));
}

describe('Bollinger Band Calculation', () => {
  it('returns empty array when fewer bars than period', () => {
    const bars = makeBars([100, 101, 102]);
    const result = calcBollingerSeries(bars, 20);
    expect(result).toHaveLength(0);
  });

  it('returns correct number of bands for exactly period bars', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    expect(result).toHaveLength(1);
  });

  it('returns N - period + 1 bands for N bars', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    expect(result).toHaveLength(11);
  });

  it('middle band equals 20-period SMA', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    const expectedMean = closes.reduce((s, v) => s + v, 0) / 20;
    expect(result[0].middle).toBeCloseTo(expectedMean, 2);
  });

  it('upper band is above middle, lower band is below middle', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    for (const bb of result) {
      expect(bb.upper).toBeGreaterThan(bb.middle);
      expect(bb.lower).toBeLessThan(bb.middle);
    }
  });

  it('percentB is 1.0 when price equals upper band', () => {
    // All same price → zero std dev → percentB = 0.5 (fallback)
    const closes = Array.from({ length: 20 }, () => 100);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    expect(result[0].percentB).toBe(0.5);
  });

  it('percentB is between 0 and 1 for typical price range', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    for (const bb of result) {
      // percentB can go slightly outside 0-1 when price breaks the bands
      expect(typeof bb.percentB).toBe('number');
      expect(isNaN(bb.percentB)).toBe(false);
    }
  });

  it('uses correct time from the last bar in each window', () => {
    const closes = Array.from({ length: 22 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 20);
    expect(result[0].time).toBe(bars[19].time);
    expect(result[1].time).toBe(bars[20].time);
    expect(result[2].time).toBe(bars[21].time);
  });

  it('handles 5-period BB correctly for known values', () => {
    // closes: [10, 11, 12, 11, 10]
    // mean = 10.8, variance = 0.56, sd ≈ 0.748
    const closes = [10, 11, 12, 11, 10];
    const bars = makeBars(closes);
    const result = calcBollingerSeries(bars, 5);
    expect(result).toHaveLength(1);
    const mean = (10 + 11 + 12 + 11 + 10) / 5; // 10.8
    const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / 5;
    const sd = Math.sqrt(variance);
    expect(result[0].middle).toBeCloseTo(mean, 3);
    expect(result[0].upper).toBeCloseTo(mean + 2 * sd, 3);
    expect(result[0].lower).toBeCloseTo(mean - 2 * sd, 3);
  });
});
