# ADR-0031: A weekly email of the daily numbers, only for those who ask, sent by the database

- Status: Accepted
- Date: 2026-11-20

## Context

Reports (#257) asks for a scheduled email digest of the daily numbers, "only when the person turned them on". The daily numbers already reach the cloud by the person's choice, as counts only ([ADR-0026](0026-daily-numbers-in-the-cloud.md)).

Sending an email on a schedule needs three things xomoni.com doesn't have yet:

- a sender with a key;
- a clock;
- a way to stop the email without signing in.

The website must never hold a secret key (SECURITY.md: only the publishable key in `apps/web`), so it can't be the sender.

## Decision

1. **Only for those who ask.**
   - The email is off for everyone. The person turns it on on xomoni.com, and only while their daily numbers are on.
   - Turning the daily numbers off turns the email off too.
2. **Counts only.**
   - The email holds what Reports' weekly report holds, as totals for all the person's X accounts:
     - followers;
     - posts and replies published;
     - likes and replies received (marked as estimates);
     - views;
     - what Xomoni removed.
   - Each comes with its change against the week before.
   - No X content, no handles, and no account names beyond the person's own email address.
3. **The database sends it.**
   - Supabase's scheduler (`pg_cron`) runs once a week, on Monday at 07:00 UTC, for the seven days before.
   - It calls a `security definer` function that only the database's owner can run. The function builds each email and hands it to Resend's API with `pg_net`.
   - The Resend key lives in Supabase Vault (`resend_api_key`) and can only send from xomoni.com.
   - Without that key, the function sends nothing.
   - Resend already sends Xomoni's sign-in emails, so the person's address goes nowhere new.
4. **At most one a week to each person, only when there is something to say.**
   - Nothing is sent for a week without numbers.
   - A sent email is recorded (`last_sent_at`), so a second run in the same week sends nothing.
5. **Stopping takes one click, without signing in.**
   - Every email has a link with the person's own random token. It opens a page with one button, so a mail scanner that follows links can't stop it by accident.
   - Every email also has the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058), so the mail app's own button stops it.
   - The token stops that person's email and does nothing else.
6. **Nothing else is sent this way.** Another kind of email needs its own decision.

Built in [#257](https://github.com/pirdehi/xomoni/issues/257).

## Consequences

- People who want their week in their inbox get it without opening xomoni.com, and nobody else gets anything.
- The numbers a person chose to show now also pass through Resend, as an email to that person. They are counts, the same as on the dashboard.
- The key is a secret in the database, readable only by its owner. Rotating it means updating one Vault secret.
- `pg_cron` and `pg_net` are enabled. The function they run is tested with the database tests, and a test run never sends anything, because a request leaves only after its transaction commits.

## Alternatives considered

- **Send from xomoni.com on Vercel with a scheduled route.** It would need the database's admin key and a Resend key in the website, which SECURITY.md rules out.
- **A Supabase Edge Function.** It would work, but it adds a second runtime (Deno) and its own deploys and tests, for what one SQL function can do.
- **Email every account with numbers on.** Simpler, but nobody asked for it, and an email nobody asked for is spam.
