# ADR-0039: The README's feature list and status come from one registry

- Status: Accepted
- Date: 2026-11-21

## Context

On 2026-11-21 the README's *Project status* still said "early release (v0.1)", three releases after 0.1. The feature list stopped at what 0.2.0 shipped, so the website dashboard, the archive, watching X search and one-click updates were missing. `README.fa.md` drifts on its own, a little differently.

The README is the first page people and AI agents read. The maintainer wants it to match the latest shipped work at all times, checked by a machine, not by memory.

## Decision

1. **`docs/features.json` is the one source of truth** for what Xomoni does. Each feature has:
   - its area and status;
   - the version it shipped in;
   - its issues and its scenarios file ([ADR-0038](0038-user-scenarios-for-every-user-facing-task.md));
   - a title and a summary in English and in Persian.
2. **`npm run readme` writes the generated blocks** of `README.md` and `README.fa.md`: the feature list, and the status (the latest version and its date). Everything outside those blocks stays hand-written.
3. **`npm run readme:check`, part of `npm run verify`, fails** in three cases:
   - the READMEs differ from what the registry would write;
   - the registry is invalid;
   - an issue under *Added* in `CHANGELOG.md` belongs to no feature and to no exemption with a reason.
4. **`node tooling/release.mjs check vX.Y.Z` also fails** in two cases:
   - a feature that ships in this version isn't stamped with it;
   - the README's status doesn't name the version.

This makes a chain, so that no link can be skipped:

1. A user-facing change needs a changelog line (`pr-policy`, [ADR-0037](0037-one-written-gate-for-every-merge-and-release.md)).
2. An *Added* line needs a feature in the registry.
3. The registry must match the READMEs.
4. A release must stamp its features and name its version.

## Consequences

- The READMEs can't fall behind the registry, and the registry can't fall behind the changelog.
- Every feature's README line is written in English and Persian, in the pull request that adds it.
- The rest of each README is still written by hand. Reviews and the release checklist keep it right.
- Built by #337.

## Alternatives considered

- **Keeping the README by hand.** It fell three releases behind.
- **Generating the list from the changelog.** Changelog lines describe changes, not what Xomoni does, and they have no Persian.
