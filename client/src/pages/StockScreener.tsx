import { useState, useRef, useEffect, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { TradingViewStockScreener } from '@/components/TradingViewStockScreener';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Search, Plus, X, Star, ChevronRight, TrendingUp, BarChart3,
  Loader2, AlertCircle, BookMarked
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── TradingView Symbol Resolution ───────────────────────────────────────────
// Resolves the correct exchange prefix for a symbol using TradingView's public
// symbol search API. Returns e.g. "NYSE:IBM", "NASDAQ:AAPL", "CBOE:SPX", etc.
// Returns null if the symbol is not found.
async function resolveTVSymbol(symbol: string): Promise<string | null> {
  try {
    const clean = symbol.trim().toUpperCase().replace(/^[A-Z]+:/, ''); // strip any existing prefix
    const url = `https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(clean)}&type=stock,index,fund,dr,structured&exchange=&lang=en&domain=production`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: Array<{ symbol: string; exchange: string; type: string; description: string }> = await res.json();
    if (!data || data.length === 0) return null;
    // Find exact symbol match (case-insensitive)
    const exact = data.find(d => d.symbol.toUpperCase() === clean);
    const best = exact ?? data[0];
    if (!best) return null;
    return `${best.exchange}:${best.symbol}`;
  } catch {
    return null;
  }
}

// ─── TradingView Advanced Chart Panel (slide-out) ────────────────────────────

function TradingViewAdvancedChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // resolvedSymbol holds the exchange-qualified symbol once lookup completes
  const [resolvedSymbol, setResolvedSymbol] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState(false);

  useEffect(() => {
    setResolvedSymbol(null);
    setResolveError(false);
    // If already exchange-qualified, use as-is
    if (symbol.includes(':')) {
      setResolvedSymbol(symbol);
      return;
    }
    resolveTVSymbol(symbol).then(resolved => {
      if (resolved) {
        setResolvedSymbol(resolved);
      } else {
        setResolveError(true);
      }
    });
  }, [symbol]);

  useEffect(() => {
    if (!containerRef.current || !resolvedSymbol) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: resolvedSymbol,
      interval: 'D',
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      gridColor: 'rgba(255, 255, 255, 0.06)',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      studies: [
        'BB@tv-basicstudies',
        'RSI@tv-basicstudies',
        'Volume@tv-basicstudies',
      ],
      show_popup_button: true,
      popup_width: '1000',
      popup_height: '650',
    });

    containerRef.current.appendChild(script);
  }, [resolvedSymbol]);

  if (resolveError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10 text-destructive/60" />
        <p className="text-sm font-medium">Symbol not found on TradingView</p>
        <p className="text-xs text-muted-foreground/60">"{symbol}" could not be resolved to a valid exchange listing.</p>
      </div>
    );
  }

  if (!resolvedSymbol) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Resolving {symbol}...</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full h-full"
      style={{ width: '100%', height: '100%' }}
    >
      <div
        className="tradingview-widget-container__widget"
        style={{ width: '100%', height: 'calc(100% - 32px)' }}
      />
    </div>
  );
}

// ─── Chart Slide-out Panel ────────────────────────────────────────────────────

