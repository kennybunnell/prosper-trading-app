# User Onboarding System Documentation

## Overview

The onboarding system ensures that every new user receives a complete set of essential starter data when they first register or log in. This includes default watchlist symbols and filter presets for all five trading strategies.

## Architecture

### Core Files

1. **`server/onboarding-config.ts`** - Master configuration file
   - Single source of truth for all default user data
   - Contains default watchlist symbols (35 tech stocks)
   - Contains preset values for all 5 strategies (CSP, CC, PMCC, BPS, BCS)
   - Each strategy has 3 presets: conservative, medium, aggressive

2. **`server/onboarding.ts`** - Onboarding service
   - `onboardNewUser(userId)` - Main function that seeds all data
   - `isUserOnboarded(userId)` - Checks if user has been onboarded
   - `getOnboardingStatus(userId)` - Returns detailed onboarding status
   - Idempotent: safe to run multiple times

3. **`server/routers-admin.ts`** - Admin utilities
   - `admin.exportUserData` - Export current user's data as template
   - `admin.validateOnboardingConfig` - Validate configuration integrity
   - `admin.triggerOnboarding` - Manually trigger onboarding for a user

### Integration Points

The onboarding system is automatically triggered in two places:

1. **User Registration** (`server/db.ts` - `upsertUser` function)
   - When a new user is created, `onboardNewUser()` is called automatically
   - Runs in the background without blocking the registration flow

2. **Strategy Dashboard Access** (existing seeding functions)
   - Each strategy router has auto-seeding logic as a fallback
   - If presets don't exist when accessing a dashboard, they're created on-demand

## Default Data

### Watchlist (35 symbols)

Tech stocks across different categories:
- **Mag 7**: AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA
- **Streaming**: NFLX, DIS, PARA
- **Semiconductors**: AMD, INTC, QCOM, AVGO, MU, AMAT
- **Enterprise Software**: ORCL, CRM, ADBE, NOW, WDAY
- **Payments**: PYPL, SQ, V, MA
- **E-commerce**: SHOP, EBAY
- **Rideshare**: UBER, LYFT
- **Cloud**: SNOW, DDOG, NET

### Filter Presets

Each strategy (CSP, CC, PMCC, BPS, BCS) has 3 presets with these parameters:

**Parameters:**
- Min/Max DTE (Days to Expiration)
- Min/Max Delta
- Min Open Interest
- Min Volume
- Min/Max RSI
- Min/Max IV Rank
- Min/Max BB %B (Bollinger Band Position)
- Min Score
- Max Strike % of Stock Price

**Preset Philosophy:**
- **Conservative**: Lower delta, wider DTE range, higher quality thresholds
- **Medium**: Balanced parameters for moderate risk/reward
- **Aggressive**: Higher delta, tighter DTE range, lower quality thresholds

## Updating Default Values

### Method 1: Direct Configuration Edit

1. Edit `server/onboarding-config.ts`
2. Update the preset values or watchlist symbols
3. Save and restart the server
4. New users will get the updated values automatically

### Method 2: Export from Existing User

1. Log in as a user with ideal preset configurations
2. Call `trpc.admin.exportUserData.query()` from browser console
3. Copy the returned JSON structure
4. Paste into `onboarding-config.ts`
5. Restart server

## Admin Operations

### Export User Data as Template

```typescript
// From browser console (must be logged in)
const data = await trpc.admin.exportUserData.query();
console.log(JSON.stringify(data, null, 2));
```

Returns:
```json
{
  "presets": {
    "csp": {
      "conservative": { ...preset values... },
      "medium": { ...preset values... },
      "aggressive": { ...preset values... }
    },
    ...
  },
  "watchlist": ["AAPL", "MSFT", ...]
}
```

### Validate Configuration

```typescript
// From browser console
const validation = await trpc.admin.validateOnboardingConfig.query();
console.log(validation);
```

Returns:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "summary": {
    "watchlistCount": 35,
    "strategiesCount": 5,
    "presetsPerStrategy": 3
  }
}
```

### Manually Trigger Onboarding

```typescript
// From browser console (admin only)
const result = await trpc.admin.triggerOnboarding.mutate({ userId: 12345 });
console.log(result);
```

## Testing

### Configuration Validation Tests

The test suite (`server/onboarding.test.ts`) includes validation tests that verify:

1. ✅ Watchlist has at least 10 symbols
2. ✅ All 5 strategies have preset configurations
3. ✅ Each strategy has all 3 presets (conservative, medium, aggressive)
4. ✅ All DTE ranges are valid (min ≤ max, min > 0)
5. ✅ All delta ranges are valid (min ≤ max, 0 < delta ≤ 1)

Run tests:
```bash
pnpm test onboarding
```

### Manual Testing

1. Create a new test user account
2. Check that watchlist is populated with 35 symbols
3. Navigate to each strategy dashboard (CSP, CC, PMCC, BPS, BCS)
4. Verify that preset filters work correctly
5. Check Settings page to see all presets are configured

## Troubleshooting

### User Not Getting Default Data

**Symptom**: New user has empty watchlist or missing presets

**Solution**:
1. Check server logs for onboarding errors
2. Manually trigger onboarding: `trpc.admin.triggerOnboarding.mutate({ userId })`
3. Verify database connection is working

### Preset Values Not Matching Configuration

**Symptom**: User's presets don't match `onboarding-config.ts`

**Cause**: User was onboarded before configuration was updated

**Solution**:
1. Delete user's existing presets from database
2. Trigger onboarding again
3. Or: User can manually update presets in Settings page

### Configuration Validation Errors

**Symptom**: `validateOnboardingConfig` returns errors

**Solution**:
1. Check error messages for specific issues
2. Fix invalid ranges (e.g., min > max)
3. Ensure all required fields are present
4. Verify data types match schema

## Future Enhancements

- [ ] Add UI for admins to update default configurations
- [ ] Version control for onboarding configurations
- [ ] A/B testing different default presets
- [ ] User onboarding analytics dashboard
- [ ] Bulk re-onboarding for existing users after config updates
