/**
 * Reporting.tsx
 * Replaces the old Performance page.
 * Two sections:
 *  1. Pinned Reports — 5 standard + any AI-generated pins
 *  2. Ask a Question — AI chat with inline charts/tables + pin button
 */

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Target, Award, RefreshCw,
  Pin, PinOff, Send, Sparkles, ChevronDown, ChevronUp, BarChart2,
  AlertCircle, CheckCircle2, Loader2, X
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Color palette ────────────────────────────────────────────────────────────
const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];
const GREEN = "#10b981";
const RED = "#ef4444";
const BLUE = "#3b82f6";
const AMBER = "#f59e0b";

// ─── Date range helpers ───────────────────────────────────────────────────────
type DateRange = "ytd" | "6m" | "3m" | "1m" | "all";

function getDateRange(range: DateRange): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  if (range === "all") return {};
  if (range === "ytd") return { from: `${now.getFullYear()}-01-01`, to };
  if (range === "6m") {
    const d = new Date(now); d.setMonth(d.getMonth() - 6);
    return { from: d.toISOString().split("T")[0], to };
  }
  if (range === "3m") {
    const d = new Date(now); d.setMonth(d.getMonth() - 3);
    return { from: d.toISOString().split("T")[0], to };
  }
  if (range === "1m") {
    const d = new Date(now); d.setMonth(d.getMonth() - 1);
    return { from: d.toISOString().split("T")[0], to };
  }
  return {};
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }
function fmtMonth(m: string) {
  if (!m || m === "Unknown") return m;
  const [y, mo] = m.split("-");
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "text-white" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 border border-white/10">
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Inline chart renderer (used by AI results) ───────────────────────────────
function InlineChart({ chartType, chartData, chartTitle, tableColumns }: {
  chartType: string;
  chartData: any[];
  chartTitle: string;
  tableColumns?: string[];
}) {
  if (!chartData || chartData.length === 0 || chartType === "none") return null;

  return (
    <div className="mt-4">
      {chartTitle && <p className="text-sm font-semibold text-slate-300 mb-2">{chartTitle}</p>}
      {chartType === "bar" && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
            {Object.keys(chartData[0] || {}).filter(k => k !== "name").map((key, i) => (
              <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
      {chartType === "line" && (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
            {Object.keys(chartData[0] || {}).filter(k => k !== "name").map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      {chartType === "pie" && (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
                const RADIAN = Math.PI / 180;
                const radius = innerRadius + (outerRadius - innerRadius) * 1.35;
                const x = cx + radius * Math.cos(-midAngle * RADIAN);
                const y = cy + radius * Math.sin(-midAngle * RADIAN);
                return percent > 0.04 ? (
                  <text x={x} y={y} fill="#e2e8f0" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
                    {`${name} ${(percent * 100).toFixed(0)}%`}
                  </text>
                ) : null;
              }}
            >
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
      {chartType === "table" && tableColumns && tableColumns.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/5">
                {tableColumns.map(col => (
                  <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.map((row, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                  {tableColumns.map(col => (
                    <td key={col} className="px-3 py-2 text-slate-200">{String(row[col] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Report 1: Premium Income ─────────────────────────────────────────────────
function PremiumIncomeReport({ range }: { range: DateRange }) {
  const { from, to } = getDateRange(range);
  const { data, isLoading } = trpc.reporting.premiumIncome.useQuery({ from, to });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full bg-white/10" /><Skeleton className="h-48 w-full bg-white/10" /></div>;
  if (!data) return <p className="text-slate-400 text-sm">No data available.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Credits" value={fmt$(data.totalCredits)} color="text-emerald-400" />
        <StatCard label="Total Debits" value={fmt$(data.totalDebits)} color="text-red-400" />
        <StatCard label="Net Premium" value={fmt$(data.netPremium)} color={data.netPremium >= 0 ? "text-emerald-400" : "text-red-400"} />
        <StatCard label="Total Trades" value={String(data.tradeCount)} color="text-blue-400" />
      </div>
      {data.monthlyData.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Monthly Net Premium</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.monthlyData.map(m => ({ ...m, month: fmtMonth(m.month) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} formatter={(v: any) => [fmt$(v), ""]} />
              <Bar dataKey="net" fill={GREEN} radius={[3, 3, 0, 0]} name="Net" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {data.strategyData.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">By Strategy</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data.strategyData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
                  const RADIAN = Math.PI / 180;
                  const radius = innerRadius + (outerRadius - innerRadius) * 1.5;
                  const x = cx + radius * Math.cos(-midAngle * RADIAN);
                  const y = cy + radius * Math.sin(-midAngle * RADIAN);
                  return percent > 0.04 ? (
                    <text x={x} y={y} fill="#e2e8f0" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
                      {`${name} ${(percent * 100).toFixed(0)}%`}
                    </text>
                  ) : null;
                }}
              >
                {data.strategyData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} formatter={(v: any) => [fmt$(v), ""]} />
              <Legend formatter={(value) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{value}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Report 2: Win Rate ───────────────────────────────────────────────────────
function WinRateReport({ range }: { range: DateRange }) {
  const { from, to } = getDateRange(range);
  const { data, isLoading } = trpc.reporting.winRate.useQuery({ from, to });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full bg-white/10" /><Skeleton className="h-48 w-full bg-white/10" /></div>;
  if (!data) return <p className="text-slate-400 text-sm">No data available.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Win Rate" value={fmtPct(data.winRate)} sub={`${data.wins}W / ${data.losses}L`} color={data.winRate >= 70 ? "text-emerald-400" : "text-amber-400"} />
        <StatCard label="Avg Win" value={fmt$(data.avgWin)} color="text-emerald-400" />
        <StatCard label="Avg Loss" value={fmt$(data.avgLoss)} color="text-red-400" />
        <StatCard label="Profit Factor" value={String(data.profitFactor)} sub={data.profitFactor >= 1.5 ? "Excellent" : data.profitFactor >= 1 ? "Good" : "Needs work"} color={data.profitFactor >= 1.5 ? "text-emerald-400" : data.profitFactor >= 1 ? "text-amber-400" : "text-red-400"} />
      </div>
      {data.symbolData.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">P&L by Underlying (Top 15)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.symbolData} layout="vertical" margin={{ top: 4, right: 8, left: 32, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <YAxis type="category" dataKey="symbol" tick={{ fill: "#94a3b8", fontSize: 11 }} width={44} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} formatter={(v: any) => [fmt$(v), "P&L"]} />
              <Bar dataKey="totalPnl" radius={[0, 3, 3, 0]} name="P&L">
                {data.symbolData.map((entry, i) => <Cell key={i} fill={entry.totalPnl >= 0 ? GREEN : RED} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Report 3: Capital Efficiency ─────────────────────────────────────────────
function CapitalEfficiencyReport({ range }: { range: DateRange }) {
  const { from, to } = getDateRange(range);
  const { data, isLoading } = trpc.reporting.capitalEfficiency.useQuery({ from, to });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full bg-white/10" /><Skeleton className="h-48 w-full bg-white/10" /></div>;
  if (!data) return <p className="text-slate-400 text-sm">No data available.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Premium" value={fmt$(data.totalPremium)} color="text-emerald-400" />
        <StatCard label="Total STO Trades" value={String(data.totalTrades)} color="text-blue-400" />
        <StatCard label="Avg Per Trade" value={fmt$(data.avgPerTrade)} color="text-amber-400" />
      </div>
      {data.monthlyData.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Monthly Premium Collected</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.monthlyData.map(m => ({ ...m, month: fmtMonth(m.month) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} formatter={(v: any) => [fmt$(v), ""]} />
              <Line type="monotone" dataKey="premium" stroke={BLUE} strokeWidth={2} dot={{ fill: BLUE, r: 3 }} name="Premium" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {data.concentrationData.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Trading Activity by Symbol</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.concentrationData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="symbol" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
              <Bar dataKey="count" fill={AMBER} radius={[3, 3, 0, 0]} name="Trades" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Report 4: Assignment & Recovery ─────────────────────────────────────────
function AssignmentReport({ range }: { range: DateRange }) {
  const { from, to } = getDateRange(range);
  const { data, isLoading } = trpc.reporting.assignmentTracker.useQuery({ from, to });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full bg-white/10" /><Skeleton className="h-48 w-full bg-white/10" /></div>;
  if (!data) return <p className="text-slate-400 text-sm">No data available.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Assignments" value={String(data.totalAssignments)} color="text-amber-400" />
        <StatCard label="Fully Recovered" value={String(data.fullyRecovered)} color="text-emerald-400" />
        <StatCard label="Recovery Rate" value={fmtPct(data.recoveryRate)} color={data.recoveryRate >= 70 ? "text-emerald-400" : "text-amber-400"} />
      </div>
      {data.assignmentData.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/5">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Symbol</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Assigned</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">Cost</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">Recovered</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">Recovery%</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">CC Trades</th>
              </tr>
            </thead>
            <tbody>
              {data.assignmentData.map((a, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-semibold text-slate-200">{a.symbol}</td>
                  <td className="px-3 py-2 text-slate-400">{a.assignedAt}</td>
                  <td className="px-3 py-2 text-right text-red-400">{fmt$(a.assignmentCost)}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">{fmt$(a.recoveredPremium)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-semibold ${a.recoveryPct >= 100 ? "text-emerald-400" : a.recoveryPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
                      {fmtPct(a.recoveryPct)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">{a.ccTradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.assignmentData.length === 0 && (
        <p className="text-slate-400 text-sm text-center py-6">No assignments found in this period.</p>
      )}
    </div>
  );
}

// ─── Report 5: Expiration & Close Analysis ────────────────────────────────────
function ExpirationReport({ range }: { range: DateRange }) {
  const { from, to } = getDateRange(range);
  const { data, isLoading } = trpc.reporting.expirationAnalysis.useQuery({ from, to });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full bg-white/10" /><Skeleton className="h-48 w-full bg-white/10" /></div>;
  if (!data) return <p className="text-slate-400 text-sm">No data available.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Expired Worthless" value={String(data.expiredCount)} sub={fmtPct(data.expiredPct) + " of closes"} color="text-emerald-400" />
        <StatCard label="Closed Early (BTC)" value={String(data.closedEarlyCount)} color="text-blue-400" />
        <StatCard label="Total Closes" value={String(data.total)} color="text-slate-200" />
        <StatCard label="Avg BTC Cost" value={fmt$(data.avgBtcCost)} color="text-amber-400" />
      </div>
      {data.monthlyData.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Expired vs Closed Early by Month</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.monthlyData.map(m => ({ ...m, month: fmtMonth(m.month) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
              <Bar dataKey="expired" fill={GREEN} radius={[3, 3, 0, 0]} name="Expired Worthless" stackId="a" />
              <Bar dataKey="closed" fill={BLUE} radius={[3, 3, 0, 0]} name="Closed Early" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Standard report config ───────────────────────────────────────────────────
const STANDARD_REPORTS = [
  { key: "premium_income", title: "Premium Income Summary", icon: DollarSign, color: "text-emerald-400", description: "Monthly premium collected by strategy", component: PremiumIncomeReport },
  { key: "win_rate", title: "Win Rate & Trade Quality", icon: Award, color: "text-amber-400", description: "Win/loss ratio, avg win/loss, profit factor", component: WinRateReport },
  { key: "capital_efficiency", title: "Capital Efficiency", icon: TrendingUp, color: "text-blue-400", description: "Premium per trade, activity concentration", component: CapitalEfficiencyReport },
  { key: "assignment_tracker", title: "Assignment & Recovery", icon: Target, color: "text-purple-400", description: "Assignments, recovery via covered calls", component: AssignmentReport },
  { key: "expiration_analysis", title: "Expiration & Close Analysis", icon: CheckCircle2, color: "text-cyan-400", description: "Expired worthless vs closed early", component: ExpirationReport },
];

// ─── AI Chat message type ─────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: {
    summary: string;
    chartType: string;
    chartTitle: string;
    chartData: any[];
    tableColumns?: string[];
    insight: string;
  };
}

// ─── Main Reporting page ──────────────────────────────────────────────────────
export default function Reporting() {
  const { toast } = useToast();
  const [range, setRange] = useState<DateRange>("all");
  const [expandedReport, setExpandedReport] = useState<string | null>("premium_income");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const { data: stats, refetch: refetchStats } = trpc.reporting.transactionStats.useQuery();
  const { data: pinnedList, refetch: refetchPinned } = trpc.reporting.listPinned.useQuery();
  const [isSyncing, setIsSyncing] = useState(false);
  const syncMutation = trpc.reporting.syncTransactions.useMutation({
    onSuccess: () => {
      refetchStats();
      toast({ title: "Sync complete", description: "Transaction history updated from Tastytrade." });
      setIsSyncing(false);
    },
    onError: (e) => {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
      setIsSyncing(false);
    },
  });
  const pinMutation = trpc.reporting.pinReport.useMutation({
    onSuccess: () => { refetchPinned(); toast({ title: "Report pinned", description: "Added to your pinned reports." }); },
    onError: () => toast({ title: "Error", description: "Could not pin report.", variant: "destructive" }),
  });
  const unpinMutation = trpc.reporting.unpinReport.useMutation({
    onSuccess: () => { refetchPinned(); toast({ title: "Report unpinned" }); },
  });
  const askMutation = trpc.reporting.askQuestion.useMutation();

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ranges: { label: string; value: DateRange }[] = [
    { label: "All Time", value: "all" },
    { label: "YTD", value: "ytd" },
    { label: "6 Months", value: "6m" },
    { label: "3 Months", value: "3m" },
    { label: "1 Month", value: "1m" },
  ];

  async function handleAsk() {
    const prompt = inputValue.trim();
    if (!prompt || isAsking) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: prompt };
    setMessages(prev => [...prev, userMsg]);
    setInputValue("");
    setIsAsking(true);

    try {
      const result = await askMutation.mutateAsync({ prompt });
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.summary,
        result,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I encountered an error analyzing your data. Please try again.",
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsAsking(false);
    }
  }

  function handlePinAiResult(msg: ChatMessage) {
    if (!msg.result) return;
    pinMutation.mutate({
      title: msg.content.substring(0, 60) + (msg.content.length > 60 ? "..." : ""),
      prompt: messages.find(m => m.id === String(parseInt(msg.id) - 1))?.content || msg.content,
      reportType: "ai",
    });
  }

  function isStandardPinned(key: string) {
    return pinnedList?.some(p => p.reportKey === key && p.reportType === "standard");
  }

  function toggleStandardPin(key: string, title: string) {
    const existing = pinnedList?.find(p => p.reportKey === key && p.reportType === "standard");
    if (existing) {
      unpinMutation.mutate({ id: existing.id });
    } else {
      pinMutation.mutate({ title, prompt: `Show ${title}`, reportType: "standard", reportKey: key });
    }
  }

  const [activeTab, setActiveTab] = useState<"reports" | "ask">("reports");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

          {/* ── Header ── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <BarChart2 className="w-6 h-6 text-emerald-400" />
                Reporting
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                {stats ? (
                  <>
                    {Number(stats.count).toLocaleString()} transactions ·{" "}
                    {stats.earliest ? new Date(stats.earliest).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"} →{" "}
                    {stats.latest ? new Date(stats.latest).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
                  </>
                ) : "Loading transaction data..."}
              </p>
            </div>
            {/* Sync + Date range controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setIsSyncing(true); syncMutation.mutate(); }}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-sm font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync Now"}
              </button>
            {/* Date range selector — only shown on Reports tab */}
            {activeTab === "reports" && (
              <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
                {ranges.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setRange(r.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${range === r.value ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white hover:bg-white/10"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>

          {/* ── Tabs ── */}
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "reports" | "ask")}>
            <TabsList className="bg-white/5 border border-white/10 p-1 h-auto">
              <TabsTrigger
                value="reports"
                className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-slate-400 px-5 py-2 text-sm font-medium flex items-center gap-2"
              >
                <Pin className="w-3.5 h-3.5" />
                Standard Reports
              </TabsTrigger>
              <TabsTrigger
                value="ask"
                className="data-[state=active]:bg-violet-600 data-[state=active]:text-white text-slate-400 px-5 py-2 text-sm font-medium flex items-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Ask a Question
                <Badge variant="secondary" className="bg-violet-500/20 text-violet-300 text-xs border border-violet-500/30 ml-1">AI</Badge>
              </TabsTrigger>
            </TabsList>

          {/* ── Tab 1: Standard Reports ── */}
          <TabsContent value="reports" className="mt-4">
          <div>
            <h2 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Pin className="w-4 h-4 text-emerald-400" />
              Standard Reports
              <Badge variant="secondary" className="bg-white/10 text-slate-300 text-xs">{STANDARD_REPORTS.length}</Badge>
            </h2>
            <div className="space-y-3">
              {STANDARD_REPORTS.map(report => {
                const Icon = report.icon;
                const isExpanded = expandedReport === report.key;
                const pinned = isStandardPinned(report.key);
                return (
                  <Card key={report.key} className="bg-white/5 border-white/10 hover:border-white/20 transition-colors">
                    <CardHeader className="pb-0">
                      <div className="flex items-center justify-between">
                        <button
                          className="flex items-center gap-3 flex-1 text-left"
                          onClick={() => setExpandedReport(isExpanded ? null : report.key)}
                        >
                          <div className={`p-2 rounded-lg bg-white/5 ${report.color}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <CardTitle className="text-base text-white">{report.title}</CardTitle>
                            <p className="text-xs text-slate-400 mt-0.5">{report.description}</p>
                          </div>
                          <div className="ml-auto mr-3">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                          </div>
                        </button>
                        <button
                          onClick={() => toggleStandardPin(report.key, report.title)}
                          title={pinned ? "Unpin" : "Pin to favorites"}
                          className={`p-1.5 rounded-md transition-colors ${pinned ? "text-emerald-400 hover:text-slate-400" : "text-slate-500 hover:text-emerald-400"}`}
                        >
                          {pinned ? <Pin className="w-4 h-4 fill-current" /> : <Pin className="w-4 h-4" />}
                        </button>
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="pt-4">
                        <report.component range={range} />
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
          </TabsContent>

          {/* ── Tab 2: Ask a Question ── */}
          <TabsContent value="ask" className="mt-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              Ask a Question
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-300 text-xs border border-violet-500/30">AI</Badge>
            </h2>

            {/* Suggested prompts */}
            {messages.length === 0 && (
              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  "What's my average premium collected per week this year?",
                  "Which underlying symbols have the highest win rate?",
                  "How many times have I been assigned and on which stocks?",
                  "What's my best and worst month for net premium?",
                  "Show me my trade frequency by day of week",
                  "What percentage of my options expired worthless vs were closed early?",
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => setInputValue(prompt)}
                    className="text-left px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm hover:bg-white/10 hover:border-white/20 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Chat messages */}
            {messages.length > 0 && (
              <div className="space-y-4 mb-4 max-h-[600px] overflow-y-auto pr-1">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "user" ? (
                      <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%]">
                        <p className="text-sm text-emerald-100">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%] w-full">
                        <div className="flex items-start gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-slate-200">{msg.content}</p>
                        </div>
                        {msg.result && (
                          <>
                            <InlineChart
                              chartType={msg.result.chartType}
                              chartData={msg.result.chartData}
                              chartTitle={msg.result.chartTitle}
                              tableColumns={msg.result.tableColumns}
                            />
                            {msg.result.insight && (
                              <div className="mt-3 flex items-start gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                                <AlertCircle className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-violet-300">{msg.result.insight}</p>
                              </div>
                            )}
                            <div className="mt-3 flex justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-slate-400 hover:text-emerald-400 h-7 gap-1"
                                onClick={() => handlePinAiResult(msg)}
                              >
                                <Pin className="w-3 h-3" />
                                Pin this report
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {isAsking && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                        <span className="text-sm text-slate-400">Analyzing your trading data...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <Input
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleAsk()}
                placeholder="Ask anything about your trading history..."
                className="bg-white/5 border-white/20 text-white placeholder:text-slate-500 focus:border-violet-500/50"
                disabled={isAsking}
              />
              <Button
                onClick={handleAsk}
                disabled={!inputValue.trim() || isAsking}
                className="bg-violet-600 hover:bg-violet-700 text-white px-4 flex-shrink-0"
              >
                {isAsking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              AI has access to all {stats ? Number(stats.count).toLocaleString() : "your"} transactions. Ask about trends, comparisons, or specific strategies.
            </p>
          </div>
          </TabsContent>

          </Tabs>

      </div>
    </div>
  );
}
