import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getApiCredentials } from "./db";
import { getTastytradeAPI } from "./tastytrade";

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
  currentPrice: number;
  realizedPercent: number;
  action: 'CLOSE' | 'WATCH' | 'HOLD';
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

      console.log(`[Performance] Fetching overview for account ${accountId}, ${monthsBack} months back`);

      // Get API credentials
      const credentials = await getApiCredentials(userId);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade API credentials not configured',
        });
      }

      // Get Tastytrade API instance
      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

      // Get accounts
      const accounts = await api.getAccounts();
      let accountNumbers: string[] = [];
      if (accountId === 'ALL_ACCOUNTS') {
        accountNumbers = accounts.map(acc => acc.account['account-number']);
      } else {
        accountNumbers = [accountId];
      }

      // Calculate date range (last N months)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      console.log(`[Performance] Date range: ${startDateStr} to ${endDateStr}`);

      // Fetch transactions for all accounts
      const allTransactions: any[] = [];
      for (const accountNumber of accountNumbers) {
        try {
          const transactions = await api.getTransactionHistory(
            accountNumber,
            startDateStr,
            endDateStr,
            1000
          );
          allTransactions.push(...transactions);
          console.log(`[Performance] Fetched ${transactions.length} transactions for ${accountNumber}`);
        } catch (error: any) {
          console.error(`[Performance] Error fetching transactions for ${accountNumber}:`, error.message);
          // Continue with other accounts
        }
      }

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
      const { aggregateMonthlyData, aggregateBySymbol, calculatePerformanceMetrics } = await import('./lib/performance-utils');

      // Aggregate data
      const monthlyData = aggregateMonthlyData(allTransactions);
      const symbolPerformance = aggregateBySymbol(allTransactions);
      const performanceMetrics = calculatePerformanceMetrics(allTransactions, monthlyData);

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

      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade credentials not configured. Please add them in Settings.',
        });
      }

      // Initialize Tastytrade API
      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

      // Get accounts
      const accounts = await api.getAccounts();
      if (!accounts || accounts.length === 0) {
        return {
          positions: [],
          summary: {
            openPositions: 0,
            totalPremiumAtRisk: 0,
            avgRealizedPercent: 0,
            readyToClose: 0,
          },
        };
      }

      // Determine which accounts to fetch from
      let accountsToFetch: string[] = [];
      if (accountId === 'ALL_ACCOUNTS') {
        // Fetch from all accounts
        accountsToFetch = accounts.map(acc => acc.account["account-number"]);
        console.log(`[Performance] Fetching from all ${accountsToFetch.length} accounts:`, accountsToFetch);
      } else {
        // Fetch from single account
        const accountNumber = accountId || accounts[0].account["account-number"];
        accountsToFetch = [accountNumber];
        console.log(`[Performance] Fetching positions for account: ${accountNumber}`);
      }

      try {
        // Fetch positions from all selected accounts in parallel
        const positionsArrays = await Promise.all(
          accountsToFetch.map(async (accNum) => {
            try {
              const positions = await api.getPositions(accNum);
              // Tag each position with its account number
              return positions.map((pos: any) => ({ ...pos, _accountNumber: accNum }));
            } catch (error) {
              console.error(`[Performance] Error fetching positions for account ${accNum}:`, error);
              return [];
            }
          })
        );
        const positions = positionsArrays.flat();
        console.log(`[Performance] Retrieved ${positions.length} total positions`);
        
        // Log first position for debugging
        if (positions.length > 0) {
          console.log('[Performance] Sample position:', JSON.stringify(positions[0], null, 2));
        }
        
        // Filter for short option positions only
        const shortOptions = positions.filter((pos) => {
          const isOption = pos['instrument-type'] === 'Equity Option';
          const isShort = pos['quantity-direction'] === 'Short';
          return isOption && isShort;
        });
        console.log(`[Performance] Found ${shortOptions.length} short option positions`);
        
        // If no short options found, log all instrument types and quantity directions
        if (shortOptions.length === 0 && positions.length > 0) {
          const types = positions.map(p => `${p['instrument-type']}|${p['quantity-direction']}|qty:${p.quantity}`);
          console.log('[Performance] All position types (first 10):', types.slice(0, 10));
        }

        // Process each position
        const processedPositions: ProcessedPosition[] = [];
        
        for (const pos of shortOptions) {
          // Determine if CSP or CC by parsing option symbol
          const isPut = pos.symbol.includes('P');
          const optionType = isPut ? 'CSP' : 'CC';
          
          // Skip if filtering by position type
          if (positionType && optionType.toLowerCase() !== positionType) {
            continue;
          }

          // Calculate premium received and current cost
          const quantity = Math.abs(pos.quantity);
          const premiumReceived = Math.abs(parseFloat(pos['average-open-price'])) * quantity * pos.multiplier;
          const currentCost = parseFloat(pos['close-price']) * quantity * pos.multiplier;
          
          // Calculate premium realization %
          const realizedPercent = premiumReceived > 0 
            ? ((premiumReceived - currentCost) / premiumReceived) * 100 
            : 0;

          // Skip if below minimum realized percent filter
          if (minRealizedPercent !== undefined && realizedPercent < minRealizedPercent) {
            continue;
          }

          // Parse strike from option symbol (e.g., "AAPL250117P00150000" -> 150)
          const strikeMatch = pos.symbol.match(/[CP](\d+)/);
          const strike = strikeMatch ? parseFloat(strikeMatch[1]) / 1000 : 0;

          // Calculate DTE
          const expirationDate = pos['expires-at'] ? new Date(pos['expires-at']) : new Date();
          const today = new Date();
          const dte = Math.max(0, Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

          // Determine action recommendation
          let action: 'CLOSE' | 'WATCH' | 'HOLD' = 'HOLD';
          if (realizedPercent >= 80) {
            action = 'CLOSE';
          } else if (realizedPercent >= 50 || dte <= 7) {
            action = 'WATCH';
          }

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
            currentPrice: parseFloat(pos['close-price']),
            realizedPercent: Math.round(realizedPercent * 100) / 100, // Round to 2 decimals
            action,
          });
        }

        // Calculate summary statistics
        const openPositions = processedPositions.length;
        const totalPremiumAtRisk = processedPositions.reduce((sum, pos) => sum + pos.premium, 0);
        const avgRealizedPercent = openPositions > 0
          ? processedPositions.reduce((sum, pos) => sum + pos.realizedPercent, 0) / openPositions
          : 0;
        const readyToClose = processedPositions.filter(pos => pos.action === 'CLOSE').length;

        console.log(`[Performance] Processed ${processedPositions.length} positions, ${readyToClose} ready to close`);

        return {
          positions: processedPositions,
          summary: {
            openPositions,
            totalPremiumAtRisk,
            avgRealizedPercent: Math.round(avgRealizedPercent * 100) / 100,
            readyToClose,
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
      })),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const { positions, dryRun } = input;

      // Get Tastytrade credentials
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeUsername || !credentials?.tastytradePassword) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade credentials not configured. Please add them in Settings.',
        });
      }

      // Initialize Tastytrade API
      const api = getTastytradeAPI();
      await api.login(credentials.tastytradeUsername, credentials.tastytradePassword);

      console.log(`[Performance] ${dryRun ? 'Dry run' : 'Submitting'} close orders for ${positions.length} position(s)`);

      // Submit orders for each position
      const results = [];
      for (const pos of positions) {
        console.log(`[Performance] Processing ${pos.underlying} $${pos.strike} (${pos.quantity} contracts)`);
        
        const result = await api.buyToCloseOption(
          pos.accountId,
          pos.optionSymbol,
          pos.quantity,
          pos.currentPrice,
          dryRun
        );

        results.push({
          ...result,
          underlying: pos.underlying,
          strike: pos.strike,
          quantity: pos.quantity,
        });
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
        },
      };
    }),
});
