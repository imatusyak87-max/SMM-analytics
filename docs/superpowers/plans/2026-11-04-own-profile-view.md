# Own-profile view and soft delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the account page into the «Свой профиль» view and make deleting an account or project hide it instead of destroying its statistics, with re-adding the link bringing the data back.

**Architecture:** Reuse `accounts.isActive` and add `profiles.isActive`. Deletes flip the flag; every read path filters on it. `createFromLink` revives an inactive match (by handle or by Instagram numeric id) into the target project with a conditional update. Frontend: new `ViewModeSwitch` and `MoveAccountButton` components; `ProfileSwitcher`, `CompetitorsSection` and the tile «Убрать» go away.

**Tech Stack:** NestJS + TypeORM (Postgres), Jest with hand-rolled repo mocks; React + Vite + Vitest + Testing Library, CSS modules.

**Spec:** `docs/superpowers/specs/2026-11-04-own-profile-view-design.md`

## Global Constraints

- Branch `own-profile-view` (already created from master, spec committed).
- UI copy is Russian; backend error messages shown to the user are Russian.
- Code/DB/API keep the name `profile`; UI says «проект».
- Verification: backend `npx jest`, `npm run build`, `npx tsc --noEmit` (in `backend/`); frontend `npx vitest run`, `npm run build` (in `frontend/`). **Never run backend `npm run lint`** (it rewrites files).
- Frontend tests: use `vi.clearAllMocks()` in `beforeEach`, never `mockReset` with `mockRejectedValue`. Resolve late responses inside `act()`.
- Dark-only theme; lime `--accent` is the single accent; text on lime uses `--on-accent`.
- Each commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Existing tests whose fixtures stand for an **added** account must get `isActive: true` where the new code reads the flag (a fixture without it now means "deleted"). Fix those fixtures, not the production code.

---

### Task 1: Hidden projects (`profiles.isActive`) and soft project delete

**Files:**
- Modify: `backend/src/db/entities/profile.entity.ts`
- Create: `backend/src/db/migrations/1790100000000-AddProfileIsActive.ts`
- Modify: `backend/src/profiles/profile-store.ts`
- Modify: `backend/src/profiles/profiles.service.ts` (`list`, `remove`, `findOne`)
- Test: `backend/src/profiles/profiles.service.spec.ts`, `backend/src/profiles/profile-store.spec.ts`

**Interfaces:**
- Produces: `Profile.isActive: boolean`; `requireProfile(em, id)` now 404s («Проект не найден») for a hidden project too; `ProfilesService.remove(id)` hides the project and deactivates its accounts in one transaction.

- [ ] **Step 1: Write failing tests**

In `profile-store.spec.ts`:

```ts
it('treats a hidden project as not found', async () => {
  const em = { findOneBy: jest.fn().mockResolvedValue(null) } as any;
  await expect(requireProfile(em, 'prof-1')).rejects.toThrow('Проект не найден');
  expect(em.findOneBy).toHaveBeenCalledWith(Profile, { id: 'prof-1', isActive: true });
});
```

In `profiles.service.spec.ts` (follow the file's existing mock setup; replace the old "deletes the project and its accounts" tests):

```ts
it('lists only visible projects', async () => {
  await service.list();
  expect(profilesRepo.find).toHaveBeenCalledWith({ where: { isActive: true }, order: { createdAt: 'ASC' } });
});

it('hides a deleted project and its accounts, keeping their data', async () => {
  profilesRepo.findOneBy.mockResolvedValue({ id: 'prof-1', name: 'P', isActive: true });
  const em = { update: jest.fn() };
  profilesRepo.manager = { transaction: jest.fn((cb: any) => cb(em)) };

  await service.remove('prof-1');

  expect(em.update).toHaveBeenCalledWith(Account, { profileId: 'prof-1' }, { isActive: false });
  expect(em.update).toHaveBeenCalledWith(Profile, { id: 'prof-1' }, { isActive: false });
  expect(accounts.remove).not.toHaveBeenCalled();
});

it('answers 404 for a hidden project', async () => {
  profilesRepo.findOneBy.mockResolvedValue(null);
  await expect(service.get('prof-1')).rejects.toThrow('Проект не найден');
  expect(profilesRepo.findOneBy).toHaveBeenCalledWith({ id: 'prof-1', isActive: true });
});
```

- [ ] **Step 2: Run, verify they fail**

Run (in `backend/`): `npx jest src/profiles`
Expected: the new tests FAIL (where clause without `isActive`; `accounts.remove` called).

- [ ] **Step 3: Implement**

`profile.entity.ts`:

```ts
/** A client project; groups its accounts across networks. Hidden, not deleted, when the user deletes it. */
@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
```

Migration `1790100000000-AddProfileIsActive.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** «Удалить проект» hides the project so its accounts' statistics survive. */
export class AddProfileIsActive1790100000000 implements MigrationInterface {
  name = 'AddProfileIsActive1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" ADD "isActive" boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "isActive"`);
  }
}
```

Check how migrations are registered (`grep -rn AddOauthStateAccount backend/src` returned nothing outside the folder, so they load by glob; if a list exists, add it).

`profile-store.ts`:

```ts
/** Only visible projects can take accounts; a deleted (hidden) one reads as missing. */
export async function requireProfile(em: EntityManager, id: string): Promise<Profile> {
  const profile = await em.findOneBy(Profile, { id, isActive: true });
  if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
  return profile;
}
```

`profiles.service.ts`:

```ts
// list():
this.profilesRepo.find({ where: { isActive: true }, order: { createdAt: 'ASC' } }),

/** Hides the project and its accounts; their statistics stay and come back when an account is re-added. */
async remove(id: string): Promise<void> {
  await this.findOne(id);
  await this.profilesRepo.manager.transaction(async (em) => {
    await em.update(Account, { profileId: id }, { isActive: false });
    await em.update(Profile, { id }, { isActive: false });
  });
}

