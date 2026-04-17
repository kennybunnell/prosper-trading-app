/**
 * Tastytrade API Integration
 * Handles authentication, account management, and order execution
 */

import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';

const TASTYTRADE_API_BASE = 'https://api.tastyworks.com';

export interface TastytradeOAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  expiresAt?: number; // Calculated expiration timestamp
}

// Legacy interface - kept for backward compatibility
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
  'created-at'?: string;
  'realized-day-gain': string;
  'realized-day-gain-effect': string;
  'realized-day-gain-date': string;
  'realized-today': string;
  'realized-today-effect': string;
  'realized-today-date': string;
}

export interface OrderLeg {
  instrumentType: 'Equity' | 'Equity Option' | 'Index Option';
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
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private userId: number | null = null; // For database persistence
  // Legacy fields - kept for backward compatibility
  private sessionToken: string | null = null;
  private rememberToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: TASTYTRADE_API_BASE,
      headers: {
        // DO NOT set default Content-Type here - it breaks OAuth token requests
        // Each endpoint sets its own Content-Type (JSON for API calls, form-urlencoded for OAuth)
        'Connection': 'close', // Force fresh connections (disable keep-alive)
      },
      timeout: 60000, // 60 second timeout for all requests (increased for order status polling)
      // Disable HTTP keep-alive to prevent connection-level rate limiting
      httpAgent: new http.Agent({ keepAlive: false }),
      httpsAgent: new https.Agent({ keepAlive: false }),
    });
       // Add request interceptor for detailed logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[Tastytrade API] ${config.method?.toUpperCase()} ${config.url}`);
        if (config.url === '/oauth/token') {
          console.log('[Tastytrade API] OAuth request headers:', JSON.stringify(config.headers, null, 2));
          console.log('[Tastytrade API] OAuth request data type:', typeof config.data);
          console.log('[Tastytrade API] OAuth request data (first 100 chars):', 
            typeof config.data === 'string' ? config.data.substring(0, 100) : JSON.stringify(config.data).substring(0, 100));
        }
        return config;
      },
      (error) => {
        console.error('[Tastytrade API] Request error:', error.message);
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for detailed logging and automatic token refresh
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[Tastytrade API] ${response.status} ${response.config.url}`);
        // Detect plain-text rate-limit responses (Tastytrade returns "Rate exceeded." as text/plain)
        const contentType = response.headers?.['content-type'] || '';
        const isPlainText = contentType.includes('text/plain') || contentType.includes('text/html');
        if (isPlainText && typeof response.data === 'string') {
          const text = response.data.trim();
          if (text.toLowerCase().includes('rate') || text.toLowerCase().includes('exceeded') || text.toLowerCase().includes('limit')) {
            console.warn(`[Tastytrade API] Rate limit response detected: "${text}" on ${response.config.url}`);
            const rateLimitError: any = new Error(`Rate exceeded. Please wait a moment before retrying.`);
            rateLimitError.isRateLimit = true;
            rateLimitError.response = response;
            return Promise.reject(rateLimitError);
          }
        }
        return response;
      },
      async (error) => {
        console.error(`[Tastytrade API] ${error.response?.status || 'ERROR'} ${error.config?.url}`);
        if (error.response?.data) {
          console.error('[Tastytrade API] Error response:', JSON.stringify(error.response.data));
        }
        // Auto-capture all Tastytrade API errors to the Trading Activity Log
        if (this.userId) {
          try {
            const { writeTradingLog } = await import('./routers-trading-log');
            const endpoint = error.config?.url || 'unknown';
            const status = error.response?.status || 0;
            const errMsg = error.response?.data?.error?.message || error.response?.data?.errors?.[0]?.message || error.message || 'Unknown API error';
            const isAuthError = status === 401 || status === 403;
            const isRateLimit = (error as any).isRateLimit || errMsg.toLowerCase().includes('rate');
            // Skip order submission endpoints — those are already logged by the router with full context
            // (symbol, strategy, strike, expiration, etc.). Logging them here produces empty/duplicate entries.
            const isOrderEndpoint = endpoint.includes('/orders');
            if (!isAuthError && !isRateLimit && !isOrderEndpoint) {
              // Truncate symbol to 50 chars to avoid DB column overflow (endpoint can be very long for batch quote requests)
            const symbolForLog = (endpoint.split('/').pop() || 'api').substring(0, 50);
            await writeTradingLog({ userId: this.userId, action: 'API_ERROR', strategy: 'api_interceptor', symbol: symbolForLog, optionSymbol: '', accountNumber: '', price: '', strike: '', expiration: '', quantity: 0, outcome: 'api_error', errorMessage: `[${status}] ${endpoint.substring(0, 200)}: ${errMsg}`, source: 'Tastytrade API Interceptor' });
            }
          } catch (_logErr) { /* never block the main error path */ }
        }
        const originalRequest = error.config;
        
        // Check if this is a token expiration error
        const isTokenExpiredError = 
          (error.response?.status === 401 || error.response?.status === 403) &&
          (error.response?.data?.error?.message?.includes('invalid') ||
           error.response?.data?.error?.message?.includes('expired') ||
           error.message?.includes('invalid') ||
           error.message?.includes('expired'));
        
        // Prevent infinite retry loop
        if (isTokenExpiredError && !originalRequest._retry) {
          originalRequest._retry = true;
          
          console.log('[Tastytrade API] Token expired, attempting automatic refresh...');
          
          try {
            // Get credentials from database to refresh token
            if (this.userId) {
              const { getApiCredentials } = await import('./db');
              const credentials = await getApiCredentials(this.userId);
              
              if (credentials?.tastytradeClientSecret && credentials?.tastytradeRefreshToken) {
                // Refresh the token
                await this.getAccessToken(
                  credentials.tastytradeRefreshToken,
                  credentials.tastytradeClientSecret,
                  0,
                  credentials.tastytradeClientId || undefined
                );
                
                // Update the Authorization header in the original request
                originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
                
                console.log('[Tastytrade API] Token refreshed successfully, retrying original request...');
                
                // Retry the original request with new token
                return this.client(originalRequest);
              } else {
                console.error('[Tastytrade API] Cannot refresh token: credentials not found');
              }
            } else {
              console.error('[Tastytrade API] Cannot refresh token: userId not set');
            }
          } catch (refreshError: any) {
            console.error('[Tastytrade API] Token refresh failed:', refreshError.message);
            return Promise.reject(refreshError);
          }
        }
        
        return Promise.reject(error);
      }
    );
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
   * Get access token using OAuth2 refresh token with retry logic
   */
  async getAccessToken(refreshToken: string, clientSecret: string, retryCount: number = 0, clientId?: string): Promise<TastytradeOAuth2Token> {
    try {
      // Log current token state BEFORE requesting new token
      console.log('[Tastytrade OAuth2] === TOKEN REFRESH REQUEST START ===');
      console.log('[Tastytrade OAuth2] Current token state:', {
        hasAccessToken: !!this.accessToken,
        accessTokenLength: this.accessToken?.length || 0,
        tokenExpiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : 'not set',
        isExpired: this.isTokenExpired(),
        timeUntilExpiry: this.tokenExpiresAt ? Math.round((this.tokenExpiresAt - Date.now()) / 1000) : 0,
        timestamp: new Date().toISOString(),
      });
      console.log('[Tastytrade] Requesting OAuth2 access token...');
      
      // Tastytrade OAuth2 endpoint requires application/x-www-form-urlencoded (NOT JSON)
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);
      params.append('client_secret', clientSecret);
      if (clientId) {
        params.append('client_id', clientId);
      }
      
      console.log('[Tastytrade] Request params:', {
        grant_type: 'refresh_token',
        refresh_token_length: refreshToken?.length || 0,
        client_secret_length: clientSecret?.length || 0,
        client_id_length: clientId?.length || 0,
      });
      
      const requestBody = params.toString();
      console.log('[Tastytrade OAuth2] Request body (first 100 chars):', requestBody.substring(0, 100));
      console.log('[Tastytrade OAuth2] Request Content-Type: application/x-www-form-urlencoded');
      
      const response = await this.retryWithBackoff(() =>
        this.client.post('/oauth/token', requestBody, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': undefined, // Remove Authorization header for OAuth token requests
          },
        })
      );
      
      console.log('[Tastytrade OAuth2] === FULL API RESPONSE ===');
      console.log('[Tastytrade OAuth2] Response keys:', Object.keys(response.data));
      console.log('[Tastytrade OAuth2] Response data:', JSON.stringify(response.data, null, 2));
      console.log('[Tastytrade OAuth2] Has refresh_token in response?', 'refresh_token' in response.data);
      
      const token: TastytradeOAuth2Token = {
        access_token: response.data.access_token,
        token_type: response.data.token_type,
        expires_in: response.data.expires_in,
        expiresAt: Date.now() + (response.data.expires_in * 1000),
      };
      
      // Store token in memory and set auth header
      this.accessToken = token.access_token;
      this.tokenExpiresAt = token.expiresAt!;
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token.access_token}`;
      
      // Save token to database for persistence across restarts (async, don't block)
      if (this.userId) {
        import('./db').then(async ({ saveAccessToken }) => {
          try {
            await saveAccessToken(this.userId!, token.access_token, new Date(token.expiresAt!));
          } catch (error) {
            console.error('[Tastytrade] Failed to save access token to database:', error);
          }
        }).catch(error => {
          console.error('[Tastytrade] Failed to import saveAccessToken:', error);
        });
      }
      
      console.log('[Tastytrade] OAuth2 access token obtained successfully');
      console.log('[Tastytrade OAuth2] New token state:', {
        accessTokenLength: token.access_token.length,
        tokenType: token.token_type,
        expiresIn: token.expires_in,
        expiresAt: new Date(token.expiresAt!).toISOString(),
        timeUntilExpiry: Math.round(token.expires_in),
        timestamp: new Date().toISOString(),
      });
      console.log('[Tastytrade OAuth2] === TOKEN REFRESH REQUEST SUCCESS ===');
      return token;
    } catch (error: any) {
      console.error('[Tastytrade OAuth2] === TOKEN REFRESH REQUEST FAILED ===');
      console.error('[Tastytrade OAuth2] Error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        errorMessage: error.response?.data?.error?.message || error.message,
        errorData: error.response?.data,
        timestamp: new Date().toISOString(),
      });
      console.error('[Tastytrade] OAuth2 token request failed');
      console.error('[Tastytrade] Error response status:', error.response?.status);
      console.error('[Tastytrade] Error response data:', JSON.stringify(error.response?.data, null, 2));
      console.error('[Tastytrade] Error message:', error.message);
      
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message 
        || error.response?.data?.error 
        || error.response?.data?.message 
        || error.message;

      console.error('[Tastytrade OAuth2] HTTP status:', statusCode);
      console.error('[Tastytrade OAuth2] Error message:', errorMessage);

      // 400 Bad Request — invalid credentials (wrong client_secret, malformed refresh_token, etc.)
      if (statusCode === 400) {
        throw new Error(
          'Tastytrade rejected the credentials (400 Bad Request). ' +
          'Please verify your Client ID, Client Secret, and Refresh Token are correct and were copied in full from your Tastytrade OAuth app. ' +
          'Common causes: (1) refresh token was regenerated and old one is now invalid, ' +
          '(2) client_secret was copied with extra spaces, ' +
          '(3) the OAuth app was deleted and recreated.'
        );
      }

      // 401 Unauthorized — token revoked or expired
      if (statusCode === 401) {
        throw new Error(
          'Tastytrade credentials are unauthorized (401). Your refresh token may have expired. ' +
          'Please go to Settings → Clear All Credentials, then re-enter your credentials.'
        );
      }

      // 403 with insufficient scopes — refresh token expired/revoked
      const is403Error = statusCode === 403;
      const isInsufficientScopes = typeof errorMessage === 'string' && errorMessage.includes('insufficient scopes');
      
      if (is403Error && isInsufficientScopes) {
        throw new Error('Your Tastytrade refresh token has expired or been revoked. Please click "Reconnect Tastytrade" in Settings to re-authenticate.');
      }
      
      // Retry logic for other 403 errors (Tastytrade API instability)
      const maxRetries = 3;
      
      if (is403Error && retryCount < maxRetries) {
        const delay = 2000 * Math.pow(2, retryCount); // 2s, 4s, 8s
        console.log(`[Tastytrade OAuth2] Retrying token refresh (attempt ${retryCount + 1}/${maxRetries}) after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.getAccessToken(refreshToken, clientSecret, retryCount + 1, clientId);
      }
      
      throw new Error(`Tastytrade OAuth2 authentication failed (${statusCode}): ${errorMessage}`);
    }
  }

  /**
   * Check if current access token is expired or about to expire
   */
  isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return true;
    // Consider token expired if less than 1 minute remaining
    return Date.now() >= (this.tokenExpiresAt - 60000);
  }

  /**
   * Legacy login method - deprecated, kept for backward compatibility
   * @deprecated Use getAccessToken() with OAuth2 credentials instead
   */
  async login(username: string, password: string): Promise<TastytradeSession> {
    throw new Error('Username/password authentication is deprecated. Please use OAuth2 authentication with Client ID, Client Secret, and Refresh Token.');
  }

  /**
   * Set user ID for database persistence
   */
  setUserId(userId: number): void {
    this.userId = userId;
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
      return response.data.data?.items || [];
    } catch (error: any) {
      // Tastytrade sometimes returns plain-text "Rate exceeded." — surface a clean message
      if (error.isRateLimit) {
        throw new Error('Rate exceeded. Please wait a moment before retrying.');
      }
      if (error.message?.includes('not valid JSON') || error.message?.includes('Unexpected token')) {
        throw new Error('Rate exceeded. Please wait a moment before retrying.');
      }
      throw new Error(`Failed to fetch working orders: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Submit an order
   */
  async submitOrder(order: CreateOrderRequest): Promise<TastytradeOrder> {
    return this.retryWithBackoff(async () => {
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
            headers: { 'Content-Type': 'application/json' },
          }
        );

        return response.data.data.order;
      } catch (error: any) {
        // Log detailed error for debugging
        console.error('[Tastytrade submitOrder] Error details:', {
          errorCode: error.code,
          errorMessage: error.message,
          responseStatus: error.response?.status,
          responseData: error.response?.data,
        });
        
        // Log the specific errors array if it exists
        if (error.response?.data?.error?.errors) {
          console.error('[Tastytrade submitOrder] Preflight check errors:', JSON.stringify(error.response.data.error.errors, null, 2));
        }
        
        // Extract detailed error message from API response
        let errorMessage = 'Failed to submit order';
        
        // Check for preflight check errors (most common)
        // Tastytrade returns: { error: { code: "...", message: "...", errors: [{ code, message }, ...] } }
        if (error.response?.data?.error?.errors && Array.isArray(error.response.data.error.errors)) {
          const errors = error.response.data.error.errors;
          if (errors.length > 0) {
            // Join ALL error messages so nothing is lost
            const parts = errors.map((e: any) => e.message || e.code).filter(Boolean);
            errorMessage = parts.join(' | ');
          }
        } else if (error.response?.data?.error?.message) {
          errorMessage = error.response.data.error.message;
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        // Attach the full errors array to the thrown error for richer upstream handling
        const richError: any = new Error(errorMessage);
        richError.ttErrors = error.response?.data?.error?.errors || [];
        richError.ttStatus = error.response?.status;
        richError.ttCode = error.response?.data?.error?.code;
        throw richError;
      }
    });
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
        },
        {
          headers: { 'Content-Type': 'application/json' },
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
      // Tastytrade sometimes returns plain-text "Rate exceeded." — surface a clean message
      if (error.isRateLimit) {
        throw new Error('Rate exceeded. Please wait a moment before retrying.');
      }
      // Also catch JSON parse errors from plain-text rate-limit responses
      if (error.message?.includes('not valid JSON') || error.message?.includes('Unexpected token')) {
        throw new Error('Rate exceeded. Please wait a moment before retrying.');
      }
      throw new Error(`Failed to fetch live orders: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get filled orders for an account within a date range.
   * Used for order-ID-based spread leg linkage: each multi-leg order has a single ID
   * that ties all its legs together, giving us authoritative spread pairing.
   *
   * @param accountNumber - Account number
   * @param startDate - Start date (YYYY-MM-DD), defaults to 90 days ago
   * @param perPage - Max orders per page (default 250)
   */
  async getFilledOrders(
    accountNumber: string,
    startDate?: string,
    perPage: number = 250
  ): Promise<any[]> {
    try {
      const start = startDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 90);
        return d.toISOString().split('T')[0];
      })();
      const response = await this.client.get(`/accounts/${accountNumber}/orders`, {
        params: {
          status: 'Filled',
          'start-date': start,
          'per-page': perPage,
        },
      });
      return response.data.data?.items || [];
    } catch (error: any) {
      if (error.isRateLimit) throw new Error('Rate exceeded. Please wait a moment before retrying.');
      if (error.message?.includes('not valid JSON') || error.message?.includes('Unexpected token')) {
        throw new Error('Rate exceeded. Please wait a moment before retrying.');
      }
      // Non-fatal: fall back to empty list so spread detection degrades gracefully
      console.warn(`[Tastytrade] getFilledOrders failed for ${accountNumber}: ${error.response?.data?.error?.message || error.message}`);
      return [];
    }
  }

  /**
   * Get order details by ID
   * Returns order with status (Received, Live, Filled, Cancelled, Rejected, etc.)
   */
  async getOrderById(accountNumber: string, orderId: string): Promise<any> {
    try {
      const response = await this.client.get(`/accounts/${accountNumber}/orders/${orderId}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to fetch order ${orderId}: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get option quotes for multiple symbols
   * Uses the /market-data/by-type endpoint.
   * IMPORTANT: Index options (SPXW, NDXP, XSP, NDX, RUT, etc.) MUST use the
   * 'index-option' parameter type. Using 'equity-option' for these returns no data.
   */
  async getOptionQuotesBatch(symbols: string[]): Promise<Record<string, any>> {
    // Index option underlyings that require 'index-option' parameter type
    const INDEX_UNDERLYINGS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'MRUT', 'XSP', 'VIX', 'DJX', 'XND']);

    // Helper: extract underlying ticker from OCC symbol (strip spaces, take leading alpha chars)
    const getUnderlying = (sym: string): string => {
      const clean = sym.replace(/\s/g, '');
      const m = clean.match(/^([A-Z]+)/);
      return m ? m[1] : '';
    };

    // Deduplicate symbols to avoid redundant API calls
    const uniqueSymbols = Array.from(new Set(symbols));
    // Chunk into batches of 100 to avoid HTTP 414 (Request-URI Too Large)
    // With 692 BPS opportunities × 2 legs = 1384 symbols, batching is essential
    const BATCH_SIZE = 100;
    const allQuotes: Record<string, any> = {};
    for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
      const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);
      try {
        // Build query string: index options use 'index-option', equity options use 'equity-option'
        // Build query string manually using %20 for spaces (NOT + from URLSearchParams.toString())
        // The Tastytrade API requires OCC symbols with spaces encoded as %20, not +
        const queryParts: string[] = [];
        batch.forEach(symbol => {
          const underlying = getUnderlying(symbol);
          const paramType = INDEX_UNDERLYINGS.has(underlying) ? 'index-option' : 'equity-option';
          queryParts.push(`${paramType}=${encodeURIComponent(symbol)}`);
        });
        const queryString = queryParts.join('&');
        const response = await this.client.get(`/market-data/by-type?${queryString}`);
        // Access the items array from response.data.data.items
        const items = response.data?.data?.items || response.data?.data || [];
        const itemsArray = Array.isArray(items) ? items : [items];
        for (const item of itemsArray) {
          if (item && item.symbol) {
            allQuotes[item.symbol] = {
              bid: parseFloat(item.bid) || 0,
              ask: parseFloat(item.ask) || 0,
              mid: parseFloat(item.mid) || 0,
              last: parseFloat(item.last) || 0,
              mark: parseFloat(item.mark) || 0,
            };
          }
        }
      } catch (error: any) {
        console.error(`[Tastytrade] Failed to fetch option quotes batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        // Continue with remaining batches — partial results are better than none
      }
    }
    console.log(`[Tastytrade] Fetched ${Object.keys(allQuotes).length}/${uniqueSymbols.length} option quotes (${Math.ceil(uniqueSymbols.length / BATCH_SIZE)} batches)`);
    return allQuotes;
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
      let newOrder;
      try {
        newOrder = await this.submitOrder(newOrderPayload);
      } catch (submitError: any) {
        const submitMsg = submitError.response?.data?.error?.message || submitError.message || '';
        // Auto-retry: if Tastytrade rejects due to $0.05 increment requirement,
        // snap the price to the nearest $0.05 and retry once.
        if (submitMsg.toLowerCase().includes('increments of $0.05') || submitMsg.toLowerCase().includes('increment')) {
          const snappedNickel = Math.round(newPrice * 20) / 20;
          console.warn(`[Tastytrade] Price $${newPrice.toFixed(2)} rejected for $0.05 increment — auto-retrying with $${snappedNickel.toFixed(2)}`);
          newOrderPayload.price = snappedNickel.toFixed(2);
          newOrder = await this.submitOrder(newOrderPayload);
          console.log(`[Tastytrade] Retry succeeded with snapped price $${snappedNickel.toFixed(2)}`);
        } else {
          throw submitError;
        }
      }
      
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
      console.error('[Tastytrade getBalances] Error fetching balances for account:', accountNumber, JSON.stringify({
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
      }, null, 2));
      
      // Return null instead of throwing - callers should handle missing balances gracefully
      return null;
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
    // NOTE: Tastytrade order submission API requires 'Equity Option' for ALL option legs,
    // including index options like SPX/SPXW/NDX. 'Index Option' is only used in position data responses.
    const { isTrueIndexOption: isBtcIndexOpt } = await import('../shared/orderUtils');
    // Parse option symbol to extract underlying for the order payload
    const underlyingMatch = optionSymbol.match(/^([A-Z]+)/);
    const underlyingSymbol = underlyingMatch ? underlyingMatch[1] : optionSymbol.substring(0, 6).trim();
    const btcInstrumentType: 'Equity Option' = 'Equity Option'; // Always Equity Option for TT order submission

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
          'instrument-type': btcInstrumentType,
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
      
      const response = await this.client.post(endpoint, orderPayload, {
        headers: { 'Content-Type': 'application/json' },
      });

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
      let allTransactions: any[] = [];
      let pageNumber = 0; // Changed from pageOffset to pageNumber
      let hasMore = true;

      // Fetch all pages until we get less than perPage results
      while (hasMore) {
        const params: any = {
          'start-date': startDate,
          'end-date': endDate,
          'per-page': perPage,
          'page-offset': pageNumber, // Use page number (0, 1, 2...) not item offset
        };
        
        console.log(`[Tastytrade Pagination] Fetching page ${pageNumber}...`);

        const response = await this.client.get(
          `/accounts/${accountNumber}/transactions`,
          { params }
        );

        // Log response structure to find pagination metadata
        if (pageNumber === 0) {
          console.log(`[Tastytrade Pagination] Response structure:`, {
            dataKeys: Object.keys(response.data || {}),
            paginationKeys: Object.keys(response.data.pagination || {}),
            pagination: response.data.pagination,
          });
        }

        const items = response.data.data?.items || [];
        allTransactions = allTransactions.concat(items);

        console.log(`[Tastytrade Pagination] Page ${pageNumber}: Fetched ${items.length} transactions (total so far: ${allTransactions.length})`);

        // Check pagination metadata
        const totalPages = response.data.pagination?.['total-pages'] || 1;
        const currentPage = response.data.pagination?.['page-offset'] || 0;
        
        console.log(`[Tastytrade Pagination] API reports: page ${currentPage} of ${totalPages} total pages`);

        // If we got less than perPage results OR we've reached the last page, we're done
        if (items.length < perPage || pageNumber >= totalPages - 1) {
          console.log(`[Tastytrade Pagination] Reached end of data`);
          hasMore = false;
        } else {
          pageNumber++; // Increment page number (not by perPage)
          console.log(`[Tastytrade Pagination] More data available, fetching page ${pageNumber}...`);
        }
      }

      console.log(`[Tastytrade] Total transactions fetched for account ${accountNumber}: ${allTransactions.length}`);
      return allTransactions;
    } catch (error: any) {
      console.error(`[Tastytrade] Transaction history error:`, error.response?.data?.error?.message || error.message);
      throw new Error(`Failed to fetch transaction history: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get tax lot data for a specific position (cost basis, acquisition date, holding period)
   * @param accountNumber - Account number
   * @param symbol - Stock symbol (e.g., 'AAPL', 'TSLA')
   */
  async getTaxLots(accountNumber: string, symbol: string): Promise<any[]> {
    try {
      const response = await this.client.get(
        `/accounts/${accountNumber}/positions/${symbol}/tax-lots`
      );
      return response.data.data?.items || [];
    } catch (error: any) {
      console.error(`[Tastytrade] Tax lots error for ${symbol}:`, error.response?.data?.error?.message || error.message);
      // Return empty array if endpoint doesn't exist or symbol has no tax lots
      return [];
    }
  }

  /**
   * Get realized P&L report from Tastytrade (official tax data)
   * @param accountNumber - Account number
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   */
  async getRealizedPnL(accountNumber: string, startDate: string, endDate: string): Promise<any> {
    try {
      console.log(`[Tastytrade] Fetching P&L for account ${accountNumber}, dates ${startDate} to ${endDate}`);
      const response = await this.client.get(
        `/accounts/${accountNumber}/profit-loss`,
        {
          params: {
            'start-date': startDate,
            'end-date': endDate,
          }
        }
      );
      console.log(`[Tastytrade] P&L response:`, JSON.stringify(response.data, null, 2));
      return response.data.data || {};
    } catch (error: any) {
      console.error(`[Tastytrade] Realized P&L error for ${accountNumber}:`, error.response?.data?.error?.message || error.message);
      console.error(`[Tastytrade] Full error:`, JSON.stringify(error.response?.data || error.message, null, 2));
      // Return empty object if endpoint doesn't exist
      return {};
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
   * Fetch underlying stock quotes in batch
   * @param symbols Array of stock symbols (e.g., ['AAPL', 'MSFT', 'TSLA'])
   * @returns Map of symbol to price
   */
  async getUnderlyingQuotesBatch(symbols: string[]): Promise<Record<string, number>> {
    try {
      const params = new URLSearchParams();
      symbols.forEach(symbol => {
        params.append('equity', symbol);
      });
      
      const response = await this.client.get('/market-data/by-type', {
        params,
        paramsSerializer: (params) => params.toString(),
      });
      
      const quotes: Record<string, number> = {};
      const items = response.data?.data?.items || [];
      
      for (const item of items) {
        if (item && item.symbol) {
          // Prefer last trade price, fall back to mid/mark
          const price = parseFloat(item.last || item.mid || item.mark || '0');
          if (price > 0) {
            quotes[item.symbol] = price;
          }
        }
      }
      
      console.log(`[Tastytrade] Fetched ${Object.keys(quotes).length}/${symbols.length} underlying quotes`);
      return quotes;
    } catch (error: any) {
      console.error('[Tastytrade] Failed to fetch underlying quotes batch:', error.message);
      return {}; // Return empty object on error to allow graceful degradation
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

      // NOTE: Tastytrade order submission API requires 'Equity Option' for ALL option legs.
      const rollInstrumentType: 'Equity Option' = 'Equity Option'; // Always Equity Option for TT order submission

      // ── Determine price-effect for roll order ──────────────────────────────────
      // Tastytrade [6063] Vertical DebitCredit Check validates that the declared
      // price-effect matches the actual net cash flow of the two legs.
      //
      // A standard roll is: BTC (close short) + STO (open new short).
      // The new STO typically collects MORE premium than the BTC costs
      // (rolling out in time or down in strike) → net cash flow is a CREDIT.
      //
      // An unwind roll is: STC (close long) + BTO (open new long).
      // The BTO typically costs MORE than the STC receives → net cash flow is a DEBIT.
      //
      // Rule: BTC + STO → Credit (standard roll-out of a short position)
      //       STC + BTO → Debit  (rolling a long position)
      const rollPriceEffect: 'Credit' | 'Debit' =
        params.closeLeg.action === 'BTC' ? 'Credit' : 'Debit';

      // Build 2-leg order
      const orderPayload = {
        'time-in-force': 'Day',
        'order-type': 'Limit',
        'price-effect': rollPriceEffect, // Credit for BTC+STO roll; Debit for STC+BTO
        legs: [
          {
            'instrument-type': rollInstrumentType,
            symbol: closeSymbol,
            action: params.closeLeg.action,
            quantity: params.closeLeg.quantity,
          },
          {
            'instrument-type': rollInstrumentType,
            symbol: openSymbol,
            action: params.openLeg.action,
            quantity: params.openLeg.quantity,
          },
        ],
      };

      console.log('[Tastytrade] Submitting roll order:', JSON.stringify(orderPayload, null, 2));

      const response = await this.retryWithBackoff(() =>
        this.client.post(`/accounts/${params.accountNumber}/orders`, orderPayload, {
          headers: { 'Content-Type': 'application/json' },
        })
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
      // NOTE: Tastytrade order submission API requires 'Equity Option' for ALL option legs.
      const singleCloseInstrumentType: 'Equity Option' = 'Equity Option'; // Always Equity Option for TT order submission
      
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
            'instrument-type': singleCloseInstrumentType,
            symbol: optionSymbol,
            quantity: params.closeLeg.quantity.toString(),
            action: actionText,
          },
        ],
      };

      console.log('[Tastytrade] Submitting close order:', JSON.stringify(orderPayload, null, 2));

      const response = await this.retryWithBackoff(() =>
        this.client.post(`/accounts/${params.accountNumber}/orders`, orderPayload, {
          headers: { 'Content-Type': 'application/json' },
        })
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

// Per-user instance map — each user gets their own isolated TastytradeAPI instance
// This prevents cross-user token contamination in a multi-tenant environment
const userApiInstances = new Map<number, TastytradeAPI>();

/**
 * Evict the cached API instance for a user so the next call creates a fresh one.
 * Call this whenever credentials are updated to avoid stale token reuse.
 */
export function clearUserInstance(userId: number): void {
  if (userApiInstances.has(userId)) {
    userApiInstances.delete(userId);
    console.log(`[TastytradeAPI] Cleared cached instance for userId: ${userId}`);
  }
}

/**
 * Get or create a per-user TastytradeAPI instance.
 * Each userId gets its own isolated instance with its own access token.
 * @param userId - The user's database ID. If omitted, returns a temporary anonymous instance.
 */
export function getTastytradeAPI(userId?: number): TastytradeAPI {
  if (!userId) {
    // Anonymous/legacy usage — return a temporary instance (not cached)
    // Callers should migrate to passing userId for proper isolation
    return new TastytradeAPI();
  }
  if (!userApiInstances.has(userId)) {
    userApiInstances.set(userId, new TastytradeAPI());
  }
  return userApiInstances.get(userId)!;
}

/**
 * Helper function to authenticate with Tastytrade using OAuth2
 * This replaces the old username/password login method
 */
export async function authenticateTastytrade(
  credentials: {
    tastytradeClientId?: string | null;
    tastytradeClientSecret?: string | null;
    tastytradeRefreshToken?: string | null;
    // Legacy fields - will be removed in future
    tastytradeUsername?: string | null;
    tastytradePassword?: string | null;
  },
  userId?: number
): Promise<TastytradeAPI> {
  console.log('[Tastytrade OAuth2] === AUTHENTICATION START ===');
  console.log('[Tastytrade OAuth2] Credentials check:', {
    hasClientSecret: !!credentials.tastytradeClientSecret,
    clientSecretLength: credentials.tastytradeClientSecret?.length || 0,
    hasRefreshToken: !!credentials.tastytradeRefreshToken,
    refreshTokenLength: credentials.tastytradeRefreshToken?.length || 0,
    timestamp: new Date().toISOString(),
  });
  
  // Get or create the per-user isolated API instance
  const api = getTastytradeAPI(userId);
  
  // Set userId for database persistence (also sets it on new instances)
  if (userId) {
    api.setUserId(userId);
  }
  
  // Check if OAuth2 credentials are available
  if (credentials.tastytradeClientSecret && credentials.tastytradeRefreshToken) {
    // Try to load persisted access token from database
    let loadedToken: { accessToken: string | null; expiresAt: Date | null; } | null = null;
    if (userId) {
      try {
        const { loadAccessToken } = await import('./db');
        loadedToken = await loadAccessToken(userId);
        
        if (loadedToken?.accessToken && loadedToken?.expiresAt) {
          const isExpired = new Date() >= loadedToken.expiresAt;
          console.log('[Tastytrade OAuth2] Loaded persisted token from database:', {
            hasToken: true,
            expiresAt: loadedToken.expiresAt.toISOString(),
            isExpired,
          });
          
          if (!isExpired) {
            // Use persisted token (still valid)
            api['accessToken'] = loadedToken.accessToken;
            api['tokenExpiresAt'] = loadedToken.expiresAt.getTime();
            api['client'].defaults.headers.common['Authorization'] = `Bearer ${loadedToken.accessToken}`;
            console.log('[Tastytrade OAuth2] Using persisted token (no refresh needed)');
            console.log('[Tastytrade OAuth2] === AUTHENTICATION SUCCESS ===');
            return api;
          }
        }
      } catch (error) {
        console.error('[Tastytrade OAuth2] Failed to load persisted token:', error);
      }
    }
    // Use OAuth2 authentication
    const isExpired = api.isTokenExpired();
    console.log('[Tastytrade OAuth2] Token expiration check:', {
      isExpired,
      willRefresh: isExpired,
      timestamp: new Date().toISOString(),
    });
    
    if (isExpired) {
      await api.getAccessToken(
        credentials.tastytradeRefreshToken,
        credentials.tastytradeClientSecret,
        0,
        credentials.tastytradeClientId || undefined
      );
    } else {
      console.log('[Tastytrade OAuth2] Using existing valid token (no refresh needed)');
    }
    
    console.log('[Tastytrade OAuth2] === AUTHENTICATION SUCCESS ===');
    return api;
  }
  
  // Fallback to legacy authentication (will throw error)
  if (credentials.tastytradeUsername && credentials.tastytradePassword) {
    throw new Error('Username/password authentication is deprecated. Please configure OAuth2 credentials in Settings.');
  }
  
  throw new Error('Tastytrade credentials not configured. Please add OAuth2 credentials in Settings.');
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
  userId?: number;
}): Promise<{ orderId: string }> {
  const { userId, ...orderParams } = params;
  const api = getTastytradeAPI(userId);
  return api.submitRollOrder(orderParams);
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
  userId?: number;
}): Promise<{ orderId: string }> {
  const { userId, ...orderParams } = params;
  const api = getTastytradeAPI(userId);
  return api.submitCloseOrder(orderParams);
}
