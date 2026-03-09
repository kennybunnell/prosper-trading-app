/**
 * Shared Order Utilities
 * 
 * Centralized functions for order price formatting, validation, and submission
 * to ensure consistency across CSP, CC, PMCC, and Working Orders dashboards.
 */

/**
 * Round price to nearest $0.01 (penny)
 * 
 * @param price - The price to round
 * @returns Price rounded to nearest $0.01
 * 
 * @example
 * roundToPenny(1.234) // 1.23
 * roundToPenny(1.237) // 1.24
 * roundToPenny(0.476) // 0.48
 */
export function roundToPenny(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * Round price to nearest $0.05 (nickel) - for fallback if penny rounding fails
 * 
 * @param price - The price to round
 * @returns Price rounded to nearest $0.05
 */
export function roundToNickel(price: number): number {
  return Math.round(price * 20) / 20;
}

/**
 * Format price for Tastytrade API submission.
 * Tastytrade enforces two tick-size rules for equity options:
 *   - Price < $3.00  → $0.01 increments (penny pilot program)
 *   - Price >= $3.00 → $0.05 increments (nickel)
 * Submitting a non-conforming price causes a 422 "invalid_price_increment" rejection.
 *
 * @param price - The price to format
 * @returns Formatted price string (e.g. "3.85", "0.47")
 */
export function formatPriceForSubmission(price: number): string {
  const safePrice = Math.max(0.01, price);
  let rounded: number;
  if (safePrice >= 3.00) {
    // Nickel increments for options priced $3.00 and above
    rounded = Math.round(safePrice * 20) / 20; // nearest $0.05
  } else {
    // Penny increments for options priced below $3.00
    rounded = Math.round(safePrice * 100) / 100; // nearest $0.01
  }
  return rounded.toFixed(2);
}

/**
 * Calculate suggested fill price based on spread width and time working
 * Uses the same logic as the Streamlit implementation but with nickel rounding
 * 
 * @param bid - Current bid price
 * @param ask - Current ask price
 * @param timeWorkingMinutes - How long the order has been working (optional)
 * @param aggressive - Use aggressive pricing to prioritize fills (optional)
 * @returns Suggested price rounded to nearest nickel
 */
export function calculateSuggestedPrice(
  bid: number,
  ask: number,
  timeWorkingMinutes: number = 0,
  aggressive: boolean = false
): number {
  if (!bid || !ask || bid <= 0 || ask <= 0) {
    return 0;
  }

  const spread = ask - bid;
  const mid = (bid + ask) / 2;
  let suggested: number;

  // Determine strategy based on spread width
  if (spread <= 0.05) {
    // Tight spread - use mid
    suggested = mid;
  } else if (spread <= 0.15) {
    // Medium spread - mid minus 1 cent
    suggested = mid - 0.01;
  } else if (spread <= 0.30) {
    // Wide spread - 60% of spread
    suggested = bid + (spread * 0.60);
  } else {
    // Very wide spread - 50% of spread
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

  // Aggressive mode - lower by additional $0.01-0.02
  if (aggressive) {
    const aggressiveAdjustment = spread > 0.10 ? 0.02 : 0.01;
    suggested = Math.max(bid + 0.01, suggested - aggressiveAdjustment);
  }

  // Ensure suggested price is at least bid
  suggested = Math.max(bid, suggested);

  // Round to nearest penny
  return roundToPenny(suggested);
}

/**
 * Build Tastytrade option symbol in OCC format
 * Format: TICKER(6)YYMMDD(6)P/C(1)STRIKE(8)
 * 
 * @param symbol - Underlying symbol (e.g., 'AAPL')
 * @param expiration - Expiration date in YYYY-MM-DD format
 * @param optionType - 'P' for Put or 'C' for Call
 * @param strike - Strike price
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
  // Pad symbol to 6 characters
  const symbolPadded = symbol.padEnd(6, ' ');
  
  // Format date as YYMMDD (2-digit year)
  const expFormatted = expiration.replace(/-/g, ''); // YYYYMMDD
  const expShort = expFormatted.substring(2); // Remove century: YYMMDD
  
  // Format strike as 8-digit cents (multiply by 1000 for options)
  const strikeFormatted = (strike * 1000).toString().padStart(8, '0');
  
  return `${symbolPadded}${expShort}${optionType}${strikeFormatted}`;
}

/**
 * Validate order price against bid/ask spread
 * 
 * @param price - The order price to validate
 * @param bid - Current bid price
 * @param ask - Current ask price
 * @returns Validation result with isValid flag and message
 */
export function validateOrderPrice(
  price: number,
  bid: number,
  ask: number
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
  
  // Check if price is a valid tick-size increment (nickel for >= $3, penny for < $3)
  const expectedRounded = parseFloat(formatPriceForSubmission(price));
  if (Math.abs(price - expectedRounded) > 0.001) {
    const increment = price >= 3.00 ? '$0.05' : '$0.01';
    return {
      isValid: false,
      message: `Price must be in ${increment} increments (suggested: $${expectedRounded.toFixed(2)})`
    };
  }
  
  return {
    isValid: true,
    message: 'Price is valid'
  };
}
