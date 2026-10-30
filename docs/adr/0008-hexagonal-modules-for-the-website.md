# ADR-0008: Hexagonal feature modules for the website, enforced by dependency-cruiser

- Status: Accepted
- Date: 2026-10-31

## Context

The website started as pages that called Supabase directly from components. That is quick, but it mixes rules (who may see what, where to redirect, which errors are safe to show) with framework and SDK code, makes the rules hard to test, and invites security mistakes such as trusting the client or leaking provider errors. Auth is about to grow (email sign-up, confirmation, password reset), so the structure has to hold.

## Decision

- Behavior lives in feature modules under `apps/web/src/modules/<name>/`, split into `domain/` (pure), `application/` (use cases and ports), `infrastructure/` (Supabase adapters), `server/` and `client/` (composition roots) and `ui/` (React). Routes in `app/` stay thin.
- Use cases depend on ports (interfaces); adapters implement them; composition roots wire them per request. Unit tests use in-memory fakes.
- The layer rules are written as dependency-cruiser rules in `.dependency-cruiser.cjs` and run in the pre-push hook and in CI. The rules and the layer table live in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md).

## Consequences

- A forbidden import fails the build, so the structure doesn't erode.
- More files per feature; small features may skip layers they don't need (for example, no `client/`).
- Domain rules (redirect safety, password policy, error wording) are unit tested without Supabase.

## Alternatives considered

- Pages calling Supabase directly: rejected for the reasons above.
- A separate backend service: unnecessary; Next.js Server Actions and Route Handlers are the backend.
