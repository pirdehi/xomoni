---
task: 233
title: The Library, Watch and account health on xomoni.com
feature: website-library
---

# The Library, Watch and account health on xomoni.com

xomoni.com shows three of Xomoni's places, read from Xomoni in the same browser (#233, [ADR-0028](../adr/0028-xomoni-data-on-the-website-in-the-same-browser.md)): the Library, the account's posts, replies, reposts and likes with a search, 100 at a time; Watch, each search and the posts it found; and account health, each X account's level on the risk ladder, why, and its pace. What they show is X content: it stays in the page's memory, never in storage, logs or a request to a server ([ADR-0004](../adr/0004-x-data-stays-local.md)). Without Xomoni here, each place says where its data lives and offers the one dialog of [ADR-0027](../adr/0027-extension-actions-from-the-website.md). Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: Watch no longer shows the two tabs Xomoni keeps before a search is typed in them as blank searches, and says *No searches yet.* (S233-18).

The tests run on both sides:

- **xomoni.com** (`apps/web/e2e/website-library.spec.ts`): the website against the local stack, with Xomoni played at the page. Xomoni signs in with the site's code through `pair_device`, answers each read from a small made-up copy as a test says, and records every message.
- **Xomoni** (`apps/web/e2e/extension/website-library.spec.ts`): the built extension in a real browser, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with years of posts, replies, a repost and likes. xomoni.com is played at it, sending what the website sends.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-233
npm run test:e2e:extension -w @xomoni/web -- --grep @task-233
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S233-01 · happy

- Given a person signed in, with Xomoni in this browser, whose copy has 3 posts (one removed), a reply, a repost and
  a like
- When they open the Library
- Then it says it is read from Xomoni in this browser and nothing reaches our servers, and Posts 2 is chosen, beside
  Replies 1, Reposts 1 and Likes 1
- And it lists 3 items, 1 removed, newest first, each with its day, likes, replies and reposts, the removed one marked
  Removed, and each linked to x.com/i/status/<its id>
- And Xomoni was asked for posts, with no search, from the first, naming this browser's device
- Test: apps/web/e2e/website-library.spec.ts

## S233-02 · happy

- Given the Library
- When the person chooses Likes, then Reposts, then Replies
- Then each is its own list, read from Xomoni in turn; a like and a repost name their author (@grace · Sep 9, 2022),
  and the person's own reply doesn't
- Test: apps/web/e2e/website-library.spec.ts

## S233-03 · happy

- Given the Library
- When the person types launch
- Then once typing pauses Xomoni is asked once with the search, not once for each key, and the list shows the one post
  that holds it: 1 item
- Test: apps/web/e2e/website-library.spec.ts

## S233-04 · happy

- Given a copy of 150 posts
- When the Library opens, and the person presses Show more
- Then it lists the newest 100, then reads the next 50 from 100 and adds them below, and Show more is gone
- Test: apps/web/e2e/website-library.spec.ts

## S233-05 · happy

- Given three X accounts in Xomoni: one at level 1 on half pace, one well, one at level 3 held for three hours
- When the person opens Account health
- Then each account shows its level by name (Caution, Normal, Defensive), why, its pace (half until Nov 30, 2030, its
  usual pace, a quarter), and when jobs may resume
- Test: apps/web/e2e/website-library.spec.ts

## S233-06 · happy

- Given a Watch search that looked two minutes ago and found one post
- When the person opens Watch
- Then the search has its own region, says Looked 2 minutes ago, and lists Grace @grace · 1 hour ago with the post
  and a link to it on X
- And the page says Watch looks while Xomoni's dashboard is open, and the searches change in Settings
- Test: apps/web/e2e/website-library.spec.ts

## S233-07 · invalid

- Given the Library
- When the person types only spaces in the search
- Then it is no search: Xomoni isn't asked again, and the whole list stays
- Test: apps/web/e2e/website-library.spec.ts

## S233-08 · invalid

- Given the Library
- When the person searches for words nothing holds
- Then the page says Nothing matches that search., with 0 items, and no list
- Test: apps/web/e2e/website-library.spec.ts

## S233-09 · invalid

- Given a post with no text, such as a photo alone
- When the Library lists it
- Then it says (no text) instead of an empty line, with its likes
- Test: apps/web/e2e/website-library.spec.ts

## S233-10 · invalid

- Given a Xomoni whose answer holds an item with an id that isn't X's (javascript:alert(1))
- When the Library reads it
- Then the whole answer is refused: the page says Xomoni didn't answer, and shows no item and no link
- Test: apps/web/e2e/website-library.spec.ts

## S233-11 · error

- Given a Xomoni that gives no answer
- When the person opens the Library
- Then the page says Xomoni didn't answer, to open it on this computer and try again
- And once Xomoni answers, Read again lists the posts
- Test: apps/web/e2e/website-library.spec.ts

## S233-12 · error

- Given a Xomoni older than the page, which answers invalid
- When the person opens the Library
- Then the page says their Xomoni is older than this page and can't show this here yet, with a link to install the
  newest version
- Test: apps/web/e2e/website-library.spec.ts

## S233-13 · error

- Given a Xomoni that refuses to read
- When the person opens Account health, then Watch
- Then each says Xomoni didn't answer
- And once Xomoni answers, Read again shows a search X didn't answer with X's reason, not Nothing found yet.
- Test: apps/web/e2e/website-library.spec.ts

