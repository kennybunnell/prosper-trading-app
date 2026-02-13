import { getDb } from './db';
import { oauthTokens } from '../drizzle/schema';
import { encryptToken, decryptToken } from './token-encryption';
import { eq, and } from 'drizzle-orm';

export interface StoredTokens {
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

/**
 * Save OAuth tokens to database (encrypted)
 * Uses upsert pattern - creates new record or updates existing one
 */
export async function saveTokens(
  userId: number,
  provider: string,
  refreshToken: string,
  accessToken?: string,
  expiresAt?: Date,
  scopes?: string[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  const encryptedRefresh = encryptToken(refreshToken);
  const encryptedAccess = accessToken ? encryptToken(accessToken) : null;
  
  try {
    // Try to insert first
    await db.insert(oauthTokens).values({
      userId,
      provider,
      refreshToken: encryptedRefresh,
      accessToken: encryptedAccess,
      expiresAt: expiresAt || null,
      scopes: scopes?.join(',') || null,
    });
    
    console.log(`[Token Persistence] Saved new tokens for user ${userId}, provider ${provider}`);
  } catch (error: any) {
    // If unique constraint violation, update existing record
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      await db.update(oauthTokens)
        .set({
          refreshToken: encryptedRefresh,
          accessToken: encryptedAccess,
          expiresAt: expiresAt || null,
          scopes: scopes?.join(',') || null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        ));
      
      console.log(`[Token Persistence] Updated tokens for user ${userId}, provider ${provider}`);
    } else {
      throw error;
    }
  }
}

/**
 * Get OAuth tokens from database (decrypted)
 * Returns null if no tokens found
 */
export async function getTokens(
  userId: number,
  provider: string
): Promise<StoredTokens | null> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  const result = await db.select().from(oauthTokens)
    .where(and(
      eq(oauthTokens.userId, userId),
      eq(oauthTokens.provider, provider)
    ))
    .limit(1);
  
  if (!result[0]) {
    console.log(`[Token Persistence] No tokens found for user ${userId}, provider ${provider}`);
    return null;
  }
  
  try {
    const decryptedRefresh = decryptToken(result[0].refreshToken);
    const decryptedAccess = result[0].accessToken ? decryptToken(result[0].accessToken) : null;
    
    console.log(`[Token Persistence] Retrieved tokens for user ${userId}, provider ${provider}`);
    
    return {
      refreshToken: decryptedRefresh,
      accessToken: decryptedAccess,
      expiresAt: result[0].expiresAt,
      scopes: result[0].scopes?.split(',').filter(Boolean) || [],
    };
  } catch (error: any) {
    console.error(`[Token Persistence] Failed to decrypt tokens for user ${userId}:`, error.message);
    // If decryption fails, delete corrupted tokens
    await deleteTokens(userId, provider);
    return null;
  }
}

/**
 * Delete OAuth tokens from database
 */
export async function deleteTokens(
  userId: number,
  provider: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  await db.delete(oauthTokens)
    .where(and(
      eq(oauthTokens.userId, userId),
      eq(oauthTokens.provider, provider)
    ));
  
  console.log(`[Token Persistence] Deleted tokens for user ${userId}, provider ${provider}`);
}

/**
 * Get all users with stored tokens for a provider
 * Used for server startup token restoration
 */
export async function getUsersWithTokens(provider: string): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  const result = await db.select({ userId: oauthTokens.userId })
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, provider));
  
  return result.map(r => r.userId);
}
