# VPS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the core platform + Telegram connector to a fresh Ubuntu/Debian VPS over plain HTTP (no domain yet), with a repeatable `git push`-to-deploy workflow for future connector plans.

**Architecture:** A new `docker-compose.prod.yml` runs `postgres`/`redis`/`backend` on an internal-only Docker network behind a single `nginx` container (the only published port, 80) that serves the built React app and reverse-proxies `/api/*` (prefix-stripped), `/webhooks/*`, and `/health` to the backend. Code reaches the VPS via `git push` to a bare repo whose `post-receive` hook rebuilds and restarts the stack and runs pending migrations.

**Tech Stack:** Docker, Docker Compose, nginx, TypeORM CLI (`typeorm-ts-node-commonjs`), bcrypt, ufw, git hooks.

**Spec:** [docs/superpowers/specs/2026-08-25-vps-deployment-design.md](../specs/2026-08-25-vps-deployment-design.md)

## Global Constraints

- HTTP only for this deployment — no domain/TLS, and the Telegram webhook (`setWebhook`) is **not** registered; that's an explicit deferred follow-up (spec §2, §10).
- `postgres` and `redis` publish **no** host ports in `docker-compose.prod.yml` — reachable only by service name on the internal Docker network (spec §5).
- Secrets live only in `/opt/smm-dashboard/app/.env` on the VPS, generated with `openssl rand` — never committed to git (spec §7).
- Migrations run via the TypeORM CLI (`typeorm-ts-node-commonjs migration:run`) against the real database on every deploy; `synchronize` stays `false` outside tests, unchanged from the existing `DbModule`/`data-source.ts` config (spec §8).
- Code reaches the VPS via `git push` to a bare repo at `/opt/smm-dashboard.git` — no GitHub, no CI (spec §4).
- `ufw` allows only `22/tcp` (SSH) and `80/tcp` (HTTP), default-deny otherwise (spec §11).
- All application code in this plan (Tasks 1-3) is created/committed on the **`core-platform-telegram` branch**, inside the worktree at `.worktrees/core-platform-telegram/` — that's where the implemented app already lives (backend, frontend, existing `docker-compose.yml`). Tasks 4-6 are infrastructure-only (VPS + git remote), touch no files in that worktree, and produce no repo commits.
- Never write the VPS IP address, SSH credentials, or generated secrets into any file inside the repository (worktree or otherwise) — they're session-only / VPS-only values.

---

## Task 1: Backend — seed-user script

**Files:**
- Create: `backend/src/db/seed-user.ts`
- Create: `backend/src/db/seed-user.spec.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `User` entity (`backend/src/db/entities/user.entity.ts`), `AppDataSource` (`backend/src/db/data-source.ts`) — both already exist on this branch.
- Produces: exported `seedUser(usersRepo: Repository<User>, email: string, password: string, name: string): Promise<void>` (bcrypt-hashes the password, upserts by `email`) and a CLI entrypoint runnable as `node dist/db/seed-user.js <email> <password> [name]` — used in Task 6 to create the first login user on the deployed VPS.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/db/seed-user.spec.ts
import * as bcrypt from 'bcrypt';
import { seedUser } from './seed-user';

describe('seedUser', () => {
  it('upserts a user with a bcrypt-hashed password, keyed by email', async () => {
    const repo = { upsert: jest.fn() } as any;

    await seedUser(repo, 'admin@example.com', 'correct-horse', 'Admin');

    expect(repo.upsert).toHaveBeenCalledTimes(1);
    const [record, conflictPaths] = repo.upsert.mock.calls[0];
    expect(record.email).toBe('admin@example.com');
    expect(record.name).toBe('Admin');
    expect(conflictPaths).toEqual(['email']);
    expect(await bcrypt.compare('correct-horse', record.passwordHash)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from the worktree): `cd backend && npm test -- seed-user.spec.ts`
Expected: FAIL (`seed-user` module not found / `seedUser` not exported)

- [ ] **Step 3: Implement the script**

```typescript
// backend/src/db/seed-user.ts
import 'reflect-metadata';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';

export async function seedUser(
  usersRepo: Repository<User>,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 10);
  await usersRepo.upsert({ email, passwordHash, name }, ['email']);
}

