# Stripe Integration Audit - Prosper Trading App

**Date:** February 23, 2026  
**Status:** ✅ Fully Implemented (Webhooks Active, Products Configured)

---

## 📋 Executive Summary

Your Stripe integration is **already fully functional** with:
- ✅ 4 subscription tiers + 2 one-time setup fees
- ✅ Webhook handling for all payment events
- ✅ Automatic tier upgrades/downgrades
- ✅ Test mode active (sandbox claimed)

**What's Missing:** Auto-send invite emails after payment (Phase 5 - not yet implemented)

---

## 💳 Product Structure & Pricing

### **Subscription Tiers**

| Tier | Name | Price | Stripe Price ID | Features |
|------|------|-------|-----------------|----------|
| **Tier 1** | Free Trial | $0/month | N/A | View-only access, no trading |
| **Tier 2** | Wheel Access CSP-CC | $47/month | `price_1T1U5l6CoinGQAjo37JjN7uu` | Unlimited scans, paper trading only, requires Tradier API key |
| **Tier 3** | Live Trading CSP, CC | $97/month | `price_1T1WVi6CoinGQAjoY5DJ4sOz` | Live trade CSP & Covered Calls, requires Tradier + Tastytrade |
| **Tier 4** | Advanced Trading - All Strategies | $197/month | `price_1T1XBM6CoinGQAjoxn9aoyDs` | Full access to all strategies (BPS, BCS, IC, PMCC), live trading |
| **VIP** | Lifetime Access | $2,997 one-time | `price_1T1XPH6CoinGQAjoyZ86VnpR` | Lifetime access, all features, includes all setup fees |

### **One-Time Setup Fees** (Optional Assisted Setup)

| Service | Price | Stripe Price ID | Description |
|---------|-------|-----------------|-------------|
| **Tradier Setup** | $47 | `price_1T1XiR6CoinGQAjoHFwQvfBn` | Assisted Tradier API key setup |
| **Tastytrade Setup** | $97 | `price_1T1Xk76CoinGQAjoGDZnHgPQ` | Assisted Tastytrade OAuth integration |

**Note:** VIP tier includes all setup fees at no extra charge.

---

## 🔄 Payment Flow (Current Implementation)

### **User Journey:**
1. User logs in → sees their current tier (default: `free_trial`)
2. User navigates to upgrade page (e.g., Settings → Subscription)
3. User selects target tier → clicks "Upgrade"
4. Backend creates Stripe Checkout Session with:
   - `metadata.user_id` = User's database ID
   - `metadata.target_tier` = Selected tier (e.g., `advanced`)
   - `customer_email` = User's email
5. User redirected to Stripe Checkout → completes payment
6. Stripe fires `checkout.session.completed` webhook
7. **Backend webhook handler (`/api/webhooks/stripe`):**
   - Verifies webhook signature
   - Extracts `user_id` and `target_tier` from metadata
   - Updates user record:
     ```sql
     UPDATE users SET
       stripeCustomerId = 'cus_xxx',
       stripeSubscriptionId = 'sub_xxx',
       subscriptionTier = 'advanced'
     WHERE id = user_id
     ```
8. User gains access to features for their new tier

---

## 🎯 Webhook Events Handled

| Event | Handler Function | Action |
|-------|------------------|--------|
| `checkout.session.completed` | `handleCheckoutSessionCompleted()` | Update user with Stripe customer ID, subscription ID, and tier |
| `customer.subscription.created` | `handleSubscriptionCreated()` | Upgrade user tier based on price ID |
| `customer.subscription.updated` | `handleSubscriptionUpdated()` | Update user tier (handles upgrades/downgrades) |
| `customer.subscription.deleted` | `handleSubscriptionDeleted()` | Downgrade user to `free_trial` |
| `invoice.payment_succeeded` | `handleInvoicePaymentSucceeded()` | Log successful recurring payment |
| `invoice.payment_failed` | `handleInvoicePaymentFailed()` | Log failed payment (TODO: notify user) |

**Webhook Endpoint:** `https://prospertrading.biz/api/webhooks/stripe`

---

## 🔐 Security & Configuration

### **Environment Variables (Already Configured):**
- ✅ `STRIPE_SECRET_KEY` - Your Stripe secret key (test mode)
- ✅ `STRIPE_PUBLISHABLE_KEY` - Frontend Stripe key (test mode)
- ✅ `STRIPE_WEBHOOK_SECRET` - Webhook signing secret

