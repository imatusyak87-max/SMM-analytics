import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkTile } from './NetworkTile';
import { NETWORKS } from './LinkField';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), delete: vi.fn() } }));
const del = apiClient.delete as any;
const [instagram, telegram, vk] = NETWORKS;
const item = { account: { id: 'acc-tg', platform: 'telegram', name: 'Coffee TG', avatarUrl: null, type: 'public_no_access' }, latestSnapshot: { followersCount: 1500, avgEr: 1 } } as any;

beforeEach(() => vi.clearAllMocks());

describe('NetworkTile', () => {
  it('shows a filled network and opens its page', () => {
    render(<MemoryRouter><NetworkTile network={telegram} item={item} onAdd={vi.fn()} onRemoved={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Coffee TG/ })).toHaveAttribute('href', '/accounts/acc-tg');
    expect(screen.getByText(/1\s?500/)).toBeInTheDocument();
  });

  it('offers to add a missing network', () => {
    const onAdd = vi.fn();
    render(<MemoryRouter><NetworkTile network={instagram} onAdd={onAdd} onRemoved={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить Instagram' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('marks networks that are not available yet', () => {
    render(<MemoryRouter><NetworkTile network={vk} onAdd={vi.fn()} onRemoved={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('ВКонтакте — скоро')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes the account from the project after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    del.mockResolvedValue({});
    const onRemoved = vi.fn();
    render(<MemoryRouter><NetworkTile network={telegram} item={item} onAdd={vi.fn()} onRemoved={onRemoved} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith('/accounts/acc-tg');
  });
});
