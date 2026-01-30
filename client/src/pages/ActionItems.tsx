import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, TrendingUp, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

// Import tab components from Performance page
import { ActivePositionsTab } from "./Performance";
import { WorkingOrdersTab } from "./Performance";

export default function ActionItems() {
  const [activeTab, setActiveTab] = useState('daily-tasks');
  const [, setLocation] = useLocation();
  
  const { data: positionsData, isLoading: positionsLoading } = trpc.stockBasis.getStockPositions.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
  });

  const positions = positionsData?.positions || [];

  // Calculate positions ready to close (80%+ profit)
  const readyToClose = positions.filter((pos: any) => {
    if (!pos.daysInTrade || pos.daysInTrade === 0) return false;
    const profitPercent = (pos.profitLoss / Math.abs(pos.costBasis)) * 100;
    return profitPercent >= 80;
  }) || [];

  // Placeholder for rolls (to be implemented after research)
  const rollsNeeded = [];

  return (
    <div className="container py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Action Items</h1>
        <p className="text-muted-foreground mt-2">
          Daily tasks and positions requiring attention
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="daily-tasks">Daily Tasks</TabsTrigger>
          <TabsTrigger value="active-positions">Active Positions</TabsTrigger>
          <TabsTrigger value="working-orders">Working Orders</TabsTrigger>
        </TabsList>

        {/* Daily Tasks Tab */}
        <TabsContent value="daily-tasks" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Ready to Close</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{readyToClose.length}</div>
                <p className="text-xs text-muted-foreground">
                  Positions at 80%+ profit
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Rolls Needed</CardTitle>
                <RefreshCw className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{rollsNeeded.length}</div>
                <p className="text-xs text-muted-foreground">
                  Positions to roll
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Actions</CardTitle>
                <TrendingUp className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{readyToClose.length + rollsNeeded.length}</div>
                <p className="text-xs text-muted-foreground">
                  Items requiring attention
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Positions Ready to Close */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Positions Ready to Close (80%+ Profit)</CardTitle>
                  <CardDescription>
                    These positions have reached 80% or more of maximum profit
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setActiveTab("active-positions")}
                >
                  View All Positions
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {positionsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading positions...</div>
              ) : readyToClose.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No positions ready to close at this time
                </div>
              ) : (
                <div className="space-y-3">
                  {readyToClose.map((pos: any, idx: number) => {
                    const profitPercent = (pos.profitLoss / Math.abs(pos.costBasis)) * 100;
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                        onClick={() => setActiveTab("active-positions")}
                      >
                        <div className="flex-1">
                          <div className="font-semibold">{pos.symbol}</div>
                          <div className="text-sm text-muted-foreground">
                            {pos.instrumentType} • {pos.daysInTrade} days in trade
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-green-600">
                            {profitPercent.toFixed(1)}% profit
                          </div>
                          <div className="text-sm text-muted-foreground">
                            ${pos.profitLoss.toFixed(2)}
                          </div>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-green-500 ml-4" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rolls Needed - Placeholder */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Rolls Needed</CardTitle>
                  <CardDescription>
                    Positions that may need to be rolled (coming soon)
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  disabled
                >
                  View Rolls
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Roll detection criteria under development</p>
                <p className="text-sm mt-1">Research phase in progress</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Active Positions Tab */}
        <TabsContent value="active-positions" className="space-y-6">
          <ActivePositionsTab />
        </TabsContent>

        {/* Working Orders Tab */}
        <TabsContent value="working-orders" className="space-y-6">
          <WorkingOrdersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
