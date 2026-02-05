# Order Preview Dialog Calculations Audit

## Overview
This document audits all calculations in the Order Preview Dialog for both Covered Calls (CC) and Bear Call Spreads (BCS).

## Data Format Standards

### Premium Values
- **Format**: Per-share dollars (e.g., $2.61)
- **DO NOT multiply by 100** - the value already represents the per-contract amount
- **Example**: If premium = 2.61, this means $2.61 per share × 100 shares = $261 total per contract
- **Display**: Show as-is without multiplication

### Collateral Values
- **Covered Calls**: Stock value = currentPrice × 100 (per contract)
- **Bear Call Spreads**: Spread width × 100 (per contract)

## Covered Call Calculations

### 1. Individual Order Row
- **Symbol**: Stock ticker
- **Strategy Badge**: "CC" (amber colored)
- **Strike**: Option strike price
- **Expiration**: Option expiration date
- **Quantity**: Number of contracts
- **Limit Price**: Adjusted premium price (per-share dollars)
- **Price Adjustment**: Slider from bid to ask with Fill zone marker at 85%
- **Capital Risk**: Stock value = currentPrice × 100

### 2. Totals Row
- **Total Premium**: Sum of all adjusted prices (per-share dollars)
  ```typescript
  const total = orders.reduce((sum, order, idx) => {
    const currentPrice = adjustedPrices.get(idx) ?? order.premium;
    return sum + currentPrice; // Already in per-contract dollars
  }, 0);
  ```
- **Total Collateral**: Sum of all capital risk values
  ```typescript
  ${totalCollateral.toLocaleString()}
  ```

### 3. Summary Cards (Covered Calls Only)
- **Total Stock Value**
  - Value: `totalCollateral` (sum of all stock values)
  - Subtitle: `{contracts} contracts × 100 shares`
  
- **Total Premium Income**
  - Value: Sum of adjusted prices (same as Total Premium in table)
  - Subtitle: `{percentage}% return on stock value`
  - Calculation: `(totalPremium / totalCollateral) × 100`
  
- **Total Orders**
  - Value: Number of orders
  - Subtitle: Total number of contracts

## Bear Call Spread Calculations

### 1. Individual Order Row
- **Symbol**: Stock ticker
- **Strategy Badge**: "Bear Call Spread" (blue colored)
- **Strikes**: `$shortStrike/$longStrike` with spread width
- **Expiration**: Option expiration date
- **Quantity**: Number of contracts
- **Limit Price**: Net premium received (per-share dollars)
- **Price Adjustment**: Slider from bid to ask with Fill zone marker at 85%
- **Capital Risk**: Spread width × 100

### 2. Totals Row
- **Total Premium**: Sum of all adjusted net premiums
- **Total Collateral**: Sum of all capital risk (spread widths × 100)

### 3. Summary Cards (Spreads Only)
- **Available Buying Power**
  - Value: Account buying power
  - Note: Required because spreads tie up capital
  
- **Remaining After Orders**
  - Value: `availableBuyingPower - totalCollateral`
  - Color: Red if < 20% remaining, green otherwise
  - Subtitle: Percentage remaining
  
- **Total Orders**
  - Value: Number of orders
  - Subtitle: Total number of contracts

## Key Differences: CC vs BCS

| Aspect | Covered Calls | Bear Call Spreads |
|--------|--------------|-------------------|
| **Buying Power** | Not required (already own stock) | Required (capital at risk) |
| **Collateral** | Stock value (currentPrice × 100) | Spread width × 100 |
| **Summary Cards** | Stock Value + Premium Income | Buying Power + Remaining BP |
| **Strategy Badge** | "CC" (amber) | "Bear Call Spread" (blue) |
| **Premium Calculation** | Bid price per share | Net credit (short - long) |

## Common Pitfalls to Avoid

### ❌ DO NOT multiply premium by 100
```typescript
// WRONG
const totalPremium = orders.reduce((sum, o) => sum + (o.premium * 100), 0);

// CORRECT
const totalPremium = orders.reduce((sum, o) => sum + o.premium, 0);
```

### ❌ DO NOT show buying power for covered calls
```typescript
// WRONG - Shows buying power for all strategies
<div>Available Buying Power: ${availableBuyingPower}</div>

// CORRECT - Conditional display
{orders.some(o => o.isSpread) ? (
  <div>Available Buying Power: ${availableBuyingPower}</div>
) : (
  <div>Total Stock Value: ${totalCollateral}</div>
)}
```

### ❌ DO NOT use "CSP" badge for covered calls
```typescript
// WRONG
<Badge>CSP</Badge>

// CORRECT
<Badge>CC</Badge>
```

## Validation Rules

### For All Orders
1. Premium must be > 0
2. Collateral must be > 0
3. Expiration must be in the future
4. Quantity must be > 0

### For Covered Calls
1. Must have stock position with sufficient shares (quantity × 100)
2. Strike should be at or above current price (OTM)
3. Premium should be reasonable (0.5% - 5% of stock value per month)

### For Bear Call Spreads
1. Long strike must be > short strike
2. Spread width must be > 0
3. Total collateral must be ≤ available buying power
4. Net premium must be > 0 (credit spread)

## Testing Checklist

- [ ] Premium values display correctly without multiplication
- [ ] Collateral calculations match strategy type
- [ ] Summary cards show correct metrics for CC vs BCS
- [ ] Strategy badges show "CC" for covered calls
- [ ] Buying power cards hidden for covered calls
- [ ] Return on stock value calculated correctly for CC
- [ ] Remaining buying power calculated correctly for BCS
- [ ] Totals row sums all values correctly
- [ ] Price adjustment slider works correctly
- [ ] Fill zone marker appears at 85% position

## Regression Tests

See `server/cc-dashboard-premium.test.ts` for automated tests that verify:
- Premium values are not multiplied by 100
- Total premium calculation is correct
- Edge cases (zero premium, empty selection, etc.)
- Regression prevention (will fail if * 100 is added back)
