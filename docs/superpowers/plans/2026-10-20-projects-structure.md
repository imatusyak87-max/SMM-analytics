# Projects Structure and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the app into a project-centred hub: home page, «Все проекты», «Добавить проект» form, tile-based project page, guide, Instagram «Подключить полный доступ», and no Compare.

**Architecture:** A project is the existing `profiles` row (code/API keep the name `profile`; UI says «проект»). The backend gains project create/delete/add-account endpoints on `ProfilesController`, a per-account Instagram login (upgrade or reconnect) carried through the OAuth state, and stops deleting empty projects. The frontend gets new routes and pages; account creation moves from a single-link dialog to a project form and per-network tiles.

**Tech Stack:** NestJS 11 + TypeORM + Postgres (backend, jest); React 19 + Vite + react-router 7 + CSS modules (frontend, vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-20-projects-structure-design.md`

## Global Constraints

- All user-facing text is Russian. On screen «профиль» → «проект». Code, DB tables and API paths keep `profile`.
- Backend checks: `npx jest <path>`, `npm run build`, `npx tsc --noEmit -p tsconfig.json`. **Never run backend `npm run lint`** (it is `eslint --fix` and rewrites the repo).
- Frontend checks: `npx vitest run <path>`, `npx tsc -b`, `npm run build`. In tests use `vi.clearAllMocks()` in `beforeEach`, never `mockReset` (breaks `mockRejectedValue`).
- Network order everywhere: Instagram, Telegram, ВКонтакте, YouTube.
- Link examples (exact): Instagram `https://instagram.com/brand`, Telegram `https://t.me/channel`, ВКонтакте `https://vk.com/brand`, YouTube `https://youtube.com/@brand`.
- Project name max length 100 (same cap as rename).
- One migration only: nullable `accountId uuid` on `instagram_oauth_states`.
- Commit after every task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch: `projects-structure`.

## File map

Backend
- `src/db/migrations/1790000000000-AddOauthStateAccount.ts` — new migration.
- `src/db/entities/instagram-oauth-state.entity.ts` — `accountId` column.
- `src/connectors/instagram/instagram-oauth-state.service.ts` — `create(type, accountId)`, `consume` returns `{ type, accountId }`.
- `src/connectors/instagram/instagram-discovery-oauth.service.ts` — adapt to new `consume` shape.
- `src/connectors/instagram/instagram-oauth.service.ts` — per-account login (upgrade/reconnect), `InstagramLoginError`.
- `src/connectors/instagram/instagram-oauth.controller.ts` — redirect with `instagramError` on failure.
- `src/connectors/instagram/instagram-discovery.controller.ts` — redirect to `/projects?add=project`.
- `src/accounts/platform-names.ts` — new, Russian network names.
- `src/accounts/accounts.service.ts` — expected-platform check, one-per-network, duplicate message names the project, Russian errors, empty projects kept.
- `src/accounts/accounts.controller.ts` — `GET :id/instagram/connect`; remove `GET instagram/connect`.
- `src/profiles/dto/create-project.dto.ts` — new.
- `src/profiles/profiles.service.ts` / `profiles.controller.ts` / `profiles.module.ts` — create, add account, delete; list includes empty projects.

Frontend
- `src/App.tsx` — routes.
- `src/components/Layout.tsx` — brand, nav, «Выйти».
- `src/pages/HomePage.tsx`, `src/pages/GuidePage.tsx`, `src/pages/LegacyProfileRedirect.tsx` — new.
- `src/pages/ComparePage.*`, `src/components/CompareTable.*` — deleted.
- `src/components/LinkField.tsx` — new: one network's link input with live preview + Facebook prompt.
- `src/components/AddProjectModal.tsx` (+ css, test) — replaces `AddAccountModal.*`.
- `src/pages/ProjectsPage.tsx` (+ css, test) — renamed from `OverviewPage.*`.
- `src/components/ProfileCard.tsx`, `src/profiles.ts` — empty projects, always link to `/projects/:id`.
- `src/pages/ProjectPage.tsx` (+ css, test) — renamed from `ProfilePage.*`, tiles.
- `src/components/NetworkTile.tsx`, `src/components/AddAccountDialog.tsx` (+ css, tests) — new.
- `src/components/AccountCard.*` — deleted (only the old profile page used it).
- `src/pages/AccountDetailPage.tsx` — full-access block, reconnect endpoint, `instagramError`, project breadcrumb.
- `src/components/ProfileSwitcher.tsx` — «Проект» wording.

---

### Task 1: OAuth state remembers the target account

**Files:**
- Create: `backend/src/db/migrations/1790000000000-AddOauthStateAccount.ts`
- Modify: `backend/src/db/entities/instagram-oauth-state.entity.ts`
- Modify: `backend/src/connectors/instagram/instagram-oauth-state.service.ts`
- Modify: `backend/src/connectors/instagram/instagram-discovery-oauth.service.ts` (the `consume` call near line 39)
- Test: `backend/src/connectors/instagram/instagram-oauth-state.service.spec.ts`, `backend/src/connectors/instagram/instagram-discovery-oauth.service.spec.ts`, `backend/src/connectors/instagram/instagram-oauth.service.spec.ts` (mock shape only)

**Interfaces:**
- Produces: `InstagramOauthStateService.create(type: InstagramAccountKind, accountId?: string | null): Promise<string>`; `consume(id: string): Promise<ConsumedState | null>` where `export interface ConsumedState { type: InstagramAccountKind; accountId: string | null }` (exported from the state service file).

- [ ] **Step 1: Write the failing tests** — in `instagram-oauth-state.service.spec.ts`, replace the create and consume expectations:

```ts
  it('creates a state row carrying the requested type and target account', async () => {
    const { service, repo } = setup();
    const id = await service.create(InstagramAccountKind.OWN, 'acc-1');
    expect(repo.save).toHaveBeenCalledWith({ id, type: InstagramAccountKind.OWN, accountId: 'acc-1' });
  });

  it('stores no account for a login that is not tied to one', async () => {
    const { service, repo } = setup();
    const id = await service.create(InstagramAccountKind.DISCOVERY);
    expect(repo.save).toHaveBeenCalledWith({ id, type: InstagramAccountKind.DISCOVERY, accountId: null });
  });
```

and in the "consumes a fresh state atomically" test make the mocked delete-returning row `{ type: 'own', accountId: 'acc-1', createdAt: new Date() }`, assert `.returning(['type', 'accountId', 'createdAt'])`, and expect `{ type: InstagramAccountKind.OWN, accountId: 'acc-1' }`. (Read the file's existing `setup()`/query-builder mock first and keep its names; adapt only the expectations.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth-state.service.spec.ts`
Expected: FAIL — save called without `accountId`, consume returns a string.

- [ ] **Step 3: Implement**

Entity — add after `type`:
```ts
  /** Set when the login is for one existing account (full-access upgrade or reconnect). */
  @Column({ type: 'uuid', nullable: true }) accountId: string | null;
```

Migration:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** An Instagram login can now target one existing account (upgrade to full access, or reconnect). */
export class AddOauthStateAccount1790000000000 implements MigrationInterface {
  name = 'AddOauthStateAccount1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instagram_oauth_states" ADD "accountId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instagram_oauth_states" DROP COLUMN "accountId"`);
  }
}
```

State service:
```ts
export interface ConsumedState {
  type: InstagramAccountKind;
  accountId: string | null;
}

  async create(type: InstagramAccountKind, accountId: string | null = null): Promise<string> {
    const id = randomUUID();
    await this.repo.save({ id, type, accountId });
    return id;
  }

  async consume(id: string): Promise<ConsumedState | null> {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;

    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(InstagramOauthState)
      .where('id = :id', { id })
      .returning(['type', 'accountId', 'createdAt'])
      .execute();
    const row = (result.raw as Array<{ type: InstagramAccountKind; accountId: string | null; createdAt: Date | string }> | undefined)?.[0];
    if (!row) return null;

    const age = Date.now() - new Date(row.createdAt).getTime();
    return age <= STATE_TTL_MS ? { type: row.type, accountId: row.accountId ?? null } : null;
  }
```
(Keep the existing doc comment on `consume`.)

Discovery OAuth service: replace `const kind = await this.stateService.consume(state);` with
```ts
    const kind = (await this.stateService.consume(state))?.type ?? null;
```
In `instagram-discovery-oauth.service.spec.ts` and `instagram-oauth.service.spec.ts`, change every `consume.mockResolvedValue(InstagramAccountKind.X)` to `consume.mockResolvedValue({ type: InstagramAccountKind.X, accountId: null })` (leave `null` mocks as they are). `instagram-oauth.service.spec.ts` is rewritten in Task 2; this only keeps it compiling.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/connectors/instagram && npx tsc --noEmit -p tsconfig.json`
Expected: state + discovery specs PASS; `instagram-oauth.service.spec.ts` may fail only on its create-account tests (rewritten in Task 2) — acceptable here, nothing else fails; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "Let an Instagram login state carry the account it is for"
```

---

### Task 2: Per-account Instagram login (full-access upgrade and reconnect)

**Files:**
- Modify: `backend/src/connectors/instagram/instagram-oauth.service.ts`
- Modify: `backend/src/connectors/instagram/instagram-oauth.controller.ts`
- Modify: `backend/src/accounts/accounts.controller.ts`
- Test: `backend/src/connectors/instagram/instagram-oauth.service.spec.ts`, `backend/src/connectors/instagram/instagram-oauth.controller.spec.ts`, `backend/src/accounts/accounts.controller.spec.ts`

**Interfaces:**
- Consumes: `ConsumedState` (Task 1).
- Produces: `InstagramOauthService.buildAuthorizeUrlForAccount(account: Account): Promise<string>`; `completeLogin(code, state): Promise<Account>` throws `InstagramLoginError` (`message`, `accountId: string`) for any failure once the target account is known; `GET /accounts/:id/instagram/connect` → `{ redirectUrl: string }`. `GET /accounts/instagram/connect` no longer exists. Callback redirects to `/accounts/:id` on success or `/accounts/:id?instagramError=<encoded>` on `InstagramLoginError`.

- [ ] **Step 1: Write the failing service tests** — replace the body of `instagram-oauth.service.spec.ts` from `describe('InstagramOauthService.buildAuthorizeUrl'` onward (keep `makeDeps`, but add `findOneBy` results per test and `update` on `em`):

In `makeDeps`, extend `em` with `update: jest.fn()` and make `accountsRepo.manager.transaction` hand out that `em`. Then:

```ts
const PUBLIC_ACCOUNT = { id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '@coffee_lab', type: AccountType.PUBLIC_NO_ACCESS, name: 'Coffee', avatarUrl: null, profileId: 'p1' };
const OWN_ACCOUNT = { ...PUBLIC_ACCOUNT, externalId: '17841400000000000', type: AccountType.OWN };

function loginAs(api: any, username: string, id = '17841400000000000') {
  api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short', instagramUserId: id });
  api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long', expiresInSeconds: 5184000 });
  api.getProfile.mockResolvedValue({ id, username, name: 'Coffee Lab', profilePictureUrl: 'https://cdn/a.jpg', biography: null });
}

describe('InstagramOauthService.buildAuthorizeUrlForAccount', () => {
  it('creates a state tied to the account and embeds it in the URL', async () => {
    const { service, stateService } = makeDeps();
    const url = await service.buildAuthorizeUrlForAccount(PUBLIC_ACCOUNT as any);
    expect(stateService.create).toHaveBeenCalledWith(InstagramAccountKind.OWN, 'acc-1');
    expect(url).toContain('state=a-state-id');
  });

  it('refuses an account that is not on Instagram', async () => {
    const { service } = makeDeps();
    await expect(service.buildAuthorizeUrlForAccount({ ...PUBLIC_ACCOUNT, platform: AccountPlatform.TELEGRAM } as any))
      .rejects.toThrow('Полный доступ есть только для Instagram');
  });
});

describe('InstagramOauthService.completeLogin', () => {
  it('rejects a missing or expired state before calling Instagram at all', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue(null);
    await expect(service.completeLogin('c', 's')).rejects.toThrow('Ссылка для входа устарела, попробуйте подключить аккаунт заново');
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('refuses a state that is not tied to an account', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: null });
    await expect(service.completeLogin('c', 's')).rejects.toThrow('Ссылка для входа устарела');
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('refuses a state that was issued for the Facebook discovery login', async () => {
    const { service, stateService } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.DISCOVERY, accountId: 'acc-1' });
    await expect(service.completeLogin('c', 's')).rejects.toThrow('Ссылка для входа устарела');
  });

  it('upgrades a public account to full access when the same username logs in', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockImplementation(({ id }: any) => Promise.resolve(id === 'acc-1' ? PUBLIC_ACCOUNT : null));
    loginAs(api, 'Coffee_Lab');

    const account = await service.completeLogin('c', 's');

    expect(em.update).toHaveBeenCalledWith(Account, { id: 'acc-1' }, {
      type: AccountType.OWN, externalId: '17841400000000000', name: 'Coffee Lab', avatarUrl: 'https://cdn/a.jpg',
    });
    expect(credentialsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', needsReconnect: false }));
    expect(credentialsRepo.save.mock.calls[0][0].encryptedToken).not.toContain('long');
    expect(account).toMatchObject({ id: 'acc-1', type: AccountType.OWN });
  });

  it('refuses a different Instagram account and changes nothing', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(PUBLIC_ACCOUNT);
    loginAs(api, 'someone_else');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      accountId: 'acc-1',
      message: 'Вы вошли в другой аккаунт Instagram (@someone_else), а проект ждёт @coffee_lab',
    });
    expect(em.update).not.toHaveBeenCalled();
    expect(credentialsRepo.save).not.toHaveBeenCalled();
  });

  it('refuses the upgrade when that Instagram id is already a separate account', async () => {
    const { service, stateService, api, accountsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockImplementation(({ id, externalId }: any) =>
      Promise.resolve(id === 'acc-1' ? PUBLIC_ACCOUNT : externalId === '17841400000000000' ? { id: 'acc-9' } : null));
    loginAs(api, 'coffee_lab');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({ accountId: 'acc-1' });
    expect(em.update).not.toHaveBeenCalled();
  });

  it('reconnects an own account when the same Instagram id logs in', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(OWN_ACCOUNT);
    loginAs(api, 'coffee_lab');

    await service.completeLogin('c', 's');

    expect(em.update).toHaveBeenCalledWith(Account, { id: 'acc-1' }, expect.objectContaining({ type: AccountType.OWN }));
    expect(credentialsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', needsReconnect: false }));
  });

  it('refuses a reconnect from a different Instagram id', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(OWN_ACCOUNT);
    loginAs(api, 'other', '999');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      accountId: 'acc-1', message: 'Вы вошли в другой аккаунт Instagram (@other)',
    });
  });

  it('reports a failed Instagram call against the account, in Russian', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(PUBLIC_ACCOUNT);
    api.exchangeCodeForToken.mockRejectedValue({ response: { status: 400, data: { error_message: 'bad code' } } });

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({ accountId: 'acc-1' });
  });
});
```

Make `credentialsRepo.save` assertion work by routing `em.save(AccountCredential, row)` to `credentialsRepo.save(row)` (already in `makeDeps`).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/connectors/instagram/instagram-oauth.service.spec.ts`
Expected: FAIL — `buildAuthorizeUrlForAccount` is not a function; create-path behaviour.

