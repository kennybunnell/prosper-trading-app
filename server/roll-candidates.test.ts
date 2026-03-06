/**
 * Unit tests for getRollCandidates logic
 * Tests: direction filtering, net credit calculation, ranking, spread width
 */
import { describe, it, expect } from 'vitest';

type MockOption = {
  type: 'call' | 'put';
  strike: number;
  bid: number;
  ask: number;
  greeks?: { delta: number };
};

/**
 * Mirrors the server-side candidate filtering and net credit calculation
 */
function computeRollCandidates(opts: {
  chain: MockOption[];
  optionType: 'call' | 'put';
  currentShortStrike: number;
  currentLongStrike?: number;
  spreadWidth: number;
  closeDebit: number;
  rollUp: boolean;
}) {
  const { chain, optionType, currentShortStrike, currentLongStrike, spreadWidth, closeDebit, rollUp } = opts;
  const filtered = chain.filter(o => o.type === optionType && o.bid > 0 && o.ask > 0);
  const shortCandidates = filtered.filter(o =>
    rollUp ? o.strike > currentShortStrike : o.strike < currentShortStrike
  );

  type Candidate = {
    newShortStrike: number;
    newLongStrike: number;
    newShortDelta: number;
    newSpreadCredit: number;
    netRollCredit: number;
  };

  const candidates: Candidate[] = [];

  for (const shortLeg of shortCandidates) {
    const shortDelta = Math.abs(shortLeg.greeks?.delta ?? 0);
    if (shortDelta > 0.35) continue;

    let newSpreadCredit: number;
    let newLongStrike: number;

    if (currentLongStrike !== undefined) {
      const longStrike = rollUp
        ? shortLeg.strike + spreadWidth
        : shortLeg.strike - spreadWidth;
      newLongStrike = longStrike;
      const longLeg = filtered.find(o => o.strike === longStrike);
      if (!longLeg) continue;
      newSpreadCredit = shortLeg.bid - longLeg.ask;
    } else {
      newLongStrike = shortLeg.strike;
      newSpreadCredit = shortLeg.bid;
    }

    if (newSpreadCredit <= 0) continue;

    const netRollCredit = newSpreadCredit - closeDebit;
    candidates.push({ newShortStrike: shortLeg.strike, newLongStrike, newShortDelta: shortDelta, newSpreadCredit, netRollCredit });
  }

  candidates.sort((a, b) => {
    const aCredit = a.netRollCredit > 0 ? 1 : 0;
    const bCredit = b.netRollCredit > 0 ? 1 : 0;
    if (aCredit !== bCredit) return bCredit - aCredit;
    if (Math.abs(a.netRollCredit - b.netRollCredit) > 0.01) return b.netRollCredit - a.netRollCredit;
    return a.newShortDelta - b.newShortDelta;
  });

  return candidates;
}

// ─── BCS Direction Filtering ─────────────────────────────────────────────────

describe('BCS roll candidates - direction filtering', () => {
  const callChain: MockOption[] = [
    { type: 'call', strike: 180, bid: 3.00, ask: 3.10, greeks: { delta: 0.55 } },
    { type: 'call', strike: 185, bid: 2.00, ask: 2.10, greeks: { delta: 0.40 } },
    { type: 'call', strike: 190, bid: 1.50, ask: 1.60, greeks: { delta: 0.30 } },
    { type: 'call', strike: 195, bid: 1.00, ask: 1.10, greeks: { delta: 0.22 } },
    { type: 'call', strike: 200, bid: 0.60, ask: 0.70, greeks: { delta: 0.15 } },
    { type: 'call', strike: 205, bid: 0.30, ask: 0.40, greeks: { delta: 0.08 } },
  ];

  it('only considers strikes ABOVE current short strike for BCS', () => {
    const candidates = computeRollCandidates({
      chain: callChain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.50, rollUp: true,
    });
    expect(candidates.every(c => c.newShortStrike > 185)).toBe(true);
  });

  it('excludes strikes with delta > 0.35', () => {
    const candidates = computeRollCandidates({
      chain: callChain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.50, rollUp: true,
    });
    expect(candidates.every(c => c.newShortDelta <= 0.35)).toBe(true);
  });

  it('excludes candidates where new spread credit is zero or negative', () => {
    const chainWithZeroBid: MockOption[] = [
      { type: 'call', strike: 190, bid: 0, ask: 0.10, greeks: { delta: 0.25 } },
      { type: 'call', strike: 195, bid: 0.80, ask: 0.90, greeks: { delta: 0.20 } },
      { type: 'call', strike: 200, bid: 0.40, ask: 0.50, greeks: { delta: 0.12 } },
    ];
    const candidates = computeRollCandidates({
      chain: chainWithZeroBid, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0, rollUp: true,
    });
    expect(candidates.every(c => c.newSpreadCredit > 0)).toBe(true);
  });
});

