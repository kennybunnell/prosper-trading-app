/**
 * Tradier Broker Adapter
 * 
 * Implements paper trading functionality using Tradier API
 * NO ORDER SUBMISSION CAPABILITY - read-only market data
 */

import type {
  IBrokerAdapter,
  BrokerPosition,
  OptionsChainData,
  OptionStrike,
  MarketQuote,
  OrderRequest,
  OrderResponse,
} from './types';

import { TradierAPI, type Quote, type OptionContract } from '../tradier';

export class TradierAdapter implements IBrokerAdapter {
  private userId?: number;
  private tradierClient: TradierAPI;

  constructor(userId?: number) {
    this.userId = userId;
    
    // Use shared Tradier API key from environment for now
    // Later: fetch user-specific key for paid tiers
    const apiKey = process.env.TRADIER_API_KEY || '';
    
    if (!apiKey) {
      throw new Error('TRADIER_API_KEY not configured');
    }

    // Use production API (not sandbox) for real market data
    this.tradierClient = new TradierAPI(apiKey, false);
  }

  async getPositions(accountId: string): Promise<BrokerPosition[]> {
    // Paper trading mode - no real positions
    // In the future, we could store simulated positions in the database
    // For now, return empty array (students start with no positions)
    return [];
  }

  async getOptionsChain(symbol: string, expiration?: string): Promise<OptionsChainData> {
    try {
      // Get expirations if not provided
      let targetExpiration = expiration;
      if (!targetExpiration) {
        const expirations = await this.tradierClient.getExpirations(symbol);
        if (expirations.length === 0) {
          throw new Error(`No expirations found for ${symbol}`);
        }
        // Use the nearest expiration
        targetExpiration = expirations[0];
      }

      // Fetch option chain with Greeks
      const options = await this.tradierClient.getOptionChain(symbol, targetExpiration, true);

      // Group by strike price
      const strikeMap = new Map<number, OptionStrike>();

      for (const option of options) {
        const strike = option.strike;
        
        if (!strikeMap.has(strike)) {
          strikeMap.set(strike, { strike });
        }

        const strikeData = strikeMap.get(strike)!;

        if (option.option_type === 'call') {
          strikeData.call = {
            symbol: option.symbol,
            bid: option.bid,
            ask: option.ask,
            last: option.last,
            volume: option.volume,
            open_interest: option.open_interest,
            delta: option.greeks?.delta,
            gamma: option.greeks?.gamma,
            theta: option.greeks?.theta,
            vega: option.greeks?.vega,
            iv: option.greeks?.mid_iv,
          };
        } else {
          strikeData.put = {
            symbol: option.symbol,
            bid: option.bid,
            ask: option.ask,
            last: option.last,
            volume: option.volume,
            open_interest: option.open_interest,
            delta: option.greeks?.delta,
            gamma: option.greeks?.gamma,
            theta: option.greeks?.theta,
            vega: option.greeks?.vega,
            iv: option.greeks?.mid_iv,
          };
        }
      }

      return {
        symbol,
        expiration: targetExpiration,
        strikes: Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike),
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch options chain: ${error.message}`);
    }
  }

  async getMarketData(symbol: string): Promise<MarketQuote> {
    try {
      const quote = await this.tradierClient.getQuote(symbol);

      return {
        symbol: quote.symbol,
        bid: quote.bid,
        ask: quote.ask,
        last: quote.last,
        volume: quote.volume,
        high: quote.high,
        low: quote.low,
        open: quote.open,
        close: quote.close,
        change: quote.change,
        change_percent: quote.change_percentage,
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch market data: ${error.message}`);
    }
  }

  async submitOrder(accountId: string, order: OrderRequest): Promise<OrderResponse> {
    // Paper trading mode - NO ORDER SUBMISSION
    throw new Error('Order submission is disabled in paper trading mode');
  }

  canSubmitOrders(): boolean {
    return false; // Tradier adapter does not support order submission
  }

  getBrokerName(): string {
    return 'Tradier (Paper Trading)';
  }
}
