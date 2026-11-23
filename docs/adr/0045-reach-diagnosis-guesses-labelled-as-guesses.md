# ADR-0045: Reach diagnosis from X's own files: numbers on the computer, guesses labelled as guesses

- Status: Accepted
- Date: 2026-11-23

## Context

People who post on X want to know why a post was seen less than usual. X doesn't say which posts it labelled or showed less. What it does give:

- **Its monthly *Under the hood* file** lists the labels X applied that month, and how many posts each touched. It doesn't say which posts.
- **Its analytics export** gives each post's impressions as of the day it was downloaded.
- **The view counts of the person's own posts,** which Xomoni already sees in what X sends to pages they open ([ADR-0026](0026-daily-numbers-in-the-cloud.md)).

Reach diagnosis (#428 to #431) reads these from the vault ([ADR-0043](0043-the-vault-x-files-kept-on-the-computer.md)).

It invites wrong verdicts. A post seen less may simply be younger, posted at a quiet hour, or about another subject. "Shadowban" is a rumor word with no defined meaning on X. A wrong verdict could push a person to delete good posts, or to stop posting. The rule for honesty has to be set before the code.

Testing visibility by searching X again and again, or from a signed-out browser, is automation on X ([PLAYBOOK C7](../PLAYBOOK.md)). It is out (ADR-0043, point 2).

## Decision

1. **Sources, in this order.** For each post, Xomoni uses:
   1. the impressions in X's analytics CSV, shown with its "as of" date;
   2. otherwise, the view count Xomoni last saw in X's answers, shown "as last seen";
   3. the daily views of the daily numbers (ADR-0026) only as a labelled estimate, for a trend, never for one post.

   A post with no number has no source, and is left out of every comparison.
2. **A comparison is honest about its size.**
   - **Young posts are left out.** A post younger than 7 days at its "as of" date is still growing.
   - **A group needs at least 15 posts.** Below that, it says *not enough data* and nothing else.
   - **Each comparison shows its numbers:** each group's size and median, and a 95% confidence interval of their ratio. The interval comes from a bootstrap of 2,000 resamples with a seeded generator, so the same data always gives the same answer.
   - **A post's baseline** is the rolling median of the person's posts of the same format (text, link, media, reply) over the 8 weeks before it.
   - **The verdict is one of five fixed words:** *clear-lower*, *clear-higher*, *maybe*, *no difference*, *not enough data* (`REACH_VERDICT_WORDS`, shared by the extension and the website).
   - **Each comparison lists what can mislead it:** the hour and the day, the subject, follower growth over the period, and the posts' ages.
3. **Banned words.**
   - No verdict, heading, notification or text of Reach says that a post or an account is shadowbanned, banned, penalized, suppressed or throttled.
   - A test searches every string of Reach, in the extension and on the website, for these words. A string that has one doesn't merge.
   - Where X names a label, Reach shows X's name.
4. **A suspected post is a guess, and says so.** For a month in which X applied a label to n posts, Xomoni may name candidates: the posts of that month furthest below their baseline, under half of it, and at most min(3n, 10).
   - Each candidate carries, in a box that can't be hidden, "This is a guess. X doesn't say which posts got a label.", and the reason it was picked.
   - Its confidence is *low* or *medium*, never *high*. It is *medium* only when the candidates are at least twice as far below as the rest, and the month has at least 20 posts.
   - The person can dismiss a candidate.
   - A candidate never links to a cleanup.
5. **What a label means.**
   - A known label's meaning comes from a glossary, with its source and the date it was checked.
   - An unknown label is shown with X's own name and no meaning.
   - A month with no label says *No labels that month*, never "clean".
6. **On the computer only.**
   - Every number, label and guess stays in the extension's IndexedDB.
   - Nothing goes to a server, and the daily numbers get no new column (ADR-0004, ADR-0026).
   - The website shows Reach only in the same browser, read from Xomoni ([ADR-0028](0028-xomoni-data-on-the-website-in-the-same-browser.md), amended in #431). The answers are bounded, and every suspected post in them is marked `guess: true`.
7. **No live probing.**
   - Xomoni never searches X, opens a signed-out view, or loads a page to test visibility.
   - It reads only the person's files, and what X already sent to pages they opened.

Built in [#428](https://github.com/pirdehi/xomoni/issues/428) (the data and the model), [#429](https://github.com/pirdehi/xomoni/issues/429) (the Reach page), [#430](https://github.com/pirdehi/xomoni/issues/430) (the alerts) and [#431](https://github.com/pirdehi/xomoni/issues/431) (the website).

## Consequences

- **Reach often says *not enough data*,** above all for accounts that post little. That is the cost of not guessing silently.
- **Every string of Reach goes through the banned-words test,** and every new suspected-post view through the guess box's test.
- **The glossary must be kept current.** Each entry's date shows when it was last checked.
- **Comparisons show associations, not causes,** and the page says so.
- **Which parts of Reach are paid** is set in `FEATURES` ([ADR-0042](0042-payments-and-entitlements-with-polar.md)). The honesty rules apply on every plan.
- **The rules are the tests' acceptance criteria:** 7 days, 15 posts, 95%, min(3n, 10), and the banned words.

## Alternatives considered

- **A shadowban checker that searches X.** Searching by itself is automation on X; it risks the account, and its results are noisy.
- **A verdict for each post.** X gives none, and a confident verdict built on guesswork would mislead.
- **Means without intervals.** One viral post moves a mean. An interval shows how sure a comparison is.
- **Comparing with other accounts in the cloud.** Breaks ADR-0004, and strangers' accounts say little about one's own.
