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
- X content stays in the browser; the cloud stores job status only ([ADR-0004](docs/adr/0004-x-data-stays-local.md)). The extension's Content-Security-Policy enforces it: its pages can connect only to Xomoni's own API, never to X or anywhere else (#143), apart from downloading this repository's signed releases from GitHub for a one-click update (#305).
- What reaches the extension from X's page is checked before it is used (#145). The service worker hears only Xomoni's own content script in the top frame of an x.com tab, and stores only messages whose every field has the expected shape and size. The content script takes commands only from Xomoni's own pages. The page-world interceptor captures only requests to x.com and uses built-ins taken before any of X's scripts run, so a page script can't rewrite what it captures. Right before a delete, the post's id must agree with its stored date and with the time X shows, and its text on the page must not contain a word the rule keeps. A rate-limit reset more than a day ahead is cut to a day.
- Local data is kept tidy (#151). The xomoni.com token lives in the extension's IndexedDB, out of reach of content scripts. "Delete local data" disconnects xomoni.com and clears every table except page-load times and risk events, which hold no X content and keep X's limits in force. If xomoni.com can't be told about a disconnect, the person is asked to remove the browser there. Archive files above 512 MB are refused, and a downloaded archive page carries a CSP that forbids scripts. A connected browser hears about a newer release, and whether it fixes a vulnerability, in the answer to its status report; a security release can't be dismissed.
- The database exposes nothing by default (#149). Every grant to the Data API roles is made by name, and a test checks the whole schema: Row Level Security on every table, nothing for `anon`, no `TRUNCATE` for anyone. A job's reason is never stored in the cloud. Device tokens stop working after 90 days without a report. Connections to the production database must use SSL. Its network stays open, because migrations are pushed from the maintainer's changing address and the apps use only the HTTPS Data API.
- Pairing names the account (#149). The extension shows the account's email, masked, and sends nothing until the person confirms it is theirs.
- The website cannot start deletions ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- Every database table has Row Level Security; the browser uses only the publishable key.
- Releases are built with a read-only token from a commit on `main`, signed with build provenance, reproducible and immutable once published ([releasing](docs/RELEASING.md#checking-a-download), #142).
- A zip install updates itself only with a release signed by the release workflow's Ed25519 key ([ADR-0033](docs/adr/0033-one-click-updates-for-the-zip-install.md), #305).
  - The key exists only as a secret of the `release` environment, whose required reviewer (the maintainer) approves each signing run.
  - Before anything is written, Xomoni checks the signature with the browser's own Web Crypto. It also checks that the zip is the newer version it claims, asks for no more access than the version running and no newer browser, and that every path stays inside the folder the person chose.
  - Nothing is written while a job runs, or while the backup of an update that didn't finish is kept. A write that fails is undone, and the update is in the activity log.
  - The release is built without dependencies' install scripts. A store build carries no updater.
  - The signing key follows the tag, not reviewed code; ADR-0033 says what that leaves open.
- The browser stores get the store build that same release workflow built and attested, `xomoni-extension-store-X.Y.Z.zip` (the same code without the one-click updater, ADR-0033), never a rebuild (#303): the store workflow checks it against the release's checksums and its build provenance first. The store keys are secrets of a GitHub environment that only runs from `main` can read, after the maintainer approves; each store's job gets only its own keys, and no message prints them ([stores](docs/RELEASING.md#chrome-web-store-and-edge-add-ons)).

## Cloud security review (2026-10-31)

A review of what the cloud side exposes today: Supabase (Postgres with Row Level Security, the Data API, Realtime, Auth) and the website ([#42](https://github.com/pirdehi/xomoni/issues/42)). Each check ran against the local stack with real requests; production settings were read from `supabase/config.toml` and the live headers. How the extension stores its session is reviewed when it learns to sign in ([#38](https://github.com/pirdehi/xomoni/issues/38)).

### Holds

| Area | What was checked |
| --- | --- |
| Anonymous access | No table access (HTTP 401); `delete_account()` refused; the Data API's OpenAPI root lists no paths; GraphQL (`pg_graphql`) is not enabled, locally or in production. |
| Row Level Security | 26 pgTAP tests in CI: a user can't read, change, delete or attach to another user's rows, or hand a job to someone else. |
| Realtime data | Row Level Security applies: a user who subscribes with another user's id as the filter receives nothing; without a filter, only their own rows. |
| Auth | Confirmed email before sign-in; email changes confirmed on both addresses; password change needs the current password, checked by signing in again and sent to Supabase with the change (#148), which checks it itself (*Require current password* is on in production); Turnstile on sign-up, sign-in and reset; production limits of 30 sign-ins per 5 minutes per IP and 30 emails per hour; 1-hour access tokens with refresh-token rotation. Two-step verification with an authenticator app (#173, [ADR-0036](docs/adr/0036-two-step-verification-with-an-authenticator-app.md)): an account with one is used only from a session that gave a code (`aal2`), checked by the website's server and by the database's policies and functions; Supabase refuses below `aal2` to add or remove an app or change the email or password; every app added or removed is emailed. |
| Sessions | Signing out revokes that session's refresh token; *Sign out everywhere* revokes every session's. Changing the password revokes every other session's refresh token; their access tokens expire within the hour. |
| Keys | The browser and the website use only the publishable key, with one exception on the server: Polar's billing webhook writes plans with the service-role key (ADR-0042). It is set only in Vercel, read by one `server-only` module (`modules/billing/infrastructure/supabase-admin.ts`), which only the webhook's route handler may import (`npm run arch`, rule `web-service-role-is-webhook-only`), and CI fails if its name or value is in the browser bundle (`tooling/check-browser-bundle.mjs`). Polar's access token and webhook secret are server-only too. The weekly email's and the health alert's Resend key lives in Supabase Vault, read only by `send_weekly_emails()` and `send_health_alerts()`, which only the database's owner runs (ADR-0031, ADR-0047); `health_alert_status()` tells a signed-in person only whether it is set. |
| Website | Security headers and a static CSP on every response, no raw HTML ([ADR-0014](docs/adr/0014-security-headers-and-a-static-csp.md)). Trusted Types guard every script sink: one `default` policy lets through only the site's own bundles and Turnstile's loader, and HTML without markup. Violations are reported to `/api/csp-report` and logged. `Cross-Origin-Resource-Policy: same-origin` (except the email logo), images only from the site and Google's avatar host. `POST /auth/signout` refuses a request whose `Origin` isn't the site (#147). The session cookies aren't `HttpOnly` (the browser client reads them, by `@supabase/ssr`'s design); the CSP and Trusted Types are what keep other scripts from reading them. |
| CORS | Vercel answers pages with `Access-Control-Allow-Origin: *`. Browsers never send cookies on such reads, so signed-in pages can't be read cross-site. |

### Findings

| Finding | Severity | Follow-up |
| --- | --- | --- |
| `delete_account()` accepts any valid session; *Type DELETE* is checked only in the page. A stolen session can delete the account and its history at once. | Medium | Fixed: `delete_account()` needs a sign-in within the last 10 minutes ([#80](https://github.com/pirdehi/xomoni/issues/80)). |
| Every dashboard joins one public Realtime topic. Anyone with the publishable key can broadcast to all open dashboards (ignored by the page today), and anonymous subscribers see an empty event for every job change of every user, which reveals activity timing but no content. | Low | Fixed in part: each dashboard joins a private channel `dashboard:<user id>` that only its owner may join, so nobody can broadcast to other people's dashboards ([#81](https://github.com/pirdehi/xomoni/issues/81)). Fixed in full since #149: changes are broadcast only on the owner's private topic, and `devices` and `jobs` left the Postgres-changes publication, so no subscriber of a public channel hears of them, deletions included. Turning off public channels for the project (a setting in the Supabase dashboard) remains good hygiene. |
| Nothing limits how many devices or jobs one account writes (300 devices in one request worked). | Low | Fixed: at most 10 devices per account, and the newest 1,000 jobs per device ([#82](https://github.com/pirdehi/xomoni/issues/82)). |
| Sign-out ends only the current session. Accounts that use Google have no password to change, so they can't end a session left elsewhere. | Low | Fixed: *Sign out everywhere* on the account page ([#83](https://github.com/pirdehi/xomoni/issues/83)). |

### Account security (#148)

| Item | State |
| --- | --- |
| Current password on a password change | The website checks it by signing in again and sends it to Supabase with the change. Supabase checks it itself: **Authentication → Providers → Email → Require current password when updating** is on in production (since 14 November). The CLI the project uses can't set it in `config.toml`, so it is a dashboard setting; the local stack doesn't have it. With an authenticator app, the change also needs a code from it. |
| Two-step verification (TOTP) | On since #173 ([ADR-0036](docs/adr/0036-two-step-verification-with-an-authenticator-app.md)): add, list and remove authenticator apps on the account page, a code after sign-in, and `aal2` required by the website's server and the database for accounts with an app. Known limits: Supabase takes a code again within its 30 to 90 seconds on a new challenge, and limits guesses only per IP (15 a minute); a per-account lockout needs the Team plan's MFA hook. Recovery without the app: [below](#lost-authenticator-app). |
| Session age | Supabase's session time-box and inactivity limits need the Pro plan. Until then the session cookies last 30 days instead of 400, renewed with each token refresh, so a browser unused for 30 days is signed out. Access tokens last an hour, refresh tokens rotate, and *Sign out everywhere* ends every session. |
| Email quota | 30 emails an hour for the whole project, in step with Resend's free 100 a day. Someone solving Turnstile 30 times in an hour can use it up and delay sign-up and reset emails for an hour. The two-step notices (an app added or removed) count toward it too. Raising it needs a paid Resend plan; an alert when it's reached waits on #161. Accepted for now. The weekly email goes through Resend's API, not this quota, but counts toward Resend's daily limit: one email a week to each person who asked. |

The Data API has no per-user request rate limit; the caps from #82 (at most 10,000 job rows per account) and the 1,000-row `max_rows` bound what one account can store and read with it.

## Lost authenticator app

Supabase Auth's recovery codes are still experimental and can't be turned on from `config.toml`, so getting back into an account without its authenticator app goes through a person ([ADR-0036](docs/adr/0036-two-step-verification-with-an-authenticator-app.md)). The site has no way to skip the code on its own: a reset by email alone would make the inbox the only factor.

1. The person writes to privacy@xomoni.com. The sender's address alone proves nothing: it can be forged.
2. The maintainer writes to the account's address on file (not a reply) and asks the person to answer it, and then to sign in once more with the password or Google, which stops at the code page. **Authentication → Users** shows that sign-in after the message, and so do the Auth logs.
3. The maintainer tells the account's address the apps will be removed in 3 days, and how to stop it if this wasn't them.
4. After 3 days without an objection, the maintainer removes the apps: the user's factors in **Authentication → Users**, or `auth.admin.mfa.deleteFactor` with the service-role key on the maintainer's own computer, never in the website. Supabase emails the account for each one.
5. The person signs in with the password or Google and can add a new app. Nothing in Xomoni on their computer, and nothing on X, changes.

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
