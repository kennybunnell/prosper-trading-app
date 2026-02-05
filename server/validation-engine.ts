/**
 * Core Order Validation Engine
 * 
 * Validates orders against current market data and strategy-specific rules.
 * Works 24/7 even when markets are closed (uses last available data).
 */

import type {
  OrderToValidate,
  OrderValidationResult,
  ValidationCheck,
  ValidationStatus,
  OptionMarketData,
  ValidationSummary,
} from '../shared/validation-types';
import {
  validateCoveredCall,
  validateCashSecuredPut,
  validateBearCallSpread,
  validateBullPutSpread,
  validatePMCC,
} from './validation-strategies';

/**
 * Fetch current market data for an option
 * This uses the Tradier API to get real-time option chain data
 */
export async function fetchOptionMarketData(
  symbol: string,
  strike: number,
  expiration: string,
  optionType: 'call' | 'put'
): Promise<OptionMarketData | null> {
  try {
    const apiKey = process.env.TRADIER_API_KEY;
    if (!apiKey) {
      console.error('[Validation] TRADIER_API_KEY not configured');
      return null;
    }

    // Fetch option chain for the expiration date
    const chainUrl = `https://api.tradier.com/v1/markets/options/chains?symbol=${symbol}&expiration=${expiration}&greeks=false`;
    const chainResponse = await fetch(chainUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!chainResponse.ok) {
      console.error(`[Validation] Failed to fetch option chain: ${chainResponse.statusText}`);
      return null;
    }

    const chainData = await chainResponse.json();
    const options = chainData?.options?.option || [];

    // Find the specific option
    const option = options.find((opt: any) => 
      opt.strike === strike && 
      opt.option_type === optionType
    );

    if (!option) {
      console.warn(`[Validation] Option not found: ${symbol} ${strike} ${expiration} ${optionType}`);
      return null;
    }

    // Fetch current underlying price
    const quoteUrl = `https://api.tradier.com/v1/markets/quotes?symbols=${symbol}`;
    const quoteResponse = await fetch(quoteUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    let underlyingPrice = 0;
    if (quoteResponse.ok) {
      const quoteData = await quoteResponse.json();
      underlyingPrice = quoteData?.quotes?.quote?.last || 0;
    }

    return {
      symbol,
      strike,
      expiration,
      optionType,
      bid: option.bid || 0,
      ask: option.ask || 0,
      mid: ((option.bid || 0) + (option.ask || 0)) / 2,
      underlyingPrice,
      timestamp: new Date(),
      isAvailable: option.bid > 0 && option.ask > 0,
    };
  } catch (error) {
    console.error('[Validation] Error fetching market data:', error);
    return null;
  }
}

/**
 * Calculate fill probability based on price position
 * Returns percentage (0-100) indicating likelihood of fill
 */
export function calculateFillProbability(
  limitPrice: number,
  bid: number,
  ask: number
): number {
  if (bid === 0 || ask === 0) return 0;
  
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  
  // If price is at or better than bid, very high probability
  if (limitPrice <= bid) return 95;
  
  // If price is at or worse than ask, very low probability
  if (limitPrice >= ask) return 5;
  
  // Linear interpolation between bid and ask
  // Closer to bid = higher probability
  const position = (limitPrice - bid) / spread;
  return Math.round(95 - (position * 90)); // 95% at bid, 5% at ask
}

/**
 * Validate that the limit price is within the current bid/ask spread
 */
function validatePriceInSpread(
  order: OrderToValidate,
  marketData: OptionMarketData
): ValidationCheck {
  const { limitPrice } = order;
  const { bid, ask, mid } = marketData;
  
  // Check if price is within spread
  if (limitPrice >= bid && limitPrice <= ask) {
    const fillProb = calculateFillProbability(limitPrice, bid, ask);
    return {
      id: 'price_in_spread',
      name: 'Price within bid/ask spread',
      status: 'valid',
      severity: 'success',
      message: `Limit price $${limitPrice.toFixed(2)} is within spread ($${bid.toFixed(2)} - $${ask.toFixed(2)}). Fill probability: ${fillProb}%`,
      details: { fillProbability: fillProb, bid, ask, mid },
    };
  }
  
  // Price outside spread
  if (limitPrice < bid) {
    return {
      id: 'price_in_spread',
      name: 'Price within bid/ask spread',
      status: 'warning',
      severity: 'warning',
      message: `Limit price $${limitPrice.toFixed(2)} is below bid $${bid.toFixed(2)}. May fill immediately at worse price.`,
      details: { fillProbability: 95, bid, ask, mid },
    };
  }
  
  return {
    id: 'price_in_spread',
    name: 'Price within bid/ask spread',
    status: 'warning',
    severity: 'warning',
    message: `Limit price $${limitPrice.toFixed(2)} is above ask $${ask.toFixed(2)}. Low fill probability.`,
    details: { fillProbability: 5, bid, ask, mid },
  };
}

/**
 * Validate that the strike is available in the current option chain
 */
function validateStrikeAvailable(
  order: OrderToValidate,
  marketData: OptionMarketData | null
): ValidationCheck {
  if (!marketData) {
    return {
      id: 'strike_available',
      name: 'Strike available in option chain',
      status: 'error',
      severity: 'error',
      message: `Unable to verify strike availability. Market data unavailable.`,
    };
  }
  
  if (!marketData.isAvailable) {
    return {
      id: 'strike_available',
      name: 'Strike available in option chain',
      status: 'error',
      severity: 'error',
      message: `Strike $${order.strike} is not available for trading (no bid/ask).`,
    };
  }
  
  return {
    id: 'strike_available',
    name: 'Strike available in option chain',
    status: 'valid',
    severity: 'success',
    message: `Strike $${order.strike} is available for trading.`,
  };
}

/**
 * Check market data freshness
 */
function validateDataFreshness(
  marketData: OptionMarketData | null
): ValidationCheck {
  if (!marketData) {
    return {
      id: 'data_freshness',
      name: 'Market data freshness',
      status: 'warning',
      severity: 'warning',
      message: 'Market data unavailable. Cannot validate current prices.',
    };
  }
  
  const ageSeconds = Math.floor((Date.now() - marketData.timestamp.getTime()) / 1000);
  
  if (ageSeconds < 60) {
    return {
      id: 'data_freshness',
      name: 'Market data freshness',
      status: 'valid',
      severity: 'info',
      message: `Market data is current (${ageSeconds}s old).`,
      details: { ageSeconds },
    };
  }
  
  if (ageSeconds < 300) {
    return {
      id: 'data_freshness',
      name: 'Market data freshness',
      status: 'valid',
      severity: 'info',
      message: `Market data is recent (${Math.floor(ageSeconds / 60)}m old).`,
      details: { ageSeconds },
    };
  }
  
  return {
    id: 'data_freshness',
    name: 'Market data freshness',
    status: 'warning',
    severity: 'warning',
    message: `Market data is stale (${Math.floor(ageSeconds / 60)}m old). Prices may have changed.`,
    details: { ageSeconds },
  };
}

/**
 * Validate a single order
 */
export async function validateOrder(
  order: OrderToValidate,
  availableBuyingPower: number = 0,
  additionalContext?: { leapStrike?: number; leapExpiration?: string }
): Promise<OrderValidationResult> {
  const checks: ValidationCheck[] = [];
  
  // Use current market data from UI if provided, otherwise fetch fresh data
  let marketData: OptionMarketData | null = null;
  
  if (order.currentBid !== undefined && order.currentAsk !== undefined && order.currentMid !== undefined && order.currentUnderlyingPrice !== undefined) {
    // Use current market data from UI
    marketData = {
      symbol: order.symbol,
      strike: order.strike,
      expiration: order.expiration,
      optionType: order.optionType,
      bid: order.currentBid,
      ask: order.currentAsk,
      mid: order.currentMid,
      underlyingPrice: order.currentUnderlyingPrice,
      timestamp: new Date(),
      isAvailable: true,
    };
  } else {
    // Fetch fresh market data from API
    marketData = await fetchOptionMarketData(
      order.symbol,
      order.strike,
      order.expiration,
      order.optionType
    );
  }
  
  // Run core validation checks
  checks.push(validateStrikeAvailable(order, marketData));
  checks.push(validateDataFreshness(marketData));
  
  if (marketData) {
    checks.push(validatePriceInSpread(order, marketData));
  }
  
  // Run strategy-specific validation checks
  if (order.strategy === 'cc') {
    checks.push(...validateCoveredCall(order, marketData));
  } else if (order.strategy === 'csp') {
    checks.push(...validateCashSecuredPut(order, marketData, availableBuyingPower));
  } else if (order.strategy === 'bcs' && order.longStrike) {
    // Fetch market data for long strike
    const longMarketData = await fetchOptionMarketData(
      order.symbol,
      order.longStrike,
      order.expiration,
      order.optionType
    );
    checks.push(...validateBearCallSpread(order, marketData, longMarketData, availableBuyingPower));
  } else if (order.strategy === 'bps' && order.longStrike) {
    // Fetch market data for long strike
    const longMarketData = await fetchOptionMarketData(
      order.symbol,
      order.longStrike,
      order.expiration,
      order.optionType
    );
    checks.push(...validateBullPutSpread(order, marketData, longMarketData, availableBuyingPower));
  } else if (order.strategy === 'pmcc' && additionalContext?.leapStrike && additionalContext?.leapExpiration) {
    checks.push(...validatePMCC(order, marketData, additionalContext.leapStrike, additionalContext.leapExpiration));
  }
  
  // Determine overall status (worst status from all checks)
  const hasError = checks.some(c => c.status === 'error');
  const hasWarning = checks.some(c => c.status === 'warning');
  const overallStatus: ValidationStatus = hasError ? 'error' : hasWarning ? 'warning' : 'valid';
  
  return {
    orderId: order.id,
    status: overallStatus,
    checks,
    timestamp: new Date(),
    dataAge: marketData ? Math.floor((Date.now() - marketData.timestamp.getTime()) / 1000) : undefined,
  };
}

/**
 * Validate multiple orders in parallel
 */
export async function validateOrders(
  orders: OrderToValidate[],
  availableBuyingPower: number = 0
): Promise<OrderValidationResult[]> {
  return Promise.all(orders.map(order => validateOrder(order, availableBuyingPower)));
}

/**
 * Generate validation summary from results
 */
export function generateValidationSummary(
  results: OrderValidationResult[]
): ValidationSummary {
  const total = results.length;
  const valid = results.filter(r => r.status === 'valid').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const errors = results.filter(r => r.status === 'error').length;
  const pending = results.filter(r => r.status === 'pending').length;
  
  const avgDataAge = results.reduce((sum, r) => sum + (r.dataAge || 0), 0) / total;
  
  return {
    total,
    valid,
    warnings,
    errors,
    pending,
    timestamp: new Date(),
    avgDataAge,
  };
}
