/**
 * Spread Strategy Detection
 *
 * Groups individual option legs from Tastytrade positions into named spread strategies:
 *   - CSP  : single short PUT (naked / cash-secured)
 *   - CC   : single short CALL (covered call)
 *   - BPS  : Bull Put Spread  — short PUT + long PUT, same expiry, short strike > long strike
 *   - BCS  : Bear Call Spread — short CALL + long CALL, same expiry, short strike < long strike
 *   - IC   : Iron Condor      — BPS + BCS on same underlying, same expiry
 *
 * All multi-leg strategies are returned as a single SpreadPosition so the roll
 * engine can construct an atomic order (BTC all legs + STO new legs in one request).
 */

export type StrategyType = 'CSP' | 'CC' | 'BPS' | 'BCS' | 'IC';

export interface RawOptionLeg {
  /** Full Tastytrade OCC symbol, e.g. "AAPL  250117P00150000" */
  symbol: string;
  /** Underlying ticker, e.g. "AAPL" */
  underlying: string;
  /** "PUT" | "CALL" */
  optionType: 'PUT' | 'CALL';
  /** Strike price as a number */
  strike: number;
  /** Expiration date string YYYY-MM-DD */
  expiration: string;
  /** Positive = long, negative = short */
  quantity: number;
  /** Average open price per share (not multiplied by 100) */
  openPrice: number;
  /** Current mark price per share */
  markPrice: number;
  /** Account number this leg belongs to */
  accountNumber: string;
}

export interface SpreadLeg {
  symbol: string;
  underlying: string;
  optionType: 'PUT' | 'CALL';
  strike: number;
  expiration: string;
  quantity: number; // positive = long, negative = short
  openPrice: number;
  markPrice: number;
  role: 'short' | 'long';
}

export interface SpreadPosition {
  /** Unique key: underlying + expiry + strategyType */
  id: string;
  underlying: string;
  expiration: string;
  strategyType: StrategyType;
  accountNumber: string;
  legs: SpreadLeg[];

  // Aggregated metrics
  /** Net premium received when opening (sum of short credits - long debits) */
  openPremium: number;
  /** Net current value to close (sum of current mark prices) */
  currentValue: number;
  /** Profit captured as % of max profit */
  profitCaptured: number;
  /** Days to expiration */
  dte: number;