private async findOne(id: string): Promise<Profile> {
  const profile = await this.profilesRepo.findOneBy({ id, isActive: true });
  if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
  return profile;
}
```

Remove the now-unused `accountsRepo.find` in `remove`.

- [ ] **Step 4: Run, verify pass**

Run: `npx jest src/profiles` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/entities/profile.entity.ts backend/src/db/migrations/1790100000000-AddProfileIsActive.ts backend/src/profiles
git commit -m "Deleting a project hides it and keeps its accounts' data"
```

---

### Task 2: Soft account delete; inactive accounts read as missing

**Files:**
- Modify: `backend/src/accounts/accounts.service.ts` (`remove`, `findOne`, delete `deactivate`)
- Modify: `backend/src/accounts/accounts.controller.ts` (delete `PATCH :id/deactivate`)
- Test: `backend/src/accounts/accounts.service.spec.ts`, `backend/src/accounts/accounts.controller.spec.ts` if it covers deactivate

**Interfaces:**
- Produces: `AccountsService.remove(id)` sets `isActive=false` only; `AccountsService.findOne(id)` 404s for inactive accounts (used by `GET /accounts/:id`, avatar, Instagram connect).

- [ ] **Step 1: Write failing tests** (replace the whole `describe('remove')` block)

```ts
describe('remove', () => {
  it('hides the account and keeps all its data', async () => {
    const repo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', isActive: true }), update: jest.fn() } as any;
    const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

    await service.remove('acc-1');

    expect(repo.update).toHaveBeenCalledWith('acc-1', { isActive: false });
  });

  it('answers 404 for an account that is already deleted', async () => {
    const repo = { findOneBy: jest.fn().mockResolvedValue(null), update: jest.fn() } as any;
    const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

    await expect(service.remove('acc-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx jest src/accounts` → FAIL.

- [ ] **Step 3: Implement**

```ts
async findOne(id: string) {
  const account = await this.repo.findOneBy({ id, isActive: true });
  if (!account) throw new NotFoundException(`Account ${id} not found`);
  return account;
}

/** Hides the account: it stops syncing, and re-adding its link brings it back with all its data. */
async remove(id: string) {
  await this.findOne(id);
  await this.repo.update(id, { isActive: false });
}
```

Delete `deactivate` and its controller route. Remove imports that become unused (`CompetitorRejection`, `CompetitorSuggestion`, `CompetitorRun`, `Post`, `AccountSnapshot`, `SyncJob`, `AccountCredential`, `HistoryLoad`) — let `npx tsc --noEmit` confirm. Drop spec tests for deactivate and the old cascade.

- [ ] **Step 4: Run, verify pass** — `npx jest src/accounts` and `npx tsc --noEmit` → PASS / clean.

- [ ] **Step 5: Commit** — `git commit -m "Deleting an account hides it instead of purging its statistics"`

---

### Task 3: Re-adding a deleted account revives it; preview knows about it

**Files:**
- Modify: `backend/src/accounts/accounts.service.ts` (`preview`, `createFromLink`, new `revive`, `matchesConnectedAccount` → `findConnected`)
- Create: `backend/src/accounts/dto/preview-account.dto.ts`
- Modify: `backend/src/accounts/accounts.controller.ts` (`preview` uses the new DTO)
- Test: `backend/src/accounts/accounts.service.spec.ts`

**Interfaces:**
- Consumes: `requireProfile` (Task 1, active-only).
- Produces: `preview(link: string, expected?: AccountPlatform)` returns `{ …, alreadyAdded: boolean, previouslyAdded: boolean }`; `POST /accounts/preview` body `{ link: string; platform?: 'instagram' | 'telegram' }`; `createFromLink` returns the revived `Account` for an inactive match.

- [ ] **Step 1: Write failing tests** (add a `describe('reviving a deleted account')`; reuse `makeRepo`/`withTransactions`, giving `repo.em` an `update` mock)

```ts
describe('reviving a deleted account', () => {
  function setup(existing: (where: any) => unknown, affected = 1) {
    const repo = makeRepo();
    repo.findOneBy.mockImplementation((where: any) => Promise.resolve(existing(where)));
    repo.em.update = jest.fn().mockResolvedValue({ affected });
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Brand', avatarUrl: null, description: null, platformUserId: '9001' }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 10 }),
      getAvatar: jest.fn(),
    };
    const syncJobs = { createManual: jest.fn() };
    const service = new AccountsService(repo, { get: jest.fn(() => connector) } as any, syncJobs as any);
    return { service, repo, connector, syncJobs };
  }
  const deleted = { id: 'acc-old', name: 'Chan', externalId: '@somechannel', isActive: false, profileId: 'prof-old' };

  it('brings a deleted account back into the chosen project and syncs it', async () => {
    const { service, repo, syncJobs, connector } = setup((w) => (w.externalId === '@somechannel' ? deleted : null));

    const account = await service.createFromLink('https://t.me/somechannel', 'prof-1');

    expect(repo.em.update).toHaveBeenCalledWith(
      Account, { id: 'acc-old', isActive: false }, { isActive: true, profileId: 'prof-1' },
    );
    expect(account).toMatchObject({ id: 'acc-old', isActive: true, profileId: 'prof-1' });
    expect(repo.save).not.toHaveBeenCalled();
    expect(connector.getAccountInfo).not.toHaveBeenCalled();
    expect(syncJobs.createManual).toHaveBeenCalledWith('acc-old');
  });

  it('brings it back into a new project named after it when no project is given', async () => {
    const { service, repo } = setup((w) => (w.externalId === '@somechannel' ? deleted : null));

    await service.createFromLink('https://t.me/somechannel');

    expect(repo.em.save).toHaveBeenCalledWith(Profile, { name: 'Chan' });
    expect(repo.em.update).toHaveBeenCalledWith(Account, expect.anything(), { isActive: true, profileId: 'prof-new' });
  });

  it('keeps it deleted when the project already has that network', async () => {
    const { service, repo } = setup((w) =>
      w.profileId ? { id: 'acc-tg', isActive: true } : w.externalId === '@somechannel' ? deleted : null);

    await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toThrow('В проекте уже есть Telegram');
    expect(repo.em.update).not.toHaveBeenCalled();
  });

  it('answers «already added» when a concurrent add revived it first', async () => {
    const { service, syncJobs } = setup((w) => (w.externalId === '@somechannel' ? deleted : null), 0);

    await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toBeInstanceOf(ConflictException);
    expect(syncJobs.createManual).not.toHaveBeenCalled();
  });

  it('revives a deleted own Instagram account found by its numeric id', async () => {
    const own = { id: 'acc-own', name: 'Brand', externalId: '9001', isActive: false, profileId: 'prof-old' };
    const { service, repo } = setup((w) => (w.externalId === '9001' ? own : null));

    await service.createFromLink('https://instagram.com/brand', 'prof-1');

    expect(repo.em.update).toHaveBeenCalledWith(Account, { id: 'acc-own', isActive: false }, { isActive: true, profileId: 'prof-1' });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('previews a deleted account as previously added, not as a duplicate', async () => {
    const { service } = setup((w) => (w.externalId === '@somechannel' ? deleted : null));

    const preview = await service.preview('https://t.me/somechannel');

    expect(preview).toMatchObject({ alreadyAdded: false, previouslyAdded: true });
  });

  it('refuses a preview for another network than the field asked for', async () => {
    const { service, connector } = setup(() => null);

    await expect(service.preview('https://vk.com/brand', AccountPlatform.TELEGRAM)).rejects.toThrow('Это ссылка не на Telegram');
    expect(connector.getAccountInfo).not.toHaveBeenCalled();
  });
});
```

