import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useAccount } from '@/contexts/AccountContext';
import { useTradingMode } from '@/contexts/TradingModeContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { WelcomeModal } from '@/components/WelcomeModal';
import {
  BarChart3,
  TrendingDown,
  TrendingUp,
  Layers,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Zap,
  LayoutDashboard,
  Activity,
  Grid3X3,
  ListOrdered,
  Mail,
  BarChart2,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [incomeExpanded, setIncomeExpanded] = useState(true);
  const [dailyActionsExpanded, setDailyActionsExpanded] = useState(true);
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  const { user } = useAuth();
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  // Fetch Tastytrade accounts (only when authenticated)
  const { data: accounts, isLoading: accountsLoading } = trpc.accounts.list.useQuery(undefined, { enabled: !!user });
  const { data: credentials } = trpc.settings.getCredentials.useQuery(undefined, { enabled: !!user });

  // Fetch Portfolio Safety violation count
  const { data: safetyData } = trpc.iraSafety.scanViolations.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 120000,
    staleTime: 60000,
  });
  const safetyViolationCount = (safetyData?.criticalCount ?? 0) + (safetyData?.warningCount ?? 0);

  const isTrialUser = user?.subscriptionTier === 'free_trial';

  const { data: demoAccount } = trpc.demo.getOrCreateDemoAccount.useQuery(
    undefined,
    { enabled: isTrialUser }
  );

  useEffect(() => {
    if (!selectedAccountId && accounts && accounts.length > 0) {
      const defaultId = credentials?.defaultTastytradeAccountId;
      const accountToSelect = defaultId && accounts.some((a: any) => a.accountId === defaultId)
        ? defaultId
        : accounts[0].accountId;
      setSelectedAccountId(accountToSelect);
    }
  }, [credentials, accounts, selectedAccountId, setSelectedAccountId]);

  useEffect(() => {
    if (demoAccount && !selectedAccountId) {
      setSelectedAccountId(demoAccount.accountId);
      setShowWelcomeModal(true);
    }
  }, [demoAccount, selectedAccountId, setSelectedAccountId]);

  // Auto-expand Income Strategies if on one of its routes
  useEffect(() => {
    const incomeRoutes = ['/cc', '/csp', '/iron-condor', '/pmcc'];
    if (incomeRoutes.some(r => location.startsWith(r))) {
      setIncomeExpanded(true);
    }
  }, [location]);

  // Auto-expand Daily Actions if on one of its sub-routes
  useEffect(() => {
    const dailyRoutes = ['/automation', '/working-orders', '/open-positions', '/gtc-orders'];
    if (dailyRoutes.some(r => location.startsWith(r))) {
      setDailyActionsExpanded(true);
    }
  }, [location]);

  const selectedAccount = accounts?.find((acc: any) => acc.accountId === selectedAccountId);

  // Primary nav items — flat single links (Dashboard, Portfolio, Spread Advisor)
  const primaryNavItems = [
    {
      name: 'Dashboard',
      path: '/',
      icon: LayoutDashboard,
      description: 'Overview & analytics',
    },
    {
      name: 'Portfolio',
      path: '/portfolio',
      icon: Grid3X3,
      badge: safetyViolationCount,
      badgeCritical: (safetyData?.criticalCount ?? 0) > 0,
      description: 'Command Center',
    },
    {
      name: 'Spread Advisor',
      path: '/strategy-advisor',
      icon: Sparkles,
      description: 'Strategy analysis',
    },
  ];

  // Daily Actions sub-items
  const dailyActionItems = [
    { name: 'Automation', path: '/automation', icon: Zap },
    { name: 'Working Orders', path: '/working-orders', icon: Activity },
    { name: 'Open Positions', path: '/open-positions', icon: ListOrdered },
    { name: 'Evaluation', path: '/automation?tab=evaluation', icon: BarChart2 },
    { name: 'Inbox', path: '/automation?tab=inbox', icon: Mail },
  ];

  const isDailyActionsActive = dailyActionItems.some(i => {
    if (i.path.includes('?')) {
      return location === i.path.split('?')[0] && window.location.search.includes(i.path.split('?')[1]);
    }
    return location.startsWith(i.path);
  });

  // Trading Strategies — the ONLY group with sidebar sub-menus
  const incomeStrategyItems = [
    { name: 'Covered Calls', path: '/cc', icon: TrendingUp },
    { name: 'Cash-Secured Puts', path: '/csp', icon: TrendingDown },
    { name: 'Spreads / Condors', path: '/iron-condor', icon: Layers },
    { name: 'PMCC Dashboard', path: '/pmcc', icon: Activity },
  ];

  // Secondary nav items (below Trading Strategies)
  const secondaryNavItems = [
    { name: 'Performance', path: '/performance', icon: BarChart3 },
  ];

  const isIncomeActive = incomeStrategyItems.some(i => location === i.path);

  const renderNavLink = (item: { name: string; path: string; icon: any; badge?: number; badgeCritical?: boolean; description?: string }, indent = false) => {
    const Icon = item.icon;
    const basePath = item.path.split('?')[0];
    const queryPart = item.path.includes('?') ? item.path.split('?')[1] : null;
    const isActive = item.path === '/'
      ? location === '/'
      : queryPart
        ? location === basePath && window.location.search.includes(queryPart)
        : item.path === '/automation'
          ? location === '/automation' && !window.location.search
          : location === item.path || location.startsWith(item.path + '/');
    return (
      <Link
        key={item.path}
        href={item.path}
        className={cn(
          'relative overflow-hidden flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group',
          indent && 'ml-3 py-2',
          isActive && 'bg-gradient-to-r from-amber-900/30 via-yellow-900/20 to-amber-800/30 text-amber-100 shadow-xl shadow-amber-500/30 border border-amber-500/40',
          !isActive && 'text-muted-foreground hover:text-foreground hover:bg-accent/30 hover:shadow-lg hover:shadow-amber-500/10 hover:scale-[1.02]'
        )}
      >
        {isActive && (
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-600/20 rounded-xl blur-md -z-10" />
        )}
        <div className={cn(
          'flex items-center justify-center rounded-lg transition-all duration-300',
          indent ? 'w-8 h-8' : 'w-10 h-10',
          isActive && 'bg-gradient-to-br from-amber-600 to-yellow-700 shadow-lg shadow-amber-500/50',
          !isActive && 'bg-accent/50 group-hover:bg-accent'
        )}>
          <Icon className={cn(
            'transition-all duration-300',
            indent ? 'w-4 h-4' : 'w-5 h-5',
            isActive ? 'text-white' : 'text-muted-foreground group-hover:text-foreground'
          )} />
        </div>
        {!collapsed && (
          <div className="flex-1 flex items-center justify-between min-w-0">
            <div className="min-w-0">
              <span className={cn(
                'text-sm font-medium transition-all duration-300 block',
                isActive ? 'text-amber-100' : 'text-foreground'
              )}>{item.name}</span>
              {(item as any).description && !indent && (
                <span className="text-[10px] text-muted-foreground">{(item as any).description}</span>
              )}
            </div>
            {(item as any).badge > 0 && (
              <span className={cn(
                'text-xs font-bold px-2 py-0.5 rounded-full shrink-0',
                (item as any).badgeCritical ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
              )}>
                {(item as any).badge}
              </span>
            )}
          </div>
        )}
        {isActive && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
        )}
      </Link>
    );
  };

  return (
    <div
      className={cn(
        'flex flex-col h-screen bg-card/50 backdrop-blur-md border-r border-border/50 transition-all duration-300',
        collapsed ? 'w-16' : 'w-72',
        className
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        {!collapsed && (
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-amber-200 via-yellow-500 to-amber-600 bg-clip-text text-transparent">
              Prosper Trading
            </h1>
            <p className="text-[10px] text-yellow-500 uppercase tracking-wider font-semibold">Premium Platform</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto hover:bg-accent/50"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <Separator className="bg-border/50" />

      {/* Account Selection */}
      {!collapsed && (
        <div className="p-4 space-y-2">
          {accountsLoading ? (
            <div className="text-sm text-muted-foreground">Loading accounts...</div>
          ) : accounts && accounts.length > 0 ? (
            <>
              <Select value={selectedAccountId || undefined} onValueChange={setSelectedAccountId}>
                <SelectTrigger className="w-full bg-background/50">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_ACCOUNTS">
                    <span className="font-semibold">All Accounts</span>
                  </SelectItem>
                  <Separator className="my-1" />
                  {accounts.map((account: any) => (
                    <SelectItem key={account.id} value={account.accountId}>
                      <div className="flex flex-col">
                        <span className="font-medium">{account.nickname || account.accountNumber}</span>
                        <span className="text-xs text-muted-foreground">{account.accountType}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccountId === 'ALL_ACCOUNTS' ? (
                <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Portfolio View</div>
                    <div className="text-sm font-medium text-foreground">All Accounts ({accounts.length})</div>
                  </CardContent>
                </Card>
              ) : selectedAccount && (
                <Card className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">{selectedAccount.accountType}</div>
                    <div className="text-sm font-medium text-foreground">
                      {selectedAccount.nickname || selectedAccount.accountNumber}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              No accounts found. <Link href="/settings" className="text-primary hover:underline">Configure settings</Link>
            </div>
          )}
        </div>
      )}

      <Separator className="bg-border/50" />

      {/* Navigation */}
      {!collapsed && (
        <div className="px-4 py-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trading</div>
        </div>
      )}

      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {/* Dashboard — always first */}
        {renderNavLink(primaryNavItems[0])}

        {/* Daily Actions — collapsible group */}
        <div>
          {!collapsed ? (
            <button
              onClick={() => setDailyActionsExpanded(!dailyActionsExpanded)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300',
                isDailyActionsActive
                  ? 'text-amber-300 bg-amber-900/20 border border-amber-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'
              )}
            >
              <div className={cn(
                'flex items-center justify-center w-10 h-10 rounded-lg',
                isDailyActionsActive ? 'bg-gradient-to-br from-amber-600/60 to-yellow-700/60' : 'bg-accent/50'
              )}>
                <Zap className={cn('w-5 h-5', isDailyActionsActive ? 'text-amber-200' : 'text-muted-foreground')} />
              </div>
              <div className="flex-1 text-left">
                <span className="text-sm font-medium block">Daily Actions</span>
                <span className="text-[10px] text-muted-foreground">Automation · Orders · Positions</span>
              </div>
              {dailyActionsExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
            </button>
          ) : (
            <button
              onClick={() => setDailyActionsExpanded(!dailyActionsExpanded)}
              className={cn(
                'w-full flex items-center justify-center p-3 rounded-xl transition-all duration-300',
                isDailyActionsActive ? 'bg-amber-900/30 text-amber-300' : 'text-muted-foreground hover:bg-accent/30'
              )}
            >
              <Zap className="w-5 h-5" />
            </button>
          )}

          {/* Daily Actions sub-items */}
          {dailyActionsExpanded && (
            <div className={cn('space-y-0.5 mt-0.5', !collapsed && 'pl-2')}>
              {dailyActionItems.map(item => renderNavLink(item, !collapsed))}
            </div>
          )}
        </div>

        {/* Portfolio, Spread Advisor */}
        {primaryNavItems.slice(1).map(item => (
          <div key={item.path}>
            {renderNavLink(item)}
          </div>
        ))}

        {/* Trading Strategies — collapsible group */}
        <div>
          {!collapsed ? (
            <button
              onClick={() => setIncomeExpanded(!incomeExpanded)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300',
                isIncomeActive
                  ? 'text-amber-300 bg-amber-900/20 border border-amber-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'
              )}
            >
              <div className={cn(
                'flex items-center justify-center w-10 h-10 rounded-lg',
                isIncomeActive ? 'bg-gradient-to-br from-amber-600/60 to-yellow-700/60' : 'bg-accent/50'
              )}>
                <LayoutDashboard className={cn('w-5 h-5', isIncomeActive ? 'text-amber-200' : 'text-muted-foreground')} />
              </div>
              <div className="flex-1 text-left">
                <span className="text-sm font-medium block">Trading Strategies</span>
                <span className="text-[10px] text-muted-foreground">CC · CSP · Spreads · PMCC</span>
              </div>
              {incomeExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
            </button>
          ) : (
            <button
              onClick={() => setIncomeExpanded(!incomeExpanded)}
              className={cn(
                'w-full flex items-center justify-center p-3 rounded-xl transition-all duration-300',
                isIncomeActive ? 'bg-amber-900/30 text-amber-300' : 'text-muted-foreground hover:bg-accent/30'
              )}
            >
              <LayoutDashboard className="w-5 h-5" />
            </button>
          )}

          {/* Trading Strategies sub-items */}
          {incomeExpanded && (
            <div className={cn('space-y-0.5 mt-0.5', !collapsed && 'pl-2')}>
              {incomeStrategyItems.map(item => renderNavLink(item, !collapsed))}
            </div>
          )}
        </div>

        {/* Performance */}
        {secondaryNavItems.map(item => renderNavLink(item))}
      </nav>

      <Separator className="bg-border/50" />

      {/* Trading Mode Toggle */}
      {!collapsed && (
        <div className="p-4 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trading Mode</div>
          <TradingModeToggle />
        </div>
      )}

      <Separator className="bg-border/50" />

      {/* Management Section */}
      {!collapsed && (
        <div className="px-4 py-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Management</div>
        </div>
      )}
      <div className="p-2 space-y-1">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
            'hover:bg-accent/50 hover:shadow-lg hover:shadow-primary/20',
            location === '/settings' && 'bg-primary/20 text-primary shadow-lg shadow-primary/30 border-l-2 border-primary',
            location !== '/settings' && 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Settings className="w-5 h-5" />
          {!collapsed && <span className="text-sm font-medium">Settings</span>}
        </Link>

        {user?.role === 'admin' && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
              'hover:bg-accent/50 hover:shadow-lg hover:shadow-primary/20',
              location.startsWith('/admin') && 'bg-primary/20 text-primary shadow-lg shadow-primary/30 border-l-2 border-primary',
              !location.startsWith('/admin') && 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Shield className="w-5 h-5" />
            {!collapsed && <span className="text-sm font-medium">Admin Panel</span>}
          </Link>
        )}
      </div>

      <WelcomeModal
        open={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
      />
    </div>
  );
}

/**
 * Trading Mode Toggle Component
 */
function TradingModeToggle() {
  const { mode, setMode, isLoading } = useTradingMode();
  const { user } = useAuth();

  const isDemo = user?.subscriptionTier === 'free_trial';

  const handleToggle = () => {
    const newMode = mode === 'live' ? 'paper' : 'live';
    setMode(newMode);
  };

  if (isLoading) return null;

  if (isDemo) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg p-3 border transition-all duration-300 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30">
          <div className="flex items-center gap-2 flex-1">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Demo Mode</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground px-1">Simulated $100K account</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={cn(
        'flex items-center gap-3 rounded-lg p-3 border transition-all duration-300',
        mode === 'live'
          ? 'bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30'
          : 'bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-blue-500/30'
      )}>
        <div className="flex items-center gap-2 flex-1">
          <div className={cn(
            'w-2 h-2 rounded-full',
            mode === 'live' ? 'bg-green-500 animate-pulse' : 'bg-blue-400'
          )} />
          <span className="text-sm font-medium">
            {mode === 'live' ? 'Live Trading' : 'Paper Trading'}
          </span>
        </div>
        <Switch
          checked={mode === 'live'}
          onCheckedChange={handleToggle}
          className="data-[state=checked]:bg-green-600"
        />
      </div>
      <div className="text-xs text-muted-foreground px-1">
        {mode === 'live' ? 'Using Tastytrade API' : 'Simulated trading • No real orders'}
      </div>
    </div>
  );
}
