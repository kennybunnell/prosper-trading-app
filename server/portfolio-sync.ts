/**
 * Portfolio Sync Engine — Prosper Trading
 *
 * Syncs Tastytrade positions and transaction history into the local database cache.
 * AI advisors and analytics read from this cache — no live API calls on every request.
 *
 * Sync strategy:
 *   - Positions: Full refresh on every sync (positions change frequently)
 *   - Transactions: Incremental — only fetch transactions newer than lastTransactionDate
 *   - Initial load: Fetches 3 years of transaction history on first sync
 *
 * Triggers:
 *   - On login (background, non-blocking)
 *   - Manual "Sync Now" button in the UI
 *   - Scheduled: every 15 minutes during market hours (9:30–16:00 ET weekdays)
 */

import { cachedPositions, cachedTransactions, portfolioSyncState } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from './db';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  accountNumber: string;
  positionsSynced: number;
  transactionsSynced: number;
  isInitialLoad: boolean;
  error?: string;
  durationMs: number;
}

// ─── Main Sync Function ───────────────────────────────────────────────────────

/**
 * Sync portfolio data for a user.
 * Fetches all accounts and syncs positions + transactions for each.
 *
 * @param userId - The authenticated user's DB id
 * @param forceFullRefresh - If true, re-fetches all transactions regardless of last sync date
 */
export async function syncPortfolio(
  userId: number,
  forceFullRefresh = false
): Promise<SyncResult[]> {
  const startTime = Date.now();

  try {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');

    const credentials = await getApiCredentials(userId);
    if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
      console.log(`[PortfolioSync] User ${userId}: No Tastytrade credentials configured`);
      return [];
    }

    const tt = await authenticateTastytrade(credentials, userId);
    if (!tt) {
      console.log(`[PortfolioSync] User ${userId}: Failed to authenticate with Tastytrade`);
      return [];
    }

    const accounts = await tt.getAccounts();
    const accountNumbers: string[] = accounts
      .map((acc: any) => acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber)
      .filter(Boolean);

    if (accountNumbers.length === 0) {
      console.log(`[PortfolioSync] User ${userId}: No accounts found`);
      return [];
    }

    const results: SyncResult[] = [];

    for (const accountNumber of accountNumbers) {
      const result = await syncAccount(userId, accountNumber, tt, forceFullRefresh);
      results.push(result);
    }

    const totalPositions = results.reduce((s, r) => s + r.positionsSynced, 0);
    const totalTransactions = results.reduce((s, r) => s + r.transactionsSynced, 0);
    console.log(
      `[PortfolioSync] User ${userId}: Sync complete in ${Date.now() - startTime}ms — ` +
      `${totalPositions} positions, ${totalTransactions} transactions across ${results.length} accounts`
    );

    return results;
  } catch (err: any) {
    console.error(`[PortfolioSync] User ${userId}: Sync failed:`, err.message);
    return [{
      success: false,
      accountNumber: 'unknown',
      positionsSynced: 0,
      transactionsSynced: 0,
      isInitialLoad: false,
      error: err.message,
      durationMs: Date.now() - startTime,
    }];
  }
}

// ─── Account-level Sync ───────────────────────────────────────────────────────

