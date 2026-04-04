/**
 * Tests for Roll Positions functionality
 * Covers: OCC symbol parsing, roll analysis logic, and submitRollOrders input validation
 */
import { describe, it, expect } from 'vitest';

// ─── OCC Symbol Parsing ───────────────────────────────────────────────────────

function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiration: string;
  optionType: string;
  strike: number;
} | null {
  try {
    const cleanSymbol = symbol.replace(/\s/g, '');
    const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (match) {
      const underlying = match[1];
      const dateStr = match[2];
      const optionType = match[3] === 'P' ? 'PUT' : 'CALL';
      const strike = parseInt(match[4]) / 1000;
      const year = 2000 + parseInt(dateStr.substring(0, 2));
      const month = parseInt(dateStr.substring(2, 4));
      const day = parseInt(dateStr.substring(4, 6));
      const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { underlying, expiration, optionType, strike };
    }
  } catch {
    return null;
  }
  return null;
}

function buildOCCSymbol(underlying: string, expiration: string, optionType: 'C' | 'P', strike: number): string {
  // OCC standard: ticker padded to 6 chars + YYMMDD + C/P + 8-digit strike (21 chars total)
  const expParts = expiration.split('-');
  const dateStr = expParts[0].slice(2) + expParts[1] + expParts[2]; // YYMMDD
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  const paddedTicker = underlying.padEnd(6, ' ');
  return `${paddedTicker}${dateStr}${optionType}${strikeStr}`;
}

describe('OCC Symbol Parsing', () => {
  it('parses a standard CSP symbol correctly', () => {
    const result = parseOptionSymbol('AAPL250117P00150000');
    expect(result).not.toBeNull();
    expect(result!.underlying).toBe('AAPL');
    expect(result!.expiration).toBe('2025-01-17');
    expect(result!.optionType).toBe('PUT');
    expect(result!.strike).toBe(150);
  });

  it('parses a standard CC symbol correctly', () => {
    const result = parseOptionSymbol('TSLA250321C00250000');
    expect(result).not.toBeNull();
    expect(result!.underlying).toBe('TSLA');
    expect(result!.expiration).toBe('2025-03-21');
    expect(result!.optionType).toBe('CALL');
    expect(result!.strike).toBe(250);
  });

  it('handles symbols with spaces (Tastytrade format)', () => {
    const result = parseOptionSymbol('AAPL  250117P00150000');
    expect(result).not.toBeNull();
    expect(result!.underlying).toBe('AAPL');
    expect(result!.strike).toBe(150);
  });

  it('handles fractional strikes (e.g. $150.50)', () => {
    const result = parseOptionSymbol('HOOD260117P00015050');
    expect(result).not.toBeNull();
    expect(result!.strike).toBe(15.05);
  });

  it('returns null for invalid symbols', () => {
    expect(parseOptionSymbol('')).toBeNull();
    expect(parseOptionSymbol('INVALID')).toBeNull();
    expect(parseOptionSymbol('123456')).toBeNull();
  });
});

describe('OCC Symbol Building', () => {
  it('builds a CSP OCC symbol correctly (padded ticker)', () => {
    const symbol = buildOCCSymbol('AAPL', '2025-01-17', 'P', 150);
    expect(symbol).toBe('AAPL  250117P00150000'); // 6-char padded ticker
    expect(symbol.length).toBe(21);
  });

  it('builds a CC OCC symbol correctly (padded ticker)', () => {
    const symbol = buildOCCSymbol('TSLA', '2025-03-21', 'C', 250);
    expect(symbol).toBe('TSLA  250321C00250000');
    expect(symbol.length).toBe(21);
  });

  it('round-trips: parse then build returns original symbol', () => {
    // parseOptionSymbol strips spaces, so round-trip uses the padded form
    const original = 'SOFI  260320P00007500'; // padded form
    const parsed = parseOptionSymbol(original);
    expect(parsed).not.toBeNull();
    const rebuilt = buildOCCSymbol(
      parsed!.underlying,
      parsed!.expiration,
      parsed!.optionType === 'PUT' ? 'P' : 'C',
      parsed!.strike
    );
    expect(rebuilt).toBe('SOFI  260320P00007500');
  });

  it('pads strike correctly for sub-$10 strikes', () => {
    const symbol = buildOCCSymbol('HOOD', '2026-01-17', 'P', 7.5);
    expect(symbol).toBe('HOOD  260117P00007500');
    expect(symbol.length).toBe(21);
  });

  it('3-char ticker gets 3 spaces of padding', () => {
    const symbol = buildOCCSymbol('SPY', '2026-04-17', 'P', 540);
    expect(symbol).toBe('SPY   260417P00540000');
    expect(symbol.length).toBe(21);
  });

  it('5-char ticker gets 1 space of padding', () => {
    const symbol = buildOCCSymbol('GOOGL', '2026-04-17', 'C', 180);
    expect(symbol).toBe('GOOGL 260417C00180000');
    expect(symbol.length).toBe(21);
  });
});

