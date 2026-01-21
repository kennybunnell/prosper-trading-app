import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, DollarSign } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Opportunity {
  symbol: string;
  strike: number;
  expiration: string;
  dte: number;
  premium: number;
  delta: number;
  optionSymbol: string;
  totalScore: number;
}

interface OrderPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunities: Opportunity[];
  onConfirm: () => void;
  isSubmitting: boolean;
}

export function OrderPreviewDialog({
  open,
  onOpenChange,
  opportunities,
  onConfirm,
  isSubmitting,
}: OrderPreviewDialogProps) {
  const totalPremium = opportunities.reduce((sum, opp) => sum + opp.premium * 100, 0);
  const totalCollateral = opportunities.reduce((sum, opp) => sum + opp.strike * 100, 0);
  const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Order Preview - Cash-Secured Puts
          </DialogTitle>
          <DialogDescription>
            Review your orders before submission to Tastytrade
          </DialogDescription>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 my-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Total Premium</div>
              <div className="text-2xl font-bold text-green-500">
                ${totalPremium.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Collateral Required</div>
              <div className="text-2xl font-bold">${totalCollateral.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Return on Capital</div>
              <div className="text-2xl font-bold">{roc.toFixed(2)}%</div>
            </CardContent>
          </Card>
        </div>

        {/* Orders Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Strike</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Collateral</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opp, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{opp.symbol}</TableCell>
                  <TableCell>${opp.strike.toFixed(2)}</TableCell>
                  <TableCell>
                    {new Date(opp.expiration).toLocaleDateString()}
                    <div className="text-xs text-muted-foreground">{opp.dte} DTE</div>
                  </TableCell>
                  <TableCell className="text-green-500 font-medium">
                    ${(opp.premium * 100).toFixed(2)}
                  </TableCell>
                  <TableCell>${(opp.strike * 100).toFixed(2)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{opp.totalScore}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Warning */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            These orders will be submitted as <strong>Sell-to-Open (STO)</strong> cash-secured put
            orders to your Tastytrade account. Make sure you have sufficient buying power.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? (
              <>Submitting...</>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm & Submit Orders
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
