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
  PieChart,
  TrendingDown,
  TrendingUp,
  Layers,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  Home,
  Circle,
  CheckSquare,
  ListChecks,
  ClipboardList,
  Sparkles,
  Inbox,
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
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  const { user } = useAuth();
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  // Fetch Tastytrade accounts (only when authenticated)
  const { data: accounts, isLoading: accountsLoading } = trpc.accounts.list.useQuery(undefined, { enabled: !!user });
  const { data: credentials } = trpc.settings.getCredentials.useQuery(undefined, { enabled: !!user });
  
  // Fetch unread count for inbox badge
  const { data: unreadCount } = trpc.inbox.getUnreadCount.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch Portfolio Safety violation count for Action Items badge
  const { data: safetyData } = trpc.iraSafety.scanViolations.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 120000, // Refresh every 2 minutes
    staleTime: 60000,
  });
  const safetyViolationCount = (safetyData?.criticalCount ?? 0) + (safetyData?.warningCount ?? 0);

  // Check if user is on free trial (demo mode)
  const isTrialUser = user?.subscriptionTier === 'free_trial';
  
  // Initialize demo account for trial users
  const { data: demoAccount } = trpc.demo.getOrCreateDemoAccount.useQuery(
    undefined,
    { enabled: isTrialUser }
  );
  
  // Set default account if available
  useEffect(() => {
    if (credentials?.defaultTastytradeAccountId && !selectedAccountId && accounts) {
      setSelectedAccountId(credentials.defaultTastytradeAccountId);
    }
  }, [credentials, accounts, selectedAccountId, setSelectedAccountId]);
  
  // Auto-select demo account and show welcome modal for demo users
  useEffect(() => {
    if (demoAccount && !selectedAccountId) {
      setSelectedAccountId(demoAccount.accountId);
      setShowWelcomeModal(true);
    }
  }, [demoAccount, selectedAccountId, setSelectedAccountId]);

  // Get selected account details
  const selectedAccount = accounts?.find((acc: any) => acc.accountId === selectedAccountId);

  // Navigation items
  const navItems = [
    {
      name: 'Dashboard',
      path: '/',
      icon: Home,
    },
    {
      name: 'Action Items',
      path: '/action-items',
      icon: CheckSquare,
      badge: safetyViolationCount,
      badgeCritical: (safetyData?.criticalCount ?? 0) > 0,
    },
    {
      name: 'Performance',
      path: '/performance',
      icon: BarChart3,
    },
    {
      name: 'Spread Advisor',
      path: '/strategy-advisor',
      icon: Sparkles,
    },
    {
      name: 'CSP - BPS',
      path: '/csp',
      icon: TrendingDown,
    },
    {
      name: 'CC - BCS',
      path: '/cc',
      icon: TrendingUp,
    },
    {
      name: 'Iron Condor',
      path: '/iron-condor',
      icon: Layers,
    },
    {
      name: 'PMCC Dashboard',
      path: '/pmcc',
      icon: Layers,
    },
  ];



  return (
    <div
      className={cn(
        'flex flex-col h-screen bg-card/50 backdrop-blur-md border-r border-border/50 transition-all duration-300',
        collapsed ? 'w-16' : 'w-72',
        className
      )}
    >
      {/* Header with Logo */}
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
                  {/* All Accounts option for Performance Analytics */}
                  <SelectItem value="ALL_ACCOUNTS">
                    <span className="font-semibold">All Accounts</span>
                  </SelectItem>
                  <Separator className="my-1" />
                  {accounts.map((account: any) => (
                    <SelectItem key={account.id} value={account.accountId}>
                      {account.nickname || account.accountNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccountId === 'ALL_ACCOUNTS' ? (
                <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Portfolio View</div>
                    <div className="text-sm font-medium text-foreground">
                      All Accounts ({accounts.length})
                    </div>
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

      {/* Navigation - Trading Section */}
      {!collapsed && (
        <div className="px-4 py-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trading</div>
        </div>
      )}
      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;

          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                'relative overflow-hidden flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group',
                isActive && 'bg-gradient-to-r from-amber-900/30 via-yellow-900/20 to-amber-800/30 text-amber-100 shadow-xl shadow-amber-500/30 border border-amber-500/40',
                !isActive && 'text-muted-foreground hover:text-foreground hover:bg-accent/30 hover:shadow-lg hover:shadow-amber-500/10 hover:scale-[1.02]'
              )}
            >
              {/* Gradient Border Effect */}
              {isActive && (
                <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-600/20 rounded-xl blur-md -z-10" />
              )}
              
              {/* Icon with gradient background */}
              <div className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-300",
                isActive && "bg-gradient-to-br from-amber-600 to-yellow-700 shadow-lg shadow-amber-500/50",
                !isActive && "bg-accent/50 group-hover:bg-accent"
              )}>
                <item.icon className={cn(
                  "w-5 h-5 transition-all duration-300",
                  isActive && "text-white",
                  !isActive && "text-muted-foreground group-hover:text-foreground"
                )} />
              </div>
                         {!collapsed && (
                <div className="flex-1 flex items-center justify-between">
                  <span className={cn(
                    "text-sm font-medium transition-all duration-300",
                    isActive && "text-amber-100",
                    !isActive && "text-foreground"
                  )}>{item.name}</span>
                  {(item as any).badge > 0 && (
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full',
                      (item as any).badgeCritical
                        ? 'bg-red-600 text-white'
                        : 'bg-amber-500 text-white'
                    )}>
                      {(item as any).badge}
                    </span>
                  )}
                </div>
              )}
              
              {/* Shimmer effect for active item */}
              {isActive && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
              )}
            </Link>
          );
        })}
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
        
        {/* Admin Panel - Only visible to admin users */}
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
      
      {/* Welcome Modal for Demo Users */}
      <WelcomeModal 
        open={showWelcomeModal} 
        onClose={() => setShowWelcomeModal(false)} 
      />
    </div>
  );
}

/**
 * Trading Mode Toggle Component
 * Allows users to switch between Live (Tastytrade) and Paper (Tradier) trading modes
 */
function TradingModeToggle() {
  const { mode, setMode, isLoading } = useTradingMode();
  const { user } = useAuth();
  
  // Check if user is on free trial (demo mode)
  const isDemo = user?.subscriptionTier === 'free_trial';

  const handleToggle = () => {
    const newMode = mode === 'live' ? 'paper' : 'live';
    setMode(newMode);
  };

  if (isLoading) {
    return null;
  }
  
  // Show Demo Mode for trial users (not owner)
  if (isDemo) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg p-3 border transition-all duration-300 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30">
          <div className="flex items-center gap-2 flex-1">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Demo Mode</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground px-1">
          Simulated $100K account
        </div>
      </div>
    );
  }

  // Show Live/Paper toggle for paid users
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-3 rounded-lg p-3 border transition-all duration-300 ${
        mode === 'live'
          ? 'bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30'
          : 'bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30'
      }`}>
        <div className="flex items-center gap-2 flex-1">
          {mode === 'live' ? (
            <TrendingUp className="h-4 w-4 text-green-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-blue-500" />
          )}
          <span className="text-sm font-medium">
            {mode === 'live' ? 'Live Trading' : 'Paper Trading'}
          </span>
        </div>
        <Switch
          checked={mode === 'live'}
          onCheckedChange={handleToggle}
          className="data-[state=checked]:bg-green-500"
        />
      </div>
      <div className="text-xs text-muted-foreground px-1">
        {mode === 'live' ? 'Using Tastytrade API' : 'Using Tradier API (read-only)'}
      </div>
    </div>
  );
}