  // For spreads: short and long strikes
  shortStrike?: number;
  longStrike?: number;
  /** Spread width (|shortStrike - longStrike|) */
  spreadWidth?: number;
  /** For IC: put spread short/long + call spread short/long */
  putShortStrike?: number;
  putLongStrike?: number;
  callShortStrike?: number;
  callLongStrike?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcDTE(expiration: string): number {
  const expDate = new Date(expiration);
  const today = new Date();
  const diffMs = expDate.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function calcProfitCaptured(openPremium: number, currentValue: number): number {
  // For credit spreads: openPremium > 0 (net credit received)
  // profitCaptured = how much of the original credit has decayed away
  // Positive = winning (option decayed), Negative = losing (option moved against us)
  // No clamping — show the real number including negative values
  if (openPremium <= 0) {
    // Debit spread or inverted: use currentValue as reference
    // If currentValue < openPremium (both negative), we're losing on a debit spread
    if (openPremium === 0) return 0;
    // For debit spreads: profit = (currentValue - openPremium) / Math.abs(openPremium) * 100
    return ((currentValue - openPremium) / Math.abs(openPremium)) * 100;
  }
  // Normal credit spread: (credit_received - cost_to_close) / credit_received * 100
  return ((openPremium - currentValue) / openPremium) * 100;
}

/** Group key: underlying + expiry (used to find matching legs for spreads) */
function groupKey(underlying: string, expiration: string): string {
  return `${underlying}::${expiration}`;
}

// ─── Main Detection Function ──────────────────────────────────────────────────

/**
 * Takes a flat list of raw option legs (from all accounts) and returns
 * a list of SpreadPosition objects, one per logical strategy.
 *
 * Algorithm:
 * 1. Group legs by (accountNumber, underlying, expiration)
 * 2. Within each group, classify:
 *    - 1 short PUT only → CSP
 *    - 1 short CALL only → CC
 *    - 1 short PUT + 1 long PUT → BPS
 *    - 1 short CALL + 1 long CALL → BCS
 *    - 1 short PUT + 1 long PUT + 1 short CALL + 1 long CALL → IC
 *    - Anything else → treat each short leg as standalone CSP/CC
 */
export function detectSpreadStrategies(legs: RawOptionLeg[]): SpreadPosition[] {
  const multiplier = 100;

  // Group by account + underlying + expiration
  const groups = new Map<string, RawOptionLeg[]>();
  for (const leg of legs) {
    const key = `${leg.accountNumber}::${leg.underlying}::${leg.expiration}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(leg);
  }

  const spreads: SpreadPosition[] = [];

  for (const [key, groupLegs] of Array.from(groups.entries())) {
    const [accountNumber, underlying, expiration] = key.split('::');
    const dte = calcDTE(expiration);

      const shortPuts = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'PUT' && l.quantity < 0);
      const longPuts  = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'PUT' && l.quantity > 0);
      const shortCalls = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'CALL' && l.quantity < 0);
      const longCalls  = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'CALL' && l.quantity > 0);

    const absQty = (l: RawOptionLeg) => Math.abs(l.quantity);

    // ── Iron Condor: 1 short put + 1 long put + 1 short call + 1 long call ──
    if (shortPuts.length >= 1 && longPuts.length >= 1 && shortCalls.length >= 1 && longCalls.length >= 1) {
      const sp = shortPuts[0], lp = longPuts[0], sc = shortCalls[0], lc = longCalls[0];
      const qty = absQty(sp);

      // Net premium: credits from shorts - debits for longs
      const openPremium = (sp.openPrice + sc.openPrice - lp.openPrice - lc.openPrice) * qty * multiplier;
      const currentValue = (sp.markPrice + sc.markPrice - lp.markPrice - lc.markPrice) * qty * multiplier;

      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::IC`,
        underlying,
        expiration,
        strategyType: 'IC',
        accountNumber,
        legs: [
          { ...sp, role: 'short' },
          { ...lp, role: 'long' },
          { ...sc, role: 'short' },
          { ...lc, role: 'long' },
        ],
        openPremium,
        currentValue,
        profitCaptured: calcProfitCaptured(openPremium, currentValue),
        dte,
        putShortStrike: sp.strike,
        putLongStrike: lp.strike,
        callShortStrike: sc.strike,
        callLongStrike: lc.strike,
      });
      continue;
    }

