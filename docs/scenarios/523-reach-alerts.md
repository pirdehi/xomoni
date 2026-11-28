---
task: 523
title: Reach's alerts, a new label and the note when reach drops
feature: reach-alerts
---

# Reach's alerts

Reach's alerts (#523, part of #430's P5.3, [ADR-0045](../adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md)) tell the person when X's *Under the hood* report, dropped on the Vault page, brings a label that is new or larger than the month before: once per account and month, as a desktop notification whose click opens Reach, and as a count of months not yet seen beside *Reach* in the menu, said in the item's description so its name stays *Reach*. On Reach, a note says when the last 7 days' views, from the daily numbers and always an estimate, fall under 0.6 of the 8 weeks before, with at least 5 posts that week and 4 days of numbers on each side, and what may go with it, never why. *Tell me when my reach drops*, off unless the person turns it on, adds a notification at most once a week while the dashboard is open. The alerts are part of Plus, open as a preview. Nothing asks X for anything, and nothing leaves the computer.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with the synthetic reports in `apps/web/e2e/fixtures/under-the-hood`; the daily numbers and this week's posts are put straight into Xomoni's database, as days of browsing leave them. Whether a label was noted is read from what Xomoni keeps (`labelAlerted:<account>`), since a desktop notification can't be read back reliably. Run them with:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-523
```

## S523-01 · happy

- Given X's Under the hood report for August 2026, with a label the month before didn't have
- When the person imports it on the Vault page
- Then Xomoni notes August once, and the menu's Reach shows 1, described as 1 new month of X's labels
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-02 · happy

- Given the menu counts a month of labels not seen yet
- When the person opens Reach
- Then the count goes
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-03 · happy

- Given 1,000 views a day for 8 weeks, then 400 a day for the last 7, with 6 posts this week
- When the person opens Reach
- Then a note says the views were 40% of the usual, marked as an estimate, with what may go with it, not why
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-04 · happy

- Given the drop note on Reach
- When the person turns on Tell me when my reach drops, which was off, and reloads the dashboard
- Then the switch is on, and stays on
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-05 · invalid

- Given the August report was imported and noted
- When the person imports the same file again
- Then nothing is noted a second time
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-06 · invalid

- Given the August report was imported and noted
- When the person imports a newer file of August, with a larger count
- Then August is not noted again
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-07 · invalid

- Given views that fell to 40% of the usual, but only 4 posts this week
- When the person opens Reach
- Then no note is made, since fewer posts is reason enough, and only the switch is offered
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-08 · error

- Given a JSON file that isn't X's report
- When the person chooses it on the Vault page
- Then it is refused with This isn't X's Under the hood file, and nothing is noted
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-09 · error

- Given only 3 days of numbers this week
- When the person opens Reach
- Then no note is made: there aren't numbers enough to say
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-10 · error

- Given X's report naming another account
- When the person chooses it on the Vault page
- Then it is refused, and nothing is noted
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-11 · security

- Given a report imported and a drop on Reach
- When Xomoni notes the label and reads the drop
- Then no request leaves the computer but the X pages the person opened
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-12 · security

- Given a report whose label name is markup, an image with a script
- When it is imported, noted, and shown on Reach
- Then the name is drawn as text, and nothing runs
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-13 · security

- Given months of labels kept for another account in this browser
- When the menu is drawn for this account
- Then it counts none of them
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-14 · empty

- Given a report of a month with no label
- When the person imports it
- Then nothing is noted, and the menu counts nothing
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-15 · empty

- Given no daily numbers
- When the person opens Reach
- Then only When your reach drops, with its switch off, is shown, and no note
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-16 · cancel

- Given the switch turned on
- When the person turns it off again and reloads the dashboard
- Then it is off
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-17 · cancel

- Given the August report chosen on the Vault page
- When the person presses Cancel in the plan
- Then nothing is imported, and nothing is noted
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-18 · a11y

- Given the drop note on Reach, in light mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-19 · a11y

- Given the menu's count and the drop note, in dark mode
- When axe-core checks the pages, and the person reaches the switch with Tab and presses Space
- Then axe-core finds no serious or critical violation, and the switch turns on
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-20 · browser

- Given the drop note
- When the dashboard is as wide as a phone
- Then the note fits, and the page doesn't scroll sideways
- Test: apps/web/e2e/extension/reach-alerts.spec.ts

## S523-21 · persistence

- Given a month of labels not seen yet
- When the person reloads the dashboard, then opens Reach and reloads again
- Then the count stays until Reach is opened, and stays gone after
- Test: apps/web/e2e/extension/reach-alerts.spec.ts
