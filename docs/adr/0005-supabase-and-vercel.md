# ADR-0005: Supabase and Vercel for accounts and the website

- Status: Accepted
- Date: 2026-10-30

## Context

The website needs sign-in, a small Postgres database with per-user access rules, live updates, and hosting for a Next.js app, run by one person on a small budget.

## Decision

- **Supabase** (personal organization, project `xomoni`, us-east-1): Auth, Postgres with Row Level Security, and Realtime. Configured as code in `supabase/` ([ADR-0010](0010-configuration-as-code.md)).
- **Vercel** (personal scope): hosts `apps/web` from the GitHub repository; pushes to `main` deploy to production at xomoni.com.
- **Cloudflare** hosts DNS (records DNS-only) and forwards `privacy@xomoni.com`.

The project is personal: it is never placed in a company organization or team on any of these services.

## Consequences

- Free tiers cover the expected load; limits (for example Supabase's auth email rate) are configured explicitly.
- The browser talks to Supabase directly with the publishable key; security rests on Row Level Security, which is tested.