    // ── BPS: 1 short put + 1 long put (short strike > long strike) ──
    if (shortPuts.length >= 1 && longPuts.length >= 1 && shortCalls.length === 0) {
      const sp = shortPuts[0], lp = longPuts[0];
      const qty = absQty(sp);
      const openPremium = (sp.openPrice - lp.openPrice) * qty * multiplier;
      const currentValue = (sp.markPrice - lp.markPrice) * qty * multiplier;
      const width = Math.abs(sp.strike - lp.strike);

      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::BPS`,
        underlying,
        expiration,
        strategyType: 'BPS',
        accountNumber,
        legs: [
          { ...sp, role: 'short' },
          { ...lp, role: 'long' },
        ],
        openPremium,
        currentValue,
        profitCaptured: calcProfitCaptured(openPremium, currentValue),
        dte,
        shortStrike: sp.strike,
        longStrike: lp.strike,
        spreadWidth: width,
      });
      continue;
    }

    // ── BCS: 1 short call + 1 long call (short strike < long strike) ──
    if (shortCalls.length >= 1 && longCalls.length >= 1 && shortPuts.length === 0) {
      const sc = shortCalls[0], lc = longCalls[0];
      const qty = absQty(sc);
      const openPremium = (sc.openPrice - lc.openPrice) * qty * multiplier;
      const currentValue = (sc.markPrice - lc.markPrice) * qty * multiplier;
      const width = Math.abs(sc.strike - lc.strike);

      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::BCS`,
        underlying,
        expiration,
        strategyType: 'BCS',
        accountNumber,
        legs: [
          { ...sc, role: 'short' },
          { ...lc, role: 'long' },
        ],
        openPremium,
        currentValue,
        profitCaptured: calcProfitCaptured(openPremium, currentValue),
        dte,
        shortStrike: sc.strike,
        longStrike: lc.strike,
        spreadWidth: width,
      });
      continue;
    }

    // ── Standalone CSP: short put(s) with no matching long put ──
    for (const sp of shortPuts) {
      const qty = absQty(sp);
      const openPremium = sp.openPrice * qty * multiplier;
      const currentValue = sp.markPrice * qty * multiplier;
      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::CSP::${sp.strike}`,
        underlying,
        expiration,
        strategyType: 'CSP',
        accountNumber,
        legs: [{ ...sp, role: 'short' }],
        openPremium,
        currentValue,
        profitCaptured: calcProfitCaptured(openPremium, currentValue),
        dte,
        shortStrike: sp.strike,
      });
    }

    // ── Standalone CC: short call(s) with no matching long call ──
    for (const sc of shortCalls) {
      const qty = absQty(sc);
      const openPremium = sc.openPrice * qty * multiplier;
      const currentValue = sc.markPrice * qty * multiplier;
      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::CC::${sc.strike}`,
        underlying,
        expiration,
        strategyType: 'CC',
        accountNumber,
        legs: [{ ...sc, role: 'short' }],
        openPremium,
        currentValue,
        profitCaptured: calcProfitCaptured(openPremium, currentValue),
        dte,
        shortStrike: sc.strike,
      });
    }
  }

  return spreads;
}

// ─── Roll Order Builder ───────────────────────────────────────────────────────

export interface SpreadRollOrder {
  accountNumber: string;
  underlying: string;
  strategyType: StrategyType;
  /** All legs for the roll order (BTC existing + STO new) */
  legs: Array<{
    symbol: string;
    action: 'Buy to Close' | 'Sell to Open';
    quantity: string;
    instrumentType: 'Equity Option';
  }>;
  price: string;
  priceEffect: 'Credit' | 'Debit';
  /** Human-readable description of the roll */
  description: string;
}

