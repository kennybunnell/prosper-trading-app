/**
 * Database helper functions for daily trading automation
 */

import { getDb } from './db';
import { automationSettings, automationLogs, automationPendingOrders } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * Get or create automation settings for a user
 */
export async function getAutomationSettings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const [settings] = await db
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.userId, userId))
    .limit(1);

  if (!settings) {
    // Create default settings
    await db
      .insert(automationSettings)
      .values({
        userId,
        dryRunMode: true,
        requireApproval: true,
        autoScheduleEnabled: false,
        scheduleTime: '09:35',
        profitThresholdPercent: 75,
        ccDteMin: 7,
        ccDteMax: 14,
        ccDeltaMin: '0.25',
        ccDeltaMax: '0.30',
        emailNotificationsEnabled: true,
      });
    
    // Fetch the newly created settings
    const [newSettings] = await db
      .select()
      .from(automationSettings)
      .where(eq(automationSettings.userId, userId))
      .limit(1);
    
    if (!newSettings) throw new Error('Failed to create automation settings');
    return newSettings;
  }

  return settings;
}

/**
 * Update automation settings
 */
export async function updateAutomationSettings(
  userId: number,
  updates: Partial<typeof automationSettings.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db
    .update(automationSettings)
    .set(updates)
    .where(eq(automationSettings.userId, userId));
}

/**
 * Create a new automation log
 */
export async function createAutomationLog(data: {
  userId: number;
  runId: string;
  triggerType: 'manual' | 'scheduled';
  dryRun: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const [log] = await db
    .insert(automationLogs)
    .values({
      userId: data.userId,
      runId: data.runId,
      triggerType: data.triggerType,
      dryRun: data.dryRun,
      status: 'running',
      positionsClosedCount: 0,
      coveredCallsOpenedCount: 0,
      totalProfitRealized: '0',
      totalPremiumCollected: '0',
      accountsProcessed: 0,
    });
  return log;
}

/**
 * Update automation log
 */
export async function updateAutomationLog(
  runId: string,
  updates: Partial<typeof automationLogs.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db
    .update(automationLogs)
    .set(updates)
    .where(eq(automationLogs.runId, runId));
}

/**
 * Get automation logs for a user
 */
export async function getAutomationLogs(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  return db
    .select()
    .from(automationLogs)
    .where(eq(automationLogs.userId, userId))
    .orderBy(desc(automationLogs.startedAt))
    .limit(limit);
}

/**
 * Get a specific automation log by runId
 */
export async function getAutomationLog(runId: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const [log] = await db
    .select()
    .from(automationLogs)
    .where(eq(automationLogs.runId, runId))
    .limit(1);
  return log;
}

/**
 * Create pending orders for approval
 */
export async function createPendingOrders(
  orders: Array<typeof automationPendingOrders.$inferInsert>
) {
  if (orders.length === 0) return [];
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  return db.insert(automationPendingOrders).values(orders);
}

/**
 * Get pending orders for a run
 */
export async function getPendingOrders(runId: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  return db
    .select()
    .from(automationPendingOrders)
    .where(eq(automationPendingOrders.runId, runId))
    .orderBy(automationPendingOrders.createdAt);
}

/**
 * Get pending orders by status
 */
export async function getPendingOrdersByStatus(
  runId: string,
  status: 'pending' | 'approved' | 'rejected' | 'submitted' | 'failed'
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  return db
    .select()
    .from(automationPendingOrders)
    .where(
      and(
        eq(automationPendingOrders.runId, runId),
        eq(automationPendingOrders.status, status)
      )
    );
}

/**
 * Update pending order status
 */
export async function updatePendingOrder(
  orderId: number,
  updates: Partial<typeof automationPendingOrders.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db
    .update(automationPendingOrders)
    .set(updates)
    .where(eq(automationPendingOrders.id, orderId));
}

/**
 * Approve all pending orders for a run
 */
export async function approveAllPendingOrders(runId: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db
    .update(automationPendingOrders)
    .set({
      status: 'approved',
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(automationPendingOrders.runId, runId),
        eq(automationPendingOrders.status, 'pending')
      )
    );
}

/**
 * Approve specific pending orders
 */
export async function approvePendingOrders(orderIds: number[]) {
  if (orderIds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  for (const id of orderIds) {
    await db
      .update(automationPendingOrders)
      .set({
        status: 'approved',
        approvedAt: new Date(),
      })
      .where(eq(automationPendingOrders.id, id));
  }
}

/**
 * Delete a specific automation log (pending orders cascade via FK)
 */
export async function deleteAutomationLog(runId: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Delete pending orders first (in case cascade isn't set up)
  await db
    .delete(automationPendingOrders)
    .where(eq(automationPendingOrders.runId, runId));

  await db
    .delete(automationLogs)
    .where(eq(automationLogs.runId, runId));
}

/**
 * Clear all automation logs for a user
 */
export async function clearAllAutomationLogs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get all runIds for this user first
  const logs = await db
    .select({ runId: automationLogs.runId })
    .from(automationLogs)
    .where(eq(automationLogs.userId, userId));

  // Delete pending orders for all runs
  for (const log of logs) {
    await db
      .delete(automationPendingOrders)
      .where(eq(automationPendingOrders.runId, log.runId));
  }

  // Delete all logs
  await db
    .delete(automationLogs)
    .where(eq(automationLogs.userId, userId));
}

/**
 * Reject specific pending orders
 */
export async function rejectPendingOrders(orderIds: number[]) {
  if (orderIds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  for (const id of orderIds) {
    await db
      .update(automationPendingOrders)
      .set({
        status: 'rejected',
      })
      .where(eq(automationPendingOrders.id, id));
  }
}
