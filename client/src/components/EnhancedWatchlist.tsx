import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Loader2, Plus, Trash2, Upload, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type WatchlistItem = {
  id: number;
  symbol: string;
  company?: string | null;
  type?: string | null;
  sector?: string | null;
  reason?: string | null;
  rank?: number | null;
  portfolioSize?: 'small' | 'medium' | 'large' | null;
  price?: string | null;
};

type EnhancedWatchlistProps = {
  onWatchlistChange?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onFullCollapse?: () => void;
};

export default function EnhancedWatchlist({ onWatchlistChange, isCollapsed = false, onToggleCollapse, onFullCollapse }: EnhancedWatchlistProps) {
  const [newSymbol, setNewSymbol] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  // Fetch watchlist
  const { data: watchlist = [], isLoading: loadingWatchlist } = trpc.watchlist.get.useQuery();

  // Add to watchlist
  const addToWatchlist = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      setNewSymbol("");
      utils.watchlist.get.invalidate();
      toast.success("Symbol(s) added to watchlist");
      onWatchlistChange?.();
    },
    onError: (error: any) => {
      toast.error(`Failed to add symbol: ${error.message}`);
    },
  });

  // Import CSV
  const importCSV = trpc.watchlist.importCSV.useMutation({
    onSuccess: (result) => {
      utils.watchlist.get.invalidate();
      toast.success(`Imported ${result.imported} symbols${result.skipped > 0 ? `, skipped ${result.skipped} duplicates` : ''}`);
      onWatchlistChange?.();
    },
    onError: (error: any) => {
      toast.error(`Failed to import CSV: ${error.message}`);
    },
  });

  // Enrich symbols with metadata
  const enrichSymbols = trpc.watchlist.enrichSymbols.useMutation({
    onSuccess: (result) => {
      utils.watchlist.get.invalidate();
      toast.success(`Enriched ${result.enriched} symbols with metadata`);
      onWatchlistChange?.();
    },
    onError: (error: any) => {
      toast.error(`Failed to enrich symbols: ${error.message}`);
    },
  });

  // Remove from watchlist
  const removeFromWatchlist = trpc.watchlist.remove.useMutation({
    onSuccess: (_: any, variables: any) => {
      toast.success(`Removed ${variables.symbol} from watchlist`);
      utils.watchlist.get.invalidate();
      onWatchlistChange?.();
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
        addToWatchlist.mutateAsync({ symbol })
      )
    ).then(() => {
      toast.success(`Added ${symbols.length} symbol(s) to watchlist`);
    }).catch((error) => {
      toast.error(`Failed to add symbols: ${error.message}`);
    });
  };

  // Handle CSV file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
          toast.error("CSV file is empty");
          return;
        }

        // Parse CSV header
        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const symbolIndex = header.indexOf('symbol');
        const companyIndex = header.indexOf('company');
        const typeIndex = header.indexOf('type');
        const sectorIndex = header.indexOf('sector');
        const reasonIndex = header.indexOf('reason');
        const rankIndex = header.indexOf('rank');
        const portfolioSizeIndex = header.indexOf('portfolio size') >= 0 ? header.indexOf('portfolio size') : header.indexOf('portfoliosize');
        const priceIndex = header.indexOf('price');

        if (symbolIndex === -1) {
          toast.error("CSV must have a 'Symbol' column");
          return;
        }

        // Parse data rows
        const items = lines.slice(1).map(line => {
          const cols = line.split(',').map(c => c.trim());
          const portfolioSizeValue = portfolioSizeIndex >= 0 ? cols[portfolioSizeIndex]?.toLowerCase() : undefined;
          const priceValue = priceIndex >= 0 && cols[priceIndex] ? parseFloat(cols[priceIndex].replace('$', '')) : undefined;
          return {
            symbol: cols[symbolIndex]?.toUpperCase() || '',
            company: companyIndex >= 0 ? cols[companyIndex] : undefined,
            type: typeIndex >= 0 ? cols[typeIndex] : undefined,
            sector: sectorIndex >= 0 ? cols[sectorIndex] : undefined,
            reason: reasonIndex >= 0 ? cols[reasonIndex] : undefined,
            rank: rankIndex >= 0 && cols[rankIndex] ? parseInt(cols[rankIndex]) : undefined,
            price: priceValue ? priceValue.toFixed(2) : undefined,
            portfolioSize: (portfolioSizeValue === 'small' || portfolioSizeValue === 'medium' || portfolioSizeValue === 'large') ? portfolioSizeValue as 'small' | 'medium' | 'large' : undefined,
          };
        }).filter(item => item.symbol.length > 0);

        if (items.length === 0) {
          toast.error("No valid symbols found in CSV");
          return;
        }

        // De-dupe: Remove duplicates from CSV itself
        const uniqueSymbols = new Set<string>();
        const deduped = items.filter(item => {
          if (uniqueSymbols.has(item.symbol)) {
            return false;
          }
          uniqueSymbols.add(item.symbol);
          return true;
        });

        // Check for duplicates with existing watchlist
        const existingSymbols = new Set(watchlist.map((w: WatchlistItem) => w.symbol));
        const newItems = deduped.filter(item => !existingSymbols.has(item.symbol));
        const duplicateCount = items.length - newItems.length;

        if (newItems.length === 0) {
          toast.error("All symbols already exist in watchlist");
          return;
        }

        // Import to backend
        importCSV.mutate(
          { items: newItems },
          {
            onSuccess: () => {
              if (duplicateCount > 0) {
                toast.success(`Imported ${newItems.length} symbols (${duplicateCount} duplicates removed)`);
              }
            }
          }
        );
      } catch (error: any) {
        toast.error(`Failed to parse CSV: ${error.message}`);
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Copy ticker list to clipboard
  const handleCopyTickers = () => {
    const tickers = watchlist.map((item: WatchlistItem) => item.symbol).join(', ');
    navigator.clipboard.writeText(tickers);
    toast.success("Tickers copied to clipboard");
  };

  // Collapsed view
  if (isCollapsed) {
    return (
      <div className="flex items-center justify-between p-4 bg-card/50 backdrop-blur border border-border/50 rounded-lg">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">Watchlist ({watchlist.length} symbols)</span>
          <div className="flex gap-1">
            {watchlist.slice(0, 5).map((item: WatchlistItem) => (
              <Badge key={item.id} variant="secondary" className="text-xs">
                {item.symbol}
              </Badge>
            ))}
            {watchlist.length > 5 && (
              <Badge variant="secondary" className="text-xs">+{watchlist.length - 5} more</Badge>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleCollapse}
        >
          <ChevronDown className="w-4 h-4 mr-2" />
          Expand Watchlist
        </Button>
      </div>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Watchlist</CardTitle>
            <CardDescription>Add symbols to analyze trading opportunities</CardDescription>
          </div>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
            >
              <ChevronUp className="w-4 h-4 mr-2" />
              Collapse
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Add Input */}
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

        {/* CSV Import Button */}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button 
            variant="outline" 
            onClick={() => fileInputRef.current?.click()}
            disabled={importCSV.isPending}
            className="flex-1"
          >
            {importCSV.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </>
            )}
          </Button>
          <Button 
            variant="outline"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={watchlist.length === 0}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {isExpanded ? 'Collapse' : 'Expand'}
          </Button>
          <Button
            variant="outline"
            onClick={() => enrichSymbols.mutate({})}
            disabled={watchlist.length === 0 || enrichSymbols.isPending}
          >
            {enrichSymbols.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Refreshing...
              </>
            ) : (
              'Refresh Metadata'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              // Find duplicates
              const symbolCounts = new Map<string, number>();
              watchlist.forEach((item: WatchlistItem) => {
                symbolCounts.set(item.symbol, (symbolCounts.get(item.symbol) || 0) + 1);
              });
              const duplicates = Array.from(symbolCounts.entries())
                .filter(([_, count]) => count > 1)
                .map(([symbol, _]) => symbol);

              if (duplicates.length === 0) {
                toast.info("No duplicates found");
                return;
              }

              // Remove duplicates (keep first occurrence)
              const seen = new Set<string>();
              const toRemove: string[] = [];
              watchlist.forEach((item: WatchlistItem) => {
                if (seen.has(item.symbol)) {
                  toRemove.push(item.symbol);
                } else {
                  seen.add(item.symbol);
                }
              });

              // Delete duplicates
              toRemove.forEach(symbol => removeFromWatchlist.mutate({ symbol }));
              toast.success(`Removed ${toRemove.length} duplicate symbols`);
            }}
            disabled={watchlist.length === 0}
          >
            Remove Duplicates
          </Button>
        </div>

        {/* Compact View (Badges) */}
        {!isExpanded && (
          <div className="flex flex-wrap gap-2">
            {loadingWatchlist ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            ) : watchlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No symbols in watchlist. Add some above or import a CSV.</p>
            ) : (
              watchlist.map((item: WatchlistItem) => (
                <Badge key={item.id} variant="secondary" className="px-3 py-1 flex items-center gap-2">
                  {item.symbol}
                  <button
                    onClick={() => removeFromWatchlist.mutate({ symbol: item.symbol })}
                    className="hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        )}

        {/* Expanded View (Table) */}
        {isExpanded && (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Rank</TableHead>
                  <TableHead className="w-[100px]">Symbol</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead className="w-[120px]">Portfolio Size</TableHead>
                  <TableHead className="w-[80px]">Price</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingWatchlist ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : watchlist.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No symbols in watchlist
                    </TableCell>
                  </TableRow>
                ) : (
                  watchlist.map((item: WatchlistItem) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.rank || '-'}</TableCell>
                      <TableCell className="font-mono font-semibold">{item.symbol}</TableCell>
                      <TableCell>{item.company || '-'}</TableCell>
                      <TableCell>
                        {item.type && (
                          <Badge variant={
                            item.type.includes('Growth') ? 'default' : 
                            item.type.includes('Value') ? 'secondary' : 
                            'outline'
                          }>
                            {item.type}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.portfolioSize && (
                          <Badge variant={
                            item.portfolioSize === 'small' ? 'secondary' : 
                            item.portfolioSize === 'medium' ? 'default' : 
                            'destructive'
                          }>
                            {item.portfolioSize === 'small' ? '🟢 Small' : 
                             item.portfolioSize === 'medium' ? '🟡 Medium' : 
                             '🔴 Large'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">
                        {item.price ? `$${item.price}` : '-'}
                      </TableCell>
                      <TableCell className="text-sm">{item.sector || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                        {item.reason || '-'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFromWatchlist.mutate({ symbol: item.symbol })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}


      </CardContent>
    </Card>
  );
}
