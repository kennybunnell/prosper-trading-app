import { randomBytes } from 'crypto';
import { eq, and, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, orderHistory, InsertOrderHistory, appConfig } from "../drizzle/schema";
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

/**
 * Returns the stable app-level JWT signing secret, creating and persisting it
 * on first call. This secret survives sandbox restarts, hibernation, and
 * JWT_SECRET environment variable rotation — making all user sessions permanent
 * until explicitly invalidated.
 *
 * Falls back to ENV.cookieSecret if the database is unavailable.
 */
export async function getOrCreateAppSecret(): Promise<string> {
  const APP_SECRET_KEY = 'jwt_signing_secret';
  const db = await getDb();
  if (!db) {
    console.warn('[AppSecret] Database unavailable, falling back to ENV.cookieSecret');
    return ENV.cookieSecret;
  }
  try {
    // Try to read existing secret
    const rows = await db.select().from(appConfig).where(eq(appConfig.key, APP_SECRET_KEY)).limit(1);
    if (rows.length > 0 && rows[0].value) {
      return rows[0].value;
    }
    // Generate a new 32-byte hex secret and persist it
    const newSecret = randomBytes(32).toString('hex');
    await db.insert(appConfig).values({ key: APP_SECRET_KEY, value: newSecret })
      .onDuplicateKeyUpdate({ set: { key: APP_SECRET_KEY } }); // no-op on race condition
    console.log('[AppSecret] Generated and stored new stable JWT signing secret in database');
    return newSecret;
  } catch (error) {
    console.warn('[AppSecret] Failed to read/write DB secret, falling back to ENV.cookieSecret:', error);
    return ENV.cookieSecret;
  }
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

  // Retry up to 3 times for transient TiDB schema cache errors
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    // Check if user already exists BEFORE upsert to detect new users correctly
    const { eq } = await import('drizzle-orm');
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, user.openId))
      .limit(1);

    const isNewUser = existingUser.length === 0;

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

    const result = await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });

    // Trigger onboarding for new users only
    // MySQL's onDuplicateKeyUpdate returns insertId for both INSERT and UPDATE,
    // so we check if user existed BEFORE the upsert operation
    if (isNewUser) {
      const userId = existingUser.length > 0 ? existingUser[0].id : Number((result as any)[0]?.insertId);
      console.log(`[Database] New user created with ID ${userId}, triggering onboarding`);
      
      // Import and run onboarding asynchronously (don't block login)
      import('./onboarding').then(async ({ onboardNewUser }) => {
        try {
          const onboardingResult = await onboardNewUser(userId);
          if (onboardingResult.success) {
            console.log(`[Database] Onboarding completed for user ${userId}`);
          } else {
            console.error(`[Database] Onboarding failed for user ${userId}:`, onboardingResult.errors);
          }
        } catch (error) {
          console.error(`[Database] Onboarding error for user ${userId}:`, error);
        }
      }).catch(error => {
        console.error(`[Database] Failed to import onboarding module:`, error);
      });
    } else {
      console.log(`[Database] Existing user logged in (openId: ${user.openId.substring(0, 10)}...), skipping onboarding`);
    }
  } catch (error: any) {
    const isSchemaError = error?.message?.includes('Information schema is out of date') ||
      error?.cause?.message?.includes('Information schema is out of date');
    if (isSchemaError && attempt < MAX_RETRIES) {
      console.warn(`[Database] TiDB schema cache error on attempt ${attempt}/${MAX_RETRIES}, retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
  break; // success — exit retry loop
  } // end retry loop
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

export async function updateUser(userId: number, updates: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update user: database not available");
    return;
  }

  await db.update(users).set(updates).where(eq(users.id, userId));
}

// Watchlist queries (shared across all strategies)
export async function getWatchlist(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const { watchlists } = await import('../drizzle/schema');
  const { eq, asc } = await import('drizzle-orm');
  return db.select().from(watchlists).where(eq(watchlists.userId, userId)).orderBy(asc(watchlists.symbol));
}

export async function addToWatchlist(userId: number, symbol: string, strategy: 'csp' | 'cc' | 'pmcc' | 'bps' | 'bcs' = 'csp') {
  const db = await getDb();
  if (!db) return;
  const { watchlists } = await import('../drizzle/schema');
  // Use onDuplicateKeyUpdate as a no-op so duplicate inserts are silently ignored
  await db.insert(watchlists).values({ userId, symbol, strategy })
    .onDuplicateKeyUpdate({ set: { symbol } });
}

export async function addToWatchlistWithMetadata(
  userId: number, 
  data: { 
    symbol: string;
    strategy?: 'csp' | 'cc' | 'pmcc' | 'bps' | 'bcs';
    company?: string;
    type?: string;
    sector?: string;
    reason?: string;
    rank?: number;
    isIndex?: boolean;
  }
) {
  const db = await getDb();
  if (!db) return;
  const { watchlists } = await import('../drizzle/schema');
  const { isIndexSymbol } = await import('../shared/index-symbols');
  // Auto-detect index symbols if not explicitly provided
  const resolvedIsIndex = data.isIndex !== undefined ? data.isIndex : isIndexSymbol(data.symbol);
  // Use onDuplicateKeyUpdate as a no-op so duplicate inserts are silently ignored
  await db.insert(watchlists).values({
    userId,
    symbol: data.symbol,
    strategy: data.strategy || 'csp',
    company: data.company,
    type: data.type,
    sector: data.sector,
    reason: data.reason,
    rank: data.rank,
    isIndex: resolvedIsIndex,
  }).onDuplicateKeyUpdate({ set: { symbol: data.symbol } });
}

export async function importWatchlistFromCSV(
  userId: number,
  items: Array<{
    symbol: string;
    company?: string;
    type?: string;
    sector?: string;
    reason?: string;
    rank?: number;
  }>
) {
  const db = await getDb();
  if (!db) return { success: false, imported: 0, skipped: 0 };
  
  const { watchlists } = await import('../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  
  let imported = 0;
  let skipped = 0;
  
  for (const item of items) {
    try {
      // Check if symbol already exists
      const existing = await db.select().from(watchlists)
        .where(and(
          eq(watchlists.userId, userId),
          eq(watchlists.symbol, item.symbol)
        ))
        .limit(1);
      
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      
      await db.insert(watchlists).values({
        userId,
        symbol: item.symbol,
        strategy: 'csp',
        company: item.company,
        type: item.type,
        sector: item.sector,
        reason: item.reason,
        rank: item.rank,
      });
      imported++;
    } catch (error) {
      console.error(`[DB] Failed to import ${item.symbol}:`, error);
      skipped++;
    }
  }
  
  return { success: true, imported, skipped };
}

export async function updateWatchlistMetadata(
  userId: number,
  data: {
    id: number;
    company?: string;
    type?: string;
    sector?: string;
    reason?: string;
    rank?: number;
    portfolioSize?: 'small' | 'medium' | 'large';
    price?: string;
  }
) {
  const db = await getDb();
  if (!db) return;
  
  const { watchlists } = await import('../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  
  const updateData: any = {};
  if (data.company !== undefined) updateData.company = data.company;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.sector !== undefined) updateData.sector = data.sector;
  if (data.portfolioSize !== undefined) updateData.portfolioSize = data.portfolioSize;
  if (data.price !== undefined) updateData.price = data.price;
  if (data.reason !== undefined) updateData.reason = data.reason;
  if (data.rank !== undefined) updateData.rank = data.rank;
  
  if (Object.keys(updateData).length === 0) return;
  
  await db.update(watchlists)
    .set(updateData)
    .where(and(
      eq(watchlists.id, data.id),
      eq(watchlists.userId, userId)
    ));
}

export async function removeFromWatchlist(userId: number, symbol: string) {
  const db = await getDb();
  if (!db) return;
  const { watchlists } = await import('../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  await db.delete(watchlists).where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol)));
}

// API Credentials queries
export async function getApiCredentials(userId: number) {
  console.log('[getApiCredentials] === CREDENTIALS QUERY START ===');
  console.log('[getApiCredentials] Querying for userId:', userId);
  
  const db = await getDb();
  if (!db) {
    console.log('[getApiCredentials] Database not available');
    return null;
  }
  
  const { apiCredentials } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  const result = await db.select().from(apiCredentials).where(eq(apiCredentials.userId, userId)).limit(1);
  
  if (result.length > 0) {
    console.log('[getApiCredentials] Credentials found:', {
      id: result[0].id,
      userId: result[0].userId,
      hasClientSecret: !!result[0].tastytradeClientSecret,
      clientSecretLength: result[0].tastytradeClientSecret?.length || 0,
      hasRefreshToken: !!result[0].tastytradeRefreshToken,
      refreshTokenLength: result[0].tastytradeRefreshToken?.length || 0,
      refreshTokenStart: result[0].tastytradeRefreshToken?.substring(0, 50) || 'none',
      refreshTokenEnd: result[0].tastytradeRefreshToken?.substring(result[0].tastytradeRefreshToken.length - 50) || 'none',
    });
  } else {
    console.log('[getApiCredentials] No credentials found for userId:', userId);
  }
  
  console.log('[getApiCredentials] === CREDENTIALS QUERY END ===');
  return result.length > 0 ? result[0] : null;
}

/**
 * Save access token to database for persistence across restarts
 */
export async function saveAccessToken(userId: number, accessToken: string, expiresAt: Date) {
  console.log('[DB] Saving access token to database:', {
    userId,
    accessTokenLength: accessToken.length,
    expiresAt: expiresAt.toISOString(),
  });
  
  const db = await getDb();
  if (!db) return;
  
  const { apiCredentials } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  await db
    .update(apiCredentials)
    .set({
      tastytradeAccessToken: accessToken,
      tastytradeAccessTokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(apiCredentials.userId, userId));
  
  console.log('[DB] Access token saved successfully');
}

/**
 * Load access token from database (used on server startup)
 */
export async function loadAccessToken(userId: number): Promise<{
  accessToken: string | null;
  expiresAt: Date | null;
} | null> {
  console.log('[DB] Loading access token from database for userId:', userId);
  
  const db = await getDb();
  if (!db) {
    console.log('[DB] Database not available');
    return null;
  }
  
  const { apiCredentials } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  const result = await db
    .select({
      accessToken: apiCredentials.tastytradeAccessToken,
      expiresAt: apiCredentials.tastytradeAccessTokenExpiresAt,
    })
    .from(apiCredentials)
    .where(eq(apiCredentials.userId, userId))
    .limit(1);
  
  if (result.length === 0) {
    console.log('[DB] No access token found in database');
    return null;
  }
  
  const token = result[0];
  console.log('[DB] Access token loaded:', {
    hasToken: !!token.accessToken,
    tokenLength: token.accessToken?.length || 0,
    expiresAt: token.expiresAt?.toISOString() || 'null',
    isExpired: token.expiresAt ? new Date() >= token.expiresAt : true,
  });
  
  return {
    accessToken: token.accessToken || null,
    expiresAt: token.expiresAt || null,
  };
}

export async function upsertApiCredentials(userId: number, credentials: { 
  tastytradeUsername?: string; 
  tastytradePassword?: string; 
  tastytradeClientId?: string;
  tastytradeClientSecret?: string; 
  tastytradeRefreshToken?: string; 
  tradierApiKey?: string; 
  tradierAccountId?: string; 
  tradierAccountBalance?: string;
  tradierAccountStatus?: string;
  tradierBuyingPower?: string;
  tradierLastHealthCheck?: Date;
  defaultTastytradeAccountId?: string 
}) {
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
  const { eq, and } = await import('drizzle-orm');
  
  // Filter out undefined and empty string values from optional fields only
  const filteredAccount: any = {
    accountId: account.accountId,
    accountNumber: account.accountNumber,
  };
  
  if (account.accountType !== undefined && account.accountType !== "") {
    filteredAccount.accountType = account.accountType;
  }
  if (account.nickname !== undefined && account.nickname !== "") {
    filteredAccount.nickname = account.nickname;
  }
  
  // Check if account already exists FOR THIS USER (userId + accountId must both match)
  const existing = await db.select().from(tastytradeAccounts)
    .where(and(eq(tastytradeAccounts.userId, userId), eq(tastytradeAccounts.accountId, account.accountId)))
    .limit(1);
  
  if (existing.length > 0) {
    // Update existing record — scope update to this user's record only
    await db.update(tastytradeAccounts)
      .set(filteredAccount)
      .where(and(eq(tastytradeAccounts.userId, userId), eq(tastytradeAccounts.accountId, account.accountId)));
  } else {
    // Insert new record
    await db.insert(tastytradeAccounts).values({ userId, ...filteredAccount });
  }
}

/**
 * Delete accounts that are no longer returned by the Tastytrade API.
 * Called after a sync to remove closed/removed accounts from the local DB.
 * Safety guard: if liveAccountNumbers is empty, nothing is deleted.
 */
export async function deleteRemovedTastytradeAccounts(userId: number, liveAccountNumbers: string[]): Promise<number> {
  if (liveAccountNumbers.length === 0) return 0;
  const db = await getDb();
  if (!db) return 0;
  const { tastytradeAccounts } = await import('../drizzle/schema');
  const { eq, and, inArray } = await import('drizzle-orm');

  const existing = await db.select({ accountNumber: tastytradeAccounts.accountNumber })
    .from(tastytradeAccounts)
    .where(eq(tastytradeAccounts.userId, userId));

  // Find accounts in DB that are NOT in the live list from Tastytrade
  const toDelete = existing
    .map((a) => a.accountNumber)
    .filter((n) => !liveAccountNumbers.includes(n));

  if (toDelete.length === 0) return 0;

  console.log('[DB] Deleting removed Tastytrade accounts:', toDelete);
  // Use inArray (not notInArray) to delete ONLY the removed accounts
  await db.delete(tastytradeAccounts)
    .where(
      and(
        eq(tastytradeAccounts.userId, userId),
        inArray(tastytradeAccounts.accountNumber, toDelete)
      )
    );

  return toDelete.length;
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

/**
 * Seed default CSP filter presets for a user if they don't exist
 */
export async function seedCspFilterPresets(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed filter presets: database not available");
    return;
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  try {
    // Check if presets already exist for this user
    const existing = await db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "csp")))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Database] Filter presets already exist for user ${userId}`);
      return;
    }

    // Default values matching production dev environment
    const defaults = [
      {
        userId,
        presetName: "conservative" as const,
        minDte: 14,
        maxDte: 45,
        minDelta: "0.10",
        maxDelta: "0.25",
        minOpenInterest: 50,
        minVolume: 30,
        minRsi: 20,
        maxRsi: 70,
        minIvRank: 20,
        maxIvRank: 100,
        minBbPercent: "0",
        maxBbPercent: "0.7",
        minScore: 50,
        maxStrikePercent: 100,
      },
      {
        userId,
        presetName: "medium" as const,
        minDte: 7,
        maxDte: 45,
        minDelta: "0.15",
        maxDelta: "0.35",
        minOpenInterest: 50,
        minVolume: 25,
        minRsi: 15,
        maxRsi: 80,
        minIvRank: 10,
        maxIvRank: 100,
        minBbPercent: "0",
        maxBbPercent: "0.8",
        minScore: 40,
        maxStrikePercent: 105,
      },
      {
        userId,
        presetName: "aggressive" as const,
        minDte: 7,
        maxDte: 30,
        minDelta: "0.20",
        maxDelta: "0.45",
        minOpenInterest: 30,
        minVolume: 20,
        minRsi: 10,
        maxRsi: 90,
        minIvRank: 0,
        maxIvRank: 100,
        minBbPercent: "0",
        maxBbPercent: "1.0",
        minScore: 30,
        maxStrikePercent: 110,
      },
    ];

    // Add strategy field to each preset
    const presetsWithStrategy = defaults.map(preset => ({ ...preset, strategy: "csp" as const }));
    await db.insert(filterPresets).values(presetsWithStrategy);
    console.log(`[Database] Seeded ${defaults.length} filter presets for user ${userId}`);
  } catch (error) {
    console.error("[Database] Failed to seed filter presets:", error);
    throw error;
  }
}

