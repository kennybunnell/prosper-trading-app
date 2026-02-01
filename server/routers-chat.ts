import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { chatConversations, chatMessages } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

/**
 * AI-powered support chat router
 * Handles instant Q&A with LLM and conversation management
 */
export const chatRouter = router({
  /**
   * Ask a question and get AI response
   * Creates new conversation or continues existing one
   */
  askQuestion: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1),
        conversationId: z.number().optional(), // If continuing existing conversation
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      let conversationId = input.conversationId;

      // Create new conversation if not provided
      if (!conversationId) {
        const [conversation] = await db!.insert(chatConversations).values({
          userId: ctx.user.id,
          subject: input.message.substring(0, 100), // First 100 chars as subject
          status: "active",
          lastMessageAt: new Date(),
        });
        conversationId = conversation.insertId;
      } else {
        // Update last message timestamp
        await db!
          .update(chatConversations)
          .set({ lastMessageAt: new Date() })
          .where(eq(chatConversations.id, conversationId));
      }

      // Save user message
      await db!.insert(chatMessages).values({
        conversationId,
        senderId: ctx.user.id,
        senderType: "user",
        message: input.message,
      });

      // Get conversation history for context
      const history = await db!
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .orderBy(chatMessages.createdAt);

      // Build LLM context from conversation history
      const messages = history.map((msg) => ({
        role: msg.senderType === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.message,
      }));

      // Add system prompt for trading app context
      const systemPrompt = `You are a helpful AI assistant for Prosper Trading, an options trading platform focused on income strategies (Cash-Secured Puts, Covered Calls, Poor Man's Covered Calls).

Your role:
- Answer questions about the app's features and how to use them
- Explain options trading concepts and strategies (CSP, CC, PMCC, BPS, BCS)
- Help troubleshoot common issues
- Guide users through workflows

Important guidelines:
- Be concise and friendly
- Use simple language for complex trading concepts
- If you don't know something specific about the app, admit it and suggest they contact support
- For bugs or feature requests, suggest they use the "Report Issue" tab
- Never provide financial advice or recommend specific trades

Available features in the app:
- Dashboard: Overview of monthly premium earnings and account performance
- Action Items: Daily trading tasks and recommendations
- CSP Dashboard: Cash-Secured Put strategy management
- CC Dashboard: Covered Call strategy management
- PMCC Dashboard: Poor Man's Covered Call (LEAP-based) strategy
- Watchlist management for each strategy
- Demo mode with $100k simulated account
- Live trading with Tastytrade API integration`;

      // Get AI response
      const aiResponse = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
          { role: "user", content: input.message },
        ],
      });

      const aiMessageContent = aiResponse.choices[0].message.content;
      const aiMessage = typeof aiMessageContent === 'string' 
        ? aiMessageContent 
        : "I'm sorry, I couldn't generate a response. Please try again.";

      // Save AI response
      await db!.insert(chatMessages).values({
        conversationId,
        senderId: null, // AI has no user ID
        senderType: "ai",
        message: aiMessage,
      });

      return {
        conversationId,
        aiMessage,
      };
    }),

  /**
   * Get chat conversation history
   */
  getChatHistory: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();

      // Verify user owns this conversation
      const [conversation] = await db!
        .select()
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.conversationId),
            eq(chatConversations.userId, ctx.user.id)
          )
        );

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      // Get all messages
      const messages = await db!
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, input.conversationId))
        .orderBy(chatMessages.createdAt);

      return {
        conversation,
        messages,
      };
    }),

  /**
   * List all user's chat conversations
   */
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();

    const conversations = await db!
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.userId, ctx.user.id))
      .orderBy(desc(chatConversations.lastMessageAt));

    return { conversations };
  }),

  /**
   * Mark conversation as resolved
   */
  resolveConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      await db!
        .update(chatConversations)
        .set({ status: "resolved" })
        .where(
          and(
            eq(chatConversations.id, input.conversationId),
            eq(chatConversations.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * Admin: Send message in conversation (join AI chat)
   */
  adminSendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
        message: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized");
      }

      const db = await getDb();

      // Mark conversation as having admin reply
      await db!
        .update(chatConversations)
        .set({
          hasAdminReplied: true,
          lastMessageAt: new Date(),
        })
        .where(eq(chatConversations.id, input.conversationId));

      // Save admin message
      await db!.insert(chatMessages).values({
        conversationId: input.conversationId,
        senderId: ctx.user.id,
        senderType: "admin",
        message: input.message,
      });

      return { success: true };
    }),

  /**
   * Admin: List all conversations (for monitoring)
   */
  adminListConversations: protectedProcedure
    .input(
      z.object({
        status: z.enum(["all", "active", "resolved", "needs_admin"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized");
      }

      const db = await getDb();

      let query = db!
        .select({
          conversation: chatConversations,
          user: {
            id: chatConversations.userId,
            name: chatConversations.userId, // Will join with users table if needed
          },
        })
        .from(chatConversations)
        .orderBy(desc(chatConversations.lastMessageAt));

      if (input.status && input.status !== "all") {
        query = query.where(eq(chatConversations.status, input.status)) as any;
      }

      const conversations = await query;

      return { conversations };
    }),
});
