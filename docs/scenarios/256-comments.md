---
task: 256
title: Comments on xomoni.com: user scenarios
feature: comments
---

# Comments on xomoni.com

xomoni.com's Comments page (#256) has two tabs, both read from Xomoni in the same browser ([ADR-0028](../adr/0028-xomoni-data-on-the-website-in-the-same-browser.md)):

- **Your replies.** The person's replies still on X, found by date, likes, whom they answer and words, with the people they reply to most. The replies they pick go to Xomoni, which opens its Cleanup page with only those. Nothing is removed until they confirm there ([ADR-0027](../adr/0027-extension-actions-from-the-website.md)).
- **Replies to you.** What others replied to the person, as Xomoni kept it from what X showed it: on this computer only, for 90 days, never acted on ([ADR-0030](../adr/0030-replies-to-you-kept-on-the-computer.md)).

The replies' words stay in the page's memory: never stored, logged or sent to a server. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: Cleanup said *1 replies you picked. Only these are removed* for a single reply (S256-28).

The tests run on both sides:

- **xomoni.com** (`apps/web/e2e/comments.spec.ts`): the website against the local stack, with Xomoni played at the page. Xomoni signs in with the site's code through `pair_device`, then answers reads from the replies a test gives it, filtered as the extension filters them, and records every message.
- **Xomoni** (`apps/web/e2e/extension/comments.spec.ts`): the built extension in a real browser, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with years of posts and replies. xomoni.com is played at it, sending what the website sends. A test that needs someone's reply to the person adds it to X's answer, written by the made-up `@fixture_friend`.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-256
npm run test:e2e:extension -w @xomoni/web -- --grep @task-256
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S256-01 · happy

- Given a person signed in on xomoni.com, with Xomoni in this browser knowing three of their replies: to @bob, to
  @carol, and one in their own thread
- When they open Comments
- Then it says the replies were read from Xomoni in this browser and never reach our servers
- And it lists 2 of 3 replies, newest first, each with whom it answers, its day, likes and replies, its text and Open
  on X, a link to the post on x.com
- Test: apps/web/e2e/comments.spec.ts

## S256-02 · happy

- Given Your replies
- When the person presses @carol · 1 under You reply most to, then presses it again
- Then only the reply to @carol is listed, the button pressed and Replying to filled with carol, and Xomoni was asked
  for replies to carol
- And pressed again, every reply is listed again
- Test: apps/web/e2e/comments.spec.ts

## S256-03 · happy

- Given Your replies
- When the person picks two replies and presses Review and remove in Xomoni
- Then the page says 2 replies picked, and that nothing is removed until they confirm in Xomoni
- And Xomoni gets one plan of those two replies only, with nothing kept or left out, and the page says Xomoni opened its
  Cleanup page with the plan, and nothing starts until they confirm there
- Test: apps/web/e2e/comments.spec.ts

## S256-04 · happy

- Given Your replies
- When the person asks for replies from 2023-01-01 through 2023-12-31, with at most 20 likes, holding meetup
- Then 1 of 3 replies is listed, the one to @carol, and Xomoni was asked with exactly those days, likes and words
- Test: apps/web/e2e/comments.spec.ts

## S256-05 · happy

- Given Xomoni keeping a reply @carol wrote to the person yesterday
- When the person opens Replies to you
- Then it shows Replies to you each day, 1 kept since then, @carol · 1 among who replies most, and the reply with Open
  on X, a link to it on x.com
- Test: apps/web/e2e/comments.spec.ts

## S256-06 · invalid

- Given Your replies
- When the person types -1, then 1.5, as the most likes
- Then the form says Likes must be a whole number from 0, or empty, and Xomoni isn't asked with them
- Test: apps/web/e2e/comments.spec.ts

## S256-07 · invalid

- Given Your replies
- When the person types bob smith! as whom the replies answer
- Then the form says That isn't an X handle: letters, digits and _ only
- And @bob, typed next, is taken, listing the reply to @bob
- Test: apps/web/e2e/comments.spec.ts

## S256-08 · invalid

- Given Your replies
- When the person picks a first day after the last, then a last day still to come
- Then the form says The first day must not be after the last, then The last day must be today or earlier
- Test: apps/web/e2e/comments.spec.ts

## S256-09 · error

- Given a person signed in on xomoni.com in a browser without Xomoni
- When they open Comments
- Then it says replies are read from Xomoni on their computer and never reach our servers, and to open the page in the
  browser where Xomoni runs, with no tabs and nothing of X
- Test: apps/web/e2e/comments.spec.ts

## S256-10 · error

- Given Xomoni in this browser, which refuses to read
- When the person opens Comments
- Then it says Xomoni didn't answer, to open it on this computer and try again, and lists nothing
- Test: apps/web/e2e/comments.spec.ts

## S256-11 · error

- Given a Xomoni older than the page, which doesn't know the read
- When the person opens Comments
- Then it says their Xomoni is older than this page and can't list their replies here yet, with Install the newest
  version
- Test: apps/web/e2e/comments.spec.ts

## S256-12 · error

- Given a reply picked, and a Xomoni that now refuses, signed in to another account
- When the person presses Review and remove in Xomoni
- Then the page says Xomoni in this browser isn't signed in to this account, and nothing starts
- Test: apps/web/e2e/comments.spec.ts

## S256-13 · security

- Given the person's replies and replies to them, words only Xomoni knows
- When they list, search and switch tabs
- Then none of those words is in any request the page sends, nor in the site's local or session storage
- Test: apps/web/e2e/comments.spec.ts

## S256-14 · security

