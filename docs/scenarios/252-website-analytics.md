---
task: 252
title: Overview, Audience, Content and Engagement on xomoni.com
feature: website-analytics
---

# Overview, Audience, Content and Engagement

The dashboard's numbers on xomoni.com (#252, #253, #254, #255): Overview's figures, with followers over time and what was published; Audience (followers and following, gained and lost each day, milestones); Content (each type published, by day and by weekday); and Engagement (what the posts received, views and the rate). Each figure is set against the period before. The charts answer the pointer and the keyboard, and each shows as a table. What was received is marked as an estimate, with how many sightings of the person's posts it rests on. Everything is made of the daily numbers the person chose to show ([ADR-0026](../adr/0026-daily-numbers-in-the-cloud.md)): counts per day, never a post, a reply or a name. Turning the numbers on and off (#250), and the dashboard's frame with its places and pickers (#245), have scenarios of their own. Written for #345, the features shipped before the scenarios gate.

Writing them found three faults in the charts' tables and tooltips, fixed with them (#345): the engagement rate over time was rounded to whole numbers in its tooltip, its table and its axis, so 1.1 and 1.4 both read 1 (S252-12); over a long period a table of weeks headed its first column *Day* (S252-11), and the table of followers gained and lost dropped the + of a gain (S252-07); and a long table couldn't be scrolled from the keyboard, a serious accessibility fault (S252-28, S252-29).

The tests run xomoni.com on the local Supabase stack, with its real Auth, database and Realtime. A test's account gets days stored as Xomoni would report them (`apps/web/e2e/support/admin.ts`), on the made-up `@ada_x` and `@bob_x`. Days are counted back from today, so every run has the same shape. Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-252
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S252-01 · happy

- Given 125 followers yesterday and 110 five days ago, 100 forty days ago, and what was published and received on
  those days, with a cleanup that removed 7
- When the person opens Overview, over the last 30 days
- Then each figure is set against the 30 days before: Followers 125, +25 (+25%); Posts 6, +5 (+500%); Likes received
  30, +26 (+650%); Replies received 6, +5 (+500%); Engagement rate 3.8%, −1.2 pt
- And Removed by Xomoni reads 7, by jobs in this period
- And the followers chart is named for its last count, and the published chart for its total
- And a line says likes, replies and views received are estimates, from 18 sightings of the person's posts
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-02 · happy

- Given nine days of followers going 240, 260, 255, 252 and 270, and accounts followed up to 104
- When the person opens Audience
- Then Followers reads 270, +30 in the last 30 days; Gained 38, most on the day of +20; Lost 8, most on the day of −5;
  and 2.6 followers per account followed, of 104
- And Followers, Gained and lost each day, and Following are charted, the last named for its last count
- And Milestones lists 250 followers on the day it was crossed, with Next: 500, 230 to go
- And Who followed or unfollowed you says X shows no one's name in the numbers, and offers Open in Xomoni
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-03 · happy

- Given posts, replies, reposts and quotes on two days of this month, and a post and a repost the month before
- When the person opens Content
- Then each type is set against the 30 days before: Posts 2, +1 (+100%); Replies 5, +5, with no percentage of
  nothing; Reposts 1, ±0 (±0%); Quotes 1, +1
- And Published by type stacks the four, 9 in all, and its table has a column per type and the total
- And When you publish names the weekday most is published, each weekday with its average
- And From your posts, in Xomoni lists what needs the posts themselves
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-04 · happy

- Given what the person's posts received on two days of this month, and on a day of the month before
- When the person opens Engagement
- Then it says these are estimates, over 16 sightings in this period, since X gives totals per post
- And Likes received 40, +20 (+100%); Replies received 6, +6; Reposts and quotes 5, +5; Views 3,000, +2,000
  (+200%); Engagement rate 1.7%, −0.3 pt; and 75% seen with at least one like, 3 of them replies
- And Received each day has a legend of its four types, and a table with each and the total
- And Your most-liked replies says the replies never leave the computer
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-05 · happy

- Given Overview with followers and posts on two days of the month
- When the person points at the followers line, then at a column of the published chart
- Then a tooltip shows the day nearest the pointer that has a count, and its value: 110 at the left, 125 at the right
- And over a column, that day and what was published on it
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-06 · happy

- Given numbers for @ada_x and @bob_x, and a job reported for each, so the account picker lists them
- When the person picks Last 7 days, then @ada_x
- Then the figures are set against the 7 days before: 170 followers, +70 (+70%), and 8 posts, +6 (+300%)
- And with @ada_x alone, 120 followers, +20 (+20%), and 1 post, −1 (−50%)
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-07 · invalid

- Given followers counted on three days, with two days between them that have none
- When the person reads the followers line by keyboard, and both charts as tables
- Then the arrows go from the last count to the one before the gap, past the days without one
- And the table lists only the days with a count
- And the gained and lost table puts the whole change since the last count on the day after the gap, +6, each gain
  with its sign
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-08 · invalid

- Given two accounts, and a day on which only one of them has a follower count
- When the person opens Audience for all accounts
- Then that day is left out of the followers line, rather than drawn as a drop to one account's count
- And nothing is counted as lost: 153 followers, +3
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-09 · invalid

- Given numbers from yesterday only
- When the person opens Content, then picks All time
- Then each figure says nothing to compare yet, rather than a change from zero
- And over all time, each says all time
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-10 · invalid

- Given likes received but no views seen
- When the person opens Engagement
- Then the engagement rate reads —, No views seen yet, and its chart says No views seen in this period yet
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-11 · invalid

- Given 5 posts ten days ago
- When the person looks at Overview over the last 90 days
- Then the published chart counts by week: the arrows show 5, Week of that Monday
- And its table's first column says Week of, not Day
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-12 · invalid

- Given an engagement rate of 1.1 one day and 1.7 the next
- When the person reads the engagement rate over time, by keyboard and as a table
- Then the chart is named 1.7%, the tooltip shows 1.1%, and the table 1.1% and 1.7%: no rate is rounded to a whole
  number
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-13 · invalid

- Given 999,000 followers three days ago, 1,234,567 yesterday, and no account followed
- When the person opens Audience
- Then Followers reads 1.2M, +235.6K, and the ratio —, You follow 0
- And Milestones lists 1M followers, with no next one past the last
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-14 · error

- Given Content open with 2 posts, and Xomoni sending a new day of 5
- When the page reads the numbers again as its tab comes back, and Supabase fails that read
- Then the page keeps the numbers it shows, 2 posts, and blanks nothing
- And the next read that works shows the new day: 7 posts
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-15 · error

- Given the live feed down
- When the person opens Engagement
- Then the page says Connecting…, shows the figures read for it, and its charts answer the keyboard
- And once the feed is back, the page says Live and reads again: a day sent meanwhile shows without a reload
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-16 · error

- Given Supabase failing to read whether the numbers are shown
- When the person opens Overview, Audience and Engagement
- Then each still shows the numbers already sent, with their charts
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-17 · error

- Given Supabase failing the server's read of the daily numbers for the page's first paint
- When the person opens Overview
- Then the page opens without the numbers, and the browser's own read brings them once the live feed connects
- Manual: the first read runs on xomoni.com's server, which a browser test's routes can't reach;
  `application/load-dashboard.test.ts` proves the page loads without the numbers, and S252-15 the read on connecting

## S252-18 · security

- Given another person's account with its own numbers
- When the person signs in and the page reads the daily numbers
- Then the database answers with the person's own rows only, and no figure of the other account shows
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-19 · security

- Given another person's numbers on @ada_x
- When the person opens Audience, Content, Engagement and Overview with account=ada_x in the address
- Then each says it has no numbers in this period, and draws no chart: nothing of @ada_x
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-20 · security

- Given someone signed out
- When they open /dashboard/audience, /dashboard/content or /dashboard/engagement, or ask the database for daily
  numbers themselves
- Then each place sends them to sign in, showing no figure, and the database refuses them (401)
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-21 · security

- Given the person's numbers on
- When they open the four places
- Then each row the browser receives holds only the counts ADR-0026 allows, the day, the handle and the person's own
  id: no text, no post or user id
- And the pages ask nothing of any host but xomoni.com and its database, and link to nothing on X
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-22 · empty

- Given an account whose numbers are off
- When the person opens Audience, Content and Engagement over the last 7 days
- Then each says what shows there once Show my numbers on xomoni.com is on, with Turn them on in Overview, and draws
  no chart
- And the link goes to Overview with the same period, where the switch is off
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-23 · empty

- Given numbers on, but the only day 200 days ago
- When the person opens Overview, then each place
- Then Overview's figures read —, No numbers in this period, with no chart
- And each place says No numbers in this period yet, they come with Xomoni's next report, with no link to turn them
  on
- And over all time, Content finds the day's 3 posts
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-24 · empty

- Given a single day with a follower count
- When the person opens Audience
- Then Followers says No change to show yet, Gained and Lost 0 with none in this period, and the ratio 2.0
- And Gained and lost each day says it takes two days with a follower count to show a change
- And Milestones says none in this period, Next: 500, 200 to go
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-25 · cancel

- Given a tooltip on the followers line, from the arrows or the pointer
- When the person presses Escape, Tab, or moves the pointer off the chart
- Then the tooltip goes away, and after Escape the focus stays on the chart
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-26 · cancel

- Given Audience's followers chart shown as a table
- When the person presses Show as chart
- Then the chart comes back, Show as table is no longer pressed, and the other charts never changed
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-27 · cancel

- Given Engagement, a table open, and no Xomoni in this browser
- When the person presses Open in Xomoni, then Escape in the dialog that says Xomoni isn't installed
- Then the dialog closes, and Engagement is as it was, its table still open
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-28 · a11y

- Given Overview with followers on two days
- When the person uses only the keyboard: Tab to the followers chart, the arrows, Tab and Enter
- Then the chart takes the focus with its name and last count, and the arrows go day by day, stopping at the last
- And Enter on Show as table shows the table with its column headers, the focus kept on Show as chart
- And the table's box takes the focus too, so a long table scrolls by keyboard
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-29 · a11y

- Given a month of numbers, and every chart of the four places shown as a table
- When each place is checked with axe, in light and in dark mode
- Then there is no serious or critical violation, long tables that scroll included
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-30 · browser

- Given a phone's screen, 390 pixels wide
- When the person opens Engagement
- Then the figures go two by two, each chart fits the screen, and a table opens without the page scrolling sideways
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-31 · persistence

- Given Audience over the last 90 days, the followers chart shown as a table
- When the person reloads, then opens the same address in a second tab
- Then both show the same period and figures, and the table is back to its chart
- Test: apps/web/e2e/website-analytics.spec.ts

## S252-32 · persistence

- Given Content with the person's numbers
- When they sign out and sign in again
- Then the same figures and chart show: the numbers live with the account, not in the browser
- Test: apps/web/e2e/website-analytics.spec.ts
