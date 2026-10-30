# ADR-0009: Documentation is a merge gate

- Status: Accepted
- Date: 2026-10-31

## Context

Documentation that is optional falls behind the code. For a safety-sensitive open-source project, an undocumented function or an out-of-date architecture page is a real risk: the next change may break a rule nobody wrote down.

## Decision

Documentation is checked mechanically, in the same gate as tests:

- ESLint requires a TSDoc comment with a description on every exported symbol in application code.
- `tooling/check-docs.mjs` requires a README in every unit, an architecture document that names every unit and every dependency rule, valid ADRs, working relative links, documented environment variables and commented migrations.
- `npm run verify` runs all checks; a git `pre-push` hook runs it before every push, and CI runs it on every pull request. `main` only accepts pull requests with green CI.

## Consequences

- Adding a module, a rule or an environment variable without documenting it fails the build.
- Contributors (and coding assistants, through [`AGENTS.md`](../../AGENTS.md)) write docs as part of the change, not after.
