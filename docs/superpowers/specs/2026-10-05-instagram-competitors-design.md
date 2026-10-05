# Instagram competitors — add by link via Business Discovery

Status: draft, pending user review.

## 1. Scope

Lets the user add any public Instagram **Business or Creator** account as
a competitor by pasting its profile link into the same field that already
takes Telegram links. The platform is detected from the link.

**In scope:**
- A one-time, app-wide **Facebook Login** ("discovery connection") that
  provides the token Business Discovery needs.
- Preview + add of Instagram competitor accounts from a link.
- Sync of competitor followers (daily snapshot) and posts (likes,
  comments, type, caption, permalink, thumbnail) through the existing
  sync and full-history pipelines.
- Reworking the add-account modal into «Аккаунт конкурента» /
  «Свой аккаунт» tabs.

**Out of scope:**
- Personal (non-professional) and age-gated Instagram accounts — Business
  Discovery does not return them. They get a clear error.
- Reach, saves and shares for competitors — the API does not expose them.
  Views: only if Task 0 shows Business Discovery returns them (see §7).
- Instagram in the LLM competitor finder (CompetitorsSection).
- Facebook deauthorize / data-deletion callbacks. The Meta app stays in
  development mode with the user as admin, where they are not required.
- Disconnecting the Facebook connection from the UI.
- Refreshing competitor name/avatar after creation (existing limitation
  shared with Telegram competitors; Instagram avatar CDN URLs expire).

## 2. Why Facebook Login