## S233-14 · security

- Given a post, a Watch search and a health reason only Xomoni knows, and a search the person types
- When the person opens the Library, searches, then Account health and Watch
- Then every read names this browser's device, and none of those words reaches a server, localStorage or
  sessionStorage
- Test: apps/web/e2e/website-library.spec.ts

## S233-15 · security

- Given a person signed out, with Xomoni in this browser
- When they open /dashboard/library
- Then the site sends them to sign in, with the Library as the page to come back to, and Xomoni is never asked to read
- Test: apps/web/e2e/website-library.spec.ts

## S233-16 · security

- Given the Library's posts
- When the person looks at each Open on X
- Then each goes only to https://x.com/i/status/<digits>, in a new tab, with no referrer and no opener
- Test: apps/web/e2e/website-library.spec.ts

## S233-17 · empty

- Given a browser without Xomoni
- When the person opens the Library, Watch and Account health
- Then each says it is read from Xomoni on their computer, in this browser, and never reaches our servers, to open the
  page where Xomoni runs
- And Open in Xomoni says Xomoni isn't installed yet
- Test: apps/web/e2e/website-library.spec.ts

## S233-18 · empty

- Given a new Xomoni: no item, no X account, and Watch's two tabs with nothing typed in them yet
- When the person opens the Library, Account health and Watch
- Then they say No posts in your Library yet. (Posts 0, 0 items), No likes in your Library yet., Xomoni doesn't know
  an X account yet., and No searches yet., with no blank search
- Test: apps/web/e2e/website-library.spec.ts

## S233-19 · empty

- Given a Watch search that hasn't looked yet
- When the person opens Watch
- Then the search says Not looked yet and Nothing found yet.
- Test: apps/web/e2e/website-library.spec.ts

## S233-20 · cancel

- Given a search for launch, which lists one post
- When the person clears the search
- Then the whole list is back, 3 items, read again with no search
- Test: apps/web/e2e/website-library.spec.ts

## S233-21 · cancel

- Given 120 posts, all shown with Show more
- When the person chooses Likes, then Posts again
- Then Posts starts again from the newest 100, read from the first
- Test: apps/web/e2e/website-library.spec.ts

## S233-22 · cancel

- Given the dialog that Xomoni isn't installed, opened from the Library's Open in Xomoni
- When the person closes it
- Then the place is as it was, with the button there to press again
- Test: apps/web/e2e/website-library.spec.ts

## S233-23 · a11y

- Given the Library
- When the person uses only the keyboard: arrows along the kinds, Enter on Likes, Tab to the search, and types grace
- Then Likes is chosen and listed, and the search reads 1 item
- Test: apps/web/e2e/website-library.spec.ts

## S233-24 · a11y

- Given the Library, Watch with a search, and Account health
- When each is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/website-library.spec.ts

## S233-25 · browser

- Given an iPhone
- When the person opens the Library and presses Open in Xomoni, then Send to my computer
- Then the dialog says Xomoni runs on a computer, and the link copied is the Library's (and CI's e2e-edge runs every
  scenario in Microsoft Edge)
- Test: apps/web/e2e/website-library.spec.ts

## S233-26 · persistence

- Given the Library with a search typed
- When the person reloads the page
- Then the Library is read from Xomoni again, from the first post, and the search is empty: nothing was kept
- Test: apps/web/e2e/website-library.spec.ts

## S233-27 · happy

- Given Xomoni signed in from xomoni.com, and the person's profile browsed on X: posts, replies and likes
- When the page reads the Library's posts
- Then Xomoni answers @xomoni_fixture's 5 posts, newest first, none removed, and counts 2 replies, 1 repost and 2
  likes
- Test: apps/web/e2e/extension/website-library.spec.ts

## S233-28 · happy

- Given the same copy
- When the page searches posts for LAUNCH, likes for fixture_friend, and reads the reposts
- Then Xomoni answers the one post that holds launch in any case, the 2 likes by that author, and the repost linked to
  the friend's post it reposted
- Test: apps/web/e2e/extension/website-library.spec.ts

## S233-29 · happy

- Given the same copy, on a new install
- When the page reads account health and Watch
- Then Xomoni answers @xomoni_fixture at level 0, with no reason, at its usual pace and no hold, and Watch's two tabs
  with nothing typed in them yet
- Test: apps/web/e2e/extension/website-library.spec.ts

## S233-30 · security

- Given Xomoni never signed in to xomoni.com, then signed in
- When a page reads the Library, account health and Watch, then names another account's device
- Then Xomoni refuses each first as not connected, then as another account's
- Test: apps/web/e2e/extension/website-library.spec.ts

## S233-31 · invalid

- Given Xomoni signed in from xomoni.com
- When a read asks for an unknown kind, a negative or broken offset, a search over 100 characters, a device that isn't
  one, a field Xomoni doesn't know, or a place it doesn't have
- Then Xomoni refuses each as invalid
- Test: apps/web/e2e/extension/website-library.spec.ts

## S233-32 · persistence

- Given the page read the person's 2 replies
- When Xomoni's dashboard and the page both reload
- Then the page reads exactly the same again: the copy is Xomoni's, kept on the computer
- Test: apps/web/e2e/extension/website-library.spec.ts
