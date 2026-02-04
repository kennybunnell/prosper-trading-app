import { describe, it, expect } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

// Mock context for testing
const mockContext: TrpcContext = {
  user: {
    id: 1,
    openId: 'test-user',
    name: 'Test User',
    email: 'test@example.com',
    role: 'user',
    createdAt: new Date(),
  },
  req: {} as any,
  res: {} as any,
};

describe('Scan Configurations Feature', () => {
  describe('CSP Scan Configurations', () => {
    it('should save, retrieve, and delete a CSP scan configuration', async () => {
      const caller = appRouter.createCaller(mockContext);
      
      // Save
      const saveResult = await caller.csp.saveScanConfig({
        configName: 'Test CSP Config',
        tickers: 'AAPL,MSFT,GOOGL',
        filters: JSON.stringify({
          minScore: 70,
          deltaRange: [0.2, 0.4],
          dteRange: [7, 30],
          scoreRange: [60, 100],
          minDte: 7,
          maxDte: 30,
          portfolioSizeFilter: ['large'],
          presetFilter: 'conservative',
          strategyType: 'csp',
        }),
      });

      expect(saveResult).toBeDefined();
      expect(saveResult.id).toBeGreaterThan(0);
      const savedConfigId = saveResult.id;
      
      // Retrieve
      const configs = await caller.csp.getScanConfigs();
      expect(configs).toBeDefined();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
      
      const savedConfig = configs.find(c => c.id === savedConfigId);
      expect(savedConfig).toBeDefined();
      expect(savedConfig?.configName).toBe('Test CSP Config');
      expect(savedConfig?.tickers).toBe('AAPL,MSFT,GOOGL');
      expect(savedConfig?.strategy).toBe('csp');
      
      // Delete
      const deleteResult = await caller.csp.deleteScanConfig({ configId: savedConfigId });
      expect(deleteResult).toBeDefined();
      expect(deleteResult.success).toBe(true);
      
      // Verify deletion
      const configsAfterDelete = await caller.csp.getScanConfigs();
      const deletedConfig = configsAfterDelete.find(c => c.id === savedConfigId);
      expect(deletedConfig).toBeUndefined();
    });
  });

  describe('BPS Scan Configurations', () => {
    it('should save, retrieve, and delete a BPS scan configuration', async () => {
      const caller = appRouter.createCaller(mockContext);
      
      // Save
      const saveResult = await caller.spread.saveScanConfig({
        configName: 'Test BPS Config',
        tickers: 'SPY,QQQ,IWM',
        filters: JSON.stringify({
          minScore: 75,
          deltaRange: [0.15, 0.35],
          dteRange: [14, 45],
          scoreRange: [70, 100],
          minDte: 14,
          maxDte: 45,
          portfolioSizeFilter: ['medium', 'large'],
          presetFilter: 'aggressive',
          strategyType: 'spread',
          spreadWidth: 5,
        }),
      });

      expect(saveResult).toBeDefined();
      expect(saveResult.id).toBeGreaterThan(0);
      const savedConfigId = saveResult.id;
      
      // Retrieve
      const configs = await caller.spread.getScanConfigs();
      expect(configs).toBeDefined();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
      
      const savedConfig = configs.find(c => c.id === savedConfigId);
      expect(savedConfig).toBeDefined();
      expect(savedConfig?.configName).toBe('Test BPS Config');
      expect(savedConfig?.tickers).toBe('SPY,QQQ,IWM');
      expect(savedConfig?.strategy).toBe('bps');
      
      // Delete
      const deleteResult = await caller.spread.deleteScanConfig({ configId: savedConfigId });
      expect(deleteResult).toBeDefined();
      expect(deleteResult.success).toBe(true);
    });
  });

  describe('CC Scan Configurations', () => {
    it('should save, retrieve, and delete a CC scan configuration', async () => {
      const caller = appRouter.createCaller(mockContext);
      
      // Save
      const saveResult = await (caller as any).cc.saveScanConfig({
        configName: 'Test CC Config',
        tickers: 'TSLA,NVDA,AMD',
        filters: JSON.stringify({
          minScore: 65,
          deltaRange: [0.3, 0.5],
          dteRange: [7, 21],
          scoreRange: [60, 100],
          minDte: 7,
          maxDte: 21,
          portfolioSizeFilter: ['small', 'medium'],
          presetFilter: 'medium',
          strategyType: 'cc',
        }),
      });

      expect(saveResult).toBeDefined();
      expect(saveResult.id).toBeGreaterThan(0);
      const savedConfigId = saveResult.id;
      
      // Retrieve
      const configs = await (caller as any).cc.getScanConfigs();
      expect(configs).toBeDefined();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
      
      const savedConfig = configs.find((c: any) => c.id === savedConfigId);
      expect(savedConfig).toBeDefined();
      expect(savedConfig?.configName).toBe('Test CC Config');
      expect(savedConfig?.tickers).toBe('TSLA,NVDA,AMD');
      expect(savedConfig?.strategy).toBe('cc');
      
      // Delete
      const deleteResult = await (caller as any).cc.deleteScanConfig({ configId: savedConfigId });
      expect(deleteResult).toBeDefined();
      expect(deleteResult.success).toBe(true);
    });
  });

  describe('BCS Scan Configurations', () => {
    it('should save, retrieve, and delete a BCS scan configuration', async () => {
      const caller = appRouter.createCaller(mockContext);
      
      // Save
      const saveResult = await (caller as any).bcs.saveScanConfig({
        configName: 'Test BCS Config',
        tickers: 'SPX,NDX,RUT',
        filters: JSON.stringify({
          minScore: 80,
          deltaRange: [0.2, 0.4],
          dteRange: [21, 60],
          scoreRange: [75, 100],
          minDte: 21,
          maxDte: 60,
          portfolioSizeFilter: ['large'],
          presetFilter: 'aggressive',
          strategyType: 'spread',
          spreadWidth: 10,
        }),
      });

      expect(saveResult).toBeDefined();
      expect(saveResult.id).toBeGreaterThan(0);
      const savedConfigId = saveResult.id;
      
      // Retrieve
      const configs = await (caller as any).bcs.getScanConfigs();
      expect(configs).toBeDefined();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
      
      const savedConfig = configs.find((c: any) => c.id === savedConfigId);
      expect(savedConfig).toBeDefined();
      expect(savedConfig?.configName).toBe('Test BCS Config');
      expect(savedConfig?.tickers).toBe('SPX,NDX,RUT');
      expect(savedConfig?.strategy).toBe('bcs');
      
      // Delete
      const deleteResult = await (caller as any).bcs.deleteScanConfig({ configId: savedConfigId });
      expect(deleteResult).toBeDefined();
      expect(deleteResult.success).toBe(true);
    });
  });

  describe('Filter Persistence', () => {
    it('should correctly persist and retrieve complex filter settings', async () => {
      const caller = appRouter.createCaller(mockContext);
      
      const complexFilters = {
        minScore: 85,
        deltaRange: [0.25, 0.45],
        dteRange: [10, 40],
        scoreRange: [80, 100],
        minDte: 10,
        maxDte: 40,
        portfolioSizeFilter: ['small', 'medium', 'large'],
        presetFilter: 'conservative',
        strategyType: 'csp',
      };
      
      const result = await caller.csp.saveScanConfig({
        configName: 'Complex Filter Test',
        tickers: 'AAPL,MSFT,GOOGL,AMZN,META',
        filters: JSON.stringify(complexFilters),
      });
      
      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
      
      const configs = await caller.csp.getScanConfigs();
      const savedConfig = configs.find(c => c.id === result.id);
      
      expect(savedConfig).toBeDefined();
      const retrievedFilters = JSON.parse(savedConfig!.filters);
      expect(retrievedFilters).toEqual(complexFilters);
      
      // Cleanup
      await caller.csp.deleteScanConfig({ configId: result.id });
    });
  });
});
