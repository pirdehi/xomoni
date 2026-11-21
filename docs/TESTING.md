# Testing

How Xomoni is tested, layer by layer, and what every change must include. The rules here are checked by `npm run verify` and CI; nothing merges without them ([ADR-0017](adr/0017-test-standard.md)).

## Every feature ships with tests on both sides

A change that adds or changes behavior includes, in the same pull request:

1. **A backend test**: the rule, use case, engine step or database policy behind the feature, including its failure cases.
2. **A frontend test**: what the person sees and can do on the page or component that exposes it (the extension dashboard or the website).
3. **The negative and safety cases**: what must _not_ happen (another user's data, a signed-out visitor, an unconfirmed `DELETE`, a pace above one fifth of X's limits, the website starting work on X).
4. **An end-to-end test** when the feature crosses the browser, the website and Supabase (sign-in, account changes, the live dashboard).
5. **User scenarios** when the task changes what a person sees or does: at least 20, across nine categories, each proven by a browser test ([user scenarios](scenarios/README.md)).

Bug fixes start with a test that fails without the fix.

## Which test covers which layer

| Layer | Where the tests live | Tool | What they prove |
| --- | --- | --- | --- |
| Database: tables, Row Level Security, functions | `supabase/tests/database/*.test.sql` | pgTAP (`supabase test db`) | The owner can, everyone else can't (another user, `anon`); limits and triggers hold. |
| Website domain and use cases | `apps/web/src/modules/*/{domain,application}/*.test.ts` | Vitest in Node, fake ports | Rules and every outcome of a use case, including each error code. |
| Website adapters | `apps/web/src/modules/*/infrastructure/*.test.ts` | Vitest, fake Supabase client | Rows map to domain types; Supabase errors map to our error codes. |
| Website server (Server Actions, session, proxy) | `apps/web/src/modules/*/server/*.test.ts`, `apps/web/src/shared/**/*.test.ts` | Vitest, mocked `next/headers` | Every action re-checks the session; redirects are safe; protected routes stay protected. |
| Website UI | `apps/web/src/modules/*/ui/*.test.tsx`, `apps/web/src/shared/ui/*.test.tsx` | Vitest + Testing Library in happy-dom | Forms, messages, disabled states, the captcha's states; the dashboard stays view-only. |
| Website end to end | `apps/web/e2e/*.spec.ts` | Playwright against local Supabase and Mailpit, in Chromium and in CI's `e2e-edge` job in Edge | Real flows in a real browser, with emails; no Content-Security-Policy violations, and no serious accessibility violation on any page (`a11y.spec.ts`). The extension is played at the page (`chrome.runtime` stubbed), or loaded for real: `fixed-id.spec.ts` runs a test extension with a fixed `key` in Chromium (#302). |
| Extension in a real browser | `apps/web/e2e/extension/*.spec.ts` | Playwright with the built extension installed, x.com served from synthetic fixtures, no network ([ADR-0040](adr/0040-test-the-extension-against-recorded-x-fixtures.md)) | The dashboard as installed, the content script on X's pages and what the dashboard takes from them, keyboard use, and no serious accessibility violation; in Chromium, and in Edge in CI ([below](#the-extension-in-a-real-browser)). |
| User scenarios | `docs/scenarios/<issue>-<slug>.md`, each proven by a test in `apps/web/e2e/*.spec.ts` | Markdown, and Playwright run by tag (`--grep @task-<issue>`) | A user-facing task as people use it: at least 20 scenarios (the main path, wrong input, failures, security, a first run, cancelling, keyboard and screen readers, other browsers and screens, what lasts), each tied to the test that proves it ([user scenarios](scenarios/README.md)). |
| Extension kernel and engine | `apps/extension/tests/*.test.ts` | Vitest + `fake-indexeddb` | Pacing never above one fifth of X's limits, the risk ladder, stop rules, parsers on real response shapes, job states. |
| Extension in the X page (content script, interceptor) | `apps/extension/tests/*.test.ts` | Vitest in happy-dom | X's buttons are found, nothing else is clicked, responses are matched only on the private channel. |
| Extension dashboard | `apps/extension/tests/ui/*.test.tsx` | Vitest + Testing Library + a `chrome` stub | Pages and components: what is shown, what each control does, confirmations before anything acts on X. |
| Themes | `packages/fluent-theme/tests/*.test.ts` | Vitest | Text meets WCAG AA (4.5:1) on every surface, in light and dark mode. |

The routes in `apps/web/src/app` are thin by design (rule `web-routes-are-thin`) and are covered by the end-to-end tests.

## Gates

