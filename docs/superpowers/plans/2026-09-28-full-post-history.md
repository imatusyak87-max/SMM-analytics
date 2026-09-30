# Full Post History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A «Загрузить все посты» button on every account page that loads the account's entire post history (Instagram and Telegram) in a paced, resumable background job, plus an «За всё время» period preset.

**Architecture:** A new `history` BullMQ queue (concurrency 1) runs short *slices*. Each slice reads a few history pages through a new optional connector method `loadHistoryPage(account, cursor)`, writes posts via `HistoryPostStore`, saves progress in a new `history_loads` row, and schedules the next slice. Rate limits and network errors surface as a typed `HistoryPauseError`, which pauses the load (delayed next slice) instead of failing it. Instagram gets a second phase that fills `reach`/`shares` for posts older than the nightly window through `loadPostInsights`. The nightly sync is unchanged.

**Tech Stack:** NestJS 11, TypeORM 0.3 (Postgres), BullMQ via `@nestjs/bullmq`, axios, cheerio; Jest. React 19 + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-full-post-history-design.md`

## Global Constraints

- The nightly sync's window stays `POST_HISTORY_DAYS = 90` (`backend/src/sync/history-window.ts`). `SyncProcessor` and the connectors' existing `getPosts` keep their behaviour.
- Old posts' numbers are frozen at load time; there is no periodic re-check. Pressing the button after a `done` load re-runs the whole load from the newest post.
- Instagram history fills `reach` and `shares` only (the `posts` table has no `saved` column).
- Instagram phase 1 must never overwrite an existing post's `reach`, `shares` or `er`.
- Pause delays: Instagram rate limit 1 hour; Telegram 429 5 minutes; network error/timeout 5 minutes.
- Instagram rate-limit classification: HTTP 429, or Graph error `code` in {4, 17, 32, 613}. Auth error stays OAuthException `code` 190 (sets `needsReconnect`, load fails).
- One history load at a time app-wide (queue concurrency 1).
- `history_loads` has one row per account (unique `accountId`); deleting an account deletes its row.
- All user-facing text is Russian, exactly as written in this plan.
- Tokens/secrets never appear in logs or error messages.
- Every backend task ends with `cd backend && npx jest` passing and `npx tsc --noEmit -p tsconfig.json` showing only the pre-existing TS2353 in `telegram-webhook.controller.spec.ts`. Every frontend task ends with `cd frontend && npx vitest run && npx tsc -b` clean.
- Commit messages end with a blank line and `Co-Authored-By: <your model> <noreply@anthropic.com>`.

## File Structure

Backend (new):
- `backend/src/db/entities/history-load.entity.ts` — `HistoryLoad` entity + status/phase/pause-reason enums.
- `backend/src/db/migrations/1789600000000-AddHistoryLoads.ts` — table + enums.
- `backend/src/connectors/history-pause.error.ts` — `HistoryPauseError`, `isNetworkError`, `networkPause`, `MINUTE_MS`.
- `backend/src/history/history-post-store.ts` — every `posts` read/write the history job does.
- `backend/src/history/history-runner.ts` — one slice of work; the heart of the feature.
- `backend/src/history/history-load.service.ts` — start/get/enqueue, restart-safety.
- `backend/src/history/history.processor.ts` — BullMQ worker glue.
- `backend/src/history/history.controller.ts` — `POST`/`GET /accounts/:accountId/history-load`.
- `backend/src/history/history.module.ts`.

Backend (modified): `connector.interface.ts`, `instagram-error.ts`, `instagram.connector.ts`, `telegram.connector.ts`, `db.module.ts`, `data-source.ts`, `app.module.ts`, `accounts.service.ts`, `stats.service.ts`, `docs/operations.md`.

Frontend (new): `frontend/src/components/HistoryLoadPanel.tsx` (+ `.module.css`, `.test.tsx`).
Frontend (modified): `periods.ts`, `PeriodPicker.tsx`, `AccountDetailPage.tsx`.

---

### Task 1: `history_loads` table and entity

**Files:**
- Create: `backend/src/db/entities/history-load.entity.ts`
- Create: `backend/src/db/migrations/1789600000000-AddHistoryLoads.ts`
- Modify: `backend/src/db/db.module.ts`, `backend/src/db/data-source.ts`
- Modify: `backend/src/accounts/accounts.service.ts` (`remove()`)
- Test: `backend/src/accounts/accounts.service.spec.ts`

**Interfaces:**
- Produces: `HistoryLoad` entity; enums `HistoryLoadStatus` (`QUEUED='queued'`, `RUNNING='running'`, `PAUSED='paused'`, `DONE='done'`, `FAILED='failed'`), `HistoryLoadPhase` (`POSTS='posts'`, `INSIGHTS='insights'`), `HistoryPauseReason` (`INSTAGRAM_RATE_LIMIT='instagram_rate_limit'`, `TELEGRAM_RATE_LIMIT='telegram_rate_limit'`, `NETWORK='network'`), all exported from `history-load.entity.ts`.

- [ ] **Step 1: Write the failing test**

In `backend/src/accounts/accounts.service.spec.ts`, in `describe('remove')` → `it('clears the data belonging to the account before removing it')`, change the expected list to include `'HistoryLoad'` between `'AccountCredential'` and `'Account'`:

```ts
      expect(deletedTables).toEqual([
        'CompetitorRejection',
        'CompetitorSuggestion',
        'CompetitorRun',
        'Post',
        'AccountSnapshot',
        'SyncJob',
        'AccountCredential',
        'HistoryLoad',
        'Account',
      ]);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/accounts/accounts.service.spec.ts -t "clears the data"`
Expected: FAIL — received list lacks `'HistoryLoad'`.

- [ ] **Step 3: Create the entity**

`backend/src/db/entities/history-load.entity.ts`:

```ts
import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

export enum HistoryLoadStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  PAUSED = 'paused',
  DONE = 'done',
  FAILED = 'failed',
}

export enum HistoryLoadPhase {
  POSTS = 'posts',
  /** Instagram only: reach/shares for posts older than the nightly window. */
  INSIGHTS = 'insights',
}

export enum HistoryPauseReason {
  INSTAGRAM_RATE_LIMIT = 'instagram_rate_limit',
  TELEGRAM_RATE_LIMIT = 'telegram_rate_limit',
  NETWORK = 'network',
}

/**
 * Progress of an account's full-history load. One row per account, reused
 * each time the user presses «Загрузить все посты».
 */
@Entity('history_loads')
@Unique('UQ_history_loads_account', ['accountId'])
export class HistoryLoad {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'enum', enum: HistoryLoadStatus }) status: HistoryLoadStatus;
  @Column({ type: 'enum', enum: HistoryLoadPhase, default: HistoryLoadPhase.POSTS }) phase: HistoryLoadPhase;
  /** Where the current phase stopped; the format belongs to whoever reads it (connector or post store). */
  @Column({ nullable: true, type: 'text' }) cursor: string | null;
  @Column({ type: 'int', default: 0 }) postsLoaded: number;
  @Column({ nullable: true, type: 'timestamptz' }) oldestPostAt: Date | null;
  @Column({ type: 'int', default: 0 }) insightsDone: number;
  @Column({ type: 'int', default: 0 }) insightsTotal: number;
  @Column({ nullable: true, type: 'timestamptz' }) pausedUntil: Date | null;
  @Column({ nullable: true, type: 'enum', enum: HistoryPauseReason }) pauseReason: HistoryPauseReason | null;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) startedAt: Date | null;
  @Column({ nullable: true, type: 'timestamptz' }) finishedAt: Date | null;
}
```

- [ ] **Step 4: Create the migration**

`backend/src/db/migrations/1789600000000-AddHistoryLoads.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Progress of «Загрузить все посты», one row per account. */
export class AddHistoryLoads1789600000000 implements MigrationInterface {
  name = 'AddHistoryLoads1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "history_loads_status_enum" AS ENUM('queued', 'running', 'paused', 'done', 'failed')`,
    );
    await queryRunner.query(`CREATE TYPE "history_loads_phase_enum" AS ENUM('posts', 'insights')`);
    await queryRunner.query(
      `CREATE TYPE "history_loads_pausereason_enum" AS ENUM('instagram_rate_limit', 'telegram_rate_limit', 'network')`,
    );
    await queryRunner.query(`
      CREATE TABLE "history_loads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "status" "history_loads_status_enum" NOT NULL,
        "phase" "history_loads_phase_enum" NOT NULL DEFAULT 'posts',
        "cursor" text,
        "postsLoaded" integer NOT NULL DEFAULT 0,
        "oldestPostAt" TIMESTAMP WITH TIME ZONE,
        "insightsDone" integer NOT NULL DEFAULT 0,
        "insightsTotal" integer NOT NULL DEFAULT 0,
        "pausedUntil" TIMESTAMP WITH TIME ZONE,
        "pauseReason" "history_loads_pausereason_enum",
        "errorMessage" text,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_history_loads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_history_loads_account" UNIQUE ("accountId")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "history_loads"`);
    await queryRunner.query(`DROP TYPE "history_loads_pausereason_enum"`);
    await queryRunner.query(`DROP TYPE "history_loads_phase_enum"`);
    await queryRunner.query(`DROP TYPE "history_loads_status_enum"`);
  }
}
```

- [ ] **Step 5: Register the entity**

In `backend/src/db/db.module.ts`: `import { HistoryLoad } from './entities/history-load.entity';` and append `HistoryLoad` to the END of both the `entities: [...]` array and the `forFeature([...])` array.

In `backend/src/db/data-source.ts`: add the same import and append `HistoryLoad` to its `entities` array.

- [ ] **Step 6: Delete the row with the account**

In `backend/src/accounts/accounts.service.ts`, import `HistoryLoad` from `'../db/entities/history-load.entity'` and add, inside `remove()`'s transaction, directly after `await em.delete(AccountCredential, { accountId: id });`:

```ts
      await em.delete(HistoryLoad, { accountId: id });
```

- [ ] **Step 7: Verify**

Run: `cd backend && npx jest src/accounts && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS; tsc shows only the pre-existing TS2353.

- [ ] **Step 8: Commit**

```bash
git add backend/src/db backend/src/accounts/accounts.service.ts backend/src/accounts/accounts.service.spec.ts
git commit -m "Add the history_loads table for full post history"
```

---

### Task 2: Pause error, connector interface, Instagram history methods

**Files:**
- Create: `backend/src/connectors/history-pause.error.ts`
- Modify: `backend/src/connectors/connector.interface.ts`
- Modify: `backend/src/connectors/instagram/instagram-error.ts`
- Modify: `backend/src/connectors/instagram/instagram.connector.ts`
- Test: `backend/src/connectors/history-pause.error.spec.ts`, `backend/src/connectors/instagram/instagram-error.spec.ts`, `backend/src/connectors/instagram/instagram.connector.spec.ts`

