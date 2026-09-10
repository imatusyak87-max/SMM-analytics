import { NotFoundException } from '@nestjs/common';
import { StatsService, summarise } from './stats.service';

/** Chainable stand-in for the totals query; records calls so tests can inspect its parameters. */
function totalsQuery(
  raw: Record<string, string> | undefined = { postsCount: '0', totalViews: '0', totalReactions: '0' },
) {
  const qb: any = {};
  for (const method of ['select', 'addSelect', 'where', 'andWhere']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawOne = jest.fn().mockResolvedValue(raw);
  return qb;
}

interface Setup {
  account?: object | null;
  trend?: object[];
  firstSnapshot?: object | null;
  raw?: Record<string, string>;
}

function setup({
  account = { id: 'acc-1', name: 'Chan', createdAt: new Date('2026-09-10T12:00:00Z') },
  trend = [],
  firstSnapshot = null,
  raw,
}: Setup = {}) {
  const qb = totalsQuery(raw);
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
  const snapshotsRepo = {
    find: jest.fn().mockResolvedValue(trend),
    findOne: jest.fn().mockResolvedValue(firstSnapshot),
  } as any;
  const postsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any;
  return { service: new StatsService(accountsRepo, snapshotsRepo, postsRepo), qb, snapshotsRepo, postsRepo };
}

const period = { from: '2026-08-01', to: '2026-08-13' };

describe('StatsService.getAccountDetail', () => {
  it('returns account, latest snapshot and trend for the period', async () => {
    const snapshots = [
      { date: '2026-08-01', followersCount: 90 },
      { date: '2026-08-13', followersCount: 100 },
    ];
    const { service } = setup({ trend: snapshots });

    const result = await service.getAccountDetail('acc-1', period);

    expect(result.account).toMatchObject({ id: 'acc-1' });
    expect(result.latestSnapshot).toEqual(snapshots[1]);
    expect(result.trend).toBe(snapshots);
  });

  // Posts come from GET /accounts/:id/posts now, one page at a time. Returning the
  // whole period here as well would defeat the paging.
  it('no longer returns the posts themselves', async () => {
    const { service } = setup();
    const result = await service.getAccountDetail('acc-1', period);
    expect(result).not.toHaveProperty('posts');
  });

  it('totals posts in the period, with `to` extended to the end of its UTC day', async () => {
    const { service, qb } = setup();

    await service.getAccountDetail('acc-1', period);

    expect(qb.where).toHaveBeenCalledWith('post.accountId = :accountId', { accountId: 'acc-1' });
    const [, params] = qb.andWhere.mock.calls[0];
    expect(params.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(params.to.toISOString()).toBe('2026-08-13T23:59:59.999Z');
  });

  // Postgres returns COUNT and SUM as bigint, which the driver hands back as strings.
  it('turns the database totals into numbers', async () => {
    const { service } = setup({
      trend: [{ date: '2026-08-13', followersCount: 1000 }],
      raw: { postsCount: '2', totalViews: '4000', totalReactions: '200' },
    });

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary).toMatchObject({
      postsCount: 2,
      totalViews: 4000,
      totalReactions: 200,
      avgViews: 2000,
      followersCount: 1000,
    });
  });

  it('treats a missing totals row as an empty period', async () => {
    const { service, qb } = setup();
    qb.getRawOne.mockResolvedValue(undefined);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.postsCount).toBe(0);
    expect(summary.erViews).toBeNull();
  });
});

describe('StatsService.getAccountDetail coverage', () => {
  // The first sync scrapes 90 days back, so post data begins 90 days before the
  // account was added — not at the oldest stored post, which for a quiet channel
  // can be much later than where collection began.
  it('says posts were collected from 90 days before the account was added', async () => {
    const { service } = setup();
    const { coverage } = await service.getAccountDetail('acc-1', period);
    expect(coverage.postsFrom).toBe('2026-06-12');
  });

  it('says follower data starts at the earliest snapshot', async () => {
    const { service, snapshotsRepo } = setup({ firstSnapshot: { date: '2026-09-11', followersCount: 5 } });

    const { coverage } = await service.getAccountDetail('acc-1', period);

    expect(coverage.followersFrom).toBe('2026-09-11');
    expect(snapshotsRepo.findOne).toHaveBeenCalledWith({ where: { accountId: 'acc-1' }, order: { date: 'ASC' } });
  });

  it('falls back to the day the account was added when it has no snapshots yet', async () => {
    const { service } = setup({ firstSnapshot: null });
    const { coverage } = await service.getAccountDetail('acc-1', period);
    expect(coverage.followersFrom).toBe('2026-09-10');
  });
});

describe('StatsService.getAccountDetail for a missing account', () => {
  it('throws NotFoundException instead of returning a 200 with a null account', async () => {
    const { service } = setup({ account: null });
    await expect(service.getAccountDetail('gone', period)).rejects.toThrow(NotFoundException);
  });

  it('does not query snapshots or posts for an account that does not exist', async () => {
    const { service, snapshotsRepo, postsRepo } = setup({ account: null });

    await service.getAccountDetail('gone', period).catch(() => undefined);

    expect(snapshotsRepo.find).not.toHaveBeenCalled();
    expect(snapshotsRepo.findOne).not.toHaveBeenCalled();
    expect(postsRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('summarise', () => {
  it('averages views and reactions over the post count', () => {
    const summary = summarise({ postsCount: 2, totalViews: 4000, totalReactions: 200 }, 1000);
    expect(summary).toMatchObject({
      postsCount: 2,
      totalViews: 4000,
      totalReactions: 200,
      avgViews: 2000,
      avgReactions: 100,
    });
  });

  it('passes the follower count through', () => {
    expect(summarise({ postsCount: 1, totalViews: 10, totalReactions: 1 }, 4321).followersCount).toBe(4321);
  });

  // Weighted, not the mean of per-post ERs: a post with 12 views and 3 reactions
  // is 25%, and averaging it with everything else says nothing about the channel.
  it('computes ER from the totals, so small posts cannot skew it', () => {
    const summary = summarise({ postsCount: 2, totalViews: 10_012, totalReactions: 103 }, 1000);
    expect(summary.erViews).toBeCloseTo((103 / 10_012) * 100, 6);
  });

  it('reports ER against followers as well', () => {
    const summary = summarise({ postsCount: 1, totalViews: 1000, totalReactions: 50 }, 1000);
    expect(summary.erFollowers).toBeCloseTo(5, 6);
  });

  it('returns zeros and null ER for a period with no posts, not NaN', () => {
    const summary = summarise({ postsCount: 0, totalViews: 0, totalReactions: 0 }, 1000);
    expect(summary).toMatchObject({
      postsCount: 0,
      totalViews: 0,
      avgViews: 0,
      avgReactions: 0,
      erViews: null,
      erFollowers: null,
    });
  });

  it('gives null ER against followers when the follower count is unknown', () => {
    expect(summarise({ postsCount: 1, totalViews: 10, totalReactions: 1 }, null).erFollowers).toBeNull();
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
    const postsRepo = {} as any;
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
    const postsRepo = {} as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.compare(['acc-1', 'acc-2'], period);

    expect(result).toHaveLength(2);
    expect(result[0].account?.id).toBe('acc-1');
    expect(result[0].trend).toEqual([{ date: '2026-08-13', followersCount: 100 }]);
  });
});
