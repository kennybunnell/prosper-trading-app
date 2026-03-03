import {
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface WtrDataPoint {
  scanDate: string;
  weeksToRecover: number | null;
  recommendation: string;
}

interface WtrSparklineProps {
  history: WtrDataPoint[];
  currentWtr: number | null;
}

function wtrLineColor(wtr: number | null): string {
  if (wtr === null) return '#10b981'; // emerald — no deficit
  if (wtr <= 16) return '#f59e0b';   // amber — harvest zone
  if (wtr <= 36) return '#fb923c';   // orange — mid-monitor
  return '#ef4444';                   // red — approaching dog threshold
}

// Format scan date as "Jan 3" etc.
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(5, 10);
  }
}

// Custom tooltip for the sparkline
function SparkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const wtr = payload[0]?.value as number | null;
  return (
    <div className="rounded-md border border-white/10 bg-black/90 px-2.5 py-1.5 text-xs shadow-xl">
      <div className="text-muted-foreground">{label}</div>
      <div className={`font-semibold ${wtr !== null && wtr > 52 ? 'text-red-400' : wtr !== null && wtr > 16 ? 'text-orange-400' : 'text-amber-400'}`}>
        {wtr !== null ? `${wtr.toFixed(1)} wks` : '—'}
      </div>
    </div>
  );
}

export function WtrSparkline({ history, currentWtr }: WtrSparklineProps) {
  // Filter to entries with valid WTR and take last 8 scans (oldest → newest)
  const validHistory = history
    .filter(h => h.weeksToRecover !== null)
    .slice(-8)
    .map(h => ({
      date: fmtDate(h.scanDate),
      wtr: h.weeksToRecover as number,
    }));

  if (validHistory.length < 2) {
    // Not enough data yet — show a placeholder
    return (
      <div className="flex items-center justify-center h-16 rounded-md bg-black/20 border border-white/5 text-xs text-muted-foreground">
        Trend data available after 2+ scans
      </div>
    );
  }

  // Determine y-axis domain — always show 0 and at least 60 so the 52-week line is visible
  const maxWtr = Math.max(...validHistory.map(d => d.wtr), 60);
  const yMax = Math.ceil(maxWtr * 1.15 / 10) * 10;

  // Line color based on current WTR
  const lineColor = wtrLineColor(currentWtr);

  // Determine if trending toward dog threshold
  const first = validHistory[0].wtr;
  const last = validHistory[validHistory.length - 1].wtr;
  const trendingWorse = last > first;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
        <span className="font-medium text-sky-400">WTR Trend ({validHistory.length} scans)</span>
        {validHistory.length >= 2 && (
          <span className={trendingWorse ? 'text-red-400' : 'text-emerald-400'}>
            {trendingWorse ? '↑ Worsening' : '↓ Recovering'}
          </span>
        )}
      </div>
      <div className="rounded-md bg-black/30 border border-sky-900/30 p-1.5">
        <ResponsiveContainer width="100%" height={72}>
          <LineChart data={validHistory} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 9, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              width={28}
              tickFormatter={(v) => `${v}w`}
            />
            {/* 52-week dog threshold line */}
            <ReferenceLine
              y={52}
              stroke="#ef4444"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{ value: '52w', position: 'right', fontSize: 8, fill: '#ef4444' }}
            />
            {/* 16-week harvest boundary */}
            <ReferenceLine
              y={16}
              stroke="#f59e0b"
              strokeDasharray="2 2"
              strokeWidth={1}
              label={{ value: '16w', position: 'right', fontSize: 8, fill: '#f59e0b' }}
            />
            <Tooltip content={<SparkTooltip />} />
            <Line
              type="monotone"
              dataKey="wtr"
              stroke={lineColor}
              strokeWidth={2}
              dot={{ r: 2.5, fill: lineColor, strokeWidth: 0 }}
              activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground px-0.5">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px bg-amber-400"></span>16w harvest
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px bg-red-500"></span>52w dog threshold
        </span>
      </div>
    </div>
  );
}
