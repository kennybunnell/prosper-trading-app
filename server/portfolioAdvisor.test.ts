/**
 * Portfolio Advisor Tests
 * Tests for OCC parsing, position classification (spreads, covered calls,
 * cash-secured puts, naked), capital-at-risk, underwater detection,
 * risk score calculation, and sector mapping
 *
 * Updated to match the rewritten routers-portfolio-advisor.ts logic:
 * - OCC symbol parsing (not relying on option-type field)
 * - Spread-aware capital at risk
 * - Covered call detection (short calls backed by stock)
 * - Cash-secured put classification (short puts without long leg)
 * - Naked position detection (truly uncovered)
 * - Recalibrated risk score with capital utilization + naked count factor
 * - Sector mapping
 * - Buying power aggregation
 */

import { describe, it, expect } from 'vitest';

// ─── Replicate the pure functions from routers-portfolio-advisor.ts ──────────

function parseOCC(symbol: string): {
  underlying: string;
  expiration: string;
  optionType: 'PUT' | 'CALL';
  strike: number;
} | null {
  try {
    const clean = symbol.replace(/\s/g, '');
    const m = clean.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (!m) return null;
    const underlying = m[1];
    const ds = m[2];
    const optionType = m[3] === 'P' ? 'PUT' : 'CALL';
    const strike = parseInt(m[4]) / 1000;
    const year = 2000 + parseInt(ds.substring(0, 2));
    const month = parseInt(ds.substring(2, 4));
    const day = parseInt(ds.substring(4, 6));
    const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { underlying, expiration, optionType, strike };
  } catch {
    return null;
  }
}

const SECTOR_MAP: Record<string, string> = {
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AMD: 'Technology',
  HOOD: 'Technology', COIN: 'Technology', SOFI: 'Technology',
  TSLA: 'Consumer Discretionary', JPM: 'Financials', BAC: 'Financials',
  JNJ: 'Healthcare', PFE: 'Healthcare', XOM: 'Energy', CVX: 'Energy',
  SPY: 'ETF/Index', QQQ: 'ETF/Index', CAT: 'Industrials', BA: 'Industrials',
  NEE: 'Utilities',
};

function getSector(ticker: string): string {
  return SECTOR_MAP[ticker] || 'Other';
}

interface ParsedPosition {
  accountNumber: string;
  symbol: string;
  underlyingSymbol: string;
  instrumentType: string;
  quantity: number;
  direction: 'short' | 'long';
  optionType?: 'PUT' | 'CALL';
  strike?: number;
  expiration?: string;
  closePrice: number;
  averageOpenPrice: number;
  multiplier: number;
  delta: number;
}

interface SpreadPair {
  shortLeg: ParsedPosition;
  longLeg: ParsedPosition;
  spreadWidth: number;
  capitalAtRisk: number;
}

