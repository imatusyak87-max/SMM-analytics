# Operations

## Database backups

The database holds accumulated daily snapshots of every tracked account. That
history **cannot be reconstructed**: the platform APIs report today's follower
count, never last month's. Losing the `pgdata` volume loses everything since day
one, while losing the application code costs a `git pull`. That asymmetry is why
this exists.

Postgres lives in a Docker named volume (`pgdata` in `docker-compose.prod.yml`),
so it survives `docker compose down` and rebuilds — but not a lost or rebuilt
VPS, a bad migration, or an accidental delete.

### What the script does

`scripts/backup-db.sh`, run nightly on the VPS:

1. Dumps the database with `pg_dump -Fc` (Postgres custom format) from inside the
   `postgres` container, so credentials never reach the host command line, the
   cron entry, or the process list.
2. Writes to a `.tmp` file and renames it into place only after the dump
   succeeds, is non-empty, and passes a `pg_restore --list` readability check.
   An interrupted or unreadable dump is deleted, never left looking valid.
3. Prunes dumps older than `RETENTION_DAYS` (default 14).
4. Appends to `/opt/smm-dashboard/backups/backup.log`.

Any failure exits non-zero with an `ERROR:` line in the log.

### Install (one time, on the VPS)

The script arrives with a normal `git pull`. Create the backup directory and
schedule it:

```bash
mkdir -p /opt/smm-dashboard/backups
chmod +x /opt/smm-dashboard/app/scripts/backup-db.sh
```

Run it once by hand first and read the output before trusting it to cron:

```bash
/opt/smm-dashboard/app/scripts/backup-db.sh
ls -lh /opt/smm-dashboard/backups
```

Then add the cron entry with `crontab -e` — 04:00 UTC, an hour after the 03:00
sync, so each dump contains that day's snapshot:

```
0 4 * * * /opt/smm-dashboard/app/scripts/backup-db.sh >> /opt/smm-dashboard/backups/cron.log 2>&1
```

### Copy backups off the VPS

Dumps on the same machine protect against a bad migration or an accidental
delete, but not against losing the VPS. Pull them down periodically, from
PowerShell on the Windows machine (substituting your SSH user):

```powershell
New-Item -ItemType Directory -Force C:\Backups\smm
cd C:\Backups\smm
scp youruser@78.17.37.21:"/opt/smm-dashboard/backups/smm-*.dump" .
```

Two things this form avoids. `scp` does not create the destination directory, so
it must exist first. And a Windows path as the final argument is ambiguous —
`scp` can read `C:\Backups` as host `C`, path `\Backups` — so change into the
target directory and pass `.` instead. A Git Bash style `/c/Backups/...` path
does not work here either: `C:\Windows\System32\OpenSSH\scp.exe` is a native
Windows binary and takes it literally.

### Restore drill — do this once

**An untested backup is not a backup.** Restore into a throwaway database and
confirm the data is really there:

```bash
cd /opt/smm-dashboard/app
DUMP=$(ls -t /opt/smm-dashboard/backups/smm-*.dump | head -1); echo "restoring $DUMP"
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists restore_test'
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" restore_test'
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_test' < "$DUMP"
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_test -c "SELECT count(*) AS accounts FROM accounts;"'
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_test -c "SELECT count(*) AS snapshots FROM account_snapshots;"'
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" restore_test'
```

If those counts match production, the backups are real. The block selects the
newest dump itself, so there is no filename to substitute, and it clears any
`restore_test` left behind by an earlier attempt. It only ever touches that
throwaway database.

`ERROR: relation "accounts" does not exist` means the restore step never ran and
you are querying an empty database — usually a dump path that does not exist,
which still leaves `createdb` done.

### Restore for real (destructive)

This overwrites the live database. Stop the backend first so nothing writes
during the restore:

```bash
cd /opt/smm-dashboard/app
docker compose -f docker-compose.prod.yml stop backend
DUMP=$(ls -t /opt/smm-dashboard/backups/smm-*.dump | head -1)   # or name one explicitly
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$DUMP"
docker compose -f docker-compose.prod.yml start backend
```

