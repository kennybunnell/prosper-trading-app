import React, { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon,
  Moon, Sun, Zap, Layers, Activity, Timer, Inbox, ShieldAlert,
  LayoutDashboard, TrendingDown, LineChart, AlertTriangle, ChevronRight,
  Newspaper, ClipboardList, ListOrdered, BellRing, Briefcase, Target,
  ArrowUpRight, RefreshCw, CheckCircle2, Clock, Bot, TrendingDown as ProfitIcon,
  RotateCcw, PhoneCall, Scan, Play, Sparkles
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { MonthlyPremiumChart } from "@/components/MonthlyPremiumChart";
import { MarketNewsScanner } from "@/components/MarketNewsScanner";
import { GapAdvisorModal } from "@/components/GapAdvisorModal";

// ─── Monthly Premium Chart Section ───────────────────────────────────────────

function MonthlyPremiumChartSection() {
  const [selectedYear, setSelectedYear] = useState<number | undefined>(new Date().getFullYear());
  const { data, isLoading, error } = trpc.dashboard.getMonthlyPremiumData.useQuery(
    selectedYear ? { year: selectedYear } : undefined,
    { retry: false, refetchOnWindowFocus: false }
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !data || data.error || data.monthlyData.length === 0) {
    return (
      <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm p-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Monthly Premium Earnings — All Accounts</h2>
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <div className="text-center space-y-2">
            <DollarSign className="w-10 h-10 mx-auto opacity-30" />
            <p className="text-base">{data?.error ? "Configure Tastytrade credentials in Settings to view earnings" : "No trading activity found for the selected period"}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-green-500/10 text-green-400">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Monthly Premium Earnings</h2>
            <p className="text-xs text-muted-foreground">All Accounts — Income Overview</p>
          </div>
        </div>
        <select
          value={selectedYear || 'all'}
          onChange={(e) => setSelectedYear(e.target.value === 'all' ? undefined : Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg border border-border/50 bg-background/60 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-green-500/50"
        >
          <option value="all">Last 6 Months</option>
          <option value="2026">2026</option>
          <option value="2025">2025</option>
        </select>
      </div>
      <MonthlyPremiumChart data={data.monthlyData} />
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, accent = "text-muted-foreground" }: { icon: React.ElementType; label: string; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className={`w-4 h-4 ${accent}`} />
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex-1 h-px bg-border/30 ml-1" />
    </div>
  );
}

// ─── Rich Navigation Card ─────────────────────────────────────────────────────

interface RichCardProps {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  gradient: string;
  iconBg: string;
  iconColor: string;
  badges?: { label: string; variant?: "default" | "destructive" | "secondary" | "outline"; color?: string; href?: string }[];
  metric?: { value: string | number; label: string; color?: string };
}

function RichCard({ title, description, href, icon: Icon, gradient, iconBg, iconColor, badges, metric }: RichCardProps) {
  const [, navigate] = useLocation();
  return (
    <div
      onClick={() => navigate(href)}
      className={`group relative overflow-hidden cursor-pointer rounded-2xl border border-border/30 ${gradient} hover:border-border/60 transition-all duration-300 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1 h-full`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />
      <div className="relative p-5 flex flex-col gap-3 h-full">
        <div className="flex items-start justify-between gap-2">
          <div className={`p-2.5 rounded-xl ${iconBg} shrink-0`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end">
              {badges.map((b, i) => (
                <Badge
                  key={i}
                  variant={b.variant ?? "default"}
                  className={`text-xs font-bold shrink-0 ${b.color ?? ''} ${b.href ? 'cursor-pointer hover:opacity-80' : ''}`}
                  onClick={b.href ? (e) => { e.stopPropagation(); navigate(b.href!); } : undefined}
                >
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-foreground text-sm leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        </div>
        <div className="flex items-center justify-between">
          {metric ? (
            <div>
              <span className={`text-lg font-bold ${metric.color ?? 'text-foreground'}`}>{metric.value}</span>
              <span className="text-xs text-muted-foreground ml-1.5">{metric.label}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Open</span>
          )}
          <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
        </div>
      </div>
    </div>
  );
}

// ─── Daily Actions Sub-Card (simple link) ─────────────────────────────────────

interface DailySubCardProps {
  title: string;
  href: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  badge?: number | null;
  badgeLabel?: string;
  badgeColor?: string;
  status?: string;
}

function DailySubCard({ title, href, icon: Icon, iconColor, iconBg, badge, badgeLabel, badgeColor, status }: DailySubCardProps) {
  const [, navigate] = useLocation();
  return (
    <div
      onClick={() => navigate(href)}
      className="group cursor-pointer rounded-xl border border-border/30 bg-card/50 hover:bg-card/80 hover:border-border/60 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 p-4 flex items-center gap-3"
    >
      <div className={`p-2 rounded-lg ${iconBg} shrink-0`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{title}</p>
        {status && <p className="text-xs text-muted-foreground truncate">{status}</p>}
      </div>
      {badge !== null && badge !== undefined && badge > 0 && (
        <Badge className={`text-xs font-bold shrink-0 ${badgeColor ?? ''}`}>
          {badge} {badgeLabel}
        </Badge>
      )}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </div>
  );
}

// ─── Automation Step Card (with badge + mini-preview + Scan Now) ──────────────

interface StepCardItem {
  label: string;
  sub?: string;
}

interface AutoStepCardProps {
  title: string;
  href: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  gradient: string;
  count: number | null;
  countLabel: string;
  countColor: string;
  items: StepCardItem[];
  isScanning: boolean;
  onScanNow: () => void;
  lastScanned?: Date | null;
}

function AutoStepCard({
  title, href, icon: Icon, iconColor, iconBg, gradient,
  count, countLabel, countColor,
  items, isScanning, onScanNow, lastScanned
}: AutoStepCardProps) {
  const [, navigate] = useLocation();

  const scannedLabel = lastScanned
    ? `Scanned ${new Date(lastScanned).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Not yet scanned today';

  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-border/30 ${gradient} transition-all duration-300 hover:border-border/60 hover:shadow-xl hover:shadow-black/20`}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
      <div className="relative p-5 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${iconBg} shrink-0`}>
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-sm leading-tight">{title}</h3>
              <p className="text-xs text-muted-foreground">{scannedLabel}</p>
            </div>
          </div>
          {/* Count badge */}
          {count !== null && count > 0 && (
            <Badge className={`text-sm font-bold shrink-0 px-2.5 py-0.5 ${countColor}`}>
              {count} {countLabel}
            </Badge>
          )}
          {count === 0 && (
            <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">
              All clear
            </Badge>
          )}
          {count === null && (
            <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">
              —
            </Badge>
          )}
        </div>

        {/* Mini preview list */}
        {items.length > 0 && (
          <div className="space-y-1 border-t border-border/20 pt-2">
            {items.slice(0, 3).map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{item.label}</span>
                {item.sub && <span className="text-muted-foreground">{item.sub}</span>}
              </div>
            ))}
            {items.length > 3 && (
              <p className="text-xs text-muted-foreground">+{items.length - 3} more…</p>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs border-border/40 hover:bg-card/80"
            onClick={() => navigate(href)}
          >
            <ArrowUpRight className="w-3 h-3 mr-1" />
            Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-border/40 hover:bg-card/80"
            onClick={(e) => { e.stopPropagation(); onScanNow(); }}
            disabled={isScanning}
          >
            {isScanning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Monthly Income Tracker ─────────────────────────────────────────────────────

function MonthlyIncomeTracker() {
  const { data: monthlyData, refetch: refetchMonthly } = trpc.userPreferences.getMonthlyCollected.useQuery(undefined, {
    refetchInterval: 10 * 60_000,
    retry: false,
  });
  const setMonthlyTarget = trpc.userPreferences.setMonthlyTarget.useMutation({
    onSuccess: () => refetchMonthly(),
  });
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [advisorOpen, setAdvisorOpen] = useState(false);

  return (
    <div>
      <SectionHeader icon={Target} label="Monthly Income Target" accent="text-emerald-400" />
      <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-emerald-950/40 via-card/80 to-card/40 backdrop-blur-sm p-5">
        {monthlyData ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/15">
                  <Target className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    <span className="text-emerald-400 text-xl font-bold">${monthlyData.collected.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    <span className="text-muted-foreground text-sm font-normal ml-2">collected this month</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ${monthlyData.remaining.toLocaleString('en-US', { maximumFractionDigits: 0 })} remaining · {monthlyData.pct.toFixed(1)}% of target
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Gap Advisor AI button */}
                {!editingTarget && (
                  <button
                    onClick={() => setAdvisorOpen(true)}
                    title="Gap Advisor — AI recommendations to close your income gap"
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors border border-emerald-500/30 hover:border-emerald-400/50 rounded-lg px-2.5 py-1.5 bg-emerald-500/5 hover:bg-emerald-500/10"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Ask AI
                  </button>
                )}
                {editingTarget ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const val = parseInt(targetInput.replace(/[^0-9]/g, ''));
                      if (val >= 1000) {
                        setMonthlyTarget.mutate({ target: val });
                        setEditingTarget(false);
                      }
                    }}
                  >
                    <input
                      autoFocus
                      type="text"
                      value={targetInput}
                      onChange={(e) => setTargetInput(e.target.value)}
                      placeholder="e.g. 150000"
                      className="w-32 px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-background/60 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                    />
                    <Button size="sm" type="submit" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white" disabled={setMonthlyTarget.isPending}>
                      {setMonthlyTarget.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                    </Button>
                    <Button size="sm" variant="outline" type="button" className="h-7 text-xs" onClick={() => setEditingTarget(false)}>Cancel</Button>
                  </form>
                ) : (
                  <button
                    onClick={() => { setTargetInput(String(monthlyData.target)); setEditingTarget(true); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/40 rounded-lg px-2.5 py-1.5 hover:border-border/70"
                  >
                    Target: ${monthlyData.target.toLocaleString()} ✎
                  </button>
                )}
              </div>
            </div>
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="w-full h-3 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    monthlyData.pct >= 100
                      ? 'bg-gradient-to-r from-emerald-400 to-green-300 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                      : monthlyData.pct >= 80
                      ? 'bg-gradient-to-r from-yellow-500 to-amber-400 shadow-[0_0_8px_rgba(234,179,8,0.4)]'
                      : 'bg-gradient-to-r from-red-600 to-red-400'
                  }`}
                  style={{ width: `${Math.min(100, monthlyData.pct)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>$0</span>
                <span className={monthlyData.pct >= 100 ? 'text-emerald-400 font-semibold' : ''}>
                  {monthlyData.pct >= 100 ? '🎯 Target reached!' : `$${(monthlyData.target / 2).toLocaleString()} midpoint`}
                </span>
                <span>${monthlyData.target.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-2">
            <div className="p-2.5 rounded-xl bg-emerald-500/15">
              <Target className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Monthly Income Target</p>
              <p className="text-xs text-muted-foreground">Configure Tastytrade credentials to track premium collected</p>
            </div>
          </div>
        )}
      </div>
      {/* Gap Advisor Modal */}
      <GapAdvisorModal
        open={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        gap={monthlyData?.remaining ?? 0}
        target={monthlyData?.target ?? 150000}
        collected={monthlyData?.collected ?? 0}
      />
    </div>
  );
}

// ─── Main Navigation Grid ─────────────────────────────────────────────────────

function NavigationGrid() {
  const utils = trpc.useUtils();

  const { data: badges, isLoading: badgesLoading } = trpc.dashboard.getActionBadges.useQuery(undefined, {
    refetchInterval: 90_000,
    retry: false,
  });
  const { data: unread } = trpc.inbox.getUnreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: dailyCounts, isLoading: dailyLoading } = trpc.dashboard.getDailyActionCounts.useQuery(undefined, {
    refetchInterval: 5 * 60_000, // refresh every 5 min
    retry: false,
  });

  const [isScanning, setIsScanning] = useState(false);
  const triggerScan = trpc.dashboard.triggerDailyScan.useMutation({
    onSuccess: () => {
      utils.dashboard.getDailyActionCounts.invalidate();
    },
  });

  const handleScanNow = async () => {
    setIsScanning(true);
    try {
      await triggerScan.mutateAsync();
    } finally {
      setIsScanning(false);
    }
  };

  const dogs = badges?.liquidationFlags ?? 0;
  const gtcPending = badges?.gtcPending ?? 0;
  const workingOrders = badges?.workingOrdersCount ?? null;
  const openPositions = badges?.openPositionsCount ?? null;
  const inboxUnread = unread?.count ?? 0;

  // Daily scan data
  const closeProfitCount = dailyCounts?.closeProfitCount ?? null;
  const rollPositionsCount = dailyCounts?.rollPositionsCount ?? null;
  const sellCallsCount = dailyCounts?.sellCallsCount ?? null;
  const scannedAt = dailyCounts?.scannedAt ?? null;

  // Build mini-preview items for each step card
  const closeProfitItems: StepCardItem[] = (dailyCounts?.closeProfitItems ?? []).map((item: any) => ({
    label: item.underlyingSymbol || item.symbol,
    sub: `${item.profitPct?.toFixed(0)}% profit · ${item.daysLeft}d left`,
  }));

  const rollPositionsItems: StepCardItem[] = (dailyCounts?.rollPositionsItems ?? []).map((item: any) => ({
    label: item.underlyingSymbol || item.symbol,
    sub: `${item.dte}d DTE · $${item.strike} ${item.optionType}`,
  }));

  const sellCallsItems: StepCardItem[] = (dailyCounts?.sellCallsItems ?? []).map((item: any) => ({
    label: item.symbol,
    sub: `${item.shares} shares · ${item.recommendation}`,
  }));

  // Working orders / open positions status text
  const workingOrdersStatus = badgesLoading
    ? "Loading..."
    : workingOrders === null
    ? "—"
    : undefined;

  const openPositionsStatus = badgesLoading
    ? "Loading..."
    : openPositions === null
    ? "—"
    : undefined;

  return (
    <div className="space-y-10">

      {/* ── PORTFOLIO ─────────────────────────────────────────────────────── */}
      <div>
        <SectionHeader icon={Briefcase} label="Portfolio" accent="text-cyan-400" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <RichCard
            title="Portfolio Command Center"
            description="Heat map, open positions, working orders, risk monitor, position analyzer, and portfolio advisor."
            href="/portfolio?tab=position-analyzer"
            icon={LayoutDashboard}
            gradient="bg-gradient-to-br from-cyan-950/60 via-card/80 to-card/40"
            iconBg="bg-cyan-500/15"
            iconColor="text-cyan-400"
            badges={dogs > 0 ? [{ label: `${dogs} ${dogs === 1 ? 'dog' : 'dogs'}`, variant: "destructive", href: '/portfolio?tab=analyzer' }] : undefined}
            metric={openPositions !== null ? { value: openPositions, label: "open positions", color: "text-cyan-400" } : undefined}
          />
        </div>
      </div>

      {/* ── DAILY ACTIONS ─────────────────────────────────────────────────── */}
      <div>
        <SectionHeader icon={Zap} label="Daily Actions" accent="text-amber-400" />

        {/* Top row: three automation step cards with scan badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
          <AutoStepCard
            title="Close for Profit"
            href="/automation?tab=automation"
            icon={CheckCircle2}
            iconColor="text-emerald-400"
            iconBg="bg-emerald-500/15"
            gradient="bg-gradient-to-br from-emerald-950/50 via-card/80 to-card/40"
            count={closeProfitCount}
            countLabel="ready"
            countColor="bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
            items={closeProfitItems}
            isScanning={isScanning}
            onScanNow={handleScanNow}
            lastScanned={scannedAt}
          />
          <AutoStepCard
            title="Roll Positions"
            href="/automation?tab=automation"
            icon={RotateCcw}
            iconColor="text-orange-400"
            iconBg="bg-orange-500/15"
            gradient="bg-gradient-to-br from-orange-950/50 via-card/80 to-card/40"
            count={rollPositionsCount}
            countLabel="expiring"
            countColor="bg-orange-500/20 text-orange-300 border-orange-500/30"
            items={rollPositionsItems}
            isScanning={isScanning}
            onScanNow={handleScanNow}
            lastScanned={scannedAt}
          />
          <AutoStepCard
            title="Sell Calls"
            href="/automation?tab=automation"
            icon={PhoneCall}
            iconColor="text-blue-400"
            iconBg="bg-blue-500/15"
            gradient="bg-gradient-to-br from-blue-950/50 via-card/80 to-card/40"
            count={sellCallsCount}
            countLabel="eligible"
            countColor="bg-blue-500/20 text-blue-300 border-blue-500/30"
            items={sellCallsItems}
            isScanning={isScanning}
            onScanNow={handleScanNow}
            lastScanned={scannedAt}
          />
        </div>

        {/* Bottom row: quick-access links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DailySubCard
            title="Working Orders"
            href="/automation?tab=working-orders"
            icon={ClipboardList}
            iconColor="text-blue-400"
            iconBg="bg-blue-500/15"
            badge={workingOrders}
            badgeLabel="active"
            badgeColor="bg-blue-500/20 text-blue-300 border-blue-500/30"
            status={workingOrdersStatus}
          />
          <DailySubCard
            title="Open Positions"
            href="/automation?tab=open-positions"
            icon={ListOrdered}
            iconColor="text-green-400"
            iconBg="bg-green-500/15"
            badge={openPositions}
            badgeLabel="positions"
            badgeColor="bg-green-500/20 text-green-300 border-green-500/30"
            status={openPositionsStatus}
          />
          <DailySubCard
            title="Auto-Close Orders"
            href="/automation?tab=auto-close"
            icon={Timer}
            iconColor="text-purple-400"
            iconBg="bg-purple-500/15"
            badge={gtcPending > 0 ? gtcPending : undefined}
            badgeLabel="pending"
            badgeColor="bg-purple-500/20 text-purple-300 border-purple-500/30"
            status="GTC close orders"
          />
          <DailySubCard
            title="Inbox"
            href="/automation?tab=inbox"
            icon={Inbox}
            iconColor="text-indigo-400"
            iconBg="bg-indigo-500/15"
            badge={inboxUnread > 0 ? inboxUnread : undefined}
            badgeLabel="unread"
            badgeColor="bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
            status="Alerts & messages"
          />
        </div>
      </div>

      {/* ── TRADING STRATEGIES ────────────────────────────────────────────── */}
      <div>
        <SectionHeader icon={TrendingUp} label="Trading Strategies" accent="text-green-400" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <RichCard
            title="Covered Calls"
            description="Scan eligible stock positions, review recommendations, and submit CC orders with intelligent scoring."
            href="/cc"
            icon={TrendingUp}
            gradient="bg-gradient-to-br from-green-950/60 via-card/80 to-card/40"
            iconBg="bg-green-500/15"
            iconColor="text-green-400"
          />
          <RichCard
            title="Cash-Secured Puts"
            description="Find high-scoring CSP opportunities across your watchlist with delta and risk scoring."
            href="/csp"
            icon={TrendingDown}
            gradient="bg-gradient-to-br from-purple-950/60 via-card/80 to-card/40"
            iconBg="bg-purple-500/15"
            iconColor="text-purple-400"
          />
          <RichCard
            title="Spreads / Condors"
            description="Iron condor and vertical spread scanner with defined-risk recommendations and SPX support."
            href="/iron-condor"
            icon={Layers}
            gradient="bg-gradient-to-br from-pink-950/60 via-card/80 to-card/40"
            iconBg="bg-pink-500/15"
            iconColor="text-pink-400"
          />
          <RichCard
            title="PMCC Dashboard"
            description="Poor Man's Covered Call management — track LEAPS, short call legs, and roll timing."
            href="/pmcc"
            icon={Activity}
            gradient="bg-gradient-to-br from-indigo-950/60 via-card/80 to-card/40"
            iconBg="bg-indigo-500/15"
            iconColor="text-indigo-400"
          />
        </div>
      </div>

      {/* ── ANALYSIS & TOOLS ──────────────────────────────────────────────── */}
      <div>
        <SectionHeader icon={BarChart3} label="Analysis & Tools" accent="text-yellow-400" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <RichCard
            title="Spread Advisor"
            description="AI-powered spread strategy advisor with entry/exit recommendations and market context."
            href="/strategy-advisor"
            icon={LineChart}
            gradient="bg-gradient-to-br from-yellow-950/60 via-card/80 to-card/40"
            iconBg="bg-yellow-500/15"
            iconColor="text-yellow-400"
          />
          <RichCard
            title="Performance & History"
            description="Lookback analytics, P&L history, income projections, and trade performance breakdown."
            href="/performance"
            icon={BarChart3}
            gradient="bg-gradient-to-br from-teal-950/60 via-card/80 to-card/40"
            iconBg="bg-teal-500/15"
            iconColor="text-teal-400"
          />
        </div>
      </div>

    </div>
  );
}

// ─── Main Home Component ──────────────────────────────────────────────────────

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const { data: backgroundPrefs } = trpc.settings.getBackgroundPreferences.useQuery();
  const backgroundOpacity = backgroundPrefs?.opacity ?? 8;
  const backgroundPattern = backgroundPrefs?.pattern ?? 'diagonal';

  const getPatternCSS = (pattern: string) => {
    switch (pattern) {
      case 'diagonal':
        return `repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,0.03) 10px,rgba(255,255,255,0.03) 20px)`;
      case 'crosshatch':
        return `repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,0.03) 10px,rgba(255,255,255,0.03) 20px),repeating-linear-gradient(-45deg,transparent,transparent 10px,rgba(255,255,255,0.03) 10px,rgba(255,255,255,0.03) 20px)`;
      case 'dots':
        return `radial-gradient(circle,rgba(255,255,255,0.05) 1px,transparent 1px)`;
      case 'woven':
        return `repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.02) 2px,rgba(255,255,255,0.02) 4px),repeating-linear-gradient(90deg,transparent,transparent 2px,rgba(255,255,255,0.02) 2px,rgba(255,255,255,0.02) 4px)`;
      default:
        return 'none';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-2xl border border-border/40 bg-gradient-to-br from-card/90 to-card/60 backdrop-blur-sm p-10 space-y-8 text-center shadow-2xl">
          <div className="space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center mx-auto">
              <TrendingUp className="w-8 h-8 text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold">Prosper Trading</h1>
            <p className="text-muted-foreground text-base">
              Professional options trading dashboard with intelligent scoring and automated execution
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-left">
            {[
              { icon: TrendingUp, label: "Covered Calls", color: "text-green-400" },
              { icon: TrendingDown, label: "Cash-Secured Puts", color: "text-purple-400" },
              { icon: Layers, label: "Spreads / Condors", color: "text-pink-400" },
              { icon: Activity, label: "PMCC Strategy", color: "text-indigo-400" },
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex items-center gap-2 rounded-lg bg-background/30 px-3 py-2">
                <Icon className={`w-4 h-4 ${color} shrink-0`} />
                <span className="text-muted-foreground text-xs">{label}</span>
              </div>
            ))}
          </div>
          <Button asChild className="w-full" size="lg">
            <a href={getLoginUrl()}>Sign In to Get Started</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      {backgroundPattern !== 'none' && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: getPatternCSS(backgroundPattern),
            backgroundSize: backgroundPattern === 'dots' ? '20px 20px' : 'auto',
            opacity: backgroundOpacity / 100,
          }}
        />
      )}

      {/* Header */}
      <header className="border-b border-border/40 relative z-10 bg-background/80 backdrop-blur-sm sticky top-0">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Prosper Trading</h1>
            <p className="text-sm text-muted-foreground">Welcome back, {user?.name || user?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/settings">
                <SettingsIcon className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </Button>
            <Button variant="outline" onClick={logout}>Sign Out</Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 relative z-10 space-y-10">
        {/* Monthly Premium Chart */}
        <MonthlyPremiumChartSection />

        {/* Monthly Income Target Tracker */}
        <MonthlyIncomeTracker />

        {/* Navigation Grid */}
        <NavigationGrid />

        {/* Market Pulse */}
        <div>
          <SectionHeader icon={Newspaper} label="Market Pulse" accent="text-orange-400" />
          <MarketNewsScanner />
        </div>
      </main>
    </div>
  );
}
