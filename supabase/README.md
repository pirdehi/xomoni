# `supabase/`: database and auth, as code

The Supabase project behind xomoni.com, described entirely by files in this folder ([ADR-0010](../docs/adr/0010-configuration-as-code.md)). The same files run the local stack and configure production.

| Path | What it holds |
| --- | --- |
| `config.toml` | Auth, API and local-stack settings. The top level is the **local** stack; `[remotes.production]` at the end holds production-only overrides (site URL, redirect URLs, Resend SMTP, the real Turnstile secret, stricter rate limits). |
| `migrations/` | The database schema, applied in order. Every file starts with a comment explaining the change. |
| `templates/` | Branded HTML for every auth email (confirmation, recovery, email change, invite, magic link, reauthentication) and the security notifications (password changed, email changed, sign-in method added). |
| `tests/database/` | pgTAP tests for Row Level Security, `delete_account()` and `jobs.risk_level` (`supabase test db`). |
| `.env` | **Git-ignored.** Secrets referenced from `config.toml` with `env(…)`: the Google OAuth client, `TURNSTILE_SECRET_KEY`, `RESEND_SMTP_API_KEY`. Never commit it. |

## Local stack

```bash
supabase start      # Postgres, Auth, Realtime, Studio (54323) and Mailpit (54324); needs Docker
supabase status     # URLs and the local publishable key for apps/web/.env.local
supabase db reset   # re-create the database from migrations
supabase stop
```

## Email templates

Templates are Go templates rendered by Supabase Auth. Action links point to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…&next=…`; the website verifies the token only when the person clicks ([ADR-0011](../docs/adr/0011-email-and-password-sign-in.md)). Locally every email lands in Mailpit (http://127.0.0.1:54324); in production they go through Resend from `no-reply@xomoni.com`.

## Secrets and the `SUPABASE_` prefix

The CLI maps any environment variable named `SUPABASE_<SECTION>_<KEY>` onto `config.toml`, locally as well as on push. Production-only secrets therefore use other names (`TURNSTILE_SECRET_KEY`, `RESEND_SMTP_API_KEY`) and are referenced only from `[remotes.production]`, so the local stack keeps Cloudflare's always-pass test secret and Mailpit.

## Changing the schema

1. `supabase migration new <name>` and write the SQL, starting with a `--` comment.
2. Add Row Level Security policies for any new table. `anon` gets nothing unless there is a reason.
3. `supabase db reset`, then `npm run gen -w @xomoni/db` to regenerate the types.
4. After merge: `supabase db push` to production.

## Changing auth or API settings

Edit `config.toml`, restart the stack (`supabase stop && supabase start`), run the auth tests (`npm run test:e2e -w @xomoni/web`), then after merge:

```bash
supabase config push --project-ref ueegjwwmuuxlxyibgokx
```

The CLI prints `Loading config override: [remotes.production]` and a diff before applying it.

## Rules

- Production project: `xomoni` in the personal "Omid Pirdehi" organization. Never use another organization.
- The schema stores job status only: no post text, likes, X credentials or cookies ([ADR-0004](../docs/adr/0004-x-data-stays-local.md)).
- Every table has Row Level Security; `delete_account()` deletes only the caller.
