import { useTradingMode } from '@/contexts/TradingModeContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { AlertTriangle } from 'lucide-react';

/**
 * Paper Trading / Demo Mode Banner Component
 * 
 * Displays a prominent banner at the top of the page:
 * - DEMO MODE (amber) for trial users or users without real accounts
 * - PAPER TRADING MODE (blue) for paid users in paper trading mode
 * This prevents confusion and makes it crystal clear which mode is active.
 */
export function PaperTradingBanner() {
  const { mode, isLoading } = useTradingMode();
  const { user } = useAuth();
  
  // Check if user has real Tastytrade accounts
  const { data: accountStatus } = trpc.demo.hasRealAccounts.useQuery();
  const hasRealAccounts = accountStatus?.hasRealAccounts ?? false;
  
  // Trial users or users without real accounts are in demo mode
  const isDemo = user?.subscriptionTier === 'free_trial' || !hasRealAccounts;

  // Don't show banner if loading or in live mode
  if (isLoading || mode === 'live') {
    return null;
  }

  return (
    <div className={`sticky top-0 z-50 text-white shadow-lg border-b-2 ${
      isDemo 
        ? 'bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500 border-amber-400'
        : 'bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 border-blue-400'
    }`}>
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-3">
          <AlertTriangle className="h-5 w-5 animate-pulse" />
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">
              {isDemo ? 'DEMO MODE' : 'PAPER TRADING MODE'}
            </span>
            <span className="text-sm opacity-90">|</span>
            <span className="text-sm font-medium opacity-90">
              {isDemo 
                ? 'Simulated $100K account • Practice trading risk-free'
                : 'Read-only market data • No real orders will be executed'
              }
            </span>
          </div>
          <AlertTriangle className="h-5 w-5 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