**Interfaces:**
- Consumes: `HistoryPauseReason` (Task 1).
- Produces:
  - `class HistoryPauseError extends Error { readonly reason: HistoryPauseReason; readonly retryAfterMs: number }` — constructor `(reason, retryAfterMs, message)`.
  - `MINUTE_MS = 60_000`; `isNetworkError(error: unknown): boolean`; `networkPause(): HistoryPauseError`.
  - In `connector.interface.ts`: `interface HistoryPage { posts: ConnectorPost[]; nextCursor: string | null }`, `interface PostInsights { reach: number | null; shares: number | null }`, and optional `SocialConnector` members `loadHistoryPage?(account: Account, cursor: string | null): Promise<HistoryPage>` and `loadPostInsights?(account: Account, externalPostId: string): Promise<PostInsights>`.
  - `isInstagramRateLimitError(error: unknown): boolean` in `instagram-error.ts`.
  - `InstagramConnector.loadHistoryPage` (cursor = Instagram's `after` value) and `InstagramConnector.loadPostInsights`.

- [ ] **Step 1: Write the failing tests**

`backend/src/connectors/history-pause.error.spec.ts`:

```ts
import { HistoryPauseError, isNetworkError, networkPause, MINUTE_MS } from './history-pause.error';
import { HistoryPauseReason } from '../db/entities/history-load.entity';

describe('isNetworkError', () => {
  it('recognises axios errors that never got a response', () => {
    expect(isNetworkError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isNetworkError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isNetworkError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('does not treat an HTTP error response as a network error', () => {
    expect(isNetworkError({ code: 'ERR_BAD_REQUEST', response: { status: 400 } })).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('networkPause', () => {
  it('pauses for five minutes with a Russian message', () => {
    const pause = networkPause();
    expect(pause).toBeInstanceOf(HistoryPauseError);
    expect(pause.reason).toBe(HistoryPauseReason.NETWORK);
    expect(pause.retryAfterMs).toBe(5 * MINUTE_MS);
    expect(pause.message).toBe('Проблема с сетью, попробуйте позже');
  });
});
```

Append to `backend/src/connectors/instagram/instagram-error.spec.ts` (add `isInstagramRateLimitError` to its import from `./instagram-error`):

```ts
describe('isInstagramRateLimitError', () => {
  const graphError = (status: number, code: number) => ({ response: { status, data: { error: { type: 'OAuthException', code } } } });

  it.each([4, 17, 32, 613])('treats Graph error code %i as a rate limit', (code) => {
    expect(isInstagramRateLimitError(graphError(400, code))).toBe(true);
  });

  it('treats a bare HTTP 429 as a rate limit', () => {
    expect(isInstagramRateLimitError({ response: { status: 429, data: {} } })).toBe(true);
  });

  it('does not treat an auth error or an ordinary bad request as a rate limit', () => {
    expect(isInstagramRateLimitError(graphError(400, 190))).toBe(false);
    expect(isInstagramRateLimitError(graphError(400, 100))).toBe(false);
    expect(isInstagramRateLimitError({ code: 'ETIMEDOUT' })).toBe(false);
  });
});
```

Append inside `describe('InstagramConnector', ...)` in `backend/src/connectors/instagram/instagram.connector.spec.ts` (add `import { HistoryPauseError } from '../history-pause.error';` and `import { HistoryPauseReason } from '../../db/entities/history-load.entity';` at the top):

```ts
  const historyMedia = (id: string) => ({ id, timestamp: '2024-03-12T10:00:00+0000', likeCount: 7, commentsCount: 2, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: 'old', mediaUrl: null, thumbnailUrl: null, permalink: 'https://instagram.com/p/x' });

  it('loadHistoryPage reads one media page from the given cursor, without insights', async () => {
    const api = { getMedia: jest.fn().mockResolvedValue({ items: [historyMedia('m1'), historyMedia('m2')], nextCursor: 'CUR2' }), getMediaInsights: jest.fn() };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const page = await connector.loadHistoryPage(account, 'CUR1');

    expect(api.getMedia).toHaveBeenCalledWith('plain-token', 'CUR1');
    expect(api.getMediaInsights).not.toHaveBeenCalled();
    expect(page.nextCursor).toBe('CUR2');
    expect(page.posts.map((p) => p.externalPostId)).toEqual(['m1', 'm2']);
    expect(page.posts[0]).toMatchObject({ likes: 7, comments: 2, reach: null, shares: 0 });
  });

  it('loadHistoryPage starts from the newest page when there is no cursor', async () => {
    const api = { getMedia: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const page = await connector.loadHistoryPage(account, null);

    expect(api.getMedia).toHaveBeenCalledWith('plain-token', undefined);
    expect(page).toEqual({ posts: [], nextCursor: null });
  });

  it('loadHistoryPage turns an Instagram rate limit into a one-hour pause', async () => {
    const api = { getMedia: jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { type: 'OAuthException', code: 4 } } } }) };
    const credentialRepo = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentialRepo, KEY);

    const error = await connector.loadHistoryPage(account, null).catch((e) => e);

    expect(error).toBeInstanceOf(HistoryPauseError);
    expect(error.reason).toBe(HistoryPauseReason.INSTAGRAM_RATE_LIMIT);
    expect(error.retryAfterMs).toBe(60 * 60_000);
    expect(credentialRepo.update).not.toHaveBeenCalled();
  });

  it('loadHistoryPage turns a network timeout into a network pause', async () => {
    const api = { getMedia: jest.fn().mockRejectedValue({ code: 'ETIMEDOUT', message: 'timeout of 15000ms exceeded' }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const error = await connector.loadHistoryPage(account, null).catch((e) => e);

    expect(error).toBeInstanceOf(HistoryPauseError);
    expect(error.reason).toBe(HistoryPauseReason.NETWORK);
  });

  it('loadPostInsights returns reach and shares for one post', async () => {
    const api = { getMediaInsights: jest.fn().mockResolvedValue({ reach: 120, saved: 3, shares: 4 }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    expect(await connector.loadPostInsights(account, 'm1')).toEqual({ reach: 120, shares: 4 });
    expect(api.getMediaInsights).toHaveBeenCalledWith('plain-token', 'm1');
  });

  it('loadPostInsights gives null insights for a post Instagram has no insights for', async () => {
    const api = { getMediaInsights: jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { type: 'OAuthException', code: 100, message: 'media posted before business conversion' } } } }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    expect(await connector.loadPostInsights(account, 'm1')).toEqual({ reach: null, shares: null });
  });

  it('loadPostInsights pauses on a rate limit instead of recording null insights', async () => {
    const api = { getMediaInsights: jest.fn().mockRejectedValue({ response: { status: 429, data: { error: { code: 32 } } } }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    await expect(connector.loadPostInsights(account, 'm1')).rejects.toBeInstanceOf(HistoryPauseError);
  });

  it('loadPostInsights still flags reconnect on an auth error', async () => {
    const api = { getMediaInsights: jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { type: 'OAuthException', code: 190 } } } }) };
    const credentialRepo = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentialRepo, KEY);

    await expect(connector.loadPostInsights(account, 'm1')).rejects.toThrow('Instagram отклонил доступ, нужно переподключить аккаунт');
    expect(credentialRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
  });

  it('getPosts fails (so the nightly job retries) when an insights call is rate-limited, instead of saving null reach', async () => {
    const api = {
      getMedia: jest.fn().mockResolvedValue({ items: [{ ...historyMedia('a'), timestamp: '2026-09-10T00:00:00+0000' }], nextCursor: null }),
      getMediaInsights: jest.fn().mockRejectedValue({ response: { status: 429, data: { error: { code: 4 } } } }),
    };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    await expect(connector.getPosts(account, new Date('2026-09-01'))).rejects.toBeInstanceOf(HistoryPauseError);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/connectors/history-pause.error.spec.ts src/connectors/instagram`
Expected: FAIL — `Cannot find module './history-pause.error'`, `isInstagramRateLimitError is not a function`, `connector.loadHistoryPage is not a function`.

- [ ] **Step 3: Create `history-pause.error.ts`**

`backend/src/connectors/history-pause.error.ts`:

```ts
import { HistoryPauseReason } from '../db/entities/history-load.entity';

export const MINUTE_MS = 60_000;

/**
 * A temporary condition (rate limit, network trouble) that should pause a
 * history load and retry later, not fail it. `message` is Russian and safe to
 * show the user; it never contains a token or a URL. The nightly sync can
 * surface the same error, so messages must not promise a history-load
 * schedule — the history panel builds its own text from `reason`.
 */
export class HistoryPauseError extends Error {
  constructor(
    readonly reason: HistoryPauseReason,
    readonly retryAfterMs: number,
    message: string,
  ) {
    super(message);
    this.name = 'HistoryPauseError';
  }
}

const NETWORK_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** An axios error that never got an HTTP response: timeout, DNS failure, dropped connection. */
export function isNetworkError(error: unknown): boolean {
  const e = error as { code?: unknown; response?: unknown } | null | undefined;
  return !!e && e.response === undefined && typeof e.code === 'string' && NETWORK_CODES.has(e.code);
}

export function networkPause(): HistoryPauseError {
  return new HistoryPauseError(HistoryPauseReason.NETWORK, 5 * MINUTE_MS, 'Проблема с сетью, попробуйте позже');
}
```

- [ ] **Step 4: Extend the connector interface**

In `backend/src/connectors/connector.interface.ts`, add after `ConnectorPost`:

```ts
/** One step of a full-history walk. `nextCursor` is null once history is exhausted. */
export interface HistoryPage {
  posts: ConnectorPost[];
  nextCursor: string | null;
}

export interface PostInsights {
  reach: number | null;
  shares: number | null;
}
```

and add to `SocialConnector` (after `getLatestPostAt?`):

```ts
  /**
   * One page of the account's full post history, newest first. `cursor` is
   * whatever the previous call returned as `nextCursor` (null to start).
   * Temporary conditions throw HistoryPauseError.
   */
  loadHistoryPage?(account: Account, cursor: string | null): Promise<HistoryPage>;
  /** Platforms whose post list lacks reach/shares fill them in one post at a time. */
  loadPostInsights?(account: Account, externalPostId: string): Promise<PostInsights>;
```

- [ ] **Step 5: Add `isInstagramRateLimitError`**

In `backend/src/connectors/instagram/instagram-error.ts`, add after `isInstagramAuthError`:

```ts
/**
 * Meta's throttling codes: 4 (app), 17 (user), 32 (page/account), 613 (calls
 * within the rolling window). Unconfirmed against a live throttle yet — see
 * the full-post-history spec §9; adjust here only.
 */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

export function isInstagramRateLimitError(error: unknown): boolean {
  if ((error as InstagramApiError)?.response?.status === 429) return true;
  const code = igError(error)?.code;
  return code !== undefined && RATE_LIMIT_CODES.has(code);
}
```

- [ ] **Step 6: Implement the Instagram connector changes**

In `backend/src/connectors/instagram/instagram.connector.ts`:

1. Update imports:

```ts
import { AccountInfo, AccountStats, AvatarImage, ConnectorPost, HistoryPage, PostInsights, SocialConnector } from '../connector.interface';
import { isInstagramAuthError, isInstagramRateLimitError, translateInstagramError } from './instagram-error';
import { HistoryPauseError, isNetworkError, MINUTE_MS, networkPause } from '../history-pause.error';
import { HistoryPauseReason } from '../../db/entities/history-load.entity';
```

2. Add module-level constants after the imports:

```ts
const NO_INSIGHTS: InstagramMediaInsights = { reach: null, saved: null, shares: null };

function instagramRateLimitPause(): HistoryPauseError {
  return new HistoryPauseError(
    HistoryPauseReason.INSTAGRAM_RATE_LIMIT,
    60 * MINUTE_MS,
    'Превышен лимит запросов к Instagram, попробуйте позже',
  );
}
```

3. Add the two methods to the class (after `getPosts`):

```ts
  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    return this.call(account, async (token) => {
      const { items, nextCursor } = await this.api.getMedia(token, cursor ?? undefined);
      // Insights are a separate, paced phase; the page only carries likes/comments.
      return { posts: items.map((media) => mapInstagramPost(media, NO_INSIGHTS)), nextCursor };
    });
  }

  async loadPostInsights(account: Account, externalPostId: string): Promise<PostInsights> {
    return this.call(account, async (token) => {
      try {
        const insights = await this.api.getMediaInsights(token, externalPostId);
        return { reach: insights.reach, shares: insights.shares };
      } catch (error) {
        // Media from before the account became Business/Creator has no insights;
        // that is an answer, not a failure. Everything temporary goes to `call`.
        if (isInstagramAuthError(error) || isInstagramRateLimitError(error) || isNetworkError(error)) throw error;
        return { reach: null, shares: null };
      }
    });
  }
```

4. In `insightsOrNull`, change the rethrow condition to:

```ts
      if (isInstagramAuthError(error) || isInstagramRateLimitError(error) || isNetworkError(error)) throw error;
```

5. Replace the `catch` block of `call()` with:

```ts
    } catch (error) {
      if (error instanceof HistoryPauseError) throw error;
      if (isInstagramAuthError(error)) {
        await this.credentialsRepo.update({ accountId: account.id }, { needsReconnect: true });
        throw translateInstagramError(error);
      }
      if (isInstagramRateLimitError(error)) throw instagramRateLimitPause();
      if (isNetworkError(error)) throw networkPause();
      throw translateInstagramError(error);
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && npx jest src/connectors`
Expected: PASS, including every pre-existing Instagram test.

- [ ] **Step 8: Full verification and commit**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/connectors
git commit -m "Add history page and insight methods to the Instagram connector"
```

---

### Task 3: Telegram history pages (preview walk and embed walk)

**Files:**
- Modify: `backend/src/connectors/telegram/telegram.connector.ts`
- Test: `backend/src/connectors/telegram/telegram.connector.spec.ts`

**Interfaces:**
- Consumes: `HistoryPage` (Task 2), `HistoryPauseError`, `isNetworkError`, `networkPause`, `MINUTE_MS` (Task 2), `HistoryPauseReason` (Task 1).
- Produces: `TelegramConnector.loadHistoryPage(account, cursor)`. Cursor format (opaque to everyone else): `null` = start; `p:<id>` = next preview page is `?before=<id>`; `e:<id>` = next embed id to read, walking down to 1. No `loadPostInsights` for Telegram.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/connectors/telegram/telegram.connector.spec.ts` (it already defines `page`, `embed`, `hiddenChannel`, `dailyPosts`, `POST_NOT_FOUND`, `ids`; add `import { HistoryPauseError } from '../history-pause.error';` and `import { HistoryPauseReason } from '../../db/entities/history-load.entity';` at the top):

```ts
describe('TelegramConnector.loadHistoryPage', () => {
  const account = { externalId: '@testchannel' } as any;

  it('reads the newest preview page first and points the cursor at its oldest post', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([5, 6, 7], '2024-03-12T10:00:00Z')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, null);

    expect(preview.fetchPage).toHaveBeenCalledWith('@testchannel', undefined);
    expect(ids(result.posts)).toEqual([5, 6, 7]);
    expect(result.nextCursor).toBe('p:5');
  });

  it('continues the preview walk from the cursor, with no page cap', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([2, 3, 4], '2021-01-01T10:00:00Z')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'p:5');

    expect(preview.fetchPage).toHaveBeenCalledWith('@testchannel', '5');
    expect(result.nextCursor).toBe('p:2');
  });

  it('ends the preview walk when the page before the cursor has no posts', async () => {
    const preview = { fetchPage: jest.fn().mockRejectedValue(new PreviewUnavailableError('past the start')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    expect(await connector.loadHistoryPage(account, 'p:1')).toEqual({ posts: [], nextCursor: null });
  });

  it('ends the preview walk when Telegram hands back the same page again', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([1, 2], '2020-01-01T10:00:00Z')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    expect((await connector.loadHistoryPage(account, 'p:1')).nextCursor).toBeNull();
  });

  it('switches to the embed walk for a channel with its preview disabled, starting at the newest post', async () => {
    const preview = hiddenChannel(dailyPosts(120));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, null);

    // 50 ids per call, newest first.
    expect(ids(result.posts)).toEqual(Array.from({ length: 50 }, (_, i) => 71 + i));
    expect(result.nextCursor).toBe('e:70');
  });

  it('walks the embed pages down to post 1, skipping deleted posts without stopping', async () => {
    const preview = hiddenChannel(dailyPosts(30, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'e:20');

    expect(ids(result.posts)).toEqual([1, 2, 3, 16, 17, 18, 19, 20]);
    expect(result.nextCursor).toBeNull();
  });

  it('does not end an embed chunk inside an album', async () => {
    // Ids 52..4 are ordinary posts (49 reads); ids 3, 2, 1 are one album. The
    // 50-read budget runs out on id 3, inside the album, so the walk must keep
    // reading 2 and 1.
    const embeds: Record<number, string> = {};
    for (let id = 4; id <= 52; id++) embeds[id] = embed(id, new Date(Date.UTC(2023, 0, id)).toISOString());
    const albumTime = '2022-06-01T10:00:00Z';
    embeds[3] = embed(3, albumTime, true);
    embeds[2] = embed(2, albumTime, true);
    embeds[1] = embed(1, albumTime, true);
    const preview = hiddenChannel(embeds);
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'e:52');

    const albumEntries = result.posts.filter((p) => p.publishedAt.toISOString() === new Date(albumTime).toISOString());
    expect(albumEntries.map((p) => p.externalPostId)).toEqual(['1']);
    expect(result.nextCursor).toBeNull();
  });

  it('leaves the post after a finished album for the next chunk', async () => {
    const embeds: Record<number, string> = {};
    for (let id = 3; id <= 51; id++) embeds[id] = embed(id, new Date(Date.UTC(2023, 0, id)).toISOString());
    const albumTime = '2022-06-01T10:00:00Z';
    embeds[3] = embed(3, albumTime, true);
    embeds[2] = embed(2, albumTime, true);
    embeds[1] = embed(1, '2022-05-01T10:00:00Z');
    const preview = hiddenChannel(embeds);
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'e:51');

    expect(result.posts.some((p) => p.externalPostId === '1')).toBe(false);
    expect(result.posts.filter((p) => p.publishedAt.toISOString() === new Date(albumTime).toISOString()).map((p) => p.externalPostId)).toEqual(['2']);
    expect(result.nextCursor).toBe('e:1');
  });

  it('pauses for five minutes when Telegram answers 429', async () => {
    const preview = { fetchPage: jest.fn().mockRejectedValue({ response: { status: 429 }, message: 'Request failed with status code 429' }), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const error = await connector.loadHistoryPage(account, 'p:9').catch((e) => e);

    expect(error).toBeInstanceOf(HistoryPauseError);
    expect(error.reason).toBe(HistoryPauseReason.TELEGRAM_RATE_LIMIT);
    expect(error.retryAfterMs).toBe(5 * 60_000);
    expect(error.message).toBe('Telegram ограничил запросы, продолжим через 5 минут');
  });

  it('pauses on a network timeout', async () => {
    const preview = { fetchPage: jest.fn(), fetchEmbed: jest.fn().mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout' }) };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const error = await connector.loadHistoryPage(account, 'e:5').catch((e) => e);

    expect(error).toBeInstanceOf(HistoryPauseError);
    expect(error.reason).toBe(HistoryPauseReason.NETWORK);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/connectors/telegram/telegram.connector.spec.ts -t loadHistoryPage`
Expected: FAIL — `connector.loadHistoryPage is not a function`.

- [ ] **Step 3: Refactor the embed reader and newest-id search out of `getPostsFromEmbeds`**

In `backend/src/connectors/telegram/telegram.connector.ts`, add these private methods to the class and rewrite `getPostsFromEmbeds` to use them. Behaviour of `getPostsFromEmbeds` must stay identical (the existing tests prove it).

```ts
  /** Reads embed pages with a per-walk request budget, pacing and caching each id. */
  private makeEmbedReader(channel: string, budget: number): (id: number) => Promise<ParsedPreviewPost | null> {
    const handle = channel.replace(/^@/, '');
    const pages = new Map<number, ParsedPreviewPost | null>();
    let requests = 0;

    return async (id: number) => {
      if (pages.has(id)) return pages.get(id)!;
      if (requests >= budget) throw new EmbedBudgetExhausted();
      if (requests > 0) await delay(this.requestDelayMs);
      requests += 1;

      let post: ParsedPreviewPost | null;
      try {
        [post] = parsePreviewPage(await this.preview.fetchEmbed(channel, String(id)), handle);
      } catch (err) {
        if (!(err instanceof PreviewUnavailableError)) throw err;
        post = null;
      }
      pages.set(id, post);
      return post;
    };
  }

  /**
   * Nothing lists a hidden channel's post ids, so the newest one is found by
   * probing: double until no post is near, binary-search the gap, then scan up
   * past deleted ids. Throws `previewError` when the channel has no readable posts.
   */
  private async findNewestEmbedId(
    read: (id: number) => Promise<ParsedPreviewPost | null>,
    previewError: PreviewUnavailableError,
  ): Promise<number> {
    const hasPostNear = async (id: number): Promise<boolean> => {
      for (let probe = id; probe < id + PROBE_SPAN; probe++) {
        if (await read(probe)) return true;
      }
      return false;
    };

    try {
      let low = 0;
      let high = 1;
      while (low > 0 || high <= FIRST_POST_SEARCH_LIMIT) {
        if (await hasPostNear(high)) {
          low = high;
          high *= 2;
        } else if (low === 0) {
          high *= 2;
        } else {
          break;
        }
      }
      if (low === 0) throw previewError;

      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (await hasPostNear(middle)) low = middle;
        else high = middle;
      }

      let newest = 0;
      let missing = 0;
      for (let id = low; missing < MISSING_RUN_LIMIT; id++) {
        if (await read(id)) {
          newest = id;
          missing = 0;
        } else {
          missing += 1;
        }
      }
      return newest;
    } catch (err) {
      if (err instanceof EmbedBudgetExhausted) throw previewError;
      throw err;
    }
  }
```

Then `getPostsFromEmbeds` becomes:

```ts
  private async getPostsFromEmbeds(
    channel: string,
    sinceDate: Date,
    previewError: PreviewUnavailableError,
  ): Promise<ConnectorPost[]> {
    const read = this.makeEmbedReader(channel, MAX_EMBED_REQUESTS);
    const newest = await this.findNewestEmbedId(read, previewError);

    const collected: ConnectorPost[] = [];
    // The preview page shows an album once, under its lowest id. All its parts share
    // one timestamp, but they need not be adjacent: another post sent in the same
    // second can take an id between them. So an album is keyed by its timestamp,
    // and each lower part walked into replaces the album's entry.
    const albumSlots = new Map<number, number>();
    try {
      for (let id = newest; id >= 1; id--) {
        const post = await read(id);
        if (!post) continue;
        if (post.publishedAt < sinceDate) break;

        const slot = post.grouped ? albumSlots.get(post.publishedAt.getTime()) : undefined;
        if (slot !== undefined) {
          collected[slot] = toConnectorPost(post);
        } else {
          if (post.grouped) albumSlots.set(post.publishedAt.getTime(), collected.length);
          collected.push(toConnectorPost(post));
        }
      }
    } catch (err) {
      if (!(err instanceof EmbedBudgetExhausted)) throw err;
      this.logger.warn(
        `Read the ${MAX_EMBED_REQUESTS}-request limit of embed pages for ${channel} before reaching the requested history window — older posts in that window were not collected.`,
      );
    }

    return collected;
  }
```

Run: `cd backend && npx jest src/connectors/telegram` — every pre-existing test must still PASS before continuing.

- [ ] **Step 4: Implement `loadHistoryPage`**

Add imports:

```ts
import { AccountInfo, AccountStats, AvatarImage, ConnectorPost, HistoryPage, LatestPost, SocialConnector } from '../connector.interface';
import { HistoryPauseError, isNetworkError, MINUTE_MS, networkPause } from '../history-pause.error';
import { HistoryPauseReason } from '../../db/entities/history-load.entity';
```

Add constants next to the others:

```ts
/** Embed ids read per history call; the processor paces calls into slices. */
const EMBED_HISTORY_CHUNK = 50;

function toTelegramPause(err: unknown): unknown {
  if (err instanceof HistoryPauseError) return err;
  if ((err as { response?: { status?: number } })?.response?.status === 429) {
    return new HistoryPauseError(
      HistoryPauseReason.TELEGRAM_RATE_LIMIT,
      5 * MINUTE_MS,
      'Telegram ограничил запросы, продолжим через 5 минут',
    );
  }
  if (isNetworkError(err)) return networkPause();
  return err;
}
```

Add to the class:

```ts
  /**
   * One step of the full-history walk. Normal channels page back through
   * t.me/s/ with no page cap; channels with the preview disabled are read one
   * embed page per post, all the way down to id 1.
   */
  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    const channel = account.externalId;
    try {
      if (cursor?.startsWith('e:')) return await this.embedHistoryChunk(channel, Number(cursor.slice(2)));
      return await this.previewHistoryPage(channel, cursor?.startsWith('p:') ? cursor.slice(2) : undefined);
    } catch (err) {
      throw toTelegramPause(err);
    }
  }

  private async previewHistoryPage(channel: string, before: string | undefined): Promise<HistoryPage> {
    let parsed: ParsedPreviewPost[];
    try {
      parsed = parsePreviewPage(await this.preview.fetchPage(channel, before), channel.replace(/^@/, ''));
    } catch (err) {
      if (!(err instanceof PreviewUnavailableError)) throw err;
      // On the first page this means the preview is disabled: switch to embeds.
      // Later, it means the walk went past the channel's first post.
      if (before !== undefined) return { posts: [], nextCursor: null };
      const newest = await this.findNewestEmbedId(this.makeEmbedReader(channel, MAX_EMBED_REQUESTS), err);
      return this.embedHistoryChunk(channel, newest);
    }

    const oldest = parsed.reduce((a, b) => (a.publishedAt <= b.publishedAt ? a : b));
    const nextBefore = oldest.externalPostId;
    return {
      posts: parsed.map(toConnectorPost),
      nextCursor: nextBefore === before ? null : `p:${nextBefore}`,
    };
  }

  /**
   * Reads up to EMBED_HISTORY_CHUNK ids downward from `startId`. Deleted ids
   * are skipped without ending the walk. The chunk never stops inside an
   * album, so an album is never split into two posts across chunks.
   */
  private async embedHistoryChunk(channel: string, startId: number): Promise<HistoryPage> {
    const read = this.makeEmbedReader(channel, Number.POSITIVE_INFINITY);
    const collected: ConnectorPost[] = [];
    const albumSlots = new Map<number, number>();
    let openAlbum: number | null = null;
    let reads = 0;
    let id = startId;

    while (id >= 1) {
      if (reads >= EMBED_HISTORY_CHUNK && openAlbum === null) break;
      const post = await read(id);
      reads += 1;

      if (!post) {
        if (reads > EMBED_HISTORY_CHUNK) openAlbum = null;
        id -= 1;
        continue;
      }

      const time = post.publishedAt.getTime();
      if (reads > EMBED_HISTORY_CHUNK && !(post.grouped && time === openAlbum)) {
        break; // past the budget and outside the album: this id starts the next chunk
      }

      const slot = post.grouped ? albumSlots.get(time) : undefined;
      if (slot !== undefined) {
        collected[slot] = toConnectorPost(post);
      } else {
        if (post.grouped) albumSlots.set(time, collected.length);
        collected.push(toConnectorPost(post));
      }
      openAlbum = post.grouped ? time : null;
      id -= 1;
    }

    return { posts: collected, nextCursor: id >= 1 ? `e:${id}` : null };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest src/connectors/telegram`
Expected: PASS — new and pre-existing.

- [ ] **Step 6: Full verification and commit**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/connectors/telegram
git commit -m "Walk a Telegram channel's full history page by page"
```

---

### Task 4: `HistoryPostStore` — writing posts and finding insight targets

**Files:**
- Create: `backend/src/history/history-post-store.ts`
- Test: `backend/src/history/history-post-store.spec.ts`

**Interfaces:**
- Consumes: `ConnectorPost`, `PostInsights` (Task 2); `calculateEr`, `calculateErByViews` (`backend/src/sync/er-calculator.ts`); `Post` entity.
- Produces (`@Injectable() class HistoryPostStore`, constructor `(@InjectRepository(Post) postsRepo: Repository<Post>)`):
  - `write(accountId: string, posts: ConnectorPost[], followersCount: number, preserveInsights: boolean): Promise<void>`
  - `countInsightTargets(accountId: string, windowStart: Date): Promise<number>`
  - `nextInsightTargets(accountId: string, windowStart: Date, cursor: string | null, limit: number): Promise<Post[]>`
  - `saveInsights(post: Post, insights: PostInsights, followersCount: number): Promise<void>`
  - exported function `insightCursor(post: Pick<Post, 'publishedAt' | 'externalPostId'>): string`

- [ ] **Step 1: Write the failing tests**

`backend/src/history/history-post-store.spec.ts`:

```ts
import { HistoryPostStore, insightCursor } from './history-post-store';
import { PostType } from '../db/entities/post.entity';

function chain(result: unknown = undefined) {
  const qb: any = {};
  for (const m of ['insert', 'into', 'values', 'orUpdate', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'limit']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(undefined);
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getCount = jest.fn().mockResolvedValue(result);
  return qb;
}

const post = (id: string, overrides = {}) => ({
  externalPostId: id,
  type: PostType.IMAGE,
  publishedAt: new Date('2024-03-12T10:00:00Z'),
  permalink: null,
  thumbnailUrl: null,
  caption: 'c',
  likes: 8,
  comments: 2,
  shares: 0,
  views: 100,
  reach: null,
  ...overrides,
});

describe('HistoryPostStore.write', () => {
  it('upserts every post with ER computed from the given follower count', async () => {
    const qb = chain();
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.write('acc-1', [post('1')], 200, false);

    const rows = qb.values.mock.calls[0][0];
    expect(rows[0]).toMatchObject({ accountId: 'acc-1', externalPostId: '1', er: 5, erViews: 8 });
    expect(qb.orUpdate.mock.calls[0][1]).toEqual(['accountId', 'externalPostId']);
    expect(qb.orUpdate.mock.calls[0][0]).toEqual(expect.arrayContaining(['reach', 'shares', 'er', 'likes']));
  });

  it('never overwrites reach, shares or er of an existing row when insights are preserved', async () => {
    const qb = chain();
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.write('acc-1', [post('1')], 200, true);

    const updated: string[] = qb.orUpdate.mock.calls[0][0];
    expect(updated).not.toContain('reach');
    expect(updated).not.toContain('shares');
    expect(updated).not.toContain('er');
    expect(updated).toEqual(expect.arrayContaining(['likes', 'comments', 'caption', 'views', 'erViews', 'lastSyncedAt']));
  });

  it('does nothing for an empty page', async () => {
    const repo = { createQueryBuilder: jest.fn() };
    await new HistoryPostStore(repo as any).write('acc-1', [], 200, false);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('HistoryPostStore insight targets', () => {
  const windowStart = new Date('2026-06-30T00:00:00Z');

  it('counts the account posts older than the nightly window', async () => {
    const qb = chain(42);
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    expect(await store.countInsightTargets('acc-1', windowStart)).toBe(42);
    expect(qb.where).toHaveBeenCalledWith('p.accountId = :accountId', { accountId: 'acc-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('p.publishedAt < :windowStart', { windowStart });
  });

  it('pages newest first after the cursor', async () => {
    const qb = chain([]);
    const store = new HistoryPostStore({ createQueryBuilder: jest.fn().mockReturnValue(qb) } as any);

    await store.nextInsightTargets('acc-1', windowStart, '2024-03-12T10:00:00.000Z|abc', 60);

    expect(qb.orderBy).toHaveBeenCalledWith('p.publishedAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('p.externalPostId', 'DESC');
    expect(qb.limit).toHaveBeenCalledWith(60);
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(p.publishedAt < :cursorAt OR (p.publishedAt = :cursorAt AND p.externalPostId < :cursorId))',
      { cursorAt: new Date('2024-03-12T10:00:00.000Z'), cursorId: 'abc' },
    );
  });

  it('builds a cursor from a post', () => {
    expect(insightCursor({ publishedAt: new Date('2024-03-12T10:00:00Z'), externalPostId: 'abc' })).toBe('2024-03-12T10:00:00.000Z|abc');
  });
});

describe('HistoryPostStore.saveInsights', () => {
  it('writes reach and shares and recomputes ER', async () => {
    const repo = { update: jest.fn() };
    const store = new HistoryPostStore(repo as any);

    await store.saveInsights({ id: 'p1', likes: 8, comments: 2, shares: 0, reach: null } as any, { reach: 300, shares: 10 }, 200);

    expect(repo.update).toHaveBeenCalledWith({ id: 'p1' }, { reach: 300, shares: 10, er: 10 });
  });

  it('keeps the stored values when Instagram has no insights for the post', async () => {
    const repo = { update: jest.fn() };
    const store = new HistoryPostStore(repo as any);

    await store.saveInsights({ id: 'p1', likes: 8, comments: 2, shares: 3, reach: 250 } as any, { reach: null, shares: null }, 200);

    expect(repo.update).toHaveBeenCalledWith({ id: 'p1' }, { reach: 250, shares: 3, er: 6.5 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/history/history-post-store.spec.ts`
Expected: FAIL — `Cannot find module './history-post-store'`.

- [ ] **Step 3: Implement**

`backend/src/history/history-post-store.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../db/entities/post.entity';
import { ConnectorPost, PostInsights } from '../connectors/connector.interface';
import { calculateEr, calculateErByViews } from '../sync/er-calculator';

const UPDATABLE_COLUMNS = [
  'type',
  'publishedAt',
  'permalink',
  'thumbnailUrl',
  'caption',
  'likes',
  'comments',
  'shares',
  'views',
  'reach',
  'er',
  'erViews',
  'lastSyncedAt',
];
/** Filled by the insights phase or the nightly sync; a history page must not blank them. */
const INSIGHT_COLUMNS = new Set(['reach', 'shares', 'er']);

export function insightCursor(post: Pick<Post, 'publishedAt' | 'externalPostId'>): string {
  return `${post.publishedAt.toISOString()}|${post.externalPostId}`;
}

/** Every `posts` read and write the full-history job makes. */
@Injectable()
export class HistoryPostStore {
  constructor(@InjectRepository(Post) private postsRepo: Repository<Post>) {}

  async write(accountId: string, posts: ConnectorPost[], followersCount: number, preserveInsights: boolean): Promise<void> {
    if (posts.length === 0) return;
    const now = new Date();
    const rows = posts.map((post) => ({
      accountId,
      ...post,
      er: calculateEr(post.likes, post.comments, post.shares, followersCount),
      erViews: calculateErByViews(post.likes, post.views),
      lastSyncedAt: now,
    }));
    const update = preserveInsights ? UPDATABLE_COLUMNS.filter((c) => !INSIGHT_COLUMNS.has(c)) : UPDATABLE_COLUMNS;
    await this.postsRepo
      .createQueryBuilder()
      .insert()
      .into(Post)
      .values(rows)
      .orUpdate(update, ['accountId', 'externalPostId'])
      .execute();
  }

  async countInsightTargets(accountId: string, windowStart: Date): Promise<number> {
    return this.postsRepo
      .createQueryBuilder('p')
      .where('p.accountId = :accountId', { accountId })
      .andWhere('p.publishedAt < :windowStart', { windowStart })
      .getCount();
  }

  async nextInsightTargets(accountId: string, windowStart: Date, cursor: string | null, limit: number): Promise<Post[]> {
    const qb = this.postsRepo
      .createQueryBuilder('p')
      .where('p.accountId = :accountId', { accountId })
      .andWhere('p.publishedAt < :windowStart', { windowStart });
    if (cursor) {
      const split = cursor.indexOf('|');
      qb.andWhere(
        '(p.publishedAt < :cursorAt OR (p.publishedAt = :cursorAt AND p.externalPostId < :cursorId))',
        { cursorAt: new Date(cursor.slice(0, split)), cursorId: cursor.slice(split + 1) },
      );
    }
    return qb.orderBy('p.publishedAt', 'DESC').addOrderBy('p.externalPostId', 'DESC').limit(limit).getMany();
  }

  async saveInsights(post: Post, insights: PostInsights, followersCount: number): Promise<void> {
    // null means Instagram had nothing for this post; keep whatever is stored.
    const reach = insights.reach ?? post.reach;
    const shares = insights.shares ?? post.shares;
    await this.postsRepo.update(
      { id: post.id },
      { reach, shares, er: calculateEr(post.likes, post.comments, shares, followersCount) },
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest src/history/history-post-store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full verification and commit**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/history
git commit -m "Add the post store the history load writes through"
```

---

### Task 5: `HistoryRunner` — one slice of a history load

**Files:**
- Create: `backend/src/history/history-runner.ts`
- Test: `backend/src/history/history-runner.spec.ts`

**Interfaces:**
- Consumes: `HistoryLoad` + enums (Task 1); `HistoryPauseError` (Task 2); `SocialConnector.loadHistoryPage` / `loadPostInsights` (Tasks 2–3); `HistoryPostStore`, `insightCursor` (Task 4); `ConnectorRegistry.get(platform)` (`backend/src/connectors/connector-registry.service.ts`); `POST_HISTORY_DAYS` (`backend/src/sync/history-window.ts`).
- Produces: `@Injectable() class HistoryRunner` with `runSlice(accountId: string): Promise<number | null>` — returns the delay in ms before the next slice, or `null` when no further slice is needed (done, failed, or the load/account vanished). Exports `HISTORY_TIMING` (injection token string `'HISTORY_TIMING'`), `interface HistoryTiming { unitDelayMs: number; insightDelayMs: number }`, `POSTS_UNITS_PER_SLICE = 10`, `INSIGHTS_PER_SLICE = 60`.
  Constructor: `(loadsRepo: Repository<HistoryLoad>, accountsRepo: Repository<Account>, snapshotsRepo: Repository<AccountSnapshot>, registry: ConnectorRegistry, store: HistoryPostStore, timing?: HistoryTiming)`.

- [ ] **Step 1: Write the failing tests**

`backend/src/history/history-runner.spec.ts`:

```ts
import { HistoryRunner, POSTS_UNITS_PER_SLICE, INSIGHTS_PER_SLICE } from './history-runner';
import { HistoryLoadPhase, HistoryLoadStatus, HistoryPauseReason } from '../db/entities/history-load.entity';
import { AccountPlatform } from '../db/entities/account.entity';
import { HistoryPauseError } from '../connectors/history-pause.error';

const DAY = 86_400_000;

function makeLoad(overrides = {}) {
  return {
    id: 'load-1',
    accountId: 'acc-1',
    status: HistoryLoadStatus.QUEUED,
    phase: HistoryLoadPhase.POSTS,
    cursor: null,
    postsLoaded: 0,
    oldestPostAt: null,
    insightsDone: 0,
    insightsTotal: 0,
    pausedUntil: null,
    pauseReason: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  } as any;
}

const connectorPost = (id: string, daysAgo: number) => ({
  externalPostId: id,
  type: 'image',
  publishedAt: new Date(Date.now() - daysAgo * DAY),
  permalink: null,
  thumbnailUrl: null,
  caption: null,
  likes: 1,
  comments: 0,
  shares: 0,
  views: null,
  reach: null,
});

function setup({ load = makeLoad(), platform = AccountPlatform.TELEGRAM, connector = {} as any, followers = 500 } = {}) {
  const loadsRepo = { findOneBy: jest.fn().mockResolvedValue(load), update: jest.fn() };
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', platform }) };
  const snapshotsRepo = { findOne: jest.fn().mockResolvedValue(followers === null ? null : { followersCount: followers }) };
  const registry = { get: jest.fn().mockReturnValue(connector) };
  const store = {
    write: jest.fn(),
    countInsightTargets: jest.fn().mockResolvedValue(0),
    nextInsightTargets: jest.fn().mockResolvedValue([]),
    saveInsights: jest.fn(),
  };
  const runner = new HistoryRunner(loadsRepo as any, accountsRepo as any, snapshotsRepo as any, registry as any, store as any, {
    unitDelayMs: 0,
    insightDelayMs: 0,
  });
  return { runner, load, loadsRepo, accountsRepo, snapshotsRepo, store, connector };
}

/** The fields of the last progress write. */
const lastWrite = (loadsRepo: any) => loadsRepo.update.mock.calls.at(-1)[1];

describe('HistoryRunner.runSlice — posts phase', () => {
  it('reads pages from the saved cursor, saves posts and progress, and asks for another slice', async () => {
    const connector = {
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('9', 400), connectorPost('8', 410)], nextCursor: 'p:8' }),
    };
    const { runner, loadsRepo, store } = setup({ load: makeLoad({ cursor: 'p:10', postsLoaded: 5 }), connector });

    const next = await runner.runSlice('acc-1');

    expect(connector.loadHistoryPage).toHaveBeenNthCalledWith(1, { id: 'acc-1', platform: AccountPlatform.TELEGRAM }, 'p:10');
    expect(connector.loadHistoryPage).toHaveBeenCalledTimes(POSTS_UNITS_PER_SLICE);
    expect(store.write).toHaveBeenCalledWith('acc-1', expect.any(Array), 500, false);
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.RUNNING, cursor: 'p:8', postsLoaded: 5 + 2 * POSTS_UNITS_PER_SLICE });
    expect(next).toBe(0);
  });

  it('records the oldest post reached', async () => {
    const connector = { loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('1', 900), connectorPost('2', 800)], nextCursor: null }) };
    const { runner, loadsRepo } = setup({ connector });

    await runner.runSlice('acc-1');

    expect(lastWrite(loadsRepo).oldestPostAt.getTime()).toBeLessThan(Date.now() - 899 * DAY);
  });

  it('finishes a Telegram load when history is exhausted', async () => {
    const connector = { loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('1', 900)], nextCursor: null }) };
    const { runner, loadsRepo } = setup({ connector });

    const next = await runner.runSlice('acc-1');

    expect(connector.loadHistoryPage).toHaveBeenCalledTimes(1);
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.DONE, cursor: null });
    expect(lastWrite(loadsRepo).finishedAt).toBeInstanceOf(Date);
    expect(next).toBeNull();
  });

  it('moves an Instagram load on to the insights phase, preserving insight columns meanwhile', async () => {
    const connector = {
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('m1', 400)], nextCursor: null }),
      loadPostInsights: jest.fn(),
    };
    const { runner, loadsRepo, store } = setup({ platform: AccountPlatform.INSTAGRAM, connector });
    store.countInsightTargets.mockResolvedValue(37);

    const next = await runner.runSlice('acc-1');

    expect(store.write).toHaveBeenCalledWith('acc-1', expect.any(Array), 500, true);
    expect(lastWrite(loadsRepo)).toMatchObject({ phase: HistoryLoadPhase.INSIGHTS, cursor: null, insightsDone: 0, insightsTotal: 37, status: HistoryLoadStatus.RUNNING });
    expect(next).toBe(0);
  });

  it('falls back to live follower stats when the account has no snapshot yet', async () => {
    const connector = {
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 77 }),
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [], nextCursor: null }),
    };
    const { runner, store } = setup({ connector, followers: null as any });
    connector.loadHistoryPage.mockResolvedValue({ posts: [connectorPost('1', 400)], nextCursor: null });

    await runner.runSlice('acc-1');

    expect(store.write).toHaveBeenCalledWith('acc-1', expect.any(Array), 77, false);
  });
});