- [ ] **Step 3: Implement the service** — in `instagram-oauth.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
// remove: import { createProfile } from '../../profiles/profile-store';

const EXPIRED = 'Ссылка для входа устарела, попробуйте подключить аккаунт заново';

/** A login for a known account failed; the callback sends the user back to that account with the message. */
export class InstagramLoginError extends Error {
  constructor(message: string, readonly accountId: string) {
    super(message);
  }
}
```

Replace `buildAuthorizeUrl` and `completeLogin`:

```ts
  async buildAuthorizeUrlForAccount(account: Account): Promise<string> {
    if (account.platform !== AccountPlatform.INSTAGRAM) {
      throw new BadRequestException('Полный доступ есть только для Instagram');
    }
    const state = await this.stateService.create(InstagramAccountKind.OWN, account.id);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Every login is for one existing account: a public one (added by link) is
   * upgraded to full access, an own one is reconnected. The logged-in Instagram
   * account must be that account, or nothing changes.
   */
  async completeLogin(code: string, state: string): Promise<Account> {
    const consumed = await this.stateService.consume(state);
    if (!consumed || consumed.type === InstagramAccountKind.DISCOVERY || !consumed.accountId) throw new Error(EXPIRED);

    const account = await this.accountsRepo.findOneBy({ id: consumed.accountId });
    if (!account) throw new Error('Аккаунт больше не существует');

    let longLivedToken: string, expiresInSeconds: number;
    let profile: InstagramProfile;
    try {
      const { accessToken: shortLivedToken } = await this.api.exchangeCodeForToken(code);
      ({ accessToken: longLivedToken, expiresInSeconds } = await this.api.exchangeForLongLivedToken(shortLivedToken));
      profile = await this.api.getProfile(longLivedToken);
    } catch (error) {
      throw new InstagramLoginError(translateInstagramError(error).message, account.id);
    }

    if (!profile.id) throw new InstagramLoginError('Instagram не вернул идентификатор аккаунта, попробуйте подключить заново', account.id);
    // /me returns the id as a string; the token response's numeric user_id can lose precision.
    const instagramUserId = String(profile.id);

    if (account.type === AccountType.PUBLIC_NO_ACCESS) {
      const expected = account.externalId.replace(/^@/, '').toLowerCase();
      if (profile.username.toLowerCase() !== expected) {
        throw new InstagramLoginError(
          `Вы вошли в другой аккаунт Instagram (@${profile.username}), а проект ждёт @${expected}`,
          account.id,
        );
      }
      const clash = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: instagramUserId });
      if (clash && clash.id !== account.id) {
        throw new InstagramLoginError('Этот аккаунт Instagram уже подключён отдельно — удалите дубликат и попробуйте снова', account.id);
      }
    } else if (account.externalId !== instagramUserId) {
      throw new InstagramLoginError(`Вы вошли в другой аккаунт Instagram (@${profile.username})`, account.id);
    }

    const encryptedToken = encryptToken(longLivedToken, this.encryptionKey);
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    // Own accounts are keyed by the numeric id (deauthorize, data-deletion and
    // dedup all look them up that way), so an upgrade switches to it.
    const changes = {
      type: account.type === AccountType.PUBLIC_NO_ACCESS ? AccountType.OWN : account.type,
      externalId: instagramUserId,
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
    };
    await this.accountsRepo.manager.transaction(async (em) => {
      await em.update(Account, { id: account.id }, changes);
      // save() upserts on accountId: it re-creates a credential the data-deletion webhook removed.
      await em.save(AccountCredential, { accountId: account.id, encryptedToken, tokenExpiresAt, needsReconnect: false });
    });
    return { ...account, ...changes };
  }
```

- [ ] **Step 4: Write the failing controller tests**

`instagram-oauth.controller.spec.ts` — add (keep the others; the 400 test stays for errors without an account):
```ts
  it('sends the user back to the account with the message when a login for it fails', async () => {
    const oauth = { completeLogin: jest.fn().mockRejectedValue(new InstagramLoginError('Вы вошли в другой аккаунт Instagram (@x)', 'acc-1')) };
    const { controller, res, syncJobs } = setup(oauth);   // use the file's existing construction helper/pattern
    await controller.callback('c', 's', res);
    expect(res.redirect).toHaveBeenCalledWith(`/accounts/acc-1?instagramError=${encodeURIComponent('Вы вошли в другой аккаунт Instagram (@x)')}`);
    expect(syncJobs.createManual).not.toHaveBeenCalled();
  });
```
(Read the spec file first and build the controller the same way its existing tests do; import `InstagramLoginError` from `./instagram-oauth.service`.)

`accounts.controller.spec.ts` — add:
```ts
  it('starts an Instagram login for one account', async () => {
    const account = { id: 'acc-1' };
    const service = { findOne: jest.fn().mockResolvedValue(account) } as any;
    const oauth = { buildAuthorizeUrlForAccount: jest.fn().mockResolvedValue('https://ig/login') } as any;
    const controller = new AccountsController(service, oauth);

    expect(await controller.connectInstagram('acc-1')).toEqual({ redirectUrl: 'https://ig/login' });
    expect(oauth.buildAuthorizeUrlForAccount).toHaveBeenCalledWith(account);
  });
```
Delete any existing test of the old `connectInstagram(type)`.

- [ ] **Step 5: Implement controllers**

`instagram-oauth.controller.ts` callback catch block:
```ts
    } catch (error) {
      if (error instanceof InstagramLoginError) {
        res.redirect(`/accounts/${error.accountId}?instagramError=${encodeURIComponent(error.message)}`);
        return;
      }
      res.status(400).json({ message: (error as Error).message });
      return;
    }
```
(import `InstagramLoginError` from `./instagram-oauth.service`.)

`accounts.controller.ts` — remove the `instagram/connect` handler and the `InstagramAccountKind` import; add:
```ts
  @Get(':id/instagram/connect')
  async connectInstagram(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) id: string) {
    const account = await this.accountsService.findOne(id);
    return { redirectUrl: await this.instagramOauth.buildAuthorizeUrlForAccount(account) };
  }
```
(import `HttpStatus`, `ParseUUIDPipe` from `@nestjs/common`.)

