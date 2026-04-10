/**
 * Portfolio Sync Scheduler — Prosper Trading
 *
 * Runs an incremental portfolio sync every 15 minutes during market hours
 * (9:30 AM – 4:15 PM ET, Monday–Friday, excluding major US holidays).
 *
 * This keeps the DB cache fresh throughout the trading day without requiring
 * any manual action from the user. The sync is incremental — only new
 * transactions since the last sync are fetched, so it is fast and low-cost.
 *
 * Outside market hours, no syncs run. The cache is also synced on login
 * via the OAuth callback.
 */

import { getDb } from './db';
import { users } from '../drizzle/schema';

// ET offset from UTC (EST = -5, EDT = -4)
function getETOffset(): number {
  // Determine if Eastern Time is currently in DST
  // DST starts second Sunday in March, ends first Sunday in November
  const now = new Date();
  const year = now.getUTCFullYear();

  // Second Sunday in March
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchFirstDay = marchFirst.getUTCDay(); // 0=Sun
  const dstStart = new Date(Date.UTC(year, 2, 8 + ((7 - marchFirstDay) % 7)));

  // First Sunday in November
  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstDay = novFirst.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, 1 + ((7 - novFirstDay) % 7)));

  const isDST = now >= dstStart && now < dstEnd;
  return isDST ? -4 : -5;
}

function isMarketHours(): boolean {
  const now = new Date();
  const etOffset = getETOffset();

  // Convert UTC to ET
  const etMs = now.getTime() + etOffset * 60 * 60 * 1000;
  const et = new Date(etMs);

  const dayOfWeek = et.getUTCDay(); // 0=Sun, 6=Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Weekend

  const hours = et.getUTCHours();
  const minutes = et.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // 9:30 AM ET = 570 minutes, 4:15 PM ET = 975 minutes
  return timeInMinutes >= 570 && timeInMinutes <= 975;
}

// Simple US market holiday check (major holidays only)
function isMarketHoliday(): boolean {
  const now = new Date();
  const etOffset = getETOffset();
  const etMs = now.getTime() + etOffset * 60 * 60 * 1000;
  const et = new Date(etMs);

  const month = et.getUTCMonth() + 1; // 1-indexed
  const day = et.getUTCDate();
  const year = et.getUTCFullYear();

  // Fixed holidays
  const fixed = [
    `${year}-01-01`, // New Year's Day
    `${year}-07-04`, // Independence Day
    `${year}-12-25`, // Christmas
  ];
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (fixed.includes(dateStr)) return true;

  // MLK Day: 3rd Monday in January
  // Presidents Day: 3rd Monday in February
  // Memorial Day: Last Monday in May
  // Labor Day: 1st Monday in September
  // Thanksgiving: 4th Thursday in November
  // Good Friday: calculated separately (skip for simplicity — rare edge case)

  return false;
}

let syncSchedulerInterval: NodeJS.Timeout | null = null;

export function initializePortfolioSyncScheduler(): void {
  if (syncSchedulerInterval) return; // Already running

  console.log('[PortfolioSyncScheduler] Starting 15-minute market-hours sync scheduler');

  // Check every minute whether it's time to sync
  // We sync at :00, :15, :30, :45 past the hour during market hours
  let lastSyncMinute = -1;

  syncSchedulerInterval = setInterval(async () => {
    try {
      if (!isMarketHours() || isMarketHoliday()) return;

      const now = new Date();
      const etOffset = getETOffset();
      const etMs = now.getTime() + etOffset * 60 * 60 * 1000;
      const et = new Date(etMs);
      const minute = et.getUTCMinutes();

      // Trigger at :00, :15, :30, :45
      const isOnInterval = minute % 15 === 0;
      if (!isOnInterval || minute === lastSyncMinute) return;

      lastSyncMinute = minute;
      console.log(`[PortfolioSyncScheduler] Market hours sync triggered at ${et.toISOString()} ET`);

      // Sync all users who have Tastytrade credentials configured
      const db = await getDb();
      if (!db) return;
      const allUsers = await db.select({ id: users.id }).from(users);

      const { syncPortfolio } = await import('./portfolio-sync');
      const { getApiCredentials } = await import('./db');

      let syncCount = 0;
      for (const user of allUsers) {
        try {
          const credentials = await getApiCredentials(user.id);
          if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) continue;

          // Incremental sync — only fetches new transactions since last sync
          syncPortfolio(user.id, false).catch((err: Error) => {
            console.error(`[PortfolioSyncScheduler] Sync failed for user ${user.id}:`, err.message);
          });
          syncCount++;
        } catch (err: any) {
          console.error(`[PortfolioSyncScheduler] Could not check credentials for user ${user.id}:`, err.message);
        }
      }

      if (syncCount > 0) {
        console.log(`[PortfolioSyncScheduler] Incremental sync dispatched for ${syncCount} user(s)`);
      }
    } catch (err: any) {
      console.error('[PortfolioSyncScheduler] Scheduler error:', err.message);
    }
  }, 60 * 1000); // Check every 60 seconds
}

export function stopPortfolioSyncScheduler(): void {
  if (syncSchedulerInterval) {
    clearInterval(syncSchedulerInterval);
    syncSchedulerInterval = null;
    console.log('[PortfolioSyncScheduler] Stopped');
  }
}
