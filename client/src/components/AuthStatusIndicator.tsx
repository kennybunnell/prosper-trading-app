import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Circle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function AuthStatusIndicator() {
  const { data: tokenStatus } = trpc.settings.getTokenStatus.useQuery(undefined, {
    refetchInterval: 60000, // Refresh every minute
  });
  
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [status, setStatus] = useState<'authenticated' | 'expiring' | 'expired'>('authenticated');
  
  useEffect(() => {
    if (!tokenStatus?.expiresAt) {
      setStatus('expired');
      setTimeRemaining('Not authenticated');
      return;
    }
    
    const updateTimer = () => {
      const now = Date.now();
      const expiresAt = new Date(tokenStatus.expiresAt).getTime();
      const diff = expiresAt - now;
      
      if (diff <= 0) {
        setStatus('expired');
        setTimeRemaining('Expired');
        return;
      }
      
      // Calculate time remaining
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      // Update status based on time remaining
      if (diff < 5 * 60 * 1000) { // Less than 5 minutes
        setStatus('expired');
        setTimeRemaining(`${minutes}m ${seconds}s`);
      } else if (diff < 30 * 60 * 1000) { // Less than 30 minutes
        setStatus('expiring');
        setTimeRemaining(`${minutes}m remaining`);
      } else if (hours > 0) {
        setStatus('authenticated');
        setTimeRemaining(`${hours}h ${minutes}m remaining`);
      } else {
        setStatus('authenticated');
        setTimeRemaining(`${minutes}m remaining`);
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [tokenStatus]);
  
  const getStatusColor = () => {
    switch (status) {
      case 'authenticated':
        return 'text-green-500';
      case 'expiring':
        return 'text-yellow-500';
      case 'expired':
        return 'text-red-500';
    }
  };
  
  const getTooltipText = () => {
    switch (status) {
      case 'authenticated':
        return `Tastytrade authentication active. Token expires in ${timeRemaining}.`;
      case 'expiring':
        return `Tastytrade token expiring soon (${timeRemaining}). Click "Force Token Refresh" in Settings if needed.`;
      case 'expired':
        return 'Tastytrade authentication expired. Click "Force Token Refresh" in Settings to restart server and re-login.';
    }
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-background/50 border border-border/50 cursor-help">
            <Circle className={`h-3 w-3 fill-current ${getStatusColor()}`} />
            <span className="text-sm text-muted-foreground">{timeRemaining}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">{getTooltipText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
