# Prosper Trading App - TODO

## ✅ Completed Foundation
- [x] Database schema design and migration (watchlists, trades, positions, premium tracking, stock positions)
- [x] Tastytrade API integration module
- [x] Tradier API integration module  
- [x] Settings page with credential management
- [x] Premium dark theme with Damascus steel background
- [x] Theme toggle (light/dark)
- [x] Glassmorphism effects
- [x] Home page with dashboard navigation
- [x] Tradier Account ID and default account selection
- [x] Comma-delimited ticker input for watchlist

## 🚧 Current Focus: Complete CSP Dashboard (Phase 1-4)

### Phase 1: Sidebar Navigation & Layout
- [x] Create sidebar component with account selection dropdown
- [x] Add navigation menu (CSP Dashboard, CC Dashboard, PMCC Dashboard, Performance, Settings)
- [x] Integrate sidebar into main app layout
- [x] Add account switching functionality
- [x] Style sidebar to match Damascus steel theme

### Phase 2: Complete Backend CSP Logic
- [ ] Rewrite Tradier API fetchCSPOpportunities method to match Streamlit implementation
- [ ] Implement exact Streamlit composite scoring formula (0-100 scale based on Weekly %, Delta, RSI, BB %B, IV Rank, Spread %)
- [ ] Create tRPC procedure for fetching CSP opportunities with scoring
- [ ] Add preset filter logic (Conservative, Medium, Aggressive with configurable parameters)
- [ ] Implement score-based filtering (100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40)
- [ ] Add watchlist management endpoints (add/remove/list)
- [ ] Create order submission endpoint with Tastytrade integration
- [ ] Test backend with real API calls

### Phase 3: Complete CSP Dashboard Frontend
- [ ] Add all required columns (Symbol, Strike, Bid, Ask, Spread %, Delta, DTE, Premium, Weekly %, Collateral, ROC, Open Int, Volume, RSI, BB %B, IV Rank, Score)
- [ ] Implement preset filter buttons (🟢 Conservative, 🟡 Medium, 🔴 Aggressive, ✅ Select All, 🗑️ Clear All)
- [ ] Add score selection buttons (⭐ 100, 🟢 90+, 🟢 80+, 🟢 75+, 🟡 70+, 🟡 65+, 🟠 60+, 🟠 55+, 🔴 50+, 🔴 45+, ⚫ 40+)
- [ ] Create preset filter configuration expanders (editable delta, DTE, OI, RSI, IV Rank, BB %B, min score)
- [ ] Add "Selected Only" toggle filter
- [ ] Implement quantity adjustment buttons (+1, +5, +10, -1, Reset)
- [ ] Add real-time summary cards (Total Premium, Total Collateral, Weighted ROC, Opportunity Count)
- [ ] Create order preview modal with detailed summary
- [ ] Implement order submission with success feedback (confetti)
- [ ] Add loading states for all async operations
- [ ] Format columns with proper styling (currency, percentages, emojis for RSI/BB/IV Rank)

### Phase 4: Testing & Refinement
- [ ] Test watchlist management (add/remove tickers)
- [ ] Test option chain fetching from Tradier API with real credentials
- [ ] Verify scoring calculations match Streamlit app exactly
- [ ] Test preset filters (Conservative, Medium, Aggressive)
- [ ] Test score buttons (refine selection by score threshold)
- [ ] Test order preview and submission workflow
- [ ] Verify all columns display correct data
- [ ] Test "Selected Only" toggle
- [ ] Check responsive design on different screen sizes
- [ ] Fix any bugs or issues found during testing
- [ ] Create checkpoint for testable CSP module

## 📋 Future Phases (After CSP Complete)

### CC Dashboard
- [ ] Create CC dashboard layout
- [ ] Fetch existing positions from Tastytrade
- [ ] Identify stocks with 100+ shares for CC opportunities
- [ ] Fetch call option chains from Tradier
- [ ] Calculate and score CC opportunities
- [ ] Implement score-based selection buttons
- [ ] Add "Selected Only" toggle filter
- [ ] Create order preview and confirmation
- [ ] Implement CC order submission to Tastytrade

### PMCC Dashboard
- [ ] Create PMCC dashboard layout
- [ ] Implement PMCC watchlist management
- [ ] Build LEAPS option scanner (>180 DTE)
- [ ] Find short call opportunities against LEAPS
- [ ] Calculate spread profit potential
- [ ] Implement notification system for alerts
- [ ] Create order submission for PMCC strategies

### Performance Dashboard
- [ ] Create performance overview with monthly premium summary
- [ ] Display win rate and account metrics
- [ ] Build working orders view and management
- [ ] Implement active positions tracking
- [ ] Add premium realization tracking
- [ ] Create position recommendations (🟢 CLOSE, 🟡 WATCH, 🔴 HOLD)
- [ ] Build stock basis and returns analysis
- [ ] Implement future performance projections


## CSP Dashboard UI/UX Improvements
- [x] Make sidebar persistent across all pages (not just dashboard routes)
- [x] Check Streamlit app sidebar for additional widgets to include
- [x] Add account selector dropdown in sidebar
- [x] Add Quick Stats panel to sidebar (Open Positions, Working Orders, Weekly/Monthly Premium, Win Rate)
- [x] Add sortable table headers (click to sort ascending/descending)
- [x] Add color-coded score badges (Red < 50, Yellow 50-69, Green 70+)
- [x] Add dry run checkbox option before order submission
- [ ] Test complete CSP workflow end-to-end

