/**
 * Unit tests for the snooze violation feature
 *
 * Tests the snooze filtering logic that hides ITM_ASSIGNMENT_RISK violations
 * for 24 hours when a user explicitly snoozes them.
 */
import { describe, it, expect } from 'vitest';

// ── Replicate the snooze filtering logic from routers-ira-safety.ts ──

type ViolationType = 'SHORT_STOCK' | 'NAKED_SHORT_CALL' | 'ORPHANED_SHORT_LEG' | 'ITM_ASSIGNMENT_RISK';

interface Violation {
  violationType: ViolationType;
  severity: 'critical' | 'warning';
  symbol: string;
  accountNumber: string;
}

interface Snooze {
  symbol: string;
  accountNumber: string;
  violationType: string;
  snoozedUntil: number;
}

function filterSnoozedViolations(violations: Violation[], snoozes: Snooze[], now: number): { filtered: Violation[]; snoozedCount: number } {
  const validSnoozes = snoozes.filter(s => s.snoozedUntil > now);
  if (validSnoozes.length === 0) return { filtered: violations, snoozedCount: 0 };

  const snoozeSet = new Set(
    validSnoozes.map(s => `${s.symbol}|${s.accountNumber}|${s.violationType}`)
  );

  const before = violations.length;
  const filtered = violations.filter(v => {
    if (v.violationType !== 'ITM_ASSIGNMENT_RISK') return true; // never filter critical
    return !snoozeSet.has(`${v.symbol}|${v.accountNumber}|${v.violationType}`);
  });

  return { filtered, snoozedCount: before - filtered.length };
}

const NOW = Date.now();
const FUTURE = NOW + 24 * 60 * 60 * 1000; // 24h from now
const PAST = NOW - 1000; // 1 second ago (expired)

describe('Snooze violation filtering', () => {
  const sampleViolations: Violation[] = [
    { violationType: 'ITM_ASSIGNMENT_RISK', severity: 'warning', symbol: 'AAPL', accountNumber: 'ACCT001' },
    { violationType: 'ITM_ASSIGNMENT_RISK', severity: 'warning', symbol: 'TSLA', accountNumber: 'ACCT001' },
    { violationType: 'NAKED_SHORT_CALL', severity: 'critical', symbol: 'ADBE', accountNumber: 'ACCT001' },
    { violationType: 'SHORT_STOCK', severity: 'critical', symbol: 'NVDA', accountNumber: 'ACCT002' },
  ];

  it('returns all violations when no snoozes exist', () => {
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, [], NOW);
    expect(filtered).toHaveLength(4);
    expect(snoozedCount).toBe(0);
  });

  it('filters out a snoozed ITM_ASSIGNMENT_RISK violation', () => {
    const snoozes: Snooze[] = [
      { symbol: 'AAPL', accountNumber: 'ACCT001', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: FUTURE },
    ];
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    expect(filtered).toHaveLength(3);
    expect(snoozedCount).toBe(1);
    expect(filtered.find(v => v.symbol === 'AAPL')).toBeUndefined();
  });

  it('does NOT filter critical violations (NAKED_SHORT_CALL) even if snoozed', () => {
    const snoozes: Snooze[] = [
      { symbol: 'ADBE', accountNumber: 'ACCT001', violationType: 'NAKED_SHORT_CALL', snoozedUntil: FUTURE },
    ];
    // The filter only removes ITM_ASSIGNMENT_RISK — critical violations are never filtered
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    // ADBE NAKED_SHORT_CALL should still be present because we only filter ITM_ASSIGNMENT_RISK
    expect(filtered.find(v => v.symbol === 'ADBE' && v.violationType === 'NAKED_SHORT_CALL')).toBeDefined();
    expect(snoozedCount).toBe(0);
  });

  it('does NOT filter SHORT_STOCK violations even if snoozed', () => {
    const snoozes: Snooze[] = [
      { symbol: 'NVDA', accountNumber: 'ACCT002', violationType: 'SHORT_STOCK', snoozedUntil: FUTURE },
    ];
    const { filtered } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    expect(filtered.find(v => v.symbol === 'NVDA' && v.violationType === 'SHORT_STOCK')).toBeDefined();
  });

  it('ignores expired snoozes', () => {
    const snoozes: Snooze[] = [
      { symbol: 'AAPL', accountNumber: 'ACCT001', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: PAST },
    ];
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    expect(filtered).toHaveLength(4); // AAPL should still be visible
    expect(snoozedCount).toBe(0);
  });

  it('filters multiple snoozed violations at once', () => {
    const snoozes: Snooze[] = [
      { symbol: 'AAPL', accountNumber: 'ACCT001', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: FUTURE },
      { symbol: 'TSLA', accountNumber: 'ACCT001', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: FUTURE },
    ];
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    expect(filtered).toHaveLength(2); // only NAKED_SHORT_CALL and SHORT_STOCK remain
    expect(snoozedCount).toBe(2);
    expect(filtered.every(v => v.violationType !== 'ITM_ASSIGNMENT_RISK')).toBe(true);
  });

  it('only filters the specific account+symbol combo that was snoozed', () => {
    const snoozes: Snooze[] = [
      { symbol: 'AAPL', accountNumber: 'ACCT002', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: FUTURE }, // different account
    ];
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    // AAPL in ACCT001 should still be visible (snooze was for ACCT002)
    expect(filtered.find(v => v.symbol === 'AAPL' && v.accountNumber === 'ACCT001')).toBeDefined();
    expect(snoozedCount).toBe(0);
  });

  it('handles mix of expired and active snoozes correctly', () => {
    const snoozes: Snooze[] = [
      { symbol: 'AAPL', accountNumber: 'ACCT001', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: PAST }, // expired
      { symbol: 'TSLA', accountNumber: 'ACCT001', violationType: 'ITM_ASSIGNMENT_RISK', snoozedUntil: FUTURE }, // active
    ];
    const { filtered, snoozedCount } = filterSnoozedViolations(sampleViolations, snoozes, NOW);
    expect(filtered).toHaveLength(3); // AAPL still visible (expired), TSLA hidden
    expect(snoozedCount).toBe(1);
    expect(filtered.find(v => v.symbol === 'AAPL')).toBeDefined();
    expect(filtered.find(v => v.symbol === 'TSLA')).toBeUndefined();
  });
});

describe('Snooze duration calculation', () => {
  it('snoozedUntil is 24 hours from now', () => {
    const now = Date.now();
    const snoozedUntil = now + 24 * 60 * 60 * 1000;
    const diffHours = (snoozedUntil - now) / (1000 * 60 * 60);
    expect(diffHours).toBe(24);
  });

  it('expired snooze is in the past', () => {
    const now = Date.now();
    const expiredSnooze = now - 1;
    expect(expiredSnooze < now).toBe(true);
  });

  it('active snooze is in the future', () => {
    const now = Date.now();
    const activeSnooze = now + 24 * 60 * 60 * 1000;
    expect(activeSnooze > now).toBe(true);
  });
});
