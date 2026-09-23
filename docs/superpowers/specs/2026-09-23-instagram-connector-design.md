# Instagram connector — own & client accounts

Status: draft, pending user review.

## 1. Scope

Adds Instagram as a tracked platform, for accounts the agency or its
clients control — full stats via Instagram's official API, entirely
analogous to what Telegram already provides for owned channels.

**In scope:**
- Connecting an Instagram Business/Creator account through Instagram's
  own OAuth login (no passwords ever touch this app).
- Daily sync of followers, reach, views, likes, comments, saves and
  posts (image/video/carousel/reel), through the existing sync
  pipeline.
- Reconnecting an account whose access was lost (revoked, or a refresh
  that failed).
- The two endpoints Meta requires configured even for an app in
  development mode: deauthorize callback and data-deletion request.

**Out of scope, deliberately deferred:**
- Competitor Instagram accounts (Business Discovery lookups against
  public professional accounts). This needs the same connector but a
  different, unauthenticated read path; it is its own slice once this
  one is live.
- Instagram in the competitor-finder LLM pipeline.
- Meta App Review / "Live" mode. The app runs in development mode with
  each connected Instagram account added as a tester. Nothing in this
  design blocks moving to App Review later — it is a Meta-dashboard
  change, not a code change.
- Stories. Their insights API is narrow (24h expiry, limited metrics)
  and not worth the complexity yet.

## 2. Why OAuth, not a pasted link

Telegram accounts are added by parsing a public `t.me/...` URL — no
login needed, because the Bot API and the public web preview page
require no admin rights to read. Instagram's equivalent public reads
(Business Discovery) exist, but only return follower count, media
count and public post-level likes/comments — no reach, no views, no
follower history. Getting the same depth of data Telegram provides
requires the account owner to grant access through Instagram's OAuth
flow. That is unavoidable for this slice: there is no lesser-access
path that would still meet "own & client accounts, full stats."

## 3. Connect / reconnect flow

One flow serves both connecting a new account and reconnecting one
whose access was lost, because both end at the same place: a fresh,
valid token for a given Instagram user id.

```
 User                 Our backend                  Instagram
   │                       │                            │
   │ "Подключить            │                            │
   │  свой/клиента          │                            │
   │  Instagram"            │                            │
   ├──────────────────────▶│                            │
   │                       │ create one-time state token │
   │                       │ in Redis (10 min TTL,        │
   │                       │ single-use); carries the     │
   │                       │ chosen type: own | client    │
   │                       │                            │
   │◀──────────────────────┤ 302 to Instagram's login URL │
   │                       │  ?state=<token>              │
   ├───────────────────────┼───────────────────────────▶│
   │   user logs in on Instagram, approves access          │
   │◀──────────────────────┼────────────────────────────┤
   │  302 to our callback   │                            │
   │  /api/instagram/callback?code=...&state=...           │
   ├──────────────────────▶│                            │
   │                       │ verify + consume state       │
   │                       │ (missing/used/expired → 400, │
   │                       │  blocks a forged callback)   │
   │                       ├───────────────────────────▶│
   │                       │ exchange code for short-     │
   │                       │ lived token, then for a       │
   │                       │ long-lived (60-day) token      │
   │                       │◀───────────────────────────┤
   │                       ├───────────────────────────▶│
   │                       │ GET /me: ig user id,          │
   │                       │ username, account_type        │
   │                       │◀───────────────────────────┤
   │                       │                            │
   │                       │ Account with this              │
   │                       │ (platform, externalId)?        │
   │                       │  no  →  INSERT Account          │
   │                       │         (type from state) +     │
   │                       │         INSERT credential        │
   │                       │  yes →  UPDATE credential         │
   │                       │         (token, expiry),           │
   │                       │         clear needsReconnect         │
   │◀──────────────────────┤ 302 to /accounts/:id                │
```

**Why a state token, not a simpler correlation.** Without it, anyone
could call our callback URL directly with a fabricated `code` and
trigger a token exchange. The state token proves the callback belongs
to a login this backend started, and — since Instagram's redirect
carries nothing else of ours — it is also the only place to smuggle
"own or client" across the round trip. Stored in Redis (already used
by BullMQ), single-use, 10-minute TTL: long enough for a real login,
short enough that a leaked or logged URL is worthless soon after.

