---
task: 158
title: Watch X search
feature: watch
---

# Watch X search

Watch follows up to five phrases or #hashtags in X's search (#158, [ADR-0021](../adr/0021-watch-x-search-read-only.md)): each saved in a tab of its own, searched on X's own *Latest* page in the X window about once a minute, within Xomoni's read limits (one fifth of X's, ADR-0012), and the 10 newest posts shown, each linked to X. It only reads: nothing is liked, replied to, reposted or posted, and it never runs beside another job. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X. X's search page is `apps/web/e2e/fixtures/x/search.html`: as X's web app does, it asks X's GraphQL API for the search (`SearchTimeline`) and draws what X answered. Its answer is `graphql/SearchTimeline.json`, 12 made-up posts by the made-up `@fixture_friend`, unless a test serves another: none, X over capacity, X's rate limit, or a fifth of X's search window used. The account is the made-up `@xomoni_fixture`, which X shows as Premium (`xHistory: 'long'`), so a check comes about half a minute after *Start watching*, at the reading pace of a new account's first day; the scenarios that need one wait for it. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-158
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S158-01 · happy

- Given a person on Watch, with #xomoni saved in its first tab, which takes the query's name
- When they press Start watching and accept the risks
- Then the X window loads X's Latest search for it, x.com/search?q=%23xomoni&src=typed_query&f=live, once
- And the tab says Checked just now · next check in about … s or when the read limits allow, and lists the 10 newest
  of the 12 posts X shows, newest first, each with its author, Fixture Friend @fixture_friend, its date and its text as
  X shows it, and Open on X to the post on x.com
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-02 · happy

- Given #xomoni saved in Tab 1 and "made-up post" from:fixture_friend in Tab 2
- When the person starts watching
- Then both are searched, one after the other, and each tab shows its own 10 newest posts
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-03 · happy

- Given Watch running, the tab showing #xomoni's posts
- When the person changes the tab's query to #fixtures and saves it
- Then the posts for #xomoni go, and the tab says Searching soon…
- And the next search is for #fixtures, whose posts then show
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-04 · happy

- Given a query with a phrase and X's search operators, "exact phrase" from:fixture_friend -filter:replies
- When the person saves it and starts watching
- Then the tab is named by it, and X's search gets it as typed, on the Latest page (f=live)
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-05 · invalid

- Given a query typed with spaces around it and between its words, "   #xomoni      news   "
- When the person saves it
- Then it is saved tidied, #xomoni news, the tab is named so, and Save is off
- And typing the same query with a space at its end leaves Save off: nothing changed
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-06 · invalid

- Given the query field
- When the person types 130 characters
- Then the field keeps 100, the most a query may have
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-07 · invalid

- Given Watch's two first tabs, which can't be removed
- When the person adds tabs until there are five
- Then Add tab is off at five, and each added tab, chosen as it is added, can be removed
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-08 · invalid

- Given no query saved
- When the person looks at Start watching, then types #xomoni without saving it
- Then Start watching is off, with Save a phrase or #hashtag first., and stays off for a query not saved
- And once they save it, Start watching is on
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-09 · error

- Given X's search showing nothing for #nothinghere
- When the person watches it
- Then after the check, the tab says No posts yet: X’s search shows nothing for this yet.
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-10 · error

- Given X answering its search with a 503, over capacity
- When the person watches #xomoni
- Then the job tries again: its card under Activity says X is having trouble — trying again in about 1 min, and counts
  nothing as failed
- And nothing is stored: the tab still says Searching soon…, with no posts
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-11 · error

- Given X refusing the search for its rate limit (a 429), resetting in 12 minutes
- When the person watches #xomoni
- Then the job waits for X's reset: its card under Activity says X rate limit — waiting for the window to reset, with
  more than 10 minutes to go
- And nothing is stored: the tab still says Searching soon…
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-12 · security

- Given Watch running on #xomoni, its 10 posts shown
- When the person looks at what reached X
- Then only pages and searches were read: no request but a read, and no like, repost, reply or post sent
- And no post's Like on X's page was pressed, and the dashboard offers no Like, Reply or Repost
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-13 · security

- Given X's answers saying 60 of its 300 searches in 15 minutes are used, a fifth, the window resetting in 12 minutes
- When the person watches #xomoni, and its first check shows its posts
- Then Watch waits for X's reset before searching again: its card says Search: one fifth of X’s live limit used —
  waiting for X’s window to reset, with more than 10 minutes to go
- And X was asked for the search once
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-14 · security

- Given a post whose text is HTML, an image that would load from another site and run a script, as X sends it escaped
- When it is among the posts Watch shows
- Then its text shows as written, as text: no image is made, no script runs, and nothing is asked of that site
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-15 · security

- Given a cleanup job running, waiting for its active hours
- When the person opens Watch and saves a query
- Then Watch says Watching waits while another job runs: Xomoni has one X window. Pause that job, or start watching
  once it ends., and Start watching is off
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-16 · empty

- Given a person opening Watch for the first time
- When they look at it
- Then it has two tabs, Tab 1 and Tab 2, each saying Nothing watched in this tab: Type a phrase or #hashtag and save it.,
  with #hashtag as the field's example
- And it says checks share Xomoni’s read limits with cleanups: at most 60 searches every 15 minutes
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-17 · empty

- Given #xomoni saved, and Watch not started
- When the person looks at the tab
- Then it says Not checked yet. Start watching to search X for it., and nothing is searched on X
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-18 · cancel

- Given Watch just started on #xomoni
- When the person presses Pause watching before the first check
- Then Start watching is back, nothing is searched in the time the first check would have taken, and the tab still says
  Not checked yet
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-19 · cancel

- Given #xomoni saved
- When the person presses Start watching, then Not now on the risks
- Then nothing is searched: Start watching is on again, and under Activity the job waits, Ready
- And its Start asks for the risks again, as Cleanup's jobs do
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-20 · cancel

- Given a third tab the person added, with #gone saved in it
- When they press Remove tab
- Then the tab and its query are gone, Tab 1 is shown, and with no query left Start watching is off
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-21 · a11y

- Given a person using only the keyboard
- When they Tab to the query field, type #xomoni and press Enter, move between the tabs with the arrow keys, and Tab to
  Start watching, then through the risks
- Then the query is saved, the tabs follow the arrows and Enter, and Watch starts
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-22 · a11y

- Given Watch empty, then with #xomoni's 10 posts
- When axe checks it
- Then neither has a serious accessibility violation
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-23 · browser

- Given a browser set to dark mode
- When the person watches #xomoni and its posts show
- Then Watch has no serious accessibility violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-24 · persistence

- Given #xomoni watched, its posts shown, then Watch paused
- When the person reloads the dashboard, and opens Watch in a second tab
- Then both show the #xomoni tab with its 10 posts from the last check, the newest first, with no new search
- Test: apps/web/e2e/extension/watch.spec.ts

## S158-25 · error

- Given #xomoni watched, its 10 posts shown
- When X's search page then draws neither posts nor its empty state, as when X changes its page
- Then the tab says X didn’t show the search results this time; the posts below are from the last check., and keeps the
  10 posts of the last check
- Test: apps/web/e2e/extension/watch.spec.ts
