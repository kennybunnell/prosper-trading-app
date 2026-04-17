/**
 * GTC Close Order Automation
 *
 * After a live STO fill is confirmed, this module:
 *   1. Calculates the GTC close price at the user's profit target (75% or 50%)
 *   2. Submits a BTC limit order to Tastytrade with time-in-force = GTC
 *   3. Records the pending GTC order in the database
 *   4. Provides procedures to list, cancel, and poll GTC orders
 *
 * The GTC order is a simple BTC (Buy to Close) limit order.
 * For multi-leg strategies (IC, BPS, BCS) the close order mirrors the open legs.
 */

import { getDb } from './db';
import { gtcOrders } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GtcOrderRequest {
  userId: number;
  accountId: string;
  sourceOrderId: string;
  sourceStrategy: string; // 'iron_condor' | 'bps' | 'bcs' | 'csp' | 'cc'
  symbol: string;
  expiration: string;
  premiumCollected: number;   // per share (e.g. 3.50)
  totalPremiumCollected: number; // total (e.g. 350.00)
  profitTargetPct: 50 | 75;
  // Tastytrade API credentials
  tastytradeToken: string;
  accountNumber: string;
  // Leg details for building the close order
  legs: GtcLeg[];
}

export interface GtcLeg {
  symbol: string;          // OCC option symbol
  action: 'Buy to Close' | 'Sell to Close';
  quantity: number;
  instrumentType: 'Equity Option' | 'Index Option';
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function createGtcRecord(req: Omit<GtcOrderRequest, 'tastytradeToken' | 'accountNumber' | 'legs'>) {
  const targetClosePrice = req.premiumCollected * (1 - req.profitTargetPct / 100);
  const database = await getDb();
  if (!database) throw new Error('Database unavailable');
  const [result] = await database.insert(gtcOrders).values({
    userId: req.userId,
    accountId: req.accountId,
    sourceOrderId: req.sourceOrderId,
    sourceStrategy: req.sourceStrategy,
    symbol: req.symbol,
    expiration: req.expiration,
    premiumCollected: req.premiumCollected.toFixed(2),
    totalPremiumCollected: req.totalPremiumCollected.toFixed(2),
    profitTargetPct: req.profitTargetPct,
    targetClosePrice: targetClosePrice.toFixed(2),
    status: 'pending',
  });
  return result;
}

export async function updateGtcRecord(
  id: number,
  updates: Partial<{
    gtcOrderId: string;
    status: 'pending' | 'submitted' | 'filled' | 'cancelled' | 'failed';
    errorMessage: string;
    submittedAt: Date;
    filledAt: Date;
    cancelledAt: Date;
    // P&L fields (populated on fill)
    closeCost: string;
    totalCloseCost: string;
    realizedPnl: string;
    realizedPnlPct: string;
  }>
) {
  const database = await getDb();
  if (!database) throw new Error('Database unavailable');
  await database.update(gtcOrders).set(updates).where(eq(gtcOrders.id, id));
}

export async function getGtcOrdersForUser(userId: number, limit = 50) {
  const database = await getDb();
  if (!database) return [];
  return database
    .select()
    .from(gtcOrders)
    .where(eq(gtcOrders.userId, userId))
    .orderBy(desc(gtcOrders.createdAt))
    .limit(limit);
}

export async function getActiveGtcOrders(userId: number) {
  const database = await getDb();
  if (!database) return [];
  return database
    .select()
    .from(gtcOrders)
    .where(and(eq(gtcOrders.userId, userId), eq(gtcOrders.status, 'submitted')))
    .orderBy(desc(gtcOrders.createdAt));
}

// ─── Tastytrade GTC submission ────────────────────────────────────────────────

interface TastytradeOrderLeg {
  'instrument-type': string;
  symbol: string;
  quantity: number;
  action: string;
}

interface TastytradeOrderPayload {
  'order-type': string;
  'time-in-force': string;
  price: string;
  'price-effect': string;
  legs: TastytradeOrderLeg[];
}

/**
 * Determine the correct price-effect for a multi-leg GTC close order.
 *
 * Tastytrade [6063] Vertical DebitCredit Check rules:
 *   Bull Put Spread (BPS) close — BTC lower-strike put + STC higher-strike put:
 *     The higher-strike long put is worth MORE → net cash flow is a CREDIT.
 *   Bear Call Spread (BCS) close — BTC lower-strike call + STC higher-strike call:
 *     The lower-strike short call costs MORE to buy back → net cash flow is a DEBIT.
 *   Iron Condor close — has both a BPS leg pair and a BCS leg pair:
 *     When closing the full IC as a 4-leg order the net is always a DEBIT
 *     (the BCS debit dominates because the short call is more expensive).
 *     When closing individual spread legs separately, use the per-spread rule above.
 *
 * Detection heuristic: if ANY leg has action 'Sell to Close' (i.e. selling back a
 * long put at a higher strike than the short), the net is a Credit (BPS close).
 * If all legs are 'Buy to Close', the net is a Debit (BCS close or single-leg BTC).
 */
function determinePriceEffect(legs: GtcLeg[]): 'Credit' | 'Debit' {
  const hasSellToClose = legs.some(l => l.action === 'Sell to Close');
  const hasBuyToClose  = legs.some(l => l.action === 'Buy to Close');

  if (hasSellToClose && hasBuyToClose) {
    // Mixed legs — determine by which leg has the higher strike.
    // BPS: long put (higher strike) is Sell to Close → Credit.
    // BCS: long call (higher strike) is Sell to Close → but BCS net is Debit.
    // We distinguish by option type embedded in the OCC symbol (C vs P at position 13).
    const sellLegs = legs.filter(l => l.action === 'Sell to Close');
    const isPutClose = sellLegs.some(l => {
      // OCC symbol: TICKER(6) + YYMMDD(6) + C/P(1) + STRIKE(8)
      const optType = l.symbol.charAt(12);
      return optType === 'P';
    });
    // Selling back a long PUT at a higher strike = BPS close = Credit
    return isPutClose ? 'Credit' : 'Debit';
  }

  // All Buy to Close = pure debit (BCS close or single-leg BTC)
  return 'Debit';
}

export async function submitGtcCloseOrder(
  token: string,
  accountNumber: string,
  legs: GtcLeg[],
  limitPrice: number,
  _isCreditClose: boolean // kept for API compatibility; direction is now auto-detected from legs
): Promise<{ orderId: string; status: string }> {
  const priceEffect = determinePriceEffect(legs);
  const payload: TastytradeOrderPayload = {
    'order-type': 'Limit',
    'time-in-force': 'GTC',
    price: limitPrice.toFixed(2),
    'price-effect': priceEffect, // Dynamically determined from leg actions and option types
    legs: legs.map(leg => ({
      'instrument-type': leg.instrumentType,
      symbol: leg.symbol,
      quantity: leg.quantity,
      action: leg.action,
    })),
  };

  const baseUrl = process.env.TASTYTRADE_API_URL || 'https://api.tastytrade.com';
  const response = await fetch(`${baseUrl}/accounts/${accountNumber}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GTC order submission failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const order = data?.data?.order;
  return {
    orderId: String(order?.id || ''),
    status: order?.status || 'Unknown',
  };
}

/**
 * Cancel a GTC order on Tastytrade and mark it cancelled in the DB.
 */
export async function cancelGtcOrder(
  token: string,
  accountNumber: string,
  tastyOrderId: string
): Promise<void> {
  const baseUrl = process.env.TASTYTRADE_API_URL || 'https://api.tastytrade.com';
  const response = await fetch(`${baseUrl}/accounts/${accountNumber}/orders/${tastyOrderId}`, {
    method: 'DELETE',
    headers: { 'Authorization': token },
  });
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`GTC cancel failed (${response.status}): ${errorText}`);
  }
}

/**
 * Poll a GTC order status from Tastytrade.
 */
export async function pollGtcOrderStatus(
  token: string,
  accountNumber: string,
  tastyOrderId: string
): Promise<{ status: string; filledAt?: string; fillPrice?: number }> {
  const baseUrl = process.env.TASTYTRADE_API_URL || 'https://api.tastytrade.com';
  const response = await fetch(`${baseUrl}/accounts/${accountNumber}/orders/${tastyOrderId}`, {
    headers: { 'Authorization': token },
  });
  if (!response.ok) {
    throw new Error(`GTC poll failed (${response.status})`);
  }
  const data = await response.json();
  const order = data?.data?.order;
  // Extract fill price from the first leg's average open price (if filled)
  const legs = order?.legs || [];
  const fillPrice: number | undefined = legs.length > 0
    ? parseFloat(legs[0]?.['fills']?.[0]?.['fill-price'] || '0') || undefined
    : undefined;
  return {
    status: order?.status || 'Unknown',
    filledAt: order?.['updated-at'],
    fillPrice, // per-share fill price of the close order
  };
}
