# `inject/`: page-world network observer

`interceptor.ts` runs in X's own JavaScript context (Chrome's `MAIN` world) at `document_start` in every `https://x.com/*` tab, before X's scripts run. It wraps `window.fetch` and `XMLHttpRequest` to read the responses to the GraphQL operations Xomoni needs, and sends a copy of each one to the content script over a private `MessageChannel` whose port the content script hands over at `document_start` (`../shared/bridge.ts`, #59). Nothing goes through `window.postMessage`, where any script on x.com could read or forge it. It must never send, change, delay or replay a request, never let an error reach X's code, and never hide that the wrappers exist.

Once X's scripts run, the interceptor calls only built-ins it took at `document_start` (`natives.ts`, #145): a page script that later patches `Response.prototype.text`, `MessagePort.prototype.postMessage` or `Function.prototype.call` changes nothing it captures and never receives the private port. It captures only requests to `https://x.com` (a relative URL counts), by the operation in the URL's path, and drops an answer that came from another site after a redirect. What it can't rule out: a page script may make requests of its own through X's `fetch`; those answers are X's real ones. So the service worker, the content script and the engine check again what they act on.

## Files

| File             | Responsibility                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interceptor.ts` | Wraps `fetch` and `XMLHttpRequest`; for the 10 watched operations on x.com, posts the URL, method, request body (from `init`, or a copy of a `Request` object's), status, `x-rate-limit-*` and `date` headers and response body over the private channel. |
| `natives.ts`     | The built-ins the interceptor uses, taken once at `document_start` and uncurried (`responseText(res)` calls the original `Response.prototype.text`), with brand checks for `Request` and `URL` (#145). Imports nothing.                                   |

## Depends on

- `../shared/bridge.ts` (`takePort`, the `Capture` type) and `../shared/x-operations.ts` (the operations it forwards, the same list the content script parses), so the code that runs inside X's page stays small.
- Browser globals only, read once at `document_start` (`natives.ts`): `window.fetch`, `XMLHttpRequest`, `Request`, `Response`, `Headers`, `URL`, `MessagePort`, `document` (for the port handover) and a few language built-ins.

## Used by

- `scripts/build-content.mjs` bundles `interceptor.ts` with esbuild as a classic IIFE script into `dist/inject.js`. `public/manifest.json` registers it for `https://x.com/*` with `"world": "MAIN"` at `document_start`.
- `../content/content.ts` owns the other end of the channel, checks each message with `isCapture` and passes it to `handleCapture` in `../content/net.ts`.

## Rules

- `ext-inject-is-isolated` (from `.dependency-cruiser.cjs`): files here may import only `inject/` and `shared/`. Anything imported from `shared/` would also run inside X's page.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - A1: reads `x-rate-limit-limit`, `x-rate-limit-remaining` and `x-rate-limit-reset` from the responses to X's own requests.
  - F7 (#31): also reads `date`, X's clock, so reset times can be corrected for a system clock that runs ahead.
  - B2: builds no requests; X's web app sends them with its own headers.
  - B7 (accepted risk): the `fetch` and `XMLHttpRequest` wrappers are visible to X and are not disguised. They only read: `fetch` bodies are read from a clone of the response.
  - F4: operations are identified by name from the URL path, so a rotated `queryId` does not matter.
  - F8: runs in every x.com tab, so quota used by the person's own browsing is observed too.
