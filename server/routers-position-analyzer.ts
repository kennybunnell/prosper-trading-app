/**
 * Position Analyzer Router
 *
 * Scans all held stock positions across all accounts and evaluates each one as:
 *   KEEP        — strong CC premium yield, core holding, worth keeping
 *   HARVEST     — decent premium but consider selling ITM CC to exit on the way out
 *   LIQUIDATE   — poor premium yield, deep drawdown, capital better redeployed
 *
 * Scoring criteria:
 *   1. Weekly CC premium yield (ATM, this Friday) — higher is better
 *   2. Drawdown from 52-week high — deeper drawdown = more pressure to liquidate
 *   3. Position size (market value) — large dead positions hurt more
 *   4. Whether the stock is a "core" name (Mag 7 / high-conviction) — gets KEEP bias
 */
import { router, protectedProcedure } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// Core high-conviction names that get a KEEP bias
const CORE_NAMES = new Set([
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA',
  'AVGO', 'PLTR', 'COIN', 'HOOD', 'SHOP', 'ADBE', 'CRM', 'QCOM',
  'ORCL', 'AMD', 'NFLX', 'UBER', 'NBIS', 'APLD', 'SOFI', 'INTC',
  'SPY', 'QQQ', 'TQQQ',
]);

export type PositionRecommendation = 'KEEP' | 'HARVEST' | 'LIQUIDATE';

export interface AnalyzedPosition {
  symbol: string;
  accountNumber: string;
  accountType: string;
  quantity: number;
  avgOpenPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  week52High: number;
  week52Low: number;
  drawdownFromHigh: number; // % below 52-wk high
  isCore: boolean;
  // CC premium data (nearest Friday expiry)
  ccExpiration: string | null;
  ccAtmStrike: number | null;
  ccAtmPremium: number | null;   // mid price
  ccWeeklyYield: number | null;  // premium / stock price %
  ccEffectiveExit: number | null; // strike + premium
  // Recommendation
  recommendation: PositionRecommendation;
  recommendationReason: string;
  // Redeployment suggestion
  redeploymentSuggestion: string | null;
}

export interface PositionAnalyzerResult {
  positions: AnalyzedPosition[];
  summary: {
    totalPositions: number;
    keepCount: number;
    harvestCount: number;
    liquidateCount: number;
    totalMarketValue: number;
    totalUnrealizedPnl: number;
    estimatedWeeklyPremium: number; // if all HARVEST/LIQUIDATE positions sell ATM CC
    estimatedLiquidationProceeds: number; // if all LIQUIDATE positions are exited
  };
  scannedAt: string;
}

function getRecommendation(
  drawdownFromHigh: number,
  weeklyYield: number | null,
  isCore: boolean,
  marketValue: number,
): { recommendation: PositionRecommendation; reason: string } {
  const yield_ = weeklyYield ?? 0;

  // Core names with decent yield → KEEP
  if (isCore && yield_ >= 2.0 && drawdownFromHigh > -60) {
    return { recommendation: 'KEEP', reason: `Core holding with ${yield_.toFixed(1)}%/wk CC yield — continue wheeling` };
  }

  // Core names that are deeply underwater → HARVEST (sell ITM CC to exit gracefully)
  if (isCore && drawdownFromHigh <= -60) {
    return { recommendation: 'HARVEST', reason: `Core name but down ${Math.abs(drawdownFromHigh).toFixed(0)}% from high — sell ITM CC to harvest premium on the way out` };
  }

  // Non-core with poor yield and deep drawdown → LIQUIDATE
  if (!isCore && drawdownFromHigh <= -40 && yield_ < 3.0) {
    return { recommendation: 'LIQUIDATE', reason: `Down ${Math.abs(drawdownFromHigh).toFixed(0)}% from high, only ${yield_.toFixed(1)}%/wk CC yield — redeploy capital` };
  }

  // Non-core with rich yield → HARVEST (sell CC to exit at a premium)
  if (!isCore && yield_ >= 4.0) {
    return { recommendation: 'HARVEST', reason: `High IV (${yield_.toFixed(1)}%/wk) — sell ATM/ITM CC to collect premium on exit` };
  }

  // Non-core, moderate yield, moderate drawdown → HARVEST
  if (!isCore && drawdownFromHigh <= -30) {
    return { recommendation: 'HARVEST', reason: `Down ${Math.abs(drawdownFromHigh).toFixed(0)}% from high — sell covered call to improve exit price` };
  }

  // Large dead position with no meaningful yield → LIQUIDATE
  if (marketValue > 5000 && yield_ < 1.5 && drawdownFromHigh <= -20) {
    return { recommendation: 'LIQUIDATE', reason: `Low CC yield (${yield_.toFixed(1)}%/wk) and down ${Math.abs(drawdownFromHigh).toFixed(0)}% — capital not working hard enough` };
  }

  // Default: KEEP
  return { recommendation: 'KEEP', reason: `Adequate CC yield (${yield_.toFixed(1)}%/wk) — continue current strategy` };
}

