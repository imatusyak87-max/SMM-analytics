import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));

describe('OverviewPage', () => {
  it('renders a card per account with followers and ER', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: [
        { account: { id: 'acc-1', platform: 'telegram', name: 'Chan', avatarUrl: null, type: 'own' },
          latestSnapshot: { followersCount: 1234, avgEr: 3.2 } },
      ],
    });

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Chan')).toBeInTheDocument());
    expect(screen.getByText('1234')).toBeInTheDocument();
  });
});
