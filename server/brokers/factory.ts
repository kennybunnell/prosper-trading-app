/**
 * Broker Factory
 * 
 * Selects the appropriate broker adapter based on trading mode
 */

import type { IBrokerAdapter } from './types';

// Import adapters (will be implemented next)
// import { TastytradeAdapter } from './tastytrade-adapter';
// import { TradierAdapter } from './tradier-adapter';

export type TradingMode = 'live' | 'paper';

/**
 * Get the appropriate broker adapter based on trading mode
 * 
 * @param mode - Trading mode ('live' or 'paper')
 * @param userId - User ID for accessing user-specific API keys
 * @returns Broker adapter instance
 */
export async function getBrokerAdapter(
  mode: TradingMode,
  userId?: number
): Promise<IBrokerAdapter> {
  if (mode === 'live') {
    // Return Tastytrade adapter for live trading
    const { TastytradeAdapter } = await import('./tastytrade-adapter');
    return new TastytradeAdapter(userId);
  } else {
    // Return Tradier adapter for paper trading
    const { TradierAdapter } = await import('./tradier-adapter');
    return new TradierAdapter(userId);
  }
}

/**
 * Validate trading mode string
 */
export function isValidTradingMode(mode: string): mode is TradingMode {
  return mode === 'live' || mode === 'paper';
}
