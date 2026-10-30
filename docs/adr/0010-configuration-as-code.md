# ADR-0010: Configuration as code

- Status: Accepted
- Date: 2026-10-31

## Context

Settings changed by hand in dashboards (auth providers, redirect URLs, password rules, email templates) are invisible in review and easy to lose or get wrong between environments.

## Decision

- Supabase is configured by `supabase/config.toml`, migrations in `supabase/migrations`, and email templates in `supabase/templates`. The same files run the local stack (`supabase start`) and are pushed to production (`supabase config push`, `supabase db push`). Production-only values live in a `[remotes.production]` block.
- Secrets are never committed: `config.toml` references them with `env(…)`, and they live in the git-ignored `supabase/.env` and in Vercel's environment settings.
- Database types are generated from the migrations into `packages/db`; CI fails if they drift.

## Consequences

- Every auth or schema change is reviewed as a diff.
- Pushing configuration is a deliberate step, documented in [`supabase/README.md`](../../supabase/README.md).
