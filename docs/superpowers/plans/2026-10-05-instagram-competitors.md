# Instagram Competitors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user paste an Instagram profile link into the same field as Telegram links and track that public Business/Creator account as a competitor, via Meta Business Discovery.

**Architecture:** A one-time, app-wide Facebook Login stores an encrypted Facebook token plus the user's own Instagram business id in a single-row table. `InstagramConnector` delegates accounts of type `public_no_access` to a new `InstagramDiscoverySource`, which calls `business_discovery.username(...)` on graph.facebook.com; everything downstream (sync, snapshots, full history, post UI) is unchanged. The add-account modal becomes «Аккаунт конкурента» (one auto-detecting link field) / «Свой аккаунт».

**Tech Stack:** NestJS + TypeORM (Postgres 16), axios, Jest (backend); React + Vite + Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-10-05-instagram-competitors-design.md`

## Global Constraints

- Graph API version `v23.0` everywhere (same as `instagram-api.client.ts`).
- Facebook endpoints: `https://graph.facebook.com/v23.0`, dialog `https://www.facebook.com/v23.0/dialog/oauth`.
- Scopes: `instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list`.
- New env vars: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI` (= `https://fdagency.duckdns.org/api/instagram/discovery/callback`), optional `FACEBOOK_LOGIN_CONFIG_ID`. Missing vars only log a warning; the app must still boot.
- Competitor accounts: `platform = instagram`, `type = public_no_access`, `externalId = @username` (lowercase), no `account_credentials` row.
- Error codes returned in 400 bodies: `instagram_discovery_not_connected`, `instagram_discovery_reconnect`.
- All new user-facing copy is Russian. Never log or return tokens.
- Request timeout 15 000 ms on every outbound call.
- Backend tests: `cd backend && npx jest <path>`; frontend tests: `cd frontend && npx vitest run <path>`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 0 (user, manual): verify the live API

Not code. The assistant cannot reach Meta from its environment; the user runs these in Graph API Explorer (select the Meta app, "Get User Access Token" with the four scopes above) after doing the Meta setup in Task 9. Implementation does not wait for this; the answers adjust details afterwards.

- [ ] `GET /me/accounts?fields=instagram_business_account{id,username},access_token` returns the Page with the user's Instagram account.
- [ ] `GET /<ig id>?fields=business_discovery.username(<some competitor>){followers_count,media_count,media.limit(3){id,like_count,comments_count,timestamp}}` works with the user token. Repeat with the Page `access_token`; if it also works, report it (the Page token does not expire — a small follow-up switches to it).
- [ ] Same call with `view_count` added to the media fields: works or "nonexisting field"? (Views stay null unless it works.)
- [ ] Same call for a personal account and for a non-existent username: note `error.code` and `error.error_subcode` (plan assumes `110` / `2207013`, see Task 3).
- [ ] `business_discovery.username(<your own username>){id}`: does `id` equal the `externalId` stored for your own Instagram account? (If not, own-account dedup in Task 7 simply never matches.)
- [ ] Facebook login dialog: does it accept `scope=`, or does the app require a Facebook Login for Business configuration (`config_id`)? If the latter, set `FACEBOOK_LOGIN_CONFIG_ID`.

---

### Task 1: Instagram link parsing

**Files:**
- Modify: `backend/src/accounts/parse-account-link.ts`
- Test: `backend/src/accounts/parse-account-link.spec.ts`

**Interfaces:**
- Produces: `parseAccountLink(link)` now returns `{ platform: INSTAGRAM, externalId: '@<username>' }` only for profile links; `export function isInstagramLink(link: string): boolean`.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('parseAccountLink', ...)`:

```ts
  describe('Instagram', () => {
    it('takes the username from the first path segment, not the last', () => {
      expect(parseAccountLink('https://www.instagram.com/brand/reels/')).toEqual({
        platform: AccountPlatform.INSTAGRAM,
        externalId: '@brand',
      });
    });

    it('ignores the share query string and lowercases the username', () => {
      expect(parseAccountLink('https://instagram.com/Brand.Shop_1?igsh=abc123')?.externalId).toBe('@brand.shop_1');
    });

    it.each([
      'https://www.instagram.com/p/C1a2B3c4D5/',
      'https://www.instagram.com/reel/C1a2B3c4D5/',
      'https://www.instagram.com/reels/C1a2B3c4D5/',
      'https://www.instagram.com/stories/brand/3141592653/',
      'https://www.instagram.com/explore/',
      'https://www.instagram.com/accounts/login/',
    ])('returns null for %s, which is not a profile', (link) => {
      expect(parseAccountLink(link)).toBeNull();
    });

    it('returns null for a username Instagram would not allow', () => {
      expect(parseAccountLink('https://instagram.com/not-a-name')).toBeNull();
    });
  });

  describe('isInstagramLink', () => {
    it('recognises any instagram.com URL, profile or not', () => {
      expect(isInstagramLink('https://www.instagram.com/p/C1a2B3c4D5/')).toBe(true);
      expect(isInstagramLink('https://instagram.com/brand')).toBe(true);
    });

    it('is false for other hosts and non-URLs', () => {
      expect(isInstagramLink('https://t.me/somechannel')).toBe(false);
      expect(isInstagramLink('instagram')).toBe(false);
    });
  });
```

Change the import line to `import { isInstagramLink, parseAccountLink } from './parse-account-link';`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/accounts/parse-account-link.spec.ts`
Expected: FAIL — `isInstagramLink` is not exported; `@reels` returned instead of `@brand`.

- [ ] **Step 3: Implement** — in `parse-account-link.ts`, after `TELEGRAM_RESERVED`:

```ts
// What Instagram accepts as a username: letters, digits, dots and underscores.
const INSTAGRAM_USERNAME = /^[a-z0-9._]{1,30}$/i;

// instagram.com paths that are not profiles: posts, reels, stories and app pages.
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']);

// The profile is always the first segment: /brand/reels/ and /brand/tagged/ are tabs of @brand.
function instagramHandle(pathname: string): string | null {
  const [head] = pathname.split('/').filter(Boolean);
  if (!head) return null;
  const name = head.replace(/^@/, '');
  if (INSTAGRAM_RESERVED.has(name.toLowerCase())) return null;
  return INSTAGRAM_USERNAME.test(name) ? name.toLowerCase() : null;
}

/** True for any instagram.com URL, so a post link can get its own error instead of "unsupported". */
export function isInstagramLink(link: string): boolean {
  try {
    return new URL(link.trim()).hostname.replace(/^www\./, '') === 'instagram.com';
  } catch {
    return false;
  }
}
```

In `parseAccountLink`, directly after the Telegram branch:

```ts
  if (platform === AccountPlatform.INSTAGRAM) {
    const handle = instagramHandle(url.pathname);
    return handle ? { platform, externalId: `@${handle}` } : null;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/accounts/parse-account-link.spec.ts`
