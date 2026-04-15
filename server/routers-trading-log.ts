/**
 * Trading Activity Log Router
 * Captures every order attempt (success, rejection, error) and provides
 * AI-powered diagnosis for failed orders.
 */
import { z } from 'zod';
import { protectedProcedure, router } from './_core/trpc';
import { getDb } from './db';
import { tradingLog } from '../drizzle/schema';
import { desc, eq, and } from 'drizzle-orm';
import { invokeLLM } from './_core/llm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TradingLogEntry {
  userId: number;
  symbol: string;
  optionSymbol?: string;
  accountNumber?: string;
  strategy: string;
  action: string;
  strike?: string;
  expiration?: string;
  quantity?: number;
  price?: string;
  priceEffect?: string;
  instrumentType?: string;
  outcome: 'pending' | 'filled' | 'success' | 'rejected' | 'error' | 'dry_run' | 'api_error';
  orderId?: string;
  errorMessage?: string;
  errorPayload?: string;
  source?: string;
  isDryRun?: boolean;
}

// ─── Helper: write a log entry (called from other routers) ────────────────────

export async function writeTradingLog(entry: TradingLogEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(tradingLog).values({
      userId: entry.userId,
      symbol: entry.symbol,
      optionSymbol: entry.optionSymbol ?? null,
      accountNumber: entry.accountNumber ?? null,
      strategy: entry.strategy,
      action: entry.action,
      strike: entry.strike ?? null,
      expiration: entry.expiration ?? null,
      quantity: entry.quantity ?? null,
      price: entry.price ?? null,
      priceEffect: entry.priceEffect ?? null,
      instrumentType: entry.instrumentType ?? null,
      outcome: entry.outcome,
      orderId: entry.orderId ?? null,
      errorMessage: entry.errorMessage ?? null,
      errorPayload: entry.errorPayload ?? null,
      source: entry.source ?? null,
      isDryRun: entry.isDryRun ?? false,
    });
  } catch (err) {
    // Never let logging failures crash the order flow
    console.error('[TradingLog] Failed to write log entry:', err);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const tradingLogRouter = router({
  /**
   * Get the last N trading log entries for the current user.
   */
  getEntries: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      outcomeFilter: z.enum(['all', 'pending', 'filled', 'success', 'rejected', 'error', 'dry_run', 'api_error']).default('all'),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const conditions = [eq(tradingLog.userId, userId)];
      if (input.outcomeFilter !== 'all') {
        conditions.push(eq(tradingLog.outcome, input.outcomeFilter));
      }
      const db = await getDb();
      if (!db) return [];
      const entries = await db
        .select()
        .from(tradingLog)
        .where(and(...conditions))
        .orderBy(desc(tradingLog.createdAt))
        .limit(input.limit);
      return entries;
    }),

  /**
   * Update the outcome of a trading log entry by orderId.
   * Called by the fill-polling heartbeat when Tastytrade confirms an order filled or rejected.
   */
  updateOutcome: protectedProcedure
    .input(z.object({
      orderId: z.string(),
      outcome: z.enum(['pending', 'filled', 'success', 'rejected', 'error']),
      filledPrice: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.update(tradingLog)
        .set({
          outcome: input.outcome,
          ...(input.filledPrice ? { price: input.filledPrice } : {}),
        })
        .where(and(
          eq(tradingLog.userId, ctx.user.id),
          eq(tradingLog.orderId, input.orderId),
        ));
      console.log(`[TradingLog] Updated order ${input.orderId} outcome → ${input.outcome}`);
      return { success: true };
    }),

  /**
   * Clear all log entries for the current user (housekeeping).
   */
  clearEntries: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.delete(tradingLog).where(eq(tradingLog.userId, ctx.user.id));
      return { success: true };
    }),

  /**
   * AI Diagnosis: given a log entry ID, generate a plain-English explanation
   * of what went wrong and what to do about it.
   */
  diagnose: protectedProcedure
    .input(z.object({ entryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch the entry
      const db = await getDb();
      if (!db) return { diagnosis: 'Database unavailable.' };
      const [entry] = await db
        .select()
        .from(tradingLog)
        .where(and(
          eq(tradingLog.id, input.entryId),
          eq(tradingLog.userId, ctx.user.id),
        ))
        .limit(1);

      if (!entry) {
        return { diagnosis: 'Log entry not found.' };
      }

      // If already diagnosed, return cached result
      if (entry.aiDiagnosis) {
        return { diagnosis: entry.aiDiagnosis };
      }

      // Build context for the LLM
      const orderContext = [
        `Symbol: ${entry.symbol}`,
        entry.optionSymbol ? `Option Symbol: ${entry.optionSymbol}` : null,
        `Strategy: ${entry.strategy}`,
        `Action: ${entry.action}`,
        entry.strike ? `Strike: $${entry.strike}` : null,
        entry.expiration ? `Expiration: ${entry.expiration}` : null,
        entry.quantity ? `Quantity: ${entry.quantity} contract(s)` : null,
        entry.price ? `Limit Price: $${entry.price}` : null,
        entry.priceEffect ? `Price Effect: ${entry.priceEffect}` : null,
        entry.instrumentType ? `Instrument Type: ${entry.instrumentType}` : null,
        entry.accountNumber ? `Account: ${entry.accountNumber}` : null,
        `Outcome: ${entry.outcome}`,
        entry.errorMessage ? `Error Message: ${entry.errorMessage}` : null,
        entry.errorPayload ? `Error Payload: ${entry.errorPayload}` : null,
        `Source: ${entry.source ?? 'unknown'}`,
        `Timestamp: ${entry.createdAt}`,
      ].filter(Boolean).join('\n');

      const systemPrompt = `You are an expert options trading assistant specializing in the Tastytrade API. 
A user's order attempt has failed or been rejected. Analyze the order details and error information, then provide:
1. A clear, plain-English explanation of what went wrong (1-2 sentences)
2. The most likely root cause
3. A specific, actionable fix the user or developer should apply
Keep your response concise and practical. Use trading terminology appropriately but explain any technical API terms.`;

      const userPrompt = `Please diagnose this failed Tastytrade order:\n\n${orderContext}`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        const rawContent = response.choices?.[0]?.message?.content;
        const diagnosis: string = typeof rawContent === 'string' ? rawContent : 'Unable to generate diagnosis.';

        // Cache the diagnosis in the DB
        await db!.update(tradingLog)
          .set({ aiDiagnosis: diagnosis })
          .where(eq(tradingLog.id, input.entryId));

        return { diagnosis };
      } catch (err: any) {
        return { diagnosis: `Diagnosis unavailable: ${err.message ?? 'LLM error'}` };
      }
    }),
});