**Why reconnect is not a separate flow.** The unique constraint on
`(platform, externalId)` already exists (`account.entity.ts`) and
already means "this is the same account" for Telegram. For this to
hold for Instagram, `externalId` must be Instagram's numeric user id
(e.g. `17841400000000000`), **not** the `@username` — a username can be
changed by the account owner at any time, and matching on it would
silently create a second row for the same account after a rename
instead of updating the first. This differs from Telegram, where
`externalId` is the `@handle` because Telegram handles are what the
Bot API and public pages are addressed by. The display name and
`@username` shown in the UI still come from `AccountInfo.name` /
`getAccountInfo`, refreshed on every sync — only the join key is the
numeric id. A user who clicks "Подключить" for an account we already
have does not hit a conflict — they refresh its credential, exactly
what a genuine reconnect needs.

## 4. Credential storage

`AccountCredential` (`encryptedToken`, `tokenExpiresAt`, `refreshToken`)
already exists in the schema for this; nothing has used it until now.

- **At rest:** AES-256-GCM, keyed by `CREDENTIAL_ENCRYPTION_KEY`
  (already a 32-byte hex value in `.env`, unused until now). Each
  token gets its own random IV, stored with the ciphertext.
- **In transit:** the access token is exchanged server-to-server with
  Instagram only, over HTTPS; it never reaches the browser and never
  appears in a URL. Only the state token does, and it carries no
  secret.
- **In logs:** errors are translated the same way `gemini.finder.ts`
  translates Google's errors — the failure reason is logged, never the
  token.
- **On account removal:** already handled by
  `AccountsService.remove()`'s transaction, which deletes
  `AccountCredential` rows with the account. This design adds no new
  deletion path.
- **Not covered:** revoking the grant on Instagram's own side. Deleting
  our copy of the token stops us from using it; it does not log the
  user out of Instagram's own view of connected apps. The disconnect
  UI will say so.

## 5. Daily sync and token refresh

The daily sync already runs through a platform-agnostic path:
`SyncScheduler` (cron, 3am) → `SyncJobService` queues every active
account → `SyncProcessor` resolves a connector via
`ConnectorRegistry.get(account.platform)`. Once `InstagramConnector`
implements `SocialConnector` and registers with that registry,
Instagram accounts flow through the same sync as Telegram — no changes
to the scheduler or processor.

Token lifecycle is the one Instagram-specific addition, kept inside the
Instagram module:

- **Proactive refresh, cron at 2:30am** (30 minutes before the regular
  sync): finds every `AccountCredential` for an Instagram account
  expiring within 7 days and calls Instagram's refresh endpoint, valid
  any time after the token is 24h old, extending it 60 more days. In
  steady state a token that keeps syncing daily never expires; this
  runs silently.
- **Reactive fallback:** if a refresh was missed, or access was
  revoked from Instagram's side, the 3am sync itself gets an auth
  error. The connector translates it to a clear Russian message and
  the sync job records `FAILED` with it, exactly like any other sync
  failure today.
- **New field:** `AccountCredential.needsReconnect` (boolean, default
  `false`). Set only on an auth-specific failure (not on rate limits or
  network errors) from either the refresh cron or a sync call; cleared
  the moment the account reconnects or a refresh succeeds. Today a
  failed sync is invisible to the UI, which is tolerable for Telegram
  (retried tomorrow) but not for Instagram, where "revoked" does not
  fix itself by waiting.

## 6. Reading data

`InstagramConnector` implements the existing `SocialConnector`
interface:

| Method | Instagram Graph API call | Maps to |
|---|---|---|
| `getAccountInfo` | `GET /{ig-user-id}?fields=username,name,profile_picture_url,biography` | `AccountInfo` |
| `getAccountStats` | `GET /{ig-user-id}?fields=followers_count,follows_count,media_count` | `AccountStats` |
| `getPosts` | `GET /{ig-user-id}/media` (paginated by `after` cursor), then `GET /{media-id}/insights?metric=reach,saved,shares` per post | `ConnectorPost`; `media_type`/`media_product_type` maps onto the `IMAGE`/`VIDEO`/`CAROUSEL`/`REEL` values `PostType` already defines |
| `getAvatar` | fetch `profile_picture_url` directly | Instagram returns a real URL here, unlike Telegram's opaque file id; the existing method signature (`fileRef: string`) still fits without change |

