---
name: Release
about: The readiness checklist for one version. Open it before the release pull request; the release waits for it.
title: 'Release vX.Y.Z'
labels: release
---

<!--
One issue per version, titled exactly "Release vX.Y.Z". Tick a box only once you have checked it, and put the proof
next to it: a link to the CI run, the smoke test's notes. The release workflow refuses to publish while a box under
"Before the tag" is unticked (#340); boxes elsewhere don't count. Rules and why:
https://github.com/pirdehi/xomoni/blob/main/docs/QUALITY-GATES.md
-->

Release pull request: #
Previous version: vX.Y.Z

## Before the tag

**Code and structure**

- [ ] CI is green on the release pull request: `verify`, `database`, `e2e` (run: )
- [ ] Since the last release, no rule, threshold or required check was relaxed without an ADR

**Docs**

- [ ] `node tooling/release.mjs check vX.Y.Z` passes: the versions match the tag, and `CHANGELOG.md` has the section
- [ ] The README's features and status are current for this version
- [ ] Every decision in this release has an ADR, and its tasks are ticked in `docs/ROADMAP.md`

**Tests**

- [ ] Backend and API: database (pgTAP), use case, adapter and Server Action tests are green
- [ ] Frontend: the website's and the extension's component tests are green
- [ ] End to end: green in a real browser
- [ ] Every user-facing task in this release has its scenarios file, at least 20, all green
- [ ] Data moves from the previous version: exported there, imported into this one ([ADR-0032](https://github.com/pirdehi/xomoni/blob/main/docs/adr/0032-move-data-between-xomoni-versions.md))

**Security**

- [ ] No open high or critical alert in code scanning or Dependabot, and `npm audit --audit-level=high` passes on the release pull request (the tag runs it again)
- [ ] New extension permissions, if any, are justified in `docs/STORE-LISTING.md`
- [ ] The safety checklist of `docs/PLAYBOOK.md` holds: pacing, stop rules, X's data stays in the browser

**The package**

- [ ] Smoke test of the built zip: a clean install, and an update from the previous version (notes: )
- [ ] The rollback below is written

**Go**

- [ ] Go: the maintainer approves this release

## Rollback

<!-- If this version is bad: which version people go back to, how (the zip, the stores), and what happens to their data. -->

## After publishing

Not checkboxes: the workflow comments the release here and closes this issue.

- The check after the release comments here: the files downloaded from the release and from `releases/latest`, `SHA256SUMS`, and `gh attestation verify` on each zip (#343). If it failed, see "When the check after the release fails" in `docs/RELEASING.md`.
- Record the release in `public.extension_releases` (step 6 of `docs/RELEASING.md`).
