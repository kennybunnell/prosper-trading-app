/**
 * tRPC Router for Roll Detection and Management
 *
 * Uses spreadDetection.ts to identify BPS / BCS / IC / CSP / CC positions
 * and builds atomic multi-leg roll orders for each strategy type.
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import type { PositionWithMetrics } from "./rollDetection";
import { analyzePositionsForRolls, generateRollCandidates } from "./rollDetection";
import {
  detectSpreadStrategies,
  buildSpreadRollOrder,
  type RawOptionLeg,
  type SpreadPosition,
  type StrategyType,
} from "./spreadDetection";

// ─── OCC Symbol Helper ────────────────────────────────────────────────────────

function buildOCCSymbol(underlying: string, expiration: string, optionType: 'C' | 'P', strike: number): string {
  const expParts = expiration.split('-');
  const dateStr = expParts[0].slice(2) + expParts[1] + expParts[2]; // YYMMDD
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${underlying}${dateStr}${optionType}${strikeStr}`;
}

// ─── OCC Symbol Parser ────────────────────────────────────────────────────────

function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiration: string;
  optionType: 'PUT' | 'CALL';
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
  } catch (_) {
    return null;
  }
  return null;
}

// ─── Urgency Scoring for Spread Positions ────────────────────────────────────

function scoreSpreadUrgency(spread: SpreadPosition): { urgency: 'red' | 'yellow' | 'green'; reasons: string[]; score: number } {
  const reasons: string[] = [];
  let score = 0;

  // DTE urgency
  if (spread.dte <= 7) {
    score += 50;
    reasons.push(`Only ${spread.dte} DTE — urgent`);
  } else if (spread.dte <= 14) {
    score += 25;
    reasons.push(`${spread.dte} DTE — watch`);
  }

  // Profit captured
  if (spread.profitCaptured >= 80) {
    score += 30;
    reasons.push(`${spread.profitCaptured.toFixed(0)}% profit captured — ready to close/roll`);
  } else if (spread.profitCaptured >= 50) {
    score += 10;
    reasons.push(`${spread.profitCaptured.toFixed(0)}% profit captured`);
  }

  const urgency: 'red' | 'yellow' | 'green' =
    score >= 50 ? 'red' : score >= 20 ? 'yellow' : 'green';

  return { urgency, reasons, score };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const rollsRouter = router({
  /**
   * Scan all accounts for positions that need rolling.
   * Detects BPS / BCS / IC / CSP / CC strategies and returns them grouped by urgency.
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

      let targetAccounts = accounts;
      if (input?.accountId) {
        const found = accounts.find(acc => acc.accountId === input.accountId);
        if (found) targetAccounts = [found];
      }

      const rawLegs: RawOptionLeg[] = [];
      const symbolsToFetch = new Set<string>();
      const currentPrices: Record<string, number> = {};

      // First pass: collect ALL option legs (long and short) across all accounts
      for (const account of targetAccounts) {
        const positions = await api.getPositions(account.accountNumber);
        if (!positions) continue;

        for (const pos of positions) {
          if (pos['instrument-type'] !== 'Equity Option') continue;

          const symbol = pos.symbol || '';
          const parsed = parseOptionSymbol(symbol);
          if (!parsed) continue;

          symbolsToFetch.add(parsed.underlying);

          const rawQty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          // Tastytrade: quantity is always positive, direction tells us long/short
          const signedQty = direction === 'short' ? -Math.abs(rawQty) : Math.abs(rawQty);

          const openPrice = parseFloat(String(pos['average-open-price'] || '0'));
          const closePrice = parseFloat(String(pos['close-price'] || '0'));
          const markPrice = parseFloat(String((pos as any)['mark-price'] || closePrice || '0'));

          rawLegs.push({
            symbol,
            underlying: parsed.underlying,
            optionType: parsed.optionType,
            strike: parsed.strike,
            expiration: parsed.expiration,
            quantity: signedQty,
            openPrice,
            markPrice,
            accountNumber: account.accountNumber,
          });
        }
      }

      // Batch fetch underlying prices from Tradier
      if (symbolsToFetch.size > 0) {
        for (const sym of Array.from(symbolsToFetch)) {
          try {
            const quote = await tradier.getQuote(sym);
            if (quote?.last) currentPrices[sym] = quote.last;
          } catch (e) {
            console.warn(`[scanRollPositions] Could not fetch price for ${sym}:`, e);
          }
        }
      }

      // Detect spread strategies from all legs
      const spreads = detectSpreadStrategies(rawLegs);

      // Score each spread for urgency
      const scoredSpreads = spreads.map(spread => {
        const { urgency, reasons, score } = scoreSpreadUrgency(spread);
        const underlyingPrice = currentPrices[spread.underlying] || spread.shortStrike || 0;

        // Build a positionId that encodes the spread for the frontend
        const positionId = spread.id;

        // For the roll candidates query, we need the short leg details
        const shortLeg = spread.legs.find(l => l.role === 'short');

        return {
          positionId,
          symbol: spread.underlying,
          // For spreads, use the short leg's OCC symbol as the "primary" symbol
          optionSymbol: shortLeg?.symbol || '',
          strategy: spread.strategyType,
          urgency,
          shouldRoll: urgency === 'red' || urgency === 'yellow',
          reasons,
          score,
          accountNumber: spread.accountNumber,
          metrics: {
            dte: spread.dte,
            profitCaptured: spread.profitCaptured,
            itmDepth: underlyingPrice > 0 && shortLeg
              ? ((underlyingPrice - shortLeg.strike) / underlyingPrice) * 100
              : 0,
            delta: 0,
            currentPrice: underlyingPrice,
            strikePrice: shortLeg?.strike || 0,
            currentValue: spread.currentValue,
            openPremium: spread.openPremium,
            expiration: spread.expiration,
          },
          // Spread-specific fields for the UI
          spreadDetails: {
            strategyType: spread.strategyType,
            shortStrike: spread.shortStrike,
            longStrike: spread.longStrike,
            spreadWidth: spread.spreadWidth,
            putShortStrike: spread.putShortStrike,
            putLongStrike: spread.putLongStrike,
            callShortStrike: spread.callShortStrike,
            callLongStrike: spread.callLongStrike,
            legs: spread.legs.map(l => ({
              symbol: l.symbol,
              optionType: l.optionType,
              strike: l.strike,
              expiration: l.expiration,
              role: l.role,
              quantity: l.quantity,
              markPrice: l.markPrice,
              openPrice: l.openPrice,
            })),
          },
        };
      });

      const red    = scoredSpreads.filter(s => s.urgency === 'red');
      const yellow = scoredSpreads.filter(s => s.urgency === 'yellow');
      const green  = scoredSpreads.filter(s => s.urgency === 'green');

      return {
        red,
        yellow,
        green,
        all: scoredSpreads,
        total: scoredSpreads.length,
        accountsScanned: targetAccounts.length,
      };
    }),

  /**
   * Get roll candidates for a specific position.
   * For spreads, uses the short leg's strike/expiry to generate candidates.
   * The caller passes the strategy type so we can generate appropriate candidates.
   */
  getRollCandidates: protectedProcedure
    .input(z.object({
      positionId: z.string(),
      symbol: z.string(),
      strategy: z.enum(['csp', 'cc', 'bps', 'bcs', 'ic']),
      strikePrice: z.number(),        // Short leg strike
      expirationDate: z.string(),
      currentValue: z.number(),
      openPremium: z.number(),
      spreadWidth: z.number().optional(),  // For spreads: width of the spread
    }))
    .query(async ({ input, ctx }) => {
      const { getApiCredentials } = await import('./db');
      const { TradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) throw new Error('Credentials not found');

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

        // Map spread strategy to the base type for roll candidate generation
        const baseStrategy: 'csp' | 'cc' = ['bps', 'csp', 'ic'].includes(input.strategy) ? 'csp' : 'cc';

        const mockPosition: PositionWithMetrics = {
          id: parseInt(input.positionId) || Math.floor(Math.random() * 1000000),
          userId: ctx.user.id,
          accountId: 'mock',
          symbol: input.symbol,
          positionType: 'option',
          strategy: baseStrategy,
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
            baseStrategy === 'csp' ? 'P' : 'C',
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
          strategy: baseStrategy.toUpperCase() as 'CSP' | 'CC',
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

        // For spreads, annotate candidates with spread-specific info
        const annotatedCandidates = candidates.map(c => ({
          ...c,
          spreadWidth: input.spreadWidth,
          isSpread: ['bps', 'bcs', 'ic'].includes(input.strategy),
          strategyType: input.strategy.toUpperCase() as StrategyType,
        }));

        return { candidates: annotatedCandidates, underlyingPrice };
      } catch (error: any) {
        console.error('[getRollCandidates] Error:', error.message);
        return {
          candidates: [{
            action: 'close' as const,
            score: 50,
            description: `Close position (Error: ${error.message})`,
            spreadWidth: input.spreadWidth,
            isSpread: false,
            strategyType: input.strategy.toUpperCase() as StrategyType,
          }],
          underlyingPrice: input.strikePrice,
        };
      }
    }),

  /**
   * Submit roll orders atomically.
   *
   * For CSP/CC: 2-leg order (BTC + STO)
   * For BPS/BCS: 4-leg order (BTC short + BTC long + STO new short + STO new long)
   * For IC: 8-leg order (BTC all 4 + STO 4 new)
   *
   * Each order is a single Tastytrade combo order submitted in one API call.
   */
  submitRollOrders: protectedProcedure
    .input(z.object({
      dryRun: z.boolean().default(false),
      orders: z.array(z.object({
        accountNumber: z.string(),
        symbol: z.string(),
        strategyType: z.enum(['CSP', 'CC', 'BPS', 'BCS', 'IC']),
        action: z.enum(['roll', 'close']),

        // ── For CSP / CC (single-leg roll) ──
        currentOptionSymbol: z.string().optional(),
        currentQuantity: z.number().optional(),
        currentValue: z.number().optional(),
        newStrike: z.number().optional(),
        newExpiration: z.string().optional(),
        netCredit: z.number().optional(),

        // ── For BPS / BCS / IC (multi-leg atomic roll) ──
        // Provide the full spread position data so we can build the order
        spreadLegs: z.array(z.object({
          symbol: z.string(),
          role: z.enum(['short', 'long']),
          optionType: z.enum(['PUT', 'CALL']),
          strike: z.number(),
          expiration: z.string(),
          quantity: z.number(),
          markPrice: z.number(),
          openPrice: z.number(),
        })).optional(),
        spreadWidth: z.number().optional(),
        newShortStrike: z.number().optional(),
        putShortStrike: z.number().optional(),
        callShortStrike: z.number().optional(),
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
        strategyType: string;
        action: string;
        success: boolean;
        orderId?: string;
        error?: string;
        dryRun: boolean;
        legCount: number;
      }> = [];

      for (const order of input.orders) {
        try {
          let legs: Array<{
            instrumentType: 'Equity Option';
            symbol: string;
            quantity: string;
            action: 'Buy to Close' | 'Sell to Open';
          }> = [];

          let price: string;
          let priceEffect: 'Credit' | 'Debit';

          if (['BPS', 'BCS', 'IC'].includes(order.strategyType) && order.spreadLegs && order.action === 'roll') {
            // ── Multi-leg atomic roll for spreads ──
            const spreadLegs = order.spreadLegs!;
            const qty = Math.abs(spreadLegs[0]?.quantity || 1);
            const newExpiration = order.newExpiration!;
            const newShortStrike = order.newShortStrike!;

            if (order.strategyType === 'BPS') {
              const shortLeg = spreadLegs.find(l => l.role === 'short' && l.optionType === 'PUT')!;
              const longLeg  = spreadLegs.find(l => l.role === 'long'  && l.optionType === 'PUT')!;
              const width = order.spreadWidth || Math.abs(shortLeg.strike - longLeg.strike);
              const newLongStrike = newShortStrike - width;

              // BTC existing legs
              legs.push({ instrumentType: 'Equity Option', symbol: shortLeg.symbol, quantity: String(qty), action: 'Buy to Close' });
              legs.push({ instrumentType: 'Equity Option', symbol: longLeg.symbol,  quantity: String(qty), action: 'Buy to Close' });
              // STO new legs
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'P', newShortStrike), quantity: String(qty), action: 'Sell to Open' });
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'P', newLongStrike),  quantity: String(qty), action: 'Sell to Open' });

            } else if (order.strategyType === 'BCS') {
              const shortLeg = spreadLegs.find(l => l.role === 'short' && l.optionType === 'CALL')!;
              const longLeg  = spreadLegs.find(l => l.role === 'long'  && l.optionType === 'CALL')!;
              const width = order.spreadWidth || Math.abs(shortLeg.strike - longLeg.strike);
              const newLongStrike = newShortStrike + width;

              legs.push({ instrumentType: 'Equity Option', symbol: shortLeg.symbol, quantity: String(qty), action: 'Buy to Close' });
              legs.push({ instrumentType: 'Equity Option', symbol: longLeg.symbol,  quantity: String(qty), action: 'Buy to Close' });
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'C', newShortStrike), quantity: String(qty), action: 'Sell to Open' });
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'C', newLongStrike),  quantity: String(qty), action: 'Sell to Open' });

            } else if (order.strategyType === 'IC') {
              const putShort  = spreadLegs.find(l => l.role === 'short' && l.optionType === 'PUT')!;
              const putLong   = spreadLegs.find(l => l.role === 'long'  && l.optionType === 'PUT')!;
              const callShort = spreadLegs.find(l => l.role === 'short' && l.optionType === 'CALL')!;
              const callLong  = spreadLegs.find(l => l.role === 'long'  && l.optionType === 'CALL')!;
              const putWidth  = Math.abs(putShort.strike  - putLong.strike);
              const callWidth = Math.abs(callShort.strike - callLong.strike);
              const strikeGap = callShort.strike - putShort.strike;
              const newPutLong    = newShortStrike - putWidth;
              const newCallShort  = newShortStrike + strikeGap;
              const newCallLong   = newCallShort + callWidth;

              // BTC all 4 existing legs
              legs.push({ instrumentType: 'Equity Option', symbol: putShort.symbol,  quantity: String(qty), action: 'Buy to Close' });
              legs.push({ instrumentType: 'Equity Option', symbol: putLong.symbol,   quantity: String(qty), action: 'Buy to Close' });
              legs.push({ instrumentType: 'Equity Option', symbol: callShort.symbol, quantity: String(qty), action: 'Buy to Close' });
              legs.push({ instrumentType: 'Equity Option', symbol: callLong.symbol,  quantity: String(qty), action: 'Buy to Close' });
              // STO 4 new legs
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'P', newShortStrike), quantity: String(qty), action: 'Sell to Open' });
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'P', newPutLong),     quantity: String(qty), action: 'Sell to Open' });
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'C', newCallShort),   quantity: String(qty), action: 'Sell to Open' });
              legs.push({ instrumentType: 'Equity Option', symbol: buildOCCSymbol(order.symbol, newExpiration, 'C', newCallLong),    quantity: String(qty), action: 'Sell to Open' });
            }

            const absPrice = Math.abs(order.netCredit || 0);
            price = absPrice.toFixed(2);
            priceEffect = (order.netCredit || 0) >= 0 ? 'Credit' : 'Debit';

          } else if (['BPS', 'BCS', 'IC'].includes(order.strategyType) && order.spreadLegs && order.action === 'close') {
            // ── Close-only for spreads: BTC all legs ──
            const spreadLegs = order.spreadLegs!;
            const qty = Math.abs(spreadLegs[0]?.quantity || 1);
            for (const leg of spreadLegs) {
              if (leg.role === 'short') {
                legs.push({ instrumentType: 'Equity Option', symbol: leg.symbol, quantity: String(qty), action: 'Buy to Close' });
              } else {
                // Long legs: sell to close
                legs.push({ instrumentType: 'Equity Option', symbol: leg.symbol, quantity: String(qty), action: 'Sell to Open' });
              }
            }
            const closeCost = spreadLegs
              .filter(l => l.role === 'short')
              .reduce((sum, l) => sum + l.markPrice, 0) * qty * 100;
            price = Math.abs(closeCost).toFixed(2);
            priceEffect = 'Debit';

          } else {
            // ── Single-leg CSP / CC roll ──
            if (!order.currentOptionSymbol) throw new Error('currentOptionSymbol required for CSP/CC roll');
            const qty = order.currentQuantity || 1;

            legs.push({
              instrumentType: 'Equity Option',
              symbol: order.currentOptionSymbol,
              quantity: String(qty),
              action: 'Buy to Close',
            });

            if (order.action === 'roll' && order.newStrike && order.newExpiration) {
              const optType = order.strategyType === 'CC' ? 'C' : 'P';
              legs.push({
                instrumentType: 'Equity Option',
                symbol: buildOCCSymbol(order.symbol, order.newExpiration, optType, order.newStrike),
                quantity: String(qty),
                action: 'Sell to Open',
              });
            }

            const absPrice = order.action === 'roll' && order.netCredit !== undefined
              ? Math.abs(order.netCredit)
              : Math.abs(order.currentValue || 0);
            price = absPrice.toFixed(2);
            priceEffect = order.action === 'roll' && (order.netCredit || 0) >= 0 ? 'Credit' : 'Debit';
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
            await api.dryRunOrder(orderRequest);
            results.push({
              symbol: order.symbol,
              accountNumber: order.accountNumber,
              strategyType: order.strategyType,
              action: order.action,
              success: true,
              orderId: `dry-run-${order.symbol}-${order.strategyType}`,
              dryRun: true,
              legCount: legs.length,
            });
          } else {
            const submitted = await api.submitOrder(orderRequest);
            results.push({
              symbol: order.symbol,
              accountNumber: order.accountNumber,
              strategyType: order.strategyType,
              action: order.action,
              success: true,
              orderId: submitted.id,
              dryRun: false,
              legCount: legs.length,
            });
          }
        } catch (error: any) {
          results.push({
            symbol: order.symbol,
            accountNumber: order.accountNumber,
            strategyType: order.strategyType,
            action: order.action,
            success: false,
            error: error.message,
            dryRun: input.dryRun,
            legCount: 0,
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount    = results.filter(r => !r.success).length;

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
