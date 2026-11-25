# ADR-0028: Xomoni's own data on xomoni.com, read in the same browser

- Status: Accepted
- Date: 2026-11-20

## Context

The full dashboard (#248) should show the extension's places on xomoni.com: the Library (every post, reply, repost and like Xomoni knows), Watch and account health (#233). The activity page already shows the jobs from the cloud (#251). That data is X content: under [ADR-0004](0004-x-data-stays-local.md) it never reaches a server, and [ADR-0026](0026-daily-numbers-in-the-cloud.md) lets only daily counts go to the cloud.

xomoni.com and the extension already talk in the same browser through `externally_connectable`, for the one sign-in ([ADR-0025](0025-one-sign-in-for-the-website-and-the-extension.md)) and the actions ([ADR-0027](0027-extension-actions-from-the-website.md)). A page of xomoni.com open in that browser runs on the person's own computer, like the extension's dashboard does.

## Decision

1. **The website reads Xomoni's data from the extension in the same browser, and only there.**
   - A read is a message of a fixed type (`xomoni-read`), naming what is read (`library`, `watch` or `health`), and for the Library a kind, a search of at most 100 characters and an offset.
   - No server takes part. Nothing read this way is sent to xomoni.com's servers, Supabase or anyone else.
2. **The extension answers a read only when all of these hold** (as for actions, ADR-0027):
   - it comes from xomoni.com's top frame;
   - its shape is exactly one of the read messages, with filters of the expected shapes;
   - Xomoni is signed in and connected as the device the page's own account names.
3. **Reads are bounded and read-only.**
   - At most 100 items an answer, with the offset of the next page; counts and summaries are computed in the extension, and texts are cut to 1,000 characters.
   - Only the fields a place shows travel: no X ids beyond what the place links to, no cookies, no tokens, no settings secrets.
   - A read never changes anything in the extension.
4. **The website keeps what it read in memory, on the page that asked.**
   - It is not written to `localStorage`, IndexedDB, cookies or caches, not logged, and not sent to analytics or error reporting.
   - It goes when the page goes.
5. **The browser holds the line.** The site's Content Security Policy lets pages connect only to xomoni.com and Supabase, Trusted Types guard the DOM (#147), and the CSP report route keeps a few short fields only. A script that could read this data would first have to get past those.
6. **Without Xomoni in the browser**, the places say where the data lives and offer *Open in Xomoni*, with the dialog of ADR-0027. Overview and the number pages still show what the cloud has (job status, and the daily numbers if turned on).

Built in [#233](https://github.com/pirdehi/xomoni/issues/233).

Amended 2026-11-20:
- the settings are read the same way (ADR-0029, #234);
- Cleanup reads how many items a plan matches, with whether the archive was imported and the pace per day: counts only, no items (#235).
- *Your replies* on Comments reads the person's replies still on X, newest first, 100 at a time (#256). Each comes with the handle it answers, and the read can filter by date, at most a number of likes, that handle and words in the text. The answer also names the 20 people the person replies to most, with how many replies each, leaving the person's own threads out. Other people's replies to the person are not part of this read.
- *Replies to you* on Comments reads the replies others wrote to the person that Xomoni kept ([ADR-0030](0030-replies-to-you-kept-on-the-computer.md)): replies per day, the 20 people who reply most, and 100 at a time by author and words (#256).

## Amendment (2026-11-24, #426): the vault's summary

The vault ([ADR-0043](0043-the-vault-x-files-kept-on-the-computer.md)) keeps X's own files about the person on their computer. xomoni.com shows *Your vault* beside the Library, read the same way as the other places:

1. **`what: 'vault'`**, with the device only. Xomoni answers it under the same rules (`accessRefusal`): only for a page whose account knows this device, never while signed out.
2. **Counts and dates only** (`VaultSummary`): for each source X's file comes from, the date of its newest copy, its freshness and the rows the vault holds; the day X made the newest archive; how many imports the ledger holds; and how many page-reading groups are on (none in R1). There is no text, no file name, no fingerprint and no id of X's. The bridge refuses an answer with any other key, a count that isn't a whole number, or a source or freshness it doesn't know.
3. **It stays in the page's memory,** like every read: never stored, logged or sent. The website never starts an import ([ADR-0006](0006-website-is-view-only.md)); *Open in Xomoni* opens Xomoni's Vault page.

## Amendment (2026-11-25, #431): Reach

Reach ([ADR-0045](0045-reach-diagnosis-guesses-labelled-as-guesses.md), point 6) is read the same way, in its own place on the dashboard:

1. **`what: 'reach'`**, with the device, a period of `REACH_RANGES` (30, 90 or 365 days, or everything), an order of `REACH_ORDERS` (most seen, least seen, newest) and an offset; nothing else. Xomoni answers it under the same rules (`accessRefusal`).
2. **A bounded answer** (`ReachSummary`, `REACH_LIMITS`): at most 8 comparisons, each with its verdict, sizes, medians, ratio and interval; 24 months of X's labels, 50 labels each, by X's names and counts; 100 posts with their date, views, source, share of usual and 280 characters of their text; and 20 suspected posts with their reasons, **each marked `guess: true`**. The bridge refuses the whole answer when anything is past those bounds, of a shape it doesn't know, a post id that isn't X's, or a suspected post not marked as a guess. The person's own posts' text is X content, as in the Library, and is treated the same way.
3. **It stays in the page's memory,** like every read: never stored, logged or sent. The posts shown can be saved as CSV made in the browser. Nothing on the place starts anything on X or leads to a cleanup ([ADR-0006](0006-website-is-view-only.md)); *Open Reach in Xomoni* opens Xomoni's Reach page. Every suspected post is shown under the box *This is a guess. X doesn't say which posts got a label.*, the same words as the extension's.

## Consequences

- The Library, Watch and account health appear on xomoni.com in the browser where Xomoni runs, with nothing new stored anywhere.
- On a phone or another computer those places stay empty of X content, by design; the daily numbers cover what can be shown there.
- A script injected into xomoni.com in the person's browser could read what Xomoni answers. The CSP, Trusted Types, the strict parsers and the bounded pages keep that hard and small; every new read type is listed, parsed and tested like the pairing message (ADR-0024).
- The website must keep this data out of every log, store and report. Tests check that a read leaves no trace in storage and makes no network request.

## Alternatives considered

- **Sync the Library to the cloud, encrypted end to end.** It would work on every device, but the keys would live in the browser anyway, and a server copy of a person's posts is what ADR-0004 exists to avoid.
- **Show the extension's own dashboard in an iframe on xomoni.com.** Extension pages can't be framed by a website without making them web-accessible to every site, which widens the attack surface for no gain.
- **Leave these places to the extension.** That is the status quo the maintainer asked to change (#248).
