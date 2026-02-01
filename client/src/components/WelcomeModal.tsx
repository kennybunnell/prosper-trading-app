/**
 * Welcome Modal for Demo Mode Users
 * 
 * Displays a welcome message with 60-second countdown timer for trial users
 * entering demo mode for the first time.
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, DollarSign } from "lucide-react";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const [countdown, setCountdown] = useState(60);
  const [canClose, setCanClose] = useState(false);

  useEffect(() => {
    if (!open) {
      setCountdown(60);
      setCanClose(false);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCanClose(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={canClose ? onClose : undefined}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-6 w-6 text-amber-500" />
            Welcome to Prosper Trading Demo Mode!
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
            <p className="text-lg font-semibold text-amber-600 dark:text-amber-400 mb-2">
              🎉 Your demo account is ready!
            </p>
            <p className="text-sm text-muted-foreground">
              You've been given a <span className="font-bold text-foreground">$100,000 simulated account</span> to practice trading strategies risk-free.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Pre-loaded Watchlist</p>
                <p className="text-sm text-muted-foreground">
                  We've added 33 popular symbols to your CSP watchlist to get you started immediately.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <DollarSign className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">All Dashboards Unlocked</p>
                <p className="text-sm text-muted-foreground">
                  Explore CSP, Covered Calls, PMCC, and spread strategies with full access during your trial.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4">
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">
              Getting Started:
            </p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Navigate to <span className="font-medium text-foreground">CSP Dashboard</span> from the sidebar</li>
              <li>Review the pre-loaded watchlist symbols</li>
              <li>Click <span className="font-medium text-foreground">"Scan Opportunities"</span> to find trades</li>
              <li>Select opportunities and use <span className="font-medium text-foreground">"Test Order"</span> to preview</li>
            </ol>
          </div>

          {!canClose && (
            <div className="text-center py-2">
              <p className="text-sm text-muted-foreground">
                Please read the information above ({countdown}s)
              </p>
            </div>
          )}

          <Button
            onClick={onClose}
            disabled={!canClose}
            className="w-full"
            size="lg"
          >
            {canClose ? "Get Started" : `Please wait ${countdown}s...`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
