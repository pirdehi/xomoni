---
task: 24
title: Preview before acting, and the risks before an account's first job
feature: preview-before-acting
---

# Preview before acting

Nothing acts on X before the person has seen what will go and said yes twice (#24, PLAYBOOK C7). Cleanup's *Review* shows exactly what matches in their copy, the newest four with their date and text, and how long it would take at the pace a run would use now: their own pacing, slowed by a new account's warm-up and the risk ladder, spread over days by the daily cap. *Download backup (JSON)* saves what matches as a file on this computer. *Start cleanup* asks them to type DELETE. Before an X account's first job, Xomoni shows the risks, from `@xomoni/consent`, and asks them to type I UNDERSTAND, once for each X account. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, which X shows as Premium, with years behind it (`xHistory: 'long'`). Once the person has browsed their profile's tabs, Xomoni's copy holds 5 posts (Feb 8, 2024, May 20, 2023, Jun 1, 2021, Mar 14, 2020 and Aug 15, 2019), 2 replies (Nov 2, 2020, to the made-up `@fixture_friend`, and Mar 14, 2020, continuing the person's own thread), 1 repost and 2 likes of `@fixture_friend`'s posts (May 5, 2019 and Apr 2, 2025). An X archive, where a scenario needs a large copy, is made in the test (`apps/web/e2e/support/x-archive.ts`).

Each test starts from a fresh install, so the account is on its first warm-up day: Xomoni's pace is a quarter of Careful's, 320–480 s between deletes and at most 240 a day (ADR-0012). The estimate's arithmetic is proven by the unit tests of `estimateDuration` (`apps/extension/tests/filter.test.ts`), and the engine's refusal to run without the person's consent by `apps/extension/tests/runner.test.ts`. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-24
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S24-01 · happy

- Given the person browsed their profile, on Cleanup with Replies chosen and their own threads kept
- When they look at Review, then confirm with DELETE and accept the risks
- Then Review shows 1 matching: Nov 2, 2020, A made-up reply to a made-up friend., and not the reply that continues
  their own thread
- And the confirmation says 1 in your copy match, plus any that searching X finds
- And the job it starts, Delete replies older than the date Review names, has 1 remaining: what was previewed
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-02 · happy

- Given the person's 5 posts more than a year old on Cleanup, at Careful's pace: Estimated time ≈ 33m 35s
- When they choose Custom pacing in Settings, with a Min delay of 200 seconds between deletes, and come back
- Then Review's pace follows theirs, 800–800s at a quarter on warm-up day 1, and Estimated time says ≈ 1h 6m
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-03 · happy

- Given the person imported X's archive of their account, with 300 posts from 2015
- When they open Cleanup, where posts more than a year old are chosen
- Then Review shows 300 matching, the newest four and "and 296 more"
- And it says the cleanup is spread over about 2 days by the daily cap, 240 a day on warm-up day 1, and that Xomoni
  waits and continues automatically, with an estimate of more than a day
- And no warning about a missing archive stands between them and Start cleanup
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-04 · happy

- Given the person's 2 likes on Cleanup, Likes chosen
- When they press Download backup (JSON)
- Then the browser saves xomoni-backup-likes-<today>.json, with the two liked posts of @fixture_friend, their ids and
  texts, and nothing else
- And the page says Backup of 2 items downloaded
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-05 · happy

- Given a confirmed cleanup, the first job of @xomoni_fixture
- When the risks dialog opens
- Then it is titled Before you start: the risks, and says, in order: X’s rules forbid this kind of automation, The
  risk can’t be removed, A research project, at your own risk, Deletions are permanent, Download your archive first,
  and What Xomoni never does, with its five promises
- And it asks the person to Type I UNDERSTAND to continue with @xomoni_fixture, with I understand, continue off until
  they do
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-06 · happy

- Given the person accepted the risks for @xomoni_fixture's first cleanup, then cancelled it
- When they confirm a second cleanup of the same account, posts before Jan 1, 2022, with DELETE
- Then it starts with no risks dialog: Activity shows it running
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-07 · invalid

- Given the risks dialog before an account's first job
- When the person types i understand, I UNDERSTOOD, I UNDERSTAND. or DELETE
- Then I understand, continue stays off: only I UNDERSTAND, in capitals, consents
- And typed with spaces around it, I UNDERSTAND turns it on
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-08 · invalid

- Given the confirmation of a cleanup open
- When the person types I UNDERSTAND, the other dialog's phrase, and presses Enter
- Then its Start cleanup stays off, the dialog stays open, and no job is created
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-09 · invalid

- Given the person's 5 posts more than a year old on Cleanup
- When they set Custom pacing's deletes to 0 a day in Settings
- Then the field keeps 1, never 0: a pace of nothing would hide how long a cleanup takes
- And Review says max 1/day, Spread over about 5 days by the daily cap, with Estimated time ≈ 4d 0h
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-10 · empty

- Given the person browsed their profile's posts and replies, but not their likes
- When they choose Likes on Cleanup
- Then the card says Likes 0 in your copy, Review 0 matching with nothing listed and Estimated time ≈ 0s
- And Download backup (JSON) is off: there is nothing to back up
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-11 · empty

- Given the person accepted the risks for @xomoni_fixture's first cleanup, cancelled it, and pressed Delete local
  data in Settings
- When they open Cleanup, then browse their profile again and start a cleanup
- Then Cleanup has nothing to preview, Posts 0 in your copy: the copy went with the data
- And the risks dialog asks them again, its field empty: so did their consent
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-12 · error

- Given the person's posts before Jan 1, 2021 on Cleanup, and then the internet connection drops
- When they look at Review, download the backup and confirm the cleanup
- Then the preview, its estimate and the backup all work from the copy, with nothing asked of X
- And the job it starts waits for the internet connection, with 2 remaining
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-13 · error

- Given X refuses the person's Likes tab with its rate limit (429) while they browse their profile
- When they open Cleanup
- Then Likes says 0 in your copy, and with Likes chosen nothing is previewed and the backup is off: Xomoni previews
  only what X showed
- And Posts still previews the 5 posts X did show
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-14 · error

- Given the person's 2 replies in Xomoni's copy, read from X earlier
- When X is over capacity (503) the next time they open their Replies tab, and shows its error
- Then Cleanup still has Replies 2 in your copy, previews the one that matches, Nov 2, 2020, and backs it up: X
  failing never empties the copy
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-15 · security

- Given the person accepted the risks for @xomoni_fixture's first job, and then signed in to X as the made-up
  @fixture_friend in the X window, which the dashboard follows
- When they open Cleanup and start a cleanup of @fixture_friend's posts
- Then Cleanup shows @fixture_friend's own copy, empty so far: 0 posts, replies, reposts and likes, and nothing of
  @xomoni_fixture's
- And the risks dialog asks again, to continue with @fixture_friend: one account's consent never covers another
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-16 · security

- Given a cleanup started with DELETE and the risks accepted, then cancelled
- When the person sets up a second cleanup and opens its confirmation
- Then the field is empty and Start cleanup off: the DELETE typed for one cleanup never starts another
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-17 · security

- Given the risks dialog
- When the person looks at Read X’s automation rules
- Then it links to X's own page, https://help.x.com/en/rules-and-policies/x-automation, opening in a new tab with no
  referrer, so X learns nothing of the dashboard
- And Download your archive first names the Library's Get my archive, never a site outside X and Xomoni
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-18 · cancel

- Given a confirmed cleanup and the risks dialog, with I UNDERSTAND half typed
- When the person presses Escape
- Then the dialog closes and nothing starts: the job waits in Activity as Ready, and no X window opens
- And when they press Start again, the dialog opens with its field empty
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-19 · cancel

- Given the person's posts before Jan 1, 2021 on Cleanup, 2 matching, and the confirmation open
- When they press Cancel
- Then Cleanup keeps what they chose: Posts, Jan 1, 2021 and the same 2 matching
- And when they change the date to Jan 1, 2022, the preview follows at once with 3, Jun 1, 2021 first, and nothing
  starts
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-20 · a11y

- Given a person using only the keyboard, on Cleanup with their posts before Jan 1, 2021
- When they Tab to Download backup (JSON) and press Enter, then reach the risks dialog's link and field with Tab
- Then the backup downloads, the risks dialog takes the focus, Read X’s automation rules is reached by Tab, and
  Escape closes the dialog
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-21 · a11y

- Given Review with a preview, its estimate and the note on how many days it is spread over, and the risks dialog
- When axe checks them, the dialog empty and typed
- Then it finds no serious or critical violation, and the preview is a list, the dialog named Before you start: the
  risks, and its field named Type I UNDERSTAND to continue
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-22 · browser

- Given the system in dark mode, and the dashboard in a narrow window, 800 px wide, half of a laptop's screen
- When the person previews a cleanup and reaches the risks dialog
- Then Review comes under the form, its preview and both buttons inside the window, and the risks' field and buttons
  can be reached, with no serious or critical accessibility violation (and Edge, as CI's e2e-edge runs every scenario)
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-23 · persistence

- Given the person accepted the risks for a first cleanup, then cancelled it
- When they reload the dashboard and confirm another cleanup with DELETE
- Then it starts with no risks dialog: the consent is kept in this browser for the account
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts

## S24-24 · persistence

- Given Cleanup open on Replies, before the person has browsed their replies
- When they open their Replies tab in another tab of the browser
- Then Cleanup follows without a reload: Replies 2 in your copy, and Review previews the reply that matches
- Test: apps/web/e2e/extension/preview-before-acting.spec.ts