Import `Account` from `../db/entities/account.entity` in the spec. Then add `isActive: true` to every existing fixture that stands for an already added account (e.g. `{ id: 'existing', externalId: '@somechannel' }`, `{ id: 'acc-1', profileId: 'prof-7' }`, `{ id: 'acc-tg' }`, `own` in «treats the user's own connected account as already added», the preview duplicate test).

- [ ] **Step 2: Run, verify fail** — `npx jest src/accounts/accounts.service.spec.ts` → new tests FAIL.

- [ ] **Step 3: Implement**

`dto/preview-account.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AccountPlatform } from '../../db/entities/account.entity';

export class PreviewAccountDto {
  @IsString() link: string;
  /** The network of the field the link was typed into; a link to another network is refused. */
  @IsOptional() @IsIn([AccountPlatform.INSTAGRAM, AccountPlatform.TELEGRAM]) platform?: AccountPlatform;
}
```

Controller: `preview(@Body() dto: PreviewAccountDto) { return this.accountsService.preview(dto.link, dto.platform); }`

Service — shared expected-network check, used by both `preview` and `createFromLink`:

```ts
private parseFor(link: string, expected?: AccountPlatform): ParsedAccountLink {
  const parsed = this.parseLink(link);
  // Checked before the connector lookup so a VK link in the Telegram field says "wrong field", not "unsupported".
  if (expected && parsed.platform !== expected) {
    throw new BadRequestException(`Это ссылка не на ${PLATFORM_NAMES[expected]}`);
  }
  return parsed;
}
```

`preview(link, expected?)`: replace `this.resolveLink(link)` with `const parsed = this.parseFor(link, expected); const connector = this.connectorFor(parsed);` (delete `resolveLink` if unused), and end with:

```ts
const match = (await this.findExisting(parsed)) ?? (await this.findConnected(parsed.platform, info));
return {
  // …existing fields…
  // Lets the dialog say so before the user clicks; create is still what enforces it.
  alreadyAdded: match?.isActive === true,
  // A deleted account comes back with its statistics when added again.
  previouslyAdded: match !== null && !match.isActive,
};
```

`createFromLink`:

```ts
async createFromLink(link: string, profileId?: string, expected?: AccountPlatform) {
  const parsed = this.parseFor(link, expected);
  const connector = this.connectorFor(parsed);

  const existing = await this.findExisting(parsed);
  if (existing?.isActive) throw new ConflictException(await this.alreadyAddedMessage(existing));

  if (profileId) {
    // Checked before the platform call so a stale choice fails fast and cheaply.
    await requireProfile(this.repo.manager, profileId);
    // One account per network per project; legacy projects may still hold two.
    if (await this.repo.findOneBy({ profileId, platform: parsed.platform, isActive: true })) {
      throw new ConflictException(`В проекте уже есть ${PLATFORM_NAMES[parsed.platform]}`);
    }
  }

  if (existing) return this.revive(existing, profileId);

  let info: AccountInfo;
  try {
    info = await connector.getAccountInfo(this.draftOf(parsed));
  } catch (error) {
    throw this.unresolvable(parsed.platform, parsed.externalId, error as Error);
  }

  const connected = await this.findConnected(parsed.platform, info);
  if (connected?.isActive) throw new ConflictException(ALREADY_ADDED);
  if (connected) return this.revive(connected, profileId);

  // …unchanged: create the new account, map PG errors, queue sync…
}

/** Brings a deleted account back, with all its statistics, into the given project or a new one. */
private async revive(account: Account, profileId?: string): Promise<Account> {
  const revived = await this.repo.manager.transaction(async (em) => {
    const targetProfileId = profileId ?? (await createProfile(em, account.name)).id;
    // Conditional, so two adds racing on one deleted account revive it once.
    const result = await em.update(Account, { id: account.id, isActive: false }, { isActive: true, profileId: targetProfileId });
    if (!result.affected) throw new ConflictException(ALREADY_ADDED);
    return { ...account, isActive: true, profileId: targetProfileId };
  });
  await this.syncJobs.createManual(revived.id);
  return revived;
}

/** An Instagram competitor lookup can reveal the user's own connected account under its numeric id. */
private async findConnected(platform: AccountPlatform, info: AccountInfo): Promise<Account | null> {
  if (!info.platformUserId) return null;
  return this.repo.findOneBy({ platform, externalId: info.platformUserId });
}
```

Make sure `withTransactions` in the spec gets an `update` on `em` in its default (`update: jest.fn().mockResolvedValue({ affected: 1 })`) so other tests aren't affected.

- [ ] **Step 4: Run, verify pass** — `npx jest src/accounts src/profiles` and `npx tsc --noEmit` → PASS / clean.

- [ ] **Step 5: Commit** — `git commit -m "Re-adding a deleted account brings it back with its statistics"`

---

### Task 4: Deleted accounts are skipped by every background and read path

**Files:**
- Modify: `backend/src/stats/stats.service.ts` (`getAccountDetail`, `getPostsPage`)
- Modify: `backend/src/sync/sync-job.service.ts` (`createManual`), `backend/src/sync/sync.processor.ts`
- Modify: `backend/src/history/history-load.service.ts` (`start`), `backend/src/history/history-runner.ts` (`runSlice`)
- Modify: `backend/src/connectors/telegram/telegram-webhook.controller.ts`
- Modify: `backend/src/competitors/competitors.processor.ts`, `backend/src/competitors/competitors.service.ts` (tracked lookup)
- Test: the matching `*.spec.ts` files, plus `backend/src/connectors/instagram/instagram-token-refresh.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SyncJobService.createManual(id)` throws `NotFoundException('Аккаунт не найден')` for a missing/deleted account.

- [ ] **Step 1: Write failing tests** — one per path, in each file's existing mock style:

```ts
// stats.service.spec.ts
it('answers 404 for the detail of a deleted account', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await expect(service.getAccountDetail('acc-1', period)).rejects.toBeInstanceOf(NotFoundException);
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
});
it('answers 404 for the posts of a deleted account', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await expect(service.getPostsPage('acc-1', { from: '2026-01-01', to: '2026-01-31', sort: 'views', page: 1, size: 10 }))
    .rejects.toBeInstanceOf(NotFoundException);
});

// sync-job.service.spec.ts
it('refuses a manual sync of a deleted account', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await expect(service.createManual('acc-1')).rejects.toThrow('Аккаунт не найден');
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
  expect(queue.add).not.toHaveBeenCalled();
});

// sync.processor.spec.ts
it('skips a job queued before its account was deleted, without retrying', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);
  expect(syncJobsRepo.update).toHaveBeenLastCalledWith('job-1', expect.objectContaining({ status: SyncStatus.FAILED, errorMessage: 'Аккаунт удалён' }));
  expect(registry.get).not.toHaveBeenCalled();
});

// history-load.service.spec.ts
it('refuses a history load for a deleted account', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await expect(service.start('acc-1')).rejects.toThrow('Аккаунт не найден');
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
});

// history-runner.spec.ts
it('stops loading history once the account is deleted', async () => {
  loadsRepo.findOneBy.mockResolvedValue({ accountId: 'acc-1', status: HistoryLoadStatus.RUNNING });
  accountsRepo.findOneBy.mockResolvedValue(null);
  expect(await runner.runSlice('acc-1')).toBeNull();
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
});

// telegram-webhook.controller.spec.ts
it('ignores posts for a deleted account', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await controller.handleUpdate('acc-1', { channel_post: { chat: { username: 'chan' }, message_id: 1 } });
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
  expect(postsRepo.upsert).not.toHaveBeenCalled();
});

// competitors.processor.spec.ts
it('does not run competitor discovery for a deleted account', async () => {
  accountsRepo.findOneBy.mockResolvedValue(null);
  await processor.process({ data: { runId: 'run-1', accountId: 'acc-1' } } as any);
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
});

// competitors.service.spec.ts — a deleted account is not "tracked"
expect(accountsRepo.find).toHaveBeenCalledWith({
  where: { platform: AccountPlatform.TELEGRAM, externalId: In(['@chan']), isActive: true },
});

// instagram-token-refresh.service.spec.ts — locks in the decision
it('keeps refreshing tokens of deleted own accounts', async () => {
  // existing setup; assert the account lookup has no isActive filter:
  expect(accountsRepo.find).toHaveBeenCalledWith({ where: { platform: AccountPlatform.INSTAGRAM } });
});
```

Adjust variable names to each spec file's existing setup. If a spec constructs `SyncJobService` without an accounts repo, pass one returning an active account (`{ findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', isActive: true }) }`).

- [ ] **Step 2: Run, verify fail** — `npx jest src/stats src/sync src/history src/connectors src/competitors` → new tests FAIL (the token-refresh one passes already; that is fine — it guards a decision).

- [ ] **Step 3: Implement** — each lookup gains `isActive: true`:

```ts
// stats.service.ts getAccountDetail
const account = await this.accountsRepo.findOneBy({ id: accountId, isActive: true });

