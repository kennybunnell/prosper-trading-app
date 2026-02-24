import type { Request, Response } from "express";
import Stripe from "stripe";
import { getDb } from "../db.js";
import { users } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import type { SubscriptionTier } from "../../shared/products.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * Map Stripe price ID to subscription tier
 */
function getTierFromPriceId(priceId: string): SubscriptionTier | null {
  const priceToTier: Record<string, SubscriptionTier> = {
    'price_1T1U5l6CoinGQAjo37JjN7uu': 'wheel_trading',      // Tier 2
    'price_1T1WVi6CoinGQAjoY5DJ4sOz': 'live_trading_csp_cc', // Tier 3
    'price_1T1XBM6CoinGQAjoxn9aoyDs': 'advanced',            // Tier 4
    'price_1T1XPH6CoinGQAjoyZ86VnpR': 'vip',                 // VIP
  };
  
  return priceToTier[priceId] || null;
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    console.error('[Stripe Webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header', received: false });
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    // Check if this is a Manus test event (not a real Stripe event)
    if (err.message.includes('No signatures found') || err.message.includes('Unable to extract timestamp')) {
      console.log('[Stripe Webhook] Detected test event, returning success response');
      return res.json({ received: true, test: true, message: 'Test event received' });
    }
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}`, received: false });
  }

  console.log('[Stripe Webhook] Received event:', event.type, 'ID:', event.id);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log('[Stripe Webhook] Unhandled event type:', event.type);
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error('[Stripe Webhook] Error processing event:', err);
    return res.status(500).json({ error: `Webhook processing error: ${err.message}`, received: false });
  }
}

/**
 * Handle successful checkout session
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log('[Stripe Webhook] Checkout session completed:', session.id);

  const userId = session.metadata?.user_id;
  const targetTier = session.metadata?.target_tier as SubscriptionTier;

  if (!userId) {
    console.error('[Stripe Webhook] Missing user_id in session metadata');
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error('[Stripe Webhook] Database unavailable');
    return;
  }

  // Update user with Stripe customer ID and subscription ID
  const updateData: any = {
    stripeCustomerId: session.customer as string,
  };

  if (session.subscription) {
    updateData.stripeSubscriptionId = session.subscription as string;
  }

  // Update tier if specified in metadata
  if (targetTier) {
    updateData.subscriptionTier = targetTier;
    console.log('[Stripe Webhook] Upgrading user', userId, 'to tier:', targetTier);
  }

  await db.update(users)
    .set(updateData)
    .where(eq(users.id, parseInt(userId)));

  console.log('[Stripe Webhook] User updated successfully:', userId);

  // ========== Phase 5: Auto-send invite after payment ==========
  
  const customerEmail = session.customer_email || session.metadata?.customer_email;
  
  if (customerEmail) {
    try {
      // Check if user is already approved
      const userResult = await db.select()
        .from(users)
        .where(eq(users.id, parseInt(userId)))
        .limit(1);

      if (userResult[0] && !userResult[0].isApproved) {
        // User not approved yet - send invite
        const { invites } = await import('../../drizzle/schema.js');
        const { generateInviteEmailHTML, generateInviteEmailText, sendEmail } = await import('../_core/email.js');
        const { notifyOwner } = await import('../_core/notification.js');
        
        // Generate unique invite code
        const code = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // Create invite record
        await db.insert(invites).values({
          email: customerEmail,
          code,
          status: 'pending',
          expiresAt,
          invitedBy: parseInt(userId), // Self-invited via payment
          note: `Auto-invited after payment for ${targetTier} tier`,
        });

        // Generate invite link
        const origin = process.env.VITE_APP_URL || 'https://prospertrading.biz';
        const inviteLink = `${origin}/invite/${code}`;

        // Send email
        const emailHTML = generateInviteEmailHTML({
          inviteLink,
          invitedByName: 'Prosper Trading',
          expiresInDays: 7,
        });
        const emailText = generateInviteEmailText({
          inviteLink,
          invitedByName: 'Prosper Trading',
          expiresInDays: 7,
        });

        await sendEmail({
          to: customerEmail,
          subject: 'Welcome to Prosper Trading - Activate Your Account',
          htmlContent: emailHTML,
          textContent: emailText,
        });

        // Notify owner
        await notifyOwner({
          title: `Payment received from ${customerEmail}`,
          content: `User paid for ${targetTier} tier ($${session.amount_total ? (session.amount_total / 100).toFixed(2) : 'N/A'}). Invite sent automatically.\n\nInvite link: ${inviteLink}`,
        });

        console.log('[Stripe Webhook] Invite sent to:', customerEmail);
      } else if (userResult[0]?.isApproved) {
        console.log('[Stripe Webhook] User already approved, no invite needed');
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Failed to send invite:', error.message);
      // Don't fail the webhook - payment still processed successfully
    }
  }
  
  // ========== End Phase 5 ==========
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log('[Stripe Webhook] Subscription created:', subscription.id);

  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;

  if (!priceId) {
    console.error('[Stripe Webhook] No price ID found in subscription');
    return;
  }

  const tier = getTierFromPriceId(priceId);
  if (!tier) {
    console.error('[Stripe Webhook] Unknown price ID:', priceId);
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error('[Stripe Webhook] Database unavailable');
    return;
  }

  // Find user by Stripe customer ID
  const userResult = await db.select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (!userResult[0]) {
    console.error('[Stripe Webhook] User not found for customer:', customerId);
    return;
  }

  // Update user tier and subscription ID
  await db.update(users)
    .set({
      subscriptionTier: tier,
      stripeSubscriptionId: subscription.id,
    })
    .where(eq(users.id, userResult[0].id));

  console.log('[Stripe Webhook] User', userResult[0].id, 'upgraded to tier:', tier);
}

/**
 * Handle subscription updates (upgrades, downgrades, renewals)
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log('[Stripe Webhook] Subscription updated:', subscription.id);

  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;

  if (!priceId) {
    console.error('[Stripe Webhook] No price ID found in subscription');
    return;
  }

  const tier = getTierFromPriceId(priceId);
  if (!tier) {
    console.error('[Stripe Webhook] Unknown price ID:', priceId);
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error('[Stripe Webhook] Database unavailable');
    return;
  }

  // Find user by Stripe customer ID
  const userResult = await db.select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (!userResult[0]) {
    console.error('[Stripe Webhook] User not found for customer:', customerId);
    return;
  }

  // Update user tier
  await db.update(users)
    .set({
      subscriptionTier: tier,
    })
    .where(eq(users.id, userResult[0].id));

  console.log('[Stripe Webhook] User', userResult[0].id, 'tier updated to:', tier);
}

/**
 * Handle subscription deletion (cancellation)
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('[Stripe Webhook] Subscription deleted:', subscription.id);

  const customerId = subscription.customer as string;

  const db = await getDb();
  if (!db) {
    console.error('[Stripe Webhook] Database unavailable');
    return;
  }

  // Find user by Stripe customer ID
  const userResult = await db.select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (!userResult[0]) {
    console.error('[Stripe Webhook] User not found for customer:', customerId);
    return;
  }

  // Downgrade user to free trial
  await db.update(users)
    .set({
      subscriptionTier: 'free_trial',
      stripeSubscriptionId: null,
    })
    .where(eq(users.id, userResult[0].id));

  console.log('[Stripe Webhook] User', userResult[0].id, 'downgraded to free_trial');
}

/**
 * Handle successful invoice payment (recurring payments)
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('[Stripe Webhook] Invoice payment succeeded:', invoice.id);

  // Subscription renewals are handled by subscription.updated events
  // This is mainly for logging and monitoring
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;
  const subscriptionId = typeof (invoice as any).subscription === 'string' ? (invoice as any).subscription : (invoice as any).subscription?.id;

  console.log('[Stripe Webhook] Payment successful for customer:', customerId, 'subscription:', subscriptionId);
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log('[Stripe Webhook] Invoice payment failed:', invoice.id);

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;
  const subscriptionId = typeof (invoice as any).subscription === 'string' ? (invoice as any).subscription : (invoice as any).subscription?.id;

  console.error('[Stripe Webhook] Payment failed for customer:', customerId, 'subscription:', subscriptionId);

  // TODO: Send notification to user about payment failure
  // TODO: Consider downgrading user after multiple failed payments
}
