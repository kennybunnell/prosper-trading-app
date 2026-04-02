import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export function ConnectionStatusIndicator() {
  const { data: connectionStatus, isLoading, refetch } = trpc.settings.getConnectionStatus.useQuery(
    undefined,
    { refetchInterval: 5 * 60 * 1000 } // Poll every 5 minutes — not every second
  );
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [, setLocation] = useLocation();

  // useRef persists across re-renders without triggering them — prevents the loop
  const hasAutoRefreshed = useRef(false);
  // Track which expiresAt value we last processed, so the guard resets on a new token
  const lastExpiresAt = useRef<string>('' );

  const refreshTradierHealth = trpc.settings.refreshTradierHealth.useMutation({
    onSuccess: () => {
      toast.success('Tradier balance updated');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to check balance: ${error.message}`);
    },
  });

  const forceTokenRefresh = trpc.settings.forceTokenRefresh.useMutation({
    onSuccess: (data) => {
      const expiresAt = data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Unknown';
      toast.success(`Token refreshed! Expires at: ${expiresAt}`);
      // Reset the flag so the new token's countdown can auto-refresh again when needed
      hasAutoRefreshed.current = false;
      refetch();
    },
    onError: (error) => {
      toast.error(`Token refresh failed: ${error.message}`);
      // Allow retry after failure
      hasAutoRefreshed.current = false;
    },
  });

  // Stable ref to the mutate function — avoids putting mutation object in useEffect deps
  const mutateFnRef = useRef(forceTokenRefresh.mutate);
  const isPendingRef = useRef(forceTokenRefresh.isPending);
  useEffect(() => {
    mutateFnRef.current = forceTokenRefresh.mutate;
    isPendingRef.current = forceTokenRefresh.isPending;
  });

  const triggerRefresh = useCallback(() => {
    if (!isPendingRef.current) {
      mutateFnRef.current();
    }
  }, []); // Empty deps — stable forever

  // Countdown timer — runs every second, but auto-refresh fires at most ONCE per token
  useEffect(() => {
    const expiresAtStr = connectionStatus?.tastytrade.expiresAt;
    if (!expiresAtStr) {
      setTimeRemaining('');
      return;
    }

    // If we received a brand-new token (different expiresAt), reset the guard
    const expiresAtKey = expiresAtStr instanceof Date ? expiresAtStr.toISOString() : String(expiresAtStr);
    if (lastExpiresAt.current !== expiresAtKey) {
      lastExpiresAt.current = expiresAtKey;
      hasAutoRefreshed.current = false;
    }

    const updateCountdown = () => {
      const now = new Date();
      const expiresAt = new Date(expiresAtStr);
      const diffMs = expiresAt.getTime() - now.getTime();

      if (diffMs <= 0) {
        setTimeRemaining('Expired');
        return;
      }

      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);

      // Auto-refresh exactly once when < 2 minutes remaining
      if (diffMs < 120000 && !hasAutoRefreshed.current) {
        hasAutoRefreshed.current = true; // Set BEFORE calling mutate to prevent races
        console.log('[ConnectionStatusIndicator] Auto-refreshing token (< 2 min remaining)');
        toast.info('Refreshing Tastytrade token...');
        triggerRefresh();
      }

      if (minutes > 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        setTimeRemaining(`${hours}h ${mins}m`);
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s`);
      } else {
        setTimeRemaining(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
    // Only re-run when the token expiry timestamp changes
    // triggerRefresh is stable (empty deps useCallback) — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus?.tastytrade.expiresAt]);

  if (isLoading) {
    return null;
  }

  const allConnected = connectionStatus?.tastytrade.connected && connectionStatus?.tradier.connected;
  const someDisconnected = !connectionStatus?.tastytrade.connected || !connectionStatus?.tradier.connected;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2"
            onClick={() => setLocation("/settings")}
          >
            {allConnected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  APIs Connected
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {connectionStatus?.tastytrade.status === 'expired' ? 'Refresh Token' : 'Setup Required'}
                </span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-2">
            <div className="font-semibold text-sm">API Connection Status</div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                {connectionStatus?.tastytrade.configured ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500" />
                )}
                <span>
                  Tastytrade: {connectionStatus?.tastytrade.connected ? (
                    timeRemaining ? `Connected (${timeRemaining})` : "Connected"
                  ) : (connectionStatus?.tastytrade.configured ? "Token Expired" : "Not configured")}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {connectionStatus?.tradier.configured ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  ) : (
                    <XCircle className="h-3 w-3 text-red-500" />
                  )}
                  <span>
                    Tradier: {connectionStatus?.tradier.connected ? "Connected" : "Not configured"}
                  </span>
                </div>
                {connectionStatus?.tradier.connected && connectionStatus?.tradier.health && (
                  <div className="pl-5 text-xs">
                    <div className={connectionStatus.tradier.health.warning ? "text-amber-500" : "text-green-500"}>
                      Balance: ${connectionStatus.tradier.health.balance}
                      {connectionStatus.tradier.health.warning && " ⚠️"}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {connectionStatus?.tastytrade.status === 'expired' && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerRefresh();
                  }}
                  disabled={forceTokenRefresh.isPending}
                >
                  {forceTokenRefresh.isPending ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3" />
                      Refresh Token
                    </>
                  )}
                </Button>
              </div>
            )}
            {connectionStatus?.tradier.connected && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    refreshTradierHealth.mutate();
                  }}
                  disabled={refreshTradierHealth.isPending}
                >
                  {refreshTradierHealth.isPending ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3" />
                      Check Balance
                    </>
                  )}
                </Button>
              </div>
            )}
            {someDisconnected && connectionStatus?.tastytrade.status !== 'expired' && (
              <div className="text-xs text-muted-foreground pt-1 border-t">
                Click to configure in Settings
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
