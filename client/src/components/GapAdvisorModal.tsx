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
  BarChart3, RefreshCw, AlertTriangle,
  CheckCircle2, Target, Activity, Send, User, Bot
} from "lucide-react";
import { Link } from "wouter";

interface GapAdvisorModalProps {
  open: boolean;
  onClose: () => void;
  gap: number;
  target: number;
  collected: number;
}

// ─── Message types ────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
  isLoading?: boolean;
}

// ─── Simple markdown renderer ─────────────────────────────────────────────────
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h3 key={i} className="text-sm font-bold text-amber-300 mt-3 mb-0.5 first:mt-0">
              {line.replace('## ', '')}
            </h3>
          );
        }
        if (line.startsWith('### ')) {
          return (
            <h4 key={i} className="text-sm font-semibold text-foreground mt-2 mb-0.5">
              {line.replace('### ', '')}
            </h4>
          );
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
          const content = line.replace(/^[-•]\s/, '');
          const parts = content.split(/(\*\*[^*]+\*\*)/g);
          return (
            <div key={i} className="flex gap-2">
              <span className="text-amber-400 mt-0.5 shrink-0 text-xs">▸</span>
              <span className="text-foreground/90">
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
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="text-foreground/80">
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
    <div className="rounded-xl border border-amber-700/20 bg-card/50 p-3 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
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

// ─── Chat bubble ──────────────────────────────────────────────────────────────
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
        isUser ? 'bg-amber-600/30 border border-amber-500/40' : 'bg-emerald-600/20 border border-emerald-500/30'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-amber-400" />
          : <Bot className="w-3.5 h-3.5 text-emerald-400" />
        }
      </div>
      {/* Bubble */}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-amber-600/15 border border-amber-500/25 rounded-tr-sm'
          : 'bg-card/60 border border-border/30 rounded-tl-sm'
      }`}>
        {msg.isLoading ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span className="text-xs text-muted-foreground">Thinking…</span>
          </div>
        ) : (
          <MarkdownBlock text={msg.content} />
        )}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export function GapAdvisorModal({ open, onClose, gap, target, collected }: GapAdvisorModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [contextJson, setContextJson] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: ctx, isLoading: ctxLoading, refetch: refetchCtx, error: ctxError } =
    trpc.dashboard.getGapAdvisorContext.useQuery(undefined, {
      enabled: open,
      retry: false,
      refetchOnWindowFocus: false,
    });

  const generateAdvice = trpc.dashboard.generateGapAdvice.useMutation();
  const followUpAdvice = trpc.dashboard.followUpGapAdvice.useMutation();

  // Auto-generate initial advice once context loads
  useEffect(() => {
    if (ctx && !ctxLoading && messages.length === 0 && !isGenerating) {
      const json = JSON.stringify(ctx);
      setContextJson(json);
      handleInitialGenerate(json);
    }
  }, [ctx, ctxLoading]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setMessages([]);
      setIsGenerating(false);
      setFollowUpInput('');
      setContextJson('');
    }
  }, [open]);

  // Auto-scroll thread
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const handleInitialGenerate = async (json: string) => {
    setIsGenerating(true);
    // Add loading placeholder
    setMessages([{ role: 'assistant', content: '', isLoading: true }]);
    try {
      const result = await generateAdvice.mutateAsync({ contextJson: json });
      const advice = String(result.advice ?? '');
      setMessages([{ role: 'assistant', content: advice }]);
    } catch (e: any) {
      setMessages([{ role: 'assistant', content: `Unable to generate advice: ${e?.message || 'Unknown error'}. Please try again.` }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (!contextJson || isGenerating) return;
    setMessages([]);
    handleInitialGenerate(contextJson);
  };

  const handleFollowUp = async () => {
    const question = followUpInput.trim();
    if (!question || isSendingFollowUp || !contextJson) return;

    setFollowUpInput('');
    // Build history for context (exclude loading placeholders)
    const history = messages
      .filter(m => !m.isLoading && m.content)
      .map(m => ({ role: m.role, content: m.content }));

    // Add user message + loading placeholder
    setMessages(prev => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '', isLoading: true },
    ]);
    setIsSendingFollowUp(true);

    try {
      const result = await followUpAdvice.mutateAsync({
        contextJson,
        history,
        question,
      });
      const answer = String(result.answer ?? '');
      setMessages(prev => {
        const updated = [...prev];
        // Replace the loading placeholder with the real answer
        const loadingIdx = updated.findLastIndex(m => m.isLoading);
        if (loadingIdx !== -1) updated[loadingIdx] = { role: 'assistant', content: answer };
        return updated;
      });
    } catch (e: any) {
      setMessages(prev => {
        const updated = [...prev];
        const loadingIdx = updated.findLastIndex(m => m.isLoading);
        if (loadingIdx !== -1) updated[loadingIdx] = { role: 'assistant', content: `Sorry, I couldn't answer that: ${e?.message || 'Unknown error'}` };
        return updated;
      });
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFollowUp();
    }
  };

  const pct = target > 0 ? Math.min(100, (collected / target) * 100) : 0;
  const hasAdvice = messages.some(m => !m.isLoading && m.content && m.role === 'assistant');
  const isThreadActive = messages.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 bg-background border-2 border-amber-600/60 shadow-[0_0_30px_rgba(180,120,30,0.25)]">

        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-amber-700/30 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30">
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>
            Gap Advisor
            <Badge className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/30 ml-1">
              AI
            </Badge>
            <span className="ml-auto flex items-center gap-2">
              {hasAdvice && !isGenerating && (
                <button
                  onClick={handleRegenerate}
                  title="Regenerate initial analysis"
                  className="text-xs text-muted-foreground hover:text-amber-400 transition-colors flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              )}
            </span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Personalized recommendations to close your monthly income gap safely
          </p>
        </DialogHeader>

        {/* Context snapshot */}
        <div className="px-6 py-3 border-b border-amber-700/20 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ContextCard icon={Target} label="Monthly Target" value={`$${target.toLocaleString()}`} color="text-amber-400" />
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
              label="Total Buying Power"
              value={ctx ? `$${Math.round(ctx.totalBuyingPower ?? 0).toLocaleString()}` : ctxLoading ? '…' : '—'}
              sub={ctx ? `80% ceiling: $${Math.round((ctx.totalBuyingPower ?? 0) * 0.8).toLocaleString()}` : undefined}
              color="text-cyan-400"
            />
          </div>
        </div>

        {/* Chat thread */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 space-y-4" ref={threadRef}>

          {/* Loading context */}
          {ctxLoading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
              <p className="text-sm text-muted-foreground">Gathering your portfolio data…</p>
              <p className="text-xs text-muted-foreground opacity-60">Fetching buying power, positions, and market data</p>
            </div>
          )}

          {/* Context error */}
          {ctxError && !ctxLoading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-foreground font-medium">Could not load portfolio data</p>
              <p className="text-xs text-muted-foreground text-center max-w-sm">
                {ctxError.message || 'Make sure your Tastytrade credentials are configured in Settings.'}
              </p>
              <Button size="sm" variant="outline" className="border-amber-500/30 hover:border-amber-400/50" onClick={() => refetchCtx()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          )}

          {/* Quick-link row (shown once advice is available) */}
          {hasAdvice && ctx && (
            <div className="flex flex-wrap gap-2 pb-2 border-b border-amber-700/20">
              {(ctx.ccCandidates?.length ?? 0) > 0 && (
                <Link href="/portfolio?tab=analyzer">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={onClose}>
                    <TrendingUp className="w-3 h-3" />
                    {ctx.ccCandidates?.length ?? 0} CC Candidate{(ctx.ccCandidates?.length ?? 0) !== 1 ? 's' : ''} →
                  </Button>
                </Link>
              )}
              <Link href="/spreads">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10" onClick={onClose}>
                  <BarChart3 className="w-3 h-3" />
                  Spread Advisor →
                </Button>
              </Link>
              <Link href="/csp">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10" onClick={onClose}>
                  <Zap className="w-3 h-3" />
                  CSP Scanner →
                </Button>
              </Link>
            </div>
          )}

          {/* Message thread */}
          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} />
          ))}

          {/* Gap already met (no messages yet) */}
          {ctx && !ctxLoading && !isGenerating && gap === 0 && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <p className="text-base font-semibold text-foreground">Target reached!</p>
              <p className="text-sm text-muted-foreground">You've hit your monthly income goal. 🎯</p>
            </div>
          )}

          {/* Disclaimer (after first advice) */}
          {hasAdvice && (
            <p className="text-xs text-muted-foreground italic pt-1 border-t border-amber-700/15">
              AI-generated suggestions based on your portfolio data — for informational purposes only. Review carefully before placing orders.
            </p>
          )}
        </div>

        {/* Follow-up input */}
        <div className="px-4 pb-4 pt-3 border-t border-amber-700/30 shrink-0">
          <div className="flex items-end gap-2 rounded-xl border border-amber-600/40 bg-card/60 px-3 py-2 focus-within:border-amber-500/70 focus-within:shadow-[0_0_12px_rgba(180,120,30,0.15)] transition-all">
            <textarea
              ref={inputRef}
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasAdvice ? "Ask a follow-up question… (Enter to send, Shift+Enter for new line)" : "Waiting for initial analysis…"}
              disabled={!hasAdvice || isSendingFollowUp}
              rows={1}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none min-h-[24px] max-h-[96px] disabled:opacity-40"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 96) + 'px';
              }}
            />
            <button
              onClick={handleFollowUp}
              disabled={!followUpInput.trim() || isSendingFollowUp || !hasAdvice}
              className="shrink-0 p-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/30 text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Send follow-up (Enter)"
            >
              {isSendingFollowUp
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
          <p className="text-xs text-muted-foreground/40 mt-1.5 text-center">
            {ctx?.ccCandidates?.length
              ? `${ctx.ccCandidates.length} idle CC position${ctx.ccCandidates.length !== 1 ? 's' : ''} detected`
              : 'Analysis based on live portfolio data'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