- [ ] **Step 6: Run to verify pass**

Run: `cd backend && npx jest src/connectors/instagram src/accounts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean. If any other file still calls `buildAuthorizeUrl(` (grep), it must be removed — the generic method is gone.

- [ ] **Step 7: Commit**

```bash
git add backend/src
git commit -m "Instagram login targets one account: upgrade a linked account to full access, or reconnect"
```

---

### Task 3: Projects outlive their accounts; delete a project

**Files:**
- Modify: `backend/src/accounts/accounts.service.ts` (`remove`)
- Modify: `backend/src/profiles/profiles.service.ts`, `profiles.controller.ts`, `profiles.module.ts`
- Test: `backend/src/accounts/accounts.service.spec.ts`, `backend/src/profiles/profiles.service.spec.ts`, `backend/src/profiles/profiles.controller.spec.ts`

**Interfaces:**
- Produces: `ProfilesService` constructor `(profilesRepo, accountsRepo, stats, accounts: AccountsService)`; `ProfilesService.remove(id: string): Promise<void>`; `DELETE /profiles/:id`; `GET /profiles` includes projects with `accounts: []`.

- [ ] **Step 1: Write the failing tests**

`accounts.service.spec.ts` — replace `it('deletes the profile the account leaves empty'…)` with:
```ts
    it('keeps the project the account leaves, even when it is now empty', async () => {
      const { repo, em } = makeRepoWithTransaction({ id: 'acc-1', profileId: 'p1' });
      em.count.mockResolvedValue(0);
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await service.remove('acc-1');

      expect(em.delete).not.toHaveBeenCalledWith(Profile, expect.anything());
    });
```

`profiles.service.spec.ts` — in `setup()` add `accounts = { remove: jest.fn(), createFromLink: jest.fn() }`, `accountsRepo.find = jest.fn().mockResolvedValue(projectAccounts)` (param `projectAccounts = [{ id: 'a2' }, { id: 'a3' }]`), `profilesRepo.delete = jest.fn()`, construct `new ProfilesService(profilesRepo, accountsRepo, stats, accounts as any)` and return `accounts`. Then replace the test asserting that a profile with only inactive accounts is hidden with:
```ts
  it('lists every project, including one with no accounts', async () => {
    const { service } = setup();
    const list = await service.list();
    expect(list.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(list[2].accounts).toEqual([]);
  });

  it('deletes a project with every account in it', async () => {
    const { service, accounts, profilesRepo } = setup();
    await service.remove('p2');
    expect(accounts.remove).toHaveBeenCalledWith('a2');
    expect(accounts.remove).toHaveBeenCalledWith('a3');
    expect(profilesRepo.delete).toHaveBeenCalledWith({ id: 'p2' });
  });

  it('answers 404 for deleting an unknown project', async () => {
    const { service, accounts } = setup();
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.remove).not.toHaveBeenCalled();
  });
```
(Return `profilesRepo` from `setup()` if it is not already returned.)

`profiles.controller.spec.ts` — add:
```ts
  it('deletes a project', async () => {
    const service = { remove: jest.fn().mockResolvedValue(undefined) } as any;
    await new ProfilesController(service).remove('p1');
    expect(service.remove).toHaveBeenCalledWith('p1');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/accounts/accounts.service.spec.ts src/profiles`
Expected: FAIL (profile still deleted; `remove` missing; empty project filtered out).

- [ ] **Step 3: Implement**

`accounts.service.ts` `remove`: delete the line `await deleteProfileIfEmpty(em, account.profileId);` and drop `deleteProfileIfEmpty` from the import. `findOne` is still needed for the 404.

`profiles.service.ts`:
```ts
import { AccountsService } from '../accounts/accounts.service';
...
  constructor(
    @InjectRepository(Profile) private profilesRepo: Repository<Profile>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    private stats: StatsService,
    private accounts: AccountsService,
  ) {}

  async list(): Promise<ProfileSummary[]> {
    const [profiles, items] = await Promise.all([
      this.profilesRepo.find({ order: { createdAt: 'ASC' } }),
      this.stats.getOverview(),
    ]);
    // Empty projects are listed too: a project lives until it is deleted.
    return profiles.map((profile) =>
      toProfileSummary(profile, items.filter((item) => item.account.profileId === profile.id)),
    );
  }

  /** Deletes the project and, through the normal account delete, all its data. */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const accounts = await this.accountsRepo.find({ where: { profileId: id } });
    for (const account of accounts) await this.accounts.remove(account.id);
    await this.profilesRepo.delete({ id });
  }
```

`profiles.controller.ts`:
```ts
  @Delete('profiles/:id')
  remove(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) id: string) {
    return this.profilesService.remove(id);
  }
```
(import `Delete`.)

`profiles.module.ts`: add `AccountsModule` to `imports` (it already exports `AccountsService`).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/accounts src/profiles && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean. Also run `npx jest src/app` or the whole suite if a module-wiring spec exists (`npx jest -t module`) — Nest DI must still resolve.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "Keep projects when their last account goes; add project delete"
```

---

### Task 4: Adding an account into a project — network check, one per network, Russian errors

**Files:**
- Create: `backend/src/accounts/platform-names.ts`
- Modify: `backend/src/accounts/accounts.service.ts`
- Test: `backend/src/accounts/accounts.service.spec.ts`

**Interfaces:**
- Produces: `PLATFORM_NAMES: Record<AccountPlatform, string>`; `AccountsService.createFromLink(link: string, profileId?: string, expected?: AccountPlatform): Promise<Account>`.
- Error messages (exact): wrong network `Это ссылка не на ${name}`; network taken `В проекте уже есть ${name}`; duplicate `Этот аккаунт уже в проекте «${projectName}»` (fallback `Этот аккаунт уже добавлен`); unparseable `Не удалось распознать ссылку. Вставьте ссылку на аккаунт, например https://t.me/channel`; no connector `${name} пока не поддерживается`; platform failure `Не удалось проверить аккаунт: ${error.message}`.

- [ ] **Step 1: Write the failing tests** — add to `accounts.service.spec.ts` (inside `describe('createFromLink'…)`):

```ts
    it('refuses a link for another network than the field it was typed into', async () => {
      const repo = makeRepo();
      const connector = { getAccountInfo: jest.fn() };
      const service = new AccountsService(repo, { get: jest.fn(() => connector) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://instagram.com/brand', 'prof-1', AccountPlatform.TELEGRAM))
        .rejects.toThrow('Это ссылка не на Telegram');
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
    });

    it('refuses a second account of the same network in one project', async () => {
      const repo = makeRepo();
      repo.findOneBy.mockImplementation((where: any) => Promise.resolve(where.profileId ? { id: 'acc-tg' } : null));
      const service = new AccountsService(repo, { get: jest.fn(() => ({ getAccountInfo: jest.fn() })) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toThrow('В проекте уже есть Telegram');
    });

    it('names the project an already added account belongs to', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'acc-1', profileId: 'prof-7' });
      repo.manager.findOneBy.mockResolvedValue({ id: 'prof-7', name: 'Мезопроф' });
      const service = new AccountsService(repo, { get: jest.fn(() => ({})) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel')).rejects.toThrow('Этот аккаунт уже в проекте «Мезопроф»');
    });
```

Update existing expectations to the new Russian texts: "rejects a link that is not a recognised platform URL" → `'Не удалось распознать ссылку. Вставьте ссылку на аккаунт, например https://t.me/channel'`; "rejects a platform that has no connector registered yet" → e.g. `'ВКонтакте пока не поддерживается'` (match the platform that test uses); "surfaces why the platform rejected the account" → `` `Не удалось проверить аккаунт: ${theErrorMessage}` ``; duplicate tests that expect `'Этот аккаунт уже добавлен'` keep passing only if `repo.manager.findOneBy` returns null for the profile — set it so in those tests (`repo.manager.findOneBy.mockResolvedValue(null)`) or update them to the «в проекте» text, whichever the test intends.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/accounts/accounts.service.spec.ts`
Expected: FAIL on the new tests and the updated messages.

- [ ] **Step 3: Implement**

`platform-names.ts`:
```ts
import { AccountPlatform } from '../db/entities/account.entity';

/** How each network is named in Russian UI text. */
export const PLATFORM_NAMES: Record<AccountPlatform, string> = {
  [AccountPlatform.INSTAGRAM]: 'Instagram',
  [AccountPlatform.TELEGRAM]: 'Telegram',
  [AccountPlatform.VK]: 'ВКонтакте',
  [AccountPlatform.YOUTUBE]: 'YouTube',
  [AccountPlatform.LINKEDIN]: 'LinkedIn',
};
```
(If `AccountPlatform` has other members, add them; tsc will tell.)

`accounts.service.ts`:
- Split `resolveLink` into `parseLink(link): ParsedAccountLink` (the parse + `INSTAGRAM_NOT_A_PROFILE` + unparseable error) and `connectorFor(parsed): SocialConnector` (registry lookup → `` `${PLATFORM_NAMES[parsed.platform]} пока не поддерживается` ``); keep `resolveLink` as `{ parsed, connector: this.connectorFor(parsed) }` for `preview`.
- Unparseable message → `'Не удалось распознать ссылку. Вставьте ссылку на аккаунт, например https://t.me/channel'`.
- `unresolvable` fallback → `` new BadRequestException(`Не удалось проверить аккаунт: ${error.message}`) `` (keep the warn log).
- `createFromLink`:
```ts
  async createFromLink(link: string, profileId?: string, expected?: AccountPlatform) {
    const parsed = this.parseLink(link);
    // Checked before the connector lookup so a VK link in the Telegram field says "wrong field", not "unsupported".
    if (expected && parsed.platform !== expected) {
      throw new BadRequestException(`Это ссылка не на ${PLATFORM_NAMES[expected]}`);
    }
    const connector = this.connectorFor(parsed);

    const existing = await this.findExisting(parsed);
    if (existing) throw new ConflictException(await this.alreadyAddedMessage(existing));

    if (profileId) {
      await requireProfile(this.repo.manager, profileId);
      // One account per network per project; legacy projects may still hold two.
      if (await this.repo.findOneBy({ profileId, platform: parsed.platform })) {
        throw new ConflictException(`В проекте уже есть ${PLATFORM_NAMES[parsed.platform]}`);
      }
    }
    // ...rest unchanged (getAccountInfo, matchesConnectedAccount, transaction, sync)
  }

  private async alreadyAddedMessage(account: Account): Promise<string> {
    const project = await this.repo.manager.findOneBy(Profile, { id: account.profileId });
    return project ? `Этот аккаунт уже в проекте «${project.name}»` : ALREADY_ADDED;
  }
```
(import `Profile` from `../db/entities/profile.entity`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/accounts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "Add accounts into a project: right network, one per network, Russian errors"
```

---

### Task 5: Create a project from links; add an account to a project

**Files:**
- Create: `backend/src/profiles/dto/create-project.dto.ts`
- Modify: `backend/src/profiles/profiles.service.ts`, `profiles.controller.ts`
- Modify: `backend/src/connectors/instagram/instagram-discovery.controller.ts` (redirect constant) + its spec
- Test: `backend/src/profiles/profiles.service.spec.ts`, `backend/src/profiles/profiles.controller.spec.ts`

**Interfaces:**
- Consumes: `AccountsService.createFromLink(link, profileId?, expected?)` (Task 4), `ProfilesService` constructor (Task 3).
- Produces: `POST /profiles` body `{ name: string; links?: { instagram?: string; telegram?: string } }` → `201 { profile: { id, name }, added: Account[], failed: Array<{ platform: 'instagram' | 'telegram'; message: string }> }`; `POST /profiles/:id/accounts` body `{ link: string }` → `Account`.

- [ ] **Step 1: Write the failing tests** — `profiles.service.spec.ts` (`setup()` already has `accounts`; add `profilesRepo.save` returning `{ id: 'p-new', ...row }` — it currently returns its argument; change to `jest.fn((p: object) => Promise.resolve({ id: 'p-new', ...p }))` and check the rename tests still pass):

```ts
  describe('create', () => {
    it('creates the project and adds every link that resolves, reporting the rest', async () => {
      const { service, accounts } = setup();
      accounts.createFromLink.mockImplementation((link: string) =>
        link.includes('t.me')
          ? Promise.reject(new BadRequestException('Канал не найден'))
          : Promise.resolve({ id: 'acc-ig' }));

      const result = await service.create({ name: '  Pheromone ', links: { instagram: 'https://instagram.com/ph', telegram: 'https://t.me/ph_channel' } });

      expect(result.profile).toMatchObject({ id: 'p-new', name: 'Pheromone' });
      expect(accounts.createFromLink).toHaveBeenCalledWith('https://instagram.com/ph', 'p-new', 'instagram');
      expect(accounts.createFromLink).toHaveBeenCalledWith('https://t.me/ph_channel', 'p-new', 'telegram');
      expect(result.added).toEqual([{ id: 'acc-ig' }]);
      expect(result.failed).toEqual([{ platform: 'telegram', message: 'Канал не найден' }]);
    });

    it('creates a project with no links', async () => {
      const { service, accounts } = setup();
      const result = await service.create({ name: 'Мезопроф' });
      expect(result).toMatchObject({ profile: { name: 'Мезопроф' }, added: [], failed: [] });
      expect(accounts.createFromLink).not.toHaveBeenCalled();
    });

    it('skips blank link fields', async () => {
      const { service, accounts } = setup();
      await service.create({ name: 'X', links: { telegram: '   ' } });
      expect(accounts.createFromLink).not.toHaveBeenCalled();
    });

    it('refuses an empty name and creates nothing', async () => {
      const { service, profilesRepo } = setup();
      await expect(service.create({ name: '   ' })).rejects.toThrow('Название проекта не может быть пустым');
      expect(profilesRepo.save).not.toHaveBeenCalled();
    });

    it('reports an unexpected failure with a generic retry message', async () => {
      const { service, accounts } = setup();
      accounts.createFromLink.mockRejectedValue(new Error('socket hang up'));
      const result = await service.create({ name: 'X', links: { telegram: 'https://t.me/abcde' } });
      expect(result.failed).toEqual([{ platform: 'telegram', message: 'Не удалось проверить, попробуйте ещё раз' }]);
    });
  });

  describe('addAccount', () => {
    it('adds a link to an existing project', async () => {
      const { service, accounts } = setup();
      accounts.createFromLink.mockResolvedValue({ id: 'acc-new' });
      expect(await service.addAccount('p1', 'https://t.me/abcde')).toEqual({ id: 'acc-new' });
      expect(accounts.createFromLink).toHaveBeenCalledWith('https://t.me/abcde', 'p1');
    });

    it('answers 404 for an unknown project', async () => {
      const { service } = setup();
      await expect(service.addAccount('nope', 'https://t.me/abcde')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```
Also update any rename test expecting `'Название профиля не может быть пустым'` to `'Название проекта не может быть пустым'`.

`profiles.controller.spec.ts`:
```ts
  it('creates a project from a name and links', async () => {
    const service = { create: jest.fn().mockResolvedValue({ profile: { id: 'p1' }, added: [], failed: [] }) } as any;
    const dto = { name: 'Pheromone', links: { telegram: 'https://t.me/abcde' } };
    await new ProfilesController(service).create(dto as any);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('adds an account to a project', async () => {
    const service = { addAccount: jest.fn().mockResolvedValue({ id: 'a1' }) } as any;
    await new ProfilesController(service).addAccount('p1', { link: 'https://t.me/abcde' } as any);
    expect(service.addAccount).toHaveBeenCalledWith('p1', 'https://t.me/abcde');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/profiles`
Expected: FAIL — `create` / `addAccount` not defined.

- [ ] **Step 3: Implement**

`dto/create-project.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ProjectLinksDto {
  @IsOptional() @IsString() instagram?: string;
  @IsOptional() @IsString() telegram?: string;
}

export class CreateProjectDto {
  @IsString()
  @MaxLength(100, { message: 'Название проекта слишком длинное' })
  name: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => ProjectLinksDto)
  links?: ProjectLinksDto;
}
```

`profiles.service.ts`:
```ts
import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountPlatform } from '../db/entities/account.entity';
import type { CreateProjectDto } from './dto/create-project.dto';

const EMPTY_NAME = 'Название проекта не может быть пустым';
const RETRY = 'Не удалось проверить, попробуйте ещё раз';
// The networks the form can add today, in display order.
const LINK_PLATFORMS = [AccountPlatform.INSTAGRAM, AccountPlatform.TELEGRAM] as const;

export interface CreatedProject {
  profile: Profile;
  added: Account[];
  failed: Array<{ platform: AccountPlatform; message: string }>;
}

function failureMessage(error: unknown): string {
  if (!(error instanceof HttpException)) return RETRY;
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join(', ') : (message ?? RETRY);
}
```
Inside the class (add `private readonly logger = new Logger(ProfilesService.name);`):
```ts
  /** Creates the project, then adds each link it can; a link that fails never undoes the project. */
  async create(dto: CreateProjectDto): Promise<CreatedProject> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException(EMPTY_NAME);
    const profile = await this.profilesRepo.save({ name });

    const added: Account[] = [];
    const failed: CreatedProject['failed'] = [];
    for (const platform of LINK_PLATFORMS) {
      const link = dto.links?.[platform]?.trim();
      if (!link) continue;
      try {
        added.push(await this.accounts.createFromLink(link, profile.id, platform));
      } catch (error) {
        if (!(error instanceof HttpException)) this.logger.warn(`Could not add ${platform} ${link}: ${(error as Error).message}`);
        failed.push({ platform, message: failureMessage(error) });
      }
    }
    return { profile, added, failed };
  }

  async addAccount(id: string, link: string): Promise<Account> {
    await this.findOne(id);
    return this.accounts.createFromLink(link, id);
  }
```
`rename` keeps using `EMPTY_NAME` (now the «проекта» text). Ensure `AccountPlatform.INSTAGRAM === 'instagram'` and `TELEGRAM === 'telegram'` (they are the enum values used by the DTO keys).

`profiles.controller.ts`:
```ts
  @Post('profiles')
  create(@Body() dto: CreateProjectDto) {
    return this.profilesService.create(dto);
  }

  @Post('profiles/:id/accounts')
  addAccount(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) id: string,
    @Body() dto: CreateAccountFromLinkDto,
  ) {
    return this.profilesService.addAccount(id, dto.link);
  }
```
(import `Post`, `CreateProjectDto`, `CreateAccountFromLinkDto` from `../accounts/dto/create-account-from-link.dto`.)

Discovery controller: `const ADD_PROJECT = '/projects?add=project';` replacing `ADD_COMPETITOR` (both uses), and its spec expectations `'/?add=competitor'` → `'/projects?add=project'` (3 places).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest && npm run build && npx tsc --noEmit -p tsconfig.json`
Expected: whole backend suite PASS, build + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "Create a project from links and add accounts to a project"
```

---

### Task 6: Routes, top bar, home page, guide; Compare removed

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/Layout.module.css`
- Create: `frontend/src/pages/HomePage.tsx`, `HomePage.module.css`, `HomePage.test.tsx`
- Create: `frontend/src/pages/GuidePage.tsx`, `GuidePage.module.css`, `GuidePage.test.tsx`
- Create: `frontend/src/pages/LegacyProfileRedirect.tsx`, `LegacyProfileRedirect.test.tsx`
- Create: `frontend/src/components/Layout.test.tsx`
- Delete: `frontend/src/pages/ComparePage.tsx`, `ComparePage.test.tsx`, `ComparePage.module.css`, `frontend/src/components/CompareTable.tsx`, `CompareTable.module.css`

**Interfaces:**
- Produces routes: `/` HomePage, `/projects` (OverviewPage until Task 8 renames it), `/projects/:id` (ProfilePage until Task 9), `/profiles/:id` → redirect, `/guide`, `/accounts/:id`. No `/compare`.

- [ ] **Step 1: Write the failing tests**

`HomePage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('names the hub and links to all projects and the guide', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Единый центр отчетности FD Agency' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Все проекты' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Как пользоваться' })).toHaveAttribute('href', '/guide');
  });
});
```

`GuidePage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { GuidePage } from './GuidePage';

