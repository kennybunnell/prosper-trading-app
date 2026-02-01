/**
 * Demo Mode Router
 * 
 * Handles demo account creation and management for free trial users.
 * CRITICAL: All procedures check isOwnerAccount() to prevent demo mode
 * from affecting the production owner account.
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { tastytradeAccounts, watchlists } from "../../drizzle/schema";
import { isOwnerAccount, shouldEnableDemoMode } from "../../shared/auth";

// Pre-populated watchlist for demo users (33 popular symbols)
const DEMO_WATCHLIST = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK.B",
  "JPM", "V", "JNJ", "WMT", "PG", "MA", "HD", "DIS", "PYPL", "NFLX",
  "ADBE", "CRM", "INTC", "CSCO", "PEP", "KO", "NKE", "MCD", "BA",
  "GS", "IBM", "CAT", "MMM", "AXP", "TRV"
];

export const demoRouter = router({
  /**
   * Get or create demo account for trial users
   * 
   * LAYER 2 PROTECTION: Checks isOwnerAccount() before creating demo account
   */
  getOrCreateDemoAccount: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx;
    
    // CRITICAL: Never create demo account for owner
    if (isOwnerAccount(user)) {
      console.log("[Demo] Owner account detected - skipping demo account creation");
      return null;
    }
    
    // Only create demo account for trial users
    if (!shouldEnableDemoMode(user)) {
      console.log("[Demo] User not eligible for demo mode:", user.subscriptionTier);
      return null;
    }
    
    console.log("[Demo] Checking for existing demo account for user:", user.id);
    
    const db = await getDb();
    if (!db) {
      console.error("[Demo] Database not available");
      return null;
    }
    
    // Check if demo account already exists
    const existingDemo = await db
      .select()
      .from(tastytradeAccounts)
      .where(
        and(
          eq(tastytradeAccounts.userId, user.id),
          eq(tastytradeAccounts.isDemoAccount, 1)
        )
      )
      .limit(1);
    
    if (existingDemo.length > 0) {
      console.log("[Demo] Found existing demo account:", existingDemo[0].accountId);
      return existingDemo[0];
    }
    
    // Create new demo account
    console.log("[Demo] Creating new demo account for user:", user.id);
    
    const demoAccountId = `DEMO-${user.id}-${Date.now()}`;
    const demoAccountNumber = `DEMO${user.id}`;
    
    const [newDemoAccount] = await db.insert(tastytradeAccounts).values({
      userId: user.id,
      accountId: demoAccountId,
      accountNumber: demoAccountNumber,
      accountType: "Demo Account",
      nickname: "Demo Trading Account",
      isActive: 1,
      isDemoAccount: 1,
      demoBalance: 100000, // $100K starting balance
    });
    
    console.log("[Demo] Demo account created:", demoAccountId);
    
    // Pre-populate watchlist with popular symbols for CSP strategy
    console.log("[Demo] Pre-populating watchlist with", DEMO_WATCHLIST.length, "symbols");
    
    const watchlistEntries = DEMO_WATCHLIST.map(symbol => ({
      userId: user.id,
      symbol,
      strategy: "csp" as const,
    }));
    
    await db.insert(watchlists).values(watchlistEntries);
    
    console.log("[Demo] Watchlist pre-populated successfully");
    
    // Fetch the created account
    const [createdAccount] = await db
      .select()
      .from(tastytradeAccounts)
      .where(eq(tastytradeAccounts.accountId, demoAccountId));
    
    return createdAccount;
  }),
  
  /**
   * Check if user has any real (non-demo) Tastytrade accounts
   */
  hasRealAccounts: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx;
    
    const db = await getDb();
    if (!db) return false;
    
    const realAccounts = await db
      .select()
      .from(tastytradeAccounts)
      .where(
        and(
          eq(tastytradeAccounts.userId, user.id),
          eq(tastytradeAccounts.isDemoAccount, 0)
        )
      );
    
    return realAccounts.length > 0;
  }),
  
  /**
   * Get demo account balance
   */
  getDemoBalance: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx;
    
    // Owner never has demo account
    if (isOwnerAccount(user)) {
      return null;
    }
    
    const db = await getDb();
    if (!db) return null;
    
    const [demoAccount] = await db
      .select()
      .from(tastytradeAccounts)
      .where(
        and(
          eq(tastytradeAccounts.userId, user.id),
          eq(tastytradeAccounts.isDemoAccount, 1)
        )
      )
      .limit(1);
    
    return demoAccount?.demoBalance || null;
  }),
});
