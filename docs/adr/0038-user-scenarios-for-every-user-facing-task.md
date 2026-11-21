# ADR-0038: At least 20 user scenarios for every user-facing task, each proven in a browser

- Status: Accepted
- Date: 2026-11-21

## Context

Xomoni's unit and component tests are thorough, and coverage only goes up ([ADR-0017](0017-test-standard.md)). But no rule asks how a person uses a feature end to end:

- The end-to-end tests cover the website only, in Chromium only.
- They aren't tied to the tasks they prove.
- The extension's pages are tested in happy-dom, never in a real browser.

The maintainer asked that every task be tested by at least 20 scenarios in the browser. A bare count invites 20 copies of one test. The scenarios have to cover different kinds of things that happen to a person.

## Decision

1. **A user-facing task has a scenarios file.** A task is user-facing when it changes what a person sees or does on xomoni.com or in the extension. Its file is `docs/scenarios/<issue>-<slug>.md`, with at least 20 scenarios. They are written with the task, before or with the code, and reviewed in the same pull request.
2. **Every category has a minimum.**

   | Category | Minimum |
   | --- | --- |
   | `happy`: the main path works | 3 |
   | `invalid`: wrong or edge-case input | 3 |
   | `error`: the network, X, GitHub or Supabase fails | 3 |
   | `security`: another user, signed out, data that must not leave the browser | 3 |
   | `empty`: first run, nothing yet | 2 |
   | `cancel`: cancel, confirm, undo | 2 |
   | `a11y`: keyboard only, accessible names, no serious violation | 2 |
   | `browser`: another browser, system or screen size | 1 |
   | `persistence`: reload, a second tab, sign out and in | 1 |

3. **Each scenario has three parts:**
   - an id, `S<issue>-NN`;
   - Given / When / Then;
   - the Playwright test that proves it. The test's title starts with the id and carries the tag `@task-<issue>`.

   At most 3 scenarios in a file may be manual, each with the reason it can't be automated.
4. **A fix in an existing feature adds its scenario** to that feature's file, so the file keeps proving the whole feature.
5. **Checks:**
   - `npm run scenarios:check`, part of `npm run verify`, checks every file (#338).
   - The `pr-policy` check requires a scenarios file change in every user-facing pull request opened from 2026-11-22 on (#339).
6. **Features shipped before this decision** are on a list in the checker. They get their files over time (#345), and the list only shrinks.
7. **The extension's scenarios run against the built extension** in Playwright. They are served x.com pages recorded as fixtures, never a real account or a real X page ([ADR-0003](0003-no-credentials-no-evasion.md), [ADR-0004](0004-x-data-stays-local.md), #342).

## Consequences

- "How was this tested as a person uses it?" has an answer for every task: its file, and `npx playwright test --grep @task-<issue>`.
- The scenarios double as the task's acceptance criteria, and as a regression suite that grows with every task.
- Features take longer to build, and the end-to-end run takes longer.
- The extension's browser harness (#342) is needed before its tasks can meet the rule with automated tests. Until then, they use their 3 manual scenarios at most and wait on #342 for the rest.

## Alternatives considered

- **A count with no categories.** Twenty near-identical tests would pass it.
- **Gherkin with Cucumber.** It adds a framework and step definitions. A Markdown file plus Playwright test titles and tags gives the same traceability with the tools we have.
- **Manual QA scripts.** They aren't repeated on every change, and nothing checks that they were.