function buildOCCSymbol(underlying: string, expiration: string, optionType: 'C' | 'P', strike: number): string {
  const expParts = expiration.split('-');
  const dateStr = expParts[0].slice(2) + expParts[1] + expParts[2];
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${underlying}${dateStr}${optionType}${strikeStr}`;
}

/**
 * Build the legs for an atomic roll order for a spread position.
 *
 * For BPS roll: BTC short put + BTC long put + STO new short put + STO new long put
 * For BCS roll: BTC short call + BTC long call + STO new short call + STO new long call
 * For IC roll:  BTC all 4 legs + STO 4 new legs
 * For CSP/CC:   BTC current + STO new (same as before)
 *
 * @param spread       The existing spread position to roll
 * @param newExpiration New expiration date YYYY-MM-DD
 * @param newShortStrike New short strike (for BPS/BCS/CSP/CC); same width maintained for spreads
 * @param netCredit    Expected net credit (positive) or debit (negative) for the whole roll
 */
export function buildSpreadRollOrder(
  spread: SpreadPosition,
  newExpiration: string,
  newShortStrike: number,
  netCredit: number,
): SpreadRollOrder {
  const legs: SpreadRollOrder['legs'] = [];
  const qty = Math.abs(spread.legs[0].quantity);

  switch (spread.strategyType) {
    case 'CSP': {
      const shortLeg = spread.legs[0];
      // BTC existing
      legs.push({ symbol: shortLeg.symbol, action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      // STO new
      const newSym = buildOCCSymbol(spread.underlying, newExpiration, 'P', newShortStrike);
      legs.push({ symbol: newSym, action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      break;
    }
    case 'CC': {
      const shortLeg = spread.legs[0];
      legs.push({ symbol: shortLeg.symbol, action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      const newSym = buildOCCSymbol(spread.underlying, newExpiration, 'C', newShortStrike);
      legs.push({ symbol: newSym, action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      break;
    }
    case 'BPS': {
      const shortLeg = spread.legs.find(l => l.role === 'short')!;
      const longLeg  = spread.legs.find(l => l.role === 'long')!;
      const width = spread.spreadWidth || Math.abs(shortLeg.strike - longLeg.strike);
      const newLongStrike = newShortStrike - width;
      // BTC existing legs
      legs.push({ symbol: shortLeg.symbol, action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: longLeg.symbol,  action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      // STO new legs
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'P', newShortStrike), action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'P', newLongStrike),  action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      break;
    }
    case 'BCS': {
      const shortLeg = spread.legs.find(l => l.role === 'short')!;
      const longLeg  = spread.legs.find(l => l.role === 'long')!;
      const width = spread.spreadWidth || Math.abs(shortLeg.strike - longLeg.strike);
      const newLongStrike = newShortStrike + width;
      legs.push({ symbol: shortLeg.symbol, action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: longLeg.symbol,  action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'C', newShortStrike), action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'C', newLongStrike),  action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      break;
    }
    case 'IC': {
      // Put spread legs
      const putShort = spread.legs.find(l => l.optionType === 'PUT'  && l.role === 'short')!;
      const putLong  = spread.legs.find(l => l.optionType === 'PUT'  && l.role === 'long')!;
      const callShort = spread.legs.find(l => l.optionType === 'CALL' && l.role === 'short')!;
      const callLong  = spread.legs.find(l => l.optionType === 'CALL' && l.role === 'long')!;
      const putWidth  = Math.abs(putShort.strike  - putLong.strike);
      const callWidth = Math.abs(callShort.strike - callLong.strike);
      // newShortStrike is the new put short strike; call short strike mirrors it symmetrically
      const newPutLong   = newShortStrike - putWidth;
      // For IC, call short is typically ATM + same offset as put short is ATM - offset
      // We keep the same distance from ATM; caller should provide newCallShortStrike separately
      // For now, use the same offset from ATM as the original
      const putOffset  = spread.putShortStrike ? spread.putShortStrike  : newShortStrike;
      const callOffset = spread.callShortStrike ? spread.callShortStrike : newShortStrike;
      const strikeGap = callOffset - putOffset; // gap between put short and call short
      const newCallShort = newShortStrike + strikeGap;
      const newCallLong  = newCallShort + callWidth;
      // BTC all 4 existing legs
      legs.push({ symbol: putShort.symbol,  action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: putLong.symbol,   action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: callShort.symbol, action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: callLong.symbol,  action: 'Buy to Close', quantity: String(qty), instrumentType: 'Equity Option' });
      // STO 4 new legs
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'P', newShortStrike), action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'P', newPutLong),     action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'C', newCallShort),   action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      legs.push({ symbol: buildOCCSymbol(spread.underlying, newExpiration, 'C', newCallLong),    action: 'Sell to Open', quantity: String(qty), instrumentType: 'Equity Option' });
      break;
    }
  }

  const absPrice = Math.abs(netCredit);
  const priceEffect: 'Credit' | 'Debit' = netCredit >= 0 ? 'Credit' : 'Debit';

  const strategyLabels: Record<StrategyType, string> = {
    CSP: 'CSP', CC: 'CC', BPS: 'Bull Put Spread', BCS: 'Bear Call Spread', IC: 'Iron Condor',
  };

  return {
    accountNumber: spread.accountNumber,
    underlying: spread.underlying,
    strategyType: spread.strategyType,
    legs,
    price: absPrice.toFixed(2),
    priceEffect,
    description: `Roll ${strategyLabels[spread.strategyType]} ${spread.underlying} → ${newExpiration} @ ${netCredit >= 0 ? '+' : ''}$${netCredit.toFixed(2)} net ${priceEffect.toLowerCase()}`,
  };
}
