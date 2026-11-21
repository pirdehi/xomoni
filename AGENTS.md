# Instructions for coding assistants

These rules apply to any AI assistant working in this repository. They restate the parts of the docs that are easiest to get wrong; the full versions are linked.

## Before you change code

- Find any document through [`docs/README.md`](docs/README.md), the map of `docs/` by kind. Its dated reports are snapshots, not current truth.
- Read [`docs/QUALITY-GATES.md`](docs/QUALITY-GATES.md): the definition of done, and the rules every merge and every release must pass.
- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the README of the unit you are changing.
- For the website, also read [`apps/web/AGENTS.md`](apps/web/AGENTS.md): this Next.js version differs from what you may know; check `node_modules/next/dist/docs/` before using an API.
- For anything that acts on X, read [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md).

## Never

- Forge X headers, solve captchas, use proxies, spoof fingerprints, hide automation, or synthesize trusted input events ([ADR-0003](docs/adr/0003-no-credentials-no-evasion.md)).
- Ask for, store or read X passwords or cookies.
- Send X content (post text, likes, inventory) to any server ([ADR-0004](docs/adr/0004-x-data-stays-local.md)).
- Let the website start, resume or approve work on X ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- Commit secrets. Use `env(…)` in `supabase/config.toml`, `.env.local`, or Vercel settings.
- Relax a quality gate to make a check pass: disable a rule, lower a threshold, skip or delete a test, remove a required check, or edit `.github/CODEOWNERS`. Fix the code, or propose the change with an ADR ([ADR-0037](docs/adr/0037-one-written-gate-for-every-merge-and-release.md)).
- Tick a box in a release issue that you haven't checked yourself.

## Always

- Link the task in the pull request: `Closes #N`, `Fixes #N` or `Part of #N`.
- Put code in the right layer (website modules: `domain` → `application` → `infrastructure` / `server` / `client` / `ui`). `npm run arch` checks it.
- Write a TSDoc comment on every export: purpose and non-obvious facts, not a restatement of the name.
- Update the unit README, `docs/ARCHITECTURE.md` and ADRs when structure or decisions change.
- Add tests for new behavior on both sides, backend and frontend, including the failure and security cases ([`docs/TESTING.md`](docs/TESTING.md)). `npm run tests:check` fails for a source file no test imports.
- For a user-facing change, in the same pull request:
  - write its scenarios: at least 20, each tied to a browser test ([ADR-0038](docs/adr/0038-user-scenarios-for-every-user-facing-task.md));
  - add a line under `[Unreleased]` in `CHANGELOG.md`;
  - add or update the feature in `docs/features.json` and run `npm run readme`, so both READMEs stay current ([ADR-0039](docs/adr/0039-the-readme-comes-from-the-feature-registry.md)).
- Tick the task in [`docs/ROADMAP.md`](docs/ROADMAP.md) in the pull request that finishes it.
- Run `npm run verify` before you finish. It must pass.
