# Post Summary and Period Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an account's top 10 posts for a chosen period, with a button that reveals every post in a paged table with all metrics, and a period picker offering eight presets plus a calendar.

**Architecture:** The backend gains a paged, server-sorted `GET /accounts/:id/posts` returning `{ total, items }`; the top 10 is that endpoint at page 1, size 10. `GET /accounts/:id/detail` stops returning posts, computes its summary with a SQL aggregate, and reports `coverage` — where collected data begins. The frontend replaces the 7/30/90 selector with a `PeriodPicker` (presets + react-day-picker calendar) driving the whole page, and fetches detail, top 10 and table through one small hook that ignores stale responses.

**Tech Stack:** NestJS 11, TypeORM, Postgres, class-validator, Jest + supertest (backend); React 19, Vite, Vitest + Testing Library, `@daypicker/react` 10 (new) (frontend).

**Spec:** [docs/superpowers/specs/2026-09-11-post-summary-and-period-picker-design.md](../specs/2026-09-11-post-summary-and-period-picker-design.md)

## Global Constraints

- **User-facing copy is Russian.** Never add English UI strings.
- **Preset labels, verbatim and in this order:** Последние 7 дней, Последние 30 дней, Этот месяц, Прошлый месяц, Текущий квартал, Прошлый квартал, Текущий год, Прошлый год.
- **«Последние N дней» is N days including today.** «Этот/Текущий …» ends today. «Прошлый …» is the whole previous month/quarter/year. Quarters are calendar quarters.
- **The default period is «Последние 30 дней».**
- **Periods travel as `YYYY-MM-DD` strings, `to` inclusive.** The server extends `to` to the end of its UTC day (existing `endOfDayUtc`).
- **Sort keys are `views`, `reactions`, `er`, `date`, always descending, default `views`.** `reactions` sorts the `likes` column, `er` sorts `erViews`. Nulls sort last. Ties break by `publishedAt DESC`, then `id ASC`.
- **Page sizes are exactly 10, 25, 50, 100; default 10.** Anything else is a 400.
- **`er` always means ER-by-followers; `erViews` always means ERR-by-views.**
- **One sort control and one type filter govern both the top 10 and the table.** Changing the sort, type filter, period or page size resets the table to page 1.
- **The UI tasks (4, 5, 6, 8) are built with the taste skill.** Invoke it before writing markup or CSS. The CSS in this plan is the baseline: the taste pass may refine visual values but must keep the class names, use only the existing `var(--…)` tokens, and add no new colours.
- **No migration.** Nothing in this plan changes the schema.
- **Do not deploy mid-plan.** After Task 2 the backend no longer sends `posts` in the detail response, and the frontend only stops needing it in Task 8.
- **Frontend tests run with `TZ=UTC`** (set in `frontend/vite.config.ts`). Date-dependent code takes an injectable `today`, or the test fakes `Date`.
- **TDD throughout.** Write the test, watch it fail for the right reason, then implement.
- **Work on branch `post-summary-period-picker`.** Dependencies are installed in both `backend/` and `frontend/`.
- **Commands:** backend tests `cd backend && npx jest <path>`; frontend tests `cd frontend && npx vitest run <path>`.

---

### Task 1: Paged posts endpoint, replacing top-posts

`GET /accounts/:id/top-posts` is called by nothing in the frontend and sorts in JS after loading every row. The new endpoint does sorting, paging and counting in SQL. This task adds it and removes the old one.

**Files:**
- Modify: `backend/src/stats/dto/post-filter.dto.ts`
- Modify: `backend/src/stats/stats.service.ts` (add `getPostsPage`, remove `getTopPosts`)
- Modify: `backend/src/stats/stats.controller.ts`
- Create: `backend/src/stats/stats.service.posts-page.spec.ts`
- Modify: `backend/src/stats/stats-validation.spec.ts`
- Modify: `backend/src/stats/stats.controller.spec.ts`
- Modify: `backend/src/stats/stats.service.spec.ts` (delete the two `getTopPosts` tests only)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `POST_SORTS = ['views', 'reactions', 'er', 'date'] as const`, `type PostSortKey`, `PAGE_SIZES = [10, 25, 50, 100] as const`, `class PostsPageFilterDto` — from `dto/post-filter.dto.ts`
  - `interface PostsPageQuery { from: string; to: string; type?: PostType; sort: PostSortKey; page: number; size: number }` and `interface PostsPage { total: number; items: Post[] }` — from `stats.service.ts`
  - `StatsService.getPostsPage(accountId: string, query: PostsPageQuery): Promise<PostsPage>`
  - HTTP `GET /accounts/:id/posts?from&to&type&sort&page&size` → `{ total, items }`

- [ ] **Step 1: Write the failing service test**

Create `backend/src/stats/stats.service.posts-page.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/stats/stats.service.posts-page.spec.ts`
Expected: FAIL — `Property 'getPostsPage' does not exist on type 'StatsService'`.

- [ ] **Step 3: Replace the DTO file**

Replace the whole of `backend/src/stats/dto/post-filter.dto.ts` with:

```typescript
import { IsDateString, IsIn, IsOptional, IsEnum, IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostType } from '../../db/entities/post.entity';

export const POST_SORTS = ['views', 'reactions', 'er', 'date'] as const;
export type PostSortKey = (typeof POST_SORTS)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export class PeriodFilterDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
}

export class PostFilterDto extends PeriodFilterDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
}

export class PostsPageFilterDto extends PostFilterDto {
  @IsOptional() @IsIn([...POST_SORTS]) sort?: PostSortKey;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([...PAGE_SIZES]) size?: number;
}

export class CompareFilterDto extends PeriodFilterDto {
  @IsString() accountIds: string;
}
```

- [ ] **Step 4: Add `getPostsPage` and remove `getTopPosts` in the service**

In `backend/src/stats/stats.service.ts`, add below the existing imports:

```typescript
import type { PostSortKey } from './dto/post-filter.dto';
```

Add below the `AccountSummary` interface:

```typescript
export interface PostsPageQuery extends Period {
  type?: PostType;
  sort: PostSortKey;
  page: number;
  size: number;
}

export interface PostsPage {
  total: number;
  items: Post[];
}

/** The UI's sort names mapped to the columns they order by, in one place. */
const SORT_COLUMNS: Record<PostSortKey, string> = {
  views: 'post.views',
  reactions: 'post.likes',
  er: 'post.erViews',
  date: 'post.publishedAt',
};
```

Delete the whole `getTopPosts` method and put this in its place:

```typescript
  async getPostsPage(accountId: string, query: PostsPageQuery): Promise<PostsPage> {
    const qb = this.postsRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.publishedAt BETWEEN :from AND :to', {
        from: new Date(query.from),
        to: endOfDayUtc(query.to),
      });
    if (query.type) qb.andWhere('post.type = :type', { type: query.type });

    const [items, total] = await qb
      .orderBy(SORT_COLUMNS[query.sort], 'DESC', 'NULLS LAST')
      .addOrderBy('post.publishedAt', 'DESC')
      .addOrderBy('post.id', 'ASC')
      .offset((query.page - 1) * query.size)
      .limit(query.size)
      .getManyAndCount();

    return { total, items };
  }
```

- [ ] **Step 5: Delete the `getTopPosts` tests from the service spec**

In `backend/src/stats/stats.service.spec.ts`, delete:
- the whole `describe('StatsService.getTopPosts', ...)` block;
- inside `describe('StatsService date range upper bound (regression)', ...)`, the test titled `'getTopPosts builds the publishedAt Between() upper bound as end-of-day on \`to\`, including a post published later that day'`. Keep the `getAccountDetail` test in that block.

- [ ] **Step 6: Run the service tests to verify they pass**

Run: `cd backend && npx jest src/stats/stats.service`
Expected: PASS — both `stats.service.spec.ts` and `stats.service.posts-page.spec.ts`.

- [ ] **Step 7: Write the failing controller and validation tests**

In `backend/src/stats/stats.controller.spec.ts`, replace the `getTopPosts` line in `buildController` with:

```typescript
      getPostsPage: overrides.getPostsPage ?? jest.fn().mockResolvedValue({ total: 0, items: [] }),
```

and add this test inside the `describe`:

```typescript
  it('posts fills in the defaults for sort, page and size', async () => {
    const controller = buildController();
    await controller.posts('acc-1', { from: '2026-08-01', to: '2026-08-13' });
    expect(controller['statsService'].getPostsPage).toHaveBeenCalledWith('acc-1', {
      from: '2026-08-01',
      to: '2026-08-13',
      type: undefined,
      sort: 'views',
      page: 1,
      size: 10,
    });
  });
```

In `backend/src/stats/stats-validation.spec.ts`, replace the `getTopPosts` line in the `statsService` object with:

