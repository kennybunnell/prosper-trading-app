# Help Badge Recommendations - Prioritized List

## Priority 1: Critical Trading Concepts (High Impact, High Confusion Risk)

### 1. **Delta** (Table Column Header - All Dashboards)
**Location:** CSP Dashboard, CC Dashboard, PMCC Dashboard - Options table header
**Format:** Tooltip on hover
**Content:**
```
Delta measures how much an option's price changes per $1 move in the stock.

For Puts (CSP/Bull Put Spreads):
• -0.30 Delta = 30% probability of being ITM at expiration
• Lower delta (closer to 0) = Safer, less premium
• Higher delta (closer to -1) = Riskier, more premium

For Calls (CC/Bear Call Spreads):
• 0.30 Delta = 30% probability of being ITM at expiration
• Lower delta (closer to 0) = Safer, less premium
• Higher delta (closer to 1) = Riskier, more premium

Target Ranges:
• Conservative: 0.15-0.25 (15-25% probability)
• Medium: 0.25-0.35 (25-35% probability)
• Aggressive: 0.35-0.45 (35-45% probability)
```

### 2. **DTE (Days to Expiration)** (Table Column Header - All Dashboards)
**Location:** All dashboards - Options table header
**Format:** Tooltip on hover
**Content:**
```
Days to Expiration - Time until the option contract expires.

Sweet Spot: 21-45 DTE
• Optimal balance of premium and theta decay
• Enough time for stock to move in your favor
• Not too far out (lower premium per day)

Why This Range?
• <21 DTE: Gamma risk increases (rapid delta changes)
• 21-45 DTE: Maximum theta decay efficiency
• >45 DTE: Lower weekly returns, capital tied up longer

Weekly Options (7 DTE):
• Higher weekly returns but riskier
• Less room for stock to recover
• Best for experienced traders only
```

### 3. **RSI (Relative Strength Index)** (Table Column Header - All Dashboards)
**Location:** All dashboards - Options table header
**Format:** Tooltip on hover
**Content:**
```
RSI measures whether a stock is overbought or oversold (0-100 scale).

For Cash-Secured Puts:
🟢 20-35: Oversold - Good entry for bullish trades
🟡 15-20 or 35-45: Caution zone
🔴 <15 or >45: Avoid - stock may continue falling

For Covered Calls:
🟢 65-80: Overbought - Good entry for bearish trades
🟡 55-65 or 80-85: Caution zone
🔴 <55 or >85: Avoid - stock may continue rising

How to Use:
• RSI <30: Stock is oversold (potential bounce)
• RSI >70: Stock is overbought (potential pullback)
• Combine with other indicators for confirmation
```

### 4. **Bollinger Bands %B** (Table Column Header - All Dashboards)
**Location:** All dashboards - Options table header
**Format:** Tooltip on hover
**Content:**
```
BB %B shows where price is relative to Bollinger Bands (0-1 scale).

For Cash-Secured Puts:
🟢 0.00-0.20: Near lower band - oversold, good entry
🟡 0.20-0.40: Below middle - moderate
🔴 0.40-1.00: Above middle - avoid

For Covered Calls:
🟢 0.80-1.00: Near upper band - overbought, good entry
🟡 0.60-0.80: Above middle - moderate
🔴 0.00-0.60: Below middle - avoid

What It Means:
• 0.00: Price at lower band (oversold)
• 0.50: Price at middle band (neutral)
• 1.00: Price at upper band (overbought)
```

### 5. **IV Rank** (Table Column Header - All Dashboards)
**Location:** All dashboards - Options table header
**Format:** Tooltip on hover
**Content:**
```
IV Rank shows where current implied volatility sits relative to its 52-week range (0-100%).

Target Ranges:
🟢 50-100%: High IV - Great for selling options (higher premiums)
🟡 30-50%: Moderate IV - Acceptable premiums
🔴 0-30%: Low IV - Poor premiums, consider waiting

Why It Matters:
• High IV = Higher option premiums (better for sellers)
• Low IV = Lower option premiums (better for buyers)
• Sell when IV is high, buy when IV is low

Example:
• IV Rank 80% = Current IV is higher than 80% of past year
• Expect premiums to be above average
```

