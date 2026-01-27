import { useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface StockPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPL: number;
  accountNumber: string;
  accountNickname: string;
}

interface StockPositionsTableProps {
  positions: StockPosition[];
  premiums: Record<string, number>;
}

export function StockPositionsTable({ positions, premiums }: StockPositionsTableProps) {
  const tableData = useMemo(() => {
    return positions
      .map((pos) => {
        const ccPremium = premiums[pos.symbol] || 0;
        const totalReturn = pos.unrealizedPL + ccPremium;
        const totalReturnPct = pos.costBasis > 0 ? (totalReturn / pos.costBasis) * 100 : 0;
        const unrealizedPct = pos.costBasis > 0 ? (pos.unrealizedPL / pos.costBasis) * 100 : 0;

        return {
          ...pos,
          ccPremium,
          totalReturn,
          totalReturnPct,
          unrealizedPct,
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue); // Sort by market value descending
  }, [positions, premiums]);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Shares</TableHead>
            <TableHead className="text-right">Cost/Share</TableHead>
            <TableHead className="text-right">Current</TableHead>
            <TableHead className="text-right">Market Value</TableHead>
            <TableHead className="text-right">Unrealized P/L</TableHead>
            <TableHead className="text-right">Premium</TableHead>
            <TableHead className="text-right">Return %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                No stock positions found
              </TableCell>
            </TableRow>
          ) : (
            tableData.map((row) => (
              <TableRow key={`${row.symbol}-${row.accountNumber}`}>
                <TableCell className="font-medium">{row.symbol}</TableCell>
                <TableCell className="text-right">{row.quantity}</TableCell>
                <TableCell className="text-right">${row.avgCost.toFixed(2)}</TableCell>
                <TableCell className="text-right">${row.currentPrice.toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  ${row.marketValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className={`text-right ${row.unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {row.unrealizedPL >= 0 ? '+' : '-'}$
                  {Math.abs(row.unrealizedPL).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  <div className="text-xs">
                    ({row.unrealizedPct >= 0 ? '+' : ''}{row.unrealizedPct.toFixed(1)}%)
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  ${row.ccPremium.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className={`text-right font-semibold ${row.totalReturnPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {row.totalReturnPct >= 0 ? '+' : ''}{row.totalReturnPct.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
