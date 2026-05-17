/**
 * routers-reporting.ts
 * Reporting page: 5 standard reports + pinned reports CRUD + AI query endpoint.
 *
 * Report 1 (Premium Income) uses the SAME live Tastytrade API as the Dashboard
 * to guarantee identical numbers. Falls back to DB cache if API is unavailable.
 *
 * Other reports use the DB cache (cached_transactions) which handles both formats:
 *   - API format:  "Sell to Open", "Buy to Close", "Sell to Close", "Buy to Open"
 *   - CSV format:  "SELL_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_CLOSE", "BUY_TO_OPEN"
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cachedTransactions, pinnedReports } from "../drizzle/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMoney(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
}

function normalizeAction(action: string | null | undefined): string {
  if (!action) return "";
  return action.replace(/_/g, " ").toLowerCase().trim();
}

function isSellAction(action: string | null | undefined): boolean {
  const n = normalizeAction(action);
  return n === "sell to open" || n === "sell to close";
}

function isBuyAction(action: string | null | undefined): boolean {
  const n = normalizeAction(action);
  return n === "buy to close" || n === "buy to open";
}

function isSTO(action: string | null | undefined): boolean {
  return normalizeAction(action) === "sell to open";
}

function isBTC(action: string | null | undefined): boolean {
  return normalizeAction(action) === "buy to close";
}

function inferStrategy(description: string | null | undefined, optionType: string | null | undefined): string {
  const opt = (optionType || "").toUpperCase();
  if (opt === "P") return "CSP";
  if (opt === "C") return "CC";
  const desc = (description || "").toLowerCase();
  if (desc.includes("put")) return "CSP";
  if (desc.includes("call")) return "CC";
  return "Other";
}

/**
 * Classify a group of legs that share the same executed_at timestamp.
 * Returns a strategy label for the STO net value to be attributed to.
 *
 * Rules (applied in order):
 *  1. Single STO, no BTO in group → naked: CSP (P) or CC (C)
 *  2. BTO+STO same underlying, same expiry, both P → Bull Put Spread
 *  3. BTO+STO same underlying, same expiry, both C → Bear Call Spread
 *  4. BTO+STO same underlying, same expiry, C+P mix (4 legs) → Iron Condor
 *  5. BTO+STO same underlying, both C, different expiry (long DTE >> short) → PMCC
 *  6. Multiple STO on DIFFERENT underlyings (no BTO) → treat each independently
 *  7. Anything else → Other Spread
 */
function classifySpreadGroup(legs: Array<{
  action: string;
  optionType: string;
  underlying: string;
  expiry: string;
  strikePrice: number;
  netValue: number;
}>): string {
  const stoLegs = legs.filter(l => normalizeAction(l.action) === 'sell to open');
  const btoLegs = legs.filter(l => normalizeAction(l.action) === 'buy to open');

  // Rule 6: multiple STOs on different underlyings, no BTOs → each is naked (caller handles splitting)
  if (btoLegs.length === 0) return 'NAKED_MULTI';

  // Has both BTO and STO legs — it's a spread
  const underlyings = new Set(legs.map(l => l.underlying));
  const expiries = new Set(legs.map(l => l.expiry));
  const optTypes = new Set(legs.map(l => l.optionType.toUpperCase()));

  // Rule 5: PMCC — 2 legs, both C, same underlying, different expiry
  if (legs.length === 2 && optTypes.size === 1 && optTypes.has('C') &&
      underlyings.size === 1 && expiries.size === 2) {
    // Long leg has much further expiry → PMCC
    const sortedExpiries = Array.from(expiries).sort();
    const daysGap = (new Date(sortedExpiries[1]).getTime() - new Date(sortedExpiries[0]).getTime()) / 86400000;
    if (daysGap >= 60) return 'PMCC';
    return 'Bear Call Spread';
  }

  // Same underlying, same expiry spreads
  if (underlyings.size === 1 && expiries.size === 1) {
    // Rule 4: Iron Condor — 4 legs, P+C mix
    if (legs.length >= 4 && optTypes.has('P') && optTypes.has('C')) return 'Iron Condor';
    // Rule 2: Bull Put Spread — 2 legs, both P
    if (optTypes.size === 1 && optTypes.has('P')) return 'Bull Put Spread';
    // Rule 3: Bear Call Spread — 2 legs, both C
    if (optTypes.size === 1 && optTypes.has('C')) return 'Bear Call Spread';
  }

  // Multiple underlyings with BTOs mixed in → Other Spread
  return 'Other Spread';
}

