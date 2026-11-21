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
| `npm run test:e2e -w @xomoni/web` | End-to-end auth tests in Chromium against the local Supabase stack (run `supabase start` first) |

## Structure

```
src/
  app/            routes only: pages, layouts, route handlers (thin)
  modules/
    auth/         identity: sign-up and email confirmation, sign-in, password reset, account settings, sessions
    dashboard/    the dashboard's places (/dashboard, /dashboard/<place>), devices and live job status, /connect, where the extension's Sign in finishes, /welcome, which Xomoni opens once installed (#244), and /weekly-email/stop with POST /api/weekly-email/stop, where the weekly email stops (ADR-0031)
    extension/    the Xomoni extension in this browser: one sign-in for the site and the extension (ADR-0025)
    landing/      the landing page at / and the install guide at /install
  shared/
    config/       public site constants, the site URL and the security headers
    supabase/     Supabase client factories (server, browser, proxy)
    ui/           layout components used by every page
  proxy.ts        refreshes the session on signed-in and auth routes
e2e/              Playwright tests for every auth flow (real Supabase Auth, emails from Mailpit), the dashboard
                  (devices and jobs seeded as the extension reports them) and the security headers; every test
                  fails on a Content-Security-Policy violation. fixed-id.spec.ts loads a real unpacked test
                  extension with a fixed `key` (e2e/fixtures/fixed-id-extension, #302)
```

Each module is split into `domain/`, `application/`, `infrastructure/`, `server/`, `client/` and `ui/` layers; the rules are in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#4-website-appsweb) and are checked by `npm run arch`.

## Environment

All variables are listed with explanations in [`.env.example`](.env.example). In production they are set in the Vercel project (`xomoni`, personal scope). `npm run docs:check` fails if code reads a variable that isn't documented there.

## Deployment

Vercel builds this app with Root Directory `apps/web` on every push that changes what it is built from (`vercel.json`'s `ignoreCommand`: this app, `packages/`, the root `package.json`, lockfile and `tsconfig.base.json`; `tooling/vercel.test.mjs` keeps the list complete), so pushes that touch only the extension, docs or tooling don't use up the plan's daily deployments; `main` deploys to https://xomoni.com. The Vercel Toolbar stays off in the project's settings: its loader breaks the site under Trusted Types ([ADR-0014](../../docs/adr/0014-security-headers-and-a-static-csp.md)). Database and auth settings are deployed separately from [`supabase/`](../../supabase/README.md).

## Depends on

- [`packages/db`](../../packages/db/README.md) for the database types (adapters only).
- [`packages/consent`](../../packages/consent/README.md) for the informed-consent text on `/risks`.
- Supabase (Auth, Postgres, Realtime) through `src/shared/supabase`.
