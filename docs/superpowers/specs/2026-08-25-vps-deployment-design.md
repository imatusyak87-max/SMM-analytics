# VPS Deployment Design

**Status:** Approved for planning
**Related:** [Core Platform + Telegram Connector Implementation Plan](../plans/2026-08-13-core-platform-telegram-connector.md), [Social Media Dashboard Design Spec](../specs/2026-08-13-social-media-dashboard-design.md)

## 1. Purpose

Deploy the core platform + Telegram connector (implemented on the `core-platform-telegram` branch, currently unmerged and living in `.worktrees/core-platform-telegram`) to a single Ubuntu/Debian VPS with nothing pre-installed except SSH access. This is a first production deployment: no domain yet, HTTP only, single operator, single VPS. TLS/domain, CI/CD, backups, and multi-user auth are explicitly out of scope (see §9).

## 2. Constraints (as decided with the user)

- VPS: Ubuntu/Debian, nothing installed yet — Docker must be installed as part of this work.
- No domain pointed at the VPS yet. Deploy over plain HTTP. TLS is a deferred follow-up, not part of this plan.
- Because there is no HTTPS, the Telegram Bot API webhook (`setWebhook`) cannot be registered — Telegram rejects non-HTTPS webhook URLs. Live post ingestion via webhook stays inactive until a domain + TLS are added later. Scheduled stats sync (follower counts via `getChatMemberCount`/`getChat`, outbound HTTP calls the VPS makes, not inbound) is unaffected and works over plain HTTP.
- **Revised during execution:** the assistant's Bash tool cannot originate outbound SSH connections at all (confirmed against both the VPS and, as a control, GitHub's own SSH server — TCP connects, but the SSH banner exchange never completes; HTTPS from the same environment works fine). Deployment therefore cannot be carried out by the assistant driving SSH directly, contrary to the original plan. VPS-side steps (Tasks 4-6 of the implementation plan) are run by the user directly, from their own terminal or the VPS provider's console, following a runbook. See the revised §4 below for how code reaches the VPS given this constraint.
- The repo had no git remote when this was written. Because the assistant can push over HTTPS but not SSH, code is hosted on a **private GitHub repository** (`https://github.com/imatusyak87-max/SMM-analytics`) rather than a bare repo on the VPS — see §4.

## 3. Architecture

```
Internet
   |
   |  HTTP :80
   v
+----------------------------------------------------------+
|  VPS (Ubuntu/Debian)                                      |
|                                                            |
|  docker network: smm-internal (bridge, no published ports |
|  except nginx's 80)                                       |
|                                                            |
|   +--------+      +---------+      +-------------------+  |
|   | nginx  |----->| backend |----->| postgres           |  |
|   | :80    |      | :3000   |      | (internal only)    |  |
|   | (also  |      | (Nest)  |      +-------------------+  |
|   | serves |      |         |      +-------------------+  |
|   | static |      |         |----->| redis (BullMQ)     |  |
|   | React  |      |         |      | (internal only)    |  |
|   | build) |      +---------+      +-------------------+  |
|   +--------+                                                |
|                                                            |
|  GitHub (private repo, SMM-analytics) <--- deploy key ---- |
|  /opt/smm-dashboard/app  (git clone of the repo;           |
|    docker compose runs here)                                |
+----------------------------------------------------------+
```

`nginx` is the only container with a published host port. `backend`, `postgres`, and `redis` are reachable only by service name on the internal Docker network. `ufw` additionally blocks all inbound ports except 22 (SSH) and 80 (HTTP) at the OS level, so a Docker networking misconfiguration can't accidentally expose Postgres/Redis to the internet.

## 4. Code delivery: GitHub + deploy key, manual pull-to-deploy

**Revised from the original bare-repo design** (see §2): the assistant cannot drive `git push`-to-VPS itself over SSH, so code is hosted on a private GitHub repo instead, and the VPS pulls from it — run by the user, not automated by a push hook.

