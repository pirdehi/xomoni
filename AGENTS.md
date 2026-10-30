# Instructions for coding assistants

These rules apply to any AI assistant working in this repository. They restate the parts of the docs that are easiest to get wrong; the full versions are linked.

## Before you change code

- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the README of the unit you are changing.
- For the website, also read [`apps/web/AGENTS.md`](apps/web/AGENTS.md): this Next.js version differs from what you may know; check `node_modules/next/dist/docs/` before using an API.
- For anything that acts on X, read [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md).

## Never

- Forge X headers, solve captchas, use proxies, spoof fingerprints, hide automation, or synthesize trusted input events ([ADR-0003](docs/adr/0003-no-credentials-no-evasion.md)).
- Ask for, store or read X passwords or cookies.
- Send X content (post text, likes, inventory) to any server ([ADR-0004](docs/adr/0004-x-data-stays-local.md)).
- Let the website start, resume or approve work on X ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- Commit secrets. Use `env(…)` in `supabase/config.toml`, `.env.local`, or Vercel settings.
- Disable a lint, architecture or documentation rule to make a check pass. Fix the code, or propose a rule change with an ADR.

## Always

- Put code in the right layer (website modules: `domain` → `application` → `infrastructure` / `server` / `client` / `ui`). `npm run arch` checks it.
- Write a TSDoc comment on every export: purpose and non-obvious facts, not a restatement of the name.
- Update the unit README, `docs/ARCHITECTURE.md` and ADRs when structure or decisions change.
- Add tests for new behavior, including the failure and security cases.
- Run `npm run verify` before you finish. It must pass.