Expected: PASS (including the pre-existing `korableva_prohealth` and `SomeOne` cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/accounts/parse-account-link.ts backend/src/accounts/parse-account-link.spec.ts
git commit -m "Read Instagram profile links by their first path segment"
```

---

### Task 2: Discovery connection table and `discovery` OAuth state

**Files:**
- Create: `backend/src/db/entities/instagram-discovery-connection.entity.ts`
- Create: `backend/src/db/migrations/1789800000000-AddInstagramDiscovery.ts`
- Modify: `backend/src/db/entities/instagram-oauth-state.entity.ts` (enum value)
- Modify: `backend/src/db/db.module.ts`, `backend/src/db/data-source.ts` (register entity)
- Modify: `backend/src/connectors/instagram/instagram-oauth.service.ts` (refuse discovery states)
- Test: `backend/src/connectors/instagram/instagram-oauth.service.spec.ts`

**Interfaces:**
- Produces: entity `InstagramDiscoveryConnection { id: number; igUserId: string; igUsername: string; encryptedToken: string; tokenExpiresAt: Date | null; needsReconnect: boolean; connectedAt: Date }`; `InstagramAccountKind.DISCOVERY = 'discovery'`.

- [ ] **Step 1: Write the failing test** — append to `instagram-oauth.service.spec.ts` (inside the top-level `describe`; reuse the file's existing key constant if it has one, else use `'a'.repeat(64)`):

```ts
  it('refuses a state that was issued for the Facebook discovery login', async () => {
    const stateService = { consume: jest.fn().mockResolvedValue(InstagramAccountKind.DISCOVERY) };
    const api = { exchangeCodeForToken: jest.fn() };
    const service = new InstagramOauthService(stateService as any, api as any, {} as any, {} as any, 'app-id', 'a'.repeat(64));

    await expect(service.completeLogin('code', 'state')).rejects.toThrow('Ссылка для входа устарела');
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });
```

Make sure `InstagramAccountKind` is imported from `'../../db/entities/instagram-oauth-state.entity'`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth.service.spec.ts`
Expected: FAIL — `DISCOVERY` does not exist on the enum (TS error).

- [ ] **Step 3: Implement**

`instagram-oauth-state.entity.ts` — extend the enum:

```ts
export enum InstagramAccountKind {
  OWN = 'own',
  CLIENT = 'client',
  /** The Facebook Login that powers competitor lookups; never creates an account. */
  DISCOVERY = 'discovery',
}
```

`instagram-oauth.service.ts`, in `completeLogin`, replace `if (!type) {` with:

```ts
    // A discovery state belongs to the Facebook callback; here it would create a bogus account.
    if (!type || type === InstagramAccountKind.DISCOVERY) {
```

`instagram-discovery-connection.entity.ts`:

```ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * The app-wide Facebook Login that Business Discovery lookups run through —
 * always a single row (id = 1), because accounts are shared, not per user.
 * igUserId is the user's own Instagram business account: lookups are made as it.
 */
@Entity('instagram_discovery_connection')
export class InstagramDiscoveryConnection {
  @PrimaryColumn('int') id: number;
  @Column({ type: 'text' }) igUserId: string;
  @Column({ type: 'text' }) igUsername: string;
  @Column({ type: 'text' }) encryptedToken: string;
  @Column({ nullable: true, type: 'timestamptz' }) tokenExpiresAt: Date | null;
  /** Set only on an auth failure; cleared by the next successful Facebook login. */
  @Column({ default: false }) needsReconnect: boolean;
  @Column({ type: 'timestamptz' }) connectedAt: Date;
}
```

`1789800000000-AddInstagramDiscovery.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Competitor lookups: the single Facebook connection, and its OAuth state kind. */
export class AddInstagramDiscovery1789800000000 implements MigrationInterface {
  name = 'AddInstagramDiscovery1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Allowed inside the migration transaction on Postgres 12+, as long as the
    // new value is not used in the same transaction — it is not.
    await queryRunner.query(`ALTER TYPE "instagram_oauth_states_type_enum" ADD VALUE IF NOT EXISTS 'discovery'`);
    await queryRunner.query(`
      CREATE TABLE "instagram_discovery_connection" (
        "id" integer NOT NULL,
        "igUserId" text NOT NULL,
        "igUsername" text NOT NULL,
        "encryptedToken" text NOT NULL,
        "tokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "needsReconnect" boolean NOT NULL DEFAULT false,
        "connectedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_instagram_discovery_connection" PRIMARY KEY ("id")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "instagram_discovery_connection"`);
    // Postgres cannot drop an enum value; an unused 'discovery' is harmless.
  }
}
```

Register the entity: in `db.module.ts` add `InstagramDiscoveryConnection` (with its import) right after `InstagramOauthState` in **both** the `entities` array of `forRoot` and the `forFeature` array; in `data-source.ts` add it after `InstagramOauthState` in `entities`.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/connectors/instagram src/db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db backend/src/connectors/instagram/instagram-oauth.service.ts backend/src/connectors/instagram/instagram-oauth.service.spec.ts
git commit -m "Add the table for the Facebook connection behind competitor lookups"
```

---

### Task 3: Facebook Graph client for Business Discovery

**Files:**
- Modify: `backend/src/connectors/instagram/instagram-api.client.ts` (export the media mapper)
- Modify: `backend/src/connectors/instagram/instagram-error.ts` (not-found detector)
- Create: `backend/src/connectors/instagram/instagram-discovery.client.ts`
- Test: `backend/src/connectors/instagram/instagram-discovery.client.spec.ts`, `backend/src/connectors/instagram/instagram-error.spec.ts`

**Interfaces:**
- Consumes: `InstagramMedia` from `instagram-api.client.ts`.
- Produces:
  - `export function mapRawMedia(raw: any): InstagramMedia` (in `instagram-api.client.ts`)
  - `export function isInstagramProfileNotFoundError(error: unknown): boolean` (in `instagram-error.ts`)
  - `class InstagramDiscoveryClient(appId: string, appSecret: string, redirectUri: string)` with
    - `exchangeCodeForToken(code: string): Promise<string>`
    - `exchangeForLongLivedToken(token: string): Promise<{ accessToken: string; expiresInSeconds: number | null }>`
    - `findLinkedInstagramAccount(token: string): Promise<LinkedInstagramAccount | null>`
    - `discover(token: string, igUserId: string, username: string, after: string | null): Promise<DiscoveryPage>`
  - `interface DiscoveredProfile { id: string; username: string; name: string | null; biography: string | null; profilePictureUrl: string | null; followersCount: number; followsCount: number; mediaCount: number }`
  - `interface DiscoveryPage { profile: DiscoveredProfile; media: InstagramMedia[]; nextCursor: string | null }`
  - `interface LinkedInstagramAccount { igUserId: string; igUsername: string }`

- [ ] **Step 1: Write the failing tests**

`instagram-error.spec.ts` — append:

```ts
describe('isInstagramProfileNotFoundError', () => {
  const graphError = (error: object) => ({ response: { status: 400, data: { error } } });

  it('recognises Business Discovery\'s "cannot find user" answer', () => {
    expect(isInstagramProfileNotFoundError(graphError({ type: 'OAuthException', code: 110, error_subcode: 2207013 }))).toBe(true);
  });

  it('does not mistake an expired token or a rate limit for a missing profile', () => {
    expect(isInstagramProfileNotFoundError(graphError({ type: 'OAuthException', code: 190 }))).toBe(false);
    expect(isInstagramProfileNotFoundError(graphError({ code: 4 }))).toBe(false);
  });
});
```

(add `isInstagramProfileNotFoundError` to that file's import from `./instagram-error`.)

`instagram-discovery.client.spec.ts`:

```ts
import axios from 'axios';
import { InstagramDiscoveryClient } from './instagram-discovery.client';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

const REDIRECT = 'https://fdagency.duckdns.org/api/instagram/discovery/callback';
const client = () => new InstagramDiscoveryClient('fb-app', 'fb-secret', REDIRECT);

const rawMedia = {
  id: 'm1',
  caption: 'Hi',
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  thumbnail_url: 'https://cdn/t.jpg',
  permalink: 'https://www.instagram.com/reel/abc/',
  timestamp: '2026-09-10T10:00:00+0000',
  like_count: 12,
  comments_count: 3,
};

describe('InstagramDiscoveryClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges the code for a user token', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'short' } } as any);

    expect(await client().exchangeCodeForToken('the-code')).toBe('short');
    expect(mockedGet).toHaveBeenCalledWith('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: { client_id: 'fb-app', client_secret: 'fb-secret', redirect_uri: REDIRECT, code: 'the-code' },
      timeout: 15_000,
    });
  });

  it('swaps a short-lived token for a long-lived one', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'long', expires_in: 5_184_000 } } as any);

    expect(await client().exchangeForLongLivedToken('short')).toEqual({ accessToken: 'long', expiresInSeconds: 5_184_000 });
    expect(mockedGet.mock.calls[0][1]).toEqual({
      params: { grant_type: 'fb_exchange_token', client_id: 'fb-app', client_secret: 'fb-secret', fb_exchange_token: 'short' },
      timeout: 15_000,
    });
  });

  it('reports a token without expires_in as non-expiring', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'long' } } as any);

    expect((await client().exchangeForLongLivedToken('short')).expiresInSeconds).toBeNull();
  });

  it('finds the first Page that has an Instagram business account', async () => {
    mockedGet.mockResolvedValue({
      data: { data: [{ id: 'page-1' }, { id: 'page-2', instagram_business_account: { id: '1784', username: 'fdagency' } }] },
    } as any);

    expect(await client().findLinkedInstagramAccount('tok')).toEqual({ igUserId: '1784', igUsername: 'fdagency' });
    expect(mockedGet).toHaveBeenCalledWith('https://graph.facebook.com/v23.0/me/accounts', {
      params: { fields: 'instagram_business_account{id,username}', access_token: 'tok' },
      timeout: 15_000,
    });
  });

  it('returns null when no Page has an Instagram account linked', async () => {
    mockedGet.mockResolvedValue({ data: { data: [{ id: 'page-1' }] } } as any);

    expect(await client().findLinkedInstagramAccount('tok')).toBeNull();
  });

  it('looks a competitor up through business_discovery and maps profile and media', async () => {
    mockedGet.mockResolvedValue({
      data: {
        business_discovery: {
          id: '9001',
          username: 'brand',
          name: 'Brand',
          biography: 'Bio',
          profile_picture_url: 'https://cdn/p.jpg',
          followers_count: 5000,
          follows_count: 10,
          media_count: 300,
          media: { data: [rawMedia], paging: { cursors: { after: 'CUR' } } },
        },
      },
    } as any);

    const page = await client().discover('tok', '1784', 'brand', null);

    expect(page.profile).toEqual({
      id: '9001', username: 'brand', name: 'Brand', biography: 'Bio', profilePictureUrl: 'https://cdn/p.jpg',
      followersCount: 5000, followsCount: 10, mediaCount: 300,
    });
    expect(page.media[0]).toMatchObject({ id: 'm1', mediaProductType: 'REELS', likeCount: 12, commentsCount: 3, mediaUrl: null });
    expect(page.nextCursor).toBe('CUR');
    const [url, config] = mockedGet.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/1784');
    expect((config as any).params.access_token).toBe('tok');
    expect((config as any).params.fields).toMatch(/^business_discovery\.username\(brand\)\{.*followers_count.*,media\.limit\(50\)\{.*like_count.*\}\}$/);
  });

  it('passes the cursor to the media edge', async () => {
    mockedGet.mockResolvedValue({ data: { business_discovery: { id: '9001', username: 'brand', media: { data: [] } } } } as any);

    await client().discover('tok', '1784', 'brand', 'CUR');

    expect((mockedGet.mock.calls[0][1] as any).params.fields).toContain('media.after(CUR).limit(50){');
  });

  it('ends the walk on an empty page even if a cursor is present', async () => {
    mockedGet.mockResolvedValue({
      data: { business_discovery: { id: '9001', username: 'brand', media: { data: [], paging: { cursors: { after: 'CUR' } } } } },
    } as any);

    expect((await client().discover('tok', '1784', 'brand', 'CUR')).nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram/instagram-discovery.client.spec.ts src/connectors/instagram/instagram-error.spec.ts`
Expected: FAIL — module `./instagram-discovery.client` not found; `isInstagramProfileNotFoundError` not exported.

- [ ] **Step 3: Implement**

`instagram-error.ts` — extend the error type and add the detector:

```ts
interface InstagramApiError {
  response?: { status?: number; data?: { error?: { type?: string; code?: number; error_subcode?: number; message?: string } } };
  message?: string;
}
```

```ts
/**
 * Business Discovery's answer for a username that does not exist, is a
 * personal account, or is age-gated: code 110 with subcode 2207013. To be
 * confirmed against the live API (plan Task 0); adjust here only.
 */
export function isInstagramProfileNotFoundError(error: unknown): boolean {
  const e = igError(error);
  return e?.code === 110 && e?.error_subcode === 2207013;
}
```

`instagram-api.client.ts` — move the inline mapping in `getMedia` into an exported function and use it:

```ts
/** Maps one raw Graph API media object; shared by /me/media and business_discovery. */
export function mapRawMedia(raw: any): InstagramMedia {
  return {
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
  };
}
```

and in `getMedia`: `const items: InstagramMedia[] = (data.data ?? []).map(mapRawMedia);`. Also `export` the `MEDIA_FIELDS` constant.

`instagram-discovery.client.ts`:

```ts
import axios from 'axios';
import { InstagramMedia, MEDIA_FIELDS, mapRawMedia } from './instagram-api.client';

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';
const REQUEST_TIMEOUT_MS = 15_000;
// Media per business_discovery call. The call counts once against the rate
// limit regardless of size, so fewer, larger pages are cheaper.
const PAGE_SIZE = 50;

const PROFILE_FIELDS = 'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count';

export interface DiscoveredProfile {
  id: string;
  username: string;
  name: string | null;
  biography: string | null;
  profilePictureUrl: string | null;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
}

export interface DiscoveryPage {
  profile: DiscoveredProfile;
  media: InstagramMedia[];
  nextCursor: string | null;
}

export interface LinkedInstagramAccount {
  igUserId: string;
  igUsername: string;
}

/**
 * Calls graph.facebook.com with a Facebook user token — the "Instagram API
 * with Facebook Login", the only flavour that offers Business Discovery.
 * Errors are thrown raw; callers translate them.
 */
export class InstagramDiscoveryClient {
  constructor(
    private appId: string,
    private appSecret: string,
    private redirectUri: string,
  ) {}

  async exchangeCodeForToken(code: string): Promise<string> {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: { client_id: this.appId, client_secret: this.appSecret, redirect_uri: this.redirectUri, code },
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (!data?.access_token) throw new Error('Facebook returned an unexpected token response');
    return data.access_token;
  }

  async exchangeForLongLivedToken(token: string): Promise<{ accessToken: string; expiresInSeconds: number | null }> {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: this.appId, client_secret: this.appSecret, fb_exchange_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return { accessToken: data.access_token, expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : null };
  }

  async findLinkedInstagramAccount(token: string): Promise<LinkedInstagramAccount | null> {
    const { data } = await axios.get(`${GRAPH_BASE}/me/accounts`, {
      params: { fields: 'instagram_business_account{id,username}', access_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const page = (data.data ?? []).find((p: any) => p.instagram_business_account?.id);
    if (!page) return null;
    return { igUserId: String(page.instagram_business_account.id), igUsername: page.instagram_business_account.username };
  }

  async discover(token: string, igUserId: string, username: string, after: string | null): Promise<DiscoveryPage> {
    const mediaEdge = `media${after ? `.after(${after})` : ''}.limit(${PAGE_SIZE}){${MEDIA_FIELDS}}`;
    const { data } = await axios.get(`${GRAPH_BASE}/${igUserId}`, {
      params: { fields: `business_discovery.username(${username}){${PROFILE_FIELDS},${mediaEdge}}`, access_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const found = data?.business_discovery;
    if (!found) throw new Error('Facebook returned no business_discovery data');

    const media: InstagramMedia[] = (found.media?.data ?? []).map(mapRawMedia);
    // Unlike /me/media, this nested edge is not documented to carry `paging.next`;
    // an empty page is the reliable end marker, at the cost of one extra call.
    const nextCursor = media.length > 0 ? (found.media?.paging?.cursors?.after ?? null) : null;

    return {
      profile: {
        id: String(found.id),
        username: found.username,
        name: found.name ?? null,
        biography: found.biography ?? null,
        profilePictureUrl: found.profile_picture_url ?? null,
        followersCount: found.followers_count ?? 0,
        followsCount: found.follows_count ?? 0,
        mediaCount: found.media_count ?? 0,
      },
      media,
      nextCursor,
    };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/connectors/instagram`
Expected: PASS (the existing `instagram-api.client.spec.ts` still passes after the refactor).

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram
git commit -m "Add a Facebook Graph client for Business Discovery lookups"
```

---

### Task 4: Discovery connection service and its errors

**Files:**
- Create: `backend/src/connectors/instagram/instagram-discovery.errors.ts`
- Create: `backend/src/connectors/instagram/instagram-discovery-connection.service.ts`
- Test: `backend/src/connectors/instagram/instagram-discovery-connection.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramDiscoveryConnection` (Task 2); `encryptToken(token, key)`, `decryptToken(encrypted, key)` from `instagram-token-crypto.ts`.
- Produces:
  - `class InstagramDiscoveryUnavailableError extends Error { reason: 'not_connected' | 'reconnect' }`
  - `class InstagramProfileNotFoundError extends Error`
  - `class InstagramDiscoveryConnectionService(repo: Repository<InstagramDiscoveryConnection>, encryptionKey: string)` with
    - `getCredentials(): Promise<{ igUserId: string; token: string }>` — throws `InstagramDiscoveryUnavailableError`
    - `status(): Promise<{ connected: boolean; needsReconnect: boolean; username: string | null }>`
    - `save(input: { igUserId: string; igUsername: string; token: string; expiresAt: Date | null }): Promise<void>`
    - `markNeedsReconnect(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';
import { InstagramDiscoveryUnavailableError } from './instagram-discovery.errors';
import { decryptToken, encryptToken } from './instagram-token-crypto';

const KEY = 'a'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: object = {}) {
  return {
    id: 1,
    igUserId: '1784',
    igUsername: 'fdagency',
    encryptedToken: encryptToken('fb-token', KEY),
    tokenExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    needsReconnect: false,
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(existing: object | null) {
  return { findOneBy: jest.fn().mockResolvedValue(existing), save: jest.fn(), update: jest.fn() } as any;
}

describe('InstagramDiscoveryConnectionService', () => {
  it('returns the decrypted token and the id lookups are made as', async () => {
    const service = new InstagramDiscoveryConnectionService(makeRepo(row()), KEY);

    expect(await service.getCredentials()).toEqual({ igUserId: '1784', token: 'fb-token' });
  });

  it.each([
    ['no connection exists', null, 'not_connected'],
    ['the connection was flagged', row({ needsReconnect: true }), 'reconnect'],
    ['the token has expired', row({ tokenExpiresAt: new Date(Date.now() - 1000) }), 'reconnect'],
  ])('refuses when %s', async (_label, existing, reason) => {
    const service = new InstagramDiscoveryConnectionService(makeRepo(existing), KEY);

    const attempt = service.getCredentials();

    await expect(attempt).rejects.toBeInstanceOf(InstagramDiscoveryUnavailableError);
    await expect(service.getCredentials()).rejects.toMatchObject({ reason });
  });

  it('treats a token without an expiry as valid', async () => {
    const service = new InstagramDiscoveryConnectionService(makeRepo(row({ tokenExpiresAt: null })), KEY);

    expect((await service.getCredentials()).token).toBe('fb-token');
  });

  it('reports status without exposing the token', async () => {
    expect(await new InstagramDiscoveryConnectionService(makeRepo(null), KEY).status()).toEqual({
      connected: false, needsReconnect: false, username: null,
    });
    expect(await new InstagramDiscoveryConnectionService(makeRepo(row({ needsReconnect: true })), KEY).status()).toEqual({
      connected: true, needsReconnect: true, username: 'fdagency',
    });
  });

  it('saves the single row encrypted and clears the reconnect flag', async () => {
    const repo = makeRepo(null);
    const expiresAt = new Date('2026-12-01T00:00:00Z');

    await new InstagramDiscoveryConnectionService(repo, KEY).save({ igUserId: '1784', igUsername: 'fdagency', token: 'fb-token', expiresAt });

    const saved = repo.save.mock.calls[0][0];
    expect(saved).toMatchObject({ id: 1, igUserId: '1784', igUsername: 'fdagency', tokenExpiresAt: expiresAt, needsReconnect: false });
    expect(saved.encryptedToken).not.toContain('fb-token');
    expect(decryptToken(saved.encryptedToken, KEY)).toBe('fb-token');
    expect(saved.connectedAt).toBeInstanceOf(Date);
  });

  it('flags the connection for reconnect', async () => {
    const repo = makeRepo(row());

    await new InstagramDiscoveryConnectionService(repo, KEY).markNeedsReconnect();

    expect(repo.update).toHaveBeenCalledWith({ id: 1 }, { needsReconnect: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram/instagram-discovery-connection.service.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`instagram-discovery.errors.ts`:

```ts
export type DiscoveryUnavailableReason = 'not_connected' | 'reconnect';

/** Competitor lookups cannot run until the user (re)connects Facebook. */
export class InstagramDiscoveryUnavailableError extends Error {
  constructor(public readonly reason: DiscoveryUnavailableReason) {
    super(
      reason === 'not_connected'
        ? 'Чтобы добавлять конкурентов из Instagram, один раз подключите Facebook'
        : 'Доступ к Facebook истёк — переподключите Facebook, чтобы видеть конкурентов из Instagram',
    );
  }
}

/** Business Discovery only sees public Business/Creator accounts that are not age-gated. */
export class InstagramProfileNotFoundError extends Error {
  constructor() {
    super('Аккаунт не найден или это не бизнес-аккаунт Instagram');
  }
}
```

`instagram-discovery-connection.service.ts`:

```ts
import { Repository } from 'typeorm';
import { InstagramDiscoveryConnection } from '../../db/entities/instagram-discovery-connection.entity';
import { InstagramDiscoveryUnavailableError } from './instagram-discovery.errors';
import { decryptToken, encryptToken } from './instagram-token-crypto';

const CONNECTION_ID = 1;

export class InstagramDiscoveryConnectionService {
  constructor(
    private repo: Repository<InstagramDiscoveryConnection>,
    private encryptionKey: string,
  ) {}

  async getCredentials(): Promise<{ igUserId: string; token: string }> {
    const row = await this.repo.findOneBy({ id: CONNECTION_ID });
    if (!row) throw new InstagramDiscoveryUnavailableError('not_connected');
    if (this.mustReconnect(row)) throw new InstagramDiscoveryUnavailableError('reconnect');
    return { igUserId: row.igUserId, token: decryptToken(row.encryptedToken, this.encryptionKey) };
  }

  async status(): Promise<{ connected: boolean; needsReconnect: boolean; username: string | null }> {
    const row = await this.repo.findOneBy({ id: CONNECTION_ID });
    if (!row) return { connected: false, needsReconnect: false, username: null };
    return { connected: true, needsReconnect: this.mustReconnect(row), username: row.igUsername };
  }

  async save(input: { igUserId: string; igUsername: string; token: string; expiresAt: Date | null }): Promise<void> {
    await this.repo.save({
      id: CONNECTION_ID,
      igUserId: input.igUserId,
      igUsername: input.igUsername,
      encryptedToken: encryptToken(input.token, this.encryptionKey),
      tokenExpiresAt: input.expiresAt,
      needsReconnect: false,
      connectedAt: new Date(),
    });
  }

  async markNeedsReconnect(): Promise<void> {
    await this.repo.update({ id: CONNECTION_ID }, { needsReconnect: true });
  }

  // An expired token is known to fail; asking for a reconnect up front beats a failed lookup.
  private mustReconnect(row: InstagramDiscoveryConnection): boolean {
    return row.needsReconnect || (row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() <= Date.now());
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/connectors/instagram/instagram-discovery-connection.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram/instagram-discovery.errors.ts backend/src/connectors/instagram/instagram-discovery-connection.service.ts backend/src/connectors/instagram/instagram-discovery-connection.service.spec.ts
git commit -m "Store and read the Facebook connection for competitor lookups"
```

---

### Task 5: Facebook login flow, endpoints and module wiring

**Files:**
- Create: `backend/src/connectors/instagram/instagram-discovery-oauth.service.ts`
- Create: `backend/src/connectors/instagram/instagram-discovery.controller.ts`
- Modify: `backend/src/connectors/instagram/instagram.module.ts`
- Modify: `backend/.env.example`
- Test: `backend/src/connectors/instagram/instagram-discovery-oauth.service.spec.ts`, `backend/src/connectors/instagram/instagram-discovery.controller.spec.ts`, `backend/src/connectors/instagram/instagram.module.spec.ts`

**Interfaces:**
- Consumes: `InstagramOauthStateService.create(kind)` / `.consume(id)`; `InstagramDiscoveryClient` (Task 3); `InstagramDiscoveryConnectionService` (Task 4); `translateInstagramError`.
- Produces:
  - `class InstagramDiscoveryOauthService(stateService, client, connection, appId: string, redirectUri: string, loginConfigId: string | null)` with `buildAuthorizeUrl(): Promise<string>`, `completeLogin(code: string, state: string): Promise<void>`
  - HTTP: `GET /instagram/discovery/connect` (JWT) → `{ redirectUrl }`; `GET /instagram/discovery/status` (JWT) → status object; `GET /instagram/discovery/callback` (public) → redirect to `/?add=competitor` or `/?add=competitor&discoveryError=<urlencoded message>`.
  - `InstagramModule` provides `InstagramDiscoveryClient` and `InstagramDiscoveryConnectionService` under their class tokens (Task 6 injects them; no export needed — only InstagramModule uses them).

- [ ] **Step 1: Write the failing tests**

`instagram-discovery-oauth.service.spec.ts`:

```ts
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramDiscoveryOauthService } from './instagram-discovery-oauth.service';

const REDIRECT = 'https://fdagency.duckdns.org/api/instagram/discovery/callback';

function setup(overrides: { kind?: InstagramAccountKind | null; linked?: object | null; expiresIn?: number | null; configId?: string | null } = {}) {
  const stateService = {
    create: jest.fn().mockResolvedValue('state-uuid'),
    consume: jest.fn().mockResolvedValue(overrides.kind === undefined ? InstagramAccountKind.DISCOVERY : overrides.kind),
  };
  const client = {
    exchangeCodeForToken: jest.fn().mockResolvedValue('short'),
    exchangeForLongLivedToken: jest.fn().mockResolvedValue({ accessToken: 'long', expiresInSeconds: overrides.expiresIn === undefined ? 5_184_000 : overrides.expiresIn }),
    findLinkedInstagramAccount: jest.fn().mockResolvedValue(overrides.linked === undefined ? { igUserId: '1784', igUsername: 'fdagency' } : overrides.linked),
  };
  const connection = { save: jest.fn() };
  const service = new InstagramDiscoveryOauthService(
    stateService as any, client as any, connection as any, 'fb-app', REDIRECT, overrides.configId ?? null,
  );
  return { service, stateService, client, connection };
}

describe('InstagramDiscoveryOauthService', () => {
  it('builds the Facebook dialog URL with the discovery state and scopes', async () => {
    const { service, stateService } = setup();

    const url = new URL(await service.buildAuthorizeUrl());

    expect(stateService.create).toHaveBeenCalledWith(InstagramAccountKind.DISCOVERY);
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('fb-app');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('state-uuid');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list');
  });

  it('uses a Facebook Login for Business configuration instead of scopes when one is set', async () => {
    const { service } = setup({ configId: 'cfg-42' });

    const url = new URL(await service.buildAuthorizeUrl());

    expect(url.searchParams.get('config_id')).toBe('cfg-42');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('stores the long-lived token for the linked Instagram account', async () => {
    const { service, client, connection } = setup();
    const before = Date.now();

    await service.completeLogin('the-code', 'state-uuid');

    expect(client.exchangeCodeForToken).toHaveBeenCalledWith('the-code');
    expect(client.exchangeForLongLivedToken).toHaveBeenCalledWith('short');
    expect(client.findLinkedInstagramAccount).toHaveBeenCalledWith('long');
    const saved = connection.save.mock.calls[0][0];
    expect(saved).toMatchObject({ igUserId: '1784', igUsername: 'fdagency', token: 'long' });
    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5_184_000 * 1000);
  });

  it('stores a token without expiry as non-expiring', async () => {
    const { service, connection } = setup({ expiresIn: null });

    await service.completeLogin('the-code', 'state-uuid');

    expect(connection.save.mock.calls[0][0].expiresAt).toBeNull();
  });

  it.each([
    ['an unknown state', null],
    ['an Instagram-login state', InstagramAccountKind.OWN],
  ])('refuses %s without calling Facebook', async (_label, kind) => {
    const { service, client } = setup({ kind });

    await expect(service.completeLogin('the-code', 'state-uuid')).rejects.toThrow('Ссылка для входа устарела');
    expect(client.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('explains when no Page has an Instagram account linked', async () => {
    const { service, connection } = setup({ linked: null });

    await expect(service.completeLogin('the-code', 'state-uuid')).rejects.toThrow(
      'К вашим страницам Facebook не привязан профессиональный аккаунт Instagram',
    );
    expect(connection.save).not.toHaveBeenCalled();
  });

  it('translates a Graph error into a readable message', async () => {
    const { service, client } = setup();
    client.exchangeCodeForToken.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Code expired' } } } });

    await expect(service.completeLogin('the-code', 'state-uuid')).rejects.toThrow('Code expired');
  });
});
```

`instagram-discovery.controller.spec.ts`:

```ts
import { InstagramDiscoveryController } from './instagram-discovery.controller';

function makeRes() {
  return { redirect: jest.fn() } as any;
}

describe('InstagramDiscoveryController', () => {
  const connection = { status: jest.fn().mockResolvedValue({ connected: true, needsReconnect: false, username: 'fdagency' }) };

  it('returns the dialog URL', async () => {
    const oauth = { buildAuthorizeUrl: jest.fn().mockResolvedValue('https://www.facebook.com/dialog') };
    const controller = new InstagramDiscoveryController(oauth as any, connection as any);

    expect(await controller.connect()).toEqual({ redirectUrl: 'https://www.facebook.com/dialog' });
  });

  it('returns the connection status', async () => {
    const controller = new InstagramDiscoveryController({} as any, connection as any);

    expect(await controller.status()).toEqual({ connected: true, needsReconnect: false, username: 'fdagency' });
  });

  it('sends the browser back to the add-competitor dialog after a successful login', async () => {
    const oauth = { completeLogin: jest.fn().mockResolvedValue(undefined) };
    const res = makeRes();

    await new InstagramDiscoveryController(oauth as any, connection as any).callback('the-code', 'state-uuid', res);

    expect(oauth.completeLogin).toHaveBeenCalledWith('the-code', 'state-uuid');
    expect(res.redirect).toHaveBeenCalledWith('/?add=competitor');
  });

  it('carries a failed login\'s message back to the dialog', async () => {
    const oauth = { completeLogin: jest.fn().mockRejectedValue(new Error('Ссылка для входа устарела')) };
    const res = makeRes();

    await new InstagramDiscoveryController(oauth as any, connection as any).callback('the-code', 'state-uuid', res);

    expect(res.redirect).toHaveBeenCalledWith(`/?add=competitor&discoveryError=${encodeURIComponent('Ссылка для входа устарела')}`);
  });

  it('treats a callback without a code (the user cancelled) as a cancelled login', async () => {
    const oauth = { completeLogin: jest.fn() };
    const res = makeRes();

    await new InstagramDiscoveryController(oauth as any, connection as any).callback(undefined, 'state-uuid', res);

    expect(oauth.completeLogin).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(`/?add=competitor&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`);
  });
});
```

`instagram.module.spec.ts` — in `beforeEach` add to `process.env`:

```ts
      FACEBOOK_APP_ID: 'fb-app',
      FACEBOOK_APP_SECRET: 'fb-secret',
      FACEBOOK_REDIRECT_URI: 'https://fdagency.duckdns.org/api/instagram/discovery/callback',
```

add `.overrideProvider(getRepositoryToken(InstagramDiscoveryConnection)).useValue({})` to **both** `Test.createTestingModule(...)` chains (import the entity), and append:

```ts
  it('hosts the Facebook discovery controller', () => {
    expect(Reflect.getMetadata('controllers', InstagramModule)).toContain(InstagramDiscoveryController);
  });

  it('provides the discovery OAuth service', async () => {
    const moduleRef = await compileModule();

    expect(moduleRef.get(InstagramDiscoveryOauthService)).toBeInstanceOf(InstagramDiscoveryOauthService);
  });
```

Also change the existing test `'no longer hosts the OAuth controller itself — ...'` first assertion so it still holds now that the module has controllers: it uses `?? []` and `not.toContain(InstagramOauthController)`, which stays true — leave it as is.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram`
Expected: FAIL — new modules not found.

- [ ] **Step 3: Implement**

`instagram-discovery-oauth.service.ts`:

```ts
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramDiscoveryClient, LinkedInstagramAccount } from './instagram-discovery.client';
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { translateInstagramError } from './instagram-error';

const DIALOG_URL = 'https://www.facebook.com/v23.0/dialog/oauth';
// pages_show_list lets /me/accounts find the Page; the other three are what
// business_discovery itself requires.
const SCOPES = 'instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list';

/** The one-time Facebook Login whose token every competitor lookup uses. */
export class InstagramDiscoveryOauthService {
  constructor(
    private stateService: InstagramOauthStateService,
    private client: InstagramDiscoveryClient,
    private connection: InstagramDiscoveryConnectionService,
    private appId: string,
    private redirectUri: string,
    private loginConfigId: string | null,
  ) {}

  async buildAuthorizeUrl(): Promise<string> {
    const state = await this.stateService.create(InstagramAccountKind.DISCOVERY);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
      // Facebook Login for Business apps define permissions in a configuration
      // instead of a scope list (plan Task 0 tells which this app needs).
      ...(this.loginConfigId ? { config_id: this.loginConfigId } : { scope: SCOPES }),
    });
    return `${DIALOG_URL}?${params.toString()}`;
  }

  async completeLogin(code: string, state: string): Promise<void> {
    const kind = await this.stateService.consume(state);
    if (kind !== InstagramAccountKind.DISCOVERY) {
      throw new Error('Ссылка для входа устарела, попробуйте подключить Facebook заново');
    }

    let token: string, expiresInSeconds: number | null, linked: LinkedInstagramAccount | null;
    try {
      const shortLived = await this.client.exchangeCodeForToken(code);
      ({ accessToken: token, expiresInSeconds } = await this.client.exchangeForLongLivedToken(shortLived));
      linked = await this.client.findLinkedInstagramAccount(token);
    } catch (error) {
      throw translateInstagramError(error);
    }
    if (!linked) throw new Error('К вашим страницам Facebook не привязан профессиональный аккаунт Instagram');

    await this.connection.save({
      igUserId: linked.igUserId,
      igUsername: linked.igUsername,
      token,
      expiresAt: expiresInSeconds === null ? null : new Date(Date.now() + expiresInSeconds * 1000),
    });
  }
}
```

`instagram-discovery.controller.ts`:

```ts
import { Controller, Get, Logger, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InstagramDiscoveryOauthService } from './instagram-discovery-oauth.service';
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';

const ADD_COMPETITOR = '/?add=competitor';

/**
 * connect/status are called by the SPA with its JWT; callback is reached by
 * Facebook's browser redirect, which cannot carry one. Every callback outcome
 * lands back in the add-competitor dialog, which shows any error.
 */
@Controller('instagram/discovery')
export class InstagramDiscoveryController {
  private readonly logger = new Logger(InstagramDiscoveryController.name);

  constructor(
    private oauth: InstagramDiscoveryOauthService,
    private connection: InstagramDiscoveryConnectionService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('connect')
  async connect() {
    return { redirectUrl: await this.oauth.buildAuthorizeUrl() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  status() {
    return this.connection.status();
  }

  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string, @Res() res: Response) {
    try {
      // Facebook sends error=access_denied and no code when the user cancels.
      if (!code) throw new Error('Вход через Facebook отменён');
      await this.oauth.completeLogin(code, state);
      res.redirect(ADD_COMPETITOR);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Facebook discovery login failed: ${message}`);
      res.redirect(`${ADD_COMPETITOR}&discoveryError=${encodeURIComponent(message)}`);
    }
  }
}
```

`instagram.module.ts`:
- import `InstagramDiscoveryConnection`, `InstagramDiscoveryClient`, `InstagramDiscoveryConnectionService`, `InstagramDiscoveryOauthService`, `InstagramDiscoveryController`.
- `TypeOrmModule.forFeature([Account, AccountCredential, InstagramOauthState, InstagramDiscoveryConnection])`.
- add `controllers: [InstagramDiscoveryController],` to the `@Module` options.
- add providers:

```ts
    {
      provide: InstagramDiscoveryClient,
      useFactory: () =>
        new InstagramDiscoveryClient(
          process.env.FACEBOOK_APP_ID as string,
          process.env.FACEBOOK_APP_SECRET as string,
          process.env.FACEBOOK_REDIRECT_URI as string,
        ),
    },
    {
      provide: InstagramDiscoveryConnectionService,
      useFactory: (repo: any) => new InstagramDiscoveryConnectionService(repo, process.env.CREDENTIAL_ENCRYPTION_KEY as string),
      inject: [getRepositoryToken(InstagramDiscoveryConnection)],
    },
    {
      provide: InstagramDiscoveryOauthService,
      useFactory: (stateService: InstagramOauthStateService, client: InstagramDiscoveryClient, connection: InstagramDiscoveryConnectionService) =>
        new InstagramDiscoveryOauthService(
          stateService,
          client,
          connection,
          process.env.FACEBOOK_APP_ID as string,
          process.env.FACEBOOK_REDIRECT_URI as string,
          process.env.FACEBOOK_LOGIN_CONFIG_ID || null,
        ),
      inject: [InstagramOauthStateService, InstagramDiscoveryClient, InstagramDiscoveryConnectionService],
    },
```

- config warnings: add below `REQUIRED_ENV`:

```ts
const DISCOVERY_ENV = ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_REDIRECT_URI'] as const;
```

and at the end of `onModuleInit`:

```ts
    for (const name of DISCOVERY_ENV.filter((n) => !process.env[n])) {
      this.logger.warn(`Instagram competitors are not configured: ${name} is not set`);
    }
```

- update the module doc comment: it now also hosts the Facebook discovery controller (which, unlike the Instagram OAuth controller, needs nothing from SyncModule).

`backend/.env.example` — append:

```
# Facebook Login for Instagram competitor lookups (Business Discovery).
# App ID/secret from the Meta app's App settings → Basic — NOT the Instagram app id above.
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=https://fdagency.duckdns.org/api/instagram/discovery/callback
# Only if the login dialog rejects scope=: a Facebook Login for Business configuration id.
FACEBOOK_LOGIN_CONFIG_ID=
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/connectors/instagram src/accounts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors/instagram backend/.env.example
git commit -m "Connect Facebook once for Instagram competitor lookups"
```

---

### Task 6: Connector reads competitor accounts through Business Discovery

**Files:**
- Create: `backend/src/connectors/instagram/instagram-discovery.source.ts`
- Modify: `backend/src/connectors/instagram/instagram.connector.ts`
- Modify: `backend/src/connectors/instagram/instagram-post-mapper.ts` (export `NO_INSIGHTS`)
- Modify: `backend/src/connectors/connector.interface.ts` (`AccountInfo.platformUserId`)
- Modify: `backend/src/connectors/instagram/instagram.module.ts` (wire source into connector)
- Test: `backend/src/connectors/instagram/instagram-discovery.source.spec.ts`, `backend/src/connectors/instagram/instagram.connector.spec.ts`

**Interfaces:**
- Consumes: `InstagramDiscoveryClient.discover(...)`, `InstagramDiscoveryConnectionService.getCredentials()` / `.markNeedsReconnect()`, errors from Task 4, `isInstagramProfileNotFoundError` (Task 3).
- Produces:
  - `AccountInfo.platformUserId?: string`
  - `export const NO_INSIGHTS: InstagramMediaInsights` (mapper)
  - `export function instagramRateLimitPause(): HistoryPauseError` (connector file)
  - `class InstagramDiscoverySource(client, connection)` with `getAccountInfo(account)`, `getAccountStats(account)`, `getPosts(account, since)`, `loadHistoryPage(account, cursor)` — same return types as `SocialConnector`.
  - `InstagramConnector` constructor gains a 4th parameter `discovery: InstagramDiscoverySource`.

- [ ] **Step 1: Write the failing tests**

`instagram-discovery.source.spec.ts`:

```ts
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { HistoryPauseError } from '../history-pause.error';
import { InstagramDiscoverySource } from './instagram-discovery.source';
import { InstagramDiscoveryUnavailableError, InstagramProfileNotFoundError } from './instagram-discovery.errors';

const competitor = { platform: AccountPlatform.INSTAGRAM, externalId: '@brand', type: AccountType.PUBLIC_NO_ACCESS } as any;

const profile = {
  id: '9001', username: 'brand', name: null, biography: 'Bio', profilePictureUrl: 'https://cdn/p.jpg',
  followersCount: 5000, followsCount: 10, mediaCount: 300,
};
const media = (id: string, timestamp: string) => ({
  id, timestamp, caption: null, mediaType: 'IMAGE', mediaProductType: 'FEED', mediaUrl: 'https://cdn/m.jpg',
  thumbnailUrl: null, permalink: null, likeCount: 7, commentsCount: 2,
});

function setup(discover: jest.Mock) {
  const client = { discover };
  const connection = {
    getCredentials: jest.fn().mockResolvedValue({ igUserId: '1784', token: 'fb-token' }),
    markNeedsReconnect: jest.fn(),
  };
  return { source: new InstagramDiscoverySource(client as any, connection as any), client, connection };
}

describe('InstagramDiscoverySource', () => {
  it('looks the account up by username without the @', async () => {
    const { source, client } = setup(jest.fn().mockResolvedValue({ profile, media: [], nextCursor: null }));

    const info = await source.getAccountInfo(competitor);

    expect(client.discover).toHaveBeenCalledWith('fb-token', '1784', 'brand', null);
    expect(info).toEqual({ name: 'brand', avatarUrl: 'https://cdn/p.jpg', description: 'Bio', platformUserId: '9001' });
  });

  it('maps follower, following and post counts', async () => {
    const { source } = setup(jest.fn().mockResolvedValue({ profile, media: [], nextCursor: null }));

    expect(await source.getAccountStats(competitor)).toEqual({ followersCount: 5000, followingCount: 10, postsCount: 300 });
  });

  it('walks pages until a post older than sinceDate, with no insights', async () => {
    const discover = jest
      .fn()
      .mockResolvedValueOnce({ profile, media: [media('a', '2026-09-20T00:00:00+0000')], nextCursor: 'C1' })
      .mockResolvedValueOnce({ profile, media: [media('b', '2026-09-10T00:00:00+0000'), media('c', '2026-08-01T00:00:00+0000')], nextCursor: 'C2' });
    const { source } = setup(discover);

    const posts = await source.getPosts(competitor, new Date('2026-09-01'));

    expect(posts.map((p) => p.externalPostId)).toEqual(['a', 'b']);
    expect(posts[0]).toMatchObject({ likes: 7, comments: 2, views: null, reach: null, shares: 0 });
    expect(discover).toHaveBeenCalledTimes(2);
    expect(discover).toHaveBeenLastCalledWith('fb-token', '1784', 'brand', 'C1');
  });

  it('returns one history page with its cursor', async () => {
    const { source } = setup(jest.fn().mockResolvedValue({ profile, media: [media('a', '2026-09-20T00:00:00+0000')], nextCursor: 'C1' }));

    const page = await source.loadHistoryPage(competitor, 'C0');

    expect(page.posts.map((p) => p.externalPostId)).toEqual(['a']);
    expect(page.nextCursor).toBe('C1');
  });

  it('turns "cannot find user" into a not-found error', async () => {
    const { source } = setup(jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { code: 110, error_subcode: 2207013 } } } }));

    await expect(source.getAccountInfo(competitor)).rejects.toBeInstanceOf(InstagramProfileNotFoundError);
  });

  it('flags the Facebook connection, not an account, when the token is rejected', async () => {
    const { source, connection } = setup(jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { type: 'OAuthException', code: 190 } } } }));

    await expect(source.getAccountStats(competitor)).rejects.toMatchObject({ reason: 'reconnect' });
    expect(connection.markNeedsReconnect).toHaveBeenCalled();
  });

  it('pauses on a rate limit', async () => {
    const { source } = setup(jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { code: 4 } } } }));

    await expect(source.loadHistoryPage(competitor, null)).rejects.toBeInstanceOf(HistoryPauseError);
  });

  it('passes on the connection\'s own refusal untouched', async () => {
    const { source, connection, client } = setup(jest.fn());
    connection.getCredentials.mockRejectedValue(new InstagramDiscoveryUnavailableError('not_connected'));

    await expect(source.getAccountInfo(competitor)).rejects.toMatchObject({ reason: 'not_connected' });
    expect(client.discover).not.toHaveBeenCalled();
  });
});
```

`instagram.connector.spec.ts`:
1. Mechanically pass a 4th argument to every existing constructor call:
   `sed -i 's/, KEY)/, KEY, {} as any)/g' backend/src/connectors/instagram/instagram.connector.spec.ts`
   then check `grep -c "KEY, {} as any)"` equals the previous `new InstagramConnector(` count (19).
2. Append:

```ts
describe('InstagramConnector with a competitor account', () => {
  const competitor = { platform: AccountPlatform.INSTAGRAM, externalId: '@brand', type: 'public_no_access' } as any;

  function setup() {
    const discovery = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'brand' }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 1 }),
      getPosts: jest.fn().mockResolvedValue([]),
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [], nextCursor: null }),
    };
    const api = { getProfile: jest.fn(), getMedia: jest.fn(), getMediaInsights: jest.fn() };
    const credentials = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentials, 'a'.repeat(64), discovery as any);
    return { connector, discovery, api, credentials };
  }

  it('reads it through Business Discovery, without a stored token', async () => {
    const { connector, discovery, api, credentials } = setup();
    const since = new Date('2026-09-01');

    await connector.getAccountInfo(competitor);
    await connector.getAccountStats(competitor);
    await connector.getPosts(competitor, since);
    await connector.loadHistoryPage(competitor, 'C1');

    expect(discovery.getAccountInfo).toHaveBeenCalledWith(competitor);
    expect(discovery.getAccountStats).toHaveBeenCalledWith(competitor);
    expect(discovery.getPosts).toHaveBeenCalledWith(competitor, since);
    expect(discovery.loadHistoryPage).toHaveBeenCalledWith(competitor, 'C1');
    expect(api.getProfile).not.toHaveBeenCalled();
    expect(credentials.findOneBy).not.toHaveBeenCalled();
  });

  it('has no insights to load for it', async () => {
    const { connector, api } = setup();

    expect(await connector.loadPostInsights(competitor, 'm1')).toEqual({ reach: null, shares: null, views: null });
    expect(api.getMediaInsights).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram`
Expected: FAIL — `./instagram-discovery.source` not found; connector calls `getProfile` for the competitor.

- [ ] **Step 3: Implement**

`connector.interface.ts` — in `AccountInfo` add:

```ts
  /** The platform's own id for the account, when a lookup by handle returns it (Instagram competitors). */
  platformUserId?: string;
```

`instagram-post-mapper.ts` — add:

```ts
/** For posts whose insights are not (yet) known: history pages and competitors. */
export const NO_INSIGHTS: InstagramMediaInsights = { reach: null, saved: null, shares: null, views: null };
```

`instagram.connector.ts`:
- delete its local `NO_INSIGHTS` constant and import it from `./instagram-post-mapper`;
- `export` the `instagramRateLimitPause` function;
- import `AccountType` and `InstagramDiscoverySource`;
- constructor gets `private discovery: InstagramDiscoverySource,` as the 4th parameter;
- add a helper and a guard at the top of each public data method:

```ts
  /** Competitors have no token of their own; they are read through the shared Facebook connection. */
  private isCompetitor(account: Account): boolean {
    return account.type === AccountType.PUBLIC_NO_ACCESS;
  }
```

```ts
  async getAccountInfo(account: Account): Promise<AccountInfo> {
    if (this.isCompetitor(account)) return this.discovery.getAccountInfo(account);
    ...existing body
  }
  async getAccountStats(account: Account): Promise<AccountStats> {
    if (this.isCompetitor(account)) return this.discovery.getAccountStats(account);
    ...
  }
  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    if (this.isCompetitor(account)) return this.discovery.getPosts(account, sinceDate);
    ...
  }
  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    if (this.isCompetitor(account)) return this.discovery.loadHistoryPage(account, cursor);
    ...
  }
  async loadPostInsights(account: Account, externalPostId: string): Promise<PostInsights> {
    // Business Discovery exposes no per-post insights for other people's accounts.
    if (this.isCompetitor(account)) return { reach: null, shares: null, views: null };
    ...
  }