describe('HistoryRunner.runSlice — insights phase', () => {
  const storedPost = (id: string) => ({ id: `row-${id}`, externalPostId: id, publishedAt: new Date('2024-01-01T00:00:00Z'), likes: 1, comments: 0, shares: 0, reach: null });

  it('fills insights one post at a time and advances the cursor', async () => {
    const connector = { loadHistoryPage: jest.fn(), loadPostInsights: jest.fn().mockResolvedValue({ reach: 10, shares: 1 }) };
    const load = makeLoad({ phase: HistoryLoadPhase.INSIGHTS, insightsTotal: 100, insightsDone: 3, cursor: 'c0' });
    const { runner, loadsRepo, store } = setup({ load, platform: AccountPlatform.INSTAGRAM, connector });
    store.nextInsightTargets.mockResolvedValue(Array.from({ length: INSIGHTS_PER_SLICE }, (_, i) => storedPost(`p${i}`)));

    const next = await runner.runSlice('acc-1');

    expect(store.nextInsightTargets).toHaveBeenCalledWith('acc-1', expect.any(Date), 'c0', INSIGHTS_PER_SLICE);
    expect(connector.loadPostInsights).toHaveBeenCalledTimes(INSIGHTS_PER_SLICE);
    expect(store.saveInsights).toHaveBeenCalledWith(expect.objectContaining({ externalPostId: 'p0' }), { reach: 10, shares: 1 }, 500);
    expect(lastWrite(loadsRepo)).toMatchObject({ insightsDone: 3 + INSIGHTS_PER_SLICE, cursor: `2024-01-01T00:00:00.000Z|p${INSIGHTS_PER_SLICE - 1}` });
    expect(next).toBe(0);
  });

  it('finishes when fewer targets than a full slice remain', async () => {
    const connector = { loadHistoryPage: jest.fn(), loadPostInsights: jest.fn().mockResolvedValue({ reach: 10, shares: 1 }) };
    const load = makeLoad({ phase: HistoryLoadPhase.INSIGHTS, insightsTotal: 2 });
    const { runner, loadsRepo, store } = setup({ load, platform: AccountPlatform.INSTAGRAM, connector });
    store.nextInsightTargets.mockResolvedValue([storedPost('a'), storedPost('b')]);

    const next = await runner.runSlice('acc-1');

    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.DONE, insightsDone: 2 });
    expect(next).toBeNull();
  });
});

