import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon,
  Moon, Sun, Zap, Layers, Activity, Timer, Inbox, ShieldAlert,
  LayoutDashboard, TrendingDown, LineChart, AlertTriangle, ChevronRight,
  Newspaper
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { MonthlyPremiumChart } from "@/components/MonthlyPremiumChart";
import { MarketNewsScanner } from "@/components/MarketNewsScanner";

function MonthlyPremiumChartSection() {
  const [selectedYear, setSelectedYear] = React.useState<number | undefined>(new Date().getFullYear());
  const { data, isLoading, error } = trpc.dashboard.getMonthlyPremiumData.useQuery(
    selectedYear ? { year: selectedYear } : undefined,
    { retry: false, refetchOnWindowFocus: false }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data || data.error || data.monthlyData.length === 0) {
    return (
      <Card className="p-6 bg-card/70 backdrop-blur-sm border-border/30">
        <h2 className="text-xl font-bold text-foreground mb-4">Monthly Premium Earnings — All Accounts</h2>
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-base">{data?.error ? "Configure Tastytrade credentials in Settings to view earnings" : "No trading activity found for the selected period"}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Monthly Premium Earnings — All Accounts</h2>
        <select
          value={selectedYear || 'all'}
          onChange={(e) => setSelectedYear(e.target.value === 'all' ? undefined : Number(e.target.value))}
          className="px-3 py-1.5 rounded-md border border-border bg-background text-foreground text-sm"
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

// ─── Navigation Tile Grid ─────────────────────────────────────────────────────

interface NavTileProps {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  badgeLabel?: string;
  badgeVariant?: "default" | "destructive" | "secondary" | "outline";
  accentColor?: string;
}

function NavTile({ title, description, href, icon: Icon, badge, badgeLabel, badgeVariant = "destructive", accentColor = "text-amber-400" }: NavTileProps) {
  return (
    <Link href={href}>
      <Card className="group relative overflow-hidden cursor-pointer border-border/40 bg-card/60 hover:bg-card/90 hover:border-border/70 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 h-full">
        <CardContent className="p-5 flex flex-col gap-3 h-full">
          <div className="flex items-start justify-between">
            <div className={`p-2 rounded-lg bg-background/50 ${accentColor}`}>
              <Icon className="w-5 h-5" />
            </div>
            {badge !== undefined && badge > 0 && (
              <Badge variant={badgeVariant} className="text-xs font-semibold shrink-0">
                {badge} {badgeLabel}
              </Badge>
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground text-sm leading-tight">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
          <div className="flex items-center text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            <span>Open</span>
            <ChevronRight className="w-3 h-3 ml-0.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function NavigationTileGrid() {
  const { data: badges } = trpc.dashboard.getActionBadges.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every 60s
    retry: false,
  });
  const { data: unread } = trpc.inbox.getUnreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const liquidationFlags = badges?.liquidationFlags ?? 0;
  const gtcPending = badges?.gtcPending ?? 0;
  const inboxUnread = unread?.count ?? 0;

  const sections: { label: string; tiles: NavTileProps[] }[] = [
    {
      label: "Portfolio",
      tiles: [
        {
          title: "Portfolio Command Center",
          description: "Heat map, open positions, working orders, risk monitor, position analyzer, and portfolio advisor.",
          href: "/portfolio",
          icon: LayoutDashboard,
          badge: liquidationFlags > 0 ? liquidationFlags : undefined,
          badgeLabel: liquidationFlags === 1 ? "dog" : "dogs",
          badgeVariant: "destructive",
          accentColor: "text-cyan-400",
        },
      ],
    },
    {
      label: "Daily Tasks",
      tiles: [
        {
          title: "Daily Actions",
          description: "5-step automation + evaluation hub: close for profit, roll, sell calls, PMCC, GTC — plus Working Orders and Open Positions.",
          href: "/automation",
          icon: Zap,
          badge: gtcPending > 0 ? gtcPending : undefined,
          badgeLabel: "pending GTC",
          badgeVariant: "default",
          accentColor: "text-amber-400",
        },
        {
          title: "Inbox",
          description: "System alerts, admin broadcasts, and feedback replies from the Prosper team.",
          href: "/inbox",
          icon: Inbox,
          badge: inboxUnread > 0 ? inboxUnread : undefined,
          badgeLabel: "unread",
          badgeVariant: "default",
          accentColor: "text-blue-400",
        },
      ],
    },
    {
      label: "Trading Strategies",
      tiles: [
        {
          title: "Covered Calls",
          description: "Scan eligible stock positions, review recommendations, and submit CC orders.",
          href: "/cc",
          icon: TrendingUp,
          accentColor: "text-green-400",
        },
        {
          title: "Cash-Secured Puts",
          description: "Find high-scoring CSP opportunities across your watchlist with risk scoring.",
          href: "/csp",
          icon: TrendingDown,
          accentColor: "text-purple-400",
        },
        {
          title: "Spreads / Condors",
          description: "Iron condor and vertical spread scanner with defined-risk recommendations.",
          href: "/iron-condor",
          icon: Layers,
          accentColor: "text-pink-400",
        },
        {
          title: "PMCC Dashboard",
          description: "Poor Man's Covered Call management — track LEAPS and short call legs.",
          href: "/pmcc",
          icon: Activity,
          accentColor: "text-indigo-400",
        },
      ],
    },
    {
      label: "Analysis & Tools",
      tiles: [
        {
          title: "Spread Advisor",
          description: "AI-powered spread strategy advisor with entry/exit recommendations.",
          href: "/strategy-advisor",
          icon: LineChart,
          accentColor: "text-yellow-400",
        },
        {
          title: "Performance & History",
          description: "Lookback analytics, working orders, P&L history, and income projections.",
          href: "/performance",
          icon: BarChart3,
          accentColor: "text-teal-400",
        },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.label}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{section.label}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {section.tiles.map((tile) => (
              <NavTile key={tile.href} {...tile} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Home Component ──────────────────────────────────────────────────────

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Background texture
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
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 px-8 space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-bold">Prosper Trading</h1>
              <p className="text-muted-foreground mt-2 text-base">
                Professional options trading dashboard with intelligent scoring and automated execution
              </p>
            </div>
            <div className="space-y-1.5 text-sm text-muted-foreground text-left">
              <p>• Cash-Secured Puts (CSP) Dashboard</p>
              <p>• Covered Calls (CC) Dashboard</p>
              <p>• PMCC Strategy Management</p>
              <p>• Performance Analytics</p>
            </div>
            <Button asChild className="w-full" size="lg">
              <a href={getLoginUrl()}>Sign In to Get Started</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      {/* Background texture */}
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
      <header className="border-b border-border relative z-10">
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
        {/* Monthly Premium Chart — top for at-a-glance income overview */}
        <MonthlyPremiumChartSection />

        {/* Navigation Tile Grid — middle for daily actions */}
        <NavigationTileGrid />

        {/* Market Pulse — bottom for context */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Newspaper className="w-4 h-4" />
            Market Pulse
          </h2>
          <MarketNewsScanner />
        </div>
      </main>
    </div>
  );
}
