/**
 * Tradier API Integration
 * Handles market data, option chains, quotes, and Greeks
 */

import axios, { AxiosInstance } from 'axios';
import { getContractMultiplier } from '../shared/orderUtils';

const TRADIER_API_BASE = 'https://api.tradier.com/v1';
const TRADIER_SANDBOX_BASE = 'https://sandbox.tradier.com/v1';

export interface OptionChain {
  symbol: string;
  options: OptionContract[];
}

export interface OptionContract {
  symbol: string;
  description: string;
  exch: string;
  type: 'call' | 'put';
  last: number;
  change: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
  underlying: string;
  strike: number;
  greeks?: OptionGreeks;
  change_percentage: number;
  average_volume: number;
  last_volume: number;
  trade_date: number;
  prevclose: number;
  week_52_high: number;
  week_52_low: number;
  bidsize: number;
  bidexch: string;
  bid_date: number;
  asksize: number;
  askexch: string;
  ask_date: number;
  open_interest: number;
  contract_size: number;
  expiration_date: string;
  expiration_type: string;
  option_type: string;
  root_symbol: string;
}

export interface OptionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  phi: number;
  bid_iv: number;
  mid_iv: number;
  ask_iv: number;
  smv_vol: number;
  updated_at: string;
}

export interface Quote {
  symbol: string;
  description: string;
  exch: string;
  type: string;
  last: number;
  change: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
  change_percentage: number;
  average_volume: number;
  last_volume: number;
  trade_date: number;
  prevclose: number;
  week_52_high: number;
  week_52_low: number;
  bidsize: number;
  bidexch: string;
  bid_date: number;
  asksize: number;
  askexch: string;
  ask_date: number;
  greeks?: OptionGreeks; // present when quoting option symbols
}

export interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  rsi: number | null;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
  } | null;
  movingAverage: {
    sma20: number;
    sma50: number;
    sma200: number;
    percentFromSMA: number;
  } | null;
  week52Range: {
    high: number;
    low: number;
    current: number;
    percentInRange: number;
  } | null;
  ivRank: number | null;
}

export interface CSPOpportunity {
  symbol: string;
  optionSymbol: string; // Actual option symbol from Tradier API
  strike: number;
  currentPrice: number;
  expiration: string;
  dte: number;
  premium: number;
  bid: number;
  ask: number;
  premiumPct: number;
  weeklyPct: number;
  monthlyPct: number;
  annualPct: number;
  delta: number;
  theta: number;
  volume: number;
  openInterest: number;
  rsi: number | null;
  ivRank: number | null;
  bbPctB: number | null;
  spreadPct: number;
  collateral: number;
  roc: number;
  riskBadges?: any[]; // RiskBadge[] - using any[] to avoid circular import
  multiplier?: number; // Contract multiplier: 100 for standard, 10 for mini-index (MRUT, XSP, XND, DJX)
}

export class TradierAPI {
  private client: AxiosInstance;
  private apiKey: string;
  private userId: number | null = null;

