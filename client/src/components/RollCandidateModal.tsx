import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Calendar, DollarSign } from 'lucide-react';

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
  };
  candidates: RollCandidate[];
  onSelectCandidate: (candidate: RollCandidate) => void;
}

export function RollCandidateModal({
  open,
  onOpenChange,
  position,
  candidates,
  onSelectCandidate,
}: RollCandidateModalProps) {
  const closeCandidate = candidates.find(c => c.action === 'close');
  const rollCandidates = candidates.filter(c => c.action === 'roll');

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
          {/* Close Option */}
          {closeCandidate && (
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
          {rollCandidates.length > 0 && (
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
                          <div className="text-xs text-muted-foreground">Net</div>
                          <div className={`text-sm font-medium ${(candidate.netCredit || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ${Math.abs(candidate.netCredit || 0).toFixed(2)} {(candidate.netCredit || 0) > 0 ? 'Credit' : 'Debit'}
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
                        <div className="text-sm font-medium">${candidate.newPremium?.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rollCandidates.length === 0 && (
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
