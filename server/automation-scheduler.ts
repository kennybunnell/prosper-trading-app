/**
 * Automation Scheduler
 * Handles scheduled execution of daily trading automation at 9:35 AM ET
 * and Friday expiration sweep at 9:30 AM ET every Friday.
 */

import * as cron from 'node-cron';
import { getAutomationSettings } from './db-automation';
import { getDb } from './db';
import { automationSettings, wtrHistory } from '../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { notifyOwner } from './_core/notification';

let scheduledTask: cron.ScheduledTask | null = null;
let fridaySweepTask: cron.ScheduledTask | null = null;
let dailyITMScanTask: cron.ScheduledTask | null = null;
let weeklyPositionDigestTask: cron.ScheduledTask | null = null;
let dailyScanCacheTask: cron.ScheduledTask | null = null;

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

  // Daily scan cache refresh at 8:30 AM ET every weekday (Mon-Fri)
  // Computes Close for Profit, Roll Positions, Sell Calls badge counts
  dailyScanCacheTask = cron.schedule(
    '30 8 * * 1-5', // 8:30 AM Monday-Friday
    async () => {
      console.log('[Daily Scan Cache] Running 8:30 AM ET daily scan...');
      await runDailyScanForAllUsers();
    },
    {
      timezone: 'America/New_York',
    }
  );
  console.log('[Automation Scheduler] Daily scan cache initialized. Will run at 8:30 AM ET every weekday.');
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
  if (dailyScanCacheTask) {
    dailyScanCacheTask.stop();
    dailyScanCacheTask = null;
    console.log('[Daily Scan Cache] Stopped');
  }
}

/**
 * Run daily scan cache refresh for all users with a Tastytrade API configured.
 * Computes Close for Profit, Roll Positions, Sell Calls badge counts.
 */