---

## Priority 2: Strategy-Specific Concepts (Medium Impact, Strategy Confusion)

### 6. **Spread Width Selection** (Already Implemented ✅)
**Location:** CSP Dashboard & CC Dashboard - Strategy Type section
**Status:** Already added with comprehensive dialog

### 7. **Net Credit** (Table Column Header - Spread Mode Only)
**Location:** CSP Dashboard (Bull Put Spread), CC Dashboard (Bear Call Spread)
**Format:** Tooltip on hover
**Content:**
```
Net Credit = Premium received from short leg - Premium paid for long leg

Example Bull Put Spread:
• Sell $400 put for $2.50 (receive $250)
• Buy $395 put for $0.50 (pay $50)
• Net Credit: $2.00 ($200 per contract)

This is the maximum profit you can make on the spread.

Higher Net Credit = More profit potential
Lower Net Credit = Less profit, but safer strikes
```

### 8. **Capital at Risk** (Table Column Header - Spread Mode Only)
**Location:** CSP Dashboard (Bull Put Spread), CC Dashboard (Bear Call Spread)
**Format:** Tooltip on hover
**Content:**
```
Capital at Risk = Spread Width - Net Credit

Example Bull Put Spread:
• Spread Width: $5.00 ($400 - $395)
• Net Credit: $2.00
• Capital at Risk: $3.00 ($300 per contract)

This is the maximum loss if both strikes expire ITM.

Why It Matters:
• Determines buying power required
• Lower capital risk = More contracts possible
• Spread ROC = Net Credit / Capital at Risk
```

### 9. **Spread ROC (Return on Capital)** (Table Column Header - Spread Mode Only)
**Location:** CSP Dashboard (Bull Put Spread), CC Dashboard (Bear Call Spread)
**Format:** Tooltip on hover
**Content:**
```
Spread ROC = (Net Credit / Capital at Risk) × 100

Example Bull Put Spread:
• Net Credit: $2.00
• Capital at Risk: $3.00
• Spread ROC: 66.7%

Target Ranges:
🟢 >50%: Excellent return on capital
🟡 30-50%: Good return
🔴 <30%: Consider wider spread or different strike

Compare to CSP:
• CSP ROC: ~2-5% (premium / full collateral)
• Spread ROC: ~40-80% (premium / capital at risk)
• Spreads are more capital efficient!
```

### 10. **Breakeven Price** (Spread Comparison Section)
**Location:** CSP Dashboard (Bull Put Spread), CC Dashboard (Bear Call Spread)
**Format:** Tooltip on hover
**Content:**
```
Breakeven = Strike price where you start losing money

For Bull Put Spreads:
• Breakeven = Short Strike - Net Credit
• Example: $400 short - $2.00 credit = $398 breakeven
• Stock can drop to $398 before you lose money

For Bear Call Spreads:
• Breakeven = Short Strike + Net Credit
• Example: $400 short + $2.00 credit = $402 breakeven
• Stock can rise to $402 before you lose money

Profit Zone:
• Bull Put: Stock stays above breakeven
• Bear Call: Stock stays below breakeven
```

---

## Priority 3: Risk Management (Medium Impact, Safety Critical)

### 11. **Buying Power Usage** (Summary Card)
**Location:** All dashboards - Buying Power summary card
**Format:** Dialog (click ℹ️ icon)
**Content:**
```
Buying Power Usage = (Total Collateral / Available Buying Power) × 100

Risk Levels:
🟢 <50%: Conservative - Safe allocation
🟡 50-80%: Moderate - Balanced risk
🔴 >80%: Aggressive - High risk, limited flexibility

Why It Matters:
• Leaves room for adjustments if trades go against you
• Allows adding new positions if opportunities arise
• Prevents margin calls or forced liquidations

Best Practice:
• Never use >80% of buying power
• Keep 20-30% cash reserve for emergencies
• Consider reducing position sizes if approaching 80%
```

