# Telegram Post Analytics Design

**Status:** Approved for planning
**Related:** [Social Media Dashboard Design Spec](2026-08-13-social-media-dashboard-design.md), [VPS Deployment Design](2026-08-25-vps-deployment-design.md)

## 1. Purpose

Make an account's page show its real performance: totals for views, reactions and
followers; averages for views and reactions; and a sortable list of the account's
posts, each previewing an image, a text snippet, its view and reaction counts and
its ER. Clicking a post opens the full post, including its publication date and
time.

This works for both own and competitor channels, since competitor analysis is the
product's reason to exist.

## 2. The blocking finding

Every part of the request depends on post-level data, and **nothing in the system
can currently obtain it**. This was established by reading the code, not assumed:

- `TelegramConnector.getPosts()` returns `[]` unconditionally. The Telegram Bot API
  has no method to read a channel's post history at all.
- The only writer of `posts` rows is the webhook controller, which needs
  `setWebhook` (never called) *and* the bot to be an administrator of the channel.
  A competitor's channel can never satisfy that.
- Even with admin rights, `telegram-post-mapper.ts` hardcodes `views: null` and
  `likes: 0`. That is not an oversight: the Bot API's message object carries no
  view count and no reactions.

So ER is not "uncalculated" by accident. `sync.processor.ts` already calls
`calculateEr()` for every post it syncs — it has simply always looped over an
empty array.

The `posts` table, the `PostList` component and `er-calculator.ts` all already
exist and are correct. What is missing is a source.

## 3. Source: the public channel preview

Verified by probe on 2026-09-09 against `https://t.me/s/durov` — plain HTTPS, no
auth, no bot, from the development machine. One page returned 20 posts carrying
every field the feature needs:

| Field | Present as |
|---|---|
| Views | `24.2M`, `18.8M`, `9.51M` |
| Reactions | per-emoji counts (`322K`, `89.1K`) |
| Text | full post text |
| Image | direct `cdn4.telesco.pe` URLs |
| Date and time | `2026-06-15T15:53:15+00:00` |
| Pagination | `data-before="527"`, 20 posts per page |

Chosen over the two alternatives:

- **MTProto user account** (GramJS/Telethon) gives exact counts and is what
  commercial tools use, but requires a dedicated phone number, a session secret on
  the VPS, and carries a real risk of the account being limited or banned.
- **Bot API only** cannot deliver the request at all: own channels only, no
  history, and no view counts in any circumstance.

## 4. Decisions made with the user

| Decision | Choice |
|---|---|
| Data source | Public preview page (`t.me/s/<channel>`) |
| ER | Both, side by side: ERR by views and ER by followers |
| History depth | Last 90 days on first add |
| Period control | Selector 7 / 30 / 90 days, default 30 |
| Post full view | Modal over the list |
| Post type | Any photos, one or several, are `IMAGE` |
| Обновить | Re-syncs everything: followers *and* a fresh post scrape |
| UI build | Uses the taste skill |

## 5. Architecture

```
  scheduled sync (03:00)  /  Обновить
             |
             v
    SyncProcessor  --------> TelegramConnector.getPosts(account, since)
             |                        |
             |                        v
             |               TelegramPreviewClient   (fetch, throttle, paginate)
             |                        |
             |                        v
             |               parsePreviewPage(html)  (pure, no I/O)
             |                        |
             v                        v
     posts (upsert on accountId+externalPostId), account_snapshots
             |
             v
     StatsService.getAccountDetail  -> SQL aggregate + period rows
             |
             v
     AccountDetailPage -> tiles, trend, sortable grid, post modal
```

## 6. Components

### 6.1 telegram-preview.client.ts

Fetches `https://t.me/s/<channel>` and `?before=<id>` for older pages. Responsible
only for HTTP. Throttles ~300ms between page requests and caps a single walk at 25
pages, so a first sync of a high-volume channel cannot become a request storm.

### 6.2 telegram-preview.parser.ts

A pure function: HTML in, posts out. No network, no clock, no I/O — which is what
makes it testable against a saved fixture of a real page, deterministically and
offline.

Extracts per post: `externalPostId` (from `data-post`), `publishedAt` (from the
`datetime` attribute, timezone-aware), `caption` (text with tags stripped),
`thumbnailUrl`, `views`, `likes` (sum of all reaction counts), and `type`.

**Type mapping for Telegram:** video thumbnail present → `VIDEO`; any photos
present, one or several → `IMAGE`; neither → `POST` (text-only). `CAROUSEL`
becomes unused for Telegram and remains for platforms where an album is genuinely
a distinct format.

**Reactions are stored in `likes`.** The `Post` entity is cross-platform and
reactions are Telegram's likes. `comments` and `shares` stay 0 because this source
does not expose them.

**Number parsing:** `24.2M` becomes `24200000`, `322K` becomes `322000`, `999`
stays `999`. Counts under 1000 are exact; above that Telegram rounds and precision
is lost.

