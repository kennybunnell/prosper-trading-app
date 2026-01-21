import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import {
  BarChart3,
  TrendingDown,
  TrendingUp,
  Layers,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // Fetch Tastytrade accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.accounts.list.useQuery();
  const { data: credentials } = trpc.settings.getCredentials.useQuery();

  // Navigation items
  const navItems = [
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

  // Set default account if available
  if (credentials?.defaultTastytradeAccountId && !selectedAccountId && accounts) {
    setSelectedAccountId(credentials.defaultTastytradeAccountId);
  }

  return (
    <div
      className={cn(
        'flex flex-col h-screen bg-card/50 backdrop-blur-md border-r border-border/50 transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
        className
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        {!collapsed && (
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Prosper
          </h1>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <Separator className="bg-border/50" />

      {/* Account Selection */}
      {!collapsed && (
        <div className="p-4">
          <label className="text-xs text-muted-foreground mb-2 block">Trading Account</label>
          {accountsLoading ? (
            <div className="text-sm text-muted-foreground">Loading accounts...</div>
          ) : accounts && accounts.length > 0 ? (
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-full bg-background/50">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
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
          ) : (
            <div className="text-sm text-muted-foreground">
              No accounts found. <Link href="/settings" className="text-primary hover:underline">Configure settings</Link>
            </div>
          )}
        </div>
      )}

      <Separator className="bg-border/50" />

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;

          return (
            <Link key={item.path} href={item.path}>
              <a
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
                  'hover:bg-accent/50 hover:shadow-lg hover:shadow-primary/20',
                  isActive && 'bg-primary/20 text-primary shadow-lg shadow-primary/30',
                  !isActive && 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && (
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </div>
                )}
              </a>
            </Link>
          );
        })}
      </nav>

      <Separator className="bg-border/50" />

      {/* Settings Link */}
      <div className="p-2">
        <Link href="/settings">
          <a
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
              'hover:bg-accent/50 hover:shadow-lg hover:shadow-primary/20',
              location === '/settings' && 'bg-primary/20 text-primary shadow-lg shadow-primary/30',
              location !== '/settings' && 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Settings className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Settings</span>}
          </a>
        </Link>
      </div>
    </div>
  );
}