```

`instagram-discovery.source.ts`:

```ts
import { Account } from '../../db/entities/account.entity';
import { AccountInfo, AccountStats, ConnectorPost, HistoryPage } from '../connector.interface';
import { HistoryPauseError, isNetworkError, networkPause } from '../history-pause.error';
import { DiscoveryPage, InstagramDiscoveryClient } from './instagram-discovery.client';
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';
import { InstagramDiscoveryUnavailableError, InstagramProfileNotFoundError } from './instagram-discovery.errors';
import { isInstagramAuthError, isInstagramProfileNotFoundError, isInstagramRateLimitError, translateInstagramError } from './instagram-error';
import { mapInstagramPost, NO_INSIGHTS } from './instagram-post-mapper';
import { instagramRateLimitPause } from './instagram.connector';

/**
 * Reads someone else's public Business/Creator account via Business Discovery,
 * made as the user's own Instagram account through the shared Facebook connection.
 * Likes and comments only — no insights exist for accounts we do not own.
 */
export class InstagramDiscoverySource {
  constructor(
    private client: InstagramDiscoveryClient,
    private connection: InstagramDiscoveryConnectionService,
  ) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const { profile } = await this.lookup(account, null);
    return {
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
      description: profile.biography,
      platformUserId: profile.id,
    };
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const { profile } = await this.lookup(account, null);
    return { followersCount: profile.followersCount, followingCount: profile.followsCount, postsCount: profile.mediaCount };
  }

  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    const collected: ConnectorPost[] = [];
    let cursor: string | null = null;
    // Newest first, like /me/media: stop at the first post older than sinceDate.
    for (;;) {
      const page = await this.lookup(account, cursor);
      for (const media of page.media) {
        if (new Date(media.timestamp) < sinceDate) return collected;
        collected.push(mapInstagramPost(media, NO_INSIGHTS));
      }
      if (!page.nextCursor) return collected;
      cursor = page.nextCursor;
    }
  }

  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    const page = await this.lookup(account, cursor);
    return { posts: page.media.map((media) => mapInstagramPost(media, NO_INSIGHTS)), nextCursor: page.nextCursor };
  }

  private async lookup(account: Account, after: string | null): Promise<DiscoveryPage> {
    const { igUserId, token } = await this.connection.getCredentials();
    const username = account.externalId.replace(/^@/, '');
    try {
      return await this.client.discover(token, igUserId, username, after);
    } catch (error) {
      if (error instanceof HistoryPauseError) throw error;
      if (isInstagramProfileNotFoundError(error)) throw new InstagramProfileNotFoundError();
      if (isInstagramAuthError(error)) {
        await this.connection.markNeedsReconnect();
        throw new InstagramDiscoveryUnavailableError('reconnect');
      }
      if (isInstagramRateLimitError(error)) throw instagramRateLimitPause();
      if (isNetworkError(error)) throw networkPause();
      throw translateInstagramError(error);
    }
  }
}
```

(Note the import cycle `instagram.connector.ts` ↔ `instagram-discovery.source.ts`: the connector imports the source only as a type for its constructor; use `import type { InstagramDiscoverySource } from './instagram-discovery.source';` in the connector to keep the runtime graph acyclic.)

`instagram.module.ts` — add the source provider and pass it to the connector:

```ts
    {
      provide: InstagramDiscoverySource,
      useFactory: (client: InstagramDiscoveryClient, connection: InstagramDiscoveryConnectionService) =>
        new InstagramDiscoverySource(client, connection),
      inject: [InstagramDiscoveryClient, InstagramDiscoveryConnectionService],
    },
    {
      provide: InstagramConnector,
      useFactory: (api: InstagramApiClient, credentialsRepo: any, discovery: InstagramDiscoverySource) =>
        new InstagramConnector(api, credentialsRepo, process.env.CREDENTIAL_ENCRYPTION_KEY as string, discovery),
      inject: [INSTAGRAM_API_CLIENT, getRepositoryToken(AccountCredential), InstagramDiscoverySource],
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/connectors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/connectors
git commit -m "Read Instagram competitor accounts through Business Discovery"
```

---

### Task 7: Accept Instagram competitor links; no false reconnect banner

**Files:**
- Modify: `backend/src/accounts/accounts.service.ts`
- Modify: `backend/src/stats/stats.service.ts:125`
- Test: `backend/src/accounts/accounts.service.spec.ts`, `backend/src/stats/stats.service.spec.ts`

**Interfaces:**
- Consumes: `isInstagramLink` (Task 1); `InstagramDiscoveryUnavailableError`, `InstagramProfileNotFoundError` (Task 4); `AccountInfo.platformUserId` (Task 6).
- Produces: `POST /accounts/preview` and `/accounts/from-link` accept Instagram profile links; 400 bodies `{ message, code: 'instagram_discovery_not_connected' | 'instagram_discovery_reconnect' }` when Facebook is missing/expired.

- [ ] **Step 1: Write the failing tests**

`accounts.service.spec.ts` — **replace** the whole `describe('Instagram links', ...)` block with:

```ts
  describe('Instagram links', () => {
    function setup(opts: { info?: object; infoError?: Error; existing?: (where: any) => unknown } = {}) {
      const repo = {
        save: jest.fn((x) => Promise.resolve({ id: 'acc-new', ...x })),
        create: jest.fn((x) => x),
        findOneBy: jest.fn((where) => Promise.resolve(opts.existing ? opts.existing(where) : null)),
      } as any;
      const connector = {
        getAccountInfo: opts.infoError
          ? jest.fn().mockRejectedValue(opts.infoError)
          : jest.fn().mockResolvedValue(opts.info ?? { name: 'Brand', avatarUrl: null, description: null, platformUserId: '9001' }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 5000, followingCount: 10, postsCount: 300 }),
        getAvatar: jest.fn(),
      };
      const registry = { get: jest.fn().mockReturnValue(connector) } as any;
      const syncJobs = { createManual: jest.fn() };
      return { service: new AccountsService(repo, registry, syncJobs as any), repo, connector, syncJobs };
    }

    it('previews a competitor profile, asking the connector as a competitor', async () => {
      const { service, connector } = setup();

      const preview = await service.preview('https://www.instagram.com/brand/');

      expect(preview).toMatchObject({ platform: AccountPlatform.INSTAGRAM, externalId: '@brand', name: 'Brand', followersCount: 5000, alreadyAdded: false });
      expect(connector.getAccountInfo).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '@brand', type: AccountType.PUBLIC_NO_ACCESS }),
      );
    });

    it('adds the competitor and queues its first sync', async () => {
      const { service, repo, syncJobs } = setup();

      await service.createFromLink('https://instagram.com/brand');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ platform: AccountPlatform.INSTAGRAM, externalId: '@brand', type: AccountType.PUBLIC_NO_ACCESS }),
      );
      expect(syncJobs.createManual).toHaveBeenCalledWith('acc-new');
    });

    it('asks for a profile link when given a post link', async () => {
      const { service, connector } = setup();

      await expect(service.preview('https://www.instagram.com/p/C1a2B3c4D5/')).rejects.toThrow(
        'Вставьте ссылку на профиль Instagram, а не на пост',
      );
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
    });

    it.each([
      ['not_connected', 'instagram_discovery_not_connected'],
      ['reconnect', 'instagram_discovery_reconnect'],
    ] as const)('returns code %s → %s so the dialog can offer Facebook login', async (reason, code) => {
      const { service } = setup({ infoError: new InstagramDiscoveryUnavailableError(reason) });

      const error = await service.preview('https://instagram.com/brand').catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({ message: new InstagramDiscoveryUnavailableError(reason).message, code });
    });

    it('says plainly when the profile is not a business account', async () => {
      const { service } = setup({ infoError: new InstagramProfileNotFoundError() });

      await expect(service.createFromLink('https://instagram.com/someone')).rejects.toThrow(
        'Аккаунт не найден или это не бизнес-аккаунт Instagram',
      );
    });

    it('treats the user\'s own connected account as already added', async () => {
      const own = { id: 'acc-own', externalId: '9001' };
      const existing = (where: any) => (where.externalId === '9001' ? own : null);

      const { service } = setup({ existing });
      expect((await service.preview('https://instagram.com/brand')).alreadyAdded).toBe(true);

      const { service: again, repo } = setup({ existing });
      await expect(again.createFromLink('https://instagram.com/brand')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
```

Add imports at the top: `import { InstagramDiscoveryUnavailableError, InstagramProfileNotFoundError } from '../connectors/instagram/instagram-discovery.errors';`.

`stats.service.spec.ts` — append inside the describe that contains the needsReconnect tests (after `'keeps needsReconnect false for a Telegram account with no credential row'`):

```ts
  it('keeps needsReconnect false for an Instagram competitor, which never has a credential row', async () => {
    const { service } = setup({
      account: { id: 'acc-c', name: 'Brand', platform: AccountPlatform.INSTAGRAM, type: AccountType.PUBLIC_NO_ACCESS, createdAt: new Date('2026-09-10T12:00:00Z') } as any,
      credential: null,
    });

    expect((await service.getAccountDetail('acc-c', period)).needsReconnect).toBe(false);
  });
```

(import `AccountType` alongside `AccountPlatform` if not already imported.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/accounts src/stats`
Expected: FAIL — Instagram links still rejected; competitor reported as needing reconnect.

- [ ] **Step 3: Implement**

`stats.service.ts` line ~122–125:

```ts
      // An own Instagram account cannot sync without its stored token, so a
      // missing row (e.g. removed by Meta's data-deletion callback) means
      // reconnect. Telegram accounts and Instagram competitors never have one.
      needsReconnect: credential
        ? credential.needsReconnect
        : account.platform === AccountPlatform.INSTAGRAM && account.type !== AccountType.PUBLIC_NO_ACCESS,
```

(import `AccountType`.)

`accounts.service.ts`:
- replace the `INSTAGRAM_NOT_BY_LINK` constant with:

```ts
const INSTAGRAM_NOT_A_PROFILE = 'Вставьте ссылку на профиль Instagram, а не на пост';
```

- imports: `isInstagramLink` from `./parse-account-link`; the two error classes from `'../connectors/instagram/instagram-discovery.errors'`.
- `resolveLink`:

```ts
  private resolveLink(link: string): { parsed: ParsedAccountLink; connector: SocialConnector } {
    const parsed = parseAccountLink(link);
    if (!parsed) {
      if (isInstagramLink(link)) throw new BadRequestException(INSTAGRAM_NOT_A_PROFILE);
      throw new BadRequestException(
        'Unsupported link. Paste a Telegram, Instagram, VK, YouTube or LinkedIn account URL.',
      );
    }

    try {
      return { parsed, connector: this.registry.get(parsed.platform) };
    } catch {
      throw new BadRequestException(`${parsed.platform} is not supported yet.`);
    }
  }
```

- add a draft helper and use it in **both** `preview` (replacing `const draft = { platform: ..., externalId: ... } as Account;`) and `createFromLink` (replacing `parsed as Account`):

```ts
  // Every account added by link is a competitor; the connector reads the type
  // to pick its access path (Instagram competitors go through Business Discovery).
  private draftOf(parsed: ParsedAccountLink): Account {
    return { platform: parsed.platform, externalId: parsed.externalId, type: AccountType.PUBLIC_NO_ACCESS } as Account;
  }

  /** An Instagram competitor lookup can reveal the user's own connected account under its numeric id. */
  private async matchesConnectedAccount(platform: AccountPlatform, info: AccountInfo): Promise<boolean> {
    if (!info.platformUserId) return false;
    return (await this.repo.findOneBy({ platform, externalId: info.platformUserId })) !== null;
  }
```

- `preview` return: `alreadyAdded: (await this.findExisting(parsed)) !== null || (await this.matchesConnectedAccount(parsed.platform, info)),`
- `createFromLink`: directly after the `try { info = await connector.getAccountInfo(this.draftOf(parsed)); } catch ...` block:

```ts
    if (await this.matchesConnectedAccount(parsed.platform, info)) throw new ConflictException(ALREADY_ADDED);
```

- `unresolvable` — map the discovery errors first:

```ts
  private unresolvable(platform: string, externalId: string, error: Error): BadRequestException {
    if (error instanceof InstagramDiscoveryUnavailableError) {
      const code = error.reason === 'not_connected' ? 'instagram_discovery_not_connected' : 'instagram_discovery_reconnect';
      return new BadRequestException({ message: error.message, code });
    }
    if (error instanceof InstagramProfileNotFoundError) return new BadRequestException(error.message);
    this.logger.warn(`Could not resolve ${platform} account ${externalId}: ${error.message}`);
    return new BadRequestException(`Couldn't add that account — ${platform} said: ${error.message}`);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest`
Expected: full backend suite PASS. If an older preview/createFromLink test asserts `getAccountInfo` was called with exactly `{ platform, externalId }`, it now also receives `type: 'public_no_access'` — loosen that assertion to `expect.objectContaining({ platform, externalId })`; do not change the behaviour.

- [ ] **Step 5: Commit**

```bash
git add backend/src/accounts backend/src/stats
git commit -m "Add Instagram competitors from a pasted profile link"
```

---

### Task 8: Add-account modal — «Аккаунт конкурента» / «Свой аккаунт»

**Files:**
- Modify: `frontend/src/components/AddAccountModal.tsx`
- Modify: `frontend/src/components/AddAccountModal.module.css`
- Test: `frontend/src/components/AddAccountModal.test.tsx`

**Interfaces:**
- Consumes: backend codes from Task 7; `GET /instagram/discovery/connect` → `{ redirectUrl }` (Task 5).
- Produces: `AddAccountModal` props `{ onClose; onCreated; initialError?: string | null }`.

- [ ] **Step 1: Write the failing tests** — in `AddAccountModal.test.tsx`:

1. Replace the whole `describe('Instagram tab', ...)` block with:

```ts
describe('Свой аккаунт tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows only the Instagram connect button, with no link field', () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Свой аккаунт' }));

    expect(screen.queryByLabelText('Ссылка на аккаунт')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить' })).toBeInTheDocument();
  });

  it('connects as an own account and navigates to the URL the backend returns', async () => {
    const originalLocation = window.location;
    (apiClient.get as any).mockResolvedValue({ data: { redirectUrl: 'https://www.instagram.com/oauth/authorize?state=abc' } });
    delete (window as any).location;
    (window as any).location = { href: '' };
    try {
      render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Свой аккаунт' }));
      fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

      await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/accounts/instagram/connect', { params: { type: 'own' } }));
      await waitFor(() => expect(window.location.href).toBe('https://www.instagram.com/oauth/authorize?state=abc'));
    } finally {
      (window as any).location = originalLocation;
    }
  });

  it('shows an error and stays on the modal when the backend call fails', async () => {
    (apiClient.get as any).mockRejectedValue({ response: { data: { message: 'Не удалось начать подключение' } } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Свой аккаунт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось начать подключение');
  });

  it('switching back to the competitor tab restores the link field', () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Свой аккаунт' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Аккаунт конкурента' }));

    expect(screen.getByLabelText('Ссылка на аккаунт')).toBeInTheDocument();
  });
});

describe('Instagram competitors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens on the competitor tab and says both networks are accepted', () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Аккаунт конкурента' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Вставьте ссылку на Telegram-канал или Instagram-аккаунт.')).toBeInTheDocument();
  });

  it('previews an Instagram competitor with the Instagram icon', async () => {
    (apiClient.post as any).mockResolvedValue({
      data: { platform: 'instagram', externalId: '@brand', name: 'Brand', followersCount: 5000, avatarDataUri: null, alreadyAdded: false },
    });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink('https://instagram.com/brand');

    expect(await screen.findByText('Brand')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'instagram' })).toBeInTheDocument();
  });

  it.each([
    ['instagram_discovery_not_connected', 'Подключить Facebook'],
    ['instagram_discovery_reconnect', 'Переподключить Facebook'],
  ])('offers Facebook login on %s', async (code, buttonName) => {
    (apiClient.post as any).mockRejectedValue({ response: { data: { message: 'server text', code } } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink('https://instagram.com/brand');

    expect(await screen.findByRole('button', { name: buttonName })).toBeInTheDocument();
    expect(screen.queryByText('Добавить')).not.toBeInTheDocument();
  });

  it('starts the Facebook login and navigates to it', async () => {
    const originalLocation = window.location;
    (apiClient.post as any).mockRejectedValue({ response: { data: { code: 'instagram_discovery_not_connected' } } });
    (apiClient.get as any).mockResolvedValue({ data: { redirectUrl: 'https://www.facebook.com/v23.0/dialog/oauth?state=s' } });
    delete (window as any).location;
    (window as any).location = { href: '' };
    try {
      render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

      pasteLink('https://instagram.com/brand');
      fireEvent.click(await screen.findByRole('button', { name: 'Подключить Facebook' }));

      await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/instagram/discovery/connect'));
      await waitFor(() => expect(window.location.href).toBe('https://www.facebook.com/v23.0/dialog/oauth?state=s'));
    } finally {
      (window as any).location = originalLocation;
    }
  });

  it('shows an error carried back from the Facebook login until the user types', () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} initialError="Вход через Facebook отменён" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Вход через Facebook отменён');

    fireEvent.change(screen.getByLabelText('Ссылка на аккаунт'), { target: { value: 'h' } });

    expect(screen.queryByText('Вход через Facebook отменён')).not.toBeInTheDocument();
  });
});
```

The pre-existing `describe('AddAccountModal', ...)` Telegram tests stay unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/AddAccountModal.test.tsx`
Expected: FAIL — no tab named «Аккаунт конкурента»/«Свой аккаунт»; no Facebook button.

- [ ] **Step 3: Implement** — replace `AddAccountModal.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import styles from './AddAccountModal.module.css';

interface AddAccountModalProps {
  onClose: () => void;
  onCreated: () => void;
  /** An error carried back in the URL from the Facebook login redirect. */
  initialError?: string | null;
}

interface AccountPreview {
  platform: string;
  externalId: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
  alreadyAdded: boolean;
}

type Tab = 'competitor' | 'own';
type FacebookPrompt = 'connect' | 'reconnect';

// Codes the backend sends when an Instagram competitor needs the Facebook login first.
const FACEBOOK_PROMPTS: Record<string, FacebookPrompt> = {
  instagram_discovery_not_connected: 'connect',
  instagram_discovery_reconnect: 'reconnect',
};

export function AddAccountModal({ onClose, onCreated, initialError = null }: AddAccountModalProps) {
  const [tab, setTab] = useState<Tab>('competitor');

  // --- Competitor tab: one link field for every network the backend can read ---
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialError);
  const [facebookPrompt, setFacebookPrompt] = useState<FacebookPrompt | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (tab !== 'competitor') return;
    const trimmed = link.trim();
    setPreview(null);
    setError(null);
    setFacebookPrompt(null);
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
          if (cancelled) return;
          const prompt = FACEBOOK_PROMPTS[err.response?.data?.code];
          if (prompt) setFacebookPrompt(prompt);
          else setError(err.response?.data?.message ?? 'Не удалось найти аккаунт');
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, tab]);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    try {
      await apiClient.post('/accounts/from-link', { link: link.trim() });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить аккаунт');
    } finally {
      setAdding(false);
    }
  }

  // --- Redirect-based logins (Facebook for competitors, Instagram for own accounts) ---
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function startLogin(request: () => Promise<{ data: { redirectUrl: string } }>) {
    setConnecting(true);
    setConnectError(null);
    try {
      const { data } = await request();
      // Full-page navigation: the login screen is outside the SPA, and the
      // callback brings the browser back into the app once done.
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setConnectError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setConnecting(false);
    }
  }

  const connectFacebook = () => startLogin(() => apiClient.get('/instagram/discovery/connect'));
  // Always 'own' until the own/client split is used somewhere in the app.
  const connectInstagram = () => startLogin(() => apiClient.get('/accounts/instagram/connect', { params: { type: 'own' } }));

  const shownError = error ?? connectError ?? notice;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавьте аккаунт" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавьте аккаунт</h2>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'competitor'}
            className={tab === 'competitor' ? styles.tabActive : styles.tab}
            onClick={() => setTab('competitor')}
          >
            Аккаунт конкурента
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'own'}
            className={tab === 'own' ? styles.tabActive : styles.tab}
            onClick={() => setTab('own')}
          >
            Свой аккаунт
          </button>
        </div>

        {tab === 'competitor' ? (
          <>
            <p className={styles.helperText}>Вставьте ссылку на Telegram-канал или Instagram-аккаунт.</p>

            <label className={styles.label} htmlFor="account-link">
              Ссылка на аккаунт
            </label>
            <input
              id="account-link"
              className={styles.input}
              placeholder="https://t.me/channel или https://instagram.com/brand"
              value={link}
              onChange={(e) => {
                setNotice(null);
                setLink(e.target.value);
              }}
            />

            {resolving && <p className={styles.resolving}>Проверяем…</p>}

            {shownError && (
              <p className={styles.error} role="alert">
                {shownError}
              </p>
            )}

            {facebookPrompt && (
              <div className={styles.facebookPrompt}>
                <p className={styles.helperText}>
                  {facebookPrompt === 'connect'
                    ? 'Чтобы добавлять конкурентов из Instagram, один раз подключите Facebook — страницу, к которой привязан ваш профессиональный аккаунт Instagram.'
                    : 'Доступ к Facebook истёк — переподключите его, чтобы добавлять конкурентов из Instagram.'}
                </p>
                <button type="button" className={styles.connectButton} onClick={connectFacebook} disabled={connecting}>
                  {connecting ? 'Переходим…' : facebookPrompt === 'connect' ? 'Подключить Facebook' : 'Переподключить Facebook'}
                </button>
              </div>
            )}

            {preview && (
              <div className={styles.preview}>
                {preview.avatarDataUri ? (
                  <img className={styles.avatar} src={preview.avatarDataUri} alt={preview.name} />
                ) : (
                  <div className={styles.avatarFallback} aria-hidden="true" />
                )}
                <div className={styles.previewText}>
                  <div className={styles.previewName}>
                    <PlatformIcon platform={preview.platform} />
                    {preview.name}
                  </div>
                  <div className={styles.previewFollowers}>
                    <span className={styles.previewCount}>{preview.followersCount}</span> подписчиков
                  </div>
                  {preview.alreadyAdded && <p className={styles.duplicate}>Этот аккаунт уже добавлен</p>}
                </div>
                <button
                  type="button"
                  className={styles.submit}
                  onClick={handleAdd}
                  disabled={adding || preview.alreadyAdded}
                >
                  Добавить
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className={styles.helperText}>
              Потребуется войти в Instagram владельцу аккаунта. Мы не увидим и не сохраним его пароль.
            </p>

            {connectError && (
              <p className={styles.error} role="alert">
                {connectError}
              </p>
            )}

            <button type="button" className={styles.connectButton} onClick={connectInstagram} disabled={connecting}>
              {connecting ? 'Переходим…' : 'Подключить'}
            </button>
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
```

`AddAccountModal.module.css` — append:

```css
.facebookPrompt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-top: 12px;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/AddAccountModal.test.tsx`
Expected: PASS (old Telegram tests and the new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AddAccountModal.tsx frontend/src/components/AddAccountModal.module.css frontend/src/components/AddAccountModal.test.tsx
git commit -m "One link field for Telegram and Instagram competitors in the add dialog"
```

---

### Task 9: Reopen the dialog after the Facebook login; deploy notes

**Files:**
- Modify: `frontend/src/pages/OverviewPage.tsx`
- Test: `frontend/src/pages/OverviewPage.test.tsx`

**Interfaces:**
- Consumes: callback redirect `/?add=competitor[&discoveryError=...]` (Task 5); `AddAccountModal` prop `initialError` (Task 8).

- [ ] **Step 1: Write the failing tests** — append to `OverviewPage.test.tsx` (it already wraps renders in `MemoryRouter` and mocks `apiClient`; reuse its existing mock setup for `/stats/overview` returning `[]`):

```tsx
  it('reopens the add dialog when the Facebook login sends the user back', async () => {
    render(<MemoryRouter initialEntries={['/?add=competitor']}><OverviewPage /></MemoryRouter>);

    expect(await screen.findByRole('dialog', { name: 'Добавьте аккаунт' })).toBeInTheDocument();
  });

  it('shows the error the Facebook login came back with', async () => {
    const entry = `/?add=competitor&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`;
    render(<MemoryRouter initialEntries={[entry]}><OverviewPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Вход через Facebook отменён');
  });

  it('does not open the dialog on a plain visit', async () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    await screen.findByText(/No accounts yet|Loading/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/OverviewPage.test.tsx`
Expected: FAIL — no dialog opened from the URL.

- [ ] **Step 3: Implement** — `OverviewPage.tsx`:

```tsx
import { useSearchParams } from 'react-router-dom';
```

replace `const [isAdding, setIsAdding] = useState(false);` with:

```tsx
  // The Facebook login (for Instagram competitors) redirects back to /?add=competitor,
  // optionally with the error it failed with; reopen the dialog where the user left it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [isAdding, setIsAdding] = useState(searchParams.get('add') === 'competitor');
  const [addError] = useState(searchParams.get('discoveryError'));

  useEffect(() => {
    // Drop the params so a reload or a later visit does not reopen the dialog.
    if (searchParams.has('add') || searchParams.has('discoveryError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

and render the modal with `initialError={addError}`:

```tsx
      {isAdding && <AddAccountModal onClose={() => setIsAdding(false)} onCreated={handleCreated} initialError={addError} />}
```

- [ ] **Step 4: Run all checks**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`
Run: `cd backend && npx jest && npm run build && npm run lint`
Expected: all PASS / no errors. (If `npm run lint` does not exist in a package, skip it for that package.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/OverviewPage.tsx frontend/src/pages/OverviewPage.test.tsx
git commit -m "Reopen the add dialog after the Facebook login"
```

- [ ] **Step 6: Hand the user the deploy checklist** (in the PR description and in chat):
  1. Meta app → add use case «Instagram API with Facebook Login» (Facebook Login for Business); in its Facebook Login settings add the OAuth redirect URI `https://fdagency.duckdns.org/api/instagram/discovery/callback`.
  2. On the VPS `.env`: `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` from *App settings → Basic* (not the Instagram app id), `FACEBOOK_REDIRECT_URI` as above; `FACEBOOK_LOGIN_CONFIG_ID` only if Task 0 showed the dialog needs it.
  3. Redeploy from master and run migrations (`1789800000000-AddInstagramDiscovery`).
  4. Run the Task 0 checks; report results so views / Page token / error codes can be adjusted.
