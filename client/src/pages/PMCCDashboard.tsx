import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, TrendingUp, ArrowUp, ArrowDown, DollarSign } from "lucide-react";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type SortColumn = 'symbol' | 'strike' | 'expiration' | 'dte' | 'delta' | 'premium' | 'bidAskSpread' | 'openInterest' | 'volume' | 'score';
type SortDirection = 'asc' | 'desc';

export default function PMCCDashboard() {
  const [selectedPreset, setSelectedPreset] = useState<"conservative" | "medium" | "aggressive">("medium");
  const [isScanning, setIsScanning] = useState(false);
  const [selectedLeaps, setSelectedLeaps] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const scanLeapsMutation = trpc.pmcc.scanLeaps.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || `Found ${data.opportunities.length} LEAP opportunities`);
      setIsScanning(false);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to scan for LEAPs");
      setIsScanning(false);
    },
  });

  const handleScanLeaps = () => {
    setIsScanning(true);
    scanLeapsMutation.mutate({ presetName: selectedPreset });
  };

  // Helper to create unique key for each LEAP
  const getLeapKey = (leap: any) => `${leap.symbol}-${leap.strike}-${leap.expiration}`;

  // Toggle LEAP selection
  const toggleLeapSelection = (leap: any) => {
    const key = getLeapKey(leap);
    const newSelected = new Set(selectedLeaps);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedLeaps(newSelected);
  };

  // Select all LEAPs
  const selectAllLeaps = () => {
    if (!scanLeapsMutation.data?.opportunities) return;
    const allKeys = scanLeapsMutation.data.opportunities.map(getLeapKey);
    setSelectedLeaps(new Set(allKeys));
  };

  // Clear all selections
  const clearAllLeaps = () => {
    setSelectedLeaps(new Set());
  };

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Filtered and sorted opportunities
  const sortedLeaps = useMemo(() => {
    if (!scanLeapsMutation.data?.opportunities) return [];
    
    let filtered = [...scanLeapsMutation.data.opportunities];
    
    // Apply "Show Selected Only" filter
    if (showSelectedOnly) {
      filtered = filtered.filter(leap => selectedLeaps.has(getLeapKey(leap)));
    }
    
    // Sort
    filtered.sort((a, b) => {
      let aVal: any = a[sortColumn];
      let bVal: any = b[sortColumn];
      
      if (sortColumn === 'expiration') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [scanLeapsMutation.data?.opportunities, selectedLeaps, showSelectedOnly, sortColumn, sortDirection]);

  // Calculate order summary
  const orderSummary = useMemo(() => {
    if (!scanLeapsMutation.data?.opportunities) return null;
    
    const selected = scanLeapsMutation.data.opportunities.filter(leap =>
      selectedLeaps.has(getLeapKey(leap))
    );
    
    if (selected.length === 0) return null;
    
    const totalCost = selected.reduce((sum, leap) => sum + (leap.ask * 100), 0);
    const avgDelta = selected.reduce((sum, leap) => sum + leap.delta, 0) / selected.length;
    const avgScore = selected.reduce((sum, leap) => sum + leap.score, 0) / selected.length;
    
    return {
      totalCost,
      totalContracts: selected.length,
      avgDelta,
      avgScore,
    };
  }, [scanLeapsMutation.data?.opportunities, selectedLeaps]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="h-8 w-8 text-purple-500" />
            <h1 className="text-3xl font-bold">PMCC Dashboard</h1>
          </div>
          <p className="text-muted-foreground">
            Poor Man's Covered Call - Buy LEAPs and sell short calls for income
          </p>
        </div>

        {/* Watchlist Management */}
        <div className="mb-8">
          <EnhancedWatchlist />
        </div>

        {/* LEAP Scanner Section */}
        <Card>
          <CardHeader>
            <CardTitle>LEAP Scanner</CardTitle>
            <CardDescription>
              Scan for LEAP call options (9-15 months out, deep ITM for PMCC strategy)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Scan Button */}
              <Button
                onClick={handleScanLeaps}
                disabled={isScanning}
                className="w-full"
                size="lg"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning for LEAPs...
                  </>
                ) : (
                  "Scan for LEAPs"
                )}
              </Button>

              {/* Preset Selection - shown after scan */}
              {scanLeapsMutation.data && scanLeapsMutation.data.opportunities.length > 0 && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Filter Preset</label>
                  <div className="flex gap-2">
                    <Button
                      variant={selectedPreset === "conservative" ? "default" : "outline"}
                      onClick={() => setSelectedPreset("conservative")}
                    >
                      Conservative
                    </Button>
                    <Button
                      variant={selectedPreset === "medium" ? "default" : "outline"}
                      onClick={() => setSelectedPreset("medium")}
                    >
                      Medium
                    </Button>
                    <Button
                      variant={selectedPreset === "aggressive" ? "default" : "outline"}
                      onClick={() => setSelectedPreset("aggressive")}
                    >
                      Aggressive
                    </Button>
                  </div>
                </div>
              )}

              {/* LEAP Opportunities Table */}
              {scanLeapsMutation.data && scanLeapsMutation.data.opportunities.length > 0 && (
                <div className="mt-6 space-y-4">
                  {/* Order Summary */}
                  {orderSummary && (
                    <Card className="bg-gradient-to-br from-amber-900/20 to-orange-900/20 border-amber-700/50">
                      <CardHeader>
                        <CardTitle>Order Summary</CardTitle>
                        <CardDescription>Review your selected LEAPs</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-4 gap-4">
                          <div className="bg-green-900/30 rounded-lg p-4 border border-green-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <DollarSign className="h-5 w-5 text-green-400" />
                              <span className="text-sm text-muted-foreground">Total Cost</span>
                            </div>
                            <div className="text-2xl font-bold text-green-400">
                              {orderSummary.totalCost.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-muted-foreground">Total Contracts</span>
                            </div>
                            <div className="text-2xl font-bold text-amber-400">
                              {orderSummary.totalContracts}
                            </div>
                          </div>
                          <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-muted-foreground">Avg Delta</span>
                            </div>
                            <div className="text-2xl font-bold text-blue-400">
                              {orderSummary.avgDelta.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-purple-900/30 rounded-lg p-4 border border-purple-700/50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-muted-foreground">Avg Score</span>
                            </div>
                            <div className="text-2xl font-bold text-purple-400">
                              {Math.round(orderSummary.avgScore)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Table Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button onClick={selectAllLeaps} variant="outline" size="sm">
                        Select All
                      </Button>
                      <Button onClick={clearAllLeaps} variant="outline" size="sm">
                        Clear All
                      </Button>
                      <Button
                        onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                        variant={showSelectedOnly ? "default" : "outline"}
                        size="sm"
                        className={showSelectedOnly ? "bg-amber-600 hover:bg-amber-700" : ""}
                      >
                        {showSelectedOnly ? "Show All" : "Show Selected Only"}
                      </Button>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedLeaps.size} of {sortedLeaps.length} selected
                    </div>
                  </div>

                  {/* LEAP Opportunities Table */}
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-2 text-left">Select</th>
                          <th className="p-2 text-left cursor-pointer hover:bg-muted" onClick={() => handleSort('symbol')}>
                            <div className="flex items-center gap-1">
                              Symbol
                              {sortColumn === 'symbol' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('strike')}>
                            <div className="flex items-center justify-end gap-1">
                              Strike
                              {sortColumn === 'strike' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-left cursor-pointer hover:bg-muted" onClick={() => handleSort('expiration')}>
                            <div className="flex items-center gap-1">
                              Expiration
                              {sortColumn === 'expiration' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('dte')}>
                            <div className="flex items-center justify-end gap-1">
                              DTE
                              {sortColumn === 'dte' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('delta')}>
                            <div className="flex items-center justify-end gap-1">
                              Delta
                              {sortColumn === 'delta' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('premium')}>
                            <div className="flex items-center justify-end gap-1">
                              Premium
                              {sortColumn === 'premium' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right">Bid</th>
                          <th className="p-2 text-right">Ask</th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('bidAskSpread')}>
                            <div className="flex items-center justify-end gap-1">
                              Spread %
                              {sortColumn === 'bidAskSpread' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('openInterest')}>
                            <div className="flex items-center justify-end gap-1">
                              OI
                              {sortColumn === 'openInterest' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('volume')}>
                            <div className="flex items-center justify-end gap-1">
                              Volume
                              {sortColumn === 'volume' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                          <th className="p-2 text-right cursor-pointer hover:bg-muted" onClick={() => handleSort('score')}>
                            <div className="flex items-center justify-end gap-1">
                              Score
                              {sortColumn === 'score' && (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLeaps.map((leap) => {
                          const key = getLeapKey(leap);
                          const isSelected = selectedLeaps.has(key);
                          return (
                            <tr key={key} className={isSelected ? "bg-amber-900/20" : "hover:bg-muted/50"}>
                              <td className="p-2">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleLeapSelection(leap)}
                                />
                              </td>
                              <td className="p-2 font-medium">{leap.symbol}</td>
                              <td className="p-2 text-right">${leap.strike.toFixed(2)}</td>
                              <td className="p-2">{leap.expiration}</td>
                              <td className="p-2 text-right">{leap.dte}</td>
                              <td className="p-2 text-right">{leap.delta.toFixed(2)}</td>
                              <td className="p-2 text-right">${leap.premium.toFixed(2)}</td>
                              <td className="p-2 text-right">${leap.bid.toFixed(2)}</td>
                              <td className="p-2 text-right">${leap.ask.toFixed(2)}</td>
                              <td className="p-2 text-right">{leap.bidAskSpread.toFixed(2)}%</td>
                              <td className="p-2 text-right">{leap.openInterest.toLocaleString()}</td>
                              <td className="p-2 text-right">{leap.volume.toLocaleString()}</td>
                              <td className="p-2 text-right">
                                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold ${
                                  leap.score >= 80 ? 'bg-green-900/50 text-green-400' :
                                  leap.score >= 60 ? 'bg-amber-900/50 text-amber-400' :
                                  'bg-red-900/50 text-red-400'
                                }`}>
                                  {Math.round(leap.score)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Active PMCC Positions (Placeholder) */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Active PMCC Positions</CardTitle>
            <CardDescription>
              Your owned LEAPs available for selling covered calls
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground text-center py-8">
              <p>No LEAP positions found. Start by scanning for LEAP opportunities above!</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