/**
 * Get all CSP filter presets for a user
 */
export async function getCspFilterPresets(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const presets = await db
    .select()
    .from(filterPresets)
    .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "csp")));

  return presets;
}

/**
 * Update a specific CSP filter preset
 */
export async function updateCspFilterPreset(
  userId: number,
  presetName: "conservative" | "medium" | "aggressive",
  updates: Partial<{
    minDte: number;
    maxDte: number;
    minDelta: string;
    maxDelta: string;
    minOpenInterest: number;
    minVolume: number;
    minRsi: number | null;
    maxRsi: number | null;
    minIvRank: number | null;
    maxIvRank: number | null;
    minBbPercent: string | null;
    maxBbPercent: string | null;
    minScore: number;
    maxStrikePercent: number;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  // Filter out undefined values
  const filteredUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, v]) => v !== undefined)
  );

  if (Object.keys(filteredUpdates).length === 0) {
    console.log("[Database] No values to update for filter preset");
    return;
  }

  await db
    .update(filterPresets)
    .set(filteredUpdates)
    .where(
      and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "csp"), eq(filterPresets.presetName, presetName))
    );

  console.log(`[Database] Updated ${presetName} filter preset for user ${userId}`);
}


/**
 * Get user preferences
 */
export async function getUserPreferences(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const { userPreferences } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  
  return prefs || null;
}

