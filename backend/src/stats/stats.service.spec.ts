import { Between } from 'typeorm';
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

describe('StatsService date range upper bound (regression)', () => {
  // Bug: `new Date('2026-08-13')` parses to 2026-08-13T00:00:00.000Z (midnight UTC),
  // so a Between() upper bound built directly from the `to` string silently excluded
  // any post published later that same day. The fix extends the upper bound to the
  // last instant of the `to` day. These tests inspect the actual Between() arguments
  // passed to the (mocked) repo — a fully mocked find() would "pass" regardless of
  // the where clause, so asserting on the returned array alone would not prove the
  // boundary moved.

  it('getAccountDetail builds the publishedAt Between() upper bound as end-of-day on `to`, including a post published later that day', async () => {
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1' }) } as any;
    const snapshotsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    await service.getAccountDetail('acc-1', { from: '2026-08-01', to: '2026-08-13' });

    expect(postsRepo.find).toHaveBeenCalledTimes(1);
    const call = postsRepo.find.mock.calls[0][0];
    const [lower, upper] = call.where.publishedAt.value as [Date, Date];

    expect(lower.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(upper.toISOString()).toBe('2026-08-13T23:59:59.999Z');

    // A post published at 18:00 UTC on the `to` day would have been excluded by the
    // old midnight-UTC boundary (new Date('2026-08-13')) but must fall within the
    // fixed range.
    const oldBuggyUpperBound = new Date('2026-08-13');
    const latePost = new Date('2026-08-13T18:00:00.000Z');
    expect(latePost.getTime()).toBeGreaterThan(oldBuggyUpperBound.getTime());
    expect(latePost.getTime()).toBeLessThanOrEqual(upper.getTime());
  });

  it('getTopPosts builds the publishedAt Between() upper bound as end-of-day on `to`, including a post published later that day', async () => {
    const postsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const accountsRepo = { findOneBy: jest.fn() } as any;
    const snapshotsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    await service.getTopPosts('acc-1', { from: '2026-08-01', to: '2026-08-13' }, 5);

    expect(postsRepo.find).toHaveBeenCalledTimes(1);
    const call = postsRepo.find.mock.calls[0][0];
    const [lower, upper] = call.where.publishedAt.value as [Date, Date];

    expect(lower.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(upper.toISOString()).toBe('2026-08-13T23:59:59.999Z');

    const oldBuggyUpperBound = new Date('2026-08-13');
    const latePost = new Date('2026-08-13T18:00:00.000Z');
    expect(latePost.getTime()).toBeGreaterThan(oldBuggyUpperBound.getTime());
    expect(latePost.getTime()).toBeLessThanOrEqual(upper.getTime());
  });
});

describe('StatsService.getOverview', () => {
  it('returns every active account paired with its latest snapshot', async () => {
    const accounts = [{ id: 'acc-1' }, { id: 'acc-2' }];
    const accountsRepo = { find: jest.fn().mockResolvedValue(accounts), findOneBy: jest.fn() } as any;
    const snapshotsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ accountId: 'acc-1', date: '2026-08-13', followersCount: 100 })
        .mockResolvedValueOnce(null),
      find: jest.fn(),
    } as any;
    const postsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.getOverview();

    expect(result).toEqual([
      { account: accounts[0], latestSnapshot: { accountId: 'acc-1', date: '2026-08-13', followersCount: 100 } },
      { account: accounts[1], latestSnapshot: null },
    ]);
  });
});

describe('StatsService.compare', () => {
  it('returns each requested account with its trend for the period', async () => {
    const accountsRepo = {
      findOneBy: jest
        .fn()
        .mockResolvedValueOnce({ id: 'acc-1' })
        .mockResolvedValueOnce({ id: 'acc-2' }),
      find: jest.fn(),
    } as any;
    const snapshotsRepo = { find: jest.fn().mockResolvedValue([{ date: '2026-08-13', followersCount: 100 }]) } as any;
    const postsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.compare(['acc-1', 'acc-2'], { from: '2026-08-01', to: '2026-08-13' });

    expect(result).toHaveLength(2);
    expect(result[0].account.id).toBe('acc-1');
    expect(result[0].trend).toEqual([{ date: '2026-08-13', followersCount: 100 }]);
  });
});