describe('GuidePage', () => {
  it('walks through the service section by section', () => {
    render(<MemoryRouter><GuidePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Как пользоваться' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Что такое проект',
      'Как добавить проект',
      'Страница проекта',
      'Страница соцсети',
      'Instagram: публичные данные и полный доступ',
      'Обновление данных',
      'ВКонтакте и YouTube',
    ]);
    expect(screen.getByText('Видеоинструкция появится позже.')).toBeInTheDocument();
  });
});
```

`LegacyProfileRedirect.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { LegacyProfileRedirect } from './LegacyProfileRedirect';

describe('LegacyProfileRedirect', () => {
  it('sends an old profile link to the project page', () => {
    render(
      <MemoryRouter initialEntries={['/profiles/p1']}>
        <Routes>
          <Route path="/profiles/:id" element={<LegacyProfileRedirect />} />
          <Route path="/projects/:id" element={<p>project page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('project page')).toBeInTheDocument();
  });
});
```

`Layout.test.tsx` (mock auth like other tests do; read `auth/AuthContext.tsx` for the hook name — `useAuth`):
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { Layout } from './Layout';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

describe('Layout', () => {
  it('shows the brand, the project and guide links, and no Compare', () => {
    render(<MemoryRouter><Layout><p>page</p></Layout></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'FD Agency' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Все проекты' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Как пользоваться' })).toHaveAttribute('href', '/guide');
    expect(screen.queryByText('Compare')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/HomePage.test.tsx src/pages/GuidePage.test.tsx src/pages/LegacyProfileRedirect.test.tsx src/components/Layout.test.tsx`
Expected: FAIL — modules missing / old nav text.

- [ ] **Step 3: Implement**

`LegacyProfileRedirect.tsx`:
```tsx
import { Navigate, useParams } from 'react-router-dom';

/** Profiles became projects; old bookmarks keep working. */
export function LegacyProfileRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/projects/${id}`} replace />;
}
```

`HomePage.tsx`:
```tsx
import { Link } from 'react-router-dom';
import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Единый центр отчетности FD Agency</h1>
      <div className={styles.actions}>
        <Link to="/projects" className={styles.primary}>Все проекты</Link>
        <Link to="/guide" className={styles.secondary}>Как пользоваться</Link>
      </div>
    </div>
  );
}
```
`HomePage.module.css` (dark theme, lime accent per the brand palette; reuse the variables other modules use — read `OverviewPage.module.css` for the exact `var(--…)` names):
```css
.page { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 32px; min-height: 60vh; text-align: center; }
.heading { font-size: clamp(28px, 5vw, 44px); line-height: 1.15; max-width: 16ch; margin: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; }
.primary, .secondary { display: inline-flex; align-items: center; justify-content: center; min-width: 220px; padding: 18px 28px; border-radius: 12px; font-size: 18px; font-weight: 600; text-decoration: none; }
.primary { background: var(--accent); color: var(--on-accent); }
.secondary { border: 1px solid var(--border); color: inherit; }
```

`GuidePage.tsx`:
```tsx
import styles from './GuidePage.module.css';

