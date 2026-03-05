import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivePositionsTab, WorkingOrdersTab } from './Performance';
import { IraSafetyTab } from '@/components/IraSafetyTab';
import {
  Grid3X3,
  Activity,
  ShieldCheck,
  ListOrdered,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  RefreshCw,
  BarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Placeholder Heat Map ─────────────────────────────────────────────────────
// Phase 1 build: this will be replaced with the live Greeks-aggregated heat map.
function HeatMapPlaceholder() {
  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Grid3X3 className="w-5 h-5 text-amber-400" />
            Portfolio Heat Map
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
              Coming in Phase 1
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" disabled>
              <BarChart2 className="w-3.5 h-3.5" />
              Delta View
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" disabled>
              <TrendingUp className="w-3.5 h-3.5" />
              Theta View
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-dashed border-border/60 bg-background/30 p-8 text-center space-y-3">
          <Grid3X3 className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <div>
            <p className="text-sm font-medium text-foreground">Portfolio Heat Map</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Each cell represents a ticker in your portfolio, color-coded by net delta (green = long bias, red = short bias)
              and sized by premium at risk. Toggle to Theta View to see daily income distribution.
            </p>
          </div>
          <div className="flex items-center justify-center gap-6 pt-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-3 h-3 rounded bg-green-500/70" />
              Long delta
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-3 h-3 rounded bg-slate-400/40" />
              Neutral
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-3 h-3 rounded bg-red-500/70" />
              Short delta
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Portfolio Stat Bar ───────────────────────────────────────────────────────
function PortfolioStatBar() {
  const { user } = useAuth();
  // Phase 1: these will be live from the Greeks aggregation endpoint.
  // For now, show the structure with placeholder values.
  const stats = [
    {
      label: 'Net Delta',
      value: '—',
      sub: 'Portfolio directional bias',
      icon: Activity,
      color: 'text-muted-foreground',
    },
    {
      label: 'Daily Theta',
      value: '—',
      sub: 'Expected daily decay income',
      icon: TrendingUp,
      color: 'text-green-400',
    },
    {
      label: 'Net Vega',
      value: '—',
      sub: 'IV sensitivity (crash risk)',
      icon: TrendingDown,
      color: 'text-blue-400',
    },
    {
      label: 'Max Concentration',
      value: '—',
      sub: 'Largest single-ticker %',
      icon: AlertTriangle,
      color: 'text-amber-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(stat => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="bg-card/50 backdrop-blur border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={cn('text-2xl font-bold mt-0.5', stat.color)}>{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-accent/50 flex items-center justify-center">
                  <Icon className={cn('w-4 h-4', stat.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PortfolioCommandCenter() {
  const [activeTab, setActiveTab] = useState('heatmap');

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent">
            Portfolio Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time risk posture, Greeks aggregation, and position overview
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Portfolio Stat Bar */}
      <PortfolioStatBar />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="heatmap" className="flex items-center gap-1.5 text-xs">
            <Grid3X3 className="w-3.5 h-3.5" />
            Heat Map
          </TabsTrigger>
          <TabsTrigger value="positions" className="flex items-center gap-1.5 text-xs">
            <ListOrdered className="w-3.5 h-3.5" />
            Open Positions
          </TabsTrigger>
          <TabsTrigger value="orders" className="flex items-center gap-1.5 text-xs">
            <Activity className="w-3.5 h-3.5" />
            Working Orders
          </TabsTrigger>
          <TabsTrigger value="safety" className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            Risk Monitor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="heatmap" className="space-y-4">
          <HeatMapPlaceholder />
        </TabsContent>

        <TabsContent value="positions">
          <ActivePositionsTab />
        </TabsContent>

        <TabsContent value="orders">
          <WorkingOrdersTab />
        </TabsContent>

        <TabsContent value="safety">
          <IraSafetyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
