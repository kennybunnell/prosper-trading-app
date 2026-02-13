import { useState, useEffect } from "react";
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
  
  // Initialize quantities from defaults or set to 1
  useEffect(() => {
    if (open && orders.length > 0) {
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
        if (order.bid && order.ask) {
          initialPrices.set(key, (order.bid + order.ask) / 2);
        } else {
          initialPrices.set(key, order.premium);
        }
      });
      setAdjustedPrices(initialPrices);
      
      // Reset dry run success and polling state when modal opens
      setDryRunSuccess(false);
      setIsPolling(false);
      setOrderStatuses([]);
    }
  }, [open, orders, defaultQuantities]);
  
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
  
  // Handle live submission
  const handleLiveSubmit = async () => {
    setIsSubmitting(true);
    setIsPolling(true);
    
    try {
      let result: any;
      
      if (operationMode === "replace" && onReplaceSubmit) {
        // Replace mode - call onReplaceSubmit
        result = await onReplaceSubmit(orders, orderQuantities, oldOrderIds, false);
      } else {
        // New order mode - call onSubmit
        result = await onSubmit(orders, orderQuantities, false);
      }
      
      // Extract order IDs and initialize status tracking
      const initialStatuses: OrderSubmissionStatus[] = result.results
        .filter((r: any) => r.success && r.orderId)
        .map((r: any) => ({
          orderId: r.orderId,
          symbol: r.symbol || 'Unknown',
          status: 'Pending' as const,
          message: 'Checking status...'
        }));
      
      setOrderStatuses(initialStatuses);
      
      // Poll order statuses if callback provided
      if (onPollStatuses && initialStatuses.length > 0) {
        const orderIds = initialStatuses.map(s => s.orderId);
        const finalStatuses = await onPollStatuses(orderIds, accountId);
        setOrderStatuses(finalStatuses);
        
        // Show confetti only if at least one order filled
        const filledCount = finalStatuses.filter(s => s.status === 'Filled').length;
        if (filledCount > 0) {
          const confetti = (await import('canvas-confetti')).default;
          confetti({
            particleCount: 200,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#10b981', '#3b82f6', '#8b5cf6'],
          });
        }
      }
      
      setIsPolling(false);
      
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
  
  // Check if can submit
  const hasErrors = validationErrors.some(e => e.severity === "error");
  const canSubmit = !hasErrors && !isSubmitting;
  
  return (
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
          {/* Dry Run Success Banner */}
          {dryRunSuccess && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-500">Dry Run Successful</AlertTitle>
              <AlertDescription className="text-green-500/80">
                All orders validated. Click Submit Live to execute real orders.
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
                  const hasMarketData = order.bid && order.ask;
                  
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
                                {/* Fill Zone Marker (around 85% of mid) */}
                                <div 
                                  className="absolute h-4 w-1 bg-emerald-400 rounded-full shadow-lg cursor-pointer hover:bg-emerald-300" 
                                  style={{ 
                                    left: '85%', 
                                    top: '50%', 
                                    transform: 'translate(-50%, -50%)',
                                    zIndex: 1
                                  }}
                                  onClick={() => setPriceFromSlider(order, [85])}
                                  title="Optimal fill zone (~85% of mid)"
                                >
                                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-emerald-400 font-bold whitespace-nowrap">Fill</div>
                                </div>
                                
                                {/* Mid Marker */}
                                <div 
                                  className="absolute h-3 w-0.5 bg-blue-400/50" 
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
                                  max={100}
                                  step={1}
                                  className="relative z-10"
                                  disabled={isSubmitting}
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
        
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
