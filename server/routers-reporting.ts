/**
 * routers-reporting.ts
 * Reporting page: 5 standard reports + pinned reports CRUD + AI query endpoint.
 * All data comes from cached_transactions (seeded from Tastytrade CSV, incrementally synced).
 *
 * NOTE: The database contains two action formats:
 *   - API format:  "Sell to Open", "Buy to Close", "Sell to Close", "Buy to Open"
 *   - CSV format:  "SELL_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_CLOSE", "BUY_TO_OPEN"
 * All queries must handle BOTH formats. Use the isSell/isBuy helpers below.
 * Values in the `value` column are ALWAYS POSITIVE — sign is determined by action type.
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cachedTransactions, pinnedReports } from "../drizzle/schema";
import { and, desc, eq, gte, lte, sql, or } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMoney(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Normalize action string to a canonical form */
function normalizeAction(action: string | null | undefined): string {
  if (!action) return "";
  return action.replace(/_/g, " ").toLowerCase().trim();
}

/** Is this a "sell" (credit) action? */
function isSellAction(action: string | null | undefined): boolean {
  const n = normalizeAction(action);
  return n === "sell to open" || n === "sell to close";
}

/** Is this a "buy" (debit) action? */
function isBuyAction(action: string | null | undefined): boolean {
  const n = normalizeAction(action);
  return n === "buy to close" || n === "buy to open";
}

/** Is this specifically a Sell to Open? */
function isSTO(action: string | null | undefined): boolean {
  return normalizeAction(action) === "sell to open";
}

/** Is this specifically a Buy to Close? */
function isBTC(action: string | null | undefined): boolean {
  return normalizeAction(action) === "buy to close";
}

