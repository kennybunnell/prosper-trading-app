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
      throw new Error(`Failed to dry run order: ${error.response?.data?.error?.message || error.message}`);
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
   * Get account balances
   */
  async getBalances(accountNumber: string): Promise<any> {
    try {
      const response = await this.client.get(`/accounts/${accountNumber}/balances`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to fetch balances: ${error.response?.data?.error?.message || error.message}`);
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
