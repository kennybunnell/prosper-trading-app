import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, Settings, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export function ConnectionStatusIndicator() {
  const { data: connectionStatus, isLoading, refetch } = trpc.settings.getConnectionStatus.useQuery();
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [, setLocation] = useLocation();
  
  const forceTokenRefresh = trpc.settings.forceTokenRefresh.useMutation({
    onSuccess: (data) => {
      const expiresAt = data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Unknown';
      toast.success(`Token refreshed! Expires at: ${expiresAt}`);
      refetch(); // Update the indicator immediately
    },
    onError: (error) => {
      toast.error(`Token refresh failed: ${error.message}`);
    },
  });
  
  // Update countdown timer every second
  useEffect(() => {
    if (!connectionStatus?.tastytrade.expiresAt) {
      setTimeRemaining('');
      return;
    }
    
    const updateCountdown = () => {
      const now = new Date();
      const expiresAt = new Date(connectionStatus.tastytrade.expiresAt!);
      const diffMs = expiresAt.getTime() - now.getTime();
      
      if (diffMs <= 0) {
        setTimeRemaining('Expired');
        return;
      }
      
      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      
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
            </div>
            {connectionStatus?.tastytrade.status === 'expired' && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    forceTokenRefresh.mutate();
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
