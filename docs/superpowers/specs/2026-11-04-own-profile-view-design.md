# Own-profile view and soft delete — design

Date: 2026-11-04. Status: approved in chat, pending spec review.

Sub-project 2 of the client brief «Единый центр отчетности FD Agency».
Sub-project 1 (projects structure) shipped as PR #28. Later sub-projects:
3 — competitors mode (tables б1/б2); 4 — AI «почему пост сработал»;
5 — VK connector; 6 — YouTube connector.

## 1. Goal

Make the network (account) page the client's «Свой профиль» view, and stop
deleting an account or project from destroying collected statistics.

Out of scope: the «Конкуренты» mode itself (sub-project 3), a deliberate
"purge all data" action, VK/YouTube data.

## 2. Decisions

- Header «{название аккаунта} | Свой профиль / Конкуренты». «Конкуренты» is
  disabled and marked «Скоро» until sub-project 3.
- Removed from the network page: the «Проект:» select (`ProfileSwitcher`) and
  the competitors block (`CompetitorsSection`).
- Kept on the network page: «Удалить» (smaller) — the only place an account
  leaves a project — and a new compact «Перенести…» action for moving an
  account to another project.
- Removed from the project page: «Убрать» on network tiles.
- Top-10 posts gain a «Комментарии» sort. Default period stays last 30 days.
- Deleting an account is soft: it is hidden and stops syncing; posts,
  snapshots, history, competitor data and the Instagram credential are kept.
  Adding the same link again, in any project, revives the account with its old
  data, moved into that project.
- «Удалить проект» is soft too: the project is hidden and its accounts are
  soft-deleted, revivable the same way.
- Deleted own Instagram accounts keep their token refreshed daily, so a revive
  restores full access unless the user revoked it in Meta (then the existing
  «Переподключить» banner shows).
- Known consequence (accepted): the followers chart has a gap for the deleted
  period; posts refill through the revive sync (90 days) or «Загрузить всю
  историю».
- Data is purged only by Meta's data-deletion callback (credential), as today.
  The hard account purge (`AccountsService.remove` cascade) is removed.

## 3. Soft delete and revive (backend)

### 3.1 Representation

Reuse `accounts.isActive`. Add `profiles.isActive boolean NOT NULL DEFAULT
true` (migration `AddProfileIsActive…`, column only). Rejected alternatives:
TypeORM `@DeleteDateColumn` (does not cover query builders/raw SQL used by
stats, needs `withDeleted` on every revive/unique check, makes `isActive`
redundant); a membership/history table (not needed).

Shared helpers keep the filter in one place, e.g. an active-account lookup
that 404s on inactive rows and `requireActiveProject(em, id)` (404 «Проект не
найден» for missing or hidden projects).

### 3.2 Deleting

- `DELETE /accounts/:id` → `isActive = false`. Nothing else changes; the
  account keeps its `profileId`.
- `DELETE /profiles/:id` → in one transaction, `profiles.isActive = false` and
  `isActive = false` on all its accounts.

### 3.3 Reviving

`createFromLink` (used by «Добавить проект» and the project page's add
dialog) looks up the link including inactive rows:

- active match → 409 «Этот аккаунт уже в проекте «X»» (unchanged);
- inactive match → revive: in one transaction, a conditional
  `UPDATE … SET isActive = true, profileId = <target> WHERE id = … AND
  isActive = false`; then queue a manual sync. If the update touched no row
  (a concurrent add revived it first), answer the normal «уже в проекте» 409.
  The target is the given project (must be active) or the project being
  created.
- one account per network per project still applies (counting active
  accounts only): if the target already has that network → 409 «В проекте уже
  есть {сеть}» and the account stays deleted.
- own Instagram accounts (stored by numeric id) are matched through the
  Business Discovery `platformUserId`, as `matchesConnectedAccount` does
  today: an inactive match revives that account instead of conflicting.

`POST /accounts/preview`:
- `alreadyAdded` is true only for active matches;
- new `previouslyAdded: true` for an inactive match;
- accepts optional `expected` platform, checked before the connector lookup
  exactly as create does («Это ссылка не на {сеть}»).

Instagram login callback (full access on a linked account): the existing
clash check (another row already holds that numeric id) counts inactive rows
too, so it answers with the existing clash error instead of hitting the
unique index. In normal use this cannot arise: adding the link already
revives the inactive own row (above), so no second linked row is created.

### 3.4 Hidden everywhere

Inactive accounts and hidden projects are excluded from:
- projects list, project page, account counts (`profile-store`,
  `profile-summary`, `stats.service`);