### Tuning

Override with environment variables, in the cron entry or the shell:
`APP_DIR`, `BACKUP_DIR`, `COMPOSE_FILE`, `RETENTION_DAYS`.

## Redeploying

`up -d --build` alone is not a safe redeploy: it starts the new backend image
immediately, before any migration has run. If the new code expects a column
the database does not have yet (an `erViews` NestJS entity is enough), the
running backend starts erroring on **every** `getAccountDetail` request and
**every** sync upsert with `column "erViews" does not exist` — the gap
between "container up" and "migration run" is not a step to leave until
later.

Run these in order, every time:

```bash
cd /opt/smm-dashboard/app && git pull
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker compose -f docker-compose.prod.yml exec -T backend npx typeorm migration:run -d dist/db/data-source.js
```

1. `git pull` — get the new code.
2. `up -d --build --remove-orphans` — rebuild and restart the changed
   services. `--remove-orphans` is required, not cosmetic: the frontend
   service was renamed from `nginx` to `caddy`, and without this flag the old
   `nginx` container is left running and keeps holding port 80, so the new
   `caddy` service never binds it.
3. `migration:run`, **immediately after** step 2, no gap. Until it runs, the
   backend that step 2 just started is serving the new code against the old
   schema, and fails every account-detail request and every sync job with a
   missing-column error.

Then confirm posts are actually flowing before considering the deploy done —
see "Checking for a markup change vs. a quiet channel" below, which runs the
same live-page check this redeploy would otherwise leave unverified.

**Never add `-v` to a `down` command.** `docker compose -f
docker-compose.prod.yml down -v` deletes both named volumes: `caddy_data`
(the TLS certificate — see "Don't delete the caddy_data volume" below) and
`pgdata` (every snapshot ever collected — see "Database backups" above,
which cannot be reconstructed from the platform APIs). A redeploy never needs
`down` at all; `up -d --build --remove-orphans` replaces containers in place.

## Ad-hoc queries against the live database

The same pattern works for any query — credentials come from the container's own
environment, so nothing secret is typed:

```bash
cd /opt/smm-dashboard/app && docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM accounts;"'
```

## HTTPS

The site is served by Caddy (the `caddy` service in `docker-compose.prod.yml`),
which obtains and renews a Let's Encrypt certificate on its own. There is no
certbot, no renewal cron entry, and nothing to remember — renewal happens about
30 days before expiry, in the background.

Two prerequisites, both one-time:

- `SITE_ADDRESS` in `.env` — the public hostname, e.g. `fdagency.duckdns.org`.
  It must match the DNS record exactly.
- Ports **80 and 443** open. 80 is not optional even though the site is HTTPS:
  Let's Encrypt validates over it, and Caddy uses it to redirect plain HTTP.

```bash
ufw allow 80/tcp && ufw allow 443/tcp
```

### Don't delete the caddy_data volume

`caddy_data` holds the issued certificate and the ACME account key. It survives
`docker compose down` and rebuilds, which is the point: Let's Encrypt caps
identical certificates at **5 per week**, so a container that re-requests on
every restart will exhaust the limit and leave the site without HTTPS for days.
Rebuild freely; just never `docker compose down -v`, which removes it (and
`pgdata` with it).

### Checking the certificate

```bash
curl -sSI https://$(grep '^SITE_ADDRESS=' /opt/smm-dashboard/app/.env | cut -d= -f2) | head -1
cd /opt/smm-dashboard/app && docker compose -f docker-compose.prod.yml logs caddy | grep -iE 'certificate|error' | tail -20
```

A first-time issue takes a few seconds. `challenge failed` in those logs almost
always means DNS points somewhere else or port 80 is closed — check both before
retrying, because each failed attempt counts against the rate limit.

### Telegram webhooks — do not register (dormant, would overwrite scraped data)

**Do not run the `setWebhook` command below.** Registering it will silently
overwrite every scraped post's `views` and reaction counts with blanks. Read
this whole section before touching a Telegram webhook.