```typescript
    getPostsPage: jest.fn().mockResolvedValue({ total: 0, items: [] }),
```

Delete the two tests `'rejects a non-numeric top-posts limit instead of silently returning nothing'` and `'defaults the top-posts limit to 10 when it is not given'`, and add:

```typescript
  it('applies the defaults — views, page 1, 10 per page — when the posts query omits them', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/posts')
      .query({ from: '2026-08-01', to: '2026-08-13' })
      .expect(200);

    expect(statsService.getPostsPage).toHaveBeenCalledWith('acc-1', {
      from: '2026-08-01',
      to: '2026-08-13',
      type: undefined,
      sort: 'views',
      page: 1,
      size: 10,
    });
  });

  it('passes a chosen sort, page, size and type through, with page and size as numbers', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/posts')
      .query({ from: '2026-08-01', to: '2026-08-13', sort: 'er', page: '3', size: '25', type: 'video' })
      .expect(200);

    expect(statsService.getPostsPage).toHaveBeenCalledWith('acc-1', {
      from: '2026-08-01',
      to: '2026-08-13',
      type: 'video',
      sort: 'er',
      page: 3,
      size: 25,
    });
  });

  it.each([
    ['a page size that is not one of the options', { size: '7' }],
    ['a page size above the largest option', { size: '500' }],
    ['an unknown sort', { sort: 'foo' }],
    ['page 0', { page: '0' }],
  ])('rejects %s as a 400', async (_label, extra) => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/posts')
      .query({ from: '2026-08-01', to: '2026-08-13', ...extra })
      .expect(400);

    expect(statsService.getPostsPage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 8: Run them to verify they fail**

Run: `cd backend && npx jest src/stats/stats.controller.spec.ts src/stats/stats-validation.spec.ts`
Expected: FAIL — `Property 'posts' does not exist on type 'StatsController'` and 404s for `/accounts/acc-1/posts`.

- [ ] **Step 9: Replace the top-posts route in the controller**

In `backend/src/stats/stats.controller.ts`:
- change the DTO import to `import { CompareFilterDto, PeriodFilterDto, PostsPageFilterDto } from './dto/post-filter.dto';`
- replace `const DEFAULT_TOP_POSTS_LIMIT = 10;` with `const DEFAULT_PAGE_SIZE = 10;`
- replace the whole `topPosts` method (with its `@Get('accounts/:id/top-posts')`) with:

```typescript
  @Get('accounts/:id/posts')
  posts(@Param('id') id: string, @Query() filter: PostsPageFilterDto) {
    return this.statsService.getPostsPage(id, {
      from: filter.from,
      to: filter.to,
      type: filter.type,
      sort: filter.sort ?? 'views',
      page: filter.page ?? 1,
      size: filter.size ?? DEFAULT_PAGE_SIZE,
    });
  }
```

- [ ] **Step 10: Run the stats suite and check nothing references the old endpoint**

Run: `cd backend && npx jest src/stats`
Expected: PASS.

Run: `cd backend && grep -rn "getTopPosts\|TopPostsFilterDto\|top-posts" src`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add backend/src/stats
git commit -m "Page and sort an account's posts on the server, replacing top-posts"
```

---

### Task 2: Detail response — SQL summary, coverage, no posts

**Files:**
- Create: `backend/src/sync/history-window.ts`
- Modify: `backend/src/sync/sync.processor.ts:48-49`
- Modify: `backend/src/stats/stats.service.ts`
- Rewrite: `backend/src/stats/stats.service.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the file it left.
- Produces:
  - `POST_HISTORY_DAYS = 90` from `backend/src/sync/history-window.ts`
  - `interface PostTotals { postsCount: number; totalViews: number; totalReactions: number }` and `summarise(totals: PostTotals, followersCount: number | null): AccountSummary`, both exported from `stats.service.ts`
  - `getAccountDetail` returns `{ account, latestSnapshot, trend, summary, coverage: { postsFrom: string; followersFrom: string } }` — no `posts`. Task 8 relies on this shape.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `backend/src/stats/stats.service.spec.ts` with:

```typescript
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
```

(The old "unknown views contribute no views" case moves into SQL: `SUM` skips NULLs and `COALESCE` turns an all-NULL sum into 0. The `result[0].account?.id` fixes a pre-existing `tsc` error in this file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/stats/stats.service.spec.ts`
Expected: FAIL — `Module '"./stats.service"' has no exported member 'summarise'`.

- [ ] **Step 3: Add the shared history window**

Create `backend/src/sync/history-window.ts`:

```typescript
/**
 * How far back a sync scrapes posts. A newly added account's first sync therefore
 * reaches this many days before the account was added, which is also where the
 * account page says post data begins.
 */
export const POST_HISTORY_DAYS = 90;
```

In `backend/src/sync/sync.processor.ts`, add `import { POST_HISTORY_DAYS } from './history-window';` with the other imports, and change

```typescript
      since.setDate(since.getDate() - 90);
```

to

```typescript
      since.setDate(since.getDate() - POST_HISTORY_DAYS);
```

- [ ] **Step 4: Rework the service**

In `backend/src/stats/stats.service.ts`:

Add to the imports:

```typescript
import { POST_HISTORY_DAYS } from '../sync/history-window';
```

Replace the whole existing `summarise` function and its doc comment with:

```typescript
const DAY_MS = 86_400_000;

export interface PostTotals {
  postsCount: number;
  totalViews: number;
  totalReactions: number;
}

/**
 * ER is weighted — totals over totals — because the mean of per-post ERs lets a
 * post with a dozen views dominate the channel's figure.
 */
export function summarise(totals: PostTotals, followersCount: number | null): AccountSummary {
  const { postsCount, totalViews, totalReactions } = totals;

  return {
    followersCount,
    postsCount,
    totalViews,
    totalReactions,
    avgViews: postsCount > 0 ? totalViews / postsCount : 0,
    avgReactions: postsCount > 0 ? totalReactions / postsCount : 0,
    erViews: totalViews > 0 ? (totalReactions / totalViews) * 100 : null,
    erFollowers:
      followersCount && followersCount > 0 && postsCount > 0
        ? (totalReactions / postsCount / followersCount) * 100
        : null,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

Replace the whole `getAccountDetail` method with:

```typescript
  async getAccountDetail(accountId: string, period: Period) {
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);

    const trend = await this.snapshotsRepo.find({
      where: { accountId, date: Between(period.from, period.to) },
      order: { date: 'ASC' },
    });
    const firstSnapshot = await this.snapshotsRepo.findOne({
      where: { accountId },
      order: { date: 'ASC' },
    });
    const totals = await this.getPostTotals(accountId, period);

    const latestSnapshot = trend.length > 0 ? trend[trend.length - 1] : null;

    return {
      account,
      latestSnapshot,
      trend,
      summary: summarise(totals, latestSnapshot?.followersCount ?? null),
      coverage: {
        postsFrom: isoDate(new Date(account.createdAt.getTime() - POST_HISTORY_DAYS * DAY_MS)),
        followersFrom: firstSnapshot?.date ?? isoDate(account.createdAt),
      },
    };
  }

  /**
   * Counts and sums in SQL. The period's rows are no longer loaded for the browser,
   * so loading them only to add them up would fetch a whole period to return three
   * numbers.
   */
  private async getPostTotals(accountId: string, period: Period): Promise<PostTotals> {
    const raw = await this.postsRepo
      .createQueryBuilder('post')
      .select('COUNT(*)', 'postsCount')
      .addSelect('COALESCE(SUM(post.views), 0)', 'totalViews')
      .addSelect('COALESCE(SUM(post.likes), 0)', 'totalReactions')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.publishedAt BETWEEN :from AND :to', {
        from: new Date(period.from),
        to: endOfDayUtc(period.to),
      })
      .getRawOne<{ postsCount: string; totalViews: string; totalReactions: string }>();

    // Postgres returns COUNT and SUM as bigint, which the driver hands back as strings.
    return {
      postsCount: Number(raw?.postsCount ?? 0),
      totalViews: Number(raw?.totalViews ?? 0),
      totalReactions: Number(raw?.totalReactions ?? 0),
    };
  }
```

- [ ] **Step 5: Run the backend suite and the build type-check**

Run: `cd backend && npx jest`
Expected: PASS, all suites.

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/sync/history-window.ts backend/src/sync/sync.processor.ts backend/src/stats
git commit -m "Summarise an account's posts in SQL and report where its data begins"
```

---

### Task 3: Period presets

A pure module: every preset boundary can be tested without rendering anything.

