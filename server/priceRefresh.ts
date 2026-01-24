import { TradierAPI } from "./tradier";

/**
 * Refresh stock prices using Tradier API
 * Returns map of symbol -> price
 */
export async function refreshPrices(tradierAPI: TradierAPI, symbols: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  
  if (symbols.length === 0) {
    return priceMap;
  }

  try {
    // Fetch quotes from Tradier (supports comma-separated symbols)
    const quotes = await tradierAPI.getQuotes(symbols);
    
    if (!quotes || !Array.isArray(quotes)) {
      console.error('Invalid quotes response from Tradier');
      return priceMap;
    }

    // Extract prices from quotes
    for (const quote of quotes) {
      if (quote.symbol && typeof quote.last === 'number') {
        priceMap.set(quote.symbol, quote.last);
      }
    }

    return priceMap;
  } catch (error) {
    console.error('Error refreshing prices:', error);
    return priceMap;
  }
}

/**
 * Categorize portfolio size based on stock price
 * Small: $0-$50
 * Medium: $51-$150
 * Large: $151+
 */
export function categorizePortfolioSize(price: number): 'small' | 'medium' | 'large' {
  if (price <= 50) {
    return 'small';
  } else if (price <= 150) {
    return 'medium';
  } else {
    return 'large';
  }
}