async function syncAccount(
  userId: number,
  accountNumber: string,
  tt: any,
  forceFullRefresh: boolean
): Promise<SyncResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) {
    return { success: false, accountNumber, positionsSynced: 0, transactionsSynced: 0, isInitialLoad: false, error: 'Database unavailable', durationMs: 0 };
  }

  // Get or create sync state for this account
  const [syncState] = await db
    .select()
    .from(portfolioSyncState)
    .where(and(
      eq(portfolioSyncState.userId, userId),
      eq(portfolioSyncState.accountNumber, accountNumber)
    ))
    .limit(1);

  const isInitialLoad = !syncState?.lastTransactionDate || forceFullRefresh;

  // Mark as syncing
  await upsertSyncState(userId, accountNumber, { syncStatus: 'syncing' });

  try {
    // ── 1. Sync Positions (always full refresh) ──────────────────────────────
    const positionsSynced = await syncPositions(userId, accountNumber, tt);

    // ── 2. Sync Transactions (incremental) ───────────────────────────────────
    const transactionsSynced = await syncTransactions(
      userId,
      accountNumber,
      tt,
      isInitialLoad ? null : (syncState?.lastTransactionDate || null)
    );

    // Mark as idle with updated timestamps
    const now = new Date();
    const latestTxn = await db
      .select({ executedAt: cachedTransactions.executedAt })
      .from(cachedTransactions)
      .where(and(
        eq(cachedTransactions.userId, userId),
        eq(cachedTransactions.accountNumber, accountNumber)
      ))
      .orderBy(desc(cachedTransactions.executedAt))
      .limit(1);

    const lastTransactionDate = latestTxn[0]?.executedAt
      ? latestTxn[0].executedAt.toISOString().split('T')[0]
      : syncState?.lastTransactionDate || null;

    // Count total transactions cached
    const countResult = await db
      .select()
      .from(cachedTransactions)
      .where(and(
        eq(cachedTransactions.userId, userId),
        eq(cachedTransactions.accountNumber, accountNumber)
      ));

    await upsertSyncState(userId, accountNumber, {
      syncStatus: 'idle',
      lastPositionsSyncAt: now,
      lastTransactionsSyncAt: now,
      lastTransactionDate: lastTransactionDate || undefined,
      totalTransactionsCached: countResult.length,
      lastSyncError: null,
    });

    return {
      success: true,
      accountNumber,
      positionsSynced,
      transactionsSynced,
      isInitialLoad,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    console.error(`[PortfolioSync] Account ${accountNumber}: Sync failed:`, err.message);
    await upsertSyncState(userId, accountNumber, {
      syncStatus: 'error',
      lastSyncError: err.message,
    });
    return {
      success: false,
      accountNumber,
      positionsSynced: 0,
      transactionsSynced: 0,
      isInitialLoad,
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

// ─── Positions Sync ───────────────────────────────────────────────────────────

async function syncPositions(
  userId: number,
  accountNumber: string,
  tt: any
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const positions = await tt.getPositions(accountNumber);

  // Delete existing positions for this account (full refresh)
  await db
    .delete(cachedPositions)
    .where(and(
      eq(cachedPositions.userId, userId),
      eq(cachedPositions.accountNumber, accountNumber)
    ));

  if (!positions || positions.length === 0) {
    return 0;
  }

  // Build insert rows
  const rows = positions.map((p: any) => {
    const sym = (p.symbol || '').trim();
    const underlying = (p['underlying-symbol'] || sym || '').trim();
    const instrType = p['instrument-type'] || 'Equity';

    // Parse option type from OCC symbol
    let optionType: string | null = null;
    let strikePrice: string | null = null;
    let expiresAt: string | null = null;

    if (instrType === 'Equity Option' || instrType === 'Index Option') {
      const occMatch = sym.replace(/\s+/g, '').match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
      if (occMatch) {
        optionType = occMatch[3]; // 'C' or 'P'
        const strike = parseInt(occMatch[4]) / 1000;
        strikePrice = strike.toFixed(2);
        const raw = occMatch[2];
        expiresAt = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
      }
      // Also try the expires-at field directly
      if (!expiresAt && p['expires-at']) {
        expiresAt = p['expires-at'].split('T')[0];
      }
    }

    return {
      userId,
      accountNumber,
      symbol: sym,
      underlyingSymbol: underlying,
      instrumentType: instrType,
      quantity: String(p.quantity ?? '0'),
      quantityDirection: p['quantity-direction'] || null,
      averageOpenPrice: String(p['average-open-price'] ?? '0'),
      closePrice: p['close-price'] ? String(p['close-price']) : null,
      multiplier: p.multiplier ?? 1,
      optionType,
      strikePrice,
      expiresAt,
    };
  });

  // Insert in batches of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await db.insert(cachedPositions).values(batch);
    inserted += batch.length;
  }

  console.log(`[PortfolioSync] Account ${accountNumber}: Synced ${inserted} positions`);
  return inserted;
}

// ─── Transactions Sync ────────────────────────────────────────────────────────

async function syncTransactions(
  userId: number,
  accountNumber: string,
  tt: any,
  lastTransactionDate: string | null
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const today = new Date();
  const endDate = today.toISOString().split('T')[0];

  // Initial load: fetch 3 years; incremental: fetch since last transaction date
  let startDate: string;
  if (!lastTransactionDate) {
    const threeYearsAgo = new Date(today);
    threeYearsAgo.setFullYear(today.getFullYear() - 3);
    startDate = threeYearsAgo.toISOString().split('T')[0];
    console.log(`[PortfolioSync] Account ${accountNumber}: Initial load — fetching 3 years of transactions`);
  } else {
    // Start from the day after the last transaction we have
    const nextDay = new Date(lastTransactionDate);
    nextDay.setDate(nextDay.getDate() + 1);
    startDate = nextDay.toISOString().split('T')[0];
    console.log(`[PortfolioSync] Account ${accountNumber}: Incremental sync from ${startDate}`);
  }

  // If startDate is today or in the future, nothing to fetch
  if (startDate > endDate) {
    console.log(`[PortfolioSync] Account ${accountNumber}: Already up to date`);
    return 0;
  }

  const transactions = await tt.getTransactionHistory(accountNumber, startDate, endDate);

  if (!transactions || transactions.length === 0) {
    console.log(`[PortfolioSync] Account ${accountNumber}: No new transactions`);
    return 0;
  }

  // Build insert rows
  const rows = transactions.map((t: any) => {
    const sym = (t.symbol || '').trim();
    const underlying = (t['underlying-symbol'] || '').trim();
    const instrType = t['instrument-type'] || '';

    // Parse option type from OCC symbol or direct field
    let optionType: string | null = null;
    let strikePrice: string | null = null;
    let expiresAt: string | null = null;

    if (instrType === 'Equity Option' || instrType === 'Index Option') {
      const occMatch = sym.replace(/\s+/g, '').match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
      if (occMatch) {
        optionType = occMatch[3];
        const strike = parseInt(occMatch[4]) / 1000;
        strikePrice = strike.toFixed(2);
        const raw = occMatch[2];
        expiresAt = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
      }
    }

    // Parse executed-at timestamp
    const executedAtRaw = t['executed-at'] || t['transaction-date'] || '';
    let executedAt: Date;
    try {
      executedAt = executedAtRaw ? new Date(executedAtRaw) : new Date();
    } catch {
      executedAt = new Date();
    }

    // Tastytrade transaction ID
    const tastytradeId = String(t.id || t['transaction-id'] || `${accountNumber}-${executedAt.getTime()}-${Math.random()}`);

    return {
      userId,
      accountNumber,
      tastytradeId,
      transactionType: t['transaction-type'] || '',
      transactionSubType: t['transaction-sub-type'] || null,
      action: t.action || null,
      symbol: sym || null,
      underlyingSymbol: underlying || null,
      instrumentType: instrType || null,
      description: t.description || null,
      value: String(t.value ?? '0'),
      netValue: t['net-value'] ? String(t['net-value']) : null,
      quantity: t.quantity ? String(t.quantity) : null,
      price: t.price ? String(t.price) : null,
      commissions: t.commissions ? String(t.commissions) : null,
      fees: t.fees ? String(t.fees) : null,
      optionType,
      strikePrice,
      expiresAt,
      executedAt,
    };
  });

  // Insert with ON DUPLICATE KEY UPDATE (upsert) to avoid duplicates on re-sync
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    try {
      // No-op on duplicate: if the tastytrade_id already exists, skip silently
      await db
        .insert(cachedTransactions)
        .values(batch)
        .onDuplicateKeyUpdate({
          set: { tastytradeId: batch[0].tastytradeId },
        });
      inserted += batch.length;
    } catch (err: any) {
      // Log but don't fail the whole sync for a batch error
      console.error(`[PortfolioSync] Batch insert error:`, err.message);
    }
  }

  console.log(`[PortfolioSync] Account ${accountNumber}: Synced ${inserted} transactions (${lastTransactionDate ? 'incremental' : 'initial'})`);
  return inserted;
}

// ─── Sync State Helpers ───────────────────────────────────────────────────────

async function upsertSyncState(
  userId: number,
  accountNumber: string,
  updates: Partial<{
    syncStatus: 'idle' | 'syncing' | 'error';
    lastPositionsSyncAt: Date;
    lastTransactionsSyncAt: Date;
    lastTransactionDate: string;
    totalTransactionsCached: number;
    lastSyncError: string | null;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .insert(portfolioSyncState)
    .values({
      userId,
      accountNumber,
      syncStatus: updates.syncStatus ?? 'idle',
      lastPositionsSyncAt: updates.lastPositionsSyncAt,
      lastTransactionsSyncAt: updates.lastTransactionsSyncAt,
      lastTransactionDate: updates.lastTransactionDate,
      totalTransactionsCached: updates.totalTransactionsCached ?? 0,
      lastSyncError: updates.lastSyncError ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        ...(updates.syncStatus !== undefined && { syncStatus: updates.syncStatus }),
        ...(updates.lastPositionsSyncAt !== undefined && { lastPositionsSyncAt: updates.lastPositionsSyncAt }),
        ...(updates.lastTransactionsSyncAt !== undefined && { lastTransactionsSyncAt: updates.lastTransactionsSyncAt }),
        ...(updates.lastTransactionDate !== undefined && { lastTransactionDate: updates.lastTransactionDate }),
        ...(updates.totalTransactionsCached !== undefined && { totalTransactionsCached: updates.totalTransactionsCached }),
        ...(updates.lastSyncError !== undefined && { lastSyncError: updates.lastSyncError }),
      },
    });
}

// ─── Read Helpers (used by ai-context.ts and analytics) ──────────────────────

/**
 * Get all cached positions for a user, optionally filtered by underlying symbol.
 */
export async function getCachedPositions(
  userId: number,
  underlyingSymbol?: string
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = underlyingSymbol
    ? and(
        eq(cachedPositions.userId, userId),
        eq(cachedPositions.underlyingSymbol, underlyingSymbol.toUpperCase())
      )
    : eq(cachedPositions.userId, userId);

  return db
    .select()
    .from(cachedPositions)
    .where(conditions);
}

/**
 * Get all cached transactions for a user, optionally filtered by underlying symbol.
 * Returns most recent first.
 */
export async function getCachedTransactions(
  userId: number,
  underlyingSymbol?: string,
  limit?: number
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = underlyingSymbol
    ? and(
        eq(cachedTransactions.userId, userId),
        eq(cachedTransactions.underlyingSymbol, underlyingSymbol.toUpperCase())
      )
    : eq(cachedTransactions.userId, userId);

  const query = db
    .select()
    .from(cachedTransactions)
    .where(conditions)
    .orderBy(desc(cachedTransactions.executedAt));

  if (limit) {
    return query.limit(limit);
  }
  return query;
}

/**
 * Get sync state for all accounts of a user.
 */
export async function getPortfolioSyncState(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(portfolioSyncState)
    .where(eq(portfolioSyncState.userId, userId));
}
