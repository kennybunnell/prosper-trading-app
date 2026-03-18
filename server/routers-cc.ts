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

      // Live mode - fetch from Tastytrade
      const { getApiCredentials } = await import('./db');
      const { getTastytradeAPI } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials);

      // Fetch all positions
      const positions = await api.getPositions(input.accountNumber);

      // Fetch working orders to account for pending short calls
      const workingOrders = await api.getWorkingOrders(input.accountNumber);

      // Separate stock positions and option positions
      // Tastytrade API returns hyphenated field names like 'instrument-type', not camelCase
      // ⛔ Exclude cash-settled European-style indexes — no stock assignment, cannot write covered calls
      const stockPositions = positions
        .filter((p: any) => p['instrument-type'] === 'Equity')
        .filter((p: any) => !CASH_SETTLED_INDEXES.has((p.symbol as string).toUpperCase()));
      // Include both 'Equity Option' and 'Index Option' (e.g., SPXW, NDXP, MRUT)
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
          const underlying = (opt as any)['underlying-symbol'] as string;
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
      const workingShortCalls: Record<string, { contracts: number; details: any[] }> = {};
      for (const order of workingOrders) {
        // Check if order has legs (multi-leg orders)
        const legs = (order as any).legs || [];
        for (const leg of legs) {
          // Short calls: action = "Sell to Open" and instrument type = "Equity Option" and symbol contains 'C'
          if (leg.action === 'Sell to Open' && (leg['instrument-type'] === 'Equity Option' || leg['instrument-type'] === 'Index Option') && leg.symbol.includes('C')) {
            const underlying = (order as any)['underlying-symbol'];
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

      // Live mode — fetch all accounts then scan in parallel
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }
      const api = await authenticateTastytrade(credentials);
      const allAccounts = await api.getAccounts();
      const accountNumbers: string[] = allAccounts.map((a: any) => a.accountNumber || a['account-number']);

      // Per-account: fetch positions + working orders in parallel
      const perAccountResults = await Promise.allSettled(
        accountNumbers.map(async (acctNum: string) => {
          const [positions, workingOrders] = await Promise.all([
            api.getPositions(acctNum),
            api.getWorkingOrders(acctNum).catch(() => [] as any[]),
          ]);
          return { acctNum, positions, workingOrders };
        })
      );

      // Merged maps across all accounts
      const shortCallsAll: Record<string, { contracts: number; details: any[] }> = {};
      const workingShortCallsAll: Record<string, { contracts: number; details: any[] }> = {};
      const stockMap: Record<string, { quantity: number; currentPrice: number; accounts: string[] }> = {};
      let totalRawPositions = 0;

      for (const result of perAccountResults) {
        if (result.status === 'rejected') continue;
        const { acctNum, positions, workingOrders } = result.value;
         totalRawPositions += positions.length;
        // ⛔ Exclude cash-settled European-style indexes — no stock assignment, cannot write covered calls
        const stockPositions = positions
          .filter((p: any) => p['instrument-type'] === 'Equity')
          .filter((p: any) => !CASH_SETTLED_INDEXES.has((p.symbol as string).toUpperCase()));
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
          const underlying = (opt as any)['underlying-symbol'] as string;
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
          console.log(`[CC getEligible] ${acctNum}:${underlying}: short=${JSON.stringify(shortByExpiry)}, long=${JSON.stringify(longByExpiry)}, nakedCCs=${nakedCount}`);
        }

        // Accumulate short calls from working orders
        for (const order of workingOrders) {
          for (const leg of ((order as any).legs || [])) {
            if (leg.action === 'Sell to Open' &&
                (leg['instrument-type'] === 'Equity Option' || leg['instrument-type'] === 'Index Option') &&
                leg.symbol.includes('C')) {
              const underlying = (order as any)['underlying-symbol'];
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
          if (!stockMap[sym]) {
            stockMap[sym] = { quantity: 0, currentPrice: 0, accounts: [] };
          }
          stockMap[sym].quantity += qty;
          if (price > 0 && stockMap[sym].currentPrice === 0) stockMap[sym].currentPrice = price;
          if (!stockMap[sym].accounts.includes(acctNum)) stockMap[sym].accounts.push(acctNum);
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
        return {
          symbol,
          quantity,
          currentPrice,
          marketValue: quantity * currentPrice,
          existingContracts,
          workingContracts,
          sharesCovered,
          availableShares,
          maxContracts,
          hasExistingCalls: existingContracts > 0,
          hasWorkingOrders: workingContracts > 0,
          accounts,
        };
      });

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

      // Check rate limit for Tier 1 users (owner/admin bypass automatically)
      const rateLimit = await checkRateLimit(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);
      if (!rateLimit.allowed) {
        throw new Error(rateLimit.message || 'Rate limit exceeded');
      }

      const credentials = await getApiCredentials(ctx.user.id);
      
      // Determine if user can use system API key (only free trial users)
      const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
      const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
      
      if (!tradierApiKey) {
        if (isFreeTrialUser) {
          throw new Error('System Tradier API key not configured. Please contact support.');
        } else {
          throw new Error('Please configure your Tradier API key in Settings to access live market data.');
        }
      }

      const api = createTradierAPI(tradierApiKey);
      const opportunities: any[] = [];

      // Build holdings map for quick lookup
      const holdingsMap = new Map(
        input.holdings.map(h => [h.symbol, h])
      );

      // Determine if we're in bear call spread mode (no holdings provided)
      const isBearCallSpreadMode = input.holdings.length === 0;
      console.log(`[CC Scanner] Mode: ${isBearCallSpreadMode ? 'Bear Call Spread (no holdings required)' : 'Covered Call (requires holdings)'}`);

      // Process symbols in parallel with concurrency limit of 5 (matches CSP Dashboard)
      const CONCURRENCY = 5;
      const API_TIMEOUT_MS = 15000; // 15 second timeout per API call (increased for spread scanning)
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

      // Calculate composite scores for all opportunities
      const scoredOpportunities = deduplicatedOpportunities.map(opp => ({
        ...opp,
        score: calculateCCScore(opp),
      }));

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

      // Increment scan count for Tier 1 users (after successful scan)
      await incrementScanCount(ctx.user.id, ctx.user.subscriptionTier, ctx.user.role);

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
        isIndexMode: z.boolean().optional(), // true when scanning index products
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');
      const { calculateBearCallSpread } = await import('./bear-call-pricing');

      const credentials = await getApiCredentials(ctx.user.id);
      
      // Determine if user can use system API key (only free trial users)
      const isFreeTrialUser = ctx.user.subscriptionTier === 'free_trial';
      const tradierApiKey = credentials?.tradierApiKey || (isFreeTrialUser ? process.env.TRADIER_API_KEY : null);
      
      if (!tradierApiKey) {
        if (isFreeTrialUser) {
          throw new Error('System Tradier API key not configured. Please contact support.');
        } else {
          throw new Error('Please configure your Tradier API key in Settings to access live market data.');
        }
      }

      const api = createTradierAPI(tradierApiKey);
      const spreadOpportunities: any[] = [];

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
      const getEffectiveSpreadWidth = (price: number): number => {
        if (price < 500) return input.spreadWidth; // equity: use user input
        const autoWidth = Math.max(input.spreadWidth, Math.round((price * 0.004) / 5) * 5);
        return autoWidth;
      };

      // Process each group (fetch option chain once, process all strikes)
      const CONCURRENCY_LIMIT = 5; // Process 5 groups at a time
      const API_TIMEOUT_MS = 15000; // 15 second timeout per API call
      
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
                // Auto-scale spread width for index symbols
                const effectiveWidth = getEffectiveSpreadWidth(ccOpp.currentPrice || 0);
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
                  const { score, breakdown } = calculateBCSScore(spreadOpp, { isIndexMode: input.isIndexMode ?? false });
                  spreadOpp.score = score;
                  (spreadOpp as any).scoreBreakdown = breakdown;
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
      const { getTastytradeAPI } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials);

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
          .filter((p: any) => !CASH_SETTLED_INDEXES.has((p.symbol as string).toUpperCase()));
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

      // Filter out orders where maxContracts is insufficient (prevents uncovered options)
      const filteredOrders = resolvedOrders.filter(order => {
        const key = `${order.effectiveAccount}:${order.symbol}`;
        const maxContracts = maxContractsMap[key] ?? 0;
        if (order.quantity > maxContracts) {
          console.log(`[CC submitOrders] FILTERED OUT ${order.effectiveAccount}:${order.symbol}: Requested ${order.quantity} contracts but only ${maxContracts} available (would be uncovered)`);
          return false;
        }
        return true;
      });

      // If all orders were filtered out, return error
      if (filteredOrders.length === 0) {
        throw new Error('All orders filtered out: insufficient shares to cover requested contracts. Please ensure you have at least 100 shares per contract.');
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
        } catch (error: any) {
          results.push({
            success: false,
            symbol: order.symbol,
            strike: order.strike,
            quantity: order.quantity,
          message: error.message,
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
      const { getTastytradeAPI } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade OAuth2 credentials not configured. Please add them in Settings.');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials);

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
            
            const shortCallSymbol = `${order.symbol.padEnd(6)}${expStr}C${shortStrikeStr}`;
            const longCallSymbol = `${order.symbol.padEnd(6)}${expStr}C${longStrikeStr}`;

            // Calculate limit price (subtract 5% from net credit or -$0.05, whichever is greater, to encourage fills)
            // IMPORTANT: Use snapToTick with integer arithmetic to avoid IEEE 754 floating-point drift.
            // Raw arithmetic like (netCredit - buffer).toFixed(2) can produce values that fail
            // Tastytrade's server-side `price % 0.05` check (e.g. 9.253 → "9.25" but stored as 9.249999...).
            const { snapToTick, isTrueIndexOption } = await import('../shared/orderUtils');
            const buffer = Math.max(order.netCredit * 0.05, 0.05);
            const rawLimitPrice = Math.max(order.netCredit - buffer, 0.01);
            const limitPrice = snapToTick(rawLimitPrice, order.symbol); // Snap to $0.05 (or $0.01 for penny-pilot)

            // CRITICAL: Cash-settled index options (SPX, SPXW, NDX, NDXP, RUT, MRUT, etc.)
            // require 'Index Option' as the instrument type. Sending 'Equity Option' causes
            // Order_disallowed_by_exchange_rules rejection from CBOE/Nasdaq.
            const legInstrumentType: 'Index Option' | 'Equity Option' =
              isTrueIndexOption(order.symbol) ? 'Index Option' : 'Equity Option';

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
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');
      
      // Generate concise explanation of the CC score
      const prompt = `You are explaining a Covered Call opportunity's composite score to a trader.

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
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');
      
      // Generate concise explanation of the BCS score
      const prompt = `You are explaining a Bear Call Spread opportunity's composite score to a trader.

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
 * Calculate CC Composite Score (0-100)
 * 
 * Weighting:
 * - Weekly Return % (25%): Higher = Better
 * - Delta (20%): 0.20-0.35 = Best (balance premium vs getting called)
 * - RSI (15%): Higher = Better for CC (overbought = good time to sell calls)
 * - BB %B (15%): Higher = Better for CC (stock near upper band)
 * - Distance to Strike % (15%): Higher = Better (more room before assignment)
 * - Spread % (10%): Lower = Better (tighter spreads)
 */
function calculateCCScore(opp: any): number {
  let score = 0;

  // 1. Weekly Return % (25 points) - Scale 0.3% to 2.0%
  const weekly = opp.weeklyReturn || 0;
  if (weekly >= 2.0) {
    score += 25;
  } else if (weekly >= 0.3) {
    score += 25 * ((weekly - 0.3) / 1.7);
  }

  // 2. Delta (20 points) - Sweet spot around 0.20-0.35
  const delta = Math.abs(opp.delta || 0);
  if (delta >= 0.20 && delta <= 0.35) {
    score += 20; // Perfect range
  } else if (delta >= 0.15 && delta <= 0.40) {
    score += 15; // Good range
  } else if (delta >= 0.10 && delta <= 0.50) {
    score += 10; // Acceptable
  } else {
    score += 5; // Outside ideal range
  }

  // 3. RSI (15 points) - Higher is better for CC (overbought)
  const rsi = opp.rsi;
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 70) {
      score += 15; // Overbought - excellent for selling calls
    } else if (rsi > 60) {
      score += 12;
    } else if (rsi > 50) {
      score += 9;
    } else if (rsi > 40) {
      score += 6;
    } else if (rsi > 30) {
      score += 3;
    }
    // < 30 = 0 points (oversold - bad for selling calls)
  } else {
    score += 7; // Neutral if no data
  }

  // 4. BB %B (15 points) - Higher is better for CC
  const bb = opp.bbPctB;
  if (bb !== null && bb !== undefined) {
    if (bb > 0.8) {
      score += 15; // Near upper band - excellent
    } else if (bb > 0.7) {
      score += 12;
    } else if (bb > 0.5) {
      score += 9;
    } else if (bb > 0.3) {
      score += 6;
    } else if (bb > 0.2) {
      score += 3;
    }
    // < 0.2 = 0 points (near lower band)
  } else {
    score += 7; // Neutral if no data
  }

  // 5. Distance to Strike % (15 points) - Higher is better
  const distancePct = opp.distanceOtm || 0;
  if (distancePct > 10) {
    score += 15;
  } else if (distancePct > 7) {
    score += 12;
  } else if (distancePct > 5) {
    score += 9;
  } else if (distancePct > 3) {
    score += 6;
  } else if (distancePct > 1) {
    score += 3;
  }
  // < 1% = 0 points (too close)

  // 6. Spread % (10 points) - Lower is better
  const spread = opp.spreadPct;
  if (spread !== null && spread !== undefined) {
    if (spread <= 1) {
      score += 10;
    } else if (spread <= 2) {
      score += 8;
    } else if (spread <= 5) {
      score += 5;
    } else if (spread <= 10) {
      score += 2;
    }
    // > 10% = 0 points
  } else {
    score += 5; // Neutral if no data
  }

  return Math.round(score);
}