function ChartSlideOut({
  symbol,
  onClose,
}: {
  symbol: string | null;
  onClose: () => void;
}) {
  // Close on Escape key
  useEffect(() => {
    if (!symbol) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [symbol, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          symbol ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full z-50 flex flex-col bg-[#0f1117] border-l border-border/40 shadow-2xl transition-transform duration-300 ease-in-out ${
          symbol ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: '75vw' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-card/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-base leading-none">
                {symbol ?? '—'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Advanced Chart · BB · RSI · Volume
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30 bg-emerald-400/5">
              TradingView
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Chart area */}
        <div className="flex-1 min-h-0">
          {symbol && <TradingViewAdvancedChart symbol={symbol} />}
        </div>
      </div>
    </>
  );
}

// ─── Watchlist Sidebar ────────────────────────────────────────────────────────

function WatchlistSidebar({
  onSelectSymbol,
  selectedSymbol,
}: {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string | null;
}) {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: watchlist, isLoading, refetch } = trpc.watchlist.get.useQuery();

  const addMutation = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      refetch();
      setInputValue('');
      toast({ title: 'Added to watchlist', description: `${inputValue.toUpperCase()} added successfully.` });
    },
    onError: (err) => {
      toast({ title: 'Failed to add', description: err.message, variant: 'destructive' });
    },
  });

  const removeMutation = trpc.watchlist.remove.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => {
      toast({ title: 'Failed to remove', description: err.message, variant: 'destructive' });
    },
  });

  const [validating, setValidating] = useState(false);

  const handleAdd = useCallback(async () => {
    const raw = inputValue.trim().toUpperCase();
    if (!raw) return;

    // Support comma-separated entry
    const symbols = raw.split(',').map(s => s.trim()).filter(s => s.length > 0 && s.length <= 10);
    if (symbols.length === 0) return;

    setValidating(true);
    const valid: string[] = [];
    const invalid: string[] = [];

    // Validate each symbol against TradingView before adding
    await Promise.all(
      symbols.map(async sym => {
        const resolved = await resolveTVSymbol(sym);
        if (resolved) {
          valid.push(sym);
        } else {
          invalid.push(sym);
        }
      })
    );
    setValidating(false);

    if (invalid.length > 0) {
      toast({
        title: `Unknown symbol${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`,
        description: 'These symbols could not be found on TradingView and were not added.',
        variant: 'destructive',
      });
    }

    for (const sym of valid) {
      addMutation.mutate({ symbol: sym });
    }

    if (valid.length > 0) {
      setInputValue('');
    }
  }, [inputValue, addMutation, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAdd();
  };

  const handleRemove = (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    removeMutation.mutate({ symbol });
  };

  return (
    <aside className="w-72 shrink-0 flex flex-col border-r border-border/40 bg-card/30 backdrop-blur-sm h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 mb-1">
          <BookMarked className="h-4 w-4 text-amber-400" />
          <h3 className="font-semibold text-sm">My Watchlist</h3>
          <Badge variant="secondary" className="ml-auto text-xs h-5 px-1.5">
            {watchlist?.length ?? 0} tickers
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          Click any ticker to open its chart
        </p>
      </div>

      {/* Add ticker input */}
      <div className="px-3 py-2.5 border-b border-border/30">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="TYPE SYMBOL, PRESS ENTER"
              className="pl-8 h-8 text-xs bg-background/50 border-border/50 font-mono tracking-wide placeholder:text-muted-foreground/50 placeholder:font-sans placeholder:tracking-normal"
              maxLength={50}
            />
          </div>
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleAdd}
            disabled={!inputValue.trim() || addMutation.isPending || validating}
          >
            {(addMutation.isPending || validating) ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-1.5 px-0.5">
          Comma-separated for bulk add (e.g. AAPL, TSLA, NVDA)
        </p>
      </div>

      {/* Watchlist items */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !watchlist || watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <Star className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No tickers yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Type a symbol above and press Enter to add it
            </p>
          </div>
        ) : (
            <ul className="space-y-0.5 px-2">
            {watchlist.map((item: any) => {
              const isSelected = selectedSymbol === item.symbol;
              return (
                <li key={item.symbol}>
                  {/* Use div instead of button to avoid nested <button> inside <button> (remove btn) */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSymbol(item.symbol)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelectSymbol(item.symbol); }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all group cursor-pointer select-none ${
                      isSelected
                        ? 'bg-primary/15 border border-primary/30 text-primary'
                        : 'hover:bg-accent/50 text-foreground border border-transparent'
                    }`}
                  >
                    {/* Symbol + company */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-sm leading-none">
                          {item.symbol}
                        </span>
                        {item.isIndex && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1 py-0 border-blue-400/40 text-blue-400">
                            INDEX
                          </Badge>
                        )}
                      </div>
                      {item.company && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5 leading-none">
                          {item.company}
                        </p>
                      )}
                      {item.sector && (
                        <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5 leading-none">
                          {item.sector}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform ${
                          isSelected ? 'text-primary translate-x-0.5' : 'text-muted-foreground/40 group-hover:text-muted-foreground'
                        }`}
                      />
                      <button
                        onClick={e => handleRemove(e, item.symbol)}
                        className="h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                        title={`Remove ${item.symbol}`}
                        type="button"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer hint */}
      {watchlist && watchlist.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground/50 leading-snug">
            Watchlist is shared across all strategy pages (CSP, CC, PMCC, Spreads)
          </p>
        </div>
      )}
    </aside>
  );
}

// ─── Main Screener Page ───────────────────────────────────────────────────────

export default function StockScreener() {
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  const handleSelectSymbol = useCallback((symbol: string) => {
    setChartSymbol(symbol);
  }, []);

  const handleCloseChart = useCallback(() => {
    setChartSymbol(null);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] -m-4 overflow-hidden">
      {/* Page header */}
      <div className="px-5 py-3 border-b border-border/40 bg-card/20 backdrop-blur-sm shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-base leading-none">Stock Screener</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Spot a ticker in the screener → type it in My Watchlist → click to chart
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-600/40">
            Powered by TradingView
          </Badge>
          {chartSymbol && (
            <Badge className="text-xs bg-primary/20 text-primary border-primary/30 border">
              Charting: {chartSymbol}
            </Badge>
          )}
        </div>
      </div>

      {/* Body: watchlist sidebar + screener widget */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Watchlist sidebar */}
        <WatchlistSidebar
          onSelectSymbol={handleSelectSymbol}
          selectedSymbol={chartSymbol}
        />

        {/* Right: TradingView Stock Screener */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <TradingViewStockScreener />
        </div>
      </div>

      {/* Chart slide-out panel */}
      <ChartSlideOut symbol={chartSymbol} onClose={handleCloseChart} />
    </div>
  );
}
