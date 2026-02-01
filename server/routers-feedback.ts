/**
 * Feedback Router - User feedback submission
 * 
 * This router provides endpoints for users to submit feedback, bug reports, and questions
 */

import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const feedbackRouter = router({
  /**
   * Submit feedback from user
   */
  submit: protectedProcedure
    .input(z.object({
      type: z.enum(['bug', 'feature', 'question', 'feedback']),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
      subject: z.string(),
      description: z.string(),
      pageUrl: z.string().optional(),
      screenshotUrl: z.string().optional(),
      userAgent: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import('./db');
      const { feedback } = await import('../drizzle/schema');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Insert feedback
      const result = await db.insert(feedback).values({
        userId: ctx.user.id,
        type: input.type,
        priority: input.priority,
        subject: input.subject,
        description: input.description,
        pageUrl: input.pageUrl,
        screenshotUrl: input.screenshotUrl,
        userAgent: input.userAgent,
        status: 'new',
      });

      return {
        success: true,
        feedbackId: Number(result[0].insertId),
      };
    }),
});