- `/accounts/:id/*` reads and writes (detail, posts, avatar, sync, history
  load, Instagram connect, move) → 404;
- sync scheduler (already) and sync processor (re-checks `isActive` and skips
  jobs queued before the delete);
- Telegram webhook (incoming channel posts for inactive accounts ignored);
- history load runner and competitor runs/processor.

Not excluded: Instagram token refresh (keeps inactive accounts' tokens alive),
Meta deauthorize/data-deletion callbacks (still act on inactive accounts).

### 3.5 Moving

`PATCH /accounts/:id/profile` stays. It accepts only active target projects
and active accounts. The `newProfile` option is no longer used by the UI and
is removed.

## 4. Network page (frontend)

`AccountDetailPage` header, top to bottom:

- `← {проект}` breadcrumb (unchanged).
- `{account.name}` heading followed by a new `ViewModeSwitch`: segmented
  control «Свой профиль» (active) | «Конкуренты» (disabled, «Скоро», styled
  like the VK/YouTube tiles). Sub-project 3 only enables the second segment.
- Compact actions on the right: «Обновить», «Загрузить всю историю»,
  «Перенести…», «Удалить».

«Перенести…»: a small button opening a popover with the other active
projects, labelled «{name} ({networks})» as the old select did. Choosing one
calls `PATCH /accounts/:id/profile` and reloads, so the breadcrumb shows the
new project. Backend errors (e.g. «В проекте уже есть Telegram») show inline.
Replaces `ProfileSwitcher`, which is deleted.

«Удалить»: smaller, muted until hover. Confirm text: «Убрать «{name}» из
проекта? Собранная статистика сохранится — если добавить аккаунт снова, она
вернётся.» Then navigate to the project.

Removed: `CompetitorsSection` and its files (only used here). Backend
competitor endpoints stay for sub-project 3.

Top-10: `PostSortSelect` gains «Комментарии» (`comments`), for all networks.
Backend `PostSortKey` gains `comments` → `commentsCount`, ordered `DESC NULLS
LAST`.

## 5. Project page and link field

- `NetworkTile`: the «Убрать» button, its confirm and the `onRemoved` prop are
  removed; a filled tile only links to the account page.
- «Удалить проект» confirm: «Удалить проект «X»? Статистика аккаунтов
  сохранится и вернётся, если добавить их снова.»
- `LinkField` sends its network as `expected` to `/accounts/preview` and shows
  «Аккаунт добавлялся раньше — собранная статистика вернётся» when
  `previouslyAdded` is true (instead of the duplicate warning).

## 6. PR #28 leftovers

1. Instagram login failure with no known account (no `accountId` on the
   error) currently returns raw JSON. It redirects to `/?instagramError=<текст>`
   instead, and the home page shows it as an alert (same pattern as the
   account page), clearing the query parameter on arrival.
2. Link field check for a link of another network: fixed by `expected` (§3.3,
   §5).

## 7. Error handling summary

| Case | Result |
|---|---|
| Re-add, target already has that network | 409 «В проекте уже есть {сеть}»; account stays deleted |
| Two concurrent adds of a deleted link | first revives; second 409 «уже в проекте» |
| Add/move into a hidden or missing project | 404 «Проект не найден» |
| Open `/accounts/:id` of a deleted account | 404 → «Аккаунт не найден» |
| Sync job queued before delete | processor skips it |
| Revived own Instagram, token revoked | «Переподключить» banner (existing) |

## 8. Testing

TDD. Verification: backend jest + build + `tsc --noEmit`; frontend vitest +
build. Never backend `npm run lint`.

Backend:
- account delete keeps posts, snapshots, history, credential; sets inactive;
- project delete hides project and deactivates its accounts in one
  transaction;
- revive by link (into existing project, into a new project), by Instagram
  numeric id, through the Instagram login callback; network conflict leaves
  it deleted; race (conditional update touches no row) → 409;
- preview: `alreadyAdded` only for active, `previouslyAdded` for inactive,
  `expected` mismatch message;
- each read path hides inactive rows (§3.4); token refresh still includes them;
- move refuses hidden projects and inactive accounts;
- `comments` sort;
- callback error without account redirects to `/?instagramError=`.

Frontend:
- `ViewModeSwitch` renders, «Конкуренты» disabled with «Скоро»;
- account page has no project select and no competitors block;
- «Перенести…» lists other projects, moves, shows errors;
- delete confirm text and navigation;
- `NetworkTile` has no «Убрать»;
- «Комментарии» sort option;
- `LinkField` sends `expected`, shows the `previouslyAdded` hint;
- home page shows and clears `instagramError`.

Deploy: one migration (`profiles.isActive`), run with the usual redeploy.
