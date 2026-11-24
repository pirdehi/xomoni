---
task: 429
title: Reach: each post's reach, its usual, and how it spreads
feature: reach-diagnosis
---

# Reach

The Reach page (#429, [ADR-0045](../adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md)) shows how many times X says each of the person's posts and replies was seen, from X's own numbers, against their usual: the median of their posts of the same kind (text, a link, photos or videos, a reply) in the 8 weeks before, once there are 15 of them. A post read before it was 7 days old is still growing, and isn't compared. The numbers here are the views X shows on the person's own profile, which Xomoni keeps as it already does for the daily numbers (#249); X's analytics export joins them once the vault reads it (#425). Xomoni never asks X for anything to measure reach. The last 30 days are free; longer periods are part of Plus, open as a preview until sales start (ADR-0042).

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, whose profile X shows with the posts each test gives it, with their views, links and photos. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-429
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S429-01 · happy

- Given the person browsed their profile on X, which showed three of their posts from the last month, seen 1,200,
  340 and 56 times
- When they open Reach from the menu
- Then the table lists the three posts, newest first, each with its views, a *Live* badge and a link to it on X
- And the sources say Xomoni saw views of 3 posts on X, as last seen
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-02 · happy

- Given the three posts on Reach
- When the person sorts by *Most seen*
- Then the post seen 1,200 times comes first, then 340, then 56
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-03 · happy

- Given fifteen of the person's text posts from the weeks before, each seen about 1,000 times, and one seen 250 times
- When they sort by *Below usual*
- Then the post seen 250 times comes first, at 25% of usual
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-04 · happy

- Given posts seen 5, 50, 55 and 5,000 times
- When the person looks at how their reach spreads
- Then the chart's name gives each bar's posts on a scale of tens: 1–9: 1, 10–99: 2, 100–999: 0, 1K–10K: 1
- And *Table* shows the same numbers as a table
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-05 · happy

- Given posts seen 9,000 and 2 times more than a week after they were made, and one seen once 2 days after
- When the person looks at the most and least seen
- Then the post seen 9,000 times leads *Most seen*, and the one seen twice leads *Least seen*
- And the post read 2 days after it was made is in neither: it is still growing
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-06 · invalid

- Given a post X showed 3 days after it was made, among posts with a usual
- When the person opens Reach
- Then the post is marked *Still growing*, and has no share of usual
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-07 · invalid

- Given X sends one post's views as "12a", not a number, and another's as 30
- When the person opens Reach
- Then only the post seen 30 times is listed: a number out of shape is left out, never guessed
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-08 · invalid

- Given only two posts with views, and no earlier ones of their kind
- When the person opens Reach
- Then neither shows a share of usual: a usual needs 15 earlier posts of the same kind
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-09 · cancel

- Given two text posts on Reach
- When the person shows only posts with *A link*
- Then the table says *No posts match.*
- And with *Anything* again, both posts come back
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-10 · invalid

- Given a post with a link to a story, one with two photos, a text post, and one whose only link is to a post on X
- When the person filters by what the posts carry
- Then *A link* shows the first, *Photos or videos* the second, and *Text only* the last two: a link to X isn't a
  link out of X
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-11 · error

- Given X leaves the views out of every post on the person's profile
- When the person opens Reach
- Then it says *No reach to show yet*, and how to get numbers, with no table
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-12 · error

- Given X refuses the profile's posts with its rate limit, and shows its error on the profile
- When the person opens Reach, and asks for 90 days
- Then it still says *No reach to show yet*, and stays usable
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-13 · error

- Given Reach open with nothing to show yet
- When the person opens their profile on X, and X answers 3 seconds late
- Then the post X showed fills the table once X answers, without a reload
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-14 · security

- Given a post whose text is markup, `<img src=x onerror=alert(1)>`, as X sends it escaped
- When the person opens Reach
- Then the text shows as text, and the table has no image in it
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-15 · security

- Given posts with views on Reach
- When the person sorts, changes the period and switches the spread to a table
- Then the page sends no request at all: Reach reads only what Xomoni already keeps on the computer
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-16 · security

- Given a post far below its usual, and one still growing
- When the person sorts by *Below usual*
- Then no word on the page says a post was banned, penalized, suppressed or throttled (ADR-0045)
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-17 · security

- Given X shows, on the person's profile, a post by someone else seen 9,999 times
- When the person opens Reach
- Then only their own post is listed, and the other's number appears nowhere
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-18 · empty

- Given a fresh install, with the X window open
- When the person opens Reach
- Then it says *No reach to show yet*, and *Import your X analytics export (needs X Premium), or open your profile on
  X so Xomoni sees your views.*
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-19 · empty

- Given the person's only posts with views are 45 and 200 days old
- When they open Reach
- Then the last 30 days show nothing yet
- And *90 days* shows the first, with *Plus · preview*, and *Everything* both
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-20 · cancel

- Given Reach showing *Everything*, with a post from 10 days ago and one from 45
- When the person goes back to *30 days*
- Then only the recent post is listed, and the *Plus · preview* badge is gone
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-21 · cancel

- Given 30 posts on Reach, on the table's page 2
- When the person changes the order to *Most seen*
- Then the table starts again at page 1 of 2
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-22 · a11y

- Given two posts on Reach
- When the person reaches *Most seen* with Tab only and presses Enter
- Then the button is pressed, the most seen post comes first, and the order's buttons are a group named *Sort by*
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-23 · a11y

- Given Reach with a full table, in light mode
- When axe-core checks the page, and again with the spread as a table
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-24 · a11y

- Given Reach with a full table, in dark mode
- When axe-core checks the page, and again with the spread as a table
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-25 · browser

- Given a post on Reach
- When the dashboard is as wide as a phone, 390 pixels
- Then the table scrolls inside its card, and the page itself doesn't scroll sideways
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-26 · persistence

- Given two posts on Reach
- When the person reloads the dashboard
- Then Reach still lists both: what Xomoni keeps stays on the computer
- Test: apps/web/e2e/extension/reach.spec.ts

## S429-27 · empty

- Given Xomoni doesn't know an X account yet
- When the person opens Reach's address
- Then the dashboard asks for the X window first, and Reach opens once it is open
- Test: apps/web/e2e/extension/reach.spec.ts
