/**
 * Tastytrade API Integration
 * Handles authentication, account management, and order execution
 */

import axios, { AxiosInstance } from 'axios';

const TASTYTRADE_API_BASE = 'https://api.tastyworks.com';

export interface TastytradeSession {
  sessionToken: string;
  rememberToken: string;
  user: {
    email: string;
    username: string;
    externalId: string;
  };
}

export interface TastytradeAccount {
  account: {
    'account-number': string;
    'external-id': string;
    'opened-at': string;
    'nickname': string;
    'account-type-name': string;
    'is-firm-error': boolean;
    'is-firm-proprietary': boolean;
    'is-futures-approved': boolean;
    'is-closed': boolean;
    'day-trader-status': boolean;
    'margin-or-cash': string;
    'suitable-options-level': string;
    [key: string]: any;
  };
}

export interface TastytradePosition {
  'account-number': string;
  'instrument-type': string;
  'streamer-symbol': string;
  symbol: string;
  'underlying-symbol': string;
  quantity: number;
  'quantity-direction': string;
  'close-price': string;
  'average-open-price': string;
  'average-yearly-market-close-price': string;
  'average-daily-market-close-price': string;
  multiplier: number;
  'cost-effect': string;
  'is-suppressed': boolean;
  'is-frozen': boolean;
  'restricted-quantity': number;
  'expires-at'?: string;
  'realized-day-gain': string;
  'realized-day-gain-effect': string;
  'realized-day-gain-date': string;
  'realized-today': string;
  'realized-today-effect': string;
  'realized-today-date': string;
}

export interface OrderLeg {
  instrumentType: 'Equity' | 'Equity Option';
  symbol: string;
  quantity: string;
  action: 'Sell to Open' | 'Buy to Close' | 'Buy to Open' | 'Sell to Close';
}

export interface CreateOrderRequest {
  accountNumber: string;
  timeInForce: 'Day' | 'GTC' | 'GTD';
  orderType: 'Limit' | 'Market' | 'Stop' | 'Stop Limit';
  price?: string;
  priceEffect?: 'Credit' | 'Debit';
  legs: OrderLeg[];
}

export interface TastytradeOrder {
  id: string;
  accountNumber: string;
  timeInForce: string;
  orderType: string;
  size: string;
  underlyingSymbol: string;
  underlyingInstrumentType: string;
  status: string;
  cancellable: boolean;
  editable: boolean;
  edited: boolean;
  legs: OrderLeg[];
  receivedAt: string;
  updatedAt: number;
  price?: string;
  priceEffect?: string;
}

