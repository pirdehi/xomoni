---
task: 15
title: Find old posts that X search no longer shows
feature: beyond-profile-limit
---

# Reaches past the ~3,200 profile limit

X's profile shows only an account's newest ~3,200 posts (PLAYBOOK E1), and X search leaves out old posts nobody liked (E2). A cleanup reaches past both (#15). For an account X counts above the profile's limit, it searches X for the person's posts (`from:you until:date`, with `since:` within a date range), never trusting a profile that can't hold them all. For a smaller one, it sweeps the profile first. X's archive brings in what neither shows. When search shows none of what the copy still has (C6), or X counts many more posts than Xomoni knows of, the job says so and finishes with a warning, never as a plain *Completed*. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`), which X counts at 5,000 posts, replies and reposts here unless a scenario says otherwise. X's search page (`apps/web/e2e/fixtures/x/search.html`) asks X for `SearchTimeline`, as X's web app does. Unless a scenario says otherwise, X answers with twelve posts by the other made-up account, `@fixture_friend`. Archives are made in the test (`apps/web/e2e/support/x-archive.ts`). Once the person has browsed their profile, the copy has 5 posts, 2 of them before Jan 1, 2021.

Each test is a fresh install, with active hours off, so a job may run at any time of day. A new account's first delete comes 320 to 480 seconds after its first page load, so no test waits for one. They prove where a job looks, what it takes up there, and what it says when X can't show everything. The engine's side is proven by `apps/extension/tests/coverage.test.ts`, `parsers.test.ts` (the URLs, the limit at 3,199 and 3,200) and `sweep-retry.test.ts`. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep "@task-15(\s|$)"
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S15-01 · happy

- Given an account X counts at 5,000 posts, more than its profile can show, and a cleanup of its posts before
  Jan 1, 2021
- When the person starts it
- Then the job reads X's Home, then searches X: from:xomoni_fixture until:<the day after> -filter:replies, the Latest
  results
- And it never loads the profile, which can't show the oldest posts
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-02 · happy

- Given the same account, and a cleanup of its replies before Jan 1, 2021
- When the person starts it
- Then the job searches X for the replies apart: from:xomoni_fixture until:<the day after> filter:replies
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-03 · happy

- Given a cleanup of posts before Jan 1, 2021 within a date range starting Jan 1, 2020
- When the person starts it
- Then X is searched with since: the day before the range starts, and until: the day after it ends, as X's search
  days are whole UTC days
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-04 · happy

- Given X's search shows a post of the person's from Jun 1, 2016, which their profile no longer shows and their copy
  doesn't have
- When a cleanup of posts before Jan 1, 2021 searches X
- Then the post joins the copy, and the job takes it up: its card goes from 2 to 3 remaining, and it waits to remove
  it at a new account's pace
- And Cleanup's preview has it too, as Jun 1, 2016
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-05 · happy

- Given a person whose X archive holds 4,000 posts, more than their profile could ever show
- When they import it in the Library and open Cleanup
- Then Cleanup has Posts 4,000 in your copy, previews them, the last line "and 3,996 more"
- And no warning about a missing archive is left
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-06 · happy

- Given an account X counts at 8 posts, well under the profile's limit
- When the person starts a cleanup of its posts before Jan 1, 2021
- Then the job sweeps the profile first, since search leaves out old posts without likes, takes up the posts there and
  waits to remove the first, with nothing searched yet
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-07 · invalid

- Given an account X counts at exactly 3,200 posts
- When the person starts a cleanup of its posts
- Then the job searches X and never loads the profile: at the limit, the profile may not hold them all
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-08 · invalid

- Given a copy made from X's archive alone: Xomoni never saw the profile, so it doesn't know how many posts X counts
- When the person starts a cleanup of their posts before Jan 1, 2021
- Then the job searches X, never a profile it can't judge
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-09 · invalid

- Given X's search, whose until: is a whole day later than the date, shows a post of the person's from Jan 1, 2021
  itself
- When a cleanup of posts before Jan 1, 2021 searches X
- Then the post is never taken up: the job keeps its 2 remaining, whatever search's wider day shows
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-10 · error

- Given X refuses the job's search with its rate limit (429)
- When the job loads the search
- Then it waits for X's reset, and a little more: X rate limit — waiting for the window to reset, with more than 10
  minutes to go, to load the same search again
- And nothing is counted as failed, with the 2 posts still to go
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-11 · error

- Given X is over capacity (503) when the job loads the search
- When X's page shows its error
- Then the job waits for X, and tries again: X is having trouble — trying again in about 1 min
- And nothing is counted as failed, as its log says: X answered HTTP 503 for this page. Waiting; nothing is counted
  as failed
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-12 · error

- Given X's search shows nothing, while the copy still has 2 posts before Jan 1, 2021, and the deep clean is off
- When a cleanup of them searches X
- Then the job says X search showed none of the 2 matching posts in your copy: X may be hiding this account from
  search, or the posts are too old for search to show. Turn on the deep clean to reach them.
- And it finishes with a warning, never Completed, with 0 removed (PLAYBOOK C6)
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-13 · error

- Given X counts 5,000 posts, and Xomoni knows a handful
- When a cleanup ends
- Then it says X shows about 4,99… more posts, replies and reposts than Xomoni knows about. Search can’t find old posts
  without likes; import your archive to reach them., and finishes with a warning (PLAYBOOK E2)
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-14 · security

- Given X's search results show twelve posts by another account, @fixture_friend
- When a cleanup of the person's posts searches X
- Then none of them is taken up, nor added to the person's copy: the job keeps its 2 remaining, and Cleanup its 5
  posts
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-15 · security

- Given a cleanup of the person's posts
- When it searches X, before its first removal is due
- Then every search names the person's own handle, from:xomoni_fixture, and nothing but reads reaches X: no delete,
  like, unlike, repost or post
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-16 · security

- Given the Library, for an account X counts at 5,000 posts
- When the person reads Full history (X search) from Read one part
- Then it searches X half a year at a time, the newest half year first, for the person's own posts only, and only reads
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-17 · empty

- Given a person with no X archive imported
- When they open Cleanup
- Then it warns No archive imported: old posts can be missed, since X search doesn’t show posts older than about a week
  that have no likes, and the profile shows only the newest ~3,200
- And its Get my archive opens the Library
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-18 · empty

- Given an account X counts at 5,000 posts, of which the person's copy has a handful
- When they open the Library
- Then it says About 0% of the 5,000 posts, replies and reposts X counts for @xomoni_fixture
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-19 · cancel

- Given a cleanup whose search added an old post to the copy, 3 to remove
- When the person cancels it
- Then it ends Cancelled with 0 removed, the X window loads nothing more, and the post search found stays in the copy
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-20 · cancel

- Given Cleanup's Advanced: how Xomoni finds them, which says searching X reaches far beyond the ~3,200 the profile
  shows
- When the person turns Sweep X search off
- Then it says Xomoni visits each known one., and Review no longer says searching X may find more
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-21 · a11y

- Given a person using only the keyboard, on Cleanup
- When they unfold Advanced: how Xomoni finds them with Enter, and turn off both ways with Space
- Then each switch follows, and the page says Neither way is on: turn one on to start.
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-22 · a11y

- Given a cleanup that finished with a warning, search having shown none of its posts
- When axe checks its card and its log
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-23 · browser

- Given the system in dark mode
- When the person opens the Library's count of X's posts, and Cleanup's Advanced
- Then neither has a serious or critical violation (and Edge, as CI's e2e-edge runs every scenario)
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts

## S15-24 · persistence

- Given a post search added to the copy during a cleanup
- When the person reloads the dashboard
- Then Cleanup still has it, and previews it
- Test: apps/web/e2e/extension/beyond-profile-limit.spec.ts
