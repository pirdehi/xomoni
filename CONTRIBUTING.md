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
| README from the feature registry | `npm run readme:check` | `README.md` or `README.fa.md` differs from what [`docs/features.json`](docs/features.json) would write (`npm run readme` fixes it), the registry is invalid, or an issue under *Added* in `CHANGELOG.md` belongs to no feature and to no exemption with a reason ([below](#the-feature-registry)) |
| Test presence | `npm run tests:check` | A source file is imported by no test and is not listed as exempt with a reason ([docs/TESTING.md](docs/TESTING.md)) |
| User scenarios | `npm run scenarios:check` | A file in `docs/scenarios/` has fewer than 20 scenarios, a category under its minimum or more than 3 manual ones, or a scenario's Playwright test is missing, skipped or without its `@task-<issue>` tag ([docs/scenarios/README.md](docs/scenarios/README.md)) |
| Tooling tests | `npm run test:tooling` | A test of the repository's own scripts fails (`node --test 'tooling/*.test.mjs'`), or [docs/STORE-LISTING.md](docs/STORE-LISTING.md) no longer matches the manifest or the stores' limits, or an icon no longer matches its drawing in `apps/extension/scripts/icon.mjs` ([ADR-0035](docs/adr/0035-xomoni-has-its-own-mark.md)) |
| No remote code | `npm run remote-code:check` | The extension's build runs code from a string (`eval`, `new Function`) or loads it from another site, or its CSP would let it ([docs/STORE-LISTING.md](docs/STORE-LISTING.md#6-no-remote-code)) |
| Unit tests and coverage | `npm test` | A test fails, or coverage drops below a workspace's threshold |

It runs automatically before every `git push` (`.githooks/pre-push`). CI runs it again, plus both production builds, the database checks (Row Level Security tests, types drift) and the end-to-end auth tests, and `main` only accepts pull requests with green CI.

The end-to-end tests need Docker, so they are not part of `verify`. Run them before pushing auth or database changes, and a task's user scenarios when you change what it does:

```bash
supabase start
npm run test:e2e -w @xomoni/web
npm run test:e2e -w @xomoni/web -- --grep @task-299   # one task's scenarios
npm run test:e2e:extension -w @xomoni/web             # the extension in a real browser: no Docker needed
```

## Making a change

1. Open or pick an issue. The plan is in [docs/ROADMAP.md](docs/ROADMAP.md), phase by phase, and in [milestones](https://github.com/pirdehi/xomoni/milestones).
2. Branch from `main`.
3. Keep to the architecture: put code in the right layer, and let `npm run arch` tell you when you didn't.
4. Document as you go:
   - a TSDoc comment on every export: what it is for and anything non-obvious;
   - the unit's README when its responsibility, files or dependencies change;
   - `docs/ARCHITECTURE.md` and an ADR when you add a unit, a rule or make a design decision;
   - `apps/web/.env.example` for every new environment variable;
   - [`docs/features.json`](docs/features.json) for a change people can see: add the feature, or change its entry, in English and Persian, then run `npm run readme` ([the feature registry](#the-feature-registry)).
5. Add or update tests on both sides, as [docs/TESTING.md](docs/TESTING.md) describes: a backend test (rule, use case, engine step or database policy) and a frontend test (the component the person uses), with the failure and security cases. Security rules (Row Level Security, redirects, auth errors) get tests that prove the negative case too.
6. When the change is user-facing (below), in the same pull request:
   - add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) that says what changes for people;
   - add the task's user scenarios in `docs/scenarios/<issue>-<slug>.md`: at least 20, across the nine categories, each proven by a Playwright test whose title starts with the scenario's id and that carries `@task-<issue>` ([docs/scenarios/README.md](docs/scenarios/README.md)). A fix to an existing feature adds its scenario to that feature's file (ADR-0038). This applies to pull requests opened from 2026-11-22 on.
7. Run `npm run verify`, push, and open a pull request. Link its task in the description: `Closes #N` (or `Fixes #N`, `Resolves #N`) when it finishes the issue, `Part of #N` when it is one step of it. Fill in the template's safety checklist.
8. When the pull request finishes a roadmap task, tick it in [docs/ROADMAP.md](docs/ROADMAP.md) with the pull request number, in the same pull request.

**User-facing** means a change to what a person sees or does: xomoni.com's pages, layouts and components (`apps/web/src/app/` except its route handlers, `apps/web/src/modules/*/ui/`, `apps/web/src/shared/ui/`, `apps/web/public/`), and in the extension the dashboard (`apps/extension/dashboard.html`, `apps/extension/src/ui/`), what runs in the X page (`apps/extension/src/content/`, `apps/extension/src/inject/`), and the manifest and icons (`apps/extension/public/`). Tests and docs never are. The exact list is `USER_FACING` in [`tooling/pr-policy-lib.mjs`](tooling/pr-policy-lib.mjs).

**Exemptions** take a label and a reason, written in the description on a line of its own. Reviews look at every one.

- `no-changelog`, with a line `No changelog: <why>`: for a change no one would notice, such as a refactor or a typo.
- `no-scenarios`, with a line `No scenarios: <why>`: for a change to no behavior a person can see.

Dependabot's pull requests need no task link.

Commit messages: one imperative summary line under ~72 characters ("Add password reset"), then a blank line and the why, if useful.

### Pull request checks

Besides CI's `verify`, `database`, `e2e` and `e2e-edge` (Edge), every pull request runs [`pr-policy.yml`](.github/workflows/pr-policy.yml). Both of its checks run again when you push, edit the description or change the labels, and `pr-policy` prints how to fix each problem it finds.

| Check | Fails when | Fix |
| --- | --- | --- |
| `pr-policy`: task link | The description has no `Closes #N`, `Fixes #N`, `Resolves #N` or `Part of #N`. A link inside an HTML comment doesn't count. | Add the line |
| `pr-policy`: changelog | A user-facing file changed, but `CHANGELOG.md` didn't | A line under `## [Unreleased]`, or the `no-changelog` label |
| `pr-policy`: scenarios | A user-facing file changed, and no `docs/scenarios/*.md` was added or changed. Only for pull requests opened from 2026-11-22 on. | The scenarios, or the `no-scenarios` label |
| `pr-policy`: reasons | `no-changelog` or `no-scenarios` is set, but no line starts with `No changelog:` or `No scenarios:` and a reason | Write the reason, or remove the label |
| `dependency-review` | The pull request adds a dependency, or a version of one, with a known high or critical vulnerability | Choose a version without it, or another package |

### When main is red

Every night, [`nightly.yml`](.github/workflows/nightly.yml) runs the full CI and `npm audit` on `main` (#343). When it fails, it opens one issue, *Nightly run failing*, labelled `nightly`, and closes it after the next green night. While it is open, fix `main` first: every pull request, and the next release, would meet the same failure. To check a fix before the next night, run it by hand from *Actions › Nightly › Run workflow*.

## TypeScript

The rules are in [ADR-0016](docs/adr/0016-strict-typescript-and-type-aware-lint.md) and enforced by `npm run verify`. In short:

- Every workspace extends [`tsconfig.base.json`](tsconfig.base.json): `strict`, `noUncheckedIndexedAccess`, no unused code, no implicit returns or fallthrough. Add only runtime options (`lib`, `jsx`, `types`) to a workspace's own `tsconfig.json`.
- No `any`. Data from outside (X's responses, archive files, messages, storage) is `unknown` until a check narrows it; in the extension, read it with `src/shared/json.ts`.
- No non-null assertions (`!`) and no casts that hide a missing check. Narrow with a condition, give a default, or fail with a clear error. Tests may use `!`.
- Every promise is awaited, returned, or marked `void` on purpose with its errors handled.
- Every `switch` over a union handles every case.
- No `eslint-disable`, `@ts-ignore` or `@ts-expect-error`. If a rule is wrong for some code, change it in `eslint.config.mjs` with a comment and an ADR.

## Releases

The extension ships as a zip on GitHub Releases from a version tag; [docs/RELEASING.md](docs/RELEASING.md) has the steps. Every pull request that changes what people see adds a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md); the `pr-policy` check holds it ([above](#pull-request-checks)). An issue it names under *Added* needs its feature in `docs/features.json`.

## The feature registry

[`docs/features.json`](docs/features.json) lists everything Xomoni does, most important first within each area (#337). The feature list and the status in [README.md](README.md) and [README.fa.md](README.fa.md) are written from it, between `<!-- BEGIN GENERATED: … -->` and `<!-- END GENERATED: … -->`. Never edit those blocks by hand: change the registry and run `npm run readme`. Everything outside them is written by hand.

| Field | What it holds |
| --- | --- |
| `id` | A kebab-case name, unique: `keep-rules`. |
| `area` | `extension`, `website`, or `both` when it needs the extension and xomoni.com together. The README lists each area under its own heading. |
| `status` | `shipped`, or `preview` while it waits on something outside the code, such as the stores listing Xomoni. |
| `since` | The first version that shipped it (`0.4.0`), or `unreleased` while it is only under `[Unreleased]`. The release stamps it ([releasing](docs/RELEASING.md)). |
| `issues` | The issues that built it. Every issue under *Added* in `CHANGELOG.md` belongs to a feature, or to `notFeatures` with a reason. |
| `scenarios` | Its scenarios file, `docs/scenarios/<issue>-<slug>.md`, for one of its issues. Only the features in `LEGACY_FEATURES` (`tooling/readme-lib.mjs`), which shipped before scenarios were required, may have `null`, until #345 writes theirs. |
| `en`, `fa` | `title` and `summary`, one line each. English plain and short; Persian fluent, in the tone of `README.fa.md`, not a word-for-word translation. |

`npm run readme:check`, part of `npm run verify`, fails when a README differs from the registry, the registry is invalid, or it disagrees with `CHANGELOG.md`.

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
