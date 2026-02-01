import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";

export const inboxRouter = router({
  /**
   * List broadcasts for current user with read/deleted status
   */
  listBroadcasts: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const { broadcasts, broadcastReads } = await import('../drizzle/schema');
    const { eq, and, desc } = await import('drizzle-orm');

    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database connection failed',
      });
    }

    const userId = ctx.user.id;

    // Get all broadcasts for "all" tier (or add tier filtering if needed)
    const allBroadcasts = await db
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.targetTier, "all"))
      .orderBy(desc(broadcasts.createdAt));

    // Get user's read/delete status for these broadcasts
    const broadcastIds = allBroadcasts.map((b: any) => b.id);
    const readStatuses = await db
      .select()
      .from(broadcastReads)
      .where(eq(broadcastReads.userId, userId));

    const statusMap = new Map(readStatuses.map((s: any) => [s.broadcastId, s]));

    // Combine broadcasts with their read status
    const broadcastsWithStatus = allBroadcasts
      .map((broadcast: any) => {
        const status: any = statusMap.get(broadcast.id);
        return {
          ...broadcast,
          isRead: status?.isRead || false,
          isDeleted: status?.isDeleted || false,
        };
      })
      .filter((b: any) => !b.isDeleted); // Hide deleted broadcasts

    return { broadcasts: broadcastsWithStatus };
  }),

  /**
   * Mark broadcast as read/unread
   */
  markBroadcastRead: protectedProcedure
    .input(z.object({
      broadcastId: z.number(),
      isRead: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { broadcastReads } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database connection failed',
        });
      }

      const userId = ctx.user.id;

      // Check if record exists
      const existing = await db
        .select()
        .from(broadcastReads)
        .where(
          and(
            eq(broadcastReads.broadcastId, input.broadcastId),
            eq(broadcastReads.userId, userId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing record
        await db
          .update(broadcastReads)
          .set({
            isRead: input.isRead,
            readAt: input.isRead ? new Date() : null,
          })
          .where(
            and(
              eq(broadcastReads.broadcastId, input.broadcastId),
              eq(broadcastReads.userId, userId)
            )
          );
      } else {
        // Create new record
        await db.insert(broadcastReads).values({
          broadcastId: input.broadcastId,
          userId,
          isRead: input.isRead,
          readAt: input.isRead ? new Date() : null,
        });
      }

      return { success: true };
    }),

  /**
   * Delete (hide) broadcast for current user
   */
  deleteBroadcast: protectedProcedure
    .input(z.object({
      broadcastId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { broadcastReads } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database connection failed',
        });
      }

      const userId = ctx.user.id;

      // Check if record exists
      const existing = await db
        .select()
        .from(broadcastReads)
        .where(
          and(
            eq(broadcastReads.broadcastId, input.broadcastId),
            eq(broadcastReads.userId, userId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing record
        await db
          .update(broadcastReads)
          .set({
            isDeleted: true,
            deletedAt: new Date(),
          })
          .where(
            and(
              eq(broadcastReads.broadcastId, input.broadcastId),
              eq(broadcastReads.userId, userId)
            )
          );
      } else {
        // Create new record marked as deleted
        await db.insert(broadcastReads).values({
          broadcastId: input.broadcastId,
          userId,
          isDeleted: true,
          deletedAt: new Date(),
        });
      }

      return { success: true };
    }),

  /**
   * Get unread count for inbox badge
   */
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const { broadcasts, broadcastReads, feedback, feedbackReplies } = await import('../drizzle/schema');
    const { eq, and, desc, isNull } = await import('drizzle-orm');

    const db = await getDb();
    if (!db) {
      return { count: 0 };
    }

    const userId = ctx.user.id;

    // Count unread broadcasts
    const allBroadcasts = await db
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.targetTier, "all"))
      .orderBy(desc(broadcasts.createdAt));

    const broadcastIds = allBroadcasts.map((b: any) => b.id);
    const readStatuses = await db
      .select()
      .from(broadcastReads)
      .where(eq(broadcastReads.userId, userId));

    const statusMap = new Map(readStatuses.map((s: any) => [s.broadcastId, s]));
    const unreadBroadcasts = allBroadcasts.filter((b: any) => {
      const status: any = statusMap.get(b.id);
      return !status?.isRead && !status?.isDeleted;
    }).length;

    // Count feedback with admin replies (status 'in_progress' or 'resolved' indicates admin activity)
    const feedbackWithReplies = await db
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.userId, userId),
          eq(feedback.status, "in_progress") // Feedback that has been replied to
        )
      );

    const unreadReplies = feedbackWithReplies.length;

    return { count: unreadBroadcasts + unreadReplies };
  }),
});
