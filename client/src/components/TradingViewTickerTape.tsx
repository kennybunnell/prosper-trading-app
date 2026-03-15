import { useEffect, useRef } from 'react';

/**
 * TradingView Ticker Tape widget — scrolling live prices for key market symbols.
 * Renders as a full-width horizontal strip, auto-height.
 */
export function TradingViewTickerTape() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Avoid duplicate scripts on HMR re-mount
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [
        { description: 'S&P 500',    proName: 'CBOE:SPX'      },
        { description: 'NASDAQ 100', proName: 'NASDAQ:NDX'    },
        { description: 'Russell 2K', proName: 'CBOE:RUT'      },
        { description: 'VIX',        proName: 'CBOE:VIX'      },
        { description: 'AAPL',       proName: 'NASDAQ:AAPL'   },
        { description: 'TSLA',       proName: 'NASDAQ:TSLA'   },
        { description: 'NVDA',       proName: 'NASDAQ:NVDA'   },
        { description: 'MSFT',       proName: 'NASDAQ:MSFT'   },
        { description: 'AMZN',       proName: 'NASDAQ:AMZN'   },
        { description: 'META',       proName: 'NASDAQ:META'   },
        { description: 'GOOGL',      proName: 'NASDAQ:GOOGL'  },
        { description: '10Y Yield',  proName: 'TVC:US10Y'     },
        { description: 'Gold',       proName: 'TVC:GOLD'      },
        { description: 'Oil (WTI)',  proName: 'TVC:USOIL'     },
      ],
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: 'adaptive',
      colorTheme: 'dark',
      locale: 'en',
    });

    containerRef.current.appendChild(script);
  }, []);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full"
      style={{ width: '100%' }}
    >
      <div className="tradingview-widget-container__widget" />
    </div>
  );
}
