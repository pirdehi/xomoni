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
