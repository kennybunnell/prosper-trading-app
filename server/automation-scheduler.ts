/**
 * Automation Scheduler
 * Handles scheduled execution of daily trading automation at 9:35 AM ET
 * and Friday expiration sweep at 9:30 AM ET every Friday.
 */

import * as cron from 'node-cron';
import { getAutomationSettings } from './db-automation';
import { getDb } from './db';
import { automationSettings } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { notifyOwner } from './_core/notification';

let scheduledTask: cron.ScheduledTask | null = null;
let fridaySweepTask: cron.ScheduledTask | null = null;
let dailyITMScanTask: cron.ScheduledTask | null = null;
let weeklyPositionDigestTask: cron.ScheduledTask | null = null;

/**
 * Initialize the automation scheduler
 * Checks all users with auto-schedule enabled and sets up cron jobs
 */
export function initializeAutomationScheduler() {
  console.log('[Automation Scheduler] Initializing...');

  // Daily automation at 9:35 AM ET
  scheduledTask = cron.schedule(
    '35 9 * * *', // 9:35 AM every day
    async () => {
      console.log('[Automation Scheduler] Running scheduled automation check...');
      await runScheduledAutomations();
    },
    {
      timezone: 'America/New_York', // Eastern Time
    }
  );
  console.log('[Automation Scheduler] Initialized successfully. Will run at 9:35 AM ET daily.');

  // Friday expiration sweep at 9:30 AM ET every Friday
  fridaySweepTask = cron.schedule(
    '30 9 * * 5', // 9:30 AM every Friday (5 = Friday)
    async () => {
      console.log('[Friday Sweep] Running Friday expiration risk sweep...');
      await runFridayExpirationSweep();
    },
    {
      timezone: 'America/New_York',
    }
  );
  console.log('[Automation Scheduler] Friday sweep initialized. Will run at 9:30 AM ET every Friday.');

  // Daily ITM assignment risk scan at 9:00 AM ET every weekday (Mon-Fri)
  dailyITMScanTask = cron.schedule(
    '0 9 * * 1-5', // 9:00 AM Monday-Friday
    async () => {
      console.log('[Daily ITM Scan] Running daily ITM assignment risk scan...');
      await runDailyITMScan();
    },
    {
      timezone: 'America/New_York',
    }
  );
  console.log('[Automation Scheduler] Daily ITM scan initialized. Will run at 9:00 AM ET every weekday.');

  // Weekly position digest every Monday at 8:00 AM ET
  weeklyPositionDigestTask = cron.schedule(
    '0 8 * * 1', // 8:00 AM every Monday
    async () => {
      console.log('[Weekly Digest] Running weekly position digest...');
      await runWeeklyPositionDigest();
    },
    {
      timezone: 'America/New_York',
    }
  );
  console.log('[Automation Scheduler] Weekly position digest initialized. Will run at 8:00 AM ET every Monday.');
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
  if (fridaySweepTask) {
    fridaySweepTask.stop();
    fridaySweepTask = null;
    console.log('[Friday Sweep] Stopped');
  }
  if (dailyITMScanTask) {
    dailyITMScanTask.stop();
    dailyITMScanTask = null;
    console.log('[Daily ITM Scan] Stopped');
  }
  if (weeklyPositionDigestTask) {
    weeklyPositionDigestTask.stop();
    weeklyPositionDigestTask = null;
    console.log('[Weekly Digest] Stopped');
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
 * Run Friday expiration sweep for all users with automation enabled.
 * Scans for ITM short calls expiring within 7 DTE and sends owner notification.
 */
async function runFridayExpirationSweep() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('[Friday Sweep] Database not available');
      return;
    }

    // Get all users with auto-schedule enabled
    const users = await db
      .select({ userId: automationSettings.userId })
      .from(automationSettings)
      .where(eq(automationSettings.autoScheduleEnabled, true));

    console.log(`[Friday Sweep] Scanning ${users.length} users for expiration risk...`);

    for (const user of users) {
      try {
        const { safeguardsRouter } = await import('./routers-safeguards');
        const mockCtx = { user: { id: user.userId }, req: {} as any, res: {} as any };

        const result = await safeguardsRouter.createCaller(mockCtx as any).scanExpirationRisk({
          mode: 'friday',
        });

        if (result.hasAlerts) {
          const uncovered = result.alerts.filter((a: any) => !a.isCovered);
          const covered = result.alerts.filter((a: any) => a.isCovered);
          const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const dteCutoff = result.dteCutoff ?? 7;

          let content = `**Friday Expiration Sweep — ${dateStr}**\n\n`;
          content += `Scanned ${result.accountsScanned} account(s). Found ${result.alerts.length} position(s) expiring within ${dteCutoff} DTE.\n\n`;

          if (uncovered.length > 0) {
            content += `🚨 **${uncovered.length} UNCOVERED ITM short call(s) — IMMEDIATE ACTION REQUIRED:**\n`;
            for (const alert of uncovered) {
              content += `• ${alert.symbol} $${alert.strike} exp ${alert.expiration} (${alert.dte} DTE) — Acct ${alert.accountNumber}\n`;
              content += `  ${alert.requiredAction}\n`;
            }
            content += '\n';
          }

          if (covered.length > 0) {
            content += `⚠️ **${covered.length} covered position(s) expiring soon (monitor):**\n`;
            for (const alert of covered) {
              content += `• ${alert.symbol} $${alert.strike} exp ${alert.expiration} (${alert.dte} DTE) — ${alert.sharesOwned}/${alert.sharesNeeded} shares covered\n`;
            }
          }

          content += `\nLog in to the Prosper Trading app → Action Items → IRA Safety to review and take action.`;

          await notifyOwner({
            title: uncovered.length > 0
              ? `🚨 Friday Sweep: ${uncovered.length} Uncovered ITM Call(s) Need Immediate Action`
              : `⚠️ Friday Sweep: ${result.alerts.length} Position(s) Expiring This Week`,
            content,
          });

          console.log(`[Friday Sweep] Notification sent for user ${user.userId}: ${uncovered.length} uncovered, ${covered.length} covered`);
        } else {
          console.log(`[Friday Sweep] User ${user.userId}: No expiration risk found — all clear.`);
        }
      } catch (userError) {
        console.error(`[Friday Sweep] Error scanning user ${user.userId}:`, userError);
      }
    }
  } catch (error) {
    console.error('[Friday Sweep] Error in Friday sweep run:', error);
  }
}

