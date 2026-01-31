import { useTradingMode } from '@/contexts/TradingModeContext';
import { AlertTriangle } from 'lucide-react';

/**
 * Paper Trading Banner Component
 * 
 * Displays a prominent banner at the top of the page when the user is in paper trading mode.
 * This prevents confusion and makes it crystal clear which mode is active.
 */
export function PaperTradingBanner() {
  const { mode, isLoading } = useTradingMode();

  // Don't show banner if loading or in live mode
  if (isLoading || mode === 'live') {
    return null;
  }

  return (
    <div className="sticky top-0 z-50 bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 text-white shadow-lg border-b-2 border-blue-400">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-3">
          <AlertTriangle className="h-5 w-5 animate-pulse" />
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">PAPER TRADING MODE</span>
            <span className="text-sm opacity-90">|</span>
            <span className="text-sm font-medium opacity-90">
              Read-only market data • No real orders will be executed
            </span>
          </div>
          <AlertTriangle className="h-5 w-5 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
