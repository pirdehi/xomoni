# `apps/web`: xomoni.com

The public website and account area for Xomoni, built with Next.js 16 (App Router, Cache Components) and Supabase, deployed on Vercel. It hosts the landing, install, legal and risks pages, sign-in, and a live, read-only view of the extension's jobs. It never acts on X ([ADR-0006](../../docs/adr/0006-website-is-view-only.md)).

## Run it locally

```bash
supabase start                                  # from the repo root; needs Docker
cp apps/web/.env.example apps/web/.env.local    # then fill in the values from `supabase status`
npm run dev -w @xomoni/web                      # http://localhost:3000
```

Local emails (confirmation, password reset) land in Mailpit at http://127.0.0.1:54324.

| Script | What it does |
| --- | --- |
| `npm run dev -w @xomoni/web` | Development server |
| `npm run build -w @xomoni/web` | Production build |
| `npm run typecheck -w @xomoni/web` | Generates route types, then runs `tsc` |
| `npm test -w @xomoni/web` | Unit and component tests with coverage: domain rules, use cases, adapters, server code and every UI component ([docs/TESTING.md](../../docs/TESTING.md)) |
| `npm run test:e2e -w @xomoni/web` | End-to-end tests in Chromium against the local Supabase stack (run `supabase start` first); `XOMONI_E2E_BROWSERS=msedge` runs them in Edge |
| `npm run test:e2e:extension -w @xomoni/web` | The built extension in a real browser, on x.com pages served from synthetic fixtures, with no network and no Supabase (ADR-0040) |
| `npm run test:e2e:release -w @xomoni/web` | The release smoke test, before a tag: the candidate's zip and the previous release's (`XOMONI_E2E_EXTENSION`, `XOMONI_E2E_PREVIOUS`), a clean install, an update in place, a rollback and a move ([releasing](../../docs/RELEASING.md#the-smoke-test-of-the-zips)). Not part of CI |

## Structure

```
src/
  app/            routes only: pages, layouts, route handlers (thin)
  modules/
    billing/      payments with Polar (ADR-0042): POST /api/billing/webhook, Polar's signed events, the only writer of plans; a person's plan for the pages
    auth/         identity: sign-up and email confirmation, sign-in, two-step verification (/login/two-factor), password reset, account settings, sessions
    dashboard/    the dashboard's places (/dashboard, /dashboard/<place>), devices and live job status, /connect, where the extension's Sign in finishes, /welcome, which Xomoni opens once installed (#244), and /weekly-email/stop with POST /api/weekly-email/stop, where the weekly email stops (ADR-0031)
    extension/    the Xomoni extension in this browser: one sign-in for the site and the extension (ADR-0025)
    landing/      the landing page at / and the install guide at /install
    admin/        the super-admin console at /product (#516): its own sign-in at /product/login, the overview, users and
                  their actions, the audit log and the maintainer's plan, for super-admins only
    product-docs/ the private product document at /product/document and its versions at /product/documents, in the
                  console, for super-admins only (ADR-0048)
  shared/
    config/       public site constants, the site URL and the security headers
    supabase/     Supabase client factories (server, browser, proxy)
    ui/           layout components used by every page
  proxy.ts        refreshes the session on signed-in and auth routes
e2e/              Playwright tests for every auth flow (real Supabase Auth, emails from Mailpit), the dashboard
                  (devices and jobs seeded as the extension reports them) and the security headers; every test
                  fails on a Content-Security-Policy violation. fixed-id.spec.ts loads a real unpacked test
                  extension with a fixed `key` (e2e/fixtures/fixed-id-extension, #302). A test titled S<issue>-NN
                  and tagged @task-<issue> proves that user scenario in docs/scenarios/ (#338). a11y.spec.ts runs
                  axe on every page; any test may call expectNoSeriousA11yViolations (e2e/support/a11y.ts, #342)
  extension/      the built extension in a real browser (playwright.extension.config.ts, ADR-0040): its dashboard,
                  and its content script on x.com pages from e2e/fixtures/x, synthetic and served with no network
  release/        the release smoke test on two releases' zips (playwright.release.config.ts, #419), with the same
                  harness as extension/
```

Each module is split into `domain/`, `application/`, `infrastructure/`, `server/`, `client/` and `ui/` layers; the rules are in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#4-website-appsweb) and are checked by `npm run arch`.

The favicon (`src/app/icon.png`), the Apple touch icon (`src/app/apple-icon.png`) and the logo (`public/logo.png`, in the header and in Supabase's emails) are Xomoni's mark, drawn by the extension's [`scripts/icon.mjs`](../extension/scripts/icon.mjs) with `npm run icons -w @xomoni/extension` ([ADR-0035](../../docs/adr/0035-xomoni-has-its-own-mark.md)). Don't edit them by hand: `tooling/brand.test.mjs` fails when they no longer match the drawing. The home page's screenshots in `public/screens` are taken by `npm run store:images -w @xomoni/extension`.

## Environment

All variables are listed with explanations in [`.env.example`](.env.example). In production they are set in the Vercel project (`xomoni`, personal scope). `npm run docs:check` fails if code reads a variable that isn't documented there.

`BILLING_PAGES` stays unset in Production until the maintainer approves the terms of sale, the refund policy and the privacy page's part about paid plans (#420): /terms-of-sale and /refunds then answer 404 and nothing links to them. Set it to `1` on a Preview to review the drafts, each marked *Draft*; the browser tests run with it on. Approving them means removing the `draft` notices, then setting it in Production; the pages are prerendered, so it takes effect with the next deployment.

## Deployment

Vercel builds this app with Root Directory `apps/web` on every push that changes what it is built from (`vercel.json`'s `ignoreCommand`: this app, `packages/`, the root `package.json`, lockfile and `tsconfig.base.json`; `tooling/vercel.test.mjs` keeps the list complete), so pushes that touch only the extension, docs or tooling don't use up the plan's daily deployments; `main` deploys to https://xomoni.com. The Vercel Toolbar stays off in the project's settings: its loader breaks the site under Trusted Types ([ADR-0014](../../docs/adr/0014-security-headers-and-a-static-csp.md)). Database and auth settings are deployed separately from [`supabase/`](../../supabase/README.md).

## Depends on

- [`packages/db`](../../packages/db/README.md) for the database types (adapters only).
- [`packages/consent`](../../packages/consent/README.md) for the informed-consent text on `/risks`.
- Supabase (Auth, Postgres, Realtime) through `src/shared/supabase`.
