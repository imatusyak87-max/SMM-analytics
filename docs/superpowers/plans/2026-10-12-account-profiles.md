# Account Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group accounts from different networks into profiles, so Overview shows one card per brand and a profile page lists its accounts.

**Architecture:** A new `profiles` table; every `accounts` row gets a required `profileId`. Small helpers in `backend/src/profiles/profile-store.ts` create profiles and delete empty ones inside the caller's transaction. Every account create, move and delete goes through them. A new `ProfilesModule` serves `/profiles` by grouping `StatsService.getOverview()` items. The frontend swaps Overview to `ProfileCard`s, adds `/profiles/:id`, a profile `<select>` on the account page, and a profile `<select>` in the add dialog.

**Tech Stack:** NestJS 11 + TypeORM 0.3 + Postgres (backend, Jest), React + Vite + react-router + CSS modules (frontend, Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-12-account-profiles-design.md`

## Global Constraints

- UI copy is Russian. The exact strings are given in each task. Use them verbatim.
- Dark-only theme: use the existing CSS tokens (`--bg`, `--border`, `--text`, `--text-h`, `--accent`, `--accent-bg`, `--accent-border`, `--on-accent`, `--danger`, `--shadow`, `--heading`, `--mono`). Never hard-code colours.
- No blended ER at profile level. The only profile-level metric is `totalFollowers`.
- Every create, move and delete path runs in one DB transaction. The API never leaves an empty profile or an account without one.
- Frontend tests: reset mocks with `vi.clearAllMocks()` in `beforeEach`, never `mockReset`, which breaks `mockRejectedValue`.
- Backend commands run from `backend/`, frontend commands from `frontend/`.
- No local Postgres or Docker. The migration is checked with a fake `QueryRunner` and actually runs on the VPS deploy.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Profile entity, account relation, migration, profile-store helpers

**Files:**
- Create: `backend/src/db/entities/profile.entity.ts`
- Modify: `backend/src/db/entities/account.entity.ts`
- Modify: `backend/src/db/entities/account.entity.spec.ts`
- Create: `backend/src/db/migrations/1789900000000-AddProfiles.ts`
- Create: `backend/src/db/migrations/add-profiles.migration.spec.ts`
- Modify: `backend/src/db/data-source.ts` (entities array)
- Modify: `backend/src/db/db.module.ts` (both entity arrays)
- Create: `backend/src/profiles/profile-store.ts`
- Create: `backend/src/profiles/profile-store.spec.ts`

**Interfaces:**
- Produces:
  - `class Profile { id: string; name: string; createdAt: Date }` (`profile.entity.ts`)
  - `Account.profileId: string`, `Account.profile?: Profile`
  - `PROFILE_NOT_FOUND = 'Профиль не найден'`
  - `createProfile(em: EntityManager, name: string): Promise<Profile>`
  - `deleteProfileIfEmpty(em: EntityManager, profileId: string): Promise<void>`
  - `requireProfile(em: EntityManager, id: string): Promise<Profile>` (throws `NotFoundException(PROFILE_NOT_FOUND)`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/db/entities/account.entity.spec.ts`, inside the existing `describe`:

```ts
  it('belongs to a profile through profileId', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (r) => r.target === Account && r.propertyName === 'profile',
    );
    expect(relation?.relationType).toBe('many-to-one');
    expect((relation?.type as () => unknown)()).toBe(Profile);

    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === Account && c.propertyName === 'profileId',
    );
    expect(column).toBeDefined();
  });
```

and add `import { Profile } from './profile.entity';` at the top.

Create `backend/src/profiles/profile-store.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { createProfile, deleteProfileIfEmpty, requireProfile, PROFILE_NOT_FOUND } from './profile-store';

function fakeEm(overrides: Record<string, jest.Mock> = {}) {
  return {
    save: jest.fn((_target: unknown, row: object) => Promise.resolve({ id: 'prof-new', ...row })),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn(),
    findOneBy: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as any;
}

describe('profile-store', () => {
  it('creates a profile with the given name', async () => {
    const em = fakeEm();

    const profile = await createProfile(em, 'Coffee Lab');

    expect(em.save).toHaveBeenCalledWith(Profile, { name: 'Coffee Lab' });
    expect(profile).toEqual({ id: 'prof-new', name: 'Coffee Lab' });
  });

  it('deletes a profile no account points to any more', async () => {
    const em = fakeEm({ count: jest.fn().mockResolvedValue(0) });

    await deleteProfileIfEmpty(em, 'prof-1');

    expect(em.count).toHaveBeenCalledWith(Account, { where: { profileId: 'prof-1' } });
    expect(em.delete).toHaveBeenCalledWith(Profile, { id: 'prof-1' });
  });

  it('keeps a profile that still has accounts', async () => {
    const em = fakeEm({ count: jest.fn().mockResolvedValue(2) });

    await deleteProfileIfEmpty(em, 'prof-1');

    expect(em.delete).not.toHaveBeenCalled();
  });

  it('returns an existing profile', async () => {
    const em = fakeEm({ findOneBy: jest.fn().mockResolvedValue({ id: 'prof-1', name: 'X' }) });

    await expect(requireProfile(em, 'prof-1')).resolves.toEqual({ id: 'prof-1', name: 'X' });
    expect(em.findOneBy).toHaveBeenCalledWith(Profile, { id: 'prof-1' });
  });

  it('throws a Russian 404 for a missing profile', async () => {
    const em = fakeEm();

    await expect(requireProfile(em, 'nope')).rejects.toThrow(new NotFoundException(PROFILE_NOT_FOUND));
  });
});
```

Create `backend/src/db/migrations/add-profiles.migration.spec.ts`:

```ts
import { AddProfiles1789900000000 } from './1789900000000-AddProfiles';

function recordingRunner() {
  const sql: string[] = [];
  return { sql, runner: { query: jest.fn((q: string) => { sql.push(q.replace(/\s+/g, ' ').trim()); }) } as any };
}

describe('AddProfiles migration', () => {
  it('gives every existing account its own profile before requiring one', async () => {
    const { sql, runner } = recordingRunner();

    await new AddProfiles1789900000000().up(runner);

    const createTable = sql.findIndex((q) => q.startsWith('CREATE TABLE "profiles"'));
    const addColumn = sql.findIndex((q) => q.includes('ADD "profileId" uuid'));
    const backfillProfiles = sql.findIndex((q) =>
      q.startsWith('INSERT INTO "profiles" ("id", "name", "createdAt") SELECT "id", "name", "createdAt" FROM "accounts"'),
    );
    const linkAccounts = sql.findIndex((q) => q === 'UPDATE "accounts" SET "profileId" = "id"');
    const notNull = sql.findIndex((q) => q.includes('ALTER COLUMN "profileId" SET NOT NULL'));
    const fk = sql.findIndex((q) => q.includes('FOREIGN KEY ("profileId") REFERENCES "profiles"("id")'));

    for (const index of [createTable, addColumn, backfillProfiles, linkAccounts, notNull, fk]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(createTable).toBeLessThan(backfillProfiles);
    expect(addColumn).toBeLessThan(linkAccounts);
    expect(backfillProfiles).toBeLessThan(linkAccounts);
    expect(linkAccounts).toBeLessThan(notNull);
    expect(notNull).toBeLessThan(fk);
  });

  it('drops the column before the table on the way down', async () => {
    const { sql, runner } = recordingRunner();

    await new AddProfiles1789900000000().down(runner);

    const dropColumn = sql.findIndex((q) => q.includes('DROP COLUMN "profileId"'));
    const dropTable = sql.findIndex((q) => q === 'DROP TABLE "profiles"');
    expect(dropColumn).toBeGreaterThanOrEqual(0);
    expect(dropColumn).toBeLessThan(dropTable);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx jest src/db src/profiles`
Expected: FAIL. The modules `./profile.entity`, `./profile-store` and `./1789900000000-AddProfiles` can't be found.

- [ ] **Step 3: Implement**

`backend/src/db/entities/profile.entity.ts`:

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** A brand or person; groups that one's accounts across networks. Never left without an account. */
@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @CreateDateColumn() createdAt: Date;
}
```

In `backend/src/db/entities/account.entity.ts`, extend the typeorm import to include `Index, JoinColumn, ManyToOne`, add `import { Profile } from './profile.entity';`, and add these members after `isActive`:

```ts
  @Index() @Column('uuid') profileId: string;
  @ManyToOne(() => Profile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'profileId' })
  profile?: Profile;
