# Competitor Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Telegram channel is added, suggest the ten closest competitor channels, refreshable from an «Обновить конкурентов» button.

**Architecture:** A new NestJS module `competitors/` owns a BullMQ queue that mirrors `sync/`. One worker run builds a profile of the channel (title, description, 30 recent captions), asks Gemini 2.5 Flash with Google Search grounding for a niche plus ~20 candidate handles, verifies every handle through the Telegram Bot API, scores the survivors and stores the top ten. The model call sits behind a one-method `CompetitorFinder` interface so a Claude implementation can replace it later without touching the worker, endpoints or schema.

**Tech Stack:** NestJS 11, TypeORM 0.3 (Postgres), BullMQ, axios, Jest (backend), React 19 + Vite + Vitest + Testing Library (frontend).

**Spec:** [docs/superpowers/specs/2026-09-17-competitor-discovery-design.md](../specs/2026-09-17-competitor-discovery-design.md)

## Global Constraints

- **Branch:** `competitor-discovery` (already exists, spec committed on it). Do not commit to `master`.
- **All user-facing copy is Russian.** Backend error strings stored in `errorMessage` may be English; anything rendered is Russian.
- **No new npm dependencies.** Gemini is called over its REST API with `axios`, which is already a dependency.
- **Model:** `gemini-2.5-flash`, with the `google_search` tool. Grounding is free only on 2.5 models, so do not "upgrade" this string.
- **Provider seam:** the worker must depend only on the `CompetitorFinder` interface, never on `GeminiFinder` directly.
- **Never trust model output.** Every handle is verified through the Bot API before it is stored; follower counts always come from Telegram, never from the model.
- **Tests never touch the network.** axios is mocked in every test.
- **Frontend tests use `vi.clearAllMocks()` in `beforeEach`, never `mockReset`** — `mockReset` breaks `mockRejectedValue` in this suite.
- **CSS:** reuse the existing CSS-module patterns and custom properties from neighbouring components (e.g. `PostList.module.css`). Do not hardcode brand colours.

---

### Task 1: Entities and migration

**Files:**
- Create: `backend/src/db/entities/competitor-run.entity.ts`
- Create: `backend/src/db/entities/competitor-suggestion.entity.ts`
- Create: `backend/src/db/migrations/1789300000000-AddCompetitorTables.ts`
- Modify: `backend/src/db/db.module.ts:10-20` (register both entities)
- Modify: `backend/src/accounts/accounts.service.ts:153-162` (cascade delete)
- Test: `backend/src/accounts/accounts.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CompetitorRun`, `CompetitorRunTrigger`, `CompetitorRunStatus`, `CompetitorSuggestion` — used by every later backend task.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/accounts/accounts.service.spec.ts` (follow the existing describe block's construction style):

```ts
it('deletes competitor runs and suggestions along with the account', async () => {
  const em = { delete: jest.fn() };
  const repo = {
    findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    manager: { transaction: jest.fn(async (cb: any) => cb(em)) },
  } as any;
  const service = new AccountsService(repo, {} as any, {} as any);

  await service.remove('acc-1');

  expect(em.delete).toHaveBeenCalledWith(CompetitorSuggestion, { accountId: 'acc-1' });
  expect(em.delete).toHaveBeenCalledWith(CompetitorRun, { accountId: 'acc-1' });
});
```

Add the import: `import { CompetitorRun } from '../db/entities/competitor-run.entity';` and the same for `CompetitorSuggestion`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/accounts/accounts.service.spec.ts -t "competitor runs"`
Expected: FAIL — cannot find module `../db/entities/competitor-run.entity`.

- [ ] **Step 3: Create the entities**

`backend/src/db/entities/competitor-run.entity.ts`:

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum CompetitorRunTrigger {
  ACCOUNT_ADDED = 'account_added',
  MANUAL = 'manual',
}

export enum CompetitorRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('competitor_runs')
export class CompetitorRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'enum', enum: CompetitorRunTrigger }) trigger: CompetitorRunTrigger;
  @Column({ type: 'enum', enum: CompetitorRunStatus, default: CompetitorRunStatus.PENDING })
  status: CompetitorRunStatus;
  @Column({ nullable: true, type: 'text' }) niche: string | null;
  @Column({ type: 'varchar', length: 32 }) llmProvider: string;
  @Column({ type: 'varchar', length: 64 }) llmModel: string;
  @Column({ nullable: true, type: 'int' }) inputTokens: number | null;
  @Column({ nullable: true, type: 'int' }) outputTokens: number | null;
  /** Always 0 on the Gemini free tier; present so a Claude switch shows spend without a migration. */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 }) costUsd: string;
  @Column({ type: 'int', default: 0 }) candidatesProposed: number;
  @Column({ type: 'int', default: 0 }) candidatesVerified: number;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) startedAt: Date | null;
  @Column({ nullable: true, type: 'timestamptz' }) finishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
```

`backend/src/db/entities/competitor-suggestion.entity.ts`:

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('competitor_suggestions')
@Unique(['runId', 'externalId'])
@Index(['accountId'])
export class CompetitorSuggestion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') runId: string;
  @Column('uuid') accountId: string;
  /** Lowercased handle without '@', matching Account.externalId. */
  @Column({ type: 'varchar', length: 64 }) externalId: string;
  @Column({ type: 'varchar', length: 256 }) name: string;
  @Column({ type: 'int' }) followersCount: number;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'smallint' }) fit: number;
  @Column({ type: 'float' }) score: number;
  @Column({ type: 'smallint' }) rank: number;
  @CreateDateColumn() createdAt: Date;
}
```

- [ ] **Step 4: Register the entities and cascade the delete**

In `backend/src/db/db.module.ts`, import both entities and add them to **both** the `entities: [...]` array and `TypeOrmModule.forFeature([...])`.

In `backend/src/accounts/accounts.service.ts`, import both entities and add two deletes inside the existing transaction in `remove()`, before `em.delete(Account, { id })`:

```ts
await em.delete(CompetitorSuggestion, { accountId: id });
await em.delete(CompetitorRun, { accountId: id });
```

- [ ] **Step 5: Write the migration**

`backend/src/db/migrations/1789300000000-AddCompetitorTables.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tables behind competitor discovery: one row per search, plus its verified suggestions. */
export class AddCompetitorTables1789300000000 implements MigrationInterface {
  name = 'AddCompetitorTables1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "competitor_runs_trigger_enum" AS ENUM('account_added', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "competitor_runs_status_enum" AS ENUM('pending', 'running', 'success', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "competitor_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "trigger" "competitor_runs_trigger_enum" NOT NULL,
        "status" "competitor_runs_status_enum" NOT NULL DEFAULT 'pending',
        "niche" text,
        "llmProvider" character varying(32) NOT NULL,
        "llmModel" character varying(64) NOT NULL,
        "inputTokens" integer,
        "outputTokens" integer,
        "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "candidatesProposed" integer NOT NULL DEFAULT 0,
        "candidatesVerified" integer NOT NULL DEFAULT 0,
        "errorMessage" text,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitor_runs" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_competitor_runs_account" ON "competitor_runs" ("accountId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE TABLE "competitor_suggestions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        "externalId" character varying(64) NOT NULL,
        "name" character varying(256) NOT NULL,
        "followersCount" integer NOT NULL,
        "reason" text NOT NULL,
        "fit" smallint NOT NULL,
        "score" double precision NOT NULL,
        "rank" smallint NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitor_suggestions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_competitor_suggestions_run_handle" UNIQUE ("runId", "externalId"),
        CONSTRAINT "FK_competitor_suggestions_run" FOREIGN KEY ("runId")
          REFERENCES "competitor_runs"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_competitor_suggestions_account" ON "competitor_suggestions" ("accountId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "competitor_suggestions"`);
    await queryRunner.query(`DROP TABLE "competitor_runs"`);
    await queryRunner.query(`DROP TYPE "competitor_runs_status_enum"`);
    await queryRunner.query(`DROP TYPE "competitor_runs_trigger_enum"`);
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest src/accounts`
Expected: PASS, including the existing `remove` tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db backend/src/accounts
git commit -m "Add competitor run and suggestion tables"
```

---

### Task 2: Parsing a model reply into candidates

A pure function, written before any HTTP code, because lenient parsing is where this feature breaks.

**Files:**
- Create: `backend/src/competitors/competitor-finder.ts` (interface + types only)
- Create: `backend/src/competitors/parse-finder-reply.ts`
- Test: `backend/src/competitors/parse-finder-reply.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChannelProfile`, `RankedCandidate`, `FinderResult`, `CompetitorFinder`, `COMPETITOR_FINDER`, `parseFinderReply(text: string): ParsedReply`, `normalizeHandle(raw: string): string | null`.

