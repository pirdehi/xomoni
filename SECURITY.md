# Security policy

## Reporting a vulnerability

Please report security issues privately, not in public issues:

- GitHub: **Security → Report a vulnerability** on [pirdehi/xomoni](https://github.com/pirdehi/xomoni/security/advisories/new), or
- email **privacy@xomoni.com**.

Include what you found, how to reproduce it, and the impact you expect. You'll get an answer within a few days. Please give a reasonable time to fix the issue before disclosing it.

## Scope

In scope: the Xomoni extension (`apps/extension`), the website at xomoni.com (`apps/web`), and the database rules (`supabase/`). For example:

- anything that lets one user read or change another user's data (Row Level Security, auth flows, redirects);
- ways for a web page or x.com to make the extension act without the person's intent;
- leaks of session tokens, or of X content that should never leave the browser;
- anything that weakens the safety rules in [ADR-0003](docs/adr/0003-no-credentials-no-evasion.md).

Out of scope: X's own platform, rate limits or enforcement decisions; social engineering; denial of service against hosted services.

## How Xomoni is designed to limit damage

- The extension never handles X passwords or session cookies, and never sends its own requests to X ([ADR-0002](docs/adr/0002-drive-x-ui-not-the-api.md), [ADR-0003](docs/adr/0003-no-credentials-no-evasion.md)).
- X content stays in the browser; the cloud stores job status only ([ADR-0004](docs/adr/0004-x-data-stays-local.md)).
- The website cannot start deletions ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- Every database table has Row Level Security; the browser uses only the publishable key.

## Cloud security review (2026-10-31)

A review of what the cloud side exposes today: Supabase (Postgres with Row Level Security, the Data API, Realtime, Auth) and the website ([#42](https://github.com/pirdehi/xomoni/issues/42)). Each check ran against the local stack with real requests; production settings were read from `supabase/config.toml` and the live headers. How the extension stores its session is reviewed when it learns to sign in ([#38](https://github.com/pirdehi/xomoni/issues/38)).

### Holds

| Area | What was checked |
| --- | --- |
| Anonymous access | No table access (HTTP 401); `delete_account()` refused; the Data API's OpenAPI root lists no paths; GraphQL (`pg_graphql`) is not enabled, locally or in production. |
| Row Level Security | 26 pgTAP tests in CI: a user can't read, change, delete or attach to another user's rows, or hand a job to someone else. |
| Realtime data | Row Level Security applies: a user who subscribes with another user's id as the filter receives nothing; without a filter, only their own rows. |
| Auth | Confirmed email before sign-in; email changes confirmed on both addresses; password change needs the current password; Turnstile on sign-up, sign-in and reset; production limits of 30 sign-ins per 5 minutes per IP and 30 emails per hour; 1-hour access tokens with refresh-token rotation. |
| Sessions | Signing out revokes that session's refresh token; *Sign out everywhere* revokes every session's. Changing the password revokes every other session's refresh token; their access tokens expire within the hour. |
| Keys | The browser and the website use only the publishable key. No service-role or secret key in `apps/web`. |
| Website | Security headers and a static CSP on every response, no raw HTML ([ADR-0014](docs/adr/0014-security-headers-and-a-static-csp.md)). The session cookies aren't `HttpOnly` (the browser client reads them, by `@supabase/ssr`'s design); the CSP is what keeps other scripts from reading them. |
| CORS | Vercel answers pages with `Access-Control-Allow-Origin: *`. Browsers never send cookies on such reads, so signed-in pages can't be read cross-site. |

### Findings

| Finding | Severity | Follow-up |
| --- | --- | --- |
| `delete_account()` accepts any valid session; *Type DELETE* is checked only in the page. A stolen session can delete the account and its history at once. | Medium | Fixed: `delete_account()` needs a sign-in within the last 10 minutes ([#80](https://github.com/pirdehi/xomoni/issues/80)). |
| Every dashboard joins one public Realtime topic. Anyone with the publishable key can broadcast to all open dashboards (ignored by the page today), and anonymous subscribers see an empty event for every job change of every user, which reveals activity timing but no content. | Low | [#81](https://github.com/pirdehi/xomoni/issues/81): a private channel per user. |
| Nothing limits how many devices or jobs one account writes (300 devices in one request worked). | Low | [#82](https://github.com/pirdehi/xomoni/issues/82): caps per account and per device. |
| Sign-out ends only the current session. Accounts that use Google have no password to change, so they can't end a session left elsewhere. | Low | Fixed: *Sign out everywhere* on the account page ([#83](https://github.com/pirdehi/xomoni/issues/83)). |

The Data API has no per-user request rate limit; the caps in #82 and the 1,000-row `max_rows` bound what one account can do with it.

## Supported versions

Only the latest release and the `main` branch receive fixes.
