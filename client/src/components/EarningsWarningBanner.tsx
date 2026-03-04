import React from 'react';
import { AlertTriangle, XOctagon } from 'lucide-react';

interface EarningsWarning {
  symbol: string;
  earningsDate: string;
  daysUntil: number;
  severity: 'blocked' | 'warned';
}

interface Props {
  warnings: EarningsWarning[];
}

/**
 * Displays a yellow (warning) or red (blocked) banner in order confirmation dialogs
 * when symbols have upcoming earnings.
 */
export function EarningsWarningBanner({ warnings }: Props) {
  if (!warnings.length) return null;

  const blocked = warnings.filter(w => w.severity === 'blocked');
  const warned = warnings.filter(w => w.severity === 'warned');

  return (
    <div className="space-y-2 mb-4">
      {blocked.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3">
          <XOctagon className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400">
              ⛔ EARNINGS BLOCK — Orders will be rejected
            </p>
            <p className="text-xs text-red-300/80 mt-1">
              {blocked.map(b => `${b.symbol} (earnings ${b.earningsDate}, ${b.daysUntil}d away)`).join(', ')}
            </p>
            <p className="text-xs text-red-300/60 mt-1">
              Selling options within 7 days of earnings carries extreme risk from overnight IV crush and gap moves.
            </p>
          </div>
        </div>
      )}
      {warned.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
          <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-400">
              ⚠ EARNINGS WARNING — Proceed with caution
            </p>
            <p className="text-xs text-yellow-300/80 mt-1">
              {warned.map(w => `${w.symbol} (earnings ${w.earningsDate}, ${w.daysUntil}d away)`).join(', ')}
            </p>
            <p className="text-xs text-yellow-300/60 mt-1">
              These symbols have earnings within 14 days. Consider whether the position will expire before the earnings date.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
