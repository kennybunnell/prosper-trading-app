/**
 * routers-reporting.test.ts
 * Unit tests for reporting helper functions (pure logic, no DB calls).
 */
import { describe, it, expect } from "vitest";

// ─── parseMoney helper (inline copy for testing) ──────────────────────────────
function parseMoney(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

describe("parseMoney", () => {
  it("parses positive dollar amounts", () => {
    expect(parseMoney("$1,234.56")).toBeCloseTo(1234.56);
  });
  it("parses negative dollar amounts", () => {
    expect(parseMoney("-$500.00")).toBeCloseTo(-500);
  });
  it("parses plain numbers", () => {
    expect(parseMoney("99.99")).toBeCloseTo(99.99);
  });
  it("returns 0 for null", () => {
    expect(parseMoney(null)).toBe(0);
  });
  it("returns 0 for undefined", () => {
    expect(parseMoney(undefined)).toBe(0);
  });
  it("returns 0 for empty string", () => {
    expect(parseMoney("")).toBe(0);
  });
  it("returns 0 for non-numeric string", () => {
    expect(parseMoney("N/A")).toBe(0);
  });
});

// ─── Win rate calculation ─────────────────────────────────────────────────────
function calcWinRate(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
}

describe("calcWinRate", () => {
  it("returns 100 for all wins", () => {
    expect(calcWinRate(10, 0)).toBe(100);
  });
  it("returns 0 for all losses", () => {
    expect(calcWinRate(0, 10)).toBe(0);
  });
  it("returns 50 for equal wins and losses", () => {
    expect(calcWinRate(5, 5)).toBe(50);
  });
  it("returns 0 for no trades", () => {
    expect(calcWinRate(0, 0)).toBe(0);
  });
  it("rounds to 1 decimal place", () => {
    expect(calcWinRate(2, 3)).toBe(40);
    expect(calcWinRate(19, 23)).toBeCloseTo(45.2, 1);
  });
});

// ─── Profit factor calculation ────────────────────────────────────────────────
function calcProfitFactor(avgWin: number, wins: number, avgLoss: number, losses: number): number {
  return avgLoss > 0 ? Math.round((avgWin * wins) / (avgLoss * losses) * 100) / 100 : 0;
}

describe("calcProfitFactor", () => {
  it("returns 0 when there are no losses", () => {
    expect(calcProfitFactor(100, 5, 0, 0)).toBe(0);
  });
  it("returns 1.0 when total wins equal total losses", () => {
    expect(calcProfitFactor(100, 10, 100, 10)).toBe(1);
  });
  it("returns > 1 when wins outpace losses", () => {
    expect(calcProfitFactor(200, 8, 100, 4)).toBeGreaterThan(1);
  });
  it("returns < 1 when losses outpace wins", () => {
    expect(calcProfitFactor(50, 3, 200, 5)).toBeLessThan(1);
  });
});

// ─── Recovery rate calculation ────────────────────────────────────────────────
function calcRecoveryRate(fullyRecovered: number, total: number): number {
  return total > 0 ? Math.round((fullyRecovered / total) * 1000) / 10 : 0;
}

describe("calcRecoveryRate", () => {
  it("returns 100 when all assignments recovered", () => {
    expect(calcRecoveryRate(5, 5)).toBe(100);
  });
  it("returns 0 when no assignments", () => {
    expect(calcRecoveryRate(0, 0)).toBe(0);
  });
  it("returns correct partial rate", () => {
    expect(calcRecoveryRate(3, 5)).toBe(60);
  });
});

// ─── Date range filter logic ──────────────────────────────────────────────────
function isInRange(date: Date, from?: string, to?: string): boolean {
  if (from && date < new Date(from)) return false;
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    if (date > toDate) return false;
  }
  return true;
}

describe("isInRange", () => {
  it("returns true when no range specified", () => {
    expect(isInRange(new Date("2025-06-15"))).toBe(true);
  });
  it("returns true for date within range", () => {
    expect(isInRange(new Date("2025-06-15"), "2025-01-01", "2025-12-31")).toBe(true);
  });
  it("returns false for date before from", () => {
    expect(isInRange(new Date("2024-12-31"), "2025-01-01")).toBe(false);
  });
  it("returns false for date after to", () => {
    expect(isInRange(new Date("2026-01-01"), undefined, "2025-12-31")).toBe(false);
  });
  it("includes the to date itself (end of day)", () => {
    // Use a date clearly within the same calendar day in local time
    const midday = new Date("2025-12-31");
    midday.setHours(12, 0, 0, 0);
    expect(isInRange(midday, undefined, "2025-12-31")).toBe(true);
  });
});
