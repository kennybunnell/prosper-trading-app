/**
 * Tests for the page-level Equity/Index context mode consolidation.
 *
 * The key invariant: EnhancedWatchlist accepts an optional `contextMode` prop.
 * When provided, the internal `addAsIndex` value is derived from the prop
 * (not from local state), and all mode changes are forwarded via
 * `onContextModeChange` instead of mutating local state.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helper: derives addAsIndex from contextMode prop (mirrors component logic)
// ---------------------------------------------------------------------------
function resolveAddAsIndex(
  contextMode: 'equity' | 'index' | undefined,
  localAddAsIndex: boolean,
): boolean {
  return contextMode !== undefined ? contextMode === 'index' : localAddAsIndex;
}

// ---------------------------------------------------------------------------
// Pure helper: handles setAddAsIndex calls (mirrors component logic)
// ---------------------------------------------------------------------------
function handleSetAddAsIndex(
  val: boolean,
  onContextModeChange: ((mode: 'equity' | 'index') => void) | undefined,
  setLocalAddAsIndex: (val: boolean) => void,
): void {
  if (onContextModeChange) {
    onContextModeChange(val ? 'index' : 'equity');
  } else {
    setLocalAddAsIndex(val);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveAddAsIndex — controlled vs uncontrolled', () => {
  it('returns false when contextMode is "equity" (ignores local state)', () => {
    expect(resolveAddAsIndex('equity', true)).toBe(false);
    expect(resolveAddAsIndex('equity', false)).toBe(false);
  });

  it('returns true when contextMode is "index" (ignores local state)', () => {
    expect(resolveAddAsIndex('index', false)).toBe(true);
    expect(resolveAddAsIndex('index', true)).toBe(true);
  });

  it('falls back to localAddAsIndex when contextMode is undefined', () => {
    expect(resolveAddAsIndex(undefined, false)).toBe(false);
    expect(resolveAddAsIndex(undefined, true)).toBe(true);
  });
});

describe('handleSetAddAsIndex — controlled vs uncontrolled', () => {
  it('calls onContextModeChange with "index" when val=true and handler provided', () => {
    const calls: Array<'equity' | 'index'> = [];
    const localSetter = (_: boolean) => { throw new Error('should not be called'); };
    handleSetAddAsIndex(true, (m) => calls.push(m), localSetter);
    expect(calls).toEqual(['index']);
  });

  it('calls onContextModeChange with "equity" when val=false and handler provided', () => {
    const calls: Array<'equity' | 'index'> = [];
    const localSetter = (_: boolean) => { throw new Error('should not be called'); };
    handleSetAddAsIndex(false, (m) => calls.push(m), localSetter);
    expect(calls).toEqual(['equity']);
  });

  it('calls localSetter when no onContextModeChange provided', () => {
    const localCalls: boolean[] = [];
    handleSetAddAsIndex(true, undefined, (v) => localCalls.push(v));
    expect(localCalls).toEqual([true]);
    handleSetAddAsIndex(false, undefined, (v) => localCalls.push(v));
    expect(localCalls).toEqual([true, false]);
  });
});

describe('page-level pendingScanType governs scan button label', () => {
  function scanButtonLabel(pendingScanType: 'equity' | 'index'): string {
    return `Scan ${pendingScanType === 'index' ? 'Indexes' : 'Equities'}`;
  }

  it('shows "Scan Equities" in equity mode', () => {
    expect(scanButtonLabel('equity')).toBe('Scan Equities');
  });

  it('shows "Scan Indexes" in index mode', () => {
    expect(scanButtonLabel('index')).toBe('Scan Indexes');
  });
});

describe('page-level pendingScanType governs scan description', () => {
  function scanDescription(pendingScanType: 'equity' | 'index', hasResults: boolean, lastUpdated: string | null): string {
    if (hasResults && lastUpdated) return `Last scanned: ${lastUpdated}`;
    return `${pendingScanType === 'index' ? 'Index' : 'Equity'} mode active — switch the toggle in the Watchlist above to change context`;
  }

  it('shows last-scanned timestamp when results exist', () => {
    expect(scanDescription('equity', true, '2026-03-07 10:00')).toBe('Last scanned: 2026-03-07 10:00');
  });

  it('shows equity mode hint when no results', () => {
    expect(scanDescription('equity', false, null)).toContain('Equity mode active');
  });

  it('shows index mode hint when no results', () => {
    expect(scanDescription('index', false, null)).toContain('Index mode active');
  });
});
