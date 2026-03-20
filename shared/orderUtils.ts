/**
 * Shared Order Utilities
 * 
 * Centralized functions for order price formatting, validation, and submission
 * to ensure consistency across CSP, CC, PMCC, and Working Orders dashboards.
 *
 * IMPORTANT — Floating-point safety:
 * JavaScript's IEEE 754 representation means that values like 3.15 are stored
 * internally as 3.14999999999999982236... When Tastytrade's server checks
 * `price % 0.05` it gets a non-zero remainder and rejects the order with
 * "Price must be in increments of $0.05".
 *
 * The fix: ALL rounding uses integer arithmetic — multiply by 100 first,
 * round to an integer, snap to the nearest valid tick (5 for nickel, 1 for
 * penny), then divide back. This completely avoids floating-point drift.
 *
 * Tastytrade tick-size rules (equity options):
 *   Price < $3.00  → $0.01 increments (penny pilot program)
 *   Price >= $3.00 → $0.05 increments (nickel)
 * Exceptions (always penny regardless of price):
 *   SPY, QQQ, IWM
 */

/** Symbols that always trade in $0.01 penny increments regardless of price */
const PENNY_PILOT_SYMBOLS = new Set(['SPY', 'QQQ', 'IWM']);

/**
 * True cash-settled index options — always $0.05 increments regardless of price.
 * These are NOT ETFs; they are cash-settled European-style index options.
 * Tastytrade requires instrumentType = 'Index Option' for these symbols.
 *
 * Note: ETF proxies (SPY, QQQ, IWM) are excluded — they use the penny-pilot rule above.
 */
export const TRUE_INDEX_OPTION_SYMBOLS = new Set([
  // S&P 500 family (cash-settled)
  'SPX', 'SPXW', 'SPXPM', 'XSP', 'NANOS',
  // Nasdaq-100 family (cash-settled)
  'NDX', 'NDXP', 'XND',
  // Russell 2000 family (cash-settled)
  'RUT', 'MRUT',
  // Dow Jones (cash-settled)
  'DJX',
  // Volatility indexes (cash-settled)
  'VIX', 'VIXW',
  // S&P 100 (cash-settled)
  'OEX', 'XEO',
]);

/**
 * Large-cap index options that require $0.10 increments when price >= $3.00.
 * Tastytrade rejects prices not in $0.10 steps for these high-priced index options.
 * Below $3.00 they use $0.05 increments.
 *
 * Tastytrade rule: SPX/SPXW/NDX/RUT options >= $3.00 → $0.10 increments
 *                  SPX/SPXW/NDX/RUT options < $3.00  → $0.05 increments
 */
const DIME_INDEX_SYMBOLS = new Set(['SPX', 'SPXW', 'SPXPM', 'NDX', 'NDXP', 'RUT', 'MRUT', 'DJX']);

/**
 * Returns true if the symbol is a true cash-settled index option.
 * Tastytrade REQUIRES 'Index Option' as the instrument type for these symbols in order submission.
 * Using 'Equity Option' for SPX/SPXW/NDX/NDXP/RUT/MRUT/DJX causes
 * Order_disallowed_by_exchange_rules rejection from CBOE.
 * This function is used for:
 * - Instrument type selection in order submission ('Index Option' vs 'Equity Option')
 * - Tick-size calculation ($0.10 for index options >= $3.00, $0.05 otherwise)
 * - Position filtering (TT positions API returns 'Index Option' for these symbols)
 */