function getRedeploymentSuggestion(symbol: string, marketValue: number, recommendation: PositionRecommendation): string | null {
  if (recommendation === 'KEEP') return null;
  const rounded = Math.round(marketValue / 1000) * 1000;
  if (rounded < 1000) return null;
  // Suggest redeployment into iron condors or spreads on core names
  const suggestions = [
    `Redeploy ~$${rounded.toLocaleString()} into TSLA/NVDA iron condors (~$175/condor, 26% ROI)`,
    `Redeploy ~$${rounded.toLocaleString()} into NVDA bull put spreads ($160/$155, ~$100/contract)`,
    `Redeploy ~$${rounded.toLocaleString()} into AMZN PMCC (Jan 2027 $180C, ~$175/mo income)`,
    `Redeploy ~$${rounded.toLocaleString()} into COIN iron condor ($155/$150 put, $195/$200 call)`,
  ];
  // Pick suggestion based on symbol hash for variety
  const idx = symbol.charCodeAt(0) % suggestions.length;
  return suggestions[idx];
}

export const positionAnalyzerRouter = router({
  /**
   * Scan all stock positions across all accounts and generate recommendations
   */
  analyzePositions: protectedProcedure
    .input(z.object({
      accountNumber: z.string().optional(), // if omitted, scans all accounts
    }).optional())
    .query(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { getTastytradeAPI, authenticateTastytrade } = await import('./tastytrade');
      const { TradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade OAuth2 credentials not configured. Please add them in Settings.',
        });
      }

      const tradierKey = process.env.TRADIER_API_KEY;
      if (!tradierKey) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Tradier API key not configured' });
      }
      const tradierApi = new TradierAPI(tradierKey, false);

      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // Get accounts
      const dbAccounts = await getTastytradeAccounts(ctx.user.id);
      let accountList: Array<{ accountNumber: string; accountType: string }> = [];
      if (!dbAccounts || dbAccounts.length === 0) {
        const rawAccounts = await api.getAccounts();
        accountList = rawAccounts.map((a: any) => ({
          accountNumber: a['account-number'] || a.accountNumber,
          accountType: a['account-type-name'] || a.accountType || 'Unknown',
        }));
      } else {
        accountList = dbAccounts.map((a: any) => ({
          accountNumber: a.accountNumber,
          accountType: a.accountType || 'Unknown',
        }));
      }

      if (input?.accountNumber) {
        accountList = accountList.filter(a => a.accountNumber === input.accountNumber);
      }

      // Collect all stock positions across accounts
      const allStockPositions: Array<{
        symbol: string;
        accountNumber: string;
        accountType: string;
        quantity: number;
        avgOpenPrice: number;
      }> = [];

      for (const account of accountList) {
        try {
          const positions = await api.getPositions(account.accountNumber);
          const stockPos = (positions || []).filter((p: any) => p['instrument-type'] === 'Equity' && p.quantity > 0);
          for (const p of stockPos) {
            allStockPositions.push({
              symbol: p.symbol || p['underlying-symbol'],
              accountNumber: account.accountNumber,
              accountType: account.accountType || 'Unknown',
              quantity: p.quantity,
              avgOpenPrice: parseFloat(p['average-open-price'] || '0'),
            });
          }
        } catch (e) {
          console.warn(`[PositionAnalyzer] Could not fetch positions for ${account.accountNumber}:`, e);
        }
      }

      if (allStockPositions.length === 0) {
        return {
          positions: [],
          summary: {
            totalPositions: 0, keepCount: 0, harvestCount: 0, liquidateCount: 0,
            totalMarketValue: 0, totalUnrealizedPnl: 0,
            estimatedWeeklyPremium: 0, estimatedLiquidationProceeds: 0,
          },
          scannedAt: new Date().toISOString(),
        } as PositionAnalyzerResult;
      }

      // Deduplicate symbols for quote fetching
      const uniqueSymbols = Array.from(new Set(allStockPositions.map(p => p.symbol)));

      // Fetch quotes for all symbols
      const quotes = await tradierApi.getQuotes(uniqueSymbols);
      const quoteMap = new Map<string, typeof quotes[0]>();
      for (const q of quotes) {
        quoteMap.set(q.symbol, q);
      }

      // Get nearest Friday expiration
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
      const daysUntilFriday = dayOfWeek <= 5 ? (5 - dayOfWeek === 0 ? 7 : 5 - dayOfWeek) : 6;
      const nearestFriday = new Date(today);
      nearestFriday.setDate(today.getDate() + daysUntilFriday);
      const fridayStr = nearestFriday.toISOString().split('T')[0];

      // Fetch ATM call option for each unique symbol (nearest Friday)
      const ccPremiumMap = new Map<string, { strike: number; premium: number; expiration: string }>();
      for (const sym of uniqueSymbols) {
        const quote = quoteMap.get(sym);
        if (!quote) continue;
        const price = quote.last || quote.close || 0;
        if (price <= 0) continue;
        try {
          const expirations = await tradierApi.getExpirations(sym);
          if (!expirations || expirations.length === 0) continue;
          // Find nearest expiration >= today (prefer this Friday)
          const sortedExps = expirations.sort();
          const targetExp = sortedExps.find(e => e >= fridayStr) || sortedExps[0];
          const chain = await tradierApi.getOptionChain(sym, targetExp, false);
          const calls = chain.filter(o => o.type === 'call');
          if (calls.length === 0) continue;
          // Find ATM call (closest strike to current price)
          const atm = calls.reduce((best, c) =>
            Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best
          );
          const mid = (atm.bid + atm.ask) / 2;
          if (mid > 0) {
            ccPremiumMap.set(sym, { strike: atm.strike, premium: mid, expiration: targetExp });
          }
        } catch (e) {
          // Skip if option chain unavailable (e.g., no options on this name)
        }
      }

      // Build analyzed positions
      const analyzedPositions: AnalyzedPosition[] = [];

      for (const pos of allStockPositions) {
        const quote = quoteMap.get(pos.symbol);
        const currentPrice = quote ? (quote.last || quote.close || 0) : 0;
        const week52High = quote?.week_52_high || 0;
        const week52Low = quote?.week_52_low || 0;
        const marketValue = currentPrice * pos.quantity;
        const unrealizedPnl = (currentPrice - pos.avgOpenPrice) * pos.quantity;
        const unrealizedPnlPct = pos.avgOpenPrice > 0 ? ((currentPrice - pos.avgOpenPrice) / pos.avgOpenPrice) * 100 : 0;
        const drawdownFromHigh = week52High > 0 ? ((currentPrice - week52High) / week52High) * 100 : 0;

        const ccData = ccPremiumMap.get(pos.symbol);
        const ccWeeklyYield = ccData && currentPrice > 0 ? (ccData.premium / currentPrice) * 100 : null;
        const ccEffectiveExit = ccData ? ccData.strike + ccData.premium : null;

        const isCore = CORE_NAMES.has(pos.symbol);
        const { recommendation, reason } = getRecommendation(drawdownFromHigh, ccWeeklyYield, isCore, marketValue);
        const redeploymentSuggestion = getRedeploymentSuggestion(pos.symbol, marketValue, recommendation);

        analyzedPositions.push({
          symbol: pos.symbol,
          accountNumber: pos.accountNumber,
          accountType: pos.accountType,
          quantity: pos.quantity,
          avgOpenPrice: pos.avgOpenPrice,
          currentPrice,
          marketValue,
          unrealizedPnl,
          unrealizedPnlPct,
          week52High,
          week52Low,
          drawdownFromHigh,
          isCore,
          ccExpiration: ccData?.expiration || null,
          ccAtmStrike: ccData?.strike || null,
          ccAtmPremium: ccData?.premium || null,
          ccWeeklyYield,
          ccEffectiveExit,
          recommendation,
          recommendationReason: reason,
          redeploymentSuggestion,
        });
      }

      // Sort: LIQUIDATE first, then HARVEST, then KEEP; within each group by market value desc
      const order: Record<PositionRecommendation, number> = { LIQUIDATE: 0, HARVEST: 1, KEEP: 2 };
      analyzedPositions.sort((a, b) => {
        const orderDiff = order[a.recommendation] - order[b.recommendation];
        if (orderDiff !== 0) return orderDiff;
        return b.marketValue - a.marketValue;
      });

      const keepCount = analyzedPositions.filter(p => p.recommendation === 'KEEP').length;
      const harvestCount = analyzedPositions.filter(p => p.recommendation === 'HARVEST').length;
      const liquidateCount = analyzedPositions.filter(p => p.recommendation === 'LIQUIDATE').length;
      const totalMarketValue = analyzedPositions.reduce((s, p) => s + p.marketValue, 0);
      const totalUnrealizedPnl = analyzedPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
      const estimatedWeeklyPremium = analyzedPositions
        .filter(p => p.recommendation !== 'KEEP' && p.ccAtmPremium)
        .reduce((s, p) => s + (p.ccAtmPremium! * Math.floor(p.quantity / 100) * 100), 0);
      const estimatedLiquidationProceeds = analyzedPositions
        .filter(p => p.recommendation === 'LIQUIDATE')
        .reduce((s, p) => s + p.marketValue, 0);

      return {
        positions: analyzedPositions,
        summary: {
          totalPositions: analyzedPositions.length,
          keepCount,
          harvestCount,
          liquidateCount,
          totalMarketValue,
          totalUnrealizedPnl,
          estimatedWeeklyPremium,
          estimatedLiquidationProceeds,
        },
        scannedAt: new Date().toISOString(),
      } as PositionAnalyzerResult;
    }),

  /**
   * Sell ATM covered call for a specific position (one-click from Position Analyzer)
   */
  sellCoveredCall: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),
      strike: z.number(),
      expiration: z.string(), // YYYY-MM-DD
      quantity: z.number().int().positive(),
      limitPrice: z.number().positive(), // per-share mid price
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade OAuth2 credentials not configured.',
        });
      }

      // Format OCC option symbol: SYMBOL  YYMMDDCSTRIKE (padded)
      const expDate = new Date(input.expiration);
      const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
      const strikeStr = (input.strike * 1000).toFixed(0).padStart(8, '0');
      const optionSymbol = `${input.symbol.padEnd(6)}${expStr}C${strikeStr}`;

      if (input.dryRun) {
        return {
          success: true,
          dryRun: true,
          optionSymbol,
          symbol: input.symbol,
          strike: input.strike,
          expiration: input.expiration,
          quantity: input.quantity,
          limitPrice: input.limitPrice,
          estimatedCredit: input.limitPrice * input.quantity * 100,
          message: `[Dry Run] Would sell ${input.quantity} contract(s) of ${optionSymbol} at $${input.limitPrice.toFixed(2)} limit — estimated credit: $${(input.limitPrice * input.quantity * 100).toFixed(2)}`,
        };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const result = await api.submitOrder({
        accountNumber: input.accountNumber,
        timeInForce: 'Day',
        orderType: 'Limit',
        price: input.limitPrice.toFixed(2),
        priceEffect: 'Credit',
        legs: [
          {
            instrumentType: 'Equity Option',
            symbol: optionSymbol,
            quantity: input.quantity.toString(),
            action: 'Sell to Open',
          },
        ],
      });

      return {
        success: true,
        dryRun: false,
        optionSymbol,
        symbol: input.symbol,
        strike: input.strike,
        expiration: input.expiration,
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        estimatedCredit: input.limitPrice * input.quantity * 100,
        orderId: result.id,
        orderStatus: result.status,
        message: `Sell to Open order submitted: ${input.quantity} contract(s) of ${optionSymbol} at $${input.limitPrice.toFixed(2)}`,
      };
    }),

  /**
   * Update weekly position digest settings
   */
  updateDigestSettings: protectedProcedure
    .input(z.object({
      weeklyPositionDigestEnabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const { automationSettings } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      // Upsert automation settings
      const existing = await db.select().from(automationSettings).where(eq(automationSettings.userId, ctx.user.id)).limit(1);
      if (existing.length === 0) {
        await db.insert(automationSettings).values({
          userId: ctx.user.id,
          weeklyPositionDigestEnabled: input.weeklyPositionDigestEnabled,
        });
      } else {
        await db.update(automationSettings)
          .set({ weeklyPositionDigestEnabled: input.weeklyPositionDigestEnabled })
          .where(eq(automationSettings.userId, ctx.user.id));
      }
      return { success: true, weeklyPositionDigestEnabled: input.weeklyPositionDigestEnabled };
    }),

  /**
   * Get current digest settings
   */
  getDigestSettings: protectedProcedure
    .query(async ({ ctx }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return { weeklyPositionDigestEnabled: false };
      const { automationSettings } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const [settings] = await db.select().from(automationSettings).where(eq(automationSettings.userId, ctx.user.id)).limit(1);
      return { weeklyPositionDigestEnabled: settings?.weeklyPositionDigestEnabled ?? false };
    }),
});
