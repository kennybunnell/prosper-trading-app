import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, Settings } from "lucide-react";
import { useLocation } from "wouter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export function ConnectionStatusIndicator() {
  const { data: connectionStatus, isLoading } = trpc.settings.getConnectionStatus.useQuery();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return null;
  }

  const allConnected = connectionStatus?.tastytrade.configured && connectionStatus?.tradier.configured;
  const someDisconnected = !connectionStatus?.tastytrade.configured || !connectionStatus?.tradier.configured;

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
                  Setup Required
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
                  Tastytrade: {connectionStatus?.tastytrade.configured ? "Connected" : "Not configured"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {connectionStatus?.tradier.configured ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500" />
                )}
                <span>
                  Tradier: {connectionStatus?.tradier.configured ? "Connected" : "Not configured"}
                </span>
              </div>
            </div>
            {someDisconnected && (
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
