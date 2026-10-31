# `inject/`: page-world network observer

`interceptor.ts` runs in X's own JavaScript context (Chrome's `MAIN` world) at `document_start` in every `https://x.com/*` tab, before X's scripts run. It wraps `window.fetch` and `XMLHttpRequest` to read the responses to the GraphQL operations Xomoni needs, and posts a copy of each one to the content script with `window.postMessage`. It must never send, change, delay or replay a request, never let an error reach X's code, and never hide that the wrappers exist.

## Files

| File             | Responsibility                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interceptor.ts` | Wraps `fetch` and `XMLHttpRequest`; for the 10 watched operations, posts the URL, method, request body (from `init`, or a copy of a `Request` object's), status, `x-rate-limit-*` headers and response body as a `xomoni-net` window message. |

## Depends on

- Nothing in the repository. The script has no imports, so the code that runs inside X's page stays small. Its `WATCHED` list must be kept in sync by hand with `TIMELINE_OPS`, `MUTATION_OPS` and `PROFILE_OPS` in `../shared/graphql.ts`.
- Browser globals only: `window.fetch`, `XMLHttpRequest` and `window.postMessage`.

## Used by

- `scripts/build-content.mjs` bundles `interceptor.ts` with esbuild as a classic IIFE script into `dist/inject.js`. `public/manifest.json` registers it for `https://x.com/*` with `"world": "MAIN"` at `document_start`.
- `../content/content.ts` receives its messages and passes them to `handleCapture` in `../content/net.ts`.

## Rules

- `ext-inject-is-isolated` (from `.dependency-cruiser.cjs`): files here may import only `inject/` and `shared/`. Anything imported from `shared/` would also run inside X's page.
- Safety items from [`docs/PLAYBOOK.md`](../../../../docs/PLAYBOOK.md) implemented here:
  - A1: reads `x-rate-limit-limit`, `x-rate-limit-remaining` and `x-rate-limit-reset` from the responses to X's own requests.
  - B2: builds no requests; X's web app sends them with its own headers.
  - B7 (accepted risk): the `fetch` and `XMLHttpRequest` wrappers are visible to X and are not disguised. They only read: `fetch` bodies are read from a clone of the response.
  - F4: operations are identified by name from the URL path, so a rotated `queryId` does not matter.
  - F8: runs in every x.com tab, so quota used by the person's own browsing is observed too.