describe('HistoryRunner.runSlice — pauses and failures', () => {
  it('pauses on a HistoryPauseError and asks for the next slice after the pause', async () => {
    const connector = {
      loadHistoryPage: jest.fn().mockRejectedValue(new HistoryPauseError(HistoryPauseReason.TELEGRAM_RATE_LIMIT, 300_000, 'Telegram ограничил запросы, продолжим через 5 минут')),
    };
    const { runner, loadsRepo } = setup({ load: makeLoad({ cursor: 'p:50' }), connector });

    const next = await runner.runSlice('acc-1');

    expect(next).toBe(300_000);
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.PAUSED, pauseReason: HistoryPauseReason.TELEGRAM_RATE_LIMIT, cursor: 'p:50' });
    expect(lastWrite(loadsRepo).pausedUntil.getTime()).toBeGreaterThan(Date.now() + 299_000);
  });

  it('fails with the error message, keeping the cursor, on anything else', async () => {
    const connector = { loadHistoryPage: jest.fn().mockRejectedValue(new Error('Instagram отклонил доступ, нужно переподключить аккаунт')) };
    const { runner, loadsRepo } = setup({ load: makeLoad({ cursor: 'CUR' }), connector });

    const next = await runner.runSlice('acc-1');

    expect(next).toBeNull();
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.FAILED, cursor: 'CUR', errorMessage: 'Instagram отклонил доступ, нужно переподключить аккаунт' });
  });

  it('keeps progress already saved before a later page pauses', async () => {
    const connector = {
      loadHistoryPage: jest
        .fn()
        .mockResolvedValueOnce({ posts: [connectorPost('9', 400)], nextCursor: 'p:9' })
        .mockRejectedValueOnce(new HistoryPauseError(HistoryPauseReason.NETWORK, 300_000, 'Проблема с сетью, продолжим через 5 минут')),
    };
    const { runner, loadsRepo } = setup({ connector });

    await runner.runSlice('acc-1');

    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.PAUSED, cursor: 'p:9', postsLoaded: 1 });
  });

  it('does nothing when the load was finished, failed or deleted meanwhile', async () => {
    for (const load of [makeLoad({ status: HistoryLoadStatus.DONE }), makeLoad({ status: HistoryLoadStatus.FAILED }), null]) {
      const connector = { loadHistoryPage: jest.fn() };
      const { runner, loadsRepo } = setup({ load, connector });
      expect(await runner.runSlice('acc-1')).toBeNull();
      expect(connector.loadHistoryPage).not.toHaveBeenCalled();
      expect(loadsRepo.update).not.toHaveBeenCalled();
    }
  });

  it('does nothing when the account was deleted meanwhile', async () => {
    const connector = { loadHistoryPage: jest.fn() };
    const { runner, accountsRepo, loadsRepo } = setup({ connector });
    accountsRepo.findOneBy.mockResolvedValue(null);

    expect(await runner.runSlice('acc-1')).toBeNull();
    expect(loadsRepo.update).not.toHaveBeenCalled();
  });

  it('writes progress with update(), never save(), so a deleted row is not recreated', async () => {
    const connector = { loadHistoryPage: jest.fn().mockResolvedValue({ posts: [], nextCursor: null }) };
    const { runner, loadsRepo } = setup({ connector });

    await runner.runSlice('acc-1');

    expect(loadsRepo.update.mock.calls.every(([criteria]: [unknown]) => JSON.stringify(criteria) === JSON.stringify({ id: 'load-1' }))).toBe(true);
    expect(lastWrite(loadsRepo)).not.toHaveProperty('id');
    expect(lastWrite(loadsRepo)).not.toHaveProperty('accountId');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/history/history-runner.spec.ts`
Expected: FAIL — `Cannot find module './history-runner'`.

- [ ] **Step 3: Implement**

`backend/src/history/history-runner.ts`:

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { HistoryLoad, HistoryLoadPhase, HistoryLoadStatus } from '../db/entities/history-load.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { SocialConnector } from '../connectors/connector.interface';
import { HistoryPauseError } from '../connectors/history-pause.error';
import { POST_HISTORY_DAYS } from '../sync/history-window';
import { HistoryPostStore, insightCursor } from './history-post-store';

export const HISTORY_TIMING = 'HISTORY_TIMING';

export interface HistoryTiming {
  /** Pause between history pages inside one slice. */
  unitDelayMs: number;
  /** Pause between Instagram insight requests (~1/s keeps well inside the rolling limit). */
  insightDelayMs: number;
}

const DEFAULT_TIMING: HistoryTiming = { unitDelayMs: 300, insightDelayMs: 1000 };

/** History pages per slice; each slice is a short BullMQ job. */
export const POSTS_UNITS_PER_SLICE = 10;
/** Insight requests per slice (~1 minute at the default pace). */
export const INSIGHTS_PER_SLICE = 60;

const DAY_MS = 86_400_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one slice of an account's full-history load and records progress after
 * every page or post, so a pause, failure or restart loses nothing.
 */
@Injectable()
export class HistoryRunner {
  private readonly timing: HistoryTiming;

  constructor(
    @InjectRepository(HistoryLoad) private loadsRepo: Repository<HistoryLoad>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    private registry: ConnectorRegistry,
    private store: HistoryPostStore,
    @Optional() @Inject(HISTORY_TIMING) timing?: HistoryTiming,
  ) {
    this.timing = timing ?? DEFAULT_TIMING;
  }

  /** Returns the delay before the next slice, or null when there is nothing more to do. */
  async runSlice(accountId: string): Promise<number | null> {
    const load = await this.loadsRepo.findOneBy({ accountId });
    if (!load || load.status === HistoryLoadStatus.DONE || load.status === HistoryLoadStatus.FAILED) return null;
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) return null;
    const connector = this.registry.get(account.platform);

    load.status = HistoryLoadStatus.RUNNING;
    load.pausedUntil = null;
    load.pauseReason = null;
    load.startedAt = load.startedAt ?? new Date();
    await this.persist(load);

    try {
      const followers = await this.followersFor(account, connector);
      if (load.phase === HistoryLoadPhase.POSTS) await this.postsSlice(load, account, connector, followers);
      else await this.insightsSlice(load, account, connector, followers);
      return load.status === HistoryLoadStatus.DONE ? null : 0;
    } catch (error) {
      if (error instanceof HistoryPauseError) {
        load.status = HistoryLoadStatus.PAUSED;
        load.pauseReason = error.reason;
        load.pausedUntil = new Date(Date.now() + error.retryAfterMs);
        await this.persist(load);
        return error.retryAfterMs;
      }
      load.status = HistoryLoadStatus.FAILED;
      load.errorMessage = (error as Error).message;
      load.finishedAt = new Date();
      await this.persist(load);
      return null;
    }
  }

  private async postsSlice(load: HistoryLoad, account: Account, connector: SocialConnector, followers: number) {
    const preserveInsights = typeof connector.loadPostInsights === 'function';
    for (let unit = 0; unit < POSTS_UNITS_PER_SLICE; unit++) {
      if (unit > 0) await delay(this.timing.unitDelayMs);
      const page = await connector.loadHistoryPage!(account, load.cursor);
      await this.store.write(account.id, page.posts, followers, preserveInsights);

      load.postsLoaded += page.posts.length;
      for (const post of page.posts) {
        if (!load.oldestPostAt || post.publishedAt < load.oldestPostAt) load.oldestPostAt = post.publishedAt;
      }
      load.cursor = page.nextCursor;

      if (page.nextCursor === null) {
        await this.finishPostsPhase(load, account, preserveInsights);
        return;
      }
      await this.persist(load);
    }
  }

  private async finishPostsPhase(load: HistoryLoad, account: Account, hasInsightsPhase: boolean) {
    const total = hasInsightsPhase ? await this.store.countInsightTargets(account.id, this.windowStart()) : 0;
    if (total > 0) {
      load.phase = HistoryLoadPhase.INSIGHTS;
      load.cursor = null;
      load.insightsDone = 0;
      load.insightsTotal = total;
    } else {
      load.status = HistoryLoadStatus.DONE;
      load.finishedAt = new Date();
    }
    await this.persist(load);
  }

  private async insightsSlice(load: HistoryLoad, account: Account, connector: SocialConnector, followers: number) {
    const targets = await this.store.nextInsightTargets(account.id, this.windowStart(), load.cursor, INSIGHTS_PER_SLICE);
    for (let i = 0; i < targets.length; i++) {
      if (i > 0) await delay(this.timing.insightDelayMs);
      const post = targets[i];
      const insights = await connector.loadPostInsights!(account, post.externalPostId);
      await this.store.saveInsights(post, insights, followers);
      load.insightsDone += 1;
      load.cursor = insightCursor(post);
      await this.persist(load);
    }
    if (targets.length < INSIGHTS_PER_SLICE) {
      load.status = HistoryLoadStatus.DONE;
      load.finishedAt = new Date();
      await this.persist(load);
    }
  }

  /** ER needs a follower count; today's is the best there is for old posts. */
  private async followersFor(account: Account, connector: SocialConnector): Promise<number> {
    const latest = await this.snapshotsRepo.findOne({ where: { accountId: account.id }, order: { date: 'DESC' } });
    if (latest) return latest.followersCount;
    return (await connector.getAccountStats(account)).followersCount;
  }

  /** Posts newer than this are the nightly sync's job. */
  private windowStart(): Date {
    return new Date(Date.now() - POST_HISTORY_DAYS * DAY_MS);
  }

  /** update(), not save(): save() would re-insert a row deleted with its account. */
  private async persist(load: HistoryLoad): Promise<void> {
    const fields: Partial<HistoryLoad> = { ...load };
    delete fields.id;
    delete fields.accountId;
    await this.loadsRepo.update({ id: load.id }, fields);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest src/history/history-runner.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full verification and commit**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/history
git commit -m "Run a full-history load in resumable slices"
```

---

### Task 6: Service, processor, controller, module

**Files:**
- Create: `backend/src/history/history-load.service.ts`, `backend/src/history/history.processor.ts`, `backend/src/history/history.controller.ts`, `backend/src/history/history.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/history/history-load.service.spec.ts`, `backend/src/history/history.processor.spec.ts`

**Interfaces:**
- Consumes: `HistoryRunner.runSlice` (Task 5), `HistoryPostStore` (Task 4), `HistoryLoad` (Task 1), `ConnectorRegistry` (exported by `ConnectorsModule`).
- Produces:
  - `HistoryLoadService` — constructor `(loadsRepo: Repository<HistoryLoad>, accountsRepo: Repository<Account>, registry: ConnectorRegistry, queue: Queue)`; methods `start(accountId): Promise<HistoryLoadView>`, `get(accountId): Promise<HistoryLoadView | null>`, `enqueue(accountId: string, delayMs: number): Promise<void>`, `resumeStranded(): Promise<void>` (called from `onApplicationBootstrap`).
  - `interface HistoryLoadView { status; phase; postsLoaded; oldestPostAt: Date | null; insightsDone; insightsTotal; pausedUntil: Date | null; pauseReason; errorMessage; startedAt; finishedAt }` and `toView(load: HistoryLoad): HistoryLoadView` (no `id`, `accountId` or `cursor`).
  - HTTP: `POST /accounts/:accountId/history-load` → `HistoryLoadView`; `GET /accounts/:accountId/history-load` → `HistoryLoadView | null`. Both behind `JwtAuthGuard`.
  - Queue name `'history'`, job name `'history-slice'`, job data `{ accountId: string }`.

- [ ] **Step 1: Write the failing tests**

`backend/src/history/history-load.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HistoryLoadService } from './history-load.service';
import { HistoryLoadPhase, HistoryLoadStatus } from '../db/entities/history-load.entity';
import { AccountPlatform } from '../db/entities/account.entity';

function setup({ existing = null as any, account = { id: 'acc-1', platform: AccountPlatform.TELEGRAM } as any, canLoad = true } = {}) {
  const loadsRepo = {
    findOneBy: jest.fn().mockResolvedValue(existing),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'load-1', ...x })),
  };
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) };
  const registry = { get: jest.fn().mockReturnValue(canLoad ? { loadHistoryPage: jest.fn() } : {}) };
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) };
  const service = new HistoryLoadService(loadsRepo as any, accountsRepo as any, registry as any, queue as any);
  return { service, loadsRepo, queue };
}

describe('HistoryLoadService.start', () => {
  it('creates a fresh load and queues its first slice', async () => {
    const { service, loadsRepo, queue } = setup();

    const view = await service.start('acc-1');

    expect(loadsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', status: HistoryLoadStatus.QUEUED, phase: HistoryLoadPhase.POSTS, cursor: null, postsLoaded: 0 }));
    expect(queue.add).toHaveBeenCalledWith('history-slice', { accountId: 'acc-1' }, expect.objectContaining({ delay: 0 }));
    expect(view.status).toBe(HistoryLoadStatus.QUEUED);
    expect(view).not.toHaveProperty('cursor');
  });

  it('restarts a finished load from the newest post', async () => {
    const existing = { id: 'load-1', accountId: 'acc-1', status: HistoryLoadStatus.DONE, phase: HistoryLoadPhase.INSIGHTS, cursor: 'x', postsLoaded: 900, insightsDone: 50, insightsTotal: 50 };
    const { service, loadsRepo } = setup({ existing });

    await service.start('acc-1');

    expect(loadsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'load-1', status: HistoryLoadStatus.QUEUED, phase: HistoryLoadPhase.POSTS, cursor: null, postsLoaded: 0, insightsDone: 0, insightsTotal: 0 }));
  });

  it('continues a failed load from where it stopped', async () => {
    const existing = { id: 'load-1', accountId: 'acc-1', status: HistoryLoadStatus.FAILED, phase: HistoryLoadPhase.POSTS, cursor: 'p:500', postsLoaded: 300, errorMessage: 'x' };
    const { service, loadsRepo } = setup({ existing });

    await service.start('acc-1');

    expect(loadsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: HistoryLoadStatus.QUEUED, cursor: 'p:500', postsLoaded: 300, errorMessage: null }));
  });

  it.each([HistoryLoadStatus.QUEUED, HistoryLoadStatus.RUNNING, HistoryLoadStatus.PAUSED])('does not start a second load while one is %s', async (status) => {
    const { service, loadsRepo, queue } = setup({ existing: { id: 'load-1', accountId: 'acc-1', status } });

    const view = await service.start('acc-1');

    expect(view.status).toBe(status);
    expect(loadsRepo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses an unknown account', async () => {
    const { service } = setup({ account: null });
    await expect(service.start('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a platform without history support', async () => {
    const { service } = setup({ canLoad: false });
    await expect(service.start('acc-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HistoryLoadService.resumeStranded', () => {
  it('re-queues an unfinished load that has no job in the queue, honouring a pause', async () => {
    const pausedUntil = new Date(Date.now() + 60_000);
    const { service, loadsRepo, queue } = setup();
    loadsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', status: HistoryLoadStatus.RUNNING },
      { accountId: 'acc-2', status: HistoryLoadStatus.PAUSED, pausedUntil },
      { accountId: 'acc-3', status: HistoryLoadStatus.QUEUED },
    ]);
    queue.getJobs.mockResolvedValue([{ data: { accountId: 'acc-3' } }]);

    await service.resumeStranded();

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('history-slice', { accountId: 'acc-1' }, expect.objectContaining({ delay: 0 }));
    const acc2 = queue.add.mock.calls.find(([, data]: [string, { accountId: string }]) => data.accountId === 'acc-2');
    expect(acc2[2].delay).toBeGreaterThan(50_000);
  });

  it('does not throw when the queue is unreachable', async () => {
    const { service, loadsRepo, queue } = setup();
    loadsRepo.find.mockResolvedValue([{ accountId: 'acc-1', status: HistoryLoadStatus.RUNNING }]);
    queue.getJobs.mockRejectedValue(new Error('Redis down'));

    await expect(service.resumeStranded()).resolves.toBeUndefined();
  });
});
```

`backend/src/history/history.processor.spec.ts`:

```ts
import { HistoryProcessor } from './history.processor';

describe('HistoryProcessor', () => {
  it('queues the next slice with the delay the runner asks for', async () => {
    const runner = { runSlice: jest.fn().mockResolvedValue(300_000) };
    const loads = { enqueue: jest.fn() };
    const processor = new HistoryProcessor(runner as any, loads as any);

    await processor.process({ data: { accountId: 'acc-1' } } as any);

    expect(runner.runSlice).toHaveBeenCalledWith('acc-1');
    expect(loads.enqueue).toHaveBeenCalledWith('acc-1', 300_000);
  });

  it('stops when the runner says there is nothing more to do', async () => {
    const runner = { runSlice: jest.fn().mockResolvedValue(null) };
    const loads = { enqueue: jest.fn() };

    await new HistoryProcessor(runner as any, loads as any).process({ data: { accountId: 'acc-1' } } as any);

    expect(loads.enqueue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/history/history-load.service.spec.ts src/history/history.processor.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the service**

`backend/src/history/history-load.service.ts`:

```ts
import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Account } from '../db/entities/account.entity';
import {
  HistoryLoad,
  HistoryLoadPhase,
  HistoryLoadStatus,
  HistoryPauseReason,
} from '../db/entities/history-load.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';

export interface HistoryLoadView {
  status: HistoryLoadStatus;
  phase: HistoryLoadPhase;
  postsLoaded: number;
  oldestPostAt: Date | null;
  insightsDone: number;
  insightsTotal: number;
  pausedUntil: Date | null;
  pauseReason: HistoryPauseReason | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** What the page sees: progress, never the internal cursor. */
export function toView(load: HistoryLoad): HistoryLoadView {
  return {
    status: load.status,
    phase: load.phase,
    postsLoaded: load.postsLoaded,
    oldestPostAt: load.oldestPostAt ?? null,
    insightsDone: load.insightsDone,
    insightsTotal: load.insightsTotal,
    pausedUntil: load.pausedUntil ?? null,
    pauseReason: load.pauseReason ?? null,
    errorMessage: load.errorMessage ?? null,
    startedAt: load.startedAt ?? null,
    finishedAt: load.finishedAt ?? null,
  };
}

const OPEN_STATUSES = [HistoryLoadStatus.QUEUED, HistoryLoadStatus.RUNNING, HistoryLoadStatus.PAUSED];

@Injectable()
export class HistoryLoadService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HistoryLoadService.name);

  constructor(
    @InjectRepository(HistoryLoad) private loadsRepo: Repository<HistoryLoad>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    private registry: ConnectorRegistry,
    @InjectQueue('history') private queue: Queue,
  ) {}

  async start(accountId: string): Promise<HistoryLoadView> {
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) throw new NotFoundException('Аккаунт не найден');
    if (typeof this.registry.get(account.platform).loadHistoryPage !== 'function') {
      throw new BadRequestException('Для этой платформы загрузка истории недоступна');
    }

    const existing = await this.loadsRepo.findOneBy({ accountId });
    if (existing && OPEN_STATUSES.includes(existing.status)) return toView(existing);

    let load: HistoryLoad;
    if (existing && existing.status === HistoryLoadStatus.FAILED) {
      // «Продолжить»: keep cursor, phase and counters.
      load = { ...existing, status: HistoryLoadStatus.QUEUED, errorMessage: null, finishedAt: null };
    } else {
      // First run, or «Обновить всю историю» after a finished one.
      load = this.loadsRepo.create({
        ...(existing ?? {}),
        accountId,
        status: HistoryLoadStatus.QUEUED,
        phase: HistoryLoadPhase.POSTS,
        cursor: null,
        postsLoaded: 0,
        oldestPostAt: null,
        insightsDone: 0,
        insightsTotal: 0,
        pausedUntil: null,
        pauseReason: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      });
    }
    const saved = await this.loadsRepo.save(load);
    await this.enqueue(accountId, 0);
    return toView(saved);
  }

  async get(accountId: string): Promise<HistoryLoadView | null> {
    const load = await this.loadsRepo.findOneBy({ accountId });
    return load ? toView(load) : null;
  }

  async enqueue(accountId: string, delayMs: number): Promise<void> {
    await this.queue.add('history-slice', { accountId }, { delay: delayMs, removeOnComplete: true, removeOnFail: true });
  }

  onApplicationBootstrap(): Promise<void> {
    return this.resumeStranded();
  }

  /** A load whose next slice was lost (e.g. Redis flushed) would otherwise sit «running» forever. */
  async resumeStranded(): Promise<void> {
    try {
      const open = await this.loadsRepo.find({ where: { status: In(OPEN_STATUSES) } });
      if (open.length === 0) return;
      const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
      const pending = new Set(jobs.map((job) => job?.data?.accountId));
      for (const load of open) {
        if (pending.has(load.accountId)) continue;
        const wait =
          load.status === HistoryLoadStatus.PAUSED && load.pausedUntil
            ? Math.max(0, load.pausedUntil.getTime() - Date.now())
            : 0;
        await this.enqueue(load.accountId, wait);
      }
    } catch (error) {
      this.logger.warn(`Could not resume unfinished history loads: ${(error as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Implement the processor, controller and module**

`backend/src/history/history.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { HistoryRunner } from './history-runner';
import { HistoryLoadService } from './history-load.service';

/** Concurrency 1: one account's history load at a time, app-wide. */
@Processor('history', { concurrency: 1 })
export class HistoryProcessor extends WorkerHost {
  constructor(
    private runner: HistoryRunner,
    private loads: HistoryLoadService,
  ) {
    super();
  }

  async process(job: Job<{ accountId: string }>): Promise<void> {
    const next = await this.runner.runSlice(job.data.accountId);
    if (next !== null) await this.loads.enqueue(job.data.accountId, next);
  }
}
```

`backend/src/history/history.controller.ts`:

```ts
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HistoryLoadService } from './history-load.service';

@UseGuards(JwtAuthGuard)
@Controller('accounts/:accountId/history-load')
export class HistoryController {
  constructor(private loads: HistoryLoadService) {}

  @Post()
  start(@Param('accountId') accountId: string) {
    return this.loads.start(accountId);
  }

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.loads.get(accountId);
  }
}
```

`backend/src/history/history.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { HistoryLoad } from '../db/entities/history-load.entity';
import { Post } from '../db/entities/post.entity';
import { ConnectorsModule } from '../connectors/connectors.module';
import { HistoryController } from './history.controller';
import { HistoryLoadService } from './history-load.service';
import { HistoryPostStore } from './history-post-store';
import { HistoryProcessor } from './history.processor';
import { HistoryRunner } from './history-runner';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'history' }),
    TypeOrmModule.forFeature([HistoryLoad, Account, AccountSnapshot, Post]),
    ConnectorsModule,
  ],
  controllers: [HistoryController],
  providers: [HistoryPostStore, HistoryRunner, HistoryLoadService, HistoryProcessor],
})
export class HistoryModule {}
```

In `backend/src/app.module.ts`: `import { HistoryModule } from './history/history.module';` and add `HistoryModule` to `imports` right after `SyncModule`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest src/history`
Expected: PASS.

