import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RefreshCw, XCircle, CheckCircle2, Clock, AlertTriangle, Info, Zap } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Pending',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    icon: <Clock className="w-3 h-3" />,
  },
  submitted: {
    label: 'Active GTC',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
    icon: <RefreshCw className="w-3 h-3 animate-spin" />,
  },
  filled: {
    label: 'Filled ✓',
    color: 'bg-green-500/20 text-green-400 border-green-500/40',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40',
    icon: <XCircle className="w-3 h-3" />,
  },
  failed: {
    label: 'Failed',
    color: 'bg-red-500/20 text-red-400 border-red-500/40',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

export default function GtcOrders() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  // ── Auto-refresh state ────────────────────────────────────────────────────
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(POLL_INTERVAL_MS / 1000);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isPollingAll, setIsPollingAll] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: orders = [], isLoading, refetch } = trpc.gtc.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const cancelMutation = trpc.gtc.cancel.useMutation({
    onSuccess: () => {
      toast({ title: 'GTC order cancelled', description: 'The close order has been cancelled on Tastytrade.' });
      utils.gtc.list.invalidate();
    },
    onError: (err) => {
      toast({ title: 'Cancel failed', description: err.message, variant: 'destructive' });
    },
  });

  const pollMutation = trpc.gtc.poll.useMutation({
    onSuccess: (data) => {
      toast({
        title: 'Status refreshed',
        description: `Tastytrade status: ${data.tastyStatus}`,
      });
      utils.gtc.list.invalidate();
    },
    onError: (err) => {
      toast({ title: 'Poll failed', description: err.message, variant: 'destructive' });
    },
  });

  const activeOrders = orders.filter(o => o.status === 'submitted' || o.status === 'pending');
  const historicalOrders = orders.filter(o => o.status === 'filled' || o.status === 'cancelled' || o.status === 'failed');

  // ── Bulk poll all active orders ───────────────────────────────────────────
  const pollAllActive = useCallback(async () => {
    const pollable = activeOrders.filter(o => o.gtcOrderId && o.status === 'submitted');
    if (pollable.length === 0) {
      await refetch();
      setLastRefreshed(new Date());
      return;
    }
    setIsPollingAll(true);
    let filledCount = 0;
    for (const order of pollable) {
      try {
        const result = await pollMutation.mutateAsync({
          gtcDbId: order.id,
          accountId: order.accountId,
          gtcOrderId: order.gtcOrderId!,
        });
        if (result.tastyStatus === 'Filled') filledCount++;
      } catch {
        // individual poll errors are already toasted by the mutation
      }
    }
    setIsPollingAll(false);
    setLastRefreshed(new Date());
    if (filledCount > 0) {
      toast({
        title: `🎉 ${filledCount} GTC order${filledCount > 1 ? 's' : ''} filled!`,
        description: 'Your profit target was reached. Check the History section below.',
      });
    }
  }, [activeOrders, pollMutation, refetch, toast]);

  // ── Countdown + auto-refresh interval ────────────────────────────────────
  const resetCountdown = useCallback(() => {
    setSecondsUntilRefresh(POLL_INTERVAL_MS / 1000);
  }, []);

  useEffect(() => {
    // Clear any existing timers
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (!autoRefresh) {
      setSecondsUntilRefresh(POLL_INTERVAL_MS / 1000);
      return;
    }

    // Countdown ticker (every second)
    countdownRef.current = setInterval(() => {
      setSecondsUntilRefresh(prev => {
        if (prev <= 1) return POLL_INTERVAL_MS / 1000;
        return prev - 1;
      });
    }, 1000);

    // Main poll interval (every 60s)
    intervalRef.current = setInterval(() => {
      pollAllActive();
      resetCountdown();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, pollAllActive, resetCountdown]);

  // Manual refresh: poll all + reset countdown
  const handleManualRefresh = async () => {
    await pollAllActive();
    resetCountdown();
    // Restart the interval from now
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        pollAllActive();
        resetCountdown();
      }, POLL_INTERVAL_MS);
    }
  };

  function formatDate(d: Date | string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function renderOrderRow(order: typeof orders[0]) {
    const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const isActive = order.status === 'submitted' || order.status === 'pending';

    return (
      <TableRow key={order.id} className="hover:bg-zinc-800/40">
        {/* Status */}
        <TableCell>
          <Badge className={`flex items-center gap-1 w-fit ${cfg.color}`}>
            {cfg.icon}
            {cfg.label}
          </Badge>
        </TableCell>

        {/* Symbol + Strategy */}
        <TableCell>
          <div className="font-medium text-white">{order.symbol}</div>
          <div className="text-xs text-muted-foreground capitalize">{order.sourceStrategy.replace(/_/g, ' ')}</div>
        </TableCell>

        {/* Expiration */}
        <TableCell className="font-mono text-sm">{order.expiration}</TableCell>

        {/* Premium collected */}
        <TableCell className="font-mono text-sm">
          <div className="text-green-400">${order.premiumCollected}</div>
          <div className="text-xs text-muted-foreground">total: ${order.totalPremiumCollected}</div>
        </TableCell>

        {/* Profit target */}
        <TableCell>
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">
            {order.profitTargetPct}%
          </Badge>
        </TableCell>

        {/* GTC close price */}
        <TableCell className="font-mono text-sm text-amber-300">
          ${order.targetClosePrice}
        </TableCell>

        {/* GTC Order ID */}
        <TableCell className="font-mono text-xs text-muted-foreground">
          {order.gtcOrderId ? (
            <Tooltip>
              <TooltipTrigger>
                <span className="truncate max-w-[80px] block">{order.gtcOrderId}</span>
              </TooltipTrigger>
              <TooltipContent>{order.gtcOrderId}</TooltipContent>
            </Tooltip>
          ) : '—'}
        </TableCell>

        {/* Submitted at */}
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(order.submittedAt)}
        </TableCell>

        {/* Filled / Cancelled at */}
        <TableCell className="text-xs text-muted-foreground">
          {order.filledAt ? formatDate(order.filledAt) :
           order.cancelledAt ? formatDate(order.cancelledAt) : '—'}
        </TableCell>

        {/* Actions */}
        <TableCell>
          <div className="flex items-center gap-1">
            {isActive && order.gtcOrderId && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={pollMutation.isPending}
                      onClick={() => pollMutation.mutate({
                        gtcDbId: order.id,
                        accountId: order.accountId,
                        gtcOrderId: order.gtcOrderId!,
                      })}
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh status from Tastytrade</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                      disabled={cancelMutation.isPending}
                      onClick={() => {
                        if (confirm(`Cancel GTC close order for ${order.symbol}? The position will remain open.`)) {
                          cancelMutation.mutate({
                            gtcDbId: order.id,
                            accountId: order.accountId,
                            gtcOrderId: order.gtcOrderId!,
                          });
                        }
                      }}
                    >
                      <XCircle className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel GTC order (position stays open)</TooltipContent>
                </Tooltip>
              </>
            )}
            {order.status === 'failed' && order.errorMessage && (
              <Tooltip>
                <TooltipTrigger>
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{order.errorMessage}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <DashboardLayout>
      <TooltipProvider>
        <div className="space-y-6 p-6">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">GTC Close Orders</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Automated Good-Till-Cancelled close orders placed at your profit target after each STO fill.
              </p>
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-4">
              {/* Auto-refresh toggle */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700">
                <Zap className={`w-4 h-4 ${autoRefresh ? 'text-amber-400' : 'text-zinc-500'}`} />
                <Label htmlFor="auto-refresh" className="text-sm text-zinc-300 cursor-pointer select-none">
                  Auto-refresh
                </Label>
                <Switch
                  id="auto-refresh"
                  checked={autoRefresh}
                  onCheckedChange={(checked) => {
                    setAutoRefresh(checked);
                    if (checked) resetCountdown();
                  }}
                />
                {autoRefresh && (
                  <span className="text-xs text-muted-foreground font-mono w-12 text-right">
                    {secondsUntilRefresh}s
                  </span>
                )}
              </div>

              {/* Manual refresh */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualRefresh}
                disabled={isLoading || isPollingAll}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${(isLoading || isPollingAll) ? 'animate-spin' : ''}`} />
                Poll Now
              </Button>
            </div>
          </div>

          {/* Last refreshed + status strip */}
          {lastRefreshed && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              Last polled: {lastRefreshed.toLocaleTimeString()}
              {autoRefresh && (
                <span className="ml-2 text-zinc-500">
                  · Next poll in {secondsUntilRefresh}s
                </span>
              )}
            </div>
          )}

          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong>How GTC automation works:</strong> After you confirm a live STO fill in the order modal,
              Prosper automatically submits a BTC limit order at your profit target price (75% by default) with
              time-in-force = GTC. The position closes itself when the market reaches your target — no manual
              monitoring required. With auto-refresh on, Prosper polls Tastytrade every 60 seconds and alerts
              you immediately when a GTC order fills.
            </div>
          </div>

          {/* Active GTC Orders */}
          <Card className="bg-zinc-900/60 border-zinc-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base text-white flex items-center gap-2">
                    <RefreshCw className={`w-4 h-4 text-blue-400 ${isPollingAll ? 'animate-spin' : ''}`} />
                    Active GTC Orders
                    {activeOrders.length > 0 && (
                      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 ml-1">
                        {activeOrders.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {autoRefresh
                      ? `Auto-polling every 60 seconds. Next poll in ${secondsUntilRefresh}s.`
                      : 'Auto-refresh is off. Click "Poll Now" to check for fills.'}
                  </CardDescription>
                </div>
                {/* Animated pulse indicator when auto-refresh is on and there are active orders */}
                {autoRefresh && activeOrders.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                    </span>
                    Live
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {activeOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No active GTC orders. Submit an STO trade and confirm the fill to create one.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-700">
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Symbol</TableHead>
                        <TableHead className="text-xs">Expiry</TableHead>
                        <TableHead className="text-xs">Premium</TableHead>
                        <TableHead className="text-xs">Target</TableHead>
                        <TableHead className="text-xs">Close At</TableHead>
                        <TableHead className="text-xs">Order ID</TableHead>
                        <TableHead className="text-xs">Submitted</TableHead>
                        <TableHead className="text-xs">Closed</TableHead>
                        <TableHead className="text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeOrders.map(renderOrderRow)}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Historical GTC Orders */}
          <Card className="bg-zinc-900/60 border-zinc-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                History
              </CardTitle>
              <CardDescription>Filled, cancelled, and failed GTC orders.</CardDescription>
            </CardHeader>
            <CardContent>
              {historicalOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No historical GTC orders yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-700">
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Symbol</TableHead>
                        <TableHead className="text-xs">Expiry</TableHead>
                        <TableHead className="text-xs">Premium</TableHead>
                        <TableHead className="text-xs">Target</TableHead>
                        <TableHead className="text-xs">Close At</TableHead>
                        <TableHead className="text-xs">Order ID</TableHead>
                        <TableHead className="text-xs">Submitted</TableHead>
                        <TableHead className="text-xs">Closed</TableHead>
                        <TableHead className="text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historicalOrders.map(renderOrderRow)}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>
    </DashboardLayout>
  );
}
