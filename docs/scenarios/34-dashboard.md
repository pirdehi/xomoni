---
task: 34
title: The dashboard: user scenarios
feature: dashboard
---

# The dashboard

Xomoni's dashboard (#34, #201, #202, #204): *Home* says what runs and what X needs, with the one button that helps, the steps of getting started, what the copy holds and what Xomoni removed, and a year-by-year chart with a table; *Activity* shows each job and a log to read, filter and export as CSV or JSON; *Settings* switches between light and dark. The pages a feature has (Cleanup, Library, Watch, its pace and its sign-out) have their own scenarios. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: the theme's choices sat inside a `<label>`, so a screen reader heard the first one, *System*, as "Theme Light Dark" (S34-25).

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`). A job is the Library's *Complete my copy*, a read that changes nothing on X; the scenarios that wait for its first page take up to two minutes, at a new account's pace. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-34
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S34-01 · happy

- Given the X window open on the person's account
- When they open Home
- Then it names @xomoni_fixture, says everything Xomoni knows stays in this browser, and offers New cleanup
- And its status reads All is well: nothing is running, and X has raised no warning
- And the steps of getting started are Sign in to X, Get your archive and Your first cleanup
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-02 · happy

- Given the person browsed their profile's tabs on X
- When they open Home
- Then its counts read Removed by Xomoni 0 of all kinds, Posts 5, Replies 2, Reposts 1 and Likes 2, each with 0
  removed or undone
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-03 · happy

- Given the person's copy, with posts from 2019 to 2024
- When they choose Table under Still on your account, by year
- Then the chart becomes a table with a row for each year, from 2019 to 2024
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-04 · happy

- Given a read started from the Library
- When the person opens Home
- Then its status reads Working on “Complete my copy”, at a careful pace that stops by itself if X objects
- And See progress opens Activity, where the job runs
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-05 · happy

- Given a read the person paused
- When they open Home
- Then its status reads “Complete my copy” is paused, and that it carries on from where it stopped
- And Resume carries it on: the status reads Working on “Complete my copy”
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-06 · happy

- Given a read started and paused
- When the person opens Activity's Log
- Then it says Started “Complete my copy”, and Warnings & errors leaves that out
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-07 · happy

- Given the log, filtered to Warnings & errors
- When the person presses Export CSV, then Export JSON
- Then xomoni-activity-xomoni_fixture-<today>.csv and .json download, each with every entry, Started “Complete my
  copy” included, whatever the filter
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-08 · happy

- Given Settings
- When the person chooses the Dark theme, and reloads the dashboard
- Then the dashboard is dark, and stays dark, with Dark chosen
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-09 · invalid

- Given a log with nothing that went wrong
- When the person filters it to Warnings & errors
- Then it says No activity, and that actions appear as soon as a job runs
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-10 · invalid

- Given an account in Xomoni
- When the person opens an address the dashboard doesn't know, #/nowhere
- Then Home opens
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-11 · invalid

- Given nothing in the copy yet
- When the person looks at Home's chart by year
- Then it says No data yet
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-12 · error

- Given the person signed out of X, and a read started
- When they open Home
- Then its status reads X needs you, to finish what X asks in the X window, Xomoni never seeing what they type,
  with Open X window
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-13 · error

- Given X's Home shows its notice that the account is limited, and a read stopped for safety on it
- When the person opens Home
- Then its status reads Resting after a warning from X, and says Xomoni can carry on in about 12 hours, at a slower
  pace
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-14 · error

- Given X's Home shows its notice that the account is suspended, and a read stopped for safety on it
- When the person opens Home
- Then its status reads Stopped to keep your account safe: Xomoni won't carry on by itself, check X, then decide in
  Activity
- And Go to Activity opens Activity
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-15 · security

- Given an account in Xomoni, and its copy
- When the person goes through every page of the dashboard and reloads it
- Then nothing is asked of X: the dashboard reads only this browser's copy
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-16 · security

- Given an account whose risks the person hasn't accepted
- When they press Complete my copy and Not now on the risks
- Then nothing is asked of X, and Home still says nothing is running
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-17 · empty

- Given a fresh install
- When the dashboard opens by itself
- Then it is the first run, Welcome to Xomoni, with three steps and Open X window first, and the sidebar says the X
  window is closed
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-18 · empty

- Given an account with no job yet
- When the person opens Activity, then its Log
- Then there is no job, New cleanup is offered, and the log says No activity
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-19 · cancel

- Given a running read
- When the person pauses it
- Then Home says it is paused, and nothing more reaches X
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-20 · cancel

- Given the Light theme chosen
- When the person chooses System, and reloads
- Then the dashboard follows the computer again, and System stays chosen
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-21 · a11y

- Given Home with an account
- When the person uses only the keyboard: Tab to New cleanup and Enter, then on Activity Tab to Jobs, an arrow and
  Enter
- Then Cleanup opens, and the arrow reaches the Log tab, which Enter opens
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-22 · a11y

- Given Home with its counts, and Activity's jobs and log
- When each is checked with axe
- Then there is no serious or critical violation
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-23 · browser

- Given a computer in dark mode
- When the person opens Home and Activity
- Then the dashboard is dark, with no serious accessibility violation (and CI's e2e-edge runs every scenario in
  Microsoft Edge)
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-24 · persistence

- Given a read started and paused
- When the person reloads the dashboard, and opens Activity in a second tab
- Then the log still says it started, and the second tab shows the job, paused
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-25 · a11y

- Given Settings
- When a screen reader reads the theme
- Then it is a group named Theme, of three choices named System, Light and Dark, System chosen
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts

## S34-26 · security

- Given the log with a read's entries
- When the person exports it as CSV, then as JSON
- Then nothing is sent anywhere to make the files: they are made on this computer
- Test: apps/web/e2e/extension/dashboard-scenarios.spec.ts
