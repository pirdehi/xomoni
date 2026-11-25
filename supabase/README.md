# `supabase/`: database and auth, as code

The Supabase project behind xomoni.com, described entirely by files in this folder ([ADR-0010](../docs/adr/0010-configuration-as-code.md)). The same files run the local stack and configure production.

| Path | What it holds |
| --- | --- |
| `config.toml` | Auth, API and local-stack settings. The top level is the **local** stack; `[remotes.production]` at the end holds production-only overrides (site URL, redirect URLs, Resend SMTP, the real Turnstile secret, stricter rate limits). |
| `migrations/` | The database schema, applied in order. Every file starts with a comment explaining the change. |
| `templates/` | Branded HTML for every auth email (confirmation, recovery, email change, invite, magic link, reauthentication) and the security notifications (password changed, email changed, sign-in method added, authenticator app added or removed). |
| `tests/database/` | pgTAP tests for Row Level Security, `delete_account()`, `jobs.risk_level`, the per-account caps, the daily numbers with their choice, two-step verification's `aal2` rule, and the weekly email and the health alert with their sends, the plan with Polar's webhook ledger, the private product documents, and the super-admin console with its log (`supabase test db`). |
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

The sign-up confirmation returns to where the person was going (#244): the website keeps the same-site path in the account's metadata at sign-up, and the template writes it as `next={{ with .Data.next }}{{ . }}{{ else }}/dashboard{{ end }}`. A template value can't start a link: Supabase renders with Go's `html/template`, which refuses a token after an unknown URL prefix as ambiguous, and sign-up then fails. So test a template change locally (`supabase stop && supabase start`, then the auth e2e tests) before `supabase config push`.

## Secrets and the `SUPABASE_` prefix

The CLI maps any environment variable named `SUPABASE_<SECTION>_<KEY>` onto `config.toml`, locally as well as on push. Production-only secrets therefore use other names (`TURNSTILE_SECRET_KEY`, `RESEND_SMTP_API_KEY`) and are referenced only from `[remotes.production]`, so the local stack keeps Cloudflare's always-pass test secret and Mailpit.

## Changing the schema

1. `supabase migration new <name>` and write the SQL, starting with a `--` comment.
2. Add Row Level Security policies for any new table, and grant by name what each role needs: nothing in `public` is exposed by default (`auto_expose_new_tables = false`, #149), and `supabase/tests/database/exposure.test.sql` fails for a table without Row Level Security or an unexpected grant. `anon` gets nothing unless there is a reason.
3. `supabase db reset`, then `npm run gen -w @xomoni/db` to regenerate the types.
4. After merge: `supabase db push` to production.

## The weekly email's and the health alert's key

`send_weekly_emails()` ([ADR-0031](../docs/adr/0031-weekly-email-of-the-daily-numbers.md)) and `send_health_alerts()` ([ADR-0047](../docs/adr/0047-an-email-when-x-warns-an-account.md), every five minutes) read a Resend API key, limited to sending from xomoni.com, from Supabase Vault. Until it is there, they send nothing, and the website's Settings says the alert isn't set up yet. Set it once in production from the SQL editor, or with `psql`, never in a migration or a file in the repository:

```sql
select vault.create_secret('<resend key>', 'resend_api_key');
-- to rotate it later:
select vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), '<new key>');
```

## Opening sales

The plan of each account (`entitlements`), the ledger of Polar's webhooks (`billing_events`) and the switch that opens sales (`billing_settings.live`) come from one migration ([ADR-0042](../docs/adr/0042-payments-and-entitlements-with-polar.md)). Only Polar's signed webhook writes a plan, through `apply_billing_event(…)`, which only `service_role` may run. While the switch is off, every paid feature opens with a *Plus · preview* badge and no checkout is made.

The maintainer turns it on in production once the *Billing launch* section of the release issue is complete, from the SQL editor, never in a migration:

```sql
update public.billing_settings set live = true;   -- false closes sales again; neither needs a release
```

Anyone may ask whether sales are open (`billing_live()`, one boolean), so `/pricing` can say *Coming soon* to every visitor (#422). The service-role key may turn the switch too, which is how the browser tests open and close sales on the local stack.

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
