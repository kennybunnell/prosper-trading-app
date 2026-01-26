import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { CheckCircle2, XCircle } from 'lucide-react';

interface MonthlyData {
  month: string;
  netPremium: number;
  cumulative: number;
}

interface MonthlyPremiumChartProps {
  data: MonthlyData[];
}

export function MonthlyPremiumChart({ data }: MonthlyPremiumChartProps) {
  // Format month for display (e.g., "2025-09" -> "Sep 2025")
  const formatMonth = (month: string) => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // Format currency for display
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Transform data for chart
  const chartData = data.map(item => ({
    month: formatMonth(item.month),
    netPremium: item.netPremium,
    cumulative: item.cumulative,
    isProfit: item.netPremium >= 0,
  }));

  return (
    <Card className="p-6 bg-card/70 backdrop-blur-sm border-border/30">
      <h2 className="text-2xl font-bold text-foreground mb-6">
        Monthly Premium Earnings - All Accounts Combined
      </h2>
      
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          {/* Dashed grid lines */}
          <CartesianGrid 
            strokeDasharray="5 5" 
            stroke="rgba(148, 163, 184, 0.15)" 
            vertical={false}
          />
          
          {/* X-axis */}
          <XAxis 
            dataKey="month" 
            stroke="#94A3B8"
            tick={{ fill: '#94A3B8', fontSize: 12 }}
            axisLine={{ stroke: '#94A3B8' }}
          />
          
          {/* Y-axis */}
          <YAxis 
            stroke="#94A3B8"
            tick={{ fill: '#94A3B8', fontSize: 12 }}
            axisLine={{ stroke: '#94A3B8' }}
            tickFormatter={formatCurrency}
          />
          
          {/* Tooltip */}
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(30, 41, 59, 0.95)',
              border: '1px rgba(148, 163, 184, 0.2)',
              borderRadius: '8px',
              color: '#F1F5F9',
            }}
            formatter={(value: number, name: string) => {
              if (name === 'netPremium') return [formatCurrency(value), 'Monthly Premium'];
              if (name === 'cumulative') return [formatCurrency(value), 'Cumulative Total'];
              return [value, name];
            }}
          />
          
          {/* Legend */}
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="circle"
            formatter={(value) => {
              if (value === 'netPremium') return 'Monthly Premium';
              if (value === 'cumulative') return 'Cumulative Total';
              return value;
            }}
          />
          
          {/* Semi-transparent bars with glowing edges */}
          <Bar 
            dataKey="netPremium" 
            radius={[4, 4, 0, 0]}
            label={{
              position: 'top',
              fill: '#F1F5F9',
              fontSize: 13,
              fontWeight: 600,
              formatter: formatCurrency,
            }}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isProfit ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}
                stroke={entry.isProfit ? '#16A34A' : '#DC2626'}
                strokeWidth={2}
                filter={entry.isProfit ? 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))' : 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.6))'}
              />
            ))}
          </Bar>
          
          {/* Cumulative line with markers */}
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke="#22D3EE"
            strokeWidth={3}
            dot={{
              fill: '#06B6D4',
              stroke: '#F1F5F9',
              strokeWidth: 2,
              r: 6,
            }}
            activeDot={{
              r: 8,
              fill: '#06B6D4',
              stroke: '#F1F5F9',
              strokeWidth: 2,
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      
      {/* Legend with icons */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <span className="text-muted-foreground">Profit</span>
        </div>
        <div className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-500" />
          <span className="text-muted-foreground">Loss</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-1 bg-cyan-400 rounded-full" />
          <span className="text-muted-foreground">Total</span>
        </div>
      </div>
    </Card>
  );
}
