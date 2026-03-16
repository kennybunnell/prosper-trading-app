import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

interface PaperTradingOnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

const STEPS = [
  {
    id: 1,
    icon: "💰",
    title: "Your $100K Paper Account",
    subtitle: "Start with a fully funded simulation account",
    content: (
      <div className="space-y-4">
        <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-emerald-500/10 border border-blue-500/20 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Paper Balance</span>
            <span className="text-2xl font-bold text-emerald-400">$100,000</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Buying Power (4× leverage)</span>
            <span className="text-lg font-semibold text-blue-400">$400,000</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Mock Positions</span>
            <span className="text-sm font-medium text-purple-400">AAPL · MSFT · GOOGL · NVDA</span>
          </div>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>All trades are <strong className="text-foreground">simulated</strong> — no real money is ever at risk</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Mock MAG7 stock positions give you shares to write <strong className="text-foreground">Covered Calls</strong> against</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Reset your account to $100K anytime from the <strong className="text-foreground">Portfolio → Paper Orders</strong> tab</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Market data is <strong className="text-foreground">real-time</strong> via Tradier — only the order execution is simulated</span>
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 2,
    icon: "🔍",
    title: "Running Your First Scan",
    subtitle: "Find options opportunities with one click",
    content: (
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0 mt-0.5">1</div>
            <div>
              <p className="text-sm font-medium">Choose a Strategy</p>
              <p className="text-xs text-muted-foreground mt-0.5">Navigate to <strong className="text-foreground">CSP Dashboard</strong> (Cash-Secured Puts) or <strong className="text-foreground">CC Dashboard</strong> (Covered Calls) from the sidebar</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0 mt-0.5">2</div>
            <div>
              <p className="text-sm font-medium">Add Tickers to Your Watchlist</p>
              <p className="text-xs text-muted-foreground mt-0.5">Type symbols like <code className="bg-muted px-1 rounded text-xs">AAPL, TSLA, NVDA</code> in the watchlist input and press Enter</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0 mt-0.5">3</div>
            <div>
              <p className="text-sm font-medium">Click "Fetch Opportunities"</p>
              <p className="text-xs text-muted-foreground mt-0.5">The scanner pulls live option chains from Tradier and scores each opportunity using delta, DTE, IV rank, RSI, and Bollinger Bands</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0 mt-0.5">4</div>
            <div>
              <p className="text-sm font-medium">Filter by Score and Select</p>
              <p className="text-xs text-muted-foreground mt-0.5">Use the <Badge variant="outline" className="text-xs py-0">Conservative</Badge> / <Badge variant="outline" className="text-xs py-0">Medium</Badge> / <Badge variant="outline" className="text-xs py-0">Aggressive</Badge> presets or set a minimum score threshold</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          💡 The Stock Screener (Portfolio tab) helps you discover new candidates to add to your watchlist
        </p>
      </div>
    ),
  },
  {
    id: 3,
    icon: "📝",
    title: "Simulating a Trade",
    subtitle: "Practice the full order workflow risk-free",
    content: (
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0 mt-0.5">1</div>
            <div>
              <p className="text-sm font-medium">Select Opportunities</p>
              <p className="text-xs text-muted-foreground mt-0.5">Check the boxes next to the opportunities you want to trade, then click <strong className="text-foreground">"Preview Orders"</strong></p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0 mt-0.5">2</div>
            <div>
              <p className="text-sm font-medium">Review & Adjust Prices</p>
              <p className="text-xs text-muted-foreground mt-0.5">The order preview modal shows bid/ask spreads and lets you fine-tune your limit price using the slider or +/- buttons</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0 mt-0.5">3</div>
            <div>
              <p className="text-sm font-medium text-emerald-300">Click "Simulate Trade"</p>
              <p className="text-xs text-muted-foreground mt-0.5">In paper mode, the live "Submit" button is replaced with a blue <strong className="text-emerald-300">"Simulate Trade"</strong> button — your order is recorded instantly with no real execution</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0 mt-0.5">4</div>
            <div>
              <p className="text-sm font-medium">Track in Paper Orders</p>
              <p className="text-xs text-muted-foreground mt-0.5">All simulated trades appear in <strong className="text-foreground">Portfolio → Paper Orders</strong> with full P&amp;L tracking and close functionality</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-center">
          <p className="text-sm text-blue-300 font-medium">You're ready to start paper trading! 🎉</p>
          <p className="text-xs text-muted-foreground mt-1">Switch to Live Trading anytime from the mode toggle in the sidebar</p>
        </div>
      </div>
    ),
  },
];

export function PaperTradingOnboardingModal({
  open,
  onOpenChange,
  onComplete,
}: PaperTradingOnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const markSeenMutation = trpc.paperTrading.markOnboardingSeen.useMutation();

  const step = STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirst) setCurrentStep(prev => prev - 1);
  };

  const handleFinish = async () => {
    try {
      await markSeenMutation.mutateAsync();
    } catch {
      // Non-critical — don't block the user
    }
    onOpenChange(false);
    onComplete?.();
  };

  const handleSkip = async () => {
    try {
      await markSeenMutation.mutateAsync();
    } catch {
      // Non-critical
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleSkip(); else onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{step.icon}</span>
              <div>
                <DialogTitle className="text-lg leading-tight">{step.title}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">{step.subtitle}</p>
              </div>
            </div>
            {/* Step indicator */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentStep
                      ? "bg-blue-400 w-4"
                      : i < currentStep
                      ? "bg-blue-400/50"
                      : "bg-muted-foreground/30"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        {/* Step content */}
        <div className="py-2 max-h-[60vh] overflow-y-auto">
          {step.content}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="outline" size="sm" onClick={handleBack}>
                ← Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleNext}
              className={isLast ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}
              disabled={markSeenMutation.isPending}
            >
              {isLast ? "Let's Go! 🚀" : "Next →"}
            </Button>
          </div>
        </div>

        {/* Step counter */}
        <p className="text-center text-xs text-muted-foreground -mt-1">
          Step {currentStep + 1} of {STEPS.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}
