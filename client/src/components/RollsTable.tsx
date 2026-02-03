import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface RollPosition {
  positionId: string;
  symbol: string;
  strategy: string;
  score: number;
  metrics: {
    strikePrice: number;
    currentPrice: number;
    dte: number;
    profitCaptured: number;
  };
  reasons: string[];
}

interface RollsTableProps {
  rollsRed: RollPosition[];
  rollsYellow: RollPosition[];
  rollsGreen: RollPosition[];
  onViewOptions: (roll: RollPosition) => void;
}

export function RollsTable({ rollsRed, rollsYellow, rollsGreen, onViewOptions }: RollsTableProps) {
  const [strategyFilter, setStrategyFilter] = useState<'CC' | 'CSP'>('CC');

  // Combine all rolls and filter by strategy
  const filteredRolls = [...rollsRed, ...rollsYellow, ...rollsGreen]
    .filter(roll => roll.strategy.toUpperCase() === strategyFilter);

  return (
    <div className="space-y-4">
      {/* Strategy Filter Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setStrategyFilter('CC')}
          className={`px-4 py-2 font-medium transition-colors ${
            strategyFilter === 'CC'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Covered Calls
        </button>
        <button
          onClick={() => setStrategyFilter('CSP')}
          className={`px-4 py-2 font-medium transition-colors ${
            strategyFilter === 'CSP'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Cash-Secured Puts
        </button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Strike</TableHead>
              <TableHead>Current Price</TableHead>
              <TableHead>DTE</TableHead>
              <TableHead>Alert/Warning</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Profit %</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRolls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No {strategyFilter} positions need rolling at this time
                </TableCell>
              </TableRow>
            ) : (
              filteredRolls.map((roll) => {
                // Determine row color based on urgency
                const isRed = rollsRed.some(r => r.positionId === roll.positionId);
                const isYellow = rollsYellow.some(r => r.positionId === roll.positionId);
                const isGreen = rollsGreen.some(r => r.positionId === roll.positionId);
                
                const rowClass = isRed
                  ? 'bg-red-950/20 border-red-500/30 hover:bg-red-950/30'
                  : isYellow
                  ? 'bg-yellow-950/20 border-yellow-500/30 hover:bg-yellow-950/30'
                  : 'bg-green-950/20 border-green-500/30 hover:bg-green-950/30';
                
                const textClass = isRed
                  ? 'text-red-600'
                  : isYellow
                  ? 'text-yellow-600'
                  : 'text-green-600';

                return (
                  <TableRow key={roll.positionId} className={rowClass}>
                    <TableCell className="font-semibold">{roll.symbol}</TableCell>
                    <TableCell>{roll.strategy.toUpperCase()}</TableCell>
                    <TableCell>${roll.metrics.strikePrice}</TableCell>
                    <TableCell>${roll.metrics.currentPrice.toFixed(2)}</TableCell>
                    <TableCell>{roll.metrics.dte}</TableCell>
                    <TableCell>
                      <div className={`text-xs ${textClass} space-y-0.5`}>
                        {roll.reasons.map((reason: string, idx: number) => (
                          <div key={idx}>{reason}</div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{Math.ceil(roll.score)}</TableCell>
                    <TableCell className={`text-right font-medium ${textClass}`}>
                      {roll.metrics.profitCaptured.toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => onViewOptions(roll)}>
                        View Options
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
