# Stripe Webhook Testing Guide

## Overview

Your Stripe webhook endpoint is now fully configured and working. This guide will walk you through testing it with real Stripe events.

## Current Configuration

- **Webhook Endpoint URL:** `https://3000-i9zcnjlcuz3p3d53rge3s-7c6e9ff2.us2.manus.computer/api/webhooks/stripe`
- **Webhook Signing Secret:** `whsec_3mo7dpDugaLs1ocMuytujBq0ovVJrVPZ`
- **Events Configured:** 6 events
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`

## ✅ Webhook Status: WORKING

The webhook endpoint has been tested and verified to:
- ✅ Accept incoming requests
- ✅ Return valid JSON responses
- ✅ Process Stripe events correctly
- ✅ Update user tiers in the database

---

## Method 1: Test from Stripe Dashboard (Easiest)

### Step 1: Navigate to Your Webhook

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Click on your webhook endpoint: `whimsical-jubilee`
3. You should see the webhook details page

### Step 2: Send a Test Event

1. On the webhook details page, click the **"Send test webhook"** button (top right)
2. A dialog will appear asking you to select an event type
3. Select **"checkout.session.completed"**
4. Click **"Send test webhook"**

### Step 3: Verify the Response

You should see:
- ✅ **Status: 200 OK**
- ✅ **Response body:** `{"received": true}`
- ✅ **Event delivered successfully**

### Step 4: Check Database Updates

After sending the test event, check your database to verify the user tier was updated:

```sql
SELECT id, email, subscriptionTier, stripeCustomerId, stripeSubscriptionId 
FROM users 
WHERE id = 1;
```

---

## Method 2: Test with Stripe CLI (Advanced)

### Prerequisites

Install Stripe CLI:

**macOS:**
```bash
brew install stripe/stripe-cli/stripe
```

**Linux:**
```bash
wget https://github.com/stripe/stripe-cli/releases/download/v1.19.4/stripe_1.19.4_linux_x86_64.tar.gz
tar -xvf stripe_1.19.4_linux_x86_64.tar.gz
sudo mv stripe /usr/local/bin/
```

### Step 1: Login to Stripe

```bash
stripe login
```

This will open your browser to authenticate with Stripe.

### Step 2: Forward Webhooks to Local Server

```bash
stripe listen --forward-to https://3000-i9zcnjlcuz3p3d53rge3s-7c6e9ff2.us2.manus.computer/api/webhooks/stripe
```

This command will:
- Listen for events in your Stripe account
- Forward them to your local webhook endpoint
- Display the events in your terminal

**Note:** The CLI will output a webhook signing secret (starts with `whsec_`). You can use this for local testing, but for production, use the secret from your Stripe dashboard webhook.

### Step 3: Trigger Test Events

Open a new terminal window and run:

```bash
# Test checkout completion
stripe trigger checkout.session.completed

# Test subscription creation
stripe trigger customer.subscription.created

# Test subscription update
stripe trigger customer.subscription.updated

# Test subscription deletion
stripe trigger customer.subscription.deleted

# Test payment success
stripe trigger invoice.payment_succeeded

# Test payment failure
stripe trigger invoice.payment_failed
```

### Step 4: Monitor the Output

In the terminal running `stripe listen`, you'll see:
- The event type
- The event ID
- The response from your webhook endpoint
- Any errors or issues

---

## Method 3: Test with Real Checkout Flow

### Step 1: Create a Test Checkout Session

1. Navigate to your app: `https://3000-i9zcnjlcuz3p3d53rge3s-7c6e9ff2.us2.manus.computer`
2. Log in to your account
3. Go to the **Subscription** page (`/subscription`)
4. Click **"Upgrade"** on any tier (e.g., Tier 2: Wheel Trading)

### Step 2: Complete Test Payment

You'll be redirected to Stripe Checkout. Use these test cards:

**Successful Payment:**
- Card: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., `12/28`)
- CVC: Any 3 digits (e.g., `123`)
- ZIP: Any 5 digits (e.g., `12345`)

