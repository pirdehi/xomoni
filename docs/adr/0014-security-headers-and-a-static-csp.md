# ADR-0014: Security headers and a static Content-Security-Policy

- Status: Accepted
- Date: 2026-10-31

## Context

xomoni.com holds a signed-in session: the dashboard and account pages can change the email, the password, or delete the account. The site should refuse to be framed (clickjacking), limit where scripts load from and where the browser may send data, and switch off browser features it never uses (#8).

Next.js documents two ways to set a Content-Security-Policy:

- **Nonces**, generated per request in the proxy. Every page then has to render on demand: static pages, the Cache Components static shell and partial prerendering no longer work, and the CDN can't cache pages.
- **A static policy** in `next.config.ts`. Pages stay static, but `script-src` must allow `'unsafe-inline'`, because Next.js streams each page's data in inline scripts whose content changes per page.

The site is mostly static (landing, legal and risks pages, the auth pages' shells) and is built on Cache Components. It renders no HTML from user input and loads no third-party scripts except Cloudflare Turnstile on the auth forms.

## Decision

1. Every response carries the headers built by `apps/web/src/shared/config/security-headers.ts`, applied to all paths in `next.config.ts`:
   - `Content-Security-Policy`: `default-src 'self'`; scripts from the site and Turnstile only (`'unsafe-inline'` allowed, `'unsafe-eval'` only in `next dev`); `connect-src` limited to the site and the deployment's own Supabase project over HTTPS and WebSockets (Realtime); Turnstile as the only frame; images from the site, `data:`/`blob:` and Google profile pictures; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; `upgrade-insecure-requests` except when the site runs over plain HTTP (local runs and CI).
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload` until we decide to join the preload list).
   - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`.
   - `Permissions-Policy` turning off camera, microphone, location, payment, USB and Topics.
2. We use the static policy, not nonces, and keep the pages static.
3. To make up for `'unsafe-inline'`, the website never renders raw HTML: ESLint forbids `dangerouslySetInnerHTML` in `apps/web`.
4. Every end-to-end test fails if the browser blocks anything on the site under the policy (`apps/web/e2e/support/test.ts`), so a change that needs a new origin must add it to the policy on purpose.

## Consequences

- Injected markup can't load scripts from other origins, send data anywhere but Supabase, post forms off-site, or frame the site. Injected *inline* script would still run; React's escaping and the ESLint rule are the defense there.
- Adding a third-party service (analytics, a font host, another captcha) means changing the policy and its unit test; the e2e guard catches a forgotten change.
- Vercel's preview toolbar is blocked on preview deployments. We don't use it.
- The policy depends on `NEXT_PUBLIC_SUPABASE_URL`; the build fails without it, as it already did.

## Alternatives considered

- Nonces in the proxy: the strictest policy, but every page would render on demand, giving up Cache Components and CDN caching for a site that is mostly static.
- Hash-based CSP with Next.js's experimental Subresource Integrity: covers script files, not the inline data scripts, so `'unsafe-inline'` would still be needed; and the feature is experimental.
- Starting with `Content-Security-Policy-Report-Only`: a reporting period helps when a site has unknown dependencies. Here every page and flow runs under the enforced policy in end-to-end tests before release, so we enforce from the start.