  constructor(apiKey: string, useSandbox: boolean = false, userId?: number) {
    this.apiKey = apiKey;
    this.userId = userId ?? null;
    this.client = axios.create({
      baseURL: useSandbox ? TRADIER_SANDBOX_BASE : TRADIER_API_BASE,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      timeout: 30000, // 30 second timeout per request
    });
    // Auto-capture all Tradier API errors to the Trading Activity Log
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (this.userId) {
          try {
            const { writeTradingLog } = await import('./routers-trading-log');
            const endpoint = error.config?.url || 'unknown';
            const status = error.response?.status || 0;
            const errMsg = error.response?.data?.fault?.faultstring || error.message || 'Unknown Tradier API error';
            const isAuthError = status === 401 || status === 403;
            // Skip order endpoints — those are logged by routers with full context
            const isOrderEndpoint = endpoint.includes('/orders');
            if (!isAuthError && !isOrderEndpoint) {
              await writeTradingLog({ userId: this.userId, action: 'API_ERROR', strategy: 'api_interceptor', symbol: endpoint.split('/').pop() || 'api', optionSymbol: '', accountNumber: '', price: '', strike: '', expiration: '', quantity: 0, outcome: 'api_error', errorMessage: `[${status}] ${endpoint}: ${errMsg}`, source: 'Tradier API Interceptor' });
            }
          } catch (_logErr) { /* never block the main error path */ }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get option chains for a symbol with specific expiration
   */
  async getOptionChain(symbol: string, expiration: string, greeks: boolean = true): Promise<OptionContract[]> {
    try {
      const response = await this.client.get('/markets/options/chains', {
        params: {
          symbol,
          expiration,
          greeks,
        },
      });

      const options = response.data.options?.option;
      if (!options) return [];
      
      return Array.isArray(options) ? options : [options];
    } catch (error: any) {
      throw new Error(`Failed to fetch option chain: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Get all available expiration dates for a symbol
   */
  async getExpirations(symbol: string): Promise<string[]> {
    try {
      // includeAllRoots=true is critical for index option series:
      // Without it, SPX only returns standard monthly expirations (not SPXW weeklies).
      // NDX only returns standard monthly (not NDXP PM-settled weeklies).
      const response = await this.client.get('/markets/options/expirations', {
        params: { symbol, includeAllRoots: true },
      });

      console.log(`[Tradier getExpirations] ${symbol} raw response:`, JSON.stringify(response.data));

      const expirations = response.data.expirations?.date;
      if (!expirations) {
        console.log(`[Tradier getExpirations] ${symbol}: no expirations in response (null/undefined)`);
        return [];
      }
      
      const result = Array.isArray(expirations) ? expirations : [expirations];
      console.log(`[Tradier getExpirations] ${symbol}: ${result.length} expirations found`);
      return result;
    } catch (error: any) {
      console.error(`[Tradier getExpirations] ${symbol} error:`, error.response?.data, error.message);
      throw new Error(`Failed to fetch expirations: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Get quote for a symbol (stock or option)
   */
  async getQuote(symbol: string): Promise<Quote> {
    try {
      console.log('[Tradier API] Fetching quote for symbol:', symbol);
      console.log('[Tradier API] API Key (first 10 chars):', this.apiKey.substring(0, 10) + '...');
      console.log('[Tradier API] Base URL:', this.client.defaults.baseURL);
      
      const response = await this.client.get('/markets/quotes', {
        params: { symbols: symbol },
      });

      console.log('[Tradier API] Response status:', response.status);
      console.log('[Tradier API] Response data:', JSON.stringify(response.data));

      const quote = response.data.quotes?.quote;
      if (!quote) {
        throw new Error('Quote not found');
      }

      return Array.isArray(quote) ? quote[0] : quote;
    } catch (error: any) {
      console.error('[Tradier API] Error details:');
      console.error('  - Status:', error.response?.status);
      console.error('  - Status Text:', error.response?.statusText);
      console.error('  - Headers:', JSON.stringify(error.response?.headers));
      console.error('  - Data:', JSON.stringify(error.response?.data));
      console.error('  - Message:', error.message);
      
      // Provide more specific error messages based on status code
      if (error.response?.status === 401) {
        throw new Error(`Authentication failed: Invalid or expired API key. Please verify your Tradier API key at developer.tradier.com`);
      }
      
      throw new Error(`Failed to fetch quote: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Get quotes for multiple symbols
   */
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    try {
      const response = await this.client.get('/markets/quotes', {
        params: { symbols: symbols.join(',') },
      });

      const quotes = response.data.quotes?.quote;
      if (!quotes) return [];
      
      return Array.isArray(quotes) ? quotes : [quotes];
    } catch (error: any) {
      throw new Error(`Failed to fetch quotes: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Get historical data for technical indicators
   */
  async getHistoricalData(symbol: string, interval: string = 'daily', start?: string, end?: string): Promise<HistoricalData[]> {
    const maxRetries = 2;
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.get('/markets/history', {
          params: { symbol, interval, start, end },
          timeout: 60000, // 60s timeout for history (larger payload than option chains)
        });
        const history = response.data.history?.day;
        if (!history) return [];
        return Array.isArray(history) ? history : [history];
      } catch (error: any) {
        lastError = error;
        if (attempt < maxRetries && (error.code === 'ECONNABORTED' || error.message?.includes('timeout'))) {
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(`Failed to fetch historical data: ${error.response?.data?.fault?.faultstring || error.message}`);
      }
    }
    throw new Error(`Failed to fetch historical data after ${maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  calculateRSI(prices: number[], period: number = 14): number | null {
    if (prices.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate subsequent values using smoothing
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
  } | null {
    if (prices.length < period) return null;

    const recentPrices = prices.slice(-period);
    const middle = recentPrices.reduce((a, b) => a + b, 0) / period;

    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    const upper = middle + (stdDev * standardDeviation);
    const lower = middle - (stdDev * standardDeviation);

    const currentPrice = prices[prices.length - 1];
    const percentB = (currentPrice - lower) / (upper - lower);

    return { upper, middle, lower, percentB };
  }

  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(prices: number[], period: number): number | null {
    if (prices.length < period) return null;
    const recentPrices = prices.slice(-period);
    return recentPrices.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Get comprehensive technical indicators for a symbol
   */
  async getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators> {
    try {
      // Get 200 days of historical data for comprehensive analysis
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 250); // Extra buffer for calculations

      const history = await this.getHistoricalData(
        symbol,
        'daily',
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );

      if (history.length === 0) {
        return {
          rsi: null,
          bollingerBands: null,
          movingAverage: null,
          week52Range: null,
          ivRank: null,
        };
      }

      const closePrices = history.map(d => d.close);
      const currentPrice = closePrices[closePrices.length - 1];

      // Calculate RSI
      const rsi = this.calculateRSI(closePrices);

      // Calculate Bollinger Bands
      const bollingerBands = this.calculateBollingerBands(closePrices);

      // Calculate Moving Averages
      const sma20 = this.calculateSMA(closePrices, 20);
      const sma50 = this.calculateSMA(closePrices, 50);
      const sma200 = this.calculateSMA(closePrices, 200);
      const percentFromSMA = sma20 ? ((currentPrice - sma20) / sma20) * 100 : 0;

      // Calculate 52-week range
      const year52Prices = closePrices.slice(-252); // ~252 trading days in a year
      const week52High = Math.max(...year52Prices);
      const week52Low = Math.min(...year52Prices);
      const percentInRange = ((currentPrice - week52Low) / (week52High - week52Low)) * 100;

      return {
        rsi,
        bollingerBands,
        movingAverage: sma20 && sma50 && sma200 ? {
          sma20,
          sma50,
          sma200,
          percentFromSMA,
        } : null,
        week52Range: {
          high: week52High,
          low: week52Low,
          current: currentPrice,
          percentInRange,
        },
        ivRank: null, // Calculated per-opportunity from option chain data
      };
    } catch (error: any) {
      console.error(`Failed to calculate technical indicators for ${symbol}:`, error.message);
      return {
        rsi: null,
        bollingerBands: null,
        movingAverage: null,
        week52Range: null,
        ivRank: null,
      };
    }
  }

  /**
   * Get account balance and buying power
   */
  async getAccountBalance(accountId: string): Promise<{
    totalEquity: number;
    accountType: string;
    totalCash: number;
    optionBuyingPower: number;
  }> {
    try {
      const response = await this.client.get(`/accounts/${accountId}/balances`);
      
      console.log('[Tradier] Raw API response:', JSON.stringify(response.data, null, 2));
      
      const balances = response.data.balances;
      if (!balances) {
        console.error('[Tradier] Balance data not found. Response structure:', Object.keys(response.data));
        throw new Error('Balance data not found in response');
      }
      
      return {
        totalEquity: balances.total_equity || 0,
        accountType: balances.account_type || 'unknown',
        totalCash: balances.total_cash || 0,
        optionBuyingPower: balances.margin?.option_buying_power || balances.cash?.cash_available || 0,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('Authentication failed: Invalid or expired API key');
      }
      if (error.response?.status === 404) {
        throw new Error('Account not found or access denied');
      }
      throw new Error(`Failed to fetch account balance: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Get earnings calendar for specific symbols
   * Returns upcoming earnings dates within the next 30 days
   */
  async getEarningsCalendar(symbols: string[]): Promise<Map<string, string>> {
    try {
      const earningsMap = new Map<string, string>();
      
      // Tradier calendar endpoint: /markets/calendar
      // Query parameters: month (MM), year (YYYY), symbols (comma-separated)
      const today = new Date();
      const nextMonth = new Date(today);
      nextMonth.setDate(today.getDate() + 30);
      
      // Fetch current month
      const currentMonthResponse = await this.client.get('/markets/calendar', {
        params: {
          month: String(today.getMonth() + 1).padStart(2, '0'),
          year: today.getFullYear(),
        },
      });
      
      // Fetch next month if we're near the end of current month
      let nextMonthResponse = null;
      if (nextMonth.getMonth() !== today.getMonth()) {
        nextMonthResponse = await this.client.get('/markets/calendar', {
          params: {
            month: String(nextMonth.getMonth() + 1).padStart(2, '0'),
            year: nextMonth.getFullYear(),
          },
        });
      }
      
      // Parse earnings from both responses
      const parseEarnings = (response: any) => {
        const calendar = response?.data?.calendar;
        if (!calendar) return;
        
        const days = Array.isArray(calendar.days?.day) ? calendar.days.day : (calendar.days?.day ? [calendar.days.day] : []);
        
        for (const day of days) {
          const date = day.date;
          const earnings = day.earnings?.earning;
          if (!earnings) continue;
          
          const earningsList = Array.isArray(earnings) ? earnings : [earnings];
          
          for (const earning of earningsList) {
            const symbol = earning.symbol;
            if (symbols.includes(symbol) && !earningsMap.has(symbol)) {
              earningsMap.set(symbol, date);
            }
          }
        }
      };
      
      parseEarnings(currentMonthResponse);
      if (nextMonthResponse) {
        parseEarnings(nextMonthResponse);
      }
      
      return earningsMap;
    } catch (error: any) {
      console.error('[Tradier API] Failed to fetch earnings calendar:', error.message);
      // Return empty map on error - don't block the main flow
      return new Map<string, string>();
    }
  }

  /**
   * Get market status (open/closed)
   */
  async getMarketStatus(): Promise<{ open: boolean; description: string }> {
    try {
      const response = await this.client.get('/markets/clock');
      const clock = response.data.clock;
      
      return {
        open: clock.state === 'open',
        description: clock.description,
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch market status: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Fetch CSP opportunities for multiple symbols
   * This is the main method used by the CSP Dashboard
   */
  async fetchCSPOpportunities(
    symbols: string[],
    minDelta: number = 0.15,
    maxDelta: number = 0.35,
    minDte: number = 7,
    maxDte: number = 30,
    minVolume: number = 5,
    minOI: number = 50,
    skipTechnicals: boolean = false,
    onBatchComplete?: (batchNum: number, totalBatches: number, symbolsDone: number, oppsFound: number) => void
  ): Promise<CSPOpportunity[]> {
    console.log(`[Tradier API] Fetching CSP opportunities for ${symbols.length} symbols with parallel processing (skipTechnicals=${skipTechnicals})...`);
    
    // Smart batching: process symbols in batches of BATCH_SIZE.
    // 
    // Why not fully parallel (all 62 at once):
    //   With 62 symbols dispatched simultaneously and only 20 semaphore slots, symbols
    //   queued after position ~20 wait 20-25s just to START their first API call.
    //   A 30s per-symbol timeout fires before they even begin → 58 of 62 symbols time out.
    //
    // Why batches of 20 with 120s timeout:
    //   Batch 1 (20 symbols): all 20 start immediately, complete in ~15-20s.
    //   Batch 2 (20 symbols): start after batch 1, complete in ~15-20s.
    //   Batch 3 (22 symbols): start after batch 2, complete in ~15-20s.
    //   Total: ~45-60s for 62 symbols — well under the 5-min gateway limit.
    //   120s timeout per symbol: generous enough for large index chains (SPX has 300+ contracts)
    //   while still catching genuinely hung requests.
    const BATCH_SIZE = 20;
    const allOpportunities: CSPOpportunity[] = [];
    
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(symbols.length / BATCH_SIZE);
      console.log(`[Tradier API] Batch ${batchNum}/${totalBatches}: dispatching ${batch.length} symbols in parallel (${batch.join(', ')})`);
      
      const batchResults = await Promise.allSettled(
        batch.map(symbol =>
          Promise.race([
            this.fetchSymbolOpportunities(
              symbol,
              minDelta,
              maxDelta,
              minDte,
              maxDte,
              minVolume,
              minOI,
              skipTechnicals
            ),
            new Promise<CSPOpportunity[]>((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout after 120s`)), 120000)
            )
          ])
        )
      );
      
      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          allOpportunities.push(...result.value);
          console.log(`[Tradier API] ✓ ${batch[idx]}: found ${result.value.length} opportunities`);
        } else {
          console.error(`[Tradier API] ✗ ${batch[idx]}: ${result.reason}`);
        }
      });
      
      console.log(`[Tradier API] Batch ${batchNum}/${totalBatches} complete. Running total: ${allOpportunities.length} opportunities.`);
      // Fire progress callback so the scan job manager can update the job status
      if (onBatchComplete) {
        onBatchComplete(batchNum, totalBatches, Math.min((batchNum * BATCH_SIZE), symbols.length), allOpportunities.length);
      }
    }
    
    console.log(`[Tradier API] Completed: ${allOpportunities.length} total opportunities from ${symbols.length} symbols`);
    return allOpportunities;
  }

  /**
   * Mapping from index option series root to the Tradier-quotable underlying symbol.
   * SPXW/SPX options trade on the S&P 500 index, quoted as $SPX.X on Tradier.
   * We use the option root for expirations/chains, but the underlying for price/technicals.
   */
  // Some index option series roots are not directly recognised by Tradier's expirations
  // and option chain endpoints. Map them to the Tradier-recognised root symbol.
  // e.g. SPXW weekly options are listed under SPX on Tradier; NDXP under NDX.
  private static readonly OPTION_ROOT_MAP: Record<string, string> = {
    SPXW:  'SPX',
    SPXPM: 'SPX',
    NDXP:  'NDX',
    VIXW:  'VIX',
  };

  // Tradier uses the plain index ticker (SPX, NDX, RUT) for quotes — NOT the $-prefixed
  // CBOE/Bloomberg notation ($SPX.X, $NDX.X, $RUT.X) which Tradier does not recognise.
  // The option root (SPXW, NDXP, MRUT) is still used for expirations and option chains.
  private static readonly INDEX_UNDERLYING_MAP: Record<string, string> = {
    SPXW:  'SPX',
    SPX:   'SPX',
    SPXPM: 'SPX',
    XSP:   'XSP',
    NDX:   'NDX',
    NDXP:  'NDX',
    XND:   'XND',
    RUT:   'RUT',
    MRUT:  'RUT',
    DJX:   'DJX',
    VIX:   'VIX',
    VIXW:  'VIX',
    OEX:   'OEX',
    XEO:   'OEX',
  };

  /**
   * Fetch CSP opportunities for a single symbol
   * Used internally by fetchCSPOpportunities for parallel processing
   */
  private async fetchSymbolOpportunities(
    symbol: string,
    minDelta: number,
    maxDelta: number,
    minDte: number,
    maxDte: number,
    minVolume: number,
    minOI: number,
    skipTechnicals: boolean = false
  ): Promise<CSPOpportunity[]> {
    console.log(`[CSP fetchSymbolOpportunities] === ENTRY === Symbol: ${symbol}`);
    const opportunities: CSPOpportunity[] = [];
    const today = new Date();

    // For index option series (SPXW, NDXP, MRUT, etc.), the option chain is fetched
    // using the option root symbol, but price quotes and technical indicators must use
    // the underlying index symbol (e.g., SPX for SPXW).
    const underlyingSymbol = TradierAPI.INDEX_UNDERLYING_MAP[symbol.toUpperCase()] || symbol;
    // Some option roots are not recognised by Tradier's expirations endpoint — map to the
    // Tradier-recognised root (e.g. SPXW → SPX, NDXP → NDX).
    const tradierOptionRoot = TradierAPI.OPTION_ROOT_MAP[symbol.toUpperCase()] || symbol;
    const isIndexSeries = underlyingSymbol !== symbol;
    console.log(`[CSP fetchSymbolOpportunities] Symbol: ${symbol}, tradierRoot: ${tradierOptionRoot}, underlying: ${underlyingSymbol}, isIndex: ${isIndexSeries}`);
    
    try {
        // Get all expirations using the Tradier-recognised option root
        const expirations = await this.getExpirations(tradierOptionRoot);
        
        // Filter expirations by DTE range
        const today = new Date();
        const filteredExpirations = expirations.filter((exp) => {
          const expDate = new Date(exp);
          const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return dte >= minDte && dte <= maxDte;
        });

        if (filteredExpirations.length === 0) {
          console.log(`[CSP fetchSymbolOpportunities] ${symbol}: No expirations in DTE range ${minDte}-${maxDte}. Total expirations: ${expirations.length}`);
          return opportunities;
        }
        console.log(`[CSP fetchSymbolOpportunities] ${symbol}: ${filteredExpirations.length} expirations in range: ${filteredExpirations.join(', ')}`);

        // Get current price — use underlying symbol for index series
        const quote = await this.getQuote(underlyingSymbol);
        const underlyingPrice = quote.last;
        console.log(`[CSP fetchSymbolOpportunities] ${symbol}: underlying price = ${underlyingPrice} (from ${underlyingSymbol})`);

        // Get technical indicators — skip for pure index series (no price history on option root)
        // For ETF proxies (SPY, QQQ, IWM) the symbol itself is quotable, so use it directly.
        // skipTechnicals=true bypasses the 200-day history API call (saves ~1-2s per symbol).
        // RSI and Bollinger %B are display-only in the opportunity table; not used in scoring.
        const indicatorSymbol = isIndexSeries ? underlyingSymbol : symbol;
        let indicators: any = { rsi: null, bollingerBands: null };
        if (!skipTechnicals) {
          try {
            indicators = await this.getTechnicalIndicators(indicatorSymbol);
          } catch (indErr: any) {
            console.warn(`[CSP fetchSymbolOpportunities] ${symbol}: getTechnicalIndicators failed for ${indicatorSymbol}: ${indErr.message} — continuing without technicals`);
          }
        } else {
          console.log(`[CSP fetchSymbolOpportunities] ${symbol}: skipping technical indicators (skipTechnicals=true)`);
        }

        // Collect IV values from all options to calculate IV Rank
        const allIVValues: number[] = [];

        // Fetch all expiration chains in PARALLEL for speed — rate-limited to 6 concurrent across all scanners
        console.log(`[CSP fetchSymbolOpportunities] ${symbol}: fetching ${filteredExpirations.length} chains in parallel`);
        const { withRateLimit } = await import('./tradierRateLimiter');
        const chainResults = await Promise.allSettled(
          filteredExpirations.map(exp => withRateLimit(() => this.getOptionChain(tradierOptionRoot, exp, true)))
        );

        const targetRoot = tradierOptionRoot !== symbol ? symbol : null;

        for (let ei = 0; ei < filteredExpirations.length; ei++) {
          const chainResult = chainResults[ei];
          if (chainResult.status === 'rejected') {
            console.warn(`[CSP fetchSymbolOpportunities] ${symbol} ${filteredExpirations[ei]}: chain fetch failed — ${chainResult.reason}`);
            continue;
          }
          const options = chainResult.value;
          const expiration = filteredExpirations[ei];

          // Collect IV values from all options (puts and calls)
          for (const opt of options) {
            if (opt.greeks?.mid_iv && opt.greeks.mid_iv > 0) {
              allIVValues.push(opt.greeks.mid_iv);
            }
          }

          // Filter for put options.
          // When tradierOptionRoot differs from the original symbol (e.g. SPXW→SPX),
          // the chain contains contracts from multiple roots (SPX AM-settled + SPXW PM-settled).
          // Filter to only the original option series root so we don't mix AM and PM settlements.
          const puts = options.filter((opt) => {
            if (opt.option_type !== 'put') return false;
            if (targetRoot && opt.root_symbol && opt.root_symbol !== targetRoot) return false;
            return true;
          });

          for (const put of puts) {
            const delta = Math.abs(put.greeks?.delta || 0);
            const volume = put.volume || 0;
            const oi = put.open_interest || 0;
            let bid = put.bid || 0;
            const ask = put.ask || 0;
            const strike = put.strike || 0;
            const theta = put.greeks?.theta || 0;

            // Apply delta filter
            if (delta < minDelta || delta > maxDelta) continue;

            // Volume and OI filters removed - let client-side handle these for flexibility

            // Handle bid = 0 (use mid-price)
            if (bid <= 0 && ask > 0) {
              bid = ask / 2;
            }

            // Validate data
            if (bid <= 0 || strike <= 0) continue;

            // Hard structural filter: reject ITM puts (strike >= current price).
            // An ITM short put has intrinsic value, making it unsuitable as a
            // cash-secured put — the premium collected would not compensate for
            // immediate assignment risk and the position would show an instant loss.
            if (strike >= underlyingPrice) {
              console.log(`[CSP Scanner] Skipping ITM put ${symbol} ${expiration} strike ${strike} (price=${underlyingPrice})`);
              continue;
            }

            // Calculate DTE
            const expDate = new Date(put.expiration_date);
            const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (dte <= 0) continue;

            // Calculate metrics
            const mid = (bid + ask) / 2;
            const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
            const premiumPct = (bid / strike) * 100;
            const weeklyPct = (premiumPct / dte) * 7;
            const monthlyPct = (premiumPct / dte) * 30;
            const annualPct = (premiumPct / dte) * 365;
            const contractMultiplier = getContractMultiplier(tradierOptionRoot);
            const collateral = strike * contractMultiplier; // Per contract
            const roc = (bid * contractMultiplier / collateral) * 100; // Return on collateral %

            // Calculate IV Rank for this option
            let ivRank: number | null = null;
            if (allIVValues.length >= 10 && put.greeks?.mid_iv && put.greeks.mid_iv > 0) {
              const currentIV = put.greeks.mid_iv;
              const minIV = Math.min(...allIVValues);
              const maxIV = Math.max(...allIVValues);
              
              if (maxIV > minIV) {
                ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
              }
            }

            opportunities.push({
              // Use the original input symbol (e.g. SPXW, NDXP) so opportunities are
              // correctly labelled in the UI. The tradierOptionRoot (SPX, NDX) is only
              // needed for API calls, not for display.
              symbol: symbol,
              optionSymbol: put.symbol, // Use actual option symbol from Tradier
              strike,
              currentPrice: underlyingPrice,
              expiration: put.expiration_date,
              dte,
              premium: Math.round(mid * 100) / 100,
              bid,
              ask,
              premiumPct: Math.round(premiumPct * 100) / 100,
              weeklyPct: Math.round(weeklyPct * 100) / 100,
              monthlyPct: Math.round(monthlyPct * 100) / 100,
              annualPct: Math.round(annualPct * 10) / 10,
              delta: Math.round(delta * 100) / 100,
              theta: Math.round(theta * 1000) / 1000,
              volume,
              openInterest: oi,
              rsi: indicators.rsi ? Math.round(indicators.rsi * 10) / 10 : null,
              ivRank,
              bbPctB: indicators.bollingerBands ? Math.round(indicators.bollingerBands.percentB * 100) / 100 : null,
              spreadPct: Math.round(spreadPct * 10) / 10,
              collateral,
              roc: Math.round(roc * 100) / 100,
              multiplier: contractMultiplier,
            });
          }
        }
    } catch (error: any) {
      console.error(`[Tradier API] ✗ ${symbol}: Error: ${error.message}`);
      // Return empty array instead of throwing to allow other symbols to continue
      return [];
    }

    // Log opportunities before deduplication
    console.log(`[CSP Dedup] ${symbol}: ${opportunities.length} opportunities before dedup`);
    if (opportunities.length > 0) {
      // Log first few for inspection
      const sample = opportunities.slice(0, 3).map(o => `${o.optionSymbol} (${o.strike})`);
      console.log(`[CSP Dedup] ${symbol}: Sample: ${sample.join(', ')}`);
    }
    
    // Deduplicate opportunities by option symbol before returning
    const uniqueOpportunities = new Map<string, CSPOpportunity>();
    const duplicateReport: string[] = [];
    for (const opp of opportunities) {
      const key = opp.optionSymbol;
      if (!uniqueOpportunities.has(key)) {
        uniqueOpportunities.set(key, opp);
      } else {
        const existing = uniqueOpportunities.get(key)!;
        const detail = `optionSymbol=${key} strike=${opp.strike} exp=${opp.expiration} bid=${opp.bid} ask=${opp.ask} (existing: bid=${existing.bid} ask=${existing.ask})`;
        duplicateReport.push(detail);
        console.warn(`[CSP Dedup] ⚠️  DUPLICATE optionSymbol for ${symbol}: ${detail}`);
      }
    }
    
    const dedupedCount = opportunities.length - uniqueOpportunities.size;
    if (dedupedCount > 0) {
      console.warn(`[CSP Dedup] ⚠️  ${symbol}: Removed ${dedupedCount} duplicate(s) from ${opportunities.length} raw results.`);
      console.warn(`[CSP Dedup] Root cause hint: check if fetchCSPOpportunities is called multiple times for ${symbol}, or if the option chain API returned the same contract across multiple expirations.`);
    } else {
      console.log(`[CSP Dedup] ${symbol}: No duplicates (${uniqueOpportunities.size} unique contracts).`);
    }

    return Array.from(uniqueOpportunities.values());
  }
}

// Factory function for creating Tradier API instances
export function createTradierAPI(apiKey: string, useSandbox: boolean = false, userId?: number): TradierAPI {
  return new TradierAPI(apiKey, useSandbox, userId);
}