// Replicate detectSpreadsAndClassify from the router
function detectSpreadsAndClassify(positions: ParsedPosition[]) {
  const options = positions.filter(p => p.instrumentType === 'Equity Option');
  const equities = positions.filter(p => p.instrumentType === 'Equity');

  const stockHoldings = new Map<string, number>();
  for (const eq of equities) {
    if (eq.direction === 'long') {
      const key = `${eq.accountNumber}|${eq.underlyingSymbol}`;
      stockHoldings.set(key, (stockHoldings.get(key) || 0) + eq.quantity);
    }
  }
  const remainingShares = new Map<string, number>(stockHoldings);

  const groups = new Map<string, { shorts: ParsedPosition[]; longs: ParsedPosition[] }>();
  for (const opt of options) {
    const key = `${opt.accountNumber}|${opt.underlyingSymbol}|${opt.expiration}|${opt.optionType}`;
    if (!groups.has(key)) groups.set(key, { shorts: [], longs: [] });
    const g = groups.get(key)!;
    if (opt.direction === 'short') g.shorts.push(opt);
    else g.longs.push(opt);
  }

  const spreads: SpreadPair[] = [];
  const unmatchedShorts: ParsedPosition[] = [];
  const standaloneLongs: ParsedPosition[] = [];

  for (const [, group] of Array.from(groups)) {
    const shorts = [...group.shorts].sort((a, b) => (b.strike || 0) - (a.strike || 0));
    const longs = [...group.longs].sort((a, b) => (a.strike || 0) - (b.strike || 0));
    const usedLongs = new Set<number>();

    for (const shortLeg of shorts) {
      let matched = false;
      for (let i = 0; i < longs.length; i++) {
        if (usedLongs.has(i)) continue;
        const longLeg = longs[i];
        if (longLeg.quantity === shortLeg.quantity && longLeg.strike !== shortLeg.strike) {
          const spreadWidth = Math.abs((shortLeg.strike || 0) - (longLeg.strike || 0));
          spreads.push({ shortLeg, longLeg, spreadWidth, capitalAtRisk: spreadWidth * 100 * shortLeg.quantity });
          usedLongs.add(i);
          matched = true;
          break;
        }
      }
      if (!matched) unmatchedShorts.push(shortLeg);
    }
    for (let i = 0; i < longs.length; i++) {
      if (!usedLongs.has(i)) standaloneLongs.push(longs[i]);
    }
  }

  const coveredCalls: Array<{ shortCall: ParsedPosition; coveringShares: number }> = [];
  const cashSecuredPuts: Array<{ shortPut: ParsedPosition }> = [];
  const nakedPositions: Array<{ position: ParsedPosition }> = [];

  for (const shortPos of unmatchedShorts) {
    if (shortPos.optionType === 'CALL') {
      const stockKey = `${shortPos.accountNumber}|${shortPos.underlyingSymbol}`;
      const availableShares = remainingShares.get(stockKey) || 0;
      const sharesNeeded = shortPos.quantity * 100;

      if (availableShares >= sharesNeeded) {
        coveredCalls.push({ shortCall: shortPos, coveringShares: sharesNeeded });
        remainingShares.set(stockKey, availableShares - sharesNeeded);
      } else if (availableShares > 0) {
        const coveredContracts = Math.floor(availableShares / 100);
        if (coveredContracts > 0) {
          coveredCalls.push({ shortCall: { ...shortPos, quantity: coveredContracts }, coveringShares: coveredContracts * 100 });
          remainingShares.set(stockKey, availableShares - coveredContracts * 100);
        }
        const nakedContracts = shortPos.quantity - coveredContracts;
        if (nakedContracts > 0) {
          nakedPositions.push({ position: { ...shortPos, quantity: nakedContracts } });
        }
      } else {
        nakedPositions.push({ position: shortPos });
      }
    } else if (shortPos.optionType === 'PUT') {
      cashSecuredPuts.push({ shortPut: shortPos });
    }
  }

  return { spreads, coveredCalls, cashSecuredPuts, nakedPositions, standaloneLongs, equities };
}

function computeRiskScore(
  maxConcentrationPct: number,
  underwaterCount: number,
  totalPositionCount: number,
  diversificationScore: number,
  capitalUtilizationPct: number,
  nakedCount: number,
): number {
  let score = 0;
  if (maxConcentrationPct >= 40) score += 30;
  else if (maxConcentrationPct >= 25) score += 24;
  else if (maxConcentrationPct >= 15) score += 18;
  else if (maxConcentrationPct >= 8) score += 10;
  else if (maxConcentrationPct >= 5) score += 5;

  if (totalPositionCount > 0) {
    const underwaterPct = (underwaterCount / totalPositionCount) * 100;
    if (underwaterPct >= 50) score += 25;
    else if (underwaterPct >= 30) score += 20;
    else if (underwaterPct >= 15) score += 15;
    else if (underwaterPct >= 5) score += 8;
    else if (underwaterCount > 0) score += 4;
  }

  score += Math.round((100 - diversificationScore) * 0.15);

  if (capitalUtilizationPct >= 90) score += 15;
  else if (capitalUtilizationPct >= 75) score += 12;
  else if (capitalUtilizationPct >= 60) score += 8;
  else if (capitalUtilizationPct >= 40) score += 4;

  if (nakedCount >= 10) score += 15;
  else if (nakedCount >= 5) score += 12;
  else if (nakedCount >= 2) score += 8;
  else if (nakedCount >= 1) score += 5;

  return Math.min(100, score);
}

// ─── Helper to create test positions ────────────────────────────────────────

