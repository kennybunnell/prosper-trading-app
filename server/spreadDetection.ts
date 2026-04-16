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
 *
 * P&L FORMULA (matches routers-spread-analytics.ts classifyActiveSpreads):
 *   legPL = (currentMark - openPrice) * signedQty * 100
 *   totalPL = sum of all leg P&Ls
 *
 * This works because:
 *   - Short leg: signedQty = -1, openPrice = 0.45 (positive), mark = 0.05
 *     → (0.05 - 0.45) * -1 * 100 = +$40 profit (option decayed)
 *   - Long leg: signedQty = +1, openPrice = 0.20, mark = 0.01
 *     → (0.01 - 0.20) * +1 * 100 = -$19 (hedge cost)
 *   - Net = +$21 ✅
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
  /** Positive = long, negative = short (signed quantity from Tastytrade) */
  quantity: number;
  /** Average open price per share (always positive from Tastytrade) */
  openPrice: number;
  /** Current mark price per share (always positive) */
  markPrice: number;
  /** Account number this leg belongs to */
  accountNumber: string;
  /** True when markPrice is a stale close-price fallback (no live quote available) */
  isStale?: boolean;
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
  /** Net premium received when opening (sum of short credits - long debits), in dollars */
  openPremium: number;
  /** Net current value to close (sum of current mark prices × signed qty × 100), in dollars */
  currentValue: number;
  /** Unrealized P&L in dollars (positive = winning) */
  unrealizedPnl: number;
  /** Profit captured as % of max profit (can be negative for losers) */
  profitCaptured: number;
  /** Days to expiration */
  dte: number;
  /** True when any leg's mark price is a stale close-price fallback */
  hasStaleMarks?: boolean;

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
  // Use UTC dates throughout to avoid timezone-induced off-by-1-day errors.
  // new Date('2026-04-08') parses as UTC midnight; compare against today's UTC midnight.
  const expDate = new Date(expiration); // UTC midnight on expiry date
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = expDate.getTime() - todayUTC.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Calculate P&L for a single leg using the signed-quantity formula.
 * This matches the proven formula in routers-spread-analytics.ts:
 *   legPL = (currentMark - openPrice) * signedQty * 100
 *
 * For a short leg (signedQty = -1):
 *   If the option decays from 0.45 → 0.05: (0.05 - 0.45) * -1 * 100 = +$40 ✅
 * For a long leg (signedQty = +1):
 *   If the option decays from 0.20 → 0.01: (0.01 - 0.20) * +1 * 100 = -$19
 */
function legPnl(leg: RawOptionLeg): number {
  return (leg.markPrice - leg.openPrice) * leg.quantity * 100;
}

/**
 * Calculate the net premium received when opening (for % profit calculation).
 * For credit spreads: sum of (openPrice * |qty| * 100) for short legs
 *                   - sum of (openPrice * |qty| * 100) for long legs
 * This is always positive for a net-credit spread.
 */
function calcOpenPremium(legs: RawOptionLeg[]): number {
  return legs.reduce((sum, leg) => {
    // Short legs (negative qty) contributed a credit; long legs cost a debit
    // openPremium = credit_received - debit_paid = net credit
    const contribution = leg.openPrice * Math.abs(leg.quantity) * 100;
    return sum + (leg.quantity < 0 ? contribution : -contribution);
  }, 0);
}

/**
 * Calculate profit captured as % of max profit (openPremium).
 * - Positive = winning (option decayed toward zero)
 * - Negative = losing (option moved against us)
 * - 100% = full max profit captured
 */
