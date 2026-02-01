/**
 * Admin Router - Administrative utilities for managing users and system configuration
 * 
 * This router provides admin-only endpoints for:
 * - Checking user onboarding status
 * - Manually triggering onboarding for users
 * - Exporting user data as templates
 * - Validating onboarding configuration
 */

import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// Admin-only procedure wrapper
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
  return next({ ctx });
});

export const adminRouter = router({
  /**
   * Get onboarding status for a specific user
   */
  getOnboardingStatus: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const { getOnboardingStatus } = await import('./onboarding');
      return getOnboardingStatus(input.userId);
    }),

  /**
   * Manually trigger onboarding for a user
   */
  triggerOnboarding: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const { onboardNewUser } = await import('./onboarding');
      return onboardNewUser(input.userId);
    }),

  /**
   * Export current user's data as onboarding template
   * This allows admins to export their configured presets/watchlist as the new default
   */
  exportAsTemplate: adminProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const { filterPresets, watchlists } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');

    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database not available',
      });
    }

    // Export user's presets
    const userPresets = await db
      .select()
      .from(filterPresets)
      .where(eq(filterPresets.userId, ctx.user.id));

    // Export user's watchlist
    const userWatchlist = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, ctx.user.id));

    // Group presets by strategy
    const presetsByStrategy = {
      csp: {} as any,
      cc: {} as any,
      pmcc: {} as any,
      bps: {} as any,
      bcs: {} as any,
    };

    userPresets.forEach((preset) => {
      const strategy = preset.strategy;
      const presetName = preset.presetName;
      
      presetsByStrategy[strategy][presetName] = {
        minDte: preset.minDte,
        maxDte: preset.maxDte,
        minDelta: preset.minDelta,
        maxDelta: preset.maxDelta,
        minOpenInterest: preset.minOpenInterest,
        minVolume: preset.minVolume,
        minRsi: preset.minRsi,
        maxRsi: preset.maxRsi,
        minIvRank: preset.minIvRank,
        maxIvRank: preset.maxIvRank,
        minBbPercent: preset.minBbPercent,
        maxBbPercent: preset.maxBbPercent,
        minScore: preset.minScore,
        maxStrikePercent: preset.maxStrikePercent,
      };
    });

    // Extract unique watchlist symbols
    const watchlistSymbols = Array.from(new Set(userWatchlist.map((item) => item.symbol)));

    return {
      presets: presetsByStrategy,
      watchlist: watchlistSymbols,
      exportedAt: new Date().toISOString(),
      exportedBy: ctx.user.id,
    };
  }),

  /**
   * Validate onboarding configuration
   * Checks that all required data is present in the onboarding config
   */
  validateOnboardingConfig: adminProcedure.query(async () => {
    const { ONBOARDING_CONFIG } = await import('./onboarding-config');

    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate watchlist
    if (!ONBOARDING_CONFIG.watchlist || ONBOARDING_CONFIG.watchlist.length === 0) {
      errors.push('Watchlist is empty');
    }

    // Validate presets for each strategy
    const strategies = ['csp', 'cc', 'pmcc', 'bps', 'bcs'] as const;
    const presetNames = ['conservative', 'medium', 'aggressive'] as const;

    strategies.forEach((strategy) => {
      const strategyPresets = ONBOARDING_CONFIG.presets[strategy];
      if (!strategyPresets) {
        errors.push(`Missing presets for strategy: ${strategy}`);
        return;
      }

      presetNames.forEach((presetName) => {
        const preset = strategyPresets[presetName];
        if (!preset) {
          errors.push(`Missing ${presetName} preset for ${strategy}`);
          return;
        }

        // Validate required fields
        const requiredFields = [
          'minDte', 'maxDte', 'minDelta', 'maxDelta',
          'minOpenInterest', 'minVolume', 'minScore', 'maxStrikePercent'
        ];

        requiredFields.forEach((field) => {
          const value = (preset as any)[field];
          if (value === undefined || value === null) {
            errors.push(`Missing ${field} in ${strategy}.${presetName}`);
          }
        });

        // Validate ranges
        if (preset.minDte > preset.maxDte) {
          warnings.push(`Invalid DTE range in ${strategy}.${presetName}: min > max`);
        }
        if (parseFloat(preset.minDelta) > parseFloat(preset.maxDelta)) {
          warnings.push(`Invalid delta range in ${strategy}.${presetName}: min > max`);
        }
      });
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      config: ONBOARDING_CONFIG,
    };
  }),
});