async function runDailyScanForAllUsers() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('[Daily Scan Cache] Database not available');
      return;
    }

    // Get all users who have Tastytrade credentials configured
    const { apiCredentials } = await import('../drizzle/schema');
    const { isNotNull } = await import('drizzle-orm');
    const users = await db
      .select({ userId: apiCredentials.userId })
      .from(apiCredentials)
      .where(isNotNull(apiCredentials.tastytradeRefreshToken));

    console.log(`[Daily Scan Cache] Scanning ${users.length} user(s)...`);

    for (const user of users) {
      try {
        const { runDailyScan } = await import('./daily-scan');
        const result = await runDailyScan(user.userId);
        if (result.success) {
          console.log(`[Daily Scan Cache] User ${user.userId}: closeProfit=${result.closeProfitCount}, roll=${result.rollPositionsCount}, sellCalls=${result.sellCallsCount}`);
        } else {
          console.error(`[Daily Scan Cache] User ${user.userId} scan failed: ${result.error}`);
        }
      } catch (userError) {
        console.error(`[Daily Scan Cache] Error scanning user ${user.userId}:`, userError);
      }
    }
  } catch (error) {
    console.error('[Daily Scan Cache] Error in daily scan run:', error);
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
 * Focuses on FLAGGED-for-exit positions: which are locked (CC active), which are eligible
 * to harvest this week, and estimated proceeds from clearing all dogs.
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
        // Run full position analysis (this also auto-unflags any closed positions)
        const { positionAnalyzerRouter } = await import('./routers-position-analyzer');
        const mockCtx = { user: { id: user.userId }, req: {} as any, res: {} as any };
        const result = await positionAnalyzerRouter.createCaller(mockCtx as any).analyzePositions();
        const { positions } = result;

        // Load current liquidation flags after auto-unflag has run
        const { liquidationFlags } = await import('../drizzle/schema');
        const flags = await db.select({
          symbol: liquidationFlags.symbol,
          accountNumber: liquidationFlags.accountNumber,
        }).from(liquidationFlags).where(eq(liquidationFlags.userId, user.userId));

        if (flags.length === 0) {
          console.log(`[Weekly Digest] User ${user.userId}: No flagged positions — skipping digest.`);
          continue;
        }

        const flagSet = new Set(flags.map(f => `${f.symbol.toUpperCase()}-${f.accountNumber}`));
        const flaggedPositions = positions.filter(p =>
          flagSet.has(`${p.symbol.toUpperCase()}-${p.accountNumber}`)
        );

        const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const today = new Date();
        const sevenDaysOut = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Split into: eligible now (available contracts > 0) vs locked (CC active)
        const eligibleNow = flaggedPositions.filter(p => {
          const available = (p as any).availableContracts ?? Math.floor(p.quantity / 100);
          return available > 0;
        });
        const locked = flaggedPositions.filter(p => {
          const available = (p as any).availableContracts ?? Math.floor(p.quantity / 100);
          return available === 0;
        });

        // Locked positions expiring this week (soonest CC expires within 7 days)
        const expiringThisWeek = locked.filter(p => {
          const calls: any[] = (p as any).openShortCalls ?? [];
          return calls.some(c => {
            const exp = new Date(c.expiration);
            return exp <= sevenDaysOut;
          });
        });

        // Estimated proceeds: eligible now (market value) + expiring this week (market value)
        const estimatedEligibleProceeds = eligibleNow.reduce((s, p) => s + p.marketValue, 0);
        const estimatedExpiringProceeds = expiringThisWeek.reduce((s, p) => s + p.marketValue, 0);
        const totalEstimatedProceeds = estimatedEligibleProceeds + estimatedExpiringProceeds;

        // ─── WTR Movers: positions that worsened by >2 weeks since last scan ───
        let wtrMoversContent = '';
        try {
          // Get the two most recent distinct scan dates from wtr_history
          const recentDates = await db
            .selectDistinct({ scanDate: wtrHistory.scanDate })
            .from(wtrHistory)
            .orderBy(desc(wtrHistory.scanDate))
            .limit(2);

          if (recentDates.length >= 2) {
            const [latestDate, prevDate] = recentDates;

            // Fetch WTR for both dates for all positions
            const latestRows = await db
              .select()
              .from(wtrHistory)
              .where(eq(wtrHistory.scanDate, latestDate.scanDate));

            const prevRows = await db
              .select()
              .from(wtrHistory)
              .where(eq(wtrHistory.scanDate, prevDate.scanDate));

            // weeksToRecover is stored as varchar — parse to float for arithmetic
            const parseWtr = (v: string | null | undefined): number | null =>
              v !== null && v !== undefined && v !== '' ? parseFloat(v) : null;

            const prevMap = new Map<string, number | null>(
              prevRows.map(r => [`${r.symbol}-${r.accountNumber}`, parseWtr(r.weeksToRecover)])
            );

            // Find positions that worsened by >2 weeks
            const moversWorse = latestRows
              .filter(r => {
                const curr = parseWtr(r.weeksToRecover);
                const prev = prevMap.get(`${r.symbol}-${r.accountNumber}`);
                if (curr === null || prev === null || prev === undefined) return false;
                return (curr - prev) > 2;
              })
              .sort((a, b) => {
                const ca = parseWtr(a.weeksToRecover) ?? 0;
                const pa = prevMap.get(`${a.symbol}-${a.accountNumber}`) ?? 0;
                const cb = parseWtr(b.weeksToRecover) ?? 0;
                const pb = prevMap.get(`${b.symbol}-${b.accountNumber}`) ?? 0;
                return (cb - pb) - (ca - pa); // worst delta first
              });

            // Find positions that improved by >2 weeks
            const moversImproved = latestRows
              .filter(r => {
                const curr = parseWtr(r.weeksToRecover);
                const prev = prevMap.get(`${r.symbol}-${r.accountNumber}`);
                if (curr === null || prev === null || prev === undefined) return false;
                return (prev - curr) > 2;
              })
              .sort((a, b) => {
                const ca = parseWtr(a.weeksToRecover) ?? 0;
                const pa = prevMap.get(`${a.symbol}-${a.accountNumber}`) ?? 0;
                const cb = parseWtr(b.weeksToRecover) ?? 0;
                const pb = prevMap.get(`${b.symbol}-${b.accountNumber}`) ?? 0;
                return (pb - cb) - (pa - ca); // most improved first
              });

            if (moversWorse.length > 0 || moversImproved.length > 0) {
              wtrMoversContent += `\n📊 **WTR MOVERS THIS WEEK (vs. ${new Date(prevDate.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}):**\n`;

              if (moversWorse.length > 0) {
                wtrMoversContent += `\n⚠️ Worsening (>${2} wks worse — ${moversWorse.length} position${moversWorse.length !== 1 ? 's' : ''}):\n`;
                for (const r of moversWorse) {
                  const curr = parseWtr(r.weeksToRecover) ?? 0;
                  const prev = prevMap.get(`${r.symbol}-${r.accountNumber}`) ?? 0;
                  const delta = curr - prev;
                  const approaching = curr > 40;
                  wtrMoversContent += `• ${r.symbol} (${r.recommendation}): ${prev.toFixed(1)} → ${curr.toFixed(1)} wks (+${delta.toFixed(1)} wks)${approaching ? ' ⚠️ approaching 52-week threshold' : ''}\n`;
                }
              }

              if (moversImproved.length > 0) {
                wtrMoversContent += `\n✅ Recovering (>${2} wks better — ${moversImproved.length} position${moversImproved.length !== 1 ? 's' : ''}):\n`;
                for (const r of moversImproved) {
                  const curr = parseWtr(r.weeksToRecover) ?? 0;
                  const prev = prevMap.get(`${r.symbol}-${r.accountNumber}`) ?? 0;
                  const delta = prev - curr;
                  wtrMoversContent += `• ${r.symbol} (${r.recommendation}): ${prev.toFixed(1)} → ${curr.toFixed(1)} wks (-${delta.toFixed(1)} wks)\n`;
                }
              }

              wtrMoversContent += '\n';
            }
          }
        } catch (wtrErr) {
          console.warn('[Weekly Digest] Could not compute WTR movers:', wtrErr);
        }

        let content = `**Weekly Dog Clearing Digest — ${dateStr}**\n\n`;
        content += `You have **${flaggedPositions.length} position(s) flagged for exit** across all accounts.\n`;
        content += `Estimated proceeds from clearing all flagged dogs: **~$${(totalEstimatedProceeds / 1000).toFixed(1)}k**\n`;
        if (wtrMoversContent) content += wtrMoversContent;
        content += '\n';

        // --- Eligible Now ---
        if (eligibleNow.length > 0) {
          content += `⚡ **ELIGIBLE TO HARVEST NOW (${eligibleNow.length}) — ~$${(estimatedEligibleProceeds / 1000).toFixed(1)}k in shares:**\n`;
          for (const p of eligibleNow) {
            const contracts = (p as any).availableContracts ?? Math.floor(p.quantity / 100);
            const credit = p.ccAtmPremium && contracts > 0 ? p.ccAtmPremium * contracts * 100 : 0;
            content += `• ${p.symbol} (${p.recommendation}) @ $${p.currentPrice.toFixed(2)} — ${contracts} contract(s) free`;
            if (p.ccAtmStrike && p.ccAtmPremium) {
              content += ` → Sell $${p.ccAtmStrike.toFixed(0)} ITM call for ~$${credit.toFixed(0)} credit`;
            }
            content += `\n`;
          }
          content += '\n';
        }

        // --- Expiring This Week (becoming eligible) ---
        if (expiringThisWeek.length > 0) {
          content += `📅 **CC EXPIRING THIS WEEK — WILL BECOME ELIGIBLE (${expiringThisWeek.length}):**\n`;
          for (const p of expiringThisWeek) {
            const calls: any[] = (p as any).openShortCalls ?? [];
            const soonest = calls.reduce((min: any, c: any) => c.daysToExpiry < min.daysToExpiry ? c : min, calls[0]);
            content += `• ${p.symbol} — $${soonest?.strike?.toFixed(0) ?? '?'} call expires ${soonest?.expiration ?? '?'} (${soonest?.daysToExpiry ?? '?'}d) — $${(p.marketValue / 1000).toFixed(1)}k in shares\n`;
          }
          content += '\n';
        }

        // --- Still Locked (not expiring this week) ---
        const stillLocked = locked.filter(p => !expiringThisWeek.includes(p));
        if (stillLocked.length > 0) {
          content += `🔒 **STILL LOCKED — CC ACTIVE BEYOND THIS WEEK (${stillLocked.length}):**\n`;
          for (const p of stillLocked) {
            const calls: any[] = (p as any).openShortCalls ?? [];
            const soonest = calls.length > 0
              ? calls.reduce((min: any, c: any) => c.daysToExpiry < min.daysToExpiry ? c : min, calls[0])
              : null;
            content += `• ${p.symbol} — ${soonest ? `$${soonest.strike?.toFixed(0)} call exp ${soonest.expiration} (${soonest.daysToExpiry}d)` : 'CC details unavailable'}\n`;
          }
          content += '\n';
        }

        content += `Log in to Prosper Trading → Position Analyzer → ⚡ Eligible Now to act on today’s opportunities.`;

        const titleParts = [];
        if (eligibleNow.length > 0) titleParts.push(`${eligibleNow.length} eligible now`);
        if (expiringThisWeek.length > 0) titleParts.push(`${expiringThisWeek.length} expiring this week`);
        if (stillLocked.length > 0) titleParts.push(`${stillLocked.length} still locked`);

        await notifyOwner({
          title: `🐕 Dog Clearing Digest: ${titleParts.join(' · ')} — ${dateStr}`,
          content,
        });

        console.log(`[Weekly Digest] Sent flagged-position digest for user ${user.userId}: ${eligibleNow.length} eligible, ${expiringThisWeek.length} expiring, ${stillLocked.length} locked`);
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
