import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon, Moon, Sun } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";

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
            <Button variant="outline" onClick={logout}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 relative z-10">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* CSP Dashboard Card */}
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-primary/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                <CardTitle>Cash-Secured Puts</CardTitle>
              </div>
              <CardDescription>
                Analyze and execute CSP strategies with dual scoring system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Watchlist management</li>
                <li>• Option chain analysis</li>
                <li>• Smart recommendations</li>
                <li>• One-click order execution</li>
              </ul>
              <Button className="w-full mt-4" asChild>
                <Link href="/csp">Open Dashboard</Link>
              </Button>
            </CardContent>
          </Card>

          {/* CC Dashboard Card */}
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-blue-500" />
                <CardTitle>Covered Calls</CardTitle>
              </div>
              <CardDescription>
                Maximize returns on existing stock positions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Position analysis</li>
                <li>• CC opportunity scoring</li>
                <li>• Premium optimization</li>
                <li>• Risk management</li>
              </ul>
              <Button className="w-full mt-4" disabled>
                Coming Soon
              </Button>
            </CardContent>
          </Card>

          {/* PMCC Dashboard Card */}
          <Card className="hover:border-primary/50 transition-all duration-300 cursor-pointer backdrop-blur-sm bg-card/80 hover:shadow-lg hover:shadow-purple-500/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-purple-500" />
                <CardTitle>PMCC Strategy</CardTitle>
              </div>
              <CardDescription>
                Poor Man's Covered Call with LEAPS
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• LEAPS option scanning</li>
                <li>• Spread analysis</li>
                <li>• Notification alerts</li>
                <li>• Performance tracking</li>
              </ul>
              <Button className="w-full mt-4" disabled>
                Coming Soon
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Setup Notice */}
        <Card className="mt-8 border-yellow-500/50 bg-yellow-500/5 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-base">Setup Required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p className="mb-4">
              To start trading, you need to configure your API credentials in Settings:
            </p>
            <ul className="space-y-1 mb-4">
              <li>• Tastytrade API (for order execution)</li>
              <li>• Tradier API (for market data and option chains)</li>
            </ul>
            <Button asChild variant="outline">
              <Link href="/settings">
                <SettingsIcon className="h-4 w-4 mr-2" />
                Go to Settings
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
