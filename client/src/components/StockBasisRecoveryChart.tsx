import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface UnderwaterPosition {
  symbol: string;
  quantity: number;
  costBasis: number;
  currentPrice: number;
  totalCost: number;
  marketValue: number;
  unrealizedLoss: number;
  ccPremium: number;
  recoveryPct: number;
  adjustedBasis: number;
  remainingLoss: number;
}

interface RecoveryProgressChartProps {
  data: UnderwaterPosition[];
}

export function RecoveryProgressChart({ data }: RecoveryProgressChartProps) {
  const chartData = useMemo(() => {
    return data
      .map((pos) => ({
        symbol: pos.symbol,
        recovered: pos.ccPremium,
        remaining: Math.abs(pos.remainingLoss),
        total: Math.abs(pos.unrealizedLoss),
        recoveryPct: pos.recoveryPct,
      }))
      .sort((a, b) => b.remaining - a.remaining); // Sort by most underwater at top
  }, [data]);

  const chartHeight = Math.max(400, chartData.length * 50);

  return (
    <div style={{ width: '100%', height: chartHeight }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 20, right: 80, left: 80, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            type="number"
            stroke="#888"
            tick={{ fill: '#888' }}
            tickFormatter={(value) => `$${value.toLocaleString()}`}
          />
          <YAxis
            type="category"
            dataKey="symbol"
            stroke="#888"
            tick={{ fill: '#888' }}
            width={80}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '8px',
            }}
            formatter={(value: number) => `$${value.toLocaleString()}`}
          />
          <Legend />
          <Bar
            dataKey="recovered"
            stackId="a"
            fill="#28a745"
            name="Premium Recovered"
            label={{
              position: 'inside',
              fill: 'white',
              fontSize: 10,
              formatter: (value: number) => value > 500 ? `$${value.toLocaleString()}` : '',
            }}
          />
          <Bar
            dataKey="remaining"
            stackId="a"
            fill="#dc3545"
            name="Remaining Underwater"
            label={{
              position: 'inside',
              fill: 'white',
              fontSize: 10,
              formatter: (value: number) => value > 500 ? `$${value.toLocaleString()}` : '',
            }}
          />
          {/* Recovery percentage annotations */}
          {chartData.map((entry, index) => (
            <text
              key={`pct-${index}`}
              x="95%"
              y={20 + index * (chartHeight / chartData.length)}
              textAnchor="start"
              fill="#888"
              fontSize={11}
            >
              {entry.recoveryPct.toFixed(0)}%
            </text>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
