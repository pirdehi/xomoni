# User scenarios

Every user-facing task is proven by at least 20 user scenarios, each run in a real browser (ADR-0038, #338). A task is user-facing when it changes what a person sees or does on xomoni.com or in the extension. Its scenarios are written with the task, before or with the code, and reviewed in the same pull request. They are the task's acceptance criteria, and they stay as its regression suite: a later fix to the feature adds its scenario to the same file.

This page is the standard, for people and for AI agents. `npm run scenarios:check` (a step of `npm run verify`) enforces it.

## One file per task

`docs/scenarios/<issue>-<slug>.md`, such as `299-install-page.md`, starting with front matter:

```markdown
---
task: 299
title: Install with one click · 1: a simpler /install now
feature: install-guide
---
```

- `task`: the issue number, the same as in the file's name.
- `title`: the task's title.
- `feature` (optional): the feature's id in `docs/features.json`, once that registry exists (#337).

After the front matter, a title and a short paragraph may say what the file covers. Then come the scenarios, each under its own heading.

## A scenario

```markdown
## S299-02 · happy

- Given a visitor on /install, at step 1
- When they press Download the latest version at the top
- Then xomoni-extension.zip downloads
- And the guide moves on to step 3 of 5, with the focus on its title
- Test: apps/web/e2e/install.spec.ts
```

- **The heading** is `## S<issue>-NN · <category>`: the id, then one category below. Ids are unique in the file, and their number is the file's task.
- **The steps** are `Given`, `When` and `Then` lines, in that order, each as a list item; `And` adds to the line before it. A long line may go on, indented, on the next.
- **The last line** is either `Test: <path>`, the Playwright spec that proves the scenario, from the repository's root, or `Manual: <reason>`, why no browser test can prove it. A file may have 3 manual scenarios at most.

Describe what the page or the extension really does, from what the person sees: read the code before you write. Never invent behavior to fill a category. If a category can't be met honestly by an automated test, write a manual scenario and give the reason.

## Categories

Each file has at least 20 scenarios, with at least this many in each category:

| Category | What happens to the person | Minimum |
| --- | --- | --- |
| `happy` | The main path works | 3 |
| `invalid` | Wrong or edge-case input | 3 |
| `error` | The network, X, GitHub or Supabase fails | 3 |
| `security` | Another user, signed out, data that must not leave the browser | 3 |
| `empty` | First run, nothing yet | 2 |
| `cancel` | Cancel, confirm, undo | 2 |
| `a11y` | Keyboard only, accessible names, no serious violation | 2 |
| `browser` | Another browser, system or screen size | 1 |
| `persistence` | Reload, a second tab, sign out and in | 1 |

Twenty copies of one test would pass a bare count; the categories make each file cover the different things that happen to a person.

## The test that proves it

Each automated scenario is one Playwright test. Its title starts with the scenario's id, and it carries the tag `@task-<issue>`:

```ts
test('S299-02 the download moves the guide on to unzipping', { tag: ['@task-299'] }, async ({ page }) => {
  // …
});
```

So a task's scenarios run on their own:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-299
```

The website's tests live in `apps/web/e2e/`, with their helpers in `apps/web/e2e/support/`: the extension played at the page, browsers told apart by their user agent, store listings chosen per test, seeded accounts ([testing](../TESTING.md)).

### The extension's scenarios

A task in the extension proves its scenarios against the built extension in a real browser ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md), #342). Its tests live in `apps/web/e2e/extension/<slug>.spec.ts` and use the harness instead of the website's `test`:

```ts
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';

test('S400-01 the X window opens, and Home names the account', { tag: ['@task-400'] }, async ({ dashboard }) => {
  await openXWindow(dashboard);
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  // …
});
```

- Each test gets a fresh install: Xomoni's `dashboard` as it opens itself, with no account until the test opens the X window or an X page.
- x.com is served from synthetic fixtures (`apps/web/e2e/fixtures/x`). A scenario that needs X to answer otherwise (an `error`: a rate limit, X down, a page X changed) adds its own route over the harness's, with `answerWithRate` (X's rate-limit headers and clock, a 429 or a 503), `answerWithLikes` and `servePage` from `x-fixtures.ts`. `test.use({ xSignedIn: false })` shows X signed out, `setXSession` signs in or out, or in as the other made-up account, during a test, and `test.use({ xHistory: 'long' })` gives the account years of posts, replies, a repost and likes.
- A scenario about a cleanup goes through it as the person does with `apps/web/e2e/support/cleanup.ts`: browsing the profile, Cleanup and its keep rules, the typed DELETE, the risks, and the job's card.
- Nothing reaches the network, and a request to any host but x.com fails the test, which proves `security` scenarios about data that must stay in the browser.
- `a11y`: `tabTo(locator)` for keyboard-only paths, and `expectNoSeriousA11yViolations(page)` for "no serious violation".
- `browser`: CI runs every test again in Microsoft Edge (`e2e-edge`); `test.use({ colorScheme: 'dark' })` is another system setting.

Run a task's extension scenarios with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-400
```

What only a real X account can show (X's own pages changing, a real rate limit) stays manual, within the 3 a file may have.

## What the check fails on

`npm run scenarios:check` ([`tooling/check-scenarios.mjs`](../../tooling/check-scenarios.mjs), rules in [`tooling/scenarios-lib.mjs`](../../tooling/scenarios-lib.mjs)) lists every problem it finds, file and line:

- front matter that is missing or malformed, a task that isn't the issue in the file's name, a name that isn't `<issue>-<slug>.md`, or a `feature` that isn't in `docs/features.json`;
- fewer than 20 scenarios, or a category under its minimum;
- a heading that isn't `## S<issue>-NN · <category>`, an unknown category, a duplicate id, or an id whose number isn't the file's task;
- steps that aren't Given, When and Then in that order, or a line that is none of a scenario's parts;
- no `Test:` or `Manual:` line, or both; more than 3 manual scenarios, or one without its reason;
- a `Test:` path that isn't a Playwright spec in the repository, or a spec with no test whose title starts with the id;
- that test marked `skip`, `fixme`, `only` or `fail` (on itself, on a group around it, or by a `test.skip()` inside), or without the tag `@task-<issue>` (on itself or on a group around it);
- the other way round, a test whose title starts with an id no scenario has, or that carries `@task-<issue>` without an id of that task, so `--grep @task-<issue>` runs exactly the task's scenarios.

The check reads the files; it doesn't run the tests. CI's `e2e` job does, the website's and the extension's, and `e2e-edge` again in Edge.

## Files

- [`299-install-page.md`](299-install-page.md): the install page, /install, while no store lists Xomoni (#44, #299, #306).
- [`199-cleanup-by-date.md`](199-cleanup-by-date.md): cleanup by date, from the preview and the typed DELETE to the job's pace and its stops, in the extension (#199, #345).
- [`367-keep-rules.md`](367-keep-rules.md): the keep rules of a cleanup, likes, words, pasted links and the person's own threads, at their edges and in what the preview, the backup and the job leave out, in the extension (#367, #345).
- [`17-x-pacing.md`](17-x-pacing.md): within one fifth of X's limits, from the caps and the warm-up the dashboard shows to the waits for X's live limits and the risk ladder's stops, in the extension (#17, #345).
- [`305-one-click-updates.md`](305-one-click-updates.md): updating a zip install in one click, from the folder and the signed release to everything it refuses to install, in the extension as it will run once the release key is set up (#305, #345).
- [`226-sign-out.md`](226-sign-out.md): signing out of Xomoni, with or without the account's data and X's own sign-out, the signed-out page and signing in again, and what a sign-out keeps from X and stops sending, in the extension (#226, #345).
- [`232-one-sign-in.md`](232-one-sign-in.md): one sign-in for xomoni.com and Xomoni, each side with the other played at it: signing in and out from either, the messages Xomoni refuses, and who may send them (#228, #232, #345).
- [`300-move-your-data.md`](300-move-your-data.md): moving data to a new Xomoni, from *Export everything* to the checked import, what it refuses, and what a file can never do: leave the computer, start a job, speed Xomoni up or lift a stop, in the extension (#300, #345).
- [`158-watch.md`](158-watch.md): Watch, up to five searches on X's own Latest page, read-only and within Xomoni's read limits, with X's empty, failing and limited answers, in the extension (#158, #345).
