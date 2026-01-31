# Subscription Tier Structure

**IMPORTANT:** This document defines the three-tier subscription model to be implemented AFTER paper trading is complete and tested.

---

## Tier 1: Student ($27/month after 2-week free trial)

**Target Audience:** Complete beginners learning options trading basics

### Features
- ✅ Paper trading only (uses shared Tradier API key)
- ✅ Market News & AI Analysis
- ✅ Basic position tracking (view only)
- ✅ Educational content & tutorials
- ✅ Limited to 10 paper positions
- ✅ 2-week free trial, then $27/month
- ❌ No live trading
- ❌ No roll recommendations
- ❌ No order submission

### Registration Requirements
- Email only
- No API keys needed (uses shared Tradier API)

### Trial Period
- 14 days free access
- After trial: Paywall prompt to upgrade to $27/month or lose access

---

## Tier 2: Trader ($97/month)

**Target Audience:** Intermediate traders ready for live trading with guidance

### Features
- ✅ Everything in Student tier
- ✅ Live trading with Tastytrade (requires their API key)
- ✅ Paper trading with their own Tradier API key
- ✅ Roll detection & recommendations
- ✅ Order submission (with confirmation)
- ✅ Unlimited positions
- ✅ Performance analytics
- ✅ Multi-account support (up to 3 accounts)
- ❌ No advanced automation
- ❌ No PMCC/LEAPS strategies

### Registration Requirements
- Tastytrade API key (required)
- Tradier API key (required)
- Payment: $97/month via Stripe

---

## Tier 3: Professional ($197/month)

**Target Audience:** Advanced traders wanting full automation & advanced strategies

### Features
- ✅ Everything in Trader tier
- ✅ Advanced strategies (PMCC, LEAPS, Iron Condors)
- ✅ Automated roll execution (with approval)
- ✅ Smart position sizing & allocation
- ✅ Multi-account support (unlimited)
- ✅ Priority support
- ✅ Custom alerts & notifications
- ✅ API access for custom integrations
- ✅ White-label option for resellers

### Registration Requirements
- Same as Trader tier
- Payment: $197/month via Stripe

---

## Feature Distribution Matrix

| Feature | Student | Trader | Professional |
|---------|---------|--------|--------------|
| Paper Trading | ✅ (Shared API) | ✅ (Own API) | ✅ |
| Live Trading | ❌ | ✅ | ✅ |
| Market News | ✅ | ✅ | ✅ |
| Roll Recommendations | ❌ | ✅ | ✅ |
| Order Submission | ❌ | ✅ (Manual) | ✅ (Auto) |
| Position Limit | 10 | Unlimited | Unlimited |
| Accounts | 1 | 3 | Unlimited |
| Advanced Strategies | ❌ | ❌ | ✅ |
| API Access | ❌ | ❌ | ✅ |

---

## Implementation Phases (To Be Done Later)

### Phase 1: Core Infrastructure
1. Add Stripe integration (`webdev_add_feature stripe`)
2. Add subscription fields to user table:
   - `subscription_tier`: 'student' | 'trader' | 'professional'
   - `subscription_status`: 'trial' | 'active' | 'expired' | 'cancelled'
   - `trial_ends_at`: timestamp
   - `subscription_started_at`: timestamp
3. Create tier checking middleware

### Phase 2: Paywall UI
1. Upgrade modal component
2. Feature badges and locks ("Upgrade to unlock")
3. Trial countdown timer in sidebar
4. Pricing page with feature comparison

### Phase 3: API Key Management
1. Secure key storage (encryption)
2. Key validation on entry (test API call)
3. Key rotation UI
4. Separate storage for Tastytrade and Tradier keys

### Phase 4: Feature Gating
1. Lock live trading for student tier
2. Lock advanced strategies for trader tier
3. Enforce position limits (10 for students)
4. Add tier checks to tRPC procedures:
   ```typescript
   protectedProcedure.use(requireTier('trader'))
   protectedProcedure.use(requireTier('professional'))
   ```

---

## Database Schema Changes (Future)

```typescript
// Add to user table in drizzle/schema.ts
export const user = sqliteTable('user', {
  // ... existing fields ...
  
  // Subscription fields
  subscriptionTier: text('subscription_tier', { 
    enum: ['student', 'trader', 'professional'] 
  }).default('student'),
  subscriptionStatus: text('subscription_status', { 
    enum: ['trial', 'active', 'expired', 'cancelled'] 
  }).default('trial'),
  trialEndsAt: integer('trial_ends_at', { mode: 'timestamp' }),
  subscriptionStartedAt: integer('subscription_started_at', { mode: 'timestamp' }),
  
  // API keys (encrypted)
  tastytradeApiKey: text('tastytrade_api_key'), // null for students
  tradierApiKey: text('tradier_api_key'), // null for students using shared key
  
  // Stripe fields
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
});
```

---

## Notes

- Students use the owner's shared Tradier API key (stored in environment)
- Trader/Professional tiers require users to provide their own API keys
- All API keys stored encrypted in database
- Trial period: 14 days, then requires payment
- Stripe webhooks handle subscription lifecycle events
