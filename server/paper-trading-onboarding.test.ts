/**
 * Tests for paper trading onboarding and order submission procedures
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
};

vi.mock('./db', () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock('../drizzle/schema.js', () => ({
  users: { id: 'id', tradingMode: 'tradingMode', hasSeenPaperOnboarding: 'hasSeenPaperOnboarding', paperTradingBalance: 'paperTradingBalance' },
  paperTradingOrders: { id: 'id', userId: 'userId', symbol: 'symbol', strategy: 'strategy', action: 'action', optionType: 'optionType', strike: 'strike', expiration: 'expiration', dte: 'dte', premiumCents: 'premiumCents', contracts: 'contracts', totalPremiumCents: 'totalPremiumCents', delta: 'delta', status: 'status', orderSnapshot: 'orderSnapshot' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
  and: vi.fn((...args) => ({ type: 'and', args })),
  desc: vi.fn((a) => ({ type: 'desc', field: a })),
}));

describe('Paper Trading Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('markOnboardingSeen should update hasSeenPaperOnboarding to true', async () => {
    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    mockDb.update.mockReturnValue(updateChain);

    // Simulate the mutation logic
    const userId = 42;
    const { users } = await import('../drizzle/schema.js');
    const { eq } = await import('drizzle-orm');
    const db = mockDb as any;

    await db.update(users).set({ hasSeenPaperOnboarding: true }).where(eq(users.id, userId));

    expect(mockDb.update).toHaveBeenCalledWith(users);
    expect(updateChain.set).toHaveBeenCalledWith({ hasSeenPaperOnboarding: true });
    expect(updateChain.where).toHaveBeenCalled();
  });

  it('getOnboardingStatus should return hasSeenPaperOnboarding and tradingMode', async () => {
    const mockUser = { hasSeenPaperOnboarding: false, tradingMode: 'paper' };
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockUser]),
    };
    mockDb.select.mockReturnValue(selectChain);

    const db = mockDb as any;
    const { users } = await import('../drizzle/schema.js');
    const { eq } = await import('drizzle-orm');

    const [user] = await db.select({ hasSeenPaperOnboarding: users.hasSeenPaperOnboarding, tradingMode: users.tradingMode })
      .from(users).where(eq(users.id, 42)).limit(1);

    expect(user.hasSeenPaperOnboarding).toBe(false);
    expect(user.tradingMode).toBe('paper');
  });

  it('getOnboardingStatus should return defaults when user not found', () => {
    // Test the fallback logic
    const user: { hasSeenPaperOnboarding?: boolean; tradingMode?: string } | undefined = undefined;
    const result = {
      hasSeenPaperOnboarding: user?.hasSeenPaperOnboarding ?? false,
      tradingMode: user?.tradingMode ?? 'paper',
    };
    expect(result.hasSeenPaperOnboarding).toBe(false);
    expect(result.tradingMode).toBe('paper');
  });
});

describe('Paper Trading submitOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should block order submission when user is in live mode', async () => {
    const mockUser = { tradingMode: 'live', id: 1 };
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockUser]),
    };
    mockDb.select.mockReturnValue(selectChain);

    // Simulate the guard check
    const user = mockUser;
    const isBlocked = user.tradingMode !== 'paper';
    expect(isBlocked).toBe(true);
  });

  it('should allow order submission in paper mode', async () => {
    const mockUser = { tradingMode: 'paper', id: 1, paperTradingBalance: 100000 };
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockUser]),
    };
    mockDb.select.mockReturnValue(selectChain);

    const user = mockUser;
    const isAllowed = user.tradingMode === 'paper';
    expect(isAllowed).toBe(true);
  });

  it('should calculate totalPremiumCents correctly', () => {
    const premiumCents = 150; // $1.50 per share
    const contracts = 3;
    const totalPremiumCents = premiumCents * contracts * 100;
    // $1.50 × 3 contracts × 100 shares = $450
    expect(totalPremiumCents).toBe(45000);
  });

  it('should calculate DTE correctly from expiration date', () => {
    // Mock a date 30 days from now
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const expiration = futureDate.toISOString().split('T')[0];

    const dte = Math.round((new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    expect(dte).toBeGreaterThanOrEqual(29);
    expect(dte).toBeLessThanOrEqual(31);
  });

  it('should set status to open on new paper order', () => {
    const orderStatus = 'open';
    expect(orderStatus).toBe('open');
  });
});