- [ ] **Step 6: Full verification and commit**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json && npx nest build`
Expected: all pass; tsc only the pre-existing TS2353; build succeeds (no local Redis/Postgres is needed for the build).

```bash
git add backend/src/history backend/src/app.module.ts
git commit -m "Expose full-history loading through a queue and endpoints"
```

---

### Task 7: Coverage starts at the oldest stored post

**Files:**
- Modify: `backend/src/stats/stats.service.ts` (`getAccountDetail`)
- Test: `backend/src/stats/stats.service.spec.ts`

**Interfaces:**
- Produces: `coverage.postsFrom` = the earlier of (account.createdAt − 90 days) and the oldest stored post's `publishedAt`, as `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

In `backend/src/stats/stats.service.spec.ts`:

1. Add `oldestPost?: object | null;` to `interface Setup`, `oldestPost = null,` to `setup()`'s destructured defaults, and change `postsRepo` to:

```ts
  const postsRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest.fn().mockResolvedValue(oldestPost),
  } as any;
```

2. Replace the comment above the first coverage test with:

```ts
  // The first sync scrapes 90 days back, so post data begins 90 days before the
  // account was added — unless a full-history load reached further back.
```

3. Add inside `describe('StatsService.getAccountDetail coverage')`:

```ts
  it('says posts were collected from the oldest stored post when history reaches further back', async () => {
    const { service, postsRepo } = setup({ oldestPost: { publishedAt: new Date('2021-03-12T10:00:00Z') } });

    const { coverage } = await service.getAccountDetail('acc-1', period);

    expect(coverage.postsFrom).toBe('2021-03-12');
    expect(postsRepo.findOne).toHaveBeenCalledWith({ where: { accountId: 'acc-1' }, order: { publishedAt: 'ASC' } });
  });

  it('keeps the 90-day start when the oldest stored post is newer than that', async () => {
    const { service } = setup({ oldestPost: { publishedAt: new Date('2026-09-01T10:00:00Z') } });
    const { coverage } = await service.getAccountDetail('acc-1', period);
    expect(coverage.postsFrom).toBe('2026-06-12');
  });
```

