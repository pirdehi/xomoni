# `apps/extension`: the Xomoni Chrome extension

The part of Xomoni that acts on X. A Chrome MV3 extension that deletes the person's own posts, replies and reposts and removes likes by driving X's own web UI in a normal tab, paced to stay within X's limits ([ADR-0002](../../docs/adr/0002-drive-x-ui-not-the-api.md)). All X data stays in the browser's IndexedDB ([ADR-0004](../../docs/adr/0004-x-data-stays-local.md)).

## Build and run

```bash
npm run build -w @xomoni/extension       # → apps/extension/dist
npm run build:store -w @xomoni/extension # the same for a store, without the one-click updater (ADR-0033)
npm run watch -w @xomoni/extension       # rebuild on change
npm run preview:ui -w @xomoni/extension  # dashboard with demo data, no X connection
npm run store:images -w @xomoni/extension # store icon, logo, screenshots, promo tile → docs/store; Home → apps/web/public/screens
npm run icons -w @xomoni/extension       # redraw public/icons and the website's icons from scripts/icon.mjs
npm test -w @xomoni/extension            # engine, kernel and dashboard tests with coverage (tests/, see docs/TESTING.md)
npm run test:e2e:extension -w @xomoni/web # the built extension in a real browser, on synthetic x.com fixtures (ADR-0040)
```

`scripts/build-content.mjs --outdir <folder>` builds the content scripts elsewhere than `dist`, beside `vite build --outDir <folder>`: the browser tests build their own copy that way, so they never rewrite a `dist` loaded in Chrome.

## Tested in a real browser

