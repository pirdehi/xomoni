---
task: 185
title: Your copy, in the Library: user scenarios
feature: library
---

# The Library

Everything Xomoni has of an X account, on one page (#185, #203): how much of X's own count the copy holds and where it came from, everything in it to browse and search a page at a time, each item linked to X, and the reads from X that complete it, *Complete my copy* or one part alone. Getting and importing X's archive, which the Library also offers, has its own scenarios (#184), and so has *Download a copy*, with the date range (#97). Written for #345, the features shipped before the scenarios gate. They found a safety bug, fixed on its own (#392, PR #394): a read passed over a page X refused with its rate limit and ended *Completed*, with nothing on the risk ladder. S185-12 proves the read now waits for X's reset on Caution.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`, `apps/web/e2e/fixtures/x/graphql/long-history`), which X counts as 8 posts, replies and reposts. Once the person has browsed their profile's tabs, Xomoni's copy holds:

- 5 posts: Feb 8, 2024 ("Our launch went well…", 3 likes), May 20, 2023 (120 likes), Jun 1, 2021, Mar 14, 2020 and Aug 15, 2019;
- 2 replies: Nov 2, 2020, to the made-up `@fixture_friend`, and Mar 14, 2020, continuing the person's own thread;
- 1 repost, Jan 10, 2022, of a post by `@fixture_friend`;
- 2 likes, of `@fixture_friend`'s posts from May 5, 2019 and Apr 2, 2025.

A read loads X's Home first, then its pages, at the warm-up's pace (12 to 24 seconds a page load for a new Premium account, and up to 90 more one time in twenty), so S185-16, which waits for a read to scroll the profile to its end, takes four to seven minutes; S185-05 reads an empty Likes tab, which has nothing to scroll. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-185
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S185-01 · happy

- Given the person opened the X window and browsed their profile's posts, replies and likes on X
- When they open the Library
- Then Your copy shows a bar: About 100% of the 8 posts, replies and reposts X counts for @xomoni_fixture
- And Browse lists Posts, On X: the 5 posts, newest first, each with its date, text, likes and the source Scan
- And each row's Open on X links to the post on X, x.com/xomoni_fixture/status/<id>
- And the line under the table reads 5 items · page 1 of 1
- Test: apps/web/e2e/extension/library.spec.ts

## S185-02 · happy

- Given the Library with the person's browsed profile
- When they choose Replies, then Reposts, then Likes
- Then the kinds read Replies 2, Reposts 1 and Likes 2, and each lists its own, newest first
- And the repost and the likes show @fixture_friend before the text, whose post it was
- And the repost links to @fixture_friend's post on X, and a like shows — for likes, having no count of its own
- Test: apps/web/e2e/extension/library.spec.ts

## S185-03 · happy

- Given the Library with the person's browsed profile
- When they search LAUNCH, in capitals
- Then only the post with "launch" is listed, and the line under the table reads Filtered · page 1
- And on Likes, @Fixture_Friend, in any case and with its @, finds both likes, and "older" the older one
- Test: apps/web/e2e/extension/library.spec.ts

## S185-04 · happy

- Given the Library with the person's browsed profile, and no read yet
- When they unfold Other ways: read from X, press Complete my copy and accept the risks
- Then Activity opens, with the job Complete my copy running or waiting for its pace
- And back on the Library, Your copy says A read from X is under way, and offers See the read under way instead of
  a second Complete my copy
- And See the read under way opens Activity
- Test: apps/web/e2e/extension/library.spec.ts

## S185-05 · happy

- Given the person browsed only their posts, with no read yet: Recent posts, replies and likes says Not yet
- And X shows no likes on their Likes tab, and active hours are off
- When they pick Read one part › Likes (recent ones), accept the risks, and the read loads X's Home and the Likes tab
- Then the job Read: Likes (recent ones) completes
- And the Library's Recent posts, replies and likes reads Read just now, while Full history still says Not yet
- And Your copy says Last read from X just now, and the button reads Read X again
- Test: apps/web/e2e/extension/library.spec.ts

## S185-06 · happy

- Given the Library with the person's browsed profile, on Posts, On X
- When they press Export JSON
- Then a file named xomoni-posts-present-<today>.json downloads
- And it holds the 5 posts on X, and nothing of another kind or status
- Test: apps/web/e2e/extension/library.spec.ts

## S185-07 · invalid

- Given X shows the person 30 posts on their profile, and they browsed it
- When they open the Library
- Then Browse lists the 25 newest, and reads 30 items · page 1 of 2, with Prev off
- And Next shows the 5 oldest, page 2 of 2, with Next off, and Prev goes back
- And on page 2, choosing another kind and coming back to Posts starts again at page 1
- Test: apps/web/e2e/extension/library.spec.ts

## S185-08 · invalid

- Given the Library with the person's browsed profile
- When they search words no item has
- Then Browse shows Nothing here: No items match your search, and Next is off
- And the same search with spaces around "launch" finds the launch post, the spaces ignored
- And a lone @ is no author: every post is listed, Filtered
- Test: apps/web/e2e/extension/library.spec.ts

## S185-09 · invalid

- Given X counts 40 posts, replies and reposts for the person, and shows one of their posts with no text
- When they browse their profile and open the Library
- Then the bar reads About 20% of the 40 posts, replies and reposts X counts for @xomoni_fixture, its value 20%
- And the post with no text reads (no text recorded), with its date and likes
- Test: apps/web/e2e/extension/library.spec.ts

## S185-10 · invalid

- Given a bookmark from before the Library, to the dashboard's Archive or Inventory page
- When the person opens #/archive, then #/inventory
- Then each opens the Library, marked as the current page in the sidebar
- Test: apps/web/e2e/extension/library.spec.ts

## S185-11 · error

- Given X answers the person's profile but is over capacity for its posts (a 503), and shows its error
- When they open the Library
- Then nothing was added: Posts reads 0, and Browse shows Nothing here
- And the bar, from X's count on the profile, reads About 0% of the 8 posts, replies and reposts X counts
- Test: apps/web/e2e/extension/library.spec.ts

## S185-12 · error

- Given X answers the profile's posts with its rate limit (a 429) that resets in 15 minutes, and active hours are off
- When the person starts Read one part › Posts and reposts, and the read loads the profile
- Then the read waits for X's reset, at least 10 minutes away, and the log says X rate limit hit; resuming at …
- And X's warning is on the risk ladder: Settings shows Risk level 1: Caution
- And the Library says A read from X is under way, and Recent posts, replies and likes still says Not yet
- Test: apps/web/e2e/extension/library.spec.ts

## S185-13 · error

- Given the person signed out of X after browsing their posts
- When they start Read one part › Posts and reposts and accept the risks
- Then a banner says X needs you to continue “Read: Posts and reposts (about the newest 3,200)”, and to log in to X
  as @xomoni_fixture in the X window; the job reads Needs you
- And no page of X is read while signed out
- And once they sign in again, the banner goes by itself
- Test: apps/web/e2e/extension/library.spec.ts

## S185-14 · security

- Given one of the person's posts on X whose text is markup, an image with an onerror script and bold tags
- When they browse their profile and open the Library
- Then the row shows the markup as text, character for character
- And Browse has no image or bold element from it, and its script never ran: the page's title is unchanged
- Test: apps/web/e2e/extension/library.spec.ts

## S185-15 · security

- Given the person's 30 posts in the copy
- When they open the Library, go to page 2, search, change the kind, and press Export JSON
- Then nothing is sent anywhere, to X or to any other host: the list and the file are made on this computer
- Test: apps/web/e2e/extension/library.spec.ts

## S185-16 · security

- Given the person browsed their posts, and active hours are off
- When they read Posts and reposts and the read completes
- Then all it sent X was GET requests, page loads and X's own reads (the profile, UserTweets), never a POST, which
  is how X deletes, unlikes or undoes a repost
- And the X window shows the posts, none of them unliked
- Test: apps/web/e2e/extension/library.spec.ts

## S185-17 · security

- Given the Library with the person's browsed profile
- When they press Open on X on the newest post
- Then the post opens on X in a new tab, at x.com/xomoni_fixture/status/<id>
- And the link opens with noreferrer: X is never told the dashboard's address, and the request carries no referrer
- And the dashboard stays on the Library
- Test: apps/web/e2e/extension/library.spec.ts

## S185-18 · empty

- Given the X window open, and nothing browsed or read yet
- When the person opens the Library
- Then Your copy reads 0 posts, replies and reposts so far, and that X's own count shows up once Xomoni has read the
  profile, with no bar
- And Recent posts, replies and likes, Full history and X's archive each say Not yet
- And it offers Get my archive, and Complete my copy under Other ways
- And Browse shows Nothing here: Import your X archive or complete your copy to fill the library, every kind at 0,
  Export JSON off, and 0 items · page 1 of 1
- Test: apps/web/e2e/extension/library.spec.ts

## S185-19 · empty

- Given a fresh install, before the person has opened the X window
- When they open the Library's address
- Then the dashboard welcomes them and offers Open X window first, with no Library
- And once the X window is open, the same address opens the Library
- Test: apps/web/e2e/extension/library.spec.ts

## S185-20 · empty

- Given the Library with the person's browsed profile, and nothing removed
- When they choose Removed
- Then every kind reads 0, Browse shows Nothing here, and Export JSON is off
- And On X lists the 5 posts again
- Test: apps/web/e2e/extension/library.spec.ts

## S185-21 · cancel

- Given the Library with Other ways unfolded
- When the person opens Read one part, sees its four parts, and presses Escape
- Then the menu closes with the focus back on Read one part
- And no risks are asked, the Library stays open, Activity has no job, and nothing reaches X
- Test: apps/web/e2e/extension/library.spec.ts

## S185-22 · cancel

- Given an X account whose risks the person hasn't accepted yet
- When they press Complete my copy and then Not now on the risks
- Then the risks close, nothing reaches X, and the job waits under Activity, Ready, with Start
- Test: apps/web/e2e/extension/library.spec.ts

## S185-23 · cancel

- Given a search that lists one post
- When the person presses Clear search, the box's ✕
- Then the box is empty, and the 5 posts and 5 items · page 1 of 1 come back
- Test: apps/web/e2e/extension/library.spec.ts

## S185-24 · cancel

- Given a Complete my copy the person left Ready with Not now
- When they cancel it under Activity
- Then it leaves the open jobs and shows Cancelled under All
- And the Library offers Complete my copy again, with Recent posts, replies and likes still Not yet
- Test: apps/web/e2e/extension/library.spec.ts

## S185-25 · a11y

- Given the Library with the person's browsed profile
- When they use only the keyboard: Enter on Other ways, Enter on Read one part, an arrow, Escape, then Tab to the
  search, type, Escape, and Enter on Replies
- Then the reads unfold, the menu opens on its first part and the arrow moves to Replies, and Escape gives the focus
  back to Read one part
- And the search filters as they type, and Escape empties it
- And Replies is chosen, and Tab reaches each row's Open on X
- Test: apps/web/e2e/extension/library.spec.ts

## S185-26 · a11y

- Given the Library, first empty, then with the person's browsed profile
- When it is checked with axe, with the reads unfolded and with Read one part open
- Then there is no serious or critical violation
- And the bar is named with what it measures and gives its value as 100%, the sources are a list named Sources, the
  search and its Clear search button are named, and every row has an Open on X link
- Test: apps/web/e2e/extension/library.spec.ts

## S185-27 · browser

- Given a computer in dark mode
- When the person opens the Library, empty and then with their profile
- Then there is no serious accessibility violation (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/extension/library.spec.ts

## S185-28 · browser

- Given the Library with the person's browsed profile, in a window 760 pixels wide
- When the table is wider than its card
- Then the table scrolls inside its card, and the page itself never scrolls sideways
- And Tab still reaches the first row's Open on X, scrolled into view
- Test: apps/web/e2e/extension/library.spec.ts

## S185-29 · persistence

- Given the Library on Replies, searched for "thread"
- When the person reloads the dashboard
- Then the Library opens again with the whole copy: Posts, On X, no search, the 5 posts, and the bar at 100%
- Test: apps/web/e2e/extension/library.spec.ts

## S185-30 · persistence

- Given the Library open in a second dashboard tab, with nothing in the copy
- When the person browses their posts, then their replies, on X
- Then the second tab lists the 5 posts and Replies 2 as they come, with no reload
- And the first tab's Library shows the same copy
- Test: apps/web/e2e/extension/library.spec.ts
