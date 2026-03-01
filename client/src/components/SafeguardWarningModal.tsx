/**
 * SafeguardWarningModal
 *
 * A reusable modal that intercepts any order submission and shows
 * safeguard warnings/blocks before the user can confirm.
 *
 * Usage:
 *   <SafeguardWarningModal
 *     warnings={warnings}
 *     onProceed={() => submitOrder()}
 *     onCancel={() => setShowModal(false)}
 *     orderDescription="Sell 2x AAPL $195 Call (Mar 21)"
 *   />
 *
 * If any warning has severity === 'block', the Proceed button is disabled
 * and the user must cancel or resolve the issue first.
 */

import { AlertTriangle, XCircle, CheckCircle, Info, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface SafeguardWarning {
  safeguard: 1 | 2 | 3 | 4 | 5;
  severity: 'block' | 'warn';
  accountNumber: string;
  symbol: string;
  title: string;
  description: string;
  requiredAction: string;
  conflictingOptionSymbol?: string;
  conflictingStrike?: number;
  conflictingExpiration?: string;
  dte?: number;
  sharesOwned?: number;
  sharesNeeded?: number;
  contractsRequested?: number;
}

const SAFEGUARD_LABELS: Record<number, string> = {
  1: 'Stock Coverage Check',
  2: 'Spread Integrity Lock',
  3: 'Coverage Ratio Check',
  4: 'ITM Expiration Alert',
  5: 'Friday Expiration Sweep',
};

interface SafeguardWarningModalProps {
  open: boolean;
  warnings: SafeguardWarning[];
  orderDescription: string;
  onProceed: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function SafeguardWarningModal({
  open,
  warnings,
  orderDescription,
  onProceed,
  onCancel,
  isSubmitting = false,
}: SafeguardWarningModalProps) {
  const hasBlocks = warnings.some(w => w.severity === 'block');
  const blocks = warnings.filter(w => w.severity === 'block');
  const warns = warnings.filter(w => w.severity === 'warn');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className={`h-5 w-5 ${hasBlocks ? 'text-red-500' : 'text-amber-500'}`} />
            {hasBlocks ? 'Order Blocked — Safety Violation Detected' : 'Safety Warning — Review Before Proceeding'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Order: <span className="font-medium text-foreground">{orderDescription}</span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto pr-1">
          <div className="space-y-4 py-2">
            {/* Summary banner */}
            {hasBlocks ? (
              <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-400">
                    {blocks.length} violation{blocks.length !== 1 ? 's' : ''} must be resolved before this order can proceed.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Submitting this order would create a prohibited position in your IRA/cash account.
                    Resolve each issue below, then retry.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-400">
                    {warns.length} warning{warns.length !== 1 ? 's' : ''} — you may proceed, but review carefully.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    These are advisory warnings, not hard blocks. Ensure you understand the implications before proceeding.
                  </p>
                </div>
              </div>
            )}

            {/* Block violations */}
            {blocks.map((w, i) => (
              <div key={`block-${i}`} className="rounded-lg border border-red-500/30 bg-red-950/30 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <span className="text-sm font-semibold text-red-400">{w.title}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Badge variant="destructive" className="text-xs">BLOCKED</Badge>
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Safeguard {w.safeguard}: {SAFEGUARD_LABELS[w.safeguard]}
                    </Badge>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">{w.description}</p>

                {/* Conflicting position details */}
                {(w.conflictingStrike || w.sharesOwned !== undefined) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {w.conflictingStrike && (
                      <div className="rounded bg-background/50 p-2">
                        <div className="text-muted-foreground">Conflicting Strike</div>
                        <div className="font-medium">${w.conflictingStrike}</div>
                      </div>
                    )}
                    {w.conflictingExpiration && (
                      <div className="rounded bg-background/50 p-2">
                        <div className="text-muted-foreground">Expires</div>
                        <div className="font-medium">{w.conflictingExpiration}</div>
                      </div>
                    )}
                    {w.dte !== undefined && (
                      <div className="rounded bg-background/50 p-2">
                        <div className="text-muted-foreground">DTE</div>
                        <div className={`font-medium ${w.dte <= 2 ? 'text-red-400' : w.dte <= 5 ? 'text-amber-400' : ''}`}>
                          {w.dte} days
                        </div>
                      </div>
                    )}
                    {w.sharesOwned !== undefined && (
                      <div className="rounded bg-background/50 p-2">
                        <div className="text-muted-foreground">Shares Owned</div>
                        <div className="font-medium">{w.sharesOwned.toLocaleString()}</div>
                      </div>
                    )}
                    {w.sharesNeeded !== undefined && (
                      <div className="rounded bg-background/50 p-2">
                        <div className="text-muted-foreground">Shares Needed</div>
                        <div className="font-medium text-red-400">{w.sharesNeeded.toLocaleString()}</div>
                      </div>
                    )}
                    {w.contractsRequested !== undefined && (
                      <div className="rounded bg-background/50 p-2">
                        <div className="text-muted-foreground">Contracts Requested</div>
                        <div className="font-medium text-red-400">{w.contractsRequested}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Required action */}
                <div className="flex items-start gap-2 rounded bg-red-900/20 p-2 border border-red-500/20">
                  <Info className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-300 leading-relaxed">
                    <span className="font-semibold">Required Action: </span>{w.requiredAction}
                  </p>
                </div>
              </div>
            ))}

            {/* Warning violations */}
            {warns.map((w, i) => (
              <div key={`warn-${i}`} className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-sm font-semibold text-amber-400">{w.title}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">WARNING</Badge>
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Safeguard {w.safeguard}: {SAFEGUARD_LABELS[w.safeguard]}
                    </Badge>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">{w.description}</p>

                <div className="flex items-start gap-2 rounded bg-amber-900/20 p-2 border border-amber-500/20">
                  <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-300 leading-relaxed">
                    <span className="font-semibold">Advisory: </span>{w.requiredAction}
                  </p>
                </div>
              </div>
            ))}

            {/* All clear */}
            {warnings.length === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-950/20 p-3">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <p className="text-sm text-green-400">All safeguard checks passed. Safe to proceed.</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel Order
          </Button>
          <Button
            variant={hasBlocks ? 'destructive' : 'default'}
            onClick={onProceed}
            disabled={hasBlocks || isSubmitting}
            className={!hasBlocks ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
          >
            {isSubmitting
              ? 'Submitting...'
              : hasBlocks
              ? 'Cannot Proceed — Resolve Violations First'
              : warns.length > 0
              ? 'Proceed Anyway (Warnings Acknowledged)'
              : 'Confirm Order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