export function GuidePage() {
  return (
    <article className={styles.page}>
      <h1 className={styles.heading}>Как пользоваться</h1>
      <p className={styles.note}>Видеоинструкция появится позже.</p>

      <h2>Что такое проект</h2>
      <p>Проект — это клиент: Pheromone, Мезопроф, Ренессанс Страхование. В проекте собраны все его соцсети — одна или несколько. Вся аналитика открывается из проекта.</p>

      <h2>Как добавить проект</h2>
      <ol>
        <li>На странице «Все проекты» нажмите «Добавить проект».</li>
        <li>Введите название проекта.</li>
        <li>Вставьте ссылки на аккаунты: Instagram — https://instagram.com/brand, Telegram — https://t.me/channel. Под полем сразу появится найденный аккаунт или ошибка.</li>
        <li>Нажмите «Создать проект». Аккаунты, которые нашлись, добавятся сразу. Если какую-то ссылку проверить не удалось, это будет написано на странице проекта — её можно добавить ещё раз через плитку «+».</li>
      </ol>
      <p>Ссылки можно не заполнять: проект создастся с одним названием, аккаунты добавите позже.</p>

      <h2>Страница проекта</h2>
      <p>Четыре плитки — Instagram, Telegram, ВКонтакте, YouTube. Заполненная плитка показывает аккаунт и подписчиков; нажмите на неё, чтобы открыть аналитику. Пустая плитка с «+» добавляет аккаунт этой соцсети. «Убрать» удаляет аккаунт из проекта вместе с его статистикой. «Удалить проект» удаляет проект и все его аккаунты.</p>

      <h2>Страница соцсети</h2>
      <p>Выберите период — по умолчанию последние 30 дней. Ниже — сводка, график подписчиков и топ-10 постов; сортировку топа можно менять. «Показать все посты» открывает полный список с листанием. Нажмите на пост, чтобы увидеть его целиком со всеми показателями.</p>

      <h2>Instagram: публичные данные и полный доступ</h2>
      <p>Аккаунт Instagram, добавленный по ссылке, показывает публичные данные: подписчиков, лайки, комментарии и просмотры Reels. Охват, репосты и просмотры всех постов доступны после кнопки «Подключить полный доступ» на странице аккаунта. Входить в Instagram должен владелец этого аккаунта; пароль мы не видим и не храним. Если войти в другой аккаунт, ничего не изменится — появится подсказка.</p>
      <p>Для чужих аккаунтов Instagram сервис использует подключение Facebook. Если его нет или оно истекло, при добавлении появится кнопка «Подключить Facebook».</p>

      <h2>Обновление данных</h2>
      <p>Данные обновляются автоматически каждую ночь за последние 90 дней. Кнопка «Обновить» запускает обновление сразу. «Загрузить всю историю» собирает все старые посты аккаунта — это может занять время, прогресс виден на странице.</p>

      <h2>ВКонтакте и YouTube</h2>
      <p>Скоро. Поля и плитки для них уже есть, но добавить такие аккаунты пока нельзя.</p>
    </article>
  );
}
```
`GuidePage.module.css`:
```css
.page { max-width: 760px; margin: 0 auto; line-height: 1.6; }
.heading { margin: 0 0 8px; }
.note { color: var(--text-muted); margin: 0 0 24px; }
.page h2 { margin: 32px 0 8px; font-size: 20px; }
.page ol { padding-left: 20px; }
```
(Use the muted-text variable name the codebase actually defines.)

`Layout.tsx` header:
```tsx
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>FD Agency</Link>
        <nav className={styles.nav}>
          <NavLink to="/projects" className={navLinkClassName}>Все проекты</NavLink>
          <NavLink to="/guide" className={navLinkClassName}>Как пользоваться</NavLink>
        </nav>
        <button type="button" className={styles.logout} onClick={handleLogout}>Выйти</button>
      </header>
```
(import `Link`; add `text-decoration: none; color: inherit;` to `.brand` in the css.)

`App.tsx`: remove the `ComparePage` import and `/compare` route; routes (each wrapped in `<RequireAuth>` like today):
`/` → `<HomePage />`, `/projects` → `<OverviewPage />`, `/projects/:id` → `<ProfilePage />`, `/profiles/:id` → `<LegacyProfileRedirect />`, `/guide` → `<GuidePage />`, `/accounts/:id` → `<AccountDetailPage />`.

Delete the Compare files: `git rm frontend/src/pages/ComparePage.tsx frontend/src/pages/ComparePage.test.tsx frontend/src/pages/ComparePage.module.css frontend/src/components/CompareTable.tsx frontend/src/components/CompareTable.module.css`.

`ProfilePage.tsx` currently routes `/profiles/:id`; its test renders that path — leave it (Task 9 renames it). Its "back" link goes to `/` → change to `/projects` with text «Вернуться ко всем проектам», and `navigate('/')` → `navigate('/projects')`; update `ProfilePage.test.tsx` route `<Route path="/" …>` to `/projects` accordingly.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "Home page, guide and project routes; drop Compare"
```

---

### Task 7: «Добавить проект» form with per-network link fields

**Files:**
- Create: `frontend/src/components/LinkField.tsx`, `LinkField.test.tsx`
- Rename: `frontend/src/components/AddAccountModal.module.css` → `AddProjectModal.module.css` (`git mv`)
- Create: `frontend/src/components/AddProjectModal.tsx`, `AddProjectModal.test.tsx`
- Delete: `frontend/src/components/AddAccountModal.tsx`, `AddAccountModal.test.tsx`

**Interfaces:**
- Produces: `LinkField({ id, platform, value, onChange, autoFocus? }: { id: string; platform: 'instagram' | 'telegram'; value: string; onChange: (v: string) => void; autoFocus?: boolean })` — renders label, input, example, live preview / error / Facebook prompt. Exports `NETWORKS: Array<{ platform: 'instagram'|'telegram'|'vk'|'youtube'; name: string; example: string; available: boolean }>` in that order.
- Produces: `AddProjectModal({ onClose, initialError? }: { onClose: () => void; initialError?: string | null })` — on success navigates to `/projects/:id` with `state: { failed }`.

- [ ] **Step 1: Write the failing tests**

`LinkField.test.tsx`:
```tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkField } from './LinkField';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const post = apiClient.post as any;

function Harness({ platform = 'telegram' as const }) {
  const [value, setValue] = useState('');
  return <LinkField id="f" platform={platform} value={value} onChange={setValue} />;
}

async function type(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { vi.advanceTimersByTime(700); });
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('LinkField', () => {
  it('labels the field with its network and shows the link format', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Например: https://t.me/channel')).toBeInTheDocument();
  });

  it('shows the account it found', async () => {
    post.mockResolvedValue({ data: { platform: 'telegram', externalId: '@chan', name: 'Канал', followersCount: 1200, avatarDataUri: null, alreadyAdded: false } });
    render(<Harness />);
    await type('https://t.me/chan');
    expect(post).toHaveBeenCalledWith('/accounts/preview', { link: 'https://t.me/chan' });
    expect(screen.getByText('Канал')).toBeInTheDocument();
  });

  it('says when the link belongs to another network', async () => {
    post.mockResolvedValue({ data: { platform: 'instagram', externalId: '@b', name: 'B', followersCount: 1, avatarDataUri: null, alreadyAdded: false } });
    render(<Harness />);
    await type('https://instagram.com/b');
    expect(screen.getByRole('alert')).toHaveTextContent('Это ссылка не на Telegram');
  });

  it('shows the server error for a link it cannot find', async () => {
    post.mockRejectedValue({ response: { data: { message: 'Канал не найден' } } });
    render(<Harness />);
    await type('https://t.me/nothere');
    expect(screen.getByRole('alert')).toHaveTextContent('Канал не найден');
  });

  it('offers the Facebook login when Instagram lookups need it', async () => {
    post.mockRejectedValue({ response: { data: { code: 'instagram_discovery_not_connected', message: 'x' } } });
    render(<Harness platform="instagram" />);
    await type('https://instagram.com/brand');
    expect(screen.getByRole('button', { name: 'Подключить Facebook' })).toBeInTheDocument();
  });
});
```

