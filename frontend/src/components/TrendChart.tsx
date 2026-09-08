import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import styles from './TrendChart.module.css';

interface Series {
  label: string;
  data: Array<{ date: string; value: number }>;
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

  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={merged}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'var(--chart-muted)' }} stroke="var(--chart-axis)" />
          <YAxis tick={{ fill: 'var(--chart-muted)' }} stroke="var(--chart-axis)" />
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
