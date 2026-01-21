import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Calendar,
  Target,
  Filter,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";

type ScoredOpportunity = {
  symbol: string;
  strike: number;
  currentPrice: number;
  expiration: string;
  dte: number;
  premium: number;
  bid: number;
  ask: number;
  premiumPct: number;
  weeklyPct: number;
  monthlyPct: number;
  annualPct: number;
  delta: number;
  theta: number;
  volume: number;
  openInterest: number;
  rsi: number | null;
  ivRank: number | null;
  bbPctB: number | null;
  spreadPct: number;
  collateral: number;
  roc: number;
  score: number;
};

type PresetFilter = 'conservative' | 'medium' | 'aggressive' | null;

export default function CSPDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [newSymbol, setNewSymbol] = useState("");
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [presetFilter, setPresetFilter] = useState<PresetFilter>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [minDte, setMinDte] = useState<number>(7);
  const [maxDte, setMaxDte] = useState<number>(45);

  const utils = trpc.useUtils();

  // Fetch watchlist
  const { data: watchlist = [], isLoading: loadingWatchlist } = trpc.watchlist.list.useQuery(
    { strategy: 'csp' },
    { enabled: !!user }
  );

  // Fetch opportunities (only when user clicks "Fetch Opportunities")
  const { data: opportunities = [], isLoading: loadingOpportunities, refetch: refetchOpportunities } = trpc.csp.opportunities.useQuery(
    { 
      symbols: watchlist.map((w: any) => w.symbol),
      minDte,
      maxDte,
    },
    { enabled: false } // Disabled by default, only fetch when user clicks button
  );

  // Add to watchlist
  const addToWatchlist = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      setNewSymbol("");
      utils.watchlist.list.invalidate();
      toast.success("Symbol(s) added to watchlist");
    },
    onError: (error: any) => {
      toast.error(`Failed to add symbol: ${error.message}`);
    },
  });

  // Remove from watchlist
  const removeFromWatchlist = trpc.watchlist.remove.useMutation({
    onSuccess: (_: any, variables: any) => {
      toast.success(`Removed ${variables.symbol} from watchlist`);
      utils.watchlist.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Failed to remove symbol: ${error.message}`);
    },
  });

  // Handle adding comma-delimited symbols
  const handleAddSymbols = () => {
    const symbols = newSymbol
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);

    if (symbols.length === 0) {
      toast.error("Please enter at least one symbol");
      return;
    }

    // Add each symbol
    Promise.all(
      symbols.map(symbol => 
        addToWatchlist.mutateAsync({ symbol, strategy: 'csp' })
      )
    ).then(() => {
      toast.success(`Added ${symbols.length} symbol(s) to watchlist`);
    }).catch((error) => {
      toast.error(`Failed to add symbols: ${error.message}`);
    });
  };

  // Apply preset filters
  const filteredOpportunities = useMemo(() => {
    let filtered = [...opportunities];

    // Apply preset filter
    if (presetFilter === 'conservative') {
      filtered = filtered.filter(opp => 
        Math.abs(opp.delta) >= 0.10 && Math.abs(opp.delta) <= 0.20 &&
        opp.openInterest >= 50 &&
        (opp.rsi === null || opp.rsi <= 70) &&
        opp.score >= 50
      );
    } else if (presetFilter === 'medium') {
      filtered = filtered.filter(opp => 
        Math.abs(opp.delta) >= 0.15 && Math.abs(opp.delta) <= 0.30 &&
        opp.openInterest >= 50 &&
        (opp.rsi === null || opp.rsi <= 80) &&
        opp.score >= 40
      );
    } else if (presetFilter === 'aggressive') {
      filtered = filtered.filter(opp => 
        Math.abs(opp.delta) >= 0.20 && Math.abs(opp.delta) <= 0.40 &&
        opp.openInterest >= 25 &&
        opp.score >= 30
      );
    }

    // Apply score filter
    if (minScore !== undefined) {
      filtered = filtered.filter(opp => opp.score >= minScore);
    }

    // Apply "Selected Only" filter
    if (showSelectedOnly) {
      filtered = filtered.filter(opp => 
        selectedOpportunities.has(`${opp.symbol}-${opp.strike}-${opp.expiration}`)
      );
    }

    return filtered;
  }, [opportunities, presetFilter, minScore, showSelectedOnly, selectedOpportunities]);

  // Calculate summary metrics
  const selectedOppsList = opportunities.filter(opp => 
    selectedOpportunities.has(`${opp.symbol}-${opp.strike}-${opp.expiration}`)
  );
  const totalPremium = selectedOppsList.reduce((sum, opp) => sum + (opp.premium * 100), 0);
  const totalCollateral = selectedOppsList.reduce((sum, opp) => sum + opp.collateral, 0);
  const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;

  // Fetch accounts
  const { data: accounts = [] } = trpc.accounts.list.useQuery(undefined, { enabled: !!user });
  const { data: credentials } = trpc.settings.getCredentials.useQuery(undefined, { enabled: !!user });

  // Submit orders mutation
  const submitOrders = trpc.csp.submitOrders.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Successfully submitted ${data.results.length} orders!`);
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
        setSelectedOpportunities(new Set());
        utils.csp.opportunities.invalidate();
      }
    },
    onError: (error: any) => {
      toast.error(`Failed to submit orders: ${error.message}`);
    },
  });

  // Handle checkbox toggle
  const toggleOpportunity = (opp: ScoredOpportunity) => {
    const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
    const newSelected = new Set(selectedOpportunities);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedOpportunities(newSelected);
  };

  // Handle score button click
  const handleScoreFilter = (score: number) => {
    setMinScore(score);
    setPresetFilter(null); // Clear preset when using score filter
  };

  // Handle preset button click
  const handlePresetFilter = (preset: PresetFilter) => {
    setPresetFilter(preset);
    setMinScore(undefined); // Clear score filter when using preset
  };

  // Handle submit orders
  const handleSubmitOrders = () => {
    if (selectedOppsList.length === 0) {
      toast.error("Please select at least one opportunity");
      return;
    }

    if (!credentials?.defaultTastytradeAccountId) {
      toast.error("Please set a default account in Settings");
      return;
    }

    const orders = selectedOppsList.map(opp => ({
      symbol: opp.symbol,
      strike: opp.strike,
      expiration: opp.expiration,
      premium: opp.premium,
      optionSymbol: `${opp.symbol}${opp.expiration.replace(/-/g, '')}P${(opp.strike * 1000).toString().padStart(8, '0')}`,
    }));

    submitOrders.mutate({
      orders,
      accountId: credentials.defaultTastytradeAccountId,
      dryRun: false,
    });
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Please log in to access the CSP Dashboard</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cash-Secured Puts Dashboard</h1>
          <p className="text-muted-foreground">Analyze and execute CSP strategies with intelligent scoring</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              Total Premium
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalPremium.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-500" />
              Total Collateral
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCollateral.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              ROC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{roc.toFixed(2)}%</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-500" />
              Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredOpportunities.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Watchlist Management */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle>Watchlist</CardTitle>
          <CardDescription>Add symbols to analyze CSP opportunities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Enter symbols (comma-separated, e.g., AAPL, MSFT, TSLA)"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbols()}
              />
            </div>
            <Button onClick={handleAddSymbols} disabled={addToWatchlist.isPending}>
              {addToWatchlist.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </Button>
          </div>

          {/* Watchlist Display */}
          <div className="flex flex-wrap gap-2">
            {watchlist.map((item: any) => (
              <Badge key={item.id} variant="secondary" className="px-3 py-1 flex items-center gap-2">
                {item.symbol}
                <button
                  onClick={() => removeFromWatchlist.mutate({ symbol: item.symbol, strategy: 'csp' })}
                  className="hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>

          {/* DTE Range Filter */}
          <div className="flex items-center gap-4">
            <Label>DTE Range:</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={minDte}
                onChange={(e) => setMinDte(Number(e.target.value))}
                className="w-20"
              />
              <span>to</span>
              <Input
                type="number"
                placeholder="Max"
                value={maxDte}
                onChange={(e) => setMaxDte(Number(e.target.value))}
                className="w-20"
              />
            </div>
          </div>

          {/* Fetch Button */}
          <Button 
            onClick={() => refetchOpportunities()} 
            disabled={loadingOpportunities || watchlist.length === 0}
            className="w-full"
          >
            {loadingOpportunities ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Fetching Opportunities...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Fetch Opportunities
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset Filters */}
          <div>
            <Label className="mb-2 block">Preset Filters</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={presetFilter === 'conservative' ? 'default' : 'outline'}
                onClick={() => handlePresetFilter('conservative')}
                size="sm"
              >
                Conservative
              </Button>
              <Button
                variant={presetFilter === 'medium' ? 'default' : 'outline'}
                onClick={() => handlePresetFilter('medium')}
                size="sm"
              >
                Medium
              </Button>
              <Button
                variant={presetFilter === 'aggressive' ? 'default' : 'outline'}
                onClick={() => handlePresetFilter('aggressive')}
                size="sm"
              >
                Aggressive
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPresetFilter(null);
                  setMinScore(undefined);
                }}
                size="sm"
              >
                Clear Filters
              </Button>
            </div>
          </div>

          {/* Score Filters */}
          <div>
            <Label className="mb-2 block">Score Filters</Label>
            <div className="flex flex-wrap gap-2">
              {[100, 90, 80, 75, 70, 65, 60, 55, 50, 45, 40].map(score => (
                <Button
                  key={score}
                  variant={minScore === score ? 'default' : 'outline'}
                  onClick={() => handleScoreFilter(score)}
                  size="sm"
                >
                  {score}+
                </Button>
              ))}
            </div>
          </div>

          {/* Selected Only Toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="selected-only"
              checked={showSelectedOnly}
              onCheckedChange={(checked) => setShowSelectedOnly(checked as boolean)}
            />
            <Label htmlFor="selected-only" className="cursor-pointer">
              Show Selected Only
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Opportunities Table */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle>Opportunities ({filteredOpportunities.length})</CardTitle>
          <CardDescription>
            {selectedOppsList.length > 0 && `${selectedOppsList.length} selected`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Bid</TableHead>
                  <TableHead>Ask</TableHead>
                  <TableHead>Spread %</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>DTE</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Weekly %</TableHead>
                  <TableHead>Collateral</TableHead>
                  <TableHead>ROC %</TableHead>
                  <TableHead>OI</TableHead>
                  <TableHead>Vol</TableHead>
                  <TableHead>RSI</TableHead>
                  <TableHead>BB %B</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOpportunities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center text-muted-foreground py-8">
                      {loadingOpportunities ? "Loading opportunities..." : "No opportunities found. Add symbols and click Fetch Opportunities."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOpportunities.map((opp) => {
                    const key = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
                    const isSelected = selectedOpportunities.has(key);
                    return (
                      <TableRow key={key} className={isSelected ? "bg-primary/10" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleOpportunity(opp)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{opp.symbol}</TableCell>
                        <TableCell>${opp.strike.toFixed(2)}</TableCell>
                        <TableCell>${opp.bid.toFixed(2)}</TableCell>
                        <TableCell>${opp.ask.toFixed(2)}</TableCell>
                        <TableCell>{opp.spreadPct.toFixed(1)}%</TableCell>
                        <TableCell>{Math.abs(opp.delta).toFixed(3)}</TableCell>
                        <TableCell>{opp.dte}</TableCell>
                        <TableCell className="font-medium text-green-500">${opp.premium.toFixed(2)}</TableCell>
                        <TableCell>{opp.weeklyPct.toFixed(2)}%</TableCell>
                        <TableCell>${opp.collateral.toFixed(2)}</TableCell>
                        <TableCell>{opp.roc.toFixed(2)}%</TableCell>
                        <TableCell>{opp.openInterest}</TableCell>
                        <TableCell>{opp.volume}</TableCell>
                        <TableCell>{opp.rsi !== null ? opp.rsi.toFixed(1) : 'N/A'}</TableCell>
                        <TableCell>{opp.bbPctB !== null ? opp.bbPctB.toFixed(2) : 'N/A'}</TableCell>
                        <TableCell>
                          <Badge variant={opp.score >= 70 ? 'default' : opp.score >= 50 ? 'secondary' : 'outline'}>
                            {opp.score}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Submit Orders Button */}
          {selectedOppsList.length > 0 && (
            <div className="mt-4 flex justify-end">
              <Button
                onClick={handleSubmitOrders}
                disabled={submitOrders.isPending}
                size="lg"
              >
                {submitOrders.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting Orders...
                  </>
                ) : (
                  `Submit ${selectedOppsList.length} Order(s)`
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
