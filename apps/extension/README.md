# `apps/extension`: the Xomoni Chrome extension

The part of Xomoni that acts on X. A Chrome MV3 extension that deletes the person's own posts, replies and reposts and removes likes by driving X's own web UI in a normal tab, paced to stay within X's limits ([ADR-0002](../../docs/adr/0002-drive-x-ui-not-the-api.md)). All X data stays in the browser's IndexedDB ([ADR-0004](../../docs/adr/0004-x-data-stays-local.md)).

## Build and run

```bash
npm run build -w @xomoni/extension       # → apps/extension/dist
npm run watch -w @xomoni/extension       # rebuild on change
npm run preview:ui -w @xomoni/extension  # dashboard with demo data, no X connection
npm test -w @xomoni/extension            # unit tests (tests/)
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
    scan.ts               profile, replies, likes and full-history scans
    worker-tab.ts         the x.com worker window
  shared/                 types, Dexie database, parsers, rules, settings, notifications
  ui/                     React 19 + Tailwind CSS 4 dashboard
  dev/                    UI preview with demo data (not shipped)
```

Build entry points: `dashboard.html` and `src/background/sw.ts` (Vite, `vite.config.ts`); `src/content/content.ts` and `src/inject/interceptor.ts` as classic scripts (esbuild, `scripts/build-content.mjs`). Permissions and content-script registration are in `public/manifest.json`.

## Safety

Every behavior toward X follows the [safety playbook](../../docs/PLAYBOOK.md). Never forge headers, solve captchas, touch passwords or cookies, or hide automation ([ADR-0003](../../docs/adr/0003-no-credentials-no-evasion.md)).
