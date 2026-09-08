import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ComparePage } from './ComparePage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));

describe('ComparePage', () => {
  it('lets the user pick two accounts and shows a comparison table', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/stats/overview')) {
        return Promise.resolve({
          data: [
            { account: { id: 'acc-1', name: 'Chan A', platform: 'telegram' }, latestSnapshot: { followersCount: 100, avgEr: 2 } },
            { account: { id: 'acc-2', name: 'Chan B', platform: 'telegram' }, latestSnapshot: { followersCount: 200, avgEr: 3 } },
          ],
        });
      }
      return Promise.resolve({
        data: [
          { account: { id: 'acc-1', name: 'Chan A' }, trend: [{ date: '2026-08-13', followersCount: 100 }] },
          { account: { id: 'acc-2', name: 'Chan B' }, trend: [{ date: '2026-08-13', followersCount: 200 }] },
        ],
      });
    });

    render(<MemoryRouter><ComparePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByLabelText('Chan A')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Chan A'));
    fireEvent.click(screen.getByLabelText('Chan B'));

    await waitFor(() => expect(screen.getAllByText('Chan A').length).toBeGreaterThan(0));
    // Scoped to the comparison table: TrendChart (untouched, from Task 21) renders
    // its own Y-axis tick labels from this same follower-count data, and those
    // ticks can coincidentally render the same digits (e.g. "100") elsewhere in
    // the page. Scoping disambiguates that unrelated collision without touching
    // TrendChart or reformatting the table's numbers away from their literal values.
    const table = screen.getByRole('table');
    expect(within(table).getByText('100')).toBeInTheDocument();
    expect(within(table).getByText('200')).toBeInTheDocument();
  });

  it('surfaces a failure of the comparison request instead of showing an empty chart', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/stats/overview')) {
        return Promise.resolve({
          data: [
            { account: { id: 'acc-1', name: 'Chan A', platform: 'telegram' }, latestSnapshot: null },
          ],
        });
      }
      return Promise.reject({ response: { status: 500 } });
    });

    render(<MemoryRouter><ComparePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByLabelText('Chan A')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Chan A'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('keeps the newest comparison when an earlier request resolves after it', async () => {
    let resolveSlowFirst: (value: unknown) => void = () => {};
    let call = 0;
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/stats/overview')) {
        return Promise.resolve({
          data: [
            { account: { id: 'acc-1', name: 'Chan A', platform: 'telegram' }, latestSnapshot: null },
            { account: { id: 'acc-2', name: 'Chan B', platform: 'telegram' }, latestSnapshot: null },
          ],
        });
      }
      call += 1;
      if (call === 1) {
        // The stale request for {acc-1} only lands after the newer {acc-1, acc-2} one.
        return new Promise((resolve) => {
          resolveSlowFirst = resolve;
        });
      }
      return Promise.resolve({
        data: [
          { account: { id: 'acc-1', name: 'Chan A' }, trend: [{ date: '2026-08-13', followersCount: 100 }] },
          { account: { id: 'acc-2', name: 'Chan B' }, trend: [{ date: '2026-08-13', followersCount: 200 }] },
        ],
      });
    });

    render(<MemoryRouter><ComparePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Chan A')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Chan A'));
    fireEvent.click(screen.getByLabelText('Chan B'));
    const legendText = () => document.querySelector('.recharts-legend-wrapper')?.textContent ?? '';
    await waitFor(() => expect(legendText()).toContain('Chan B'));

    await act(async () => {
      resolveSlowFirst({
        data: [{ account: { id: 'acc-1', name: 'Chan A' }, trend: [{ date: '2026-08-13', followersCount: 100 }] }],
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(legendText()).toContain('Chan A');
    expect(legendText()).toContain('Chan B');
  });
});
