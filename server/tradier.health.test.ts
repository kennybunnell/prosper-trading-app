import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTradierAPI } from './tradier';
import { getDb, upsertApiCredentials, getApiCredentials } from './db';
import { users } from '../drizzle/schema';

describe('Tradier Account Health Monitoring', () => {
  let testUserId: number;
  const testApiKey = process.env.TRADIER_API_KEY || 'test-key';
  const testAccountId = process.env.TRADIER_ACCOUNT_ID || 'test-account';

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Create test user
    const { eq } = await import('drizzle-orm');
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'tradier-health-test@test.com'))
      .limit(1);

    if (existingUser.length > 0) {
      testUserId = existingUser[0].id;
    } else {
      const result = await db.insert(users).values({
        openId: 'tradier-health-test-openid',
        name: 'Tradier Health Test User',
        email: 'tradier-health-test@test.com',
      });
      testUserId = Number(result[0].insertId);
    }
  });

  afterAll(async () => {
    // Cleanup: Delete test user
    const db = await getDb();
    if (!db) return;
    const { eq } = await import('drizzle-orm');
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('should store Tradier account health data in database', async () => {
    // Store health data
    await upsertApiCredentials(testUserId, {
      tradierApiKey: testApiKey,
      tradierAccountId: testAccountId,
      tradierAccountBalance: '325.50',
      tradierAccountStatus: 'active',
      tradierBuyingPower: '325.50',
      tradierLastHealthCheck: new Date(),
    });

    // Retrieve and verify
    const credentials = await getApiCredentials(testUserId);
    expect(credentials).toBeDefined();
    expect(credentials?.tradierAccountBalance).toBe('325.50');
    expect(credentials?.tradierAccountStatus).toBe('active');
    expect(credentials?.tradierBuyingPower).toBe('325.50');
    expect(credentials?.tradierLastHealthCheck).toBeInstanceOf(Date);
  });

  it('should detect low balance warning (<$100)', async () => {
    await upsertApiCredentials(testUserId, {
      tradierAccountBalance: '75.00',
    });

    const credentials = await getApiCredentials(testUserId);
    const balance = parseFloat(credentials?.tradierAccountBalance || '0');
    const warning = balance < 100;

    expect(warning).toBe(true);
  });

  it('should not warn for balance >=$100', async () => {
    await upsertApiCredentials(testUserId, {
      tradierAccountBalance: '150.00',
    });

    const credentials = await getApiCredentials(testUserId);
    const balance = parseFloat(credentials?.tradierAccountBalance || '0');
    const warning = balance < 100;

    expect(warning).toBe(false);
  });

  it('should detect when 24-hour check is needed', async () => {
    // Use 25 hours ago to ensure it's clearly past the 24-hour threshold
    // (setDate(-1) creates exactly 24h ago which may fail the strictly-greater-than check)
    const twentyFiveHoursAgo = new Date();
    twentyFiveHoursAgo.setTime(twentyFiveHoursAgo.getTime() - 25 * 60 * 60 * 1000);

    await upsertApiCredentials(testUserId, {
      tradierLastHealthCheck: twentyFiveHoursAgo,
    });

    const credentials = await getApiCredentials(testUserId);
    const lastChecked = credentials?.tradierLastHealthCheck;
    const needsCheck = !lastChecked || (new Date().getTime() - lastChecked.getTime()) > 24 * 60 * 60 * 1000;

    expect(needsCheck).toBe(true);
  });

  it('should not need check if checked within 24 hours', async () => {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    await upsertApiCredentials(testUserId, {
      tradierLastHealthCheck: oneHourAgo,
    });

    const credentials = await getApiCredentials(testUserId);
    const lastChecked = credentials?.tradierLastHealthCheck;
    const needsCheck = !lastChecked || (new Date().getTime() - lastChecked.getTime()) > 24 * 60 * 60 * 1000;

    expect(needsCheck).toBe(false);
  });

  // Only run this test if real API credentials are available
  it.skipIf(!process.env.TRADIER_API_KEY || !process.env.TRADIER_ACCOUNT_ID)(
    'should fetch real account balance from Tradier API',
    async () => {
      const api = createTradierAPI(testApiKey);
      const balanceData = await api.getAccountBalance(testAccountId);

      expect(balanceData).toBeDefined();
      expect(balanceData.totalEquity).toBeTypeOf('number');
      expect(balanceData.optionBuyingPower).toBeTypeOf('number');
      expect(balanceData.totalEquity).toBeGreaterThanOrEqual(0);
    }
  );
});
