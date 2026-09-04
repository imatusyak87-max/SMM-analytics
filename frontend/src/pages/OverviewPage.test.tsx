import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

describe('OverviewPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the add-account form and reloads accounts after one is created', async () => {
    (apiClient.get as any).mockResolvedValue({ data: [] });
    (apiClient.post as any).mockResolvedValue({ data: { id: 'acc-1' } });

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Добавить аккаунт'));
    fireEvent.change(screen.getByLabelText('Ссылка на аккаунт'), {
      target: { value: 'https://t.me/fedulovadigital' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Ссылка на аккаунт')).not.toBeInTheDocument();
  });

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
