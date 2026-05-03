import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMobile';

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const fmt = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  return (
    <div className="rounded-lg border border-border/40 bg-card/95 backdrop-blur-sm p-3 shadow-xl text-xs space-y-1 max-w-[180px]">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name === 'netPremium' ? 'Monthly' : 'Cumulative'}:</span>
          <span className="font-medium text-foreground ml-auto">{fmt(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

interface MonthlyData {
  month: string;
  netPremium: number;
  cumulative: number;
}

interface MonthlyPremiumChartProps {
  data: MonthlyData[];
}

export function MonthlyPremiumChart({ data }: MonthlyPremiumChartProps) {
  const isMobile = useIsMobile();

  const formatMonth = (month: string | any) => {
    const monthStr = typeof month === 'string' ? month : String(month);
    const [year, monthNum] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    if (isMobile) return date.toLocaleDateString('en-US', { month: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const formatCurrency = (value: number) => {
    if (isMobile && Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}k`;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const chartData = data.map(item => ({
    month: formatMonth(item.month),
    netPremium: item.netPremium,
    cumulative: item.cumulative,
    isProfit: item.netPremium >= 0,
  }));

  const chartHeight = isMobile ? 260 : 420;
  const chartMargin = isMobile ? { top: 10, right: 8, left: 0, bottom: 30 } : { top: 20, right: 30, left: 20, bottom: 60 };
  const yAxisWidth = isMobile ? 44 : 80;
  const tickFontSize = isMobile ? 10 : 12;

  return (
    <Card className="p-3 sm:p-6 bg-card/70 backdrop-blur-sm border-border/30">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart data={chartData} margin={chartMargin}>
          {/* Dashed grid lines */}
          <CartesianGrid 
            strokeDasharray="5 5" 
            stroke="rgba(148, 163, 184, 0.15)" 
            vertical={false}
          />
          
          <XAxis dataKey="month" stroke="#94A3B8" tick={{ fill: '#94A3B8', fontSize: tickFontSize }} axisLine={{ stroke: '#94A3B8' }} interval={isMobile ? 'preserveStartEnd' : 0} />
          <YAxis stroke="#94A3B8" tick={{ fill: '#94A3B8', fontSize: tickFontSize }} axisLine={{ stroke: '#94A3B8' }} tickFormatter={formatCurrency} width={yAxisWidth} />
          <Tooltip content={<CustomTooltip />} />
          {!isMobile && (
            <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" formatter={(value) => { if (value === 'netPremium') return 'Monthly Premium'; if (value === 'cumulative') return 'Cumulative Total'; return value; }} />
          )}
          
          <Bar dataKey="netPremium" radius={[4, 4, 0, 0]}>
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
          
          <Line type="monotone" dataKey="cumulative" stroke="#22D3EE" strokeWidth={isMobile ? 2 : 3} dot={{ fill: '#06B6D4', stroke: '#F1F5F9', strokeWidth: 2, r: isMobile ? 3 : 6 }} activeDot={{ r: isMobile ? 5 : 8, fill: '#06B6D4', stroke: '#F1F5F9', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Custom legend */}
      <div className="flex items-center justify-center gap-4 sm:gap-6 mt-3 text-xs sm:text-sm">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          <span className="text-muted-foreground">Profit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-muted-foreground">Loss</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-cyan-400 rounded-full" />
          <span className="text-muted-foreground">Total</span>
        </div>
      </div>
    </Card>
  );
}
