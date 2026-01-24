import { callDataApi } from "./_core/dataApi";

/**
 * Stock metadata enrichment result
 */
export interface StockMetadata {
  symbol: string;
  company: string | null;
  price: string | null;
  sector: string | null;
  type: string | null; // Growth, Value, or Blend
  portfolioSize: "small" | "medium" | "large";
}

/**
 * Enrich a single stock symbol with metadata from Yahoo Finance API
 * @param symbol Stock ticker symbol (e.g., "AAPL")
 * @returns Stock metadata including company name, price, sector, type, and portfolio size
 */
export async function enrichStockMetadata(symbol: string): Promise<StockMetadata> {
  try {
    const response = await callDataApi("YahooFinance/get_stock_chart", {
      query: {
        symbol: symbol.toUpperCase(),
        region: "US",
        interval: "1d",
        range: "1d", // Just need current data
        includeAdjustedClose: "false", // Must be string, not boolean
      },
    });

    const data = response as any; // Yahoo Finance API response type
    if (data && data.chart && data.chart.result && data.chart.result.length > 0) {
      const result = data.chart.result[0];
      const meta = result.meta;

      const price = meta.regularMarketPrice;
      const company = meta.longName || meta.shortName || null;
      
      // Determine portfolio size based on price thresholds
      let portfolioSize: "small" | "medium" | "large";
      if (price <= 50) {
        portfolioSize = "small";
      } else if (price <= 150) {
        portfolioSize = "medium";
      } else {
        portfolioSize = "large";
      }

      // Determine type based on market cap and growth indicators
      // This is a simplified heuristic - could be enhanced with more data
      let type: string | null = null;
      const marketCap = meta.marketCap;
      
      if (marketCap) {
        // Large cap (>$200B) with high PE = Growth
        // Large cap with low PE = Value
        // Mid cap = Blend
        if (marketCap > 200000000000) {
          type = "Growth"; // Simplified - most mega-caps are growth
        } else if (marketCap > 50000000000) {
          type = "Blend";
        } else {
          type = "Value";
        }
      }

      // Try to extract sector from quote type or other metadata
      // Yahoo Finance doesn't always provide sector in chart API
      const sector = meta.sector || meta.industry || null;

      return {
        symbol: symbol.toUpperCase(),
        company,
        price: price ? price.toFixed(2) : null,
        sector,
        type,
        portfolioSize,
      };
    }

    // If API call fails or no data, return defaults
    return {
      symbol: symbol.toUpperCase(),
      company: null,
      price: null,
      sector: null,
      type: null,
      portfolioSize: "medium", // Default to medium if price unknown
    };
  } catch (error) {
    console.error(`Error enriching stock ${symbol}:`, error);
    
    // Return defaults on error
    return {
      symbol: symbol.toUpperCase(),
      company: null,
      price: null,
      sector: null,
      type: null,
      portfolioSize: "medium",
    };
  }
}

/**
 * Enrich multiple stock symbols in parallel
 * @param symbols Array of stock ticker symbols
 * @param concurrency Maximum number of concurrent API calls (default: 5)
 * @returns Array of stock metadata
 */
export async function enrichMultipleStocks(
  symbols: string[],
  concurrency: number = 5
): Promise<StockMetadata[]> {
  const results: StockMetadata[] = [];
  
  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(symbol => enrichStockMetadata(symbol))
    );
    results.push(...batchResults);
  }
  
  return results;
}
