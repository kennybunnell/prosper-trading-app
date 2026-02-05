# PREMIUM MULTIPLIER RULES - DEFINITIVE GUIDE

## ⚠️ CRITICAL: Read This Before Touching Any Premium Calculations

This document exists because the premium multiplier issue has regressed multiple times. Follow these rules EXACTLY to prevent future regressions.

---

## The Core Problem

Options premiums are quoted **per-share** but represent contracts of **100 shares**. This creates confusion about when to multiply by 100.

**Example:**
- Premium quote: **$1.37** (per share)
- Actual money received: **$137** (per contract = $1.37 × 100 shares)

---

## Data Format Standard

Throughout the codebase, `opp.premium` and `order.premium` are stored as **per-share dollars**.

```typescript
// Example data
const opportunity = {
  symbol: 'WFC',
  premium: 1.37,  // ← Per-share dollars
  strike: 94.00,
  // ...
};
```

**This is the single source of truth.** All premium values in the database and API responses are per-share dollars.

---

## Display Rules: When to Multiply by 100

### ✅ MULTIPLY by 100 in these contexts:

1. **Order Summary "Total Premium" Card**
   - **Location**: CC Dashboard → Order Summary section
   - **Purpose**: Show total money user will receive
   - **Formula**: `sum(opp.premium × 100)`
   - **Example**: $1.37 × 100 = **$137** ✅
   - **File**: `client/src/pages/CCDashboard.tsx` line ~2270

2. **Order Preview Dialog "TOTALS" Row**
   - **Location**: Order Preview Dialog → Table → Totals row
   - **Purpose**: Show total net credit for all selected orders
   - **Formula**: `sum(adjustedPrice × 100)`
   - **Example**: $1.37 × 100 = **$137** ✅
   - **File**: `client/src/components/OrderPreviewDialog.tsx` line ~450

3. **Final Order Submission**
   - **Location**: Backend order submission logic
   - **Purpose**: Send correct limit price to broker API
   - **Formula**: `premium × 100`
   - **Example**: $1.37 × 100 = **$137** ✅
   - **File**: `server/routers.ts` (order submission procedures)

### ❌ DO NOT MULTIPLY in these contexts:

1. **Dashboard Top Cards "Total Premium"**
   - **Location**: CC Dashboard → Top summary cards
   - **Purpose**: Show per-share premium for quick scanning
   - **Formula**: `sum(opp.premium)` (NO × 100)
   - **Example**: **$1.37** ❌ (per-share, not total)
   - **File**: `client/src/pages/CCDashboard.tsx` line ~415

2. **Opportunities Table "Net Credit" Column**
   - **Location**: CC Dashboard → Opportunities table
   - **Purpose**: Show per-share premium for comparison
   - **Formula**: `opp.premium` (NO × 100)
   - **Example**: **$1.37** ❌ (per-share)
   - **File**: `client/src/pages/CCDashboard.tsx` (table rendering)

3. **Order Preview Dialog "Limit Price" Column**
   - **Location**: Order Preview Dialog → Table → Limit Price column
   - **Purpose**: Show per-share price being sent to broker
   - **Formula**: `adjustedPrice` (NO × 100)
   - **Example**: **$1.37** ❌ (per-share)
   - **File**: `client/src/components/OrderPreviewDialog.tsx` line ~337

4. **Price Adjustment Slider**
   - **Location**: Order Preview Dialog → Price Adjustment slider
   - **Purpose**: Adjust per-share price between bid and ask
   - **Formula**: `interpolate(bid, ask, percentage)` (NO × 100)
   - **Example**: **$1.37** ❌ (per-share)
   - **File**: `client/src/components/OrderPreviewDialog.tsx` (slider logic)

---

## Decision Tree: Should I Multiply by 100?

```
Is this value being displayed to the user?
│
├─ YES → Ask: "Does the user need to know the TOTAL money?"
│   │
│   ├─ YES → ✅ MULTIPLY by 100
│   │   Examples:
│   │   - Order Summary "Total Premium"
│   │   - Order Preview "TOTALS" row
│   │   - Final confirmation screens
│   │
│   └─ NO → ❌ DO NOT MULTIPLY
│       Examples:
│       - Per-share premium in tables
│       - Price adjustment sliders
│       - Comparison columns
│
└─ NO → Is this being sent to an external API?
    │
    ├─ YES → Check API documentation
    │   - Broker APIs usually expect per-share prices
    │   - Internal APIs use per-share by convention
    │
    └─ NO → ❌ DO NOT MULTIPLY (internal calculations use per-share)
```

---

## Common Mistakes and How to Avoid Them

### Mistake #1: "The comment says DO NOT multiply, so I removed it"

**Problem**: Comments were written for a specific context (e.g., dashboard cards) but applied globally.

**Solution**: Check the **Display Rules** section above. The same data needs different treatment in different contexts.

### Mistake #2: "I saw × 100 somewhere, so I added it everywhere"

