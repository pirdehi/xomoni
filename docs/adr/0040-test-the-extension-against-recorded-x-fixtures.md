# ADR-0040: Test the extension in a real browser against recorded X fixtures, never the real X

- Status: Accepted
- Date: 2026-11-21

## Context

[ADR-0038](0038-user-scenarios-for-every-user-facing-task.md) asks that every user-facing task be proven by scenarios in a real browser. The extension's scenarios must run against the built extension (point 7). Until now, its pages and its content script were tested only in happy-dom: no real browser, no real extension APIs, no real content-script injection. The website's end-to-end tests ran in Chromium only, and nothing checked accessibility with a tool.

A browser test of the extension needs x.com: the content script runs only on `https://x.com/*`, and the dashboard learns about an account from what X's page shows. Testing against the real x.com would break Xomoni's own rules:

- It would need a real X account, signed in, which means a password and session cookies in the test ([ADR-0003](0003-no-credentials-no-evasion.md)).
- A browser driven by Playwright is an automated browser. Pointing it at X is exactly what the [playbook](../PLAYBOOK.md) tells people not to do (B8), and would risk that account.
- The posts and profile it read would be a real person's X content, kept in test reports and CI logs ([ADR-0004](0004-x-data-stays-local.md)).
- It would fail whenever X changed, was slow, or limited the account, so it couldn't be a merge gate.

## Decision

1. **The extension's browser tests serve x.com from fixtures.** The harness (`apps/web/e2e/support/extension.ts`, `x-fixtures.ts`) routes every request to `https://x.com` to files in `apps/web/e2e/fixtures/x/`: pages shaped like X's where Xomoni reads them, and GraphQL answers shaped like X's (`graphql/<Operation>.json`), with X's rate-limit headers. A test that needs X to answer otherwise (an error, a rate limit, another page) adds its own route.
2. **The fixtures are synthetic.** They show one made-up account, `@xomoni_fixture`, whose id and posts' ids are in a range X hasn't issued yet (`9000000000000000001`). No real person's posts, names, handles or ids are recorded, and none may be added. "Recorded" means stored and replayed, shaped after X's answers, not captured from someone's account.
3. **Nothing reaches the network.** The browser resolves no host but localhost (`--host-resolver-rules`), so a request the routes miss fails instead of reaching X. A request from a page to any host but x.com is blocked, and fails the test. The one exception is the xomoni.com/welcome tab Xomoni opens on install, which is blocked without failing.
4. **The harness tests the build a person installs.** Its global setup builds the extension as `npm run build` does, into a temporary folder, so a run never tests a stale build, nor rewrites a `dist` someone has loaded. The browser installs it unpacked, the way its developer tools do (`Extensions.loadUnpacked`), once the routes are in place. Chrome and Edge no longer take `--load-extension`, and this works in Playwright's Chromium, Chrome and Edge alike.
5. **Only the X-facing parts are played.** The tests drive the dashboard as a person does, press its buttons, and check what it shows. They never call Xomoni's code from outside, forge an input event on X's page, or solve anything. The fixtures stand in for X; the extension under test is unchanged.
6. **Test code never ships.** The harness, the fixtures and the specs live in `apps/web/e2e/`, outside every build. `npm run arch` keeps apps apart, and `tooling/check-remote-code.mjs` still checks the built extension.
7. **Accessibility is checked in the same tests.** `expectNoSeriousA11yViolations(page)` (`apps/web/e2e/support/a11y.ts`, `@axe-core/playwright`) fails a test on any serious or critical violation. The website's tests use it too.
8. **Chrome and Edge.** CI runs the extension's tests and the website's in Playwright's Chromium (the `e2e` job), and both again in Microsoft Edge (the `e2e-edge` job).

## Consequences

- An extension task can meet ADR-0038 with browser tests: its scenarios use `apps/web/e2e/support/extension.ts`, and run with `npm run test:e2e:extension -w @xomoni/web`.
- The tests run in about a minute, without Supabase, the website or the network.
- They prove what Xomoni does with X's pages as the fixtures show them, not that X still shows them that way. X's changes are caught by the pilot and by people's reports, as before ([PLAYBOOK F1](../PLAYBOOK.md)). When X changes, the fixture changes in the same pull request as `content/dom.ts` or the parsers.
- Each new X page or answer a test needs is a new synthetic fixture, reviewed like code.
- The service worker's own requests aren't seen by Playwright's routes; the host rule still keeps them off the network.
- Fixing what axe found changed shared colors: the light theme's muted grey and the blue of buttons and brand text are a shade deeper, to meet WCAG AA.

## Alternatives considered

- **A test X account on the real x.com.** Needs credentials in CI, risks the account, reads X content into logs, and fails with X. Rejected by ADR-0003 and ADR-0004.
- **HAR files recorded from a real session.** Playwright can replay them, but they would hold a real person's posts, ids and cookies. Hand-made fixtures shaped like X's answers give the same coverage with nothing personal in them.
- **Only happy-dom.** It has no extension APIs, no content-script injection, no service worker and no layout, so it can't prove the extension works as installed.
- **`--load-extension`.** Works in Playwright's Chromium only, and loads the extension before routes can be set, so its install tab would race them.
