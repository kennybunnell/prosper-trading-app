import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Minus, Plus, AlertCircle, CheckCircle2, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Order interface - flexible for all strategies
export interface UnifiedOrder {
  symbol: string;
  strike: number;
  expiration: string;
  premium: number;
  action: string; // "STO", "BTC", "BTO", "STC"
  optionType: "CALL" | "PUT";
  
  // Optional fields for spreads
  longStrike?: number;
  longPremium?: number;
  
  // Optional fields for validation
  bid?: number;
  ask?: number;
  currentPrice?: number;
  
  // Optional fields for replace mode
  oldPrice?: number;      // Original order price (for comparison)
  oldOrderId?: string;    // Original order ID (for tracking)
}

// Holding interface for stock ownership validation (CC strategy)
export interface Holding {
  symbol: string;
  quantity: number; // Number of shares owned
  maxContracts: number; // quantity / 100
}

// Validation error interface
export interface ValidationError {
  symbol: string;
  message: string;
  severity: "error" | "warning";
}

// Order status after submission
export interface OrderSubmissionStatus {
  orderId: string;
  symbol: string;
  status: 'Filled' | 'Working' | 'Cancelled' | 'Rejected' | 'MarketClosed' | 'Pending';
  message?: string;
}

export interface UnifiedOrderPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  
  // Order data
  orders: UnifiedOrder[];
  strategy: "csp" | "cc" | "bcs" | "bps" | "pmcc" | "btc" | "roll" | "replace";
  
  // Account context
  accountId: string;
  availableBuyingPower: number;
  holdings?: Holding[]; // Required for CC validation
  
  // Callbacks
  onSubmit: (orders: UnifiedOrder[], quantities: Map<string, number>, isDryRun: boolean) => Promise<{ results: any[] }>;
  onPollStatuses?: (orderIds: string[], accountId: string) => Promise<OrderSubmissionStatus[]>; // Callback for parent to poll order statuses
  
  // Replace mode specific
  operationMode?: "new" | "replace";  // Default: "new"
  oldOrderIds?: string[];              // Old order IDs to cancel (for replace mode)
  onReplaceSubmit?: (                  // Replace-specific callback
    orders: UnifiedOrder[],
    quantities: Map<string, number>,
    oldOrderIds: string[],
    isDryRun: boolean
  ) => Promise<{ successCount: number; failedCount: number; results: any[] }>;
  
  // Optional
  defaultQuantities?: Map<string, number>;
  allowQuantityEdit?: boolean; // False for closing orders (default: true)
  tradingMode?: "live" | "paper";
  
  // Lifted state for persistence across re-renders
  submissionComplete?: boolean;
  finalOrderStatus?: string | null;
  onSubmissionStateChange?: (complete: boolean, status: string | null) => void;
}

