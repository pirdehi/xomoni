# ADR-0041: Docs sorted by kind, with one map

- Status: Accepted
- Date: 2026-11-21

## Context

By 2026-11-21 the root of `docs/` held 28 files. Ten were kept current: the architecture, the quality gates, the playbook, the feature registry. Seventeen were reports, reviews and plans frozen on the day they were written: status reports, UX reviews, the next 20 tasks, the dashboard plan. One was a how-to. Nothing told them apart, and no page said which to read first.

A person or an AI agent opening the repository for the first time could take a week-old status report for the current state. For the Phase 19 quality gate (#344), the repository must read as structured.

The issue proposed a folder per kind, after [Diátaxis](https://diataxis.fr/): `guides/`, `reference/`, `explanation/`, `adr/`, `scenarios/` and `reports/<yyyy-mm>/`. But scripts, workflows, `AGENTS.md`, `CONTRIBUTING.md`, the pull request template, tooling tests and many documents link the living documents by path (`docs/ROADMAP.md`, `docs/QUALITY-GATES.md`, `docs/STORE-LISTING.md`). So do links outside the repository, such as the maintainer's roadmap on Claude.

## Decision

1. **The living documents stay at the root of `docs/`**, on an explicit list (`LIVING_DOCS` in `tooling/docs-layout-lib.mjs`). Moving them would break links we don't control, and gain only a folder name.
2. **Dated reports, reviews and plans go in `docs/reports/<yyyy-mm>/`**, one folder per month, with their names and their `.fa.md` pairs unchanged.
3. **How-tos with few links go in `docs/guides/`.** `RELEASING.md` stays at the root, because the release and store workflows and the release issue template link it.
4. **[`docs/README.md`](../README.md) is the one map.** It sorts every document by kind (reference, guides, explanation, reports) and says what each is for and when to read it. It says that reports are snapshots, not current truth. `AGENTS.md` and `CONTRIBUTING.md` point to it.
5. **`npm run docs:check` fails** in four cases:
   - a file at the root of `docs/` is not on the list; the message says where dated reports go;
   - a listed document is missing;
   - something under `docs/reports/` is not in a `<yyyy-mm>` folder;
   - the map misses a living document or a folder of `docs/`.

## Consequences

- A new report can't land at the root of `docs/`. The check names `docs/reports/<yyyy-mm>/` instead.
- The map can't fall behind: a new living document or folder needs a line on it in the same pull request.
- A new living document at the root needs a line in `tooling/docs-layout-lib.mjs`, a file the maintainer reviews (`CODEOWNERS`).
- Links to the moved reports on github.com, from outside the repository, now lead nowhere. Links inside the repository were fixed when they moved (#344).
- Pull requests that still add a report at the root, such as the Phase 9 report (#175), must move it before they can merge.

## Alternatives considered

- **A folder per kind for every document (`reference/`, `explanation/`).** It sorts best, but breaks every path above for a folder name. The map gives the same grouping without moving anything.
- **A map with no check.** It would fall behind on the first new report, as the README's status did ([ADR-0039](0039-the-readme-comes-from-the-feature-registry.md)).
- **Reports in one flat `reports/` folder.** One folder per month keeps it short as reports accumulate, and dates them at a glance.
