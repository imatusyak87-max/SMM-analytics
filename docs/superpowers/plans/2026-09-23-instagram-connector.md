# Instagram Connector (Own & Client Accounts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Task 0 is not a subagent task.** It needs a real Meta app and real
> secrets, which only the user has. Do Task 0 directly with the user
> before dispatching Task 1.

**Goal:** Let the agency connect its own and its clients' Instagram
Business/Creator accounts through Instagram's OAuth login, then sync
their stats and posts daily through the existing sync pipeline.

**Architecture:** A new `InstagramModule` owns everything Instagram-specific
(OAuth state, token crypto, the API client, the connector, the refresh
cron, and the public OAuth/webhook endpoints). `ConnectorsModule` picks up
the resulting `InstagramConnector` the same way it already holds
`TelegramConnector`, so the daily sync (`SyncScheduler` → `SyncJobService`
→ `SyncProcessor` → `ConnectorRegistry`) needs no changes at all — this is
the entire reason that pipeline was built connector-agnostic. The one new
piece of UI is a platform tab inside the existing `AddAccountModal`.

**Tech Stack:** NestJS 11, TypeORM 0.3 (Postgres), `@nestjs/schedule`
(cron), axios, class-validator, Jest; React 19 for the modal/banner
changes, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-instagram-connector-design.md`

## Global Constraints

- `Account.externalId` for Instagram is the numeric Instagram user id
  (e.g. `"17841400000000000"`), never the `@username` — usernames can
  change; the id cannot. (Spec §3.) This is unlike Telegram, where
  `externalId` is the `@handle`.
- Access tokens are encrypted at rest with AES-256-GCM, keyed by
  `CREDENTIAL_ENCRYPTION_KEY` (already a 32-byte hex value in `.env`).
  The plaintext token never reaches the browser, a log line, or a URL.
  (Spec §4.)
- `AccountCredential.needsReconnect` is set **only** on an
  auth-specific failure (invalid/expired/revoked token) — never on a
  rate limit or a network error, which are just retried on the next
  scheduled run. (Spec §5, §10.)
- The connect/reconnect OAuth flow is **one code path**: the callback
  upserts on `(platform, externalId)` — insert if new, update the
  credential if the id already exists. There is no separate
  "reconnect" endpoint. (Spec §3.)
- Meta requires these exact URLs, already given to the user to paste
  into the Meta app dashboard — the backend's routes must match them
  exactly (after Caddy strips the `/api` prefix):
  - `GET /instagram/callback`
  - `POST /instagram/deauthorize`
  - `POST /instagram/data-deletion`
- Competitor Instagram lookups, Instagram in the competitor-finder LLM
  pipeline, Stories, and Meta App Review are out of scope. Do not build
  toward them.
- Deleting an Instagram account deletes its `AccountCredential` (stops
  our own access) but keeps its `Post`/`AccountSnapshot` history —
  same as `AccountsService.remove()` already does for every platform.
  (Spec §8, confirmed with the user.)

---

## Task 0 (prerequisite, not a subagent task): verify the real API

Do this directly with the user, once they have created the Meta app
(App ID + Secret in `.env` as `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`)
and added their own Instagram account as a tester and accepted the
invite. The goal is the same one that caught the Gemini 2.5 production
bug: don't trust a blog's claim about current API behavior — ask the
API.

Ask the user to run these from the server (same reasoning as the
Gemini diagnosis: this assistant cannot reach Instagram's API directly,
and secrets must never be typed into this chat):

1. **Authorize URL** — open in a browser, logged in as the tester
   account:
   ```
   https://www.instagram.com/oauth/authorize?client_id=<INSTAGRAM_APP_ID>&redirect_uri=https://fdagency.duckdns.org/api/instagram/callback&scope=instagram_business_basic,instagram_business_manage_insights&response_type=code
   ```
   Report: does it show a real consent screen? What scope names does it
   actually list? (If Meta's dashboard names different scopes than
   `instagram_business_basic`/`instagram_business_manage_insights`, use
   its exact names in Task 5.)

2. **After approving**, the browser lands on our callback URL with
   `?code=...` (it will 404 or error — the endpoint doesn't exist yet,
   that's expected). Copy the `code` value immediately — it expires in
   minutes.

3. **Exchange the code**, from the server, with `K` read from `.env`
   (never typed here):
   ```bash
   curl -s -X POST https://api.instagram.com/oauth/access_token \
     -F client_id="$INSTAGRAM_APP_ID" \
     -F client_secret="$INSTAGRAM_APP_SECRET" \
     -F grant_type=authorization_code \
     -F redirect_uri=https://fdagency.duckdns.org/api/instagram/callback \
     -F code="<the code from step 2>"
   ```
   Report the full JSON shape (field names, whether `user_id` is
   present, whether it's short-lived).

4. **Exchange for a long-lived token** using the short-lived
   `access_token` from step 3:
   ```bash
   curl -s "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=$INSTAGRAM_APP_SECRET&access_token=<short_lived_token>"
   ```
   Report the JSON shape and the `expires_in` value (expected ~5184000
   seconds / 60 days).

5. **Read the account**, using the long-lived token:
   ```bash
   curl -s "https://graph.instagram.com/v21.0/me?fields=id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url,biography&access_token=<long_lived_token>"
   ```
   Report the exact JSON — field names and types matter (is
   `followers_count` present for a Creator account, or Business only?).

6. **Read media**, same token:
   ```bash
   curl -s "https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&access_token=<long_lived_token>"
   ```
   Report the JSON for at least one post of each type the account has
   (image, video/reel, carousel if any).

7. **Read insights** for one media id from step 6:
   ```bash
   curl -s "https://graph.instagram.com/v21.0/<media-id>/insights?metric=reach,saved,shares&access_token=<long_lived_token>"
   ```
   Report the JSON, and report the exact error if any metric name is
   rejected (Instagram has deprecated insight metrics before without
   much notice — see spec §10).

8. **Force an auth error**, to see its real shape:
   ```bash
   curl -s "https://graph.instagram.com/v21.0/me?fields=id&access_token=not_a_real_token"
   ```
   Report the full JSON, especially `error.type` and `error.code`.

**Before Task 4 (error translation) and Task 5 (API client) are
implemented**, update their code below with whatever these eight
outputs actually show, in place of this plan's best-current-guess
values (which are drawn from Meta's long-documented `OAuthException`
code `190` for invalid tokens, and the endpoint shapes described in
this plan). If reality matches the plan, no change is needed — but
verify before assuming that.

---

## Task 1: `needsReconnect` column and the OAuth state table

**Files:**
- Modify: `backend/src/db/entities/account-credential.entity.ts`
- Create: `backend/src/db/entities/instagram-oauth-state.entity.ts`
- Create: `backend/src/db/migrations/1789500000000-AddInstagramSupport.ts`
- Modify: `backend/src/db/data-source.ts`
- Modify: `backend/src/db/db.module.ts`

**Interfaces:**
- Produces: `AccountCredential.needsReconnect: boolean`, and the
  `InstagramOauthState` entity (`id: string` (uuid, the state token
  itself), `type: 'own' | 'client'`, `createdAt: Date`) that every
  later task reads/writes.

- [ ] **Step 1: Add the column to the entity**

Edit `backend/src/db/entities/account-credential.entity.ts`:

```typescript
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('account_credentials')
export class AccountCredential {
  @PrimaryColumn('uuid') accountId: string;
  @Column({ type: 'text' }) encryptedToken: string;
  @Column({ nullable: true, type: 'timestamptz' }) tokenExpiresAt: Date | null;
  @Column({ nullable: true, type: 'text' }) refreshToken: string | null;
  /**
   * Set only on an auth-specific failure (invalid/expired/revoked token),
   * never on a rate limit or network error. Cleared the moment the
   * account reconnects or a scheduled refresh succeeds.
   */
  @Column({ default: false }) needsReconnect: boolean;
}
```

- [ ] **Step 2: Create the OAuth state entity**

Create `backend/src/db/entities/instagram-oauth-state.entity.ts`:

```typescript
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum InstagramAccountKind {
  OWN = 'own',
  CLIENT = 'client',
}

/**
 * A one-time correlator for one in-flight Instagram login. Stored in
 * Postgres, not Redis: Redis has no persistent volume in this deployment
 * (see competitor_runs' stale-run handling), and losing an in-flight
 * login on a restart is an acceptable, low-stakes failure the user just
 * retries — but it should not depend on Redis staying up for correctness
 * either way. The row is consumed (read + deleted) exactly once, by the
 * OAuth callback.
 */
@Entity('instagram_oauth_states')
export class InstagramOauthState {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'enum', enum: InstagramAccountKind }) type: InstagramAccountKind;
  @CreateDateColumn() createdAt: Date;
}
```

- [ ] **Step 3: Write the migration**

Create `backend/src/db/migrations/1789500000000-AddInstagramSupport.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Instagram OAuth support: a reconnect flag on credentials, and a table for in-flight logins. */
export class AddInstagramSupport1789500000000 implements MigrationInterface {
  name = 'AddInstagramSupport1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account_credentials" ADD "needsReconnect" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE TYPE "instagram_oauth_states_type_enum" AS ENUM('own', 'client')`,
    );
    await queryRunner.query(`
      CREATE TABLE "instagram_oauth_states" (
        "id" uuid NOT NULL,
        "type" "instagram_oauth_states_type_enum" NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_instagram_oauth_states" PRIMARY KEY ("id")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "instagram_oauth_states"`);
    await queryRunner.query(`DROP TYPE "instagram_oauth_states_type_enum"`);
    await queryRunner.query(`ALTER TABLE "account_credentials" DROP COLUMN "needsReconnect"`);
  }
}
```

- [ ] **Step 4: Register the new entity**

In `backend/src/db/data-source.ts`, add the import and include
`InstagramOauthState` in the `entities` array (follow the existing
pattern of one import per entity, alphabetise near the other
single-purpose entities).

In `backend/src/db/db.module.ts`, add `InstagramOauthState` to both the
`entities` array (for `TypeOrmModule.forRootAsync`) and to
`TypeOrmModule.forFeature([...])`, matching how `CompetitorRejection`
was added there.

- [ ] **Step 5: Verify the app still boots against the new schema**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (the pre-existing
`telegram-webhook.controller.spec.ts` TS2353 is unrelated and stays).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db
git commit -m "Add needsReconnect and the Instagram OAuth state table"
```

---

## Task 2: token encryption

**Files:**
- Create: `backend/src/connectors/instagram/instagram-token-crypto.ts`
- Test: `backend/src/connectors/instagram/instagram-token-crypto.spec.ts`

**Interfaces:**
- Produces: `encryptToken(plaintext: string, key: string): string` and
  `decryptToken(ciphertext: string, key: string): string`. `key` is
  the raw `CREDENTIAL_ENCRYPTION_KEY` env value (32-byte hex string).
  Every later task that touches `AccountCredential.encryptedToken`
  calls these two functions — no other code encrypts or decrypts a
  token.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-token-crypto.spec.ts`:

```typescript
import { encryptToken, decryptToken } from './instagram-token-crypto';

// 32 bytes, hex-encoded — the same shape as a real CREDENTIAL_ENCRYPTION_KEY.
const KEY = 'a'.repeat(64);