function dateRangeWhere(userId: number, from?: string, to?: string) {
  const filters: any[] = [eq(cachedTransactions.userId, userId)];
  if (from) filters.push(gte(cachedTransactions.executedAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    filters.push(lte(cachedTransactions.executedAt, toDate));
  }
  return and(...filters);
}

// ─── Report 1: Premium Income Summary ────────────────────────────────────────

async function getPremiumIncome(userId: number, from?: string, to?: string) {
  // Try live Tastytrade API first (same logic as Dashboard)
  try {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');
    const credentials = await getApiCredentials(userId);
    const hasOAuth = !!(credentials?.tastytradeRefreshToken && credentials?.tastytradeClientSecret);
    const hasPassword = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);

    if (hasOAuth || hasPassword) {
      const tt = await authenticateTastytrade(credentials!, userId);
      if (tt) {
        const accounts = await tt.getAccounts();
        const accountNumbers: string[] = accounts
          .map((acc: any) => acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber)
          .filter(Boolean);

        if (accountNumbers.length > 0) {
          const now = new Date();
          const startDateStr = from || '2025-08-01';
          const endDateStr = to || now.toISOString().split('T')[0];
          const startMs = new Date(startDateStr).getTime();
          const endMs = new Date(endDateStr + 'T23:59:59Z').getTime();

          const byMonth: Record<string, { credits: number; debits: number; net: number; trades: number }> = {};
          const byStrategy: Record<string, number> = {};
          let totalCredits = 0, totalDebits = 0, tradeCount = 0;
          // Collect all raw option trades first, then group by timestamp for spread detection
          const allTxns: Array<{
            action: string; symbol: string; netValue: number; netValueEffect: string;
            executedAt: string; monthKey: string; optType: string; underlying: string;
            expiry: string; strikePrice: number;
          }> = [];
          await Promise.all(accountNumbers.map(async (accountNumber: string) => {
            try {
              const rawTxns = await tt.getTransactionHistory(accountNumber, startDateStr, endDateStr);
              for (const txn of rawTxns) {
                if (txn['transaction-type'] !== 'Trade') continue;
                const txnSymbol: string = txn['symbol'] || '';
                const m = txnSymbol.match(/([A-Z0-9 ]+?)\s*(\d{6})([CP])(\d+)/);
                if (!m) continue;
                const netValue = Math.abs(parseFloat(txn['net-value'] || '0'));
                const netValueEffect = txn['net-value-effect'];
                const executedAt = txn['executed-at'];
                if (!executedAt || netValue === 0 || !netValueEffect) continue;
                const txnDate = new Date(executedAt);
                if (txnDate.getTime() < startMs || txnDate.getTime() > endMs) continue;
                const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
                const underlying = (txn['underlying-symbol'] || m[1].trim()).toUpperCase();
                const expiry = `20${m[2].slice(0,2)}-${m[2].slice(2,4)}-${m[2].slice(4,6)}`;
                const strikePrice = parseInt(m[4]) / 1000;
                allTxns.push({
                  action: txn['action'] || '',
                  symbol: txnSymbol, netValue, netValueEffect,
                  executedAt, monthKey, optType: m[3],
                  underlying, expiry, strikePrice,
                });
              }
            } catch (err: any) {
              console.error(`[Reporting] Live fetch failed for account ${accountNumber}:`, err.message);
            }
          }));
          // Group by executed_at second for spread detection
          const byTimestamp: Record<string, typeof allTxns> = {};
          for (const txn of allTxns) {
            const tsKey = txn.executedAt.slice(0, 19); // second-level precision
            if (!byTimestamp[tsKey]) byTimestamp[tsKey] = [];
            byTimestamp[tsKey].push(txn);
          }
          // Process each timestamp group
          for (const [, group] of Object.entries(byTimestamp)) {
            const openLegs = group.filter(t => normalizeAction(t.action) === 'sell to open' || normalizeAction(t.action) === 'buy to open');
            const stoLegs = openLegs.filter(t => normalizeAction(t.action) === 'sell to open');
            // Month/credit/debit accounting (all legs)
            for (const txn of group) {
              const { monthKey, netValue, netValueEffect } = txn;
              if (!byMonth[monthKey]) byMonth[monthKey] = { credits: 0, debits: 0, net: 0, trades: 0 };
              if (netValueEffect === 'Credit') {
                byMonth[monthKey].credits += netValue;
                byMonth[monthKey].net += netValue;
                totalCredits += netValue;
              } else if (netValueEffect === 'Debit') {
                byMonth[monthKey].debits += netValue;
                byMonth[monthKey].net -= netValue;
                totalDebits += netValue;
              }
              byMonth[monthKey].trades++;
              tradeCount++;
            }
            if (stoLegs.length === 0) continue;
            // Classify strategy for STO credit value
            const spreadLabel = classifySpreadGroup(openLegs.map(l => ({
              action: l.action, optionType: l.optType,
              underlying: l.underlying, expiry: l.expiry,
              strikePrice: l.strikePrice, netValue: l.netValue,
            })));
            if (spreadLabel === 'NAKED_MULTI') {
              // Multiple independent naked trades submitted at same second
              for (const sto of stoLegs) {
                const label = sto.optType === 'P' ? 'CSP' : sto.optType === 'C' ? 'CC' : 'Other';
                byStrategy[label] = (byStrategy[label] || 0) + sto.netValue;
              }
            } else {
              // Spread: attribute net STO credit to the spread label
              const stoCredit = stoLegs.reduce((s, l) => s + l.netValue, 0);
              byStrategy[spreadLabel] = (byStrategy[spreadLabel] || 0) + stoCredit;
            }
          }

          const monthlyData = Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, data]) => ({
              month,
              credits: Math.round(data.credits * 100) / 100,
              debits: Math.round(data.debits * 100) / 100,
              net: Math.round(data.net * 100) / 100,
              trades: data.trades,
            }));
          const strategyData = Object.entries(byStrategy)
            .filter(([, v]) => v > 0)
            .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));

          return {
            totalCredits: Math.round(totalCredits * 100) / 100,
            totalDebits: Math.round(totalDebits * 100) / 100,
            netPremium: Math.round((totalCredits - totalDebits) * 100) / 100,
            tradeCount,
            monthlyData,
            strategyData,
            source: 'live' as const,
          };
        }
      }
    }
  } catch (err: any) {
    console.warn('[Reporting] Live API unavailable, falling back to DB cache:', err.message);
  }

  // Fallback: DB cache
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const rows = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionType, "Trade")))
    .orderBy(cachedTransactions.executedAt);

  const byMonth: Record<string, { credits: number; debits: number; net: number; trades: number }> = {};
  const byStrategy: Record<string, number> = {};
  let totalCredits = 0, totalDebits = 0, tradeCount = 0;
  // Group rows by executed_at second for spread detection
  const dbByTimestamp: Record<string, typeof rows> = {};
  for (const row of rows) {
    const action = row.action || row.transactionSubType || "";
    if (!isSellAction(action) && !isBuyAction(action)) continue;
    if (parseMoney(row.netValue || row.value) === 0) continue;
    const tsKey = row.executedAt ? row.executedAt.toISOString().slice(0, 19) : 'unknown';
    if (!dbByTimestamp[tsKey]) dbByTimestamp[tsKey] = [];
    dbByTimestamp[tsKey].push(row);
  }
  for (const [, group] of Object.entries(dbByTimestamp)) {
    const openLegs = group.filter(r => isSTO(r.action || r.transactionSubType || '') || normalizeAction(r.action || r.transactionSubType || '') === 'buy to open');
    const stoLegs = openLegs.filter(r => isSTO(r.action || r.transactionSubType || ''));
    // Accounting for all legs
    for (const row of group) {
      const action = row.action || row.transactionSubType || "";
      const isSell = isSellAction(action);
      const val = parseMoney(row.netValue || row.value);
      const monthKey = row.executedAt
        ? `${row.executedAt.getFullYear()}-${String(row.executedAt.getMonth() + 1).padStart(2, "0")}`
        : "Unknown";
      if (!byMonth[monthKey]) byMonth[monthKey] = { credits: 0, debits: 0, net: 0, trades: 0 };
      if (isSell) {
        byMonth[monthKey].credits += val; byMonth[monthKey].net += val; totalCredits += val;
      } else {
        byMonth[monthKey].debits += val; byMonth[monthKey].net -= val; totalDebits += val;
      }
      byMonth[monthKey].trades++;
      tradeCount++;
    }
    if (stoLegs.length === 0) continue;
    // Classify strategy
    const spreadLabel = classifySpreadGroup(openLegs.map(r => ({
      action: r.action || r.transactionSubType || '',
      optionType: r.optionType || '',
      underlying: r.underlyingSymbol || '',
      expiry: r.expiresAt ? (typeof r.expiresAt === 'string' ? r.expiresAt : (r.expiresAt as Date).toISOString().split('T')[0]) : '',
      strikePrice: parseFloat(r.strikePrice || '0'),
      netValue: parseMoney(r.netValue || r.value),
    })));
    if (spreadLabel === 'NAKED_MULTI') {
      for (const sto of stoLegs) {
        const opt = (sto.optionType || '').toUpperCase();
        const label = opt === 'P' ? 'CSP' : opt === 'C' ? 'CC' : 'Other';
        byStrategy[label] = (byStrategy[label] || 0) + parseMoney(sto.netValue || sto.value);
      }
    } else {
      const stoCredit = stoLegs.reduce((s, r) => s + parseMoney(r.netValue || r.value), 0);
      byStrategy[spreadLabel] = (byStrategy[spreadLabel] || 0) + stoCredit;
    }
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      credits: Math.round(data.credits * 100) / 100,
      debits: Math.round(data.debits * 100) / 100,
      net: Math.round(data.net * 100) / 100,
      trades: data.trades,
    }));
  const strategyData = Object.entries(byStrategy)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));

  return {
    totalCredits: Math.round(totalCredits * 100) / 100,
    totalDebits: Math.round(totalDebits * 100) / 100,
    netPremium: Math.round((totalCredits - totalDebits) * 100) / 100,
    tradeCount,
    monthlyData,
    strategyData,
    source: 'cache' as const,
  };
}

