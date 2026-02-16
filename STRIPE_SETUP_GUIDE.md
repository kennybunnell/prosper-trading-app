# Stripe Setup Guide for Prosper Trading App

This guide will walk you through setting up Stripe products and prices for your 4-tier subscription system.

---

## Overview: Your Subscription Tiers

| Tier | Name | Price | Setup Fee | Features |
|------|------|-------|-----------|----------|
| Tier 1 | Free Trial | $0 | $0 | 14-day trial, 10 scans/day, paper trading only, demo account |
| Tier 2 | Wheel View | $47/month | $99 one-time | Unlimited scans, paper trading only, requires Tradier API |
| Tier 3 | Wheel Trading | $97/month | $99 one-time | Live trading, CSP + CC strategies only, requires Tradier + Tastytrade |
| Tier 4 | Advanced Spreads | $200/month | $0 | Live trading, all strategies (CSP, CC, BPS, BCS, Iron Condor, PMCC) |

---

## Step 1: Create Stripe Products

### 1.1 Log into Stripe Dashboard
- Go to https://dashboard.stripe.com
- Navigate to **Products** in the left sidebar

### 1.2 Create Product: Wheel View (Tier 2)

1. Click **+ Add product**
2. Fill in the details:
   - **Name**: `Wheel View`
   - **Description**: `Paper trading with unlimited scans. Requires your own Tradier API key.`
   - **Pricing model**: `Recurring`
   - **Price**: `$47.00 USD`
   - **Billing period**: `Monthly`
   - **Tax code**: `Software as a Service (SaaS)` (optional)
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_...`) - you'll need this later

### 1.3 Create Product: Wheel View Setup Fee

1. Click **+ Add product**
2. Fill in the details:
   - **Name**: `Wheel View Setup Fee`
   - **Description**: `One-time setup fee for Wheel View subscription`
   - **Pricing model**: `One-time`
   - **Price**: `$99.00 USD`
3. Click **Save product**
4. **Copy the Price ID** - you'll need this later

### 1.4 Create Product: Wheel Trading (Tier 3)

1. Click **+ Add product**
2. Fill in the details:
   - **Name**: `Wheel Trading`
   - **Description**: `Live trading with CSP and Covered Call strategies. Requires Tradier + Tastytrade credentials.`
   - **Pricing model**: `Recurring`
   - **Price**: `$97.00 USD`
   - **Billing period**: `Monthly`
3. Click **Save product**
4. **Copy the Price ID** - you'll need this later

### 1.5 Create Product: Wheel Trading Setup Fee

1. Click **+ Add product**
2. Fill in the details:
   - **Name**: `Wheel Trading Setup Fee`
   - **Description**: `One-time setup fee for Wheel Trading subscription`
   - **Pricing model**: `One-time`
   - **Price**: `$99.00 USD`
3. Click **Save product**
4. **Copy the Price ID** - you'll need this later

### 1.6 Create Product: Advanced Spreads (Tier 4)

1. Click **+ Add product**
2. Fill in the details:
   - **Name**: `Advanced Spreads`
   - **Description**: `Live trading with all strategies: CSP, CC, Bull Put Spreads, Bear Call Spreads, Iron Condors, and PMCC.`
   - **Pricing model**: `Recurring`
   - **Price**: `$200.00 USD`
   - **Billing period**: `Monthly`
3. Click **Save product**
4. **Copy the Price ID** - you'll need this later

---

## Step 2: Save Your Price IDs

After creating all products, you should have **5 Price IDs**:

```
Wheel View (Monthly):         price_xxxxxxxxxxxxx
Wheel View Setup Fee:         price_xxxxxxxxxxxxx
Wheel Trading (Monthly):      price_xxxxxxxxxxxxx
Wheel Trading Setup Fee:      price_xxxxxxxxxxxxx
Advanced Spreads (Monthly):   price_xxxxxxxxxxxxx
```

**Keep these Price IDs handy** - you'll need them when I implement the Stripe integration code.

---

## Step 3: Configure Webhook Endpoint

### 3.1 Add Webhook Endpoint

1. In Stripe Dashboard, go to **Developers** → **Webhooks**
2. Click **+ Add endpoint**
3. Fill in the details:
   - **Endpoint URL**: `https://your-domain.manus.space/api/stripe/webhook`
     (Replace `your-domain` with your actual Manus domain)
   - **Description**: `Prosper Trading App - Subscription Events`
   - **Events to send**: Select these events:
     - `checkout.session.completed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
4. Click **Add endpoint**
5. **Copy the Signing Secret** (starts with `whsec_...`) - you'll need this later

---

## Step 4: Test Mode vs Live Mode

### Test Mode (Current)
- You're currently in **Test Mode** (Stripe sandbox)
- Use test card: `4242 4242 4242 4242` (any future expiry, any CVC)
- No real money is charged
- Perfect for testing the full subscription flow

### Going Live
When you're ready to accept real payments:

1. Complete Stripe KYC verification (identity + business info)
2. Switch to **Live Mode** in Stripe Dashboard (toggle in top-right)
3. Create the same products again in Live Mode
4. Update the webhook endpoint to use Live Mode signing secret
5. Add live Stripe keys in **Settings → Payment** in Manus Management UI

**Note**: Stripe requires a minimum transaction of $0.50 USD. For live testing, use the 99% discount promo code.

---

## Step 5: Next Steps

Once you've completed the Stripe setup above:

1. **Send me the 5 Price IDs** - I'll add them to the code
2. **Send me the Webhook Signing Secret** - I'll configure webhook verification
3. **I'll implement**:
   - Stripe checkout session creation
   - Webhook handlers for subscription events
   - Pricing page UI with upgrade buttons
   - Subscription management UI in Settings
   - Upgrade prompts when users hit limits

---

## Pricing Strategy Notes

### Why $99 Setup Fee for Tiers 2 & 3?

The setup fee serves multiple purposes:
- **Commitment filter**: Ensures serious users who will actually use the platform
- **Onboarding value**: Compensates for the time spent helping users set up their API credentials
- **Revenue diversification**: One-time revenue in addition to recurring subscriptions

### Why No Setup Fee for Tier 4?

- Users upgrading from Tier 3 → Tier 4 already paid the setup fee
- Tier 4 is a premium tier with higher monthly revenue
- Removing friction encourages upgrades to the highest tier

### Discount Codes

You can create discount codes in Stripe Dashboard:
- **100% off forever**: For VIP/partner/beta_tester users (though role-based access is cleaner)
- **99% off first month**: For live testing without spending real money
- **50% off first 3 months**: For promotional campaigns

---

## Questions?

If you have any questions about the Stripe setup or need help with any step, let me know and I'll guide you through it!
