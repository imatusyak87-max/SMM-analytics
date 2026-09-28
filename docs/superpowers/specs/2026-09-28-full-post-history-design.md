# Full post history («Загрузить все посты») — design

Date: 2026-09-28. Status: approved in chat, awaiting written-spec review.

## 1. Goal

Let the user load an account's entire post history on demand, for both
Instagram and Telegram, instead of only the last 90 days the nightly sync
collects. Trigger: a button on the account page. Motivation: the user's own
Instagram account shows zero posts because its latest post (May 2026) is
older than the 90-day window.

## 2. Decisions made with the user

| Question | Decision |
|---|---|
| How is a full load started? | A button on the account page, per account. Not automatic on connect. |
| Telegram too? | Yes — same button, every account page, including competitor channels. |
| Raise the 90-day nightly window instead? | No. The nightly sync keeps `POST_HISTORY_DAYS = 90`. |
| Are old posts' numbers refreshed later? | No — frozen at load time. Pressing the button again after a finished load re-runs the whole load once. |
| Instagram reach/shares for old posts? | Yes, filled in gradually within Instagram's rate limit, with visible progress. |
| How to view old posts? | A new «За всё время» period preset; the coverage note shows the real oldest loaded post. |
| Implementation approach | A separate, resumable, sliced history-load job (approach A), not a one-off unbounded sync. |

## 3. Out of scope

- Periodic re-checking of old posts' numbers.
- Instagram saves (`saved`) — the `posts` table has no column for it today;
  history fills in `reach` and `shares`, the insight columns that exist.
- Follower history before the account was added — impossible to backfill.
- Running full loads automatically, or for all accounts at once.
- Private Telegram channels (only public `t.me/s/` / embed pages are readable).

## 4. Architecture

### 4.1 Progress record — `history_loads` table

One row per account (unique `accountId`), reused on every run.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid PK | |
| `accountId` | uuid, unique | |
| `status` | enum `queued`, `running`, `paused`, `done`, `failed` | |
| `phase` | enum `posts`, `insights` | `insights` is Instagram-only |
| `cursor` | text, nullable | Where the current phase stopped (see §5, §6) |
| `postsLoaded` | int, default 0 | Posts saved by this run |
| `oldestPostAt` | timestamptz, nullable | Oldest post reached so far |
| `insightsDone` | int, default 0 | Instagram: posts whose insights were requested |
| `insightsTotal` | int, default 0 | Instagram: posts needing insights (set when phase 2 starts) |
| `pausedUntil` | timestamptz, nullable | Set while `paused` |
| `pauseReason` | enum `instagram_rate_limit`, `telegram_rate_limit`, `network`, nullable | Drives the Russian pause text |
| `errorMessage` | text, nullable | Russian, user-facing, set on `failed` |
| `startedAt` / `finishedAt` | timestamptz, nullable | |

`AccountsService.remove()` deletes the account's `history_loads` row in its
existing transaction.

### 4.2 The job — a `history` BullMQ queue, processed in slices

- New queue `history`, processor concurrency **1** app-wide: one account's
  load at a time, so loads never stack requests against Telegram or Instagram.
- A BullMQ job is **one slice**: bounded work (Telegram: ~20 pages or ~150
  embed reads; Instagram phase 1: ~10 media pages; Instagram phase 2: ~60
  insight requests), then it saves posts + `cursor` + counters and enqueues
  the next slice for the same account. No job runs for long.
- Pauses: the slice catches the platform's rate-limit error, sets `paused`,
  `pausedUntil`, `pauseReason`, and enqueues the next slice with a BullMQ
  `delay` until `pausedUntil`. Delays: Instagram rate limit 1 hour (rolling
  24 h window); Telegram 429 5 minutes; network/timeout 5 minutes.
- Resuming after a restart: BullMQ keeps delayed/waiting jobs in Redis. As a
  safety net, on startup any `history_loads` row in `queued`/`running`/`paused`
  with no pending BullMQ job is re-enqueued (running → continues from `cursor`).
