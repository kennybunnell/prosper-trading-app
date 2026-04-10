# Prosper Trading App — Cache Architecture Audit Report
**Date:** April 10, 2026  
**Scope:** All server-side router files — live Tastytrade API calls vs. DB cache reads  
**Philosophy:** *Cache first. Live API only when real-time data is operationally required.*

---

## Executive Summary

The audit identified **9 router files** making live Tastytrade API calls (`getPositions`, `getTransactionHistory`, `getAccounts`, `getWorkingOrders`) on every user request. These calls are categorized below into three tiers: **Replace with Cache** (should be migrated immediately), **Hybrid** (cache for context, live for freshness check), and **Keep Live** (operationally requires real-time data).

The portfolio cache tables (`cached_positions`, `cached_transactions`) already exist and are populated by the sync engine. The work required is to route existing procedures to read from those tables instead of calling Tastytrade on every request.

---

## Audit Results by Router

### Tier 1 — Replace with Cache (High Priority)

These procedures call `getPositions` or `getTransactionHistory` purely to assemble read-only context for display, analysis, or AI. They should read from `cached_positions` / `cached_transactions` instead.

| Router File | Procedure | Live Call Used | Replace With |
|---|---|---|---|
| `routers.ts` | `getMorningBriefingContext` | `getAccounts` + `getPositions` + `getTransactionHistory` | `getCachedPositions()` + `getCachedTransactions()` |
| `routers.ts` | `getActionBadges` | `getAccounts` + `getPositions` | `getCachedPositions()` |
| `routers.ts` | `getMonthlyCollected` | `getAccounts` + `getTransactionHistory` | `getCachedTransactions()` |
| `routers-performance.ts` | `getPerformanceOverview` | `getAccounts` + `getTransactionHistory` | `getCachedTransactions()` |
| `routers-performance.ts` | `getActivePositions` | `getAccounts` + `getPositions` + `getWorkingOrders` | `getCachedPositions()` (working orders: keep live — see Tier 3) |
| `routers-performance.ts` | `getExpirationCalendar` | `getAccounts` + `getPositions` | `getCachedPositions()` |
| `routers-position-analyzer.ts` | `analyzePositions` | `getAccounts` + `getPositions` (×2) | `getCachedPositions()` |
| `routers-cc.ts` | `getEligiblePositions` | `getPositions` + `getWorkingOrders` | `getCachedPositions()` (working orders: keep live) |
| `routers-cc.ts` | `getEligiblePositionsAllAccounts` | `getAccounts` + `getPositions` + `getWorkingOrders` | `getCachedPositions()` (working orders: keep live) |
| `routers-pmcc.ts` | `getLeapPositions` | `getAccounts` + `getPositions` | `getCachedPositions()` |
| `routers-tax.ts` | `getTaxSummary` | `getAccounts` + `getTransactionHistory` + `getPositions` | `getCachedTransactions()` + `getCachedPositions()` |
| `routers-tax.ts` | `getCapitalGains` | `getAccounts` + `getPositions` + `getTransactionHistory` | `getCachedTransactions()` + `getCachedPositions()` |
| `routers-tax.ts` | `getWashSaleReport` | `getAccounts` + `getTransactionHistory` | `getCachedTransactions()` |
| `routers-ira-safety.ts` | `scanViolations` | `getPositions` | `getCachedPositions()` |
| `routers-ira-safety.ts` | `triggerFridaySweep` | `getPositions` (×all accounts) | `getCachedPositions()` |
| `routers-ira-safety.ts` | `triggerDailyScan` | `getAccounts` + `getPositions` | `getCachedPositions()` |
| `routers-safeguards.ts` | `checkSafeguards` | `getPositions` | `getCachedPositions()` |
| `routers-safeguards.ts` | `triggerFridaySweep` | `getPositions` (×all accounts) | `getCachedPositions()` |
| `routers-safeguards.ts` | `triggerDailyScan` | `getAccounts` + `getPositions` | `getCachedPositions()` |
| `routers-spread-analytics.ts` | Position-based analytics | `getPositions` | `getCachedPositions()` |
| `routers-charts.ts` | Chart data procedures | `getTransactionHistory` | `getCachedTransactions()` |

**Impact of migrating Tier 1:** Eliminates approximately 80% of all live Tastytrade API calls in the app. Every dashboard load, AI advisor call, tax report, IRA safety scan, and chart render will become instant (sub-10ms DB reads vs. 1–5 second API round trips).

---

### Tier 2 — Hybrid Pattern (Medium Priority)

These procedures need both cached data for the bulk of their work and a targeted live call for one specific piece of real-time information.