function calcProfitCaptured(openPremium: number, unrealizedPnl: number): number {
  if (openPremium === 0) return 0;
  if (openPremium < 0) {
    // Debit spread: profit = gain above cost
    return (unrealizedPnl / Math.abs(openPremium)) * 100;
  }
  // Credit spread: profit % = unrealized gain / original credit
  return (unrealizedPnl / openPremium) * 100;
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

    const shortPuts  = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'PUT'  && l.quantity < 0);
    const longPuts   = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'PUT'  && l.quantity > 0);
    const shortCalls = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'CALL' && l.quantity < 0);
    const longCalls  = groupLegs.filter((l: RawOptionLeg) => l.optionType === 'CALL' && l.quantity > 0);

    const absQty = (l: RawOptionLeg) => Math.abs(l.quantity);

    // ── Iron Condor: 1 short put + 1 long put + 1 short call + 1 long call ──
    if (shortPuts.length >= 1 && longPuts.length >= 1 && shortCalls.length >= 1 && longCalls.length >= 1) {
      const sp = shortPuts[0], lp = longPuts[0], sc = shortCalls[0], lc = longCalls[0];
      const icLegs = [sp, lp, sc, lc];
      const openPremium = calcOpenPremium(icLegs);
      const unrealizedPnl = icLegs.reduce((sum, l) => sum + legPnl(l), 0);

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
        currentValue: openPremium - unrealizedPnl,
        unrealizedPnl,
        profitCaptured: calcProfitCaptured(openPremium, unrealizedPnl),
        dte,
        hasStaleMarks: icLegs.some(l => l.isStale),
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
      const bpsLegs = [sp, lp];
      const openPremium = calcOpenPremium(bpsLegs);
      const unrealizedPnl = bpsLegs.reduce((sum, l) => sum + legPnl(l), 0);
      const width = Math.abs(sp.strike - lp.strike);

      // DIAGNOSTIC: log raw values to trace P&L calculation
      console.log(`[BPS DIAG] ${underlying} exp=${expiration} qty=${absQty(sp)}`);
      console.log(`  short put: strike=${sp.strike} qty=${sp.quantity} openPrice=${sp.openPrice} markPrice=${sp.markPrice}`);
      console.log(`  long  put: strike=${lp.strike} qty=${lp.quantity} openPrice=${lp.openPrice} markPrice=${lp.markPrice}`);
      console.log(`  openPremium=$${openPremium.toFixed(2)} unrealizedPnl=$${unrealizedPnl.toFixed(2)} profitPct=${calcProfitCaptured(openPremium, unrealizedPnl).toFixed(1)}%`);

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
        currentValue: openPremium - unrealizedPnl,
        unrealizedPnl,
        profitCaptured: calcProfitCaptured(openPremium, unrealizedPnl),
        dte,
        hasStaleMarks: bpsLegs.some(l => l.isStale),
        shortStrike: sp.strike,
        longStrike: lp.strike,
        spreadWidth: width,
      });
      continue;
    }

    // ── BCS: 1 short call + 1 long call (short strike < long strike) ──
    if (shortCalls.length >= 1 && longCalls.length >= 1 && shortPuts.length === 0) {
      const sc = shortCalls[0], lc = longCalls[0];
      const bcsLegs = [sc, lc];
      const openPremium = calcOpenPremium(bcsLegs);
      const unrealizedPnl = bcsLegs.reduce((sum, l) => sum + legPnl(l), 0);
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
        currentValue: openPremium - unrealizedPnl,
        unrealizedPnl,
        profitCaptured: calcProfitCaptured(openPremium, unrealizedPnl),
        dte,
        hasStaleMarks: bcsLegs.some(l => l.isStale),
        shortStrike: sc.strike,
        longStrike: lc.strike,
        spreadWidth: width,
      });
      continue;
    }

    // ── Standalone CSP: short put(s) with no matching long put ──
    // Group by strike — multiple contracts at the same strike merge into one position
    // so we never generate duplicate IDs (e.g. 5x AAPL $150 CSP → one entry, qty=5).
    const cspByStrike = new Map<number, RawOptionLeg[]>();
    for (const sp of shortPuts) {
      if (!cspByStrike.has(sp.strike)) cspByStrike.set(sp.strike, []);
      cspByStrike.get(sp.strike)!.push(sp);
    }
    for (const [strike, cspLegs] of Array.from(cspByStrike.entries())) {
      const openPremium = cspLegs.reduce((sum, l) => sum + l.openPrice * Math.abs(l.quantity) * 100, 0);
      const unrealizedPnl = cspLegs.reduce((sum, l) => sum + legPnl(l), 0);
      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::CSP::${strike}`,
        underlying,
        expiration,
        strategyType: 'CSP',
        accountNumber,
        legs: cspLegs.map(l => ({ ...l, quantity: -Math.abs(l.quantity), role: 'short' as const })),
        openPremium,
        currentValue: openPremium - unrealizedPnl,
        unrealizedPnl,
        profitCaptured: calcProfitCaptured(openPremium, unrealizedPnl),
        dte,
        hasStaleMarks: cspLegs.some(l => l.isStale === true),
        shortStrike: strike,
      });
    }

    // ── Standalone CC: short call(s) with no matching long call ──
    // Group by strike — multiple contracts at the same strike merge into one position
    // so we never generate duplicate IDs (e.g. 5x QCOM $133 CC → one entry, qty=5).
    const ccByStrike = new Map<number, RawOptionLeg[]>();
    for (const sc of shortCalls) {
      if (!ccByStrike.has(sc.strike)) ccByStrike.set(sc.strike, []);
      ccByStrike.get(sc.strike)!.push(sc);
    }
    for (const [strike, ccLegs] of Array.from(ccByStrike.entries())) {
      const openPremium = ccLegs.reduce((sum, l) => sum + l.openPrice * Math.abs(l.quantity) * 100, 0);
      const unrealizedPnl = ccLegs.reduce((sum, l) => sum + legPnl(l), 0);
      spreads.push({
        id: `${accountNumber}::${underlying}::${expiration}::CC::${strike}`,
        underlying,
        expiration,
        strategyType: 'CC',
        accountNumber,
        legs: ccLegs.map(l => ({ ...l, quantity: -Math.abs(l.quantity), role: 'short' as const })),
        openPremium,
        currentValue: openPremium - unrealizedPnl,
        unrealizedPnl,
        profitCaptured: calcProfitCaptured(openPremium, unrealizedPnl),
        dte,
        hasStaleMarks: ccLegs.some(l => l.isStale === true),
        shortStrike: strike,
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
  const dateStr = expParts[0].slice(2) + expParts[1] + expParts[2]; // YYMMDD
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${underlying}${dateStr}${optionType}${strikeStr}`;
}

