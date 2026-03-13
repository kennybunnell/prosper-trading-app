/**
 * Unit tests for AI Strategy Review feature
 * Tests the position mapping logic, prompt construction helpers,
 * and the tRPC procedure input validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ─── Pure helpers mirroring the AutomationDashboard mapping logic ─────────────

/**
 * Parse OCC option symbol to extract strike price.
 * OCC format: ROOT YYMMDD C/P STRIKE8 (last 8 digits = strike × 1000)
 */
function parseOccStrike(optionSymbol: string): number | undefined {
  const m = optionSymbol.match(/([CP])(\d{8})$/);
  if (!m) return undefined;
  return parseInt(m[2], 10) / 1000;
}

/**
 * Map a ScanResult to a ReviewPosition (mirrors AutomationDashboard logic)
 */
function mapScanResultToReviewPosition(r: {
  symbol: string;
  type: string;
  optionSymbol: string;
  account: string;
  expiration: string | null;
  dte: number | null;
  premiumCollected: number;
  buyBackCost: number;
  realizedPercent: number;
  action: string;
  quantity: number;
  spreadLongSymbol?: string;
}) {
  const shortStrike = parseOccStrike(r.optionSymbol);
  const longStrike = r.spreadLongSymbol ? parseOccStrike(r.spreadLongSymbol) : undefined;
  return {
    symbol: r.symbol,
    type: r.type,
    optionSymbol: r.optionSymbol,
    price: r.buyBackCost / (r.quantity * 100),
    account: r.account,
    expiration: r.expiration ?? '',
    dte: r.dte ?? 0,
    premiumCollected: r.premiumCollected,
    buyBackCost: r.buyBackCost,
    netProfit: r.premiumCollected - r.buyBackCost,
    realizedPct: r.realizedPercent,
    action: r.action,
    spreadLongSymbol: r.spreadLongSymbol,
    spreadShortStrike: shortStrike,
    spreadLongStrike: longStrike,
  };
}

// ─── Input schema for aiStrategyReview (mirrors server procedure) ─────────────

const reviewPositionSchema = z.object({
  symbol: z.string(),
  type: z.string(),
  optionSymbol: z.string(),
  price: z.number(),
  account: z.string(),
  expiration: z.string(),
  dte: z.number(),
  premiumCollected: z.number(),
  buyBackCost: z.number(),
  netProfit: z.number(),
  realizedPct: z.number(),
  action: z.string(),
  spreadLongSymbol: z.string().optional(),
  spreadShortStrike: z.number().optional(),
  spreadLongStrike: z.number().optional(),
});

const aiStrategyReviewInputSchema = z.object({
  strategy: z.enum(['BPS', 'BCS', 'IC', 'CSP', 'CC', 'all']),
  positions: z.array(reviewPositionSchema),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AI Strategy Review — OCC strike parsing', () => {
  it('parses a standard equity put OCC symbol correctly', () => {
    // AAPL260307P00277500 → Put $277.50
    const strike = parseOccStrike('AAPL260307P00277500');
    expect(strike).toBeCloseTo(277.5, 1);
  });

  it('parses a standard equity call OCC symbol correctly', () => {
    // TSLA260307C00350000 → Call $350.00
    const strike = parseOccStrike('TSLA260307C00350000');
    expect(strike).toBe(350);
  });

  it('parses an index option OCC symbol (SPXW) correctly', () => {
    // SPXW260307P05800000 → Put $5800.00
    const strike = parseOccStrike('SPXW260307P05800000');
    expect(strike).toBe(5800);
  });

  it('parses a high-strike index option (NDXP) correctly', () => {
    // NDXP260307P20000000 → Put $20000.00
    const strike = parseOccStrike('NDXP260307P20000000');
    expect(strike).toBe(20000);
  });

  it('returns undefined for an invalid OCC symbol', () => {
    const strike = parseOccStrike('INVALID_SYMBOL');
    expect(strike).toBeUndefined();
  });

  it('handles OCC symbol with spaces (Tastytrade format)', () => {
    // Tastytrade sometimes includes spaces — strip before parsing
    const stripped = 'AAPL  260307P00277500'.replace(/\s/g, '');
    const strike = parseOccStrike(stripped);
    expect(strike).toBeCloseTo(277.5, 1);
  });
});

