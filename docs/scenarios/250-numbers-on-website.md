---
task: 250
title: Show my numbers on xomoni.com
feature: numbers-on-website
---

# Show my numbers on xomoni.com

*Show my numbers on xomoni.com* is a switch, off until the person turns it on, on Overview and in Settings on xomoni.com and in Xomoni's Settings › xomoni.com (#250, [ADR-0026](../adr/0026-daily-numbers-in-the-cloud.md)). The choice is kept per account, so every device follows it. While it is on, Xomoni sends each day's counts, whole numbers only, never text or ids, for the last 400 days; the database takes nothing else. Turning it off deletes every day already sent, and the weekly email with it ([ADR-0031](../adr/0031-weekly-email-of-the-daily-numbers.md)). Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: the switch, on xomoni.com and in Xomoni, no longer turns itself off while the choice is stored, which dropped the keyboard focus after each press (S250-20, S250-30).

The tests run on both sides:

- **xomoni.com** (`apps/web/e2e/numbers-on-website.spec.ts`): the website against the local stack. A browser of the account is paired with a code (`pair_device`) and sends days with its token, as Xomoni does; the database is read with the local stack's service-role key to check what it holds.
- **Xomoni** (`apps/web/e2e/extension/numbers-on-website.spec.ts`): the built extension in a real browser, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)). xomoni.com is played at it, and its functions for the daily numbers answer from the account's choice, as the database does.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-250
npm run test:e2e:extension -w @xomoni/web -- --grep @task-250
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S250-01 · happy

- Given a new account, signed in, on Overview
- When the person turns on Show my numbers on xomoni.com
- Then the switch, off until now, is on, the account's choice is stored as on, and the figures say they come from the
  next report
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-02 · happy

- Given the numbers on
- When Xomoni sends yesterday's and today's counts, 100 then 125 followers
- Then Overview shows 125 followers, with followers over time
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-03 · happy

- Given the numbers turned on in Overview
- When the person opens Settings
- Then the switch is on there too, and turned off there, it is off on Overview as well: one choice for the account
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-04 · happy

- Given a person whose Xomoni turns the numbers on
- When they open Overview
- Then the switch is on
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-05 · invalid

- Given the numbers on
- When Xomoni's day carries a post's text, a post's id, followers as a word, or a handle X wouldn't allow
- Then xomoni.com refuses each, stores nothing, and Overview still waits for the first report
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-06 · invalid

- Given the numbers on
- When a count is -1, 1.5 or above 10⁹
- Then xomoni.com refuses it, and takes 10⁹ itself
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-07 · invalid

- Given the numbers on
- When Xomoni sends a day 402 days old, a day 3 days ahead, or 61 days at once
- Then xomoni.com refuses each and stores nothing, and takes 60 days at once
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-08 · error

- Given xomoni.com failing to store the choice
- When the person turns the numbers on
- Then the page says Couldn't turn your numbers on. Try again in a moment., the switch stays off and nothing is stored
- And once xomoni.com works, turning them on works
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-09 · error

- Given the numbers on with a day sent, and xomoni.com failing to store the choice
- When the person turns them off
- Then the page says Couldn't turn your numbers off. Try again in a moment., and the switch, the choice and the day
  stay as they were
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-10 · error

- Given no connection
- When the person turns the numbers on
- Then the page says it couldn't, and the switch stays off
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-11 · security

- Given the numbers off, before and after being turned on and off again
- When Xomoni sends a day
- Then xomoni.com refuses it as off, and stores nothing
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-12 · security

- Given three days sent and shown on Overview
- When the person turns the numbers off
- Then every day is deleted from xomoni.com, and Overview shows no figure and no chart
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-13 · security

- Given one account's numbers on, with a day of 4,242 followers
- When another account reads the numbers and choices, and turns its own off
- Then it reads nothing of the first, its switch changes only its own choice, and its Overview shows none of the first's
  numbers
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-14 · security

- Given someone signed out
- When they try to turn the numbers on or read them, or open Settings
- Then both are refused, and Settings asks them to sign in
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-15 · happy

- Given the switch on Overview
- When the person reads it and follows What is stored
- Then it says only counts per day are sent, never posts, replies, likes or anyone's name, and off deletes them, and
  the privacy page says what daily numbers hold
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-16 · empty

- Given a new account, the numbers off
- When the person opens Overview
- Then every figure is — with With daily numbers, and no chart shows
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-17 · empty

- Given the numbers on, before Xomoni's first report
- When the person opens Overview
- Then the figures say From the next report
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-18 · cancel

- Given a day sent
- When the person turns the numbers off, then on again
- Then nothing comes back: no day is stored, and Overview waits for Xomoni's next report
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-19 · cancel

- Given the numbers on, and the weekly email turned on in Reports
- When the person turns the numbers off in Settings
- Then the weekly email is off too, and Reports says to turn the numbers on first
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-20 · a11y

- Given Overview
- When the person uses only the keyboard: Tab to the switch, Space, then Space again
- Then the numbers turn on and off, and the focus stays on the switch while each choice is stored
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-21 · a11y

- Given the switch off with its error, then on
- When the page is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-22 · browser

- Given an iPhone, where Xomoni never runs
- When the person turns the numbers on in Settings
- Then the choice is stored for the account (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-23 · persistence

- Given the numbers turned on
- When the person reloads, opens Settings in a second tab, and signs out and in
- Then the switch is on each time
- Test: apps/web/e2e/numbers-on-website.spec.ts

## S250-24 · happy

- Given Xomoni signed in to xomoni.com, the person's posts browsed on X
- When the person turns on Show my numbers on xomoni.com in Settings › xomoni.com
- Then the switch, off until now, says what travels and what never does, Xomoni tells xomoni.com, and a toast says the
  daily numbers are shown on xomoni.com: counts only, never your posts
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts

## S250-25 · security

- Given the numbers turned on in Xomoni
- When Xomoni reports next
- Then it sends the account's days, at most 60 a call, each with the handle, the day and whole numbers from 0, and
  nothing else: no word of a post and no id
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts

## S250-26 · security

- Given the numbers off
- When Xomoni reports, twice
- Then it reports its jobs, and sends no day
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts

## S250-27 · cancel

- Given the numbers on, with days sent
- When the person turns them off in Xomoni
- Then Xomoni asks xomoni.com to delete them, a toast says they were removed, and the next report sends no day
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts

## S250-28 · error

- Given xomoni.com out of reach
- When the person turns the numbers on in Xomoni
- Then an alert says Couldn't reach xomoni.com. Check the connection, then try again., and the switch stays off
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts

## S250-29 · persistence

- Given the numbers turned on on xomoni.com
- When Xomoni's dashboard reloads and reports
- Then its switch is on
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts

## S250-30 · a11y

- Given Settings › xomoni.com in Xomoni
- When the person uses only the keyboard: Tab to the switch, Space, then Space again
- Then the numbers turn on and off, and the focus stays on the switch while each choice is stored
- Test: apps/web/e2e/extension/numbers-on-website.spec.ts
