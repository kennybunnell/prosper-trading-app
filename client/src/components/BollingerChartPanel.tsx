import { useEffect, useRef, memo } from 'react';
import { X, BarChart2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BollingerChartPanelProps {
  symbol: string;
  /** Optional current strike price — shown in the header as a reference label */
  strikePrice?: number;
  onClose: () => void;
}

/**
 * Maps internal option-root symbols to their underlying TradingView ticker.
 * TradingView uses the exchange-qualified format, e.g. "CBOE:SPX".
 */
function resolveSymbol(raw: string): string {
  const map: Record<string, string> = {
    SPXW: 'CBOE:SPX',
    SPX: 'CBOE:SPX',
    NDXP: 'NASDAQ:NDX',
    NDX: 'NASDAQ:NDX',
    MRUT: 'CBOE:RUT',
    RUT: 'CBOE:RUT',
  };
  if (map[raw.toUpperCase()]) return map[raw.toUpperCase()];
  // Default: assume NYSE/NASDAQ — TradingView auto-resolves plain tickers
  return raw.toUpperCase();
}

// Inner widget component — memoized so it only re-mounts when symbol changes
const TradingViewChart = memo(function TradingViewChart({ tvSymbol }: { tvSymbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Remove any previous widget script to avoid duplicates on symbol change
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: 'D',
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',              // candlestick
      locale: 'en',
      backgroundColor: 'rgba(13, 17, 23, 1)',
      gridColor: 'rgba(30, 36, 51, 1)',
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: true,
      studies: [
        'BB@tv-basicstudies',
        'RSI@tv-basicstudies',
        'Volume@tv-basicstudies',
      ],
      show_popup_button: true,
      popup_width: '1200',
      popup_height: '700',
      support_host: 'https://www.tradingview.com',
    });

    containerRef.current.appendChild(script);
  }, [tvSymbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full h-full"
      style={{ height: '100%', width: '100%' }}
    >
      <div
        className="tradingview-widget-container__widget"
        style={{ height: 'calc(100% - 32px)', width: '100%' }}
      />
      <div className="tradingview-widget-copyright text-xs text-slate-600 px-2 py-1">
        <a
          href={`https://www.tradingview.com/symbols/${tvSymbol}/`}
          rel="noopener nofollow"
          target="_blank"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          {tvSymbol} chart
        </a>
        <span className="text-slate-700"> by TradingView</span>
      </div>
    </div>
  );
});

export function BollingerChartPanel({ symbol, strikePrice, onClose }: BollingerChartPanelProps) {
  const tvSymbol = resolveSymbol(symbol);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-[75vw] max-w-[95vw] min-w-[600px] bg-[#0d1117] border-l border-slate-700/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-[#0f1117] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart2 className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="font-bold text-white text-sm">{symbol}</span>
          {tvSymbol !== symbol.toUpperCase() && (
            <span className="text-slate-500 text-xs">→ {tvSymbol}</span>
          )}
          <span className="text-slate-500 text-xs hidden sm:inline">
            · Bollinger Bands · RSI · Volume
          </span>
          {strikePrice && (
            <span className="text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded px-1.5 py-0.5 ml-1">
              Strike ${strikePrice.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={`https://www.tradingview.com/symbols/${tvSymbol}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-slate-700/50"
            title="Open on TradingView"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="hidden sm:inline">TradingView</span>
          </a>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-7 w-7 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Chart — fills remaining height */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <TradingViewChart tvSymbol={tvSymbol} />
      </div>
    </div>
  );
}
