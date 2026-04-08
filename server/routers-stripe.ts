import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { STRIPE_PRODUCTS, TIER_TO_PRODUCT, calculateSetupFees, type SubscriptionTier } from "../shared/products";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
});

export const stripeRouter = router({
  /**
   * Get current subscription status
   */
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const { users } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const user = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!user[0]) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    const userData = user[0];
    const isVipActive = userData.vipMode && (!userData.vipExpiresAt || new Date(userData.vipExpiresAt) > new Date());
    
    return {
      tier: userData.subscriptionTier,
      stripeCustomerId: userData.stripeCustomerId,
      stripeSubscriptionId: userData.stripeSubscriptionId,
      trialEndsAt: userData.trialEndsAt,
      createdAt: userData.createdAt,
      isVipActive: !!isVipActive,
    };
  }),

  /**
   * Create Stripe checkout session for subscription upgrade
   */
  createCheckoutSession: protectedProcedure
    .input(z.object({
      targetTier: z.enum(['wheel_trading', 'live_trading_csp_cc', 'advanced', 'vip']),
      includeSetupFees: z.object({
        tradier: z.boolean().default(false),
        tastytrade: z.boolean().default(false),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb, getApiCredentials } = await import("./db");
      const { users } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const user = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!user[0]) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const userData = user[0];
      const credentials = await getApiCredentials(ctx.user.id);

      // Calculate required setup fees based on current credentials
      const setupFees = calculateSetupFees({
        hasTradierApiKey: !!credentials?.tradierApiKey,
        hasTastytradeRefreshToken: !!credentials?.tastytradeRefreshToken,
        targetTier: input.targetTier,
        wantsAssistedSetup: input.includeSetupFees?.tradier || input.includeSetupFees?.tastytrade || false,
      });

      // Build line items for checkout
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

      // Add subscription price
      const product = TIER_TO_PRODUCT[input.targetTier];
      if (!product) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid target tier" });
      }

      lineItems.push({
        price: product.priceId,
        quantity: 1,
      });

      // Add setup fees if requested and required
      if (input.includeSetupFees?.tradier && setupFees.tradierSetupFee > 0) {
        lineItems.push({
          price: STRIPE_PRODUCTS.SETUP_TRADIER.priceId,
          quantity: 1,
        });
      }

      if (input.includeSetupFees?.tastytrade && setupFees.tastytradeSetupFee > 0) {
        lineItems.push({
          price: STRIPE_PRODUCTS.SETUP_TASTYTRADE.priceId,
          quantity: 1,
        });
      }

      // Create Stripe checkout session
      const origin = ctx.req.headers.origin || 'http://localhost:3000';
      const session = await stripe.checkout.sessions.create({
        customer: userData.stripeCustomerId || undefined,
        customer_email: !userData.stripeCustomerId ? userData.email || undefined : undefined,
        client_reference_id: ctx.user.id.toString(),
        line_items: lineItems,
        mode: 'subscription',
        success_url: `${origin}/subscription?success=true`,
        cancel_url: `${origin}/subscription?canceled=true`,
        allow_promotion_codes: true,
        metadata: {
          user_id: ctx.user.id.toString(),
          target_tier: input.targetTier,
          customer_email: userData.email || '',
          customer_name: userData.name || '',
        },
      });

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    }),

  /**
   * Cancel subscription
   */
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const { users } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const user = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!user[0]) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    const userData = user[0];

    if (!userData.stripeSubscriptionId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No active subscription found" });
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(userData.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    return { success: true };
  }),

  /**
   * Reactivate canceled subscription
   */
  reactivateSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import("./db");
    const { users } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const user = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!user[0]) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    const userData = user[0];

    if (!userData.stripeSubscriptionId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No subscription found" });
    }

    // Remove cancel_at_period_end flag
    await stripe.subscriptions.update(userData.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    return { success: true };
  }),
});
