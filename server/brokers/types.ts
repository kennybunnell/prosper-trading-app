/**
 * Broker Abstraction Layer
 * 
 * This module defines the interface for broker adapters that support both
 * live trading (Tastytrade) and paper trading (Tradier) modes.
 */

// Position data structure
export interface BrokerPosition {
  symbol: string;
  underlying_symbol: string;
  quantity: number;
  quantity_direction: 'Long' | 'Short';
  close_price: string;
  average_open_price: string;
  multiplier: number;
  cost_effect: string;
  is_suppressed: boolean;
  is_frozen: boolean;
  restricted_quantity: number;
  expires_at: string;
  realized_day_gain: string;
  realized_day_gain_effect: string;
  realized_day_gain_date: string;
  realized_today: string;
  realized_today_effect: string;
  realized_today_date: string;
  created_at: string;
  updated_at: string;
  mark: string;
  mark_price: string;
  restricted_quantity_effect: string;
  instrument_type: string;
  option_type?: 'C' | 'P';
  strike_price?: string;
  days_to_expiration?: number;
}

// Options chain data
export interface OptionsChainData {
  symbol: string;
  expiration: string;
  strikes: OptionStrike[];
}

export interface OptionStrike {
  strike: number;
  call?: OptionQuote;
  put?: OptionQuote;
}

export interface OptionQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open_interest: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
}

// Market data
export interface MarketQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
  change: number;
  change_percent: number;
}

// Order submission (live trading only)
export interface OrderRequest {
  symbol: string;
  quantity: number;
  action: 'Buy to Open' | 'Sell to Open' | 'Buy to Close' | 'Sell to Close';
  order_type: 'Limit' | 'Market';
  price?: number;
  time_in_force: 'Day' | 'GTC';
}

export interface OrderResponse {
  order_id: string;
  status: 'pending' | 'filled' | 'rejected';
  message?: string;
}

/**
 * Broker Adapter Interface
 * 
 * All broker implementations (Tastytrade, Tradier) must implement this interface
 */
export interface IBrokerAdapter {
  /**
   * Get current positions for an account
   */
  getPositions(accountId: string): Promise<BrokerPosition[]>;

  /**
   * Get options chain for a symbol and expiration
   */
  getOptionsChain(symbol: string, expiration?: string): Promise<OptionsChainData>;

  /**
   * Get market quote for a symbol
   */
  getMarketData(symbol: string): Promise<MarketQuote>;

  /**
   * Submit an order (only available in live trading mode)
   * @throws Error if called in paper trading mode
   */
  submitOrder(accountId: string, order: OrderRequest): Promise<OrderResponse>;

  /**
   * Check if this adapter supports order submission
   */
  canSubmitOrders(): boolean;

  /**
   * Get the broker name for display purposes
   */
  getBrokerName(): string;
}
