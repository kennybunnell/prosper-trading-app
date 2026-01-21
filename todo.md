# Prosper Trading App - TODO

## Phase 1: Database Schema & API Foundation
- [x] Design and implement database schema for watchlists
- [x] Design and implement database schema for trades
- [x] Design and implement database schema for positions
- [x] Design and implement database schema for premium tracking
- [x] Design and implement database schema for stock positions
- [x] Create Tastytrade API integration module
- [x] Create Tradier API integration module
- [x] Implement session token management for Tastytrade
- [x] Create scoring system utilities (primary and secondary scores)

## Phase 2: Authentication & Settings
- [x] Build settings page for API credentials management
- [x] Implement secure credential storage (Tastytrade username/password)
- [x] Implement secure credential storage (Tradier API key)
- [x] Create multi-account selection interface
- [x] Build account switching functionality
- [x] Add connection testing for Tastytrade API
- [x] Add connection testing for Tradier API
- [x] Implement premium dark theme with Damascus steel background
- [x] Add theme toggle (light/dark)
- [x] Add glassmorphism effects to cards

## Phase 3: CSP Dashboard
- [x] Create CSP dashboard layout and navigation
- [x] Implement watchlist management UI
- [x] Build option chain fetching from Tradier API
- [x] Implement dual scoring system (primary + secondary)
- [x] Create interactive filters and sorting
- [x] Build real-time summary card (premium/collateral/buying power)
- [x] Implement score-based selection buttons (100% to 40% in 5% increments)
- [x] Create order preview modal with confirmation
- [x] Implement one-click order submission to Tastytrade
- [x] Add success celebration with visual feedback

## Phase 4: CC Dashboard
- [ ] Create CC dashboard layout
- [ ] Fetch existing positions from Tastytrade
- [ ] Identify stocks with 100+ shares for CC opportunities
- [ ] Fetch call option chains from Tradier
- [ ] Calculate and score CC opportunities
- [ ] Implement score-based selection buttons
- [ ] Add "Selected Only" toggle filter
- [ ] Create order preview and confirmation
- [ ] Implement CC order submission to Tastytrade

## Phase 5: PMCC Dashboard
- [ ] Create PMCC dashboard layout
- [ ] Implement PMCC watchlist management
- [ ] Build LEAPS option scanner (>180 DTE)
- [ ] Find short call opportunities against LEAPS
- [ ] Calculate spread profit potential
- [ ] Implement notification system for alerts
- [ ] Create order submission for PMCC strategies

## Phase 6: Performance Dashboard
- [ ] Create performance overview with monthly premium summary
- [ ] Display win rate and account metrics
- [ ] Build working orders view and management
- [ ] Implement active positions tracking
- [ ] Add premium realization tracking
- [ ] Create position recommendations (🟢 CLOSE, 🟡 WATCH, 🔴 HOLD)
- [ ] Build stock basis and returns analysis
- [ ] Implement future performance projections

## Phase 7: Technical Indicators & Analytics
- [ ] Integrate RSI calculation from Tradier
- [ ] Integrate Bollinger Bands calculation
- [ ] Integrate Moving Average calculation
- [ ] Integrate 52-week range calculation
- [ ] Display technical indicators in opportunity tables
- [ ] Use indicators in scoring algorithms

## Phase 8: Safety & UX Features
- [ ] Implement dry run capability for orders
- [ ] Create final confirmation dialogs before execution
- [ ] Build order preview with detailed summary
- [ ] Add success celebrations (visual feedback)
- [ ] Implement error handling and user notifications
- [ ] Add loading states for all async operations

## Phase 9: Testing & Refinement
- [ ] Test Tastytrade API integration end-to-end
- [ ] Test Tradier API integration end-to-end
- [ ] Test CSP workflow from watchlist to order submission
- [ ] Test CC workflow from positions to order submission
- [ ] Test PMCC workflow
- [ ] Test performance dashboard data accuracy
- [ ] Verify multi-account support
- [ ] Test all safety features and confirmations
- [ ] Create initial checkpoint

## Phase 10: Documentation & Deployment
- [ ] Document API credential setup process
- [ ] Create user guide for each dashboard
- [ ] Document scoring system methodology
- [ ] Add inline help and tooltips
- [ ] Prepare for deployment


## Credential Enhancements
- [x] Add Tradier Account ID field to database schema
- [x] Add default Tastytrade account ID field to database schema
- [x] Update Settings page to capture Tradier Account ID
- [x] Update Settings page to allow default account selection
- [ ] Update backend to use default account when submitting orders
- [ ] Test credential storage and retrieval

## CSP Dashboard Improvements
- [x] Add comma-delimited ticker input (allow multiple tickers at once)
- [x] Add "Fetch Opportunities" button to manually trigger option chain fetching
- [x] Fix error when adding multiple tickers
- [x] Add loading state for fetch operation