**Files:**
- Create: `frontend/src/periods.ts`
- Test: `frontend/src/periods.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all from `frontend/src/periods.ts`):
  - `type PresetId = 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'lastYear'`
  - `interface Period { from: string; to: string }`
  - `interface SelectedPeriod extends Period { preset: PresetId | null }`
  - `PRESETS: ReadonlyArray<{ id: PresetId; label: string }>`
  - `toIsoDate(date: Date): string`, `fromIsoDate(iso: string): Date`
  - `formatIsoDate(iso: string): string` (`2026-07-01` → `01.07.2026`), `formatPeriod(period: Period): string`
  - `presetRange(preset: PresetId, today: Date): Period`, `selectPreset(preset: PresetId, today: Date): SelectedPeriod`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/periods.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  formatIsoDate,
  formatPeriod,
  fromIsoDate,
  presetRange,
  selectPreset,
  toIsoDate,
} from './periods';

const on = (iso: string) => fromIsoDate(iso);

describe('presetRange', () => {
  const today = on('2026-09-11');

  it.each([
    ['last7', '2026-09-05', '2026-09-11'],
    ['last30', '2026-08-13', '2026-09-11'],
    ['thisMonth', '2026-09-01', '2026-09-11'],
    ['lastMonth', '2026-08-01', '2026-08-31'],
    ['thisQuarter', '2026-07-01', '2026-09-11'],
    ['lastQuarter', '2026-04-01', '2026-06-30'],
    ['thisYear', '2026-01-01', '2026-09-11'],
    ['lastYear', '2025-01-01', '2025-12-31'],
  ] as const)('%s on 11.09.2026 runs from %s to %s', (preset, from, to) => {
    expect(presetRange(preset, today)).toEqual({ from, to });
  });

  it('counts «Последние 7 дней» as seven days including today, across a month boundary', () => {
    expect(presetRange('last7', on('2026-03-03'))).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  });

  it('reaches back into last year from January', () => {
    const january = on('2027-01-15');
    expect(presetRange('lastMonth', january)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetRange('lastQuarter', january)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('thisQuarter', january)).toEqual({ from: '2027-01-01', to: '2027-01-15' });
  });

  it('starts a quarter on its first day and ends the last one on its last', () => {
    expect(presetRange('thisQuarter', on('2026-04-01'))).toEqual({ from: '2026-04-01', to: '2026-04-01' });
    expect(presetRange('lastQuarter', on('2026-04-01'))).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(presetRange('thisQuarter', on('2026-12-31'))).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('ends last February on the 29th in a leap year and the 28th otherwise', () => {
    expect(presetRange('lastMonth', on('2028-03-10')).to).toBe('2028-02-29');
    expect(presetRange('lastMonth', on('2027-03-10')).to).toBe('2027-02-28');
  });
});

describe('selectPreset', () => {
  it('remembers which preset produced the range', () => {
    expect(selectPreset('lastYear', on('2026-09-11'))).toEqual({
      preset: 'lastYear',
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });
});

describe('PRESETS', () => {
  it('offers the eight presets in order, in Russian', () => {
    expect(PRESETS.map((preset) => preset.label)).toEqual([
      'Последние 7 дней',
      'Последние 30 дней',
      'Этот месяц',
      'Прошлый месяц',
      'Текущий квартал',
      'Прошлый квартал',
      'Текущий год',
      'Прошлый год',
    ]);
  });
});

describe('date helpers', () => {
  it('round-trips a local calendar date through its ISO form', () => {
    expect(toIsoDate(fromIsoDate('2026-02-05'))).toBe('2026-02-05');
  });

  it('formats dates and periods the Russian way', () => {
    expect(formatIsoDate('2026-07-01')).toBe('01.07.2026');
    expect(formatPeriod({ from: '2026-07-01', to: '2026-07-31' })).toBe('01.07.2026 – 31.07.2026');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/periods.test.ts`
Expected: FAIL — `Failed to resolve import "./periods"`.

- [ ] **Step 3: Implement**

Create `frontend/src/periods.ts`:

```typescript
/**
 * Period presets for the account page and the date helpers they need. Periods
 * travel as `YYYY-MM-DD` strings — the shape the API takes — with `to` inclusive.
 * Dates are built from the user's local calendar day, since "this month" means
 * the month on the user's wall calendar.
 */
export type PresetId =
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'
  | 'lastYear';

export interface Period {
  from: string;
  to: string;
}

/** A period plus the preset that produced it, or null for a range picked on the calendar. */
export interface SelectedPeriod extends Period {
  preset: PresetId | null;
}

export const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: 'last7', label: 'Последние 7 дней' },
  { id: 'last30', label: 'Последние 30 дней' },
  { id: 'thisMonth', label: 'Этот месяц' },
  { id: 'lastMonth', label: 'Прошлый месяц' },
  { id: 'thisQuarter', label: 'Текущий квартал' },
  { id: 'lastQuarter', label: 'Прошлый квартал' },
  { id: 'thisYear', label: 'Текущий год' },
  { id: 'lastYear', label: 'Прошлый год' },
];

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `2026-07-01` → `01.07.2026`. */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export function formatPeriod(period: Period): string {
  return `${formatIsoDate(period.from)} – ${formatIsoDate(period.to)}`;
}

/**
 * «Последние N дней» is N days including today. «Этот/Текущий …» runs to today,
 * not to the end of the month, quarter or year; «Прошлый …» is the whole previous
 * one. Quarters are calendar quarters. `new Date(y, m, d)` rolls out-of-range
 * months and days over, which handles every year and month boundary: month -1 is
 * last December, and day 0 is the previous month's last day.
 */
export function presetRange(preset: PresetId, today: Date): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const day = (year: number, month: number, date: number) => toIsoDate(new Date(year, month, date));
  const todayIso = day(y, m, d);
  const quarterStart = m - (m % 3);

  switch (preset) {
    case 'last7':
      return { from: day(y, m, d - 6), to: todayIso };
    case 'last30':
      return { from: day(y, m, d - 29), to: todayIso };
    case 'thisMonth':
      return { from: day(y, m, 1), to: todayIso };
    case 'lastMonth':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case 'thisQuarter':
      return { from: day(y, quarterStart, 1), to: todayIso };
    case 'lastQuarter':
      return { from: day(y, quarterStart - 3, 1), to: day(y, quarterStart, 0) };
    case 'thisYear':
      return { from: day(y, 0, 1), to: todayIso };
    case 'lastYear':
      return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
  }
}

export function selectPreset(preset: PresetId, today: Date): SelectedPeriod {
  return { preset, ...presetRange(preset, today) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/periods.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/periods.ts frontend/src/periods.test.ts
git commit -m "Compute the account page's period presets"
```

---

### Task 4: PeriodPicker — presets and calendar

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (new dependency)
- Create: `frontend/src/components/PeriodPicker.tsx`
- Create: `frontend/src/components/PeriodPicker.module.css`
- Test: `frontend/src/components/PeriodPicker.test.tsx`

**Interfaces:**
- Consumes: `PRESETS`, `SelectedPeriod`, `selectPreset`, `formatPeriod`, `fromIsoDate`, `toIsoDate` from `../periods` (Task 3).
- Produces: `PeriodPicker({ value: SelectedPeriod; onChange: (next: SelectedPeriod) => void; today?: Date })`. A preset click reports `{ preset: <id>, from, to }`; an applied calendar range reports `{ preset: null, from, to }`.

**Package note:** react-day-picker v10's own README calls `react-day-picker` the legacy name and recommends `@daypicker/react`, a thin wrapper over the same v10 code with the same API. The spec's "react-day-picker@10" is installed under that name. Facts verified from the 10.0.1 package: `mode="range"`; `onSelect(selected, triggerDate, modifiers, e)`; `ru` is exported from `@daypicker/react/locale`; `disabled={{ after: date }}` disables later days, and disabled days cannot be selected; the stylesheet is `@daypicker/react/style.css` and is themed with `--rdp-accent-color`, `--rdp-accent-background-color` and `--rdp-today-color`; a day button's text is the bare day number.

- [ ] **Step 1: Invoke the taste skill**

This is a UI task. Invoke the taste skill before writing markup or CSS, and follow the Global Constraints on how far it may change the baseline below.

- [ ] **Step 2: Install the calendar**

Run: `cd frontend && npm install @daypicker/react@^10.0.1`
Expected: `package.json` gains `"@daypicker/react": "^10.0.1"` under `dependencies`.

- [ ] **Step 3: Write the failing test**

