/**
 * routers-reporting.ts
 * Reporting page: 5 standard reports + pinned reports CRUD + AI query endpoint.
 * All data comes from cached_transactions (seeded from Tastytrade CSV, incrementally synced).
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cachedTransactions, pinnedReports } from "../drizzle/schema";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMoney(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
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

  const rows = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        dateRangeWhere(userId, from, to),
        eq(cachedTransactions.transactionType, "Trade"),
        inArray(cachedTransactions.transactionSubType as any, [
          "Sell to Open", "Buy to Close", "Sell to Close", "Buy to Open"
        ])
      )
    )
    .orderBy(cachedTransactions.executedAt);

  const byMonth: Record<string, { credits: number; debits: number; net: number; trades: number }> = {};
  const byStrategy: Record<string, number> = { CSP: 0, CC: 0, PMCC: 0, Spreads: 0, Other: 0 };
  let totalCredits = 0;
  let totalDebits = 0;

  for (const row of rows) {
    const val = parseMoney(row.value);
    const net = parseMoney(row.netValue);
    const monthKey = row.executedAt
      ? `${row.executedAt.getFullYear()}-${String(row.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";

    if (!byMonth[monthKey]) byMonth[monthKey] = { credits: 0, debits: 0, net: 0, trades: 0 };

    if (val > 0) {
      byMonth[monthKey].credits += val;
      totalCredits += val;
    } else {
      byMonth[monthKey].debits += Math.abs(val);
      totalDebits += Math.abs(val);
    }
    byMonth[monthKey].net += net;
    byMonth[monthKey].trades++;

    const action = row.transactionSubType || "";
    const descLower = (row.description || "").toLowerCase();
    if (action === "Sell to Open" || action === "Buy to Close") {
      if (descLower.includes("put")) byStrategy["CSP"] += val;
      else if (descLower.includes("call")) byStrategy["CC"] += val;
      else byStrategy["Other"] += val;
    }
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));

  const strategyData = Object.entries(byStrategy)
    .filter(([, v]) => Math.abs(v) > 0)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));

  return {
    totalCredits: Math.round(totalCredits * 100) / 100,
    totalDebits: Math.round(totalDebits * 100) / 100,
    netPremium: Math.round((totalCredits - totalDebits) * 100) / 100,
    tradeCount: rows.length,
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
        eq(cachedTransactions.transactionType, "Trade"),
        inArray(cachedTransactions.transactionSubType as any, ["Sell to Open", "Buy to Close"])
      )
    );

  const stoMap: Record<string, number> = {};
  for (const t of trades) {
    if (t.transactionSubType === "Sell to Open" && t.orderId) {
      stoMap[t.orderId] = parseMoney(t.netValue);
    }
  }

  const closedTrades: Array<{ symbol: string; pnl: number; isWin: boolean }> = [];
  let wins = 0, losses = 0, totalPnl = 0;

  for (const t of trades) {
    if (t.transactionSubType === "Buy to Close" && t.orderId) {
      const stoCredit = stoMap[t.orderId];
      if (stoCredit !== undefined) {
        const btcDebit = parseMoney(t.netValue);
        const pnl = stoCredit + btcDebit;
        const isWin = pnl > 0;
        closedTrades.push({ symbol: t.underlyingSymbol || "Unknown", pnl, isWin });
        if (isWin) wins++;
        else losses++;
        totalPnl += pnl;
      }
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
  const profitFactor = avgLoss > 0 ? Math.round((avgWin * wins) / (avgLoss * losses) * 100) / 100 : 0;

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
        eq(cachedTransactions.transactionType, "Trade"),
        inArray(cachedTransactions.transactionSubType as any, ["Sell to Open", "Buy to Close"])
      )
    )
    .orderBy(cachedTransactions.executedAt);

  const byMonth: Record<string, { premium: number; trades: number }> = {};
  const activityBySymbol: Record<string, number> = {};

  for (const t of trades) {
    const sym = t.underlyingSymbol || "Unknown";
    activityBySymbol[sym] = (activityBySymbol[sym] || 0) + 1;

    if (t.transactionSubType !== "Sell to Open") continue;
    const val = parseMoney(t.netValue);
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
        eq(cachedTransactions.transactionType, "Receive Deliver"),
        eq(cachedTransactions.transactionSubType, "Assignment")
      )
    )
    .orderBy(cachedTransactions.executedAt);

  const allTrades = await db
    .select()
    .from(cachedTransactions)
    .where(
      and(
        eq(cachedTransactions.userId, userId),
        eq(cachedTransactions.transactionType, "Trade"),
        eq(cachedTransactions.transactionSubType, "Sell to Open")
      )
    );

  const assignmentData = assignments.map(a => {
    const sym = a.underlyingSymbol || "Unknown";
    const ccAfter = allTrades.filter(t =>
      t.underlyingSymbol === sym &&
      t.executedAt &&
      a.executedAt &&
      t.executedAt > a.executedAt &&
      (t.description || "").toLowerCase().includes("call")
    );
    const recoveredPremium = ccAfter.reduce((s, t) => s + parseMoney(t.netValue), 0);
    const assignmentCost = Math.abs(parseMoney(a.value));

    return {
      symbol: sym,
      assignedAt: a.executedAt?.toISOString().split("T")[0] || "",
      assignmentCost: Math.round(assignmentCost * 100) / 100,
      recoveredPremium: Math.round(recoveredPremium * 100) / 100,
      recoveryPct: assignmentCost > 0 ? Math.round((recoveredPremium / assignmentCost) * 1000) / 10 : 0,
      ccTradeCount: ccAfter.length,
    };
  });

  const totalAssignments = assignments.length;
  const fullyRecovered = assignmentData.filter(a => a.recoveryPct >= 100).length;

  return {
    totalAssignments,
    fullyRecovered,
    recoveryRate: totalAssignments > 0 ? Math.round((fullyRecovered / totalAssignments) * 1000) / 10 : 0,
    assignmentData: assignmentData.slice(0, 20),
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
        eq(cachedTransactions.transactionType, "Receive Deliver"),
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
        eq(cachedTransactions.transactionSubType, "Buy to Close")
      )
    );

  const expiredCount = expirations.length;
  const closedEarlyCount = btcTrades.length;
  const total = expiredCount + closedEarlyCount;

  const btcCosts = btcTrades.map(t => Math.abs(parseMoney(t.netValue)));
  const avgBtcCost = btcCosts.length > 0 ? btcCosts.reduce((s, v) => s + v, 0) / btcCosts.length : 0;

  const byMonth: Record<string, { expired: number; closed: number }> = {};
  for (const t of expirations) {
    const monthKey = t.executedAt
      ? `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";
    if (!byMonth[monthKey]) byMonth[monthKey] = { expired: 0, closed: 0 };
    byMonth[monthKey].expired++;
  }
  for (const t of btcTrades) {
    const monthKey = t.executedAt
      ? `${t.executedAt.getFullYear()}-${String(t.executedAt.getMonth() + 1).padStart(2, "0")}`
      : "Unknown";
    if (!byMonth[monthKey]) byMonth[monthKey] = { expired: 0, closed: 0 };
    byMonth[monthKey].closed++;
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));

  return {
    expiredCount,
    closedEarlyCount,
    total,
    expiredPct: total > 0 ? Math.round((expiredCount / total) * 1000) / 10 : 0,
    avgBtcCost: Math.round(avgBtcCost * 100) / 100,
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

  const recentTrades = await db
    .select()
    .from(cachedTransactions)
    .where(eq(cachedTransactions.userId, userId))
    .orderBy(desc(cachedTransactions.executedAt))
    .limit(200);

  const dataSummary = recentTrades.map(t => ({
    date: t.executedAt?.toISOString().split("T")[0],
    action: t.transactionSubType,
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

You have access to their recent transaction history (last 200 rows shown, ${countResult?.count || 0} total transactions).
Each row has: date, action (Sell to Open / Buy to Close / Expiration / Assignment), symbol, optionType (C/P), strike, expires, value (credit/debit), net (after fees), description.

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

For chartData: bar/line use [{name, value}], pie uses [{name, value}], table uses [{col1, col2}].
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
