import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { getProductByTier, hasAccessToTier, type SubscriptionTier } from "./products";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-01-28.clover",
});

/**
 * Middleware to require a minimum subscription tier
 */
export const requireTier = (minTier: "wheel" | "advanced") => {
  return protectedProcedure.use(async ({ ctx, next }: { ctx: any; next: any }) => {
    const userTier = ctx.user.subscriptionTier as SubscriptionTier;
    
    if (!hasAccessToTier(userTier, minTier)) {
      const product = getProductByTier(minTier);
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This feature requires ${product.name} subscription ($${product.price}/month)`,
      });
    }
    
    return next({ ctx });
  });
};

export const subscriptionRouter = router({
  /**
   * Get current user's subscription status
   */
  getSubscription: protectedProcedure.query(async ({ ctx }: { ctx: any }) => {
    const user = ctx.user;
    
    // Calculate trial status
    const now = new Date();
    const trialEndsAt = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
    const isTrialActive = trialEndsAt ? trialEndsAt > now : false;
    const trialDaysRemaining = trialEndsAt 
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    
    // Get product info for current tier
    const currentProduct = getProductByTier(user.subscriptionTier as SubscriptionTier);
    
    // Fetch Stripe subscription details if exists
    let stripeSubscription = null;
    if (user.stripeSubscriptionId) {
      try {
        stripeSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      } catch (error) {
        console.error("[Subscription] Error fetching Stripe subscription:", error);
      }
    }
    
    return {
      tier: user.subscriptionTier,
      product: currentProduct,
      isTrialActive,
      trialEndsAt,
      trialDaysRemaining,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      stripeSubscription,
    };
  }),

  /**
   * Create Stripe checkout session for subscription upgrade
   */
  createCheckoutSession: protectedProcedure
    .input(z.object({
      tier: z.enum(["free_trial", "wheel", "advanced"]),
    }))
    .mutation(async ({ ctx, input }: { ctx: any; input: { tier: string } }) => {
      const user = ctx.user;
      const product = getProductByTier(input.tier as SubscriptionTier);
      
      // Ensure user isn't downgrading (for now, only allow upgrades)
      if (!hasAccessToTier(input.tier as SubscriptionTier, user.subscriptionTier as SubscriptionTier)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot downgrade subscription tier",
        });
      }
      
      // Get or create Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          name: user.name || undefined,
          metadata: {
            userId: user.id.toString(),
            openId: user.openId,
          },
        });
        customerId = customer.id;
        
        // Save customer ID to database
        const db = await getDb();
        if (db) {
          await db.update(users)
            .set({ stripeCustomerId: customerId })
            .where(eq(users.id, user.id));
        }
      }
      
      // Create checkout session
      const origin = ctx.req.headers.origin || "http://localhost:3000";
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price: product.priceId,
            quantity: 1,
          },
        ],
        success_url: `${origin}/settings?session_id={CHECKOUT_SESSION_ID}&upgrade=success`,
        cancel_url: `${origin}/settings?upgrade=cancelled`,
        allow_promotion_codes: true,
        client_reference_id: user.id.toString(),
        metadata: {
          userId: user.id.toString(),
          tier: input.tier,
          userEmail: user.email || "",
          userName: user.name || "",
        },
      });
      
      return {
        sessionId: session.id,
        url: session.url,
      };
    }),

  /**
   * Cancel subscription
   */
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }: { ctx: any }) => {
    const user = ctx.user;
    
    if (!user.stripeSubscriptionId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No active subscription to cancel",
      });
    }
    
    // Cancel at period end (don't immediately revoke access)
    const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    
    return {
      success: true,
      cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
    };
  }),

  /**
   * Reactivate cancelled subscription
   */
  reactivateSubscription: protectedProcedure.mutation(async ({ ctx }: { ctx: any }) => {
    const user = ctx.user;
    
    if (!user.stripeSubscriptionId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No subscription to reactivate",
      });
    }
    
    // Remove cancellation
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    
    return {
      success: true,
    };
  }),
});
