# ADR-0014: Security headers and a static Content-Security-Policy

- Status: Accepted
- Date: 2026-10-31
- Amended: 2026-11-05 (#147: Trusted Types, violation reports, tighter images, a resource policy and an Origin check)

## Context

xomoni.com holds a signed-in session: the dashboard and account pages can change the email, the password, or delete the account. The site should refuse to be framed (clickjacking), limit where scripts load from and where the browser may send data, and switch off browser features it never uses (#8).

Next.js documents two ways to set a Content-Security-Policy:

- **Nonces**, generated per request in the proxy. Every page then has to render on demand: static pages, the Cache Components static shell and partial prerendering no longer work, and the CDN can't cache pages.
- **A static policy** in `next.config.ts`. Pages stay static, but `script-src` must allow `'unsafe-inline'`, because Next.js streams each page's data in inline scripts whose content changes per page.

The site is mostly static (landing, legal and risks pages, the auth pages' shells) and is built on Cache Components. It renders no HTML from user input and loads no third-party scripts except Cloudflare Turnstile on the auth forms.

## Decision

1. Every response carries the headers built by `apps/web/src/shared/config/security-headers.ts`, applied to all paths in `next.config.ts`:
   - `Content-Security-Policy`: `default-src 'self'`; scripts from the site and Turnstile only (`'unsafe-inline'` allowed, `'unsafe-eval'` only in `next dev`); `connect-src` limited to the site and the deployment's own Supabase project over HTTPS and WebSockets (Realtime); Turnstile as the only frame; images from the site, `data:` and Google's avatar host `https://lh3.googleusercontent.com` (the dashboard drops avatars on any other host); `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; Trusted Types (below); violation reports (below); `upgrade-insecure-requests` except when the site runs over plain HTTP (local runs and CI).
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload` until we decide to join the preload list).
   - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`.
   - `Cross-Origin-Resource-Policy: same-origin`: no other site may load the site's responses as images, scripts or media. The one exception is `/logo.png` (`cross-origin`), which Supabase's auth emails show and mail apps load from their own pages (`EMBEDDABLE_PATHS`; a unit test checks every image the email templates load is in it).
   - `Permissions-Policy` turning off camera, microphone, location, payment and USB. It lists only features browsers still know: `browsing-topics` was removed on 2026-11-01, because current Chrome no longer recognizes it and logged an error on every page.
2. We use the static policy, not nonces, and keep the pages static.
3. To make up for `'unsafe-inline'`, the website never renders raw HTML: ESLint forbids `dangerouslySetInnerHTML` in `apps/web`.
4. Every end-to-end test fails if the browser blocks anything on the site under the policy (`apps/web/e2e/support/test.ts`), so a change that needs a new origin must add it to the policy on purpose.
5. **Trusted Types** (#147, outside `next dev`, which needs `eval`): `require-trusted-types-for 'script'; trusted-types default`. Every script sink (`innerHTML`, `insertAdjacentHTML`, `script.src`, `eval` and the rest) refuses plain strings, and only one policy may exist, named `default`. `src/instrumentation-client.ts` creates it before React hydrates (`shared/config/trusted-types.ts`):
   - `createScriptURL` lets through the site's own bundles (`/_next/static/` on the page's origin), which Turbopack loads by setting `script.src`, and Turnstile's loader (`https://challenges.cloudflare.com/turnstile/v0/`). It returns the string unchanged: Turbopack finds a loaded bundle again by its exact `src`, and an absolute URL in place of a relative one left client-side navigation hanging.
   - `createHTML` lets through only text without `<`, which can't create an element (the style text of Next.js's error page). Anything with markup is refused.
   - There is no `createScript`: `eval` and script text are refused.
   So even injected markup that reaches a sink, or a dependency that builds HTML from strings, can't run script or load one from elsewhere; the attempt is blocked and reported. Next.js 16 and Turbopack ship no policy of their own (the `nextjs` policies belong to the webpack and Pages Router runtimes), Fluent UI's Griffel writes styles through the CSSOM, and Supabase's client uses no sink, so nothing else needs a policy.
6. **Violation reports** (#147): `report-to csp` with `Reporting-Endpoints: csp="/api/csp-report"`, and `report-uri /api/csp-report` for browsers without the Reporting API. The route handler reads at most 32 KB (413 above), accepts only report content types (415) and valid JSON (400), and logs at most 20 reports per request as `csp violation` lines with URLs cut to origin and path, since reset and sign-in links carry codes in their query. The endpoint is relative, so previews and local runs report to themselves. On xomoni.com, Chrome delivered a Trusted Types violation through the Reporting API to the relative endpoint (checked on 2026-11-05); in local runs over plain HTTP it delivered reports only through `report-uri`.
7. **Origin check on state-changing route handlers** (#147): `POST /auth/signout` answers 403 unless the request's `Origin` is the site's own origin, or, when a browser sends no `Origin`, `Sec-Fetch-Site` is `same-origin` (`shared/http/same-origin.ts`). SameSite=Lax cookies already keep most cross-site posts out; this closes the rest, such as a top-level form post right after a navigation. Server Actions get the same check from Next.js (it compares `Origin` with `Host`). `GET /auth/callback` is a top-level redirect from Google and changes nothing without the one-time code; `POST /api/csp-report` only logs, so it needs no check.

## Consequences

- Injected markup can't load scripts from other origins, send data anywhere but Supabase, post forms off-site, or frame the site. Injected *inline* script would still run; React's escaping and the ESLint rule are the defense there. Trusted Types close the DOM sinks, through which most injected markup would arrive.
- A browser extension that writes HTML into the site's pages from the page's own world is blocked by Trusted Types too, and shows up in the violation reports.
- Violations are in the Vercel logs as `csp violation` lines; nothing alerts on them yet (#150).
- Adding a third-party service (analytics, a font host, another captcha) means changing the policy and its unit test; the e2e guard catches a forgotten change.
- Scanners mark the policy down for `'unsafe-inline'`: Mozilla Observatory gives xomoni.com B+ (80/100) on 2026-10-31, passing 11 of 12 tests, with that −20 as the only deduction. Nonces are the way to A+ if the site ever renders mostly on demand.
- Vercel's preview toolbar is blocked on preview deployments. We don't use it.
- The policy depends on `NEXT_PUBLIC_SUPABASE_URL`; the build fails without it, as it already did.

## Alternatives considered

- Nonces in the proxy: the strictest policy, but every page would render on demand, giving up Cache Components and CDN caching for a site that is mostly static.
- Hash-based CSP with Next.js's experimental Subresource Integrity: covers script files, not the inline data scripts, so `'unsafe-inline'` would still be needed; and the feature is experimental.
- Starting with `Content-Security-Policy-Report-Only`: a reporting period helps when a site has unknown dependencies. Here every page and flow runs under the enforced policy in end-to-end tests before release, so we enforce from the start. The same goes for Trusted Types (#147).
- `trusted-types 'none'` (no policy at all): Turbopack and Turnstile's wrapper set `script.src` from strings, so the site wouldn't load its own bundles on navigation or show the captcha.
- Installing the policy from an inline script at the top of `<head>`: it would run slightly earlier, but needs `dangerouslySetInnerHTML`, which the site's ESLint rule forbids, and the inline text must avoid `</script>`. `instrumentation-client.ts` runs before hydration; in every page and navigation tried, nothing reached a sink earlier.
