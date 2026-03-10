import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon, Moon, Sun } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { MonthlyPremiumChart } from "@/components/MonthlyPremiumChart";
import { PortfolioAdvisorSummary } from "@/components/PortfolioAdvisorSummary";
import { MarketNewsScanner } from "@/components/MarketNewsScanner";

function MonthlyPremiumChartSection() {
  const [selectedYear, setSelectedYear] = React.useState<number | undefined>(new Date().getFullYear());
  const { data, isLoading, error } = trpc.dashboard.getMonthlyPremiumData.useQuery(
    selectedYear ? { year: selectedYear } : undefined,
    {
      retry: false, // Don't retry if Tastytrade credentials are missing
      refetchOnWindowFocus: false, // Don't refetch when switching tabs
    }
  );
  
  // Debug logging
  React.useEffect(() => {
    if (data?.monthlyData) {
      console.log('[MonthlyPremiumChart] Data received:', JSON.stringify(data.monthlyData, null, 2));
    }
  }, [data]);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (error || !data || data.error) {
    // Show placeholder message instead of hiding chart
    return (
      <Card className="p-6 bg-card/70 backdrop-blur-sm border-border/30">
        <h2 className="text-2xl font-bold text-foreground mb-4">Monthly Premium Earnings - All Accounts Combined</h2>
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-lg">No premium data available</p>
            <p className="text-sm">Configure your Tastytrade credentials in Settings to view your monthly premium earnings</p>
          </div>
        </div>
      </Card>
    );
  }
  
  if (data.monthlyData.length === 0) {
    // Show placeholder for empty data
    return (
      <Card className="p-6 bg-card/70 backdrop-blur-sm border-border/30">
        <h2 className="text-2xl font-bold text-foreground mb-4">Monthly Premium Earnings - All Accounts Combined</h2>
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <p className="text-lg">No trading activity found for the selected period</p>
        </div>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Monthly Premium Earnings - All Accounts Combined</h2>
        <select
          value={selectedYear || 'all'}
          onChange={(e) => setSelectedYear(e.target.value === 'all' ? undefined : Number(e.target.value))}
          className="px-4 py-2 rounded-md border border-border bg-background text-foreground"
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

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  // Fetch user's background texture preferences
  const { data: backgroundPrefs } = trpc.settings.getBackgroundPreferences.useQuery();
  const backgroundOpacity = backgroundPrefs?.opacity ?? 8;
  const backgroundPattern = backgroundPrefs?.pattern ?? 'diagonal';
  
  // Generate CSS pattern based on user's selection
  const getPatternCSS = (pattern: string) => {
    switch (pattern) {
      case 'diagonal':
        return `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.03) 10px,
          rgba(255, 255, 255, 0.03) 20px
        )`;
      case 'crosshatch':
        return `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.03) 10px,
          rgba(255, 255, 255, 0.03) 20px
        ), repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.03) 10px,
          rgba(255, 255, 255, 0.03) 20px
        )`;
      case 'dots':
        return `radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1px)`;
      case 'woven':
        return `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, 0.02) 2px,
          rgba(255, 255, 255, 0.02) 4px
        ), repeating-linear-gradient(
          90deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, 0.02) 2px,
          rgba(255, 255, 255, 0.02) 4px
        )`;
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
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">Prosper Trading</CardTitle>
            <CardDescription className="text-base mt-2">
              Professional options trading dashboard with intelligent scoring and automated execution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
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
      {/* Background texture pattern */}
      {backgroundPattern !== 'none' && (
        <div 
          className="absolute inset-0 pointer-events-none" 
          style={{
            backgroundImage: getPatternCSS(backgroundPattern),
            backgroundSize: backgroundPattern === 'dots' ? '20px 20px' : 'auto',
            opacity: backgroundOpacity / 100
          }}
        />
      )}
      {/* Header */}
      <header className="border-b border-border relative z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Prosper Trading</h1>
            <p className="text-sm text-muted-foreground">Welcome back, {user?.email || user?.name}</p>
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
            <Button variant="outline" onClick={logout}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 relative z-10">
        {/* Monthly Premium Chart - All Accounts Combined */}
        <MonthlyPremiumChartSection />
        
        {/* Market Pulse — Market News & Risk Alerts */}
        <div className="mt-8">
          <MarketNewsScanner />
        </div>
      </main>
    </div>
  );
}
