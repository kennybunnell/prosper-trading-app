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
import { AlertTriangle, CheckCircle2, Clock, XCircle, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Streamdown } from "streamdown";

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
  onSubmit: () => void;
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
      <DialogContent className="w-fit min-w-[800px] max-w-[98vw] max-h-[90vh] overflow-y-auto border-2 border-orange-500">
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
                <TableHead className="text-right w-24">Premium</TableHead>
                <TableHead className="text-right w-28">Capital Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order, idx) => (
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
                  <TableCell className="text-right text-green-600 font-semibold">
                    ${order.premium.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    ${order.collateral.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals Row */}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell colSpan={6} className="text-right">TOTALS</TableCell>
                <TableCell className="text-right text-green-600">
                  ${totalPremium.toFixed(2)}
                </TableCell>
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
              onSubmit();
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
