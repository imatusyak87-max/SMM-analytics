# Post Summary and Period Picker Design

**Status:** Approved for planning
**Related:** [Telegram Post Analytics Design](2026-09-09-telegram-post-analytics-design.md)

## 1. Purpose

Make an account's page summarise its posts instead of listing all of them: show
the top 10 posts for a chosen period, and reveal the full list — every post with
every metric, paged 10 at a time or more, with the total count — only when the
user asks for it.

The period is chosen from preset buttons for common ranges or from a calendar,
and it drives the whole page.

## 2. Decisions made with the user

| Decision | Choice |
|---|---|
| What ranks the top 10 | The existing sort control (Просмотры / Реакции / ERR / Дата), default Просмотры. One control governs the top 10 and the full list |
| Presets | Последние 7 дней, Последние 30 дней, Этот месяц, Прошлый месяц, Текущий квартал, Прошлый квартал, Текущий год, Прошлый год |
| What the period controls | The whole page: tiles, trend chart, top 10 and full list |
| Full list format | Table, one row per post |
| Paging | Page numbers plus a page-size picker (10 / 25 / 50 / 100) and «Всего постов: N» |
| Periods older than collected data | Show what has been collected, with a note saying from when |
| Calendar | react-day-picker |
| Where paging and sorting happen | Server-side |

Defaults not separately asked, stated here so they are not re-decided: the
default period is «Последние 30 дней»; the top 10 reuses the existing post cards;
clicking a table row opens the existing post modal.

## 3. Why server-side

The year presets change the scale the previous design was built for. That design
returned every post in the period and sorted in the browser, which was right for
a 7/30/90-day selector over a 90-day scrape window. A year-long period over a
channel whose stored posts keep accumulating could mean thousands of rows in one
response. A paged endpoint keeps each response to one page however much history
piles up, at the cost of one small request per page or sort change.

## 4. The data-depth limit

The first sync scrapes 90 days back and later syncs keep that window, so stored
posts reach back to 90 days before the account was added and accumulate from
there — they are upserted, never deleted. Follower history cannot be backfilled
from any source: Telegram only ever reports today's subscriber count, so follower
data starts on the day the account was added.

So «Прошлый год» today shows few or no posts and no follower trend. The page says
so instead of rendering what reads like a dead channel (see 6.2).

## 5. API

### 5.1 `GET /accounts/:id/detail?from&to`

Keeps `account`, `latestSnapshot`, `trend` and `summary`.

- **Drops the `posts` array.** Posts now come from 5.2.
- **`summary` is computed by a SQL aggregate** (sum of views, sum of likes, post
  count over the period), no longer summed in JS. The previous design summed in JS
  only because the rows were already loaded for the browser to sort; they no
  longer are, so loading them just to sum would be the very defect the 2026-09-09
  review flagged in `getTopPosts`. Field names and meanings are unchanged,
  including the weighted `erViews = totalReactions / totalViews`.
- **The summary ignores the type filter**, as today: tiles describe every post in
  the period, and the type filter narrows only the top 10 and the table.
- **Gains `coverage: { postsFrom, followersFrom }`**, both `YYYY-MM-DD`:
  - `postsFrom` = the account's `createdAt` minus 90 days. This is where the
    scrape reached, which is not the same as the oldest stored post — a quiet
    channel's oldest post can be much later than where collection began.
  - `followersFrom` = the date of the account's earliest snapshot, or its
    `createdAt` date if it has none yet.

### 5.2 `GET /accounts/:id/posts?from&to&type&sort&page&size`

New. Returns `{ total, items }`, where `items` carries the same per-post fields the
`posts` array did: `id`, `type`, `publishedAt`, `caption`, `thumbnailUrl`,
`permalink`, `views`, `likes`, `er`, `erViews`.