// stats.service.ts getPostsPage — first line
if (!(await this.accountsRepo.findOneBy({ id: accountId, isActive: true }))) {
  throw new NotFoundException(`Account ${accountId} not found`);
}

// sync-job.service.ts
async createManual(accountId: string): Promise<SyncJob> {
  // A deleted account is never synced; reviving it is what queues its next sync.
  if (!(await this.accountsRepo!.findOneBy({ id: accountId, isActive: true }))) {
    throw new NotFoundException('Аккаунт не найден');
  }
  return this.enqueue(accountId, SyncTrigger.MANUAL, 1);
}

// sync.processor.ts — after marking RUNNING
const account = await this.accountsRepo.findOneBy({ id: accountId, isActive: true });
if (!account) {
  // Deleted after the job was queued: settle it now rather than burn three retries.
  await this.syncJobsRepo.update(syncJobId, { status: SyncStatus.FAILED, errorMessage: 'Аккаунт удалён', finishedAt: new Date() });
  return;
}

// history-load.service.ts start, history-runner.ts runSlice, telegram-webhook.controller.ts, competitors.processor.ts
findOneBy({ id: accountId, isActive: true })

// competitors.service.ts tracked lookup
where: { platform: AccountPlatform.TELEGRAM, externalId: In(handles), isActive: true },
```

Check `sync.processor.ts` has a `finally`/catch that would overwrite the FAILED status; return before entering any block that marks DONE.

- [ ] **Step 4: Run, verify pass** — `npx jest` (whole backend) and `npx tsc --noEmit` → PASS / clean.

- [ ] **Step 5: Commit** — `git commit -m "Deleted accounts are not synced, loaded or shown"`

---

### Task 5: Moving an account only between visible projects

**Files:**
- Modify: `backend/src/profiles/profiles.service.ts` (`moveAccount`)
- Modify: `backend/src/profiles/dto/move-account.dto.ts`
- Test: `backend/src/profiles/profiles.service.spec.ts`, `profiles.controller.spec.ts` if it covers `newProfile`

**Interfaces:**
- Produces: `PATCH /accounts/:id/profile` body `{ profileId: string }` (required); 404 «Аккаунт не найден» for a deleted account, 404 «Проект не найден» for a hidden/missing project, 409 «В проекте уже есть {сеть}» when the target already has that network.

- [ ] **Step 1: Write failing tests** (replace the `newProfile` tests)

```ts
it('refuses to move a deleted account', async () => {
  em.findOneBy.mockResolvedValue(null);
  await expect(service.moveAccount('acc-1', { profileId: 'prof-2' })).rejects.toThrow('Аккаунт не найден');
  expect(em.findOneBy).toHaveBeenCalledWith(Account, { id: 'acc-1', isActive: true });
});