Since the post-data work landed (see "Where Telegram post data comes from"
below), the Telegram connector reads posts by scraping the public preview page,
not through the Bot API or a webhook. Two things this section used to say are
no longer true, and one was never true:

- **A webhook is not what makes the Telegram connector work.** The connector
  needs no webhook at all. Posts, views, reactions, captions, and images all
  come from parsing `t.me/s/<channel>`.
- **A Telegram bot has exactly one webhook URL, not one per account.** Every
  `setWebhook` call replaces the previous registration. "Point each tracked
  account's webhook at the HTTPS URL" was never a workable model — registering
  a second account's webhook silently disconnects the first. There is no
  per-account webhook to point.
- `TelegramWebhookController` (`backend/src/connectors/telegram/telegram-webhook.controller.ts`)
  is dormant code left over from before the scraper existed. If a webhook were
  registered, Telegram's `channel_post` updates would land there and it would
  `upsert` on the same `(accountId, externalPostId)` key the scraper writes to,
  via `mapTelegramMessageToPost`, which sets `views: null, likes: 0` — because
  the Bot API payload carries neither. That upsert would overwrite the real,
  scraped view and reaction counts with those blanks the next time either path
  ran.

Before this could ever be safely enabled, both of the following would need to
change, each as its own reviewed piece of work:

1. The webhook upsert must stop overwriting `views` and `likes` — e.g. merge
   only the fields the Bot API actually reports, instead of writing over the
   whole row.
2. Registration would need to become one bot-level endpoint (register once,
   for the bot, not per account) rather than the current per-account shape,
   since a bot only ever has one webhook URL.

The command is kept below for reference only — for understanding what the
dormant controller was originally meant to receive, not for running it:

```bash
cd /opt/smm-dashboard/app
ACCOUNT_ID=<the account's uuid>
docker compose -f docker-compose.prod.yml exec -T backend node -e '
const [id] = process.argv.slice(1);
const url = `https://${process.env.SITE_ADDRESS}/webhooks/telegram/${id}`;
fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET }),
}).then((r) => r.json()).then((r) => console.log(url, r));
' "$ACCOUNT_ID"
```

`{"ok":true,...}` would mean it took, and the `secret_token` is echoed back by
Telegram on every update and checked by `TelegramWebhookGuard` — but per the
warning above, do not run this against a bot that is tracking any account for
posts.

## Where Telegram post data comes from

Post analytics (views, reactions, captions, images, exact publish time) for
Telegram come from parsing the public channel preview page,
`https://t.me/s/<channel>` — never the Bot API, which does not expose view
counts, reactions, or historical messages at all. This is why the connector
needs no webhook (see the section above): `TelegramPreviewClient` fetches the
preview page and `parsePreviewPage`
(`backend/src/connectors/telegram/telegram-preview.parser.ts`) parses it.
Older pages are paginated by requesting the preview with `?before=<id>` of the
oldest post seen so far — a real preview page renders its **oldest** post
first, so pagination always keys off the oldest `externalPostId` on the
current page, not the newest.

Two limits are inherent to this source, not bugs:

- **A channel that has disabled its web preview is read one post at a time.**
  `t.me/s/<channel>` redirects such a channel to its card page, which has no
  post blocks, so `parsePreviewPage` throws `PreviewUnavailableError` on the
  first page rather than reporting zero posts silently. `TelegramConnector.getPosts`
  then falls back to each post's embed page, `t.me/<channel>/<id>?embed=1`,
  which Telegram still serves: it finds the newest post id by probing, walks
  down id by id until it leaves the history window, skips deleted ids (their
  embed says "Post not found"), and counts an album once, under its lowest id,
  as the preview page would. That is one request per post, capped at 300 per
  sync — a busy channel over a long window is cut short with a logged warning.
  The sync fails only when no embed page exists either. Such channels usually
  also restrict saving content, and their embeds then say "Please open Telegram
  to view this post" instead of showing it: views, reactions and dates still
  come through, but captions and thumbnails do not.
- **View counts above 1000 are rounded by Telegram** in the page markup itself
  (e.g. `24.2M`, `3.38M`) — `parseCompactNumber` decodes the suffix, but the
  precision loss happens upstream, before the HTML is even generated. This is
  not something the parser can recover.