/**
 * Set Damascus background opacity preference
 */
export async function setDamascusOpacity(userId: number, opacity: number) {
  const db = await getDb();
  if (!db) return;
  const { userPreferences } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  // Check if preferences exist
  const existing = await getUserPreferences(userId);
  
  if (existing) {
    // Update existing preferences
    await db
      .update(userPreferences)
      .set({ damascusOpacity: opacity })
      .where(eq(userPreferences.userId, userId));
  } else {
    // Insert new preferences with default opacity
    await db.insert(userPreferences).values({
      userId,
      damascusOpacity: opacity,
    });
  }
}

/**
 * Set background pattern preference
 */
export async function setBackgroundPattern(userId: number, pattern: 'diagonal' | 'crosshatch' | 'dots' | 'woven' | 'none') {
  const db = await getDb();
  if (!db) return;
  const { userPreferences } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  // Check if preferences exist
  const existing = await getUserPreferences(userId);
  
  if (existing) {
    // Update existing preferences
    await db
      .update(userPreferences)
      .set({ backgroundPattern: pattern })
      .where(eq(userPreferences.userId, userId));
  } else {
    // Insert new preferences with selected pattern
    await db.insert(userPreferences).values({
      userId,
      backgroundPattern: pattern,
    });
  }
}

/**
 * Upsert user preferences
 */
