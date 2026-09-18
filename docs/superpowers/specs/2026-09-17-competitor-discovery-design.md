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

## 3. Source chosen: Gemini with Google Search grounding

Google's pricing page (2026-09-11) lists **Gemini 2.5 Flash** as free of charge
on the free tier, **including Google Search grounding, free up to 500 requests
per day**. Grounding is *not* free on the newer 3.x models, so 2.5 Flash is the
deliberate choice. One run makes one grounded request, so the feature costs
**$0** at any volume this app will reach.

Confirmed reachable from the production VPS on 2026-09-17.

Accepted caveats:

- **Region:** Russia and Belarus are absent from Google's supported-regions list;
  what matters is where the VPS calls from, and it works from ours. A future host
  move must re-check this.
- **Data use:** free-tier prompts and responses may be used to improve Google
  products and may be read by humans. Only public channel data is sent.
- **Rate limits:** not published per model; roughly 10 RPM is reported by third
  parties. Queue concurrency of 1 keeps us far below it.
- **Invented handles are expected.** A model naming Telegram channels will name
  some that do not exist or are dead. Verification (§4.3) is what makes the
  feature trustworthy, and it is not optional.

### 3.1 TGStat — the paid upgrade, not available free

TGStat's `channels/search` would be a better candidate source: it returns real
catalogue entries with `username`, `title`, `about` and `participants_count`, so
nothing can be invented. It is **not usable on the free plan**:

> «Метод доступен в "API Stat" (на тарифах S и выше)» —
> https://api.tgstat.ru/docs/ru/channels/search.html

The FREE tariff is a trial «для каналов (не более 2), владельцем которых вы
являетесь» — only channels the user owns, which is the opposite of competitor
discovery. The price of tariff S is not published on pages reachable
automatically; it is visible in the TGStat account.

If that tariff is ever bought, TGStat slots in as a second implementation of the
seam in §5, with `TGSTAT_TOKEN` and its own quota guard against the plan's
monthly request allowance. The rest of the pipeline is unchanged.

### 3.2 Rejected

| Option | Why not |
|---|---|
| Claude with web search | Works and reasons better, but ~$0.15–0.60 per run against Gemini's $0. Kept as a switchable provider (§5) if Gemini's suggestions disappoint. |
| LLM from memory, no search | Stale and hallucination-heavy for small RU niches. |
| TGStat free plan | Channel search needs tariff S or higher (§3.1). |
| Cross-link harvesting (forwards/mentions) | Free and genuinely useful, but needs parser and schema work, and only finds channels that interact with ours. Deferred to a later phase. |

## 4. How one run works

### 4.1 Build the profile

Title, follower count, description (read from `getChat`, which the client
currently discards), and the 30 most recent captions from `posts`.

### 4.2 One grounded model call

Returns the niche in Russian plus up to 20 candidates, each
`{ handle, reason, fit 1..10 }`. The model is told to search for channel
catalogues and «похожие каналы» listings, to return only Telegram channel
handles, and never to include the analysed channel itself.

Grounded generation cannot be combined with a strict response schema on Gemini
2.5, so the reply is parsed leniently: raw JSON, JSON inside a fenced block, or
JSON surrounded by prose. A reply that yields no parsable candidates fails the
run with a clear message.

### 4.3 Verify every candidate

`getChat` + `getChatMemberCount` per handle. Dropped: unknown or dead handles,
non-channels, the analysed channel itself, and duplicates. The follower count
kept is Telegram's, never the model's.

### 4.4 Score and keep the top 10

`score = (fit / 10) * (0.5 + 0.5 * sizeSimilarity)`, where
`sizeSimilarity = min(subsA, subsB) / max(subsA, subsB)`.

Size therefore matters without letting a near-identical follower count outweigh a
poor subject match.

## 5. Provider seam

```ts
interface CompetitorFinder {
  suggest(profile: ChannelProfile): Promise<{ niche: string; candidates: RankedCandidate[] }>;
}
```

`GeminiFinder` (`gemini-2.5-flash`, Google Search grounding) is implemented now.
`COMPETITOR_LLM` (`gemini` | `claude`, default `gemini`) selects the
implementation. Adding `ClaudeFinder` (Sonnet 5 with its web search tool) later is
one new file plus one environment variable: no schema change, and no changes to
the worker, endpoints or UI. A TGStat-backed implementation (§3.1) fits the same
seam.

Every run records `llmProvider` and `llmModel`, so quality can be compared across
a switch.

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
| `llmProvider`, `llmModel` | varchar | which model produced it |
| `inputTokens`, `outputTokens` | int null | reported usage |
| `costUsd` | numeric(10,4) | 0 on the Gemini free tier |
| `candidatesProposed`, `candidatesVerified` | int | how many survived §4.3 |
| `errorMessage` | text null | final-attempt failure reason |
| `startedAt`, `finishedAt`, `createdAt` | timestamptz | |

