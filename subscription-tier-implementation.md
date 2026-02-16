# Subscription Tier Implementation Plan

## Phase 1: Rate Limiting & Security

### Rate Limiting for Shared Tradier API (Tier 1)
- [x] Create `apiUsage` table to track daily scan counts per user
- [x] Add rate limiting middleware: check usage before allowing scans
- [x] Set limit: 10 scans per day for `subscriptionTier = 'free_trial'`
- [x] Show upgrade prompt when limit reached: "You've reached your daily scan limit (10/day). Upgrade to Wheel View ($47/month) to get unlimited scans. Note: You'll need your own Tradier API key, which requires a funded brokerage account."
- [x] Reset counters daily (automatic via date-based tracking)
- [ ] Add admin dashboard to monitor shared API usage

### Security Audit: Hide Shared Tradier API Key
- [ ] Audit all server routes to ensure `TRADIER_API_KEY` is never exposed
- [ ] Verify env var is only used server-side (never sent to frontend)
- [ ] Check all API responses for accidental key leakage
- [ ] Add test: verify frontend cannot access `TRADIER_API_KEY`
- [ ] Document: Shared key is read-only (Greeks/quotes only, no orders)

## Phase 2: Database Schema Update

### 4-Tier Subscription Structure
- [x] Update `users` table `subscriptionTier` enum:
  - Current: `["free_trial", "wheel", "advanced"]`
  - New: `["free_trial", "wheel_view", "wheel_trading", "advanced"]`
- [x] Add migration script to update existing users
- [x] Add `trialStartedAt` timestamp field (track 14-day trial)
- [x] Add `apiCredentialsVerified` boolean (required for Tier 3 upgrade)
- [x] Run `pnpm db:push` to apply schema changes (manually altered database enums)

## Phase 3: Subscription Tier Enforcement

### Middleware Implementation
- [x] Create `checkSubscriptionTier` middleware function
- [x] Bypass ALL checks for `role: 'owner'` or `role: 'admin'`
- [x] Tier 1 (free_trial): Paper trading only, shared Tradier API, 10 scans/day
- [x] Tier 2 (wheel_view): Paper trading only, requires own Tradier API, unlimited scans
- [x] Tier 3 (wheel_trading): Live trading, requires Tradier + Tastytrade, CSP + CC only
- [x] Tier 4 (advanced): Live trading, all strategies (BPS, BCS, Iron Condor, PMCC)

### Feature Gating
- [ ] Block live trading for Tier 1-2 (already implemented)
- [ ] Block BPS/BCS/Iron Condor/PMCC dashboards for Tier 3 users
- [ ] Show upgrade prompts with clear pricing when blocked
- [ ] Add "Upgrade" button in navigation for lower-tier users
- [ ] Require API credentials before allowing Tier 3 upgrade

## Phase 4: Stripe Integration

### Stripe Products & Prices
- [ ] Create Stripe products:
  - Tier 2: "Wheel View" - $47/month recurring + $99 setup fee (one-time)
  - Tier 3: "Wheel Trading" - $97/month recurring + $300 setup fee (one-time)
  - Tier 4: "Advanced Spreads" - $200/month recurring (no setup fee - already configured in Tier 3)
- [ ] Configure webhook endpoint: `/api/stripe/webhook`
- [ ] Handle webhook events:
  - `checkout.session.completed` - upgrade user tier
  - `invoice.paid` - confirm subscription active
  - `customer.subscription.deleted` - downgrade user tier
  - `customer.subscription.updated` - handle tier changes

### Checkout Flow
- [ ] Create checkout page with tier selection
- [ ] Tier 2: Direct checkout (no prerequisites)
- [ ] Tier 3: Require Tradier + Tastytrade credentials first, then checkout
- [ ] Tier 4: Same as Tier 3
- [ ] Add setup fee to Tier 3/4 checkout sessions
- [ ] Redirect to success page after payment
- [ ] Send confirmation email with onboarding instructions

### API Credential Management
- [ ] Add "API Credentials" settings page
- [ ] Tier 1: Show message "Upgrade to Wheel View to add your own Tradier API"
- [ ] Tier 2: Allow Tradier API input only
- [ ] Tier 3+: Allow both Tradier + Tastytrade credentials
- [ ] Test credentials before saving (validate with API calls)
- [ ] Block Tier 3 upgrade if credentials not verified

## Phase 5: Testing & Delivery

### Testing Checklist
- [ ] Test Tier 1: 14-day trial, shared API, rate limiting, paper trading only
- [ ] Test Tier 2: Own Tradier API, unlimited scans, paper trading only
- [ ] Test Tier 3: Live trading CSP+CC, blocked from spreads
- [ ] Test Tier 4: All strategies unlocked
- [ ] Test owner/admin bypass (kennybunnell@gmail.com)
- [ ] Test Stripe checkout flow for each tier
- [ ] Test webhook handling (subscription created/canceled)
- [ ] Test credential verification before Tier 3 upgrade

### Stripe Setup Walkthrough for User
- [ ] Document: Create Stripe products and prices
- [ ] Document: Configure webhook endpoint URL
- [ ] Document: Test webhook with Stripe CLI
- [ ] Document: Enable live mode and update keys
- [ ] Document: Set setup fee amounts for Tier 3/4

## Security Firewall Checklist

### Owner Account Protection (kennybunnell@gmail.com)
- [x] Account has `role: 'admin'` in database
- [ ] Update to also include `role: 'owner'` flag
- [ ] Bypass all subscription tier checks for owner/admin
- [ ] Owner credentials NEVER shared with any customer
- [ ] Owner data isolated by `userId` in all queries

### Customer Tenant Isolation
- [x] All database queries filter by `userId`
- [x] Each customer has separate API credentials
- [ ] Tier 1 uses shared Tradier API (read-only, rate-limited)
- [ ] Tier 2+ uses customer's own Tradier API
- [ ] Tier 3+ uses customer's own Tastytrade credentials
- [ ] No customer can access owner's data or credentials

### API Key Security
- [x] Shared Tradier API key stored as server-side env var only
- [ ] Never exposed to frontend or API responses
- [ ] Rate limiting prevents abuse
- [ ] Monitor usage and quota
- [ ] Owner's personal Tastytrade credentials never shared

## Tier Comparison Table

| Feature | Tier 1 (Free Trial) | Tier 2 (Wheel View) | Tier 3 (Wheel Trading) | Tier 4 (Advanced) |
|---------|---------------------|---------------------|------------------------|-------------------|
| **Price** | $0 (14 days) | $47/month + $99 setup | $97/month + $300 setup | $200/month (no setup) |
| **Trading Mode** | Paper only | Paper only | Live trading | Live trading |
| **Tradier API** | Shared (owner's) | Own (required) | Own (required) | Own (required) |
| **Tastytrade** | Not needed | Not needed | Own (required) | Own (required) |
| **Scan Limit** | 5-10/day | Unlimited | Unlimited | Unlimited |
| **CSP Strategy** | ✓ (paper) | ✓ (paper) | ✓ (live) | ✓ (live) |
| **CC Strategy** | ✓ (paper) | ✓ (paper) | ✓ (live) | ✓ (live) |
| **BPS Strategy** | ✗ | ✗ | ✗ | ✓ (live) |
| **BCS Strategy** | ✗ | ✗ | ✗ | ✓ (live) |
| **Iron Condor** | ✗ | ✗ | ✗ | ✓ (live) |
| **PMCC Strategy** | ✗ | ✗ | ✗ | ✓ (live) |
| **Setup Fee** | $0 | $99 (one-time) | $300 (one-time) | $0 (already set up) |
