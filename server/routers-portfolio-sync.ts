/**
 * Portfolio Sync Router — Prosper Trading
 *
 * tRPC endpoints for triggering and monitoring portfolio data sync.
 * The sync engine populates cached_positions and cached_transactions tables,
 * which are then used by all AI advisors and analytics for fast, accurate data.
 */

import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import { syncPortfolio, getPortfolioSyncState } from './portfolio-sync';

export const portfolioSyncRouter = router({
  /**
   * Get the current sync state for all accounts.
   * Returns last sync time, transaction count, and sync status.
   */
  getSyncState: protectedProcedure.query(async ({ ctx }) => {
    const states = await getPortfolioSyncState(ctx.user.id);
    return { states };
  }),

  /**
   * Trigger a portfolio sync for the current user.
   * - forceFullRefresh=false (default): incremental — only fetches new transactions
   * - forceFullRefresh=true: re-fetches all 3 years of transactions
   *
   * This runs in the background and returns immediately with a status.
   * The frontend should poll getSyncState to track progress.
   */
  triggerSync: protectedProcedure
    .input(z.object({
      forceFullRefresh: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Run sync in background (non-blocking)
      // We fire-and-forget so the UI doesn't time out on initial 3-year loads
      syncPortfolio(ctx.user.id, input.forceFullRefresh).catch((err) => {
        console.error(`[PortfolioSync] Background sync failed for user ${ctx.user.id}:`, err.message);
      });

      return {
        success: true,
        message: input.forceFullRefresh
          ? 'Full portfolio sync started. This may take 30–60 seconds for the initial load.'
          : 'Incremental portfolio sync started.',
      };
    }),

  /**
   * Trigger a sync and wait for it to complete.
   * Use this when you need fresh data before an operation (e.g., before AI analysis).
   * For large initial loads, prefer triggerSync (non-blocking) instead.
   */
  triggerSyncAndWait: protectedProcedure
    .input(z.object({
      forceFullRefresh: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const results = await syncPortfolio(ctx.user.id, input.forceFullRefresh);

      const totalPositions = results.reduce((s, r) => s + r.positionsSynced, 0);
      const totalTransactions = results.reduce((s, r) => s + r.transactionsSynced, 0);
      const hasError = results.some((r) => !r.success);

      return {
        success: !hasError,
        results,
        summary: {
          accountsProcessed: results.length,
          positionsSynced: totalPositions,
          transactionsSynced: totalTransactions,
          isInitialLoad: results.some((r) => r.isInitialLoad),
        },
        message: hasError
          ? `Sync completed with errors. ${totalPositions} positions and ${totalTransactions} transactions synced.`
          : `Sync complete: ${totalPositions} positions and ${totalTransactions} transactions cached.`,
      };
    }),
});
