# Telegram Post Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an account's real performance — total and average views and reactions, plus a sortable post list with images, snippets and ER, each post opening in full with its publication date and time.

**Architecture:** Post data comes from Telegram's public channel preview page (`t.me/s/<channel>`), fetched by a thin HTTP client and turned into records by a pure parser. Those records flow into `TelegramConnector.getPosts()`, which already feeds the existing sync processor — so storage, upserts and ER computation are wiring, not new machinery. The account page gains a period selector, aggregate tiles and a sortable grid whose rows are already in the detail response.

**Tech Stack:** NestJS 11, TypeORM, Postgres, BullMQ, cheerio (new), Jest (backend), React 19, Vite, Vitest + Testing Library (frontend).

**Spec:** [docs/superpowers/specs/2026-09-09-telegram-post-analytics-design.md](../specs/2026-09-09-telegram-post-analytics-design.md)

## Global Constraints

- **User-facing copy is Russian.** Просмотры, Реакции, Подписчики, Средние просмотры, Средние реакции. Never add English UI strings.
- **The UI tasks (9–11) are built with the taste skill.** Invoke it before writing component markup or CSS.
- **`er` always means ER-by-followers; `erViews` always means ERR-by-views.** The summary object spells the first `erFollowers`.
- **The scrape window is fixed at 90 days**, independent of the period selector. The selector filters what is displayed; it never narrows what is fetched.
- **Reactions are stored in the `likes` column.** The `Post` entity is cross-platform and reactions are Telegram's likes. `comments` and `shares` stay 0.
- **The parser must fail loudly, never silently write zeros.** A channel with no parseable posts throws.
- **TDD throughout.** Write the test, watch it fail for the right reason, then implement.
- **Dependencies are not installed on master's `frontend/`.** Run `npm ci` in `frontend/` before Task 9. `backend/` is already installed.

---

### Task 1: Compact number parsing

Telegram renders counts as `5.7M`, `322K`, `999`. Everything downstream needs integers, and this is the piece most likely to be got subtly wrong, so it lands first and alone.

**Files:**
- Create: `backend/src/connectors/telegram/compact-number.ts`
- Test: `backend/src/connectors/telegram/compact-number.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCompactNumber(text: string | null | undefined): number | null`

- [ ] **Step 1: Write the failing test**

```typescript
import { parseCompactNumber } from './compact-number';

describe('parseCompactNumber', () => {
  it('parses a plain integer', () => {
    expect(parseCompactNumber('999')).toBe(999);
  });

  it('parses thousands and millions', () => {
    expect(parseCompactNumber('322K')).toBe(322000);
    expect(parseCompactNumber('12.3K')).toBe(12300);
    expect(parseCompactNumber('5.7M')).toBe(5700000);
    expect(parseCompactNumber('9.51M')).toBe(9510000);
  });

  it('ignores surrounding whitespace and thousands separators', () => {
    expect(parseCompactNumber('  1 234 ')).toBe(1234);
    expect(parseCompactNumber('1,234')).toBe(1234);
  });

  it('returns null for anything it cannot read', () => {
    expect(parseCompactNumber(null)).toBeNull();
    expect(parseCompactNumber(undefined)).toBeNull();
    expect(parseCompactNumber('')).toBeNull();
    expect(parseCompactNumber('views')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/connectors/telegram/compact-number.spec.ts`
Expected: FAIL — `Cannot find module './compact-number'`

- [ ] **Step 3: Write minimal implementation**

```typescript
const SUFFIXES: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };

/**
 * Telegram renders counts compactly: "5.7M", "322K", "999". Values under 1000 are
 * exact; above that the number shown is rounded, so precision is genuinely lost at
 * the source and cannot be recovered here.
 */
export function parseCompactNumber(text: string | null | undefined): number | null {
  if (!text) return null;

  const cleaned = text.replace(/[\s, ]/g, '');
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/i.exec(cleaned);
  if (!match) return null;

  const value = Number(match[1]);
  const multiplier = match[2] ? SUFFIXES[match[2].toUpperCase()] : 1;
  return Math.round(value * multiplier);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/connectors/telegram/compact-number.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/telegram/compact-number.ts backend/src/connectors/telegram/compact-number.spec.ts
git commit -m "Read Telegram's compact counts as numbers"
```

---

### Task 2: The preview page fixture

The parser is tested against a saved page rather than the network, so the tests are deterministic and run offline. This fixture mirrors the real markup, verified against a live fetch of `t.me/s/durov` on 2026-09-09.

**Files:**
- Create: `backend/src/connectors/telegram/__fixtures__/preview-page.html`
- Create: `backend/src/connectors/telegram/__fixtures__/preview-unavailable.html`

**Interfaces:**
- Consumes: nothing.
- Produces: two fixture files read by Task 3's tests.

- [ ] **Step 1: Create the three-post fixture**

Covers the three cases that matter: text-only, photo with reactions, and video with no reactions.

```html
<main>
<section class="tgme_channel_history js-message_history">
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message js-widget_message" data-post="testchannel/101">
      <div class="tgme_widget_message_bubble">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Текстовый пост без картинки</div>
        <div class="tgme_widget_message_footer compact js-message_footer">
          <div class="tgme_widget_message_info short js-message_info">
            <span class="tgme_widget_message_views">999</span><span class="copyonly"> views</span>
            <span class="tgme_widget_message_meta">
              <a class="tgme_widget_message_date" href="https://t.me/testchannel/101">
                <time datetime="2026-09-01T08:15:00+00:00" class="time">08:15</time>
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message js-widget_message" data-post="testchannel/102">
      <div class="tgme_widget_message_bubble">
        <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.telesco.pe/file/photo102')" href="https://t.me/testchannel/102"></a>
        <div class="tgme_widget_message_text js-message_text" dir="auto">Пост с картинкой</div>
        <div class="tgme_widget_message_reactions js-message_reactions">
          <span class="tgme_reaction"><tg-emoji emoji-id="1"></tg-emoji>1.2K</span>
          <span class="tgme_reaction"><tg-emoji emoji-id="2"></tg-emoji>48</span>
        </div>
        <div class="tgme_widget_message_footer compact js-message_footer">
          <div class="tgme_widget_message_info short js-message_info">
            <span class="tgme_widget_message_views">12.3K</span><span class="copyonly"> views</span>
            <span class="tgme_widget_message_meta">
              <a class="tgme_widget_message_date" href="https://t.me/testchannel/102">
                <time datetime="2026-09-02T12:30:45+00:00" class="time">12:30</time>
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message js-widget_message" data-post="testchannel/103">
      <div class="tgme_widget_message_bubble">
        <a class="tgme_widget_message_video_player" href="https://t.me/testchannel/103">
          <i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.telesco.pe/file/video103')"></i>
        </a>
        <div class="tgme_widget_message_footer compact js-message_footer">
          <div class="tgme_widget_message_info short js-message_info">
            <span class="tgme_widget_message_views">5.7M</span><span class="copyonly"> views</span>
            <span class="tgme_widget_message_meta">
              <a class="tgme_widget_message_date" href="https://t.me/testchannel/103">
                <time datetime="2026-09-03T18:00:00+00:00" class="time">18:00</time>
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
</main>
```

