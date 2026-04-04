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
// Note: db, wtrHistory, and drizzle-orm are imported dynamically inside procedures to match project patterns

// ─── Dog Cross-Check Helper ───────────────────────────────────────────────────
// Returns true if an ITM CC's underlying is a LIQUIDATE or deep-MONITOR dog.
// These positions should be let expire and called away, not rolled.
function isDogPosition(
  symbol: string,
  strategy: StrategyType,
  itmDepth: number,
  dogMap: Map<string, { recommendation: string; wtr: number }>
): boolean {
  if (strategy !== 'CC') return false;
  if (itmDepth <= 0) return false; // OTM — not a dog candidate
  const dog = dogMap.get(symbol);
  if (!dog) return false;
  if (dog.recommendation === 'LIQUIDATE') return true;
  if (dog.recommendation === 'MONITOR' && dog.wtr > 30) return true;
  return false;
}

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

// ─── Urgency Scoring for Spread Positions (P&L-First) ───────────────────────
//
// PRIMARY signal: Is this position a winner or a loser right now?
//   🔴 Red   = Net LOSS on the trade (losing money), OR ITM with < 30% profit
//   🟡 Yellow = Breakeven zone (20-50% profit), OR near ATM (within 5%), OR ≤7 DTE with < 50% profit
//   🟢 Green  = Winner (>50% profit captured) — consider closing, not necessarily rolling
//
// DTE and ITM are SECONDARY signals that can escalate urgency but never create it alone.