- Failure: anything that is not a pause (auth error, unexpected exception)
  sets `failed` with a Russian `errorMessage`; the cursor is kept.

### 4.3 Endpoints (behind `JwtAuthGuard`)

- `POST /accounts/:id/history-load`
  - no row, or row `done` → reset counters, `cursor = null`, `phase = posts`,
    `status = queued`, enqueue first slice (a finished load re-runs from the
    newest post — the one-time refresh).
  - row `failed` → keep `cursor`/`phase`/counters, `status = queued`,
    enqueue (continue where it stopped).
  - row `queued`/`running`/`paused` → no-op; return the current row.
  - Returns the row (same shape as GET).
- `GET /accounts/:id/history-load` → the row, or `null` if never started.

### 4.4 Writing posts

- History writes posts with the same upsert key as the nightly sync
  (`accountId`, `externalPostId`), and computes `er` / `erViews` with the same
  calculators using the account's **current** follower count (latest
  snapshot, falling back to a live `getAccountStats`). ER for old posts is
  therefore approximate; the UI does not claim otherwise.
- **Instagram phase 1 must not overwrite insight columns.** It upserts
  without `reach` and `shares` (and without `er`, which depends on `shares`)
  for rows that already exist, so recent posts' numbers from the nightly sync
  are never blanked. New rows get `reach = null`, `shares = 0`, `er` computed
  from likes+comments.
- Nightly sync and history may touch the same post; both are upserts, last
  writer wins. History never writes follower snapshots.

## 5. Instagram

- **Phase 1 — posts.** Walk `GET /me/media` newest→oldest with Instagram's
  `after` cursor, no date limit. `cursor` = the `after` value. Map with the
  existing mapper, with null insights. Ends when there is no next page →
  switch to phase 2.
- **Phase 2 — insights.** Target set: the account's posts with
  `publishedAt` older than the nightly window (`POST_HISTORY_DAYS`), walked
  newest→oldest. `insightsTotal` = that count at phase start. `cursor` =
  `publishedAt|externalPostId` of the last processed post (keyset, stable
  under concurrent inserts). Pace ~1 request/second. On success write
  `reach`, `shares`, recompute `er`. A non-auth, non-rate-limit error for one
  post (e.g. media from before the account became Business/Creator) → leave
  its insights null, count it done, move on — it is not retried. Rate-limit
  error → pause 1 h. Auth error (OAuthException 190) → `needsReconnect = true`
  (existing behaviour) and the load `failed`.
- Instagram's media list is capped by Meta at roughly the 10,000 most recent
  media; older media are unreachable through the API. Not handled beyond
  finishing when paging ends.
- The Instagram connector gains the page-level methods; the existing
  `getPosts` (nightly) is unchanged.

## 6. Telegram

- **Normal channels (web preview on).** Walk `t.me/s/<channel>?before=<id>`
  pages back to the first post, no `MAX_PAGES` cap for history; same
  ~300 ms delay between pages. `cursor` = the `before` id for the next page.
  Ends when a page yields no older posts.
- **Hidden-preview channels.** Walk `t.me/<channel>/<id>?embed=1` from the
  newest id down to 1. `cursor` = next id to read. «Post not found» ids are
  skipped; unlike the nightly walk, there is **no** stop after a run of
  missing ids (`MISSING_RUN_LIMIT` does not apply) — the walk ends at id 1.
  Album parts are collapsed by timestamp as today; a slice never ends inside
  a timestamp group, so an album cannot become two posts across slices.
- Which walk: the same detection the nightly sync uses (preview page with no
  posts → embed walk), decided at the start of phase `posts` and re-checked
  on resume.
- Telegram 429 / "too many requests" → pause 5 minutes.
- Views and reactions come with the post; there is no insights phase.
- The Telegram connector gains the page-level methods; the existing
  `getPosts` (nightly) is unchanged.

## 7. Connector interface

Add to `SocialConnector` an optional history capability, e.g.:

