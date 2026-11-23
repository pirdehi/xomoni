---
task: 391
title: 'Watch: mentions of you and replies to you, with new accounts flagged'
feature: watch-about-you
---

# Watch, about you

Two ready searches on the Watch page for the X account in the X window, *Mentions of you* (`@handle -from:handle`) and
*Replies to you* (`to:handle`), each off until the person turns it on, and one of the five tabs. A post whose author's
account was made in the last 30 days is marked with the account's age, read from X's own search answer and never asked
of X; its tab is marked, and the toolbar's badge counts what the person hasn't seen ([ADR-0021](../adr/0021-watch-x-search-read-only.md)).
Read only, within Xomoni's read limits, and nothing leaves the computer. Proven in the built extension on x.com served
from synthetic fixtures (ADR-0040), with the made-up @xomoni_fixture and made-up authors.

## S391-01 · happy

- Given the Watch page of @xomoni_fixture, with both ready searches off
- When the person turns on Mentions of you
- Then a third tab, Mentions of you, opens selected
- And it says it searches X for @xomoni_fixture -from:xomoni_fixture
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-02 · happy

- Given Mentions of you turned on, and X's search answering with a post from an account made 6 days ago, one from an
  account made years ago and one whose author's date X left out
- When the person starts watching and the check comes in
- Then X's search was asked for @xomoni_fixture -from:xomoni_fixture
- And the post from the new account says account made 6 days ago
- And the post from the old account has no such badge
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-03 · happy

- Given Replies to you turned on, and the person on a tab of their own while watching
- When a check finds a reply from an account made 6 days ago
- Then the Replies to you tab is marked, its name saying 1 new account
- And Xomoni's toolbar button shows 1 on its badge
- And once the person opens the tab, the badge and the tab's mark go, while the post keeps its badge
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-04 · invalid

- Given Mentions of you watching, and X's search answering with an author whose account date is still to come, and
  one X gave no date for
- When the check comes in
- Then neither post has a badge: Xomoni never guesses an account's age
- And the tab isn't marked, and the toolbar's badge stays empty
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-05 · invalid

- Given Mentions of you on, and two tabs of the person's own added, five tabs in all
- When the person looks at Replies to you
- Then its switch can't be turned on, and Add tab can't add another
- And the page says All 5 tabs are in use: remove a tab of your own to turn on another.
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-06 · invalid

- Given Replies to you turned on
- When the person looks at its tab
- Then it shows what it searches, to:xomoni_fixture, with no field to type another search over it
- And no Remove tab: only its switch turns it off
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-07 · error

- Given Replies to you watching
- When X refuses the search (an error instead of the results)
- Then the tab says X didn’t show the search results this time; the posts below are from the last check.
- And nothing is counted on the toolbar's badge
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-08 · error

- Given Mentions of you watching
- When X answers the search with its rate limit (429)
- Then the check waits for X's reset like any read, at the same pace and within the same limits, and stores nothing
- Manual: X's limits are checked on the job's own paced page loads, and the wait is one every check shares; the
  ready tabs add nothing to it. apps/extension/tests/watch.test.ts proves that a rate-limited check waits it out and
  stores nothing.

## S391-09 · error

- Given Mentions of you watching
- When X's search answer moves the date an account was made to a field Xomoni doesn't read
- Then the posts show with no badge, and nothing is counted, until the fixtures and the parser learn the new place
- Manual: only X changing its answer shows it; apps/extension/tests/watch-about-you.test.ts proves that an answer
  without the date, or with one that isn't a date, gives no badge.

## S391-10 · security

- Given Mentions of you watching
- When the check comes in, with a post from a new account
- Then the only request X's pages made was the search's own GraphQL answer: nothing about the authors, no like, no
  reply, no write
- And the account's age still shows, read from that answer
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-11 · security

- Given Replies to you on for @xomoni_fixture
- When the person signs in to X as another account and the X window shows it
- Then the dashboard follows that account, and Replies to you would search to:fixture_friend, never the first account
- And that account's ready searches start off, each account having its own
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-12 · security

- Given the ready searches on, with their posts
- When xomoni.com reads Watch from Xomoni in the same browser, or sets its searches (ADR-0028, ADR-0029)
- Then it gets the person's own searches only: the ready tabs, their posts and the authors' ages stay in Xomoni, and
  the site's searches never take a ready tab's place
- Manual: needs the website and the extension together; apps/extension/tests/website-reads.test.ts and
  website-settings.test.ts prove both.

## S391-13 · empty

- Given a first visit to the Watch page
- When the person looks at About you
- Then Mentions of you and Replies to you are both off, each saying what it would search
- And there are only the two first tabs, and the toolbar's badge is empty
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-14 · empty

- Given Mentions of you just turned on, and no watching yet
- When the person looks at its tab
- Then it says Not checked yet. Start watching to search X for it.
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-15 · cancel

- Given Replies to you on
- When the person turns it off
- Then its tab goes, leaving the two first tabs
- And turning it on again brings the tab back
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-16 · cancel

- Given Mentions of you watching, before its first check
- When the person presses Pause watching
- Then watching stops with Start watching offered again, and nothing more is searched
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-17 · a11y

- Given the Watch page and only a keyboard
- When the person tabs to Replies to you and presses Space
- Then it turns on and its tab is selected
- And axe finds no serious or critical violation
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-18 · a11y

- Given dark mode, Mentions of you watching, and a check that found a post from a new account
- When the person looks at the marked tab, then opens it
- Then axe finds no serious or critical violation, on the marked tab or on the posts with their badge
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-19 · browser

- Given the dashboard at a phone's width, 390 px
- When the person turns on Mentions of you
- Then the switch and its tab work as on a computer, and axe finds no serious violation
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-20 · persistence

- Given Replies to you turned on
- When the person reloads the dashboard
- Then it is still on, with its tab and what it searches
- Test: apps/web/e2e/extension/watch-about-you.spec.ts

## S391-21 · happy

- Given Replies to you just turned on, so its tab is the one shown, and watching started
- When the person goes to another browser tab, and a check finds a reply from an account made 6 days ago
- Then Xomoni's toolbar button shows 1 while they are away: the post isn't seen because its tab is shown
- And once they come back to the dashboard, with the tab in front, the badge clears
- Test: apps/web/e2e/extension/watch-about-you.spec.ts
