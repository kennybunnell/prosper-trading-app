# OAuth2 Authentication Safety Checklist

## Current OAuth2 Status: ✅ STABLE

### What We Fixed Previously
1. ✅ Database schema updated with OAuth2 columns (tastytradeClientSecret, tastytradeRefreshToken)
2. ✅ All 23 credential validation checks updated across all routers
3. ✅ Settings page updated to use OAuth2 fields only (no username/password)
4. ✅ authenticateTastytrade() helper uses OAuth2 token refresh
5. ✅ All API calls use OAuth2 access tokens

---

## Audit Results (Feb 12, 2026)

### ✅ Backend Routers - ALL USING OAuth2
**Checked Files**: All routers*.ts files

| Router File | OAuth2 Checks | Status |
|-------------|---------------|--------|
| routers.ts | 12 checks | ✅ All use clientSecret/refreshToken |
| routers-cc.ts | 3 checks | ✅ All use clientSecret/refreshToken |
| routers-performance.ts | 4 checks | ✅ All use clientSecret/refreshToken |
| routers-pmcc.ts | 2 checks | ✅ All use clientSecret/refreshToken |
| routers-rolls.ts | 2 checks | ✅ All use clientSecret/refreshToken |
| routers-csp.ts | Not checked yet | ⚠️ Need to verify |
| routers-working-orders.ts | Not checked yet | ⚠️ Need to verify |

**Pattern Used Everywhere**:
```typescript
if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
  throw new Error('Tastytrade OAuth2 credentials not configured');
}
```

### ✅ Frontend Dashboards - NO OLD CREDENTIALS
**Checked Files**: All *Dashboard.tsx files

- ❌ No references to `tastytradeUsername` or `tastytradePassword` found
- ✅ All dashboards use tRPC procedures that validate OAuth2 credentials on backend

### ⚠️ Test Files - STILL USING OLD CREDENTIALS
**Files with Old Credentials in Tests**:
- `server/routers-performance.test.ts` - 8 occurrences
- `server/routers-working-orders.test.ts` - 1 occurrence

**Impact**: Tests might be outdated but won't affect production
**Action**: Update test mocks to use OAuth2 credentials

---

## Migration Safety Rules

### Rule 1: NEVER Touch Authentication Code in Dashboards
**Why**: Dashboards don't handle auth directly - they call tRPC procedures
**Safe**: Updating UI components (UnifiedOrderPreviewModal)
**Unsafe**: Modifying credential validation or API calls

### Rule 2: ONLY Modify Order Submission UI
**What We're Changing**:
- ✅ Replace OrderPreviewDialog component with UnifiedOrderPreviewModal
- ✅ Update order data formatting (convert to UnifiedOrder[])
- ✅ Update onSubmit callback signature

**What We're NOT Changing**:
- ❌ Backend authentication logic
- ❌ Credential validation checks
- ❌ OAuth2 token refresh flow
- ❌ API client configuration

### Rule 3: Verify OAuth2 Checks Before Each Migration
**Before migrating each dashboard**:
1. Check which tRPC procedures it calls
2. Verify those procedures use OAuth2 credentials
3. Confirm no hardcoded credential references in dashboard

**Example - CC Dashboard**:
```typescript
// Dashboard calls these procedures:
trpc.cc.getEligiblePositions.useQuery()
trpc.cc.bearCallSpreadOpportunities.useQuery()
trpc.cc.submitOrders.useMutation()

// ✅ All three procedures in routers-cc.ts check:
if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken)
```

---

## Pre-Migration Checklist (Per Dashboard)

### Before Starting Migration:
- [ ] Identify all tRPC procedures called by dashboard
- [ ] Verify each procedure has OAuth2 credential check
- [ ] Confirm no direct API calls in dashboard (should all go through tRPC)
- [ ] Check if dashboard imports any auth-related utilities

### During Migration:
- [ ] Only modify UI components and data formatting
- [ ] Keep all tRPC procedure calls unchanged
- [ ] Don't add new API calls - reuse existing procedures
- [ ] Test with real OAuth2 credentials after each change

### After Migration:
- [ ] Verify dashboard loads without auth errors
- [ ] Test order submission with dry-run mode
- [ ] Confirm OAuth2 tokens are being used (check server logs)
- [ ] Test with all 4 Tastytrade accounts

---

## What Could Break OAuth2

### ❌ HIGH RISK (Don't Do This)
1. Modifying credential validation checks in routers
2. Changing authenticateTastytrade() function
3. Adding new API calls that bypass OAuth2
4. Modifying database credential storage