describe('instagram-token-crypto', () => {
  it('decrypts back to the original plaintext', () => {
    const ciphertext = encryptToken('IGQVJ...a-real-looking-token', KEY);

    expect(decryptToken(ciphertext, KEY)).toBe('IGQVJ...a-real-looking-token');
  });

  it('never stores the plaintext inside the ciphertext string', () => {
    const ciphertext = encryptToken('super-secret-token-value', KEY);

    expect(ciphertext).not.toContain('super-secret-token-value');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const first = encryptToken('same-token', KEY);
    const second = encryptToken('same-token', KEY);

    expect(first).not.toBe(second);
    expect(decryptToken(first, KEY)).toBe('same-token');
    expect(decryptToken(second, KEY)).toBe('same-token');
  });

  it('rejects a ciphertext that was tampered with', () => {
    const ciphertext = encryptToken('a-token', KEY);
    const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === 'AA' ? 'BB' : 'AA');

    expect(() => decryptToken(tampered, KEY)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-token-crypto -v`
Expected: FAIL — `Cannot find module './instagram-token-crypto'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-token-crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Encrypts a token for storage in AccountCredential.encryptedToken. Each
 * call uses a fresh random IV, so the same token never encrypts to the
 * same bytes twice. Stored as `${iv}:${authTag}:${ciphertext}`, all hex.
 */
export function encryptToken(plaintext: string, key: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptToken(stored: string, key: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(key, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-token-crypto -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-token-crypto.ts backend/src/connectors/instagram/instagram-token-crypto.spec.ts
git commit -m "Add AES-256-GCM encryption for Instagram tokens"
```

---

## Task 3: the OAuth state service

**Files:**
- Create: `backend/src/connectors/instagram/instagram-oauth-state.service.ts`
- Test: `backend/src/connectors/instagram/instagram-oauth-state.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramOauthState` entity (Task 1).
- Produces: `InstagramOauthStateService.create(type: InstagramAccountKind): Promise<string>`
  (returns the new state token id) and
  `.consume(id: string): Promise<InstagramAccountKind | null>` (returns
  the stored type and deletes the row, or `null` if the id doesn't
  exist or is older than 10 minutes — the row is deleted either way if
  found, so a second consume attempt always gets `null`). Task 6 (OAuth
  service) and Task 9 (connect endpoint) both depend on these two
  method names and this exact return shape.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-oauth-state.service.spec.ts`:

```typescript
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';

function makeRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    save: jest.fn((row) => row),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  } as any;
}

describe('InstagramOauthStateService', () => {
  it('creates a state row carrying the requested type and returns its id', async () => {
    const repo = makeRepo();
    const service = new InstagramOauthStateService(repo);

    const id = await service.create(InstagramAccountKind.OWN);

    expect(typeof id).toBe('string');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id, type: InstagramAccountKind.OWN }));
  });

  it('consumes a fresh state and returns its type, then deletes it', async () => {
    const createdAt = new Date();
    const repo = makeRepo({
      findOneBy: jest.fn().mockResolvedValue({ id: 'state-1', type: InstagramAccountKind.CLIENT, createdAt }),
    });
    const service = new InstagramOauthStateService(repo);

    const type = await service.consume('state-1');

    expect(type).toBe(InstagramAccountKind.CLIENT);
    expect(repo.delete).toHaveBeenCalledWith({ id: 'state-1' });
  });

  it('returns null for an id that does not exist', async () => {
    const repo = makeRepo({ findOneBy: jest.fn().mockResolvedValue(null) });
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume('missing')).toBeNull();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('returns null and still deletes a state older than 10 minutes', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    const repo = makeRepo({
      findOneBy: jest.fn().mockResolvedValue({ id: 'state-2', type: InstagramAccountKind.OWN, createdAt: old }),
    });
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume('state-2')).toBeNull();
    expect(repo.delete).toHaveBeenCalledWith({ id: 'state-2' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth-state.service -v`
Expected: FAIL — `Cannot find module './instagram-oauth-state.service'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-oauth-state.service.ts`:

```typescript
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstagramAccountKind, InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';

const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class InstagramOauthStateService {
  constructor(@InjectRepository(InstagramOauthState) private repo: Repository<InstagramOauthState>) {}

  async create(type: InstagramAccountKind): Promise<string> {
    const id = randomUUID();
    await this.repo.save({ id, type });
    return id;
  }

  /** Single-use: the row is deleted whether it was fresh, stale, or already consumed. */
  async consume(id: string): Promise<InstagramAccountKind | null> {
    const state = await this.repo.findOneBy({ id });
    if (!state) return null;
    await this.repo.delete({ id });

    const age = Date.now() - state.createdAt.getTime();
    return age <= STATE_TTL_MS ? state.type : null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth-state.service -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-oauth-state.service.ts backend/src/connectors/instagram/instagram-oauth-state.service.spec.ts
git commit -m "Add the Instagram OAuth state service"
```

---

## Task 4: error translation

**Files:**
- Create: `backend/src/connectors/instagram/instagram-error.ts`
- Test: `backend/src/connectors/instagram/instagram-error.spec.ts`

**Interfaces:**
- Produces: `translateInstagramError(error: unknown): Error` (a Russian
  message, following the `gemini.finder.ts` pattern) and
  `isInstagramAuthError(error: unknown): boolean`. Both take the *raw*
  error the API client (Task 5) throws untranslated — never a
  previously-translated `Error`. Task 7 (connector) and Task 11
  (refresh cron) call `isInstagramAuthError` first, to decide whether
  to set `needsReconnect`, then `translateInstagramError` for the
  message; Task 9 (OAuth service) calls only `translateInstagramError`,
  since a failed *login* has no existing credential to flag. Only
  `translateInstagramError`'s result is ever thrown or stored in
  `errorMessage`.
- **Before implementing:** compare against Task 0, step 8's real
  output. The code below assumes Meta's long-standing convention
  (`error.type === 'OAuthException'`, `error.code === 190` for an
  invalid/expired/revoked token) — correct the `isInstagramAuthError`
  check if step 8 showed something else.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-error.spec.ts`:

```typescript
import { translateInstagramError, isInstagramAuthError } from './instagram-error';

function axiosError(status: number, body: unknown, message = 'Request failed') {
  return { message, response: { status, data: body } };
}

describe('translateInstagramError', () => {
  it('reports an invalid/expired/revoked token in Russian', () => {
    const error = axiosError(400, { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } });

    expect(translateInstagramError(error).message).toBe('Instagram отклонил доступ, нужно переподключить аккаунт');
  });

  it('reports a rate limit in Russian', () => {
    const error = axiosError(429, { error: { type: 'OAuthException', code: 4, message: 'Application request limit reached' } });

    expect(translateInstagramError(error).message).toBe('Превышен лимит запросов к Instagram, попробуйте позже');
  });

  it('keeps the status and Instagram\'s own explanation for anything else', () => {
    const error = axiosError(500, { error: { message: 'Something went wrong, please try again' } });

    const translated = translateInstagramError(error);
    expect(translated.message).toMatch(/HTTP 500/);
    expect(translated.message).toMatch(/Something went wrong, please try again/);
  });

  it('describes a network failure with no response', () => {
    const error = { message: 'getaddrinfo ENOTFOUND graph.instagram.com' };

    expect(translateInstagramError(error).message).toBe('Instagram не ответил: getaddrinfo ENOTFOUND graph.instagram.com');
  });
});

describe('isInstagramAuthError', () => {
  it('is true for an OAuthException token error', () => {
    const error = axiosError(400, { error: { type: 'OAuthException', code: 190 } });

    expect(isInstagramAuthError(error)).toBe(true);
  });

  it('is false for a rate limit', () => {
    const error = axiosError(429, { error: { type: 'OAuthException', code: 4 } });

    expect(isInstagramAuthError(error)).toBe(false);
  });

  it('is false for a network error with no response', () => {
    expect(isInstagramAuthError({ message: 'ETIMEDOUT' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-error -v`
Expected: FAIL — `Cannot find module './instagram-error'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-error.ts`:

```typescript
interface InstagramApiError {
  response?: { status?: number; data?: { error?: { type?: string; code?: number; message?: string } } };
  message?: string;
}

/** Meta's long-standing OAuthException code for an invalid/expired/revoked token. */
const AUTH_ERROR_CODE = 190;
/** OAuthException code 4 is Meta's app-wide rate limit, not a token problem. */
const RATE_LIMIT_CODE = 4;

function igError(error: unknown) {
  return (error as InstagramApiError)?.response?.data?.error;
}

export function isInstagramAuthError(error: unknown): boolean {
  const e = igError(error);
  return e?.type === 'OAuthException' && e?.code === AUTH_ERROR_CODE;
}

export function translateInstagramError(error: unknown): Error {
  const status = (error as InstagramApiError)?.response?.status;
  const e = igError(error);

  if (isInstagramAuthError(error)) {
    return new Error('Instagram отклонил доступ, нужно переподключить аккаунт');
  }
  if (e?.type === 'OAuthException' && e?.code === RATE_LIMIT_CODE) {
    return new Error('Превышен лимит запросов к Instagram, попробуйте позже');
  }
  if (status !== undefined) {
    const message = e?.message || (error as InstagramApiError).message || 'неизвестная ошибка';
    return new Error(`Instagram не ответил (HTTP ${status}): ${message}`);
  }
  return new Error(`Instagram не ответил: ${(error as InstagramApiError).message ?? 'неизвестная ошибка'}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-error -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-error.ts backend/src/connectors/instagram/instagram-error.spec.ts
git commit -m "Translate Instagram API errors and classify auth failures"
```

---

## Task 5: the Instagram API client

**Files:**
- Create: `backend/src/connectors/instagram/instagram-api.client.ts`
- Test: `backend/src/connectors/instagram/instagram-api.client.spec.ts`

**Interfaces:**
- Produces (raw errors, untranslated — see the note below):
  - `exchangeCodeForToken(code: string): Promise<{ accessToken: string; instagramUserId: string }>`
  - `exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>`
  - `refreshLongLivedToken(longLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>`
  - `getProfile(accessToken: string): Promise<InstagramProfile>` where
    `InstagramProfile = { id: string; username: string; name: string | null; accountType: string; followersCount: number; followsCount: number; mediaCount: number; profilePictureUrl: string | null; biography: string | null }`
  - `getMedia(accessToken: string, after?: string): Promise<{ items: InstagramMedia[]; nextCursor: string | null }>` where
    `InstagramMedia = { id: string; caption: string | null; mediaType: string; mediaProductType: string | null; mediaUrl: string | null; thumbnailUrl: string | null; permalink: string | null; timestamp: string; likeCount: number; commentsCount: number }`
  - `getMediaInsights(accessToken: string, mediaId: string): Promise<{ reach: number | null; saved: number | null; shares: number | null }>`

  Task 6 (post mapper) consumes `InstagramMedia`/insights shapes; Task 7
  (connector) consumes every method above.
- **This client does not call `translateInstagramError` and never will.**
  It lets axios's own rejection propagate untouched. Translation happens
  exactly once, in whichever caller is about to give up and report a
  failure (Task 7's connector, Task 9's OAuth service, Task 11's refresh
  cron) — each of those needs the *raw* error first, to ask
  `isInstagramAuthError(error)` before deciding whether to set
  `needsReconnect`. If this client translated internally, every caller
  downstream would only ever see a plain `Error` with a Russian message
  and no `.response.data.error.code` to classify — `needsReconnect`
  would then silently never be set, in production, despite every
  mocked unit test passing. Do not add a try/catch here.
- **Before implementing:** compare field names and the exact endpoint
  hosts against Task 0's real output (steps 3, 4, 5, 6, 7). The code
  below is this plan's best-current understanding of the "Instagram API
  with Instagram Login" endpoints (`graph.instagram.com`, pinned to
  `v21.0`), not yet confirmed against a live response.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-api.client.spec.ts`:

```typescript
import axios from 'axios';
import { InstagramApiClient } from './instagram-api.client';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

describe('InstagramApiClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges an OAuth code for a short-lived token and the ig user id', async () => {
    mockedPost.mockResolvedValue({ data: { access_token: 'short-tok', user_id: '17841400000000000' } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://fdagency.duckdns.org/api/instagram/callback');

    const result = await client.exchangeCodeForToken('a-code');

    expect(result).toEqual({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    const [url, form] = mockedPost.mock.calls[0];
    expect(url).toBe('https://api.instagram.com/oauth/access_token');
    expect((form as URLSearchParams).get('code')).toBe('a-code');
    expect((form as URLSearchParams).get('client_secret')).toBe('app-secret');
  });

  it('exchanges a short-lived token for a long-lived one', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'long-tok', expires_in: 5184000 } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.exchangeForLongLivedToken('short-tok');

    expect(result).toEqual({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    expect(mockedGet.mock.calls[0][0]).toContain('grant_type=ig_exchange_token');
  });

  it('refreshes a long-lived token', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'refreshed-tok', expires_in: 5184000 } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.refreshLongLivedToken('long-tok');

    expect(result).toEqual({ accessToken: 'refreshed-tok', expiresInSeconds: 5184000 });
    expect(mockedGet.mock.calls[0][0]).toContain('grant_type=ig_refresh_token');
  });

  it('fetches the profile and maps snake_case fields', async () => {
    mockedGet.mockResolvedValue({
      data: {
        id: '17841400000000000',
        username: 'agency_client',
        name: 'Client Name',
        account_type: 'BUSINESS',
        followers_count: 4200,
        follows_count: 180,
        media_count: 96,
        profile_picture_url: 'https://scontent.cdninstagram.com/pic.jpg',
        biography: 'Coffee shop in Moscow',
      },
    } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const profile = await client.getProfile('a-token');

    expect(profile).toEqual({
      id: '17841400000000000',
      username: 'agency_client',
      name: 'Client Name',
      accountType: 'BUSINESS',
      followersCount: 4200,
      followsCount: 180,
      mediaCount: 96,
      profilePictureUrl: 'https://scontent.cdninstagram.com/pic.jpg',
      biography: 'Coffee shop in Moscow',
    });
  });

  it('fetches a page of media and the next cursor', async () => {
    mockedGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'media-1',
            caption: 'A post',
            media_type: 'IMAGE',
            media_product_type: 'FEED',
            media_url: 'https://cdn/img.jpg',
            thumbnail_url: null,
            permalink: 'https://instagram.com/p/abc',
            timestamp: '2026-09-01T10:00:00+0000',
            like_count: 40,
            comments_count: 3,
          },
        ],
        paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.instagram.com/...' },
      },
    } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.getMedia('a-token');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'media-1',
      caption: 'A post',
      mediaType: 'IMAGE',
      mediaProductType: 'FEED',
      mediaUrl: 'https://cdn/img.jpg',
      thumbnailUrl: null,
      permalink: 'https://instagram.com/p/abc',
      timestamp: '2026-09-01T10:00:00+0000',
      likeCount: 40,
      commentsCount: 3,
    });
    expect(result.nextCursor).toBe('cursor-2');
  });

  it('returns a null cursor on the last page', async () => {
    mockedGet.mockResolvedValue({ data: { data: [], paging: { cursors: { after: 'x' } } } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.getMedia('a-token');

    expect(result.nextCursor).toBeNull();
  });

  it('fetches media insights, tolerating a metric Instagram does not return', async () => {
    mockedGet.mockResolvedValue({
      data: { data: [{ name: 'reach', values: [{ value: 500 }] }, { name: 'saved', values: [{ value: 12 }] }] },
    } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const insights = await client.getMediaInsights('a-token', 'media-1');

    expect(insights).toEqual({ reach: 500, saved: 12, shares: null });
  });

  it('lets a failed request propagate untranslated — the caller classifies and translates it', async () => {
    const rawError = {
      response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } },
    };
    mockedGet.mockRejectedValue(rawError);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    await expect(client.getProfile('bad-token')).rejects.toBe(rawError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-api.client -v`
Expected: FAIL — `Cannot find module './instagram-api.client'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-api.client.ts`:

```typescript
import axios from 'axios';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

export interface InstagramProfile {
  id: string;
  username: string;
  name: string | null;
  accountType: string;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  profilePictureUrl: string | null;
  biography: string | null;
}

export interface InstagramMedia {
  id: string;
  caption: string | null;
  mediaType: string;
  mediaProductType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
}

export interface InstagramMediaInsights {
  reach: number | null;
  saved: number | null;
  shares: number | null;
}

const PROFILE_FIELDS =
  'id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url,biography';
const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

export class InstagramApiClient {
  constructor(
    private appId: string,
    private appSecret: string,
    private redirectUri: string,
  ) {}

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; instagramUserId: string }> {
    const form = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });
    const { data } = await axios.post('https://api.instagram.com/oauth/access_token', form);
    return { accessToken: data.access_token, instagramUserId: String(data.user_id) };
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const { data } = await axios.get(
      `${GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${this.appSecret}&access_token=${shortLivedToken}`,
    );
    return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
  }

  async refreshLongLivedToken(longLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const { data } = await axios.get(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${longLivedToken}`,
    );
    return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
  }

  async getProfile(accessToken: string): Promise<InstagramProfile> {
    const { data } = await axios.get(`${GRAPH_BASE}/me`, {
      params: { fields: PROFILE_FIELDS, access_token: accessToken },
    });
    return {
      id: data.id,
      username: data.username,
      name: data.name ?? null,
      accountType: data.account_type,
      followersCount: data.followers_count,
      followsCount: data.follows_count,
      mediaCount: data.media_count,
      profilePictureUrl: data.profile_picture_url ?? null,
      biography: data.biography ?? null,
    };
  }

  async getMedia(accessToken: string, after?: string): Promise<{ items: InstagramMedia[]; nextCursor: string | null }> {
    const { data } = await axios.get(`${GRAPH_BASE}/me/media`, {
      params: { fields: MEDIA_FIELDS, access_token: accessToken, ...(after ? { after } : {}) },
    });
    const items: InstagramMedia[] = (data.data ?? []).map((raw: any) => ({
      id: raw.id,
      caption: raw.caption ?? null,
      mediaType: raw.media_type,
      mediaProductType: raw.media_product_type ?? null,
      mediaUrl: raw.media_url ?? null,
      thumbnailUrl: raw.thumbnail_url ?? null,
      permalink: raw.permalink ?? null,
      timestamp: raw.timestamp,
      likeCount: raw.like_count ?? 0,
      commentsCount: raw.comments_count ?? 0,
    }));
    // Instagram includes a cursor even on the last page; `next` (the follow-up
    // URL) is only present when there truly is another page to fetch.
    const nextCursor = data.paging?.next ? (data.paging?.cursors?.after ?? null) : null;
    return { items, nextCursor };
  }

  async getMediaInsights(accessToken: string, mediaId: string): Promise<InstagramMediaInsights> {
    const { data } = await axios.get(`${GRAPH_BASE}/${mediaId}/insights`, {
      params: { metric: 'reach,saved,shares', access_token: accessToken },
    });
    const byName = new Map<string, number>(
      (data.data ?? []).map((metric: any) => [metric.name, metric.values?.[0]?.value ?? null]),
    );
    return {
      reach: byName.get('reach') ?? null,
      saved: byName.get('saved') ?? null,
      shares: byName.get('shares') ?? null,
    };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-api.client -v`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-api.client.ts backend/src/connectors/instagram/instagram-api.client.spec.ts
git commit -m "Add the Instagram Graph API client"
```

---

## Task 6: mapping Instagram media to a `ConnectorPost`

**Files:**
- Create: `backend/src/connectors/instagram/instagram-post-mapper.ts`
- Test: `backend/src/connectors/instagram/instagram-post-mapper.spec.ts`

**Interfaces:**
- Consumes: `InstagramMedia`, `InstagramMediaInsights` (Task 5);
  `PostType` (`backend/src/db/entities/post.entity.ts`, already has
  `IMAGE`/`VIDEO`/`CAROUSEL`/`REEL`).
- Produces: `mapInstagramPost(media: InstagramMedia, insights: InstagramMediaInsights): ConnectorPost`.
  Task 7 (connector) is the only caller.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-post-mapper.spec.ts`:

```typescript
import { mapInstagramPost } from './instagram-post-mapper';
import { PostType } from '../../db/entities/post.entity';
import { InstagramMedia, InstagramMediaInsights } from './instagram-api.client';

const baseMedia: InstagramMedia = {
  id: 'media-1',
  caption: 'A post about coffee',
  mediaType: 'IMAGE',
  mediaProductType: 'FEED',
  mediaUrl: 'https://cdn/img.jpg',
  thumbnailUrl: null,
  permalink: 'https://instagram.com/p/abc',
  timestamp: '2026-09-01T10:00:00+0000',
  likeCount: 40,
  commentsCount: 3,
};
const insights: InstagramMediaInsights = { reach: 500, saved: 12, shares: 4 };

describe('mapInstagramPost', () => {
  it('maps an image post', () => {
    const post = mapInstagramPost(baseMedia, insights);

    expect(post).toEqual({
      externalPostId: 'media-1',
      type: PostType.IMAGE,
      publishedAt: new Date('2026-09-01T10:00:00+0000'),
      permalink: 'https://instagram.com/p/abc',
      thumbnailUrl: 'https://cdn/img.jpg',
      caption: 'A post about coffee',
      likes: 40,
      comments: 3,
      shares: 4,
      views: null,
      reach: 500,
    });
  });

  it('prefers thumbnailUrl over mediaUrl when both are present (video)', () => {
    const video = { ...baseMedia, mediaType: 'VIDEO', mediaUrl: 'https://cdn/vid.mp4', thumbnailUrl: 'https://cdn/thumb.jpg' };

    expect(mapInstagramPost(video, insights).thumbnailUrl).toBe('https://cdn/thumb.jpg');
    expect(mapInstagramPost(video, insights).type).toBe(PostType.VIDEO);
  });

  it('maps a reel by media_product_type, not media_type', () => {
    const reel = { ...baseMedia, mediaType: 'VIDEO', mediaProductType: 'REELS' };

    expect(mapInstagramPost(reel, insights).type).toBe(PostType.REEL);
  });

  it('maps a carousel album', () => {
    const carousel = { ...baseMedia, mediaType: 'CAROUSEL_ALBUM' };

    expect(mapInstagramPost(carousel, insights).type).toBe(PostType.CAROUSEL);
  });

  it('treats a missing insights metric as null, not zero', () => {
    const noReach = { reach: null, saved: 5, shares: null };

    const post = mapInstagramPost(baseMedia, noReach);

    expect(post.reach).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-post-mapper -v`
Expected: FAIL — `Cannot find module './instagram-post-mapper'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-post-mapper.ts`:

```typescript
import { ConnectorPost } from '../connector.interface';
import { PostType } from '../../db/entities/post.entity';
import { InstagramMedia, InstagramMediaInsights } from './instagram-api.client';

function mapType(media: InstagramMedia): PostType {
  // media_product_type distinguishes a Reel from an ordinary video upload;
  // media_type alone cannot, since both report VIDEO.
  if (media.mediaProductType === 'REELS') return PostType.REEL;
  switch (media.mediaType) {
    case 'IMAGE':
      return PostType.IMAGE;
    case 'VIDEO':
      return PostType.VIDEO;
    case 'CAROUSEL_ALBUM':
      return PostType.CAROUSEL;
    default:
      return PostType.POST;
  }
}

export function mapInstagramPost(media: InstagramMedia, insights: InstagramMediaInsights): ConnectorPost {
  return {
    externalPostId: media.id,
    type: mapType(media),
    publishedAt: new Date(media.timestamp),
    permalink: media.permalink,
    // A video's own URL points at the file, not something a browser can render
    // as a preview image — prefer the thumbnail whenever Instagram supplies one.
    thumbnailUrl: media.thumbnailUrl ?? media.mediaUrl,
    caption: media.caption,
    likes: media.likeCount,
    comments: media.commentsCount,
    shares: insights.shares ?? 0,
    views: null,
    reach: insights.reach,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-post-mapper -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-post-mapper.ts backend/src/connectors/instagram/instagram-post-mapper.spec.ts
git commit -m "Map Instagram media and insights to ConnectorPost"
```

---

## Task 7: the Instagram connector

**Files:**
- Create: `backend/src/connectors/instagram/instagram.connector.ts`
- Test: `backend/src/connectors/instagram/instagram.connector.spec.ts`

**Interfaces:**
- Consumes: `InstagramApiClient` (Task 5), `mapInstagramPost` (Task 6),
  `isInstagramAuthError`/`translateInstagramError` (Task 4),
  `decryptToken` (Task 2), `AccountCredential` repository.
- Produces: `InstagramConnector implements SocialConnector`
  (`platform = AccountPlatform.INSTAGRAM`). Task 11 (connectors module)
  is the only place that instantiates it.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram.connector.spec.ts`:

```typescript
import { InstagramConnector } from './instagram.connector';
import { AccountPlatform } from '../../db/entities/account.entity';

const account = { id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' } as any;

function makeCredentialRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findOneBy: jest.fn().mockResolvedValue({ accountId: 'acc-1', encryptedToken: 'encrypted-form', needsReconnect: false }),
    update: jest.fn(),
    ...overrides,
  } as any;
}

// decryptToken is real (not mocked): 'encrypted-form' round-trips to 'plain-token'
// via a fixed test key, so the connector's real decrypt call is exercised too.
jest.mock('./instagram-token-crypto', () => ({
  decryptToken: jest.fn(() => 'plain-token'),
}));

describe('InstagramConnector', () => {
  const KEY = 'a'.repeat(64);

  it('getAccountInfo maps the decrypted profile', async () => {
    const api = { getProfile: jest.fn().mockResolvedValue({ username: 'agency_client', name: 'Client', profilePictureUrl: 'https://x/pic.jpg', biography: 'Bio' }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const info = await connector.getAccountInfo(account);

    expect(info).toEqual({ name: 'Client', avatarUrl: 'https://x/pic.jpg', description: 'Bio' });
    expect(api.getProfile).toHaveBeenCalledWith('plain-token');
  });

  it('falls back to the username when Instagram has no display name', async () => {
    const api = { getProfile: jest.fn().mockResolvedValue({ username: 'agency_client', name: null, profilePictureUrl: null, biography: null }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    expect((await connector.getAccountInfo(account)).name).toBe('agency_client');
  });

  it('getAccountStats maps follower/following/post counts', async () => {
    const api = { getProfile: jest.fn().mockResolvedValue({ followersCount: 4200, followsCount: 180, mediaCount: 96 }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    expect(await connector.getAccountStats(account)).toEqual({ followersCount: 4200, followingCount: 180, postsCount: 96 });
  });

  it('getPosts walks pages until sinceDate is passed and fetches insights per post', async () => {
    const newPost = { id: 'new', timestamp: '2026-09-10T00:00:00+0000', likeCount: 1, commentsCount: 0, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: null, mediaUrl: null, thumbnailUrl: null, permalink: null };
    const oldPost = { id: 'old', timestamp: '2026-08-01T00:00:00+0000', likeCount: 1, commentsCount: 0, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: null, mediaUrl: null, thumbnailUrl: null, permalink: null };
    const api = {
      getMedia: jest.fn().mockResolvedValue({ items: [newPost, oldPost], nextCursor: null }),
      getMediaInsights: jest.fn().mockResolvedValue({ reach: 10, saved: 1, shares: 0 }),
    };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const posts = await connector.getPosts(account, new Date('2026-09-01'));

    // 'old' is before sinceDate and is excluded from the result, but the walk
    // still fetches it so it can tell it has passed the window.
    expect(posts.map((p) => p.externalPostId)).toEqual(['new']);
    expect(api.getMediaInsights).toHaveBeenCalledWith('plain-token', 'new');
  });

  it('getAvatar downloads bytes from the profile_picture_url', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValue({ data: Buffer.from('img-bytes'), headers: { 'content-type': 'image/jpeg' } });
    const connector = new InstagramConnector({} as any, makeCredentialRepo(), KEY);

    const avatar = await connector.getAvatar('https://scontent.cdninstagram.com/pic.jpg');

    expect(avatar.data.toString()).toBe('img-bytes');
    expect(avatar.contentType).toBe('image/jpeg');
  });

  it('sets needsReconnect on the credential when a call fails with an auth error', async () => {
    const authError = { response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } } };
    const api = { getProfile: jest.fn().mockRejectedValue(authError) };
    const credentialRepo = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentialRepo, KEY);

    await expect(connector.getAccountInfo(account)).rejects.toThrow('Instagram отклонил доступ, нужно переподключить аккаунт');
    expect(credentialRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
  });

  it('does not touch needsReconnect for a rate limit or network error', async () => {
    const rateLimited = { response: { status: 429, data: { error: { type: 'OAuthException', code: 4 } } } };
    const api = { getProfile: jest.fn().mockRejectedValue(rateLimited) };
    const credentialRepo = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentialRepo, KEY);

    await expect(connector.getAccountInfo(account)).rejects.toThrow();
    expect(credentialRepo.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram.connector -v`
Expected: FAIL — `Cannot find module './instagram.connector'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram.connector.ts`:

```typescript
import axios from 'axios';
import { Repository } from 'typeorm';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { AccountInfo, AccountStats, AvatarImage, ConnectorPost, SocialConnector } from '../connector.interface';
import { InstagramApiClient } from './instagram-api.client';
import { decryptToken } from './instagram-token-crypto';
import { isInstagramAuthError, translateInstagramError } from './instagram-error';
import { mapInstagramPost } from './instagram-post-mapper';

export class InstagramConnector implements SocialConnector {
  platform = AccountPlatform.INSTAGRAM;

  constructor(
    private api: InstagramApiClient,
    private credentialsRepo: Repository<AccountCredential>,
    private encryptionKey: string,
  ) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const profile = await this.call(account, (token) => this.api.getProfile(token));
    return {
      // Business/Creator accounts are not required to set a display name — the
      // username is always present and is what the owner sees on their own profile.
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
      description: profile.biography,
    };
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const profile = await this.call(account, (token) => this.api.getProfile(token));
    return { followersCount: profile.followersCount, followingCount: profile.followsCount, postsCount: profile.mediaCount };
  }

  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    return this.call(account, async (token) => {
      const collected: ConnectorPost[] = [];
      let after: string | undefined;

      // Instagram's media list is newest-first; stop paging the moment a post
      // older than sinceDate is seen, same walk shape as the Telegram connector.
      paging: for (;;) {
        const { items, nextCursor } = await this.api.getMedia(token, after);
        for (const media of items) {
          if (new Date(media.timestamp) < sinceDate) break paging;
          const insights = await this.api.getMediaInsights(token, media.id);
          collected.push(mapInstagramPost(media, insights));
        }
        if (!nextCursor) break;
        after = nextCursor;
      }

      return collected;
    });
  }

  async getAvatar(fileRef: string): Promise<AvatarImage> {
    // Unlike Telegram's opaque file id, Instagram's profile_picture_url is a
    // real, directly downloadable URL — no extra API call needed to resolve it.
    const response = await axios.get(fileRef, { responseType: 'arraybuffer' });
    return {
      data: Buffer.from(response.data as ArrayBuffer),
      contentType: (response.headers?.['content-type'] as string) ?? 'image/jpeg',
    };
  }

  /**
   * Decrypts the stored token, runs `fn`, and — on an auth-specific failure
   * only — flags the credential for reconnect before rethrowing the
   * translated error. Every public method goes through this so the flag is
   * set consistently regardless of which call actually failed.
   */
  private async call<T>(account: Account, fn: (token: string) => Promise<T>): Promise<T> {
    const credential = await this.credentialsRepo.findOneBy({ accountId: account.id });
    if (!credential) throw new Error(`No Instagram credential stored for account ${account.id}`);
    const token = decryptToken(credential.encryptedToken, this.encryptionKey);

    try {
      return await fn(token);
    } catch (error) {
      if (isInstagramAuthError(error)) {
        await this.credentialsRepo.update({ accountId: account.id }, { needsReconnect: true });
      }
      throw translateInstagramError(error);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram.connector -v`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram.connector.ts backend/src/connectors/instagram/instagram.connector.spec.ts
git commit -m "Add the Instagram connector"
```

---

## Task 8: verifying Meta's signed requests

**Files:**
- Create: `backend/src/connectors/instagram/instagram-signed-request.ts`
- Test: `backend/src/connectors/instagram/instagram-signed-request.spec.ts`

**Interfaces:**
- Produces: `verifySignedRequest(signedRequest: string, appSecret: string): { userId: string } | null`.
  Task 10 (webhook controller) is the only caller. Returns `null` for a
  missing/malformed/wrongly-signed request rather than throwing, since
  a webhook must always answer with *some* HTTP response, not a 500.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-signed-request.spec.ts`:

```typescript
import { createHmac } from 'crypto';
import { verifySignedRequest } from './instagram-signed-request';

const APP_SECRET = 'test-app-secret';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload: object, secret = APP_SECRET): string {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest();
  return `${base64url(signature)}.${encodedPayload}`;
}

describe('verifySignedRequest', () => {
  it('returns the user id from a correctly signed request', () => {
    const signedRequest = sign({ user_id: '17841400000000000', algorithm: 'HMAC-SHA256' });

    expect(verifySignedRequest(signedRequest, APP_SECRET)).toEqual({ userId: '17841400000000000' });
  });

  it('rejects a request signed with the wrong secret', () => {
    const signedRequest = sign({ user_id: '123' }, 'a-different-secret');

    expect(verifySignedRequest(signedRequest, APP_SECRET)).toBeNull();
  });

  it('rejects a malformed request', () => {
    expect(verifySignedRequest('not-a-signed-request', APP_SECRET)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(verifySignedRequest('', APP_SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-signed-request -v`
Expected: FAIL — `Cannot find module './instagram-signed-request'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-signed-request.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verifies Meta's signed_request format (used by the deauthorize and
 * data-deletion webhooks): "<base64url signature>.<base64url JSON payload>",
 * signature = HMAC-SHA256(payload, app secret). Returns null instead of
 * throwing for anything malformed — a webhook handler must always be able
 * to respond, never crash on a request it doesn't recognise.
 */
export function verifySignedRequest(signedRequest: string, appSecret: string): { userId: string } | null {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [encodedSignature, encodedPayload] = parts;

  let expectedSignature: Buffer;
  let actualSignature: Buffer;
  try {
    expectedSignature = createHmac('sha256', appSecret).update(encodedPayload).digest();
    actualSignature = base64urlDecode(encodedSignature);
  } catch {
    return null;
  }
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
    return typeof payload.user_id === 'string' || typeof payload.user_id === 'number'
      ? { userId: String(payload.user_id) }
      : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-signed-request -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-signed-request.ts backend/src/connectors/instagram/instagram-signed-request.spec.ts
git commit -m "Verify Meta's signed_request format"
```

---

## Task 9: the OAuth service (connect URL + completing a login)

**Files:**
- Create: `backend/src/connectors/instagram/instagram-oauth.service.ts`
- Test: `backend/src/connectors/instagram/instagram-oauth.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramOauthStateService` (Task 3), `InstagramApiClient`
  (Task 5), `encryptToken` (Task 2), `translateInstagramError` (Task 4),
  `Account` and `AccountCredential` repositories.
- Produces:
  - `buildAuthorizeUrl(type: InstagramAccountKind): Promise<string>`
  - `completeLogin(code: string, state: string): Promise<Account>` —
    throws a plain `Error` with a message safe to show the user in
    every failure case: the state-expiry message directly, or
    `translateInstagramError`'s result if any of the three Instagram
    API calls fails (the client itself throws the raw, untranslated
    error — see Task 5's note — so this is the layer that turns it into
    something displayable). The caller (Task 10's controller) turns
    either into a 400 rather than a 500.

  Task 10 (controller) and Task 13 (`/accounts/instagram/connect`
  endpoint) are the only callers.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-oauth.service.spec.ts`:

```typescript
import { InstagramOauthService } from './instagram-oauth.service';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

function makeDeps() {
  const stateService = { create: jest.fn().mockResolvedValue('a-state-id'), consume: jest.fn() };
  const api = {
    exchangeCodeForToken: jest.fn(),
    exchangeForLongLivedToken: jest.fn(),
    getProfile: jest.fn(),
  };
  const accountsRepo = { findOneBy: jest.fn(), save: jest.fn((row) => ({ id: 'acc-new', ...row })) };
  const credentialsRepo = { findOneBy: jest.fn(), save: jest.fn(), update: jest.fn() };
  const service = new InstagramOauthService(
    stateService as any,
    api as any,
    accountsRepo as any,
    credentialsRepo as any,
    'app-id',
    'a'.repeat(64),
  );
  return { service, stateService, api, accountsRepo, credentialsRepo };
}

describe('InstagramOauthService.buildAuthorizeUrl', () => {
  it('creates a state for the given type and embeds it in the URL', async () => {
    const { service, stateService } = makeDeps();

    const url = await service.buildAuthorizeUrl(InstagramAccountKind.OWN);

    expect(stateService.create).toHaveBeenCalledWith(InstagramAccountKind.OWN);
    expect(url).toContain('state=a-state-id');
    expect(url).toContain('client_id=app-id');
  });
});

describe('InstagramOauthService.completeLogin', () => {
  it('rejects a missing or expired state before calling Instagram at all', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue(null);

    await expect(service.completeLogin('a-code', 'bad-state')).rejects.toThrow(
      'Ссылка для входа устарела, попробуйте подключить аккаунт заново',
    );
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('creates a new account and credential when the Instagram id is not tracked yet', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.CLIENT);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ username: 'client_account', name: 'Client', profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue(null);

    const account = await service.completeLogin('a-code', 'good-state');

    expect(accountsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000', type: AccountType.CLIENT }),
    );
    expect(credentialsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-new', needsReconnect: false }),
    );
    expect(account.id).toBe('acc-new');
  });

  it('updates the existing credential, and clears needsReconnect, when the Instagram id is already tracked', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ username: 'agency_own', name: null, profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue({ id: 'acc-existing', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' });

    const account = await service.completeLogin('a-code', 'good-state');

    expect(account.id).toBe('acc-existing');
    expect(accountsRepo.save).not.toHaveBeenCalled();
    expect(credentialsRepo.update).toHaveBeenCalledWith(
      { accountId: 'acc-existing' },
      expect.objectContaining({ needsReconnect: false }),
    );
  });

  it('stores the token encrypted, never the plaintext', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'the-real-long-lived-token', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ username: 'agency_own', name: null, profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue(null);

    await service.completeLogin('a-code', 'good-state');

    const saved = credentialsRepo.save.mock.calls[0][0];
    expect(saved.encryptedToken).not.toContain('the-real-long-lived-token');
  });

  it('translates a failed Instagram call into a Russian message', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockRejectedValue({
      response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } },
    });

    await expect(service.completeLogin('a-code', 'good-state')).rejects.toThrow(
      'Instagram отклонил доступ, нужно переподключить аккаунт',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth.service -v`
Expected: FAIL — `Cannot find module './instagram-oauth.service'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-oauth.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramApiClient, InstagramProfile } from './instagram-api.client';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { encryptToken } from './instagram-token-crypto';
import { translateInstagramError } from './instagram-error';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
// Confirmed against the real consent screen in Task 0, step 1.
const SCOPES = 'instagram_business_basic,instagram_business_manage_insights';

@Injectable()
export class InstagramOauthService {
  constructor(
    private stateService: InstagramOauthStateService,
    private api: InstagramApiClient,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    private appId: string,
    private encryptionKey: string,
  ) {}

  async buildAuthorizeUrl(type: InstagramAccountKind): Promise<string> {
    const state = await this.stateService.create(type);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async completeLogin(code: string, state: string): Promise<Account> {
    const type = await this.stateService.consume(state);
    if (!type) {
      throw new Error('Ссылка для входа устарела, попробуйте подключить аккаунт заново');
    }

    let shortLivedToken: string, instagramUserId: string, longLivedToken: string, expiresInSeconds: number;
    let profile: InstagramProfile;
    try {
      ({ accessToken: shortLivedToken, instagramUserId } = await this.api.exchangeCodeForToken(code));
      ({ accessToken: longLivedToken, expiresInSeconds } = await this.api.exchangeForLongLivedToken(shortLivedToken));
      profile = await this.api.getProfile(longLivedToken);
    } catch (error) {
      // The client throws raw, untranslated errors (Task 5) — this is the
      // layer that turns one into a message safe to show the user.
      throw translateInstagramError(error);
    }

    const encryptedToken = encryptToken(longLivedToken, this.encryptionKey);
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // externalId is Instagram's numeric user id, not @username — see the plan's
    // Global Constraints for why. This is what makes reconnect an update, not
    // a duplicate insert, on a second login for the same account.
    const existing = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: instagramUserId });

    if (existing) {
      await this.credentialsRepo.update(
        { accountId: existing.id },
        { encryptedToken, tokenExpiresAt, needsReconnect: false },
      );
      return existing;
    }

    const account = await this.accountsRepo.save({
      platform: AccountPlatform.INSTAGRAM,
      externalId: instagramUserId,
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
      type: type === InstagramAccountKind.OWN ? AccountType.OWN : AccountType.CLIENT,
      isActive: true,
    });
    await this.credentialsRepo.save({ accountId: account.id, encryptedToken, tokenExpiresAt, needsReconnect: false });
    return account;
  }

  private redirectUri(): string {
    return process.env.INSTAGRAM_REDIRECT_URI as string;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth.service -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-oauth.service.ts backend/src/connectors/instagram/instagram-oauth.service.spec.ts
git commit -m "Add the Instagram OAuth service: authorize URL and login completion"
```

---

## Task 10: the public OAuth/webhook controller

**Files:**
- Create: `backend/src/connectors/instagram/instagram-oauth.controller.ts`
- Test: `backend/src/connectors/instagram/instagram-oauth.controller.spec.ts`

**Interfaces:**
- Consumes: `InstagramOauthService.completeLogin` (Task 9),
  `verifySignedRequest` (Task 8), `AccountCredential` repository,
  `Account` repository.
- Produces: three routes, none behind `JwtAuthGuard` — reached by a
  browser redirect (callback) or by Meta's own servers (the other two),
  neither of which can carry our JWT:
  - `GET /instagram/callback?code&state` → 302 to `/accounts/:id` on
    success, or renders a 400 with a plain message on a bad/expired
    state (never a raw stack trace — same reasoning as every other
    user-facing error in this codebase).
  - `POST /instagram/deauthorize` → 200 with `{}` always (Meta expects
    a 200; a webhook that 500s gets retried and eventually disabled).
    On a valid signed request, marks that account's credential
    `needsReconnect = true`.
  - `POST /instagram/data-deletion` → 200 with
    `{ url: string, confirmation_code: string }` (Meta's required
    shape). Deletes the account's `AccountCredential` row only —
    `Post`/`AccountSnapshot` history stays, confirmed with the user.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-oauth.controller.spec.ts`:

```typescript
import { InstagramOauthController } from './instagram-oauth.controller';
import { AccountPlatform } from '../../db/entities/account.entity';

function makeController(overrides: Partial<Record<string, any>> = {}) {
  const oauthService = { completeLogin: jest.fn(), ...overrides.oauthService };
  const accountsRepo = { findOneBy: jest.fn(), ...overrides.accountsRepo };
  const credentialsRepo = { update: jest.fn(), delete: jest.fn(), ...overrides.credentialsRepo };
  const controller = new InstagramOauthController(oauthService, accountsRepo, credentialsRepo, 'app-secret');
  return { controller, oauthService, accountsRepo, credentialsRepo };
}

function fakeResponse() {
  return { redirect: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
}

describe('InstagramOauthController.callback', () => {
  it('redirects to the new account on a successful login', async () => {
    const { controller, oauthService } = makeController({ oauthService: { completeLogin: jest.fn().mockResolvedValue({ id: 'acc-1' }) } });
    const res = fakeResponse();

    await controller.callback('a-code', 'good-state', res);

    expect(oauthService.completeLogin).toHaveBeenCalledWith('a-code', 'good-state');
    expect(res.redirect).toHaveBeenCalledWith('/accounts/acc-1');
  });

  it('responds 400 with a plain message when the login cannot be completed', async () => {
    const { controller } = makeController({
      oauthService: { completeLogin: jest.fn().mockRejectedValue(new Error('Ссылка для входа устарела, попробуйте подключить аккаунт заново')) },
    });
    const res = fakeResponse();

    await controller.callback('a-code', 'bad-state', res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Ссылка для входа устарела, попробуйте подключить аккаунт заново' });
  });
});

describe('InstagramOauthController.deauthorize', () => {
  it('marks the matching account for reconnect and answers 200', async () => {
    const { createHmac } = require('crypto');
    const base64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const encodedPayload = base64url(JSON.stringify({ user_id: '17841400000000000' }));
    const signature = base64url(createHmac('sha256', 'app-secret').update(encodedPayload).digest());
    const signedRequest = `${signature}.${encodedPayload}`;

    const { controller, accountsRepo, credentialsRepo } = makeController({
      accountsRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' }) },
    });
    const res = fakeResponse();

    await controller.deauthorize({ signed_request: signedRequest }, res);

    expect(credentialsRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('answers 200 without touching anything when the signature is invalid', async () => {
    const { controller, credentialsRepo } = makeController();
    const res = fakeResponse();

    await controller.deauthorize({ signed_request: 'not-a-real-signed-request' }, res);

    expect(credentialsRepo.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('InstagramOauthController.dataDeletion', () => {
  it('deletes the credential and returns the confirmation shape Meta requires', async () => {
    const { createHmac } = require('crypto');
    const base64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const encodedPayload = base64url(JSON.stringify({ user_id: '17841400000000000' }));
    const signature = base64url(createHmac('sha256', 'app-secret').update(encodedPayload).digest());
    const signedRequest = `${signature}.${encodedPayload}`;

    const { controller, accountsRepo, credentialsRepo } = makeController({
      accountsRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' }) },
    });
    const res = fakeResponse();

    await controller.dataDeletion({ signed_request: signedRequest }, res);

    expect(credentialsRepo.delete).toHaveBeenCalledWith({ accountId: 'acc-1' });
    const body = res.json.mock.calls[0][0];
    expect(body.confirmation_code).toBeDefined();
    expect(typeof body.url).toBe('string');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth.controller -v`
Expected: FAIL — `Cannot find module './instagram-oauth.controller'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-oauth.controller.ts`:

```typescript
import { randomUUID } from 'crypto';
import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramOauthService } from './instagram-oauth.service';
import { verifySignedRequest } from './instagram-signed-request';

/**
 * Public: reached by a browser redirect (callback) or Meta's own servers
 * (deauthorize, data-deletion), neither of which can carry our JWT. Routes
 * match exactly what was configured in the Meta app dashboard — see the
 * plan's Global Constraints.
 */
@Controller('instagram')
export class InstagramOauthController {
  constructor(
    private oauthService: InstagramOauthService,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    private appSecret: string,
  ) {}

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      const account = await this.oauthService.completeLogin(code, state);
      res.redirect(`/accounts/${account.id}`);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  }

  @Post('deauthorize')
  async deauthorize(@Body() body: { signed_request: string }, @Res() res: Response) {
    const verified = verifySignedRequest(body?.signed_request ?? '', this.appSecret);
    if (verified) {
      const account = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: verified.userId });
      if (account) await this.credentialsRepo.update({ accountId: account.id }, { needsReconnect: true });
    }
    // Meta expects 200 regardless — an unrecognised signature is simply ignored,
    // never surfaced as an error to a system that will just retry it.
    res.status(200).json({});
  }

  @Post('data-deletion')
  async dataDeletion(@Body() body: { signed_request: string }, @Res() res: Response) {
    const verified = verifySignedRequest(body?.signed_request ?? '', this.appSecret);
    if (verified) {
      const account = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: verified.userId });
      // Deletes only our stored access; Post/AccountSnapshot history stays,
      // the same as deactivating any other account — confirmed with the user.
      if (account) await this.credentialsRepo.delete({ accountId: account.id });
    }
    const confirmationCode = randomUUID();
    res.status(200).json({
      url: `https://fdagency.duckdns.org/data-deletion-status/${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth.controller -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-oauth.controller.ts backend/src/connectors/instagram/instagram-oauth.controller.spec.ts
git commit -m "Add the public Instagram OAuth callback and Meta webhooks"
```

---

## Task 11: the proactive token-refresh cron

**Files:**
- Create: `backend/src/connectors/instagram/instagram-token-refresh.service.ts`
- Test: `backend/src/connectors/instagram/instagram-token-refresh.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramApiClient.refreshLongLivedToken` (Task 5),
  `decryptToken`/`encryptToken` (Task 2), `isInstagramAuthError` (Task
  4), `AccountCredential` + `Account` repositories.
- Produces: `InstagramTokenRefreshService.refreshExpiring(): Promise<void>`,
  decorated `@Cron('30 2 * * *')` so it runs 30 minutes before the
  existing 3am sync. Only Task 12 (module wiring) references this
  class directly.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/connectors/instagram/instagram-token-refresh.service.spec.ts`:

```typescript
import { InstagramTokenRefreshService } from './instagram-token-refresh.service';
import { AccountPlatform } from '../../db/entities/account.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeDeps() {
  const accountsRepo = { find: jest.fn() };
  const credentialsRepo = { find: jest.fn(), update: jest.fn() };
  const api = { refreshLongLivedToken: jest.fn() };
  const service = new InstagramTokenRefreshService(accountsRepo as any, credentialsRepo as any, api as any, 'a'.repeat(64));
  return { service, accountsRepo, credentialsRepo, api };
}

describe('InstagramTokenRefreshService.refreshExpiring', () => {
  it('refreshes a credential expiring within 7 days and stores the new token encrypted', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: 'iv:tag:cipher', tokenExpiresAt: new Date(Date.now() + 3 * DAY_MS) },
    ]);
    api.refreshLongLivedToken.mockResolvedValue({ accessToken: 'the-refreshed-token', expiresInSeconds: 5184000 });

    await service.refreshExpiring();

    expect(api.refreshLongLivedToken).toHaveBeenCalled();
    const update = credentialsRepo.update.mock.calls[0];
    expect(update[0]).toEqual({ accountId: 'acc-1' });
    expect(update[1].encryptedToken).not.toContain('the-refreshed-token');
    expect(update[1].needsReconnect).toBe(false);
  });

  it('leaves alone a credential that is not close to expiring', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([]); // the repo query itself excludes it; nothing to refresh

    await service.refreshExpiring();

    expect(api.refreshLongLivedToken).not.toHaveBeenCalled();
    expect(credentialsRepo.update).not.toHaveBeenCalled();
  });

  it('sets needsReconnect when a refresh fails on an auth error', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: 'iv:tag:cipher', tokenExpiresAt: new Date(Date.now() + DAY_MS) },
    ]);
    api.refreshLongLivedToken.mockRejectedValue({
      response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } },
    });

    await service.refreshExpiring();

    expect(credentialsRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
  });

  it('leaves needsReconnect alone when a refresh fails transiently', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: 'iv:tag:cipher', tokenExpiresAt: new Date(Date.now() + DAY_MS) },
    ]);
    api.refreshLongLivedToken.mockRejectedValue({ message: 'ETIMEDOUT' });

    await service.refreshExpiring();

    expect(credentialsRepo.update).not.toHaveBeenCalled();
  });

  it('keeps refreshing the remaining accounts after one fails', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([
      { id: 'acc-1', platform: AccountPlatform.INSTAGRAM },
      { id: 'acc-2', platform: AccountPlatform.INSTAGRAM },
    ]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: 'iv:tag:cipher', tokenExpiresAt: new Date(Date.now() + DAY_MS) },
      { accountId: 'acc-2', encryptedToken: 'iv:tag:cipher', tokenExpiresAt: new Date(Date.now() + DAY_MS) },
    ]);
    api.refreshLongLivedToken
      .mockRejectedValueOnce({ message: 'ETIMEDOUT' })
      .mockResolvedValueOnce({ accessToken: 'tok-2', expiresInSeconds: 5184000 });

    await service.refreshExpiring();

    expect(api.refreshLongLivedToken).toHaveBeenCalledTimes(2);
    expect(credentialsRepo.update).toHaveBeenCalledTimes(1);
    expect(credentialsRepo.update.mock.calls[0][0]).toEqual({ accountId: 'acc-2' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram-token-refresh -v`
Expected: FAIL — `Cannot find module './instagram-token-refresh.service'`

- [ ] **Step 3: Implement**

Create `backend/src/connectors/instagram/instagram-token-refresh.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramApiClient } from './instagram-api.client';
import { decryptToken, encryptToken } from './instagram-token-crypto';
import { isInstagramAuthError } from './instagram-error';

const REFRESH_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class InstagramTokenRefreshService {
  private readonly logger = new Logger(InstagramTokenRefreshService.name);

  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    private api: InstagramApiClient,
    private encryptionKey: string,
  ) {}

  /** Runs 30 minutes before the 3am sync, so a freshly refreshed token is ready when it fires. */
  @Cron('30 2 * * *')
  async refreshExpiring(): Promise<void> {
    const accounts = await this.accountsRepo.find({ where: { platform: AccountPlatform.INSTAGRAM } });
    const accountIds = new Set(accounts.map((a) => a.id));

    const dueSoon = await this.credentialsRepo.find({
      where: { tokenExpiresAt: LessThanOrEqual(new Date(Date.now() + REFRESH_WINDOW_DAYS * DAY_MS)) },
    });

    for (const credential of dueSoon.filter((c) => accountIds.has(c.accountId))) {
      try {
        const token = decryptToken(credential.encryptedToken, this.encryptionKey);
        const refreshed = await this.api.refreshLongLivedToken(token);
        await this.credentialsRepo.update(
          { accountId: credential.accountId },
          {
            encryptedToken: encryptToken(refreshed.accessToken, this.encryptionKey),
            tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
            needsReconnect: false,
          },
        );
      } catch (error) {
        if (isInstagramAuthError(error)) {
          await this.credentialsRepo.update({ accountId: credential.accountId }, { needsReconnect: true });
        } else {
          this.logger.warn(`Could not refresh Instagram token for account ${credential.accountId}: ${(error as Error).message}`);
        }
        // One account's failure must not stop the rest from refreshing.
      }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram-token-refresh -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-token-refresh.service.ts backend/src/connectors/instagram/instagram-token-refresh.service.spec.ts
git commit -m "Add the proactive Instagram token-refresh cron"
```

---

## Task 12: the Instagram module and wiring into `ConnectorsModule`

**Files:**
- Create: `backend/src/connectors/instagram/instagram.module.ts`
- Modify: `backend/src/connectors/connectors.module.ts`
- Modify: `backend/.env.example`, root `.env.example`
- Test: `backend/src/connectors/instagram/instagram.module.spec.ts`,
  `backend/src/connectors/connectors.module.spec.ts` (new file if one
  doesn't exist yet for this module — check first)

**Interfaces:**
- Consumes every class built in Tasks 1–11.
- Produces: `InstagramModule`, exporting `InstagramConnector` (so
  `ConnectorsModule`, Task 12 below, can add it to the `CONNECTORS`
  token alongside `TelegramConnector`) and `InstagramOauthService` (so
  `AccountsModule`, Task 13, can offer the connect endpoint).

- [ ] **Step 1: Check whether `connectors.module.spec.ts` exists**

Run: `ls backend/src/connectors/connectors.module.spec.ts`

If it exists, read it before writing Step 2's test so the new
assertions follow its existing style rather than duplicating a
different setup.

- [ ] **Step 2: Write the failing test**

Create `backend/src/connectors/instagram/instagram.module.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InstagramModule } from './instagram.module';
import { InstagramConnector } from './instagram.connector';
import { Account } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';

describe('InstagramModule', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INSTAGRAM_APP_ID: 'app-id',
      INSTAGRAM_APP_SECRET: 'app-secret',
      INSTAGRAM_REDIRECT_URI: 'https://fdagency.duckdns.org/api/instagram/callback',
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('provides an InstagramConnector', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InstagramModule] })
      .overrideProvider(getRepositoryToken(Account))
      .useValue({})
      .overrideProvider(getRepositoryToken(AccountCredential))
      .useValue({})
      .overrideProvider(getRepositoryToken(InstagramOauthState))
      .useValue({})
      .compile();

    expect(moduleRef.get(InstagramConnector)).toBeInstanceOf(InstagramConnector);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && npx jest src/connectors/instagram/instagram.module -v`
Expected: FAIL — `Cannot find module './instagram.module'`

- [ ] **Step 4: Implement the module**

Create `backend/src/connectors/instagram/instagram.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramApiClient } from './instagram-api.client';
import { InstagramConnector } from './instagram.connector';
import { InstagramOauthController } from './instagram-oauth.controller';
import { InstagramOauthService } from './instagram-oauth.service';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { InstagramTokenRefreshService } from './instagram-token-refresh.service';

const INSTAGRAM_API_CLIENT = 'INSTAGRAM_API_CLIENT';

/**
 * Owns everything Instagram-specific: OAuth state, credential encryption,
 * the API client, the connector, the token-refresh cron, and the public
 * OAuth/webhook endpoints. Exports InstagramConnector so ConnectorsModule
 * can add it to the platform-agnostic CONNECTORS registry — this module
 * does not depend on ConnectorsModule, only the other way around.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountCredential, InstagramOauthState])],
  controllers: [InstagramOauthController],
  providers: [
    {
      provide: INSTAGRAM_API_CLIENT,
      useFactory: () =>
        new InstagramApiClient(
          process.env.INSTAGRAM_APP_ID as string,
          process.env.INSTAGRAM_APP_SECRET as string,
          process.env.INSTAGRAM_REDIRECT_URI as string,
        ),
    },
    InstagramOauthStateService,
    {
      provide: InstagramOauthService,
      useFactory: (
        stateService: InstagramOauthStateService,
        api: InstagramApiClient,
        accountsRepo: any,
        credentialsRepo: any,
      ) =>
        new InstagramOauthService(
          stateService,
          api,
          accountsRepo,
          credentialsRepo,
          process.env.INSTAGRAM_APP_ID as string,
          process.env.CREDENTIAL_ENCRYPTION_KEY as string,
        ),
      inject: [InstagramOauthStateService, INSTAGRAM_API_CLIENT, 'AccountRepository', 'AccountCredentialRepository'],
    },
    {
      provide: InstagramConnector,
      useFactory: (api: InstagramApiClient, credentialsRepo: any) =>
        new InstagramConnector(api, credentialsRepo, process.env.CREDENTIAL_ENCRYPTION_KEY as string),
      inject: [INSTAGRAM_API_CLIENT, 'AccountCredentialRepository'],
    },
    {
      provide: InstagramTokenRefreshService,
      useFactory: (accountsRepo: any, credentialsRepo: any, api: InstagramApiClient) =>
        new InstagramTokenRefreshService(accountsRepo, credentialsRepo, api, process.env.CREDENTIAL_ENCRYPTION_KEY as string),
      inject: ['AccountRepository', 'AccountCredentialRepository', INSTAGRAM_API_CLIENT],
    },
    {
      provide: InstagramOauthController,
      useFactory: (oauthService: InstagramOauthService, accountsRepo: any, credentialsRepo: any) =>
        new InstagramOauthController(oauthService, accountsRepo, credentialsRepo, process.env.INSTAGRAM_APP_SECRET as string),
      inject: [InstagramOauthService, 'AccountRepository', 'AccountCredentialRepository'],
    },
  ],
  // InstagramConnector for ConnectorsModule (Task 12); InstagramOauthService
  // for AccountsModule's own connect endpoint (Task 13).
  exports: [InstagramConnector, InstagramOauthService],
})
export class InstagramModule {}
```

> Note on `'AccountRepository'` / `'AccountCredentialRepository'`: these
> string tokens are what `getRepositoryToken(Account)` /
> `getRepositoryToken(AccountCredential)` resolve to for entities named
> `Account` / `AccountCredential`. If `npx tsc --noEmit` or the test in
> Step 3 complains about an unresolved provider, replace the string with
> the literal `getRepositoryToken(Account)` (import it from
> `@nestjs/typeorm`) instead — functionally identical, just avoids
> depending on NestJS's string-token naming convention holding across
> versions.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npx jest src/connectors/instagram/instagram.module -v`
Expected: PASS, 1 test

- [ ] **Step 6: Wire into `ConnectorsModule`**

Modify `backend/src/connectors/connectors.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';
import { TelegramApiClient } from './telegram/telegram-api.client';
import { TelegramConnector } from './telegram/telegram.connector';
import { TelegramPreviewClient } from './telegram/telegram-preview.client';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { InstagramModule } from './instagram/instagram.module';
import { InstagramConnector } from './instagram/instagram.connector';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Post]), InstagramModule],
  controllers: [TelegramWebhookController],
  providers: [
    {
      provide: CONNECTORS,
      useFactory: (instagramConnector: InstagramConnector) => [
        new TelegramConnector(
          new TelegramApiClient(process.env.TELEGRAM_BOT_TOKEN as string),
          new TelegramPreviewClient(),
        ),
        instagramConnector,
      ],
      inject: [InstagramConnector],
    },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
```

- [ ] **Step 7: Add the new env vars**

In both `backend/.env.example` and the root `.env.example`, add after
the existing `CREDENTIAL_ENCRYPTION_KEY` line:

```
# Instagram OAuth (own & client accounts). Testers only until Meta App Review.
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=https://fdagency.duckdns.org/api/instagram/callback
```

- [ ] **Step 8: Full backend verification**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: every test passes (the full existing suite plus everything
from Tasks 1–12); `tsc` shows only the pre-existing
`telegram-webhook.controller.spec.ts` TS2353.

- [ ] **Step 9: Commit**

```bash
git add backend/src/connectors backend/.env.example .env.example
git commit -m "Wire the Instagram connector into ConnectorsModule"
```

---

## Task 13: `GET /accounts/instagram/connect` and `needsReconnect` on account detail

**Files:**
- Modify: `backend/src/accounts/accounts.controller.ts`
- Modify: `backend/src/accounts/accounts.module.ts`
- Modify: `backend/src/stats/stats.service.ts`
- Test: `backend/src/accounts/accounts.controller.spec.ts` (extend if
  it exists, else create), `backend/src/stats/stats.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramOauthService.buildAuthorizeUrl` (Task 9),
  `AccountCredential` repository.
- Produces: `GET /accounts/instagram/connect?type=own|client` (behind
  `JwtAuthGuard`, like every other `AccountsController` route) →
  `{ redirectUrl: string }`. This is the endpoint the frontend calls
  with `apiClient.get`, then navigates the browser to `redirectUrl`
  itself — the JWT rides on the `apiClient` call, never on the
  cross-site navigation to Instagram. `StatsService.getAccountDetail`'s
  response gains `needsReconnect: boolean` (false for any account with
  no `AccountCredential` row, i.e. every Telegram account today).

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/accounts/accounts.controller.spec.ts` (create it if
missing, matching the constructor shape `accounts.controller.ts`
already uses):

```typescript
import { InstagramOauthController } from '../connectors/instagram/instagram-oauth.controller';
// ... existing imports for AccountsController, AccountsService ...

describe('AccountsController.connectInstagram', () => {
  it('returns the authorize URL for the requested account type', async () => {
    const oauthService = { buildAuthorizeUrl: jest.fn().mockResolvedValue('https://www.instagram.com/oauth/authorize?...') };
    const controller = new AccountsController({} as any, oauthService as any);

    const result = await controller.connectInstagram('own');

    expect(oauthService.buildAuthorizeUrl).toHaveBeenCalledWith('own');
    expect(result).toEqual({ redirectUrl: 'https://www.instagram.com/oauth/authorize?...' });
  });
});
```

Add to `backend/src/stats/stats.service.spec.ts` (find the existing
`getAccountDetail` describe block and add alongside it — read the file
first to match its existing mock-repo setup style):

```typescript
it('reports needsReconnect from the account credential, false when there is none', async () => {
  // Reuse this spec file's existing accountsRepo/snapshotsRepo/postsRepo mocks;
  // add a credentialsRepo mock returning { needsReconnect: true } for one
  // account and no row (null) for another, then assert the field on the result.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/accounts/accounts.controller src/stats/stats.service -v`
Expected: FAIL — `connectInstagram is not a function` / `needsReconnect` undefined

- [ ] **Step 3: Implement `AccountsController.connectInstagram`**

Modify `backend/src/accounts/accounts.controller.ts` — add the
`InstagramOauthService` to the constructor and a new route:

```typescript
import { InstagramOauthService } from '../connectors/instagram/instagram-oauth.service';
import { InstagramAccountKind } from '../db/entities/instagram-oauth-state.entity';
// ... existing imports stay ...

@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(
    private accountsService: AccountsService,
    private instagramOauth: InstagramOauthService,
  ) {}

  // ... existing routes stay unchanged ...

  @Get('instagram/connect')
  async connectInstagram(@Query('type') type: 'own' | 'client') {
    const kind = type === 'own' ? InstagramAccountKind.OWN : InstagramAccountKind.CLIENT;
    const redirectUrl = await this.instagramOauth.buildAuthorizeUrl(kind);
    return { redirectUrl };
  }
}
```

- [ ] **Step 4: Wire `InstagramOauthService` into `AccountsModule`**

Modify `backend/src/accounts/accounts.module.ts` to import
`InstagramModule` (from `../connectors/instagram/instagram.module`) so
`InstagramOauthService` resolves — `InstagramModule` already exports it
(Task 12).

- [ ] **Step 5: Add `needsReconnect` to `StatsService.getAccountDetail`**

Modify `backend/src/stats/stats.service.ts` — inject the
`AccountCredential` repository and look up the credential alongside the
account:

```typescript
import { AccountCredential } from '../db/entities/account-credential.entity';
// ... existing imports stay ...

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
  ) {}

  async getAccountDetail(accountId: string, period: Period) {
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);

    const credential = await this.credentialsRepo.findOneBy({ accountId });
    // ... existing trend/firstSnapshot/totals/latestSnapshot lookups stay ...

    return {
      account,
      needsReconnect: credential?.needsReconnect ?? false,
      latestSnapshot,
      trend,
      summary: summarise(totals, latestSnapshot?.followersCount ?? null),
      coverage: {
        postsFrom: isoDate(new Date(account.createdAt.getTime() - POST_HISTORY_DAYS * DAY_MS)),
        followersFrom: firstSnapshot?.date ?? isoDate(account.createdAt),
      },
    };
  }
  // ... rest of the file unchanged ...
}
```

Add `AccountCredential` to `TypeOrmModule.forFeature([...])` in
`backend/src/stats/stats.module.ts` (check that file's current imports
first — follow its existing pattern for adding an entity).

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && npx jest src/accounts src/stats -v`
Expected: PASS, including the two new tests

- [ ] **Step 7: Full backend verification**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: everything passes; `tsc` shows only the pre-existing
TS2353.

- [ ] **Step 8: Commit**

```bash
git add backend/src/accounts backend/src/stats backend/src/connectors/instagram/instagram.module.ts
git commit -m "Expose the Instagram connect endpoint and needsReconnect on account detail"
```

---

## Task 14: frontend — Instagram tab in `AddAccountModal`

**Files:**
- Modify: `frontend/src/components/AddAccountModal.tsx`
- Modify: `frontend/src/components/AddAccountModal.module.css`
- Modify: `frontend/src/components/AddAccountModal.test.tsx`

**Interfaces:**
- Consumes: `GET /accounts/instagram/connect?type=own|client` → `{ redirectUrl: string }` (Task 13).
- Produces: no new exports — this is a leaf UI change. The modal's
  `onCreated`/`onClose` props are unchanged; the Instagram tab never
  calls `onCreated` itself, since the whole page navigates away before
  any "created" callback could fire (the account only exists once the
  OAuth callback completes, after the redirect).

- [ ] **Step 1: Read the current test file to match its render helper**

Run: `cat frontend/src/components/AddAccountModal.test.tsx`

Confirm the exact `render(<AddAccountModal .../>)` helper and mock
shape used today before writing new tests against it — this file's
existing tests must keep passing unchanged; the Telegram tab is the
default, so no existing assertion should need to change.

- [ ] **Step 2: Write the failing tests**

Add to `frontend/src/components/AddAccountModal.test.tsx`:

```typescript
describe('Instagram tab', () => {
  it('shows a type choice and one button instead of the link field', async () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));

    expect(screen.queryByLabelText('Ссылка на аккаунт')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Свой аккаунт')).toBeInTheDocument();
    expect(screen.getByLabelText('Аккаунт клиента')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить' })).toBeInTheDocument();
  });

  it('navigates to the URL the backend returns, for the selected type', async () => {
    (apiClient.get as any).mockResolvedValue({ data: { redirectUrl: 'https://www.instagram.com/oauth/authorize?state=abc' } });
    delete (window as any).location;
    (window as any).location = { href: '' };
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));
    fireEvent.click(screen.getByLabelText('Аккаунт клиента'));
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/accounts/instagram/connect', { params: { type: 'client' } }));
    await waitFor(() => expect(window.location.href).toBe('https://www.instagram.com/oauth/authorize?state=abc'));
  });

  it('shows an error and stays on the modal when the backend call fails', async () => {
    (apiClient.get as any).mockRejectedValue({ response: { data: { message: 'Не удалось начать подключение' } } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось начать подключение');
  });

  it('switching back to the Telegram tab restores the link field', async () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Telegram' }));

    expect(screen.getByLabelText('Ссылка на аккаунт')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/AddAccountModal.test.tsx`
Expected: FAIL — no `role="tab"` elements exist yet, no "Подключить" button

- [ ] **Step 4: Implement**

Rewrite `frontend/src/components/AddAccountModal.tsx`. Read the full
current file first (its debounced-preview `useEffect` and
`handleAdd` for the Telegram path must be preserved unchanged inside
the Telegram branch) — the version below assumes that existing logic
stays exactly as it reads today, with a platform tab wrapped around it:

```typescript
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import styles from './AddAccountModal.module.css';

interface AddAccountModalProps {
  onClose: () => void;
  onCreated: () => void;
}

interface AccountPreview {
  platform: string;
  externalId: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
  alreadyAdded: boolean;
}

type Platform = 'telegram' | 'instagram';
type InstagramKind = 'own' | 'client';

export function AddAccountModal({ onClose, onCreated }: AddAccountModalProps) {
  const [platform, setPlatform] = useState<Platform>('telegram');

  // --- Telegram tab state (unchanged behaviour from before this task) ---
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (platform !== 'telegram') return;
    const trimmed = link.trim();
    setPreview(null);
    setTelegramError(null);
    if (trimmed === '') return;

    let cancelled = false;
    setResolving(true);
    const timer = setTimeout(() => {
      apiClient
        .post('/accounts/preview', { link: trimmed })
        .then((res) => {
          if (!cancelled) setPreview(res.data);
        })
        .catch((err) => {
          if (!cancelled) setTelegramError(err.response?.data?.message ?? 'Не удалось найти аккаунт');
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, platform]);

  async function handleAdd() {
    setAdding(true);
    setTelegramError(null);
    try {
      await apiClient.post('/accounts/from-link', { link: link.trim() });
      onCreated();
    } catch (err: any) {
      setTelegramError(err.response?.data?.message ?? 'Не удалось добавить аккаунт');
    } finally {
      setAdding(false);
    }
  }

  // --- Instagram tab state ---
  const [instagramKind, setInstagramKind] = useState<InstagramKind>('own');
  const [connecting, setConnecting] = useState(false);
  const [instagramError, setInstagramError] = useState<string | null>(null);

  async function handleConnectInstagram() {
    setConnecting(true);
    setInstagramError(null);
    try {
      const { data } = await apiClient.get('/accounts/instagram/connect', { params: { type: instagramKind } });
      // Full-page navigation, not an in-app route: Instagram's own login screen
      // is outside the SPA, and the callback lands back on /accounts/:id once done.
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setInstagramError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setConnecting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавьте аккаунт" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавьте аккаунт</h2>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={platform === 'telegram'}
            className={platform === 'telegram' ? styles.tabActive : styles.tab}
            onClick={() => setPlatform('telegram')}
          >
            Telegram
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === 'instagram'}
            className={platform === 'instagram' ? styles.tabActive : styles.tab}
            onClick={() => setPlatform('instagram')}
          >
            Instagram
          </button>
        </div>

        {platform === 'telegram' ? (
          <>
            <label className={styles.label} htmlFor="account-link">
              Ссылка на аккаунт
            </label>
            <input
              id="account-link"
              className={styles.input}
              placeholder="https://t.me/channelname"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />

            {resolving && <p className={styles.resolving}>Проверяем…</p>}

            {telegramError && (
              <p className={styles.error} role="alert">
                {telegramError}
              </p>
            )}

            {preview && (
              <div className={styles.preview}>
                <PlatformIcon platform={preview.platform} />
                <span>{preview.name}</span>
                <button type="button" onClick={handleAdd} disabled={adding || preview.alreadyAdded}>
                  {preview.alreadyAdded ? 'Уже добавлен' : 'Добавить'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className={styles.helperText}>
              Потребуется войти в Instagram владельцу аккаунта. Мы не увидим и не сохраним его пароль.
            </p>

            <label className={styles.radioRow}>
              <input
                type="radio"
                name="instagram-kind"
                checked={instagramKind === 'own'}
                onChange={() => setInstagramKind('own')}
                aria-label="Свой аккаунт"
              />
              Свой аккаунт
            </label>
            <label className={styles.radioRow}>
              <input
                type="radio"
                name="instagram-kind"
                checked={instagramKind === 'client'}
                onChange={() => setInstagramKind('client')}
                aria-label="Аккаунт клиента"
              />
              Аккаунт клиента
            </label>

            {instagramError && (
              <p className={styles.error} role="alert">
                {instagramError}
              </p>
            )}

            <button type="button" className={styles.connectButton} onClick={handleConnectInstagram} disabled={connecting}>
              {connecting ? 'Переходим…' : 'Подключить'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

Add the new classes to `frontend/src/components/AddAccountModal.module.css`
(`.tabs`, `.tab`, `.tabActive`, `.helperText`, `.radioRow`,
`.connectButton`) following the file's existing token usage (`--border`,
`--accent`, `--text`, `--text-h` — read the file first and match its
existing button/input styling rather than inventing new values).

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/AddAccountModal.test.tsx`
Expected: PASS, including every pre-existing test in that file
unchanged

- [ ] **Step 6: Full frontend verification**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: all tests pass, clean type check, successful build

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AddAccountModal.tsx frontend/src/components/AddAccountModal.module.css frontend/src/components/AddAccountModal.test.tsx
git commit -m "Add an Instagram tab to the add-account modal"
```

---

## Task 15: frontend — reconnect banner on the account detail page

**Files:**
- Modify: `frontend/src/pages/AccountDetailPage.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.module.css`
- Modify: `frontend/src/pages/AccountDetailPage.test.tsx`

**Interfaces:**
- Consumes: `detail.data.needsReconnect: boolean` (Task 13's addition
  to `GET /accounts/:id/detail`), `GET /accounts/instagram/connect`
  (Task 13, same call the modal makes).

- [ ] **Step 1: Read the current file first**

Run: `sed -n '1,100p' frontend/src/pages/AccountDetailPage.tsx`

Confirm exactly where `detail.data` is destructured (the earlier
exploration in this plan's design phase found
`const { account, trend, summary, coverage } = detail.data;`) so the
banner's placement doesn't disturb the existing loading/error branches
above it.

- [ ] **Step 2: Write the failing test**

Add to `frontend/src/pages/AccountDetailPage.test.tsx` (match its
existing `apiClient.get` mock setup for `/accounts/:id/detail`):

```typescript
it('shows a reconnect banner when the account needs one, and starts the same OAuth flow', async () => {
  (apiClient.get as any).mockImplementation((url: string) => {
    if (url.includes('/detail')) return Promise.resolve({ data: { ...detailFixture, needsReconnect: true } });
    return Promise.resolve({ data: { redirectUrl: 'https://www.instagram.com/oauth/authorize?state=xyz' } });
  });
  delete (window as any).location;
  (window as any).location = { href: '' };

  renderAccountDetailPage(); // however this file's existing tests render the page

  expect(await screen.findByText('Переподключите Instagram')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Переподключить' }));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/accounts/instagram/connect', { params: { type: 'own' } }));
  await waitFor(() => expect(window.location.href).toBe('https://www.instagram.com/oauth/authorize?state=xyz'));
});

it('shows no banner when the account does not need reconnecting', async () => {
  (apiClient.get as any).mockResolvedValue({ data: { ...detailFixture, needsReconnect: false } });

  renderAccountDetailPage();

  await screen.findByText(detailFixture.account.name); // page has loaded
  expect(screen.queryByText('Переподключите Instagram')).not.toBeInTheDocument();
});
```

Adjust `detailFixture` / `renderAccountDetailPage` to whatever names
this test file already uses for its detail-response fixture and render
helper — read Step 1's output before finalizing these two tests.

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/AccountDetailPage.test.tsx`
Expected: FAIL — "Переподключите Instagram" not found

- [ ] **Step 4: Implement**

In `frontend/src/pages/AccountDetailPage.tsx`, after destructuring
`detail.data` and before the existing page markup, add a reconnect
handler and banner. The banner always requests type `own` — this
button lives on a specific account's own page, not the add-account
flow, so there is no client/own choice to make; the callback's
insert-or-update logic (Task 9) makes the type argument irrelevant here
anyway, since the Instagram id already matches an existing account and
the branch that would use the type never runs:

```typescript
const [reconnecting, setReconnecting] = useState(false);
const [reconnectError, setReconnectError] = useState<string | null>(null);

async function handleReconnect() {
  setReconnecting(true);
  setReconnectError(null);
  try {
    const { data } = await apiClient.get('/accounts/instagram/connect', { params: { type: 'own' } });
    window.location.href = data.redirectUrl;
  } catch (err: any) {
    setReconnectError(err.response?.data?.message ?? 'Не удалось начать переподключение');
    setReconnecting(false);
  }
}
```

And in the JSX, right after the existing niche/updated-at header block
(the exact insertion point depends on this file's current structure —
read it, then place it where it reads naturally as a page-level
notice, not inside any period-specific section):

```tsx
{detail.data.needsReconnect && (
  <div className={styles.reconnectBanner} role="alert">
    <span>Переподключите Instagram — доступ к аккаунту был потерян.</span>
    <button type="button" onClick={handleReconnect} disabled={reconnecting}>
      {reconnecting ? 'Переходим…' : 'Переподключить'}
    </button>
    {reconnectError && <span className={styles.error}>{reconnectError}</span>}
  </div>
)}
```

Add `.reconnectBanner` to `AccountDetailPage.module.css`, using
`--danger` for its border/text accent (matching how other error states
in this codebase use that token) and the existing card/border tokens
for its container.

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/pages/AccountDetailPage.test.tsx`
Expected: PASS, including every pre-existing test in the file

- [ ] **Step 6: Full frontend verification**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: all tests pass, clean type check, successful build

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/AccountDetailPage.tsx frontend/src/pages/AccountDetailPage.module.css frontend/src/pages/AccountDetailPage.test.tsx
git commit -m "Show a reconnect banner when an Instagram account loses access"
```

---

## Task 16: operations documentation

**Files:**
- Modify: `docs/operations.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add an Instagram section**

Add a new `## Instagram` section to `docs/operations.md`, following the
existing style of the «Подбор конкурентов» section (short bullets, real
commands). Cover:
- The three env vars (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`,
  `INSTAGRAM_REDIRECT_URI`) and that a new value needs the backend
  container recreated (`up -d --build`), same caveat already documented
  for `GEMINI_API_KEY`.
- The Meta app stays in development mode; each connected Instagram
  account (agency's own, every client's) must be added as a tester in
  the Meta dashboard and must accept the invite before connecting.
- The token-refresh cron runs at 2:30am, 30 minutes before the 3am
  sync; a query to check `needsReconnect` accounts:
  ```bash
  docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT a.id, a.name, c.\"tokenExpiresAt\", c.\"needsReconnect\" FROM accounts a JOIN account_credentials c ON c.\"accountId\" = a.id WHERE a.platform = '"'"'instagram'"'"';"'
  ```
- What `needsReconnect = true` means and how a user clears it (the
  «Переподключить» button on the account page).
- That deleting an Instagram account keeps its post/follower history
  and only removes our stored access token — same as every other
  platform's `remove()`.

- [ ] **Step 2: Commit**

```bash
git add docs/operations.md
git commit -m "Document Instagram operations: env vars, testers, token refresh"
```
