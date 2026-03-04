/**
 * Position Analyzer Router
 *
 * Scans all held stock positions across all accounts and evaluates each one as:
 *   KEEP        — no cost-basis deficit (position is profitable), continue wheeling
 *   HARVEST     — WTR ≤ 16 weeks (≤4 months): recoverable via CC premium, sell calls aggressively
 *   MONITOR     — WTR 17–52 weeks (4–12 months): watch closely, reassess monthly
 *   LIQUIDATE   — WTR > 52 weeks (>1 year): takes too long to recover, exit position
 *
 * Primary scoring metric: Weeks-to-Recover (WTR)
 *   WTR = (Avg Cost Basis − Current Price) / Weekly ATM CC Premium
 *
 * If current price ≥ avg cost basis → no deficit → KEEP (no WTR calculation needed)
 * MONITOR positions accumulate quietly until WTR tips above 52 weeks, at which
 * point they automatically surface as LIQUIDATE dogs on the next scan.
 *
 * The old CORE_NAMES bias and 52-week drawdown scoring have been removed.
 * Performance (ability to recover basis via CC premium) is the bottom line.
 */
import { router, protectedProcedure } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

export type PositionRecommendation = 'KEEP' | 'HARVEST' | 'MONITOR' | 'LIQUIDATE';

/**
 * Target delta tier for covered call strike selection.
 * Derived from WTR — deeper deficits use higher delta (more premium);
 * nearly-recovered positions use lower delta (more assignment protection).
 */
export type CCDeltaTier = 'ITM' | 'ATM' | 'D30' | 'D25' | 'D20';

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
  /** Weeks-to-Recover: (avgCostBasis - currentPrice) / weeklyATMPremium. null if no deficit. */
  weeksToRecover: number | null;
  /** Months-to-Recover for display: weeksToRecover / 4.33. null if no deficit. */
  monthsToRecover: number | null;
  ccExpiration: string | null;
  ccAtmStrike: number | null;
  ccAtmPremium: number | null;
  ccWeeklyYield: number | null;
  ccEffectiveExit: number | null;
  recommendation: PositionRecommendation;
  recommendationReason: string;
  /** Delta tier used for the recommended CC strike */
  ccDeltaTier: CCDeltaTier;
  /** Whether the recommended strike is ITM (below current price) */
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
    monitorCount: number;
    liquidateCount: number;
    totalMarketValue: number;
    totalUnrealizedPnl: number;
    estimatedWeeklyPremium: number; // if all HARVEST positions sell ATM CC
    estimatedLiquidationProceeds: number; // if all LIQUIDATE positions are exited
  };
  scannedAt: string;
}

/**
 * Determine the target CC delta tier based on WTR.
 *
 * Tiered OTM strategy (all OTM — no ITM calls for HARVEST):
 *   WTR > 10 weeks  (deeper deficit)  → Δ0.30 (~1.5% OTM): maximize premium, still OTM
 *   WTR 5–10 weeks (moderate deficit) → Δ0.25 (~2.5% OTM): balanced harvest
 *   WTR < 5 weeks  (nearly recovered) → Δ0.20 (~3.5% OTM): protect the gain
 *   KEEP (no deficit)                 → ATM: continue wheeling
 *   MONITOR/LIQUIDATE                 → ATM or ITM: exit-oriented
 *
 * For MONITOR: use ATM to collect max premium while watching
 * For LIQUIDATE: use ITM to force assignment and exit quickly
 */
function getCCDeltaTier(
  recommendation: PositionRecommendation,
  weeksToRecover: number | null,
): CCDeltaTier {
  if (recommendation === 'KEEP') return 'ATM';
  if (recommendation === 'LIQUIDATE') return 'ITM';
  if (recommendation === 'MONITOR') return 'ATM'; // max premium while watching
  // HARVEST — tiered OTM by WTR
  if (weeksToRecover === null) return 'ATM';
  if (weeksToRecover > 10) return 'D30';  // deeper deficit: Δ0.30 (~1.5% OTM)
  if (weeksToRecover > 5) return 'D25';   // moderate: Δ0.25 (~2.5% OTM)
  return 'D20';                            // nearly recovered: Δ0.20 (~3.5% OTM)
}

