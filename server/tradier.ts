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
      timeout: 30000, // 30 second timeout per request
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
    minOI: number = 50
  ): Promise<CSPOpportunity[]> {
    console.log(`[Tradier API] Fetching CSP opportunities for ${symbols.length} symbols with parallel processing...`);
    
    // Process symbols in parallel with concurrency limit of 5
    const CONCURRENCY = 5;
    const allOpportunities: CSPOpportunity[] = [];
    
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      console.log(`[Tradier API] Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(symbols.length / CONCURRENCY)} (symbols: ${batch.join(', ')})`);
      
      // Wrap each symbol fetch with a timeout to prevent hanging
      const batchPromises = batch.map(symbol => 
        Promise.race([
          this.fetchSymbolOpportunities(
            symbol,
            minDelta,
            maxDelta,
            minDte,
            maxDte,
            minVolume,
            minOI
          ),
          new Promise<CSPOpportunity[]>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after 15s`)), 15000)
          )
        ])
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          allOpportunities.push(...result.value);
          console.log(`[Tradier API] ✓ ${batch[idx]}: found ${result.value.length} opportunities`);
        } else {
          console.error(`[Tradier API] ✗ ${batch[idx]}: ${result.reason}`);
        }
      });
    }
    
    console.log(`[Tradier API] Completed: ${allOpportunities.length} total opportunities from ${symbols.length} symbols`);
    return allOpportunities;
  }

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
    minOI: number
  ): Promise<CSPOpportunity[]> {
    const opportunities: CSPOpportunity[] = [];
    const today = new Date();
    
    try {
        // Get all expirations for this symbol
        const expirations = await this.getExpirations(symbol);
        
        // Filter expirations by DTE range
        const today = new Date();
        const filteredExpirations = expirations.filter((exp) => {
          const expDate = new Date(exp);
          const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return dte >= minDte && dte <= maxDte;
        });

        if (filteredExpirations.length === 0) return opportunities;

        // Get current stock price
        const quote = await this.getQuote(symbol);
        const underlyingPrice = quote.last;

        // Get technical indicators
        const indicators = await this.getTechnicalIndicators(symbol);

        // Collect IV values from all options to calculate IV Rank
        const allIVValues: number[] = [];

        // Fetch option chains for each expiration
        for (const expiration of filteredExpirations) {
          const options = await this.getOptionChain(symbol, expiration, true);

          // Collect IV values from all options (puts and calls)
          for (const opt of options) {
            if (opt.greeks?.mid_iv && opt.greeks.mid_iv > 0) {
              allIVValues.push(opt.greeks.mid_iv);
            }
          }

          // Filter for put options
          const puts = options.filter((opt) => opt.option_type === 'put');

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
            const collateral = strike * 100; // Per contract
            const roc = (bid * 100 / collateral) * 100; // Return on collateral %

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
              symbol,
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
            });
          }
        }
    } catch (error: any) {
      console.error(`[Tradier API] ✗ ${symbol}: Error: ${error.message}`);
      // Return empty array instead of throwing to allow other symbols to continue
      return [];
    }

    return opportunities;
  }

  /**
   * Fetch Covered Call opportunities for multiple symbols (only for owned stocks)
   * This is the main method used by the CC Dashboard
   */
  async fetchCCOpportunities(
    symbols: string[],
    minDelta: number = 0.30,
    maxDelta: number = 0.60,
    minDte: number = 7,
    maxDte: number = 45,
    minVolume: number = 5,
    minOI: number = 50
  ): Promise<CSPOpportunity[]> {
    console.log(`[Tradier API] Fetching CC opportunities for ${symbols.length} symbols with parallel processing...`);
    
    // Process symbols in parallel with concurrency limit of 5
    const CONCURRENCY = 5;
    const allOpportunities: CSPOpportunity[] = [];
    
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      console.log(`[Tradier API] Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(symbols.length / CONCURRENCY)} (symbols: ${batch.join(', ')})`);
      
      // Wrap each symbol fetch with a timeout to prevent hanging
      const batchPromises = batch.map(symbol => 
        Promise.race([
          this.fetchSymbolCCOpportunities(
            symbol,
            minDelta,
            maxDelta,
            minDte,
            maxDte,
            minVolume,
            minOI
          ),
          new Promise<CSPOpportunity[]>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after 15s`)), 15000)
          )
        ])
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          allOpportunities.push(...result.value);
          console.log(`[Tradier API] ✓ ${batch[idx]}: found ${result.value.length} opportunities`);
        } else {
          console.error(`[Tradier API] ✗ ${batch[idx]}: ${result.reason}`);
        }
      });
    }
    
    console.log(`[Tradier API] Completed: ${allOpportunities.length} total CC opportunities from ${symbols.length} symbols`);
    return allOpportunities;
  }

  /**
   * Fetch CC opportunities for a single symbol
   * Used internally by fetchCCOpportunities for parallel processing
   */
  private async fetchSymbolCCOpportunities(
    symbol: string,
    minDelta: number,
    maxDelta: number,
    minDte: number,
    maxDte: number,
    minVolume: number,
    minOI: number
  ): Promise<any[]> {
    const opportunities: any[] = [];
    const today = new Date();
    
    try {
        // Get all expirations for this symbol
        const expirations = await this.getExpirations(symbol);
        
        // Filter expirations by DTE range
        const today = new Date();
        const filteredExpirations = expirations.filter((exp) => {
          const expDate = new Date(exp);
          const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return dte >= minDte && dte <= maxDte;
        });

        if (filteredExpirations.length === 0) return opportunities;

        // Get current stock price
        const quote = await this.getQuote(symbol);
        const underlyingPrice = quote.last;

        // Get technical indicators
        const indicators = await this.getTechnicalIndicators(symbol);

        // Collect IV values from all options to calculate IV Rank
        const allIVValues: number[] = [];

        // Fetch option chains for each expiration
        for (const expiration of filteredExpirations) {
          const options = await this.getOptionChain(symbol, expiration, true);

          // Collect IV values from all options (puts and calls)
          for (const opt of options) {
            if (opt.greeks?.mid_iv && opt.greeks.mid_iv > 0) {
              allIVValues.push(opt.greeks.mid_iv);
            }
          }

          // Filter for CALL options (opposite of CSP)
          const calls = options.filter((opt) => opt.option_type === 'call');

          for (const call of calls) {
            const delta = Math.abs(call.greeks?.delta || 0);
            const volume = call.volume || 0;
            const oi = call.open_interest || 0;
            let bid = call.bid || 0;
            const ask = call.ask || 0;
            const strike = call.strike || 0;
            const theta = call.greeks?.theta || 0;

            // Apply delta filter
            if (delta < minDelta || delta > maxDelta) continue;

            // Volume and OI filters removed - let client-side handle these for flexibility

            // Handle bid = 0 (use mid-price)
            if (bid <= 0 && ask > 0) {
              bid = ask / 2;
            }

            // Validate data
            if (bid <= 0 || strike <= 0) continue;

            // Calculate DTE
            const expDate = new Date(call.expiration_date);
            const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (dte <= 0) continue;

            // Calculate metrics
            const mid = (bid + ask) / 2;
            const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
            const returnPct = (mid / underlyingPrice) * 100; // Premium as % of stock price
            const weeklyReturn = (returnPct / dte) * 7; // Weekly return %
            const distanceOtm = ((strike - underlyingPrice) / underlyingPrice) * 100; // Distance OTM as %
            const collateral = underlyingPrice * 100; // Stock value per 100 shares
            const roc = (mid * 100 / collateral) * 100; // Return on collateral %

            // Calculate IV Rank for this option
            let ivRank: number | null = null;
            if (allIVValues.length >= 10 && call.greeks?.mid_iv && call.greeks.mid_iv > 0) {
              const currentIV = call.greeks.mid_iv;
              const minIV = Math.min(...allIVValues);
              const maxIV = Math.max(...allIVValues);
              
              if (maxIV > minIV) {
                ivRank = Math.round(((currentIV - minIV) / (maxIV - minIV)) * 100);
              }
            }

            opportunities.push({
              symbol,
              optionSymbol: call.symbol, // Use actual option symbol from Tradier
              strike,
              currentPrice: underlyingPrice,
              expiration: call.expiration_date,
              dte,
              premium: Math.round(mid * 100) / 100,
              bid,
              ask,
              mid: Math.round(mid * 100) / 100,
              returnPct: Math.round(returnPct * 100) / 100,
              weeklyReturn: Math.round(weeklyReturn * 100) / 100,
              distanceOtm: Math.round(distanceOtm * 100) / 100,
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
              sharesOwned: 0, // Will be filled in by router
              maxContracts: 0, // Will be filled in by router
              score: 0, // Will be filled in by scoring
            });
          }
        }
    } catch (error: any) {
      console.error(`[Tradier API] ✗ ${symbol}: Error: ${error.message}`);
      // Return empty array instead of throwing to allow other symbols to continue
      return [];
    }

    return opportunities;
  }
}

// Factory function for creating Tradier API instances
export function createTradierAPI(apiKey: string, useSandbox: boolean = false): TradierAPI {
  return new TradierAPI(apiKey, useSandbox);
}
