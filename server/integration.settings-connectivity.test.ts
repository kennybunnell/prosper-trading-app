/**
 * PASS 2 — Integration Test Suite 1: Settings & API Connectivity
 *
 * Tests that call the real database and real external APIs.
 * These verify that credentials are stored correctly, connections
 * are live, and the settings round-trip works end-to-end.
 *
 * Prerequisites:
 *   - DATABASE_URL env var set (auto-injected by platform)
 *   - TRADIER_API_KEY env var set (auto-injected by platform)
 *   - Kenny's user (id=1) must have Tastytrade OAuth2 credentials stored
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';
import { getDb, getApiCredentials } from './db';
import { users } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getOwnerUser() {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const { eq } = await import('drizzle-orm');
  const result = await db.select().from(users).where(eq(users.id, 1)).limit(1);
  if (!result[0]) throw new Error('Owner user (id=1) not found in database');
  return result[0];
}

function makeCtx(user: Awaited<ReturnType<typeof getOwnerUser>>): TrpcContext {
  return {
    user: user as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {
      clearCookie: () => {},
      getHeader: () => undefined,
      setHeader: () => {},
    } as unknown as TrpcContext['res'],
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Integration: Settings & API Connectivity', () => {
  let ownerUser: Awaited<ReturnType<typeof getOwnerUser>>;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    ownerUser = await getOwnerUser();
    caller = appRouter.createCaller(makeCtx(ownerUser));
  }, 15000);

  // ── Database Connectivity ──────────────────────────────────────────────────

  describe('Database', () => {
    it('should connect to the database successfully', async () => {
      const db = await getDb();
      expect(db).toBeTruthy();
    });

    it('should find the owner user (id=1) in the database', async () => {
      expect(ownerUser).toBeDefined();
      expect(ownerUser.id).toBe(1);
      expect(ownerUser.email).toBeTruthy();
      expect(ownerUser.role).toBe('admin');
    });

    it('should have API credentials stored for the owner user', async () => {
      const creds = await getApiCredentials(1);
      expect(creds).toBeTruthy();
      expect(creds?.userId).toBe(1);
    });
  });

  // ── settings.getCredentials ────────────────────────────────────────────────

  describe('settings.getCredentials', () => {
    it('should return masked credentials object', async () => {
      const result = await caller.settings.getCredentials();
      expect(result).toBeDefined();
      // Should return an object (not null) since credentials are configured
      expect(typeof result).toBe('object');
      console.log('[Integration] Credentials keys:', Object.keys(result || {}));
    });

    it('should mask sensitive fields (show bullets not raw secrets)', async () => {
      const result = await caller.settings.getCredentials();
      if (!result) return; // skip if no credentials configured
      // Masked fields should show bullet characters, not raw secrets
      if (result.tastytradeClientSecret) {
        expect(result.tastytradeClientSecret).toContain('•');
      }
      if (result.tastytradeRefreshToken) {
        expect(result.tastytradeRefreshToken).toContain('•');
      }
    });

    it('should have Tastytrade credentials configured (masked but present)', async () => {
      const result = await caller.settings.getCredentials();
      expect(result).toBeTruthy();
      // Either clientSecret or refreshToken should be present (masked)
      const hasSecret = !!(result?.tastytradeClientSecret);
      const hasToken = !!(result?.tastytradeRefreshToken);
      console.log('[Integration] Has client secret:', hasSecret, '| Has refresh token:', hasToken);
      expect(hasSecret || hasToken).toBe(true);
    });
  });

  // ── settings.getConnectionStatus ──────────────────────────────────────────

  describe('settings.getConnectionStatus', () => {
    it('should return a connection status object with tastytrade and tradier keys', async () => {
      const result = await caller.settings.getConnectionStatus();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('tastytrade');
      expect(result).toHaveProperty('tradier');
      console.log('[Integration] Connection status:', JSON.stringify(result, null, 2));
    });

    it('should show Tastytrade as configured', async () => {
      const result = await caller.settings.getConnectionStatus();
      expect(result.tastytrade).toHaveProperty('configured');
      expect(result.tastytrade.configured).toBe(true);
    });

    it('should show Tradier as configured', async () => {
      const result = await caller.settings.getConnectionStatus();
      expect(result.tradier).toHaveProperty('configured');
      expect(result.tradier.configured).toBe(true);
    });

    it('should include status string for each service', async () => {
      const result = await caller.settings.getConnectionStatus();
      expect(typeof result.tastytrade.status).toBe('string');
      expect(typeof result.tradier.status).toBe('string');
      console.log('[Integration] Tastytrade status:', result.tastytrade.status, '| Tradier status:', result.tradier.status);
    });
  });

  // ── settings.getTokenStatus ────────────────────────────────────────────────

  describe('settings.getTokenStatus', () => {
    it('should return OAuth2 token status with expiresAt and isValid', async () => {
      const result = await caller.settings.getTokenStatus();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('isValid');
      console.log('[Integration] Token status:', result);
    });

    it('should report token as valid', async () => {
      const result = await caller.settings.getTokenStatus();
      expect(result.isValid).toBe(true);
    });
  });

  // ── Market Status ──────────────────────────────────────────────────────────

  describe('market.getMarketStatus', () => {
    it('should return market status from Tradier', async () => {
      const publicCaller = appRouter.createCaller({
        user: null,
        req: {} as TrpcContext['req'],
        res: {} as TrpcContext['res'],
      });
      const result = await publicCaller.market.getMarketStatus();
      expect(result).toHaveProperty('isOpen');
      expect(result).toHaveProperty('description');
      expect(typeof result.isOpen).toBe('boolean');
      expect(typeof result.description).toBe('string');
      console.log('[Integration] Market status:', result.description, '| isOpen:', result.isOpen);
    }, 15000);
  });

  // ── accounts.list (Tastytrade accounts from DB) ────────────────────────────

  describe('accounts.list', () => {
    it('should return at least one Tastytrade account from the database', async () => {
      const result = await caller.accounts.list();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      console.log(`[Integration] Found ${result.length} Tastytrade account(s):`, result.map((a: any) => a.accountNumber));
    });

    it('each account should have accountId and accountNumber fields', async () => {
      const result = await caller.accounts.list();
      for (const account of result) {
        expect(account).toHaveProperty('accountId');
        expect(account).toHaveProperty('accountNumber');
        expect(typeof account.accountNumber).toBe('string');
      }
    });
  });

  // ── accounts.getBuyingPower ────────────────────────────────────────────────

  describe('accounts.getBuyingPower', () => {
    it('should return buying power data from Tastytrade for a real account', async () => {
      const accounts = await caller.accounts.list();
      expect(accounts.length).toBeGreaterThan(0);
      const accountId = accounts[0].accountNumber;

      const result = await caller.accounts.getBuyingPower({ accountId });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('buyingPower');
      expect(typeof result.buyingPower).toBe('number');
      expect(result.buyingPower).toBeGreaterThanOrEqual(0);
      console.log('[Integration] Buying power for', accountId, ':', result.buyingPower);
    }, 30000);
  });

  // ── auth.me ────────────────────────────────────────────────────────────────

  describe('auth.me', () => {
    it('should return the authenticated user', async () => {
      const result = await caller.auth.me();
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.email).toBeTruthy();
      expect(result?.role).toBe('admin');
    });
  });
});
