import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useAccount } from '@/contexts/AccountContext';
import {
  BarChart3,
  TrendingDown,
  TrendingUp,
  Layers,
  Settings,
  ChevronLeft,
  ChevronRight,
  Home,
  Circle,
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

  // Fetch Tastytrade accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.accounts.list.useQuery();
  const { data: credentials } = trpc.settings.getCredentials.useQuery();

  // Set default account if available
  useEffect(() => {
    if (credentials?.defaultTastytradeAccountId && !selectedAccountId && accounts) {
      setSelectedAccountId(credentials.defaultTastytradeAccountId);
    }
  }, [credentials, accounts, selectedAccountId, setSelectedAccountId]);

  // Get selected account details
  const selectedAccount = accounts?.find((acc: any) => acc.accountId === selectedAccountId);

  // Navigation items
  const navItems = [
    {
      name: 'Dashboard',
      path: '/',
      icon: Home,
      description: 'Overview',
    },
    {
      name: 'CSP Dashboard',
      path: '/csp',
      icon: TrendingDown,
      description: 'Cash-Secured Puts',
    },
    {
      name: 'CC Dashboard',
      path: '/cc',
      icon: TrendingUp,
      description: 'Covered Calls',
    },
    {
      name: 'PMCC Dashboard',
      path: '/pmcc',
      icon: Layers,
      description: 'Poor Man\'s Covered Call',
    },
    {
      name: 'Performance',
      path: '/performance',
      icon: BarChart3,
      description: 'Analytics & Tracking',
    },
  ];

  // Mock Quick Stats (TODO: Replace with real data from backend)
  const quickStats = {
    openPositions: 0,
    workingOrders: 0,
    weeklyPremium: 0,
    monthlyPremium: 0,
    winRate: 0,
  };

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
                  {accounts.map((account: any) => (
                    <SelectItem key={account.id} value={account.accountId}>
                      {account.nickname || account.accountNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccount && (
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
                <div className="flex flex-col flex-1">
                  <span className={cn(
                    "text-sm font-semibold transition-all duration-300",
                    isActive && "text-white"
                  )}>{item.name}</span>
                  <span className={cn(
                    "text-xs transition-all duration-300",
                    isActive && "text-amber-200",
                    !isActive && "text-muted-foreground"
                  )}>{item.description}</span>
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

      {/* Quick Stats Panel */}
      {!collapsed && (
        <div className="p-4">
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardContent className="p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Stats</div>
              
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                  Open Positions
                </span>
                <span className="font-semibold">{quickStats.openPositions}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Circle className="h-2 w-2 fill-yellow-500 text-yellow-500" />
                  Working Orders
                </span>
                <span className="font-semibold">{quickStats.workingOrders}</span>
              </div>

              <Separator className="bg-border/50 my-2" />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">This Week</span>
                <span className={cn("font-semibold", quickStats.weeklyPremium >= 0 ? "text-green-500" : "text-red-500")}>
                  {quickStats.weeklyPremium >= 0 ? '+' : '-'}${Math.abs(quickStats.weeklyPremium).toLocaleString()}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">This Month</span>
                <span className={cn("font-semibold", quickStats.monthlyPremium >= 0 ? "text-green-500" : "text-red-500")}>
                  {quickStats.monthlyPremium >= 0 ? '+' : '-'}${Math.abs(quickStats.monthlyPremium).toLocaleString()}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Win Rate</span>
                <span className="font-semibold">{quickStats.winRate}% ⭐</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator className="bg-border/50" />

      {/* Management Section */}
      {!collapsed && (
        <div className="px-4 py-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Management</div>
        </div>
      )}
      <div className="p-2">
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
      </div>
    </div>
  );
}