**Declined Payment:**
- Card: `4000 0000 0000 0002`

**3D Secure Authentication:**
- Card: `4000 0027 6000 3184`

### Step 3: Verify Webhook Processing

After completing the payment:

1. **Check Server Logs:**
   ```bash
   tail -f /home/ubuntu/prosper-trading-app/.manus-logs/devserver.log | grep "Stripe Webhook"
   ```

   You should see:
   ```
   [Stripe Webhook] Received event: checkout.session.completed ID: evt_...
   [Stripe Webhook] Checkout session completed: cs_...
   [Stripe Webhook] Upgrading user 1 to tier: wheel_trading
   [Stripe Webhook] User updated successfully: 1
   ```

2. **Check Database:**
   ```sql
   SELECT id, email, subscriptionTier, stripeCustomerId, stripeSubscriptionId 
   FROM users 
   WHERE id = 1;
   ```

   You should see:
   - `subscriptionTier` updated to the tier you selected
   - `stripeCustomerId` populated (starts with `cus_`)
   - `stripeSubscriptionId` populated (starts with `sub_`)

3. **Check Stripe Dashboard:**
   - Go to [Stripe Dashboard → Customers](https://dashboard.stripe.com/test/customers)
   - Find the customer created (should match your email)
   - Click on the customer to see their subscription details

---

## Webhook Event Flow

### New Subscription (Free Trial → Paid Tier)

1. **User Action:** Clicks "Upgrade" on subscription page
2. **Backend:** Creates Stripe checkout session via `createCheckoutSession` mutation
3. **User Action:** Completes payment on Stripe Checkout
4. **Stripe → Webhook:** Sends `checkout.session.completed` event
5. **Webhook Handler:** 
   - Extracts `user_id` and `target_tier` from metadata
   - Updates user record:
     - Sets `stripeCustomerId`
     - Sets `stripeSubscriptionId`
     - Updates `subscriptionTier` to target tier
6. **Result:** User is upgraded to paid tier

### Subscription Upgrade (Tier 2 → Tier 3)

1. **User Action:** Clicks "Upgrade" to higher tier
2. **Backend:** Creates new checkout session
3. **User Action:** Completes payment
4. **Stripe → Webhook:** Sends `checkout.session.completed` and `customer.subscription.updated`
5. **Webhook Handler:** Updates `subscriptionTier` to new tier
6. **Result:** User is upgraded to higher tier

### Subscription Renewal (Monthly Payment)

1. **Stripe:** Automatically charges customer on billing date
2. **Stripe → Webhook:** Sends `invoice.payment_succeeded`
3. **Webhook Handler:** Logs successful payment (no tier change)
4. **Result:** Subscription continues

### Subscription Cancellation

1. **User Action:** Clicks "Cancel Subscription"
2. **Backend:** Calls `stripe.subscriptions.update` with `cancel_at_period_end: true`
3. **Stripe:** Cancels subscription at end of billing period
4. **Stripe → Webhook:** Sends `customer.subscription.deleted`
5. **Webhook Handler:** 
   - Downgrades user to `free_trial`
   - Clears `stripeSubscriptionId`
6. **Result:** User returns to free trial

### Payment Failure

1. **Stripe:** Attempts to charge customer (renewal or upgrade)
2. **Payment fails** (insufficient funds, expired card, etc.)
3. **Stripe → Webhook:** Sends `invoice.payment_failed`
4. **Webhook Handler:** Logs failure
5. **Stripe:** Retries payment according to retry settings
6. **If all retries fail:** Sends `customer.subscription.deleted`
7. **Result:** User is downgraded to free trial

---

## Monitoring Webhooks

### View Webhook Delivery in Stripe Dashboard

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Click on your webhook endpoint
3. Click on the **"Event deliveries"** tab
4. You'll see a list of all events sent to your webhook:
   - Event type
   - Delivery status (✅ succeeded or ❌ failed)
   - Response code
   - Response body
   - Timestamp

### Check Server Logs

```bash
# View all webhook logs
tail -100 /home/ubuntu/prosper-trading-app/.manus-logs/devserver.log | grep "Stripe Webhook"

# Monitor webhook logs in real-time
tail -f /home/ubuntu/prosper-trading-app/.manus-logs/devserver.log | grep "Stripe Webhook"
```

### Common Log Messages

**Successful Event Processing:**
```
[Stripe Webhook] Received event: checkout.session.completed ID: evt_1234567890
[Stripe Webhook] Checkout session completed: cs_1234567890
[Stripe Webhook] Upgrading user 1 to tier: wheel_trading
[Stripe Webhook] User updated successfully: 1
```

**Signature Verification Failed:**
```
[Stripe Webhook] Signature verification failed: No signatures found matching the expected signature for payload
```
→ **Fix:** Ensure `STRIPE_WEBHOOK_SECRET` matches the signing secret from Stripe dashboard

**Missing Metadata:**
```
[Stripe Webhook] Missing user_id in session metadata
```
→ **Fix:** Ensure checkout session includes `metadata.user_id`

---

## Troubleshooting

### Issue: Webhook returns 400 "Signature verification failed"

**Cause:** Webhook signing secret mismatch

**Solution:**
1. Go to Stripe Dashboard → Developers → Webhooks
2. Click on your webhook endpoint
3. Reveal the signing secret
4. Update `STRIPE_WEBHOOK_SECRET` in your environment variables
5. Restart your server

### Issue: Webhook returns 200 but user tier not updated

**Cause:** Missing or incorrect metadata in checkout session

**Solution:**
1. Check server logs for the webhook event
2. Verify `metadata.user_id` and `metadata.target_tier` are present
3. Ensure checkout session creation includes these metadata fields

### Issue: Webhook not receiving events

**Cause:** Webhook endpoint URL incorrect or not accessible

**Solution:**
1. Verify webhook URL in Stripe dashboard matches your server URL
2. Test webhook endpoint manually:
   ```bash
   curl -X POST https://3000-i9zcnjlcuz3p3d53rge3s-7c6e9ff2.us2.manus.computer/api/webhooks/stripe \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```
3. Check if server is running and accessible

### Issue: Database not updating after webhook

**Cause:** Database connection issue or query error

**Solution:**
1. Check server logs for database errors
2. Verify database connection is working
3. Check if user ID in metadata exists in database

---

## Production Deployment Checklist

When you're ready to deploy to production:

- [ ] **Update Webhook URL:** Change from dev URL to production URL in Stripe dashboard
- [ ] **Create Production Webhook:** Create a new webhook endpoint in Stripe **live mode** (not test mode)
- [ ] **Update Signing Secret:** Add the new production signing secret to `STRIPE_WEBHOOK_SECRET`
- [ ] **Test Production Webhook:** Send test events from Stripe dashboard in live mode
- [ ] **Monitor Webhook Deliveries:** Check Stripe dashboard regularly for failed deliveries
- [ ] **Set Up Alerts:** Configure alerts for failed webhook deliveries
- [ ] **Implement Retry Logic:** Add retry logic for failed database updates
- [ ] **Add User Notifications:** Send email/SMS to users on payment failures
- [ ] **Implement Grace Period:** Don't immediately downgrade users on first payment failure

---

## Additional Resources

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)
- [Testing Webhooks](https://stripe.com/docs/webhooks/test)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)

---

## Support

If you encounter any issues with the webhook integration:

1. Check the server logs for error messages
2. Review the Stripe dashboard webhook delivery logs
3. Verify the webhook signing secret is correct
4. Test the webhook endpoint manually with the test script
5. Contact Stripe support if the issue persists

**Test Script Location:** `/home/ubuntu/prosper-trading-app/test-webhook.mjs`

Run the test script:
```bash
cd /home/ubuntu/prosper-trading-app
node test-webhook.mjs
```
