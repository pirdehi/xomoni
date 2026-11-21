# Xomoni docs

The map of `docs/`: what each document is for and when to read it, sorted by kind ([ADR-0041](adr/0041-docs-sorted-by-kind-with-one-map.md)). New here? Read the [architecture](ARCHITECTURE.md), then the [quality gates](QUALITY-GATES.md). AI agents also follow [`AGENTS.md`](../AGENTS.md); people set up with [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Reference: how things are, kept current

| Document | What it is | Read it |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The units, layers and patterns, and the rules `npm run arch` and `npm run docs:check` enforce | Before changing code |
| [QUALITY-GATES.md](QUALITY-GATES.md) | The definition of done, the four gates, and every rule with what enforces it | Before a pull request or a release |
| [TESTING.md](TESTING.md) | The tests each change needs, layer by layer | When writing tests |
| [PLAYBOOK.md](PLAYBOOK.md) · [فارسی](PLAYBOOK.fa.md) | Every way X may limit automated work, and how Xomoni detects and answers each | Before changing anything that acts on X |
| [ROADMAP.md](ROADMAP.md) | What is done and what is left, phase by phase, with issues and pull requests | To pick a task, and to tick the one you finish |
| [STORE-LISTING.md](STORE-LISTING.md) | What the Chrome Web Store and Edge Add-ons ask for, ready to paste; tooling tests hold it to the manifest | When permissions, the name or the listing change |
| [features.json](features.json) | The feature registry both READMEs are written from ([ADR-0039](adr/0039-the-readme-comes-from-the-feature-registry.md)) | When a user-facing feature changes |
| [scenarios/](scenarios/README.md) | Each user-facing task's scenarios, at least 20, each tied to its browser test, and the standard they follow ([ADR-0038](adr/0038-user-scenarios-for-every-user-facing-task.md)) | When building or changing a user-facing task |

## Guides: how to do a task

| Document | What it is | Read it |
| --- | --- | --- |
| [RELEASING.md](RELEASING.md) | Shipping a version: the release issue, the tag, the stores, the check after | When cutting a release |
| [guides/](guides/) | Other how-tos, such as [making the store accounts](guides/STORE-ACCOUNTS-GUIDE.fa.md) (in Persian, for the maintainer) | When the task comes up |

## Explanation: why things are the way they are

| Document | What it is | Read it |
| --- | --- | --- |
| [adr/](adr/README.md) | The decision records: each decision with its context, consequences and the alternatives | When a rule looks odd, and before changing one |
| [RESEARCH.md](RESEARCH.md) | The research behind Xomoni, in Persian: managing an X account without X's API, and X's limits | For the background of the playbook |

## Reports: dated snapshots, not current truth

[reports/](reports/) holds status reports, reviews, analyses and plans, one folder per month ([2026-11](reports/2026-11/)). Each is a snapshot of the day it was written: what it calls next may be done, changed or dropped since. For how things are now, read the reference above, starting with the roadmap.

## Images

| Folder | What it holds |
| --- | --- |
| [screenshots/](screenshots/) | The screenshots in the READMEs |
| [store/](store/) | The stores' icons, promo tile and screenshots, listed in [STORE-LISTING.md](STORE-LISTING.md) |
| [brand/](brand/) | The concepts for Xomoni's mark ([ADR-0035](adr/0035-xomoni-has-its-own-mark.md)) |

## Adding a document

- **A report, review or plan** goes in `reports/<yyyy-mm>/`, with its date in its name (`STATUS-2026-11-14.md`) and its Persian version beside it (`.fa.md`).
- **A how-to** goes in `guides/`.
- **A new living document** at the root of `docs/` goes on `LIVING_DOCS` in [`tooling/docs-layout-lib.mjs`](../tooling/docs-layout-lib.mjs) and on this page, in the same pull request.

`npm run docs:check` fails for any other file at the root of `docs/`, and when this page misses a living document or a folder.
