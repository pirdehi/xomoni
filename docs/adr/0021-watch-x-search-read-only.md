# ADR-0021: Watch X's search for phrases and #hashtags, read-only and within the read budget

- Status: Accepted
- Date: 2026-11-05

## Context

The maintainer wants to follow what people post about a few phrases or #hashtags (#158): a dashboard section with tabs, two by default and up to five, each searched about once a minute with X's own search, showing the 10 newest posts. An earlier ask went further, to like those posts automatically and to reply with AI-written text that reads like a person's. That part was declined:
- X's automation rules forbid automated likes and automated replies based on keyword searches.
- Replies that pass for a person mislead the people who read them.
- The maintainer's own rule is never to hide automation ([ADR-0003](0003-no-credentials-no-evasion.md)).

What is left is reading, which Xomoni already does for scans. Two things need deciding: how often reading may happen, and how it shares the one X window with cleanups.

## Decision

1. **Read-only.** The Watch page and its job only load X's "Latest" search page and read the newest posts from it: id, author, time and text. Nothing likes, replies, follows or posts. Each post links to X, where the person acts themselves. The content script's `readPosts` command clicks nothing.
2. **Local.** Results stay in this browser's database (`kv`, per account), and only the 10 newest per tab are kept. They are never sent to xomoni.com or anywhere else ([ADR-0004](0004-x-data-stays-local.md)). Posts by other people never enter the inventory.
3. **Within the read budget ([ADR-0012](0012-one-fifth-of-every-x-limit.md)).**
   - Each check is one page load, paced and counted like every other read:
     - the `search` budget, 60 per 15 minutes (one fifth of X's published 300);
     - Xomoni's page-load ceiling, 240 an hour and 2,400 a day, or half that for an account not known to be Premium;
     - work sessions, active hours and the risk ladder.
   - "Once a minute" is the most often a tab is searched. Two tabs at that pace fill a non-Premium account's hourly ceiling, so more tabs, or a long day, space the checks further apart. The page says so.
   - A rate limit from X is waited out like any other.
4. **A job, so one X window.** Watching runs as a job of kind `watch`, one per account, which Start watching resumes. The runner's lock, connection checks, "needs you", Run hidden ([ADR-0020](0020-run-hidden-by-sharing-the-x-tab.md)) and notifications all apply. A cleanup and a watch can't run at the same time: the Watch page says so and waits.
5. **No AI and no posting here.** Drafting replies is not part of this decision. If it comes, it gets its own ADR, and the person sends every reply.

## Consequences

- The person sees new posts for their searches without keeping X open, with nothing done in their name.
- Watching spends reads that cleanups also need, and pauses while one runs. A long watch can reach the daily page-load ceiling, after which it waits until the next day.
- X's search can hide posts, or hide an account's posts from search (PLAYBOOK C6). Watch shows only what X's search shows.
- The search page's markup is another X dependency (`SEL.tweetText`, `SEL.userName`, `authorName` in `dom.ts`). A change there shows as posts without names or text, not as wrong actions.

## Alternatives considered

- **Like and reply automatically.** Declined; see Context.
- **A second X window for watching**, so cleanups and watches run side by side. The maintainer wants fewer windows, and two windows would double the reads Xomoni makes.
- **X's official API search.** It costs money per request and needs a server, which [ADR-0004](0004-x-data-stays-local.md) and [ADR-0006](0006-website-is-view-only.md) would have to change. It was deferred with the rest of the API mode.
- **Reading the search's GraphQL response instead of the page.** That would be more fields for no gain. The page shows what the person would see, and the inventory parser keeps only the account's own posts.

## Amendment (2026-11-22, #391): ready searches about the person, and new accounts flagged

A pile-on usually starts in someone's replies and mentions, often from accounts made that week. Watch gains two ready tabs for the X account the dashboard works with, and marks posts from new accounts.

1. **Two ready tabs, off until turned on.** *Mentions of you* searches `@handle -from:handle`, and *Replies to you* `to:handle`. Each is stored by its name only (`mentions`, `replies`), and its query is worked out from the account's handle each time it is shown or searched (`readyQuery`), so it follows the account and a change of handle; a handle X wouldn't have searches nothing. They count toward the five tabs and are never typed over or removed but by their switch. Each account has its own, like every Watch tab.
2. **An account's age comes from X's search answer, never from a request of its own.** The content script already reads X's `SearchTimeline` answer for the page it loads (for the inventory and for posts X won't show). From the same answer it keeps when each author's account was made (`core.created_at`, or the older `legacy.created_at`), for the page only, and `readPosts` adds it to each post it reads (`accountCreatedAt`). Nothing else is asked of X. Where the answer has no date, or one after the time it was read, the post has none: no badge, never a guess.
3. **New means made fewer than 30 days before the check.** Such a post shows "account made N days ago". In the ready tabs, the posts from new accounts the person hasn't seen on the Watch page (`watchSeen`, per account in `kv`) mark their tab and make the count on the toolbar button's badge (`chrome.action`, which needs no permission, so a zip install isn't disabled on update). Opening the tab clears them.
4. **The same rules.** The ready tabs are searched like any tab: read only, at `WATCH_EVERY_MS` at most, within the `search` budget and the page-load ceilings, and stopped at X's first warning. Their posts, the authors' ages and the count stay in this browser ([ADR-0004](0004-x-data-stays-local.md)). xomoni.com reads and sets only the person's own searches (ADR-0028, ADR-0029): the ready tabs and what they find are left out of what it reads, and its searches never take their place. A move to another Xomoni carries them (ADR-0032).

Choices the issue left open, taken the conservative way: the tabs are off by default; the badge counts only the ready tabs, and only posts not yet seen there; a future date counts as no date; and the website sees nothing of the ready tabs.
