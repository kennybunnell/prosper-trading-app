# Stripe Webhook Testing Guide

## Webhook Endpoint

Your Stripe webhook endpoint is now live at:
```
https://your-domain.com/api/webhooks/stripe
```

## Setup in Stripe Dashboard

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Enter your webhook URL: `https://your-domain.com/api/webhooks/stripe`
4. Select events to listen for:
   - `checkout.session.completed` - User completes checkout
   - `customer.subscription.created` - New subscription created
   - `customer.subscription.updated` - Subscription upgraded/downgraded
   - `customer.subscription.deleted` - Subscription canceled
   - `invoice.payment_succeeded` - Recurring payment successful
   - `invoice.payment_failed` - Payment failed

5. Copy the **Signing secret** (starts with `whsec_...`)
6. Add it to your environment variables as `STRIPE_WEBHOOK_SECRET`

## Testing with Stripe CLI

### Install Stripe CLI
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Linux
wget https://github.com/stripe/stripe-cli/releases/download/v1.19.4/stripe_1.19.4_linux_x86_64.tar.gz
tar -xvf stripe_1.19.4_linux_x86_64.tar.gz
sudo mv stripe /usr/local/bin/
```

### Login to Stripe
```bash
stripe login
```

### Forward webhooks to local server
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

This will output a webhook signing secret like `whsec_...` - use this for local testing.

### Trigger test events
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

## Manual Testing Flow

### 1. Create Test Checkout Session
```bash
# In your app, navigate to /subscription page
# Click "Upgrade" button for any tier
# This will create a Stripe checkout session
```

### 2. Complete Test Payment
Use Stripe test cards:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0027 6000 3184`

Any future expiry date and any 3-digit CVC.

### 3. Verify Webhook Processing
Check your server logs for:
```
[Stripe Webhook] Received event: checkout.session.completed ID: evt_...
[Stripe Webhook] Checkout session completed: cs_...
[Stripe Webhook] Upgrading user 123 to tier: wheel_trading
[Stripe Webhook] User updated successfully: 123
```

### 4. Verify Database Update
Check that the user's `subscriptionTier` was updated in the database:
```sql
SELECT id, email, subscriptionTier, stripeCustomerId, stripeSubscriptionId 
FROM users 
WHERE id = YOUR_USER_ID;
```

## Webhook Event Flow

### New Subscription (Trial → Paid Tier)
1. User clicks "Upgrade" → `createCheckoutSession` creates Stripe session
2. User completes payment → Stripe sends `checkout.session.completed`
3. Webhook handler updates user:
   - Sets `stripeCustomerId`
   - Sets `stripeSubscriptionId`
   - Updates `subscriptionTier` to target tier
4. Stripe sends `customer.subscription.created` (redundant, but logged)

### Subscription Upgrade (Tier 2 → Tier 3)
1. User clicks "Upgrade" → Creates new checkout session
2. User completes payment → Stripe sends `checkout.session.completed`
3. Webhook handler updates `subscriptionTier` to new tier
4. Stripe sends `customer.subscription.updated`

### Subscription Renewal (Monthly Payment)
1. Stripe automatically charges customer
2. Stripe sends `invoice.payment_succeeded`
3. Webhook logs payment (no tier change needed)

### Subscription Cancellation
1. User clicks "Cancel" → App calls `stripe.subscriptions.update` with `cancel_at_period_end: true`
2. At period end, Stripe sends `customer.subscription.deleted`
3. Webhook handler downgrades user to `free_trial`

### Payment Failure
1. Stripe attempts to charge card
2. Payment fails → Stripe sends `invoice.payment_failed`
3. Webhook logs failure
4. After multiple failures, Stripe sends `customer.subscription.deleted`

## Troubleshooting

### Webhook signature verification failed
- Ensure `STRIPE_WEBHOOK_SECRET` is set correctly
- Check that webhook endpoint receives raw body (not parsed JSON)
- Verify Stripe CLI is forwarding to correct URL

### User tier not updating
- Check server logs for webhook processing errors
- Verify `user_id` is in session metadata
- Ensure database connection is working

### Duplicate events
- Stripe may send duplicate events - ensure handlers are idempotent
- Check for multiple webhook endpoints in Stripe dashboard

## Production Checklist

- [ ] Add `STRIPE_WEBHOOK_SECRET` to production environment variables
- [ ] Configure webhook endpoint in Stripe dashboard (production mode)
- [ ] Test all webhook events in production
- [ ] Monitor webhook delivery in Stripe dashboard
- [ ] Set up alerts for failed webhooks
- [ ] Implement retry logic for failed database updates
- [ ] Add user notifications for payment failures
- [ ] Implement grace period before downgrading on payment failure
