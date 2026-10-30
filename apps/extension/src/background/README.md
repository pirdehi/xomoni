# `background/`: service worker

The extension's MV3 service worker (`sw.js`). It stores what content scripts observe in x.com tabs (posts, the profile, rate-limit headers) in IndexedDB, opens or focuses the dashboard, and handles clicks on desktop notifications. Chrome can stop it at any time, so it keeps no state in memory. It must stay thin: it never runs jobs (the engine runs in the dashboard page), never imports UI or page scripts, and never acts on X.

## Files

| File | Responsibility |
| --- | --- |
| `sw.ts` | Stores `ingest`, `profile` and `rate` messages from content scripts; opens the dashboard; routes notification clicks. |

## Depends on

- `../shared/` for `db`, `upsertItems`, `upsertAccount` and `kvSet` (`db.ts`), the `RuntimeMessage` type (`messages.ts`) and `ATTENTION_ID` (`notify.ts`).
- Chrome APIs: `chrome.runtime`, `chrome.action`, `chrome.notifications`, `chrome.tabs`, `chrome.windows` and `chrome.storage.session`.
- Shared state, not an import: the `workerTab` key in `chrome.storage.session`, written by `../engine/worker-tab.ts`.

## Used by

- No module imports it. It is the `background.service_worker` entry in `../../public/manifest.json`, built as `sw.js` by `../../vite.config.ts`.
- `../content/` sends it `RuntimeMessage`s through `chrome.runtime.sendMessage` (in `net.ts`).

## Rules

- `ext-background-is-thin` (from `.dependency-cruiser.cjs`): files here import only `background/`, `shared/` and `engine/`. The rule mentions alarms, but `sw.ts` registers none today.
- `ext-ui-stays-out-of-the-page`: the UI never imports this folder; it shares data with it through IndexedDB and `chrome.storage.session`.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - A1, F8: rate-limit observations from every x.com tab are stored in the `limits` table, so the person's own use of X counts against the quotas the limiter checks.
