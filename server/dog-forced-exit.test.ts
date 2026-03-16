/**
 * Tests for Dog forced-exit ITM CC logic and instrument type correctness
 *
 * Verifies that:
 * 1. The sellCoveredCall procedure does NOT check liquidation flags (bypass is intentional)
 * 2. Order submission paths use the CORRECT instrument type per Tastytrade API:
 *    - 'Equity Option' for equity options (AAPL, MSFT, NVDA, etc.)
 *    - 'Index Option' for cash-settled index options (SPX, SPXW, NDX, NDXP, RUT, MRUT, DJX, VIX)
 *    Using 'Equity Option' for index options causes Order_disallowed_by_exchange_rules from CBOE.
 * 3. Position FILTERING accepts both 'Equity Option' and 'Index Option' because Tastytrade
 *    RETURNS 'Index Option' in positions/balances responses for SPXW, NDXP, MRUT, etc.
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

  it('Bear Call Spread submit uses Equity Option (BCS is always on equity stocks)', () => {
    const src = readFileSync(join(serverDir, 'routers-cc.ts'), 'utf-8');
    const submitStart = src.indexOf('submitBearCallSpreadOrders');
    expect(submitStart).toBeGreaterThan(-1);
    // Use a larger window (6000 chars) to capture the full procedure body
    const submitBody = src.slice(submitStart, submitStart + 6000);
    // Bear Call Spreads are on equity stocks — 'Equity Option' is correct
    expect(submitBody).toContain("'Equity Option'");
  });

  it('Iron Condor live order uses isTrueIndexOption to determine instrument type', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // The Iron Condor order submission now uses isTrueIndexOption to pick the correct type
    // (Index Option for SPX/NDX/RUT, Equity Option for everything else)
    expect(src).toContain('isTrueIndexOption');
    // The legInstrumentType variable should be typed as a union
    expect(src).toContain("legInstrumentType: 'Equity Option' | 'Index Option'");
  });

  it('Iron Condor dry run uses index-aware instrument type selection', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    const dryRunStart = src.indexOf('dryRunInstrumentType');
    expect(dryRunStart).toBeGreaterThan(-1);
    const dryRunBody = src.slice(dryRunStart, dryRunStart + 500);
    // Dry run uses the correct instrument type based on symbol (Index Option for SPX/NDX/RUT)
    // The variable is set via isIndexOpt() which is an alias for isTrueIndexOption()
    expect(dryRunBody).toContain("'Index Option'");
    expect(dryRunBody).toContain("'Equity Option'");
  });

  it('All order submission paths include Equity Option for equity stocks', () => {
    const files = [
      'routers.ts',
      'routers-cc.ts',
      'routers-automation.ts',
      'tastytrade.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(serverDir, file), 'utf-8');
      // Each file that submits orders should reference 'Equity Option'
      const hasEquityOption = src.includes("'Equity Option'") || src.includes('"Equity Option"');
      expect(
        hasEquityOption,
        `${file} should use 'Equity Option' for equity stock order submission`
      ).toBe(true);
    }
  });

  it('Automation router uses isTrueIndexOption for BTC close orders (fixes SPX rejection)', () => {
    const src = readFileSync(join(serverDir, 'routers-automation.ts'), 'utf-8');
    // The BTC close order path now uses isTrueIndexOption to pick the correct instrument type
    expect(src).toContain('isTrueIndexOption');
    // The closeInstrumentType should be typed as a union
    expect(src).toContain("closeInstrumentType: 'Equity Option' | 'Index Option'");
  });

  it('tastytrade buyToCloseOption uses isTrueIndexOption for instrument type', () => {
    const src = readFileSync(join(serverDir, 'tastytrade.ts'), 'utf-8');
    // buyToCloseOption now uses isTrueIndexOption to pick the correct type
    expect(src).toContain('isBtcIndexOpt');
    expect(src).toContain("btcInstrumentType: 'Equity Option' | 'Index Option'");
  });

  it('tastytrade OrderLeg type includes Index Option in the union (for type safety with TT responses)', () => {
    const src = readFileSync(join(serverDir, 'tastytrade.ts'), 'utf-8');
    // The OrderLeg interface includes 'Index Option' in the union for type safety
    expect(src).toContain("'Equity' | 'Equity Option' | 'Index Option'");
  });

  it('GTC legs Zod schema allows both Equity Option and Index Option', () => {
    const src = readFileSync(join(serverDir, 'routers.ts'), 'utf-8');
    // GTC legs schema now accepts both types since SPX/NDX/RUT use Index Option
    const zodStart = src.indexOf("instrumentType: z.enum(['Equity Option', 'Index Option'])");
    expect(zodStart).toBeGreaterThan(-1);
  });
});