4. Other specs construct `StatsService` with their own `postsRepo` mock (e.g. `stats.service.spec.ts` around lines 245 and 268, `stats.service.posts-page.spec.ts`). Any of them whose test calls `getAccountDetail` needs `findOne: jest.fn().mockResolvedValue(null)` added to that mock; run the whole `src/stats` folder to find them.

- [ ] **Step 2: Run to verify the new test fails**

Run: `cd backend && npx jest src/stats/stats.service.spec.ts -t coverage`
Expected: FAIL — `postsFrom` is `'2026-06-12'`, not `'2021-03-12'`.

- [ ] **Step 3: Implement**

In `getAccountDetail`, after the `firstSnapshot` lookup add:

```ts
    const oldestPost = await this.postsRepo.findOne({ where: { accountId }, order: { publishedAt: 'ASC' } });
    const windowStart = new Date(account.createdAt.getTime() - POST_HISTORY_DAYS * DAY_MS);
    const postsFrom = oldestPost && oldestPost.publishedAt < windowStart ? oldestPost.publishedAt : windowStart;
```

and change the coverage line to `postsFrom: isoDate(postsFrom),`.

- [ ] **Step 4: Run and commit**

Run: `cd backend && npx jest && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/stats
git commit -m "Start the posts coverage note at the oldest loaded post"
```

