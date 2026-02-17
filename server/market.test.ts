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
    
    // Description should not be the hardcoded fallback
    expect(status.description).not.toBe('Market hours: Monday-Friday, 9:30 AM - 4:00 PM ET');
    
    // Should have a descriptive message
    if (status.isOpen) {
      expect(status.description.toLowerCase()).toContain('open');
    } else {
      expect(status.description.toLowerCase()).toContain('closed');
    }
  });

  it('should provide detailed market status description', async () => {
    const status = await caller.market.getMarketStatus();
    
    console.log('[Test] Detailed market status:', status);
    
    // Description should include context (pre-market, after hours, weekend, etc.)
    const validDescriptions = [
      'market is open',
      'market is closed (pre-market)',
      'market is closed (after hours)',
      'market is closed (weekend)',
      'market is closed',
    ];
    
    const hasValidDescription = validDescriptions.some(desc => 
      status.description.toLowerCase().includes(desc.toLowerCase())
    );
    
    expect(hasValidDescription).toBe(true);
  });
});