| Param | Values | Default |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD`, inclusive; `to` extends to the end of its UTC day as today | required |
| `type` | a `PostType` | all types |
| `sort` | `views`, `reactions`, `er`, `date` — always descending | `views` |
| `page` | integer ≥ 1 | 1 |
| `size` | 10, 25, 50 or 100 | 10 |

- Any other `size` or `sort`, or a `page` below 1, is a 400, following the
  existing DTO pattern (`class-validator`, `@Type(() => Number)`).
- `reactions` sorts on `likes`, `er` on `erViews` — the names the UI shows, mapped
  to the columns once, in the service.
- Nulls sort last (`NULLS LAST`): a post with unknown views must not top a
  views-descending list.
- **Ties are broken by `publishedAt DESC`, then `id`.** Without a total order,
  offset paging can show a post on two pages and skip another.
- Sorting, `LIMIT`/`OFFSET` and the count happen in SQL (`getManyAndCount`).
- A `page` past the end returns `{ total, items: [] }`, not an error.

The top 10 is this endpoint at `page=1&size=10`. There is no separate top-10 code.

### 5.3 Removed

`GET /accounts/:id/top-posts`, `StatsService.getTopPosts` and `TopPostsFilterDto`.
Nothing in the frontend calls the endpoint, and 5.2 supersedes it. This also closes
the backlog item that it loaded every row only to sort in JS.

### 5.4 No schema change

No migration and no new index. Posts per account run to hundreds or low thousands,
and filtering by `accountId` already uses the existing `(accountId,
externalPostId)` unique index's leading column.

## 6. UI

Russian copy throughout. Built with the taste skill, like the previous feature.

### 6.1 Page order

1. Header: account name and Обновить (unchanged).
2. Period bar (6.2).
3. Coverage note, only when needed (6.3).
4. Stat tiles, then trend chart (unchanged components, fed by the new period).
5. «Топ-10 постов»: toolbar with type filter and sort, then the existing post
   cards, at most 10.
6. Button «Показать все посты (N)», where N is the filtered total. Pressing it
   reveals the table (6.4) below and relabels itself «Скрыть список».

### 6.2 Period bar — `PeriodPicker`

Replaces `PeriodSelector`.

- **Preset buttons**, in this order: Последние 7 дней, Последние 30 дней, Этот
  месяц, Прошлый месяц, Текущий квартал, Прошлый квартал, Текущий год, Прошлый год.
- **Preset ranges**, computed from the user's local date:
  - «Последние N дней»: today minus N−1 days through today (N days inclusive).
  - «Этот месяц» / «Текущий квартал» / «Текущий год»: first day of the current
    month / quarter / year through **today**, not through the end of the period.
  - «Прошлый месяц» / «Прошлый квартал» / «Прошлый год»: the whole previous month
    / quarter / year.
  - Quarters are calendar quarters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.
- **Calendar button**, labelled with the current range (`01.07.2026 – 31.07.2026`).
  It opens a popover holding react-day-picker in range mode: two months side by
  side (one on narrow screens), Russian locale, Monday first, future dates
  disabled. The range is applied only on «Применить», so picking a start date does
  not refetch the page with a half-chosen range. Escape or an outside click closes
  it without applying.
- **Active state:** the matching preset is highlighted; a custom range highlights
  the calendar button instead.
- The preset-to-range logic is a pure function in its own module,
  `presetRange(preset, today)`, so every boundary can be tested without rendering.

### 6.3 Coverage note

Shown when the chosen `from` is earlier than `coverage.postsFrom` or
`coverage.followersFrom`; hidden otherwise:

> Посты собраны с 12.06.2026, подписчики — с 10.09.2026. Более ранние данные
> недоступны.

### 6.4 Full list — `PostTable`

- Header line: «Всего постов: N».
- Columns: Дата и время · Пост (thumbnail and one clamped line of text) ·
  Просмотры · Реакции · ERR · ER.
- Clicking a row opens the existing `PostModal`.
- Footer — `Pagination`: «Показывать» select (10 / 25 / 50 / 100) and page
  controls `‹ 1 2 3 … ›`.
- The table uses the same sort and type filter as the top 10.
- **Changing the sort, type filter, period or page size resets to page 1.**
- On narrow screens the table sits in its own horizontal-scroll container; the
  page body never scrolls sideways.

### 6.5 Requests

- Tiles, trend and coverage: `detail`, refetched when the period changes.
- Top 10: `posts?page=1&size=10`, refetched when the period, sort or type changes.
- Table: `posts` at its own page and size, fetched only while the table is open.
- Each of the three keeps the page's existing guard: only the latest request may
  write state, so a slow response for a period the user has already left cannot
  overwrite a newer one.

### 6.6 Empty states

«Постов за этот период нет.» in place of the top 10 when the total is 0, and the
reveal button is hidden.

## 7. Testing

**Backend**

- Each sort key orders correctly; posts with null views/ERR land last.
- Tie-break is stable: equal sort values page without duplicates or gaps.
- `total` counts the whole filtered set; `page`/`size` give the right slice; a page
  past the end is empty, not an error.
- `size=7`, `size=500`, `sort=foo`, `page=0` are 400s.
- The type filter narrows both `items` and `total`.
- The SQL summary gives the same results as today's JS summary, reusing its
  existing test cases, including the empty-period case.
- `coverage` dates, including an account with no snapshots.

**Frontend**

- `presetRange` for every preset, including January (previous month is December of
  last year), each quarter boundary, «Прошлый квартал» from Q1, and a leap-year
  February.
- Choosing a preset or applying a calendar range sends the matching `from`/`to`.
- Picking a start date without «Применить» sends nothing.
- The top 10 shows at most 10 cards and follows the sort.
- The reveal button shows the total, opens and closes the table.
- Paging requests the right page; changing sort, filter, period or size goes back
  to page 1.
- The coverage note appears only when the period starts before the data.

## 8. Rollout

- One new frontend dependency: `react-day-picker@10`, which brings `date-fns` with
  it.
- No migration: deploying is `git pull` plus a rebuild.

## 9. Out of scope

- **Day boundaries in Moscow time.** Periods are UTC days, as today, so a post
  published between 00:00 and 03:00 MSK counts toward the previous day. Existing
  behaviour, not introduced here.
- Sorting by clicking table column headers — the sort control already does this.
- Export (CSV, PDF).
- Backfilling posts deeper than 90 days before an account was added.
