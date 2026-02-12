# UnifiedOrderPreviewModal Replace Mode Design

## Current Working Orders Replacement Workflow

### Data Flow
1. User selects working orders from table (checkboxes)
2. Clicks "Replace Orders" button
3. Shows custom dialog with detailed pricing table
4. User confirms → calls `replaceOrders` mutation
5. Mutation cancels old orders + submits new orders at updated prices
6. Returns both old and new order IDs
7. Polls for new order status (Filled/Cancelled/Rejected)
8. Shows replacement log with real-time updates

### Key Features
- ✅ Detailed pricing table (Current, Bid, Ask, Mid, Suggested, Price Effect, Cost)
- ✅ Order status polling (10-second intervals)
- ✅ Fill notification sound (3-tone ascending)
- ✅ Replacement log with real-time status updates
- ✅ Aggressive fill mode toggle
- ✅ Batch selection (select individual or all)

### Replace Mutation Input
```typescript
{
  orders: [{
    orderId: string;           // Old order ID to cancel
    accountNumber: string;
    symbol: string;
    suggestedPrice: number;    // New price for replacement order
    rawOrder: any;             // Full order object from Tastytrade API
  }]
}
```

### Replace Mutation Output
```typescript
{
  successCount: number;
  failedCount: number;
  results: [{
    orderId: string;           // Old order ID
    newOrderId?: string;       // New order ID (if successful)
    success: boolean;
    error?: string;
    orderStatus?: 'Working' | 'Filled' | 'Cancelled' | 'Rejected';
    filledAt?: string;
  }]
}
```

---

## Replace Mode Design for UnifiedOrderPreviewModal

### Goals
1. ✅ Maintain consistent UX across all order operations
2. ✅ Preserve existing replace workflow features (pricing table, polling, notifications)
3. ✅ Extend UnifiedOrderPreviewModal without breaking existing strategies
4. ✅ Support both single and batch order replacement

### New Props for Replace Mode

```typescript
interface UnifiedOrderPreviewModalProps {
  // ... existing props ...
  
  // Replace mode props
  mode?: 'new' | 'replace';                    // Default: 'new'
  oldOrderIds?: string[];                       // Old order IDs to cancel (for replace mode)
  onReplaceSubmit?: (                           // Replace-specific callback
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    oldOrderIds: string[],
    isDryRun: boolean
  ) => Promise<{ successCount: number; failedCount: number; results: any[] }>;
}
```

### UI Changes for Replace Mode

#### **Header**
- **New mode**: "Order Preview - [Strategy Name]"
- **Replace mode**: "Replace Orders - [Strategy Name]"

#### **Pricing Table**
Add "Current Price" column to show old order price:

| Symbol | Action | **Current** | Bid | Ask | Mid | **Suggested** | **Change** | Price Effect | Cost |
|--------|--------|-------------|-----|-----|-----|---------------|------------|--------------|------|
| AAPL   | BTC    | $1.50       | $1.45 | $1.55 | $1.50 | **$1.55** | **+$0.05** | Debit | $155.00 |

**Change** = Suggested - Current (green if lower for BTC, red if higher)

#### **Summary Panel**
- **New mode**: Shows BP required, collateral, premium collected
- **Replace mode**: Shows:
  - Total orders to replace: X
  - Total cost difference: +$XXX or -$XXX
  - Old orders to cancel: [list of order IDs]
  - New orders to submit: [list of symbols]

#### **Workflow**
1. **Dry Run** (always enabled for replace mode)
   - Cancel old orders (dry run)
   - Submit new orders (dry run)
   - Show validation results
   
2. **Live Submission**
   - Cancel old orders
   - Submit new orders
   - Return old + new order IDs
   - Parent component handles polling

### Implementation Strategy

#### **Phase 1: Add Replace Mode Props**
- Add `mode`, `oldOrderIds`, `onReplaceSubmit` props
- Add conditional rendering based on `mode`
- Update header text for replace mode

