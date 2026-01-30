/**
 * tRPC Router for Roll Detection and Management
 * Provides procedures for analyzing positions and generating roll candidates
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import type { PositionWithMetrics } from "./rollDetection";
import { analyzePositionsForRolls, generateRollCandidates } from "./rollDetection";

export const rollsRouter = router({
  /**
   * Get positions that need rolling based on 7/14 DTE thresholds and 80% profit rule
   * Returns positions grouped by urgency (red/yellow/green)
   * Optionally filter by accountId
   */
  getRollsNeeded: protectedProcedure
    .input(
      z.object({
        accountId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
    const { getTastytradeAPI } = await import('./tastytrade');
    const { getApiCredentials, getTastytradeAccounts } = await import('./db');
    
    // Get Tastytrade credentials
    const credentials = await getApiCredentials(ctx.user.id);
    if (!credentials || !credentials.tastytradeUsername || !credentials.tastytradePassword) {
      throw new Error('Tastytrade credentials not found');
    }
    
    const api = getTastytradeAPI();
    await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
    
    // Get all accounts
    const accounts = await getTastytradeAccounts(ctx.user.id);
    if (!accounts || accounts.length === 0) {
      return {
        red: [],
        yellow: [],
        green: [],
        total: 0,
      };
    }
    
    // Filter by accountId if provided
    let accountNumbers = accounts.map((acc) => acc.accountNumber);
    if (input?.accountId) {
      const selectedAccount = accounts.find(acc => acc.accountId === input.accountId);
      if (selectedAccount) {
        accountNumbers = [selectedAccount.accountNumber];
      } else {
        // Account not found, return empty results
        return {
          red: [],
          yellow: [],
          green: [],
          total: 0,
        };
      }
    }
    
    // Fetch positions from all accounts
    const allPositions: PositionWithMetrics[] = [];
    const currentPrices: Record<string, number> = {};
    
    for (const accountNumber of accountNumbers) {
      const positions = await api.getPositions(accountNumber);
      if (!positions) continue;
      
      for (const pos of positions) {
        const instrumentType = pos['instrument-type'];
        
        // Only process equity options
        if (instrumentType !== 'Equity Option') continue;
        
        const quantity = parseInt(String(pos.quantity || '0'));
        const quantityDirection = pos['quantity-direction'];
        const isShort = quantityDirection?.toLowerCase() === 'short' || quantity < 0;
        
        // Only process short options (CSP and CC)
        if (!isShort) continue;
        
        const symbol = pos.symbol || '';
        const parsed = parseOptionSymbol(symbol);
        if (!parsed) continue;
        
        // Determine strategy type
        let strategy: 'csp' | 'cc' | null = null;
        if (parsed.optionType === 'PUT') {
          strategy = 'csp';
        } else if (parsed.optionType === 'CALL') {
          strategy = 'cc';
        }
        
        if (!strategy) continue;
        
        // Calculate metrics
        const openPrice = parseFloat(String(pos['average-open-price'] || '0'));
        const closePrice = parseFloat(String(pos['close-price'] || '0'));
        const markPrice = parseFloat(String((pos as any)['mark-price'] || closePrice || '0'));
        const multiplier = parseInt(String(pos.multiplier || '100'));
        const qty = Math.abs(quantity);
        
        const openPremium = openPrice * qty * multiplier;
        const currentValue = markPrice * qty * multiplier;
        // Delta is not available in position data, will need to fetch from greeks
        const delta = 0; // TODO: Fetch from greeks API in Phase 1B
        
        // Get underlying price from close-price or mark-price
        const underlyingSymbol = parsed.underlying;
        if (!currentPrices[underlyingSymbol]) {
          // Use close price as proxy for underlying price
          // TODO: Fetch actual underlying price from market data API in Phase 1B
          currentPrices[underlyingSymbol] = parsed.strike;
        }
        
        // Create position with metrics
        const positionWithMetrics: PositionWithMetrics = {
          id: Math.floor(Math.random() * 1000000), // Generate random ID for now
          userId: ctx.user.id,
          accountId: accountNumber,
          symbol: underlyingSymbol,
          positionType: 'option',
          strategy,
          strike: parsed.strike.toString(),
          expiration: parsed.expiration,
          quantity: qty,
          costBasis: openPremium.toString(),
          currentValue: currentValue.toString(),
          unrealizedPnL: (openPremium - currentValue).toString(),
          realizedPnL: '0',
          status: 'open',
          spreadType: null,
          longStrike: null,
          spreadWidth: null,
          capitalAtRisk: null,
          openedAt: new Date(),
          closedAt: null,
          updatedAt: new Date(),
          // Extended fields for roll analysis
          option_symbol: symbol, // Store the full OCC option symbol from Tastytrade
          open_premium: openPremium,
          current_value: currentValue,
          expiration_date: parsed.expiration,
          strike_price: parsed.strike,
          delta: delta,
        };
        
        allPositions.push(positionWithMetrics);
      }
    }
    
    // Analyze positions for rolls
    const analyses = analyzePositionsForRolls(allPositions, currentPrices);
    
    // Group by urgency
    const red = analyses.filter(a => a.urgency === 'red' && a.shouldRoll);
    const yellow = analyses.filter(a => a.urgency === 'yellow' && a.shouldRoll);
    const green = analyses.filter(a => a.urgency === 'green' && a.shouldRoll);
    
    return {
      red,
      yellow,
      green,
      total: red.length + yellow.length + green.length,
    };
  }),
  
  /**
   * Get roll candidates for a specific position
   * Returns top 5 roll options plus "close without rolling" option
   */
  getRollCandidates: protectedProcedure
    .input(z.object({
      positionId: z.string(),
      symbol: z.string(),
      strategy: z.enum(['csp', 'cc']),
      strikePrice: z.number(),
      expirationDate: z.string(),
      currentValue: z.number(),
      openPremium: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const { getTastytradeAPI } = await import('./tastytrade');
      const { getApiCredentials } = await import('./db');
      
      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeUsername || !credentials.tastytradePassword) {
        throw new Error('Tastytrade credentials not found');
      }
      
      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);
      
      // Use Tradier API for option chains and Greeks
      const { TradierAPI } = await import('./tradier');
      const tradierApiKey = process.env.TRADIER_API_KEY;
      
      if (!tradierApiKey) {
        throw new Error('TRADIER_API_KEY not configured');
      }
      
      const tradier = new TradierAPI(tradierApiKey, false);
      
      try {
        // Fetch underlying price from Tradier
        const quote = await tradier.getQuote(input.symbol);
        const underlyingPrice = quote.last;
        
        // Fetch option expirations from Tradier
        const expirations = await tradier.getExpirations(input.symbol);
        
        // Create option chain structure for generateRollCandidates
        const optionChain = {
          symbol: input.symbol,
          expirations: expirations.map(exp => ({ date: exp })),
        };
        
        // Calculate DTE for current position
        const currentDTE = Math.ceil(
          (new Date(input.expirationDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // Create mock position and analysis for generateRollCandidates
        const mockPosition: PositionWithMetrics = {
          id: parseInt(input.positionId),
          userId: ctx.user.id,
          accountId: 'mock',
          symbol: input.symbol,
          positionType: 'option',
          strategy: input.strategy,
          strike: input.strikePrice.toString(),
          expiration: input.expirationDate,
          quantity: 1,
          costBasis: input.openPremium.toString(),
          currentValue: input.currentValue.toString(),
          unrealizedPnL: (input.openPremium - input.currentValue).toString(),
          realizedPnL: '0',
          status: 'open',
          spreadType: null,
          longStrike: null,
          spreadWidth: null,
          capitalAtRisk: null,
          openedAt: new Date(),
          closedAt: null,
          updatedAt: new Date(),
          option_symbol: `${input.symbol}     ${input.expirationDate.replace(/-/g, '')}${input.strategy === 'csp' ? 'P' : 'C'}${(input.strikePrice * 1000).toString().padStart(8, '0')}`, // Construct OCC symbol as placeholder
          open_premium: input.openPremium,
          current_value: input.currentValue,
          expiration_date: input.expirationDate,
          strike_price: input.strikePrice,
          delta: 0,
        };
        
        const mockAnalysis = {
          positionId: input.positionId,
          symbol: input.symbol,
          optionSymbol: mockPosition.option_symbol,
          strategy: input.strategy.toUpperCase() as 'CSP' | 'CC',
          urgency: 'yellow' as const,
          shouldRoll: true,
          reasons: [],
          metrics: {
            dte: currentDTE,
            profitCaptured: ((input.openPremium - input.currentValue) / input.openPremium) * 100,
            itmDepth: 0,
            delta: 0,
            currentPrice: underlyingPrice,
            strikePrice: input.strikePrice,
            currentValue: input.currentValue,
            openPremium: input.openPremium,
            expiration: input.expirationDate,
          },
          score: 50,
        };
        
        // Generate roll candidates
        const candidates = await generateRollCandidates(
          mockPosition,
          mockAnalysis,
          expirations,
          underlyingPrice,
          tradier
        );
        
        return { candidates };
      } catch (error: any) {
        console.error('[getRollCandidates] Error:', error.message);
        // Return close option only on error
        return {
          candidates: [
            {
              action: 'close' as const,
              score: 50,
              description: `Close for $${input.currentValue.toFixed(2)} debit (Error fetching roll options: ${error.message})`,
            },
          ],
        };
      }
    }),
});

/**
 * Helper function to parse OCC option symbols
 */
function parseOptionSymbol(symbol: string): { underlying: string; expiration: string; optionType: string; strike: number } | null {
  try {
    const cleanSymbol = symbol.replace(/\s/g, '');
    const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (match) {
      const underlying = match[1];
      const dateStr = match[2];
      const optionType = match[3] === 'P' ? 'PUT' : 'CALL';
      const strike = parseInt(match[4]) / 1000;
      const year = 2000 + parseInt(dateStr.substring(0, 2));
      const month = parseInt(dateStr.substring(2, 4));
      const day = parseInt(dateStr.substring(4, 6));
      const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { underlying, expiration, optionType, strike };
    }
  } catch (error) {
    return null;
  }
  return null;
}