`AddProjectModal.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddProjectModal } from './AddProjectModal';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const post = apiClient.post as any;

function ProjectStub() {
  const { state } = useLocation();
  return <p>project {JSON.stringify(state)}</p>;
}

function renderModal() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="/projects" element={<AddProjectModal onClose={() => {}} />} />
        <Route path="/projects/:id" element={<ProjectStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  post.mockImplementation((url: string) =>
    url === '/accounts/preview' ? new Promise(() => {}) : Promise.resolve({ data: { profile: { id: 'p9' }, added: [], failed: [{ platform: 'telegram', message: 'Канал не найден' }] } }));
});

describe('AddProjectModal', () => {
  it('asks for a name with examples and a link per network', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Например: Pheromone, Мезопроф, Ренессанс Страхование')).toBeInTheDocument();
    for (const name of ['Instagram', 'Telegram', 'ВКонтакте', 'YouTube']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.getByText('Например: https://vk.com/brand')).toBeInTheDocument();
    expect(screen.getByText('Например: https://youtube.com/@brand')).toBeInTheDocument();
  });

  it('keeps VK and YouTube disabled for now', () => {
    renderModal();
    expect(screen.getByLabelText('ВКонтакте')).toBeDisabled();
    expect(screen.getByLabelText('YouTube')).toBeDisabled();
    expect(screen.getAllByText('Скоро')).toHaveLength(2);
  });

  it('needs a name before it can create', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Создать проект' })).toBeDisabled();
  });

  it('creates the project with the filled links and opens it with what failed', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Pheromone' } });
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/ph_channel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать проект' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/profiles', { name: 'Pheromone', links: { telegram: 'https://t.me/ph_channel' } }));
    expect(await screen.findByText(/project/)).toHaveTextContent('Канал не найден');
  });

  it('shows why the project could not be created', async () => {
    post.mockImplementation((url: string) =>
      url === '/accounts/preview' ? new Promise(() => {}) : Promise.reject({ response: { data: { message: 'Название проекта слишком длинное' } } }));
    renderModal();
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать проект' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Название проекта слишком длинное');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/LinkField.test.tsx src/components/AddProjectModal.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`git mv frontend/src/components/AddAccountModal.module.css frontend/src/components/AddProjectModal.module.css`, then append:
```css
.step { margin: 20px 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.field { margin-top: 12px; }
.example { margin: 4px 0 0; font-size: 13px; color: var(--text-muted); }
.soon { margin-left: 8px; font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-muted); }
.input:disabled { opacity: 0.5; cursor: not-allowed; }
```
(Use the variable names already used in that css file.)

`LinkField.tsx` — move the preview/Facebook logic out of the old modal:
```tsx
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import { formatCount } from '../format';
import styles from './AddProjectModal.module.css';

export const NETWORKS = [
  { platform: 'instagram', name: 'Instagram', example: 'https://instagram.com/brand', available: true },
  { platform: 'telegram', name: 'Telegram', example: 'https://t.me/channel', available: true },
  { platform: 'vk', name: 'ВКонтакте', example: 'https://vk.com/brand', available: false },
  { platform: 'youtube', name: 'YouTube', example: 'https://youtube.com/@brand', available: false },
] as const;

export type LinkPlatform = 'instagram' | 'telegram';

interface AccountPreview {
  platform: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
  alreadyAdded: boolean;
}

type FacebookPrompt = 'connect' | 'reconnect';
// Codes the backend sends when an Instagram lookup needs the Facebook login first.
const FACEBOOK_PROMPTS: Record<string, FacebookPrompt> = {
  instagram_discovery_not_connected: 'connect',
  instagram_discovery_reconnect: 'reconnect',
};

