import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { AccountDetailPage } from './AccountDetailPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

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
});
