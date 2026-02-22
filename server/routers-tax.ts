import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';

export const taxRouter = router({
  /**
   * Get tax position summary including:
   * - Realized gains/losses from closed positions
   * - Unrealized gains/losses from open stock positions (harvestable)
   * - Ordinary income from options premium
   */
  getTaxSummary: protectedProcedure
    .input(z.object({
      accountNumber: z.string().optional(), // If not provided, aggregate all accounts
      year: z.number().optional(), // Tax year (default: current year)
    }))
    .query(async ({ ctx, input }) => {
      const { authenticateTastytrade } = await import('./tastytrade');
      const { getApiCredentials } = await import('./db');
      
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error('Tastytrade credentials not found');
      }
      
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const accounts = await api.getAccounts();
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }
      
      // Filter to specific account if provided
      const targetAccounts = input.accountNumber
        ? accounts.filter((acc: any) => acc['account-number'] === input.accountNumber)
        : accounts;
      
      const accountNumbers = targetAccounts.map((acc: any) => acc['account-number']);
      
      // Tax year (default to current year)
      const taxYear = input.year || new Date().getFullYear();
      const yearStart = `${taxYear}-01-01`;
      const yearEnd = `${taxYear}-12-31`;
      
      // Initialize summary
      let realizedGains = 0;
      let realizedLosses = 0;
      let ordinaryIncome = 0; // Options premium
      const harvestablePositions: Array<{
        symbol: string;
        accountNumber: string;
        quantity: number;
        costBasis: number;
        currentPrice: number;
        marketValue: number;
        unrealizedPL: number;
      }> = [];
      
      // Fetch positions for each account
      for (const accountNumber of accountNumbers) {
        const positions = await api.getPositions(accountNumber);
        if (!positions) continue;
        
        for (const pos of positions) {
          const instrumentType = pos['instrument-type'];
          
          // Stock positions - check for unrealized losses (harvestable)
          if (instrumentType === 'Equity') {
            const quantity = parseInt(String(pos.quantity || '0'));
            if (quantity === 0) continue;
            
            const costBasis = parseFloat(String(pos['cost-effect'] || '0')) / Math.abs(quantity);
            const currentPrice = parseFloat(String(pos['close-price'] || '0'));
            const marketValue = currentPrice * quantity;
            const totalCost = costBasis * quantity;
            const unrealizedPL = marketValue - totalCost;
            
            // Only track positions with unrealized losses (harvestable)
            if (unrealizedPL < 0) {
              harvestablePositions.push({
                symbol: pos.symbol || '',
                accountNumber,
                quantity,
                costBasis,
                currentPrice,
                marketValue,
                unrealizedPL,
              });
            }
          }
        }
        
        // Fetch closed positions (for realized gains/losses and ordinary income)
        try {
          const closedPositions = await api.getTransactionHistory(accountNumber, yearStart, yearEnd, 1000);
          
          if (closedPositions && Array.isArray(closedPositions)) {
            for (const txn of closedPositions) {
              const txnType = txn.type;
              const instrumentType = txn['instrument-type'];
              
              // Options trades = ordinary income (premium collected)
              if (instrumentType === 'Equity Option') {
                const value = parseFloat(String(txn.value || '0'));
                const action = txn.action;
                
                // Selling options = collecting premium (ordinary income)
                if (action === 'Sell to Open' || action === 'Sell to Close') {
                  ordinaryIncome += Math.abs(value);
                }
                
                // Calculate realized P&L for closed option positions
                if (txnType === 'Trade' && txn['net-value']) {
                  const netValue = parseFloat(String(txn['net-value'] || '0'));
                  if (netValue > 0) {
                    realizedGains += netValue;
                  } else if (netValue < 0) {
                    realizedLosses += Math.abs(netValue);
                  }
                }
              }
              
              // Stock trades = capital gains/losses
              if (instrumentType === 'Equity') {
                if (txnType === 'Trade' && txn['net-value']) {
                  const netValue = parseFloat(String(txn['net-value'] || '0'));
                  if (netValue > 0) {
                    realizedGains += netValue;
                  } else if (netValue < 0) {
                    realizedLosses += Math.abs(netValue);
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`Failed to fetch transaction history for ${accountNumber}:`, error);
          // Continue with other accounts even if one fails
        }
      }
      
      const netCapitalGain = realizedGains - realizedLosses;
      const totalHarvestable = harvestablePositions.reduce((sum, pos) => sum + pos.unrealizedPL, 0);
      
      // Wash Sale Detection
      // IRS Rule: If you sell a security at a loss and buy the same or substantially identical security
      // within 30 days before or after the sale, the loss is disallowed.
      const washSaleViolations: Array<{
        symbol: string;
        saleDate: string;
        repurchaseDate: string;
        disallowedLoss: number;
        accountNumber: string;
      }> = [];
      
      // Extend date range to include 30 days before/after tax year for wash sale detection
      const extendedStart = new Date(taxYear, 0, 1);
      extendedStart.setDate(extendedStart.getDate() - 30);
      const extendedEnd = new Date(taxYear, 11, 31);
      extendedEnd.setDate(extendedEnd.getDate() + 30);
      const extendedStartStr = extendedStart.toISOString().split('T')[0];
      const extendedEndStr = extendedEnd.toISOString().split('T')[0];
      
      for (const accountNumber of accountNumbers) {
        try {
          const allTransactions = await api.getTransactionHistory(accountNumber, extendedStartStr, extendedEndStr, 2000);
          
          if (!allTransactions || !Array.isArray(allTransactions)) continue;
          
          // Filter to stock transactions only
          const stockTransactions = allTransactions.filter((txn: any) => 
            txn['instrument-type'] === 'Equity' && txn.type === 'Trade'
          );
          
          // Identify all sales at a loss
          const lossSales = stockTransactions.filter((txn: any) => {
            const action = txn.action;
            const netValue = parseFloat(String(txn['net-value'] || '0'));
            return (action === 'Sell to Close' || action === 'Sell') && netValue < 0;
          });
          
          // For each loss sale, check for repurchases within 61-day window
          for (const sale of lossSales) {
            const saleSymbol = sale.symbol;
            const saleDate = new Date(sale['executed-at'] || sale['transaction-date']);
            const lossAmount = Math.abs(parseFloat(String(sale['net-value'] || '0')));
            
            // Define 61-day window (30 days before + day of sale + 30 days after)
            const windowStart = new Date(saleDate);
            windowStart.setDate(windowStart.getDate() - 30);
            const windowEnd = new Date(saleDate);
            windowEnd.setDate(windowEnd.getDate() + 30);
            
            // Check for repurchases of the same symbol within the window
            const repurchases = stockTransactions.filter((txn: any) => {
              if (txn.symbol !== saleSymbol) return false;
              const action = txn.action;
              if (action !== 'Buy to Open' && action !== 'Buy') return false;
              
              const txnDate = new Date(txn['executed-at'] || txn['transaction-date']);
              return txnDate >= windowStart && txnDate <= windowEnd && txnDate.getTime() !== saleDate.getTime();
            });
            
            if (repurchases.length > 0) {
              // Wash sale violation detected
              const firstRepurchase = repurchases[0];
              const repurchaseDate = new Date(firstRepurchase['executed-at'] || firstRepurchase['transaction-date']);
              
              washSaleViolations.push({
                symbol: saleSymbol,
                saleDate: saleDate.toISOString().split('T')[0],
                repurchaseDate: repurchaseDate.toISOString().split('T')[0],
                disallowedLoss: lossAmount,
                accountNumber,
              });
            }
          }
        } catch (error) {
          console.error(`Failed to detect wash sales for ${accountNumber}:`, error);
          // Continue with other accounts
        }
      }
      
      const totalDisallowedLoss = washSaleViolations.reduce((sum, ws) => sum + ws.disallowedLoss, 0);
      
      return {
        taxYear,
        realizedGains,
        realizedLosses,
        netCapitalGain,
        ordinaryIncome,
        harvestablePositions: harvestablePositions.sort((a, b) => a.unrealizedPL - b.unrealizedPL), // Most negative first
        totalHarvestable,
        washSaleViolations: washSaleViolations.sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()), // Most recent first
        totalDisallowedLoss,
      };
    }),
});
