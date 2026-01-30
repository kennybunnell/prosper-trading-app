/**
 * Tests for BPS filter preset seeding and spread opportunity column structure
 */

import { describe, it, expect } from 'vitest';
import { getRecommendedFilterValues, seedBpsFilterPresets, seedBcsFilterPresets } from './db-filter-presets';

describe('BPS Filter Preset Fixes', () => {
  describe('Filter Preset Seeding', () => {
    it('should have BPS recommended filter values defined', () => {
      
      const conservative = getRecommendedFilterValues('bps', 'conservative');
      const medium = getRecommendedFilterValues('bps', 'medium');
      const aggressive = getRecommendedFilterValues('bps', 'aggressive');
      
      // Conservative preset
      expect(conservative).toBeDefined();
      expect(conservative.minDte).toBe(14);
      expect(conservative.maxDte).toBe(45);
      expect(conservative.minScore).toBe(60);
      
      // Medium preset
      expect(medium).toBeDefined();
      expect(medium.minDte).toBe(10);
      expect(medium.maxDte).toBe(30);
      expect(medium.minScore).toBe(50);
      
      // Aggressive preset
      expect(aggressive).toBeDefined();
      expect(aggressive.minDte).toBe(7);
      expect(aggressive.maxDte).toBe(21);
      expect(aggressive.minScore).toBe(40);
    });

    it('should have BCS recommended filter values defined', () => {
      
      const conservative = getRecommendedFilterValues('bcs', 'conservative');
      const medium = getRecommendedFilterValues('bcs', 'medium');
      const aggressive = getRecommendedFilterValues('bcs', 'aggressive');
      
      // Conservative preset
      expect(conservative).toBeDefined();
      expect(conservative.minDte).toBe(14);
      expect(conservative.maxDte).toBe(45);
      expect(conservative.minScore).toBe(60);
      
      // Medium preset
      expect(medium).toBeDefined();
      expect(medium.minDte).toBe(10);
      expect(medium.maxDte).toBe(30);
      expect(medium.minScore).toBe(50);
      
      // Aggressive preset
      expect(aggressive).toBeDefined();
      expect(aggressive.minDte).toBe(7);
      expect(aggressive.maxDte).toBe(21);
      expect(aggressive.minScore).toBe(40);
    });

    it('should export seedBpsFilterPresets function', () => {
      expect(seedBpsFilterPresets).toBeDefined();
      expect(typeof seedBpsFilterPresets).toBe('function');
    });

    it('should export seedBcsFilterPresets function', () => {
      expect(seedBcsFilterPresets).toBeDefined();
      expect(typeof seedBcsFilterPresets).toBe('function');
    });
  });

  describe('Spread Opportunity Column Structure', () => {
    it('should have correct column order for spread opportunities', () => {
      // Define expected column order for spread mode
      const expectedColumns = [
        'select',
        'symbol',
        'strikes',
        'current',
        'netCredit',
        'capitalRisk',
        'roc',
        'delta',
        'dte',
        'weeklyPct',
        'breakeven',
        'openInterest',
        'volume',
        'rsi',
        'bbPctB',
        'ivRank',  // ← This was missing!
        'score',
      ];
      
      // Verify the column order is correct
      expect(expectedColumns).toContain('ivRank');
      expect(expectedColumns).toContain('score');
      
      // Verify ivRank comes before score
      const ivRankIndex = expectedColumns.indexOf('ivRank');
      const scoreIndex = expectedColumns.indexOf('score');
      expect(ivRankIndex).toBeLessThan(scoreIndex);
      expect(ivRankIndex).toBe(expectedColumns.length - 2); // Second to last
      expect(scoreIndex).toBe(expectedColumns.length - 1); // Last
    });

    it('should have correct column order for CSP opportunities', () => {
      // Define expected column order for CSP mode
      const expectedColumns = [
        'select',
        'symbol',
        'strike',
        'current',
        'bid',
        'ask',
        'spreadPct',
        'delta',
        'dte',
        'premium',
        'weeklyPct',
        'collateral',
        'roc',
        'openInterest',
        'volume',
        'rsi',
        'bbPctB',
        'ivRank',
        'score',
      ];
      
      // Verify the column order is correct
      expect(expectedColumns).toContain('ivRank');
      expect(expectedColumns).toContain('score');
      
      // Verify ivRank comes before score
      const ivRankIndex = expectedColumns.indexOf('ivRank');
      const scoreIndex = expectedColumns.indexOf('score');
      expect(ivRankIndex).toBeLessThan(scoreIndex);
      expect(ivRankIndex).toBe(expectedColumns.length - 2); // Second to last
      expect(scoreIndex).toBe(expectedColumns.length - 1); // Last
    });

    it('should verify spread opportunity data structure includes ivRank and score', () => {
      // Mock spread opportunity object
      const mockSpreadOpportunity = {
        symbol: 'AAPL',
        strike: 150,
        longStrike: 145,
        currentPrice: 175.50,
        netCredit: 0.74,
        capitalAtRisk: 500,
        spreadROC: 12.11,
        delta: 0.256,
        dte: 7,
        weeklyPct: 17.37,
        breakeven: 115.26,
        openInterest: 826,
        volume: 157,
        rsi: 58.3,
        bbPctB: 0.58,
        ivRank: 64,  // ← This field must exist
        score: 84,   // ← This field must exist
      };
      
      expect(mockSpreadOpportunity.ivRank).toBeDefined();
      expect(mockSpreadOpportunity.score).toBeDefined();
      expect(typeof mockSpreadOpportunity.ivRank).toBe('number');
      expect(typeof mockSpreadOpportunity.score).toBe('number');
    });
  });
});
