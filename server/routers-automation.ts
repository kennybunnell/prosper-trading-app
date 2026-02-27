/**
 * tRPC router for daily trading automation
 */

import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { notifyOwner } from './_core/notification';
import { randomUUID } from 'crypto';
import {
  getAutomationSettings,
  updateAutomationSettings,
  createAutomationLog,
  updateAutomationLog,
  getAutomationLogs,
  getAutomationLog,
  createPendingOrders,
  getPendingOrders,
  approvePendingOrders,
  rejectPendingOrders,
  approveAllPendingOrders,
} from './db-automation';
import { authenticateTastytrade } from './tastytrade';

export const automationRouter = router({
  /**
   * Get automation settings for the current user
   */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    return getAutomationSettings(ctx.user.id);
  }),

  /**
   * Update automation settings
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        dryRunMode: z.boolean().optional(),
        requireApproval: z.boolean().optional(),
        autoScheduleEnabled: z.boolean().optional(),
        scheduleTime: z.string().optional(),
        profitThresholdPercent: z.number().min(1).max(100).optional(),
        ccDteMin: z.number().min(1).max(365).optional(),
        ccDteMax: z.number().min(1).max(365).optional(),
        ccDeltaMin: z.string().optional(),
        ccDeltaMax: z.string().optional(),
        emailNotificationsEnabled: z.boolean().optional(),
        notificationEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateAutomationSettings(ctx.user.id, input);
      return { success: true };
    }),

  /**
   * Get automation execution logs
   */
  getLogs: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      return getAutomationLogs(ctx.user.id, input.limit);
    }),

  /**
   * Get a specific automation log by runId
   */
  getLog: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const log = await getAutomationLog(input.runId);
      if (!log || log.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Automation log not found',
        });
      }
      return log;
    }),

  /**
   * Get pending orders for a specific run
   */
  getPendingOrders: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const log = await getAutomationLog(input.runId);
      if (!log || log.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Automation log not found',
        });
      }
      return getPendingOrders(input.runId);
    }),

  /**
   * Approve pending orders
   */
  approveOrders: protectedProcedure
    .input(
      z.object({
        runId: z.string(),
        orderIds: z.array(z.number()).optional(), // If not provided, approve all
      })
    )
    .mutation(async ({ ctx, input }) => {
      const log = await getAutomationLog(input.runId);
      if (!log || log.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Automation log not found',
        });
      }

      if (input.orderIds) {
        await approvePendingOrders(input.orderIds);
      } else {
        await approveAllPendingOrders(input.runId);
      }

      return { success: true };
    }),

  /**
   * Reject pending orders
   */
  rejectOrders: protectedProcedure
    .input(
      z.object({
        runId: z.string(),
        orderIds: z.array(z.number()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const log = await getAutomationLog(input.runId);
      if (!log || log.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Automation log not found',
        });
      }

      await rejectPendingOrders(input.orderIds);
      return { success: true };
    }),

  /**
   * Run the daily automation workflow
   */
  runAutomation: protectedProcedure
    .input(
      z.object({
        triggerType: z.enum(['manual', 'scheduled']).default('manual'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getAutomationSettings(ctx.user.id);
      const runId = randomUUID();

      // Create automation log
      await createAutomationLog({
        userId: ctx.user.id,
        runId,
        triggerType: input.triggerType,
        dryRun: settings.dryRunMode,
      });

      try {
        // Get Tastytrade client - authenticate with user's stored credentials
        const { getApiCredentials } = await import('./db');
        const credentials = await getApiCredentials(ctx.user.id);
        if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Tastytrade API not connected. Please configure your Tastytrade credentials in Settings.',
          });
        }
        const tt = await authenticateTastytrade(credentials, ctx.user.id);
        if (!tt) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Failed to authenticate with Tastytrade API',
          });
        }

        // Get all accounts sorted by buying power (descending)
        const accounts = await tt.getAccounts();
        const accountsWithBalances = await Promise.all(
          accounts.map(async (acc: any) => {
            // Account number is nested as acc.account['account-number'] (hyphenated)
            const accountNumber = acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber;
            try {
              const balances = await tt.getBalances(accountNumber);
              return {
                accountNumber,
                accountName: acc.account?.nickname || accountNumber,
                buyingPower: parseFloat(balances?.['derivative-buying-power'] || balances?.['net-liquidating-value'] || '0'),
              };
            } catch {
              return {
                accountNumber,
                accountName: acc.account?.nickname || accountNumber,
                buyingPower: 0,
              };
            }
          })
        );

        accountsWithBalances.sort((a: { buyingPower: number }, b: { buyingPower: number }) => b.buyingPower - a.buyingPower);

        const pendingOrders: Array<any> = [];
        // Detailed scan results for dry-run visibility
        const scanResults: Array<{
          account: string;
          symbol: string;
          optionSymbol: string;
          type: string;
          quantity: number;
          premium: number;
          current: number;
          realizedPercent: number;
          action: 'WOULD_CLOSE' | 'BELOW_THRESHOLD' | 'SKIPPED';
          reason?: string;
        }> = [];
        let totalPositionsClosed = 0;
        let totalCoveredCallsOpened = 0;
        let totalProfitRealized = 0;
        let totalPremiumCollected = 0;

        // Process each account
        for (const account of accountsWithBalances) {
          try {
            // Step 1: Close profitable positions
            // Uses same formula as Active Positions page:
            //   premiumReceived = average-open-price × qty × multiplier
            //   currentCost     = close-price × qty × multiplier
            //   realizedPercent = (premiumReceived - currentCost) / premiumReceived × 100
            const positions = await tt.getPositions(account.accountNumber);
            
            // Build a map of long positions for spread detection
            const longPositionMap = new Map<string, any>();
            for (const pos of positions) {
              const qty = parseInt(String(pos.quantity || '0'));
              const direction = pos['quantity-direction']?.toLowerCase();
              const isLong = direction === 'long' || qty > 0;
              if (isLong && pos['instrument-type'] === 'Equity Option') {
                longPositionMap.set(pos.symbol, pos);
              }
            }

            for (const position of positions) {
              // Only process short equity options (CSPs and CCs)
              if (position['instrument-type'] !== 'Equity Option') continue;
              const qty = parseInt(String(position.quantity || '0'));
              const direction = position['quantity-direction']?.toLowerCase();
              const isShort = direction === 'short' || qty < 0;
              if (!isShort) continue;

              const quantity = Math.abs(qty);
              const multiplier = parseInt(String(position.multiplier || '100'));
              const underlyingSymbol = position['underlying-symbol'] || position.symbol || '';
              const optionSymbol = position.symbol || '';
              const isPut = optionSymbol.includes('P');
              const optionType = isPut ? 'CSP' : 'CC';

              // Premium received = what we collected when we sold
              const openPrice = Math.abs(parseFloat(String(position['average-open-price'] || '0')));
              const premiumReceived = openPrice * quantity * multiplier;

              if (premiumReceived === 0) {
                scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity, premium: 0, current: 0, realizedPercent: 0, action: 'SKIPPED', reason: 'No premium data (average-open-price is 0)' });
                continue;
              }

              // Current cost = what it costs to buy back now
              const closePrice = parseFloat(String(position['close-price'] || '0'));
              let currentCost = closePrice * quantity * multiplier;

              // Spread detection: look for matching long leg
              let isSpread = false;
              for (const [, longPos] of Array.from(longPositionMap.entries())) {
                if (longPos['underlying-symbol'] === position['underlying-symbol'] &&
                    longPos['expires-at'] === position['expires-at']) {
                  const longIsPut = longPos.symbol.includes('P');
                  if (longIsPut === isPut) {
                    // Found matching long leg - adjust currentCost for spread
                    const longClosePrice = parseFloat(String(longPos['close-price'] || '0'));
                    const longCurrentCost = longClosePrice * quantity * parseInt(String(longPos.multiplier || '100'));
                    // Spread close cost = pay to close short - receive to close long
                    currentCost = currentCost - longCurrentCost;
                    isSpread = true;
                    break;
                  }
                }
              }

              // Realized % = (premiumReceived - currentCost) / premiumReceived × 100
              const realizedPercent = ((premiumReceived - currentCost) / premiumReceived) * 100;
              const estimatedProfit = premiumReceived - currentCost;

              // Parse expiration from option symbol or position fields
              const expiration = position['expires-at'] || null;

              // Parse strike from option symbol (e.g., AAPL250117P00150000 -> 150)
              const strikeMatch = optionSymbol.match(/[CP](\d+)/);
              const strike = strikeMatch ? (parseFloat(strikeMatch[1]) / 1000).toFixed(2) : null;

              console.log(`[Automation] ${underlyingSymbol} ${optionType}${isSpread ? ' (spread)' : ''}: premium=$${premiumReceived.toFixed(2)}, current=$${currentCost.toFixed(2)}, realized=${realizedPercent.toFixed(1)}%`);

              if (realizedPercent >= settings.profitThresholdPercent) {
                // This position should be closed
                pendingOrders.push({
                  runId,
                  userId: ctx.user.id,
                  accountNumber: account.accountNumber,
                  orderType: 'close_position' as const,
                  symbol: optionSymbol,
                  strike,
                  expiration,
                  quantity,
                  price: String(closePrice),
                  profitPercent: Math.round(realizedPercent),
                  estimatedProfit: estimatedProfit.toFixed(2),
                  status: 'pending' as const,
                });

                scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity, premium: premiumReceived, current: currentCost, realizedPercent: Math.round(realizedPercent * 100) / 100, action: 'WOULD_CLOSE' });

                totalPositionsClosed++;
                totalProfitRealized += estimatedProfit;
              } else {
                scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity, premium: premiumReceived, current: currentCost, realizedPercent: Math.round(realizedPercent * 100) / 100, action: 'BELOW_THRESHOLD' });
              }
            }

            // Step 2: Find and submit covered call opportunities
            // TODO: Implement covered call opportunity selection
            // This will reuse logic from cc.submitOrders but with filtering:
            // - DTE: settings.ccDteMin to settings.ccDteMax
            // - Delta: settings.ccDeltaMin to settings.ccDeltaMax
            // - Sort by score (descending)
            // - Select best opportunity for each eligible stock

          } catch (accountError) {
            console.error(`[Automation] Error processing account ${account.accountNumber}:`, accountError);
            // Continue to next account
          }
        }

        // Save pending orders to database
        if (pendingOrders.length > 0) {
          await createPendingOrders(pendingOrders);
        }

        // Update automation log — store scanResults as JSON in DB so the response stays small
        await updateAutomationLog(runId, {
          status: 'completed',
          positionsClosedCount: totalPositionsClosed,
          coveredCallsOpenedCount: totalCoveredCallsOpened,
          totalProfitRealized: totalProfitRealized.toFixed(2),
          totalPremiumCollected: totalPremiumCollected.toFixed(2),
          accountsProcessed: accountsWithBalances.length,
          scanResultsJson: JSON.stringify(scanResults),
          completedAt: new Date(),
        });

        // Send email notification if enabled
        if (settings.emailNotificationsEnabled && !settings.dryRunMode) {
          const emailContent = `Daily Trading Automation Summary\n${new Date().toLocaleString()}\n\nPOSITIONS TO CLOSE: ${totalPositionsClosed}\nCOVERED CALLS TO OPEN: ${totalCoveredCallsOpened}\n\nTOTAL PROFIT REALIZED: $${totalProfitRealized.toFixed(2)}\nTOTAL PREMIUM COLLECTED: $${totalPremiumCollected.toFixed(2)}\n\nACCOUNTS PROCESSED: ${accountsWithBalances.length}\nPENDING ORDERS: ${pendingOrders.length}\n\nView full details: /automation`;
          
          await notifyOwner({
            title: `✅ Daily Automation Complete - $${(totalProfitRealized + totalPremiumCollected).toFixed(2)} Total`,
            content: emailContent,
          }).catch(err => {
            console.error('[Automation] Failed to send email notification:', err);
          });
        }

        // Return only a slim summary — the UI fetches scan results via getLog query to avoid large payloads
        return {
          success: true,
          runId,
          summary: {
            positionsClosedCount: totalPositionsClosed,
            coveredCallsOpenedCount: totalCoveredCallsOpened,
            totalProfitRealized: totalProfitRealized.toFixed(2),
            totalPremiumCollected: totalPremiumCollected.toFixed(2),
            accountsProcessed: accountsWithBalances.length,
            pendingOrdersCount: pendingOrders.length,
            totalScanned: scanResults.length,
            wouldClose: scanResults.filter(r => r.action === 'WOULD_CLOSE').length,
            belowThreshold: scanResults.filter(r => r.action === 'BELOW_THRESHOLD').length,
          },
        };
      } catch (error) {
        // Update log with error
        await updateAutomationLog(runId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        });

        throw error;
      }
    }),
});
