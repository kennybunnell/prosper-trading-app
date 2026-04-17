import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getApiCredentials } from "./db";
import { writeTradingLog } from './routers-trading-log';


/**
 * Processed position with premium realization calculations
 */
interface ProcessedPosition {
  account: string;
  accountId: string;
  symbol: string;
  optionSymbol: string;
  type: 'CSP' | 'CC';
  quantity: number;
  strike: number;
  expiration: string;
  dte: number;
  premium: number;
  current: number;
  currentPrice: number; // Option's current price
  underlyingPrice?: number; // Underlying stock's current price
  realizedPercent: number;
  action: 'CLOSE' | 'WATCH' | 'HOLD';
  hasWorkingOrder: boolean;
  // Spread-specific fields
  spreadType?: 'bull_put' | 'bear_call' | 'iron_condor';
  longStrike?: number;
  longOptionSymbol?: string;  // OCC symbol of the long leg (for live quote fetching)
  spreadWidth?: number;
  capitalAtRisk?: number;
  // Iron Condor specific fields (4 legs)
  callShortStrike?: number;
  callLongStrike?: number;
  putShortStrike?: number;
  putLongStrike?: number;
  callShortOptionSymbol?: string;  // OCC symbol of call short leg
  callLongOptionSymbol?: string;   // OCC symbol of call long leg
  putShortOptionSymbol?: string;   // OCC symbol of put short leg
  putLongOptionSymbol?: string;    // OCC symbol of put long leg
}

