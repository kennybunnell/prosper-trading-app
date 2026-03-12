/**
 * Risk Assessment System Tests
 * Tests earnings detection, badge calculation, and risk assessment logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateRiskBadges, calculateBulkRiskAssessments } from './riskAssessment';
import { TradierAPI } from './tradier';

// Mock Tradier API
vi.mock('./tradier', () => {
  // Calculate dynamic dates relative to today
  const today = new Date();
  const in2Days = new Date(today);
  in2Days.setDate(today.getDate() + 2);
  const in10Days = new Date(today);
  in10Days.setDate(today.getDate() + 10);
  const in18Days = new Date(today);
  in18Days.setDate(today.getDate() + 18);

  return {
    TradierAPI: vi.fn().mockImplementation(() => ({
      getEarningsCalendar: vi.fn().mockResolvedValue(new Map([
        ['AAPL', in10Days.toISOString().split('T')[0]], // 10 days away (earnings-soon)
        ['HOOD', in2Days.toISOString().split('T')[0]], // 2 days away (earnings-this-week)
        ['TSLA', in18Days.toISOString().split('T')[0]], // 18 days away (no badge)
      ])),
      getTechnicalIndicators: vi.fn().mockImplementation((symbol: string) => {
        const indicators: Record<string, any> = {
          AAPL: {
            ivRank: 45,
            week52Range: { percentInRange: 75 },
            movingAverage: { percentFromSMA: 2.5 },
          },
          HOOD: {
            ivRank: 85, // Extreme volatility
            week52Range: { percentInRange: 25 }, // Below support
            movingAverage: { percentFromSMA: -8 }, // Momentum reversal
          },
          TSLA: {
            ivRank: 55,
            week52Range: { percentInRange: 60 },
            movingAverage: { percentFromSMA: 1.2 },
          },
          NVDA: {
            ivRank: 40,
            week52Range: { percentInRange: 80 },
            movingAverage: { percentFromSMA: 3.5 },
          },
        };
        return Promise.resolve(indicators[symbol] || {});
      }),
      getQuote: vi.fn().mockImplementation((symbol: string) => {
        const quotes: Record<string, any> = {
          AAPL: { last: 175.50, week_52_high: 200, week_52_low: 150 },
          HOOD: { last: 15.25, week_52_high: 25, week_52_low: 10 },
          TSLA: { last: 245.80, week_52_high: 300, week_52_low: 180 },
          NVDA: { last: 850.00, week_52_high: 900, week_52_low: 600 },
        };
        return Promise.resolve(quotes[symbol] || { last: 100, week_52_high: 120, week_52_low: 80 });
      }),
    })),
  };
});

describe('Risk Assessment System', () => {
  let mockAPI: TradierAPI;

  beforeEach(() => {
    mockAPI = new TradierAPI('test-key', true);
  });

  describe('calculateRiskBadges', () => {
    it('should detect earnings within 7 days (extreme risk)', async () => {
      const today = new Date();
      const in3Days = new Date(today);
      in3Days.setDate(today.getDate() + 3);
      const earningsMap = new Map([['HOOD', in3Days.toISOString().split('T')[0]]]);
      const badges = await calculateRiskBadges('HOOD', mockAPI, earningsMap);

      const earningsBadge = badges.find(b => b.type === 'earnings-this-week');
      expect(earningsBadge).toBeDefined();
      expect(earningsBadge?.severity).toBe('danger');
      expect(earningsBadge?.label).toContain('Earnings');
    });

    it('should detect earnings within 8-14 days (warning)', async () => {
      const today = new Date();
      const in10Days = new Date(today);
      in10Days.setDate(today.getDate() + 10);
      const earningsMap = new Map([['AAPL', in10Days.toISOString().split('T')[0]]]);
      const badges = await calculateRiskBadges('AAPL', mockAPI, earningsMap);

      const earningsBadge = badges.find(b => b.type === 'earnings-soon');
      expect(earningsBadge).toBeDefined();
      expect(earningsBadge?.severity).toBe('warning');
    });

    it('should detect extreme volatility (IV Rank > 70%)', async () => {
      const earningsMap = new Map();
      const badges = await calculateRiskBadges('HOOD', mockAPI, earningsMap);

      const volatilityBadge = badges.find(b => b.type === 'extreme-volatility');
      expect(volatilityBadge).toBeDefined();
      expect(volatilityBadge?.severity).toBe('danger');
    });

    it('should detect below support (< 40% of 52-week range)', async () => {
      const earningsMap = new Map();
      const badges = await calculateRiskBadges('HOOD', mockAPI, earningsMap);

      const supportBadge = badges.find(b => b.type === 'below-support');
      expect(supportBadge).toBeDefined();
      expect(supportBadge?.severity).toBe('danger');
    });

    it('should detect momentum reversal (< -5% from 20-day SMA)', async () => {
      const earningsMap = new Map();
      const badges = await calculateRiskBadges('HOOD', mockAPI, earningsMap);

      const momentumBadge = badges.find(b => b.type === 'momentum-reversal');
      expect(momentumBadge).toBeDefined();
      expect(momentumBadge?.severity).toBe('warning');
    });

    it('should detect blue chip stocks (Mag 7)', async () => {
      const earningsMap = new Map();
      const badges = await calculateRiskBadges('AAPL', mockAPI, earningsMap);

      const blueChipBadge = badges.find(b => b.type === 'blue-chip');
      expect(blueChipBadge).toBeDefined();
      expect(blueChipBadge?.severity).toBe('positive');
      expect(blueChipBadge?.tooltip).toContain('Magnificent 7');
    });

    it('should return multiple badges for high-risk stocks', async () => {
      const today = new Date();
      const in2Days = new Date(today);
      in2Days.setDate(today.getDate() + 2);
      const earningsMap = new Map([['HOOD', in2Days.toISOString().split('T')[0]]]);
      const badges = await calculateRiskBadges('HOOD', mockAPI, earningsMap);

      // HOOD should have: earnings-this-week, extreme-volatility, below-support, momentum-reversal
      expect(badges.length).toBeGreaterThanOrEqual(3);
      expect(badges.some(b => b.type === 'earnings-this-week')).toBe(true);
      expect(badges.some(b => b.type === 'extreme-volatility')).toBe(true);
      expect(badges.some(b => b.type === 'below-support')).toBe(true);
    });

    it('should return minimal badges for low-risk blue chip stocks', async () => {
      const earningsMap = new Map();
      const badges = await calculateRiskBadges('NVDA', mockAPI, earningsMap);

      // NVDA (Mag 7) should only have blue-chip badge
      expect(badges.length).toBe(1);
      expect(badges[0].type).toBe('blue-chip');
    });
  });

  describe('calculateBulkRiskAssessments', () => {
    it('should calculate risk assessments for multiple symbols', async () => {
      const symbols = ['AAPL', 'HOOD', 'TSLA', 'NVDA'];
      const assessments = await calculateBulkRiskAssessments(symbols, mockAPI);

      expect(assessments.size).toBe(4);
      expect(assessments.has('AAPL')).toBe(true);
      expect(assessments.has('HOOD')).toBe(true);
      expect(assessments.has('TSLA')).toBe(true);
      expect(assessments.has('NVDA')).toBe(true);
    });

    it('should calculate correct overall risk levels', async () => {
      const symbols = ['AAPL', 'HOOD', 'NVDA'];
      const assessments = await calculateBulkRiskAssessments(symbols, mockAPI);

      const aaplRisk = assessments.get('AAPL');
      const hoodRisk = assessments.get('HOOD');
      const nvdaRisk = assessments.get('NVDA');

      // AAPL: earnings-soon (warning) + blue-chip (positive) = high risk (earnings takes precedence)
      expect(aaplRisk?.overallRisk).toBe('high');

      // HOOD: multiple danger badges (earnings-this-week, extreme-volatility, below-support) = extreme risk
      expect(hoodRisk?.overallRisk).toBe('extreme');

      // NVDA: only blue-chip (positive) = low risk
      expect(nvdaRisk?.overallRisk).toBe('low');
    });

    it('should handle API errors gracefully', async () => {
      const mockFailingAPI = {
        ...mockAPI,
        getEarningsCalendar: vi.fn().mockRejectedValue(new Error('API Error')),
      } as unknown as TradierAPI;

      const symbols = ['AAPL'];
      const assessments = await calculateBulkRiskAssessments(symbols, mockFailingAPI);

      // Should return empty map on total failure
      expect(assessments.size).toBe(0);
    });
  });

  describe('Badge Tooltips', () => {
    it('should include helpful tooltip information', async () => {
      const today = new Date();
      const in3Days = new Date(today);
      in3Days.setDate(today.getDate() + 3);
      const earningsMap = new Map([['HOOD', in3Days.toISOString().split('T')[0]]]);
      const badges = await calculateRiskBadges('HOOD', mockAPI, earningsMap);

      badges.forEach(badge => {
        expect(badge.tooltip).toBeDefined();
        expect(badge.tooltip.length).toBeGreaterThan(10);
        expect(badge.emoji).toBeDefined();
      });
    });

    it('should include specific dates in earnings tooltips', async () => {
      const today = new Date();
      const in10Days = new Date(today);
      in10Days.setDate(today.getDate() + 10);
      const dateStr = in10Days.toISOString().split('T')[0];
      const earningsMap = new Map([['AAPL', dateStr]]);
      const badges = await calculateRiskBadges('AAPL', mockAPI, earningsMap);

      const earningsBadge = badges.find(b => b.type === 'earnings-soon');
      expect(earningsBadge).toBeDefined();
      expect(earningsBadge?.tooltip).toContain(dateStr);
    });
  });
});
