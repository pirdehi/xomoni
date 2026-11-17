# `modules/extension`: the Xomoni extension in this browser

Finds the Xomoni extension installed in the same browser, and keeps xomoni.com and the extension signed in and out together: one sign-in (#232, [ADR-0025](../../../../../docs/adr/0025-one-sign-in-for-the-website-and-the-extension.md)). It talks to the extension through Chrome's `externally_connectable`, with the messages in [`@xomoni/bridge`](../../../../../packages/bridge/README.md). Nothing here carries X content ([ADR-0004](../../../../../docs/adr/0004-x-data-stays-local.md)), and nothing can start, resume or approve work on X ([ADR-0006](../../../../../docs/adr/0006-website-is-view-only.md)).

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `domain/` | `session-sync.ts`, `link.ts` | `decideSync`: what brings the two into step, the newest action winning (signed in here → sign the extension in or switch it; left in the extension after this session started → sign the website out; signed out here after the extension connected → sign it out). `extensionIdIn` and `withoutExtensionId`: the `#ext=<id>` fragment the extension puts on pages it opens. |
| `application/` | `ports.ts`, `session-sync.ts` | Ports `ExtensionChannel`, `BrowserMemory`, `AccountSession`, `SyncLock`. `syncSession`: asks the extension how it stands, decides and acts; keeps the session's first sighting on every page. `signOutBoth`: remembers a website sign-out and signs the extension out too. |
| `infrastructure/` | `chrome-extension-channel.ts`, `browser-memory.ts`, `supabase-account-session.ts`, `web-lock.ts` | `chrome.runtime.sendMessage` with timeouts and the strict parsers; the site's `localStorage` (`xomoni.extension`, `xomoni.signedOutAt`, `xomoni.session`), safe when storage is blocked; the session id from the access token (decoded, not verified), the account's device ids, one-time codes and this session's sign-out on the browser Supabase client; one sync at a time across tabs with Web Locks. |
| `client/` | `extension-session.ts` | Browser composition root, and the link state pages read (`useExtensionLink`): unknown, none, unreachable, signed in (device and masked account) or signed out. |
| `ui/` | `extension-session-sync.tsx` | `ExtensionSessionSync`, in the root layout on every page: keeps the `#ext=` id and clears it from the address bar, syncs when a page opens, comes back into view or the browser signs in or out (not on `/connect`, which pairs by itself), goes to `/login` when a sign-out in the extension signed the website out, and signs the extension out before any form posts to `/auth/signout`. Re-exports `rememberExtensionId` and `useExtensionLink` for other modules. |

## Used by

- `app/layout.tsx`: `ExtensionSessionSync` on every page.
- `modules/dashboard/ui`: `/connect` keeps the extension's id (`rememberExtensionId`); the dashboard marks *This browser* and hides the finished *Finish connecting* notice (`useExtensionLink`).

## Rules

- The usual layer rules (`npm run arch`). `domain/` and `application/` may import `@xomoni/bridge`, a pure contract (ADR-0025).
- Times compared by `decideSync` all come from this computer's clock: the extension's and the site's own records, never the server's.

## Tests

Next to each file. `domain/` and `application/` with fakes for every port; the adapters with fake runtimes, storage, Supabase clients and lock managers; `ui/` in happy-dom (fragment, syncs, sign-out forms). End to end: `e2e/one-sign-in.spec.ts` plays the extension in a real browser against a local Supabase.
