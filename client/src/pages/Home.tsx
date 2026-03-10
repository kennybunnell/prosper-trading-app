import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon,
  Moon, Sun, Zap, Layers, Activity, Timer, Inbox, ShieldAlert,
  LayoutDashboard, TrendingDown, LineChart, AlertTriangle, ChevronRight,
  Newspaper, ClipboardList, ListOrdered, BellRing, Briefcase, Target,
  ArrowUpRight, RefreshCw, CheckCircle2, Clock, Bot
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { MonthlyPremiumChart } from "@/components/MonthlyPremiumChart";
import { MarketNewsScanner } from "@/components/MarketNewsScanner";

// ─── Monthly Premium Chart Section ───────────────────────────────────────────

function MonthlyPremiumChartSection() {
  const [selectedYear, setSelectedYear] = React.useState<number | undefined>(new Date().getFullYear());
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
  gradient: string;        // Tailwind gradient classes for the card bg
  iconBg: string;          // Icon container bg
  iconColor: string;       // Icon color
  badges?: { label: string; variant?: "default" | "destructive" | "secondary" | "outline"; color?: string }[];
  metric?: { value: string | number; label: string; color?: string };
  onClick?: () => void;
}

function RichCard({ title, description, href, icon: Icon, gradient, iconBg, iconColor, badges, metric }: RichCardProps) {
  const [, navigate] = useLocation();
  return (
    <div
      onClick={() => navigate(href)}
      className={`group relative overflow-hidden cursor-pointer rounded-2xl border border-border/30 ${gradient} hover:border-border/60 transition-all duration-300 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1 h-full`}
    >
      {/* Subtle shine overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />

      <div className="relative p-5 flex flex-col gap-3 h-full">
        {/* Top row: icon + badges */}
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
                  className={`text-xs font-bold shrink-0 ${b.color ?? ''}`}
                >
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Title + description */}
        <div className="flex-1">
          <h3 className="font-bold text-foreground text-sm leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        </div>

        {/* Bottom row: metric or open link */}
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

// ─── Daily Actions Sub-Card Grid ──────────────────────────────────────────────

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

// ─── Main Navigation Grid ─────────────────────────────────────────────────────

function NavigationGrid() {
  const { data: badges, isLoading: badgesLoading } = trpc.dashboard.getActionBadges.useQuery(undefined, {
    refetchInterval: 90_000,
    retry: false,
  });
  const { data: unread } = trpc.inbox.getUnreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const dogs = badges?.liquidationFlags ?? 0;
  const gtcPending = badges?.gtcPending ?? 0;
  const workingOrders = badges?.workingOrdersCount ?? null;
  const openPositions = badges?.openPositionsCount ?? null;
  const inboxUnread = unread?.count ?? 0;

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
            badges={dogs > 0 ? [{ label: `${dogs} ${dogs === 1 ? 'dog' : 'dogs'}`, variant: "destructive" }] : undefined}
            metric={openPositions !== null ? { value: openPositions, label: "open positions", color: "text-cyan-400" } : undefined}
          />
        </div>
      </div>

      {/* ── DAILY ACTIONS ─────────────────────────────────────────────────── */}
      <div>
        <SectionHeader icon={Zap} label="Daily Actions" accent="text-amber-400" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <DailySubCard
            title="Automation Steps"
            href="/automation?tab=automation"
            icon={Bot}
            iconColor="text-amber-400"
            iconBg="bg-amber-500/15"
            status="5-step daily workflow"
          />
          <DailySubCard
            title="Working Orders"
            href="/automation?tab=working-orders"
            icon={ClipboardList}
            iconColor="text-blue-400"
            iconBg="bg-blue-500/15"
            badge={workingOrders}
            badgeLabel="active"
            badgeColor="bg-blue-500/20 text-blue-300 border-blue-500/30"
            status={badgesLoading ? "Loading..." : workingOrders === null ? "Configure API" : undefined}
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
            status={badgesLoading ? "Loading..." : openPositions === null ? "Configure API" : undefined}
          />
          <DailySubCard
            title="Auto-Close Orders"
            href="/automation?tab=auto-close"
            icon={CheckCircle2}
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
