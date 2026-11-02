# ADR-0017: Backend and frontend tests for every feature, enforced by the merge gate

- Status: Accepted
- Date: 2026-11-02

## Context

By November 2026 the extension's engine and kernel, the website's domain, use cases and adapters, and the database's Row Level Security all had tests, and the auth flows had end-to-end tests. But (#102):

- No React component had a test: neither the extension dashboard, where the person starts deletions, nor the website's forms.
- The job runner, the service worker and the notification code had none either.
- Nothing failed when a change added code without a test. Measured coverage was 46% of lines in the extension and 25% on the website.
- Vitest 3 had open security advisories (`vitest`, `@vitest/mocker`, `tinypool`).

Xomoni is about to be offered to other people. A dashboard control that starts work on X without its confirmation, or a website form that loses its captcha, must fail a test before it can merge.

## Decision

1. **Every feature ships with a backend test and a frontend test**, plus its failure and safety cases, and an end-to-end test when it crosses the browser, the website and Supabase. [`docs/TESTING.md`](../TESTING.md) says which tool tests which layer.
2. **Component tests** use Testing Library in happy-dom with Vitest 5: the extension dashboard with a `chrome` stub and `fake-indexeddb`; the website with fakes for `next/navigation`, `server-only` and the Turnstile widget (`apps/web/test/fakes`). Components are queried by role, label and text, the way a person uses them.
3. **Coverage thresholds** per workspace, measured by `@vitest/coverage-v8` on every `npm test`. They are set at the level reached when this was adopted and may only go up.
4. **Test presence**: [`tooling/check-tests.mjs`](../../tooling/check-tests.mjs) fails when a source file is imported by no test. A file with nothing to test on its own is listed there with the reason; a stale exemption fails too.
5. Both gates run in `npm run verify`, so in the pre-push hook and in CI, next to the database (pgTAP) and end-to-end (Playwright) jobs.

## Consequences

- "Is there a test for this?" has a mechanical answer for every file, and coverage can't silently drop.
- Writing a feature takes longer: a component test for each control that matters.
- Coverage numbers are a floor, not the goal: a test must assert behavior, not merely run lines. Reviews check that.
- The website's routes in `src/app` stay thin and are covered end to end rather than by unit tests.

## Alternatives considered

- **Coverage thresholds only.** A high overall number can hide an untested file; the presence check names it.
- **Snapshot tests for components.** They break on every markup change and say little about behavior.
- **Playwright for the dashboard.** Loading the real extension needs Chrome for Testing and a mock of x.com; component tests give fast feedback for the dashboard, and an extension end-to-end suite can come later.
- **jsdom instead of happy-dom.** The extension already used happy-dom for its X page tests; one DOM for both apps is simpler.
