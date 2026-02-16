import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const userRouter = router({
  /**
   * Set user's trading mode (live or paper)
   */
  setTradingMode: protectedProcedure
    .input(
      z.object({
        mode: z.enum(['live', 'paper']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      await db
        .update(users)
        .set({ tradingMode: input.mode })
        .where(eq(users.id, ctx.user.id));

      return { success: true, mode: input.mode };
    }),

  /**
   * Get user's subscription status and rate limit information
   */
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    const { getRemainingScans } = await import('./middleware/rateLimiting');
    const { canUseLiveTrading, getTierDisplayName, getAvailableStrategies } = await import('./middleware/subscriptionEnforcement');
    const { getApiCredentials } = await import('./db');
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Get user data
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!user) {
      throw new Error('User not found');
    }

    // Get remaining scans
    const scanInfo = await getRemainingScans(ctx.user.id, user.subscriptionTier, user.role);

    // Check live trading access
    const liveTradingAccess = canUseLiveTrading(user.subscriptionTier, user.role);

    // Get available strategies
    const availableStrategies = getAvailableStrategies(user.subscriptionTier, user.tradingMode);

    // Get API credentials status
    const credentials = await getApiCredentials(ctx.user.id);
    const hasCredentials = {
      tradier: !!credentials?.tradierApiKey,
      tastytrade: !!(credentials?.tastytradeClientSecret && credentials?.tastytradeRefreshToken),
    };

    return {
      tier: user.subscriptionTier,
      tierDisplayName: getTierDisplayName(user.subscriptionTier),
      tradingMode: user.tradingMode,
      trialEndsAt: user.trialEndsAt,
      scansRemaining: scanInfo.remaining,
      scansLimit: scanInfo.limit,
      scansUsed: scanInfo.used,
      canUseLiveTrading: liveTradingAccess.allowed,
      liveTradingMessage: liveTradingAccess.upgradeMessage,
      availableStrategies,
      hasCredentials,
    };
  }),
});
