---
task: 20
title: Recognize X's new login and verification routes
feature: login-handoff
---

# Login and 2FA hand-off

When X needs the person, the job waits for them, never for a retry (#20, #200; PLAYBOOK C2, D1 to D4). X may want its login, 2FA included, a code it emails, an account unlock, or the X window may be signed in to another account. Xomoni says what to do in a banner on every page, on the job's card, on Home and in a desktop notification. It goes on by itself once X has been ready for 5 seconds in a row, and after an X check it rests 60 to 90 minutes first. With no job running, a banner says X needs them all the same. Xomoni never types or clicks anything on those pages, and never asks for a password. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`), and X's login and check pages, `apps/web/e2e/fixtures/x/x-check.html`: its login (`/i/flow/login`, and the newer `/i/jf/onboarding/web`), the code it emails (`/account/login_challenge`) and its account unlock (`/account/access`). The page counts every key and click on its fields and button, so a test can prove nothing touched them. A test plays X by sending the X window to those pages, and plays the person's login by setting X's cookie and going back to Home, as X does once they are done: nothing is typed or solved (ADR-0003). Chrome's list of notifications is read from Xomoni's dashboard.

Each test is a fresh install, with active hours off, so a job may run at any time of day. The engine's side, which needs and in what order, the five seconds, the rest after a check, the hour it waits at most, is proven by unit tests: `apps/extension/tests/runner.test.ts`, `needs-you.test.ts` (new with this file), `restrictions.test.ts`, `hidden-worker.test.ts`, `parsers.test.ts` and `obstruction.test.ts`. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep "@task-20(\s|$)"
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S20-01 · happy

- Given the X window on X's login page, signed out of X, and a cleanup of the person's posts before Jan 1, 2021
- When they start it
- Then a banner says X needs you to continue “Delete posts older than Jan 1, 2021”: Log in to X as @xomoni_fixture
  in the X window (including 2FA). Xomoni continues by itself once you’re done.
- And the job's card says Needs you, the tab's title (!) Needs you — Xomoni, and the sidebar Sign in to X
- And once they log in, and X takes the X window to Home, the banner goes, the log says X is ready again —
  continuing, and the job goes on to load their profile
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-02 · happy

- Given X sends the X window to its newer login flow, /i/jf/onboarding/web, while its cookie still names the account
- When the person starts a cleanup
- Then the job waits for them to log in, as on X's older login page (PLAYBOOK D2)
- And it goes on once they have
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-03 · happy

- Given X asks for a code it emailed, on its page /account/login_challenge in the X window
- When the person starts a cleanup, then types the code on X
- Then the job waits: X wants to confirm it’s you (captcha, code or account unlock). Complete it in the X window., and
  the sidebar says Confirm it’s you on X
- And once X is done, the job rests 60 to 90 minutes before anything else: Resting after X’s check (60–90 min)
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-04 · happy

- Given a running cleanup, and X's session ends: X sends the person's profile to its login page
- When the job loads the profile and lands on X's login
- Then it waits for the person there
- And once they log in, it loads the profile again and goes on from it
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-05 · happy

- Given a cleanup waiting for the person on X's login page, with notifications on, as by default
- When the person looks at their desktop
- Then Xomoni shows a desktop notification, Xomoni needs you: Log in to X, which stays until they act on it
- And it goes as soon as X is ready again
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-06 · happy

- Given a cleanup waiting for the person on X's login page
- When they open Home, then press the banner's Open X window
- Then Home says X needs you: Finish what X asks in the X window. The job carries on by itself; Xomoni never sees what
  you type.
- And Open X window brings the same X window forward, still on X's login: no second window opens
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-07 · invalid

- Given a cleanup waiting for the person on X's login page
- When they are signed in for a moment, and X signs them out again before 5 seconds have passed
- Then the job keeps waiting, Needs you: X must be ready for 5 seconds in a row
- And its log never says X is ready again
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-08 · invalid

- Given a cleanup waiting for the person on X's login page
- When they log in as another account, the made-up @fixture_friend
- Then the job keeps waiting, Needs you, still asking them to log in to X as @xomoni_fixture: another account is
  never X ready for this job
- And no page of posts is loaded for the other account
- And once they log in as @xomoni_fixture, the job goes on
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-09 · invalid

- Given one of the person's posts reads "Your account has been locked. Log in to X to confirm it’s you."
- When a cleanup loads their profile, with that post on it
- Then the job doesn't wait for anyone: only X's own pages and its cookie make it wait, never a post's words
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-10 · error

- Given a cleanup waiting for the person on X's login page
- When three times they log in, and three times X signs them out again before the job could do anything
- Then the fourth time X asks, the job stops: Stopped for safety, X keeps asking for the same thing: Log in to X as
  @xomoni_fixture in the X window (including 2FA). Check the X window, then resume.
- And nothing is removed
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-11 · error

- Given X has locked the person's account: the X window shows X's unlock page, /account/access
- When they start a cleanup
- Then the job waits for them to unlock it, and the sidebar says X account locked
- And once unlocked, it rests 60 to 90 minutes before it acts again, with nothing removed (PLAYBOOK C2)
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-12 · error

- Given a cleanup waiting for the person, who doesn't come back
- When an hour has passed
- Then the job pauses: Waited an hour for you. Log in to X as @xomoni_fixture in the X window (including 2FA). Then
  resume the job.
- Manual: the wait is an hour on a timer in a dedicated worker, which Playwright's clock doesn't reach.
  apps/extension/tests/needs-you.test.ts proves the hour and the pause (waits an hour for X’s login, not a day, then
  pauses the job)

## S20-13 · error

- Given a cleanup about to delete a post
- When X answers the delete that the person is signed out (X's codes 32, 89, 215 or 353), or that the account is
  locked (326)
- Then the post goes back to the queue, not failed, the X window loads X's Home to show X's prompt, and the job waits
  for the person as above; a lock also counts on the risk ladder
- Manual: X answers only a delete Xomoni clicked, and a new account's first delete comes 320 to 480 seconds into a
  job. apps/extension/tests/needs-you.test.ts proves what the job does with those answers (puts the post back when X
  answers that the person is logged out; counts a lock on the risk ladder; loads X’s Home first), and
  restrictions.test.ts how X's codes are read

## S20-14 · security

- Given a cleanup waiting for the person on X's login page, with its username and password fields
- When ten seconds pass, as the job looks at the page every second and a half
- Then nothing was typed in either field and X's Log in button was never pressed: they stay empty, for the person
- And the job asks X for no page of posts while it waits
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-15 · security

- Given a cleanup waiting on X's page that asks for a code it emailed
- When the job looks at the page again and again
- Then the code's field stays empty, and X's Next button is never pressed
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-16 · security

- Given a person with an X account in Xomoni
- When they go through every page of Xomoni's dashboard: Home, Library, Cleanup, Watch, Activity and Settings
- Then none has a password field: Xomoni never asks for, or keeps, a password
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-17 · empty

- Given no job running, and the X window signed out of X
- When the person opens any page of the dashboard
- Then a banner says Log in to X: Log in to X as @xomoni_fixture in the X window (including 2FA). Jobs wait until
  then; Xomoni never sees what you type., with Open X window
- And no job is created, and the banner goes once they sign in
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-18 · empty

- Given a fresh install, and X signed out
- When the person opens the X window
- Then the sidebar says Sign in to X, and the dashboard still welcomes them, knowing no account
- And once they sign in on X, the sidebar says X window ready and names @xomoni_fixture
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-19 · cancel

- Given a cleanup waiting for the person on X's login page, with its desktop notification
- When they press the banner's Pause
- Then the job is Paused, Paused by you., the banner, the tab's (!) and the notification go
- And Resume makes it wait for them again
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-20 · cancel

- Given a cleanup waiting for the person on X's login page
- When they cancel it
- Then it ends Cancelled, with nothing removed, and the banner goes
- And X's login stays in the X window, untouched, for them to use or close
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-21 · a11y

- Given a cleanup waiting for the person, and someone using only the keyboard
- When the banner appears, and they press Tab to its buttons and Enter on Pause
- Then the banner is an alert, read out as it appears, and Open X window and Pause are reached with Tab
- And Enter on Pause pauses the job
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-22 · a11y

- Given a cleanup waiting for the person to unlock their account on X
- When axe checks the dashboard with the banner and the card, Home, and the banner left once the job is paused
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-23 · browser

- Given the system in dark mode
- When a cleanup waits for the person to log in, and then is paused while X still shows its login
- Then the job's banner, its card, the sidebar and the banner with no job running have no serious or critical
  violation (and Edge, as CI's e2e-edge runs every scenario)
- Test: apps/web/e2e/extension/login-handoff.spec.ts

## S20-24 · persistence

- Given a cleanup waiting for the person on X's login page
- When they reload the dashboard
- Then the job is paused: Xomoni was closed while this job was running. Resume to continue.
- And Resume makes it wait for them again, and it goes on once they log in
- Test: apps/web/e2e/extension/login-handoff.spec.ts
