---
task: 249
title: Daily numbers: user scenarios
feature: daily-numbers
---

# Daily numbers

One row per X account per local day, kept in this browser (#249, [ADR-0026](../adr/0026-daily-numbers-in-the-cloud.md)): the profile's counts as X last showed them that day, how many of the person's own posts and replies were seen, and an estimate of what they received, from the rise in their counts between two looks. Only pages X already showed count: Xomoni asks X for nothing to make them. What the person published and what Xomoni removed are counted from the copy and the log when a day is read, not stored. The extension doesn't draw them: xomoni.com shows them when the person chooses to (#250, its own scenarios), and *Move your data* carries them. So these scenarios read a day where Xomoni keeps it, its database in this browser. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`), whose profile X shows with 3 followers, 4 followed, 8 posts and 2 likes, and whose 5 posts show 3, 120, 0, 2 and 1 likes. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-249
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S249-01 · happy

- Given the person opened the X window
- When they browse their profile on X
- Then today's row holds the counts X showed: 3 followers, 4 followed, 8 posts and 2 likes, in one row
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-02 · happy

- Given the person opened the X window
- When they browse their posts and their replies, each seen for the first time
- Then today's row counts 7 of their own posts and replies seen, 4 posts with likes and no reply with likes
- And nothing received: a post's first sighting adds nothing, as its counts may be years old
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-03 · happy

- Given the person's posts seen once today
- When people like two of them since, and the person looks again: X shows 10 likes instead of 3, and 125 instead of
  120
- Then today's row counts 12 likes received
- And the 5 posts are still counted once as seen
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-04 · invalid

- Given the person's posts seen once today
- When one post's likes go down from 3 to 1, and another's up from 120 to 121
- Then only the rise counts: 1 like received, as an unlike is not a negative like
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-05 · invalid

- Given today's row with the profile's counts
- When X shows the profile again leaving the followers and the followed out, and counting 9 posts
- Then the row keeps 3 followers and 4 followed, and takes the 9 posts
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-06 · invalid

- Given today's row with 3 followers and 4 followed
- When X shows the profile again later that day with 5 and 6
- Then the row takes the newest counts, 5 and 6, and the day is still one row
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-07 · error

- Given X shows the person's profile, but is over capacity for their posts (a 503)
- When they browse their profile
- Then today's row keeps the profile's counts, with no post seen and nothing received
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-08 · error

- Given X refuses the person's profile with its rate limit (a 429)
- When they open their profile, and X shows its error
- Then no count is kept for that day
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-09 · error

- Given X answering the profile three seconds late
- When the person opens their profile
- Then nothing is kept before X answers, and the counts land once it does
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-10 · security

- Given the X window open
- When the person browses their profile, and today's counts are kept
- Then X received only what its own page asks for: the page, the profile and its posts, nothing of Xomoni's
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-11 · security

- Given the person browsed their posts, replies and likes
- When today's row is kept
- Then every value in it is a whole number or empty, besides the account's id and the day
- And no post's words, no id of a post, no handle and no one's name is in any day
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-12 · security

- Given today's row, and Xomoni signed in to xomoni.com with Show my numbers on xomoni.com off, as it starts
- When Xomoni reports to xomoni.com
- Then it reports job status, and sends no day, nor any of its counts
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-13 · empty

- Given a fresh install
- When nothing has been browsed yet
- Then Xomoni keeps no day
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-14 · empty

- Given the X window open on X's Home, which shows neither the profile nor the person's posts
- When nothing else is browsed
- Then no day is kept: a day with nothing seen is a gap, not zeros
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-15 · cancel

- Given today's row
- When the person signs out of Xomoni with Remove @xomoni_fixture's data from this browser
- Then the account's days are deleted with the rest of its data
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-16 · cancel

- Given today's row
- When the person presses Delete local data in Settings, then Cancel, then Delete local data again and confirms
- Then Cancel keeps the day, and confirming deletes every day
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-17 · a11y

- Given the daily numbers of an account
- When the person wants to see them
- Then they see them on xomoni.com, whose charts answer on hover and by keyboard, with a table view
- Manual: the extension draws no daily numbers, so it has nothing to check with a keyboard or axe here; xomoni.com
  shows them, and its own scenarios prove that by keyboard and with axe (numbers on xomoni.com, #250; Overview,
  Audience, Content and Engagement, #252–#255).

## S249-18 · a11y

- Given the daily numbers kept, and Move your data in Settings
- When the person moves them to a new Xomoni
- Then the import says, in words, how many days of numbers come with the copy
- Manual: proving it needs the exported file, which Chrome saves through `chrome.downloads`; the scenarios of Move
  your data (#300) export and import the whole file in the browser, days of numbers included.

## S249-19 · browser

- Given Microsoft Edge, as in Chrome
- When the person browses their profile
- Then today's row holds the counts X showed (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/extension/daily-numbers.spec.ts

## S249-20 · persistence

- Given today's row with 5 posts seen
- When the person reloads the dashboard, opens a second tab, and browses their replies too
- Then the reload keeps the day, and the second tab finds the same one row, now with 7 seen
- Test: apps/web/e2e/extension/daily-numbers.spec.ts
