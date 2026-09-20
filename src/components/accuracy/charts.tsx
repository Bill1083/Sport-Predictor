'use client';

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

import { MODEL_LABELS } from '@/lib/sports/registry';

const SERIES_COLOURS: Record<string, string> = {
  ensemble: 'var(--chart-model)',
  'dixon-coles': 'var(--chart-away)',
  margin: 'var(--chart-away)',
  elo: 'var(--chart-market)',
  ml: 'var(--chart-ai)',
  baseline: 'var(--chart-baseline)',
  ai: 'var(--chart-ai)',
  market: 'var(--chart-market)',
};

export interface TimelinePoint {
  week: string;
  [model: string]: number | string | null;
}

/** Weekly mean log loss per model. Lower is better; the baseline is the line to beat. */
export function TimelineChart({ points, models }: { points: TimelinePoint[]; models: string[] }) {
  if (points.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing scored yet.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            formatter={(value: number, name: string) => [typeof value === 'number' ? value.toFixed(3) : value, MODEL_LABELS[name] ?? name]}
          />
          <Legend formatter={(value: string) => MODEL_LABELS[value] ?? value} wrapperStyle={{ fontSize: 12 }} />
          {models.map((model) => (
            <Line
              key={model}
              type="monotone"
              dataKey={model}
              stroke={SERIES_COLOURS[model] ?? 'hsl(var(--foreground))'}
              strokeWidth={model === 'ensemble' ? 2.5 : 1.5}
              strokeDasharray={model === 'baseline' ? '4 3' : undefined}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CalibrationPoint {
  forecast: number;
  observed: number;
  n: number;
}

/** Reliability diagram: observed frequency against forecast probability; the diagonal is perfect. */
export function CalibrationChart({ bins }: { bins: CalibrationPoint[] }) {
  const data = bins.filter((b) => b.n > 0).map((b) => ({ forecast: Math.round(b.forecast * 100), observed: Math.round(b.observed * 100), n: b.n }));
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Not enough scored predictions.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="forecast" domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} name="Forecast" />
          <YAxis type="number" dataKey="observed" domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} name="Observed" />
          <ZAxis type="number" dataKey="n" range={[40, 400]} name="Count" />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            formatter={(value: number, name: string) => [name === 'Count' ? value : `${value}%`, name]}
          />
          <Scatter data={data} fill="var(--chart-model)" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
