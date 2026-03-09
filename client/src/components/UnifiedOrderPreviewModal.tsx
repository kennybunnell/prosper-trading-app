import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { Loader2, Minus, Plus, AlertCircle, CheckCircle2, DollarSign, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";

// Order interface - flexible for all strategies
export interface UnifiedOrder {
  symbol: string;
  strike: number;
  expiration: string;
  premium: number;
  action: string; // "STO", "BTC", "BTO", "STC"
  optionType: "CALL" | "PUT";
  
  // Optional fields for spreads (2-leg)
  longStrike?: number;
  longPremium?: number;
  longBid?: number;  // Long leg bid (for spread net credit range calculation)
  longAsk?: number;  // Long leg ask (for spread net credit range calculation)
  
  // Optional fields for Iron Condors (4-leg) - second spread
  callShortStrike?: number;   // Call side short strike
  callShortPremium?: number;  // Call side short premium
  callShortBid?: number;      // Call side short bid
  callShortAsk?: number;      // Call side short ask
  callLongStrike?: number;    // Call side long strike
  callLongPremium?: number;   // Call side long premium
  callLongBid?: number;       // Call side long bid
  callLongAsk?: number;       // Call side long ask
  
  // Optional fields for validation
  bid?: number;  // Short leg bid
  ask?: number;  // Short leg ask
  currentPrice?: number;
  
  // Optional fields for replace mode
  oldPrice?: number;      // Original order price (for comparison)
  oldOrderId?: string;    // Original order ID (for tracking)

  // Optional fields for BTC close orders (carry scan result identity)
  optionSymbol?: string;      // OCC option symbol (e.g. HIMS  260306C00018000)
  accountNumber?: string;     // Tastytrade account number
  spreadLongSymbol?: string;  // Long leg OCC symbol for spread closure
  spreadLongPrice?: number;   // Long leg close price
  quantity?: number;          // Number of contracts
  isEstimated?: boolean;      // Whether buy-back cost is estimated
  perOrderPremiumCollected?: number; // Premium originally collected for THIS specific position (for per-row net profit)
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
  strategy: "csp" | "cc" | "bcs" | "bps" | "pmcc" | "btc" | "roll" | "replace" | "iron_condor";
  
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
  initialSkipDryRun?: boolean; // If true, modal opens with "Submit Live" button instead of "Execute Dry Run"
  premiumCollected?: number; // For BTC orders: total premium originally collected (to show profit calculation)
  
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
  initialSkipDryRun = false,
  premiumCollected,
  submissionComplete: externalSubmissionComplete,
  finalOrderStatus: externalFinalOrderStatus,
  onSubmissionStateChange,
}: UnifiedOrderPreviewModalProps) {
  const { toast } = useToast();
  
  // State
  const [skipDryRun, setSkipDryRun] = useState(initialSkipDryRun);
  const [dryRunSuccess, setDryRunSuccess] = useState(false);
  const [orderQuantities, setOrderQuantities] = useState<Map<string, number>>(new Map());
  const [adjustedPrices, setAdjustedPrices] = useState<Map<string, number>>(new Map());
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [orderStatuses, setOrderStatuses] = useState<OrderSubmissionStatus[]>([]);
  // Continuous polling state: track submitted order IDs and polling interval
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittedOrderIdsRef = useRef<string[]>([]);
  const [pollCount, setPollCount] = useState(0); // Increments to trigger re-poll
  const [showMarketClosedWarning, setShowMarketClosedWarning] = useState(false);
  const [marketStatus, setMarketStatus] = useState<{ isOpen: boolean; description: string } | null>(null);
  // Profit target for STO strategies (75% = user's preferred default, 50% = tastytrade standard)
  const [profitTargetPct, setProfitTargetPct] = useState<50 | 75>(75);
  // GTC auto-submit state
  const [gtcSubmitStatus, setGtcSubmitStatus] = useState<'idle' | 'submitting' | 'success' | 'failed'>('idle');
  const [gtcSubmitMessage, setGtcSubmitMessage] = useState<string>('');
  const gtcSubmitMutation = trpc.gtc.submit.useMutation();
  // Safeguard pre-flight check state
  const [safeguardWarnings, setSafeguardWarnings] = useState<Array<{ title: string; description: string; requiredAction: string; severity: string }>>([]);
  const [showSafeguardWarning, setShowSafeguardWarning] = useState(false);
  const [safeguardBlocked, setSafeguardBlocked] = useState(false);
  // Live bid/ask quotes fetched at modal open time
  // Collect all option symbols from orders (for BTC strategy, use optionSymbol; for others use OCC symbol if available)
  const optionSymbolsForQuotes = useMemo(() => {
    if (!open || strategy !== 'btc') return [];
    const syms: string[] = [];
    orders.forEach(o => {
      if (o.optionSymbol) syms.push(o.optionSymbol);       // BTC short leg
      if (o.spreadLongSymbol) syms.push(o.spreadLongSymbol); // STC long leg (spread)
    });
    return Array.from(new Set(syms)); // deduplicate
  }, [open, strategy, orders]);
  const { data: liveQuotesData, isFetching: isQuotesFetching } = trpc.orders.fetchOptionQuotes.useQuery(
    { symbols: optionSymbolsForQuotes },
    { enabled: open && strategy === 'btc' && optionSymbolsForQuotes.length > 0, staleTime: 30_000 }
  );
  const liveQuotes = liveQuotesData ?? {};
  
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
        // Use defaultQuantities if provided, then order.quantity (e.g. CC scanner sets qty = maxContracts),
        // then fall back to 1. Using ?? instead of || so qty=0 is still treated as "not set".
        const defaultQty = defaultQuantities?.get(key) ?? order.quantity ?? 1;
        initialQuantities.set(key, defaultQty);
      });
      setOrderQuantities(initialQuantities);
      
      // Initialize prices to Good Fill Zone
      // For BTC orders: Good Fill Zone = mid + 25% of half-spread (between mid and ask)
      //   This gives a fast fill without paying full ask.
      // For STO orders: Good Fill Zone = mid (standard midpoint entry)
      const initialPrices = new Map<string, number>();
      orders.forEach(order => {
        const key = getOrderKey(order);
        const isBTC = order.action === 'BTC';
        
        // For spreads, calculate net credit/debit range from both legs
        if (order.longStrike && order.bid && order.ask && order.longBid && order.longAsk) {
          if (isBTC) {
            // BTC spread: net debit range (shortBid - longAsk) to (shortAsk - longBid)
            const minDebit = order.bid - order.longAsk;  // Best case (most aggressive)
            const maxDebit = order.ask - order.longBid;  // Worst case (hit the ask)
            const midDebit = (minDebit + maxDebit) / 2;
            const rawPrice = Math.max(0.01, midDebit + (maxDebit - midDebit) * 0.25);
            // Apply Tastytrade tick-size rules
            initialPrices.set(key, rawPrice >= 3.00 ? Math.round(rawPrice * 20) / 20 : Math.round(rawPrice * 100) / 100);
          } else {
            // STO credit spread: use order.premium (netCredit mid) as the starting limit price
            const rawPrice = Math.max(0.01, order.premium);
            initialPrices.set(key, rawPrice >= 3.00 ? Math.round(rawPrice * 20) / 20 : Math.round(rawPrice * 100) / 100);
          }
        }
        // For single-leg options, use bid/ask
        else if (order.bid && order.ask && order.bid > 0 && order.ask > 0) {
          const mid = (order.bid + order.ask) / 2;
          // BTC: set to mid + 25% toward ask = Good Fill Zone
          const rawPrice = Math.max(0.01, isBTC ? mid + (order.ask - mid) * 0.25 : mid);
          // Apply Tastytrade tick-size rules: $0.05 for >= $3, $0.01 for < $3
          initialPrices.set(key, rawPrice >= 3.00 ? Math.round(rawPrice * 20) / 20 : Math.round(rawPrice * 100) / 100);
        }
        // Fallback to premium if no market data
        else {
          initialPrices.set(key, order.premium);
        }
      });
      setAdjustedPrices(initialPrices);
      
      // Reset dry run success, polling state, skipDryRun, and submission complete when modal FIRST opens
      // BUT only if submission is NOT already complete
      setSkipDryRun(initialSkipDryRun);
      setDryRunSuccess(false);
      setIsPolling(false);
      setOrderStatuses([]);
      setSubmissionState(false, null);
    }
  }, [open, submissionComplete]); // Check submissionComplete to prevent reset after live submission

  // Helper: compute Good Fill Zone price for a single-leg BTC order given bid/ask
  const computeGoodFillPrice = (bid: number, ask: number, isBTC: boolean): number => {
    if (bid > 0 && ask > 0) {
      const mid = (bid + ask) / 2;
      const rawPrice = Math.max(0.01, isBTC ? mid + (ask - mid) * 0.25 : mid);
      // Apply Tastytrade tick-size rules: $0.05 for >= $3, $0.01 for < $3
      return rawPrice >= 3.00 ? Math.round(rawPrice * 20) / 20 : Math.round(rawPrice * 100) / 100;
    }
    return 0;
  };

  // Re-initialize prices when live quotes arrive (overrides the estimated bid/ask fallback)
  useEffect(() => {
    if (!open || strategy !== 'btc' || Object.keys(liveQuotes).length === 0) return;
    setAdjustedPrices(prev => {
      const updated = new Map(prev);
      orders.forEach(order => {
        const key = getOrderKey(order);
        const sym = order.optionSymbol;
        if (!sym) return;
        const q = liveQuotes[sym];
        if (!q || q.bid === 0 || q.ask === 0) return;
        const price = computeGoodFillPrice(q.bid, q.ask, order.action === 'BTC');
        if (price > 0) updated.set(key, price);
      });
      return updated;
    });
  }, [liveQuotes, open, strategy]);

  // Continuous 30s polling for order fill status after live submission
  useEffect(() => {
    // Start polling when we have submitted order IDs and a polling callback
    const ids = submittedOrderIdsRef.current;
    if (!onPollStatuses || ids.length === 0) return;
    // Check if all orders are in a terminal state — stop polling if so
    const allTerminal = orderStatuses.length > 0 && orderStatuses.every(
      s => s.status === 'Filled' || s.status === 'Rejected' || s.status === 'Cancelled'
    );
    if (allTerminal) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }
    // Start interval if not already running
    if (!pollingIntervalRef.current) {
      pollingIntervalRef.current = setInterval(() => {
        setPollCount(c => c + 1);
      }, 30_000);
    }
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [submittedOrderIdsRef.current.length, orderStatuses, onPollStatuses]);

  // Execute a poll whenever pollCount increments
  useEffect(() => {
    if (pollCount === 0) return;
    const ids = submittedOrderIdsRef.current;
    if (!onPollStatuses || ids.length === 0) return;
    (async () => {
      try {
        const polledStatuses = await onPollStatuses(ids, accountId);
        setOrderStatuses(prev => {
          // Merge: keep failed (FAILED orderId) entries, update the rest
          const failed = prev.filter(s => s.orderId === 'FAILED');
          return [...polledStatuses, ...failed];
        });
      } catch (err) {
        console.warn('[UnifiedOrderPreviewModal] Polling error:', err);
      }
    })();
  }, [pollCount]);
  
  // Real-time validation whenever quantities change
  useEffect(() => {
    if (open) {
      const errors = validateOrders();
      setValidationErrors(errors);
    }
  }, [orderQuantities, open]);
  
  // Helper: Generate unique key for each order.
  // Include accountNumber so multi-account CC orders for the same symbol/strike/expiry
  // don't collide in the orderQuantities and adjustedPrices maps.
  const getOrderKey = (order: UnifiedOrder): string => {
    const acct = order.accountNumber ? `-${order.accountNumber}` : '';
    return `${order.symbol}-${order.strike}-${order.expiration}${acct}`;
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
        // If no account connected, allow up to 99 contracts (no real limit enforced)
        if (availableBuyingPower <= 0) return 99;
        const collateralPerContract = order.strike * 100;
        const currentTotalCollateral = calculateTotalCollateral();
        const thisOrderCollateral = getQuantity(order) * collateralPerContract;
        const remainingBP = availableBuyingPower - (currentTotalCollateral - thisOrderCollateral);
        
        return Math.max(1, Math.floor(remainingBP / collateralPerContract));
      }
      
      case "bcs":
      case "bps": {
        // Spreads: limited by spread collateral
        // If no account connected, allow up to 99 contracts (no real limit enforced)
        if (availableBuyingPower <= 0) return 99;
        if (!order.longStrike) return 0;
        const spreadWidth = Math.abs(order.strike - order.longStrike);
        const collateralPerContract = spreadWidth * 100;
        const currentTotalCollateral = calculateTotalCollateral();
        const thisOrderCollateral = getQuantity(order) * collateralPerContract;
        const remainingBP = availableBuyingPower - (currentTotalCollateral - thisOrderCollateral);
        
        return Math.max(1, Math.floor(remainingBP / collateralPerContract));
      }
      
      case "pmcc": {
        // PMCC (buying LEAPs): limited by buying power
        // If no account connected, allow up to 99 contracts (no real limit enforced)
        if (availableBuyingPower <= 0) return 99;
        const costPerContract = order.premium * 100;
        const currentTotalCost = calculateTotalPremium();
        const thisOrderCost = getQuantity(order) * costPerContract;
        const remainingBP = availableBuyingPower - (currentTotalCost - thisOrderCost);
        
        return Math.max(1, Math.floor(remainingBP / costPerContract));
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
      
      // For debit strategies (BTC, PMCC), premium is negative (you pay)
      // For credit strategies (CSP, CC, BCS, BPS, IC), premium is positive (you receive)
      const isDebit = strategy === 'btc' || strategy === 'pmcc' || strategy === 'roll';
      const multiplier = isDebit ? -1 : 1;
      
      return sum + (price * 100 * qty * multiplier);
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
          // If strike is 0 (data issue), fall back to capitalAtRisk or collateral
          if (!order.strike) {
            return sum + (((order as any).capitalAtRisk || (order as any).collateral || 0) * qty);
          }
          if (order.longStrike) {
            const spreadWidth = Math.abs(order.strike - order.longStrike);
            return sum + (spreadWidth * 100 * qty);
          }
          return sum;
        
        case "pmcc":
          // PMCC buying LEAPs - cost is the premium
          return sum + (order.premium * 100 * qty);
        
        case "iron_condor":
          // Iron Condor: 4-leg strategy, collateral = max(put spread width, call spread width) × 100
          if (order.longStrike && order.callShortStrike && order.callLongStrike) {
            const putSpreadWidth = Math.abs(order.strike - order.longStrike);
            const callSpreadWidth = Math.abs(order.callShortStrike - order.callLongStrike);
            const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
            return sum + (maxSpreadWidth * 100 * qty);
          }
          return sum;
        
        case "btc": {
          // Buying to close - cost is the ask price (or adjusted price)
          const btcPrice = adjustedPrices.get(getOrderKey(order)) || order.ask || order.currentPrice || order.premium;
          // For BTC spread orders: net cost = BTC price - STC long leg credit
          // Use live bid for long leg if available (STC = selling, so you get the bid)
          const isSpread = !!(order.spreadLongSymbol || order.longStrike);
          let longCredit = 0;
          if (isSpread) {
            const longQ = order.spreadLongSymbol ? liveQuotes[order.spreadLongSymbol] : undefined;
            const liveBid = longQ && longQ.bid > 0 ? longQ.bid : undefined;
            longCredit = liveBid ?? (order.spreadLongPrice !== undefined ? order.spreadLongPrice : 0);
          }
          const netBTCCost = btcPrice - longCredit;
          // Net cost can be negative (credit) for profitable closes — still add to sum
          return sum + (netBTCCost * 100 * qty);
        }
        
        default:
          return sum;
      }
    }, 0);
  };
  
  // Validate orders
  const validateOrders = (): ValidationError[] => {
    const errors: ValidationError[] = [];
    
    // Check buying power (skip for BTC/closing orders — no collateral required to close)
    if (strategy !== "btc" && strategy !== "roll" && strategy !== "replace") {
      const totalCollateral = calculateTotalCollateral();
      const remainingBP = availableBuyingPower - totalCollateral;
      
      if (availableBuyingPower > 0 && remainingBP < 0) {
        errors.push({
          symbol: "ALL",
          message: `Insufficient buying power. Need $${totalCollateral.toFixed(2)} but only $${availableBuyingPower.toFixed(2)} available.`,
          severity: "error",
        });
      } else if (availableBuyingPower > 0 && remainingBP < availableBuyingPower * 0.1) {
        errors.push({
          symbol: "ALL",
          message: `Using ${((totalCollateral / availableBuyingPower) * 100).toFixed(0)}% of buying power. Consider leaving more buffer.`,
          severity: "warning",
        });
      }
    }
    
    // Strategy-specific validation
    if (strategy === "cc" && holdings && holdings.length > 0) {
      // Validate stock ownership only when holdings data is explicitly provided.
      // When orders come from the CC scanner, holdings is not passed because the
      // scanner already verified ownership — skip the check in that case.
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
      // Inject adjusted prices for dry run too
      const ordersWithAdjustedPrices = orders.map(order => {
        const key = getOrderKey(order);
        const adjustedPrice = adjustedPrices.get(key);
        return adjustedPrice !== undefined ? { ...order, premium: adjustedPrice } : order;
      });
      await onSubmit(ordersWithAdjustedPrices, orderQuantities, true);
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
  
  // Safeguard pre-flight check — runs before any live submission
  const runSafeguardCheck = async (): Promise<boolean> => {
    try {
      const checkableStrategies = ['btc', 'roll', 'cc', 'csp', 'bps', 'bcs', 'iron_condor'];
      if (!checkableStrategies.includes(strategy)) return true;
      if (!accountId || orders.length === 0) return true;

      const allWarnings: Array<{ title: string; description: string; requiredAction: string; severity: string }> = [];

      for (const order of orders) {
        let orderType: string | null = null;
        if (order.action === 'BTC' || order.action === 'STC') orderType = 'btc_option';
        else if (strategy === 'roll') orderType = 'roll';
        else if (strategy === 'cc' && (order.action === 'STO')) orderType = 'sell_call';
        if (!orderType) continue;

        // Build OCC symbol from order fields
        const expFormatted = order.expiration ? order.expiration.replace(/-/g, '').slice(2) : '';
        const optChar = order.optionType === 'CALL' ? 'C' : 'P';
        const strikeFormatted = String(Math.round((order.strike || 0) * 1000)).padStart(8, '0');
        const optionSymbol = expFormatted ? `${order.symbol}${expFormatted}${optChar}${strikeFormatted}` : undefined;

        const params = new URLSearchParams({
          input: JSON.stringify({
            json: {
              accountNumber: accountId,
              orderType,
              symbol: order.symbol,
              ...(optionSymbol ? { optionSymbol } : {}),
              contracts: orderQuantities.get(`${order.symbol}-${order.strike}-${order.expiration}`) || 1,
            }
          })
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        try {
          const resp = await fetch(`/api/trpc/safeguards.preTradeCheck?${params.toString()}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!resp.ok) continue;
          const data = await resp.json();
          const result = data?.result?.data?.json || data?.result?.data;
          if (result?.warnings?.length) {
            allWarnings.push(...result.warnings.map((w: any) => ({
              title: w.title,
              description: w.description,
              requiredAction: w.requiredAction,
              severity: w.severity,
            })));
          }
        } catch {
          clearTimeout(timeoutId);
          // Fail open — don't block on network errors
        }
      }

      if (allWarnings.length > 0) {
        setSafeguardWarnings(allWarnings);
        setSafeguardBlocked(allWarnings.some(w => w.severity === 'block'));
        setShowSafeguardWarning(true);
        return false;
      }

      return true;
    } catch (e) {
      console.warn('[Safeguard Check] Error:', e);
      return true; // Fail open
    }
  };

  // Check market hours before live submission
  const checkMarketHours = async () => {
    try {
      console.log('[Market Hours Check] Fetching market status...');
      
      // Call API endpoint with 5 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('/api/trpc/market.getMarketStatus', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error('Failed to fetch market status');
      }
      
      const data = await response.json();
      console.log('[Market Hours Check] Raw API response:', data);
      
      // tRPC wraps response in result.data.json
      const status = data.result?.data?.json || data.result?.data;
      console.log('[Market Hours Check] Extracted status:', status);
      
      if (!status || typeof status.isOpen === 'undefined') {
        console.error('[Market Hours Check] Invalid status format:', status);
        return true; // Fail open if we can't parse the response
      }
      
      setMarketStatus(status);
      
      if (!status.isOpen) {
        // Market is closed - show warning dialog
        setShowMarketClosedWarning(true);
        return false; // Block submission
      }
      
      return true; // Allow submission
    } catch (error: any) {
      console.error('[Market Hours Check] Error:', error);
      
      // If timeout or network error, fail open and allow submission
      if (error.name === 'AbortError') {
        console.warn('[Market Hours Check] Request timed out after 5 seconds, allowing submission');
      } else {
        console.warn('[Market Hours Check] Failed to check market status, allowing submission');
      }
      
      return true; // Allow submission on error (fail open)
    }
  };
  
  // Handle live submission
  const handleLiveSubmit = async () => {
    // Step 1: Run safeguard pre-flight check
    const safeguardClear = await runSafeguardCheck();
    if (!safeguardClear) {
      return; // Wait for user to acknowledge safeguard warning
    }

    // Step 2: Check market hours
    const canProceed = await checkMarketHours();
    if (!canProceed) {
      return; // Wait for user confirmation
    }
    
    await executeLiveSubmission();
  };
  
  // Execute live submission (after market hours check)
  const executeLiveSubmission = async () => {
    console.log('[UnifiedOrderPreviewModal] Starting live submission...');
    console.log('[UnifiedOrderPreviewModal] Orders to submit:', orders.length);
    console.log('[UnifiedOrderPreviewModal] Order quantities:', Array.from(orderQuantities.entries()));
    
    setIsSubmitting(true);
    setIsPolling(true);
    setDryRunSuccess(false); // Clear dry run banner when submitting live orders
    
    try {
      let result: any;
      
      // Inject adjusted prices into orders before submitting
      // The modal slider/+/- buttons update adjustedPrices but not the original orders prop.
      // We must merge them here so the parent's executeOrderSubmission uses the user-adjusted price.
      const ordersWithAdjustedPrices = orders.map(order => {
        const key = getOrderKey(order);
        const adjustedPrice = adjustedPrices.get(key);
        if (adjustedPrice !== undefined) {
          return { ...order, premium: adjustedPrice };
        }
        return order;
      });

      if (operationMode === "replace" && onReplaceSubmit) {
        // Replace mode - call onReplaceSubmit
        console.log('[UnifiedOrderPreviewModal] Calling onReplaceSubmit...');
        result = await onReplaceSubmit(ordersWithAdjustedPrices, orderQuantities, oldOrderIds, false);
      } else {
        // New order mode - call onSubmit
        console.log('[UnifiedOrderPreviewModal] Calling onSubmit with adjusted prices...');
        result = await onSubmit(ordersWithAdjustedPrices, orderQuantities, false);
      }
      
      console.log('[UnifiedOrderPreviewModal] Submission result:', result);
      
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
      
      // Store submitted order IDs for continuous 30s polling
      const successOrderIds = allStatuses
        .filter(s => s.orderId !== 'FAILED')
        .map(s => s.orderId);
      submittedOrderIdsRef.current = successOrderIds;
      setPollCount(0); // Reset poll count so interval starts fresh
      
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
        
        // Show confetti and play sound ONLY for LIVE order submissions (Filled OR Working)
        // Do NOT show confetti for dry runs
        const filledCount = finalStatuses.filter(s => s.status === 'Filled').length;
        const workingCount = finalStatuses.filter(s => s.status === 'Working').length;
        const successCount = filledCount + workingCount;
        
        // Auto-submit GTC close orders for confirmed fills on STO strategies
        const isStoStrategy = strategy !== 'btc' && strategy !== 'roll' && strategy !== 'replace';
        if (filledCount > 0 && isStoStrategy) {
          // Fire GTC submissions in background — one per filled order that has legs data
          const filledResults = result.results.filter((r: any) => r.success && r.orderId && r.legs?.length > 0);
          for (const r of filledResults) {
            setGtcSubmitStatus('submitting');
            gtcSubmitMutation.mutate({
              accountId,
              sourceOrderId: String(r.orderId),
              sourceStrategy: strategy,
              symbol: r.symbol || orders[0]?.symbol || '',
              expiration: r.expiration || orders[0]?.expiration || '',
              premiumCollected: r.premium ?? (adjustedPrices.get(getOrderKey(orders[0])) || orders[0]?.premium || 0),
              totalPremiumCollected: calculateTotalPremium(),
              profitTargetPct,
              legs: r.legs,
            }, {
              onSuccess: (data) => {
                setGtcSubmitStatus('success');
                setGtcSubmitMessage(`GTC close order placed at $${data.targetClosePrice} (${data.profitTargetPct}% target)`);
                toast({
                  title: '✅ GTC Close Order Placed',
                  description: `Auto-close set at $${data.targetClosePrice} — ${data.profitTargetPct}% profit target`,
                });
              },
              onError: (err) => {
                setGtcSubmitStatus('failed');
                setGtcSubmitMessage(`GTC failed: ${err.message}`);
                toast({
                  title: 'GTC Order Failed',
                  description: err.message,
                  variant: 'destructive',
                });
              },
            });
          }
        }

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
    // Apply Tastytrade tick-size rules: $0.05 increments for prices >= $3, $0.01 for < $3
    const roundedPrice = newPrice >= 3.00
      ? Math.round(newPrice * 20) / 20
      : Math.round(newPrice * 100) / 100;
    setAdjustedPrices(prev => new Map(prev).set(key, roundedPrice));
  };
  
  // Helper: get the full price range for an order (min=best-case, max=worst-case)
  // Range is always wider than the natural bid/ask so the user can tune freely:
  //   - minimum is always $0.01 (can go below bid for aggressive BTC)
  //   - maximum is always at least 2x the ask (can go above ask if needed)
  const getOrderPriceRange = (order: UnifiedOrder) => {
    if (!order.bid || !order.ask) {
      const fallback = Math.max(0.01, order.premium);
      return { minPrice: 0.01, maxPrice: Math.max(fallback * 2, 0.50), midPrice: fallback };
    }
    if (order.longStrike && order.bid && order.ask && order.longBid !== undefined && order.longAsk !== undefined) {
      // Credit spread (STO): net credit range
      //   worst case (least credit): sell at bid, buy at ask = bid - longAsk
      //   best case (most credit):  sell at ask, buy at bid = ask - longBid
      const worstCredit = Math.max(0.01, order.bid - order.longAsk);
      const bestCredit  = order.ask - order.longBid;
      const midPrice = order.premium; // netCredit mid = (shortMid - longMid)
      return { minPrice: Math.max(0.01, worstCredit * 0.5), maxPrice: Math.max(bestCredit * 1.5, 0.50), midPrice };
    }
    // Single-leg: extend range below bid and above ask for full manual control
    const midPrice = (order.bid + order.ask) / 2;
    return { minPrice: 0.01, maxPrice: Math.max(order.ask * 2, 0.50), midPrice };
  };

  // Set price via slider (full bid→ask range)
  const setPriceFromSlider = (order: UnifiedOrder, value: number[]) => {
    // Allow slider even when bid/ask are 0 or missing — use fallback range
    const { minPrice, maxPrice } = getOrderPriceRange(order);
    const priceRange = maxPrice - minPrice;
    const newPrice = minPrice + (priceRange * value[0] / 100);
    // Apply Tastytrade tick-size rules: $0.05 increments for prices >= $3, $0.01 for < $3
    const safePrice = Math.max(0.01, newPrice);
    const roundedPrice = safePrice >= 3.00
      ? Math.round(safePrice * 20) / 20
      : Math.round(safePrice * 100) / 100;
    const key = getOrderKey(order);
    setAdjustedPrices(prev => new Map(prev).set(key, roundedPrice));
  };
  
  // Calculate slider position (0-100) based on current price across full bid→ask range
  const getSliderPosition = (order: UnifiedOrder): number[] => {
    const { minPrice, maxPrice } = getOrderPriceRange(order);
    const key = getOrderKey(order);
    const currentPrice = adjustedPrices.get(key) ?? order.premium;
    const priceRange = maxPrice - minPrice;
    if (priceRange === 0) return [50];
    const position = ((currentPrice - minPrice) / priceRange) * 100;
    return [Math.max(0, Math.min(100, position))];
  };
  
  // Get fill zone guidance based on slider position and order direction
  // BTC (buy to close): slider goes bid→ask; Good Fill Zone = 40-75% (mid to 75% toward ask)
  //   <40% = below mid = unlikely to fill | >75% = paying too much above mid
  // STO (sell to open): slider goes bid→ask; Good Fill Zone = 40-70% (near mid)
  //   <30% = too far below mid = unlikely to fill | >80% = above mid = great but rare
  const getFillZoneGuidance = (sliderPos: number, action: string) => {
    const isBTC = action === 'BTC';
    if (isBTC) {
      if (sliderPos < 30) return { text: "⚠️ Below mid — unlikely to fill", color: "text-red-400" };
      if (sliderPos >= 30 && sliderPos < 45) return { text: "↗ Near mid — may fill slowly", color: "text-yellow-400" };
      if (sliderPos >= 45 && sliderPos < 75) return { text: "✅ Good Fill Zone", color: "text-green-400" };
      if (sliderPos >= 75 && sliderPos < 90) return { text: "↑ Above mid — fast fill", color: "text-blue-400" };
      return { text: "⚠️ Near ask — paying full spread", color: "text-orange-400" };
    } else {
      // STO
      if (sliderPos < 30) return { text: "⚠️ Too aggressive — may not fill", color: "text-red-400" };
      if (sliderPos >= 30 && sliderPos < 45) return { text: "↗ Slightly below mid", color: "text-yellow-400" };
      if (sliderPos >= 45 && sliderPos < 70) return { text: "✅ Good Fill Zone", color: "text-green-400" };
      if (sliderPos >= 70 && sliderPos < 85) return { text: "↑ Above mid — great credit", color: "text-blue-400" };
      return { text: "⚠️ Near ask — unlikely to fill", color: "text-orange-400" };
    }
  };
  
  // Reset all prices to Good Fill Zone (BTC: mid+25% toward ask; STO: mid)
  const handleResetAllToMidpoint = () => {
    const newPrices = new Map(adjustedPrices);
    let updatedCount = 0;
    orders.forEach(order => {
      if (order.bid && order.ask) {
        const isBTC = order.action === 'BTC';
        const { minPrice, maxPrice, midPrice } = getOrderPriceRange(order);
        const rawGoodFill = Math.max(0.01, isBTC ? midPrice + (maxPrice - midPrice) * 0.25 : midPrice);
        // Apply Tastytrade tick-size rules: $0.05 for >= $3, $0.01 for < $3
        const goodFill = rawGoodFill >= 3.00 ? Math.round(rawGoodFill * 20) / 20 : Math.round(rawGoodFill * 100) / 100;
        const key = getOrderKey(order);
        newPrices.set(key, goodFill);
        updatedCount++;
      }
    });
    setAdjustedPrices(newPrices);
    toast({
      title: "Prices Reset to Good Fill Zone",
      description: `${updatedCount} order${updatedCount !== 1 ? 's' : ''} set to Good Fill Zone`,
    });
  };
  
  // Check if can submit
  const hasErrors = validationErrors.some(e => e.severity === "error");
  const canSubmit = !hasErrors && !isSubmitting;
  
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {operationMode === "replace" ? "Replace Orders - Review Changes" : "Order Preview - Review and Adjust"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>
              {operationMode === "replace" 
                ? `Review pricing details before replacing ${orders.length} order${orders.length > 1 ? 's' : ''}` 
                : "Adjust quantities and prices before submitting"
              }
            </span>
            {strategy === 'btc' && optionSymbolsForQuotes.length > 0 && (
              isQuotesFetching ? (
                <span className="flex items-center gap-1 text-xs text-yellow-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Fetching live quotes…
                </span>
              ) : Object.keys(liveQuotes).length > 0 ? (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Live quotes loaded
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Using estimated prices</span>
              )
            )}
          </DialogDescription>
        </DialogHeader>
        
        {/* Skip Dry Run Checkbox */}
        {!submissionComplete && (
          <div className="flex items-center space-x-2 px-6 py-2 bg-muted/30 border-b">
            <input
              type="checkbox"
              id="skipDryRun"
              checked={skipDryRun}
              onChange={(e) => {
                setSkipDryRun(e.target.checked);
                if (e.target.checked) {
                  setDryRunSuccess(true); // Treat as if dry run passed
                }
              }}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              disabled={isSubmitting || dryRunSuccess}
            />
            <label htmlFor="skipDryRun" className="text-sm font-medium cursor-pointer">
              Skip dry run and go straight to live submission
            </label>
          </div>
        )}
        
        {/* No Account Warning Banner — only show when no account is selected at all, NOT based on buying power */}
        {!accountId && !submissionComplete && (
          <div className="flex items-start gap-2 px-6 py-2.5 bg-amber-950/30 border-b border-amber-500/30 text-amber-300 text-xs">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
            <div>
              <span className="font-semibold">No account connected</span> — buying power is unavailable, so quantity limits cannot be enforced.{' '}
              Connect your Tastytrade account in{' '}
              <a href="/settings" className="underline text-amber-200 hover:text-white">Settings</a>{' '}
              to enable accurate position sizing.
            </div>
          </div>
        )}

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
                  <TableHead className="w-24">Strategy</TableHead>
                  <TableHead className="text-right w-20">Strike</TableHead>
                  <TableHead className="w-20">Expiration</TableHead>
                  <TableHead className="text-right w-12">Qty</TableHead>
                  <TableHead className="text-right w-28">Limit Price</TableHead>
                  <TableHead className="w-52">Price Adjustment</TableHead>
                  <TableHead className="text-right w-24">Total</TableHead>
                  <TableHead className="text-right w-28">Net Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order, idx) => {
                  const key = getOrderKey(order);
                  const qty = getQuantity(order);
                  const maxQty = getMaxQuantity(order);
                  const price = adjustedPrices.get(key) || order.premium;
                  // For BTC spread orders: net cost = BTC price - STC long leg price
                  // If net is negative → you receive a credit (profitable close)
                  const isSpreadBTC = strategy === 'btc' && !!(order.spreadLongSymbol || order.longStrike);
                  // Use live bid for long leg if available (STC = selling, so you get the bid)
                  const longLegLiveQ = order.spreadLongSymbol ? liveQuotes[order.spreadLongSymbol] : undefined;
                  const longLegLiveBid = longLegLiveQ && longLegLiveQ.bid > 0 ? longLegLiveQ.bid : undefined;
                  const longLegCredit = isSpreadBTC
                    ? (longLegLiveBid ?? order.spreadLongPrice ?? order.longPremium ?? 0)
                    : 0;
                  const netPrice = isSpreadBTC ? (price - longLegCredit) : price;
                  const totalPremium = netPrice * 100 * qty;
                  // Check if we have live quotes for this order
                  const liveQ = order.optionSymbol ? liveQuotes[order.optionSymbol] : undefined;
                  const hasLiveQuote = !!(liveQ && liveQ.bid > 0 && liveQ.ask > 0);
                  // Use live quotes if available, otherwise fall back to estimated bid/ask from order
                  const effectiveBid = hasLiveQuote ? liveQ!.bid : order.bid;
                  const effectiveAsk = hasLiveQuote ? liveQ!.ask : order.ask;
                  // Merge live quotes into order for slider calculations
                  const orderWithLive: UnifiedOrder = hasLiveQuote
                    ? { ...order, bid: effectiveBid, ask: effectiveAsk }
                    : order;
                  // Check if we have market data for price adjustment slider
                  // Show slider whenever we have at least a bid or ask, or a stored premium price
                  // For BTC spread orders from automation: they have a stored price even without live bid/ask
                  const hasMarketData = (effectiveBid && effectiveAsk && effectiveBid > 0 && effectiveAsk > 0)
                    || (order.premium > 0);  // Always show slider if we have any price to work from
                  
                  // Check if this is an Iron Condor (has all 4 legs)
                  const isIronCondor = order.callShortStrike && order.callLongStrike;
                  
                  // For BTC spread orders, check if we have a long leg to display
                  const isSpread = !!(order.spreadLongSymbol || order.longStrike);
                  const isBTCSpread = strategy === 'btc' && isSpread;
                  // STO spread strategies — show both legs in the preview
                  const isBPSOrder = strategy === 'bps' && !!order.longStrike;
                  const isBCSOrder = strategy === 'bcs' && !!order.longStrike;

                  return (
                    <React.Fragment key={idx}>
                    <TableRow>
                      {/* Symbol */}
                      <TableCell className="font-semibold">
                        <div className="flex flex-col">
                          <span>{order.symbol}</span>
                          {(isBTCSpread || isBPSOrder || isBCSOrder) && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              2-leg spread
                            </span>
                          )}
                        </div>
                      </TableCell>
                      
                      {/* Strategy */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {isIronCondor ? (
                            <Badge variant="default" className="bg-purple-600">
                              Iron Condor
                            </Badge>
                          ) : isBPSOrder ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="default" className="bg-green-700 text-white text-[10px] px-1.5">
                                Bull Put Spread
                              </Badge>
                              <span className="text-[10px] text-green-400">STO + BTO</span>
                            </div>
                          ) : isBCSOrder ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="default" className="bg-red-700 text-white text-[10px] px-1.5">
                                Bear Call Spread
                              </Badge>
                              <span className="text-[10px] text-red-400">STO + BTO</span>
                            </div>
                          ) : (
                            <Badge variant={order.action.includes("BTC") ? "destructive" : "default"}>
                              {order.action}
                            </Badge>
                          )}
                          {isBTCSpread && (
                            <span className="text-[10px] text-blue-400">+ STC long leg</span>
                          )}
                        </div>
                      </TableCell>
                      
                      {/* Strike - parse from optionSymbol if order.strike is 0 (BTC orders from scan) */}
                      <TableCell className="text-right">
                        {(() => {
                          // For BTC orders built from scan results, strike may be 0 if the regex failed.
                          // Re-derive from optionSymbol (OCC format: ROOT YYMMDD C/P STRIKE8) as fallback.
                          let displayStrike = order.strike;
                          if ((!displayStrike || displayStrike === 0) && order.optionSymbol) {
                            const m = order.optionSymbol.match(/[CP](\d{8})$/);
                            if (m) displayStrike = parseInt(m[1], 10) / 1000;
                          }
                          if (isIronCondor) {
                            return (
                              <div className="text-xs space-y-0.5">
                                <div className="font-semibold text-green-600">PUT: ${order.strike.toFixed(2)}/${order.longStrike?.toFixed(2)}</div>
                                <div className="font-semibold text-red-600">CALL: ${order.callShortStrike?.toFixed(2)}/${order.callLongStrike?.toFixed(2)}</div>
                              </div>
                            );
                          }
                          // BPS: show short put / long put
                          if (isBPSOrder) {
                            return (
                              <div className="text-xs space-y-0.5">
                                <div className="text-green-400">Short: <span className="font-semibold">${order.strike.toFixed(2)}</span></div>
                                <div className="text-muted-foreground">Long: <span className="font-semibold">${order.longStrike!.toFixed(2)}</span></div>
                              </div>
                            );
                          }
                          // BCS: show short call / long call
                          if (isBCSOrder) {
                            return (
                              <div className="text-xs space-y-0.5">
                                <div className="text-red-400">Short: <span className="font-semibold">${order.strike.toFixed(2)}</span></div>
                                <div className="text-muted-foreground">Long: <span className="font-semibold">${order.longStrike!.toFixed(2)}</span></div>
                              </div>
                            );
                          }
                          // For BTC spread orders, show the option type (Call/Put) alongside the strike
                          // so users can immediately verify which leg type they are closing.
                          if (isBTCSpread && order.optionSymbol) {
                            const typeMatch = order.optionSymbol.match(/([CP])(\d{8})$/);
                            const optType = typeMatch ? (typeMatch[1] === 'P' ? 'Put' : 'Call') : null;
                            return (
                              <div className="flex flex-col items-end">
                                <span>${displayStrike > 0 ? displayStrike.toFixed(2) : '—'}</span>
                                {optType && (
                                  <span className={`text-[10px] font-medium ${optType === 'Put' ? 'text-green-400' : 'text-red-400'}`}>
                                    {optType}
                                  </span>
                                )}
                              </div>
                            );
                          }
                          return <>${displayStrike > 0 ? displayStrike.toFixed(2) : '—'}</>;
                        })()}
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
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-semibold text-green-600">
                            ${price.toFixed(2)}
                          </span>
                          {hasMarketData && (
                            <div className="text-xs text-muted-foreground space-y-0.5">
                              <div>Mid: ${(() => {
                                // For spreads, show net credit midpoint
                                if (order.longStrike && order.longBid && order.longAsk) {
                                  const minCredit = effectiveBid! - order.longAsk;
                                  const maxCredit = effectiveAsk! - order.longBid;
                                  return ((minCredit + maxCredit) / 2).toFixed(2);
                                }
                                // For single-leg, show bid/ask midpoint
                                return ((effectiveBid! + effectiveAsk!) / 2).toFixed(2);
                              })()}</div>
                              <div className="text-[10px]">
                                Bid: ${effectiveBid?.toFixed(2)} / Ask: ${effectiveAsk?.toFixed(2)}
                              </div>
                            </div>
                          )}
                          {strategy === 'btc' && (
                            hasLiveQuote ? (
                              <span className="text-[10px] text-green-400 font-medium">● Live</span>
                            ) : (
                              <span className="text-[10px] text-yellow-500">~ Est.</span>
                            )
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
                                  value={getSliderPosition(orderWithLive)}
                                  onValueChange={(value) => setPriceFromSlider(orderWithLive, value)}
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
                                    onClick={() => adjustPrice(orderWithLive, price >= 3.00 ? -0.05 : -0.01)}
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
                                    onClick={() => adjustPrice(orderWithLive, price >= 3.00 ? 0.05 : 0.01)}
                                    disabled={isSubmitting}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const sliderPos = getSliderPosition(orderWithLive)[0];
                                    const guidance = getFillZoneGuidance(sliderPos, order.action);
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
                      <TableCell className={`text-right font-semibold ${
                        isSpreadBTC
                          ? totalPremium <= 0 ? 'text-green-400' : 'text-red-400'  // spread BTC: negative = credit (good), positive = debit (cost)
                          : strategy === 'btc' ? 'text-red-400' : 'text-green-500'  // single BTC: always a cost
                      }`}>
                        {isSpreadBTC && totalPremium <= 0
                          ? `+$${Math.abs(totalPremium).toFixed(2)}`  // credit: show as positive with + prefix
                          : `$${Math.abs(totalPremium).toFixed(2)}`
                        }
                        {isSpreadBTC && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {totalPremium <= 0 ? 'net credit' : 'net debit'}
                          </div>
                        )}
                      </TableCell>

                      {/* Net Profit — only shown for BTC strategy */}
                      {strategy === 'btc' && order.perOrderPremiumCollected !== undefined ? (() => {
                        const rowNetProfit = order.perOrderPremiumCollected - Math.abs(totalPremium);
                        const isProfit = rowNetProfit >= 0;
                        return (
                          <TableCell className="text-right">
                            <div className={`font-bold text-base ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                              {isProfit ? '+' : '-'}${Math.abs(rowNetProfit).toFixed(2)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {order.perOrderPremiumCollected > 0
                                ? `${((rowNetProfit / order.perOrderPremiumCollected) * 100).toFixed(1)}% of $${order.perOrderPremiumCollected.toFixed(0)} rcvd`
                                : ''}
                            </div>
                          </TableCell>
                        );
                      })() : (
                        strategy === 'btc' ? <TableCell className="text-right text-muted-foreground text-xs">—</TableCell> : null
                      )}
                    </TableRow>
                    {/* Long leg sub-row for BTC spread orders */}
                    {isBTCSpread && order.spreadLongSymbol && (
                      <TableRow key={`${idx}-long`} className="bg-blue-950/20">
                        <TableCell className="text-xs text-blue-400 pl-6" colSpan={2}>
                          <span className="font-medium">↳ Long leg (STC):</span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-blue-300" colSpan={2}>
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-mono text-[10px] break-all">{order.spreadLongSymbol}</span>
                            {order.spreadLongSymbol && (() => {
                              const lm = order.spreadLongSymbol.match(/([CP])(\d{8})$/);
                              const lType = lm ? (lm[1] === 'P' ? 'Put' : 'Call') : null;
                              return lType ? (
                                <span className={`text-[9px] font-semibold ${lType === 'Put' ? 'text-green-400' : 'text-red-400'}`}>
                                  {lType} leg
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-blue-300">
                          {order.quantity || qty}x
                        </TableCell>
                        <TableCell className="text-right text-xs text-blue-300" colSpan={2}>
                          {longLegLiveBid !== undefined ? (
                            <div className="flex flex-col items-end">
                              <span className="text-green-400 font-medium">${longLegLiveBid.toFixed(2)} bid</span>
                              <span className="text-[9px] text-green-500">● Live</span>
                            </div>
                          ) : order.spreadLongPrice !== undefined ? (
                            <div className="flex flex-col items-end">
                              <span>${order.spreadLongPrice.toFixed(2)} limit</span>
                              <span className="text-[9px] text-muted-foreground">(est.)</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Market</span>
                          )}
                        </TableCell>
                        <TableCell />
                        {strategy === 'btc' && <TableCell />}
                      </TableRow>
                    )}
                    </React.Fragment>
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
              {(strategy === 'btc' || strategy === 'roll') ? (
                // BTC / Roll summary: show premium received vs buy-back cost vs estimated profit
                <div className="space-y-2 text-sm">
                  {premiumCollected !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Premium Received:</span>
                      <span className="font-medium text-green-400">${premiumCollected.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {calculateTotalCollateral() <= 0 ? 'Net Close Credit:' : 'Total Buy-Back Cost:'}
                    </span>
                    <span className={`font-medium ${
                      calculateTotalCollateral() <= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {calculateTotalCollateral() <= 0
                        ? `+$${Math.abs(calculateTotalCollateral()).toFixed(2)}`
                        : `$${calculateTotalCollateral().toFixed(2)}`
                      }
                    </span>
                  </div>
                  {premiumCollected !== undefined && (
                    <div className="flex justify-between pt-2 border-t border-border/50">
                      <span className="text-muted-foreground font-medium">Estimated Profit:</span>
                      <span className={`font-semibold ${
                        (premiumCollected - calculateTotalCollateral()) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        ${(premiumCollected - calculateTotalCollateral()).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {premiumCollected !== undefined && premiumCollected > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Realized %:</span>
                      <span className="font-semibold text-blue-400">
                        {(((premiumCollected - calculateTotalCollateral()) / premiumCollected) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                // Standard summary for STO strategies (CSP, CC, spreads, etc.)
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
                  {/* ROC % - Only show for spread strategies (BPS, BCS, IC) */}
                  {(strategy === 'bps' || strategy === 'bcs' || strategy === 'iron_condor') && calculateTotalCollateral() > 0 && (
                    <div className="flex justify-between col-span-2 pt-2 border-t border-border/50">
                      <span className="text-muted-foreground font-medium">Return on Capital:</span>
                      <span className="font-semibold text-blue-400">
                        {((calculateTotalPremium() / calculateTotalCollateral()) * 100).toFixed(2)}%
                      </span>
                    </div>
                  )}
                  {/* Profit Target Selector */}
                  <div className="col-span-2 pt-3 border-t border-border/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">Profit Target</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setProfitTargetPct(50)}
                          className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                            profitTargetPct === 50
                              ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                              : 'border-border/50 text-muted-foreground hover:border-border'
                          }`}
                        >
                          50%
                        </button>
                        <button
                          onClick={() => setProfitTargetPct(75)}
                          className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                            profitTargetPct === 75
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                              : 'border-border/50 text-muted-foreground hover:border-border'
                          }`}
                        >
                          75% ★
                        </button>
                      </div>
                    </div>
                    {calculateTotalPremium() > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Close when premium decays to:</span>
                        <span className="font-mono font-semibold text-amber-400">
                          ${(calculateTotalPremium() * (1 - profitTargetPct / 100)).toFixed(2)}
                          <span className="text-muted-foreground font-normal ml-1">
                            ({profitTargetPct}% of ${calculateTotalPremium().toFixed(2)} captured)
                          </span>
                        </span>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      GTC close order at this price will be placed automatically after a confirmed fill.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* GTC Auto-Submit Status Banner */}
          {gtcSubmitStatus !== 'idle' && (
            <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
              gtcSubmitStatus === 'submitting' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
              gtcSubmitStatus === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
              'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {gtcSubmitStatus === 'submitting' && <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />}
              {gtcSubmitStatus === 'success' && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
              {gtcSubmitStatus === 'failed' && <AlertCircle className="h-4 w-4 flex-shrink-0" />}
              <span>
                {gtcSubmitStatus === 'submitting' ? 'Placing GTC close order...' : gtcSubmitMessage}
              </span>
            </div>
          )}

          {/* Order Status Display (after live submission) */}
          {orderStatuses.length > 0 && (
            <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold">Order Status</h4>
                {pollingIntervalRef.current && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Polling live status every 30s
                  </span>
                )}
              </div>
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
            ⚡ Reset All to Good Fill Zone
          </Button>
          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
          {(!dryRunSuccess || skipDryRun) && !submissionComplete ? (
            !skipDryRun ? (
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
                Submit Live Orders
                {tradingMode === "paper" && <span className="ml-2 text-xs">(Disabled in Paper Mode)</span>}
              </Button>
            )
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
    
    {/* Safeguard Pre-Flight Warning Dialog */}
    <Dialog open={showSafeguardWarning} onOpenChange={setShowSafeguardWarning}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            {safeguardBlocked ? '⛔ Order Blocked — Spread Integrity Violation' : '⚠️ Safeguard Warning — Review Before Proceeding'}
          </DialogTitle>
          <DialogDescription>
            {safeguardBlocked
              ? 'This order cannot be submitted because it would create a prohibited naked position.'
              : 'This order has been flagged by the IRA safety system. Review carefully before proceeding.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {safeguardWarnings.map((w, i) => (
            <div key={i} className={`rounded-lg border p-3 space-y-2 ${
              w.severity === 'block' ? 'border-red-500/50 bg-red-500/10' : 'border-yellow-500/50 bg-yellow-500/10'
            }`}>
              <p className="text-sm font-semibold">{w.title}</p>
              <p className="text-xs text-muted-foreground">{w.description}</p>
              <div className={`text-xs font-medium rounded p-2 ${
                w.severity === 'block' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'
              }`}>
                <span className="font-bold">Required Action: </span>{w.requiredAction}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => setShowSafeguardWarning(false)}
            className="flex-1"
          >
            Cancel Order
          </Button>
          {!safeguardBlocked && (
            <Button
              variant="destructive"
              onClick={async () => {
                setShowSafeguardWarning(false);
                const canProceed = await checkMarketHours();
                if (canProceed) await executeLiveSubmission();
              }}
              className="flex-1"
            >
              Override Warning &amp; Submit
            </Button>
          )}
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
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The market is currently closed. Your orders will be queued and will execute when the market opens.
          </p>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">
              {marketStatus?.description || 'Checking market status...'}
            </p>
          </div>
          <div className="text-sm font-medium text-yellow-600">
            ⚠️ You can cancel queued orders in the Working Orders view before market open.
          </div>
        </div>
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
