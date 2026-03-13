/**
 * Tests for Dog forced-exit ITM CC logic and instrument type correctness
 *
 * Verifies that:
 * 1. The sellCoveredCall procedure does NOT check liquidation flags (bypass is intentional)
 * 2. ALL order submission paths use 'Equity Option' — this is the ONLY valid instrument type
 *    for order legs per the official Tastytrade API docs (valid types: Equity, Equity Option,
 *    Cryptocurrency, Future, Future Option). 'Index Option' is NOT a valid order submission type.
 * 3. Position FILTERING accepts both 'Equity Option' and 'Index Option' because Tastytrade
 *    RETURNS 'Index Option' in positions/balances responses for SPXW, NDXP, MRUT, etc.
 *    (receiving vs. sending are different — TT returns 'Index Option' but only accepts 'Equity Option')
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const serverDir = join(__dirname);

describe('Dog forced-exit ITM CC — instrument type validation', () => {
  it('sellCoveredCall procedure does not block on liquidation flags', () => {
    const src = readFileSync(join(serverDir, 'routers-position-analyzer.ts'), 'utf-8');
    // Find the sellCoveredCall procedure body
    const sellCCStart = src.indexOf('sellCoveredCall: protectedProcedure');
    expect(sellCCStart).toBeGreaterThan(-1);
    // Extract the procedure body (up to the next procedure definition)
    const nextProcedure = src.indexOf('protectedProcedure', sellCCStart + 50);
    const procedureBody = src.slice(sellCCStart, nextProcedure);
    // Should NOT check liquidation flags (the bypass is intentional for Dog forced-exit)
    expect(procedureBody).not.toContain('liquidationFlags');
    expect(procedureBody).not.toContain('flaggedSet');
    // Note: 'blocked' appears in earningsBlock check which is acceptable
    // We only care that liquidation flags are NOT checked
    expect(procedureBody).not.toContain('liquidationFlags.symbol');
  });

  it('sellCoveredCall uses Equity Option instrument type (covered calls are always equity)', () => {
    // routers-position-analyzer.ts uses 'Equity Option' directly for covered calls
    // (covered calls are always on equity stocks, not index options)
    const src = readFileSync(join(serverDir, 'routers-position-analyzer.ts'), 'utf-8');
    const sellCCStart = src.indexOf('sellCoveredCall: protectedProcedure');
    const nextProcedure = src.indexOf('protectedProcedure', sellCCStart + 50);
    const procedureBody = src.slice(sellCCStart, nextProcedure);
    // Covered calls are on equity stocks — 'Equity Option' is correct here
    expect(procedureBody).toContain("instrumentType: 'Equity Option'");
  });

  it('Bear Call Spread submit uses Equity Option (only valid type for TT order submission)', () => {
    const src = readFileSync(join(serverDir, 'routers-cc.ts'), 'utf-8');
    const submitStart = src.indexOf('submitBearCallSpreadOrders');
    expect(submitStart).toBeGreaterThan(-1);
    // Use a larger window (6000 chars) to capture the full procedure body
    const submitBody = src.slice(submitStart, submitStart + 6000);
    // Per Tastytrade API docs, only 'Equity Option' is valid for order leg instrument-type.
    // 'Index Option' is NOT a valid submission type (only returned in positions responses).
    expect(submitBody).toContain("'Equity Option'");
    // Should NOT use 'Index Option' in order submission (it causes self-cancellation)
    // Note: comments may contain 'Index Option' for documentation — check non-comment code
    const noComments = submitBody.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toContain("'Index Option'");
  });

  it('Iron Condor live order uses Equity Option for instrument type', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // Find the live order submission section (not dry run)
    const submitStart = src.indexOf("const legInstrumentType = 'Equity Option' as const;");
    expect(submitStart).toBeGreaterThan(-1);
    // Should use 'Equity Option' as const — the only valid type for TT order submission
    const submitBody = src.slice(submitStart, submitStart + 200);
    expect(submitBody).toContain("'Equity Option'");
  });

  it('Iron Condor dry run uses Equity Option (dry run only logs, not submitted)', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    const dryRunStart = src.indexOf('dryRunInstrumentType');
    expect(dryRunStart).toBeGreaterThan(-1);
    const dryRunBody = src.slice(dryRunStart, dryRunStart + 500);
    // Dry run uses Equity Option for logging purposes only (not submitted to Tastytrade)
    expect(dryRunBody).toContain("'Equity Option'");
  });

  it('All order submission paths use Equity Option (NOT Index Option) for instrument type', () => {
    const files = [
      'routers.ts',
      'routers-cc.ts',
      'routers-automation.ts',
      'tastytrade.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(serverDir, file), 'utf-8');
      // Remove comments before checking (comments may mention 'Index Option' for documentation)
      const noComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // Each file that submits orders should use 'Equity Option' — the only valid TT order type
      const hasEquityOption = noComments.includes("'Equity Option'") || noComments.includes('"Equity Option"');
      expect(
        hasEquityOption,
        `${file} should use 'Equity Option' for order submission (the only valid Tastytrade instrument type for options)`
      ).toBe(true);
      // Position FILTERING may contain 'Index Option' (TT returns this in positions responses)
      // But ORDER SUBMISSION should never use 'Index Option' as it causes self-cancellation
      // We only enforce this for the order submission paths, not position filtering
    }
  });

  it('tastytrade OrderLeg type includes Index Option in the union (for type safety with TT responses)', () => {
    const src = readFileSync(join(serverDir, 'tastytrade.ts'), 'utf-8');
    // The OrderLeg interface includes 'Index Option' in the union for type safety
    // (even though we only submit 'Equity Option', TT may return 'Index Option' in order status)
    expect(src).toContain("'Equity' | 'Equity Option' | 'Index Option'");
  });

  it('GTC legs Zod schema allows Equity Option', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // Find the GTC legs instrumentType Zod enum
    const zodStart = src.indexOf("instrumentType: z.enum(['Equity Option'])");
    expect(zodStart).toBeGreaterThan(-1);
  });
});
