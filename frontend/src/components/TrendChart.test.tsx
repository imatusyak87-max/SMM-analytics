import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrendChart } from './TrendChart';

// jsdom doesn't implement ResizeObserver, which recharts' ResponsiveContainer
// relies on to measure its container and decide whether to render children.
// Stub it so the chart actually renders in this test environment.
class ResizeObserverStub {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

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