async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password) {
    console.error('Usage: seed-user <email> <password> [name]');
    process.exit(1);
  }
  await AppDataSource.initialize();
  try {
    await seedUser(AppDataSource.getRepository(User), email, password, name ?? 'Admin');
    console.log(`Seeded user ${email}`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- seed-user.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the npm script**

```json
// backend/package.json — add to "scripts" alongside the existing "start:prod"
"seed:user": "node dist/db/seed-user.js"
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/seed-user.ts backend/src/db/seed-user.spec.ts backend/package.json
git commit -m "feat: add seed-user CLI script for creating the first login user"
```

---

## Task 2: Frontend — production Dockerfile and nginx reverse proxy

**Files:**
- Create: `frontend/Dockerfile.prod`
- Create: `frontend/nginx.conf`
- Create: `frontend/.env.production`

**Interfaces:**
- Consumes: `frontend/src/api/client.ts`'s `VITE_API_URL` env var (existing) — Vite loads `.env.production` automatically when running `npm run build` (mode `production`).
- Produces: an nginx-served static build on port 80 that proxies `/api/*` → `http://backend:3000/*` (prefix stripped) and `/webhooks/*`, `/health` → `http://backend:3000` unprefixed. Consumed by the `nginx` service in `docker-compose.prod.yml` (Task 3).

- [ ] **Step 1: Set the production API base path**

```
# frontend/.env.production
VITE_API_URL=/api
```

- [ ] **Step 2: Write the nginx config**

```nginx
# frontend/nginx.conf
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        rewrite ^/api/(.*)$ /$1 break;
        proxy_pass http://backend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /webhooks/ {
        proxy_pass http://backend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location = /health {
        proxy_pass http://backend:3000;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 3: Write the production Dockerfile**

```dockerfile
# frontend/Dockerfile.prod
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

- [ ] **Step 4: Build the image**

Run: `cd frontend && docker build -f Dockerfile.prod -t smm-frontend-prod .`
Expected: build succeeds (exit code 0).

- [ ] **Step 5: Smoke-test static serving**

Run:
```bash
docker run --rm -d -p 8080:80 --name smm-frontend-smoke smm-frontend-prod
curl -s http://localhost:8080/ | grep -o 'id="root"'
docker stop smm-frontend-smoke
```
Expected: prints `id="root"` (confirms `index.html` is served). The `/api/` proxy target (`backend:3000`) doesn't exist in this standalone smoke test — that's expected; the reverse-proxy path is verified against the real stack in Task 6, not here.

- [ ] **Step 6: Commit**

```bash
git add frontend/Dockerfile.prod frontend/nginx.conf frontend/.env.production
git commit -m "feat: add production frontend image with nginx reverse proxy"
```

---

## Task 3: `docker-compose.prod.yml`

**Files:**
- Create: `docker-compose.prod.yml` (worktree root, alongside the existing dev `docker-compose.yml`, which is untouched)

**Interfaces:**
- Consumes: `backend/Dockerfile` (existing, builds `node dist/main.js`), `frontend/Dockerfile.prod` + `frontend/nginx.conf` (Task 2).
- Produces: `postgres`, `redis`, `backend`, `nginx` services on Compose's default network. Consumed directly by the `post-receive` hook written in Task 5.

- [ ] **Step 1: Write the compose file**

```yaml
# docker-compose.prod.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: ["pgdata:/var/lib/postgresql/data"]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  backend:
    build: ./backend
    env_file: .env
    depends_on: [postgres, redis]
    restart: unless-stopped

  nginx:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    depends_on: [backend]
    ports: ["80:80"]
    restart: unless-stopped

volumes:
  pgdata:
```

- [ ] **Step 2: Validate the compose file syntax**

Run (from the worktree root; a throwaway, differently-named env file supplies the variables `config` needs to interpolate, passed explicitly via `--env-file` so the real dev `.env` already present in this worktree is never touched):
```bash
cp .env.example .env.prod-validate
printf '\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=placeholder\nPOSTGRES_DB=smm_dashboard\n' >> .env.prod-validate
docker compose --env-file .env.prod-validate -f docker-compose.prod.yml config --quiet
rm .env.prod-validate
```
Expected: no output, exit code 0 (a non-zero exit or printed error means the compose file has a syntax problem).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat: add production docker-compose stack (internal-only db/redis, nginx entrypoint)"
```

---

## Task 4: Provision the VPS

**Files:** none — this task makes no changes inside the repository; it prepares the VPS itself over SSH.

**Interfaces:**
- Produces: a VPS with Docker Engine, the Compose plugin, and `ufw` installed and configured — required by Task 5 (bare repo + hook) and Task 6 (first deploy).

- [ ] **Step 1: Get connection details**

If not already known this session, ask the user for: the VPS IP address, the SSH username, and the authentication method (existing key on this machine, or a password to enter interactively). Do not write these into any file in the repository — hold them only in the shell session for the remainder of this plan.

- [ ] **Step 2: Confirm SSH connectivity**

Run: `ssh <user>@<vps-ip> "echo connected"`
Expected: prints `connected`.

- [ ] **Step 3: Install base packages**

Run: `ssh <user>@<vps-ip> "sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg git ufw"`
Expected: exit code 0.

- [ ] **Step 4: Install Docker Engine and the Compose plugin**

Run: `ssh <user>@<vps-ip> "curl -fsSL https://get.docker.com | sudo sh"`
Expected: script completes without error; Docker's official install script also enables and starts the `docker` service.

- [ ] **Step 5: Verify Docker and enable it on boot**

Run: `ssh <user>@<vps-ip> "docker --version && docker compose version && sudo systemctl enable docker"`
Expected: both version commands print a version string; `enable` succeeds (or reports it's already enabled).

- [ ] **Step 6: Configure the firewall**

Run: `ssh <user>@<vps-ip> "sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw --force enable && sudo ufw status"`
Expected: `ufw status` output shows exactly `22/tcp ALLOW` (or `OpenSSH ALLOW`), `80/tcp ALLOW`, and `Status: active`.

No commit for this task — nothing in the repository changed.

---

## Task 5: Bare git repo and deploy hook on the VPS

**Files:** none in the repository — creates `/opt/smm-dashboard.git` and `/opt/smm-dashboard/app` on the VPS, and adds a local git remote.

**Interfaces:**
- Consumes: `docker-compose.prod.yml` (Task 3), the backend/frontend images it builds (Tasks 1-2), which must already be committed on the branch being pushed.
- Produces: a `post-receive` hook that checks out `master` into `/opt/smm-dashboard/app`, builds/starts the prod stack, and runs migrations — triggered by `git push` in Task 6. Also produces the local `vps` git remote used to trigger it.

- [ ] **Step 1: Create the bare repo and target directories**

Run: `ssh <user>@<vps-ip> "sudo mkdir -p /opt/smm-dashboard.git /opt/smm-dashboard/app && sudo chown -R \$(whoami):\$(whoami) /opt/smm-dashboard.git /opt/smm-dashboard/app && git init --bare /opt/smm-dashboard.git"`
Expected: prints `Initialized empty Git repository in /opt/smm-dashboard.git/`.

- [ ] **Step 2: Install the post-receive hook**

Run:
```bash
ssh <user>@<vps-ip> "cat > /opt/smm-dashboard.git/hooks/post-receive" <<'EOF'
#!/bin/sh
set -e
git --work-tree=/opt/smm-dashboard/app --git-dir=/opt/smm-dashboard.git checkout -f master
cd /opt/smm-dashboard/app
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
echo "Waiting for postgres to accept connections..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose -f docker-compose.prod.yml exec -T backend npx typeorm-ts-node-commonjs migration:run -d src/db/data-source.ts
EOF
ssh <user>@<vps-ip> "chmod +x /opt/smm-dashboard.git/hooks/post-receive"
```
Expected: no error output; the hook file exists and is executable (`ssh <user>@<vps-ip> "ls -l /opt/smm-dashboard.git/hooks/post-receive"` shows the `x` permission bit).

- [ ] **Step 3: Add the local git remote**

Run (from the worktree): `git remote add vps ssh://<user>@<vps-ip>/opt/smm-dashboard.git`
Expected: `git remote -v` lists `vps` with the correct URL.

No commit for this task — the remote is local git config, not a tracked file; the hook lives on the VPS.

---

## Task 6: First deploy — secrets, push, migrate, seed, verify

**Files:** none in the repository — writes `/opt/smm-dashboard/app/.env` on the VPS and pushes already-committed code.

**Interfaces:**
- Consumes: everything from Tasks 1-5 (seed script, prod images, compose file, bare repo + hook, VPS access).
- Produces: a running deployment, verified against spec §12.

- [ ] **Step 1: Get the Telegram bot token and desired login credentials**

Ask the user for: their Telegram bot token (from @BotFather) and the email/password they want for the first login user. Hold these only in the shell session — never write them into the repository.

- [ ] **Step 2: Generate secrets and write `.env` on the VPS**

Run:
```bash
ssh <user>@<vps-ip> bash -s <<'EOF'
set -e
mkdir -p /opt/smm-dashboard/app
JWT_SECRET=$(openssl rand -hex 32)
CRED_KEY=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)
PG_PASSWORD=$(openssl rand -hex 20)
cat > /opt/smm-dashboard/app/.env <<ENV
DATABASE_URL=postgres://postgres:${PG_PASSWORD}@postgres:5432/smm_dashboard
REDIS_URL=redis://redis:6379
JWT_SECRET=${JWT_SECRET}
CREDENTIAL_ENCRYPTION_KEY=${CRED_KEY}
TELEGRAM_WEBHOOK_SECRET=${WEBHOOK_SECRET}
TELEGRAM_BOT_TOKEN=__SET_ME__
PORT=3000
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=smm_dashboard
ENV
echo "Wrote .env"
EOF
```
Expected: prints `Wrote .env`.

- [ ] **Step 3: Fill in the real bot token**

Run: `ssh <user>@<vps-ip> "sed -i 's|TELEGRAM_BOT_TOKEN=__SET_ME__|TELEGRAM_BOT_TOKEN=<real-token>|' /opt/smm-dashboard/app/.env"`
Expected: no output; `ssh <user>@<vps-ip> "grep TELEGRAM_BOT_TOKEN /opt/smm-dashboard/app/.env"` shows the real token, not `__SET_ME__`.

- [ ] **Step 4: Push to deploy**

Run (from the worktree): `git push vps core-platform-telegram:master`
Expected: push output includes the `post-receive` hook's build/up/migration output, ending with a line like `Migration InitialSchema... has been executed successfully` (or, on a re-deploy, `No migrations are pending`).

- [ ] **Step 5: Seed the first login user**

Run: `ssh <user>@<vps-ip> "cd /opt/smm-dashboard/app && docker compose -f docker-compose.prod.yml exec -T backend node dist/db/seed-user.js <email> <password> Admin"`
Expected: prints `Seeded user <email>`.

- [ ] **Step 6: Verify the stack is healthy**

Run: `ssh <user>@<vps-ip> "cd /opt/smm-dashboard/app && docker compose -f docker-compose.prod.yml ps"`
Expected: all four services (`postgres`, `redis`, `backend`, `nginx`) show state `running`/`Up`.

- [ ] **Step 7: Verify the API is reachable through nginx**

Run:
```bash
curl -s http://<vps-ip>/health
curl -s -X POST http://<vps-ip>/api/auth/login -H 'Content-Type: application/json' -d '{"email":"<email>","password":"<password>"}'
```
Expected: first call returns `{"status":"ok"}`; second returns JSON containing `accessToken`.

- [ ] **Step 8: Verify the firewall and internal-only DB/Redis**

Run: `ssh <user>@<vps-ip> "sudo ufw status && docker compose -f /opt/smm-dashboard/app/docker-compose.prod.yml -f /opt/smm-dashboard/app/docker-compose.prod.yml ps --format '{{.Names}} {{.Ports}}'"`
Expected: `ufw status` shows only `22/tcp`/`OpenSSH` and `80/tcp` as `ALLOW`; the `postgres` and `redis` rows show no host port mapping (empty or only the internal container port, no `0.0.0.0:`).

- [ ] **Step 9: Verify the frontend and an end-to-end Telegram sync**

Open `http://<vps-ip>/` in a browser and log in with the seeded credentials. Add a Telegram account the bot is an admin of (via the UI, which calls `POST /api/accounts`), then trigger a manual refresh (`POST /api/accounts/:id/sync` via the UI's refresh button) and confirm the sync job reaches `status: "success"` and the account's follower count populates — this exercises the deployed stack's outbound Telegram Bot API calls end-to-end.

No repository commit for this task — all changes are on the VPS, and the pushed code was already committed in Tasks 1-3.
