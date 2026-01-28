/**
 * Working Orders Utility Functions
 * Smart fill price calculation and market status checks
 * Ported from Streamlit version: utils/working_orders.py
 */

export interface QuoteData {
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
}

export interface PriceSuggestion {
  suggestedPrice: number;
  strategy: string;
  needsReplacement: boolean;
}

/**
 * Calculate smart fill price based on spread width, time working, and order action
 * @param quote - Current quote data (bid, ask, mid)
 * @param currentPrice - Current order price
 * @param minutesWorking - How long the order has been working
 * @param aggressiveFillMode - If true, prioritize fills over best price
 * @param orderAction - Order action type (e.g., 'Buy to Close', 'Sell to Open')
 * @returns Price suggestion with strategy explanation
 */
export function calculateSmartFillPrice(
  quote: QuoteData,
  currentPrice: number,
  minutesWorking: number,
  aggressiveFillMode: boolean = false,
  orderAction: string = ''
): PriceSuggestion {
  const bid = quote.bid || 0;
  const ask = quote.ask || 0;
  
  // Validate market data - return null suggestion if bid/ask are missing or invalid
  if (!bid || !ask || bid <= 0 || ask <= 0) {
    return {
      suggestedPrice: currentPrice, // Keep current price if no market data
      strategy: 'Unable to calculate - missing or invalid bid/ask data. Keeping current price.',
      needsReplacement: false,
    };
  }
  
  const mid = quote.mid || (bid + ask) / 2;
  const spread = ask - bid;

  // Determine if this is a buy-side or sell-side order
  const isBuySide = orderAction.toLowerCase().includes('buy');
  const isSellSide = orderAction.toLowerCase().includes('sell');

  let suggestedPrice = mid;
  let strategy = '';

  // BUY-SIDE PRICING (Buy to Close, Buy to Open)
  // Goal: Pay closer to ask to ensure fills
  if (isBuySide) {
    // For buy orders, add premium above mid to get fills
    const premium = Math.max(mid * 0.10, 0.05); // 10% or $0.05, whichever is greater
    suggestedPrice = mid + premium;
    strategy = `Buy-side: Mid + ${(premium * 100 / mid).toFixed(0)}% (min $0.05)`;

    // Time-based adjustments - increase price for faster fills
    if (minutesWorking >= 60) {
      suggestedPrice += 0.02;
      strategy += ' | Working >1hr: +$0.02';
    } else if (minutesWorking >= 30) {
      suggestedPrice += 0.01;
      strategy += ' | Working >30min: +$0.01';
    }

    // Aggressive mode: go closer to ask or above
    if (aggressiveFillMode) {
      if (minutesWorking >= 120) {
        // Orders working >2 hours: go above ask
        suggestedPrice = ask + 0.05;
        strategy += ' | 🚀 Aggressive: Ask + $0.05 (>2hrs)';
      } else if (minutesWorking >= 60) {
        suggestedPrice = ask;
        strategy += ' | 🚀 Aggressive: Using ask price';
      } else {
        suggestedPrice += 0.02;
        strategy += ' | 🚀 Aggressive: +$0.02';
      }
    }

    // Ensure we don't go below mid or above ask + $0.10
    suggestedPrice = Math.max(mid, Math.min(ask + 0.10, suggestedPrice));
  }
  // SELL-SIDE PRICING (Sell to Open, Sell to Close)
  // Goal: Receive closer to bid while still getting fills
  else if (isSellSide) {
    // Base pricing strategy based on spread width
    if (spread <= 0.05) {
      // Tight spread: use mid price
      suggestedPrice = mid;
      strategy = 'Sell-side: Tight spread (≤$0.05): Mid';
    } else if (spread <= 0.15) {
      // Medium spread: mid - $0.01
      suggestedPrice = mid - 0.01;
      strategy = 'Sell-side: Medium spread (≤$0.15): Mid - $0.01';
    } else if (spread <= 0.30) {
      // Wide spread: 60% of spread from bid
      suggestedPrice = bid + (spread * 0.6);
      strategy = 'Sell-side: Wide spread (≤$0.30): 60% from bid';
    } else {
      // Very wide spread: 50% of spread from bid
      suggestedPrice = bid + (spread * 0.5);
      strategy = 'Sell-side: Very wide spread: 50% from bid';
    }

    // Time-based adjustments - decrease price for faster fills
    if (minutesWorking >= 60) {
      suggestedPrice -= 0.02;
      strategy += ' | Working >1hr: -$0.02';
    } else if (minutesWorking >= 30) {
      suggestedPrice -= 0.01;
      strategy += ' | Working >30min: -$0.01';
    }

    // Aggressive fill mode adjustments
    if (aggressiveFillMode) {
      if (minutesWorking >= 120) {
        // Orders working >2 hours: go to bid
        suggestedPrice = bid;
        strategy += ' | 🚀 Aggressive: Using bid price (>2hrs)';
      } else if (minutesWorking >= 60) {
        suggestedPrice -= 0.02;
        strategy += ' | 🚀 Aggressive: -$0.02';
      } else {
        suggestedPrice -= 0.01;
        strategy += ' | 🚀 Aggressive: -$0.01';
      }
    }

    // Ensure suggested price is within bid-ask spread
    suggestedPrice = Math.max(bid, Math.min(ask, suggestedPrice));
  }
  // UNKNOWN ACTION TYPE - use conservative mid price
  else {
    suggestedPrice = mid;
    strategy = 'Unknown action type: Using mid price';
  }

  // Round to nearest penny (cent)
  suggestedPrice = Math.round(suggestedPrice * 100) / 100;

  // Ensure suggested price is within bid-ask spread
  suggestedPrice = Math.max(bid, Math.min(ask, suggestedPrice));

  // Determine if replacement is needed (price difference >= $0.01)
  const needsReplacement = Math.abs(suggestedPrice - currentPrice) >= 0.01;

  return {
    suggestedPrice,
    strategy,
    needsReplacement,
  };
}

