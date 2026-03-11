import React, { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Sparkles, TrendingUp, DollarSign, Zap,
  BarChart3, RefreshCw, ExternalLink, AlertTriangle,
  CheckCircle2, Target, Activity
} from "lucide-react";
import { Link } from "wouter";

interface GapAdvisorModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fetched gap/target from the tracker card for display */
  gap: number;
  target: number;
  collected: number;
}

// ─── Simple markdown-ish renderer for the LLM response ───────────────────────
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-2 text-sm text-foreground leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h3 key={i} className="text-base font-bold text-foreground mt-4 mb-1 first:mt-0">
              {line.replace('## ', '')}
            </h3>
          );
        }
        if (line.startsWith('### ')) {
          return (
            <h4 key={i} className="text-sm font-semibold text-foreground mt-3 mb-0.5">
              {line.replace('### ', '')}
            </h4>
          );
        }
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <p key={i} className="font-semibold text-foreground">
              {line.replace(/\*\*/g, '')}
            </p>
          );
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
          const content = line.replace(/^[-•]\s/, '');
          // Bold inline **text**
          const parts = content.split(/(\*\*[^*]+\*\*)/g);
          return (
            <div key={i} className="flex gap-2">
              <span className="text-emerald-400 mt-0.5 shrink-0">▸</span>
              <span>
                {parts.map((p, j) =>
                  p.startsWith('**') && p.endsWith('**')
                    ? <strong key={j} className="text-foreground font-semibold">{p.replace(/\*\*/g, '')}</strong>
                    : <span key={j}>{p}</span>
                )}
              </span>
            </div>
          );
        }
        if (line.trim() === '' || line.trim() === '---') {
          return <div key={i} className="h-1" />;
        }
        // Inline bold
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="text-muted-foreground">
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={j} className="text-foreground font-semibold">{p.replace(/\*\*/g, '')}</strong>
                : <span key={j}>{p}</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

