---
task: 23
title: Survive tab discards, offline periods and X outages
feature: resumable-jobs
---

# Resumable jobs

A job can be paused, Xomoni closed with the browser, and the job resumed later from where it stopped, with nothing lost and nothing done twice (#23). What interrupts it is waited out, never counted as a failure (PLAYBOOK F5, F6): the X window closed, Chrome unloading the X tab to save memory, the connection gone. Opening Xomoni again never starts anything by itself: the person resumes. Each run, a resumed one too, first reads X's Home again, so it stops for a notice X showed meanwhile (#377). Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`). A test closes Xomoni as the person closes Chrome: its dashboard and its X window go, while the browser profile, and so Xomoni's database, stays, as it does across a restart. Then it opens Xomoni's dashboard again. Chrome's Memory Saver is played by asking Chrome, from the dashboard, to unload the X window's tab.

Each test is a fresh install, with active hours off, so a job may run at any time of day. A new account's first delete comes 320 to 480 seconds after its first page load, so no test waits for one. The engine's side, what is saved after each post, how a run skips what is done, the three hours without progress, is proven by `apps/extension/tests/runner.test.ts`, `interruptions.test.ts`, `robustness.test.ts` and `sessions.test.ts`. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep "@task-23(\s|$)"
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S23-01 · happy

- Given a cleanup of the person's 2 posts before Jan 1, 2021, running
- When they close Xomoni and its X window, as when Chrome closes, and open Xomoni again
- Then the job is there, Paused: Xomoni was closed while this job was running. Resume to continue., with 0 removed and
  2 remaining
- And Resume opens the X window again, which reads X's Home first, then the profile, with the 2 posts still to go
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-02 · happy

- Given a job paused when Xomoni closed
- When the person opens Home
- Then it says “Delete posts older than Jan 1, 2021” is paused, 0% done. It carries on from where it stopped., with
  Resume
- And Resume there runs the job again: Working on “Delete posts older than Jan 1, 2021”
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-03 · happy

- Given a running cleanup
- When the person pauses it, then resumes it
- Then the log says Paused “Delete posts older than Jan 1, 2021” — 0 done, 0 skipped, 0 failed. Paused by you., and
  Started once for each run
- And the job keeps its 2 remaining and the time it was created
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-04 · happy

- Given Complete my copy, which reads the person's profile, then their replies, then more
- When the person pauses it on the replies, closes Xomoni and resumes the read
- Then the X window reads X's Home, then the replies again: the page the read had reached, never the profile again
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-05 · invalid

- Given a cleanup the person cancelled
- When they look for a way to resume it, under All
- Then it is Cancelled, with no Resume, Start or Pause: only Remove from the list
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-06 · invalid

- Given a cleanup running in one dashboard tab
- When the person opens Activity in a second tab
- Then the job shows there as running, with no Pause, Resume, Start or Cancel: a job runs in one tab
- And a Pause in the first tab shows in the second
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-07 · invalid

- Given a paused cleanup, and another cleanup running
- When the person looks at the paused one
- Then its Resume is off while the other runs, and on again once that one is paused: one job at a time
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-08 · error

- Given a running cleanup, waiting to load the person's profile
- When the person closes the X window
- Then the job opens it again for that page load, loads the profile, takes up the posts there and waits to remove
  the first
- And nothing is counted as failed, with its 2 remaining; closed while the job waits for the person, it pauses
  instead (S199-16)
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-09 · error

- Given a cleanup that has just opened the X window and waits to load the person's profile
- When Chrome unloads the X window's tab to save memory
- Then the job loads the profile in it all the same, takes up the posts there and waits to remove the first
- And nothing is counted as failed, with 2 still remaining
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-10 · error

- Given a paused cleanup
- When the person resumes it while the internet connection is down
- Then it waits for the connection, Waiting for the internet connection, with nothing counted as failed
- And once the connection is back, it goes on: Back online — continuing shortly
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-11 · error

- Given a running cleanup, and X or the connection failing again and again
- When three hours pass with no progress
- Then the job pauses: … and nothing worked for three hours. Resume when X and your connection work again.
- Manual: the job's waits double from 1 to 30 minutes on a timer in a dedicated worker, which Playwright's clock
  doesn't reach. apps/extension/tests/interruptions.test.ts proves it (pauses the job after three hours without
  progress)

## S23-12 · security

- Given a paused cleanup, and X now showing "Your account is temporarily limited" on its Home
- When the person resumes it
- Then the job reads X's Home first and stops there: Stopped for safety, X shows a restriction on this account
- And it loads no page of posts, with nothing removed
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-13 · security

- Given a cleanup the person paused
- When half a minute passes, longer than the job's wait before a page load
- Then nothing at all reaches X
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-14 · security

- Given a job paused when Xomoni closed
- When the person opens Xomoni again and leaves it
- Then the job stays paused: no X window opens, and nothing reaches X until they press Resume
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-15 · empty

- Given a person with an X account in Xomoni and no job yet
- When they open Home, then Activity
- Then Home says All is well, with nothing to resume, and Activity No open jobs
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-16 · empty

- Given a cleanup paused before it removed anything
- When the person looks at its card and at Home
- Then it has 0 removed and 2 remaining, and Home says 0% done. It carries on from where it stopped.
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-17 · cancel

- Given a paused cleanup
- When the person cancels it
- Then it leaves the open jobs, Cancelled under All, with 0 removed
- And nothing reaches X, and the X window stays where it was
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-18 · cancel

- Given a cancelled cleanup under All
- When the person presses Remove
- Then it leaves the list, and its lines stay in the activity log
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-19 · a11y

- Given a running cleanup and someone using only the keyboard
- When they Tab to Pause and press Enter, then Tab to Resume and press Enter
- Then the job pauses, then runs again
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-20 · a11y

- Given a job paused when Xomoni closed
- When axe checks Activity with its card, and Home
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-21 · browser

- Given the system in dark mode
- When the person pauses a cleanup and opens its log
- Then the paused card and its log have no serious or critical violation (and Edge, as CI's e2e-edge runs every
  scenario)
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-22 · persistence

- Given a cleanup running in one dashboard tab, and Activity open in a second
- When the person closes the first tab and reloads the second
- Then the second has the job, paused because Xomoni was closed, and its Resume runs it there
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts

## S23-23 · persistence

- Given a cleanup the person paused
- When they close Xomoni and open it again
- Then it is still Paused by you., not taken for one Xomoni was closed on, with its 2 remaining
- Test: apps/web/e2e/extension/resumable-jobs.spec.ts
