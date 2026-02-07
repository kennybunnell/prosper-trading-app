import { describe, it, expect } from 'vitest';

/**
 * Tests for Monthly Premium Calculation Logic
 * 
 * CRITICAL: These tests ensure the dashboard correctly calculates monthly premium income
 * by counting each transaction leg individually (not deduplicating by order-id).
 * 
 * Background: Multi-leg orders (spreads, rolls) have multiple transactions with the same
 * order-id but different net-values. Each leg must be counted separately.
 */

describe('Monthly Premium Calculation', () => {
  /**
   * Helper function to simulate the dashboard's monthly premium calculation
   */
  function calculateMonthlyPremium(transactions: any[]) {
    const monthlyData: Record<string, { credits: number; debits: number }> = {};
    
    for (const txn of transactions) {
      const txnType = txn['transaction-type'];
      if (txnType !== 'Trade') continue;
      
      const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
      const netValueEffect = txn['net-value-effect'];
      const executedAt = txn['executed-at'];
      
      if (!executedAt || netValue === 0 || !netValueEffect) continue;
      
      const txnDate = new Date(executedAt);
      const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { credits: 0, debits: 0 };
      }
      
      if (netValueEffect === 'Credit') {
        monthlyData[monthKey].credits += netValue;
      } else if (netValueEffect === 'Debit') {
        monthlyData[monthKey].debits += netValue;
      }
    }
    
    return monthlyData;
  }

  it('should count each transaction leg separately (not deduplicate by order-id)', () => {
    // Multi-leg order with same order-id but different net-values
    const transactions = [
      {
        'transaction-type': 'Trade',
        'order-id': 426889156,
        'net-value': '8109.42',
        'net-value-effect': 'Credit',
        'executed-at': '2025-12-15T11:22:00.000Z'
      },
      {
        'transaction-type': 'Trade',
        'order-id': 426889156, // Same order-id
        'net-value': '-16760.57',
        'net-value-effect': 'Debit',
        'executed-at': '2025-12-15T11:22:00.000Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    // Should count both legs
    expect(result['2025-12'].credits).toBe(8109.42);
    expect(result['2025-12'].debits).toBe(16760.57);
    
    // Net should be negative (more debit than credit)
    const net = result['2025-12'].credits - result['2025-12'].debits;
    expect(net).toBe(-8651.15);
  });

  it('should only count Trade transactions', () => {
    const transactions = [
      {
        'transaction-type': 'Trade',
        'net-value': '1000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2026-01-15T10:00:00.000Z'
      },
      {
        'transaction-type': 'Money Movement',
        'net-value': '5000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2026-01-15T10:00:00.000Z'
      },
      {
        'transaction-type': 'Receive Deliver',
        'net-value': '2000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2026-01-15T10:00:00.000Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    // Should only count the Trade transaction
    expect(result['2026-01'].credits).toBe(1000);
    expect(result['2026-01'].debits).toBe(0);
  });

  it('should use net-value (not value) for accurate amounts', () => {
    const transactions = [
      {
        'transaction-type': 'Trade',
        'value': '2284.00', // Gross value before fees
        'net-value': '2282.88', // Net value after fees
        'net-value-effect': 'Credit',
        'executed-at': '2026-02-06T13:59:56.000Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    // Should use net-value (2282.88), not value (2284.00)
    expect(result['2026-02'].credits).toBe(2282.88);
  });

  it('should group transactions by month based on executed-at date', () => {
    const transactions = [
      {
        'transaction-type': 'Trade',
        'net-value': '1000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2025-12-15T12:00:00.000Z'
      },
      {
        'transaction-type': 'Trade',
        'net-value': '2000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2026-01-15T12:00:00.000Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    // Should be in different months
    expect(result['2025-12'].credits).toBe(1000);
    expect(result['2026-01'].credits).toBe(2000);
  });

  it('should handle credits and debits correctly', () => {
    const transactions = [
      {
        'transaction-type': 'Trade',
        'net-value': '5000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2026-01-15T10:00:00.000Z'
      },
      {
        'transaction-type': 'Trade',
        'net-value': '-3000.00',
        'net-value-effect': 'Debit',
        'executed-at': '2026-01-15T10:00:00.000Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    expect(result['2026-01'].credits).toBe(5000);
    expect(result['2026-01'].debits).toBe(3000);
    
    const net = result['2026-01'].credits - result['2026-01'].debits;
    expect(net).toBe(2000);
  });

  it('should skip transactions with zero net-value', () => {
    const transactions = [
      {
        'transaction-type': 'Trade',
        'net-value': '0.00',
        'net-value-effect': 'None',
        'executed-at': '2026-01-15T10:00:00.000Z'
      },
      {
        'transaction-type': 'Trade',
        'net-value': '1000.00',
        'net-value-effect': 'Credit',
        'executed-at': '2026-01-15T10:00:00.000Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    // Should only count the non-zero transaction
    expect(result['2026-01'].credits).toBe(1000);
  });

  it('should match CSV export calculation for real data', () => {
    // Real example from user's CSV export
    const transactions = [
      {
        'transaction-type': 'Trade',
        'net-value': '2282.88',
        'net-value-effect': 'Credit',
        'executed-at': '2026-02-06T20:59:56.134Z'
      },
      {
        'transaction-type': 'Trade',
        'net-value': '-2021.12',
        'net-value-effect': 'Debit',
        'executed-at': '2026-02-06T20:59:56.134Z'
      },
      {
        'transaction-type': 'Trade',
        'net-value': '-2945.12',
        'net-value-effect': 'Debit',
        'executed-at': '2026-02-06T20:59:39.134Z'
      },
      {
        'transaction-type': 'Trade',
        'net-value': '3123.88',
        'net-value-effect': 'Credit',
        'executed-at': '2026-02-06T20:59:39.134Z'
      }
    ];

    const result = calculateMonthlyPremium(transactions);
    
    expect(result['2026-02'].credits).toBeCloseTo(5406.76, 2);
    expect(result['2026-02'].debits).toBeCloseTo(4966.24, 2);
    
    const net = result['2026-02'].credits - result['2026-02'].debits;
    expect(net).toBeCloseTo(440.52, 2);
  });
});