### 12. **Concentration Risk** (Dry Run Preview Dialog)
**Location:** Order Preview Dialog - Warning section
**Format:** Tooltip on hover
**Content:**
```
Concentration Risk = Having too much capital in a single stock

Warning Threshold: >20% in one symbol

Example:
• Total collateral: $10,000
• META positions: $2,500 (25%)
• ⚠️ High concentration risk!

Why It Matters:
• Single stock event can wipe out significant capital
• Reduces diversification benefits
• Increases portfolio volatility

Best Practice:
• Limit any single stock to 10-15% of portfolio
• Spread risk across 8-12 different stocks
• Consider reducing position size if concentrated
```

### 13. **Market Hours Indicator** (Dry Run Preview Dialog)
**Location:** Order Preview Dialog - Status section
**Format:** Tooltip on hover
**Content:**
```
Market Hours: 9:30 AM - 4:00 PM ET (Mon-Fri)

🟢 Market Open: Orders execute immediately
🔴 Market Closed: Orders queue for next open

After-Hours Trading:
• Extended hours: 4:00 AM - 9:30 AM, 4:00 PM - 8:00 PM
• Lower liquidity, wider spreads
• Not recommended for options

Best Practice:
• Submit orders during regular hours for best fills
• Avoid first/last 30 minutes (highest volatility)
• Best fills typically 10:00 AM - 3:00 PM ET
```

---

## Priority 4: Filtering & Selection (Low Impact, UX Enhancement)

### 14. **Preset Filters** (Filter Buttons)
**Location:** All dashboards - Conservative/Medium/Aggressive buttons
**Format:** Tooltip on hover
**Content:**
```
Preset Filters apply pre-configured criteria for different risk levels.

Conservative:
• Lower delta (safer strikes)
• Stricter RSI/BB requirements
• Higher liquidity requirements
• Fewer opportunities, higher quality

Medium:
• Balanced delta range
• Moderate technical requirements
• Good balance of safety and premium

Aggressive:
• Higher delta (more premium)
• Relaxed technical requirements
• More opportunities, higher risk

Customize in Settings:
• Adjust each preset's parameters
• Save your own risk preferences
• Load recommended values anytime
```

### 15. **Score Calculation** (Score Column Header)
**Location:** All dashboards - Score column header
**Format:** Dialog (click ℹ️ icon)
**Content:**
```
Composite Score (0-100) combines multiple factors:

Weighted Components:
• Weekly Return %: 30% weight
• Delta: 20% weight
• RSI: 15% weight
• Bollinger Bands %B: 15% weight
• IV Rank: 10% weight
• Bid/Ask Spread: 10% weight

Score Ranges:
🟢 80-100: Excellent opportunity
🟢 70-79: Very good
🟡 60-69: Good
🟡 50-59: Acceptable
🔴 <50: Marginal

How to Use:
• Higher scores = Better risk/reward
• Use score to compare similar opportunities
• Don't rely on score alone - check all metrics
```

### 16. **Open Interest & Volume** (Table Column Headers)
**Location:** All dashboards - OI and Volume columns
**Format:** Tooltip on hover
**Content:**
```
Open Interest = Total number of outstanding contracts
Volume = Contracts traded today

Liquidity Thresholds:
🟢 OI >500, Vol >100: Excellent liquidity
🟡 OI 200-500, Vol 50-100: Adequate liquidity
🔴 OI <200, Vol <50: Poor liquidity (avoid)

Why It Matters:
• High liquidity = Tighter bid/ask spreads
• Easier to enter/exit positions
• Better fill prices
• Lower slippage

Best Practice:
• Avoid options with OI <200
• Prefer OI >1000 for large positions
• Check both OI and volume together
```

---

## Priority 5: Advanced Features (Low Impact, Power User Features)

