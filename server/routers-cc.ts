/**
 * Covered Calls Router
 * Backend procedures for CC workflow: position fetching, option scanning, scoring, order submission
 */

import { protectedProcedure, router } from "./_core/trpc";
import { withRateLimit } from './tradierRateLimiter';
import { TRPCError } from '@trpc/server';
import { z } from "zod";
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { writeTradingLog } from './routers-trading-log';
import { sendTelegramMessage, fmtOrderFilled, fmtOrderRejected } from './telegram';
import { getAccountNickname } from './db';

// Cash-settled European-style indexes — cannot be used for covered calls (no stock assignment possible)
const CASH_SETTLED_INDEXES = new Set(['SPX', 'SPXW', 'NDXP', 'NDX', 'MRUT', 'RUT', 'VIX', 'DJX', 'XSP', 'XND']);

export const ccRouter = router({
  /**
   * Fetch stock positions eligible for covered calls (≥100 shares)
   * Also identifies existing short calls and calculates available contracts
   */
  getEligiblePositions: protectedProcedure
    .input(z.object({ accountNumber: z.string() }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Check trading mode
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.user.id)).limit(1);
      const tradingMode = user?.tradingMode || 'live';

      // In paper mode, return mock positions
      if (tradingMode === 'paper') {
        const mockPositions = await db.select().from(schema.paperTradingPositions).where(eq(schema.paperTradingPositions.userId, ctx.user.id));
        
        const holdings = mockPositions.map(p => {
          const qty = Number(p.quantity) || 0;
          const price = Number(p.currentPrice) || 0;
          return {
            symbol: p.symbol || '',
            quantity: qty,
            currentPrice: price,
            marketValue: qty * price,
            existingContracts: 0,
            workingContracts: 0,
            sharesCovered: 0,
            availableShares: qty,
            maxContracts: Math.floor(qty / 100),
            hasExistingCalls: false,
            hasWorkingOrders: false,
          };
        });

        return {
          holdings,
          breakdown: {
            totalPositions: holdings.length,
            stockPositions: holdings.length,
            existingShortCalls: 0,
            eligiblePositions: holdings.filter(h => h.maxContracts > 0).length,
            eligibleContracts: holdings.reduce((sum, h) => sum + h.maxContracts, 0),
            coveredSymbols: [],
            shortCallDetails: {},
          },
        };
      }

      // Live mode — positions from LIVE Tastytrade API, working orders also live
      const { getApiCredentials } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // ── Positions: LIVE from Tastytrade API (never cached for CC scanning/submission) ────────────
      const { getStrictLivePositions } = await import('./portfolio-sync');
      const livePos = await getStrictLivePositions(ctx.user.id);
      const positions: any[] = livePos
        .filter(p => input.accountNumber === 'ALL' || p['account-number'] === input.accountNumber)
        .map(p => ({ ...((p: any) => p)({ ...p, quantityDirection: p['quantity-direction'] ?? '' }) }));

      // Fetch working orders to account for pending short calls (must be live)
      const workingOrders = await api.getWorkingOrders(input.accountNumber);

      // ⛔ Exclude cash-settled European-style indexes
      const stockPositions = positions
        .filter((p: any) => p['instrument-type'] === 'Equity')
        .filter((p: any) => !CASH_SETTLED_INDEXES.has((p.symbol as string).toUpperCase()))
        .filter((p: any) => (p['quantity-direction'] ?? 'Long') !== 'Short'); // ⛔ Exclude short stock positions (e.g. from early assignment)
      const optionPositions = positions.filter((p: any) =>
        p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option'
      );
      // Identify NAKED short calls (covered calls) from POSITIONS using SPREAD-AWARE logic.
      // Bear Call Spreads have a short call + long call on the same expiry — the long leg
      // protects the short and does NOT consume CC coverage capacity. We net per expiry.
      const shortCalls: Record<string, { contracts: number; details: any[] }> = {};
      {
        const shortByExpiry: Record<string, Record<string, number>> = {}; // underlying -> expiry -> qty
        const longByExpiry: Record<string, Record<string, number>> = {};
        for (const opt of optionPositions) {
          const sym = (opt as any).symbol as string;
          const isCall = sym.replace(/\s+/, '').match(/^[A-Z]+\d{6}C/);
          if (!isCall) continue;
          // Trim underlying-symbol — Tastytrade may pad it with spaces for short tickers
          const underlying = ((opt as any)['underlying-symbol'] as string || '').trim();
          const expiry = (opt as any)['expiration-date'] as string || sym.slice(6, 12);
          const qty = Math.abs(parseFloat((opt as any).quantity));
          const dir = (opt as any)['quantity-direction'];
          if (dir === 'Short') {
            if (!shortByExpiry[underlying]) shortByExpiry[underlying] = {};
            shortByExpiry[underlying][expiry] = (shortByExpiry[underlying][expiry] || 0) + qty;
          } else if (dir === 'Long') {
            if (!longByExpiry[underlying]) longByExpiry[underlying] = {};
            longByExpiry[underlying][expiry] = (longByExpiry[underlying][expiry] || 0) + qty;
          }
        }
        for (const underlying of Object.keys(shortByExpiry)) {
          const sExp = shortByExpiry[underlying];
          const lExp = longByExpiry[underlying] || {};
          let nakedCount = 0;
          const details: any[] = [];
          for (const expiry of Object.keys(sExp)) {
            const naked = Math.max(0, sExp[expiry] - (lExp[expiry] || 0));
            nakedCount += naked;
            if (naked > 0) details.push({ expiry, quantity: naked });
          }
          if (nakedCount > 0) {
            shortCalls[underlying] = { contracts: nakedCount, details };
          }
          console.log(`[CC getEligible single] ${underlying}: short=${JSON.stringify(sExp)}, long=${JSON.stringify(lExp)}, nakedCCs=${nakedCount}`);
        }
      }

      // Identify short calls in WORKING ORDERS (pending, not yet filled)
      // IMPORTANT: Filter to only truly active statuses — /orders/live can return Contingent,
      // Cancelled, Filled, and Rejected orders that have not yet been purged from the feed.
      const ACTIVE_ORDER_STATUSES = new Set(['received', 'routed', 'live', 'working', 'pending']);
      const workingShortCalls: Record<string, { contracts: number; details: any[] }> = {};
      for (const order of workingOrders) {
        // Skip any order that is not in a genuinely active/pending state
        const orderStatus = ((order as any).status || '').toLowerCase();
        if (!ACTIVE_ORDER_STATUSES.has(orderStatus)) {
          console.log(`[CC getEligible single] Skipping order ${(order as any).id} with status=${orderStatus}`);
          continue;
        }
        // Check if order has legs (multi-leg orders)
        const legs = (order as any).legs || [];
        for (const leg of legs) {
          // Short calls: action = "Sell to Open" and instrument type = "Equity Option" and symbol contains 'C'
          if (leg.action === 'Sell to Open' && (leg['instrument-type'] === 'Equity Option' || leg['instrument-type'] === 'Index Option') && leg.symbol.includes('C')) {
              const underlying = ((order as any)['underlying-symbol'] as string || '').trim();
              if (!workingShortCalls[underlying]) {
              workingShortCalls[underlying] = { contracts: 0, details: [] };
            }
            const qty = Math.abs(parseFloat(leg.quantity));
            workingShortCalls[underlying].contracts += qty;
            workingShortCalls[underlying].details.push({
              symbol: leg.symbol,
              quantity: qty,
              orderId: (order as any).id,
              status: (order as any).status,
            });
          }
        }
      }

      // Build holdings list - include ALL stock positions (not just ≥100 shares)
      // This matches Streamlit logic: all stocks are added, then filter by maxContracts > 0
      const holdings = stockPositions
        .filter((p: any) => parseFloat(p.quantity) > 0) // Long positions only
        .map((p: any) => {
          const symbol = p.symbol;
          const quantity = parseFloat(p.quantity);
          // Fallback: close-price is null for positions opened today; use mark or last instead
          const currentPrice = parseFloat(p['close-price'] ?? p['mark'] ?? p['last'] ?? '0') || 0;
          const marketValue = quantity * currentPrice;

          // Calculate contracts covered by existing short calls (filled positions)
          const existingContracts = shortCalls[symbol]?.contracts || 0;
          
          // Calculate contracts tied up in working orders (pending, not yet filled)
          const workingContracts = workingShortCalls[symbol]?.contracts || 0;
          
          // Total contracts that reduce available shares
          const totalUsedContracts = existingContracts + workingContracts;
          const sharesCovered = totalUsedContracts * 100;
          
          // Calculate available shares and max new contracts
          const availableShares = Math.max(0, quantity - sharesCovered);
          const maxContracts = Math.floor(availableShares / 100);

          return {
            symbol,
            quantity,
            currentPrice,
            marketValue,
            existingContracts,
            workingContracts,
            sharesCovered,
            availableShares,
            maxContracts,
            hasExistingCalls: existingContracts > 0,
            hasWorkingOrders: workingContracts > 0,
          };
        });

      // Calculate breakdown summary
      const breakdown = {
        totalPositions: positions.length,
        stockPositions: stockPositions.length,
        existingShortCalls: Object.keys(shortCalls).length,
        eligiblePositions: holdings.filter(h => h.maxContracts > 0).length,
        eligibleContracts: holdings.reduce((sum, h) => sum + h.maxContracts, 0),
        coveredSymbols: Object.keys(shortCalls),
        shortCallDetails: shortCalls,
      };

      return { holdings, breakdown };
    }),

  /**
   * Fetch eligible CC positions across ALL Tastytrade accounts in parallel.
   * Merges holdings by symbol — shares and covered contracts are summed across accounts.
   * Each holding retains an `accounts` array listing which account(s) hold the shares.
   */
  getEligiblePositionsAllAccounts: protectedProcedure
    .query(async ({ ctx }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.user.id)).limit(1);
      const tradingMode = user?.tradingMode || 'live';

      // Paper mode — return mock positions (same as single-account)
      if (tradingMode === 'paper') {
        const mockPositions = await db.select().from(schema.paperTradingPositions).where(eq(schema.paperTradingPositions.userId, ctx.user.id));
        const holdings = mockPositions.map(p => {
          const qty = Number(p.quantity) || 0;
          const price = Number(p.currentPrice) || 0;
          return {
            symbol: p.symbol || '',
            quantity: qty,
            currentPrice: price,
            marketValue: qty * price,
            existingContracts: 0,
            workingContracts: 0,
            sharesCovered: 0,
            availableShares: qty,
            maxContracts: Math.floor(qty / 100),
            hasExistingCalls: false,
            hasWorkingOrders: false,
            accounts: ['paper'] as string[],
          };
        });
        return {
          holdings,
          accountsScanned: ['paper'] as string[],
          breakdown: {
            totalPositions: holdings.length,
            stockPositions: holdings.length,
            existingShortCalls: 0,
            eligiblePositions: holdings.filter(h => h.maxContracts > 0).length,
            eligibleContracts: holdings.reduce((sum, h) => sum + h.maxContracts, 0),
            coveredSymbols: [] as string[],
            shortCallDetails: {} as Record<string, { contracts: number; details: any[] }>,
          },
        };
      }

      // Live mode — positions from DB cache, working orders still live
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }
       const api = await authenticateTastytrade(credentials, ctx.user.id);
      // ── Fetch account options levels to filter out accounts not approved for CC writing ──
      let accountOptionsLevels: Record<string, string> = {};
      try {
        const allAccounts = await api.getAccounts();
        for (const acctObj of allAccounts) {
          const acct = acctObj.account || acctObj as any;
          const acctNum: string = acct['account-number'] || acct.accountNumber || '';
          const level: string = (acct['suitable-options-level'] || '').toLowerCase();
          if (acctNum) accountOptionsLevels[acctNum] = level;
          console.log(`[CC getEligible] Account ${acctNum} options level: "${level}"`);
        }
      } catch (err: any) {
        console.warn('[CC getEligible] Could not fetch account options levels:', err.message);
      }
      // Accounts approved for covered calls must have options level >= 'covered writes' or 'no level 2'
      // Tastytrade levels: 'no level 1', 'no level 2', 'covered writes', 'defined risk spreads',
      //                    'speculative', 'no restrictions'
      // Covered calls require at minimum 'covered writes' level.
      const CC_APPROVED_LEVELS = new Set(['covered writes', 'defined risk spreads', 'speculative', 'no restrictions']);
      const isCCApproved = (acctNum: string): boolean => {
        const level = accountOptionsLevels[acctNum];
        if (!level) return true; // unknown level — allow and let TT reject if needed
        return CC_APPROVED_LEVELS.has(level);
      };
        // ── Positions: LIVE from Tastytrade API (never cached for CC scanning/submission) ────────────
      const { getStrictLivePositions: getStrictLivePos2 } = await import('./portfolio-sync');
      const allLivePos = await getStrictLivePos2(ctx.user.id);
      const accountNumbers: string[] = Array.from(new Set(allLivePos.map(p => p['account-number']).filter(Boolean)));
      console.log(`[CC getEligible] Accounts from live API:`, accountNumbers);
      // Working orders must still be fetched live (order status changes in real time)
      const workingOrdersByAccount = await Promise.allSettled(
        accountNumbers.map(async (acctNum: string) => {
          const workingOrders = await api.getWorkingOrders(acctNum).catch(() => [] as any[]);
          return { acctNum, workingOrders };
        })
      );
      // Build per-account results using live positions + live working orders
      const perAccountResults: Array<{ status: 'fulfilled'; value: { acctNum: string; positions: any[]; workingOrders: any[] } }> =
        accountNumbers.map(acctNum => {
          const positions = allLivePos
            .filter(p => p['account-number'] === acctNum)
            .map(p => ({ ...((p: any) => p)({ ...p, quantityDirection: p['quantity-direction'] ?? '' }) }));
          const woResult = workingOrdersByAccount.find(
            r => r.status === 'fulfilled' && r.value.acctNum === acctNum
          );
          const workingOrders = woResult?.status === 'fulfilled' ? woResult.value.workingOrders : [];
          return { status: 'fulfilled' as const, value: { acctNum, positions, workingOrders } };
        });
      console.log(`[CC getEligible] Loaded live positions for ${accountNumbers.length} accounts`);

      // Merged maps across all accounts
      const shortCallsAll: Record<string, { contracts: number; details: any[] }> = {};
      const workingShortCallsAll: Record<string, { contracts: number; details: any[] }> = {};
      const stockMap: Record<string, { quantity: number; currentPrice: number; averageOpenPrice: number; accounts: string[] }> = {};
      // Per-account tracking for correct order routing
      // perAccountStock[acct][symbol] = qty
      const perAccountStock: Record<string, Record<string, number>> = {};
      // perAccountNakedCalls[acct][symbol] = nakedCallContracts
      const perAccountNakedCalls: Record<string, Record<string, number>> = {};
      let totalRawPositions = 0;

      for (const result of perAccountResults) {
        const { acctNum, positions, workingOrders } = result.value;
         totalRawPositions += positions.length;
        // ⛔ Exclude cash-settled European-style indexes — no stock assignment, cannot write covered calls
        const stockPositions = positions
          .filter((p: any) => p['instrument-type'] === 'Equity')
          .filter((p: any) => !CASH_SETTLED_INDEXES.has((p.symbol as string).toUpperCase()))
          .filter((p: any) => (p['quantity-direction'] ?? 'Long') !== 'Short'); // ⛔ Exclude short stock positions (e.g. from early assignment)
        const optionPositions = positions.filter((p: any) =>
          p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option'
        );
        // Accumulate short calls from filled positions using SPREAD-AWARE logic.
        // Bear Call Spreads have a short call + long call on the same expiry — the long
        // leg protects the short leg and does NOT consume CC coverage capacity.
        // We net short vs long calls per expiry to get only NAKED short calls.
        const shortCallsByExpiry: Record<string, Record<string, number>> = {}; // underlying -> expiry -> qty
        const longCallsByExpiry: Record<string, Record<string, number>> = {};  // underlying -> expiry -> qty
        for (const opt of optionPositions) {
          const sym = (opt as any).symbol as string;
          // OCC symbol format: "TSLA  260313C00402500" — call if 'C' appears after the date
          const isCall = sym.replace(/\s+/, '').match(/^[A-Z]+\d{6}C/);
          if (!isCall) continue;
          // Trim underlying-symbol — Tastytrade may pad it with spaces for short tickers
          const underlying = ((opt as any)['underlying-symbol'] as string || '').trim();
          const expiry = (opt as any)['expiration-date'] as string || sym.slice(6, 12);
          const qty = Math.abs(parseFloat((opt as any).quantity));
          const dir = (opt as any)['quantity-direction'];
          if (dir === 'Short') {
            if (!shortCallsByExpiry[underlying]) shortCallsByExpiry[underlying] = {};
            shortCallsByExpiry[underlying][expiry] = (shortCallsByExpiry[underlying][expiry] || 0) + qty;
          } else if (dir === 'Long') {
            if (!longCallsByExpiry[underlying]) longCallsByExpiry[underlying] = {};
            longCallsByExpiry[underlying][expiry] = (longCallsByExpiry[underlying][expiry] || 0) + qty;
          }
        }
        // For each underlying, naked short calls = max(0, short - long) per expiry
        for (const underlying of Object.keys(shortCallsByExpiry)) {
          const shortByExpiry = shortCallsByExpiry[underlying];
          const longByExpiry = longCallsByExpiry[underlying] || {};
          let nakedCount = 0;
          const details: any[] = [];
          for (const expiry of Object.keys(shortByExpiry)) {
            const shortQty = shortByExpiry[expiry];
            const longQty = longByExpiry[expiry] || 0;
            const naked = Math.max(0, shortQty - longQty);
            nakedCount += naked;
            if (naked > 0) details.push({ expiry, quantity: naked, account: acctNum });
          }
          if (nakedCount > 0) {
            if (!shortCallsAll[underlying]) shortCallsAll[underlying] = { contracts: 0, details: [] };
            shortCallsAll[underlying].contracts += nakedCount;
            shortCallsAll[underlying].details.push(...details);
          }
          // Track per-account naked calls for correct order routing
          if (!perAccountNakedCalls[acctNum]) perAccountNakedCalls[acctNum] = {};
          perAccountNakedCalls[acctNum][underlying] = (perAccountNakedCalls[acctNum][underlying] || 0) + nakedCount;
          console.log(`[CC getEligible] ${acctNum}:${underlying}: short=${JSON.stringify(shortByExpiry)}, long=${JSON.stringify(longByExpiry)}, nakedCCs=${nakedCount}`);
        }

        // Accumulate short calls from working orders
        // IMPORTANT: Filter to only truly active statuses — /orders/live can return Contingent,
        // Cancelled, Filled, and Rejected orders that have not yet been purged from the feed.
        const ACTIVE_ORDER_STATUSES_ALL = new Set(['received', 'routed', 'live', 'working', 'pending']);
        for (const order of workingOrders) {
          const orderStatus = ((order as any).status || '').toLowerCase();
          if (!ACTIVE_ORDER_STATUSES_ALL.has(orderStatus)) {
            console.log(`[CC getEligible all] Skipping order ${(order as any).id} with status=${orderStatus} for ${acctNum}`);
            continue;
          }
          for (const leg of ((order as any).legs || [])) {
            if (leg.action === 'Sell to Open' &&
                (leg['instrument-type'] === 'Equity Option' || leg['instrument-type'] === 'Index Option') &&
                leg.symbol.includes('C')) {
              const underlying = ((order as any)['underlying-symbol'] as string || '').trim();
              if (!workingShortCallsAll[underlying]) workingShortCallsAll[underlying] = { contracts: 0, details: [] };
              const qty = Math.abs(parseFloat(leg.quantity));
              workingShortCallsAll[underlying].contracts += qty;
              workingShortCallsAll[underlying].details.push({
                symbol: leg.symbol, quantity: qty, orderId: (order as any).id,
                status: (order as any).status, account: acctNum,
              });
            }
          }
        }

        // Merge stock positions by symbol
        for (const p of stockPositions) {
          if (parseFloat(String(p.quantity)) <= 0) continue;
          const sym = p.symbol;
          const qty = parseFloat(String(p.quantity));
          const pAny = p as any;
          const price = parseFloat(p['close-price'] ?? pAny['mark'] ?? pAny['last'] ?? '0') || 0;
          const avgOpenPrice = parseFloat(pAny['average-open-price'] ?? '0') || 0;
          if (!stockMap[sym]) {
            stockMap[sym] = { quantity: 0, currentPrice: 0, averageOpenPrice: 0, accounts: [] };
          }
          stockMap[sym].quantity += qty;
          if (price > 0 && stockMap[sym].currentPrice === 0) stockMap[sym].currentPrice = price;
          if (avgOpenPrice > 0 && stockMap[sym].averageOpenPrice === 0) stockMap[sym].averageOpenPrice = avgOpenPrice;
          if (!stockMap[sym].accounts.includes(acctNum)) stockMap[sym].accounts.push(acctNum);
          // Track per-account stock quantity for correct order routing
          if (!perAccountStock[acctNum]) perAccountStock[acctNum] = {};
          perAccountStock[acctNum][sym] = (perAccountStock[acctNum][sym] || 0) + qty;
        }
      }

      // Build merged holdings
      const holdings = Object.entries(stockMap).map(([symbol, data]) => {
        const { quantity, currentPrice, accounts } = data;
        const existingContracts = shortCallsAll[symbol]?.contracts || 0;
        const workingContracts = workingShortCallsAll[symbol]?.contracts || 0;
        const totalUsedContracts = existingContracts + workingContracts;
        const sharesCovered = totalUsedContracts * 100;
        const availableShares = Math.max(0, quantity - sharesCovered);
        const maxContracts = Math.floor(availableShares / 100);

        // Build per-account breakdown: for each account that holds this symbol,
        // compute how many contracts are available in that specific account.
        // This lets the frontend pick the correct account for order routing.
        const accountBreakdown: Record<string, number> = {};
        for (const acct of accounts) {
          const acctShares = perAccountStock[acct]?.[symbol] || 0;
          const acctNakedCalls = perAccountNakedCalls[acct]?.[symbol] || 0;
          const acctCovered = acctNakedCalls * 100;
          const acctAvailable = Math.max(0, acctShares - acctCovered);
          // Only include accounts approved for covered call writing
          if (isCCApproved(acct)) {
            accountBreakdown[acct] = Math.floor(acctAvailable / 100);
          } else {
            console.log(`[CC getEligible] Skipping account ${acct} for ${symbol} — not approved for covered calls (level: ${accountOptionsLevels[acct] || 'unknown'})`);
          }
        }

        return {
          symbol,
          quantity,
          currentPrice,
          averageOpenPrice: data.averageOpenPrice,
          marketValue: quantity * currentPrice,
          existingContracts,
          workingContracts,
          sharesCovered,
          availableShares,
          maxContracts,
          hasExistingCalls: existingContracts > 0,
          hasWorkingOrders: workingContracts > 0,
          accounts,
          accountBreakdown,
        };
      });

      // Enrich holdings with live Tradier stock quotes (replaces stale close-price from Tastytrade positions)
      // This ensures OTM filtering in the CC scanner uses accurate current stock prices.
      const { createTradierAPI } = await import('./tradier');
      const tradierKeyForHoldings = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
      if (tradierKeyForHoldings && holdings.length > 0) {
        try {
          const tradierApiForHoldings = createTradierAPI(tradierKeyForHoldings, false, ctx.user.id);
          const holdingSymbols = holdings.map(h => h.symbol);
          const BATCH_SIZE_H = 100;
          for (let i = 0; i < holdingSymbols.length; i += BATCH_SIZE_H) {
            const batch = holdingSymbols.slice(i, i + BATCH_SIZE_H);
            const rawQuotes = await tradierApiForHoldings.getQuotes(batch);
            for (const q of rawQuotes) {
              if (!q.symbol) continue;
              const livePrice = q.last || q.close || 0;
              if (livePrice > 0) {
                const holding = holdings.find(h => h.symbol.toUpperCase() === q.symbol.toUpperCase());
                if (holding) {
                  holding.currentPrice = livePrice;
                  holding.marketValue = holding.quantity * livePrice;
                }
              }
            }
          }
          console.log(`[CC getEligible] Tradier live prices applied to ${holdings.length} holdings`);
        } catch (tradierErr: any) {
          console.warn('[CC getEligible] Tradier price enrichment failed, using close-price fallback:', tradierErr.message);
        }
      }

      const breakdown = {
        totalPositions: totalRawPositions,
        stockPositions: Object.keys(stockMap).length,
        existingShortCalls: Object.keys(shortCallsAll).length,
        eligiblePositions: holdings.filter(h => h.maxContracts > 0).length,
        eligibleContracts: holdings.reduce((sum, h) => sum + h.maxContracts, 0),
        coveredSymbols: Object.keys(shortCallsAll),
        shortCallDetails: shortCallsAll,
      };

      return { holdings, accountsScanned: accountNumbers, breakdown };
    }),

  /**
   * Scan call option chains for selected stocks
   * Calculates composite scores (0-100) for all opportunities
   */
  scanOpportunities: protectedProcedure
    .input(
      z.object({
        symbols: z.array(z.string()),
        holdings: z.array(
          z.object({
            symbol: z.string(),
            quantity: z.number(),
            currentPrice: z.number(),
            maxContracts: z.number(),
            averageOpenPrice: z.number().optional(),
          })
        ),
        minDte: z.number().default(7),
        maxDte: z.number().default(45),
        minDelta: z.number().default(0.05),
        maxDelta: z.number().default(0.99),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');
      const { checkRateLimit, incrementScanCount } = await import('./middleware/rateLimiting');
      const { getEffectiveTier: _getETcc } = await import('./middleware/subscriptionEnforcement');
      const _effTierCC = _getETcc(ctx.user);

      // Check rate limit (VIP users treated as advanced, bypass free_trial limits)
      const rateLimit = await checkRateLimit(ctx.user.id, _effTierCC, ctx.user.role);
      if (!rateLimit.allowed) {
        throw new Error(rateLimit.message || 'Rate limit exceeded');
      }

      const credentials = await getApiCredentials(ctx.user.id);
      
      // Determine if user can use system API key (only free trial users)
      const isFreeTrialUser = _effTierCC === 'free_trial';
      const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
      
      if (!tradierApiKey) {
        if (isFreeTrialUser) {
          throw new Error('System Tradier API key not configured. Please contact support.');
        } else {
          throw new Error('Please configure your Tradier API key in Settings to access live market data.');
        }
      }

      const api = createTradierAPI(tradierApiKey, false, ctx.user.id);
      const opportunities: any[] = [];

      // Build holdings map for quick lookup
      const holdingsMap = new Map(
        input.holdings.map(h => [h.symbol, h])
      );

      // Determine if we're in bear call spread mode (no holdings provided)
      const isBearCallSpreadMode = input.holdings.length === 0;
      console.log(`[CC Scanner] Mode: ${isBearCallSpreadMode ? 'Bear Call Spread (no holdings required)' : 'Covered Call (requires holdings)'}`);

      // Process symbols in parallel with concurrency limit of 20 (aligned with BPS scan)
      const CONCURRENCY = 20;
      const API_TIMEOUT_MS = 90000; // 90 second timeout per symbol (allows semaphore queue to drain)
      console.log(`[CC Scanner] Processing ${input.symbols.length} symbols with ${CONCURRENCY} concurrent workers...`);
      
      // Helper function to add timeout to promises
      const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('API call timeout')), timeoutMs)
          ),
        ]);
      };
      
      for (let i = 0; i < input.symbols.length; i += CONCURRENCY) {
        const batch = input.symbols.slice(i, i + CONCURRENCY);
        console.log(`[CC Scanner] Batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(input.symbols.length / CONCURRENCY)}: ${batch.join(', ')}`);
        
        const batchPromises = batch.map(async (symbol) => {
          // For bear call spreads, fetch current price from quote instead of holdings
          let holding = holdingsMap.get(symbol);
          
          if (!holding && isBearCallSpreadMode) {
            // Fetch current price from Tradier quote API
            // For index option series (NDXP, MRUT, SPXW), Tradier requires the underlying
            // index symbol for quotes: NDXP → NDX, MRUT → RUT, SPXW → SPX.
            const INDEX_QUOTE_MAP: Record<string, string> = {
              SPXW: 'SPX', SPXPM: 'SPX', NDX: 'NDX', NDXP: 'NDX',
              XND: 'XND', RUT: 'RUT', MRUT: 'RUT', DJX: 'DJX',
              VIX: 'VIX', VIXW: 'VIX', OEX: 'OEX', XEO: 'OEX', XSP: 'XSP',
            };
            const quoteSymbol = INDEX_QUOTE_MAP[symbol.toUpperCase()] || symbol;
            try {
              const quote = await api.getQuote(quoteSymbol);
              holding = {
                symbol,
                quantity: 0, // No stock ownership required for bear call spreads
                currentPrice: quote.last || quote.close || 0,
                maxContracts: 999, // Unlimited contracts for spreads (no stock requirement)
              };
              console.log(`[CC Scanner] Fetched quote for ${symbol} (via ${quoteSymbol}): $${holding.currentPrice}`);
            } catch (error: any) {
              console.error(`[CC Scanner] Failed to fetch quote for ${symbol} (via ${quoteSymbol}): ${error.message}`);
              return [];
            }
          }
          
          if (!holding) return [];

          const symbolOpportunities: any[] = [];

          // Resolve Tradier-recognised symbols for index option series.
          // SPXW/SPXPM expirations and chains are listed under SPX on Tradier;
          // NDXP under NDX; MRUT under RUT. Quotes use the same underlying symbol.
          const INDEX_OPTION_ROOT_MAP: Record<string, string> = {
            SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
          };
          const INDEX_UNDERLYING_MAP_CC: Record<string, string> = {
            SPXW: 'SPX', SPXPM: 'SPX', NDX: 'NDX', NDXP: 'NDX',
            XND: 'XND', RUT: 'RUT', MRUT: 'RUT', DJX: 'DJX',
            VIX: 'VIX', VIXW: 'VIX', OEX: 'OEX', XEO: 'OEX', XSP: 'XSP',
          };
          // tradierRoot: used for expirations + option chain (e.g. SPX for SPXW)
          const tradierRoot = INDEX_OPTION_ROOT_MAP[symbol.toUpperCase()] || symbol;
          // underlyingSymbol: used for quotes + technical indicators (e.g. SPX for SPXW)
          const underlyingSymbol = INDEX_UNDERLYING_MAP_CC[symbol.toUpperCase()] || symbol;
          const isIndexSeries = tradierRoot !== symbol || underlyingSymbol !== symbol;
          if (isIndexSeries) {
            console.log(`[CC Scanner] Index series detected: ${symbol} → root: ${tradierRoot}, underlying: ${underlyingSymbol}`);
          }

          try {
            // Fetch indicators (RSI, IV Rank, BB %B) with timeout
            // For index series use the underlying symbol (e.g. SPX not SPXW)
            const indicators = await withTimeout(
              api.getTechnicalIndicators(underlyingSymbol),
              API_TIMEOUT_MS
            ).catch(() => ({ rsi: null, ivRank: null, bollingerBands: { percentB: null } }));
            const rsi = indicators?.rsi || null;
            const ivRank = indicators?.ivRank || null;
            const bbPctB = indicators?.bollingerBands?.percentB || null;

            // Fetch expirations using Tradier-recognised option root (e.g. SPX for SPXW)
            const expirations = await withTimeout(
              api.getExpirations(tradierRoot),
              API_TIMEOUT_MS
            ).catch(() => []);
            const today = new Date();
            const filteredExpirations = expirations.filter(exp => {
              const expDate = new Date(exp);
              const dte = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              return dte >= input.minDte && dte <= input.maxDte;
            });

            if (filteredExpirations.length === 0) return [];

            // Process ALL expirations fully in parallel — no sequential batching
            console.log(`[CC Scanner DEBUG] ${symbol}: Processing ${filteredExpirations.length} expirations in parallel: ${filteredExpirations.join(', ')}`);
            {
              const expPromises = filteredExpirations.map(async (expiration) => {
                try {
                  console.log(`[CC Scanner DEBUG] ${symbol} ${expiration}: Fetching option chain (via ${tradierRoot})...`);
                  // Use tradierRoot for option chain (e.g. SPX for SPXW, NDX for NDXP)
                  const options = await withRateLimit(() =>
                    withTimeout(
                      api.getOptionChain(tradierRoot, expiration, true),
                      API_TIMEOUT_MS
                    )
                  );
                  console.log(`[CC Scanner DEBUG] ${symbol} ${expiration}: Received ${options.length} total options from Tradier API`);
                  
                  // Check for duplicates in Tradier API response
                  const apiDuplicateCheck = new Map<string, number>();
                  options.forEach(opt => {
                    const key = `${opt.strike}-${opt.option_type}`;
                    apiDuplicateCheck.set(key, (apiDuplicateCheck.get(key) || 0) + 1);
                  });
                  const apiDuplicates = Array.from(apiDuplicateCheck.entries()).filter(([_, count]) => count > 1);
                  if (apiDuplicates.length > 0) {
                    console.warn(`[CC Scanner DEBUG] ${symbol} ${expiration}: Tradier API returned duplicates!`, apiDuplicates);
                  }
                  
              const calls = options.filter(opt => opt.option_type === 'call');
                  console.log(`[CC Scanner DEBUG] ${symbol} ${expiration}: Filtered to ${calls.length} call options`);

                  for (const option of calls) {
                    const strike = option.strike || 0;
                const delta = Math.abs(option.greeks?.delta || 0);
                const bid = option.bid || 0;
                const ask = option.ask || 0;
                const mid = (bid + ask) / 2;
                const volume = option.volume || 0;
                const openInterest = option.open_interest || 0;

                // Only OTM calls (strike > current price)
                if (strike <= holding.currentPrice) continue;

                // Filter by delta range
                if (delta < input.minDelta || delta > input.maxDelta) continue;

                // Skip if no bid
                if (bid <= 0) continue;

                // Calculate DTE
                const expDate = new Date(expiration);
                const dte = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                    // Calculate metrics
                    const premiumPerShare = mid;
                    const returnPct = (premiumPerShare / holding.currentPrice) * 100;
                    const weeklyReturn = dte > 0 ? (returnPct / dte) * 7 : 0;
                    const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
                    const distanceOtmPct = ((strike - holding.currentPrice) / holding.currentPrice) * 100;

                    const oppKey = `${symbol}-${strike}-${expiration}`;
                    symbolOpportunities.push({
                      symbol,
                      currentPrice: holding.currentPrice,
                      strike,
                      expiration,
                      dte,
                      delta,
                      bid,
                      ask,
                      mid,
                      premium: mid, // Per-share dollars (industry standard)
                      returnPct,
                      weeklyReturn,
                      volume,
                      openInterest,
                      spreadPct,
                      rsi,
                      ivRank,
                      bbPctB,
                      sharesOwned: holding.quantity,
                      maxContracts: holding.maxContracts,
                      distanceOtm: distanceOtmPct,
                      // Raw IV and Expected Move
                      iv: option.greeks?.mid_iv ? Math.round(option.greeks.mid_iv * 10000) / 100 : null,
                      expectedMove: option.greeks?.mid_iv && holding.currentPrice && dte > 0
                        ? Math.round(holding.currentPrice * option.greeks.mid_iv * Math.sqrt(dte / 365) * 100) / 100
                        : null,
                      // OCC symbol for TT price enrichment (Tradier = scan only, TT = order price)
                      optionSymbol: option.symbol,
                    });
                    console.log(`[CC Scanner DEBUG] ${symbol} ${expiration}: Added opportunity ${oppKey} (total so far: ${symbolOpportunities.length})`);
                  }
                } catch (error: any) {
                  console.error(`[CC Scanner] Error processing expiration ${expiration} for ${symbol}: ${error.message}`);
                }
              });
              
              await Promise.allSettled(expPromises);
            } // end parallel expiration fetch
            
            // Check for duplicates in symbolOpportunities before returning
            const oppDuplicateCheck = new Map<string, number>();
            symbolOpportunities.forEach(opp => {
              const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
              oppDuplicateCheck.set(key, (oppDuplicateCheck.get(key) || 0) + 1);
            });
            const oppDuplicates = Array.from(oppDuplicateCheck.entries()).filter(([_, count]) => count > 1);
            if (oppDuplicates.length > 0) {
              console.warn(`[CC Scanner DEBUG] ${symbol}: Found ${oppDuplicates.length} duplicate opportunity keys BEFORE deduplication:`, oppDuplicates);
            }
            
            console.log(`[CC Scanner] ✓ ${symbol}: found ${symbolOpportunities.length} opportunities`);
          } catch (error: any) {
            console.error(`[CC Scanner] ✗ ${symbol}: ${error.message}`);
          }
          
          return symbolOpportunities;
        });
        
        // Wait for batch to complete
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Collect opportunities from batch
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            opportunities.push(...result.value);
          }
        });
      }

      // DEDUPLICATION: Remove duplicate opportunities with same symbol-strike-expiration
      // This can happen due to parallel processing race conditions or API quirks
      const uniqueOpportunities = new Map<string, any>();
      for (const opp of opportunities) {
        const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
        
        // Keep the opportunity with better bid/ask spread if duplicates exist
        if (!uniqueOpportunities.has(key) || opp.spreadPct < uniqueOpportunities.get(key).spreadPct) {
          uniqueOpportunities.set(key, opp);
        }
      }
      
      const deduplicatedOpportunities = Array.from(uniqueOpportunities.values());
      const duplicateCount = opportunities.length - deduplicatedOpportunities.length;
      
      if (duplicateCount > 0) {
        console.log(`[CC Scanner] Removed ${duplicateCount} duplicate CC opportunities (kept best spread for each unique option)`);
      }

      // ── BASIS RECOVERY: Query cached transactions for net CC premium per symbol ──────────────────
      // For each unique underlying symbol, sum net credit from CC 'Sell to Open' and 'Buy to Close' call transactions.
      // This lets calculateCCScore apply a tiered bonus when the stock's cost basis is substantially recovered.
      const basisRecoveryMap = new Map<string, number>(); // symbol → recovery % (0-100+)
      try {
        const { getDb } = await import('./db');
        const db = await getDb();
        if (db) {
          const { cachedTransactions } = await import('../drizzle/schema');
          const { and, inArray, sql: drizzleSql } = await import('drizzle-orm');
          const uniqueSymbolsForBasis = Array.from(new Set(deduplicatedOpportunities.map((o: any) => o.symbol as string)));
          if (uniqueSymbolsForBasis.length > 0) {
            // Sum netValue for all call option transactions (STO = credit, BTC = debit)
            const txRows = await db
              .select({
                underlyingSymbol: cachedTransactions.underlyingSymbol,
                totalNet: drizzleSql<string>`SUM(CAST(${cachedTransactions.netValue} AS DECIMAL(12,4)))`,
              })
              .from(cachedTransactions)
              .where(
                and(
                  eq(cachedTransactions.userId, ctx.user.id),
                  inArray(cachedTransactions.underlyingSymbol, uniqueSymbolsForBasis),
                  eq(cachedTransactions.optionType, 'C'),
                )
              )
              .groupBy(cachedTransactions.underlyingSymbol);
            // Map symbol → total net premium collected (positive = net credit)
            for (const row of txRows) {
              const sym = row.underlyingSymbol;
              if (!sym) continue;
              const netPremium = parseFloat(String(row.totalNet)) || 0;
              // Find the holding to get cost basis
              const holding = holdingsMap.get(sym);
              const avgCost = holding?.averageOpenPrice ?? 0;
              const qty = holding?.quantity ?? 0;
              if (avgCost > 0 && qty > 0) {
                const totalCostBasis = avgCost * qty;
                // netPremium from DB is per-contract (×100) total; convert to per-share basis
                const netPremiumPerShare = netPremium / qty;
                const recoveryPct = (netPremiumPerShare / avgCost) * 100;
                basisRecoveryMap.set(sym, Math.max(0, recoveryPct));
                console.log(`[CC Basis] ${sym}: avgCost=$${avgCost}, qty=${qty}, netPremium=$${netPremium.toFixed(2)}, recovery=${recoveryPct.toFixed(1)}%`);
              }
            }
          }
        }
      } catch (basisErr: any) {
        console.warn('[CC Basis] Could not load basis recovery data:', basisErr.message);
      }

      // Calculate composite scores for all opportunities
      const scoredOpportunities = deduplicatedOpportunities.map((opp: any) => {
        const basisRecoveryPct = basisRecoveryMap.get(opp.symbol) ?? null;
        const { score, breakdown } = calculateCCScore({ ...opp, basisRecoveryPct });
        return { ...opp, score, scoreBreakdown: breakdown, safetyRatio: (breakdown as any).safetyRatio ?? null, basisRecoveryPct };
      });

      // Sort by score descending
      scoredOpportunities.sort((a, b) => b.score - a.score);

      // Calculate risk badges for all opportunities
      const { calculateBulkRiskAssessments } = await import('./riskAssessment');
      const symbolSet = new Set<string>();
      scoredOpportunities.forEach(opp => symbolSet.add(opp.symbol));
      const uniqueSymbols = Array.from(symbolSet);
      const riskAssessments = await calculateBulkRiskAssessments(uniqueSymbols, api);
      
      // Attach risk badges to opportunities
      const scoredWithBadges = scoredOpportunities.map(opp => ({
        ...opp,
        riskBadges: riskAssessments.get(opp.symbol)?.badges || [],
      }));

      // ── ENRICH WITH LIVE TASTYTRADE PRICES (CC) ─────────────────────────────
      // Tradier = scan/screen only. All order prices MUST come from Tastytrade.
      if (scoredWithBadges.length > 0 && credentials?.tastytradeClientSecret) {
        try {
          const { authenticateTastytrade: authTT_CC } = await import('./tastytrade');
          const ttApiCC = await authTT_CC(credentials, ctx.user.id).catch(() => null);
          if (ttApiCC) {
            const occSymbols = scoredWithBadges
              .map(o => (o as any).optionSymbol)
              .filter(Boolean) as string[];
            if (occSymbols.length > 0) {
              const ttQuotesCC = await ttApiCC.getOptionQuotesBatch(occSymbols).catch(() => ({}));
              for (const opp of scoredWithBadges) {
                const sym = (opp as any).optionSymbol;
                const q = sym ? (ttQuotesCC as any)[sym] : null;
                if (!q) continue;
                const ttBid = parseFloat(q.bid) || 0;
                const ttAsk = parseFloat(q.ask) || 0;
                if (ttBid > 0 || ttAsk > 0) {
                  const ttMid = (ttBid + ttAsk) / 2;
                  console.log(`[CC TT Price] ${opp.symbol} ${(opp as any).strike}/${(opp as any).expiration}: Tradier mid=$${(opp as any).premium?.toFixed(2)}, TT mid=$${ttMid.toFixed(2)}`);
                  (opp as any).bid = ttBid;
                  (opp as any).ask = ttAsk;
                  (opp as any).mid = ttMid;
                  (opp as any).premium = ttMid;
                }
              }
            }
          }
        } catch (ttErrCC: any) {
          console.warn('[CC TT Price] Enrichment failed, keeping Tradier prices:', ttErrCC.message);
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      // Increment scan count for Tier 1 users (after successful scan)
      await incrementScanCount(ctx.user.id, _effTierCC, ctx.user.role);

      return scoredWithBadges;
    }),

  /**
   * Calculate bear call spread opportunities from CC opportunities
   * Takes CC opportunities and adds protective long calls at higher strikes
   */
  bearCallSpreadOpportunities: protectedProcedure
    .input(
      z.object({
        ccOpportunities: z.array(z.any()), // CC opportunities from scanOpportunities
        spreadWidth: z.number(), // 2, 5, 10 (equity) or 25, 50, 100 (index)
        symbolWidths: z.record(z.string(), z.number()).optional(), // per-symbol overrides e.g. { SPX: 50, NDX: 25 }
        isIndexMode: z.boolean().optional(), // true when scanning index products
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');
      const { calculateBearCallSpread } = await import('./bear-call-pricing');

      const credentials = await getApiCredentials(ctx.user.id);
      
      // Determine if user can use system API key (only free trial users)
      const { getEffectiveTier: _getETcc2 } = await import('./middleware/subscriptionEnforcement');
      const _effTierCC2 = _getETcc2(ctx.user);
      const isFreeTrialUser = _effTierCC2 === 'free_trial';
      const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
      
      if (!tradierApiKey) {
        if (isFreeTrialUser) {
          throw new Error('System Tradier API key not configured. Please contact support.');
        } else {
          throw new Error('Please configure your Tradier API key in Settings to access live market data.');
        }
      }

      const api = createTradierAPI(tradierApiKey, false, ctx.user.id);
      const spreadOpportunities: any[] = [];

      // Fetch 14-day historical trend for each unique symbol
      const uniqueSymbolsForTrend = Array.from(new Set(input.ccOpportunities.map((o: any) => o.symbol as string)));
      const trend14dMap = new Map<string, number>();
      const today = new Date();
      const trendStart = new Date(today);
      trendStart.setDate(trendStart.getDate() - 16); // 16 days back to ensure 14 trading days
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      await Promise.all(uniqueSymbolsForTrend.map(async (sym) => {
        try {
          // Map index symbols to Tradier-recognised roots for historical data
          const BCS_HIST_ROOT_MAP: Record<string, string> = {
            SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
          };
          const histSym = BCS_HIST_ROOT_MAP[sym.toUpperCase()] || sym;
          const history = await api.getHistoricalData(histSym, 'daily', fmt(trendStart), fmt(today));
          if (history && history.length >= 2) {
            const oldest = history[0].close;
            const newest = history[history.length - 1].close;
            const pctChange = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
            trend14dMap.set(sym, pctChange);
          }
        } catch {
          // trend14d will be undefined for this symbol — scoring uses neutral credit
        }
      }));

      // OPTIMIZATION: Group opportunities by symbol+expiration to batch API calls
      // Instead of fetching option chain for each opportunity (485 calls),
      // fetch once per unique symbol+expiration combo (~30 calls)
      const groupedOpps: Record<string, any[]> = {};
      for (const opp of input.ccOpportunities) {
        const key = `${opp.symbol}|${opp.expiration}`;
        if (!groupedOpps[key]) groupedOpps[key] = [];
        groupedOpps[key].push(opp);
      }

      console.log(`[BearCallSpread] Processing ${input.ccOpportunities.length} opportunities grouped into ${Object.keys(groupedOpps).length} unique symbol+expiration combos`);

      // Resolve Tradier option root for index series (same mapping as IC scanner)
      const BCS_OPTION_ROOT_MAP: Record<string, string> = {
        SPXW: 'SPX', SPXPM: 'SPX', NDXP: 'NDX', MRUT: 'RUT', VIXW: 'VIX',
      };

      // Auto-scale spread width for index symbols (mirrors IC scanner getEffectiveWidth logic)
      // Rule: effective width = max(user input, round(price * 0.004 / 5) * 5)
      // Gives ~25 pts for SPX (~6700), ~100 pts for NDX (~21000), ~10 pts for MRUT (~2100)
      // Per-symbol overrides from the UI take highest priority.
      //
      // IMPORTANT: The scan returns opportunities with symbol='SPXW' (weekly root) but the user
      // selects widths against 'SPX' in the watchlist. We must resolve the alias so that
      // symbolWidths['SPX']=50 is correctly applied to SPXW opportunities.
      const SYMBOL_WIDTH_ALIAS: Record<string, string> = {
        SPXW: 'SPX', SPXPM: 'SPX',   // Weekly/PM SPX → user selects 'SPX'
        NDXP: 'NDX',                   // PM-settled NDX → user selects 'NDX'
        MRUT: 'RUT',                   // Mini-RUT → user selects 'RUT'
        VIXW: 'VIX',                   // Weekly VIX → user selects 'VIX'
      };
      const getEffectiveSpreadWidth = (sym: string, price: number): number => {
        const symUpper = sym.toUpperCase();
        // Check per-symbol override first (from UI per-symbol width controls).
        // Also check the canonical watchlist alias (e.g., SPXW → SPX) so that a user
        // who sets SPX=50pt gets 50pt spreads on SPXW opportunities too.
        if (input.symbolWidths) {
          if (input.symbolWidths[symUpper] !== undefined) return input.symbolWidths[symUpper];
          const alias = SYMBOL_WIDTH_ALIAS[symUpper];
          if (alias && input.symbolWidths[alias] !== undefined) return input.symbolWidths[alias];
        }
        if (price < 500) return input.spreadWidth; // equity: use user input
        const autoWidth = Math.max(input.spreadWidth, Math.round((price * 0.004) / 5) * 5);
        return autoWidth;
      };

      // Process each group (fetch option chain once, process all strikes)
      const CONCURRENCY_LIMIT = 20; // Process 20 groups at a time (aligned with BPS scan)
      const API_TIMEOUT_MS = 90000; // 90 second timeout per group (allows semaphore queue to drain)
      
      // Helper function to add timeout to promises
      const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('API call timeout')), timeoutMs)
          ),
        ]);
      };
      const groups = Object.entries(groupedOpps);
      
      for (let i = 0; i < groups.length; i += CONCURRENCY_LIMIT) {
        const batch = groups.slice(i, i + CONCURRENCY_LIMIT);
        
        await Promise.all(batch.map(async ([key, opps]) => {
          try {
            const [symbol, expiration] = key.split('|');
            
            // Resolve Tradier-recognised option root for index series
            const tradierRoot = BCS_OPTION_ROOT_MAP[symbol.toUpperCase()] || symbol;

            // Fetch option chain ONCE for this symbol+expiration (use tradierRoot for indexes)
            const options = await withTimeout(
              api.getOptionChain(tradierRoot, expiration, true),
              API_TIMEOUT_MS
            ).catch(() => []);
            
            // Process all opportunities for this expiration
            for (const ccOpp of opps) {
              try {
                // Auto-scale spread width for index symbols (per-symbol override takes priority)
                const effectiveWidth = getEffectiveSpreadWidth(symbol, ccOpp.currentPrice || 0);
                const targetLongStrike = ccOpp.strike + effectiveWidth;
                
                // Find the long call — first try exact match, then nearest available strike
                // (index options have non-uniform strike intervals)
                const callStrikes = options
                  .filter(o => o.option_type === 'call' && o.bid && o.ask && o.strike > ccOpp.strike)
                  .map(o => o.strike as number)
                  .sort((a, b) => a - b);

                // maxDeviation: allow at most 50% overshoot of the target width
                // (e.g., for a 100pt NDX target, accept strikes between 50pt and 150pt above short)
                // This prevents accepting a 200pt strike when 100pt is the target.
                const maxDeviation = Math.max(Math.round(effectiveWidth * 0.5), 5);
                const bestLongStrike = callStrikes.reduce((best: number | undefined, s) => {
                  if (Math.abs(s - targetLongStrike) > maxDeviation) return best;
                  if (best === undefined) return s;
                  return Math.abs(s - targetLongStrike) < Math.abs(best - targetLongStrike) ? s : best;
                }, undefined);

                if (bestLongStrike === undefined) continue;
                const actualWidth = bestLongStrike - ccOpp.strike;

                // Find the long call from cached option chain
                const longCall = options.find(
                  opt => opt.option_type === 'call' && opt.strike === bestLongStrike
                );
                
                if (!longCall || !longCall.bid || !longCall.ask) continue;
                
                // Calculate spread pricing (use actualWidth for correct collateral calculation)
                const spreadOpp = calculateBearCallSpread(
                  ccOpp,
                  actualWidth,
                  {
                    bid: longCall.bid,
                    ask: longCall.ask,
                    delta: Math.abs(longCall.greeks?.delta || 0),
                  }
                );
                
                // Only include if net credit is positive AND structurally sound.
                // Credit-to-width sanity check: reject spreads where net credit > 80% of spread width.
                // A credit exceeding 80% of max profit signals the spread is deep ITM or prices are stale.
                const bcsCreditRatio = actualWidth > 0 ? spreadOpp.netCredit / actualWidth : 0;
                if (spreadOpp.netCredit > 0 && bcsCreditRatio <= 0.80) {
                  // Use BCS-specific scoring (not CC scoring)
                  const { calculateBCSScore } = await import('./bcs-scoring');
                  // Inject 14-day trend data into the spread opportunity for direction scoring
                  const trend14d = trend14dMap.get(ccOpp.symbol);
                  (spreadOpp as any).trend14d = trend14d;
                  const { score, breakdown } = calculateBCSScore(
                    { ...spreadOpp, trend14d } as any,
                    { isIndexMode: input.isIndexMode ?? false }
                  );
                  spreadOpp.score = score;
                  (spreadOpp as any).scoreBreakdown = breakdown;
                  (spreadOpp as any).trendBias = breakdown.trendBias;
                  (spreadOpp as any).safetyRatio = (breakdown as any).safetyRatio ?? null;
                  // Add long leg OCC symbol for TT price enrichment
                  (spreadOpp as any).longOptionSymbol = longCall.symbol;
                  spreadOpportunities.push(spreadOpp);
                } else if (bcsCreditRatio > 0.80) {
                  console.log(`[BCS] Rejecting ${ccOpp.symbol} strike ${ccOpp.strike}: credit/width ${(bcsCreditRatio*100).toFixed(0)}% > 80% (ITM or stale prices)`);
                }
              } catch (error) {
                console.error(`[BearCallSpread] Error calculating spread for ${ccOpp.symbol} ${ccOpp.strike}:`, error);
              }
            }
          } catch (error) {
            console.error(`[BearCallSpread] Error fetching option chain for ${key}:`, error);
          }
        }));
        
        console.log(`[BearCallSpread] Processed ${Math.min((i + CONCURRENCY_LIMIT), groups.length)}/${groups.length} groups: ${spreadOpportunities.length} spreads found`);
      }

      // DEDUPLICATION: Remove duplicate spreads with same symbol-shortStrike-longStrike-expiration
      // This prevents React key errors when the same spread appears multiple times
      const uniqueSpreads = new Map<string, any>();
      for (const spread of spreadOpportunities) {
        const key = `${spread.symbol}-${spread.strike}-${spread.longStrike}-${spread.expiration}`;
        
        // Keep the spread with the highest score if duplicates exist
        if (!uniqueSpreads.has(key) || spread.score > uniqueSpreads.get(key).score) {
          uniqueSpreads.set(key, spread);
        }
      }
      
         const deduplicatedSpreads = Array.from(uniqueSpreads.values());
      const duplicateCount = spreadOpportunities.length - deduplicatedSpreads.length;
      
      if (duplicateCount > 0) {
        console.log(`[BearCallSpread] Removed ${duplicateCount} duplicate spreads (kept highest score for each unique spread)`);
      }
      // Sort by score descending
      deduplicatedSpreads.sort((a, b) => b.score - a.score);

      // ── ENRICH WITH LIVE TASTYTRADE PRICES (BCS) ─────────────────────────────
      // Tradier = scan/screen only. All order prices MUST come from Tastytrade.
      if (deduplicatedSpreads.length > 0) {
        try {
          const { getApiCredentials: getCredsBCS } = await import('./db');
          const credsBCS = await getCredsBCS(ctx.user.id);
          if (credsBCS?.tastytradeClientSecret) {
            const { authenticateTastytrade: authTT_BCS } = await import('./tastytrade');
            const ttApiBCS = await authTT_BCS(credsBCS, ctx.user.id).catch(() => null);
            if (ttApiBCS) {
              const occSymsBCS = new Set<string>();
              deduplicatedSpreads.forEach(s => {
                if ((s as any).optionSymbol) occSymsBCS.add((s as any).optionSymbol);
                if ((s as any).longOptionSymbol) occSymsBCS.add((s as any).longOptionSymbol);
              });
              const ttQuotesBCS = await ttApiBCS.getOptionQuotesBatch(Array.from(occSymsBCS)).catch(() => ({}));
              for (const spread of deduplicatedSpreads) {
                const shortSym = (spread as any).optionSymbol;
                const longSym = (spread as any).longOptionSymbol;
                const qShort = shortSym ? (ttQuotesBCS as any)[shortSym] : null;
                const qLong = longSym ? (ttQuotesBCS as any)[longSym] : null;
                if (qShort) {
                  const ttShortBid = parseFloat(qShort.bid) || 0;
                  const ttShortAsk = parseFloat(qShort.ask) || 0;
                  const ttShortMid = (ttShortBid + ttShortAsk) / 2;
                  (spread as any).bid = ttShortBid;
                  (spread as any).ask = ttShortAsk;
                }
                if (qLong) {
                  const ttLongBid = parseFloat(qLong.bid) || 0;
                  const ttLongAsk = parseFloat(qLong.ask) || 0;
                  const ttLongMid = (ttLongBid + ttLongAsk) / 2;
                  (spread as any).longBid = ttLongBid;
                  (spread as any).longAsk = ttLongAsk;
                  (spread as any).longPremium = ttLongMid;
                }
                if (qShort && qLong) {
                  const ttShortMid = ((parseFloat(qShort.bid)||0) + (parseFloat(qShort.ask)||0)) / 2;
                  const ttLongMid = ((parseFloat(qLong.bid)||0) + (parseFloat(qLong.ask)||0)) / 2;
                  const ttNetCredit = ttShortMid - ttLongMid;
                  if (ttNetCredit > 0) {
                    (spread as any).netCredit = ttNetCredit;
                    (spread as any).premium = ttNetCredit;
                    console.log(`[BCS TT Price] ${(spread as any).symbol} ${(spread as any).strike}/${(spread as any).longStrike}: TT net credit=$${ttNetCredit.toFixed(2)}`);
                  }
                }
              }
            }
          }
        } catch (ttErrBCS: any) {
          console.warn('[BCS TT Price] Enrichment failed, keeping Tradier prices:', ttErrBCS.message);
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      return deduplicatedSpreads;
    }),
  /**
   * Submit covered call orders (with dry run support)
   */
  submitOrders: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        orders: z.array(
          z.object({
            symbol: z.string(),
            strike: z.number(),
            expiration: z.string(),
            quantity: z.number(),
            price: z.number(),
            // Optional per-order account override (multi-account CC scans)
            accountNumber: z.string().optional(),
          })
        ),
        dryRun: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        console.log('[CC submitOrders] Starting order submission', {
          accountNumber: input.accountNumber,
          orderCount: input.orders.length,
          dryRun: input.dryRun,
          userId: ctx.user.id,
        });
        
        // Check if user is in paper trading mode
        const { getDb } = await import('./db');
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        const [user] = await db.select().from((await import('../drizzle/schema.js')).users).where((await import('drizzle-orm')).eq((await import('../drizzle/schema.js')).users.id, ctx.user.id));
        if (user?.tradingMode === 'paper') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Order submission is disabled in Paper Trading mode',
          });
        }
      
      // ─── Liquidation flag check (SYMBOL-WIDE) ─────────────────────────────
      // Block new covered call STO orders for any symbol flagged for liquidation
      // across ALL accounts. A dog is a dog — if flagged in any account, no new
      // CCs are opened in any account for that symbol.
      const { liquidationFlags } = await import('../drizzle/schema');
      const { eq: eqLiq, inArray } = await import('drizzle-orm');
      const flaggedSymbols = await db.select({ symbol: liquidationFlags.symbol })
        .from(liquidationFlags)
        .where(eqLiq(liquidationFlags.userId, ctx.user.id));
      const flaggedSet = new Set(flaggedSymbols.map(f => f.symbol.toUpperCase()));
      if (flaggedSet.size > 0) {
        console.log(`[CC Submit] Symbol-wide liquidation flags active: ${Array.from(flaggedSet).join(', ')}`);
      }
      const blockedOrders = input.orders.filter(o => flaggedSet.has(o.symbol.toUpperCase()));
      if (blockedOrders.length > 0) {
        const blockedSymbols = Array.from(new Set(blockedOrders.map(o => o.symbol.toUpperCase()))).join(', ');
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `⛔ Blocked for Liquidation — ${blockedSymbols} ${blockedOrders.length === 1 ? 'is' : 'are'} flagged for exit across all accounts. No new covered calls will be opened. Remove the flag in Position Analyzer → Position Analyzer tab to re-enable.`,
        });
      }
      // ──────────────────────────────────────────────────────────────────────────

      // Validate contract limits before submission (both dry run and live)
      const { getApiCredentials } = await import('./db');
      

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      // ── Multi-account position validation ──────────────────────────────────
      // Each order may target a different account (multi-account CC scans).
      // Resolve the effective account for each order, then fetch positions
      // per unique account and build a per-account maxContracts map.
      const resolvedOrders = input.orders.map(order => ({
        ...order,
        effectiveAccount: order.accountNumber ?? input.accountNumber,
      }));

      // Collect unique accounts that need position validation
      const uniqueAccounts = Array.from(new Set(resolvedOrders.map(o => o.effectiveAccount)));
      console.log('[CC submitOrders] Accounts to validate:', uniqueAccounts);

      // maxContractsMap keyed by `${account}:${symbol}` for per-account accuracy
      const maxContractsMap: Record<string, number> = {};

      for (const acctNum of uniqueAccounts) {
        const positions = await api.getPositions(acctNum);
        const stockPositions = positions
          .filter((p: any) => p['instrument-type'] === 'Equity')
          .filter((p: any) => !CASH_SETTLED_INDEXES.has((p.symbol as string).toUpperCase()))
          .filter((p: any) => (p['quantity-direction'] ?? 'Long') !== 'Short'); // ⛔ Exclude short stock positions (e.g. from early assignment)
        const optionPositions = positions.filter((p: any) =>
          p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option'
        );
        const shortCalls: Record<string, number> = {};
        for (const opt of optionPositions) {
          const quantityDirection = (opt as any)['quantity-direction'];
          if (quantityDirection === 'Short' && (opt as any).symbol.includes('C')) {
            const underlying = (opt as any)['underlying-symbol'];
            const qty = Math.abs(parseFloat((opt as any).quantity));
            shortCalls[underlying] = (shortCalls[underlying] || 0) + qty;
          }
        }
        console.log(`[CC submitOrders] Account ${acctNum} position analysis:`);
        console.log(`[CC submitOrders] Stock positions:`, stockPositions.map((p: any) => ({ symbol: p.symbol, quantity: p.quantity })));
        console.log(`[CC submitOrders] Existing short calls:`, shortCalls);
        for (const pos of stockPositions) {
          const symbol = (pos as any).symbol;
          const quantity = parseFloat((pos as any).quantity);
          if (quantity > 0) {
            const existingContracts = shortCalls[symbol] || 0;
            const sharesCovered = existingContracts * 100;
            const availableShares = Math.max(0, quantity - sharesCovered);
            const maxContracts = Math.floor(availableShares / 100);
            maxContractsMap[`${acctNum}:${symbol}`] = maxContracts;
            console.log(`[CC submitOrders] ${acctNum}:${symbol}: ${quantity} shares, ${existingContracts} existing, ${maxContracts} max contracts`);
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // Filter out orders where maxContracts is insufficient (prevents uncovered options).
      // CRITICAL: A key missing from maxContractsMap means the account has NO shares of that
      // symbol at all — submitting such an order causes Tastytrade to reject it as "uncovered".
      const filteredOrders = resolvedOrders.filter(order => {
        const key = `${order.effectiveAccount}:${order.symbol}`;
        const maxContracts = maxContractsMap[key] ?? 0;
        if (!(key in maxContractsMap)) {
          // Account does not hold this symbol at all — hard block
          console.error(`[CC submitOrders] BLOCKED ${order.effectiveAccount}:${order.symbol}: Account has no shares of this symbol. Order would be uncovered. Check account routing.`);
          return false;
        }
        if (order.quantity > maxContracts) {
          console.log(`[CC submitOrders] FILTERED OUT ${order.effectiveAccount}:${order.symbol}: Requested ${order.quantity} contracts but only ${maxContracts} available (would be uncovered)`);
          return false;
        }
        return true;
      });

      // If all orders were filtered out, return error with actionable message
      if (filteredOrders.length === 0) {
        const blockedSymbols = resolvedOrders.map(o => `${o.symbol} (acct ${o.effectiveAccount})`).join(', ');
        throw new Error(
          `All orders blocked: the target account does not hold shares for: ${blockedSymbols}. ` +
          `Covered calls require 100 shares per contract in the same account. ` +
          `Re-scan to refresh account routing.`
        );
      }

      // Validate each order doesn't exceed maxContracts for its account
      const validationErrors: string[] = [];
      console.log('[CC submitOrders] Validating contract limits:');
      for (const order of resolvedOrders) {
        const key = `${order.effectiveAccount}:${order.symbol}`;
        const maxContracts = maxContractsMap[key] ?? 0;
        console.log(`[CC submitOrders] ${key}: Requesting ${order.quantity} contracts, max available: ${maxContracts}`);
        if (order.quantity > maxContracts) {
          validationErrors.push(
            `${order.symbol} (acct ${order.effectiveAccount}): Requested ${order.quantity} contracts but only ${maxContracts} available`
          );
        }
      }

      // If validation fails, return errors
      if (validationErrors.length > 0) {
        throw new Error(`Contract limit validation failed:\n${validationErrors.join('\n')}`);
      }

      if (input.dryRun) {
        // Dry run - validation passed, return success
        return filteredOrders.map(order => ({
          success: true,
          symbol: order.symbol,
          strike: order.strike,
          quantity: order.quantity,
          message: 'Dry run - validation passed, order not submitted',
          orderId: 'DRY_RUN',
        }));
      }

      // Live mode - submit real orders (api and credentials already initialized above)
      // ── EARNINGS BLOCK PRE-FLIGHT ────────────────────────────────────────────
      {
        const { TradierAPI } = await import('./tradier');
        const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
        const tradierKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKey) {
          const tradierAPI = new TradierAPI(tradierKey);
          const symbols = Array.from(new Set(filteredOrders.map((o: any) => o.symbol)));
          const earningsResult = await checkEarningsBlock(symbols, tradierAPI);
          if (earningsResult.blocked.length > 0) {
            throw new Error(formatEarningsBlockMessage(earningsResult));
          }
          if (earningsResult.warned.length > 0) {
            console.warn('[EarningsBlock] CC earnings warning:', earningsResult.warned);
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────
      const results = [];

      for (const order of filteredOrders) {
        try {
          // Format option symbol (e.g., "AAPL  250131C00175000")
          const expDate = new Date(order.expiration);
          const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
          const strikeStr = (order.strike * 1000).toFixed(0).padStart(8, '0');
          const optionSymbol = `${order.symbol.padEnd(6)}${expStr}C${strikeStr}`;

          // CRITICAL: Cash-settled index options (SPX, SPXW, NDX, NDXP, RUT, MRUT, etc.)
          // require 'Index Option' as the instrument type. Sending 'Equity Option' causes
          // Order_disallowed_by_exchange_rules rejection from CBOE/Nasdaq.
          const { isTrueIndexOption: isCCIndexOpt } = await import('../shared/orderUtils');
          const ccInstrumentType: 'Index Option' | 'Equity Option' =
            isCCIndexOpt(order.symbol) ? 'Index Option' : 'Equity Option';

          console.log('[CC submitOrders] Submitting order to Tastytrade API:', {
            symbol: order.symbol,
            strike: order.strike,
            expiration: order.expiration,
            quantity: order.quantity,
            price: order.price,
            optionSymbol,
            instrumentType: ccInstrumentType,
          });

          // Submit sell-to-open order (use per-order effectiveAccount for multi-account support)
          const result = await api.submitOrder({
            accountNumber: order.effectiveAccount,
            timeInForce: 'Day',
            orderType: 'Limit',
            price: order.price.toFixed(2),
            priceEffect: 'Credit',
            legs: [
              {
                instrumentType: ccInstrumentType,
                symbol: optionSymbol,
                quantity: order.quantity.toString(),
                action: 'Sell to Open',
              },
            ],
          });

          console.log('[CC submitOrders] Tastytrade API response:', {
            symbol: order.symbol,
            orderId: result.id,
            status: result.status,
            fullResult: JSON.stringify(result),
          });

          results.push({
            success: true,
            symbol: order.symbol,
            strike: order.strike,
            quantity: order.quantity,
            orderId: result.id,
            message: 'Order submitted successfully',
          });
          // Telegram notification — fire-and-forget, never block order flow
          getAccountNickname(ctx.user.id, order.effectiveAccount).then(label =>
            sendTelegramMessage(fmtOrderFilled({
              symbol: order.symbol,
              strategy: 'CC',
              strike: order.strike,
              expiration: order.expiration,
              premium: order.price * order.quantity * 100,
              accountLabel: label,
            }))
          ).catch(() => {});
          await writeTradingLog({
            userId: ctx.user.id, symbol: order.symbol, optionSymbol,
            accountNumber: order.effectiveAccount, strategy: 'cc', action: 'STO',
            strike: String(order.strike), expiration: order.expiration,
            quantity: order.quantity, price: order.price.toFixed(2), priceEffect: 'Credit',
            instrumentType: ccInstrumentType, outcome: 'success', orderId: String(result.id),
            source: 'routers-cc/submitOrders',
          });
        } catch (error: any) {
          results.push({
            success: false,
            symbol: order.symbol,
            strike: order.strike,
            quantity: order.quantity,
            message: error.message,
          });
          // Telegram notification — fire-and-forget, never block order flow
          getAccountNickname(ctx.user.id, order.effectiveAccount).then(label =>
            sendTelegramMessage(fmtOrderRejected({
              symbol: order.symbol,
              strategy: 'CC',
              strike: order.strike,
              reason: error.message,
              accountLabel: label,
            }))
          ).catch(() => {});
          const expDate2 = new Date(order.expiration);
          const expStr2 = expDate2.toISOString().slice(2, 10).replace(/-/g, '');
          const strikeStr2 = (order.strike * 1000).toFixed(0).padStart(8, '0');
          const failOptSym = `${order.symbol.padEnd(6)}${expStr2}C${strikeStr2}`;
          await writeTradingLog({
            userId: ctx.user.id, symbol: order.symbol, optionSymbol: failOptSym,
            accountNumber: order.effectiveAccount, strategy: 'cc', action: 'STO',
            strike: String(order.strike), expiration: order.expiration,
            quantity: order.quantity, price: order.price.toFixed(2), priceEffect: 'Credit',
            outcome: 'error', errorMessage: error.message,
            errorPayload: JSON.stringify(error?.response?.data ?? error?.cause ?? {}),
            source: 'routers-cc/submitOrders',
          });
      }
    }

      console.log('[CC submitOrders] Order submission complete', {
        totalOrders: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      });
      
      return results;
      } catch (error: any) {
        console.error('[CC submitOrders] CRITICAL ERROR - Order submission crashed:', {
          errorMessage: error.message,
          errorStack: error.stack,
          accountNumber: input.accountNumber,
          orderCount: input.orders.length,
          dryRun: input.dryRun,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Order submission failed: ${error.message}`,
        });
      }
    }),

  /**
   * Submit bear call spread orders (two-leg: STO short call + BTO long call)
   */
  submitBearCallSpreadOrders: protectedProcedure
    .input(
      z.object({
        accountNumber: z.string(),
        orders: z.array(
          z.object({
            symbol: z.string(),
            shortStrike: z.number(),
            longStrike: z.number(),
            expiration: z.string(),
            quantity: z.number(),
            netCredit: z.number(), // Net credit for the spread
          })
        ),
        dryRun: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      if (input.dryRun) {
        // Dry run - return success without submitting
        return input.orders.map(order => ({
          success: true,
          symbol: order.symbol,
          shortStrike: order.shortStrike,
          longStrike: order.longStrike,
          quantity: order.quantity,
          message: 'Dry run - validation passed, order not submitted',
          orderId: 'DRY_RUN',
        }));
      }

      // Live mode - submit real two-leg orders with batch processing and rate limiting
      // ── EARNINGS BLOCK PRE-FLIGHT ────────────────────────────────────────────
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
            console.warn('[EarningsBlock] BCS earnings warning:', earningsResult.warned);
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────
      const results: Array<{ success: boolean; symbol: string; shortStrike: number; longStrike: number; quantity: number; orderId?: string; message: string }> = [];
      const BATCH_SIZE = 10; // Process 10 orders per batch
      const BATCH_DELAY_MS = 2000; // 2 second delay between batches
      const totalBatches = Math.ceil(input.orders.length / BATCH_SIZE);

      console.log(`[BearCallSpread] Submitting ${input.orders.length} orders in ${totalBatches} batches`);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, input.orders.length);
        const batch = input.orders.slice(batchStart, batchEnd);

        console.log(`[BearCallSpread] Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} orders)`);

        // Process batch concurrently
        const batchPromises = batch.map(async (order) => {
          try {
            // Format option symbols
            const expDate = new Date(order.expiration);
            const expStr = expDate.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
            
            const shortStrikeStr = (order.shortStrike * 1000).toFixed(0).padStart(8, '0');
            const longStrikeStr = (order.longStrike * 1000).toFixed(0).padStart(8, '0');

            // Calculate limit price (subtract 5% from net credit or -$0.05, whichever is greater, to encourage fills)
            // IMPORTANT: Use snapToTick with integer arithmetic to avoid IEEE 754 floating-point drift.
            // Raw arithmetic like (netCredit - buffer).toFixed(2) can produce values that fail
            // Tastytrade's server-side `price % 0.05` check (e.g. 9.253 → "9.25" but stored as 9.249999...).
            const { snapToTick, isTrueIndexOption, getOccRoot } = await import('../shared/orderUtils');
            // Resolve the correct OCC root ticker for this expiration.
            // SPX weekly expirations (non-3rd-Friday) must use 'SPXW' as the OCC root.
            // Submitting 'SPX' for a weekly causes: instrument_validation_failed
            const occRoot = getOccRoot(order.symbol, order.expiration);

            // Use occRoot (not order.symbol) for the OCC symbol — critical for SPX weekly options
            // which must use 'SPXW' not 'SPX' as the OCC root ticker.
            const shortCallSymbol = `${occRoot.padEnd(6)}${expStr}C${shortStrikeStr}`;
            const longCallSymbol = `${occRoot.padEnd(6)}${expStr}C${longStrikeStr}`;
            console.log(`[BearCallSpread] OCC symbols: ${shortCallSymbol} / ${longCallSymbol} (root: ${occRoot}, watchlist: ${order.symbol})`);
            const buffer = Math.max(order.netCredit * 0.05, 0.05);
            const rawLimitPrice = Math.max(order.netCredit - buffer, 0.01);
            const limitPrice = snapToTick(rawLimitPrice, order.symbol); // Snap to $0.05 (or $0.01 for penny-pilot)

            // IMPORTANT: For multi-leg SPREAD orders, Tastytrade requires 'Equity Option'
            // for ALL symbols including cash-settled indexes (SPX, SPXW, NDX, NDXP, etc.).
            // Using 'Index Option' in spread legs causes a validation_error: "does not have a valid value".
            // 'Index Option' is only valid for SINGLE-LEG orders (closes, rolls, BTCs).
            // Reference: confirmed via live rejection on 2026-03-20 for SPX BCS order.
            const legInstrumentType: 'Equity Option' = 'Equity Option';

            // Submit two-leg spread order
            const result = await api.submitOrder({
              accountNumber: input.accountNumber,
              timeInForce: 'Day',
              orderType: 'Limit',
              price: limitPrice.toFixed(2),
              priceEffect: 'Credit',
              legs: [
                {
                  instrumentType: legInstrumentType,
                  symbol: shortCallSymbol,
                  quantity: order.quantity.toString(),
                  action: 'Sell to Open',
                },
                {
                  instrumentType: legInstrumentType,
                  symbol: longCallSymbol,
                  quantity: order.quantity.toString(),
                  action: 'Buy to Open',
                },
              ],
            });

            return {
              success: true,
              symbol: order.symbol,
              shortStrike: order.shortStrike,
              longStrike: order.longStrike,
              quantity: order.quantity,
              orderId: result.id,
              message: 'Bear call spread order submitted successfully',
            };
          } catch (error: any) {
            return {
              success: false,
              symbol: order.symbol,
              shortStrike: order.shortStrike,
              longStrike: order.longStrike,
              quantity: order.quantity,
              message: error.message,
            };
          }
        });

        // Wait for batch to complete
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Collect results
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            // Should not happen since we catch errors in the promise
            console.error(`[BearCallSpread] Unexpected batch error:`, result.reason);
          }
        });

        const successCount = results.filter(r => r.success).length;
        console.log(`[BearCallSpread] Batch ${batchIndex + 1}/${totalBatches} complete: ${successCount}/${results.length} successful`);

        // Delay between batches (except after last batch)
        if (batchIndex < totalBatches - 1) {
          console.log(`[BearCallSpread] Waiting ${BATCH_DELAY_MS}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      const finalSuccessCount = results.filter(r => r.success).length;
      console.log(`[BearCallSpread] All batches complete: ${finalSuccessCount}/${results.length} orders submitted successfully`);

      return results;
    }),

  explainCCScore: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        strike: z.number(),
        currentPrice: z.number(),
        premium: z.number(),
        delta: z.number(),
        dte: z.number(),
        weeklyReturn: z.number(),
        distanceOtm: z.number(),
        rsi: z.number().nullable(),
        bbPctB: z.number().nullable(),
        spreadPct: z.number().nullable(),
        score: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { invokeLLM } = await import('./_core/llm');
      const { getSymbolContext } = await import('./ai-context');

      // Fetch full portfolio context for this symbol
      const symbolCtx = await getSymbolContext(ctx.user.id, input.symbol, input.currentPrice);
      
      // Generate concise explanation of the CC score
      const prompt = `You are explaining a Covered Call opportunity's composite score to a trader.

FULL PORTFOLIO CONTEXT (reference cost basis, effective cost basis after premiums, total income history in your explanation):
${symbolCtx.contextBlock}


Opportunity Details:
- Symbol: ${input.symbol}
- Strike: $${input.strike}
- Current Price: $${input.currentPrice}
- Premium: $${input.premium}
- Delta: ${input.delta.toFixed(2)}
- DTE: ${input.dte} days
- Weekly Return: ${input.weeklyReturn.toFixed(2)}%
- Distance OTM: ${input.distanceOtm.toFixed(1)}%
- RSI: ${input.rsi !== null ? input.rsi.toFixed(1) : 'N/A'}
- Bollinger Band %B: ${input.bbPctB !== null ? input.bbPctB.toFixed(2) : 'N/A'}
- Bid-Ask Spread: ${input.spreadPct !== null ? input.spreadPct.toFixed(1) + '%' : 'N/A'}

Composite Score: ${input.score}/100

Scoring Components:
- Weekly Return % (25 points): Higher premium = better
- Delta (20 points): 0.20-0.35 = sweet spot (balance premium vs assignment)
- RSI (15 points): Higher = better for CC (overbought = good time to sell calls)
- Bollinger Band %B (15 points): Higher = better for CC (stock near upper band)
- Distance to Strike % (15 points): Higher = better (more room before assignment)
- Bid-Ask Spread % (10 points): Lower = better (tighter spreads)

Provide a concise explanation (3-4 bullet points + 1 summary sentence) of WHY this Covered Call scored ${input.score}/100.

Focus on:
1. Which components scored well and why (overbought = good for CC)
2. Which components scored poorly and why
3. What this means for the trade's attractiveness

Format:
• [Component]: [Brief explanation]
• [Component]: [Brief explanation]
• [Component]: [Brief explanation]

Summary: [One sentence overall assessment]`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'You are a concise options trading educator. Explain Covered Call scores clearly and briefly.' },
          { role: 'user', content: prompt },
        ],
      });

      const explanation = response.choices[0]?.message?.content || 'Unable to generate explanation';
      
      return {
        symbol: input.symbol,
        strike: input.strike,
        score: input.score,
        explanation,
      };
    }),

  explainBCSScore: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        shortStrike: z.number(),
        longStrike: z.number(),
        currentPrice: z.number(),
        netCredit: z.number(),
        shortDelta: z.number(),
        dte: z.number(),
        rsi: z.number().nullable(),
        bbPctB: z.number().nullable(),
        ivRank: z.number().nullable(),
        score: z.number(),
        scoreBreakdown: z.object({
          technical: z.number(),
          greeks: z.number(),
          premium: z.number(),
          quality: z.number(),
          total: z.number(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { invokeLLM } = await import('./_core/llm');
      const { getSymbolContext } = await import('./ai-context');

      // Fetch full portfolio context for this symbol
      const symbolCtx = await getSymbolContext(ctx.user.id, input.symbol, input.currentPrice);
      
      // Generate concise explanation of the BCS score
      const prompt = `You are explaining a Bear Call Spread opportunity's composite score to a trader.

FULL PORTFOLIO CONTEXT (reference cost basis, effective cost basis after premiums, total income history):
${symbolCtx.contextBlock}


Opportunity Details:
- Symbol: ${input.symbol}
- Short Strike: $${input.shortStrike}
- Long Strike: $${input.longStrike}
- Current Price: $${input.currentPrice}
- Net Credit: $${input.netCredit}
- Short Delta: ${input.shortDelta}
- DTE: ${input.dte} days
- RSI: ${input.rsi !== null ? input.rsi.toFixed(1) : 'N/A'}
- Bollinger Band %B: ${input.bbPctB !== null ? input.bbPctB.toFixed(2) : 'N/A'}
- IV Rank: ${input.ivRank !== null ? input.ivRank.toFixed(1) : 'N/A'}

Composite Score: ${input.score}/100
Breakdown:
- Technical Setup (RSI + BB - OVERBOUGHT): ${input.scoreBreakdown.technical}/40
- Greeks & Spread Efficiency: ${input.scoreBreakdown.greeks}/30
- Premium Quality (Credit/Width Ratio): ${input.scoreBreakdown.premium}/20
- Stock Quality (Mag 7 + Liquidity): ${input.scoreBreakdown.quality}/10

Provide a concise explanation (3-4 bullet points + 1 summary sentence) of WHY this Bear Call Spread scored ${input.score}/100.

Focus on:
1. Which components scored well and why (overbought = good for BCS)
2. Which components scored poorly and why
3. What this means for the trade's attractiveness

Format:
• [Component]: [Brief explanation]
• [Component]: [Brief explanation]
• [Component]: [Brief explanation]

Summary: [One sentence overall assessment]`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'You are a concise options trading educator. Explain Bear Call Spread scores clearly and briefly.' },
          { role: 'user', content: prompt },
        ],
      });

      const explanation = response.choices[0]?.message?.content || 'Unable to generate explanation';
      
      return {
        symbol: input.symbol,
        shortStrike: input.shortStrike,
        longStrike: input.longStrike,
        score: input.score,
        explanation,
      };
    }),
});

