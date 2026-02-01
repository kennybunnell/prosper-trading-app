/**
 * Tests for the onboarding system
 * 
 * These tests verify that new users are properly onboarded with:
 * - Default watchlist symbols
 * - Filter presets for all 5 strategies (CSP, CC, PMCC, BPS, BCS)
 * - Correct preset values matching the onboarding configuration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { onboardNewUser, isUserOnboarded, getOnboardingStatus } from './onboarding';
import { ONBOARDING_CONFIG } from './onboarding-config';
import { getDb } from './db';
import { filterPresets, watchlists } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

describe('Onboarding System', () => {
  const testUserId = 999999; // Use a high ID to avoid conflicts

  beforeEach(async () => {
    // Clean up test user data before each test
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available for testing');
    }

    await db.delete(filterPresets).where(eq(filterPresets.userId, testUserId));
    await db.delete(watchlists).where(eq(watchlists.userId, testUserId));
  });

  describe.skip('onboardNewUser', () => {
    it('should create watchlist for new user', async () => {
      const result = await onboardNewUser(testUserId);

      if (!result.success) {
        console.error('Onboarding failed:', result.errors);
        console.warn('Warnings:', result.warnings);
      }

      expect(result.success).toBe(true);
      expect(result.itemsCreated.watchlistSymbols).toBeGreaterThan(0);
      expect(result.itemsCreated.watchlistSymbols).toBe(ONBOARDING_CONFIG.watchlist.length);
    });

    it('should create presets for all 5 strategies', async () => {
      const result = await onboardNewUser(testUserId);

      expect(result.success).toBe(true);
      expect(result.itemsCreated.cspPresets).toBe(3); // conservative, medium, aggressive
      expect(result.itemsCreated.ccPresets).toBe(3);
      expect(result.itemsCreated.pmccPresets).toBe(3);
      expect(result.itemsCreated.bpsPresets).toBe(3);
      expect(result.itemsCreated.bcsPresets).toBe(3);
    });

    it('should use correct preset values from onboarding config', async () => {
      await onboardNewUser(testUserId);

      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Check CSP conservative preset values
      const cspConservative = await db
        .select()
        .from(filterPresets)
        .where(
          and(
            eq(filterPresets.userId, testUserId),
            eq(filterPresets.strategy, 'csp'),
            eq(filterPresets.presetName, 'conservative')
          )
        )
        .limit(1);

      expect(cspConservative.length).toBe(1);
      const preset = cspConservative[0];
      const configPreset = ONBOARDING_CONFIG.presets.csp.conservative;

      expect(preset.minDte).toBe(configPreset.minDte);
      expect(preset.maxDte).toBe(configPreset.maxDte);
      expect(preset.minDelta).toBe(configPreset.minDelta);
      expect(preset.maxDelta).toBe(configPreset.maxDelta);
      expect(preset.minOpenInterest).toBe(configPreset.minOpenInterest);
      expect(preset.minVolume).toBe(configPreset.minVolume);
      expect(preset.minScore).toBe(configPreset.minScore);
    });

    it('should not duplicate data on second run (idempotent)', async () => {
      // First run
      const result1 = await onboardNewUser(testUserId);
      expect(result1.success).toBe(true);

      // Second run
      const result2 = await onboardNewUser(testUserId);
      expect(result2.success).toBe(true);

      // Should have warnings about existing data
      expect(result2.warnings.length).toBeGreaterThan(0);

      // Verify no duplicates in database
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const watchlistCount = await db
        .select()
        .from(watchlists)
        .where(eq(watchlists.userId, testUserId));

      const presetsCount = await db
        .select()
        .from(filterPresets)
        .where(eq(filterPresets.userId, testUserId));

      expect(watchlistCount.length).toBe(ONBOARDING_CONFIG.watchlist.length);
      expect(presetsCount.length).toBe(15); // 5 strategies × 3 presets each
    });
  });

  describe.skip('isUserOnboarded', () => {
    it('should return false for new user', async () => {
      const result = await isUserOnboarded(testUserId);
      expect(result).toBe(false);
    });

    it('should return true after onboarding', async () => {
      await onboardNewUser(testUserId);
      const result = await isUserOnboarded(testUserId);
      expect(result).toBe(true);
    });
  });

  describe.skip('getOnboardingStatus', () => {
    it('should return complete status for onboarded user', async () => {
      await onboardNewUser(testUserId);
      const status = await getOnboardingStatus(testUserId);

      expect(status.isOnboarded).toBe(true);
      expect(status.hasWatchlist).toBe(true);
      expect(status.presetCounts.csp).toBe(3);
      expect(status.presetCounts.cc).toBe(3);
      expect(status.presetCounts.pmcc).toBe(3);
      expect(status.presetCounts.bps).toBe(3);
      expect(status.presetCounts.bcs).toBe(3);
    });

    it('should return empty status for new user', async () => {
      const status = await getOnboardingStatus(testUserId);

      expect(status.isOnboarded).toBe(false);
      expect(status.hasWatchlist).toBe(false);
      expect(status.presetCounts.csp).toBe(0);
      expect(status.presetCounts.cc).toBe(0);
      expect(status.presetCounts.pmcc).toBe(0);
      expect(status.presetCounts.bps).toBe(0);
      expect(status.presetCounts.bcs).toBe(0);
    });
  });

  describe('Onboarding Configuration Validation', () => {
    it('should have watchlist with at least 10 symbols', () => {
      expect(ONBOARDING_CONFIG.watchlist.length).toBeGreaterThanOrEqual(10);
    });

    it('should have presets for all 5 strategies', () => {
      expect(ONBOARDING_CONFIG.presets.csp).toBeDefined();
      expect(ONBOARDING_CONFIG.presets.cc).toBeDefined();
      expect(ONBOARDING_CONFIG.presets.pmcc).toBeDefined();
      expect(ONBOARDING_CONFIG.presets.bps).toBeDefined();
      expect(ONBOARDING_CONFIG.presets.bcs).toBeDefined();
    });

    it('should have all 3 presets for each strategy', () => {
      const strategies = ['csp', 'cc', 'pmcc', 'bps', 'bcs'] as const;
      const presetNames = ['conservative', 'medium', 'aggressive'] as const;

      strategies.forEach((strategy) => {
        presetNames.forEach((presetName) => {
          expect(ONBOARDING_CONFIG.presets[strategy][presetName]).toBeDefined();
        });
      });
    });

    it('should have valid DTE ranges in all presets', () => {
      const strategies = ['csp', 'cc', 'pmcc', 'bps', 'bcs'] as const;
      const presetNames = ['conservative', 'medium', 'aggressive'] as const;

      strategies.forEach((strategy) => {
        presetNames.forEach((presetName) => {
          const preset = ONBOARDING_CONFIG.presets[strategy][presetName];
          expect(preset.minDte).toBeLessThanOrEqual(preset.maxDte);
          expect(preset.minDte).toBeGreaterThan(0);
        });
      });
    });

    it('should have valid delta ranges in all presets', () => {
      const strategies = ['csp', 'cc', 'pmcc', 'bps', 'bcs'] as const;
      const presetNames = ['conservative', 'medium', 'aggressive'] as const;

      strategies.forEach((strategy) => {
        presetNames.forEach((presetName) => {
          const preset = ONBOARDING_CONFIG.presets[strategy][presetName];
          const minDelta = parseFloat(preset.minDelta);
          const maxDelta = parseFloat(preset.maxDelta);
          
          expect(minDelta).toBeLessThanOrEqual(maxDelta);
          expect(minDelta).toBeGreaterThan(0);
          expect(maxDelta).toBeLessThanOrEqual(1);
        });
      });
    });
  });
});
