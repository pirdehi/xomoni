# `shared/`: code every website module may use

Small, stable building blocks with no feature logic. Nothing here may import a module or a route (`web-shared-is-shared`).

| Folder | Contents |
| --- | --- |
| `config/` | `site.ts`: public links, the contact address, and `SITE_URL` (the deployment's origin, used for OAuth return URLs). `security-headers.ts`: the Content-Security-Policy and other security headers that `next.config.ts` sends with every response ([ADR-0014](../../../../docs/adr/0014-security-headers-and-a-static-csp.md)). `trusted-types.ts`: the site's one Trusted Types policy, which `src/instrumentation-client.ts` installs before hydration. `security-txt.test.ts` checks `public/.well-known/security.txt` (#150), and fails 30 days before its `Expires`. |
| `http/` | Request helpers for route handlers: `same-origin.ts` (`isSameOriginRequest`, the Origin check on state-changing routes) and `csp-report.ts` (reads, trims and logs Content-Security-Policy violation reports for `/api/csp-report`) (#147). |
| `supabase/` | Client factories: `server.ts` (Server Components, Actions, Route Handlers; `server-only`), `browser.ts` (Client Components), `proxy.ts` (the Next.js proxy), and `env.ts` (validated public settings). |
| `ui/` | `fluent-provider.tsx` (Fluent UI with server-rendered styles and no dark-mode flash, ADR-0019), `links.tsx` (`ButtonLink` and `TextLink`: links that look like Fluent buttons and links but keep `next/link` for the site's pages), `site-chrome.tsx` (logo, header, footer) and `legal-page.tsx` (layout for the risks and policy pages, styling the plain HTML text they write). |

## Rules

- `web-shared-is-shared`: no imports from `modules/` or `app/`.
- `web-supabase-behind-adapters`: `shared/supabase` is one of the two places allowed to import `@supabase/*` and `@xomoni/db`; module code reaches Supabase only through its `infrastructure/` adapters.
- `web-server-code-is-server-only`: `supabase/server.ts` imports `server-only`.
