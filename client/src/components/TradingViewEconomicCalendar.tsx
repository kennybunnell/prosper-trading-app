import { useEffect, useRef } from 'react';

/**
 * TradingView Economic Calendar widget — shows upcoming economic events,
 * Fed meetings, CPI, NFP, earnings, etc. Critical context for options traders.
 * Uses the iframe-based embed (not Web Component) for reliable dark theme support.
 */
export function TradingViewEconomicCalendar() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Avoid duplicate scripts on HMR re-mount
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme: 'dark',
      isTransparent: true,
      width: '100%',
      height: '100%',
      locale: 'en',
      importanceFilter: '-1,0,1',
      countryFilter: 'us',
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
          href="https://www.tradingview.com/economic-calendar/"
          rel="noopener nofollow"
          target="_blank"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          Economic Calendar
        </a>
        <span className="text-slate-700"> by TradingView</span>
      </div>
    </div>
  );
}
