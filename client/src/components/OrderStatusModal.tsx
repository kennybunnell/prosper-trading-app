import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import confetti from "canvas-confetti";
import { OrderSubmissionStatus } from "./UnifiedOrderPreviewModal";

// Re-export for convenience
export type { OrderSubmissionStatus };

interface OrderStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderStatuses: OrderSubmissionStatus[];
  onPollStatuses?: (orderIds: string[], accountId: string) => Promise<OrderSubmissionStatus[]>;
  accountId: string;
}

export function OrderStatusModal({
  open,
  onOpenChange,
  orderStatuses: initialStatuses,
  onPollStatuses,
  accountId,
}: OrderStatusModalProps) {
  const [orderStatuses, setOrderStatuses] = useState<OrderSubmissionStatus[]>(initialStatuses);
  const [isPolling, setIsPolling] = useState(false);
  const [hasPlayedCelebration, setHasPlayedCelebration] = useState(false);

  // Update statuses when prop changes
  useEffect(() => {
    setOrderStatuses(initialStatuses);
  }, [initialStatuses]);

  // Play confetti and sound for successful submissions
  useEffect(() => {
    if (open && !hasPlayedCelebration && orderStatuses.length > 0) {
      const hasSuccessfulOrders = orderStatuses.some(
        (status) => status.status === "Filled" || status.status === "Working" || status.status === "MarketClosed"
      );

      if (hasSuccessfulOrders) {
        // Play confetti
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });

        // Play cha-ching sound
        const audio = new Audio("/cha-ching.mp3");
        audio.volume = 0.5;
        audio.play().catch((err) => console.log("[OrderStatusModal] Audio play failed:", err));

        setHasPlayedCelebration(true);
      }
    }
  }, [open, orderStatuses, hasPlayedCelebration]);

  // Poll for order statuses if needed
  useEffect(() => {
    if (!open || !onPollStatuses || isPolling) return;

    const pendingOrders = orderStatuses.filter(
      (status) => status.status === "Pending" || status.status === "Working"
    );

    if (pendingOrders.length === 0) return;

    const pollStatuses = async () => {
      setIsPolling(true);
      try {
        const orderIds = pendingOrders.map((o) => o.orderId);
        const updatedStatuses = await onPollStatuses(orderIds, accountId);
        
        // Merge updated statuses with existing ones
        setOrderStatuses((prev) =>
          prev.map((status) => {
            const updated = updatedStatuses.find((u) => u.orderId === status.orderId);
            return updated || status;
          })
        );
      } catch (error) {
        console.error("[OrderStatusModal] Polling error:", error);
      } finally {
        setIsPolling(false);
      }
    };

    // Poll immediately
    pollStatuses();

    // Poll every 2 seconds
    const interval = setInterval(pollStatuses, 2000);

    return () => clearInterval(interval);
  }, [open, orderStatuses, onPollStatuses, accountId, isPolling]);

  // Reset celebration flag when modal closes
  useEffect(() => {
    if (!open) {
      setHasPlayedCelebration(false);
    }
  }, [open]);

  // Determine overall status
  const getOverallStatus = () => {
    if (orderStatuses.length === 0) return null;

    const allFilled = orderStatuses.every((s) => s.status === "Filled");
    const anyFailed = orderStatuses.some((s) => s.status === "Rejected" || s.status === "Cancelled");
    const allMarketClosed = orderStatuses.every((s) => s.status === "MarketClosed");
    const anyWorking = orderStatuses.some((s) => s.status === "Working");

    if (allFilled) return "Filled";
    if (anyFailed) return "PartialFailure";
    if (allMarketClosed) return "MarketClosed";
    if (anyWorking) return "Working";
    return "Pending";
  };

  const overallStatus = getOverallStatus();

  // Get status icon and color
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "Filled":
        return {
          icon: <CheckCircle2 className="w-5 h-5" />,
          color: "text-green-500",
          bg: "bg-green-500/10",
        };
      case "Working":
      case "Pending":
        return {
          icon: <Clock className="w-5 h-5" />,
          color: "text-blue-500",
          bg: "bg-blue-500/10",
        };
      case "MarketClosed":
        return {
          icon: <AlertCircle className="w-5 h-5" />,
          color: "text-yellow-500",
          bg: "bg-yellow-500/10",
        };
      case "Rejected":
        return {
          icon: <XCircle className="w-5 h-5" />,
          color: "text-red-500",
          bg: "bg-red-500/10",
        };
      default:
        return {
          icon: <Clock className="w-5 h-5" />,
          color: "text-gray-500",
          bg: "bg-gray-500/10",
        };
    }
  };

  const overallDisplay = overallStatus ? getStatusDisplay(overallStatus) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-2 border-orange-500/50">
        <DialogHeader>
          <DialogTitle className="text-2xl">Order Submission Results</DialogTitle>
        </DialogHeader>

        {/* Overall Status Banner */}
        {overallDisplay && (
          <div className={`flex items-center gap-3 p-4 rounded-lg ${overallDisplay.bg} border border-${overallDisplay.color.replace('text-', '')}/20`}>
            <div className={overallDisplay.color}>{overallDisplay.icon}</div>
            <div className="flex-1">
              <div className="font-semibold">
                {overallStatus === "Filled" && "All Orders Filled"}
                {overallStatus === "Working" && "Orders Submitted - Working"}
                {overallStatus === "MarketClosed" && "Orders Queued - Market Closed"}
                {overallStatus === "PartialFailure" && "Some Orders Failed"}
                {overallStatus === "Pending" && "Processing Orders..."}
              </div>
              <div className="text-sm text-muted-foreground">
                {overallStatus === "Filled" && "Your orders have been successfully filled"}
                {overallStatus === "Working" && "Your orders are being processed by the exchange"}
                {overallStatus === "MarketClosed" && "Orders will be processed when the market opens"}
                {overallStatus === "PartialFailure" && "Some orders were rejected - check details below"}
                {overallStatus === "Pending" && "Please wait while we check order statuses"}
              </div>
            </div>
          </div>
        )}

        {/* Order List */}
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {orderStatuses.map((status, index) => {
            const display = getStatusDisplay(status.status);
            return (
              <div
                key={index}
                className={`flex items-start gap-3 p-3 rounded-lg ${display.bg} border border-${display.color.replace('text-', '')}/20`}
              >
                <div className={`mt-0.5 ${display.color}`}>{display.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{status.symbol}</span>
                    <span className={`text-sm ${display.color}`}>{status.status}</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">{status.message}</div>
                  {status.orderId && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Order ID: {status.orderId}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-green-600 hover:bg-green-700 text-white w-full"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
