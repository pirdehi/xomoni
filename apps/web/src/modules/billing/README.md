# `modules/billing`: payments with Polar

Paid plans on xomoni.com ([ADR-0042](../../../../../docs/adr/0042-payments-and-entitlements-with-polar.md)). Polar is the merchant of record: people pay on Polar's checkout, and the cloud keeps only each account's plan (`entitlements`, written only by Polar's signed webhook through `apply_billing_event`, [`supabase/`](../../../../../supabase/README.md)). Nothing here starts, resumes or approves anything on X (ADR-0006), and no X content goes to Polar (ADR-0004).

The module grows with R1: the webhook route, checkout and the customer portal come in #421, `/pricing` and `/account/billing` in #422. Today it holds the check every webhook passes first.

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `infrastructure/` | `webhook-signature.ts` | `verifyWebhook(headers, body, secret, now)`: the Standard Webhooks signature Polar puts on each delivery (`webhook-id`, `webhook-timestamp`, `webhook-signature`), an HMAC-SHA256 of `<id>.<timestamp>.<raw body>` keyed with the secret's UTF-8 bytes, as Polar's own SDK keys it. Web Crypto's `verify` compares it in constant time, and only within 5 minutes of its timestamp (`WEBHOOK_TOLERANCE_MS`), either way. Any one of several `v1,` signatures may match, so Polar can rotate its secret. The answer is the delivery's id and time, or why not: `missing`, `stale` or `bad-signature`. It reads no environment: the route passes the secret. |

## Rules

- **Only a signed webhook writes a plan.** The route (#421) checks the signature before it reads the body, and writes only through `apply_billing_event`, with the `service_role` key, from one `server-only` module.
- **No test reaches the real Polar.** Unit tests use `test/fakes/polar.ts` (a fake API, failures on demand, and `signTestEvent`, an independent signer with Node's own HMAC); the browser tests use `e2e/support/polar.ts` (a fake Polar on localhost, which the website's server finds at `POLAR_API_URL`). `test/setup.ts` and `e2e/support/test.ts` fail any test that asks polar.sh for anything.
- **Polar's keys are environment variables** (`apps/web/.env.example`), never in code, a pull request or a log.

## Tests

`infrastructure/webhook-signature.test.ts`: an event the fake Polar signed passes; another secret, a changed body, a signature moved to another id or time, a time more than 5 minutes away, a missing or malformed header, and a signature of another version or shape don't; any one of several signatures may match; an empty secret is the server's error. The fake's own tests are in `test/fakes/polar.test.ts`, and `e2e/polar.spec.ts` proves the fake Polar in a browser: a paid checkout returns to its `success_url`, and its signed event passes the real check.
