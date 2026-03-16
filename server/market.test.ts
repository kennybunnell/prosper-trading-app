import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';

describe('Market Status', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(() => {
    // Create a caller with mock context
    caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });
  });

  it('should fetch market status from Tradier API or use time-based fallback', async () => {
    const status = await caller.market.getMarketStatus();
    
    console.log('[Test] Market status:', status);
    
    // Should return an object with isOpen and description
    expect(status).toHaveProperty('isOpen');
    expect(status).toHaveProperty('description');
    expect(typeof status.isOpen).toBe('boolean');
    expect(typeof status.description).toBe('string');
    
    // Description should not be empty
    expect(status.description.length).toBeGreaterThan(0);
    
    // Description should contain some meaningful content
    if (status.isOpen) {
      expect(status.description.toLowerCase()).toContain('open');
    } else {
      // When closed, description may say "closed", "premarket", "after hours", "postmarket", "weekend", etc.
      const closedKeywords = ['closed', 'premarket', 'pre-market', 'after hours', 'postmarket', 'post-market', 'weekend', 'holiday'];
      const hasClosedKeyword = closedKeywords.some(kw =>
        status.description.toLowerCase().includes(kw)
      );
      expect(hasClosedKeyword).toBe(true);
    }
  });

  it('should provide detailed market status description', async () => {
    const status = await caller.market.getMarketStatus();
    
    console.log('[Test] Detailed market status:', status);
    
    // Description should be a non-empty string with meaningful content
    expect(status.description).toBeTruthy();
    expect(status.description.length).toBeGreaterThan(5);
    
    // Should not be the old hardcoded fallback
    expect(status.description).not.toBe('Market hours: Monday-Friday, 9:30 AM - 4:00 PM ET');
    
    // Description should contain at least one of these market-related keywords
    const marketKeywords = [
      'open', 'closed', 'premarket', 'pre-market', 'after hours',
      'weekend', 'holiday', 'market', 'hours', 'session'
    ];
    const hasMarketKeyword = marketKeywords.some(kw =>
      status.description.toLowerCase().includes(kw)
    );
    expect(hasMarketKeyword).toBe(true);
  });
});
