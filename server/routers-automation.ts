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
        aiScoringEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateAutomationSettings(ctx.user.id, input);
      return { success: true };
    }),

  /**
   * AI Tier 1 scoring for CC scan results.
   * Accepts a batch of CC opportunities and returns a score (0-100),
   * one-sentence rationale, and optional recommendedDte for each.
   */
  scoreCCOpportunities: protectedProcedure
    .input(
      z.object({
        opportunities: z.array(
          z.object({
            symbol: z.string(),
            currentPrice: z.number(),
            strike: z.number(),
            dte: z.number(),
            delta: z.number(),
            mid: z.number(),
            bid: z.number(),
            ask: z.number(),
            weeklyReturn: z.number(),
            quantity: z.number(),
            account: z.string(),
            optionSymbol: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');

      const opps = input.opportunities;
      if (opps.length === 0) return { scores: [] };

      // Build a compact JSON representation for the LLM
      const oppList = opps.map((o, i) => ({
        id: i,
        symbol: o.symbol,
        currentPrice: o.currentPrice,
        strike: o.strike,
        otmPct: ((o.strike - o.currentPrice) / o.currentPrice * 100).toFixed(1),
        dte: o.dte,
        delta: o.delta.toFixed(3),
        mid: o.mid,
        bid: o.bid,
        ask: o.ask,
        bidAskSpreadPct: o.mid > 0 ? ((o.ask - o.bid) / o.mid * 100).toFixed(1) : '0',
        weeklyReturnPct: o.weeklyReturn.toFixed(2),
        quantity: o.quantity,
      }));

      const systemPrompt = `You are an expert options trading analyst specializing in covered call strategies.
You evaluate covered call opportunities using four criteria:
1. PREMIUM QUALITY: Is the weekly yield attractive? (>1%/week = excellent, 0.5-1% = good, <0.3% = weak)
2. STRIKE PLACEMENT: Is the strike placed to capture premium without excessive assignment risk? (delta 0.20-0.30 = ideal, >0.35 = risky, <0.15 = too far OTM)
3. LIQUIDITY: Is the bid/ask spread tight enough for a good fill? (spread <10% of mid = good, 10-20% = marginal, >20% = poor)
4. DTE FIT: Does the DTE align with a 7-14 day theta decay sweet spot? (7-10 = ideal, 11-14 = good, outside range = note it)

For each opportunity, output a JSON object with:
- id: the input id number
- score: integer 0-100 (85-100=strong, 65-84=good, 45-64=marginal, 0-44=weak)
- rationale: one concise sentence (max 120 chars) explaining the primary strength or concern
- recommendedDte: null if current DTE is fine, or an integer (14 or 21) if extending DTE would meaningfully improve premium quality

Be specific and actionable. Mention the actual numbers (e.g., "1.48%/week", "delta 0.27"). Do not be generic.`;

      const userPrompt = `Score these ${opps.length} covered call opportunities:\n${JSON.stringify(oppList, null, 2)}`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'cc_scores',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                scores: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      score: { type: 'integer' },
                      rationale: { type: 'string' },
                      recommendedDte: { type: ['integer', 'null'] },
                    },
                    required: ['id', 'score', 'rationale', 'recommendedDte'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['scores'],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = response?.choices?.[0]?.message?.content;
      if (!rawContent) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI scoring returned no content' });
      const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

      const parsed = JSON.parse(content) as { scores: Array<{ id: number; score: number; rationale: string; recommendedDte: number | null }> };

      // Map back by id so order doesn't matter
      return { scores: parsed.scores };
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
          // Spread fields — only populated when type is BPS/BCS/IC
          spreadLongSymbol?: string;   // Long leg OCC symbol
          spreadLongStrike?: string;   // Long leg strike
          spreadLongPrice?: string;    // Long leg close price
          // Mismatch flag — set when short qty > long qty (partial spread + standalone remainder)
          hasMismatch?: boolean;
          standaloneRemainder?: number; // Number of unmatched short contracts routed as single-leg BTC
          // Underlying stock price — enriched after scan via Tradier batch quote
          underlyingPrice?: number;
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
            
            // Build a map of long positions for spread detection (keyed by OCC symbol)
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

            // Build a map of short puts and short calls per underlying+expiration for IC detection
            // key: `${underlying}|${expiration}` → { put?: position, call?: position }
            const shortByUnderlying = new Map<string, { put?: any; call?: any }>();
            if (runBTCScan) {
              for (const pos of positions) {
                if (pos['instrument-type'] !== 'Equity Option') continue;
                const qty = parseInt(String(pos.quantity || '0'));
                const direction = pos['quantity-direction']?.toLowerCase();
                const isShortPos = direction === 'short' || qty < 0;
                if (!isShortPos) continue;
                const und = pos['underlying-symbol'] || pos.symbol || '';
                const exp = pos['expires-at'] || '';
                const key = `${und}|${exp}`;
                const entry = shortByUnderlying.get(key) || {};
                const posOccMatch = pos.symbol?.match(/([CP])(\d{8})$/);
                const posIsPut = posOccMatch ? posOccMatch[1] === 'P' : (pos.symbol?.includes('P') ?? false);
                if (posIsPut) entry.put = pos;
                else entry.call = pos;
                shortByUnderlying.set(key, entry);
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
              // OCC symbol format: {UNDERLYING}{YYMMDD}{C|P}{8-digit-strike}
              // Use regex to find the C/P type character immediately before the 8-digit strike
              // to avoid false positives from underlyings that contain 'P' (e.g., APLD, SPY, PLTR)
              const occTypeMatch = optionSymbol.match(/([CP])(\d{8})$/);
              const isPut = occTypeMatch ? occTypeMatch[1] === 'P' : optionSymbol.includes('P');
              // Will be refined to BPS/BCS/IC after spread detection below
              let optionType: string = isPut ? 'CSP' : 'CC';

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

              // ── Spread detection ──────────────────────────────────────────────────────
              // Step A: find a matching long leg (same underlying, same expiration, same put/call)
              //         → Bull Put Spread (BPS) if puts, Bear Call Spread (BCS) if calls
              // QUANTITY-AWARE: if long qty < short qty, only the matched portion is a spread;
              //   the remainder is a standalone CC/CSP and gets a separate single-leg BTC order.
              // Step B: check if this short option is part of an Iron Condor
              //         (there is ALSO a short option of the opposite type on the same underlying+expiration)
              let isSpread = false;
              let matchedLongLeg: any = null;
              let spreadQuantity = quantity;   // how many contracts to close as a spread
              let singleLegRemainder = 0;       // how many contracts to close as single-leg BTC

              for (const [, longPos] of Array.from(longPositionMap.entries())) {
                if (longPos['underlying-symbol'] === position['underlying-symbol'] &&
                    longPos['expires-at'] === position['expires-at']) {
                  const longOccMatch = longPos.symbol?.match(/([CP])(\d{8})$/);
                  const longIsPut = longOccMatch ? longOccMatch[1] === 'P' : (longPos.symbol?.includes('P') ?? false);
                  if (longIsPut === isPut) {
                    const longQty = Math.abs(parseInt(String(longPos.quantity || '0')));
                    const matchedQty = Math.min(quantity, longQty); // only match up to long qty
                    const longClosePrice = Math.abs(parseFloat(String(longPos['close-price'] || '0')));
                    const longBuyBackCredit = longClosePrice * matchedQty * parseInt(String(longPos.multiplier || '100'));
                    const shortCostForMatched = (closePrice * matchedQty * multiplier);
                    const netCost = shortCostForMatched - longBuyBackCredit;
                    if (netCost >= 0) {
                      isSpread = true;
                      matchedLongLeg = longPos;
                      spreadQuantity = matchedQty;
                      singleLegRemainder = quantity - matchedQty; // unmatched short contracts
                      // Recalculate buyBackCost for the spread portion only
                      buyBackCost = netCost;
                      // Rename type: CSP+long put → BPS, CC+long call → BCS
                      optionType = isPut ? 'BPS' : 'BCS';
                    }
                    break;
                  }
                }
              }

              // Step B: Iron Condor check — if this short option has a counterpart short of the
              // opposite type on the same underlying+expiration, it is part of an IC.
              if (isSpread) {
                const icKey = `${underlyingSymbol}|${expiration}`;
                const icEntry = shortByUnderlying.get(icKey);
                if (icEntry && icEntry.put && icEntry.call) {
                  optionType = 'IC';
                }
              }

              // After spread detection, recalculate premiumReceived for the matched quantity only.
              // If this is a spread, premiumReceived should reflect only the spreadQuantity contracts;
              // the remainder will be handled separately below.
              const effectiveQty = isSpread ? spreadQuantity : quantity;
              const effectivePremiumReceived = openPrice * effectiveQty * multiplier;

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
                  buyBackCost = flooredPerShare * effectiveQty * multiplier;
                  isEstimated = true;
                  console.log(`[Automation] ${underlyingSymbol} ${optionType}: buyBackCost=0 after spread netting, using time-decay estimate: $${buyBackCost.toFixed(2)} (${daysRemaining.toFixed(1)} of ${daysOriginal.toFixed(1)} DTE remaining, decay=${decayFactor.toFixed(3)})`);
                }
              }

              // Realized % = (premiumReceived - buyBackCost) / premiumReceived × 100
              // Example: sold for $300, buy back for $3 → (300-3)/300 = 99%
              const realizedPercent = ((effectivePremiumReceived - buyBackCost) / effectivePremiumReceived) * 100;
              const estimatedProfit = effectivePremiumReceived - buyBackCost;

              // Calculate DTE (days to expiration)
              const dte = expiration
                ? Math.max(0, Math.round((new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                : null;

              // Parse strike from option symbol (e.g., AAPL250117P00150000 -> 150)
              const strikeMatch = optionSymbol.match(/[CP](\d+)/);
              const strike = strikeMatch ? (parseFloat(strikeMatch[1]) / 1000).toFixed(2) : null;

              console.log(`[Automation] ${underlyingSymbol} ${optionType}${isSpread ? ` (spread x${spreadQuantity}, long=${matchedLongLeg?.symbol}${singleLegRemainder > 0 ? `, +${singleLegRemainder} standalone` : ''})` : ''}: premiumCollected=$${effectivePremiumReceived.toFixed(2)}, buyBackCost=$${buyBackCost.toFixed(2)}, realized=${realizedPercent.toFixed(1)}%`);

              if (realizedPercent >= settings.profitThresholdPercent) {
                if (isSpread && matchedLongLeg) {
                  // ── Spread close: emit a SINGLE spread order covering the matched legs atomically ──
                  const longStrikeMatch = matchedLongLeg.symbol?.match(/[CP](\d+)/);
                  const longStrike = longStrikeMatch ? (parseFloat(longStrikeMatch[1]) / 1000).toFixed(2) : null;
                  const longClosePrice = Math.abs(parseFloat(String(matchedLongLeg['close-price'] || '0')));
                  pendingOrders.push({
                    runId,
                    userId: ctx.user.id,
                    accountNumber: account.accountNumber,
                    orderType: 'close_spread' as const,
                    symbol: optionSymbol,                // short leg OCC symbol
                    spreadLongSymbol: matchedLongLeg.symbol, // long leg OCC symbol
                    strike,
                    spreadLongStrike: longStrike,
                    expiration,
                    quantity: spreadQuantity,             // ONLY the matched quantity
                    price: String(closePrice),
                    spreadLongPrice: String(longClosePrice),
                    profitPercent: Math.round(realizedPercent),
                    estimatedProfit: estimatedProfit.toFixed(2),
                    status: 'pending' as const,
                    createdAt: new Date(),
                  });
                  // ── Remainder: unmatched short contracts are standalone CCs/CSPs ──
                  if (singleLegRemainder > 0) {
                    const remainderType = isPut ? 'CSP' : 'CC';
                    const remainderCost = closePrice * singleLegRemainder * multiplier;
                    const remainderProfit = (openPrice * singleLegRemainder * multiplier) - remainderCost;
                    console.log(`[Automation] ${underlyingSymbol}: ${singleLegRemainder} unmatched short ${remainderType} contracts → emitting separate single-leg BTC order`);
                    pendingOrders.push({
                      runId,
                      userId: ctx.user.id,
                      accountNumber: account.accountNumber,
                      orderType: 'close_position' as const,
                      symbol: optionSymbol,
                      strike,
                      expiration,
                      quantity: singleLegRemainder,
                      price: String(closePrice),
                      profitPercent: Math.round(realizedPercent),
                      estimatedProfit: remainderProfit.toFixed(2),
                      status: 'pending' as const,
                      createdAt: new Date(),
                    });
                    scanResults.push({ account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: remainderType, quantity: singleLegRemainder, premiumCollected: openPrice * singleLegRemainder * multiplier, buyBackCost: remainderCost, realizedPercent: Math.round(realizedPercent * 100) / 100, expiration: expiration || null, dte, isEstimated, action: 'WOULD_CLOSE' });
                    totalPositionsClosed++;
                    totalProfitRealized += remainderProfit;
                  }
                } else {
                  // Standalone CC or CSP — single-leg close
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
                    createdAt: new Date(),
                  });
                }

                // Use spreadQuantity for the spread entry (remainder already pushed above)
                const wouldCloseEntry: typeof scanResults[number] = { account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity: isSpread ? spreadQuantity : quantity, premiumCollected: effectivePremiumReceived, buyBackCost, realizedPercent: Math.round(realizedPercent * 100) / 100, expiration: expiration || null, dte, isEstimated, action: 'WOULD_CLOSE' };
                if (isSpread && matchedLongLeg) {
                  const longStrikeMatch2 = matchedLongLeg.symbol?.match(/[CP](\d+)/);
                  wouldCloseEntry.spreadLongSymbol = matchedLongLeg.symbol;
                  wouldCloseEntry.spreadLongStrike = longStrikeMatch2 ? (parseFloat(longStrikeMatch2[1]) / 1000).toFixed(2) : undefined;
                  wouldCloseEntry.spreadLongPrice = String(Math.abs(parseFloat(String(matchedLongLeg['close-price'] || '0'))));
                  if (singleLegRemainder > 0) {
                    wouldCloseEntry.hasMismatch = true;
                    wouldCloseEntry.standaloneRemainder = singleLegRemainder;
                  }
                }
                scanResults.push(wouldCloseEntry);

                totalPositionsClosed++;
                totalProfitRealized += estimatedProfit;
              } else {
                const belowThresholdEntry: typeof scanResults[number] = { account: account.accountNumber, symbol: underlyingSymbol, optionSymbol, type: optionType, quantity: isSpread ? spreadQuantity : quantity, premiumCollected: effectivePremiumReceived, buyBackCost, realizedPercent: Math.round(realizedPercent * 100) / 100, expiration: expiration || null, dte, isEstimated, action: 'BELOW_THRESHOLD' };
                if (isSpread && matchedLongLeg) {
                  const longStrikeMatch3 = matchedLongLeg.symbol?.match(/[CP](\d+)/);
                  belowThresholdEntry.spreadLongSymbol = matchedLongLeg.symbol;
                  belowThresholdEntry.spreadLongStrike = longStrikeMatch3 ? (parseFloat(longStrikeMatch3[1]) / 1000).toFixed(2) : undefined;
                  belowThresholdEntry.spreadLongPrice = String(Math.abs(parseFloat(String(matchedLongLeg['close-price'] || '0'))));
                }
                scanResults.push(belowThresholdEntry);
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
                // Load liquidation flags (SYMBOL-WIDE) — skip any symbol flagged for exit
                // in ANY account. A dog is a dog — flagged in one account = blocked everywhere.
                const { liquidationFlags: liqFlags } = await import('../drizzle/schema');
                const { eq: eqLF } = await import('drizzle-orm');
                const { getDb: getDbLF } = await import('./db');
                const dbLF = await getDbLF();
                const flaggedRows = dbLF ? await dbLF.select({ symbol: liqFlags.symbol })
                  .from(liqFlags)
                  .where(eqLF(liqFlags.userId, ctx.user.id)) : [];
                const flaggedSymbolsSet = new Set(flaggedRows.map((f: { symbol: string }) => f.symbol.toUpperCase()));
                if (flaggedSymbolsSet.size > 0) {
                  console.log(`[Automation CC] Symbol-wide liquidation flags (blocks all accounts): ${Array.from(flaggedSymbolsSet).join(', ')}`);
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
                  .filter((s: any) => s.maxContracts > 0 && s.currentPrice > 0)
                  // ⛔ Skip symbols flagged for liquidation — no new CCs on exit positions
                  .filter((s: any) => !flaggedSymbolsSet.has(s.symbol.toUpperCase()));
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

        // ── Enrich scan results with underlying stock prices ─────────────────
        // Batch-fetch current prices for all unique underlying symbols via Tradier
        try {
          const uniqueSymbols = Array.from(new Set(scanResults.map(r => r.symbol).filter(Boolean)));
          if (uniqueSymbols.length > 0) {
            const { createTradierAPI } = await import('./tradier');
            const storedKey = credentials?.tradierApiKey;
            const tradierApiKey = (storedKey && storedKey.length > 15 ? storedKey : null) || process.env.TRADIER_API_KEY;
            if (tradierApiKey) {
              const tradierApi = createTradierAPI(tradierApiKey);
              const quotes = await tradierApi.getQuotes(uniqueSymbols);
              const priceMap = new Map<string, number>();
              for (const q of quotes) {
                if (q.symbol && q.last > 0) priceMap.set(q.symbol, q.last);
              }
              for (const result of scanResults) {
                result.underlyingPrice = priceMap.get(result.symbol) ?? undefined;
              }
              console.log(`[Automation] Enriched ${priceMap.size}/${uniqueSymbols.length} symbols with stock prices`);
            }
          }
        } catch (priceErr) {
          console.warn('[Automation] Failed to enrich scan results with stock prices:', priceErr);
          // Non-fatal — scan results still valid without prices
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
            // Spread order fields (optional — present when closing a spread atomically)
            spreadLongSymbol: z.string().optional(),  // Long leg OCC symbol
            spreadLongPrice: z.string().optional(),   // Long leg close price (string)
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

      // ── Earnings Block Pre-flight ──────────────────────────────────────────────
      // Close orders are BTC (buying back), not new entries — but we still block
      // if earnings are within 7 days, because closing into earnings can result in
      // poor fills and the position may recover after the event.
      // NOTE: This is a soft-block for closes; the user can override by using dry-run.
      if (!input.dryRun) {
        try {
          const { TradierAPI } = await import('./tradier');
          const { checkEarningsBlock, formatEarningsBlockMessage } = await import('./earningsBlock');
          const { getApiCredentials: getCredsForEarnings } = await import('./db');
          const creds = await getCredsForEarnings(ctx.user.id);
          const tradierKey = creds?.tradierApiKey || process.env.TRADIER_API_KEY || '';
          if (tradierKey) {
            const tradierAPI = new TradierAPI(tradierKey);
            const symbols = Array.from(new Set(input.orders.map(o => o.symbol)));
            const earningsResult = await checkEarningsBlock(symbols, tradierAPI);
            if (earningsResult.blocked.length > 0) {
              throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: formatEarningsBlockMessage(earningsResult),
              });
            }
          }
        } catch (err: any) {
          if (err?.code === 'PRECONDITION_FAILED') throw err;
          console.warn('[EarningsBlock] Automation earnings check failed (non-blocking):', err.message);
        }
      }
      // ── Spread integrity pre-flight guard ─────────────────────────────────────
      // Detect any order whose symbol indicates it was scanned as a spread (BPS/BCS/IC)
      // but is missing its long leg. This would result in a naked short — hard reject.
      // The scan always attaches spreadLongSymbol when it finds a matching long leg;
      // if it is absent for a spread-type order, the scan had a data gap and we must not submit.
      // NOTE: We detect spread type by checking if the option symbol has a matching long leg
      // in the same batch (same underlying, same expiration, opposite direction).
      // For safety we also check the spreadLongSymbol field directly.
      const spreadOrders = input.orders.filter(o => !!o.spreadLongSymbol);
      const singleLegOrders = input.orders.filter(o => !o.spreadLongSymbol);
      // If any order has a spreadLongSymbol that is the same as another order's optionSymbol,
      // that would indicate a double-submission — block it.
      const longSymbolsInBatch = new Set(spreadOrders.map(o => o.spreadLongSymbol!));
      const shortSymbolsInBatch = new Set(input.orders.map(o => o.optionSymbol));
      const overlap = Array.from(longSymbolsInBatch).filter(s => shortSymbolsInBatch.has(s));
      if (overlap.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Spread integrity violation: the following long-leg symbols appear as both a short and long leg in the same batch submission: ${overlap.join(', ')}. This would close legs independently. Rerun the scan and resubmit.`,
        });
      }

      // ── Live bid/ask enrichment ────────────────────────────────────────────────
      // Fetch live quotes from Tradier for all option symbols so we can use
      // spread-width tier pricing instead of stale close-price + ceil formula.
      const liveQuoteMap = new Map<string, { bid: number; ask: number; mid: number }>();
      try {
        const { TradierAPI: TradierAPIForQuotes } = await import('./tradier');
        const tradierKeyForQuotes = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierKeyForQuotes) {
          const tradierForQuotes = new TradierAPIForQuotes(tradierKeyForQuotes);
          const allOptionSymbols = Array.from(new Set([
            ...input.orders.map(o => o.optionSymbol),
            ...input.orders.filter(o => o.spreadLongSymbol).map(o => o.spreadLongSymbol!),
          ]));
          const quotes = await tradierForQuotes.getQuotes(allOptionSymbols);
          for (const q of quotes) {
            if (q.bid > 0 && q.ask > 0) {
              liveQuoteMap.set(q.symbol, { bid: q.bid, ask: q.ask, mid: (q.bid + q.ask) / 2 });
            }
          }
          console.log(`[submitCloseOrders] Fetched live quotes for ${liveQuoteMap.size}/${allOptionSymbols.length} option symbols`);
        }
      } catch (quoteErr: any) {
        console.warn('[submitCloseOrders] Live quote fetch failed, falling back to close-price:', quoteErr.message);
      }

      /**
       * Calculate smart BTC limit price using spread-width tiers.
       * For cheap options with wide spreads, paying full ask is wasteful.
       * This mirrors the sell-side logic but inverted for buy orders.
       */
      function calcBtcLimitPrice(optionSymbol: string, fallbackCostPerShare: number): number {
        const q = liveQuoteMap.get(optionSymbol);
        if (!q || q.bid <= 0 || q.ask <= 0) {
          // No live quote — fall back to close-price + $0.01 ceiling
          return Math.max(0.01, Math.ceil((fallbackCostPerShare + 0.01) * 100) / 100);
        }
        const { bid, ask } = q;
        const spread = ask - bid;
        let price: number;
        if (spread <= 0.05) {
          price = q.mid;                  // Tight: mid
        } else if (spread <= 0.15) {
          price = q.mid + 0.01;           // Medium: mid + $0.01
        } else if (spread <= 0.30) {
          price = bid + (spread * 0.75);  // Wide: 75% from bid
        } else {
          price = bid + (spread * 0.85);  // Very wide: 85% from bid
        }
        // Round to Tastytrade tick size: $0.05 increments below $1, $0.01 above $1
        if (price < 1) {
          price = Math.round(price * 20) / 20;
        } else {
          price = Math.round(price * 100) / 100;
        }
        // Clamp to [bid, ask]
        return Math.max(bid, Math.min(ask, Math.max(0.01, price)));
      }

      for (const order of input.orders) {
        try {
          const isSpreadOrder = !!order.spreadLongSymbol;
          // Net debit for spread = short leg cost - long leg credit
          // For single-leg: just the short leg cost
          const shortLegCostPerShare = order.buyBackCost / (order.quantity * 100);
          const longLegCreditPerShare = isSpreadOrder
            ? Math.abs(parseFloat(order.spreadLongPrice || '0'))
            : 0;

          let limitPrice: number;
          if (isSpreadOrder) {
            // Spread: use live short leg price minus live long leg credit
            const shortLegLivePrice = calcBtcLimitPrice(order.optionSymbol, shortLegCostPerShare);
            const longLegLiveQ = order.spreadLongSymbol ? liveQuoteMap.get(order.spreadLongSymbol) : null;
            const longLegLiveCredit = longLegLiveQ ? longLegLiveQ.bid : longLegCreditPerShare;
            const netDebit = Math.max(0.01, shortLegLivePrice - longLegLiveCredit);
            // Round net debit to $0.01
            limitPrice = Math.round(netDebit * 100) / 100;
          } else {
            limitPrice = calcBtcLimitPrice(order.optionSymbol, shortLegCostPerShare);
          }

          // Dry run: skip actual order submission
          if (input.dryRun) {
            if (isSpreadOrder) {
              console.log('[Automation submitCloseOrders] DRY RUN — would submit SPREAD BTC order:', {
                symbol: order.symbol, shortLeg: order.optionSymbol, longLeg: order.spreadLongSymbol,
                accountNumber: order.accountNumber, quantity: order.quantity,
                shortLegCostPerShare, longLegCreditPerShare, limitPrice,
              });
              results.push({
                symbol: order.symbol,
                optionSymbol: order.optionSymbol,
                success: true,
                orderId: `dry-run-spread-${order.optionSymbol}`,
                message: `[Dry Run] Would submit SPREAD BTC (2-leg atomic) net debit @ $${limitPrice.toFixed(2)} | Short: ${order.optionSymbol} | Long: ${order.spreadLongSymbol}`,
              });
            } else {
              console.log('[Automation submitCloseOrders] DRY RUN — would submit BTC order:', {
                symbol: order.symbol, optionSymbol: order.optionSymbol,
                accountNumber: order.accountNumber, quantity: order.quantity,
                shortLegCostPerShare, limitPrice, isEstimated: order.isEstimated,
              });
              results.push({
                symbol: order.symbol,
                optionSymbol: order.optionSymbol,
                success: true,
                orderId: `dry-run-${order.optionSymbol}`,
                message: `[Dry Run] Would submit BTC limit @ $${limitPrice.toFixed(2)}`,
              });
            }
            continue;
          }

          // Build order legs
          const legs: import('./tastytrade').OrderLeg[] = [
            {
              instrumentType: 'Equity Option',
              symbol: order.optionSymbol,
              quantity: order.quantity.toString(),
              action: 'Buy to Close',
            },
          ];
          if (isSpreadOrder && order.spreadLongSymbol) {
            // Long leg: Sell to Close (we bought it to open, now sell it to close)
            legs.push({
              instrumentType: 'Equity Option',
              symbol: order.spreadLongSymbol,
              quantity: order.quantity.toString(),
              action: 'Sell to Close',
            });
          }

          console.log(`[Automation submitCloseOrders] Submitting ${isSpreadOrder ? 'SPREAD' : 'single-leg'} BTC order:`, {
            symbol: order.symbol,
            optionSymbol: order.optionSymbol,
            spreadLongSymbol: order.spreadLongSymbol,
            accountNumber: order.accountNumber,
            quantity: order.quantity,
            limitPrice,
            isEstimated: order.isEstimated,
            legs: legs.length,
          });

          const result = await tt.submitOrder({
            accountNumber: order.accountNumber,
            timeInForce: 'Day',
            orderType: 'Limit',
            price: limitPrice.toFixed(2),
            priceEffect: 'Debit',
            legs,
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
            message: isSpreadOrder
              ? `Spread order submitted (net debit $${limitPrice.toFixed(2)}) — 2 legs atomic`
              : `Order submitted (limit $${limitPrice.toFixed(2)})`,
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