- Given Comments, a reply picked and handed to Xomoni, and Replies to you opened
- When the messages Xomoni received are counted
- Then they are only hellos, the sign-in, reads and the one plan: nothing that starts, resumes or approves work
- Test: apps/web/e2e/comments.spec.ts

## S256-15 · security

- Given Replies to you
- When the person looks for what they can do with a reply
- Then there is no hide, block, report, mute, delete or remove, and nothing to pick: each reply only links to x.com,
  with no referrer
- Test: apps/web/e2e/comments.spec.ts

## S256-16 · empty

- Given Xomoni knowing none of the person's replies
- When they open Comments
- Then it says 0 of 0 replies and Xomoni knows none of your replies yet, with no one under You reply most to
- Test: apps/web/e2e/comments.spec.ts

## S256-17 · empty

- Given Xomoni keeping no reply to the person
- When the person searches words no reply holds, then opens Replies to you
- Then Your replies says None of your replies match, and Replies to you says Xomoni hasn't kept a reply to your posts
  yet, and keeps the ones X shows it for 90 days
- Test: apps/web/e2e/comments.spec.ts

## S256-18 · cancel

- Given every shown reply picked with Pick all 2 shown
- When the person presses Clear
- Then no reply is picked, the hand-over is gone, and no plan went to Xomoni
- Test: apps/web/e2e/comments.spec.ts

## S256-19 · cancel

- Given one reply picked
- When the person unpicks it
- Then the hand-over to Xomoni is gone
- Test: apps/web/e2e/comments.spec.ts

## S256-20 · a11y

- Given Your replies
- When the person uses only the keyboard: Tab to the first reply's box, then Space
- Then the reply is picked, and 1 reply picked is a status a screen reader reads out
- Test: apps/web/e2e/comments.spec.ts

## S256-21 · a11y

- Given Your replies with a reply picked, and Replies to you
- When each is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/comments.spec.ts

## S256-22 · persistence

- Given replies to @bob asked for, and one picked
- When the person opens Replies to you and comes back, then reloads the page
- Then the filter and the pick are still there after the tabs, and the reload starts afresh: nothing of them was kept
- Test: apps/web/e2e/comments.spec.ts

## S256-23 · happy

- Given Your replies
- When the person turns on Include replies in your own threads
- Then the reply in their own thread is listed too, marked Your thread, and Xomoni was asked for it
- Test: apps/web/e2e/comments.spec.ts

## S256-24 · happy

- Given Xomoni knowing 130 of the person's replies
- When they open Comments, then press Show more
- Then 100 are listed first, then all 130, each once, with no Show more left, and Pick all 130 shown
- Test: apps/web/e2e/comments.spec.ts

## S256-25 · browser

- Given a person signed in on xomoni.com on an iPhone
- When they open Comments
- Then it says the replies are read from Xomoni on a computer and lists nothing, with nothing wider than the phone (and
  CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/comments.spec.ts

## S256-26 · happy

- Given Xomoni signed in from xomoni.com, and the person's profile browsed on X, with a reply to @fixture_friend and
  one in their own thread
- When the Comments page asks Xomoni for the person's replies
- Then Xomoni answers from its copy: 1 of 2 replies, the one to @fixture_friend with its text, its own thread left out,
  and @fixture_friend · 1 as whom they reply to most
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-27 · happy

- Given the same copy
- When the page asks for replies in the person's own threads holding SECOND PART, then for replies to FIXTURE_FRIEND
  with no likes
- Then Xomoni answers just the reply in their own thread, marked so, then just the reply to @fixture_friend: words and
  handles match in any case
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-28 · happy

- Given the same copy
- When the page hands Xomoni a plan of the one reply picked
- Then Xomoni opens Cleanup, Planned on xomoni.com, saying 1 reply you picked, only that one removed, and its review
  lists only that reply
- And nothing starts: Activity has no job, and the log says the plan waits for the person to review it in Xomoni
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-29 · happy

- Given @fixture_friend's reply to the person yesterday, in what X shows on their profile
- When the person browses it, and the page asks Xomoni for the replies to them
- Then Xomoni kept it and answers it, with its author, text, day and the post it answers, and @fixture_friend · 1
- And it isn't one of the person's own replies, which are still theirs only
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-30 · security

- Given Xomoni signed in from xomoni.com
- When a page names another account's device in a read of the replies or of the replies to the person
- Then Xomoni refuses it as another account's, with none of the replies
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-31 · security

- Given Xomoni that was never signed in to xomoni.com
- When a xomoni.com page asks it for the replies or the replies to the person
- Then it refuses: not connected
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-32 · invalid

- Given Xomoni signed in from xomoni.com
- When a read's filter has its first day after its last, negative likes, a handle that isn't one, words over 100
  characters, or a field Xomoni doesn't know
- Then Xomoni refuses each as invalid
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-33 · error

- Given Xomoni signed in from xomoni.com
- When a plan of picked replies names another account's device
- Then Xomoni refuses it as another account's, and Cleanup isn't touched: no plan from xomoni.com on it
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-34 · empty

- Given no one's reply to the person seen on X
- When the page asks Xomoni for the replies to them
- Then it answers none: no day, no one, since no date
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-35 · persistence

- Given a reply to the person that Xomoni kept
- When the person closes the X window and their X tab and reloads the dashboard, and a new xomoni.com page asks
- Then Xomoni still answers it
- Test: apps/web/e2e/extension/comments.spec.ts

## S256-36 · security

- Given two replies to the person on X, one from yesterday and one from 91 days ago
- When the person browses them, and the page asks Xomoni for the replies to them
- Then only yesterday's was kept: Xomoni keeps replies to the person for 90 days, no longer
- Test: apps/web/e2e/extension/comments.spec.ts
