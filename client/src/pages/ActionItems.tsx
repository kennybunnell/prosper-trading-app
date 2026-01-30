import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, TrendingUp, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

// Import tab components from Performance page
import { ActivePositionsTab } from "./Performance";
import { WorkingOrdersTab } from "./Performance";

// Import RollCandidateModal and OrderPreviewModal
import { RollCandidateModal } from "@/components/RollCandidateModal";
import { OrderPreviewModal } from "@/components/OrderPreviewModal";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/contexts/AccountContext";

export default function ActionItems() {
  const [activeTab, setActiveTab] = useState('daily-tasks');
  const [, setLocation] = useLocation();
  const { selectedAccountId } = useAccount();
  
  // Roll candidate modal state
  const [rollModalOpen, setRollModalOpen] = useState(false);
  const [selectedRollPosition, setSelectedRollPosition] = useState<any>(null);
  
  // Order preview modal state
  const [orderPreviewOpen, setOrderPreviewOpen] = useState(false);
  const [orderDetails, setOrderDetails] = useState<any>(null);
  
  const { toast } = useToast();
  
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

  // Fetch rolls data (filtered by selected account)
  const { data: rollsData, isLoading: rollsLoading } = trpc.rolls.getRollsNeeded.useQuery(
    selectedAccountId && selectedAccountId !== 'ALL_ACCOUNTS' 
      ? { accountId: selectedAccountId }
      : skipToken,
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 3,
    }
  );

  const rollsRed = rollsData?.red || [];
  const rollsYellow = rollsData?.yellow || [];
  const rollsGreen = rollsData?.green || [];
  const rollsTotal = rollsData?.total || 0;
  
  // Fetch roll candidates when a position is selected
  const { data: rollCandidatesData, isLoading: candidatesLoading } = trpc.rolls.getRollCandidates.useQuery(
    selectedRollPosition && rollModalOpen
      ? {
          positionId: selectedRollPosition.positionId,
          symbol: selectedRollPosition.symbol,
          strategy: selectedRollPosition.strategy.toLowerCase() as 'csp' | 'cc',
          strikePrice: selectedRollPosition.metrics.strikePrice,
          expirationDate: selectedRollPosition.metrics.expiration || new Date().toISOString(),
          currentValue: Math.abs(selectedRollPosition.metrics.currentValue || 0),
          openPremium: Math.abs(selectedRollPosition.metrics.openPremium || 0),
        }
      : skipToken,
    {
      staleTime: 1 * 60 * 1000, // 1 minute
    }
  );
  
  const handleViewOptions = (roll: any) => {
    setSelectedRollPosition(roll);
    setRollModalOpen(true);
  };
  
  const handleSelectCandidate = (candidate: any) => {
    if (!selectedRollPosition) return;
    
    // Build order details for preview modal
    const strategy = selectedRollPosition.strategy;
    const optionType = strategy === 'CSP' ? 'PUT' : 'CALL';
    const closeAction = strategy === 'CSP' ? 'BTC' : 'BTC'; // Buy to close for both
    const openAction = strategy === 'CSP' ? 'STO' : 'STO'; // Sell to open for both
    
    // Format expiration dates to YYYY-MM-DD format
    const formatExpiration = (dateStr: string): string => {
      if (!dateStr) return new Date().toISOString().split('T')[0];
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
      return date.toISOString().split('T')[0];
    };
    
    const orderDetailsPayload = {
      symbol: selectedRollPosition.symbol,
      strategy: strategy,
      closeLeg: {
        action: closeAction,
        quantity: 1,
        strike: Number(selectedRollPosition.metrics.strikePrice) || 0,
        expiration: formatExpiration(selectedRollPosition.metrics.expiration),
        optionType: optionType,
        price: Math.abs(selectedRollPosition.metrics.currentValue || 0),
      },
      openLeg: {
        action: openAction,
        quantity: 1,
        strike: Number(candidate.strike) || 0,
        expiration: formatExpiration(candidate.expiration),
        optionType: optionType,
        price: candidate.newPremium || 0,
      },
      netCost: candidate.netCredit || 0,
      currentProfit: (selectedRollPosition.metrics.openPremium || 0) - (selectedRollPosition.metrics.currentValue || 0),
      projectedProfit: (selectedRollPosition.metrics.openPremium || 0) - (selectedRollPosition.metrics.currentValue || 0) + (candidate.netCredit || 0) + (candidate.newPremium || 0),
    };
    
    setOrderDetails(orderDetailsPayload);
    setRollModalOpen(false);
    setOrderPreviewOpen(true);
  };
  
  // Order submission mutation
  const submitOrderMutation = trpc.orders.submitRoll.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Order Submitted Successfully",
        description: `Roll order ${data.orderId} has been submitted to Tastytrade.`,
      });
      setOrderPreviewOpen(false);
      setOrderDetails(null);
      // Refresh positions
      // TODO: Add refetch logic
    },
    onError: (error) => {
      toast({
        title: "Order Submission Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const handleConfirmOrder = () => {
    if (!orderDetails) return;
    
    // Get account number from selected account
    if (!selectedAccountId || selectedAccountId === 'ALL_ACCOUNTS') {
      toast({
        title: "No Account Selected",
        description: "Please select a specific account from the sidebar before submitting orders.",
        variant: "destructive",
      });
      return;
    }
    
    const accountNumber = selectedAccountId;
    
    submitOrderMutation.mutate({
      accountNumber,
      symbol: orderDetails.symbol,
      closeLeg: orderDetails.closeLeg,
      openLeg: orderDetails.openLeg,
    });
  };

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
          {/* Account Selection Prompt */}
          {(!selectedAccountId || selectedAccountId === 'ALL_ACCOUNTS') && (
            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <AlertCircle className="h-8 w-8 text-amber-500 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-lg mb-1">Select an Account</h3>
                    <p className="text-sm text-muted-foreground">
                      Please select a specific account from the sidebar to view roll opportunities and action items for that account.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {selectedAccountId && selectedAccountId !== 'ALL_ACCOUNTS' && (
            <>
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
                <div className="text-2xl font-bold">{rollsTotal}</div>
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
                <div className="text-2xl font-bold">{readyToClose.length + rollsTotal}</div>
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

          {/* Rolls Needed */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Positions Needing Rolls</CardTitle>
                  <CardDescription>
                    Based on 7/14 DTE thresholds and 80% profit rule
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rollsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading roll analysis...</div>
              ) : rollsTotal === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-2 opacity-50 text-green-500" />
                  <p>No positions need rolling at this time</p>
                  <p className="text-sm mt-1">All positions are within healthy parameters</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Red (Urgent) Positions */}
                  {rollsRed.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-3 w-3 rounded-full bg-red-500" />
                        <h3 className="font-semibold text-red-600">Urgent ({rollsRed.length})</h3>
                        <span className="text-sm text-muted-foreground">- Act today</span>
                      </div>
                      <div className="space-y-2">
                        {rollsRed.map((roll: any) => (
                          <div
                            key={roll.positionId}
                            className="flex items-center justify-between p-4 border border-red-200 bg-red-50/50 rounded-lg hover:bg-red-50 cursor-pointer transition-colors"
                          >
                            <div className="flex-1">
                              <div className="font-semibold">{roll.symbol} {roll.strategy.toUpperCase()}</div>
                              <div className="text-sm text-muted-foreground">
                                ${roll.metrics.strikePrice} strike • {roll.metrics.dte} DTE
                              </div>
                              <div className="text-xs text-red-600 mt-1 space-y-0.5">
                                {roll.reasons.map((reason: string, idx: number) => (
                                  <div key={idx}>{reason}</div>
                                ))}
                              </div>
                            </div>
                            <div className="text-right mr-4">
                              <div className="text-sm font-medium">{roll.metrics.profitCaptured.toFixed(0)}% profit</div>
                              <div className="text-xs text-muted-foreground">Score: {roll.score}</div>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => handleViewOptions(roll)}>
                              View Options
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Yellow (Watch) Positions */}
                  {rollsYellow.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-3 w-3 rounded-full bg-yellow-500" />
                        <h3 className="font-semibold text-yellow-600">Watch ({rollsYellow.length})</h3>
                        <span className="text-sm text-muted-foreground">- Plan action</span>
                      </div>
                      <div className="space-y-2">
                        {rollsYellow.map((roll: any) => (
                          <div
                            key={roll.positionId}
                            className="flex items-center justify-between p-4 border border-yellow-200 bg-yellow-50/50 rounded-lg hover:bg-yellow-50 cursor-pointer transition-colors"
                          >
                            <div className="flex-1">
                              <div className="font-semibold">{roll.symbol} {roll.strategy.toUpperCase()}</div>
                              <div className="text-sm text-muted-foreground">
                                ${roll.metrics.strikePrice} strike • {roll.metrics.dte} DTE
                              </div>
                              <div className="text-xs text-yellow-600 mt-1 space-y-0.5">
                                {roll.reasons.map((reason: string, idx: number) => (
                                  <div key={idx}>{reason}</div>
                                ))}
                              </div>
                            </div>
                            <div className="text-right mr-4">
                              <div className="text-sm font-medium">{roll.metrics.profitCaptured.toFixed(0)}% profit</div>
                              <div className="text-xs text-muted-foreground">Score: {roll.score}</div>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => handleViewOptions(roll)}>
                              View Options
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Green (Healthy) Positions - Only show if no red/yellow */}
                  {rollsRed.length === 0 && rollsYellow.length === 0 && rollsGreen.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                        <h3 className="font-semibold text-green-600">Healthy ({rollsGreen.length})</h3>
                        <span className="text-sm text-muted-foreground">- Monitor</span>
                      </div>
                      <div className="space-y-2">
                        {rollsGreen.slice(0, 5).map((roll: any) => (
                          <div
                            key={roll.positionId}
                            className="flex items-center justify-between p-4 border border-green-200 bg-green-50/50 rounded-lg"
                          >
                            <div className="flex-1">
                              <div className="font-semibold">{roll.symbol} {roll.strategy.toUpperCase()}</div>
                              <div className="text-sm text-muted-foreground">
                                ${roll.metrics.strikePrice} strike • {roll.metrics.dte} DTE
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-medium">{roll.metrics.profitCaptured.toFixed(0)}% profit</div>
                              <div className="text-xs text-muted-foreground">Score: {roll.score}</div>
                            </div>
                          </div>
                        ))}
                        {rollsGreen.length > 5 && (
                          <div className="text-center text-sm text-muted-foreground pt-2">
                            +{rollsGreen.length - 5} more healthy positions
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          </>
          )}
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
      
      {/* Roll Candidate Modal */}
      {selectedRollPosition && (
      <RollCandidateModal
        open={rollModalOpen}
        onOpenChange={setRollModalOpen}
        position={{
          symbol: selectedRollPosition?.symbol || '',
          strategy: selectedRollPosition?.strategy || '',
          strikePrice: selectedRollPosition?.metrics?.strikePrice || 0,
          expiration: selectedRollPosition?.metrics?.expiration || new Date().toISOString(),
          dte: selectedRollPosition?.metrics?.dte || 0,
          profitCaptured: selectedRollPosition?.metrics?.profitCaptured,
          itmDepth: selectedRollPosition?.metrics?.itmDepth,
          delta: selectedRollPosition?.metrics?.delta,
          currentValue: selectedRollPosition?.metrics?.currentValue,
          openPremium: selectedRollPosition?.metrics?.openPremium,
        }}
        candidates={rollCandidatesData?.candidates || []}
        isLoading={candidatesLoading}
        onSelectCandidate={handleSelectCandidate}
      />
      )}
      
      {/* Order Preview Modal */}
      <OrderPreviewModal
        open={orderPreviewOpen}
        onOpenChange={setOrderPreviewOpen}
        orderDetails={orderDetails}
        onConfirm={handleConfirmOrder}
        isSubmitting={submitOrderMutation.isPending}
      />
    </div>
  );
}
