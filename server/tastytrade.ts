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
   * Authenticate with Tastytrade API
   */
  async login(username: string, password: string): Promise<TastytradeSession> {
    try {
      const response = await this.client.post('/sessions', {
        login: username,
        password: password,
        'remember-me': true,
      });

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
        },
        {
          params: {
            'dry-run': false,
          },
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
        },
        {
          params: {
            'dry-run': true,
          },
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
   * Cancel and replace an order with a new price using atomic PUT request
   * This is the proper Tastytrade API method that cancels and replaces in a single operation
   */
  async cancelReplaceOrder(accountNumber: string, orderId: string, newPrice: number, originalOrder: any): Promise<{ success: boolean; orderId?: string; message: string }> {
    try {
      // Build the replacement order payload
      // Must include: time-in-force, order-type, price, price-effect, legs
      const payload = {
        'time-in-force': originalOrder['time-in-force'] || originalOrder.timeInForce || 'Day',
        'order-type': originalOrder['order-type'] || originalOrder.orderType || 'Limit',
        'price': newPrice.toFixed(2),
        'price-effect': originalOrder['price-effect'] || originalOrder.priceEffect || 'Credit',
        'legs': originalOrder.legs || [],
      };
      
      console.log(`[Tastytrade] Replacing order ${orderId} with new price $${newPrice.toFixed(2)}`);
      console.log(`[Tastytrade] Payload:`, JSON.stringify(payload, null, 2));
      
      // Use PUT request to replace the order atomically
      const response = await this.client.put(
        `/accounts/${accountNumber}/orders/${orderId}`,
        payload
      );
      
      const newOrderId = response.data.data?.order?.id || response.data.data?.id || orderId;
      
      console.log(`[Tastytrade] Order replaced successfully. New order ID: ${newOrderId}`);
      
      return {
        success: true,
        orderId: newOrderId,
        message: `Order replaced successfully (New ID: ${newOrderId})`,
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
    try {
      // Parse option symbol to extract underlying
      const underlyingMatch = optionSymbol.match(/^([A-Z]+)/);
      const underlyingSymbol = underlyingMatch ? underlyingMatch[1] : optionSymbol.substring(0, 6).trim();

      // Ensure option symbol has proper spacing for Tastytrade API
      // OCC format requires 6-char ticker padded with spaces
      let formattedSymbol = optionSymbol.replace(' ', '');
      const match = formattedSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
      if (match) {
        const ticker = match[1].padEnd(6, ' ');
        const rest = match[2] + match[3] + match[4];
        formattedSymbol = ticker + rest;
      }

      const orderPayload = {
        'time-in-force': 'Day',
        'order-type': 'Limit',
        'underlying-symbol': underlyingSymbol,
        price: price.toFixed(2),
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

      console.log(`[Tastytrade] ${dryRun ? 'Dry run' : 'Submitting'} buy-to-close order:`, {
        account: accountNumber,
        symbol: formattedSymbol,
        quantity,
        price,
      });

      const response = await this.client.post(
        `/accounts/${accountNumber}/orders`,
        orderPayload,
        {
          params: {
            'dry-run': dryRun,
          },
        }
      );

      const orderId = response.data.data?.order?.id || response.data.data?.id;
      
      return {
        success: true,
        orderId: dryRun ? undefined : orderId,
        message: dryRun 
          ? `Dry run successful for ${quantity} contract(s) at $${price.toFixed(2)}`
          : `Order submitted successfully (ID: ${orderId})`,
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.error(`[Tastytrade] Buy-to-close error:`, errorMsg);
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