/**
 * Build an atomic roll order for a spread position.
 * Returns a multi-leg order that BTCs all existing legs and STOs new legs.
 */
export function buildSpreadRollOrder(
  spread: SpreadPosition,
  newExpiration: string,
  newShortStrike: number,
  newLongStrike?: number,
  rollCredit?: number
): SpreadRollOrder {
  const legs: SpreadRollOrder['legs'] = [];

  // BTC existing legs
  for (const leg of spread.legs) {
    const optType = leg.optionType === 'PUT' ? 'P' : 'C';
    const symbol = buildOCCSymbol(spread.underlying, spread.expiration, optType, leg.strike);
    legs.push({
      symbol,
      action: 'Buy to Close',
      quantity: String(Math.abs(leg.quantity)),
      instrumentType: 'Equity Option',
    });
  }

  // STO new legs based on strategy
  const qty = String(Math.abs(spread.legs[0].quantity));

  if (spread.strategyType === 'CSP') {
    const symbol = buildOCCSymbol(spread.underlying, newExpiration, 'P', newShortStrike);
    legs.push({ symbol, action: 'Sell to Open', quantity: qty, instrumentType: 'Equity Option' });
  } else if (spread.strategyType === 'CC') {
    const symbol = buildOCCSymbol(spread.underlying, newExpiration, 'C', newShortStrike);
    legs.push({ symbol, action: 'Sell to Open', quantity: qty, instrumentType: 'Equity Option' });
  } else if (spread.strategyType === 'BPS') {
    const shortSymbol = buildOCCSymbol(spread.underlying, newExpiration, 'P', newShortStrike);
    const longSymbol  = buildOCCSymbol(spread.underlying, newExpiration, 'P', newLongStrike ?? (newShortStrike - (spread.spreadWidth ?? 5)));
    legs.push({ symbol: shortSymbol, action: 'Sell to Open', quantity: qty, instrumentType: 'Equity Option' });
    legs.push({ symbol: longSymbol,  action: 'Buy to Close', quantity: qty, instrumentType: 'Equity Option' });
  } else if (spread.strategyType === 'BCS') {
    const shortSymbol = buildOCCSymbol(spread.underlying, newExpiration, 'C', newShortStrike);
    const longSymbol  = buildOCCSymbol(spread.underlying, newExpiration, 'C', newLongStrike ?? (newShortStrike + (spread.spreadWidth ?? 5)));
    legs.push({ symbol: shortSymbol, action: 'Sell to Open', quantity: qty, instrumentType: 'Equity Option' });
    legs.push({ symbol: longSymbol,  action: 'Buy to Close', quantity: qty, instrumentType: 'Equity Option' });
  } else if (spread.strategyType === 'IC') {
    // Roll both sides
    const putShort  = buildOCCSymbol(spread.underlying, newExpiration, 'P', newShortStrike);
    const putLong   = buildOCCSymbol(spread.underlying, newExpiration, 'P', newLongStrike ?? (newShortStrike - 5));
    const callShort = buildOCCSymbol(spread.underlying, newExpiration, 'C', newShortStrike + 10);
    const callLong  = buildOCCSymbol(spread.underlying, newExpiration, 'C', newShortStrike + 15);
    legs.push({ symbol: putShort,  action: 'Sell to Open', quantity: qty, instrumentType: 'Equity Option' });
    legs.push({ symbol: putLong,   action: 'Buy to Close', quantity: qty, instrumentType: 'Equity Option' });
    legs.push({ symbol: callShort, action: 'Sell to Open', quantity: qty, instrumentType: 'Equity Option' });
    legs.push({ symbol: callLong,  action: 'Buy to Close', quantity: qty, instrumentType: 'Equity Option' });
  }

  const credit = rollCredit ?? 0.05;
  return {
    accountNumber: spread.accountNumber,
    underlying: spread.underlying,
    strategyType: spread.strategyType,
    legs,
    price: credit.toFixed(2),
    priceEffect: credit >= 0 ? 'Credit' : 'Debit',
    description: `Roll ${spread.strategyType} ${spread.underlying} ${spread.expiration} → ${newExpiration}`,
  };
}
