/**
 * Paper Trading Router
 * Backend procedures for paper trading simulation: mock positions, balance management, sample data,
 * simulated order submission, and order history.
 */

import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from '@trpc/server';
import { z } from "zod";
import { eq, and, desc } from 'drizzle-orm';

export const paperTradingRouter = router({
  /**
   * Get paper trading balance and buying power
   */
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    
    const { users } = await import('../drizzle/schema.js');
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }
    
    const balance = user.paperTradingBalance || 100000;
    // Calculate buying power (4x leverage for margin accounts)
    const buyingPower = balance * 4;
    
    return {
      balance,
      buyingPower,
      tradingMode: user.tradingMode,
    };
  }),

  /**
   * Set paper trading balance
   */
  setBalance: protectedProcedure
    .input(z.object({
      balance: z.number().min(1000).max(10000000),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const { users } = await import('../drizzle/schema.js');
      await db.update(users)
        .set({ paperTradingBalance: input.balance })
        .where(eq(users.id, ctx.user.id));
      
      return { success: true, balance: input.balance };
    }),

  /**
   * Seed mock stock positions for paper trading (MAG7 stocks)
   */
  seedMockPositions: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    
    const { paperTradingPositions } = await import('../drizzle/schema.js');
    
    // Check if user already has mock positions
    const existing = await db.select()
      .from(paperTradingPositions)
      .where(eq(paperTradingPositions.userId, ctx.user.id));
    
    if (existing.length > 0) {
      return { success: true, message: 'Mock positions already exist', positions: existing };
    }
    
    // MAG7 stocks with realistic prices and quantities
    const mockPositions = [
      { symbol: 'AAPL', companyName: 'Apple Inc.', quantity: 200, costBasis: '175.50' },
      { symbol: 'MSFT', companyName: 'Microsoft Corporation', quantity: 150, costBasis: '380.25' },
      { symbol: 'GOOGL', companyName: 'Alphabet Inc.', quantity: 100, costBasis: '140.75' },
      { symbol: 'NVDA', companyName: 'NVIDIA Corporation', quantity: 100, costBasis: '495.00' },
    ];
    
    // Insert mock positions
    const inserted = [];
    for (const pos of mockPositions) {
      const [result] = await db.insert(paperTradingPositions).values({
        userId: ctx.user.id,
        symbol: pos.symbol,
        companyName: pos.companyName,
        quantity: pos.quantity,
        costBasis: pos.costBasis,
        currentPrice: pos.costBasis, // Start with cost basis as current price
      });
      inserted.push({ ...pos, id: result.insertId });
    }
    
    return {
      success: true,
      message: 'Mock positions seeded successfully',
      positions: inserted,
    };
  }),

  /**
   * Get mock stock positions for paper trading
   */
  getMockPositions: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    
    const { paperTradingPositions } = await import('../drizzle/schema.js');
    const positions = await db.select()
      .from(paperTradingPositions)
      .where(eq(paperTradingPositions.userId, ctx.user.id));
    
    return positions;
  }),

  /**
   * Clear all mock positions (reset paper trading)
   */
  clearMockPositions: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    
    const { paperTradingPositions } = await import('../drizzle/schema.js');
    await db.delete(paperTradingPositions)
      .where(eq(paperTradingPositions.userId, ctx.user.id));
    
    return { success: true, message: 'Mock positions cleared' };
  }),

  /**
   * Mark that the user has seen the paper trading onboarding walkthrough
   */
  markOnboardingSeen: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    const { users } = await import('../drizzle/schema.js');
    await db.update(users).set({ hasSeenPaperOnboarding: true }).where(eq(users.id, ctx.user.id));
    return { success: true };
  }),

  /**
   * Get whether the user has seen the paper trading onboarding walkthrough
   */
  getOnboardingStatus: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    const { users } = await import('../drizzle/schema.js');
    const [user] = await db.select({
      hasSeenPaperOnboarding: users.hasSeenPaperOnboarding,
      tradingMode: users.tradingMode,
    }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return {
      hasSeenPaperOnboarding: user?.hasSeenPaperOnboarding ?? false,
      tradingMode: user?.tradingMode ?? 'paper',
    };
  }),

  /**
   * Submit a simulated paper trading order (records to paperTradingOrders table)
   */
  submitOrder: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      strategy: z.string().min(1).max(30),
      action: z.string().default('STO'),
      optionType: z.string().optional(),
      strike: z.string().optional(),
      expiration: z.string().optional(),
      dte: z.number().optional(),
      premiumCents: z.number().optional(),
      contracts: z.number().min(1).default(1),
      delta: z.string().optional(),
      orderSnapshot: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });

      // Verify user is in paper mode
      const { users, paperTradingOrders } = await import('../drizzle/schema.js');
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (user.tradingMode !== 'paper') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'submitOrder is only available in paper trading mode' });
      }

      const totalPremiumCents = input.premiumCents
        ? input.premiumCents * input.contracts * 100
        : undefined;

      const [result] = await db.insert(paperTradingOrders).values({
        userId: ctx.user.id,
        symbol: input.symbol.toUpperCase(),
        strategy: input.strategy,
        action: input.action,
        optionType: input.optionType,
        strike: input.strike,
        expiration: input.expiration,
        dte: input.dte,
        premiumCents: input.premiumCents,
        contracts: input.contracts,
        totalPremiumCents,
        delta: input.delta,
        status: 'open',
        orderSnapshot: input.orderSnapshot ? JSON.stringify(input.orderSnapshot) : undefined,
      });

      return {
        success: true,
        orderId: result.insertId,
        message: `Paper order recorded: ${input.action} ${input.contracts}x ${input.symbol} ${input.strike} ${input.expiration}`,
        totalPremiumCents,
      };
    }),

  /**
   * Get all paper trading orders for the current user
   */
  getOrders: protectedProcedure
    .input(z.object({
      status: z.enum(['open', 'closed', 'expired', 'all']).default('all'),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });

      const { paperTradingOrders } = await import('../drizzle/schema.js');
      const status = input?.status ?? 'all';
      const limit = input?.limit ?? 50;

      let query = db.select().from(paperTradingOrders)
        .where(eq(paperTradingOrders.userId, ctx.user.id))
        .orderBy(desc(paperTradingOrders.createdAt))
        .limit(limit);

      if (status !== 'all') {
        query = db.select().from(paperTradingOrders)
          .where(and(
            eq(paperTradingOrders.userId, ctx.user.id),
            eq(paperTradingOrders.status, status as 'open' | 'closed' | 'expired'),
          ))
          .orderBy(desc(paperTradingOrders.createdAt))
          .limit(limit);
      }

      const orders = await query;
      return orders.map(o => ({
        ...o,
        orderSnapshot: o.orderSnapshot ? JSON.parse(o.orderSnapshot) : null,
        premiumDollars: o.premiumCents ? o.premiumCents / 100 : null,
        totalPremiumDollars: o.totalPremiumCents ? o.totalPremiumCents / 100 : null,
        pnlDollars: o.pnlCents ? o.pnlCents / 100 : null,
      }));
    }),

  /**
   * Close a paper trading order (mark as closed with P&L)
   */
  closeOrder: protectedProcedure
    .input(z.object({
      orderId: z.number(),
      closePremiumCents: z.number().optional(), // Premium paid to close (BTC)
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });

      const { paperTradingOrders } = await import('../drizzle/schema.js');
      const [order] = await db.select().from(paperTradingOrders)
        .where(and(
          eq(paperTradingOrders.id, input.orderId),
          eq(paperTradingOrders.userId, ctx.user.id),
        )).limit(1);

      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

      // P&L = premium collected (STO) - premium paid to close (BTC)
      const pnlCents = order.totalPremiumCents != null && input.closePremiumCents != null
        ? order.totalPremiumCents - (input.closePremiumCents * (order.contracts ?? 1) * 100)
        : order.totalPremiumCents ?? 0; // If expired worthless, full premium is profit

      await db.update(paperTradingOrders)
        .set({ status: 'closed', pnlCents, updatedAt: new Date() })
        .where(eq(paperTradingOrders.id, input.orderId));

      return { success: true, pnlCents, pnlDollars: pnlCents / 100 };
    }),

  /**
   * Full reset: clear all paper trading data and restore $100K balance
   */
  resetAll: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });

    const { users, paperTradingPositions, paperTradingPerformance, paperTradingOrders } = await import('../drizzle/schema.js');

    // Clear all paper trading data
    await db.delete(paperTradingPositions).where(eq(paperTradingPositions.userId, ctx.user.id));
    await db.delete(paperTradingPerformance).where(eq(paperTradingPerformance.userId, ctx.user.id));
    await db.delete(paperTradingOrders).where(eq(paperTradingOrders.userId, ctx.user.id));

    // Reset balance to $100K
    await db.update(users)
      .set({ paperTradingBalance: 100000 })
      .where(eq(users.id, ctx.user.id));

    return { success: true, message: 'Paper trading account reset to $100,000' };
  }),

  /**
   * Seed mock performance data for paper trading (6-12 months of premium earnings)
   */
  seedPerformanceData: protectedProcedure.mutation(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    
    const { paperTradingPerformance } = await import('../drizzle/schema.js');
    
    // Check if user already has performance data
    const existing = await db.select()
      .from(paperTradingPerformance)
      .where(eq(paperTradingPerformance.userId, ctx.user.id));
    
    if (existing.length > 0) {
      return { success: true, message: 'Performance data already exists', data: existing };
    }
    
    // Generate 9 months of mock performance data (realistic premium earnings)
    const now = new Date();
    const monthlyData = [];
    let cumulativeTotal = 0;
    
    for (let i = 8; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      // Generate realistic monthly premium: $1,500 - $4,500 (in cents)
      const baseAmount = 250000; // $2,500 base
      const variation = Math.random() * 200000 - 50000;
      const netPremium = Math.round(baseAmount + variation);
      
      cumulativeTotal += netPremium;
      
      monthlyData.push({
        userId: ctx.user.id,
        month,
        netPremium,
        cumulativeTotal,
      });
    }
    
    // Insert all monthly data
    await db.insert(paperTradingPerformance).values(monthlyData);
    
    return {
      success: true,
      message: 'Performance data seeded successfully',
      data: monthlyData,
    };
  }),

  /**
   * Get performance data for paper trading
   */
  getPerformanceData: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
    
    const { paperTradingPerformance } = await import('../drizzle/schema.js');
    const data = await db.select()
      .from(paperTradingPerformance)
      .where(eq(paperTradingPerformance.userId, ctx.user.id))
      .orderBy(paperTradingPerformance.month);
    
    return data;
  }),
});
