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

### Telegram webhooks need HTTPS

Telegram refuses to register a plain-HTTP webhook, so this is what makes the
Telegram connector work at all. After the certificate is live, point each
tracked account's webhook at the HTTPS URL. Credentials come from the
container's own environment, so no token is typed:

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

`{"ok":true,...}` means it took. The `secret_token` is echoed back by Telegram on
every update and checked by `TelegramWebhookGuard`; without it the endpoint would
be an open write path.