export function UnifiedOrderPreviewModal({
  open,
  onOpenChange,
  orders,
  strategy,
  accountId,
  availableBuyingPower,
  holdings = [],
  onSubmit,
  onPollStatuses,
  operationMode = "new",
  oldOrderIds = [],
  onReplaceSubmit,
  defaultQuantities,
  allowQuantityEdit = true,
  tradingMode = "live",
  submissionComplete: externalSubmissionComplete,
  finalOrderStatus: externalFinalOrderStatus,
  onSubmissionStateChange,
}: UnifiedOrderPreviewModalProps) {
  const { toast } = useToast();
  
  // State
  const [dryRunSuccess, setDryRunSuccess] = useState(false);
  const [orderQuantities, setOrderQuantities] = useState<Map<string, number>>(new Map());
  const [adjustedPrices, setAdjustedPrices] = useState<Map<string, number>>(new Map());
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [orderStatuses, setOrderStatuses] = useState<OrderSubmissionStatus[]>([]);
  const [showMarketClosedWarning, setShowMarketClosedWarning] = useState(false);
  const [marketStatus, setMarketStatus] = useState<{ isOpen: boolean; description: string } | null>(null);
  
  // Use external state if provided, otherwise use internal state (for backward compatibility)
  const submissionComplete = externalSubmissionComplete ?? false;
  const finalOrderStatus = externalFinalOrderStatus ?? null;
  
  // Helper to update submission state (calls parent callback if provided)
  const setSubmissionState = (complete: boolean, status: string | null) => {
    if (onSubmissionStateChange) {
      onSubmissionStateChange(complete, status);
    }
  };
  
  // Track previous open state to detect modal opening
  const prevOpenRef = useRef(false);
  
  // Reset submission state when modal opens (only if using external state)
  // BUT do NOT reset if submission is already complete
  useEffect(() => {
    const isOpening = open && !prevOpenRef.current;
    if (isOpening && onSubmissionStateChange && !submissionComplete) {
      setSubmissionState(false, null);
    }
  }, [open, submissionComplete]);
  
  // Initialize quantities from defaults or set to 1
  useEffect(() => {
    // Only reset state when modal transitions from closed to open
    const isOpening = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    
    // Do NOT reset if submission is already complete (prevents reset after live submission)
    if (isOpening && orders.length > 0 && !submissionComplete) {
      const initialQuantities = new Map<string, number>();
      orders.forEach(order => {
        const key = getOrderKey(order);
        const defaultQty = defaultQuantities?.get(key) || 1;
        initialQuantities.set(key, defaultQty);
      });
      setOrderQuantities(initialQuantities);
      
      // Initialize prices to midpoint
      const initialPrices = new Map<string, number>();
      orders.forEach(order => {
        const key = getOrderKey(order);
        // For spreads (bid=0, ask=0), use premium directly; otherwise calculate midpoint
        if (order.bid && order.ask && order.bid > 0 && order.ask > 0) {
          initialPrices.set(key, (order.bid + order.ask) / 2);
        } else {
          initialPrices.set(key, order.premium);
        }
      });
      setAdjustedPrices(initialPrices);
      
      // Reset dry run success, polling state, and submission complete when modal FIRST opens
      // BUT only if submission is NOT already complete
      setDryRunSuccess(false);
      setIsPolling(false);
      setOrderStatuses([]);
      setSubmissionState(false, null);
    }
  }, [open, submissionComplete]); // Check submissionComplete to prevent reset after live submission
  
  // Real-time validation whenever quantities change
  useEffect(() => {
    if (open) {
      const errors = validateOrders();
      setValidationErrors(errors);
    }
  }, [orderQuantities, open]);
  
  // Helper: Generate unique key for each order
  const getOrderKey = (order: UnifiedOrder): string => {
    return `${order.symbol}-${order.strike}-${order.expiration}`;
  };
  
  // Get quantity for an order
  const getQuantity = (order: UnifiedOrder): number => {
    return orderQuantities.get(getOrderKey(order)) || 1;
  };
  
  // Set quantity for an order
  const setQuantity = (order: UnifiedOrder, qty: number) => {
    const key = getOrderKey(order);
    const maxQty = getMaxQuantity(order);
    const validQty = Math.max(1, Math.min(qty, maxQty));
    setOrderQuantities(prev => new Map(prev).set(key, validQty));
  };
  
  // Increment quantity
  const incrementQuantity = (order: UnifiedOrder) => {
    const currentQty = getQuantity(order);
    setQuantity(order, currentQty + 1);
  };
  
  // Decrement quantity
  const decrementQuantity = (order: UnifiedOrder) => {
    const currentQty = getQuantity(order);
    if (currentQty > 1) {
      setQuantity(order, currentQty - 1);
    }
  };
  
  // Calculate max quantity based on strategy
  const getMaxQuantity = (order: UnifiedOrder): number => {
    switch (strategy) {
      case "cc": {
        // Covered calls: limited by stock ownership
        const holding = holdings.find(h => h.symbol === order.symbol);
        if (!holding) return 0;
        
        // How many contracts already allocated for this symbol?
        const usedContracts = Array.from(orderQuantities.entries())
          .filter(([key]) => key.startsWith(`${order.symbol}-`))
          .reduce((sum, [_, qty]) => sum + qty, 0);
        
        const currentOrderQty = getQuantity(order);
        return holding.maxContracts - usedContracts + currentOrderQty;
      }
      
      case "csp": {
        // Cash-secured puts: limited by buying power
        const collateralPerContract = order.strike * 100;
        const currentTotalCollateral = calculateTotalCollateral();
        const thisOrderCollateral = getQuantity(order) * collateralPerContract;
        const remainingBP = availableBuyingPower - (currentTotalCollateral - thisOrderCollateral);
        
        return Math.floor(remainingBP / collateralPerContract);
      }
      
      case "bcs":
      case "bps": {
        // Spreads: limited by spread collateral
        if (!order.longStrike) return 0;
        const spreadWidth = Math.abs(order.strike - order.longStrike);
        const collateralPerContract = spreadWidth * 100;
        const currentTotalCollateral = calculateTotalCollateral();
        const thisOrderCollateral = getQuantity(order) * collateralPerContract;
        const remainingBP = availableBuyingPower - (currentTotalCollateral - thisOrderCollateral);
        
        return Math.floor(remainingBP / collateralPerContract);
      }
      
      case "pmcc": {
        // PMCC (buying LEAPs): limited by buying power
        const costPerContract = order.premium * 100;
        const currentTotalCost = calculateTotalPremium();
        const thisOrderCost = getQuantity(order) * costPerContract;
        const remainingBP = availableBuyingPower - (currentTotalCost - thisOrderCost);
        
        return Math.floor(remainingBP / costPerContract);
      }
      
      case "btc":
      case "roll": {
        // Closing orders: quantity fixed by position (no editing allowed)
        return 1; // Default to 1, actual quantity set by position
      }
      
      default:
        return 100; // Fallback
    }
  };
  
  // Calculate total premium
  const calculateTotalPremium = (): number => {
    return orders.reduce((sum, order) => {
      const qty = getQuantity(order);
      const price = adjustedPrices.get(getOrderKey(order)) || order.premium;
      return sum + (price * 100 * qty);
    }, 0);
  };
  
  // Calculate total collateral
  const calculateTotalCollateral = (): number => {
    return orders.reduce((sum, order) => {
      const qty = getQuantity(order);
      
      switch (strategy) {
        case "csp":
          return sum + (order.strike * 100 * qty);
        
        case "bcs":
        case "bps":
          if (order.longStrike) {
            const spreadWidth = Math.abs(order.strike - order.longStrike);
            return sum + (spreadWidth * 100 * qty);
          }
          return sum;
        
        case "pmcc":
          // PMCC buying LEAPs - cost is the premium
          return sum + (order.premium * 100 * qty);
        
        case "btc":
          // Buying to close - cost is the ask price
          const price = order.ask || order.currentPrice || order.premium;
          return sum + (price * 100 * qty);
        
        default:
          return sum;
      }
    }, 0);
  };
  
  // Validate orders
  const validateOrders = (): ValidationError[] => {
    const errors: ValidationError[] = [];
    
    // Check buying power
    const totalCollateral = calculateTotalCollateral();
    const remainingBP = availableBuyingPower - totalCollateral;
    
    if (remainingBP < 0) {
      errors.push({
        symbol: "ALL",
        message: `Insufficient buying power. Need $${totalCollateral.toFixed(2)} but only $${availableBuyingPower.toFixed(2)} available.`,
        severity: "error",
      });
    } else if (remainingBP < availableBuyingPower * 0.1) {
      errors.push({
        symbol: "ALL",
        message: `Using ${((totalCollateral / availableBuyingPower) * 100).toFixed(0)}% of buying power. Consider leaving more buffer.`,
        severity: "warning",
      });
    }
    
    // Strategy-specific validation
    if (strategy === "cc") {
      // Validate stock ownership
      orders.forEach(order => {
        const holding = holdings.find(h => h.symbol === order.symbol);
        const qty = getQuantity(order);
        
        if (!holding) {
          errors.push({
            symbol: order.symbol,
            message: `No shares owned. Cannot sell covered calls.`,
            severity: "error",
          });
        } else if (qty > holding.maxContracts) {
          errors.push({
            symbol: order.symbol,
            message: `Not enough shares. You have ${holding.quantity} shares (${holding.maxContracts} contracts) but selected ${qty}.`,
            severity: "error",
          });
        }
      });
    }
    
    return errors;
  };
  
  // Handle dry run
  const handleDryRun = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(orders, orderQuantities, true);
      setDryRunSuccess(true);
      toast({
        title: "Dry Run Successful",
        description: `${orders.length} orders validated. Click Submit Live to execute.`,
      });
    } catch (error: any) {
      toast({
        title: "Dry Run Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Check market hours before live submission
  const checkMarketHours = async () => {
    try {
      // Call API endpoint directly (can't use React hooks inside event handler)
      const response = await fetch('/api/trpc/market.getMarketStatus');
      if (!response.ok) {
        throw new Error('Failed to fetch market status');
      }
      
      const data = await response.json();
      const status = data.result.data;
      setMarketStatus(status);
      
      if (!status.isOpen) {
        // Market is closed - show warning dialog
        setShowMarketClosedWarning(true);
        return false; // Block submission
      }
      
      return true; // Allow submission
    } catch (error) {
      console.error('[Market Hours Check] Error:', error);
      return true; // Allow submission on error (fail open)
    }
  };
  
  // Handle live submission
  const handleLiveSubmit = async () => {
    // Check market hours first
    const canProceed = await checkMarketHours();
    if (!canProceed) {
      return; // Wait for user confirmation
    }
    
    await executeLiveSubmission();
  };
  
  // Execute live submission (after market hours check)
  const executeLiveSubmission = async () => {
    setIsSubmitting(true);
    setIsPolling(true);
    setDryRunSuccess(false); // Clear dry run banner when submitting live orders
    
    try {
      let result: any;
      
      if (operationMode === "replace" && onReplaceSubmit) {
        // Replace mode - call onReplaceSubmit
        result = await onReplaceSubmit(orders, orderQuantities, oldOrderIds, false);
      } else {
        // New order mode - call onSubmit
        result = await onSubmit(orders, orderQuantities, false);
      }
      
      // Extract ALL order results (success + failures) and initialize status tracking
      const allStatuses: OrderSubmissionStatus[] = result.results.map((r: any) => {
        if (r.success && r.orderId) {
          // Successful submission - will poll for status
          return {
            orderId: String(r.orderId),
            symbol: r.symbol || 'Unknown',
            status: 'Pending' as const,
            message: 'Checking status...'
          };
        } else {
          // Failed submission - show error message immediately
          return {
            orderId: 'FAILED',
            symbol: r.symbol || 'Unknown',
            status: 'Rejected' as const,
            message: r.message || 'Order submission failed'
          };
        }
      });
      
      setOrderStatuses(allStatuses);
      console.log('[UnifiedOrderPreviewModal] Initial order statuses set:', allStatuses);
      
      // Poll order statuses if callback provided (only for successful submissions)
      const successfulStatuses = allStatuses.filter(s => s.orderId !== 'FAILED');
      console.log('[UnifiedOrderPreviewModal] Successful statuses to poll:', successfulStatuses);
      console.log('[UnifiedOrderPreviewModal] onPollStatuses callback exists:', !!onPollStatuses);
      
      if (onPollStatuses && successfulStatuses.length > 0) {
        const orderIds = successfulStatuses.map(s => s.orderId);
        console.log('[UnifiedOrderPreviewModal] Calling onPollStatuses with orderIds:', orderIds, 'accountId:', accountId);
        const polledStatuses = await onPollStatuses(orderIds, accountId);
        console.log('[UnifiedOrderPreviewModal] Polling completed, received statuses:', polledStatuses);
        
        // Merge polled statuses with failed statuses
        const failedStatuses = allStatuses.filter(s => s.orderId === 'FAILED');
        const finalStatuses = [...polledStatuses, ...failedStatuses];
        setOrderStatuses(finalStatuses);
        
        // Show confetti and play sound for successful submissions (Filled OR Working)
        const filledCount = finalStatuses.filter(s => s.status === 'Filled').length;
        const workingCount = finalStatuses.filter(s => s.status === 'Working').length;
        const successCount = filledCount + workingCount;
        
        if (successCount > 0) {
          // Play cha-ching sound
          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3');
          audio.volume = 0.5;
          audio.play().catch(err => console.log('Audio play failed:', err));
          
          // Show confetti
          const confetti = (await import('canvas-confetti')).default;
          confetti({
            particleCount: 200,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#10b981', '#3b82f6', '#8b5cf6'],
          });
        }
      } else if (allStatuses.length > 0) {
        // No polling callback, but we have failed orders - keep them displayed
        // (allStatuses already set above)
      }
      
      setIsPolling(false);
      
      // Determine final status for banner using current orderStatuses
      const currentStatuses = orderStatuses.length > 0 ? orderStatuses : allStatuses;
      const filledCount = currentStatuses.filter((s: OrderSubmissionStatus) => s.status === 'Filled').length;
      const workingCount = currentStatuses.filter((s: OrderSubmissionStatus) => s.status === 'Working').length;
      const rejectedCount = currentStatuses.filter((s: OrderSubmissionStatus) => s.status === 'Rejected').length;
      const marketClosedCount = currentStatuses.filter((s: OrderSubmissionStatus) => s.status === 'MarketClosed').length;
      
      let status: string | null = null;
      if (filledCount > 0) {
        status = 'Filled';
      } else if (workingCount > 0) {
        status = 'Working';
      } else if (marketClosedCount > 0) {
        status = 'MarketClosed';
      } else if (rejectedCount > 0) {
        status = 'Rejected';
      }
      
      setSubmissionState(true, status);
      
      // Auto-hide polling section after 5 seconds
      setTimeout(() => {
        setIsPolling(false);
      }, 5000);
      
    } catch (error: any) {
      toast({
        title: "Submission Failed",
        description: error.message,
        variant: "destructive",
      });
      setDryRunSuccess(false);
      setIsPolling(false);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Adjust price by increment
  const adjustPrice = (order: UnifiedOrder, increment: number) => {
    const key = getOrderKey(order);
    const currentPrice = adjustedPrices.get(key) || order.premium;
    const newPrice = Math.max(0.01, currentPrice + increment);
    const roundedPrice = Math.round(newPrice * 100) / 100;
    setAdjustedPrices(prev => new Map(prev).set(key, roundedPrice));
  };
  
  // Set price via slider (between bid and mid)
  const setPriceFromSlider = (order: UnifiedOrder, value: number[]) => {
    if (!order.bid || !order.ask) return;
    const mid = (order.bid + order.ask) / 2;
    
    // Map slider value (0-100) to price range (bid to mid)
    const priceRange = mid - order.bid;
    const newPrice = order.bid + (priceRange * value[0] / 100);
    const roundedPrice = Math.round(newPrice * 100) / 100;
    
    const key = getOrderKey(order);
    setAdjustedPrices(prev => new Map(prev).set(key, roundedPrice));
  };
  
  // Calculate slider position (0-100) based on current price
  const getSliderPosition = (order: UnifiedOrder): number[] => {
    if (!order.bid || !order.ask) return [50];
    const mid = (order.bid + order.ask) / 2;
    const key = getOrderKey(order);
    const currentPrice = adjustedPrices.get(key) || order.premium;
    
    const priceRange = mid - order.bid;
    if (priceRange === 0) return [50];
    
    const position = ((currentPrice - order.bid) / priceRange) * 100;
    return [Math.max(0, Math.min(100, position))];
  };
  
  // Get fill zone guidance based on slider position
  const getFillZoneGuidance = (sliderPos: number) => {
    if (sliderPos < 70) return { text: "⚠️ Too conservative", color: "text-red-400" };
    if (sliderPos >= 70 && sliderPos < 95) return { text: "✓ Good fill zone", color: "text-green-400" };
    return { text: "⚠️ Too aggressive", color: "text-yellow-400" };
  };
  
  // Reset all prices to midpoint
  const handleResetAllToMidpoint = () => {
    const newPrices = new Map(adjustedPrices); // Start with existing prices
    let updatedCount = 0;
    
    orders.forEach(order => {
      if (order.bid && order.ask) {
        const mid = (order.bid + order.ask) / 2;
        const key = getOrderKey(order);
        newPrices.set(key, Math.round(mid * 100) / 100);
        updatedCount++;
      }
    });
    
    setAdjustedPrices(newPrices);
    toast({
      title: "Prices Reset",
      description: `${updatedCount} order${updatedCount !== 1 ? 's' : ''} set to midpoint`,
    });
  };
  
  // Check if can submit
  const hasErrors = validationErrors.some(e => e.severity === "error");
  const canSubmit = !hasErrors && !isSubmitting;
  
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {operationMode === "replace" ? "Replace Orders - Review Changes" : "Order Preview - Review and Adjust"}
          </DialogTitle>
          <DialogDescription>
            {operationMode === "replace" 
              ? `Review pricing details before replacing ${orders.length} order${orders.length > 1 ? 's' : ''}`
              : "Adjust quantities and prices before submitting"
            }
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 overflow-y-auto flex-1 px-1">
          {/* Status Banner */}
          {dryRunSuccess && !finalOrderStatus && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-500">Dry Run Successful</AlertTitle>
              <AlertDescription className="text-green-500/80">
                All orders validated. Click Submit Live to execute real orders.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Final Order Status Banner */}
          {finalOrderStatus === 'Filled' && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-500">Successfully Submitted and Filled</AlertTitle>
              <AlertDescription className="text-green-500/80">
                Your order has been submitted and filled successfully.
              </AlertDescription>
            </Alert>
          )}
          
          {finalOrderStatus === 'Working' && (
            <Alert className="border-yellow-500/50 bg-yellow-500/10">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <AlertTitle className="text-yellow-500">Successfully Submitted - Working</AlertTitle>
              <AlertDescription className="text-yellow-500/80">
                Your order has been submitted successfully and is currently in working status (queued for execution).
              </AlertDescription>
            </Alert>
          )}
          
          {finalOrderStatus === 'Rejected' && (
            <Alert className="border-red-500/50 bg-red-500/10">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <AlertTitle className="text-red-500">Order Rejected</AlertTitle>
              <AlertDescription className="text-red-500/80">
                Your order was rejected by the broker. Check the rejection reason in the order details below.
              </AlertDescription>
            </Alert>
          )}
          
          {finalOrderStatus === 'MarketClosed' && (
            <Alert className="border-blue-500/50 bg-blue-500/10">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <AlertTitle className="text-blue-500">Market Closed - Orders Queued</AlertTitle>
              <AlertDescription className="text-blue-500/80">
                Your order has been submitted successfully. The market is currently closed, so your order is queued and will be executed when the market opens.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Orders Table */}
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Symbol</TableHead>
                  <TableHead className="w-28">Strategy</TableHead>
                  <TableHead className="text-right w-24">Strike</TableHead>
                  <TableHead className="w-24">Expiration</TableHead>
                  <TableHead className="text-right w-20">Qty</TableHead>
                  <TableHead className="text-right w-28">Limit Price</TableHead>
                  <TableHead className="w-64">Price Adjustment</TableHead>
                  <TableHead className="text-right w-28">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order, idx) => {
                  const key = getOrderKey(order);
                  const qty = getQuantity(order);
                  const maxQty = getMaxQuantity(order);
                  const price = adjustedPrices.get(key) || order.premium;
                  const totalPremium = price * 100 * qty;
                  // For spreads (bid=0, ask=0), disable price adjustment slider
                  const hasMarketData = order.bid && order.ask && order.bid > 0 && order.ask > 0;
                  
                  return (
                    <TableRow key={idx}>
                      {/* Symbol */}
                      <TableCell className="font-semibold">{order.symbol}</TableCell>
                      
                      {/* Strategy */}
                      <TableCell>
                        <Badge variant={order.action.includes("BTC") ? "destructive" : "default"}>
                          {order.action}
                        </Badge>
                      </TableCell>
                      
                      {/* Strike */}
                      <TableCell className="text-right">
                        ${order.strike.toFixed(2)}
                      </TableCell>
                      
                      {/* Expiration */}
                      <TableCell>{new Date(order.expiration).toLocaleDateString()}</TableCell>
                      
                      {/* Quantity */}
                      <TableCell className="text-right">
                        {allowQuantityEdit ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 w-6 p-0"
                              onClick={() => decrementQuantity(order)}
                              disabled={qty <= 1 || isSubmitting}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="font-mono font-bold min-w-[2ch] text-center">
                              {qty}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 w-6 p-0"
                              onClick={() => incrementQuantity(order)}
                              disabled={qty >= maxQty || isSubmitting}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="font-mono font-bold">{qty}</span>
                        )}
                        {allowQuantityEdit && (
                          <div className="text-[10px] text-muted-foreground text-center mt-0.5">
                            max: {maxQty}
                          </div>
                        )}
                      </TableCell>
                      
                      {/* Limit Price */}
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end">
                          <span className="font-semibold text-green-600">
                            ${price.toFixed(2)}
                          </span>
                          {hasMarketData && (
                            <div className="text-xs text-muted-foreground">
                              <div>Mid: ${((order.bid! + order.ask!) / 2).toFixed(2)}</div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      
                      {/* Price Adjustment Slider */}
                      <TableCell>
                        {hasMarketData ? (
                          <div className="flex flex-col gap-3 py-2">
                            {/* Visual Continuum with Markers */}
                            <div className="relative">
                              {/* Slider with Visual Zones */}
                              <div className="relative px-1">
                                {/* Mid Marker */}
                                <div 
                                  className="absolute h-3 w-0.5 bg-blue-400/50 pointer-events-none" 
                                  style={{ 
                                    left: '50%', 
                                    top: '50%', 
                                    transform: 'translate(-50%, -50%)',
                                    zIndex: 0
                                  }}
                                />
                                
                                {/* Slider */}
                                <Slider
                                  value={getSliderPosition(order)}
                                  onValueChange={(value) => setPriceFromSlider(order, value)}
                                  min={0}
                                  max={100}
                                  step={1}
                                  disabled={false}
                                  className="w-full cursor-grab active:cursor-grabbing"
                                />
                              </div>
                              
                              {/* Current Price and Position Indicator */}
                              <div className="flex justify-between items-center mt-2">
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 w-6 p-0"
                                    onClick={() => adjustPrice(order, -0.05)}
                                    disabled={isSubmitting}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <span className="text-xs font-mono font-bold text-blue-400">
                                    ${price.toFixed(2)}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 w-6 p-0"
                                    onClick={() => adjustPrice(order, 0.05)}
                                    disabled={isSubmitting}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const sliderPos = getSliderPosition(order)[0];
                                    const guidance = getFillZoneGuidance(sliderPos);
                                    return <span className={guidance.color}>{guidance.text}</span>;
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No market data</span>
                        )}
                      </TableCell>
                      
                      {/* Total */}
                      <TableCell className="text-right font-semibold text-green-500">
                        ${totalPremium.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          
          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="space-y-2">
              {validationErrors.map((error, idx) => (
                <Alert 
                  key={idx} 
                  variant={error.severity === "error" ? "destructive" : "default"}
                  className={error.severity === "warning" ? "border-yellow-500/50 bg-yellow-500/10" : ""}
                >
                  <AlertCircle className={`h-4 w-4 ${error.severity === "warning" ? "text-yellow-500" : ""}`} />
                  <AlertTitle>{error.symbol}</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}
          
          {/* Summary */}
          {!isPolling && (
            <div className="p-4 bg-muted/30 rounded-lg border space-y-2">
              <h4 className="font-semibold mb-3">Summary</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Premium:</span>
                  <span className="font-medium text-green-500">${calculateTotalPremium().toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Collateral:</span>
                  <span className="font-medium">${calculateTotalCollateral().toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Available BP:</span>
                  <span className="font-medium">${availableBuyingPower.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining BP:</span>
                  <span className={`font-medium ${(availableBuyingPower - calculateTotalCollateral()) < 0 ? "text-red-500" : "text-green-500"}`}>
                    ${(availableBuyingPower - calculateTotalCollateral()).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Order Status Display (after live submission) */}
          {isPolling && orderStatuses.length > 0 && (
            <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
              <h4 className="font-semibold mb-3">Order Status</h4>
              <div className="space-y-2">
                {orderStatuses.map((status, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded bg-background/50">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{status.symbol}</span>
                      {status.status === 'Filled' && <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">Filled ✓</Badge>}
                      {status.status === 'Working' && <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">Working</Badge>}
                      {status.status === 'Cancelled' && <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">Cancelled</Badge>}
                      {status.status === 'Rejected' && <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">Rejected</Badge>}
                      {status.status === 'MarketClosed' && <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">Market Closed</Badge>}
                      {status.status === 'Pending' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    {status.message && <span className="text-sm text-muted-foreground">{status.message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button 
            variant="outline" 
            onClick={handleResetAllToMidpoint}
            disabled={isSubmitting || submissionComplete}
            className="w-full sm:w-auto"
          >
            <span className="mr-2">↔</span>
            Reset All to Midpoint
          </Button>
          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
          {!dryRunSuccess ? (
            <Button
              onClick={handleDryRun}
              variant="default"
              disabled={!canSubmit}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Execute Dry Run
            </Button>
          ) : submissionComplete ? (
            <Button
              onClick={() => onOpenChange(false)}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Close
            </Button>
          ) : (
            <Button
              onClick={handleLiveSubmit}
              variant="destructive"
              disabled={!canSubmit || tradingMode === "paper"}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Live
              {tradingMode === "paper" && <span className="ml-2 text-xs">(Disabled in Paper Mode)</span>}
            </Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
    {/* Market Closed Warning Dialog */}
    <Dialog open={showMarketClosedWarning} onOpenChange={setShowMarketClosedWarning}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            Market is Closed
          </DialogTitle>
          <div className="space-y-3 pt-2 text-sm text-muted-foreground">
            <div>
              The market is currently closed. Your orders will be queued and will execute when the market opens.
            </div>
            <div className="text-sm text-muted-foreground">
              {marketStatus?.description || 'Market hours: Monday-Friday, 9:30 AM - 4:00 PM ET'}
            </div>
            <div className="text-sm font-medium text-yellow-600">
              ⚠️ You can cancel queued orders in the Working Orders view before market open.
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => setShowMarketClosedWarning(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              setShowMarketClosedWarning(false);
              await executeLiveSubmission();
            }}
            className="flex-1"
          >
            Submit Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
