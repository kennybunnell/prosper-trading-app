import { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Send, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Streamdown } from 'streamdown';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SellCallCandidate {
  symbol: string;
  account: string;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  mid: number;
  totalPremium: number;
  weeklyReturn: number;
  currentPrice: number;
  quantity: number;
  aiScore?: number;
  aiRationale?: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AISellCallAdvisorPanelProps {
  candidate: SellCallCandidate;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AISellCallAdvisorPanel({ candidate, onClose }: AISellCallAdvisorPanelProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const advisorMutation = trpc.automation.aiSellCallAdvisor.useMutation();
  const followUpMutation = trpc.automation.aiSellCallAdvisorFollowUp.useMutation();

  // Auto-generate analysis on mount
  useEffect(() => {
    generateAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.symbol, candidate.strike, candidate.expiration]);

  // Scroll to bottom when conversation updates
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, analysis]);

  const generateAnalysis = async () => {
    setIsLoadingAnalysis(true);
    setAnalysis(null);
    setConversation([]);
    try {
      const result = await advisorMutation.mutateAsync({
        symbol: candidate.symbol,
        account: candidate.account,
        strike: candidate.strike,
        expiration: candidate.expiration,
        dte: candidate.dte,
        delta: candidate.delta,
        mid: candidate.mid,
        totalPremium: candidate.totalPremium,
        weeklyReturn: candidate.weeklyReturn,
        currentPrice: candidate.currentPrice,
        quantity: candidate.quantity,
        aiScore: candidate.aiScore,
        aiRationale: candidate.aiRationale,
      });
      setAnalysis(String(result.analysis));
    } catch {
      setAnalysis('Unable to generate analysis. Please try again.');
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  const handleFollowUp = async () => {
    const msg = followUpInput.trim();
    if (!msg || !analysis) return;
    setFollowUpInput('');
    const newHistory: ConversationMessage[] = [...conversation, { role: 'user', content: msg }];
    setConversation(newHistory);
    setIsLoadingFollowUp(true);
    try {
      const result = await followUpMutation.mutateAsync({
        symbol: candidate.symbol,
        initialAnalysis: analysis,
        conversationHistory: conversation,
        userMessage: msg,
      });
      setConversation([...newHistory, { role: 'assistant', content: String(result.reply) }]);
    } catch {
      setConversation([...newHistory, { role: 'assistant', content: 'Unable to generate response. Please try again.' }]);
    } finally {
      setIsLoadingFollowUp(false);
    }
  };

  const otmPct = ((candidate.strike - candidate.currentPrice) / candidate.currentPrice * 100).toFixed(1);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 h-full w-[520px] max-w-full bg-card border-l border-border shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{candidate.symbol}</span>
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-purple-400 border-purple-500/40 bg-purple-500/10">
                  CC
                </Badge>
                {candidate.aiScore !== undefined && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs px-1.5 py-0',
                      candidate.aiScore >= 85 ? 'text-green-400 border-green-500/40 bg-green-500/10' :
                      candidate.aiScore >= 65 ? 'text-blue-400 border-blue-500/40 bg-blue-500/10' :
                      candidate.aiScore >= 45 ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' :
                      'text-red-400 border-red-500/40 bg-red-500/10'
                    )}
                  >
                    Score {candidate.aiScore}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                ${candidate.strike} strike · {candidate.expiration} · {candidate.dte}d · {otmPct}% OTM · {candidate.weeklyReturn.toFixed(2)}%/wk
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={generateAnalysis}
              disabled={isLoadingAnalysis}
              title="Regenerate analysis"
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingAnalysis && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Quick stats strip */}
        <div className="px-4 py-2 border-b border-border/50 bg-muted/20 shrink-0 flex gap-4 text-xs">
          <span className="text-muted-foreground">Stock: <span className="text-foreground font-mono">${candidate.currentPrice.toFixed(2)}</span></span>
          <span className="text-muted-foreground">Mid: <span className="text-green-400 font-mono">${candidate.mid.toFixed(2)}</span></span>
          <span className="text-muted-foreground">Total: <span className="text-green-400 font-mono">${candidate.totalPremium.toFixed(0)}</span></span>
          <span className="text-muted-foreground">Δ: <span className="text-foreground font-mono">{candidate.delta.toFixed(2)}</span></span>
          <span className="text-muted-foreground">Qty: <span className="text-foreground font-mono">{candidate.quantity}</span></span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Initial analysis */}
          {isLoadingAnalysis ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="h-10 w-10 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-violet-400 animate-pulse" />
              </div>
              <p className="text-sm text-muted-foreground">Analyzing {candidate.symbol} covered call…</p>
            </div>
          ) : analysis ? (
            <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed">
              <Streamdown>{String(analysis)}</Streamdown>
            </div>
          ) : null}

          {/* Conversation history */}
          {conversation.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg p-3 text-sm',
                msg.role === 'user'
                  ? 'bg-violet-500/10 border border-violet-500/20 ml-6'
                  : 'bg-muted/40 border border-border/50 mr-6'
              )}
            >
              {msg.role === 'user' ? (
                <p className="text-violet-200">{msg.content}</p>
              ) : (
                <div className="prose prose-sm prose-invert max-w-none leading-relaxed">
                  <Streamdown>{String(msg.content)}</Streamdown>
                </div>
              )}
            </div>
          ))}

          {/* Loading follow-up */}
          {isLoadingFollowUp && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mr-6 bg-muted/40 border border-border/50 rounded-lg p-3">
              <Sparkles className="h-3 w-3 text-violet-400 animate-pulse shrink-0" />
              Thinking…
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Follow-up input */}
        {analysis && !isLoadingAnalysis && (
          <div className="p-4 border-t border-border shrink-0">
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={followUpInput}
                onChange={e => setFollowUpInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowUp();
                  }
                }}
                placeholder="Ask a follow-up question… (e.g. 'Should I go further OTM?')"
                className="min-h-[60px] max-h-[120px] text-sm resize-none bg-muted/30 border-border/50 focus:border-violet-500/50"
                disabled={isLoadingFollowUp}
              />
              <Button
                size="icon"
                className="h-10 w-10 shrink-0 bg-violet-600 hover:bg-violet-700 text-white self-end"
                onClick={handleFollowUp}
                disabled={!followUpInput.trim() || isLoadingFollowUp}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Press Enter to send · Shift+Enter for new line</p>
          </div>
        )}
      </div>
    </>
  );
}
