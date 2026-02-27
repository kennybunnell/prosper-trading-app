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
  deleteAutomationLog,
  clearAllAutomationLogs,
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
        ccAutomationEnabled: z.boolean().optional(),
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
   * Delete a specific automation log (and its pending orders via cascade)
   */
  deleteLog: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const log = await getAutomationLog(input.runId);
      if (!log || log.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Automation log not found',
        });
      }
      await deleteAutomationLog(input.runId);
      return { success: true };
    }),

  /**
   * Delete all automation logs for the current user
   */
  clearAllLogs: protectedProcedure
    .mutation(async ({ ctx }) => {
      await clearAllAutomationLogs(ctx.user.id);
      return { success: true };
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
        scanSteps: z.array(z.enum(['btc', 'cc', 'all'])).optional(), // if omitted, runs all enabled steps
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
        // CC scan results (covered calls to open)
        const ccScanResults: Array<{
          account: string;
          symbol: string;
          optionSymbol: string;
          strike: number;
          expiration: string;
          dte: number;
          delta: number;
          bid: number;
          ask: number;
          mid: number;
          quantity: number;
          premiumPerContract: number;
          totalPremium: number;
          returnPct: number;
          weeklyReturn: number;
          currentPrice: number;
          action: 'WOULD_SELL_CC';
        }> = [];
        // Detailed scan results for dry-run visibility
        const scanResults: Array<{
          account: string;
          symbol: string;
          optionSymbol: string;
          type: string;
          quantity: number;
          premiumCollected: number;  // Total premium received when position was opened
          buyBackCost: number;       // Current cost to close/buy back the position
          realizedPercent: number;   // (premiumCollected - buyBackCost) / premiumCollected × 100
          expiration: string | null; // ISO expiration date from Tastytrade
          dte: number | null;          // Days to expiration (0 = expires today)
          isEstimated: boolean;        // true when buy-back cost is from time-decay heuristic (close-price=0)
          action: 'WOULD_CLOSE' | 'BELOW_THRESHOLD' | 'SKIPPED';
          reason?: string;
        }> = [];
        let totalPositionsClosed = 0;
        let totalCoveredCallsOpened = 0;
        let totalProfitRealized = 0;
        let totalPremiumCollected = 0;

        // Determine which steps to run
        const runBTCScan = !input.scanSteps || input.scanSteps.includes('btc') || input.scanSteps.includes('all');

        // Process each account
        for (const account of accountsWithBalances) {
          try {
            // Step 1: Close profitable positions
            // Uses same formula as Active Positions page:
            //   premiumReceived = average-open-price × qty × multiplier
            //   currentCost     = close-price × qty × multiplier
            //   realizedPercent = (premiumReceived - currentCost) / premiumReceived × 100
            const positions = runBTCScan ? await tt.getPositions(account.accountNumber) : [];
            
            // Build a map of long positions for spread detection
            const longPositionMap = new Map<string, any>();
            if (runBTCScan) {
              for (const pos of positions) {
                const qty = parseInt(String(pos.quantity || '0'));
                const direction = pos['quantity-direction']?.toLowerCase();
                const isLong = direction === 'long' || qty > 0;
                if (isLong && pos['instrument-type'] === 'Equity Option') {
                  longPositionMap.set(pos.symbol, pos);
                }
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
                  const skipExpiration = position['expires-at'] || null;
                  const skipDte = skipExpiration ? Math.max(0, Math.round((new Date(skipExpiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
                  scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity, premiumCollected: 0, buyBackCost: 0, realizedPercent: 0, expiration: skipExpiration, dte: skipDte, isEstimated: false, action: 'SKIPPED', reason: 'No premium data (average-open-price is 0)' });
                continue;
              }

              // Parse expiration early so it's available for the time-decay heuristic
              const expiration = position['expires-at'] || null;

              // Current cost = what it costs to buy back now (always positive — this is what we PAY)
              const closePrice = Math.abs(parseFloat(String(position['close-price'] || '0')));
              let buyBackCost = closePrice * quantity * multiplier;

              // Spread detection: look for matching long leg on the SAME expiration and same put/call type
              // Only net the spread if the long leg's close price is LOWER than the short leg's
              // (i.e., the long leg is worth less, which is the normal spread scenario)
              let isSpread = false;
              for (const [, longPos] of Array.from(longPositionMap.entries())) {
                if (longPos['underlying-symbol'] === position['underlying-symbol'] &&
                    longPos['expires-at'] === position['expires-at']) {
                  const longIsPut = longPos.symbol.includes('P');
                  if (longIsPut === isPut) {
                    const longClosePrice = Math.abs(parseFloat(String(longPos['close-price'] || '0')));
                    const longBuyBackCredit = longClosePrice * quantity * parseInt(String(longPos.multiplier || '100'));
                    // Net spread cost = pay to close short leg - receive credit from closing long leg
                    // Only apply if result stays positive (guards against bad data)
                    const netCost = buyBackCost - longBuyBackCredit;
                    if (netCost >= 0) {
                      buyBackCost = netCost;
                      isSpread = true;
                    }
                    break;
                  }
                }
              }

              // Time-decay heuristic: MUST run AFTER spread detection so spread netting can't zero it out.
              // When buyBackCost is still 0 after spread netting (both legs have close-price=0),
              // estimate using theta decay: estimatedPerShare = openPrice × sqrt(daysRemaining / daysOriginal)
              // Uses actual position created-at date for true original DTE (not a hardcoded assumption)
              let isEstimated = false;
              if (buyBackCost === 0 && expiration) {
                const now = new Date();
                const expDate = new Date(expiration);
                const daysRemaining = Math.max(0, (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                // Use actual open date from Tastytrade API for true original DTE
                const openDateStr = position['created-at'] || null;
                const daysOriginal = openDateStr
                  ? Math.max(1, (expDate.getTime() - new Date(openDateStr).getTime()) / (1000 * 60 * 60 * 24))
                  : 14; // Fallback if created-at not available
                if (daysRemaining > 0) {
                  const decayFactor = Math.sqrt(daysRemaining / daysOriginal);
                  const estimatedPerShare = openPrice * decayFactor;
                  // Floor at $0.01 per share minimum (options rarely trade below this)
                  const flooredPerShare = Math.max(0.01, estimatedPerShare);
                  buyBackCost = flooredPerShare * quantity * multiplier;
                  isEstimated = true;
                  console.log(`[Automation] ${underlyingSymbol} ${optionType}: buyBackCost=0 after spread netting, using time-decay estimate: $${buyBackCost.toFixed(2)} (${daysRemaining.toFixed(1)} of ${daysOriginal.toFixed(1)} DTE remaining, decay=${decayFactor.toFixed(3)})`);
                }
              }

              // Realized % = (premiumReceived - buyBackCost) / premiumReceived × 100
              // Example: sold for $300, buy back for $3 → (300-3)/300 = 99%
              const realizedPercent = ((premiumReceived - buyBackCost) / premiumReceived) * 100;
              const estimatedProfit = premiumReceived - buyBackCost;

              // Calculate DTE (days to expiration)
              const dte = expiration
                ? Math.max(0, Math.round((new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                : null;

              // Parse strike from option symbol (e.g., AAPL250117P00150000 -> 150)
              const strikeMatch = optionSymbol.match(/[CP](\d+)/);
              const strike = strikeMatch ? (parseFloat(strikeMatch[1]) / 1000).toFixed(2) : null;

              console.log(`[Automation] ${underlyingSymbol} ${optionType}${isSpread ? ' (spread)' : ''}: premiumCollected=$${premiumReceived.toFixed(2)}, buyBackCost=$${buyBackCost.toFixed(2)}, realized=${realizedPercent.toFixed(1)}%`);

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

                scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity, premiumCollected: premiumReceived, buyBackCost, realizedPercent: Math.round(realizedPercent * 100) / 100, expiration: expiration || null, dte, isEstimated, action: 'WOULD_CLOSE' });

                totalPositionsClosed++;
                totalProfitRealized += estimatedProfit;
              } else {
                scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity, premiumCollected: premiumReceived, buyBackCost, realizedPercent: Math.round(realizedPercent * 100) / 100, expiration: expiration || null, dte, isEstimated, action: 'BELOW_THRESHOLD' });
              }
            }

            // Step 2: Find covered call opportunities for eligible stock positions
            const runCCScan = !input.scanSteps || input.scanSteps.includes('cc') || input.scanSteps.includes('all');
            if (runCCScan && settings.ccAutomationEnabled) {
              try {
                console.log(`[Automation CC] Scanning account ${account.accountNumber} for CC opportunities`);
                const allPositions = await tt.getPositions(account.accountNumber);
                const stockPositions = allPositions.filter((p: any) => p['instrument-type'] === 'Equity' && parseFloat(p.quantity) > 0);
                const optionPositions = allPositions.filter((p: any) => p['instrument-type'] === 'Equity Option');
                // Identify existing short calls to avoid over-covering
                const shortCalls: Record<string, number> = {};
                for (const opt of optionPositions) {
                  if ((opt as any)['quantity-direction'] === 'Short' && (opt as any).symbol.includes('C')) {
                    const underlying = (opt as any)['underlying-symbol'];
                    shortCalls[underlying] = (shortCalls[underlying] || 0) + Math.abs(parseFloat((opt as any).quantity));
                  }
                }
                // Build list of eligible stocks with uncovered shares
                const eligibleStocks = stockPositions
                  .map((p: any) => ({
                    symbol: p.symbol,
                    quantity: parseFloat(p.quantity),
                    currentPrice: parseFloat(p['close-price'] || p['mark'] || '0'),
                    existingContracts: shortCalls[p.symbol] || 0,
                  }))
                  .map((s: any) => ({ ...s, maxContracts: Math.floor((s.quantity - s.existingContracts * 100) / 100) }))
                  .filter((s: any) => s.maxContracts > 0 && s.currentPrice > 0);
                if (eligibleStocks.length === 0) {
                  console.log(`[Automation CC] No eligible stocks for CCs in account ${account.accountNumber}`);
                } else {
                  const { createTradierAPI } = await import('./tradier');
                  // Use user's stored key if it looks valid (>15 chars), otherwise fall back to env var
                  const storedKey = credentials?.tradierApiKey;
                  const tradierApiKey = (storedKey && storedKey.length > 15 ? storedKey : null) || process.env.TRADIER_API_KEY;
                  if (!tradierApiKey) {
                    console.warn('[Automation CC] No Tradier API key available, skipping CC scan');
                  } else {
                    const tradierApi = createTradierAPI(tradierApiKey);
                    const minDelta = parseFloat(settings.ccDeltaMin);
                    const maxDelta = parseFloat(settings.ccDeltaMax);
                    const today = new Date();
                    for (const stock of eligibleStocks) {
                      try {
                        const expirations = await tradierApi.getExpirations(stock.symbol);
                        const validExpirations = expirations.filter((exp: string) => {
                          const dte = Math.ceil((new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                          return dte >= settings.ccDteMin && dte <= settings.ccDteMax;
                        });
                        if (validExpirations.length === 0) continue;
                        let bestOpp: any = null;
                        for (const expiration of validExpirations) {
                          const options = await tradierApi.getOptionChain(stock.symbol, expiration, true);
                          const calls = options.filter((opt: any) => opt.option_type === 'call');
                          for (const option of calls) {
                            const strike = option.strike || 0;
                            const delta = Math.abs(option.greeks?.delta || 0);
                            const bid = option.bid || 0;
                            const ask = option.ask || 0;
                            const mid = (bid + ask) / 2;
                            if (strike <= stock.currentPrice) continue;
                            if (delta < minDelta || delta > maxDelta) continue;
                            if (bid <= 0) continue;
                            const dte = Math.ceil((new Date(expiration).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                            const returnPct = (mid / stock.currentPrice) * 100;
                            const weeklyReturn = dte > 0 ? (returnPct / dte) * 7 : 0;
                            const opp = { symbol: stock.symbol, strike, expiration, dte, delta, bid, ask, mid, returnPct, weeklyReturn, maxContracts: stock.maxContracts, currentPrice: stock.currentPrice };
                            if (!bestOpp || weeklyReturn > bestOpp.weeklyReturn) bestOpp = opp;
                          }
                        }
                        if (bestOpp) {
                          // Build OCC option symbol: SYMBOL + YYMMDD + C/P + strike*1000 padded to 8 digits
                          const expParts = bestOpp.expiration.split('-');
                          const optSymDate = expParts[0].slice(2) + expParts[1] + expParts[2];
                          const optionSymbol = `${bestOpp.symbol}${optSymDate}C${String(Math.round(bestOpp.strike * 1000)).padStart(8, '0')}`;
                          const totalPremium = bestOpp.mid * bestOpp.maxContracts * 100;
                          ccScanResults.push({
                            account: account.accountNumber,
                            symbol: bestOpp.symbol,
                            optionSymbol,
                            strike: bestOpp.strike,
                            expiration: bestOpp.expiration,
                            dte: bestOpp.dte,
                            delta: bestOpp.delta,
                            bid: bestOpp.bid,
                            ask: bestOpp.ask,
                            mid: bestOpp.mid,
                            quantity: bestOpp.maxContracts,
                            premiumPerContract: bestOpp.mid * 100,
                            totalPremium,
                            returnPct: bestOpp.returnPct,
                            weeklyReturn: bestOpp.weeklyReturn,
                            currentPrice: bestOpp.currentPrice,
                            action: 'WOULD_SELL_CC' as const,
                          });
                          totalPremiumCollected += totalPremium;
                          console.log(`[Automation CC] ${bestOpp.symbol}: Best CC = $${bestOpp.strike} exp ${bestOpp.expiration} (DTE ${bestOpp.dte}, delta ${bestOpp.delta.toFixed(2)}, mid $${bestOpp.mid.toFixed(2)})`);
                        }
                      } catch (stockErr: any) {
                        console.error(`[Automation CC] Error scanning ${stock.symbol}:`, stockErr.message);
                      }
                    }
                  }
                }
              } catch (ccErr: any) {
                console.error(`[Automation CC] Error in CC scan for account ${account.accountNumber}:`, ccErr.message);
              }
            }

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
          ccScanResultsJson: JSON.stringify(ccScanResults),
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
            wouldSellCC: ccScanResults.length,
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

  /**
   * Submit BTC (Buy to Close) orders for selected positions from a dry-run scan
   */
  submitCloseOrders: protectedProcedure
    .input(
      z.object({
        orders: z.array(
          z.object({
            accountNumber: z.string(),
            optionSymbol: z.string(),
            symbol: z.string(),
            quantity: z.number(),
            buyBackCost: z.number(), // per-contract cost (already × multiplier)
            isEstimated: z.boolean(),
          })
        ),
        dryRun: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      const results: Array<{
        symbol: string;
        optionSymbol: string;
        success: boolean;
        orderId?: string;
        message: string;
      }> = [];

      for (const order of input.orders) {
        try {
          // Price per share = buyBackCost / (quantity * 100), rounded up to nearest $0.01
          const pricePerShare = order.buyBackCost / (order.quantity * 100);
          // Use a limit price slightly above current cost to ensure fill (add $0.01 buffer)
          const limitPrice = Math.max(0.01, Math.ceil((pricePerShare + 0.01) * 100) / 100);

          // Dry run: skip actual order submission
          if (input.dryRun) {
            console.log('[Automation submitCloseOrders] DRY RUN — would submit BTC order:', {
              symbol: order.symbol, optionSymbol: order.optionSymbol,
              accountNumber: order.accountNumber, quantity: order.quantity,
              pricePerShare, limitPrice, isEstimated: order.isEstimated,
            });
            results.push({
              symbol: order.symbol,
              optionSymbol: order.optionSymbol,
              success: true,
              orderId: `dry-run-${order.optionSymbol}`,
              message: `[Dry Run] Would submit BTC limit @ $${limitPrice.toFixed(2)}`,
            });
            continue;
          }

          console.log('[Automation submitCloseOrders] Submitting BTC order:', {
            symbol: order.symbol,
            optionSymbol: order.optionSymbol,
            accountNumber: order.accountNumber,
            quantity: order.quantity,
            pricePerShare,
            limitPrice,
            isEstimated: order.isEstimated,
          });

          const result = await tt.submitOrder({
            accountNumber: order.accountNumber,
            timeInForce: 'Day',
            orderType: 'Limit',
            price: limitPrice.toFixed(2),
            priceEffect: 'Debit',
            legs: [
              {
                instrumentType: 'Equity Option',
                symbol: order.optionSymbol,
                quantity: order.quantity.toString(),
                action: 'Buy to Close',
              },
            ],
          });

          console.log('[Automation submitCloseOrders] Order submitted:', {
            symbol: order.symbol,
            orderId: result.id,
            status: result.status,
          });

          results.push({
            symbol: order.symbol,
            optionSymbol: order.optionSymbol,
            success: true,
            orderId: result.id,
            message: `Order submitted (limit $${limitPrice.toFixed(2)})`,
          });
        } catch (error: any) {
          console.error('[Automation submitCloseOrders] Order failed:', {
            symbol: order.symbol,
            error: error.message,
          });
          results.push({
            symbol: order.symbol,
            optionSymbol: order.optionSymbol,
            success: false,
            message: error.message,
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return {
        results,
        successCount,
        failCount,
        totalOrders: results.length,
      };
    }),
});
