# Account profiles — one card per brand across networks

Status: draft, pending user review.

## 1. Scope

Groups accounts from different networks (Telegram, Instagram, …) that
belong to the same brand or person into a **profile**. Overview shows one
card per profile; opening it lists the profile's accounts.

**In scope:**
- A `profiles` table; every account belongs to exactly one profile.
- A migration that gives each existing account its own profile.
- Manual grouping: choosing a profile when adding by link, and moving an
  account between profiles from its detail page.
- Overview reworked to profile cards; a new profile page.
- Applies to all account types alike — own, client and competitor.

**Out of scope:**
- Automatic matching of accounts into profiles (by name or handle).
- Choosing a profile during the Instagram OAuth connect flow — OAuth
  accounts always land in a new profile and are moved afterwards.
- Profile-level ER or any blended cross-network metric other than total
  followers.
- Profile-level charts, posts or comparison.
- Deleting a whole profile in one action.
- Splitting Overview into own/client vs competitor sections.

## 2. Data model

New entity `Profile` (`profiles` table):

| column      | type        | notes                                  |
|-------------|-------------|----------------------------------------|
| `id`        | uuid PK     |                                        |
| `name`      | varchar     | non-empty; duplicates allowed          |
| `createdAt` | timestamptz | `CreateDateColumn`                     |

`Account` gains `profileId: uuid NOT NULL`, FK → `profiles.id`
(`ON DELETE RESTRICT`), with a `ManyToOne` relation.

**Invariant:** a profile always has at least one account. A profile left
empty by an account delete or move is deleted in the same transaction.

**Migration** (`AddProfiles`):
1. Create `profiles`.
2. Add `accounts.profileId` as nullable.
3. For each account, insert a profile named after the account and set
   `profileId`.
4. Make `profileId` `NOT NULL` and add the FK and an index.

`down` drops the column and the table.

## 3. Backend

New `ProfilesModule` (`backend/src/profiles/`): entity registration,
`ProfilesService`, `ProfilesController`, all behind `JwtAuthGuard` like
the other controllers.

### 3.1 Account creation

All three creation paths assign a profile:

- `POST /accounts/from-link` — DTO gains optional `profileId` (uuid).
  If given, the profile must exist (404 otherwise); else a new profile is
  created named after the resolved account name. Profile creation and
  the account insert share one transaction.
- Instagram OAuth callback (`instagram-oauth.service.ts`, new-account
  branch) — creates a new profile named after the account. The
  re-login branch (existing account) is unchanged.
- `POST /accounts` — creates a new profile named after `dto.name`.

### 3.2 Account deletion

`DELETE /accounts/:id` deletes the account and, if its profile is now
empty, the profile — one transaction.

### 3.3 Endpoints

- `GET /profiles` → `ProfileSummary[]`, ordered by profile `createdAt`:
  ```ts
  interface ProfileSummary {
    id: string;
    name: string;
    totalFollowers: number | null; // sum of accounts' latest followersCount; null if no account has a snapshot
    accounts: Array<{
      account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
      latestSnapshot: { followersCount: number; avgEr: number | null } | null;
    }>;
  }
  ```
  Account items have the same shape as today's `/stats/overview` items
  and reuse the same latest-snapshot query. Accounts are ordered by
  followers, descending (accounts without a snapshot last).
- `GET /profiles/:id` → one `ProfileSummary`; 404 if missing.
- `PATCH /profiles/:id` body `{ name }` → renamed profile; 400 on an
  empty/whitespace name (trimmed), 404 if missing.
- `PATCH /accounts/:id/profile` body `{ profileId }` or
  `{ newProfile: true }` (exactly one; 400 otherwise) → `{ profileId }`
  of the account's new profile. Moves the account; a new profile is
  named after the account. Deletes the old profile if left empty. Moving
  to the profile it is already in is a no-op. 404 for a missing account
  or target profile.

`GET /stats/overview` stays unchanged.

## 4. Frontend

### 4.1 Overview

`OverviewPage` loads `/profiles` instead of `/stats/overview` and renders
a `ProfileCard` per profile.

`ProfileCard` (new component):
- Avatar of the profile's first account (most followers), via the
  existing `useAvatar`.
- Profile name, a row of `PlatformIcon`s (one per account), total
  followers (`—` if `null`). No ER, no delete button.
- Links to `/accounts/:accountId` when the profile has one account,
  otherwise to `/profiles/:id`.

`AccountCard` is unchanged and reused on the profile page.

### 4.2 Profile page — `/profiles/:id`

`ProfilePage` (new route in `App.tsx`):
- Header: profile name with a pencil button that turns it into an input
  (Enter/blur saves via `PATCH /profiles/:id`, Escape cancels; an error
  is shown inline); total followers.
- Grid of `AccountCard`s. A card's `onDeleted` reloads the profile; if
  the profile no longer exists (last account deleted), navigate to `/`.
- 404 → «Профиль не найден» with a link to Overview.

### 4.3 Account detail page

- Header gains a «Профиль: <name> ▾» control. It needs the profile, so
  `GET /accounts/:id/detail` adds `profile: { id, name, accountCount }`
  to its response. The control opens a list of all profiles (from
  `GET /profiles`, other than the current one) plus «Отдельный профиль»
  (hidden when the account is already alone). Selecting one calls
  `PATCH /accounts/:id/profile` and reloads the detail. A 404 shows
  «Профиль не найден» and reloads the list.
- When `profile.accountCount > 1`, a breadcrumb «← <profile name>»
  links to `/profiles/:profileId`.

### 4.4 Add dialog

The competitor (by-link) tab of `AddAccountModal` gains a «Профиль»
select: «Новый профиль» (default) plus all existing profiles (from
`GET /profiles`). The chosen id is sent as `profileId`. The «Свой
аккаунт» (OAuth) tab is unchanged.

## 5. Error handling

- All create/move/delete paths are single transactions; the API never
  leaves an empty profile or an account without one.
- Move to a deleted profile → 404 → UI message and list reload.
- Empty rename → 400 → inline error, the old name is kept.
- Stale `/profiles/:id` link → not-found state.

## 6. Testing

TDD, following the existing Jest (backend) and Vitest (frontend) specs.

**Backend:**
- Migration: N seeded accounts → N profiles, each linked, names match.
- `ProfilesService`: list aggregation and ordering, `totalFollowers`
  with missing snapshots (partial and all), get/rename/404/400.
- Move: to existing, to new, no-op, empty-source cleanup, 404s, 400 on a
  bad body.
- `AccountsService`: from-link with and without `profileId`, unknown
  `profileId` → 404, delete cleans up an emptied profile.
- Instagram OAuth: a new account gets a new profile; re-login doesn't.
- Controller specs for the new endpoints; detail response includes
  `profile`.

**Frontend:**
- `ProfileCard`: link target for one vs several accounts; summed
  followers; `—` for `null`.
- `ProfilePage`: renders accounts, rename save/cancel/error, not-found,
  delete of the last account navigates home.
- Account detail: profile control lists profiles, moves, handles 404;
  breadcrumb shown only for multi-account profiles.
- `AddAccountModal`: profile select defaults to new; sends `profileId`.
- `OverviewPage`: renders profile cards from `/profiles`.

## 7. Deploy

Requires running the migration on the VPS with the usual redeploy
sequence from master. Existing data keeps working right away (one
profile per account); the user merges brands afterwards.
