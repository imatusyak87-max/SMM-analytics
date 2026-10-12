import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileSwitcher } from './ProfileSwitcher';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));

const get = apiClient.get as any;
const patch = apiClient.patch as any;

const summary = (id: string, name: string, platforms: string[]) => ({
  id, name, totalFollowers: 1,
  accounts: platforms.map((platform, i) => ({
    account: { id: `${id}-${i}`, platform, name, avatarUrl: null, type: 'own' },
    latestSnapshot: null,
  })),
});

const current = { id: 'p1', name: 'Coffee Lab', accountCount: 2 };

describe('ProfileSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: [summary('p1', 'Coffee Lab', ['telegram', 'instagram']), summary('p2', 'Tea House', ['telegram'])] });
  });

  it('shows the current profile and offers the others plus a separate one', async () => {
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={vi.fn()} />);

    const select = screen.getByLabelText('Профиль:');
    expect(select).toHaveValue('p1');
    expect(await screen.findByRole('option', { name: 'Tea House (telegram)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Отдельный профиль' })).toBeInTheDocument();
  });

  it('has no separate-profile option for an account that is already alone', async () => {
    render(<ProfileSwitcher accountId="acc-1" profile={{ ...current, accountCount: 1 }} onMoved={vi.fn()} />);

    await screen.findByRole('option', { name: 'Tea House (telegram)' });
    expect(screen.queryByRole('option', { name: 'Отдельный профиль' })).not.toBeInTheDocument();
  });

  it('moves the account to the chosen profile', async () => {
    patch.mockResolvedValue({ data: { profileId: 'p2' } });
    const onMoved = vi.fn();
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={onMoved} />);
    await screen.findByRole('option', { name: 'Tea House (telegram)' });

    fireEvent.change(screen.getByLabelText('Профиль:'), { target: { value: 'p2' } });

    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/accounts/acc-1/profile', { profileId: 'p2' });
  });

  it('splits the account into a profile of its own', async () => {
    patch.mockResolvedValue({ data: { profileId: 'p-new' } });
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Профиль:'), { target: { value: '__new__' } });

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/accounts/acc-1/profile', { newProfile: true }));
  });

  it('says the profile is gone and refreshes the list', async () => {
    patch.mockRejectedValue({ response: { status: 404 } });
    const onMoved = vi.fn();
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={onMoved} />);
    await screen.findByRole('option', { name: 'Tea House (telegram)' });

    fireEvent.change(screen.getByLabelText('Профиль:'), { target: { value: 'p2' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Профиль не найден');
    await waitFor(() => expect(get.mock.calls.filter(([url]: [string]) => url === '/profiles')).toHaveLength(2));
    expect(onMoved).not.toHaveBeenCalled();
  });
});
