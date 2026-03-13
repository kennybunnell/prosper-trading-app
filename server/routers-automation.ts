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
        ccSymbolFilter: z.array(z.string()).optional(), // when set, only scan these symbols for CC (Tranche 2 rescan)
        ccDteOverride: z.object({ min: z.number(), max: z.number() }).optional(), // override DTE range for CC scan
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
          // ITM demoted — set by safety guard when buyBackCost >= premiumCollected (position is at a loss)
          itmDemoted?: boolean;
          // Roll suggestion — populated for ITM CCs by the roll advisor step
          rollSuggestion?: {
            newStrike: number;
            newExpiration: string;
            estimatedCredit: number;
            newDte: number;
          };
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
                    // SAFETY: never match the same OCC symbol as both short and long leg.
                    // This can happen when Tastytrade returns a long position with the same
                    // symbol as the short (e.g., stale data or IC where both legs share a strike).
                    // Normalise symbols (strip spaces) before comparing.
                    const normLongSym = (longPos.symbol || '').replace(/\s+/g, '');
                    const normShortSym = optionSymbol.replace(/\s+/g, '');
                    if (normLongSym === normShortSym) {
                      console.warn(`[Automation] Skipping self-match: long leg symbol ${longPos.symbol} equals short leg ${optionSymbol}`);
                      continue;
                    }
                    // SAFETY: long-leg strike must differ from short-leg strike for a valid spread.
                    const shortStrikeNum = occTypeMatch ? parseInt(occTypeMatch[2], 10) : 0;
                    const longStrikeNum = longOccMatch ? parseInt(longOccMatch[2], 10) : 0;
                    if (shortStrikeNum !== 0 && longStrikeNum !== 0 && shortStrikeNum === longStrikeNum) {
                      console.warn(`[Automation] Skipping same-strike match: ${optionSymbol} and ${longPos.symbol} have the same strike ${shortStrikeNum}`);
                      continue;
                    }
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
              // MINIMUM FLOOR: spreads/ICs always have at least $0.05/share residual cost to close.
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
                  // Floor at $0.05/share minimum for spreads/ICs (two legs to close, always some residual)
                  // Single-leg options use $0.01/share floor
                  const minFloor = isSpread ? 0.05 : 0.01;
                  const flooredPerShare = Math.max(minFloor, estimatedPerShare);
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
                // Identify existing NAKED short calls to avoid over-covering.
                // IC/BCS short calls are protected by a long call at a higher strike on the same
                // expiration — they do NOT consume CC coverage capacity.
                // Algorithm: for each underlying, match short calls with long calls (same expiration).
                // Only unmatched short calls (true naked CCs) consume coverage capacity.
                const shortCallsByExpiry: Record<string, Record<string, number>> = {}; // underlying -> expiry -> qty
                const longCallsByExpiry: Record<string, Record<string, number>> = {};  // underlying -> expiry -> qty
                for (const opt of optionPositions) {
                  const sym = (opt as any).symbol as string;
                  // OCC symbol format: "TSLA  260313C00402500" — option_type is at position after spaces
                  const isCall = sym.replace(/\s+/, '').match(/^[A-Z]+\d{6}C/);
                  if (!isCall) continue;
                  const underlying = (opt as any)['underlying-symbol'] as string;
                  const expiry = (opt as any)['expiration-date'] as string || sym.slice(6, 12);
                  const qty = Math.abs(parseFloat((opt as any).quantity));
                  const dir = (opt as any)['quantity-direction'];
                  if (dir === 'Short') {
                    if (!shortCallsByExpiry[underlying]) shortCallsByExpiry[underlying] = {};
                    shortCallsByExpiry[underlying][expiry] = (shortCallsByExpiry[underlying][expiry] || 0) + qty;
                  } else if (dir === 'Long') {
                    if (!longCallsByExpiry[underlying]) longCallsByExpiry[underlying] = {};
                    longCallsByExpiry[underlying][expiry] = (longCallsByExpiry[underlying][expiry] || 0) + qty;
                  }
                }
                // For each underlying, naked short calls = max(0, total_short - total_long) per expiry
                // (long calls at any strike on the same expiry protect the short call leg of a spread)
                const shortCalls: Record<string, number> = {};
                for (const underlying of Object.keys(shortCallsByExpiry)) {
                  const shortByExpiry = shortCallsByExpiry[underlying];
                  const longByExpiry = longCallsByExpiry[underlying] || {};
                  let nakedCount = 0;
                  for (const expiry of Object.keys(shortByExpiry)) {
                    const shortQty = shortByExpiry[expiry];
                    const longQty = longByExpiry[expiry] || 0;
                    nakedCount += Math.max(0, shortQty - longQty);
                  }
                  if (nakedCount > 0) shortCalls[underlying] = nakedCount;
                  console.log(`[Automation CC] ${underlying}: shortCalls=${JSON.stringify(shortByExpiry)}, longCalls=${JSON.stringify(longByExpiry)}, nakedCCs=${nakedCount}`);
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
                const ccSymbolFilterSet = input.ccSymbolFilter && input.ccSymbolFilter.length > 0
                  ? new Set(input.ccSymbolFilter.map((s: string) => s.toUpperCase()))
                  : null;
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
                  .filter((s: any) => !flaggedSymbolsSet.has(s.symbol.toUpperCase()))
                  // 🔍 Tranche 2 rescan: only scan the specified symbols when ccSymbolFilter is set
                  .filter((s: any) => !ccSymbolFilterSet || ccSymbolFilterSet.has(s.symbol.toUpperCase()));
                if (ccSymbolFilterSet) {
                  console.log(`[Automation CC] Tranche 2 rescan — filtering to symbols: ${Array.from(ccSymbolFilterSet).join(', ')}`);
                }
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
                    // Use DTE override if provided (Tranche 2 rescan with AI-recommended DTE)
                    const effectiveDteMin = input.ccDteOverride?.min ?? settings.ccDteMin;
                    const effectiveDteMax = input.ccDteOverride?.max ?? settings.ccDteMax;
                    if (input.ccDteOverride) {
                      console.log(`[Automation CC] DTE override: ${effectiveDteMin}-${effectiveDteMax} days (Tranche 2 rescan)`);
                    }
                    const today = new Date();
                    for (const stock of eligibleStocks) {
                      try {
                        const expirations = await tradierApi.getExpirations(stock.symbol);
                        const validExpirations = expirations.filter((exp: string) => {
                          const dte = Math.ceil((new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                          return dte >= effectiveDteMin && dte <= effectiveDteMax;
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

        // ── Enrich scan results with live option marks + underlying stock prices ──
        // IMPORTANT: fetch live option marks FIRST so buyBackCost and realizedPercent
        // reflect the current market price, not the stale previous-day close-price.
        // This prevents ITM options (stock gapped up overnight) from showing as
        // "Ready to Close" when the actual buyback cost exceeds the premium collected.
        try {
          // OCC symbols from Tastytrade contain spaces (e.g. "NBIS  260320C00103000").
          // Tradier requires space-free OCC symbols (e.g. "NBIS260320C00103000").
          // Build a map: normalizedSymbol → originalSymbol so we can look up results.
          const normalizeOCC = (s: string) => s.replace(/\s+/g, '');
          const rawOptionSymbols = Array.from(
            new Set(
              scanResults
                .filter(r => r.optionSymbol && r.action !== 'SKIPPED')
                .flatMap(r => [
                  r.optionSymbol,
                  ...(r.spreadLongSymbol ? [r.spreadLongSymbol] : []),
                ])
            )
          );
          // Map normalized → original for reverse lookup after Tradier responds
          const normToOrig = new Map<string, string>();
          for (const sym of rawOptionSymbols) {
            normToOrig.set(normalizeOCC(sym), sym);
          }
          const normalizedSymbols = Array.from(normToOrig.keys());

          if (normalizedSymbols.length > 0) {
            const { createTradierAPI } = await import('./tradier');
            const storedKey = credentials?.tradierApiKey;
            const tradierApiKey = (storedKey && storedKey.length > 15 ? storedKey : null) || process.env.TRADIER_API_KEY;
            if (tradierApiKey) {
              const tradierApi = createTradierAPI(tradierApiKey);
              console.log(`[Automation] Fetching live option marks for ${normalizedSymbols.length} symbols (sample: ${normalizedSymbols.slice(0, 3).join(', ')})`);
              const liveOptionQuotes = await tradierApi.getQuotes(normalizedSymbols);
              // Build mark map keyed by ORIGINAL symbol (with spaces) for easy lookup
              const liveMarkMap = new Map<string, number>();
              for (const q of liveOptionQuotes) {
                const mid = (q.bid + q.ask) / 2;
                const mark = mid > 0 ? mid : (q.last > 0 ? q.last : 0);
                if (q.symbol && mark > 0) {
                  const origSym = normToOrig.get(q.symbol) ?? q.symbol;
                  liveMarkMap.set(origSym, mark);   // original (with spaces)
                  liveMarkMap.set(q.symbol, mark);  // normalized (no spaces)
                }
              }
              console.log(`[Automation] Live option marks fetched for ${liveMarkMap.size / 2}/${normalizedSymbols.length} option symbols`);

              // Re-compute buyBackCost and realizedPercent from live marks.
              // Re-evaluate action: if realizedPercent drops below threshold, demote to BELOW_THRESHOLD.
              // Also handle spread long legs: recalculate net cost using live long-leg mark.
              for (const result of scanResults) {
                if (result.action === 'SKIPPED') continue;
                // Try both original and normalized symbol for lookup
                const liveMark = liveMarkMap.get(result.optionSymbol)
                  ?? liveMarkMap.get(normalizeOCC(result.optionSymbol));
                if (!liveMark) continue; // no live quote — keep stale values

                const isEstimatedNow = false;
                const qty = result.quantity;
                const multiplier = 100;
                let newBuyBackCost = liveMark * qty * multiplier;

                // For spreads: subtract long-leg credit from buyback cost
                const isSpreadResult = result.type === 'BPS' || result.type === 'BCS' || result.type === 'IC';
                if (result.spreadLongSymbol) {
                  const longMark = liveMarkMap.get(result.spreadLongSymbol);
                  if (longMark !== undefined) {
                    const longCredit = longMark * qty * multiplier;
                    newBuyBackCost = Math.max(0, newBuyBackCost - longCredit);
                  }
                }
                // Apply minimum floor: spreads/ICs always have at least $0.05/share residual
                // (two legs to close means commissions + bid/ask spread always add up)
                const minFloorLive = isSpreadResult ? (0.05 * qty * multiplier) : (0.01 * qty * multiplier);
                if (newBuyBackCost < minFloorLive) {
                  newBuyBackCost = minFloorLive;
                  result.isEstimated = true;
                }

                const newRealizedPct = result.premiumCollected > 0
                  ? ((result.premiumCollected - newBuyBackCost) / result.premiumCollected) * 100
                  : 0;

                console.log(`[Automation] ${result.symbol} ${result.type}: stale buyBack=$${result.buyBackCost.toFixed(2)} realized=${result.realizedPercent.toFixed(1)}% → live buyBack=$${newBuyBackCost.toFixed(2)} realized=${newRealizedPct.toFixed(1)}%`);

                result.buyBackCost = newBuyBackCost;
                result.realizedPercent = Math.round(newRealizedPct * 100) / 100;
                result.isEstimated = isEstimatedNow;

                // Re-evaluate action based on updated realizedPercent
                if (result.action === 'WOULD_CLOSE' && newRealizedPct < settings.profitThresholdPercent) {
                  console.log(`[Automation] ${result.symbol} ${result.type}: demoted from WOULD_CLOSE to BELOW_THRESHOLD (live realized=${newRealizedPct.toFixed(1)}% < threshold=${settings.profitThresholdPercent}%)`);
                  result.action = 'BELOW_THRESHOLD';
                  // Also remove the corresponding pending order if it was created
                  // (pendingOrders array is already built — filter it)
                  const beforeCount = pendingOrders.length;
                  pendingOrders.splice(0, pendingOrders.length,
                    ...pendingOrders.filter(o => o.symbol !== result.optionSymbol)
                  );
                  if (pendingOrders.length < beforeCount) {
                    console.log(`[Automation] ${result.symbol}: removed ${beforeCount - pendingOrders.length} stale pending order(s) after live-price demotion`);
                  }
                } else if (result.action === 'BELOW_THRESHOLD' && newRealizedPct >= settings.profitThresholdPercent) {
                  // Promote: stale close-price was below threshold but live mark is now above
                  console.log(`[Automation] ${result.symbol} ${result.type}: promoted from BELOW_THRESHOLD to WOULD_CLOSE (live realized=${newRealizedPct.toFixed(1)}% >= threshold=${settings.profitThresholdPercent}%)`);
                  result.action = 'WOULD_CLOSE';
                }
              }

              // Recompute summary counts after live-price re-evaluation
              totalPositionsClosed = scanResults.filter(r => r.action === 'WOULD_CLOSE').length;
              totalProfitRealized = scanResults
                .filter(r => r.action === 'WOULD_CLOSE')
                .reduce((sum, r) => sum + (r.premiumCollected - r.buyBackCost), 0);
            }
          }
        } catch (optionQuoteErr) {
          console.warn('[Automation] Failed to refresh live option marks — using stale close-price values:', optionQuoteErr);
          // Non-fatal: scan results remain valid with stale prices, just less accurate
        }

        // ── ABSOLUTE SAFETY GUARD ─────────────────────────────────────────────
        // Regardless of how buyBackCost was computed (stale close-price, time-decay
        // estimate, or live quote), a position where buyBackCost >= premiumCollected
        // is at a LOSS and must NEVER appear as "Ready to Close".
        // This is the final backstop that catches any edge cases the live-quote
        // refresh may have missed (e.g., Tradier returned no quote for the symbol).
        let safetyGuardDemotions = 0;
        for (const result of scanResults) {
          if (result.action === 'WOULD_CLOSE' && result.buyBackCost >= result.premiumCollected) {
            console.warn(
              `[Automation] SAFETY GUARD: ${result.symbol} ${result.type} demoted — ` +
              `buyBackCost ($${result.buyBackCost.toFixed(2)}) >= premiumCollected ($${result.premiumCollected.toFixed(2)}). ` +
              `Net profit would be -$${(result.buyBackCost - result.premiumCollected).toFixed(2)}. Forcing BELOW_THRESHOLD.`
            );
            result.action = 'BELOW_THRESHOLD';
            result.itmDemoted = true;
            // Remove any pending order for this position
            pendingOrders.splice(0, pendingOrders.length,
              ...pendingOrders.filter(o => o.symbol !== result.optionSymbol)
            );
            safetyGuardDemotions++;
          }
        }
        if (safetyGuardDemotions > 0) {
          console.warn(`[Automation] Safety guard demoted ${safetyGuardDemotions} position(s) that would have shown a net loss as Ready to Close.`);
          // Recompute totals after safety guard
          totalPositionsClosed = scanResults.filter(r => r.action === 'WOULD_CLOSE').length;
          totalProfitRealized = scanResults
            .filter(r => r.action === 'WOULD_CLOSE')
            .reduce((sum, r) => sum + (r.premiumCollected - r.buyBackCost), 0);
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

        // ── Roll Up & Out suggestions for ITM CCs ───────────────────────────
        // For each CC that was demoted by the safety guard (itmDemoted=true),
        // fetch the option chain and find the nearest OTM call 21-35 DTE out.
        // Attach the suggestion so the UI can show a "Roll Up & Out" hint.
        try {
          const itmCCs = scanResults.filter(r => r.itmDemoted && (r.type === 'CC' || r.type === 'Call'));
          if (itmCCs.length > 0) {
            const { createTradierAPI } = await import('./tradier');
            const storedKey = credentials?.tradierApiKey;
            const tradierApiKey = (storedKey && storedKey.length > 15 ? storedKey : null) || process.env.TRADIER_API_KEY;
            if (tradierApiKey) {
              const tradierApi = createTradierAPI(tradierApiKey);
              const today = new Date();
              const targetMinDte = 21;
              const targetMaxDte = 42;
              for (const result of itmCCs) {
                try {
                  const expirations = await tradierApi.getExpirations(result.symbol);
                  // Find expiration in 21-42 DTE range
                  const targetExp = expirations.find(exp => {
                    const expDate = new Date(exp);
                    const dte = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    return dte >= targetMinDte && dte <= targetMaxDte;
                  });
                  if (!targetExp) continue;
                  const expDate = new Date(targetExp);
                  const newDte = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  // Fetch call chain for that expiration
                  const chain = await tradierApi.getOptionChain(result.symbol, targetExp, false);
                  const calls = chain.filter(c => c.option_type === 'call' && c.strike > 0);
                  if (calls.length === 0) continue;
                  // Find the nearest OTM call (strike >= underlying price)
                  const underlyingPx = result.underlyingPrice ?? 0;
                  const otmCalls = calls
                    .filter(c => c.strike >= underlyingPx)
                    .sort((a, b) => a.strike - b.strike);
                  // Pick 1-2 strikes OTM for a roll with some credit
                  const rollTarget = otmCalls[1] ?? otmCalls[0];
                  if (!rollTarget) continue;
                  const rollBid = rollTarget.bid ?? 0;
                  const estimatedCredit = Math.round(rollBid * result.quantity * 100 * 100) / 100;
                  result.rollSuggestion = {
                    newStrike: rollTarget.strike,
                    newExpiration: targetExp,
                    estimatedCredit,
                    newDte,
                  };
                  console.log(`[Automation Roll] ${result.symbol}: Roll Up & Out → $${rollTarget.strike} ${targetExp} (${newDte} DTE), est. credit $${estimatedCredit}`);
                } catch (rollErr) {
                  console.warn(`[Automation Roll] Failed to fetch roll suggestion for ${result.symbol}:`, rollErr);
                }
              }
            }
          }
        } catch (rollErr) {
          console.warn('[Automation Roll] Failed to compute roll suggestions:', rollErr);
          // Non-fatal — scan results still valid without roll suggestions
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
      // Detect any order whose spreadLongSymbol equals its own optionSymbol (self-match bug).
      // This indicates the scan incorrectly matched a position as its own long leg.
      // Also detect if a spreadLongSymbol appears as the optionSymbol of a DIFFERENT order
      // that is NOT its paired counterpart (which would indicate a double-close attempt).
      // NOTE: For Iron Condors, two spread orders share the same underlying but have different
      // OCC symbols (put spread + call spread), so they are valid and must NOT be blocked.
      const spreadOrders = input.orders.filter(o => !!o.spreadLongSymbol);
      const singleLegOrders = input.orders.filter(o => !o.spreadLongSymbol);

      // Check 1: Self-match — spreadLongSymbol equals its own optionSymbol (normalise spaces)
      const selfMatchOrders = spreadOrders.filter(o => {
        const normShort = o.optionSymbol.replace(/\s+/g, '');
        const normLong = o.spreadLongSymbol!.replace(/\s+/g, '');
        return normShort === normLong;
      });
      if (selfMatchOrders.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Spread data error: the following positions have the same symbol for both legs — this indicates a scan data issue. Please re-run the scan and resubmit: ${selfMatchOrders.map(o => o.optionSymbol).join(', ')}.`,
        });
      }

      // Check 2: Cross-order collision — a spreadLongSymbol appears as the optionSymbol of
      // a DIFFERENT order that is NOT paired with it.
      // Build a map: normalised optionSymbol → order, for all orders
      const normShortMap = new Map<string, typeof input.orders[number]>();
      for (const o of input.orders) {
        normShortMap.set(o.optionSymbol.replace(/\s+/g, ''), o);
      }
      // Build a set of all paired long symbols (normalised) so we can exclude them
      const pairedLongSymbols = new Set(spreadOrders.map(o => o.spreadLongSymbol!.replace(/\s+/g, '')));
      // A collision exists when a long symbol matches a short symbol in a DIFFERENT order
      // AND that short symbol is not itself a long leg of any other order (i.e., it's a standalone close)
      const crossCollisions: string[] = [];
      for (const spreadOrder of spreadOrders) {
        const normLong = spreadOrder.spreadLongSymbol!.replace(/\s+/g, '');
        const collidingOrder = normShortMap.get(normLong);
        if (collidingOrder && collidingOrder.optionSymbol !== spreadOrder.optionSymbol) {
          // The long leg of this spread is also being submitted as a standalone short close.
          // This is only a problem if the colliding order has NO spreadLongSymbol (i.e., it's
          // being closed as a single-leg order, not as part of its own spread pair).
          if (!collidingOrder.spreadLongSymbol) {
            crossCollisions.push(spreadOrder.spreadLongSymbol!);
          }
        }
      }
      if (crossCollisions.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Spread integrity violation: the following long-leg symbols are also being submitted as standalone close orders in the same batch: ${crossCollisions.join(', ')}. This would close legs independently. Rerun the scan and resubmit.`,
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
            const rawNetDebit = Math.max(0.01, shortLegLivePrice - longLegLiveCredit);
            // IMPORTANT: Use snapToTick (integer arithmetic) to avoid IEEE 754 drift.
            // Spread prices >= $3.00 require $0.05 increments; raw Math.round can produce
            // values that fail Tastytrade's server-side `price % 0.05` check.
            const { snapToTick: snapTick } = await import('../shared/orderUtils');
            limitPrice = snapTick(rawNetDebit, order.symbol);
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

  // ─── Portfolio Heat Map: aggregate Greeks across all open option positions ───
  getPortfolioGreeks: protectedProcedure.query(async ({ ctx }) => {
    const { authenticateTastytrade } = await import('./tastytrade');
    const { createTradierAPI } = await import('./tradier');
    const { getApiCredentials } = await import('./db');

    const credentials = await getApiCredentials(ctx.user.id);
    if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
      return { tickers: [], portfolio: { netDelta: 0, dailyTheta: 0, netVega: 0, netGamma: 0, totalPremiumAtRisk: 0, maxConcentration: 0, positionCount: 0 } };
    }

    const tradierApiKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
    const tradierApi = tradierApiKey ? createTradierAPI(tradierApiKey) : null;

    const tt = await authenticateTastytrade(credentials, ctx.user.id);
    if (!tt) {
      return { tickers: [], portfolio: { netDelta: 0, dailyTheta: 0, netVega: 0, netGamma: 0, totalPremiumAtRisk: 0, maxConcentration: 0, positionCount: 0 } };
    }

    // Get all account numbers
    const accounts = await tt.getAccounts();
    const accountNumbers: string[] = accounts.map((acc: any) =>
      acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber
    ).filter(Boolean);

    // Collect all short option positions across all accounts
    type TickerGreeks = {
      symbol: string;
      netDelta: number;
      dailyTheta: number;
      netVega: number;
      netGamma: number;
      premiumAtRisk: number;
      contracts: number;
      strategies: string[];
      expirationStrategies: Record<string, string>;
      avgDte: number;
      avgIv: number;
    };
    const tickerMap = new Map<string, TickerGreeks>();

    for (const accountNumber of accountNumbers) {
      let positions: any[] = [];
      try {
        positions = await tt.getPositions(accountNumber);
      } catch {
        continue;
      }

      // Group positions by underlying+expiration to batch chain lookups
      const chainKeys = new Map<string, { symbol: string; expiration: string; positions: any[] }>();
      for (const pos of positions) {
        if (pos['instrument-type'] !== 'Equity Option') continue;
        const underlying = pos['underlying-symbol'] || '';
        const expiration = pos['expires-at'] ? pos['expires-at'].split('T')[0] : null;
        if (!underlying || !expiration) continue;
        const key = `${underlying}|${expiration}`;
        if (!chainKeys.has(key)) chainKeys.set(key, { symbol: underlying, expiration, positions: [] });
        chainKeys.get(key)!.positions.push(pos);
      }

      // Fetch option chains for ALL unique underlying+expiration CONCURRENTLY to avoid sequential timeout
      const chainEntries = Array.from(chainKeys.entries());
      const chainResults = await Promise.allSettled(
        chainEntries.map(async ([, { symbol, expiration }]) => {
          if (!tradierApi) return { symbol, expiration, contracts: [] };
          try {
            // Per-chain timeout: 15s so one slow symbol doesn't block the rest
            const timeoutPromise = new Promise<any[]>((_, reject) =>
              setTimeout(() => reject(new Error('chain timeout')), 15000)
            );
            const contracts = await Promise.race([
              tradierApi.getOptionChain(symbol, expiration, true),
              timeoutPromise,
            ]);
            return { symbol, expiration, contracts: contracts || [] };
          } catch {
            return { symbol, expiration, contracts: [] };
          }
        })
      );

      // Build a map from chainKey → contractMap for quick lookup below
      const chainContractMaps = new Map<string, Map<string, any>>();
      for (let i = 0; i < chainEntries.length; i++) {
        const [key] = chainEntries[i];
        const result = chainResults[i];
        const contracts = result.status === 'fulfilled' ? result.value.contracts : [];
        const contractMap = new Map<string, any>();
        for (const c of contracts) contractMap.set(c.symbol, c);
        chainContractMaps.set(key, contractMap);

      }

      for (const [, { symbol, expiration, positions: chainPositions }] of chainEntries) {
        const contractMap = chainContractMaps.get(`${symbol}|${expiration}`) ?? new Map<string, any>();

        // ── Spread detection: classify the whole expiration group before processing individual legs ──
        const groupLegs = chainPositions.map((pos: any) => {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const isShort = direction === 'short' || qty < 0;
          const occMatch = pos.symbol?.match(/([CP])(\d{8})$/);
          const isPut = occMatch ? occMatch[1] === 'P' : false;
          return { isShort, isPut };
        });
        const grpShortPuts  = groupLegs.filter((l: any) => l.isShort && l.isPut);
        const grpLongPuts   = groupLegs.filter((l: any) => !l.isShort && l.isPut);
        const grpShortCalls = groupLegs.filter((l: any) => l.isShort && !l.isPut);
        const grpLongCalls  = groupLegs.filter((l: any) => !l.isShort && !l.isPut);

        let groupStrategy: string;
        if (grpShortPuts.length > 0 && grpLongPuts.length > 0 && grpShortCalls.length > 0 && grpLongCalls.length > 0) {
          groupStrategy = 'IC';
        } else if (grpShortPuts.length > 0 && grpLongPuts.length > 0 && grpShortCalls.length === 0) {
          groupStrategy = 'BPS';
        } else if (grpShortCalls.length > 0 && grpLongCalls.length > 0 && grpShortPuts.length === 0) {
          groupStrategy = 'BCS';
        } else if (grpShortCalls.length > 0 && grpLongCalls.length > 0 && grpShortPuts.length > 0 && grpLongPuts.length === 0) {
          groupStrategy = 'PMCC';
        } else if (grpShortCalls.length > 0 && grpShortPuts.length === 0 && grpLongCalls.length === 0) {
          groupStrategy = 'CC';
        } else if (grpShortPuts.length > 0 && grpShortCalls.length === 0 && grpLongPuts.length === 0) {
          groupStrategy = 'CSP';
        } else {
          groupStrategy = '';
        }

        for (const pos of chainPositions) {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const isShort = direction === 'short' || qty < 0;
          const multiplier = parseInt(String(pos.multiplier || '100'));
          const absQty = Math.abs(qty);
          const sign = isShort ? -1 : 1; // short positions have negative delta contribution

          // Use group-level composite strategy; fall back to per-leg label for mixed positions
          const occMatch = pos.symbol?.match(/([CP])(\d{8})$/);
          const isPut = occMatch ? occMatch[1] === 'P' : false;
          const strategy = groupStrategy || (isShort ? (isPut ? 'CSP' : 'CC') : (isPut ? 'Long Put' : 'Long Call'));

          // Premium at risk = open price × qty × multiplier
          const openPrice = Math.abs(parseFloat(String(pos['average-open-price'] || '0')));
          const premiumAtRisk = openPrice * absQty * multiplier;

          // DTE
          const expiresAt = pos['expires-at'];
          const dte = expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

          // Look up Greeks from chain
          // Tastytrade uses space-padded OCC format (e.g. "AAPL  210416C00125000")
          // Tradier uses compact OCC format (e.g. "AAPL210416C00125000")
          // Normalize by stripping all spaces before lookup
          const normalizedSymbol = (pos.symbol || '').replace(/\s+/g, '');
          const contract = contractMap.get(normalizedSymbol);
          const greeks = contract?.greeks;
          const rawDelta = greeks?.delta ?? 0;
          const rawTheta = greeks?.theta ?? 0;
          const rawVega = greeks?.vega ?? 0;
          const rawGamma = greeks?.gamma ?? 0;
          const midIv = greeks?.mid_iv ?? 0;

          // Scale by quantity and multiplier; short positions flip delta sign
          const scaledDelta = rawDelta * sign * absQty * multiplier;
          const scaledTheta = rawTheta * sign * absQty * multiplier; // theta is positive for short options
          const scaledVega = rawVega * sign * absQty * multiplier;
          const scaledGamma = rawGamma * sign * absQty * multiplier;

          const entry = tickerMap.get(symbol) || {
            symbol,
            netDelta: 0,
            dailyTheta: 0,
            netVega: 0,
            netGamma: 0,
            premiumAtRisk: 0,
            contracts: 0,
            strategies: [],
            expirationStrategies: {} as Record<string, string>, // expiration -> strategy label
            avgDte: 0,
            avgIv: 0,
          };
          entry.netDelta += scaledDelta;
          entry.dailyTheta += scaledTheta;
          entry.netVega += scaledVega;
          entry.netGamma += scaledGamma;
          entry.premiumAtRisk += premiumAtRisk;
          entry.contracts += absQty;
          if (!entry.strategies.includes(strategy)) entry.strategies.push(strategy);
          // Track per-expiration strategy for multi-expiration display
          if (expiration && strategy) {
            entry.expirationStrategies[expiration] = strategy;
          }
          // Running weighted average for DTE and IV
          const prevContracts = entry.contracts - absQty;
          entry.avgDte = prevContracts > 0 ? (entry.avgDte * prevContracts + dte * absQty) / entry.contracts : dte;
          entry.avgIv = prevContracts > 0 && midIv > 0 ? (entry.avgIv * prevContracts + midIv * absQty) / entry.contracts : (midIv > 0 ? midIv : entry.avgIv);
          tickerMap.set(symbol, entry);
        }
      }
    }

    const tickers = Array.from(tickerMap.values()).sort((a, b) => b.premiumAtRisk - a.premiumAtRisk);
    const totalPremium = tickers.reduce((s, t) => s + t.premiumAtRisk, 0);
    const maxConcentration = totalPremium > 0 ? Math.max(...tickers.map(t => t.premiumAtRisk / totalPremium * 100)) : 0;

    const portfolio = {
      netDelta: tickers.reduce((s, t) => s + t.netDelta, 0),
      dailyTheta: tickers.reduce((s, t) => s + t.dailyTheta, 0),
      netVega: tickers.reduce((s, t) => s + t.netVega, 0),
      netGamma: tickers.reduce((s, t) => s + t.netGamma, 0),
      totalPremiumAtRisk: totalPremium,
      maxConcentration: Math.round(maxConcentration * 10) / 10,
      positionCount: tickers.reduce((s, t) => s + t.contracts, 0),
    };

    return { tickers, portfolio };
  }),

  // ─── Stage 1: Get all positions (fast, no Greeks) ────────────────────────────
  // Returns position metadata grouped by symbol+expiration for the frontend
  // to use as input for batched Greeks fetching.
  getPortfolioPositions: protectedProcedure.query(async ({ ctx }) => {
    const { authenticateTastytrade } = await import('./tastytrade');
    const { getApiCredentials } = await import('./db');

    const credentials = await getApiCredentials(ctx.user.id);
    if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
      return { chainKeys: [], positions: [] };
    }

    const tt = await authenticateTastytrade(credentials, ctx.user.id);
    if (!tt) return { chainKeys: [], positions: [] };

    const accounts = await tt.getAccounts();
    const accountNumbers: string[] = accounts.map((acc: any) =>
      acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber
    ).filter(Boolean);

    type PositionSummary = {
      symbol: string;          // OCC symbol e.g. "SPY   260117P00580000"
      underlying: string;      // e.g. "SPY"
      expiration: string;      // e.g. "2026-01-17"
      quantity: number;
      direction: string;
      multiplier: number;
      openPrice: number;
      expiresAt: string;
      accountNumber: string;
    };

    const allPositions: PositionSummary[] = [];
    const chainKeySet = new Map<string, { symbol: string; expiration: string }>();

    for (const accountNumber of accountNumbers) {
      let positions: any[] = [];
      try {
        positions = await tt.getPositions(accountNumber);
      } catch { continue; }

      for (const pos of positions) {
        if (pos['instrument-type'] !== 'Equity Option') continue;
        const underlying = pos['underlying-symbol'] || '';
        const expiration = pos['expires-at'] ? pos['expires-at'].split('T')[0] : null;
        if (!underlying || !expiration) continue;

        const key = `${underlying}|${expiration}`;
        if (!chainKeySet.has(key)) chainKeySet.set(key, { symbol: underlying, expiration });

        allPositions.push({
          symbol: pos.symbol || '',
          underlying,
          expiration,
          quantity: parseInt(String(pos.quantity || '0')),
          direction: pos['quantity-direction'] || '',
          multiplier: parseInt(String(pos.multiplier || '100')),
          openPrice: Math.abs(parseFloat(String(pos['average-open-price'] || '0'))),
          expiresAt: pos['expires-at'] || '',
          accountNumber,
        });
      }
    }

    return {
      chainKeys: Array.from(chainKeySet.values()),
      positions: allPositions,
    };
  }),

  // ─── Stage 2: Fetch Greeks for a specific batch of symbol+expiration pairs ───
  // Called repeatedly by the frontend in waves (e.g. 5 at a time).
  // Returns Greeks keyed by OCC symbol for each contract in the batch.
  getGreeksBatch: protectedProcedure
    .input(z.object({
      batch: z.array(z.object({ symbol: z.string(), expiration: z.string() })),
    }))
    .query(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      const tradierApiKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
      if (!tradierApiKey) return { greeks: {} };

      const tradierApi = createTradierAPI(tradierApiKey);

      // Fetch all chains in this batch concurrently
      const results = await Promise.allSettled(
        input.batch.map(async ({ symbol, expiration }) => {
          try {
            const timeoutPromise = new Promise<any[]>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 12000)
            );
            const contracts = await Promise.race([
              tradierApi.getOptionChain(symbol, expiration, true),
              timeoutPromise,
            ]);
            return { symbol, expiration, contracts: contracts || [] };
          } catch {
            return { symbol, expiration, contracts: [] };
          }
        })
      );

      // Build a flat map: OCC symbol → greeks object
      const greeks: Record<string, {
        delta: number; theta: number; vega: number; gamma: number; mid_iv: number;
      }> = {};

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        for (const contract of result.value.contracts) {
          if (!contract.symbol || !contract.greeks) continue;
          greeks[contract.symbol] = {
            delta: contract.greeks.delta ?? 0,
            theta: contract.greeks.theta ?? 0,
            vega: contract.greeks.vega ?? 0,
            gamma: contract.greeks.gamma ?? 0,
            mid_iv: contract.greeks.mid_iv ?? 0,
          };
        }
      }

      return { greeks };
    }),

  /**
   * AI-powered ticker analysis: given a ticker's Greeks and position data,
   * return a structured risk analysis with plain-English recommendations.
   */
  analyzeTicker: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      netDelta: z.number(),
      dailyTheta: z.number(),
      netVega: z.number(),
      netGamma: z.number(),
      premiumAtRisk: z.number(),
      contracts: z.number(),
      strategies: z.array(z.string()),
      avgDte: z.number(),
      avgIv: z.number(),
      // Individual positions for this ticker
      positions: z.array(z.object({
        symbol: z.string(),           // OCC symbol
        underlying: z.string(),
        expiration: z.string(),
        quantity: z.number(),
        direction: z.string(),
        multiplier: z.number(),
        openPrice: z.number(),        // premium collected per share
        expiresAt: z.string(),
        accountNumber: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { invokeLLM } = await import('./_core/llm');
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');

      // --- Fetch current stock price from Tradier ---
      let underlyingPrice: number | null = null;
      try {
        const credentials = await getApiCredentials(ctx.user.id);
        const tradierApiKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
        if (tradierApiKey) {
          const tradierApi = createTradierAPI(tradierApiKey);
          const quote = await tradierApi.getQuote(input.symbol);
          underlyingPrice = quote?.last ?? null;
        }
      } catch { /* non-fatal — proceed without price */ }

      // --- Build Position Identity from raw positions ---
      type LegInfo = {
        occSymbol: string;
        strike: number;
        optionType: 'CALL' | 'PUT';
        expiration: string;
        dte: number;
        quantity: number;
        direction: string;
        premiumCollected: number;  // total $ collected for this leg
      };

      const legs: LegInfo[] = [];
      for (const pos of (input.positions ?? [])) {
        const occMatch = pos.symbol?.replace(/\s+/g, '').match(/[A-Z]+([0-9]{6})([CP])([0-9]{8})$/);
        const strike = occMatch ? parseInt(occMatch[3], 10) / 1000 : 0;
        const optionType: 'CALL' | 'PUT' = occMatch ? (occMatch[2] === 'C' ? 'CALL' : 'PUT') : 'PUT';
        const dte = pos.expiresAt
          ? Math.max(0, Math.round((new Date(pos.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          : 0;
        const absQty = Math.abs(pos.quantity);
        const premiumCollected = pos.openPrice * absQty * pos.multiplier;
        legs.push({ occSymbol: pos.symbol, strike, optionType, expiration: pos.expiration, dte, quantity: pos.quantity, direction: pos.direction, premiumCollected });
      }

      // Determine strategy type from legs.
      // IMPORTANT: Use quantity sign as primary discriminator (negative = short/sold, positive = long/bought).
      // The Tastytrade `quantity-direction` field is unreliable for spread legs — both legs can show 'Short'.
      // Quantity sign is always correct: short leg has qty < 0, long hedge leg has qty > 0.
      const shortPuts = legs.filter(l => l.optionType === 'PUT' && l.quantity < 0);
      const longPuts = legs.filter(l => l.optionType === 'PUT' && l.quantity > 0);
      const shortCalls = legs.filter(l => l.optionType === 'CALL' && l.quantity < 0);
      const longCalls = legs.filter(l => l.optionType === 'CALL' && l.quantity > 0);

      let strategyType = input.strategies[0] ?? 'Options Position';
      let strikeDisplay = '';
      let actionRoute = '/performance';  // default

      if (shortPuts.length > 0 && longPuts.length > 0 && shortCalls.length === 0) {
        strategyType = 'Bull Put Spread (BPS)';
        // Short put has higher strike (closer to money), long put has lower strike (protection)
        const sp = shortPuts.reduce((a, b) => a.strike > b.strike ? a : b);
        const lp = longPuts.reduce((a, b) => a.strike < b.strike ? a : b);
        strikeDisplay = `Short $${sp.strike} Put / Long $${lp.strike} Put`;
        actionRoute = '/iron-condor';
      } else if (shortCalls.length > 0 && longCalls.length > 0 && shortPuts.length === 0) {
        strategyType = 'Bear Call Spread (BCS)';
        // Short call has lower strike (closer to money), long call has higher strike (protection)
        const sc = shortCalls.reduce((a, b) => a.strike < b.strike ? a : b);
        const lc = longCalls.reduce((a, b) => a.strike > b.strike ? a : b);
        strikeDisplay = `Short $${sc.strike} Call / Long $${lc.strike} Call`;
        actionRoute = '/iron-condor';
      } else if (shortPuts.length > 0 && longPuts.length > 0 && shortCalls.length > 0 && longCalls.length > 0) {
        strategyType = 'Iron Condor (IC)';
        const sp = shortPuts.reduce((a, b) => a.strike > b.strike ? a : b);
        const lp = longPuts.reduce((a, b) => a.strike < b.strike ? a : b);
        const sc = shortCalls.reduce((a, b) => a.strike < b.strike ? a : b);
        const lc = longCalls.reduce((a, b) => a.strike > b.strike ? a : b);
        strikeDisplay = `P: $${lp.strike}/$${sp.strike} | C: $${sc.strike}/$${lc.strike}`;
        actionRoute = '/iron-condor';
      } else if (shortPuts.length > 0 && shortCalls.length === 0) {
        strategyType = 'Cash-Secured Put (CSP)';
        strikeDisplay = `$${shortPuts[0].strike} Put`;
        actionRoute = '/csp';
      } else if (shortCalls.length > 0 && shortPuts.length === 0) {
        strategyType = 'Covered Call (CC)';
        strikeDisplay = `$${shortCalls[0].strike} Call`;
        actionRoute = '/cc';
      } else if (legs.length > 0) {
        strikeDisplay = legs.map(l => `$${l.strike} ${l.optionType}`).join(' / ');
      }

      const totalPremiumCollected = legs.reduce((sum, l) => sum + l.premiumCollected, 0);
      const avgDte = input.avgDte;
      const ivPct = (input.avgIv * 100).toFixed(1);
      const deltaDir = input.netDelta > 0 ? 'long (bullish)' : input.netDelta < 0 ? 'short (bearish)' : 'neutral';

      // Build spread-specific rolling context
      const isBCS = strategyType.includes('BCS') || strategyType.includes('Bear Call');
      const isBPS = strategyType.includes('BPS') || strategyType.includes('Bull Put');
      const isIC  = strategyType.includes('IC')  || strategyType.includes('Iron Condor');
      const isCC  = strategyType.includes('CC')  || strategyType.includes('Covered Call');
      const isCSP = strategyType.includes('CSP') || strategyType.includes('Cash-Secured');

      let rollMechanicsContext = '';
      if (isBCS) {
        rollMechanicsContext = `
ROLL MECHANICS FOR BCS (Bear Call Spread):
- Direction: Roll UP and OUT (higher strikes, later expiration)
- You must roll BOTH legs simultaneously as a spread order
- Step 1: Buy to Close (BTC) the current short call at the current short strike
- Step 2: Sell to Open (STO) a new short call at a HIGHER strike (further OTM)
- Step 3: Buy to Open (BTO) a new long call at the same width above the new short strike
- Step 4: Sell to Close (STC) the current long call
- CRITICAL: The entire 4-leg order must result in a NET CREDIT (you receive money, not pay)
- If you cannot get a net credit, consider widening the spread or going further out in time
- Target new short delta ≤ 0.30 for manageable risk`;
      } else if (isBPS) {
        rollMechanicsContext = `
ROLL MECHANICS FOR BPS (Bull Put Spread):
- Direction: Roll DOWN and OUT (lower strikes, later expiration)
- You must roll BOTH legs simultaneously as a spread order
- Step 1: Buy to Close (BTC) the current short put at the current short strike
- Step 2: Sell to Open (STO) a new short put at a LOWER strike (further OTM)
- Step 3: Buy to Open (BTO) a new long put at the same width below the new short strike
- Step 4: Sell to Close (STC) the current long put
- CRITICAL: The entire 4-leg order must result in a NET CREDIT
- Target new short delta ≤ 0.30`;
      } else if (isIC) {
        rollMechanicsContext = `
ROLL MECHANICS FOR IC (Iron Condor):
- Only roll the TESTED side (the side being challenged by the stock price)
- If calls are tested: roll the call spread UP and OUT (higher strikes, later expiry)
- If puts are tested: roll the put spread DOWN and OUT (lower strikes, later expiry)
- Roll both legs of the tested spread simultaneously
- CRITICAL: The roll must result in a NET CREDIT on the tested side
- The untested side stays in place unless it also needs adjustment`;
      } else if (isCC) {
        rollMechanicsContext = `
ROLL MECHANICS FOR CC (Covered Call):
- Direction: Roll UP and OUT (higher strike, later expiration)
- Buy to Close (BTC) the current short call, then Sell to Open (STO) a new call at a higher strike
- This is a 2-leg order: BTC current + STO new
- CRITICAL: Must collect a NET CREDIT for the roll
- Target new strike above current stock price, delta ≤ 0.30`;
      } else if (isCSP) {
        rollMechanicsContext = `
ROLL MECHANICS FOR CSP (Cash-Secured Put):
- Direction: Roll DOWN and OUT (lower strike, later expiration)
- Buy to Close (BTC) the current short put, then Sell to Open (STO) a new put at a lower strike
- This is a 2-leg order: BTC current + STO new
- CRITICAL: Must collect a NET CREDIT for the roll
- Target new strike below current stock price, delta ≤ 0.30`;
      }

      // Build concise prompt for brief recommendation
      const stockPriceLine = underlyingPrice != null
        ? `\nCurrent Stock Price: $${underlyingPrice.toFixed(2)}`
        : '';
      const prompt = `You are a professional options trading coach teaching retail traders. Give a BRIEF, DIRECT assessment AND step-by-step execution instructions.${rollMechanicsContext}

Position: ${strategyType} on ${input.symbol}
Strikes: ${strikeDisplay || 'N/A'}${stockPriceLine}
Contracts: ${input.contracts}
Premium Collected: $${totalPremiumCollected.toFixed(0)}
Avg DTE: ${avgDte.toFixed(0)} days
Net Delta: ${input.netDelta.toFixed(1)} (${deltaDir})
Daily Theta: ${input.dailyTheta >= 0 ? '+' : ''}$${input.dailyTheta.toFixed(2)}/day
Implied Volatility: ${ivPct}%

Respond in JSON with this EXACT structure:
{
  "verdict": "HOLD" | "CLOSE FOR PROFIT" | "ROLL" | "DEFEND" | "CLOSE TO LIMIT LOSS",
  "recommendation": "2-3 sentences max. Start with the verdict. Be specific with numbers. Tell them exactly what to do and why.",
  "urgency": "low" | "medium" | "high",
  "profitPct": estimated percentage of max profit already realized (0-100, integer),
  "actionLabel": "short action button label, e.g. 'Close Position' or 'Roll to Next Month'",
  "howToExecute": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ..."
  ]
}

For howToExecute, write 3-5 numbered steps that teach the student EXACTLY how to carry out the verdict in their broker (tastytrade). Be specific: mention order types (BTC, STO, debit/credit), target prices relative to the current data, strike selection criteria, and what to watch for. For spreads, always mention rolling BOTH legs together as a spread order. Use plain language a beginner can follow. Each step should be one sentence.`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'You are an expert options trading coach. Return ONLY valid JSON matching the exact schema requested. No markdown, no extra text.' },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ticker_analysis',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                verdict: { type: 'string', enum: ['HOLD', 'CLOSE FOR PROFIT', 'ROLL', 'DEFEND', 'CLOSE TO LIMIT LOSS'] },
                recommendation: { type: 'string' },
                urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
                profitPct: { type: 'integer' },
                actionLabel: { type: 'string' },
                howToExecute: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['verdict', 'recommendation', 'urgency', 'profitPct', 'actionLabel', 'howToExecute'],
              additionalProperties: false,
            },
          },
        },
      });

      let aiResult: { verdict: string; recommendation: string; urgency: string; profitPct: number; actionLabel: string; howToExecute: string[] } = { verdict: 'HOLD', recommendation: 'Unable to generate analysis.', urgency: 'low', profitPct: 0, actionLabel: 'View Position', howToExecute: [] };
      try {
        const raw = response?.choices?.[0]?.message?.content;
        if (typeof raw === 'string') aiResult = JSON.parse(raw);
      } catch { /* use default */ }

      // Compute approximate short delta per contract (absolute value, 0-1 scale)
      // netDelta is the aggregate delta across all contracts; divide by (contracts * 100) to get per-share delta
      const sharesPerContract = 100;
      const shortDeltaApprox = input.contracts > 0
        ? Math.min(1, Math.abs(input.netDelta) / (input.contracts * sharesPerContract))
        : null;

      return {
        symbol: input.symbol,
        strategyType,
        strikeDisplay,
        contracts: input.contracts,
        premiumCollected: totalPremiumCollected,
        avgDte,
        netDelta: input.netDelta,
        dailyTheta: input.dailyTheta,
        avgIv: input.avgIv,
        premiumAtRisk: input.premiumAtRisk,
        underlyingPrice,  // current stock price from Tradier (null if unavailable)
        shortDelta: shortDeltaApprox,  // approximate per-contract short delta (0-1)
        // AI fields
        verdict: aiResult.verdict,
        recommendation: aiResult.recommendation,
        urgency: aiResult.urgency,
        profitPct: aiResult.profitPct,
        actionLabel: aiResult.actionLabel,
        howToExecute: aiResult.howToExecute ?? [],
        actionRoute,
        // Legacy field for backward compat
        analysis: aiResult.recommendation,
      };
    }),

  // ─── Get Live Roll Candidates ────────────────────────────────────────────────
  getRollCandidates: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      strategyType: z.string(),
      currentShortStrike: z.number(),
      currentLongStrike: z.number().optional(),
      currentExpiration: z.string(),
      spreadWidth: z.number().optional(),
      // IC-specific: pass both short strikes and underlying price for tested-side detection
      icShortCallStrike: z.number().optional(),
      icShortPutStrike: z.number().optional(),
      underlyingPrice: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { createTradierAPI } = await import('./tradier');

      const credentials = await getApiCredentials(ctx.user.id);
      const tradierApiKey = credentials?.tradierApiKey || process.env.TRADIER_API_KEY || '';
      if (!tradierApiKey) return { candidates: [] };

      const tradierApi = createTradierAPI(tradierApiKey);

      // Determine strategy direction
      const isBCS = input.strategyType.includes('BCS') || input.strategyType.includes('Bear Call');
      const isBPS = input.strategyType.includes('BPS') || input.strategyType.includes('Bull Put');
      const isIC  = input.strategyType.includes('IC')  || input.strategyType.includes('Iron Condor');
      const isCC  = input.strategyType.includes('CC')  || input.strategyType.includes('Covered Call');
      const isCSP = input.strategyType.includes('CSP') || input.strategyType.includes('Cash-Secured');

      // IC tested-side detection: determine which side (calls or puts) is being challenged
      // by comparing the current stock price to the short strikes on each side.
      // The tested side is the one where the stock is closer to (or past) the short strike.
      let icTestedSide: 'call' | 'put' = 'call'; // default to call side
      if (isIC && input.underlyingPrice != null && input.icShortCallStrike != null && input.icShortPutStrike != null) {
        const distToCall = Math.abs(input.underlyingPrice - input.icShortCallStrike);
        const distToPut  = Math.abs(input.underlyingPrice - input.icShortPutStrike);
        icTestedSide = distToCall <= distToPut ? 'call' : 'put';
      }

      const rollUp = isBCS || isCC || (isIC && icTestedSide === 'call');
      const optionType: 'call' | 'put' = (isBCS || isCC || (isIC && icTestedSide === 'call')) ? 'call' : 'put';
      const isSpread = isBCS || isBPS || isIC;
      const spreadWidth = input.spreadWidth ?? 5;

      // Get expirations — try 21-60 DTE first, fall back to 60-90 DTE if empty
      const now = Date.now();
      let expirations: string[] = [];
      let dteWindowUsed: '21-60' | '60-90' = '21-60';
      let allExps: string[] = [];
      try {
        allExps = await tradierApi.getExpirations(input.symbol);
        expirations = allExps.filter(exp => {
          const dte = Math.round((new Date(exp).getTime() - now) / (1000 * 60 * 60 * 24));
          return dte >= 21 && dte <= 60;
        });
        // Fallback: if no expirations in 21-60 window, try 60-90 DTE
        if (expirations.length === 0) {
          expirations = allExps.filter(exp => {
            const dte = Math.round((new Date(exp).getTime() - now) / (1000 * 60 * 60 * 24));
            return dte > 60 && dte <= 90;
          });
          if (expirations.length > 0) dteWindowUsed = '60-90';
        }
      } catch { return { candidates: [], dteWindowUsed: '21-60' as const }; }

      if (expirations.length === 0) return { candidates: [], dteWindowUsed: '21-60' as const };

      // Estimate close debit for current position (mid price of current short)
      let closeDebit = 0;
      try {
        const currentChain = await tradierApi.getOptionChain(input.symbol, input.currentExpiration, false);
        const currentShort = currentChain.find(o =>
          o.type === optionType && Math.abs(o.strike - input.currentShortStrike) < 0.01
        );
        if (currentShort) {
          const shortMid = (currentShort.bid + currentShort.ask) / 2;
          if (isSpread && input.currentLongStrike !== undefined) {
            const currentLong = currentChain.find(o =>
              o.type === optionType && Math.abs(o.strike - input.currentLongStrike!) < 0.01
            );
            const longMid = currentLong ? (currentLong.bid + currentLong.ask) / 2 : 0;
            // Debit to close spread = buy short back - sell long
            closeDebit = shortMid - longMid;
          } else {
            closeDebit = shortMid;
          }
        }
      } catch { /* use 0 as fallback */ }

      type RollCandidate = {
        expiration: string;
        dte: number;
        newShortStrike: number;
        newLongStrike: number;
        newShortDelta: number;
        newShortBid: number;
        newLongAsk: number;
        newSpreadCredit: number;
        netRollCredit: number;
        spreadWidth: number;
        isBest: boolean;
        reason: string;
      };

      const candidates: RollCandidate[] = [];

      for (const exp of expirations.slice(0, 4)) {  // max 4 expirations to limit API calls
        const dte = Math.round((new Date(exp).getTime() - now) / (1000 * 60 * 60 * 24));
        try {
          const chain = await tradierApi.getOptionChain(input.symbol, exp, true);
          const filtered = chain.filter(o =>
            o.type === optionType && o.bid > 0 && o.ask > 0
          );

          // Find short leg candidates (above current short for BCS/CC, below for BPS/CSP)
          const shortCandidates = filtered.filter(o =>
            rollUp ? o.strike > input.currentShortStrike : o.strike < input.currentShortStrike
          );

          for (const shortLeg of shortCandidates) {
            const shortDelta = Math.abs(shortLeg.greeks?.delta ?? 0);
            if (shortDelta > 0.35) continue;  // skip high-delta strikes

            let newSpreadCredit: number;
            let newLongStrike: number;
            let newLongAsk = 0;

            if (isSpread) {
              // Find matching long leg at same width
              const longStrike = rollUp
                ? shortLeg.strike + spreadWidth
                : shortLeg.strike - spreadWidth;
              newLongStrike = longStrike;
              const longLeg = filtered.find(o => Math.abs(o.strike - longStrike) < 0.01);
              if (!longLeg) continue;
              newLongAsk = longLeg.ask;
              newSpreadCredit = shortLeg.bid - longLeg.ask;
            } else {
              // Single-leg: just the short premium
              newLongStrike = shortLeg.strike;
              newSpreadCredit = shortLeg.bid;
            }

            if (newSpreadCredit <= 0) continue;

            const netRollCredit = newSpreadCredit - closeDebit;

            // Build reason string
            let reason = '';
            if (netRollCredit > 0) {
              reason = `Collect $${(netRollCredit * 100).toFixed(0)}¢ net credit. Delta ${shortDelta.toFixed(2)} — manageable risk.`;
            } else {
              reason = `Small debit of $${(Math.abs(netRollCredit) * 100).toFixed(0)}¢ to roll. Consider going further OTM for a credit.`;
            }

            candidates.push({
              expiration: exp,
              dte,
              newShortStrike: shortLeg.strike,
              newLongStrike,
              newShortDelta: shortDelta,
              newShortBid: shortLeg.bid,
              newLongAsk,
              newSpreadCredit,
              netRollCredit,
              spreadWidth,
              isBest: false,
              reason,
            });
          }
        } catch { continue; }
      }

      // Sort: net credit first, then by net credit desc, then by delta asc
      candidates.sort((a, b) => {
        const aCredit = a.netRollCredit > 0 ? 1 : 0;
        const bCredit = b.netRollCredit > 0 ? 1 : 0;
        if (aCredit !== bCredit) return bCredit - aCredit;
        if (Math.abs(a.netRollCredit - b.netRollCredit) > 0.01) return b.netRollCredit - a.netRollCredit;
        return a.newShortDelta - b.newShortDelta;
      });

      // Mark best candidate (highest net credit with delta ≤ 0.30 in 21-45 DTE)
      const bestIdx = candidates.findIndex(c => c.netRollCredit > 0 && c.newShortDelta <= 0.30 && c.dte >= 21 && c.dte <= 45);
      if (bestIdx >= 0) candidates[bestIdx].isBest = true;
      else if (candidates.length > 0) candidates[0].isBest = true;

      // Return top 6 candidates with DTE window info
      return { candidates: candidates.slice(0, 6), dteWindowUsed, icTestedSide: isIC ? icTestedSide : undefined };
    }),

  // ─── AI Strategy Review ───────────────────────────────────────────────────
  // Analyzes a filtered set of scan-result positions for a given strategy type
  // and returns a structured markdown analysis with close/hold/alert sections.
  aiStrategyReview: protectedProcedure
    .input(
      z.object({
        strategy: z.enum(['BPS', 'BCS', 'IC', 'CSP', 'CC', 'all']),
        positions: z.array(
          z.object({
            symbol: z.string(),
            type: z.string(),
            optionSymbol: z.string(),
            price: z.number(),
            account: z.string(),
            expiration: z.string(),
            dte: z.number(),
            premiumCollected: z.number(),
            buyBackCost: z.number(),
            netProfit: z.number(),
            realizedPct: z.number(),
            action: z.string(),
            // Spread fields (optional)
            spreadLongSymbol: z.string().optional(),
            spreadShortStrike: z.number().optional(),
            spreadLongStrike: z.number().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');

      const { strategy, positions } = input;
      if (positions.length === 0) {
        return { analysis: 'No positions found for this strategy filter.' };
      }

      // Build compact position summaries for the LLM
      const positionSummaries = positions.map(p => {
        const base = {
          symbol: p.symbol,
          type: p.type,
          expiration: p.expiration,
          dte: p.dte,
          premiumCollected: `$${p.premiumCollected.toFixed(2)}`,
          buyBackCost: `$${p.buyBackCost.toFixed(2)}`,
          netProfit: `$${p.netProfit.toFixed(2)}`,
          realizedPct: `${p.realizedPct.toFixed(1)}%`,
          action: p.action,
        };
        if (p.spreadShortStrike && p.spreadLongStrike) {
          return {
            ...base,
            shortStrike: p.spreadShortStrike,
            longStrike: p.spreadLongStrike,
            spreadWidth: Math.abs(p.spreadShortStrike - p.spreadLongStrike),
          };
        }
        return base;
      });

      const strategyLabel = strategy === 'all' ? 'mixed strategies' : strategy;
      const readyToClose = positions.filter(p => p.action === 'WOULD_CLOSE');
      const holdPositions = positions.filter(p => p.action !== 'WOULD_CLOSE');

      const systemPrompt = `You are an expert options trading analyst and risk manager specializing in premium-selling strategies (CSP, CC, BPS, BCS, Iron Condors). 
You are reviewing a set of open positions that a trader is considering closing for profit. Your job is to:
1. Validate whether each "Ready to Close" position is genuinely the right time to close
2. Identify any positions that should be closed URGENTLY (gamma risk, earnings approaching, unusual buy-back cost spike)
3. Flag any positions that look problematic (e.g., realized% is negative, DTE is very low with large unrealized loss, spread is dangerously narrow)
4. Provide a concise, actionable plain-English summary

Format your response in clean Markdown with these exact sections:
## ✅ Close Recommendations
List each position recommended to close with a 1-sentence reason.

## ⏸ Hold Recommendations  
List positions that should stay open with a 1-sentence reason.

## ⚠️ Risk Alerts
List any positions with concerning characteristics (earnings risk, gamma risk, unusual cost, etc.).

## 📊 Overall Summary
A 2-3 sentence plain-English assessment of the overall health of this strategy group.

Be specific — use actual numbers (DTE, realized%, premium amounts). Do not be generic.`;

      const userPrompt = `Strategy filter: ${strategyLabel}
Total positions: ${positions.length} (${readyToClose.length} flagged Ready to Close, ${holdPositions.length} on Hold)

Position data:
${JSON.stringify(positionSummaries, null, 2)}`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const analysis = response.choices?.[0]?.message?.content ?? 'Unable to generate analysis.';
      return { analysis };
    }),

  // Follow-up chat for the AI Strategy Review panel
  aiStrategyFollowUp: protectedProcedure
    .input(
      z.object({
        strategy: z.enum(['BPS', 'BCS', 'IC', 'CSP', 'CC', 'all']),
        initialAnalysis: z.string(),
        conversationHistory: z.array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          })
        ),
        userMessage: z.string().max(2000),
        // Compact position context for follow-up questions
        positionContext: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import('./_core/llm');

      const systemPrompt = `You are an expert options trading analyst reviewing ${input.strategy === 'all' ? 'mixed strategy' : input.strategy} positions.
You already provided an initial analysis. The trader has a follow-up question.
Context of the positions being reviewed:
${input.positionContext}

Your initial analysis was:
${input.initialAnalysis}

Answer the trader's follow-up question concisely and specifically. Use actual numbers from the position data when relevant. Format in Markdown.`;

      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...input.conversationHistory,
        { role: 'user', content: input.userMessage },
      ];

      const response = await invokeLLM({ messages });
      const reply = response.choices?.[0]?.message?.content ?? 'Unable to generate response.';
      return { reply };
    }),
});