### Checking for a markup change vs. a quiet channel

Because this reads Telegram's live HTML instead of a stable API contract, a
Telegram redesign can silently break the parser. No fixture can catch that —
fixtures are frozen snapshots of markup that was already known to parse. The
only way to tell "the channel just hasn't posted in a while" apart from "the
parser is broken" is to run this check against a real, currently active
channel and read the output.

Run it on the VPS, inside the running `backend` container — the host only
holds the git checkout, not `node_modules`, since everything is installed
inside the Docker image. The container runs the compiled app from `dist/`
(see `backend/Dockerfile`: `npm run build` then `CMD ["node", "dist/main.js"]`,
`WORKDIR /app`), so requiring the compiled modules there is guaranteed to
work without depending on dev dependencies or a source build being present.
This follows the same `docker compose exec` pattern as the webhook section
above, and for the same quoting reason — the script is wrapped in single
quotes, so it is written with double quotes internally rather than single:

```bash
cd /opt/smm-dashboard/app && docker compose -f docker-compose.prod.yml exec -T backend node -e '
const { TelegramPreviewClient } = require("./dist/connectors/telegram/telegram-preview.client");
const { parsePreviewPage, PreviewUnavailableError } = require("./dist/connectors/telegram/telegram-preview.parser");

async function main() {
  const client = new TelegramPreviewClient();

  let posts1;
  try {
    const html1 = await client.fetchPage("durov");
    posts1 = parsePreviewPage(html1, "durov");
  } catch (err) {
    if (err instanceof PreviewUnavailableError) {
      console.error("PAGE 1 BROKEN:", err.message, "-- this is a real break: the markup changed, or the channel disabled its web preview.");
    } else {
      console.error("PAGE 1 ERROR (network or environment, not the parser):", err);
    }
    process.exitCode = 1;
    return;
  }
  console.log("page 1 posts:", posts1.length, posts1[0]);
  const oldest1 = posts1.reduce((a, b) => (a.publishedAt < b.publishedAt ? a : b));

  let posts2;
  try {
    const html2 = await client.fetchPage("durov", oldest1.externalPostId);
    posts2 = parsePreviewPage(html2, "durov");
  } catch (err) {
    if (err instanceof PreviewUnavailableError) {
      console.log("PAGE 2 END OF HISTORY:", err.message, "-- normal for a channel whose whole history fits on one page, not a failure. Rerun against a deep-history channel (durov has plenty) to actually exercise pagination.");
      return;
    }
    console.error("PAGE 2 ERROR (network or environment, not the parser):", err);
    process.exitCode = 1;
    return;
  }
  console.log("page 2 posts:", posts2.length, posts2[0]);
  const newest2 = posts2.reduce((a, b) => (a.publishedAt > b.publishedAt ? a : b));

  console.log("page 2 newest older than page 1 oldest:", newest2.publishedAt < oldest1.publishedAt);
  const ids1 = new Set(posts1.map((p) => p.externalPostId));
  console.log("no id overlap:", !posts2.some((p) => ids1.has(p.externalPostId)));
}
main().catch((err) => {
  console.error("UNEXPECTED ERROR:", err);
  process.exitCode = 1;
});
'
```

The same script also runs from a local checkout after `cd backend && npm run
build`, invoked directly with `node -e '...'` (not `npx ts-node`, which mangles
a multi-line `-e` argument on Windows) against the same `./dist/...` paths —
useful for checking the parser without touching the VPS.

Expected, against an active public channel like `durov`: `page 1 posts:` printed with a count
around 20 and a first post with a real `publishedAt` and non-null `views` (a `thumbnailUrl` if it
carries media); `page 2 posts:` printed similarly; both trailing lines printing `true`. The script
exits non-zero only on an actual break, never on end-of-history — see below.