it('refuses a project that already has that network', async () => {
  em.findOneBy.mockImplementation((entity: unknown, where: any) =>
    entity === Account && where.id ? { id: 'acc-1', platform: 'telegram', profileId: 'prof-1' }
    : entity === Profile ? { id: 'prof-2', isActive: true }
    : entity === Account && where.profileId ? { id: 'acc-9' } : null);
  await expect(service.moveAccount('acc-1', { profileId: 'prof-2' })).rejects.toThrow('В проекте уже есть Telegram');
  expect(em.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify fail** — `npx jest src/profiles` → FAIL.

- [ ] **Step 3: Implement**

```ts
// move-account.dto.ts
import { IsUUID } from 'class-validator';

export class MoveAccountDto {
  @IsUUID() profileId: string;
}

// profiles.service.ts
async moveAccount(accountId: string, target: MoveAccountDto): Promise<{ profileId: string }> {
  return this.accountsRepo.manager.transaction(async (em) => {
    const account = await em.findOneBy(Account, { id: accountId, isActive: true });
    if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    if (target.profileId === account.profileId) return { profileId: account.profileId };

    const destination = (await requireProfile(em, target.profileId)).id;
    // One account per network per project, same rule as adding one.
    if (await em.findOneBy(Account, { profileId: destination, platform: account.platform, isActive: true })) {
      throw new ConflictException(`В проекте уже есть ${PLATFORM_NAMES[account.platform]}`);
    }
    await em.update(Account, { id: accountId }, { profileId: destination });
    return { profileId: destination };
  });
}
```

`PLATFORM_NAMES`: import from `../accounts/platform-names`. Remove the now-unused `createProfile` import and `BadRequestException` if unused.

- [ ] **Step 4: Run, verify pass** — `npx jest src/profiles` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "Move an account only into a visible project without that network"`

---

### Task 6: Sort posts by comments (backend)

**Files:**
- Modify: `backend/src/stats/dto/post-filter.dto.ts`, `backend/src/stats/stats.service.ts`
- Test: `backend/src/stats/stats.service.spec.ts` (or the controller spec that covers sort validation)

- [ ] **Step 1: Write failing test**

```ts
it('orders posts by comments', async () => {
  await service.getPostsPage('acc-1', { from: '2026-01-01', to: '2026-01-31', sort: 'comments', page: 1, size: 10 });
  expect(qb.orderBy).toHaveBeenCalledWith('post.comments', 'DESC', 'NULLS LAST');
});
```

(Use the spec's existing query-builder mock; the account lookup from Task 4 must resolve to an active account.)

- [ ] **Step 2: Run, verify fail** — TS error / FAIL.

- [ ] **Step 3: Implement**

```ts
export const POST_SORTS = ['views', 'reactions', 'comments', 'er', 'date'] as const;
// SORT_COLUMNS
comments: 'post.comments',
```

- [ ] **Step 4: Run, verify pass** — `npx jest src/stats`.

- [ ] **Step 5: Commit** — `git commit -m "Sort posts by comments"`

---

### Task 7: Instagram login errors never show raw JSON

**Files:**
- Modify: `backend/src/connectors/instagram/instagram-oauth.service.ts` (`InstagramLoginError`, `completeLogin`)
- Modify: `backend/src/connectors/instagram/instagram-oauth.controller.ts` (`callback`)
- Test: `instagram-oauth.service.spec.ts`, `instagram-oauth.controller.spec.ts`

**Interfaces:**
- Produces: `InstagramLoginError(message, accountId: string | null)`; callback redirects to `/accounts/:id?instagramError=…` when the account is known, else `/?instagramError=…`.

- [ ] **Step 1: Write failing tests**

```ts
// service spec
it('treats a login for a deleted account as an account that no longer exists', async () => {
  stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
  accountsRepo.findOneBy.mockResolvedValue(null);
  const error = await service.completeLogin('code', 'state').catch((e) => e);
  expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
  expect(error).toBeInstanceOf(InstagramLoginError);
  expect(error).toMatchObject({ message: 'Аккаунт больше не существует', accountId: null });
});

it('reports an expired login link without an account', async () => {
  stateService.consume.mockResolvedValue(null);
  await expect(service.completeLogin('code', 'state')).rejects.toMatchObject({ accountId: null });
});

// controller spec
it('sends a login error with no account to the home page', async () => {
  oauthService.completeLogin.mockRejectedValue(new InstagramLoginError('Ссылка для входа устарела, попробуйте подключить аккаунт заново', null));
  await controller.callback('code', 'state', res);
  expect(res.redirect).toHaveBeenCalledWith(`/?instagramError=${encodeURIComponent('Ссылка для входа устарела, попробуйте подключить аккаунт заново')}`);
});

it('never shows an unexpected error as raw JSON', async () => {
  oauthService.completeLogin.mockRejectedValue(new Error('connection refused'));
  await controller.callback('code', 'state', res);
  expect(res.redirect).toHaveBeenCalledWith(`/?instagramError=${encodeURIComponent('Не удалось подключить Instagram, попробуйте ещё раз')}`);
  expect(res.status).not.toHaveBeenCalled();
});
```

Use the InstagramAccountKind value the spec already uses for account logins.

- [ ] **Step 2: Run, verify fail** — `npx jest src/connectors/instagram` → FAIL.

- [ ] **Step 3: Implement**

```ts
export class InstagramLoginError extends Error {
  /** accountId is null when the login cannot be tied to an account (expired link, account gone). */
  constructor(message: string, readonly accountId: string | null) {
    super(message);
  }
}

// completeLogin
if (!consumed || consumed.type === InstagramAccountKind.DISCOVERY || !consumed.accountId) throw new InstagramLoginError(EXPIRED, null);
const account = await this.accountsRepo.findOneBy({ id: consumed.accountId, isActive: true });
if (!account) throw new InstagramLoginError('Аккаунт больше не существует', null);

// controller callback catch
} catch (error) {
  const known = error instanceof InstagramLoginError;
  if (!known) this.logger.warn(`Instagram login failed: ${(error as Error).message}`);
  const message = known ? error.message : 'Не удалось подключить Instagram, попробуйте ещё раз';
  const page = known && error.accountId ? `/accounts/${error.accountId}` : '/';
  res.redirect(`${page}?instagramError=${encodeURIComponent(message)}`);
  return;
}
```

- [ ] **Step 4: Run, verify pass** — `npx jest src/connectors/instagram` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "Instagram login failures land on a page, never raw JSON"`

---

### Task 8: «Комментарии» sort in the UI

**Files:**
- Modify: `frontend/src/components/PostList.tsx` (`PostSort`), `frontend/src/components/PostSortSelect.tsx`
- Test: `frontend/src/pages/AccountDetailPage.test.tsx`

- [ ] **Step 1: Write failing test**

```ts
it('sorts the top posts by comments', async () => {
  mockApi();
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Комментарии' }));
  await waitFor(() => expect(lastCallTo('/posts').sort).toBe('comments'));
});
```

- [ ] **Step 2: Run, verify fail** — (in `frontend/`) `npx vitest run src/pages/AccountDetailPage.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```ts
export type PostSort = 'views' | 'reactions' | 'comments' | 'er' | 'date';
// SORTS, after reactions:
{ value: 'comments', label: 'Комментарии' },
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "Top posts: sort by comments"`

---

### Task 9: «Свой профиль» header; project picker and competitors block removed

**Files:**
- Create: `frontend/src/components/ViewModeSwitch.tsx`, `ViewModeSwitch.module.css`, `ViewModeSwitch.test.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`, `AccountDetailPage.module.css`, `AccountDetailPage.test.tsx`
- Delete: `frontend/src/components/ProfileSwitcher.tsx`, `.module.css`, `.test.tsx`; `frontend/src/components/CompetitorsSection.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Produces: `<ViewModeSwitch />` (no props yet; sub-project 3 adds `value`/`onChange`).

- [ ] **Step 1: Write failing tests**

`ViewModeSwitch.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ViewModeSwitch } from './ViewModeSwitch';

describe('ViewModeSwitch', () => {
  it('shows the own profile as current and competitors as coming soon', () => {
    render(<ViewModeSwitch />);
    expect(screen.getByRole('button', { name: 'Свой профиль' })).toHaveAttribute('aria-pressed', 'true');
    const competitors = screen.getByRole('button', { name: /Конкуренты/ });
    expect(competitors).toBeDisabled();
    expect(competitors).toHaveTextContent('Скоро');
  });
});
```

In `AccountDetailPage.test.tsx`: delete the `'Проект:'` select tests (around line 370) and any `CompetitorsSection` expectations; add:

```ts
it('shows the own-profile header without a project picker or competitors', async () => {
  mockApi();
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Chan' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Свой профиль' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Проект:')).not.toBeInTheDocument();
  expect(screen.queryByText(/конкурент/i, { selector: 'h3' })).not.toBeInTheDocument();
});

it('warns that statistics are kept when the account is deleted', async () => {
  mockApi();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Удалить аккаунт' }));
  expect(confirm).toHaveBeenCalledWith('Убрать «Chan» из проекта? Собранная статистика сохранится — если добавить аккаунт снова, она вернётся.');
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/components/ViewModeSwitch.test.tsx src/pages/AccountDetailPage.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`ViewModeSwitch.tsx`:

```tsx
import styles from './ViewModeSwitch.module.css';

/** «Свой профиль / Конкуренты» on the network page; competitors arrive in a later release. */
export function ViewModeSwitch() {
  return (
    <div className={styles.group} role="group" aria-label="Режим">
      <button type="button" className={styles.active} aria-pressed="true">Свой профиль</button>
      <button type="button" className={styles.option} aria-pressed="false" disabled>
        Конкуренты <span className={styles.soon}>Скоро</span>
      </button>
    </div>
  );
}
```

`ViewModeSwitch.module.css` — copy the segment look from `PostSortSelect.module.css` (`.group`, `.option`, `.active`), plus:

```css
.option:disabled {
  opacity: 0.5;
  cursor: default;
}

.soon {
  margin-left: 6px;
  font-size: 12px;
  color: var(--text-muted);
}
```

(Use the variable names `PostSortSelect.module.css` and `NetworkTile.module.css` already use for muted text.)

`AccountDetailPage.tsx`:
- remove imports and JSX of `ProfileSwitcher` and `CompetitorsSection`;
- header becomes:

```tsx
<div className={styles.header}>
  <div className={styles.title}>
    <h2 className={styles.heading}>{account.name}</h2>
    <ViewModeSwitch />
  </div>
  <div className={styles.actions}>
    <RefreshButton … unchanged … />
    <HistoryLoadPanel … unchanged … />
    {/* MoveAccountButton goes here in Task 10 */}
    <button type="button" className={styles.deleteButton} aria-label="Удалить аккаунт"
      onClick={() => handleDelete(account, profile)}>
      Удалить
    </button>
  </div>
</div>
```

- confirm text: `` `Убрать «${target.name}» из проекта? Собранная статистика сохранится — если добавить аккаунт снова, она вернётся.` ``
- `DetailData.profile` drops `accountCount` from the interface (the backend may still send it).

CSS: add `.title { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }` and `.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }`; make `.deleteButton` smaller and muted:

```css
.deleteButton {
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
```

(keep the existing hover/focus rule that turns it red).

Delete the six `ProfileSwitcher*` / `CompetitorsSection*` files (`git rm`). `grep -rn "ProfileSwitcher\|CompetitorsSection" frontend/src` must return nothing.

- [ ] **Step 4: Run, verify pass** — `npx vitest run` (all frontend) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Network page: «Свой профиль» header, no project picker or competitors block"`

---

### Task 10: «Перенести…» action

**Files:**
- Create: `frontend/src/components/MoveAccountButton.tsx`, `MoveAccountButton.module.css`, `MoveAccountButton.test.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`

**Interfaces:**
- Consumes: `GET /profiles` → `ProfileSummary[]` (`frontend/src/profiles.ts`); `PATCH /accounts/:id/profile` `{ profileId }` (Task 5).
- Produces: `<MoveAccountButton accountId={string} currentProjectId={string} onMoved={() => void} />`.

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MoveAccountButton } from './MoveAccountButton';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));
const get = apiClient.get as any;
const patch = apiClient.patch as any;