`candidatesProposed` against `candidatesVerified` is the feature's quality
signal: a provider inventing most of its handles shows up as a widening gap, and
is the evidence for switching provider.

**`competitor_suggestions`** — the verified top 10 of a run:

`id`, `runId` (FK, cascade), `accountId`, `externalId` (lowercased handle),
`name`, `followersCount`, `reason`, `fit`, `score`, `rank`, `createdAt`; unique
on (`runId`, `externalId`).

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
  errorMessage) and its suggestions with `alreadyTracked` and `trackedAccountId`.
- **`POST /accounts/:id/competitors/refresh`** → `202` with the run id; `409` if
  a run for that account is `PENDING`/`RUNNING`; `503` when the feature is
  disabled because no provider key is configured.
- **Adding a suggestion** reuses `POST /accounts/from-link`. No new add logic.

**Trigger on add:** a competitor run needs captions, which exist only after the
first sync. `SyncProcessor` therefore enqueues a run when a sync finishes and the
account has **no `competitor_runs` row yet** — that condition, not the sync's
trigger type, is what makes it happen once per account. It fires on success and
also on final failure, since a hidden-preview channel still has a title and
description. The daily scheduled sync therefore never re-runs discovery;
regeneration is the button's job.

## 8. Cost and failure handling

- **No quota guard is needed.** Gemini's free grounding allowance is 500 requests
  per day and one run uses one; the app cannot approach it. If the provider
  returns a quota or rate-limit error anyway, the run fails with «Превышен лимит
  запросов, попробуйте позже» and the button stays available.
- A run that fails leaves the previous suggestions in place and shows
  «Не удалось подобрать конкурентов».
- A missing provider key disables the feature: adding channels and every existing
  page keep working, and the button explains why it is unavailable.
- Region errors from Google surface as the run's `errorMessage`, which is how a
  host move into a blocked region would be diagnosed.
- `costUsd` stays 0 while Gemini is the provider. It exists so that switching to
  Claude makes spend visible immediately, without a migration.

## 9. UI

A «Конкуренты» section on `AccountDetailPage`, below the follower chart.

- **Header:** «Ниша: {niche} · обновлено {date}» and the «Обновить конкурентов»
  button.
- **Row:** name, @handle linking to t.me, subscribers, the model's one-line
  reason, and «Добавить» — or «Уже отслеживается» linking to that channel's page.
- **Running:** «Подбираем конкурентов… обычно 1–2 минуты», button disabled,
  polled every 5 s; any previous list stays visible beneath.
- **Empty:** «Не нашли похожих каналов». **Failed:** the message from §8.
- Avatars are out of scope for this version; suggestions show a placeholder.

## 10. Testing

Tests are written first, and none of them touch the network.

- **Gemini finder:** parses clean JSON, JSON inside a fenced block, and JSON
  surrounded by prose; fails clearly when nothing parses; drops entries missing a
  handle. Fixtures are saved from one real grounded reply.
- **Verification:** dead handles, non-channels, the analysed channel itself and
  duplicates are all dropped, and Telegram's follower count wins over the model's.
- **Scoring:** the formula in §4.4, including equal sizes, extreme mismatches and
  a zero follower count.
- **Worker:** the success path writes a run plus suggestions and replaces old
  ones; failure keeps old suggestions and records the reason only on the final
  attempt.
- **Guards:** concurrent run rejected with 409; feature off without a key.
- **Frontend:** the section's loading, empty, failed and populated states, and
  «Уже отслеживается» rendering. Frontend tests use `vi.clearAllMocks()`, never
  `mockReset`, which breaks rejection mocks in this suite.

**Manual verification before the work is called done:** one real run against a
known channel, confirming the suggestions are plausible and that
`candidatesProposed` versus `candidatesVerified` looks sane.

## 11. Rollout

1. Add `GEMINI_API_KEY` to `/opt/smm-dashboard/app/.env`.
2. Deploy from `master` with the standard sequence, then run the migration
   (`docs/operations.md`).
3. Run one manual «Обновить конкурентов» on a known channel and inspect the run
   row.
4. If Gemini's suggestions prove weak, add `ClaudeFinder`, then set
   `COMPETITOR_LLM=claude` and `ANTHROPIC_API_KEY` (~$0.15–0.25 per run with web
   search). If TGStat tariff S is ever bought, add the TGStat source instead for
   better precision at no per-run cost.

## 12. Out of scope

- Cross-link harvesting from forwards and mentions (the strongest free signal;
  the natural next phase, needing parser changes and a new table).
- An own-vs-competitor account split: every added channel currently gets its own
  suggestions, by decision.
- Avatars for suggested channels, and automatic adding of suggestions.