export async function upsertUserPreferences(
  userId: number,
  preferences: { 
    defaultTastytradeAccountId?: string;
    strategyAdvisorAutoRefresh?: boolean;
    strategyAdvisorRefreshInterval?: number;
    taxRate?: number;
    monthlyIncomeTarget?: number;
  }
) {
  const db = await getDb();
  if (!db) return null;
  const { userPreferences } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  // Check if preferences exist
  const existing = await getUserPreferences(userId);
  
  if (existing) {
    // Update existing preferences
    const updates: any = {};
    if (preferences.defaultTastytradeAccountId !== undefined) {
      updates.defaultTastytradeAccountId = preferences.defaultTastytradeAccountId;
    }
    if (preferences.strategyAdvisorAutoRefresh !== undefined) {
      updates.strategyAdvisorAutoRefresh = preferences.strategyAdvisorAutoRefresh;
    }
    if (preferences.strategyAdvisorRefreshInterval !== undefined) {
      updates.strategyAdvisorRefreshInterval = preferences.strategyAdvisorRefreshInterval;
    }
    if (preferences.taxRate !== undefined) {
      updates.taxRate = preferences.taxRate;
    }
    if (preferences.monthlyIncomeTarget !== undefined) {
      updates.monthlyIncomeTarget = preferences.monthlyIncomeTarget;
    }
    
    if (Object.keys(updates).length > 0) {
      await db
        .update(userPreferences)
        .set(updates)
        .where(eq(userPreferences.userId, userId));
    }
  } else {
    // Insert new preferences
    await db.insert(userPreferences).values({
      userId,
      defaultTastytradeAccountId: preferences.defaultTastytradeAccountId || null,
      strategyAdvisorAutoRefresh: preferences.strategyAdvisorAutoRefresh ?? false,
      strategyAdvisorRefreshInterval: preferences.strategyAdvisorRefreshInterval ?? 30,
      taxRate: preferences.taxRate ?? 24,
    });
  }
  
  return getUserPreferences(userId);
}

