# `shared/`: data model, parsers and storage

The kernel of the extension: the data model, parsers for X's GraphQL traffic and the X data archive, cleanup filters, pacing settings and the IndexedDB database. It is bundled into the dashboard page, the service worker and the content script in x.com tabs. It must never import another area, and it never acts on X. Files the content script imports (`attention.ts`, `graphql.ts`, `messages.ts` and their imports) must not use IndexedDB or extension-only Chrome APIs, because there they run under x.com's origin.

## Files

| File           | Responsibility                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archive.ts`   | Parses the official X data archive (`window.YTD…` files) into item drafts and reads the archive's owner.                                                                                                                                                   |
| `activity-log.ts` | The activity log export (#34): CSV for spreadsheets and JSON for tools, oldest first, with a link to each post. Pure. |
| `attention.ts` | Decides when only the person can continue (login, including X's `/i/jf/` flow; X check; wrong account; a pop-up Xomoni couldn't close), the text shown for it, and `restrictionNotice` for X's suspended or limited notices.                               |
| `backup.ts`    | The archive a person downloads for a date range (Archive page): `archiveItems` picks the posts, replies and reposts in the range, `archiveHtml` writes a self-contained page with every post escaped and no scripts, `archiveJson` the same as data. Pure. |
| `bridge.ts`    | The private channel between the page-world interceptor and the content script (#59): the port handover at `document_start` and `isCapture`. Pure DOM, no `chrome.*`.                                                                                       |
| `coverage.ts`  | What Xomoni can see of an account (PLAYBOOK E2): the profile timeline's ~3,200-post reach and the estimate of posts X has that the inventory doesn't. Pure.                                                                                                |
| `db.ts`        | The Dexie database (`xomoni`) and its write helpers: inventory upsert, accounts, `kv`, settings, activity log, consent, the archive-imported marker.                                                                                                       |
| `filter.ts`    | Cleanup rules: matching items, finding candidates in the inventory, choosing the action, estimating duration.                                                                                                                                              |
| `graphql.ts`   | Parses X's internal GraphQL responses (posts, profile, errors) and turns them into inventory drafts.                                                                                                                                                       |
| `json.ts`      | Safe reading of JSON Xomoni doesn't control (X's responses, archive files, runtime messages): `asObject`, `asString`, `asNumber`, `asId`, `at`. Everything is `unknown` until checked (ADR-0016). Pure.                                                    |
| `messages.ts`  | Message types between the dashboard, the content script and the service worker.                                                                                                                                                                            |
| `health.ts`    | The account health report after a run (#25): X's signals, sample checks, X's notice, the risk level and a suggested rest, as one summary. Pure.                                                                                                            |
| `notify.ts`    | Desktop notifications and their ids.                                                                                                                                                                                                                       |
| `pacing.ts`    | How work is spread over time (PLAYBOOK B4, #30): work sessions with rests (`SESSION`, `sessionStart`) and varied delays with an occasional longer pause (`pacingDelay`). Only ever slower. Pure.                                                           |
| `risk.ts`      | The risk ladder (ADR-0013): risk events (silent blocks included), `assessRisk` (level, pace factor, resume lock, full stop) and duplicate filtering. Pure.                                                                                                 |
| `settings.ts`  | The Careful preset, default settings, `normalizeSettings` (clamps stored settings to the one-fifth ceilings, and custom pacing to no faster than Careful with `noFasterThan`) and action labels.                                                           |
| `x-limits.ts`     | The one-fifth rule: X's published limits with sources, budgets, allowances, the live-limit rule, the quota check for failed pages (`quotaHit`) and the cap ceilings. Pure. `readFactor` halves page loads for accounts not known to be Premium (#33). |
| `x-operations.ts` | The names of X's GraphQL operations Xomoni reads: one list for the page-world interceptor and the content script (#61). Pure data, no imports. |
| `time.ts`      | Snowflake ids and X date parsing, the like-time estimate, `DAY` and `HOUR`.                                                                                                                                                                                |
| `types.ts`     | The data model: items, accounts, jobs, log entries, rate-limit observations, settings.                                                                                                                                                                     |

## Depends on

- No other area of the extension (rule `ext-shared-is-the-kernel`).
- npm: `dexie` (IndexedDB wrapper, in `db.ts`).
- Chrome APIs: `chrome.notifications` and `chrome.runtime.getURL` (in `notify.ts`).

## Used by

- `../engine/` for the data model, the database (`db`, `addLog`, `getSettings`), filters (`findCandidates`, `matchesFilter`, `actionFor`), attention checks, notifications, time helpers and the actor command types.
- `../background/` for storing observations (`upsertItems`, `upsertAccount`, `kvSet`, `db.limits`), the `RuntimeMessage` type and `ATTENTION_ID`.
- `../content/` for path checks (`attention.ts`), GraphQL parsing (`graphql.ts`) and message types (`messages.ts`).
- `../ui/` for the data model, the database, filters, settings, time helpers, archive parsing (`importArchive.ts`) and notifications.
- `../dev/` for the database and types, to seed demo data in the UI preview.
- `../../tests/sessions.test.ts` for `pacing.ts` and the default settings.
- `../../tests/archive-range.test.ts` for `backup.ts`.
- `../../tests/parsers.test.ts` for the parsers in `archive.ts`, `graphql.ts` (through `json.ts`), `filter.ts`, `time.ts` and `attention.ts`.

## Rules

- `ext-shared-is-the-kernel` (from `.dependency-cruiser.cjs`): files here import only other files in `shared/` and npm packages.
- `ext-content-is-isolated` and `ext-inject-is-isolated`: page scripts may use `shared/` and nothing else, so anything they need from the rest of the extension has to live here.
- `no-circular`: imports inside `shared/` go one way, for example `filter.ts` → `db.ts` → `settings.ts` → `types.ts`.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - B4 (#30): `pacing.ts` sets the work sessions, rests and delay shape; `settings.ts` turns active hours on by default (8:00–23:00).
  - A1–A3 (ADR-0012): `x-limits.ts` holds X's published limits and derives every cap as one fifth of them (deletes: 10 per 15 min; unlikes: 200 a day, shared with ghost-like cleanup); `settings.ts` builds Careful from those ceilings.
  - D1, D3, D4: `attention.ts` detects a logged-out page, X's check pages and an account switch, so the engine waits for the person instead of acting.
  - E5: `upsertItems` in `db.ts` marks a deleted item `present` again only if X shows it more than 5 s after the deletion.
  - E8: `parseArchiveAccount` lets the importer refuse an archive that belongs to another account.
  - F4: `graphql.ts` finds operations by name and walks responses without depending on their exact shape.
  - Known gap D2: `isLoginPath` does not recognize X's `/i/jf/` login flow yet.