---

### Task 8: «За всё время» period preset

**Files:**
- Modify: `frontend/src/periods.ts`, `frontend/src/components/PeriodPicker.tsx`, `frontend/src/pages/AccountDetailPage.tsx`
- Test: `frontend/src/periods.test.ts` (create if absent; otherwise extend), `frontend/src/components/PeriodPicker.test.tsx`

**Interfaces:**
- Produces: `PresetId` gains `'allTime'`; `PRESETS` gains `{ id: 'allTime', label: 'За всё время' }` as the last entry; `presetRange(preset, today, allTimeFrom?: string)`; `selectPreset(preset, today, allTimeFrom?: string)`; `PeriodPicker` prop `allTimeFrom?: string` — the preset is listed only when it is given.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/periods.test.ts` (check first: `ls frontend/src/periods.test.ts`; if it exists, add to it and reuse its imports):

```ts
import { describe, it, expect } from 'vitest';
import { presetRange, selectPreset, PRESETS } from './periods';

describe('allTime preset', () => {
  const today = new Date(2026, 8, 28);

  it('runs from the given first date to today', () => {
    expect(presetRange('allTime', today, '2021-03-12')).toEqual({ from: '2021-03-12', to: '2026-09-28' });
    expect(selectPreset('allTime', today, '2021-03-12')).toEqual({ preset: 'allTime', from: '2021-03-12', to: '2026-09-28' });
  });

  it('is labelled «За всё время» and listed last', () => {
    expect(PRESETS.at(-1)).toEqual({ id: 'allTime', label: 'За всё время' });
  });
});
```

In `frontend/src/components/PeriodPicker.test.tsx` add (reuse the file's existing render/open helpers and `today`; read the file first):

```tsx
it('offers «За всё время» only when the first date is known, and applies it', () => {
  const onChange = vi.fn();
  const { rerender } = render(<PeriodPicker value={selectPreset('last30', today)} onChange={onChange} today={today} />);
  fireEvent.click(screen.getByRole('button', { name: /Выбрать даты/ }));
  expect(screen.queryByRole('button', { name: 'За всё время' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Выбрать даты/ }));
  rerender(<PeriodPicker value={selectPreset('last30', today)} onChange={onChange} today={today} allTimeFrom="2021-03-12" />);
  fireEvent.click(screen.getByRole('button', { name: /Выбрать даты/ }));
  fireEvent.click(screen.getByRole('button', { name: 'За всё время' }));

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: 'allTime', from: '2021-03-12' }));
});
```

(If the file's existing tests open the picker differently, open it the same way they do.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/periods.test.ts src/components/PeriodPicker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `periods.ts`**

- Add `| 'allTime'` to `PresetId`.
- Append `{ id: 'allTime', label: 'За всё время' },` to `PRESETS`.
- Change signatures and add the case:

```ts
export function presetRange(preset: PresetId, today: Date, allTimeFrom?: string): Period {
  // ...existing body...
    case 'allTime':
      // The account's first known post; without it there is nothing earlier to show.
      return { from: allTimeFrom ?? todayIso, to: todayIso };
  }
}

export function selectPreset(preset: PresetId, today: Date, allTimeFrom?: string): SelectedPeriod {
  return { preset, ...presetRange(preset, today, allTimeFrom) };
}
```

- [ ] **Step 4: Implement `PeriodPicker.tsx`**

- Add to `PeriodPickerProps`: `/** First day with data; enables «За всё время». */ allTimeFrom?: string;`
- Destructure `allTimeFrom` in the component signature.
- Add `const presets = PRESETS.filter((preset) => preset.id !== 'allTime' || allTimeFrom !== undefined);` and render `presets.map(...)` instead of `PRESETS.map(...)` in the quick column (keep `PRESETS.find` for `presetName`).
- `pickPreset`: `onChange(selectPreset(preset, today, allTimeFrom));`
- `apply`: `selectPreset(draftPreset, today, allTimeFrom)`.

- [ ] **Step 5: Wire it into `AccountDetailPage.tsx`**

- Change the import to `import { useEffect, useState } from 'react';`.
- After the `detail` hook (before any early return), add:

```tsx
  // History loads move the first known post back; keep «За всё время» honest.
  const postsFrom = detail.data?.coverage.postsFrom;
  useEffect(() => {
    if (postsFrom && period.preset === 'allTime' && period.from !== postsFrom) {
      setPeriod(selectPreset('allTime', new Date(), postsFrom));
    }
  }, [postsFrom, period.preset, period.from]);
