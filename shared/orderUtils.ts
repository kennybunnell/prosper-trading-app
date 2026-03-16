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
 * NOTE: Tastytrade's order submission API only accepts 'Equity Option' as the instrument type
 * for ALL options (including index options like SPXW, NDXP, MRUT). The 'Index Option' type
 * is NOT a valid order submission type per official TT docs.
 * This function is used for tick-size calculation ($0.05 for index options) and
 * position filtering (TT positions API returns 'Index Option' for these symbols).
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
