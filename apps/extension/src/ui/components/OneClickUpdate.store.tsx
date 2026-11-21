// The store build's stand-in for `OneClickUpdate.tsx` (#305, ADR-0033). A store updates Xomoni by itself, so the store
// build (`npm run build:store`, `vite.config.ts`) puts these in its place: they show nothing, and nothing in that build
// imports `../../update/`, which downloads releases and writes Xomoni's folder.

/** In a store build, the notice of a newer version has no one-click update: the store brings it. */
export function OneClickUpdate(_props: { version: string }) {
  return null;
}

/** In a store build, Settings has no *Updates* card. */
export function UpdatesCard() {
  return null;
}

/** In a store build, no one-click update ever writes, so there is nothing to report or put back. */
export function UpdateRecovery() {
  return null;
}
