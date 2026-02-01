import { Request, Response } from "express";
import Stripe from "stripe";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-01-28.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * Stripe Webhook Handler
 * Processes subscription lifecycle events (created, updated, cancelled, deleted)
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    console.error("[Stripe Webhook] Missing stripe-signature header");
    return res.status(400).send("Missing stripe-signature header");
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // CRITICAL: Handle test events for webhook verification
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  console.log("[Stripe Webhook] Received event:", event.type, event.id);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log("[Stripe Webhook] Unhandled event type:", event.type);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("[Stripe Webhook] Error processing event:", error);
    res.status(500).send("Webhook processing failed");
  }
}

/**
 * Handle successful checkout session completion
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log("[Stripe Webhook] Checkout session completed:", session.id);

  const userId = session.metadata?.userId || session.client_reference_id;
  const tier = session.metadata?.tier;
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  if (!userId) {
    console.error("[Stripe Webhook] Missing userId in checkout session metadata");
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Database not available");
    return;
  }

  // Update user with Stripe customer ID and subscription ID
  await db
    .update(users)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionTier: tier as "free_trial" | "wheel" | "advanced",
      trialEndsAt: null, // Clear trial when subscription starts
    })
    .where(eq(users.id, parseInt(userId)));

  console.log(`[Stripe Webhook] User ${userId} upgraded to ${tier} tier`);
}

/**
 * Handle subscription updates (status changes, plan changes)
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log("[Stripe Webhook] Subscription updated:", subscription.id);

  const customerId = subscription.customer as string;
  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Database not available");
    return;
  }

  // Find user by Stripe customer ID
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (userResult.length === 0) {
    console.error("[Stripe Webhook] User not found for customer:", customerId);
    return;
  }

  const user = userResult[0];

  // Determine tier from subscription metadata or price ID
  const tier = subscription.metadata?.tier as "free_trial" | "wheel" | "advanced" | undefined;

  // Update subscription status
  const updates: any = {
    stripeSubscriptionId: subscription.id,
  };

  if (tier) {
    updates.subscriptionTier = tier;
  }

  // If subscription is cancelled, revert to free trial
  if (subscription.status === "canceled") {
    updates.subscriptionTier = "free_trial";
    updates.stripeSubscriptionId = null;
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));

  console.log(`[Stripe Webhook] User ${user.id} subscription updated to ${subscription.status}`);
}

/**
 * Handle subscription deletion (cancellation)
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log("[Stripe Webhook] Subscription deleted:", subscription.id);

  const customerId = subscription.customer as string;
  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Database not available");
    return;
  }

  // Find user by Stripe customer ID
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (userResult.length === 0) {
    console.error("[Stripe Webhook] User not found for customer:", customerId);
    return;
  }

  const user = userResult[0];

  // Revert to free trial tier
  await db
    .update(users)
    .set({
      subscriptionTier: "free_trial",
      stripeSubscriptionId: null,
    })
    .where(eq(users.id, user.id));

  console.log(`[Stripe Webhook] User ${user.id} reverted to free trial after subscription cancellation`);
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  console.log("[Stripe Webhook] Invoice paid:", invoice.id);
  // Optional: Track payment history, send receipt email, etc.
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log("[Stripe Webhook] Invoice payment failed:", invoice.id);
  // Optional: Send payment failure notification, retry logic, etc.
}
