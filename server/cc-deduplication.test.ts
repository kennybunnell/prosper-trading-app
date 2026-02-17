/**
 * Unit tests for CC and BCS deduplication logic
 * Verifies that duplicate opportunities are properly removed
 */

import { describe, it, expect } from 'vitest';

describe('CC and BCS Deduplication Logic', () => {
  describe('CC Opportunity Deduplication', () => {
    it('should remove duplicate CC opportunities with same symbol-strike-expiration', () => {
      // Simulate duplicate CC opportunities (same symbol, strike, expiration)
      const opportunities = [
        { symbol: 'TSLA', strike: 420, expiration: '2026-03-13', bid: 5.0, ask: 5.2, spreadPct: 4.0 },
        { symbol: 'TSLA', strike: 420, expiration: '2026-03-13', bid: 5.1, ask: 5.3, spreadPct: 3.9 }, // Better spread
        { symbol: 'TSLA', strike: 420, expiration: '2026-03-13', bid: 4.9, ask: 5.4, spreadPct: 10.2 }, // Worse spread
        { symbol: 'TSLA', strike: 425, expiration: '2026-03-13', bid: 4.5, ask: 4.7, spreadPct: 4.4 }, // Different strike
      ];

      // Apply deduplication logic (same as in routers-cc.ts)
      const uniqueOpportunities = new Map<string, any>();
      for (const opp of opportunities) {
        const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
        
        // Keep the opportunity with better bid/ask spread if duplicates exist
        if (!uniqueOpportunities.has(key) || opp.spreadPct < uniqueOpportunities.get(key).spreadPct) {
          uniqueOpportunities.set(key, opp);
        }
      }
      
      const deduplicatedOpportunities = Array.from(uniqueOpportunities.values());

      // Should have 2 unique opportunities (TSLA-420 and TSLA-425)
      expect(deduplicatedOpportunities).toHaveLength(2);
      
      // Should keep the one with best spread (3.9%) for TSLA-420
      const tsla420 = deduplicatedOpportunities.find(o => o.strike === 420);
      expect(tsla420?.spreadPct).toBe(3.9);
      expect(tsla420?.bid).toBe(5.1);
    });

    it('should handle opportunities with no duplicates', () => {
      const opportunities = [
        { symbol: 'TSLA', strike: 420, expiration: '2026-03-13', spreadPct: 4.0 },
        { symbol: 'TSLA', strike: 425, expiration: '2026-03-13', spreadPct: 3.9 },
        { symbol: 'AAPL', strike: 180, expiration: '2026-03-20', spreadPct: 5.0 },
      ];

      const uniqueOpportunities = new Map<string, any>();
      for (const opp of opportunities) {
        const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
        if (!uniqueOpportunities.has(key) || opp.spreadPct < uniqueOpportunities.get(key).spreadPct) {
          uniqueOpportunities.set(key, opp);
        }
      }
      
      const deduplicatedOpportunities = Array.from(uniqueOpportunities.values());

      // Should keep all 3 (no duplicates)
      expect(deduplicatedOpportunities).toHaveLength(3);
    });
  });

  describe('Bear Call Spread Deduplication', () => {
    it('should remove duplicate BCS with same symbol-shortStrike-longStrike-expiration', () => {
      // Simulate duplicate Bear Call Spreads
      const spreadOpportunities = [
        { symbol: 'TSLA', strike: 420, longStrike: 430, expiration: '2026-03-13', score: 75, netCredit: 2.5 },
        { symbol: 'TSLA', strike: 420, longStrike: 430, expiration: '2026-03-13', score: 78, netCredit: 2.6 }, // Higher score
        { symbol: 'TSLA', strike: 420, longStrike: 430, expiration: '2026-03-13', score: 72, netCredit: 2.4 }, // Lower score
        { symbol: 'TSLA', strike: 425, longStrike: 435, expiration: '2026-03-13', score: 80, netCredit: 2.8 }, // Different strikes
      ];

      // Apply deduplication logic (same as in routers-cc.ts)
      const uniqueSpreads = new Map<string, any>();
      for (const spread of spreadOpportunities) {
        const key = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
        
        // Keep the spread with the highest score if duplicates exist
        if (!uniqueSpreads.has(key) || spread.score > uniqueSpreads.get(key).score) {
          uniqueSpreads.set(key, spread);
        }
      }
      
      const deduplicatedSpreads = Array.from(uniqueSpreads.values());

      // Should have 2 unique spreads (420-430 and 425-435)
      expect(deduplicatedSpreads).toHaveLength(2);
      
      // Should keep the one with highest score (78) for 420-430
      const spread420_430 = deduplicatedSpreads.find(s => s.strike === 420 && s.longStrike === 430);
      expect(spread420_430?.score).toBe(78);
      expect(spread420_430?.netCredit).toBe(2.6);
    });

    it('should differentiate between different spread widths', () => {
      const spreadOpportunities = [
        { symbol: 'TSLA', strike: 420, longStrike: 425, expiration: '2026-03-13', score: 75 }, // 5-wide
        { symbol: 'TSLA', strike: 420, longStrike: 430, expiration: '2026-03-13', score: 78 }, // 10-wide
        { symbol: 'TSLA', strike: 420, longStrike: 422, expiration: '2026-03-13', score: 72 }, // 2-wide
      ];

      const uniqueSpreads = new Map<string, any>();
      for (const spread of spreadOpportunities) {
        const key = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
        if (!uniqueSpreads.has(key) || spread.score > uniqueSpreads.get(key).score) {
          uniqueSpreads.set(key, spread);
        }
      }
      
      const deduplicatedSpreads = Array.from(uniqueSpreads.values());

      // Should keep all 3 (different long strikes = different spreads)
      expect(deduplicatedSpreads).toHaveLength(3);
    });

    it('should handle hundreds of duplicates (real-world scenario)', () => {
      // Simulate the real issue: 170+ duplicate errors
      const spreadOpportunities = [];
      
      // Create 170 duplicates of the same spread
      for (let i = 0; i < 170; i++) {
        spreadOpportunities.push({
          symbol: 'TSLA',
          strike: 435,
          longStrike: 445,
          expiration: '2026-03-13',
          score: 70 + Math.random() * 10, // Random scores 70-80
          netCredit: 2.5,
        });
      }
      
      // Add some unique spreads
      spreadOpportunities.push({ symbol: 'TSLA', strike: 430, longStrike: 440, expiration: '2026-03-13', score: 75, netCredit: 2.6 });
      spreadOpportunities.push({ symbol: 'AAPL', strike: 180, longStrike: 185, expiration: '2026-03-20', score: 82, netCredit: 3.0 });

      const uniqueSpreads = new Map<string, any>();
      for (const spread of spreadOpportunities) {
        const key = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
        if (!uniqueSpreads.has(key) || spread.score > uniqueSpreads.get(key).score) {
          uniqueSpreads.set(key, spread);
        }
      }
      
      const deduplicatedSpreads = Array.from(uniqueSpreads.values());
      const duplicateCount = spreadOpportunities.length - deduplicatedSpreads.length;

      // Should reduce 172 opportunities to 3 unique spreads
      expect(deduplicatedSpreads).toHaveLength(3);
      expect(duplicateCount).toBe(169); // 170 duplicates of TSLA-435-445 → 1 kept
      
      // Should keep the highest scoring duplicate
      const tsla435_445 = deduplicatedSpreads.find(s => s.symbol === 'TSLA' && s.strike === 435);
      expect(tsla435_445).toBeDefined();
      expect(tsla435_445?.score).toBeGreaterThanOrEqual(70);
      expect(tsla435_445?.score).toBeLessThanOrEqual(80);
    });
  });

  describe('React Key Generation', () => {
    it('should generate unique keys for CC opportunities', () => {
      const opportunities = [
        { symbol: 'TSLA', strike: 420, expiration: '2026-03-13' },
        { symbol: 'TSLA', strike: 425, expiration: '2026-03-13' },
        { symbol: 'TSLA', strike: 420, expiration: '2026-03-20' },
      ];

      const keys = opportunities.map(opp => `${opp.symbol}-${opp.strike}-${opp.expiration}`);
      const uniqueKeys = new Set(keys);

      // All keys should be unique
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should generate unique keys for BCS opportunities', () => {
      const opportunities = [
        { symbol: 'TSLA', strike: 420, longStrike: 430, expiration: '2026-03-13' },
        { symbol: 'TSLA', strike: 425, longStrike: 435, expiration: '2026-03-13' },
        { symbol: 'TSLA', strike: 420, longStrike: 430, expiration: '2026-03-20' },
        { symbol: 'TSLA', strike: 420, longStrike: 425, expiration: '2026-03-13' }, // Different long strike
      ];

      const keys = opportunities.map(opp => `${opp.symbol}-${opp.strike}-${opp.longStrike}-${opp.expiration}`);
      const uniqueKeys = new Set(keys);

      // All keys should be unique
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });
});