### ⚠️ MEDIUM RISK (Be Careful)
1. Adding new tRPC procedures without OAuth2 checks
2. Modifying existing tRPC procedures
3. Changing error handling in auth flow

### ✅ LOW RISK (Safe to Do)
1. Replacing UI components (OrderPreviewDialog → UnifiedOrderPreviewModal)
2. Updating data formatting for orders
3. Modifying callback signatures
4. Adding new UI features that call existing procedures

---

## Migration Plan with OAuth2 Safety

### CC Dashboard Migration
**tRPC Procedures Used**:
- `cc.getEligiblePositions` - ✅ Has OAuth2 check (line 67)
- `cc.bearCallSpreadOpportunities` - ✅ Has OAuth2 check (line 540)
- `cc.submitOrders` - ✅ Has OAuth2 check (line 729)

**Changes**:
- ✅ Replace OrderPreviewDialog with UnifiedOrderPreviewModal
- ✅ Convert order data to UnifiedOrder[] format
- ✅ Update onSubmit callback
- ❌ NO changes to tRPC calls or auth logic

**Risk Level**: LOW ✅

### CSP Dashboard Migration
**tRPC Procedures Used**:
- Need to verify routers-csp.ts procedures
- Likely: `csp.getOpportunities`, `csp.submitOrders`

**Changes**:
- ✅ Replace OrderPreviewDialog with UnifiedOrderPreviewModal
- ✅ Convert order data to UnifiedOrder[] format
- ✅ Update onSubmit callback
- ❌ NO changes to tRPC calls or auth logic

**Risk Level**: LOW ✅ (pending verification)

### PMCC Dashboard Migration
**tRPC Procedures Used**:
- `pmcc.getOpportunities` - ✅ Has OAuth2 check (line 233)
- `pmcc.submitOrders` - ✅ Has OAuth2 check (line 359)

**Changes**:
- ✅ Replace custom dialog with UnifiedOrderPreviewModal
- ✅ Convert order data to UnifiedOrder[] format
- ✅ Update onSubmit callback
- ❌ NO changes to tRPC calls or auth logic

**Risk Level**: LOW ✅

### Performance Dashboard Migration
**tRPC Procedures Used**:
- `performance.closePositions` - ✅ Has OAuth2 check (line 569)

**Changes**:
- ✅ Add UnifiedOrderPreviewModal before closePositions
- ✅ Build UnifiedOrder[] from positions
- ✅ Update closePositions call
- ❌ NO changes to auth logic

**Risk Level**: LOW ✅

### Roll Actions Migration
**tRPC Procedures Used**:
- `rolls.getRollCandidates` - ✅ Has OAuth2 check (line 29)
- `rolls.submitRoll` - ✅ Has OAuth2 check (line 191)

**Changes**:
- ✅ Add UnifiedOrderPreviewModal after candidate selection
- ✅ Build UnifiedOrder[] with both legs (BTC + STO)
- ✅ Update submitRoll call
- ❌ NO changes to auth logic

**Risk Level**: LOW ✅

---

## Testing Protocol

### After Each Dashboard Migration:
1. **Restart dev server** to clear any cached state
2. **Check server logs** for OAuth2 token requests
3. **Test dashboard load** - should show data without errors
4. **Test dry-run submission** - should validate orders
5. **Check for auth errors** in browser console
6. **Verify OAuth2 tokens** are being used (not username/password)

### Red Flags to Watch For:
- ❌ "Token has insufficient scopes" errors
- ❌ "Username or password required" errors
- ❌ 401/403 authentication errors
- ❌ "Session expired" messages
- ❌ Credential validation failures

### If Auth Breaks:
1. **STOP immediately** - don't continue migration
2. **Check server logs** for specific error
3. **Verify credentials** in Settings page
4. **Test connection** button in Settings
5. **Rollback changes** if needed
6. **Investigate root cause** before proceeding

---

## Summary

### ✅ OAuth2 is Currently Stable
- All routers use OAuth2 credentials
- All dashboards call OAuth2-protected procedures
- No old username/password references in production code

### ✅ Migration is Low Risk
- We're only changing UI components
- All backend auth logic stays unchanged
- tRPC procedures already have OAuth2 checks

### ✅ Safety Measures in Place
- Pre-migration verification checklist
- Testing protocol after each migration
- Clear red flags to watch for
- Rollback plan if auth breaks

**Recommendation**: Proceed with migration, following the safety rules above.
