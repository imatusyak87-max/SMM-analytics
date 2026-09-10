import { NotFoundException } from '@nestjs/common';
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

describe('StatsService.getAccountDetail for a missing account', () => {
  it('throws NotFoundException instead of returning a 200 with a null account', async () => {
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(null) } as any;
    const snapshotsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    await expect(
      service.getAccountDetail('gone', { from: '2026-08-01', to: '2026-08-13' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not query snapshots or posts for an account that does not exist', async () => {
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(null) } as any;
    const snapshotsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    await service
      .getAccountDetail('gone', { from: '2026-08-01', to: '2026-08-13' })
      .catch(() => undefined);

    expect(snapshotsRepo.find).not.toHaveBeenCalled();
    expect(postsRepo.find).not.toHaveBeenCalled();
  });
});

describe('StatsService.getAccountDetail summary', () => {
  function serviceWith(posts: any[], followersCount = 1000) {
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1' }) } as any;
    const snapshotsRepo = {
      find: jest.fn().mockResolvedValue([{ date: '2026-09-01', followersCount }]),
    } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue(posts) } as any;
    return new StatsService(accountsRepo, snapshotsRepo, postsRepo);
  }

  const period = { from: '2026-09-01', to: '2026-09-30' };

  it('totals and averages views and reactions over the period', async () => {
    const service = serviceWith([
      { views: 1000, likes: 50 },
      { views: 3000, likes: 150 },
    ]);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.postsCount).toBe(2);
    expect(summary.totalViews).toBe(4000);
    expect(summary.totalReactions).toBe(200);
    expect(summary.avgViews).toBe(2000);
    expect(summary.avgReactions).toBe(100);
  });

  it('takes followers from the latest snapshot', async () => {
    const service = serviceWith([{ views: 10, likes: 1 }], 4321);
    const { summary } = await service.getAccountDetail('acc-1', period);
    expect(summary.followersCount).toBe(4321);
  });

  // Weighted, not the mean of per-post ERs: a post with 12 views and 3 reactions
  // is 25%, and averaging it with everything else says nothing about the channel.
  it('computes ER from the totals, so small posts cannot skew it', async () => {
    const service = serviceWith([
      { views: 12, likes: 3 },
      { views: 10_000, likes: 100 },
    ]);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.erViews).toBeCloseTo((103 / 10_012) * 100, 6);
  });

  it('reports ER against followers as well', async () => {
    const service = serviceWith([{ views: 1000, likes: 50 }], 1000);
    const { summary } = await service.getAccountDetail('acc-1', period);
    expect(summary.erFollowers).toBeCloseTo(5, 6);
  });

  it('returns zeros and null ER for a period with no posts, not NaN', async () => {
    const service = serviceWith([]);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.postsCount).toBe(0);
    expect(summary.totalViews).toBe(0);
    expect(summary.avgViews).toBe(0);
    expect(summary.erViews).toBeNull();
    expect(summary.erFollowers).toBeNull();
  });

  it('treats a post with unknown views as contributing no views', async () => {
    const service = serviceWith([{ views: null, likes: 5 }]);
    const { summary } = await service.getAccountDetail('acc-1', period);
    expect(summary.totalViews).toBe(0);
    expect(summary.totalReactions).toBe(5);
  });
});