// ─── Report 2: Win Rate & Trade Quality ──────────────────────────────────────

async function getWinRate(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const trades = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionType, "Trade")))
    .orderBy(cachedTransactions.executedAt);

  const stoList: Array<{ symbol: string; strike: string; expires: string; credit: number; executedAt: Date; matched: boolean }> = [];
  const btcList: Array<{ symbol: string; strike: string; expires: string; debit: number; executedAt: Date; used: boolean }> = [];

  for (const t of trades) {
    const action = t.action || t.transactionSubType || "";
    const val = parseMoney(t.netValue || t.value);
    if (val === 0) continue;
    const sym = t.underlyingSymbol || "Unknown";
    const strike = t.strikePrice || "";
    const expires = t.expiresAt || "";
    const dt = t.executedAt || new Date(0);
    if (isSTO(action)) stoList.push({ symbol: sym, strike, expires, credit: val, executedAt: dt, matched: false });
    else if (isBTC(action)) btcList.push({ symbol: sym, strike, expires, debit: val, executedAt: dt, used: false });
  }

  const closedTrades: Array<{ symbol: string; pnl: number; isWin: boolean }> = [];
  let wins = 0, losses = 0, totalPnl = 0;

  for (const sto of stoList) {
    const btcIdx = btcList.findIndex(
      b => !b.used && b.symbol === sto.symbol && b.strike === sto.strike && b.expires === sto.expires && b.executedAt >= sto.executedAt
    );
    if (btcIdx >= 0) {
      const btc = btcList[btcIdx];
      btc.used = true;
      sto.matched = true;
      const pnl = sto.credit - btc.debit;
      const isWin = pnl > 0;
      closedTrades.push({ symbol: sto.symbol, pnl, isWin });
      if (isWin) wins++; else losses++;
      totalPnl += pnl;
    }
  }

  const expirations = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionSubType, "Expiration")));

  for (const exp of expirations) {
    const sym = exp.underlyingSymbol || "Unknown";
    const stoIdx = stoList.findIndex(
      s => !s.matched && s.symbol === sym && s.strike === (exp.strikePrice || "") && s.expires === (exp.expiresAt || "")
    );
    if (stoIdx >= 0) {
      stoList[stoIdx].matched = true;
      const pnl = stoList[stoIdx].credit;
      closedTrades.push({ symbol: sym, pnl, isWin: true });
      wins++;
      totalPnl += pnl;
    }
  }

  const bySymbol: Record<string, { wins: number; losses: number; totalPnl: number }> = {};
  for (const t of closedTrades) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { wins: 0, losses: 0, totalPnl: 0 };
    if (t.isWin) bySymbol[t.symbol].wins++; else bySymbol[t.symbol].losses++;
    bySymbol[t.symbol].totalPnl += t.pnl;
  }
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
  const avgWin = wins > 0 ? closedTrades.filter(t => t.isWin).reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(closedTrades.filter(t => !t.isWin).reduce((s, t) => s + t.pnl, 0) / losses) : 0;
  const profitFactor = avgLoss > 0 && losses > 0
    ? Math.round((avgWin * wins) / (avgLoss * losses) * 100) / 100
    : (wins > 0 ? 99.99 : 0);
  // P&L by underlying: use direct net_value sum (credit minus debit) per underlying.
  // The STO/BTC matching approach fails for spreads where legs have different strikes.
  // Direct sum is accurate: STO credits are positive, BTO debits are negative in net_value.
  const directBySymbol: Record<string, number> = {};
  for (const t of trades) {
    const action = t.action || t.transactionSubType || "";
    const sym = t.underlyingSymbol || "Unknown";
    const val = parseMoney(t.netValue || t.value);
    if (val === 0) continue;
    if (!directBySymbol[sym]) directBySymbol[sym] = 0;
    // Credits (sells) add to P&L, debits (buys) subtract
    if (isSellAction(action)) {
      directBySymbol[sym] += val;
    } else if (isBuyAction(action)) {
      directBySymbol[sym] -= val;
    }
  }
  const symbolData = Object.entries(directBySymbol)
    .map(([symbol, totalPnl]) => ({
      symbol,
      wins: bySymbol[symbol]?.wins ?? 0,
      losses: bySymbol[symbol]?.losses ?? 0,
      winRate: bySymbol[symbol]
        ? Math.round((bySymbol[symbol].wins / (bySymbol[symbol].wins + bySymbol[symbol].losses)) * 1000) / 10
        : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
    }))
    .filter(s => s.totalPnl > 0)
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .slice(0, 15);

  return {
    winRate,
    wins,
    losses,
    totalTrades: total,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor,
    totalPnl: Math.round(totalPnl * 100) / 100,
    symbolData,
  };
}

