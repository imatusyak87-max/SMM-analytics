import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileCard } from './ProfileCard';
import type { ProfileSummary } from '../profiles';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: new Blob() }) } }));

const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

const item = (id: string, platform: string, followers: number) => ({
  account: { id, platform, name: id, avatarUrl: null, type: 'public_no_access' },
  latestSnapshot: { followersCount: followers, avgEr: 2 },
});

function renderCard(profile: ProfileSummary) {
  return render(<MemoryRouter><ProfileCard profile={profile} /></MemoryRouter>);
}

describe('ProfileCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the profile name, an icon per network and total followers', () => {
    renderCard({
      id: 'p1', name: 'Coffee Lab', totalFollowers: 12500,
      accounts: [item('ig', 'instagram', 10000), item('tg', 'telegram', 2500)],
    });

    expect(screen.getByText('Coffee Lab')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'instagram' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'telegram' })).toBeInTheDocument();
    expect(screen.getByText(digits('12500'))).toBeInTheDocument();
    expect(screen.queryByText('ER')).not.toBeInTheDocument();
  });

  it('opens the profile page when it holds several accounts', () => {
    renderCard({ id: 'p1', name: 'Coffee Lab', totalFollowers: 3, accounts: [item('a', 'telegram', 2), item('b', 'instagram', 1)] });

    expect(screen.getByTestId('profile-card')).toHaveAttribute('href', '/profiles/p1');
  });

  it('opens the account directly when it is the only one', () => {
    renderCard({ id: 'p1', name: 'Solo', totalFollowers: 2, accounts: [item('acc-9', 'telegram', 2)] });

    expect(screen.getByTestId('profile-card')).toHaveAttribute('href', '/accounts/acc-9');
  });

  it('shows a dash before any followers are counted', () => {
    renderCard({
      id: 'p1', name: 'New', totalFollowers: null,
      accounts: [{ ...item('a', 'telegram', 0), latestSnapshot: null }],
    });

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
