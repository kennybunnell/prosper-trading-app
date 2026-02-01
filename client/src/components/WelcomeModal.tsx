import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket, DollarSign, TrendingUp, List, FileDown } from "lucide-react";
import { useState, useEffect } from "react";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const [countdown, setCountdown] = useState(60);
  
  // Auto-close after 60 seconds
  useEffect(() => {
    if (!open) {
      setCountdown(60);
      return;
    }
    
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onClose();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [open, onClose]);
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" />
            Welcome to Prosper Trading!
          </DialogTitle>
          <DialogDescription className="text-base pt-4 space-y-4">
            <div className="flex items-start gap-3">
              <DollarSign className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Your $100,000 Demo Account is Ready</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Practice trading with a fully simulated account. No real money at risk!
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Explore All Features</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Test out CSP, CC, PMCC, and spread strategies with real market data in demo mode.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <List className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Pre-loaded Watchlist</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your demo account comes with a starter watchlist. Go to CSP Dashboard to see opportunities!
                </p>
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg border border-border">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Your 14-day free trial</span> gives you full access to all dashboards and features. Upgrade anytime to connect your Tastytrade account for live trading.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2">
          <Button onClick={onClose} className="w-full">
            Start Exploring
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Auto-closing in {countdown} seconds
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
