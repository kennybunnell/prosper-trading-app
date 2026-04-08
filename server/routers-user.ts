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
    const { canUseLiveTrading, getTierDisplayName, getTradableStrategies, getViewableStrategies, getEffectiveTier } = await import('./middleware/subscriptionEnforcement');
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

    // Resolve effective tier (VIP Mode overrides actual subscriptionTier)
    const effectiveTier = getEffectiveTier(user);
    const isVipActive = user.vipMode && (!user.vipExpiresAt || new Date(user.vipExpiresAt) > new Date());

    // Get remaining scans
    const scanInfo = await getRemainingScans(ctx.user.id, effectiveTier, user.role);

    // Check live trading access
    const liveTradingAccess = canUseLiveTrading(effectiveTier, user.role);

    // Get viewable and tradable strategies
    const viewableStrategies = getViewableStrategies(effectiveTier);
    const tradableStrategies = getTradableStrategies(effectiveTier, user.tradingMode);

    // Get API credentials status
    const credentials = await getApiCredentials(ctx.user.id);
    const hasCredentials = {
      tradier: !!credentials?.tradierApiKey,
      tastytrade: !!(credentials?.tastytradeClientSecret && credentials?.tastytradeRefreshToken),
    };

    return {
      tier: effectiveTier,
      actualTier: user.subscriptionTier,
      isVipActive: !!isVipActive,
      vipExpiresAt: user.vipExpiresAt ?? null,
      tierDisplayName: isVipActive ? 'VIP' : getTierDisplayName(effectiveTier),
      tradingMode: user.tradingMode,
      trialEndsAt: user.trialEndsAt,
      scansRemaining: scanInfo.remaining,
      scansLimit: scanInfo.limit,
      scansUsed: scanInfo.used,
      canUseLiveTrading: liveTradingAccess.allowed,
      liveTradingMessage: liveTradingAccess.upgradeMessage,
      viewableStrategies,
      tradableStrategies,
      hasCredentials,
    };
  }),
});
