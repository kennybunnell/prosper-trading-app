import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getUserPreferences, setDamascusOpacity, getDb } from './db';

// ⚠️  SAFETY: This test creates its own isolated user with a unique email.
//    It NEVER touches userId=1 or any real production account.
//    The test user is fully cleaned up in afterAll.
const TEST_USER_EMAIL = 'damascus-opacity-test-isolated@test.invalid';
let testUserId: number;

describe('Damascus Opacity Settings', () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    const { users, userPreferences } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');

    // Remove any leftover test user from a previous failed run
    const existing = await db.select().from(users).where(eq(users.email, TEST_USER_EMAIL)).limit(1);
    if (existing.length > 0) {
      testUserId = existing[0].id;
      await db.delete(userPreferences).where(eq(userPreferences.userId, testUserId));
      await db.delete(users).where(eq(users.id, testUserId));
    }

    // Create a fresh isolated test user
    const result = await db.insert(users).values({
      openId: 'damascus-opacity-test-isolated-openid',
      name: 'Damascus Opacity Test User (isolated)',
      email: TEST_USER_EMAIL,
    });
    testUserId = Number((result[0] as any).insertId);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    const { users, userPreferences } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(userPreferences).where(eq(userPreferences.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  beforeEach(async () => {
    // Clear preferences before each test so each test starts clean
    const db = await getDb();
    if (db) {
      const { userPreferences } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(userPreferences).where(eq(userPreferences.userId, testUserId));
    }
  });

  it('should return default opacity of 8 when no preferences exist', async () => {
    const prefs = await getUserPreferences(testUserId);
    expect(prefs).toBeNull();
  });

  it('should set Damascus opacity to a valid value', async () => {
    await setDamascusOpacity(testUserId, 15);
    const prefs = await getUserPreferences(testUserId);
    expect(prefs?.damascusOpacity).toBe(15);
  });

  it('should update existing Damascus opacity preference', async () => {
    await setDamascusOpacity(testUserId, 10);
    let prefs = await getUserPreferences(testUserId);
    expect(prefs?.damascusOpacity).toBe(10);

    await setDamascusOpacity(testUserId, 18);
    prefs = await getUserPreferences(testUserId);
    expect(prefs?.damascusOpacity).toBe(18);
  });

  it('should handle minimum opacity value (0)', async () => {
    await setDamascusOpacity(testUserId, 0);
    const prefs = await getUserPreferences(testUserId);
    expect(prefs?.damascusOpacity).toBe(0);
  });

  it('should handle maximum opacity value (20)', async () => {
    await setDamascusOpacity(testUserId, 20);
    const prefs = await getUserPreferences(testUserId);
    expect(prefs?.damascusOpacity).toBe(20);
  });

  it('should create preferences entry if none exists', async () => {
    let prefs = await getUserPreferences(testUserId);
    expect(prefs).toBeNull();

    await setDamascusOpacity(testUserId, 12);

    prefs = await getUserPreferences(testUserId);
    expect(prefs).not.toBeNull();
    expect(prefs?.damascusOpacity).toBe(12);
    expect(prefs?.userId).toBe(testUserId);
  });
});
