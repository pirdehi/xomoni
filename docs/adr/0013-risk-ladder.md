# ADR-0013: A risk ladder that backs off one step before X does

- Status: Accepted
- Date: 2026-10-31

## Context

X escalates gradually: rate limits, then error 226 ("looks automated"), then temporary restrictions, account locks and finally suspension (PLAYBOOK C1). Until now Xomoni stopped on 226 but let the person resume at once, waited only 3 to 6 minutes after a lock, and kept no memory of earlier warnings, so the same pace could walk an account up X's ladder. Roadmap issue #17 asked for Xomoni's own ladder.

## Decision

- **Events, not state.** Every warning from X (226, lock, refused write, suspension, silent block, rate limit) is stored as a dated event per account in the extension's IndexedDB (`risk` table). The level, the pace, resume locks and full stops are derived from those events by a pure function, `assessRisk` in `apps/extension/src/shared/risk.ts`, so they survive restarts and are unit tested. The same signal within 10 minutes counts once.
- **The ladder** (PLAYBOOK §7):

  | Level | Triggered by | Response |
  | --- | --- | --- |
  | 1 Caution | one rate limit in the last hour | the limiter waits for the reset and slows down |
  | 2 Retreat | first 226, or two rate limits within an hour | resume locked 6 h; half pace for 7 days |
  | 3 Defensive | second 226 within 7 days (resume locked 24 h), an account lock, or a refused write (resume locked 12 h) | a quarter of the pace for 48 h, then half until the week is over |
  | 4 Full stop | suspension or silent block (30 days), second lock or third 226 within 7 days | no automatic resume |

- **Only slower.** The ladder multiplies Xomoni's one-fifth allowances (ADR-0012) by 1, 0.5 or 0.25, together with the warm-up, and each 226, lock, refusal or silent block of the last two weeks drops the warm-up back a step. Nothing on the ladder can raise the pace.
- **The person decides past a stop.** A resume lock or a full stop holds Resume back with a countdown. "Resume anyway" requires typing RESUME, records an `override` event, and keeps the pace at a quarter for 48 hours; any new warning from X applies again.
- **After an X check or lock,** Xomoni rests 60 to 90 minutes before acting (was 3 to 6).
- **Shown on the dashboard:** the limits panel shows the level, why, when resume opens and how long the slower pace lasts. Caps and time estimates use the same factor a run would.

## Consequences

- Warnings from X now cost days of reduced pace, by design.
- A person can still choose to continue, but only deliberately and at a quarter of the pace.
- Silent blocks (#22) are on the ladder: a sampled action that X confirmed but did not apply records a `silent_block` event, a full stop (PLAYBOOK C5). The health report (#25) will read the same events.

## Amendments

- 2026-10-31, #22: added the `silent_block` event (full stop for 30 days, drops the warm-up a step).
