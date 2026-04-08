import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Calendar, DollarSign, Sparkles, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface RollCandidate {
  action: 'close' | 'roll';
  strike?: number;
  expiration?: string;
  dte?: number;
  netCredit?: number;
  newPremium?: number;
  annualizedReturn?: number;
  meets3XRule?: boolean;
  delta?: number;
  score: number;
  description: string;
}

interface RollCandidateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: {
    symbol: string;
    strategy: string;
    strikePrice: number;
    expiration: string;
    dte: number;
    profitCaptured?: number;
    itmDepth?: number;
    delta?: number;
    currentValue?: number;
    openPremium?: number;
  };
  candidates: RollCandidate[];
  isLoading?: boolean;
  onSelectCandidate: (candidate: RollCandidate) => void;
}

export function RollCandidateModal({
  open,
  onOpenChange,
  position,
  candidates,
  isLoading = false,
  onSelectCandidate,
}: RollCandidateModalProps) {
  const closeCandidate = candidates.find(c => c.action === 'close');
  const rollCandidates = candidates.filter(c => c.action === 'roll');
  
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  
  // Reset recommendation when modal opens with new position
  useEffect(() => {
    if (open) {
      setShowRecommendation(false);
      setRecommendation(null);
    }
  }, [open, position.symbol, position.strikePrice]);
  
  const getRecommendationMutation = trpc.rollRecommendations.getRecommendation.useMutation({
    onSuccess: (data) => {
      setRecommendation(data.recommendation);
      setShowRecommendation(true);
    },
    onError: (error) => {
      console.error('Failed to get recommendation:', error);
      setRecommendation(`Error: ${error.message}`);
      setShowRecommendation(true);
    },
  });
  
  const handleGetRecommendation = () => {
    // Check for null/undefined (allow 0 as valid value for itmDepth)
    if (position.profitCaptured == null || position.itmDepth == null || position.delta == null || position.currentValue == null || position.openPremium == null) {
      setRecommendation('Error: Missing position data required for recommendation');
      setShowRecommendation(true);
      return;
    }
    
    getRecommendationMutation.mutate({
      position: {
        symbol: position.symbol,
        strategy: position.strategy as 'CSP' | 'CC',
        strikePrice: position.strikePrice,
        expiration: position.expiration,
        dte: position.dte,
        profitCaptured: position.profitCaptured,
        itmDepth: position.itmDepth,
        delta: position.delta,
        currentValue: position.currentValue,
        openPremium: position.openPremium,
      },
      candidates: candidates.map(c => ({
        action: c.action,
        strike: c.strike,
        expiration: c.expiration,
        dte: c.dte,
        netCredit: c.netCredit,
        newPremium: c.newPremium,
        annualizedReturn: c.annualizedReturn,
        meets3XRule: c.meets3XRule,
        delta: c.delta,
        score: c.score,
        description: c.description,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roll Options for {position.symbol}</DialogTitle>
          <DialogDescription>
            Current position: ${position.strikePrice.toFixed(2)} {position.strategy} expires {new Date(position.expiration).toLocaleDateString()} ({position.dte} DTE)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* AI Recommendation Section */}
          <div className="border-2 border-primary/20 rounded-lg p-4 bg-primary/5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-lg">AI Recommendation</h3>
              </div>
              <Button 
                onClick={handleGetRecommendation}
                disabled={getRecommendationMutation.isPending}
                size="sm"
                variant="default"
              >
                {getRecommendationMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Get Recommendation
                  </>
                )}
              </Button>
            </div>
            
            {showRecommendation && recommendation && (
              <Alert className="mt-3">
                <AlertDescription className="whitespace-pre-wrap text-sm leading-relaxed">
                  {recommendation}
                </AlertDescription>
              </Alert>
            )}
            
            {!showRecommendation && (
              <p className="text-sm text-muted-foreground">
                Click "Get Recommendation" to receive AI-powered analysis and actionable advice for this position.
              </p>
            )}
          </div>
          {/* Loading State */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-lg font-medium">Analyzing roll options...</p>
                <p className="text-sm text-muted-foreground mt-1">Fetching option chains and calculating candidates</p>
              </div>
            </div>
          )}

          {/* Close Option */}
          {!isLoading && closeCandidate && (
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">Close Without Rolling</h3>
                <Badge variant="outline">Neutral</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-4">{closeCandidate.description}</p>
              <Button 
                onClick={() => onSelectCandidate(closeCandidate)}
                variant="outline"
                className="w-full"
              >
                Close Position
              </Button>
            </div>
          )}

          {/* Roll Candidates */}
          {!isLoading && rollCandidates.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Roll Candidates (Top {rollCandidates.length})</h3>
              
              <div className="grid gap-4">
                {rollCandidates.map((candidate, index) => (
                  <div 
                    key={index}
                    className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium">{candidate.description}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge 
                            variant={candidate.score >= 75 ? 'default' : candidate.score >= 50 ? 'secondary' : 'outline'}
                          >
                            Score: {candidate.score}
                          </Badge>
                          {candidate.meets3XRule && (
                            <Badge variant="default" className="bg-green-600">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              3X Rule
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button 
                        onClick={() => onSelectCandidate(candidate)}
                        size="sm"
                      >
                        Select
                      </Button>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">Roll Cost</div>
                          <div className={`text-sm font-medium ${(candidate.netCredit || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ${Math.abs(candidate.netCredit || 0).toFixed(2)} {(candidate.netCredit || 0) > 0 ? 'Credit' : 'Debit'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">Net Result</div>
                          <div className="text-sm font-medium text-green-600">
                            ${((position.openPremium || 0) - (position.currentValue || 0) + (candidate.netCredit || 0)).toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">Annual Return</div>
                          <div className="text-sm font-medium">
                            {(candidate.annualizedReturn || 0).toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">DTE</div>
                          <div className="text-sm font-medium">{candidate.dte} days</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <TrendingDown className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">Delta</div>
                          <div className="text-sm font-medium">
                            {Math.abs(candidate.delta || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Additional Details */}
                    <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
                      <div>
                        <div className="text-xs text-muted-foreground">New Strike</div>
                        <div className="text-sm font-medium">${candidate.strike?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">New Premium</div>
                        <div className="text-sm font-medium">${candidate.newPremium?.toFixed(2)}<span className="text-xs text-muted-foreground font-normal ml-1">/share</span></div>
                        {candidate.newPremium != null && (
                          <div className="text-xs text-emerald-400/70 font-mono">${(candidate.newPremium * 100).toFixed(2)}/contract</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && rollCandidates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <XCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No suitable roll candidates found in the 7-14 DTE range.</p>
              <p className="text-sm mt-1">Consider closing the position or adjusting criteria.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
