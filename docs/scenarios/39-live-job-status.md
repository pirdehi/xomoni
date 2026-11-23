---
task: 39
title: Your jobs, live on xomoni.com: user scenarios
feature: live-job-status
---

# Your jobs, live on xomoni.com

Follow each job from any device (#39, #40, ADR-0018): while its dashboard is open, Xomoni signed in to xomoni.com reports each job's status a few seconds after it changes, and at least every 5 minutes, and the website's dashboard shows it and updates by itself. Only status leaves the browser (ADR-0004): Xomoni's own title, state, phase and counts, the times and the account's risk level, never a post's text, an id, a keep word or X's notices. Watch, which never ends, and the archive job, which handles X's archive, are never reported. The website shows, and never starts or approves work (ADR-0006). Signing in to xomoni.com from Xomoni has its own scenarios (one sign-in, #232). Written for #345, the features shipped before the scenarios gate. Two fixes the scenarios found are in the same pull request: neither cancelling a job that wasn't running, nor pausing one Xomoni was closed while it ran, marked the job changed, so neither was reported, and xomoni.com went on showing it paused, ready or running (S39-03, S39-11).

The scenarios run in two places:

- **What Xomoni sends** (S39-01 to S39-11): the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), the made-up `@xomoni_fixture` with years behind it (`xHistory: 'long'`). xomoni.com and its database are played at the extension (`apps/web/e2e/support/xomoni-site.ts`), which keeps every call Xomoni makes. A job that starts loads X's Home first, at the warm-up's pace (12 to 24 seconds, and up to 90 more one time in twenty), so the scenarios that wait for a page take up to two minutes.
- **What the website shows** (S39-12 to S39-32): xomoni.com on the local Supabase stack, with its real Auth, database and Realtime. A browser connects with a one-time code from *Browsers* and reports through `device_report`, the same calls Xomoni makes.

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-39   # what Xomoni sends; no Supabase
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-39             # what the website shows
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S39-01 · happy

- Given the person's Complete my copy, left Ready, and Xomoni not signed in to xomoni.com
- When Xomoni signs in from a xomoni.com page
- Then it reports at once, with its version, the job: its id, @xomoni_fixture, a read, Complete my copy, Ready
  (queued), no phase and no reason, every count 0, risk level 0, not started and not finished
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-02 · happy

- Given Xomoni signed in to xomoni.com
- When the person starts Complete my copy and accepts the risks
- Then a report follows within seconds: the job running, with when it started, and no end yet
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-03 · happy

- Given a running Complete my copy, reported
- When the person presses Pause, then Cancel
- Then a report says it is paused, and the next says it is cancelled, with when it ended: cancelling a paused job
  marks it changed, so it is reported like any other change
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-04 · happy

- Given a running Complete my copy, with active hours off
- When it loads its first page of posts, after X's Home
- Then its phase is reported in words, Page 1 of the 20-odd pages of the timelines and X search back to 2017
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-05 · security

- Given the person browsed their posts, replies and likes, and left a cleanup Ready that keeps "launch, thread"
- When Xomoni signs in to xomoni.com and reports the cleanup
- Then each job report has exactly the 15 fields of the website's jobs table
- And nothing sent holds a post's words, a post's id, the other account a post names, or the keep words
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-06 · security

- Given X's Home shows its notice that the account is temporarily limited, and Xomoni signed in to xomoni.com
- When the person starts Complete my copy, and it stops for safety on Home
- Then the job is reported stopped (blocked), on risk level 3, with an empty reason
- And X's words, "temporarily limited", are in nothing sent
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-07 · security

- Given Xomoni signed in to xomoni.com, with a read left Ready
- When the person starts watching a #hashtag, and cancels the read
- Then the read is reported cancelled, and no report ever holds the Watch job
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-08 · security

- Given Xomoni not signed in to xomoni.com
- When the person starts a read and pauses it
- Then nothing at all is sent to xomoni.com, after longer than a report takes
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-09 · error

- Given Xomoni signed in to xomoni.com, which then can't be reached
- When the person makes a read and leaves it Ready
- Then Xomoni tries to report and fails, quietly: the job is Ready as before, and nothing of it reached xomoni.com
- And once xomoni.com answers again, the next change, Cancel, sends the job's state
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-10 · error

- Given Xomoni signed in, and the person disconnected this browser on xomoni.com, so its token is unknown there
- When a job changes and Xomoni reports
- Then Xomoni says xomoni.com no longer knows this browser, to connect it again in Settings to keep sending job
  status, and Settings offers Sign in to xomoni.com
- And later changes send nothing more
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-11 · persistence

- Given a running Complete my copy, reported running
- When the person reloads the dashboard
- Then the job is paused, as a reload always leaves it, and reported paused, not left running on xomoni.com
- And reporting goes on: Cancel is reported too
- Test: apps/web/e2e/extension/live-job-status.spec.ts

## S39-12 · happy