// ─── BPS Direction Filtering ─────────────────────────────────────────────────

describe('BPS roll candidates - direction filtering', () => {
  const putChain: MockOption[] = [
    { type: 'put', strike: 150, bid: 0.50, ask: 0.60, greeks: { delta: -0.12 } },
    { type: 'put', strike: 155, bid: 0.80, ask: 0.90, greeks: { delta: -0.18 } },
    { type: 'put', strike: 160, bid: 1.20, ask: 1.30, greeks: { delta: -0.25 } },
    { type: 'put', strike: 165, bid: 1.80, ask: 1.90, greeks: { delta: -0.35 } },
    { type: 'put', strike: 170, bid: 2.50, ask: 2.60, greeks: { delta: -0.45 } },
    { type: 'put', strike: 145, bid: 0.30, ask: 0.40, greeks: { delta: -0.08 } },
  ];

  it('only considers strikes BELOW current short strike for BPS', () => {
    const candidates = computeRollCandidates({
      chain: putChain, optionType: 'put', currentShortStrike: 165,
      currentLongStrike: 160, spreadWidth: 5, closeDebit: 0.40, rollUp: false,
    });
    expect(candidates.every(c => c.newShortStrike < 165)).toBe(true);
  });

  it('excludes strikes with delta > 0.35 (absolute value)', () => {
    const candidates = computeRollCandidates({
      chain: putChain, optionType: 'put', currentShortStrike: 165,
      currentLongStrike: 160, spreadWidth: 5, closeDebit: 0.40, rollUp: false,
    });
    expect(candidates.every(c => c.newShortDelta <= 0.35)).toBe(true);
  });
});

// ─── Net Credit Calculation ───────────────────────────────────────────────────

describe('Net credit calculation', () => {
  it('correctly calculates net roll credit for BCS (small debit scenario)', () => {
    // short $190 bid=1.50, long $195 ask=1.10 → spread credit = 0.40
    // close debit = 0.50 → net = 0.40 - 0.50 = -0.10
    const chain: MockOption[] = [
      { type: 'call', strike: 190, bid: 1.50, ask: 1.60, greeks: { delta: 0.30 } },
      { type: 'call', strike: 195, bid: 1.00, ask: 1.10, greeks: { delta: 0.22 } },
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.50, rollUp: true,
    });
    expect(candidates.length).toBeGreaterThan(0);
    const c = candidates.find(c => c.newShortStrike === 190)!;
    expect(c.newSpreadCredit).toBeCloseTo(0.40, 2);
    expect(c.netRollCredit).toBeCloseTo(-0.10, 2);
  });

  it('correctly identifies a net credit roll', () => {
    // short $190 bid=2.00, long $195 ask=0.90 → spread credit = 1.10
    // close debit = 0.50 → net = 1.10 - 0.50 = 0.60
    const chain: MockOption[] = [
      { type: 'call', strike: 190, bid: 2.00, ask: 2.10, greeks: { delta: 0.28 } },
      { type: 'call', strike: 195, bid: 0.80, ask: 0.90, greeks: { delta: 0.18 } },
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.50, rollUp: true,
    });
    const c = candidates.find(c => c.newShortStrike === 190)!;
    expect(c.newSpreadCredit).toBeCloseTo(1.10, 2);
    expect(c.netRollCredit).toBeCloseTo(0.60, 2);
    expect(c.netRollCredit).toBeGreaterThan(0);
  });
});