/** Infer strategy from description and option type */
function inferStrategy(description: string | null | undefined, optionType: string | null | undefined): string {
  const desc = (description || "").toLowerCase();
  const opt = (optionType || "").toUpperCase();
  if (opt === "P") return "CSP";
  if (opt === "C") return "CC";
  if (desc.includes("put")) return "CSP";
  if (desc.includes("call")) return "CC";
  return "Other";
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
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  // Fetch all trade rows (both formats)
  const rows = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionType, "Trade")
      )
    )
    .orderBy(cachedTransactions.executedAt);

  const byMonth: Record<string, { credits: number; debits: number; net: number; trades: number }> = {};
  const byStrategy: Record<string, number> = { CSP: 0, CC: 0, PMCC: 0, Spreads: 0, Other: 0 };
  let totalCredits = 0;
  let totalDebits = 0;
  let tradeCount = 0;

  for (const row of rows) {
    const action = row.action || row.transactionSubType || "";
    const isSell = isSellAction(action);
    const isBuy = isBuyAction(action);
    if (!isSell && !isBuy) continue;

    const val = parseMoney(row.value);
    if (val === 0) continue;

    const monthKey = row.executedAt
      ? `${row.executedAt.getFullYear()}-${String(row.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";

    if (!byMonth[monthKey]) byMonth[monthKey] = { credits: 0, debits: 0, net: 0, trades: 0 };

    if (isSell) {
      byMonth[monthKey].credits += val;
      byMonth[monthKey].net += val;
      totalCredits += val;
    } else {
      byMonth[monthKey].debits += val;
      byMonth[monthKey].net -= val;
      totalDebits += val;
    }
    byMonth[monthKey].trades++;
    tradeCount++;

    // Strategy breakdown — only for STO
    if (isSTO(action)) {
      const strat = inferStrategy(row.description, row.optionType);
      if (strat === "CSP") byStrategy["CSP"] += val;
      else if (strat === "CC") byStrategy["CC"] += val;
      else byStrategy["Other"] += val;
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
  };
}

// ─── Report 2: Win Rate & Trade Quality ──────────────────────────────────────

async function getWinRate(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const trades = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionType, "Trade")
      )
    )
    .orderBy(cachedTransactions.executedAt);

  // Group by underlying symbol — match STO with subsequent BTC on same symbol
  // Strategy: for each STO, find the nearest BTC on the same symbol after it
  const stoList: Array<{ symbol: string; strike: string; expires: string; credit: number; executedAt: Date; matched: boolean }> = [];
  const btcList: Array<{ symbol: string; strike: string; expires: string; debit: number; executedAt: Date; used: boolean }> = [];

  for (const t of trades) {
    const action = t.action || t.transactionSubType || "";
    const val = parseMoney(t.value);
    if (val === 0) continue;
    const sym = t.underlyingSymbol || "Unknown";
    const strike = t.strikePrice || "";
    const expires = t.expiresAt || "";
    const dt = t.executedAt || new Date(0);

    if (isSTO(action)) {
      stoList.push({ symbol: sym, strike, expires, credit: val, executedAt: dt, matched: false });
    } else if (isBTC(action)) {
      btcList.push({ symbol: sym, strike, expires, debit: val, executedAt: dt, used: false });
    }
  }

  // Match STO → BTC by symbol + strike + expires (exact match preferred)
  const closedTrades: Array<{ symbol: string; pnl: number; isWin: boolean }> = [];
  let wins = 0, losses = 0, totalPnl = 0;

  for (const sto of stoList) {
    // Find matching BTC: same symbol, same strike, same expiry, after STO date
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
      if (isWin) wins++;
      else losses++;
      totalPnl += pnl;
    }
  }

  // Also count expirations as wins (full premium kept)
  const expirations = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionSubType, "Expiration")
      )
    );

  // Each expiration row = one option expired worthless = win
  for (const exp of expirations) {
    const sym = exp.underlyingSymbol || "Unknown";
    // Find the matching STO for this expiration
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
    if (t.isWin) bySymbol[t.symbol].wins++;
    else bySymbol[t.symbol].losses++;
    bySymbol[t.symbol].totalPnl += t.pnl;
  }

  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
  const avgWin = wins > 0 ? closedTrades.filter(t => t.isWin).reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(closedTrades.filter(t => !t.isWin).reduce((s, t) => s + t.pnl, 0) / losses) : 0;
  const profitFactor = avgLoss > 0 && losses > 0 ? Math.round((avgWin * wins) / (avgLoss * losses) * 100) / 100 : (wins > 0 ? 99.99 : 0);

  const symbolData = Object.entries(bySymbol)
    .map(([symbol, data]) => ({
      symbol,
      wins: data.wins,
      losses: data.losses,
      winRate: Math.round((data.wins / (data.wins + data.losses)) * 1000) / 10,
      totalPnl: Math.round(data.totalPnl * 100) / 100,
    }))
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

// ─── Report 3: Capital Efficiency ─────────────────────────────────────────────

async function getCapitalEfficiency(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const trades = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionType, "Trade")
      )
    )
    .orderBy(cachedTransactions.executedAt);

  const byMonth: Record<string, { premium: number; trades: number }> = {};
  const activityBySymbol: Record<string, number> = {};

  for (const t of trades) {
    const action = t.action || t.transactionSubType || "";
    const sym = t.underlyingSymbol || "Unknown";
    activityBySymbol[sym] = (activityBySymbol[sym] || 0) + 1;

    if (!isSTO(action)) continue;

    const val = parseMoney(t.value);
    if (val === 0) continue;

    const monthKey = t.executedAt
      ? `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";
    if (!byMonth[monthKey]) byMonth[monthKey] = { premium: 0, trades: 0 };
    byMonth[monthKey].premium += val;
    byMonth[monthKey].trades++;
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      premium: Math.round(data.premium * 100) / 100,
      trades: data.trades,
    }));

  const concentrationData = Object.entries(activityBySymbol)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  const totalPremium = monthlyData.reduce((s, m) => s + m.premium, 0);
  const totalTrades = monthlyData.reduce((s, m) => s + m.trades, 0);
  const avgPerTrade = totalTrades > 0 ? totalPremium / totalTrades : 0;

  return {
    totalPremium: Math.round(totalPremium * 100) / 100,
    totalTrades,
    avgPerTrade: Math.round(avgPerTrade * 100) / 100,
    monthlyData,
    concentrationData,
  };
}

// ─── Report 4: Assignment & Recovery ─────────────────────────────────────────