export const performanceRouter = router({
  /**
   * Get performance overview with transaction history
   */
  getPerformanceOverview: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      monthsBack: z.number().min(1).max(24).default(12),
    }))
    .query(async ({ input, ctx }) => {
      const { accountId, monthsBack } = input;
      const userId = ctx.user.id;

      console.log(`[Performance] Fetching overview for account ${accountId}, ${monthsBack} months back (from cache)`);

      // Calculate date range (last N months)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Read from DB cache — no live API call needed
      const { getCachedTransactions, cachedTxnToWireFormat } = await import('./portfolio-sync');
      const cachedRows = await getCachedTransactions(userId);

      // Filter by account and date range, then convert to wire format
      const allTransactions: any[] = cachedRows
        .filter(txn => {
          if (accountId !== 'ALL_ACCOUNTS' && txn.accountNumber !== accountId) return false;
          if (txn.executedAt < startDate || txn.executedAt > endDate) return false;
          return true;
        })
        .map(cachedTxnToWireFormat);

      console.log(`[Performance] Loaded ${allTransactions.length} transactions from cache (${startDateStr} to ${endDateStr})`);

      if (allTransactions.length === 0) {
        return {
          monthlyData: [],
          symbolPerformance: [],
          performanceMetrics: {
            totalTrades: 0,
            closedTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            profitFactor: 0,
            bestMonth: null,
            worstMonth: null,
            totalWinAmount: 0,
            totalLossAmount: 0,
          },
          assignmentImpact: {
            totalAssignments: 0,
            avgDaysHolding: 0,
            recoveryRate: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            avgLossOnFailure: 0,
            capitalTiedUp: 0,
            assignmentDetails: [],
          },
          totals: {
            totalCredits: 0,
            totalDebits: 0,
            totalNet: 0,
            cspCredits: 0,
            cspDebits: 0,
            cspNet: 0,
            ccCredits: 0,
            ccDebits: 0,
            ccNet: 0,
            cspTrades: 0,
            ccTrades: 0,
            assignments: 0,
            calledAway: 0,
          },
          dateRange: {
            start: startDateStr,
            end: endDateStr,
            firstMonth: null,
            lastMonth: null,
            monthsWithActivity: 0,
          },
        };
      }

      // Import aggregation functions
      const { aggregateMonthlyData, aggregateBySymbol, calculatePerformanceMetrics, calculateAssignmentImpact } = await import('./lib/performance-utils');

      // Aggregate data
      const monthlyData = aggregateMonthlyData(allTransactions);
      
      // Debug logging for January 2026
      const jan2026 = monthlyData.find(m => m.monthKey === '2026-01');
      if (jan2026) {
        console.log('[Performance] January 2026 Data:', {
          monthKey: jan2026.monthKey,
          cspCredits: jan2026.cspCredits,
          ccCredits: jan2026.ccCredits,
          totalCredits: jan2026.cspCredits + jan2026.ccCredits,
          cspDebits: jan2026.cspDebits,
          ccDebits: jan2026.ccDebits,
          totalDebits: jan2026.cspDebits + jan2026.ccDebits,
          totalNet: jan2026.totalNet,
          cspTrades: jan2026.cspTrades,
          ccTrades: jan2026.ccTrades,
        });
        
        // Count January transactions
        const jan2026Txns = allTransactions.filter(t => {
          const executedAt = t['executed-at'] || '';
          return executedAt.startsWith('2026-01');
        });
        console.log(`[Performance] January 2026 has ${jan2026Txns.length} transactions`);
        
        // Log first few January transactions for debugging
        console.log('[Performance] Sample January 2026 transactions:', jan2026Txns.slice(0, 5).map(t => ({
          type: t['transaction-type'],
          action: t.action,
          symbol: t.symbol,
          value: t.value,
          executedAt: t['executed-at'],
        })));
      } else {
        console.log('[Performance] WARNING: No January 2026 data found in monthlyData');
      }
      
      const symbolPerformance = aggregateBySymbol(allTransactions);
      const performanceMetrics = calculatePerformanceMetrics(allTransactions, monthlyData);
      const assignmentImpact = calculateAssignmentImpact(allTransactions);

      // Calculate totals
      const totals = {
        totalCredits: monthlyData.reduce((sum, m) => sum + m.cspCredits + m.ccCredits, 0),
        totalDebits: monthlyData.reduce((sum, m) => sum + m.cspDebits + m.ccDebits, 0),
        totalNet: monthlyData.reduce((sum, m) => sum + m.totalNet, 0),
        cspCredits: monthlyData.reduce((sum, m) => sum + m.cspCredits, 0),
        cspDebits: monthlyData.reduce((sum, m) => sum + m.cspDebits, 0),
        cspNet: monthlyData.reduce((sum, m) => sum + m.cspNet, 0),
        ccCredits: monthlyData.reduce((sum, m) => sum + m.ccCredits, 0),
        ccDebits: monthlyData.reduce((sum, m) => sum + m.ccDebits, 0),
        ccNet: monthlyData.reduce((sum, m) => sum + m.ccNet, 0),
        cspTrades: monthlyData.reduce((sum, m) => sum + m.cspTrades, 0),
        ccTrades: monthlyData.reduce((sum, m) => sum + m.ccTrades, 0),
        assignments: monthlyData.reduce((sum, m) => sum + m.assignments, 0),
        calledAway: monthlyData.reduce((sum, m) => sum + m.calledAway, 0),
      };

      // Date range info
      const dateRange = {
        start: startDateStr,
        end: endDateStr,
        firstMonth: monthlyData.length > 0 ? monthlyData[0].monthName : null,
        lastMonth: monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].monthName : null,
        monthsWithActivity: monthlyData.length,
      };

      console.log(`[Performance] Aggregated ${monthlyData.length} months, ${symbolPerformance.length} symbols`);

      return {
        monthlyData,
        symbolPerformance,
        performanceMetrics,
        assignmentImpact,
        totals,
        dateRange,
      };
    }),

  /**
   * Fetch active short option positions (CSPs and CCs) with premium realization
   */
  getActivePositions: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      positionType: z.enum(['csp', 'cc']).optional(), // Filter by position type
      minRealizedPercent: z.number().optional(), // Filter by minimum realized %
    }))
    .query(async ({ input, ctx }) => {
      const { accountId, positionType, minRealizedPercent } = input;

      // Get Tastytrade credentials (still needed for live quotes and working orders)
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade credentials not configured. Please add them in Settings.',
        });
      }

      // Initialize Tastytrade API (used for live quotes + working orders only)
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // ── Positions: fetch LIVE from Tastytrade (no DB cache) ──────────────────────
      const { getLivePositions } = await import('./portfolio-sync');
      const livePos = await getLivePositions(ctx.user.id, accountId === 'ALL_ACCOUNTS' ? undefined : accountId);

      if (livePos.length === 0) {
        return {
          positions: [],
          summary: { openPositions: 0, totalPremiumAtRisk: 0, avgRealizedPercent: 0, readyToClose: 0 },
        };
      }

      // Determine which accounts to use
      const accountsToFetch = accountId === 'ALL_ACCOUNTS'
        ? Array.from(new Set(livePos.map((p: any) => p['account-number'] || p['account-number'])))
        : [accountId];

      // Filter by account and add multiplier
      const positions: any[] = livePos
        .filter((p: any) => accountId === 'ALL_ACCOUNTS' || (p['account-number'] || p['account-number']) === accountId)
        .map((p: any) => ({
          ...p,
          _accountNumber: p['account-number'] || p['account-number'],
          multiplier: 100,
        }));

      console.log(`[Performance] Loaded ${positions.length} LIVE positions from Tastytrade`);

      // Filter for option positions (both short and long)
      const optionPositions = positions.filter((pos) =>
        pos['instrument-type'] === 'Equity Option' || pos['instrument-type'] === 'Index Option'
      );
      const shortOptions = optionPositions.filter(pos => pos['quantity-direction'] === 'Short');
      const longOptions = optionPositions.filter(pos => pos['quantity-direction'] === 'Long');
      console.log(`[Performance] ${shortOptions.length} short, ${longOptions.length} long options from cache`);

      try {
        // ── Order-ID spread linkage: still live (filled orders not cached) ────────
        const perfSymbolToOrderId = new Map<string, string>();
        const perfOrderIdToLongSym = new Map<string, string>();
        const perfConsumedLongSyms = new Set<string>();
        for (const accNum of accountsToFetch) {
          try {
            const filledOrders = await api.getFilledOrders(accNum);
            for (const order of filledOrders) {
              const orderId = String(order.id || '');
              if (!orderId) continue;
              const legs: any[] = order.legs || [];
              if (legs.length < 2) continue;
              for (const leg of legs) {
                const sym = (leg.symbol || '').replace(/\s+/g, '');
                if (sym) perfSymbolToOrderId.set(sym, orderId);
                const action = (leg.action || '').toLowerCase();
                if (action.includes('buy') && action.includes('open')) {
                  perfOrderIdToLongSym.set(orderId, sym);
                }
              }
            }
          } catch (e: any) {
            console.warn(`[Performance] Could not fetch filled orders for ${accNum}: ${e.message}`);
          }
        }
        console.log(`[Performance] Order-ID linkage: ${perfSymbolToOrderId.size} symbols mapped`);

        // Build a map of long positions by normalised OCC symbol
        const longPositionMap = new Map<string, any>();
        for (const longPos of longOptions) {
          const normSym = (longPos.symbol || '').replace(/\s+/g, '');
          longPositionMap.set(normSym, longPos);
        }

        // ── Working orders: still live (order status changes in real time) ────────
        const workingOrderSymbols = new Set<string>();
        for (const accNum of accountsToFetch) {
          try {
            const workingOrders = await api.getWorkingOrders(accNum);
            for (const order of workingOrders) {
              if (order.status === 'Live' && order.legs) {
                for (const leg of order.legs) {
                  if (leg.symbol) workingOrderSymbols.add(leg.symbol);
                }
              }
            }
          } catch (error) {
            console.warn(`[Performance] Failed to fetch working orders for ${accNum}:`, error);
          }
        }
        console.log(`[Performance] Found ${workingOrderSymbols.size} symbols with working orders`);

        // Collect all option symbols for batch quote fetching
        const allOptionSymbols = new Set<string>();
        for (const pos of shortOptions) {
          allOptionSymbols.add(pos.symbol);
        }
        for (const pos of longOptions) {
          allOptionSymbols.add(pos.symbol);
        }
        
        // Fetch current quotes for all options via Tastytrade /market-data/by-type.
        // This endpoint supports both equity options (equity-option param) and index options
        // (index-option param for SPXW, NDX, XSP, RUT, etc.) — the correct param type is
        // applied automatically inside getOptionQuotesBatch.
        console.log(`[Performance] Fetching quotes for ${allOptionSymbols.size} option symbols via Tastytrade`);
        const quotes: Record<string, { bid: number; ask: number; mid: number; mark: number; last: number }> = {};
        try {
          const rawQuotes = await api.getOptionQuotesBatch(Array.from(allOptionSymbols));
          for (const [sym, q] of Object.entries(rawQuotes)) {
            const mid = q.mid || ((q.bid + q.ask) / 2);
            quotes[sym] = { bid: q.bid, ask: q.ask, mid, mark: q.mark || mid, last: q.last };
          }
          console.log(`[Performance] Tastytrade quotes fetched: ${Object.keys(quotes).length} symbols`);
        } catch (quoteErr: any) {
          console.warn('[Performance] Tastytrade quote fetch failed, falling back to close-price:', quoteErr.message);
        }
        
        // Collect unique underlying symbols for stock price fetching
        const underlyingSymbols = new Set<string>();
        for (const pos of shortOptions) {
          underlyingSymbols.add(pos['underlying-symbol']);
        }
        
        // Fetch underlying stock prices in batch
        console.log(`[Performance] Fetching underlying prices for ${underlyingSymbols.size} symbols`);
        const underlyingPrices = await api.getUnderlyingQuotesBatch(Array.from(underlyingSymbols));
        console.log(`[Performance] Retrieved ${Object.keys(underlyingPrices).length} underlying prices`);

        // Process each position
        let processedPositions: ProcessedPosition[] = [];
        
        for (const pos of shortOptions) {
          // Determine if CSP or CC using OCC regex (avoids false positives from underlying names like SPY, PLTR)
          const occTypeMatch = pos.symbol.match(/([CP])(\d{8})$/);
          const isPut = occTypeMatch ? occTypeMatch[1] === 'P' : pos.symbol.includes('P');
          const optionType = isPut ? 'CSP' : 'CC';

          // Calculate premium received (short leg only — adjusted for spreads after spread detection)
          const quantity = Math.abs(pos.quantity);
          const shortOpenPrice = Math.abs(parseFloat(pos['average-open-price']));
          let premiumReceived = shortOpenPrice * quantity * pos.multiplier;

          // Get current price from live quote (fallback to close-price if quote unavailable)
          const quote = quotes[pos.symbol];
          const currentPrice = quote ? quote.mark || quote.mid || quote.last : parseFloat(pos['close-price']);
          let currentCost = currentPrice * quantity * pos.multiplier;

          // Parse strike from option symbol (e.g., "AAPL250117P00150000" -> 150)
          const strikeMatch = pos.symbol.match(/[CP](\d+)/);
          const strike = strikeMatch ? parseFloat(strikeMatch[1]) / 1000 : 0;

          // Calculate DTE
          const expirationDate = pos['expires-at'] ? new Date(pos['expires-at']) : new Date();
          const today = new Date();
          const dte = Math.max(0, Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

          // Check for matching long position (spread detection)
          let spreadType: 'bull_put' | 'bear_call' | 'iron_condor' | undefined;
          let longStrike: number | undefined;
          let spreadWidth: number | undefined;
          let capitalAtRisk: number | undefined;
          let longOptionSymbol: string | undefined;
          // ── Spread detection: Order-ID-first, then heuristic fallback ────────────
          // Helper to apply spread metrics once a long leg is found
          const applySpreadMatch = (longPos: any): boolean => {
            longOptionSymbol = longPos.symbol;
            const longStrikeMatch = longPos.symbol.match(/[CP](\d+)/);
            const longStrikeValue = longStrikeMatch ? parseFloat(longStrikeMatch[1]) / 1000 : 0;
            const longOpenPrice = Math.abs(parseFloat(longPos['average-open-price']));
            const longOpenCost = longOpenPrice * quantity * longPos.multiplier;
            if (isPut && longStrikeValue < strike) {
              spreadType = 'bull_put';
              longStrike = longStrikeValue;
              spreadWidth = strike - longStrikeValue;
              premiumReceived = (shortOpenPrice * quantity * pos.multiplier) - longOpenCost;
              capitalAtRisk = (spreadWidth * pos.multiplier * quantity) - premiumReceived;
              const longQuote = quotes[longPos.symbol];
              const longCurrentPrice = longQuote ? longQuote.mark || longQuote.mid || longQuote.last : parseFloat(longPos['close-price']);
              currentCost = (currentPrice * quantity * pos.multiplier) - (longCurrentPrice * quantity * longPos.multiplier);
              console.log(`[Performance] BPS: ${pos['underlying-symbol']} ${strike}/${longStrike} (${spreadWidth}pt, netCredit=$${premiumReceived.toFixed(2)}, capitalAtRisk=$${capitalAtRisk?.toFixed(2)}, netCurrentCost=$${currentCost.toFixed(2)})`);
              return true;
            } else if (!isPut && longStrikeValue > strike) {
              spreadType = 'bear_call';
              longStrike = longStrikeValue;
              spreadWidth = longStrikeValue - strike;
              premiumReceived = (shortOpenPrice * quantity * pos.multiplier) - longOpenCost;
              capitalAtRisk = (spreadWidth * pos.multiplier * quantity) - premiumReceived;
              const longQuote = quotes[longPos.symbol];
              const longCurrentPrice = longQuote ? longQuote.mark || longQuote.mid || longQuote.last : parseFloat(longPos['close-price']);
              currentCost = (currentPrice * quantity * pos.multiplier) - (longCurrentPrice * quantity * longPos.multiplier);
              console.log(`[Performance] BCS: ${pos['underlying-symbol']} ${strike}/${longStrike} (${spreadWidth}pt, netCredit=$${premiumReceived.toFixed(2)}, capitalAtRisk=$${capitalAtRisk?.toFixed(2)}, netCurrentCost=$${currentCost.toFixed(2)})`);
              return true;
            } else {
              // Reset if no match
              longOptionSymbol = undefined;
            }
            return false;
          };

          const normShortSym = (pos.symbol || '').replace(/\s+/g, '');
          let spreadMatched = false;

          // Pass 1: Order-ID-based matching (authoritative)
          const shortOrderId = perfSymbolToOrderId.get(normShortSym);
          if (shortOrderId) {
            const linkedLongSym = perfOrderIdToLongSym.get(shortOrderId);
            if (linkedLongSym && linkedLongSym !== normShortSym && !perfConsumedLongSyms.has(linkedLongSym)) {
              const longPos = longPositionMap.get(linkedLongSym);
              if (longPos && applySpreadMatch(longPos)) {
                perfConsumedLongSyms.add(linkedLongSym);
                spreadMatched = true;
                console.log(`[Performance] Order-ID match: ${normShortSym} → order ${shortOrderId} → long ${linkedLongSym}`);
              }
            }
          }

          // Pass 2: Heuristic fallback (for legacy/manual positions)
          if (!spreadMatched) {
            for (const [normLongSym, longPos] of Array.from(longPositionMap.entries())) {
              if (perfConsumedLongSyms.has(normLongSym)) continue;
              if (normLongSym === normShortSym) continue;
              if (longPos['underlying-symbol'] === pos['underlying-symbol'] &&
                  longPos['expires-at'] === pos['expires-at']) {
                const longOccMatch = longPos.symbol.match(/([CP])(\d{8})$/);
                const longIsPut = longOccMatch ? longOccMatch[1] === 'P' : longPos.symbol.includes('P');
                if (longIsPut === isPut) {
                  if (applySpreadMatch(longPos)) {
                    perfConsumedLongSyms.add(normLongSym);
                    console.log(`[Performance] Heuristic match (fallback): ${normShortSym} → long ${normLongSym}`);
                    break;
                  }
                }
              }
            }
          }

          // Calculate realizedPercent AFTER spread detection (premiumReceived and currentCost may have been updated)
          // For BPS/BCS: premiumReceived = net credit, currentCost = net close cost
          // Cap at 100% (long leg can exceed short leg value making currentCost negative)
          const realizedPercent = premiumReceived > 0
            ? Math.min(100, ((premiumReceived - Math.max(0, currentCost)) / premiumReceived) * 100)
            : 0;

          // Skip if below minimum realized percent filter
          if (minRealizedPercent !== undefined && realizedPercent < minRealizedPercent) {
            continue;
          }

          // Determine action recommendation
          let action: 'CLOSE' | 'WATCH' | 'HOLD' = 'HOLD';
          if (realizedPercent >= 80) {
            action = 'CLOSE';
          } else if (realizedPercent >= 50 || dte <= 7) {
            action = 'WATCH';
          }

          // Check if this position has a working order
          const hasWorkingOrder = workingOrderSymbols.has(pos.symbol);

          processedPositions.push({
            account: pos._accountNumber || 'Unknown',
            accountId: pos['account-number'],
            symbol: pos['underlying-symbol'],
            optionSymbol: pos.symbol,
            type: optionType,
            quantity,
            strike,
            expiration: pos['expires-at'] ? new Date(pos['expires-at']).toLocaleDateString() : 'N/A',
            dte,
            premium: premiumReceived,
            current: currentCost,
            // Use live Tastytrade quote for currentPrice (feeds into order modal slider initial position)
            // Fall back to close-price only if Tastytrade quote is unavailable
            currentPrice: quote ? (quote.mark || quote.mid || quote.last) : parseFloat(pos['close-price']),
            underlyingPrice: underlyingPrices[pos['underlying-symbol']],
            realizedPercent: Math.round(realizedPercent * 100) / 100, // Round to 2 decimals
            action,
            hasWorkingOrder,
            // Spread fields (only populated if spread detected)
            spreadType,
            longStrike,
            longOptionSymbol,
            spreadWidth,
            capitalAtRisk,
          });
        }

        // PHASE 2: Detect Iron Condors (4-leg spreads)
        // Look for pairs of Bull Put + Bear Call spreads on same underlying + expiration
        console.log('[Performance] Phase 2: Detecting Iron Condors from spread pairs...');
        
        const spreadsByKey = new Map<string, ProcessedPosition[]>();
        let allSpreadPositions = processedPositions.filter(pos => pos.spreadType);
        
        // Group spreads by underlying + expiration
        for (const spread of allSpreadPositions) {
          const key = `${spread.symbol}_${spread.expiration}`;
          if (!spreadsByKey.has(key)) {
            spreadsByKey.set(key, []);
          }
          spreadsByKey.get(key)!.push(spread);
        }
        
        // Find Iron Condors (groups with both bull_put and bear_call)
        const ironCondorPositions: ProcessedPosition[] = [];
        const positionsToRemove = new Set<ProcessedPosition>();
        
        for (const [key, spreads] of Array.from(spreadsByKey.entries())) {
          const bullPutSpreads = spreads.filter(s => s.spreadType === 'bull_put');
          const bearCallSpreads = spreads.filter(s => s.spreadType === 'bear_call');
          
          // Match bull put with bear call to form Iron Condor
          for (const bullPut of bullPutSpreads) {
            for (const bearCall of bearCallSpreads) {
              // Check if they have the same quantity (must be same size)
              if (bullPut.quantity === bearCall.quantity) {
                // Create Iron Condor position
                const ironCondor: ProcessedPosition = {
                  ...bullPut, // Use bull put as base
                  spreadType: 'iron_condor',
                  // Store all 4 strikes for display
                  putShortStrike: bullPut.strike,
                  putLongStrike: bullPut.longStrike,
                  callShortStrike: bearCall.strike,
                  callLongStrike: bearCall.longStrike,
                  // Store all 4 OCC symbols for live quote fetching
                  putShortOptionSymbol: bullPut.optionSymbol,
                  putLongOptionSymbol: bullPut.longOptionSymbol,
                  callShortOptionSymbol: bearCall.optionSymbol,
                  callLongOptionSymbol: bearCall.longOptionSymbol,
                  // Combined premium and current value
                  premium: bullPut.premium + bearCall.premium,
                  current: bullPut.current + bearCall.current,
                  capitalAtRisk: (bullPut.capitalAtRisk || 0) + (bearCall.capitalAtRisk || 0),
                };
                
                // Recalculate realized percent for combined position
                ironCondor.realizedPercent = ironCondor.premium > 0
                  ? ((ironCondor.premium - ironCondor.current) / ironCondor.premium) * 100
                  : 0;
                
                ironCondorPositions.push(ironCondor);
                positionsToRemove.add(bullPut);
                positionsToRemove.add(bearCall);
                
                console.log(`[Performance] Detected Iron Condor: ${ironCondor.symbol} (${bullPut.strike}/${bullPut.longStrike} put, ${bearCall.strike}/${bearCall.longStrike} call)`);
                
                // Only match each spread once
                break;
              }
            }
          }
        }
        
        // Remove the individual spreads that were combined into Iron Condors
        let updatedPositions = processedPositions.filter(pos => !positionsToRemove.has(pos));
        
        // Add the Iron Condor positions
        updatedPositions.push(...ironCondorPositions);
        processedPositions = updatedPositions;
        
        console.log(`[Performance] Found ${ironCondorPositions.length} Iron Condors, removed ${positionsToRemove.size} individual spreads`);

        // Calculate summary statistics
        const openPositions = processedPositions.length;
        
        // Separate spreads from single-leg positions
        const spreadPositions = processedPositions.filter(pos => pos.spreadType);
        const singleLegPositions = processedPositions.filter(pos => !pos.spreadType);
        
        const spreadCount = spreadPositions.length;
        const singleLegCount = singleLegPositions.length;
        
        const totalSpreadPremium = spreadPositions.reduce((sum, pos) => sum + pos.premium, 0);
        const totalSingleLegPremium = singleLegPositions.reduce((sum, pos) => sum + pos.premium, 0);
        const totalPremiumAtRisk = totalSpreadPremium + totalSingleLegPremium;
        
        // Calculate capital at risk
        // For spreads: use capitalAtRisk (spread width - net credit)
        // For single-leg: use premium (since premium = capital for CSP/CC)
        const totalSpreadCapital = spreadPositions.reduce((sum, pos) => sum + (pos.capitalAtRisk || 0), 0);
        const totalSingleLegCapital = totalSingleLegPremium; // For CSP/CC, capital = premium
        const totalCapitalAtRisk = totalSpreadCapital + totalSingleLegCapital;
        
        // Calculate capital efficiency (premium / capital * 100)
        const spreadCapitalEfficiency = totalSpreadCapital > 0
          ? (totalSpreadPremium / totalSpreadCapital) * 100
          : 0;
        const singleLegCapitalEfficiency = totalSingleLegCapital > 0
          ? (totalSingleLegPremium / totalSingleLegCapital) * 100
          : 0;
        const overallCapitalEfficiency = totalCapitalAtRisk > 0
          ? (totalPremiumAtRisk / totalCapitalAtRisk) * 100
          : 0;
        
        const avgRealizedPercent = openPositions > 0
          ? processedPositions.reduce((sum, pos) => sum + pos.realizedPercent, 0) / openPositions
          : 0;
        const readyToClose = processedPositions.filter(pos => pos.action === 'CLOSE' && !pos.hasWorkingOrder).length;

        console.log(`[Performance] Processed ${processedPositions.length} positions (${spreadCount} spreads, ${singleLegCount} single-leg), ${readyToClose} ready to close`);
        console.log(`[Performance] Capital efficiency: Overall ${overallCapitalEfficiency.toFixed(1)}% (Spreads: ${spreadCapitalEfficiency.toFixed(1)}%, Single-leg: ${singleLegCapitalEfficiency.toFixed(1)}%)`);
        console.log(`[Performance] Total capital at risk: $${totalCapitalAtRisk.toFixed(2)} (Spreads: $${totalSpreadCapital.toFixed(2)}, Single-leg: $${totalSingleLegCapital.toFixed(2)})`)

        // Apply optional filters
        let filteredPositions = processedPositions;
        if (positionType) {
          const typeFilter = positionType.toUpperCase();
          filteredPositions = filteredPositions.filter(pos => pos.type === typeFilter);
        }
        if (minRealizedPercent !== undefined) {
          filteredPositions = filteredPositions.filter(pos => pos.realizedPercent >= minRealizedPercent);
        }

        return {
          positions: filteredPositions,
          summary: {
            openPositions,
            totalPremiumAtRisk,
            avgRealizedPercent: Math.round(avgRealizedPercent * 100) / 100,
            readyToClose,
            // Spread breakdown
            spreadCount,
            singleLegCount,
            totalSpreadPremium,
            totalSingleLegPremium,
            // Capital efficiency
            totalCapitalAtRisk,
            overallCapitalEfficiency: Math.round(overallCapitalEfficiency * 10) / 10,
            spreadCapitalEfficiency: Math.round(spreadCapitalEfficiency * 10) / 10,
            singleLegCapitalEfficiency: Math.round(singleLegCapitalEfficiency * 10) / 10,
          },
        };
      } catch (error: any) {
        console.error('[Performance] Error fetching positions:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch positions: ${error.message}`,
        });
      }
    }),

  /**
   * AI: Analyze open positions — proactive summary card
   * Flags at-risk positions (delta breach, near profit target, expiring soon)
   */
  analyzePositions: protectedProcedure
    .input(
      z.object({
        positions: z.array(
          z.object({
            symbol: z.string(),
            type: z.string(),
            strike: z.number(),
            expiration: z.string(),
            dte: z.number(),
            premium: z.number(),
            current: z.number(),
            realizedPercent: z.number(),
            action: z.string().optional(),
            spreadType: z.string().optional().nullable(),
          })
        ),
        summary: z.object({
          openPositions: z.number(),
          totalPremiumAtRisk: z.number(),
          avgRealizedPercent: z.number(),
          readyToClose: z.number(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');
      const { positions, summary } = input;

      // Build a concise position summary for the AI
      const positionLines = positions.slice(0, 30).map(p => {
        const pct = p.realizedPercent.toFixed(0);
        return `${p.symbol} ${p.type} $${p.strike} exp ${p.expiration} (${p.dte}d) — ${pct}% realized, action: ${p.action || 'hold'}${p.spreadType ? ` [${p.spreadType}]` : ''}`;
      }).join('\n');

      const messages = [
        {
          role: 'system' as const,
          content: `You are a professional options trading advisor specializing in covered calls, cash-secured puts, and spreads. Analyze the portfolio and provide a concise, actionable daily briefing. Be direct and specific. Use \u26a0\ufe0f for warnings, \u2705 for good news, \ud83d\udd34 for urgent items. Keep total response under 300 words.`,
        },
        {
          role: 'user' as const,
          content: `Portfolio Summary:\n- ${summary.openPositions} open positions\n- $${summary.totalPremiumAtRisk.toLocaleString()} total premium at risk\n- ${summary.avgRealizedPercent.toFixed(1)}% avg premium realized\n- ${summary.readyToClose} positions ready to close\n\nPositions:\n${positionLines}\n\nProvide:\n1. A 1-sentence overall portfolio health assessment\n2. Top 3 urgent items requiring action today (delta breach, expiring soon, profit target reached)\n3. Top 2 opportunities (positions near 80%+ profit that could be closed)\n4. One strategic observation about the portfolio`,
        },
      ];

      const response = await invokeLLM({ messages });
      return { analysis: response.choices[0].message.content || 'Analysis unavailable.' };
    }),

  /**
   * AI: Analyze performance history — patterns and insights
   */
  analyzePerformance: protectedProcedure
    .input(
      z.object({
        overview: z.object({
          totalPremiumCollected: z.number(),
          totalPremiumRealized: z.number(),
          winRate: z.number(),
          totalTrades: z.number(),
          avgDTE: z.number().optional(),
        }),
        topSymbols: z.array(z.object({
          symbol: z.string(),
          trades: z.number(),
          premium: z.number(),
          winRate: z.number().optional(),
        })).optional(),
        monthlyData: z.array(z.object({
          month: z.string(),
          premium: z.number(),
          trades: z.number(),
        })).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');
      const { overview, topSymbols, monthlyData } = input;

      const symbolLines = (topSymbols || []).slice(0, 10).map(s =>
        `${s.symbol}: ${s.trades} trades, $${s.premium.toLocaleString()} premium${s.winRate !== undefined ? `, ${s.winRate.toFixed(0)}% win rate` : ''}`
      ).join('\n');

      const monthLines = (monthlyData || []).slice(-6).map(m =>
        `${m.month}: $${m.premium.toLocaleString()} (${m.trades} trades)`
      ).join('\n');

      const messages = [
        {
          role: 'system' as const,
          content: `You are a professional options trading performance analyst. Analyze trading history and identify actionable patterns, strengths, and areas for improvement. Be specific with numbers. Use \u2705 for strengths, \u26a0\ufe0f for areas to improve, \ud83d\udca1 for insights. Keep total response under 400 words.`,
        },
        {
          role: 'user' as const,
          content: `Performance Overview:\n- Total premium collected: $${overview.totalPremiumCollected.toLocaleString()}\n- Total premium realized: $${overview.totalPremiumRealized.toLocaleString()}\n- Win rate: ${overview.winRate.toFixed(1)}%\n- Total trades: ${overview.totalTrades}${overview.avgDTE ? `\n- Avg DTE at entry: ${overview.avgDTE.toFixed(0)} days` : ''}\n\nTop Symbols:\n${symbolLines || 'No data'}\n\nMonthly Trend (last 6 months):\n${monthLines || 'No data'}\n\nProvide:\n1. Overall performance assessment (2-3 sentences)\n2. Top 3 strengths in this trading approach\n3. Top 3 areas for improvement with specific recommendations\n4. Best-performing symbols and why they work well\n5. Monthly trend analysis — is performance improving or declining?\n6. One specific strategic recommendation to increase premium income`,
        },
      ];

      const response = await invokeLLM({ messages });
      return { analysis: response.choices[0].message.content || 'Analysis unavailable.' };
    }),

  /**
   * Close selected positions (buy-to-close)
   */
  closePositions: protectedProcedure
    .input(z.object({
      positions: z.array(z.object({
        accountId: z.string(),
        optionSymbol: z.string(),
        underlying: z.string(),
        quantity: z.number(),
        strike: z.number(),
        currentPrice: z.number(),
        // Spread-specific fields
        spreadType: z.enum(['bull_put', 'bear_call', 'iron_condor']).optional(),
        longStrike: z.number().optional(),
        spreadWidth: z.number().optional(),
      })),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const { positions, dryRun } = input;

      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade credentials not configured. Please add them in Settings.',
        });
      }

      // Initialize Tastytrade API
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      console.log(`[Performance] ${dryRun ? 'Dry run' : 'Submitting'} close orders for ${positions.length} position(s)`);

      // Get unique account IDs from positions
      const accountIds = Array.from(new Set(positions.map(p => p.accountId)));
      
      // Fetch working orders for all accounts and build a set of symbols
      const workingOrderSymbols = new Set<string>();
      for (const accountId of accountIds) {
        try {
          const workingOrders = await api.getWorkingOrders(accountId);
          for (const order of workingOrders) {
            // Extract symbols from order legs
            if (order.legs) {
              for (const leg of order.legs) {
                if (leg.symbol) {
                  workingOrderSymbols.add(leg.symbol);
                }
              }
            }
          }
        } catch (error) {
          console.warn(`[Performance] Failed to fetch working orders for ${accountId}:`, error);
        }
      }

      // Filter out positions that already have working orders
      const excludedPositions: typeof positions = [];
      const validPositions = positions.filter(pos => {
        if (workingOrderSymbols.has(pos.optionSymbol)) {
          excludedPositions.push(pos);
          console.log(`[Performance] Excluding ${pos.underlying} $${pos.strike} - already has working order`);
          return false;
        }
        return true;
      });

      if (excludedPositions.length > 0) {
        console.log(`[Performance] Excluded ${excludedPositions.length} position(s) with existing working orders`);
      }

      // ── Server-side quantity guard ────────────────────────────────────────────
      // Fetch live positions from Tastytrade and cap every close quantity to what
      // is actually held.  This prevents the "You cannot close more than X"
      // rejection that occurs when our stored quantity diverges from reality.
      const liveHeldQtyMap = new Map<string, number>();
      for (const accountId of accountIds) {
        try {
          const livePositions = await api.getPositions(accountId);
          for (const lp of livePositions) {
            const normSym = (lp.symbol || '').replace(/\s+/g, '');
            const qty = Math.abs(Number(lp.quantity) || 0);
            liveHeldQtyMap.set(normSym, (liveHeldQtyMap.get(normSym) || 0) + qty);
          }
        } catch (e: any) {
          console.warn(`[Performance] Could not fetch live positions for ${accountId} (quantity guard skipped):`, e.message);
        }
      }
      console.log(`[Performance] Live position map built: ${liveHeldQtyMap.size} symbols`);

      // Submit orders for each valid position
      const results = [];
      for (let pos of validPositions) {
        // ── Quantity cap: never close more than Tastytrade says we hold ──────────
        const normPosSymbol = (pos.optionSymbol || '').replace(/\s+/g, '');
        const liveQty = liveHeldQtyMap.get(normPosSymbol);
        if (liveQty !== undefined && pos.quantity > liveQty) {
          console.warn(
            `[Performance] Quantity cap applied for ${pos.underlying} $${pos.strike}: ` +
            `requested=${pos.quantity} but live position=${liveQty}. Capping to ${liveQty}.`
          );
          pos = { ...pos, quantity: liveQty };
        }
        if (pos.quantity <= 0) {
          console.warn(`[Performance] Skipping ${pos.underlying} $${pos.strike} — live position is 0 (already closed?).`);
          results.push({
            success: false,
            message: `Position for ${pos.underlying} $${pos.strike} appears to be already closed (0 contracts held).`,
            underlying: pos.underlying,
            strike: pos.strike,
            quantity: 0,
          });
          continue;
        }
        console.log(`[Performance] Processing ${pos.underlying} $${pos.strike} (${pos.quantity} contracts)`);
        
        // Check if this is a spread position
        if (pos.spreadType && pos.longStrike) {
          // Spread position - need to close both legs
          console.log(`[Performance] Detected ${pos.spreadType} spread: ${pos.strike}/${pos.longStrike}`);

          // Hoist price-effect outside try so it's accessible in catch for logging
          const spreadPriceEffect: 'Credit' | 'Debit' = pos.longStrike > pos.strike ? 'Credit' : 'Debit';

          try {
            // Import price formatting utility
            const { formatPriceForSubmission, snapToTick } = await import('../shared/orderUtils');
            
            // IMPORTANT: Tastytrade order submission API requires 'Equity Option' for ALL option legs
            // in ALL multi-leg spread orders, including cash-settled index options (SPX, SPXW, NDX, RUT, etc.).
            // Using 'Index Option' in spread legs causes validation_error: "does not have a valid value".
            // This was confirmed via live rejection on 2026-03-20 for an SPX BCS order.
            // 'Index Option' is only valid for SINGLE-LEG orders (new STOs on index options).
            const instrumentType: 'Equity Option' = 'Equity Option';

            // Construct option symbols for both legs
            // Parse the short leg symbol to extract components
            const shortSymbol = pos.optionSymbol;
            const match = shortSymbol.match(/^([A-Z\s]+)(\d{6})([CP])(\d+)$/);
            
            if (!match) {
              throw new Error(`Invalid option symbol format: ${shortSymbol}`);
            }
            
            const ticker = match[1].trim();
            const dateStr = match[2];
            const optionType = match[3];
            const shortStrikeStr = match[4];
            
            // Build long leg symbol with same format
            const longStrikeStr = (pos.longStrike * 1000).toString().padStart(8, '0');
            const longSymbol = `${ticker.padEnd(6, ' ')}${dateStr}${optionType}${longStrikeStr}`;
            const formattedShortSymbol = `${ticker.padEnd(6, ' ')}${dateStr}${optionType}${shortStrikeStr}`;
            
            // ── Determine price-effect direction ──────────────────────────────────
            // [6063] Vertical DebitCredit Check: Tastytrade validates that the declared
            // price-effect matches the actual net cash flow of the two legs.
            //
            // Bull Put Spread (BPS) close:
            //   - BTC the short put (lower strike, e.g. 6625P) — costs money
            //   - STC the long put  (higher strike, e.g. 6675P) — receives money
            //   The long put (higher strike) is worth MORE than the short put.
            //   When the spread has decayed, STC the long put > BTC the short put
            //   → net cash flow is a CREDIT (we receive money to close).
            //
            // Bear Call Spread (BCS) close:
            //   - BTC the short call (lower strike) — costs more (lower strike call is pricier)
            //   - STC the long call  (higher strike) — receives less
            //   → net cash flow is a DEBIT (we pay to close).
            //
            // Rule: if longStrike > shortStrike (bull put spread), closing is a Credit.
            //       if longStrike < shortStrike (bear call spread), closing is a Debit.
            const isBullPutSpread = pos.longStrike > pos.strike;
            const netPriceEffect = spreadPriceEffect; // Already computed above

            // For the limit price:
            //   Credit close (BPS): we want to receive AT LEAST this much.
            //     Use a slightly aggressive (lower) limit so the order fills quickly.
            //     Buffer: subtract 10% or $0.05 min from the mark (accept slightly less).
            //   Debit close (BCS): we want to pay AT MOST this much.
            //     Buffer: add 10% or $0.05 min above the mark (willing to pay slightly more).
            const pricePremium = Math.max(pos.currentPrice * 0.10, 0.05);
            const rawPrice = isBullPutSpread
              ? Math.max(0.01, pos.currentPrice - pricePremium) // Credit: accept slightly less
              : pos.currentPrice + pricePremium;                // Debit: pay slightly more
            // Snap to the correct tick size for this symbol (index options use $0.10 ticks)
            const snappedPrice = snapToTick(rawPrice, pos.underlying);
            const formattedPrice = formatPriceForSubmission(snappedPrice);

            console.log(`[Performance] Closing ${instrumentType} spread: Short=${formattedShortSymbol}, Long=${longSymbol}`);
            console.log(`[Performance] Spread type: ${isBullPutSpread ? 'Bull Put (BPS)' : 'Bear Call (BCS)'} → price-effect: ${netPriceEffect}`);
            console.log(`[Performance] Limit price: $${formattedPrice} (mark=$${pos.currentPrice.toFixed(2)}, buffer=$${pricePremium.toFixed(2)})`);

            // Build two-leg order payload
            const orderPayload = {
              'time-in-force': 'Day',
              'order-type': 'Limit',
              'underlying-symbol': pos.underlying,
              price: formattedPrice,
              'price-effect': netPriceEffect, // Dynamically determined: Credit for BPS, Debit for BCS
              legs: [
                {
                  'instrument-type': instrumentType,
                  symbol: formattedShortSymbol,
                  quantity: pos.quantity.toString(),
                  action: 'Buy to Close',
                },
                {
                  'instrument-type': instrumentType,
                  symbol: longSymbol,
                  quantity: pos.quantity.toString(),
                  action: 'Sell to Close', // We sell back the long leg
                },
              ],
            };
            
            // Submit or dry-run the order
            const endpoint = dryRun 
              ? `/accounts/${pos.accountId}/orders/dry-run`
              : `/accounts/${pos.accountId}/orders`;
            
            const response = await api['client'].post(endpoint, orderPayload);
            
            if (dryRun) {
              console.log(`[Performance] Spread close order validated successfully`);
              results.push({
                success: true,
                message: `Spread close order validated (dry run)`,
                underlying: pos.underlying,
                strike: pos.strike,
                quantity: pos.quantity,
              });
            } else {
              const orderId = response.data?.data?.order?.id;
              console.log(`[Performance] Spread close order submitted: ${orderId}`);
              results.push({
                success: true,
                orderId,
                message: `Spread close order submitted successfully`,
                underlying: pos.underlying,
                strike: pos.strike,
                quantity: pos.quantity,
              });
              await writeTradingLog({
                userId: ctx.user.id, symbol: pos.underlying,
                optionSymbol: formattedShortSymbol, accountNumber: pos.accountId,
                strategy: 'spread-close', action: 'BTC',
                strike: String(pos.strike),
                quantity: pos.quantity, price: formattedPrice, priceEffect: netPriceEffect,
                instrumentType: 'Equity Option', outcome: 'success', orderId: String(orderId),
                source: 'routers-performance/submitCloseOrders',
              });
            }
          } catch (error: any) {
            console.error(`[Performance] Failed to close spread for ${pos.underlying}:`, error);
            results.push({
              success: false,
              message: `Failed to close spread: ${error.message}`,
              underlying: pos.underlying,
              strike: pos.strike,
              quantity: pos.quantity,
            });
            await writeTradingLog({
              userId: ctx.user.id, symbol: pos.underlying,
              accountNumber: pos.accountId, strategy: 'spread-close', action: 'BTC',
              strike: String(pos.strike), quantity: pos.quantity,
              // netPriceEffect may not be defined if the error occurred before it was computed
              priceEffect: spreadPriceEffect,
              instrumentType: 'Equity Option',
              outcome: 'error', errorMessage: error.message,
              errorPayload: JSON.stringify(error?.response?.data ?? {}),
              source: 'routers-performance/submitCloseOrders',
            });
          }
        } else {
          // Single-leg position - use existing logic
          // Add premium to close price for immediate fills
          // Use 10% above mark or +$0.05, whichever is greater
          const pricePremium = Math.max(pos.currentPrice * 0.10, 0.05);
          const aggressivePrice = pos.currentPrice + pricePremium;
          
          console.log(`[Performance] Pricing: mark=$${pos.currentPrice.toFixed(2)}, aggressive=$${aggressivePrice.toFixed(2)} (+${pricePremium.toFixed(2)})`);
          
          const result = await api.buyToCloseOption(
            pos.accountId,
            pos.optionSymbol,
            pos.quantity,
            aggressivePrice,
            dryRun
          );

          results.push({
            ...result,
            underlying: pos.underlying,
            strike: pos.strike,
            quantity: pos.quantity,
          });
          if (!dryRun) {
            await writeTradingLog({
              userId: ctx.user.id, symbol: pos.underlying,
              optionSymbol: pos.optionSymbol, accountNumber: pos.accountId,
              strategy: 'spread-close', action: 'BTC',
              strike: String(pos.strike),
              quantity: pos.quantity, price: aggressivePrice.toFixed(2), priceEffect: 'Debit',
              outcome: result.success ? 'success' : 'error',
              orderId: result.success ? String((result as any).orderId) : undefined,
              errorMessage: result.success ? undefined : (result as any).message,
              source: 'routers-performance/submitCloseOrders',
            });
          }
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      console.log(`[Performance] Close orders complete: ${successCount} success, ${failCount} failed`);

      return {
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failCount,
          excluded: excludedPositions.length,
        },
        excluded: excludedPositions.map(pos => ({
          underlying: pos.underlying,
          strike: pos.strike,
          optionSymbol: pos.optionSymbol,
        })),
      };
    }),

  /**
   * Get expiration calendar with clustering analysis
   */
  getExpirationCalendar: protectedProcedure
    .input(z.object({
      accountId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const { accountId } = input;
      const userId = ctx.user.id;

      console.log(`[Performance] Fetching expiration calendar for account ${accountId} (from cache)`);

      // Read from DB cache — no live API call needed
      const { getLivePositions } = await import('./portfolio-sync');
      const cachedPos = await getLivePositions(userId);

      // Filter to short options for the requested account
      const allPositions = cachedPos
        .filter(p =>
          p['instrument-type'] === 'Equity Option' &&
          parseFloat(p.quantity) < 0 &&
          (accountId === 'ALL_ACCOUNTS' || p['account-number'] === accountId)
        )
        .map(p => ({
          symbol: p.symbol,
          'underlying-symbol': p['underlying-symbol'],
          'instrument-type': p['instrument-type'],
          quantity: parseFloat(p.quantity),
          'expiration-date': p.expiresAt,
          'strike-price': p.strikePrice,
          accountNumber: p['account-number'],
          accountName: p['account-number'],
        }));

      // Group by expiration date
      const expirationMap = new Map<string, any[]>();
      for (const pos of allPositions) {
        const expDate = (pos as any)['expiration-date'];
        if (!expirationMap.has(expDate)) {
          expirationMap.set(expDate, []);
        }
        expirationMap.get(expDate)!.push({
          symbol: pos['underlying-symbol'],
          optionSymbol: pos.symbol,
          strike: (pos as any)['strike-price'] || 0,
          quantity: Math.abs(pos.quantity),
          type: pos.symbol.includes('P') ? 'PUT' : 'CALL',
          account: pos.accountName,
        });
      }

      // Convert to array and calculate clustering
      const expirations = Array.from(expirationMap.entries()).map(([date, positions]) => {
        const totalContracts = positions.reduce((sum, p) => sum + p.quantity, 0);
        const uniqueSymbols = new Set(positions.map(p => p.symbol)).size;
        return {
          date,
          positions,
          totalContracts,
          uniqueSymbols,
          clustered: totalContracts >= 5, // Flag if 5+ contracts expire same day
        };
      }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Calculate weekly clustering
      const weeklyMap = new Map<string, number>();
      for (const exp of expirations) {
        const date = new Date(exp.date);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
        const weekKey = weekStart.toISOString().split('T')[0];
        weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + exp.totalContracts);
      }

      const weeklyClusterWarnings = Array.from(weeklyMap.entries())
        .filter(([_, count]) => count >= 10)
        .map(([week, count]) => ({ week, count }));

      return {
        expirations,
        weeklyClusterWarnings,
        totalUpcomingContracts: expirations.reduce((sum, e) => sum + e.totalContracts, 0),
      };
    }),
});