/**
 * Order History Tracking Functions
 * Used for fill rate analytics and order lifecycle management
 */

/**
 * Record a new order submission
 */
export async function recordOrderSubmission(data: {
  userId: number;
  accountId: string;
  orderId: string;
  symbol: string;
  underlyingSymbol: string;
  action: string;
  strategy: string;
  strike: string;
  expiration: string;
  quantity: number;
  submittedPrice: string;
  submittedAt: Date;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot record order submission: database not available");
    return;
  }

  try {
    await db.insert(orderHistory).values({
      userId: data.userId,
      accountId: data.accountId,
      orderId: data.orderId,
      symbol: data.symbol,
      underlyingSymbol: data.underlyingSymbol,
      action: data.action,
      strategy: data.strategy,
      strike: data.strike,
      expiration: data.expiration,
      quantity: data.quantity,
      submittedPrice: data.submittedPrice,
      finalPrice: null,
      submittedAt: data.submittedAt,
      filledAt: null,
      canceledAt: null,
      replacementCount: 0,
      fillDurationMinutes: null,
      wasAutoCanceled: 0,
      status: 'working',
    });
    console.log(`[OrderHistory] Recorded submission for order ${data.orderId}`);
  } catch (error) {
    console.error("[OrderHistory] Failed to record order submission:", error);
  }
}