Besides its unit and component tests in happy-dom, the built extension runs in a real browser (#342, [ADR-0040](../../docs/adr/0040-test-the-extension-against-recorded-x-fixtures.md)). The tests live with the website's in `apps/web/e2e/extension/`, so both share one Playwright and one accessibility check:

- a fresh install in a new profile for each test, with the dashboard Xomoni opens by itself;
- x.com served from synthetic fixtures (`apps/web/e2e/fixtures/x`), for a made-up account, with no network: no real account and no real X page is ever involved; an account with years of posts, replies, a repost and likes when a test asks for it, and X's answers made a rate limit, a notice over a limited account, another account signed in, or no one;
- the content script on those pages, and what the dashboard takes from them;
- a cleanup by date from the preview to the running job: the typed DELETE, the risks, its pace below one fifth of X's limits, and its stops and waits for X, the connection, the X window and the person (`cleanup-by-date.spec.ts`, #345);
- the keep rules at their edges: a like threshold, words in any case and inside words, every form of a post's link and links that aren't one, the person's own threads, and what the preview, the backup and the job leave out (`keep-rules.spec.ts`, #367);
- the one-click update of a zip install, in a build that trusts a throwaway release key: the folder, the signed release from GitHub, and every release it refuses (`one-click-updates.spec.ts`, #305);
- signing out of Xomoni: the dialog, removing the account's data, X's own sign-out page, the signed-out page and signing in again, and what is kept and stopped (`sign-out.spec.ts`, #226);
- private by design: nothing sent on a fresh install, its pages unable to reach another site, the copy in its own database out of x.com's reach, and xomoni.com's messages it refuses (`private-by-design.spec.ts`, #143);
- job status for xomoni.com: what is reported, when, and that nothing but status leaves, with xomoni.com unreachable or no longer knowing the browser (`live-job-status.spec.ts`, #39);
- one sign-in with xomoni.com, played at the extension: signing in and out from either side, the messages Xomoni refuses and who may send them (`one-sign-in.spec.ts`, #232);
- *Download a copy* of a date range: the dialog at its edges, the page opened as a file, which runs nothing, and JSON (`archive-date-range.spec.ts`, #97);
- moving the data to a new Xomoni, installed fresh in a browser of its own: *Export everything*, the checked import, the files it refuses, and that a file never leaves the computer, starts a job, speeds Xomoni up or lifts a stop (`move-your-data.spec.ts`, #300);
- Watch: searches on X's own Latest page, read-only and within the read limits, with X's empty, failing and limited answers (`watch.spec.ts`, #158);
- X's archive: *Get my archive* on X's archive page, and the ZIP dropped, chosen or from Downloads › Xomoni, with every archive it refuses (`x-archive.spec.ts`, #184);
- the Library: X's count against the copy, browsing and searching it a page at a time, and the reads from X that complete it, which only look (`library.spec.ts`, #185);
- the daily numbers kept in this browser: the profile's counts, the posts seen and the likes received between two looks, counts only, and their deletion (`daily-numbers.spec.ts`, #249);
- the dashboard by keyboard alone, and axe on every page of its menu, in light and dark mode;
- the dashboard's Home, Activity and themes: the status and the one button that helps, the counts and the chart's table, the log and its exports, and the theme's choices named for screen readers (`dashboard-scenarios.spec.ts`, #34);
- Playwright's Chromium in CI's `e2e` job, and Microsoft Edge in `e2e-edge`.

An extension task's user scenarios are proven there ([user scenarios](../../docs/scenarios/README.md#the-extensions-scenarios)).

Load `apps/extension/dist` with **Load unpacked** in `chrome://extensions` (Developer mode).

## Areas

The source is split by the JavaScript context each part runs in. Each area has its own README; the boundaries are the `ext-*` rules in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#7-enforced-rules).

```
src/
  inject/interceptor.ts   page world: reads X's own GraphQL responses and rate-limit headers (never sends)
  content/
    dom.ts                every X selector in one place: update this first if X changes its markup
    actor.ts              user-equivalent actions: delete, unlike, undo repost, scroll
    net.ts                matches X's responses to actions; feeds the inventory
  background/sw.ts        stores observations in IndexedDB; opens the dashboard; handles notification clicks
  engine/
    runner.ts             one job at a time (Web Lock); pause, resume, cancel; login hand-off loop
    context.ts            safety policy per X error code; waiting for the person
    limiter.ts            delays, batches, work sessions, rolling caps, adaptive back-off, active hours
    cleanup.ts            sweep (search or timeline) and deep clean (item by item)
    scan.ts               profile, replies, likes, full-history and date-range scans
    worker-tab.ts         the x.com worker window
  shared/                 types, Dexie database, parsers, rules, settings, notifications
  update/                 one-click updates of a zip install: a signed release, written into Xomoni's folder (ADR-0033)
  ui/                     React 19 dashboard on Fluent UI v9 (ADR-0019)
  dev/                    UI preview with demo data (not shipped)
```

Build entry points: `dashboard.html` and `src/background/sw.ts` (Vite, `vite.config.ts`); `src/content/content.ts` and `src/inject/interceptor.ts` as classic scripts (esbuild, `scripts/build-content.mjs`). Permissions and content-script registration are in `public/manifest.json`; why each one is needed, in the words the stores ask for, is in [the store listing](../../docs/STORE-LISTING.md#5-permissions-and-why-each-is-needed) (#301). The manifest locks the extension down (#143), and `tests/manifest.test.ts` keeps it so:
- **Every permission is used, and only where the store listing says.** A permission no code uses fails the test, and so does a use in another file. The name, short name and description stay within the stores' limits (75, 12 and 132 characters).
- **CSP for extension pages:** they can reach only Xomoni's own API (`connect-src` is the extension and `CLOUD_URL`) and this repository's GitHub release downloads, with the host GitHub redirects them to, for a one-click update (ADR-0033). The browser itself refuses any request to X or anywhere else (ADR-0002, ADR-0004). Only the extension's own scripts run; there are no plugins, frames, form posts or `<base>` tricks; images come only from the extension and X's picture servers (the avatar). Fluent's runtime styles need `style-src 'unsafe-inline'`.
- **No host permissions.** The content scripts' matches cover x.com; nothing reads tab URLs or fetches x.com. The only host access is optional: GitHub's release downloads (`optional_host_permissions`), asked for on the person's first *Update now* (#305, ADR-0033), never at install.
- **`downloads` only places X's archive (#196).** Chrome lets an extension read a folder inside Downloads, never Downloads itself. So while Xomoni expects X's archive, the service worker saves a download named like it (`twitter-YYYY-MM-DD-….zip`) in Downloads/Xomoni. The dashboard makes that folder with a short note and reads it once the person chooses it. No other download is moved, read or kept, and the test checks which `chrome.downloads` calls the source makes.
- **No incognito** (`not_allowed`), so incognito X tabs never write to this profile's database.
- **Only xomoni.com can talk to it:** no web-accessible resources, `externally_connectable` lets only `https://xomoni.com/*` send, the service worker's `onMessageExternal` is the one listener, and there is no `onConnectExternal` (the test checks the source).
- **No remote code.** `npm run remote-code:check` (part of `npm run verify`) builds the extension and fails if `dist` builds code from a string or loads it from another site ([`tooling/check-remote-code.mjs`](../../tooling/check-remote-code.mjs)).

**The fixed id (#302).** Without a `key`, Chrome gives a zip install an id made from its folder. With the Chrome Web Store item's public key as `key`, a zip install and the store's copy share the store's id, which xomoni.com then finds by itself. The key goes in together with the Chrome id in `STORE_EXTENSION_IDS` (`@xomoni/bridge`): `tests/manifest-key.test.ts` fails unless both or neither are set, the key is base64 of an RSA public key, and it gives exactly that id. How to take the key from the dashboard, and the release order that keeps people's data: [docs/RELEASING.md](../../docs/RELEASING.md#the-fixed-id-the-chrome-web-stores-key-302).

## Updating a zip install

Chrome never updates an extension loaded unpacked. When a newer version is out, the dashboard says so, and Xomoni can update itself in one click ([ADR-0033](../../docs/adr/0033-one-click-updates-for-the-zip-install.md), #305):
- once, *Set up one-click updates* (or *Settings › Updates*) asks for the folder you loaded Xomoni from, and Chrome asks to let Xomoni change it;
- then *Update now* downloads the release from GitHub, checks its signature and every file, writes it into that folder while no job runs, and restarts Xomoni.

Your data stays: Chrome keeps the same extension. It needs Chrome 137 or later (Ed25519 in Web Crypto), and releases signed with the key the release workflow holds ([docs/RELEASING.md](../../docs/RELEASING.md#signing-key)). A new version that asks for more access, or a newer browser, is installed by hand instead, where Chrome shows what it asks for. The store build (`npm run build:store`) has no updater: a store updates Xomoni itself.

## The icon

Xomoni's mark is two shoe prints walking up a tile of Xomoni's blue: the newer step white, the older one fading. It is a footprint being tidied, and it is no platform's mark ([ADR-0035](../../docs/adr/0035-xomoni-has-its-own-mark.md), #322).

- **Drawn in code.** [`scripts/icon.mjs`](scripts/icon.mjs) draws it with signed distances, 8 × 8 samples a pixel, and writes PNGs with no image library, so every run gives the same pixels.
- **Every copy comes from there.** `npm run icons` writes `public/icons/icon{16,32,48,128}.png` and the website's `src/app/icon.png`, `src/app/apple-icon.png` (filled to its corners, since Apple rounds it) and `public/logo.png`. `npm run store:images` writes the stores' icons, and screenshots that show the sidebar's logo.
- **Checked.** `tooling/brand.test.mjs` fails when a committed icon no longer matches the drawing, has the wrong size, or loses the two steps at 16 pixels. It also fails when an interface writes X as a glyph instead of its name.
- **Changing it.** Edit `scripts/icon.mjs`, run both commands, and commit the PNGs with it.

## Moving to a new Xomoni

Chrome keeps each extension's data apart, so a Xomoni with another id (a fixed id, or the Chrome Web Store version) starts empty. In the Xomoni you're leaving, **Settings › Move your data › Export everything** saves one checked file in Downloads; in the new one, **Import from a file** (also offered on a new install) checks it and adds it to what is there, deleting nothing. The file never leaves the computer ([ADR-0032](../../docs/adr/0032-move-data-between-xomoni-versions.md)).

Once a store lists Xomoni (`src/shared/store-listings.ts`, the same addresses as xomoni.com's), a zip install shows a card on Home with the four steps to the store's Xomoni: *Export everything*, remove this copy, install from the store, import the file. It tells whether Xomoni was loaded unpacked with `chrome.management.getSelf`, which needs no permission, and it never removes anything itself ([ADR-0034](../../docs/adr/0034-distribution-through-the-browsers-stores.md)).

## Safety

Every behavior toward X follows the [safety playbook](../../docs/PLAYBOOK.md). Never forge headers, solve captchas, touch passwords or cookies, or hide automation ([ADR-0003](../../docs/adr/0003-no-credentials-no-evasion.md)).