function scoreSpreadUrgency(
  spread: SpreadPosition,
  underlyingPrice?: number
): { urgency: 'red' | 'yellow' | 'green'; reasons: string[]; score: number; unrealizedPnl: number; pnlStatus: 'winner' | 'breakeven' | 'loser' } {
  const reasons: string[] = [];

  // ── P&L Calculation ──────────────────────────────────────────────────────
  // openPremium = net credit received when opening (already × qty × 100 in spreadDetection.ts)
  // currentValue = net cost to close today (already × qty × 100)
  // unrealizedPnl > 0 = we're ahead (option decayed); < 0 = we're losing
  // NOTE: do NOT multiply by 100 again — spreadDetection already applied the multiplier
  const unrealizedPnl = spread.openPremium - spread.currentValue; // already in dollars
  const profitPct = spread.profitCaptured; // 0-100%

  // ── P&L Status ───────────────────────────────────────────────────────────
  // profitPct can now be negative (losing trade) or > 100 (debit spread that moved in our favor)
  let pnlStatus: 'winner' | 'breakeven' | 'loser';

  // STOCK-VS-STRIKE OVERRIDE: Use stock price vs. short strike as the primary signal
  // for Win/Loss classification. This is more reliable than P&L % capture alone because:
  //   - When marks are stale (yesterday's close), P&L is unreliable for OTM options
  //   - Even with live marks, a position that is clearly OTM is "winning" (on track to expire worthless)
  //   - A position that is clearly ITM is "losing" regardless of P&L % captured
  // Threshold: >2% OTM = winner, >2% ITM = loser, within 2% = use P&L % as tiebreaker
  const shortStrikeForCheck = spread.shortStrike || spread.putShortStrike || spread.callShortStrike || 0;
  let staleOverride: 'winner' | 'loser' | null = null;
  if (underlyingPrice && underlyingPrice > 0 && shortStrikeForCheck > 0) {
    if (spread.strategyType === 'BPS' || spread.strategyType === 'CSP') {
      // Put: OTM when stock > short put strike (stock is above the level we'd be assigned)
      const otmPct = ((underlyingPrice - shortStrikeForCheck) / shortStrikeForCheck) * 100;
      if (otmPct > 2) staleOverride = 'winner';   // >2% OTM → clearly winning
      else if (otmPct < -2) staleOverride = 'loser'; // >2% ITM → clearly losing
    } else if (spread.strategyType === 'BCS' || spread.strategyType === 'CC') {
      // Call: OTM when stock < short call strike (stock is below the level we'd be called away)
      const otmPct = ((shortStrikeForCheck - underlyingPrice) / shortStrikeForCheck) * 100;
      if (otmPct > 2) staleOverride = 'winner';   // >2% OTM → clearly winning
      else if (otmPct < -2) staleOverride = 'loser'; // >2% ITM → clearly losing
    } else if (spread.strategyType === 'IC') {
      // IC: OTM on both sides when stock is between put short and call short
      const putShort = spread.putShortStrike || 0;
      const callShort = spread.callShortStrike || 0;
      if (putShort > 0 && callShort > 0) {
        const abovePut = underlyingPrice > putShort * 1.02;
        const belowCall = underlyingPrice < callShort * 0.98;
        if (abovePut && belowCall) staleOverride = 'winner';
        else if (underlyingPrice < putShort * 0.98 || underlyingPrice > callShort * 1.02) staleOverride = 'loser';
      }
    }
  }

  if (staleOverride) {
    pnlStatus = staleOverride;
  } else if (profitPct >= 50) {
    pnlStatus = 'winner';
  } else if (profitPct >= 20) {
    pnlStatus = 'breakeven';
  } else {
    pnlStatus = 'loser'; // < 20% profit captured OR net loss (negative %)
  }

  // ── ITM Check (for spread short leg) ─────────────────────────────────────
  const shortLegStrike = spread.shortStrike || spread.putShortStrike || spread.callShortStrike || 0;
  let itmPct = 0;
  if (underlyingPrice && shortLegStrike > 0) {
    // For puts: ITM when underlying < strike; for calls: ITM when underlying > strike
    const isPut = spread.strategyType === 'BPS' || spread.strategyType === 'CSP';
    if (isPut) {
      itmPct = underlyingPrice < shortLegStrike
        ? ((shortLegStrike - underlyingPrice) / shortLegStrike) * 100
        : 0;
    } else {
      itmPct = underlyingPrice > shortLegStrike
        ? ((underlyingPrice - shortLegStrike) / shortLegStrike) * 100
        : 0;
    }
  }
  const isITM = itmPct > 0;
  const isNearATM = !isITM && underlyingPrice && shortLegStrike > 0
    ? Math.abs(underlyingPrice - shortLegStrike) / shortLegStrike * 100 < 5
    : false;

  // ── Urgency Rules (P&L first) ─────────────────────────────────────────────
  let urgency: 'red' | 'yellow' | 'green';

  if (pnlStatus === 'loser' || (isITM && profitPct < 30)) {
    // Losing trade or ITM with little profit captured — needs immediate attention
    urgency = 'red';
    if (pnlStatus === 'loser') {
      if (staleOverride === 'loser') {
        reasons.push(`🔴 ITM — stock has moved through the short strike (stale marks, using stock price as signal)`);
      } else if (profitPct < 0) {
        reasons.push(`🔴 Net loss — position is ${Math.abs(profitPct).toFixed(0)}% underwater (cost to close > premium received)`);
      } else {
        reasons.push(`🔴 Only ${profitPct.toFixed(0)}% of premium captured — minimal decay so far`);
      }
    }
    if (isITM) {
      reasons.push(`🔴 ${itmPct.toFixed(1)}% ITM — assignment/max-loss risk`);
    }
    if (spread.dte <= 7) {
      reasons.push(`⚠️ ${spread.dte} DTE — high gamma risk`);
    }
  } else if (pnlStatus === 'winner' && (staleOverride === 'winner' || profitPct >= 80)) {
    // High winner or stale-override winner — flag green
    urgency = 'green';
    if (staleOverride === 'winner') {
      const isPut = spread.strategyType === 'BPS' || spread.strategyType === 'CSP';
      const otmPctDisplay = underlyingPrice && shortStrikeForCheck > 0
        ? isPut
          ? ((underlyingPrice - shortStrikeForCheck) / shortStrikeForCheck * 100).toFixed(1)
          : ((shortStrikeForCheck - underlyingPrice) / shortStrikeForCheck * 100).toFixed(1)
        : '?';
      const staleSuffix = spread.hasStaleMarks ? ' (stale marks — using stock price)' : '';
      reasons.push(`✅ OTM — stock is ${otmPctDisplay}% beyond short strike${staleSuffix}`);
    } else {
      reasons.push(`✅ ${profitPct.toFixed(0)}% profit captured — consider closing or rolling for more premium`);
    }
    if (spread.dte <= 7) {
      urgency = 'yellow'; // Escalate if very close to expiry
      reasons.push(`📅 ${spread.dte} DTE — close soon to avoid pin risk`);
    }
  } else if (pnlStatus === 'winner') {
    // Winning but not at target yet — green, just monitor
    urgency = 'green';
    reasons.push(`📈 ${profitPct.toFixed(0)}% profit captured — on track`);
    if (isNearATM) {
      urgency = 'yellow';
      reasons.push(`🟡 Near ATM — monitor closely`);
    }
    if (spread.dte <= 7) {
      urgency = 'yellow';
      reasons.push(`📅 ${spread.dte} DTE — approaching expiry`);
    }
  } else {
    // Breakeven zone (20-50%) — yellow by default
    urgency = 'yellow';
    reasons.push(`🟡 ${profitPct.toFixed(0)}% profit captured — breakeven zone`);
    if (isITM) {
      urgency = 'red'; // Escalate: breakeven + ITM = urgent
      reasons.push(`🔴 ${itmPct.toFixed(1)}% ITM — at risk`);
    } else if (isNearATM) {
      reasons.push(`🟡 Near ATM — watch closely`);
    }
    if (spread.dte <= 7) {
      urgency = 'red'; // Escalate: breakeven + very low DTE = urgent
      reasons.push(`⚠️ ${spread.dte} DTE — high gamma risk in breakeven zone`);
    }
  }

  const score = urgency === 'red' ? 75 : urgency === 'yellow' ? 40 : 10;
  return { urgency, reasons, score, unrealizedPnl, pnlStatus };
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

      // Build a dog map from the latest WTR history scan for cross-checking ITM CCs.
      // If no WTR history exists yet (first scan), the map will be empty and no CCs will be tagged.
      const dogMap = new Map<string, { recommendation: string; wtr: number }>();
      try {
        const { getDb } = await import('./db');
        const { wtrHistory } = await import('../drizzle/schema');
        const { desc: descOp } = await import('drizzle-orm');
        const dbInst = await getDb();
        if (!dbInst) throw new Error('DB not available');
        const latestWtr = await dbInst
          .select()
          .from(wtrHistory)
          .orderBy(descOp(wtrHistory.scanDate))
          .limit(500);
        // Keep only the most recent entry per symbol (first occurrence after sorting by desc date)
        const seen = new Set<string>();
        for (const row of latestWtr) {
          if (!seen.has(row.symbol)) {
            seen.add(row.symbol);
            dogMap.set(row.symbol, {
              recommendation: row.recommendation,
              wtr: row.weeksToRecover ? parseFloat(row.weeksToRecover) : 0,
            });
          }
        }
      } catch (_) {
        // WTR history table may not exist yet — proceed without dog cross-check
      }

      const rawLegs: RawOptionLeg[] = [];
      const optionSymbolsToFetch = new Set<string>();
      const underlyingSymbolsToFetch = new Set<string>();
      const currentPrices: Record<string, number> = {};
      // Stash raw position data so we can apply live marks after the batch fetch
      const rawPositions: Array<{
        symbol: string;
        underlying: string;
        optionType: 'PUT' | 'CALL';
        strike: number;
        expiration: string;
        signedQty: number;
        openPrice: number;
        closePrice: number; // stale — used only as fallback
        accountNumber: string;
      }> = [];

      // First pass: collect ALL option legs (long and short) across all accounts
      for (const account of targetAccounts) {
        const positions = await api.getPositions(account.accountNumber);
        if (!positions) continue;

        for (const pos of positions) {
          // TT position data returns 'Index Option' for SPX/SPXW/NDX/NDXP/RUT/XSP/VIX etc.
          // Accept BOTH types so index spreads/CCs appear in the roll scanner.
          // NOTE: When SUBMITTING orders, always use 'Equity Option' — TT order API never accepts 'Index Option'.
          if (pos['instrument-type'] !== 'Equity Option' && pos['instrument-type'] !== 'Index Option') continue;

          const symbol = pos.symbol || '';
          const parsed = parseOptionSymbol(symbol);
          if (!parsed) continue;

          optionSymbolsToFetch.add(symbol);
          underlyingSymbolsToFetch.add(parsed.underlying);

          const rawQty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const signedQty = direction === 'short' ? -Math.abs(rawQty) : Math.abs(rawQty);
          const openPrice = parseFloat(String(pos['average-open-price'] || '0'));
          const closePrice = parseFloat(String(pos['close-price'] || '0'));

          rawPositions.push({
            symbol,
            underlying: parsed.underlying,
            optionType: parsed.optionType,
            strike: parsed.strike,
            expiration: parsed.expiration,
            signedQty,
            openPrice,
            closePrice,
            accountNumber: account.accountNumber,
          });
        }
      }

      // Batch fetch LIVE mark prices from Tastytrade for all option symbols
      // This is the critical fix: close-price is stale (previous day), mark is real-time
      const liveOptionMarks: Record<string, number> = {};
      if (optionSymbolsToFetch.size > 0) {
        try {
          const allSymbols = Array.from(optionSymbolsToFetch);
          // Tastytrade batch endpoint handles up to ~200 symbols
          const BATCH_SIZE = 100;
          for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
            const batch = allSymbols.slice(i, i + BATCH_SIZE);
            const quotes = await api.getOptionQuotesBatch(batch);
            for (const [sym, q] of Object.entries(quotes)) {
              // Prefer mark > mid > last as the best current price estimate
              const mark = (q as any).mark || (q as any).mid || (q as any).last || 0;
              if (mark > 0) liveOptionMarks[sym] = mark;
            }
          }
          console.log(`[scanRollPositions] Fetched live marks for ${Object.keys(liveOptionMarks).length}/${optionSymbolsToFetch.size} options`);
        } catch (e) {
          console.warn('[scanRollPositions] Failed to fetch live option marks, falling back to close-price:', e);
        }
      }

      // Build raw legs using live marks (fall back to close-price if live mark unavailable)
      for (const rp of rawPositions) {
        const liveMarkPrice = liveOptionMarks[rp.symbol];
        const isStale = liveMarkPrice === undefined || liveMarkPrice === 0;
        const markPrice = (!isStale ? liveMarkPrice : rp.closePrice) ?? 0;
        rawLegs.push({
          symbol: rp.symbol,
          underlying: rp.underlying,
          optionType: rp.optionType,
          strike: rp.strike,
          expiration: rp.expiration,
          quantity: rp.signedQty,
          openPrice: rp.openPrice,
          markPrice,
          accountNumber: rp.accountNumber,
          isStale,
        });
      }

      // Batch fetch underlying prices from Tradier for ITM/OTM depth calculation
      if (underlyingSymbolsToFetch.size > 0) {
        for (const sym of Array.from(underlyingSymbolsToFetch)) {
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

      // Score each spread for urgency (P&L-first)
      const scoredSpreads = spreads.map(spread => {
        const underlyingPrice = currentPrices[spread.underlying] || 0;
        const { urgency, reasons, score, unrealizedPnl, pnlStatus } = scoreSpreadUrgency(spread, underlyingPrice || undefined);

        // Build a positionId that encodes the spread for the frontend
        const positionId = spread.id;

        // For the roll candidates query, we need the short leg details
        const shortLeg = spread.legs.find(l => l.role === 'short');

        // ITM depth: positive = ITM (bad), negative = OTM (good)
        const shortStrike = shortLeg?.strike || spread.shortStrike || 0;
        const isPut = spread.strategyType === 'BPS' || spread.strategyType === 'CSP';
        let itmDepth = 0;
        if (underlyingPrice > 0 && shortStrike > 0) {
          if (isPut) {
            itmDepth = underlyingPrice < shortStrike
              ? ((shortStrike - underlyingPrice) / shortStrike) * 100
              : -((underlyingPrice - shortStrike) / shortStrike) * 100;
          } else {
            itmDepth = underlyingPrice > shortStrike
              ? ((underlyingPrice - shortStrike) / shortStrike) * 100
              : -((shortStrike - underlyingPrice) / shortStrike) * 100;
          }
        }

        // Dog cross-check: if this is an ITM CC on a LIQUIDATE/deep-MONITOR underlying,
        // tag it as LET_EXPIRE so the UI shows it in the "Let Be Called Away" section.
        const isLetExpire = isDogPosition(spread.underlying, spread.strategyType, itmDepth, dogMap);
        const dogEntry = dogMap.get(spread.underlying);
        const dogReason = isLetExpire && dogEntry
          ? `${dogEntry.recommendation} (WTR ${dogEntry.wtr.toFixed(1)} wks) — let be called away`
          : null;

        // ── Action Label ──────────────────────────────────────────────────────
        // Give every position a single, unambiguous action so the UI never shows
        // a wall of red with no clear next step.
        //
        //  LET_EXPIRE  — OTM with ≤5 DTE; just let time decay finish it
        //  CLOSE       — (a) any ITM position with ≤5 DTE, OR
        //               (b) ITM spread (BPS/BCS/IC) with time remaining.
        //               Spreads have a CAPPED loss by design — rolling at a debit only
        //               adds cost with no upside. The correct move is always to close
        //               the spread and redeploy the freed capital.
        //  ROLL        — Single-leg (CSP/CC) with DTE > 5 and not deeply ITM; credit roll viable
        //  MONITOR     — DTE > 5 AND deep ITM (>5%) on a single-leg; watch for recovery
        //  LET_CALLED  — ITM CC on a dog underlying; let stock be called away
        const isSpreadStrategy = ['BPS', 'BCS', 'IC'].includes(spread.strategyType);
        let actionLabel: 'LET_EXPIRE' | 'CLOSE' | 'ROLL' | 'MONITOR' | 'LET_CALLED' | 'STOP';
        if (isLetExpire) {
          actionLabel = 'LET_CALLED';
        } else if (spread.dte <= 5) {
          // Near expiry — no time to roll
          actionLabel = itmDepth > 0 ? 'CLOSE' : 'LET_EXPIRE';
        } else if (isSpreadStrategy && itmDepth > 0) {
          // Spread is ITM with time remaining — rolling at a debit is never beneficial
          // on a capped-loss structure. Close and redeploy capital.
          actionLabel = 'CLOSE';
        } else if (itmDepth > 5) {
          // Deep ITM single-leg with time remaining — too expensive to roll for credit
          actionLabel = 'MONITOR';
        } else {
          // Single-leg (CSP/CC) with time and not deeply ITM — credit roll is viable
          actionLabel = 'ROLL';
        }

        return {
          positionId,
          symbol: spread.underlying,
          // For spreads, use the short leg's OCC symbol as the "primary" symbol
          optionSymbol: shortLeg?.symbol || '',
          strategy: spread.strategyType,
          urgency,
          pnlStatus,
          unrealizedPnl,
          isLetExpire,
          dogReason,
          actionLabel,
          shouldRoll: !isLetExpire && (urgency === 'red' || urgency === 'yellow'),
          reasons,
          score,
          accountNumber: spread.accountNumber,
          metrics: {
            dte: spread.dte,
            profitCaptured: spread.profitCaptured,
            itmDepth,
            delta: 0,
            currentPrice: underlyingPrice,
            strikePrice: shortStrike,
            currentValue: spread.currentValue,
            openPremium: spread.openPremium,
            expiration: spread.expiration,
          },
          // Number of contracts (absolute value of short leg quantity) — needed for per-contract netCredit math in getRollCandidates
          quantity: Math.abs(shortLeg?.quantity ?? 1),
          // Spread-specific fields for the UI
          hasStaleMarks: spread.hasStaleMarks ?? false,
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
              isStale: (l as any).isStale ?? false,
            })),
          },
        };
      });

      // ── 2x STOP-LOSS FLAG ──────────────────────────────────────────────────
      // If a position's cost-to-close >= 2x the original credit received,
      // flag it for immediate closure regardless of other conditions.
      for (const pos of scoredSpreads) {
        const costToClose = Math.abs(pos.metrics.currentValue ?? 0);
        const originalCredit = Math.abs(pos.metrics.openPremium ?? 0);
        if (originalCredit > 0 && costToClose >= 2 * originalCredit) {
          (pos as any).stopLossFlag = true;
          (pos as any).stopLossRatio = +(costToClose / originalCredit).toFixed(2);
          (pos as any).actionLabel = 'STOP';
        } else {
          (pos as any).stopLossFlag = false;
          (pos as any).stopLossRatio = originalCredit > 0 ? +(costToClose / originalCredit).toFixed(2) : 0;
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      // Winners don't need to be rolled — exclude them entirely from the roll scanner.
      // A winner (green / pnlStatus === 'winner') is working as intended; leave it alone.
      // Only losers (red) and breakeven (yellow) positions are actionable for rolling.
      const nonWinners = scoredSpreads.filter(s => s.pnlStatus !== 'winner');

      // Dog cross-check: ITM CCs on LIQUIDATE/deep-MONITOR underlyings go to letExpire bucket.
      // These should be let expire and called away, not rolled.
      const letExpire = nonWinners.filter(s => s.isLetExpire);
      const actionable = nonWinners.filter(s => !s.isLetExpire);

      const red    = actionable.filter(s => s.urgency === 'red');
      const yellow = actionable.filter(s => s.urgency === 'yellow');
      const green  = actionable.filter(s => s.urgency === 'green'); // breakeven positions that scored green

      return {
        red,
        yellow,
        green,
        all: actionable,
        letExpire,
        total: actionable.length,
        letExpireCount: letExpire.length,
        accountsScanned: targetAccounts.length,
        winnersExcluded: scoredSpreads.length - nonWinners.length,
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
      quantity: z.number().optional(), // Number of contracts (absolute value); used for per-contract netCredit math
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
          quantity: input.quantity || 1, // Pass actual contract count for per-contract netCredit math
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
      // CRITICAL: Block all order submission in paper trading mode
      const { getDb: _getDb, getApiCredentials } = await import('./db');
      const _pdb = await _getDb();
      if (_pdb) {
        const { users: _u } = await import('../drizzle/schema.js');
        const { eq: _eq } = await import('drizzle-orm');
        const [_pu] = await _pdb.select().from(_u).where(_eq(_u.id, ctx.user.id)).limit(1);
        if (_pu?.tradingMode === 'paper') {
          const { TRPCError: _E } = await import('@trpc/server');
          throw new _E({ code: 'FORBIDDEN', message: 'Order submission is disabled in Paper Trading mode. Switch to Live Trading to submit orders.' });
        }
      }
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

      // ── Safeguard 2: Spread Integrity Lock ──────────────────────────────────
      // Prevent closing only one leg of a spread. For BPS/BCS/IC close actions,
      // the order MUST include spreadLegs with both short AND long legs present.
      for (const order of input.orders) {
        if (['BPS', 'BCS', 'IC'].includes(order.strategyType) && order.action === 'close') {
          const spreadLegs = order.spreadLegs || [];
          const hasShort = spreadLegs.some(l => l.role === 'short');
          const hasLong = spreadLegs.some(l => l.role === 'long');
          if (!hasShort || !hasLong) {
            throw new Error(
              `[Safeguard 2 — Spread Integrity] Cannot close only one leg of a ${order.strategyType} spread on ${order.symbol}. ` +
              `Both the short and long legs must be closed together as a unit to maintain defined risk. ` +
              `Use the Roll Positions scanner to close the full spread atomically.`
            );
          }
          if (order.strategyType === 'IC') {
            const putShort  = spreadLegs.filter(l => l.role === 'short' && l.optionType === 'PUT').length;
            const putLong   = spreadLegs.filter(l => l.role === 'long'  && l.optionType === 'PUT').length;
            const callShort = spreadLegs.filter(l => l.role === 'short' && l.optionType === 'CALL').length;
            const callLong  = spreadLegs.filter(l => l.role === 'long'  && l.optionType === 'CALL').length;
            if (putShort < 1 || putLong < 1 || callShort < 1 || callLong < 1) {
              throw new Error(
                `[Safeguard 2 — Spread Integrity] Iron Condor close on ${order.symbol} is missing legs. ` +
                `An IC requires all 4 legs to be closed together. ` +
                `Found: ${putShort} put-short, ${putLong} put-long, ${callShort} call-short, ${callLong} call-long.`
              );
            }
          }
        }
      }

      // ── EARNINGS BLOCK PRE-FLIGHT ──────────────────────────────────────────
      {
        const { TradierAPI } = await import('./tradier');
        const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const tradierAPI = new TradierAPI(tradierKey);
          const symbols = Array.from(new Set(input.orders.map((o: any) => o.symbol)));
          const earningsResult = await checkEarningsBlock(symbols, tradierAPI);
          if (earningsResult.blocked.length > 0) {
            throw new Error(formatEarningsBlockMessage(earningsResult));
          }
          if (earningsResult.warned.length > 0) {
            console.warn('[EarningsBlock] Roll orders earnings warning:', earningsResult.warned);
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

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

  /**
   * Scan ALL roll positions in parallel and return the best credit candidate
   * for each position. Positions where no credit roll exists get a close candidate.
   * Used by the "Scan All" / "CC All" / "CSP All" etc. buttons in the Roll tab.
   */
  scanAllRollCandidates: protectedProcedure
    .input(z.object({
      positions: z.array(z.object({
        positionId: z.string(),
        symbol: z.string(),
        strategy: z.enum(['csp', 'cc', 'bps', 'bcs', 'ic']),
        strikePrice: z.number(),
        expirationDate: z.string(),
        currentValue: z.number(),
        openPremium: z.number(),
        quantity: z.number().optional(),
        spreadWidth: z.number().optional(),
      })),
      dteRange: z.object({ min: z.number(), max: z.number() }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getApiCredentials } = await import('./db');
      const { TradierAPI } = await import('./tradier');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) throw new Error('Credentials not found');
      const tradierApiKey = credentials.tradierApiKey || process.env.TRADIER_API_KEY;
      if (!tradierApiKey) throw new Error('Tradier API key not configured');
      const tradier = new TradierAPI(tradierApiKey, false);

      // ── Speed optimisation ──────────────────────────────────────────────────
      // OLD: sequential batches of 6, each doing getQuote + getExpirations + N×getOptionChain
      // NEW:
      //  1. Batch-fetch all quotes in ONE call (getQuotes)
      //  2. Fetch all expirations concurrently (one call per unique symbol, all in parallel)
      //  3. Process all positions concurrently — generateRollCandidates now fetches
      //     its option chains in parallel internally (via withRateLimit)
      // ─────────────────────────────────────────────────────────────────────────

      // Step 1: Batch-fetch all underlying quotes in a single API call
      const uniqueSymbols = Array.from(new Set(input.positions.map(p => p.symbol)));
      const bulkQuotes = await tradier.getQuotes(uniqueSymbols);
      const quoteMap = new Map<string, number>();
      for (const q of bulkQuotes) {
        if (q.symbol && q.last != null) quoteMap.set(q.symbol, q.last);
      }

      // Step 2: Fetch expirations for all unique symbols concurrently
      const { withRateLimit } = await import('./tradierRateLimiter');
      const expirationResults = await Promise.allSettled(
        uniqueSymbols.map(sym =>
          withRateLimit(() => tradier.getExpirations(sym)).then(exps => ({ sym, exps }))
        )
      );
      const expirationMap = new Map<string, string[]>();
      for (const r of expirationResults) {
        if (r.status === 'fulfilled') expirationMap.set(r.value.sym, r.value.exps);
      }

      // Step 3: Process ALL positions concurrently (no batch loop — rate limiter handles throttling)
      const allResults: Array<{
        positionId: string;
        symbol: string;
        strategy: string;
        bestCandidate: any | null;
        underlyingPrice: number;
        error?: string;
      }> = await Promise.all(input.positions.map(async (pos) => {
          try {
            const underlyingPrice = quoteMap.get(pos.symbol) ?? pos.strikePrice;
            const expirations = expirationMap.get(pos.symbol) ?? [];
            const currentDTE = Math.ceil(
              (new Date(pos.expirationDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
            );
            const baseStrategy: 'csp' | 'cc' = ['bps', 'csp', 'ic'].includes(pos.strategy) ? 'csp' : 'cc';
            const mockPosition: PositionWithMetrics = {
              id: parseInt(pos.positionId) || Math.floor(Math.random() * 1000000),
              userId: ctx.user.id,
              accountId: 'mock',
              symbol: pos.symbol,
              positionType: 'option',
              strategy: baseStrategy,
              strike: pos.strikePrice.toString(),
              expiration: pos.expirationDate,
              quantity: pos.quantity || 1,
              costBasis: pos.openPremium.toString(),
              currentValue: pos.currentValue.toString(),
              unrealizedPnL: (pos.openPremium - pos.currentValue).toString(),
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
                pos.symbol,
                pos.expirationDate,
                baseStrategy === 'csp' ? 'P' : 'C',
                pos.strikePrice
              ),
              open_premium: pos.openPremium,
              current_value: pos.currentValue,
              expiration_date: pos.expirationDate,
              strike_price: pos.strikePrice,
              delta: 0,
            };
            const mockAnalysis = {
              positionId: pos.positionId,
              symbol: pos.symbol,
              optionSymbol: mockPosition.option_symbol,
              strategy: baseStrategy.toUpperCase() as 'CSP' | 'CC',
              urgency: 'yellow' as const,
              shouldRoll: true,
              reasons: [],
              metrics: {
                dte: currentDTE,
                profitCaptured: pos.openPremium > 0
                  ? ((pos.openPremium - pos.currentValue) / pos.openPremium) * 100
                  : 0,
                itmDepth: 0,
                delta: 0,
                currentPrice: underlyingPrice,
                strikePrice: pos.strikePrice,
                currentValue: pos.currentValue,
                openPremium: pos.openPremium,
                expiration: pos.expirationDate,
              },
              score: 50,
            };
            const candidates = await generateRollCandidates(
              mockPosition,
              mockAnalysis,
              expirations,
              underlyingPrice,
              tradier,
              input.dteRange
            );
            const annotated = candidates.map(c => ({
              ...c,
              spreadWidth: pos.spreadWidth,
              isSpread: ['bps', 'bcs', 'ic'].includes(pos.strategy),
              strategyType: pos.strategy.toUpperCase() as StrategyType,
            }));
            // Pick the best credit candidate (highest score among netCredit > 0 rolls)
            const creditCandidates = annotated.filter(
              c => c.action !== 'close' && typeof c.netCredit === 'number' && c.netCredit > 0
            );
            creditCandidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            const closeCandidates = annotated.filter(c => c.action === 'close');
            const bestCandidate = creditCandidates[0] ?? closeCandidates[0] ?? annotated[0] ?? null;
            return {
              positionId: pos.positionId,
              symbol: pos.symbol,
              strategy: pos.strategy,
              bestCandidate,
              underlyingPrice,
            };
          } catch (error: any) {
            return {
              positionId: pos.positionId,
              symbol: pos.symbol,
              strategy: pos.strategy,
              bestCandidate: null,
              underlyingPrice: pos.strikePrice,
              error: error.message,
            };
          }
        }));

      const creditCount = allResults.filter(r => r.bestCandidate && r.bestCandidate.action !== 'close' && (r.bestCandidate.netCredit ?? 0) > 0).length;
      const closeCount  = allResults.filter(r => r.bestCandidate && r.bestCandidate.action === 'close').length;
      const errorCount  = allResults.filter(r => !!r.error).length;
      return {
        results: allResults,
        summary: {
          total: allResults.length,
          creditRolls: creditCount,
          closeOnly: closeCount,
          errors: errorCount,
        },
      };
    }),
});