- [ ] **Step 2: Create the unavailable-channel fixture**

What Telegram serves for a channel with its web preview disabled — a 200 response with no message blocks at all.

```html
<main>
<div class="tgme_page">
  <div class="tgme_page_title"><span>Test Channel</span></div>
  <div class="tgme_page_description">If you have Telegram, you can view and join Test Channel right away.</div>
</div>
</main>
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/connectors/telegram/__fixtures__/
git commit -m "Add saved preview pages to test the parser against"
```

---

### Task 3: The preview parser

A pure function — HTML in, posts out. No network, no clock, no I/O, which is exactly what makes it testable.

**Files:**
- Create: `backend/src/connectors/telegram/telegram-preview.parser.ts`
- Test: `backend/src/connectors/telegram/telegram-preview.parser.spec.ts`
- Modify: `backend/package.json` (add cheerio)

**Interfaces:**
- Consumes: `parseCompactNumber` from Task 1; the fixtures from Task 2.
- Produces:
  - `interface ParsedPreviewPost { externalPostId: string; publishedAt: Date; caption: string | null; thumbnailUrl: string | null; views: number | null; reactions: number; type: PostType; permalink: string }`
  - `parsePreviewPage(html: string, channel: string): ParsedPreviewPost[]`
  - `class PreviewUnavailableError extends Error`

- [ ] **Step 1: Install cheerio**

```bash
cd backend && npm install cheerio@^1.0.0
```

- [ ] **Step 2: Write the failing test**

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import { PostType } from '../../db/entities/post.entity';
import { parsePreviewPage, PreviewUnavailableError } from './telegram-preview.parser';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');