interface LinkFieldProps {
  id: string;
  platform: LinkPlatform;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

/** One network's link input: checks the link as the user types and shows what it found. */
export function LinkField({ id, platform, value, onChange, autoFocus }: LinkFieldProps) {
  const network = NETWORKS.find((n) => n.platform === platform)!;
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facebookPrompt, setFacebookPrompt] = useState<FacebookPrompt | null>(null);
  const [resolving, setResolving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    setPreview(null);
    setError(null);
    setFacebookPrompt(null);
    if (trimmed === '') {
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    const timer = setTimeout(() => {
      apiClient
        .post('/accounts/preview', { link: trimmed })
        .then((res) => {
          if (cancelled) return;
          if (res.data.platform !== platform) setError(`Это ссылка не на ${network.name}`);
          else setPreview(res.data);
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
  }, [value, platform, network.name]);

  async function connectFacebook() {
    setConnecting(true);
    try {
      const { data } = await apiClient.get('/instagram/discovery/connect');
      // Full-page navigation: the login is outside the SPA; the callback returns to /projects?add=project.
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setConnecting(false);
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{network.name}</label>
      <input id={id} className={styles.input} placeholder={network.example} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} />
      <p className={styles.example}>Например: {network.example}</p>
      {resolving && <p className={styles.resolving}>Проверяем…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {facebookPrompt && (
        <div className={styles.facebookPrompt}>
          <p className={styles.helperText}>
            {facebookPrompt === 'connect'
              ? 'Чтобы добавлять аккаунты Instagram по ссылке, один раз подключите Facebook — страницу, к которой привязан ваш профессиональный аккаунт Instagram.'
              : 'Доступ к Facebook истёк — переподключите его, чтобы добавлять аккаунты Instagram по ссылке.'}
          </p>
          <button type="button" className={styles.connectButton} onClick={connectFacebook} disabled={connecting}>
            {connecting ? 'Переходим…' : facebookPrompt === 'connect' ? 'Подключить Facebook' : 'Переподключить Facebook'}
          </button>
        </div>
      )}
      {preview && (
        <div className={styles.preview}>
          {preview.avatarDataUri ? (
            <img className={styles.avatar} src={preview.avatarDataUri} alt="" />
          ) : (
            <div className={styles.avatarFallback} aria-hidden="true" />
          )}
          <div className={styles.previewText}>
            <div className={styles.previewName}>
              <PlatformIcon platform={preview.platform} />
              {preview.name}
            </div>
            <div className={styles.previewFollowers}>
              <span className={styles.previewCount}>{formatCount(preview.followersCount)}</span> подписчиков
            </div>
            {preview.alreadyAdded && <p className={styles.duplicate}>Этот аккаунт уже добавлен</p>}
          </div>
        </div>
      )}
    </div>
  );
}
```

`AddProjectModal.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { LinkField, NETWORKS, type LinkPlatform } from './LinkField';
import styles from './AddProjectModal.module.css';

interface AddProjectModalProps {
  onClose: () => void;
  /** An error carried back in the URL from the Facebook login redirect. */
  initialError?: string | null;
}

export function AddProjectModal({ onClose, initialError = null }: AddProjectModalProps) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [links, setLinks] = useState<Record<LinkPlatform, string>>({ instagram: '', telegram: '' });
  const [error, setError] = useState<string | null>(initialError);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    const filled = Object.fromEntries(Object.entries(links).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
    try {
      const { data } = await apiClient.post('/profiles', { name: name.trim(), links: filled });
      navigate(`/projects/${data.profile.id}`, { state: { failed: data.failed } });
    } catch (err: any) {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : (message ?? 'Не удалось создать проект'));
      setCreating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавить проект" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавить проект</h2>

        <p className={styles.step}>Шаг 1</p>
        <label className={styles.label} htmlFor="project-name">Название проекта</label>
        <input id="project-name" className={styles.input} maxLength={100} autoFocus
          placeholder="Например: Pheromone, Мезопроф, Ренессанс Страхование"
          value={name} onChange={(e) => setName(e.target.value)} />

        <p className={styles.step}>Шаг 2</p>
        <p className={styles.helperText}>Добавьте ссылки на аккаунты проекта — одну или несколько. Можно пропустить и добавить позже.</p>
        {NETWORKS.map((network) =>
          network.available ? (
            <LinkField key={network.platform} id={`link-${network.platform}`} platform={network.platform as LinkPlatform}
              value={links[network.platform as LinkPlatform]}
              onChange={(value) => setLinks((prev) => ({ ...prev, [network.platform]: value }))} />
          ) : (
            <div key={network.platform} className={styles.field}>
              <label className={styles.label} htmlFor={`link-${network.platform}`}>{network.name}</label>
              <span className={styles.soon}>Скоро</span>
              <input id={`link-${network.platform}`} className={styles.input} placeholder={network.example} disabled />
              <p className={styles.example}>Например: {network.example}</p>
            </div>
          ),
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>Отмена</button>
          <button type="button" className={styles.submit} onClick={handleCreate} disabled={creating || name.trim() === ''}>
            {creating ? 'Создаём…' : 'Создать проект'}
          </button>
        </div>
      </div>
    </div>
  );
}
```
Note the label for disabled networks: `getByLabelText('ВКонтакте')` must resolve to the input — keep the `<span>` outside the `<label>` as written.

`git rm frontend/src/components/AddAccountModal.tsx frontend/src/components/AddAccountModal.test.tsx`. `OverviewPage.tsx` still imports `AddAccountModal` — Task 8 switches it; to keep this commit compiling, switch the import and JSX now: `<AddProjectModal onClose={closeAdding} initialError={addError} />` (remove `onCreated`/`profiles` props, `handleCreated`).

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components && npx tsc -b`
Expected: PASS (OverviewPage tests may fail on the old «Добавить аккаунт» texts — fixed in Task 8; nothing else fails); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "Add-project form with a link field per network"
```

---

### Task 8: «Все проекты» page and project cards

**Files:**
- Rename: `frontend/src/pages/OverviewPage.tsx|.test.tsx|.module.css` → `ProjectsPage.*` (`git mv`; rename the component to `ProjectsPage`)
- Modify: `frontend/src/App.tsx` (import), `frontend/src/components/ProfileCard.tsx`, `ProfileCard.test.tsx`, `frontend/src/profiles.ts`

**Interfaces:**
- Consumes: `AddProjectModal` (Task 7).
- Produces: `ProfileSummary.accounts` may be empty; `profileHref` removed — cards link to `/projects/:id`.

- [ ] **Step 1: Write the failing tests**

`ProjectsPage.test.tsx` — after the rename, update: heading `'Все проекты'` (level 1), button `'Добавить проект'`, empty text `'Пока нет ни одного проекта.'`, error text `'Не удалось загрузить проекты. Попробуйте позже.'`, and the reopen-after-Facebook tests use `'/projects?add=project'` (and `&discoveryError=…`), expecting the dialog `getByRole('dialog', { name: 'Добавить проект' })`. Add:
```tsx
  it('lists a project that has no accounts yet', async () => {
    get.mockImplementation((url: string) =>
      url === '/profiles'
        ? Promise.resolve({ data: [{ id: 'p1', name: 'Мезопроф', totalFollowers: null, accounts: [] }] })
        : Promise.resolve({ data: {} }));
    renderPage();   // the file's existing render helper
    expect(await screen.findByText('Мезопроф')).toBeInTheDocument();
    expect(screen.getByText('Аккаунты не добавлены')).toBeInTheDocument();
  });
```
(Adapt to the file's existing mock/render helpers after reading it.)

`ProfileCard.test.tsx` — replace the test asserting a single-account card links to `/accounts/:id` with:
```tsx
  it('always opens the project page', () => {
    render(<MemoryRouter><ProfileCard profile={oneAccountProfile} /></MemoryRouter>);   // existing fixture
    expect(screen.getByTestId('profile-card')).toHaveAttribute('href', `/projects/${oneAccountProfile.id}`);
  });

  it('says when a project has no accounts', () => {
    render(<MemoryRouter><ProfileCard profile={{ id: 'p1', name: 'Мезопроф', totalFollowers: null, accounts: [] }} /></MemoryRouter>);
    expect(screen.getByText('Аккаунты не добавлены')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/ProjectsPage.test.tsx src/components/ProfileCard.test.tsx`
Expected: FAIL (old texts, link to account, crash on empty `accounts[0]`).

- [ ] **Step 3: Implement**

`profiles.ts`: delete `profileHref`; change the `accounts` doc comment to `/** Most followers first; empty for a project with no accounts yet. */`.

`ProfileCard.tsx`:
```tsx
export function ProfileCard({ profile }: { profile: ProfileSummary }) {
  // The biggest account stands for the brand.
  const lead = profile.accounts[0]?.account;
  const avatarSrc = useAvatar(lead?.id ?? '', !!lead && lead.avatarUrl !== null);

  return (
    <Link to={`/projects/${profile.id}`} className={styles.card} data-testid="profile-card">
      ...identity block unchanged...
      {profile.accounts.length === 0 ? (
        <p className={styles.empty}>Аккаунты не добавлены</p>
      ) : (
        <div className={styles.stat}>…unchanged…</div>
      )}
    </Link>
  );
}
```
Add `.empty { margin: 0; color: var(--text-muted); font-size: 14px; }` to `ProfileCard.module.css`. Verify `useAvatar` does nothing when `hasAvatar` is false (read it; it must not request `/accounts//avatar`).

`ProjectsPage.tsx` (renamed): component name `ProjectsPage`; `searchParams.get('add') === 'project'`; heading `<h1 className={styles.heading}>Все проекты</h1>`; button text `Добавить проект`; empty `Пока нет ни одного проекта.`; error `Не удалось загрузить проекты. Попробуйте позже.`; comment about the Facebook redirect → `/projects?add=project`. Modal: `<AddProjectModal onClose={closeAdding} initialError={addError} />`.

`App.tsx`: import `ProjectsPage` and use it for `/projects`.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "«Все проекты» page; project cards for empty projects"
```

---

### Task 9: Project page with network tiles

**Files:**
- Rename: `frontend/src/pages/ProfilePage.tsx|.test.tsx|.module.css` → `ProjectPage.*` (`git mv`; component `ProjectPage`)
- Create: `frontend/src/components/NetworkTile.tsx`, `NetworkTile.module.css`, `NetworkTile.test.tsx`
- Create: `frontend/src/components/AddAccountDialog.tsx`, `AddAccountDialog.test.tsx` (styles from `AddProjectModal.module.css`)
- Delete: `frontend/src/components/AccountCard.tsx`, `AccountCard.test.tsx`, `AccountCard.module.css` (after confirming `grep -rn "AccountCard" frontend/src` shows no other user)
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `LinkField`, `NETWORKS` (Task 7); `POST /profiles/:id/accounts`, `DELETE /profiles/:id`, `DELETE /accounts/:id`; location `state.failed: Array<{ platform: string; message: string }>`.
- Produces: `NetworkTile({ network, item, onAdd, onRemoved })` where `network` is a `NETWORKS` entry and `item?: ProfileAccountItem`; `AddAccountDialog({ projectId, platform, onClose, onAdded })`.

- [ ] **Step 1: Write the failing tests**

`NetworkTile.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkTile } from './NetworkTile';
import { NETWORKS } from './LinkField';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), delete: vi.fn() } }));
const del = apiClient.delete as any;
const [instagram, telegram, vk] = NETWORKS;
const item = { account: { id: 'acc-tg', platform: 'telegram', name: 'Coffee TG', avatarUrl: null, type: 'public_no_access' }, latestSnapshot: { followersCount: 1500, avgEr: 1 } };

beforeEach(() => vi.clearAllMocks());

describe('NetworkTile', () => {
  it('shows a filled network and opens its page', () => {
    render(<MemoryRouter><NetworkTile network={telegram} item={item} onAdd={vi.fn()} onRemoved={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Coffee TG/ })).toHaveAttribute('href', '/accounts/acc-tg');
    expect(screen.getByText(/1\s?500/)).toBeInTheDocument();
  });

  it('offers to add a missing network', () => {
    const onAdd = vi.fn();
    render(<MemoryRouter><NetworkTile network={instagram} onAdd={onAdd} onRemoved={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить Instagram' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('marks networks that are not available yet', () => {
    render(<MemoryRouter><NetworkTile network={vk} onAdd={vi.fn()} onRemoved={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('ВКонтакте — скоро')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes the account from the project after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    del.mockResolvedValue({});
    const onRemoved = vi.fn();
    render(<MemoryRouter><NetworkTile network={telegram} item={item} onAdd={vi.fn()} onRemoved={onRemoved} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith('/accounts/acc-tg');
  });
});
```

`AddAccountDialog.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddAccountDialog } from './AddAccountDialog';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const post = apiClient.post as any;

beforeEach(() => vi.clearAllMocks());

describe('AddAccountDialog', () => {
  it('adds the link to the project', async () => {
    post.mockImplementation((url: string) => (url === '/accounts/preview' ? new Promise(() => {}) : Promise.resolve({ data: { id: 'a1' } })));
    const onAdded = vi.fn();
    render(<AddAccountDialog projectId="p1" platform="telegram" onClose={vi.fn()} onAdded={onAdded} />);
    expect(screen.getByRole('dialog', { name: 'Добавить Telegram' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/abcde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/profiles/p1/accounts', { link: 'https://t.me/abcde' });
  });

  it('shows why the account could not be added', async () => {
    post.mockImplementation((url: string) =>
      url === '/accounts/preview' ? new Promise(() => {}) : Promise.reject({ response: { data: { message: 'В проекте уже есть Telegram' } } }));
    render(<AddAccountDialog projectId="p1" platform="telegram" onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/abcde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(await screen.findByText('В проекте уже есть Telegram')).toBeInTheDocument();
  });
});
```

`ProjectPage.test.tsx` (renamed from ProfilePage.test) — routes become `/projects/:id` and `/projects`; keep rename tests (label `'Название проекта'`, error text «проект»); replace card assertions with:
```tsx
  it('shows a tile per network in a fixed order, filled or empty', async () => {
    mockProfile();   // twoAccounts: instagram + telegram
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(screen.getAllByTestId('network-tile').map((t) => t.dataset.platform)).toEqual(['instagram', 'telegram', 'vk', 'youtube']);
    expect(screen.getByText('ВКонтакте — скоро')).toBeInTheDocument();
  });

  it('shows an empty project with add tiles', async () => {
    mockProfile({ id: 'p1', name: 'Мезопроф', totalFollowers: null, accounts: [] });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Добавить Instagram' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить Telegram' })).toBeInTheDocument();
  });

  it('keeps a second account of the same network as an extra tile', async () => {
    mockProfile({ ...twoAccounts, accounts: [...twoAccounts.accounts, item('acc-tg2', 'Second TG', 'telegram', 100)] });
    renderPage();
    expect(await screen.findByText('Second TG')).toBeInTheDocument();
    expect(screen.getAllByTestId('network-tile')).toHaveLength(5);
  });

  it('lists the links that could not be added when it was created', async () => {
    mockProfile();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: { failed: [{ platform: 'telegram', message: 'Канал не найден' }] } }]}>
        <Routes><Route path="/projects/:id" element={<ProjectPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось добавить: Telegram — Канал не найден');
  });

  it('deletes the project after confirmation and goes to all projects', async () => {
    mockProfile();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    del.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить проект' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/profiles/p1'));
    expect(await screen.findByText('All projects page')).toBeInTheDocument();   // the /projects route stub
  });
```
(Change the `/` route stub in this file to `<Route path="/projects" element={<p>All projects page</p>} />` and `initialEntries` to `/projects/p1`. Delete the old tests about AccountCard delete/`navigate('/')`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/NetworkTile.test.tsx src/components/AddAccountDialog.test.tsx src/pages/ProjectPage.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`NetworkTile.tsx`:
```tsx
import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatCount } from '../format';
import type { ProfileAccountItem } from '../profiles';
import type { NETWORKS } from './LinkField';
import { PlatformIcon } from './PlatformIcon';
import { useAvatar } from './useAvatar';
import styles from './NetworkTile.module.css';

interface NetworkTileProps {
  network: (typeof NETWORKS)[number];
  item?: ProfileAccountItem;
  onAdd: () => void;
  onRemoved: () => void;
}

export function NetworkTile({ network, item, onAdd, onRemoved }: NetworkTileProps) {
  if (item) return <FilledTile item={item} onRemoved={onRemoved} />;
  if (!network.available) {
    return (
      <div className={`${styles.tile} ${styles.soon}`} data-testid="network-tile" data-platform={network.platform}>
        <span className={styles.plus} aria-hidden="true">+</span>
        <span>{network.name} — скоро</span>
      </div>
    );
  }
  return (
    <button type="button" className={`${styles.tile} ${styles.empty}`} data-testid="network-tile"
      data-platform={network.platform} onClick={onAdd} aria-label={`Добавить ${network.name}`}>
      <span className={styles.plus} aria-hidden="true">+</span>
      <span>Добавить {network.name}</span>
    </button>
  );
}

function FilledTile({ item, onRemoved }: { item: ProfileAccountItem; onRemoved: () => void }) {
  const { account, latestSnapshot } = item;
  const avatarSrc = useAvatar(account.id, account.avatarUrl !== null);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Убрать «${account.name}» из проекта? Вся собранная статистика этого аккаунта будет удалена.`)) return;
    try {
      setError(null);
      await apiClient.delete(`/accounts/${account.id}`);
      onRemoved();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось убрать аккаунт');
    }
  }

  return (
    <div className={styles.tile} data-testid="network-tile" data-platform={account.platform}>
      <Link to={`/accounts/${account.id}`} className={styles.link}>
        {avatarSrc ? <img className={styles.avatar} src={avatarSrc} alt="" /> : <div className={styles.avatarFallback} aria-hidden="true" />}
        <span className={styles.name}><PlatformIcon platform={account.platform} /> {account.name}</span>
        <span className={styles.followers}>{formatCount(latestSnapshot?.followersCount ?? null)} подписчиков</span>
      </Link>
      <button type="button" className={styles.remove} onClick={remove}>Убрать</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
```
`NetworkTile.module.css` (same size for every tile; dark theme variables as in other modules):
```css
.tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 180px; padding: 20px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); text-align: center; color: inherit; font: inherit; }
.empty { border-style: dashed; cursor: pointer; }
.empty:hover, .empty:focus-visible { border-color: var(--accent); }
.soon { border-style: dashed; opacity: 0.5; }
.plus { font-size: 48px; line-height: 1; }
.link { display: flex; flex-direction: column; align-items: center; gap: 8px; color: inherit; text-decoration: none; }
.avatar, .avatarFallback { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: var(--border); }
.name { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.followers { color: var(--text-muted); font-size: 14px; }
.remove { position: absolute; top: 8px; right: 8px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; }
.error { color: var(--danger); font-size: 13px; }
```

`AddAccountDialog.tsx`:
```tsx
import { useState } from 'react';
import { apiClient } from '../api/client';
import { LinkField, NETWORKS, type LinkPlatform } from './LinkField';
import styles from './AddProjectModal.module.css';

interface AddAccountDialogProps {
  projectId: string;
  platform: LinkPlatform;
  onClose: () => void;
  onAdded: () => void;
}

export function AddAccountDialog({ projectId, platform, onClose, onAdded }: AddAccountDialogProps) {
  const network = NETWORKS.find((n) => n.platform === platform)!;
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    try {
      await apiClient.post(`/profiles/${projectId}/accounts`, { link: link.trim() });
      onAdded();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить аккаунт');
      setAdding(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label={`Добавить ${network.name}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавить {network.name}</h2>
        <LinkField id="tile-link" platform={platform} value={link} onChange={setLink} autoFocus />
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>Отмена</button>
          <button type="button" className={styles.submit} onClick={handleAdd} disabled={adding || link.trim() === ''}>Добавить</button>
        </div>
      </div>
    </div>
  );
}
```
(The submit error deliberately has no `role="alert"` so it does not collide with LinkField's own alert.)

`ProjectPage.tsx` (renamed from ProfilePage): keep the rename block (aria-label `Название проекта`, error fallback `Не удалось переименовать проект`, not-found `Проект не найден`, load error `Не удалось загрузить проект`, back link `Вернуться ко всем проектам` → `/projects`). Replace the grid:
```tsx
  const location = useLocation();
  const failed = (location.state as { failed?: Array<{ platform: string; message: string }> } | null)?.failed ?? [];
  const [adding, setAdding] = useState<LinkPlatform | null>(null);
  ...
  // One tile per network; a legacy second account of a network gets an extra tile after the four.
  const firsts = NETWORKS.map((network) => accounts.find((a) => a.account.platform === network.platform));
  const extras = accounts.filter((a) => !firsts.includes(a));
  const reload = () => setReloadKey((key) => key + 1);

