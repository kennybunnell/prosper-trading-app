/**
 * Paper Trading Router
 * Backend procedures for paper trading simulation: mock positions, balance management, sample data
 */

import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from '@trpc/server';
import { z } from "zod";
import { eq, and } from 'drizzle-orm';

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
      // With some variation and occasional losses
      const baseAmount = 250000; // $2,500 base
      const variation = Math.random() * 200000 - 50000; // +/- $500 to $1,500
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
