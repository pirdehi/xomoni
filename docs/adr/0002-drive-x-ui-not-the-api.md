# ADR-0002: Drive X's own UI instead of the X API

- Status: Accepted
- Date: 2026-10-29

## Context

X's API is paid per use and rate limited, and asking people for API keys is a barrier. Calling X's internal GraphQL endpoints directly is no longer viable either: requests need the anti-bot `x-client-transaction-id` header, which only X's own code can produce. Forging it would be detection evasion (see [ADR-0003](0003-no-credentials-no-evasion.md)). The research is in [`docs/RESEARCH.md`](../RESEARCH.md).

## Decision

The extension acts only through X's own web UI in a normal, visible x.com tab: it clicks the same buttons a person would (located by `data-testid`), at a human pace. It only *observes* X's network responses, through a read-only page-world script, to confirm each action and to read X's rate-limit headers. It never sends requests to X itself.

## Consequences

- No API keys, and X's own security checks apply to every action.
- X UI changes can break selectors; they are kept in one file (`apps/extension/src/content/dom.ts`) so a fix is small.
- Throughput is low by design; pacing rules live in the engine's limiter.

## Alternatives considered

- Official X API: cost, keys, and per-app limits that make cleanup of large accounts impractical.
- Direct GraphQL calls: require forging `x-client-transaction-id`; rejected.
