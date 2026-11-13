# `background/`: service worker

The extension's MV3 service worker (`sw.js`). It stores what content scripts observe in x.com tabs (posts, the profile, rate-limit headers) in IndexedDB, opens or focuses the dashboard, handles clicks on desktop notifications, and saves X's archive in Downloads/Xomoni while Xomoni expects it. Chrome can stop it at any time, so it keeps no state in memory. It must stay thin: it never runs jobs (the engine runs in the dashboard page), never imports UI or page scripts, and never acts on X.

## Files

| File    | Responsibility                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sw.ts` | Stores `ingest`, `profile` and `rate` messages from Xomoni's content script in the top frame of an x.com tab, after `parseRuntimeMessage` has checked and copied them (#145); opens the dashboard; routes notification clicks; registers `suggestArchivePath` for `downloads.onDeterminingFilename`. |
| `archive-downloads.ts` | Where Chrome saves X's archive (#196, ADR-0022): `archiveDownloadTarget` answers `Xomoni/<name>` for a file named like X's archive while Xomoni expects one (`expectingArchive`), places Xomoni's own folder note (known by its fixed address, `FOLDER_NOTE_URL`, and the extension's id: Chrome forgets the name `downloads.download` gave it once this listener exists), and answers nothing for any other download. It reads the database only for such a file. `suggestArchivePath` is the listener: it always answers Chrome, even when the database can't be read, since Chrome holds every download until it does. |

## Depends on

- `../shared/` for `db`, `upsertItems`, `upsertAccount`, `kvSet` and `expectingArchive` (`db.ts`), `ARCHIVE_FILE` and `archiveDownloadPath` (`x-archive.ts`), `fromXPage` and `parseRuntimeMessage` (`inbound.ts`), the `RuntimeMessage` type (`messages.ts`) and `ATTENTION_ID` (`notify.ts`).
- Chrome APIs: `chrome.runtime`, `chrome.action`, `chrome.notifications`, `chrome.tabs`, `chrome.windows`, `chrome.storage.session` and `chrome.downloads.onDeterminingFilename`.
- Shared state, not an import: the `workerTab` key in `chrome.storage.session`, written by `../engine/worker-tab.ts`.

## Used by

- No module imports it. It is the `background.service_worker` entry in `../../public/manifest.json`, built as `sw.js` by `../../vite.config.ts`.
- `../content/` sends it `RuntimeMessage`s through `chrome.runtime.sendMessage` (in `net.ts`).

## Rules

- `ext-background-is-thin` (from `.dependency-cruiser.cjs`): files here import only `background/`, `shared/` and `engine/`. The rule mentions alarms, but `sw.ts` registers none today.
- `ext-ui-stays-out-of-the-page`: the UI never imports this folder; it shares data with it through IndexedDB and `chrome.storage.session`.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - A1, F8: rate-limit observations from every x.com tab are stored in the `limits` table, so the person's own use of X counts against the quotas the limiter checks.
