# `content/`: X page actor and network bridge

The content script that Chrome injects into every `https://x.com/*` tab at `document_start`, in the extension's isolated world. It does two jobs. In the worker tab it carries out one action at a time for the dashboard, with the same clicks a person would make, so X's own web app sends every request. In every x.com tab it turns the responses seen by the page-world interceptor into inventory, profile and rate-limit messages for the service worker. It must never build, send, alter or replay a request to X, never type into X's login or check pages, and never write cookies; the only cookie it reads is `twid`, for the signed-in user's id.

## Files

| File         | Responsibility                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content.ts` | Entry point: hands the interceptor its end of a private `MessageChannel` (`../shared/bridge.ts`), passes the captures that arrive on it and pass `isCapture` to `net.ts`, and answers `actor` runtime messages through `actor.ts`. Window messages are never trusted (#59).                                                                          |
| `actor.ts`   | Runs `ActorCommand`s (ping, wait for content, list visible posts, scroll, delete, unlike, re-like then unlike, undo repost, the `canary` check before acting, which opens and closes a menu without clicking in it, and `clearPage`, which closes a pop-up over the page with Escape or its own Close button) and maps X's response to an `Outcome`. |
| `net.ts`     | Parses interceptor captures, resolves `waitForNet` waiters, and sends `rate`, `ingest` and `profile` messages to the service worker. Remembers the page's last timeline HTTP status (`lastTimelineStatus`), which `waitContent` reports.                                                                                                             |
| `dom.ts`     | Every X DOM dependency: selectors, the multilingual Delete label, DOM helpers, `waitFor`, pop-up detection (`openDialog`), account notices, and the signed-in user's id and handle.                                                                                                                                                                  |

## Depends on

- `../shared/` for message types (`messages.ts`), GraphQL operation sets, variable parsing and tweet, profile and error extraction (`graphql.ts`), and login and check page detection (`attention.ts`).
- `../inject/` at runtime only, not by import: `interceptor.ts` takes the port at `document_start` and sends each capture on it.
- Chrome APIs: `chrome.runtime.onMessage` for commands in, `chrome.runtime.sendMessage` for observations out.

## Used by

- `scripts/build-content.mjs` bundles `content.ts` with esbuild as a classic IIFE script into `dist/content.js`. `public/manifest.json` registers it for `https://x.com/*` at `document_start`, in the default isolated world.
- `../engine/worker-tab.ts` sends `{ type: 'actor', command }` with `chrome.tabs.sendMessage`, to the worker tab only. The reply type of each command is mapped there.
- `../background/sw.ts` stores the `ingest`, `profile` and `rate` messages from `net.ts` in IndexedDB.

## Rules

- `ext-content-is-isolated` (from `.dependency-cruiser.cjs`): files here import only `content/` and `shared/`. The engine and the UI reach this code through Chrome messaging, never through imports.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - B2: every action is a click on X's own button; X's code sends the request with its own headers.
  - B3 (accepted risk): clicks are synthetic (`HTMLElement.click()`) and are not disguised as trusted input.
  - A2, A3, B1, C2, D1, E5: `classify()` in `actor.ts` maps codes 429/88, 185/344, 226, 326, 32/89/215/353 and 34/144 to the outcomes the engine acts on. Code 64 is still mapped to `locked` (see C4).
  - B6, E4: `relikeUnlike` likes again only when X shows the post as not liked, and retries the unlike up to 3 times so no like is left behind.
  - D3, D4, D5: write commands are refused while logged out or locked; `ping` reports the signed-in user's id from `twid` so the engine can detect an account switch; nothing is typed on login pages and no cookie is written.
  - A1, F8: `net.ts` reports X's `x-rate-limit-*` headers from every x.com tab, so the user's own browsing is counted too.
  - F3 (#29): `pageInfo` reports a pop-up over the page (`obstructed`); `clearPage` presses Escape, then the pop-up's own Close button, and clicks nothing else. It refuses on X's login and check pages. `noticeText` also reads pop-ups, so a restriction shown in one stops the job.
  - F7 (#31): `resetAtFrom` in `net.ts` moves each reset later by as much as this computer's clock runs ahead of X's `date` header, so Xomoni never acts before X's real reset.
  - F1, F2: all selectors live in `dom.ts`; Delete is found by its label (23 spellings), then by X's red danger color. The `canary` command in `actor.ts` checks a post's menu or buttons before the first action of each kind, without acting.
