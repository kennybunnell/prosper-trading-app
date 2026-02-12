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
  hasWorkingOrder: boolean;
  // Spread-specific fields
  spreadType?: 'bull_put' | 'bear_call';
  longStrike?: number;
  spreadWidth?: number;
  capitalAtRisk?: number;
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
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade API credentials not configured',
        });
      }

      // Get Tastytrade API instance
      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials);

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
      const api = await authenticateTastytrade(credentials);

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
        
        // Filter for option positions (both short and long)
        const optionPositions = positions.filter((pos) => {
          return pos['instrument-type'] === 'Equity Option';
        });
        console.log(`[Performance] Found ${optionPositions.length} option positions`);
        
        // Separate short and long positions
        const shortOptions = optionPositions.filter(pos => pos['quantity-direction'] === 'Short');
        const longOptions = optionPositions.filter(pos => pos['quantity-direction'] === 'Long');
        console.log(`[Performance] ${shortOptions.length} short, ${longOptions.length} long`);
        
        // Build a map of long positions by key (underlying + expiration + strike + type)
        const longPositionMap = new Map<string, any>();
        for (const longPos of longOptions) {
          const isPut = longPos.symbol.includes('P');
          const strikeMatch = longPos.symbol.match(/[CP](\d+)/);
          const strike = strikeMatch ? parseFloat(strikeMatch[1]) / 1000 : 0;
          const key = `${longPos['underlying-symbol']}_${longPos['expires-at']}_${strike}_${isPut ? 'P' : 'C'}`;
          longPositionMap.set(key, longPos);
        }
        console.log(`[Performance] Built map of ${longPositionMap.size} long positions`);
        
        // If no short options found, log all instrument types and quantity directions
        if (shortOptions.length === 0 && positions.length > 0) {
          const types = positions.map(p => `${p['instrument-type']}|${p['quantity-direction']}|qty:${p.quantity}`);
          console.log('[Performance] All position types (first 10):', types.slice(0, 10));
        }

        // Fetch working orders for all accounts to mark positions
        // Only include LIVE orders (exclude Filled, Cancelled, Rejected, Expired)
        const workingOrderSymbols = new Set<string>();
        for (const accNum of accountsToFetch) {
          try {
            const workingOrders = await api.getWorkingOrders(accNum);
            for (const order of workingOrders) {
              // Only count orders with Live status
              if (order.status === 'Live' && order.legs) {
                for (const leg of order.legs) {
                  if (leg.symbol) {
                    workingOrderSymbols.add(leg.symbol);
                  }
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
        
        // Fetch current quotes for all options
        console.log(`[Performance] Fetching quotes for ${allOptionSymbols.size} option symbols`);
        const quotes = await api.getOptionQuotesBatch(Array.from(allOptionSymbols));
        console.log(`[Performance] Retrieved ${Object.keys(quotes).length} quotes`);

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

          // Calculate premium received
          const quantity = Math.abs(pos.quantity);
          const premiumReceived = Math.abs(parseFloat(pos['average-open-price'])) * quantity * pos.multiplier;
          
          // Get current price from live quote (fallback to close-price if quote unavailable)
          const quote = quotes[pos.symbol];
          const currentPrice = quote ? quote.mark || quote.mid || quote.last : parseFloat(pos['close-price']);
          let currentCost = currentPrice * quantity * pos.multiplier;
          
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

          // Check for matching long position (spread detection)
          let spreadType: 'bull_put' | 'bear_call' | undefined;
          let longStrike: number | undefined;
          let spreadWidth: number | undefined;
          let capitalAtRisk: number | undefined;
          
          // Look for a long position with same underlying, expiration, and option type
          // For bull put spread: short put at higher strike + long put at lower strike
          // For bear call spread: short call at lower strike + long call at higher strike
          for (const [key, longPos] of Array.from(longPositionMap.entries())) {
            if (longPos['underlying-symbol'] === pos['underlying-symbol'] &&
                longPos['expires-at'] === pos['expires-at']) {
              const longIsPut = longPos.symbol.includes('P');
              if (longIsPut === isPut) {
                // Same option type - potential spread
                const longStrikeMatch = longPos.symbol.match(/[CP](\d+)/);
                const longStrikeValue = longStrikeMatch ? parseFloat(longStrikeMatch[1]) / 1000 : 0;
                
                if (isPut && longStrikeValue < strike) {
                  // Bull put spread: short higher strike, long lower strike
                  spreadType = 'bull_put';
                  longStrike = longStrikeValue;
                  spreadWidth = strike - longStrikeValue;
                  
                  // Capital at risk = spread width - net credit
                  const longCost = Math.abs(parseFloat(longPos['average-open-price'])) * quantity * longPos.multiplier;
                  const netCredit = premiumReceived - longCost;
                  capitalAtRisk = (spreadWidth * 100 * quantity) - netCredit;
                  
                  // Recalculate current cost for spread using both legs' current prices
                  const longQuote = quotes[longPos.symbol];
                  const longCurrentPrice = longQuote ? longQuote.mark || longQuote.mid || longQuote.last : parseFloat(longPos['close-price']);
                  const shortCurrentCost = currentPrice * quantity * pos.multiplier;
                  const longCurrentCost = longCurrentPrice * quantity * longPos.multiplier;
                  // For spread: current cost = (short leg cost - long leg cost) because we pay to close short and receive to close long
                  currentCost = shortCurrentCost - longCurrentCost;
                  
                  console.log(`[Performance] Detected bull put spread: ${pos['underlying-symbol']} ${strike}/${longStrike} (${spreadWidth}pt width, $${capitalAtRisk.toFixed(2)} at risk, current spread value: $${currentCost.toFixed(2)})`);
                } else if (!isPut && longStrikeValue > strike) {
                  // Bear call spread: short lower strike, long higher strike
                  spreadType = 'bear_call';
                  longStrike = longStrikeValue;
                  spreadWidth = longStrikeValue - strike;
                  
                  // Capital at risk = spread width - net credit
                  const longCost = Math.abs(parseFloat(longPos['average-open-price'])) * quantity * longPos.multiplier;
                  const netCredit = premiumReceived - longCost;
                  capitalAtRisk = (spreadWidth * 100 * quantity) - netCredit;
                  
                  // Recalculate current cost for spread using both legs' current prices
                  const longQuote = quotes[longPos.symbol];
                  const longCurrentPrice = longQuote ? longQuote.mark || longQuote.mid || longQuote.last : parseFloat(longPos['close-price']);
                  const shortCurrentCost = currentPrice * quantity * pos.multiplier;
                  const longCurrentCost = longCurrentPrice * quantity * longPos.multiplier;
                  // For spread: current cost = (short leg cost - long leg cost)
                  currentCost = shortCurrentCost - longCurrentCost;
                  
                  console.log(`[Performance] Detected bear call spread: ${pos['underlying-symbol']} ${strike}/${longStrike} (${spreadWidth}pt width, $${capitalAtRisk.toFixed(2)} at risk, current spread value: $${currentCost.toFixed(2)})`);
                }
                break;
              }
            }
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
            currentPrice: parseFloat(pos['close-price']),
            realizedPercent: Math.round(realizedPercent * 100) / 100, // Round to 2 decimals
            action,
            hasWorkingOrder,
            // Spread fields (only populated if spread detected)
            spreadType,
            longStrike,
            spreadWidth,
            capitalAtRisk,
          });
        }

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

        return {
          positions: processedPositions,
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
        spreadType: z.enum(['bull_put', 'bear_call']).optional(),
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
      const api = await authenticateTastytrade(credentials);

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

      // Submit orders for each valid position
      const results = [];
      for (const pos of validPositions) {
        console.log(`[Performance] Processing ${pos.underlying} $${pos.strike} (${pos.quantity} contracts)`);
        
        // Check if this is a spread position
        if (pos.spreadType && pos.longStrike) {
          // Spread position - need to close both legs
          console.log(`[Performance] Detected ${pos.spreadType} spread: ${pos.strike}/${pos.longStrike}`);
          
          try {
            // Import price formatting utility
            const { formatPriceForSubmission } = await import('../shared/orderUtils');
            
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
            
            // Calculate aggressive close price (10% above current or +$0.05 min)
            // For spreads, current price represents the net credit/debit
            const pricePremium = Math.max(pos.currentPrice * 0.10, 0.05);
            const netDebitPrice = pos.currentPrice + pricePremium;
            const formattedPrice = formatPriceForSubmission(netDebitPrice);
            
            console.log(`[Performance] Closing spread: Short=${formattedShortSymbol}, Long=${longSymbol}`);
            console.log(`[Performance] Net debit price: $${formattedPrice} (mark=$${pos.currentPrice.toFixed(2)} + $${pricePremium.toFixed(2)})`);
            
            // Build two-leg order payload
            const orderPayload = {
              'time-in-force': 'Day',
              'order-type': 'Limit',
              'underlying-symbol': pos.underlying,
              price: formattedPrice,
              'price-effect': 'Debit', // We pay to close the spread
              legs: [
                {
                  'instrument-type': 'Equity Option',
                  symbol: formattedShortSymbol,
                  quantity: pos.quantity.toString(),
                  action: 'Buy to Close',
                },
                {
                  'instrument-type': 'Equity Option',
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

      console.log(`[Performance] Fetching expiration calendar for account ${accountId}`);

      // Get API credentials
      const credentials = await getApiCredentials(userId);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Tastytrade API credentials not configured',
        });
      }

      const api = await getTastytradeAPI();
      const accounts = await api.getAccounts();

      // Handle ALL_ACCOUNTS
      const targetAccounts = accountId === 'ALL_ACCOUNTS'
        ? accounts
        : accounts.filter(acc => (acc as any)['account-number'] === accountId);

      if (targetAccounts.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Account not found',
        });
      }

      // Fetch positions from all target accounts
      const allPositions = [];
      for (const account of targetAccounts) {
        const positions = await api.getPositions((account as any)['account-number']);
        const shortOptions = positions.filter(p => 
          p['instrument-type'] === 'Equity Option' && 
          p.quantity < 0
        );
        allPositions.push(...shortOptions.map(p => ({
          ...p,
          accountNumber: (account as any)['account-number'],
          accountName: (account as any).nickname || (account as any)['account-number'],
        })));
      }

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
