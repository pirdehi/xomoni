---
task: 257
title: Reports and a weekly email: user scenarios
feature: reports
---

# Reports and a weekly email

Reports on xomoni.com (#257, [ADR-0031](../adr/0031-weekly-email-of-the-daily-numbers.md)): weekly, monthly and the year in review, against the period before; what Xomoni removed, job by job; and a report of the person's own numbers. Each shows as tables, downloads as CSV, or prints to PDF with the browser. They are made from the daily numbers the person chose to show (ADR-0026), and from the jobs Xomoni reported. If the person asks for it, an email every Monday compares last week with the week before, and one link stops it. The email's sending itself, on a schedule, is the server's (`apps/web/src/modules/dashboard/server/weekly-email.ts`, with its own tests). Written for #345, the features shipped before the scenarios gate.

The tests run xomoni.com on the local Supabase stack, with its real Auth and database. A test's account gets daily numbers, and jobs, stored as Xomoni would report them (`apps/web/e2e/support/admin.ts`): two weeks of `@ada_x` unless it says otherwise, with 100 followers and 1 post ten days ago, and 120 followers, 4 posts and 9 likes received two days ago. Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-257
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S257-01 · happy

- Given two weeks of the person's numbers, and Reports opened
- When they look at the report it opens on
- Then it is Weekly report · All accounts · Last 7 days, the last 7 days against the 7 before
- And the followers read 120, up +20 (+20%), and the posts published 4
- And it says it was made on xomoni.com from what Xomoni counted on the person's computer
- Test: apps/web/e2e/reports.spec.ts

## S257-02 · happy

- Given two weeks of the person's numbers
- When they pick Monthly, then Year in review
- Then the monthly report covers the last 30 days, with 5 posts published
- And the year in review covers 12 months, with Following and a table of each month
- Test: apps/web/e2e/reports.spec.ts

## S257-03 · happy

- Given two cleanup jobs Xomoni reported, one that removed 12 posts and skipped 1
- When the person picks Cleanup
- Then it lists both jobs, newest first, each with its account and what it removed
- Test: apps/web/e2e/reports.spec.ts

## S257-04 · happy

- Given Your own, which starts from the usual numbers
- When the person leaves every number out but Followers
- Then the report shows the followers alone, and the CSV's columns are Day and Followers
- Test: apps/web/e2e/reports.spec.ts

## S257-05 · happy

- Given the weekly report
- When the person presses Download CSV
- Then xomoni-weekly-all-accounts-<today>.csv downloads, with a row for each day that has numbers
- Test: apps/web/e2e/reports.spec.ts

## S257-06 · happy

- Given the person's numbers shown on xomoni.com
- When they turn on Email me my week every Monday
- Then it says last week's numbers come on Monday morning to the address they sign in with, counts only, each email
  with a link to stop it, and the choice is stored
- Test: apps/web/e2e/reports.spec.ts

## S257-07 · invalid

- Given Your own
- When the person leaves every number out
- Then it says Pick at least one number to report, and Download CSV is off
- Test: apps/web/e2e/reports.spec.ts

## S257-08 · invalid

- Given numbers for two X accounts, @ada_x and @bob_x, and a job reported for each, so the account picker lists them
- When the person picks @ada_x as the account
- Then the report is about @ada_x alone: 120 followers, not the two accounts' 170, and its own 4 posts
- Test: apps/web/e2e/reports.spec.ts

## S257-09 · invalid

- Given a day with posts published but no follower count
- When the person looks at the weekly report
- Then the followers read —, not 0, and the posts 2
- Test: apps/web/e2e/reports.spec.ts

## S257-10 · error

- Given the person's daily numbers off
- When they look at the weekly email
- Then it can't be turned on, and says to turn the daily numbers on first: the email is made of them
- Test: apps/web/e2e/reports.spec.ts

## S257-11 · error

- Given the database refusing to turn the email on
- When the person turns it on
- Then Reports says it couldn't, and the switch stays off, with nothing stored
- Test: apps/web/e2e/reports.spec.ts

## S257-12 · error

- Given the weekly email on
- When someone opens a stop link that isn't complete
- Then the page says the link isn't complete, offers no button, and the email stays on
- Test: apps/web/e2e/reports.spec.ts

## S257-13 · security

- Given a cleanup job whose title looks like a spreadsheet formula
- When the person downloads the cleanup report as CSV
- Then the title is written as text, behind a ', so a spreadsheet never runs it
- Test: apps/web/e2e/reports.spec.ts

## S257-14 · security

- Given one account's numbers and a cleanup job
- When another person, with no numbers, opens their own Reports
- Then they see no numbers and no cleanup: nothing of the first account
- Test: apps/web/e2e/reports.spec.ts

## S257-15 · security

- Given someone signed out
- When they open /dashboard/reports
- Then they are sent to sign in, and no report shows
- Test: apps/web/e2e/reports.spec.ts

## S257-16 · security

- Given the person's weekly email on
- When someone posts a well-formed stop token that isn't anybody's
- Then the person's email stays on: a link stops only the email whose token it carries
- Test: apps/web/e2e/reports.spec.ts

## S257-17 · empty

- Given an account whose daily numbers are off
- When the person opens Reports
- Then it says reports are made from the daily numbers once Show my numbers on xomoni.com is on, with Turn them on in
  Overview, and Download CSV is off
- Test: apps/web/e2e/reports.spec.ts

## S257-18 · empty

- Given numbers shown, but none in the last 7 days, and no cleanup
- When the person opens Reports, then Cleanup
- Then the weekly report says no numbers in this period yet, that they come with Xomoni's next report
- And the cleanup report says no cleanup ran in this period
- Test: apps/web/e2e/reports.spec.ts

## S257-19 · cancel

- Given the weekly email on
- When the person, or a mail scanner, opens the link in the email without pressing anything
- Then the page asks first, Stop the weekly email of your numbers?, says it can be turned on again, and the email
  stays on
- Test: apps/web/e2e/reports.spec.ts

## S257-20 · a11y

- Given Reports
- When the person uses only the keyboard: an arrow on Weekly, then Space on the email's switch
- Then the arrow picks Monthly, which the report follows, and Space turns the email on
- Test: apps/web/e2e/reports.spec.ts

## S257-21 · a11y

- Given the weekly report, the year in review, the cleanup report and Your own
- When each is checked with axe
- Then each table has its column headers, and there is no serious or critical violation
- Test: apps/web/e2e/reports.spec.ts

## S257-22 · browser

- Given the weekly report
- When the person presses Save as PDF and the browser prints the page
- Then the print shows the report and its tables alone: no menu, no Download CSV, no period picker, no email switch
- Test: apps/web/e2e/reports.spec.ts

## S257-23 · persistence

- Given the weekly email on, and the monthly report picked
- When the person reloads Reports
- Then the email is still on, and the report starts again on Weekly
- Test: apps/web/e2e/reports.spec.ts

## S257-24 · cancel

- Given the weekly email on
- When the person turns it off again in Reports
- Then the switch is off, and so is the stored choice
- Test: apps/web/e2e/reports.spec.ts
