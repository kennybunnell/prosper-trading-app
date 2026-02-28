/**
 * tRPC Router for Roll Detection and Management
 * Provides procedures for analyzing positions and generating roll candidates
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import type { PositionWithMetrics } from "./rollDetection";
import { analyzePositionsForRolls, generateRollCandidates } from "./rollDetection";

// Helper: Build OCC option symbol from components
function buildOCCSymbol(underlying: string, expiration: string, optionType: 'C' | 'P', strike: number): string {
  const expParts = expiration.split('-');
  const dateStr = expParts[0].slice(2) + expParts[1] + expParts[2]; // YYMMDD
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${underlying}${dateStr}${optionType}${strikeStr}`;
}

export const rollsRouter = router({
  /**
   * Scan all accounts for positions that need rolling.
   * Returns positions grouped by urgency (red/yellow/green) with real underlying prices from Tradier.
   */
  scanRollPositions: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const { TradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not found');
      }

      const tradierApiKey = credentials.tradierApiKey || process.env.TRADIER_API_KEY;
      if (!tradierApiKey) throw new Error('Tradier API key not configured');

      const api = await authenticateTastytrade(credentials);
      const tradier = new TradierAPI(tradierApiKey, false);

      const accounts = await getTastytradeAccounts(ctx.user.id);
      if (!accounts || accounts.length === 0) {
        return { red: [], yellow: [], green: [], all: [], total: 0, accountsScanned: 0 };
      }

      // Filter by accountId if provided
      let targetAccounts = accounts;
      if (input?.accountId) {
        const found = accounts.find(acc => acc.accountId === input.accountId);
        if (found) targetAccounts = [found];
      }

      const allPositions: PositionWithMetrics[] = [];
      const currentPrices: Record<string, number> = {};
      const symbolsToFetch = new Set<string>();

      // First pass: collect all positions and unique underlying symbols
      const rawPositionsByAccount: Array<{ accountNumber: string; positions: any[] }> = [];
      for (const account of targetAccounts) {
        const positions = await api.getPositions(account.accountNumber);
        if (!positions) continue;
        rawPositionsByAccount.push({ accountNumber: account.accountNumber, positions });
        for (const pos of positions) {
          if (pos['instrument-type'] !== 'Equity Option') continue;
          const symbol = pos.symbol || '';
          const parsed = parseOptionSymbol(symbol);
          if (parsed) symbolsToFetch.add(parsed.underlying);
        }
      }

      // Batch fetch underlying prices from Tradier
      if (symbolsToFetch.size > 0) {
        try {
          const symbols = Array.from(symbolsToFetch);
          // Fetch in batches of 10
          for (let i = 0; i < symbols.length; i += 10) {
            const batch = symbols.slice(i, i + 10);
            for (const sym of batch) {
              try {
                const quote = await tradier.getQuote(sym);
                if (quote && quote.last) {
                  currentPrices[sym] = quote.last;
                }
              } catch (e) {
                console.warn(`[scanRollPositions] Could not fetch price for ${sym}:`, e);
              }
            }
          }
        } catch (e) {
          console.warn('[scanRollPositions] Error fetching prices:', e);
        }
      }

      // Second pass: build PositionWithMetrics using real prices
      for (const { accountNumber, positions } of rawPositionsByAccount) {
        for (const pos of positions) {
          if (pos['instrument-type'] !== 'Equity Option') continue;

          const quantity = parseInt(String(pos.quantity || '0'));
          const quantityDirection = pos['quantity-direction'];
          const isShort = quantityDirection?.toLowerCase() === 'short' || quantity < 0;
          if (!isShort) continue;

          const symbol = pos.symbol || '';
          const parsed = parseOptionSymbol(symbol);
          if (!parsed) continue;

          let strategy: 'csp' | 'cc' | null = null;
          if (parsed.optionType === 'PUT') strategy = 'csp';
          else if (parsed.optionType === 'CALL') strategy = 'cc';
          if (!strategy) continue;

          const openPrice = parseFloat(String(pos['average-open-price'] || '0'));
          const closePrice = parseFloat(String(pos['close-price'] || '0'));
          const markPrice = parseFloat(String((pos as any)['mark-price'] || closePrice || '0'));
          const multiplier = parseInt(String(pos.multiplier || '100'));
          const qty = Math.abs(quantity);

          const openPremium = openPrice * qty * multiplier;
          const currentValue = markPrice * qty * multiplier;

          const underlyingSymbol = parsed.underlying;
          // Use real price from Tradier, fallback to strike if unavailable
          const underlyingPrice = currentPrices[underlyingSymbol] || parsed.strike;

          const positionWithMetrics: PositionWithMetrics = {
            id: Math.floor(Math.random() * 1000000),
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
            option_symbol: symbol,
            open_premium: openPremium,
            current_value: currentValue,
            expiration_date: parsed.expiration,
            strike_price: parsed.strike,
            delta: 0,
          };

          allPositions.push(positionWithMetrics);
        }
      }

      // Analyze positions for rolls using real prices
      const analyses = analyzePositionsForRolls(allPositions, currentPrices);

      // Return ALL analyses (not just shouldRoll=true) so user can see full picture
      const red = analyses.filter(a => a.urgency === 'red');
      const yellow = analyses.filter(a => a.urgency === 'yellow');
      const green = analyses.filter(a => a.urgency === 'green');

      return {
        red,
        yellow,
        green,
        all: analyses,
        total: analyses.length,
        accountsScanned: targetAccounts.length,
      };
    }),

  /**
   * Get roll candidates for a specific position (called when user expands a row)
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
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const { TradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not found');
      }

      const tradierApiKey = credentials.tradierApiKey || process.env.TRADIER_API_KEY;
      if (!tradierApiKey) throw new Error('Tradier API key not configured');

      const tradier = new TradierAPI(tradierApiKey, false);

      try {
        const quote = await tradier.getQuote(input.symbol);
        const underlyingPrice = quote.last;
        const expirations = await tradier.getExpirations(input.symbol);

        const currentDTE = Math.ceil(
          (new Date(input.expirationDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );

        const mockPosition: PositionWithMetrics = {
          id: parseInt(input.positionId) || Math.floor(Math.random() * 1000000),
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
          option_symbol: buildOCCSymbol(
            input.symbol,
            input.expirationDate,
            input.strategy === 'csp' ? 'P' : 'C',
            input.strikePrice
          ),
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
            profitCaptured: input.openPremium > 0
              ? ((input.openPremium - input.currentValue) / input.openPremium) * 100
              : 0,
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

        const candidates = await generateRollCandidates(
          mockPosition,
          mockAnalysis,
          expirations,
          underlyingPrice,
          tradier
        );

        return { candidates, underlyingPrice };
      } catch (error: any) {
        console.error('[getRollCandidates] Error:', error.message);
        return {
          candidates: [{
            action: 'close' as const,
            score: 50,
            description: `Close position (Error fetching roll options: ${error.message})`,
          }],
          underlyingPrice: input.strikePrice,
        };
      }
    }),

  /**
   * Submit roll orders: BTC current position + STO new position (2-leg combo)
   * Or just BTC if action is 'close'
   */
  submitRollOrders: protectedProcedure
    .input(z.object({
      dryRun: z.boolean().default(false),
      orders: z.array(z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        strategy: z.enum(['csp', 'cc']),
        // Current position (BTC leg)
        currentOptionSymbol: z.string(),
        currentQuantity: z.number(),
        currentValue: z.number(), // per-contract cost to close
        // New position (STO leg) — null if just closing
        newStrike: z.number().optional(),
        newExpiration: z.string().optional(),
        newPremium: z.number().optional(), // per-contract credit from new STO
        netCredit: z.number().optional(),
        action: z.enum(['roll', 'close']),
      }))
    }))
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials || !credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not found');
      }

      const api = await authenticateTastytrade(credentials);

      const results: Array<{
        symbol: string;
        accountNumber: string;
        action: string;
        success: boolean;
        orderId?: string;
        error?: string;
        dryRun: boolean;
      }> = [];

      for (const order of input.orders) {
        try {
          const legs: any[] = [];

          // Leg 1: BTC current position
          legs.push({
            instrumentType: 'Equity Option' as const,
            symbol: order.currentOptionSymbol,
            quantity: String(order.currentQuantity),
            action: 'Buy to Close' as const,
          });

          // Leg 2: STO new position (if rolling, not just closing)
          if (order.action === 'roll' && order.newStrike && order.newExpiration) {
            const newOCCSymbol = buildOCCSymbol(
              order.symbol,
              order.newExpiration,
              order.strategy === 'csp' ? 'P' : 'C',
              order.newStrike
            );
            legs.push({
              instrumentType: 'Equity Option' as const,
              symbol: newOCCSymbol,
              quantity: String(order.currentQuantity),
              action: 'Sell to Open' as const,
            });
          }

          // Calculate limit price
          // For a roll: net credit = new premium - close cost (positive = credit)
          // For close only: debit = current value
          let price: string;
          let priceEffect: 'Credit' | 'Debit';

          if (order.action === 'roll' && order.netCredit !== undefined) {
            const absPrice = Math.abs(order.netCredit);
            price = absPrice.toFixed(2);
            priceEffect = order.netCredit >= 0 ? 'Credit' : 'Debit';
          } else {
            // Close only: pay current value
            price = Math.abs(order.currentValue).toFixed(2);
            priceEffect = 'Debit';
          }

          const orderRequest = {
            accountNumber: order.accountNumber,
            timeInForce: 'Day' as const,
            orderType: 'Limit' as const,
            price,
            priceEffect,
            legs,
          };

          if (input.dryRun) {
            const dryResult = await api.dryRunOrder(orderRequest);
            results.push({
              symbol: order.symbol,
              accountNumber: order.accountNumber,
              action: order.action,
              success: true,
              orderId: `dry-run-${order.currentOptionSymbol}`,
              dryRun: true,
            });
          } else {
            const submitted = await api.submitOrder(orderRequest);
            results.push({
              symbol: order.symbol,
              accountNumber: order.accountNumber,
              action: order.action,
              success: true,
              orderId: submitted.id,
              dryRun: false,
            });
          }
        } catch (error: any) {
          results.push({
            symbol: order.symbol,
            accountNumber: order.accountNumber,
            action: order.action,
            success: false,
            error: error.message,
            dryRun: input.dryRun,
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return {
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failCount,
          dryRun: input.dryRun,
        },
      };
    }),
});

/**
 * Helper function to parse OCC option symbols
 */
function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiration: string;
  optionType: string;
  strike: number;
} | null {
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