// ─── Ranking ─────────────────────────────────────────────────────────────────

describe('Roll candidate ranking', () => {
  it('among net credit rolls, ranks higher credit first', () => {
    const chain: MockOption[] = [
      { type: 'call', strike: 190, bid: 2.50, ask: 2.60, greeks: { delta: 0.28 } },
      { type: 'call', strike: 195, bid: 0.80, ask: 0.90, greeks: { delta: 0.18 } },
      { type: 'call', strike: 192, bid: 1.80, ask: 1.90, greeks: { delta: 0.24 } },
      { type: 'call', strike: 197, bid: 0.60, ask: 0.70, greeks: { delta: 0.14 } },
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.30, rollUp: true,
    });
    for (let i = 0; i < candidates.length - 1; i++) {
      expect(candidates[i].netRollCredit).toBeGreaterThanOrEqual(candidates[i + 1].netRollCredit);
    }
  });
});

// ─── Single-leg (CC / CSP) ────────────────────────────────────────────────────

describe('Single-leg roll (CC / CSP)', () => {
  it('CC: uses only short leg bid as spread credit', () => {
    const chain: MockOption[] = [
      { type: 'call', strike: 190, bid: 1.80, ask: 1.90, greeks: { delta: 0.28 } },
      { type: 'call', strike: 195, bid: 1.20, ask: 1.30, greeks: { delta: 0.20 } },
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: undefined, spreadWidth: 5, closeDebit: 0.40, rollUp: true,
    });
    expect(candidates.every(c => {
      const leg = chain.find(o => o.strike === c.newShortStrike)!;
      return c.newSpreadCredit === leg.bid;
    })).toBe(true);
  });

  it('CSP: rolls down (lower strikes only)', () => {
    const chain: MockOption[] = [
      { type: 'put', strike: 155, bid: 1.20, ask: 1.30, greeks: { delta: -0.22 } },
      { type: 'put', strike: 160, bid: 1.80, ask: 1.90, greeks: { delta: -0.30 } },
      { type: 'put', strike: 165, bid: 2.50, ask: 2.60, greeks: { delta: -0.40 } },
      { type: 'put', strike: 170, bid: 3.20, ask: 3.30, greeks: { delta: -0.50 } },
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'put', currentShortStrike: 165,
      currentLongStrike: undefined, spreadWidth: 5, closeDebit: 0.80, rollUp: false,
    });
    expect(candidates.every(c => c.newShortStrike < 165)).toBe(true);
  });
});

// ─── Spread Width Maintenance ─────────────────────────────────────────────────

describe('Spread width maintenance', () => {
  it('maintains the same spread width when rolling BCS', () => {
    const chain: MockOption[] = [
      { type: 'call', strike: 190, bid: 1.50, ask: 1.60, greeks: { delta: 0.28 } },
      { type: 'call', strike: 195, bid: 0.90, ask: 1.00, greeks: { delta: 0.20 } },
      { type: 'call', strike: 192, bid: 1.20, ask: 1.30, greeks: { delta: 0.24 } },
      { type: 'call', strike: 197, bid: 0.60, ask: 0.70, greeks: { delta: 0.16 } },
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.30, rollUp: true,
    });
    expect(candidates.every(c => c.newLongStrike - c.newShortStrike === 5)).toBe(true);
  });

  it('skips candidates where matching long leg does not exist at the required width', () => {
    const chain: MockOption[] = [
      { type: 'call', strike: 190, bid: 1.50, ask: 1.60, greeks: { delta: 0.28 } },
      // No strike at 195 (5-wide long leg)
    ];
    const candidates = computeRollCandidates({
      chain, optionType: 'call', currentShortStrike: 185,
      currentLongStrike: 190, spreadWidth: 5, closeDebit: 0.30, rollUp: true,
    });
    expect(candidates.length).toBe(0);
  });
});
