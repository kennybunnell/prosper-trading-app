/**
 * Tests for the buying power calculation fix and BPS strike price enrichment fix.
 *
 * Bug 1: Summary cards were using ALL scanned opportunities instead of only selected ones.
 * Bug 2: BPS strike prices were null/undefined in AI Advisor pipeline, causing $640k collateral.
 *
 * These tests verify the logic that was fixed in:
 * - client/src/pages/CSPDashboard.tsx (selectedOppsList instead of opportunities)
 * - client/src/components/AIAdvisorPanel.tsx (top50Ref enrichment)
 */

import { describe, it, expect } from 'vitest';

// ─── Buying Power Calculation Logic ──────────────────────────────────────────

/**
 * Simulates the fixed buying power calculation logic:
 * Uses selectedOppsList (AI-selected) instead of all opportunities.
 */
function calculateTotalCollateral(
  selectedOpps: Array<{ strike?: number; capitalAtRisk?: number }>,
  strategyType: 'csp' | 'spread'
): number {
  if (strategyType === 'spread') {
    return selectedOpps.reduce((sum, opp) => sum + (opp.capitalAtRisk || 0), 0);
  }
  return selectedOpps.reduce((sum, opp) => sum + ((opp.strike || 0) * 100), 0);
}

function calculateTotalPremium(
  selectedOpps: Array<{ premium?: number; netCredit?: number }>,
  strategyType: 'csp' | 'spread'
): number {
  if (strategyType === 'spread') {
    return selectedOpps.reduce((sum, opp) => sum + ((opp.netCredit || 0) * 100), 0);
  }
  return selectedOpps.reduce((sum, opp) => sum + ((opp.premium || 0) * 100), 0);
}

// ─── BPS Spread Width Calculation Logic ──────────────────────────────────────

/**
 * Simulates the fixed onSubmitSelected handler logic for BPS:
 * Uses shortStrike as fallback when strike is undefined.
 */
function calculateBPSCollateral(opp: {
  strike?: number;
  shortStrike?: number;
  longStrike?: number;
  capitalAtRisk?: number;
  capitalRisk?: number;
  spreadWidth?: number;
}): number {
  const strikeValue = opp.strike ?? opp.shortStrike ?? 0;
  const longStrikeValue = opp.longStrike || undefined; // undefined (not 0) to trigger fallback
  const spreadWidth = strikeValue > 0 && longStrikeValue && longStrikeValue > 0
    ? Math.abs(strikeValue - longStrikeValue)
    : (opp.spreadWidth ?? 0);

  // This is what calculateTotalCollateral in UnifiedOrderPreviewModal does for BPS:
  if (!strikeValue) {
    return opp.capitalAtRisk || opp.capitalRisk || 0;
  }
  if (longStrikeValue) {
    return Math.abs(strikeValue - longStrikeValue) * 100;
  }
  // Fallback to capitalAtRisk
  return opp.capitalAtRisk || opp.capitalRisk || (spreadWidth > 0 ? spreadWidth * 100 : strikeValue * 100);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Buying Power Calculation Fix', () => {
  it('should calculate total collateral using only selected opportunities (CSP)', () => {
    const allOpportunities = [
      { strike: 500, premium: 5.0 },  // selected
      { strike: 450, premium: 4.0 },  // selected
      { strike: 400, premium: 3.0 },  // NOT selected
      { strike: 350, premium: 2.0 },  // NOT selected
    ];

    const selectedOpps = allOpportunities.slice(0, 2); // only first 2 selected

    const totalCollateral = calculateTotalCollateral(selectedOpps, 'csp');
    const allCollateral = calculateTotalCollateral(allOpportunities, 'csp');

    // Selected: 500*100 + 450*100 = 95,000
    expect(totalCollateral).toBe(95000);
    // All: 500*100 + 450*100 + 400*100 + 350*100 = 170,000
    expect(allCollateral).toBe(170000);
    // The fix ensures we use selectedOpps, not all
    expect(totalCollateral).toBeLessThan(allCollateral);
  });

  it('should calculate total collateral using only selected opportunities (BPS spread)', () => {
    const allOpportunities = [
      { capitalAtRisk: 2500, netCredit: 1.5 },  // selected
      { capitalAtRisk: 2500, netCredit: 1.2 },  // selected
      { capitalAtRisk: 2500, netCredit: 1.0 },  // NOT selected
      { capitalAtRisk: 2500, netCredit: 0.8 },  // NOT selected
    ];

    const selectedOpps = allOpportunities.slice(0, 2);

    const totalCollateral = calculateTotalCollateral(selectedOpps, 'spread');
    const allCollateral = calculateTotalCollateral(allOpportunities, 'spread');

    // Selected: 2500 + 2500 = 5,000
    expect(totalCollateral).toBe(5000);
    // All: 2500 * 4 = 10,000
    expect(allCollateral).toBe(10000);
    expect(totalCollateral).toBeLessThan(allCollateral);
  });

  it('should calculate buying power usage percentage correctly', () => {
    const selectedOpps = [
      { strike: 500, premium: 5.0 },
      { strike: 450, premium: 4.0 },
    ];
    const availableBuyingPower = 200000;

    const totalCollateral = calculateTotalCollateral(selectedOpps, 'csp');
    const buyingPowerUsedPct = availableBuyingPower > 0 ? (totalCollateral / availableBuyingPower) * 100 : 0;

    // 95,000 / 200,000 = 47.5%
    expect(buyingPowerUsedPct).toBeCloseTo(47.5, 1);
    // Should NOT show "not enough buying power" warning (< 100%)
    expect(buyingPowerUsedPct).toBeLessThan(100);
  });
});