#### **Phase 2: Update Pricing Table**
- Add "Current Price" column (only visible in replace mode)
- Add "Change" column showing price difference
- Highlight price changes (green/red)

#### **Phase 3: Update Summary Panel**
- Show replace-specific summary (orders to cancel, cost difference)
- Add old order IDs list

#### **Phase 4: Update Submission Logic**
- Check if `mode === 'replace'`
- Call `onReplaceSubmit` instead of `onSubmit`
- Pass old order IDs to callback

#### **Phase 5: Integration with Working Orders Tab**
- Replace custom dialog with UnifiedOrderPreviewModal
- Convert working orders to UnifiedOrder[] format
- Implement `onReplaceSubmit` callback
- Preserve polling and notification logic

---

## Data Transformation

### Working Order → UnifiedOrder

```typescript
// Working order from API
{
  orderId: "abc123",
  symbol: "AAPL 240315P150",
  underlyingSymbol: "AAPL",
  action: "Buy to Close",
  optionType: "PUT",
  strike: 150,
  expiration: "2024-03-15",
  quantity: 1,
  currentPrice: 1.50,      // Current order price
  bid: 1.45,
  ask: 1.55,
  mid: 1.50,
  suggestedPrice: 1.55,    // New price for replacement
  needsReplacement: true,
  rawOrder: {...}
}

// Convert to UnifiedOrder
{
  symbol: "AAPL",
  strike: 150,
  expiration: "2024-03-15",
  premium: 1.55,           // Use suggestedPrice as premium
  action: "BTC",
  optionType: "PUT",
  bid: 1.45,
  ask: 1.55,
  currentPrice: 1.50,      // Keep current price for comparison
  quantity: 1,
  
  // Replace mode specific
  oldPrice: 1.50,          // Original order price
  oldOrderId: "abc123",    // For tracking
}
```

---

## Backward Compatibility

### Existing Strategies (CSP, CC, BCS, BPS, PMCC, BTC)
- ✅ No changes required
- ✅ `mode` defaults to 'new'
- ✅ `onSubmit` callback unchanged
- ✅ UI unchanged (no "Current Price" or "Change" columns)

### Replace Mode Only
- ✅ Only visible when `mode === 'replace'`
- ✅ Requires `oldOrderIds` prop
- ✅ Requires `onReplaceSubmit` callback

---

## Testing Plan

### Unit Tests
1. ✅ Render in 'new' mode (default) - verify no replace UI
2. ✅ Render in 'replace' mode - verify replace UI visible
3. ✅ Verify "Current Price" column only in replace mode
4. ✅ Verify "Change" calculation (suggested - current)
5. ✅ Verify summary panel shows replace-specific info
6. ✅ Verify onReplaceSubmit called instead of onSubmit

### Integration Tests
1. ✅ Working Orders tab uses replace mode
2. ✅ Replace workflow: select orders → preview → submit
3. ✅ Verify old order IDs passed to mutation
4. ✅ Verify polling works after replacement
5. ✅ Verify fill notification sound plays
6. ✅ Verify replacement log updates

### E2E Tests
1. ✅ Replace single working order
2. ✅ Replace multiple working orders (batch)
3. ✅ Replace all orders needing replacement
4. ✅ Verify OAuth2 authentication throughout
5. ✅ Verify dry-run → live workflow

---

## Migration Checklist

- [ ] Add replace mode props to UnifiedOrderPreviewModal
- [ ] Update header text for replace mode
- [ ] Add "Current Price" and "Change" columns (conditional)
- [ ] Update summary panel for replace mode
- [ ] Update submission logic to call onReplaceSubmit
- [ ] Convert Working Orders tab to use UnifiedOrderPreviewModal
- [ ] Remove old replace dialog from Working Orders tab
- [ ] Preserve polling and notification logic
- [ ] Test replace workflow end-to-end
- [ ] Update todo.md with completed tasks
- [ ] Save checkpoint

---

**Document Created**: February 12, 2026  
**Last Updated**: February 12, 2026  
**Status**: ✅ DESIGN COMPLETE - READY FOR IMPLEMENTATION
