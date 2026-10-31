# `ui/`: dashboard

The React dashboard (`dashboard.html`), which runs as an extension page in a normal browser tab. Jobs run in this page too: the engine's runner lives here and drives the X worker tab through `../engine/`. The UI reads its data from IndexedDB with Dexie live queries and from the runner's state, and it creates, starts, pauses and cancels jobs. It must never touch X's page itself or import content, inject, background or dev code.

## Files

| File                           | Responsibility                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`                     | Entry point loaded by `dashboard.html`: applies the saved theme, pauses jobs left running by a closed dashboard, and renders `App`.                                     |
| `App.tsx`                      | App shell: hash routing, sidebar with the worker status chip, running-job banner, page switch and toasts.                                                               |
| `navigation.ts`                | `PageId` and `PageProps`, the contract between the shell and each page.                                                                                                 |
| `hooks.ts`                     | Hooks for the runner state, the active account and worker tab polling; the toast store; `startJob`.                                                                     |
| `queries.ts`                   | Live inventory counts per kind and the per-year histogram, read from the compound index.                                                                                |
| `format.ts`                    | Number, date and duration formatting; labels for kinds, targets, job states and outcomes; `postUrl` and `downloadFile`.                                                 |
| `importArchive.ts`             | Imports `account.js`, `tweets.js` and `like.js` from an unzipped X archive, after checking that it belongs to the connected account.                                    |
| `theme.ts`                     | System, light or dark theme, stored in `localStorage` and applied as `data-theme` on `<html>`.                                                                          |
| `styles.css`                   | Tailwind CSS entry: light and dark color tokens, base page styles, and the `.field` and `.tabular` classes.                                                             |
| `components/ui.tsx`            | Shared building blocks: `Card`, `Button`, `Badge`, `StatTile`, `Meter`, `Field`, `Toggle`, `Segmented`, `Modal`, `EmptyState`, `Callout`, `PageHeader`, `useNow`, `cx`. |
| `components/JobCard.tsx`       | One job with live progress, time estimate and start, resume, pause, cancel and remove controls.                                                                         |
| `components/LogList.tsx`       | Activity log rows, each with a link to the post on X when there is one.                                                                                                 |
| `components/LimitsPanel.tsx`   | Usage against Xomoni's own caps, and the 15-minute quotas X reported.                                                                                                   |
| `components/ActivityChart.tsx` | Stacked per-year chart, or table, of the items still on the account.                                                                                                    |
| `pages/Overview.tsx`           | Onboarding until an account is known; then the account summary, chart, limits, open jobs and recent activity.                                                           |
| `pages/Cleanup.tsx`            | Cleanup filter, preview of matching items, JSON backup, and the typed DELETE confirmation that starts the job.                                                          |
| `pages/Inventory.tsx`          | Archive import, read-only scan jobs, and the inventory browser with JSON export.                                                                                        |
| `pages/Jobs.tsx`               | List of jobs, each with its log on demand.                                                                                                                              |
| `pages/Activity.tsx`           | Full activity log with a level filter and CSV export.                                                                                                                   |
| `pages/Settings.tsx`           | Pacing presets and rules, active hours, notifications, failure limit, theme, and export or wipe of local data.                                                          |

## Depends on

- `../shared/` for the IndexedDB tables and helpers (`db.ts`), types (`types.ts`), cleanup filters, action choice and time estimates (`filter.ts`), pacing presets and labels (`settings.ts`), archive parsing (`archive.ts`), desktop notifications (`notify.ts`), time constants (`time.ts`) and the worker's `PageInfo` (`messages.ts`).
- `../engine/` for the job runner (`runner.ts`: `runner`, `createCleanupJob`, `createScanJob`, `recoverInterruptedJobs`) and the worker tab (`worker-tab.ts`: `workerTab`, `WorkerGone`).
- npm packages: `react` and `react-dom`, `dexie-react-hooks` for live queries, `lucide-react` for icons, and Tailwind CSS through `@tailwindcss/vite` for `styles.css`.

## Used by

- `dashboard.html` loads `main.tsx`; `vite.config.ts` builds it as the `dashboard` input into `dist/`.
- `../background/sw.ts` opens `dashboard.html` when the toolbar button is clicked, on install, and when a notification is clicked (by URL, not by import).
- `../dev/preview.ts` imports `main.tsx` to render the dashboard with demo data (`preview.html`, dev server only).

## Rules

- `ext-ui-stays-out-of-the-page` (from `.dependency-cruiser.cjs`): files here never import `content/`, `inject/`, `background/` or `dev/`. The worker tab is reached only through `../engine/worker-tab.ts`.
- `ext-dev-is-not-shipped` (from `.dependency-cruiser.cjs`): nothing here imports `dev/`; the dependency only goes the other way.
- `no-circular` (from `.dependency-cruiser.cjs`): `PageId` and `PageProps` live in `navigation.ts` so that pages do not import `App.tsx`, which imports the pages.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - A1, A3: `LimitsPanel` shows the quotas X reported and the usage against Xomoni's rolling caps; Settings edits the caps, with Careful as the default preset.
  - B6, E4: the "ghost" likes option on the Cleanup page is off by default and shows a warning when turned on.
  - D1: while the runner waits for the person, a "Needs you" banner and page title ask them to act in the X window.
  - E8: `importArchive.ts` refuses an archive without `account.js` or one that belongs to another account.
  - F5: the worker status chip warns when the X worker window is hidden, and the running-job banner asks to keep it open.
  - F8: `startJob` shows the runner's refusal as a toast when another dashboard tab holds the run lock.
  - B1 (partial): `JobCard` offers Resume on a job stopped for safety right away; the proposed cool-down is not built yet.