// ─── Report 3: Capital Efficiency ────────────────────────────────────────────

async function getCapitalEfficiency(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const trades = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionType, "Trade")))
    .orderBy(cachedTransactions.executedAt);

  const byMonth: Record<string, number> = {};
  const bySymbol: Record<string, number> = {};
  let totalPremium = 0, tradeCount = 0;

  for (const t of trades) {
    const action = t.action || t.transactionSubType || "";
    if (!isSTO(action)) continue;
    const val = parseMoney(t.netValue || t.value);
    if (val === 0) continue;
    totalPremium += val;
    tradeCount++;
    if (t.executedAt) {
      const mk = `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`;
      byMonth[mk] = (byMonth[mk] || 0) + val;
    }
    const sym = t.underlyingSymbol || "Unknown";
    bySymbol[sym] = (bySymbol[sym] || 0) + 1;
  }

  const avgPerTrade = tradeCount > 0 ? totalPremium / tradeCount : 0;

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, premium]) => ({ month, premium: Math.round(premium * 100) / 100 }));

  const concentrationData = Object.entries(bySymbol)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  return {
    totalPremium: Math.round(totalPremium * 100) / 100,
    totalTrades: tradeCount,
    avgPerTrade: Math.round(avgPerTrade * 100) / 100,
    monthlyData,
    concentrationData,
  };
}