const projects = [
  { id: 'prof-1', name: 'Coffee Lab', totalFollowers: 1, accounts: [{ account: { platform: 'telegram' } }] },
  { id: 'prof-2', name: 'Мезопроф', totalFollowers: 1, accounts: [{ account: { platform: 'instagram' } }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: projects });
});

describe('MoveAccountButton', () => {
  it('lists the other projects with their networks', async () => {
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    expect(await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Coffee Lab/ })).not.toBeInTheDocument();
  });

  it('moves the account and reports back', async () => {
    patch.mockResolvedValue({ data: { profileId: 'prof-2' } });
    const onMoved = vi.fn();
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={onMoved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/accounts/acc-1/profile', { profileId: 'prof-2' });
  });

  it('shows why a move was refused', async () => {
    patch.mockRejectedValue({ response: { data: { message: 'В проекте уже есть Instagram' } } });
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('В проекте уже есть Instagram');
  });

  it('says so when there is nowhere to move', async () => {
    get.mockResolvedValue({ data: [projects[0]] });
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    expect(await screen.findByText('Других проектов нет')).toBeInTheDocument();
  });
});
```

In `AccountDetailPage.test.tsx`, make `mockApi`'s fallback for `/profiles` return `[]` (it already returns `{ data: [] }` for unknown URLs) and add:

```ts
it('reloads the page after the account is moved', async () => {
  mockApi();
  (apiClient.patch as any).mockResolvedValue({ data: { profileId: 'prof-2' } });
  get.mockImplementation((url: string, config?: any) =>
    url === '/profiles'
      ? Promise.resolve({ data: [{ id: 'prof-2', name: 'Мезопроф', totalFollowers: null, accounts: [] }] })
      : url.endsWith('/detail') ? Promise.resolve({ data: detail() })
      : url.endsWith('/posts') ? Promise.resolve({ data: { total: 0, items: [] } })
      : Promise.resolve({ data: [] }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Перенести…' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Мезопроф ()' }));
  await waitFor(() => expect(callsTo('/detail').length).toBeGreaterThan(1));
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import type { ProfileSummary } from '../profiles';
import styles from './MoveAccountButton.module.css';

interface MoveAccountButtonProps {
  accountId: string;
  currentProjectId: string;
  onMoved: () => void;
}

/** «Перенести…»: moves the account into another project, keeping all its statistics. */
export function MoveAccountButton({ accountId, currentProjectId, onMoved }: MoveAccountButtonProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useApiGet<ProfileSummary[]>('/profiles', {}, { enabled: open });
  const others = (list.data ?? []).filter((p) => p.id !== currentProjectId);

  async function move(projectId: string) {
    setMoving(true);
    setError(null);
    try {
      await apiClient.patch(`/accounts/${accountId}/profile`, { profileId: projectId });
      setOpen(false);
      onMoved();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось перенести аккаунт');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Перенести…
      </button>
      {open && (
        <div className={styles.popover} role="menu" aria-label="Перенести в проект">
          {list.data && others.length === 0 && <p className={styles.empty}>Других проектов нет</p>}
          {others.map((p) => (
            // Names can repeat across clients; the networks tell them apart.
            <button key={p.id} type="button" role="menuitem" className={styles.item} disabled={moving}
              onClick={() => move(p.id)}>
              {`${p.name} (${p.accounts.map((a) => a.account.platform).join(', ')})`}
            </button>
          ))}
        </div>
      )}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
```

Check `useApiGet` supports `enabled` (it does — `AccountDetailPage` passes `{ enabled: tableOpen }`).

CSS: `.wrapper { position: relative; }`; `.trigger` styled like the new compact `.deleteButton` but with `color: var(--text)`; `.popover { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 220px; display: flex; flex-direction: column; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }`; `.item` full-width, left-aligned, hover background `color-mix(in srgb, var(--accent) 12%, transparent)`; `.empty`, `.error` muted / `var(--danger)`. Use the variable names `AccountDetailPage.module.css` already uses for surfaces.

In `AccountDetailPage.tsx`, put before the delete button:

```tsx
<MoveAccountButton accountId={account.id} currentProjectId={profile.id} onMoved={() => setReloadKey((key) => key + 1)} />
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run`.
- [ ] **Step 5: Commit** — `git commit -m "«Перенести…» moves an account to another project"`

---

### Task 11: Project page — no «Убрать» on tiles, soft delete wording

**Files:**
- Modify: `frontend/src/components/NetworkTile.tsx`, `NetworkTile.module.css`, `NetworkTile.test.tsx`
- Modify: `frontend/src/pages/ProjectPage.tsx`, `ProjectPage.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// NetworkTile.test.tsx — replace the «Убрать» tests
it('a filled tile only links to the account page', () => {
  render(<MemoryRouter><NetworkTile network={NETWORKS[1]} item={item} onAdd={vi.fn()} /></MemoryRouter>);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/accounts/acc-1');
  expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();
});

// ProjectPage.test.tsx
it('says the statistics are kept when the project is deleted', async () => {
  // existing setup that renders the project page
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Удалить проект' }));
  expect(confirm).toHaveBeenCalledWith('Удалить проект «Coffee Lab»? Статистика аккаунтов сохранится и вернётся, если добавить их снова.');
});
```

(Use the project name the test file's fixture uses.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**
- `NetworkTile`: drop the `onRemoved` prop, `remove`, its state, the button and error span; `FilledTile({ item })`. Remove the `apiClient` and `useState`/`MouseEvent` imports. Delete `.remove`/`.error` CSS rules if unused.
- `ProjectPage.tsx`: drop `onRemoved={reload}` from both `NetworkTile` usages; confirm text: `` `Удалить проект «${name}»? Статистика аккаунтов сохранится и вернётся, если добавить их снова.` ``

- [ ] **Step 4: Run, verify pass** — `npx vitest run` and `npx tsc --noEmit` (frontend, or `npm run build`).
- [ ] **Step 5: Commit** — `git commit -m "Project page: tiles link only; deleting a project keeps statistics"`

---

### Task 12: Link field knows deleted accounts and its network; home page shows login errors

**Files:**
- Modify: `frontend/src/components/LinkField.tsx`, `LinkField.test.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`, `HomePage.module.css`, `HomePage.test.tsx`

**Interfaces:**
- Consumes: `POST /accounts/preview` `{ link, platform }` → `{ …, alreadyAdded, previouslyAdded }` (Task 3); `/?instagramError=` (Task 7).

- [ ] **Step 1: Write failing tests**

```tsx
// LinkField.test.tsx (reuse its existing render helper and timers)
it('tells the backend which network the field is for', async () => {
  post.mockResolvedValue({ data: { platform: 'telegram', name: 'Chan', followersCount: 1, avatarDataUri: null, alreadyAdded: false, previouslyAdded: false } });
  renderField({ platform: 'telegram', value: 'https://t.me/chan' });
  await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/preview', { link: 'https://t.me/chan', platform: 'telegram' }));
});

it('says a previously deleted account comes back with its statistics', async () => {
  post.mockResolvedValue({ data: { platform: 'telegram', name: 'Chan', followersCount: 1, avatarDataUri: null, alreadyAdded: false, previouslyAdded: true } });
  renderField({ platform: 'telegram', value: 'https://t.me/chan' });
  expect(await screen.findByText('Аккаунт добавлялся раньше — собранная статистика вернётся')).toBeInTheDocument();
  expect(screen.queryByText('Этот аккаунт уже добавлен')).not.toBeInTheDocument();
});

// HomePage.test.tsx
it('shows an Instagram login error it was sent back with, then clears the address', async () => {
  render(
    <MemoryRouter initialEntries={['/?instagramError=' + encodeURIComponent('Аккаунт больше не существует')]}>
      <Routes><Route path="/" element={<><HomePage /><LocationProbe /></>} /></Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Аккаунт больше не существует');
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
});
```

with, in the test file:

```tsx
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`LinkField.tsx`: `AccountPreview` gains `previouslyAdded: boolean`; request `.post('/accounts/preview', { link: trimmed, platform })`; keep the client-side `res.data.platform !== platform` check as a fallback; render:

```tsx
{preview.alreadyAdded && <p className={styles.duplicate}>Этот аккаунт уже добавлен</p>}
{preview.previouslyAdded && <p className={styles.helperText}>Аккаунт добавлялся раньше — собранная статистика вернётся</p>}
```

`HomePage.tsx` (same pattern as `AccountDetailPage`):

```tsx
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './HomePage.module.css';

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the Instagram login callback when the login could not be tied to an account.
  const [instagramError] = useState(() => searchParams.get('instagramError'));
  useEffect(() => {
    if (searchParams.has('instagramError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Единый центр отчетности FD Agency</h1>
      {instagramError && <p className={styles.error} role="alert">{instagramError}</p>}
      <div className={styles.actions}>
        <Link to="/projects" className={styles.primary}>Все проекты</Link>
        <Link to="/guide" className={styles.secondary}>Как пользоваться</Link>
      </div>
    </div>
  );
}
```

`HomePage.module.css`: `.error { color: var(--danger); }` (match `AccountDetailPage.module.css` `.error`).

- [ ] **Step 4: Run, verify pass** — `npx vitest run`.
- [ ] **Step 5: Commit** — `git commit -m "Link field: deleted accounts come back, network-aware check; home page shows login errors"`

---

### Task 13: Full verification

- [ ] **Step 1:** In `backend/`: `npx jest` → all pass; `npm run build` → ok; `npx tsc --noEmit` → clean. (Do NOT run `npm run lint`.)
- [ ] **Step 2:** In `frontend/`: `npx vitest run` → all pass; `npm run build` → ok.
- [ ] **Step 3:** `grep -rn "ProfileSwitcher\|CompetitorsSection\|newProfile\|deactivate" backend/src frontend/src` → no hits (except competitor backend modules, which stay).
- [ ] **Step 4:** Spec walk-through: each item in spec §3–§6 maps to a task above; note any gap and fix it.
- [ ] **Step 5:** Commit any fixes. Deploy note for the PR: one migration (`AddProfileIsActive1790100000000`) runs with the usual redeploy.
