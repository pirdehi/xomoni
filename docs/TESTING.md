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
| Live queries keep Dexie's zone | `tooling/live-queriers.test.mjs`, in `npm run test:tooling` | An extension live query's querier is a plain function that returns anything but a `db` table call: Dexie follows only async queriers, and such a one broke the dashboard's other live queries (#459). |
| No updater in the store build | `tooling/store-build.test.mjs`, in `npm run test:tooling` | The store build (`npm run build:store`) holds any of the one-click updater's code, or GitHub's access in its manifest ([ADR-0033](adr/0033-one-click-updates-for-the-zip-install.md)). |
| Database | CI job `database` | A pgTAP test fails, or the generated types drift from the migrations. |
| End to end | CI job `e2e` | A flow fails, the browser reports a policy violation, or axe finds a serious or critical accessibility violation: the website's tests and the extension's in a real browser. `e2e` is a gate over its parts, each on a runner of its own (`e2e (website-1)`, `e2e (website-2)`, `e2e (extension-1)` to `e2e (extension-4)`, each suite split with Playwright's `--shard`; the extension's four since its suite outgrew two shards' 30 minutes in Edge, every website shard with a Supabase of its own, #412); a part that fails or is cancelled fails the gate. |
| End to end in Edge | CI job `e2e-edge`, a required check since 2026-11-21 | The same, in Microsoft Edge, with its own parts (`e2e-edge (website-1)` and so on). |

## Writing tests

- **Test behavior, not implementation.** Components are queried by role, label and visible text, the way a person finds them. No snapshot tests.
- **No real waiting.** Use `findBy…`, `vi.waitFor` or fake timers. No `setTimeout` sleeps.
- **Find what follows a dialog.** Right after a Fluent dialog opens or closes, the rest of the page is `aria-hidden` for a moment. Look up the dialog and the page's controls with `findBy…`, not `getBy…`, in that moment.
- **Independent tests.** Each test sets up its own data: `resetDb()` for the extension, `resetNavigation()` and `resetTurnstile()` for the website.
- **Fakes live in one place.** Extension: `apps/extension/tests/support/` (`stubChrome()`, account and page fixtures). Website: `apps/web/test/fakes/` (`next/navigation`, `server-only`, the Turnstile widget, and Polar: `polar.ts`, a fake of its API with failures on demand and `signTestEvent`, which signs an event as Polar does, #420), wired in `apps/web/vitest.config.mts`; the fakes' own tests sit beside them. No test reaches the real Polar: `test/setup.ts` refuses a request to polar.sh in unit tests, and `e2e/support/test.ts` fails a browser test that makes one. End to end: `apps/web/e2e/support/` (among them `polar.ts`, a fake Polar on localhost whose checkout sends a signed event to a webhook and returns to the checkout's `success_url`, #420, `totp.ts`, which makes an authenticator app's codes from the secret the page shows, RFC 6238, #173) and, for a real extension, `apps/web/e2e/fixtures/fixed-id-extension` (its id goes to the site as `NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID`, taken only on localhost).
- **The extension's browser tests** use `apps/web/e2e/support/extension.ts` (the built extension, a fresh profile per test, the dashboard, the X window) and `x-fixtures.ts` (x.com from `apps/web/e2e/fixtures/x`, the made-up `@xomoni_fixture`). Every end-to-end test may check accessibility with `expectNoSeriousA11yViolations(page)` (`apps/web/e2e/support/a11y.ts`).
- **Real data never goes into a fixture** (#424, [ADR-0043](adr/0043-the-vault-x-files-kept-on-the-computer.md)). X's files are made up in the shape X writes them, never copied from a real account: a real file is looked at only for its shape (folder and file names, keys, column names), and none of its values is kept. Ids are in `9000000000000000xxx` and above, a range X hasn't issued, and the handles are the made-up `@xomoni_fixture` and `@fixture_friend`. X's archive comes from `buildArchive({ account, tweets, likes, manifest, extra })`: `apps/extension/tests/support/archive.ts` for the unit tests, as a `File`, and `apps/web/e2e/support/archive.ts` for the browser tests, written to a temporary folder for the file chooser. Both write `data/manifest.js` with counts that match, and `extra` takes a feature's own files, such as `data/follower.js`. X's analytics exports are in `apps/web/e2e/fixtures/analytics/`: posts in X's current format (`content-2026.csv`), days (`overview-2026.csv`), posts in the older format (`tweet-activity-legacy.csv`), a CSV that isn't X's (`not-analytics.csv`) and a damaged one (`broken.csv`). `tests/archive-builder.test.ts` checks that the builder's ZIP is what Xomoni reads, and that no fixture holds an id or handle outside the made-up ones.
- **Component test files** start with `// @vitest-environment happy-dom`; the extension's also import `fake-indexeddb/auto`.
- **Store listings are empty in the code** until the stores list Xomoni (#304). Website component tests mock `@/shared/config/store-listings` (`STORE_LISTINGS` as a getter, set per test); end-to-end tests put theirs in `window.__xomoniE2EStoreListings`, which only a build with `NEXT_PUBLIC_E2E_STORE_LISTINGS=1` reads (`playwright.config.ts` sets it); the extension's `StoreMoveCard` takes `listings`.
- **Web Locks are per file** in the extension's tests (`tests/setup.ts`, #271): Node's `navigator.locks` is shared by the whole process, so one file's runner would otherwise hold up another file's sign-out.
- **Days by the computer's calendar.** The product shows a time's day, month and hour in the person's time zone, and the tests run in any zone. A unit test that checks a day the page shows puts its times at local noon (`new Date(2026, 10, 27, 12)`) or expects what the product's formatter says (`fmtDate`), not a day written for UTC (#414). `TZ=Pacific/Kiritimati` (UTC+14) and `TZ=Pacific/Pago_Pago` (UTC−11) are the two ends to try.
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
3. **X.** Every request to `https://x.com` is answered from `apps/web/e2e/fixtures/x`: pages with only what Xomoni reads (`apps/extension/src/content/dom.ts`), and GraphQL answers (`graphql/<Operation>.json`) with X's rate-limit headers. As X's web app does, the profile page asks X's GraphQL API for its tab's timeline (posts, replies or likes) and shows what X answered: the posts, X's empty state, or X's error panel. X's `twid` cookie names the made-up `@xomoni_fixture`, signed in unless a test sets `test.use({ xSignedIn: false })`, and the sidebar names whoever it says. `test.use({ xHistory: 'long' })` gives the account years of posts, replies, a repost and likes (`graphql/long-history/`, #345). A test that needs X to answer otherwise adds a route of its own: Playwright tries the newest first.
4. **No network.** The browser resolves no host but localhost, and a request from a page to any host but x.com fails the test. Only the xomoni.com/welcome tab Xomoni opens on install is let go (blocked, not failed).
5. **At night.** Xomoni works only within the person's active hours, 8:00 to 23:00 by default, by the computer's clock. The config runs every test at night, local time (`e2e/support/time-of-day.ts`, #414): it sets `TZ` to a whole-hour zone where it is now 2:00 to 6:00, which the workers and the browsers inherit. So a test that starts a job turns active hours off first (`workAnyTime(dashboard)` in `cleanup.ts`), unless active hours are what it tests, and one that forgets fails every time, not only in the runs that fall at night. The zone stays within UTC−9 to UTC+11, where the fixtures' times (09:26 to 12:00 UTC) keep their day. `XOMONI_E2E_HOUR=14` runs at another local hour; a `TZ` you set is kept.

The fixtures are synthetic. Never record a real account's pages, posts, ids or cookies into them: write the smallest answer shaped like X's that the test needs, with the fixture account's ids (in `9000000000000000xxx`, a range X hasn't issued). When X changes a page or an answer, change the fixture in the same pull request as `content/dom.ts` or the parsers.

The helpers: `dashboard` (the tab Xomoni opened on install), `extensionId`, `serviceWorker`, `browserErrors` (the console errors and uncaught exceptions of the test's browser, its pages' and Xomoni's service worker's, from launch on; the service worker's exceptions come through a DevTools session of the harness's own, #419), `newXomoni()` (another fresh install in a browser of its own, as the new Xomoni a person moves their data to, #300; `newXomoni(folder)` installs another build, such as a release's), `openXWindow(dashboard)` (presses *Open X window* and returns the X window's page) and `tabTo(locator)` (Tab until it has the focus). For X's side, `x-fixtures.ts` has `setXSession(context, id)` (signed in as the fixture account or the other made-up one, `FRIEND_ACCOUNT`, or signed out), `servePage(context, path, file)` (another page at a path, such as `home-limited.html`, X's Home with its notice over a limited account, `home-suspended.html` over a suspended one, both drawn a moment after the page loads as X's web app draws its pages (#375), or `home-quoting-notice.html`, a post that quotes X's notice), `servePageWithNotice(context, path, file, notice)` (a page on which X draws its notice together with the posts), `answerLate(context, operation, ms)` (X's usual answer to an operation, that many milliseconds late), `answerWithRate(context, operation, rate)` (X's rate-limit headers on an operation: how much of the window is used, when it resets, or no headers at all, and X's clock in its `date`; or a 429 or a 503) `answerWithLikes(context, operation, likes)` (other like counts on posts, as X shows them once people have liked them since, #367) and `answerWithRepliesToAccount(context, operation, replies)` (replies the made-up `FRIEND_ACCOUNT` wrote to the fixture account's posts, which Xomoni keeps for *Replies to you*, #256). `xomoni-site.ts` plays xomoni.com at the extension (#345): its pages, which sign Xomoni in through Chrome's own channel as the website does (`signIn`), and the functions the extension calls on its Supabase project, answering from a small state (`release` says which version is out); the service worker's requests go through the same routes as the pages'. `release.ts` is for the one-click update (#305): `buildTrusting(key)` builds Xomoni trusting a throwaway Ed25519 key instead of `release-keys.json`'s, a spec installs it with the `extensionBuild` fixture, and `serveRelease` serves a release zipped (`zipOf`) and signed with that key at GitHub's release URLs. `store-build.ts` is for the stores (#304): `buildListedIn(listings)` builds Xomoni listed in the stores a test names, as it will be once they approve it, for a spec to install the same way. Chrome's own prompts, which Playwright can't answer (its folder picker, its prompt for host access), are played at the page by the spec that needs them, and say so. X's search page (`/search`, `search.html`) asks for `SearchTimeline` and draws what X answered, as the profile page does (#158). `x-archive.ts` makes X's archive of an account, as the ZIP X sends (`archiveFiles`, `archiveZip`), and drops files on a page (`dropFiles`); X's archive page is `fixtures/x/archive-*.html`. `cleanup.ts` goes through a cleanup as the person does: browsing the profile, Cleanup, the typed DELETE, the risks, active hours off in Settings, and the job's card with what it waits for (#345), and `keepRules(dashboard)` finds the keep rules under *Exceptions* (#367).

A job waits as Xomoni's pace says, in a dedicated worker Playwright's clock doesn't reach. So a test waits for a job's first page load (12 to 24 seconds for a new Premium account, and up to 90 more one time in twenty) only where its scenario needs that page, and never for a delete, which comes minutes later.

## Performance at scale

A heavy X user has more than 100,000 posts and 100,000 likes. Two tests run Xomoni at that size (#390), with a history made in the test from a seeded generator, the same at every run and never anyone's real data:

| Test | What it runs | The history |
| --- | --- | --- |
| `apps/extension/tests/scale.test.ts` | The queries behind Home, the Library, Cleanup, the daily numbers, the archive import, *Export everything* and the move-your-data import, on Dexie and `fake-indexeddb` | `tests/support/history.ts`: posts, replies (a third in the person's own threads) and reposts, likes, from X's archive, from X's pages or both, some removed by Xomoni with their lines in the log, the jobs, 400 days of daily numbers and others' replies |
| `apps/web/e2e/extension/scale.spec.ts` | The built extension in Chromium: X's archive imported in the Library, the Library opened, paged, filtered and searched, Cleanup's count with keep rules, Home with its chart, Reach over 30 days and over everything, its posts given views (#431), *Export everything*, *Delete local data*, and the export imported into the emptied Xomoni | `e2e/support/scale.ts`: X's archive ZIP of the same mix, over 15 years |
| `apps/extension/tests/reach-stats.test.ts` | Reach's comparisons (#429, #431): 50,000 posts compared with 2,000 bootstrap resamples within 500 ms, P5.4.3's budget, on a loaded machine with coverage on. A resample's median is drawn from its order statistic (`resampledMedian`), and two tests check it against the bootstrap's exact distribution. | Two groups of 25,000 views from a seeded generator |
| `apps/extension/tests/reach-perf.test.ts` | Reach at 50,000 posts (#431, P5.4.3, #501): the posts read within a second, a year of daily numbers among them, the three comparisons within half a second, and the suspected posts of 24 months of X's labels within half a second. The posts' hour and day in a time zone use one formatter per zone: making one for each post took six seconds at that size | 50,000 posts over two years with views, links and photos, from a pattern; X's index played, as `fake-indexeddb` would take minutes to fill |
| `apps/extension/tests/vault-perf.test.ts` | The vault's paths (#426): a page of the account's timeline, the Vault page's sources card, the export's estimate, the reminder, the ledger, a batch of analytics merged, and X's analytics export of posts and days imported | Made in the test: 50,000 posts' analytics, three years of days, 20,000 timeline entries and 500 imports |
| `apps/web/e2e/extension/vault-perf.spec.ts` | The built extension: X's archive and an analytics export of 50,000 posts imported on the Vault page, the page opened, *Export my vault* | `e2e/support/scale.ts`'s archive, and a CSV made in the test |

Both run at a fiftieth of the size in the normal suites (`npm test`, `npm run test:e2e:extension`). The browser's runs at the full size on demand; `XOMONI_SCALE` sets any share of it, for either:

```bash
npm run test:e2e:scale -w @xomoni/web        # the built extension, 100,000 posts and 100,000 likes, 4 to 7 minutes
XOMONI_SCALE=0.2 npm run test:e2e:extension -w @xomoni/web -- scale.spec.ts   # a fifth of it
XOMONI_SCALE=0.2 npx vitest run tests/scale.test.ts      # in apps/extension: the queries, a fifth of it
```

The unit test's budgets on what a query reads hold at any size, so the normal suite's fiftieth proves them; `fake-indexeddb` walks a cursor or skips rows (`offset`) in milliseconds per row, so beyond a fifth of the size it takes minutes for nothing more.

Each path has budgets, wide enough for CI's runners: they catch a path that went from seconds to minutes, not a few percent.

- **What a query reads** (the unit test, at any size): rows, cursor steps and entries counted on an index, through a Dexie middleware (`tests/support/reads.ts`). A browser's IndexedDB walks a cursor a row at a time and checks each entry an index count counts against its row, both far slower than a bulk read (`toArray()` of a range) or a count on the primary key. So: the Home counts and the chart count only what was removed on an index and nothing row by row; a Library page reads its 25 rows; a search, Cleanup's preview and the copy's status read in bulk, never with a cursor; the archive import saves 20,000 rows at a time, each save making the open pages count again.
- **How long a path takes** (both tests). The times that matter are the browser's: `fake-indexeddb` takes milliseconds per cursor step, so its times only bound the unit test. The browser's budgets, at the full size:

| Path | Budget | Before #390 | After |
| --- | --- | --- | --- |
| Archive import, 200,000 rows, on the Library | 240 s | 236 to 287 s | 78 to 104 s |
| The Library opens (its counts and first page) | 10 s | 4.2 to 4.9 s | 1.1 s |
| The Library: next page, likes, removed | 5 s each | 0.1 s | 0.1 to 0.2 s |
| The Library: a search with no match, over 55,000 posts | 15 s | 1.9 to 4.2 s | 1.0 to 2.0 s, with its quarter-second pause |
| Cleanup: the count of posts older than a year | 15 s | 3.9 to 5.1 s | 1.7 to 2.5 s |
| Cleanup: the count with keep rules | 15 s | 3.0 to 4.1 s | 0.6 to 0.8 s |
| Home: its counts and its chart by year | 10 s | 5.4 s | 1.7 s |
| Reach over the last 30 days, then over every post (#431, #501), the archive's 88,000 posts and replies given views first, until the page shows them (the comparisons follow) | 10 s, 6 s | 0.3 s, 3.4 s to 3.6 s | 0.2 s, 2.3 s; 1.2 s at 50,000 posts and replies |
| *Export everything* | 120 s | 3.5 to 5.0 s | 2.7 to 5.4 s |
| *Delete local data* | 180 s | 29 to 38 s | 27 to 66 s (unchanged code) |
| The move-your-data import into an emptied Xomoni | 240 s | 58 to 77 s | 56 to 118 s (unchanged code) |

The vault's budgets (#426), at the full size: a page of the timeline reads at most two pages of rows (its events and the risk ladder's), the sources card and the export's estimate read no analytics row (they count on the indexes), a batch of 2,000 posts' analytics merges within 200 ms in a browser, the Vault page shows its sources within 1.5 s, and X's archive of 200,000 rows imports on it within 240 s, as in the Library. On `fake-indexeddb` at the full size the vault's queries take 3 to 56 ms, a 2,000-post batch 132 ms, and importing an analytics export of 50,000 posts and 365 days 3.7 s.

Measured on a laptop busy with other work, in Playwright's Chromium: each range is the runs seen, so read them as orders of magnitude. The import's floor is IndexedDB's own writes, about a quarter of a millisecond per row with the inventory's indexes: the move-your-data import, one transaction, takes as long. Reports on xomoni.com read at most 400 days of numbers per account from the cloud, which never holds the inventory (ADR-0004), so its size can't slow them; the extension's side of the daily numbers, `dailyRows`, reads only the days asked for, which the unit test checks.

## Accessibility

`expectNoSeriousA11yViolations(page)` (`apps/web/e2e/support/a11y.ts`, `@axe-core/playwright`) fails a test on any serious or critical violation axe finds, with every rule axe runs by default (WCAG 2.0 to 2.2, A and AA, and best practices). It waits for the page to settle, looks again when it finds something, and attaches the full results to the report. Tabster's focus sentinels, which Fluent adds around dialogs and menus, are left out: they are empty and pass the focus on at once.

- `apps/web/e2e/a11y.spec.ts` checks every page of xomoni.com, signed out and signed in, in light and dark mode.
- `apps/web/e2e/extension/a11y.spec.ts` checks every page of the built extension the address can open, each fold unfolded, the Library's lists and a custom pace, in light and dark mode, at a laptop's width and a phone's (390 px), before an X account and with one that has years of posts, replies, reposts and likes (#389). Xomoni has no toolbar popup: its button opens the dashboard.
- `apps/web/e2e/a11y-states.spec.ts` and `apps/web/e2e/extension/a11y-states.spec.ts` open, on purpose, the states no page shows on load, in both modes (#389): every dialog and menu (the account panel, opened from the keyboard and with the pointer over it, signing out, the typed DELETE, the risks, *Resume anyway*, *Delete all local data*, *Download a copy*, the site's account and phone menus, deleting an account, two-step verification), errors and refusals (a wrong password, a refused link, a file that is no export, a ZIP that is no archive, dates that make no sense), empty lists, toasts, and jobs running, paused, cancelled, waiting, failed and stopped for safety.
- These sweeps use `soft: true`, so one run reports every page and state; a feature's own tests check its other states where they reach them.

Hovered, pressed and open controls are where contrast fails first: muted text inside a quiet control takes the muted grey of its state (`colorNeutralForeground3Hover`, `…Pressed`, `…Selected`), which `packages/fluent-theme` checks at 4.5:1 on those states' backgrounds.

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
npm run test:e2e:release -w @xomoni/web               # before a tag: two releases' zips, update and rollback (docs/RELEASING.md)
XOMONI_E2E_BROWSERS=msedge npm run test:e2e:extension -w @xomoni/web   # the same in Edge, if installed
XOMONI_E2E_HOUR=14 npm run test:e2e:extension -w @xomoni/web   # by day instead of at night (#414)
```

Playwright's Chromium is needed once: `npx playwright install chromium` in `apps/web`.

Coverage reports are written to `coverage/` in each workspace (`index.html`).

Vitest runs on half the machine's cores (`maxWorkers: '50%'` in each workspace's config). With a worker on every core, component tests ran past their waits whenever other apps were busy; with half, the suite is faster and passes every time.