- [ ] **Step 1: Write the failing test**

`backend/src/competitors/parse-finder-reply.spec.ts`:

```ts
import { parseFinderReply, normalizeHandle } from './parse-finder-reply';

describe('normalizeHandle', () => {
  it('accepts a bare handle, an @handle and a t.me link, always lowercased', () => {
    expect(normalizeHandle('DurovCodes')).toBe('durovcodes');
    expect(normalizeHandle('@DurovCodes')).toBe('durovcodes');
    expect(normalizeHandle('https://t.me/DurovCodes')).toBe('durovcodes');
  });

  it('rejects anything that cannot be a channel handle', () => {
    expect(normalizeHandle('abc')).toBeNull();
    expect(normalizeHandle('has spaces')).toBeNull();
    expect(normalizeHandle('9starts_with_digit')).toBeNull();
    expect(normalizeHandle('')).toBeNull();
  });
});

describe('parseFinderReply', () => {
  const reply = JSON.stringify({
    niche: 'Маркетинг в Telegram',
    competitors: [
      { handle: '@smmplanner', reason: 'Тот же сегмент SMM', fit: 9 },
      { handle: 'tgmarketing', reason: 'Похожая аудитория', fit: 7 },
    ],
  });

  it('parses a clean JSON reply', () => {
    const result = parseFinderReply(reply);
    expect(result.niche).toBe('Маркетинг в Telegram');
    expect(result.candidates).toEqual([
      { handle: 'smmplanner', reason: 'Тот же сегмент SMM', fit: 9 },
      { handle: 'tgmarketing', reason: 'Похожая аудитория', fit: 7 },
    ]);
  });

  it('parses JSON inside a fenced code block', () => {
    expect(parseFinderReply('```json\n' + reply + '\n```').candidates).toHaveLength(2);
  });

  it('parses JSON surrounded by prose', () => {
    expect(parseFinderReply(`Вот результат:\n${reply}\nНадеюсь, помог.`).candidates).toHaveLength(2);
  });

  it('drops entries with an unusable handle or no reason, and clamps fit to 1..10', () => {
    const messy = JSON.stringify({
      niche: 'Тест',
      competitors: [
        { handle: 'ok_channel', reason: 'Подходит', fit: 42 },
        { handle: 'no', reason: 'Слишком короткий хэндл', fit: 5 },
        { handle: 'missing_reason', fit: 5 },
      ],
    });
    expect(parseFinderReply(messy).candidates).toEqual([
      { handle: 'ok_channel', reason: 'Подходит', fit: 10 },
    ]);
  });

  it('throws when no candidates can be read', () => {
    expect(() => parseFinderReply('Извините, ничего не нашёл')).toThrow(
      'Модель вернула ответ без каналов',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/competitors/parse-finder-reply.spec.ts`
Expected: FAIL — cannot find module `./parse-finder-reply`.

- [ ] **Step 3: Write the types and the parser**

`backend/src/competitors/competitor-finder.ts`:

```ts
/** The channel a search is being run for. */
export interface ChannelProfile {
  handle: string;
  title: string;
  followersCount: number;
  description: string | null;
  captions: string[];
}

export interface RankedCandidate {
  handle: string;
  reason: string;
  fit: number;
}

export interface FinderResult {
  niche: string;
  candidates: RankedCandidate[];
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
}

/**
 * The single provider seam. The worker depends on this and never on a concrete
 * implementation, so Claude can replace Gemini without other changes.
 */
export interface CompetitorFinder {
  suggest(profile: ChannelProfile): Promise<FinderResult>;
}

export const COMPETITOR_FINDER = Symbol('COMPETITOR_FINDER');
```

`backend/src/competitors/parse-finder-reply.ts`:

```ts
import { RankedCandidate } from './competitor-finder';

export interface ParsedReply {
  niche: string;
  candidates: RankedCandidate[];
}

const HANDLE = /^[a-z][a-z0-9_]{4,31}$/;

/** Turns '@Name', 'https://t.me/Name' or 'Name' into 'name'; null when it cannot be a channel. */
export function normalizeHandle(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  return HANDLE.test(cleaned) ? cleaned : null;
}

/** The model may wrap its JSON in prose or a code fence, so take the outermost object. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Модель вернула ответ без каналов');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Модель вернула ответ без каналов');
  }
}

export function parseFinderReply(text: string): ParsedReply {
  const parsed = extractJson(text) as { niche?: unknown; competitors?: unknown };
  const rows = Array.isArray(parsed.competitors) ? parsed.competitors : [];

  const candidates: RankedCandidate[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const handle = normalizeHandle(String(row?.handle ?? ''));
    const reason = typeof row?.reason === 'string' ? row.reason.trim() : '';
    if (!handle || reason === '') continue;
    const rawFit = Number(row?.fit);
    const fit = Number.isFinite(rawFit) ? Math.min(10, Math.max(1, Math.round(rawFit))) : 5;
    candidates.push({ handle, reason, fit });
  }

  if (candidates.length === 0) throw new Error('Модель вернула ответ без каналов');
  return {
    niche: typeof parsed.niche === 'string' && parsed.niche.trim() !== '' ? parsed.niche.trim() : 'Не определена',
    candidates,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/competitors/parse-finder-reply.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitors
git commit -m "Parse competitor candidates out of a model reply"
```

---

### Task 3: The Gemini finder

**Files:**
- Create: `backend/src/competitors/gemini.finder.ts`
- Modify: `backend/.env.example`
- Test: `backend/src/competitors/gemini.finder.spec.ts`

**Interfaces:**
- Consumes: `CompetitorFinder`, `ChannelProfile`, `FinderResult`, `parseFinderReply`.
- Produces: `class GeminiFinder implements CompetitorFinder`, constructor `(apiKey: string, model = 'gemini-2.5-flash')`.

- [ ] **Step 1: Write the failing test**

`backend/src/competitors/gemini.finder.spec.ts`:

```ts
import axios from 'axios';
import { GeminiFinder } from './gemini.finder';
import { ChannelProfile } from './competitor-finder';

jest.mock('axios');
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

const profile: ChannelProfile = {
  handle: 'mychannel',
  title: 'Мой канал',
  followersCount: 5000,
  description: 'Про SMM',
  captions: ['Пост про рекламу', 'Пост про охваты'],
};

function reply(text: string) {
  return {
    data: {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
    },
  };
}

describe('GeminiFinder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks Gemini with Google Search grounding enabled and returns parsed candidates', async () => {
    mockedPost.mockResolvedValue(
      reply('{"niche":"SMM","competitors":[{"handle":"@rival","reason":"Та же тема","fit":8}]}') as any,
    );

    const result = await new GeminiFinder('key-123').suggest(profile);

    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toContain('gemini-2.5-flash:generateContent');
    expect((body as any).tools).toEqual([{ google_search: {} }]);
    expect((config as any).headers['x-goog-api-key']).toBe('key-123');
    expect(result.candidates).toEqual([{ handle: 'rival', reason: 'Та же тема', fit: 8 }]);
    expect(result.niche).toBe('SMM');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.inputTokens).toBe(1200);
    expect(result.outputTokens).toBe(300);
    expect(result.costUsd).toBe(0);
  });

  it('includes the channel title, description and captions in the prompt', async () => {
    mockedPost.mockResolvedValue(
      reply('{"niche":"SMM","competitors":[{"handle":"rival","reason":"Та же тема","fit":8}]}') as any,
    );

    await new GeminiFinder('key-123').suggest(profile);

    const prompt = (mockedPost.mock.calls[0][1] as any).contents[0].parts[0].text;
    expect(prompt).toContain('Мой канал');
    expect(prompt).toContain('Про SMM');
    expect(prompt).toContain('Пост про охваты');
    expect(prompt).toContain('@mychannel');
  });

  it('joins multi-part replies before parsing', async () => {
    mockedPost.mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                { text: '{"niche":"SMM","competitors":[' },
                { text: '{"handle":"rival","reason":"Та же тема","fit":8}]}' },
              ],
            },
          },
        ],
        usageMetadata: {},
      },
    } as any);

    const result = await new GeminiFinder('key-123').suggest(profile);

    expect(result.candidates).toHaveLength(1);
    expect(result.inputTokens).toBeNull();
  });

  it('reports a quota error in Russian', async () => {
    mockedPost.mockRejectedValue({ response: { status: 429 } });

    await expect(new GeminiFinder('key-123').suggest(profile)).rejects.toThrow(
      'Превышен лимит запросов, попробуйте позже',
    );
  });

  it('reports a blocked region in Russian', async () => {
    mockedPost.mockRejectedValue({
      response: { status: 400, data: { error: { message: 'User location is not supported' } } },
    });

    await expect(new GeminiFinder('key-123').suggest(profile)).rejects.toThrow(
      'Gemini недоступен из региона сервера',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/competitors/gemini.finder.spec.ts`