**Problem**: Multiplying in the wrong places causes values to be 100x too large.

**Solution**: Use the **Decision Tree** above. Only multiply when showing TOTAL money to the user.

### Mistake #3: "I'm not sure, so I'll just try it and see"

**Problem**: This creates regressions that break previously working features.

**Solution**: Read this document FIRST, then check the regression tests in `server/premium-multiplier.test.ts`.

---

## Code Comment Template

Use this template when writing code that handles premiums:

```typescript
// PREMIUM MULTIPLIER RULE: [MULTIPLY | DO NOT MULTIPLY]
// Context: [Order Summary | Dashboard Card | Table Column | API Call]
// Reason: [Show total money | Show per-share for comparison | etc.]
// Example: $1.37 [× 100 = $137 | stays $1.37]
const value = premium [* 100];
```

**Example (Order Summary):**
```typescript
// PREMIUM MULTIPLIER RULE: MULTIPLY
// Context: Order Summary "Total Premium" card
// Reason: Show total money user will receive per contract
// Example: $1.37 × 100 = $137
const totalPremium = opportunities.reduce((sum, opp) => sum + (opp.premium * 100), 0);
```

**Example (Dashboard Card):**
```typescript
// PREMIUM MULTIPLIER RULE: DO NOT MULTIPLY
// Context: Dashboard top card "Total Premium"
// Reason: Show per-share premium for quick scanning across multiple opportunities
// Example: $1.37 stays $1.37
const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium, 0);
```

---

## Regression Prevention

### Automated Tests

All premium calculations have regression tests in:
- `server/cc-dashboard-premium.test.ts`
- `server/order-preview-defaults.test.ts`
- `server/premium-multiplier.test.ts` (NEW - comprehensive test suite)

**These tests MUST pass before any checkpoint is saved.**

### Manual Verification Checklist

Before saving a checkpoint, verify:

- [ ] Order Summary "Total Premium" shows $137 (not $1.37 or $13,700)
- [ ] Dashboard card "Total Premium" shows $1.37 (not $137)
- [ ] Opportunities table "Net Credit" shows $1.37 (not $137)
- [ ] Order Preview "Limit Price" shows $1.37 (not $137)
- [ ] Order Preview "TOTALS" shows $137 (not $1.37)
- [ ] All regression tests pass (`pnpm test`)

---

## Real-World Examples

### Example 1: WFC Covered Call

**Scenario**: Selling 1 covered call on WFC at $94 strike, premium $1.37

| Location | Display | Calculation | Correct Value |
|----------|---------|-------------|---------------|
| Dashboard Card "Total Premium" | Per-share | `1.37` | **$1.37** |
| Opportunities Table "Net Credit" | Per-share | `1.37` | **$1.37** |
| Order Summary "Total Premium" | Total money | `1.37 × 100` | **$137.00** |
| Order Preview "Limit Price" | Per-share | `1.37` | **$1.37** |
| Order Preview "TOTALS" | Total money | `1.37 × 100` | **$137.00** |

### Example 2: Multiple Covered Calls

**Scenario**: Selling 3 covered calls with premiums $1.37, $2.50, $0.84

| Location | Display | Calculation | Correct Value |
|----------|---------|-------------|---------------|
| Dashboard Card "Total Premium" | Per-share sum | `1.37 + 2.50 + 0.84` | **$4.71** |
| Order Summary "Total Premium" | Total money | `(1.37 + 2.50 + 0.84) × 100` | **$471.00** |
| Order Preview "TOTALS" | Total money | `(1.37 + 2.50 + 0.84) × 100` | **$471.00** |

---

## FAQ

### Q: Why not just store premiums as total dollars ($137) instead of per-share ($1.37)?

**A**: Industry standard is per-share quotes. Broker APIs, financial data providers, and user expectations all use per-share pricing. Storing per-share keeps our data consistent with external sources.

### Q: What about spreads (Bull Put, Bear Call)?

**A**: Same rules apply. The `premium` field is the NET CREDIT per share. Multiply by 100 when showing total money.

### Q: I found a place where premium is multiplied by 1000. Is that a bug?

**A**: YES! That's definitely a bug. Premiums should NEVER be multiplied by 1000. The only valid multipliers are:
- × 1 (per-share display)
- × 100 (total money per contract)

### Q: What if I'm still not sure?

**A**: Ask yourself: "If the user sees this number, will they think it's the total money they'll receive?" If YES, multiply by 100. If NO, don't multiply.

---

## Version History

- **v1.0** (2026-02-05): Initial definitive guide created after multiple regressions
- Purpose: Lock in the correct behavior once and for all

---

## Contact

If you're modifying premium calculations and this document doesn't answer your question, **DO NOT PROCEED**. Instead:

1. Read this document again
2. Check the regression tests
3. Ask for clarification before making changes

**Remember**: This issue has regressed multiple times. Taking 10 minutes to understand the rules will save hours of debugging later.
