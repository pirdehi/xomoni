# `apps/extension`: the Xomoni Chrome extension

The part of Xomoni that acts on X. A Chrome MV3 extension that deletes the person's own posts, replies and reposts and removes likes by driving X's own web UI in a normal tab, paced to stay within X's limits ([ADR-0002](../../docs/adr/0002-drive-x-ui-not-the-api.md)). All X data stays in the browser's IndexedDB ([ADR-0004](../../docs/adr/0004-x-data-stays-local.md)).

## Build and run

```bash
npm run build -w @xomoni/extension       # → apps/extension/dist
npm run watch -w @xomoni/extension       # rebuild on change
npm run preview:ui -w @xomoni/extension  # dashboard with demo data, no X connection
npm run store:images -w @xomoni/extension # store icon, logo, screenshots and promo tile → docs/store
npm run icons -w @xomoni/extension       # redraw public/icons from scripts/icon.mjs
npm test -w @xomoni/extension            # engine, kernel and dashboard tests with coverage (tests/, see docs/TESTING.md)
```

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

Your data stays: Chrome keeps the same extension. It needs Chrome 137 or later (Ed25519 in Web Crypto), and releases signed with the key the release workflow holds ([docs/RELEASING.md](../../docs/RELEASING.md#signing-key)).

## Moving to a new Xomoni

Chrome keeps each extension's data apart, so a Xomoni with another id (a fixed id, or the Chrome Web Store version) starts empty. In the Xomoni you're leaving, **Settings › Move your data › Export everything** saves one checked file in Downloads; in the new one, **Import from a file** (also offered on a new install) checks it and adds it to what is there, deleting nothing. The file never leaves the computer ([ADR-0032](../../docs/adr/0032-move-data-between-xomoni-versions.md)).

## Safety

Every behavior toward X follows the [safety playbook](../../docs/PLAYBOOK.md). Never forge headers, solve captchas, touch passwords or cookies, or hide automation ([ADR-0003](../../docs/adr/0003-no-credentials-no-evasion.md)).