```

`backend/src/db/migrations/1789900000000-AddProfiles.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profiles group a brand's accounts across networks. Each existing account gets
 * a profile of its own, reusing the account's id and name so the backfill
 * needs no mapping table; the user merges them afterwards.
 */
export class AddProfiles1789900000000 implements MigrationInterface {
  name = 'AddProfiles1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profiles" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`ALTER TABLE "accounts" ADD "profileId" uuid`);
    await queryRunner.query(
      `INSERT INTO "profiles" ("id", "name", "createdAt") SELECT "id", "name", "createdAt" FROM "accounts"`,
    );
    await queryRunner.query(`UPDATE "accounts" SET "profileId" = "id"`);
    await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "profileId" SET NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_accounts_profileId" ON "accounts" ("profileId")`);
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "FK_accounts_profile" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_accounts_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_profileId"`);
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN "profileId"`);
    await queryRunner.query(`DROP TABLE "profiles"`);
  }
}
```

`backend/src/profiles/profile-store.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';

export const PROFILE_NOT_FOUND = 'Профиль не найден';

/*
 * Each helper takes the caller's EntityManager, so it runs inside the caller's
 * transaction: creating an account and its profile, or moving an account and
 * removing the profile it left empty, commit or fail together.
 */

export function createProfile(em: EntityManager, name: string): Promise<Profile> {
  return em.save(Profile, { name });
}

/** A profile must never outlive its last account. */
export async function deleteProfileIfEmpty(em: EntityManager, profileId: string): Promise<void> {
  const remaining = await em.count(Account, { where: { profileId } });
  if (remaining === 0) await em.delete(Profile, { id: profileId });
}

export async function requireProfile(em: EntityManager, id: string): Promise<Profile> {
  const profile = await em.findOneBy(Profile, { id });
  if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
  return profile;
}
```

Register `Profile` (import from `./entities/profile.entity`) in `backend/src/db/data-source.ts`'s `entities` array, and in **both** entity arrays in `backend/src/db/db.module.ts` (`forRoot` and `forFeature`).

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx jest src/db src/profiles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db backend/src/profiles
git commit -m "Add profiles table and give every account a profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Accounts get a profile on create, add-by-link and delete

**Files:**
- Modify: `backend/src/accounts/accounts.service.ts` (`create`, `createFromLink`, `remove`)
- Modify: `backend/src/accounts/dto/create-account-from-link.dto.ts`
- Modify: `backend/src/accounts/accounts.controller.ts` (`createFromLink`)
- Test: `backend/src/accounts/accounts.service.spec.ts`, `backend/src/accounts/accounts.controller.spec.ts`

**Interfaces:**
- Consumes (Task 1): `createProfile`, `deleteProfileIfEmpty`, `requireProfile`, `PROFILE_NOT_FOUND`, `Profile`, `Account.profileId`
- Produces: `AccountsService.createFromLink(link: string, profileId?: string): Promise<Account>`. `CreateAccountFromLinkDto.profileId?: string`.

- [ ] **Step 1: Teach the spec's fake repos about transactions**

In `backend/src/accounts/accounts.service.spec.ts`, add `import { Profile } from '../db/entities/profile.entity';` and this helper above `makeRepo`:

```ts
/**
 * Gives a fake repo a manager whose transaction hands out an EntityManager.
 * Account saves are routed to repo.save at call time, so the existing
 * repo.save assertions (and tests that swap repo.save) keep working.
 */
function withTransactions(repo: any) {
  const em = {
    save: jest.fn((target: unknown, row: any) =>
      target === Profile ? Promise.resolve({ id: 'prof-new', ...row }) : repo.save(row),
    ),
    count: jest.fn().mockResolvedValue(1),
    delete: jest.fn(),
    findOneBy: jest.fn().mockResolvedValue({ id: 'prof-1', name: 'Existing' }),
  };
  repo.em = em;
  repo.manager = {
    transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)),
    findOneBy: em.findOneBy,
  };
  return repo;
}
```

Change `makeRepo` to `return withTransactions({ ...same object... })`. In the `Instagram links` `setup()`, wrap its repo too: `const repo = withTransactions({ ... } as any);`.

In the `remove` describe, both hand-built `em` objects (in `makeRepoWithTransaction` and in the "deletes competitor runs" test) become:

```ts
const em = { delete: jest.fn(), count: jest.fn().mockResolvedValue(1) };
```

and both mocked accounts get a `profileId: 'prof-1'`, e.g. `makeRepoWithTransaction({ id: 'acc-1', profileId: 'prof-1' })`.

- [ ] **Step 2: Write the failing tests**

Add to the top-level `describe('AccountsService')`:

```ts
  it('creates a profile named after a manually created account', async () => {
    const repo = makeRepo({ id: 'acc-1' });
    const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

    await service.create({ platform: AccountPlatform.TELEGRAM, externalId: '@chan', name: 'Chan', type: AccountType.OWN });

    expect(repo.em.save).toHaveBeenCalledWith(Profile, { name: 'Chan' });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-new' }));
  });
```

Add to the `remove` describe:

```ts
    it('deletes the profile the account leaves empty', async () => {
      const { repo, em } = makeRepoWithTransaction({ id: 'acc-1', profileId: 'prof-1' });
      em.count.mockResolvedValue(0);
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await service.remove('acc-1');

      expect(em.delete).toHaveBeenLastCalledWith(Profile, { id: 'prof-1' });
    });
```

Update the existing "clears the data belonging to the account" test so it still passes. With `count` at 1, no `Profile` delete happens, so its `deletedTables` list stays the same.

Add to the `createFromLink` describe:

```ts
    it('puts a new account into a new profile named after it by default', async () => {
      const repo = makeRepo();
      const connector = { getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }) };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await service.createFromLink('https://t.me/somechannel');

      expect(repo.em.save).toHaveBeenCalledWith(Profile, { name: 'Some Channel' });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-new' }));
    });

    it('adds the account to the chosen profile', async () => {
      const repo = makeRepo();
      const connector = { getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }) };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await service.createFromLink('https://t.me/somechannel', 'prof-1');

      expect(repo.em.save).not.toHaveBeenCalledWith(Profile, expect.anything());
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-1' }));
    });

    it('refuses an unknown profile before asking the platform', async () => {
      const repo = makeRepo();
      repo.manager.findOneBy.mockResolvedValue(null);
      const connector = { getAccountInfo: jest.fn() };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel', 'gone')).rejects.toBeInstanceOf(NotFoundException);
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    // The profile can be deleted between the check and the insert; the FK catches it.
    it('maps a foreign-key violation to the same profile 404', async () => {
      const repo = makeRepo();
      repo.save = jest.fn().mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' }));
      const connector = { getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }) };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toBeInstanceOf(NotFoundException);
    });
```

In `backend/src/accounts/accounts.controller.spec.ts`, change the first test's call and assertion to:

```ts
    const result = await controller.createFromLink({ link: 'https://t.me/somechannel', profileId: 'prof-1' });

    expect(service.createFromLink).toHaveBeenCalledWith('https://t.me/somechannel', 'prof-1');
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `npx jest src/accounts`
Expected: FAIL on the new tests: no `Profile` save, no `profileId`, and no 404 for an unknown profile.

- [ ] **Step 4: Implement**

`create-account-from-link.dto.ts`:

```ts
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAccountFromLinkDto {
  @IsString() link: string;
  /** Profile to add the account to; a new one is created when absent. */
  @IsOptional() @IsUUID() profileId?: string;
}
```

`accounts.controller.ts`:

```ts
  @Post('from-link')
  createFromLink(@Body() dto: CreateAccountFromLinkDto) {
    return this.accountsService.createFromLink(dto.link, dto.profileId);
  }
```

`accounts.service.ts`:
- Add `import { createProfile, deleteProfileIfEmpty, requireProfile, PROFILE_NOT_FOUND } from '../profiles/profile-store';` (the service never names `Profile` itself).
- Add `const PG_FOREIGN_KEY_VIOLATION = '23503';` next to `PG_UNIQUE_VIOLATION`.
- Replace `create`:

```ts
  create(dto: CreateAccountDto) {
    return this.repo.manager.transaction(async (em) => {
      const profile = await createProfile(em, dto.name);
      return em.save(Account, { ...dto, avatarUrl: dto.avatarUrl ?? null, isActive: true, profileId: profile.id });
    });
  }
```

- In `createFromLink`, change the signature to `async createFromLink(link: string, profileId?: string)`. Right after the `findExisting` conflict check, add:

```ts
    // Checked before the platform call so a stale choice fails fast and cheaply.
    if (profileId) await requireProfile(this.repo.manager, profileId);
```

  Then replace the `account = await this.repo.save(this.repo.create({...}))` statement with:

```ts
      account = await this.repo.manager.transaction(async (em) => {
        const targetProfileId = profileId ?? (await createProfile(em, info.name)).id;
        return em.save(Account, {
          platform: parsed.platform,
          externalId: parsed.externalId,
          name: info.name,
          avatarUrl: info.avatarUrl,
          type: AccountType.PUBLIC_NO_ACCESS,
          isActive: true,
          profileId: targetProfileId,
        });
      });
```

  In the `catch`, after the unique-violation branch, add:

```ts
      if ((error as { code?: string }).code === PG_FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException(PROFILE_NOT_FOUND);
      }
```

- Replace `remove`:

```ts
  async remove(id: string) {
    const account = await this.findOne(id);
    await this.repo.manager.transaction(async (em) => {
      await em.delete(CompetitorRejection, { accountId: id });
      await em.delete(CompetitorSuggestion, { accountId: id });
      await em.delete(CompetitorRun, { accountId: id });
      await em.delete(Post, { accountId: id });
      await em.delete(AccountSnapshot, { accountId: id });
      await em.delete(SyncJob, { accountId: id });
      await em.delete(AccountCredential, { accountId: id });
      await em.delete(HistoryLoad, { accountId: id });
      await em.delete(Account, { id });
      await deleteProfileIfEmpty(em, account.profileId);
    });
  }
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `npx jest src/accounts`
Expected: PASS, including all the earlier tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/accounts
git commit -m "Create or reuse a profile when adding an account, and clean up empty ones on delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Instagram OAuth creates a profile for a new account

**Files:**
- Modify: `backend/src/connectors/instagram/instagram-oauth.service.ts` (new-account branch of `completeLogin`)
- Test: `backend/src/connectors/instagram/instagram-oauth.service.spec.ts`

**Interfaces:**
- Consumes (Task 1): `createProfile`, `Profile`, `Account.profileId`

- [ ] **Step 1: Give the fake accounts repo a transaction**

In `instagram-oauth.service.spec.ts`, add these imports:

```ts
import { Account } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { Profile } from '../../db/entities/profile.entity';
```

(merge `Account` into the existing `account.entity` import). In `makeDeps`, after `credentialsRepo` is declared, add:

```ts
  // Saves made inside the transaction land on the same repo mocks the tests assert on.
  const em = {
    save: jest.fn((target: unknown, row: any) => {
      if (target === Profile) return Promise.resolve({ id: 'prof-new', ...row });
      if (target === Account) return Promise.resolve(accountsRepo.save(row));
      if (target === AccountCredential) return Promise.resolve(credentialsRepo.save(row));
      throw new Error('unexpected save target');
    }),
  };
  (accountsRepo as any).manager = { transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)) };
```

Return `em` from `makeDeps` as well: `return { service, stateService, api, accountsRepo, credentialsRepo, em };`.

- [ ] **Step 2: Write the failing test**

```ts
  it('puts a newly connected account into a new profile named after it', async () => {
    const { service, stateService, api, accountsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '1' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ id: '1', username: 'brand', name: 'Brand', profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue(null);

    await service.completeLogin('a-code', 'good-state');

    expect(em.save).toHaveBeenCalledWith(Profile, { name: 'Brand' });
    expect(accountsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-new' }));
  });
```

Add it inside `describe('InstagramOauthService.completeLogin')`. Also extend the existing "writes (upserts) the credential … already tracked" test with `expect(em.save).not.toHaveBeenCalledWith(Profile, expect.anything());`.

- [ ] **Step 3: Run the tests and check they fail**

Run: `npx jest src/connectors/instagram/instagram-oauth.service.spec.ts`
Expected: FAIL on the new test, because nothing saves a `Profile`.

- [ ] **Step 4: Implement**

In `instagram-oauth.service.ts`, import `createProfile` from `'../../profiles/profile-store'`. Replace the new-account tail of `completeLogin` (from `const account = await this.accountsRepo.save({` through `return account;`) with:

```ts
    const name = profile.name ?? profile.username;
    return this.accountsRepo.manager.transaction(async (em) => {
      const group = await createProfile(em, name);
      const account = await em.save(Account, {
        platform: AccountPlatform.INSTAGRAM,
        externalId: instagramUserId,
        name,
        avatarUrl: profile.profilePictureUrl,
        type: type === InstagramAccountKind.OWN ? AccountType.OWN : AccountType.CLIENT,
        isActive: true,
        profileId: group.id,
      });
      await em.save(AccountCredential, { accountId: account.id, encryptedToken, tokenExpiresAt, needsReconnect: false });
      return account;
    });
```

(`group`, because `profile` already names the Instagram profile here.)

- [ ] **Step 5: Run the tests and check they pass**

Run: `npx jest src/connectors/instagram`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/connectors/instagram
git commit -m "Give an account connected through Instagram login its own profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stats — overview filter by profile, profile on account detail

**Files:**
- Modify: `backend/src/stats/stats.service.ts` (`getOverview`, `getAccountDetail`, constructor)
- Modify: `backend/src/stats/stats.module.ts` (add `Profile` to `forFeature`)
- Test: `backend/src/stats/stats.service.spec.ts`, plus any other spec that runs `new StatsService(` (find them with `grep -rn "new StatsService(" src`)

**Interfaces:**
- Consumes (Task 1): `Profile`, `Account.profileId`
- Produces:
  - `export interface OverviewItem { account: Account; latestSnapshot: AccountSnapshot | null }`
  - `StatsService.getOverview(profileId?: string): Promise<OverviewItem[]>`
  - `getAccountDetail(...)` result gains `profile: { id: string; name: string; accountCount: number }`
  - The constructor gains a 5th parameter: `@InjectRepository(Profile) profilesRepo: Repository<Profile>`

- [ ] **Step 1: Write the failing tests**

In `stats.service.spec.ts`'s `setup()`, change the account default to include `profileId: 'prof-1'`, and change the repos and constructor:

```ts
  const accountsRepo = {
    findOneBy: jest.fn().mockResolvedValue(account),
    count: jest.fn().mockResolvedValue(2),
    find: jest.fn().mockResolvedValue([]),
  } as any;
  ...
  const profilesRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'prof-1', name: 'Coffee Lab' }) } as any;
  return {
    service: new StatsService(accountsRepo, snapshotsRepo, postsRepo, credentialsRepo, profilesRepo),
    qb, snapshotsRepo, postsRepo, credentialsRepo, accountsRepo,
  };
```

Pass `profilesRepo` the same way to every other `new StatsService(` in the specs (`{ findOneBy: jest.fn() } as any` is enough wherever the detail isn't tested).

Add:

```ts
describe('StatsService profiles', () => {
  it('names the account\'s profile and how many active accounts it holds', async () => {
    const { service, accountsRepo } = setup();

    const result = await service.getAccountDetail('acc-1', period);

    expect(result.profile).toEqual({ id: 'prof-1', name: 'Coffee Lab', accountCount: 2 });
    expect(accountsRepo.count).toHaveBeenCalledWith({ where: { profileId: 'prof-1', isActive: true } });
  });

  it('limits the overview to one profile when asked', async () => {
    const { service, accountsRepo } = setup();

    await service.getOverview('prof-1');

    expect(accountsRepo.find).toHaveBeenCalledWith({ where: { isActive: true, profileId: 'prof-1' } });
  });

  it('lists every active account without a profile filter', async () => {
    const { service, accountsRepo } = setup();

    await service.getOverview();

    expect(accountsRepo.find).toHaveBeenCalledWith({ where: { isActive: true } });
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx jest src/stats`
Expected: FAIL. `profile` is undefined, and `find` is called without `profileId`.

- [ ] **Step 3: Implement**

In `stats.service.ts`, add `import { Profile } from '../db/entities/profile.entity';`, add the 5th constructor parameter `@InjectRepository(Profile) private profilesRepo: Repository<Profile>,`, and export:

```ts
export interface OverviewItem {
  account: Account;
  latestSnapshot: AccountSnapshot | null;
}
```

Replace `getOverview`:

```ts
  async getOverview(profileId?: string): Promise<OverviewItem[]> {
    const accounts = await this.accountsRepo.find({
      where: profileId ? { isActive: true, profileId } : { isActive: true },
    });
    const result: OverviewItem[] = [];
    for (const account of accounts) {
      const latestSnapshot = await this.snapshotsRepo.findOne({
        where: { accountId: account.id },
        order: { date: 'DESC' },
      });
      result.push({ account, latestSnapshot });
    }
    return result;
  }
```

In `getAccountDetail`, after the `credential` lookup add:

```ts
    // The page's profile switcher and breadcrumb need the name and the head count.
    const profile = await this.profilesRepo.findOneBy({ id: account.profileId });
    const accountCount = await this.accountsRepo.count({ where: { profileId: account.profileId, isActive: true } });
```

and add to the returned object, after `account,`:

```ts
      profile: { id: account.profileId, name: profile?.name ?? account.name, accountCount },
```

In `stats.module.ts` add `Profile` to the `TypeOrmModule.forFeature([...])` list (import it).

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx jest src/stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/stats
git commit -m "Report the account's profile on its detail and let the overview filter by profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ProfilesModule — list, get, rename, move account

**Files:**
- Create: `backend/src/profiles/profile-summary.ts`, `backend/src/profiles/profile-summary.spec.ts`
- Create: `backend/src/profiles/profiles.service.ts`, `backend/src/profiles/profiles.service.spec.ts`
- Create: `backend/src/profiles/dto/rename-profile.dto.ts`, `backend/src/profiles/dto/move-account.dto.ts`
- Create: `backend/src/profiles/profiles.controller.ts`, `backend/src/profiles/profiles.controller.spec.ts`
- Create: `backend/src/profiles/profiles.module.ts`
- Modify: `backend/src/app.module.ts` (import `ProfilesModule`)

**Interfaces:**
- Consumes: `OverviewItem` and `StatsService.getOverview(profileId?)` (Task 4). `createProfile`, `deleteProfileIfEmpty`, `requireProfile`, `PROFILE_NOT_FOUND` (Task 1).
- Produces (HTTP, for the frontend tasks):
  - `GET /profiles` → `ProfileSummary[]`
  - `GET /profiles/:id` → `ProfileSummary` (404 «Профиль не найден»)
  - `PATCH /profiles/:id` body `{ name }` → `Profile` (400 «Название профиля не может быть пустым»)
  - `PATCH /accounts/:id/profile` body `{ profileId }` or `{ newProfile: true }` → `{ profileId }`
  - `ProfileSummary = { id: string; name: string; totalFollowers: number | null; accounts: OverviewItem[] }`

- [ ] **Step 1: Write the failing tests**

`backend/src/profiles/profile-summary.spec.ts`:

```ts
import { toProfileSummary } from './profile-summary';

const item = (id: string, followers: number | null) =>
  ({ account: { id }, latestSnapshot: followers === null ? null : { followersCount: followers } }) as any;

describe('toProfileSummary', () => {
  const profile = { id: 'prof-1', name: 'Coffee Lab' } as any;

  it('sums followers and orders accounts by followers, unknown last', () => {
    const summary = toProfileSummary(profile, [item('tg', 100), item('none', null), item('ig', 900)]);

    expect(summary).toMatchObject({ id: 'prof-1', name: 'Coffee Lab', totalFollowers: 1000 });
    expect(summary.accounts.map((a) => a.account.id)).toEqual(['ig', 'tg', 'none']);
  });

  it('has no total when no account has been counted yet', () => {
    expect(toProfileSummary(profile, [item('a', null)]).totalFollowers).toBeNull();
  });
});
```

`backend/src/profiles/profiles.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { ProfilesService } from './profiles.service';

const overviewItem = (id: string, profileId: string, followers: number) =>
  ({ account: { id, profileId }, latestSnapshot: { followersCount: followers } }) as any;

function setup({
  profiles = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Inactive only' }],
  overview = [overviewItem('a1', 'p1', 10), overviewItem('a2', 'p2', 5), overviewItem('a3', 'p2', 7)],
  account = { id: 'a2', name: 'Acc', profileId: 'p2' } as object | null,
  target = { id: 'p1', name: 'One' } as object | null,
  remaining = 0,
} = {}) {
  const em = {
    findOneBy: jest.fn((entity: unknown) => Promise.resolve(entity === Account ? account : target)),
    save: jest.fn((_t: unknown, row: object) => Promise.resolve({ id: 'p-new', ...row })),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(remaining),
    delete: jest.fn(),
  };
  const profilesRepo = {
    find: jest.fn().mockResolvedValue(profiles),
    findOneBy: jest.fn(({ id }: { id: string }) => Promise.resolve(profiles.find((p) => p.id === id) ?? null)),
    save: jest.fn((p: object) => Promise.resolve(p)),
  } as any;
  const accountsRepo = { manager: { transaction: jest.fn((cb: (e: unknown) => unknown) => cb(em)) } } as any;
  const stats = { getOverview: jest.fn((profileId?: string) => Promise.resolve(overview.filter((i) => !profileId || i.account.profileId === profileId))) } as any;
  return { service: new ProfilesService(profilesRepo, accountsRepo, stats), em, profilesRepo, stats };
}

describe('ProfilesService.list', () => {
  it('groups active accounts under their profiles and skips profiles with none', async () => {
    const { service, profilesRepo } = setup();

    const result = await service.list();

    expect(profilesRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'ASC' } });
    expect(result.map((p) => [p.id, p.totalFollowers, p.accounts.map((a) => a.account.id)])).toEqual([
      ['p1', 10, ['a1']],
      ['p2', 12, ['a3', 'a2']],
    ]);
  });
});

describe('ProfilesService.get', () => {
  it('returns one profile with its accounts', async () => {
    const { service, stats } = setup();

    const result = await service.get('p2');

    expect(stats.getOverview).toHaveBeenCalledWith('p2');
    expect(result).toMatchObject({ id: 'p2', name: 'Two', totalFollowers: 12 });
  });

  it('404s for a missing profile', async () => {
    const { service } = setup();
    await expect(service.get('nope')).rejects.toThrow(new NotFoundException('Профиль не найден'));
  });
});

describe('ProfilesService.rename', () => {
  it('saves a trimmed name', async () => {
    const { service, profilesRepo } = setup();

    await service.rename('p1', '  Coffee Lab  ');

    expect(profilesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Coffee Lab' }));
  });

  it('rejects a blank name', async () => {
    const { service, profilesRepo } = setup();

    await expect(service.rename('p1', '   ')).rejects.toThrow(
      new BadRequestException('Название профиля не может быть пустым'),
    );
    expect(profilesRepo.save).not.toHaveBeenCalled();
  });

  it('404s for a missing profile', async () => {
    const { service } = setup();
    await expect(service.rename('nope', 'X')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProfilesService.moveAccount', () => {
  it('moves the account and removes the profile it left empty', async () => {
    const { service, em } = setup({ remaining: 0 });

    const result = await service.moveAccount('a2', { profileId: 'p1' });

    expect(em.update).toHaveBeenCalledWith(Account, { id: 'a2' }, { profileId: 'p1' });
    expect(em.delete).toHaveBeenCalledWith(Profile, { id: 'p2' });
    expect(result).toEqual({ profileId: 'p1' });
  });

  it('keeps the old profile while it still has accounts', async () => {
    const { service, em } = setup({ remaining: 1 });

    await service.moveAccount('a2', { profileId: 'p1' });

    expect(em.delete).not.toHaveBeenCalled();
  });

  it('splits the account into a new profile named after it', async () => {
    const { service, em } = setup({ remaining: 1 });

    const result = await service.moveAccount('a2', { newProfile: true });

    expect(em.save).toHaveBeenCalledWith(Profile, { name: 'Acc' });
    expect(em.update).toHaveBeenCalledWith(Account, { id: 'a2' }, { profileId: 'p-new' });
    expect(result).toEqual({ profileId: 'p-new' });
  });

  it('does nothing when the account is already in that profile', async () => {
    const { service, em } = setup();

    const result = await service.moveAccount('a2', { profileId: 'p2' });

    expect(em.update).not.toHaveBeenCalled();
    expect(result).toEqual({ profileId: 'p2' });
  });

  it('404s for a missing account', async () => {
    const { service } = setup({ account: null });
    await expect(service.moveAccount('gone', { profileId: 'p1' })).rejects.toThrow(
      new NotFoundException('Аккаунт не найден'),
    );
  });

  it('404s for a missing target profile', async () => {
    const { service, em } = setup({ target: null });

    await expect(service.moveAccount('a2', { profileId: 'gone' })).rejects.toThrow(
      new NotFoundException('Профиль не найден'),
    );
    expect(em.update).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ profileId: 'p1', newProfile: true }], [{ newProfile: false }]])(
    'needs exactly one destination (%j)',
    async (target) => {
      const { service } = setup();
      await expect(service.moveAccount('a2', target)).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
```

`backend/src/profiles/profiles.controller.spec.ts`:

```ts
import { ProfilesController } from './profiles.controller';

describe('ProfilesController', () => {
  function build() {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({}),
      rename: jest.fn().mockResolvedValue({}),
      moveAccount: jest.fn().mockResolvedValue({ profileId: 'p1' }),
    } as any;
    return { controller: new ProfilesController(service), service };
  }

  it('lists profiles', async () => {
    const { controller, service } = build();
    await controller.list();
    expect(service.list).toHaveBeenCalled();
  });

  it('gets one profile', async () => {
    const { controller, service } = build();
    await controller.get('p1');
    expect(service.get).toHaveBeenCalledWith('p1');
  });

  it('renames a profile', async () => {
    const { controller, service } = build();
    await controller.rename('p1', { name: 'New' });
    expect(service.rename).toHaveBeenCalledWith('p1', 'New');
  });

  it('moves an account', async () => {
    const { controller, service } = build();
    const result = await controller.moveAccount('a1', { newProfile: true });
    expect(service.moveAccount).toHaveBeenCalledWith('a1', { newProfile: true });
    expect(result).toEqual({ profileId: 'p1' });
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx jest src/profiles`
Expected: FAIL. The modules `./profile-summary`, `./profiles.service` and `./profiles.controller` can't be found.

- [ ] **Step 3: Implement**

`backend/src/profiles/profile-summary.ts`:

```ts
import { Profile } from '../db/entities/profile.entity';
import type { OverviewItem } from '../stats/stats.service';

export interface ProfileSummary {
  id: string;
  name: string;
  /** Followers summed across networks; null until any account has been counted. ER is never blended. */
  totalFollowers: number | null;
  accounts: OverviewItem[];
}

const followersOf = (item: OverviewItem) => item.latestSnapshot?.followersCount ?? null;

export function toProfileSummary(profile: Profile, items: OverviewItem[]): ProfileSummary {
  const accounts = [...items].sort((a, b) => (followersOf(b) ?? -1) - (followersOf(a) ?? -1));
  const counted = accounts.map(followersOf).filter((n): n is number => n !== null);
  return {
    id: profile.id,
    name: profile.name,
    totalFollowers: counted.length > 0 ? counted.reduce((sum, n) => sum + n, 0) : null,
    accounts,
  };
}
```

`backend/src/profiles/dto/rename-profile.dto.ts`:

```ts
import { IsString, MaxLength } from 'class-validator';

export class RenameProfileDto {
  @IsString() @MaxLength(100) name: string;
}
```

`backend/src/profiles/dto/move-account.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Exactly one of the two; the service enforces that. */
export class MoveAccountDto {
  @IsOptional() @IsUUID() profileId?: string;
  @IsOptional() @IsBoolean() newProfile?: boolean;
}
```

`backend/src/profiles/profiles.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { StatsService } from '../stats/stats.service';
import { createProfile, deleteProfileIfEmpty, requireProfile, PROFILE_NOT_FOUND } from './profile-store';
import { ProfileSummary, toProfileSummary } from './profile-summary';
import type { MoveAccountDto } from './dto/move-account.dto';

const EMPTY_NAME = 'Название профиля не может быть пустым';
const ACCOUNT_NOT_FOUND = 'Аккаунт не найден';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile) private profilesRepo: Repository<Profile>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    private stats: StatsService,
  ) {}

  async list(): Promise<ProfileSummary[]> {
    const [profiles, items] = await Promise.all([
      this.profilesRepo.find({ order: { createdAt: 'ASC' } }),
      this.stats.getOverview(),
    ]);
    // A profile whose accounts are all deactivated has nothing to show.
    return profiles
      .map((profile) => toProfileSummary(profile, items.filter((item) => item.account.profileId === profile.id)))
      .filter((summary) => summary.accounts.length > 0);
  }

  async get(id: string): Promise<ProfileSummary> {
    const profile = await this.findOne(id);
    return toProfileSummary(profile, await this.stats.getOverview(id));
  }

  async rename(id: string, name: string): Promise<Profile> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException(EMPTY_NAME);
    const profile = await this.findOne(id);
    profile.name = trimmed;
    return this.profilesRepo.save(profile);
  }

  async moveAccount(accountId: string, target: MoveAccountDto): Promise<{ profileId: string }> {
    const hasId = typeof target.profileId === 'string';
    const wantsNew = target.newProfile === true;
    if (hasId === wantsNew) throw new BadRequestException('Укажите либо profileId, либо newProfile');

    return this.accountsRepo.manager.transaction(async (em) => {
      const account = await em.findOneBy(Account, { id: accountId });
      if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
      if (hasId && target.profileId === account.profileId) return { profileId: account.profileId };

      const destination = hasId
        ? (await requireProfile(em, target.profileId!)).id
        : (await createProfile(em, account.name)).id;
      const left = account.profileId;
      await em.update(Account, { id: accountId }, { profileId: destination });
      await deleteProfileIfEmpty(em, left);
      return { profileId: destination };
    });
  }

  private async findOne(id: string): Promise<Profile> {
    const profile = await this.profilesRepo.findOneBy({ id });
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }
}
```

`backend/src/profiles/profiles.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { RenameProfileDto } from './dto/rename-profile.dto';
import { MoveAccountDto } from './dto/move-account.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProfilesController {
  constructor(private profilesService: ProfilesService) {}

  @Get('profiles')
  list() {
    return this.profilesService.list();
  }

  @Get('profiles/:id')
  get(@Param('id') id: string) {
    return this.profilesService.get(id);
  }

  @Patch('profiles/:id')
  rename(@Param('id') id: string, @Body() dto: RenameProfileDto) {
    return this.profilesService.rename(id, dto.name);
  }

  @Patch('accounts/:id/profile')
  moveAccount(@Param('id') id: string, @Body() dto: MoveAccountDto) {
    return this.profilesService.moveAccount(id, dto);
  }
}
```

`backend/src/profiles/profiles.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { StatsModule } from '../stats/stats.module';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Account]), StatsModule],
  providers: [ProfilesService],
  controllers: [ProfilesController],
})
export class ProfilesModule {}
```

In `backend/src/app.module.ts`, import `ProfilesModule` from `'./profiles/profiles.module'` and add it to `imports` after `StatsModule`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx jest src/profiles`
Expected: PASS.

- [ ] **Step 5: Run the whole backend suite and the build**

Run: `npx jest; npm run build; npm run lint`
Expected: all tests pass, the build succeeds, and lint reports no errors. If lint `--fix` reformatted files, include them in the commit.

- [ ] **Step 6: Commit**

```bash
git add backend/src
git commit -m "Add profile endpoints: list, get, rename, and move an account between profiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ProfileCard component

**Files:**
- Create: `frontend/src/profiles.ts`
- Create: `frontend/src/components/ProfileCard.tsx`, `frontend/src/components/ProfileCard.module.css`
- Test: `frontend/src/components/ProfileCard.test.tsx`

**Interfaces:**
- Produces:
  - `frontend/src/profiles.ts`: `ProfileAccountItem`, `ProfileSummary` (mirrors the backend shape), `profileHref(profile: ProfileSummary): string`
  - `ProfileCard({ profile }: { profile: ProfileSummary })`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/ProfileCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileCard } from './ProfileCard';
import type { ProfileSummary } from '../profiles';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: new Blob() }) } }));