Expected: FAIL — cannot find module `./gemini.finder`.

- [ ] **Step 3: Write the finder**

`backend/src/competitors/gemini.finder.ts`:

```ts
import axios from 'axios';
import { ChannelProfile, CompetitorFinder, FinderResult } from './competitor-finder';
import { parseFinderReply } from './parse-finder-reply';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_CAPTIONS = 30;
const MAX_CAPTION_CHARS = 400;

/**
 * Gemini 2.5 Flash with Google Search grounding: free up to 500 grounded
 * requests a day, which one run per added channel cannot approach. Grounding is
 * not free on 3.x models, so the model string is deliberate.
 *
 * Grounded generation cannot be combined with a strict response schema, so the
 * reply is parsed leniently instead of being constrained.
 */
export class GeminiFinder implements CompetitorFinder {
  constructor(
    private apiKey: string,
    private model = 'gemini-2.5-flash',
  ) {}

  async suggest(profile: ChannelProfile): Promise<FinderResult> {
    const body = {
      contents: [{ parts: [{ text: buildPrompt(profile) }] }],
      tools: [{ google_search: {} }],
    };

    let data: any;
    try {
      const response = await axios.post(`${ENDPOINT}/${this.model}:generateContent`, body, {
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        timeout: 120_000,
      });
      data = response.data;
    } catch (error) {
      throw translateError(error);
    }

    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part?.text ?? '')
      .join('');
    const parsed = parseFinderReply(text);
    const usage = data?.usageMetadata ?? {};

    return {
      niche: parsed.niche,
      candidates: parsed.candidates,
      provider: 'gemini',
      model: this.model,
      inputTokens: typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : null,
      outputTokens: typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : null,
      // Free tier: tokens and grounded search are both free of charge.
      costUsd: 0,
    };
  }
}

function buildPrompt(profile: ChannelProfile): string {
  const captions = profile.captions
    .slice(0, MAX_CAPTIONS)
    .map((caption) => `- ${caption.slice(0, MAX_CAPTION_CHARS)}`)
    .join('\n');

  return [
    'Ты помогаешь аналитику Telegram-каналов найти ближайших конкурентов.',
    '',
    `Канал: ${profile.title} (@${profile.handle}), подписчиков: ${profile.followersCount}.`,
    `Описание: ${profile.description ?? 'нет'}`,
    'Последние посты:',
    captions || '- нет постов',
    '',
    'Найди через поиск до 20 русскоязычных Telegram-каналов той же тематики и',
    'сопоставимого размера. Используй каталоги каналов и подборки «похожие каналы».',
    `Не включай сам канал @${profile.handle}. Указывай только публичные каналы с @-именем.`,
    '',
    'Ответь ТОЛЬКО JSON без пояснений:',
    '{"niche":"<ниша канала по-русски>","competitors":[{"handle":"@channel","reason":"<почему конкурент, одна строка по-русски>","fit":<1-10>}]}',
  ].join('\n');
}

function translateError(error: unknown): Error {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const message = String(
    (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? '',
  );
  if (status === 429) return new Error('Превышен лимит запросов, попробуйте позже');
  if (/location is not supported/i.test(message)) return new Error('Gemini недоступен из региона сервера');
  if (status === 401 || status === 403) return new Error('Ключ Gemini отклонён');
  return new Error(`Gemini не ответил: ${(error as Error).message ?? 'неизвестная ошибка'}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/competitors/gemini.finder.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Document the environment variable**

Add to `backend/.env.example`:

```
# Competitor discovery. Gemini 2.5 Flash with free Google Search grounding.
GEMINI_API_KEY=
# gemini (default). A claude implementation can be added later without schema changes.
COMPETITOR_LLM=gemini
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/competitors backend/.env.example
git commit -m "Ask Gemini for competitor channels with grounded search"
```

---

### Task 4: Scoring

**Files:**
- Create: `backend/src/competitors/score.ts`
- Test: `backend/src/competitors/score.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `scoreCandidate(fit: number, ownFollowers: number, candidateFollowers: number): number`.

- [ ] **Step 1: Write the failing test**

`backend/src/competitors/score.spec.ts`:

```ts
import { scoreCandidate } from './score';