/**
 * Daily ITM assignment risk scan — runs every weekday at 9:00 AM ET.
 * Scans for short calls that are ITM with ≤5 DTE and sends a notification if found.
 * This catches mid-week assignment risks that the Friday sweep would miss.
 */
async function runDailyITMScan() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('[Daily ITM Scan] Database not available');
      return;
    }

    // Get all users with auto-schedule enabled
    const users = await db
      .select({ userId: automationSettings.userId })
      .from(automationSettings)
      .where(eq(automationSettings.autoScheduleEnabled, true));

    console.log(`[Daily ITM Scan] Scanning ${users.length} users for ITM assignment risk...`);

    for (const user of users) {
      try {
        const { safeguardsRouter } = await import('./routers-safeguards');
        const mockCtx = { user: { id: user.userId }, req: {} as any, res: {} as any };

        // Use 'daily' mode (≤5 DTE) — Friday uses 'friday' mode (≤7 DTE)
        const result = await safeguardsRouter.createCaller(mockCtx as any).scanExpirationRisk({
          mode: 'daily',
        });

        if (result.hasAlerts) {
          const uncovered = result.alerts.filter((a: any) => !a.isCovered);
          const covered = result.alerts.filter((a: any) => a.isCovered);
          const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

          // Only notify if there are uncovered ITM calls — covered positions are just monitoring
          if (uncovered.length > 0) {
            let content = `**Daily ITM Assignment Risk Scan — ${dateStr}**\n\n`;
            content += `Found ${uncovered.length} uncovered ITM short call(s) expiring within 5 DTE.\n\n`;
            content += `🚨 **IMMEDIATE ACTION REQUIRED:**\n`;
            for (const alert of uncovered) {
              content += `• ${alert.symbol} $${alert.strike} exp ${alert.expiration} (${alert.dte} DTE) — Acct ${alert.accountNumber}\n`;
              content += `  ${alert.requiredAction}\n`;
            }
            if (covered.length > 0) {
              content += `\n⚠️ ${covered.length} covered position(s) also expiring soon (no action needed unless going ITM).\n`;
            }
            content += `\nLog in to the Prosper Trading app → Action Items → Portfolio Safety to review and take action.`;

            await notifyOwner({
              title: `🚨 Daily Scan: ${uncovered.length} Uncovered ITM Call(s) — ${dateStr}`,
              content,
            });

            console.log(`[Daily ITM Scan] Alert sent for user ${user.userId}: ${uncovered.length} uncovered ITM calls`);
          } else {
            console.log(`[Daily ITM Scan] User ${user.userId}: ${covered.length} covered positions expiring soon — no uncovered ITM calls.`);
          }
        } else {
          console.log(`[Daily ITM Scan] User ${user.userId}: No ITM assignment risk found — all clear.`);
        }
      } catch (userError) {
        console.error(`[Daily ITM Scan] Error scanning user ${user.userId}:`, userError);
      }
    }
  } catch (error) {
    console.error('[Daily ITM Scan] Error in daily ITM scan run:', error);
  }
}

