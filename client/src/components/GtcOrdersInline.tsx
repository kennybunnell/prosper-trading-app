/**
 * GtcOrdersInline
 * Full GTC close-orders view embedded inside the Daily Actions Step 5 tab.
 * Identical logic to GtcOrders.tsx but without the DashboardLayout wrapper.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw, XCircle, CheckCircle2, Clock, AlertTriangle,
  Zap, TrendingUp, DollarSign, BarChart3, Target,
} from 'lucide-react';

const POLL_INTERVAL_MS = 60_000;

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

function getMonthKey(d: Date | string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
function formatMonthLabel(key: string): string {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

export default function GtcOrdersInline() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(POLL_INTERVAL_MS / 1000);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isPollingAll, setIsPollingAll] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

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
      toast({ title: 'Status refreshed', description: `Tastytrade status: ${data.tastyStatus}` });
      utils.gtc.list.invalidate();
    },
    onError: (err) => {
      toast({ title: 'Poll failed', description: err.message, variant: 'destructive' });
    },
  });

  const activeOrders = useMemo(
    () => orders.filter(o => o.status === 'submitted' || o.status === 'pending'),
    [orders]
  );

  const filledOrders = useMemo(
    () => orders.filter(o => o.status === 'filled'),
    [orders]
  );

  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    filledOrders.forEach(o => {
      const k = getMonthKey(o.filledAt);
      if (k) keys.add(k);
    });
    return Array.from(keys).sort().reverse();
  }, [filledOrders]);

  useEffect(() => {
    if (selectedMonth === 'all' && availableMonths.length > 0) {
      const currentKey = getMonthKey(new Date());
      if (availableMonths.includes(currentKey)) {
        setSelectedMonth(currentKey);
      }
    }
  }, [availableMonths, selectedMonth]);

  const monthlyStats = useMemo(() => {
    const map = new Map<string, { premium: number; pnl: number; count: number; winCount: number }>();
    filledOrders.forEach(o => {
      const k = getMonthKey(o.filledAt);
      if (!k) return;
      const existing = map.get(k) || { premium: 0, pnl: 0, count: 0, winCount: 0 };
      const pnl = parseFloat(o.realizedPnl || '0');
      existing.premium += parseFloat(o.totalPremiumCollected || '0');
      existing.pnl += pnl;
      existing.count += 1;
      if (pnl > 0) existing.winCount += 1;
      map.set(k, existing);
    });
    return map;
  }, [filledOrders]);

  const displayStats = useMemo(() => {
    if (selectedMonth === 'all') {
      let totalPremium = 0, totalPnl = 0, count = 0, winCount = 0;
      monthlyStats.forEach(v => {
        totalPremium += v.premium;
        totalPnl += v.pnl;
        count += v.count;
        winCount += v.winCount;
      });
      return { totalPremium, totalPnl, count, winCount };
    }
    const m = monthlyStats.get(selectedMonth);
    return m
      ? { totalPremium: m.premium, totalPnl: m.pnl, count: m.count, winCount: m.winCount }
      : { totalPremium: 0, totalPnl: 0, count: 0, winCount: 0 };
  }, [selectedMonth, monthlyStats]);

  const historicalOrders = useMemo(() => {
    const base = orders.filter(o => o.status === 'filled' || o.status === 'cancelled' || o.status === 'failed');
    if (selectedMonth === 'all') return base;
    return base.filter(o => getMonthKey(o.filledAt || o.cancelledAt || o.createdAt) === selectedMonth);
  }, [orders, selectedMonth]);

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
      } catch { /* individual errors already toasted */ }
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

  const resetCountdown = useCallback(() => setSecondsUntilRefresh(POLL_INTERVAL_MS / 1000), []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!autoRefresh) { setSecondsUntilRefresh(POLL_INTERVAL_MS / 1000); return; }
    countdownRef.current = setInterval(() => {
      setSecondsUntilRefresh(prev => prev <= 1 ? POLL_INTERVAL_MS / 1000 : prev - 1);
    }, 1000);
    intervalRef.current = setInterval(() => { pollAllActive(); resetCountdown(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, pollAllActive, resetCountdown]);

  const handleManualRefresh = async () => {
    await pollAllActive();
    resetCountdown();
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(() => { pollAllActive(); resetCountdown(); }, POLL_INTERVAL_MS);
    }
  };

  function formatDate(d: Date | string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function fmtUsd(v: string | null | undefined) {
    if (!v) return '—';
    const n = parseFloat(v);
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function renderOrderRow(order: typeof orders[0], showPnl = false) {
    const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const isActive = order.status === 'submitted' || order.status === 'pending';
    const pnl = parseFloat(order.realizedPnl || '0');
    const pnlPct = parseFloat(order.realizedPnlPct || '0');

    return (
      <TableRow key={order.id} className="hover:bg-zinc-800/40">
        <TableCell>
          <Badge className={`flex items-center gap-1 w-fit ${cfg.color}`}>
            {cfg.icon}{cfg.label}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="font-medium text-white">{order.symbol}</div>
          <div className="text-xs text-muted-foreground capitalize">{order.sourceStrategy.replace(/_/g, ' ')}</div>
        </TableCell>
        <TableCell className="font-mono text-sm">{order.expiration}</TableCell>
        <TableCell className="font-mono text-sm">
          <div className="text-green-400">{fmtUsd(order.premiumCollected)}</div>
          <div className="text-xs text-muted-foreground">total: {fmtUsd(order.totalPremiumCollected)}</div>
        </TableCell>
        <TableCell>
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">{order.profitTargetPct}%</Badge>
        </TableCell>
        <TableCell className="font-mono text-sm text-amber-300">{fmtUsd(order.targetClosePrice)}</TableCell>
        {showPnl && (
          <TableCell className="font-mono text-sm">
            {order.status === 'filled' && order.realizedPnl ? (
              <div>
                <div className={pnl >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                  {pnl >= 0 ? '+' : ''}{fmtUsd(order.realizedPnl)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {pnlPct.toFixed(1)}% of premium
                  {order.closeCost && <span className="ml-1">(closed @ {fmtUsd(order.closeCost)})</span>}
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">—</span>
            )}
          </TableCell>
        )}
        <TableCell className="font-mono text-xs text-muted-foreground">
          {order.gtcOrderId ? (
            <Tooltip>
              <TooltipTrigger><span className="truncate max-w-[80px] block">{order.gtcOrderId}</span></TooltipTrigger>
              <TooltipContent>{order.gtcOrderId}</TooltipContent>
            </Tooltip>
          ) : '—'}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatDate(order.submittedAt)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {order.filledAt ? formatDate(order.filledAt) : order.cancelledAt ? formatDate(order.cancelledAt) : '—'}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            {isActive && order.gtcOrderId && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                      disabled={pollMutation.isPending}
                      onClick={() => pollMutation.mutate({ gtcDbId: order.id, accountId: order.accountId, gtcOrderId: order.gtcOrderId! })}>
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh status from Tastytrade</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline"
                      className="h-7 px-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                      disabled={cancelMutation.isPending}
                      onClick={() => {
                        if (confirm(`Cancel GTC close order for ${order.symbol}? The position will remain open.`)) {
                          cancelMutation.mutate({ gtcDbId: order.id, accountId: order.accountId, gtcOrderId: order.gtcOrderId! });
                        }
                      }}>
                      <XCircle className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel GTC order (position stays open)</TooltipContent>
                </Tooltip>
              </>
            )}
            {order.status === 'failed' && order.errorMessage && (
              <Tooltip>
                <TooltipTrigger><AlertTriangle className="w-4 h-4 text-red-400" /></TooltipTrigger>
                <TooltipContent className="max-w-xs">{order.errorMessage}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const winRate = displayStats.count > 0 ? (displayStats.winCount / displayStats.count) * 100 : 0;
  const avgPnl = displayStats.count > 0 ? displayStats.totalPnl / displayStats.count : 0;

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-orange-400" />
              Auto-Close Orders (GTC)
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Good-Till-Cancelled close orders placed at your profit target after each STO fill.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700">
              <Zap className={`w-4 h-4 ${autoRefresh ? 'text-amber-400' : 'text-zinc-500'}`} />
              <Label htmlFor="gtc-auto-refresh" className="text-sm text-zinc-300 cursor-pointer select-none">Auto-refresh</Label>
              <Switch id="gtc-auto-refresh" checked={autoRefresh} onCheckedChange={(c) => { setAutoRefresh(c); if (c) resetCountdown(); }} />
              {autoRefresh && <span className="text-xs text-muted-foreground font-mono w-12 text-right">{secondsUntilRefresh}s</span>}
            </div>
            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={isLoading || isPollingAll} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${(isLoading || isPollingAll) ? 'animate-spin' : ''}`} />
              Poll Now
            </Button>
          </div>
        </div>

        {lastRefreshed && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            Last polled: {lastRefreshed.toLocaleTimeString()}
            {autoRefresh && <span className="ml-2 text-zinc-500">· Next poll in {secondsUntilRefresh}s</span>}
          </div>
        )}

        {/* ── Income Summary ── */}
        <Card className="bg-zinc-900/60 border-zinc-700">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                Income Harvest Summary
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Period:</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-8 w-44 text-xs bg-zinc-800 border-zinc-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    {availableMonths.map(k => (
                      <SelectItem key={k} value={k}>{formatMonthLabel(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs text-muted-foreground">Premium Collected</span>
                </div>
                <div className="text-lg font-bold text-green-400">${displayStats.totalPremium.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-muted-foreground">Realized P&L</span>
                </div>
                <div className={`text-lg font-bold ${displayStats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {displayStats.totalPnl >= 0 ? '+' : ''}${displayStats.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs text-muted-foreground">Win Rate</span>
                </div>
                <div className="text-lg font-bold text-amber-400">{winRate.toFixed(0)}%</div>
                <div className="text-xs text-muted-foreground">{displayStats.winCount}/{displayStats.count} trades</div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs text-muted-foreground">Avg P&L / Trade</span>
                </div>
                <div className={`text-lg font-bold ${avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {avgPnl >= 0 ? '+' : ''}${avgPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Active GTC Orders ── */}
        <Card className="bg-zinc-900/60 border-zinc-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-400" />
              Active GTC Orders
              {activeOrders.length > 0 && (
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 ml-1">{activeOrders.length}</Badge>
              )}
            </CardTitle>
            <CardDescription>Positions currently monitored for profit-target close</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading orders…</div>
            ) : activeOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No active GTC orders. GTC orders are created automatically after each STO fill.
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
                      <TableHead className="text-xs">Target %</TableHead>
                      <TableHead className="text-xs">Close At</TableHead>
                      <TableHead className="text-xs">Order ID</TableHead>
                      <TableHead className="text-xs">Submitted</TableHead>
                      <TableHead className="text-xs">Filled / Cancelled</TableHead>
                      <TableHead className="text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeOrders.map(o => renderOrderRow(o, false))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── History ── */}
        <Card className="bg-zinc-900/60 border-zinc-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              History
            </CardTitle>
            <CardDescription>Filled, cancelled, and failed GTC orders</CardDescription>
          </CardHeader>
          <CardContent>
            {historicalOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No historical orders for this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-700">
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Symbol</TableHead>
                      <TableHead className="text-xs">Expiry</TableHead>
                      <TableHead className="text-xs">Premium</TableHead>
                      <TableHead className="text-xs">Target %</TableHead>
                      <TableHead className="text-xs">Close At</TableHead>
                      <TableHead className="text-xs">P&L</TableHead>
                      <TableHead className="text-xs">Order ID</TableHead>
                      <TableHead className="text-xs">Submitted</TableHead>
                      <TableHead className="text-xs">Filled / Cancelled</TableHead>
                      <TableHead className="text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historicalOrders.map(o => renderOrderRow(o, true))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </TooltipProvider>
  );
}
