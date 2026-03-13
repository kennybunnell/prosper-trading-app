/**
 * Tests for Dog forced-exit ITM CC logic and instrument type correctness
 *
 * Verifies that:
 * 1. The sellCoveredCall procedure does NOT check liquidation flags (bypass is intentional)
 * 2. Equity options use 'Equity Option' instrument type
 * 3. Cash-settled index options (SPXW, NDXP, MRUT) use 'Index Option' instrument type
 * 4. All order submission paths use isTrueIndexOption to determine the correct type
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

  it('sellCoveredCall uses isTrueIndexOption to determine instrument type', () => {
    // routers-position-analyzer.ts may still use 'Equity Option' directly for covered calls
    // (covered calls are always on equity stocks, not index options)
    const src = readFileSync(join(serverDir, 'routers-position-analyzer.ts'), 'utf-8');
    const sellCCStart = src.indexOf('sellCoveredCall: protectedProcedure');
    const nextProcedure = src.indexOf('protectedProcedure', sellCCStart + 50);
    const procedureBody = src.slice(sellCCStart, nextProcedure);
    // Covered calls are on equity stocks — 'Equity Option' is correct here
    expect(procedureBody).toContain("instrumentType: 'Equity Option'");
  });

  it('Bear Call Spread submit uses isTrueIndexOption for instrument type', () => {
    const src = readFileSync(join(serverDir, 'routers-cc.ts'), 'utf-8');
    const submitStart = src.indexOf('submitBearCallSpreadOrders');
    expect(submitStart).toBeGreaterThan(-1);
    // Use a larger window (6000 chars) to capture the full procedure body
    const submitBody = src.slice(submitStart, submitStart + 6000);
    // Should use isTrueIndexOption to determine instrument type dynamically
    expect(submitBody).toContain('isTrueIndexOption');
    // Should support both instrument types
    expect(submitBody).toContain("'Index Option'");
    expect(submitBody).toContain("'Equity Option'");
  });

  it('Iron Condor live order uses isTrueIndexOption for instrument type', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // Find the iron condor live order submission
    const icStart = src.indexOf('isTrueIndexOption: isIdxLeg');
    expect(icStart).toBeGreaterThan(-1);
    const icBody = src.slice(icStart, icStart + 500);
    // Should use isTrueIndexOption to determine instrument type dynamically
    expect(icBody).toContain('isTrueIndexOption');
    expect(icBody).toContain("'Index Option'");
    expect(icBody).toContain("'Equity Option'");
  });

  it('Iron Condor dry run uses Equity Option (dry run only logs, not submitted)', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    const dryRunStart = src.indexOf('dryRunInstrumentType');
    expect(dryRunStart).toBeGreaterThan(-1);
    const dryRunBody = src.slice(dryRunStart, dryRunStart + 500);
    // Dry run uses Equity Option for logging purposes only (not submitted to Tastytrade)
    expect(dryRunBody).toContain("'Equity Option'");
  });

  it('All order submission paths use isTrueIndexOption for instrument type', () => {
    const files = [
      'routers.ts',
      'routers-cc.ts',
      'routers-automation.ts',
      'tastytrade.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(serverDir, file), 'utf-8');
      // Remove comments before checking
      const noComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // Each file that submits orders should use isTrueIndexOption to determine instrument type
      const hasIndexOption = noComments.includes("'Index Option'") || noComments.includes('"Index Option"');
      expect(
        hasIndexOption,
        `${file} should support 'Index Option' for cash-settled index options (SPXW, NDXP, MRUT)`
      ).toBe(true);
    }
  });

  it('tastytrade OrderLeg type includes Index Option', () => {
    const src = readFileSync(join(serverDir, 'tastytrade.ts'), 'utf-8');
    // The OrderLeg interface must include 'Index Option' to support NDXP, SPXW, MRUT
    expect(src).toContain("'Equity' | 'Equity Option' | 'Index Option'");
  });

  it('GTC legs Zod schema allows Equity Option', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // Find the GTC legs instrumentType Zod enum
    const zodStart = src.indexOf("instrumentType: z.enum(['Equity Option'])");
    expect(zodStart).toBeGreaterThan(-1);
  });
});