async function getAssignmentTracker(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const assignments = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        or(
          eq(cachedTransactions.transactionSubType, "Assignment"),
          eq(cachedTransactions.transactionSubType, "Cash Settled Assignment")
        )
      )
    )
    .orderBy(cachedTransactions.executedAt);

  // Get all CC (sell calls) trades for recovery calculation
  const ccTrades = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        eq(cachedTransactions.userId, userId),
        eq(cachedTransactions.transactionType, "Trade"),
        eq(cachedTransactions.optionType, "C")
      )
    )
    .orderBy(cachedTransactions.executedAt);

  const assignmentData = assignments.map(a => {
    const sym = a.underlyingSymbol || "Unknown";
    const assignDate = a.executedAt || new Date(0);
    // Find CC trades on same symbol AFTER assignment date
    const ccAfter = ccTrades.filter(t => {
      const action = t.action || t.transactionSubType || "";
      return t.underlyingSymbol === sym &&
        t.executedAt &&
        t.executedAt > assignDate &&
        isSTO(action);
    });
    const recoveredPremium = ccAfter.reduce((s, t) => s + parseMoney(t.value), 0);
    // Assignment cost = value of stock assigned (abs value)
    const assignmentCost = Math.abs(parseMoney(a.value));

    return {
      symbol: sym,
      assignedAt: a.executedAt?.toISOString().split("T")[0] || "",
      assignmentCost: Math.round(assignmentCost * 100) / 100,
      recoveredPremium: Math.round(recoveredPremium * 100) / 100,
      recoveryPct: assignmentCost > 0 ? Math.round((recoveredPremium / assignmentCost) * 1000) / 10 : 0,
      ccTradesAfter: ccAfter.length,
    };
  });

  const totalAssignments = assignments.length;
  const fullyRecovered = assignmentData.filter(a => a.recoveryPct >= 100).length;

  return {
    totalAssignments,
    fullyRecovered,
    recoveryRate: totalAssignments > 0 ? Math.round((fullyRecovered / totalAssignments) * 1000) / 10 : 0,
    assignmentData: assignmentData.slice(0, 25),
  };
}

// ─── Report 5: Expiration & Close Analysis ────────────────────────────────────

async function getExpirationAnalysis(userId: number, from?: string, to?: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const expirations = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionSubType, "Expiration")
      )
    );

  const btcTrades = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionType, "Trade"),
        or(
          eq(cachedTransactions.action, "Buy to Close"),
          eq(cachedTransactions.action, "BUY_TO_CLOSE")
        )
      )
    );

  const expiredCount = expirations.length;
  const closedEarlyCount = btcTrades.length;
  const total = expiredCount + closedEarlyCount;

  const btcCosts = btcTrades.map(t => parseMoney(t.value));
  const avgBtcCost = btcCosts.length > 0 ? btcCosts.reduce((s, v) => s + v, 0) / btcCosts.length : 0;
  const totalBtcCost = btcCosts.reduce((s, v) => s + v, 0);

  const byMonth: Record<string, { expired: number; closed: number; btcCost: number }> = {};
  for (const t of expirations) {
    const monthKey = t.executedAt
      ? `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";
    if (!byMonth[monthKey]) byMonth[monthKey] = { expired: 0, closed: 0, btcCost: 0 };
    byMonth[monthKey].expired++;
  }
  for (const t of btcTrades) {
    const monthKey = t.executedAt
      ? `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";
    if (!byMonth[monthKey]) byMonth[monthKey] = { expired: 0, closed: 0, btcCost: 0 };
    byMonth[monthKey].closed++;
    byMonth[monthKey].btcCost += parseMoney(t.value);
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      expired: data.expired,
      closed: data.closed,
      btcCost: Math.round(data.btcCost * 100) / 100,
    }));

  return {
    expiredCount,
    closedEarlyCount,
    total,
    expiredPct: total > 0 ? Math.round((expiredCount / total) * 1000) / 10 : 0,
    avgBtcCost: Math.round(avgBtcCost * 100) / 100,
    totalBtcCost: Math.round(totalBtcCost * 100) / 100,
    monthlyData,
  };
}

// ─── AI Query ────────────────────────────────────────────────────────────────

