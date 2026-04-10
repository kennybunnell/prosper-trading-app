/**
 * tRPC Router for AI-Powered Roll Recommendations
 * Provides natural language recommendations for roll decisions
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";

export const rollRecommendationsRouter = router({
  /**
   * Get AI-powered recommendation for a specific position with roll candidates
   * Returns plain English analysis and strategy advice
   */
  getRecommendation: protectedProcedure
    .input(z.object({
      position: z.object({
        symbol: z.string(),
        strategy: z.enum(['CSP', 'CC']),
        strikePrice: z.number(),
        expiration: z.string(),
        dte: z.number(),
        profitCaptured: z.number(),
        itmDepth: z.number(),
        delta: z.number(),
        currentValue: z.number(),
        openPremium: z.number(),
      }),
      candidates: z.array(z.object({
        action: z.enum(['close', 'roll']),
        strike: z.number().optional(),
        expiration: z.string().optional(),
        dte: z.number().optional(),
        netCredit: z.number().optional(),
        newPremium: z.number().optional(),
        annualizedReturn: z.number().optional(),
        meets3XRule: z.boolean().optional(),
        delta: z.number().optional(),
        score: z.number(),
        description: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getSymbolContext } = await import('./ai-context');
      const { position, candidates } = input;

      // Fetch full portfolio context for this symbol
      const symbolCtx = await getSymbolContext(ctx.user.id, position.symbol);
      
      // Calculate net profit for each candidate
      const closeCandidate = candidates.find(c => c.action === 'close');
      const rollCandidates = candidates.filter(c => c.action === 'roll');
      
      // Current P/L if closed now
      const currentPL = position.openPremium - position.currentValue;
      const currentPLPercent = (currentPL / position.openPremium) * 100;
      
      // Build context for LLM
      const systemPrompt = `You are an expert options trader providing actionable recommendations for managing positions. 
Your goal is to help the trader make the best decision based on their position metrics and available roll candidates.

IMPORTANT: You have access to the trader's FULL PORTFOLIO HISTORY for this symbol. Reference the actual cost basis, effective cost basis after premiums, total income collected, and trade history in your recommendation.

${symbolCtx.contextBlock}

Key considerations:
- For CSP (Cash Secured Put): Consider whether it's better to let the position be assigned and sell covered calls, or roll forward
- For CC (Covered Call): Consider whether it's better to let shares be called away, or roll to keep the shares
- Always calculate and present the NET profit/loss after accounting for roll costs
- Consider the risk/reward of each option
- Be specific about dollar amounts and percentages
- Keep recommendations concise but actionable (2-3 sentences max)`;

      const userPrompt = `Analyze this ${position.strategy} position and recommend the best action:

**Current Position:**
- Symbol: ${position.symbol}
- Strike: $${position.strikePrice}
- Expiration: ${position.expiration} (${position.dte} DTE)
- Profit Captured: ${position.profitCaptured.toFixed(1)}%
- ITM Depth: ${position.itmDepth > 0 ? `${position.itmDepth.toFixed(1)}% ITM` : `${Math.abs(position.itmDepth).toFixed(1)}% OTM`}
- Delta: ${position.delta.toFixed(2)}
- Current P/L if closed now: $${currentPL.toFixed(2)} (${currentPLPercent.toFixed(1)}%)
- Close cost: $${position.currentValue.toFixed(2)}

**Available Options:**

${closeCandidate ? `**Close Now:**
- Cost: $${position.currentValue.toFixed(2)} debit
- Net Result: $${currentPL.toFixed(2)} profit (${currentPLPercent.toFixed(1)}% of max premium)
` : ''}

${rollCandidates.map((c, i) => `**Roll Option ${i + 1}:** ${c.description}
- Roll Cost: $${Math.abs(c.netCredit || 0).toFixed(2)} ${(c.netCredit || 0) > 0 ? 'CREDIT' : 'DEBIT'}
- New Premium: $${(c.newPremium || 0).toFixed(2)}/share ($${((c.newPremium || 0) * 100).toFixed(2)}/contract)
- Net Result: $${(currentPL + (c.netCredit || 0)).toFixed(2)} profit after roll
- Annualized Return: ${(c.annualizedReturn || 0).toFixed(1)}%
- New Delta: ${(c.delta || 0).toFixed(2)}
- Meets 3X Rule: ${c.meets3XRule ? 'Yes' : 'No'}
`).join('\n')}

Provide a clear recommendation in this format:
1. **Recommendation:** [One clear action - "Close now", "Roll to [strike] [expiration]", or "Let it assign and sell CCs"]
2. **Reasoning:** [2-3 sentences explaining why, including specific dollar amounts and net profit calculations]
3. **Net Outcome:** [Final dollar amount and percentage after executing the recommendation]`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        const recommendation = response.choices[0]?.message?.content;
        
        if (typeof recommendation !== 'string') {
          throw new Error('Invalid LLM response format');
        }

        return {
          recommendation,
          currentPL,
          currentPLPercent,
        };
      } catch (error: any) {
        console.error('[getRecommendation] Error:', error.message);
        throw new Error(`Failed to generate recommendation: ${error.message}`);
      }
    }),
});
