/**
 * Tests for Dog forced-exit ITM CC logic
 *
 * Verifies that:
 * 1. The sellCoveredCall procedure does NOT check liquidation flags (bypass is intentional)
 * 2. Instrument type is always 'Equity Option' in the order legs
 * 3. All spread types (Bear Call, Bull Put, Iron Condor) use 'Equity Option'
 * 4. Index Option is never used in any order submission path
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

  it('sellCoveredCall uses Equity Option as instrument type', () => {
    const src = readFileSync(join(serverDir, 'routers-position-analyzer.ts'), 'utf-8');
    const sellCCStart = src.indexOf('sellCoveredCall: protectedProcedure');
    const nextProcedure = src.indexOf('protectedProcedure', sellCCStart + 50);
    const procedureBody = src.slice(sellCCStart, nextProcedure);
    expect(procedureBody).toContain("instrumentType: 'Equity Option'");
    expect(procedureBody).not.toContain("instrumentType: 'Index Option'");
  });

  it('Bear Call Spread submit uses Equity Option', () => {
    const src = readFileSync(join(serverDir, 'routers-cc.ts'), 'utf-8');
    const submitStart = src.indexOf('submitBearCallSpreadOrders');
    expect(submitStart).toBeGreaterThan(-1);
    // Use a larger window (6000 chars) to capture the full procedure body
    const submitBody = src.slice(submitStart, submitStart + 6000);
    expect(submitBody).toContain("instrumentType: 'Equity Option'");
    expect(submitBody).not.toContain("instrumentType: 'Index Option'");
  });

  it('Iron Condor live order uses Equity Option', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // Find the iron condor live order submission
    const icStart = src.indexOf("// Tastytrade API only accepts 'Equity Option'");
    expect(icStart).toBeGreaterThan(-1);
    const icBody = src.slice(icStart, icStart + 2000);
    // Strip single-line comments before checking for Index Option in code
    const icBodyNoComments = icBody.replace(/\/\/[^\n]*/g, '');
    expect(icBodyNoComments).toContain("'Equity Option'");
    expect(icBodyNoComments).not.toContain("'Index Option'");
  });

  it('Iron Condor dry run uses Equity Option', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    const dryRunStart = src.indexOf('dryRunInstrumentType');
    expect(dryRunStart).toBeGreaterThan(-1);
    const dryRunBody = src.slice(dryRunStart, dryRunStart + 500);
    expect(dryRunBody).toContain("'Equity Option'");
    expect(dryRunBody).not.toContain("'Index Option'");
  });

  it('No Index Option string used in any order submission path', () => {
    const files = [
      'routers.ts',
      'routers-cc.ts',
      'routers-automation.ts',
      'routers-rolls.ts',
      'routers-position-analyzer.ts',
      'tastytrade.ts',
      'gtc-orders.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(serverDir, file), 'utf-8');
      // Remove comments before checking
      const noComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const hasIndexOption = noComments.includes("'Index Option'") || noComments.includes('"Index Option"');
      expect(hasIndexOption, `${file} should not use 'Index Option' in code (only in comments)`).toBe(false);
    }
  });

  it('GTC legs Zod schema only allows Equity Option', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // Find the GTC legs instrumentType Zod enum
    const zodStart = src.indexOf("instrumentType: z.enum(['Equity Option'])");
    expect(zodStart).toBeGreaterThan(-1);
  });

  it('tastytrade OrderLeg type does not include Index Option', () => {
    const src = readFileSync(join(serverDir, 'tastytrade.ts'), 'utf-8');
    // Remove comments
    const noComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toContain("'Index Option'");
    expect(noComments).not.toContain('"Index Option"');
  });
});
