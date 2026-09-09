import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import styles from './TrendChart.module.css';

interface Series {
  label: string;
  data: Array<{ date: string; value: number }>;
}

/**
 * recharts defaults a numeric axis to [0, niceMax]. Follower counts are far from
 * zero and move by a fraction of a percent, so that default squeezed a whole
 * month of growth into under a pixel and every trend looked like a flat line —
 * worse the larger the account. Framing the axis on the data instead makes the
 * shape depend on the growth, not on the account's size.
 */
function verticalDomain(series: Series[]): [number, number] {
  const values = series.flatMap((s) => s.data.map((d) => d.value)).filter((v) => Number.isFinite(v));
  if (values.length === 0) return [0, 1];

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A series that never moved still needs a band around it, or it would be clipped
  // to a zero-height axis.
  const padding = max === min ? Math.max(1, Math.abs(max) * 0.01) : (max - min) * 0.1;

  return [Math.floor(min - padding), Math.ceil(max + padding)];
}

export function TrendChart({ series }: { series: Series[] }) {
  const dates = Array.from(new Set(series.flatMap((s) => s.data.map((d) => d.date)))).sort();
  const merged = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    series.forEach((s) => {
      const point = s.data.find((d) => d.date === date);
      row[s.label] = point ? point.value : NaN;
    });
    return row;
  });

  const domain = verticalDomain(series);

  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={merged}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'var(--chart-muted)' }} stroke="var(--chart-axis)" />
          <YAxis
            domain={domain}
            allowDecimals={false}
            tick={{ fill: 'var(--chart-muted)' }}
            stroke="var(--chart-axis)"
          />
          <Tooltip />
          <Legend />
          {series.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={`var(--series-${(i % 8) + 1})`}
              strokeWidth={2}
              dot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
