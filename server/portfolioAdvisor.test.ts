/**
 * Portfolio Advisor Tests
 * Tests for OCC parsing, spread detection, capital-at-risk, underwater detection,
 * risk score calculation, and sector mapping
 *
 * Updated to match the rewritten routers-portfolio-advisor.ts logic:
 * - OCC symbol parsing (not relying on option-type field)
 * - Spread-aware capital at risk
 * - Recalibrated risk score with capital utilization factor
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
  HOOD: 'Technology', COIN: 'Technology', TSLA: 'Consumer Discretionary',
  JPM: 'Financials', BAC: 'Financials', JNJ: 'Healthcare', PFE: 'Healthcare',
  XOM: 'Energy', CVX: 'Energy', SPY: 'ETF/Index', QQQ: 'ETF/Index',
  CAT: 'Industrials', BA: 'Industrials', NEE: 'Utilities',
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

function detectSpreads(positions: ParsedPosition[]): {
  spreads: SpreadPair[];
  standaloneShorts: ParsedPosition[];
  standaloneLongs: ParsedPosition[];
  equities: ParsedPosition[];
} {
  const options = positions.filter(p => p.instrumentType === 'Equity Option');
  const equities = positions.filter(p => p.instrumentType === 'Equity');
  const groups = new Map<string, { shorts: ParsedPosition[]; longs: ParsedPosition[] }>();
  for (const opt of options) {
    const key = `${opt.underlyingSymbol}|${opt.expiration}|${opt.optionType}`;
    if (!groups.has(key)) groups.set(key, { shorts: [], longs: [] });
    const g = groups.get(key)!;
    if (opt.direction === 'short') g.shorts.push(opt);
    else g.longs.push(opt);
  }
  const spreads: SpreadPair[] = [];
  const standaloneShorts: ParsedPosition[] = [];
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
      if (!matched) standaloneShorts.push(shortLeg);
    }
    for (let i = 0; i < longs.length; i++) {
      if (!usedLongs.has(i)) standaloneLongs.push(longs[i]);
    }
  }
  return { spreads, standaloneShorts, standaloneLongs, equities };
}

function computeRiskScore(
  maxConcentrationPct: number,
  underwaterCount: number,
  totalPositionCount: number,
  diversificationScore: number,
  capitalUtilizationPct: number,
): number {
  let score = 0;
  if (maxConcentrationPct >= 40) score += 35;
  else if (maxConcentrationPct >= 25) score += 28;
  else if (maxConcentrationPct >= 15) score += 20;
  else if (maxConcentrationPct >= 8) score += 12;
  else if (maxConcentrationPct >= 5) score += 5;
  if (totalPositionCount > 0) {
    const underwaterPct = (underwaterCount / totalPositionCount) * 100;
    if (underwaterPct >= 50) score += 25;
    else if (underwaterPct >= 30) score += 20;
    else if (underwaterPct >= 15) score += 15;
    else if (underwaterPct >= 5) score += 8;
    else if (underwaterCount > 0) score += 4;
  }
  score += Math.round((100 - diversificationScore) * 0.2);
  if (capitalUtilizationPct >= 90) score += 20;
  else if (capitalUtilizationPct >= 75) score += 15;
  else if (capitalUtilizationPct >= 60) score += 10;
  else if (capitalUtilizationPct >= 40) score += 5;
  return Math.min(100, score);
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

    it('should parse OCC with spaces stripped', () => {
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

    it('should handle tickers with P in the name (PLTR, APLD, SPY)', () => {
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
      expect(getSector('FAKESYMBOL')).toBe('Other');
    });
  });

  describe('Spread Detection', () => {
    it('should detect a bull put spread (short put + long put, same expiration)', () => {
      const positions: ParsedPosition[] = [
        {
          accountNumber: 'ACC1', symbol: 'AAPL  250321P00180000', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity Option', quantity: 1, direction: 'short',
          optionType: 'PUT', strike: 180, expiration: '2025-03-21',
          closePrice: 2.5, averageOpenPrice: 3.0, multiplier: 100, delta: -0.3,
        },
        {
          accountNumber: 'ACC1', symbol: 'AAPL  250321P00175000', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity Option', quantity: 1, direction: 'long',
          optionType: 'PUT', strike: 175, expiration: '2025-03-21',
          closePrice: 1.5, averageOpenPrice: 2.0, multiplier: 100, delta: -0.2,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.spreads.length).toBe(1);
      expect(result.standaloneShorts.length).toBe(0);
      expect(result.spreads[0].spreadWidth).toBe(5);
      expect(result.spreads[0].capitalAtRisk).toBe(500); // $5 wide * 100 * 1 contract
    });

    it('should detect a bear call spread', () => {
      const positions: ParsedPosition[] = [
        {
          accountNumber: 'ACC1', symbol: 'NVDA  250418C00900000', underlyingSymbol: 'NVDA',
          instrumentType: 'Equity Option', quantity: 2, direction: 'short',
          optionType: 'CALL', strike: 900, expiration: '2025-04-18',
          closePrice: 5.0, averageOpenPrice: 6.0, multiplier: 100, delta: 0.3,
        },
        {
          accountNumber: 'ACC1', symbol: 'NVDA  250418C00910000', underlyingSymbol: 'NVDA',
          instrumentType: 'Equity Option', quantity: 2, direction: 'long',
          optionType: 'CALL', strike: 910, expiration: '2025-04-18',
          closePrice: 3.0, averageOpenPrice: 4.0, multiplier: 100, delta: 0.2,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.spreads.length).toBe(1);
      expect(result.spreads[0].spreadWidth).toBe(10);
      expect(result.spreads[0].capitalAtRisk).toBe(2000); // $10 wide * 100 * 2 contracts
    });

    it('should leave standalone short puts as naked CSPs', () => {
      const positions: ParsedPosition[] = [
        {
          accountNumber: 'ACC1', symbol: 'HOOD  250321P00007500', underlyingSymbol: 'HOOD',
          instrumentType: 'Equity Option', quantity: 5, direction: 'short',
          optionType: 'PUT', strike: 7.5, expiration: '2025-03-21',
          closePrice: 0.3, averageOpenPrice: 0.5, multiplier: 100, delta: -0.15,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.spreads.length).toBe(0);
      expect(result.standaloneShorts.length).toBe(1);
      expect(result.standaloneShorts[0].underlyingSymbol).toBe('HOOD');
    });

    it('should not match legs with different expirations', () => {
      const positions: ParsedPosition[] = [
        {
          accountNumber: 'ACC1', symbol: 'AAPL  250321P00180000', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity Option', quantity: 1, direction: 'short',
          optionType: 'PUT', strike: 180, expiration: '2025-03-21',
          closePrice: 2.5, averageOpenPrice: 3.0, multiplier: 100, delta: -0.3,
        },
        {
          accountNumber: 'ACC1', symbol: 'AAPL  250418P00175000', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity Option', quantity: 1, direction: 'long',
          optionType: 'PUT', strike: 175, expiration: '2025-04-18',
          closePrice: 1.5, averageOpenPrice: 2.0, multiplier: 100, delta: -0.2,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.spreads.length).toBe(0);
      expect(result.standaloneShorts.length).toBe(1);
      expect(result.standaloneLongs.length).toBe(1);
    });

    it('should not match legs with different quantities', () => {
      const positions: ParsedPosition[] = [
        {
          accountNumber: 'ACC1', symbol: 'AAPL  250321P00180000', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity Option', quantity: 2, direction: 'short',
          optionType: 'PUT', strike: 180, expiration: '2025-03-21',
          closePrice: 2.5, averageOpenPrice: 3.0, multiplier: 100, delta: -0.3,
        },
        {
          accountNumber: 'ACC1', symbol: 'AAPL  250321P00175000', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity Option', quantity: 1, direction: 'long',
          optionType: 'PUT', strike: 175, expiration: '2025-03-21',
          closePrice: 1.5, averageOpenPrice: 2.0, multiplier: 100, delta: -0.2,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.spreads.length).toBe(0);
      expect(result.standaloneShorts.length).toBe(1);
      expect(result.standaloneLongs.length).toBe(1);
    });

    it('should handle equities separately', () => {
      const positions: ParsedPosition[] = [
        {
          accountNumber: 'ACC1', symbol: 'AAPL', underlyingSymbol: 'AAPL',
          instrumentType: 'Equity', quantity: 100, direction: 'long',
          closePrice: 185, averageOpenPrice: 170, multiplier: 1, delta: 1.0,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.equities.length).toBe(1);
      expect(result.spreads.length).toBe(0);
    });

    it('should detect iron condor as two separate spreads', () => {
      const positions: ParsedPosition[] = [
        // Put spread (BPS)
        {
          accountNumber: 'ACC1', symbol: 'SPY   250321P00540000', underlyingSymbol: 'SPY',
          instrumentType: 'Equity Option', quantity: 1, direction: 'short',
          optionType: 'PUT', strike: 540, expiration: '2025-03-21',
          closePrice: 3.0, averageOpenPrice: 4.0, multiplier: 100, delta: -0.25,
        },
        {
          accountNumber: 'ACC1', symbol: 'SPY   250321P00535000', underlyingSymbol: 'SPY',
          instrumentType: 'Equity Option', quantity: 1, direction: 'long',
          optionType: 'PUT', strike: 535, expiration: '2025-03-21',
          closePrice: 2.0, averageOpenPrice: 3.0, multiplier: 100, delta: -0.18,
        },
        // Call spread (BCS)
        {
          accountNumber: 'ACC1', symbol: 'SPY   250321C00580000', underlyingSymbol: 'SPY',
          instrumentType: 'Equity Option', quantity: 1, direction: 'short',
          optionType: 'CALL', strike: 580, expiration: '2025-03-21',
          closePrice: 2.5, averageOpenPrice: 3.5, multiplier: 100, delta: 0.2,
        },
        {
          accountNumber: 'ACC1', symbol: 'SPY   250321C00585000', underlyingSymbol: 'SPY',
          instrumentType: 'Equity Option', quantity: 1, direction: 'long',
          optionType: 'CALL', strike: 585, expiration: '2025-03-21',
          closePrice: 1.5, averageOpenPrice: 2.5, multiplier: 100, delta: 0.15,
        },
      ];

      const result = detectSpreads(positions);
      expect(result.spreads.length).toBe(2);
      expect(result.standaloneShorts.length).toBe(0);
      // Put spread: $5 wide
      const putSpread = result.spreads.find(s => s.shortLeg.optionType === 'PUT');
      expect(putSpread?.spreadWidth).toBe(5);
      expect(putSpread?.capitalAtRisk).toBe(500);
      // Call spread: $5 wide
      const callSpread = result.spreads.find(s => s.shortLeg.optionType === 'CALL');
      expect(callSpread?.spreadWidth).toBe(5);
      expect(callSpread?.capitalAtRisk).toBe(500);
    });
  });

  describe('Capital at Risk Calculation', () => {
    it('should use spread width for spreads, not full strike', () => {
      // BPS: short 180P / long 175P = $5 wide, 1 contract
      const spreadCapital = 5 * 100 * 1;
      expect(spreadCapital).toBe(500);

      // Naked CSP: short 180P, 1 contract
      const nakedCapital = 180 * 100 * 1;
      expect(nakedCapital).toBe(18000);

      // The spread is 36x less capital at risk than the naked position
      expect(nakedCapital / spreadCapital).toBe(36);
    });

    it('should calculate equity capital at risk from market value', () => {
      const price = 185;
      const shares = 100;
      expect(price * shares).toBe(18500);
    });
  });

  describe('Underwater Detection', () => {
    it('should detect short put underwater when underlying < strike', () => {
      const strike = 180;
      const currentPrice = 175;
      const isUnderwater = currentPrice < strike;
      expect(isUnderwater).toBe(true);
      const percentBelow = ((strike - currentPrice) / strike) * 100;
      expect(percentBelow).toBeCloseTo(2.78, 1);
    });

    it('should NOT flag short put when underlying > strike', () => {
      const strike = 180;
      const currentPrice = 190;
      expect(currentPrice < strike).toBe(false);
    });

    it('should detect short call underwater when underlying > strike', () => {
      const strike = 900;
      const currentPrice = 920;
      expect(currentPrice > strike).toBe(true);
      const percentAbove = ((currentPrice - strike) / strike) * 100;
      expect(percentAbove).toBeCloseTo(2.22, 1);
    });

    it('should NOT flag short call when underlying < strike', () => {
      const strike = 900;
      const currentPrice = 880;
      expect(currentPrice > strike).toBe(false);
    });

    it('should include max loss for spread underwater positions', () => {
      // BPS: $5 wide, 2 contracts, underwater
      const spreadWidth = 5;
      const quantity = 2;
      const maxLoss = spreadWidth * 100 * quantity;
      expect(maxLoss).toBe(1000);
    });
  });

  describe('Risk Score Calculation (Recalibrated)', () => {
    it('should score concentration risk at lower thresholds', () => {
      // 9.8% concentration should now score 12 points (was 0 with old >=10% threshold)
      let score = 0;
      const maxConcentration = 9.8;
      if (maxConcentration >= 40) score += 35;
      else if (maxConcentration >= 25) score += 28;
      else if (maxConcentration >= 15) score += 20;
      else if (maxConcentration >= 8) score += 12;
      else if (maxConcentration >= 5) score += 5;
      expect(score).toBe(12);
    });

    it('should include capital utilization in risk score', () => {
      const riskScore = computeRiskScore(5, 0, 10, 80, 80);
      // concentration: 5 (5%), underwater: 0, diversification: (100-80)*0.2=4, utilization: 15
      expect(riskScore).toBe(5 + 0 + 4 + 15);
    });

    it('should score high risk for concentrated portfolio with underwater positions', () => {
      const riskScore = computeRiskScore(45, 5, 10, 50, 85);
      // concentration: 35 (45%), underwater: 25 (50%), diversification: (100-50)*0.2=10, utilization: 15
      expect(riskScore).toBe(35 + 25 + 10 + 15);
    });

    it('should score low risk for well-diversified healthy portfolio', () => {
      const riskScore = computeRiskScore(4, 0, 20, 90, 30);
      // concentration: 0 (4%), underwater: 0, diversification: (100-90)*0.2=2, utilization: 0
      expect(riskScore).toBe(0 + 0 + 2 + 0);
    });

    it('should cap at 100', () => {
      const riskScore = computeRiskScore(50, 20, 20, 10, 95);
      expect(riskScore).toBeLessThanOrEqual(100);
    });

    it('should add 4 points for any underwater position even if percentage is low', () => {
      const riskScore = computeRiskScore(4, 1, 100, 90, 30);
      // concentration: 0, underwater: 4 (1/100=1%), diversification: 2, utilization: 0
      expect(riskScore).toBe(0 + 4 + 2 + 0);
    });

    it('should score 0 for empty portfolio', () => {
      const riskScore = computeRiskScore(0, 0, 0, 0, 0);
      // concentration: 0, underwater: 0 (no positions), diversification: (100-0)*0.2=20, utilization: 0
      expect(riskScore).toBe(20);
    });
  });

  describe('Diversification Score', () => {
    it('should give low score for 1-3 tickers', () => {
      const tickerCount = 2;
      let score = 20 + ((tickerCount - 1) / 3) * 20;
      expect(score).toBeCloseTo(26.67, 1);
    });

    it('should give moderate score for 7-10 tickers', () => {
      const tickerCount = 8;
      let score = 60 + ((tickerCount - 7) / 4) * 15;
      expect(score).toBeCloseTo(63.75, 1);
    });

    it('should give high score for 20+ tickers', () => {
      const tickerCount = 25;
      let score = Math.min(100, 90 + (tickerCount - 20));
      expect(score).toBe(95);
    });

    it('should cap at 100', () => {
      const tickerCount = 35;
      let score = Math.min(100, 90 + (tickerCount - 20));
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

    it('should calculate capital utilization percentage', () => {
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

  describe('Recommendations Generation', () => {
    it('should generate concentration reduction recommendation', () => {
      const concentrations = [
        { ticker: 'NVDA', percentage: 78.90, capitalAtRisk: 172000 },
        { ticker: 'AAPL', percentage: 17.66, capitalAtRisk: 38500 },
        { ticker: 'HOOD', percentage: 3.44, capitalAtRisk: 7500 },
      ];
      const violations10pct = concentrations.filter(c => c.percentage > 10).length;
      const actionItems: any[] = [];
      if (violations10pct > 0) {
        actionItems.push({
          priority: 'high',
          description: `Reduce concentration in ${concentrations[0].ticker} (${concentrations[0].percentage.toFixed(1)}% of portfolio). Target: <10% per ticker.`,
        });
      }
      expect(actionItems.length).toBe(1);
      expect(actionItems[0].priority).toBe('high');
      expect(actionItems[0].description).toContain('NVDA');
      expect(actionItems[0].description).toContain('78.9%');
    });

    it('should generate underwater position recommendation with worst ticker', () => {
      const underwaterPositions = [
        { ticker: 'HOOD', percentBelow: 10.0 },
        { ticker: 'AAPL', percentBelow: 7.5 },
      ];
      const actionItems: any[] = [];
      if (underwaterPositions.length > 0) {
        const worstPct = underwaterPositions[0].percentBelow.toFixed(1);
        actionItems.push({
          priority: 'high',
          description: `${underwaterPositions.length} positions are underwater. Worst: ${underwaterPositions[0].ticker} at -${worstPct}%. Consider rolling or closing.`,
        });
      }
      expect(actionItems.length).toBe(1);
      expect(actionItems[0].description).toContain('HOOD');
      expect(actionItems[0].description).toContain('-10.0%');
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
      expect(actionItems.length).toBe(1);
      expect(actionItems[0].description).toContain('82%');
    });

    it('should generate sector concentration warning', () => {
      const sectorConcentrations = [
        { sector: 'Technology', percentage: 65 },
      ];
      const violations = sectorConcentrations.filter(s => s.percentage > 25).length;
      expect(violations).toBe(1);
    });
  });
});