A daily sync's call count (account info + stats + one media page + one
insights call per new post) stays far under Instagram's 200
requests/hour/account limit; no batching needed for this slice.

## 7. UI

Two explicit buttons on the overview page, next to the existing
competitor-add button, instead of a modal with a type picker:

- «Подключить свой Instagram» and «Подключить Instagram клиента» —
  each starts the OAuth redirect with that type already encoded in the
  state token, so connecting is one click with no extra dialog.
- **Reconnect** reuses the identical flow. When `needsReconnect` is
  true for an account (exposed on `GET /accounts/:id`), its detail
  page shows a banner with a «Переподключить» button hitting the same
  entry point. No accountId needs to be threaded through — see §3.

## 8. Meta app requirements this design assumes

- A Meta app in development mode, Instagram product added via
  "Instagram API with Instagram Login".
- Redirect URI `https://fdagency.duckdns.org/api/instagram/callback`.
- Deauthorize callback `https://fdagency.duckdns.org/api/instagram/deauthorize`
  and data-deletion URL `https://fdagency.duckdns.org/api/instagram/data-deletion`
  — both required fields in the Meta dashboard even in development
  mode. This design builds real handlers for them:
  - **Deauthorize:** Meta calls this when a user removes the app from
    their Instagram settings. Verifies Meta's signed request, finds
    the account by the Instagram user id it carries, and marks its
    credential `needsReconnect = true` — the same state a failed
    refresh produces, so the UI treats both identically.
  - **Data deletion:** same signed-request verification; deletes the
    account's `AccountCredential` (revoking our stored access) and
    returns the confirmation-code JSON shape Meta requires. It does
    not delete `Post`/`AccountSnapshot` history — those are the
    agency's own analytics records, not Instagram's data, and stay
    available the way a Telegram account's history does after
    deactivation.
- `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` in `.env`, alongside
  `CREDENTIAL_ENCRYPTION_KEY`.
- Each connected Instagram account (agency's own, and each client's)
  added as a tester in the Meta app dashboard and accepted from the
  Instagram side, until the app moves to App Review (out of scope
  here, no code impact when it happens).

## 9. Data model changes

- `AccountCredential.needsReconnect: boolean`, default `false`. One
  migration, additive, no backfill needed (existing rows are all
  unused/empty today).
- No changes to `Account`, `Post`, or any other existing table —
  `AccountType.OWN`/`CLIENT`, `PostType.IMAGE`/`VIDEO`/`CAROUSEL`/`REEL`,
  and `AccountCredential` itself already anticipated this.

## 10. Error handling

Every Instagram API failure is translated to a Russian message before
it reaches a `SyncJob.errorMessage` or an HTTP response, following the
`gemini.finder.ts` pattern:
- Auth failure (revoked/expired token) → sets `needsReconnect`, message
  points at reconnecting.
- Rate limited (429) → does not set `needsReconnect`; retried on the
  next scheduled sync.
- Network/5xx → does not set `needsReconnect`; same.
- The state-token check on the callback (missing, expired, already
  used) → 400 with a plain explanation, never a stack trace.

The exact status codes / `error.type` values Instagram uses to
distinguish "token invalid" from "rate limited" are not pinned down
yet — blog guides disagree with each other, and the Gemini 2.5
incident is a standing reminder not to trust one without checking. The
hands-on check against the real API (§8, before implementation starts)
will confirm the actual error shapes; `translateError`'s branches get
written against those, not against documentation.

## 11. Testing

Standard TDD per module, mirroring the competitor-discovery work:
- `InstagramConnector`: each `SocialConnector` method against fixture
  JSON responses (success, missing fields, auth error, rate limit).
- OAuth callback: state-token verification (valid, missing, expired,
  reused), insert-vs-update branch, credential encryption round-trip.
- Token-refresh cron: refreshes what's expiring soon, sets
  `needsReconnect` only on an auth-specific refresh failure, leaves it
  alone on a transient one.
- Deauthorize / data-deletion webhooks: signed-request verification,
  correct account resolved, correct side effect.
- Frontend: the two connect buttons, the reconnect banner appearing
  only when `needsReconnect` is true, and disappearing after a
  successful reconnect.
