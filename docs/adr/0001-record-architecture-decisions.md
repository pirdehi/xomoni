# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-10-31

## Context

Xomoni is open source and touches a sensitive area: acting on people's X accounts. Contributors, reviewers and coding assistants need to know not only what the code does but why it is built that way, especially where the "obvious" shortcut (calling X's API directly, storing a password, hiding automation) is deliberately off the table.

## Decision

Significant decisions are recorded as Architecture Decision Records in `docs/adr/`, one file per decision, numbered `NNNN-kebab-title.md`, using [`template.md`](template.md) (a short form of MADR). Each record has a Status (Proposed, Accepted, Deprecated, or Superseded by a later record), a Date, and Context, Decision and Consequences sections. Records are never rewritten after acceptance; a change of mind is a new record that supersedes the old one.

## Consequences

- `npm run docs:check` validates the format and that every record is listed in the [index](README.md).
- A pull request that changes the architecture includes its ADR.
