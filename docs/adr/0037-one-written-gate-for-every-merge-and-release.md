# ADR-0037: One written gate for every merge and every release

- Status: Accepted
- Date: 2026-11-21

## Context

`npm run verify`, the CI checks `verify`, `database` and `e2e`, and the "Protect main" ruleset already stop most bad merges ([ADR-0009](0009-documentation-is-a-merge-gate.md), [ADR-0017](0017-test-standard.md)). The path from `main` to a release was weaker. On 2026-11-21:

- The `release` and `stores` environments that [releasing](../RELEASING.md) relies on did not exist. A release would not have waited for anyone, and a run that names a missing environment creates one without protection.
- Three CodeQL alerts were open, one of them high. Nothing blocked a merge or a release on them.
- Dependabot raises alerts, but nothing stopped a pull request from adding a vulnerable dependency.
- Releases 0.2.0 to 0.4.0 left no record of what was checked before they went out.
- No human review was required on the gate's own files, so an agent could relax a rule and merge.

Much of Xomoni's code is written by AI agents, and a rule that is only written down gets forgotten. The maintainer asked for a condition that is always checked before anything merges or ships.

## Decision

Every change passes four gates. Each rule is a command or a GitHub setting. [Quality gates](../QUALITY-GATES.md) lists every rule with what enforces it.

1. **On the computer:** `npm run verify`, run by the pre-push hook. This is unchanged.
2. **Merge to `main`:**
   - Required checks `verify`, `database` and `e2e`.
   - `pr-policy`: a task link; for a user-facing change, a changelog line and scenarios ([ADR-0038](0038-user-scenarios-for-every-user-facing-task.md)); any exemption only with a written reason.
   - `dependency-review`: no new dependency with a high or critical vulnerability.
   - Code scanning results with no high or critical alert.
   - A code owner's review of the gate's own files (`.github/CODEOWNERS`), once AI agents open pull requests from an account of their own.
3. **Release candidate:** the release pull request, which bumps the version, runs the whole suite. The maintainer opens the release issue from `.github/ISSUE_TEMPLATE/release.md` and ticks each box once it is verified.
4. **Release:**
   - The `vX.Y.Z` tag runs the full CI again on the tagged commit, plus `npm audit` at high.
   - The workflow reads the release issue and refuses to publish while it is missing or has an unticked box.
   - The `release` environment waits for the maintainer's approval.
   - After publishing, the workflow comments the release on the issue and closes it, so every version keeps its record.

A rule changes only through an ADR and the maintainer's review. Rules get stricter, never looser, unless an ADR says why.

The release pull request is the release candidate. Xomoni makes no `-rc` tags, because Chrome's manifest version takes numbers only.

## Consequences

- No version goes out without its checklist complete and approved, and the closed issue records what was checked.
- A user-facing pull request carries a changelog line, which also keeps the README current ([ADR-0039](0039-the-readme-comes-from-the-feature-registry.md)).
- AI agents need a GitHub account of their own, so the maintainer can approve their pull requests. GitHub doesn't let an author approve their own.
- Releases take longer: the full suite runs on the release pull request and again on the tag.
- Done on 2026-11-21: the `release` environment (the maintainer as required reviewer, `v*` tags only) and the `stores` environment (the maintainer as required reviewer, `main` only).
- Follow-up work:
  - #339: `pr-policy` and `dependency-review`.
  - #340: the release workflow's full CI, `npm audit` and the release issue check.
  - #341: the open CodeQL alerts.
  - #342: the extension in a real browser, Edge, and axe.
  - #343: the nightly run and the check after each release.
  - #346: the ruleset changes and the agents' account.

## Alternatives considered

- **A checklist in the docs only.** That is what we had; nobody checked it for three releases.
- **A merge bot from a third party** (Danger, Mergify). It is one more service with write access. A Node script with only built-ins does the same and runs where the other checks run.
- **Release candidate tags** (`vX.Y.Z-rc.N`). The tag and the manifest would disagree, since the manifest version takes numbers only.
