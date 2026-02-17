import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, TrendingDown, DollarSign, Calendar, Target } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ShortCallScannerProps {
  leapPositions: any[];
  onRefreshPositions: () => void;
}

export function ShortCallScanner({ leapPositions, onRefreshPositions }: ShortCallScannerProps) {
  const [selectedLeaps, setSelectedLeaps] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());

  // Scan short call opportunities mutation
  const scanShortCallsMutation = trpc.pmcc.scanShortCallOpportunities.useMutation({
    onSuccess: (data) => {
      setOpportunities(data.opportunities);
      setIsScanning(false);
      toast.success(`Found ${data.opportunities.length} short call opportunities`);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to scan short calls");
      setIsScanning(false);
    },
  });

  const handleScanShortCalls = () => {
    if (selectedLeaps.size === 0) {
      toast.error('Please select at least one LEAP position');
      return;
    }

    setIsScanning(true);
    setOpportunities([]);
    setSelectedOpportunities(new Set());

    // Convert selected LEAPs to input format
    const leapPositionsInput = Array.from(selectedLeaps).map(leapKey => {
      const leap = leapPositions.find(p => `${p.symbol}-${p.optionSymbol}` === leapKey);
      return {
        symbol: leap.symbol,
        optionSymbol: leap.optionSymbol,
        strike: leap.strike,
        expiration: leap.expiration,
        quantity: leap.quantity,
      };
    });

    scanShortCallsMutation.mutate({
      leapPositions: leapPositionsInput,
      minDte: 7,
      maxDte: 45,
      minDelta: 0.15,
      maxDelta: 0.35,
    });
  };

  const toggleLeapSelection = (leapKey: string) => {
    const newSelected = new Set(selectedLeaps);
    if (newSelected.has(leapKey)) {
      newSelected.delete(leapKey);
    } else {
      newSelected.add(leapKey);
    }
    setSelectedLeaps(newSelected);
  };

  const toggleOpportunitySelection = (oppKey: string) => {
    const newSelected = new Set(selectedOpportunities);
    if (newSelected.has(oppKey)) {
      newSelected.delete(oppKey);
    } else {
      newSelected.add(oppKey);
    }
    setSelectedOpportunities(newSelected);
  };

  if (leapPositions.length === 0) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Short Call Scanner
          </CardTitle>
          <CardDescription>Sell calls against your LEAP positions for income</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>No LEAP positions available.</p>
            <p className="text-sm mt-2">Purchase LEAPs first to enable short call selling.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              Short Call Scanner
            </CardTitle>
            <CardDescription>Sell calls against your LEAP positions for income</CardDescription>
          </div>
          <Button 
            onClick={handleScanShortCalls} 
            disabled={isScanning || selectedLeaps.size === 0}
            size="sm"
          >
            {isScanning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              `Scan Short Calls (${selectedLeaps.size})`
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1: Select LEAPs */}
        <div>
          <Label className="text-base font-semibold mb-3 block">
            Step 1: Select LEAP Positions
          </Label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {leapPositions.map((leap: any) => {
              const leapKey = `${leap.symbol}-${leap.optionSymbol}`;
              const isSelected = selectedLeaps.has(leapKey);
              
              return (
                <div
                  key={leapKey}
                  onClick={() => toggleLeapSelection(leapKey)}
                  className={cn(
                    "p-4 border-2 rounded-lg cursor-pointer transition-all",
                    isSelected 
                      ? "border-purple-500 bg-purple-500/10" 
                      : "border-border hover:border-purple-500/50"
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold text-lg">{leap.symbol}</div>
                      <div className="text-sm text-muted-foreground">
                        ${leap.strike.toFixed(2)} Call
                      </div>
                    </div>
                    <Checkbox checked={isSelected} />
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>Exp: {new Date(leap.expiration).toLocaleDateString()}</div>
                    <div>Qty: {leap.quantity}</div>
                    <div className={leap.profitLoss >= 0 ? 'text-green-500' : 'text-red-500'}>
                      P/L: {leap.profitLoss >= 0 ? '+' : ''}{leap.profitLossPercent.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 2: Short Call Opportunities */}
        {opportunities.length > 0 && (
          <div>
            <Label className="text-base font-semibold mb-3 block">
              Step 2: Select Short Calls to Sell ({opportunities.length} opportunities)
            </Label>
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium">Select</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">LEAP</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">Strike</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">Expiration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">DTE</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">Premium</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">Delta</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">ROC %</th>
                      <th className="px-4 py-3 text-left text-xs font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((opp: any) => {
                      const oppKey = `${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`;
                      const isSelected = selectedOpportunities.has(oppKey);
                      
                      return (
                        <tr
                          key={oppKey}
                          onClick={() => toggleOpportunitySelection(oppKey)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSelected ? "bg-purple-500/10" : "hover:bg-muted/30"
                          )}
                        >
                          <td className="px-4 py-3">
                            <Checkbox checked={isSelected} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{opp.underlyingSymbol}</div>
                            <div className="text-xs text-muted-foreground">
                              LEAP: ${opp.leapStrike}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">${opp.strike.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm">
                            {new Date(opp.expiration).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm">{opp.dte}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-green-500 font-medium">
                              <DollarSign className="h-3 w-3" />
                              {opp.premium.toFixed(2)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm">{opp.delta.toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "text-sm font-medium",
                              opp.roc >= 5 ? "text-green-500" : "text-muted-foreground"
                            )}>
                              {opp.roc.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className={cn(
                              "inline-flex items-center justify-center w-12 h-8 rounded text-xs font-bold",
                              opp.score >= 80 ? "bg-green-500/20 text-green-500" :
                              opp.score >= 60 ? "bg-amber-500/20 text-amber-500" :
                              "bg-red-500/20 text-red-500"
                            )}>
                              {opp.score}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Submit Button */}
            {selectedOpportunities.size > 0 && (
              <div className="flex items-center justify-between mt-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <div className="font-semibold">
                    {selectedOpportunities.size} short call{selectedOpportunities.size > 1 ? 's' : ''} selected
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total premium: ${opportunities
                      .filter(opp => selectedOpportunities.has(`${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`))
                      .reduce((sum, opp) => sum + opp.premium, 0)
                      .toFixed(2)}
                  </div>
                </div>
                <Button 
                  size="lg" 
                  className="bg-purple-600 hover:bg-purple-700"
                  onClick={() => toast.info('Order submission coming soon! For now, use the CC Dashboard to manually sell calls against your LEAPs.')}
                >
                  <Target className="mr-2 h-4 w-4" />
                  Preview Orders
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
