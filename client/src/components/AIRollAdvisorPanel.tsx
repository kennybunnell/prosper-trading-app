import { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Send, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Streamdown } from 'streamdown';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RollAdvisorPosition {
  positionId: string;
  symbol: string;
  strategy: 'CSP' | 'CC' | 'BPS' | 'BCS' | 'IC';
  unrealizedPnl?: number;
  pnlStatus?: 'winner' | 'breakeven' | 'loser';
  dte: number;
  profitCaptured: number;
  itmDepth: number;
  strikePrice: number;
  currentPrice: number;
  expiration: string;
  openPremium: number;
  currentValue: number;
  reasons: string[];
  actionLabel?: string;
  spreadDetails?: {
    strategyType: string;
    shortStrike?: number;
    longStrike?: number;
    spreadWidth?: number;
  };
  rollCandidates?: Array<{
    action: 'roll' | 'close';
    strike?: number;
    expiration?: string;
    dte?: number;
    netCredit?: number;
    newPremium?: number;
    delta?: number;
    score: number;
    description: string;
  }>;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIRollAdvisorPanelProps {
  position: RollAdvisorPosition;
  onClose: () => void;
}

// ─── Strategy colors ──────────────────────────────────────────────────────────

const STRATEGY_COLORS: Record<string, string> = {
  CSP: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  CC:  'text-purple-400 border-purple-500/40 bg-purple-500/10',
  BPS: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  BCS: 'text-pink-400 border-pink-500/40 bg-pink-500/10',
  IC:  'text-amber-400 border-amber-500/40 bg-amber-500/10',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AIRollAdvisorPanel({ position, onClose }: AIRollAdvisorPanelProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const advisorMutation = trpc.automation.aiRollAdvisor.useMutation();
  const followUpMutation = trpc.automation.aiRollAdvisorFollowUp.useMutation();

  // Compact position context for follow-up calls
  const positionContext = `${position.symbol} ${position.strategy} strike:$${position.strikePrice} exp:${position.expiration} DTE:${position.dte} P&L:${position.pnlStatus} ITM/OTM:${position.itmDepth.toFixed(1)}% profitCaptured:${position.profitCaptured.toFixed(1)}%`;

  // Auto-generate analysis on mount
  useEffect(() => {
    generateAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.positionId]);

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
        position: {
          positionId: position.positionId,
          symbol: position.symbol,
          strategy: position.strategy,
          unrealizedPnl: position.unrealizedPnl,
          pnlStatus: position.pnlStatus,
          dte: position.dte,
          profitCaptured: position.profitCaptured,
          itmDepth: position.itmDepth,
          strikePrice: position.strikePrice,
          currentPrice: position.currentPrice,
          expiration: position.expiration,
          openPremium: position.openPremium,
          currentValue: position.currentValue,
          reasons: position.reasons,
          actionLabel: position.actionLabel,
          spreadDetails: position.spreadDetails,
          rollCandidates: position.rollCandidates,
        },
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
        positionContext,
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

  const pnlSign = (position.unrealizedPnl ?? 0) >= 0 ? '+' : '';
  const pnlStr = position.unrealizedPnl !== undefined
    ? `${pnlSign}$${position.unrealizedPnl.toFixed(2)}`
    : '—';

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
            <div className="h-8 w-8 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-orange-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{position.symbol}</span>
                <Badge
                  variant="outline"
                  className={cn('text-xs px-1.5 py-0', STRATEGY_COLORS[position.strategy])}
                >
                  {position.strategy}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn('text-xs px-1.5 py-0',
                    position.pnlStatus === 'winner' ? 'text-green-400 border-green-500/40 bg-green-500/10' :
                    position.pnlStatus === 'loser'  ? 'text-red-400 border-red-500/40 bg-red-500/10' :
                    'text-yellow-400 border-yellow-500/40 bg-yellow-500/10'
                  )}
                >
                  {position.pnlStatus ?? 'even'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                $${position.strikePrice.toFixed(0)} · {position.expiration} · {position.dte}d · {pnlStr} ({position.profitCaptured.toFixed(1)}%)
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

        {/* Scan reasons strip */}
        {position.reasons.length > 0 && (
          <div className="px-4 py-2 border-b border-border/50 bg-muted/20 shrink-0">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-orange-400">Scan reason: </span>
              {position.reasons[0]}
            </p>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Initial analysis */}
          {isLoadingAnalysis ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="h-10 w-10 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-orange-400 animate-pulse" />
              </div>
              <p className="text-sm text-muted-foreground">Analyzing {position.symbol} roll position…</p>
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
                  ? 'bg-orange-500/10 border border-orange-500/20 ml-6'
                  : 'bg-muted/40 border border-border/50 mr-6'
              )}
            >
              {msg.role === 'user' ? (
                <p className="text-orange-200">{msg.content}</p>
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
              <Sparkles className="h-3 w-3 text-orange-400 animate-pulse shrink-0" />
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
                placeholder="Ask a follow-up question… (e.g. 'What if I roll to a lower strike?')"
                className="min-h-[60px] max-h-[120px] text-sm resize-none bg-muted/30 border-border/50 focus:border-orange-500/50"
                disabled={isLoadingFollowUp}
              />
              <Button
                size="icon"
                className="h-10 w-10 shrink-0 bg-orange-500 hover:bg-orange-600 text-white self-end"
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
