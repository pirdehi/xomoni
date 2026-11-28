# ADR-0042: Payments and entitlements: Polar as merchant of record, only the plan in the cloud, and a paywall a fork can remove

- Status: Accepted
- Date: 2026-11-23

## Context

Xomoni has never taken a payment. R1, release 0.7.0, brings the first paid plans (#420 to #423). No decision says yet:

- where a payment happens;
- what the server keeps about it;
- how the extension learns a person's plan;
- what happens when the extension can't ask.

Each answer touches a rule Xomoni already keeps:

- **X data stays in the browser** ([ADR-0004](0004-x-data-stays-local.md)). So a paid feature can't be checked on a server: the server never sees the data the feature works on.
- **The website can't start, resume or approve work on X** ([ADR-0006](0006-website-is-view-only.md)). Paying must not become a way to act on X.
- **The extension talks to the cloud with a device token,** through a few functions ([ADR-0018](0018-pair-the-extension-with-a-one-time-code.md)). It signs in and out with the website in the same browser ([ADR-0025](0025-one-sign-in-for-the-website-and-the-extension.md)).
- **Two-step verification is checked on the server** ([ADR-0036](0036-two-step-verification-with-an-authenticator-app.md)): an account with an authenticator app acts only from an `aal2` session.
- **The code is public, under the MIT licence.** Anyone may build Xomoni from it.

Selling also brings taxes in many countries, card data, refunds and chargebacks. One person maintains Xomoni, and Xomoni should hold none of that. xomoni.com runs on Vercel, whose free plan doesn't allow commercial use.

This amends ADR-0004. What the cloud keeps about a plan is data about a Xomoni account, not X data, and it doesn't come from the extension.

## Decision

1. **Polar is the merchant of record.**
   - People pay on Polar's checkout, opened from xomoni.com. The extension takes no payment, and only links to xomoni.com.
   - Polar keeps the card, the billing address and the tax. It issues receipts and handles refunds and chargebacks. Xomoni never sees or stores card data.
   - One adapter calls Polar's API (`modules/billing/infrastructure/polar-client.ts`). A checkout names the Supabase user id as Polar's `external_customer_id`, and nothing else about the person. No X content goes into Polar's metadata.
   - Starting a checkout, opening Polar's customer portal, and deleting an account with a subscription are Server Actions behind `requireAccount()`. For an account with an authenticator app they need an `aal2` session (ADR-0036).
   - Deleting the account cancels the subscription at Polar first, then deletes the row.
   - Paying never starts, resumes or approves anything on X (ADR-0006).
2. **The cloud keeps the plan, and nothing else about the payment.** One migration adds three tables.

   | Table | What it holds |
   | --- | --- |
   | `entitlements` | One row per Xomoni account: the user id, the plan (`free`, `plus`, `pro`), the status (`active`, `trialing`, `past_due`, `canceled`, `revoked`), the source (`subscription`, or a one-time `pass`), `valid_until`, `cancel_at_period_end`, `founding`, Polar's customer and subscription ids, and the time of the event it came from |
   | `billing_events` | One row per webhook delivery: its id, its type, when it arrived and its result (`applied`, `ignored`, `stale`) |
   | `billing_settings` | One row: `live`, whether sales are open |

   - No email, name, address or event body is stored, and no X content: no handle, no post and no count.
   - Row Level Security lets a person read their own `entitlements` row and nothing else. `anon` and `authenticated` can write none of the three tables, and can't read `billing_events` or `billing_settings`.
   - Deleting the account deletes the row.
   - A pgTAP test checks all of it.
3. **Only a signed webhook writes.** Polar sends its events to `POST /api/billing/webhook`. The route:
   - checks the Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`): an HMAC-SHA256 of the raw body, made with Web Crypto, compared in constant time, and only within 5 minutes of its timestamp;
   - parses the body strictly, from `unknown` ([ADR-0016](0016-strict-typescript-and-type-aware-lint.md)), taking only the event types it knows;
   - writes only through `apply_billing_event(…)`. It is a security-definer function with an empty `search_path`, and only `service_role` may run it.

   Every event takes effect once:
   - a webhook id seen before is `ignored`;
   - an event older than the row's is `stale`, so a retry or an event out of order can't undo a newer state.

   The route answers:
   - 401 for a bad signature or a stale time;
   - 400 for a malformed body;
   - 202 for an event type it doesn't act on;
   - 500 for a database error, so Polar sends the event again;
   - 200 for a repeat.

   Its logs keep the webhook id, the type and the result, never the body, an email or a key. If an event is lost, *Refresh* on `/account/billing` asks Polar directly and writes through the same function. Pressing it again and again is rate-limited.
4. **The `service_role` key stays on the server, in one module.**
   - It is set only in Vercel's settings, separately for Production and Preview.
   - Only the webhook's `server-only` module reads it. `npm run arch` refuses an import of it from anywhere else, and a test checks that no browser bundle contains it.
   - Polar's keys are environment variables, documented in `apps/web/.env.example`. They are never in code, a pull request or a log.
5. **The extension reads the plan over the connection it already has.**
   - `device_report` (ADR-0018) also answers `entitlement`: the effective plan, its status and `valid_until`. It answers `billing_live` too. Both sit beside `stats` ([ADR-0026](0026-daily-numbers-in-the-cloud.md)), and the rest of the answer is unchanged.
   - A device's token gives only its own account's plan.
   - The extension keeps the answer in `kv`, where content scripts can't reach it, with the time it checked (`checkedAt`).
   - It reports again when the dashboard is shown, so a purchase opens Plus without waiting for the next heartbeat.
   - No new message from the website and no new permission take part.

   **Offline, the last plan lasts 7 days** (`GRACE_DAYS`). When the extension can't ask (no network, Supabase down, an answer it can't parse), it keeps the last plan until 7 days after `checkedAt`, then counts as Free.
   - A `checkedAt` in the future counts as Free.
   - An answer it can't parse never erases the plan it had.
   - A device that isn't connected, or is signed out, is Free.
   - Falling back to Free deletes nothing.
6. **Data is never held hostage, and safety is never for sale.**
   - These stay free on every plan: exporting one's data (the vault's open export, [ADR-0044](0044-an-open-export-of-the-vault.md), and *Download a copy*), *Delete local data*, and the move file ([ADR-0032](0032-move-data-between-xomoni-versions.md)).
   - So does every safety rail: the pacing, the stop rules, the risk ladder, and every later feature that protects an account.
   - A plan opens views. It never locks data a person already has: when a plan ends, the paid views close and the data stays.
7. **The paywall is one function, and a fork may remove it.**
   - `hasPlan(entitlement, feature, now, { live })` in `@xomoni/entitlements` is the only check.
   - Every paid part of the extension and the website asks it, through one list of features (`FEATURES`) and one component (`PlanGate`).
   - A build variable, `XOMONI_PAYWALL=off`, opens every feature, so anyone can build Xomoni without the paywall.
   - There is no obfuscation, no hidden check, no licence key, and no call home beyond `device_report`.

   A fork that removes the paywall is accepted.
8. **Sales open with a switch, not a release.**
   - Until `billing_settings.live` is on, `hasPlan` opens every paid feature with a *Plus · preview* badge. The pricing page says *Coming soon*, and no checkout is made.
   - The maintainer turns it on once the *Billing launch* section of R1's release issue is complete ([ADR-0037](0037-one-written-gate-for-every-merge-and-release.md)): the Polar account, a hosting plan that allows commercial use, the terms of sale and the refund policy approved, and a purchase and a refund tried in Polar's sandbox.
   - Turning it off again needs no release either.

Built in [#420](https://github.com/pirdehi/xomoni/issues/420) (the data and the package), [#421](https://github.com/pirdehi/xomoni/issues/421) (the webhook and checkout), [#422](https://github.com/pirdehi/xomoni/issues/422) (the pages) and [#423](https://github.com/pirdehi/xomoni/issues/423) (the extension and the launch).

## Consequences

- **A breach of the cloud database** would also show who pays, for which plan, until when, and Polar's ids for them. It would still show no X content, no card and no address.
- **Polar is a dependency.** If it changes or goes, the adapter, the webhook's parser and the event mapping change. The table is ours, and nothing else is tied to Polar.
- **The plan check relies on Supabase.** The 7 days cover an outage and the free project pausing. A longer outage closes the paid views, never the data.
- **Every paid feature is listed in `FEATURES` and wrapped in `PlanGate`.** Review refuses a paid check anywhere else. No safety rail may ever appear in `FEATURES`.
- **Disclosure.**
  - The store listings say which features are paid, and that payment happens on xomoni.com only (`docs/STORE-LISTING.md`).
  - The privacy page names Polar as a processor before sales open.
  - The terms of sale and the refund policy are on xomoni.com, linked from the footer and the pricing page.
- **The website changes.**
  - The Content-Security-Policy's `form-action` admits Polar's checkout origins, named exactly ([ADR-0014](0014-security-headers-and-a-static-csp.md)).
  - The webhook route skips the proxy's same-origin check, and its signature check takes that check's place.
  - New environment variables are documented in `.env.example`.
- **Releases.** Sales opening is a box in the release checklist. A release must not ship a paid feature that bypasses `hasPlan`.

## Alternatives considered

- **Stripe directly.** Xomoni would be the merchant: tax registration and returns in every country, card disputes, and more payment data on our side.
- **Paddle.** Also a merchant of record, but with a slower, heavier review to get started.
- **Lemon Squeezy.** Its future as a merchant of record of its own is uncertain, so it is a poor base for new sales.
- **A licence key in the extension.** It works offline, but keys get shared and leak, need their own revocation, and add a secret to keep. The plan from `device_report` needs nothing new.
- **Checking paid features on the server.** Impossible without the data, which never leaves the browser (ADR-0004).
- **Paying inside the extension.** The stores have rules for in-extension payments, and it would need a permission. A link to xomoni.com keeps payment in one place.
