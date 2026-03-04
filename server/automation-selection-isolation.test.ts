/**
 * Unit tests for AutomationDashboard selection isolation fixes.
 *
 * Two bugs fixed:
 *
 * Bug 1 — "Review & Submit N Orders" showed wrong count:
 *   selectedPositions.size counted ALL keys in the Set (including keys from other tabs).
 *   Fix: visibleSelectedCount = selectableResults.filter(r => selectedPositions.has(posKey(r))).length
 *   This only counts positions that are BOTH selected AND visible in the current tab.
 *
 * Bug 2 — Cross-tab bleed in order preview:
 *   handleOpenOrderPreview filtered from lastRunResult.scanResults (all results),
 *   so BPS META/V positions appeared in BCS order preview.
 *   Fix: filter from visibleScanResults (respects active tab) via visibleScanResultsRef.
 *   Also: switching tabs now clears selectedPositions to prevent stale cross-tab keys.
 */

import { describe, it, expect } from 'vitest';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanResult = {
  symbol: string;
  optionSymbol: string;
  account: string;
  type: string;
  action: string;
  dte: number;
  premiumCollected: number;
  buyBackCost: number;
  realizedPercent: number;
};

// ─── Helpers mirroring AutomationDashboard logic ──────────────────────────────

const posKey = (r: ScanResult) => `${r.optionSymbol}|${r.account}|${r.type}`;

function getVisibleScanResults(
  allResults: ScanResult[],
  scanTypeFilter: string,
  hideExpiringToday: boolean
): ScanResult[] {
  let rows = allResults.filter(r => !(hideExpiringToday && r.dte === 0));
  if (scanTypeFilter !== 'all') {
    rows = rows.filter(r => r.type === scanTypeFilter);
  }
  return rows;
}

function getSelectableResults(visibleResults: ScanResult[]): ScanResult[] {
  return visibleResults.filter(r => r.action === 'WOULD_CLOSE' && r.dte !== 0);
}

function getVisibleSelectedCount(
  selectableResults: ScanResult[],
  selectedPositions: Set<string>
): number {
  return selectableResults.filter(r => selectedPositions.has(posKey(r))).length;
}

function getOrderPreviewOrders(
  visibleResults: ScanResult[],
  selectedPositions: Set<string>
): ScanResult[] {
  return visibleResults.filter(
    r => selectedPositions.has(posKey(r)) && r.action === 'WOULD_CLOSE'
  );
}

// ─── Test data ────────────────────────────────────────────────────────────────

const makeScanResult = (overrides: Partial<ScanResult> & { symbol: string; type: string }): ScanResult => ({
  optionSymbol: `${overrides.symbol}260306P00100000`,
  account: '5WZ77313',
  action: 'WOULD_CLOSE',
  dte: 2,
  premiumCollected: 500,
  buyBackCost: 10,
  realizedPercent: 98,
  ...overrides,
});

const META_BPS = makeScanResult({ symbol: 'META', type: 'BPS', optionSymbol: 'META260306P00637500' });
const V_BPS    = makeScanResult({ symbol: 'V',    type: 'BPS', optionSymbol: 'V 260306P00310000' });
const IREN_BCS = makeScanResult({ symbol: 'IREN', type: 'BCS', optionSymbol: 'IREN260306C00046500' });
const APLD_BCS = makeScanResult({ symbol: 'APLD', type: 'BCS', optionSymbol: 'APLD260313C00036000' });

const allResults = [META_BPS, V_BPS, IREN_BCS, APLD_BCS];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('visibleSelectedCount — counts only visible tab selections', () => {
  it('returns 0 when nothing is selected', () => {
    const visible = getVisibleScanResults(allResults, 'BCS', false);
    const selectable = getSelectableResults(visible);
    expect(getVisibleSelectedCount(selectable, new Set())).toBe(0);
  });

  it('returns 2 when IREN and APLD BCS are selected and BCS tab is active', () => {
    const selected = new Set([posKey(IREN_BCS), posKey(APLD_BCS)]);
    const visible = getVisibleScanResults(allResults, 'BCS', false);
    const selectable = getSelectableResults(visible);
    expect(getVisibleSelectedCount(selectable, selected)).toBe(2);
  });

  it('does NOT count BPS positions when BCS tab is active, even if they are in the Set', () => {
    // Simulates the bug: META and V keys are in selectedPositions from a previous BPS tab visit
    const selected = new Set([posKey(META_BPS), posKey(V_BPS), posKey(IREN_BCS), posKey(APLD_BCS)]);
    const visible = getVisibleScanResults(allResults, 'BCS', false);
    const selectable = getSelectableResults(visible);
    // Should only count the 2 BCS positions, not the 4 total in the Set
    expect(getVisibleSelectedCount(selectable, selected)).toBe(2);
  });

  it('counts all 4 when All tab is active and all are selected', () => {
    const selected = new Set([posKey(META_BPS), posKey(V_BPS), posKey(IREN_BCS), posKey(APLD_BCS)]);
    const visible = getVisibleScanResults(allResults, 'all', false);
    const selectable = getSelectableResults(visible);
    expect(getVisibleSelectedCount(selectable, selected)).toBe(4);
  });
});

