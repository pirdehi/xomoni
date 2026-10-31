# `apps/web`: xomoni.com

The public website and account area for Xomoni, built with Next.js 16 (App Router, Cache Components) and Supabase, deployed on Vercel. It hosts the landing, legal and risks pages, sign-in, and a live, read-only view of the extension's jobs. It never acts on X ([ADR-0006](../../docs/adr/0006-website-is-view-only.md)).

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
| `npm test -w @xomoni/web` | Unit tests (domain rules and use cases) |
| `npm run test:e2e -w @xomoni/web` | End-to-end auth tests in Chromium against the local Supabase stack (run `supabase start` first) |

## Structure

```
src/
  app/            routes only: pages, layouts, route handlers (thin)
  modules/
    auth/         identity: sign-up and email confirmation, sign-in, password reset, account settings, sessions
    dashboard/    devices and live job status
  shared/
    config/       public site constants and the site URL
    supabase/     Supabase client factories (server, browser, proxy)
    ui/           layout components used by every page
  proxy.ts        refreshes the session on signed-in and auth routes
e2e/              Playwright tests for every auth flow (real Supabase Auth, emails from Mailpit)
```

Each module is split into `domain/`, `application/`, `infrastructure/`, `server/`, `client/` and `ui/` layers; the rules are in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#4-website-appsweb) and are checked by `npm run arch`.

## Environment

All variables are listed with explanations in [`.env.example`](.env.example). In production they are set in the Vercel project (`xomoni`, personal scope). `npm run docs:check` fails if code reads a variable that isn't documented there.

## Deployment

Vercel builds this app with Root Directory `apps/web` on every push; `main` deploys to https://xomoni.com. Database and auth settings are deployed separately from [`supabase/`](../../supabase/README.md).

## Depends on

- [`packages/db`](../../packages/db/README.md) for the database types (adapters only).
- [`packages/consent`](../../packages/consent/README.md) for the informed-consent text on `/risks`.
- Supabase (Auth, Postgres, Realtime) through `src/shared/supabase`.
