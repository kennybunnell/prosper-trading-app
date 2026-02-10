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
import { Badge } from "@/components/ui/badge";
import { Loader2, Minus, Plus, AlertCircle, CheckCircle2 } from "lucide-react";
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

export interface UnifiedOrderPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  
  // Order data
  orders: UnifiedOrder[];
  strategy: "csp" | "cc" | "bcs" | "bps" | "pmcc" | "btc" | "roll";
  
  // Account context
  accountId: string;
  availableBuyingPower: number;
  holdings?: Holding[]; // Required for CC validation
  
  // Callbacks
  onSubmit: (orders: UnifiedOrder[], quantities: Map<string, number>, isDryRun: boolean) => Promise<void>;
  
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
  defaultQuantities,
  allowQuantityEdit = true,
  tradingMode = "live",
}: UnifiedOrderPreviewModalProps) {
  const { toast } = useToast();
  
  // State
  const [mode, setMode] = useState<"dry-run" | "live">("dry-run");
  const [dryRunSuccess, setDryRunSuccess] = useState(false);
  const [orderQuantities, setOrderQuantities] = useState<Map<string, number>>(new Map());
  const [adjustedPrices, setAdjustedPrices] = useState<Map<string, number>>(new Map());
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
      
      // Reset mode and dry run success when modal opens
      setMode("dry-run");
      setDryRunSuccess(false);
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
        description: `${orders.length} orders validated`,
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
    try {
      await onSubmit(orders, orderQuantities, false);
      toast({
        title: "Orders Submitted",
        description: `${orders.length} orders submitted successfully!`,
      });
      onOpenChange(false); // Close modal after successful submission
    } catch (error: any) {
      toast({
        title: "Submission Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Check if can submit
  const hasErrors = validationErrors.some(e => e.severity === "error");
  const canSubmit = !hasErrors && !isSubmitting;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Order Preview - Review and Adjust</DialogTitle>
          <DialogDescription>
            Adjust quantities and prices before submitting
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="p-4 bg-muted/50 rounded-lg border">
            <Label className="text-sm font-medium mb-3 block">Trading Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "dry-run" | "live")}>
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dry-run" id="dry-run" />
                  <Label htmlFor="dry-run" className="cursor-pointer">Dry Run (Test)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem 
                    value="live" 
                    id="live" 
                    disabled={!dryRunSuccess || tradingMode === "paper"}
                  />
                  <Label 
                    htmlFor="live" 
                    className={`cursor-pointer ${(!dryRunSuccess || tradingMode === "paper") ? "text-muted-foreground" : ""}`}
                  >
                    Live (Real Orders)
                    {tradingMode === "paper" && <span className="ml-2 text-xs">(Disabled in Paper Mode)</span>}
                  </Label>
                </div>
              </div>
            </RadioGroup>
            
            {dryRunSuccess && mode === "dry-run" && (
              <Alert className="mt-3 border-green-500/50 bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertTitle className="text-green-500">Dry Run Successful</AlertTitle>
                <AlertDescription className="text-green-500/80">
                  All orders validated. Toggle to Live mode to submit real orders.
                </AlertDescription>
              </Alert>
            )}
          </div>
          
          {/* Orders List */}
          <div className="space-y-4">
            {orders.map((order, idx) => {
              const key = getOrderKey(order);
              const qty = getQuantity(order);
              const maxQty = getMaxQuantity(order);
              const price = adjustedPrices.get(key) || order.premium;
              const totalPremium = price * 100 * qty;
              
              return (
                <div key={idx} className="p-4 border rounded-lg bg-card">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-semibold">
                        {order.symbol} ${order.strike} {order.optionType} - {new Date(order.expiration).toLocaleDateString()}
                      </h4>
                      <p className="text-sm text-muted-foreground">{order.action}</p>
                    </div>
                    <Badge variant={order.action.includes("BTC") ? "destructive" : "default"}>
                      {order.action}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    {/* Quantity Controls */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">Quantity</Label>
                      {allowQuantityEdit ? (
                        <div className="flex items-center gap-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => decrementQuantity(order)}
                            disabled={qty <= 1 || isSubmitting}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          
                          <Input 
                            type="number"
                            min={1}
                            max={maxQty}
                            value={qty}
                            onChange={(e) => setQuantity(order, parseInt(e.target.value) || 1)}
                            className="w-16 text-center"
                            disabled={isSubmitting}
                          />
                          
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => incrementQuantity(order)}
                            disabled={qty >= maxQty || isSubmitting}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                          
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            (max: {maxQty})
                          </span>
                        </div>
                      ) : (
                        <div className="text-sm font-medium">{qty} contract{qty > 1 ? "s" : ""}</div>
                      )}
                    </div>
                    
                    {/* Price */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">Price</Label>
                      <div className="text-sm font-medium">${price.toFixed(2)}</div>
                      {order.bid && order.ask && (
                        <div className="text-xs text-muted-foreground">
                          Bid ${order.bid.toFixed(2)} / Ask ${order.ask.toFixed(2)}
                        </div>
                      )}
                    </div>
                    
                    {/* Total Premium */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">Total</Label>
                      <div className="text-sm font-medium text-green-500">${totalPremium.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
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
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={mode === "dry-run" ? handleDryRun : handleLiveSubmit}
            variant={mode === "dry-run" ? "default" : "destructive"}
            disabled={!canSubmit}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "dry-run" ? "Execute Dry Run" : "Submit Orders"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
