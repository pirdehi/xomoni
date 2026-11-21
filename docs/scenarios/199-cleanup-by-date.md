---
task: 199
title: Cleanup in three questions: what, how old, start
feature: cleanup-by-date
---

# Cleanup by date

How a person removes their own posts, replies, reposts or likes older than a date, or between two dates (#199): Cleanup's preview of what matches in their copy, the typed DELETE, the risks they read before an account's first job, and the job that then works through X at Xomoni's pace and stops or waits whenever X or the person needs it to. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, which X shows as Premium, with years behind it (`xHistory: 'long'`, `apps/web/e2e/fixtures/x/graphql/long-history`). Once the person has browsed their profile's tabs, Xomoni's copy holds:

- 5 posts: Feb 8, 2024 (with the word "launch"), May 20, 2023 (120 likes), Jun 1, 2021, Mar 14, 2020 and Aug 15, 2019;
- 2 replies: Nov 2, 2020, to the made-up `@fixture_friend`, and Mar 14, 2020, continuing the person's own thread;
- 1 repost, Jan 10, 2022, of a post by `@fixture_friend`;
- 2 likes, of `@fixture_friend`'s posts from May 5, 2019 and Apr 2, 2025.

Xomoni's pace is part of what is proven: a new account's first delete comes 320 to 480 seconds after its page loads (S199-07). So no test waits for a delete, and the delete itself is the one manual scenario (S199-32). Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-199
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S199-01 · happy

- Given a person who browsed their X profile's posts, replies and likes, with no X archive imported
- When they open Cleanup
- Then the four cards say 5 posts, 2 replies, 1 repost and 2 likes in your copy, with Posts chosen and 1 year pressed
- And Review shows 5 matching, the newest four with their date and text, then "and 1 more"
- And it shows the time it would take, and the pace: 80–120s · max 960/day, one fifth of X's 50 deletes per 15 minutes
- And Start cleanup stays off until they turn on Continue without it under "No archive imported: old posts can be missed"
- And nothing is sent to x.com while they look
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-02 · happy

- Given the person's copy on Cleanup
- When they choose Pick a date and type Jan 1, 2021 in Remove everything before
- Then 2 posts match, Mar 14, 2020 and Aug 15, 2019, and everything newer is left out
- And Review says posts before Jan 1, 2021
- And the confirmation names the job Delete posts older than Jan 1, 2021, with 2 in your copy, plus any that searching X finds
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-03 · happy

- Given the person's posts before Jan 1, 2022 on Cleanup, 3 of them
- When they turn on Only within a date range and set the start date to Jan 1, 2020
- Then only Jun 1, 2021 and Mar 14, 2020 match
- And the post from Aug 15, 2019, older than the start, is left untouched
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-04 · happy

- Given the person's copy on Cleanup
- When they choose Replies, then Reposts, then Likes
- Then each card is pressed alone, and each has its own matches
- And for replies, the continuation of their own thread is kept, as the summary says, until they turn off Keep replies in my own threads
- And for reposts, the archive warning goes, since the archive can't say which post a repost points to, and the confirmation says Undo reposts
- And for likes, a note says how like dates work, and the confirmation says Remove likes
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-05 · happy

- Given the person's 5 posts more than a year old on Cleanup, with nothing kept
- When they keep posts with at least 50 likes, text with Launch and the link of the post from Aug 15, 2019
- Then only Jun 1, 2021 and Mar 14, 2020 still match
- And once folded, the exceptions read: Keeps posts with 50+ likes, text with “launch” and 1 chosen post.
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-06 · happy

- Given the person's posts before Jan 1, 2021 on Cleanup
- When they continue without the archive, press Start cleanup, type DELETE, press Start cleanup, and accept the risks with I UNDERSTAND
- Then Activity › Jobs shows Delete posts older than Jan 1, 2021, running, with 0 removed, 2 remaining and Pause
- And the banner on every page says to keep the tab and part of the X window on screen, with Run hidden and Pause
- And Xomoni opens the X window on x.com/home, and the sidebar says X window ready
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-07 · happy

- Given a cleanup of the 2 posts before Jan 1, 2021 started on a new account, with active hours off in Settings
- When the job has loaded the profile in the X window and found them there
- Then it waits more than five minutes, its card counting down Pacing, before its first delete
- And nothing is removed and no delete reaches X meanwhile: a new account runs at a quarter of Xomoni's one fifth of X's limit
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-08 · happy

- Given the person's own browsing used a fifth of X's 15-minute window for profile timelines, as X's headers say (30 of 150, resetting in 12 minutes)
- When they start a cleanup of posts, with active hours off
- Then the job waits for X's reset, about 12 minutes: Profile timeline: one fifth of X’s live limit used — waiting for X’s window to reset
- And the X window stays on Home: no profile timeline is loaded while it waits
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-09 · invalid

- Given the person's posts before Jan 1, 2021 on Cleanup
- When they turn on the date range and set its start to Jan 1, 2022
- Then the page announces The start date must be before the end date.
- And nothing matches, and Start cleanup stays off
- And a start of Jan 1, 2019 clears the message, with 2 matching and Start on again
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-10 · invalid

- Given the person's posts before Jan 1, 2021 on Cleanup
- When they clear Remove everything before
- Then the page announces Pick the date to clean up before., and Start cleanup stays off: a cleared date never stands for today
- And with the range on and its start cleared, it announces Pick the start date of the range, or turn the range off.
- And turning the range off clears the message and turns Start back on
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-11 · invalid

- Given the confirmation of a cleanup open
- When the person types delete it, DELET, DELETE! or remove
- Then its Start cleanup stays off
- And typed as "  delete ", in any case with spaces around it, DELETE turns it on
- And the dialog says removed posts and likes cannot be restored by Xomoni or X
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-12 · invalid

- Given a cleanup of posts on Cleanup, where Xomoni searches X and visits each known one
- When the person turns off both Sweep X search and Visit each known post under Advanced
- Then the summary says Neither way is on: turn one on to start.
- And Start cleanup stays off
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-13 · error

- Given X shows the notice "Your account is temporarily limited" at the top of its Home page
- When the person starts a cleanup of their posts
- Then the job stops in the X window before loading anything: Stopped for safety, X shows a restriction on this account, Xomoni stopped at the first refusal and won’t retry
- And nothing is removed, and Resume waits about 12 hours, with only Resume anyway… to go past it
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-14 · error

- Given a cleanup of posts started, with active hours off
- When X answers the job's load of the profile timeline with 429, its rate limit reached, resetting in 15 minutes
- Then the X window shows X's error, Something went wrong. Try reloading.
- And the job waits for X's reset, and a little more: X rate limit — waiting for the window to reset, with more than 10 minutes to go
- And nothing is removed, and the log says X rate limit hit; resuming at that time
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-15 · error

- Given the X window open and a cleanup of posts ready to start
- When the connection drops, and the person starts it
- Then the job waits, checking every 10 seconds: Waiting for the internet connection
- And its log says The internet connection dropped. Waiting; nothing is counted as failed, and nothing is
- And once the connection is back, it says Back online — continuing shortly
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-16 · error

- Given a cleanup waiting for the person in the X window, since they are signed out of X
- When they close the X window instead
- Then the job pauses: The X window was closed. Resume to open it again.
- And Resume opens the X window again, and the job waits for them there once more
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-17 · security

- Given a person who has signed out of X since browsing their profile
- When they start a cleanup of their posts
- Then the job asks for them and does nothing: X needs you to continue, Log in to X as @xomoni_fixture in the X window (including 2FA)
- And the sidebar says Sign in to X, and the job's card Needs you, with no page of posts loaded from X
- And once they sign in again in the X window, the banner goes and the job goes on by itself, continuing shortly
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-18 · security

- Given the X window signed in to another X account, @fixture_friend
- When the person starts a cleanup of @xomoni_fixture's posts
- Then the job waits: The X window is signed in to another X account. Switch back to @xomoni_fixture.
- And no page of posts is loaded and nothing is done to @fixture_friend, whom the dashboard now follows
- And once the X window is back on @xomoni_fixture, the job goes on by itself
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-19 · security

- Given the person's posts before Jan 1, 2021 on Cleanup
- When they press Download backup (JSON), then start the cleanup
- Then the browser saves xomoni-backup-posts-<date>.json on this computer, with the 2 matching posts' ids and texts, and says Backup of 2 items downloaded
- And no page sends anything to any host but x.com, from the preview to the running job
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-20 · empty

- Given a fresh install, before Xomoni knows any X account
- When the person opens Cleanup from the menu
- Then the page stays on Welcome to Xomoni, with Open X window as the first step, and no cleanup form
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-21 · empty

- Given the person's copy, with nothing in it before Jan 1, 2019
- When they choose that date
- Then 0 match, nothing is previewed, and Download backup (JSON) is off
- And Start cleanup stays on while Sweep X search may find posts the copy hasn't seen
- And with the sweep off, Start cleanup goes off
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-22 · empty

- Given a person with an X account in Xomoni and no job yet
- When they open Activity
- Then it says No open jobs, and New cleanup there opens Cleanup
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-23 · cancel

- Given the confirmation of a cleanup open, with DELETE typed
- When the person presses Cancel, or Escape, or the Close button
- Then the dialog closes and no job is created: Activity says No open jobs
- And each time it opens again, the field is empty and its Start cleanup off
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-24 · cancel

- Given a confirmed cleanup, and the risks dialog for this X account's first job, which asks to type I UNDERSTAND to continue with @xomoni_fixture
- When the person presses Not now
- Then nothing starts: the job waits in Activity as Ready, and no X window opens
- And its Start asks for the risks again, after which it runs
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-25 · cancel

- Given a running cleanup
- When the person presses Pause, then Resume, then Cancel
- Then Pause holds it, Paused by you., and the running banner goes
- And Resume goes on without asking for the risks again
- And Cancel ends it, Cancelled by you.: it leaves the open jobs, and All lists it with Remove
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-26 · a11y

- Given a person using only the keyboard, on Cleanup
- When they Tab to Continue without it and press Space, Tab to Replies and press Space, and Tab to Start cleanup and press Enter
- Then the confirmation opens with the focus in its DELETE field
- And typing DELETE, then Tab and Enter on Start cleanup, then I UNDERSTAND and Enter on I understand, continue, starts the job
- And Activity shows it running
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-27 · a11y

- Given Cleanup with every date field labelled, Remove everything before and Start date (inclusive)
- When the person sets a range that starts after its end, chooses Likes and opens the exceptions, then confirms and accepts the risks
- Then the date problem is announced as an alert
- And axe finds no serious or critical violation on the form, the confirmation, the risks dialog, or the running job, hovered buttons included
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-28 · browser

- Given the system in dark mode
- When the person prepares a cleanup and opens its confirmation
- Then Cleanup, with its archive warning, and the confirmation have no serious or critical accessibility violation
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-29 · browser

- Given Xomoni installed in Microsoft Edge, as CI's e2e-edge job runs it, or in Chrome
- When the person previews and starts a cleanup
- Then the browser is the one it says it is, and the job runs as in Chrome
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-30 · persistence

- Given a running cleanup that has counted its 2 posts
- When the person reloads the dashboard
- Then the job is still there, paused: Xomoni was closed while this job was running. Resume to continue., with 2 remaining
- And Resume runs it again
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-31 · persistence

- Given a cleanup running in one dashboard tab
- When the person starts another cleanup from a second dashboard tab
- Then that tab says Another Xomoni tab is already running a job. Use that tab, or close it.
- And its job waits as Ready, while the first goes on running
- Test: apps/web/e2e/extension/cleanup-by-date.spec.ts

## S199-32 · happy

- Given a cleanup of posts, past its wait before the first delete
- When Xomoni checks X's page before acting, opens the post's … menu, chooses Delete and confirms X's Delete post? sheet
- Then the post is counted removed only once X's answer to DeleteTweet confirms it, and the job ends Completed with every matching post removed
- Manual: the first delete comes 320 to 480 seconds after the job's first page load on a new account (Careful's 80–120 s, at a quarter on its first day, ADR-0012), and each later one at least 80 seconds after the one before. The job's timers run in a dedicated worker that Playwright's clock doesn't reach, so a browser test would take that long per delete: too long for the merge gate. S199-07 proves the wait, the content script's tests prove the clicks on X's menu and sheet, on the person's own posts only (apps/extension/tests/canary.test.ts), and the engine's that a delete names the account and trusts the post's id (own-posts.test.ts), and the pilot checks it on the real X.
