import React, { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon,
  Moon, Sun, Zap, Layers, Activity, Timer, Inbox, ShieldAlert,
  LayoutDashboard, TrendingDown, LineChart, AlertTriangle, ChevronRight,
  Newspaper, ClipboardList, ListOrdered, BellRing, Briefcase, Target,
  ArrowUpRight, RefreshCw, CheckCircle2, Clock, Bot, TrendingDown as ProfitIcon,
  RotateCcw, RotateCw, PhoneCall, Scan, Play, Sparkles, Send
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { getLoginUrl } from "@/const";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { useSupportWidget } from "@/contexts/SupportContext";
import { MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MonthlyPremiumChart } from "@/components/MonthlyPremiumChart";
import { TradingViewEconomicCalendar } from "@/components/TradingViewEconomicCalendar";
import { TradingViewTickerTape } from "@/components/TradingViewTickerTape";
import { GapAdvisorModal } from "@/components/GapAdvisorModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Monthly Premium Chart Section ───────────────────────────────────────────

function MonthlyPremiumChartSection() {
  const [selectedYear, setSelectedYear] = useState<number | undefined>(new Date().getFullYear());
  const [isSyncing, setIsSyncing] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = trpc.dashboard.getMonthlyPremiumData.useQuery(
    selectedYear ? { year: selectedYear } : undefined,
    {
      retry: false,
      refetchOnWindowFocus: false,
      // Auto-refresh every 5 minutes so new fills appear without a manual sync click
      refetchInterval: 5 * 60 * 1000,
      // staleTime: 0 ensures manual refresh always hits the live Tastytrade API
      staleTime: 0,
    }
  );
  const { data: syncState } = trpc.portfolioSync.getSyncState.useQuery(undefined, {
    refetchInterval: isSyncing ? 3000 : false,
    refetchOnWindowFocus: false,
  });
  const triggerSync = trpc.portfolioSync.triggerSync.useMutation({
    onSuccess: () => {
      // Refetch chart immediately (live API) and again after sync completes
      refetch();
      setTimeout(() => {
        setIsSyncing(false);
        refetch();
      }, 8000);
    },
    onError: () => setIsSyncing(false),
  });
  // Auto-sync on mount if last transaction sync was more than 15 minutes ago
  useEffect(() => {
    if (syncState === undefined) return;
    const firstState = syncState?.states?.[0];
    const lastSync = firstState?.lastTransactionsSyncAt ? new Date(firstState.lastTransactionsSyncAt).getTime() : 0;
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    if (lastSync < fifteenMinutesAgo && !isSyncing) {
      setIsSyncing(true);
      triggerSync.mutate({ forceFullRefresh: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!syncState]);
  const lastSyncLabel = syncState?.states?.[0]?.lastTransactionsSyncAt
    ? new Date(syncState.states[0].lastTransactionsSyncAt).toLocaleString()
    : null;

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
            <p className="text-xs text-muted-foreground">
              All Accounts — Income Overview
              {isSyncing && <span className="ml-2 text-amber-400 animate-pulse">⟳ Syncing latest trades…</span>}
              {!isSyncing && lastSyncLabel && <span className="ml-2 text-muted-foreground/60">· Synced {lastSyncLabel}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Immediately refetch the live chart data AND trigger a DB cache sync
              refetch();
              setIsSyncing(true);
              triggerSync.mutate({ forceFullRefresh: false });
            }}
            disabled={isFetching || isSyncing}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            title="Sync latest trades from Tastytrade and refresh chart"
          >
            <RefreshCw className={`w-4 h-4 ${(isFetching || isSyncing) ? 'animate-spin' : ''}`} />
          </Button>
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

// ─── VIX Explainer Modal ────────────────────────────────────────────────────

function VixExplainerModal({ open, onClose, vix }: { open: boolean; onClose: () => void; vix?: number }) {
  const vixLevel = vix
    ? vix >= 40 ? 'extreme'
    : vix >= 30 ? 'high'
    : vix >= 20 ? 'elevated'
    : vix >= 15 ? 'normal'
    : 'low'
    : 'unknown';

  const vixColor = vix
    ? vix >= 30 ? 'text-red-400'
    : vix >= 20 ? 'text-amber-400'
    : 'text-green-400'
    : 'text-muted-foreground';

  const ranges = [
    { range: '< 15', label: 'Low / Complacent', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', meaning: 'Markets are calm. Premium is thin — options are cheap. Ideal for buying protection but tough for premium sellers. Be cautious of sudden reversals from complacency.' },
    { range: '15 – 20', label: 'Normal / Stable', color: 'text-green-300', bg: 'bg-green-500/10 border-green-500/20', meaning: 'Healthy baseline. Good conditions for selling premium at reasonable strikes. CSPs and CCs work well. Standard delta targets (0.20–0.30) are appropriate.' },
    { range: '20 – 30', label: 'Elevated / Cautious', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', meaning: 'Above-average fear. Premium is juicy — great for sellers, but risk is higher. Consider tighter deltas (0.15–0.20), wider spreads, and smaller position sizes. Watch for gap risk.' },
    { range: '30 – 40', label: 'High / Fearful', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', meaning: 'Significant market stress. Premium is very rich but so is the risk. Reduce position sizes, favor spreads over naked options, and avoid chasing premium. Rolls may be difficult.' },
    { range: '> 40', label: 'Extreme / Crisis', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', meaning: 'Crisis-level volatility (e.g., COVID crash, 2008). Extreme whipsaws. Most experienced traders go to cash or only trade defined-risk spreads. Avoid naked short options.' },
  ];

  const movements = [
    { signal: 'VIX spikes +20% in a day', meaning: 'Market fear spiking — often a sell-off. Expect wide bid-ask spreads and gap risk overnight.' },
    { signal: 'VIX drops sharply after a spike', meaning: 'Fear subsiding — often a relief rally. Good time to close defensive positions at profit.' },
    { signal: 'VIX < 15 for weeks', meaning: 'Complacency building. Markets historically mean-revert from these levels. Consider buying cheap protection.' },
    { signal: 'VIX > 30 + rising', meaning: 'Trend of fear. Avoid adding new short premium. Focus on managing existing positions.' },
    { signal: 'VIX > 30 + falling', meaning: 'Peak fear may be passing. Historically a strong signal to sell premium into elevated IV.' },
    { signal: 'VIX diverges from SPX', meaning: 'If SPX falls but VIX stays low, or SPX rises but VIX stays high — watch for a snap correction.' },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>VIX — The Fear Gauge</span>
            {vix && (
              <span className={`text-sm font-bold ${vixColor}`}>
                Currently: {vix} ({vixLevel.charAt(0).toUpperCase() + vixLevel.slice(1)})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          {/* What is VIX */}
          <div>
            <h3 className="font-semibold text-foreground mb-1.5">What is the VIX?</h3>
            <p className="text-muted-foreground leading-relaxed">
              The <strong className="text-foreground">CBOE Volatility Index (VIX)</strong> measures the market's expectation of 30-day volatility in the S&P 500, derived from real-time options prices. It is often called the <em>"Fear Gauge"</em> because it rises when investors are uncertain or fearful and falls when markets are calm.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-2">
              For options sellers, VIX is critical: <strong className="text-foreground">higher VIX = richer premium</strong> (more income potential) but also <strong className="text-foreground">higher risk</strong> of large moves against your positions.
            </p>
          </div>

          {/* VIX Ranges */}
          <div>
            <h3 className="font-semibold text-foreground mb-2">VIX Ranges & What They Mean</h3>
            <div className="space-y-2">
              {ranges.map((r) => (
                <div key={r.range} className={`rounded-lg border p-3 ${r.bg} ${vix && (
                  (r.range === '< 15' && vix < 15) ||
                  (r.range === '15 – 20' && vix >= 15 && vix < 20) ||
                  (r.range === '20 – 30' && vix >= 20 && vix < 30) ||
                  (r.range === '30 – 40' && vix >= 30 && vix < 40) ||
                  (r.range === '> 40' && vix >= 40)
                ) ? 'ring-1 ring-offset-1 ring-offset-background ring-current' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold font-mono ${r.color}`}>{r.range}</span>
                    <span className={`text-xs font-semibold ${r.color}`}>{r.label}</span>
                    {vix && (
                      (r.range === '< 15' && vix < 15) ||
                      (r.range === '15 – 20' && vix >= 15 && vix < 20) ||
                      (r.range === '20 – 30' && vix >= 20 && vix < 30) ||
                      (r.range === '30 – 40' && vix >= 30 && vix < 40) ||
                      (r.range === '> 40' && vix >= 40)
                    ) && <span className="text-xs bg-foreground/10 text-foreground px-1.5 py-0.5 rounded font-medium">← You are here</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{r.meaning}</p>
                </div>
              ))}
            </div>
          </div>

          {/* VIX Movement Signals */}
          <div>
            <h3 className="font-semibold text-foreground mb-2">Reading VIX Movement</h3>
            <div className="space-y-2">
              {movements.map((m) => (
                <div key={m.signal} className="flex gap-3 py-2 border-b border-border/30 last:border-0">
                  <span className="text-amber-400 font-mono text-xs font-semibold shrink-0 w-52">{m.signal}</span>
                  <span className="text-xs text-muted-foreground">{m.meaning}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Options Seller Strategy */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <h3 className="font-semibold text-amber-300 mb-2">Options Seller Strategy by VIX Level</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="font-semibold text-foreground mb-1">Low VIX (&lt; 20)</p>
                <ul className="text-muted-foreground space-y-0.5">
                  <li>• Sell closer to ATM (higher delta)</li>
                  <li>• Use shorter DTE (7–21 days)</li>
                  <li>• Smaller position sizes</li>
                  <li>• Consider buying spreads instead</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">High VIX (&gt; 25)</p>
                <ul className="text-muted-foreground space-y-0.5">
                  <li>• Sell further OTM (lower delta)</li>
                  <li>• Use longer DTE (30–45 days)</li>
                  <li>• Reduce position count</li>
                  <li>• Favor defined-risk spreads</li>
                </ul>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground/60 italic">
            VIX data sourced from CBOE via Tradier. Updated with each Morning Briefing refresh.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Morning Briefing ─────────────────────────────────────────────────────

function AIMorningBriefing() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [showVixModal, setShowVixModal] = useState(false);
  const [followUpInput, setFollowUpInput] = useState('');
  const [conversation, setConversation] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const hasAutoGenerated = useRef(false);

  const { data: ctx, isLoading: ctxLoading } = trpc.dashboard.getMorningBriefingContext.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const generateMutation = trpc.dashboard.generateMorningBriefing.useMutation({
    onSuccess: (data) => {
      setBriefing(data.briefing);
      setGeneratedAt(new Date());
      setIsLoading(false);
    },
    onError: () => setIsLoading(false),
  });

  const followUpMutation = trpc.dashboard.morningBriefingFollowUp.useMutation();

  const handleGenerate = useCallback(() => {
    if (!ctx || isLoading) return;
    setIsLoading(true);
    setBriefing(null);
    setConversation([]);
    generateMutation.mutate({ contextJson: JSON.stringify(ctx) });
  }, [ctx, isLoading, generateMutation]);

  const handleFollowUp = useCallback(async () => {
    const msg = followUpInput.trim();
    if (!msg || !briefing || isLoadingFollowUp) return;
    setFollowUpInput('');
    const newHistory = [...conversation, { role: 'user' as const, content: msg }];
    setConversation(newHistory);
    setIsLoadingFollowUp(true);
    try {
      const result = await followUpMutation.mutateAsync({
        briefingContext: JSON.stringify(ctx ?? {}),
        initialBriefing: briefing,
        conversationHistory: conversation,
        userMessage: msg,
      });
      setConversation([...newHistory, { role: 'assistant', content: String(result.reply) }]);
    } catch {
      setConversation([...newHistory, { role: 'assistant', content: 'Unable to generate response. Please try again.' }]);
    } finally {
      setIsLoadingFollowUp(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [followUpInput, briefing, isLoadingFollowUp, conversation, followUpMutation, ctx]);

  // Auto-generate once when context loads
  useEffect(() => {
    if (ctx && !hasAutoGenerated.current && !ctxLoading) {
      hasAutoGenerated.current = true;
      handleGenerate();
    }
  }, [ctx, ctxLoading, handleGenerate]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Parse markdown into sections for display
  const renderBriefing = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('## ')) {
        return <h3 key={i} className="text-sm font-bold text-amber-300 mt-3 mb-1 first:mt-0">{line.slice(3)}</h3>;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        return <p key={i} className="text-xs text-muted-foreground pl-3 before:content-['·'] before:mr-2 before:text-amber-400/60">{line.slice(2)}</p>;
      } else if (line.startsWith('**') && line.endsWith('**')) {
        return <p key={i} className="text-xs font-semibold text-foreground">{line.slice(2, -2)}</p>;
      } else if (line.trim() === '') {
        return null;
      } else {
        // Inline bold
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <p key={i} className="text-xs text-muted-foreground">
            {parts.map((part, j) => j % 2 === 1 ? <strong key={j} className="text-foreground">{part}</strong> : part)}
          </p>
        );
      }
    }).filter(Boolean);
  };

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-950/30 via-card/80 to-card/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/15">
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">AI Morning Briefing</h2>
            <p className="text-xs text-muted-foreground">
              {generatedAt
                ? `Generated at ${generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${today}`
                : today}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* VIX badge — clickable */}
          {ctx?.vix && (
            <Badge
              className={`text-xs font-bold cursor-pointer hover:opacity-80 transition-opacity ${
                ctx.vix >= 30 ? 'bg-red-500/20 text-red-300 border-red-500/30' :
                ctx.vix >= 20 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                'bg-green-500/20 text-green-300 border-green-500/30'
              }`}
              variant="outline"
              onClick={() => setShowVixModal(true)}
              title="Click to learn about VIX"
            >
              VIX {ctx.vix}
            </Badge>
          )}

          {/* VIX Explainer Modal */}
          <VixExplainerModal
            open={showVixModal}
            onClose={() => setShowVixModal(false)}
            vix={ctx?.vix ?? undefined}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50"
            onClick={handleGenerate}
            disabled={isLoading || ctxLoading}
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span className="ml-1.5">{isLoading ? 'Generating…' : 'Refresh'}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground"
            onClick={() => setIsExpanded(v => !v)}
          >
            {isExpanded ? <ChevronRight className="w-3.5 h-3.5 rotate-90" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="px-5 py-4">
          {(isLoading || ctxLoading) && !briefing && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              <p className="text-xs text-muted-foreground">Analyzing your portfolio and market conditions…</p>
            </div>
          )}
          {briefing && (
            <div className="space-y-0.5">
              {renderBriefing(briefing)}
            </div>
          )}
          {!briefing && !isLoading && !ctxLoading && (
            <div className="flex items-center gap-3 py-4">
              <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">Click Refresh to generate your morning briefing.</p>
            </div>
          )}
          {/* Conversation history */}
          {conversation.length > 0 && (
            <div className="mt-4 space-y-3 border-t border-amber-500/10 pt-4">
              {conversation.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 text-xs ${
                    msg.role === 'user'
                      ? 'bg-amber-500/10 border border-amber-500/20 ml-6 text-amber-200'
                      : 'bg-muted/30 border border-border/40 mr-6'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p>{msg.content}</p>
                  ) : (
                    <div className="space-y-0.5">{renderBriefing(msg.content)}</div>
                  )}
                </div>
              ))}
              {isLoadingFollowUp && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mr-6 bg-muted/30 border border-border/40 rounded-lg p-3">
                  <Loader2 className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                  Thinking…
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
          )}

          {/* Quick stats row */}
          {ctx && (
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/20 flex-wrap">
              {ctx.closeProfitCount > 0 && (
                <span className="text-xs text-emerald-400">✓ {ctx.closeProfitCount} ready to close</span>
              )}
              {ctx.rollPositionsCount > 0 && (
                <span className="text-xs text-orange-400">⟳ {ctx.rollPositionsCount} to roll</span>
              )}
              {ctx.sellCallsCount > 0 && (
                <span className="text-xs text-blue-400">↑ {ctx.sellCallsCount} CC eligible</span>
              )}
              {ctx.upcomingExpirations.length > 0 && (
                <span className="text-xs text-red-400">⚠ {ctx.upcomingExpirations.length} expiring ≤21d</span>
              )}
              {ctx.openPositionsCount > 0 && (
                <span className="text-xs text-muted-foreground">{ctx.openPositionsCount} open positions</span>
              )}
            </div>
          )}

          {/* Follow-up prompt field */}
          {briefing && !isLoading && (
            <div className="mt-4 pt-3 border-t border-amber-500/10">
              <div className="flex gap-2">
                <Textarea
                  value={followUpInput}
                  onChange={e => setFollowUpInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleFollowUp();
                    }
                  }}
                  placeholder="Ask a follow-up question about your briefing… (e.g. 'Which roll is most urgent?')"
                  className="min-h-[48px] max-h-[100px] text-xs resize-none bg-amber-950/20 border-amber-500/20 focus:border-amber-500/40 placeholder:text-muted-foreground/50"
                  disabled={isLoadingFollowUp}
                />
                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0 bg-amber-500 hover:bg-amber-600 text-black self-end"
                  onClick={handleFollowUp}
                  disabled={!followUpInput.trim() || isLoadingFollowUp}
                >
                  {isLoadingFollowUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/50 mt-1">Enter to send · Shift+Enter for new line</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Monthly Income Tracker ─────────────────────────────────────────────────────

function MonthlyIncomeTracker() {
  const { data: monthlyData, refetch: refetchMonthly } = trpc.userPreferences.getMonthlyCollected.useQuery(undefined, {
    // Match the 5-minute sync cadence so the collected amount stays current
    refetchInterval: 5 * 60_000,
    // staleTime: 0 ensures the live API is always hit on manual refresh
    staleTime: 0,
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
            {/* Premium breakdown */}
            {monthlyData.breakdown && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 border-t border-border/20">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">📥 STO collected</span>
                  <span className="text-emerald-400 font-medium">+${monthlyData.breakdown.stoAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} <span className="text-muted-foreground/60">({monthlyData.breakdown.stoCount})</span></span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">📤 BTC buybacks</span>
                  <span className="text-red-400 font-medium">-${monthlyData.breakdown.btcAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} <span className="text-muted-foreground/60">({monthlyData.breakdown.btcCount})</span></span>
                </div>
                {monthlyData.breakdown.stcCount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">📥 STC credits</span>
                    <span className="text-emerald-400 font-medium">+${monthlyData.breakdown.stcAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} <span className="text-muted-foreground/60">({monthlyData.breakdown.stcCount})</span></span>
                  </div>
                )}
                {monthlyData.breakdown.btoCount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">📤 BTO debits</span>
                    <span className="text-red-400 font-medium">-${monthlyData.breakdown.btoAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} <span className="text-muted-foreground/60">({monthlyData.breakdown.btoCount})</span></span>
                  </div>
                )}
              </div>
            )}
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

// ─── Rolled Today Card ──────────────────────────────────────────────────────
function RolledTodayCard() {
  const [, navigate] = useLocation();
  const { data, isLoading, refetch } = trpc.rolls.getRolledTodaySummary.useQuery(undefined, {
    refetchInterval: 2 * 60_000, // refresh every 2 min
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-card/40 p-4 animate-pulse">
        <div className="h-4 w-32 bg-muted/40 rounded mb-3" />
        <div className="h-8 w-24 bg-muted/40 rounded" />
      </div>
    );
  }

  if (!data || data.count === 0) {
    return (
      <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/60 to-card/30 p-4">
        <div className="flex items-center gap-2 mb-2">
          <RotateCw className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Rolled Today</span>
        </div>
        <p className="text-xs text-muted-foreground">No rolls submitted today.</p>
      </div>
    );
  }

  const strategyColors: Record<string, string> = {
    CC: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
    CSP: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    BPS: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    BCS: 'text-pink-400 bg-pink-500/10 border-pink-500/30',
    IC: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/8 to-card/40 backdrop-blur-sm p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <RotateCw className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div>
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Rolled Today</span>
            <span className="ml-2 text-xs text-muted-foreground">{data.count} position{data.count !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-lg font-bold text-green-400">
              {data.totalNetCredit >= 0 ? '+' : ''}${data.totalNetCredit.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground">total net credit</div>
          </div>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Position rows */}
      <div className="space-y-1.5">
        {data.positions.map((pos) => (
          <div
            key={pos.id}
            className="flex items-center justify-between px-3 py-2 rounded-xl bg-background/30 border border-border/20 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all cursor-pointer"
            onClick={() => navigate('/automation?tab=rolls')}
            title="View in Roll Dashboard"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-xs text-foreground">{pos.symbol}</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                strategyColors[pos.strategy.toUpperCase()] ?? 'text-muted-foreground bg-muted/20 border-border/30'
              }`}>
                {pos.strategy.toUpperCase()}
              </span>
              {pos.newStrike && (
                <span className="text-[10px] text-muted-foreground">
                  → ${pos.newStrike} · {pos.newExpiration}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-mono font-semibold ${
                pos.netCredit >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {pos.netCredit >= 0 ? '+' : ''}${pos.netCredit.toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(pos.rolledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer link */}
      <button
        onClick={() => navigate('/automation?tab=rolls')}
        className="mt-3 w-full text-center text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors flex items-center justify-center gap-1"
      >
        View Roll Dashboard <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Main Home Component ──────────────────────────────────────────────────────

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
   const { theme, toggleTheme } = useTheme();
  const { openSupport } = useSupportWidget();
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
            <Button variant="outline" size="sm" onClick={openSupport} className="gap-1.5">
              <MessageCircle className="h-4 w-4" />
              Support
            </Button>
            <Button variant="outline" onClick={logout}>Sign Out</Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 relative z-10 space-y-10">
        {/* AI Morning Briefing */}
        <AIMorningBriefing />

        {/* Monthly Premium Chart */}
        <MonthlyPremiumChartSection />

        {/* Monthly Income Target Tracker */}
        <MonthlyIncomeTracker />

        {/* Rolled Today Summary */}
        <RolledTodayCard />

        {/* Navigation Grid */}
        <NavigationGrid />

        {/* Ticker Tape */}
        <div className="-mx-4 sm:-mx-0">
          <TradingViewTickerTape />
        </div>

        {/* Market Events — Economic Calendar */}
        <div>
          <SectionHeader icon={Newspaper} label="Market Events" accent="text-orange-400" />
          <p className="text-sm text-muted-foreground mb-4">
            Upcoming economic events, Fed decisions, CPI, NFP, and earnings releases — critical context for managing short premium positions.
          </p>
          <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm overflow-hidden" style={{ height: '500px' }}>
            <TradingViewEconomicCalendar />
          </div>
        </div>
      </main>
    </div>
  );
}
