import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Send, RefreshCw, AlertTriangle, CheckCircle, PauseCircle, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Streamdown } from 'streamdown';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StrategyType = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC' | 'all';

export interface ReviewPosition {
  symbol: string;
  type: string;
  optionSymbol: string;
  price: number;
  account: string;
  expiration: string;
  dte: number;
  premiumCollected: number;
  buyBackCost: number;
  netProfit: number;
  realizedPct: number;
  action: string;
  spreadLongSymbol?: string;
  spreadShortStrike?: number;
  spreadLongStrike?: number;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIStrategyReviewPanelProps {
  strategy: StrategyType;
  positions: ReviewPosition[];
  onClose: () => void;
}

// ─── Strategy label helpers ────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<StrategyType, string> = {
  BPS: 'Bull Put Spreads',
  BCS: 'Bear Call Spreads',
  IC: 'Iron Condors',
  CSP: 'Cash-Secured Puts',
  CC: 'Covered Calls',
  all: 'All Strategies',
};

const STRATEGY_COLORS: Record<StrategyType, string> = {
  BPS: 'text-green-400 border-green-500/40 bg-green-500/10',
  BCS: 'text-red-400 border-red-500/40 bg-red-500/10',
  IC: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
  CSP: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  CC: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  all: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AIStrategyReviewPanel({ strategy, positions, onClose }: AIStrategyReviewPanelProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reviewMutation = trpc.automation.aiStrategyReview.useMutation();
  const followUpMutation = trpc.automation.aiStrategyFollowUp.useMutation();

  // Build compact position context string for follow-up calls
  const positionContext = positions
    .map(p => `${p.symbol} ${p.type} exp:${p.expiration} DTE:${p.dte} realized:${p.realizedPct.toFixed(1)}% action:${p.action}`)
    .join('\n');

  // Auto-trigger analysis on mount
  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll chat to bottom when conversation updates
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isLoadingFollowUp]);

  async function runAnalysis() {
    setIsLoadingAnalysis(true);
    setAnalysis(null);
    setConversation([]);
    try {
      const result = await reviewMutation.mutateAsync({ strategy, positions });
      const analysisText = typeof result.analysis === 'string' ? result.analysis : String(result.analysis);
      setAnalysis(analysisText);
    } catch (err) {
      setAnalysis('⚠️ Failed to generate analysis. Please try again.');
    } finally {
      setIsLoadingAnalysis(false);
    }
  }

  async function sendFollowUp() {
    const message = followUpInput.trim();
    if (!message || !analysis) return;

    setFollowUpInput('');
    const newUserMsg: ConversationMessage = { role: 'user', content: message };
    setConversation(prev => [...prev, newUserMsg]);
    setIsLoadingFollowUp(true);

    try {
      const result = await followUpMutation.mutateAsync({
        strategy,
        initialAnalysis: analysis,
        conversationHistory: conversation.map(m => ({ role: m.role, content: m.content })),
        userMessage: message,
        positionContext,
      });
      const replyText = typeof result.reply === 'string' ? result.reply : String(result.reply);
      setConversation(prev => [...prev, { role: 'assistant' as const, content: replyText }]);
    } catch {
      setConversation(prev => [...prev, { role: 'assistant', content: '⚠️ Failed to get a response. Please try again.' }]);
    } finally {
      setIsLoadingFollowUp(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFollowUp();
    }
  }

  const strategyColor = STRATEGY_COLORS[strategy];
  const strategyLabel = STRATEGY_LABELS[strategy];
  const readyCount = positions.filter(p => p.action === 'WOULD_CLOSE').length;
  const holdCount = positions.length - readyCount;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-2xl bg-[#0f1117] border-l border-white/10 shadow-2xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-500/15 border border-orange-500/30">
            <Sparkles className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">AI Strategy Review</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full border', strategyColor)}>
                {strategyLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {positions.length} positions · {readyCount} ready · {holdCount} hold
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={runAnalysis}
            disabled={isLoadingAnalysis}
            className="h-8 px-2 text-muted-foreground hover:text-white"
            title="Re-run analysis"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoadingAnalysis && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 px-2 text-muted-foreground hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <CheckCircle className="w-3.5 h-3.5 text-green-400" />
          <span className="text-muted-foreground">Ready to Close:</span>
          <span className="text-green-400 font-semibold">{readyCount}</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-1.5 text-xs">
          <PauseCircle className="w-3.5 h-3.5 text-yellow-400" />
          <span className="text-muted-foreground">Hold:</span>
          <span className="text-yellow-400 font-semibold">{holdCount}</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-1.5 text-xs">
          <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-muted-foreground">Avg Realized:</span>
          <span className="text-sky-400 font-semibold">
            {positions.length > 0
              ? (positions.reduce((s, p) => s + p.realizedPct, 0) / positions.length).toFixed(1) + '%'
              : '—'}
          </span>
        </div>
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Initial analysis */}
        {isLoadingAnalysis ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-orange-500/30 border-t-orange-500 animate-spin" />
              <Sparkles className="absolute inset-0 m-auto w-5 h-5 text-orange-400" />
            </div>
            <div className="text-center">
              <p className="text-sm text-white font-medium">Analyzing {positions.length} positions...</p>
              <p className="text-xs text-muted-foreground mt-1">Reviewing risk, profit targets, and market conditions</p>
            </div>
          </div>
        ) : analysis ? (
          <div className="prose prose-invert prose-sm max-w-none
            prose-headings:text-white prose-headings:font-semibold prose-headings:text-sm prose-headings:mt-5 prose-headings:mb-2
            prose-p:text-white/80 prose-p:leading-relaxed prose-p:text-sm
            prose-li:text-white/80 prose-li:text-sm
            prose-strong:text-white
            prose-code:text-orange-300 prose-code:bg-orange-500/10 prose-code:px-1 prose-code:rounded
            [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:pb-2 [&_h2]:border-b [&_h2]:border-white/10">
            <Streamdown>{analysis}</Streamdown>
          </div>
        ) : null}

        {/* Follow-up conversation */}
        {conversation.length > 0 && (
          <div className="space-y-4 pt-2 border-t border-white/10">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Follow-up Chat</p>
            {conversation.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'flex gap-3',
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                )}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center mt-0.5">
                    <Sparkles className="w-3 h-3 text-orange-400" />
                  </div>
                )}
                <div
                  className={cn(
                    'rounded-xl px-3.5 py-2.5 text-sm max-w-[85%]',
                    msg.role === 'user'
                      ? 'bg-orange-500/15 border border-orange-500/20 text-white ml-auto'
                      : 'bg-white/5 border border-white/10 text-white/85'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-invert prose-sm max-w-none
                      prose-p:text-white/85 prose-p:text-sm prose-p:my-1
                      prose-li:text-white/85 prose-li:text-sm
                      prose-strong:text-white
                      prose-headings:text-white prose-headings:text-sm">
                      <Streamdown>{msg.content}</Streamdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {isLoadingFollowUp && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center mt-0.5">
                  <Sparkles className="w-3 h-3 text-orange-400 animate-pulse" />
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
        )}
      </div>

      {/* ── Follow-up input ── */}
      {analysis && !isLoadingAnalysis && (
        <div className="shrink-0 px-4 py-3 border-t border-white/10 bg-[#0f1117]">
          <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus-within:border-orange-500/40 transition-colors">
            <Textarea
              ref={textareaRef}
              value={followUpInput}
              onChange={e => setFollowUpInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a follow-up question about these positions..."
              className="flex-1 min-h-[36px] max-h-[120px] resize-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-white placeholder:text-white/30 p-0"
              rows={1}
              disabled={isLoadingFollowUp}
            />
            <Button
              size="sm"
              onClick={sendFollowUp}
              disabled={!followUpInput.trim() || isLoadingFollowUp}
              className="h-8 w-8 p-0 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}

export default AIStrategyReviewPanel;
