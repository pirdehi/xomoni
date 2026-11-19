# ADR-0026: Daily numbers in the cloud: counts per day, never X content

- Status: Accepted
- Date: 2026-11-19

## Context

This amends [ADR-0004](0004-x-data-stays-local.md), under which only job status reaches the cloud.

The maintainer wants a full dashboard on xomoni.com (#248): followers gained and lost, posts published, likes and replies received, and what Xomoni removed. It should work on a phone and in emailed reports too. Under ADR-0004 the website can show that only inside the browser where Xomoni runs (#233). On every other device the dashboard is empty, as on 19 November.

Three options were weighed with the maintainer:
- **The same browser only.** Leaves ADR-0004 as it is, but gives no phone and no emailed reports.
- **Daily numbers in the cloud.** Counts per day, with no text and no ids, by the person's choice.
- **Content in the cloud.** Breaks the product's promise and adds X and legal risk.

The maintainer chose daily numbers, on condition that collecting them adds no risk.

## Decision

1. **What may leave the extension:**
   - one row per X account per local calendar day, made of non-negative whole numbers;
   - the day itself;
   - the X handle, which job summaries already carry.

   Nothing else: no post text, no post or user ids, no other people's handles, no URLs, no likes' targets. The columns:

   | Group | Columns |
   | --- | --- |
   | Profile, as X last showed it that day | `followers`, `following`, `posts_total`, `likes_total` |
   | Published that day, from the inventory | `posted_posts`, `posted_replies`, `posted_reposts`, `posted_quotes` |
   | Received that day, as increases Xomoni saw in the counts of the person's own posts | `received_likes`, `received_replies`, `received_reposts`, `received_quotes`, `received_views`, `observed_posts` (how many own posts were seen that day, so the website can show how complete the estimate is) |
   | Engagement state | `posts_with_likes`, `replies_with_likes` |
   | Removed by Xomoni that day | `removed_posts`, `removed_replies`, `removed_reposts`, `removed_likes` |

2. **No extra requests to X.** Collecting the numbers adds no risk:
   - They come only from what X already sends to the person's browser: pages the person or a Xomoni job opens, scans the person starts, and the imported archive.
   - Xomoni never loads a page or calls X to collect statistics.
   - A day without an X page has no row, and the website shows the gap.
3. **The person chooses.**
   - *Show my numbers on xomoni.com* is off until the person turns it on in the extension or on the website.
   - Turning it off stops the reports and deletes every row already sent.
   - Deleting the Xomoni account deletes them too.
4. **The database enforces the shape.**
   - `daily_stats` has only the columns above.
   - Rows are written only by `device_report_stats(token, rows)`, a security-definer function on the device token (ADR-0018). It checks each value: a whole number from 0 to 10⁹. Each day must fall in the last 400 days and not in the future. A call carries at most 60 rows.
   - Row Level Security lets the owner read their rows and nothing else; `anon` and `authenticated` have no write privilege.
   - A pgTAP test checks all of it.
5. **The privacy page and the landing page's *Synced when you sign in* list name the daily numbers** before this ships.

Built in [#249](https://github.com/pirdehi/xomoni/issues/249) (the extension) and [#250](https://github.com/pirdehi/xomoni/issues/250) (the cloud and the toggle).

## Consequences

- The dashboard works on any device. Emailed reports become possible.
- A breach of the cloud database would also expose an account's daily counts: followers, posts, likes. It would still expose no post, reply, like or person.
- **What is exact and what is estimated:**
  - *Received per day* is an estimate. X gives totals per post, not the time of each like, and Xomoni sees only the posts X shows. `observed_posts` lets the website say so.
  - *Published per day* and the removals are exact.
- **History:**
  - Published-per-day history starts with the archive.
  - Received numbers and follower changes start on the first day the person turns the numbers on.
- Adding a column means amending this ADR.
