---
task: 226
title: Sign out of Xomoni
feature: sign-out
---

# Sign out of Xomoni

*Sign out of Xomoni*, at the foot of the account panel (#226), opens one dialog that names the account and says what happens: a running job pauses, xomoni.com signs out in this browser too when it is connected (#232), the X window Xomoni opened closes, and nothing more is recorded from X until the person signs in again. Two choices: remove the account's data from this browser, with *Download a copy first*, and also sign out of X on X's own page. The signed-out page then offers *Sign in to xomoni.com*, or, without an account, the X window and *Continue as @handle*. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, whose two posts are from 2020 and 2021, and the other made-up account, `@fixture_friend`. xomoni.com, which a sign-out signs out too, is played at the extension (`apps/web/e2e/support/xomoni-site.ts`): a xomoni.com page signs Xomoni in through Chrome's own channel, and the functions the extension calls answer from a small state. A running job is a cleanup of the two posts waiting for active hours set two hours ahead. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-226
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S226-01 · happy

- Given a person working on @xomoni_fixture, with the X window open and no job running
- When they open the account panel and press Sign out of Xomoni
- Then Sign out of Xomoni? names Fixture Person, @xomoni_fixture on X, and says The X window Xomoni opened closes, and
  Xomoni stops recording what X shows until you sign in again.
- And neither choice is ticked
- And once they press Sign out, a toast says Signed out of Xomoni. @xomoni_fixture is no longer used in this browser.,
  the X window closes, and the page says You’re signed out: @xomoni_fixture’s data is still here, ready when you sign in
  again.
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-02 · happy

- Given the person signed out, with the data kept
- When they open the X window from the signed-out page and press Continue as @xomoni_fixture
- Then a toast says Signed in as @xomoni_fixture, and Home counts the 2 posts as before
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-03 · happy

- Given a cleanup job running
- When the person opens Sign out of Xomoni?
- Then it says first “Delete posts older than Jan 1, 2022” pauses. It continues where it stopped when you sign in again.
- And once they sign out and continue as @xomoni_fixture, the job is paused with its 2 posts remaining, and Resume is
  there
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-04 · happy

- Given the account's 2 posts in this browser
- When the person ticks Remove @xomoni_fixture’s data from this browser, and presses Sign out and remove data
- Then the page says @xomoni_fixture’s data was removed from this browser.
- And once they continue as @xomoni_fixture, Home counts 0 posts
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-05 · happy

- Given Sign out of Xomoni? open
- When the person presses Download a copy first
- Then the browser saves xomoni-xomoni_fixture-<today>.json: an Export everything file (xomoni-export) with this account
  only and its 2 posts, which Xomoni can import again
- And the dialog stays open, for them to sign out once the copy is saved
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-06 · happy

- Given Sign out of Xomoni? open
- When the person ticks Also sign out of X and signs out
- Then a tab opens on https://x.com/logout, where X asks them to confirm
- And X's session is X's to end: its cookie is still there until they confirm on X's page
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-07 · happy

- Given Xomoni signed in to xomoni.com, as f•••@example.com, from a xomoni.com page
- When the person opens Sign out of Xomoni? and signs out
- Then the dialog says xomoni.com signs out in this browser too (f•••@example.com), and this browser stops sending job
  status.
- And signing out ends this browser's access on xomoni.com (unpair_device), with no warning that it couldn't
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-08 · invalid

- Given the person signed out of Xomoni, and the X window now signed in to another X account, @fixture_friend
- When they press Continue as @fixture_friend
- Then Xomoni works on @fixture_friend: Home says @fixture_friend · everything Xomoni knows, with 0 posts, apart from
  @xomoni_fixture's data
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-09 · invalid

- Given the person signed out of Xomoni, and then of X too
- When they open the X window from the signed-out page
- Then there is no one to continue as: the page says The account the X window is signed in to appears here., with no
  Continue as button
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-10 · error

- Given Xomoni signed in to xomoni.com, and xomoni.com out of reach
- When the person signs out of Xomoni
- Then they are signed out all the same, and a toast says Couldn’t reach xomoni.com, so this browser was forgotten here
  only. To end its access, remove it under Connected browsers on xomoni.com.
- And once they continue as @xomoni_fixture, the account panel shows xomoni.com Not connected
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-11 · error

- Given the person closed the X window themselves: the sidebar says X window closed
- When they sign out of Xomoni
- Then signing out finishes: the toast says Signed out of Xomoni. @xomoni_fixture…, with no Couldn’t finish signing out
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-12 · error

- Given x.com out of reach for its sign-out page
- When the person signs out with Also sign out of X ticked
- Then the tab for X's page opens and shows the browser's error, and Xomoni is signed out, the data kept
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-13 · security

- Given an account with years of posts, replies and likes on X, whose posts the person browsed before signing out
- When they browse their replies and likes on X while signed out of Xomoni, then continue as @xomoni_fixture
- Then Home counts the 5 posts, and 0 replies and 0 likes: nothing X showed while they were signed out was recorded
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-14 · security

- Given the person signed out of Xomoni, still signed in to X
- When they open the X window again, and reload the dashboard
- Then Xomoni doesn't sign them straight back in: it offers Continue as @xomoni_fixture, and stays on You’re signed out,
  with no account in the sidebar, until they press it
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-15 · security

- Given the person accepted the risks for the account's first job, then signed out removing its data
- When they continue as @xomoni_fixture, browse their posts again, and start a cleanup
- Then the risks dialog asks them again, Type I UNDERSTAND to continue: the consent went with the data
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-16 · security

- Given a job X stopped by showing its notice of a limited account
- When the person signs out removing the account's data, and continues as @xomoni_fixture
- Then Home counts 0 posts, and still says Resting after a warning from X: Xomoni keeps its record of X’s limits and
  warnings, so they still hold
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-17 · empty

- Given an account with no job and no xomoni.com connection
- When the person opens Sign out of Xomoni?
- Then it says one thing only: The X window Xomoni opened closes, and Xomoni stops recording what X shows until you sign
  in again.
- And the choice to remove the data says what goes: The inventory, archive, jobs, Watch and activity log. Xomoni keeps
  its record of X’s limits, so they still hold.
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-18 · empty

- Given the person signed out, the X window closed
- When they look at the signed-out page
- Then it offers Sign in to xomoni.com, and without an account Open X window, and says The account the X window is
  signed in to appears here., with no Continue as yet
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-19 · cancel

- Given a cleanup job running, and Sign out of Xomoni? open over Activity
- When the person presses Cancel
- Then nothing is signed out: Activity is back, the job still waits for its hours, the X window is open and the account
  is in the sidebar
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-20 · cancel

- Given Sign out of Xomoni? open, with both choices ticked
- When the person presses Escape, and opens it again
- Then the dialog closed with nothing done, and opens afresh: neither choice ticked, and the button says Sign out
- And Cancel then leaves the account signed in
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-21 · a11y

- Given a person using only the keyboard
- When they Tab to the account in the sidebar, press Enter, Tab to Sign out of Xomoni and press Enter
- Then the dialog opens with the focus on Sign out, Space ticks and unticks Remove data, and Enter on Sign out signs out
- And on the signed-out page, Enter on Open X window then on Continue as @xomoni_fixture signs them in again
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-22 · a11y

- Given Sign out of Xomoni? open with Remove data ticked, then the signed-out page
- When axe checks each
- Then neither has a serious accessibility violation
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-23 · browser

- Given a browser set to dark mode
- When the person opens Sign out of Xomoni? and signs out
- Then the dialog and the signed-out page have no serious accessibility violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-24 · persistence

- Given the dashboard open in two tabs, the second on Library
- When the person signs out in the first, and reloads it
- Then the second turns to You’re signed out at once, and the first stays signed out after the reload, with no account
  in the sidebar
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-25 · persistence

- Given a cleanup job running in one dashboard tab
- When the person signs out from a second tab, whose dialog says the job pauses
- Then both tabs turn to You’re signed out
- And once they continue as @xomoni_fixture in the first, the job is paused there, with Resume
- Test: apps/web/e2e/extension/sign-out.spec.ts

## S226-26 · invalid

- Given Sign out of Xomoni? open
- When the person ticks Remove @xomoni_fixture’s data from this browser, the button turning to Sign out and remove
  data, then unticks it and presses Sign out
- Then the data stays: the page says @xomoni_fixture’s data is still here, and Home counts the 2 posts once they continue
- Test: apps/web/e2e/extension/sign-out.spec.ts
