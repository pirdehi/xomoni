---
task: 245
title: The dashboard on xomoni.com
feature: website-dashboard
---

# The dashboard on xomoni.com

The dashboard on xomoni.com has thirteen places, each at its own address under `/dashboard` (#245, #248): Overview, Audience, Content, Engagement, Reports, Library, Comments, Cleanup, Watch, Activity, Account health, Browsers and Settings. On a computer they are in a sidebar, in four groups; on a phone, in a bottom bar (*Overview*, *Insights*, *Comments*, *More*). Every place has an account and period picker, kept in the address, so a link or a reload shows the same thing, and the links between places keep them. This file covers the frame around the places; what each place shows has its own file. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: an account the address names, with no job here, is now named in the account picker, which showed nothing while the page showed that account (S245-08).

The tests run the website against the local stack (`apps/web/e2e/website-dashboard.spec.ts`). A browser of the account and its jobs are written to the database as Xomoni reports them. Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-245
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S245-01 · happy

- Given a person signed in
- When they open each place from the sidebar in turn
- Then the sidebar has the thirteen places, and each opens at its own address, with its name as the page's heading and
  title, the sentence that says what it is for, and its link marked as the current page
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-02 · happy

- Given the sidebar
- When the person looks at its groups, and opens Engagement
- Then the places are grouped under Insights, Manage and History & account, and Engagement opens, marked current
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-03 · happy

- Given jobs on @ada and @bob in the last 30 days
- When the person opens Activity and chooses @ada in the account picker
- Then the picker offered All accounts, @ada and @bob, the address says account=ada, and only @ada's job is listed
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-04 · happy

- Given @ada's jobs, one of them 40 days old
- When the person chooses Last 90 days, then opens Audience from the sidebar
- Then Activity lists the older job too, and Audience opens with the same account and period, in its address and in
  the pickers
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-05 · happy

- Given Activity
- When Xomoni reports a new job
- Then the page says Live, and the job shows first without a reload
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-06 · invalid

- Given a person signed in
- When they open /dashboard/admin or /dashboard/Library
- Then each shows the not-found page
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-07 · invalid

- Given an address whose account isn't a handle and whose period isn't one the picker has
- When the person opens it
- Then the dashboard shows every account over the last 30 days
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-08 · invalid

- Given an address that names @cy, an account with no job here
- When the person opens Activity with it
- Then the account picker names @cy, as the list shows, with no job in the period, and All accounts brings the jobs
  back
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-09 · error

- Given live updates that can't connect
- When the person opens Activity
- Then the jobs show from the page's load, and the page says Connecting…, not Live
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-10 · error

- Given xomoni.com failing to disconnect a browser
- When the person presses Disconnect, then Disconnect in the dialog
- Then the dialog says why, and after Cancel the browser is still listed
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-11 · error

- Given a new account on Browsers, and xomoni.com failing to make a code
- When the person presses Get a code to connect a browser, then again once it works
- Then the page says why, then shows the code to type in the extension
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-12 · security

- Given someone signed out
- When they open any place, with a period in the address
- Then each sends them to sign in, with that address to come back to, and signing in brings them back to it, period and
  all
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-13 · security

- Given one account with jobs on @ada and @bob
- When another account opens Activity with account=ada and all time in the address
- Then it sees none of them: its picker doesn't offer @bob, and no job shows
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-14 · security

- Given a signed-in place
- When the browser loads it
- Then the answer may not be cached for someone else, nor shown in another site's frame
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-15 · empty

- Given a new account
- When it opens Overview
- Then one bar says to connect Xomoni, with Install Xomoni, while the rest of Overview stays in view, and the account
  picker has only All accounts
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-16 · empty

- Given a new account
- When it opens Activity
- Then the page says no jobs ran in this period, and that a cleanup or a scan started in Xomoni shows up as it runs
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-17 · cancel

- Given @bob over the last 12 months
- When the person goes back to All accounts and Last 30 days
- Then the address is plain again, and every account's jobs show
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-18 · cancel

- Given Reports, opened from Overview, with the period changed twice
- When the person presses Back
- Then Overview is back: the picker's changes don't fill the history
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-19 · a11y

- Given Overview
- When the person uses only the keyboard: Tab to Reports in the sidebar, Enter, then types All on the period picker
- Then Reports opens, and the period changes to All time in the address
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-20 · a11y

- Given Overview, Activity, Browsers and Audience with jobs
- When each is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-21 · browser

- Given a phone-sized screen
- When the person opens the dashboard
- Then a bottom bar takes the sidebar's place, with Overview, Insights, Comments and More; Insights opens Audience,
  with a row of Insights' places, Audience marked current; and More lists every place, Account health among them (and
  CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-22 · cancel

- Given the phone's More menu open
- When the person presses Escape
- Then the menu closes, and the page is as it was
- Test: apps/web/e2e/website-dashboard.spec.ts

## S245-23 · persistence

- Given Activity on @ada over 90 days
- When the person reloads, then opens its address in a second tab
- Then both show Activity, @ada and Last 90 days, with the same jobs
- Test: apps/web/e2e/website-dashboard.spec.ts