// ─── Context Summary Cards ────────────────────────────────────────────────────
function ContextCard({
  icon: Icon, label, value, sub, color = "text-muted-foreground"
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-card/50 p-3 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-muted/20 shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-bold truncate ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export function GapAdvisorModal({ open, onClose, gap, target, collected }: GapAdvisorModalProps) {
  const [advice, setAdvice] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const adviceRef = useRef<HTMLDivElement>(null);

  // Fetch context on-demand when modal opens
  const { data: ctx, isLoading: ctxLoading, refetch: refetchCtx, error: ctxError } =
    trpc.dashboard.getGapAdvisorContext.useQuery(undefined, {
      enabled: open,
      retry: false,
      refetchOnWindowFocus: false,
    });

  const generateAdvice = trpc.dashboard.generateGapAdvice.useMutation();

  // Auto-generate advice once context is loaded
  useEffect(() => {
    if (ctx && !ctxLoading && !advice && !isGenerating) {
      handleGenerate();
    }
  }, [ctx, ctxLoading]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setAdvice('');
      setIsGenerating(false);
      setContextReady(false);
      setLoadingStep('');
    }
  }, [open]);

  // Auto-scroll advice as it streams in
  useEffect(() => {
    if (adviceRef.current) {
      adviceRef.current.scrollTop = adviceRef.current.scrollHeight;
    }
  }, [advice]);

  const handleGenerate = async () => {
    if (!ctx || isGenerating) return;
    setAdvice('');
    setIsGenerating(true);
    setLoadingStep('Analyzing your portfolio context…');
    try {
      const result = await generateAdvice.mutateAsync({ contextJson: JSON.stringify(ctx) });
      setAdvice(String(result.advice ?? ''));
    } catch (e: any) {
      setAdvice(`Unable to generate advice: ${e?.message || 'Unknown error'}. Please try again.`);
    } finally {
      setIsGenerating(false);
      setLoadingStep('');
    }
  };

  const pct = target > 0 ? Math.min(100, (collected / target) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col bg-background border-border/50 p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/30 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-1.5 rounded-lg bg-emerald-500/15">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            Gap Advisor
            <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/30 ml-1">
              AI
            </Badge>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Personalized recommendations to close your monthly income gap safely
          </p>
        </DialogHeader>

        {/* Context snapshot */}
        <div className="px-6 py-4 border-b border-border/20 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ContextCard
              icon={Target}
              label="Monthly Target"
              value={`$${target.toLocaleString()}`}
              color="text-emerald-400"
            />
            <ContextCard
              icon={DollarSign}
              label="Collected"
              value={`$${collected.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              sub={`${pct.toFixed(1)}% of target`}
              color={pct >= 75 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-orange-400"}
            />
            <ContextCard
              icon={AlertTriangle}
              label="Gap Remaining"
              value={`$${gap.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              color={gap === 0 ? "text-emerald-400" : "text-red-400"}
            />
            <ContextCard
              icon={Activity}
              label="Buying Power (80%)"
              value={ctx ? `$${Math.round(ctx.bp80pct ?? 0).toLocaleString()}` : ctxLoading ? '…' : '—'}
              sub={ctx ? `of $${Math.round(ctx.totalBuyingPower ?? 0).toLocaleString()} total` : undefined}
              color="text-cyan-400"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0" ref={adviceRef}>
          {/* Loading context */}
          {ctxLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <p className="text-sm text-muted-foreground">Gathering your portfolio data…</p>
              <p className="text-xs text-muted-foreground opacity-60">Fetching buying power, positions, and market data</p>
            </div>
          )}

          {/* Context error */}
          {ctxError && !ctxLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-foreground font-medium">Could not load portfolio data</p>
              <p className="text-xs text-muted-foreground text-center max-w-sm">
                {ctxError.message || 'Make sure your Tastytrade credentials are configured in Settings.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => refetchCtx()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          )}

          {/* Generating advice */}
          {isGenerating && !advice && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="relative">
                <Sparkles className="w-8 h-8 text-emerald-400 animate-pulse" />
              </div>
              <p className="text-sm text-muted-foreground">{loadingStep || 'Generating recommendations…'}</p>
              <p className="text-xs text-muted-foreground opacity-60">Analyzing strategies, velocity, and risk profile</p>
            </div>
          )}

          {/* Advice content */}
          {advice && (
            <div className="space-y-4">
              {/* Quick-link row */}
              {ctx && ((ctx.ccCandidates?.length ?? 0) > 0 || (ctx.spreads?.contractsAvailable ?? 0) > 0) && (
                <div className="flex flex-wrap gap-2 pb-3 border-b border-border/20">
                  {(ctx.ccCandidates?.length ?? 0) > 0 && (
                    <Link href="/portfolio?tab=analyzer">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={onClose}>
                        <TrendingUp className="w-3 h-3" />
                        {ctx.ccCandidates?.length ?? 0} CC Candidate{(ctx.ccCandidates?.length ?? 0) !== 1 ? 's' : ''} →
                      </Button>
                    </Link>
                  )}
                  {(ctx.spreads?.contractsAvailable ?? 0) > 0 && (
                    <Link href="/spreads">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10" onClick={onClose}>
                        <BarChart3 className="w-3 h-3" />
                        Open Spread Advisor →
                      </Button>
                    </Link>
                  )}
                  <Link href="/csp">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10" onClick={onClose}>
                      <Zap className="w-3 h-3" />
                      CSP Scanner →
                    </Button>
                  </Link>
                </div>
              )}

              {/* AI advice */}
              <MarkdownBlock text={advice} />

              {/* Disclaimer */}
              <div className="mt-4 pt-3 border-t border-border/20">
                <p className="text-xs text-muted-foreground italic">
                  These are AI-generated suggestions based on your portfolio data. All recommendations are for informational purposes only — review carefully before placing any orders.
                </p>
              </div>
            </div>
          )}

          {/* Gap already met */}
          {ctx && !ctxLoading && !isGenerating && gap === 0 && !advice && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <p className="text-base font-semibold text-foreground">Target reached!</p>
              <p className="text-sm text-muted-foreground">You've hit your monthly income goal. 🎯</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/20 shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {ctx?.ccCandidates?.length
              ? `${ctx.ccCandidates.length} idle CC position${ctx.ccCandidates.length !== 1 ? 's' : ''} detected`
              : 'Analysis based on live portfolio data'}
          </p>
          <div className="flex gap-2">
            {advice && !isGenerating && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleGenerate}>
                <RefreshCw className="w-3 h-3 mr-1.5" /> Regenerate
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