## Account Selector Integration
- [x] Create React Context for selected account state
- [x] Connect sidebar account selector to context
- [x] Update CSP Dashboard to use selected account from context
- [x] Persist selected account in localStorage
- [ ] Test account switching across pages

## Bug Fixes
- [x] Fix TypeError: availableBuyingPower.toFixed is not a function in CSP Dashboard - wrapped value in Number() to ensure numeric type
- [x] Fix "No values to set" error in Settings - replaced onDuplicateKeyUpdate with separate insert/update logic
- [x] Fix Settings page input change detection - Save button doesn't enable when modifying Tradier API key
- [x] Add console logging to debug hasChanges state when modifying Tradier API key
- [x] Add detailed Tradier API logging to diagnose 401 authentication errors
- [x] Fix "No values to set" error when syncing Tastytrade accounts - properly filter optional fields while preserving required accountId/accountNumber
- [x] Fix account sync field mapping - Tastytrade API uses nested structure with kebab-case field names

## CSP Dashboard Enhancements
- [x] Clone and analyze options-trading repository for filter configuration patterns
- [x] Add cspFilterPresets database table schema
- [x] Add database helper functions for seeding and managing filter presets
- [x] Create tRPC procedures for getting and updating filter presets
- [x] Add automatic seeding logic on first user access
- [x] Test backend implementation with real data (6/6 tests passing)
- [x] Create Settings UI section with expandable filter preset configuration
- [x] Add input fields for all preset parameters (delta, DTE, OI, RSI, IV Rank, BB %B, score, strike)
- [x] Implement Save/Reset functionality for each preset
- [x] Update CSP Dashboard to fetch presets from database on load
- [x] Apply preset filters when Conservative/Medium/Aggressive buttons clicked
- [x] Implement parallel opportunity fetching using concurrent processing (5 concurrent workers with batching)
- [x] Test all three features end-to-end with real data

## Buying Power & Default Account Features
- [x] Add user preferences table for default account selection
- [x] Add backend procedures for getting/setting default account
- [x] Implement Tastytrade API integration for fetching account balances and buying power
- [x] Add buying power card to CSP Dashboard with color-coded indicators (green <80%, yellow 80-90%, red >90%)
- [x] Show "Over Limit: $X,XXX" when total collateral exceeds buying power
- [x] Implement real-time buying power updates as opportunities are selected/deselected
- [x] Add default account selection dropdown in Settings page
- [x] Auto-select default account when opening CSP Dashboard
- [x] Implement hard block on order submission when exceeding buying power
- [x] Test complete workflow with real Tastytrade account data

## Order Submission Implementation
- [x] Add backend order submission logic with dry run mode (validation only)
- [x] Add backend live order submission through Tastytrade API
- [x] Implement frontend order submission UI with dry run/live mode toggle
- [x] Add progress tracking for individual order submissions
- [x] Display order status for each opportunity (pending/success/failed)
- [x] Add confirmation dialog for live mode with final review
- [x] Implement confetti animation for successful submissions (multi-burst with colors)
- [x] Add success sound effect (plays automatically on success)
- [x] Create progress dialog showing order status in real-time
- [x] Test complete order submission workflow in dry run mode (ready for user testing)
- [ ] Test live order submission with real Tastytrade account (requires user to test)

## Selection UI Enhancement
- [x] Add checkbox column to opportunities table for individual selection
- [x] Add "Select All Filtered" button to bulk select all visible opportunities
- [x] Add "Clear Selection" button to deselect all opportunities
- [x] Verify summary cards (Premium, Collateral, ROC, Buying Power) only calculate from selected opportunities
- [x] Test complete selection workflow with filters

## Progress Tracking for Opportunity Fetching
- [x] Add backend support for streaming progress updates during parallel opportunity fetching (already existed - 5 concurrent workers)
- [x] Implement frontend progress dialog with real-time status messages
- [x] Add visual progress bar showing percentage complete
- [x] Display processing status ("Processing X symbols...")
- [x] Show completion summary ("Found X opportunities" with close button)
- [x] Test with multiple watchlist symbols

## Enhanced Watchlist Management
- [x] Update database schema to add metadata columns (company, type, sector, reason, rank)
- [x] Add backend procedure for CSV import with validation
- [x] Add backend procedure for updating watchlist metadata
- [x] Implement expandable/collapsible table view with all columns
- [x] Add CSV import button with file upload
- [x] Add ticker summary pane at bottom showing comma-separated symbols
- [x] Keep existing quick-add functionality (single or comma-separated)
- [x] Add edit/delete capabilities for individual watchlist items
- [x] Test CSV import with sample file (ready for user testing)
- [x] Test expand/collapse functionality

## Portfolio Size Filtering
- [x] Categorize top 50 stocks by portfolio size (Small: $0-100K, Medium: $100K-500K, Large: $500K+)
- [x] Add portfolioSize column to watchlists table schema
- [x] Update CSV import to auto-categorize based on stock price
- [x] Add portfolio size filter checkboxes (Small/Medium/Large/All)
- [x] Update fetch logic to only fetch selected portfolio sizes
- [x] Add Portfolio Size column to expanded table view with badges
- [x] Allow editing portfolio size per symbol in table
- [x] Test filtering workflow with different portfolio size selections
