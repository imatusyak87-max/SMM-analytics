import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// jsdom doesn't implement ResizeObserver, which recharts' ResponsiveContainer
// relies on to measure its container and decide whether to render children.
// Stub it globally so any chart under test actually renders.
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
