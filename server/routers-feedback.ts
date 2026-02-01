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
   * Upload file (screenshot/recording) to S3
   */
  uploadFile: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileType: z.string(),
      fileData: z.string(), // base64 encoded file data
    }))
    .mutation(async ({ input, ctx }) => {
      const { storagePut } = await import('./storage');

      try {
        // Decode base64 to buffer
        const buffer = Buffer.from(input.fileData, 'base64');

        // Generate unique file key with user ID and timestamp
        const timestamp = Date.now();
        const sanitizedFileName = input.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileKey = `feedback/${ctx.user.id}/${timestamp}-${sanitizedFileName}`;

        // Upload to S3
        const { url } = await storagePut(fileKey, buffer, input.fileType);

        return {
          success: true,
          url,
          key: fileKey,
        };
      } catch (error: any) {
        console.error('[Feedback] File upload error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to upload file',
        });
      }
    }),

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
