# Projects structure and navigation — design

Date: 2026-10-20. Status: approved in chat, pending spec review.

Sub-project 1 of the client brief «Единый центр отчетности FD Agency». Later
sub-projects (separate specs): 2 — own-profile view on the network page;
3 — competitors mode (tables б1/б2); 4 — AI «почему пост сработал»;
5 — VK connector; 6 — YouTube connector.

## 1. Goal

Turn the app into a project-centred reporting hub: a project is a client
(Pheromone, Мезопроф, …) holding one account per social network. The existing
`profiles` model (PR #25) already groups accounts by brand; this sub-project
renames it to «проект» on screen, adds a home page, a guide, a project
creation form and a tile-based project page, and removes Compare.

Out of scope: anything on the network page beyond the Instagram full-access
button (sub-project 2), competitor linking (3), VK/YouTube data (5, 6).

## 2. Decisions

- Project = existing `profiles` row. Code, DB and API keep the name `profile`;
  only UI text says «проект». No rename migration.
- Every existing profile becomes a project, competitor-only ones included.
  Sub-project 3 will offer moving them under a client.
- Instagram is added by link (Business Discovery, public data). Full stats come
  later via «Подключить полный доступ» (Instagram login) on the account page.
- Project creation adds every account it can; failures are reported, not fatal.
- Links are optional; a project may exist with no accounts.
- One account per network per project, enforced when adding. Existing
  projects that already hold two accounts on one network keep both.
- VK and YouTube appear in the form and on the project page as disabled «Скоро».

## 3. Pages and navigation

| Route | Page | Notes |
|---|---|---|
| `/` | Home | New. H1 «Единый центр отчетности FD Agency»; two large buttons «Все проекты» → `/projects`, «Как пользоваться» → `/guide`. |
| `/projects` | Все проекты | Today's `OverviewPage`: H1 «Все проекты», «Добавить проект» button on the right. Lists projects from the `profiles` table (so empty projects show, card text «Аккаунты не добавлены»). |
| `/projects/:id` | Project page | Reworked `ProfilePage` (§5). |
| `/accounts/:id` | Network page | Unchanged except the Instagram full-access block (§6). |
| `/guide` | Как пользоваться | New static Russian page (§7). |
| `/profiles/:id` | — | Redirects to `/projects/:id`. |
| `/compare` | — | Removed (route, page, nav item). Unknown routes keep redirecting to `/`. |

Top bar: brand «FD Agency» linking to `/`; nav «Все проекты», «Как пользоваться»;
«Log out» → «Выйти». Single-account project cards on «Все проекты» now link to
`/projects/:id` too (the project page is always the entry point).

## 4. «Добавить проект» form

Dialog opened from «Все проекты»; replaces `AddAccountModal` (both tabs; the
«Свой аккаунт» login path is removed).

- Шаг 1 — «Название проекта», required, placeholder
  «Например: Pheromone, Мезопроф, Ренессанс Страхование».
- Шаг 2 — «Ссылки на аккаунты проекта», four labelled fields, each with an
  example under it:
  - Instagram — `https://instagram.com/brand`
  - Telegram — `https://t.me/channel`
  - ВКонтакте — `https://vk.com/brand` (disabled, «Скоро»)
  - YouTube — `https://youtube.com/@brand` (disabled, «Скоро»)
- Each filled field is checked as the user types (debounced, existing
  `POST /accounts/preview`): found → name + avatar under the field; otherwise
  the error. A link for the wrong network in a field → «Это ссылка не на
  Telegram» / «…не на Instagram».
- «Создать проект» is enabled once the name is non-empty. On submit the
  dialog calls `POST /profiles`; on success it navigates to the new project
  page, passing `failed[]` so the page shows a notice
  «Не удалось добавить: Telegram — канал не найден» (one line per failure).

## 5. Project page (`/projects/:id`)

- Header: project name with the existing rename control; «Удалить проект»
  button → confirm «Удалить проект "X" вместе со всеми аккаунтами и
  данными?» → `DELETE /profiles/:id` → navigate to `/projects`.
- Four tiles, fixed order Instagram, Telegram, ВКонтакте, YouTube, all the same
  size:
  - Filled: avatar, name, network icon, followers. Click → `/accounts/:id`.
    A small «Убрать» control → confirm → `DELETE /accounts/:id`; the tile
    becomes empty, the project stays.
  - Empty (Instagram/Telegram): large «+» and «Добавить Instagram» /
    «Добавить Telegram». Click → small dialog with one link field (same live
    check as the form) → `POST /profiles/:id/accounts`.
  - VK/YouTube: empty tile «+ ВКонтакте — скоро» / «+ YouTube — скоро»,
    not clickable.
- Extra accounts beyond one per network (legacy data) render as additional
  filled tiles after the four.
- The «Не удалось добавить …» notice from §4 shows above the tiles when present.

## 6. Instagram full access (account page)

On an Instagram account of type `public_no_access` the account page shows a
note «Публичные данные: охват и репосты недоступны» and a button
«Подключить полный доступ».

- Click → `GET /accounts/:id/instagram/upgrade` → returns the Instagram login
  URL; the OAuth state row records the target `accountId` (§8).
- The existing Instagram OAuth callback, when the state carries an
  `accountId`: fetch the logged-in profile; if its username equals the
  account's `externalId` (case-insensitive, without `@`) → set the account's
  `type` to `own`, store the encrypted credential, keep all posts and history;
  redirect to `/accounts/:id`. Otherwise → redirect with error
  «Вы вошли в другой аккаунт Instagram (@x), а проект ждёт @y»; nothing changes.
- The following nightly sync / «Обновить» then collects insights as for any
  own account.
- `GET /accounts/instagram/connect?type=own` (create-from-login) is removed.

## 7. «Как пользоваться» guide

Static page, Russian, short sections with headings:
1. Что такое проект (клиент; одна или несколько соцсетей).
2. Как добавить проект (название, ссылки, примеры форматов; что будет, если
   ссылка не найдена).
3. Страница проекта (плитки, «+ Добавить», «Убрать», удаление проекта).
4. Страница соцсети (период, по умолчанию 30 дней; топ-10 и сортировка;
   полный список; карточка поста).
5. Instagram: публичные данные и «Подключить полный доступ» (кто должен войти,
   что добавится).
6. Обновление данных («Обновить», ночное обновление, «Загрузить всю историю»).
7. ВКонтакте и YouTube — скоро.

A placeholder note at the top: «Видеоинструкция появится позже».

## 8. Backend

| Endpoint | Behaviour |
|---|---|
| `POST /profiles` `{ name, links: { instagram?, telegram? } }` | Trims and requires `name` (≤ existing rename cap). Creates the profile, then for each link: parse (must match the field's network), preview, create the account in this profile. Returns `{ profile, added: Account[], failed: { platform, message }[] }`. Status 201 even with failures. |
| `POST /profiles/:id/accounts` `{ link }` | 404 unknown project. 409 «В проекте уже есть Telegram» if the network is occupied; 409 «Этот аккаунт уже в проекте "X"» on the `(platform, externalId)` unique clash; 400 for unparseable/not-found links (existing messages). |
| `DELETE /profiles/:id` | Deletes all its accounts through the existing account-delete path (posts, snapshots, history loads, credentials), then the profile. |
| `DELETE /accounts/:id` | As today, but no longer deletes a profile left empty. |
| `GET /profiles` (overview) | Lists from `profiles`, including empty ones. |
| `GET /accounts/:id/instagram/upgrade` | 404 unknown; 400 if not Instagram or already `own`/`client`. Returns `{ url }`. |
| `GET /accounts/instagram/connect` | Removed. |

Per-link failure messages in `failed[]` reuse the existing Russian errors
(not found, wrong network, Facebook not connected / needs reconnect), plus
«Не удалось проверить, попробуйте ещё раз» for network errors and rate limits.
The compare endpoint stays (unused); removing it is a later cleanup.

One migration: `instagram_oauth_states` gains a nullable `accountId uuid`
column. An upgrade login stores `type = own` plus the target `accountId`; the
state service's consume step returns both. A state with `accountId` set means
"upgrade this account", never "create one".

## 9. Testing

Backend (jest): create with mixed added/failed; wrong-network link in a field;
one-per-network 409; duplicate-account 409 naming the project; project delete
cascades; account delete leaves the project; overview includes empty
projects; upgrade URL guards; callback upgrade on username match (type, token,
posts untouched) and refusal on mismatch.

Frontend (vitest): Home buttons; nav without Compare, «Выйти»; «Все проекты»
heading and «Добавить проект»; form examples, VK/YouTube disabled, live check,
navigate with failure notice; project tiles (filled, empty «+», «скоро»,
legacy extra tile), «Убрать», «Удалить проект»; `/profiles/:id` redirect;
full-access block shown only for public Instagram accounts; guide renders.

Checks: backend jest + `nest build` + `tsc --noEmit` (never `npm run lint`);
frontend vitest + `tsc -b` + `vite build`.

## 10. Delivery

One branch `projects-structure`, one PR to `master`. Deploy is the usual
redeploy plus running the one migration from §8.