async function runAiQuery(userId: number, prompt: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(cachedTransactions)
    .where(eq(cachedTransactions.userId, userId));

  // Get a broad sample: most recent 300 trade rows
  const recentTrades = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        eq(cachedTransactions.userId, userId),
        eq(cachedTransactions.transactionType, "Trade")
      )
    )
    .orderBy(desc(cachedTransactions.executedAt))
    .limit(300);

  const dataSummary = recentTrades.map(t => ({
    date: t.executedAt?.toISOString().split("T")[0],
    action: t.action || t.transactionSubType,
    symbol: t.underlyingSymbol,
    optionType: t.optionType,
    strike: t.strikePrice,
    expires: t.expiresAt,
    value: t.value,
    net: t.netValue,
    description: t.description,
  }));

  const systemPrompt = `You are a financial data analyst assistant for a retail options trader.
The trader uses the Wheel strategy: selling Cash-Secured Puts (CSP), getting assigned stock, then selling Covered Calls (CC) until called away.
They also trade PMCC (Poor Man's Covered Calls) and SPX spreads.

You have access to their recent transaction history (last 300 trade rows shown, ${countResult?.count || 0} total transactions).
Each row has: date, action (Sell to Open / Buy to Close / Expiration / Assignment — also in SNAKE_CASE format), symbol, optionType (C/P), strike, expires, value (always positive — credits for sells, debits for buys), net (after fees), description.

When answering questions:
1. Analyze the data provided and give specific, data-driven answers with numbers.
2. Return your response as a JSON object with this structure:
{
  "summary": "2-3 sentence plain English answer",
  "chartType": "bar" | "line" | "pie" | "table" | "none",
  "chartTitle": "Chart title",
  "chartData": [],
  "tableColumns": [],
  "insight": "One key actionable insight or observation"
}

For chartData: bar/line use [{name, value}], pie uses [{name, value}], table uses [{col1, col2, ...}].
For tableColumns: list the keys to display from chartData objects.

Data: ${JSON.stringify(dataSummary)}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "report_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            chartType: { type: "string", enum: ["bar", "line", "pie", "table", "none"] },
            chartTitle: { type: "string" },
            chartData: { type: "array", items: { type: "object", additionalProperties: true } },
            tableColumns: { type: "array", items: { type: "string" } },
            insight: { type: "string" },
          },
          required: ["summary", "chartType", "chartTitle", "chartData", "tableColumns", "insight"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No AI response" });

  try {
    return JSON.parse(content) as {
      summary: string;
      chartType: string;
      chartTitle: string;
      chartData: any[];
      tableColumns: string[];
      insight: string;
    };
  } catch {
    return {
      summary: content,
      chartType: "none",
      chartTitle: "",
      chartData: [],
      tableColumns: [],
      insight: "",
    };
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const reportingRouter = router({
  // Standard reports
  premiumIncome: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }))
    .query(async ({ ctx, input }) => getPremiumIncome(ctx.user.id, input.from, input.to)),

  winRate: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }))
    .query(async ({ ctx, input }) => getWinRate(ctx.user.id, input.from, input.to)),

  capitalEfficiency: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }))
    .query(async ({ ctx, input }) => getCapitalEfficiency(ctx.user.id, input.from, input.to)),

  assignmentTracker: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }))
    .query(async ({ ctx, input }) => getAssignmentTracker(ctx.user.id, input.from, input.to)),

  expirationAnalysis: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }))
    .query(async ({ ctx, input }) => getExpirationAnalysis(ctx.user.id, input.from, input.to)),

  // AI query
  askQuestion: protectedProcedure
    .input(z.object({ prompt: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => runAiQuery(ctx.user.id, input.prompt)),

  // Pinned reports CRUD
  listPinned: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(pinnedReports)
      .where(and(eq(pinnedReports.userId, ctx.user.id), eq(pinnedReports.isVisible, true)))
      .orderBy(pinnedReports.sortOrder, pinnedReports.createdAt);
  }),

  pinReport: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      prompt: z.string().min(1),
      reportType: z.enum(["standard", "ai"]).default("ai"),
      reportKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.insert(pinnedReports).values({
        userId: ctx.user.id,
        title: input.title,
        prompt: input.prompt,
        reportType: input.reportType,
        reportKey: input.reportKey,
        sortOrder: 0,
        isVisible: true,
      });
      return { id: (result as any).insertId };
    }),

  unpinReport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db
        .delete(pinnedReports)
        .where(and(eq(pinnedReports.id, input.id), eq(pinnedReports.userId, ctx.user.id)));
      return { success: true };
    }),

  // Incremental sync: pull new transactions from Tastytrade API since last DB record
  syncTransactions: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const { syncPortfolio } = await import('./portfolio-sync');
      const result = await syncPortfolio(ctx.user.id, false);
      return { success: true, message: 'Sync complete', result };
    } catch (err: any) {
      console.error('[Reporting] syncTransactions error:', err.message);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message || 'Sync failed' });
    }
  }),

  // Transaction count for sync status display
  transactionStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const [result] = await db
      .select({
        count: sql<number>`count(*)`,
        earliest: sql<string>`MIN(executed_at)`,
        latest: sql<string>`MAX(executed_at)`,
      })
      .from(cachedTransactions)
      .where(eq(cachedTransactions.userId, ctx.user.id));
    return result;
  }),
});
