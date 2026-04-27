import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, TrendingDown, DollarSign, Target, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTradingMode } from "@/contexts/TradingModeContext";

interface ShortCallScannerProps {
  leapPositions: any[];
  onRefreshPositions: () => void;
  preSelectLeapKey?: string | null;
  onPreSelectConsumed?: () => void;
}

export function ShortCallScanner({ leapPositions, onRefreshPositions, preSelectLeapKey, onPreSelectConsumed }: ShortCallScannerProps) {
  const { mode: tradingMode } = useTradingMode();
  const [selectedLeaps, setSelectedLeaps] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // When a preSelectLeapKey is passed (from "Sell Calls" button on position card),
  // auto-select that LEAP and immediately trigger the scan
  useEffect(() => {
    if (!preSelectLeapKey || leapPositions.length === 0) return;
    const leap = leapPositions.find(p => `${p.symbol}-${p.optionSymbol}` === preSelectLeapKey);
    if (!leap) return;
    setSelectedLeaps(new Set([preSelectLeapKey]));
    onPreSelectConsumed?.();
    // Kick off the scan automatically after state settles
    setTimeout(() => {
      setIsScanning(true);
      setOpportunities([]);
      setSelectedOpportunities(new Set());
      scanShortCallsMutation.mutate({
        leapPositions: [{
          symbol: leap.symbol,
          optionSymbol: leap.optionSymbol,
          strike: leap.strike,
          expiration: leap.expiration,
          quantity: leap.quantity,
        }],
        minDte: 7,
        maxDte: 45,
        minDelta: 0.15,
        maxDelta: 0.35,
      });
    }, 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectLeapKey]);

  // Submit short call orders mutation
  const submitShortCallOrdersMutation = trpc.pmcc.submitShortCallOrders.useMutation({
    onSuccess: (data) => {
      setIsSubmitting(false);
      if (data.summary.failed === 0) {
        toast.success(
          `${isDryRun ? 'Dry run' : 'Order submission'} successful! ${data.summary.success} of ${data.summary.total} orders ${isDryRun ? 'validated' : 'submitted'}.`
        );
      } else {
        toast.warning(`Partial success: ${data.summary.success} succeeded, ${data.summary.failed} failed.`);
      }
      setShowOrderPreview(false);
      if (!isDryRun) {
        setSelectedOpportunities(new Set());
        onRefreshPositions();
      }
    },
    onError: (error) => {
      setIsSubmitting(false);
      toast.error(`Order submission failed: ${error.message}`);
    },
  });

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

  const getSelectedOrdersArray = () =>
    opportunities.filter(opp =>
      selectedOpportunities.has(`${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`)
    );

  // Per-order price overrides: key = `${symbol}-${strike}-${expiration}`, value = adjusted limit price
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});

  // Sort state for results table
  const [sortBy, setSortBy] = useState<string>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const sortedOpportunities = [...opportunities].sort((a, b) => {
    const aVal = a[sortBy] ?? 0;
    const bVal = b[sortBy] ?? 0;
    if (typeof aVal === 'string') return sortDir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    return sortDir === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
  });

  // Reset price overrides when preview opens
  const handleOpenPreview = () => {
    const defaults: Record<string, number> = {};
    getSelectedOrdersArray().forEach(opp => {
      const key = `${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`;
      // Default to midpoint between bid and ask (or premium if bid/ask not available)
      const bid = opp.bid ?? opp.premium * 0.95;
      const ask = opp.ask ?? opp.premium * 1.05;
      defaults[key] = parseFloat(((bid + ask) / 2).toFixed(2));
    });
    setPriceOverrides(defaults);
    setShowOrderPreview(true);
  };

  const handleSubmitOrders = (dryRun: boolean) => {
    const selectedOrders = getSelectedOrdersArray();
    setIsDryRun(dryRun);
    setIsSubmitting(true);
    submitShortCallOrdersMutation.mutate({
      orders: selectedOrders.map(opp => {
        const key = `${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`;
        return {
          underlyingSymbol: opp.underlyingSymbol,
          optionSymbol: opp.optionSymbol,
          strike: opp.strike,
          expiration: opp.expiration,
          premium: priceOverrides[key] ?? opp.premium,
          leapStrike: opp.leapStrike,
          quantity: 1,
        };
      }),
      isDryRun: dryRun,
    });
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

  const selectedOrdersArray = getSelectedOrdersArray();
  const totalSelectedPremium = selectedOrdersArray.reduce((sum, opp) => sum + opp.premium, 0);

  return (
    <>
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-purple-500" />
              Short Call Scanner
            </CardTitle>
            <CardDescription>Sell calls against your LEAP positions for income</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefreshPositions}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh Positions
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
                      {[
                        { key: 'underlyingSymbol', label: 'Symbol' },
                        { key: 'strike', label: 'Strike' },
                        { key: 'expiration', label: 'Expiration' },
                        { key: 'dte', label: 'DTE' },
                        { key: 'premium', label: 'Premium' },
                        { key: 'bid', label: 'Bid' },
                        { key: 'ask', label: 'Ask' },
                        { key: 'delta', label: 'Delta (Δ)' },
                        { key: 'iv', label: 'IV' },
                        { key: 'theta', label: 'Theta (θ)' },
                        { key: 'openInterest', label: 'OI' },
                        { key: 'volume', label: 'Vol' },
                        { key: 'roc', label: 'ROC %' },
                        { key: 'score', label: 'Score' },
                      ].map(col => (
                        <th
                          key={col.key}
                          className="px-4 py-3 text-left text-xs font-medium cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                          onClick={() => handleSort(col.key)}
                        >
                          {col.label}
                          {sortBy === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOpportunities.map((opp: any) => {
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
                          <td className="px-4 py-3"><Checkbox checked={isSelected} /></td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{opp.underlyingSymbol}</div>
                            <div className="text-xs text-muted-foreground">LEAP: ${opp.leapStrike}</div>
                          </td>
                          <td className="px-4 py-3 font-medium">${opp.strike.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm">{new Date(opp.expiration).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm">{opp.dte}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-green-500 font-medium">
                              <DollarSign className="h-3 w-3" />{opp.premium.toFixed(2)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{opp.bid != null ? opp.bid.toFixed(2) : '—'}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{opp.ask != null ? opp.ask.toFixed(2) : '—'}</td>
                          <td className="px-4 py-3 text-sm">{opp.delta != null ? opp.delta.toFixed(2) : '—'}</td>
                          <td className="px-4 py-3 text-sm">{opp.iv != null ? (opp.iv * 100).toFixed(1) + '%' : '—'}</td>
                          <td className="px-4 py-3 text-sm text-red-400">{opp.theta != null ? opp.theta.toFixed(3) : '—'}</td>
                          <td className="px-4 py-3 text-sm">{opp.openInterest ?? '—'}</td>
                          <td className="px-4 py-3 text-sm">{opp.volume ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={cn("text-sm font-medium", opp.roc >= 5 ? "text-green-500" : "text-muted-foreground")}>
                              {opp.roc.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className={cn(
                              "inline-flex items-center justify-center w-12 h-8 rounded text-xs font-bold",
                              opp.score >= 80 ? "bg-green-500/20 text-green-500" :
                              opp.score >= 60 ? "bg-amber-500/20 text-amber-500" :
                              "bg-red-500/20 text-red-500"
                            )}>{opp.score}</div>
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
                  onClick={handleOpenPreview}
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

    {/* Order Preview Dialog */}
    <Dialog open={showOrderPreview} onOpenChange={setShowOrderPreview}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Short Call Orders</DialogTitle>
          <DialogDescription>Review your selected short calls before submitting to Tastytrade</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
            <span className="text-amber-400 text-lg mt-0.5">&#9888;&#65039;</span>
            <div>
              <p className="text-sm font-semibold text-amber-300">Review before submitting</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use <strong className="text-amber-300">Dry Run</strong> to validate without executing.
                Use <strong className="text-green-400">Submit Live Order</strong> to send Sell-to-Open orders to Tastytrade.
              </p>
            </div>
          </div>
          {/* Orders table */}
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left">Symbol</th>
                  <th className="p-2 text-right">LEAP Strike</th>
                  <th className="p-2 text-right">Call Strike</th>
                  <th className="p-2 text-left">Expiration</th>
                  <th className="p-2 text-right">DTE</th>
                  <th className="p-2 text-right">Bid / Ask</th>
                  <th className="p-2 text-center" style={{minWidth:'160px'}}>Limit Price</th>
                  <th className="p-2 text-right">ROC</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrdersArray.map((opp: any) => {
                  const key = `${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`;
                  const bid = opp.bid ?? opp.premium * 0.95;
                  const ask = opp.ask ?? opp.premium * 1.05;
                  const limitPrice = priceOverrides[key] ?? parseFloat(((bid + ask) / 2).toFixed(2));
                  const pct = ask > bid ? ((limitPrice - bid) / (ask - bid)) * 100 : 50;
                  return (
                  <tr key={key} className="border-t">
                    <td className="p-2 font-medium">{opp.underlyingSymbol}</td>
                    <td className="p-2 text-right text-muted-foreground">${opp.leapStrike}</td>
                    <td className="p-2 text-right font-medium">${opp.strike.toFixed(2)}</td>
                    <td className="p-2">{new Date(opp.expiration).toLocaleDateString()}</td>
                    <td className="p-2 text-right">{opp.dte}</td>
                    <td className="p-2 text-right text-muted-foreground text-xs">
                      ${bid.toFixed(2)} / ${ask.toFixed(2)}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1 items-center">
                        <span className="text-green-400 font-semibold text-sm">${limitPrice.toFixed(2)}</span>
                        <input
                          type="range"
                          min={bid}
                          max={ask}
                          step={0.01}
                          value={limitPrice}
                          onChange={e => setPriceOverrides(prev => ({ ...prev, [key]: parseFloat(parseFloat(e.target.value).toFixed(2)) }))}
                          className="w-full h-1.5 accent-purple-500 cursor-pointer"
                        />
                        <div className="flex justify-between w-full text-xs text-muted-foreground">
                          <span>Bid</span>
                          <span className="text-purple-400">{pct.toFixed(0)}%</span>
                          <span>Ask</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-right">{opp.roc.toFixed(1)}%</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-green-900/20 border border-green-700/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Total Premium</p>
              <p className="text-2xl font-bold text-green-400">
                ${selectedOrdersArray.reduce((sum, opp) => {
                  const key = `${opp.underlyingSymbol}-${opp.strike}-${opp.expiration}`;
                  return sum + (priceOverrides[key] ?? opp.premium);
                }, 0).toFixed(2)}
              </p>
            </div>
            <div className="p-4 bg-purple-900/20 border border-purple-700/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Contracts</p>
              <p className="text-2xl font-bold text-purple-400">{selectedOrdersArray.length}</p>
            </div>
            <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Avg Delta</p>
              <p className="text-2xl font-bold text-blue-400">
                {selectedOrdersArray.length > 0
                  ? (selectedOrdersArray.reduce((s: number, o: any) => s + o.delta, 0) / selectedOrdersArray.length).toFixed(2)
                  : '—'}
              </p>
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex flex-col items-end gap-2">
            {tradingMode === 'paper' && (
              <p className="text-sm text-blue-500 font-semibold">
                ⓘ Order submission is disabled in Paper Trading mode.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowOrderPreview(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              {/* Dry Run */}
              <Button
                variant="outline"
                onClick={() => handleSubmitOrders(true)}
                disabled={isSubmitting}
                className="border-amber-600 text-amber-400 hover:bg-amber-900/30"
              >
                {isSubmitting && isDryRun ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Validating...</>
                ) : (
                  <>&#129514; Dry Run</>
                )}
              </Button>
              {/* Submit Live Order */}
              <Button
                onClick={() => handleSubmitOrders(false)}
                disabled={isSubmitting || tradingMode === 'paper'}
                className="bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700"
                title={tradingMode === 'paper' ? 'Disabled in Paper Trading mode' : undefined}
              >
                {isSubmitting && !isDryRun ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</>
                ) : (
                  <>&#128640; Submit Live Order</>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
