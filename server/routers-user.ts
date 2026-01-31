import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const userRouter = router({
  /**
   * Set user's trading mode (live or paper)
   */
  setTradingMode: protectedProcedure
    .input(
      z.object({
        mode: z.enum(['live', 'paper']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      await db
        .update(users)
        .set({ tradingMode: input.mode })
        .where(eq(users.id, ctx.user.id));

      return { success: true, mode: input.mode };
    }),
});
