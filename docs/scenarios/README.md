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

The website's tests live in `apps/web/e2e/`, with their helpers in `apps/web/e2e/support/`: the extension played at the page, browsers told apart by their user agent, store listings chosen per test, seeded accounts ([testing](../TESTING.md)). The extension's own pages get a browser harness in #342; until then, their tasks use their manual scenarios.

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

The check reads the files; it doesn't run the tests. CI's `e2e` job does.

## Files

- [`299-install-page.md`](299-install-page.md): the install page, /install, while no store lists Xomoni (#44, #299, #306).
