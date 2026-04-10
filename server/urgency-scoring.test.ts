/**
 * Unit tests for the Roll/Close Positions urgency scoring logic
 * Tests the composite urgency score (DTE + ITM + P&L) used to sort positions
 */
import { describe, it, expect } from 'vitest';

// Mirror the urgency score function from AutomationDashboard.tsx
function urgencyScore(pos: {
  metrics: { dte: number; itmDepth: number };
  unrealizedPnl?: number;
}): number {
  const dte = pos.metrics.dte;
  const itmDepth = pos.metrics.itmDepth;
  const pnlPct = pos.unrealizedPnl ?? 0;

  // DTE component (0-60 pts): lower DTE = higher urgency
  let dteScore = 0;
  if (dte === 0)       dteScore = 60; // CRITICAL: expires today
  else if (dte <= 1)   dteScore = 55;
  else if (dte <= 3)   dteScore = 50;
  else if (dte <= 7)   dteScore = 40;
  else if (dte <= 14)  dteScore = 25;
  else if (dte <= 21)  dteScore = 15;
  else if (dte <= 30)  dteScore = 8;
  else                 dteScore = 0;

  // ITM component (0-25 pts): deeper ITM = more urgent
  let itmScore = 0;
  if (itmDepth > 20)      itmScore = 25;
  else if (itmDepth > 10) itmScore = 18;
  else if (itmDepth > 5)  itmScore = 12;
  else if (itmDepth > 2)  itmScore = 6;
  else if (itmDepth > 0)  itmScore = 3;

  // P&L component (0-15 pts): larger loss = more urgent
  let pnlScore = 0;
  if (pnlPct < -500)      pnlScore = 15;
  else if (pnlPct < -200) pnlScore = 10;
  else if (pnlPct < -100) pnlScore = 6;
  else if (pnlPct < 0)    pnlScore = 3;

  return dteScore + itmScore + pnlScore;
}

describe('urgencyScore', () => {
  it('DTE=0 (expires today) should have highest DTE score of 60', () => {
    const score = urgencyScore({ metrics: { dte: 0, itmDepth: 0 } });
    expect(score).toBe(60);
  });

  it('DTE=0 ITM deep should score higher than DTE=7 OTM', () => {
    const expiringToday = urgencyScore({ metrics: { dte: 0, itmDepth: 5 }, unrealizedPnl: -50 });
    const weekOut = urgencyScore({ metrics: { dte: 7, itmDepth: 0 }, unrealizedPnl: 100 });
    expect(expiringToday).toBeGreaterThan(weekOut);
  });

  it('DTE=0 should always rank above DTE=42 regardless of ITM/P&L', () => {
    const expiringToday = urgencyScore({ metrics: { dte: 0, itmDepth: 0 }, unrealizedPnl: 100 });
    const farOut = urgencyScore({ metrics: { dte: 42, itmDepth: 25 }, unrealizedPnl: -600 });
    expect(expiringToday).toBeGreaterThan(farOut);
  });

  it('APLD (DTE=0) should rank above MS (DTE=42) — the bug case', () => {
    const apld = urgencyScore({ metrics: { dte: 0, itmDepth: 2.5 }, unrealizedPnl: 297 });
    const ms = urgencyScore({ metrics: { dte: 42, itmDepth: 3.8 }, unrealizedPnl: -497 });
    expect(apld).toBeGreaterThan(ms);
  });

  it('DTE=7 with deep ITM should rank above DTE=7 OTM', () => {
    const itmPos = urgencyScore({ metrics: { dte: 7, itmDepth: 15 } });
    const otmPos = urgencyScore({ metrics: { dte: 7, itmDepth: 0 } });
    expect(itmPos).toBeGreaterThan(otmPos);
  });

  it('Large loss should add urgency within same DTE tier', () => {
    const bigLoss = urgencyScore({ metrics: { dte: 14, itmDepth: 0 }, unrealizedPnl: -600 });
    const smallLoss = urgencyScore({ metrics: { dte: 14, itmDepth: 0 }, unrealizedPnl: -50 });
    expect(bigLoss).toBeGreaterThan(smallLoss);
  });

  it('Winner far OTM with high DTE should have lowest urgency', () => {
    const score = urgencyScore({ metrics: { dte: 45, itmDepth: -15 }, unrealizedPnl: 500 });
    expect(score).toBe(0);
  });

  it('DTE tiers should be monotonically decreasing in urgency', () => {
    const scores = [0, 1, 3, 7, 14, 21, 30, 45].map(dte =>
      urgencyScore({ metrics: { dte, itmDepth: 0 } })
    );
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });
});
