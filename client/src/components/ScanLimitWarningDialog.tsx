import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, Zap } from "lucide-react";
import { Link } from "wouter";

interface ScanLimitWarningDialogProps {
  open: boolean;
  onClose: () => void;
  scansRemaining: number;
  scansLimit: number;
}

export function ScanLimitWarningDialog({ open, onClose, scansRemaining, scansLimit }: ScanLimitWarningDialogProps) {
  const scansUsed = scansLimit - scansRemaining;
  const isOutOfScans = scansRemaining === 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOutOfScans ? (
              <>
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Daily Scan Limit Reached
              </>
            ) : (
              <>
                <Zap className="h-5 w-5 text-orange-500" />
                Running Low on Scans
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isOutOfScans ? (
              <>
                You've used all <strong>{scansLimit} scans</strong> for today. Your daily limit will reset tomorrow.
              </>
            ) : (
              <>
                You've used <strong>{scansUsed}/{scansLimit} scans</strong> today. Only <strong>{scansRemaining} {scansRemaining === 1 ? 'scan' : 'scans'}</strong> remaining.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isOutOfScans ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-sm text-red-500 font-medium mb-2">
                🚫 No more scans available today
              </p>
              <p className="text-sm text-muted-foreground">
                Upgrade to <strong>Wheel Trading</strong> for unlimited scans and continue analyzing opportunities without interruption.
              </p>
            </div>
          ) : (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
              <p className="text-sm text-orange-500 font-medium mb-2">
                ⚠️ You're running low on scans
              </p>
              <p className="text-sm text-muted-foreground">
                Upgrade now to avoid hitting your daily limit and get unlimited scans for the rest of the month.
              </p>
            </div>
          )}

          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-semibold text-sm">Wheel Trading - $47/month</h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span><strong>Unlimited scans</strong> - No daily limits</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Paper trading for all strategies</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Advanced filtering and scoring</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Performance tracking and analytics</span>
              </li>
            </ul>
          </div>

          {!isOutOfScans && (
            <p className="text-xs text-muted-foreground text-center">
              Note: You'll need your own Tradier API key (requires funded brokerage account)
            </p>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {isOutOfScans ? 'Close' : 'Continue with Trial'}
          </Button>
          <Link href="/subscription">
            <Button className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800">
              <TrendingUp className="h-4 w-4 mr-2" />
              Upgrade Now
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
