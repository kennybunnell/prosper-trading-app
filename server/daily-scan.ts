/**
 * Daily Scan Service
 * Runs at 8:30 AM Eastern (12:30 UTC) each day.
 * Computes badge counts for the three key automation steps:
 *   1. Close for Profit  — positions at >= 90% of max profit
 *   2. Roll Positions    — short options with DTE <= 7
 *   3. Sell Calls        — HARVEST/MONITOR stock positions with no active covered call
 *
 * Results are stored in daily_scan_cache and served to the Home dashboard
 * via the dashboard.getDailyActionCounts tRPC procedure (fast, no API call on load).
 */

import { getDb, getApiCredentials } from './db';
import { dailyScanCache } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { authenticateTastytrade } from './tastytrade';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloseProfitItem {
  symbol: string;
  underlyingSymbol: string;
  profitPct: number;
  currentValue: number;
  openPrice: number;
  daysLeft: number;
  expiresAt: string;
}

export interface RollPositionItem {
  symbol: string;
  underlyingSymbol: string;
  dte: number;
  strike: string;
  optionType: 'call' | 'put';
  quantity: number;
  expiresAt: string;
}

export interface SellCallItem {
  symbol: string;
  shares: number;
  currentPrice: number;
  avgCostBasis: number;
  recommendation: 'HARVEST' | 'MONITOR';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDTE(expiresAt: string | undefined): number {
  if (!expiresAt) return 999;
  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function parseOptionSymbol(symbol: string): {
  underlyingSymbol: string;
  expiryDate: string;
  optionType: 'call' | 'put';
  strike: string;
} | null {
  // OCC format: AAPL  250117C00150000 (6-char padded underlying + 6-digit date + C/P + 8-digit strike)
  const match = symbol.match(/^([A-Z ]+?)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const underlying = match[1].trim();
  const dateStr = match[2];
  const year = `20${dateStr.slice(0, 2)}`;
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const expiryDate = `${year}-${month}-${day}`;
  const optionType = match[3] === 'C' ? 'call' : 'put';
  const strikeRaw = parseInt(match[4], 10);
  const strike = (strikeRaw / 1000).toFixed(2);
  return { underlyingSymbol: underlying, expiryDate, optionType, strike };
}

// ─── Scan Functions ───────────────────────────────────────────────────────────

/**
 * Close for Profit: find short option positions at >= 90% of max profit.
 * A short option opened at credit X is at 90% profit when current mark <= 0.10 * X.
 */
async function scanCloseForProfit(positions: any[]): Promise<{
  count: number;
  items: CloseProfitItem[];
}> {
  const items: CloseProfitItem[] = [];

  for (const pos of positions) {
    const instrumentType = pos['instrument-type'];
    if (instrumentType !== 'Equity Option') continue;

    const quantityDirection = pos['quantity-direction'];
    if (quantityDirection !== 'Short') continue;

    const openPrice = parseFloat(pos['average-open-price'] || '0');
    const closePrice = parseFloat(pos['close-price'] || '0');
    if (openPrice <= 0) continue;

    // For short options: profit = (openPrice - closePrice) / openPrice
    // At 90% profit: closePrice <= 0.10 * openPrice
    const profitPct = ((openPrice - closePrice) / openPrice) * 100;
    if (profitPct < 90) continue;

    const parsed = parseOptionSymbol(pos.symbol);
    const dte = parsed ? parseDTE(parsed.expiryDate) : parseDTE(pos['expires-at']);

    items.push({
      symbol: pos.symbol,
      underlyingSymbol: pos['underlying-symbol'],
      profitPct: Math.round(profitPct * 10) / 10,
      currentValue: closePrice * 100,
      openPrice: openPrice * 100,
      daysLeft: dte,
      expiresAt: parsed?.expiryDate || pos['expires-at'] || '',
    });
  }

  // Sort by profit% descending
  items.sort((a, b) => b.profitPct - a.profitPct);

  return { count: items.length, items: items.slice(0, 10) };
}

/**
 * Roll Positions: find short option positions with DTE <= 7.
 */
async function scanRollPositions(positions: any[]): Promise<{
  count: number;
  items: RollPositionItem[];
}> {
  const items: RollPositionItem[] = [];

  for (const pos of positions) {
    const instrumentType = pos['instrument-type'];
    if (instrumentType !== 'Equity Option') continue;

    const quantityDirection = pos['quantity-direction'];
    if (quantityDirection !== 'Short') continue;

    const parsed = parseOptionSymbol(pos.symbol);
    const dte = parsed ? parseDTE(parsed.expiryDate) : parseDTE(pos['expires-at']);

    if (dte > 7) continue;

    items.push({
      symbol: pos.symbol,
      underlyingSymbol: pos['underlying-symbol'],
      dte,
      strike: parsed?.strike || '?',
      optionType: parsed?.optionType || 'call',
      quantity: Math.abs(pos.quantity || 1),
      expiresAt: parsed?.expiryDate || pos['expires-at'] || '',
    });
  }

  // Sort by DTE ascending (most urgent first)
  items.sort((a, b) => a.dte - b.dte);

  return { count: items.length, items: items.slice(0, 10) };
}

/**
 * Sell Calls: find long stock positions (>= 100 shares) with no active covered call.
 * Uses WTR logic: HARVEST (WTR <= 16 wks) or MONITOR (WTR 17-52 wks) positions
 * that don't already have a short call against them.
 */
async function scanSellCalls(positions: any[]): Promise<{
  count: number;
  items: SellCallItem[];
}> {
  // Build set of underlying symbols that have an active short call
  const activeShortCallUnderlyings = new Set<string>();
  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity Option') continue;
    if (pos['quantity-direction'] !== 'Short') continue;
    const parsed = parseOptionSymbol(pos.symbol);
    if (parsed?.optionType === 'call') {
      activeShortCallUnderlyings.add(pos['underlying-symbol']);
    }
  }

  const items: SellCallItem[] = [];

  for (const pos of positions) {
    if (pos['instrument-type'] !== 'Equity') continue;
    if (pos['quantity-direction'] !== 'Long') continue;

    const quantity = pos.quantity || 0;
    if (quantity < 100) continue;

    const underlyingSymbol = pos['underlying-symbol'] || pos.symbol;

    // Skip if already has a short call
    if (activeShortCallUnderlyings.has(underlyingSymbol)) continue;

    const avgCostBasis = parseFloat(pos['average-open-price'] || '0');
    const currentPrice = parseFloat(pos['close-price'] || pos['average-daily-market-close-price'] || '0');

    if (avgCostBasis <= 0 || currentPrice <= 0) continue;

    // Determine recommendation tier using WTR heuristic
    // Without actual premium data, we use price deficit as a proxy
    const deficit = avgCostBasis - currentPrice;
    let recommendation: 'HARVEST' | 'MONITOR' | null = null;

    if (currentPrice >= avgCostBasis) {
      // KEEP — no deficit, skip for sell calls scan (they can still sell but not urgent)
      continue;
    } else if (deficit / avgCostBasis <= 0.20) {
      recommendation = 'HARVEST';
    } else if (deficit / avgCostBasis <= 0.40) {
      recommendation = 'MONITOR';
    } else {
      // LIQUIDATE — skip (handled separately via Force Exit)
      continue;
    }

    items.push({
      symbol: underlyingSymbol,
      shares: quantity,
      currentPrice,
      avgCostBasis,
      recommendation,
    });
  }

  // Sort by deficit % descending (most urgent first)
  items.sort((a, b) => {
    const defA = (a.avgCostBasis - a.currentPrice) / a.avgCostBasis;
    const defB = (b.avgCostBasis - b.currentPrice) / b.avgCostBasis;
    return defB - defA;
  });

  return { count: items.length, items: items.slice(0, 10) };
}

// ─── Main Scan Runner ─────────────────────────────────────────────────────────

export async function runDailyScan(userId: number): Promise<{
  success: boolean;
  closeProfitCount: number;
  rollPositionsCount: number;
  sellCallsCount: number;
  error?: string;
}> {
  try {
    const credentials = await getApiCredentials(userId);
    if (!credentials?.tastytradeRefreshToken && !credentials?.tastytradePassword) {
      throw new Error('Tastytrade API not configured');
    }

    const tt = await authenticateTastytrade(credentials, userId);
    if (!tt) throw new Error('Failed to authenticate with Tastytrade');

    // Get all accounts and fetch positions from each
    const accounts = await tt.getAccounts();
    const allPositions: any[] = [];

    for (const acc of accounts) {
      const accountNumber = acc.account?.['account-number'];
      if (!accountNumber) continue;
      try {
        const positions = await tt.getPositions(accountNumber);
        allPositions.push(...positions);
      } catch {
        // Skip accounts that fail
      }
    }

    // Run all three scans in parallel
    const [closeProfit, rollPositions, sellCalls] = await Promise.all([
      scanCloseForProfit(allPositions),
      scanRollPositions(allPositions),
      scanSellCalls(allPositions),
    ]);

    // Upsert into daily_scan_cache
    const dbConn = await getDb();
    if (!dbConn) throw new Error('Database connection unavailable');
    const existing = await dbConn
      .select({ id: dailyScanCache.id })
      .from(dailyScanCache)
      .where(eq(dailyScanCache.userId, userId))
      .limit(1);

    const cacheData = {
      userId,
      scannedAt: new Date(),
      closeProfitCount: closeProfit.count,
      closeProfitItems: JSON.stringify(closeProfit.items),
      rollPositionsCount: rollPositions.count,
      rollPositionsItems: JSON.stringify(rollPositions.items),
      sellCallsCount: sellCalls.count,
      sellCallsItems: JSON.stringify(sellCalls.items),
      scanSuccess: true,
      scanError: null,
    };

    if (existing.length > 0) {
      await dbConn.update(dailyScanCache).set(cacheData).where(eq(dailyScanCache.userId, userId));
    } else {
      await dbConn.insert(dailyScanCache).values(cacheData);
    }

    return {
      success: true,
      closeProfitCount: closeProfit.count,
      rollPositionsCount: rollPositions.count,
      sellCallsCount: sellCalls.count,
    };
  } catch (error: any) {
    const errorMsg = error?.message || 'Unknown error';

    // Try to update cache with error state
    try {
      const dbConn2 = await getDb();
      if (!dbConn2) throw new Error('DB unavailable');
      const existing = await dbConn2
        .select({ id: dailyScanCache.id })
        .from(dailyScanCache)
        .where(eq(dailyScanCache.userId, userId))
        .limit(1);

      const errData = {
        userId,
        scannedAt: new Date(),
        closeProfitCount: 0,
        rollPositionsCount: 0,
        sellCallsCount: 0,
        scanSuccess: false,
        scanError: errorMsg,
      };

      if (existing.length > 0) {
        await dbConn2.update(dailyScanCache).set(errData).where(eq(dailyScanCache.userId, userId));
      } else {
        await dbConn2.insert(dailyScanCache).values(errData);
      }
    } catch {
      // Ignore DB errors during error handling
    }

    return { success: false, closeProfitCount: 0, rollPositionsCount: 0, sellCallsCount: 0, error: errorMsg };
  }
}