describe('parsePreviewPage', () => {
  const posts = () => parsePreviewPage(fixture('preview-page.html'), 'testchannel');

  it('reads every post on the page, newest last as rendered', () => {
    expect(posts().map((p) => p.externalPostId)).toEqual(['101', '102', '103']);
  });

  it('reads the exact publication time, not just the date', () => {
    expect(posts()[1].publishedAt.toISOString()).toBe('2026-09-02T12:30:45.000Z');
  });

  it('reads text, views and the summed reaction counts', () => {
    const post = posts()[1];
    expect(post.caption).toBe('Пост с картинкой');
    expect(post.views).toBe(12300);
    expect(post.reactions).toBe(1248);
  });

  it('reports no reactions as zero rather than as missing', () => {
    expect(posts()[2].reactions).toBe(0);
  });

  it('types a post by its media: photos are IMAGE, video is VIDEO, neither is POST', () => {
    expect(posts().map((p) => p.type)).toEqual([PostType.POST, PostType.IMAGE, PostType.VIDEO]);
  });

  it('takes the image from a photo post and the thumbnail from a video', () => {
    expect(posts()[1].thumbnailUrl).toBe('https://cdn4.telesco.pe/file/photo102');
    expect(posts()[2].thumbnailUrl).toBe('https://cdn4.telesco.pe/file/video103');
    expect(posts()[0].thumbnailUrl).toBeNull();
  });

  it('builds a permalink back to the post', () => {
    expect(posts()[0].permalink).toBe('https://t.me/testchannel/101');
  });

  // A page with no posts means the markup changed or the channel hid its preview.
  // Returning [] would be indistinguishable from a channel that simply went quiet.
  it('throws rather than returning nothing when the page holds no posts', () => {
    expect(() => parsePreviewPage(fixture('preview-unavailable.html'), 'testchannel')).toThrow(
      PreviewUnavailableError,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest src/connectors/telegram/telegram-preview.parser.spec.ts`
Expected: FAIL — `Cannot find module './telegram-preview.parser'`

- [ ] **Step 4: Write the implementation**

Note `PostType.IMAGE` does not exist yet — Task 4 adds it. Until then this file will not compile, which is expected and is why Task 4 follows immediately. If you prefer a green tree at every commit, do Task 4 first; the order here follows the data flow.

```typescript
import * as cheerio from 'cheerio';
import { PostType } from '../../db/entities/post.entity';
import { parseCompactNumber } from './compact-number';

export interface ParsedPreviewPost {
  externalPostId: string;
  publishedAt: Date;
  caption: string | null;
  thumbnailUrl: string | null;
  views: number | null;
  reactions: number;
  type: PostType;
  permalink: string;
}

/** The page loaded but held no posts: markup changed, or the channel hid its preview. */
export class PreviewUnavailableError extends Error {}

const BACKGROUND_URL = /background-image:url\('([^']+)'\)/;

function backgroundUrl(style: string | undefined): string | null {
  const match = style ? BACKGROUND_URL.exec(style) : null;
  return match ? match[1] : null;
}

export function parsePreviewPage(html: string, channel: string): ParsedPreviewPost[] {
  const $ = cheerio.load(html);
  const posts: ParsedPreviewPost[] = [];

  $('.tgme_widget_message[data-post]').each((_, element) => {
    const message = $(element);
    const dataPost = message.attr('data-post') ?? '';
    const externalPostId = dataPost.split('/').pop() ?? '';
    const datetime = message.find('time[datetime]').attr('datetime');
    if (!externalPostId || !datetime) return;

    const photo = backgroundUrl(message.find('.tgme_widget_message_photo_wrap').attr('style'));
    const video = backgroundUrl(message.find('.tgme_widget_message_video_thumb').attr('style'));

    let type = PostType.POST;
    if (video) type = PostType.VIDEO;
    else if (photo) type = PostType.IMAGE;

    let reactions = 0;
    message.find('.tgme_reaction').each((_i, reaction) => {
      reactions += parseCompactNumber($(reaction).text()) ?? 0;
    });

    const caption = message.find('.tgme_widget_message_text').first().text().trim();

    posts.push({
      externalPostId,
      publishedAt: new Date(datetime),
      caption: caption.length > 0 ? caption : null,
      thumbnailUrl: video ?? photo,
      views: parseCompactNumber(message.find('.tgme_widget_message_views').first().text()),
      reactions,
      type,
      permalink: `https://t.me/${channel}/${externalPostId}`,
    });
  });

  if (posts.length === 0) {
    throw new PreviewUnavailableError(
      `No posts found on the preview page for ${channel} — the channel may have disabled its web preview, or Telegram changed the page markup.`,
    );
  }

  return posts;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest src/connectors/telegram/telegram-preview.parser.spec.ts`
Expected: PASS, 8 tests. If `PostType.IMAGE` errors, complete Task 4 and re-run.

- [ ] **Step 6: Commit**

```bash
git add backend/src/connectors/telegram/telegram-preview.parser.ts backend/src/connectors/telegram/telegram-preview.parser.spec.ts backend/package.json backend/package-lock.json
git commit -m "Parse posts, views and reactions out of a channel preview page"
```

---

### Task 4: Schema — the IMAGE type and the second ER

Two migrations. The `posts` table is empty in production — nothing has ever written to it — so there is no backfill and nothing at risk.

**Files:**
- Modify: `backend/src/db/entities/post.entity.ts`
- Create: `backend/src/db/migrations/1789000000000-AddImagePostTypeAndErViews.ts`
- Test: `backend/src/db/entities/post.entity.spec.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `PostType.IMAGE = 'image'`; `Post.erViews: number | null`.

- [ ] **Step 1: Write the failing test**

```typescript
import { PostType } from './post.entity';

describe('PostType', () => {
  it('has an IMAGE type covering photo posts, whether one photo or several', () => {
    expect(PostType.IMAGE).toBe('image');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/db/entities/post.entity.spec.ts`
Expected: FAIL — received `undefined`

- [ ] **Step 3: Add the enum value and the column**

In `post.entity.ts`, add to the enum and add the column beside `er`:

```typescript
export enum PostType {
  POST = 'post',
  IMAGE = 'image',
  REEL = 'reel',
  CAROUSEL = 'carousel',
  VIDEO = 'video',
  SHORT = 'short',
  STORY = 'story',
}
```

```typescript
  /** ER against followers: (likes + comments + shares) / followers. */
  @Column('float', { nullable: true }) er: number | null;
  /** ERR against reach: reactions / views. Null when views are unknown. */
  @Column('float', { nullable: true }) erViews: number | null;
```

- [ ] **Step 4: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the post type used for photo posts, and the second ER figure.
 *
 * Telegram posts are typed by their media: a photo post is IMAGE whether it
 * carries one photo or an album. `er` keeps its meaning (engagement against
 * followers); `erViews` is engagement against actual reach, which is the more
 * meaningful figure on Telegram, where a post reaches a fraction of subscribers.
 *
 * ADD VALUE cannot run inside a transaction block in older Postgres, so it is
 * issued before the column change and never bundled with data migration.
 */
export class AddImagePostTypeAndErViews1789000000000 implements MigrationInterface {
  name = 'AddImagePostTypeAndErViews1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "posts_type_enum" ADD VALUE IF NOT EXISTS 'image'`);
    await queryRunner.query(`ALTER TABLE "posts" ADD COLUMN "erViews" double precision`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "erViews"`);
    // Postgres cannot drop a value from an enum type; 'image' is left in place.
  }
}
```

- [ ] **Step 5: Verify the enum name matches the database**

The migration hardcodes `posts_type_enum`. Confirm that is what TypeORM generated:

```bash
cd backend && grep -n "type_enum" src/db/migrations/1755000000000-InitialSchema.ts
```

If the initial schema names it differently, use that name in the migration.

- [ ] **Step 6: Run tests**

Run: `cd backend && npx jest src/db/entities/post.entity.spec.ts && npx jest`
Expected: PASS — the entity test, and the whole suite still green

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/entities/post.entity.ts backend/src/db/entities/post.entity.spec.ts backend/src/db/migrations/1789000000000-AddImagePostTypeAndErViews.ts
git commit -m "Add the IMAGE post type and engagement against reach"
```

---

### Task 5: The preview HTTP client

Fetching only. Throttled and capped so a first sync of a high-volume channel cannot become a request storm.

**Files:**
- Create: `backend/src/connectors/telegram/telegram-preview.client.ts`
- Test: `backend/src/connectors/telegram/telegram-preview.client.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class TelegramPreviewClient { fetchPage(channel: string, before?: string): Promise<string> }`

- [ ] **Step 1: Write the failing test**

```typescript
import axios from 'axios';
import { TelegramPreviewClient } from './telegram-preview.client';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

describe('TelegramPreviewClient', () => {
  beforeEach(() => mockedGet.mockReset());

  it('fetches the channel preview page', async () => {
    mockedGet.mockResolvedValue({ data: '<html>page</html>' });

    const html = await new TelegramPreviewClient().fetchPage('testchannel');

    expect(html).toBe('<html>page</html>');
    expect(mockedGet).toHaveBeenCalledWith('https://t.me/s/testchannel', expect.anything());
  });

  it('strips a leading @ from the handle', async () => {
    mockedGet.mockResolvedValue({ data: '' });
    await new TelegramPreviewClient().fetchPage('@testchannel');
    expect(mockedGet).toHaveBeenCalledWith('https://t.me/s/testchannel', expect.anything());
  });

  it('asks for older posts with the before parameter', async () => {
    mockedGet.mockResolvedValue({ data: '' });
    await new TelegramPreviewClient().fetchPage('testchannel', '101');
    expect(mockedGet).toHaveBeenCalledWith(
      'https://t.me/s/testchannel?before=101',
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/connectors/telegram/telegram-preview.client.spec.ts`
Expected: FAIL — `Cannot find module './telegram-preview.client'`

- [ ] **Step 3: Write the implementation**

```typescript
import axios from 'axios';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Reads Telegram's public channel preview. This is the only source that exposes
 * view counts and reactions — the Bot API exposes neither — and it needs no
 * credentials, which is what makes competitor channels readable at all.
 */
export class TelegramPreviewClient {
  async fetchPage(channel: string, before?: string): Promise<string> {
    const handle = channel.replace(/^@/, '');
    const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ''}`;

    const { data } = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; smm-dashboard/1.0)' },
    });
    return data as string;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/connectors/telegram/telegram-preview.client.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/telegram/telegram-preview.client.ts backend/src/connectors/telegram/telegram-preview.client.spec.ts
git commit -m "Fetch the public channel preview page"
```

---

### Task 6: getPosts walks the pages

Where the parser and the client meet the connector interface the sync processor already calls.

**Files:**
- Modify: `backend/src/connectors/telegram/telegram.connector.ts`
- Modify: `backend/src/connectors/connectors.module.ts:17`
- Test: `backend/src/connectors/telegram/telegram.connector.spec.ts`

**Interfaces:**
- Consumes: `TelegramPreviewClient.fetchPage` (Task 5), `parsePreviewPage` (Task 3).
- Produces: `new TelegramConnector(apiClient, previewClient)` — a second constructor argument, and a `getPosts` that returns real posts.

- [ ] **Step 1: Write the failing test**

Append to the existing spec file:

```typescript
import { TelegramConnector } from './telegram.connector';
import { PostType } from '../../db/entities/post.entity';

// Real preview pages render oldest post first; these fixtures follow that order.
function page(ids: number[], date: string): string {
  const blocks = ids
    .map(
      (id) => `
    <div class="tgme_widget_message" data-post="testchannel/${id}">
      <div class="tgme_widget_message_text">post ${id}</div>
      <span class="tgme_widget_message_views">100</span>
      <time datetime="${date}"></time>
    </div>`,
    )
    .join('');
  return `<section>${blocks}</section>`;
}

describe('TelegramConnector.getPosts', () => {
  const account = { externalId: '@testchannel' } as any;

  it('returns the posts on the first page', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([101, 102, 103], '2026-09-03T10:00:00+00:00')) };
    const connector = new TelegramConnector({} as any, preview as any);

    const posts = await connector.getPosts(account, new Date('2026-09-01'));

    expect(posts.map((p) => p.externalPostId)).toEqual(['101', '102', '103']);
    expect(posts[0].type).toBe(PostType.POST);
    expect(posts[0].views).toBe(100);
    expect(posts[0].likes).toBe(0);
  });

  it('walks back through older pages using the oldest post seen', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValueOnce(page([102, 103], '2026-09-03T10:00:00+00:00'))
        .mockResolvedValueOnce(page([100, 101], '2026-08-01T10:00:00+00:00')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    const posts = await connector.getPosts(account, new Date('2026-08-15'));

    expect(preview.fetchPage).toHaveBeenNthCalledWith(1, '@testchannel', undefined);
    expect(preview.fetchPage).toHaveBeenNthCalledWith(2, '@testchannel', '102');
    expect(posts).toHaveLength(4);
  });

  it('stops once a page is older than the window, instead of walking the whole channel', async () => {
    const preview = {
      fetchPage: jest.fn().mockResolvedValue(page([49, 50], '2020-01-01T10:00:00+00:00')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await connector.getPosts(account, new Date('2026-08-15'));

    expect(preview.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly at the page cap so one channel cannot loop forever', async () => {
    let id = 10_000;
    const preview = {
      fetchPage: jest.fn().mockImplementation(() => {
        id -= 2;
        return Promise.resolve(page([id, id + 1], '2026-09-03T10:00:00+00:00'));
      }),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await connector.getPosts(account, new Date('2026-01-01'));

    expect(preview.fetchPage).toHaveBeenCalledTimes(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/connectors/telegram/telegram.connector.spec.ts`
Expected: FAIL — `getPosts` returns `[]`, so the first assertion sees an empty array

- [ ] **Step 3: Write the implementation**

Replace the `getPosts` stub and widen the constructor:

```typescript
import { TelegramPreviewClient } from './telegram-preview.client';
import { parsePreviewPage } from './telegram-preview.parser';

const MAX_PAGES = 25;
const PAGE_DELAY_MS = 300;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramConnector implements SocialConnector {
  platform = AccountPlatform.TELEGRAM;

  constructor(
    private client: TelegramApiClient,
    private preview: TelegramPreviewClient,
  ) {}

  // ... existing methods unchanged ...

  /**
   * The Bot API cannot read post history or view counts at all, so posts come from
   * the public preview page instead. Pages are walked newest-first, each request
   * asking for messages older than the oldest one seen so far.
   */
  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    const channel = account.externalId;
    const collected: ConnectorPost[] = [];
    let before: string | undefined;

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      if (pageNumber > 0) await delay(PAGE_DELAY_MS);

      const html = await this.preview.fetchPage(channel, before);
      const parsed = parsePreviewPage(html, channel.replace(/^@/, ''));

      for (const post of parsed) {
        collected.push({
          externalPostId: post.externalPostId,
          type: post.type,
          publishedAt: post.publishedAt,
          permalink: post.permalink,
          thumbnailUrl: post.thumbnailUrl,
          caption: post.caption,
          likes: post.reactions,
          comments: 0,
          shares: 0,
          views: post.views,
          reach: null,
        });
      }

      const oldest = parsed.reduce((a, b) => (a.publishedAt <= b.publishedAt ? a : b));
      if (oldest.publishedAt < sinceDate) break;

      // The preview renders oldest-first, so the next page is requested with the
      // OLDEST id on this one. Using the last element would ask for posts older
      // than the newest one here, returning the same page forever.
      const nextBefore = oldest.externalPostId;
      if (nextBefore === before) break;
      before = nextBefore;
    }

    return collected;
  }
}
```

- [ ] **Step 4: Wire the client into the module**

In `connectors.module.ts`, import `TelegramPreviewClient` and pass it:

```typescript
      useFactory: () => [
        new TelegramConnector(
          new TelegramApiClient(process.env.TELEGRAM_BOT_TOKEN as string),
          new TelegramPreviewClient(),
        ),
      ],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest`
Expected: PASS — the whole suite, including the four new connector tests

- [ ] **Step 6: Commit**

```bash
git add backend/src/connectors/telegram/telegram.connector.ts backend/src/connectors/telegram/telegram.connector.spec.ts backend/src/connectors/connectors.module.ts
git commit -m "Read a channel's post history from its preview pages"
```

---

### Task 7: ER against reach, and a 90-day sync window

**Files:**
- Modify: `backend/src/sync/er-calculator.ts`
- Modify: `backend/src/sync/sync.processor.ts:50-66`
- Test: `backend/src/sync/er-calculator.spec.ts`

**Interfaces:**
- Consumes: `calculateEr` (unchanged).
- Produces: `calculateErByViews(reactions: number, views: number | null): number | null`; posts written with both `er` and `erViews`.

- [ ] **Step 1: Write the failing test**

```typescript
import { calculateErByViews } from './er-calculator';

describe('calculateErByViews', () => {
  it('is reactions as a percentage of the people who saw the post', () => {
    expect(calculateErByViews(50, 1000)).toBe(5);
  });

  it('is null when views are unknown, rather than zero', () => {
    expect(calculateErByViews(50, null)).toBeNull();
  });

  it('is null rather than infinite when a post has no views', () => {
    expect(calculateErByViews(50, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/sync/er-calculator.spec.ts`
Expected: FAIL — `calculateErByViews is not a function`

- [ ] **Step 3: Write the implementation**

Append to `er-calculator.ts`:

```typescript
/**
 * Engagement against actual reach. On Telegram this is the more meaningful figure:
 * a post reaches a fraction of subscribers, so measuring against followers punishes
 * a large channel for Telegram's delivery rather than for its content.
 */
export function calculateErByViews(reactions: number, views: number | null): number | null {
  if (views === null || views <= 0) return null;
  return (reactions / views) * 100;
}
```

- [ ] **Step 4: Widen the sync window and store both figures**

In `sync.processor.ts`, change the window from 30 to 90 days and write `erViews`:

```typescript
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const posts = await connector.getPosts(account, since);
```

```typescript
      for (const post of posts) {
        const er = calculateEr(post.likes, post.comments, post.shares, stats.followersCount);
        const erViews = calculateErByViews(post.likes, post.views);
        if (er !== null) {
          erSum += er;
          erCount += 1;
        }
        await this.postsRepo.upsert(
          { accountId, ...post, er, erViews, lastSyncedAt: new Date() },
          ['accountId', 'externalPostId'],
        );
      }
```

Add `calculateErByViews` to the existing import from `./er-calculator`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest`
Expected: PASS — whole suite green

- [ ] **Step 6: Commit**

```bash
git add backend/src/sync/er-calculator.ts backend/src/sync/er-calculator.spec.ts backend/src/sync/sync.processor.ts
git commit -m "Measure engagement against reach, over a 90-day window"
```

---

### Task 8: The summary aggregate

**Files:**
- Modify: `backend/src/stats/stats.service.ts:31-49`
- Test: `backend/src/stats/stats.service.spec.ts`

**Interfaces:**
- Consumes: post rows already loaded by `getAccountDetail`.
- Produces: `getAccountDetail` returns an added `summary: { followersCount, postsCount, totalViews, totalReactions, avgViews, avgReactions, erViews, erFollowers }`.

Note: the summary is computed from the rows `getAccountDetail` already loads and already returns, so it costs no additional query and no additional rows. This is not the `getTopPosts` defect, which loads every row solely to sort and discard most of them.

- [ ] **Step 1: Write the failing test**

```typescript
describe('StatsService.getAccountDetail summary', () => {
  function serviceWith(posts: any[], followersCount = 1000) {
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1' }) } as any;
    const snapshotsRepo = {
      find: jest.fn().mockResolvedValue([{ date: '2026-09-01', followersCount }]),
    } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue(posts) } as any;
    return new StatsService(accountsRepo, snapshotsRepo, postsRepo);
  }

  const period = { from: '2026-09-01', to: '2026-09-30' };

  it('totals and averages views and reactions over the period', async () => {
    const service = serviceWith([
      { views: 1000, likes: 50 },
      { views: 3000, likes: 150 },
    ]);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.postsCount).toBe(2);
    expect(summary.totalViews).toBe(4000);
    expect(summary.totalReactions).toBe(200);
    expect(summary.avgViews).toBe(2000);
    expect(summary.avgReactions).toBe(100);
  });

  it('takes followers from the latest snapshot', async () => {
    const service = serviceWith([{ views: 10, likes: 1 }], 4321);
    const { summary } = await service.getAccountDetail('acc-1', period);
    expect(summary.followersCount).toBe(4321);
  });

  // Weighted, not the mean of per-post ERs: a post with 12 views and 3 reactions
  // is 25%, and averaging it with everything else says nothing about the channel.
  it('computes ER from the totals, so small posts cannot skew it', async () => {
    const service = serviceWith([
      { views: 12, likes: 3 },
      { views: 10_000, likes: 100 },
    ]);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.erViews).toBeCloseTo((103 / 10_012) * 100, 6);
  });

  it('reports ER against followers as well', async () => {
    const service = serviceWith([{ views: 1000, likes: 50 }], 1000);
    const { summary } = await service.getAccountDetail('acc-1', period);
    expect(summary.erFollowers).toBeCloseTo(5, 6);
  });

  it('returns zeros and null ER for a period with no posts, not NaN', async () => {
    const service = serviceWith([]);

    const { summary } = await service.getAccountDetail('acc-1', period);

    expect(summary.postsCount).toBe(0);
    expect(summary.totalViews).toBe(0);
    expect(summary.avgViews).toBe(0);
    expect(summary.erViews).toBeNull();
    expect(summary.erFollowers).toBeNull();
  });

  it('treats a post with unknown views as contributing no views', async () => {
    const service = serviceWith([{ views: null, likes: 5 }]);
    const { summary } = await service.getAccountDetail('acc-1', period);
    expect(summary.totalViews).toBe(0);
    expect(summary.totalReactions).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/stats/stats.service.spec.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'postsCount')`

- [ ] **Step 3: Write the implementation**

Add to `stats.service.ts`, above the class:

```typescript
export interface AccountSummary {
  followersCount: number | null;
  postsCount: number;
  totalViews: number;
  totalReactions: number;
  avgViews: number;
  avgReactions: number;
  erViews: number | null;
  erFollowers: number | null;
}

/**
 * Computed from the rows getAccountDetail already loads and returns, so this adds
 * no query and no rows. ER is weighted — totals over totals — because the mean of
 * per-post ERs lets a post with a dozen views dominate the channel's figure.
 */
function summarise(posts: Post[], followersCount: number | null): AccountSummary {
  const totalViews = posts.reduce((sum, post) => sum + (post.views ?? 0), 0);
  const totalReactions = posts.reduce((sum, post) => sum + post.likes, 0);
  const postsCount = posts.length;

  return {
    followersCount,
    postsCount,
    totalViews,
    totalReactions,
    avgViews: postsCount > 0 ? totalViews / postsCount : 0,
    avgReactions: postsCount > 0 ? totalReactions / postsCount : 0,
    erViews: totalViews > 0 ? (totalReactions / totalViews) * 100 : null,
    erFollowers:
      followersCount && followersCount > 0 && postsCount > 0
        ? (totalReactions / postsCount / followersCount) * 100
        : null,
  };
}
```

Then return it from `getAccountDetail`:

```typescript
    const latestSnapshot = trend.length > 0 ? trend[trend.length - 1] : null;

    return {
      account,
      latestSnapshot,
      trend,
      posts,
      summary: summarise(posts, latestSnapshot?.followersCount ?? null),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest`
Expected: PASS — whole suite green

- [ ] **Step 5: Commit**

```bash
git add backend/src/stats/stats.service.ts backend/src/stats/stats.service.spec.ts
git commit -m "Summarise an account's views, reactions and engagement"
```

---

### Task 9: Period selector and stat tiles

**UI task — invoke the taste skill before writing markup or CSS.**

**Files:**
- Create: `frontend/src/components/PeriodSelector.tsx`, `PeriodSelector.module.css`
- Create: `frontend/src/components/StatTiles.tsx`, `StatTiles.module.css`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`
- Test: `frontend/src/components/PeriodSelector.test.tsx`, `frontend/src/pages/AccountDetailPage.test.tsx`

**Interfaces:**
- Consumes: the `summary` object from Task 8.
- Produces: `<PeriodSelector value={days} onChange={(days: number) => void} />` with values 7 | 30 | 90; `<StatTiles summary={AccountSummary} />`.

- [ ] **Step 1: Install frontend dependencies**

```bash
cd frontend && npm ci
```

- [ ] **Step 2: Write the failing tests**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PeriodSelector } from './PeriodSelector';

describe('PeriodSelector', () => {
  it('offers 7, 30 and 90 days', () => {
    render(<PeriodSelector value={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '7 дней' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 дней' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90 дней' })).toBeInTheDocument();
  });

  it('marks the selected period', () => {
    render(<PeriodSelector value={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '30 дней' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the chosen period in days', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '90 дней' }));
    expect(onChange).toHaveBeenCalledWith(90);
  });
});
```

Add to `AccountDetailPage.test.tsx`. Note the `digits` helper: `Intl.NumberFormat('ru-RU')` separates thousands with a **non-breaking** space (U+00A0), so asserting the literal `'4 000'` typed with an ordinary space fails against markup that is actually correct. Put this helper in the test file and use it for every formatted number:

```tsx
/** Matches a formatted number regardless of which kind of space separates the thousands. */
const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;
```

```tsx
  it('shows totals and averages in Russian', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        account: { id: 'acc-1', name: 'Chan' },
        latestSnapshot: { followersCount: 1000 },
        trend: [],
        posts: [],
        summary: {
          followersCount: 1000, postsCount: 2,
          totalViews: 4000, totalReactions: 200,
          avgViews: 2000, avgReactions: 100,
          erViews: 5, erFollowers: 10,
        },
      },
    });

    renderAt('/accounts/acc-1');

    expect(await screen.findByText('Просмотры')).toBeInTheDocument();
    expect(screen.getByText('Средние просмотры')).toBeInTheDocument();
    expect(screen.getByText(digits('4000'))).toBeInTheDocument();
  });

  it('refetches with a narrower range when the period changes', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        account: { id: 'acc-1', name: 'Chan' }, latestSnapshot: null, trend: [], posts: [],
        summary: { followersCount: 0, postsCount: 0, totalViews: 0, totalReactions: 0, avgViews: 0, avgReactions: 0, erViews: null, erFollowers: null },
      },
    });

    renderAt('/accounts/acc-1');
    fireEvent.click(await screen.findByRole('button', { name: '7 дней' }));

    await waitFor(() => {
      const lastCall = (apiClient.get as any).mock.calls.at(-1);
      const { from, to } = lastCall[1].params;
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      expect(days).toBeCloseTo(7, 0);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/PeriodSelector.test.tsx src/pages/AccountDetailPage.test.tsx`
Expected: FAIL — cannot resolve `./PeriodSelector`; "Просмотры" not found

- [ ] **Step 4: Implement the components**

`PeriodSelector.tsx`:

```tsx
import styles from './PeriodSelector.module.css';

const PERIODS = [7, 30, 90];

interface PeriodSelectorProps {
  value: number;
  onChange: (days: number) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className={styles.group} role="group" aria-label="Период">
      {PERIODS.map((days) => (
        <button
          key={days}
          type="button"
          className={days === value ? styles.active : styles.option}
          aria-pressed={days === value}
          onClick={() => onChange(days)}
        >
          {days} дней
        </button>
      ))}
    </div>
  );
}
```

`StatTiles.tsx` renders six tiles with these exact Russian labels: Подписчики, Просмотры, Реакции, Средние просмотры, Средние реакции, ER. Format numbers with `new Intl.NumberFormat('ru-RU')` (which renders 4000 as `4 000`), percentages as `X,X%`, and `—` for null. Label the follower-based figure so it is not mistaken for a point-in-time number: `ER к подписчикам` with the note that it uses the current subscriber count, and `ERR к просмотрам` for the reach figure.

**The existing test in `AccountDetailPage.test.tsx` mocks a response with no `summary`.** Update that mock to include one, or the page will read fields off `undefined`. Run the whole frontend suite, not just the new file.

In `AccountDetailPage.tsx`, hold `const [days, setDays] = useState(30)`, derive `from` from it inside `load`, add `days` to the `useCallback` dependencies, and render `<PeriodSelector>` and `<StatTiles>` above the trend chart.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS — whole suite green

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PeriodSelector.tsx frontend/src/components/PeriodSelector.module.css frontend/src/components/PeriodSelector.test.tsx frontend/src/components/StatTiles.tsx frontend/src/components/StatTiles.module.css frontend/src/pages/AccountDetailPage.tsx frontend/src/pages/AccountDetailPage.test.tsx
git commit -m "Show an account's totals and averages for a chosen period"
```

---

### Task 10: The sortable post grid

**UI task — invoke the taste skill before writing markup or CSS.**

**Files:**
- Create: `frontend/src/components/PostSortSelect.tsx`, `PostSortSelect.module.css`
- Modify: `frontend/src/components/PostList.tsx`, `PostList.module.css`
- Modify: `frontend/src/components/PostTypeFilter.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`
- Test: `frontend/src/components/PostList.test.tsx` (create), `PostTypeFilter.test.tsx` (create)

**Interfaces:**
- Consumes: the `posts` array from the detail response, each carrying `id, type, publishedAt, caption, thumbnailUrl, permalink, views, likes, er, erViews`.
- Produces: `export type PostSort = 'views' | 'reactions' | 'er' | 'date'` and `export interface PostItem { id: string; type: string; caption: string | null; publishedAt: string; thumbnailUrl: string | null; permalink: string; views: number | null; likes: number; er: number | null; erViews: number | null }`, both exported from `PostList.tsx` — Task 11 imports them. Plus `<PostSortSelect value onChange />` and `<PostList posts sort onOpen />`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostList } from './PostList';

const posts = [
  { id: 'p1', type: 'image', caption: 'Первый', publishedAt: '2026-09-01T10:00:00Z', thumbnailUrl: 'https://cdn/p1', permalink: 'https://t.me/c/1', views: 100, likes: 10, er: 1, erViews: 10 },
  { id: 'p2', type: 'video', caption: 'Второй', publishedAt: '2026-09-02T10:00:00Z', thumbnailUrl: 'https://cdn/p2', permalink: 'https://t.me/c/2', views: 900, likes: 9, er: 0.9, erViews: 1 },
];

describe('PostList', () => {
  it('shows the snippet, image and metrics for each post', () => {
    render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    expect(screen.getByText('Первый')).toBeInTheDocument();
    expect(screen.getByAltText('Первый')).toHaveAttribute('src', 'https://cdn/p1');
    expect(screen.getByText('900')).toBeInTheDocument();
  });

  it('sorts by views by default, highest first', () => {
    render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Второй')).toBeInTheDocument();
  });

  it('sorts by reactions when asked', () => {
    render(<PostList posts={posts} sort="reactions" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Первый')).toBeInTheDocument();
  });

  it('sorts by ER against views when asked', () => {
    render(<PostList posts={posts} sort="er" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Первый')).toBeInTheDocument();
  });

  it('sorts by date, newest first, when asked', () => {
    render(<PostList posts={posts} sort="date" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Второй')).toBeInTheDocument();
  });

  it('opens the post that was clicked', () => {
    const onOpen = vi.fn();
    render(<PostList posts={posts} sort="views" onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Первый'));
    expect(onOpen).toHaveBeenCalledWith(posts[0]);
  });

  it('explains an empty list instead of showing nothing', () => {
    render(<PostList posts={[]} sort="views" onOpen={() => {}} />);
    expect(screen.getByText(/Постов за этот период нет/)).toBeInTheDocument();
  });
});
```

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PostTypeFilter } from './PostTypeFilter';

describe('PostTypeFilter', () => {
  it('offers only the types a Telegram post can be, in Russian', () => {
    render(<PostTypeFilter value="all" onChange={() => {}} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Все', 'Изображение', 'Видео', 'Текст']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/PostList.test.tsx src/components/PostTypeFilter.test.tsx`
Expected: FAIL — `PostList` does not accept `sort`/`onOpen`; the type filter still offers `reel`, `short`, `story`

- [ ] **Step 3: Implement**

`PostList.tsx` takes `posts`, `sort` and `onOpen`, sorts a copy (never the prop array in place), and renders each post as a clickable `<li>` with `<img src={post.thumbnailUrl} alt={post.caption} />` when there is one, a clamped caption, and views / reactions / ER. Sort comparators:

```tsx
const COMPARATORS: Record<PostSort, (a: PostItem, b: PostItem) => number> = {
  views: (a, b) => (b.views ?? 0) - (a.views ?? 0),
  reactions: (a, b) => b.likes - a.likes,
  er: (a, b) => (b.erViews ?? 0) - (a.erViews ?? 0),
  date: (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
};
```

Images load directly from `<img src>`: these are public CDN URLs and must **not** go through the JWT avatar proxy, which exists only because Telegram's avatar URLs embed the bot token.

`PostSortSelect.tsx` offers Просмотры / Реакции / ER / Дата, defaulting to Просмотры.

`PostTypeFilter.tsx` replaces its `TYPES` array with the three that can occur, labelled in Russian: `image` → Изображение, `video` → Видео, `post` → Текст.

**`PostList` gains required props, so every existing render of it breaks.** Update the pre-existing assertions in `AccountDetailPage.test.tsx` accordingly and run the whole frontend suite.

In `AccountDetailPage.tsx`, hold `const [sort, setSort] = useState<PostSort>('views')`, render `<PostSortSelect>` next to the type filter, and pass `sort` through to `<PostList>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS — whole suite green

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PostList.tsx frontend/src/components/PostList.module.css frontend/src/components/PostList.test.tsx frontend/src/components/PostSortSelect.tsx frontend/src/components/PostSortSelect.module.css frontend/src/components/PostTypeFilter.tsx frontend/src/components/PostTypeFilter.test.tsx frontend/src/pages/AccountDetailPage.tsx
git commit -m "Sort an account's posts by views, reactions, ER or date"
```

---

### Task 11: The post modal

**UI task — invoke the taste skill before writing markup or CSS.**

**Files:**
- Create: `frontend/src/components/PostModal.tsx`, `PostModal.module.css`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`
- Test: `frontend/src/components/PostModal.test.tsx`

**Interfaces:**
- Consumes: one post object from Task 10's list.
- Produces: `<PostModal post={PostItem | null} onClose={() => void} />` — renders nothing when `post` is null.

- [ ] **Step 1: Pin the test timezone**

The modal formats a moment in the viewer's local timezone, which is right for users but makes the assertion below depend on where the test runs. Pin it in `frontend/vite.config.ts` so the expected time is stable:

```typescript
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    env: { TZ: 'UTC' },
  },
```

- [ ] **Step 2: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostModal } from './PostModal';

const post = {
  id: 'p1', type: 'image', caption: 'Полный текст поста',
  publishedAt: '2026-09-02T12:30:45Z', thumbnailUrl: 'https://cdn/p1',
  permalink: 'https://t.me/testchannel/102', views: 12300, likes: 1248, er: 1.2, erViews: 10.1,
};

const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

describe('PostModal', () => {
  it('renders nothing when no post is open', () => {
    const { container } = render(<PostModal post={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the full text, image and every metric', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    expect(screen.getByText('Полный текст поста')).toBeInTheDocument();
    expect(screen.getByAltText('Полный текст поста')).toHaveAttribute('src', 'https://cdn/p1');
    expect(screen.getByText(digits('12300'))).toBeInTheDocument();
    expect(screen.getByText(digits('1248'))).toBeInTheDocument();
  });

  it('shows the date AND the time of publication', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    expect(screen.getByText(/02\.09\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/12:30/)).toBeInTheDocument();
  });

  it('links out to the post on Telegram', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    expect(screen.getByRole('link', { name: /Открыть в Telegram/ })).toHaveAttribute(
      'href',
      'https://t.me/testchannel/102',
    );
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PostModal post={post} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<PostModal post={post} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('post-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/PostModal.test.tsx`
Expected: FAIL — cannot resolve `./PostModal`

- [ ] **Step 4: Implement**

`PostModal.tsx` returns `null` when `post` is null. Otherwise it renders a backdrop (`data-testid="post-modal-backdrop"`, closing on click) and a dialog (`role="dialog"`, `aria-modal="true"`) holding the image, the full untruncated caption, the metrics, and the publication moment formatted with `new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })` — date and time both, which is the point of the modal. A `useEffect` registers the Escape handler on `document` and removes it on unmount. Clicks inside the dialog must not bubble to the backdrop.

In `AccountDetailPage.tsx`, hold `const [openPost, setOpenPost] = useState<PostItem | null>(null)`, pass `onOpen={setOpenPost}` to `<PostList>`, and render `<PostModal post={openPost} onClose={() => setOpenPost(null)} />`. Because the modal is state on the page and not a route, sort and scroll position survive closing it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS — whole suite green

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PostModal.tsx frontend/src/components/PostModal.module.css frontend/src/components/PostModal.test.tsx frontend/src/pages/AccountDetailPage.tsx
git commit -m "Open a post in full, with its publication date and time"
```

---

### Task 12: End-to-end verification against a real channel

Every previous task tested against fixtures and mocks. This one proves the parser matches Telegram's *current* markup, which no fixture can.

**Files:**
- Modify: `docs/operations.md`

- [ ] **Step 1: Run the whole suite, both halves**

```bash
cd backend && npx jest
cd ../frontend && npx vitest run
```

Expected: both green. Record the counts.

- [ ] **Step 2: Verify the parser against a live page**

```bash
cd backend && npx ts-node -e "
import { TelegramPreviewClient } from './src/connectors/telegram/telegram-preview.client';
import { parsePreviewPage } from './src/connectors/telegram/telegram-preview.parser';
new TelegramPreviewClient().fetchPage('durov').then((html) => {
  const posts = parsePreviewPage(html, 'durov');
  console.log('posts:', posts.length);
  console.log(posts[0]);
});
"
```

Expected: a post count of about 20, and a first post with a real `publishedAt`, non-null `views`, and a `thumbnailUrl` if it carries media. **If `views` is null or the count is 0, the markup has changed** — fix the parser and update the fixture before going further.

- [ ] **Step 3: Document the operational notes**

Add a section to `docs/operations.md` covering: posts come from `t.me/s/<channel>`, not the Bot API; a channel that hides its web preview cannot be tracked for posts; view counts above 1000 are rounded by Telegram; and the check in Step 2 is how to tell a markup change from a quiet channel.

- [ ] **Step 4: Commit and hand over for deploy**

```bash
git add docs/operations.md
git commit -m "Document where post data comes from"
```

**Do not push, and do not merge.** This work is on the `telegram-post-analytics` branch;
integration is handled separately once the whole-branch review is clean. For reference, the
redeploy sequence that will run after the merge, including the new migration, is:

```bash
cd /opt/smm-dashboard/app && git pull && docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker compose -f docker-compose.prod.yml exec -T backend npx typeorm migration:run -d dist/db/data-source.js
```

Push before handing over the commands — a `git pull` against an unpushed commit is a silent no-op.

---

## Notes for the executor

- **Task order follows the data flow**, so Task 3 references `PostType.IMAGE` before Task 4 creates it. Doing Task 4 first is fine if you want every intermediate commit to compile.
- **Never `docker compose down -v`** on the VPS. That volume holds the Let's Encrypt certificate and every follower snapshot ever collected.
- **The dormant webhook is left alone.** It upserts on the same key with `views: null, likes: 0`; enabling it would overwrite scraped view counts with blanks. Do not call `setWebhook`.
- **`getTopPosts` still sorts in JS after loading every row.** It is a known backlog item and out of scope here. Do not "fix" it as a drive-by; it needs its own change with its own tests.
