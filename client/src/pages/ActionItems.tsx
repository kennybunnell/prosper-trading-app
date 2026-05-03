import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Zap, ShieldAlert } from "lucide-react";

// Import tab components from Performance page
import { ActivePositionsTab } from "./Performance";
import { WorkingOrdersTab } from "./Performance";

// Import Roll / Order modals (kept for Active Positions tab usage)
import { RollCandidateModal } from "@/components/RollCandidateModal";
import { OrderPreviewModal } from "@/components/OrderPreviewModal";
import { skipToken } from "@tanstack/react-query";

// Import Inbox page component
import Inbox from "./Inbox";

// Import AutomationDashboard
import AutomationDashboard from "./AutomationDashboard";

// Import Portfolio Safety tab
import { IraSafetyTab } from "@/components/IraSafetyTab";
import { PositionAnalyzerTab } from "@/components/PositionAnalyzerTab";

import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/contexts/AccountContext";
import { useTradingMode } from "@/contexts/TradingModeContext";

export default function ActionItems() {
  const { mode: tradingMode } = useTradingMode();
  const [activeTab, setActiveTab] = useState('automation');
  const { selectedAccountId } = useAccount();

  // Roll candidate modal state
  const [rollModalOpen, setRollModalOpen] = useState(false);
  const [selectedRollPosition, setSelectedRollPosition] = useState<any>(null);

  // Order preview modal state
  const [orderPreviewOpen, setOrderPreviewOpen] = useState(false);
  const [orderDetails, setOrderDetails] = useState<any>(null);

  const { toast } = useToast();

  // ── Portfolio Safety violation badge count ─────────────────────────────────
  // Only fetch when we're not already on the IRA tab (avoid double-fetching)
  const { data: iraSafetyData } = trpc.iraSafety.scanViolations.useQuery(
    undefined,
    {
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );
  const iraCriticalCount = iraSafetyData?.criticalCount ?? 0;
  const iraWarningCount = iraSafetyData?.warningCount ?? 0;
  const iraTotalCount = iraCriticalCount + iraWarningCount;

  // ── Roll candidates ──────────────────────────────────────────────────────────
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
    { staleTime: 1 * 60 * 1000 }
  );

  const handleViewOptions = (roll: any) => {
    setSelectedRollPosition(roll);
    setRollModalOpen(true);
  };

  const handleSelectCandidate = (candidate: any) => {
    if (!selectedRollPosition) return;

    const strategy = selectedRollPosition.strategy;
    const optionType = strategy === 'CSP' ? 'PUT' : 'CALL';

    const formatExpiration = (dateStr: string): string => {
      if (!dateStr) return new Date().toISOString().split('T')[0];
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
      return date.toISOString().split('T')[0];
    };

    const isCloseOnly = candidate.action === 'close';

    const orderDetailsPayload: any = {
      symbol: selectedRollPosition.symbol,
      strategy,
      isCloseOnly,
      closeLeg: {
        action: 'BTC',
        quantity: 1,
        strike: Number(selectedRollPosition.metrics.strikePrice) || 0,
        expiration: formatExpiration(selectedRollPosition.metrics.expiration),
        optionType,
        price: Math.abs(selectedRollPosition.metrics.currentValue || 0),
        optionSymbol: selectedRollPosition.optionSymbol,
      },
      netCost: candidate.netCredit || 0,
      currentProfit: (selectedRollPosition.metrics.openPremium || 0) - (selectedRollPosition.metrics.currentValue || 0),
    };

    if (!isCloseOnly) {
      orderDetailsPayload.openLeg = {
        action: 'STO',
        quantity: 1,
        strike: Number(candidate.strike) || 0,
        expiration: formatExpiration(candidate.expiration),
        optionType,
        price: candidate.newPremium || 0,
      };
      orderDetailsPayload.projectedProfit =
        (selectedRollPosition.metrics.openPremium || 0) -
        (selectedRollPosition.metrics.currentValue || 0) +
        (candidate.netCredit || 0) +
        (candidate.newPremium || 0);
    } else {
      orderDetailsPayload.projectedProfit = orderDetailsPayload.currentProfit;
    }

    setOrderDetails(orderDetailsPayload);
    setRollModalOpen(false);
    setOrderPreviewOpen(true);
  };

  // Order submission mutations
  const submitRollMutation = trpc.orders.submitRoll.useMutation({
    onSuccess: (data) => {
      toast({ title: "Order Submitted", description: `Roll order ${data.orderId} submitted to Tastytrade.` });
      setOrderPreviewOpen(false);
      setOrderDetails(null);
    },
    onError: (error) => {
      toast({ title: "Order Failed", description: error.message, variant: "destructive" });
    },
  });

  const submitCloseMutation = trpc.orders.submitClose.useMutation({
    onSuccess: (data) => {
      toast({ title: "Order Submitted", description: `Close order ${data.orderId} submitted to Tastytrade.` });
      setOrderPreviewOpen(false);
      setOrderDetails(null);
    },
    onError: (error) => {
      toast({ title: "Order Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleConfirmOrder = () => {
    if (!orderDetails) return;

    if (tradingMode === 'paper') {
      toast({
        title: "Paper Trading Mode",
        description: "Switch to Live Trading to submit orders.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedAccountId || selectedAccountId === 'ALL_ACCOUNTS') {
      toast({
        title: "Account Required",
        description: "Please select a specific account from the sidebar.",
        variant: "destructive",
      });
      return;
    }

    if (orderDetails.isCloseOnly) {
      submitCloseMutation.mutate({ accountNumber: selectedAccountId, symbol: orderDetails.symbol, closeLeg: orderDetails.closeLeg });
    } else {
      submitRollMutation.mutate({ accountNumber: selectedAccountId, symbol: orderDetails.symbol, closeLeg: orderDetails.closeLeg, openLeg: orderDetails.openLeg });
    }
  };

  return (
    <div className="container py-4 sm:py-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Action Items</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1 sm:mt-2">
          Automation, safety monitoring, and positions requiring attention
        </p>
      </div>

      {/* Tabs — 5 tabs: Automation | Portfolio Safety (badge) | Active Positions | Working Orders | Inbox */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        <TabsList className="grid w-full grid-cols-5 h-auto">
          <TabsTrigger value="automation" className="flex items-center gap-1 text-xs sm:text-sm sm:gap-1.5 px-1 sm:px-3">
            <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
            <span className="hidden xs:inline sm:inline">Automation</span>
            <span className="xs:hidden sm:hidden">Auto</span>
          </TabsTrigger>

          <TabsTrigger value="ira-safety" className="flex items-center gap-1 text-xs sm:text-sm sm:gap-1.5 px-1 sm:px-3 relative">
            <ShieldAlert className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
            <span className="hidden sm:inline">Portfolio Safety</span>
            <span className="sm:hidden">Safety</span>
            {iraTotalCount > 0 && (
              <Badge
                className={`ml-1 text-[10px] px-1.5 py-0 h-4 min-w-[1rem] ${
                  iraCriticalCount > 0
                    ? 'bg-red-600 hover:bg-red-600 text-white'
                    : 'bg-amber-600 hover:bg-amber-600 text-white'
                }`}
              >
                {iraTotalCount}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger value="active-positions" className="text-xs sm:text-sm px-1 sm:px-3">
            <span className="hidden sm:inline">Active Positions</span>
            <span className="sm:hidden">Positions</span>
          </TabsTrigger>
          <TabsTrigger value="working-orders" className="text-xs sm:text-sm px-1 sm:px-3">
            <span className="hidden sm:inline">Working Orders</span>
            <span className="sm:hidden">Orders</span>
          </TabsTrigger>
          <TabsTrigger value="inbox" className="text-xs sm:text-sm px-1 sm:px-3">Inbox</TabsTrigger>
        </TabsList>

        {/* Automation Tab */}
        <TabsContent value="automation" className="space-y-6">
          <AutomationDashboard />
        </TabsContent>

        {/* Portfolio Safety Tab — with sub-tabs */}
        <TabsContent value="ira-safety" className="space-y-0">
          <Tabs defaultValue="safety-monitor" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 max-w-sm">
              <TabsTrigger value="safety-monitor" className="text-xs">
                Safety Monitor
              </TabsTrigger>
              <TabsTrigger value="position-analyzer" className="text-xs">
                Position Analyzer
              </TabsTrigger>
            </TabsList>
            <TabsContent value="safety-monitor" className="space-y-6">
              <IraSafetyTab />
            </TabsContent>
            <TabsContent value="position-analyzer" className="space-y-6">
              <PositionAnalyzerTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Active Positions Tab */}
        <TabsContent value="active-positions" className="space-y-6">
          <ActivePositionsTab />
        </TabsContent>

        {/* Working Orders Tab */}
        <TabsContent value="working-orders" className="space-y-6">
          <WorkingOrdersTab />
        </TabsContent>

        {/* Inbox Tab */}
        <TabsContent value="inbox" className="space-y-6">
          <Inbox />
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
        isSubmitting={submitRollMutation.isPending || submitCloseMutation.isPending}
      />
    </div>
  );
}
