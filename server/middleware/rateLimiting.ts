/**
 * Rate Limiting Middleware for Tier 1 Free Trial Users
 * 
 * Enforces 10 scans per day limit for users with subscriptionTier = 'free_trial'
 * Owner/admin accounts bypass all rate limiting checks
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { apiUsage } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { isOwnerAccount } from "../../shared/auth";

const TIER1_DAILY_SCAN_LIMIT = 10;

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Check if user has exceeded daily scan limit
 * Returns current scan count and whether limit is exceeded
 */
export async function checkRateLimit(userId: number, userTier: string | null, userRole: string): Promise<{
  allowed: boolean;
  currentCount: number;
  limit: number;
  message?: string;
}> {
  // Owner/admin bypass all rate limiting
  if (userRole === 'admin' || userRole === 'owner') {
    console.log('[Rate Limit] Owner/admin detected - bypassing rate limit check');
    return { allowed: true, currentCount: 0, limit: TIER1_DAILY_SCAN_LIMIT };
  }

  // Only enforce rate limiting for free trial users
  if (userTier !== 'free_trial') {
    return { allowed: true, currentCount: 0, limit: TIER1_DAILY_SCAN_LIMIT };
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Database not available',
    });
  }

  const today = getCurrentDate();

  // Get or create today's usage record
  const [usageRecord] = await db
    .select()
    .from(apiUsage)
    .where(and(
      eq(apiUsage.userId, userId),
      eq(apiUsage.date, today)
    ))
    .limit(1);

  const currentCount = usageRecord?.scanCount || 0;

  if (currentCount >= TIER1_DAILY_SCAN_LIMIT) {
    return {
      allowed: false,
      currentCount,
      limit: TIER1_DAILY_SCAN_LIMIT,
      message: `You've reached your daily scan limit (${TIER1_DAILY_SCAN_LIMIT}/day). Upgrade to Wheel View ($47/month) to get unlimited scans. Note: You'll need your own Tradier API key, which requires a funded brokerage account.`
    };
  }

  return {
    allowed: true,
    currentCount,
    limit: TIER1_DAILY_SCAN_LIMIT
  };
}

/**
 * Increment scan count for a user
 * Should be called after a successful scan operation
 */
export async function incrementScanCount(userId: number, userTier: string | null, userRole: string): Promise<void> {
  // Owner/admin bypass all rate limiting
  if (userRole === 'admin' || userRole === 'owner') {
    console.log('[Rate Limit] Owner/admin detected - skipping scan count increment');
    return;
  }

  // Only track usage for free trial users
  if (userTier !== 'free_trial') {
    return;
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Database not available',
    });
  }

  const today = getCurrentDate();

  // Get existing record
  const [existingRecord] = await db
    .select()
    .from(apiUsage)
    .where(and(
      eq(apiUsage.userId, userId),
      eq(apiUsage.date, today)
    ))
    .limit(1);

  if (existingRecord) {
    // Increment existing record
    await db
      .update(apiUsage)
      .set({ scanCount: existingRecord.scanCount + 1 })
      .where(eq(apiUsage.id, existingRecord.id));
    
    console.log(`[Rate Limit] Incremented scan count for user ${userId}: ${existingRecord.scanCount + 1}/${TIER1_DAILY_SCAN_LIMIT}`);
  } else {
    // Create new record
    await db.insert(apiUsage).values({
      userId,
      date: today,
      scanCount: 1,
    });
    
    console.log(`[Rate Limit] Created new scan count record for user ${userId}: 1/${TIER1_DAILY_SCAN_LIMIT}`);
  }
}

/**
 * Get remaining scans for a user today
 */
export async function getRemainingScans(userId: number, userTier: string | null, userRole: string): Promise<{
  remaining: number;
  limit: number;
  used: number;
}> {
  // Owner/admin have unlimited scans
  if (userRole === 'admin' || userRole === 'owner') {
    return { remaining: 999, limit: 999, used: 0 };
  }

  // Non-trial users have unlimited scans
  if (userTier !== 'free_trial') {
    return { remaining: 999, limit: 999, used: 0 };
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Database not available',
    });
  }

  const today = getCurrentDate();

  const [usageRecord] = await db
    .select()
    .from(apiUsage)
    .where(and(
      eq(apiUsage.userId, userId),
      eq(apiUsage.date, today)
    ))
    .limit(1);

  const used = usageRecord?.scanCount || 0;
  const remaining = Math.max(0, TIER1_DAILY_SCAN_LIMIT - used);

  return {
    remaining,
    limit: TIER1_DAILY_SCAN_LIMIT,
    used
  };
}
