/**
 * db-export.ts
 * Disaster recovery database export.
 * Dumps critical tables to a JSON bundle and uploads to S3.
 * Returns a time-limited download URL.
 */

import { getDb } from './db';
import { storagePut } from './storage';

export interface ExportResult {
  url: string;
  filename: string;
  exportedAt: string;
  tables: Record<string, number>; // table name → row count
  totalRows: number;
  fileSizeKb: number;
}

/**
 * Export all critical tables for the given userId to a JSON bundle in S3.
 * Tables that are re-syncable from Tastytrade (cached_transactions, cached_positions)
 * are included but flagged as "re-syncable" in the manifest.
 */
export async function exportDatabase(userId: number): Promise<ExportResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const {
    cachedTransactions,
    positions,
    orderHistory,
    watchlists,
    watchlistSelections,
    filterPresets,
    automationSettings,
    userPreferences,
    apiCredentials,
    tastytradeAccounts,
    gtcOrders,
    premiumTracking,
    monthlyPremiumCache,
    trades,
    paperTradingOrders,
    paperTradingPositions,
    paperTradingPerformance,
  } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');

  const now = new Date();

  // Helper: fetch all rows for a user-scoped table
  async function fetchAll<T>(table: T, userIdCol: any): Promise<any[]> {
    try {
      return await (db as any).select().from(table).where(eq(userIdCol, userId));
    } catch {
      return [];
    }
  }

  // Fetch all tables
  const [
    txns,
    pos,
    orders,
    wl,
    wlSel,
    fp,
    autoSettings,
    prefs,
    creds,
    ttAccounts,
    gtc,
    premTracking,
    mpcache,
    tradesData,
    paperOrders,
    paperPos,
    paperPerf,
  ] = await Promise.all([
    fetchAll(cachedTransactions, cachedTransactions.userId),
    fetchAll(positions, positions.userId),
    fetchAll(orderHistory, orderHistory.userId),
    fetchAll(watchlists, watchlists.userId),
    fetchAll(watchlistSelections, watchlistSelections.userId),
    fetchAll(filterPresets, filterPresets.userId),
    fetchAll(automationSettings, automationSettings.userId),
    fetchAll(userPreferences, userPreferences.userId),
    fetchAll(apiCredentials, apiCredentials.userId),
    fetchAll(tastytradeAccounts, tastytradeAccounts.userId),
    fetchAll(gtcOrders, gtcOrders.userId),
    fetchAll(premiumTracking, premiumTracking.userId),
    fetchAll(monthlyPremiumCache, monthlyPremiumCache.userId),
    fetchAll(trades, trades.userId),
    fetchAll(paperTradingOrders, paperTradingOrders.userId),
    fetchAll(paperTradingPositions, paperTradingPositions.userId),
    fetchAll(paperTradingPerformance, paperTradingPerformance.userId),
  ]);

  // Redact sensitive credential fields before export
  const safeCreds = creds.map((c: any) => ({
    ...c,
    sessionToken: '[REDACTED]',
    rememberedToken: '[REDACTED]',
  }));

  const bundle = {
    _meta: {
      exportedAt: now.toISOString(),
      userId,
      appVersion: 'prosper-trading-app',
      note: 'Tables marked re_syncable can be restored by re-syncing with Tastytrade API.',
    },
    // Configuration (most critical — cannot be re-synced)
    watchlists: { rows: wl, re_syncable: false },
    watchlistSelections: { rows: wlSel, re_syncable: false },
    filterPresets: { rows: fp, re_syncable: false },
    automationSettings: { rows: autoSettings, re_syncable: false },
    userPreferences: { rows: prefs, re_syncable: false },
    gtcOrders: { rows: gtc, re_syncable: false },
    // Account data (can be re-synced but useful to have)
    apiCredentials: { rows: safeCreds, re_syncable: true, note: 'Tokens redacted for security' },
    tastytradeAccounts: { rows: ttAccounts, re_syncable: true },
    // Trade history (re-syncable from Tastytrade)
    cachedTransactions: { rows: txns, re_syncable: true },
    positions: { rows: pos, re_syncable: true },
    orderHistory: { rows: orders, re_syncable: true },
    trades: { rows: tradesData, re_syncable: false },
    premiumTracking: { rows: premTracking, re_syncable: false },
    monthlyPremiumCache: { rows: mpcache, re_syncable: true },
    // Paper trading
    paperTradingOrders: { rows: paperOrders, re_syncable: false },
    paperTradingPositions: { rows: paperPos, re_syncable: false },
    paperTradingPerformance: { rows: paperPerf, re_syncable: false },
  };

  const tableCounts: Record<string, number> = {};
  let totalRows = 0;
  for (const [key, val] of Object.entries(bundle)) {
    if (key === '_meta') continue;
    const count = (val as any).rows?.length ?? 0;
    tableCounts[key] = count;
    totalRows += count;
  }

  const json = JSON.stringify(bundle, null, 2);
  const buf = Buffer.from(json, 'utf-8');
  const fileSizeKb = Math.round(buf.length / 1024);

  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `prosper-backup-${dateStr}-${Date.now()}.json`;
  const key = `exports/user-${userId}/${filename}`;

  const { url } = await storagePut(key, buf, 'application/json');

  return {
    url,
    filename,
    exportedAt: now.toISOString(),
    tables: tableCounts,
    totalRows,
    fileSizeKb,
  };
}
