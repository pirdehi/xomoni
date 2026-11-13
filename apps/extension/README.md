# `apps/extension`: the Xomoni Chrome extension

The part of Xomoni that acts on X. A Chrome MV3 extension that deletes the person's own posts, replies and reposts and removes likes by driving X's own web UI in a normal tab, paced to stay within X's limits ([ADR-0002](../../docs/adr/0002-drive-x-ui-not-the-api.md)). All X data stays in the browser's IndexedDB ([ADR-0004](../../docs/adr/0004-x-data-stays-local.md)).

## Build and run

```bash
npm run build -w @xomoni/extension       # → apps/extension/dist
npm run watch -w @xomoni/extension       # rebuild on change
npm run preview:ui -w @xomoni/extension  # dashboard with demo data, no X connection
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
  ui/                     React 19 dashboard on Fluent UI v9 (ADR-0019)
  dev/                    UI preview with demo data (not shipped)
```

Build entry points: `dashboard.html` and `src/background/sw.ts` (Vite, `vite.config.ts`); `src/content/content.ts` and `src/inject/interceptor.ts` as classic scripts (esbuild, `scripts/build-content.mjs`). Permissions and content-script registration are in `public/manifest.json`. The manifest locks the extension down (#143), and `tests/manifest.test.ts` keeps it so:
- **CSP for extension pages:** they can reach only Xomoni's own API (`connect-src` is the extension and `CLOUD_URL`), so the browser itself refuses any request to X or anywhere else (ADR-0002, ADR-0004). Only the extension's own scripts run; there are no plugins, frames, form posts or `<base>` tricks; images come only from the extension and X's picture servers (the avatar). Fluent's runtime styles need `style-src 'unsafe-inline'`.
- **No host permissions.** The content scripts' matches cover x.com; nothing reads tab URLs or fetches x.com.
- **`downloads` only places X's archive (#196).** Chrome lets an extension read a folder inside Downloads, never Downloads itself. So while Xomoni expects X's archive, the service worker saves a download named like it (`twitter-YYYY-MM-DD-….zip`) in Downloads/Xomoni. The dashboard makes that folder with a short note and reads it once the person chooses it. No other download is moved, read or kept, and the test checks which `chrome.downloads` calls the source makes.
- **No incognito** (`not_allowed`), so incognito X tabs never write to this profile's database.
- **Nothing outside the extension listens:** no web-accessible resources, and no `onMessageExternal` or `onConnectExternal` listener (the test checks the source).

## Safety

Every behavior toward X follows the [safety playbook](../../docs/PLAYBOOK.md). Never forge headers, solve captchas, touch passwords or cookies, or hide automation ([ADR-0003](../../docs/adr/0003-no-credentials-no-evasion.md)).
