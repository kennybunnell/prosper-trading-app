import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, XCircle, Sparkles, Plus, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { Slider } from "@/components/ui/slider";

interface OrderPreviewItem {
  symbol: string;
  strike: number;
  expiration: string;
  quantity: number;
  premium: number;
  collateral: number;
  status: 'valid' | 'warning' | 'error';
  message?: string;
  currentPrice?: number;
  ivRank?: number | null;
  // Spread-specific fields
  isSpread?: boolean;
  spreadType?: 'bull_put' | 'bear_call';
  longStrike?: number;
  spreadWidth?: number;
  // Market data for price adjustment
  bid?: number;
  ask?: number;
  mid?: number;
}

interface OrderPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: OrderPreviewItem[];
  totalPremium: number;
  totalCollateral: number;
  availableBuyingPower: number;
  remainingBuyingPower: number;
  isMarketOpen: boolean;
  onSubmit: (adjustedPrices?: Map<number, number>) => void;
  isDryRun: boolean;
}

export function OrderPreviewDialog({
  open,
  onOpenChange,
  orders,
  totalPremium,
  totalCollateral,
  availableBuyingPower,
  remainingBuyingPower,
  isMarketOpen,
  onSubmit,
  isDryRun,
}: OrderPreviewDialogProps) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  
  // Track adjusted prices for each order (indexed by order index)
  const [adjustedPrices, setAdjustedPrices] = useState<Map<number, number>>(new Map());
  
  const evaluateOrder = trpc.csp.evaluateOrder.useMutation({
    onSuccess: (data) => {
      setAnalysis(typeof data.analysis === 'string' ? data.analysis : JSON.stringify(data.analysis));
      setShowAnalysis(true);
    },
  });
  
  const handleAnalyze = () => {
    // Map orders to the format expected by the API
    const orderData = orders.map(order => ({
      symbol: order.symbol,
      strike: order.strike,
      expiration: order.expiration,
      premium: order.premium,
      currentPrice: order.currentPrice || 0,
      ivRank: order.ivRank,
      isSpread: order.isSpread,
      spreadType: order.spreadType,
      longStrike: order.longStrike,
      spreadWidth: order.spreadWidth,
    }));
    
    evaluateOrder.mutate({ orders: orderData });
  };
  
  // Adjust price by increment (nickel increments = $0.05)
  const adjustPrice = (orderIdx: number, delta: number) => {
    const order = orders[orderIdx];
    const currentPrice = adjustedPrices.get(orderIdx) ?? order.premium;
    const newPrice = Math.max(0.01, currentPrice + delta);
    
    setAdjustedPrices(new Map(adjustedPrices.set(orderIdx, newPrice)));
  };
  
  // Set price via slider (between bid and mid)
  const setPriceFromSlider = (orderIdx: number, value: number[]) => {
    const order = orders[orderIdx];
    if (!order.bid || !order.mid) return;
    
    // Map slider value (0-100) to price range (bid to mid)
    const priceRange = order.mid - order.bid;
    const newPrice = order.bid + (priceRange * value[0] / 100);
    const roundedPrice = Math.round(newPrice * 100) / 100; // Round to nearest cent
    
    setAdjustedPrices(new Map(adjustedPrices.set(orderIdx, roundedPrice)));
  };
  
  // Get current price for an order (adjusted or original)
  const getCurrentPrice = (orderIdx: number) => {
    return adjustedPrices.get(orderIdx) ?? orders[orderIdx].premium;
  };
  
  // Calculate percentage of mid
  const getPercentOfMid = (orderIdx: number) => {
    const order = orders[orderIdx];
    if (!order.mid) return null;
    const currentPrice = getCurrentPrice(orderIdx);
    return ((currentPrice / order.mid) * 100).toFixed(1);
  };
  
  // Calculate slider position (0-100) based on current price
  const getSliderPosition = (orderIdx: number) => {
    const order = orders[orderIdx];
    if (!order.bid || !order.mid) return [50];
    
    const currentPrice = getCurrentPrice(orderIdx);
    const priceRange = order.mid - order.bid;
    const position = ((currentPrice - order.bid) / priceRange) * 100;
    return [Math.max(0, Math.min(100, position))];
  };
  
  const buyingPowerUsagePercent = (totalCollateral / availableBuyingPower) * 100;
  const highBuyingPowerUsage = buyingPowerUsagePercent > 80;
  
  // Check for concentration risk (>20% in single symbol)
  const symbolConcentration = orders.reduce((acc, order) => {
    const existing = acc.find(item => item.symbol === order.symbol);
    if (existing) {
      existing.collateral += order.collateral;
    } else {
      acc.push({ symbol: order.symbol, collateral: order.collateral });
    }
    return acc;
  }, [] as { symbol: string; collateral: number }[]);
  
  const concentrationWarnings = symbolConcentration
    .filter(item => (item.collateral / totalCollateral) > 0.20)
    .map(item => ({
      symbol: item.symbol,
      percent: ((item.collateral / totalCollateral) * 100).toFixed(1),
    }));

  const hasErrors = orders.some(o => o.status === 'error');
  const hasWarnings = orders.some(o => o.status === 'warning') || highBuyingPowerUsage || concentrationWarnings.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-fit min-w-[900px] max-w-[98vw] max-h-[90vh] overflow-y-auto border-2 border-orange-500">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {isDryRun ? "Dry Run Preview" : "Order Confirmation"}
          </DialogTitle>
          <DialogDescription>
            {isDryRun 
              ? "Review your orders before submission. No real orders will be placed."
              : "Review and confirm your orders. Real orders will be submitted to Tastytrade."}
          </DialogDescription>
        </DialogHeader>

        {/* Market Status Banner */}
        {!isMarketOpen && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-100">Market Closed</p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Orders will be queued and executed when the market opens
              </p>
            </div>
          </div>
        )}

        {/* Safety Warnings */}
        {highBuyingPowerUsage && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-semibold text-red-900 dark:text-red-100">High Buying Power Usage</p>
              <p className="text-sm text-red-700 dark:text-red-300">
                Using {buyingPowerUsagePercent.toFixed(1)}% of available buying power. Consider reducing position sizes.
              </p>
            </div>
          </div>
        )}

        {concentrationWarnings.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-100">Concentration Risk</p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                High concentration in: {concentrationWarnings.map(w => `${w.symbol} (${w.percent}%)`).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Status</TableHead>
                <TableHead className="w-20">Symbol</TableHead>
                <TableHead className="w-36">Strategy</TableHead>
                <TableHead className="text-right w-28">Strikes</TableHead>
                <TableHead className="w-24">Expiration</TableHead>
                <TableHead className="text-right w-12">Qty</TableHead>
                <TableHead className="text-right w-32">Limit Price</TableHead>
                <TableHead className="w-64">Price Adjustment</TableHead>
                <TableHead className="text-right w-28">Capital Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order, idx) => {
                const currentPrice = getCurrentPrice(idx);
                const percentOfMid = getPercentOfMid(idx);
                const hasMarketData = order.bid && order.ask && order.mid;
                
                return (
                  <TableRow key={idx}>
                    <TableCell>
                      {order.status === 'valid' && (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                      {order.status === 'warning' && (
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      )}
                      {order.status === 'error' && (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                    </TableCell>
                    <TableCell className="font-semibold">{order.symbol}</TableCell>
                    <TableCell>
                      {order.isSpread ? (
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-700 dark:text-blue-300">
                          {order.spreadType === 'bull_put' ? 'Bull Put Spread' : 'Bear Call Spread'}
                        </Badge>
                      ) : (
                        <Badge variant="outline">CSP</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {order.isSpread && order.longStrike ? (
                        <div className="flex flex-col items-end">
                          <span className="font-semibold">${order.strike.toFixed(2)}/${order.longStrike.toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground">{order.spreadWidth}pt spread</span>
                        </div>
                      ) : (
                        <span>${order.strike.toFixed(2)}</span>
                      )}
                    </TableCell>
                    <TableCell>{new Date(order.expiration).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">{order.quantity}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end">
                        <span className={`font-semibold ${adjustedPrices.has(idx) ? 'text-blue-600' : 'text-green-600'}`}>
                          ${currentPrice.toFixed(2)}
                        </span>
                        {hasMarketData && (
                          <div className="text-xs text-muted-foreground">
                            <div>Mid: ${order.mid!.toFixed(2)}</div>
                            {percentOfMid && (
                              <div className="text-blue-400">{percentOfMid}% of mid</div>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {hasMarketData ? (
                        <div className="flex flex-col gap-3 py-2">
                          {/* Visual Continuum with Markers */}
                          <div className="relative">
                            {/* Price Labels Row */}
                            <div className="flex justify-between text-xs font-medium mb-1">
                              <span className="text-red-400">Bid ${order.bid!.toFixed(2)}</span>
                              <span className="text-blue-400">Mid ${order.mid!.toFixed(2)}</span>
                              <span className="text-green-400">Ask ${order.ask!.toFixed(2)}</span>
                            </div>
                            
                            {/* Slider with Visual Zones */}
                            <div className="relative px-1">
                              {/* Background gradient showing zones */}
                              <div className="absolute inset-0 h-2 rounded-full overflow-hidden" style={{ top: '50%', transform: 'translateY(-50%)' }}>
                                <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 via-green-500/30 to-yellow-500/30"></div>
                              </div>
                              
                              {/* Fill Zone Marker (around 85-95% of mid) */}
                              <div 
                                className="absolute h-4 w-1 bg-emerald-400 rounded-full shadow-lg" 
                                style={{ 
                                  left: '85%', 
                                  top: '50%', 
                                  transform: 'translate(-50%, -50%)',
                                  zIndex: 1
                                }}
                                title="Optimal fill zone (~90% of mid)"
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
                                value={getSliderPosition(idx)}
                                onValueChange={(value) => setPriceFromSlider(idx, value)}
                                max={100}
                                step={1}
                                className="relative z-10"
                              />
                            </div>
                            
                            {/* Current Price and Position Indicator */}
                            <div className="flex justify-between items-center mt-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0"
                                  onClick={() => adjustPrice(idx, -0.05)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="text-xs font-mono font-bold text-blue-400">
                                  ${currentPrice.toFixed(2)}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0"
                                  onClick={() => adjustPrice(idx, 0.05)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const sliderPos = getSliderPosition(idx)[0];
                                  if (sliderPos < 70) return <span className="text-red-400">⚠️ Too conservative</span>;
                                  if (sliderPos >= 70 && sliderPos < 95) return <span className="text-green-400">✓ Good fill zone</span>;
                                  return <span className="text-yellow-400">⚠️ Too aggressive</span>;
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No market data</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      ${order.collateral.toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Totals Row */}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell colSpan={6} className="text-right">TOTALS</TableCell>
                <TableCell className="text-right text-green-600">
                  ${(() => {
                    // Calculate total premium with adjusted prices
                    const total = orders.reduce((sum, order, idx) => {
                      const currentPrice = adjustedPrices.get(idx) ?? order.premium;
                      return sum + (currentPrice * 100); // Multiply by 100 for per-contract value
                    }, 0);
                    return total.toFixed(2);
                  })()}
                </TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right">
                  ${totalCollateral.toLocaleString()}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="border rounded-lg p-4">
            <p className="text-sm text-muted-foreground mb-1">Available Buying Power</p>
            <p className="text-2xl font-bold">${availableBuyingPower.toLocaleString()}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-muted-foreground mb-1">Remaining After Orders</p>
            <p className={`text-2xl font-bold ${remainingBuyingPower < availableBuyingPower * 0.2 ? 'text-red-600' : 'text-green-600'}`}>
              ${remainingBuyingPower.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ({((remainingBuyingPower / availableBuyingPower) * 100).toFixed(1)}% remaining)
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
            <p className="text-2xl font-bold">{orders.length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {orders.reduce((sum, o) => sum + o.quantity, 0)} contracts
            </p>
          </div>
        </div>

        {/* AI Analysis Section */}
        {showAnalysis && analysis && (
          <div className="mt-4 p-4 bg-blue-950/30 border border-blue-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-5 w-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-blue-400">AI Order Analysis</h3>
            </div>
            <div className="prose prose-invert prose-sm max-w-none">
              <Streamdown>{analysis}</Streamdown>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={handleAnalyze}
            disabled={evaluateOrder.isPending || hasErrors}
            className="border-blue-500 text-blue-400 hover:bg-blue-950/30"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {evaluateOrder.isPending ? "Analyzing..." : "Analyze Order"}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit(adjustedPrices);
              onOpenChange(false);
            }}
            disabled={hasErrors}
            className={isDryRun 
              ? "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
              : "bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
            }
          >
            {isDryRun ? "Run Dry Run" : "Submit Real Orders"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