### **Webhook Signature Verification:**
- ✅ All webhooks verify signature using `stripe.webhooks.constructEvent()`
- ✅ Test events handled gracefully (returns success without processing)
- ✅ Raw body parsing enabled (`express.raw()` middleware)

---

## 🚀 Phase 5 Integration Plan (Future)

### **Goal:** Auto-send invite emails after successful payment

### **Implementation Steps:**

1. **Modify `handleCheckoutSessionCompleted()` in `/server/webhooks/stripe.ts`:**
   ```typescript
   async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
     // ... existing code ...

     // After updating user tier, send invite email
     const userEmail = session.customer_email || session.metadata?.customer_email;
     
     if (userEmail) {
       // Import invite helper
       const { sendInviteEmail } = await import('../routers-admin.js');
       
       // Send invite
       await sendInviteEmail({
         email: userEmail,
         invitedBy: parseInt(userId), // Admin who set up payment
         note: `Paid for ${targetTier} tier`,
       });
       
       console.log('[Stripe Webhook] Invite sent to:', userEmail);
     }
   }
   ```

2. **User Flow After Payment:**
   - User pays → Stripe webhook fires
   - Backend sends invite email with unique link
   - User clicks invite link → logs in → auto-approved
   - User gains full access to their paid tier

3. **Edge Cases to Handle:**
   - User already has account → just approve them (don't send duplicate invite)
   - User pays but doesn't click invite link → manual approval option in Admin Panel
   - Invite expires → admin can resend from Admin Panel

---

## 📊 Current User Tiers (Database State)

| User | Email | Current Tier | Stripe Customer ID | Approved? |
|------|-------|--------------|-------------------|-----------|
| **Kenny Bunnell (You)** | kennybunnell@gmail.com | `advanced` | (set after payment) | ✅ Yes |
| **tracyabunnell** | tracyabunnell@gmail.com | `free_trial` | None | ❌ Pending |
| **kenny** | kenny@learnhowtoprosper.com | `free_trial` | None | ❌ Pending |

---

## 🧪 Testing Recommendations

### **Test Card (Stripe Test Mode):**
- **Card Number:** `4242 4242 4242 4242`
- **Expiry:** Any future date (e.g., `12/28`)
- **CVC:** Any 3 digits (e.g., `123`)
- **ZIP:** Any 5 digits (e.g., `12345`)

### **Test Scenarios:**

1. **Tier 2 Upgrade ($47/month):**
   - Login as test user
   - Navigate to upgrade page
   - Select "Tier 2: Wheel Access"
   - Complete checkout with test card
   - Verify webhook fires and tier updates to `wheel_trading`

2. **Tier 4 Upgrade ($197/month):**
   - Same flow, verify tier updates to `advanced`

3. **VIP Lifetime ($2,997 one-time):**
   - Verify tier updates to `vip`
   - Verify no recurring subscription created

4. **Subscription Cancellation:**
   - Cancel subscription in Stripe Dashboard
   - Verify webhook fires and tier downgrades to `free_trial`

---

## 🔗 Key Files

| File | Purpose |
|------|---------|
| `/server/webhooks/stripe.ts` | Webhook handler (all payment events) |
| `/shared/products.ts` | Product definitions, pricing, tier mapping |
| `/server/_core/index.ts` | Webhook route registration |
| `/drizzle/schema.ts` | User table schema (includes `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionTier`) |

---

## ✅ What's Working

- ✅ Stripe Checkout Sessions create successfully
- ✅ Webhooks fire and verify signatures
- ✅ User tiers update automatically after payment
- ✅ Subscription renewals handled automatically
- ✅ Cancellations downgrade users to free trial
- ✅ Test mode active (sandbox claimed)

## ⏳ What's Missing (Phase 5)

- ⏳ Auto-send invite emails after payment
- ⏳ Invite link in payment confirmation email
- ⏳ Automatic approval after invite acceptance

---

## 💡 Recommendations

1. **Keep manual approval for now** - Test with small group before automating
2. **Add Phase 5 when ready** - Simple 10-line addition to webhook handler
3. **Monitor Stripe Dashboard** - Watch for failed payments, disputes
4. **Set up live keys** - After KYC verification, switch to live mode
5. **Add email receipts** - Stripe can send automatic receipts (enable in Dashboard)

---

**Next Steps:** Test invite flow manually (Phases 1-4), then add Phase 5 when ready to automate.
