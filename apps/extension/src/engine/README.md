# `engine/`: job runner, pacing and safety policy

The headless engine that runs cleanup and scan jobs. It runs in the dashboard page (`dashboard.html`), one job at a time, and drives the x.com worker tab by sending one command at a time to the content script there; X's own web app sends every request. It must never import UI or page scripts, build requests to X itself, touch cookies, or fill in a login or X check. Every action goes through the `Limiter` first, and every outcome goes through `JobContext.settle`.

## Files

| File              | Responsibility                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cleanup.ts`      | Cleanup jobs: sweep X search or timelines and act in place, then deep-clean the remaining inventory items one by one. A sweep page X refuses for its quota is loaded again after X's reset (up to 3 times, then the job pauses); only a page that keeps failing otherwise hands over to the deep clean (PLAYBOOK A5).                                                                                                                                                                                             |
| `context.ts` | `JobContext`: per-run state and the safety policy that turns each outcome into done, skip, wait, retry or stop. Records X's warnings on the risk ladder and refuses to start while it holds the account back (`riskBlock`, ADR-0013). `pageRateLimit` tells whether a page failed for X's quota. |
| `limiter.ts`      | `Limiter`: jittered delays, batch breaks, rolling caps, one fifth of X's published and live limits per budget, counting every request that reached X (ADR-0012), warm-up on an account's first active days, the risk ladder's pace factor, page loads remembered across runs, active hours, adaptive slowdown that only successful actions ease. |
| `runner.ts`       | `runner`: runs one job at a time under a Web Lock, publishes `RunnerState` to the UI, creates and recovers jobs.                                                                                                                                                                                                  |
| `scan.ts`         | Scan jobs: loads and scrolls X pages so the content script can record posts; changes nothing on X.                                                                                                                                                                                                                |
| `timer-worker.ts` | Dedicated Web Worker that runs the timers, so pacing is not throttled when the dashboard tab is in the background.                                                                                                                                                                                                |
| `timers.ts`       | `sleep` (abortable, backed by the timer worker), `randomBetween` and the `Aborted` error.                                                                                                                                                                                                                         |
| `worker-tab.ts`   | `workerTab`: opens, focuses and messages the x.com worker tab; the `WorkerGone` and `NotReady` errors.                                                                                                                                                                                                            |

## Depends on

- `../shared/` for the data model, the database (`db`, `addLog`, `getSettings`), filters (`findCandidates`, `matchesFilter`, `actionFor`), attention checks (`pageNeed`, `needMessage`, `NEED_TITLE`), notifications, time helpers and the actor command types.
- Chrome APIs: `chrome.tabs`, `chrome.windows` and `chrome.storage.session` (in `worker-tab.ts`).
- Web APIs: Web Locks (`navigator.locks`, in `runner.ts`) and a dedicated Web Worker (in `timers.ts`).
- At runtime, not by import: the content script in the worker tab answers `{ type: 'actor', command }` messages (see `../content/`).

## Used by

- `../ui/` for `runner` (start, pause, cancel, state, job creation, `recoverInterruptedJobs`) and `workerTab` (open, focus, ping).
- `../background/` reads the worker tab id that `worker-tab.ts` stores in `chrome.storage.session`; it does not import this folder.
- `../../tests/parsers.test.ts` for `sweepUrls`.

## Rules

- `ext-engine-is-headless` (from `.dependency-cruiser.cjs`): files here import only `engine/` and `shared/`; no UI, no content or inject scripts, no background code.
- `ext-ui-stays-out-of-the-page`: the UI may import the engine, so the engine is the only way the UI drives the worker tab.
- `no-circular`: keep the order `runner.ts` → `cleanup.ts` / `scan.ts` → `context.ts` → `limiter.ts` / `worker-tab.ts` → `timers.ts`.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - A1: `Limiter.before()` waits for the reset (plus 5 to 20 s) when X's headers for the governing operation show `remaining ≤ 1` or a 429; page loads check every timeline operation.
  - A2: `settle` retries `rate_limited` after the reset plus 10 to 30 s (15 to 20 min if unknown); the slowdown factor grows ×1.6 up to 6 and drops 5% per success.
  - A3: rolling hourly and daily caps in `Limiter`; `daily_limit` waits about 24 h plus 5 to 30 min.
  - B1 (partial): error 226 stops the job as `blocked`.
  - B4 (partial): random delays, batch breaks and optional active hours.
  - C2 (partial): after a lock, the job waits for the person, then cools down 3 to 6 min with slowdown ×2.
  - D1, D3, D4: `NeedsYou` and `waitForYou` wait without acting until the page has looked right for 5 s; `verifyPage()` re-checks login and account before each action.
  - E1, E3: the sweep uses X search to reach past the ~3,200 posts a profile shows; the deep clean visits what search missed.
  - E4: ghost likes (`relike`) only in the deep clean, and only when the option is on.
  - E5: `not_found` marks the item `gone` and does not count as a failure.
  - F1 (partial): the job pauses after `maxConsecutiveFailures` failures in a row.
  - F5 (partial): timers run in a Web Worker.
  - F8: the `xomoni-runner` Web Lock lets only one dashboard tab run a job.
