import { useTradingMode } from '@/contexts/TradingModeContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { AlertTriangle } from 'lucide-react';

/**
 * Paper Trading Banner Component
 * 
 * Displays a prominent banner at the top of the page when the user is in paper trading mode.
 * This prevents confusion and makes it crystal clear which mode is active.
 */
export function PaperTradingBanner() {
  const { mode, isLoading } = useTradingMode();
  const { user } = useAuth();
  
  // Check if user is on free trial (demo mode)
  const isDemo = user?.subscriptionTier === 'free_trial';

  // Don't show banner if loading
  if (isLoading) {
    return null;
  }
  
  // Show Demo Mode banner for trial users (always show, regardless of mode)
  if (isDemo) {
    return (
      <div className="sticky top-0 z-50 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 text-white shadow-lg border-b-2 border-amber-400">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-center gap-3">
            <AlertTriangle className="h-5 w-5 animate-pulse" />
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg">DEMO MODE</span>
              <span className="text-sm opacity-90">|</span>
              <span className="text-sm font-medium opacity-90">
                Simulated $100K account • Practice trading risk-free
              </span>
            </div>
            <AlertTriangle className="h-5 w-5 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Show Paper Trading banner for paid users (only if in paper mode)
  if (mode !== 'paper') {
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
