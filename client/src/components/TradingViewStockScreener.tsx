import { useEffect, useRef } from 'react';

/**
 * TradingView Stock Screener widget — full market screener with technical ratings,
 * fundamentals, market cap, sector filters, etc.
 * Renders at 100% width/height of its container.
 */
export function TradingViewStockScreener() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-screener.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      width: '100%',
      height: '100%',
      defaultColumn: 'overview',
      defaultScreen: 'most_capitalized',
      market: 'america',
      showToolbar: true,
      colorTheme: 'dark',
      locale: 'en',
      isTransparent: true,
    });

    containerRef.current.appendChild(script);
  }, []);

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
      <div className="tradingview-widget-copyright text-xs text-slate-600 px-2 py-1">
        <a
          href="https://www.tradingview.com/screener/"
          rel="noopener nofollow"
          target="_blank"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          Stock Screener
        </a>
        <span className="text-slate-700"> by TradingView</span>
      </div>
    </div>
  );
}
