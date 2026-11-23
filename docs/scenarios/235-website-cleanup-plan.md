---
task: 235
title: A cleanup planned on xomoni.com: user scenarios
feature: website-cleanup-plan
---

# A cleanup planned on xomoni.com

xomoni.com's Cleanup place asks the same three questions as Xomoni's Cleanup page (#235, [ADR-0027](../adr/0027-extension-actions-from-the-website.md)): what to remove, how old, and what to keep. Xomoni in the same browser says how much the plan matches in its copy and how many days it takes at its pace. *Review and start in Xomoni* hands the plan over: Xomoni opens its own Cleanup page with it filled in, and nothing starts until the person confirms there ([ADR-0006](../adr/0006-website-is-view-only.md)). The answers live in the page's address, so a link, or *Send to my computer* on a phone, carries the plan. Written for #345, the features shipped before the scenarios gate.

The tests run on both sides:

- **xomoni.com** (`apps/web/e2e/cleanup-plan.spec.ts`): the website against the local stack, with Xomoni played at the page. Xomoni signs in with the site's code through `pair_device`, answers each estimate as a test says, and records every message.
- **Xomoni** (`apps/web/e2e/extension/cleanup-plan.spec.ts`): the built extension in a real browser, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with years of posts. xomoni.com is played at it, sending what the website sends.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-235
npm run test:e2e:extension -w @xomoni/web -- --grep @task-235
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S235-01 · happy

- Given a person signed in, with Xomoni in this browser
- When they open Cleanup
- Then the plan is Xomoni's own default: posts over a year old, threads kept
- And it says 1,234 posts in Xomoni's copy of @ada match, deleted at 100 a day at most, about 13 days, and Xomoni was
  asked with exactly that plan
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-02 · happy

- Given Cleanup
- When the person chooses replies, two years, at least 10 likes to keep, the words Launch, thanks and launch, and turns
  off keeping their own threads
- Then Xomoni is asked with exactly that plan: the words lowercased and each once
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-03 · happy

- Given a plan of likes
- When the person presses Review and start in Xomoni
- Then Xomoni gets the plan, with no likes to keep for likes, and the page says Xomoni opened its Cleanup page with the
  plan, and nothing starts until they confirm there
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-04 · happy

- Given a plan of replies, 90 days old, keeping 5 likes
- When the person copies the address and opens it again later
- Then the address holds the answers, and the link opens the same plan, which Xomoni is asked about
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-05 · invalid

- Given a plan by date
- When the person picks a day still to come
- Then the page says the date must be today or earlier, and nothing can be handed over
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-06 · invalid

- Given a plan by date
- When the person picks a start date after the end date
- Then the page says the start date must be before the end date, and nothing can be handed over
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-07 · invalid

- Given Cleanup
- When the person types 0 as the likes to keep
- Then the page says likes to keep must be a whole number from 1, or empty
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-08 · invalid

- Given Cleanup
- When the person types 21 words to keep, then one of 51 characters
- Then the page says to keep at most 20, then that each can be at most 50 characters, and nothing can be handed over
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-09 · invalid

- Given a plan by date
- When the person picks a day in 2005
- Then the page says X began in 2006
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-10 · error

- Given Xomoni in this browser, which refuses to count
- When the person opens Cleanup
- Then the page says Xomoni didn't answer, to open it on this computer and try again
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-11 · error

- Given a Xomoni older than the page
- When the person opens Cleanup
- Then the page says their Xomoni can't count what matches here yet, and to install the newest version
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-12 · error

- Given a plan, and a Xomoni that now refuses, signed in to another account
- When the person presses Review and start in Xomoni
- Then the page says Xomoni in this browser isn't signed in to this account, and nothing starts
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-13 · security

- Given a plan of reposts handed over
- When the messages Xomoni received are counted
- Then they are only hellos, the sign-in, estimates and the plan, which holds the answers and nothing else: nothing
  starts, resumes or approves work from the page
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-14 · security

- Given a word to keep only the person knows
- When the plan is counted and handed over
- Then the word goes only to Xomoni in this browser: no request to a server carries it, beyond the page's own address
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-15 · security

- Given a link someone sent with a plan of likes
- When the person opens it
- Then the form is filled in and Xomoni counts it, but no plan goes to Xomoni until the person presses Review and start
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-16 · empty

- Given a browser without Xomoni
- When the person opens Cleanup and presses Review and start in Xomoni
- Then the page says Xomoni counts what matches on the computer, to open the page where Xomoni runs, and the dialog
  says Xomoni isn't installed
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-17 · empty

- Given a plan nothing in Xomoni's copy matches
- When Xomoni answers
- Then the page says 0 posts match, with no days to take
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-18 · cancel

- Given a plan of replies
- When the person goes back to posts, the default
- Then the address is plain again
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-19 · cancel

- Given the dialog that Xomoni isn't installed, opened from Review and start
- When the person closes it
- Then nothing was handed over, and the button is there to press again
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-20 · a11y

- Given Cleanup
- When the person uses only the keyboard: an arrow in what to remove, an arrow in how old, then Enter on Review and
  start
- Then replies and two years are chosen, and that plan is handed over
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-21 · a11y

- Given the plan and its estimate, with the warning that no archive is imported
- When the page is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-22 · browser

- Given an iPhone, with a plan of likes
- When the person presses Review and start, then Send to my computer
- Then the dialog says Xomoni runs on a computer, and the link copied carries the plan (and CI's e2e-edge runs every
  scenario in Microsoft Edge)
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-23 · persistence

- Given a plan of likes over six months old
- When the person reloads the page
- Then the plan is there again, from the address
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-24 · happy

- Given Xomoni's copy without the X archive
- When the plan is of posts, then of reposts
- Then the estimate warns that old posts X no longer shows can be missed, to get the archive first, and says nothing
  of it for reposts
- Test: apps/web/e2e/cleanup-plan.spec.ts

## S235-25 · happy

- Given Xomoni signed in from xomoni.com, and the person's posts browsed on X
- When the page asks what posts older than 2023 match, then the same keeping the words old made-up
- Then Xomoni answers 3 of @xomoni_fixture's posts, with its pace a day and that no archive is imported, then 2
- Test: apps/web/e2e/extension/cleanup-plan.spec.ts

## S235-26 · happy

- Given the same copy
- When the page hands over the plan of posts older than 2023
- Then Xomoni opens its Cleanup page, Planned on xomoni.com, with the choices from the plan and the three posts it
  matches
- And nothing starts: Activity has no job, and the log says the plan waits for the person to review it
- Test: apps/web/e2e/extension/cleanup-plan.spec.ts

## S235-27 · security

- Given Xomoni signed in from xomoni.com
- When a page names another account's device in an estimate or a plan
- Then Xomoni refuses both as another account's, and Cleanup isn't touched
- Test: apps/web/e2e/extension/cleanup-plan.spec.ts

## S235-28 · invalid

- Given Xomoni signed in from xomoni.com
- When a plan ends in the future, starts at its end, names a kind Xomoni doesn't have, keeps 0 likes, keeps 21 words,
  or carries a field Xomoni doesn't know
- Then Xomoni refuses each, as an estimate and as a plan, as invalid, and Cleanup isn't touched
- Test: apps/web/e2e/extension/cleanup-plan.spec.ts

## S235-29 · security

- Given Xomoni that was never signed in to xomoni.com
- When a xomoni.com page asks for an estimate or hands over a plan
- Then Xomoni refuses both: not connected
- Test: apps/web/e2e/extension/cleanup-plan.spec.ts

## S235-30 · persistence

- Given a plan Xomoni's Cleanup page took
- When the person reloads the dashboard and opens Cleanup again
- Then it is the plain form: the page takes a plan once, and nothing was started
- Test: apps/web/e2e/extension/cleanup-plan.spec.ts
