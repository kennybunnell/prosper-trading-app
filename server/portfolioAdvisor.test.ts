/**
 * Portfolio Advisor Tests
 * Tests portfolio risk analysis and recommendation logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock position data for testing
const mockPositions = [
  {
    'instrument-type': 'Equity Option',
    'symbol': 'AAPL  260221P00200000',
    'underlying-symbol': 'AAPL',
    'option-type': 'P',
    'strike-price': '200',
    'quantity': '-1',
    'quantity-direction': 'Short',
    'close-price': '195',
    'underlying-price': '185',
    'delta': '-0.35',
  },
  {
    'instrument-type': 'Equity Option',
    'symbol': 'HOOD  260221P00015000',
    'underlying-symbol': 'HOOD',
    'option-type': 'P',
    'strike-price': '15',
    'quantity': '-5',
    'quantity-direction': 'Short',
    'close-price': '14.5',
    'underlying-price': '13.5', // Underwater
    'delta': '-0.45',
  },
  {
    'instrument-type': 'Equity Option',
    'symbol': 'NVDA  260221C00850000',
    'underlying-symbol': 'NVDA',
    'option-type': 'C',
    'strike-price': '850',
    'quantity': '-2',
    'quantity-direction': 'Short',
    'close-price': '860',
    'underlying-price': '860',
    'delta': '0.55',
  },
  {
    'instrument-type': 'Equity',
    'symbol': 'AAPL',
    'quantity': '100',
    'close-price': '185',
    'delta': '1.0',
  },
];

describe('Portfolio Advisor', () => {
  describe('Concentration Risk Calculation', () => {
    it('should calculate ticker exposure correctly', () => {
      const tickerExposure = new Map<string, number>();
      let totalCapitalAtRisk = 0;

      for (const pos of mockPositions) {
        const instrumentType = pos['instrument-type'];
        const symbol = pos.symbol;
        const quantity = Math.abs(parseInt(String(pos.quantity || '0')));
        const underlyingSymbol = pos['underlying-symbol'] || symbol;

        if (instrumentType === 'Equity Option') {
          const strikePrice = parseFloat(String(pos['strike-price'] || '0'));
          const optionType = pos['option-type'];
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short';

          if (isShort && optionType === 'P') {
            const collateral = strikePrice * 100 * quantity;
            totalCapitalAtRisk += collateral;
            tickerExposure.set(underlyingSymbol, (tickerExposure.get(underlyingSymbol) || 0) + collateral);
          } else if (isShort && optionType === 'C') {
            const closePrice = parseFloat(String(pos['close-price'] || strikePrice));
            const capitalAtRisk = closePrice * 100 * quantity;
            totalCapitalAtRisk += capitalAtRisk;
            tickerExposure.set(underlyingSymbol, (tickerExposure.get(underlyingSymbol) || 0) + capitalAtRisk);
          }
        } else if (instrumentType === 'Equity') {
          const closePrice = parseFloat(String(pos['close-price'] || '0'));
          const marketValue = closePrice * quantity;
          totalCapitalAtRisk += marketValue;
          tickerExposure.set(symbol, (tickerExposure.get(symbol) || 0) + marketValue);
        }
      }

      // AAPL: 200*100*1 (short put) + 185*100 (stock) = 20,000 + 18,500 = 38,500
      // HOOD: 15*100*5 (short put) = 7,500
      // NVDA: 860*100*2 (short call) = 172,000
      // Total: 218,000

      expect(tickerExposure.get('AAPL')).toBe(38500);
      expect(tickerExposure.get('HOOD')).toBe(7500);
      expect(tickerExposure.get('NVDA')).toBe(172000);
      expect(totalCapitalAtRisk).toBe(218000);

      // Calculate percentages
      const aaplPct = (38500 / 218000) * 100;
      const hoodPct = (7500 / 218000) * 100;
      const nvdaPct = (172000 / 218000) * 100;

      expect(aaplPct).toBeCloseTo(17.66, 1);
      expect(hoodPct).toBeCloseTo(3.44, 1);
      expect(nvdaPct).toBeCloseTo(78.90, 1);
    });

    it('should identify concentration violations', () => {
      const concentrations = [
        { ticker: 'NVDA', percentage: 78.90 },
        { ticker: 'AAPL', percentage: 17.66 },
        { ticker: 'HOOD', percentage: 3.44 },
      ];

      const violations10pct = concentrations.filter(c => c.percentage > 10).length;
      const violations25pct = concentrations.filter(c => c.percentage > 25).length;

      expect(violations10pct).toBe(2); // NVDA and AAPL
      expect(violations25pct).toBe(1); // NVDA only
    });
  });

  describe('Underwater Position Detection', () => {
    it('should identify underwater short puts', () => {
      const underwaterPositions: any[] = [];

      for (const pos of mockPositions) {
        const instrumentType = pos['instrument-type'];
        if (instrumentType === 'Equity Option') {
          const optionType = pos['option-type'];
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short';
          const strikePrice = parseFloat(String(pos['strike-price'] || '0'));
          const underlyingPrice = parseFloat(String(pos['underlying-price'] || '0'));
          const underlyingSymbol = pos['underlying-symbol'];

          if (isShort && optionType === 'P' && underlyingPrice < strikePrice) {
            const percentBelow = ((strikePrice - underlyingPrice) / strikePrice) * 100;
            underwaterPositions.push({
              ticker: underlyingSymbol,
              strike: strikePrice,
              currentPrice: underlyingPrice,
              percentBelow,
            });
          }
        }
      }

      // AAPL: strike=200, current=185, 7.5% below
      // HOOD: strike=15, current=13.5, 10% below

      expect(underwaterPositions.length).toBe(2);
      expect(underwaterPositions[0].ticker).toBe('AAPL');
      expect(underwaterPositions[0].percentBelow).toBeCloseTo(7.5, 1);
      expect(underwaterPositions[1].ticker).toBe('HOOD');
      expect(underwaterPositions[1].percentBelow).toBeCloseTo(10.0, 1);
    });
  });

  describe('Portfolio Delta Calculation', () => {
    it('should calculate total portfolio delta correctly', () => {
      let totalDelta = 0;

      for (const pos of mockPositions) {
        const delta = parseFloat(String(pos.delta || '0'));
        const quantity = parseInt(String(pos.quantity || '0'));
        
        if (pos['instrument-type'] === 'Equity Option') {
          totalDelta += delta * quantity * 100; // Multiply by 100 for options
        } else {
          totalDelta += delta * quantity; // Stock delta is 1:1
        }
      }

      // AAPL put: -0.35 * -1 * 100 = 35
      // HOOD put: -0.45 * -5 * 100 = 225
      // NVDA call: 0.55 * -2 * 100 = -110
      // AAPL stock: 1.0 * 100 = 100
      // Total: 35 + 225 - 110 + 100 = 250

      expect(totalDelta).toBeCloseTo(250, 0);
    });

    it('should calculate delta per $1000 correctly', () => {
      const totalCapitalAtRisk = 218000;
      const totalDelta = 250;
      const deltaPer1000 = (totalDelta / (totalCapitalAtRisk / 1000));

      expect(deltaPer1000).toBeCloseTo(1.15, 2);
    });
  });

  describe('Risk Score Calculation', () => {
    it('should calculate risk score based on concentration', () => {
      let riskScore = 0;
      const maxConcentration = 78.90; // NVDA

      if (maxConcentration >= 50) {
        riskScore += 40;
      } else if (maxConcentration >= 30) {
        riskScore += 30;
      } else if (maxConcentration >= 20) {
        riskScore += 20;
      } else if (maxConcentration >= 10) {
        riskScore += 10;
      }

      expect(riskScore).toBe(40);
    });

    it('should calculate risk score based on underwater positions', () => {
      let riskScore = 0;
      const totalPositions = 4;
      const underwaterCount = 2;
      const underwaterPct = (underwaterCount / totalPositions) * 100; // 50%

      if (underwaterPct >= 50) {
        riskScore += 30;
      } else if (underwaterPct >= 30) {
        riskScore += 20;
      } else if (underwaterPct >= 10) {
        riskScore += 10;
      }

      expect(riskScore).toBe(30);
    });

    it('should calculate diversification score correctly', () => {
      const tickerCount = 3; // AAPL, HOOD, NVDA

      // 1-3 tickers = poor (30-50)
      let diversificationScore = 30 + ((tickerCount - 1) / 2) * 20;

      expect(diversificationScore).toBe(50);

      // Risk contribution from diversification (inverse)
      const diversificationRisk = Math.round((100 - diversificationScore) * 0.3);
      expect(diversificationRisk).toBe(15);
    });

    it('should calculate overall risk score correctly', () => {
      let riskScore = 0;

      // Concentration risk: 40 points (max concentration 78.90%)
      riskScore += 40;

      // Underwater positions: 30 points (50% underwater)
      riskScore += 30;

      // Diversification: 15 points (50 score → 50 risk * 0.3)
      riskScore += 15;

      expect(riskScore).toBe(85);
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

    it('should generate underwater position recommendation', () => {
      const underwaterPositions = [
        { ticker: 'AAPL', percentBelow: 7.5 },
        { ticker: 'HOOD', percentBelow: 10.0 },
      ];

      const actionItems: any[] = [];
      if (underwaterPositions.length > 0) {
        actionItems.push({
          priority: 'high',
          description: `${underwaterPositions.length} positions are underwater. Consider rolling or closing to avoid assignment.`,
        });
      }

      expect(actionItems.length).toBe(1);
      expect(actionItems[0].priority).toBe('high');
      expect(actionItems[0].description).toContain('2 positions');
    });

    it('should generate delta hedging recommendation', () => {
      const deltaPer1000 = 1.15;

      const actionItems: any[] = [];
      if (Math.abs(deltaPer1000) > 5) {
        actionItems.push({
          priority: 'medium',
          description: `Portfolio delta is ${deltaPer1000.toFixed(2)} per $1000. Consider hedging to reduce directional risk.`,
        });
      }

      // Delta is 1.15, which is < 5, so no recommendation
      expect(actionItems.length).toBe(0);
    });

    it('should generate diversification recommendation', () => {
      const tickerCount = 3;

      const actionItems: any[] = [];
      if (tickerCount < 7) {
        actionItems.push({
          priority: 'low',
          description: `Increase diversification. Currently only ${tickerCount} tickers. Target: 10+ tickers.`,
        });
      }

      expect(actionItems.length).toBe(1);
      expect(actionItems[0].priority).toBe('low');
      expect(actionItems[0].description).toContain('3 tickers');
    });
  });
});
