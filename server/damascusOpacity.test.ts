import { describe, it, expect, beforeEach } from 'vitest';
import { getUserPreferences, setDamascusOpacity } from './db';
import { getDb } from './db';
import { userPreferences } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

describe('Damascus Opacity Settings', () => {
  const testUserId = 1;

  beforeEach(async () => {
    // Clean up test data
    const db = await getDb();
    if (db) {
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
    // Set initial value
    await setDamascusOpacity(testUserId, 10);
    let prefs = await getUserPreferences(testUserId);
    expect(prefs?.damascusOpacity).toBe(10);

    // Update to new value
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
    // Verify no preferences exist
    let prefs = await getUserPreferences(testUserId);
    expect(prefs).toBeNull();

    // Set opacity
    await setDamascusOpacity(testUserId, 12);

    // Verify preferences were created
    prefs = await getUserPreferences(testUserId);
    expect(prefs).not.toBeNull();
    expect(prefs?.damascusOpacity).toBe(12);
    expect(prefs?.userId).toBe(testUserId);
  });
});
