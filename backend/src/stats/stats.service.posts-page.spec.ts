import { StatsService } from './stats.service';

/**
 * A chainable stand-in for TypeORM's SelectQueryBuilder that records every call.
 * Ordering and paging live in the query itself, so the tests assert on what the
 * service asks the database for — a stub that ignored them would pass regardless.
 */
function fakeQueryBuilder(result: [unknown[], number] = [[], 0]) {
  const qb: any = {};
  for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'offset', 'limit']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue(result);
  return qb;
}

function serviceWith(qb: any) {
  const postsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any;
  return new StatsService({} as any, {} as any, postsRepo);
}

const base = { from: '2026-09-01', to: '2026-09-30', sort: 'views' as const, page: 1, size: 10 };

describe('StatsService.getPostsPage', () => {
  it('returns the page of posts and the total count of the whole filtered set', async () => {
    const items = [{ id: 'p1' }, { id: 'p2' }];
    const service = serviceWith(fakeQueryBuilder([items, 37]));

    const result = await service.getPostsPage('acc-1', base);

    expect(result).toEqual({ total: 37, items });
  });

  it('filters by account and by the period, with `to` extended to the end of its UTC day', async () => {
    const qb = fakeQueryBuilder();
    await serviceWith(qb).getPostsPage('acc-1', base);

    expect(qb.where).toHaveBeenCalledWith('post.accountId = :accountId', { accountId: 'acc-1' });
    const [, params] = qb.andWhere.mock.calls.find(([sql]: [string]) => sql.includes('publishedAt'));
    expect(params.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(params.to.toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });

  it('narrows by post type only when one is given', async () => {
    const withType = fakeQueryBuilder();
    await serviceWith(withType).getPostsPage('acc-1', { ...base, type: 'video' as any });
    expect(withType.andWhere).toHaveBeenCalledWith('post.type = :type', { type: 'video' });

    const withoutType = fakeQueryBuilder();
    await serviceWith(withoutType).getPostsPage('acc-1', base);
    expect(withoutType.andWhere).not.toHaveBeenCalledWith('post.type = :type', expect.anything());
  });

  it.each([
    ['views', 'post.views'],
    ['reactions', 'post.likes'],
    ['er', 'post.erViews'],
    ['date', 'post.publishedAt'],
  ] as const)('sorts by %s on %s, descending, with unknown values last', async (sort, column) => {
    const qb = fakeQueryBuilder();
    await serviceWith(qb).getPostsPage('acc-1', { ...base, sort });
    expect(qb.orderBy).toHaveBeenCalledWith(column, 'DESC', 'NULLS LAST');
  });

  // Offset paging over a non-unique sort key can show a post on two pages and skip
  // another, because the database may order ties differently from one query to the
  // next. Date then id makes the order total.
  it('breaks ties by publication date, then id, so pages never overlap', async () => {
    const qb = fakeQueryBuilder();
    await serviceWith(qb).getPostsPage('acc-1', base);
    expect(qb.addOrderBy.mock.calls).toEqual([
      ['post.publishedAt', 'DESC'],
      ['post.id', 'ASC'],
    ]);
  });

  it('turns page and size into an offset and a limit', async () => {
    const qb = fakeQueryBuilder();
    await serviceWith(qb).getPostsPage('acc-1', { ...base, page: 3, size: 25 });
    expect(qb.offset).toHaveBeenCalledWith(50);
    expect(qb.limit).toHaveBeenCalledWith(25);
  });
});
