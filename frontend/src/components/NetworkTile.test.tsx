import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkTile } from './NetworkTile';
import { NETWORKS } from './LinkField';

const [instagram, telegram, vk] = NETWORKS;
const item = { account: { id: 'acc-tg', platform: 'telegram', name: 'Coffee TG', avatarUrl: null, type: 'public_no_access' }, latestSnapshot: { followersCount: 1500, avgEr: 1 } } as any;

beforeEach(() => vi.clearAllMocks());

describe('NetworkTile', () => {
  it('shows a filled network and opens its page', () => {
    render(<MemoryRouter><NetworkTile network={telegram} item={item} onAdd={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Coffee TG/ })).toHaveAttribute('href', '/accounts/acc-tg');
    expect(screen.getByText(/1\s?500/)).toBeInTheDocument();
  });

  it('offers to add a missing network', () => {
    const onAdd = vi.fn();
    render(<MemoryRouter><NetworkTile network={instagram} onAdd={onAdd} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить Instagram' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('marks networks that are not available yet', () => {
    render(<MemoryRouter><NetworkTile network={vk} onAdd={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('ВКонтакте — скоро')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a filled tile only links to the account page', () => {
    render(<MemoryRouter><NetworkTile network={NETWORKS[1]} item={item} onAdd={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/accounts/acc-tg');
    expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();
  });
});