Create `frontend/src/components/PeriodPicker.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PeriodPicker } from './PeriodPicker';
import { fromIsoDate, selectPreset, type SelectedPeriod } from '../periods';

const today = fromIsoDate('2026-09-11');
// 13.08.2026 – 11.09.2026, so the calendar opens on August and September 2026.
const last30 = selectPreset('last30', today);

function renderPicker(value: SelectedPeriod = last30) {
  const onChange = vi.fn();
  render(<PeriodPicker value={value} onChange={onChange} today={today} />);
  return onChange;
}

function openCalendar() {
  fireEvent.click(screen.getByRole('button', { name: /Выбрать даты/ }));
  return screen.getByRole('dialog', { name: 'Выбор периода' });
}

describe('PeriodPicker', () => {
  it('offers every preset and marks the active one', () => {
    renderPicker();
    const group = screen.getByRole('group', { name: 'Период' });
    expect(within(group).getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Последние 30 дней' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Прошлый месяц' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports a preset as its date range', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Прошлый квартал' }));
    expect(onChange).toHaveBeenCalledWith({ preset: 'lastQuarter', from: '2026-04-01', to: '2026-06-30' });
  });

  it('shows the current range on the calendar button', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Выбрать даты/ })).toHaveTextContent('13.08.2026 – 11.09.2026');
  });

  it('marks no preset active for a range picked on the calendar', () => {
    renderPicker({ preset: null, from: '2026-08-01', to: '2026-08-10' });
    const group = screen.getByRole('group', { name: 'Период' });
    within(group)
      .getAllByRole('button')
      .forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'));
  });

  it('applies a range picked on the calendar only on «Применить»', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('1')[0]);
    fireEvent.click(within(dialog).getAllByText('10')[0]);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-01', to: '2026-08-10' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('orders the range whichever day is clicked first', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('20')[0]);
    fireEvent.click(within(dialog).getAllByText('5')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-05', to: '2026-08-20' });
  });

  it('applies a single picked day as a one-day period', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('7')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-07', to: '2026-08-07' });
  });

  it('ignores a click on a future day', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    // [1] is September; 12 September is the day after `today`. If the click were
    // accepted it would start the range there and 5 August would end it.
    fireEvent.click(within(dialog).getAllByText('12')[1]);
    fireEvent.click(within(dialog).getAllByText('5')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-05', to: '2026-08-05' });
  });

  it('closes on Escape without applying', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('1')[0]);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on «Отмена» without applying', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/PeriodPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./PeriodPicker"`.

- [ ] **Step 5: Implement the component**

