/**
 * Unified User Onboarding Service
 * 
 * This service handles all aspects of new user onboarding, ensuring that
 * every new user gets a complete set of essential starter data.
 * 
 * The onboarding process is idempotent - it can be run multiple times safely
 * and will only create data that doesn't already exist.
 */

import { getDb } from './db';
import { filterPresets, watchlists } from '../drizzle/schema';
import { ONBOARDING_CONFIG } from './onboarding-config';
import { eq, and } from 'drizzle-orm';

/**
 * Result of an onboarding operation
 */
export interface OnboardingResult {
  success: boolean;
  userId: number;
  itemsCreated: {
    watchlistSymbols: number;
    cspPresets: number;
    ccPresets: number;
    pmccPresets: number;
    bpsPresets: number;
    bcsPresets: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Main onboarding function - seeds all essential data for a new user
 * 
 * This function is idempotent and safe to run multiple times.
 * It will only create data that doesn't already exist.
 * 
 * @param userId - The ID of the user to onboard
 * @returns OnboardingResult with details of what was created
 */
export async function onboardNewUser(userId: number): Promise<OnboardingResult> {
  console.log(`[Onboarding] Starting onboarding for user ${userId}`);
  
  const result: OnboardingResult = {
    success: true,
    userId,
    itemsCreated: {
      watchlistSymbols: 0,
      cspPresets: 0,
      ccPresets: 0,
      pmccPresets: 0,
      bpsPresets: 0,
      bcsPresets: 0,
    },
    errors: [],
    warnings: [],
  };

  try {
    // 1. Seed watchlist
    const watchlistResult = await seedWatchlist(userId);
    result.itemsCreated.watchlistSymbols = watchlistResult.created;
    if (watchlistResult.error) {
      result.errors.push(`Watchlist: ${watchlistResult.error}`);
    }
    if (watchlistResult.warning) {
      result.warnings.push(`Watchlist: ${watchlistResult.warning}`);
    }

    // 2. Seed CSP filter presets
    const cspResult = await seedFilterPresets(userId, 'csp', ONBOARDING_CONFIG.presets.csp);
    result.itemsCreated.cspPresets = cspResult.created;
    if (cspResult.error) {
      result.errors.push(`CSP Presets: ${cspResult.error}`);
    }
    if (cspResult.warning) {
      result.warnings.push(`CSP Presets: ${cspResult.warning}`);
    }

    // 3. Seed CC filter presets
    const ccResult = await seedFilterPresets(userId, 'cc', ONBOARDING_CONFIG.presets.cc);
    result.itemsCreated.ccPresets = ccResult.created;
    if (ccResult.error) {
      result.errors.push(`CC Presets: ${ccResult.error}`);
    }
    if (ccResult.warning) {
      result.warnings.push(`CC Presets: ${ccResult.warning}`);
    }

    // 4. Seed PMCC filter presets
    const pmccResult = await seedFilterPresets(userId, 'pmcc', ONBOARDING_CONFIG.presets.pmcc);
    result.itemsCreated.pmccPresets = pmccResult.created;
    if (pmccResult.error) {
      result.errors.push(`PMCC Presets: ${pmccResult.error}`);
    }
    if (pmccResult.warning) {
      result.warnings.push(`PMCC Presets: ${pmccResult.warning}`);
    }

    // 5. Seed BPS filter presets
    const bpsResult = await seedFilterPresets(userId, 'bps', ONBOARDING_CONFIG.presets.bps);
    result.itemsCreated.bpsPresets = bpsResult.created;
    if (bpsResult.error) {
      result.errors.push(`BPS Presets: ${bpsResult.error}`);
    }
    if (bpsResult.warning) {
      result.warnings.push(`BPS Presets: ${bpsResult.warning}`);
    }

    // 6. Seed BCS filter presets
    const bcsResult = await seedFilterPresets(userId, 'bcs', ONBOARDING_CONFIG.presets.bcs);
    result.itemsCreated.bcsPresets = bcsResult.created;
    if (bcsResult.error) {
      result.errors.push(`BCS Presets: ${bcsResult.error}`);
    }
    if (bcsResult.warning) {
      result.warnings.push(`BCS Presets: ${bcsResult.warning}`);
    }

    // Determine overall success
    result.success = result.errors.length === 0;

    // Log summary
    const totalItems = Object.values(result.itemsCreated).reduce((sum, count) => sum + count, 0);
    console.log(`[Onboarding] Completed for user ${userId}: ${totalItems} items created, ${result.errors.length} errors, ${result.warnings.length} warnings`);
    
    if (result.errors.length > 0) {
      console.error(`[Onboarding] Errors:`, result.errors);
    }
    if (result.warnings.length > 0) {
      console.warn(`[Onboarding] Warnings:`, result.warnings);
    }

  } catch (error) {
    result.success = false;
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[Onboarding] Fatal error for user ${userId}:`, error);
  }

  return result;
}

/**
 * Seed watchlist symbols for a user
 */
async function seedWatchlist(userId: number): Promise<{ created: number; error?: string; warning?: string }> {
  try {
    // Check if user already has watchlist items
    const db = await getDb();
    if (!db) {
      return { created: 0, error: 'Database not available' };
    }
    const existing = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      return {
        created: 0,
        warning: 'User already has watchlist items, skipping',
      };
    }

    // Insert all default watchlist symbols
    const symbols = ONBOARDING_CONFIG.watchlist;
    const records = symbols.map((symbol) => ({
      userId,
      symbol,
      strategy: 'csp' as const, // Default strategy for watchlist
      createdAt: new Date(),
    }));

    await db.insert(watchlists).values(records);

    console.log(`[Onboarding] Created ${symbols.length} watchlist symbols for user ${userId}`);
    return { created: symbols.length };

  } catch (error) {
    console.error(`[Onboarding] Error seeding watchlist for user ${userId}:`, error);
    return {
      created: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Seed filter presets for a specific strategy
 */
async function seedFilterPresets(
  userId: number,
  strategy: 'csp' | 'cc' | 'pmcc' | 'bps' | 'bcs',
  presetConfig: Record<string, any>
): Promise<{ created: number; error?: string; warning?: string }> {
  try {
    const db = await getDb();
    if (!db) {
      return { created: 0, error: 'Database not available' };
    }
    // Check if user already has presets for this strategy
    const existing = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.strategy, strategy)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        created: 0,
        warning: `User already has ${strategy.toUpperCase()} presets, skipping`,
      };
    }

    // Insert all three presets (conservative, medium, aggressive)
    const presets = ['conservative', 'medium', 'aggressive'] as const;
    const records = presets.map((presetName) => {
      const config = presetConfig[presetName];
      return {
        userId,
        strategy,
        presetName,
        minDte: config.minDte,
        maxDte: config.maxDte,
        minDelta: config.minDelta,
        maxDelta: config.maxDelta,
        minOpenInterest: config.minOpenInterest,
        minVolume: config.minVolume,
        minRsi: config.minRsi,
        maxRsi: config.maxRsi,
        minIvRank: config.minIvRank,
        maxIvRank: config.maxIvRank,
        minBbPercent: config.minBbPercent,
        maxBbPercent: config.maxBbPercent,
        minScore: config.minScore,
        maxStrikePercent: config.maxStrikePercent,
      };
    });

    await db.insert(filterPresets).values(records);

    console.log(`[Onboarding] Created ${presets.length} ${strategy.toUpperCase()} presets for user ${userId}`);
    return { created: presets.length };

  } catch (error) {
    console.error(`[Onboarding] Error seeding ${strategy.toUpperCase()} presets for user ${userId}:`, error);
    return {
      created: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a user has been onboarded
 * 
 * A user is considered onboarded if they have:
 * - At least one watchlist symbol
 * - At least one filter preset for any strategy
 * 
 * @param userId - The ID of the user to check
 * @returns true if user has been onboarded, false otherwise
 */
export async function isUserOnboarded(userId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      return false;
    }
    // Check for watchlist
    const watchlistCount = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .limit(1);

    // Check for presets
    const presetsCount = await db
      .select()
      .from(filterPresets)
      .where(eq(filterPresets.userId, userId))
      .limit(1);

    return watchlistCount.length > 0 && presetsCount.length > 0;

  } catch (error) {
    console.error(`[Onboarding] Error checking onboarding status for user ${userId}:`, error);
    return false;
  }
}

/**
 * Get onboarding status for a user
 * 
 * @param userId - The ID of the user to check
 * @returns Detailed onboarding status
 */
export async function getOnboardingStatus(userId: number): Promise<{
  isOnboarded: boolean;
  hasWatchlist: boolean;
  presetCounts: {
    csp: number;
    cc: number;
    pmcc: number;
    bps: number;
    bcs: number;
  };
}> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        isOnboarded: false,
        hasWatchlist: false,
        presetCounts: { csp: 0, cc: 0, pmcc: 0, bps: 0, bcs: 0 },
      };
    }
    // Check watchlist
    const watchlistItems = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId));

    // Check presets for each strategy
    const cspPresets = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.strategy, 'csp')
        )
      );

    const ccPresets = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.strategy, 'cc')
        )
      );

    const pmccPresets = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.strategy, 'pmcc')
        )
      );

    const bpsPresets = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.strategy, 'bps')
        )
      );

    const bcsPresets = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.strategy, 'bcs')
        )
      );

    const hasWatchlist = watchlistItems.length > 0;
    const hasPresets = cspPresets.length > 0 || ccPresets.length > 0 || pmccPresets.length > 0 || bpsPresets.length > 0 || bcsPresets.length > 0;

    return {
      isOnboarded: hasWatchlist && hasPresets,
      hasWatchlist,
      presetCounts: {
        csp: cspPresets.length,
        cc: ccPresets.length,
        pmcc: pmccPresets.length,
        bps: bpsPresets.length,
        bcs: bcsPresets.length,
      },
    };

  } catch (error) {
    console.error(`[Onboarding] Error getting onboarding status for user ${userId}:`, error);
    return {
      isOnboarded: false,
      hasWatchlist: false,
      presetCounts: {
        csp: 0,
        cc: 0,
        pmcc: 0,
        bps: 0,
        bcs: 0,
      },
    };
  }
}