// ─── Report 4: Assignment Tracker ────────────────────────────────────────────

async function getAssignmentTracker(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const assignments = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionSubType, "Assignment")));

  const allTrades = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionType, "Trade")))
    .orderBy(cachedTransactions.executedAt);

  const assignmentData: Array<{
    symbol: string;
    assignedAt: string;
    assignmentCost: number;
    recoveredPremium: number;
    recoveryPct: number;
    ccTradeCount: number;
  }> = [];

  for (const asgn of assignments) {
    const sym = asgn.underlyingSymbol || "Unknown";
    const assignedAt = asgn.executedAt || new Date(0);
    const assignmentCost = parseMoney(asgn.value) || 0;
    const ccTrades = allTrades.filter(t => {
      const action = t.action || t.transactionSubType || "";
      return (
        t.underlyingSymbol === sym &&
        isSTO(action) &&
        (t.optionType || "").toUpperCase() === "C" &&
        (t.executedAt || new Date(0)) >= assignedAt
      );
    });
    const recoveredPremium = ccTrades.reduce((s, t) => s + parseMoney(t.netValue || t.value), 0);
    const recoveryPct = assignmentCost > 0 ? Math.round((recoveredPremium / assignmentCost) * 1000) / 10 : 0;
    assignmentData.push({
      symbol: sym,
      assignedAt: assignedAt.toISOString().split("T")[0],
      assignmentCost: Math.round(assignmentCost * 100) / 100,
      recoveredPremium: Math.round(recoveredPremium * 100) / 100,
      recoveryPct,
      ccTradeCount: ccTrades.length,
    });
  }

  const fullyRecovered = assignmentData.filter(a => a.recoveryPct >= 100).length;
  const recoveryRate = assignmentData.length > 0
    ? Math.round((fullyRecovered / assignmentData.length) * 1000) / 10
    : 0;

  return {
    totalAssignments: assignments.length,
    fullyRecovered,
    recoveryRate,
    assignmentData: assignmentData.slice(0, 20),
  };
}

