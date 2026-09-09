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

  // Regression: recharts defaults a numeric Y axis to [0, niceMax]. With a real
  // account (10k followers, +116 over a month) the whole series then occupied under
  // one pixel of a 300px chart, so every trend looked like a flat line — and the
  // larger the account, the flatter it got.
  function pathYSpan(container: HTMLElement): number {
    const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? '';
    const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    return Math.max(...ys) - Math.min(...ys);
  }

  function series(count: number, start: number, growth: number) {
    return [
      {
        label: 'Chan',
        data: Array.from({ length: count }, (_, i) => ({
          date: `2026-08-${String(i + 1).padStart(2, '0')}`,
          value: start + i * growth,
        })),
      },
    ];
  }

  it('scales modest growth on a large account to fill the chart instead of flattening it', () => {
    const { container } = render(<TrendChart series={series(30, 10000, 4)} />);

    expect(pathYSpan(container)).toBeGreaterThan(150);
  });

  it('scales a small account the same way, so account size does not change the shape', () => {
    const big = render(<TrendChart series={series(30, 10000, 4)} />).container;
    const small = render(<TrendChart series={series(30, 100, 1)} />).container;

    expect(Math.abs(pathYSpan(big) - pathYSpan(small))).toBeLessThan(20);
  });

  it('still renders a flat series without collapsing the axis', () => {
    const { container } = render(<TrendChart series={series(10, 5000, 0)} />);

    expect(container.querySelector('.recharts-line-curve')).toBeInTheDocument();
    expect(pathYSpan(container)).toBeLessThan(5);
  });
});