/**
 * Given a sorted list of call strikes and a current price, find the best strike
 * for the target delta tier.
 *
 * Delta approximation (weekly options, ~7 DTE):
 *   ITM  → highest strike BELOW current price
 *   ATM  → closest strike to current price
 *   D30  → ~1.5% above current price
 *   D25  → ~2.5% above current price
 *   D20  → ~3.5% above current price
 */
function pickStrikeForDeltaTier(
  sortedStrikes: number[],
  currentPrice: number,
  tier: CCDeltaTier,
): number | null {
  if (sortedStrikes.length === 0) return null;
  if (tier === 'ITM') {
    // Highest strike below current price
    const candidates = sortedStrikes.filter(s => s < currentPrice);
    return candidates.length > 0 ? candidates[candidates.length - 1] : sortedStrikes[0];
  }
  if (tier === 'ATM') {
    // Closest to current price
    return sortedStrikes.reduce((best, s) =>
      Math.abs(s - currentPrice) < Math.abs(best - currentPrice) ? s : best
    );
  }
  // OTM tiers — target a specific % above current price
  const targetPct: Record<CCDeltaTier, number> = { ITM: 0, ATM: 0, D30: 0.015, D25: 0.025, D20: 0.035 };
  const targetPrice = currentPrice * (1 + targetPct[tier]);
  // Find the closest strike to the target price that is OTM (>= current price)
  const otmStrikes = sortedStrikes.filter(s => s >= currentPrice);
  if (otmStrikes.length === 0) {
    // Fallback: closest overall
    return sortedStrikes.reduce((best, s) =>
      Math.abs(s - targetPrice) < Math.abs(best - targetPrice) ? s : best
    );
  }
  return otmStrikes.reduce((best, s) =>
    Math.abs(s - targetPrice) < Math.abs(best - targetPrice) ? s : best
  );
}

/**
 * Compute Weeks-to-Recover (WTR) and derive the position recommendation.
 *
 * WTR = (avgCostBasis − currentPrice) / weeklyATMPremium
 *
 * Tiers:
 *   No deficit (price ≥ basis)  → KEEP   — profitable, continue wheeling
 *   WTR ≤ 16 weeks              → HARVEST — recoverable in ≤4 months, sell calls aggressively
 *   WTR 17–52 weeks             → MONITOR — 4–12 months, watch closely and reassess monthly
 *   WTR > 52 weeks              → LIQUIDATE — >1 year to recover basis, exit position
 *   No premium available        → LIQUIDATE — cannot harvest, exit
 */
