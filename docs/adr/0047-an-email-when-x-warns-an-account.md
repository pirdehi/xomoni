# ADR-0047: An email when X warns an account, only for those who ask, sent by the database

- Status: Accepted
- Date: 2026-11-23

## Context

When X warns an account, Xomoni stops or slows down on its risk ladder ([ADR-0013](0013-risk-ladder.md)), and the dashboard and xomoni.com show it. A person who isn't looking learns of it only when they next open Xomoni or xomoni.com. A stop after a second rate limit, a 226 or a lock is exactly when they should rest the account themselves, and not, say, keep posting by hand (#407).

The weekly email ([ADR-0031](0031-weekly-email-of-the-daily-numbers.md)) already sends from the database through Resend, with the key in Vault. Its point 6 says another kind of email needs its own decision: this is that decision.

The server already has what such an alert needs. Each job report carries its X account's handle and the account's level on the ladder, a number from 0 to 4 (`public.jobs.risk_level`). It never carries X's notice or a post ([ADR-0004](0004-x-data-stays-local.md)).

## Decision

1. **Only for those who ask.** The alert is off for everyone. The person turns it on in xomoni.com's Settings, and off there or from the link in any alert.
2. **When.**
   - An alert is queued when a report raises an account's level to Retreat (2) or above.
   - Caution (1, a single rate limit) never queues one.
   - An account's level is the highest its jobs reported in the last day. Two browsers on one X account can report different levels; the higher one counts, the more careful choice, so one browser's Normal can't undo the other's rest.
   - The same rise is told once. A report at the same level or lower queues nothing, and 3 → 2 → 3 within a day queues nothing more. A higher level (2 → 3, 3 → 4) queues another, and so does the same rise a day later.
   - An alert counts as told only once it is sent: one dropped before the send silences nothing.
3. **What it says.**
   - The email holds the account's @handle and fixed words for its level: when Xomoni may resume at the earliest, in UTC (6 hours after Retreat, 12 after Defensive), or that only the person can resume after a full stop. Then: rest the account.
   - It holds nothing X showed and nothing the person posted.
   - It never asks for anything. Its only links open the dashboard's Account health and stop the alerts. There is no button that resumes, approves or starts work ([ADR-0006](0006-website-is-view-only.md)).
4. **The database sends it, as the weekly email.**
   - Supabase's scheduler runs `send_health_alerts()` every five minutes. Only the database's owner, and the admin key for the local stack's tests, may run it.
   - It hands each email to Resend's API with `pg_net`. The key is `resend_api_key` in Vault, the weekly email's.
   - Without that key nothing is sent, and the website's Settings says so: the choice is kept for when it is.
5. **Rare.**
   - One email per person at a time, however many accounts rose, at most one every six hours. An alert that comes sooner waits for the next send after that. An email names ten accounts at most, then says how many more.
   - An alert is dropped instead of sent when the person turned the alert off, when the account rested back below Retreat before the send, or when it waited a day.
   - A send claims the alerts it sends before it builds the email, and skips a person another send is handling: an alert is never sent twice, and one queued meanwhile waits for the next email. Each sent alert keeps the id of its `pg_net` request, to find a failed send in `net._http_response`.
6. **Stopping.**
   - Every email has a link with the person's own random token. It opens a page with one button, so a mail scanner that follows links can't stop it by accident.
   - Every email also has the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058), for the mail app's own button.
   - Stopping drops what waits. The token stops that person's alerts and nothing else, and the stop answers the same for any token.
7. **What is kept, and for how long.**
   - For someone who hasn't turned the alert on, nothing: the trigger stops before it keeps anything.
   - For someone who has: each X account's level and the last level an email told (`health_alert_levels`), and each alert (`health_alert_queue`: the handle, the level, when, and the request's id).
   - Turning the alert off, or its stop link, deletes the levels and drops what waits. An account with no job left loses its level at the next run. An alert is deleted a week after it was sent or dropped. Deleting the account deletes everything.
   - The privacy page says so.
8. **Who reads what.**
   - The person reads their own choice and whether xomoni.com can send (`health_alert_status`), never the token.
   - Nobody reads the levels or the queue through the Data API.
   - Accounts with an authenticator app need `aal2` for the choice, as for every private row ([ADR-0036](0036-two-step-verification-with-an-authenticator-app.md)).

Built in [#407](https://github.com/pirdehi/xomoni/issues/407).

## Consequences

- Someone who isn't looking learns that X warned their account within minutes, and can rest it.
- A handle and a level now pass through Resend, in an email to the person who asked. Both were already on the server; the address is the one Resend already writes to.
- The schedule runs every five minutes. Without a waiting alert it sends nothing, and it only drops stale alerts.
- The alert follows the level the extension reports. Since a job's report carries the account's level when it reports, a rise reaches the server with the report that follows the warning. That is usually the job stopping.
- The times in the email are in UTC: the server doesn't know the person's time zone.
- `PLAYBOOK.md`'s "what the server sees" stays true: nothing new leaves the browser.

## Alternatives considered

- **An amendment of ADR-0031.** It says another kind of email needs its own decision, and this one is about safety, with rules of its own.
- **Send from the extension, or a browser notification.** Xomoni already shows a notification while its dashboard is open. The person this alert is for may not be at that computer.
- **Send on every report at Retreat or above.** That would mail every few minutes during a rest. One alert per rise, and at most one email every six hours, is enough.
- **Include X's notice or the job's title.** Both are X content or the person's own words, which stay in the browser (ADR-0004).