// ─── Report 5: Expiration & Close Analysis ───────────────────────────────────

async function getExpirationAnalysis(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const expirations = await db
    .select()
    .from(cachedTransactions)
    .where(and(dateRangeWhere(userId, from, to), eq(cachedTransactions.transactionSubType, "Expiration")));

  const allRows = await db
    .select()
    .from(cachedTransactions)
    .where(dateRangeWhere(userId, from, to));

  const btcRows = allRows.filter(t => isBTC(t.action || t.transactionSubType || ""));
  const expiredCount = expirations.length;
  const closedEarlyCount = btcRows.length;
  const total = expiredCount + closedEarlyCount;
  const expiredPct = total > 0 ? Math.round((expiredCount / total) * 1000) / 10 : 0;

  const btcValues = btcRows.map(t => parseMoney(t.netValue || t.value)).filter(v => v > 0);
  const avgBtcCost = btcValues.length > 0 ? btcValues.reduce((a, b) => a + b, 0) / btcValues.length : 0;

  const byMonth: Record<string, { expired: number; closed: number }> = {};
  for (const e of expirations) {
    if (!e.executedAt) continue;
    const mk = `${e.executedAt.getFullYear()}-${String(e.executedAt.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[mk]) byMonth[mk] = { expired: 0, closed: 0 };
    byMonth[mk].expired++;
  }
  for (const t of btcRows) {
    if (!t.executedAt) continue;
    const mk = `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[mk]) byMonth[mk] = { expired: 0, closed: 0 };
    byMonth[mk].closed++;
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, expired: data.expired, closed: data.closed }));

  return {
    expiredCount,
    closedEarlyCount,
    total,
    expiredPct,
    avgBtcCost: Math.round(avgBtcCost * 100) / 100,
    monthlyData,
  };
}

// ─── Transaction Stats ────────────────────────────────────────────────────────

async function getTransactionStats(userId: number) {
  const db = await getDb();
  if (!db) return { count: 0, earliest: null as string | null, latest: null as string | null };
  const rows = await db.select().from(cachedTransactions).where(eq(cachedTransactions.userId, userId));
  const dates = rows.map(r => r.executedAt).filter(Boolean) as Date[];
  const minDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const maxDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  return {
    count: rows.length,
    earliest: minDate?.toISOString() || null,
    latest: maxDate?.toISOString() || null,
  };
}

// ─── AI Query ────────────────────────────────────────────────────────────────

