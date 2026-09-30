import { HistoryPostStore, insightCursor } from './history-post-store';
import { PostType } from '../db/entities/post.entity';

function chain(result: unknown = undefined) {
  const qb: any = {};
  for (const m of ['insert', 'into', 'values', 'orUpdate', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'limit']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(undefined);
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getCount = jest.fn().mockResolvedValue(result);
  return qb;
}

const post = (id: string, overrides = {}) => ({
  externalPostId: id,
  type: PostType.IMAGE,
  publishedAt: new Date('2024-03-12T10:00:00Z'),
  permalink: null,
  thumbnailUrl: null,
  caption: 'c',
  likes: 8,
  comments: 2,
  shares: 0,
  views: 100,
  reach: null,
  ...overrides,
});

describe('HistoryPostStore.write', () => {
  it('upserts every post with ER computed from the given follower count', async () => {
    const qb = chain();
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.write('acc-1', [post('1')], 200, false);

    const rows = qb.values.mock.calls[0][0];
    expect(rows[0]).toMatchObject({ accountId: 'acc-1', externalPostId: '1', er: 5, erViews: 8 });
    expect(qb.orUpdate.mock.calls[0][1]).toEqual(['accountId', 'externalPostId']);
    expect(qb.orUpdate.mock.calls[0][0]).toEqual(expect.arrayContaining(['reach', 'shares', 'er', 'likes']));
  });

  it('never overwrites reach, shares, views or either ER of an existing row when insights are preserved', async () => {
    const qb = chain();
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.write('acc-1', [post('1')], 200, true);

    const updated: string[] = qb.orUpdate.mock.calls[0][0];
    expect(updated).not.toContain('reach');
    expect(updated).not.toContain('shares');
    expect(updated).not.toContain('er');
    expect(updated).not.toContain('views');
    expect(updated).not.toContain('erViews');
    expect(updated).toEqual(expect.arrayContaining(['likes', 'comments', 'caption', 'lastSyncedAt']));
  });

  it('does nothing for an empty page', async () => {
    const repo = { createQueryBuilder: jest.fn() };
    await new HistoryPostStore(repo as any).write('acc-1', [], 200, false);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('dedupes a page that repeats the same externalPostId, keeping the last occurrence', async () => {
    // A single bulk INSERT...ON CONFLICT DO UPDATE fails in Postgres ("cannot affect
    // row a second time") when the same externalPostId appears twice in one page.
    const qb = chain();
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.write('acc-1', [post('1', { likes: 1 }), post('2'), post('1', { likes: 99 })], 200, false);

    const rows = qb.values.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.externalPostId).sort()).toEqual(['1', '2']);
    expect(rows.find((r: any) => r.externalPostId === '1')).toMatchObject({ likes: 99 });
  });
});

describe('HistoryPostStore insight targets', () => {
  const windowStart = new Date('2026-06-30T00:00:00Z');

  it('counts the account posts older than the nightly window', async () => {
    const qb = chain(42);
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    expect(await store.countInsightTargets('acc-1', windowStart)).toBe(42);
    expect(qb.where).toHaveBeenCalledWith('p.accountId = :accountId', { accountId: 'acc-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('p.publishedAt < :windowStart', { windowStart });
  });

  it('pages newest first after the cursor', async () => {
    const qb = chain([]);
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.nextInsightTargets('acc-1', windowStart, '2024-03-12T10:00:00.000Z|abc', 60);

    expect(qb.orderBy).toHaveBeenCalledWith('p.publishedAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('p.externalPostId', 'DESC');
    expect(qb.limit).toHaveBeenCalledWith(60);
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(p.publishedAt < :cursorAt OR (p.publishedAt = :cursorAt AND p.externalPostId < :cursorId))',
      { cursorAt: new Date('2024-03-12T10:00:00.000Z'), cursorId: 'abc' },
    );
  });

  it('builds a cursor from a post', () => {
    expect(insightCursor({ publishedAt: new Date('2024-03-12T10:00:00Z'), externalPostId: 'abc' })).toBe('2024-03-12T10:00:00.000Z|abc');
  });
});

describe('HistoryPostStore.saveInsights', () => {
  it('writes reach, shares and views and recomputes both ERs', async () => {
    const repo = { update: jest.fn() };
    const store = new HistoryPostStore(repo as any);

    await store.saveInsights(
      { id: 'p1', likes: 8, comments: 2, shares: 0, reach: null, views: null } as any,
      { reach: 300, shares: 10, views: 400 },
      200,
    );

    expect(repo.update).toHaveBeenCalledWith({ id: 'p1' }, { reach: 300, shares: 10, views: 400, er: 10, erViews: 2 });
  });

  it('keeps the stored values when Instagram has no insights for the post', async () => {
    const repo = { update: jest.fn() };
    const store = new HistoryPostStore(repo as any);

    await store.saveInsights(
      { id: 'p1', likes: 8, comments: 2, shares: 3, reach: 250, views: 160 } as any,
      { reach: null, shares: null, views: null },
      200,
    );

    expect(repo.update).toHaveBeenCalledWith({ id: 'p1' }, { reach: 250, shares: 3, views: 160, er: 6.5, erViews: 5 });
  });
});