/**
 * Weekly Monday morning position digest.
 * Scans all stock positions for users with weeklyPositionDigestEnabled=true
 * and sends a summary notification with LIQUIDATE/HARVEST/KEEP breakdown.
 */
async function runWeeklyPositionDigest() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('[Weekly Digest] Database not available');
      return;
    }

    const users = await db
      .select({ userId: automationSettings.userId })
      .from(automationSettings)
      .where(eq(automationSettings.weeklyPositionDigestEnabled, true));

    console.log(`[Weekly Digest] Sending digest to ${users.length} users...`);

    for (const user of users) {
      try {
        const { positionAnalyzerRouter } = await import('./routers-position-analyzer');
        const mockCtx = { user: { id: user.userId }, req: {} as any, res: {} as any };
        const result = await positionAnalyzerRouter.createCaller(mockCtx as any).analyzePositions();

        const { positions, summary } = result;
        const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

        const liquidate = positions.filter(p => p.recommendation === 'LIQUIDATE');
        const harvest = positions.filter(p => p.recommendation === 'HARVEST');
        const keep = positions.filter(p => p.recommendation === 'KEEP');

        let content = `**Weekly Position Digest — ${dateStr}**\n\n`;
        content += `Scanned ${summary.totalPositions} stock position(s) across all accounts.\n`;
        content += `Total market value: $${(summary.totalMarketValue / 1000).toFixed(0)}k | Unrealized P&L: ${summary.totalUnrealizedPnl >= 0 ? '+' : ''}$${(summary.totalUnrealizedPnl / 1000).toFixed(0)}k\n\n`;

        if (liquidate.length > 0) {
          content += `🔴 **LIQUIDATE (${liquidate.length}) — ~$${(summary.estimatedLiquidationProceeds / 1000).toFixed(0)}k to redeploy:**\n`;
          for (const p of liquidate) {
            content += `• ${p.symbol} @ $${p.currentPrice.toFixed(2)} (${p.drawdownFromHigh.toFixed(0)}% from 52-wk high) — ${p.recommendationReason}\n`;
            if (p.redeploymentSuggestion) content += `  → ${p.redeploymentSuggestion}\n`;
          }
          content += '\n';
        }

        if (harvest.length > 0) {
          content += `🟡 **HARVEST & EXIT (${harvest.length}) — ~$${summary.estimatedWeeklyPremium.toFixed(0)} premium/wk:**\n`;
          for (const p of harvest) {
            const contracts = Math.floor(p.quantity / 100);
            const weeklyCredit = p.ccAtmPremium && contracts > 0 ? p.ccAtmPremium * contracts * 100 : 0;
            content += `• ${p.symbol} @ $${p.currentPrice.toFixed(2)} — Sell ${contracts} x $${p.ccAtmStrike?.toFixed(0)} call (${p.ccExpiration}) for ~$${weeklyCredit.toFixed(0)} credit\n`;
          }
          content += '\n';
        }

        if (keep.length > 0) {
          content += `🟢 **KEEP & WHEEL (${keep.length}):** ${keep.map(p => p.symbol).join(', ')}\n\n`;
        }

        content += `Log in to Prosper Trading → Action Items → Portfolio Safety → Position Analyzer to act on these recommendations.`;

        await notifyOwner({
          title: `📊 Weekly Digest: ${liquidate.length} Liquidate, ${harvest.length} Harvest, ${keep.length} Keep — ${dateStr}`,
          content,
        });

        console.log(`[Weekly Digest] Sent digest for user ${user.userId}: ${liquidate.length} liquidate, ${harvest.length} harvest, ${keep.length} keep`);
      } catch (userError) {
        console.error(`[Weekly Digest] Error for user ${user.userId}:`, userError);
      }
    }
  } catch (error) {
    console.error('[Weekly Digest] Error in weekly digest run:', error);
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

/**
 * Manually trigger the Friday sweep for a specific user (for testing)
 */
export async function manuallyTriggerFridaySweep(userId: string) {
  console.log(`[Friday Sweep] Manually triggering Friday sweep for user ${userId}`);
  const { safeguardsRouter } = await import('./routers-safeguards');
  const mockCtx = { user: { id: userId }, req: {} as any, res: {} as any };
  return safeguardsRouter.createCaller(mockCtx as any).scanExpirationRisk({
    mode: 'friday',
  });
}
