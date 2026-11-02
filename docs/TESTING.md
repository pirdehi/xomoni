# Testing

How Xomoni is tested, layer by layer, and what every change must include. The rules here are checked by `npm run verify` and CI; nothing merges without them ([ADR-0017](adr/0017-test-standard.md)).

## Every feature ships with tests on both sides

A change that adds or changes behavior includes, in the same pull request:

1. **A backend test**: the rule, use case, engine step or database policy behind the feature, including its failure cases.
2. **A frontend test**: what the person sees and can do on the page or component that exposes it (the extension dashboard or the website).
3. **The negative and safety cases**: what must _not_ happen (another user's data, a signed-out visitor, an unconfirmed `DELETE`, a pace above one fifth of X's limits, the website starting work on X).
4. **An end-to-end test** when the feature crosses the browser, the website and Supabase (sign-in, account changes, the live dashboard).

Bug fixes start with a test that fails without the fix.

## Which test covers which layer

| Layer | Where the tests live | Tool | What they prove |
| --- | --- | --- | --- |
| Database: tables, Row Level Security, functions | `supabase/tests/database/*.test.sql` | pgTAP (`supabase test db`) | The owner can, everyone else can't (another user, `anon`); limits and triggers hold. |
| Website domain and use cases | `apps/web/src/modules/*/{domain,application}/*.test.ts` | Vitest in Node, fake ports | Rules and every outcome of a use case, including each error code. |
| Website adapters | `apps/web/src/modules/*/infrastructure/*.test.ts` | Vitest, fake Supabase client | Rows map to domain types; Supabase errors map to our error codes. |
| Website server (Server Actions, session, proxy) | `apps/web/src/modules/*/server/*.test.ts`, `apps/web/src/shared/**/*.test.ts` | Vitest, mocked `next/headers` | Every action re-checks the session; redirects are safe; protected routes stay protected. |
| Website UI | `apps/web/src/modules/*/ui/*.test.tsx`, `apps/web/src/shared/ui/*.test.tsx` | Vitest + Testing Library in happy-dom | Forms, messages, disabled states, the captcha's states; the dashboard stays view-only. |
| Website end to end | `apps/web/e2e/*.spec.ts` | Playwright against local Supabase and Mailpit | Real flows in a real browser, with emails; no Content-Security-Policy violations. |
| Extension kernel and engine | `apps/extension/tests/*.test.ts` | Vitest + `fake-indexeddb` | Pacing never above one fifth of X's limits, the risk ladder, stop rules, parsers on real response shapes, job states. |
| Extension in the X page (content script, interceptor) | `apps/extension/tests/*.test.ts` | Vitest in happy-dom | X's buttons are found, nothing else is clicked, responses are matched only on the private channel. |
| Extension dashboard | `apps/extension/tests/ui/*.test.tsx` | Vitest + Testing Library + a `chrome` stub | Pages and components: what is shown, what each control does, confirmations before anything acts on X. |

The routes in `apps/web/src/app` are thin by design (rule `web-routes-are-thin`) and are covered by the end-to-end tests.

## Gates

| Gate | Checked by | Fails when |
| --- | --- | --- |
| Unit and component tests | `npm test` (in `npm run verify` and CI) | Any test fails. |
| Coverage | Each workspace's Vitest `coverage.thresholds` (`npm test` runs with coverage) | Lines, branches, functions or statements drop below the workspace's threshold. Thresholds only go up. |
| Test presence | `npm run tests:check` ([`tooling/check-tests.mjs`](../tooling/check-tests.mjs)) | A source file is imported by no test, unless it is listed there with the reason (types only, a thin entry point covered elsewhere). |
| Database | CI job `database` | A pgTAP test fails, or the generated types drift from the migrations. |
| End to end | CI job `e2e` | A flow fails or the browser reports a policy violation. |

## Writing tests

- **Test behavior, not implementation.** Components are queried by role, label and visible text, the way a person finds them. No snapshot tests.
- **No real waiting.** Use `findBy…`, `vi.waitFor` or fake timers. No `setTimeout` sleeps.
- **Independent tests.** Each test sets up its own data: `resetDb()` for the extension, `resetNavigation()` and `resetTurnstile()` for the website.
- **Fakes live in one place.** Extension: `apps/extension/tests/support/` (`stubChrome()`, account and page fixtures). Website: `apps/web/test/fakes/` (`next/navigation`, `server-only`, the Turnstile widget), wired in `vitest.config.ts`.
- **Component test files** start with `// @vitest-environment happy-dom`; the extension's also import `fake-indexeddb/auto`.
- **Types are strict in tests too** ([ADR-0016](adr/0016-strict-typescript-and-type-aware-lint.md)); tests may use `!`.

## Running them

```bash
npm test                                  # every workspace, with coverage
npm test -w @xomoni/extension             # one workspace
npx vitest run tests/ui -w @xomoni/extension    # a folder
npm run tests:check                       # test presence
supabase start && supabase test db        # database (needs Docker)
supabase start && npm run test:e2e -w @xomoni/web   # end to end (needs Docker)
```

Coverage reports are written to `coverage/` in each workspace (`index.html`).