- Given a browser connected to the person's account that reported a cleanup at work: 10 posts matched, 3 removed
- When the person opens Activity on xomoni.com
- Then the job reads @ada_x · Chrome on macOS · updated just now, Running, a Progress bar at 30%, Removed 3 and
  Remaining 7, with no Skipped or Failed, and Searching X
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-13 · happy

- Given Activity open and Live, showing the cleanup with 3 removed
- When the browser reports it completed: 9 removed, 1 skipped
- Then the same page shows Completed, Removed 9, Skipped 1, no Remaining, and the bar at 100%, with no reload
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-14 · happy

- Given a browser that reported a read on its fourth page, 120 posts looked at
- When the person opens Activity
- Then the read shows Scanned 120 and Page 4 of 23, with no bar and no Removed
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-15 · happy

- Given a browser that reported a read, and a cleanup waiting for the person to log in to X
- When the person opens Overview
- Then Needs you lists only the cleanup, with @ada_x · Chrome on macOS, Xomoni's words for what it waits for, and
  that this page can't continue a job for them
- And once the browser reports the cleanup running again, Needs you goes
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-16 · happy

- Given two browsers connected, Chrome on macOS and Edge on Windows, each with a job
- When the person opens Activity
- Then each job names the browser it runs in
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-17 · security

- Given one account's browser reported a cleanup and a read for @ada_x
- When another person signs in to their own account and opens Activity
- Then they see No jobs in this period, and neither job nor @ada_x
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-18 · security

- Given a person's jobs on xomoni.com
- When someone signed out opens /dashboard/activity
- Then they are sent to sign in, and no job shows
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-19 · security

- Given a report of a job stopped for safety that also carries a reason quoting X's notice
- When the person opens Activity
- Then the job reads Stopped for safety, and the reason is shown nowhere: the database never stores it
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-20 · invalid

- Given a signed-in person with a browser connected
- When a report comes with a token xomoni.com never made
- Then it is refused as an unknown browser, and Activity has no job
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-21 · security

- Given a paused cleanup on Activity, in a browser without Xomoni
- When the person looks for a way to start, approve, delete or retry, and presses Resume
- Then there is none: Resume opens a dialog saying Xomoni isn't installed here, and the job stays Paused
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-22 · empty

- Given a new account with no browser connected
- When the person opens the dashboard, then Activity
- Then Overview says Connect Xomoni to see your account here, with Connect a browser
- And Activity says No jobs in this period, and that a cleanup or a scan started in Xomoni shows up as it runs
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-23 · empty

- Given a browser connected that has reported, with no job yet
- When the person opens Browsers, then Activity
- Then the browser is Online, Activity has no job, and Overview no longer asks to connect one
- And the browser's first job shows up as soon as it is reported
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-24 · invalid

- Given a cleanup shown with 3 removed
- When a report also holds a Watch job, which the database refuses, or more than 50 jobs
- Then each report is refused whole: after a reload, the cleanup still shows 3 removed, and nothing else shows
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-25 · error

- Given the person opens Activity while the live feed can't connect
- When the browser reports more meanwhile, and the feed comes back
- Then the page says Connecting…, showing the jobs it loaded, then Live
- And once live it reads everything again: the cleanup's new count, and the new read
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-26 · cancel

- Given a browser with a reported cleanup
- When the person presses Disconnect on Browsers, and Disconnect in the dialog that says its job history goes too and
  nothing on X changes
- Then Activity has no job, and the browser's token is refused from then on: a later report shows nothing
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-27 · cancel

- Given the disconnect dialog for a browser with a reported cleanup
- When the person presses Cancel
- Then the browser stays connected, its job stays on Activity, and its reports are still taken
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-28 · a11y

- Given three reported jobs: a cleanup, a read and one that needs the person
- When the person reaches Activity with the keyboard alone, from the dashboard's menu
- Then the three jobs show, each cleanup's bar is named Progress, and there is no serious or critical axe violation
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-29 · browser

- Given a phone, 390 pixels wide, and two reported jobs
- When the person opens Activity
- Then the job cards fit the screen, with nothing to scroll sideways (and CI's e2e-edge runs every scenario in
  Microsoft Edge)
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-30 · persistence

- Given a reported cleanup on Activity
- When the person reloads, and opens Activity in a second tab, and the browser reports again
- Then the reload shows the same job, and both tabs show the new count by themselves
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-31 · invalid

- Given a cleanup reported with more settled than it matched: 10 matched, 9 removed, 2 skipped and 1 failed
- When the person opens Activity
- Then the bar stops at 100%, with Removed 9, Skipped 2 and Failed 1, and nothing reads as remaining
- Test: apps/web/e2e/live-job-status.spec.ts

## S39-32 · a11y

- Given eight reported jobs, one in each state Xomoni has
- When the person opens Activity
- Then each state is said in words, as in Xomoni: Ready, Running, Needs you, Paused, Stopped for safety, Completed,
  Cancelled and Failed, never by color alone
- And Live is a status, which a screen reader reads out when it changes
- Test: apps/web/e2e/live-job-status.spec.ts
