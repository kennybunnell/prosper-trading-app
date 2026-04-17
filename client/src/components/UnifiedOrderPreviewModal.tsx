import React, { useState, useEffect, useRef, useMemo } from "react";
import { snapToTick, isTrueIndexOption, getTickSize, getIndexExchange, getMinSpreadWidth, validateMultiIndexSelection, getContractMultiplier } from "../../../shared/orderUtils";
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
import { Loader2, Minus, Plus, AlertCircle, CheckCircle2, DollarSign, ShieldAlert, Copy, Check, RefreshCw, Sparkles, Clock } from "lucide-react";
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
  /** Structured Tastytrade preflight rejection details */
  ttErrors?: Array<{ code: string; message: string }>;
  ttCode?: string | null;
  ttStatus?: number | null;
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

/** Small inline copy-to-clipboard button used in rejection detail rows */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {/* ignore */});
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy rejection reason'}
      className="shrink-0 mt-0.5 p-0.5 rounded text-red-400/50 hover:text-red-300 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-green-400" />
        : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
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
  // Paper trading order submission
  const paperSubmitMutation = trpc.paperTrading.submitOrder.useMutation();
  const [paperOrderResult, setPaperOrderResult] = useState<{ orderId: number; message: string; totalPremiumDollars: number } | null>(null);
  // Safeguard pre-flight check state
  const [safeguardWarnings, setSafeguardWarnings] = useState<Array<{ title: string; description: string; requiredAction: string; severity: string }>>([]);
  const [showSafeguardWarning, setShowSafeguardWarning] = useState(false);
  const [safeguardBlocked, setSafeguardBlocked] = useState(false);
  // Auto-corrected OCC symbols: key = original optionSymbol, value = corrected symbol
  // Used when SPX is on a non-3rd-Friday date → auto-swap to SPXW (and NDX→NDXP, RUT→RUTW)
  const [correctedSymbols, setCorrectedSymbols] = useState<Map<string, string>>(new Map());
  // Live bid/ask quotes fetched at modal open time — for ALL strategies
  const SPREAD_STRATEGIES_WITH_LIVE_QUOTES = new Set(['btc', 'bps', 'bcs', 'iron_condor', 'csp', 'cc', 'roll', 'pmcc']);
  const optionSymbolsForQuotes = useMemo(() => {
    if (!open) return [];
    const syms: string[] = [];
    orders.forEach(o => {
      if (o.optionSymbol) syms.push(o.optionSymbol);         // Short leg OCC symbol (all strategies)
      if (o.spreadLongSymbol) syms.push(o.spreadLongSymbol); // Long leg OCC symbol (spreads)
    });
    return Array.from(new Set(syms.filter(Boolean))); // deduplicate and remove empty
  }, [open, strategy, orders]);
  const [liveQuotesData, setLiveQuotesData] = useState<Record<string, { bid: number; ask: number }>>({});
  const [isQuotesFetching, setIsQuotesFetching] = useState(false);
  const [quoteFetchedAt, setQuoteFetchedAt] = useState<Date | null>(null);
  const [quoteAgeSeconds, setQuoteAgeSeconds] = useState<number>(0);
  // AI price optimization state
  const [isOptimizingPrice, setIsOptimizingPrice] = useState(false);
  const [priceAdvice, setPriceAdvice] = useState<{ symbol: string; suggestedPrice: number; fillProbability: 'high' | 'medium' | 'low'; reasoning: string } | null>(null);
  const fetchQuotesMutation = trpc.orders.fetchOptionQuotes.useMutation();
  const optimizePriceMutation = trpc.orders.optimizeOrderPrice.useMutation();

  // Fetch live quotes on modal open (for BTC and spread strategies)
  const doFetchLiveQuotes = (symbols: string[]) => {
    if (symbols.length === 0) return;
    setIsQuotesFetching(true);
    setPriceAdvice(null); // clear stale advice when refreshing
    fetchQuotesMutation.mutateAsync({ symbols })
      .then(data => {
        setLiveQuotesData(data ?? {});
        setQuoteFetchedAt(new Date());
        setQuoteAgeSeconds(0);
      })
      .catch(() => { setLiveQuotesData({}); })
      .finally(() => { setIsQuotesFetching(false); });
  };

  useEffect(() => {
    if (!open || optionSymbolsForQuotes.length === 0) return;
    doFetchLiveQuotes(optionSymbolsForQuotes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, strategy, optionSymbolsForQuotes.join('|')]);

  // Quote age timer — increments every second when modal is open
  useEffect(() => {
    if (!open || !quoteFetchedAt) return;
    const interval = setInterval(() => {
      setQuoteAgeSeconds(Math.floor((Date.now() - quoteFetchedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [open, quoteFetchedAt]);

  const liveQuotes = liveQuotesData;

  // ── Pre-submission close order validator ─────────────────────────────────
  // Fetches live Tastytrade position quantities and validates index expiration rules.
  // Runs whenever the modal opens for BTC or roll strategies.
  const closeValidationInput = useMemo(() => {
    if (!open || (strategy !== 'btc' && strategy !== 'roll')) return null;
    const validOrders = orders.filter(o => o.optionSymbol || (o.symbol && o.expiration));
    if (validOrders.length === 0) return null;
    return {
      accountId: accountId || 'ALL_ACCOUNTS',
      orders: validOrders.map(o => ({
        optionSymbol: o.optionSymbol || '',
        underlying: o.symbol,
        requestedQuantity: o.quantity ?? 1,
        expiration: o.expiration,
        optionType: o.optionType as 'PUT' | 'CALL',
      })),
    };
  }, [open, strategy, accountId, orders]);

  const { data: closeValidationData } = trpc.orders.validateCloseOrders.useQuery(
    closeValidationInput ?? { accountId: 'ALL_ACCOUNTS', orders: [] },
    {
      enabled: !!closeValidationInput,
      staleTime: 60_000,
      retry: false,
    }
  );

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
            initialPrices.set(key, snapToTick(rawPrice, order.symbol));
          } else {
            // STO credit spread: use order.premium (netCredit mid) as the starting limit price
            const rawPrice = Math.max(0.01, order.premium);
            initialPrices.set(key, snapToTick(rawPrice, order.symbol));
          }
        }
        // For single-leg options (no longStrike), use bid/ask
        // CRITICAL: Do NOT use short leg bid/ask for spread orders — that gives the individual leg
        // price (~$15.80), not the net spread credit (~$4.20). For spreads with missing long leg
        // quotes, always fall back to order.premium (net credit from scanner).
        else if (!order.longStrike && order.bid && order.ask && order.bid > 0 && order.ask > 0) {
          const mid = (order.bid + order.ask) / 2;
          // BTC: set to mid + 25% toward ask = Good Fill Zone
          const rawPrice = Math.max(0.01, isBTC ? mid + (order.ask - mid) * 0.25 : mid);
          // Apply Tastytrade tick-size rules: $0.05 for >= $3, $0.01 for < $3
          initialPrices.set(key, snapToTick(rawPrice, order.symbol));
        }
        // Fallback: use order.premium (net credit for spreads, scanned premium for CSPs)
        // This is always correct: for spreads it's short_mid - long_mid = net credit
        else {
          initialPrices.set(key, Math.max(0.01, order.premium));
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
  const computeGoodFillPrice = (bid: number, ask: number, isBTC: boolean, symbol?: string): number => {
    if (bid > 0 && ask > 0) {
      const mid = (bid + ask) / 2;
      const rawPrice = Math.max(0.01, isBTC ? mid + (ask - mid) * 0.25 : mid);
      // Use integer-arithmetic snapToTick to avoid floating-point precision errors
      return snapToTick(rawPrice, symbol);
    }
    return 0;
  };

  // Re-initialize prices when live quotes arrive (overrides the estimated bid/ask fallback)
  // Works for ALL strategies: BTC, CSP, CC, BPS, BCS, IC, roll, PMCC
  useEffect(() => {
    if (!open || Object.keys(liveQuotes).length === 0) return;
    setAdjustedPrices(prev => {
      const updated = new Map(prev);
      orders.forEach(order => {
        const key = getOrderKey(order);
        const shortSym = order.optionSymbol;
        const longSym = order.spreadLongSymbol;
        const isBTC = order.action === 'BTC';

        // Spread: compute net credit/debit from live quotes for BOTH legs
        // CRITICAL: If this is a spread order (has longStrike), NEVER fall through to
        // single-leg pricing — that would use the short leg's individual price (~$16)
        // instead of the net spread credit (~$4.35).
        if (order.longStrike) {
          if (shortSym && longSym) {
            const shortQ = liveQuotes[shortSym];
            const longQ = liveQuotes[longSym];
            if (shortQ && longQ && shortQ.bid > 0 && shortQ.ask > 0 && longQ.bid > 0 && longQ.ask > 0) {
              if (isBTC) {
                // BTC spread: net debit = short ask - long bid (worst) to short bid - long ask (best)
                const minDebit = Math.max(0.01, shortQ.bid - longQ.ask);
                const maxDebit = Math.max(0.01, shortQ.ask - longQ.bid);
                const midDebit = (minDebit + maxDebit) / 2;
                const rawPrice = Math.max(0.01, midDebit + (maxDebit - midDebit) * 0.25);
                updated.set(key, snapToTick(rawPrice, order.symbol));
              } else {
                // STO spread: net credit = short bid - long ask (conservative) to short ask - long bid (aggressive)
                const minCredit = Math.max(0.01, shortQ.bid - longQ.ask);
                const maxCredit = Math.max(0.01, shortQ.ask - longQ.bid);
                const midCredit = (minCredit + maxCredit) / 2;
                updated.set(key, snapToTick(midCredit, order.symbol));
              }
            }
            // If live quotes are missing/incomplete for a spread, do NOT update the price.
            // The initial price (order.premium = net credit from scanner) is already correct.
          }
          return; // Always stop here for spread orders — never apply single-leg logic
        }

        // Single-leg only (no longStrike)
        if (shortSym) {
          const q = liveQuotes[shortSym];
          if (!q || q.bid === 0 || q.ask === 0) return;
          const price = computeGoodFillPrice(q.bid, q.ask, isBTC, order.symbol);
          if (price > 0) updated.set(key, price);
        }
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
  
  // Auto-fix useEffect: fires when closeValidationData arrives
  // 1. SPX/NDX/RUT on wrong expiration → silently swap to SPXW/NDXP/RUTW in the OCC symbol
  // 2. Quantity > held → silently cap to held quantity
  useEffect(() => {
    if (!closeValidationData?.results) return;
    const ROOT_SWAP: Record<string, string> = {
      SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW',
    };
    const newCorrected = new Map(correctedSymbols);
    let didCorrect = false;
    closeValidationData.results.forEach(result => {
      // --- Symbol correction (SPX → SPXW etc.) ---
      // CRITICAL: Skip symbol correction entirely for BTC/roll close orders.
      // BTC orders carry OCC symbols from live positions (e.g. "SPXW  260402C06700000").
      // The wrongRoot "SPX" is a prefix of "SPXW", so the regex ^SPX\s* matches and
      // corrupts the symbol into "SPXW  W  260402C06700000W  260402C06700000".
      // Symbol correction only applies to STO orders where we construct the OCC symbol
      // from scratch using the underlying root (e.g. "SPX" → "SPXW").
      if (result.expirationWarning?.isError && strategy !== 'btc' && strategy !== 'roll') {
        const wrongRoot = result.underlying; // e.g. 'SPX'
        const rightRoot = ROOT_SWAP[wrongRoot];
        if (rightRoot) {
          // Find the matching order by underlying symbol
          orders.forEach(order => {
            if (order.symbol === wrongRoot && order.optionSymbol) {
              const orig = order.optionSymbol;
              // OCC format: ROOT(padded) YYMMDDCP STRIKE8
              // Use negative lookahead (?![A-Z]) so "SPX" does NOT match "SPXW..." prefix.
              // e.g. "SPX  260321C..." matches, but "SPXW  260402C..." does NOT.
              const corrected = orig.replace(
                new RegExp(`^${wrongRoot}(?![A-Z])(\s*)`),
                rightRoot + '  '
              );
              if (corrected !== orig && !newCorrected.has(orig)) {
                newCorrected.set(orig, corrected);
                didCorrect = true;
                console.info(`[AutoFix] Symbol corrected: ${orig} → ${corrected}`);
              }
            }
          });
        }
      }
      // --- Quantity cap (held < requested) ---
      if (result.heldQuantity !== null && result.heldQuantity !== undefined) {
        const heldQty = result.heldQuantity as number;
        if (heldQty > 0) {
          orders.forEach(order => {
            if (order.symbol === result.underlying) {
              const key = getOrderKey(order);
              const currentQty = orderQuantities.get(key) ?? order.quantity ?? 1;
              if (currentQty > heldQty) {
                setOrderQuantities(prev => new Map(prev).set(key, heldQty));
                console.info(`[AutoFix] Quantity capped for ${order.symbol}: ${currentQty} → ${heldQty}`);
              }
            }
          });
        }
      }
    });
    if (didCorrect) setCorrectedSymbols(newCorrected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeValidationData]);

  // Real-time validation whenever quantities or live close-validation data changes
  useEffect(() => {
    if (open) {
      const errors = validateOrders();
      setValidationErrors(errors);
    }
  }, [orderQuantities, open, closeValidationData]);
  
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
        const cspMaxMult = getContractMultiplier(order.symbol);
        const collateralPerContract = order.strike * cspMaxMult;
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
        const bpsMaxMult = getContractMultiplier(order.symbol);
        const collateralPerContract = spreadWidth * bpsMaxMult;
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
      const directionMultiplier = isDebit ? -1 : 1;
      
      // Use the correct contract multiplier (10 for mini-index options like DJX, XSP, MRUT, XND; 100 for everything else)
      const contractMult = getContractMultiplier(order.symbol);
      
      return sum + (price * contractMult * qty * directionMultiplier);
    }, 0);
  };
  
  // Calculate total collateral
  const calculateTotalCollateral = (): number => {
    return orders.reduce((sum, order) => {
      const qty = getQuantity(order);
      
      switch (strategy) {
        case "csp": {
          const cspMult = getContractMultiplier(order.symbol);
          return sum + (order.strike * cspMult * qty);
        }
        
        case "bcs":
        case "bps": {
          // If strike is 0 (data issue), fall back to capitalAtRisk or collateral
          if (!order.strike) {
            return sum + (((order as any).capitalAtRisk || (order as any).collateral || 0) * qty);
          }
          if (order.longStrike) {
            const spreadWidth = Math.abs(order.strike - order.longStrike);
            const bpsMult = getContractMultiplier(order.symbol);
            return sum + (spreadWidth * bpsMult * qty);
          }
          return sum;
        }
        
        case "pmcc":
          // PMCC buying LEAPs - cost is the premium
          return sum + (order.premium * 100 * qty);
        
        case "iron_condor": {
          // Iron Condor: 4-leg strategy, collateral = max(put spread width, call spread width) × multiplier
          if (order.longStrike && order.callShortStrike && order.callLongStrike) {
            const putSpreadWidth = Math.abs(order.strike - order.longStrike);
            const callSpreadWidth = Math.abs(order.callShortStrike - order.callLongStrike);
            const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
            const icMult = getContractMultiplier(order.symbol);
            return sum + (maxSpreadWidth * icMult * qty);
          }
          return sum;
        }
        
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
          // Net cost is normally positive (debit to close).
          // It can be negative only when the long leg is worth more than the short leg
          // (e.g., a very profitable spread where short has decayed near zero but long retains value).
          // With correct live quotes from the index-option API fix, this should always be positive
          // for deep-ITM spreads. We allow negative to pass through so profitable closes show correctly.
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
    
    // ── Multi-index exchange validation ─────────────────────────────────────
    // Warn when CBOE-listed (SPX/MRUT) and Nasdaq-listed (NDXP/NDX) index
    // options are selected together. They are submitted as separate orders
    // on different exchanges and cannot be combined into a single spread.
    const indexSymbols = orders
      .map(o => o.symbol)
      .filter(s => isTrueIndexOption(s));
    if (indexSymbols.length > 1) {
      const multiIndexWarnings = validateMultiIndexSelection(indexSymbols);
      multiIndexWarnings.forEach(w => {
        errors.push({
          symbol: 'ALL',
          message: w.message,
          severity: 'warning',
        });
      });
    }

    // ── Spread width validation per index symbol ──────────────────────────────
    // Each index has a minimum meaningful spread width. Submitting a spread
    // that is too narrow will be rejected or produce near-zero credit.
    if (strategy === 'bps' || strategy === 'bcs' || strategy === 'iron_condor') {
      orders.forEach(order => {
        if (!isTrueIndexOption(order.symbol)) return;
        const minWidth = getMinSpreadWidth(order.symbol);
        const putWidth = order.longStrike ? Math.abs(order.strike - order.longStrike) : 0;
        const callWidth = (order.callShortStrike && order.callLongStrike)
          ? Math.abs(order.callShortStrike - order.callLongStrike)
          : 0;
        const widthToCheck = strategy === 'iron_condor'
          ? Math.min(putWidth || Infinity, callWidth || Infinity)
          : putWidth;
        if (widthToCheck > 0 && widthToCheck < minWidth) {
          const multiplier = getContractMultiplier(order.symbol);
          errors.push({
            symbol: order.symbol,
            message: `${order.symbol} spread width is ${widthToCheck} pts — minimum recommended is ${minWidth} pts. ` +
              `A ${minWidth}-pt spread has $${(minWidth * multiplier).toLocaleString()} collateral per contract.`,
            severity: 'warning',
          });
        }
      });
    }

    // ── Close order quantity & index expiration validation (BTC / roll) ─────────
    // Uses live data fetched from Tastytrade via validateCloseOrders query.
    // NOTE: quantityError and isError expirationWarning are auto-fixed silently by the
    // auto-fix useEffect above — do NOT surface them as errors here.
    if ((strategy === 'btc' || strategy === 'roll') && closeValidationData?.results) {
      closeValidationData.results.forEach(result => {
        // Quantity error: auto-fixed (quantity capped to heldQuantity) — skip
        // Quantity warning (soft) — still show as informational
        if (result.quantityWarning) {
          errors.push({
            symbol: result.underlying,
            message: result.quantityWarning,
            severity: 'warning',
          });
        }
        // Index expiration rule violation:
        // isError = true means we auto-corrected SPX→SPXW etc. — suppress the error.
        // isError = false (warning only, e.g. SPXW on 3rd Friday) — still show as info.
        if (result.expirationWarning && !result.expirationWarning.isError) {
          errors.push({
            symbol: result.underlying,
            message: result.expirationWarning.message,
            severity: 'warning',
          });
        }
      });
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
  
  // Handle paper trading simulation (records order to paperTradingOrders table)
  const handlePaperSubmit = async () => {
    setIsSubmitting(true);
    setPaperOrderResult(null);
    try {
      // Submit each order as a paper trade
      const results = [];
      for (const order of orders) {
        const qty = orderQuantities.get(getOrderKey(order)) || 1;
        const price = adjustedPrices.get(getOrderKey(order)) || order.premium;
        const premiumCents = Math.round(price * 100); // Convert $ to cents
        // Calculate DTE from expiration date
        const dte = order.expiration
          ? Math.round((new Date(order.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : undefined;
        const result = await paperSubmitMutation.mutateAsync({
          symbol: order.symbol,
          strategy,
          action: order.action,
          optionType: order.optionType,
          strike: String(order.strike),
          expiration: order.expiration,
          dte,
          premiumCents,
          contracts: qty,
          orderSnapshot: {
            symbol: order.symbol,
            strike: order.strike,
            expiration: order.expiration,
            premium: price,
            action: order.action,
            optionType: order.optionType,
            strategy,
            bid: order.bid,
            ask: order.ask,
            longStrike: order.longStrike,
            longPremium: order.longPremium,
          },
        });
        results.push(result);
      }
      // Aggregate results
      const totalPremiumDollars = results.reduce((sum, r) => sum + (r.totalPremiumCents ? r.totalPremiumCents / 100 : 0), 0);
      const firstResult = results[0];
      setPaperOrderResult({
        orderId: firstResult.orderId as number,
        message: firstResult.message,
        totalPremiumDollars,
      });
      setSubmissionState(true, 'Filled');
      toast({
        title: '📝 Paper Trade Simulated',
        description: `${orders.length} order${orders.length > 1 ? 's' : ''} recorded. Total premium: $${totalPremiumDollars.toFixed(2)}`,
      });
    } catch (error: any) {
      toast({
        title: 'Paper Trade Failed',
        description: error.message,
        variant: 'destructive',
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

        // Use per-order accountNumber when available (multi-account CC/CSP scans).
        // The modal-level accountId is only a fallback for single-account flows.
        const orderAccountId = order.accountNumber ?? accountId;
        const params = new URLSearchParams({
          input: JSON.stringify({
            json: {
              accountNumber: orderAccountId,
              orderType,
              symbol: order.symbol,
              ...(optionSymbol ? { optionSymbol } : {}),
              contracts: orderQuantities.get(`${order.symbol}-${order.strike}-${order.expiration}`) || 1,
            }
          })
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
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
      
      // Call API endpoint with 10 second timeout (Tradier TLS handshake can be slow)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
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
      // Use console.warn (not console.error) for expected transient failures so the
      // debug overlay doesn't surface these as user-visible errors.
      // AbortError = timeout; other errors = network/TLS issues — both are handled by
      // failing open (allowing the submission to proceed).
      if (error.name === 'AbortError') {
        console.warn('[Market Hours Check] Request timed out after 10 seconds, allowing submission');
      } else {
        console.warn('[Market Hours Check] Failed to check market status, allowing submission:', error?.message);
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
      
      // Inject adjusted prices AND auto-corrected symbols into orders before submitting.
      // correctedSymbols holds SPX→SPXW / NDX→NDXP / RUT→RUTW swaps applied silently at validation time.
      const ordersWithAdjustedPrices = orders.map(order => {
        const key = getOrderKey(order);
        const adjustedPrice = adjustedPrices.get(key);
        // Apply symbol correction if one exists for this order's optionSymbol
        const correctedOptSym = order.optionSymbol
          ? (correctedSymbols.get(order.optionSymbol) ?? order.optionSymbol)
          : order.optionSymbol;
        // Also correct the underlying symbol (e.g. order.symbol 'SPX' → 'SPXW')
        const ROOT_SWAP: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };
        const correctedUnderlying = ROOT_SWAP[order.symbol] !== undefined && correctedOptSym !== order.optionSymbol
          ? ROOT_SWAP[order.symbol]
          : order.symbol;
        return {
          ...order,
          symbol: correctedUnderlying,
          optionSymbol: correctedOptSym,
          ...(adjustedPrice !== undefined ? { premium: adjustedPrice } : {}),
        };
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
            message: r.message || 'Order submission failed',
            ttErrors: r.ttErrors || [],
            ttCode: r.ttCode || null,
            ttStatus: r.ttStatus || null,
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
    // Use integer-arithmetic snapToTick to avoid floating-point precision errors
    const roundedPrice = snapToTick(newPrice, order.symbol);
    setAdjustedPrices(prev => new Map(prev).set(key, roundedPrice));
  };
  
  // Helper: get the full price range for an order (min=best-case, max=worst-case)
  // Range is always wider than the natural bid/ask so the user can tune freely:
  //   - minimum is always $0.01 (can go below bid for aggressive BTC)
  //   - maximum is always at least 2x the ask (can go above ask if needed)
  const getOrderPriceRange = (order: UnifiedOrder) => {
    // Helper: build a symmetric range so mid always maps to 50%
    const symmetricRange = (mid: number, halfRange: number) => ({
      minPrice: Math.max(0.01, mid - halfRange),
      maxPrice: mid + halfRange,
      midPrice: mid,
    });

    if (!order.bid || !order.ask) {
      // No live quote: anchor on premium with ±50% range
      const mid = Math.max(0.01, order.premium);
      return symmetricRange(mid, Math.max(mid * 0.5, 0.25));
    }

    if (order.longStrike) {
      // Spread order (BPS/BCS/STO or BTC spread):
      // order.premium is the NET credit/debit mid — use it as the anchor.
      // Build ±60% range so slider has meaningful travel without going negative.
      const mid = order.premium > 0 ? order.premium : Math.max(0.01, (order.bid + order.ask) / 2);
      return symmetricRange(mid, Math.max(mid * 0.6, 0.25));
    }

    // Single-leg: bid→ask is the natural range; extend by half-spread on each side
    const mid = (order.bid + order.ask) / 2;
    const halfSpread = Math.max((order.ask - order.bid) / 2, 0.05);
    return symmetricRange(mid, halfSpread * 2); // ±2× half-spread gives bid-0.5×spread to ask+0.5×spread
  };

  // Set price via slider (full bid→ask range)
  const setPriceFromSlider = (order: UnifiedOrder, value: number[]) => {
    // Allow slider even when bid/ask are 0 or missing — use fallback range
    const { minPrice, maxPrice } = getOrderPriceRange(order);
    const priceRange = maxPrice - minPrice;
    const newPrice = minPrice + (priceRange * value[0] / 100);
    // Use integer-arithmetic snapToTick to avoid floating-point precision errors
    const safePrice = Math.max(0.01, newPrice);
    const roundedPrice = snapToTick(safePrice, order.symbol);
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
  
  // Get fill zone guidance based on slider position and order direction.
  // With the new symmetric range, 50% always = mid price.
  // BTC (buy to close): paying more (higher %) = better fill chance
  //   <35% = below mid = unlikely to fill | 35-65% = near mid = good zone | >65% = above mid = fast fill
  // STO (sell to open): receiving more credit (higher %) = better but harder to fill
  //   <35% = too far below mid = may not fill | 35-65% = near mid = good zone | >65% = above mid = great credit
  const getFillZoneGuidance = (sliderPos: number, action: string) => {
    const isBTC = action === 'BTC' || action === 'BTO';
    if (isBTC) {
      if (sliderPos < 25) return { text: "⚠️ Well below mid — unlikely to fill", color: "text-red-400" };
      if (sliderPos >= 25 && sliderPos < 42) return { text: "↗ Below mid — may fill slowly", color: "text-yellow-400" };
      if (sliderPos >= 42 && sliderPos < 65) return { text: "✅ Good Fill Zone (near mid)", color: "text-green-400" };
      if (sliderPos >= 65 && sliderPos < 80) return { text: "↑ Above mid — fast fill", color: "text-blue-400" };
      return { text: "⚠️ Well above mid — paying full spread", color: "text-orange-400" };
    } else {
      // STO / STC
      if (sliderPos < 25) return { text: "⚠️ Well below mid — may not fill", color: "text-red-400" };
      if (sliderPos >= 25 && sliderPos < 42) return { text: "↗ Slightly below mid", color: "text-yellow-400" };
      if (sliderPos >= 42 && sliderPos < 65) return { text: "✅ Good Fill Zone (near mid)", color: "text-green-400" };
      if (sliderPos >= 65 && sliderPos < 80) return { text: "↑ Above mid — great credit", color: "text-blue-400" };
      return { text: "⚠️ Well above mid — unlikely to fill", color: "text-orange-400" };
    }
  };
  
  // Reset all prices to Good Fill Zone = mid price (50% on the slider)
  const handleResetAllToMidpoint = () => {
    const newPrices = new Map(adjustedPrices);
    let updatedCount = 0;
    orders.forEach(order => {
      // Reset even if no live bid/ask — use premium as mid fallback
      const { midPrice } = getOrderPriceRange(order);
      // Good Fill Zone = mid for all strategies (symmetric range means 50% = mid)
      const goodFill = snapToTick(Math.max(0.01, midPrice), order.symbol);
      const key = getOrderKey(order);
      newPrices.set(key, goodFill);
      updatedCount++;
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
            {optionSymbolsForQuotes.length > 0 && (
              <span
                className={[
                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all",
                  isQuotesFetching
                    ? "bg-yellow-500/10 border-yellow-500/40 text-yellow-300 animate-pulse"
                    : Object.keys(liveQuotes).length > 0
                      ? "bg-green-500/10 border-green-500/40 text-green-300"
                      : "bg-red-500/10 border-red-500/40 text-red-300",
                ].join(' ')}
              >
                {isQuotesFetching ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Pulling live quotes…</>
                ) : Object.keys(liveQuotes).length > 0 ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Live quotes
                    {quoteFetchedAt && (
                      <span className={[
                        "ml-1 font-normal",
                        quoteAgeSeconds >= 120 ? "text-red-400" : quoteAgeSeconds >= 60 ? "text-yellow-400" : "text-green-300/70"
                      ].join(' ')}>
                        <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                        {quoteAgeSeconds < 60 ? `${quoteAgeSeconds}s ago` : quoteAgeSeconds < 120 ? `${Math.floor(quoteAgeSeconds/60)}m ${quoteAgeSeconds%60}s ago` : `${Math.floor(quoteAgeSeconds/60)}m ago — stale`}
                      </span>
                    )}
                  </>
                ) : (
                  <><AlertCircle className="h-3 w-3" /> Estimated prices—no live data</>
                )}
                <button
                  onClick={() => doFetchLiveQuotes(optionSymbolsForQuotes)}
                  disabled={isQuotesFetching}
                  title="Force-refresh live bid/ask from Tradier"
                  className="ml-0.5 rounded px-1 py-0 text-[10px] font-bold bg-white/10 hover:bg-white/20 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {isQuotesFetching ? '...' : '↻ Refresh'}
                </button>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        
        {/* Paper Mode Banner */}
        {tradingMode === 'paper' && (
          <div className="flex items-center gap-2 px-6 py-2 bg-blue-500/10 border-b border-blue-500/20 text-blue-300 text-sm">
            <span className="text-base">📝</span>
            <span className="font-medium">Paper Trading Mode</span>
            <span className="text-blue-300/60">— Orders are simulated and recorded to your Paper Orders history. No real trades will be placed.</span>
          </div>
        )}

        {/* Skip Dry Run Checkbox — hidden in paper mode */}
        {!submissionComplete && tradingMode !== 'paper' && (
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
              <AlertTitle className="text-red-500">Order Rejected by Tastytrade</AlertTitle>
              <AlertDescription className="text-red-500/80 space-y-1 mt-1">
                {orderStatuses.filter(s => s.status === 'Rejected').length > 0 ? (
                  orderStatuses.filter(s => s.status === 'Rejected').map((s, i) => (
                    <div key={i}>
                      <span className="font-semibold text-red-400">{s.symbol}:</span>{' '}
                      <span>{s.message || 'Order submission failed'}</span>
                      {s.ttErrors && s.ttErrors.length > 1 && (
                        <ul className="mt-1 ml-3 list-disc text-xs text-red-400/80 space-y-0.5">
                          {s.ttErrors.map((e, j) => (
                            <li key={j}><span className="font-mono text-red-300">[{e.code}]</span> {e.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                ) : (
                  <span>Your order was rejected by the broker. See details in the status panel below.</span>
                )}
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
                  const rowContractMult = getContractMultiplier(order.symbol);
                  const totalPremium = netPrice * rowContractMult * qty;
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
                          {isIronCondor && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              4-leg condor
                            </span>
                          )}
                          {/* Exchange badge for index options */}
                          {isTrueIndexOption(order.symbol) && (() => {
                            const exch = getIndexExchange(order.symbol);
                            return (
                              <span className={`text-[9px] font-semibold px-1 py-0.5 rounded mt-0.5 w-fit ${
                                exch === 'Nasdaq'
                                  ? 'bg-blue-900 text-blue-200'
                                  : 'bg-amber-900 text-amber-200'
                              }`}>
                                {exch === 'Nasdaq' ? 'NASDAQ' : 'CBOE'}
                              </span>
                            );
                          })()}
                          {/* Underlying stock price */}
                          {order.currentPrice != null && order.currentPrice > 0 && (
                            <span className="text-[10px] text-blue-300 font-normal mt-0.5">
                              @ ${order.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                              <div className="text-xs space-y-1.5">
                                {/* PUT spread legs */}
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-green-500 text-[10px] uppercase tracking-wide">PUT Spread</div>
                                  <div className="text-green-400">Short: <span className="font-semibold">${order.strike.toFixed(2)}</span>
                                    {(order.bid != null || order.ask != null) && (
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        (B: ${order.bid?.toFixed(2)} / A: ${order.ask?.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-muted-foreground">Long: <span className="font-semibold">${order.longStrike?.toFixed(2)}</span>
                                    {(order.longBid != null || order.longAsk != null) && (
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        (B: ${order.longBid?.toFixed(2)} / A: ${order.longAsk?.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* CALL spread legs */}
                                <div className="space-y-0.5 border-t border-white/10 pt-1">
                                  <div className="font-semibold text-red-500 text-[10px] uppercase tracking-wide">CALL Spread</div>
                                  <div className="text-red-400">Short: <span className="font-semibold">${order.callShortStrike?.toFixed(2)}</span>
                                    {(order.callShortBid != null || order.callShortAsk != null) && (
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        (B: ${order.callShortBid?.toFixed(2)} / A: ${order.callShortAsk?.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-muted-foreground">Long: <span className="font-semibold">${order.callLongStrike?.toFixed(2)}</span>
                                    {(order.callLongBid != null || order.callLongAsk != null) && (
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        (B: ${order.callLongBid?.toFixed(2)} / A: ${order.callLongAsk?.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          // BPS: show short put / long put with bid/ask
                          if (isBPSOrder) {
                            return (
                              <div className="text-xs space-y-1">
                                <div className="space-y-0">
                                  <div className="text-green-400">Short: <span className="font-semibold">${order.strike.toFixed(2)}</span></div>
                                  {(order.bid != null || order.ask != null) && (
                                    <div className="text-[10px] text-muted-foreground pl-2">
                                      {order.bid != null && <span>B: ${order.bid.toFixed(2)}</span>}
                                      {order.bid != null && order.ask != null && <span className="mx-0.5">/</span>}
                                      {order.ask != null && <span>A: ${order.ask.toFixed(2)}</span>}
                                    </div>
                                  )}
                                </div>
                                <div className="space-y-0">
                                  <div className="text-muted-foreground">Long: <span className="font-semibold">${order.longStrike!.toFixed(2)}</span></div>
                                  {(order.longBid != null || order.longAsk != null) && (
                                    <div className="text-[10px] text-muted-foreground pl-2">
                                      {order.longBid != null && <span>B: ${order.longBid.toFixed(2)}</span>}
                                      {order.longBid != null && order.longAsk != null && <span className="mx-0.5">/</span>}
                                      {order.longAsk != null && <span>A: ${order.longAsk.toFixed(2)}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          // BCS: show short call / long call with bid/ask
                          if (isBCSOrder) {
                            return (
                              <div className="text-xs space-y-1">
                                <div className="space-y-0">
                                  <div className="text-red-400">Short: <span className="font-semibold">${order.strike.toFixed(2)}</span></div>
                                  {(order.bid != null || order.ask != null) && (
                                    <div className="text-[10px] text-muted-foreground pl-2">
                                      {order.bid != null && <span>B: ${order.bid.toFixed(2)}</span>}
                                      {order.bid != null && order.ask != null && <span className="mx-0.5">/</span>}
                                      {order.ask != null && <span>A: ${order.ask.toFixed(2)}</span>}
                                    </div>
                                  )}
                                </div>
                                <div className="space-y-0">
                                  <div className="text-muted-foreground">Long: <span className="font-semibold">${order.longStrike!.toFixed(2)}</span></div>
                                  {(order.longBid != null || order.longAsk != null) && (
                                    <div className="text-[10px] text-muted-foreground pl-2">
                                      {order.longBid != null && <span>B: ${order.longBid.toFixed(2)}</span>}
                                      {order.longBid != null && order.longAsk != null && <span className="mx-0.5">/</span>}
                                      {order.longAsk != null && <span>A: ${order.longAsk.toFixed(2)}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          // For BTC spread orders, show both short and long strikes with clear labels
                          if (isBTCSpread && order.optionSymbol) {
                            const typeMatch = order.optionSymbol.match(/([CP])(\d{8})$/);
                            const optType = typeMatch ? (typeMatch[1] === 'P' ? 'Put' : 'Call') : null;
                            // Parse long leg strike from spreadLongSymbol OCC format
                            let longLegStrike: number | undefined;
                            if (order.spreadLongSymbol) {
                              const lm = order.spreadLongSymbol.match(/[CP](\d{8})$/);
                              if (lm) longLegStrike = parseInt(lm[1], 10) / 1000;
                            }
                            return (
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] text-muted-foreground">Short (BTC)</span>
                                  <span className={`font-semibold ${optType === 'Put' ? 'text-green-400' : 'text-red-400'}`}>
                                    ${displayStrike > 0 ? displayStrike.toFixed(0) : '—'}
                                  </span>
                                </div>
                                {longLegStrike !== undefined && (
                                  <div className="flex flex-col items-end border-t border-white/10 pt-0.5">
                                    <span className="text-[10px] text-muted-foreground">Long (STC)</span>
                                    <span className="font-semibold text-blue-400">
                                      ${longLegStrike.toFixed(0)}
                                    </span>
                                  </div>
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
                      <TableCell className="text-right overflow-visible">
                        {allowQuantityEdit ? (
                          <div className="flex items-center justify-end gap-1 min-w-[5rem]">
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
                          {/* Net Credit badge for STO spread orders */}
                          {(isBPSOrder || isBCSOrder || (!!order.longStrike && order.action !== 'BTC')) && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80 bg-emerald-400/10 border border-emerald-400/20 rounded px-1 py-0.5 mb-0.5">
                              Net Credit
                            </span>
                          )}
                          {/* Net Credit / Net Debit badge for BTC spread close orders */}
                          {strategy === 'btc' && isBTCSpread && (() => {
                            // Mirror the server-side determinePriceEffect() logic:
                            //   BPS close: STC the long PUT (higher strike) → net CREDIT received
                            //   BCS close: BTC the short CALL (lower strike) → net DEBIT paid
                            //   IC close (4-leg): BCS debit dominates → net DEBIT
                            // Detection: read option type from OCC symbol at char index 12 (C or P)
                            const isIronCondorClose = !!(order.callShortStrike && order.callLongStrike);
                            let isCreditClose = false;
                            if (!isIronCondorClose) {
                              // Prefer spreadLongSymbol (most reliable — it's the actual long leg OCC symbol)
                              const longSym = order.spreadLongSymbol || order.optionSymbol || '';
                              const optChar = longSym.charAt(12);
                              // If spreadLongSymbol: optChar === 'P' means selling back a long PUT → Credit
                              // If optionSymbol (short leg): optChar === 'P' means it's a BPS → Credit
                              isCreditClose = optChar === 'P';
                            }
                            return isCreditClose ? (
                              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/15 border border-emerald-400/30 rounded px-1.5 py-0.5 mb-0.5 inline-flex items-center gap-0.5">
                                ↑ Net Credit
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/15 border border-amber-400/30 rounded px-1.5 py-0.5 mb-0.5 inline-flex items-center gap-0.5">
                                ↓ Net Debit
                              </span>
                            );
                          })()}
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
                                {(() => {
                                  const isIndex = isTrueIndexOption(order.symbol);
                                  // IC (4-leg): total net credit = put spread + call spread
                                  if (order.callShortBid != null && order.callShortAsk != null &&
                                      order.callLongBid != null && order.callLongAsk != null &&
                                      order.longBid != null && order.longAsk != null) {
                                    const putNetLow  = Math.max(0.01, (effectiveBid! - order.longAsk));
                                    const putNetHigh = Math.max(0.01, (effectiveAsk! - order.longBid));
                                    const callNetLow  = Math.max(0.01, (order.callShortBid - order.callLongAsk));
                                    const callNetHigh = Math.max(0.01, (order.callShortAsk - order.callLongBid));
                                    const totalLow  = snapToTick(putNetLow  + callNetLow,  order.symbol);
                                    const totalHigh = snapToTick(putNetHigh + callNetHigh, order.symbol);
                                    return <span>Net: ${totalLow.toFixed(2)} – ${totalHigh.toFixed(2)}{isIndex ? ' ★' : ''}</span>;
                                  }
                                  // BPS / BCS (2-leg): net credit range
                                  if (order.longBid != null && order.longAsk != null &&
                                      effectiveBid != null && effectiveAsk != null) {
                                    const netLow  = snapToTick(Math.max(0.01, effectiveBid - order.longAsk), order.symbol);
                                    const netHigh = snapToTick(Math.max(0.01, effectiveAsk - order.longBid), order.symbol);
                                    return <span>Net: ${netLow.toFixed(2)} – ${netHigh.toFixed(2)}{isIndex ? ' ★' : ''}</span>;
                                  }
                                  // Single-leg: show raw bid/ask
                                  return <span>Bid: ${effectiveBid?.toFixed(2)} / Ask: ${effectiveAsk?.toFixed(2)}</span>;
                                })()}
                              </div>
                            </div>
                          )}
                          {/* Live/Estimated indicator for ALL strategies */}
                          {hasLiveQuote ? (
                            <span className="text-[10px] text-green-400 font-medium">● Live</span>
                          ) : (
                            <span className="text-[10px] text-yellow-500">~ Est.</span>
                          )}
                        </div>
                      </TableCell>
                      
                      {/* Price Adjustment Slider */}
                      <TableCell className="min-w-[320px] w-[320px]">
                        {hasMarketData ? (
                          <div className="flex flex-col gap-2 py-3 px-1 overflow-hidden">
                            {/* Row 1: Bid / Mid / Ask labels */}
                            <div className="flex items-center justify-between text-[10px] px-0.5">
                              <span className="text-red-400 font-mono font-medium">Bid</span>
                              <span className="text-blue-400 font-mono font-medium">Mid</span>
                              <span className="text-green-400 font-mono font-medium">Ask</span>
                            </div>
                            {/* Row 2: Live prices */}
                            {hasLiveQuote && (() => {
                              const liveShortQ = liveQ!;
                              const liveLongQ = order.spreadLongSymbol ? liveQuotes[order.spreadLongSymbol] : undefined;
                              const isSpreadOrder = !!(order.spreadLongSymbol || order.longStrike);
                              if (isSpreadOrder && liveLongQ && liveLongQ.bid > 0 && liveLongQ.ask > 0) {
                                const netBid = Math.max(0.01, liveShortQ.bid - liveLongQ.ask);
                                const netAsk = Math.max(0.01, liveShortQ.ask - liveLongQ.bid);
                                const netMid = (netBid + netAsk) / 2;
                                return (
                                  <div className="flex items-center justify-between text-xs px-0.5">
                                    <span className="text-red-400 font-mono">${netBid.toFixed(2)}</span>
                                    <span className="text-blue-400 font-mono font-bold">${netMid.toFixed(2)}</span>
                                    <span className="text-green-400 font-mono">${netAsk.toFixed(2)}</span>
                                  </div>
                                );
                              } else if (!isSpreadOrder) {
                                const mid = (liveShortQ.bid + liveShortQ.ask) / 2;
                                return (
                                  <div className="flex items-center justify-between text-xs px-0.5">
                                    <span className="text-red-400 font-mono">${liveShortQ.bid.toFixed(2)}</span>
                                    <span className="text-blue-400 font-mono font-bold">${mid.toFixed(2)}</span>
                                    <span className="text-green-400 font-mono">${liveShortQ.ask.toFixed(2)}</span>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                            {/* Row 3: Slider with mid marker */}
                            <div className="relative">
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
                              
                            </div>
                            {/* Row 4: Price controls — centered with +/- buttons */}
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const tick = getTickSize(price, order.symbol);
                                  return (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0 rounded-full"
                                        onClick={() => adjustPrice(orderWithLive, -tick)}
                                        disabled={isSubmitting}
                                        title={`Decrease by $${tick.toFixed(2)}`}
                                      >
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <div className="flex flex-col items-center min-w-[52px]">
                                        {(isBPSOrder || isBCSOrder || (!!order.longStrike && order.action !== 'BTC')) && (
                                          <span className="text-[8px] font-semibold uppercase tracking-wider text-emerald-400/70 leading-none mb-0.5">
                                            Net Credit
                                          </span>
                                        )}
                                        <span className="text-sm font-mono font-bold text-blue-400 text-center">
                                          ${price.toFixed(2)}
                                        </span>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0 rounded-full"
                                        onClick={() => adjustPrice(orderWithLive, tick)}
                                        disabled={isSubmitting}
                                        title={`Increase by $${tick.toFixed(2)}`}
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    </>
                                  );
                                })()}
                              </div>
                              {/* AI Optimize Price button */}
                              {hasMarketData && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[10px] px-2 gap-1 border-purple-500/40 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
                                  disabled={isOptimizingPrice || isSubmitting}
                                  onClick={async () => {
                                    const liveShortQ = liveQuotes[order.optionSymbol ?? ''];
                                    const rawShortBid = liveShortQ?.bid ?? effectiveBid ?? 0;
                                    const rawShortAsk = liveShortQ?.ask ?? effectiveAsk ?? 0;
                                    const isSpreadOrder = !!(order.longStrike);
                                    // For spread orders: compute net credit bid/ask from both legs
                                    let eBid: number;
                                    let eAsk: number;
                                    if (isSpreadOrder) {
                                      const liveLongQ = order.spreadLongSymbol ? liveQuotes[order.spreadLongSymbol] : undefined;
                                      const longBidVal = (liveLongQ && liveLongQ.bid > 0) ? liveLongQ.bid : (order.longBid ?? 0);
                                      const longAskVal = (liveLongQ && liveLongQ.ask > 0) ? liveLongQ.ask : (order.longAsk ?? 0);
                                      // Net credit: short bid - long ask (conservative) to short ask - long bid (aggressive)
                                      eBid = Math.max(0.01, rawShortBid - longAskVal);
                                      eAsk = Math.max(0.01, rawShortAsk - longBidVal);
                                    } else {
                                      eBid = rawShortBid;
                                      eAsk = rawShortAsk;
                                    }
                                    const eMid = (eBid + eAsk) / 2;
                                    const currentPrice = adjustedPrices.get(getOrderKey(order)) ?? order.premium;
                                    if (!eBid || !eAsk) return;
                                    setIsOptimizingPrice(true);
                                    try {
                                      const result = await optimizePriceMutation.mutateAsync({
                                        symbol: order.symbol,
                                        action: order.action as 'STO' | 'BTC' | 'BTO' | 'STC',
                                        strategy,
                                        bid: eBid,
                                        ask: eAsk,
                                        mid: eMid,
                                        currentLimitPrice: currentPrice,
                                        expiration: order.expiration,
                                        strike: order.strike,
                                        optionType: order.optionType,
                                        isSpread: isSpreadOrder,
                                        spreadWidth: order.longStrike ? Math.abs(order.strike - order.longStrike) : undefined,
                                      });
                                      const newPrices = new Map(adjustedPrices);
                                      newPrices.set(getOrderKey(order), result.suggestedPrice);
                                      setAdjustedPrices(newPrices);
                                      setPriceAdvice(result);
                                    } catch (e) {
                                      // ignore
                                    } finally {
                                      setIsOptimizingPrice(false);
                                    }
                                  }}
                                >
                                  {isOptimizingPrice ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                  {isOptimizingPrice ? 'Analyzing...' : 'AI Optimize'}
                                </Button>
                              )}
                            </div>
                            {/* Row 5: Fill zone + probability with tooltip */}
                            {(() => {
                              const sliderPos = getSliderPosition(orderWithLive)[0];
                              const guidance = getFillZoneGuidance(sliderPos, order.action);
                              const fillPct = order.action === 'STO'
                                ? Math.min(95, Math.max(10, Math.round(sliderPos * 0.85 + 5)))
                                : Math.min(95, Math.max(10, Math.round((100 - sliderPos) * 0.85 + 5)));
                              const fillColor = fillPct >= 65 ? 'text-green-400' : fillPct >= 40 ? 'text-yellow-400' : 'text-red-400';
                              return (
                                <div className="flex items-center justify-between text-[10px] pt-0.5 border-t border-border/30">
                                  <span className={guidance.color}>{guidance.text}</span>
                                  <span
                                    className={`${fillColor} cursor-help`}
                                    title="Estimated fill probability: how likely your limit order fills based on where your price sits in the bid-ask range. Near the ask = faster fill, lower premium. Near the bid = slower fill, more premium captured."
                                  >
                                    ~{fillPct}% fill
                                  </span>
                                </div>
                              );
                            })()}
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
          
          {/* Live position check loading indicator */}
          {(strategy === 'btc' || strategy === 'roll') && closeValidationInput && !closeValidationData && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Checking live position quantities from Tastytrade…</span>
            </div>
          )}

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
          
          {/* AI Price Advice Panel — full-width band between table and summary */}
          {priceAdvice && (
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-200">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="flex items-center gap-1.5 font-semibold text-purple-100">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  AI Price Advice
                </span>
                <span className="font-semibold">✓ Applied: <span className="text-green-300">${priceAdvice.suggestedPrice.toFixed(2)}</span></span>
                <span className={`font-semibold ${
                  priceAdvice.fillProbability === 'high' ? 'text-green-400' :
                  priceAdvice.fillProbability === 'medium' ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {priceAdvice.fillProbability === 'high' ? '↑ High fill probability' : priceAdvice.fillProbability === 'medium' ? '→ Medium fill probability' : '↓ Low fill probability'}
                </span>
                <button
                  onClick={() => setPriceAdvice(null)}
                  className="ml-auto text-purple-400/60 hover:text-purple-300 text-xs"
                  title="Dismiss"
                >✕</button>
              </div>
              <p className="text-purple-300/80 leading-relaxed text-xs">{priceAdvice.reasoning}</p>
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
                  {(strategy === 'bps' || strategy === 'bcs' || strategy === 'iron_condor') && calculateTotalCollateral() > 0 && (() => {
                    const totalPrem = calculateTotalPremium();
                    const totalColl = calculateTotalCollateral();
                    // Max Risk = Gross Collateral (spread width × mult × qty) − Premium received
                    // ROC = Premium / MaxRisk (not Premium / GrossCollateral)
                    const maxRisk = totalColl - totalPrem;
                    const roc = maxRisk > 0 ? (totalPrem / maxRisk) * 100 : 0;
                    return (
                      <div className="flex justify-between col-span-2 pt-2 border-t border-border/50">
                        <span className="text-muted-foreground font-medium">Return on Capital:</span>
                        <span className="font-semibold text-blue-400">
                          {roc.toFixed(2)}%
                          <span className="text-xs text-muted-foreground ml-1">
                            (${totalPrem.toFixed(2)} / ${maxRisk.toFixed(2)} max risk)
                          </span>
                        </span>
                      </div>
                    );
                  })()}
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

          {/* Paper Trade Confirmation Banner */}
          {paperOrderResult && tradingMode === 'paper' && (
            <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/30 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-400 flex-shrink-0" />
                <h4 className="font-semibold text-blue-300">Paper Trade Recorded</h4>
              </div>
              <p className="text-sm text-blue-200/80">
                {paperOrderResult.message}
              </p>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">Order ID:</span>
                <span className="font-mono text-blue-300">#{paperOrderResult.orderId}</span>
                <span className="text-muted-foreground">Premium:</span>
                <span className="font-semibold text-green-400">${paperOrderResult.totalPremiumDollars.toFixed(2)}</span>
              </div>
              <p className="text-xs text-muted-foreground">View in Portfolio → Paper Orders tab</p>
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
                  <div
                    key={idx}
                    className={`p-2 rounded ${
                      status.status === 'Rejected'
                        ? 'bg-red-500/10 border border-red-500/30'
                        : 'bg-background/50'
                    }`}
                  >
                    {/* Symbol + badge row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{status.symbol}</span>
                        {status.status === 'Filled' && <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">Filled ✓</Badge>}
                        {status.status === 'Working' && <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">Working</Badge>}
                        {status.status === 'Cancelled' && <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">Cancelled</Badge>}
                        {status.status === 'Rejected' && <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/50">Rejected ✗</Badge>}
                        {status.status === 'MarketClosed' && <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">Market Closed</Badge>}
                        {status.status === 'Pending' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
                      {/* Show message on the right only for non-rejected statuses */}
                      {status.status !== 'Rejected' && status.message && (
                        <span className="text-sm text-muted-foreground">{status.message}</span>
                      )}
                    </div>
                    {/* Rejection details — shown below the symbol row */}
                    {status.status === 'Rejected' && (
                      <div className="mt-1.5 space-y-1">
                        <div className="flex items-start gap-1.5 group">
                          <p className="flex-1 text-sm font-medium text-red-400">
                            {status.message || 'Order submission failed'}
                          </p>
                          <CopyButton
                            text={[
                              `${status.symbol}: ${status.message || 'Order submission failed'}`,
                              ...(status.ttErrors && status.ttErrors.length > 1
                                ? status.ttErrors.map(e => `  [${e.code}] ${e.message}`)
                                : []),
                              ...(status.ttCode
                                ? [`Code: ${status.ttCode}${status.ttStatus ? ` · HTTP ${status.ttStatus}` : ''}`]
                                : []),
                            ].join('\n')}
                          />
                        </div>
                        {/* Additional preflight errors beyond the first */}
                        {status.ttErrors && status.ttErrors.length > 1 && (
                          <ul className="ml-2 list-disc text-xs text-red-400/70 space-y-0.5">
                            {status.ttErrors.map((e, j) => (
                              <li key={j}>
                                <span className="font-mono text-red-300/80">[{e.code}]</span> {e.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {/* Error code + HTTP status footer */}
                        {(status.ttCode || status.ttStatus) && (
                          <p className="text-xs text-red-400/50 font-mono">
                            {status.ttCode && <>Code: {status.ttCode}</>}
                            {status.ttCode && status.ttStatus && ' · '}
                            {status.ttStatus && <>HTTP {status.ttStatus}</>}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {/* Fill Aggressiveness Presets — quick-set all order prices at once */}
          <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
            <span className="text-xs text-muted-foreground mr-1 whitespace-nowrap">Fill speed:</span>
            {([
              { label: 'Bid', pct: 0,   title: 'Set all prices to bid side — highest fill chance, least favorable price' },
              { label: '25%', pct: 25,  title: 'Set all prices 25% from bid toward mid' },
              { label: 'Mid', pct: 50,  title: 'Set all prices to midpoint — balanced fill/price' },
              { label: '75%', pct: 75,  title: 'Set all prices 75% from bid toward ask — better price, slower fill' },
              { label: 'Ask', pct: 100, title: 'Set all prices to ask side — best price, least likely to fill' },
            ] as const).map(({ label, pct, title }) => (
              <Button
                key={label}
                size="sm"
                variant="outline"
                className={`h-7 px-2 text-xs ${
                  label === 'Bid' ? 'border-green-600/50 text-green-400 hover:bg-green-600/10' :
                  label === 'Mid' ? 'border-blue-600/50 text-blue-400 hover:bg-blue-600/10' :
                  label === 'Ask' ? 'border-orange-600/50 text-orange-400 hover:bg-orange-600/10' :
                  'border-muted text-muted-foreground hover:bg-muted/30'
                }`}
                title={title}
                disabled={isSubmitting || submissionComplete}
                onClick={() => {
                  const newPrices = new Map(adjustedPrices);
                  orders.forEach(order => {
                    const key = getOrderKey(order);
                    const { minPrice, maxPrice } = getOrderPriceRange(order);
                    const rawPrice = minPrice + (maxPrice - minPrice) * (pct / 100);
                    newPrices.set(key, snapToTick(Math.max(0.01, rawPrice), order.symbol));
                  });
                  setAdjustedPrices(newPrices);
                }}
              >
                {label}
              </Button>
            ))}
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleResetAllToMidpoint}
              disabled={isSubmitting || submissionComplete}
              className="h-7 px-2 text-xs border-blue-600/50 text-blue-400 hover:bg-blue-600/10 whitespace-nowrap"
              title="Reset all prices to the Good Fill Zone (mid + 25% toward ask for BTC, mid for STO)"
            >
              ⚡ Good Fill Zone
            </Button>
          </div>
          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
          {submissionComplete ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  // Reset all submission state so the modal can be reused for a new batch
                  setDryRunSuccess(false);
                  setOrderStatuses([]);
                  setIsPolling(false);
                  submittedOrderIdsRef.current = [];
                  setSubmissionState(false, null);
                  onOpenChange(false);
                }}
                className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
              >
                <span className="mr-2">🔄</span>
                Submit Another Batch
              </Button>
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Close
              </Button>
            </>
          ) : tradingMode === "paper" ? (
            /* Paper mode: show Simulate Trade button instead of live buttons */
            <Button
              onClick={handlePaperSubmit}
              disabled={!canSubmit || isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <span className="mr-2">📝</span>
              }
              Simulate Trade
            </Button>
          ) : (!dryRunSuccess || skipDryRun) ? (
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
                disabled={!canSubmit}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Live Orders
              </Button>
            )
          ) : (
            <Button
              onClick={handleLiveSubmit}
              variant="destructive"
              disabled={!canSubmit}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Live
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