describe('BPS Strike Price Enrichment Fix', () => {
  it('should correctly calculate spread width when shortStrike and longStrike are provided', () => {
    // This simulates the enriched opportunity after top50Ref enrichment
    const enrichedOpp = {
      strike: undefined,       // strike is undefined for BPS in mapped opportunities
      shortStrike: 6410,       // short strike from mapping
      longStrike: 6385,        // long strike from server data
      capitalAtRisk: 2500,
    };

    const collateral = calculateBPSCollateral(enrichedOpp);
    // spreadWidth = |6410 - 6385| = 25, collateral = 25 * 100 = 2500
    expect(collateral).toBe(2500);
  });

  it('should NOT calculate $640k collateral when shortStrike is 6410 and longStrike is 6385', () => {
    const enrichedOpp = {
      strike: undefined,
      shortStrike: 6410,
      longStrike: 6385,
      capitalAtRisk: 2500,
    };

    const collateral = calculateBPSCollateral(enrichedOpp);
    // Should NOT be 6410 * 100 = $641,000 (the bug)
    expect(collateral).not.toBe(641000);
    // Should be the correct spread width collateral
    expect(collateral).toBe(2500);
  });

  it('should fall back to capitalAtRisk when longStrike is missing', () => {
    const enrichedOpp = {
      strike: undefined,
      shortStrike: 6410,
      longStrike: undefined,  // missing long strike
      capitalAtRisk: 2500,
    };

    const collateral = calculateBPSCollateral(enrichedOpp);
    // Should use capitalAtRisk as fallback
    expect(collateral).toBe(2500);
  });

  it('should handle the case where longStrike is 0 (falsy)', () => {
    // longStrike: 0 should be treated as undefined/missing
    const enrichedOpp = {
      strike: undefined,
      shortStrike: 6410,
      longStrike: 0,  // 0 is falsy - should not be used as long strike
      capitalAtRisk: 2500,
    };

    const collateral = calculateBPSCollateral(enrichedOpp);
    // Should NOT calculate |6410 - 0| * 100 = $641,000
    expect(collateral).not.toBe(641000);
    // Should use capitalAtRisk fallback
    expect(collateral).toBe(2500);
  });

  it('should correctly use strike field when available (CSP mode)', () => {
    const cspOpp = {
      strike: 500,
      shortStrike: undefined,
      longStrike: undefined,
    };

    const strikeValue = cspOpp.strike ?? cspOpp.shortStrike ?? 0;
    const collateral = strikeValue * 100;

    expect(strikeValue).toBe(500);
    expect(collateral).toBe(50000);
  });
});

describe('AI Advisor top50Ref Enrichment Logic', () => {
  it('should enrich AI pick with original opportunity data', () => {
    // Simulates what AIAdvisorPanel.handleSubmitSelected does
    const originalOpp = {
      symbol: 'SPXW',
      strike: undefined,       // undefined for BPS in mapping
      shortStrike: 6410,       // correctly set
      longStrike: 6385,        // correctly set
      netCredit: 1.5,
      capitalAtRisk: 2500,
      expiration: '2026-03-14',
      dte: 7,
    };

    // Simulates what AI server returns (may have null/undefined for optional fields)
    const aiReturnedOpportunity = {
      symbol: 'SPXW',
      strike: null,            // AI server may return null
      shortStrike: null,       // AI server may return null
      longStrike: null,        // AI server may return null
      netCredit: 1.5,
      capitalAtRisk: 2500,
      expiration: '2026-03-14',
      dte: 7,
    };

    // Enrichment: { ...aiReturnedOpportunity, ...originalOpp }
    // originalOpp fields override aiReturnedOpportunity fields
    const enrichedOpportunity = { ...aiReturnedOpportunity, ...originalOpp };

    // After enrichment, shortStrike and longStrike should be correct
    expect(enrichedOpportunity.shortStrike).toBe(6410);
    expect(enrichedOpportunity.longStrike).toBe(6385);
  });

  it('should correctly calculate spread collateral after enrichment', () => {
    const enrichedOpp = {
      symbol: 'SPXW',
      strike: undefined,
      shortStrike: 6410,
      longStrike: 6385,
      netCredit: 1.5,
      capitalAtRisk: 2500,
    };

    const collateral = calculateBPSCollateral(enrichedOpp);
    expect(collateral).toBe(2500); // |6410 - 6385| * 100
  });
});