`parsePreviewPage` never returns an empty array: per its own source, whenever it finds zero post
blocks it throws `PreviewUnavailableError` instead (see "A channel that has disabled its web
preview is read one post at a time" above). So "zero posts" is never something this script
prints — it is something that surfaces as a caught exception, and which exception, on which page,
is what tells break apart from ordinary end-of-history:

- **`PAGE 1 BROKEN` (`PreviewUnavailableError` on the *first* page)** is a real break: either the
  markup changed, or the channel disabled its web preview. `durov` keeps its preview enabled, so
  here it means the markup changed. Production does not fail on it straight away:
  `TelegramConnector.getPosts` falls back to per-post embed pages and fails the sync job only if
  those yield nothing either. This script does not try that fallback. Exits non-zero.
- **`PAGE 2 END OF HISTORY` (`PreviewUnavailableError` on a *later* page)** is normal, not a
  failure: it means the channel's whole history fit on the pages already walked.
  `TelegramConnector.getPosts` treats this identically — a later-page `PreviewUnavailableError`
  just stops the walk and returns what was collected, it does not fail the job. `durov` has far
  more than one page of history, so seeing this here would be unexpected for that specific
  channel — if it happens, rerun against another deep-history channel before concluding anything,
  since a short-history channel legitimately ends within one page. Exits zero.
- **`views` null on a post that visibly shows a view count on t.me, while `page 1 posts` still
  printed a nonzero count** means the parser is finding post blocks but failing to extract views
  from them specifically — still a real break, just not the same failure shape as
  `PreviewUnavailableError`.
- **`PAGE 1 ERROR` / `PAGE 2 ERROR`, or `UNEXPECTED ERROR`** (anything that isn't a
  `PreviewUnavailableError`) is a network or environment problem — a timeout, DNS failure, or
  similar — not evidence the parser is broken. Exits non-zero, but don't treat it as a markup
  change without ruling out connectivity first.
- **Either trailing `true`/`false` line printing `false`** means pagination broke — either
  `?before=` stopped working, or the "oldest post first" assumption no longer holds.

A real break (page 1, or a trailing assertion `false`) means the parser needs a fix and its
fixtures need updating — that is real implementation work with its own review, not something to
patch inline while running an operational check.

## Подбор конкурентов

- Requires `GEMINI_API_KEY` in `/opt/smm-dashboard/app/.env`. Without it the
  feature is disabled and the rest of the app is unaffected.
- Model: `gemini-3.6-flash` on the free tier, **without** web search. It names
  competitors from its own knowledge; every handle is then checked against the
  Telegram Bot API, so invented channels never reach the page. Costs $0.
  - Why not search: Google Search grounding was free only on 2.5 models, and
    those are closed to new Google projects (a request returns 404 "no longer
    available to new users"). On 3.x, grounding needs billing enabled on the
    Google Cloud project — 5,000 free searches a month, then $14 per 1,000,
    plus paid token rates. Enabling it means restoring the `google_search`
    tool in `backend/src/competitors/gemini.finder.ts`.
  - If a model is ever withdrawn again, the run row's `errorMessage` carries
    Google's own explanation, e.g. `Gemini не ответил (HTTP 404): …`.
- A run happens automatically after a channel's first sync, and whenever
  «Обновить конкурентов» is pressed.
- A new `GEMINI_API_KEY` in `.env` only reaches the process when the backend
  container is **recreated** — `docker compose -f docker-compose.prod.yml up -d
  --build` (part of the normal redeploy sequence above). A plain `restart`
  reuses the old environment and the key change has no effect.
- Inspect runs:
  `docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT \"createdAt\", status, niche, \"candidatesProposed\", \"candidatesVerified\", \"errorMessage\" FROM competitor_runs ORDER BY \"createdAt\" DESC LIMIT 10;"'`
- Besides existing, a candidate must pass two filters
  (`backend/src/competitors/competitor-verifier.service.ts`):
  - **Groups** are dropped: a public @username can name a group as well as a
    channel (Telegram's page then says "N members, M online" instead of
    "subscribers"), and only `getChat` type `channel` passes.
  - **Spam funnels** are dropped: descriptions with two or more private invite
    links (`t.me/+…`, `t.me/joinchat/…`), or one alongside bait wording
    («закрытый», «резерв», «впускаем», «осталось N мест»…). Rules live in
    `spam-description.ts`.
  - **Inactive and empty channels** are dropped when the newest post on their
    public page `t.me/s/<handle>` is older than 90 days, or when that page shows
    the channel's post list with no posts in it. Channels that hide the page
    (it redirects to the generic `t.me/<handle>` page, with no channel header)
    are kept, since their activity is unknown.
- The page shows at most 10 channels. When fewer than 5 pass the checks, the
  run asks Gemini again, listing the channels already checked, for up to 3
  rounds in total; it stops early if Gemini has nothing new. Five is a target,
  not a guarantee: a narrow niche can still end with fewer. `candidatesProposed`
  and the token counts cover all rounds.
- A widening gap between `candidatesProposed` and `candidatesVerified` means the
  model is inventing channels — the signal for considering a different provider.
  The filters above also count against `candidatesVerified`.
- `COMPETITOR_LLM` selects the provider (default, and currently the only
  implemented one, is `gemini`). Setting it to anything else — `claude`
  included, which has no adapter yet — makes the backend throw at startup
  naming the unsupported value, rather than silently keep running Gemini.
  **Switching provider is not a config change**: it requires writing and
  wiring a new `CompetitorFinder` adapter (see `competitor-finder.ts`) before
  `COMPETITOR_LLM` can be pointed at it.
- **Recovering a stranded run.** Redis has no volume in
  `docker-compose.prod.yml`, so a redeploy wipes the queue. A run enqueued but
  not yet picked up at that moment leaves a `pending` (or `running`) row whose
  job no longer exists. The app treats such a row as stale on its own once it
  is more than 15 minutes old (a real run takes 1–2 minutes) and lets a new
  run start — nothing to do in the common case. If it needs fixing by hand
  sooner than that:
  ```bash
  docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE competitor_runs SET status='"'"'failed'"'"' WHERE status IN ('"'"'pending'"'"','"'"'running'"'"') AND \"createdAt\" < now() - interval '"'"'1 hour'"'"';"'
  ```

## Instagram

- Requires three environment variables in `/opt/smm-dashboard/app/.env`:
  `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI`. A new
  value for any of these only reaches the process when the backend container is
  **recreated** — `docker compose -f docker-compose.prod.yml up -d --build`
  (part of the normal redeploy sequence described above). A plain `restart`
  reuses the old environment and the change has no effect.
- The Meta app stays in development mode. Each connected Instagram account — the
  agency's own as well as every client's — must be manually added as a tester in
  the Meta app dashboard (`https://developers.meta.com/...`) and must accept the
  invite sent to the account's associated email before connecting through the UI.
- Token refresh runs at 2:30am, 30 minutes before the 3am sync, so a freshly
  refreshed token is ready when the sync fires. To check which accounts need
  re-authorization or have expiring tokens:
  ```bash
  docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT a.id, a.name, c.\"tokenExpiresAt\", c.\"needsReconnect\" FROM accounts a JOIN account_credentials c ON c.\"accountId\" = a.id WHERE a.platform = '"'"'instagram'"'"';"'
  ```
- `needsReconnect = true` means the stored access token is invalid, expired, or
  was revoked by Meta (e.g. via the deauthorize webhook). It blocks syncs for
  that account. Clear it by clicking the «Переподключить» button on the account
  detail page, which starts the OAuth flow again. On success, `needsReconnect`
  is set back to `false`.
- Deleting an Instagram account removes only the stored access token. All
  collected posts, follower snapshots, and other analytics history remain in
  the database, the same as for every other platform's account delete. Posts
  and snapshots tied to that account's `accountId` keep their foreign key but
  the account row itself is gone.
- Meta calls three public endpoints after successful authorization, deauthorization,
  or user data deletion — they are configured in the Meta app dashboard:
  - `GET /api/instagram/callback` — browser redirect after user approves the login
  - `POST /api/instagram/deauthorize` — notification when user revokes the app in Meta settings
  - `POST /api/instagram/data-deletion` — GDPR data deletion request