  async function deleteProject() {
    if (!confirm(`Удалить проект «${name}» вместе со всеми аккаунтами и данными?`)) return;
    try {
      setDeleteError(null);
      await apiClient.delete(`/profiles/${id}`);
      navigate('/projects');
    } catch (err: any) {
      setDeleteError(err.response?.data?.message ?? 'Не удалось удалить проект');
    }
  }
  ...
      {/* in the header, after the followers total */}
      <button type="button" className={styles.deleteButton} onClick={deleteProject}>Удалить проект</button>
  ...
      {failed.length > 0 && (
        <p className={styles.error} role="alert">
          {failed.map((f) => `Не удалось добавить: ${NETWORKS.find((n) => n.platform === f.platform)?.name ?? f.platform} — ${f.message}`).join('. ')}
        </p>
      )}
      {deleteError && <p className={styles.error} role="alert">{deleteError}</p>}
      <div className={styles.grid}>
        {NETWORKS.map((network, i) => (
          <NetworkTile key={network.platform} network={network} item={firsts[i]}
            onAdd={() => setAdding(network.platform as LinkPlatform)} onRemoved={reload} />
        ))}
        {extras.map((item) => {
          const network = NETWORKS.find((n) => n.platform === item.account.platform) ?? NETWORKS[0];
          return <NetworkTile key={item.account.id} network={network} item={item} onAdd={() => {}} onRemoved={reload} />;
        })}
      </div>
      {adding && (
        <AddAccountDialog projectId={id!} platform={adding} onClose={() => setAdding(null)}
          onAdded={() => { setAdding(null); reload(); }} />
      )}
```
(`deleteError` is a new `useState<string | null>(null)`; add `.deleteButton` and a 4-column responsive `.grid` — `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;` — to `ProjectPage.module.css`; on narrow screens tiles wrap.) Two error alerts can appear at once only if both happen; the failed-notice test renders without a delete error, so `findByRole('alert')` is unambiguous.

`App.tsx`: import `ProjectPage` for `/projects/:id`.

Delete AccountCard files with `git rm` once grep confirms no other user.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "Project page with a tile per network, add and remove accounts, delete project"
```

---

### Task 10: Account page — full access, reconnect, project breadcrumb

**Files:**
- Modify: `frontend/src/pages/AccountDetailPage.tsx`, `AccountDetailPage.module.css`, `AccountDetailPage.test.tsx`
- Modify: `frontend/src/components/ProfileSwitcher.tsx`, `ProfileSwitcher.test.tsx`

**Interfaces:**
- Consumes: `GET /accounts/:id/instagram/connect` → `{ redirectUrl }` (Task 2); query `instagramError`.

- [ ] **Step 1: Write the failing tests** — in `AccountDetailPage.test.tsx` (add `useSearchParams`-free URLs via `initialEntries`; extend `renderPage(entry = '/accounts/acc-1')`):
```tsx
  it('offers full access for an Instagram account added by link', async () => {
    mockApi({ detailData: { ...detail(), account: { id: 'acc-1', name: 'Brand', platform: 'instagram', type: 'public_no_access' } } });
    renderPage();
    expect(await screen.findByText('Публичные данные: охват и репосты недоступны')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить полный доступ' })).toBeInTheDocument();
  });

  it('starts the Instagram login for this account', async () => {
    mockApi({ detailData: { ...detail(), account: { id: 'acc-1', name: 'Brand', platform: 'instagram', type: 'public_no_access' } } });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, set href(v: string) { assign(v); } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить полный доступ' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://ig/login'));
    expect(get).toHaveBeenCalledWith('/accounts/acc-1/instagram/connect');
    vi.unstubAllGlobals();
  });

  it('does not offer full access to Telegram or an own Instagram account', async () => {
    mockApi({ detailData: { ...detail(), account: { id: 'acc-1', name: 'Brand', platform: 'instagram', type: 'own' } } });
    renderPage();
    await screen.findByRole('heading', { name: 'Brand' });
    expect(screen.queryByRole('button', { name: 'Подключить полный доступ' })).not.toBeInTheDocument();
  });

  it('shows why an Instagram login did not go through', async () => {
    mockApi();
    renderPage(`/accounts/acc-1?instagramError=${encodeURIComponent('Вы вошли в другой аккаунт Instagram (@x)')}`);
    expect(await screen.findByText('Вы вошли в другой аккаунт Instagram (@x)')).toBeInTheDocument();
  });

  it('links back to its project', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByRole('link', { name: '← Coffee Lab' })).toHaveAttribute('href', '/projects/prof-1');
  });
```
In `mockApi`, route `url.endsWith('/instagram/connect')` → `Promise.resolve({ data: { redirectUrl: 'https://ig/login' } })` (add before the fallback). Update the existing reconnect-banner test: the button now calls `/accounts/acc-1/instagram/connect` (no params). Update the existing breadcrumb tests ("has no breadcrumb for an account alone in its profile" → the breadcrumb now always shows) and the delete tests: after delete, navigation goes to `/projects/prof-1` (add that route stub) in both the single and multi-account cases.

`ProfileSwitcher.test.tsx`: label `'Проект:'`, option `'Отдельный проект'`, error `'Проект не найден'`.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/AccountDetailPage.test.tsx src/components/ProfileSwitcher.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** — `AccountDetailPage.tsx`:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the Instagram login callback when the login did not go through.
  const [instagramError] = useState(() => searchParams.get('instagramError'));
  useEffect(() => {
    if (searchParams.has('instagramError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Full access (a linked account) and reconnect (an own one) are the same per-account login. */
  async function startInstagramLogin() {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const { data } = await apiClient.get(`/accounts/${id}/instagram/connect`);
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setReconnectError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setReconnecting(false);
    }
  }
```
Replace `handleReconnect` uses with `startInstagramLogin`. After the reconnect banner add:
```tsx
      {instagramError && <p className={styles.error} role="alert">{instagramError}</p>}
      {account.platform === 'instagram' && account.type === 'public_no_access' && (
        <div className={styles.fullAccess}>
          <span>Публичные данные: охват и репосты недоступны</span>
          <button type="button" onClick={startInstagramLogin} disabled={reconnecting}>
            {reconnecting ? 'Переходим…' : 'Подключить полный доступ'}
          </button>
          {reconnectError && !detail.data.needsReconnect && <span className={styles.error}>{reconnectError}</span>}
        </div>
      )}
```
Breadcrumb: always render `<Link to={`/projects/${profile.id}`} className={styles.breadcrumb}>← {profile.name}</Link>`. `handleDelete`: `navigate(`/projects/${profile.id}`)`. Add `.fullAccess` to the css by copying `.reconnectBanner`'s rules with a neutral (non-warning) border.

`ProfileSwitcher.tsx`: `Профиль:` → `Проект:`, `Отдельный профиль` → `Отдельный проект`, `Профиль не найден` → `Проект не найден`.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: all PASS, tsc + build clean.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "Account page: Instagram full access, per-account reconnect, project breadcrumb"
```

---

### Task 11: Final verification and PR

- [ ] **Step 1: Full checks**

```bash
cd backend && npx jest && npm run build && npx tsc --noEmit -p tsconfig.json
cd ../frontend && npx vitest run && npx tsc -b && npm run build
```
Expected: everything passes. Then grep for leftovers: `grep -rn "Overview\|Compare\|/profiles/\${\|add=competitor\|instagram/connect', {" frontend/src backend/src` — only intended hits (API paths `/profiles/...` are fine; UI text must not say «профиль»: `grep -rn "рофил" frontend/src --include=*.tsx` should show only code identifiers/comments).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin projects-structure
"C:/Program Files/GitHub CLI/gh.exe" pr create --base master --title "Projects: home page, project form and tiles, guide, Instagram full access" --body "$(cat <<'BODY'
Sub-project 1 of the FD Agency brief. Spec: docs/superpowers/specs/2026-10-20-projects-structure-design.md

- Home page «Единый центр отчетности FD Agency», «Все проекты», «Как пользоваться» guide; Compare removed
- «Добавить проект»: name + Instagram/Telegram links (VK/YouTube «Скоро»); adds what it finds, reports the rest
- Project page: a tile per network, «+ Добавить …», «Убрать», «Удалить проект»; empty projects persist
- Instagram «Подключить полный доступ» (per-account login; also used for reconnect)

Deploy: run migrations (AddOauthStateAccount1790000000000). The Facebook login now returns to /projects?add=project.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
