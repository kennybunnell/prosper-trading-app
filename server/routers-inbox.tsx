import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc.js";
import { getDb } from "./db.js";
const db = getDb();
import { broadcasts, broadcastReads, feedback, feedbackReplies } from "../drizzle/schema.js";
import { eq, and, desc } from "drizzle-orm";

export const inboxRouter = router({
  /**
   * List broadcasts for current user with read/deleted status
   */
  listBroadcasts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const userTier = ctx.user.subscriptionTier;

    // Get all broadcasts for user's tier
    const allBroadcasts = await db
      .select()
      .from(broadcasts)
      .where(
        // Show broadcasts for "all" or user's specific tier
        eq(broadcasts.targetTier, "all")
      )
      .orderBy(desc(broadcasts.createdAt));

    // Get user's read/delete status for these broadcasts
    const broadcastIds = allBroadcasts.map((b: any) => b.id);
    const readStatuses = await db
      .select()
      .from(broadcastReads)
      .where(
        and(
          eq(broadcastReads.userId, userId),
          // Only get statuses for current broadcasts
        )
      );

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
});
