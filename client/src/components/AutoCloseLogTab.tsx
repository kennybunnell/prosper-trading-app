/**
 * AutoCloseLogTab
 * Displays a persistent execution log of all positions closed by the Auto-Close monitor.
 * Supports sorting by date/symbol/profit%, per-row archive, bulk archive, and an archived view.
 */
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCheck,
  RefreshCw,
  ClipboardList,
  Download,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type SortBy = 'closedAt' | 'profitPct' | 'symbol';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortBy, sortDir }: { col: SortBy; sortBy: SortBy; sortDir: SortDir }) {
  if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 text-gray-600 ml-1 inline" />;
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-orange-400 ml-1 inline" />
    : <ArrowDown className="w-3 h-3 text-orange-400 ml-1 inline" />;
}

export function AutoCloseLogTab() {
  const { toast } = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('closedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data: logs = [], isLoading, refetch } = trpc.autoClose.getAutoCloseLogs.useQuery({
    archived: showArchived,
    sortBy,
    sortDir,
    limit: 200,
  });

  const utils = trpc.useUtils();

  const archiveMutation = trpc.autoClose.archiveAutoCloseLog.useMutation({
    onSuccess: () => {
      utils.autoClose.getAutoCloseLogs.invalidate();
    },
    onError: (err) => {
      toast({ title: 'Archive failed', description: err.message, variant: 'destructive' });
    },
  });

  const bulkArchiveMutation = trpc.autoClose.bulkArchiveAutoCloseLogs.useMutation({
    onSuccess: () => {
      utils.autoClose.getAutoCloseLogs.invalidate();
      toast({ title: 'All entries archived', description: 'You can view them in the Archived tab.' });
    },
    onError: (err) => {
      toast({ title: 'Bulk archive failed', description: err.message, variant: 'destructive' });
    },
  });

  function toggleSort(col: SortBy) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatProfitPct(pct: string | number) {
    const val = parseFloat(String(pct));
    const color = val >= 75 ? 'text-green-400' : val >= 50 ? 'text-yellow-400' : 'text-orange-400';
    return <span className={`font-semibold ${color}`}>{val.toFixed(1)}%</span>;
  }

  function calcPnlDollar(log: typeof logs[number]): string {
    // P/L $ = qty × (open - close) × 100  (short option: profit when close < open)
    const open = parseFloat(String(log.openPrice));
    const close = parseFloat(String(log.closePrice));
    const qty = log.quantity ?? 1;
    const pnl = (open - close) * qty * 100;
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${Math.abs(pnl).toFixed(0)}`;
  }

  function exportCsv() {
    const headers = ['Symbol','Type','Strike','Expiration','Account','Qty','Open Price','Close Price','P/L %','P/L $','Target %','Close Reason','Closed At'];
    const rows = logs.map(log => [
      log.symbol,
      log.optionType === 'P' ? 'Put' : 'Call',
      log.strike,
      log.expiration,
      log.accountNumber,
      log.quantity,
      parseFloat(String(log.openPrice)).toFixed(2),
      parseFloat(String(log.closePrice)).toFixed(2),
      parseFloat(String(log.profitPct)).toFixed(1) + '%',
      calcPnlDollar(log),
      log.targetPct + '%',
      log.closeReason ?? '',
      new Date(log.closedAt).toLocaleString(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-close-log-${showArchived ? 'archived' : 'active'}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-orange-400" />
          <h3 className="text-white font-semibold text-lg">Execution Log</h3>
          <Badge variant="outline" className="text-gray-400 border-gray-700 text-xs">
            {logs.length} {showArchived ? 'archived' : 'active'} record{logs.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Active / Archived toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => setShowArchived(false)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                !showArchived ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                showArchived ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Archived
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-gray-700 text-gray-400 hover:text-white h-8"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Refresh
          </Button>

          {logs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              className="border-gray-700 text-gray-400 hover:text-white h-8"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Export CSV
            </Button>
          )}

          {!showArchived && logs.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-700 text-gray-400 hover:text-white h-8"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1" />
                  Archive All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-gray-900 border-gray-700">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white">Archive all active records?</AlertDialogTitle>
                  <AlertDialogDescription className="text-gray-400">
                    This will mark all {logs.length} active log entries as archived. You can still view them in the Archived tab.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-gray-700 text-gray-400">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => bulkArchiveMutation.mutate()}
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    Archive All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && logs.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-400">
            {showArchived ? 'No archived records yet.' : 'No auto-close events recorded yet.'}
          </p>
          <p className="text-sm mt-1">
            {showArchived
              ? 'Archive active records to move them here.'
              : 'When the Auto-Close monitor closes a position, it will appear here.'}
          </p>
        </div>
      )}

      {/* Table */}
      {logs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th
                  className="px-4 py-3 text-left text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                  onClick={() => toggleSort('symbol')}
                >
                  Symbol <SortIcon col="symbol" sortBy={sortBy} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">Type</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">Strike / Exp</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">Account</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">Qty</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">Open</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">Close</th>
                <th
                  className="px-4 py-3 text-right text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                  onClick={() => toggleSort('profitPct')}
                >
                  P/L % <SortIcon col="profitPct" sortBy={sortBy} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">P/L $</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">Target %</th>
                <th className="px-4 py-3 text-center text-gray-400 font-medium">Reason</th>
                <th
                  className="px-4 py-3 text-left text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                  onClick={() => toggleSort('closedAt')}
                >
                  Closed At <SortIcon col="closedAt" sortBy={sortBy} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3 text-center text-gray-400 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, idx) => (
                <tr
                  key={log.id}
                  className={`border-b border-gray-800/50 transition-colors hover:bg-gray-800/30 ${
                    idx % 2 === 0 ? 'bg-gray-900/20' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-white font-semibold">{log.symbol}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={`text-xs font-bold ${
                        log.optionType === 'P'
                          ? 'border-blue-500/50 text-blue-400'
                          : 'border-red-500/50 text-red-400'
                      }`}
                    >
                      {log.optionType === 'P' ? 'Put' : 'Call'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    <div>${log.strike}</div>
                    <div className="text-xs text-gray-500">{log.expiration}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">{log.accountNumber}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{log.quantity}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    ${parseFloat(String(log.openPrice)).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    ${parseFloat(String(log.closePrice)).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatProfitPct(log.profitPct)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const pnl = calcPnlDollar(log);
                      const isPositive = pnl.startsWith('+');
                      return <span className={`font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>{pnl}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{log.targetPct}%</td>
                  <td className="px-4 py-3 text-center">
                    {log.closeReason === 'profit_target' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-medium whitespace-nowrap">
                        ✓ Profit Target
                      </span>
                    )}
                    {log.closeReason === 'stop_loss' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-medium whitespace-nowrap">
                        ✗ Stop Loss
                      </span>
                    )}
                    {log.closeReason === 'dte_floor' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 font-medium whitespace-nowrap">
                        ⏱ DTE Floor
                      </span>
                    )}
                    {log.closeReason === 'manual' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 font-medium whitespace-nowrap">
                        Manual
                      </span>
                    )}
                    {!log.closeReason && (
                      <span className="text-gray-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {formatDate(log.closedAt)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-gray-500 hover:text-white"
                      title={log.archived ? 'Restore to active' : 'Archive this record'}
                      onClick={() =>
                        archiveMutation.mutate({ id: log.id, archived: !log.archived })
                      }
                      disabled={archiveMutation.isPending}
                    >
                      {log.archived
                        ? <ArchiveRestore className="w-4 h-4" />
                        : <Archive className="w-4 h-4" />
                      }
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-800/40 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Info note */}
      {!showArchived && (
        <p className="text-xs text-gray-600 mt-2">
          Records persist indefinitely. Click <Archive className="w-3 h-3 inline" /> to archive a reviewed entry, or use Archive All to clear the active view at once.
        </p>
      )}
    </div>
  );
}
