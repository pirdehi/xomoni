# ADR-0012: Use at most one fifth of every limit X announces

- Status: Accepted
- Date: 2026-10-31

## Context

X enforces quotas on every kind of request, and an account that runs close to them is more likely to be throttled, challenged (error 226) or restricted. X publishes some limits (in its API documentation and Help Center) and reports others live in the `x-rate-limit-limit / remaining / reset` headers of its own web app. Until now Xomoni's Careful preset used numbers of its own (150 deletes an hour, 1,000 a day), and the limiter only stopped when X's live quota was nearly empty (`remaining ≤ 1`). Roadmap issue #26 asked for a decision on the caps. The maintainer decided: for every limit X itself announces, Xomoni uses one fifth, never more under any circumstances, and less than that at the start.

## Decision

- **The share is 1/5.** `SAFETY_SHARE` in `apps/extension/src/shared/x-limits.ts`; `share(limit) = max(1, floor(limit / 5))`.
- **Published limits, one source of truth.** `X_PUBLISHED_LIMITS` lists each limit X publishes that bears on Xomoni, with its source URL and the date it was checked (31 October 2026):

  | X limit (per account) | X allows | Xomoni uses at most | Source |
  | --- | --- | --- | --- |
  | Delete a post | 50 / 15 min | 10 / 15 min | X API rate limits |
  | Undo a repost | 50 / 15 min | 10 / 15 min | X API rate limits |
  | Unlike | 50 / 15 min, 1,000 / day | 10 / 15 min, 200 / day | X API rate limits |
  | Like (ghost-like cleanup) | 50 / 15 min, 1,000 / day | 10 / 15 min, 200 / day | X API rate limits |
  | Search | 300 / 15 min | 60 / 15 min | X API rate limits |
  | Profile timeline | 900 / 15 min | 180 / 15 min | X API rate limits |
  | Liked posts | 75 / 15 min | 15 / 15 min | X API rate limits |
  | Open a post | 900 / 15 min | 180 / 15 min | X API rate limits |
  | Original posts, replies (unverified) | 50 / day, 200 / day | not used: Xomoni never posts | X Help Center |

  Sources: <https://docs.x.com/x-api/fundamentals/rate-limits>, <https://help.x.com/en/rules-and-policies/x-limits>.
- **An absolute ceiling.** No preset, custom setting, retry or later feature may go above one fifth. Every path that changes pace only goes slower (warm-up, slowdown after errors, the risk ladder in #17).
- **Every request counts.** X counts requests, not successes, so every request that reached X spends the budget: failed, already-gone and rate-limited ones included. Only actions Xomoni never sent (`skipped`, `logged_out`) are left out.
- **Even lower at the start (warm-up).** An account's first active day runs at a quarter of one fifth (1/20 of X's limit), the second at half, the third at three quarters, and from the fourth active day at one fifth. Caps shrink and delays grow by the same factor, so the pace stays even. After 14 days without activity the warm-up starts again. On day one that means at most 2 deletes per 15 minutes (8 an hour, 240 a day).
- **Live limits.** For every X operation, once one fifth of the window X reports is used (`limit − remaining ≥ limit / 5`, counting the person's own browsing too), Xomoni waits until X resets the window. A 429 always waits for the reset.
- **Budgets, not actions.** Each action spends X's budgets: a ghost-like cleanup spends both the like and the unlike budget, so it shares the 200-a-day unlike allowance with ordinary unlikes. A page load spends the read budget of that page (search, timeline, likes, post page).
- **Derived caps.** Per-action hourly and daily ceilings follow from the allowances (deletes: 40 an hour, 960 a day; unlikes: 40 an hour, 200 a day). The single preset, Careful, runs at these ceilings with delays of 80 to 120 seconds, so the pace stays even instead of filling each 15-minute window in a burst. Custom settings are clamped to the ceilings on load and on save; they can be slower, never faster. The Balanced preset is retired; stored settings that used it become Careful.
- **Page loads.** X publishes no limit for loading its pages. Xomoni keeps its own page-load ceiling (240 an hour, 2,400 a day) and applies one fifth of each page's own quota on top.

## Consequences

- Cleanups are slower: about 36 deletes an hour at most, instead of up to 150. A 10,000-post cleanup takes days, which the dashboard's estimate shows.
- The numbers have one home. When X changes a published limit, update `X_PUBLISHED_LIMITS` with the new source date; every cap, the Settings table and the tests follow.
- Tests (`apps/extension/tests/x-limits.test.ts`, `limiter.test.ts`) fail if any preset, custom setting or warm-up step exceeds one fifth of any X limit, if failed requests stop counting, or if the live-limit rule changes.
- The risk ladder (#17) will lower the pace further after X's checks; like the warm-up, it can never raise it above one fifth.

## Alternatives considered

- Keep Xomoni's own numbers: they were not tied to anything X publishes and allowed up to 3× X's API rate for deletes.
- A higher share (one half): rejected by the maintainer; one fifth leaves room for the person's own use of X and for limits X does not publish.