| Gate | Checked by | Fails when |
| --- | --- | --- |
| Unit and component tests | `npm test` (in `npm run verify` and CI) | Any test fails. |
| Coverage | Each workspace's Vitest `coverage.thresholds` (`npm test` runs with coverage) | Lines, branches, functions or statements drop below the workspace's threshold. Thresholds only go up. |
| Test presence | `npm run tests:check` ([`tooling/check-tests.mjs`](../tooling/check-tests.mjs)) | A source file is imported by no test, unless it is listed there with the reason (types only, a thin entry point covered elsewhere). |
| User scenarios | `npm run scenarios:check` ([`tooling/check-scenarios.mjs`](../tooling/check-scenarios.mjs)), in `npm run verify` | A scenarios file has fewer than 20 scenarios, a category under its minimum or more than 3 manual ones; a scenario's test is missing, skipped or without its `@task-<issue>` tag; or a test names a scenario that doesn't exist ([user scenarios](scenarios/README.md#what-the-check-fails-on)). The tests themselves run in the `e2e` job. |
| No remote code | `npm run remote-code:check` ([`tooling/check-remote-code.mjs`](../tooling/check-remote-code.mjs)), in `npm run verify` and the release workflow | The built extension builds code from a string or loads it from another site, which Manifest V3 and the stores forbid ([store listing](STORE-LISTING.md#6-no-remote-code)). |
| No updater in the store build | `tooling/store-build.test.mjs`, in `npm run test:tooling` | The store build (`npm run build:store`) holds any of the one-click updater's code, or GitHub's access in its manifest ([ADR-0033](adr/0033-one-click-updates-for-the-zip-install.md)). |
| Database | CI job `database` | A pgTAP test fails, or the generated types drift from the migrations. |
| End to end | CI job `e2e` | A flow fails, the browser reports a policy violation, or axe finds a serious or critical accessibility violation: the website's tests, then the extension's in a real browser. |
| End to end in Edge | CI job `e2e-edge`, a required check since 2026-11-21 | The same, in Microsoft Edge. |

## Writing tests

- **Test behavior, not implementation.** Components are queried by role, label and visible text, the way a person finds them. No snapshot tests.
- **No real waiting.** Use `findBy…`, `vi.waitFor` or fake timers. No `setTimeout` sleeps.
- **Find what follows a dialog.** Right after a Fluent dialog opens or closes, the rest of the page is `aria-hidden` for a moment. Look up the dialog and the page's controls with `findBy…`, not `getBy…`, in that moment.
- **Independent tests.** Each test sets up its own data: `resetDb()` for the extension, `resetNavigation()` and `resetTurnstile()` for the website.
- **Fakes live in one place.** Extension: `apps/extension/tests/support/` (`stubChrome()`, account and page fixtures). Website: `apps/web/test/fakes/` (`next/navigation`, `server-only`, the Turnstile widget), wired in `apps/web/vitest.config.mts`. End to end: `apps/web/e2e/support/` (among them `totp.ts`, which makes an authenticator app's codes from the secret the page shows, RFC 6238, #173) and, for a real extension, `apps/web/e2e/fixtures/fixed-id-extension` (its id goes to the site as `NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID`, taken only on localhost).
- **The extension's browser tests** use `apps/web/e2e/support/extension.ts` (the built extension, a fresh profile per test, the dashboard, the X window) and `x-fixtures.ts` (x.com from `apps/web/e2e/fixtures/x`, the made-up `@xomoni_fixture`). Every end-to-end test may check accessibility with `expectNoSeriousA11yViolations(page)` (`apps/web/e2e/support/a11y.ts`).
- **Component test files** start with `// @vitest-environment happy-dom`; the extension's also import `fake-indexeddb/auto`.
- **Store listings are empty in the code** until the stores list Xomoni (#304). Website component tests mock `@/shared/config/store-listings` (`STORE_LISTINGS` as a getter, set per test); end-to-end tests put theirs in `window.__xomoniE2EStoreListings`, which only a build with `NEXT_PUBLIC_E2E_STORE_LISTINGS=1` reads (`playwright.config.ts` sets it); the extension's `StoreMoveCard` takes `listings`.
- **Web Locks are per file** in the extension's tests (`tests/setup.ts`, #271): Node's `navigator.locks` is shared by the whole process, so one file's runner would otherwise hold up another file's sign-out.
- **Types are strict in tests too** ([ADR-0016](adr/0016-strict-typescript-and-type-aware-lint.md)); tests may use `!`.

## Writing user scenarios

A task that changes what a person sees or does gets `docs/scenarios/<issue>-<slug>.md` in the pull request that builds it ([the standard](scenarios/README.md)). In short:

1. Read the code the person meets, then write at least 20 scenarios in Given / When / Then, at least the minimum in each category (`happy` 3, `invalid` 3, `error` 3, `security` 3, `empty` 2, `cancel` 2, `a11y` 2, `browser` 1, `persistence` 1). Only behavior the code really has.
2. Prove each one with a Playwright test whose title starts with its id and that carries `@task-<issue>`: `test('S299-02 the download moves the guide on to unzipping', { tag: ['@task-299'] }, …)`. Reuse `apps/web/e2e/support/`.
3. Where no browser test can prove a scenario, mark it `Manual:` with the reason; 3 at most per file.
4. Run `npm run scenarios:check`, then the task's tests: `npm run test:e2e -w @xomoni/web -- --grep @task-<issue>`.

A later fix to the feature adds its scenario to the same file.

## The extension in a real browser

`apps/web/playwright.extension.config.ts` runs the extension as people install it ([ADR-0040](adr/0040-test-the-extension-against-recorded-x-fixtures.md), #342). It needs no Supabase, no website and no network:

1. **The build.** The global setup (`e2e/support/build-extension.ts`) builds the extension as `npm run build` does, into a temporary folder, so it never tests a stale build nor rewrites the `dist` you may have loaded in Chrome. To test a copy built elsewhere, such as an unzipped release, set `XOMONI_E2E_EXTENSION=<folder>`.
2. **The browser.** Each test launches its own browser with a new profile, so it starts from a fresh install: Xomoni opens its dashboard by itself, as it does for a person. The browser is Playwright's Chromium, or `XOMONI_E2E_BROWSERS=msedge` (or `chrome`) for Edge or Chrome as installed on the computer. Chrome and Edge no longer take `--load-extension`, so the harness installs Xomoni the way their developer tools do (`Extensions.loadUnpacked`), after its routes are in place.
3. **X.** Every request to `https://x.com` is answered from `apps/web/e2e/fixtures/x`: pages with only what Xomoni reads (`apps/extension/src/content/dom.ts`), and GraphQL answers (`graphql/<Operation>.json`) with X's rate-limit headers. X's `twid` cookie names the made-up `@xomoni_fixture`, signed in unless a test sets `test.use({ xSignedIn: false })`. A test that needs X to answer otherwise adds a route of its own: Playwright tries the newest first.
4. **No network.** The browser resolves no host but localhost, and a request from a page to any host but x.com fails the test. Only the xomoni.com/welcome tab Xomoni opens on install is let go (blocked, not failed).

The fixtures are synthetic. Never record a real account's pages, posts, ids or cookies into them: write the smallest answer shaped like X's that the test needs, with the fixture account's ids (in `9000000000000000xxx`, a range X hasn't issued). When X changes a page or an answer, change the fixture in the same pull request as `content/dom.ts` or the parsers.

The helpers: `dashboard` (the tab Xomoni opened on install), `extensionId`, `serviceWorker`, `openXWindow(dashboard)` (presses *Open X window* and returns the X window's page) and `tabTo(locator)` (Tab until it has the focus).

## Accessibility

`expectNoSeriousA11yViolations(page)` (`apps/web/e2e/support/a11y.ts`, `@axe-core/playwright`) fails a test on any serious or critical violation axe finds, with every rule axe runs by default (WCAG 2.0 to 2.2, A and AA, and best practices). It waits for the page to settle, looks again when it finds something, and attaches the full results to the report. Tabster's focus sentinels, which Fluent adds around dialogs and menus, are left out: they are empty and pass the focus on at once.

- `apps/web/e2e/a11y.spec.ts` checks every page of xomoni.com, signed out and signed in, in light and dark mode.
- Feature tests call it where they reach a state no page shows on load: an error, an open dialog or menu, a step of a guide.
- The extension's tests check the dashboard before and after an account, in both modes, and every page of its menu.

A user scenario of the `a11y` category ([user scenarios](scenarios/README.md)) uses it for "no serious violation".

## Running them

```bash
npm test                                  # every workspace, with coverage
npm test -w @xomoni/extension             # one workspace
npx vitest run tests/ui -w @xomoni/extension    # a folder
npm run tests:check                       # test presence
npm run scenarios:check                   # user scenarios: each file against the standard
supabase start && supabase test db        # database (needs Docker)
supabase start && npm run test:e2e -w @xomoni/web   # end to end (needs Docker)
npm run test:e2e -w @xomoni/web -- --grep @task-299  # one task's user scenarios
npm run test:e2e:extension -w @xomoni/web             # the extension in a real browser (no Supabase needed)
XOMONI_E2E_BROWSERS=msedge npm run test:e2e:extension -w @xomoni/web   # the same in Edge, if installed
```

Playwright's Chromium is needed once: `npx playwright install chromium` in `apps/web`.

Coverage reports are written to `coverage/` in each workspace (`index.html`).

Vitest runs on half the machine's cores (`maxWorkers: '50%'` in each workspace's config). With a worker on every core, component tests ran past their waits whenever other apps were busy; with half, the suite is faster and passes every time.
