import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedCspFilterPresets, getCspFilterPresets, updateCspFilterPreset, getDb } from './db';

// ⚠️  SAFETY: This test creates its own isolated user with a unique email.
//    It NEVER touches userId=1 or any real production account.
//    The test user is fully cleaned up in afterAll.
const TEST_USER_EMAIL = 'cspfilters-test-isolated@test.invalid';
let testUserId: number;

describe('CSP Filter Presets', () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    const { users, filterPresets } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');

    // Remove any leftover test user from a previous failed run
    const existing = await db.select().from(users).where(eq(users.email, TEST_USER_EMAIL)).limit(1);
    if (existing.length > 0) {
      testUserId = existing[0].id;
      await db.delete(filterPresets).where(eq(filterPresets.userId, testUserId));
      await db.delete(users).where(eq(users.id, testUserId));
    }

    // Create a fresh isolated test user
    const result = await db.insert(users).values({
      openId: 'cspfilters-test-isolated-openid',
      name: 'CSP Filters Test User (isolated)',
      email: TEST_USER_EMAIL,
    });
    testUserId = Number((result[0] as any).insertId);

    // Seed presets for the isolated test user
    await seedCspFilterPresets(testUserId);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    const { users, filterPresets } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(filterPresets).where(eq(filterPresets.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('should seed default presets for a user', async () => {
    const presets = await getCspFilterPresets(testUserId);
    
    expect(presets).toHaveLength(3);
    expect(presets.map(p => p.presetName).sort()).toEqual(['aggressive', 'conservative', 'medium']);
  });

  it('should have correct conservative preset defaults', async () => {
    const presets = await getCspFilterPresets(testUserId);
    const conservative = presets.find(p => p.presetName === 'conservative');
    
    expect(conservative).toBeDefined();
    expect(conservative?.minDte).toBe(14);
    expect(conservative?.maxDte).toBe(45);
    expect(conservative?.minDelta).toBe('0.10');
    expect(conservative?.maxDelta).toBe('0.25');
    expect(conservative?.minOpenInterest).toBe(50);
    expect(conservative?.minScore).toBe(50);
    expect(conservative?.maxStrikePercent).toBe(100);
  });

  it('should have correct medium preset defaults', async () => {
    const presets = await getCspFilterPresets(testUserId);
    const medium = presets.find(p => p.presetName === 'medium');
    
    expect(medium).toBeDefined();
    expect(medium?.minDte).toBe(7);
    expect(medium?.maxDte).toBe(45);
    expect(medium?.minDelta).toBe('0.15');
    expect(medium?.maxDelta).toBe('0.35');
    expect(medium?.minScore).toBe(40);
    expect(medium?.maxStrikePercent).toBe(105);
  });

  it('should have correct aggressive preset defaults', async () => {
    const presets = await getCspFilterPresets(testUserId);
    const aggressive = presets.find(p => p.presetName === 'aggressive');
    
    expect(aggressive).toBeDefined();
    expect(aggressive?.minDte).toBe(7);
    expect(aggressive?.maxDte).toBe(30);
    expect(aggressive?.minDelta).toBe('0.20');
    expect(aggressive?.maxDelta).toBe('0.45');
    expect(aggressive?.minOpenInterest).toBe(30);
    expect(aggressive?.minScore).toBe(30);
    expect(aggressive?.maxStrikePercent).toBe(110);
  });

  it('should update a preset successfully', async () => {
    await updateCspFilterPreset(testUserId, 'conservative', {
      minScore: 60,
      maxDte: 45,
    });

    const presets = await getCspFilterPresets(testUserId);
    const conservative = presets.find(p => p.presetName === 'conservative');
    
    expect(conservative?.minScore).toBe(60);
    expect(conservative?.maxDte).toBe(45);
    expect(conservative?.minDelta).toBe('0.10');
  });

  it('should not create duplicate presets on multiple seed calls', async () => {
    await seedCspFilterPresets(testUserId);
    
    const presets = await getCspFilterPresets(testUserId);
    expect(presets).toHaveLength(3);
  });
});
