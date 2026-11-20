# ADR-0030: Replies to you, kept by Xomoni on the computer and never acted on

- Status: Accepted
- Date: 2026-11-20

## Context

The Comments place on xomoni.com (#256) has two tabs. *Your replies* lists what the person wrote, which Xomoni already keeps. *Replies to you* should show how many replies the person gets each day, who replies most, and a way to hide one.

Until now Xomoni has kept only the person's own posts, replies, reposts and likes, plus what Watch searches find (ADR-0021). Replies to the person are other people's words. Keeping them is new, so it needs its own limits.

X lets nobody delete someone else's reply. The author of a post can hide a reply to it, one at a time, on X.

## Decision

1. **Xomoni keeps only replies to the person's own posts that X already sent to the page.**
   - It reads them from the same responses it reads the person's posts from, while the person browses X or a cleanup runs. As for the daily numbers (ADR-0026), Xomoni makes no request of its own for them.
   - A reply counts when it answers one of the active account's posts and someone else wrote it.
2. **It keeps the fewest fields that make the tab work:**
   - the reply's id, to link to it;
   - its author's handle;
   - its text, cut to 1,000 characters;
   - when it was posted;
   - which of the person's posts it answers.

   No display names, avatars, follower counts or anything else about the author.
3. **It keeps them for a short while.**
   - At most 90 days, by when the reply was posted, and at most 5,000 per X account; older ones are dropped whenever new ones are kept.
   - They go with the account's other data: removing the account's data from the browser (`forgetAccount`) and *Delete local data* remove them.
   - They are not in Xomoni's backup file.
4. **They stay on the computer.** Nothing about them goes to a server (ADR-0004). xomoni.com reads them in the same browser only, under ADR-0028 (`xomoni-read`, `what: 'incoming'`): a page of at most 100, replies per day, and the 20 people who reply most.
5. **Xomoni never acts on them.**
   - No hiding, blocking, muting or reporting, now or later, without a new ADR.
   - Each reply offers *Open on X*, where the person can hide it with X's own menu.

Built in [#256](https://github.com/pirdehi/xomoni/issues/256).

## Consequences

- *Replies to you* shows what Xomoni has seen, not everything X has. It says so, and the counts grow with use.
- Other people's words sit in the person's IndexedDB for up to 90 days. That is the same place and the same protection as the person's own posts, and less than X itself shows them.
- A page that can read Xomoni in the same browser can read these replies too: the same limits as ADR-0028 apply.

## Alternatives considered

- **Count replies only, keep no text.** Smaller, but the person can't tell which reply to open, so the tab would only be a chart.
- **Ask X for the replies.** More complete, but each look would be a read Xomoni makes on its own, spending the account's read budget (ADR-0012) to collect other people's words.
- **Hide replies for the person.** X has a hide action, but automating it acts on other people's words in bulk. The person can hide one in two clicks with *Open on X*.
