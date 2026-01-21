import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { OrderPreviewDialog } from "@/components/OrderPreviewDialog";
import confetti from "canvas-confetti";

export default function CSPDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [newSymbol, setNewSymbol] = useState("");
  const [selectedExpiration, setSelectedExpiration] = useState("");
  const [selectedOpportunities, setSelectedOpportunities] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const utils = trpc.useUtils();

  // Fetch watchlist
  const { data: watchlist = [], isLoading: loadingWatchlist } = trpc.watchlist.list.useQuery(
    { strategy: 'csp' },
    { enabled: !!user }
  );

  // Fetch opportunities
  const { data: opportunities = [], isLoading: loadingOpportunities, refetch: refetchOpportunities } = trpc.csp.opportunities.useQuery(
    { symbols: watchlist.map((w: any) => w.symbol), expiration: selectedExpiration || undefined },
    { enabled: !!user && watchlist.length > 0 }
  );

  // Add to watchlist
  const addToWatchlist = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      toast.success(`Added ${newSymbol} to watchlist`);
      setNewSymbol("");
      utils.watchlist.list.invalidate();
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
      utils.csp.opportunities.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Failed to remove symbol: ${error.message}`);
    },
  });

  // Calculate summary metrics
  const selectedOppsList = opportunities.filter(opp => 
    selectedOpportunities.has(`${opp.symbol}-${opp.strike}-${opp.expiration}`)
  );
  const totalPremium = selectedOppsList.reduce((sum, opp) => sum + (opp.premium * 100), 0);
  const totalCollateral = selectedOppsList.reduce((sum, opp) => sum + (opp.strike * 100), 0);
  const roc = totalCollateral > 0 ? (totalPremium / totalCollateral) * 100 : 0;

  // Fetch accounts
  const { data: accounts = [] } = trpc.accounts.list.useQuery(undefined, { enabled: !!user });

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
        setShowOrderPreview(false);
      } else {
        const failed = data.results.filter(r => !r.success);
        toast.error(`${failed.length} orders failed. Check console for details.`);
        console.error('Failed orders:', failed);
      }
    },
    onError: (error) => {
      toast.error(`Order submission failed: ${error.message}`);
    },
  });

  const handleSubmitOrders = () => {
    if (!selectedAccountId) {
      toast.error('Please select an account first');
      return;
    }
    if (selectedOppsList.length === 0) {
      toast.error('No opportunities selected');
      return;
    }
    setShowOrderPreview(true);
  };

  const handleConfirmOrders = () => {
    submitOrders.mutate({
      orders: selectedOppsList.map(opp => ({
        symbol: opp.symbol,
        strike: opp.strike,
        expiration: opp.expiration,
        premium: opp.premium,
        optionSymbol: opp.optionSymbol,
      })),
      accountId: selectedAccountId,
      dryRun: false,
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please log in to access the CSP Dashboard</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border backdrop-blur-sm bg-background/80 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" asChild>
              <Link href="/">← Back</Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-green-500" />
                Cash-Secured Puts
              </h1>
              <p className="text-sm text-muted-foreground">
                Analyze and execute CSP strategies with intelligent scoring
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="backdrop-blur-sm bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Premium
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalPremium.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground mt-1">From {selectedOppsList.length} selected</p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Collateral Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalCollateral.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground mt-1">Cash secured amount</p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Return on Capital
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{roc.toFixed(2)}%</div>
              <p className="text-xs text-muted-foreground mt-1">Expected ROC</p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Opportunities
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{opportunities.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Available trades</p>
            </CardContent>
          </Card>
        </div>

        {/* Watchlist Management */}
        <Card className="backdrop-blur-sm bg-card/80">
          <CardHeader>
            <CardTitle>Watchlist</CardTitle>
            <CardDescription>
              Add symbols to analyze CSP opportunities
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="Enter symbol (e.g., AAPL, MSFT)"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSymbol) {
                      addToWatchlist.mutate({ symbol: newSymbol, strategy: 'csp' });
                    }
                  }}
                />
              </div>
              <Button
                onClick={() => addToWatchlist.mutate({ symbol: newSymbol, strategy: 'csp' })}
                disabled={!newSymbol || addToWatchlist.isPending}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Symbol
              </Button>
            </div>

            {loadingWatchlist ? (
              <div className="text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : watchlist.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No symbols in watchlist</p>
                <p className="text-sm mt-1">Add symbols above to start analyzing opportunities</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {watchlist.map((item: any) => (
                  <Badge
                    key={item.id}
                    variant="secondary"
                    className="px-3 py-1.5 text-sm flex items-center gap-2"
                  >
                    {item.symbol}
                    <button
                      onClick={() => removeFromWatchlist.mutate({ symbol: item.symbol, strategy: 'csp' })}
                      className="hover:text-destructive"
                      disabled={removeFromWatchlist.isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Opportunities Table */}
        <Card className="backdrop-blur-sm bg-card/80">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Opportunities</CardTitle>
                <CardDescription>
                  Ranked by total score (primary + secondary)
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetchOpportunities()}
                  disabled={loadingOpportunities || watchlist.length === 0}
                >
                  {loadingOpportunities ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Score Selection Buttons */}
            <div className="mb-4 flex flex-wrap gap-2">
              <Label className="text-sm font-medium mr-2 self-center">Select by score:</Label>
              {[100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40].map((score) => (
                <Button
                  key={score}
                  variant={minScore === score ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    // Select all opportunities with score >= threshold
                    const selected = new Set<string>();
                    opportunities.forEach(opp => {
                      if (opp.totalScore >= score) {
                        selected.add(`${opp.symbol}-${opp.strike}-${opp.expiration}`);
                      }
                    });
                    setSelectedOpportunities(selected);
                    toast.info(`Selected ${selected.size} opportunities with score ≥ ${score}%`);
                  }}
                >
                  {score}%+
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedOpportunities(new Set());
                  toast.info("Cleared selection");
                }}
              >
                Clear
              </Button>
            </div>

            {loadingOpportunities ? (
              <div className="text-center py-12">
                <Loader2 className="h-12 w-12 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-4">Loading opportunities...</p>
              </div>
            ) : opportunities.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No opportunities available</p>
                <p className="text-sm mt-1">
                  Add symbols to your watchlist and refresh to see opportunities
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <input type="checkbox" className="rounded" />
                      </TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Strike</TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead>Premium</TableHead>
                      <TableHead>Delta</TableHead>
                      <TableHead>IV</TableHead>
                      <TableHead>OI</TableHead>
                      <TableHead>Volume</TableHead>
                      <TableHead>Primary Score</TableHead>
                      <TableHead>Secondary Score</TableHead>
                      <TableHead>Total Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opportunities.map((opp) => {
                      const oppKey = `${opp.symbol}-${opp.strike}-${opp.expiration}`;
                      const isSelected = selectedOpportunities.has(oppKey);
                      return (
                        <TableRow key={oppKey} className={isSelected ? "bg-primary/10" : ""}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={isSelected}
                              onChange={(e) => {
                                const newSelected = new Set(selectedOpportunities);
                                if (e.target.checked) {
                                  newSelected.add(oppKey);
                                } else {
                                  newSelected.delete(oppKey);
                                }
                                setSelectedOpportunities(newSelected);
                              }}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{opp.symbol}</TableCell>
                          <TableCell>${opp.strike.toFixed(2)}</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {new Date(opp.expiration).toLocaleDateString()}
                              <div className="text-xs text-muted-foreground">{opp.dte} DTE</div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-green-500">
                            ${opp.premium.toFixed(2)}
                          </TableCell>
                          <TableCell>{opp.delta.toFixed(3)}</TableCell>
                          <TableCell>{(opp.iv * 100).toFixed(1)}%</TableCell>
                          <TableCell>{opp.openInterest.toLocaleString()}</TableCell>
                          <TableCell>{opp.volume.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{opp.primaryScore}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{opp.secondaryScore}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={opp.totalScore >= 80 ? "default" : opp.totalScore >= 60 ? "secondary" : "outline"}
                            >
                              {opp.totalScore}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Account Selection & Action Buttons */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Account:</Label>
                <select
                  className="px-3 py-2 rounded-md border bg-background text-sm"
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                >
                  <option value="">Select account...</option>
                  {accounts.map((acc: any) => (
                    <option key={acc.id} value={acc.accountId}>
                      {acc.nickname || acc.accountNumber} ({acc.accountType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  disabled={selectedOppsList.length === 0}
                  onClick={handleSubmitOrders}
                >
                  Preview Orders ({selectedOppsList.length})
                </Button>
                <Button 
                  disabled={selectedOppsList.length === 0 || !selectedAccountId}
                  onClick={handleSubmitOrders}
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  Submit Orders
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Order Preview Dialog */}
      <OrderPreviewDialog
        open={showOrderPreview}
        onOpenChange={setShowOrderPreview}
        opportunities={selectedOppsList}
        onConfirm={handleConfirmOrders}
        isSubmitting={submitOrders.isPending}
      />
    </div>
  );
}