/**
 * Calculate CC Composite Score v3 (0-100)
 *
 * Weights: D1 Liquidity 15 | D2 Probability Fit 25 | D3 Premium Efficiency 20
 *          D4 IV Richness 10 | D5 Strike Safety 20 | D6 Technical Context 10
 *
 * Philosophy: CC goal is expire-worthless income. Delta selection (D2) and
 * strike safety (D5) are the most critical dimensions. Technical context (D6)
 * and IV richness (D4) are useful but secondary.
 *
 * Bonus: +2/+4/+5 pts for basis recovery ≥80%/90%/95% (capped at 100 total).
 */
function calculateCCScore(opp: any): { score: number; breakdown: Record<string, number | null> } {
  // D1: Liquidity (15 pts)
  let d1 = 0;
  const bid = opp.bid || 0;
  const ask = opp.ask || 0;
  const mid = (bid + ask) / 2;
  const sp  = mid > 0 ? ((ask - bid) / mid) * 100 : 100;
  const oi  = opp.openInterest ?? 0;
  const vol = opp.volume ?? 0;
  if (sp <= 1)       d1 += 6;   else if (sp <= 2)  d1 += 5.1;
  else if (sp <= 5)  d1 += 3.6; else if (sp <= 10) d1 += 1.8;
  else if (sp <= 20) d1 += 0.6;
  if (oi >= 1000)     d1 += 6;   else if (oi >= 500) d1 += 5.1;
  else if (oi >= 200) d1 += 3.9; else if (oi >= 100) d1 += 2.7;
  else if (oi >= 50)  d1 += 1.5; else if (oi >= 10)  d1 += 0.6;
  else if (oi === 0)  d1 -= 4.5;
  if (vol >= 500)      d1 += 3;    else if (vol >= 200) d1 += 2.25;
  else if (vol >= 50)  d1 += 1.2;  else if (vol >= 10)  d1 += 0.45;
  d1 = Math.max(0, Math.min(15, d1));

  // D2: Probability Fit (25 pts) — delta + DTE
  // Peak reward at delta 0.15–0.25 (expire-worthless sweet spot for CC)
  // Delta > 0.35 is penalised more aggressively than before
  let d2 = 0;
  const delta = Math.abs(opp.delta || 0);
  const dte   = opp.dte || 0;
  if (delta >= 0.15 && delta <= 0.25)       d2 += 13;  // sweet spot — expire worthless
  else if (delta > 0.25 && delta <= 0.30)   d2 += 11;  // slightly aggressive but ok
  else if (delta >= 0.10 && delta < 0.15)   d2 += 9;   // conservative — low premium risk
  else if (delta > 0.30 && delta <= 0.35)   d2 += 8;   // borderline aggressive
  else if (delta > 0.35 && delta <= 0.40)   d2 += 5;   // too aggressive for expire-worthless
  else if (delta >= 0.05 && delta < 0.10)   d2 += 4;   // too far OTM — poor premium
  else if (delta > 0.40 && delta <= 0.50)   d2 += 3;   // high assignment risk
  else                                       d2 += 1;
  if (dte >= 7 && dte <= 14)       d2 += 12; else if (dte >= 15 && dte <= 21) d2 += 9;
  else if (dte >= 22 && dte <= 30) d2 += 6;  else if (dte >= 31 && dte <= 45) d2 += 3;
  else                             d2 += 0.5;
  d2 = Math.max(0, Math.min(25, d2));

  // D3: Premium Efficiency (20 pts) — weekly return % on stock value
  let d3 = 0;
  const weekly = opp.weeklyReturn || 0;
  if (weekly >= 1.5)       d3 = 20;  else if (weekly >= 1.0)  d3 = 16;
  else if (weekly >= 0.75) d3 = 13;  else if (weekly >= 0.50) d3 = 8;
  else if (weekly >= 0.30) d3 = 4;
  d3 = Math.max(0, Math.min(20, d3));

  // D4: IV Richness (10 pts) — IV Rank (reduced from 15; secondary to delta/strike)
  let d4 = 0;
  const ivRank = opp.ivRank;
  if (ivRank !== null && ivRank !== undefined) {
    if (ivRank >= 70)      d4 = 10;           // very elevated IV
    else if (ivRank >= 50) d4 = 10 * 0.85;    // elevated — good for selling
    else if (ivRank >= 35) d4 = 10 * 0.70;    // moderate-high
    else if (ivRank >= 25) d4 = 10 * 0.55;    // moderate
    else if (ivRank >= 15) d4 = 10 * 0.35;    // below average
    else if (ivRank >= 8)  d4 = 10 * 0.18;    // low
    else                   d4 = 10 * 0.05;    // very low
  } else { d4 = 10 * 0.50; } // neutral when unknown

  // D5: Strike Safety (20 pts) — OTM distance vs 1-sigma expected move
  // Increased from 15 to 20: strike placement is critical for expire-worthless goal
  let d5 = 0;
  let ccSafetyRatio: number | null = null;
  const distPct = opp.distanceOtm || 0;
  const ivForD5 = opp.iv ?? null;
  if (ivForD5 && ivForD5 > 0 && opp.currentPrice > 0) {
    const em = opp.currentPrice * (ivForD5 / 100) * Math.sqrt(dte / 365);
    const emPct = (em / opp.currentPrice) * 100;
    ccSafetyRatio = emPct > 0 ? distPct / emPct : null;
    const ratio = ccSafetyRatio ?? 0;
    if (ratio >= 1.5)       d5 = 20;           // well beyond EM — very safe
    else if (ratio >= 1.0)  d5 = 20 * 0.85;    // at or beyond EM
    else if (ratio >= 0.75) d5 = 20 * 0.75;    // 75% of EM — good
    else if (ratio >= 0.55) d5 = 20 * 0.62;    // typical delta-0.20 zone
    else if (ratio >= 0.40) d5 = 20 * 0.48;    // delta-0.25 zone
    else if (ratio >= 0.25) d5 = 20 * 0.30;    // close to ATM
    else                    d5 = 20 * 0.12;    // very close to ATM — risky
  } else {
    if (distPct >= 12)       d5 = 20;  else if (distPct >= 8)  d5 = 20 * 0.80;
    else if (distPct >= 5)   d5 = 20 * 0.65; else if (distPct >= 3) d5 = 20 * 0.45;
    else if (distPct >= 1.5) d5 = 20 * 0.25; else d5 = 20 * 0.10;
  }
  d5 = Math.max(0, Math.min(20, d5));

  // D6: Technical Context (10 pts) — RSI + BB %B (overbought preferred for CC)
  // Reduced from 15 to 10: technical context is useful but secondary to delta/strike
  let d6 = 0;
  const rsi = opp.rsi;
  const bb  = opp.bbPctB;
  const rsiMax = 5;   // was 7.5
  const bbMax  = 5;   // was 7.5
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 70)       d6 += rsiMax;           // overbought — ideal for CC
    else if (rsi > 60)  d6 += rsiMax * 0.85;
    else if (rsi > 50)  d6 += rsiMax * 0.65;    // neutral-high
    else if (rsi > 40)  d6 += rsiMax * 0.50;    // neutral
    else if (rsi > 30)  d6 += rsiMax * 0.25;    // mildly oversold — poor for CC
    // ≤30 = 0 (oversold — avoid CC)
  } else { d6 += rsiMax * 0.55; }
  if (bb !== null && bb !== undefined) {
    if (bb > 0.85)      d6 += bbMax;            // near upper band — ideal for CC
    else if (bb > 0.70) d6 += bbMax * 0.85;
    else if (bb > 0.50) d6 += bbMax * 0.65;     // upper half
    else if (bb > 0.30) d6 += bbMax * 0.50;     // mid-range
    else if (bb > 0.15) d6 += bbMax * 0.25;     // lower half — poor for CC
    // ≤0.15 = 0 (near lower band — avoid CC)
  } else { d6 += bbMax * 0.55; }
  d6 = Math.max(0, Math.min(10, d6));

  // Basis Recovery Bonus (0, +2, +4, or +5 pts)
  // Rewards positions where substantial premium has already been collected,
  // making being called away acceptable or even desirable.
  let basisBonus = 0;
  const basisRecoveryPct = opp.basisRecoveryPct ?? null;
  if (basisRecoveryPct !== null) {
    if (basisRecoveryPct >= 95)      basisBonus = 5;  // called away = full win
    else if (basisRecoveryPct >= 90) basisBonus = 4;  // called away = strong win
    else if (basisRecoveryPct >= 80) basisBonus = 2;  // called away = acceptable
  }

  const rawTotal = d1 + d2 + d3 + d4 + d5 + d6 + basisBonus;
  const total = Math.round(Math.min(100, rawTotal));
  return {
    score: total,
    breakdown: {
      d1Liquidity: Math.round(d1), d2ProbabilityFit: Math.round(d2),
      d3PremiumEfficiency: Math.round(d3), d4IVRichness: Math.round(d4),
      d5StrikeSafety: Math.round(d5), d6Technical: Math.round(d6),
      basisBonus: Math.round(basisBonus),
      safetyRatio: ccSafetyRatio,
      total,
    },
  };
}
