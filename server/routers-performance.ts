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
  symbol: string;
  type: 'CSP' | 'CC';
  quantity: number;
  strike: number;
  expiration: string;
  dte: number;
  premium: number;
  current: number;
  realizedPercent: number;
  action: 'CLOSE' | 'WATCH' | 'HOLD';
}

export const performanceRouter = router({
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

      const accountNumber = accountId || accounts[0].account["account-number"];
      console.log(`[Performance] Fetching positions for account: ${accountNumber}`);

      try {
        // Fetch all positions from Tastytrade
        const positions = await api.getPositions(accountNumber);
        console.log(`[Performance] Retrieved ${positions.length} total positions`);
        
        // Filter for short option positions only
        const shortOptions = positions.filter((pos) => {
          const isOption = pos.instrumentType === 'Equity Option';
          const isShort = pos.quantityDirection === 'Short';
          return isOption && isShort;
        });
        console.log(`[Performance] Found ${shortOptions.length} short option positions`);

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
          const quantity = Math.abs(parseInt(pos.quantity));
          const premiumReceived = Math.abs(parseFloat(pos.averageOpenPrice)) * quantity * pos.multiplier;
          const currentCost = parseFloat(pos.closePrice) * quantity * pos.multiplier;
          
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
          const expirationDate = pos.expiresAt ? new Date(pos.expiresAt) : new Date();
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
            account: accountNumber,
            symbol: pos.underlyingSymbol,
            type: optionType,
            quantity,
            strike,
            expiration: pos.expiresAt ? new Date(pos.expiresAt).toLocaleDateString() : 'N/A',
            dte,
            premium: premiumReceived,
            current: currentCost,
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
});
