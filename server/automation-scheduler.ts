/**
 * Automation Scheduler
 * Handles scheduled execution of daily trading automation at 9:35 AM ET
 */

import * as cron from 'node-cron';
import { getAutomationSettings } from './db-automation';
import { getDb } from './db';
import { automationSettings } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Initialize the automation scheduler
 * Checks all users with auto-schedule enabled and sets up cron jobs
 */
export function initializeAutomationScheduler() {
  console.log('[Automation Scheduler] Initializing...');

  // Schedule check every minute to see if we need to run automation
  // Cron expression: "0 35 9 * * *" = 9:35 AM every day
  // But we need to convert to ET timezone
  
  // Using cron with timezone support
  scheduledTask = cron.schedule(
    '35 9 * * *', // 9:35 AM
    async () => {
      console.log('[Automation Scheduler] Running scheduled automation check...');
      await runScheduledAutomations();
    },
    {
      timezone: 'America/New_York', // Eastern Time
    }
  );

  console.log('[Automation Scheduler] Initialized successfully. Will run at 9:35 AM ET daily.');
}

/**
 * Stop the automation scheduler
 */
export function stopAutomationScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Automation Scheduler] Stopped');
  }
}

/**
 * Run automation for all users with auto-schedule enabled
 */
async function runScheduledAutomations() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('[Automation Scheduler] Database not available');
      return;
    }
    
    // Get all users with auto-schedule enabled
    const users = await db
      .select({
        userId: automationSettings.userId,
      })
      .from(automationSettings)
      .where(eq(automationSettings.autoScheduleEnabled, true));

    console.log(`[Automation Scheduler] Found ${users.length} users with auto-schedule enabled`);

    for (const user of users) {
      try {
        console.log(`[Automation Scheduler] Running automation for user ${user.userId}`);
        
        // Import the automation router dynamically to avoid circular dependencies
        const { automationRouter } = await import('./routers-automation');
        
        // Create a mock context for the scheduled run
        const mockCtx = {
          user: { id: user.userId },
          req: {} as any,
          res: {} as any,
        };

        // Call the runAutomation procedure
        await automationRouter.createCaller(mockCtx as any).runAutomation({
          triggerType: 'scheduled',
        });

        console.log(`[Automation Scheduler] Automation completed for user ${user.userId}`);
      } catch (userError) {
        console.error(`[Automation Scheduler] Error running automation for user ${user.userId}:`, userError);
        // Continue to next user
      }
    }
  } catch (error) {
    console.error('[Automation Scheduler] Error in scheduled automation run:', error);
  }
}

/**
 * Manually trigger automation for a specific user (for testing)
 */
export async function manuallyTriggerAutomation(userId: string) {
  console.log(`[Automation Scheduler] Manually triggering automation for user ${userId}`);
  
  const { automationRouter } = await import('./routers-automation');
  
  const mockCtx = {
    user: { id: userId },
    req: {} as any,
    res: {} as any,
  };

  return automationRouter.createCaller(mockCtx as any).runAutomation({
    triggerType: 'manual',
  });
}
