---
task: 429
title: Reach: each post's reach, its usual, how it spreads, comparisons, X's labels and suspected posts
feature: reach-diagnosis
---

# Reach

The Reach page (#429, [ADR-0045](../adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md)) shows how many times X says each of the person's posts and replies was seen, from X's own numbers, against their usual: the median of their posts of the same kind (text, a link, photos or videos, a reply) in the 8 weeks before, once there are 15 of them. A post read before it was 7 days old is still growing, and isn't compared. The numbers here are the views X shows on the person's own profile, which Xomoni keeps as it already does for the daily numbers (#249); X's analytics export joins them once the vault reads it (#425). Xomoni never asks X for anything to measure reach. The last 30 days are free; longer periods are part of Plus, open as a preview until sales start (ADR-0042).

Under *Comparisons* (S429-31 on), three cards compare the person's own posts (not replies) read at least 7 days after they were made: posts with a link out of X against posts without, posts with photos or videos against text only, and posts with Premium against the 8 weeks before it (leaving out the 7 days after it began). Each says one of five fixed words (*Clearly lower*, *Clearly higher*, *No difference*, *Maybe*, *Not enough data*), each side's size and median, and, with 15 posts a side, the ratio and its 95% interval from 2,000 resamples, the same every time for the same posts. *How this is computed* says how, and what can mislead it: when the posts were made, their subjects, the followers, and their ages. A table gives the usual reach by day of the week and time of day. They show what goes together, never why, and are part of Plus, in preview. Until the vault keeps when the account got Premium (#425), the Premium card says it can't compare yet; the date the person gives comes with it.

*X's labels* (S429-61 on) shows each month of X's *Under the hood* report the person imported: each label with X's own name, the posts it touched or that it was on the account, and what it means when a public source says so (with the source and the day it was checked), X's own words from the file, or that X didn't explain it. A month without labels says *No labels that month*, never "clean"; a month the account wasn't eligible for says so. *Suspected posts* (S429-81 on, Plus, in preview) names, for each label X applied to n posts in a month, that month's posts furthest below their usual, under half of it, at most min(3n, 10), each with its reasons, under a box that can't be hidden: *This is a guess. X doesn't say which posts got a label.* The person can dismiss a guess; nothing leads to a cleanup. Until the Vault page is on main (#425), these tests put the months Xomoni keeps straight into its database, as an import of X's file leaves them.

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
- Then it says *No reach to show yet*, and *Reach's numbers come from the views X shows on your own posts and replies.
  Open your profile on X, and Xomoni keeps the views it shows. More sources are coming.*
- And it doesn't offer X's analytics export, which this version can't read, nor ask for X Premium
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

## S429-31 · happy

- Given 30 posts with a link, each seen about 500 times, and 30 text posts seen about 1,000 times
- When the person opens Reach
- Then the links card says *Clearly lower*, 30 posts on each side, that posts with a link were seen about half as much
  as posts without, and the 95% interval
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-32 · happy

- Given 20 posts with photos seen about 2,000 times, and 20 text posts seen about 1,000
- When the person opens Reach
- Then the photos card says *Clearly higher*
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-33 · happy

- Given 60 posts with a link and 60 without, seen alike
- When the person opens Reach
- Then the links card says *No difference*
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-34 · happy

- Given the links card with its verdict
- When the person opens *How this is computed*
- Then it says the interval comes from 2,000 resamples, that it shows what goes together and not why, and what can
  mislead it: when the posts were made, and their subjects, which Xomoni doesn't read
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-35 · invalid

- Given 14 posts with a link and 30 without
- When the person opens Reach
- Then the links card says *Not enough data*, 14 posts, and that each side needs at least 15, with no interval
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-36 · invalid

- Given 20 posts with a link that X showed before they were 7 days old, and 30 text posts
- When the person opens Reach
- Then the links card counts 0 posts with a link, and says *Not enough data*
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-37 · invalid

- Given 20 replies with a link, and 30 text posts
- When the person opens Reach
- Then the links card says *Not enough data*: replies are left out of the comparisons
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-38 · invalid

- Given 20 posts whose only link is to a post on X, and 20 text posts
- When the person opens Reach
- Then all 40 count as posts without a link, and the card says *Not enough data*
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-39 · empty

- Given Xomoni hasn't seen when the account got Premium
- When the person opens Reach
- Then the Premium card says *Not enough data*, and that Xomoni doesn't know yet when they got Premium, so it can't
  compare
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-40 · error

- Given X left the views out of the 60 posts, and showed one other post's views
- When the person opens Reach
- Then every comparison says *Not enough data*: none is made from guesses
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-41 · error

- Given 20 posts with a link, 6 of which X sent with views that aren't a number, and 20 text posts
- When the person opens Reach
- Then the links card counts 14 posts with a link, and says *Not enough data*
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-42 · persistence

- Given the links card with its verdict and interval
- When the person reloads the dashboard
- Then the card says exactly the same: the same posts give the same answer
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-43 · security

- Given posts to compare
- When the person opens Reach and *How this is computed*
- Then the page sends no request at all
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-44 · security

- Given every card open on *How this is computed*
- When the person reads the page
- Then no word says a post was banned, penalized, suppressed or throttled (ADR-0045)
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-45 · happy

- Given posts to compare
- When the person opens Reach
- Then *Comparisons* is marked *Plus · preview*, and the cards are shown
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-46 · empty

- Given a single post with views
- When the person opens Reach
- Then every card says *Not enough data*, and so does the day table
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-47 · happy

- Given 16 posts with views
- When the person reads *By day and time*
- Then the time of day table has its four parts of the day, and counts the 16 posts between them
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-48 · cancel

- Given *How this is computed* open on the links card
- When the person presses it again
- Then it folds away
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-49 · cancel

- Given 20 posts with a link from 40 to 59 days ago, and 20 recent text posts
- When the person picks *90 days*, then *30 days* again
- Then the links card goes from *Not enough data* to *Clearly lower*, and back
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-50 · a11y

- Given the links card
- When the person reaches *How this is computed* with Tab only and presses Enter
- Then it opens, and says how the comparison is made
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-51 · a11y

- Given every card open, in dark mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-52 · browser

- Given the comparisons
- When the dashboard is as wide as a phone, 390 pixels
- Then the cards stack, and the page doesn't scroll sideways
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-53 · error

- Given 30 text posts, and the links card saying *Not enough data*
- When X answers the profile 3 seconds late, with 30 more posts with a link
- Then the links card says *Clearly lower* once X answers, without a reload
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-54 · security

- Given 30 posts with a link by someone else, shown on the person's profile, and 30 of the person's text posts
- When the person opens Reach
- Then the links card counts 0 posts with a link: someone else's posts never count
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-55 · a11y

- Given every card open, in light mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach-comparisons.spec.ts

## S429-61 · happy

- Given a month of X's report with SPAM_HIGH_RECALL on 2 of 40 posts
- When the person opens Reach
- Then X's labels show the month, the label by X's name, 2 of 40, and what it means, with its source opening in a new tab
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-62 · happy

- Given X's reports for August and September
- When the person opens Reach
- Then both months show, September first, each with its count
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-63 · happy

- Given a month with a label on the account
- When the person reads it
- Then the label says it was on the account, with no post count
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-64 · happy

- Given a month whose report lists orders from a government
- When the person reads it
- Then the orders are listed by country
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-65 · invalid

- Given a label no public source explains
- When the person reads it
- Then it shows with X's name, and that X didn't explain this label
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-66 · invalid

- Given a label X explained in its own file
- When the person reads it
- Then X's own words show, marked as X's
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-67 · invalid

- Given a month the account wasn't eligible for
- When the person reads it
- Then it says X says the account wasn't eligible, with X's condition of 10 or more posts in the month before
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-68 · empty

- Given no report imported yet
- When the person opens Reach
- Then X's labels say there is no Under the hood report yet, and the three steps to get one, with X's page as a link
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-69 · empty

- Given a month in which X applied no label to 40 posts
- When the person reads it
- Then it says No labels that month, across 40 posts, and nowhere that the account is clean
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-70 · security

- Given a label whose name is markup
- When the person reads it
- Then the name shows as text, and nothing of it runs
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-71 · security

- Given a month of labels
- When the person opens Reach again
- Then the page sends no request at all
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-72 · security

- Given labels X explained and labels it didn't, and a month not eligible
- When the person reads them
- Then no word of Xomoni's says a post was banned, penalized, suppressed or throttled
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-73 · security

- Given a month of another X account's kept on this computer
- When the person opens Reach for their own account
- Then only their own month shows
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-74 · error

- Given a month damaged on the computer, and a sound one
- When the person opens Reach
- Then the damaged month is left out, and the sound one shows
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-75 · error

- Given no report yet, and X's Under the hood page out of reach
- When the person follows the link to it
- Then it fails in its own tab, and Reach stays as it was
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-76 · error

- Given a report that left the month's post count out
- When the person reads its label
- Then the label shows its own count alone
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-77 · a11y

- Given a month of labels
- When the person reads it with a screen reader, or tabs to its source
- Then the month is a region named by the month, its labels a table named for it, and the source's link is reached with Tab
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-78 · a11y

- Given months with labels and a month not eligible, in dark mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-79 · browser

- Given a month of labels
- When the dashboard is as wide as a phone
- Then the table stays in its card, and the page doesn't scroll sideways
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-80 · persistence

- Given a month of labels
- When the person reloads the dashboard
- Then the month is still there
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-81 · happy

- Given a month X labelled, with one of its posts seen 100 times against a usual of about 1,000
- When the person opens Reach
- Then Suspected posts shows the guess box and that post, with why it was picked and a low or medium confidence
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-82 · happy

- Given a guess
- When the person looks for the post
- Then the guess links to the post on X
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-83 · happy

- Given a label on 1 post, and five posts far below usual that month
- When the person opens Reach
- Then it says X says 1 post, and names at most three guesses
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-84 · happy

- Given two labels in one month
- When the person opens Reach
- Then each label gets its own guesses
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-85 · invalid

- Given the month's lowest post seen a bit over half its usual
- When the person opens Reach
- Then no post is a guess, and it says no post was seen less than half as much as usual
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-86 · invalid

- Given a post X showed 3 days after it was made, seen 10 times
- When the person opens Reach
- Then it is never a guess: it may still grow
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-87 · invalid

- Given a month whose only label was on the account
- When the person opens Reach
- Then no post is named, and it says X applied the label to the account, not to posts
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-88 · empty

- Given posts with views, and no report imported
- When the person opens Reach
- Then no post is named, and it says Xomoni never guesses without X's report, under the guess box
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-89 · empty

- Given a report with no label on posts
- When the person opens Reach
- Then it says there is nothing to guess
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-90 · error

- Given a labelled month whose posts X showed without views
- When the person opens Reach, with everything
- Then it says Xomoni has no impressions or views for this month's posts
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-91 · error

- Given X refused the profile with its rate limit, and a labelled month imported
- When the person opens Reach
- Then no guess is made, and X's labels still show
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-92 · error

- Given Reach open on a labelled month
- When X answers the profile 3 seconds late with a post far below usual
- Then the guess appears once X answers, without a reload
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-93 · security

- Given a guess
- When the person dismisses it
- Then the guess box stays: nothing hides it
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-94 · security

- Given guesses
- When the person reads them and dismisses one
- Then nothing in them leads to a cleanup, their only links go to X, and dismissing sends no request
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-95 · security

- Given someone else's post seen 5 times, shown on the person's profile
- When the person opens Reach
- Then it is never a guess
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-96 · cancel

- Given three guesses for a label on 1 post, and a fourth post as low
- When the person dismisses one
- Then two are left, and the fourth doesn't take its place
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-97 · cancel

- Given a dismissed guess
- When the person presses Show the 1 dismissed again
- Then the guess comes back
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-98 · a11y

- Given a guess
- When the person reaches Dismiss with Tab only and presses Enter
- Then the guess is dismissed
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-99 · a11y

- Given guesses, in light mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-100 · a11y

- Given guesses, in dark mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-101 · persistence

- Given a dismissed guess
- When the person reloads the dashboard
- Then it stays dismissed
- Test: apps/web/e2e/extension/reach-labels.spec.ts

## S429-102 · browser

- Given a guess
- When the dashboard is as wide as a phone
- Then the guesses fit, and the page doesn't scroll sideways
- Test: apps/web/e2e/extension/reach-labels.spec.ts
