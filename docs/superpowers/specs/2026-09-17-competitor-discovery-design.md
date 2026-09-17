# Competitor Discovery Design

**Status:** Approved for planning
**Related:** [Social Media Dashboard Design Spec](2026-08-13-social-media-dashboard-design.md), [Telegram Post Analytics Design](2026-09-09-telegram-post-analytics-design.md)

## 1. Purpose

When a channel is added, the app should propose the channels closest to it — the
competitors whose audience, size and subject matter overlap — so the user can add
them with one click instead of hunting for them by hand.

Suggestions are produced for **every** channel added, and can be regenerated from
an «Обновить конкурентов» button on the channel page.

## 2. Constraints established before designing

Read from the code and verified against provider documentation on 2026-09-14/17.

- **No competitor concept exists yet.** There is no link table, no category, no
  tag, and `Account.type` is hardcoded to `PUBLIC_NO_ACCESS` in
  `accounts.service.ts:102`. The word "конкурент" appears only in UI copy.
- **No MTProto session.** Telegram's native similar-channels method
  (`channels.getChannelRecommendations`) is MTProto-only and was deliberately
  rejected in the post-analytics spec (phone number, session secret on the VPS,
  ban risk). It stays rejected.
- **Available Telegram access:** the Bot API (`getChat`, `getChatMemberCount`)
  and public page scraping. `getChat` already returns the channel description,
  but `telegram-api.client.ts:31-36` discards it.
- **Post data holds no outbound graph.** The parser strips HTML, so forwards,
  @mentions and t.me links are not stored.

## 3. Sources chosen

### 3.1 TGStat for candidates