/**
 * Calculate how long an order has been working
 * @param receivedAt - ISO timestamp when order was received
 * @returns Minutes the order has been working
 */
export function calculateMinutesWorking(receivedAt: string): number {
  const received = new Date(receivedAt);
  const now = new Date();
  const diffMs = now.getTime() - received.getTime();
  return Math.floor(diffMs / 60000); // Convert ms to minutes
}

/**
 * Format time working for display
 * @param minutes - Minutes the order has been working
 * @returns Formatted string (e.g., "45m", "2h 15m", "3d 4h")
 */
export function formatTimeWorking(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  } else if (minutes < 1440) {
    // Less than 24 hours
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    // Days
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
}

/**
 * Check if it's safe to replace orders (not after 3:55 PM ET)
 * @returns true if safe to replace orders
 */
export function isSafeToReplaceOrders(): boolean {
  const now = new Date();
  
  // Convert to ET (UTC-5 or UTC-4 depending on DST)
  const etOffset = isDST(now) ? -4 : -5;
  const etTime = new Date(now.getTime() + (etOffset * 60 * 60 * 1000));
  
  const hour = etTime.getUTCHours();
  const minute = etTime.getUTCMinutes();
  const dayOfWeek = etTime.getUTCDay();
  
  // Don't replace on weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  
  // Don't replace after 3:55 PM ET (15:55)
  if (hour > 15 || (hour === 15 && minute >= 55)) {
    return false;
  }
  
  return true;
}

/**
 * Get current market status
 * @returns Market status string
 */
export function getMarketStatus(): string {
  const now = new Date();
  
  // Convert to ET
  const etOffset = isDST(now) ? -4 : -5;
  const etTime = new Date(now.getTime() + (etOffset * 60 * 60 * 1000));
  
  const hour = etTime.getUTCHours();
  const minute = etTime.getUTCMinutes();
  const dayOfWeek = etTime.getUTCDay();
  
  // Weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return 'Closed (Weekend)';
  }
  
  // Market hours: 9:30 AM - 4:00 PM ET
  if (hour < 9 || (hour === 9 && minute < 30)) {
    return 'Pre-Market';
  } else if (hour >= 16) {
    return 'After Hours';
  } else {
    return 'Open';
  }
}

/**
 * Check if date is in Daylight Saving Time
 * @param date - Date to check
 * @returns true if in DST
 */
function isDST(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  return date.getTimezoneOffset() < stdOffset;
}
