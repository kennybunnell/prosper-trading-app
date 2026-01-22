import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Watchlist queries
export async function getWatchlist(userId: number, strategy: 'csp' | 'cc' | 'pmcc') {
  const db = await getDb();
  if (!db) return [];
  const { watchlists } = await import('../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  return db.select().from(watchlists).where(and(eq(watchlists.userId, userId), eq(watchlists.strategy, strategy)));
}

export async function addToWatchlist(userId: number, symbol: string, strategy: 'csp' | 'cc' | 'pmcc') {
  const db = await getDb();
  if (!db) return;
  const { watchlists } = await import('../drizzle/schema');
  await db.insert(watchlists).values({ userId, symbol, strategy });
}

export async function removeFromWatchlist(userId: number, symbol: string, strategy: 'csp' | 'cc' | 'pmcc') {
  const db = await getDb();
  if (!db) return;
  const { watchlists } = await import('../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  await db.delete(watchlists).where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol), eq(watchlists.strategy, strategy)));
}

// API Credentials queries
export async function getApiCredentials(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const { apiCredentials } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  const result = await db.select().from(apiCredentials).where(eq(apiCredentials.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertApiCredentials(userId: number, credentials: { tastytradeUsername?: string; tastytradePassword?: string; tradierApiKey?: string; tradierAccountId?: string; defaultTastytradeAccountId?: string }) {
  const db = await getDb();
  if (!db) return;
  const { apiCredentials } = await import('../drizzle/schema');
  
  // Filter out undefined and empty string values
  const filteredCredentials = Object.fromEntries(
    Object.entries(credentials).filter(([_, value]) => value !== undefined && value !== "")
  );
  
  // If no values to update, skip the operation entirely
  if (Object.keys(filteredCredentials).length === 0) {
    return;
  }
  
  // Check if credentials already exist
  const existing = await getApiCredentials(userId);
  
  if (existing) {
    // Update existing record - only update the fields that are provided
    await db.update(apiCredentials)
      .set(filteredCredentials)
      .where(eq(apiCredentials.userId, userId));
  } else {
    // Insert new record
    await db.insert(apiCredentials).values({ userId, ...filteredCredentials });
  }
}

// Tastytrade Accounts queries
export async function getTastytradeAccounts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const { tastytradeAccounts } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  return db.select().from(tastytradeAccounts).where(eq(tastytradeAccounts.userId, userId));
}

export async function upsertTastytradeAccount(userId: number, account: { accountId: string; accountNumber: string; accountType?: string; nickname?: string }) {
  const db = await getDb();
  if (!db) return;
  const { tastytradeAccounts } = await import('../drizzle/schema');
  await db.insert(tastytradeAccounts).values({ userId, ...account }).onDuplicateKeyUpdate({ set: account });
}

// Trades queries
export async function saveTrade(userId: number, trade: any) {
  const db = await getDb();
  if (!db) return;
  const { trades } = await import('../drizzle/schema');
  await db.insert(trades).values({ userId, ...trade });
}

export async function getTradeHistory(userId: number, accountId?: string) {
  const db = await getDb();
  if (!db) return [];
  const { trades } = await import('../drizzle/schema');
  const { eq, and, desc } = await import('drizzle-orm');
  
  if (accountId) {
    return db.select().from(trades).where(and(eq(trades.userId, userId), eq(trades.accountId, accountId))).orderBy(desc(trades.createdAt));
  }
  return db.select().from(trades).where(eq(trades.userId, userId)).orderBy(desc(trades.createdAt));
}

// Positions queries
export async function getPositions(userId: number, accountId?: string, status: 'open' | 'closed' = 'open') {
  const db = await getDb();
  if (!db) return [];
  const { positions } = await import('../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  
  const conditions = [eq(positions.userId, userId), eq(positions.status, status)];
  if (accountId) conditions.push(eq(positions.accountId, accountId));
  
  return db.select().from(positions).where(and(...conditions));
}

export async function upsertPosition(userId: number, position: any) {
  const db = await getDb();
  if (!db) return;
  const { positions } = await import('../drizzle/schema');
  await db.insert(positions).values({ userId, ...position }).onDuplicateKeyUpdate({ set: position });
}

// Premium tracking queries
export async function savePremiumTracking(userId: number, tracking: any) {
  const db = await getDb();
  if (!db) return;
  const { premiumTracking } = await import('../drizzle/schema');
  await db.insert(premiumTracking).values({ userId, ...tracking });
}

export async function getPremiumSummary(userId: number, accountId?: string, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return [];
  const { premiumTracking } = await import('../drizzle/schema');
  const { eq, and, gte, lte } = await import('drizzle-orm');
  
  const conditions = [eq(premiumTracking.userId, userId)];
  if (accountId) conditions.push(eq(premiumTracking.accountId, accountId));
  if (startDate) conditions.push(gte(premiumTracking.recordedAt, startDate));
  if (endDate) conditions.push(lte(premiumTracking.recordedAt, endDate));
  
  return db.select().from(premiumTracking).where(and(...conditions));
}