```ts
loadHistoryPage(account: Account, cursor: string | null): Promise<{
  posts: ConnectorPost[];
  nextCursor: string | null;   // null = history exhausted
}>;
// Instagram only:
loadInsightsFor(account: Account, externalPostId: string): Promise<InstagramInsightResult>;
```

Exact signatures are settled in the plan; the processor stays platform-
agnostic apart from "does this connector have an insights phase".
Rate-limit conditions surface as a typed error (e.g. `RateLimitedError`
with a retry-after) so the processor can pause without knowing platforms.

## 8. Interface (frontend)

A history block on the account page, next to «Обновить»:

| State | Shows |
|---|---|
| never started | Button «Загрузить все посты» + hint «Один раз загрузит все посты аккаунта. Может занять от минут до нескольких часов». |
| queued / running, phase posts | Spinner + «Загружаем историю: {postsLoaded} постов, дошли до {month year of oldestPostAt}». Button disabled. |
| running, phase insights | «Досчитываем охваты: {insightsDone} из {insightsTotal}». |
| paused | «Пауза: лимит запросов Instagram, продолжим в {HH:MM}» / «Telegram ограничил запросы, продолжим через {N} минут» / «Проблема с сетью, продолжим через {N} минут». |
| done | «Вся история загружена: {postsLoaded} постов с {date of oldestPostAt}» + small link «Обновить всю историю». |
| failed | The Russian `errorMessage` + button «Продолжить». An Instagram auth failure additionally shows the existing reconnect banner. |

- Polling: every 5 s while `queued`/`running`, every 60 s while `paused`,
  stop on `done`/`failed`/never-started. On the transition to `done` the
  page reloads the top-10, posts table and summary (existing `reloadKey`).
- New period preset **«За всё время»**: `from` = the account's
  `coverage.postsFrom`, `to` = today.
- `coverage.postsFrom` becomes the earlier of (account.createdAt − 90 days)
  and the oldest stored post's `publishedAt`, so the note «Посты собраны с …»
  reflects loaded history. The followers-chart part of the note is
  unchanged.

## 9. Error handling summary

| Condition | Result |
|---|---|
| Instagram rate limit (codes 4 / 17 / 32 / 613, or HTTP 429) | `paused`, 1 h |
| Telegram 429 / too many requests | `paused`, 5 min |
| Network error / timeout | `paused`, 5 min |
| Instagram auth error (190) | `needsReconnect = true`, load `failed` |
| One Instagram post's insights rejected (non-auth, non-rate-limit) | That post's insights stay null; continue |
| Telegram «Post not found» (embed walk) | Skip id; continue |
| Unexpected error | `failed`, cursor kept, «Продолжить» resumes |
| Account deleted mid-load | Row deleted with the account; the next slice finds no row/account and exits quietly |

Exact Instagram rate-limit codes are to be confirmed against a real response
when one is first seen (Task 0 spirit); the classification lives in one
function so the fix is local.

## 10. Testing

- Backend (Jest): the slice processor — resume from `cursor`, pause →
  delayed re-enqueue, phase `posts` → `insights` hand-off for Instagram,
  `done` for Telegram, `failed` keeps cursor, POST semantics per state,
  startup re-enqueue. Connector page methods with recorded fixtures:
  Telegram preview pages, embed walk with «Post not found» gaps and an album
  on a slice boundary; Instagram media paging, rate-limit error → typed
  error, pre-Business insights error → null, phase-1 upsert never overwriting
  existing `reach`/`shares`/`er`. `coverage.postsFrom` from the oldest post.
  `remove()` deletes the history row.
- Frontend (Vitest): every state of the history block, polling cadence and
  stop, reload on `done`, «Продолжить» vs «Обновить всю историю» calls, the
  «За всё время» preset.

## 11. Data model changes

- New table `history_loads` (+ enums) via a migration.
- No changes to `posts`, `accounts`, `account_snapshots`.
- Deploy runs `migration:run` right after the rebuild, as always.
