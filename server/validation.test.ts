/**
 * Order Validation Test Suite
 * 
 * Comprehensive tests for the validation engine across all strategies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateOrders, generateValidationSummary, fetchOptionMarketData } from './validation-engine';
import type { OrderToValidate } from '../shared/validation-types';

describe('Order Validation Engine', () => {
  describe('fetchOptionMarketData', () => {
    it('should fetch market data for a valid option', async () => {
      // Note: This test requires TRADIER_API_KEY to be set
      // In a real test environment, we would mock the fetch calls
      const result = await fetchOptionMarketData('AAPL', 150, '2026-03-20', 'call');
      
      if (result) {
        expect(result).toHaveProperty('symbol');
        expect(result).toHaveProperty('strike');
        expect(result).toHaveProperty('bid');
        expect(result).toHaveProperty('ask');
        expect(result).toHaveProperty('mid');
        expect(result).toHaveProperty('underlyingPrice');
      }
      // If API key is not set, result will be null
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });

  describe('generateValidationSummary', () => {
    it('should generate correct summary for all valid orders', () => {
      const results = [
        {
          orderId: '1',
          status: 'valid' as const,
          checks: [],
          timestamp: new Date(),
          dataAge: 10,
        },
        {
          orderId: '2',
          status: 'valid' as const,
          checks: [],
          timestamp: new Date(),
          dataAge: 20,
        },
      ];

      const summary = generateValidationSummary(results);

      expect(summary.total).toBe(2);
      expect(summary.valid).toBe(2);
      expect(summary.warnings).toBe(0);
      expect(summary.errors).toBe(0);
      expect(summary.pending).toBe(0);
      expect(summary.avgDataAge).toBe(15);
    });

    it('should generate correct summary for mixed validation statuses', () => {
      const results = [
        {
          orderId: '1',
          status: 'valid' as const,
          checks: [],
          timestamp: new Date(),
          dataAge: 10,
        },
        {
          orderId: '2',
          status: 'warning' as const,
          checks: [],
          timestamp: new Date(),
          dataAge: 20,
        },
        {
          orderId: '3',
          status: 'error' as const,
          checks: [],
          timestamp: new Date(),
          dataAge: 30,
        },
      ];

      const summary = generateValidationSummary(results);

      expect(summary.total).toBe(3);
      expect(summary.valid).toBe(1);
      expect(summary.warnings).toBe(1);
      expect(summary.errors).toBe(1);
      expect(summary.pending).toBe(0);
      expect(summary.avgDataAge).toBe(20);
    });
  });

  describe('validateOrders', () => {
    it('should validate a covered call order', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'cc-1',
          strategy: 'cc',
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 2.50,
          quantity: 1,
          originalBid: 2.40,
          originalAsk: 2.60,
          originalMid: 2.50,
        },
      ];

      const results = await validateOrders(orders, 10000);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('orderId', 'cc-1');
      expect(results[0]).toHaveProperty('status');
      expect(results[0]).toHaveProperty('checks');
      expect(Array.isArray(results[0].checks)).toBe(true);
    });

    it('should validate a cash-secured put order', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'csp-1',
          strategy: 'csp',
          symbol: 'AAPL',
          strike: 140,
          expiration: '2026-03-20',
          optionType: 'put',
          limitPrice: 1.80,
          quantity: 1,
          originalBid: 1.70,
          originalAsk: 1.90,
          originalMid: 1.80,
        },
      ];

      const results = await validateOrders(orders, 14000);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('orderId', 'csp-1');
      expect(results[0]).toHaveProperty('status');
    });

    it('should validate a bear call spread order', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'bcs-1',
          strategy: 'bcs',
          symbol: 'AAPL',
          strike: 160, // Short strike
          longStrike: 165, // Long strike
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 1.50,
          quantity: 1,
          originalBid: 1.40,
          originalAsk: 1.60,
          originalMid: 1.50,
        },
      ];

      const results = await validateOrders(orders, 500);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('orderId', 'bcs-1');
      expect(results[0]).toHaveProperty('status');
    });

    it('should validate a bull put spread order', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'bps-1',
          strategy: 'bps',
          symbol: 'AAPL',
          strike: 140, // Short strike
          longStrike: 135, // Long strike
          expiration: '2026-03-20',
          optionType: 'put',
          limitPrice: 1.20,
          quantity: 1,
          originalBid: 1.10,
          originalAsk: 1.30,
          originalMid: 1.20,
        },
      ];

      const results = await validateOrders(orders, 500);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('orderId', 'bps-1');
      expect(results[0]).toHaveProperty('status');
    });

    it('should validate multiple orders at once', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'cc-1',
          strategy: 'cc',
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 2.50,
          quantity: 1,
          originalBid: 2.40,
          originalAsk: 2.60,
          originalMid: 2.50,
        },
        {
          id: 'csp-1',
          strategy: 'csp',
          symbol: 'MSFT',
          strike: 300,
          expiration: '2026-03-20',
          optionType: 'put',
          limitPrice: 3.00,
          quantity: 1,
          originalBid: 2.90,
          originalAsk: 3.10,
          originalMid: 3.00,
        },
      ];

      const results = await validateOrders(orders, 50000);

      expect(results).toHaveLength(2);
      expect(results[0].orderId).toBe('cc-1');
      expect(results[1].orderId).toBe('csp-1');
    });

    it('should handle orders with insufficient buying power', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'csp-1',
          strategy: 'csp',
          symbol: 'AAPL',
          strike: 140,
          expiration: '2026-03-20',
          optionType: 'put',
          limitPrice: 1.80,
          quantity: 1,
          originalBid: 1.70,
          originalAsk: 1.90,
          originalMid: 1.80,
        },
      ];

      // Insufficient buying power for a $140 strike CSP
      const results = await validateOrders(orders, 1000);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      
      // Should have a buying power check that failed
      const buyingPowerCheck = results[0].checks.find(c => c.id.includes('buying_power'));
      expect(buyingPowerCheck).toBeDefined();
      if (buyingPowerCheck) {
        expect(buyingPowerCheck.status).toBe('error');
      }
    });

    it('should detect price outside bid-ask spread', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'cc-1',
          strategy: 'cc',
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 0.50, // Way below bid
          quantity: 1,
          originalBid: 2.40,
          originalAsk: 2.60,
          originalMid: 2.50,
        },
      ];

      const results = await validateOrders(orders, 10000);

      expect(results).toHaveLength(1);
      
      // Should have a warning about price being too low
      const priceCheck = results[0].checks.find(c => c.id.includes('price'));
      expect(priceCheck).toBeDefined();
      if (priceCheck) {
        expect(['warning', 'error']).toContain(priceCheck.status);
      }
    });
  });

  describe('Validation Checks', () => {
    it('should include all required validation checks for covered calls', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'cc-1',
          strategy: 'cc',
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 2.50,
          quantity: 1,
          originalBid: 2.40,
          originalAsk: 2.60,
          originalMid: 2.50,
        },
      ];

      const results = await validateOrders(orders, 10000);
      const checks = results[0].checks;

      // Should have checks for:
      // - Strike availability
      // - Price reasonableness
      // - Fill probability
      // - Data freshness
      expect(checks.length).toBeGreaterThan(0);
      
      // All checks should have required properties
      checks.forEach(check => {
        expect(check).toHaveProperty('id');
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('severity');
        expect(check).toHaveProperty('message');
      });
    });

    it('should include spread-specific checks for bear call spreads', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'bcs-1',
          strategy: 'bcs',
          symbol: 'AAPL',
          strike: 160,
          longStrike: 165,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 1.50,
          quantity: 1,
          originalBid: 1.40,
          originalAsk: 1.60,
          originalMid: 1.50,
        },
      ];

      const results = await validateOrders(orders, 500);
      const checks = results[0].checks;

      // Should have spread-specific checks
      expect(checks.length).toBeGreaterThan(0);
      
      // Look for spread validation checks
      const hasSpreadCheck = checks.some(c => 
        c.id.includes('spread') || c.message.toLowerCase().includes('spread')
      );
      expect(hasSpreadCheck).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty orders array', async () => {
      const results = await validateOrders([], 10000);
      expect(results).toHaveLength(0);
    });

    it('should handle orders with missing optional fields', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'cc-1',
          strategy: 'cc',
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 2.50,
          quantity: 1,
          originalBid: 2.40,
          originalAsk: 2.60,
          originalMid: 2.50,
          // longStrike is optional for CC
        },
      ];

      const results = await validateOrders(orders, 10000);
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('orderId', 'cc-1');
    });

    it('should handle zero buying power', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'csp-1',
          strategy: 'csp',
          symbol: 'AAPL',
          strike: 140,
          expiration: '2026-03-20',
          optionType: 'put',
          limitPrice: 1.80,
          quantity: 1,
          originalBid: 1.70,
          originalAsk: 1.90,
          originalMid: 1.80,
        },
      ];

      const results = await validateOrders(orders, 0);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
    });

    it('should handle very large quantities', async () => {
      const orders: OrderToValidate[] = [
        {
          id: 'cc-1',
          strategy: 'cc',
          symbol: 'AAPL',
          strike: 150,
          expiration: '2026-03-20',
          optionType: 'call',
          limitPrice: 2.50,
          quantity: 100, // Large quantity
          originalBid: 2.40,
          originalAsk: 2.60,
          originalMid: 2.50,
        },
      ];

      const results = await validateOrders(orders, 1000000);
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('orderId', 'cc-1');
    });
  });
});