export class TastytradeAPI {
  private client: AxiosInstance;
  private sessionToken: string | null = null;
  private rememberToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: TASTYTRADE_API_BASE,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Retry helper with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Check if error is retryable (network errors, timeouts)
        const isRetryable = 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ECONNREFUSED' ||
          error.message?.includes('socket') ||
          error.message?.includes('network') ||
          error.message?.includes('TLS');
        
        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }
        
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`[Tastytrade] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Authenticate with Tastytrade API
   */
  async login(username: string, password: string): Promise<TastytradeSession> {
    try {
      const response = await this.retryWithBackoff(() =>
        this.client.post('/sessions', {
          login: username,
          password: password,
          'remember-me': true,
        })
      );

      const data = response.data.data;
      this.sessionToken = data['session-token'];
      this.rememberToken = data['remember-token'];

      // Set auth header for subsequent requests
      this.client.defaults.headers.common['Authorization'] = this.sessionToken;

      return {
        sessionToken: this.sessionToken!,
        rememberToken: this.rememberToken!,
        user: data.user,
      };
    } catch (error: any) {
      throw new Error(`Tastytrade login failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Set session token for authenticated requests
   */
  setSessionToken(token: string): void {
    this.sessionToken = token;
    this.client.defaults.headers.common['Authorization'] = token;
  }

  /**
   * Validate current session
   */
  async validateSession(): Promise<boolean> {
    if (!this.sessionToken) return false;

    try {
      await this.client.get('/sessions/validate');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all accounts for the authenticated user
   */
  async getAccounts(): Promise<TastytradeAccount[]> {
    try {
      const response = await this.client.get('/customers/me/accounts');
      return response.data.data.items;
    } catch (error: any) {
      throw new Error(`Failed to fetch accounts: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get positions for a specific account
   */
  async getPositions(accountNumber: string): Promise<TastytradePosition[]> {
    try {
      const response = await this.client.get(`/accounts/${accountNumber}/positions`);
      return response.data.data.items;
    } catch (error: any) {
      throw new Error(`Failed to fetch positions: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get working orders for a specific account
   */
  async getWorkingOrders(accountNumber: string): Promise<TastytradeOrder[]> {
    try {
      const response = await this.client.get(`/accounts/${accountNumber}/orders/live`);
      return response.data.data.items;
    } catch (error: any) {
      throw new Error(`Failed to fetch working orders: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Submit an order
   */
  async submitOrder(order: CreateOrderRequest): Promise<TastytradeOrder> {
    try {
      const response = await this.client.post(
        `/accounts/${order.accountNumber}/orders`,
        {
          'time-in-force': order.timeInForce,
          'order-type': order.orderType,
          price: order.price,
          'price-effect': order.priceEffect,
          legs: order.legs.map(leg => ({
            'instrument-type': leg.instrumentType,
            symbol: leg.symbol,
            quantity: leg.quantity,
            action: leg.action,
          })),
        }
      );

      return response.data.data.order;
    } catch (error: any) {
      throw new Error(`Failed to submit order: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Dry run an order (preview without executing)
   */
  async dryRunOrder(order: CreateOrderRequest): Promise<any> {
    try {
      const response = await this.client.post(
        `/accounts/${order.accountNumber}/orders/dry-run`,
        {
          'time-in-force': order.timeInForce,
          'order-type': order.orderType,
          price: order.price,
          'price-effect': order.priceEffect,
          legs: order.legs.map(leg => ({
            'instrument-type': leg.instrumentType,
            symbol: leg.symbol,
            quantity: leg.quantity,
            action: leg.action,
          })),
        }
      );

      return response.data.data;
    } catch (error: any) {
      // Log full error response for debugging
      console.error('[Tastytrade dryRunOrder] Full error response:', JSON.stringify({
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      }, null, 2));
      
      // Extract detailed error message
      const errorData = error.response?.data;
      let errorMessage = 'One or more preflight checks failed';
      
      if (errorData?.error?.message) {
        errorMessage = errorData.error.message;
      } else if (errorData?.errors && Array.isArray(errorData.errors)) {
        errorMessage = errorData.errors.map((e: any) => e.message || e).join(', ');
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      }
      
      throw new Error(`Failed to dry run order: ${errorMessage}`);
    }
  }

  /**
   * Get live (unfilled) orders for an account
   */
  async getLiveOrders(accountNumber: string): Promise<any[]> {
    try {
      const response = await this.client.get(`/accounts/${accountNumber}/orders/live`);
      return response.data.data?.items || [];
    } catch (error: any) {
      throw new Error(`Failed to fetch live orders: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get option quotes for multiple symbols
   * Uses the /market-data/by-type endpoint with equity-option parameters
   */
  async getOptionQuotesBatch(symbols: string[]): Promise<Record<string, any>> {
    try {
      // Build query string with multiple equity-option parameters
      // Example: ?equity-option=AAPL  260220C00150000&equity-option=MSFT  260220P00400000
      const params = new URLSearchParams();
      symbols.forEach(symbol => {
        params.append('equity-option', symbol);
      });
      
      console.log(`[Tastytrade] Requesting quotes for symbols:`, symbols);
      console.log(`[Tastytrade] Query string:`, params.toString());
      
      const response = await this.client.get('/market-data/by-type', {
        params,
        paramsSerializer: (params) => {
          // Return the URLSearchParams as-is to preserve multiple equity-option params
          return params.toString();
        },
      });
      
      console.log(`[Tastytrade] API response status:`, response.status);
      console.log(`[Tastytrade] API response data:`, JSON.stringify(response.data, null, 2));
      
      // Convert array response to map keyed by symbol
      const quotes: Record<string, any> = {};
      
      // Access the items array from response.data.data.items
      let items = response.data?.data?.items || response.data?.data || [];
      
      // Handle both array and object responses
      const itemsArray = Array.isArray(items) ? items : [items];
      
      for (const item of itemsArray) {
        if (item && item.symbol) {
          // Convert string values to numbers (Tastytrade API returns strings)
          quotes[item.symbol] = {
            bid: parseFloat(item.bid) || 0,
            ask: parseFloat(item.ask) || 0,
            mid: parseFloat(item.mid) || 0,
            last: parseFloat(item.last) || 0,
            mark: parseFloat(item.mark) || 0,
          };
        }
      }
      
      console.log(`[Tastytrade] Parsed quotes:`, JSON.stringify(quotes, null, 2));
      console.log(`[Tastytrade] Fetched ${Object.keys(quotes).length}/${symbols.length} option quotes`);
      return quotes;
    } catch (error: any) {
      console.error('[Tastytrade] Failed to fetch option quotes:');
      console.error('[Tastytrade] Error response:', error.response?.data);
      console.error('[Tastytrade] Error message:', error.message);
      return {}; // Return empty object on error to allow graceful degradation
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(accountNumber: string, orderId: string): Promise<void> {
    try {
      await this.client.delete(`/accounts/${accountNumber}/orders/${orderId}`);
    } catch (error: any) {
      throw new Error(`Failed to cancel order: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Cancel and replace an order with a new price
   * NOTE: Tastytrade's PUT endpoint creates "Contingent" orders for multi-leg spreads that never activate.
   * This method does a proper two-step: 1) Cancel existing order, 2) Submit new order with same legs
   */
  async cancelReplaceOrder(accountNumber: string, orderId: string, newPrice: number, originalOrder: any): Promise<{ success: boolean; orderId?: string; message: string }> {
    try {
      console.log(`[Tastytrade] Two-step cancel+resubmit for order ${orderId}`);
      console.log(`[Tastytrade] Original order:`, JSON.stringify(originalOrder, null, 2));
      console.log(`[Tastytrade] New price: $${newPrice.toFixed(2)}`);
      
      // Step 1: Cancel the existing order
      console.log(`[Tastytrade] Step 1: Canceling order ${orderId}`);
      await this.cancelOrder(accountNumber, orderId);
      console.log(`[Tastytrade] Order ${orderId} canceled successfully`);
      
      // Step 2: Build new order from original order legs
      // Use the original order's priceEffect (Credit for spreads you sell, Debit for spreads you buy)
      const priceEffect = (originalOrder['price-effect'] || originalOrder.priceEffect || 'Credit') as 'Credit' | 'Debit';
      
      const newOrderPayload: CreateOrderRequest = {
        accountNumber: accountNumber,
        timeInForce: (originalOrder['time-in-force'] || originalOrder.timeInForce || 'Day') as 'Day' | 'GTC' | 'GTD',
        orderType: (originalOrder['order-type'] || originalOrder.orderType || 'Limit') as 'Limit' | 'Market' | 'Stop' | 'Stop Limit',
        price: newPrice.toFixed(2),
        priceEffect: priceEffect as 'Credit' | 'Debit',
        legs: (originalOrder.legs || []).map((leg: any) => ({
          instrumentType: leg['instrument-type'] || leg.instrumentType || 'Equity Option',
          symbol: leg.symbol,
          quantity: leg.quantity,
          action: leg.action,
        })),
      };
      
      console.log(`[Tastytrade] Step 2: Submitting new order with price $${newPrice.toFixed(2)}`);
      console.log(`[Tastytrade] New order payload:`, JSON.stringify(newOrderPayload, null, 2));
      
      // Step 3: Submit the new order
      const newOrder = await this.submitOrder(newOrderPayload);
      
      console.log(`[Tastytrade] New order submitted successfully. Order ID: ${newOrder.id}, Status: ${newOrder.status}`);
      
      return {
        success: true,
        orderId: newOrder.id,
        message: `Order replaced successfully (Canceled ${orderId}, New ID: ${newOrder.id})`,
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.error(`[Tastytrade] Failed to replace order ${orderId}:`, errorMsg);
      console.error(`[Tastytrade] Error response:`, error.response?.data);
      console.error(`[Tastytrade] Cancel-replace error:`, errorMsg);
      return {
        success: false,
        message: `Failed to replace order: ${errorMsg}`,
      };
    }
  }

  /**
   * Get account balances
   */
  async getBalances(accountNumber: string): Promise<any> {
    try {
      const response = await this.client.get(`/accounts/${accountNumber}/balances`);
      return response.data.data;
    } catch (error: any) {
      // Log full error response for debugging
      console.error('[Tastytrade submitOrder] Full error response:', JSON.stringify({
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      }, null, 2));
      
      // Extract detailed error message
      const errorData = error.response?.data;
      let errorMessage = 'Order submission failed';
      
      if (errorData?.error?.message) {
        errorMessage = errorData.error.message;
      } else if (errorData?.errors && Array.isArray(errorData.errors)) {
        errorMessage = errorData.errors.map((e: any) => e.message || e).join(', ');
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      }
      
      throw new Error(`Failed to submit order: ${errorMessage}`);
    }
  }

  /**
   * Buy to close an option position
   * @param accountNumber - Account number
   * @param optionSymbol - Full option symbol (OCC format)
   * @param quantity - Number of contracts to close
   * @param price - Limit price per contract
   * @param dryRun - If true, only validate without submitting
   */
  async buyToCloseOption(accountNumber: string, optionSymbol: string, quantity: number, price: number, dryRun: boolean = false): Promise<{ success: boolean; orderId?: string; message: string }> {
    // Import price formatting utility
    const { formatPriceForSubmission } = await import('../shared/orderUtils');
    // Parse option symbol to extract underlying
    const underlyingMatch = optionSymbol.match(/^([A-Z]+)/);
    const underlyingSymbol = underlyingMatch ? underlyingMatch[1] : optionSymbol.substring(0, 6).trim();

    // Ensure option symbol has proper spacing for Tastytrade API
    // OCC format requires 6-char ticker padded with spaces
    // Remove ALL spaces first, then re-format properly
    let formattedSymbol = optionSymbol.replace(/\s+/g, '');
    const match = formattedSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (match) {
      const ticker = match[1].padEnd(6, ' ');
      const rest = match[2] + match[3] + match[4];
      formattedSymbol = ticker + rest;
    } else {
      // If symbol doesn't match expected format, try to pad it anyway
      // This handles cases where symbol might already be partially formatted
      const tickerMatch = optionSymbol.match(/^([A-Z]+)/);
      if (tickerMatch) {
        const ticker = tickerMatch[1].padEnd(6, ' ');
        const rest = optionSymbol.substring(tickerMatch[1].length).replace(/\s+/g, '');
        formattedSymbol = ticker + rest;
      }
    }

    // Format price to nearest penny (Tastytrade requires proper increments)
    const formattedPrice = formatPriceForSubmission(price);

    const orderPayload = {
      'time-in-force': 'Day',
      'order-type': 'Limit',
      'underlying-symbol': underlyingSymbol,
      price: formattedPrice,
      'price-effect': 'Debit', // We pay to buy back
      legs: [
        {
          'instrument-type': 'Equity Option',
          symbol: formattedSymbol,
          quantity: quantity.toString(),
          action: 'Buy to Close',
        },
      ],
    };

    try {
      console.log(`[Tastytrade] ${dryRun ? 'Dry run' : 'Submitting'} buy-to-close order:`, {
        account: accountNumber,
        symbol: formattedSymbol,
        quantity,
        price,
      });

      // Use separate endpoint for dry-run vs live orders
      const endpoint = dryRun 
        ? `/accounts/${accountNumber}/orders/dry-run`
        : `/accounts/${accountNumber}/orders`;
      
      const response = await this.client.post(endpoint, orderPayload);

      const orderId = response.data.data?.order?.id || response.data.data?.id;
      
      return {
        success: true,
        orderId: dryRun ? undefined : orderId,
        message: dryRun 
          ? `Dry run successful for ${quantity} contract(s) at $${formattedPrice}`
          : `Order submitted successfully (ID: ${orderId})`,
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.error(`[Tastytrade] Buy-to-close error:`, errorMsg);
      console.error(`[Tastytrade] Full error response:`, JSON.stringify(error.response?.data, null, 2));
      console.error(`[Tastytrade] Order payload was:`, JSON.stringify(orderPayload, null, 2));
      return {
        success: false,
        message: `Failed to ${dryRun ? 'validate' : 'submit'} order: ${errorMsg}`,
      };
    }
  }

  /**
   * Get transaction history for an account
   * @param accountNumber - Account number
   * @param startDate - Start date (YYYY-MM-DD format)
   * @param endDate - End date (YYYY-MM-DD format)
   * @param perPage - Number of transactions per page (default 1000)
   */
  async getTransactionHistory(
    accountNumber: string,
    startDate: string,
    endDate: string,
    perPage: number = 1000
  ): Promise<any[]> {
    try {
      const params = {
        'start-date': startDate,
        'end-date': endDate,
        'per-page': perPage,
      };

      const response = await this.client.get(
        `/accounts/${accountNumber}/transactions`,
        { params }
      );

      return response.data.data?.items || [];
    } catch (error: any) {
      console.error(`[Tastytrade] Transaction history error:`, error.response?.data?.error?.message || error.message);
      throw new Error(`Failed to fetch transaction history: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get underlying stock quote (current price)
   * @param symbol - Stock symbol (e.g., 'AAPL', 'TSLA')
   * @returns Current stock price (last trade or mid price)
   */
  async getUnderlyingQuote(symbol: string): Promise<number> {
    try {
      const params = new URLSearchParams();
      params.append('equity', symbol);
      
      const response = await this.client.get('/market-data/by-type', {
        params,
        paramsSerializer: (params) => params.toString(),
      });
      
      const item = response.data.data?.items?.[0];
      if (!item) {
        throw new Error(`No market data found for ${symbol}`);
      }
      
      // Prefer last trade price, fall back to mid price
      const price = parseFloat(item.last || item.mid || item.mark || '0');
      if (price === 0) {
        throw new Error(`Invalid price data for ${symbol}`);
      }
      
      return price;
    } catch (error: any) {
      console.error(`[Tastytrade] Failed to fetch underlying quote for ${symbol}:`, error.message);
      throw new Error(`Failed to fetch underlying quote: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get option chain for an underlying symbol
   * @param underlyingSymbol - Stock symbol (e.g., 'AAPL', 'TSLA')
   * @returns Nested option chain data grouped by expiration
   */
  async getOptionChain(underlyingSymbol: string): Promise<any> {
    console.log(`[Tastytrade] Fetching option chain for ${underlyingSymbol}`);
    try {
      const response = await this.client.get(`/option-chains/${underlyingSymbol}/nested`);
      console.log(`[Tastytrade] Option chain response for ${underlyingSymbol}:`, {
        hasData: !!response.data?.data,
        itemsCount: response.data?.data?.items?.length || 0,
        firstItem: response.data?.data?.items?.[0],
      });
      return response.data.data;
    } catch (error: any) {
      console.error(`[Tastytrade] Failed to fetch option chain for ${underlyingSymbol}:`, error.message);
      console.error(`[Tastytrade] Error details:`, error.response?.data);
      throw new Error(`Failed to fetch option chain: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Submit a roll order (2-leg: close existing + open new)
   */
  async submitRollOrder(params: {
    accountNumber: string;
    symbol: string;
    closeLeg: {
      action: 'BTC' | 'STC';
      quantity: number;
      strike: number;
      expiration: string;
      optionType: 'PUT' | 'CALL';
    };
    openLeg: {
      action: 'STO' | 'BTO';
      quantity: number;
      strike: number;
      expiration: string;
      optionType: 'PUT' | 'CALL';
    };
  }): Promise<{ orderId: string }> {
    try {
      // Format option symbols for Tastytrade
      const formatOptionSymbol = (leg: any) => {
        const expDate = new Date(leg.expiration).toISOString().split('T')[0].replace(/-/g, '');
        const optType = leg.optionType === 'PUT' ? 'P' : 'C';
        const strikeFormatted = (leg.strike * 1000).toString().padStart(8, '0');
        return `${params.symbol}${expDate}${optType}${strikeFormatted}`;
      };

      const closeSymbol = formatOptionSymbol(params.closeLeg);
      const openSymbol = formatOptionSymbol(params.openLeg);

      // Build 2-leg order
      const orderPayload = {
        'time-in-force': 'Day',
        'order-type': 'Limit',
        'price-effect': 'Debit', // Will be calculated by Tastytrade based on legs
        legs: [
          {
            'instrument-type': 'Equity Option',
            symbol: closeSymbol,
            action: params.closeLeg.action,
            quantity: params.closeLeg.quantity,
          },
          {
            'instrument-type': 'Equity Option',
            symbol: openSymbol,
            action: params.openLeg.action,
            quantity: params.openLeg.quantity,
          },
        ],
      };

      console.log('[Tastytrade] Submitting roll order:', JSON.stringify(orderPayload, null, 2));

      const response = await this.retryWithBackoff(() =>
        this.client.post(`/accounts/${params.accountNumber}/orders`, orderPayload)
      );

      const orderId = response.data.data.order.id;
      console.log('[Tastytrade] Roll order submitted successfully:', orderId);

      return { orderId };
    } catch (error: any) {
      console.error('[Tastytrade] Failed to submit roll order:', error.message);
      console.error('[Tastytrade] Error details:', error.response?.data);
      throw new Error(`Failed to submit roll order: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Submit a close order (1-leg: close existing position)
   */
  async submitCloseOrder(params: {
    accountNumber: string;
    symbol: string;
    closeLeg: {
      action: 'BTC' | 'STC';
      quantity: number;
      strike: number;
      expiration: string;
      optionType: 'PUT' | 'CALL';
      price: number; // Current market price for the option
      optionSymbol?: string; // Full OCC option symbol from Tastytrade (if available)
    };
  }): Promise<{ orderId: string }> {
    try {
      // Import price formatting utility
      const { formatPriceForSubmission } = await import('../shared/orderUtils');
      
      // Use the actual option symbol from Tastytrade if provided, otherwise construct it
      let optionSymbol: string;
      if (params.closeLeg.optionSymbol) {
        optionSymbol = params.closeLeg.optionSymbol;
        console.log('[Tastytrade] Using actual option symbol from Tastytrade:', optionSymbol);
      } else {
        // Fallback: Format option symbol for Tastytrade (OCC format with 6-char ticker)
        const expDate = new Date(params.closeLeg.expiration).toISOString().split('T')[0].replace(/-/g, '');
        const optType = params.closeLeg.optionType === 'PUT' ? 'P' : 'C';
        const strikeFormatted = (params.closeLeg.strike * 1000).toString().padStart(8, '0');
        
        // Pad ticker to 6 characters with spaces (OCC format requirement)
        const ticker = params.symbol.padEnd(6, ' ');
        optionSymbol = `${ticker}${expDate}${optType}${strikeFormatted}`;
        console.log('[Tastytrade] Constructed option symbol:', optionSymbol);
      }

      // Calculate aggressive close price with realistic caps
      // For options worth < $1, cap at $0.50 to avoid unrealistic prices on near-worthless options
      // For options worth >= $1, use 10% above mark or +$0.05 (whichever is greater)
      let aggressivePrice;
      if (params.closeLeg.price < 1.0) {
        // For cheap options, use a small fixed premium (max $0.50 total)
        aggressivePrice = Math.min(params.closeLeg.price + 0.10, 0.50);
      } else {
        // For normal options, use 10% premium or +$0.05
        const pricePremium = Math.max(params.closeLeg.price * 0.10, 0.05);
        aggressivePrice = params.closeLeg.price + pricePremium;
      }
      const formattedPrice = formatPriceForSubmission(aggressivePrice);

      // Determine action text based on BTC/STC
      const actionText = params.closeLeg.action === 'BTC' ? 'Buy to Close' : 'Sell to Close';
      const priceEffect = params.closeLeg.action === 'BTC' ? 'Debit' : 'Credit';

      // Build 1-leg close order (matching buyToCloseOption format)
      const orderPayload = {
        'time-in-force': 'Day',
        'order-type': 'Limit',
        'underlying-symbol': params.symbol,
        price: formattedPrice,
        'price-effect': priceEffect,
        legs: [
          {
            'instrument-type': 'Equity Option',
            symbol: optionSymbol,
            quantity: params.closeLeg.quantity.toString(),
            action: actionText,
          },
        ],
      };

      console.log('[Tastytrade] Submitting close order:', JSON.stringify(orderPayload, null, 2));

      const response = await this.retryWithBackoff(() =>
        this.client.post(`/accounts/${params.accountNumber}/orders`, orderPayload)
      );

      const orderId = response.data.data.order.id;
      console.log('[Tastytrade] Close order submitted successfully:', orderId);

      return { orderId };
    } catch (error: any) {
      console.error('[Tastytrade] Failed to submit close order:', error.message);
      console.error('[Tastytrade] Error response status:', error.response?.status);
      console.error('[Tastytrade] Error response data:', JSON.stringify(error.response?.data, null, 2));
      
      // Log the specific errors array if it exists
      if (error.response?.data?.error?.errors) {
        console.error('[Tastytrade] Detailed errors array:');
        error.response.data.error.errors.forEach((err: any, index: number) => {
          console.error(`  Error ${index + 1}:`, JSON.stringify(err, null, 2));
        });
      }
      
      throw new Error(`Failed to submit close order: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Logout and destroy session
   */
  async logout(): Promise<void> {
    try {
      if (this.sessionToken) {
        await this.client.delete('/sessions');
      }
    } finally {
      this.sessionToken = null;
      this.rememberToken = null;
      delete this.client.defaults.headers.common['Authorization'];
    }
  }
}

// Singleton instance for session management
let tastytradeInstance: TastytradeAPI | null = null;

export function getTastytradeAPI(): TastytradeAPI {
  if (!tastytradeInstance) {
    tastytradeInstance = new TastytradeAPI();
  }
  return tastytradeInstance;
}

/**
 * Helper function to submit roll orders
 */
export async function submitRollOrder(params: {
  accountNumber: string;
  symbol: string;
  closeLeg: {
    action: 'BTC' | 'STC';
    quantity: number;
    strike: number;
    expiration: string;
    optionType: 'PUT' | 'CALL';
  };
  openLeg: {
    action: 'STO' | 'BTO';
    quantity: number;
    strike: number;
    expiration: string;
    optionType: 'PUT' | 'CALL';
  };
}): Promise<{ orderId: string }> {
  const api = getTastytradeAPI();
  return api.submitRollOrder(params);
}

/**
 * Helper function to submit close orders (1-leg)
 */
export async function submitCloseOrder(params: {
  accountNumber: string;
  symbol: string;
  closeLeg: {
    action: 'BTC' | 'STC';
    quantity: number;
    strike: number;
    expiration: string;
    optionType: 'PUT' | 'CALL';
    price: number;
  };
}): Promise<{ orderId: string }> {
  const api = getTastytradeAPI();
  return api.submitCloseOrder(params);
}