- Code lives at `https://github.com/imatusyak87-max/SMM-analytics` (private), pushed there over HTTPS with a short-lived, repo-scoped fine-grained personal access token (used once, then revoked — not stored anywhere).
- On the VPS: an SSH keypair is generated locally on the VPS (`ssh-keygen`, no passphrase, dedicated to this purpose) and its **public** key is added to the GitHub repo as a read-only **Deploy key** (repo Settings → Deploy keys). This lets the VPS clone/pull the private repo over SSH — the VPS's own outbound SSH to github.com is unaffected by the assistant's environment limitation, since that limitation is specific to the assistant's Bash tool, not the VPS.
- Initial checkout: `git clone git@github.com:imatusyak87-max/SMM-analytics.git /opt/smm-dashboard/app` (deploy key must be loaded, e.g. via `ssh-agent` or an explicit `GIT_SSH_COMMAND`), then `git checkout core-platform-telegram` (the branch with the implemented app — not `master`, which only holds docs/specs/plans).
- Redeploys: `cd /opt/smm-dashboard/app && git pull && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d`, then re-run migrations (§8). This is a manual sequence the user runs themselves (or scripts into a one-liner on the VPS) — there is no push-triggered hook in this revised design, since standing up and testing such a hook would itself require the assistant to SSH in, which it cannot do.
- Future connector plans (VK, YouTube, Instagram, LinkedIn) reuse this same GitHub-hosted, pull-based path.

## 5. Runtime topology: `docker-compose.prod.yml`

A new compose file, separate from the existing dev-oriented `docker-compose.yml` (which keeps working for local development unchanged):

- **`postgres`**: `postgres:16-alpine`, named volume for data, `restart: unless-stopped`, **no `ports:` mapping** (internal network only). Credentials from `.env` (§7), not the hardcoded `postgres/postgres` dev default.
- **`redis`**: `redis:7-alpine`, `restart: unless-stopped`, **no `ports:` mapping**.
- **`backend`**: built from `backend/Dockerfile` (unchanged — it already produces a production `node dist/main.js` image), `restart: unless-stopped`, **no `ports:` mapping** — reached only by `nginx` at `backend:3000` on the internal network. `env_file: .env`.
- **`nginx`**: built from a new `frontend/Dockerfile.prod` (§6), the sole service with `ports: ["80:80"]`, `restart: unless-stopped`, depends on `backend`.