describe('scoreCandidate', () => {
  it('gives a perfect fit at an identical size the maximum score', () => {
    expect(scoreCandidate(10, 5000, 5000)).toBeCloseTo(1);
  });

  it('halves the weight of size, so a great match of a different size still beats a poor match of the same size', () => {
    const differentSize = scoreCandidate(10, 5000, 500);
    const sameSizePoorFit = scoreCandidate(3, 5000, 5000);
    expect(differentSize).toBeGreaterThan(sameSizePoorFit);
  });

  it('ranks the closer size higher when the fit is equal', () => {
    expect(scoreCandidate(8, 10_000, 9000)).toBeGreaterThan(scoreCandidate(8, 10_000, 100));
  });

  it('treats an unknown or zero follower count as no size information', () => {
    expect(scoreCandidate(10, 0, 5000)).toBeCloseTo(0.5);
    expect(scoreCandidate(10, 5000, 0)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/competitors/score.spec.ts`
Expected: FAIL — cannot find module `./score`.

- [ ] **Step 3: Write the implementation**

`backend/src/competitors/score.ts`:

```ts
/**
 * score = (fit / 10) * (0.5 + 0.5 * sizeSimilarity)
 *
 * Size matters, but only half as much as subject fit: a 5k channel should not be
 * shown a 2M-subscriber giant, yet a great topical match of a different size must
 * still outrank a weak match of identical size.
 */
export function scoreCandidate(fit: number, ownFollowers: number, candidateFollowers: number): number {
  const clampedFit = Math.min(10, Math.max(1, fit)) / 10;
  const sizeSimilarity =
    ownFollowers > 0 && candidateFollowers > 0
      ? Math.min(ownFollowers, candidateFollowers) / Math.max(ownFollowers, candidateFollowers)
      : 0;
  return clampedFit * (0.5 + 0.5 * sizeSimilarity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/competitors/score.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitors/score.ts backend/src/competitors/score.spec.ts
git commit -m "Score competitor candidates by fit and size similarity"
```

---

### Task 5: Channel description from the Bot API

The profile needs the channel description, which `getChat` already returns and the client currently throws away.

**Files:**
- Modify: `backend/src/connectors/connector.interface.ts:3-6` (`AccountInfo`)
- Modify: `backend/src/connectors/telegram/telegram-api.client.ts:31-36`
- Modify: `backend/src/connectors/telegram/telegram.connector.ts` (map it through `getAccountInfo`)
- Test: `backend/src/connectors/telegram/telegram-api.client.spec.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `AccountInfo.description: string | null`, returned by `TelegramConnector.getAccountInfo`.

- [ ] **Step 1: Write the failing test**

`backend/src/connectors/telegram/telegram-api.client.spec.ts`:

```ts
import axios from 'axios';
import { TelegramApiClient } from './telegram-api.client';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

describe('TelegramApiClient.getChat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the channel description alongside the title', async () => {
    mockedGet.mockResolvedValue({
      data: { ok: true, result: { title: 'Канал', description: 'Про маркетинг', photo: { big_file_id: 'f1' } } },
    } as any);

    const result = await new TelegramApiClient('token').getChat('@channel');

    expect(result).toEqual({ title: 'Канал', description: 'Про маркетинг', photoUrl: 'f1' });
  });

  it('returns null when the channel has no description', async () => {
    mockedGet.mockResolvedValue({ data: { ok: true, result: { title: 'Канал' } } } as any);

    const result = await new TelegramApiClient('token').getChat('@channel');

    expect(result).toEqual({ title: 'Канал', description: null, photoUrl: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/connectors/telegram/telegram-api.client.spec.ts`
Expected: FAIL — received object has no `description` key.

- [ ] **Step 3: Write the implementation**

In `telegram-api.client.ts`, replace `getChat` with:

```ts
  async getChat(chatId: string): Promise<{ title: string; description: string | null; photoUrl: string | null }> {
    const result = await this.call<{ title: string; description?: string; photo?: { big_file_id: string } }>(
      'getChat',
      { chat_id: chatId },
    );
    return {
      title: result.title,
      description: result.description ?? null,
      photoUrl: result.photo ? result.photo.big_file_id : null,
    };
  }
```

In `connector.interface.ts`, add to `AccountInfo`:

```ts
  /** The channel's "about" text, when the platform exposes one. */
  description: string | null;
```

In `telegram.connector.ts`, pass it through in `getAccountInfo` (return `description: chat.description` next to `name` and `avatarUrl`). Fix any other `AccountInfo` literal the compiler flags — set `description: null` where a platform has none.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/connectors && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors
git commit -m "Read a channel's description from getChat"
```

---

### Task 6: Building the profile and verifying candidates

**Files:**
- Create: `backend/src/competitors/competitor-profile.service.ts`
- Create: `backend/src/competitors/competitor-verifier.service.ts`
- Test: `backend/src/competitors/competitor-profile.service.spec.ts`
- Test: `backend/src/competitors/competitor-verifier.service.spec.ts`

**Interfaces:**
- Consumes: `ChannelProfile`, `RankedCandidate`, `ConnectorRegistry`, `Account`, `Post`, `AccountSnapshot`.
- Produces:
  - `CompetitorProfileService.build(account: Account): Promise<ChannelProfile>`
  - `CompetitorVerifier.verify(candidates: RankedCandidate[], profile: ChannelProfile): Promise<VerifiedCandidate[]>`
  - `interface VerifiedCandidate { handle: string; name: string; followersCount: number; reason: string; fit: number }`

- [ ] **Step 1: Write the failing tests**

`backend/src/competitors/competitor-profile.service.spec.ts`:

```ts
import { CompetitorProfileService } from './competitor-profile.service';
import { AccountPlatform } from '../db/entities/account.entity';

describe('CompetitorProfileService', () => {
  const account = { id: 'acc-1', platform: AccountPlatform.TELEGRAM, externalId: 'mychannel', name: 'Мой канал' } as any;

  it('builds a profile from the connector info and the 30 newest captions', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Мой канал', description: 'Про SMM', avatarUrl: null }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 5000 }),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;
    const postsRepo = {
      find: jest.fn().mockResolvedValue([{ caption: 'Первый' }, { caption: null }, { caption: 'Второй' }]),
    } as any;

    const profile = await new CompetitorProfileService(registry, postsRepo).build(account);

    expect(profile).toEqual({
      handle: 'mychannel',
      title: 'Мой канал',
      followersCount: 5000,
      description: 'Про SMM',
      captions: ['Первый', 'Второй'],
    });
    expect(postsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 'acc-1' }, order: { publishedAt: 'DESC' }, take: 30 }),
    );
  });

  it('still builds a profile when stats cannot be fetched', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Мой канал', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockRejectedValue(new Error('429')),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue([]) } as any;

    const profile = await new CompetitorProfileService(registry, postsRepo).build(account);

    expect(profile.followersCount).toBe(0);
    expect(profile.captions).toEqual([]);
  });
});
```

`backend/src/competitors/competitor-verifier.service.spec.ts`:

```ts
import { CompetitorVerifier } from './competitor-verifier.service';
import { ChannelProfile } from './competitor-finder';

const profile: ChannelProfile = {
  handle: 'mychannel',
  title: 'Мой канал',
  followersCount: 5000,
  description: null,
  captions: [],
};

describe('CompetitorVerifier', () => {
  it('keeps channels Telegram confirms, using Telegram follower counts', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Конкурент', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4200 }),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [{ handle: 'rival', reason: 'Та же тема', fit: 8 }],
      profile,
    );

    expect(result).toEqual([
      { handle: 'rival', name: 'Конкурент', followersCount: 4200, reason: 'Та же тема', fit: 8 },
    ]);
  });

  it('drops handles Telegram does not resolve', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockRejectedValue(new Error('chat not found')),
      getAccountStats: jest.fn(),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [{ handle: 'ghost', reason: 'Нет такого', fit: 9 }],
      profile,
    );

    expect(result).toEqual([]);
  });

  it('drops the analysed channel itself and duplicate handles', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Конкурент', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4200 }),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [
        { handle: 'mychannel', reason: 'Это мы сами', fit: 10 },
        { handle: 'rival', reason: 'Та же тема', fit: 8 },
        { handle: 'rival', reason: 'Дубликат', fit: 7 },
      ],
      profile,
    );

    expect(result.map((c) => c.handle)).toEqual(['rival']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/competitors/competitor-profile.service.spec.ts src/competitors/competitor-verifier.service.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the services**

`backend/src/competitors/competitor-profile.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { ChannelProfile } from './competitor-finder';

const CAPTION_COUNT = 30;

@Injectable()
export class CompetitorProfileService {
  constructor(
    private registry: ConnectorRegistry,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
  ) {}

  async build(account: Account): Promise<ChannelProfile> {
    const connector = this.registry.get(account.platform);
    const info = await connector.getAccountInfo(account);

    // A rate-limited stats call must not sink the whole run: size only weights
    // the ranking, while the title and description carry the topic.
    let followersCount = 0;
    try {
      followersCount = (await connector.getAccountStats(account)).followersCount;
    } catch {
      followersCount = 0;
    }

    const posts = await this.postsRepo.find({
      where: { accountId: account.id },
      order: { publishedAt: 'DESC' },
      take: CAPTION_COUNT,
    });

    return {
      handle: account.externalId,
      title: info.name ?? account.name,
      followersCount,
      description: info.description ?? null,
      captions: posts.map((post) => post.caption).filter((c): c is string => typeof c === 'string' && c.trim() !== ''),
    };
  }
}
```

`backend/src/competitors/competitor-verifier.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { ChannelProfile, RankedCandidate } from './competitor-finder';

export interface VerifiedCandidate {
  handle: string;
  name: string;
  followersCount: number;
  reason: string;
  fit: number;
}

/**
 * A model naming Telegram channels will name some that do not exist. Only
 * channels Telegram itself resolves are ever stored, and the follower count
 * kept is Telegram's, never the model's.
 */
@Injectable()
export class CompetitorVerifier {
  private readonly logger = new Logger(CompetitorVerifier.name);

  constructor(private registry: ConnectorRegistry) {}

  async verify(candidates: RankedCandidate[], profile: ChannelProfile): Promise<VerifiedCandidate[]> {
    const connector = this.registry.get(AccountPlatform.TELEGRAM);
    const verified: VerifiedCandidate[] = [];
    const seen = new Set<string>([profile.handle]);

    for (const candidate of candidates) {
      if (seen.has(candidate.handle)) continue;
      seen.add(candidate.handle);

      const draft = { platform: AccountPlatform.TELEGRAM, externalId: candidate.handle } as Account;
      try {
        const info = await connector.getAccountInfo(draft);
        const stats = await connector.getAccountStats(draft);
        verified.push({
          handle: candidate.handle,
          name: info.name,
          followersCount: stats.followersCount,
          reason: candidate.reason,
          fit: candidate.fit,
        });
      } catch (error) {
        this.logger.debug(`Dropping unverifiable candidate @${candidate.handle}: ${(error as Error).message}`);
      }
    }

    return verified;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/competitors`
Expected: PASS (all competitor specs).

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitors
git commit -m "Build a channel profile and verify candidates against Telegram"
```

---

### Task 7: Run service and queue guards

**Files:**
- Create: `backend/src/competitors/competitor-run.service.ts`
- Test: `backend/src/competitors/competitor-run.service.spec.ts`

**Interfaces:**
- Consumes: `CompetitorRun`, `CompetitorRunTrigger`, `CompetitorRunStatus`.
- Produces:
  - `CompetitorRunService.isEnabled(): boolean`
  - `.createManual(accountId: string): Promise<CompetitorRun>` — throws `ConflictException` / `ServiceUnavailableException`
  - `.createForNewAccount(accountId: string): Promise<CompetitorRun | null>`
  - `.findLatest(accountId: string): Promise<CompetitorRun | null>`

- [ ] **Step 1: Write the failing test**

`backend/src/competitors/competitor-run.service.spec.ts`:

```ts
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { CompetitorRunService } from './competitor-run.service';
import { CompetitorRunStatus, CompetitorRunTrigger } from '../db/entities/competitor-run.entity';

function makeService(overrides: { runs?: any; queue?: any; enabled?: boolean } = {}) {
  const runsRepo = overrides.runs ?? {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((x) => x),
    save: jest.fn().mockImplementation((x) => Promise.resolve({ id: 'run-1', ...x })),
  };
  const queue = overrides.queue ?? { add: jest.fn() };
  const service = new CompetitorRunService(runsRepo, queue, {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    enabled: overrides.enabled ?? true,
  });
  return { service, runsRepo, queue };
}

describe('CompetitorRunService', () => {
  it('createManual saves a pending run and enqueues it', async () => {
    const { service, runsRepo, queue } = makeService();

    const run = await service.createManual('acc-1');

    expect(runsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        trigger: CompetitorRunTrigger.MANUAL,
        status: CompetitorRunStatus.PENDING,
        llmProvider: 'gemini',
        llmModel: 'gemini-2.5-flash',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'find-competitors',
      { runId: 'run-1', accountId: 'acc-1' },
      expect.objectContaining({ attempts: 2, backoff: { type: 'exponential', delay: 60000 } }),
    );
    expect(run.id).toBe('run-1');
  });

  it('refuses a second run while one is pending or running', async () => {
    const { service } = makeService({
      runs: {
        findOne: jest.fn().mockResolvedValue({ id: 'run-0', status: CompetitorRunStatus.RUNNING }),
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      },
    });

    await expect(service.createManual('acc-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to run when no provider key is configured', async () => {
    const { service } = makeService({ enabled: false });

    await expect(service.createManual('acc-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('createForNewAccount enqueues once and never again for that account', async () => {
    const { service, queue } = makeService({
      runs: {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn((x) => x),
        save: jest.fn(),
      },
    });

    const result = await service.createForNewAccount('acc-1');

    expect(result).toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('createForNewAccount stays silent when the feature is disabled', async () => {
    const { service, queue } = makeService({ enabled: false });

    await expect(service.createForNewAccount('acc-1')).resolves.toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/competitors/competitor-run.service.spec.ts`
Expected: FAIL — cannot find module `./competitor-run.service`.

- [ ] **Step 3: Write the service**

`backend/src/competitors/competitor-run.service.ts`:

```ts
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import {
  CompetitorRun,
  CompetitorRunStatus,
  CompetitorRunTrigger,
} from '../db/entities/competitor-run.entity';

/** One retry, widely spaced: provider hiccups are transient, but each run is a real call. */
const RETRY_OPTIONS = { attempts: 2, backoff: { type: 'exponential' as const, delay: 60_000 } };

export const COMPETITOR_CONFIG = Symbol('COMPETITOR_CONFIG');

export interface CompetitorConfig {
  provider: string;
  model: string;
  enabled: boolean;
}

@Injectable()
export class CompetitorRunService {
  constructor(
    @InjectRepository(CompetitorRun) private runsRepo: Repository<CompetitorRun>,
    @InjectQueue('competitors') private queue: Queue,
    @Inject(COMPETITOR_CONFIG) private config: CompetitorConfig,
  ) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async createManual(accountId: string): Promise<CompetitorRun> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Подбор конкурентов не настроен');
    }
    if (await this.activeRun(accountId)) {
      throw new ConflictException('Подбор конкурентов уже выполняется');
    }
    return this.enqueue(accountId, CompetitorRunTrigger.MANUAL);
  }

  /**
   * Fired after an account's first sync. The guard is "this account has no run
   * yet", not the sync trigger, so the nightly sync can never re-run discovery.
   */
  async createForNewAccount(accountId: string): Promise<CompetitorRun | null> {
    if (!this.config.enabled) return null;
    if ((await this.runsRepo.count({ where: { accountId } })) > 0) return null;
    if (await this.activeRun(accountId)) return null;
    return this.enqueue(accountId, CompetitorRunTrigger.ACCOUNT_ADDED);
  }

  findLatest(accountId: string): Promise<CompetitorRun | null> {
    return this.runsRepo.findOne({ where: { accountId }, order: { createdAt: 'DESC' } });
  }

  private activeRun(accountId: string): Promise<CompetitorRun | null> {
    return this.runsRepo.findOne({
      where: { accountId, status: In([CompetitorRunStatus.PENDING, CompetitorRunStatus.RUNNING]) },
    });
  }

  private async enqueue(accountId: string, trigger: CompetitorRunTrigger): Promise<CompetitorRun> {
    const run = await this.runsRepo.save(
      this.runsRepo.create({
        accountId,
        trigger,
        status: CompetitorRunStatus.PENDING,
        llmProvider: this.config.provider,
        llmModel: this.config.model,
      }),
    );
    await this.queue.add('find-competitors', { runId: run.id, accountId }, RETRY_OPTIONS);
    return run;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/competitors/competitor-run.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitors
git commit -m "Queue competitor runs with concurrency and feature guards"
```

---

### Task 8: The worker

**Files:**
- Create: `backend/src/competitors/competitors.processor.ts`
- Test: `backend/src/competitors/competitors.processor.spec.ts`

**Interfaces:**
- Consumes: `CompetitorProfileService.build`, `CompetitorFinder.suggest`, `CompetitorVerifier.verify`, `scoreCandidate`, both entities.
- Produces: `CompetitorsProcessor.process(job)`.

- [ ] **Step 1: Write the failing test**

`backend/src/competitors/competitors.processor.spec.ts`:

```ts
import { CompetitorsProcessor } from './competitors.processor';
import { CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';

const profile = {
  handle: 'mychannel',
  title: 'Мой канал',
  followersCount: 5000,
  description: null,
  captions: [],
};

function makeProcessor(overrides: any = {}) {
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', externalId: 'mychannel' }) };
  const runsRepo = { update: jest.fn() };
  const suggestionsRepo = { delete: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) };
  const profiles = { build: jest.fn().mockResolvedValue(profile) };
  const finder = overrides.finder ?? {
    suggest: jest.fn().mockResolvedValue({
      niche: 'SMM',
      candidates: [
        { handle: 'rival', reason: 'Та же тема', fit: 9 },
        { handle: 'ghost', reason: 'Не существует', fit: 8 },
      ],
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0,
    }),
  };
  const verifier = overrides.verifier ?? {
    verify: jest.fn().mockResolvedValue([
      { handle: 'rival', name: 'Конкурент', followersCount: 4800, reason: 'Та же тема', fit: 9 },
    ]),
  };
  const processor = new CompetitorsProcessor(
    accountsRepo as any,
    runsRepo as any,
    suggestionsRepo as any,
    profiles as any,
    finder as any,
    verifier as any,
  );
  return { processor, runsRepo, suggestionsRepo, finder, verifier };
}

const job = (attemptsMade = 1) =>
  ({ data: { runId: 'run-1', accountId: 'acc-1' }, opts: { attempts: 2 }, attemptsMade }) as any;

describe('CompetitorsProcessor', () => {
  it('stores verified suggestions, the niche and the usage of a successful run', async () => {
    const { processor, runsRepo, suggestionsRepo } = makeProcessor();

    await processor.process(job());

    expect(suggestionsRepo.delete).toHaveBeenCalledWith({ accountId: 'acc-1' });
    expect(suggestionsRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ externalId: 'rival', name: 'Конкурент', followersCount: 4800, rank: 1, fit: 9 }),
    ]);
    expect(runsRepo.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({
        status: CompetitorRunStatus.SUCCESS,
        niche: 'SMM',
        candidatesProposed: 2,
        candidatesVerified: 1,
        inputTokens: 1200,
        outputTokens: 300,
      }),
    );
  });

  it('keeps the previous suggestions when a run fails', async () => {
    const { processor, suggestionsRepo } = makeProcessor({
      finder: { suggest: jest.fn().mockRejectedValue(new Error('Превышен лимит запросов, попробуйте позже')) },
    });

    await expect(processor.process(job())).rejects.toThrow('Превышен лимит запросов');

    expect(suggestionsRepo.delete).not.toHaveBeenCalled();
  });

  it('records FAILED only on the final attempt', async () => {
    const { processor, runsRepo } = makeProcessor({
      finder: { suggest: jest.fn().mockRejectedValue(new Error('Gemini не ответил')) },
    });

    await expect(processor.process(job(0))).rejects.toThrow();

    expect(runsRepo.update).not.toHaveBeenCalledWith('run-1', expect.objectContaining({ status: CompetitorRunStatus.FAILED }));
  });

  it('marks a run successful with no suggestions when nothing verifies', async () => {
    const { processor, runsRepo, suggestionsRepo } = makeProcessor({
      verifier: { verify: jest.fn().mockResolvedValue([]) },
    });

    await processor.process(job());

    expect(suggestionsRepo.save).not.toHaveBeenCalled();
    expect(runsRepo.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({ status: CompetitorRunStatus.SUCCESS, candidatesVerified: 0 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/competitors/competitors.processor.spec.ts`
Expected: FAIL — cannot find module `./competitors.processor`.

- [ ] **Step 3: Write the worker**

`backend/src/competitors/competitors.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Account } from '../db/entities/account.entity';
import { CompetitorRun, CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { COMPETITOR_FINDER, CompetitorFinder } from './competitor-finder';
import { CompetitorProfileService } from './competitor-profile.service';
import { CompetitorVerifier } from './competitor-verifier.service';
import { scoreCandidate } from './score';

interface CompetitorJobData {
  runId: string;
  accountId: string;
}

const KEEP = 10;

function isFinalAttempt(job: Job<CompetitorJobData>): boolean {
  const allowed = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) + 1 >= allowed;
}

@Processor('competitors', { concurrency: 1 })
export class CompetitorsProcessor extends WorkerHost {
  private readonly logger = new Logger(CompetitorsProcessor.name);

  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(CompetitorRun) private runsRepo: Repository<CompetitorRun>,
    @InjectRepository(CompetitorSuggestion) private suggestionsRepo: Repository<CompetitorSuggestion>,
    private profiles: CompetitorProfileService,
    @Inject(COMPETITOR_FINDER) private finder: CompetitorFinder,
    private verifier: CompetitorVerifier,
  ) {
    super();
  }

  async process(job: Job<CompetitorJobData>): Promise<void> {
    const { runId, accountId } = job.data;

    try {
      await this.runsRepo.update(runId, { status: CompetitorRunStatus.RUNNING, startedAt: new Date() });

      const account = await this.accountsRepo.findOneBy({ id: accountId });
      if (!account) throw new Error(`Account ${accountId} not found`);

      const profile = await this.profiles.build(account);
      const result = await this.finder.suggest(profile);
      const verified = await this.verifier.verify(result.candidates, profile);

      const ranked = verified
        .map((candidate) => ({
          ...candidate,
          score: scoreCandidate(candidate.fit, profile.followersCount, candidate.followersCount),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, KEEP);

      // Replaced only once a run has produced something: a failed run must leave
      // the previous list intact.
      await this.suggestionsRepo.delete({ accountId });
      if (ranked.length > 0) {
        await this.suggestionsRepo.save(
          ranked.map((candidate, index) =>
            this.suggestionsRepo.create({
              runId,
              accountId,
              externalId: candidate.handle,
              name: candidate.name,
              followersCount: candidate.followersCount,
              reason: candidate.reason,
              fit: candidate.fit,
              score: candidate.score,
              rank: index + 1,
            }),
          ),
        );
      }

      await this.runsRepo.update(runId, {
        status: CompetitorRunStatus.SUCCESS,
        niche: result.niche,
        llmProvider: result.provider,
        llmModel: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd.toFixed(4),
        candidatesProposed: result.candidates.length,
        candidatesVerified: verified.length,
        finishedAt: new Date(),
      });
    } catch (error) {
      if (isFinalAttempt(job)) {
        try {
          await this.runsRepo.update(runId, {
            status: CompetitorRunStatus.FAILED,
            errorMessage: (error as Error).message,
            finishedAt: new Date(),
          });
        } catch (updateError) {
          this.logger.error(
            `Failed to record FAILED status for competitor run ${runId}: ${(error as Error).message}`,
            (updateError as Error).stack,
          );
        }
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/competitors/competitors.processor.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitors
git commit -m "Run competitor discovery end to end in a worker"
```

---

### Task 9: Endpoints and module wiring

**Files:**
- Create: `backend/src/competitors/competitors.controller.ts`
- Create: `backend/src/competitors/competitors.service.ts`
- Create: `backend/src/competitors/competitors.module.ts`
- Modify: `backend/src/app.module.ts` (import `CompetitorsModule`)
- Test: `backend/src/competitors/competitors.service.spec.ts`

**Interfaces:**
- Consumes: `CompetitorRunService`, `CompetitorSuggestion`, `Account`.
- Produces:
  - `GET /accounts/:accountId/competitors` → `{ enabled, run, suggestions }`
  - `POST /accounts/:accountId/competitors/refresh` → the created run
  - `CompetitorsService.getFor(accountId)`

- [ ] **Step 1: Write the failing test**

`backend/src/competitors/competitors.service.spec.ts`:

```ts
import { CompetitorsService } from './competitors.service';
import { CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { AccountPlatform } from '../db/entities/account.entity';

describe('CompetitorsService.getFor', () => {
  const run = {
    id: 'run-1',
    status: CompetitorRunStatus.SUCCESS,
    niche: 'SMM',
    errorMessage: null,
    finishedAt: new Date('2026-09-17T10:00:00Z'),
  };

  it('marks suggestions the user already tracks and links them to their account', async () => {
    const runs = { findLatest: jest.fn().mockResolvedValue(run), isEnabled: () => true } as any;
    const suggestionsRepo = {
      find: jest.fn().mockResolvedValue([
        { externalId: 'rival', name: 'Конкурент', followersCount: 4800, reason: 'Та же тема', fit: 9, rank: 1 },
        { externalId: 'other', name: 'Другой', followersCount: 3000, reason: 'Смежная тема', fit: 6, rank: 2 },
      ]),
    } as any;
    const accountsRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'acc-9', externalId: 'rival', platform: AccountPlatform.TELEGRAM }]),
    } as any;

    const result = await new CompetitorsService(runs, suggestionsRepo, accountsRepo).getFor('acc-1');

    expect(result.enabled).toBe(true);
    expect(result.run).toEqual(
      expect.objectContaining({ status: CompetitorRunStatus.SUCCESS, niche: 'SMM' }),
    );
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({ externalId: 'rival', alreadyTracked: true, trackedAccountId: 'acc-9' }),
    );
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({ externalId: 'other', alreadyTracked: false, trackedAccountId: null }),
    );
  });

  it('returns an empty payload when no run has happened yet', async () => {
    const runs = { findLatest: jest.fn().mockResolvedValue(null), isEnabled: () => false } as any;
    const suggestionsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const accountsRepo = { find: jest.fn().mockResolvedValue([]) } as any;

    const result = await new CompetitorsService(runs, suggestionsRepo, accountsRepo).getFor('acc-1');

    expect(result).toEqual({ enabled: false, run: null, suggestions: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/competitors/competitors.service.spec.ts`
Expected: FAIL — cannot find module `./competitors.service`.

- [ ] **Step 3: Write the service, controller and module**

`backend/src/competitors/competitors.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { CompetitorRunService } from './competitor-run.service';

@Injectable()
export class CompetitorsService {
  constructor(
    private runs: CompetitorRunService,
    @InjectRepository(CompetitorSuggestion) private suggestionsRepo: Repository<CompetitorSuggestion>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
  ) {}

  async getFor(accountId: string) {
    const run = await this.runs.findLatest(accountId);
    const suggestions = await this.suggestionsRepo.find({
      where: { accountId },
      order: { rank: 'ASC' },
    });

    // Computed, never stored: a suggestion added later must show as tracked
    // without rewriting rows.
    const handles = suggestions.map((s) => s.externalId);
    const tracked = handles.length
      ? await this.accountsRepo.find({
          where: { platform: AccountPlatform.TELEGRAM, externalId: In(handles) },
        })
      : [];
    const byHandle = new Map(tracked.map((account) => [account.externalId, account.id]));

    return {
      enabled: this.runs.isEnabled(),
      run: run
        ? {
            id: run.id,
            status: run.status,
            niche: run.niche,
            errorMessage: run.errorMessage,
            finishedAt: run.finishedAt,
          }
        : null,
      suggestions: suggestions.map((s) => ({
        externalId: s.externalId,
        name: s.name,
        followersCount: s.followersCount,
        reason: s.reason,
        fit: s.fit,
        rank: s.rank,
        alreadyTracked: byHandle.has(s.externalId),
        trackedAccountId: byHandle.get(s.externalId) ?? null,
      })),
    };
  }
}
```

`backend/src/competitors/competitors.controller.ts`:

```ts
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompetitorRunService } from './competitor-run.service';
import { CompetitorsService } from './competitors.service';

@UseGuards(JwtAuthGuard)
@Controller('accounts/:accountId/competitors')
export class CompetitorsController {
  constructor(
    private competitors: CompetitorsService,
    private runs: CompetitorRunService,
  ) {}

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.competitors.getFor(accountId);
  }

  @Post('refresh')
  refresh(@Param('accountId') accountId: string) {
    return this.runs.createManual(accountId);
  }
}
```

`backend/src/competitors/competitors.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';
import { CompetitorRun } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { ConnectorsModule } from '../connectors/connectors.module';
import { COMPETITOR_FINDER } from './competitor-finder';
import { GeminiFinder } from './gemini.finder';
import { COMPETITOR_CONFIG, CompetitorConfig, CompetitorRunService } from './competitor-run.service';
import { CompetitorProfileService } from './competitor-profile.service';
import { CompetitorVerifier } from './competitor-verifier.service';
import { CompetitorsProcessor } from './competitors.processor';
import { CompetitorsController } from './competitors.controller';
import { CompetitorsService } from './competitors.service';

const GEMINI_MODEL = 'gemini-2.5-flash';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'competitors' }),
    TypeOrmModule.forFeature([Account, Post, CompetitorRun, CompetitorSuggestion]),
    ConnectorsModule,
  ],
  controllers: [CompetitorsController],
  providers: [
    {
      provide: COMPETITOR_CONFIG,
      useFactory: (): CompetitorConfig => ({
        provider: 'gemini',
        model: GEMINI_MODEL,
        // With no key the feature switches itself off; everything else keeps working.
        enabled: Boolean(process.env.GEMINI_API_KEY),
      }),
    },
    {
      provide: COMPETITOR_FINDER,
      useFactory: () => new GeminiFinder(process.env.GEMINI_API_KEY ?? '', GEMINI_MODEL),
    },
    CompetitorRunService,
    CompetitorProfileService,
    CompetitorVerifier,
    CompetitorsProcessor,
    CompetitorsService,
  ],
  exports: [CompetitorRunService],
})
export class CompetitorsModule {}
```

Then add `CompetitorsModule` to the `imports` array in `backend/src/app.module.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/competitors && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitors backend/src/app.module.ts
git commit -m "Expose competitor suggestions and a refresh endpoint"
```

---

### Task 10: Start a run after the first sync

**Files:**
- Modify: `backend/src/sync/sync.processor.ts:24-40` (inject `CompetitorRunService`), `:106` and `:110-125`
- Modify: `backend/src/sync/sync.module.ts:14-23` (import `CompetitorsModule`)
- Test: `backend/src/sync/sync.processor.spec.ts`

**Interfaces:**
- Consumes: `CompetitorRunService.createForNewAccount(accountId)`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`backend/src/sync/sync.processor.spec.ts` already has a `buildProcessor(overrides)` helper that ends with
`const processor = new SyncProcessor(registry, accountsRepo, snapshotsRepo, postsRepo, syncJobsRepo);`.
Extend it — this is the only place `SyncProcessor` is constructed:

```ts
  function buildProcessor(
    overrides: Partial<{ getAccountStats: any; getPosts: any; syncJobsUpdate: any; competitorRuns: any }> = {},
  ) {
```

then, just above the `new SyncProcessor(...)` line, add:

```ts
    const competitorRuns = overrides.competitorRuns ?? { createForNewAccount: jest.fn().mockResolvedValue(null) };
```

pass it as the last constructor argument, and add `competitorRuns` to the returned object:

```ts
    const processor = new SyncProcessor(registry, accountsRepo, snapshotsRepo, postsRepo, syncJobsRepo, competitorRuns);
    return { processor, syncJobsRepo, snapshotsRepo, postsRepo, competitorRuns };
```

Then append these three tests to the same describe block:

```ts
  it('starts competitor discovery after a successful sync', async () => {
    const { processor, competitorRuns } = buildProcessor();

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(competitorRuns.createForNewAccount).toHaveBeenCalledWith('acc-1');
  });

  it('starts competitor discovery even when the sync fails for good', async () => {
    const { processor, competitorRuns } = buildProcessor({
      getPosts: jest.fn().mockRejectedValue(new Error('No posts found on the preview page')),
    });

    await expect(
      processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any),
    ).rejects.toThrow();

    expect(competitorRuns.createForNewAccount).toHaveBeenCalledWith('acc-1');
  });

  it('does not fail a sync when queueing competitor discovery throws', async () => {
    const { processor } = buildProcessor({
      competitorRuns: { createForNewAccount: jest.fn().mockRejectedValue(new Error('redis down')) },
    });

    await expect(
      processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any),
    ).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/sync/sync.processor.spec.ts`
Expected: FAIL — `createForNewAccount` never called.

- [ ] **Step 3: Write the implementation**

In `sync.processor.ts`, add the constructor dependency:

```ts
    private competitorRuns: CompetitorRunService,
```

Add a private helper, and call it in two places — after the `SUCCESS` update, and inside the `catch` block right after the `isFinalAttempt` handling, before `throw error`:

```ts
  /**
   * Discovery needs captions, which exist only after a sync. The guard inside
   * createForNewAccount is "this account has no run yet", so the nightly sync
   * never re-runs it. Queueing must never turn a finished sync into a failed one.
   */
  private async startCompetitorDiscovery(accountId: string): Promise<void> {
    try {
      await this.competitorRuns.createForNewAccount(accountId);
    } catch (error) {
      this.logger.warn(`Could not queue competitor discovery for ${accountId}: ${(error as Error).message}`);
    }
  }
```

In `sync.module.ts`, add `CompetitorsModule` to `imports` (it exports `CompetitorRunService`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/sync && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sync
git commit -m "Start competitor discovery after a channel's first sync"
```

---

### Task 11: The «Конкуренты» section

**Files:**
- Create: `frontend/src/components/CompetitorsSection.tsx`
- Create: `frontend/src/components/CompetitorsSection.module.css`
- Create: `frontend/src/components/CompetitorsSection.test.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx:117-124` (render it under `TrendChart`)

**Interfaces:**
- Consumes: `GET /accounts/:id/competitors`, `POST /accounts/:id/competitors/refresh`, `POST /accounts/from-link`.
- Produces: `<CompetitorsSection accountId={string} />`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/CompetitorsSection.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitorsSection } from './CompetitorsSection';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const payload = {
  enabled: true,
  run: { id: 'run-1', status: 'success', niche: 'SMM', errorMessage: null, finishedAt: '2026-09-17T10:00:00Z' },
  suggestions: [
    {
      externalId: 'rival',
      name: 'Конкурент',
      followersCount: 4800,
      reason: 'Та же тема',
      fit: 9,
      rank: 1,
      alreadyTracked: false,
      trackedAccountId: null,
    },
    {
      externalId: 'tracked',
      name: 'Уже добавленный',
      followersCount: 3000,
      reason: 'Смежная тема',
      fit: 7,
      rank: 2,
      alreadyTracked: true,
      trackedAccountId: 'acc-9',
    },
  ],
};

function renderSection() {
  return render(
    <MemoryRouter>
      <CompetitorsSection accountId="acc-1" />
    </MemoryRouter>,
  );
}

describe('CompetitorsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the niche, when it was updated, and each suggestion', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });

    renderSection();

    expect(await screen.findByText(/SMM/)).toBeInTheDocument();
    expect(screen.getByText(/обновлено/)).toBeInTheDocument();
    expect(screen.getByText('Конкурент')).toBeInTheDocument();
    expect(screen.getByText('Та же тема')).toBeInTheDocument();
  });

  it('offers to add a suggestion that is not tracked and marks the one that is', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });

    renderSection();

    expect(await screen.findByRole('button', { name: 'Добавить' })).toBeInTheDocument();
    expect(screen.getByText('Уже отслеживается')).toBeInTheDocument();
  });

  it('adds a channel by its t.me link and reloads the list', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });
    (apiClient.post as any).mockResolvedValue({ data: { id: 'acc-new' } });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить' }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/accounts/from-link', { link: 'https://t.me/rival' }),
    );
  });

  it('says nothing was found when a successful run produced no suggestions', async () => {
    (apiClient.get as any).mockResolvedValue({ data: { ...payload, suggestions: [] } });

    renderSection();

    expect(await screen.findByText('Не нашли похожих каналов')).toBeInTheDocument();
  });

  it('explains a failed run and keeps the old suggestions visible', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        ...payload,
        run: { ...payload.run, status: 'failed', errorMessage: 'Превышен лимит запросов, попробуйте позже' },
      },
    });

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Превышен лимит запросов');
    expect(screen.getByText('Конкурент')).toBeInTheDocument();
  });

  it('polls while a run is in progress and stops when it succeeds', async () => {
    vi.useFakeTimers();
    (apiClient.get as any)
      .mockResolvedValueOnce({ data: { ...payload, run: { ...payload.run, status: 'running' }, suggestions: [] } })
      .mockResolvedValue({ data: payload });

    renderSection();
    await vi.advanceTimersByTimeAsync(5500);
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByText('Конкурент')).toBeInTheDocument());
  });

  it('disables the button and explains when the feature is not configured', async () => {
    (apiClient.get as any).mockResolvedValue({ data: { enabled: false, run: null, suggestions: [] } });

    renderSection();

    expect(await screen.findByRole('button', { name: 'Обновить конкурентов' })).toBeDisabled();
    expect(screen.getByText('Подбор конкурентов не настроен')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/CompetitorsSection.test.tsx`
Expected: FAIL — cannot resolve `./CompetitorsSection`.

- [ ] **Step 3: Write the component**

`frontend/src/components/CompetitorsSection.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatCount } from '../format';
import { formatIsoDate } from '../periods';
import styles from './CompetitorsSection.module.css';

interface Suggestion {
  externalId: string;
  name: string;
  followersCount: number;
  reason: string;
  fit: number;
  rank: number;
  alreadyTracked: boolean;
  trackedAccountId: string | null;
}

interface CompetitorsPayload {
  enabled: boolean;
  run: {
    id: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    niche: string | null;
    errorMessage: string | null;
    finishedAt: string | null;
  } | null;
  suggestions: Suggestion[];
}

const POLL_MS = 5000;

export function CompetitorsSection({ accountId }: { accountId: string }) {
  const [data, setData] = useState<CompetitorsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await apiClient.get(`/accounts/${accountId}/competitors`);
    setData(res.data as CompetitorsPayload);
    return res.data as CompetitorsPayload;
  }, [accountId]);

  useEffect(() => {
    load().catch(() => setError('Не удалось загрузить конкурентов'));
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [load]);

  // A run started in this tab or by the first sync finishes in the background,
  // so the section follows it until it settles.
  const running = data?.run?.status === 'pending' || data?.run?.status === 'running';
  useEffect(() => {
    if (!running) {
      if (poll.current) clearInterval(poll.current);
      poll.current = null;
      return;
    }
    if (poll.current) return;
    poll.current = setInterval(() => {
      load().catch(() => undefined);
    }, POLL_MS);
  }, [running, load]);

  async function refresh() {
    setError(null);
    try {
      await apiClient.post(`/accounts/${accountId}/competitors/refresh`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось запустить подбор');
    }
  }

  async function add(handle: string) {
    setAdding(handle);
    setError(null);
    try {
      await apiClient.post('/accounts/from-link', { link: `https://t.me/${handle}` });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить канал');
    } finally {
      setAdding(null);
    }
  }

  const suggestions = data?.suggestions ?? [];
  const failed = data?.run?.status === 'failed';

  return (
    <section className={styles.section} aria-labelledby="competitors-heading">
      <div className={styles.header}>
        <h3 id="competitors-heading" className={styles.heading}>
          Конкуренты
        </h3>
        {data?.run?.niche && (
          <span className={styles.niche}>
            Ниша: {data.run.niche}
            {data.run.finishedAt && ` · обновлено ${formatIsoDate(data.run.finishedAt.slice(0, 10))}`}
          </span>
        )}
        <button
          type="button"
          className={styles.refresh}
          onClick={refresh}
          disabled={!data?.enabled || running}
        >
          Обновить конкурентов
        </button>
      </div>

      {data && !data.enabled && <p className={styles.note}>Подбор конкурентов не настроен</p>}
      {running && <p className={styles.note}>Подбираем конкурентов… обычно 1–2 минуты</p>}
      {(error || (failed && data?.run?.errorMessage)) && (
        <p className={styles.error} role="alert">
          {error ?? data?.run?.errorMessage}
        </p>
      )}

      {suggestions.length > 0 ? (
        <ul className={styles.list}>
          {suggestions.map((s) => (
            <li key={s.externalId} className={styles.item}>
              <div className={styles.info}>
                <span className={styles.name}>{s.name}</span>
                <a
                  className={styles.handle}
                  href={`https://t.me/${s.externalId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{s.externalId}
                </a>
                <span className={styles.followers}>{formatCount(s.followersCount)} подписчиков</span>
                <span className={styles.reason}>{s.reason}</span>
              </div>
              {s.alreadyTracked ? (
                <Link className={styles.tracked} to={`/accounts/${s.trackedAccountId}`}>
                  Уже отслеживается
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.add}
                  onClick={() => add(s.externalId)}
                  disabled={adding === s.externalId}
                >
                  Добавить
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        data?.run?.status === 'success' && <p className={styles.note}>Не нашли похожих каналов</p>
      )}
    </section>
  );
}
```

`frontend/src/components/CompetitorsSection.module.css` — same tokens and spacing scale as `PostList.module.css`; no literal colours:

```css
/*
 * Competitor suggestions. Rows rather than the post grid: each row is a
 * decision (add or not), so it reads as a list, using PostList's card border,
 * radius and spacing idioms.
 */
.section {
  margin-top: 24px;
}

.header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.heading {
  margin: 0;
  font-size: 16px;
}

.niche {
  color: var(--muted);
  font-size: 13px;
}

.refresh {
  margin-left: auto;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.refresh:hover:not(:disabled),
.refresh:focus-visible:not(:disabled) {
  border-color: var(--accent-border);
  outline: none;
}

.refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

.note,
.error {
  margin: 8px 0;
  font-size: 13px;
}

.note {
  color: var(--muted);
}

.error {
  color: var(--danger, var(--muted));
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}

.info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  min-width: 0;
}

.name {
  font-weight: 600;
}

.handle {
  color: var(--muted);
  font-size: 13px;
}

.followers {
  font-family: var(--mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.reason {
  flex-basis: 100%;
  color: var(--muted);
  font-size: 13px;
}

.add,
.tracked {
  margin-left: auto;
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 8px;
  font: inherit;
  text-decoration: none;
  white-space: nowrap;
}

.add {
  border: 1px solid var(--accent-border);
  background: var(--accent);
  color: var(--on-accent);
  cursor: pointer;
}

.add:disabled {
  opacity: 0.5;
  cursor: default;
}

.tracked {
  border: 1px solid var(--border);
  color: var(--muted);
}
```

If any custom property above is not defined in this project's theme, substitute the nearest one that is — check `frontend/src/index.css` — rather than inventing a colour.

Render the section in `AccountDetailPage.tsx` directly after `<TrendChart … />`:

```tsx
      <CompetitorsSection accountId={account.id} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/CompetitorsSection.test.tsx && npx tsc --noEmit`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components frontend/src/pages/AccountDetailPage.tsx
git commit -m "Show competitor suggestions on the channel page"
```

---

### Task 12: Full suite, docs, and manual verification

**Files:**
- Modify: `docs/operations.md` (a «Подбор конкурентов» subsection)
- Modify: `.env.example` (root, if it lists backend variables)

- [ ] **Step 1: Run the whole suite**

Run: `cd backend && npx jest && cd ../frontend && npx vitest run`
Expected: PASS everywhere. Fix anything the new `AccountInfo.description` field broke in older tests.

- [ ] **Step 2: Document operations**

Add to `docs/operations.md`:

```markdown
## Подбор конкурентов

- Requires `GEMINI_API_KEY` in `/opt/smm-dashboard/app/.env`. Without it the
  feature is disabled and the rest of the app is unaffected.
- Model: `gemini-2.5-flash` with Google Search grounding, free up to 500
  grounded requests per day. One run per added channel uses one request.
- A run happens automatically after a channel's first sync, and whenever
  «Обновить конкурентов» is pressed.
- Inspect runs:
  `docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT \"createdAt\", status, niche, \"candidatesProposed\", \"candidatesVerified\", \"errorMessage\" FROM competitor_runs ORDER BY \"createdAt\" DESC LIMIT 10;"'`
- A widening gap between `candidatesProposed` and `candidatesVerified` means the
  model is inventing channels — the signal for switching `COMPETITOR_LLM`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/operations.md .env.example
git commit -m "Document competitor discovery operations"
```

- [ ] **Step 4: Manual verification on the VPS (after deploy)**

1. Deploy and run the migration per `docs/operations.md`.
2. Open a channel, press «Обновить конкурентов», and watch the section reach a result.
3. Check the newest `competitor_runs` row: `status = success`, a Russian `niche`, and `candidatesVerified` within a few of `candidatesProposed`.
4. Confirm a suggestion's «Добавить» adds the channel and the row flips to «Уже отслеживается».

---

## Notes for the executor

- **Do not add a `ClaudeFinder`.** The seam exists for it; the user explicitly chose Gemini only for now.
- **Do not remove `costUsd`** because Gemini is free — it exists so a later provider switch needs no migration.
- If a task's test reveals the plan is wrong, stop and report rather than inventing a different design.
