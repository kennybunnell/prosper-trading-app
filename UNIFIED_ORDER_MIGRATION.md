# UnifiedOrderPreviewModal Migration Plan

## Current State Analysis

### ✅ UnifiedOrderPreviewModal Component (COMPLETE)
**Location**: `client/src/components/UnifiedOrderPreviewModal.tsx`

**Features**:
- Supports all strategies: CSP, CC, BCS, BPS, PMCC, BTC, Roll
- Flexible order interface for all action types (STO, BTC, BTO, STC)
- Quantity editing with strategy-specific max limits
- Real-time validation (buying power, stock holdings, collateral)
- Two-step workflow (dry-run → live submission)
- Price adjustment support
- Summary panel with BP/collateral/premium calculations

**Props Interface**:
```typescript
{
  orders: UnifiedOrder[];
  strategy: "csp" | "cc" | "bcs" | "bps" | "pmcc" | "btc" | "roll";
  accountId: string;
  availableBuyingPower: number;
  holdings?: Holding[]; // Required for CC validation
  onSubmit: (orders, quantities, isDryRun) => Promise<void>;
  defaultQuantities?: Map<string, number>;
  allowQuantityEdit?: boolean;
  tradingMode?: "live" | "paper";
}
```

### ❌ Dashboards NOT Using UnifiedOrderPreviewModal

#### 1. **CC Dashboard** (`client/src/pages/CCDashboard.tsx`)
- **Current**: Uses `OrderPreviewDialog` component
- **Order Types**: Covered Calls (CC), Bear Call Spreads (BCS)
- **Migration Needed**: YES
- **Complexity**: MEDIUM
- **Notes**: Already has two-step workflow (dry-run → live), just needs to switch components

#### 2. **CSP Dashboard** (`client/src/pages/CSPDashboard.tsx`)
- **Current**: Uses `OrderPreviewDialog` component
- **Order Types**: Cash-Secured Puts (CSP), Bull Put Spreads (BPS)
- **Migration Needed**: YES
- **Complexity**: MEDIUM
- **Notes**: Already has two-step workflow (dry-run → live), just needs to switch components

#### 3. **PMCC Dashboard** (`client/src/pages/PMCCDashboard.tsx`)
- **Current**: Uses custom inline Dialog (not OrderPreviewDialog)
- **Order Types**: Poor Man's Covered Calls (buying LEAPs + selling short calls)
- **Migration Needed**: YES
- **Complexity**: HIGH
- **Notes**: Custom implementation, needs full refactor to use UnifiedOrderPreviewModal

#### 4. **Performance Page** (`client/src/pages/Performance.tsx`)
- **Current**: Uses direct `closePositionsMutation` (no preview modal)
- **Order Types**: Buy to Close (BTC) at 80-90% profit targets
- **Migration Needed**: YES
- **Complexity**: HIGH
- **Notes**: No preview dialog currently - needs to add UnifiedOrderPreviewModal before submission

#### 5. **Roll Actions** (`client/src/components/RollCandidateModal.tsx`)
- **Current**: Shows roll candidates but doesn't use UnifiedOrderPreviewModal for submission
- **Order Types**: Roll positions (close old + open new)
- **Migration Needed**: YES
- **Complexity**: HIGH
- **Notes**: Roll actions involve multi-leg orders (BTC old position + STO new position)

#### 6. **Working Orders** (No dedicated page found)
- **Current**: Likely managed within Performance page or other dashboards
- **Order Types**: Submit/replace working orders
- **Migration Needed**: MAYBE
- **Complexity**: UNKNOWN
- **Notes**: Need to locate where working orders are managed

---

## Migration Priority

### Phase 1: Low-Hanging Fruit (EASY)
1. **CC Dashboard** - Replace OrderPreviewDialog with UnifiedOrderPreviewModal
2. **CSP Dashboard** - Replace OrderPreviewDialog with UnifiedOrderPreviewModal

**Why First**: These already use a similar preview dialog pattern, just need component swap

### Phase 2: Medium Complexity (MODERATE)
3. **PMCC Dashboard** - Refactor custom dialog to use UnifiedOrderPreviewModal

**Why Second**: Custom implementation but single strategy type

### Phase 3: High Complexity (COMPLEX)
4. **Performance Page BTC Actions** - Add UnifiedOrderPreviewModal before closePositions
5. **Roll Actions** - Integrate UnifiedOrderPreviewModal with RollCandidateModal

**Why Last**: These require more significant workflow changes

---

## Migration Checklist Per Dashboard

### For Each Dashboard:
- [ ] Import UnifiedOrderPreviewModal component
- [ ] Convert existing order data to UnifiedOrder[] format
- [ ] Calculate availableBuyingPower (fetch from Tastytrade API)
- [ ] For CC: Fetch holdings (stock positions) for validation
- [ ] Replace existing preview dialog with UnifiedOrderPreviewModal
- [ ] Update onSubmit callback to handle (orders, quantities, isDryRun) parameters
- [ ] Remove old OrderPreviewDialog import and usage
- [ ] Test dry-run workflow
- [ ] Test live submission workflow
- [ ] Verify order status polling works after submission

---

## Expected Benefits After Migration

1. **Consistent UX**: All order submission flows use the same interface
2. **Better Validation**: Unified validation logic across all strategies
3. **Real-time Status**: Order status polling shows Filled/Cancelled/Rejected accurately
4. **Maintainability**: Single component to update instead of multiple dialogs
5. **Feature Parity**: All strategies get quantity editing, price adjustment, etc.

---

## Next Steps

1. Start with CC Dashboard migration (easiest)
2. Apply same pattern to CSP Dashboard
3. Tackle PMCC Dashboard with custom implementation
4. Add preview modal to Performance page BTC actions
5. Integrate with Roll actions workflow
6. Test complete end-to-end workflow with OAuth2
7. Save checkpoint and deliver to user
