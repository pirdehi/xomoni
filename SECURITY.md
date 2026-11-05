# Security policy

## Reporting a vulnerability

Please report security issues privately, not in public issues:

- GitHub: **Security → Report a vulnerability** on [pirdehi/xomoni](https://github.com/pirdehi/xomoni/security/advisories/new), or
- email **privacy@xomoni.com**.

Include what you found, how to reproduce it, and the impact you expect. You'll get an answer within a few days. Please give a reasonable time to fix the issue before disclosing it.

The same contacts are in [xomoni.com/.well-known/security.txt](https://xomoni.com/.well-known/security.txt) ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)). Its `Expires` is renewed yearly; a unit test fails 30 days before it lapses.

## Scope

In scope: the Xomoni extension (`apps/extension`), the website at xomoni.com (`apps/web`), and the database rules (`supabase/`). For example:

- anything that lets one user read or change another user's data (Row Level Security, auth flows, redirects);
- ways for a web page or x.com to make the extension act without the person's intent;
- leaks of session tokens, or of X content that should never leave the browser;
- anything that weakens the safety rules in [ADR-0003](docs/adr/0003-no-credentials-no-evasion.md).

Out of scope: X's own platform, rate limits or enforcement decisions; social engineering; denial of service against hosted services.

## How Xomoni is designed to limit damage

- The extension never handles X passwords or session cookies, and never sends its own requests to X ([ADR-0002](docs/adr/0002-drive-x-ui-not-the-api.md), [ADR-0003](docs/adr/0003-no-credentials-no-evasion.md)).
- X content stays in the browser; the cloud stores job status only ([ADR-0004](docs/adr/0004-x-data-stays-local.md)). The extension's Content-Security-Policy enforces it: its pages can connect only to Xomoni's own API, never to X or anywhere else (#143).
- What reaches the extension from X's page is checked before it is used (#145). The service worker hears only Xomoni's own content script in the top frame of an x.com tab, and stores only messages whose every field has the expected shape and size. The content script takes commands only from Xomoni's own pages. The page-world interceptor captures only requests to x.com and uses built-ins taken before any of X's scripts run, so a page script can't rewrite what it captures. Right before a delete, the post's id must agree with its stored date and with the time X shows, and its text on the page must not contain a word the rule keeps. A rate-limit reset more than a day ahead is cut to a day.
- Local data is kept tidy (#151). The xomoni.com token lives in the extension's IndexedDB, out of reach of content scripts. "Delete local data" disconnects xomoni.com and clears every table except page-load times and risk events, which hold no X content and keep X's limits in force. If xomoni.com can't be told about a disconnect, the person is asked to remove the browser there. Archive files above 512 MB are refused, and a downloaded archive page carries a CSP that forbids scripts. A connected browser hears about a newer release, and whether it fixes a vulnerability, in the answer to its status report; a security release can't be dismissed.
- The website cannot start deletions ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- Every database table has Row Level Security; the browser uses only the publishable key.
- Releases are built with a read-only token from a commit on `main`, signed with build provenance, reproducible and immutable once published ([releasing](docs/RELEASING.md#checking-a-download), #142).

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
| Website | Security headers and a static CSP on every response, no raw HTML ([ADR-0014](docs/adr/0014-security-headers-and-a-static-csp.md)). Trusted Types guard every script sink: one `default` policy lets through only the site's own bundles and Turnstile's loader, and HTML without markup. Violations are reported to `/api/csp-report` and logged. `Cross-Origin-Resource-Policy: same-origin` (except the email logo), images only from the site and Google's avatar host. `POST /auth/signout` refuses a request whose `Origin` isn't the site (#147). The session cookies aren't `HttpOnly` (the browser client reads them, by `@supabase/ssr`'s design); the CSP and Trusted Types are what keep other scripts from reading them. |
| CORS | Vercel answers pages with `Access-Control-Allow-Origin: *`. Browsers never send cookies on such reads, so signed-in pages can't be read cross-site. |

### Findings

| Finding | Severity | Follow-up |
| --- | --- | --- |
| `delete_account()` accepts any valid session; *Type DELETE* is checked only in the page. A stolen session can delete the account and its history at once. | Medium | Fixed: `delete_account()` needs a sign-in within the last 10 minutes ([#80](https://github.com/pirdehi/xomoni/issues/80)). |
| Every dashboard joins one public Realtime topic. Anyone with the publishable key can broadcast to all open dashboards (ignored by the page today), and anonymous subscribers see an empty event for every job change of every user, which reveals activity timing but no content. | Low | Fixed in part: each dashboard joins a private channel `dashboard:<user id>` that only its owner may join, so nobody can broadcast to other people's dashboards ([#81](https://github.com/pirdehi/xomoni/issues/81)). The empty change events reach anonymous subscribers of any public channel until public channels are turned off for the project, a setting in the Supabase dashboard. |
| Nothing limits how many devices or jobs one account writes (300 devices in one request worked). | Low | Fixed: at most 10 devices per account, and the newest 1,000 jobs per device ([#82](https://github.com/pirdehi/xomoni/issues/82)). |
| Sign-out ends only the current session. Accounts that use Google have no password to change, so they can't end a session left elsewhere. | Low | Fixed: *Sign out everywhere* on the account page ([#83](https://github.com/pirdehi/xomoni/issues/83)). |

The Data API has no per-user request rate limit; the caps from #82 (at most 10,000 job rows per account) and the 1,000-row `max_rows` bound what one account can store and read with it.

## Monitoring and alerts

Everything below alerts one person, the maintainer, through GitHub's notifications (web and email). There is no on-call rotation.

| Check | What it watches | When it alerts |
| --- | --- | --- |
| Private vulnerability reports and privacy@xomoni.com | Reports from anyone | When one arrives. The maintainer answers within a few days and works on a critical issue (another person's data, a leaked secret, a way around sign-in) first. |
| CodeQL code scanning (default setup, `security-extended` queries, JavaScript/TypeScript and GitHub Actions) | The code and the workflows | On every push to `main` and every pull request, and weekly. |
| Secret scanning with push protection | Every push | Immediately: a push with a known provider's token is refused, and an alert opens for anything that gets through. |
| Dependabot alerts and security updates | Dependencies with a published advisory | When the advisory is published, with a pull request that fixes it. |
| Content-Security-Policy reports (#147) | Scripts and markup the site's policy blocks | Not yet: they are `csp violation` lines in the Vercel runtime logs. |

Not covered yet:

- **Secret scanning for generic secrets and validity checks.** On 2026-11-05 GitHub kept both off when the API was asked to turn them on, so they aren't available for this repository today (Settings → Advanced Security shows why).
- **Alerts for auth errors and rate limits (HTTP 429)** from Vercel and Supabase. The site's plans have no alerting or log drains: Vercel's need Pro, Supabase's need Team. Until then the maintainer checks the Vercel runtime logs (`csp violation`, `oauth callback failed`, 4xx and 5xx responses) and Supabase's Auth logs (failed sign-ins, 429s) every week and after each release ([#161](https://github.com/pirdehi/xomoni/issues/161)).

## Supported versions

Only the latest release and the `main` branch receive fixes.
