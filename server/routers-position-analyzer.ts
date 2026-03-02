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
  drawdownFromHigh: number;
  isCore: boolean;
  ccExpiration: string | null;
  ccAtmStrike: number | null;
  ccAtmPremium: number | null;
  ccWeeklyYield: number | null;
  ccEffectiveExit: number | null;
  recommendation: PositionRecommendation;
  recommendationReason: string;
  ccIsItm: boolean;
  openShortCalls: Array<{ strike: number; expiration: string; quantity: number; daysToExpiry: number }>;
  availableContracts: number;
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

  // ── CORE / BLUE-CHIP GUARD ──────────────────────────────────────────────────
  // Blue-chip / core holdings are NEVER liquidated — they will recover.
  // The worst outcome for a core stock is HARVEST (sell ITM CC to improve exit price).
  if (isCore) {
    if (drawdownFromHigh <= -50) {
      return { recommendation: 'HARVEST', reason: `Core holding down ${Math.abs(drawdownFromHigh).toFixed(0)}% from high — sell ITM CC to harvest premium while holding` };
    }
    if (yield_ >= 1.5) {
      return { recommendation: 'KEEP', reason: `Core holding with ${yield_.toFixed(1)}%/wk CC yield — continue wheeling` };
    }
    // Core with low yield but not deeply underwater → KEEP (wait for IV to improve)
    return { recommendation: 'KEEP', reason: `Core holding — maintain position, sell CC when IV improves` };
  }

  // ── NON-CORE LOGIC ─────────────────────────────────────────────────────
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
      const ccPremiumMap = new Map<string, { atmStrike: number; atmPremium: number; itmStrike: number; itmPremium: number; expiration: string }>();
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
          // Tradier raw API returns option_type ('call'/'put'); the wrapper preserves it
          const calls = chain.filter(o => (o as any).option_type === 'call' || o.type === 'call');
          if (calls.length === 0) continue;
          // Sort calls by strike ascending
          const sortedCalls = calls.slice().sort((a, b) => a.strike - b.strike);
          // For LIQUIDATE/HARVEST: pick ITM strike 1-2 strikes below current price to maximize premium & ensure assignment
          // For KEEP: pick ATM (closest to price)
          // We store both options; the frontend/recommendation logic picks which to show
          const atmCall = sortedCalls.reduce((best, c) =>
            Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best
          );
          // ITM: find the strike 1-2 steps below ATM (highest strike still below current price)
          const itmCandidates = sortedCalls.filter(c => c.strike < price);
          const itmCall = itmCandidates.length > 0
            ? itmCandidates[itmCandidates.length - 1]  // highest strike below price
            : atmCall;
          const atmMid = (atmCall.bid + atmCall.ask) / 2;
          const itmMid = (itmCall.bid + itmCall.ask) / 2;
          if (atmMid > 0 || itmMid > 0) {
            ccPremiumMap.set(sym, {
              atmStrike: atmCall.strike, atmPremium: atmMid,
              itmStrike: itmCall.strike, itmPremium: itmMid > 0 ? itmMid : atmMid,
              expiration: targetExp,
            });
          }
        } catch (e) {
          // Skip if option chain unavailable (e.g., no options on this name)
        }
      }

      // Fetch open short call positions per account to detect locked contracts
      // Map: `${symbol}-${accountNumber}` -> array of open short calls
      // NOTE: Tastytrade positions API uses 'quantity-direction' ("Short"/"Long"), NOT 'option-type'.
      //       We detect calls by checking if the OCC symbol contains 'C' (call marker).
      const openShortCallsMap = new Map<string, Array<{ strike: number; expiration: string; quantity: number; daysToExpiry: number }>>();
      for (const account of accountList) {
        try {
          const positions = await api.getPositions(account.accountNumber);
          const optionPositions = (positions || []).filter((p: any) => p['instrument-type'] === 'Equity Option');
          const shortCalls = optionPositions.filter((p: any) => {
            const direction = (p['quantity-direction'] || '').toLowerCase();
            const isShort = direction === 'short' || (typeof p.quantity === 'number' && p.quantity < 0);
            // OCC symbol format: AAPL  250117C00150000 — 'C' appears after the date digits
            const sym: string = p.symbol || '';
            const isCall = /\d{6}C\d/.test(sym) || sym.includes('C');
            return isShort && isCall;
          });
          for (const sc of shortCalls) {
            const underlying = sc['underlying-symbol'] || (sc.symbol || '').replace(/\s+\d.*$/, '').trim();
            if (!underlying) continue;
            // Parse expiration from 'expires-at' field, then OCC symbol date (YYMMDD at positions 6-12)
            const expiresAt = sc['expires-at'];
            let expDateStr = '';
            let expDate: Date | null = null;
            if (expiresAt) {
              expDate = new Date(expiresAt);
              expDateStr = expDate.toISOString().split('T')[0];
            } else {
              // OCC symbol: underlying (padded to 6) + YYMMDD + C/P + strike
              const sym: string = sc.symbol || '';
              const dateMatch = sym.match(/\d{6}([CP])/);
              if (dateMatch) {
                const dateIdx = sym.indexOf(dateMatch[0]);
                const yymmdd = sym.slice(dateIdx - 6, dateIdx);
                if (yymmdd.length === 6) {
                  const yy = parseInt(yymmdd.slice(0, 2), 10);
                  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1;
                  const dd = parseInt(yymmdd.slice(4, 6), 10);
                  expDate = new Date(2000 + yy, mm, dd);
                  expDateStr = expDate.toISOString().split('T')[0];
                }
              }
            }
            const daysToExpiry = expDate ? Math.max(0, Math.round((expDate.getTime() - today.getTime()) / 86400000)) : 0;
            // Parse strike from 'strike-price' field or OCC symbol (last 8 digits / 1000)
            let strike = parseFloat((sc as any)['strike-price'] || '0');
            if (!strike) {
              const sym: string = sc.symbol || '';
              const strikeMatch = sym.match(/[CP](\d{8})$/);
              if (strikeMatch) strike = parseInt(strikeMatch[1], 10) / 1000;
            }
            const qty = typeof sc.quantity === 'number' ? Math.abs(sc.quantity) : 1;
            const key = `${underlying}-${account.accountNumber}`;
            if (!openShortCallsMap.has(key)) openShortCallsMap.set(key, []);
            openShortCallsMap.get(key)!.push({
              strike,
              expiration: expDateStr,
              quantity: qty,
              daysToExpiry,
            });
            console.log(`[PositionAnalyzer] Detected short call: ${underlying} $${strike} ${expDateStr} (${daysToExpiry}d) in ${account.accountNumber}`);
          }
        } catch (e) {
          console.warn(`[PositionAnalyzer] Could not fetch option positions for ${account.accountNumber}:`, e);
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
        const isCore = CORE_NAMES.has(pos.symbol);
        // Use ATM yield for recommendation scoring
        const ccWeeklyYield = ccData && currentPrice > 0 ? (ccData.atmPremium / currentPrice) * 100 : null;
        const { recommendation, reason } = getRecommendation(drawdownFromHigh, ccWeeklyYield, isCore, marketValue);
        // For LIQUIDATE/HARVEST: use ITM strike to maximize premium and ensure assignment
        // For KEEP: use ATM strike to continue wheeling without forcing assignment
        const useItm = recommendation !== 'KEEP';
        const chosenStrike = ccData ? (useItm ? ccData.itmStrike : ccData.atmStrike) : null;
        const chosenPremium = ccData ? (useItm ? ccData.itmPremium : ccData.atmPremium) : null;
        const ccEffectiveExit = (chosenStrike && chosenPremium) ? chosenStrike + chosenPremium : null;
        const ccEffectiveYield = chosenPremium && currentPrice > 0 ? (chosenPremium / currentPrice) * 100 : null;
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
          ccAtmStrike: chosenStrike || null,
          ccAtmPremium: chosenPremium || null,
          ccWeeklyYield: ccEffectiveYield,
          ccEffectiveExit,
          recommendation,
          recommendationReason: reason,
          ccIsItm: useItm,
          openShortCalls: openShortCallsMap.get(`${pos.symbol}-${pos.accountNumber}`) || [],
          availableContracts: Math.max(0, Math.floor(pos.quantity / 100) - (openShortCallsMap.get(`${pos.symbol}-${pos.accountNumber}`) || []).reduce((s, sc) => s + sc.quantity, 0)),
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
      // Also remove the old getRedeploymentSuggestion reference if any
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

  /**
   * Get all liquidation flags for the current user
   */
  getLiquidationFlags: protectedProcedure
    .query(async ({ ctx }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return { flags: [] as Array<{ symbol: string; accountNumber: string; flaggedAt: Date }> };
      const { liquidationFlags } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const flags = await db.select({
        symbol: liquidationFlags.symbol,
        accountNumber: liquidationFlags.accountNumber,
        flaggedAt: liquidationFlags.flaggedAt,
      }).from(liquidationFlags).where(eq(liquidationFlags.userId, ctx.user.id));
      return { flags };
    }),

  /**
   * Flag a symbol/account for liquidation — blocks new covered call STO orders
   */
  flagForLiquidation: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      accountNumber: z.string().min(1).max(64),
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const { liquidationFlags } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      // Check if already flagged
      const existing = await db.select().from(liquidationFlags)
        .where(and(
          eq(liquidationFlags.userId, ctx.user.id),
          eq(liquidationFlags.symbol, input.symbol.toUpperCase()),
          eq(liquidationFlags.accountNumber, input.accountNumber),
        )).limit(1);
      if (existing.length > 0) {
        return { success: true, alreadyFlagged: true, symbol: input.symbol.toUpperCase() };
      }
      await db.insert(liquidationFlags).values({
        userId: ctx.user.id,
        symbol: input.symbol.toUpperCase(),
        accountNumber: input.accountNumber,
        note: input.note,
      });
      console.log(`[LiquidationFlag] ${input.symbol.toUpperCase()} flagged for liquidation by user ${ctx.user.id}`);
      return { success: true, alreadyFlagged: false, symbol: input.symbol.toUpperCase() };
    }),

  /**
   * Remove a liquidation flag — re-enables covered call automation for this symbol
   */
  unflagForLiquidation: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      accountNumber: z.string().min(1).max(64),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const { liquidationFlags } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      await db.delete(liquidationFlags)
        .where(and(
          eq(liquidationFlags.userId, ctx.user.id),
          eq(liquidationFlags.symbol, input.symbol.toUpperCase()),
          eq(liquidationFlags.accountNumber, input.accountNumber),
        ));
      console.log(`[LiquidationFlag] ${input.symbol.toUpperCase()} unflagged for liquidation by user ${ctx.user.id}`);
      return { success: true, symbol: input.symbol.toUpperCase() };
    }),

  /**
   * Check if a specific symbol/account is flagged for liquidation
   * Used by automation and CC dashboard before submitting STO orders
   */
  checkLiquidationFlag: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      accountNumber: z.string().min(1).max(64),
    }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return { isFlagged: false };
      const { liquidationFlags } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const flags = await db.select().from(liquidationFlags)
        .where(and(
          eq(liquidationFlags.userId, ctx.user.id),
          eq(liquidationFlags.symbol, input.symbol.toUpperCase()),
          eq(liquidationFlags.accountNumber, input.accountNumber),
        )).limit(1);
      return { isFlagged: flags.length > 0, flaggedAt: flags[0]?.flaggedAt ?? null };
    }),

  /**
   * Batch sell ITM covered calls for all flagged/LIQUIDATE positions at once
   */
  batchSellCCs: protectedProcedure
    .input(z.object({
      orders: z.array(z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        strike: z.number(),
        expiration: z.string(),
        quantity: z.number().int().positive(),
        limitPrice: z.number().positive(),
      })),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Tastytrade OAuth2 credentials not configured.' });
      }

      const results: Array<{
        symbol: string; strike: number; expiration: string; quantity: number;
        limitPrice: number; estimatedCredit: number; success: boolean;
        orderId?: string; error?: string;
      }> = [];

      const api = input.dryRun ? null : await authenticateTastytrade(credentials, ctx.user.id);

      for (const order of input.orders) {
        try {
          const expDate = new Date(order.expiration);
          const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, '');
          const strikeStr = (order.strike * 1000).toFixed(0).padStart(8, '0');
          const optionSymbol = `${order.symbol.padEnd(6)}${expStr}C${strikeStr}`;
          const estimatedCredit = order.limitPrice * order.quantity * 100;

          if (input.dryRun) {
            results.push({ symbol: order.symbol, strike: order.strike, expiration: order.expiration,
              quantity: order.quantity, limitPrice: order.limitPrice, estimatedCredit, success: true });
          } else {
            const result = await api!.submitOrder({
              accountNumber: order.accountNumber,
              timeInForce: 'Day',
              orderType: 'Limit',
              price: order.limitPrice.toFixed(2),
              priceEffect: 'Credit',
              legs: [{ instrumentType: 'Equity Option', symbol: optionSymbol,
                quantity: order.quantity.toString(), action: 'Sell to Open' }],
            });
            results.push({ symbol: order.symbol, strike: order.strike, expiration: order.expiration,
              quantity: order.quantity, limitPrice: order.limitPrice, estimatedCredit, success: true, orderId: result.id });
          }
        } catch (e: any) {
          results.push({ symbol: order.symbol, strike: order.strike, expiration: order.expiration,
            quantity: order.quantity, limitPrice: order.limitPrice, estimatedCredit: 0, success: false, error: e.message });
        }
      }

      const totalCredit = results.filter(r => r.success).reduce((s, r) => s + r.estimatedCredit, 0);
      return { dryRun: input.dryRun, results, totalCredit, successCount: results.filter(r => r.success).length };
    }),

  /**
   * Get liquidity progress toward TSLA coverage target
   */
  getLiquidationProgress: protectedProcedure
    .input(z.object({
      targetAmount: z.number().default(100750),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return { freedCapital: 0, targetAmount: input?.targetAmount ?? 100750, progressPct: 0, flaggedCount: 0 };
      const { liquidationFlags } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const flags = await db.select().from(liquidationFlags).where(eq(liquidationFlags.userId, ctx.user.id));
      let freedCapital = 0;
      for (const f of flags) {
        if (f.note) {
          try {
            const parsed = JSON.parse(f.note);
            if (parsed.freed) freedCapital += parsed.freed;
          } catch (_) {}
        }
      }
      const target = input?.targetAmount ?? 100750;
      return {
        freedCapital,
        targetAmount: target,
        progressPct: target > 0 ? Math.min(100, (freedCapital / target) * 100) : 0,
        flaggedCount: flags.length,
      };
    }),
});
