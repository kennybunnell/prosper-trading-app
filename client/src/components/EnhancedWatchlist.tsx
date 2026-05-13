import { useState, useRef, useMemo } from "react";
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
  /** When provided, the Equity/Index toggle is controlled by the parent */
  contextMode?: 'equity' | 'index';
  onContextModeChange?: (mode: 'equity' | 'index') => void;
};

// TRUE cash-settled index symbols only — these are the ONLY symbols that should trigger
// isIndex=true in the watchlist. ETFs (SPY, QQQ, IWM, etc.) are equity-settled and must
// follow equity margin/spread rules. They are intentionally excluded from this set.
const INDEX_SYMBOLS_SET = new Set([
  // S&P 500 cash-settled index family
  'SPX','SPXW','SPXPM','XSP','NANOS',
  // Nasdaq-100 cash-settled index family
  'NDX','NDXP','XND',
  // Russell 2000 cash-settled index family
  'RUT','RUTW','MRUT',
  // Dow Jones cash-settled index
  'DJX',
  // CBOE Volatility Index family
  'VIX','VIXW','VVIX',
  // S&P 100 cash-settled (legacy)
  'OEX','XEO',
]);

// ETF proxies — equity-settled, must NOT be marked isIndex=true
// Kept as a separate set for display grouping in the watchlist UI only
const ETF_PROXY_SET = new Set([
  'SPY','SPXL','SPXS','SSO','SDS','UPRO','SPXU',
  'QQQ','TQQQ','SQQQ','QLD','QID','QQQM',
  'IWM','TNA','TZA','UWM','TWM',
  'DIA','DDM','DXD',
  'VXX','VIXY','UVXY','SVXY','VIXM',
  'EFA','EEM','VEA','VWO',
  'XLK','XLF','XLE','XLV','XLI','XLP','XLU','XLB','XLRE','XLC','XLY',
  'TLT','TBT','IEF','SHY','HYG','LQD','TNX',
]);

function WatchlistPills({
  watchlist,
  watchlistError,
  loadingWatchlist,
  selectionMap,
  onToggle,
  onRemove,
  onRetry,
}: {
  watchlist: WatchlistItem[];
  watchlistError: any;
  loadingWatchlist: boolean;
  selectionMap: Map<string, boolean>;
  onToggle: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onRetry: () => void;
}) {
  if (watchlistError) {
    return (
      <div className="flex flex-col gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
        <p className="text-sm text-destructive font-medium">⚠️ Database Connection Timeout</p>
        <p className="text-xs text-muted-foreground">
          The database is taking too long to respond. This is a known infrastructure issue.
          Your data is safe. Try refreshing the page or wait a moment.
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} className="w-fit">Retry</Button>
      </div>
    );
  }
  if (loadingWatchlist) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading watchlist... (this may take 10-30 seconds)
      </div>
    );
  }
  if (watchlist.length === 0) {
    return <p className="text-sm text-muted-foreground">No symbols in watchlist. Add some above or import a CSV.</p>;
  }

  const indexItems = watchlist.filter((item) => (item as any).isIndex === true || (item as any).isIndex === 1 || INDEX_SYMBOLS_SET.has(item.symbol));
  const equityItems = watchlist.filter((item) => !indexItems.includes(item));

  const renderPill = (item: WatchlistItem) => {
    const isSelected = selectionMap.get(item.symbol) === true;
    return (
      <Badge
        key={item.id}
        variant="secondary"
        className={cn(
          "px-3 py-1 flex items-center gap-2 cursor-pointer transition-all",
          isSelected && "ring-2 ring-primary bg-primary/10 border-primary"
        )}
        onClick={() => onToggle(item.symbol)}
      >
        <div className={cn(
          "w-3 h-3 rounded-sm border flex items-center justify-center",
          isSelected ? "bg-primary border-primary" : "border-muted-foreground"
        )}>
          {isSelected && (
            <svg className="w-2 h-2 text-primary-foreground" fill="currentColor" viewBox="0 0 12 12">
              <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          )}
        </div>
        {item.symbol}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(item.symbol); }}
          className="hover:text-destructive"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </Badge>
    );
  };

  return (
    <div className="space-y-3 w-full">
      {indexItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">Indexes ({indexItems.length})</p>
          <div className="flex flex-wrap gap-2">{indexItems.map(renderPill)}</div>
        </div>
      )}
      {equityItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Equities ({equityItems.length})</p>
          <div className="flex flex-wrap gap-2">{equityItems.map(renderPill)}</div>
        </div>
      )}
    </div>
  );
}