const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

const item = (id: string, platform: string, followers: number) => ({
  account: { id, platform, name: id, avatarUrl: null, type: 'public_no_access' },
  latestSnapshot: { followersCount: followers, avgEr: 2 },
});

function renderCard(profile: ProfileSummary) {
  return render(<MemoryRouter><ProfileCard profile={profile} /></MemoryRouter>);
}

describe('ProfileCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the profile name, an icon per network and total followers', () => {
    renderCard({
      id: 'p1', name: 'Coffee Lab', totalFollowers: 12500,
      accounts: [item('ig', 'instagram', 10000), item('tg', 'telegram', 2500)],
    });

    expect(screen.getByText('Coffee Lab')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'instagram' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'telegram' })).toBeInTheDocument();
    expect(screen.getByText(digits('12500'))).toBeInTheDocument();
    expect(screen.queryByText('ER')).not.toBeInTheDocument();
  });

  it('opens the profile page when it holds several accounts', () => {
    renderCard({ id: 'p1', name: 'Coffee Lab', totalFollowers: 3, accounts: [item('a', 'telegram', 2), item('b', 'instagram', 1)] });

    expect(screen.getByTestId('profile-card')).toHaveAttribute('href', '/profiles/p1');
  });

  it('opens the account directly when it is the only one', () => {
    renderCard({ id: 'p1', name: 'Solo', totalFollowers: 2, accounts: [item('acc-9', 'telegram', 2)] });

    expect(screen.getByTestId('profile-card')).toHaveAttribute('href', '/accounts/acc-9');
  });

  it('shows a dash before any followers are counted', () => {
    renderCard({
      id: 'p1', name: 'New', totalFollowers: null,
      accounts: [{ ...item('a', 'telegram', 0), latestSnapshot: null }],
    });

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run src/components/ProfileCard.test.tsx`
Expected: FAIL. `./ProfileCard` can't be resolved.

- [ ] **Step 3: Implement**

`frontend/src/profiles.ts`:

```ts
/** Shapes served by GET /profiles and GET /profiles/:id. */
export interface ProfileAccountItem {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  totalFollowers: number | null;
  /** Most followers first; never empty. */
  accounts: ProfileAccountItem[];
}

/** A profile page with one account on it would be a needless extra click. */
export function profileHref(profile: ProfileSummary): string {
  return profile.accounts.length === 1 ? `/accounts/${profile.accounts[0].account.id}` : `/profiles/${profile.id}`;
}
```

`frontend/src/components/ProfileCard.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { formatCount } from '../format';
import { profileHref, type ProfileSummary } from '../profiles';
import { PlatformIcon } from './PlatformIcon';
import { useAvatar } from './useAvatar';
import styles from './ProfileCard.module.css';

export function ProfileCard({ profile }: { profile: ProfileSummary }) {
  // The biggest account stands for the brand.
  const lead = profile.accounts[0].account;
  const avatarSrc = useAvatar(lead.id, lead.avatarUrl !== null);

  return (
    <Link to={profileHref(profile)} className={styles.card} data-testid="profile-card">
      <div className={styles.identity}>
        {avatarSrc ? (
          <img className={styles.avatar} src={avatarSrc} alt={profile.name} />
        ) : (
          <div className={styles.avatarFallback} aria-hidden="true" />
        )}
        <div className={styles.identityText}>
          <span className={styles.networks}>
            {profile.accounts.map(({ account }) => (
              <PlatformIcon key={account.id} platform={account.platform} />
            ))}
          </span>
          <h3 className={styles.name}>{profile.name}</h3>
        </div>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Подписчики</span>
        <span className={styles.statValue}>{formatCount(profile.totalFollowers)}</span>
      </div>
    </Link>
  );
}
```

`frontend/src/components/ProfileCard.module.css`:

```css
.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.card:hover,
.card:focus-visible {
  border-color: var(--accent-border);
  box-shadow: var(--shadow);
  outline: none;
}

.identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.avatar,
.avatarFallback {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.avatarFallback {
  background: var(--accent-bg);
}

.identityText {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  min-width: 0;
}

.networks {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  background: var(--accent-bg);
  border-radius: 999px;
  padding: 3px 10px;
}

.name {
  margin: 0;
  font-family: var(--heading);
  font-size: 17px;
  font-weight: 600;
  color: var(--text-h);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: auto;
}

.statLabel {
  font-size: 12px;
  color: var(--text);
}

.statValue {
  font-family: var(--mono);
  font-size: 19px;
  font-weight: 600;
  color: var(--text-h);
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run src/components/ProfileCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/profiles.ts frontend/src/components/ProfileCard.*
git commit -m "Add a profile card showing a brand's networks and total followers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Overview shows profile cards

**Files:**
- Modify: `frontend/src/pages/OverviewPage.tsx`
- Test: `frontend/src/pages/OverviewPage.test.tsx`

**Interfaces:**
- Consumes: `ProfileSummary` (Task 6), `ProfileCard` (Task 6), `GET /profiles` (Task 5)
- Produces: `OverviewPage` passes `profiles={items.map(({ id, name }) => ({ id, name }))}` to `AddAccountModal`. The prop is added in Task 8, and until then TypeScript rejects it, so this task does **not** pass it yet.

- [ ] **Step 1: Update the tests to expect profiles**

In `OverviewPage.test.tsx`:
- Change `overviewCalls` to count `'/profiles'`:

```ts
const overviewCalls = () => (apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === '/profiles').length;
```

- Replace the test `'renders a card per account with followers and ER'` with:

```tsx
  it('renders a card per profile with its total followers', async () => {
    mockGets([
      {
        id: 'p1', name: 'Coffee Lab', totalFollowers: 1234,
        accounts: [
          { account: { id: 'acc-1', platform: 'telegram', name: 'Chan', avatarUrl: null, type: 'own' },
            latestSnapshot: { followersCount: 1000, avgEr: 3.2 } },
          { account: { id: 'acc-2', platform: 'instagram', name: 'chan_ig', avatarUrl: null, type: 'own' },
            latestSnapshot: { followersCount: 234, avgEr: 1.1 } },
        ],
      },
    ]);

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    expect(await screen.findByText('Coffee Lab')).toBeInTheDocument();
    expect(screen.getAllByTestId('profile-card')).toHaveLength(1);
    expect(screen.getByText((text) => text.replace(/\s/g, '') === '1234')).toBeInTheDocument();
    expect(screen.queryByText('Chan')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx`
Expected: FAIL. The page still requests `/stats/overview` and renders `AccountCard`.

- [ ] **Step 3: Implement**

In `OverviewPage.tsx`:
- Remove the `AccountCard` import and the `OverviewItem` interface. Import `ProfileCard` from `'../components/ProfileCard'` and `type ProfileSummary` from `'../profiles'`.
- `useState<OverviewItem[]>` → `useState<ProfileSummary[]>`.
- In `load`, `.get('/stats/overview')` → `.get('/profiles')`.
- Replace the grid body with:

```tsx
        <div className={styles.grid}>
          {items.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} />
          ))}
        </div>
```

(Overview has no delete button any more, by design: deletes happen per account on the profile or account page.)

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/OverviewPage.*
git commit -m "Show one card per profile on Overview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Choose a profile in the add dialog

**Files:**
- Modify: `frontend/src/components/AddAccountModal.tsx`
- Modify: `frontend/src/pages/OverviewPage.tsx` (pass `profiles`)
- Test: `frontend/src/components/AddAccountModal.test.tsx`

**Interfaces:**
- Consumes: `POST /accounts/from-link` accepting `profileId` (Task 2)
- Produces: `AddAccountModalProps.profiles?: Array<{ id: string; name: string }>`, defaulting to `[]`.

- [ ] **Step 1: Write the failing tests**

Add to `AddAccountModal.test.tsx` (it already mocks `apiClient.post`, and `previewData`/`pasteLink` exist):

```tsx
describe('choosing a profile', () => {
  beforeEach(() => vi.clearAllMocks());

  const profiles = [{ id: 'p1', name: 'Coffee Lab' }, { id: 'p2', name: 'Tea House' }];

  it('adds to a new profile unless told otherwise', async () => {
    (apiClient.post as any).mockResolvedValueOnce({ data: previewData }).mockResolvedValueOnce({ data: { id: 'acc-1' } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} profiles={profiles} />);

    expect(screen.getByLabelText('Профиль')).toHaveValue('');
    pasteLink();
    fireEvent.click(await screen.findByText('Добавить'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenLastCalledWith('/accounts/from-link', { link: 'https://t.me/somechannel' }),
    );
  });

  it('adds to the chosen profile', async () => {
    (apiClient.post as any).mockResolvedValueOnce({ data: previewData }).mockResolvedValueOnce({ data: { id: 'acc-1' } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} profiles={profiles} />);

    fireEvent.change(screen.getByLabelText('Профиль'), { target: { value: 'p2' } });
    pasteLink();
    fireEvent.click(await screen.findByText('Добавить'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenLastCalledWith('/accounts/from-link', {
        link: 'https://t.me/somechannel',
        profileId: 'p2',
      }),
    );
  });

  it('has no profile choice when there are no profiles yet', () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.queryByLabelText('Профиль')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run src/components/AddAccountModal.test.tsx`
Expected: FAIL. There's no «Профиль» field.

- [ ] **Step 3: Implement**

In `AddAccountModal.tsx`:
- Add to `AddAccountModalProps`:

```ts
  /** Existing profiles the new account can join; empty means it always gets its own. */
  profiles?: Array<{ id: string; name: string }>;
```

- Destructure `profiles = []` in the component signature, and add state `const [profileId, setProfileId] = useState('');` next to `link`.
- In `handleAdd`, replace the post call with:

```ts
      await apiClient.post('/accounts/from-link', profileId ? { link: link.trim(), profileId } : { link: link.trim() });
```

- In the competitor tab, directly after the `<input id="account-link" … />` element, add:

```tsx
            {profiles.length > 0 && (
              <>
                <label className={styles.label} htmlFor="account-profile">
                  Профиль
                </label>
                <select
                  id="account-profile"
                  className={styles.input}
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                >
                  <option value="">Новый профиль</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </>
            )}
```

In `OverviewPage.tsx`, pass the profiles to the modal:

```tsx
      {isAdding && (
        <AddAccountModal
          onClose={closeAdding}
          onCreated={handleCreated}
          initialError={addError}
          profiles={items.map(({ id, name }) => ({ id, name }))}
        />
      )}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run src/components/AddAccountModal.test.tsx src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AddAccountModal.* frontend/src/pages/OverviewPage.tsx
git commit -m "Let the add dialog put a competitor into an existing profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Profile page

**Files:**
- Create: `frontend/src/pages/ProfilePage.tsx`, `frontend/src/pages/ProfilePage.module.css`
- Modify: `frontend/src/App.tsx` (route)
- Test: `frontend/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `GET /profiles/:id`, `PATCH /profiles/:id` (Task 5). `ProfileSummary` (Task 6). The existing `AccountCard({ account, latestSnapshot, onDeleted })`.

- [ ] **Step 1: Write the failing test**

`frontend/src/pages/ProfilePage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfilePage } from './ProfilePage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const get = apiClient.get as any;
const patch = apiClient.patch as any;
const del = apiClient.delete as any;

const item = (id: string, name: string, platform: string, followers: number) => ({
  account: { id, platform, name, avatarUrl: null, type: 'own' },
  latestSnapshot: { followersCount: followers, avgEr: 1.5 },
});

const twoAccounts = {
  id: 'p1', name: 'Coffee Lab', totalFollowers: 1500,
  accounts: [item('acc-ig', 'coffee_ig', 'instagram', 1000), item('acc-tg', 'Coffee TG', 'telegram', 500)],
};

function mockProfile(data: unknown = twoAccounts) {
  get.mockImplementation((url: string) =>
    url === '/profiles/p1' ? Promise.resolve({ data }) : Promise.resolve({ data: new Blob() }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profiles/p1']}>
      <Routes>
        <Route path="/profiles/:id" element={<ProfilePage />} />
        <Route path="/" element={<p>Overview page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the profile and a card for each of its accounts', async () => {
    mockProfile();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(screen.getAllByTestId('account-card')).toHaveLength(2);
    expect(screen.getByText('coffee_ig')).toBeInTheDocument();
    expect(screen.getByText('Coffee TG')).toBeInTheDocument();
  });

  it('renames the profile on Enter', async () => {
    mockProfile();
    patch.mockResolvedValue({ data: {} });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: 'Coffee Lab Moscow' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/profiles/p1', { name: 'Coffee Lab Moscow' }));
  });

  it('cancels a rename on Escape', async () => {
    mockProfile();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows why a rename failed', async () => {
    mockProfile();
    patch.mockRejectedValue({ response: { data: { message: 'Название профиля не может быть пустым' } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Название профиля не может быть пустым');
  });

  it('says so when the profile does not exist', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText('Профиль не найден')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Вернуться к обзору' })).toHaveAttribute('href', '/');
  });

  it('goes back to Overview after deleting its last account', async () => {
    mockProfile({ ...twoAccounts, accounts: [twoAccounts.accounts[0]] });
    del.mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить аккаунт' }));

    expect(await screen.findByText('Overview page')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run src/pages/ProfilePage.test.tsx`
Expected: FAIL. `./ProfilePage` can't be resolved.

- [ ] **Step 3: Implement**

`frontend/src/pages/ProfilePage.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import { AccountCard } from '../components/AccountCard';
import { formatCount } from '../format';
import type { ProfileSummary } from '../profiles';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const profile = useApiGet<ProfileSummary>(`/profiles/${id}`, {}, { reloadKey });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  // Escape blurs the input too; this tells the blur handler not to save.
  const cancelled = useRef(false);

  if (profile.error) {
    const status = (profile.error as { response?: { status?: number } }).response?.status;
    return (
      <div className={styles.page}>
        <p className={styles.error} role="alert">
          {status === 404 ? 'Профиль не найден' : 'Не удалось загрузить профиль'}
        </p>
        <Link to="/" className={styles.back}>
          Вернуться к обзору
        </Link>
      </div>
    );
  }

  if (!profile.data) return <p className={styles.loading}>Загрузка…</p>;

  const { name, totalFollowers, accounts } = profile.data;

  function startEditing() {
    setDraft(name);
    setRenameError(null);
    cancelled.current = false;
    setEditing(true);
  }

  async function finishEditing() {
    setEditing(false);
    if (cancelled.current || draft === name) return;
    try {
      await apiClient.patch(`/profiles/${id}`, { name: draft });
      setReloadKey((key) => key + 1);
    } catch (err: any) {
      setRenameError(err.response?.data?.message ?? 'Не удалось переименовать профиль');
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        {editing ? (
          <input
            className={styles.nameInput}
            aria-label="Название профиля"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <>
            <h2 className={styles.heading}>{name}</h2>
            <button type="button" className={styles.rename} aria-label="Переименовать" onClick={startEditing}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M11.3 1.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-8.5 8.5-3.4.9a.5.5 0 0 1-.6-.6l.9-3.4 8.2-8.8Z"
                />
              </svg>
            </button>
          </>
        )}
        <span className={styles.total}>
          Подписчики: <span className={styles.totalValue}>{formatCount(totalFollowers)}</span>
        </span>
      </div>
      {renameError && (
        <p className={styles.error} role="alert">
          {renameError}
        </p>
      )}
      <div className={styles.grid}>
        {accounts.map((item) => (
          <AccountCard
            key={item.account.id}
            account={item.account}
            latestSnapshot={item.latestSnapshot}
            // The last account takes the profile with it, so there is nothing left to show here.
            onDeleted={() => (accounts.length <= 1 ? navigate('/') : setReloadKey((key) => key + 1))}
          />
        ))}
      </div>
    </div>
  );
}
```

`frontend/src/pages/ProfilePage.module.css`:

```css
.page {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.heading {
  margin: 0;
  font-family: var(--heading);
  font-size: 22px;
  font-weight: 600;
  color: var(--text-h);
}

.rename {
  display: flex;
  padding: 5px;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.rename:hover,
.rename:focus-visible {
  color: var(--accent);
  background: var(--accent-bg);
  outline: none;
}

.nameInput {
  font-family: var(--heading);
  font-size: 22px;
  font-weight: 600;
  color: var(--text-h);
  background: var(--bg);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  padding: 2px 8px;
  min-width: 0;
  max-width: 100%;
}

.total {
  margin-left: auto;
  font-size: 14px;
  color: var(--text);
}

.totalValue {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--text-h);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.loading,
.error {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}

.error {
  color: var(--text-h);
  font-weight: 500;
}

.back {
  color: var(--accent);
  font-size: 14px;
}
```

In `frontend/src/App.tsx`, import `ProfilePage` from `'./pages/ProfilePage'` and add after the `/accounts/:id` route:

```tsx
          <Route
            path="/profiles/:id"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run src/pages/ProfilePage.test.tsx src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ProfilePage.* frontend/src/App.tsx
git commit -m "Add a profile page listing a brand's accounts, with inline rename

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Move an account between profiles from its page, and a breadcrumb back

**Files:**
- Create: `frontend/src/components/ProfileSwitcher.tsx`, `frontend/src/components/ProfileSwitcher.module.css`
- Test: `frontend/src/components/ProfileSwitcher.test.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`, `frontend/src/pages/AccountDetailPage.module.css`
- Test: `frontend/src/pages/AccountDetailPage.test.tsx`

**Interfaces:**
- Consumes: `GET /profiles`, `PATCH /accounts/:id/profile` (Task 5). `profile` on `/accounts/:id/detail` (Task 4). `ProfileSummary` (Task 6).
- Produces: `ProfileSwitcher({ accountId, profile, onMoved }: { accountId: string; profile: { id: string; name: string; accountCount: number }; onMoved: () => void })`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ProfileSwitcher.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileSwitcher } from './ProfileSwitcher';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));

const get = apiClient.get as any;
const patch = apiClient.patch as any;

const summary = (id: string, name: string, platforms: string[]) => ({
  id, name, totalFollowers: 1,
  accounts: platforms.map((platform, i) => ({
    account: { id: `${id}-${i}`, platform, name, avatarUrl: null, type: 'own' },
    latestSnapshot: null,
  })),
});

const current = { id: 'p1', name: 'Coffee Lab', accountCount: 2 };

describe('ProfileSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: [summary('p1', 'Coffee Lab', ['telegram', 'instagram']), summary('p2', 'Tea House', ['telegram'])] });
  });

  it('shows the current profile and offers the others plus a separate one', async () => {
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={vi.fn()} />);

    const select = screen.getByLabelText('Профиль:');
    expect(select).toHaveValue('p1');
    expect(await screen.findByRole('option', { name: 'Tea House (telegram)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Отдельный профиль' })).toBeInTheDocument();
  });

  it('has no separate-profile option for an account that is already alone', async () => {
    render(<ProfileSwitcher accountId="acc-1" profile={{ ...current, accountCount: 1 }} onMoved={vi.fn()} />);

    await screen.findByRole('option', { name: 'Tea House (telegram)' });
    expect(screen.queryByRole('option', { name: 'Отдельный профиль' })).not.toBeInTheDocument();
  });

  it('moves the account to the chosen profile', async () => {
    patch.mockResolvedValue({ data: { profileId: 'p2' } });
    const onMoved = vi.fn();
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={onMoved} />);
    await screen.findByRole('option', { name: 'Tea House (telegram)' });

    fireEvent.change(screen.getByLabelText('Профиль:'), { target: { value: 'p2' } });

    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/accounts/acc-1/profile', { profileId: 'p2' });
  });

  it('splits the account into a profile of its own', async () => {
    patch.mockResolvedValue({ data: { profileId: 'p-new' } });
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Профиль:'), { target: { value: '__new__' } });

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/accounts/acc-1/profile', { newProfile: true }));
  });

  it('says the profile is gone and refreshes the list', async () => {
    patch.mockRejectedValue({ response: { status: 404 } });
    const onMoved = vi.fn();
    render(<ProfileSwitcher accountId="acc-1" profile={current} onMoved={onMoved} />);
    await screen.findByRole('option', { name: 'Tea House (telegram)' });

    fireEvent.change(screen.getByLabelText('Профиль:'), { target: { value: 'p2' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Профиль не найден');
    await waitFor(() => expect(get.mock.calls.filter(([url]: [string]) => url === '/profiles')).toHaveLength(2));
    expect(onMoved).not.toHaveBeenCalled();
  });
});
```

In `AccountDetailPage.test.tsx`:
- Change the mock to `vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));`.
- Add `profile: { id: 'prof-1', name: 'Coffee Lab', accountCount: 1 },` to the object returned by `detail()`.
- Add these tests:

```tsx
describe('profile', () => {
  it('shows which profile the account is in', async () => {
    mockApi();
    renderPage();

    expect(await screen.findByLabelText('Профиль:')).toHaveValue('prof-1');
  });

  it('links back to a profile that holds several accounts', async () => {
    mockApi({ detailData: { ...detail(), profile: { id: 'prof-1', name: 'Coffee Lab', accountCount: 3 } } });
    renderPage();

    expect(await screen.findByRole('link', { name: '← Coffee Lab' })).toHaveAttribute('href', '/profiles/prof-1');
  });

  it('has no breadcrumb for an account alone in its profile', async () => {
    mockApi();
    renderPage();

    await screen.findByLabelText('Профиль:');
    expect(screen.queryByRole('link', { name: '← Coffee Lab' })).not.toBeInTheDocument();
  });
});
```

(`mockApi` already answers any other URL, including `/profiles`, with `{ data: [] }`.)

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run src/components/ProfileSwitcher.test.tsx src/pages/AccountDetailPage.test.tsx`
Expected: FAIL. `./ProfileSwitcher` can't be resolved, and the detail page has no «Профиль:» field.

- [ ] **Step 3: Implement**

`frontend/src/components/ProfileSwitcher.tsx`:

```tsx
import { useState } from 'react';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import type { ProfileSummary } from '../profiles';
import styles from './ProfileSwitcher.module.css';

const NEW_PROFILE = '__new__';

interface ProfileSwitcherProps {
  accountId: string;
  profile: { id: string; name: string; accountCount: number };
  onMoved: () => void;
}

/** Where the user regroups accounts, including merging the one-account profiles the migration made. */
export function ProfileSwitcher({ accountId, profile, onMoved }: ProfileSwitcherProps) {
  const [listKey, setListKey] = useState(0);
  const list = useApiGet<ProfileSummary[]>('/profiles', {}, { reloadKey: listKey });
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = (list.data ?? []).filter((p) => p.id !== profile.id);

  async function move(value: string) {
    if (value === profile.id) return;
    setMoving(true);
    setError(null);
    try {
      await apiClient.patch(
        `/accounts/${accountId}/profile`,
        value === NEW_PROFILE ? { newProfile: true } : { profileId: value },
      );
      setListKey((key) => key + 1);
      onMoved();
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError('Профиль не найден');
        setListKey((key) => key + 1);
      } else {
        setError(err.response?.data?.message ?? 'Не удалось перенести аккаунт');
      }
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className={styles.switcher}>
      <label className={styles.label} htmlFor="profile-switcher">
        Профиль:
      </label>
      <select
        id="profile-switcher"
        className={styles.select}
        value={profile.id}
        disabled={moving}
        onChange={(e) => move(e.target.value)}
      >
        <option value={profile.id}>{profile.name}</option>
        {others.map((p) => (
          // Names can repeat across clients; the networks tell them apart.
          <option key={p.id} value={p.id}>
            {`${p.name} (${p.accounts.map((a) => a.account.platform).join(', ')})`}
          </option>
        ))}
        {profile.accountCount > 1 && <option value={NEW_PROFILE}>Отдельный профиль</option>}
      </select>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
```

`frontend/src/components/ProfileSwitcher.module.css`:

```css
.switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
}

.label {
  color: var(--text);
}

.select {
  font: inherit;
  font-size: 14px;
  color: var(--text-h);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  max-width: 260px;
}

.select:focus-visible {
  border-color: var(--accent-border);
  outline: none;
}

.error {
  color: var(--danger);
}
```

In `AccountDetailPage.tsx`:
- Add the import `import { Link, useParams } from 'react-router-dom';` (replacing the `useParams`-only import) and `import { ProfileSwitcher } from '../components/ProfileSwitcher';`.
- Add to `DetailData`: `profile: { id: string; name: string; accountCount: number };`.
- Destructure `profile` together with the rest: `const { account, trend, summary, coverage, profile } = detail.data;`.
- Directly inside `<div className={styles.page}>`, before the header `div`, add:

```tsx
      {profile.accountCount > 1 && (
        <Link to={`/profiles/${profile.id}`} className={styles.breadcrumb}>
          ← {profile.name}
        </Link>
      )}
```

- In the header, after `<h2 className={styles.heading}>{account.name}</h2>`, add:

```tsx
        <ProfileSwitcher accountId={account.id} profile={profile} onMoved={() => setReloadKey((key) => key + 1)} />
```

Append to `AccountDetailPage.module.css`:

```css
.breadcrumb {
  align-self: flex-start;
  margin-bottom: -12px;
  font-size: 14px;
  color: var(--text);
  text-decoration: none;
}

.breadcrumb:hover,
.breadcrumb:focus-visible {
  color: var(--accent);
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run src/components/ProfileSwitcher.test.tsx src/pages/AccountDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole frontend suite, lint and build**

Run: `npm test; npm run lint; npm run build`
Expected: all tests pass, oxlint reports no errors, and `tsc -b && vite build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ProfileSwitcher.* frontend/src/pages/AccountDetailPage.*
git commit -m "Move an account between profiles from its page, with a breadcrumb back to the profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After all tasks

- Run the backend (`npx jest; npm run build; npm run lint`) and frontend (`npm test; npm run lint; npm run build`) suites once more from a clean state.
- Push the `account-profiles` branch and open a PR into `master`. The PR description notes that the deploy runs migration `AddProfiles1789900000000`.
- Deploy is the user's step, using the usual redeploy sequence. Afterwards: open Overview, merge two accounts of one brand with «Профиль:» on an account page, and check that one card with both icons appears.
