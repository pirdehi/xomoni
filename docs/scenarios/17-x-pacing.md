---
task: 17
title: Within one fifth of X's limits
feature: x-pacing
---

# Within one fifth of X's limits

Xomoni's core safety promise (ADR-0012, ADR-0013; #17, #18, #19, #26, #28, #30, #31, #33): it never uses more than one fifth of any limit X announces, from the limits X publishes and the live `x-rate-limit-*` headers of X's own web app; a new account starts lower still, at 25, 50 and 75% of that fifth on its first active days; every request that reaches X counts, failed ones included; a risk ladder slows it further after X's warnings and stops it at the serious ones; and settings can only make it slower. The numbers have one home, `apps/extension/src/shared/x-limits.ts`. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, which X shows as Premium (but in S17-07), with years behind it (`xHistory: 'long'`), and which Xomoni has never seen act, so every test starts on its first warm-up day. X's answers carry rate-limit headers the tests choose (`answerWithRate` in `apps/web/e2e/support/x-fixtures.ts`): how much of a window is used, when it resets, X's clock, a 429 with or without a reset, or a 503.

Writing them found two bugs, fixed with them (#345): a profile page asks X for the profile before its timeline, and Xomoni didn't keep to one fifth of that lookup's live limit (S17-05, S17-18); and Cleanup's Review showed Careful's pace to a new account running at a quarter of it (S17-04, and S199-01 with it). The Library's scenarios later found a read passing over a page X refused with a 429 (#392): S17-35 and S17-36 prove that a read keeps to X's warnings as a cleanup does.

A job's timers run in a dedicated worker that Playwright's clock doesn't reach, so the tests prove what a job decides to wait for, and how long it says, rather than waiting it out. The arithmetic behind each number (each fifth, each warm-up step, each rung of the ladder) is proven by the unit tests a scenario names. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-17
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S17-01 · happy

- Given a person with an X account in Xomoni, on Settings
- When they look at Pacing, on Careful (⅕ of X), and open X’s published limits and Xomoni’s share
- Then Careful reads up to 960 a day · 40 an hour for deletes and undone reposts, up to 200 a day · 40 an hour for
  unlikes and ghost-like cleanup, and up to 2,400 a day · 240 an hour for page loads, which X publishes no limit for
- And each limit X publishes is listed beside one fifth of it, with the page where X publishes it and the day it was
  checked: Delete a post, 50 per 15 min, 10 per 15 min, docs.x.com (2026-10-31); Unlike a post, 1000 per day, 200 per
  day; Search posts, 300 per 15 min, 60; and X's posting limits, none: Xomoni never posts
- And that no preset, custom value or warm-up step goes above one fifth of any of them is proven by
  apps/extension/tests/x-limits.test.ts (the ceiling holds everywhere)
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-02 · happy

- Given a new X account in Xomoni, which X shows as Premium, with no action yet
- When the person opens Settings › Today’s use of X’s limits
- Then it says Preset: Careful · at most ⅕ of X's limits · warm-up day 1 of 4 · running at 25% of that
- And the caps in force are a quarter of Careful's: deletes and undone reposts 0/10 hr · 0/240 day, unlikes and
  ghost-like cleanup 0/10 hr · 0/50 day, page loads 0/60 hr · 0/600 day
- And the later steps, 50% on the second active day, 75% on the third and the full fifth from the fourth, with the
  warm-up starting again after 14 days without activity, are proven by apps/extension/tests/x-limits.test.ts (warm-up:
  even slower at the start) and apps/extension/tests/limiter.test.ts, since a browser test can't age the activity log
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-03 · happy

- Given X's answers to the profile timeline say 5 of its 50 requests are used, resetting in 10 minutes
- When the person browses their profile's posts, replies and likes, and opens Today’s use of X’s limits
- Then under Reported by X (15-min windows) · Xomoni stops at one fifth, Profile timeline reads 5 used · stops at 10 of
  50, resets in about 10 minutes, and Profile, Replies timeline and Likes timeline each 1 used · stops at 30 of 150
- And once X's next answer says 10 of 50 are used, the Profile timeline row turns red: Xomoni waits on it now
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-04 · happy

- Given a new account's 2 posts before Jan 1, 2021 on Cleanup
- When the person looks at Review, then starts the cleanup
- Then Review shows the pace a run will use: Pacing 320–480s · max 240/day, a quarter of Careful's 80–120 s and 960 a
  day, and says Slower for now: warm-up day 1 of 4, at 25% of the full pace.
- And the estimated time is ≈ 13m 26s, and the job's card says the same, ≈ 13m 26s at the current pace
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-05 · happy

- Given X's answers to the profile lookup every profile page sends first (UserByScreenName) say 30 of its 150 requests
  are used, a fifth, resetting in 12 minutes
- When the person starts a cleanup of posts, with active hours off
- Then the job waits for X's reset: Profile timeline: one fifth of X’s live limit used — waiting for X’s window to
  reset, with more than 11 minutes to go
- And the X window stays on Home: nothing is asked of X while it waits
- And the panel's Profile row reads 30 used · stops at 30 of 150, in red
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-06 · happy

- Given active hours on, set in Settings to start two hours from now and end an hour later
- When the person starts a cleanup of posts
- Then the X window opens on Home, and the job waits for the active hours: Outside active hours (<start>:00–<end>:00),
  with more than an hour to go
- And nothing is asked of X meanwhile
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-07 · happy

- Given an X account X doesn't show as Premium
- When the person opens Today’s use of X’s limits
- Then it adds page loads at half: the account is not known to be Premium, with page loads at 0/30 hr · 0/300 day,
  half of a Premium account's
- And deletes are at 0/10 hr · 0/240 day, as for Premium: nothing is faster for a Premium account
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-08 · happy

- Given Settings › Pacing switched to Custom
- When the person sets deletes to 100 Per day and 200 s Min delay, both slower than Careful
- Then both are kept, and Max delay rises to 200 s with them
- And Today’s use of X’s limits says Preset: Custom, with deletes at 0/10 hr · 0/25 day on the first warm-up day
- And Cleanup's Review shows Pacing 800–800s · max 25/day
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-09 · invalid

- Given Settings › Pacing switched to Custom
- When the person types values faster than Careful: deletes 100 Per hour, 5000 Per day, 10 s Min delay, a Batch of 100
  and 0 s Break min; unlikes 1000 Per day; page loads 1000 Per hour
- Then each field goes back to the fastest Xomoni allows: 40, 960, 80, 25, 300, 200 and 240
- And Per hour can't be raised past 40 in the field itself, and the page says caps can't be set above one fifth of X's
  limits
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-10 · invalid

- Given Settings, where a job pauses after 2 failed actions in a row
- When the person opens Advanced and types 10 failures in a row, then 0
- Then the field keeps 3, the most it allows, and the summary says A job pauses after 3 failed actions in a row.
- And 0 becomes 1: A job pauses after 1 failed action in a row.
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-11 · invalid

- Given X's answers to the profile timeline say a fifth of the window is used, resetting 30 days from now, which no X
  window does: a wrong or forged header (#145)
- When the person starts a cleanup of posts, with active hours off
- Then the job waits a day at most for that reset, not 30 days
- And the panel says the window resets in about a day
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-12 · invalid

- Given this computer's clock 20 minutes ahead of X's, as the date on X's answers to the profile timeline shows, and
  20 minutes behind X's on its answers to the replies, both windows resetting 10 minutes from now on X's clock
- When the person browses their profile and starts a cleanup of posts
- Then the profile timeline's reset is moved 20 minutes later, so Xomoni never acts before X's real reset: it resets
  in about 30 minutes, and the job waits more than 29 (PLAYBOOK F7, #31)
- And the replies' reset is left alone, in about 10 minutes: waiting a little longer is safe
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-13 · error

- Given a cleanup of posts started, with active hours off
- When X answers the job's load of the profile timeline with 429, its rate limit reached
- Then the job waits for X's reset: X rate limit — waiting for the window to reset, with more than 10 minutes to go
- And Today’s use of X’s limits shows Risk level 1: Caution, X rate-limited Xomoni in the last hour., and the Profile
  timeline row limited, in red, resetting in about 15 minutes
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-14 · error

- Given a cleanup of posts started, with active hours off
- When X answers the job's load of the profile timeline with a 429 that has no rate-limit headers, so no reset time
- Then the job waits 15 to 20 minutes, as PLAYBOOK A2 says: X rate limit — waiting for the window to reset
- And nothing is removed
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-15 · error

- Given a cleanup of posts started, with active hours off
- When X answers the job's load of the profile timeline with 503, over capacity
- Then the job waits about a minute: X is having trouble — trying again in about 1 min
- And nothing is counted as failed, as its log says: X answered HTTP 503 for this page. Waiting; nothing is counted as
  failed
- And the page load still counts against Xomoni's caps, since X counts every request it answered: page loads 2/60 hr ·
  2/600 day, Home, which opening the X window loaded (#377), and the profile
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-16 · error

- Given X's Home shows the notice "Your account is temporarily limited"
- When the person starts a cleanup of posts, and the job stops at once
- Then Today’s use of X’s limits shows Risk level 3: Defensive, in red: X refused an action, so the account may be
  limited. Resume opens in 11h 59m. Slower pace for 6d 23h more.
- And the pace is a quarter of the first warm-up day's: running at 6% of that, deletes 0/2 hr · 0/60 day, unlikes
  0/2 hr · 0/12 day, page loads 1/15 hr · 1/150 day: X's Home, which opening the X window loaded, counts (#377)
- And the rest of the ladder, 226 and locks included, is proven by apps/extension/tests/risk.test.ts
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-17 · error

- Given X's Home shows the notice "Your account is suspended"
- When the person starts a cleanup of posts
- Then the job stops before it loads anything: X shows a restriction on this account: “Your account is suspended”.
- And its card offers no Resume, only Stopped for safety and Resume anyway…
- And the panel shows Risk level 4: Full stop: X suspended this account. Xomoni won’t resume on its own.
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-18 · error

- Given a cleanup of posts started, with active hours off
- When X answers the profile lookup the job's profile page asks for first (UserByScreenName) with 429, so the page shows
  X's error and asks for no timeline
- Then the job takes it as X's rate limit and waits for X's reset: X rate limit — waiting for the window to reset,
  with more than 10 minutes to go
- And not as a page that failed for another reason, tried again in a minute or two and then left for each post's own
  page, which would ask far more of X (PLAYBOOK A5)
- And the panel shows Risk level 1: Caution, and the Profile row limited
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-19 · security

- Given a post by the made-up @fixture_friend in the person's Home timeline that quotes X's notice: "Your account is
  temporarily limited"
- When the person starts a cleanup of posts, and the X window opens on that Home
- Then the job goes on to the profile: posts, names and bios are never read for X's notices, or anyone could stop a
  job by replying with X's wording (#146)
- And the panel shows no risk level, and the pace stays at the warm-up's 25%
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-20 · security

- Given a job stopped by X's notice of a limited account: Risk level 3, Resume locked for 12 hours
- When the person deletes Xomoni's local data in Settings
- Then once the dashboard takes up the account in the X window again, the panel still shows Risk level 3: Defensive,
  Resume opens in 11h 59m, at 6% of the pace: wiping can't bring back the full pace (#151)
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-21 · security

- Given a job stopped by X's notice of a limited account, with Resume locked for 12 hours
- When the person makes a new cleanup of the same account, posts before Jan 1, 2020, and confirms it with DELETE
- Then the new job is held too, before it touches X: Risk level 3 (Defensive): X refused an action, so the account
  may be limited. Resume is locked until …
- And its Resume waits as the first's does
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-22 · empty

- Given a new X account in Xomoni, known only from the X window on Home, which asks X's API for nothing
- When the person opens Today’s use of X’s limits
- Then it says Nothing observed yet. X reports its limits as you use it; they appear here.
- And no risk level, 0 posts seen in the last 24 hours, and every cap unused: deletes 0/10 hr · 0/240 day, page loads
  0/30 hr · 0/300 day, at half since X hasn't shown whether the account is Premium
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-23 · empty

- Given a fresh install, before Xomoni knows any X account
- When the person opens Settings from the menu
- Then the page stays on Welcome to Xomoni, with no pace and no limits, only the promise Respects X limits: Human
  pacing, caps and automatic safety stops.
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-24 · cancel

- Given a job stopped by X's notice of a limited account, with Resume locked for 12 hours
- When the person presses Resume anyway…, types resume, RESUM or RESUME NOW, then presses Keep waiting
- Then the dialog, Risk level 3: Defensive, says why Xomoni holds back and that resuming runs at a quarter for 48
  hours, and its Resume anyway stays off until RESUME is typed, spaces around it ignored
- And Keep waiting closes it, and the job is still held, Resume in 11h …; opened again, the field is empty, and
  Escape closes it too
- And the panel still says Resume opens in 11h …: nothing was overridden
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-25 · cancel

- Given a job stopped by X's notice of a limited account, and X's Home without the notice once the person reloads it
- When the person presses Resume anyway…, types RESUME and presses Resume anyway
- Then the job runs again, at a quarter of the pace: its first page load waits more than 40 seconds, where 3 to 6 are
  Careful's
- And the panel shows Risk level 3: Defensive, Slower pace for 6d 23h more, and no Resume lock, running at 6%
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-26 · cancel

- Given a cleanup waiting for X's reset, a fifth of the profile timeline's window used, with more than 11 minutes to go
- When the person pauses the job, then resumes it
- Then it waits again for the same reset, with more than 10 minutes to go
- And the profile timeline isn't loaded meanwhile: pausing never skips a wait
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-27 · cancel

- Given Settings › Pacing on Custom, with deletes set to 20 Per hour
- When the person presses Careful (⅕ of X), then Custom again
- Then Careful's pace is back, up to 960 a day · 40 an hour for deletes, with no custom fields
- And Custom starts again from Careful's values: 40 Per hour, not 20
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-28 · a11y

- Given a person using only the keyboard, on Settings
- When they Tab to Custom and press Space, Tab to deletes' Min delay and press the arrow keys, then to their Per hour
- Then each of the 35 pacing fields is named by its action and its column, such as Delete posts & replies, Per hour
- And Min delay goes up to 80.5 s but never below Careful's 80, and Per hour down to 39 and 38 but never above 40
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-29 · a11y

- Given a job stopped by X's notice of a limited account, and a fifth of the profile timeline's window used
- When the person opens Settings with Custom pacing, X’s published limits and Today’s use of X’s limits
- Then the risk level is announced as a status, and axe finds no serious or critical violation, the red row included
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-30 · browser

- Given the system in dark mode, a job stopped by X's notice, and a fifth of a window used
- When the person opens Settings with X’s published limits and Today’s use of X’s limits
- Then the pace, the tables, the risk note and the red row have no serious or critical accessibility violation
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-31 · persistence

- Given Custom pacing with deletes at 100 Per day, and a job stopped by X's notice of a limited account
- When the person reloads the dashboard
- Then the job is still held, Resume in 11h …, and Settings still shows Custom with 100 Per day
- And the panel still shows Risk level 3: Defensive, with deletes at 0/2 hr · 0/6 day: the ladder and the custom pace,
  both slowed, from the events and settings this browser keeps
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-32 · happy

- Given a job that has worked for its session's 25 to 50 minutes
- When the next action is due
- Then the job rests 10 to 30 minutes first, Resting between work sessions, and a quiet gap of 10 minutes or more, or
  any wait that long, already counts as that rest (PLAYBOOK B4, #30)
- Manual: a work session lasts 25 to 50 minutes, and a new account acts every 320 to 480 seconds at most, so reaching
  a rest takes the better part of an hour of real time; the job's timers run in a dedicated worker that Playwright's
  clock doesn't reach. apps/extension/tests/sessions.test.ts proves the sessions, the rests and that they carry over
  between runs; the pilot sees them on a real account.

## S17-33 · error

- Given a cleanup at work on X, on an account Xomoni has seen act
- When X answers a delete with error 226, "this request looks like it might be automated", or rate-limits the job a
  second time within the hour, at least 10 minutes after the first
- Then the job stops on Risk level 2 (Retreat): Resume locked for 6 hours, half the pace for 7 days, and after a 226
  the warm-up a step back; a second 226 within 7 days locks it for 24 hours at a quarter, a third is a full stop
  (PLAYBOOK B1, §7, #17)
- Manual: X sends 226 only in answer to an action, and a new account's first comes 320 to 480 seconds after the job's
  first page load; and the ladder counts the same signal once within 10 minutes, so a second rate limit counts only
  10 minutes after the first: either is too long for the merge gate. S17-13 and S17-18 prove the first rung in the
  browser, and S17-16, S17-17, S17-20, S17-21, S17-24 and S17-25 the stops and the locks. apps/extension/tests/risk.test.ts proves
  every rung, the 10-minute rule and the warm-up drop; the pilot sees them on a real account.

## S17-34 · error

- Given the job's own page loads have shown 100 posts or more in the last 24 hours
- When X refuses a page with a 429 that names no reset and doesn't say its window is used up, as X's daily view cap
  does
- Then Xomoni takes it as that cap: it stops at 80% of the posts seen a day for the account, says so in the log, and
  the panel shows stops at … a day: the view cap learned when X refused pages after … (PLAYBOOK A4, #28)
- Manual: the cap is learned only from posts the job's own page loads showed, at least 100, and the fixtures' account
  has 8; after its first page, a job loads its next only once it has scrolled the profile to its end and moved on to
  X's search, at a new account's pace minutes later. S17-14 proves the wait after such a 429 in the browser;
  apps/extension/tests/view-cap.test.ts proves the learning, the 80% and that a cap only ever goes down.

## S17-35 · error

- Given a read of the person's posts, started from the Library's Read one part, with active hours off
- When X answers the read's load of the profile timeline with 429, its rate limit reached
- Then the read waits for X's reset: X rate limit — waiting for the window to reset, with more than 10 minutes to go,
  and the log says X rate limit hit; resuming at …, and nothing says the read finished
- And Today’s use of X’s limits shows Risk level 1: Caution, X rate-limited Xomoni in the last hour., and the Profile
  timeline row in red, as after a cleanup's 429 (S17-13): a read used to pass the refused page over and end Completed,
  Healthy (#392)
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-36 · security

- Given X's Home shows its notice that the account is temporarily limited, with active hours off
- When the person starts a read of their posts from the Library
- Then the read loads Home first, at its pace, and stops there for safety, as a cleanup does (S199-34): X shows a
  restriction on this account, 0 posts looked at, Resume locked for 12 hours
- And no page of posts is loaded
- Test: apps/web/e2e/extension/x-pacing.spec.ts

## S17-37 · a11y

- Given a cleanup that X's notice of a limited account stopped at its first look at Home, in light mode and in dark mode
- When the person reads the job's card, opens Resume anyway… and then the limits panel in Settings
- Then axe finds no serious or critical violation on the held card with its locked Resume, in the dialog that asks for
  RESUME, or on the panel that shows Risk level 3: Defensive (#389)
- Test: apps/web/e2e/extension/a11y-states.spec.ts