/**
 * Update order when it's replaced
 */
export async function recordOrderReplacement(orderId: string, newOrderId: string, newPrice: string) {
  const db = await getDb();
  if (!db) return;

  try {
    // Increment replacement count for old order
    await db
      .update(orderHistory)
      .set({
        replacementCount: sql`${orderHistory.replacementCount} + 1`,
        status: 'canceled',
        canceledAt: new Date(),
      })
      .where(eq(orderHistory.orderId, orderId));

    // Copy old order data to new order with incremented replacement count
    const oldOrder = await db
      .select()
      .from(orderHistory)
      .where(eq(orderHistory.orderId, orderId))
      .limit(1);

    if (oldOrder.length > 0) {
      const old = oldOrder[0];
      await db.insert(orderHistory).values({
        userId: old.userId,
        accountId: old.accountId,
        orderId: newOrderId,
        symbol: old.symbol,
        underlyingSymbol: old.underlyingSymbol,
        action: old.action,
        strategy: old.strategy,
        strike: old.strike,
        expiration: old.expiration,
        quantity: old.quantity,
        submittedPrice: newPrice,
        finalPrice: null,
        submittedAt: new Date(),
        filledAt: null,
        canceledAt: null,
        replacementCount: old.replacementCount + 1,
        fillDurationMinutes: null,
        wasAutoCanceled: 0,
        status: 'working',
      });
      console.log(`[OrderHistory] Recorded replacement ${orderId} → ${newOrderId}`);
    }
  } catch (error) {
    console.error("[OrderHistory] Failed to record order replacement:", error);
  }
}

/**
 * Update order when it's filled
 */
export async function recordOrderFilled(orderId: string, finalPrice: string) {
  const db = await getDb();
  if (!db) return;

  try {
    const order = await db
      .select()
      .from(orderHistory)
      .where(eq(orderHistory.orderId, orderId))
      .limit(1);

    if (order.length > 0) {
      const fillDuration = Math.floor((Date.now() - order[0].submittedAt.getTime()) / 60000);
      
      await db
        .update(orderHistory)
        .set({
          status: 'filled',
          filledAt: new Date(),
          finalPrice,
          fillDurationMinutes: fillDuration,
        })
        .where(eq(orderHistory.orderId, orderId));
      
      console.log(`[OrderHistory] Recorded fill for order ${orderId} in ${fillDuration} minutes`);
    }
  } catch (error) {
    console.error("[OrderHistory] Failed to record order fill:", error);
  }
}

/**
 * Update order when it's canceled
 */
export async function recordOrderCanceled(orderId: string, wasAutoCanceled: boolean = false) {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(orderHistory)
      .set({
        status: 'canceled',
        canceledAt: new Date(),
        wasAutoCanceled: wasAutoCanceled ? 1 : 0,
      })
      .where(eq(orderHistory.orderId, orderId));
    
    console.log(`[OrderHistory] Recorded cancellation for order ${orderId}`);
  } catch (error) {
    console.error("[OrderHistory] Failed to record order cancellation:", error);
  }
}

/**
 * Get fill rate analytics for a user
 * Returns success rates for orders filled within 5, 15, and 30 minutes
 */