```

- Pass the prop: `<PeriodPicker value={period} onChange={changePeriod} allTimeFrom={coverage.postsFrom} />`.

- [ ] **Step 6: Run and commit**

Run: `cd frontend && npx vitest run && npx tsc -b`

```bash
git add frontend/src
git commit -m "Add an «За всё время» period preset"
```

---

### Task 9: History panel on the account page

**Files:**
- Create: `frontend/src/components/HistoryLoadPanel.tsx`, `frontend/src/components/HistoryLoadPanel.module.css`, `frontend/src/components/HistoryLoadPanel.test.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /accounts/:id/history-load` (Task 6) → `HistoryLoadView` JSON (dates as ISO strings) or empty/`null`.
- Produces: `export function HistoryLoadPanel({ accountId, onFinished }: { accountId: string; onFinished: () => void })`.

Copy (exact):
- idle: button «Загрузить все посты»; hint «Один раз загрузит все посты аккаунта. Может занять от минут до нескольких часов.»
- posts phase (queued/running): «Загружаем историю: {N} {пост|поста|постов}» plus «, дошли до {месяц в родительном падеже} {год}» when `oldestPostAt` is set.
- insights phase (running): «Досчитываем охваты: {insightsDone} из {insightsTotal}»
- paused: the progress line above, then — `instagram_rate_limit`: «Пауза: лимит запросов Instagram, продолжим в {ЧЧ:ММ}»; `telegram_rate_limit`: «Telegram ограничил запросы, продолжим через {M} {минуту|минуты|минут}»; `network`: «Проблема с сетью, продолжим через {M} {минуту|минуты|минут}».
- done: «Вся история загружена: {N} {пост|поста|постов} с {ДД.ММ.ГГГГ of oldestPostAt}» (omit « с …» when `oldestPostAt` is null) + link-style button «Обновить всю историю».
- failed: «Не удалось загрузить историю: {errorMessage}» + button «Продолжить».
- start error: the response's `message`, else «Не удалось запустить загрузку истории».

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/HistoryLoadPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HistoryLoadPanel } from './HistoryLoadPanel';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;

const load = (overrides = {}) => ({
  status: 'running',
  phase: 'posts',
  postsLoaded: 0,
  oldestPostAt: null,
  insightsDone: 0,
  insightsTotal: 0,
  pausedUntil: null,
  pauseReason: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

async function renderPanel(onFinished = vi.fn()) {
  render(<HistoryLoadPanel accountId="acc-1" onFinished={onFinished} />);
  await act(async () => {});
  return onFinished;
}

describe('HistoryLoadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('offers to load everything when no load has run', async () => {
    get.mockResolvedValue({ data: '' });
    await renderPanel();

    expect(get).toHaveBeenCalledWith('/accounts/acc-1/history-load');
    expect(screen.getByRole('button', { name: 'Загрузить все посты' })).toBeInTheDocument();
    expect(screen.getByText('Один раз загрузит все посты аккаунта. Может занять от минут до нескольких часов.')).toBeInTheDocument();
  });

  it('starts a load and shows its progress', async () => {
    get.mockResolvedValue({ data: '' });
    post.mockResolvedValue({ data: load({ status: 'queued' }) });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Загрузить все посты' }));
    });

    expect(post).toHaveBeenCalledWith('/accounts/acc-1/history-load');
    expect(screen.getByText('Загружаем историю: 0 постов')).toBeInTheDocument();
  });

  it('shows posts loaded and how far back the load has reached', async () => {
    get.mockResolvedValue({ data: load({ postsLoaded: 1241, oldestPostAt: '2024-03-15T10:00:00.000Z' }) });
    await renderPanel();

    expect(screen.getByText('Загружаем историю: 1241 пост, дошли до марта 2024')).toBeInTheDocument();
  });

  it('polls every 5 seconds while running and reports completion once', async () => {
    get
      .mockResolvedValueOnce({ data: load({ postsLoaded: 20 }) })
      .mockResolvedValue({ data: load({ status: 'done', postsLoaded: 2314, oldestPostAt: '2019-03-12T10:00:00.000Z' }) });
    const onFinished = await renderPanel();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('Вся история загружена: 2314 постов с 12.03.2019')).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not report completion for a load that was already done on arrival', async () => {
    get.mockResolvedValue({ data: load({ status: 'done', postsLoaded: 5 }) });
    const onFinished = await renderPanel();
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Обновить всю историю' })).toBeInTheDocument();
  });

  it('shows insight progress in the Instagram phase', async () => {
    get.mockResolvedValue({ data: load({ phase: 'insights', insightsDone: 340, insightsTotal: 1200 }) });
    await renderPanel();
    expect(screen.getByText('Досчитываем охваты: 340 из 1200')).toBeInTheDocument();
  });

  it('explains an Instagram pause with the resume time and polls once a minute', async () => {
    const until = new Date(2026, 8, 28, 14, 30);
    get.mockResolvedValue({ data: load({ status: 'paused', postsLoaded: 10, pauseReason: 'instagram_rate_limit', pausedUntil: until.toISOString() }) });
    await renderPanel();

    expect(screen.getByText('Пауза: лимит запросов Instagram, продолжим в 14:30')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('explains a Telegram pause in minutes', async () => {
    get.mockResolvedValue({ data: load({ status: 'paused', pauseReason: 'telegram_rate_limit', pausedUntil: new Date(Date.now() + 5 * 60_000).toISOString() }) });
    await renderPanel();
    expect(screen.getByText('Telegram ограничил запросы, продолжим через 5 минут')).toBeInTheDocument();
  });

  it('shows the failure and continues from where it stopped', async () => {
    get.mockResolvedValue({ data: load({ status: 'failed', errorMessage: 'Instagram отклонил доступ, нужно переподключить аккаунт' }) });
    post.mockResolvedValue({ data: load({ status: 'queued', postsLoaded: 300 }) });
    await renderPanel();

    expect(screen.getByText('Не удалось загрузить историю: Instagram отклонил доступ, нужно переподключить аккаунт')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    });
    expect(post).toHaveBeenCalledWith('/accounts/acc-1/history-load');
  });

  it('shows why a start was refused', async () => {
    get.mockResolvedValue({ data: '' });
    post.mockRejectedValue({ response: { data: { message: 'Для этой платформы загрузка истории недоступна' } } });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Загрузить все посты' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Для этой платформы загрузка истории недоступна');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/HistoryLoadPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`frontend/src/components/HistoryLoadPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import styles from './HistoryLoadPanel.module.css';

interface HistoryLoad {
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  phase: 'posts' | 'insights';
  postsLoaded: number;
  oldestPostAt: string | null;
  insightsDone: number;
  insightsTotal: number;
  pausedUntil: string | null;
  pauseReason: 'instagram_rate_limit' | 'telegram_rate_limit' | 'network' | null;
  errorMessage: string | null;
}

interface HistoryLoadPanelProps {
  accountId: string;
  /** Called once when a load this page watched reaches «done». */
  onFinished: () => void;
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const pad = (n: number) => String(n).padStart(2, '0');
const posts = (n: number) => `${n} ${plural(n, 'пост', 'поста', 'постов')}`;
const monthYear = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
};
const date = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const time = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const minutesLeft = (iso: string) => {
  const m = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
  return `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
};

function isLoad(data: unknown): data is HistoryLoad {
  return !!data && typeof data === 'object' && 'status' in data;
}

function progressText(load: HistoryLoad): string {
  if (load.phase === 'insights') return `Досчитываем охваты: ${load.insightsDone} из ${load.insightsTotal}`;
  const reached = load.oldestPostAt ? `, дошли до ${monthYear(load.oldestPostAt)}` : '';
  return `Загружаем историю: ${posts(load.postsLoaded)}${reached}`;
}

function pauseText(load: HistoryLoad): string {
  const until = load.pausedUntil ?? new Date().toISOString();
  if (load.pauseReason === 'instagram_rate_limit') return `Пауза: лимит запросов Instagram, продолжим в ${time(until)}`;
  if (load.pauseReason === 'telegram_rate_limit') return `Telegram ограничил запросы, продолжим через ${minutesLeft(until)}`;
  return `Проблема с сетью, продолжим через ${minutesLeft(until)}`;
}

const POLL_ACTIVE_MS = 5_000;
const POLL_PAUSED_MS = 60_000;

export function HistoryLoadPanel({ accountId, onFinished }: HistoryLoadPanelProps) {
  const [load, setLoad] = useState<HistoryLoad | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a transition seen on this page counts as «finished»; a load that was
  // already done when the page opened must not trigger a reload.
  const lastStatus = useRef<HistoryLoad['status'] | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const accept = useCallback((data: unknown) => {
    const next = isLoad(data) ? data : null;
    if (next?.status === 'done' && lastStatus.current !== null && lastStatus.current !== 'done') finishedRef.current();
    lastStatus.current = next?.status ?? null;
    setLoad(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/accounts/${accountId}/history-load`);
      accept(data);
    } catch {
      // A missed poll is retried on the next tick.
    }
  }, [accountId, accept]);

  useEffect(() => {
    lastStatus.current = null;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!load) return;
    const wait =
      load.status === 'queued' || load.status === 'running'
        ? POLL_ACTIVE_MS
        : load.status === 'paused'
          ? POLL_PAUSED_MS
          : null;
    if (wait === null) return;
    const timer = setTimeout(() => void refresh(), wait);
    return () => clearTimeout(timer);
  }, [load, refresh]);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/accounts/${accountId}/history-load`);
      accept(data);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось запустить загрузку истории');
    } finally {
      setStarting(false);
    }
  }

  const status = load?.status;

  return (
    <div className={styles.panel}>
      {!load && (
        <>
          <button type="button" className={styles.button} onClick={start} disabled={starting}>
            Загрузить все посты
          </button>
          <p className={styles.hint}>Один раз загрузит все посты аккаунта. Может занять от минут до нескольких часов.</p>
        </>
      )}

      {load && (status === 'queued' || status === 'running' || status === 'paused') && (
        <div className={styles.progress} aria-live="polite">
          {status !== 'paused' && <span className={styles.spinner} aria-hidden="true" />}
          <span>{progressText(load)}</span>
          {status === 'paused' && <span className={styles.pause}>{pauseText(load)}</span>}
        </div>
      )}

      {load && status === 'done' && (
        <div className={styles.progress}>
          <span>
            Вся история загружена: {posts(load.postsLoaded)}
            {load.oldestPostAt ? ` с ${date(load.oldestPostAt)}` : ''}
          </span>
          <button type="button" className={styles.link} onClick={start} disabled={starting}>
            Обновить всю историю
          </button>
        </div>
      )}

      {load && status === 'failed' && (
        <div className={styles.progress}>
          <span className={styles.failure}>Не удалось загрузить историю: {load.errorMessage}</span>
          <button type="button" className={styles.button} onClick={start} disabled={starting}>
            Продолжить
          </button>
        </div>
      )}

      {error && (
        <p className={styles.failure} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

`frontend/src/components/HistoryLoadPanel.module.css` — follow `RefreshButton.module.css` (read it first) for the button look, using existing tokens only (`--border`, `--text`, `--text-h`, `--accent`, `--on-accent`, `--danger`); no new hard-coded colours:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}

.button {
  align-self: flex-start;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-h);
  font: inherit;
  cursor: pointer;
}

.button:hover:not(:disabled) {
  border-color: var(--accent);
}

.button:disabled {
  opacity: 0.6;
  cursor: default;
}

.link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.hint {
  margin: 0;
  opacity: 0.75;
}

.progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.pause {
  opacity: 0.8;
}

.failure {
  margin: 0;
  color: var(--danger);
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 4: Put it on the page**

In `frontend/src/pages/AccountDetailPage.tsx`: `import { HistoryLoadPanel } from '../components/HistoryLoadPanel';` and render it inside the header `div`, right after `<RefreshButton ... />`:

```tsx
        <HistoryLoadPanel
          accountId={account.id}
          onFinished={() => {
            setReloadKey((key) => key + 1);
            setTablePage(1);
          }}
        />
```

The page's existing tests mock unknown GETs as `{ data: [] }`; `isLoad([])` is false, so they see the idle panel and keep passing. Add one page test to `frontend/src/pages/AccountDetailPage.test.tsx`:

```tsx
it('shows the full-history panel for the account', async () => {
  mockApi();
  renderPage();
  expect(await screen.findByRole('button', { name: 'Загрузить все посты' })).toBeInTheDocument();
});
```

- [ ] **Step 5: Run and commit**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: all pass, no new warnings (act warnings count as failures to fix).

```bash
git add frontend/src
git commit -m "Show full-history loading on the account page"
```

---

### Task 10: Operations notes

**Files:**
- Modify: `docs/operations.md`

- [ ] **Step 1: Add a section**

Add `## Загрузка всей истории постов` (match the language and heading level of the neighbouring sections — read the file first) covering, in short bullets:
- What «Загрузить все посты» does; one load at a time app-wide; runs in the `history` queue; the nightly sync is unaffected.
- Deploy: new table `history_loads` → run `migration:run` immediately after `up -d --build`, as always.
- Progress query:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT a.name, h.status, h.phase, h.\"postsLoaded\", h.\"insightsDone\", h.\"insightsTotal\", h.\"pausedUntil\", h.\"errorMessage\" FROM history_loads h JOIN accounts a ON a.id = h.\"accountId\" ORDER BY h.\"startedAt\" DESC NULLS LAST;"'
```

- Stopping a load that must not continue: set it failed (the next slice then exits):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE history_loads SET status = '"'"'failed'"'"', \"errorMessage\" = '"'"'Остановлено вручную'"'"' WHERE \"accountId\" = '"'"'<account id>'"'"';"'
```

- Pauses: Instagram rate limit → 1 hour; Telegram 429 / network → 5 minutes; after a restart, unfinished loads resume on their own.
- Old posts' numbers are a snapshot from the load; ER for them uses today's follower count.

- [ ] **Step 2: Commit**

```bash
git add docs/operations.md
git commit -m "Document full post history loading"
```