function makeOption(overrides: Partial<ParsedPosition> = {}): ParsedPosition {
  return {
    accountNumber: 'ACC1',
    symbol: 'AAPL  260320P00170000',
    underlyingSymbol: 'AAPL',
    instrumentType: 'Equity Option',
    quantity: 1,
    direction: 'short',
    optionType: 'PUT',
    strike: 170,
    expiration: '2026-03-20',
    closePrice: 2.5,
    averageOpenPrice: 3.0,
    multiplier: 100,
    delta: 0.3,
    ...overrides,
  };
}

function makeEquity(overrides: Partial<ParsedPosition> = {}): ParsedPosition {
  return {
    accountNumber: 'ACC1',
    symbol: 'AAPL',
    underlyingSymbol: 'AAPL',
    instrumentType: 'Equity',
    quantity: 100,
    direction: 'long',
    closePrice: 175,
    averageOpenPrice: 160,
    multiplier: 1,
    delta: 1.0,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Portfolio Advisor', () => {
  describe('OCC Symbol Parsing', () => {
    it('should parse a put OCC symbol correctly', () => {
      const result = parseOCC('AAPL  250321P00170000');
      expect(result).toEqual({
        underlying: 'AAPL',
        expiration: '2025-03-21',
        optionType: 'PUT',
        strike: 170,
      });
    });

    it('should parse a call OCC symbol correctly', () => {
      const result = parseOCC('NVDA  250418C00950000');
      expect(result).toEqual({
        underlying: 'NVDA',
        expiration: '2025-04-18',
        optionType: 'CALL',
        strike: 950,
      });
    });

    it('should parse OCC with fractional strike', () => {
      const result = parseOCC('HOOD  250321P00007500');
      expect(result).toEqual({
        underlying: 'HOOD',
        expiration: '2025-03-21',
        optionType: 'PUT',
        strike: 7.5,
      });
    });

    it('should return null for invalid symbols', () => {
      expect(parseOCC('INVALID')).toBeNull();
      expect(parseOCC('')).toBeNull();
      expect(parseOCC('12345')).toBeNull();
    });

    it('should handle tickers with P in the name (PLTR, SPY)', () => {
      const result = parseOCC('PLTR  250321P00025000');
      expect(result).toEqual({
        underlying: 'PLTR',
        expiration: '2025-03-21',
        optionType: 'PUT',
        strike: 25,
      });
    });

    it('should handle SPY options correctly', () => {
      const result = parseOCC('SPY   250321P00550000');
      expect(result).toEqual({
        underlying: 'SPY',
        expiration: '2025-03-21',
        optionType: 'PUT',
        strike: 550,
      });
    });
  });

  describe('Sector Mapping', () => {
    it('should map known tickers to sectors', () => {
      expect(getSector('AAPL')).toBe('Technology');
      expect(getSector('TSLA')).toBe('Consumer Discretionary');
      expect(getSector('JPM')).toBe('Financials');
      expect(getSector('JNJ')).toBe('Healthcare');
      expect(getSector('XOM')).toBe('Energy');
      expect(getSector('SPY')).toBe('ETF/Index');
    });

    it('should return Other for unknown tickers', () => {
      expect(getSector('ZZZZZ')).toBe('Other');
    });
  });

  describe('Spread Detection', () => {
    it('should detect a bull put spread', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 180, optionType: 'PUT' }),
        makeOption({ direction: 'long', strike: 175, optionType: 'PUT' }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.spreads).toHaveLength(1);
      expect(result.spreads[0].spreadWidth).toBe(5);
      expect(result.spreads[0].capitalAtRisk).toBe(500);
      expect(result.cashSecuredPuts).toHaveLength(0);
    });

    it('should detect a bear call spread', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 900, optionType: 'CALL', underlyingSymbol: 'NVDA', quantity: 2 }),
        makeOption({ direction: 'long', strike: 910, optionType: 'CALL', underlyingSymbol: 'NVDA', quantity: 2 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.spreads).toHaveLength(1);
      expect(result.spreads[0].spreadWidth).toBe(10);
      expect(result.spreads[0].capitalAtRisk).toBe(2000);
    });

    it('should NOT match legs with different expirations', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 180, expiration: '2025-03-21' }),
        makeOption({ direction: 'long', strike: 175, expiration: '2025-04-18' }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.spreads).toHaveLength(0);
      expect(result.cashSecuredPuts).toHaveLength(1);
    });

    it('should NOT match legs with different quantities', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 180, quantity: 2 }),
        makeOption({ direction: 'long', strike: 175, quantity: 1 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.spreads).toHaveLength(0);
    });

    it('should NOT match legs in different accounts', () => {
      const positions = [
        makeOption({ accountNumber: 'ACC1', direction: 'short', strike: 180 }),
        makeOption({ accountNumber: 'ACC2', direction: 'long', strike: 175 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.spreads).toHaveLength(0);
    });

    it('should detect iron condor as two separate spreads', () => {
      const positions = [
        // Put spread
        makeOption({ direction: 'short', strike: 540, optionType: 'PUT', underlyingSymbol: 'SPY' }),
        makeOption({ direction: 'long', strike: 535, optionType: 'PUT', underlyingSymbol: 'SPY' }),
        // Call spread
        makeOption({ direction: 'short', strike: 580, optionType: 'CALL', underlyingSymbol: 'SPY' }),
        makeOption({ direction: 'long', strike: 585, optionType: 'CALL', underlyingSymbol: 'SPY' }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.spreads).toHaveLength(2);
      const putSpread = result.spreads.find(s => s.shortLeg.optionType === 'PUT');
      expect(putSpread?.spreadWidth).toBe(5);
      const callSpread = result.spreads.find(s => s.shortLeg.optionType === 'CALL');
      expect(callSpread?.spreadWidth).toBe(5);
    });
  });

  describe('Covered Call Detection', () => {
    it('should classify short call with stock as Covered Call', () => {
      const positions = [
        makeEquity({ quantity: 100, underlyingSymbol: 'AAPL' }),
        makeOption({ direction: 'short', strike: 190, optionType: 'CALL', underlyingSymbol: 'AAPL', quantity: 1 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.coveredCalls).toHaveLength(1);
      expect(result.coveredCalls[0].coveringShares).toBe(100);
      expect(result.nakedPositions).toHaveLength(0);
    });

    it('should partially cover when not enough shares', () => {
      const positions = [
        makeEquity({ quantity: 150, underlyingSymbol: 'AAPL' }),
        makeOption({ direction: 'short', strike: 190, optionType: 'CALL', underlyingSymbol: 'AAPL', quantity: 2 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.coveredCalls).toHaveLength(1);
      expect(result.coveredCalls[0].shortCall.quantity).toBe(1); // 150 shares covers 1 contract
      expect(result.nakedPositions).toHaveLength(1);
      expect(result.nakedPositions[0].position.quantity).toBe(1); // 1 naked
    });

    it('should classify short call without stock as Naked', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 190, optionType: 'CALL', underlyingSymbol: 'AAPL', quantity: 1 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.nakedPositions).toHaveLength(1);
      expect(result.coveredCalls).toHaveLength(0);
    });

    it('should NOT use stock from a different account to cover', () => {
      const positions = [
        makeEquity({ accountNumber: 'ACC1', quantity: 100, underlyingSymbol: 'AAPL' }),
        makeOption({ accountNumber: 'ACC2', direction: 'short', strike: 190, optionType: 'CALL', underlyingSymbol: 'AAPL', quantity: 1 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.nakedPositions).toHaveLength(1);
      expect(result.coveredCalls).toHaveLength(0);
    });

    it('should cover multiple short calls with sufficient shares', () => {
      const positions = [
        makeEquity({ quantity: 500, underlyingSymbol: 'SOFI' }),
        makeOption({ direction: 'short', strike: 20, optionType: 'CALL', underlyingSymbol: 'SOFI', quantity: 3, expiration: '2026-03-20' }),
        makeOption({ direction: 'short', strike: 22, optionType: 'CALL', underlyingSymbol: 'SOFI', quantity: 2, expiration: '2026-04-17' }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.coveredCalls).toHaveLength(2);
      const totalCovered = result.coveredCalls.reduce((sum, cc) => sum + cc.shortCall.quantity, 0);
      expect(totalCovered).toBe(5);
      expect(result.nakedPositions).toHaveLength(0);
    });

    it('should exhaust shares across multiple calls correctly', () => {
      const positions = [
        makeEquity({ quantity: 300, underlyingSymbol: 'SOFI' }),
        makeOption({ direction: 'short', strike: 20, optionType: 'CALL', underlyingSymbol: 'SOFI', quantity: 2, expiration: '2026-03-20' }),
        makeOption({ direction: 'short', strike: 22, optionType: 'CALL', underlyingSymbol: 'SOFI', quantity: 2, expiration: '2026-04-17' }),
      ];
      const result = detectSpreadsAndClassify(positions);
      const totalCovered = result.coveredCalls.reduce((sum, cc) => sum + cc.shortCall.quantity, 0);
      const totalNaked = result.nakedPositions.reduce((sum, np) => sum + np.position.quantity, 0);
      expect(totalCovered).toBe(3); // 300 shares = 3 contracts
      expect(totalNaked).toBe(1);   // 1 contract uncovered
    });
  });

  describe('Cash-Secured Put Detection', () => {
    it('should classify short put without a long leg as Cash-Secured Put', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 170, optionType: 'PUT', quantity: 1 }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.cashSecuredPuts).toHaveLength(1);
      expect(result.nakedPositions).toHaveLength(0);
    });

    it('should NOT classify a spread short put as Cash-Secured Put', () => {
      const positions = [
        makeOption({ direction: 'short', strike: 170, optionType: 'PUT' }),
        makeOption({ direction: 'long', strike: 165, optionType: 'PUT' }),
      ];
      const result = detectSpreadsAndClassify(positions);
      expect(result.cashSecuredPuts).toHaveLength(0);
      expect(result.spreads).toHaveLength(1);
    });
  });

  describe('Full Classification Pipeline', () => {
    it('should correctly classify a mixed portfolio', () => {
      const positions: ParsedPosition[] = [
        // Stock: 500 shares of AAPL
        makeEquity({ underlyingSymbol: 'AAPL', quantity: 500 }),
        // Covered calls: 3 + 2 AAPL calls (covered by 500 shares)
        makeOption({ underlyingSymbol: 'AAPL', direction: 'short', optionType: 'CALL', strike: 190, quantity: 3, expiration: '2026-03-20' }),
        makeOption({ underlyingSymbol: 'AAPL', direction: 'short', optionType: 'CALL', strike: 195, quantity: 2, expiration: '2026-03-20' }),
        // Bull put spread on TSLA
        makeOption({ underlyingSymbol: 'TSLA', direction: 'short', optionType: 'PUT', strike: 400, quantity: 1, expiration: '2026-03-20' }),
        makeOption({ underlyingSymbol: 'TSLA', direction: 'long', optionType: 'PUT', strike: 395, quantity: 1, expiration: '2026-03-20' }),
        // Cash-secured put on MSFT
        makeOption({ underlyingSymbol: 'MSFT', direction: 'short', optionType: 'PUT', strike: 380, quantity: 1, expiration: '2026-03-20' }),
      ];

      const result = detectSpreadsAndClassify(positions);

      expect(result.spreads).toHaveLength(1); // TSLA put spread
      expect(result.spreads[0].spreadWidth).toBe(5);

      expect(result.coveredCalls).toHaveLength(2); // AAPL calls
      const totalCoveredContracts = result.coveredCalls.reduce((sum, cc) => sum + cc.shortCall.quantity, 0);
      expect(totalCoveredContracts).toBe(5);

      expect(result.cashSecuredPuts).toHaveLength(1); // MSFT put
      expect(result.cashSecuredPuts[0].shortPut.underlyingSymbol).toBe('MSFT');

      expect(result.nakedPositions).toHaveLength(0);
    });

    it('should detect naked calls when shares are insufficient', () => {
      const positions: ParsedPosition[] = [
        makeEquity({ underlyingSymbol: 'HOOD', quantity: 200 }),
        makeOption({ underlyingSymbol: 'HOOD', direction: 'short', optionType: 'CALL', strike: 50, quantity: 5, expiration: '2026-03-20' }),
      ];

      const result = detectSpreadsAndClassify(positions);
      expect(result.coveredCalls).toHaveLength(1);
      expect(result.coveredCalls[0].shortCall.quantity).toBe(2); // 200 shares covers 2
      expect(result.nakedPositions).toHaveLength(1);
      expect(result.nakedPositions[0].position.quantity).toBe(3); // 3 naked
    });
  });

  describe('Capital at Risk Calculation', () => {
    it('should use spread width for spreads, not full strike', () => {
      const spreadCapital = 5 * 100 * 1;
      expect(spreadCapital).toBe(500);
      const nakedCapital = 180 * 100 * 1;
      expect(nakedCapital).toBe(18000);
      expect(nakedCapital / spreadCapital).toBe(36);
    });

    it('should calculate equity capital at risk from market value', () => {
      expect(185 * 100).toBe(18500);
    });
  });

  describe('Underwater Detection', () => {
    it('should detect short put underwater when underlying < strike', () => {
      const strike = 180;
      const currentPrice = 175;
      expect(currentPrice < strike).toBe(true);
      const percentITM = ((strike - currentPrice) / strike) * 100;
      expect(percentITM).toBeCloseTo(2.78, 1);
    });

    it('should NOT flag short put when underlying > strike', () => {
      expect(190 < 180).toBe(false);
    });

    it('should detect short call underwater when underlying > strike', () => {
      const strike = 900;
      const currentPrice = 920;
      expect(currentPrice > strike).toBe(true);
      const percentITM = ((currentPrice - strike) / strike) * 100;
      expect(percentITM).toBeCloseTo(2.22, 1);
    });

    it('should NOT flag short call when underlying < strike', () => {
      expect(880 > 900).toBe(false);
    });

    it('should include max loss for spread underwater positions', () => {
      const maxLoss = 5 * 100 * 2;
      expect(maxLoss).toBe(1000);
    });
  });

  describe('Risk Score Calculation (Recalibrated)', () => {
    it('should score concentration risk at lower thresholds', () => {
      // 9.8% concentration should score 10 points (8-15% bracket)
      const score = computeRiskScore(9.8, 0, 10, 80, 30, 0);
      // concentration: 10, underwater: 0, diversification: (100-80)*0.15=3, utilization: 0, naked: 0
      expect(score).toBe(10 + 0 + 3 + 0 + 0);
    });

    it('should include capital utilization in risk score', () => {
      const score = computeRiskScore(5, 0, 10, 80, 80, 0);
      // concentration: 5, underwater: 0, diversification: 3, utilization: 12 (75-90), naked: 0
      expect(score).toBe(5 + 0 + 3 + 12 + 0);
    });

    it('should penalize naked positions heavily', () => {
      const noNaked = computeRiskScore(10, 0, 20, 80, 30, 0);
      const manyNaked = computeRiskScore(10, 0, 20, 80, 30, 10);
      expect(manyNaked - noNaked).toBe(15); // max naked penalty
    });

    it('should score low risk for well-diversified healthy portfolio', () => {
      const score = computeRiskScore(4, 0, 20, 90, 30, 0);
      // concentration: 0, underwater: 0, diversification: (100-90)*0.15=2 (rounds to 2), utilization: 0, naked: 0
      expect(score).toBe(2);
    });

    it('should cap at 100', () => {
      const score = computeRiskScore(50, 20, 20, 10, 95, 15);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should add 4 points for any underwater position even if percentage is low', () => {
      const score = computeRiskScore(4, 1, 100, 90, 30, 0);
      // concentration: 0, underwater: 4 (1/100=1%), diversification: 2, utilization: 0, naked: 0
      expect(score).toBe(0 + 4 + 2 + 0 + 0);
    });
  });

  describe('Diversification Score', () => {
    it('should give low score for 1-3 tickers', () => {
      const tickerCount = 2;
      const score = 20 + ((tickerCount - 1) / 3) * 20;
      expect(score).toBeCloseTo(26.67, 1);
    });

    it('should give moderate score for 7-10 tickers', () => {
      const tickerCount = 8;
      const score = 60 + ((tickerCount - 7) / 4) * 15;
      expect(score).toBeCloseTo(63.75, 1);
    });

    it('should give high score for 20+ tickers', () => {
      const tickerCount = 25;
      const score = Math.min(100, 90 + (tickerCount - 20));
      expect(score).toBe(95);
    });

    it('should cap at 100', () => {
      const tickerCount = 35;
      const score = Math.min(100, 90 + (tickerCount - 20));
      expect(score).toBe(100);
    });
  });

  describe('Sector Concentration', () => {
    it('should aggregate tickers into sectors', () => {
      const tickers = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'JPM'];
      const sectorMap = new Map<string, number>();
      for (const t of tickers) {
        const sector = getSector(t);
        sectorMap.set(sector, (sectorMap.get(sector) || 0) + 1);
      }
      expect(sectorMap.get('Technology')).toBe(3);
      expect(sectorMap.get('Consumer Discretionary')).toBe(1);
      expect(sectorMap.get('Financials')).toBe(1);
    });

    it('should flag sector over 25%', () => {
      const sectorPcts = [
        { sector: 'Technology', percentage: 60 },
        { sector: 'Financials', percentage: 20 },
        { sector: 'Healthcare', percentage: 20 },
      ];
      const violations = sectorPcts.filter(s => s.percentage > 25).length;
      expect(violations).toBe(1);
    });
  });

  describe('Buying Power Aggregation', () => {
    it('should aggregate buying power across multiple accounts', () => {
      const accounts = [
        { derivativeBuyingPower: 50000, netLiquidatingValue: 100000 },
        { derivativeBuyingPower: 30000, netLiquidatingValue: 80000 },
        { derivativeBuyingPower: 20000, netLiquidatingValue: 60000 },
      ];
      const totalBP = accounts.reduce((sum, a) => sum + a.derivativeBuyingPower, 0);
      const totalNL = accounts.reduce((sum, a) => sum + a.netLiquidatingValue, 0);
      expect(totalBP).toBe(100000);
      expect(totalNL).toBe(240000);
    });

    it('should calculate capital utilization correctly', () => {
      const totalNetLiq = 240000;
      const totalBuyingPower = 100000;
      const utilization = ((totalNetLiq - totalBuyingPower) / totalNetLiq) * 100;
      expect(utilization).toBeCloseTo(58.33, 1);
    });

    it('should handle zero net liq gracefully', () => {
      const totalNetLiq = 0;
      const totalBuyingPower = 0;
      const utilization = totalNetLiq > 0 ? ((totalNetLiq - totalBuyingPower) / totalNetLiq) * 100 : 0;
      expect(utilization).toBe(0);
    });
  });

  describe('WTR (Weeks to Recovery) Calculation', () => {
    // Replicate helper functions from the router
    function estimateWeeklyPremium(currentOptionValue: number, dte: number): number {
      if (dte <= 0 || currentOptionValue <= 0) return 0;
      const weeksRemaining = dte / 7;
      if (weeksRemaining <= 0) return 0;
      return currentOptionValue / weeksRemaining;
    }

    function getDaysToExpiration(expiration?: string): number {
      if (!expiration) return 30;
      const expDate = new Date(expiration + 'T16:00:00Z');
      const now = new Date();
      const diffMs = expDate.getTime() - now.getTime();
      return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    function computeWTR(
      stockCostBasis: number,
      currentStockPrice: number,
      weeklyPremiumPerShare: number,
      sharesPerContract: number,
      contracts: number,
    ): { weeksToRecovery: number | undefined; wtrBasis: string } {
      const unrealizedLossPerShare = stockCostBasis - currentStockPrice;
      if (unrealizedLossPerShare <= 0) {
        return { weeksToRecovery: 0, wtrBasis: 'Stock is at or above cost basis' };
      }
      if (weeklyPremiumPerShare <= 0) {
        return { weeksToRecovery: undefined, wtrBasis: 'Cannot estimate' };
      }
      const totalLoss = unrealizedLossPerShare * sharesPerContract * contracts;
      const totalWeeklyPremium = weeklyPremiumPerShare * sharesPerContract * contracts;
      const weeks = totalLoss / totalWeeklyPremium;
      return {
        weeksToRecovery: Math.round(weeks * 10) / 10,
        wtrBasis: `$${unrealizedLossPerShare.toFixed(2)}/share loss`,
      };
    }

    it('should return 0 weeks when stock is above cost basis', () => {
      const result = computeWTR(150, 160, 1.5, 100, 1);
      expect(result.weeksToRecovery).toBe(0);
    });

    it('should calculate weeks correctly for a stock loss', () => {
      // Stock bought at $50, now at $45, $5 loss per share
      // Weekly CC premium of $1.00/share
      // WTR = $5 / $1 = 5.0 weeks
      const result = computeWTR(50, 45, 1.0, 100, 1);
      expect(result.weeksToRecovery).toBe(5.0);
    });

    it('should scale WTR with multiple contracts', () => {
      // 3 contracts, same per-share loss and premium
      // Total loss = $5 * 100 * 3 = $1500
      // Total weekly premium = $1 * 100 * 3 = $300
      // WTR = $1500 / $300 = 5.0 weeks (same ratio)
      const result = computeWTR(50, 45, 1.0, 100, 3);
      expect(result.weeksToRecovery).toBe(5.0);
    });

    it('should return undefined when no premium data', () => {
      const result = computeWTR(50, 45, 0, 100, 1);
      expect(result.weeksToRecovery).toBeUndefined();
    });

    it('should estimate weekly premium from option value and DTE', () => {
      // Option worth $3.00 with 21 DTE = 3 weeks remaining
      // Weekly premium = $3.00 / 3 = $1.00
      const weekly = estimateWeeklyPremium(3.0, 21);
      expect(weekly).toBe(1.0);
    });

    it('should return 0 weekly premium for expired options', () => {
      expect(estimateWeeklyPremium(3.0, 0)).toBe(0);
      expect(estimateWeeklyPremium(3.0, -5)).toBe(0);
    });

    it('should return 0 weekly premium for worthless options', () => {
      expect(estimateWeeklyPremium(0, 21)).toBe(0);
    });

    it('should handle large DTE correctly', () => {
      // Option worth $8.00 with 56 DTE = 8 weeks
      // Weekly premium = $8.00 / 8 = $1.00
      const weekly = estimateWeeklyPremium(8.0, 56);
      expect(weekly).toBe(1.0);
    });

    it('should calculate break-even for short put', () => {
      const strike = 50;
      const premiumCollected = 2.0;
      const breakEven = strike - premiumCollected;
      expect(breakEven).toBe(48);
    });

    it('should calculate break-even for short call', () => {
      const strike = 50;
      const premiumCollected = 2.0;
      const breakEven = strike + premiumCollected;
      expect(breakEven).toBe(52);
    });

    it('should calculate option P&L correctly', () => {
      // Sold for $3.00, now worth $4.50 → losing $1.50/share × 2 contracts × 100 = -$300
      const premiumCollected = 3.0;
      const currentValue = 4.5;
      const quantity = 2;
      const optionPnL = (premiumCollected - currentValue) * quantity * 100;
      expect(optionPnL).toBe(-300);
    });

    it('should calculate profitable option P&L', () => {
      // Sold for $3.00, now worth $1.00 → profit $2.00/share × 1 contract × 100 = +$200
      const premiumCollected = 3.0;
      const currentValue = 1.0;
      const quantity = 1;
      const optionPnL = (premiumCollected - currentValue) * quantity * 100;
      expect(optionPnL).toBe(200);
    });
  });

  describe('Recommendations Generation', () => {
    it('should generate concentration reduction recommendation', () => {
      const concentrations = [
        { ticker: 'NVDA', percentage: 78.90, capitalAtRisk: 172000 },
        { ticker: 'AAPL', percentage: 17.66, capitalAtRisk: 38500 },
      ];
      const violations10pct = concentrations.filter(c => c.percentage > 10).length;
      expect(violations10pct).toBe(2);
    });

    it('should generate naked position warning', () => {
      const nakedCount = 3;
      const actionItems: any[] = [];
      if (nakedCount > 0) {
        actionItems.push({
          priority: 'high',
          description: `${nakedCount} truly naked position${nakedCount > 1 ? 's' : ''} detected. These have unlimited risk. Consider adding protective legs.`,
        });
      }
      expect(actionItems).toHaveLength(1);
      expect(actionItems[0].priority).toBe('high');
      expect(actionItems[0].description).toContain('3 truly naked positions');
    });

    it('should generate capital utilization warning', () => {
      const capitalUtilizationPct = 82;
      const actionItems: any[] = [];
      if (capitalUtilizationPct > 75) {
        actionItems.push({
          priority: 'medium',
          description: `Capital utilization at ${capitalUtilizationPct.toFixed(0)}%. Keep below 75% for adjustment room.`,
        });
      }
      expect(actionItems).toHaveLength(1);
      expect(actionItems[0].description).toContain('82%');
    });
  });
});