export async function getFillRateAnalytics(userId: number, daysBack: number = 30) {
  const db = await getDb();
  if (!db) return null;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get all filled orders in the time period
    const filledOrders = await db
      .select()
      .from(orderHistory)
      .where(
        and(
          eq(orderHistory.userId, userId),
          eq(orderHistory.status, 'filled'),
          gte(orderHistory.submittedAt, cutoffDate)
        )
      );

    if (filledOrders.length === 0) {
      return {
        totalOrders: 0,
        filledWithin5Min: 0,
        filledWithin15Min: 0,
        filledWithin30Min: 0,
        fillRate5Min: 0,
        fillRate15Min: 0,
        fillRate30Min: 0,
        avgFillTime: 0,
        byStrategy: {},
        bySymbol: {},
      };
    }

    const within5 = filledOrders.filter(o => (o.fillDurationMinutes ?? 999) <= 5).length;
    const within15 = filledOrders.filter(o => (o.fillDurationMinutes ?? 999) <= 15).length;
    const within30 = filledOrders.filter(o => (o.fillDurationMinutes ?? 999) <= 30).length;
    
    const avgFillTime = filledOrders.reduce((sum, o) => sum + (o.fillDurationMinutes ?? 0), 0) / filledOrders.length;

    // Group by strategy
    const byStrategy: Record<string, { total: number; within5: number; within15: number; within30: number }> = {};
    for (const order of filledOrders) {
      const strat = order.strategy || 'Unknown';
      if (!byStrategy[strat]) {
        byStrategy[strat] = { total: 0, within5: 0, within15: 0, within30: 0 };
      }
      byStrategy[strat].total++;
      if ((order.fillDurationMinutes ?? 999) <= 5) byStrategy[strat].within5++;
      if ((order.fillDurationMinutes ?? 999) <= 15) byStrategy[strat].within15++;
      if ((order.fillDurationMinutes ?? 999) <= 30) byStrategy[strat].within30++;
    }

    // Group by underlying symbol
    const bySymbol: Record<string, { total: number; within5: number; within15: number; within30: number }> = {};
    for (const order of filledOrders) {
      const sym = order.underlyingSymbol;
      if (!bySymbol[sym]) {
        bySymbol[sym] = { total: 0, within5: 0, within15: 0, within30: 0 };
      }
      bySymbol[sym].total++;
      if ((order.fillDurationMinutes ?? 999) <= 5) bySymbol[sym].within5++;
      if ((order.fillDurationMinutes ?? 999) <= 15) bySymbol[sym].within15++;
      if ((order.fillDurationMinutes ?? 999) <= 30) bySymbol[sym].within30++;
    }

    return {
      totalOrders: filledOrders.length,
      filledWithin5Min: within5,
      filledWithin15Min: within15,
      filledWithin30Min: within30,
      fillRate5Min: (within5 / filledOrders.length) * 100,
      fillRate15Min: (within15 / filledOrders.length) * 100,
      fillRate30Min: (within30 / filledOrders.length) * 100,
      avgFillTime: Math.round(avgFillTime),
      byStrategy,
      bySymbol,
    };
  } catch (error) {
    console.error("[OrderHistory] Failed to get fill rate analytics:", error);
    return null;
  }
}

/**
 * Get orders that have been working for more than X minutes
 */
export async function getStuckOrders(userId: number, minutesThreshold: number = 120) {
  const db = await getDb();
  if (!db) return [];

  try {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - minutesThreshold);

    const stuckOrders = await db
      .select()
      .from(orderHistory)
      .where(
        and(
          eq(orderHistory.userId, userId),
          eq(orderHistory.status, 'working'),
          sql`${orderHistory.submittedAt} <= ${cutoffTime.toISOString()}`
        )
      );

    return stuckOrders;
  } catch (error) {
    console.error("[OrderHistory] Failed to get stuck orders:", error);
    return [];
  }
}

/**
 * Get watchlist ticker selections for a user
 */
export async function getWatchlistSelections(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    const { watchlistSelections } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    
    const selections = await db
      .select()
      .from(watchlistSelections)
      .where(eq(watchlistSelections.userId, userId));
    
    return selections;
  } catch (error) {
    console.error("[Database] Failed to get watchlist selections:", error);
    return [];
  }
}

/**
 * Toggle ticker selection state
 */
export async function toggleWatchlistSelection(userId: number, symbol: string) {
  const db = await getDb();
  if (!db) return;
  
  try {
    const { watchlistSelections } = await import('../drizzle/schema');
    const { eq, and } = await import('drizzle-orm');
    
    // Check if selection exists
    const existing = await db
      .select()
      .from(watchlistSelections)
      .where(
        and(
          eq(watchlistSelections.userId, userId),
          eq(watchlistSelections.symbol, symbol)
        )
      );
    
    if (existing.length > 0) {
      // Toggle existing selection
      const newState = existing[0].isSelected === 1 ? 0 : 1;
      await db
        .update(watchlistSelections)
        .set({ isSelected: newState, updatedAt: new Date() })
        .where(
          and(
            eq(watchlistSelections.userId, userId),
            eq(watchlistSelections.symbol, symbol)
          )
        );
    } else {
      // Create new selection (default selected)
      await db.insert(watchlistSelections).values({
        userId,
        symbol,
        isSelected: 1,
      });
    }
  } catch (error) {
    console.error("[Database] Failed to toggle watchlist selection:", error);
  }
}

/**
 * Set all ticker selections to a specific state
 */
