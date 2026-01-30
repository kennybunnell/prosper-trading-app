import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, TrendingDown, TrendingUp, Calendar, DollarSign, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface OrderLeg {
  action: 'BTC' | 'STO' | 'BTO' | 'STC';
  quantity: number;
  symbol: string;
  strike: number;
  expiration: string;
  optionType: 'PUT' | 'CALL';
  price: number;
}

interface OrderPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderDetails: {
    symbol: string;
    strategy: string;
    closeLeg: OrderLeg;
    openLeg: OrderLeg;
    netCost: number;
    currentProfit: number;
    projectedProfit: number;
  } | null;
  onConfirm: () => void;
  isSubmitting?: boolean;
}

export function OrderPreviewModal({
  open,
  onOpenChange,
  orderDetails,
  onConfirm,
  isSubmitting = false,
}: OrderPreviewModalProps) {
  if (!orderDetails) return null;

  const { symbol, strategy, closeLeg, openLeg, netCost, currentProfit, projectedProfit } = orderDetails;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm Roll Order for {symbol}</DialogTitle>
          <DialogDescription>
            Review the 2-leg order details before submission
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Warning Alert */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This will execute a 2-leg order to close your current position and open a new one. Please review carefully before confirming.
            </AlertDescription>
          </Alert>

          {/* Order Legs */}
          <div className="space-y-4">
            {/* Leg 1: Close */}
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">Leg 1: Close</Badge>
                  <span className="text-sm font-medium">{closeLeg.action}</span>
                </div>
                <TrendingDown className="w-5 h-5 text-red-600" />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Position:</span>
                  <span className="font-medium">{closeLeg.quantity} {symbol} ${closeLeg.strike} {closeLeg.optionType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expiration:</span>
                  <span className="font-medium">{new Date(closeLeg.expiration).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price:</span>
                  <span className="font-medium text-red-600">${closeLeg.price.toFixed(2)} debit</span>
                </div>
              </div>
            </div>

            {/* Leg 2: Open */}
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="default">Leg 2: Open</Badge>
                  <span className="text-sm font-medium">{openLeg.action}</span>
                </div>
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Position:</span>
                  <span className="font-medium">{openLeg.quantity} {symbol} ${openLeg.strike} {openLeg.optionType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expiration:</span>
                  <span className="font-medium">{new Date(openLeg.expiration).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price:</span>
                  <span className="font-medium text-green-600">${openLeg.price.toFixed(2)} credit</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net Cost Summary */}
          <div className="border-2 border-primary/20 rounded-lg p-4 bg-primary/5">
            <h3 className="font-semibold mb-3">Order Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Profit (if closed now):</span>
                <span className={`font-medium ${currentProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${Math.abs(currentProfit).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Roll Cost:</span>
                <span className={`font-medium ${netCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${Math.abs(netCost).toFixed(2)} {netCost >= 0 ? 'credit' : 'debit'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">New Premium Collected:</span>
                <span className="font-medium text-green-600">${openLeg.price.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 mt-2">
                <div className="flex justify-between">
                  <span className="font-semibold">Projected Total Profit:</span>
                  <span className={`font-bold text-lg ${projectedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${Math.abs(projectedProfit).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting Order...
                </>
              ) : (
                'Submit Roll Order'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