Meta's docs confirm Business Discovery (`business_discovery.username(...)`)
is available only in the *Instagram API with Facebook Login*, not the
*Instagram API with Instagram Login* the app uses for own accounts. The
request is made *as* an Instagram professional account that is linked to
a Facebook Page — the user's own account (already linked, confirmed
2026-10-05) — with a Facebook user token carrying `instagram_basic`,
`instagram_manage_insights`, `pages_read_engagement` (plus
`pages_show_list` to find the Page's linked Instagram account).

Business Discovery was chosen over paid scraping APIs (cost, ToS, breakage)
and self-hosted scraping (the user's account was temporarily blocked by
Meta on 2026-09-30).

## 3. Data model

New single-row table `instagram_discovery_connection`:

| column | type | notes |
|---|---|---|
| `id` | int PK | always `1` — one connection for the whole app |
| `igUserId` | text | the Instagram business account id the lookups are made *as* |
| `igUsername` | text | shown in the modal («Подключено как @…») |
| `encryptedToken` | text | encrypted with the existing `instagram-token-crypto` |
| `tokenExpiresAt` | timestamptz null | null when the stored token does not expire |
| `needsReconnect` | bool default false | set only on auth errors, cleared on reconnect |
| `connectedAt` | timestamptz | |

Accounts are not owned per user, so one connection for the app is enough.

`InstagramOauthState.type` gains a value `discovery` (enum migration), so
the existing one-time state table serves the Facebook flow too.

Competitor accounts are ordinary `accounts` rows: `platform = instagram`,
`type = public_no_access`, `externalId = @username` (lowercase, same shape
as Telegram handles). They have **no** `account_credentials` row. Own
accounts keep their numeric id as `externalId`, so the two shapes never
collide in the `(platform, externalId)` unique index.

## 4. Backend

### 4.1 Facebook connection flow

- `GET /instagram/discovery/connect` → `{ redirectUrl }` to
  `https://www.facebook.com/v23.0/dialog/oauth` with the Facebook app id,
  the scopes above, a `discovery` state, and redirect URI
  `https://<host>/api/instagram/discovery/callback`.
- `GET /instagram/discovery/callback`:
  1. consume state;
  2. exchange code → short-lived user token → long-lived user token
     (`grant_type=fb_exchange_token`, ~60 days);
  3. `GET /me/accounts?fields=instagram_business_account{id,username},access_token`
     and pick the first Page with a linked Instagram business account
     (none → «К вашей странице Facebook не привязан профессиональный
     аккаунт Instagram»);
  4. store the token (the Page token instead, if Task 0 shows Business
     Discovery accepts it — Page tokens derived from a long-lived user
     token do not expire, so `tokenExpiresAt` becomes null);
  5. redirect to `/?add=competitor`; on failure redirect to
     `/?add=competitor&discoveryError=<message>`.
- `GET /instagram/discovery/status` → `{ connected, needsReconnect, username }`.
- New env vars `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` — the Facebook
  App ID from *App settings → Basic*, which differs from the Instagram
  app id already in `.env`.

Lives in `backend/src/connectors/instagram/` next to the Instagram Login
flow: `instagram-discovery.client.ts` (graph.facebook.com calls),
`instagram-discovery-oauth.service.ts`, `instagram-discovery.controller.ts`,
and a small `instagram-discovery-connection.service.ts` that loads and
decrypts the token and flags `needsReconnect`.

### 4.2 Link parsing

`parseAccountLink` gets Instagram-specific parsing: the **first** path
segment is the username (today it takes the last, so
`instagram.com/brand/reels/` would become `@reels`). Paths starting with
`p`, `reel`, `reels`, `tv`, `stories`, `explore`, `accounts`, `direct`
return a dedicated "not a profile" result, surfaced as «Вставьте ссылку
на профиль, а не на пост». Usernames are validated against
`^[a-z0-9._]{1,30}$` and lowercased.

### 4.3 Preview and create

`AccountsService.resolveLink` stops rejecting Instagram. For Instagram:
- no discovery connection, or `needsReconnect` → `400` with
  `code: 'instagram_discovery_not_connected'` (or
  `'instagram_discovery_reconnect'`) so the modal can show the button;
- Business Discovery error "user not found / not a business account" →
  «Аккаунт не найден или это не бизнес-аккаунт Instagram».
- Duplicate check: the existing `(platform, externalId)` lookup. In
  addition, if the Business Discovery `id` equals the `externalId` of an
  own Instagram account, it counts as already added (whether these ids
  match is verified in Task 0; if they don't, adding one's own account as
  a competitor is allowed and documented as a known limitation).

Everything after the account row is saved is unchanged: a manual sync job
is queued, as for Telegram.

### 4.4 Connector

`InstagramConnector` branches on `account.type`:
- `own` / `client` → current per-account token path, unchanged.
- `public_no_access` → `GET /{igUserId}?fields=business_discovery.username(<name>){username,name,biography,profile_picture_url,followers_count,follows_count,media_count,media.after(<cursor>).limit(<n>){id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url}}`
  with the discovery token.
  - `getAccountInfo`, `getAccountStats`, `getPosts(since)`,
    `loadHistoryPage(cursor)` map the response with the existing
    `mapInstagramPost` (insights all null).
  - `loadPostInsights` returns all-null without an API call.
  - Errors reuse `instagram-error`: auth errors set
    `needsReconnect` on the **discovery connection**; rate limits and
    network errors become the existing `HistoryPauseError`s.

No changes to the sync scheduler, history runner, snapshots, ER
calculation (followers-based ER works on likes + comments) or the post
UI — views/reach simply show as empty, as they already can.

## 5. Frontend — add-account modal

Tabs change from «Telegram / Instagram» to
**«Аккаунт конкурента» / «Свой аккаунт»**.

- **Аккаунт конкурента:** helper text «Вставьте ссылку на Telegram-канал
  или Instagram-аккаунт», placeholder `https://t.me/channel или
  https://instagram.com/brand`. Same debounced preview → «Добавить» flow
  as today; the preview card's platform icon shows the detected network.
  - On `instagram_discovery_not_connected`: a panel «Чтобы добавлять
    конкурентов из Instagram, один раз подключите Facebook» with a
    «Подключить Facebook» button (full-page redirect, like the Instagram
    connect button).
  - On `instagram_discovery_reconnect`: same panel, button
    «Переподключить Facebook».
- **Свой аккаунт:** today's Instagram connect helper text and button, unchanged.
- The page that hosts the modal opens it on the competitor tab when the
  URL has `?add=competitor`, and shows `discoveryError` (if present) as the
  modal's error. The query params are then removed from the URL.

## 6. Testing

Following existing patterns (Jest backend, Vitest + RTL frontend, TDD):
- `parseAccountLink`: profile links with trailing segments, `@`, `www.`,
  query strings; post/reel/stories links rejected; invalid usernames.
- Discovery client: request URL/fields, response mapping, cursor paging.
- Discovery OAuth service: state consumed, token exchange chain, Page
  without Instagram account, token stored encrypted, reconnect clears flag.
- Connector: branch by account type; competitor posts mapped with null
  insights; auth error flags the discovery connection, not an account
  credential; rate limit → pause.
- AccountsService: Instagram links accepted; not-connected / reconnect
  error codes; not-found message; duplicate checks.
- Modal: tab labels; Instagram preview; connect panel for both error codes;
  `?add=competitor` opens the modal and shows `discoveryError`.

## 7. Task 0 — verify against the live API before building on it

Done by the user on the VPS / Graph API Explorer (the assistant cannot
reach Meta from this environment):
1. Business Discovery works with the long-lived **user** token; check
   whether it also works with the **Page** token (decides §4.1 step 4).
2. Whether `business_discovery` media returns `view_count` / views for
   reels (if yes, map them; otherwise views stay null).
3. Whether the Business Discovery `id` of the user's own account equals
   the `externalId` stored for it by Instagram Login (decides §4.3 dedup).
4. Exact error code/subcode for a personal or non-existent username.

## 8. One-time Meta setup (user)

In the existing Meta app: add the use case «Instagram API with Facebook
Login» (Facebook Login for Business), add the redirect URI
`https://fdagency.duckdns.org/api/instagram/discovery/callback`, and put
the Facebook App ID / secret from *App settings → Basic* into `.env` as
`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`. As app admin, Standard Access
suffices; no App Review.