**It fails loudly.** A 200 response containing zero message blocks means either the
parser broke or the channel disabled its web preview. Both throw, so the sync job
fails visibly and BullMQ retries. It must never write zeros quietly — that would be
indistinguishable from a channel whose performance collapsed.

### 6.3 Connector and sync

`TelegramConnector.getPosts()` walks pages newest-first until it passes the
`sinceDate` boundary or hits the page cap, and returns `ConnectorPost[]`.

Everything downstream already exists: `sync.processor.ts` upserts on
`(accountId, externalPostId)` and computes ER. Because syncs re-scrape the whole
window, view counts on already-stored posts are refreshed — necessary, since a post
keeps accumulating views for days after publication. `since` moves from 30 to 90
days.

### 6.4 Schema

Two migrations, both safe: the `posts` table is empty in production, so there is no
backfill and nothing to roll back over.

1. Add `erViews` (float, nullable) beside the existing `er`, which becomes
   explicitly ER-by-followers.
2. Add `image` to the post type enum.

`er-calculator.ts` keeps `calculateEr()` unchanged and gains a sibling for ERR.

**Aggregate ER is weighted** — `totalReactions / totalViews` — not the mean of
per-post ERs. Otherwise a post with 12 views and 3 reactions reads as 25% and drags
the channel's figure somewhere meaningless.

**ER-by-followers on an old post uses the channel's current subscriber count**, as
no historical follower data exists for posts predating tracking. The UI labels it
so it is not mistaken for a point-in-time figure.

## 7. API

`GET /accounts/:id/detail?from&to` gains a `summary`:

```
summary: { followersCount, postsCount,
           totalViews, totalReactions,
           avgViews, avgReactions,
           erViews, erFollowers }
```

Computed as a single SQL aggregate — not by loading rows and summing in JS, which
is the defect the 2026-09-09 review already flagged in `getTopPosts` and which
there is no reason to reproduce in new code.

The `posts` array carries `id`, `type`, `publishedAt`, `caption`, `thumbnailUrl`,
`permalink`, `views`, `likes`, `er`, `erViews`.

**Naming, stated once to avoid confusion:** the `er` column and field always mean
ER-by-followers, and `erViews` always means ERR-by-views. The summary object spells
the first one `erFollowers` because at that level there is no column to match and
the explicit name is worth more than the symmetry.

**The scrape window is fixed at 90 days and is independent of the period
selector.** The selector filters what is displayed and aggregated; it never
narrows what is fetched. Choosing 7 days must not cause the next sync to discard
83 days of already-collected posts.

## 8. UI

Built with the taste skill. Russian copy throughout (Просмотры, Реакции,
Подписчики, Средние просмотры).

Page order: period selector (7 / 30 / 90, default 30, driving everything below),
then stat tiles, trend chart, a toolbar with type filter and sort, and the post
grid.

Each card shows thumbnail, clamped text snippet, views, reactions and ER. Clicking
opens a modal with the full image, full text, **publication date and time**, every
metric, and a link out to the post on Telegram. Esc or an outside click closes it,
preserving sort and scroll position.

**Sorting happens in the browser**, over rows already in the response: views
(default, descending), reactions, ER, date. Server-side sorting would cost a round
trip per click for no benefit at these row counts.

**Images load directly via an img src.** These are public CDN URLs. This is the
opposite of the avatar case, which needs the JWT-guarded proxy only because the
Telegram file URL embeds the bot token. The two must not be consolidated.

`PostTypeFilter` currently offers `reel`, `short` and `story` in English, none of
which can occur on Telegram. It is reduced to the types that can: Все,
Изображение, Видео, Текст.

**Empty states are explicit.** A channel with no posts yet, or one that disabled
its web preview, says so rather than rendering an empty grid that reads like a dead
account.

## 9. Testing

- Parser against a saved fixture of a real preview page — deterministic, offline.
- Number parsing: `24.2M`, `322K`, `999`, and missing views.
- The loud failure: HTML with no message blocks throws.
- Pagination stops at the 90-day boundary and at the page cap.
- SQL aggregates against seeded posts, including the empty-period case.
- Frontend: default sort is views, sort changes reorder, modal opens and closes,
  period switching refetches, empty states render.

## 10. Known limits

- **View and reaction counts are rounded above 1000.** A post with 12,347 views
  reads as `12.3K`. ER error from this is negligible (~0.4%), but exact figures are
  not available for large channels.
- **Telegram changing its markup breaks the parser.** Mitigated by failing loudly
  and by the fixture test, not prevented.
- **Channels that disable their web preview yield nothing.** Surfaced as an error on
  the account rather than silence.
- **CDN image URLs may eventually expire.** Refreshed on every sync.

## 11. Out of scope

- Calling `setWebhook`. The dormant webhook controller upserts on the same key with
  `views: null, likes: 0`, so enabling it would overwrite scraped data with blanks.
  Scraping supersedes it entirely — it gives history, view counts and competitor
  channels, none of which the webhook can. Deleting that path is worth doing later,
  but not here.
- Per-emoji reaction breakdown. The total is what was asked for.
- Comment and forward counts, which this source does not expose.
- Connectors for any other platform.
