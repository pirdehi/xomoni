# Security policy

## Reporting a vulnerability

Please report security issues privately, not in public issues:

- GitHub: **Security → Report a vulnerability** on [pirdehi/xomoni](https://github.com/pirdehi/xomoni/security/advisories/new), or
- email **privacy@xomoni.com**.

Include what you found, how to reproduce it, and the impact you expect. You'll get an answer within a few days. Please give a reasonable time to fix the issue before disclosing it.

## Scope

In scope: the Xomoni extension (`apps/extension`), the website at xomoni.com (`apps/web`), and the database rules (`supabase/`). For example:

- anything that lets one user read or change another user's data (Row Level Security, auth flows, redirects);
- ways for a web page or x.com to make the extension act without the person's intent;
- leaks of session tokens, or of X content that should never leave the browser;
- anything that weakens the safety rules in [ADR-0003](docs/adr/0003-no-credentials-no-evasion.md).

Out of scope: X's own platform, rate limits or enforcement decisions; social engineering; denial of service against hosted services.

## How Xomoni is designed to limit damage

- The extension never handles X passwords or session cookies, and never sends its own requests to X ([ADR-0002](docs/adr/0002-drive-x-ui-not-the-api.md), [ADR-0003](docs/adr/0003-no-credentials-no-evasion.md)).
- X content stays in the browser; the cloud stores job status only ([ADR-0004](docs/adr/0004-x-data-stays-local.md)).
- The website cannot start deletions ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- Every database table has Row Level Security; the browser uses only the publishable key.

## Supported versions

Only the latest release and the `main` branch receive fixes.