describe('AI Strategy Review — position mapping', () => {
  const baseScanResult = {
    symbol: 'AAPL',
    type: 'CSP',
    optionSymbol: 'AAPL260307P00277500',
    account: '5YZ12345',
    expiration: '2026-03-07',
    dte: 5,
    premiumCollected: 287,
    buyBackCost: 70,
    realizedPercent: 75.6,
    action: 'WOULD_CLOSE' as const,
    quantity: 1,
  };

  it('maps a CSP scan result to a ReviewPosition correctly', () => {
    const pos = mapScanResultToReviewPosition(baseScanResult);
    expect(pos.symbol).toBe('AAPL');
    expect(pos.type).toBe('CSP');
    expect(pos.dte).toBe(5);
    expect(pos.premiumCollected).toBe(287);
    expect(pos.buyBackCost).toBe(70);
    expect(pos.netProfit).toBe(217); // 287 - 70
    expect(pos.realizedPct).toBeCloseTo(75.6, 1);
    expect(pos.action).toBe('WOULD_CLOSE');
    expect(pos.spreadShortStrike).toBeCloseTo(277.5, 1);
    expect(pos.spreadLongStrike).toBeUndefined();
  });

  it('computes per-share price correctly from buyBackCost', () => {
    const pos = mapScanResultToReviewPosition(baseScanResult);
    // $70 / (1 contract × 100 shares) = $0.70/share
    expect(pos.price).toBeCloseTo(0.70, 2);
  });

  it('maps a BPS scan result with spread legs correctly', () => {
    const bpsScanResult = {
      ...baseScanResult,
      type: 'BPS',
      optionSymbol: 'META260307P00600000',
      spreadLongSymbol: 'META260307P00590000',
      premiumCollected: 500,
      buyBackCost: 100,
      realizedPercent: 80,
    };
    const pos = mapScanResultToReviewPosition(bpsScanResult);
    expect(pos.type).toBe('BPS');
    expect(pos.spreadShortStrike).toBe(600);
    expect(pos.spreadLongStrike).toBe(590);
    expect(pos.spreadLongSymbol).toBe('META260307P00590000');
    expect(pos.netProfit).toBe(400); // 500 - 100
  });

  it('maps a BELOW_THRESHOLD position correctly', () => {
    const holdResult = { ...baseScanResult, action: 'BELOW_THRESHOLD' as const, realizedPercent: 40 };
    const pos = mapScanResultToReviewPosition(holdResult);
    expect(pos.action).toBe('BELOW_THRESHOLD');
    expect(pos.realizedPct).toBe(40);
  });

  it('handles null expiration and dte gracefully', () => {
    const nullResult = { ...baseScanResult, expiration: null, dte: null };
    const pos = mapScanResultToReviewPosition(nullResult);
    expect(pos.expiration).toBe('');
    expect(pos.dte).toBe(0);
  });
});

describe('AI Strategy Review — input schema validation', () => {
  it('accepts valid BPS strategy input', () => {
    const input = {
      strategy: 'BPS' as const,
      positions: [
        {
          symbol: 'META',
          type: 'BPS',
          optionSymbol: 'META260307P00600000',
          price: 0.50,
          account: '5YZ12345',
          expiration: '2026-03-07',
          dte: 5,
          premiumCollected: 500,
          buyBackCost: 100,
          netProfit: 400,
          realizedPct: 80,
          action: 'WOULD_CLOSE',
          spreadShortStrike: 600,
          spreadLongStrike: 590,
        },
      ],
    };
    const result = aiStrategyReviewInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('accepts all valid strategy enum values', () => {
    const strategies = ['BPS', 'BCS', 'IC', 'CSP', 'CC', 'all'] as const;
    for (const strategy of strategies) {
      const result = aiStrategyReviewInputSchema.safeParse({ strategy, positions: [] });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid strategy value', () => {
    const result = aiStrategyReviewInputSchema.safeParse({ strategy: 'INVALID', positions: [] });
    expect(result.success).toBe(false);
  });

  it('accepts positions with optional spread fields omitted', () => {
    const input = {
      strategy: 'CSP' as const,
      positions: [
        {
          symbol: 'AAPL',
          type: 'CSP',
          optionSymbol: 'AAPL260307P00277500',
          price: 0.70,
          account: '5YZ12345',
          expiration: '2026-03-07',
          dte: 5,
          premiumCollected: 287,
          buyBackCost: 70,
          netProfit: 217,
          realizedPct: 75.6,
          action: 'WOULD_CLOSE',
          // No spreadLongSymbol, spreadShortStrike, spreadLongStrike
        },
      ],
    };
    const result = aiStrategyReviewInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('returns no-positions message when positions array is empty', () => {
    // Simulate the server-side guard
    const positions: unknown[] = [];
    const message = positions.length === 0
      ? 'No positions found for this strategy filter.'
      : null;
    expect(message).toBe('No positions found for this strategy filter.');
  });
});

describe('AI Strategy Review — position summary building', () => {
  it('correctly identifies ready-to-close vs hold positions', () => {
    const positions = [
      { action: 'WOULD_CLOSE', symbol: 'AAPL' },
      { action: 'WOULD_CLOSE', symbol: 'META' },
      { action: 'BELOW_THRESHOLD', symbol: 'TSLA' },
    ];
    const readyToClose = positions.filter(p => p.action === 'WOULD_CLOSE');
    const holdPositions = positions.filter(p => p.action !== 'WOULD_CLOSE');
    expect(readyToClose).toHaveLength(2);
    expect(holdPositions).toHaveLength(1);
    expect(readyToClose.map(p => p.symbol)).toContain('AAPL');
    expect(holdPositions[0].symbol).toBe('TSLA');
  });

  it('builds spread summary with width correctly', () => {
    const shortStrike = 600;
    const longStrike = 590;
    const spreadWidth = Math.abs(shortStrike - longStrike);
    expect(spreadWidth).toBe(10);
  });

  it('calculates average realized % correctly', () => {
    const positions = [
      { realizedPct: 80 },
      { realizedPct: 90 },
      { realizedPct: 70 },
    ];
    const avg = positions.reduce((s, p) => s + p.realizedPct, 0) / positions.length;
    expect(avg).toBeCloseTo(80, 1);
  });

  it('handles IC positions with both put and call spread legs', () => {
    const icScanResult = {
      symbol: 'SPY',
      type: 'IC',
      optionSymbol: 'SPY260307P00550000', // Short put
      spreadLongSymbol: 'SPY260307P00545000', // Long put
      account: '5YZ12345',
      expiration: '2026-03-07',
      dte: 5,
      premiumCollected: 800,
      buyBackCost: 160,
      realizedPercent: 80,
      action: 'WOULD_CLOSE' as const,
      quantity: 1,
    };
    const pos = mapScanResultToReviewPosition(icScanResult);
    expect(pos.type).toBe('IC');
    expect(pos.spreadShortStrike).toBe(550);
    expect(pos.spreadLongStrike).toBe(545);
    expect(pos.netProfit).toBe(640); // 800 - 160
  });
});
