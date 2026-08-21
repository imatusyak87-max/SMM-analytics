import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrendChart } from './TrendChart';

// The ResizeObserver stub recharts' ResponsiveContainer needs in jsdom is
// registered globally in setupTests.ts, so every test file gets it for free.

describe('TrendChart', () => {
  it('renders one legend entry per series', () => {
    render(
      <TrendChart
        series={[
          { label: 'Chan A', data: [{ date: '2026-08-01', value: 100 }, { date: '2026-08-13', value: 150 }] },
          { label: 'Chan B', data: [{ date: '2026-08-01', value: 200 }, { date: '2026-08-13', value: 210 }] },
        ]}
      />,
    );

    expect(screen.getByText('Chan A')).toBeInTheDocument();
    expect(screen.getByText('Chan B')).toBeInTheDocument();
  });
});
