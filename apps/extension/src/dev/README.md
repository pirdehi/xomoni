# `dev/`: UI preview with demo data

`preview.ts` lets you work on the dashboard in a plain browser tab with the Vite dev server, without loading the extension or opening X. It replaces the few `chrome.*` APIs the dashboard calls with stubs, fills IndexedDB with a demo account, inventory, job, log and limits, then loads the real dashboard. It must never talk to X, and it must never become part of the extension build.

## Files

| File         | Responsibility                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview.ts` | Stubs `chrome.runtime`, `tabs`, `windows`, `notifications` and `storage.session`; seeds demo data unless the demo account already exists; then imports `../ui/main`. |

## Depends on

- `../shared/` for the IndexedDB tables and write helpers (`db.ts`) and the item and job types (`types.ts`).
- `../ui/` for the dashboard itself (`main.tsx`), imported after the stubs and data are in place.

## Used by

- `preview.html` loads `preview.ts`. Run `npm run preview:ui -w @xomoni/extension`, which starts the Vite dev server and opens `/preview.html`.
- Nothing else. `preview.html` is not an input in `vite.config.ts`, so `npm run build` never includes this code.

## Rules

- `ext-dev-is-not-shipped` (from `.dependency-cruiser.cjs`): no code outside `dev/` may import it. No rule limits what `dev/` imports; today it uses only `shared/` and `ui/`.
- No safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) apply: the stubbed worker tab answers every command locally and nothing reaches X.