### 17. **Dry Run Mode** (Order Submission)
**Location:** All dashboards - Dry Run checkbox
**Format:** Tooltip on hover
**Content:**
```
Dry Run Mode validates orders without submitting them.

What It Does:
✓ Checks buying power availability
✓ Validates strike prices and dates
✓ Calculates total collateral
✓ Shows concentration warnings
✗ Does NOT submit real orders

Use Cases:
• Test order batches before going live
• Verify buying power calculations
• Practice order submission workflow
• Check for validation errors

Always test with dry run first!
```

### 18. **Watchlist Portfolio Size** (Watchlist Section)
**Location:** CSP Dashboard, PMCC Dashboard - Watchlist section
**Format:** Tooltip on hover
**Content:**
```
Portfolio Size categorizes stocks by price for capital allocation:

Small ($0-$50):
• Lower capital requirement per contract
• Good for smaller accounts (<$50K)
• Examples: F, AAL, SNAP

Medium ($51-$150):
• Moderate capital requirement
• Good for medium accounts ($50K-$200K)
• Examples: AMD, INTC, PLTR

Large ($151+):
• Higher capital requirement
• Good for larger accounts (>$200K)
• Examples: GOOGL, AMZN, TSLA

Use portfolio size filters to match your account size.
```

### 19. **Weekly Return %** (Table Column Header)
**Location:** All dashboards - Weekly % column
**Format:** Tooltip on hover
**Content:**
```
Weekly Return % = Annualized return normalized to weekly basis

Calculation:
• Weekly % = (Premium / Collateral) × (7 / DTE) × 100

Example:
• Premium: $200
• Collateral: $10,000
• DTE: 30 days
• Weekly %: ($200 / $10,000) × (7 / 30) × 100 = 0.47%

Target Ranges:
🟢 >1.0%: Excellent weekly return
🟡 0.5-1.0%: Good weekly return
🔴 <0.5%: Marginal return

Annualized equivalent: Weekly % × 52 weeks
```

### 20. **Bid/Ask Spread %** (Table Column Header)
**Location:** All dashboards - Spread % column
**Format:** Tooltip on hover
**Content:**
```
Bid/Ask Spread % = ((Ask - Bid) / Mid) × 100

Measures how wide the spread is relative to option price.

Quality Thresholds:
🟢 <10%: Tight spread - excellent fill probability
🟡 10-20%: Moderate spread - acceptable
🔴 >20%: Wide spread - poor liquidity

Why It Matters:
• Wider spreads = Harder to get filled at mid price
• May need to accept worse price to get filled
• Indicates lower liquidity

Best Practice:
• Target spreads <15%
• Use limit orders (never market orders)
• Be patient - let orders fill at your price
```

---

## Implementation Priority Summary

**Phase 1 (Immediate):** Priority 1 items (Delta, DTE, RSI, BB %B, IV Rank)
- Highest impact on user understanding
- Most frequently referenced metrics
- Critical for trade decisions

**Phase 2 (Next):** Priority 2 items (Spread-specific metrics)
- Important for spread strategy users
- Helps differentiate spread vs single-leg
- Reduces confusion on new concepts

**Phase 3 (Soon):** Priority 3 items (Risk management)
- Important for portfolio safety
- Prevents costly mistakes
- Enhances dry run validation

**Phase 4 (Later):** Priority 4 & 5 items (UX polish)
- Nice-to-have enhancements
- Helps power users optimize
- Lower urgency, higher polish

---

## Technical Implementation Notes

### Component Structure
```typescript
// Reusable HelpBadge component
<HelpBadge
  title="Delta"
  content="Delta measures..."
  type="tooltip" // or "dialog" for longer content
/>
```

### Placement Guidelines
- **Table Headers:** Small ℹ️ icon next to column name
- **Summary Cards:** Small ℹ️ icon next to card title
- **Section Headers:** Small ℹ️ icon next to section label
- **Buttons:** Tooltip on hover (no icon needed)

### Content Guidelines
- Keep tooltips <200 words
- Use dialogs for >200 words
- Include examples with numbers
- Use emojis for visual hierarchy (🟢🟡🔴)
- Format with bullet points and sections
- Always include "Why It Matters" section
