import { StatsService } from './stats.service';

describe('StatsService.getAccountDetail', () => {
  it('returns account, latest snapshot, trend, and posts within the period', async () => {
    const account = { id: 'acc-1', name: 'Chan' };
    const snapshots = [{ date: '2026-08-01', followersCount: 90 }, { date: '2026-08-13', followersCount: 100 }];
    const posts = [{ id: 'p1', publishedAt: new Date('2026-08-05') }];

    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const snapshotsRepo = {
      find: jest.fn().mockResolvedValue(snapshots),
    } as any;
    const postsRepo = {
      find: jest.fn().mockResolvedValue(posts),
    } as any;

    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);
    const result = await service.getAccountDetail('acc-1', { from: '2026-08-01', to: '2026-08-13' });

    expect(result.account).toBe(account);
    expect(result.latestSnapshot).toEqual(snapshots[1]);
    expect(result.trend).toBe(snapshots);
    expect(result.posts).toBe(posts);
  });
});

describe('StatsService.getTopPosts', () => {
  it('orders by likes+comments+shares descending and applies the type filter', async () => {
    const postsRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'p1', type: 'post', likes: 10, comments: 1, shares: 0 },
        { id: 'p2', type: 'post', likes: 50, comments: 5, shares: 2 },
      ]),
    } as any;
    const accountsRepo = { findOneBy: jest.fn() } as any;
    const snapshotsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.getTopPosts('acc-1', { from: '2026-08-01', to: '2026-08-13', type: 'post' }, 5);

    expect(result[0].id).toBe('p2');
    expect(result[1].id).toBe('p1');
  });
});