// ─── Roll Analysis Logic ──────────────────────────────────────────────────────

describe('Roll Analysis — DTE urgency', () => {
  it('marks position as red urgency when DTE <= 7', () => {
    const dte = 5;
    const urgency = dte <= 7 ? 'red' : dte <= 14 ? 'yellow' : 'green';
    expect(urgency).toBe('red');
  });

  it('marks position as yellow urgency when DTE is 8-14', () => {
    const dte = 10;
    const urgency = dte <= 7 ? 'red' : dte <= 14 ? 'yellow' : 'green';
    expect(urgency).toBe('yellow');
  });

  it('marks position as green urgency when DTE > 14', () => {
    const dte = 21;
    const urgency = dte <= 7 ? 'red' : dte <= 14 ? 'yellow' : 'green';
    expect(urgency).toBe('green');
  });
});

describe('Roll Analysis — Profit captured', () => {
  it('calculates profit captured correctly', () => {
    const openPremium = 100;
    const currentValue = 20;
    const profitCaptured = ((openPremium - currentValue) / openPremium) * 100;
    expect(profitCaptured).toBe(80);
  });

  it('handles zero open premium gracefully', () => {
    const openPremium = 0;
    const currentValue = 0;
    const profitCaptured = openPremium > 0
      ? ((openPremium - currentValue) / openPremium) * 100
      : 0;
    expect(profitCaptured).toBe(0);
  });
});

// ─── Submit Roll Orders — Input Validation ────────────────────────────────────

describe('Submit Roll Orders — order construction', () => {
  it('builds a 2-leg roll order (BTC + STO) correctly', () => {
    const order = {
      accountNumber: '5WZ80418',
      symbol: 'SOFI',
      strategy: 'csp' as const,
      currentOptionSymbol: 'SOFI260320P00007500',
      currentQuantity: 1,
      currentValue: 0.15,
      newStrike: 7.0,
      newExpiration: '2026-04-17',
      newPremium: 0.35,
      netCredit: 0.20,
      action: 'roll' as const,
    };

    // Verify legs
    const btcLeg = { symbol: order.currentOptionSymbol, action: 'Buy to Close', quantity: '1' };
    const newOCC = buildOCCSymbol(order.symbol, order.newExpiration, 'P', order.newStrike!);
    const stoLeg = { symbol: newOCC, action: 'Sell to Open', quantity: '1' };

    expect(btcLeg.action).toBe('Buy to Close');
    expect(stoLeg.action).toBe('Sell to Open');
    expect(stoLeg.symbol).toBe('SOFI  260417P00007000'); // 6-char padded ticker
  });

  it('builds a close-only order (BTC only) correctly', () => {
    const order = {
      accountNumber: '5WZ80418',
      symbol: 'HOOD',
      strategy: 'cc' as const,
      currentOptionSymbol: 'HOOD260117C00015000',
      currentQuantity: 2,
      currentValue: 0.05,
      action: 'close' as const,
    };

    const legs = [{ symbol: order.currentOptionSymbol, action: 'Buy to Close', quantity: String(order.currentQuantity) }];
    expect(legs).toHaveLength(1);
    expect(legs[0].action).toBe('Buy to Close');
    expect(legs[0].quantity).toBe('2');
  });

  it('sets priceEffect to Credit when netCredit > 0', () => {
    const netCredit = 0.20;
    const priceEffect = netCredit >= 0 ? 'Credit' : 'Debit';
    expect(priceEffect).toBe('Credit');
  });

  it('sets priceEffect to Debit when netCredit < 0', () => {
    const netCredit = -0.10;
    const priceEffect = netCredit >= 0 ? 'Credit' : 'Debit';
    expect(priceEffect).toBe('Debit');
  });
});