| Router File | Procedure | Recommended Pattern |
|---|---|---|
| `routers-performance.ts` | `closePositions` | Use `getCachedPositions()` to build the position list for display; call `getPositions()` live only at the moment of order submission to confirm current quantity before sending to Tastytrade |
| `routers-cc.ts` | `submitOrders` | Use `getCachedPositions()` to verify share ownership for covered call eligibility check; call live only to confirm current position at submission time |
| `routers-pmcc.ts` | `submitLeapOrders` | Use `getCachedPositions()` to identify LEAP candidates; call live at submission to confirm |
| `routers-rolls.ts` | Roll panel position loading | Use `getCachedPositions()` to populate the roll panel; refresh cache after a roll is submitted |

---

### Tier 3 — Keep Live (Correct as-is)

These operations require real-time data by definition. Do not cache these.

| Router File | Procedure | Why Live is Required |
|---|---|---|
| `routers-working-orders.ts` | `getWorkingOrders`, `checkOrderStatus` | Order status changes in real time; a cached order status is dangerous |
| `routers-working-orders.ts` | `cancelOrder`, `replaceOrder` | Mutations against the live brokerage — must be live |
| `routers-orders.ts` | `submitOrders`, `validateOrders` | Order submission and pre-flight validation must use live account state |
| `routers-automation.ts` | `submitRolls`, `submitBatch` | Live order execution |
| `routers-cc.ts` | `scanOpportunities`, `bearCallSpreadOpportunities` | Live option chain pricing from Tradier — must be real-time |
| `routers-pmcc.ts` | `scanLeaps`, `scanShortCallOpportunities` | Live option chain pricing |
| `routers.ts` | `opportunities` (CSP/BPS/BCS/IC) | Live option chain pricing |
| `routers.ts` | `getBuyingPower` | Account balance is real-time; stale buying power could cause over-allocation |
| `routers.ts` | `accounts.sync` | This IS the sync trigger — must call live |
| `routers.ts` | `saveCredentials`, `forceTokenRefresh` | Auth operations — must be live |
| `routers-portfolio-sync.ts` | `triggerSync`, `triggerSyncAndWait` | The sync engine itself — must call live to populate the cache |

---

## Recommended Implementation Order

The following sequence minimizes risk and delivers the highest performance gains first.

**Phase A — Quick Wins (1–2 days of work):**
Migrate `getActionBadges`, `getMonthlyCollected`, `getExpirationCalendar`, and `getLeapPositions` to use the cache. These are read-only display procedures with no side effects and the migration is a direct substitution.

**Phase B — Core Dashboards (2–3 days):**
Migrate `getPerformanceOverview`, `getActivePositions`, `getEligiblePositions`, `getEligiblePositionsAllAccounts`, and `analyzePositions`. These are the most frequently called procedures in the app and will have the most visible performance impact.

**Phase C — AI and Briefings (1 day):**
Migrate `getMorningBriefingContext` and all AI advisor context assembly. The AI context assembler (`ai-context.ts`) already reads from cache — this phase ensures the morning briefing and action badges follow the same pattern.

**Phase D — Tax and Compliance (2 days):**
Migrate `getTaxSummary`, `getCapitalGains`, `getWashSaleReport`, `scanViolations`, and all IRA/safeguard scan procedures. These are the most expensive live calls (fetching years of transaction history on every page load) and will benefit most from the cache.

---

## Cache Freshness Strategy

For the cache to be trusted, it must stay current. The following schedule is recommended:

| Trigger | Sync Type | Scope |
|---|---|---|
| User login | Incremental | All accounts — transactions since last sync |
| Every 15 min (market hours, 9:30–16:00 ET) | Incremental | All accounts |
| After any order submission | Positions-only refresh | Affected account only |
| Manual "Sync Now" in Settings | Incremental or Full | User's choice |
| "Full Refresh" in Settings | Full 3-year reload | All accounts |

The 15-minute scheduled sync during market hours is not yet implemented and should be added as the next infrastructure task. This ensures that by the time a user opens any dashboard during the trading day, the cache is never more than 15 minutes stale — which is more than sufficient for all Tier 1 procedures.

---

## Summary Table

| Category | Procedure Count | Current Behavior | Target Behavior |
|---|---|---|---|
| Tier 1 — Replace with Cache | ~21 procedures | Live API call on every request (1–5s) | DB cache read (<10ms) |
| Tier 2 — Hybrid | ~4 procedures | Live API for everything | Cache for display, live only at submission |
| Tier 3 — Keep Live | ~12 procedures | Live API | Live API (correct) |

Migrating Tier 1 and Tier 2 will reduce Tastytrade API calls by an estimated **85%** during normal app usage, eliminate the most common source of slow page loads, and remove the risk of hitting Tastytrade's rate limits during heavy usage.