export default function EnhancedWatchlist({ onWatchlistChange, isCollapsed = false, onToggleCollapse, onFullCollapse, contextMode, onContextModeChange }: EnhancedWatchlistProps) {
  const [newSymbol, setNewSymbol] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  // If contextMode is provided by parent, use it; otherwise use local state
  const [localAddAsIndex, setLocalAddAsIndex] = useState(false);
  const addAsIndex = contextMode !== undefined ? contextMode === 'index' : localAddAsIndex;
  const setAddAsIndex = (val: boolean) => {
    if (onContextModeChange) {
      onContextModeChange(val ? 'index' : 'equity');
    } else {
      setLocalAddAsIndex(val);
    }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  // Fetch watchlist with caching and retry
  const { data: watchlist = [], isLoading: loadingWatchlist, error: watchlistError } = trpc.watchlist.get.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      retry: 3, // Retry 3 times on failure
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    }
  );
  
  // Fetch ticker selections with caching and retry
  const { data: selections = [], isLoading: loadingSelections, error: selectionsError } = trpc.watchlist.getSelections.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      retry: 3, // Retry 3 times on failure
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    }
  );
  
  // Create selection map for quick lookup
  const selectionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    selections.forEach((sel: any) => {
      map.set(sel.symbol, sel.isSelected === 1);
    });
    return map;
  }, [selections]);
  
  // Count selected tickers
  const selectedCount = useMemo(() => {
    return watchlist.filter((item: WatchlistItem) => selectionMap.get(item.symbol) === true).length;
  }, [watchlist, selectionMap]);

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
  
  // Toggle ticker selection
  const toggleSelection = trpc.watchlist.toggleSelection.useMutation({
    onSuccess: () => {
      utils.watchlist.getSelections.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Failed to toggle selection: ${error.message}`);
    },
  });
  
  // Select all tickers
  const selectAll = trpc.watchlist.selectAll.useMutation({
    onSuccess: () => {
      utils.watchlist.getSelections.invalidate();
      toast.success("All tickers selected");
    },
    onError: (error: any) => {
      toast.error(`Failed to select all: ${error.message}`);
    },
  });
  
  // Clear all selections
  const clearAll = trpc.watchlist.clearAll.useMutation({
    onSuccess: () => {
      utils.watchlist.getSelections.invalidate();
      toast.success("All selections cleared");
    },
    onError: (error: any) => {
      toast.error(`Failed to clear selections: ${error.message}`);
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

    // Add each symbol — pass isIndex flag so server auto-classifies
    const isIndexOverride = addAsIndex || symbols.some(s => INDEX_SYMBOLS_SET.has(s));
    Promise.all(
      symbols.map(symbol => {
        const symbolIsIndex = addAsIndex || INDEX_SYMBOLS_SET.has(symbol);
        return addToWatchlist.mutateAsync({
          symbol,
          ...(symbolIsIndex ? { isIndex: true, type: 'Index', sector: 'Index' } : {}),
        });
      })
    ).then(() => {
      toast.success(`Added ${symbols.length} symbol(s) to watchlist${isIndexOverride ? ' (Index)' : ''}`);
      setNewSymbol('');
      setAddAsIndex(false);
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
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle>Watchlist</CardTitle>
            <CardDescription>Add symbols to analyze trading opportunities</CardDescription>
          </div>
          {/* Persistent Equity / Index context toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setAddAsIndex(false)}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                !addAsIndex
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Equities
            </button>
            <button
              type="button"
              onClick={() => setAddAsIndex(true)}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                addAsIndex
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Indexes
            </button>
          </div>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="shrink-0"
            >
              <ChevronUp className="w-4 h-4 mr-2" />
              Collapse
            </Button>
          )}
        </div>
        {addAsIndex && (
          <p className="text-xs text-amber-400 mt-1">
            Index mode — Add adds as Index · Select All selects only Index tickers · Section 1256 tax treatment
          </p>
        )}
        {!addAsIndex && (
          <p className="text-xs text-blue-400 mt-1">
            Equity mode — Add adds as Equity · Select All selects only Equity tickers
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Add Input with Equity/Index toggle */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Enter symbols (comma-separated, e.g., AAPL, MSFT, TSLA)"
                value={newSymbol}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setNewSymbol(val);
                  // Auto-detect TRUE cash-settled index symbols as user types.
                  // ETFs (SPY, QQQ, IWM) are intentionally excluded — they are equity-settled.
                  const syms = val.split(',').map(s => s.trim()).filter(Boolean);
                  if (syms.length > 0 && syms.every(s => INDEX_SYMBOLS_SET.has(s))) {
                    setAddAsIndex(true);
                  } else if (syms.length > 0 && syms.every(s => ETF_PROXY_SET.has(s))) {
                    // ETFs typed in — force equity mode so they don't get misclassified
                    setAddAsIndex(false);
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbols()}
              />
            </div>
            <Button onClick={handleAddSymbols} disabled={addToWatchlist.isPending}>
              {addToWatchlist.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </Button>
          </div>
          {/* Type hint below input */}
          <p className="text-xs text-muted-foreground">
            Adding as: <span className={addAsIndex ? 'text-amber-400 font-medium' : 'text-blue-400 font-medium'}>{addAsIndex ? 'Index' : 'Equity'}</span>
            {' '}— switch the toggle above to change
          </p>
          {/* ETF warning: shown when user is in Index mode but has typed an ETF symbol */}
          {addAsIndex && newSymbol && newSymbol.split(',').map(s => s.trim()).some(s => ETF_PROXY_SET.has(s)) && (
            <p className="text-xs text-red-400 font-medium">
              ⚠️ {newSymbol.split(',').map(s => s.trim()).filter(s => ETF_PROXY_SET.has(s)).join(', ')} {newSymbol.split(',').map(s => s.trim()).filter(s => ETF_PROXY_SET.has(s)).length === 1 ? 'is' : 'are'} an equity-settled ETF, not a cash-settled index.
              {' '}ETFs follow equity margin and spread rules — they will be added as Equity regardless.
              {' '}For index-style trading, use the true index (e.g., SPXW instead of SPY).
            </p>
          )}
        </div>

        {/* SPXW Quick-Add Banner */}
        {!watchlist.some((w: WatchlistItem) => w.symbol === 'SPXW') && (
          <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-400">SPX Index Options Available</p>
              <p className="text-xs text-muted-foreground">
                SPXW (weekly PM-settled) — cash settlement, Section 1256 tax treatment, no assignment risk.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10 shrink-0"
              onClick={() => addToWatchlist.mutate({ symbol: 'SPXW', company: 'S&P 500 Index (Weekly)', type: 'Index', sector: 'Index' })}
              disabled={addToWatchlist.isPending}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add SPXW
            </Button>
          </div>
        )}

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
          <WatchlistPills
            watchlist={watchlist}
            watchlistError={watchlistError}
            loadingWatchlist={loadingWatchlist}
            selectionMap={selectionMap}
            onToggle={(symbol) => toggleSelection.mutate({ symbol })}
            onRemove={(symbol) => removeFromWatchlist.mutate({ symbol })}
            onRetry={() => utils.watchlist.get.invalidate()}
          />
        )}

        {/* Expanded View (Table) */}
        {isExpanded && (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Rank</TableHead>
                  <TableHead className="w-[100px]">Symbol</TableHead>
                  <TableHead className="w-[130px]">Settlement</TableHead>
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
                      <TableCell>
                        {(() => {
                          const sym = item.symbol.toUpperCase();
                          const isCashIndex = INDEX_SYMBOLS_SET.has(sym);
                          const isEtf = ETF_PROXY_SET.has(sym);
                          if (isCashIndex) {
                            return (
                              <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-semibold px-2 py-0.5">
                                Cash-Settled
                              </Badge>
                            );
                          } else if (isEtf) {
                            return (
                              <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/40 text-[10px] font-semibold px-2 py-0.5">
                                ETF
                              </Badge>
                            );
                          } else {
                            return (
                              <Badge className="bg-muted/50 text-muted-foreground border border-border text-[10px] font-semibold px-2 py-0.5">
                                Equity
                              </Badge>
                            );
                          }
                        })()}
                      </TableCell>
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
        
        {/* Sticky Action Bar for Selection */}
        {watchlist.length > 0 && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg border border-border flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {selectedCount} of {watchlist.length} selected
                <span className={`ml-2 text-xs font-normal ${addAsIndex ? 'text-amber-400' : 'text-blue-400'}`}>
                  ({addAsIndex ? 'Index' : 'Equity'} mode)
                </span>
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Scope Select All to the active context (Indexes or Equities)
                    const scopedSymbols = watchlist
                      .filter((w: WatchlistItem) => {
                        const isIdx = (w as any).isIndex === true || (w as any).isIndex === 1 || INDEX_SYMBOLS_SET.has(w.symbol);
                        return addAsIndex ? isIdx : !isIdx;
                      })
                      .map((w: WatchlistItem) => w.symbol);
                    selectAll.mutate({ symbols: scopedSymbols });
                  }}
                  disabled={selectAll.isPending}
                >
                  {selectAll.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Select All {addAsIndex ? 'Indexes' : 'Equities'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearAll.mutate({ symbols: watchlist.map((w: WatchlistItem) => w.symbol) })}
                  disabled={selectedCount === 0 || clearAll.isPending}
                >
                  {clearAll.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Clear Selection
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Click tickers to toggle selection • Selections persist across dashboards
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
