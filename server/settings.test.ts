import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { upsertApiCredentials, getApiCredentials, getDb } from './db';

// ⚠️  SAFETY: This test creates its own isolated user with a unique email.
//    It NEVER touches userId=1 or any real production account.
//    The test user is fully cleaned up in afterAll.
const TEST_USER_EMAIL = 'settings-test-isolated@test.invalid';
let testUserId: number;

describe('Settings - API Credentials', () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    const { users, apiCredentials } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');

    // Remove any leftover test user from a previous failed run
    const existing = await db.select().from(users).where(eq(users.email, TEST_USER_EMAIL)).limit(1);
    if (existing.length > 0) {
      testUserId = existing[0].id;
      await db.delete(apiCredentials).where(eq(apiCredentials.userId, testUserId));
      await db.delete(users).where(eq(users.id, testUserId));
    }

    // Create a fresh isolated test user
    const result = await db.insert(users).values({
      openId: 'settings-test-isolated-openid',
      name: 'Settings Test User (isolated)',
      email: TEST_USER_EMAIL,
    });
    testUserId = Number((result[0] as any).insertId);
  });

  afterAll(async () => {
    // Full cleanup: remove credentials then the test user
    const db = await getDb();
    if (!db) return;
    const { users, apiCredentials } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(apiCredentials).where(eq(apiCredentials.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  beforeEach(async () => {
    // Clear credentials before each test so each test starts clean
    const db = await getDb();
    if (db) {
      const { apiCredentials } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(apiCredentials).where(eq(apiCredentials.userId, testUserId));
    }
  });

  it('should handle empty credentials without throwing "No values to set" error', async () => {
    await expect(
      upsertApiCredentials(testUserId, {})
    ).resolves.not.toThrow();

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should handle all undefined credentials without throwing error', async () => {
    await expect(
      upsertApiCredentials(testUserId, {
        tastytradeUsername: undefined,
        tastytradePassword: undefined,
        tradierApiKey: undefined,
        tradierAccountId: undefined,
        defaultTastytradeAccountId: undefined,
      })
    ).resolves.not.toThrow();

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should handle empty string credentials without throwing error', async () => {
    await expect(
      upsertApiCredentials(testUserId, {
        tastytradeUsername: '',
        tastytradePassword: '',
        tradierApiKey: '',
        tradierAccountId: '',
        defaultTastytradeAccountId: '',
      })
    ).resolves.not.toThrow();

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should handle mixed empty strings and undefined without throwing error', async () => {
    await expect(
      upsertApiCredentials(testUserId, {
        tastytradeUsername: '',
        tastytradePassword: undefined,
        tradierApiKey: '',
      })
    ).resolves.not.toThrow();

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should save credentials when at least one field is provided', async () => {
    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'test_user',
    });

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeTruthy();
    expect(credentials?.tastytradeUsername).toBe('test_user');
  });

  it('should update existing credentials with partial data', async () => {
    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'test_user',
      tastytradePassword: 'test_pass',
    });

    await upsertApiCredentials(testUserId, {
      tradierApiKey: 'test_api_key',
    });

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeTruthy();
    expect(credentials?.tastytradeUsername).toBe('test_user');
    expect(credentials?.tastytradePassword).toBe('test_pass');
    expect(credentials?.tradierApiKey).toBe('test_api_key');
  });

  it('should filter out undefined values and only update provided fields', async () => {
    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'original_user',
      tradierApiKey: 'original_key',
    });

    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'updated_user',
      tastytradePassword: undefined, // Should not affect existing data
      tradierApiKey: undefined,      // Should not affect existing data
    });

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeTruthy();
    expect(credentials?.tastytradeUsername).toBe('updated_user');
    expect(credentials?.tradierApiKey).toBe('original_key'); // Should remain unchanged
  });
});