function getWTRRecommendation(
  avgCostBasis: number,
  currentPrice: number,
  weeklyATMPremium: number | null,
): { recommendation: PositionRecommendation; reason: string; weeksToRecover: number | null; monthsToRecover: number | null } {
  const deficit = avgCostBasis - currentPrice;

  // No deficit — position is at or above cost basis
  if (deficit <= 0) {
    const gainPct = avgCostBasis > 0 ? ((currentPrice - avgCostBasis) / avgCostBasis * 100).toFixed(1) : '0.0';
    return {
      recommendation: 'KEEP',
      reason: `Above cost basis by ${gainPct}% — continue wheeling`,
      weeksToRecover: null,
      monthsToRecover: null,
    };
  }

  // Has a deficit — compute WTR
  const deficitPerShare = deficit;
  const premium = weeklyATMPremium ?? 0;

  if (premium <= 0) {
    // No option premium available — cannot harvest, recommend exit
    return {
      recommendation: 'LIQUIDATE',
      reason: `Below basis by $${deficitPerShare.toFixed(2)}/share with no available CC premium — exit position`,
      weeksToRecover: null,
      monthsToRecover: null,
    };
  }

  const wtr = deficitPerShare / premium;
  const mtr = wtr / 4.33; // weeks → months

  if (wtr <= 16) {
    return {
      recommendation: 'HARVEST',
      reason: `WTR ${wtr.toFixed(1)} wks (${mtr.toFixed(1)} mo) — recoverable in ≤4 months, sell CC aggressively`,
      weeksToRecover: wtr,
      monthsToRecover: mtr,
    };
  }

  if (wtr <= 52) {
    return {
      recommendation: 'MONITOR',
      reason: `WTR ${wtr.toFixed(1)} wks (${mtr.toFixed(1)} mo) — 4–12 months to recover, watch closely`,
      weeksToRecover: wtr,
      monthsToRecover: mtr,
    };
  }

  // WTR > 52 weeks — takes over a year, recommend exit
  return {
    recommendation: 'LIQUIDATE',
    reason: `WTR ${wtr.toFixed(1)} wks (${mtr.toFixed(1)} mo) — over 1 year to recover basis, exit and redeploy capital`,
    weeksToRecover: wtr,
    monthsToRecover: mtr,
  };
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
            totalPositions: 0, keepCount: 0, harvestCount: 0, monitorCount: 0, liquidateCount: 0,
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

        // Fetch call option chain for each unique symbol (nearest Friday)
      // We store the full sorted strike list so we can pick the right OTM strike per delta tier
      const ccChainMap = new Map<string, {
        expiration: string;
        sortedStrikes: number[];
        strikeToMid: Map<number, number>;
        atmStrike: number;
        atmPremium: number;
      }>();
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
          const calls = chain.filter(o => (o as any).option_type === 'call' || o.type === 'call');
          if (calls.length === 0) continue;
          // Build strike → mid-price map
          const strikeToMid = new Map<number, number>();
          for (const c of calls) {
            const mid = (c.bid + c.ask) / 2;
            if (mid > 0) strikeToMid.set(c.strike, mid);
          }
          const sortedStrikes = Array.from(strikeToMid.keys()).sort((a, b) => a - b);
          if (sortedStrikes.length === 0) continue;
          // ATM = closest strike to current price (used for WTR calculation and KEEP/MONITOR)
          const atmStrike = sortedStrikes.reduce((best, s) =>
            Math.abs(s - price) < Math.abs(best - price) ? s : best
          );
          const atmPremium = strikeToMid.get(atmStrike) ?? 0;
          if (atmPremium > 0) {
            ccChainMap.set(sym, { expiration: targetExp, sortedStrikes, strikeToMid, atmStrike, atmPremium });
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

          const ccChain = ccChainMap.get(pos.symbol);
        // WTR-based recommendation — primary metric (always uses ATM premium for WTR calculation)
        const { recommendation, reason, weeksToRecover, monthsToRecover } = getWTRRecommendation(
          pos.avgOpenPrice,
          currentPrice,
          ccChain?.atmPremium ?? null,
        );
        // Determine the target delta tier for this position based on WTR
        const deltaTier = getCCDeltaTier(recommendation, weeksToRecover);
        // Pick the actual strike from the live chain for this delta tier
        const chosenStrike = ccChain
          ? pickStrikeForDeltaTier(ccChain.sortedStrikes, currentPrice, deltaTier)
          : null;
        const chosenPremium = (chosenStrike && ccChain)
          ? (ccChain.strikeToMid.get(chosenStrike) ?? null)
          : null;
        // ATM yield for display (always ATM, for reference)
        const ccWeeklyYield = ccChain && currentPrice > 0 ? (ccChain.atmPremium / currentPrice) * 100 : null;
        const ccEffectiveExit = (chosenStrike && chosenPremium) ? chosenStrike + chosenPremium : null;
        const ccEffectiveYield = chosenPremium && currentPrice > 0 ? (chosenPremium / currentPrice) * 100 : null;
        const ccIsItm = chosenStrike !== null && chosenStrike < currentPrice;
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
          weeksToRecover,
          monthsToRecover,
          ccExpiration: ccChain?.expiration || null,
          ccAtmStrike: chosenStrike || null,
          ccAtmPremium: chosenPremium || null,
          ccWeeklyYield: ccEffectiveYield,
          ccEffectiveExit,
          recommendation,
          recommendationReason: reason,
          ccDeltaTier: deltaTier,
          ccIsItm,
          openShortCalls: openShortCallsMap.get(`${pos.symbol}-${pos.accountNumber}`) || [],
          availableContracts: Math.max(0, Math.floor(pos.quantity / 100) - (openShortCallsMap.get(`${pos.symbol}-${pos.accountNumber}`) || []).reduce((s, sc) => s + sc.quantity, 0)),
        });
      }

      // ─── Auto-unflag: remove flags for positions that no longer exist in Tastytrade ──────────
      // Build a set of all live equity symbols across all scanned accounts
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (db) {
          const { liquidationFlags } = await import('../drizzle/schema');
          const { eq, and, notInArray } = await import('drizzle-orm');
          // Get all current flags for this user
          const existingFlags = await db.select({
            symbol: liquidationFlags.symbol,
            accountNumber: liquidationFlags.accountNumber,
          }).from(liquidationFlags).where(eq(liquidationFlags.userId, ctx.user.id));
          // Build set of live positions: "SYMBOL-ACCOUNT"
          const liveKeys = new Set(allStockPositions.map(p => `${p.symbol.toUpperCase()}-${p.accountNumber}`));
          // Find flags whose symbol is no longer in any live account position
          const staleFlags = existingFlags.filter(f => !liveKeys.has(`${f.symbol.toUpperCase()}-${f.accountNumber}`));
          for (const stale of staleFlags) {
            await db.delete(liquidationFlags).where(
              and(
                eq(liquidationFlags.userId, ctx.user.id),
                eq(liquidationFlags.symbol, stale.symbol),
                eq(liquidationFlags.accountNumber, stale.accountNumber),
              )
            );
            console.log(`[PositionAnalyzer] Auto-unflagged ${stale.symbol} (${stale.accountNumber}) — position no longer in Tastytrade`);
          }
          if (staleFlags.length > 0) {
            console.log(`[PositionAnalyzer] Auto-removed ${staleFlags.length} stale liquidation flag(s)`);
          }
        }
      } catch (e) {
        console.warn('[PositionAnalyzer] Auto-unflag check failed (non-fatal):', e);
      }
      // ─────────────────────────────────────────────────────────────────────────────────────────

      // Sort: LIQUIDATE first, then MONITOR, then HARVEST, then KEEP; within each group by WTR desc (worst first)
      const order: Record<PositionRecommendation, number> = { LIQUIDATE: 0, MONITOR: 1, HARVEST: 2, KEEP: 3 };
      analyzedPositions.sort((a, b) => {
        const orderDiff = order[a.recommendation] - order[b.recommendation];
        if (orderDiff !== 0) return orderDiff;
        // Within same tier: sort by WTR descending (worst recovery first), then by market value
        const aWTR = a.weeksToRecover ?? -1;
        const bWTR = b.weeksToRecover ?? -1;
        if (bWTR !== aWTR) return bWTR - aWTR;
        return b.marketValue - a.marketValue;
      });

      const keepCount = analyzedPositions.filter(p => p.recommendation === 'KEEP').length;
      const harvestCount = analyzedPositions.filter(p => p.recommendation === 'HARVEST').length;
      const monitorCount = analyzedPositions.filter(p => p.recommendation === 'MONITOR').length;
      const liquidateCount = analyzedPositions.filter(p => p.recommendation === 'LIQUIDATE').length;
      const totalMarketValue = analyzedPositions.reduce((s, p) => s + p.marketValue, 0);
      const totalUnrealizedPnl = analyzedPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
      // Estimated weekly premium from HARVEST positions only (those actively selling calls to recover)
      const estimatedWeeklyPremium = analyzedPositions
        .filter(p => p.recommendation === 'HARVEST' && p.ccAtmPremium)
        .reduce((s, p) => s + (p.ccAtmPremium! * Math.floor(p.quantity / 100) * 100), 0);
      const estimatedLiquidationProceeds = analyzedPositions
        .filter(p => p.recommendation === 'LIQUIDATE')
        .reduce((s, p) => s + p.marketValue, 0);

      // ─── Save WTR history for trend tracking ────────────────────────────────────
      const scannedAt = new Date();
      const scanDate = scannedAt.toISOString().split('T')[0]; // YYYY-MM-DD
      const scannedAtMs = scannedAt.getTime();
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (db) {
          const { wtrHistory } = await import('../drizzle/schema');
          const { eq, and } = await import('drizzle-orm');
          for (const pos of analyzedPositions) {
            // Upsert: one record per (userId, symbol, accountNumber, scanDate)
            const existing = await db.select({ id: wtrHistory.id })
              .from(wtrHistory)
              .where(and(
                eq(wtrHistory.userId, ctx.user.id),
                eq(wtrHistory.symbol, pos.symbol),
                eq(wtrHistory.accountNumber, pos.accountNumber),
                eq(wtrHistory.scanDate, scanDate),
              )).limit(1);
            const wtrVal = pos.weeksToRecover !== null ? pos.weeksToRecover.toFixed(2) : null;
            if (existing.length > 0) {
              await db.update(wtrHistory)
                .set({
                  scannedAt: scannedAtMs,
                  weeksToRecover: wtrVal,
                  recommendation: pos.recommendation,
                  avgCostBasis: pos.avgOpenPrice.toFixed(2),
                  currentPrice: pos.currentPrice.toFixed(2),
                })
                .where(eq(wtrHistory.id, existing[0].id));
            } else {
              await db.insert(wtrHistory).values({
                userId: ctx.user.id,
                symbol: pos.symbol,
                accountNumber: pos.accountNumber,
                scanDate,
                scannedAt: scannedAtMs,
                weeksToRecover: wtrVal,
                recommendation: pos.recommendation,
                avgCostBasis: pos.avgOpenPrice.toFixed(2),
                currentPrice: pos.currentPrice.toFixed(2),
              });
            }
          }
          console.log(`[PositionAnalyzer] Saved WTR history for ${analyzedPositions.length} positions (${scanDate})`);
        }
      } catch (e) {
        console.warn('[PositionAnalyzer] WTR history save failed (non-fatal):', e);
      }
      // ─────────────────────────────────────────────────────────────────────────────

      return {
        positions: analyzedPositions,
        summary: {
          totalPositions: analyzedPositions.length,
          keepCount,
          harvestCount,
          monitorCount,
          liquidateCount,
          totalMarketValue,
          totalUnrealizedPnl,
          estimatedWeeklyPremium,
          estimatedLiquidationProceeds,
        },
        scannedAt: scannedAt.toISOString(),
      } as PositionAnalyzerResult;
    }),

  /**
   * Get WTR trend for all positions — returns the last 8 scan dates and WTR values
   * per (symbol, accountNumber) so the UI can show week-over-week deltas.
   */
  getWtrTrend: protectedProcedure
    .query(async ({ ctx }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return { trend: {} as Record<string, Array<{ scanDate: string; weeksToRecover: number | null; recommendation: string }>> };
      const { wtrHistory } = await import('../drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');

      // Fetch last 8 scan dates for this user
      const allRows = await db.select()
        .from(wtrHistory)
        .where(eq(wtrHistory.userId, ctx.user.id))
        .orderBy(desc(wtrHistory.scannedAt))
        .limit(8 * 60); // up to 60 positions × 8 scans

      // Group by symbol+account key, keep last 8 unique scan dates per position
      const trendMap: Record<string, Array<{ scanDate: string; weeksToRecover: number | null; recommendation: string }>> = {};
      for (const row of allRows) {
        const key = `${row.symbol}-${row.accountNumber}`;
        if (!trendMap[key]) trendMap[key] = [];
        if (trendMap[key].length < 8) {
          trendMap[key].push({
            scanDate: row.scanDate,
            weeksToRecover: row.weeksToRecover !== null ? parseFloat(row.weeksToRecover) : null,
            recommendation: row.recommendation,
          });
        }
      }
      return { trend: trendMap };
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

      // ── EARNINGS BLOCK PRE-FLIGHT ──────────────────────────────────────────
      {
        const { TradierAPI } = await import('./tradier');
        const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const tradierAPI = new TradierAPI(tradierKey);
          const earningsResult = await checkEarningsBlock([input.symbol], tradierAPI);
          if (earningsResult.blocked.length > 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: formatEarningsBlockMessage(earningsResult) });
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

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

      // ── EARNINGS BLOCK PRE-FLIGHT ──────────────────────────────────────────
      if (!input.dryRun) {
        const { TradierAPI } = await import('./tradier');
        const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const tradierAPI = new TradierAPI(tradierKey);
          const symbols = Array.from(new Set(input.orders.map((o: any) => o.symbol)));
          const earningsResult = await checkEarningsBlock(symbols, tradierAPI);
          if (earningsResult.blocked.length > 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: formatEarningsBlockMessage(earningsResult) });
          }
          if (earningsResult.warned.length > 0) {
            console.warn('[EarningsBlock] batchSellCCs earnings warning:', earningsResult.warned);
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

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
