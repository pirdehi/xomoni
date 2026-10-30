# `supabase/`: database and auth, as code

The Supabase project behind xomoni.com, described entirely by files in this folder ([ADR-0010](../docs/adr/0010-configuration-as-code.md)). The same files run the local stack and configure production.

| Path | What it holds |
| --- | --- |
| `config.toml` | Auth, API and local-stack settings. The top level is the **local** stack; `[remotes.production]` at the end holds production-only overrides (site URL, redirect URLs). |
| `migrations/` | The database schema, applied in order. Every file starts with a comment explaining the change. |
| `.env` | **Git-ignored.** Secrets referenced from `config.toml` with `env(…)` (Google OAuth client). Never commit it. |

## Local stack

```bash
supabase start      # Postgres, Auth, Realtime, Studio (54323) and Mailpit (54324); needs Docker
supabase status     # URLs and the local publishable key for apps/web/.env.local
supabase db reset   # re-create the database from migrations
supabase stop
```

## Changing the schema

1. `supabase migration new <name>` and write the SQL, starting with a `--` comment.
2. Add Row Level Security policies for any new table. `anon` gets nothing unless there is a reason.
3. `supabase db reset`, then `npm run gen -w @xomoni/db` to regenerate the types.
4. After merge: `supabase db push` to production.

## Changing auth or API settings

Edit `config.toml`, test locally, then after merge:

```bash
supabase config push --project-ref ueegjwwmuuxlxyibgokx
```

The CLI prints `Loading config override: [remotes.production]` and a diff before applying it.

## Rules

- Production project: `xomoni` in the personal "Omid Pirdehi" organization. Never use another organization.
- The schema stores job status only: no post text, likes, X credentials or cookies ([ADR-0004](../docs/adr/0004-x-data-stays-local.md)).
- Every table has Row Level Security; `delete_account()` deletes only the caller.
