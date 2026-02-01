import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { tastytradeAccounts } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

// Starter watchlist for demo users (from production environment)
const DEMO_WATCHLIST = [
  'AAPL', 'MSFT', 'AMZN', 'TSLA', 'META', 'GOOGL', 'NVDA', 'AVGO',
  'V', 'JPM', 'JNJ', 'UNH', 'PG', 'HD', 'DIS', 'ADBE',
  'COIN', 'SOFI', 'HOOD', 'DKNG', 'PINS',
  'CVX', 'CAT', 'F', 'AAL', 'FCX',
  'AXP', 'GS', 'ABBV', 'ORCL', 'TSM', 'QCOM', 'CMCSA'
];

/**
 * Demo account management procedures
 */
export const demoRouter = router({
  /**
   * Get or create demo account for trial users
   * Auto-creates a $100K demo account on first call
   */
  getOrCreateDemoAccount: protectedProcedure.query(async ({ ctx }: { ctx: any }) => {
    const userId = ctx.user.id;
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    // Check if user already has a demo account
    const existingDemoAccount = await db
      .select()
      .from(tastytradeAccounts)
      .where(
        and(
          eq(tastytradeAccounts.userId, userId),
          eq(tastytradeAccounts.isDemoAccount, 1)
        )
      )
      .limit(1);

    if (existingDemoAccount.length > 0) {
      return {
        isNew: false,
        account: existingDemoAccount[0],
      };
    }

    // Create new demo account with $100K balance
    const demoAccountId = `DEMO-${userId}-${Date.now()}`;
    await db.insert(tastytradeAccounts).values({
      userId,
      accountId: demoAccountId,
      accountNumber: demoAccountId,
      accountType: "Demo Account",
      nickname: "Demo Trading Account",
      isDemoAccount: 1,
      demoBalance: 100000,
      isActive: 1,
    });

    // Pre-populate watchlist for demo users
    try {
      const watchlistValues = DEMO_WATCHLIST.map(symbol => `(${userId}, '${symbol}', 1, NOW())`);
      await db.execute(sql.raw(
        `INSERT INTO watchlistSelections (userId, symbol, isSelected, updatedAt) VALUES ${watchlistValues.join(', ')} ON DUPLICATE KEY UPDATE isSelected = 1`
      ));
    } catch (err) {
      console.error('[Demo] Failed to populate watchlist:', err);
      // Don't fail account creation if watchlist fails
    }

    // Fetch the newly created account
    const createdAccount = await db
      .select()
      .from(tastytradeAccounts)
      .where(eq(tastytradeAccounts.accountId, demoAccountId))
      .limit(1);

    return {
      isNew: true,
      account: createdAccount[0],
    };
  }),

  /**
   * Check if user has any real Tastytrade accounts
   * Used to determine if user should see demo mode or live/paper trading toggle
   */
  hasRealAccounts: protectedProcedure.query(async ({ ctx }: { ctx: any }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const realAccounts = await db
      .select()
      .from(tastytradeAccounts)
      .where(
        and(
          eq(tastytradeAccounts.userId, ctx.user.id),
          eq(tastytradeAccounts.isDemoAccount, 0)
        )
      );

    return {
      hasRealAccounts: realAccounts.length > 0,
      count: realAccounts.length,
    };
  }),
});