export function isTrueIndexOption(symbol: string): boolean {
  return TRUE_INDEX_OPTION_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Returns the correct tick size for a given price and optional symbol.
 * - SPX/SPXW/NDX/RUT family >= $3.00 → $0.10 (Tastytrade dime rule for large index options)
 * - SPX/SPXW/NDX/RUT family < $3.00  → $0.05
 * - Other true index options (XSP, VIX, OEX, etc.) → $0.05
 * - SPY, QQQ, IWM (penny pilot ETFs) → $0.01
 * - Price >= $3.00 → $0.05
 * - Price < $3.00  → $0.01
 */
export function getTickSize(price: number, symbol?: string): 0.01 | 0.05 | 0.10 {
  if (symbol) {
    const sym = symbol.toUpperCase();
    if (PENNY_PILOT_SYMBOLS.has(sym)) return 0.01;
    // Large-cap index options: $0.10 when >= $3, $0.05 when < $3
    if (DIME_INDEX_SYMBOLS.has(sym)) return price >= 3.00 ? 0.10 : 0.05;
    // Other true index options: always $0.05
    if (isTrueIndexOption(sym)) return 0.05;
  }
  return price >= 3.00 ? 0.05 : 0.01;
}

/**
 * Snap a price to the nearest valid Tastytrade tick using integer arithmetic.
 * This is the single source of truth for all price rounding in the app.
 *
 * @param price  - Raw price (may have floating-point noise)
 * @param symbol - Optional underlying symbol (for penny-pilot exceptions)
 * @returns      - Price snapped to the correct tick, free of FP errors
 *
 * @example
 * snapToTick(3.15)   // 3.15  (nickel — 63 × $0.05)
 * snapToTick(3.1499) // 3.15  (rounds to nearest nickel)
 * snapToTick(0.476)  // 0.48  (penny)
 * snapToTick(3.15, 'SPY') // 3.15 (penny pilot — unchanged)
 */
export function snapToTick(price: number, symbol?: string): number {
  const safe = Math.max(0.01, price);
  const tick = getTickSize(safe, symbol);
  if (tick === 0.10) {
    // Dime: work in units of $0.01, snap to nearest 10 cents
    // e.g. 6.95 → 695 cents → round to nearest 10 → 700 → $7.00
    // e.g. 6.94 → 694 cents → round to nearest 10 → 690 → $6.90
    const cents = Math.round(safe * 100);
    const snapped = Math.round(cents / 10) * 10;
    return snapped / 100;
  } else if (tick === 0.05) {
    // Nickel: work in units of $0.01, snap to nearest 5 cents
    const cents = Math.round(safe * 100); // e.g. 3.15 → 315 (exact integer)
    const snapped = Math.round(cents / 5) * 5;  // nearest multiple of 5
    return snapped / 100;
  } else {
    // Penny: just round to nearest cent
    return Math.round(safe * 100) / 100;
  }
}

/**
 * Round price to nearest $0.01 (penny) — legacy helper, kept for compatibility.
 */
export function roundToPenny(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * Round price to nearest $0.05 (nickel) — legacy helper, kept for compatibility.
 * NOTE: Use snapToTick() for submission-critical paths to avoid FP errors.
 */
export function roundToNickel(price: number): number {
  const cents = Math.round(price * 100);
  return (Math.round(cents / 5) * 5) / 100;
}

/**
 * Format price for Tastytrade API submission.
 * Uses integer arithmetic to avoid floating-point precision errors.
 *
 * @param price  - The price to format
 * @param symbol - Optional underlying symbol (for penny-pilot exceptions)
 * @returns      - Formatted price string (e.g. "3.85", "0.47")
 */
export function formatPriceForSubmission(price: number, symbol?: string): string {
  return snapToTick(price, symbol).toFixed(2);
}

/**
 * Calculate suggested fill price based on spread width and time working.
 * Result is snapped to the correct tick for the given price level.
 *
 * @param bid                - Current bid price
 * @param ask                - Current ask price
 * @param timeWorkingMinutes - How long the order has been working (optional)
 * @param aggressive         - Use aggressive pricing to prioritize fills (optional)
 * @param symbol             - Underlying symbol for penny-pilot check (optional)
 * @returns Suggested price snapped to the correct tick
 */
export function calculateSuggestedPrice(
  bid: number,
  ask: number,
  timeWorkingMinutes: number = 0,
  aggressive: boolean = false,
  symbol?: string
): number {
  if (!bid || !ask || bid <= 0 || ask <= 0) {
    return 0;
  }

  const spread = ask - bid;
  const mid = (bid + ask) / 2;
  let suggested: number;

  // Determine strategy based on spread width
  if (spread <= 0.05) {
    suggested = mid;
  } else if (spread <= 0.15) {
    suggested = mid - 0.01;
  } else if (spread <= 0.30) {
    suggested = bid + (spread * 0.60);
  } else {
    suggested = bid + (spread * 0.50);
  }

  // Adjust for time working (lower price to increase fill probability)
  if (timeWorkingMinutes > 60) {
    const adjustment = Math.min(0.03, spread * 0.10);
    suggested = Math.max(bid + 0.01, suggested - adjustment);
  } else if (timeWorkingMinutes > 30) {
    const adjustment = Math.min(0.02, spread * 0.05);
    suggested = Math.max(bid + 0.01, suggested - adjustment);
  }

  // Aggressive mode — lower by additional $0.01–0.02
  if (aggressive) {
    const aggressiveAdjustment = spread > 0.10 ? 0.02 : 0.01;
    suggested = Math.max(bid + 0.01, suggested - aggressiveAdjustment);
  }

  // Ensure suggested price is at least bid
  suggested = Math.max(bid, suggested);

  // Snap to correct tick (integer arithmetic)
  return snapToTick(suggested, symbol);
}

/**
 * Helper: returns true if the given UTC date is the 3rd Friday of its month.
 * The 3rd Friday always falls between the 15th and 21st.
 */
function isThirdFriday(expDate: Date): boolean {
  return expDate.getUTCDay() === 5 && expDate.getUTCDate() >= 15 && expDate.getUTCDate() <= 21;
}

/**
 * Determine the correct OCC root ticker for an option symbol when submitting to Tastytrade.
 *
 * Several major indexes use DIFFERENT root tickers depending on expiration type:
 *
 *   SPX  → monthly (3rd Friday AM-settled) = 'SPX'
 *          weekly/daily/EOM (all other expirations, PM-settled) = 'SPXW'
 *
 *   NDX  → monthly (3rd Friday AM-settled) = 'NDX'
 *          weekly/daily/quarterly (PM-settled) = 'NDXP'
 *
 *   RUT  → monthly (3rd Friday AM-settled) = 'RUT'
 *          weekly (PM-settled) = 'RUTW'
 *
 *   MRUT → single root 'MRUT' for all expirations (no weekly variant)
 *   DJX  → single root 'DJX' for all expirations (weeklys are AM-settled)
 *   XSP  → single root 'XSP' for all expirations
 *   XND  → single root 'XND' for all expirations
 *   SPXW → already the weekly root, use as-is
 *   NDXP → already the weekly root, use as-is
 *
 * @param symbol     - Watchlist symbol (e.g., 'SPX', 'NDX', 'RUT', 'AAPL')
 * @param expiration - Expiration date in YYYY-MM-DD format
 * @returns The correct OCC root ticker to use in the option symbol string
 */
export function getOccRoot(symbol: string, expiration: string): string {
  const sym = symbol.toUpperCase();
  const expDate = new Date(expiration + 'T12:00:00Z');
  const dow = expDate.getUTCDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

  switch (sym) {
    case 'SPX':
      // Monthly AM-settled: 3rd Friday only → 'SPX'
      // All other expirations (Mon/Wed/Thu/non-3rd-Fri) → 'SPXW'
      return isThirdFriday(expDate) ? 'SPX' : 'SPXW';

    case 'NDX':
      // Monthly AM-settled: 3rd Friday only → 'NDX'
      // All other expirations (weekly/daily/quarterly PM-settled) → 'NDXP'
      return isThirdFriday(expDate) ? 'NDX' : 'NDXP';

    case 'RUT':
      // Monthly AM-settled: 3rd Friday only → 'RUT'
      // Weekly PM-settled (all other Fridays) → 'RUTW'
      return isThirdFriday(expDate) ? 'RUT' : 'RUTW';

    // These are already the correct OCC roots — use as-is
    case 'SPXW':
    case 'NDXP':
    case 'RUTW':
    case 'MRUT':  // Single root, no weekly variant
    case 'DJX':   // Single root, AM-settled weeklys use same DJX root
    case 'XSP':   // Mini-SPX, single root for all expirations
    case 'XND':   // Micro-NDX, single root for all expirations
    default:
      return sym;
  }
}

/**
 * Build Tastytrade option symbol in OCC format
 * Format: TICKER(6)YYMMDD(6)P/C(1)STRIKE(8)
 *
 * @param symbol     - Underlying symbol (e.g., 'AAPL')
 * @param expiration - Expiration date in YYYY-MM-DD format
 * @param optionType - 'P' for Put or 'C' for Call
 * @param strike     - Strike price
 * @returns Formatted option symbol
 *
 * @example
 * buildOptionSymbol('AAPL', '2026-02-06', 'P', 150)
 * // Returns: 'AAPL  260206P00150000'
 */
export function buildOptionSymbol(
  symbol: string,
  expiration: string,
  optionType: 'P' | 'C',
  strike: number
): string {
  const symbolPadded = symbol.padEnd(6, ' ');
  const expFormatted = expiration.replace(/-/g, ''); // YYYYMMDD
  const expShort = expFormatted.substring(2); // YYMMDD
  const strikeFormatted = (strike * 1000).toString().padStart(8, '0');
  return `${symbolPadded}${expShort}${optionType}${strikeFormatted}`;
}

/**
 * Validate order price against bid/ask spread and tick-size rules.
 *
 * @param price  - The order price to validate
 * @param bid    - Current bid price
 * @param ask    - Current ask price
 * @param symbol - Optional underlying symbol for penny-pilot check
 * @returns Validation result with isValid flag and message
 */
export function validateOrderPrice(
  price: number,
  bid: number,
  ask: number,
  symbol?: string
): { isValid: boolean; message: string } {
  if (price < bid) {
    return {
      isValid: false,
      message: `Price $${price.toFixed(2)} is below bid $${bid.toFixed(2)}`
    };
  }

  if (price > ask) {
    return {
      isValid: false,
      message: `Price $${price.toFixed(2)} is above ask $${ask.toFixed(2)}`
    };
  }

  // Check tick-size conformance using integer arithmetic
  const snapped = snapToTick(price, symbol);
  if (Math.abs(price - snapped) > 0.001) {
    const tick = getTickSize(price, symbol);
    const increment = tick === 0.10 ? '$0.10' : tick === 0.05 ? '$0.05' : '$0.01';
    return {
      isValid: false,
      message: `Price must be in ${increment} increments (suggested: $${snapped.toFixed(2)})`
    };
  }

  return {
    isValid: true,
    message: 'Price is valid'
  };
}

/**
 * Mini-index options that have a contract multiplier of 10 (not the standard 100).
 * MRUT = Mini-RUT (Russell 2000 mini), XSP = Mini-SPX, XND = Mini-NDX, DJX = Dow Jones mini.
 */
const MINI_INDEX_SYMBOLS = new Set(['MRUT', 'XSP', 'XND', 'DJX']);

/**
 * Returns the contract multiplier for an option on the given underlying symbol.
 * Standard options: 100 (each contract controls 100 shares / $100 per point).
 * Mini-index options (MRUT, XSP, XND, DJX): 10 ($10 per point).
 */
export function getContractMultiplier(symbol: string): number {
  return MINI_INDEX_SYMBOLS.has(symbol.toUpperCase()) ? 10 : 100;
}

/**
 * Exchange classification for index options.
 * CBOE-listed: SPX, SPXW, SPXPM, XSP, RUT, MRUT, DJX, VIX, VIXW, OEX, XEO
 * Nasdaq-listed: NDX, NDXP, XND
 *
 * IMPORTANT: CBOE Multi-Class Spread Orders (Rule 5.6(c)) only allow combining
 * index classes that are BOTH listed on CBOE. NDXP/NDX/XND are Nasdaq-listed
 * and CANNOT be combined with CBOE-listed products in a single multi-class spread.
 * Each must be submitted as a completely separate, independent order.
 */
const NASDAQ_INDEX_SYMBOLS = new Set(['NDX', 'NDXP', 'XND']);
const CBOE_INDEX_SYMBOLS = new Set([
  'SPX', 'SPXW', 'SPXPM', 'XSP', 'NANOS',
  'RUT', 'RUTW', 'MRUT',
  'DJX',
  'VIX', 'VIXW',
  'OEX', 'XEO',
]);

export type IndexExchange = 'CBOE' | 'Nasdaq' | 'Equity';

/**
 * Returns the primary exchange for an index option symbol.
 * Returns 'Equity' for non-index symbols.
 */
export function getIndexExchange(symbol: string): IndexExchange {
  const upper = symbol.toUpperCase();
  if (NASDAQ_INDEX_SYMBOLS.has(upper)) return 'Nasdaq';
  if (CBOE_INDEX_SYMBOLS.has(upper)) return 'CBOE';
  return 'Equity';
}

/**
 * Minimum recommended spread width (in points) for each index.
 * These are exchange-standard intervals and the minimum that makes
 * economic sense given the contract multiplier.
 *
 * - MRUT: 5 pts (10x multiplier → $50/pt → $250 min collateral per contract)
 * - XSP:  1 pt  (100x multiplier → $100/pt → $100 min collateral per contract)
 * - SPX/SPXW: 5 pts (100x → $500/pt → $2,500 min collateral per contract)
 * - NDX/NDXP: 25 pts (100x → $2,500/pt → $62,500 min collateral per contract)
 * - RUT/RUTW: 5 pts (100x → $500/pt → $2,500 min collateral per contract)
 * - DJX: 1 pt (100x → $100/pt → $100 min collateral per contract)
 * - VIX: 1 pt (100x → $100/pt → $100 min collateral per contract)
 */
const MIN_SPREAD_WIDTH_MAP: Record<string, number> = {
  MRUT: 5,
  XSP: 1,
  XND: 5,
  SPX: 5,
  SPXW: 5,
  SPXPM: 5,
  NDX: 25,
  NDXP: 25,
  RUT: 5,
  RUTW: 5,
  DJX: 1,
  VIX: 1,
  VIXW: 1,
  OEX: 5,
  XEO: 5,
};

/**
 * Returns the minimum recommended spread width in points for a given symbol.
 * Returns 1 for equity options (no meaningful minimum).
 */
export function getMinSpreadWidth(symbol: string): number {
  return MIN_SPREAD_WIDTH_MAP[symbol.toUpperCase()] ?? 1;
}

/**
 * Validates a set of selected symbols for multi-index order submission.
 * Returns an array of warning/info messages to display to the user.
 *
 * Key rules enforced:
 * 1. NDXP/NDX/XND (Nasdaq) cannot be in the same "batch" as CBOE index products
 *    without explicit acknowledgment — they are submitted as completely separate orders
 *    on different exchanges.
 * 2. Each order is always submitted individually regardless of how many are selected.
 */
export function validateMultiIndexSelection(symbols: string[]): Array<{
  severity: 'warning' | 'info';
  message: string;
}> {
  const warnings: Array<{ severity: 'warning' | 'info'; message: string }> = [];
  const cboeSymbols = symbols.filter(s => getIndexExchange(s) === 'CBOE');
  const nasdaqSymbols = symbols.filter(s => getIndexExchange(s) === 'Nasdaq');

  if (cboeSymbols.length > 0 && nasdaqSymbols.length > 0) {
    warnings.push({
      severity: 'warning',
      message:
        `Mixed exchanges: ${cboeSymbols.join(', ')} trade on CBOE; ` +
        `${nasdaqSymbols.join(', ')} trade on Nasdaq. ` +
        `These cannot be combined into a single spread — each is submitted as a separate independent order.`,
    });
  }

  if (nasdaqSymbols.length > 0) {
    warnings.push({
      severity: 'info',
      message:
        `${nasdaqSymbols.join(', ')} order(s) route to Nasdaq exchanges (PHLX/ISE). ` +
        `Each index order is submitted independently.`,
    });
  }

  return warnings;
}