Create `frontend/src/components/PeriodPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { DayPicker, type DateRange } from '@daypicker/react';
import { ru } from '@daypicker/react/locale';
import '@daypicker/react/style.css';
import styles from './PeriodPicker.module.css';
import {
  PRESETS,
  formatPeriod,
  fromIsoDate,
  selectPreset,
  toIsoDate,
  type SelectedPeriod,
} from '../periods';

interface PeriodPickerProps {
  value: SelectedPeriod;
  onChange: (next: SelectedPeriod) => void;
  /** Injectable so tests do not depend on the real date. */
  today?: Date;
}

/** Narrow screens get one month, since two side by side do not fit. */
function monthsToShow(): number {
  const narrow =
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
  return narrow ? 1 : 2;
}

export function PeriodPicker({ value, onChange, today = new Date() }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  function openCalendar() {
    setDraft({ from: fromIsoDate(value.from), to: fromIsoDate(value.to) });
    setOpen(true);
  }

  // The first click after opening starts a new range rather than stretching the
  // current one; the second closes it, on whichever side of the first it falls.
  function pickDay(_range: DateRange | undefined, day: Date) {
    if (!draft?.from || draft.to) {
      setDraft({ from: day, to: undefined });
    } else if (day < draft.from) {
      setDraft({ from: day, to: draft.from });
    } else {
      setDraft({ from: draft.from, to: day });
    }
  }

  function apply() {
    if (!draft?.from) return;
    onChange({ preset: null, from: toIsoDate(draft.from), to: toIsoDate(draft.to ?? draft.from) });
    setOpen(false);
  }

  const label = formatPeriod(value);

  return (
    <div className={styles.bar}>
      <div className={styles.presets} role="group" aria-label="Период">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={preset.id === value.preset ? styles.active : styles.option}
            aria-pressed={preset.id === value.preset}
            onClick={() => onChange(selectPreset(preset.id, today))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className={styles.calendar} ref={wrapRef}>
        <button
          type="button"
          className={value.preset === null ? styles.calendarActive : styles.calendarButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Выбрать даты: ${label}`}
          onClick={() => (open ? setOpen(false) : openCalendar())}
        >
          {label}
        </button>
        {open && (
          <div className={styles.popover} role="dialog" aria-label="Выбор периода">
            <DayPicker
              mode="range"
              locale={ru}
              weekStartsOn={1}
              numberOfMonths={monthsToShow()}
              defaultMonth={draft?.from}
              endMonth={today}
              selected={draft}
              onSelect={pickDay}
              disabled={{ after: today }}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={!draft?.from}
                onClick={apply}
              >
                Применить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

Create `frontend/src/components/PeriodPicker.module.css`:

```css
/*
 * Presets reuse the segmented-control idiom PostSortSelect shares (recessed
 * --code-bg track; the chosen segment lifts onto --bg with an accent outline).
 * Eight options wrap onto further lines on narrow screens instead of overflowing.
 */
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--code-bg);
}

.option {
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease,
    transform 0.1s ease;
}

.option:hover {
  color: var(--text-h);
}

.option:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 1px;
}

.option:active {
  transform: scale(0.97);
}

.active {
  composes: option;
  color: var(--text-h);
  background: var(--bg);
  border-color: var(--accent-border);
  cursor: default;
}

.calendar {
  position: relative;
}

.calendarButton {
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.calendarButton:hover {
  color: var(--text-h);
  border-color: var(--accent-border);
}

.calendarButton:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 1px;
}

/* A custom range is the active choice, so the button takes the selected look. */
.calendarActive {
  composes: calendarButton;
  color: var(--text-h);
  background: var(--accent-bg);
  border-color: var(--accent-border);
}

.popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 20;
  box-sizing: border-box;
  max-width: calc(100vw - 32px);
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: var(--shadow);
  color: var(--text-h);
  --rdp-accent-color: var(--accent);
  --rdp-accent-background-color: var(--accent-bg);
  --rdp-today-color: var(--accent);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.secondary,
.primary {
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border);
  cursor: pointer;
}

.secondary {
  color: var(--text);
  background: transparent;
}

.secondary:hover {
  color: var(--text-h);
}

.primary {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary:focus-visible,
.primary:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 1px;
}

/* On a phone the popover spans the bar instead of hanging off the button. */
@media (max-width: 640px) {
  .bar {
    position: relative;
  }

  .calendar {
    position: static;
  }

  .popover {
    left: 0;
    right: 0;
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .option,
  .calendarButton {
    transition: none;
  }

  .option:active {
    transform: none;
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/PeriodPicker.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/PeriodPicker.tsx frontend/src/components/PeriodPicker.module.css frontend/src/components/PeriodPicker.test.tsx
git commit -m "Pick a period from presets or a calendar"
```

---

### Task 5: Pagination with a page-size picker

**Files:**
- Create: `frontend/src/components/Pagination.tsx`
- Create: `frontend/src/components/Pagination.module.css`
- Test: `frontend/src/components/Pagination.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PAGE_SIZES = [10, 25, 50, 100] as const`
  - `pageItems(page: number, count: number): Array<number | 'gap'>`
  - `Pagination({ page: number; size: number; total: number; onPageChange: (page: number) => void; onSizeChange: (size: number) => void })`

- [ ] **Step 1: Invoke the taste skill**

This is a UI task. Invoke the taste skill before writing markup or CSS.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/Pagination.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Pagination, pageItems } from './Pagination';

const noop = () => {};

describe('pageItems', () => {
  it('lists every page when there are at most seven', () => {
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows the first and last page with the current one and its neighbours', () => {
    expect(pageItems(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });

  it('drops a gap that would hide no pages', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 'gap', 20]);
    expect(pageItems(3, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap', 19, 20]);
  });
});

describe('Pagination', () => {
  it('shows one button per page and marks the current one', () => {
    render(<Pagination page={2} size={10} total={45} onPageChange={noop} onSizeChange={noop} />);
    expect(screen.getByRole('button', { name: 'Страница 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Страница 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Страница 6' })).not.toBeInTheDocument();
  });

  it('moves to the page clicked, and by one with the arrows', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} size={10} total={45} onPageChange={onPageChange} onSizeChange={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Страница 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая страница' }));

    expect(onPageChange.mock.calls).toEqual([[4], [3], [1]]);
  });

  it('disables the arrows at either end', () => {
    render(<Pagination page={1} size={10} total={5} onPageChange={noop} onSizeChange={noop} />);
    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
  });

  it('offers 10, 25, 50 and 100 per page and reports the choice as a number', () => {
    const onSizeChange = vi.fn();
    render(<Pagination page={1} size={10} total={45} onPageChange={noop} onSizeChange={onSizeChange} />);

    const select = screen.getByLabelText('Показывать');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '10',
      '25',
      '50',
      '100',
    ]);

    fireEvent.change(select, { target: { value: '50' } });
    expect(onSizeChange).toHaveBeenCalledWith(50);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/Pagination.test.tsx`
Expected: FAIL — `Failed to resolve import "./Pagination"`.

- [ ] **Step 4: Implement**

Create `frontend/src/components/Pagination.tsx`:

```tsx
import styles from './Pagination.module.css';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The page buttons to show: every page when there are at most seven, otherwise
 * the first, the last, and the current page with its neighbours, with 'gap'
 * wherever pages are skipped.
 */
export function pageItems(page: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const items: Array<number | 'gap'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < count - 1) items.push('gap');
  items.push(count);
  return items;
}

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}

export function Pagination({ page, size, total, onPageChange, onSizeChange }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / size));

  return (
    <div className={styles.pagination}>
      <label className={styles.size}>
        Показывать
        <select
          aria-label="Показывать"
          className={styles.select}
          value={size}
          onChange={(event) => onSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <nav className={styles.pages} aria-label="Страницы">
        <button
          type="button"
          className={styles.step}
          aria-label="Предыдущая страница"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={item === page ? styles.current : styles.page}
              aria-current={item === page ? 'page' : undefined}
              aria-label={`Страница ${item}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={styles.step}
          aria-label="Следующая страница"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
      </nav>
    </div>
  );
}
```

Create `frontend/src/components/Pagination.module.css`:

```css
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text);
}

.select {
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--text-h);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
}

.pages {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.page,
.step {
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  min-width: 34px;
  height: 34px;
  padding: 0 8px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.page:hover,
.step:hover:not(:disabled) {
  color: var(--text-h);
  border-color: var(--accent-border);
}

.page:focus-visible,
.step:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 1px;
}

.step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.current {
  composes: page;
  color: var(--text-h);
  background: var(--accent-bg);
  border-color: var(--accent-border);
  cursor: default;
}

.gap {
  min-width: 20px;
  text-align: center;
  color: var(--text);
}

@media (prefers-reduced-motion: reduce) {
  .page,
  .step {
    transition: none;
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/Pagination.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Pagination.tsx frontend/src/components/Pagination.module.css frontend/src/components/Pagination.test.tsx
git commit -m "Page through a list with a choice of page size"
```

---

### Task 6: PostTable — every post with every metric

**Files:**
- Create: `frontend/src/components/PostTable.tsx`
- Create: `frontend/src/components/PostTable.module.css`
- Test: `frontend/src/components/PostTable.test.tsx`

**Interfaces:**
- Consumes: `PostItem` type from `./PostList` (existing); `formatCount`, `formatPercent` from `../format` (existing).
- Produces: `PostTable({ posts: PostItem[]; total: number; onOpen: (post: PostItem) => void })`.

- [ ] **Step 1: Invoke the taste skill**

This is a UI task. Invoke the taste skill before writing markup or CSS.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/PostTable.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostTable } from './PostTable';
import { formatPercent } from '../format';

const posts = [
  {
    id: 'p1', type: 'image', caption: 'Первый', publishedAt: '2026-06-30T15:50:00Z',
    thumbnailUrl: 'https://cdn/p1', permalink: 'https://t.me/c/1',
    views: 266, likes: 7, er: 0.4, erViews: 2.6,
  },
  {
    id: 'p2', type: 'post', caption: null, publishedAt: '2026-06-26T14:16:00Z',
    thumbnailUrl: null, permalink: 'https://t.me/c/2',
    views: null, likes: 0, er: null, erViews: null,
  },
];

const noop = () => {};
// getAllByRole('row')[0] is the header row.
const bodyRow = (index: number) => screen.getAllByRole('row')[index + 1];

describe('PostTable', () => {
  it('shows the total number of posts', () => {
    render(<PostTable posts={posts} total={37} onOpen={noop} />);
    expect(screen.getByText('Всего постов: 37')).toBeInTheDocument();
  });

  it('has a column for every metric', () => {
    render(<PostTable posts={posts} total={2} onOpen={noop} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Дата и время',
      'Пост',
      'Просмотры',
      'Реакции',
      'ERR',
      'ER',
    ]);
  });

  it("shows each post's date and time, text and metrics in its row", () => {
    render(<PostTable posts={posts} total={2} onOpen={noop} />);
    const cells = within(bodyRow(0)).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells).toEqual(['30.06.2026, 15:50', 'Первый', '266', '7', formatPercent(2.6), formatPercent(0.4)]);
  });

  it('shows a dash for unknown metrics and says when a post has no text', () => {
    render(<PostTable posts={posts} total={2} onOpen={noop} />);
    const row = within(bodyRow(1));
    expect(row.getByText('Без текста')).toBeInTheDocument();
    expect(row.getAllByText('—')).toHaveLength(3);
  });

  it('opens the post whose row is clicked, and focuses its button for the modal to return to', () => {
    const onOpen = vi.fn();
    render(<PostTable posts={posts} total={2} onOpen={onOpen} />);
    const row = within(bodyRow(0));

    fireEvent.click(row.getByText('266'));

    expect(onOpen).toHaveBeenCalledWith(posts[0]);
    expect(row.getByRole('button')).toHaveFocus();
  });

  it('opens the post exactly once when its button is activated', () => {
    const onOpen = vi.fn();
    render(<PostTable posts={posts} total={2} onOpen={onOpen} />);

    fireEvent.click(within(bodyRow(0)).getByRole('button'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('marks thumbnails decorative, since the text beside them is visible', () => {
    const { container } = render(<PostTable posts={posts} total={2} onOpen={noop} />);
    container.querySelectorAll('img').forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/PostTable.test.tsx`
Expected: FAIL — `Failed to resolve import "./PostTable"`.

- [ ] **Step 4: Implement**

Create `frontend/src/components/PostTable.tsx`:

```tsx
import styles from './PostTable.module.css';
import { formatCount, formatPercent } from '../format';
import type { PostItem } from './PostList';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

interface PostTableProps {
  posts: PostItem[];
  total: number;
  onOpen: (post: PostItem) => void;
}

export function PostTable({ posts, total, onOpen }: PostTableProps) {
  return (
    <div className={styles.wrap}>
      <p className={styles.total}>Всего постов: {formatCount(total)}</p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Дата и время</th>
              <th scope="col">Пост</th>
              <th scope="col" className={styles.num}>Просмотры</th>
              <th scope="col" className={styles.num}>Реакции</th>
              <th scope="col" className={styles.num}>ERR</th>
              <th scope="col" className={styles.num}>ER</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr
                key={post.id}
                className={styles.row}
                onClick={(event) => {
                  // Focus the row's button wherever the row was clicked, so the
                  // modal has somewhere to return focus to on close (and Safari,
                  // which does not focus a clicked <button>, behaves the same).
                  event.currentTarget.querySelector('button')?.focus();
                  onOpen(post);
                }}
              >
                <td className={styles.date}>
                  <time dateTime={post.publishedAt}>{dateTimeFormat.format(new Date(post.publishedAt))}</time>
                </td>
                <td>
                  {/* The keyboard and screen-reader handle for the row. It has no
                      handler of its own: its click bubbles to the row, so onOpen
                      runs once. */}
                  <button type="button" className={styles.post}>
                    {post.thumbnailUrl && <img className={styles.thumb} src={post.thumbnailUrl} alt="" />}
                    <span className={styles.caption}>{post.caption ?? 'Без текста'}</span>
                  </button>
                </td>
                <td className={styles.num}>{formatCount(post.views)}</td>
                <td className={styles.num}>{formatCount(post.likes)}</td>
                <td className={styles.num}>{formatPercent(post.erViews)}</td>
                <td className={styles.num}>{formatPercent(post.er)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/PostTable.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.total {
  font-size: 14px;
  color: var(--text);
}

/* The table scrolls sideways on its own; the page body never does. */
.scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 14px;
}

.table th {
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--code-bg);
  white-space: nowrap;
}

.table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.table tbody tr:last-child td {
  border-bottom: none;
}

.row {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.row:hover {
  background: var(--accent-bg);
}

.date {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.num {
  text-align: right;
  white-space: nowrap;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-h);
}

.table th.num {
  font-family: inherit;
  color: var(--text);
}

.post {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 0;
  font: inherit;
  text-align: left;
  color: var(--text-h);
  background: none;
  border: none;
  cursor: pointer;
}

.post:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 2px;
  border-radius: 4px;
}

.thumb {
  flex: none;
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--code-bg);
}

.caption {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .row {
    transition: none;
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/PostTable.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PostTable.tsx frontend/src/components/PostTable.module.css frontend/src/components/PostTable.test.tsx
git commit -m "Show every post with every metric in a table"
```

---

### Task 7: useApiGet — fetching that ignores stale responses

The page now makes three kinds of request (detail, top 10, table page), each needing the "only the latest response may write state" guard the page currently hand-writes once. One hook carries it.

**Files:**
- Create: `frontend/src/api/useApiGet.ts`
- Test: `frontend/src/api/useApiGet.test.tsx`

**Interfaces:**
- Consumes: `apiClient` from `./client` (existing).
- Produces: `useApiGet<T>(url: string, params: Record<string, string | number | undefined>, options?: { enabled?: boolean; reloadKey?: number }): { data: T | null; error: unknown; pending: boolean }`. Params with value `undefined` are not sent.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/useApiGet.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useApiGet } from './useApiGet';
import { apiClient } from './client';

vi.mock('./client', () => ({ apiClient: { get: vi.fn() } }));

const get = apiClient.get as any;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => get.mockReset());

describe('useApiGet', () => {
  it('fetches with the given params and exposes the data', async () => {
    get.mockResolvedValue({ data: { ok: 1 } });

    const { result } = renderHook(() => useApiGet('/x', { page: 2 }));

    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
    expect(get).toHaveBeenCalledWith('/x', { params: { page: 2 } });
    expect(result.current.pending).toBe(false);
  });

  it('does not send params whose value is undefined', async () => {
    get.mockResolvedValue({ data: 1 });
    renderHook(() => useApiGet('/x', { page: 1, type: undefined }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/x', { params: { page: 1 } }));
  });

  it('ignores a slow response once newer params have been requested', async () => {
    const slow = deferred<any>();
    const fast = deferred<any>();
    get.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const { result, rerender } = renderHook(({ page }) => useApiGet('/x', { page }), {
      initialProps: { page: 1 },
    });
    rerender({ page: 2 });

    fast.resolve({ data: 'page 2' });
    await waitFor(() => expect(result.current.data).toBe('page 2'));

    slow.resolve({ data: 'page 1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.data).toBe('page 2');
  });

  it('does not refetch when the params are equal but a new object', async () => {
    get.mockResolvedValue({ data: 1 });

    const { rerender } = renderHook(() => useApiGet('/x', { page: 1 }));
    rerender();
    rerender();

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });

  it('fetches nothing while disabled', () => {
    renderHook(() => useApiGet('/x', {}, { enabled: false }));
    expect(get).not.toHaveBeenCalled();
  });

  it('refetches when reloadKey changes', async () => {
    get.mockResolvedValue({ data: 1 });

    const { rerender } = renderHook(({ key }) => useApiGet('/x', {}, { reloadKey: key }), {
      initialProps: { key: 0 },
    });
    rerender({ key: 1 });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('exposes an error and stops pending', async () => {
    get.mockRejectedValue({ response: { status: 500 } });

    const { result } = renderHook(() => useApiGet('/x', {}));

    await waitFor(() => expect(result.current.error).toEqual({ response: { status: 500 } }));
    expect(result.current.pending).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/api/useApiGet.test.tsx`
Expected: FAIL — `Failed to resolve import "./useApiGet"`.

- [ ] **Step 3: Implement**

Create `frontend/src/api/useApiGet.ts`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { apiClient } from './client';

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  pending: boolean;
}

/**
 * GETs `url` with `params` whenever either changes or `reloadKey` is bumped.
 * Only the most recent request may write state, so a slow response for
 * parameters the user has already moved away from cannot overwrite a newer one.
 * Earlier data stays in place while a new request is pending, so a page can show
 * it as stale instead of blanking.
 */
export function useApiGet<T>(
  url: string,
  params: Record<string, string | number | undefined>,
  { enabled = true, reloadKey = 0 }: { enabled?: boolean; reloadKey?: number } = {},
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, pending: enabled });
  const latest = useRef(0);
  // Params arrive as a new object every render, so compare them by value. JSON
  // also drops keys whose value is undefined, so those are never sent.
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!enabled) return;
    const request = ++latest.current;
    setState((current) => ({ ...current, pending: true }));
    apiClient
      .get(url, { params: JSON.parse(paramsKey) })
      .then((res) => {
        if (request === latest.current) setState({ data: res.data as T, error: null, pending: false });
      })
      .catch((error: unknown) => {
        if (request === latest.current) setState((current) => ({ ...current, error, pending: false }));
      });
  }, [url, paramsKey, enabled, reloadKey]);

  return state;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/api/useApiGet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/useApiGet.ts frontend/src/api/useApiGet.test.tsx
git commit -m "Fetch in one hook that ignores stale responses"
```

---

### Task 8: Wire the account page

The page switches to the new picker, shows the top 10 from the server, reveals the table on request, and explains where data begins. `PostList` stops sorting — the server already has.

**Files:**
- Modify: `frontend/src/components/PostList.tsx`
- Rewrite: `frontend/src/components/PostList.test.tsx`
- Rewrite: `frontend/src/pages/AccountDetailPage.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.module.css`
- Rewrite: `frontend/src/pages/AccountDetailPage.test.tsx`
- Modify: `frontend/src/components/PostSortSelect.module.css` (comment only)
- Delete: `frontend/src/components/PeriodSelector.tsx`, `PeriodSelector.module.css`, `PeriodSelector.test.tsx` (the account page is their only user — checked)

**Interfaces:**
- Consumes: `GET /accounts/:id/detail` shape from Task 2, `GET /accounts/:id/posts` from Task 1, `selectPreset`/`formatIsoDate`/`SelectedPeriod` (Task 3), `PeriodPicker` (Task 4), `Pagination` (Task 5), `PostTable` (Task 6), `useApiGet` (Task 7).
- Produces: `PostList({ posts: PostItem[]; onOpen: (post: PostItem) => void })` — no `sort` prop. `PostItem` and `PostSort` stay exported from `PostList.tsx`.

- [ ] **Step 1: Invoke the taste skill**

This is a UI task. Invoke the taste skill before writing markup or CSS.

- [ ] **Step 2: Write the failing PostList test**

Replace the whole of `frontend/src/components/PostList.test.tsx` with:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostList } from './PostList';
import { formatPercent } from '../format';

const posts = [
  { id: 'p1', type: 'image', caption: 'Первый', publishedAt: '2026-09-01T10:00:00Z', thumbnailUrl: 'https://cdn/p1', permalink: 'https://t.me/c/1', views: 100, likes: 10, er: 1, erViews: 10 },
  { id: 'p2', type: 'video', caption: 'Второй', publishedAt: '2026-09-02T10:00:00Z', thumbnailUrl: 'https://cdn/p2', permalink: 'https://t.me/c/2', views: 900, likes: 9, er: 0.9, erViews: 1 },
];

describe('PostList', () => {
  it('shows the snippet, image and metrics for each post', () => {
    render(<PostList posts={posts} onOpen={() => {}} />);
    const firstCard = screen.getByText('Первый').closest('button')!;
    expect(firstCard.querySelector('img')).toHaveAttribute('src', 'https://cdn/p1');
    expect(screen.getByText('900')).toBeInTheDocument();
  });

  it('marks each post image decorative, since its caption is already shown as visible text', () => {
    const { container } = render(<PostList posts={posts} onOpen={() => {}} />);
    const images = container.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });

  // The server sorts. A second, client-side sort would be a second source of truth
  // about the order — and could only ever agree with the first or contradict it.
  it('renders posts in the order given', () => {
    const { rerender } = render(<PostList posts={posts} onOpen={() => {}} />);
    expect(within(screen.getAllByRole('listitem')[0]).getByText('Первый')).toBeInTheDocument();

    rerender(<PostList posts={[...posts].reverse()} onOpen={() => {}} />);
    expect(within(screen.getAllByRole('listitem')[0]).getByText('Второй')).toBeInTheDocument();
  });

  it('opens the post that was clicked', () => {
    const onOpen = vi.fn();
    render(<PostList posts={posts} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Первый'));
    expect(onOpen).toHaveBeenCalledWith(posts[0]);
  });

  it('focuses the card that was clicked, so the modal can return focus to it on close', () => {
    render(<PostList posts={posts} onOpen={() => {}} />);
    const card = screen.getByText('Первый').closest('button')!;
    fireEvent.click(card);
    expect(card).toHaveFocus();
  });

  it('shows ER against views (erViews), not ER against followers (er), on each card', () => {
    render(<PostList posts={posts} onOpen={() => {}} />);
    const p1 = within(screen.getAllByRole('listitem')[0]);
    expect(p1.getByText(formatPercent(posts[0].erViews))).toBeInTheDocument();
    expect(p1.queryByText(formatPercent(posts[0].er))).not.toBeInTheDocument();
  });

  it('explains an empty list instead of showing nothing', () => {
    render(<PostList posts={[]} onOpen={() => {}} />);
    expect(screen.getByText(/Постов за этот период нет/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx tsc -b`
Expected: FAIL — `Property 'sort' is missing in type '{ posts: …; onOpen: …; }'` in `PostList.test.tsx`.

The failure is at type level, not at runtime, on purpose: Vitest does not type-check, and the old `PostList` given no `sort` calls `[...posts].sort(undefined)`, which is the default sort and happens to keep equal elements in order, so the runtime tests would already pass. The contract being changed is the prop, and `tsc` is what enforces props.

- [ ] **Step 4: Remove sorting from PostList**

In `frontend/src/components/PostList.tsx`:
- delete the whole `COMPARATORS` constant;
- change `PostListProps` to:

```tsx
interface PostListProps {
  posts: PostItem[];
  onOpen: (post: PostItem) => void;
}
```

- replace the function's opening down to the `return` with:

```tsx
/** Renders posts in the order given: the server sorts, so there is one ordering, not two. */
export function PostList({ posts, onOpen }: PostListProps) {
  if (posts.length === 0) {
    return <p className={styles.empty}>Постов за этот период нет.</p>;
  }

  return (
    <ul className={styles.list}>
      {posts.map((post) => (
```

(The rest of the JSX is unchanged; it previously mapped over `sorted`.) Keep `export type PostSort = 'views' | 'reactions' | 'er' | 'date';` — `PostSortSelect` and the page import it.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/PostList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the failing page test**

Replace the whole of `frontend/src/pages/AccountDetailPage.test.tsx` with:

```tsx
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccountDetailPage } from './AccountDetailPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const get = apiClient.get as any;

/** Matches a formatted number regardless of which kind of space separates the thousands. */
const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

const summary = {
  followersCount: 1000, postsCount: 2,
  totalViews: 4000, totalReactions: 200,
  avgViews: 2000, avgReactions: 100,
  erViews: 5, erFollowers: 10,
};

function detail(coverage = { postsFrom: '2026-06-12', followersFrom: '2026-06-12' }) {
  return {
    account: { id: 'acc-1', name: 'Chan' },
    latestSnapshot: { followersCount: 1000, avgEr: null },
    trend: [],
    summary,
    coverage,
  };
}

function post(id: string, caption: string) {
  return {
    id, type: 'post', caption, publishedAt: '2026-09-01T10:00:00Z',
    thumbnailUrl: null, permalink: `https://t.me/c/${id}`,
    views: 100, likes: 5, er: 0.5, erViews: 5,
  };
}

type Params = Record<string, unknown>;

function mockApi({
  detailData = detail(),
  posts = (_params: Params) => ({ total: 2, items: [post('p1', 'Hello'), post('p2', 'World')] }),
}: { detailData?: object; posts?: (params: Params) => object } = {}) {
  get.mockImplementation((url: string, config?: { params: Params }) => {
    if (url.endsWith('/detail')) return Promise.resolve({ data: detailData });
    if (url.endsWith('/posts')) return Promise.resolve({ data: posts(config!.params) });
    return Promise.resolve({ data: [] });
  });
}

const callsTo = (suffix: string): Params[] =>
  get.mock.calls
    .filter(([url]: [string]) => url.endsWith(suffix))
    .map(([, config]: [string, { params: Params }]) => config.params);

const lastCallTo = (suffix: string) => callsTo(suffix).at(-1)!;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounts/acc-1']}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset();
  // Only Date is faked, so promises and React's scheduling run normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountDetailPage', () => {
  it('asks for the last 30 days and the top 10 by views by default', async () => {
    mockApi();
    renderPage();

    await screen.findByText('Chan');
    expect(lastCallTo('/detail')).toEqual({ from: '2026-08-13', to: '2026-09-11' });
    expect(lastCallTo('/posts')).toEqual({ from: '2026-08-13', to: '2026-09-11', sort: 'views', page: 1, size: 10 });
  });

  it('shows the top posts in the order the server sends them', async () => {
    mockApi({ posts: () => ({ total: 2, items: [post('p2', 'World'), post('p1', 'Hello')] }) });
    renderPage();

    await screen.findByText('World');
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('World')).toBeInTheDocument();
    expect(within(items[1]).getByText('Hello')).toBeInTheDocument();
  });

  it('shows totals and averages in Russian', async () => {
    mockApi();
    const { container } = renderPage();

    // Scoped to the stat tiles' <dl>: the sort control also has a "Просмотры" button.
    await waitFor(() => expect(container.querySelector('dl')).toBeInTheDocument());
    const tiles = within(container.querySelector('dl')!);
    expect(tiles.getByText('Просмотры')).toBeInTheDocument();
    expect(tiles.getByText('Средние просмотры')).toBeInTheDocument();
    expect(tiles.getByText(digits('4000'))).toBeInTheDocument();
  });

  it('refetches the summary and the top posts for a chosen preset', async () => {
    mockApi();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Прошлый месяц' }));

    await waitFor(() => expect(lastCallTo('/detail')).toEqual({ from: '2026-08-01', to: '2026-08-31' }));
    expect(lastCallTo('/posts')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('ranks the top posts by the chosen sort', async () => {
    mockApi();
    renderPage();

    const sortGroup = await screen.findByRole('group', { name: 'Сортировка' });
    fireEvent.click(within(sortGroup).getByRole('button', { name: 'Реакции' }));

    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ sort: 'reactions', page: 1, size: 10 }));
  });

  it('filters by post type on the server, and sends no type for «Все»', async () => {
    mockApi();
    renderPage();

    await screen.findByText('Hello');
    expect(lastCallTo('/posts')).not.toHaveProperty('type');

    fireEvent.change(screen.getByLabelText('Тип поста'), { target: { value: 'video' } });

    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ type: 'video' }));
  });

  it('keeps the full list behind a button that shows the total, and loads it only when opened', async () => {
    mockApi({ posts: () => ({ total: 37, items: [post('p1', 'Hello')] }) });
    renderPage();

    const reveal = await screen.findByRole('button', { name: 'Показать все посты (37)' });
    expect(callsTo('/posts')).toHaveLength(1);
    expect(screen.queryByText('Всего постов: 37')).not.toBeInTheDocument();

    fireEvent.click(reveal);

    expect(await screen.findByText('Всего постов: 37')).toBeInTheDocument();
    expect(callsTo('/posts')).toHaveLength(2);
    expect(reveal).toHaveTextContent('Скрыть список');

    fireEvent.click(reveal);
    expect(screen.queryByText('Всего постов: 37')).not.toBeInTheDocument();
  });

  it('pages through the full list and goes back to page 1 when what it holds changes', async () => {
    mockApi({ posts: () => ({ total: 37, items: [post('p1', 'Hello')] }) });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Показать все посты (37)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Страница 2' }));
    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ page: 2, size: 10 }));

    fireEvent.change(screen.getByLabelText('Показывать'), { target: { value: '25' } });
    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ page: 1, size: 25 }));

    fireEvent.click(screen.getByRole('button', { name: 'Страница 2' }));
    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ page: 2, size: 25 }));

    const sortGroup = screen.getByRole('group', { name: 'Сортировка' });
    fireEvent.click(within(sortGroup).getByRole('button', { name: 'ERR' }));

    await waitFor(() => {
      const tableCalls = callsTo('/posts').filter((params) => params.size === 25);
      expect(tableCalls.at(-1)).toMatchObject({ page: 1, sort: 'er' });
    });
  });

  it('explains where the data begins when the period reaches back further', async () => {
    mockApi({ detailData: detail({ postsFrom: '2026-08-20', followersFrom: '2026-09-10' }) });
    renderPage();

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Посты собраны с 20.08.2026, подписчики — с 10.09.2026. Более ранние данные недоступны.',
    );
  });

  it('says nothing about coverage when the period is within the collected data', async () => {
    mockApi({ detailData: detail({ postsFrom: '2026-06-12', followersFrom: '2026-06-12' }) });
    renderPage();

    await screen.findByText('Chan');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says so when the period has no posts, and offers no full list', async () => {
    mockApi({ posts: () => ({ total: 0, items: [] }) });
    renderPage();

    expect(await screen.findByText('Постов за этот период нет.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Показать все посты/ })).not.toBeInTheDocument();
  });

  it('shows an error instead of hanging on the spinner when the account cannot be loaded', async () => {
    get.mockRejectedValue({ response: { status: 500 } });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить данные аккаунта'));
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument();
  });

  it('says the account was not found when the server returns a 404', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Аккаунт не найден'));
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/AccountDetailPage.test.tsx`
Expected: FAIL — among others, `'asks for the last 30 days and the top 10 by views by default'` finds no `/posts` call.

- [ ] **Step 8: Rewrite the page**

Replace the whole of `frontend/src/pages/AccountDetailPage.tsx` with:

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApiGet } from '../api/useApiGet';
import { Pagination } from '../components/Pagination';
import { PeriodPicker } from '../components/PeriodPicker';
import { PostList, type PostItem, type PostSort } from '../components/PostList';
import { PostModal } from '../components/PostModal';
import { PostSortSelect } from '../components/PostSortSelect';
import { PostTable } from '../components/PostTable';
import { PostTypeFilter } from '../components/PostTypeFilter';
import { RefreshButton } from '../components/RefreshButton';
import { StatTiles, type AccountSummary } from '../components/StatTiles';
import { TrendChart } from '../components/TrendChart';
import { formatCount } from '../format';
import { formatIsoDate, selectPreset, type SelectedPeriod } from '../periods';
import styles from './AccountDetailPage.module.css';

const TOP_COUNT = 10;

interface DetailData {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  trend: Array<{ date: string; followersCount: number }>;
  summary: AccountSummary;
  /** Where collected data begins; earlier periods are shown as far as it reaches. */
  coverage: { postsFrom: string; followersFrom: string };
}

interface PostsPage {
  total: number;
  items: PostItem[];
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<SelectedPeriod>(() => selectPreset('last30', new Date()));
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState<PostSort>('views');
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableSize, setTableSize] = useState(10);
  const [openPost, setOpenPost] = useState<PostItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const range = { from: period.from, to: period.to };
  const postFilter = { ...range, sort, type: typeFilter === 'all' ? undefined : typeFilter };

  const detail = useApiGet<DetailData>(`/accounts/${id}/detail`, range, { reloadKey });
  const top = useApiGet<PostsPage>(
    `/accounts/${id}/posts`,
    { ...postFilter, page: 1, size: TOP_COUNT },
    { reloadKey },
  );
  const table = useApiGet<PostsPage>(
    `/accounts/${id}/posts`,
    { ...postFilter, page: tablePage, size: tableSize },
    { enabled: tableOpen, reloadKey },
  );

  // Anything that changes which posts the table holds sends it back to page 1.
  const changePeriod = (next: SelectedPeriod) => {
    setPeriod(next);
    setTablePage(1);
  };
  const changeType = (next: string) => {
    setTypeFilter(next);
    setTablePage(1);
  };
  const changeSort = (next: PostSort) => {
    setSort(next);
    setTablePage(1);
  };
  const changeSize = (next: number) => {
    setTableSize(next);
    setTablePage(1);
  };

  if (detail.error) {
    const status = (detail.error as { response?: { status?: number } }).response?.status;
    return (
      <p className={styles.error} role="alert">
        {status === 404 ? 'Аккаунт не найден' : 'Не удалось загрузить данные аккаунта'}
      </p>
    );
  }

  if (!detail.data) return <p className={styles.loading}>Загрузка…</p>;

  const { account, trend, summary, coverage } = detail.data;
  const showCoverage = period.from < coverage.postsFrom || period.from < coverage.followersFrom;
  const total = top.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>{account.name}</h2>
        <RefreshButton accountId={account.id} onSynced={() => setReloadKey((key) => key + 1)} />
      </div>
      <section className={styles.overview} aria-label="Сводка за период">
        <PeriodPicker value={period} onChange={changePeriod} />
        {showCoverage && (
          <p className={styles.coverage} role="note">
            Посты собраны с {formatIsoDate(coverage.postsFrom)}, подписчики — с{' '}
            {formatIsoDate(coverage.followersFrom)}. Более ранние данные недоступны.
          </p>
        )}
        <div className={styles.tilesRegion} aria-busy={detail.pending}>
          <StatTiles summary={summary} />
        </div>
      </section>
      <TrendChart
        series={[
          {
            label: account.name,
            data: trend.map((s) => ({ date: s.date, value: s.followersCount })),
          },
        ]}
      />
      <section className={styles.posts} aria-labelledby="top-posts-heading">
        <div className={styles.postsHeader}>
          <h3 id="top-posts-heading" className={styles.subheading}>
            Топ-10 постов
          </h3>
          <div className={styles.toolbar}>
            <PostTypeFilter value={typeFilter} onChange={changeType} />
            <PostSortSelect value={sort} onChange={changeSort} />
          </div>
        </div>
        {top.error ? (
          <p className={styles.error} role="alert">
            Не удалось загрузить посты
          </p>
        ) : top.data ? (
          <div className={styles.postsRegion} aria-busy={top.pending}>
            <PostList posts={top.data.items} onOpen={setOpenPost} />
          </div>
        ) : (
          <p className={styles.loading}>Загрузка…</p>
        )}
        {(total > 0 || tableOpen) && (
          <button
            type="button"
            className={styles.reveal}
            aria-expanded={tableOpen}
            onClick={() => setTableOpen((open) => !open)}
          >
            {tableOpen ? 'Скрыть список' : `Показать все посты (${formatCount(total)})`}
          </button>
        )}
      </section>
      {tableOpen && (
        <section className={styles.posts} aria-label="Все посты">
          {table.error ? (
            <p className={styles.error} role="alert">
              Не удалось загрузить посты
            </p>
          ) : table.data ? (
            <div className={styles.postsRegion} aria-busy={table.pending}>
              <PostTable posts={table.data.items} total={table.data.total} onOpen={setOpenPost} />
              <Pagination
                page={tablePage}
                size={tableSize}
                total={table.data.total}
                onPageChange={setTablePage}
                onSizeChange={changeSize}
              />
            </div>
          ) : (
            <p className={styles.loading}>Загрузка…</p>
          )}
        </section>
      )}
      <PostModal post={openPost} onClose={() => setOpenPost(null)} />
    </div>
  );
}
```

Append to `frontend/src/pages/AccountDetailPage.module.css`:

```css
.coverage {
  font-size: 14px;
  color: var(--text);
  padding: 8px 12px;
  border-left: 3px solid var(--accent-border);
  background: var(--code-bg);
  border-radius: 0 6px 6px 0;
}

.posts {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.postsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.subheading {
  margin: 0;
  font-family: var(--heading);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-h);
}

.postsRegion {
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: opacity 0.2s ease;
}

/* While a new page or sort loads, the old rows stay in place but read as stale. */
.postsRegion[aria-busy='true'] {
  opacity: 0.55;
}

.reveal {
  align-self: flex-start;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-h);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 16px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.reveal:hover {
  border-color: var(--accent-border);
}

.reveal:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .postsRegion,
  .reveal {
    transition: none;
  }
}
```

(The existing `.toolbar` class stays and is now used inside `.postsHeader`.)

In `frontend/src/components/PostSortSelect.module.css`, change `PeriodSelector.module.css` in the top comment to `PeriodPicker.module.css`.

- [ ] **Step 9: Delete PeriodSelector**

```bash
git rm frontend/src/components/PeriodSelector.tsx frontend/src/components/PeriodSelector.module.css frontend/src/components/PeriodSelector.test.tsx
```

- [ ] **Step 10: Run the page test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/AccountDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 11: Run the whole frontend suite, the build and the linter**

Run: `cd frontend && npm test`
Expected: PASS, every file.

Run: `cd frontend && npm run build`
Expected: `tsc -b` reports nothing and `vite build` finishes.

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src
git commit -m "Show the top 10 posts for a chosen period, with the full list on request"
```

---

### Task 9: Final verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Backend suite and build type-check**

Run: `cd backend && npx jest`
Expected: PASS, every suite.

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no output.

- [ ] **Step 2: Frontend suite, build and lint**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 3: Check nothing references the removed pieces**

Run: `grep -rn "PeriodSelector\|top-posts\|getTopPosts\|TopPostsFilterDto" backend/src frontend/src`
Expected: no output.

- [ ] **Step 4: Check the spec's testing list against the tests**

Walk the spec's section 7 and confirm each line has a test: sort keys and nulls last, tie-break, total and slicing, a page past the end, the four 400s, type filter, SQL summary, coverage (with and without snapshots), every preset boundary, calendar apply-only-on-«Применить», top 10 capped and following the sort, reveal button, paging and reset to page 1, coverage note shown only when needed. A page past the end is covered by SQL semantics (`OFFSET` beyond the rows returns none, and `getManyAndCount` still counts the whole set); no mock can prove that, so it is left to the live check below.

- [ ] **Step 5: Hand over for deploy**

Nothing needs a migration. The redeploy is the runbook's usual `git pull` + `docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`, after this branch is merged into `master` and pushed. After deploying, check on the live site: a preset changes the tiles and the top 10; «Показать все посты (N)» opens the table; paging past the last page is impossible from the UI; the coverage note appears on «Прошлый год».
