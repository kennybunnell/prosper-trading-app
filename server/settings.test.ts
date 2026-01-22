import { describe, it, expect, beforeEach } from 'vitest';
import { upsertApiCredentials, getApiCredentials } from './db';

describe('Settings - API Credentials', () => {
  // Use user ID 1 which exists in the database (Kenny Bunnell)
  const testUserId = 1;

  beforeEach(async () => {
    // Clean up test data before each test
    const db = await import('./db').then(m => m.getDb());
    if (db) {
      const { apiCredentials } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(apiCredentials).where(eq(apiCredentials.userId, testUserId));
    }
  });

  it('should handle empty credentials without throwing "No values to set" error', async () => {
    // This should not throw an error - it should just return early
    await expect(
      upsertApiCredentials(testUserId, {})
    ).resolves.not.toThrow();
    
    // Verify no credentials were created
    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should handle all undefined credentials without throwing error', async () => {
    // This should not throw an error - it should just return early
    await expect(
      upsertApiCredentials(testUserId, {
        tastytradeUsername: undefined,
        tastytradePassword: undefined,
        tradierApiKey: undefined,
        tradierAccountId: undefined,
        defaultTastytradeAccountId: undefined,
      })
    ).resolves.not.toThrow();
    
    // Verify no credentials were created
    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should handle empty string credentials without throwing error', async () => {
    // This should not throw an error - it should just return early
    await expect(
      upsertApiCredentials(testUserId, {
        tastytradeUsername: "",
        tastytradePassword: "",
        tradierApiKey: "",
        tradierAccountId: "",
        defaultTastytradeAccountId: "",
      })
    ).resolves.not.toThrow();
    
    // Verify no credentials were created
    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeNull();
  });

  it('should handle mixed empty strings and undefined without throwing error', async () => {
    // This should not throw an error - it should just return early
    await expect(
      upsertApiCredentials(testUserId, {
        tastytradeUsername: "",
        tastytradePassword: undefined,
        tradierApiKey: "",
      })
    ).resolves.not.toThrow();
    
    // Verify no credentials were created
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
    // First insert
    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'test_user',
      tastytradePassword: 'test_pass',
    });

    // Update with partial data
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
    // First insert
    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'original_user',
      tradierApiKey: 'original_key',
    });

    // Update with some undefined values
    await upsertApiCredentials(testUserId, {
      tastytradeUsername: 'updated_user',
      tastytradePassword: undefined, // Should not affect existing data
      tradierApiKey: undefined, // Should not affect existing data
    });

    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeTruthy();
    expect(credentials?.tastytradeUsername).toBe('updated_user');
    expect(credentials?.tradierApiKey).toBe('original_key'); // Should remain unchanged
  });
});
