/**
 * Tradier API Integration
 * Handles market data, option chains, quotes, and Greeks
 */

import axios, { AxiosInstance } from 'axios';

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
}

export class TradierAPI {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string, useSandbox: boolean = false) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: useSandbox ? TRADIER_SANDBOX_BASE : TRADIER_API_BASE,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
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
      const response = await this.client.get('/markets/options/expirations', {
        params: { symbol },
      });

      const expirations = response.data.expirations?.date;
      if (!expirations) return [];
      
      return Array.isArray(expirations) ? expirations : [expirations];
    } catch (error: any) {
      throw new Error(`Failed to fetch expirations: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
  }

  /**
   * Get quote for a symbol (stock or option)
   */
  async getQuote(symbol: string): Promise<Quote> {
    try {
      const response = await this.client.get('/markets/quotes', {
        params: { symbols: symbol },
      });

      const quote = response.data.quotes?.quote;
      if (!quote) {
        throw new Error('Quote not found');
      }

      return Array.isArray(quote) ? quote[0] : quote;
    } catch (error: any) {
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
    try {
      const response = await this.client.get('/markets/history', {
        params: {
          symbol,
          interval,
          start,
          end,
        },
      });

      const history = response.data.history?.day;
      if (!history) return [];
      
      return Array.isArray(history) ? history : [history];
    } catch (error: any) {
      throw new Error(`Failed to fetch historical data: ${error.response?.data?.fault?.faultstring || error.message}`);
    }
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
      };
    } catch (error: any) {
      console.error(`Failed to calculate technical indicators for ${symbol}:`, error.message);
      return {
        rsi: null,
        bollingerBands: null,
        movingAverage: null,
        week52Range: null,
      };
    }
  }

  /**
   * Check if market is open
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
}

// Factory function for creating Tradier API instances
export function createTradierAPI(apiKey: string, useSandbox: boolean = false): TradierAPI {
  return new TradierAPI(apiKey, useSandbox);
}
