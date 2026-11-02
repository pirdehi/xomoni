# Contributing to Xomoni

Thanks for helping. Xomoni acts on people's X accounts, so the bar is: safe first, then correct, then fast. Read the [architecture](docs/ARCHITECTURE.md) and the [safety playbook](docs/PLAYBOOK.md) before larger changes.

## Set up

Requirements: Node.js 20.19+ (CI uses 22), npm, and Docker (or Colima) for the local Supabase stack. The [Supabase CLI](https://supabase.com/docs/guides/cli) is needed for website and database work; CI pins the version in `.github/workflows/ci.yml`, so use the same one when you regenerate `packages/db`.

```bash
git clone https://github.com/pirdehi/xomoni.git
cd xomoni
npm install            # also installs the git hooks (.githooks)
```

- Extension: `npm run build -w @xomoni/extension`, then load `apps/extension/dist` in `chrome://extensions`. See [apps/extension/README.md](apps/extension/README.md).
- Website: `supabase start`, copy `apps/web/.env.example` to `apps/web/.env.local`, then `npm run dev -w @xomoni/web`. See [apps/web/README.md](apps/web/README.md).

## The quality gate

`npm run verify` runs everything CI checks, in this order, and stops at the first failure:

| Step | Command | Fails when |
| --- | --- | --- |
| Formatting | `npm run format:check` | Code isn't formatted by Prettier (`npm run format` fixes it) |
| Lint and code documentation | `npm run lint` | Lint errors, or an exported symbol without a doc comment |
| Types | `npm run typecheck` | TypeScript errors in any workspace |
| Architecture | `npm run arch` | An import breaks a rule in `.dependency-cruiser.cjs` |
| Documentation | `npm run docs:check` | A unit has no README, the architecture doc is out of date, an ADR is malformed, a link is broken, an env var is undocumented |
| Test presence | `npm run tests:check` | A source file is imported by no test and is not listed as exempt with a reason ([docs/TESTING.md](docs/TESTING.md)) |
| Tooling tests | `npm run test:tooling` | A test of the repository's own scripts fails (`node --test tooling/`) |
| Unit tests and coverage | `npm test` | A test fails, or coverage drops below a workspace's threshold |

It runs automatically before every `git push` (`.githooks/pre-push`). CI runs it again, plus both production builds, the database checks (Row Level Security tests, types drift) and the end-to-end auth tests, and `main` only accepts pull requests with green CI.

The end-to-end tests need Docker, so they are not part of `verify`. Run them before pushing auth or database changes:

```bash
supabase start
npm run test:e2e -w @xomoni/web
```

## Making a change

1. Open or pick an issue. The plan is in [docs/ROADMAP.md](docs/ROADMAP.md), phase by phase, and in [milestones](https://github.com/pirdehi/xomoni/milestones).
2. Branch from `main`.
3. Keep to the architecture: put code in the right layer, and let `npm run arch` tell you when you didn't.
4. Document as you go:
   - a TSDoc comment on every export: what it is for and anything non-obvious;
   - the unit's README when its responsibility, files or dependencies change;
   - `docs/ARCHITECTURE.md` and an ADR when you add a unit, a rule or make a design decision;
   - `apps/web/.env.example` for every new environment variable.
5. Add or update tests on both sides, as [docs/TESTING.md](docs/TESTING.md) describes: a backend test (rule, use case, engine step or database policy) and a frontend test (the component the person uses), with the failure and security cases. Security rules (Row Level Security, redirects, auth errors) get tests that prove the negative case too.
6. Run `npm run verify`, push, and open a pull request. Fill in the template's safety checklist.
7. When the pull request finishes a roadmap task, tick it in [docs/ROADMAP.md](docs/ROADMAP.md) with the pull request number, in the same pull request.

Commit messages: one imperative summary line under ~72 characters ("Add password reset"), then a blank line and the why, if useful.

## TypeScript

The rules are in [ADR-0016](docs/adr/0016-strict-typescript-and-type-aware-lint.md) and enforced by `npm run verify`. In short:

- Every workspace extends [`tsconfig.base.json`](tsconfig.base.json): `strict`, `noUncheckedIndexedAccess`, no unused code, no implicit returns or fallthrough. Add only runtime options (`lib`, `jsx`, `types`) to a workspace's own `tsconfig.json`.
- No `any`. Data from outside (X's responses, archive files, messages, storage) is `unknown` until a check narrows it; in the extension, read it with `src/shared/json.ts`.
- No non-null assertions (`!`) and no casts that hide a missing check. Narrow with a condition, give a default, or fail with a clear error. Tests may use `!`.
- Every promise is awaited, returned, or marked `void` on purpose with its errors handled.
- Every `switch` over a union handles every case.
- No `eslint-disable`, `@ts-ignore` or `@ts-expect-error`. If a rule is wrong for some code, change it in `eslint.config.mjs` with a comment and an ADR.

## Releases

The extension ships as a zip on GitHub Releases from a version tag; [docs/RELEASING.md](docs/RELEASING.md) has the steps. Every pull request that changes what people see adds a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

## Database changes

```bash
supabase migration new <name>        # write SQL; start the file with a comment explaining it
supabase db reset                    # re-apply all migrations locally
npm run gen -w @xomoni/db            # regenerate packages/db types
```

Every table needs Row Level Security policies. Never put X content (post text, likes) or credentials in the database ([ADR-0004](docs/adr/0004-x-data-stays-local.md)).

## Rules that are not up for debate

These protect the people who use Xomoni. Pull requests that weaken them are closed ([ADR-0003](docs/adr/0003-no-credentials-no-evasion.md), [issue #47](https://github.com/pirdehi/xomoni/issues/47)):

- Never forge X's headers, solve captchas, use proxies, spoof fingerprints or hide automation.
- Never ask for, store or read X passwords or session cookies.
- Never act on an item that can't be verified. If in doubt, don't delete.
- The website never starts deletions ([ADR-0006](docs/adr/0006-website-is-view-only.md)).
- No secrets in the repository: use `env(…)` in `supabase/config.toml`, `.env.local`, or Vercel settings.

## Conduct and security

Be kind; see the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues.
