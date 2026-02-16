/**
 * Admin Router - Administrative utilities for managing users and system configuration
 * 
 * This router provides admin-only endpoints for:
 * - User management (list, detail, delete, reset, tier upgrade)
 * - Broadcast communications
 * - Feedback/support system
 * - Analytics and activity tracking
 * - Onboarding management
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
  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * List all users with optional filtering
   */
  listUsers: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      tier: z.enum(['free_trial', 'wheel_view', 'wheel_trading', 'advanced']).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { users } = await import('../drizzle/schema');
      const { like, eq, desc, or } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      let query = db.select().from(users);

      // Apply search filter
      if (input.search) {
        query = query.where(
          or(
            like(users.name, `%${input.search}%`),
            like(users.email, `%${input.search}%`)
          )
        ) as any;
      }

      // Apply tier filter
      if (input.tier) {
        query = query.where(eq(users.subscriptionTier, input.tier)) as any;
      }

      const results = await query
        .orderBy(desc(users.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return results;
    }),

  /**
   * Get detailed user information
   */
  getUserDetail: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { users, userActivity } = await import('../drizzle/schema');
      const { eq, desc, sql } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user || user.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Get recent activity
      const recentActivity = await db
        .select()
        .from(userActivity)
        .where(eq(userActivity.userId, input.userId))
        .orderBy(desc(userActivity.createdAt))
        .limit(20);

      // Get activity stats
      const activityStats = await db
        .select({
          activityType: userActivity.activityType,
          count: sql<number>`count(*)`
        })
        .from(userActivity)
        .where(eq(userActivity.userId, input.userId))
        .groupBy(userActivity.activityType);

      return {
        user: user[0],
        recentActivity,
        activityStats,
      };
    }),

  /**
   * Delete user and all related data
   */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete your own account',
        });
      }

      const { getDb } = await import('./db');
      const { users } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      await db.delete(users).where(eq(users.id, input.userId));

      return { success: true };
    }),

  /**
   * Reset user data (clear watchlist, presets, trades, positions)
   */
  resetUserData: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { watchlists, filterPresets, trades, positions, userActivity } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Delete all user data
      await db.delete(watchlists).where(eq(watchlists.userId, input.userId));
      await db.delete(filterPresets).where(eq(filterPresets.userId, input.userId));
      await db.delete(trades).where(eq(trades.userId, input.userId));
      await db.delete(positions).where(eq(positions.userId, input.userId));
      await db.delete(userActivity).where(eq(userActivity.userId, input.userId));

      // Trigger onboarding to re-seed default data
      const { onboardNewUser } = await import('./onboarding');
      await onboardNewUser(input.userId);

      return { success: true };
    }),

  /**
   * Upgrade user subscription tier
   */
  upgradeUserTier: adminProcedure
    .input(z.object({
      userId: z.number(),
      tier: z.enum(['free_trial', 'wheel_view', 'wheel_trading', 'advanced']),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { users } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      await db.update(users)
        .set({ subscriptionTier: input.tier })
        .where(eq(users.id, input.userId));

      return { success: true };
    }),

  // ============================================
  // ONBOARDING MANAGEMENT
  // ============================================
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

  // ============================================
  // BROADCAST COMMUNICATIONS
  // ============================================

  /**
   * Send broadcast message to users
   */
  sendBroadcast: adminProcedure
    .input(z.object({
      title: z.string(),
      message: z.string(),
      videoUrl: z.string().optional(),
      targetTier: z.enum(['all', 'free_trial', 'wheel_view', 'wheel_trading', 'advanced']).default('all'),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import('./db');
      const { users, broadcasts } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { notifyOwner } = await import('./_core/notification');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Get target users
      let targetUsers;
      if (input.targetTier === 'all') {
        targetUsers = await db.select().from(users);
      } else {
        targetUsers = await db.select().from(users).where(eq(users.subscriptionTier, input.targetTier));
      }

      // Send notifications to all target users
      for (const user of targetUsers) {
        await notifyOwner({
          title: input.title,
          content: input.message,
        });
      }

      // Record broadcast in database
      await db.insert(broadcasts).values({
        sentByAdminId: ctx.user.id,
        targetTier: input.targetTier,
        title: input.title,
        message: input.message,
        videoUrl: input.videoUrl,
        recipientCount: targetUsers.length,
      });

      return {
        success: true,
        recipientCount: targetUsers.length,
      };
    }),

  /**
   * Get broadcast history
   */
  getBroadcastHistory: adminProcedure
    .input(z.object({
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { broadcasts } = await import('../drizzle/schema');
      const { desc } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      const results = await db
        .select()
        .from(broadcasts)
        .orderBy(desc(broadcasts.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return results;
    }),

  // ============================================
  // FEEDBACK & SUPPORT SYSTEM
  // ============================================

  /**
   * Get all feedback with filtering
   */
  listFeedback: adminProcedure
    .input(z.object({
      status: z.enum(['new', 'in_progress', 'resolved', 'closed']).optional(),
      type: z.enum(['bug', 'feature', 'question', 'feedback']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { feedback, users } = await import('../drizzle/schema');
      const { eq, desc, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      const conditions = [];
      if (input.status) conditions.push(eq(feedback.status, input.status));
      if (input.type) conditions.push(eq(feedback.type, input.type));
      if (input.priority) conditions.push(eq(feedback.priority, input.priority));

      let query = db
        .select({
          feedback,
          user: users,
        })
        .from(feedback)
        .leftJoin(users, eq(feedback.userId, users.id))
        .orderBy(desc(feedback.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      return await query;
    }),

  /**
   * Get feedback detail with replies
   */
  getFeedbackDetail: adminProcedure
    .input(z.object({ feedbackId: z.number() }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { feedback, feedbackReplies, users } = await import('../drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      const feedbackItem = await db
        .select({
          feedback,
          user: users,
        })
        .from(feedback)
        .leftJoin(users, eq(feedback.userId, users.id))
        .where(eq(feedback.id, input.feedbackId))
        .limit(1);

      if (!feedbackItem || feedbackItem.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        });
      }

      const replies = await db
        .select({
          reply: feedbackReplies,
          user: users,
        })
        .from(feedbackReplies)
        .leftJoin(users, eq(feedbackReplies.userId, users.id))
        .where(eq(feedbackReplies.feedbackId, input.feedbackId))
        .orderBy(feedbackReplies.createdAt);

      return {
        ...feedbackItem[0],
        replies,
      };
    }),

  /**
   * Reply to feedback
   */
  replyToFeedback: adminProcedure
    .input(z.object({
      feedbackId: z.number(),
      message: z.string(),
      videoUrl: z.string().optional(),
      isInternalNote: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import('./db');
      const { feedbackReplies, feedback } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { notifyOwner } = await import('./_core/notification');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Insert reply
      await db.insert(feedbackReplies).values({
        feedbackId: input.feedbackId,
        userId: ctx.user.id,
        isAdminReply: true,
        message: input.message,
        videoUrl: input.videoUrl,
        isInternalNote: input.isInternalNote,
      });

      // Update feedback status to in_progress if it was new
      const feedbackItem = await db.select().from(feedback).where(eq(feedback.id, input.feedbackId)).limit(1);
      if (feedbackItem[0]?.status === 'new') {
        await db.update(feedback)
          .set({ status: 'in_progress' })
          .where(eq(feedback.id, input.feedbackId));
      }

      // Notify user (if not internal note)
      if (!input.isInternalNote) {
        await notifyOwner({
          title: 'Admin replied to your feedback',
          content: input.message,
        });
      }

      return { success: true };
    }),

  /**
   * Update feedback status
   */
  updateFeedbackStatus: adminProcedure
    .input(z.object({
      feedbackId: z.number(),
      status: z.enum(['new', 'in_progress', 'resolved', 'closed']),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { feedback } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      const updateData: any = { status: input.status };
      if (input.status === 'resolved' || input.status === 'closed') {
        updateData.resolvedAt = new Date();
      }

      await db.update(feedback)
        .set(updateData)
        .where(eq(feedback.id, input.feedbackId));

      return { success: true };
    }),

  // ============================================
  // ANALYTICS & ACTIVITY TRACKING
  // ============================================

  /**
   * Get overview analytics
   */
  getAnalyticsOverview: adminProcedure.query(async () => {
    const { getDb } = await import('./db');
    const { users, userActivity } = await import('../drizzle/schema');
    const { sql, gte, eq, and } = await import('drizzle-orm');

    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database not available',
      });
    }

    // Total users by tier
    const usersByTier = await db
      .select({
        tier: users.subscriptionTier,
        count: sql<number>`count(*)`
      })
      .from(users)
      .groupBy(users.subscriptionTier);

    // Active users (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeUsers7d = await db
      .select({ count: sql<number>`count(distinct ${userActivity.userId})` })
      .from(userActivity)
      .where(gte(userActivity.createdAt, sevenDaysAgo));

    // Active users (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeUsers30d = await db
      .select({ count: sql<number>`count(distinct ${userActivity.userId})` })
      .from(userActivity)
      .where(gte(userActivity.createdAt, thirtyDaysAgo));

    // New registrations (this week)
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const newUsersThisWeek = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.createdAt, startOfWeek));

    // Trial expirations (next 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const expiringTrials = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(
        and(
          eq(users.subscriptionTier, 'free_trial'),
          gte(users.trialEndsAt, new Date()),
          sql`${users.trialEndsAt} <= ${sevenDaysFromNow}`
        )
      );

    return {
      usersByTier,
      activeUsers7d: activeUsers7d[0]?.count || 0,
      activeUsers30d: activeUsers30d[0]?.count || 0,
      newUsersThisWeek: newUsersThisWeek[0]?.count || 0,
      expiringTrials: expiringTrials[0]?.count || 0,
    };
  }),
});