async function runAiQuery(userId: number, prompt: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const rows = await db
    .select()
    .from(cachedTransactions)
    .where(eq(cachedTransactions.userId, userId))
    .orderBy(desc(cachedTransactions.executedAt))
    .limit(500);

  const dateRange = rows.length > 0
    ? `${rows[rows.length - 1].executedAt?.toISOString().split('T')[0]} to ${rows[0].executedAt?.toISOString().split('T')[0]}`
    : 'N/A';
  const underlyings = Array.from(new Set(rows.map(r => r.underlyingSymbol).filter(Boolean))).slice(0, 30);
  const sampleRows = rows.slice(0, 50).map(r => ({
    date: r.executedAt?.toISOString().split('T')[0],
    action: r.action || r.transactionSubType,
    symbol: r.symbol,
    underlying: r.underlyingSymbol,
    value: r.netValue || r.value,
    optionType: r.optionType,
    strike: r.strikePrice,
    expires: r.expiresAt,
  }));

  const systemPrompt = `You are a financial analyst for an options trader using the wheel strategy (CSP → assignment → CC). You have access to their Tastytrade transaction history.

DATA SUMMARY:
- Date range: ${dateRange}
- Total transactions: ${rows.length}
- Underlying symbols: ${underlyings.join(', ')}

SAMPLE RECENT TRANSACTIONS (last 50 of ${rows.length}):
${JSON.stringify(sampleRows, null, 2)}

Answer the question with specific numbers. Be concise and data-driven.
Return a JSON response with these exact fields:
{
  "summary": "2-3 sentence answer with specific numbers",
  "chartType": "bar|line|pie|table|none",
  "chartTitle": "descriptive chart title or empty string",
  "chartData": [array of objects with consistent keys],
  "xKey": "field name for x-axis or empty string",
  "yKey": "field name for y-axis or empty string",
  "nameKey": "field name for pie chart name or empty string",
  "valueKey": "field name for pie chart value or empty string",
  "tableColumns": ["col1", "col2"] or empty array,
  "insight": "1 sentence key takeaway"
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ai_query_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            chartType: { type: "string" },
            chartTitle: { type: "string" },
            chartData: { type: "array", items: { type: "object", additionalProperties: true } },
            xKey: { type: "string" },
            yKey: { type: "string" },
            nameKey: { type: "string" },
            valueKey: { type: "string" },
            tableColumns: { type: "array", items: { type: "string" } },
            insight: { type: "string" },
          },
          required: ["summary", "chartType", "chartTitle", "chartData", "xKey", "yKey", "nameKey", "valueKey", "tableColumns", "insight"],
          additionalProperties: false,
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content;
  const content: string = typeof rawContent === 'string' ? rawContent : "{}";
  try {
    return JSON.parse(content);
  } catch {
    return {
      summary: typeof content === 'string' ? content : '',
      chartType: "none",
      chartTitle: "",
      chartData: [],
      xKey: "",
      yKey: "",
      nameKey: "",
      valueKey: "",
      tableColumns: [],
      insight: "",
    };
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const reportingRouter = router({
  // Header stats
  transactionStats: protectedProcedure.query(async ({ ctx }) => {
    return getTransactionStats(ctx.user.id);
  }),

  // Report 1
  premiumIncome: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getPremiumIncome(ctx.user.id, input?.from, input?.to);
    }),

  // Report 2
  winRate: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getWinRate(ctx.user.id, input?.from, input?.to);
    }),

  // Report 3
  capitalEfficiency: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getCapitalEfficiency(ctx.user.id, input?.from, input?.to);
    }),

  // Report 4 — frontend calls this "assignmentTracker"
  assignmentTracker: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getAssignmentTracker(ctx.user.id, input?.from, input?.to);
    }),

  // Report 5
  expirationAnalysis: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getExpirationAnalysis(ctx.user.id, input?.from, input?.to);
    }),

  // AI chat — frontend calls this "askQuestion"
  askQuestion: protectedProcedure
    .input(z.object({ prompt: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return runAiQuery(ctx.user.id, input.prompt);
    }),

  // Pinned reports — frontend calls "listPinned", "pinReport", "unpinReport"
  listPinned: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(pinnedReports).where(eq(pinnedReports.userId, ctx.user.id)).orderBy(desc(pinnedReports.createdAt));
  }),

  pinReport: protectedProcedure
    .input(z.object({
      title: z.string(),
      prompt: z.string(),
      reportType: z.string().optional(),
      reportKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const reportType: 'standard' | 'ai' = input.reportType === 'standard' ? 'standard' : 'ai';
      await db.insert(pinnedReports).values({
        userId: ctx.user.id,
        title: input.title,
        prompt: input.prompt,
        reportType,
        reportKey: input.reportKey || null,
        sortOrder: 0,
        isVisible: true,
      });
      return { success: true };
    }),

  unpinReport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(pinnedReports).where(and(eq(pinnedReports.id, input.id), eq(pinnedReports.userId, ctx.user.id)));
      return { success: true };
    }),

  // Sync transactions from Tastytrade
  syncTransactions: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const { syncPortfolio } = await import('./portfolio-sync');
      await syncPortfolio(ctx.user.id);
      return { success: true, message: 'Transactions synced from Tastytrade.' };
    } catch (err: any) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message || 'Sync failed' });
    }
  }),
});