export async function setAllWatchlistSelections(userId: number, symbols: string[], isSelected: boolean) {
  const db = await getDb();
  if (!db) return;
  
  try {
    const { watchlistSelections } = await import('../drizzle/schema');
    const { eq, and } = await import('drizzle-orm');
    
    const selectedValue = isSelected ? 1 : 0;
    
    // If clearing all (isSelected = false), clear ALL user selections, not just the provided symbols
    if (!isSelected) {
      await db
        .update(watchlistSelections)
        .set({ isSelected: 0, updatedAt: new Date() })
        .where(eq(watchlistSelections.userId, userId));
      return;
    }
    
    // If selecting all, first clear ALL selections, then select only the provided symbols
    // This ensures Strategy Advisor pre-selection works correctly
    await db
      .update(watchlistSelections)
      .set({ isSelected: 0, updatedAt: new Date() })
      .where(eq(watchlistSelections.userId, userId));
    
    // Now select only the provided symbols
    for (const symbol of symbols) {
      // Check if selection exists
      const existing = await db
        .select()
        .from(watchlistSelections)
        .where(
          and(
            eq(watchlistSelections.userId, userId),
            eq(watchlistSelections.symbol, symbol)
          )
        );
      
      if (existing.length > 0) {
        // Update existing selection
        await db
          .update(watchlistSelections)
          .set({ isSelected: selectedValue, updatedAt: new Date() })
          .where(
            and(
              eq(watchlistSelections.userId, userId),
              eq(watchlistSelections.symbol, symbol)
            )
          );
      } else {
        // Create new selection
        await db.insert(watchlistSelections).values({
          userId,
          symbol,
          isSelected: selectedValue,
        });
      }
    }
  } catch (error) {
    console.error("[Database] Failed to set all watchlist selections:", error);
  }
}

/**
 * Fetch replacement counts for a list of Tastytrade order IDs.
 * Returns a Map<orderId, replacementCount> for quick lookup.
 */
/**
 * Record a successfully submitted roll order so the Roll Dashboard
 * can flag positions that have already been rolled today.
 */
export async function recordSubmittedRoll(data: {
  userId: number;
  accountId: string;
  positionId: string;
  symbol: string;
  strategy: string;
  orderId: string;
  newExpiration?: string;
  newStrike?: string;
  netCredit?: string;
}) {
  try {
    const db = await getDb();
    if (!db) return;
    const { submittedRolls } = await import('../drizzle/schema');
    await db.insert(submittedRolls).values({
      userId: data.userId,
      accountId: data.accountId,
      positionId: data.positionId,
      symbol: data.symbol,
      strategy: data.strategy,
      orderId: data.orderId,
      newExpiration: data.newExpiration ?? null,
      newStrike: data.newStrike ?? null,
      netCredit: data.netCredit ?? null,
    });
    console.log(`[SubmittedRolls] Recorded roll for positionId=${data.positionId} orderId=${data.orderId}`);
  } catch (err) {
    console.warn('[SubmittedRolls] Failed to record submitted roll:', err);
  }
}

/**
 * Return the set of positionIds that the user has already rolled today (UTC day).
 */
export async function getRolledTodayPositionIds(userId: number): Promise<Set<string>> {
  const result = new Set<string>();
  try {
    const db = await getDb();
    if (!db) return result;
    const { submittedRolls } = await import('../drizzle/schema');
    const { sql: sqlExpr } = await import('drizzle-orm');
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().slice(0, 19).replace('T', ' ');
    const filtered = await db
      .select({ positionId: submittedRolls.positionId })
      .from(submittedRolls)
      .where(sqlExpr`${submittedRolls.userId} = ${userId} AND ${submittedRolls.rolledAt} >= ${todayStr}`);
    for (const row of filtered) {
      result.add(row.positionId);
    }
  } catch (err) {
    console.warn('[SubmittedRolls] getRolledTodayPositionIds failed:', err);
  }
  return result;
}

export async function getReplacementCounts(orderIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (orderIds.length === 0) return result;
  try {
    const db = await getDb();
    if (!db) return result;
    const { inArray } = await import('drizzle-orm');
    const rows = await db
      .select({ orderId: orderHistory.orderId, replacementCount: orderHistory.replacementCount })
      .from(orderHistory)
      .where(inArray(orderHistory.orderId, orderIds));
    for (const row of rows) {
      if (row.orderId) result.set(row.orderId, row.replacementCount);
    }
  } catch (err) {
    console.warn('[Database] getReplacementCounts failed:', err);
  }
  return result;
}
