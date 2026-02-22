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

  /**
   * Verify tax calculations by cross-checking with Tastytrade official data
   * Fetches tax lots and realized P&L reports to validate our calculations
   */
  getTaxVerification: protectedProcedure
    .input(z.object({
      accountNumber: z.string().optional(),
      year: z.number().optional(),
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
      
      const targetAccounts = input.accountNumber
        ? accounts.filter((acc: any) => acc['account-number'] === input.accountNumber)
        : accounts;
      
      const accountNumbers = targetAccounts.map((acc: any) => acc['account-number']);
      const taxYear = input.year || new Date().getFullYear();
      const yearStart = `${taxYear}-01-01`;
      const yearEnd = `${taxYear}-12-31`;
      
      // Fetch official Tastytrade realized P&L data
      let tastytradeRealizedPnL = 0;
      const verificationDetails: Array<{
        accountNumber: string;
        tastytradeData: any;
        status: 'success' | 'unavailable' | 'error';
      }> = [];
      
      for (const accountNumber of accountNumbers) {
        try {
          const pnlData = await api.getRealizedPnL(accountNumber, yearStart, yearEnd);
          
          if (pnlData && Object.keys(pnlData).length > 0) {
            // Extract realized P&L from Tastytrade response
            // Note: Actual field names may vary - adjust based on API response
            const realizedPnL = pnlData['realized-profit-loss'] || pnlData['realized-pnl'] || 0;
            tastytradeRealizedPnL += realizedPnL;
            
            verificationDetails.push({
              accountNumber,
              tastytradeData: pnlData,
              status: 'success',
            });
          } else {
            verificationDetails.push({
              accountNumber,
              tastytradeData: null,
              status: 'unavailable',
            });
          }
        } catch (error) {
          console.error(`Failed to fetch P&L for ${accountNumber}:`, error);
          verificationDetails.push({
            accountNumber,
            tastytradeData: null,
            status: 'error',
          });
        }
      }
      
      // Fetch tax lot data for open stock positions (for cost basis verification)
      const taxLotData: Array<{
        symbol: string;
        accountNumber: string;
        lots: any[];
      }> = [];
      
      for (const accountNumber of accountNumbers) {
        try {
          const positions = await api.getPositions(accountNumber);
          const stockPositions = positions.filter((pos: any) => 
            pos['instrument-type'] === 'Equity' && pos.quantity !== 0
          );
          
          for (const position of stockPositions) {
            const symbol = position.symbol;
            const lots = await api.getTaxLots(accountNumber, symbol);
            
            if (lots.length > 0) {
              taxLotData.push({
                symbol,
                accountNumber,
                lots,
              });
            }
          }
        } catch (error) {
          console.error(`Failed to fetch tax lots for ${accountNumber}:`, error);
        }
      }
      
      return {
        taxYear,
        tastytradeRealizedPnL,
        verificationDetails,
        taxLotData,
        dataAvailable: verificationDetails.some(d => d.status === 'success'),
      };
    }),

  /**
   * Generate PDF tax summary report
   * Returns PDF as base64 string for download
   */
  generateTaxPDF: protectedProcedure
    .input(z.object({
      accountNumber: z.string().optional(),
      year: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const PDFDocument = (await import('pdfkit')).default;
      const { authenticateTastytrade } = await import('./tastytrade');
      const { getApiCredentials } = await import('./db');
      
      // Get tax summary data by calling getTaxSummary directly
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error('Tastytrade credentials not found');
      }
      
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const accounts = await api.getAccounts();
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }
      
      const targetAccounts = input.accountNumber
        ? accounts.filter((acc: any) => acc['account-number'] === input.accountNumber)
        : accounts;
      
      const accountNumbers = targetAccounts.map((acc: any) => acc['account-number']);
      const taxYear = input.year || new Date().getFullYear();
      const yearStart = `${taxYear}-01-01`;
      const yearEnd = `${taxYear}-12-31`;
      
      // Simplified tax data calculation for PDF
      let realizedGains = 0;
      let realizedLosses = 0;
      let ordinaryIncome = 0;
      const harvestablePositions: any[] = [];
      const washSaleViolations: any[] = [];
      
      for (const accountNumber of accountNumbers) {
        try {
          const transactions = await api.getTransactionHistory(accountNumber, yearStart, yearEnd);
          
          for (const txn of transactions) {
            if (txn.action === 'Sell' && txn['instrument-type'] === 'Equity') {
              const pnl = parseFloat(txn['net-value'] || '0');
              if (pnl > 0) realizedGains += pnl;
              else realizedLosses += Math.abs(pnl);
            }
            if (txn['instrument-type'] === 'Equity Option' && (txn.action === 'Sell to Open' || txn.action === 'Buy to Close')) {
              ordinaryIncome += Math.abs(parseFloat(txn['net-value'] || '0'));
            }
          }
          
          const positions = await api.getPositions(accountNumber);
          const stockPositions = positions.filter((pos: any) => 
            pos['instrument-type'] === 'Equity' && pos.quantity !== 0
          );
          
          for (const position of stockPositions) {
            const unrealizedPL = parseFloat(position['close-price'] || '0') * position.quantity - parseFloat(position['cost-effect'] || '0');
            if (unrealizedPL < 0) {
              harvestablePositions.push({
                symbol: position.symbol,
                accountNumber,
                quantity: position.quantity,
                costBasis: parseFloat(position['cost-effect'] || '0'),
                unrealizedPL,
              });
            }
          }
        } catch (error) {
          console.error(`Failed to fetch data for ${accountNumber}:`, error);
        }
      }
      
      const netCapitalGain = realizedGains - realizedLosses;
      const taxData = {
        taxYear,
        realizedGains,
        realizedLosses,
        netCapitalGain,
        ordinaryIncome,
        harvestablePositions: harvestablePositions.sort((a, b) => a.unrealizedPL - b.unrealizedPL),
        washSaleViolations,
      };
      
      const currentDate = new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      // Create PDF document
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const chunks: Buffer[] = [];
      
      doc.on('data', (chunk) => chunks.push(chunk));
      
      return new Promise<{ pdf: string; filename: string }>((resolve, reject) => {
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          const pdfBase64 = pdfBuffer.toString('base64');
          resolve({
            pdf: pdfBase64,
            filename: `Tax_Summary_${taxYear}_${(ctx.user.name || 'User').replace(/\s+/g, '_')}.pdf`,
          });
        });
        
        doc.on('error', reject);
        
        try {
          // Cover Page
          doc.fontSize(24).font('Helvetica-Bold').text('Tax Summary Report', { align: 'center' });
          doc.moveDown(0.5);
          doc.fontSize(16).font('Helvetica').text(`Tax Year ${taxYear}`, { align: 'center' });
          doc.moveDown(2);
          
          doc.fontSize(12).text(`Prepared for: ${ctx.user.name}`, { align: 'center' });
          doc.text(`Generated: ${currentDate}`, { align: 'center' });
          doc.moveDown(3);
          
          // Summary Section
          doc.fontSize(18).font('Helvetica-Bold').text('Summary');
          doc.moveDown(0.5);
          doc.fontSize(12).font('Helvetica');
          
          const summaryY = doc.y;
          doc.text(`Realized Gains: $${taxData.realizedGains.toLocaleString()}`, { continued: false });
          doc.text(`Realized Losses: $${taxData.realizedLosses.toLocaleString()}`, { continued: false });
          doc.text(`Net Capital Gain/Loss: $${taxData.netCapitalGain.toLocaleString()}`, { continued: false });
          doc.text(`Ordinary Income (Options): $${taxData.ordinaryIncome.toLocaleString()}`, { continued: false });
          doc.moveDown(1);
          
          // Harvestable Losses Section
          if (taxData.harvestablePositions.length > 0) {
            doc.fontSize(16).font('Helvetica-Bold').text('Harvestable Losses');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica');
            
            // Table header
            const tableTop = doc.y;
            const col1 = 50;
            const col2 = 150;
            const col3 = 250;
            const col4 = 350;
            const col5 = 450;
            
            doc.font('Helvetica-Bold');
            doc.text('Symbol', col1, tableTop);
            doc.text('Account', col2, tableTop);
            doc.text('Quantity', col3, tableTop);
            doc.text('Cost Basis', col4, tableTop);
            doc.text('Unrealized P/L', col5, tableTop);
            doc.moveDown(0.5);
            
            doc.font('Helvetica');
            taxData.harvestablePositions.slice(0, 20).forEach((pos: any) => {
              const y = doc.y;
              doc.text(pos.symbol, col1, y);
              doc.text(pos.accountNumber, col2, y);
              doc.text(pos.quantity.toString(), col3, y);
              doc.text(`$${pos.costBasis.toLocaleString()}`, col4, y);
              doc.text(`$${pos.unrealizedPL.toLocaleString()}`, col5, y);
              doc.moveDown(0.3);
            });
            
            if (taxData.harvestablePositions.length > 20) {
              doc.fontSize(9).fillColor('gray').text(`... and ${taxData.harvestablePositions.length - 20} more positions`);
              doc.fillColor('black');
            }
            doc.moveDown(1);
          }
          
          // Wash Sale Violations Section
          if (taxData.washSaleViolations.length > 0) {
            doc.addPage();
            doc.fontSize(16).font('Helvetica-Bold').text('Wash Sale Violations');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica');
            
            taxData.washSaleViolations.forEach((ws: any) => {
              doc.text(`Symbol: ${ws.symbol}`);
              doc.text(`Sale Date: ${ws.saleDate}`);
              doc.text(`Repurchase Date: ${ws.repurchaseDate}`);
              doc.text(`Disallowed Loss: $${ws.disallowedLoss.toLocaleString()}`);
              doc.moveDown(0.5);
            });
          }
          
          // Footer
          doc.fontSize(8).fillColor('gray').text(
            'This report is for informational purposes only and should not be considered tax advice. Consult a tax professional.',
            50,
            doc.page.height - 50,
            { align: 'center' }
          );
          
          doc.end();
        } catch (error) {
          reject(error);
        }
      });
    }),
});


