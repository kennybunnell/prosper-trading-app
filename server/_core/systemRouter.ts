import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, protectedProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  testTelegram: protectedProcedure
    .mutation(async ({ ctx }) => {
      const { sendTelegramMessage } = await import('../telegram');
      const now = new Date().toLocaleString('en-US', {
        timeZone: 'America/Denver',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
      const msg =
        `✅ <b>Telegram Test Successful!</b>\n\n` +
        `Sent from Prosper Trading dashboard\n` +
        `👤 User: ${ctx.user.name || ctx.user.email || 'Unknown'}\n` +
        `🕐 Time: ${now}\n\n` +
        `Daily briefings are scheduled for <b>8:30 AM MT</b> every weekday.\n` +
        `<a href="https://prospertrading.biz">🔗 Open Dashboard</a>`;
      await sendTelegramMessage(msg);
      return { success: true };
    }),
});
