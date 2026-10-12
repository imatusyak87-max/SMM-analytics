import { toProfileSummary } from './profile-summary';

const item = (id: string, followers: number | null) =>
  ({
    account: { id },
    latestSnapshot: followers === null ? null : { followersCount: followers },
  }) as any;

describe('toProfileSummary', () => {
  const profile = { id: 'prof-1', name: 'Coffee Lab' } as any;

  it('sums followers and orders accounts by followers, unknown last', () => {
    const summary = toProfileSummary(profile, [
      item('tg', 100),
      item('none', null),
      item('ig', 900),
    ]);

    expect(summary).toMatchObject({
      id: 'prof-1',
      name: 'Coffee Lab',
      totalFollowers: 1000,
    });
    expect(summary.accounts.map((a) => a.account.id)).toEqual([
      'ig',
      'tg',
      'none',
    ]);
  });

  it('has no total when no account has been counted yet', () => {
    expect(
      toProfileSummary(profile, [item('a', null)]).totalFollowers,
    ).toBeNull();
  });
});
