/**
 * Tradier API Key Validation Test
 * 
 * Validates that the TRADIER_API_KEY is correctly configured
 * by making a lightweight API call to fetch a stock quote.
 */

import { describe, it, expect } from 'vitest';
import { TradierAPI } from './tradier';

describe('Tradier API Key Validation', () => {
  it('should successfully fetch a quote with valid API key', async () => {
    const apiKey = process.env.TRADIER_API_KEY;
    
    if (!apiKey) {
      throw new Error('TRADIER_API_KEY environment variable is not set');
    }
    
    // Create Tradier client
    const tradier = new TradierAPI(apiKey, false); // Use production API
    
    // Fetch a quote for a well-known symbol (SPY)
    const quote = await tradier.getQuote('SPY');
    
    // Validate response structure
    expect(quote).toBeDefined();
    expect(quote.symbol).toBe('SPY');
    expect(quote.last).toBeGreaterThan(0);
    expect(quote.bid).toBeGreaterThan(0);
    expect(quote.ask).toBeGreaterThan(0);
    
    console.log('[Tradier Test] ✓ API key is valid');
    console.log('[Tradier Test] SPY quote:', {
      last: quote.last,
      bid: quote.bid,
      ask: quote.ask,
    });
  }, 15000); // 15 second timeout for API call
});