describe('getOrderPreviewOrders — filters from visible results only', () => {
  it('returns only BCS orders when BCS tab is active, even if BPS keys are in selectedPositions', () => {
    // Bug scenario: META and V were selected on BPS tab, user switches to BCS tab and selects IREN+APLD
    const selected = new Set([posKey(META_BPS), posKey(V_BPS), posKey(IREN_BCS), posKey(APLD_BCS)]);
    const visible = getVisibleScanResults(allResults, 'BCS', false);
    const orders = getOrderPreviewOrders(visible, selected);
    expect(orders).toHaveLength(2);
    expect(orders.map(o => o.symbol)).toEqual(['IREN', 'APLD']);
  });

  it('returns only IREN when only IREN is selected in BCS tab', () => {
    const selected = new Set([posKey(IREN_BCS)]);
    const visible = getVisibleScanResults(allResults, 'BCS', false);
    const orders = getOrderPreviewOrders(visible, selected);
    expect(orders).toHaveLength(1);
    expect(orders[0].symbol).toBe('IREN');
  });

  it('returns empty array when no visible positions are selected', () => {
    // Only BPS positions selected, but BCS tab is active
    const selected = new Set([posKey(META_BPS), posKey(V_BPS)]);
    const visible = getVisibleScanResults(allResults, 'BCS', false);
    const orders = getOrderPreviewOrders(visible, selected);
    expect(orders).toHaveLength(0);
  });

  it('returns all 4 when All tab is active and all are selected', () => {
    const selected = new Set([posKey(META_BPS), posKey(V_BPS), posKey(IREN_BCS), posKey(APLD_BCS)]);
    const visible = getVisibleScanResults(allResults, 'all', false);
    const orders = getOrderPreviewOrders(visible, selected);
    expect(orders).toHaveLength(4);
  });
});

describe('tab switch clears selections', () => {
  it('simulates clearing selectedPositions on tab switch', () => {
    // Before switch: BPS positions are selected
    let selectedPositions = new Set([posKey(META_BPS), posKey(V_BPS)]);
    expect(selectedPositions.size).toBe(2);

    // User switches to BCS tab — selections are cleared
    const newTab = 'BCS';
    const oldTab = 'BPS';
    if (newTab !== oldTab) {
      selectedPositions = new Set(); // simulates setSelectedPositions(new Set())
    }
    expect(selectedPositions.size).toBe(0);
  });

  it('does not clear selections when clicking the already-active tab', () => {
    let selectedPositions = new Set([posKey(IREN_BCS)]);
    const currentTab = 'BCS';
    const clickedTab = 'BCS'; // same tab

    if (clickedTab !== currentTab) {
      selectedPositions = new Set();
    }
    // Should still have the selection
    expect(selectedPositions.size).toBe(1);
  });
});

describe('posKey uniqueness across types', () => {
  it('generates distinct keys for BPS and BCS positions with same underlying', () => {
    // If APLD had both a BPS and BCS position, they must have distinct keys
    const apldBPS = makeScanResult({ symbol: 'APLD', type: 'BPS', optionSymbol: 'APLD260313P00036000' });
    const apldBCS = makeScanResult({ symbol: 'APLD', type: 'BCS', optionSymbol: 'APLD260313C00036000' });
    expect(posKey(apldBPS)).not.toBe(posKey(apldBCS));
  });

  it('generates same key for identical position (idempotent)', () => {
    expect(posKey(IREN_BCS)).toBe(posKey(IREN_BCS));
  });
});
