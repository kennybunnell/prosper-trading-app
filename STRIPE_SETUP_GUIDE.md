# Stripe Setup Guide for Prosper Trading App

This guide will walk you through setting up Stripe products and prices for your 4-tier subscription system.

---

## Overview: Your Subscription Tiers

| Tier | Name | Price | Setup Fee | View Strategies | Trade Strategies | Features |
|------|------|-------|-----------|-----------------|------------------|----------|
| Tier 1 | Free Trial | $0 | $0 | All strategies | None (paper trading only) | 14-day trial, 10 scans/day, demo Tradier account |
| Tier 2 | Wheel View | $47/month | $99 one-time | All strategies | None (paper trading only) | Unlimited scans, requires your own Tradier API |
| Tier 3 | Wheel Trading | $97/month | $99 one-time | All strategies | CSP + CC only (live trading) | Requires Tradier + Tastytrade APIs |
| Tier 4 | Advanced Spreads | $200/month | $0 | All strategies | All strategies (live trading) | Full access: CSP, CC, BPS, BCS, Iron Condor, PMCC |

### Key Strategy

**"Try Before You Buy"** - All users can VIEW all strategies (CSP, CC, spreads, iron condors, PMCC) in paper trading mode across all tiers. This lets them:
- Explore and learn all strategies during free trial
- See real opportunities and understand the value
- Make informed decisions about which tier to purchase

**Trading restrictions by tier:**
- **Tier 1 & 2**: Can only paper trade (no live trading)
- **Tier 3**: Can live trade CSP + Covered Calls only (Wheel strategy)
- **Tier 4**: Can live trade all strategies (full access)

---

## Step 1: Create Stripe Products

### 1.1 Log into Stripe Dashboard
- Go to https://dashboard.stripe.com
- Navigate to **Products** in the left sidebar

### 1.2 Create Product: Wheel View (Tier 2)

1. Click **+ Add product**
2. Fill in the details:
   - **Name**: `Wheel View`
   - **Description**: `View all strategies with unlimited scans. Paper trading only. Requires your own Tradier API key.`
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
   - **Description**: `View all strategies, live trade CSP and Covered Calls. Requires Tradier + Tastytrade credentials.`
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
   - **Description**: `Full access: View and live trade all strategies including Bull Put Spreads, Bear Call Spreads, Iron Condors, and PMCC.`
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
   - Pricing page UI with tier comparison and upgrade buttons
   - Subscription management UI in Settings
   - Upgrade prompts when users hit limits
   - "View Only" badges for locked trading strategies

---

## Pricing Strategy Notes

### Why "View All, Trade by Tier"?

This strategy maximizes conversions by:
- **Reducing friction**: Users can explore all features without paying
- **Building trust**: They see real opportunities and understand the value
- **Creating urgency**: "I can see this $500 opportunity, but I need Tier 4 to trade it"
- **Natural upsell**: Users who succeed with Wheel (Tier 3) will want spreads (Tier 4)

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

## Tier Upgrade Path

**Expected user journey:**

1. **Sign up** → Tier 1 (Free Trial)
   - Explore all strategies in paper trading
   - Hit 10 scans/day limit
   - See value in unlimited scans

2. **Upgrade to Tier 2** ($47/mo + $99 setup)
   - Unlimited scans
   - Continue learning with own Tradier API
   - See live opportunities, build confidence

3. **Upgrade to Tier 3** ($97/mo + $99 setup)
   - Start live trading with Wheel strategy
   - See spread opportunities but can't trade them
   - Experience success with CSP + CC

4. **Upgrade to Tier 4** ($200/mo, no setup fee)
   - Unlock all strategies
   - Trade spreads, iron condors, PMCC
   - Full platform access

---

## Questions?

If you have any questions about the Stripe setup or need help with any step, let me know and I'll guide you through it!