`channels/search` (https://api.tgstat.ru/docs/ru/channels/search.html) takes `q`,
optional `category`, `language`, `country` and `search_by_description`, and
returns up to 100 channels per call, each with `username`, `title`, `about`,
`participants_count` and category. Candidates therefore come from a real
catalogue and **cannot be invented**.

Quota is tracked on two axes (requests, unique channels). The free plan provides
**50 requests per month**; `usage/stat` reports remaining quota and is itself
free (https://api.tgstat.ru/docs/ru/usage/stat.html).

**Unconfirmed at design time** (TGStat's tariff pages reject automated fetches):
whether `channels/search` is included on the free plan, and paid plan prices.
Both are visible in the account and must be checked before implementation starts.

### 3.2 Gemini for judgment

Google's pricing page (2026-09-11) lists Gemini 2.5 Flash as free of charge on
the free tier. We do **not** need Search grounding — TGStat supplies the
candidates — so the free tier covers the whole feature at **$0 per run**.

Known caveats, accepted:

- **Region:** Russia and Belarus are absent from Google's supported-regions list.
  What matters is where the VPS calls from. If blocked, switch providers (§5).
- **Data use:** free-tier prompts and responses may be used to improve Google
  products and may be read by humans. Only public channel data is sent.
- **Rate limits:** not published per model; roughly 10 RPM is reported by third
  parties. Queue concurrency of 1 keeps us far below it.

### 3.3 Rejected

| Option | Why not |
|---|---|
| LLM with web search | Worked, but ~$0.15–0.60 per run, and invented handles must be filtered out. TGStat is cheaper and factual. |
| LLM from memory, no search | Stale and hallucination-heavy for small RU niches. |
| Cross-link harvesting (forwards/mentions) | Free and genuinely useful, but needs parser and schema work, and only finds channels that interact with ours. Deferred to a later phase. |

## 4. How one run works

1. **Build the profile:** title, `participants_count`, description (read from
   `getChat`, not stored), and the 30 most recent captions from `posts`.
2. **LLM call #1 — describe:** returns `{ niche, category, keywords[3..5] }`.
3. **TGStat search:** one `channels/search` request per keyword (2–4 total) with
   `language=russian` and the category when the model supplied one. Results are
   merged and de-duplicated by username.
4. **LLM call #2 — rank:** given the profile and the candidate list (username,
   title, about, subscribers), returns up to 15 `{ handle, reason, fit 1..10 }`.
5. **Verify** each returned handle with `getChat` + `getChatMemberCount`.
   Dropped: unknown or dead handles, non-channels, the channel itself, and any
   channel already suggested in this run.
6. **Score and keep the top 10:**
   `score = (fit / 10) * (0.5 + 0.5 * sizeSimilarity)`, where
   `sizeSimilarity = min(subsA, subsB) / max(subsA, subsB)`.
   Size therefore matters without letting a near-identical follower count
   outweigh a poor subject match.

Steps 2 and 4 are the only provider-specific parts.

## 5. Provider seam

```ts
interface CompetitorFinder {
  describe(profile: ChannelProfile): Promise<NicheDescription>;
  rank(profile: ChannelProfile, candidates: TgstatChannel[]): Promise<RankedCandidate[]>;
}
```

`GeminiFinder` (model `gemini-2.5-flash`) is implemented now. `COMPETITOR_LLM`
(`gemini` | `claude`, default `gemini`) selects the implementation. Adding
`ClaudeFinder` later is one new file plus one environment variable: no schema
change, and no changes to the worker, endpoints or UI.

Every run records `llmProvider` and `llmModel`, so output quality can be compared
across a switch.

Both implementations must tolerate JSON returned wrapped in prose or fenced code
blocks; a reply that cannot be parsed fails the run with a clear message.

## 6. Data model

One migration in `backend/src/db/migrations/`, two tables.

**`competitor_runs`** — one row per search, kept as history:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `accountId` | uuid | the channel the search was for |
| `trigger` | enum | `ACCOUNT_ADDED` \| `MANUAL` |
| `status` | enum | `PENDING` \| `RUNNING` \| `SUCCESS` \| `FAILED` |
| `niche` | text null | as identified by the model |
| `keywords` | jsonb null | what was searched |
| `llmProvider`, `llmModel` | varchar | which model produced it |
| `inputTokens`, `outputTokens` | int null | reported usage |
| `costUsd` | numeric(10,4) | 0 on the Gemini free tier |
| `tgstatRequests` | int | requests consumed |
| `errorMessage` | text null | final-attempt failure reason |
| `startedAt`, `finishedAt`, `createdAt` | timestamptz | |

**`competitor_suggestions`** — the verified top 10 of a run:

`id`, `runId` (FK, cascade), `accountId`, `externalId` (lowercased handle),
`name`, `followersCount`, `about`, `reason`, `fit`, `score`, `rank`,
`createdAt`; unique on (`runId`, `externalId`).

On a successful run, suggestions from previous runs of that account are deleted;
runs themselves are retained. `AccountsService.remove` lists related tables
explicitly, so both new tables are added to that transaction.

"Already tracked" is **not** stored: it is computed at read time by joining
`accounts` on `platform` + `externalId`, so it stays correct once a suggestion is
added.

## 7. Queue and API

A `competitors` BullMQ queue mirroring `sync/`: `CompetitorRunService` (enqueue,
guards), `CompetitorProcessor` (worker, concurrency 1, 2 attempts, exponential
backoff), `CompetitorsController`.

- **`GET /accounts/:id/competitors`** → latest run (status, niche, finishedAt,
  errorMessage), its suggestions with `alreadyTracked` and `trackedAccountId`,
  and `tgstatQuotaRemaining`.
- **`POST /accounts/:id/competitors/refresh`** → `202` with the run id; `409` if
  a run for that account is `PENDING`/`RUNNING`; `503` when the feature is
  disabled (missing key) or TGStat quota is exhausted.
- **Adding a suggestion** reuses `POST /accounts/from-link`. No new add logic.

**Trigger on add:** a competitor run needs captions, which exist only after the
first sync. `SyncProcessor` therefore enqueues a run when a sync finishes and the
account has **no `competitor_runs` row yet** — that condition, not the sync's
trigger type, is what makes it happen once per account. It fires on success and
also on final failure, since a hidden-preview channel still has a title and
description. The daily scheduled sync therefore never re-runs discovery;
regeneration is the button's job.

## 8. Quota, cost and failure handling

- Before enqueueing, remaining TGStat quota is read via the free `usage/stat`
  method. Below a safety margin of 5 requests, a manual refresh returns `503`
  with «Лимит TGStat исчерпан», and the automatic run on add is skipped silently.
- A run that fails leaves the previous suggestions in place and shows
  «Не удалось подобрать конкурентов».
- A missing `TGSTAT_TOKEN` or LLM key disables the feature: adding channels and
  every existing page keep working, and the button explains why it is
  unavailable.
- Region or quota errors from the provider surface as the run's `errorMessage`,
  which is how a blocked VPS region is diagnosed.

## 9. UI

A «Конкуренты» section on `AccountDetailPage`, below the follower chart.

- **Header:** «Ниша: {niche} · обновлено {date}», «Осталось запросов TGStat: N»,
  and the «Обновить конкурентов» button.
- **Row:** name, @handle linking to t.me, subscribers, the model's one-line
  reason, and «Добавить» — or «Уже отслеживается» linking to that channel's page.
- **Running:** «Подбираем конкурентов… обычно 1–2 минуты», button disabled,
  polled every 5 s; any previous list stays visible beneath.
- **Empty:** «Не нашли похожих каналов». **Failed:** the message from §8.
- Avatars are out of scope for this version; suggestions show a placeholder.

## 10. Testing

Tests are written first, and none of them touch the network.

- **TGStat client:** parses a saved real `channels/search` response; maps quota
  from `usage/stat`; surfaces API errors.
- **Gemini finder:** parses clean JSON, JSON inside a fenced block, and fails
  clearly on unparseable output.
- **Scoring:** the formula in §4, including equal sizes, extreme mismatches and a
  zero follower count.
- **Worker:** the success path writes a run plus suggestions and replaces old
  ones; failure keeps old suggestions and records the reason only on the final
  attempt; verification drops dead handles, groups and self-matches.
- **Guards:** concurrent run rejected; quota below margin rejected; feature off
  without keys.
- **Frontend:** the section's loading, empty, failed and populated states, and
  «Уже отслеживается» rendering. Frontend tests use `vi.clearAllMocks()`, never
  `mockReset`, which breaks rejection mocks in this suite.

**Manual verification before the work is called done:** one real run against a
known channel, confirming the suggestions are plausible and that recorded quota
and cost match what the providers report.

## 11. Rollout

1. Confirm in the TGStat account that the free plan exposes `channels/search`.
2. Verify from the VPS that Gemini is reachable from its region.
3. Add `TGSTAT_TOKEN` and `GEMINI_API_KEY` to `/opt/smm-dashboard/app/.env`.
4. Deploy from `master` with the standard sequence, then run the migration
   (`docs/operations.md`).
5. If the region is blocked, set `COMPETITOR_LLM=claude` and `ANTHROPIC_API_KEY`
   once `ClaudeFinder` exists (~$0.05 per run, Sonnet 5, no web search).

## 12. Out of scope

- Cross-link harvesting from forwards and mentions (the strongest free signal;
  the natural next phase, needing parser changes and a new table).
- An own-vs-competitor account split: every added channel currently gets its own
  suggestions, by decision.
- Avatars for suggested channels, and automatic adding of suggestions.