All four services share one Docker Compose network (Compose's default network for the project is sufficient — no need to declare a custom one).

## 6. Frontend production build

`frontend/Dockerfile` currently runs `npm run dev -- --host`, a dev server not meant for production traffic. A new **`frontend/Dockerfile.prod`** (multi-stage):

1. Build stage: `node:20-alpine`, `npm ci`, `npm run build` → static assets in `frontend/dist`.
2. Serve stage: `nginx:alpine`, copy the built assets into `/usr/share/nginx/html`, copy a custom `frontend/nginx.conf` that:
   - Serves the static SPA with a fallback to `index.html` for client-side routing (`/accounts/:id`, `/compare`, etc.).
   - Reverse-proxies `/api/` to `http://backend:3000/` (stripping the `/api` prefix) for all JSON API calls, and proxies `/webhooks/` and `/health` to `http://backend:3000` unprefixed.

The `/api` prefix is required, not cosmetic: the backend's REST routes (`/accounts`, `/accounts/:id`, etc.) and the frontend's client-side route `/accounts/:id` (the account detail page) share the same path. Proxying `/accounts/` straight to the backend would mean a browser refresh on the detail page hits the backend's JSON endpoint instead of serving `index.html`. Namespacing API calls under `/api` (nginx rewrites `/api/foo` → `/foo` before proxying) avoids the collision without changing any backend route. The frontend build gets a new `frontend/.env.production` (`VITE_API_URL=/api`), which Vite loads automatically for `npm run build`; the frontend's existing dev config (`VITE_API_URL` unset, defaulting to `http://localhost:3000` per `frontend/src/api/client.ts`) is untouched. `/webhooks/` and `/health` don't collide with any frontend route, so they stay unprefixed, matching §10's `http://<vps-ip>/webhooks/telegram/:accountId` and §12's `curl http://<vps-ip>/health`.

The existing dev `frontend/Dockerfile` is untouched; `docker-compose.prod.yml` points at `Dockerfile.prod` instead.

## 7. Secrets & configuration

A `.env` file is created directly on the VPS at `/opt/smm-dashboard/app/.env` (already covered by the repo's `.gitignore`; never committed). Values:

- `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `TELEGRAM_WEBHOOK_SECRET`: generated with `openssl rand -hex 32` (32 bytes hex, matching the format `.env.example` documents for `CREDENTIAL_ENCRYPTION_KEY`).
- `POSTGRES_USER=postgres`, `POSTGRES_DB=smm_dashboard`: fixed values, matching the existing dev compose file.
- `POSTGRES_PASSWORD`: generated with `openssl rand -hex 20`, used consistently in both the `postgres` service environment and `DATABASE_URL`.
- `DATABASE_URL=postgres://postgres:<generated>@postgres:5432/smm_dashboard`
- `REDIS_URL=redis://redis:6379`
- `TELEGRAM_BOT_TOKEN`: supplied by the user (from @BotFather) during deployment — not generated.
- `PORT=3000`

## 8. Database migrations

The committed TypeORM migration (`backend/src/db/migrations/InitialSchema*`, from Task 4 of the implementation plan) is run against the fresh `postgres` container as an explicit manual step (§4) after `backend`'s image is built, using a one-off `docker compose exec` invocation of the TypeORM CLI — not `synchronize: true` (which is test-only per the existing `DbModule` config, and must stay that way in prod).

## 9. Initial login user

No user-creation path exists today (the implementation plan's Task 5 assumed a manual `INSERT` with a hand-computed bcrypt hash). This deployment adds a small, reusable seed script:

- **New file:** `backend/src/db/seed-user.ts` — takes an email and password (via CLI args or env vars), bcrypt-hashes the password, and upserts a `User` row by email using the existing `User` entity and a short-lived TypeORM `DataSource` connection (reusing `AppDataSource` from `backend/src/db/data-source.ts`).
- **New script:** `backend/package.json` gets a `seed:user` script (e.g. `ts-node src/db/seed-user.ts` or the compiled `dist` equivalent) so it can be run the same way locally and in prod.
- Run once during initial deployment via `docker compose exec backend ...`; safe to re-run later to reset the password (upsert, not insert-only).

This is a minimal, targeted addition — not a general admin/user-management feature — scoped to what deployment actually needs: a way to log in.

## 10. Telegram webhook — explicitly deferred

`setWebhook` is **not** called as part of this deployment. Documented as a known, intentional gap:

- The `TELEGRAM_BOT_TOKEN` is configured so the bot can authenticate outbound Bot API calls (`getChat`, `getChatMemberCount` for scheduled stats sync).
- The webhook endpoint (`POST /webhooks/telegram/:accountId`) is deployed and reachable at `http://<vps-ip>/webhooks/telegram/:accountId`, but Telegram will refuse to register it via `setWebhook` because it isn't HTTPS.
- Follow-up (out of scope here, left as a note for later): once a domain points at the VPS, add TLS (e.g. Let's Encrypt via certbot or a reverse-proxy with automatic HTTPS) and call `setWebhook` with the HTTPS URL and `TELEGRAM_WEBHOOK_SECRET`.

## 11. OS-level hardening

- `ufw`: allow OpenSSH, allow `80/tcp`, deny everything else by default, then enable.
- Docker's systemd service is enabled (`systemctl enable docker`) so containers with `restart: unless-stopped` come back automatically after a VPS reboot — no separate systemd unit for Compose itself is needed.

## 12. Verification

After deployment:
- `docker compose -f docker-compose.prod.yml ps` — all four services `running`.
- `curl http://<vps-ip>/health` → `{ "status": "ok" }` through nginx → backend.
- Log in via the deployed frontend using the seeded user's credentials.
- Create a Telegram account entry and confirm a scheduled/manual sync populates a follower-count snapshot (proves outbound Bot API calls work end-to-end through the deployed stack).
- Confirm `docker compose -f docker-compose.prod.yml ps` shows `postgres`/`redis` with no host port bindings, and `ufw status` shows only 22 and 80 open.

## 13. Out of scope

- Domain registration, TLS/HTTPS, and the resulting Telegram webhook registration (§10).
- CI/CD (GitHub Actions or similar) — deploys are a manual `git pull` + rebuild sequence run by the user on the VPS for now.
- Database backups/snapshots.
- Multi-user auth, roles, or an admin UI for user management (the seed script in §9 is a one-off CLI tool, not a feature).
- Log aggregation, monitoring, alerting.
- Horizontal scaling / multi-VPS.
