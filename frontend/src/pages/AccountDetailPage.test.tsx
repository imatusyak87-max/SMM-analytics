import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { AccountDetailPage } from './AccountDetailPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

/** Matches a formatted number regardless of which kind of space separates the thousands. */
const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('AccountDetailPage', () => {
  it('shows account summary and post list filtered by type', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/detail')) {
        return Promise.resolve({
          data: {
            account: { id: 'acc-1', name: 'Chan' },
            latestSnapshot: { followersCount: 1000, avgEr: 4.1 },
            trend: [],
            posts: [
              { id: 'p1', type: 'post', caption: 'Hello', likes: 5, comments: 1, shares: 0, publishedAt: '2026-08-01' },
              { id: 'p2', type: 'video', caption: 'Video post', likes: 20, comments: 3, shares: 1, publishedAt: '2026-08-02' },
            ],
            summary: {
              followersCount: 1000, postsCount: 2,
              totalViews: 500, totalReactions: 25,
              avgViews: 250, avgReactions: 12.5,
              erViews: 5, erFollowers: 1.25,
            },
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    renderAt('/accounts/acc-1');

    await waitFor(() => expect(screen.getByText('Chan')).toBeInTheDocument());
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Video post')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Тип поста'), { target: { value: 'video' } });

    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    expect(screen.getByText('Video post')).toBeInTheDocument();
  });

  it('shows an error instead of hanging on the spinner when the account cannot be loaded', async () => {
    (apiClient.get as any).mockRejectedValue({ response: { status: 500 } });

    renderAt('/accounts/acc-1');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument();
  });

  it('says the account was not found when the server returns a 404', async () => {
    (apiClient.get as any).mockRejectedValue({ response: { status: 404 } });

    renderAt('/accounts/gone');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Аккаунт не найден'));
  });

  it('shows totals and averages in Russian', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        account: { id: 'acc-1', name: 'Chan' },
        latestSnapshot: { followersCount: 1000 },
        trend: [],
        posts: [],
        summary: {
          followersCount: 1000, postsCount: 2,
          totalViews: 4000, totalReactions: 200,
          avgViews: 2000, avgReactions: 100,
          erViews: 5, erFollowers: 10,
        },
      },
    });

    const { container } = renderAt('/accounts/acc-1');

    // Scoped to the stat tiles' <dl>: PostSortSelect also has a "Просмотры" option.
    await waitFor(() => expect(container.querySelector('dl')).toBeInTheDocument());
    const tiles = within(container.querySelector('dl')!);
    expect(tiles.getByText('Просмотры')).toBeInTheDocument();
    expect(tiles.getByText('Средние просмотры')).toBeInTheDocument();
    expect(tiles.getByText(digits('4000'))).toBeInTheDocument();
  });

  it('refetches with a narrower range when the period changes', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        account: { id: 'acc-1', name: 'Chan' }, latestSnapshot: null, trend: [], posts: [],
        summary: { followersCount: 0, postsCount: 0, totalViews: 0, totalReactions: 0, avgViews: 0, avgReactions: 0, erViews: null, erFollowers: null },
      },
    });

    renderAt('/accounts/acc-1');
    fireEvent.click(await screen.findByRole('button', { name: '7 дней' }));

    await waitFor(() => {
      const lastCall = (apiClient.get as any).mock.calls.at(-1);
      const { from, to } = lastCall[1].params;
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      expect(days).toBeCloseTo(7, 0);
    });
  });
});
