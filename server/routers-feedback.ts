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

  /**
   * List current user's feedback submissions with replies
   */
  listMyFeedback: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const { feedback, feedbackReplies } = await import('../drizzle/schema');
    const { eq, desc } = await import('drizzle-orm');

    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database connection failed',
      });
    }

    const userId = ctx.user.id;
    const { and, isNull } = await import('drizzle-orm');

    // Get user's feedback — exclude soft-deleted items
    const userFeedback = await db
      .select()
      .from(feedback)
      .where(and(eq(feedback.userId, userId), isNull(feedback.deletedAt)))
      .orderBy(desc(feedback.createdAt));

    // Get replies for each feedback
    const feedbackWithReplies = await Promise.all(
      userFeedback.map(async (fb: any) => {
        const replies = await db
          .select()
          .from(feedbackReplies)
          .where(eq(feedbackReplies.feedbackId, fb.id))
          .orderBy(desc(feedbackReplies.createdAt));

        return {
          ...fb,
          replies,
        };
      })
    );

    return { feedback: feedbackWithReplies };
  }),

  /**
   * Get feedback detail with full conversation thread
   */
  getFeedbackDetail: protectedProcedure
    .input(z.object({
      feedbackId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { feedback, feedbackReplies } = await import('../drizzle/schema');
      const { eq, desc, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database connection failed',
        });
      }

      // Get feedback and verify ownership
      const feedbackItem = await db
        .select()
        .from(feedback)
        .where(
          and(
            eq(feedback.id, input.feedbackId),
            eq(feedback.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (feedbackItem.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        });
      }

      // Get all replies
      const replies = await db
        .select()
        .from(feedbackReplies)
        .where(eq(feedbackReplies.feedbackId, input.feedbackId))
        .orderBy(feedbackReplies.createdAt);

      // Mark admin replies as read
      const unreadAdminReplies = replies.filter((r: any) => r.isAdminReply && !r.readByUser);
      if (unreadAdminReplies.length > 0) {
        for (const reply of unreadAdminReplies) {
          await db
            .update(feedbackReplies)
            .set({ readByUser: true })
            .where(eq(feedbackReplies.id, (reply as any).id));
        }
      }

      return {
        feedback: feedbackItem[0],
        replies,
      };
    }),

  /**
   * Submit reply to feedback (user responding to admin)
   */
  submitReply: protectedProcedure
    .input(z.object({
      feedbackId: z.number(),
      message: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { feedback, feedbackReplies } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database connection failed',
        });
      }

      // Verify feedback ownership
      const feedbackItem = await db
        .select()
        .from(feedback)
        .where(
          and(
            eq(feedback.id, input.feedbackId),
            eq(feedback.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (feedbackItem.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        });
      }

      // Insert reply
      await db.insert(feedbackReplies).values({
        feedbackId: input.feedbackId,
        userId: ctx.user.id,
        isAdminReply: false,
        message: input.message,
      });

      return { success: true };
    }),

  /**
   * Archive a feedback item (user) — hides it from the default inbox view.
   */
  archiveFeedback: protectedProcedure
    .input(z.object({ feedbackId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { feedback } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database connection failed' });
      const item = await db.select().from(feedback)
        .where(and(eq(feedback.id, input.feedbackId), eq(feedback.userId, ctx.user.id)))
        .limit(1);
      if (!item.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Feedback not found' });
      await db.update(feedback)
        .set({ archived: true, archivedAt: Date.now() })
        .where(eq(feedback.id, input.feedbackId));
      return { success: true };
    }),

  /**
   * Unarchive a feedback item (user).
   */
  unarchiveFeedback: protectedProcedure
    .input(z.object({ feedbackId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { feedback } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database connection failed' });
      const item = await db.select().from(feedback)
        .where(and(eq(feedback.id, input.feedbackId), eq(feedback.userId, ctx.user.id)))
        .limit(1);
      if (!item.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Feedback not found' });
      await db.update(feedback)
        .set({ archived: false, archivedAt: null })
        .where(eq(feedback.id, input.feedbackId));
      return { success: true };
    }),

  /**
   * Soft-delete a feedback item (user) — hides it permanently from their inbox.
   */
  deleteFeedback: protectedProcedure
    .input(z.object({ feedbackId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { feedback } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database connection failed' });
      const item = await db.select().from(feedback)
        .where(and(eq(feedback.id, input.feedbackId), eq(feedback.userId, ctx.user.id)))
        .limit(1);
      if (!item.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Feedback not found' });
      await db.update(feedback)
        .set({ deletedAt: Date.now() })
        .where(eq(feedback.id, input.feedbackId));
      return { success: true };
    }),
});
